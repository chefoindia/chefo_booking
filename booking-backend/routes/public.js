// routes/public.js — THE CUSTOMER SIDE. No authentication, by design.
//
// This is the separable layer. When Chefo eventually builds one common customer
// platform across Subscription, Cafeteria, Canteen and Booking, THIS is the
// surface it replaces — so it deliberately shares nothing with the operator API
// beyond the domain service, exposes no operator concepts, and identifies a
// business by public slug rather than by any id the dashboard uses.
//
// WHAT IT REFUSES TO LEAK. A booking is addressed by its reference plus the
// phone number that booked it. Neither alone is enough. Without that pairing,
// sequential references (BK-1001, BK-1002...) would let anyone read every
// booking a canteen has ever taken.
const express = require("express");
const router = express.Router();

const Business = require("../models/Business");
const MealType = require("../models/MealType");
const MealVariant = require("../models/MealVariant");
const Booking = require("../models/Booking");
const BookingParty = require("../models/BookingParty");
const BookingRequest = require("../models/BookingRequest");

const bookingService = require("../services/bookingService");
const { cutoffState, todayKey, shiftDateKey, isDateKey } = require("../utils/time");
const { normalisePhone } = require("../utils/phone");
const { publicWriteLimiter, lookupLimiter } = require("../middleware/rateLimiters");

const meta = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] || "" });

async function loadBusiness(slug) {
    const business = await Business.findOne({ slug: String(slug || "").toLowerCase() }).lean();
    if (!business) {
        const e = new Error("We couldn't find that canteen.");
        e.status = 404;
        throw e;
    }
    return business;
}

/* ------------------------------------------------------------------ */
/* What can I book?                                                     */
/* ------------------------------------------------------------------ */
/**
 * Everything the booking form needs for one business on one date, in a single
 * request: meal services, their variants, and — importantly — the cutoff state
 * of each meal RIGHT NOW.
 *
 * The form shows "this will need the canteen's approval" before the customer
 * types anything, rather than surprising them after they submit. The server
 * decides that; the client only renders it.
 */
