// routes/config.js — business configuration: profile, meal services, variants,
// booking rules.
//
// This is what stops the product being hardcoded to one canteen's habits. Meal
// services and variants are rows here, not enums in a schema, which is why an
// operator can add "Snacks" or "Jain" without a release.
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Business = require("../models/Business");
const MealType = require("../models/MealType");
const MealVariant = require("../models/MealVariant");
const Booking = require("../models/Booking");
const { authenticate, requirePermission } = require("../middleware/authenticate");
const { isTimeOfDay } = require("../utils/time");
const { record } = require("../services/audit");
const { notify, CONCERN } = require("../services/notify");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));
const meta = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] || "" });
const clean = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// Machine key derived from the name once, at creation. Stable afterwards so a
// later rename does not invalidate URLs or saved reports.
const slugify = (v) =>
    String(v || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/* ------------------------------------------------------------------ */
/* EVERYTHING, in one call                                              */
/* ------------------------------------------------------------------ */
router.get("/api/config",
    authenticate, requirePermission("config.view"),
    async (req, res, next) => {
        try {
            const [business, mealTypes, variants] = await Promise.all([
                Business.findById(req.businessId).lean(),
                MealType.find({ businessId: req.businessId }).sort({ sortOrder: 1, name: 1 }).lean(),
                MealVariant.find({ businessId: req.businessId }).sort({ sortOrder: 1, name: 1 }).lean(),
            ]);
            res.json({ business, mealTypes, variants });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* PROFILE + RULES                                                      */
/* ------------------------------------------------------------------ */
router.patch("/api/config/business",
    authenticate, requirePermission("config.edit"),
    async (req, res, next) => {
        try {
            const business = await Business.findById(req.businessId);
            const before = { name: business.name, acceptingBookings: business.acceptingBookings };

            const b = req.body || {};
            // Whitelisted field by field. Assigning req.body wholesale would let
            // a crafted request rewrite slug, bookingCounter or partyTypes.
            if (b.name !== undefined) business.name = clean(b.name, 80) || business.name;
            if (b.logoUrl !== undefined) business.logoUrl = clean(b.logoUrl, 400);
            if (b.contactPhone !== undefined) business.contactPhone = clean(b.contactPhone, 20);
            if (b.contactEmail !== undefined) business.contactEmail = clean(b.contactEmail, 120);
            if (b.addressLine !== undefined) business.addressLine = clean(b.addressLine, 200);
            if (b.city !== undefined) business.city = clean(b.city, 80);
            if (b.landmark !== undefined) business.landmark = clean(b.landmark, 120);
            if (b.acceptingBookings !== undefined) business.acceptingBookings = Boolean(b.acceptingBookings);
            if (b.closedMessage !== undefined) business.closedMessage = clean(b.closedMessage, 200);

            if (b.rules && typeof b.rules === "object") {
                const r = b.rules;
                const set = (key, value) => { if (value !== undefined) business.rules[key] = value; };
                if (r.maxDaysAhead !== undefined) {
                    const n = Number(r.maxDaysAhead);
                    if (!Number.isInteger(n) || n < 0 || n > 365) {
                        return res.status(400).json({ message: "Booking window must be 0–365 days." });
                    }
                    business.rules.maxDaysAhead = n;
                }
                if (r.maxQuantityPerBooking !== undefined) {
                    const n = Number(r.maxQuantityPerBooking);
                    if (!Number.isInteger(n) || n < 1) {
                        return res.status(400).json({ message: "Maximum quantity must be at least 1." });
                    }
                    business.rules.maxQuantityPerBooking = n;
                }
                [
                    "allowCustomerEditBeforeCutoff", "allowCustomerCancelBeforeCutoff",
                    "allowCustomerChangeRequestAfterCutoff", "allowCustomerCancelRequestAfterCutoff",
                    "requireOrganisation", "requireLocation", "requireNote",
                ].forEach((k) => set(k, r[k] === undefined ? undefined : Boolean(r[k])));
            }

            await business.save();
            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: b.rules ? "Updated booking rules" : "Updated business profile",
                before, after: { name: business.name, acceptingBookings: business.acceptingBookings, rules: b.rules ? business.rules : undefined },
            });
            const stopped = before.acceptingBookings !== false && business.acceptingBookings === false;
            notify("config.changed", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: stopped ? "Bookings switched off" : (b.rules ? "Booking rules changed" : "Business profile changed"),
                summary: stopped
                    ? "Customers can no longer place new bookings. Existing bookings are unaffected."
                    : (b.rules ? "The rules governing what customers may book and change were updated." : "Details shown on your booking page were updated."),
                rows: [
                    { label: "Business name", value: business.name },
                    { label: "Accepting bookings", value: business.acceptingBookings === false ? "No" : "Yes" },
                    ...(b.rules ? [{ label: "Book up to", value: `${business.rules.maxDaysAhead} days ahead` },
                        { label: "Max meals per booking", value: String(business.rules.maxQuantityPerBooking) }] : []),
                ],
                concern: CONCERN.config,
            });
            res.json({ business: business.toObject() });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* MEAL SERVICES                                                        */
/* ------------------------------------------------------------------ */
function validateMealTimes(body) {
    for (const [field, label] of [["startTime", "Start time"], ["endTime", "End time"]]) {
        const v = body[field];
        if (v !== undefined && v !== "" && !isTimeOfDay(v)) return `${label} must be in HH:MM format.`;
    }
    // "" is meaningful: no cutoff, so the meal never closes and every booking
    // is auto-confirmed. A real configuration, not a missing value.
    if (body.cutoffTime !== undefined && body.cutoffTime !== "" && !isTimeOfDay(body.cutoffTime)) {
        return "Cutoff time must be in HH:MM format.";
    }
    return null;
}

router.post("/api/config/meal-types",
    authenticate, requirePermission("config.edit"),
    async (req, res, next) => {
        try {
            const b = req.body || {};
            const name = clean(b.name, 60);
            if (!name) return res.status(400).json({ message: "Give the meal service a name." });

            const invalid = validateMealTimes(b);
            if (invalid) return res.status(400).json({ message: invalid });

            const key = slugify(b.key || name);
            if (!key) return res.status(400).json({ message: "That name can't be used." });
            if (await MealType.exists({ businessId: req.businessId, key })) {
                return res.status(409).json({ message: `A meal service called "${name}" already exists.` });
            }

            const count = await MealType.countDocuments({ businessId: req.businessId });
            const mealType = await MealType.create({
                businessId: req.businessId,
                name, key,
                startTime: b.startTime || "",
                endTime: b.endTime || "",
                cutoffTime: b.cutoffTime || "",
                cutoffPreviousDay: Boolean(b.cutoffPreviousDay),
                active: b.active === undefined ? true : Boolean(b.active),
                customerBookable: b.customerBookable === undefined ? true : Boolean(b.customerBookable),
                sortOrder: Number.isInteger(b.sortOrder) ? b.sortOrder : count,
            });

            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Created a meal service",
                after: { name, cutoffTime: mealType.cutoffTime },
            });
            res.status(201).json({ mealType });
        } catch (err) { next(err); }
    });

router.patch("/api/config/meal-types/:id",
    authenticate, requirePermission("config.edit"),
    async (req, res, next) => {
        try {
            if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid meal service." });
            const mealType = await MealType.findOne({ _id: req.params.id, businessId: req.businessId });
            if (!mealType) return res.status(404).json({ message: "Meal service not found." });

            const b = req.body || {};
            const invalid = validateMealTimes(b);
            if (invalid) return res.status(400).json({ message: invalid });

            const before = { name: mealType.name, cutoffTime: mealType.cutoffTime, active: mealType.active };

            if (b.name !== undefined) mealType.name = clean(b.name, 60) || mealType.name;
            if (b.startTime !== undefined) mealType.startTime = b.startTime;
            if (b.endTime !== undefined) mealType.endTime = b.endTime;
            if (b.cutoffTime !== undefined) mealType.cutoffTime = b.cutoffTime;
            if (b.cutoffPreviousDay !== undefined) mealType.cutoffPreviousDay = Boolean(b.cutoffPreviousDay);
            if (b.active !== undefined) mealType.active = Boolean(b.active);
            if (b.customerBookable !== undefined) mealType.customerBookable = Boolean(b.customerBookable);
            if (b.sortOrder !== undefined && Number.isInteger(b.sortOrder)) mealType.sortOrder = b.sortOrder;
            // `key` is never editable — it is in URLs and past exports.

            await mealType.save();
            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Updated a meal service",
                before, after: { name: mealType.name, cutoffTime: mealType.cutoffTime, active: mealType.active },
            });
            res.json({ mealType });
        } catch (err) { next(err); }
    });

