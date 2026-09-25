// models/BookingRequest.js — something awaiting the operator's decision.
//
// WHY THIS IS ITS OWN COLLECTION rather than a status on Booking.
//
// For a late NEW booking, "pending" could just be a booking status. But a
// CHANGE or CANCELLATION request must leave the original booking Confirmed and
// untouched while it waits — the kitchen is already cooking against that
// number, and the entire promise of this product is that nothing silently
// alters a confirmed requirement after cutoff. So the pending thing cannot live
// on the booking; it has to sit alongside it.
//
// Once that is true for two of the three request types, it should be true for
// all three: the operator's queue is one list of requests, each resolved the
// same way, with one audit trail. A booking accumulates requests over its life
// (a change, then later a cancellation) and every one of them is kept.
//
// RESOLVED REQUESTS ARE NEVER MUTATED OR DELETED. Accepting a change writes the
// new values onto the booking and stamps this record resolved; the record keeps
// what was asked for and what it replaced, forever.
const mongoose = require("mongoose");

const REQUEST_TYPES = ["new_booking", "change", "cancellation"];
const REQUEST_STATUS = ["pending", "accepted", "rejected", "withdrawn"];

// Same snapshot shape as Booking.lines — a requested state, not an applied one.
const lineSchema = new mongoose.Schema(
    {
        variantId: { type: mongoose.Schema.Types.ObjectId, ref: "MealVariant", required: true },
        variantKey: { type: String, required: true },
        variantName: { type: String, required: true },
        quantity: { type: Number, required: true, min: 0 },
        unitPrice: { type: Number, default: 0, min: 0 },
    },
    { _id: false }
);

const bookingRequestSchema = new mongoose.Schema(
    {
        businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
        reference: { type: String, required: true },

        type: { type: String, enum: REQUEST_TYPES, required: true, index: true },
        status: { type: String, enum: REQUEST_STATUS, default: "pending", index: true },

        // Always set. For new_booking it points at the booking sitting in
        // pending_approval; for change/cancellation, at the confirmed booking
        // the request wants to act on.
        bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },

        partyId: { type: mongoose.Schema.Types.ObjectId, ref: "BookingParty", required: true },
        partySnapshot: { name: String, phone: String, organisation: String, partyType: String },

        // Denormalised so the queue can be grouped by meal without loading
        // every related booking.
        mealTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "MealType", required: true },
        mealTypeName: { type: String, default: "" },
        date: { type: String, required: true, index: true },
        // Copied from the booking the request is about, so the queue can be
        // scoped to an outlet without loading every related booking. null for
        // requests raised against bookings that predate outlets.
        outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet", default: null },
        outletName: { type: String, default: "" },

        // BEFORE and AFTER, both kept.
        //
        // `currentLines` is what the booking held when the request was raised;
        // `requestedLines` is what it would become. Storing both is what lets
        // the operator see "Veg 7 → 5, Non-Veg 8 → 10" months later without
        // replaying the whole history, and what makes an accepted change
        // auditable rather than merely applied.
        //
        // For a cancellation, requestedLines is empty — the whole booking goes.
        currentLines: { type: [lineSchema], default: [] },
        requestedLines: { type: [lineSchema], default: [] },
        currentTotal: { type: Number, default: 0 },
        requestedTotal: { type: Number, default: 0 },
        // Signed: +8 wants eight more plates, -3 wants three fewer. What the
        // operator actually needs to judge a late request at a glance.
        quantityDelta: { type: Number, default: 0 },

        customerNote: { type: String, default: "" },

        // The cutoff that made this a request rather than a direct action.
        cutoffAt: { type: Date, default: null },

        resolvedAt: { type: Date, default: null },
        resolvedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessUser", default: null },
        resolvedByName: { type: String, default: "" },
        // Why. Shown to the operator's colleagues, and to the customer on the
        // status page when a request is refused.
        resolutionNote: { type: String, default: "" },
    },
    { timestamps: true }
);

// The queue: pending requests for this business, oldest first.
bookingRequestSchema.index({ businessId: 1, status: 1, createdAt: 1 });
bookingRequestSchema.index({ businessId: 1, outletId: 1, status: 1, createdAt: 1 });
bookingRequestSchema.index({ businessId: 1, outletId: 1, date: 1, status: 1 });
bookingRequestSchema.index({ businessId: 1, date: 1, mealTypeId: 1, status: 1 });
bookingRequestSchema.index({ businessId: 1, reference: 1 }, { unique: true });

module.exports = mongoose.model("BookingRequest", bookingRequestSchema);
module.exports.REQUEST_TYPES = REQUEST_TYPES;
module.exports.REQUEST_STATUS = REQUEST_STATUS;
