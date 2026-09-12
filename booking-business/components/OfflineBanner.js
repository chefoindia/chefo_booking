"use client";
// components/OfflineBanner.js — a persistent "You're offline" bar, mounted once
// in the root layout so it's visible no matter which page is open.
import { useEffect, useState } from "react";

function WifiOffIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="2" y1="2" x2="22" y2="22" />
            <path d="M8.5 16.5a5 5 0 0 1 7 0" />
            <path d="M5 12.5a10 10 0 0 1 5.5-3.5" />
            <path d="M19 12.5a10 10 0 0 0-2.5-2.2" />
            <path d="M1.5 9a15 15 0 0 1 4.5-3.5" />
            <path d="M22.5 9a15 15 0 0 0-6-4" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
    );
}

export default function OfflineBanner() {
    const [offline, setOffline] = useState(false);

    useEffect(() => {
        setOffline(!navigator.onLine);
        const goOffline = () => setOffline(true);
        const goOnline = () => setOffline(false);
        window.addEventListener("offline", goOffline);
        window.addEventListener("online", goOnline);
        return () => {
            window.removeEventListener("offline", goOffline);
            window.removeEventListener("online", goOnline);
        };
    }, []);

    if (!offline) return null;

    return (
        <div className="offline-bar" role="status">
            <WifiOffIcon />
            You&apos;re offline — showing what was last loaded
        </div>
    );
}