// Deactivate, never delete: bookings reference this service and a hard delete
// would orphan every kitchen sheet that ever mentioned it.
router.delete("/api/config/meal-types/:id",
    authenticate, requirePermission("config.edit"),
    async (req, res, next) => {
        try {
            const mealType = await MealType.findOne({ _id: req.params.id, businessId: req.businessId });
            if (!mealType) return res.status(404).json({ message: "Meal service not found." });

            const used = await Booking.countDocuments({ businessId: req.businessId, mealTypeId: mealType._id });
            mealType.active = false;
            await mealType.save();

            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Deactivated a meal service", details: { name: mealType.name, existingBookings: used },
            });
            notify("config.removed", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: "Meal service deactivated",
                summary: `"${mealType.name}" was deactivated. Customers can no longer book it; existing bookings are kept.`,
                rows: [{ label: "Meal service", value: mealType.name }, { label: "Existing bookings kept", value: String(used) }],
                concern: CONCERN.config,
            });
            res.json({ mealType, deactivated: true, existingBookings: used });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* MEAL VARIANTS                                                        */
/* ------------------------------------------------------------------ */
router.post("/api/config/variants",
    authenticate, requirePermission("config.edit"),
    async (req, res, next) => {
        try {
            const b = req.body || {};
            const name = clean(b.name, 60);
            if (!name) return res.status(400).json({ message: "Give the option a name." });

            const key = slugify(b.key || name);
            if (!key) return res.status(400).json({ message: "That name can't be used." });
            if (await MealVariant.exists({ businessId: req.businessId, key })) {
                return res.status(409).json({ message: `An option called "${name}" already exists.` });
            }

            const price = Number(b.price || 0);
            if (!Number.isFinite(price) || price < 0) {
                return res.status(400).json({ message: "Price can't be negative." });
            }

            // Only ids that genuinely belong to this business survive.
            const mealTypeIds = Array.isArray(b.mealTypeIds)
                ? (await MealType.find({ _id: { $in: b.mealTypeIds.filter(isId) }, businessId: req.businessId })
                    .select("_id").lean()).map((m) => m._id)
                : [];

            const count = await MealVariant.countDocuments({ businessId: req.businessId });
            const variant = await MealVariant.create({
                businessId: req.businessId,
                name, key, price,
                description: clean(b.description, 160),
                active: b.active === undefined ? true : Boolean(b.active),
                mealTypeIds,
                sortOrder: Number.isInteger(b.sortOrder) ? b.sortOrder : count,
            });

            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Created a meal option", after: { name, price },
            });
            res.status(201).json({ variant });
        } catch (err) { next(err); }
    });

