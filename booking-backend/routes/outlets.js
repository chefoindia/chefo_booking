// routes/outlets.js — the outlets (serving points / sites) of one business.
//
// Reuses the existing tenant and permission model rather than inventing one:
//   * businessId is ALWAYS req.businessId. An outlet id from another business
//     is simply not found, so nothing here can read or edit across canteens.
//   * Managing outlets is business configuration, so it sits behind the same
//     owner-guarded `config.*` permissions as meal services and variants.
//   * Every signed-in user may LIST outlets — the outlet selector on every
//     dashboard page needs them — but a user restricted to certain outlets
//     is handed only those. The list is the user's scope, rendered.
//
// Outlets are deactivated, never deleted. Bookings reference them by id and
// the kitchen sheets of the past must keep reading correctly.
const express = require("express");
const router = express.Router();

const Outlet = require("../models/Outlet");
const Booking = require("../models/Booking");
const BusinessUser = require("../models/BusinessUser");
const { authenticate, requirePermission } = require("../middleware/authenticate");
const { record } = require("../services/audit");
const { notify, CONCERN } = require("../services/notify");
const { isId } = require("../utils/outletScope");

const meta = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] || "" });
const clean = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const slugify = (v) =>
    String(v || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// What every consumer of an outlet sees. Shaped explicitly so a future column
// on the model cannot leak onto the wire by default.
const shapeOutlet = (o) => ({
    id: o._id,
    _id: o._id,
    name: o.name,
    key: o.key,
    description: o.description || "",
    addressLine: o.addressLine || "",
    contactPhone: o.contactPhone || "",
    active: o.active !== false,
    sortOrder: o.sortOrder || 0,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
});

/**
 * The outlets THIS user may see, in display order — the selector's contents.
 *
 * Exposed to any authenticated user because every page carries the selector.
 * `scope` tells the client whether it is looking at the whole canteen (null)
 * or a slice of it, so it can label "All outlets" honestly as "All my
 * outlets". `outletRequired` is what the counter's booking form uses to
 * insist on a choice.
 */
router.get("/api/outlets", authenticate, async (req, res, next) => {
    try {
        const filter = { businessId: req.businessId };
        if (req.outletScope) filter._id = { $in: req.outletScope };
        const outlets = await Outlet.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
        res.json({
            outlets: outlets.map(shapeOutlet),
            scope: req.outletScope,
            outletRequired: await Outlet.exists({ businessId: req.businessId, active: true }).then(Boolean),
        });
    } catch (err) { next(err); }
});

/** Management view: every outlet plus who is assigned and how many bookings it holds. */
router.get("/api/outlets/manage",
    authenticate, requirePermission("config.view"),
    async (req, res, next) => {
        try {
            const [outlets, users, counts] = await Promise.all([
                Outlet.find({ businessId: req.businessId }).sort({ sortOrder: 1, name: 1 }).lean(),
                BusinessUser.find({ businessId: req.businessId, isActive: true, outletIds: { $ne: [] } })
                    .select("name outletIds").lean(),
                Booking.aggregate([
                    { $match: { businessId: req.businessId } },
                    { $group: { _id: "$outletId", n: { $sum: 1 } } },
                ]),
            ]);
            const bookingsBy = new Map(counts.map((c) => [c._id ? String(c._id) : "unassigned", c.n]));
            res.json({
                outlets: outlets.map((o) => ({
                    ...shapeOutlet(o),
                    bookingCount: bookingsBy.get(String(o._id)) || 0,
                    staff: users
                        .filter((u) => (u.outletIds || []).some((id) => String(id) === String(o._id)))
                        .map((u) => ({ id: u._id, name: u.name })),
                })),
                // Bookings from before this business had outlets. Shown so the
                // number is never a surprise; assigned only by an explicit
                // decision (scripts/migrate-outlets.js), never here.
                unassignedBookings: bookingsBy.get("unassigned") || 0,
            });
        } catch (err) { next(err); }
    });

router.post("/api/outlets",
    authenticate, requirePermission("config.edit"),
    async (req, res, next) => {
        try {
            const b = req.body || {};
            const name = clean(b.name, 60);
            if (!name) return res.status(400).json({ message: "Give the outlet a name." });

            const key = slugify(b.key || name);
            if (!key) return res.status(400).json({ message: "That name can't be used." });
            if (await Outlet.exists({ businessId: req.businessId, key })) {
                return res.status(409).json({ message: `An outlet called "${name}" already exists.`, code: "DUPLICATE" });
            }

            const count = await Outlet.countDocuments({ businessId: req.businessId });
            const outlet = await Outlet.create({
                // From the session, never the body.
                businessId: req.businessId,
                name, key,
                description: clean(b.description, 160),
                addressLine: clean(b.addressLine, 200),
                contactPhone: clean(b.contactPhone, 20),
                active: b.active === undefined ? true : Boolean(b.active),
                sortOrder: Number.isInteger(b.sortOrder) ? b.sortOrder : count,
                createdByUserId: req.actor.userId,
            });

            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Created an outlet", outletId: outlet._id, after: { name, active: outlet.active },
            });
            notify("config.changed", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: "Outlet added",
                summary: `"${name}" was added. Customers now choose an outlet when they book, and every new booking belongs to one.`,
                rows: [{ label: "Outlet", value: name }],
                concern: CONCERN.config,
            });
            res.status(201).json({ outlet: shapeOutlet(outlet) });
        } catch (err) { next(err); }
    });

