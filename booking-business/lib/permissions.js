// lib/permissions.js — the client's view of what the signed-in user may do.
//
// THIS IS UX, NOT SECURITY. It decides what to render. Every action it hides is
// independently refused by the API, so deleting this file would make the UI
// messier, not less safe. The rule for using it: hide what would fail, and still
// handle a 403 coming back, because permissions can change between the shell
// loading and the click.
export function can(access, permission) {
    if (!access) return false;
    if (access.isOwner) return true;                 // owner = unrestricted
    if (!Array.isArray(access.permissions)) return false;
    return access.permissions.includes(permission);
}

export const canAny = (access, perms = []) =>
    Boolean(access) && (access.isOwner || perms.some((p) => can(access, p)));

// Which nav item needs which permission. Mirrors the backend's route guards, so
// the sidebar cannot offer a page whose data would come back 403.
export const NAV = [
    { key: "dashboard", label: "Today", href: "/dashboard", perms: ["dashboard.view"] },
    { key: "requests", label: "Approvals", href: "/dashboard/requests", perms: ["requests.view"] },
    { key: "bookings", label: "Bookings", href: "/dashboard/bookings", perms: ["bookings.view"] },
    { key: "parties", label: "Customers", href: "/dashboard/parties", perms: ["parties.view"] },
    { key: "config", label: "Settings", href: "/dashboard/settings", perms: ["config.view"] },
    { key: "team", label: "Team", href: "/dashboard/team", perms: ["users.view", "roles.view"] },
];

export const visibleNav = (access) => NAV.filter((n) => canAny(access, n.perms));