router.patch("/api/config/variants/:id",
    authenticate, requirePermission("config.edit"),
    async (req, res, next) => {
        try {
            if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid option." });
            const variant = await MealVariant.findOne({ _id: req.params.id, businessId: req.businessId });
            if (!variant) return res.status(404).json({ message: "Option not found." });

            const b = req.body || {};
            const before = { name: variant.name, price: variant.price, active: variant.active };

            if (b.name !== undefined) variant.name = clean(b.name, 60) || variant.name;
            if (b.description !== undefined) variant.description = clean(b.description, 160);
            if (b.price !== undefined) {
                const price = Number(b.price);
                if (!Number.isFinite(price) || price < 0) {
                    return res.status(400).json({ message: "Price can't be negative." });
                }
                variant.price = price;
            }
            if (b.active !== undefined) variant.active = Boolean(b.active);
            if (b.sortOrder !== undefined && Number.isInteger(b.sortOrder)) variant.sortOrder = b.sortOrder;
            if (Array.isArray(b.mealTypeIds)) {
                variant.mealTypeIds = (await MealType.find({
                    _id: { $in: b.mealTypeIds.filter(isId) }, businessId: req.businessId,
                }).select("_id").lean()).map((m) => m._id);
            }

            await variant.save();
            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Updated a meal option",
                before, after: { name: variant.name, price: variant.price, active: variant.active },
            });
            res.json({ variant });
        } catch (err) { next(err); }
    });

