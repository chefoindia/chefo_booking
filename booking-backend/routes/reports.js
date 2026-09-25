// routes/reports.js — what the kitchen prints and what the office downloads.
//
//   /api/reports/day           one date, every meal service: totals + the list
//   /api/reports/summary       a date range, per day per meal: totals only
//   /api/reports/bookings.csv  the bookings themselves, filtered, one per row
//   /api/reports/day.csv       the day sheet, flattened
//
// Totals always come from services/quantity.js — the same function the
// dashboard uses — so a printed sheet can never disagree with the screen.
// PDFs are laid out client-side (jsPDF) from these JSON payloads; the CSVs
// are produced here because a spreadsheet must be identical wherever it is
// opened.
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Booking = require("../models/Booking");
const BookingRequest = require("../models/BookingRequest");
const MealType = require("../models/MealType");
const MealVariant = require("../models/MealVariant");
const Business = require("../models/Business");
const { authenticate, requirePermission } = require("../middleware/authenticate");
const { confirmedTotalsByMeal, orderVariants } = require("../services/quantity");
const { cutoffState, isDateKey, shiftDateKey, todayKey, formatDateKey } = require("../utils/time");
const { record } = require("../services/audit");
const { notify, CONCERN } = require("../services/notify");
const { normalisePhone } = require("../utils/phone");
const { sendCsv } = require("../utils/csv");
const { scopedOutletMatch, outletSelection } = require("../utils/outletScope");
const Outlet = require("../models/Outlet");

// The outlet a report describes, for its heading — null for the whole canteen.
async function outletHeading(req, requested) {
    const r = String(requested || "").trim();
    if (!r || r === "unassigned") return r === "unassigned" ? { id: null, name: "Unassigned (before outlets)" } : null;
    const o = await Outlet.findOne({ _id: r, businessId: req.businessId }).select("name").lean();
    return o ? { id: o._id, name: o.name } : null;
}

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));
const meta = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] || "" });
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MAX_RANGE_DAYS = 92;

function rangeOf(req, tz) {
    const today = todayKey(tz);
    const from = isDateKey(req.query.from) ? req.query.from : today;
    const to = isDateKey(req.query.to) ? req.query.to : from;
    if (to < from) return { error: "The end date is before the start date." };
    // Days between, inclusive.
    const days = Math.round((Date.UTC(...to.split("-").map(Number).map((n, i) => (i === 1 ? n - 1 : n))) -
        Date.UTC(...from.split("-").map(Number).map((n, i) => (i === 1 ? n - 1 : n)))) / 86400000) + 1;
    if (days > MAX_RANGE_DAYS) return { error: `Pick a range of ${MAX_RANGE_DAYS} days or fewer.` };
    return { from, to, days };
}

const logExport = (req, what, details, summary) => {
    record({ businessId: req.businessId, actor: req.actor, requestMeta: meta(req), action: `Exported ${what}`, details });
    notify("data.export", {
        businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
        title: "Report exported", summary, concern: CONCERN.data,
        rows: Object.entries(details).map(([k, v]) => ({ label: k, value: String(v) })),
    });
};

