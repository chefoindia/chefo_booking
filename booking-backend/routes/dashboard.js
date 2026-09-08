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
const { authenticate, requirePermission } = require("../middleware/authenticate");
const {
    confirmedTotalsByMeal, pendingSummaryByMeal, lateAcceptedByMeal, orderVariants,
} = require("../services/quantity");
const { cutoffState, todayKey, isDateKey } = require("../utils/time");

router.get("/api/dashboard/today",
    authenticate, requirePermission("dashboard.view"),
    async (req, res, next) => {
        try {
            const business = await Business.findById(req.businessId)
                .select("timezoneOffsetMinutes acceptingBookings name").lean();
            const tz = business.timezoneOffsetMinutes ?? 330;
            const today = todayKey(tz);
            const date = isDateKey(req.query.date) ? req.query.date : today;

            const [mealTypes, variants, confirmed, pending, late] = await Promise.all([
                MealType.find({ businessId: req.businessId, active: true })
                    .sort({ sortOrder: 1, name: 1 }).lean(),
                MealVariant.find({ businessId: req.businessId })
                    .sort({ sortOrder: 1, name: 1 }).lean(),
                confirmedTotalsByMeal({ businessId: req.businessId, date }),
                pendingSummaryByMeal({ businessId: req.businessId, date }),
                lateAcceptedByMeal({ businessId: req.businessId, date }),
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

            res.json({
                date,
                today,
                isToday: date === today,
                acceptingBookings: business.acceptingBookings,
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
