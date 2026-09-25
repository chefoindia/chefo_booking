// models/Booking.js — ONE submission: one party, one date, one meal service,
// a quantity per variant.
//
// ABC Project Site / Lunch / 8 Sep / Veg 7 + Non-Veg 8 is ONE row holding two
// lines. Not fifteen rows. The kitchen's question is "how many plates of what",
// and that is a sum over lines, never a count of documents.
//
// If the same party books that lunch again later, that is a SECOND booking, not
// an edit of this one — the two submissions are genuinely different facts
// (often different teams on the same site) and flattening them would destroy
// the history the operator needs when someone disputes a number.
//
// STATUS IS THE BOOKING'S OWN STATE, and nothing else. Whether the cutoff has
// passed is computed from the meal type at read time, never stored here; a
// pending approval lives on a BookingRequest, not in this field. Collapsing
// those three ideas into one column is the mistake this schema exists to avoid.
const mongoose = require("mongoose");

const BOOKING_STATUS = ["confirmed", "pending_approval", "rejected", "cancelled"];

// One variant's quantity. The name and price are SNAPSHOTS taken at write time:
// a variant renamed or repriced next month must not silently rewrite what this
// booking said, or a historical kitchen sheet stops matching the day it
// described.
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

// One answer to one custom question the business asked on its booking form.
// A SNAPSHOT for exactly the reason a line is: the operator may rename
// "Department" to "Cost centre" next month, or delete the question entirely,
// and this booking must still read the way it was answered. The key is kept
// alongside the label so a report can still group by question after a rename,
// and the value is a string because "what the customer typed" is a string —
// typing it per field would mean the schema changes every time a question does.
const answerSchema = new mongoose.Schema(
    {
        key: { type: String, required: true },
        label: { type: String, required: true },
        type: { type: String, default: "text" },
        value: { type: String, default: "" },
    },
    { _id: false }
);

