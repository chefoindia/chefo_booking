// models/Business.js — one food provider. The tenant boundary for everything
// else in this product: every other collection carries `businessId`, and every
// query filters on it.
const mongoose = require("mongoose");

const businessSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },

        // The customer-facing URL segment: /b/<slug>. Immutable in practice —
        // changing it breaks links already handed to customers — so the UI
        // does not offer it after creation.
        slug: {
            type: String, required: true, unique: true, lowercase: true, trim: true,
            match: /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/,
        },

        logoUrl: { type: String, default: "" },
        contactPhone: { type: String, default: "" },
        contactEmail: { type: String, default: "" },
        addressLine: { type: String, default: "" },
        city: { type: String, default: "" },
        landmark: { type: String, default: "" },

        // Minutes east of UTC. India is +330 and has no DST; this exists so the
        // cutoff maths has one place to change if Chefo ever serves a business
        // in another zone. See utils/time.js.
        timezoneOffsetMinutes: { type: Number, default: 330 },

        // Closed businesses still show their bookings to the operator; they
        // just stop accepting new ones from the customer side.
        acceptingBookings: { type: Boolean, default: true },
        closedMessage: { type: String, default: "" },

        /* ---- BOOKING RULES ------------------------------------------------
           Deliberately a small, flat set. Each one exists because a real
           operator would reasonably want it different; nothing speculative is
           configured here just because it could be. */
        rules: {
            // How far ahead a customer may book. 0 = today only.
            maxDaysAhead: { type: Number, default: 14, min: 0, max: 365 },
            // Largest quantity a single booking may carry, as a guard against a
            // fat finger turning into 5,000 plates. Operators can raise it.
            maxQuantityPerBooking: { type: Number, default: 500, min: 1 },
            // Before cutoff, may the customer amend / cancel their own booking?
            // AFTER the cutoff they never can — that is the product's core rule
            // and is NOT configurable.
            allowCustomerEditBeforeCutoff: { type: Boolean, default: true },
            allowCustomerCancelBeforeCutoff: { type: Boolean, default: true },
            // DEAD, kept so existing documents still validate. They used to
            // gate after-cutoff change / cancellation REQUESTS, and there are
            // no requests any more. Nothing reads them.
            allowCustomerChangeRequestAfterCutoff: { type: Boolean, default: true },
            allowCustomerCancelRequestAfterCutoff: { type: Boolean, default: true },
            // Which customer fields the booking form demands. Name and phone
            // are always required — phone is the party identity, so it cannot
            // be optional.
            requireOrganisation: { type: Boolean, default: false },
            requireLocation: { type: Boolean, default: false },
            requireNote: { type: Boolean, default: false },
        },

        /* ---- PARTY TYPES ---------------------------------------------------
           Individual and Group cover the cases we know about, but a caterer may
           want "Corporate", "Event", "Walk-in". Stored per business so the
           booking form and filters read from configuration, not from a
           hardcoded enum. */
        partyTypes: {
            type: [
                {
                    key: { type: String, required: true, trim: true },
                    label: { type: String, required: true, trim: true },
                    active: { type: Boolean, default: true },
                    // A group booking asks for an organisation/site name.
                    isGroup: { type: Boolean, default: false },
                },
            ],
            default: () => ([
                { key: "individual", label: "Individual", active: true, isGroup: false },
                { key: "group", label: "Group / Site", active: true, isGroup: true },
            ]),
        },

        /* ---- CUSTOM BOOKING QUESTIONS ---------------------------------------
           The escape hatch that stops `rules` growing a boolean per customer.
           A hostel wants a room number, a project site wants a gate pass, a
           guest house wants an arrival time — none of those belong in a schema
           every business shares, so the business defines its own questions and
           the booking form renders them.

           `key` is the STABLE identity and `label` is the display text: renaming
           the label must not orphan the answers already recorded against the
           key. Fields are deactivated rather than deleted for the same reason —
           and because answers are snapshotted onto the booking, removing a
           question here never rewrites what an old booking said.

           Empty mealTypeKeys / partyTypeKeys mean "everywhere". Scoping exists
           because "which shift?" is a dinner question, and asking it at
           breakfast is how a form becomes noise people stop reading. */
        bookingFields: {
            type: [
                {
                    key: { type: String, required: true, trim: true },
                    label: { type: String, required: true, trim: true },
                    type: {
                        type: String,
                        enum: ["text", "textarea", "number", "tel", "email", "select", "date", "checkbox"],
                        default: "text",
                    },
                    // Only meaningful for type "select"; ignored otherwise.
                    options: { type: [String], default: [] },
                    placeholder: { type: String, default: "" },
                    help: { type: String, default: "" },
                    required: { type: Boolean, default: false },
                    active: { type: Boolean, default: true },
                    // Empty = applies to every meal service / party type.
                    mealTypeKeys: { type: [String], default: [] },
                    partyTypeKeys: { type: [String], default: [] },
                    sortOrder: { type: Number, default: 0 },
                },
            ],
            default: () => ([]),
        },

        // Human-readable booking references are BK-<counter> per business, so
        // two businesses can both have BK-1041 without collision. Incremented
        // atomically ($inc) when a booking is created.
        bookingCounter: { type: Number, default: 0 },

        // The QR poster the owner designed (see the dashboard's QR page):
        // theme, element positions, text. Stored as-is because it is a
        // presentation document owned entirely by the client-side editor;
        // the server only keeps it and hands it back.
        qrPoster: { type: mongoose.Schema.Types.Mixed, default: null },

        // WHEN THE SIGNUP WIZARD WAS FINISHED. null means the owner verified
        // their mobile — so the tenant and the account genuinely exist — but
        // never got past the business-details step. The dashboard sends them
        // back to finish rather than showing an empty shell, exactly as the
        // canteen owner portal does with businessSetupPending.
        setupCompletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

module.exports = mongoose.model("Business", businessSchema);
