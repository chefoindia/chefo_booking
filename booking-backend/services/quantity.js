// services/quantity.js — THE preparation count.
//
// "How many plates of what do we cook?" has exactly one correct answer, and it
// is computed here and nowhere else. The dashboard, the bookings list, the
// meal-service view and any future export all call into this module, because
// the failure this product cannot afford is two screens disagreeing about the
// number the kitchen is cooking to.
//
// THE RULES, in full:
//   * ONLY status "confirmed" counts. Not pending_approval, not rejected, not
//     cancelled. A late request contributes exactly nothing until an operator
//     accepts it — that is the entire promise of the cutoff workflow.
//   * Totals are PER VARIANT, because "185 plates" is not an instruction a
//     kitchen can act on; "120 veg, 65 non-veg" is.
//   * Bookings are summed, never counted. One group booking of 80 is 80 plates
//     and one row.
//   * OUTLET IS A FILTER, NEVER A SECOND SOURCE. "Overall lunch" and "Block A
//     lunch" are the same aggregation over the same rows with one more $match
//     term; the overall number is never assembled by adding outlet numbers
//     together, so a booking can never be counted twice and the two views can
//     never drift. `outlet` takes: undefined (everything), one id, an array of
//     ids (a restricted user's whole scope), or "unassigned" (pre-outlet rows).
const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const BookingRequest = require("../models/BookingRequest");
const { outletCondition } = require("../utils/outletScope");

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Confirmed preparation totals for one meal service on one date.
 *
 * Aggregated in the database rather than in Node: a busy lunch is hundreds of
 * bookings, and pulling them all back to sum an array client-side is the kind
 * of thing that is fine on day one and embarrassing at scale.
 *
 * @returns {{ byVariant: Object<string,{variantId,variantKey,variantName,quantity}>,
 *             totalQuantity: number, bookingCount: number }}
 */
async function confirmedTotals({ businessId, date, mealTypeId, outlet }) {
    const rows = await Booking.aggregate([
        {
            $match: {
                businessId: oid(businessId),
                date: String(date),
                mealTypeId: oid(mealTypeId),
                status: "confirmed",
                ...outletCondition(outlet),
            },
        },
        { $unwind: "$lines" },
        {
            $group: {
                _id: "$lines.variantId",
                variantKey: { $first: "$lines.variantKey" },
                variantName: { $first: "$lines.variantName" },
                quantity: { $sum: "$lines.quantity" },
            },
        },
    ]);

    const byVariant = {};
    let totalQuantity = 0;
    for (const r of rows) {
        byVariant[String(r._id)] = {
            variantId: String(r._id),
            variantKey: r.variantKey,
            variantName: r.variantName,
            quantity: r.quantity,
        };
        totalQuantity += r.quantity;
    }

    const bookingCount = await Booking.countDocuments({
        businessId, date: String(date), mealTypeId, status: "confirmed",
        ...outletCondition(outlet),
    });

    return { byVariant, totalQuantity, bookingCount };
}

/**
 * The same numbers for EVERY meal service on a date, in one pass.
 *
 * The dashboard's whole job is "how much work do we have today", so it must not
 * fire one aggregation per meal service and stitch them together — that is both
 * slower and a second place for the arithmetic to drift.
 *
 * @returns {Map<string, {byVariant, totalQuantity, bookingCount}>} keyed by mealTypeId
 */
async function confirmedTotalsByMeal({ businessId, date, outlet }) {
    const rows = await Booking.aggregate([
        { $match: { businessId: oid(businessId), date: String(date), status: "confirmed", ...outletCondition(outlet) } },
        {
            $facet: {
                lines: [
                    { $unwind: "$lines" },
                    {
                        $group: {
                            _id: { mealTypeId: "$mealTypeId", variantId: "$lines.variantId" },
                            variantKey: { $first: "$lines.variantKey" },
                            variantName: { $first: "$lines.variantName" },
                            quantity: { $sum: "$lines.quantity" },
                        },
                    },
                ],
                counts: [{ $group: { _id: "$mealTypeId", bookingCount: { $sum: 1 } } }],
            },
        },
    ]);

    const facet = rows[0] || { lines: [], counts: [] };
    const out = new Map();

    const bucket = (mealTypeId) => {
        const key = String(mealTypeId);
        if (!out.has(key)) out.set(key, { byVariant: {}, totalQuantity: 0, bookingCount: 0 });
        return out.get(key);
    };

    for (const r of facet.lines) {
        const b = bucket(r._id.mealTypeId);
        b.byVariant[String(r._id.variantId)] = {
            variantId: String(r._id.variantId),
            variantKey: r.variantKey,
            variantName: r.variantName,
            quantity: r.quantity,
        };
        b.totalQuantity += r.quantity;
    }
    for (const c of facet.counts) bucket(c._id).bookingCount = c.bookingCount;

    return out;
}

/**
 * Pending pressure: what is waiting for a decision, and how much it would move
 * the count by if every request were accepted.
 *
 * Reported ALONGSIDE the confirmed number and never folded into it. The
 * operator needs to see "200 confirmed, 2 requests worth +15" as two facts —
 * the moment those merge into one number, the kitchen is cooking to a figure
 * nobody approved.
 */
