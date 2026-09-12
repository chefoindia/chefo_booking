// models/BusinessUser.js — someone who signs into the operator dashboard.
//
// HOW PEOPLE SIGN IN
//
// The primary credential is the MOBILE NUMBER, verified by an SMS OTP through
// Firebase — the same phone identity, on the same Firebase project, as the
// rest of Chefo. No password is involved: proving control of the registered
// number is what authenticates. Owners register the same way, so a phone
// number is verified before an account exists at all.
//
// The ALTERNATIVE, offered behind a link rather than shown by default, is a
// login ID (or email) + password. It exists for staff who share a back-office
// machine or have no phone of their own. A password is only ever set
// deliberately — from Settings, or through the emailed reset code — which is
// what `passwordSet` below records.
//
// Forgotten passwords are recovered by a 4-digit code emailed to the address
// on the account (see routes/auth.js and services/mailer.js) — which is why
// an owner's email is required at registration.
//
// What is REUSED from the existing owner dashboard is the part that matters:
// a JWT in an httpOnly cookie, sliding renewal, per-request permission
// resolution, owner short-circuit.
const mongoose = require("mongoose");

const businessUserSchema = new mongoose.Schema(
    {
        businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },

        name: { type: String, required: true, trim: true },

        // Sign-in identifiers. Phone is primary (E.164, normalised at the
        // boundary); loginId and email are the alternatives. Each is globally
        // unique when set — the login lookup must resolve to one user.
        phone: { type: String, trim: true, default: "" },
        email: { type: String, lowercase: true, trim: true, default: "" },
        loginId: { type: String, lowercase: true, trim: true, default: "" },

        // bcrypt. Never selected by default — a route has to ask for it
        // explicitly, so no handler can leak it by returning the document.
        passwordHash: { type: String, required: true, select: false },

        // Did a HUMAN choose this password?
        //
        // An owner who signs up with a mobile OTP never picks one, but the
        // schema still needs a hash, so a long random value is generated and
        // thrown away. That value is unguessable and must never be presented
        // as a working credential: this flag is what lets Settings offer "Set
        // a password" instead of asking for a current password nobody has.
        passwordSet: { type: Boolean, default: true },

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

        // Which activity notices this person receives by email. Keyed by the
        // event ids in services/notify.js; a key that is absent falls back to
        // that event's default, so adding a new event later never needs a
        // migration. Only owners are emailed today; the field lives on the
        // user so a co-owner can tune their own inbox.
        notificationPrefs: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    { timestamps: true }
);

// Partial: a user may have any subset of the three identifiers, and several
// may leave one empty — an empty string must not collide with another.
const nonEmpty = (field) => ({ unique: true, partialFilterExpression: { [field]: { $type: "string", $ne: "" } } });
businessUserSchema.index({ email: 1 }, nonEmpty("email"));
businessUserSchema.index({ phone: 1 }, nonEmpty("phone"));
businessUserSchema.index({ loginId: 1 }, nonEmpty("loginId"));
businessUserSchema.index({ businessId: 1, isActive: 1 });

// "kitchen-a", "frontdesk2": 3–32 chars, letters/digits/dot/underscore/hyphen.
// Must not look like a phone number or an email, or the login lookup could
// match the wrong field.
const LOGIN_ID_RE = /^(?=.*[a-z])[a-z0-9._-]{3,32}$/;
businessUserSchema.statics.isValidLoginId = (v) => LOGIN_ID_RE.test(String(v || "").toLowerCase());

module.exports = mongoose.model("BusinessUser", businessUserSchema);
