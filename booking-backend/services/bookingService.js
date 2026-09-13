// services/bookingService.js — the domain. Every booking mutation in the
// product goes through this file, whether it came from the public customer form
// or from an operator at the counter.
//
// THE ONE RULE THE PRODUCT EXISTS FOR
//
//   before cutoff -> the action happens
//   after  cutoff -> the action becomes a REQUEST, and the confirmed number
//                    does not move until an operator says so
//
// applies identically to all three actions: create, change, cancel. The routes
// do not implement it and must not re-implement it; they call in here. That is
// deliberate — the moment two code paths both decide "is this late?", they will
// eventually disagree, and the thing they disagree about is how much food a
// kitchen cooks.
//
// Nothing here trusts a client-supplied businessId, price, status or cutoff
// state. Prices come from the variant record, the cutoff from the meal type,
// the business from the authenticated session or the resolved public slug.
const mongoose = require("mongoose");

const Business = require("../models/Business");
const MealType = require("../models/MealType");
const MealVariant = require("../models/MealVariant");
const BookingParty = require("../models/BookingParty");
const Booking = require("../models/Booking");
const BookingRequest = require("../models/BookingRequest");

const { cutoffState, isDateKey, todayKey, shiftDateKey } = require("../utils/time");
const { normalisePhone } = require("../utils/phone");
const { newTicket } = require("../utils/ticket");
const { record } = require("./audit");

