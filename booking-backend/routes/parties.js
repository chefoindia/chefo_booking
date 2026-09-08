// routes/parties.js — the customer/booking-party record the operator works with.
//
// A party is persistent and phone-keyed, so "ABC Project Site" is one record
// with a history rather than a name retyped every morning. Nothing here is
// authenticated identity — see models/BookingParty.js.
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const BookingParty = require("../models/BookingParty");
const Booking = require("../models/Booking");
const { authenticate, requirePermission } = require("../middleware/authenticate");
const { normalisePhone } = require("../utils/phone");
const { record } = require("../services/audit");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));
const clean = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const meta = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] || "" });

router.get("/api/parties",
    authenticate, requirePermission("parties.view"),
    async (req, res, next) => {
        try {
            const { q, partyType, limit = "100" } = req.query;
            const filter = { businessId: req.businessId };

            if (partyType) filter.partyType = String(partyType);
            if (q && String(q).trim()) {
                const term = String(q).trim();
                const phone = normalisePhone(term);
                const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
                filter.$or = [
                    { name: rx }, { organisation: rx },
                    ...(phone ? [{ phone }] : [{ phone: rx }]),
                ];
            }

            const parties = await BookingParty.find(filter)
                // Most recently active first: the people an operator is dealing
                // with today are the ones they need at the top.
                .sort({ lastBookingAt: -1, createdAt: -1 })
                .limit(Math.min(parseInt(limit, 10) || 100, 300))
                .lean();

            res.json({ parties });
        } catch (err) { next(err); }
    });

router.get("/api/parties/:id",
    authenticate, requirePermission("parties.view"),
    async (req, res, next) => {
        try {
            if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid party." });
            const party = await BookingParty.findOne({ _id: req.params.id, businessId: req.businessId }).lean();
            if (!party) return res.status(404).json({ message: "Not found." });

            const bookings = await Booking.find({ businessId: req.businessId, partyId: party._id })
                .sort({ date: -1, createdAt: -1 }).limit(100).lean();

            // Lifetime totals, so the operator can see at a glance whether this
            // is a regular worth accommodating on a late request.
            const confirmed = bookings.filter((b) => b.status === "confirmed");
            res.json({
                party,
                bookings,
                stats: {
                    total: bookings.length,
                    confirmed: confirmed.length,
                    cancelled: bookings.filter((b) => b.status === "cancelled").length,
                    rejected: bookings.filter((b) => b.status === "rejected").length,
                    mealsConfirmed: confirmed.reduce((n, b) => n + (b.totalQuantity || 0), 0),
                },
            });
        } catch (err) { next(err); }
    });

router.patch("/api/parties/:id",
    authenticate, requirePermission("parties.edit"),
    async (req, res, next) => {
        try {
            if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid party." });
            const party = await BookingParty.findOne({ _id: req.params.id, businessId: req.businessId });
            if (!party) return res.status(404).json({ message: "Not found." });

            const b = req.body || {};
            const before = { name: party.name, phone: party.phone, organisation: party.organisation };

            if (b.name !== undefined) party.name = clean(b.name, 80) || party.name;
            if (b.organisation !== undefined) party.organisation = clean(b.organisation, 120);
            if (b.partyType !== undefined) party.partyType = clean(b.partyType, 40);
            if (b.email !== undefined) party.email = clean(b.email, 120);
            if (b.location !== undefined) party.location = clean(b.location, 200);
            if (b.internalNote !== undefined) party.internalNote = clean(b.internalNote, 400);

            // The phone is the identity key, so changing it can collide with an
            // existing party. Refused explicitly rather than left to a duplicate
            // key error, which would surface as an unexplained 409.
            if (b.phone !== undefined) {
                const phone = normalisePhone(b.phone);
                if (!phone) return res.status(400).json({ message: "Enter a valid mobile number." });
                if (phone !== party.phone) {
                    const clash = await BookingParty.findOne({
                        businessId: req.businessId, phone, _id: { $ne: party._id },
                    }).select("name").lean();
                    if (clash) {
                        return res.status(409).json({
                            message: `That number already belongs to "${clash.name}".`,
                        });
                    }
                    party.phone = phone;
                }
            }

            await party.save();
            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Updated a booking party", partyId: party._id,
                before, after: { name: party.name, phone: party.phone, organisation: party.organisation },
            });
            res.json({ party: party.toObject() });
        } catch (err) { next(err); }
    });

module.exports = router;
