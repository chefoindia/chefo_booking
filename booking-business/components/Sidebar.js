"use client";
// components/Sidebar.js — primary navigation, same shell as the Chefo owner
// dashboard. Items come from lib/permissions.js NAV, filtered by what THIS
// person may open, and grouped under sections. Presentation only: every
// destination is also enforced by the API.
//
// The sections COLLAPSE. Ten links under four headings is still ten links to
// read past, and on a counter tablet most of them are opened once a month —
// Weekly menu, Team, Settings. Operate is where somebody lives all day, so a
// section stays open when it holds the page you are on, and whatever you open
// or close is remembered on that device.
//
// Below 860px the sidebar is an off-screen drawer opened via the Topbar's
// hamburger and closed via the close button, the backdrop, or navigating.
import InstallApp from "@/components/InstallApp";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { visibleNav } from "@/lib/permissions";

const OPEN_KEY = "chefo-booking-nav-open";

// Inline SVG icons, keyed by nav item icon. 18px, inherit currentColor.
const ICONS = {
    overview: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
    customers: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" /><path d="M17.5 20a5.5 5.5 0 0 0-2.4-4.5" /></>,
    bookings: <><rect x="3" y="4" width="18" height="17" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /><polyline points="9 14 11 16 15 12.5" /></>,
    requests: <><path d="M4 5h16v10H8l-4 4z" /><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="12" x2="13" y2="12" /></>,
    menu: <><path d="M6 3v7a2 2 0 0 0 4 0V3" /><line x1="8" y1="10" x2="8" y2="21" /><path d="M16 3c-1.5 0-2.5 2-2.5 5s1 4 2.5 4v9" /></>,
    reports: <><path d="M4 4v16h16" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="13" width="3" height="4" /></>,
    scan: <><path d="M3 8.5V5.5A2.5 2.5 0 0 1 5.5 3h3" /><path d="M15.5 3h3A2.5 2.5 0 0 1 21 5.5v3" /><path d="M21 15.5v3a2.5 2.5 0 0 1-2.5 2.5h-3" /><path d="M8.5 21h-3A2.5 2.5 0 0 1 3 18.5v-3" /><line x1="6" y1="12" x2="18" y2="12" /></>,
    qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="5.5" y="5.5" width="2" height="2" /><rect x="16.5" y="5.5" width="2" height="2" /><rect x="5.5" y="16.5" width="2" height="2" /><path d="M14 14h3v3h-3zM19 14h2M14 19h2M19 19h2v2" /></>,
    users: <><circle cx="8.5" cy="8" r="3.2" /><path d="M2.5 20a6 6 0 0 1 12 0" /><circle cx="17.5" cy="9.5" r="2.4" /><path d="M15 20a5 5 0 0 1 6.5-4.3" /></>,
    audit: <><path d="M4 4h12l4 4v12H4z" /><path d="M16 4v4h4" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="8" y1="16" x2="13" y2="16" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4 13.4H3.9a2 2 0 0 1 0-4H4a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 4h.1a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z" /></>,
};

function NavIcon({ name }) {
    const paths = ICONS[name] || ICONS.overview;
    return (
        <svg className="side-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {paths}
        </svg>
    );
}

const isActive = (item, pathname) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

export default function Sidebar({ access, user, onLogout, open, onClose }) {
    const pathname = usePathname();
    const nav = visibleNav(access);
    const sections = [...new Set(nav.map((n) => n.section))];

    // null until the device has been asked, so the first paint never collapses
    // a section the operator had left open.
    const [openSections, setOpenSections] = useState(null);

    useEffect(() => {
        let saved = null;
        try {
            const raw = localStorage.getItem(OPEN_KEY);
            if (raw) saved = JSON.parse(raw);
        } catch { /* private mode — the default below is used every visit */ }
        setOpenSections(saved && typeof saved === "object" ? saved : {});
    }, []);

    const toggle = (section) => {
        setOpenSections((prev) => {
            const next = { ...(prev || {}), [section]: !sectionOpen(section, prev) };
            try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); }
            catch { /* not worth telling anybody about */ }
            return next;
        });
    };

    // A section is open when it was left open, and ALWAYS when it holds the
    // page currently on screen — a collapsed section hiding the active link
    // would leave the sidebar with nothing highlighted.
    function sectionOpen(section, state = openSections) {
        const holdsActive = nav.some((n) => n.section === section && isActive(n, pathname));
        if (holdsActive) return true;
        if (state && Object.prototype.hasOwnProperty.call(state, section)) return Boolean(state[section]);
        // First visit: the section people work in stays open, the rest fold away.
        return section === "Operate";
    }

    return (
        <nav className={`sidebar ${open ? "open" : ""}`} aria-label="Dashboard navigation">
            <div className="sidebar-brand">
                <Image src="/chefo-mark.png" alt="Chefo" width={36} height={36} />
                <div style={{ minWidth: 0, lineHeight: 1.15 }}>
                    <div>Chefo</div>
                    <div className="brand-sub">Booking</div>
                </div>
                <button className="sidebar-close" onClick={onClose} aria-label="Close menu">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>

            <div className="sidebar-nav">
                {sections.map((section) => {
                    const items = nav.filter((n) => n.section === section);
                    const isOpen = sectionOpen(section);
                    return (
                        <div key={section} className="side-section">
                            {sections.length > 1 && (
                                <button type="button"
                                    className={`side-section-title ${isOpen ? "open" : ""}`}
                                    aria-expanded={isOpen}
                                    onClick={() => toggle(section)}>
                                    <svg className="side-caret" width="11" height="11" viewBox="0 0 24 24"
                                        fill="none" stroke="currentColor" strokeWidth="3"
                                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <polyline points="9 6 15 12 9 18" />
                                    </svg>
                                    <span>{section}</span>
                                </button>
                            )}

                            {isOpen && items.map((item) => (
                                <Link key={item.key} href={item.href}
                                    className={`side-link ${isActive(item, pathname) ? "active" : ""}`}>
                                    <NavIcon name={item.icon} />
                                    <span className="side-link-label">{item.label}</span>
                                </Link>
                            ))}
                        </div>
                    );
                })}
            </div>

            <div className="sidebar-foot">
                {/* Renders nothing once the dashboard is already running as an
                    installed app, so it never offers to install itself. */}
                <InstallApp className="side-link side-install" label="Get the app" />
                <div className="side-user">
                    <strong>{user?.name}</strong>
                    {user?.isOwner ? "Owner" : (user?.roleName || "No role yet")}
                </div>
                <button className="side-link side-logout" onClick={onLogout}>Log out</button>
            </div>
        </nav>
    );
}
