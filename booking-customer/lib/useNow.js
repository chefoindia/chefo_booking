"use client";
// lib/useNow.js — a clock that ticks, for the one thing on this app that moves.
//
// "Closes in 12 minutes" is only true for a minute. A countdown that freezes on
// first render is worse than no countdown, because a customer reads it, takes
// their time, and finds the meal shut. So the screens that show a cut-off
// re-render on a timer.
//
// It stops when the tab is hidden and re-syncs the moment it comes back, so a
// phone left in a pocket for an hour never shows an hour-old number.
import { useEffect, useState } from "react";

export default function useNow(everyMs = 30000) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        let id = null;
        const start = () => {
            stop();
            setNow(Date.now());
            id = setInterval(() => setNow(Date.now()), everyMs);
        };
        const stop = () => { if (id) { clearInterval(id); id = null; } };
        const onVis = () => (document.hidden ? stop() : start());

        start();
        document.addEventListener("visibilitychange", onVis);
        return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
    }, [everyMs]);

    return now;
}