router.get("/api/public/business/:slug", async (req, res, next) => {
    try {
        const business = await loadBusiness(req.params.slug);
        const tz = business.timezoneOffsetMinutes ?? 330;
        const today = todayKey(tz);
        const date = isDateKey(req.query.date) ? req.query.date : today;

        const [mealTypes, variants] = await Promise.all([
            MealType.find({ businessId: business._id, active: true, customerBookable: true })
                .sort({ sortOrder: 1, name: 1 }).lean(),
            MealVariant.find({ businessId: business._id, active: true })
                .sort({ sortOrder: 1, name: 1 }).lean(),
        ]);

        const now = new Date();
        res.json({
            business: {
                name: business.name,
                slug: business.slug,
                logoUrl: business.logoUrl,
                contactPhone: business.contactPhone,
                addressLine: business.addressLine,
                city: business.city,
                acceptingBookings: business.acceptingBookings,
                closedMessage: business.closedMessage,
                partyTypes: (business.partyTypes || []).filter((p) => p.active),
                rules: {
                    maxDaysAhead: business.rules?.maxDaysAhead ?? 14,
                    maxQuantityPerBooking: business.rules?.maxQuantityPerBooking ?? 500,
                    requireOrganisation: Boolean(business.rules?.requireOrganisation),
                    requireLocation: Boolean(business.rules?.requireLocation),
                    requireNote: Boolean(business.rules?.requireNote),
                },
            },
            date,
            today,
            maxDate: shiftDateKey(today, business.rules?.maxDaysAhead ?? 14),
            mealTypes: mealTypes.map((m) => {
                const c = cutoffState(m, date, { now, offsetMinutes: tz });
                return {
                    id: m._id,
                    key: m.key,
                    name: m.name,
                    startTime: m.startTime,
                    endTime: m.endTime,
                    cutoffTime: m.cutoffTime,
                    cutoffPreviousDay: m.cutoffPreviousDay,
                    // The whole point: tells the customer whether this booking
                    // is instant or needs approval, before they fill anything in.
                    cutoffPassed: c.passed,
                    hasCutoff: c.hasCutoff,
                    cutoffAt: c.cutoffAt,
                    // A variant restricted to certain meals only appears on those.
                    variants: variants
                        .filter((v) => !v.mealTypeIds?.length
                            || v.mealTypeIds.some((id) => String(id) === String(m._id)))
                        .map((v) => ({
                            id: v._id, key: v.key, name: v.name,
                            price: v.price, description: v.description,
                        })),
                };
            }),
        });
    } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* Book                                                                 */
/* ------------------------------------------------------------------ */
router.post("/api/public/business/:slug/bookings", publicWriteLimiter, async (req, res, next) => {
    try {
        const business = await loadBusiness(req.params.slug);
        const { mealTypeId, date, quantities, party, customerNote, location } = req.body || {};

        const { booking, request, cutoff } = await bookingService.createBooking({
            businessId: business._id,
            mealTypeId, date, quantities,
            party: party || {},
            customerNote, location,
            source: "customer",
            requestMeta: meta(req),
        });

        res.status(201).json({
            booking: shapeForCustomer(booking),
            // The customer is told plainly which of the two things happened,
            // and why, rather than being left to infer it from a status word.
            outcome: booking.status === "pending_approval" ? "pending_approval" : "confirmed",
            cutoff: { hasCutoff: cutoff.hasCutoff, passed: cutoff.passed, cutoffAt: cutoff.cutoffAt },
            requestReference: request?.reference || null,
        });
    } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* My bookings                                                          */
/* ------------------------------------------------------------------ */
/**
 * The status experience, in place of accounts and notifications.
 *
 * Enter your phone number, see your bookings. Nothing is verified, which is the
 * accepted V1 tradeoff — so this returns only what the person who made the
 * booking already knows, and no operator notes. Rate limited to make walking
 * through numbers slow.
 */
router.post("/api/public/business/:slug/lookup", lookupLimiter, async (req, res, next) => {
    try {
        const business = await loadBusiness(req.params.slug);
        const phone = normalisePhone(req.body?.phone);
        if (!phone) return res.status(400).json({ message: "Enter a valid mobile number." });

        const party = await BookingParty.findOne({ businessId: business._id, phone }).lean();
        // No party is not an error — it is "you have no bookings here yet", and
        // saying so plainly avoids confirming which numbers exist.
        if (!party) return res.json({ party: null, bookings: [] });

        const bookings = await Booking.find({ businessId: business._id, partyId: party._id })
            .sort({ date: -1, createdAt: -1 }).limit(50).lean();

        const requests = await BookingRequest.find({
            bookingId: { $in: bookings.map((b) => b._id) },
        }).sort({ createdAt: -1 }).lean();

        const byBooking = new Map();
        for (const r of requests) {
            const k = String(r.bookingId);
            if (!byBooking.has(k)) byBooking.set(k, []);
            byBooking.get(k).push(r);
        }

        const mealTypes = await MealType.find({ businessId: business._id }).lean();
        const mealById = new Map(mealTypes.map((m) => [String(m._id), m]));
        const now = new Date();
        const tz = business.timezoneOffsetMinutes ?? 330;

        res.json({
            party: { name: party.name, phone: party.phone, organisation: party.organisation },
            bookings: bookings.map((b) => {
                const c = cutoffState(mealById.get(String(b.mealTypeId)), b.date, { now, offsetMinutes: tz });
                const reqs = byBooking.get(String(b._id)) || [];
                const openRequest = reqs.find((r) => r.status === "pending") || null;
                return {
                    ...shapeForCustomer(b),
                    cutoffPassed: c.passed,
                    // What the customer may still do, decided by the SERVER.
                    // The client renders these; it never works them out itself,
                    // or the two would drift.
                    canEdit: canCustomerAct(b, business, c, "edit"),
                    canCancel: canCustomerAct(b, business, c, "cancel"),
                    openRequest: openRequest && {
                        reference: openRequest.reference,
                        type: openRequest.type,
                        status: openRequest.status,
                        requestedTotal: openRequest.requestedTotal,
                        quantityDelta: openRequest.quantityDelta,
                        createdAt: openRequest.createdAt,
                    },
                    requestHistory: reqs.filter((r) => r.status !== "pending").map((r) => ({
                        reference: r.reference, type: r.type, status: r.status,
                        quantityDelta: r.quantityDelta, resolvedAt: r.resolvedAt,
                        // The operator's reason, when they gave one — the
                        // closest thing V1 has to telling a customer why.
                        note: r.resolutionNote || "",
                    })),
                };
            }),
        });
    } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* Change / cancel my own booking                                       */
/* ------------------------------------------------------------------ */
// The phone number that made the booking must be supplied to act on it. Without
// it, a guessed reference would be enough to cancel a stranger's lunch.
async function assertOwnership(req, business) {
    const phone = normalisePhone(req.body?.phone);
    if (!phone) {
        const e = new Error("Enter the mobile number used for this booking.");
        e.status = 400;
        throw e;
    }
    const booking = await Booking.findOne({ _id: req.params.bookingId, businessId: business._id });
    if (!booking) {
        const e = new Error("Booking not found.");
        e.status = 404;
        throw e;
    }
    // Same 404 as a genuinely missing booking, so a wrong phone number does not
    // reveal that the reference is real.
    if (booking.partySnapshot?.phone !== phone) {
        const e = new Error("Booking not found.");
        e.status = 404;
        throw e;
    }
    return booking;
}

router.post("/api/public/business/:slug/bookings/:bookingId/change",
    publicWriteLimiter, async (req, res, next) => {
        try {
            const business = await loadBusiness(req.params.slug);
            await assertOwnership(req, business);

            const { booking, request, applied } = await bookingService.changeBooking({
                businessId: business._id,
                bookingId: req.params.bookingId,
                quantities: req.body?.quantities,
                customerNote: req.body?.note,
                requestMeta: meta(req),
            });

            res.json({
                booking: shapeForCustomer(booking),
                applied,
                outcome: applied ? "updated" : "change_requested",
                requestReference: request?.reference || null,
            });
        } catch (err) { next(err); }
    });

router.post("/api/public/business/:slug/bookings/:bookingId/cancel",
    publicWriteLimiter, async (req, res, next) => {
        try {
            const business = await loadBusiness(req.params.slug);
            await assertOwnership(req, business);

            const { booking, request, applied } = await bookingService.cancelBooking({
                businessId: business._id,
                bookingId: req.params.bookingId,
                reason: req.body?.reason,
                requestMeta: meta(req),
            });

            res.json({
                booking: shapeForCustomer(booking),
                applied,
                outcome: applied ? "cancelled" : "cancellation_requested",
                requestReference: request?.reference || null,
            });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* Shaping                                                              */
/* ------------------------------------------------------------------ */
// Explicitly built rather than returned wholesale: internal notes, audit
// fields and operator-only flags must never reach the customer app just because
// somebody later adds a column to the schema.
function shapeForCustomer(b) {
    return {
        id: b._id,
        reference: b.reference,
        date: b.date,
        mealTypeId: b.mealTypeId,
        mealTypeName: b.mealTypeName,
        status: b.status,
        lines: (b.lines || []).map((l) => ({
            variantId: l.variantId, variantName: l.variantName, quantity: l.quantity,
        })),
        totalQuantity: b.totalQuantity,
        totalAmount: b.totalAmount,
        submittedAfterCutoff: b.submittedAfterCutoff,
        customerNote: b.customerNote,
        createdAt: b.createdAt,
    };
}

/** Server-side answer to "what can this customer still do with this booking?" */
function canCustomerAct(booking, business, cutoff, action) {
    if (["cancelled", "rejected"].includes(booking.status)) return false;
    const r = business.rules || {};
    if (action === "edit") {
        return cutoff.passed
            ? r.allowCustomerChangeRequestAfterCutoff !== false
            : r.allowCustomerEditBeforeCutoff !== false;
    }
    return cutoff.passed
        ? r.allowCustomerCancelRequestAfterCutoff !== false
        : r.allowCustomerCancelBeforeCutoff !== false;
}

module.exports = router;