/** A refusal the routes can turn straight into an HTTP response. */
class DomainError extends Error {
    constructor(message, { status = 400, code = "INVALID" } = {}) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const fail = (message, opts) => { throw new DomainError(message, opts); };

/* ------------------------------------------------------------------ */
/* Reference numbers                                                    */
/* ------------------------------------------------------------------ */
// Per-business counters, so two businesses can both hold BK-1041. $inc is
// atomic, which is what stops two simultaneous submissions claiming one number.
async function nextReference(businessId, prefix) {
    const b = await Business.findByIdAndUpdate(
        businessId,
        { $inc: { bookingCounter: 1 } },
        { new: true, select: "bookingCounter" }
    );
    return `${prefix}-${1000 + (b?.bookingCounter || 1)}`;
}

/* ------------------------------------------------------------------ */
/* Line building                                                        */
/* ------------------------------------------------------------------ */
/**
 * Turn the client's `{ variantId: quantity }` into validated, priced lines.
 *
 * Every line is rebuilt from the VARIANT RECORD — the client sends quantities
 * and nothing else that matters. A request cannot invent a variant name, set
 * its own price, or attach a variant belonging to another business.
 */
async function buildLines({ businessId, mealTypeId, quantities, rules }) {
    if (!quantities || typeof quantities !== "object") fail("No quantities were provided.");

    const ids = Object.keys(quantities).filter((k) => mongoose.Types.ObjectId.isValid(k));
    if (!ids.length) fail("Choose at least one meal option.");

    const variants = await MealVariant.find({ _id: { $in: ids }, businessId }).lean();
    const byId = new Map(variants.map((v) => [String(v._id), v]));

    const lines = [];
    let totalQuantity = 0;
    let totalAmount = 0;

    for (const id of ids) {
        const qty = Number(quantities[id]);
        if (!Number.isFinite(qty) || qty < 0) fail("Quantities must be whole numbers of zero or more.");
        if (!Number.isInteger(qty)) fail("Quantities must be whole numbers.");
        if (qty === 0) continue; // a zero line is simply not part of the booking

        const v = byId.get(id);
        // Not found means it belongs to another business or does not exist —
        // reported the same way either way, so this never confirms whether some
        // other business's variant id is real.
        if (!v) fail("That meal option isn't available.");
        if (!v.active) fail(`"${v.name}" is no longer available.`);
        if (v.mealTypeIds?.length && !v.mealTypeIds.some((m) => String(m) === String(mealTypeId))) {
            fail(`"${v.name}" isn't served at this meal.`);
        }

        lines.push({
            variantId: v._id,
            variantKey: v.key,
            variantName: v.name,   // snapshot: a later rename must not rewrite history
            variantName_: undefined,
            quantity: qty,
            unitPrice: v.price || 0,
        });
        totalQuantity += qty;
        totalAmount += qty * (v.price || 0);
    }

    if (!totalQuantity) fail("Enter a quantity for at least one option.");

    const cap = rules?.maxQuantityPerBooking ?? 500;
    if (totalQuantity > cap) {
        fail(`A single booking can't exceed ${cap} meals. Split it or ask the canteen to raise the limit.`);
    }

    // Strip the accidental undefined key so it never reaches Mongo.
    lines.forEach((l) => delete l.variantName_);
    return { lines, totalQuantity, totalAmount };
}

const sumLines = (lines) => (lines || []).reduce((n, l) => n + (l.quantity || 0), 0);

/* ------------------------------------------------------------------ */
/* Context resolution                                                   */
/* ------------------------------------------------------------------ */
/**
 * Load and validate everything a booking action needs, and work out whether the
 * cutoff has passed. One place, so create/change/cancel cannot disagree.
 */
async function resolveContext({ businessId, mealTypeId, date, now = new Date() }) {
    const business = await Business.findById(businessId).lean();
    if (!business) fail("Business not found.", { status: 404, code: "NO_BUSINESS" });

    if (!isDateKey(date)) fail("Pick a valid date.");

    const mealType = await MealType.findOne({ _id: mealTypeId, businessId }).lean();
    if (!mealType) fail("That meal service isn't available.", { status: 404, code: "NO_MEAL_TYPE" });

    const cutoff = cutoffState(mealType, date, {
        now,
        offsetMinutes: business.timezoneOffsetMinutes ?? 330,
    });

    return { business, mealType, cutoff };
}

/** Booking horizon — how far ahead, and never into the past. */
function assertDateBookable({ business, date, now = new Date() }) {
    const today = todayKey(business.timezoneOffsetMinutes ?? 330, now);
    if (date < today) fail("That date has already passed.", { code: "PAST_DATE" });

    const maxAhead = business.rules?.maxDaysAhead ?? 14;
    const latest = shiftDateKey(today, maxAhead);
    if (date > latest) {
        fail(`Bookings open ${maxAhead} day${maxAhead === 1 ? "" : "s"} ahead. Please pick an earlier date.`, {
            code: "TOO_FAR_AHEAD",
        });
    }
}

/* ------------------------------------------------------------------ */
/* Booking party                                                        */
/* ------------------------------------------------------------------ */
/**
 * Find the party for this phone number, or create it.
 *
 * This is the entire "persistent identity without an account" mechanism: the
 * phone number is the key, and a returning caller lands on their existing
 * record along with everything they have booked before. It proves nothing about
 * who they are, and is not meant to.
 */
async function upsertParty({ businessId, name, phone, organisation, partyType, email, location }) {
    const normalised = normalisePhone(phone);
    if (!normalised) fail("Enter a valid mobile number.", { code: "BAD_PHONE" });

    const cleanName = String(name || "").trim().slice(0, 80);
    if (!cleanName) fail("Enter a name for the booking.", { code: "BAD_NAME" });

    const existing = await BookingParty.findOne({ businessId, phone: normalised });

    if (existing) {
        // Later submissions refresh the details — people change site, correct a
        // spelling. Blank values never overwrite something already recorded,
        // because a shorter form must not erase what a longer one captured.
        existing.name = cleanName;
        if (organisation) existing.organisation = String(organisation).trim().slice(0, 120);
        if (partyType) existing.partyType = String(partyType);
        if (email) existing.email = String(email).trim().slice(0, 120);
        if (location) existing.location = String(location).trim().slice(0, 200);
        await existing.save();
        return existing;
    }

    return BookingParty.create({
        businessId,
        name: cleanName,
        phone: normalised,
        organisation: String(organisation || "").trim().slice(0, 120),
        partyType: String(partyType || "individual"),
        email: String(email || "").trim().slice(0, 120),
        location: String(location || "").trim().slice(0, 200),
    });
}

const partySnapshotOf = (p) => ({
    name: p.name, phone: p.phone, organisation: p.organisation, partyType: p.partyType,
});

/* ------------------------------------------------------------------ */
/* Custom questions                                                     */
/* ------------------------------------------------------------------ */
// The business's own questions (Business.bookingFields) are configuration, so
// the answers to them are validated HERE rather than in the route — same reason
// the cutoff lives in this file. A customer form and an operator's counter entry
// must accept and reject exactly the same answers, and the moment two layers
// both decide "is this a valid department?" they will eventually disagree.
//
// The output is a SNAPSHOT: label and type are copied alongside the value, so a
// question renamed, rescoped or deleted next month cannot rewrite what this
// booking recorded.
const ANSWER_MAX = 300;

/** Does this question apply to the meal service and party type being booked? */
function fieldApplies(field, mealTypeKey, partyTypeKey) {
    // Empty list means "everywhere" — the common case, and deliberately the
    // default, so a business that never scopes anything never thinks about it.
    if (field.mealTypeKeys?.length && !field.mealTypeKeys.includes(mealTypeKey)) return false;
    if (field.partyTypeKeys?.length && !field.partyTypeKeys.includes(partyTypeKey)) return false;
    return true;
}

/**
 * One raw submitted value -> the string that gets stored, or "" for "not
 * answered". Throws when the value is present but wrong for its type.
 *
 * Everything ends up a string because that is what the snapshot holds; the type
 * is what decides whether the string was allowed to be what it is.
 */
function coerceAnswer(field, raw) {
    const label = field.label || field.key;
    const type = field.type || "text";

    // A checkbox has no "not answered" state — absent IS the answer "no".
    if (type === "checkbox") {
        const ticked = raw === true || raw === 1 || raw === "1"
            || raw === "true" || raw === "yes" || raw === "on";
        return ticked ? "yes" : "no";
    }

    if (raw === null || raw === undefined) return "";
    const v = String(raw).trim();
    if (!v) return "";

    switch (type) {
        case "number": {
            const n = Number(v);
            if (!Number.isFinite(n)) fail(`"${label}" must be a number.`, { code: "BAD_ANSWER" });
            return String(n);
        }
        case "tel": {
            // Through the same normaliser as the party's phone, so a number
            // captured in a custom field is stored in the one format this
            // product reads phone numbers in.
            const p = normalisePhone(v);
            if (!p) fail(`Enter a valid mobile number for "${label}".`, { code: "BAD_ANSWER" });
            return p;
        }
        case "email": {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
                fail(`Enter a valid email address for "${label}".`, { code: "BAD_ANSWER" });
            }
            return v.slice(0, ANSWER_MAX);
        }
        case "date": {
            if (!isDateKey(v)) fail(`"${label}" must be a date.`, { code: "BAD_ANSWER" });
            return v;
        }
        case "select": {
            // The value has to be one the operator actually offered. Without
            // this, "select" is a text box with a dropdown drawn on it.
            if (!(field.options || []).includes(v)) {
                fail(`Choose one of the listed options for "${label}".`, { code: "BAD_ANSWER" });
            }
            return v;
        }
        default:
            // text / textarea and anything a future config version invents.
            return v.slice(0, ANSWER_MAX);
    }
}