async function pendingSummaryByMeal({ businessId, date, outlet }) {
    const rows = await BookingRequest.aggregate([
        { $match: { businessId: oid(businessId), date: String(date), status: "pending", ...outletCondition(outlet) } },
        {
            $group: {
                _id: "$mealTypeId",
                count: { $sum: 1 },
                quantityDelta: { $sum: "$quantityDelta" },
                newBookings: { $sum: { $cond: [{ $eq: ["$type", "new_booking"] }, 1, 0] } },
                changes: { $sum: { $cond: [{ $eq: ["$type", "change"] }, 1, 0] } },
                cancellations: { $sum: { $cond: [{ $eq: ["$type", "cancellation"] }, 1, 0] } },
            },
        },
    ]);

    const out = new Map();
    for (const r of rows) {
        out.set(String(r._id), {
            count: r.count,
            quantityDelta: r.quantityDelta,
            newBookings: r.newBookings,
            changes: r.changes,
            cancellations: r.cancellations,
        });
    }
    return out;
}

/**
 * How much of today's confirmed count arrived LATE and was accepted.
 *
 * Worth surfacing on its own because it is the number that tells an operator
 * whether their cutoff time is set correctly. A lunch that takes 40 late plates
 * every day does not have a discipline problem; it has a cutoff that is an hour
 * too early.
 */
async function lateAcceptedByMeal({ businessId, date, outlet }) {
    const rows = await Booking.aggregate([
        {
            $match: {
                businessId: oid(businessId),
                date: String(date),
                status: "confirmed",
                submittedAfterCutoff: true,
                ...outletCondition(outlet),
            },
        },
        { $group: { _id: "$mealTypeId", quantity: { $sum: "$totalQuantity" }, bookings: { $sum: 1 } } },
    ]);

    const out = new Map();
    for (const r of rows) out.set(String(r._id), { quantity: r.quantity, bookings: r.bookings });
    return out;
}

/**
 * The per-outlet breakdown of one date, in ONE pass: confirmed quantity per
 * (outlet, meal service, variant), plus the booking count per (outlet, meal).
 *
 * This is what the "All outlets" dashboard shows under the overall numbers.
 * It is grouped from the same rows confirmedTotalsByMeal() sums, so the
 * outlet lines always add up to the overall line — but the overall line is
 * NOT computed from these; both come straight from the bookings.
 *
 * `outlet` narrows it the same way as everywhere else (a restricted user gets
 * only their outlets' lines). Rows with no outlet come back under the key
 * "unassigned", so history that predates outlets is visible, not lost.
 *
 * @returns {Map<string, { outletId, byMeal: Map<mealTypeId, {byVariant, totalQuantity, bookingCount}>, totalQuantity, bookingCount }>}
 */
async function confirmedTotalsByOutlet({ businessId, date, outlet }) {
    const rows = await Booking.aggregate([
        { $match: { businessId: oid(businessId), date: String(date), status: "confirmed", ...outletCondition(outlet) } },
        {
            $facet: {
                lines: [
                    { $unwind: "$lines" },
                    {
                        $group: {
                            _id: { outletId: "$outletId", mealTypeId: "$mealTypeId", variantId: "$lines.variantId" },
                            variantKey: { $first: "$lines.variantKey" },
                            variantName: { $first: "$lines.variantName" },
                            quantity: { $sum: "$lines.quantity" },
                        },
                    },
                ],
                counts: [{ $group: { _id: { outletId: "$outletId", mealTypeId: "$mealTypeId" }, bookingCount: { $sum: 1 } } }],
            },
        },
    ]);

    const facet = rows[0] || { lines: [], counts: [] };
    const out = new Map();
    const outletKey = (id) => (id ? String(id) : "unassigned");

    const bucket = (outletId, mealTypeId) => {
        const ok = outletKey(outletId);
        if (!out.has(ok)) out.set(ok, { outletId: outletId ? String(outletId) : null, byMeal: new Map(), totalQuantity: 0, bookingCount: 0 });
        const o = out.get(ok);
        const mk = String(mealTypeId);
        if (!o.byMeal.has(mk)) o.byMeal.set(mk, { byVariant: {}, totalQuantity: 0, bookingCount: 0 });
        return [o, o.byMeal.get(mk)];
    };

    for (const r of facet.lines) {
        const [o, m] = bucket(r._id.outletId, r._id.mealTypeId);
        m.byVariant[String(r._id.variantId)] = {
            variantId: String(r._id.variantId), variantKey: r.variantKey, variantName: r.variantName, quantity: r.quantity,
        };
        m.totalQuantity += r.quantity;
        o.totalQuantity += r.quantity;
    }
    for (const c of facet.counts) {
        const [o, m] = bucket(c._id.outletId, c._id.mealTypeId);
        m.bookingCount = c.bookingCount;
        o.bookingCount += c.bookingCount;
    }
    return out;
}

/** Shapes a byVariant map into the configured display order for the UI. */
function orderVariants(byVariant, variants) {
    return variants.map((v) => ({
        variantId: String(v._id),
        variantKey: v.key,
        variantName: v.name,
        quantity: byVariant[String(v._id)]?.quantity || 0,
    }));
}

module.exports = {
    confirmedTotals,
    confirmedTotalsByMeal,
    confirmedTotalsByOutlet,
    pendingSummaryByMeal,
    lateAcceptedByMeal,
    orderVariants,
};
