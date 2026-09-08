// routes/bookings.js — operator booking management.
//
// Everything here is scoped by req.businessId, which authenticate() took from
// the caller's own user record. No id in a URL, query or body can widen that,
// so a booking belonging to another business is simply not found.
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Booking = require("../models/Booking");
const BookingRequest = require("../models/BookingRequest");
const MealType = require("../models/MealType");
const MealVariant = require("../models/MealVariant");
const AuditLog = require("../models/AuditLog");
const Business = require("../models/Business");
const BookingParty = require("../models/BookingParty");

const bookingService = require("../services/bookingService");
const { confirmedTotals, orderVariants } = require("../services/quantity");
const { authenticate, requirePermission } = require("../middleware/authenticate");
const { cutoffState, isDateKey } = require("../utils/time");
const { normalisePhone } = require("../utils/phone");

const meta = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] || "" });
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));

/* ------------------------------------------------------------------ */
/* LIST                                                                 */
/* ------------------------------------------------------------------ */
router.get("/api/bookings",
    authenticate, requirePermission("bookings.view"),
    async (req, res, next) => {
        try {
            const {
                date, from, to, mealTypeId, status, partyId, partyType, q,
                page = "1", limit = "50",
            } = req.query;

            const filter = { businessId: req.businessId };

            if (isDateKey(date)) filter.date = date;
            else if (isDateKey(from) || isDateKey(to)) {
                filter.date = {};
                if (isDateKey(from)) filter.date.$gte = from;
                if (isDateKey(to)) filter.date.$lte = to;
            }
            if (isId(mealTypeId)) filter.mealTypeId = mealTypeId;
            if (isId(partyId)) filter.partyId = partyId;
            if (status) {
                const wanted = String(status).split(",").map((s) => s.trim()).filter(Boolean);
                if (wanted.length) filter.status = { $in: wanted };
            }
            if (partyType) filter["partySnapshot.partyType"] = String(partyType);

            // Search covers the three things an operator actually has in hand
            // when someone calls: a reference, a name, or a phone number.
            if (q && String(q).trim()) {
                const term = String(q).trim();
                const phone = normalisePhone(term);
                const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
                filter.$or = [
                    { reference: rx },
                    { "partySnapshot.name": rx },
                    { "partySnapshot.organisation": rx },
                    ...(phone ? [{ "partySnapshot.phone": phone }] : [{ "partySnapshot.phone": rx }]),
                ];
            }

            const perPage = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
            const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * perPage;

            const [rows, total] = await Promise.all([
                Booking.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(perPage).lean(),
                Booking.countDocuments(filter),
            ]);

            // Which bookings still have something awaiting a decision — the
            // operator needs that visible in the list, not one click away.
            const openIds = rows.length
                ? await BookingRequest.find({
                    bookingId: { $in: rows.map((r) => r._id) }, status: "pending",
                }).select("bookingId type").lean()
                : [];
            const openBy = new Map(openIds.map((r) => [String(r.bookingId), r.type]));

            res.json({
                bookings: rows.map((b) => ({ ...b, openRequestType: openBy.get(String(b._id)) || null })),
                page: Math.floor(skip / perPage) + 1,
                perPage,
                total,
                hasMore: skip + rows.length < total,
            });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* DETAIL — with full request history                                   */
/* ------------------------------------------------------------------ */
router.get("/api/bookings/:id",
    authenticate, requirePermission("bookings.view"),
    async (req, res, next) => {
        try {
            if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid booking." });

            const booking = await Booking.findOne({ _id: req.params.id, businessId: req.businessId }).lean();
            if (!booking) return res.status(404).json({ message: "Booking not found." });

            const [requests, mealType, business, party, audit] = await Promise.all([
                BookingRequest.find({ bookingId: booking._id }).sort({ createdAt: -1 }).lean(),
                MealType.findById(booking.mealTypeId).lean(),
                Business.findById(req.businessId).select("timezoneOffsetMinutes rules").lean(),
                BookingParty.findById(booking.partyId).lean(),
                AuditLog.find({ bookingId: booking._id }).sort({ createdAt: -1 }).limit(50).lean(),
            ]);

            const c = cutoffState(mealType, booking.date, {
                offsetMinutes: business?.timezoneOffsetMinutes ?? 330,
            });

            res.json({
                booking,
                party,
                requests,
                audit,
                cutoff: c,
                // The operator can always act — after cutoff their edit IS the
                // decision, so they are never sent through an approval queue to
                // approve themselves.
                canEditDirectly: !["cancelled", "rejected"].includes(booking.status),
            });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* CREATE (counter booking)                                             */
/* ------------------------------------------------------------------ */
// source: "operator" confirms immediately whatever the clock says. The person
// who would resolve the approval request is the one entering it.
router.post("/api/bookings",
    authenticate, requirePermission("bookings.create"),
    async (req, res, next) => {
        try {
            const { mealTypeId, date, quantities, party, customerNote, location } = req.body || {};
            const { booking, cutoff } = await bookingService.createBooking({
                businessId: req.businessId,
                mealTypeId, date, quantities,
                party: party || {},
                customerNote, location,
                source: "operator",
                actor: req.actor,
                requestMeta: meta(req),
            });
            res.status(201).json({ booking, cutoff });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* EDIT / CANCEL                                                        */
/* ------------------------------------------------------------------ */
router.patch("/api/bookings/:id",
    authenticate, requirePermission("bookings.edit"),
    async (req, res, next) => {
        try {
            const { booking } = await bookingService.changeBooking({
                businessId: req.businessId,
                bookingId: req.params.id,
                quantities: req.body?.quantities,
                customerNote: req.body?.note,
                actor: req.actor,
                byOperator: true,
                requestMeta: meta(req),
            });
            res.json({ booking });
        } catch (err) { next(err); }
    });

router.post("/api/bookings/:id/cancel",
    authenticate, requirePermission("bookings.cancel"),
    async (req, res, next) => {
        try {
            const { booking } = await bookingService.cancelBooking({
                businessId: req.businessId,
                bookingId: req.params.id,
                reason: req.body?.reason,
                actor: req.actor,
                byOperator: true,
                requestMeta: meta(req),
            });
            res.json({ booking });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* KITCHEN SHEET                                                        */
/* ------------------------------------------------------------------ */
// One meal, one date: the totals to cook and the list to serve against. The
// totals come from services/quantity.js — the same function the dashboard uses,
// so the two can never disagree about the number.
router.get("/api/bookings/service/:mealTypeId/:date",
    authenticate, requirePermission("bookings.view"),
    async (req, res, next) => {
        try {
            const { mealTypeId, date } = req.params;
            if (!isId(mealTypeId) || !isDateKey(date)) {
                return res.status(400).json({ message: "Invalid meal service or date." });
            }

            const mealType = await MealType.findOne({ _id: mealTypeId, businessId: req.businessId }).lean();
            if (!mealType) return res.status(404).json({ message: "Meal service not found." });

            const [totals, variants, bookings, pendingRequests, business] = await Promise.all([
                confirmedTotals({ businessId: req.businessId, date, mealTypeId }),
                MealVariant.find({ businessId: req.businessId }).sort({ sortOrder: 1, name: 1 }).lean(),
                Booking.find({ businessId: req.businessId, date, mealTypeId })
                    .sort({ "partySnapshot.name": 1 }).lean(),
                BookingRequest.find({ businessId: req.businessId, date, mealTypeId, status: "pending" }).lean(),
                Business.findById(req.businessId).select("timezoneOffsetMinutes").lean(),
            ]);

            const relevant = variants.filter(
                (v) => !v.mealTypeIds?.length || v.mealTypeIds.some((id) => String(id) === String(mealTypeId))
            );

            res.json({
                mealType,
                date,
                cutoff: cutoffState(mealType, date, { offsetMinutes: business?.timezoneOffsetMinutes ?? 330 }),
                confirmed: {
                    byVariant: orderVariants(totals.byVariant, relevant),
                    totalQuantity: totals.totalQuantity,
                    bookingCount: totals.bookingCount,
                },
                bookings,
                pendingRequests,
            });
        } catch (err) { next(err); }
    });

module.exports = router;
