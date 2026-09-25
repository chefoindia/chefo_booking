// utils/outletScope.js — WHICH outlets may this request touch?
//
// The role answers "what may you do"; this answers "where". The two are kept
// apart on purpose: a scanner at Block A and a scanner at Block B hold the
// same role and different scopes, and a manager holds a wider role and no
// scope at all.
//
// THE SHAPE, everywhere in the backend:
//
//   scope === null       canteen-wide. Owners, and any user with an empty
//                        outletIds list. Every outlet, plus the bookings that
//                        predate outlets (outletId null).
//   scope === [ids...]   restricted to exactly these outlet ids. Never empty:
//                        an empty list is normalised to null upstream.
//
// NOTHING HERE TRUSTS THE CLIENT. A requested outlet id only ever NARROWS
// what the scope already allows; it can never widen it. That is the whole
// defence against "change the outletId in the request and read another
// outlet's data": the scope came from the user's own record, and a request
// for an outlet outside it is refused, not honoured.
const mongoose = require("mongoose");
const Outlet = require("../models/Outlet");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));
const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** A refusal the error handler turns straight into a 403 with a code. */
function wrongOutlet(message = "This booking belongs to another outlet.", code = "WRONG_OUTLET") {
    const e = new Error(message);
    e.status = 403;
    e.code = code;
    return e;
}

/** Is this outlet (or "no outlet") inside the scope? */
function inScope(scope, outletId) {
    if (scope === null || scope === undefined) return true;
    // A restricted user has no claim on the pre-outlet bookings: those belong
    // to the canteen as a whole, and "the whole canteen" is exactly what they
    // were not given.
    if (!outletId) return false;
    const want = String(outletId);
    return scope.some((id) => String(id) === want);
}

/**
 * Turn "what the client asked for" + "what the user is allowed" into the
 * Mongo condition to put on `outletId`.
 *
 *   requested absent / ""      -> everything the scope allows
 *   requested "unassigned"     -> only pre-outlet bookings (canteen-wide only)
 *   requested <id>             -> that one outlet, if the scope allows it
 *
 * Returns { ok: true, match } or { ok: false, error } — the route decides how
 * to send it. `match` is spread into a $match / find filter, so for a
 * canteen-wide user asking for everything it is {} and the query is exactly
 * what it was before outlets existed.
 */
function outletMatch(scope, requested) {
    const r = requested === undefined || requested === null ? "" : String(requested).trim();
    // NOTE: for a canteen-wide user this only validates the SHAPE of the id;
    // the tenant check ("is this one of OUR outlets") is scopedOutletMatch(),
    // which every route uses. Kept separate so the quantity layer and the
    // tests can call this synchronously.

    if (r === "unassigned") {
        if (scope !== null) return { ok: false, error: wrongOutlet("You don't have access to bookings outside your outlets.", "OUTLET_FORBIDDEN") };
        return { ok: true, match: { outletId: null } };
    }
    if (r) {
        if (!isId(r)) return { ok: false, error: Object.assign(new Error("Invalid outlet."), { status: 400, code: "BAD_OUTLET" }) };
        if (!inScope(scope, r)) {
            return { ok: false, error: wrongOutlet("You don't have access to that outlet.", "OUTLET_FORBIDDEN") };
        }
        return { ok: true, match: { outletId: oid(r) } };
    }
    if (scope === null) return { ok: true, match: {} };
    return { ok: true, match: { outletId: { $in: scope.map(oid) } } };
}

/**
 * outletMatch() plus the TENANT check: a requested outlet must exist in this
 * business. A restricted user's scope already proves that (their ids came
 * from their own record); a canteen-wide user's request is looked up, so an
 * id from another canteen is "not found" here rather than an empty result.
 * THE version routes call.
 */