router.patch("/api/outlets/:id",
    authenticate, requirePermission("config.edit"),
    async (req, res, next) => {
        try {
            if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid outlet." });
            const outlet = await Outlet.findOne({ _id: req.params.id, businessId: req.businessId });
            if (!outlet) return res.status(404).json({ message: "Outlet not found." });

            const b = req.body || {};
            const before = { name: outlet.name, active: outlet.active };

            if (b.name !== undefined) outlet.name = clean(b.name, 60) || outlet.name;
            if (b.description !== undefined) outlet.description = clean(b.description, 160);
            if (b.addressLine !== undefined) outlet.addressLine = clean(b.addressLine, 200);
            if (b.contactPhone !== undefined) outlet.contactPhone = clean(b.contactPhone, 20);
            if (b.active !== undefined) outlet.active = Boolean(b.active);
            if (b.sortOrder !== undefined && Number.isInteger(b.sortOrder)) outlet.sortOrder = b.sortOrder;
            // `key` is never editable — it is the stable identity in saved filters.

            await outlet.save();
            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Updated an outlet", outletId: outlet._id,
                before, after: { name: outlet.name, active: outlet.active },
            });
            if (before.active !== outlet.active) {
                notify("config.changed", {
                    businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                    title: outlet.active ? "Outlet reactivated" : "Outlet deactivated",
                    summary: outlet.active
                        ? `"${outlet.name}" is taking bookings again.`
                        : `"${outlet.name}" no longer takes new bookings. Its existing bookings are kept.`,
                    rows: [{ label: "Outlet", value: outlet.name }],
                    concern: CONCERN.config,
                });
            }
            res.json({ outlet: shapeOutlet(outlet) });
        } catch (err) { next(err); }
    });

// Deactivate, never delete. Bookings keep their outlet and keep counting;
// the outlet simply leaves the customer's picker and the counter's form.
router.delete("/api/outlets/:id",
    authenticate, requirePermission("config.edit"),
    async (req, res, next) => {
        try {
            if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid outlet." });
            const outlet = await Outlet.findOne({ _id: req.params.id, businessId: req.businessId });
            if (!outlet) return res.status(404).json({ message: "Outlet not found." });

            const used = await Booking.countDocuments({ businessId: req.businessId, outletId: outlet._id });
            outlet.active = false;
            await outlet.save();

            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Deactivated an outlet", outletId: outlet._id,
                details: { name: outlet.name, existingBookings: used },
            });
            notify("config.removed", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: "Outlet deactivated",
                summary: `"${outlet.name}" was deactivated. Customers can no longer book it; existing bookings are kept.`,
                rows: [{ label: "Outlet", value: outlet.name }, { label: "Existing bookings kept", value: String(used) }],
                concern: CONCERN.config,
            });
            res.json({ outlet: shapeOutlet(outlet), deactivated: true, existingBookings: used });
        } catch (err) { next(err); }
    });

module.exports = router;
module.exports.shapeOutlet = shapeOutlet;
