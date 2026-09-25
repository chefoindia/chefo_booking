"use client";
// components/BottomTabBar.js — four places and one action, always under a thumb.
//
// The raised button in the middle is the whole reason the app exists: book a
// meal. It opens the booking sheet over whichever tab you are on, so nobody
// has to find their way to a form. The four tabs around it are the words a
// customer would use — Home, Menu, Bookings, Profile — not the data model's.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, PATHS } from "@/components/Icons";

export default function BottomTabBar({ slug, onBook }) {
    const pathname = usePathname() || "";
    const base = `/b/${slug}`;

    const left = [
        { key: "home", label: "Home", href: base, icon: "home" },
        { key: "menu", label: "Menu", href: `${base}/menu`, icon: "menu" },
    ];
    const right = [
        { key: "bookings", label: "Bookings", href: `${base}/bookings`, icon: "calendar" },
        { key: "profile", label: "Profile", href: `${base}/profile`, icon: "profile" },
    ];
    const all = [...left, ...right];

    // Home is only Home when it is exactly Home — /book and /menu sit below it.
    const activeKey = all
        .filter((t) => (t.href === base ? pathname === base : pathname.startsWith(t.href)))
        .map((t) => t.key)
        .pop() || (pathname.startsWith(`${base}/book`) ? "home" : "");

    const tab = (t) => {
        const on = t.key === activeKey;
        return (
            <Link key={t.key} href={t.href} className={`tab-item ${on ? "active" : ""}`} aria-current={on ? "page" : undefined}>
                <Icon d={PATHS[t.icon]} size={22} sw={on ? 2.3 : 1.9} />
                <span className="tab-label">{t.label}</span>
            </Link>
        );
    };

    return (
        <nav className="tabbar" aria-label="Sections">
            {left.map(tab)}
            <div className="tab-book" style={{ position: "relative" }}>
                <button type="button" className="tab-book-btn" onClick={onBook} aria-label="Book a meal">
                    <Icon d={PATHS.plus} size={26} sw={2.6} />
                </button>
                <span className="tab-book-label">Book</span>
            </div>
            {right.map(tab)}
        </nav>
    );
}