/* ------------------------------------------------------------------ */
/* ONE DAY — the kitchen sheet for every service                        */
/* ------------------------------------------------------------------ */
router.get("/api/reports/day",
    authenticate, requirePermission("reports.view"),
    async (req, res, next) => {
        try {
            const business = await Business.findById(req.businessId).select("name timezoneOffsetMinutes addressLine city contactPhone").lean();
            const tz = business.timezoneOffsetMinutes ?? 330;
            const date = isDateKey(req.query.date) ? req.query.date : todayKey(tz);

            const om = await scopedOutletMatch(req, req.query.outletId);
            if (!om.ok) return next(om.error);
            const outlet = outletSelection(req.outletScope, req.query.outletId);

            const [mealTypes, variants, confirmed, bookings, pending, outletInfo] = await Promise.all([
                MealType.find({ businessId: req.businessId }).sort({ sortOrder: 1, name: 1 }).lean(),
                MealVariant.find({ businessId: req.businessId }).sort({ sortOrder: 1, name: 1 }).lean(),
                confirmedTotalsByMeal({ businessId: req.businessId, date, outlet }),
                Booking.find({ businessId: req.businessId, date, ...om.match }).sort({ mealTypeId: 1, "partySnapshot.name": 1 }).lean(),
                BookingRequest.find({ businessId: req.businessId, date, status: "pending", ...om.match }).lean(),
                outletHeading(req, req.query.outletId),
            ]);

            const now = new Date();
            const services = mealTypes.map((m) => {
                const key = String(m._id);
                const conf = confirmed.get(key) || { byVariant: {}, totalQuantity: 0, bookingCount: 0 };
                const relevant = variants.filter((v) => !v.mealTypeIds?.length || v.mealTypeIds.some((id) => String(id) === key));
                const mine = bookings.filter((b) => String(b.mealTypeId) === key);
                return {
                    mealTypeId: m._id, name: m.name, startTime: m.startTime, endTime: m.endTime,
                    cutoff: cutoffState(m, date, { now, offsetMinutes: tz }),
                    confirmed: { byVariant: orderVariants(conf.byVariant, relevant), totalQuantity: conf.totalQuantity, bookingCount: conf.bookingCount },
                    pendingCount: pending.filter((r) => String(r.mealTypeId) === key).length,
                    amount: mine.filter((b) => b.status === "confirmed").reduce((n, b) => n + (b.totalAmount || 0), 0),
                    bookings: mine,
                };
            }).filter((s) => s.bookings.length || s.confirmed.totalQuantity || mealTypes.find((m) => String(m._id) === String(s.mealTypeId))?.active);

            res.json({
                business: { name: business.name, addressLine: business.addressLine, city: business.city, contactPhone: business.contactPhone },
                outlet: outletInfo,
                date, dateLabel: formatDateKey(date), generatedAt: now,
                services,
                totals: {
                    confirmedQuantity: services.reduce((n, s) => n + s.confirmed.totalQuantity, 0),
                    bookings: services.reduce((n, s) => n + s.confirmed.bookingCount, 0),
                    pending: pending.length,
                    amount: services.reduce((n, s) => n + s.amount, 0),
                },
            });
        } catch (err) { next(err); }
    });

