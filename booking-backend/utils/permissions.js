// utils/permissions.js — what a business user can be allowed to do.
//
// Same design rule as the rest of Chefo: there is no `if (role === "manager")`
// anywhere. A role is a named bag of permission strings the owner assembles, so
// an operator can invent "Kitchen Lead" without a code release. Code asks about
// a PERMISSION, never a role name.
//
// A permission is `module.action`. Actions are only listed where they genuinely
// exist — offering a checkbox that controls nothing is worse than not offering
// it at all.

const perm = (mod, action) => `${mod}.${action}`;

// `owner: true` marks administration that stays with the business owner unless
// they deliberately delegate it. These are the permissions that can be used to
// obtain more permissions, so they are guarded harder in canGrant() below.
const MODULES = [
    {
        key: "dashboard", label: "Dashboard", actions: ["view"],
        hint: "Today's preparation counts and workload.",
    },
    {
        key: "bookings", label: "Bookings", actions: ["view", "create", "edit", "cancel"],
        hint: "Viewing bookings, and creating or amending them on a customer's behalf.",
    },
    {
        key: "requests", label: "Approval queue", actions: ["view", "resolve"],
        hint: "Accepting or rejecting late bookings, changes and cancellations.",
    },
    {
        key: "parties", label: "Booking parties", actions: ["view", "edit"],
        hint: "Customer and site contact records — treat as personal data.",
        sensitive: true,
    },
    {
        key: "menu", label: "Weekly menu", actions: ["view", "edit"],
        hint: "What is served each day — shown to customers on the booking page.",
    },
    {
        key: "reports", label: "Reports & exports", actions: ["view", "export"],
        hint: "Kitchen sheets, booking summaries, and downloading them as PDF or CSV.",
    },
    {
        key: "config", label: "Business configuration", actions: ["view", "edit"],
        hint: "Meal services, variants, cutoff times, booking rules and the QR poster.",
        owner: true,
    },
    {
        key: "users", label: "Team", actions: ["view", "create", "edit", "delete"],
        hint: "Who can sign into this dashboard.",
        owner: true,
    },
    {
        key: "roles", label: "Roles", actions: ["view", "create", "edit", "delete"],
        hint: "Roles and what each one is allowed to do.",
        owner: true,
    },
    {
        key: "audit", label: "Activity log", actions: ["view", "export"],
        hint: "The record of who did what, when. Read-only by nature.",
        owner: true,
    },
];

const ALL_PERMISSIONS = MODULES.flatMap((m) => m.actions.map((a) => perm(m.key, a)));
const PERMISSION_SET = new Set(ALL_PERMISSIONS);

const OWNER_ONLY = new Set(
    MODULES.filter((m) => m.owner).flatMap((m) => m.actions.map((a) => perm(m.key, a)))
);

const isValidPermission = (p) => PERMISSION_SET.has(String(p));

// Unknown entries are DROPPED rather than rejected, so one stale checkbox from
// an old client can't make an entire role un-saveable.
function sanitizePermissions(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map(String).filter(isValidPermission))];
}

/**
 * May this actor do this?
 *
 * The owner of a business always can — they are the top of their own tree, and
 * making them depend on a role would let them lock themselves out of their own
 * business by editing it.
 */
function can(actor, permission) {
    if (!actor) return false;
    if (actor.isOwner) return true;
    if (actor.isActive === false) return false;
    return Array.isArray(actor.permissions) && actor.permissions.includes(permission);
}

const canAny = (actor, perms) => perms.some((p) => can(actor, p));

/** Which modules to show in navigation — never the security boundary itself. */
function visibleModules(actor) {
    return MODULES
        .filter((m) => canAny(actor, m.actions.map((a) => perm(m.key, a))))
        .map((m) => m.key);
}

/**
 * PRIVILEGE ESCALATION GUARD. Can `actor` grant `permission` to someone else?
 *
 *   1. You cannot grant what you do not hold — otherwise anyone with roles.edit
 *      could mint themselves a role containing config.edit and own the business
 *      by lunchtime.
 *   2. Owner-only administration can only ever be delegated by the OWNER, never
 *      passed along a chain of delegates, or one delegate could quietly breed
 *      more of them.
 */
function canGrant(actor, permission) {
    if (!actor) return false;
    if (actor.isOwner) return true;
    if (OWNER_ONLY.has(permission)) return false;
    return can(actor, permission);
}

/** Splits a requested permission list into what this actor may actually hand out. */
function filterGrantable(actor, requested) {
    const clean = sanitizePermissions(requested);
    return {
        allowed: clean.filter((p) => canGrant(actor, p)),
        refused: clean.filter((p) => !canGrant(actor, p)),
    };
}

module.exports = {
    MODULES,
    ALL_PERMISSIONS,
    OWNER_ONLY,
    perm,
    isValidPermission,
    sanitizePermissions,
    can,
    canAny,
    visibleModules,
    canGrant,
    filterGrantable,
};
