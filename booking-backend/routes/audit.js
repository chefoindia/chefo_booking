// routes/audit.js — the activity log, read-only.
//
// Everything services/audit.js recorded, filterable and paged, so "why did we
// cook 200 and not 185" or "who removed that role" is answered by a search,
// not by a database query somebody has to write at 11pm.
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const AuditLog = require("../models/AuditLog");
const BusinessUser = require("../models/BusinessUser");
const { authenticate, requirePermission } = require("../middleware/authenticate");
const { record } = require("../services/audit");
const { notify, CONCERN } = require("../services/notify");
const { sendCsv } = require("../utils/csv");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));
const meta = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] || "" });
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Query -> Mongo filter, shared by the list and the export. */
function buildFilter(req) {
    const { q, actorKind, actorUserId, from, to, bookingId, requestId, partyId } = req.query;
    const filter = { businessId: req.businessId };
    if (q && String(q).trim()) {
        const rx = new RegExp(escapeRx(String(q).trim()), "i");
        filter.$or = [{ action: rx }, { actorName: rx }];
    }
    if (["operator", "customer", "system"].includes(actorKind)) filter.actorKind = actorKind;
    if (isId(actorUserId)) filter.actorUserId = actorUserId;
    if (isId(bookingId)) filter.bookingId = bookingId;
    if (isId(requestId)) filter.requestId = requestId;
    if (isId(partyId)) filter.partyId = partyId;
    if (from || to) {
        filter.createdAt = {};
        if (from && !Number.isNaN(Date.parse(from))) filter.createdAt.$gte = new Date(`${from}T00:00:00+05:30`);
        if (to && !Number.isNaN(Date.parse(to))) filter.createdAt.$lte = new Date(`${to}T23:59:59.999+05:30`);
        if (!Object.keys(filter.createdAt).length) delete filter.createdAt;
    }
    return filter;
}

router.get("/api/audit",
    authenticate, requirePermission("audit.view"),
    async (req, res, next) => {
        try {
            const filter = buildFilter(req);
            const perPage = Math.min(Math.max(parseInt(req.query.perPage, 10) || 50, 10), 200);
            const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

            const [rows, total] = await Promise.all([
                AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage).lean(),
                AuditLog.countDocuments(filter),
            ]);
            res.json({ entries: rows, page, perPage, total, hasMore: page * perPage < total });
        } catch (err) { next(err); }
    });

/** The people who appear in the log, for the "who" filter. */
router.get("/api/audit/actors",
    authenticate, requirePermission("audit.view"),
    async (req, res, next) => {
        try {
            const users = await BusinessUser.find({ businessId: req.businessId }).select("name isOwner isActive").sort({ isOwner: -1, name: 1 }).lean();
            res.json({ actors: users.map((u) => ({ id: u._id, name: u.name, isOwner: u.isOwner, isActive: u.isActive !== false })) });
        } catch (err) { next(err); }
    });

router.get("/api/audit/export.csv",
    authenticate, requirePermission("audit.export"),
    async (req, res, next) => {
        try {
            const filter = buildFilter(req);
            const rows = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(5000).lean();
            const fmt = (d) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
            const csv = [["When (IST)", "Actor", "Kind", "Action", "Booking", "Request", "Party", "Before", "After", "Details", "IP", "Device"]];
            for (const r of rows) {
                csv.push([
                    fmt(r.createdAt), r.actorName, r.actorKind, r.action,
                    r.bookingId || "", r.requestId || "", r.partyId || "",
                    r.before ? JSON.stringify(r.before) : "", r.after ? JSON.stringify(r.after) : "",
                    r.details && Object.keys(r.details).length ? JSON.stringify(r.details) : "",
                    r.ip || "", r.userAgent || "",
                ]);
            }
            record({
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                action: "Exported the activity log", details: { rows: rows.length, filter: req.query },
            });
            notify("data.export", {
                businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
                title: "Activity log exported", summary: "The activity log was downloaded as a CSV file.",
                rows: [{ label: "Rows", value: String(rows.length) }], concern: CONCERN.data,
            });
            sendCsv(res, `activity-log-${new Date().toISOString().slice(0, 10)}`, csv);
        } catch (err) { next(err); }
    });

module.exports = router;
