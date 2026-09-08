// models/MealVariant.js — the categories a booking's quantity is split across:
// Veg, Non-Veg, Jain, Egg, Thali A, whatever this business actually serves.
//
// NOT Veg/Non-Veg. That pair is hardcoded throughout the existing Cafeteria
// product and it is the single biggest thing that stops it fitting a caterer or
// a guest house. Here the set is data, so a booking form and a kitchen count
// both render from configuration.
//
// A booking stores a SNAPSHOT of the variant's name alongside its id (see
// Booking.lines), so renaming "Non-Veg" to "Chicken" next month does not
// silently rewrite what last month's kitchen sheets said.
const mongoose = require("mongoose");

const mealVariantSchema = new mongoose.Schema(
    {
        businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },

        name: { type: String, required: true, trim: true },
        key: { type: String, required: true, trim: true, lowercase: true },

        // Optional. Pricing is deliberately not the point of V1 — this exists so
        // a price can be attached without redesigning the booking model later,
        // and is simply ignored while the business leaves it at 0.
        price: { type: Number, default: 0, min: 0 },

        // Deactivated variants stay on historical bookings and keep counting
        // toward those days' preparation; they just leave the booking form.
        active: { type: Boolean, default: true },

        // Restricts a variant to certain meal services — "Thali A" may be a
        // lunch-only thing. Empty = available for every meal service, which is
        // the common case and therefore the default.
        mealTypeIds: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: "MealType" }],
            default: [],
        },

        // Shown on the booking form and on the kitchen count, in this order, so
        // the operator's mental order ("veg first") is the one everyone sees.
        sortOrder: { type: Number, default: 0 },

        // Free-text hint under the option on the customer form.
        description: { type: String, default: "" },
    },
    { timestamps: true }
);

mealVariantSchema.index({ businessId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("MealVariant", mealVariantSchema);