async function scopedOutletMatch(req, requested) {
    const om = outletMatch(req.outletScope, requested);
    if (!om.ok) return om;
    const r = requested === undefined || requested === null ? "" : String(requested).trim();
    if (r && r !== "unassigned" && req.outletScope === null) {
        const ours = await Outlet.exists({ _id: r, businessId: req.businessId });
        if (!ours) return { ok: false, error: Object.assign(new Error("Outlet not found."), { status: 404, code: "NO_OUTLET" }) };
    }
    return om;
}

/**
 * The quantity helpers take an `outlet` argument in the same three shapes
 * (undefined = all, "unassigned", id) or an array of ids — this turns any of
 * them into the $match fragment. Separate from outletMatch() because the
 * quantity layer has no scope to check: the ROUTE checked it and passes the
 * already-authorised selection down.
 */
function outletCondition(outlet) {
    if (outlet === undefined || outlet === null || outlet === "") return {};
    if (outlet === "unassigned") return { outletId: null };
    if (Array.isArray(outlet)) return { outletId: { $in: outlet.map(oid) } };
    return { outletId: oid(outlet) };
}

/**
 * The selection a route should hand the quantity layer: the requested outlet
 * if there is one, otherwise the whole scope (null = all). Validated first.
 */
function outletSelection(scope, requested) {
    const r = requested === undefined || requested === null ? "" : String(requested).trim();
    if (r) return r;               // already validated via outletMatch by the caller
    return scope === null ? undefined : scope.map(String);
}

/**
 * THE QR RULE, in one place. Called by every path that resolves a booking for
 * an operator: by ticket, by reference, by id, and the serve action itself.
 *
 *   1. the booking's outlet comes from the DATABASE row, never the request
 *   2. the user's scope comes from their OWN record, never the request
 *   3. if the scope excludes the booking's outlet -> refused
 *   4. if the client also named the outlet it is scanning AT (scanOutletId),
 *      that must itself be inside the scope, and must equal the booking's
 *      outlet -> otherwise refused. A canteen-wide manager standing at Block A
 *      with the selector on Block A is told the Block B ticket is not for
 *      here, exactly as a Block A scanner would be.
 *
 * A booking with NO outlet (pre-outlet history, or a business with no
 * outlets) is the canteen's as a whole: canteen-wide users may act on it and
 * outlet-restricted users may not, because it is not "their outlet's".
 *
 * Returns nothing on success, throws a 403 with code WRONG_OUTLET otherwise.
 * The message names the booking's outlet when the caller may know it: the
 * useful thing to tell a customer at the wrong counter is which counter.
 */
async function assertBookingInScope({ scope, booking, scanOutletId = null, outletName = "", businessId = null }) {
    const bookingOutlet = booking?.outletId ? String(booking.outletId) : null;
    const label = outletName || booking?.outletName || "";
    const other = label ? ` (${label})` : "";

    if (!inScope(scope, bookingOutlet)) {
        throw wrongOutlet(bookingOutlet
            ? `This booking belongs to another outlet${other}.`
            : "This booking isn't assigned to an outlet you can serve.");
    }

    const at = scanOutletId ? String(scanOutletId) : "";
    if (at) {
        if (!isId(at)) throw Object.assign(new Error("Invalid outlet."), { status: 400, code: "BAD_OUTLET" });
        if (!inScope(scope, at)) throw wrongOutlet("You don't have access to that outlet.", "OUTLET_FORBIDDEN");
        // A canteen-wide user's "I am at outlet X" must still be one of THIS
        // business's outlets — another canteen's id is not a place here.
        if (scope === null && !(await Outlet.exists({ _id: at, businessId: businessId || booking.businessId }))) {
            throw wrongOutlet("You don't have access to that outlet.", "OUTLET_FORBIDDEN");
        }
        if (bookingOutlet && bookingOutlet !== at) {
            throw wrongOutlet(`This booking belongs to another outlet${other}.`);
        }
        // A pre-outlet booking scanned with an outlet selected: allowed for a
        // canteen-wide user (they passed inScope above); it simply has no
        // outlet to disagree with.
    }
}

module.exports = { inScope, outletMatch, scopedOutletMatch, outletCondition, outletSelection, assertBookingInScope, wrongOutlet, isId, oid };
