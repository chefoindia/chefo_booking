// models/BusinessUser.js — someone who signs into the operator dashboard.
//
// WHY PASSWORD AND NOT PHONE+OTP
//
// The other Chefo products authenticate by Firebase phone OTP. This one uses a
// password, deliberately, for two reasons:
//
//   1. These are business users at a counter, often sharing a back-office
//      machine, signing in at the start of a shift — not consumers on their own
//      phone. A password is the ordinary fit.
//   2. It is testable end to end without an external dependency. Firebase phone
//      auth in this project has been rate-limited and billing-gated before now,
//      and a brand-new product whose login cannot be exercised locally is a
//      product nobody can verify.
//
// What is REUSED is the part that matters: the session architecture is
// identical to the existing owner dashboard — a JWT in an httpOnly cookie,
// sliding renewal, per-request permission resolution, owner short-circuit. The
// credential is a detail behind that; adding OTP later means adding a second
// way to mint the same session, not a second session system.
const mongoose = require("mongoose");

const businessUserSchema = new mongoose.Schema(
    {
        businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },

        name: { type: String, required: true, trim: true },

        // Either may be used to sign in. Email is the norm for a back office;
        // phone is there because plenty of small operators do not have one.
        email: { type: String, lowercase: true, trim: true, default: "" },
        phone: { type: String, trim: true, default: "" },

        // bcrypt. Never selected by default — a route has to ask for it
        // explicitly, so no handler can leak it by returning the document.
        passwordHash: { type: String, required: true, select: false },

        // The business's first user. Unrestricted within their own business and
        // never limited by a role, because a role that could restrict the owner
        // would let them lock themselves out of their own account.
        isOwner: { type: Boolean, default: false },

        roleId: { type: mongoose.Schema.Types.ObjectId, ref: "Role", default: null },

        // Checked on EVERY request, not just at login, so switching someone off
        // takes effect on their next action rather than whenever their token
        // happens to expire.
        isActive: { type: Boolean, default: true },

        // Bumped on deactivation and password change so anything that starts
        // checking it agrees with that decision.
        tokenVersion: { type: Number, default: 1 },

        lastLoginAt: { type: Date, default: null },
    },
    { timestamps: true }
);

// Sparse: most users have one of the two, not both, and several may have
// neither field populated — a null must not collide with another null.
businessUserSchema.index({ email: 1 }, { unique: true, sparse: true, partialFilterExpression: { email: { $type: "string", $ne: "" } } });
businessUserSchema.index({ phone: 1 }, { unique: true, sparse: true, partialFilterExpression: { phone: { $type: "string", $ne: "" } } });
businessUserSchema.index({ businessId: 1, isActive: 1 });

module.exports = mongoose.model("BusinessUser", businessUserSchema);