/**
 * Validate the submitted `{ [fieldKey]: value }` against this business's
 * configured questions and return the snapshot array to store.
 *
 * Unknown and out-of-scope keys are REFUSED rather than ignored: silently
 * dropping an answer the customer typed is how a booking arrives at the counter
 * missing the room number somebody swears they entered.
 */
function buildAnswers({ business, mealType, party, answers, enforceRequired = true }) {
    const all = business.bookingFields || [];
    const supplied = (answers && typeof answers === "object" && !Array.isArray(answers)) ? answers : {};

    const mealTypeKey = mealType?.key || "";
    const partyTypeKey = party?.partyType || "";

    // Inactive fields are not askable and not answerable — a retired question
    // must not come back because a stale form still posts its key.
    const active = all.filter((f) => f.active !== false);
    const inScope = active.filter((f) => fieldApplies(f, mealTypeKey, partyTypeKey));
    const byKey = new Map(inScope.map((f) => [String(f.key), f]));

    for (const key of Object.keys(supplied)) {
        if (byKey.has(key)) continue;
        const known = all.find((f) => String(f.key) === key);
        fail(
            known
                ? `"${known.label || key}" isn't asked for this booking.`
                : `"${key}" isn't a question on this booking form.`,
            { code: "BAD_ANSWERS" }
        );
    }

    const out = [];
    for (const f of [...inScope].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))) {
        const type = f.type || "text";
        const value = coerceAnswer(f, Object.prototype.hasOwnProperty.call(supplied, f.key) ? supplied[f.key] : undefined);
        const answered = type === "checkbox" ? value === "yes" : Boolean(value);

        // REQUIRED IS A RULE FOR THE PUBLIC FORM, NOT FOR THE COUNTER.
        // The same distinction the rest of this function's caller already
        // makes (acceptingBookings, customerBookable and the date window are
        // all checked only for source "customer"): an operator taking a
        // booking over the counter may genuinely not have the customer's
        // employee ID, and refusing to record the meal because of it would
        // lose the booking rather than the answer. Everything else — unknown
        // keys, out-of-scope keys, bad values — still applies to both.
        if (enforceRequired && f.required && !answered) {
            fail(
                type === "checkbox"
                    ? `Please tick "${f.label}" to continue.`
                    : `"${f.label}" is required.`,
                { code: "ANSWER_REQUIRED" }
            );
        }

        // A checkbox is recorded either way, because "no" is a real answer and
        // an absent row would be indistinguishable from never having asked.
        // Every other type records only what was actually filled in.
        if (type !== "checkbox" && !value) continue;

        out.push({ key: f.key, label: f.label, type, value });
    }

    return out;
}

