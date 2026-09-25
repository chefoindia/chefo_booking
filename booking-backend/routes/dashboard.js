// routes/dashboard.js — "how much work do we have today?"
//
// The operator should never have to open individual bookings to know what the
// kitchen must cook. One request answers it for every meal service on a date:
// confirmed quantities per variant, what is waiting for a decision, and how
// much of today's count arrived late.
//
// Confirmed and pending are reported as SEPARATE numbers and never summed.
// The moment they merge, the kitchen is cooking to a figure nobody approved.
const express = require("express");
const router = express.Router();

const MealType = require("../models/MealType");
const MealVariant = require("../models/MealVariant");
const Business = require("../models/Business");
const Outlet = require("../models/Outlet");
const { authenticate, requirePermission } = require("../middleware/authenticate");
const {
    confirmedTotalsByMeal, confirmedTotalsByOutlet, pendingSummaryByMeal, lateAcceptedByMeal, orderVariants,
} = require("../services/quantity");
const { cutoffState, todayKey, isDateKey } = require("../utils/time");
const { scopedOutletMatch, outletSelection } = require("../utils/outletScope");

router.get("/api/dashboard/today",
    authenticate, requirePermission("dashboard.view"),
    async (req, res, next) => {
        try {
            const business = await Business.findById(req.businessId)
                .select("timezoneOffsetMinutes acceptingBookings name").lean();
            const tz = business.timezoneOffsetMinutes ?? 330;
            const today = todayKey(tz);
            const date = isDateKey(req.query.date) ? req.query.date : today;

            // ONE outlet, or everything this user may see. The overall view and
            // the outlet view are the SAME aggregation with one more filter
            // term — never a sum of per-outlet numbers, so nothing is counted
            // twice and the two can never disagree.
            const om = await scopedOutletMatch(req, req.query.outletId);
            if (!om.ok) return next(om.error);
            const requested = String(req.query.outletId || "").trim();
            const outlet = outletSelection(req.outletScope, requested);

            const outletFilter = { businessId: req.businessId };
            if (req.outletScope) outletFilter._id = { $in: req.outletScope };

            const [mealTypes, variants, confirmed, pending, late, outlets, byOutletRaw] = await Promise.all([
                MealType.find({ businessId: req.businessId, active: true })
                    .sort({ sortOrder: 1, name: 1 }).lean(),
                MealVariant.find({ businessId: req.businessId })
                    .sort({ sortOrder: 1, name: 1 }).lean(),
                confirmedTotalsByMeal({ businessId: req.businessId, date, outlet }),
                pendingSummaryByMeal({ businessId: req.businessId, date, outlet }),
                lateAcceptedByMeal({ businessId: req.businessId, date, outlet }),
                Outlet.find(outletFilter).sort({ sortOrder: 1, name: 1 }).lean(),
                // The per-outlet breakdown is only meaningful on the overall
                // view; a single outlet's page IS its own breakdown.
                requested && requested !== "unassigned"
                    ? null
                    : confirmedTotalsByOutlet({ businessId: req.businessId, date, outlet }),
            ]);

            const now = new Date();
            const services = mealTypes.map((m) => {
                const key = String(m._id);
                const conf = confirmed.get(key) || { byVariant: {}, totalQuantity: 0, bookingCount: 0 };
                const pend = pending.get(key) || {
                    count: 0, quantityDelta: 0, newBookings: 0, changes: 0, cancellations: 0,
                };
                const lateInfo = late.get(key) || { quantity: 0, bookings: 0 };
                const c = cutoffState(m, date, { now, offsetMinutes: tz });

                // Only variants this meal actually serves, in configured order,
                // so a zero row appears for something on the menu but not yet
                // booked — a kitchen needs to see the zero.
                const relevant = variants.filter(
                    (v) => !v.mealTypeIds?.length || v.mealTypeIds.some((id) => String(id) === key)
                );

                return {
                    mealTypeId: m._id,
                    key: m.key,
                    name: m.name,
                    startTime: m.startTime,
                    endTime: m.endTime,
                    cutoffTime: m.cutoffTime,
                    cutoffPreviousDay: m.cutoffPreviousDay,
                    hasCutoff: c.hasCutoff,
                    cutoffPassed: c.passed,
                    cutoffAt: c.cutoffAt,
                    confirmed: {
                        byVariant: orderVariants(conf.byVariant, relevant),
                        totalQuantity: conf.totalQuantity,
                        bookingCount: conf.bookingCount,
                    },
                    pending: pend,
                    lateAccepted: lateInfo,
                };
            });

            // Per outlet, per meal, in the configured variant order — the
            // "All outlets" table under the overall cards. Every outlet this
            // user may see is listed even at zero (a kitchen needs to see the
            // zero), and pre-outlet bookings appear as a final "Unassigned"
            // line so history never silently drops out of the total.
            let byOutlet = null;
            if (byOutletRaw) {
                const line = (key, id, name, active) => {
                    const o = byOutletRaw.get(key);
                    return {
                        outletId: id,
                        name,
                        active,
                        totalQuantity: o?.totalQuantity || 0,
                        bookingCount: o?.bookingCount || 0,
                        services: mealTypes.map((m) => {
                            const k = String(m._id);
                            const mm = o?.byMeal.get(k) || { byVariant: {}, totalQuantity: 0, bookingCount: 0 };
                            const relevant = variants.filter(
                                (v) => !v.mealTypeIds?.length || v.mealTypeIds.some((id) => String(id) === k)
                            );
                            return {
                                mealTypeId: m._id, name: m.name,
                                totalQuantity: mm.totalQuantity, bookingCount: mm.bookingCount,
                                byVariant: orderVariants(mm.byVariant, relevant),
                            };
                        }),
                    };
                };
                byOutlet = outlets.map((o) => line(String(o._id), String(o._id), o.name, o.active !== false));
                const un = byOutletRaw.get("unassigned");
                if (un && (un.totalQuantity || un.bookingCount)) {
                    byOutlet.push(line("unassigned", null, "Unassigned (before outlets)", true));
                }
            }

            const selected = requested && requested !== "unassigned"
                ? outlets.find((o) => String(o._id) === requested) || null
                : null;

            res.json({
                date,
                today,
                isToday: date === today,
                acceptingBookings: business.acceptingBookings,
                // Which slice this payload describes. null = the whole canteen
                // (or, for a restricted user, everything they may see).
                outletId: requested || null,
                outlet: selected ? { id: selected._id, name: selected.name, active: selected.active !== false } : null,
                outlets: outlets.map((o) => ({ id: o._id, name: o.name, active: o.active !== false })),
                byOutlet,
                services,
                totals: {
                    confirmedQuantity: services.reduce((n, s) => n + s.confirmed.totalQuantity, 0),
                    bookings: services.reduce((n, s) => n + s.confirmed.bookingCount, 0),
                    pendingRequests: services.reduce((n, s) => n + s.pending.count, 0),
                },
            });
        } catch (err) { next(err); }
    });

module.exports = router;
