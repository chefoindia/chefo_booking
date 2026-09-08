// models/MealType.js — a meal SERVICE the business runs: Breakfast, Lunch,
// Snacks, "Night shift meal", anything.
//
// NOT AN ENUM. The existing Chefo products hardcode breakfast/lunch/dinner in
// their schemas; this one deliberately does not, because the market it targets
// (caterers, project sites, guest houses, stalls) does not share one vocabulary.
// Every read of a meal service goes through these rows.
//
// The cutoff lives here rather than on the business, because a business runs
// several services with genuinely different deadlines — the whole point of
// Scenario J: breakfast closes 07:00, lunch 10:30, dinner 16:30.
const mongoose = require("mongoose");

const mealTypeSchema = new mongoose.Schema(
    {
        businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },

        name: { type: String, required: true, trim: true },
        // Stable machine key. Used in URLs and CSV headers so a later rename
        // does not invalidate links or break saved reports.
        key: { type: String, required: true, trim: true, lowercase: true },

        // When the meal is actually served. Informational — shown to customers
        // and on the kitchen view. It does NOT gate anything; only the cutoff
        // does, and conflating the two is how "we serve until 2pm" silently
        // becomes "you may book until 2pm".
        startTime: { type: String, default: "" },  // "HH:MM"
        endTime: { type: String, default: "" },    // "HH:MM"

        /* ---- THE CUTOFF -----------------------------------------------------
           Empty string = NO CUTOFF: this service never closes and every booking
           is auto-confirmed. That is a real configuration (a stall that takes
           orders until it runs out), not a missing value.

           cutoffPreviousDay shifts the deadline to the evening before, for a
           kitchen that shops or preps the night before. */
        cutoffTime: { type: String, default: "" },      // "HH:MM"
        cutoffPreviousDay: { type: Boolean, default: false },

        // Off = customers cannot book it; existing bookings are untouched and
        // still count toward preparation.
        active: { type: Boolean, default: true },
        // Lets the operator hide a service from the customer form while keeping
        // it open for bookings they enter themselves at the counter.
        customerBookable: { type: Boolean, default: true },

        sortOrder: { type: Number, default: 0 },
    },
    { timestamps: true }
);

// One key per business. Partial on a soft-delete field is unnecessary here —
// meal types are deactivated, never deleted, so the key stays claimed.
mealTypeSchema.index({ businessId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("MealType", mealTypeSchema);