// Deactivated variants stay on historical bookings and keep counting toward
// those days' preparation — they simply leave the booking form.
router.delete("/api/config/variants/:id",
    authenticate, requirePermission("config.edit"),
    async (req, res, next) => {
        try {
            const variant = await MealVariant.findOne({ _id: req.params.id, businessId: req.businessId });
            if (!variant) return res.status(404).json({ message: "Option not found." });
            variant.active = false;
            await variant.save();

            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Deactivated a meal option", details: { name: variant.name },
            });
            notify("config.removed", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: "Meal option deactivated",
                summary: `"${variant.name}" was deactivated and has left the booking form.`,
                rows: [{ label: "Option", value: variant.name }], concern: CONCERN.config,
            });
            res.json({ variant, deactivated: true });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* PARTY TYPES                                                          */
/* ------------------------------------------------------------------ */
// Individual and Group ship as defaults, but a caterer may want "Corporate" or
// "Event" — so the list is configuration rather than an enum.
router.put("/api/config/party-types",
    authenticate, requirePermission("config.edit"),
    async (req, res, next) => {
        try {
            const incoming = Array.isArray(req.body?.partyTypes) ? req.body.partyTypes : null;
            if (!incoming?.length) {
                return res.status(400).json({ message: "Keep at least one party type." });
            }

            const seen = new Set();
            const cleaned = [];
            for (const p of incoming) {
                const label = clean(p?.label, 40);
                const key = slugify(p?.key || label);
                if (!label || !key || seen.has(key)) continue;
                seen.add(key);
                cleaned.push({
                    key, label,
                    active: p.active === undefined ? true : Boolean(p.active),
                    isGroup: Boolean(p.isGroup),
                });
            }
            if (!cleaned.length) return res.status(400).json({ message: "Those party types aren't valid." });

            const business = await Business.findById(req.businessId);
            business.partyTypes = cleaned;
            await business.save();

            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Updated party types", after: { partyTypes: cleaned.map((c) => c.label) },
            });
            notify("config.changed", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: "Customer types changed", summary: "The customer types offered on the booking form were updated.",
                rows: [{ label: "Types", value: cleaned.map((c) => `${c.label}${c.active ? "" : " (hidden)"}`).join(", ") }],
                concern: CONCERN.config,
            });
            res.json({ partyTypes: business.partyTypes });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* BOOKING FORM QUESTIONS                                               */
/* ------------------------------------------------------------------ */
// A canteen needs a floor number, a guest house needs a room, a project site
// needs a gate. Hardcoding any of those would make the form wrong for everyone
// else, so the extra questions are configuration — the same decision meal
// services and variants already embody.
//
// THE ANSWERS ARE SNAPSHOTTED ONTO THE BOOKING at write time (key, label, type
// and value together), which is what makes the two rules below non-negotiable.
const FIELD_TYPES = ["text", "textarea", "number", "tel", "email", "select", "date", "checkbox"];
const MAX_FIELDS = 20;
const MAX_OPTIONS = 12;

/** Slugified, de-duplicated key list — for the meal/party filters on a field. */
const keyList = (v, max = 24) =>
    Array.isArray(v) ? [...new Set(v.map((k) => slugify(k)).filter(Boolean))].slice(0, max) : [];

router.get("/api/config/booking-fields",
    authenticate, requirePermission("config.view"),
    async (req, res, next) => {
        try {
            const business = await Business.findById(req.businessId).select("bookingFields").lean();
            res.json({ bookingFields: business?.bookingFields || [] });
        } catch (err) { next(err); }
    });

/**
 * Replace the whole list.
 *
 * REPLACE-ALL rather than per-field CRUD because the editor is a reorderable
 * list: "field 3 moved above field 1 and field 2 was deleted" is one intention,
 * and three separate calls to express it can half-succeed.
 *
 * THE KEY IS NEVER REGENERATED FROM AN EDITED LABEL. Every answer already
 * recorded on a past booking is stored against its key; renaming "Floor" to
 * "Floor / Wing" and re-slugifying would orphan every one of them, and the
 * booking they belong to would show a question nobody can match up. So a key
 * the client sends back is honoured as-is, and a key is only derived from a
 * label when the field is genuinely new.
 */