router.get("/api/reports/day.csv",
    authenticate, requirePermission("reports.export"),
    async (req, res, next) => {
        try {
            const business = await Business.findById(req.businessId).select("timezoneOffsetMinutes").lean();
            const tz = business.timezoneOffsetMinutes ?? 330;
            const date = isDateKey(req.query.date) ? req.query.date : todayKey(tz);
            const om = await scopedOutletMatch(req, req.query.outletId);
            if (!om.ok) return next(om.error);
            const [mealTypes, variants, bookings] = await Promise.all([
                MealType.find({ businessId: req.businessId }).sort({ sortOrder: 1 }).lean(),
                MealVariant.find({ businessId: req.businessId }).sort({ sortOrder: 1 }).lean(),
                Booking.find({ businessId: req.businessId, date, ...om.match }).sort({ outletName: 1, mealTypeId: 1, status: 1, "partySnapshot.name": 1 }).lean(),
            ]);
            const mealName = new Map(mealTypes.map((m) => [String(m._id), m.name]));
            const csv = [["Date", "Outlet", "Meal service", "Reference", "Customer", "Mobile", "Organisation", "Type",
                ...variants.map((v) => v.name), "Total meals", "Amount (₹)", "Status", "Source", "After cutoff", "Note", "Booked at (IST)"]];
            for (const b of bookings) {
                const qty = Object.fromEntries((b.lines || []).map((l) => [String(l.variantId), l.quantity]));
                csv.push([
                    b.date, b.outletName || "", mealName.get(String(b.mealTypeId)) || b.mealTypeName, b.reference,
                    b.partySnapshot?.name, b.partySnapshot?.phone, b.partySnapshot?.organisation, b.partySnapshot?.partyType,
                    ...variants.map((v) => qty[String(v._id)] || 0),
                    b.totalQuantity, b.totalAmount || 0, b.status, b.source, b.submittedAfterCutoff ? "yes" : "no",
                    b.customerNote, new Date(b.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }),
                ]);
            }
            logExport(req, "the day sheet", { Date: date, Rows: bookings.length, Format: "CSV" }, `The booking sheet for ${formatDateKey(date)} was downloaded as CSV.`);
            sendCsv(res, `bookings-${date}`, csv);
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* A RANGE — per day, per meal, totals only                             */
/* ------------------------------------------------------------------ */
router.get("/api/reports/summary",
    authenticate, requirePermission("reports.view"),
    async (req, res, next) => {
        try {
            const business = await Business.findById(req.businessId).select("name timezoneOffsetMinutes").lean();
            const tz = business.timezoneOffsetMinutes ?? 330;
            const r = rangeOf(req, tz);
            if (r.error) return res.status(400).json({ message: r.error });

            const om = await scopedOutletMatch(req, req.query.outletId);
            if (!om.ok) return next(om.error);

            const [mealTypes, variants, rows, pendingRows, outletInfo] = await Promise.all([
                MealType.find({ businessId: req.businessId }).sort({ sortOrder: 1 }).lean(),
                MealVariant.find({ businessId: req.businessId }).sort({ sortOrder: 1 }).lean(),
                Booking.aggregate([
                    { $match: { businessId: oid(req.businessId), date: { $gte: r.from, $lte: r.to }, status: "confirmed", ...om.match } },
                    { $unwind: "$lines" },
                    {
                        $group: {
                            _id: { date: "$date", mealTypeId: "$mealTypeId", variantId: "$lines.variantId" },
                            variantName: { $first: "$lines.variantName" },
                            quantity: { $sum: "$lines.quantity" },
                            amount: { $sum: { $multiply: ["$lines.quantity", { $ifNull: ["$lines.unitPrice", 0] }] } },
                            bookings: { $addToSet: "$_id" },
                        },
                    },
                ]),
                BookingRequest.aggregate([
                    { $match: { businessId: oid(req.businessId), date: { $gte: r.from, $lte: r.to }, ...om.match } },
                    { $group: { _id: { date: "$date", mealTypeId: "$mealTypeId", status: "$status" }, n: { $sum: 1 } } },
                ]),
                outletHeading(req, req.query.outletId),
            ]);

            // date -> mealTypeId -> { byVariant, totalQuantity, amount, bookings:Set }
            const grid = new Map();
            for (const row of rows) {
                const { date, mealTypeId, variantId } = row._id;
                const dk = grid.get(date) || new Map();
                const mk = dk.get(String(mealTypeId)) || { byVariant: {}, totalQuantity: 0, amount: 0, bookings: new Set() };
                mk.byVariant[String(variantId)] = { variantId: String(variantId), variantName: row.variantName, quantity: row.quantity };
                mk.totalQuantity += row.quantity;
                mk.amount += row.amount;
                row.bookings.forEach((b) => mk.bookings.add(String(b)));
                dk.set(String(mealTypeId), mk);
                grid.set(date, dk);
            }
            const pendingBy = new Map();
            for (const p of pendingRows) {
                const k = `${p._id.date}|${p._id.mealTypeId}`;
                const cur = pendingBy.get(k) || { pending: 0, accepted: 0, rejected: 0 };
                if (p._id.status === "pending") cur.pending += p.n;
                if (p._id.status === "accepted") cur.accepted += p.n;
                if (p._id.status === "rejected") cur.rejected += p.n;
                pendingBy.set(k, cur);
            }

            const days = [];
            for (let d = r.from, i = 0; i < r.days; d = shiftDateKey(d, 1), i++) {
                const dk = grid.get(d) || new Map();
                const services = mealTypes.map((m) => {
                    const mk = dk.get(String(m._id)) || { byVariant: {}, totalQuantity: 0, amount: 0, bookings: new Set() };
                    const relevant = variants.filter((v) => !v.mealTypeIds?.length || v.mealTypeIds.some((id) => String(id) === String(m._id)));
                    const req_ = pendingBy.get(`${d}|${m._id}`) || { pending: 0, accepted: 0, rejected: 0 };
                    return {
                        mealTypeId: m._id, name: m.name,
                        byVariant: orderVariants(mk.byVariant, relevant),
                        totalQuantity: mk.totalQuantity, bookingCount: mk.bookings.size, amount: mk.amount,
                        requests: req_,
                    };
                });
                days.push({
                    date: d, label: formatDateKey(d), services,
                    totalQuantity: services.reduce((n, s) => n + s.totalQuantity, 0),
                    bookingCount: services.reduce((n, s) => n + s.bookingCount, 0),
                    amount: services.reduce((n, s) => n + s.amount, 0),
                });
            }

            const byVariantTotal = {};
            for (const day of days) for (const s of day.services) for (const v of s.byVariant) {
                byVariantTotal[v.variantId] = byVariantTotal[v.variantId] || { variantId: v.variantId, variantName: v.variantName, quantity: 0 };
                byVariantTotal[v.variantId].quantity += v.quantity;
            }

            res.json({
                business: { name: business.name }, outlet: outletInfo, from: r.from, to: r.to, days: r.days,
                mealTypes: mealTypes.map((m) => ({ id: m._id, name: m.name })),
                variants: variants.map((v) => ({ id: v._id, name: v.name })),
                rows: days,
                totals: {
                    quantity: days.reduce((n, d) => n + d.totalQuantity, 0),
                    bookings: days.reduce((n, d) => n + d.bookingCount, 0),
                    amount: days.reduce((n, d) => n + d.amount, 0),
                    byVariant: orderVariants(byVariantTotal, variants),
                    requests: [...pendingBy.values()].reduce((a, b) => ({ pending: a.pending + b.pending, accepted: a.accepted + b.accepted, rejected: a.rejected + b.rejected }), { pending: 0, accepted: 0, rejected: 0 }),
                },
            });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* BOOKINGS — the rows themselves, filtered, for a spreadsheet          */
/* ------------------------------------------------------------------ */
router.get("/api/reports/bookings.csv",
    authenticate, requirePermission("reports.export"),
    async (req, res, next) => {
        try {
            const business = await Business.findById(req.businessId).select("timezoneOffsetMinutes").lean();
            const r = rangeOf(req, business.timezoneOffsetMinutes ?? 330);
            if (r.error) return res.status(400).json({ message: r.error });

            const filter = { businessId: req.businessId, date: { $gte: r.from, $lte: r.to } };
            const om = await scopedOutletMatch(req, req.query.outletId);
            if (!om.ok) return next(om.error);
            Object.assign(filter, om.match);
            if (isId(req.query.mealTypeId)) filter.mealTypeId = req.query.mealTypeId;
            if (req.query.status) {
                const wanted = String(req.query.status).split(",").map((s) => s.trim()).filter(Boolean);
                if (wanted.length) filter.status = { $in: wanted };
            }
            if (req.query.q && String(req.query.q).trim()) {
                const term = String(req.query.q).trim();
                const phone = normalisePhone(term);
                const rx = new RegExp(escapeRx(term), "i");
                filter.$or = [{ reference: rx }, { "partySnapshot.name": rx }, { "partySnapshot.organisation": rx },
                    ...(phone ? [{ "partySnapshot.phone": phone }] : [{ "partySnapshot.phone": rx }])];
            }

            const [mealTypes, variants, bookings] = await Promise.all([
                MealType.find({ businessId: req.businessId }).lean(),
                MealVariant.find({ businessId: req.businessId }).sort({ sortOrder: 1 }).lean(),
                Booking.find(filter).sort({ date: 1, mealTypeId: 1, createdAt: 1 }).limit(10000).lean(),
            ]);
            const mealName = new Map(mealTypes.map((m) => [String(m._id), m.name]));
            const csv = [["Date", "Outlet", "Meal service", "Reference", "Customer", "Mobile", "Organisation", "Type",
                ...variants.map((v) => v.name), "Total meals", "Amount (₹)", "Status", "Source", "After cutoff", "Location", "Note", "Booked at (IST)"]];
            for (const b of bookings) {
                const qty = Object.fromEntries((b.lines || []).map((l) => [String(l.variantId), l.quantity]));
                csv.push([
                    b.date, b.outletName || "", mealName.get(String(b.mealTypeId)) || b.mealTypeName, b.reference,
                    b.partySnapshot?.name, b.partySnapshot?.phone, b.partySnapshot?.organisation, b.partySnapshot?.partyType,
                    ...variants.map((v) => qty[String(v._id)] || 0),
                    b.totalQuantity, b.totalAmount || 0, b.status, b.source, b.submittedAfterCutoff ? "yes" : "no",
                    b.location, b.customerNote, new Date(b.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }),
                ]);
            }
            logExport(req, "bookings", { From: r.from, To: r.to, Rows: bookings.length, Format: "CSV" },
                `Bookings from ${r.from} to ${r.to} were downloaded as CSV.`);
            sendCsv(res, `bookings-${r.from}-to-${r.to}`, csv);
        } catch (err) { next(err); }
    });

/** Client-side PDFs still want an audit entry; they call this after generating. */
router.post("/api/reports/exported",
    authenticate, requirePermission("reports.export"),
    (req, res) => {
        const what = String(req.body?.what || "a report").slice(0, 80);
        const details = req.body?.details && typeof req.body.details === "object" ? req.body.details : {};
        logExport(req, what, { ...details, Format: "PDF" }, `${what[0].toUpperCase()}${what.slice(1)} was downloaded as a PDF.`);
        res.json({ ok: true });
    });

module.exports = router;
