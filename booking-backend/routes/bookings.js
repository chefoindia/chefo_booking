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
const { consumeBooking, unconsumeBooking } = require("../services/consumption");
const { authenticate, requirePermission } = require("../middleware/authenticate");
const { cutoffState, isDateKey } = require("../utils/time");
const { normalisePhone } = require("../utils/phone");
const { notify } = require("../services/notify");

const meta = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] || "" });
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));

// A ticket is a 22-character base64url string. The shape is checked before the
// query purely to keep obvious junk out of the index; anything that does not
// match is answered with the same NO_TICKET 404 as an unknown one, so a scanner
// pointed at the wrong barcode gets one consistent answer.
const TICKET_RE = /^[A-Za-z0-9_-]{16,64}$/;

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
/**
 * The detail payload, built once.
 *
 * Two routes reach a booking — by id from the list, and by ticket from the
 * scanner — and the scanner's screen IS the detail screen. If the two produced
 * even slightly different shapes the dashboard would need two renderers for one
 * thing, so both call this.
 */
async function detailPayload(businessId, booking) {
    const [requests, mealType, business, party, audit] = await Promise.all([
        BookingRequest.find({ bookingId: booking._id }).sort({ createdAt: -1 }).lean(),
        MealType.findById(booking.mealTypeId).lean(),
        Business.findById(businessId).select("timezoneOffsetMinutes rules").lean(),
        BookingParty.findById(booking.partyId).lean(),
        AuditLog.find({ bookingId: booking._id }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);

    const c = cutoffState(mealType, booking.date, {
        offsetMinutes: business?.timezoneOffsetMinutes ?? 330,
    });

    return {
        booking,
        party,
        requests,
        audit,
        cutoff: c,
        // The operator can always act — after cutoff their edit IS the
        // decision, so they are never sent through an approval queue to
        // approve themselves.
        canEditDirectly: !["cancelled", "rejected"].includes(booking.status),
    };
}

/* ------------------------------------------------------------------ */
/* DETAIL BY TICKET — what the scanner lands on                         */
/* ------------------------------------------------------------------ */
// REGISTERED ABOVE /api/bookings/:id DELIBERATELY. Express matches in
// registration order, and although ":id" is a single segment today, putting
// this second is one careless path edit away from ":id" swallowing "by-ticket"
// and answering every scan with "Invalid booking."
router.get("/api/bookings/by-ticket/:ticket",
    authenticate, requirePermission("bookings.view"),
    async (req, res, next) => {
        try {
            const ticket = String(req.params.ticket || "");
            const booking = TICKET_RE.test(ticket)
                ? await Booking.findOne({ ticket, businessId: req.businessId }).lean()
                : null;
            // A ticket from ANOTHER business is a miss here, not a leak: the
            // query is scoped by req.businessId, so scanning a rival canteen's
            // QR code reads exactly like scanning a made-up one.
            if (!booking) {
                return res.status(404).json({ message: "That ticket doesn't match a booking here.", code: "NO_TICKET" });
            }
            res.json(await detailPayload(req.businessId, booking));
        } catch (err) { next(err); }
    });

router.get("/api/bookings/:id",
    authenticate, requirePermission("bookings.view"),
    async (req, res, next) => {
        try {
            if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid booking." });

            const booking = await Booking.findOne({ _id: req.params.id, businessId: req.businessId }).lean();
            if (!booking) return res.status(404).json({ message: "Booking not found." });

            res.json(await detailPayload(req.businessId, booking));
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
            const { mealTypeId, date, quantities, party, customerNote, location, answers } = req.body || {};
            const { booking, cutoff } = await bookingService.createBooking({
                businessId: req.businessId,
                mealTypeId, date, quantities,
                party: party || {},
                customerNote,
                // The counter records the same business-defined answers the public
                // form collects; only the REQUIRED rule is relaxed for operators.
                answers, location,
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
            notify("bookings.cancelled", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: "Booking cancelled by staff",
                summary: `Booking ${booking.reference} was cancelled from the dashboard and its meals left the preparation count.`,
                rows: [
                    { label: "Reference", value: booking.reference },
                    { label: "Customer", value: booking.partySnapshot?.name || "" },
                    { label: "Meal", value: `${booking.mealTypeName} · ${booking.date}` },
                    { label: "Meals removed", value: String(booking.totalQuantity) },
                    { label: "Reason", value: String(req.body?.reason || "—") },
                ],
            });
            res.json({ booking });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* SERVED / NOT SERVED                                                  */
/* ------------------------------------------------------------------ */
// Thin on purpose. Every rule about which bookings may be served, and what a
// second scan of the same ticket means, lives in services/consumption.js so the
// scanner and the manual button can never diverge. These two handlers only
// carry the request in and the booking back out.
router.post("/api/bookings/:id/consume",
    authenticate, requirePermission("bookings.consume"),
    async (req, res, next) => {
        try {
            if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid booking." });
            const { booking } = await consumeBooking({
                businessId: req.businessId,
                bookingId: req.params.id,
                via: req.body?.via,
                note: req.body?.note,
                actor: req.actor,
                requestMeta: meta(req),
            });
            res.json({ booking });
        } catch (err) { next(err); }
    });

router.post("/api/bookings/:id/unconsume",
    authenticate, requirePermission("bookings.consume"),
    async (req, res, next) => {
        try {
            if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid booking." });
            const { booking } = await unconsumeBooking({
                businessId: req.businessId,
                bookingId: req.params.id,
                note: req.body?.note,
                actor: req.actor,
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