/* ------------------------------------------------------------------ */
/* CREATE                                                               */
/* ------------------------------------------------------------------ */
/**
 * Submit a booking.
 *
 * Before cutoff  -> confirmed immediately, counts toward preparation now.
 * After  cutoff  -> pending_approval, PLUS a new_booking request in the queue.
 *                   Contributes nothing until accepted.
 *
 * An operator creating a booking at the counter is never made to approve their
 * own request — `source: "operator"` confirms directly whatever the clock says,
 * because the person who would resolve the request is the one submitting it.
 */
async function createBooking({
    businessId, mealTypeId, date, quantities, party,
    customerNote = "", location = "", source = "customer",
    // The business's own questions. Validated against its configuration below,
    // never trusted as sent.
    answers = {},
    actor = null, now = new Date(), requestMeta = {},
}) {
    const { business, mealType, cutoff } = await resolveContext({ businessId, mealTypeId, date, now });

    if (source === "customer") {
        if (!business.acceptingBookings) {
            fail(business.closedMessage || "This canteen isn't accepting bookings right now.", {
                status: 409, code: "CLOSED",
            });
        }
        if (!mealType.active || !mealType.customerBookable) {
            fail("That meal service isn't open for booking.", { status: 409, code: "MEAL_CLOSED" });
        }
        assertDateBookable({ business, date, now });
    } else if (!mealType.active) {
        fail("That meal service is inactive.", { status: 409, code: "MEAL_CLOSED" });
    }

    const partyDoc = await upsertParty({ businessId, ...party });
    const { lines, totalQuantity, totalAmount } = await buildLines({
        businessId, mealTypeId, quantities, rules: business.rules,
    });
    // After the party exists, because which questions apply depends on the
    // party type the booking ended up with — not on whatever the form claimed.
    const answerSnapshot = buildAnswers({
        business, mealType, party: partyDoc, answers,
        enforceRequired: source === "customer",
    });

    // THE DECISION.
    const late = cutoff.passed && source === "customer";
    const reference = await nextReference(businessId, "BK");

    const booking = await Booking.create({
        businessId,
        reference,
        partyId: partyDoc._id,
        partySnapshot: partySnapshotOf(partyDoc),
        mealTypeId: mealType._id,
        mealTypeKey: mealType.key,
        mealTypeName: mealType.name,
        date,
        lines,
        totalQuantity,
        totalAmount,
        status: late ? "pending_approval" : "confirmed",
        // Recorded as it was AT SUBMISSION, never recomputed — moving the
        // cutoff tomorrow must not change why this booking needed approval.
        submittedAfterCutoff: cutoff.passed,
        cutoffAtSubmission: cutoff.cutoffAt,
        confirmedAt: late ? null : new Date(),
        source,
        createdByUserId: actor?.userId || null,
        customerNote: String(customerNote || "").slice(0, 500),
        location: String(location || partyDoc.location || "").slice(0, 200),
        answers: answerSnapshot,
        // Minted here and only here: every booking in the product can be
        // produced at a counter without the customer proving anything else.
        ticket: newTicket(),
    });

    let request = null;
    if (late) {
        request = await BookingRequest.create({
            businessId,
            reference: await nextReference(businessId, "RQ"),
            type: "new_booking",
            status: "pending",
            bookingId: booking._id,
            partyId: partyDoc._id,
            partySnapshot: partySnapshotOf(partyDoc),
            mealTypeId: mealType._id,
            mealTypeName: mealType.name,
            date,
            currentLines: [],
            requestedLines: lines,
            currentTotal: 0,
            requestedTotal: totalQuantity,
            quantityDelta: totalQuantity,
            customerNote: String(customerNote || "").slice(0, 500),
            cutoffAt: cutoff.cutoffAt,
        });
    }

    await BookingParty.updateOne(
        { _id: partyDoc._id },
        { $set: { lastBookingAt: new Date() }, $inc: { bookingCount: 1 } }
    );

    await record({
        businessId, actor, party: partyDoc, requestMeta,
        action: late ? "Submitted a late booking (pending approval)" : "Created a booking",
        bookingId: booking._id,
        requestId: request?._id || null,
        after: { lines, totalQuantity, status: booking.status },
        details: {
            reference, date, meal: mealType.name, afterCutoff: cutoff.passed, source,
            // What the customer answered, in the trail, because a disputed
            // "I definitely wrote gate 3" is settled by the log or by nothing.
            ...(answerSnapshot.length ? { answers: answerSnapshot } : {}),
        },
    });

    return { booking, request, cutoff };
}

