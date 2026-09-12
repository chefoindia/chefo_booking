// models/WeeklyMenu.js — what is served, per meal service, per day of the week.
//
// One document per (business, meal service, weekday). Inside it, the menu is
// split by meal OPTION — Veg gets "Dal tadka, jeera rice, salad", Non-Veg gets
// "Chicken curry, rice" — because that is how the customer chooses and how the
// kitchen cooks. An option that has no entry for a day simply shows nothing.
//
// The weekday, not the date: this is the recurring plan. The customer booking
// page resolves a date to its weekday and shows this. (Date-specific specials
// can layer on top later without touching this shape.)
//
// The option NAME is snapshotted next to its id for the same reason bookings
// do it — a renamed option must not make last week's printed menu lie.
const mongoose = require("mongoose");

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const entrySchema = new mongoose.Schema(
    {
        variantId: { type: mongoose.Schema.Types.ObjectId, ref: "MealVariant", required: true },
        variantName: { type: String, required: true },
        // The dishes, one per line as the owner typed them. Free text on
        // purpose: "Dal makhani (less oil)" is a menu item, not a schema.
        items: { type: [String], default: [] },
    },
    { _id: false }
);

const weeklyMenuSchema = new mongoose.Schema(
    {
        businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
        mealTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "MealType", required: true },
        weekday: { type: String, enum: WEEKDAYS, required: true },
        entries: { type: [entrySchema], default: [] },
        // Shown under the day's menu on the booking page — "Kitchen closed
        // after 2 PM today", "Festival special".
        note: { type: String, default: "", maxlength: 200 },
        // Off = this service isn't served that day at all. The booking page
        // says so instead of showing an empty menu.
        served: { type: Boolean, default: true },
        updatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessUser", default: null },
    },
    { timestamps: true }
);

weeklyMenuSchema.index({ businessId: 1, mealTypeId: 1, weekday: 1 }, { unique: true });

module.exports = mongoose.model("WeeklyMenu", weeklyMenuSchema);
module.exports.WEEKDAYS = WEEKDAYS;
