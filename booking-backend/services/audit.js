// services/audit.js — one function, so nothing has to remember the shape.
//
// Fire-and-forget on purpose: auditing must never fail or slow the operation it
// is describing. Called AFTER the change has succeeded, so the trail records
// what happened rather than what was attempted.
const AuditLog = require("../models/AuditLog");

// Never persist credentials, even though these paths are not expected to carry
// any. The trail has to be safe even when a future caller is careless.
const REDACT = new Set(["password", "passwordHash", "token", "otp", "idToken"]);

const MAX_DEPTH = 4;   // an audit row is a summary, not a deep clone
const MAX_ITEMS = 40;

/**
 * Flatten a value into something safe to persist.
 *
 * The subtlety that matters: callers hand us live Mongoose documents and
 * subdocument arrays (booking.lines), and those carry `$parent` back-references.
 * Walking them naively recurses until the stack dies — which is exactly what
 * happened the first time this ran. So anything document-like is converted to
 * plain data BEFORE being walked, `$`-prefixed internals are skipped, and depth
 * is capped as a backstop.
 */
function safe(value, depth = 0) {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    if (typeof value !== "object") return value;
    if (depth > MAX_DEPTH) return undefined;

    // ObjectId and friends — checked before toObject(), which they lack.
    if (typeof value.toHexString === "function") return String(value);

    // Mongoose document / DocumentArray -> plain object or array.
    if (typeof value.toObject === "function") {
        try { value = value.toObject(); } catch { return undefined; }
    }

    if (Array.isArray(value)) {
        return value.slice(0, MAX_ITEMS).map((v) => safe(v, depth + 1));
    }

    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (REDACT.has(k)) continue;
        if (k.startsWith("$")) continue;  // mongoose internals
        const s = safe(v, depth + 1);
        if (s !== undefined) out[k] = s;
    }
    return out;
}

/**
 * @param actor  { userId, name } for an operator, or null when the public
 *               booking form acted — in which case `party` identifies who.
 */
function record({
    businessId, actor = null, party = null, action,
    bookingId = null, requestId = null, outletId = null,
    before = null, after = null, details = {}, requestMeta = {},
}) {
    if (!businessId || !action) return;

    AuditLog.create({
        businessId,
        outletId: outletId || null,
        actorUserId: actor?.userId || null,
        actorPartyId: actor ? null : (party?._id || null),
        actorName: actor?.name || party?.name || "",
        actorKind: actor ? "operator" : (party ? "customer" : "system"),
        action,
        bookingId,
        requestId,
        partyId: party?._id || null,
        before: safe(before) ?? null,
        after: safe(after) ?? null,
        details: safe(details) || {},
        ip: requestMeta.ip || "",
        userAgent: requestMeta.userAgent || "",
    }).catch((e) => console.error("audit write failed:", e.message));
}

module.exports = { record };