router.put("/api/config/booking-fields",
    authenticate, requirePermission("config.edit"),
    async (req, res, next) => {
        try {
            const incoming = Array.isArray(req.body?.bookingFields) ? req.body.bookingFields : null;
            // An empty list is a real instruction — "ask nothing extra" — so
            // only a missing or non-array body is refused.
            if (!incoming) return res.status(400).json({ message: "Send the list of questions to save." });
            if (incoming.length > MAX_FIELDS) {
                return res.status(400).json({ message: `Keep the booking form to ${MAX_FIELDS} extra questions or fewer.` });
            }

            const business = await Business.findById(req.businessId);
            if (!business) return res.status(404).json({ message: "Business not found." });

            const existingKeys = new Set((business.bookingFields || []).map((f) => f.key));
            const before = (business.bookingFields || []).map((f) => ({ key: f.key, label: f.label, active: f.active }));

            const seen = new Set();
            const cleaned = [];

            for (let i = 0; i < incoming.length; i++) {
                const f = incoming[i] || {};
                const label = clean(f.label, 80);
                // A question with nothing to ask is not a question. Dropped
                // rather than refused, so one blank row left in the editor
                // cannot make the whole form un-saveable.
                if (!label) continue;

                const type = String(f.type || "text");
                if (!FIELD_TYPES.includes(type)) {
                    return res.status(400).json({ message: `"${label}": choose a valid answer type.` });
                }

                const options = type === "select"
                    ? [...new Set(
                        (Array.isArray(f.options) ? f.options : [])
                            .map((o) => clean(o, 60)).filter(Boolean)
                    )].slice(0, MAX_OPTIONS)
                    : [];
                if (type === "select" && !options.length) {
                    return res.status(400).json({ message: `"${label}" is a dropdown, so give it at least one option.` });
                }

                // Stability, in order of preference: a key that already exists
                // wins outright; any other key the client sends is kept (a
                // freshly-created field keeps the id its editor gave it); only
                // then is one derived from the label.
                const sent = slugify(f.key);
                let key = (sent && existingKeys.has(sent)) ? sent : (sent || slugify(label) || `question-${i + 1}`);
                if (seen.has(key)) {
                    let n = 2;
                    while (seen.has(`${key}-${n}`)) n++;
                    key = `${key}-${n}`;
                }
                seen.add(key);

                // Built property by property: assigning the submitted object
                // wholesale is how an unknown field ends up persisted, and
                // Mixed-typed junk on a Business document is forever.
                cleaned.push({
                    key,
                    label,
                    type,
                    options,
                    placeholder: clean(f.placeholder, 80),
                    help: clean(f.help, 160),
                    required: Boolean(f.required),
                    active: f.active === undefined ? true : Boolean(f.active),
                    // Empty means "every meal service" / "every party type".
                    // Keys rather than ids, because these lists are themselves
                    // configuration and a key is the stable half of one.
                    mealTypeKeys: keyList(f.mealTypeKeys),
                    partyTypeKeys: keyList(f.partyTypeKeys),
                    sortOrder: Number.isInteger(f.sortOrder) ? f.sortOrder : i,
                });
            }

            business.bookingFields = cleaned;
            await business.save();

            const after = cleaned.map((f) => ({ key: f.key, label: f.label, active: f.active }));
            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Updated the booking form questions",
                before: { bookingFields: before }, after: { bookingFields: after },
            });
            notify("config.changed", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: "Booking form questions changed",
                summary: "The extra questions asked on your booking page were updated. Answers already recorded on past bookings are unchanged.",
                rows: [
                    {
                        label: "Questions",
                        value: cleaned.length
                            ? cleaned.map((f) => `${f.label}${f.active ? "" : " (hidden)"}${f.required ? " *" : ""}`).join(", ")
                            : "None",
                    },
                    { label: "Asked on the form", value: String(cleaned.filter((f) => f.active).length) },
                ],
                concern: CONCERN.config,
            });

            res.json({ bookingFields: business.bookingFields });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* QR POSTER                                                            */
/* ------------------------------------------------------------------ */
// The poster is a presentation document the dashboard's editor owns; the
// server keeps it so the owner's layout survives a new browser. Size-capped
// and stored as-is — it never influences any booking logic.
router.put("/api/config/qr-poster",
    authenticate, requirePermission("config.edit"),
    async (req, res, next) => {
        try {
            const poster = req.body?.poster;
            if (!poster || typeof poster !== "object") return res.status(400).json({ message: "Nothing to save." });
            if (JSON.stringify(poster).length > 60_000) return res.status(413).json({ message: "That design is too large to save." });
            await Business.updateOne({ _id: req.businessId }, { $set: { qrPoster: poster } });
            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Saved the QR poster design", details: { theme: poster.theme, elements: Object.keys(poster.elements || {}).length },
            });
            res.json({ ok: true });
        } catch (err) { next(err); }
    });

module.exports = router;
