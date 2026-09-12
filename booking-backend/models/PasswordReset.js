// models/PasswordReset.js — one outstanding "I forgot my password" attempt.
//
// The 4-digit code is emailed; only its HMAC is stored, so a database read
// never yields a usable code. Short-lived (10 minutes), single-use, and capped
// at a handful of guesses — a 4-digit space is 10,000 codes, which is only
// safe because nobody gets more than five tries at it.
const mongoose = require("mongoose");

const passwordResetSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessUser", required: true, index: true },
        codeHash: { type: String, required: true },
        // Where the code went, so the reset step can confirm it is talking
        // about the same attempt and the UI can say "sent to r•••@x.com".
        email: { type: String, required: true },
        attempts: { type: Number, default: 0 },
        expiresAt: { type: Date, required: true },
        consumedAt: { type: Date, default: null },
        ip: { type: String, default: "" },
    },
    { timestamps: true }
);

// Mongo drops the row itself once it expires — nothing to sweep.
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PasswordReset", passwordResetSchema);
