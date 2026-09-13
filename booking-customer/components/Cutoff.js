"use client";
// components/Cutoff.js — the deadline, said the same way everywhere.
//
// A meal's booking window is the one thing in this app that can turn a working
// booking into a request while the customer is still typing. It used to be a
// badge saying "Needs approval" in one place and a sentence about "the day
// before" in another, and neither said how long was left. Now every screen
// renders these two, both fed by cutoffInfo(), so the meal list, the calendar,
// the menu and the form can never word it differently or disagree.
import { cutoffInfo, TONE_CLASS } from "@/lib/format";
import useNow from "@/lib/useNow";

/** The short version — a chip beside a meal's name. */
export function CutoffBadge({ meal, today }) {
    const now = useNow(30000);
    const info = cutoffInfo(meal, now, today);
    if (!info.badge) return null;
    return <span className={`badge ${TONE_CLASS[info.tone]}`}>{info.badge}</span>;
}

/** The full sentence — one line under a meal, or inside a notice. */
export function CutoffLine({ meal, today, className = "" }) {
    const now = useNow(30000);
    const info = cutoffInfo(meal, now, today);
    if (!info.line) return null;
    return (
        <span className={`cut-line cut-${info.tone} ${className}`}>
            <span className="cut-dot" aria-hidden="true" />
            <span>{info.line}</span>
        </span>
    );
}

/**
 * The closed case, spelled out — shown once, above the form, when the customer
 * has picked a meal whose window has already shut.
 *
 * It says three things in order, because all three matter and only the first
 * is obvious: it is closed, when it closed, and what can still be done. The
 * canteen may still take a late one, but the customer is told plainly that it
 * is no longer their decision.
 */
export function CutoffNotice({ meal, today, businessName, canRequest = true }) {
    const now = useNow(30000);
    const info = cutoffInfo(meal, now, today);

    if (info.state === "not-served") {
        return <div className="notice notice-bad">{info.line} Pick another day or another meal.</div>;
    }
    if (info.state === "closed") {
        return (
            <div className="notice notice-warn">
                <strong>Booking has closed for {meal.name}.</strong>{" "}
                {info.line.replace(/^Booking for [^,]+ closed/, "It closed")}{" "}
                {canRequest
                    ? `You can still send this as a request — ${businessName || "the canteen"} has to accept it before you're counted, and they may already have started cooking.`
                    : "Nothing more can be booked for this meal."}
            </div>
        );
    }
    if (info.state === "closing") {
        return <div className="notice notice-warn">{info.line}</div>;
    }
    if (info.state === "open" || info.state === "no-cutoff") {
        return <div className="notice notice-ok">{info.line}</div>;
    }
    return null;
}
