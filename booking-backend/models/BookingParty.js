// models/BookingParty.js — WHO books. Persistent across bookings, keyed by
// phone number.
//
// RECOGNITION, NOT AUTHENTICATION. Nothing here is verified: there is no
// password, no OTP, no session. Supplying a phone number attaches a submission
// to this record and shows the operator the party's history — it does not prove
// identity, and the product deliberately accepts that for V1 in exchange for a
// booking form anyone can complete in thirty seconds.
//
// The consequence, stated plainly so nobody has to rediscover it: someone can
// type a phone number that is not theirs, and their booking will be attributed
// to that party. The mitigation when it matters is OTP, which slots in at the
// submission boundary without changing this model.
const mongoose = require("mongoose");

const bookingPartySchema = new mongoose.Schema(
    {
        businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },

        name: { type: String, required: true, trim: true },
        // Stored E.164 ("+91XXXXXXXXXX"). Normalised at the boundary so the
        // lookup that links a repeat booking always matches — the same rule the
        // existing Chefo products use.
        phone: { type: String, required: true, trim: true },

        // "ABC Project Site", "Tower B — 3rd floor". The thing the operator
        // actually recognises for a group, which is often not the caller's name.
        organisation: { type: String, default: "" },

        // Matches a key in Business.partyTypes. A plain string rather than an
        // enum precisely because that list is per-business configuration.
        partyType: { type: String, default: "individual" },

        email: { type: String, default: "" },
        // Where the food goes, if the business delivers. Free text: a project
        // site's "behind the cement godown, gate 2" is not an address schema.
        location: { type: String, default: "" },

        // Operator-only. The customer never sees this.
        internalNote: { type: String, default: "" },

        /* ---- THE PART THAT IS ACTUALLY VERIFIED ----------------------------
           Everything above is recognition. These three fields are the narrow
           exception: once a party completes phone OTP, this record stops being
           a guess about who booked and becomes a claim the customer proved.

           It stays OPTIONAL. A party with phoneVerifiedAt null is exactly the
           V1 party described above and books the same way — verifying only buys
           the customer a signed-in view of their own history, so the thirty
           second booking form never grows a login wall. */
        phoneVerifiedAt: { type: Date, default: null },
        // When they first kept a session, as distinct from when they first
        // proved the number. Separate because a party can verify once for a
        // single booking and never take an account.
        accountCreatedAt: { type: Date, default: null },
        // Bumped to invalidate every session already issued to this party —
        // the logout-everywhere / lost-phone lever. A token whose `v` no longer
        // matches is refused, so revocation needs no session store.
        tokenVersion: { type: Number, default: 0 },

        // Denormalised for the parties list, which otherwise needs an
        // aggregation over every booking just to sort by "most recent".
        lastBookingAt: { type: Date, default: null },
        bookingCount: { type: Number, default: 0 },
    },
    { timestamps: true }
);

// The identity rule: one party per phone number PER BUSINESS. The same person
// booking at two different canteens is two independent party records, which is
// correct — their history at one is not the other's business to see.
bookingPartySchema.index({ businessId: 1, phone: 1 }, { unique: true });
bookingPartySchema.index({ businessId: 1, lastBookingAt: -1 });

module.exports = mongoose.model("BookingParty", bookingPartySchema);
