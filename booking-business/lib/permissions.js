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
// the sidebar cannot offer a page whose data would come back 403. `icon` keys
// into the icon set in components/Sidebar.js. `section` groups the sidebar.
export const NAV = [
    { key: "dashboard", label: "Today", href: "/dashboard", exact: true, icon: "overview", perms: ["dashboard.view"], section: "Operate" },
    { key: "requests", label: "Approvals", href: "/dashboard/requests", icon: "requests", perms: ["requests.view"], section: "Operate" },
    { key: "bookings", label: "Bookings", href: "/dashboard/bookings", icon: "bookings", perms: ["bookings.view"], section: "Operate" },
    { key: "parties", label: "Customers", href: "/dashboard/parties", icon: "customers", perms: ["parties.view"], section: "Operate" },
    { key: "menu", label: "Weekly menu", href: "/dashboard/menu", icon: "menu", perms: ["menu.view"], section: "Kitchen" },
    { key: "reports", label: "Reports", href: "/dashboard/reports", icon: "reports", perms: ["reports.view"], section: "Kitchen" },
    { key: "qr", label: "QR poster", href: "/dashboard/qr", icon: "qr", perms: ["config.view"], section: "Grow" },
    { key: "team", label: "Team", href: "/dashboard/team", icon: "users", perms: ["users.view", "roles.view"], section: "Manage" },
    { key: "audit", label: "Activity log", href: "/dashboard/logs", icon: "audit", perms: ["audit.view"], section: "Manage" },
    { key: "config", label: "Settings", href: "/dashboard/settings", icon: "settings", perms: ["config.view"], section: "Manage" },
];

export const visibleNav = (access) => NAV.filter((n) => canAny(access, n.perms));
