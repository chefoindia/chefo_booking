// services/consumption.js — "the food actually left the counter".
//
// WHY THIS IS NOT A STATUS, AND WHY BOOKING_STATUS WAS NOT TOUCHED
//
// `Booking.status` answers exactly one question: does this booking count toward
// what the kitchen cooks? confirmed / pending_approval / rejected / cancelled.
// Being served answers a completely different one: did this person collect it?
// The two are independent — a booking is confirmed and uncollected for most of
// the morning, and every confirmed booking stays in the preparation count
// whether or not anyone has picked it up yet.
//
// Collapsing them would mean the moment someone takes their lunch the kitchen's
// number changes, which is the one thing this product exists to prevent. So
// consumption is its own small set of fields on the booking and status is left
// entirely alone.
//
// EVERY STATE RULE LIVES HERE, not in the route. The QR scanner, the manual
// "mark as served" button, and whatever is added next must refuse the same
// things for the same reasons; two callers deciding that independently would
// eventually disagree, and the thing they would disagree about is whether
// somebody already ate.
const Booking = require("../models/Booking");
const { DomainError } = require("./bookingService");
const { record } = require("./audit");

const fail = (message, opts) => { throw new DomainError(message, opts); };

// How the mark was made. Kept because "scanned at the hatch" and "a manager
// ticked it off afterwards" are different degrees of evidence when a customer
// later says they never received their meal.
const CONSUME_VIA = ["scan", "manual"];

const consumedShape = (b) => ({
    at: b.consumedAt,
    by: b.consumedByName || "",
    via: b.consumedVia || null,
});

/**
 * Mark a booking as served.
 *
 * Refuses, always with 409 because each of these is a legitimate booking in the
 * wrong state rather than a malformed request:
 *
 *   ALREADY_CONSUMED  someone already served this. Checked FIRST, because it is
 *                     the most specific thing the counter can be told: the
 *                     answer to "why won't it scan?" is "it was taken at 12:04
 *                     by Priya", not a generic refusal.
 *   NOT_CONSUMABLE    cancelled or rejected — there is no meal to hand over.
 *   CONSUME_PENDING   the booking is still waiting on an operator's decision.
 *                     Nothing is served until it is accepted, or the approval
 *                     queue would be decided at the hatch by whoever scans
 *                     fastest.
 */
async function consumeBooking({
    businessId, bookingId, via = "manual", note = "",
    actor = null, now = new Date(), requestMeta = {},
}) {
    const booking = await Booking.findOne({ _id: bookingId, businessId });
    if (!booking) fail("Booking not found.", { status: 404, code: "NO_BOOKING" });

    if (booking.consumedAt) {
        fail(
            `${booking.reference} was already marked as served${booking.consumedByName ? ` by ${booking.consumedByName}` : ""}.`,
            { status: 409, code: "ALREADY_CONSUMED" }
        );
    }
    if (booking.status === "cancelled") {
        fail(`${booking.reference} was cancelled, so there is nothing to serve.`, {
            status: 409, code: "NOT_CONSUMABLE",
        });
    }
    if (booking.status === "rejected") {
        fail(`${booking.reference} was rejected, so there is nothing to serve.`, {
            status: 409, code: "NOT_CONSUMABLE",
        });
    }
    if (booking.status === "pending_approval") {
        fail(`${booking.reference} is still waiting for approval. Accept it first, then serve it.`, {
            status: 409, code: "CONSUME_PENDING",
        });
    }

    booking.consumedAt = now;
    booking.consumedByUserId = actor?.userId || null;
    // A name snapshot, like partySnapshot and the line names: the staff member
    // may leave the business, and the record of who handed the food over has to
    // stay readable when their user record is gone.
    booking.consumedByName = actor?.name || "";
    booking.consumedVia = CONSUME_VIA.includes(String(via)) ? String(via) : "manual";
    booking.consumedNote = String(note || "").trim().slice(0, 300);
    await booking.save();

    record({
        businessId, actor, requestMeta,
        action: "Marked a booking as served",
        bookingId: booking._id,
        before: { consumedAt: null },
        after: { consumedAt: booking.consumedAt, consumedVia: booking.consumedVia },
        details: {
            reference: booking.reference,
            date: booking.date,
            meal: booking.mealTypeName,
            customer: booking.partySnapshot?.name || "",
            meals: booking.totalQuantity,
            via: booking.consumedVia,
            note: booking.consumedNote,
        },
    });

    return { booking };
}

/**
 * Undo a served mark.
 *
 * Deliberately available rather than final: the realistic mistake is a counter
 * scanning the person behind the one being served, and a booking that cannot be
 * un-marked leaves that customer unable to collect at all. The undo is audited
 * exactly as loudly as the mark, so the trail shows both.
 */
async function unconsumeBooking({
    businessId, bookingId, note = "",
    actor = null, now = new Date(), requestMeta = {},
}) {
    const booking = await Booking.findOne({ _id: bookingId, businessId });
    if (!booking) fail("Booking not found.", { status: 404, code: "NO_BOOKING" });

    if (!booking.consumedAt) {
        fail(`${booking.reference} isn't marked as served.`, { status: 409, code: "NOT_CONSUMED" });
    }

    const before = {
        consumedAt: booking.consumedAt,
        consumedByName: booking.consumedByName,
        consumedVia: booking.consumedVia,
    };

    booking.consumedAt = null;
    booking.consumedByUserId = null;
    booking.consumedByName = "";
    booking.consumedVia = null;
    booking.consumedNote = String(note || "").trim().slice(0, 300);
    await booking.save();

    record({
        businessId, actor, requestMeta,
        action: "Undid a served mark",
        bookingId: booking._id,
        before,
        after: { consumedAt: null },
        details: {
            reference: booking.reference,
            date: booking.date,
            meal: booking.mealTypeName,
            customer: booking.partySnapshot?.name || "",
            servedAt: before.consumedAt,
            servedBy: before.consumedByName,
            note: booking.consumedNote,
            undoneAt: now,
        },
    });

    return { booking };
}

module.exports = { consumeBooking, unconsumeBooking, consumedShape, CONSUME_VIA };
