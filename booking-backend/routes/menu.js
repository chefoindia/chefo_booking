// routes/menu.js — the weekly menu: what each meal service serves on each day,
// split by option. This is what the customer booking page shows under a meal,
// so a customer booking Tuesday lunch knows it is rajma-chawal.
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const WeeklyMenu = require("../models/WeeklyMenu");
const MealType = require("../models/MealType");
const MealVariant = require("../models/MealVariant");
const { authenticate, requirePermission } = require("../middleware/authenticate");
const { record } = require("../services/audit");
const { notify } = require("../services/notify");

const { WEEKDAYS } = WeeklyMenu;
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));
const meta = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] || "" });
const cleanItem = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

/**
 * Validate and shape the entries for one (meal, weekday). Only variants that
 * belong to this business AND are allowed for this meal survive; item text is
 * trimmed, blanks dropped, capped at 20 per option.
 */
async function shapeEntries(businessId, mealType, rawEntries) {
    const wanted = Array.isArray(rawEntries) ? rawEntries : [];
    const ids = wanted.map((e) => e?.variantId).filter(isId);
    if (!ids.length) return [];
    const variants = await MealVariant.find({ _id: { $in: ids }, businessId }).lean();
    const byId = new Map(variants.map((v) => [String(v._id), v]));

    const out = [];
    const seen = new Set();
    for (const e of wanted) {
        const v = byId.get(String(e?.variantId));
        if (!v || seen.has(String(v._id))) continue;
        if (v.mealTypeIds?.length && !v.mealTypeIds.some((m) => String(m) === String(mealType._id))) continue;
        seen.add(String(v._id));
        const items = (Array.isArray(e.items) ? e.items : String(e.items || "").split("\n"))
            .map(cleanItem).filter(Boolean).slice(0, 20);
        out.push({ variantId: v._id, variantName: v.name, items });
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* Everything, in one call                                              */
/* ------------------------------------------------------------------ */
router.get("/api/menu",
    authenticate, requirePermission("menu.view"),
    async (req, res, next) => {
        try {
            const [mealTypes, variants, menus] = await Promise.all([
                MealType.find({ businessId: req.businessId }).sort({ sortOrder: 1, name: 1 }).lean(),
                MealVariant.find({ businessId: req.businessId }).sort({ sortOrder: 1, name: 1 }).lean(),
                WeeklyMenu.find({ businessId: req.businessId }).lean(),
            ]);
            res.json({ weekdays: WEEKDAYS, mealTypes, variants, menus });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* Save one day of one meal service                                     */
/* ------------------------------------------------------------------ */
router.put("/api/menu/:mealTypeId/:weekday",
    authenticate, requirePermission("menu.edit"),
    async (req, res, next) => {
        try {
            const { mealTypeId, weekday } = req.params;
            if (!isId(mealTypeId)) return res.status(400).json({ message: "Invalid meal service." });
            if (!WEEKDAYS.includes(weekday)) return res.status(400).json({ message: "Invalid weekday." });

            const mealType = await MealType.findOne({ _id: mealTypeId, businessId: req.businessId }).lean();
            if (!mealType) return res.status(404).json({ message: "Meal service not found." });

            const entries = await shapeEntries(req.businessId, mealType, req.body?.entries);
            const note = String(req.body?.note ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
            const served = req.body?.served === undefined ? true : Boolean(req.body.served);

            const menu = await WeeklyMenu.findOneAndUpdate(
                { businessId: req.businessId, mealTypeId, weekday },
                { $set: { entries, note, served, updatedByUserId: req.actor.userId } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            ).lean();

            const dishCount = entries.reduce((n, e) => n + e.items.length, 0);
            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: `Updated the ${weekday} menu for ${mealType.name}`,
                details: { mealType: mealType.name, weekday, dishes: dishCount, served },
            });
            notify("menu.changed", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: "Weekly menu updated",
                summary: `The ${weekday} menu for ${mealType.name} was changed.`,
                rows: [{ label: "Meal service", value: mealType.name }, { label: "Day", value: weekday },
                    { label: "Dishes listed", value: String(dishCount) }, { label: "Served that day", value: served ? "Yes" : "No" }],
            });
            res.json({ menu });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* Copy one day to others — "same as Monday", "copy lunch to dinner"    */
/* ------------------------------------------------------------------ */
router.post("/api/menu/copy",
    authenticate, requirePermission("menu.edit"),
    async (req, res, next) => {
        try {
            const { fromMealTypeId, fromWeekday, to } = req.body || {};
            if (!isId(fromMealTypeId) || !WEEKDAYS.includes(fromWeekday)) {
                return res.status(400).json({ message: "Pick a valid day to copy from." });
            }
            const targets = (Array.isArray(to) ? to : []).filter((t) => isId(t?.mealTypeId) && WEEKDAYS.includes(t?.weekday));
            if (!targets.length) return res.status(400).json({ message: "Pick at least one day to copy to." });

            const source = await WeeklyMenu.findOne({ businessId: req.businessId, mealTypeId: fromMealTypeId, weekday: fromWeekday }).lean();
            if (!source) return res.status(404).json({ message: "That day has no menu to copy yet." });

            const mealTypes = await MealType.find({ businessId: req.businessId }).lean();
            const mealById = new Map(mealTypes.map((m) => [String(m._id), m]));

            let written = 0;
            for (const t of targets) {
                if (String(t.mealTypeId) === String(fromMealTypeId) && t.weekday === fromWeekday) continue;
                const mealType = mealById.get(String(t.mealTypeId));
                if (!mealType) continue;
                // Re-shaped against the TARGET meal so a lunch-only option is
                // dropped when copied to dinner rather than smuggled across.
                const entries = await shapeEntries(req.businessId, mealType, source.entries);
                await WeeklyMenu.findOneAndUpdate(
                    { businessId: req.businessId, mealTypeId: t.mealTypeId, weekday: t.weekday },
                    { $set: { entries, note: source.note, served: source.served, updatedByUserId: req.actor.userId } },
                    { upsert: true, setDefaultsOnInsert: true }
                );
                written++;
            }

            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: `Copied the ${fromWeekday} ${mealById.get(String(fromMealTypeId))?.name || ""} menu to ${written} other day(s)`,
                details: { from: { mealTypeId: fromMealTypeId, weekday: fromWeekday }, targets: written },
            });
            res.json({ ok: true, written });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* Clear a day                                                          */
/* ------------------------------------------------------------------ */
router.delete("/api/menu/:mealTypeId/:weekday",
    authenticate, requirePermission("menu.edit"),
    async (req, res, next) => {
        try {
            const { mealTypeId, weekday } = req.params;
            if (!isId(mealTypeId) || !WEEKDAYS.includes(weekday)) return res.status(400).json({ message: "Invalid day." });
            const gone = await WeeklyMenu.findOneAndDelete({ businessId: req.businessId, mealTypeId, weekday }).lean();
            if (gone) {
                record({
                    businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                    action: `Cleared the ${weekday} menu`, details: { mealTypeId, weekday, before: gone.entries },
                });
            }
            res.json({ ok: true, cleared: Boolean(gone) });
        } catch (err) { next(err); }
    });

module.exports = router;