/* ------------------------------------------------------------------ */
/* CHANGE                                                               */
/* ------------------------------------------------------------------ */
/**
 * Amend an existing booking's quantities.
 *
 * Before cutoff -> applied directly; the confirmed count moves now.
 * After  cutoff -> a change REQUEST. The original booking is left completely
 *                  untouched, still confirmed, still counted, until an operator
 *                  decides. This is the guarantee that the kitchen's number
 *                  never moves behind its back.
 */
async function changeBooking({
    businessId, bookingId, quantities, customerNote = "",
    actor = null, byOperator = false, now = new Date(), requestMeta = {},
}) {
    const booking = await Booking.findOne({ _id: bookingId, businessId });
    if (!booking) fail("Booking not found.", { status: 404, code: "NO_BOOKING" });

    if (booking.status === "cancelled") fail("That booking was cancelled.", { status: 409, code: "CANCELLED" });
    if (booking.status === "rejected") fail("That booking was rejected.", { status: 409, code: "REJECTED" });

    const { business, mealType, cutoff } = await resolveContext({
        businessId, mealTypeId: booking.mealTypeId, date: booking.date, now,
    });

    // A booking still awaiting its own approval is edited in place — there is
    // nothing confirmed to protect yet, and stacking a change request on top of
    // a pending booking would ask the operator to resolve two things to settle
    // one booking.
    const stillPending = booking.status === "pending_approval";

    if (!byOperator) {
        if (!cutoff.passed && business.rules?.allowCustomerEditBeforeCutoff === false) {
            fail("This canteen doesn't allow changes online. Please call them.", { status: 403, code: "EDIT_OFF" });
        }
        if (cutoff.passed && !stillPending && business.rules?.allowCustomerChangeRequestAfterCutoff === false) {
            fail("Changes are closed for this meal.", { status: 403, code: "CHANGE_CLOSED" });
        }
        if (await hasOpenRequest(booking._id)) {
            fail("You already have a request waiting on this booking.", { status: 409, code: "REQUEST_OPEN" });
        }
    }

    const { lines, totalQuantity, totalAmount } = await buildLines({
        businessId, mealTypeId: booking.mealTypeId, quantities, rules: business.rules,
    });

    const before = { lines: booking.lines.map((l) => l.toObject?.() ?? l), totalQuantity: booking.totalQuantity };

    // ---- direct edit ----
    if (!cutoff.passed || byOperator || stillPending) {
        booking.lines = lines;
        booking.totalQuantity = totalQuantity;
        booking.totalAmount = totalAmount;
        if (customerNote) booking.customerNote = String(customerNote).slice(0, 500);
        await booking.save();

        await record({
            businessId, actor, requestMeta,
            action: byOperator ? "Operator changed a booking" : "Changed a booking",
            bookingId: booking._id,
            before, after: { lines, totalQuantity },
            details: { reference: booking.reference, afterCutoff: cutoff.passed, direct: true },
        });
        return { booking, request: null, applied: true, cutoff };
    }

    // ---- after cutoff: request only, booking untouched ----
    const request = await BookingRequest.create({
        businessId,
        reference: await nextReference(businessId, "RQ"),
        type: "change",
        status: "pending",
        bookingId: booking._id,
        partyId: booking.partyId,
        partySnapshot: booking.partySnapshot,
        mealTypeId: booking.mealTypeId,
        mealTypeName: mealType.name,
        date: booking.date,
        currentLines: before.lines,
        requestedLines: lines,
        currentTotal: before.totalQuantity,
        requestedTotal: totalQuantity,
        quantityDelta: totalQuantity - before.totalQuantity,
        customerNote: String(customerNote || "").slice(0, 500),
        cutoffAt: cutoff.cutoffAt,
    });

    await record({
        businessId, actor, requestMeta,
        action: "Requested a change after cutoff",
        bookingId: booking._id, requestId: request._id,
        before, after: { lines, totalQuantity },
        details: { reference: booking.reference, requestRef: request.reference },
    });

    return { booking, request, applied: false, cutoff };
}

