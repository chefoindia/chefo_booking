// services/notify.js — emails the business owner when something sensitive
// happens: someone is added to the team, a role gains permissions, a meal
// service is deactivated, a password changes, data is exported.
//
// FIRE-AND-FORGET, like the audit log: a notice must never fail or slow the
// action it describes. It is sent AFTER the change succeeded, so it reports
// what happened rather than what was attempted.
//
// Every event is in the catalogue below with a default; the owner switches
// each one on or off under Settings → Notifications (BusinessUser.
// notificationPrefs). Owners are the recipients — they are the ones with the
// standing to act on "somebody just gave themselves config.edit".
const BusinessUser = require("../models/BusinessUser");
const Business = require("../models/Business");
const mailer = require("./mailer");

/**
 * THE CATALOGUE. `key` is what code raises; `label`/`hint` are what the owner
 * reads on the toggle. Grouped so the settings page can lay them out.
 */
const EVENTS = [
    { key: "team.added", group: "Team", label: "A team member is added", hint: "Someone new can now sign into this dashboard.", default: true },
    { key: "team.removed", group: "Team", label: "A team member is removed or deactivated", hint: "Their access ended.", default: true },
    { key: "team.changed", group: "Team", label: "A team member's role or sign-in details change", hint: "Includes a role reassignment or a password set for them.", default: true },
    { key: "roles.changed", group: "Team", label: "A role is created, edited or archived", hint: "Permissions granted through a role apply to everyone holding it.", default: true },

    { key: "config.removed", group: "Configuration", label: "A meal service or option is deactivated", hint: "It leaves the customer booking page.", default: true },
    { key: "config.changed", group: "Configuration", label: "Business profile, booking rules or customer types change", hint: "Includes switching bookings off.", default: false },
    { key: "menu.changed", group: "Configuration", label: "The weekly menu changes", hint: "What customers see for a day changes.", default: false },

    { key: "security.password", group: "Security", label: "A password is set, changed or reset", hint: "On any account in this business, including your own.", default: true },
    { key: "security.login", group: "Security", label: "A sign-in with a login ID and password", hint: "The password route, which does not need the phone. Mobile-OTP sign-ins are not emailed.", default: true },

    { key: "bookings.cancelled", group: "Bookings", label: "Staff cancel a confirmed booking", hint: "Cancellations made from the dashboard, not by the customer.", default: false },
    { key: "data.export", group: "Data", label: "A report or customer list is exported", hint: "Someone downloaded bookings, a kitchen sheet or the activity log.", default: true },
];
const EVENT_BY_KEY = new Map(EVENTS.map((e) => [e.key, e]));

// Stored with underscores ("security_login"): a dotted key inside a Mongoose
// Mixed field is read as a nested path on save, and express-mongo-sanitize
// strips dotted keys from request bodies anyway. The API speaks dotted keys;
// only the persisted shape differs.
const storeKey = (key) => String(key).replace(/\./g, "_");

/** The owner's effective preference for one event, defaults applied. */
function prefFor(prefs, key) {
    const ev = EVENT_BY_KEY.get(key);
    if (!ev) return false;
    const sk = storeKey(key);
    const v = prefs && Object.prototype.hasOwnProperty.call(prefs, sk) ? prefs[sk] : undefined;
    return typeof v === "boolean" ? v : ev.default;
}

/** Whole preference map with defaults filled in, for the settings page. */
function effectivePrefs(prefs) {
    return Object.fromEntries(EVENTS.map((e) => [e.key, prefFor(prefs, e.key)]));
}

const fmtWhen = (d = new Date()) =>
    d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST";

/** "Chrome on Windows" from a user-agent string — enough to recognise a device. */
function deviceLabel(ua = "") {
    const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Unknown device";
    const br = /Edg\//i.test(ua) ? "Edge" : /Chrome\//i.test(ua) ? "Chrome" : /Firefox\//i.test(ua) ? "Firefox" : /Safari\//i.test(ua) ? "Safari" : "a browser";
    return `${br} on ${os}`;
}

/**
 * Raise an event. Resolves the business's owners, applies each one's
 * preferences, and emails those who want it. Never throws.
 *
 * @param {string} key      one of EVENTS[].key
 * @param {object} opts
 *   businessId    required
 *   actor         { userId, name } — who did it (null for the customer/system)
 *   title         short heading, e.g. "Team member added"
 *   summary       one plain sentence
 *   rows          [{label, value}] the facts
 *   concern       what to do if it wasn't expected (optional, per event)
 *   requestMeta   { ip, userAgent } for the "from" line
 */
function notify(key, { businessId, actor = null, title, summary, rows = [], concern, requestMeta = {} } = {}) {
    if (!businessId || !EVENT_BY_KEY.has(key) || !mailer.isConfigured()) return;

    (async () => {
        const [business, owners] = await Promise.all([
            Business.findById(businessId).select("name").lean(),
            BusinessUser.find({ businessId, isOwner: true, isActive: { $ne: false }, email: { $ne: "" } })
                .select("name email notificationPrefs").lean(),
        ]);
        if (!business) return;

        const facts = [
            ...rows,
            { label: "By", value: actor?.name ? actor.name : "Customer / system" },
            { label: "When", value: fmtWhen() },
            ...(requestMeta.ip ? [{ label: "From", value: `${deviceLabel(requestMeta.userAgent)} · ${requestMeta.ip}` }] : []),
            { label: "Business", value: business.name },
        ];

        for (const owner of owners) {
            if (!prefFor(owner.notificationPrefs, key)) continue;
            const mail = mailer.activityNoticeEmail({
                title, summary, rows: facts, concern, businessName: business.name,
            });
            mailer.sendMail({ to: owner.email, toName: owner.name, ...mail })
                .catch((e) => console.error(`notify(${key}) failed:`, e.message));
        }
    })().catch((e) => console.error(`notify(${key}) failed:`, e.message));
}

const CONCERN = {
    access: "Open Team in your dashboard, remove the account or role you don't recognise, and change your password. Every other session is signed out when you do.",
    config: "Open Settings and put the configuration back. If you don't recognise who made the change, review Team and change your password.",
    security: "If you did not do this, use Forgot password on the sign-in page immediately to take back the account — that ends every existing session.",
    data: "If nobody on your team should have downloaded this, review who holds the reports and audit permissions under Team.",
};

module.exports = { EVENTS, notify, prefFor, effectivePrefs, storeKey, CONCERN, deviceLabel };
