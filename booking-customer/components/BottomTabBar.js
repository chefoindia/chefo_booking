"use client";
// components/BottomTabBar.js — four places, always one thumb away.
//
// Four and not five: every extra tab is a decision somebody has to make before
// they can eat. Home answers "can I book right now"; Menu answers "what is it";
// Bookings answers "what did I book, and can I still change it"; Profile is
// where the optional account lives. Nothing else earns a permanent seat.
//
// The labels are the words a customer would use, not the words the data model
// uses — "Bookings", not "Requests"; "Menu", not "Weekly menu".
import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS = {
    home: "M3 10.2 12 3l9 7.2V21H3z",
    menu: "M4 5h16M4 12h16M4 19h10",
    calendar: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4",
    profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4.5 20.5a7.5 7.5 0 0 1 15 0",
};

export default function BottomTabBar({ slug }) {
    const pathname = usePathname() || "";
    const base = `/b/${slug}`;

    const tabs = [
        { key: "home", label: "Home", href: base, icon: "home" },
        { key: "menu", label: "Menu", href: `${base}/menu`, icon: "menu" },
        { key: "bookings", label: "Bookings", href: `${base}/bookings`, icon: "calendar" },
        { key: "profile", label: "Profile", href: `${base}/profile`, icon: "profile" },
    ];

    // Home is only Home when it is exactly Home — /book and /menu are below it,
    // not it.
    const activeKey = tabs
        .filter((t) => (t.href === base ? pathname === base : pathname.startsWith(t.href)))
        .map((t) => t.key)
        .pop() || (pathname.startsWith(`${base}/book`) ? "home" : "");

    return (
        <nav className="tabbar" aria-label="Sections">
            {tabs.map((t) => {
                const on = t.key === activeKey;
                return (
                    <Link key={t.key} href={t.href}
                        className={`tab-item ${on ? "active" : ""}`}
                        aria-current={on ? "page" : undefined}>
                        <svg width="21" height="21" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth={on ? 2.2 : 1.8}
                            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d={ICONS[t.icon]} />
                        </svg>
                        <span className="tab-label">{t.label}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