/* ------------------------------------------------------------------ */
/* CANCEL                                                               */
/* ------------------------------------------------------------------ */
/**
 * Cancel a booking.
 *
 * Before cutoff -> cancelled now, count drops immediately.
 * After  cutoff -> a cancellation REQUEST. The booking stays confirmed and
 *                  keeps counting, because the food may already be cooking.
 *                  Reducing a number after cutoff is just as much an
 *                  operational decision as increasing one.
 */
async function cancelBooking({
    businessId, bookingId, reason = "",
    actor = null, byOperator = false, now = new Date(), requestMeta = {},
}) {
    const booking = await Booking.findOne({ _id: bookingId, businessId });
    if (!booking) fail("Booking not found.", { status: 404, code: "NO_BOOKING" });
    if (booking.status === "cancelled") fail("That booking is already cancelled.", { status: 409, code: "CANCELLED" });
    if (booking.status === "rejected") fail("That booking was rejected.", { status: 409, code: "REJECTED" });

    const { business, mealType, cutoff } = await resolveContext({
        businessId, mealTypeId: booking.mealTypeId, date: booking.date, now,
    });

    const stillPending = booking.status === "pending_approval";

    if (!byOperator) {
        if (!cutoff.passed && business.rules?.allowCustomerCancelBeforeCutoff === false) {
            fail("This canteen doesn't allow cancelling online. Please call them.", { status: 403, code: "CANCEL_OFF" });
        }
        if (cutoff.passed && !stillPending && business.rules?.allowCustomerCancelRequestAfterCutoff === false) {
            fail("Cancellations are closed for this meal.", { status: 403, code: "CANCEL_CLOSED" });
        }
        if (await hasOpenRequest(booking._id)) {
            fail("You already have a request waiting on this booking.", { status: 409, code: "REQUEST_OPEN" });
        }
    }

    const before = { totalQuantity: booking.totalQuantity, status: booking.status };

    // Withdrawing a booking that has not been approved yet is not a
    // cancellation the kitchen needs to weigh in on — nothing was ever counted.
    if (!cutoff.passed || byOperator || stillPending) {
        booking.status = "cancelled";
        booking.cancelledAt = new Date();
        await booking.save();

        // Its own pending new_booking request, if any, is now moot.
        await BookingRequest.updateMany(
            { bookingId: booking._id, status: "pending" },
            {
                $set: {
                    status: "withdrawn", resolvedAt: new Date(),
                    resolutionNote: "Booking cancelled before this was resolved.",
                },
            }
        );

        await record({
            businessId, actor, requestMeta,
            action: byOperator ? "Operator cancelled a booking" : "Cancelled a booking",
            bookingId: booking._id,
            before, after: { status: "cancelled", totalQuantity: 0 },
            details: { reference: booking.reference, afterCutoff: cutoff.passed, reason, direct: true },
        });
        return { booking, request: null, applied: true, cutoff };
    }

    const request = await BookingRequest.create({
        businessId,
        reference: await nextReference(businessId, "RQ"),
        type: "cancellation",
        status: "pending",
        bookingId: booking._id,
        partyId: booking.partyId,
        partySnapshot: booking.partySnapshot,
        mealTypeId: booking.mealTypeId,
        mealTypeName: mealType.name,
        date: booking.date,
        currentLines: booking.lines.map((l) => l.toObject?.() ?? l),
        requestedLines: [],
        currentTotal: booking.totalQuantity,
        requestedTotal: 0,
        quantityDelta: -booking.totalQuantity,
        customerNote: String(reason || "").slice(0, 500),
        cutoffAt: cutoff.cutoffAt,
    });

    await record({
        businessId, actor, requestMeta,
        action: "Requested a cancellation after cutoff",
        bookingId: booking._id, requestId: request._id,
        before, details: { reference: booking.reference, requestRef: request.reference, reason },
    });

    return { booking, request, applied: false, cutoff };
}