const bookingSchema = new mongoose.Schema(
    {
        businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },

        // Human-facing handle: "BK-1041". What a customer reads out on the
        // phone, so it is short and per-business rather than a Mongo id.
        reference: { type: String, required: true },

        partyId: { type: mongoose.Schema.Types.ObjectId, ref: "BookingParty", required: true, index: true },

        /* ---- OUTLET ---------------------------------------------------------
           Which serving point of the business this booking is for. Set ONCE at
           create, from the outlet the customer (or the counter) chose, and
           never inferred afterwards from anything on screen.

           null has ONE meaning: the booking predates outlets at this business,
           or the business runs no outlets at all. It is never "unknown, work
           it out later". The migration deliberately leaves historical rows at
           null rather than guessing an outlet for them — see
           scripts/migrate-outlets.js, where an operator can assign them
           explicitly if they choose to.

           The name is a SNAPSHOT for the same reason the variant names are:
           renaming "Block A" to "North Block" must not rewrite what last
           month's kitchen sheet said. */
        outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet", default: null, index: true },
        outletName: { type: String, default: "" },

        // Snapshot of who booked, at booking time. The party record can be
        // edited later (corrected name, new site); this booking should still
        // read the way it did when it was placed.
        partySnapshot: {
            name: String,
            phone: String,
            organisation: String,
            partyType: String,
        },

        mealTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "MealType", required: true, index: true },
        mealTypeKey: { type: String, required: true },
        mealTypeName: { type: String, required: true },

        // "YYYY-MM-DD" in the business timezone. A date key rather than a Date
        // because "the 8th of September lunch" is a calendar fact, and storing
        // it as an instant invites a timezone to shift it by a day.
        date: { type: String, required: true, index: true },

        lines: { type: [lineSchema], default: [] },

        // Denormalised sums, written by the service layer on every mutation.
        // Present so a list of 500 bookings does not have to reduce arrays in
        // the client, and so a status/date query can sort by size.
        totalQuantity: { type: Number, default: 0 },
        totalAmount: { type: Number, default: 0 },

        status: { type: String, enum: BOOKING_STATUS, default: "confirmed", index: true },

        // WHAT THE CUTOFF SAID WHEN THIS WAS SUBMITTED. Recorded, not
        // recomputed: if the operator later moves the lunch cutoff from 10:30
        // to 11:00, this booking must still explain why it needed approval at
        // the time. Recomputing would rewrite history every time a setting
        // changed.
        submittedAfterCutoff: { type: Boolean, default: false },
        cutoffAtSubmission: { type: Date, default: null },

        // Where it came from — "customer" (public form) or "operator" (entered
        // at the counter). Operator-entered bookings skip the approval flow;
        // the operator accepting their own request is theatre.
        source: { type: String, enum: ["customer", "operator"], default: "customer" },
        createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessUser", default: null },

        customerNote: { type: String, default: "" },
        location: { type: String, default: "" },

        // The business's own questions, as answered when this was submitted.
        // Validated against Business.bookingFields at write time and then
        // frozen here — see answerSchema above.
        answers: { type: [answerSchema], default: [] },

        // THE PASS. A 22-char base64url random string minted at create, and the
        // only thing a customer needs to show to pull up this booking: 128 bits
        // of randomness is not guessable, where the human-facing BK-1041
        // reference is sequential and therefore is. Possession of the ticket is
        // the proof — which is precisely why the reference alone never is, and
        // why the ticket must not be printed anywhere the booking's owner
        // wouldn't want it read.
        //
        // NO `default: null` on purpose. The index below is unique+sparse, and
        // sparse skips documents where the field is ABSENT — an explicit null
        // is an indexed value, so defaulting to null would make the second
        // ticketless booking ever written collide with the first.
        ticket: { type: String },

        /* ---- CONSUMPTION ---------------------------------------------------
           "The meal was actually collected." NOT a status: a consumed booking
           is still a confirmed booking, still counts toward what the kitchen
           cooked, and the day's total must not drop by one the moment someone
           picks up their plate. Adding "consumed" to BOOKING_STATUS would do
           exactly that, which is why these are their own fields. */
        consumedAt: { type: Date, default: null },
        consumedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessUser", default: null },
        // Snapshot of the operator's name, so the record still reads correctly
        // after that team member leaves and their user row is deactivated.
        consumedByName: { type: String, default: "" },
        // How it was marked: a QR scan at the counter, or typed by hand.
        consumedVia: { type: String, enum: ["scan", "manual", null], default: null },
        consumedNote: { type: String, default: "" },
        // Where the meal was handed over. Always the booking's own outlet once
        // the server has verified the scanning staff member may act there —
        // never whatever outlet the scanner's screen happened to show.
        consumedAtOutletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet", default: null },

        // Set when status leaves "confirmed" for good, so the operator can see
        // when a booking dropped out of the count.
        cancelledAt: { type: Date, default: null },
        rejectedAt: { type: Date, default: null },
        confirmedAt: { type: Date, default: null },

        // Pricing is not V1's point; these exist so it can be added without a
        // migration. Nothing in the booking flow blocks on them.
        paymentStatus: { type: String, enum: ["unpaid", "partial", "paid", "refunded"], default: "unpaid" },
        amountPaid: { type: Number, default: 0, min: 0 },
    },
    { timestamps: true }
);

// The kitchen query: "everything confirmed for this meal on this date". Every
// preparation count in the product runs through this exact shape.
bookingSchema.index({ businessId: 1, date: 1, mealTypeId: 1, status: 1 });
// The same kitchen query, per outlet: "Block A lunch on the 8th". The outlet
// dashboard, the outlet kitchen sheet and the per-outlet breakdown all run
// through this shape, and it is a prefix of the party/date listings too.
bookingSchema.index({ businessId: 1, outletId: 1, date: 1, mealTypeId: 1, status: 1 });
bookingSchema.index({ businessId: 1, outletId: 1, createdAt: -1 });
bookingSchema.index({ businessId: 1, reference: 1 }, { unique: true });
bookingSchema.index({ businessId: 1, createdAt: -1 });
// Globally unique, not per-business: the ticket is looked up WITHOUT a business
// in hand (GET /api/public/t/:ticket), so it has to identify one booking on its
// own. Sparse so the pre-ticket bookings, which all have none, don't collide.
bookingSchema.index({ ticket: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Booking", bookingSchema);
module.exports.BOOKING_STATUS = BOOKING_STATUS;
