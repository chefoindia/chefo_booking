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
const { notify, CONCERN } = require("../services/notify");
const { sendCsv } = require("../utils/csv");
const { scopedOutletMatch } = require("../utils/outletScope");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));
const clean = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const meta = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] || "" });

router.get("/api/parties",
    authenticate, requirePermission("parties.view"),
    async (req, res, next) => {
        try {
            const { q, partyType, sort = "recent", page = "1", limit = "50" } = req.query;
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

            // Most recently active first by default: the people an operator is
            // dealing with today are the ones they need at the top.
            const order = { recent: { lastBookingAt: -1, createdAt: -1 }, name: { name: 1 }, bookings: { bookingCount: -1, name: 1 } }[sort]
                || { lastBookingAt: -1, createdAt: -1 };
            const perPage = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
            const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * perPage;

            const [parties, total] = await Promise.all([
                BookingParty.find(filter).sort(order).skip(skip).limit(perPage).lean(),
                BookingParty.countDocuments(filter),
            ]);

            res.json({ parties, page: Math.floor(skip / perPage) + 1, perPage, total, hasMore: skip + parties.length < total });
        } catch (err) { next(err); }
    });

/** The customer list as a spreadsheet — personal data, so it is logged and noticed. */
router.get("/api/parties/export.csv",
    authenticate, requirePermission("parties.view"),
    async (req, res, next) => {
        try {
            const parties = await BookingParty.find({ businessId: req.businessId }).sort({ name: 1 }).limit(10000).lean();
            const csv = [["Name", "Mobile", "Organisation", "Type", "Email", "Location", "Bookings", "Last booking (IST)", "Internal note"]];
            for (const p of parties) {
                csv.push([p.name, p.phone, p.organisation, p.partyType, p.email, p.location, p.bookingCount || 0,
                    p.lastBookingAt ? new Date(p.lastBookingAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) : "", p.internalNote]);
            }
            record({ businessId: req.businessId, actor: req.actor, requestMeta: meta(req), action: "Exported the customer list", details: { rows: parties.length } });
            notify("data.export", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: "Customer list exported", summary: "The full customer list, including mobile numbers, was downloaded as a CSV file.",
                rows: [{ label: "Customers", value: String(parties.length) }], concern: CONCERN.data,
            });
            sendCsv(res, `customers-${new Date().toISOString().slice(0, 10)}`, csv);
        } catch (err) { next(err); }
    });

router.get("/api/parties/:id",
    authenticate, requirePermission("parties.view"),
    async (req, res, next) => {
        try {
            if (!isId(req.params.id)) return res.status(400).json({ message: "Invalid party." });
            const party = await BookingParty.findOne({ _id: req.params.id, businessId: req.businessId }).lean();
            if (!party) return res.status(404).json({ message: "Not found." });

            // The party record is the business's; the bookings shown under it
            // are only the ones this user's outlet scope (and the selector)
            // allow, so a Block A operator never reads Block B history here.
            const om = await scopedOutletMatch(req, req.query.outletId);
            if (!om.ok) return next(om.error);
            const bookings = await Booking.find({ businessId: req.businessId, partyId: party._id, ...om.match })
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
