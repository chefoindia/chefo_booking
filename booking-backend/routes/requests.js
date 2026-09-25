// routes/requests.js — the approval queue.
//
// The one screen this product is really about. Everything the operator needs to
// judge a late request has to be in the list itself: who, which meal, how many
// plates it moves the count by, and what the booking currently says. Making
// them open each one to find out defeats the purpose.
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const BookingRequest = require("../models/BookingRequest");
const Booking = require("../models/Booking");
const bookingService = require("../services/bookingService");
const { authenticate, requirePermission } = require("../middleware/authenticate");
const { isDateKey } = require("../utils/time");
const { normalisePhone } = require("../utils/phone");
const { scopedOutletMatch } = require("../utils/outletScope");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));
const meta = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] || "" });

/* ------------------------------------------------------------------ */
/* QUEUE                                                                */
/* ------------------------------------------------------------------ */
router.get("/api/requests",
    authenticate, requirePermission("requests.view"),
    async (req, res, next) => {
        try {
            const { status = "pending", date, from, to, mealTypeId, type, q, outletId, page = "1", limit = "50" } = req.query;

            const filter = { businessId: req.businessId };
            const om = await scopedOutletMatch(req, outletId);
            if (!om.ok) return next(om.error);
            Object.assign(filter, om.match);
            if (status && status !== "all") {
                filter.status = { $in: String(status).split(",").map((s) => s.trim()).filter(Boolean) };
            }
            if (isDateKey(date)) filter.date = date;
            else if (isDateKey(from) || isDateKey(to)) {
                filter.date = {};
                if (isDateKey(from)) filter.date.$gte = from;
                if (isDateKey(to)) filter.date.$lte = to;
            }
            if (isId(mealTypeId)) filter.mealTypeId = mealTypeId;
            if (type) filter.type = { $in: String(type).split(",").map((s) => s.trim()).filter(Boolean) };
            if (q && String(q).trim()) {
                const term = String(q).trim();
                const phone = normalisePhone(term);
                const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
                filter.$or = [{ reference: rx }, { "partySnapshot.name": rx }, { "partySnapshot.organisation": rx },
                    ...(phone ? [{ "partySnapshot.phone": phone }] : [{ "partySnapshot.phone": rx }])];
            }

            const perPage = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
            const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * perPage;

            const [rows, total] = await Promise.all([
                BookingRequest.find(filter)
                    // Pending oldest-first: somebody has been waiting on an answer,
                    // and a queue that buries the longest wait is not a queue.
                    // Resolved newest-first, because that is history.
                    .sort(filter.status?.$in?.includes("pending") ? { createdAt: 1 } : { resolvedAt: -1, createdAt: -1 })
                    .skip(skip).limit(perPage)
                    .lean(),
                BookingRequest.countDocuments(filter),
            ]);

            // The booking as it stands right now, alongside what is being asked
            // of it. For a change request these differ, and seeing both is the
            // whole basis of the decision.
            const bookings = rows.length
                ? await Booking.find({ _id: { $in: rows.map((r) => r.bookingId) } })
                    .select("reference status totalQuantity lines date mealTypeName").lean()
                : [];
            const byId = new Map(bookings.map((b) => [String(b._id), b]));

            res.json({
                requests: rows.map((r) => ({ ...r, booking: byId.get(String(r.bookingId)) || null })),
                page: Math.floor(skip / perPage) + 1, perPage, total, hasMore: skip + rows.length < total,
                pendingCount: await BookingRequest.countDocuments({
                    businessId: req.businessId, status: "pending", ...om.match,
                }),
            });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* RESOLVE                                                              */
/* ------------------------------------------------------------------ */
// The only place a pending request becomes real. All the state transitions live
// in bookingService.resolveRequest so that accepting a change here and
// accepting one anywhere else can never mean two different things.
router.post("/api/requests/:id/:decision",
    authenticate, requirePermission("requests.resolve"),
    async (req, res, next) => {
        try {
            const { id, decision } = req.params;
            if (!isId(id)) return res.status(400).json({ message: "Invalid request." });
            if (!["accept", "reject"].includes(decision)) {
                return res.status(400).json({ message: "Decision must be accept or reject." });
            }

            const { booking, request } = await bookingService.resolveRequest({
                businessId: req.businessId,
                requestId: id,
                decision,
                note: req.body?.note,
                actor: req.actor,
                outletScope: req.outletScope,
                requestMeta: meta(req),
            });

            res.json({ request, booking });
        } catch (err) { next(err); }
    });

module.exports = router;
