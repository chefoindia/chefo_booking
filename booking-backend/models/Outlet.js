// models/Outlet.js — one serving point of a business: "Main Cafeteria",
// "Block A", "Guest House", "Project Site".
//
// A business (the tenant) runs any number of outlets, and every NEW booking
// belongs to exactly one of them. The outlet is NOT a second tenant: it has
// no users of its own, no meal services of its own, no configuration of its
// own. It is a dimension on the booking, the same way the meal service is —
// which is why everything here still carries businessId and every query on
// this collection filters on it. One canteen can never see, reference or book
// against another canteen's outlet.
//
// Deactivated, never deleted: bookings reference outlets by id, and a kitchen
// sheet from March must still say "Block A" after Block A closes in June. The
// name is also snapshotted onto each booking (Booking.outletName) for exactly
// that reason.
const mongoose = require("mongoose");

const outletSchema = new mongoose.Schema(
    {
        businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },

        name: { type: String, required: true, trim: true, maxlength: 60 },
        // Stable machine key derived from the name at creation, so a rename
        // never invalidates a saved report or a filter someone bookmarked.
        key: { type: String, required: true, trim: true, lowercase: true },

        // Where it is, for the customer's outlet picker and the counter screen.
        description: { type: String, default: "", maxlength: 160 },
        addressLine: { type: String, default: "", maxlength: 200 },
        contactPhone: { type: String, default: "", maxlength: 20 },

        // Off = not selectable for NEW bookings. Existing bookings keep their
        // outlet and still count; staff assigned here still see history.
        active: { type: Boolean, default: true },

        sortOrder: { type: Number, default: 0 },
        createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessUser", default: null },
    },
    { timestamps: true }
);

// One key per business. The same name at two canteens is two outlets.
outletSchema.index({ businessId: 1, key: 1 }, { unique: true });
// The picker query: active outlets of this business, in display order.
outletSchema.index({ businessId: 1, active: 1, sortOrder: 1 });

module.exports = mongoose.model("Outlet", outletSchema);