const hasOpenRequest = async (bookingId) =>
    Boolean(await BookingRequest.exists({ bookingId, status: "pending" }));

/* ------------------------------------------------------------------ */
/* RESOLVE                                                              */
/* ------------------------------------------------------------------ */
/**
 * The operator's decision. The only place a pending request becomes real.
 *
 * Accepting applies the request's effect to the booking; rejecting leaves the
 * booking exactly as it was. Either way the request document is stamped, never
 * rewritten or removed — what was asked for, and what it would have replaced,
 * stays readable for good.
 */
async function resolveRequest({
    businessId, requestId, decision, note = "", actor, now = new Date(), requestMeta = {},
}) {
    if (!["accept", "reject"].includes(decision)) fail("Decision must be accept or reject.");

    const request = await BookingRequest.findOne({ _id: requestId, businessId });
    if (!request) fail("Request not found.", { status: 404, code: "NO_REQUEST" });
    if (request.status !== "pending") {
        fail(`That request was already ${request.status}.`, { status: 409, code: "ALREADY_RESOLVED" });
    }

    const booking = await Booking.findOne({ _id: request.bookingId, businessId });
    if (!booking) fail("The related booking no longer exists.", { status: 404, code: "NO_BOOKING" });

    const before = {
        status: booking.status,
        totalQuantity: booking.totalQuantity,
        lines: booking.lines.map((l) => l.toObject?.() ?? l),
    };
    const accepted = decision === "accept";

    if (accepted) {
        switch (request.type) {
            case "new_booking":
                booking.status = "confirmed";
                booking.confirmedAt = now;
                break;

            case "change":
                booking.lines = request.requestedLines;
                booking.totalQuantity = sumLines(request.requestedLines);
                booking.totalAmount = (request.requestedLines || [])
                    .reduce((n, l) => n + l.quantity * (l.unitPrice || 0), 0);
                break;

            case "cancellation":
                booking.status = "cancelled";
                booking.cancelledAt = now;
                break;
        }
    } else if (request.type === "new_booking") {
        // A refused late booking is Rejected, not Cancelled — the customer did
        // not withdraw it, the operator declined it, and the status should say
        // which of those happened.
        booking.status = "rejected";
        booking.rejectedAt = now;
    }
    // A rejected change or cancellation leaves the booking untouched, by design.

    await booking.save();

    request.status = accepted ? "accepted" : "rejected";
    request.resolvedAt = now;
    request.resolvedByUserId = actor?.userId || null;
    request.resolvedByName = actor?.name || "";
    request.resolutionNote = String(note || "").slice(0, 500);
    await request.save();

    await record({
        businessId, actor, requestMeta,
        action: `${accepted ? "Accepted" : "Rejected"} a ${request.type.replace("_", " ")} request`,
        bookingId: booking._id, requestId: request._id,
        before,
        after: { status: booking.status, totalQuantity: booking.totalQuantity, lines: booking.lines },
        details: { reference: booking.reference, requestRef: request.reference, note },
    });

    return { booking, request };
}

module.exports = {
    DomainError,
    createBooking,
    changeBooking,
    cancelBooking,
    resolveRequest,
    resolveContext,
    upsertParty,
    buildLines,
    buildAnswers,
    fieldApplies,
    nextReference,
    assertDateBookable,
};
