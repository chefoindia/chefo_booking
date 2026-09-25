// models/AuditLog.js — who did what to a booking, and when.
//
// Bookings drive food preparation and money, and an operator can accept or
// reject a request that changes both. When someone asks "why are we cooking 200
// and not 185", this is the answer. Written by services/audit.js after the
// change succeeds, never before.
const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
    {
        businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },

        // Exactly one of these is set. An operator acted, or a customer did
        // through the public form — which is what makes "who" unambiguous.
        actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessUser", default: null },
        actorPartyId: { type: mongoose.Schema.Types.ObjectId, ref: "BookingParty", default: null },
        actorName: { type: String, default: "" },
        actorKind: { type: String, enum: ["operator", "customer", "system"], default: "operator" },

        // Past tense, human readable: "Accepted a change request".
        action: { type: String, required: true },

        bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null },
        // The outlet the affected booking belongs to, when there is one, so the
        // activity log can be read per outlet. Copied from the booking at write
        // time; null for business-level actions and for pre-outlet bookings.
        outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet", default: null },
        requestId: { type: mongoose.Schema.Types.ObjectId, ref: "BookingRequest", default: null },
        partyId: { type: mongoose.Schema.Types.ObjectId, ref: "BookingParty", default: null },

        // Quantities before and after, when the action moved them. The kitchen
        // number is the thing worth being able to reconstruct.
        before: { type: mongoose.Schema.Types.Mixed, default: null },
        after: { type: mongoose.Schema.Types.Mixed, default: null },
        details: { type: mongoose.Schema.Types.Mixed, default: {} },

        ip: { type: String, default: "" },
        userAgent: { type: String, default: "" },
    },
    { timestamps: true }
);

auditLogSchema.index({ businessId: 1, createdAt: -1 });
auditLogSchema.index({ businessId: 1, outletId: 1, createdAt: -1 });
auditLogSchema.index({ bookingId: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
