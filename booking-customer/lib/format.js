// lib/format.js — display helpers. Business dates are "YYYY-MM-DD" keys, which
// are calendar facts, so they are formatted as UTC to stop the browser's own
// timezone shifting them by a day.
export function formatDate(dateKey, opts = {}) {
    if (!dateKey) return "";
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
        weekday: "short", day: "numeric", month: "short",
        ...(opts.year ? { year: "numeric" } : {}),
        timeZone: "UTC",
    });
}

export function formatTime(hhmm) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${period}`;
}

export const todayKey = () =>
    new Date().toLocaleString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 10);

export function shiftDate(dateKey, days) {
    const [y, m, d] = dateKey.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
}

export const prettyPhone = (p) => {
    const s = String(p || "");
    const m = s.match(/^\+(\d{1,3})(\d{5})(\d{5})$/);
    return m ? `+${m[1]} ${m[2]} ${m[3]}` : s;
};

// Relative time for the approval queue — "waiting 12 min" is what tells an
// operator which request has been sitting there.
export function timeAgo(iso) {
    if (!iso) return "";
    const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 60) return "just now";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
}

export const STATUS_LABEL = {
    confirmed: "Confirmed",
    pending_approval: "Pending approval",
    rejected: "Rejected",
    cancelled: "Cancelled",
};

export const REQUEST_TYPE_LABEL = {
    new_booking: "Late booking",
    change: "Change request",
    cancellation: "Cancellation request",
};

/* ------------------------------------------------------------------ */
/* Cut-off, in words                                                    */
/* ------------------------------------------------------------------ */
// Every meal carries a cut-off — the moment the kitchen stops counting. A
// customer who arrives after it can no longer just book; the canteen has to
// accept them. That is the single most important thing this app has to say,
// and "cutoffPassed: true" is not a sentence anyone reads. So it is said in
// plain words, with the clock time next to it, in one place used by every
// screen: the meal list, the calendar, the booking form and the overview.

/** A span of milliseconds as a person would say it. Never negative. */
export function relSpan(ms) {
    const s = Math.max(0, Math.floor(Number(ms) || 0) / 1000);
    if (s < 60) return "less than a minute";
    const mins = Math.floor(s / 60);
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    if (hrs < 24) return rem ? `${hrs} hr ${rem} min` : `${hrs} hour${hrs === 1 ? "" : "s"}`;
    const days = Math.floor(hrs / 24);
    const hrem = hrs % 24;
    if (days < 7) return hrem ? `${days} day${days === 1 ? "" : "s"} ${hrem} hr` : `${days} day${days === 1 ? "" : "s"}`;
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
}

/** The same span squeezed into a chip: "4h 58m", "12m", "2d 3h". */
export function relSpanShort(ms) {
    const s = Math.max(0, Math.floor(Number(ms) || 0) / 1000);
    if (s < 60) return "<1m";
    const mins = Math.floor(s / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return mins % 60 ? `${hrs}h ${mins % 60}m` : `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return hrs % 24 ? `${days}d ${hrs % 24}h` : `${days}d`;
}

/** The business-day key an instant falls on, in the canteen's timezone. */
export const dateKeyOf = (iso) => {
    if (!iso) return "";
    try {
        return new Date(iso).toLocaleString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 10);
    } catch { return ""; }
};

/** "today" / "tomorrow" / "yesterday" / "Mon, 15 Sep" — relative to today. */
export function dayWord(dateKey, today = todayKey()) {
    if (!dateKey) return "";
    if (dateKey === today) return "today";
    if (dateKey === shiftDate(today, 1)) return "tomorrow";
    if (dateKey === shiftDate(today, -1)) return "yesterday";
    return formatDate(dateKey);
}

/**
 * " · today" / " · tomorrow" / "" — the bit worth appending to a formatted
 * date. Only the three days that have their own name earn it; appending
 * "Wed, 16 Sept" to "Wed, 16 Sept, 2026" says nothing twice.
 */
export function dayNote(dateKey, today = todayKey()) {
    const w = dayWord(dateKey, today);
    return ["today", "tomorrow", "yesterday"].includes(w) ? ` · ${w}` : "";
}

/**
 * Everything a screen needs to say about one meal's booking window, already
 * worded. Takes a meal exactly as the server sent it.
 *
 * Returns:
 *   state   "not-served" | "no-cutoff" | "open" | "closing" | "closed"
 *   tone    "green" | "amber" | "red" | "gray"   (drives the badge class)
 *   badge   the four-or-five word version, for a chip next to the meal name
 *   line    the full sentence, for a notice
 *   clock   "10:30 AM yesterday" — when the window shut or shuts
 *   leftMs  milliseconds until it shuts, when that is known and still ahead
 */
export function cutoffInfo(meal, now = Date.now(), today = todayKey()) {
    if (!meal) return { state: "no-cutoff", tone: "gray", badge: "", line: "", clock: "" };

    if (meal.servedToday === false) {
        return {
            state: "not-served", tone: "gray",
            badge: "Not served", clock: "",
            line: `${meal.name} isn't served on this day.`,
        };
    }

    if (!meal.hasCutoff) {
        return {
            state: "no-cutoff", tone: "green",
            badge: "Open", clock: "",
            line: `${meal.name} has no booking deadline — book any time.`,
        };
    }

    // The clock time, said with the day it belongs to, because "closes at
    // 10:30 PM" for tomorrow's lunch is meaningless without "tonight".
    const at = meal.cutoffAt ? new Date(meal.cutoffAt).getTime() : null;
    const onKey = dateKeyOf(meal.cutoffAt);
    const when = onKey ? `${formatTime(meal.cutoffTime)} ${dayWord(onKey, today)}`
        : `${formatTime(meal.cutoffTime)}${meal.cutoffPreviousDay ? " the day before" : ""}`;

    if (meal.cutoffPassed) {
        const ago = at ? relSpan(now - at) : "";
        return {
            state: "closed", tone: "red",
            // Short on purpose: it shares a row with the meal's name, and a
            // badge that wraps to two lines squeezes the name into a column.
            // The sentence underneath carries the detail.
            badge: "Closed", clock: when,
            line: ago
                ? `Booking for ${meal.name} closed ${ago} ago, at ${when}.`
                : `Booking for ${meal.name} closed at ${when}.`,
        };
    }

    const leftMs = at ? at - now : null;
    // An hour left is the point at which "book till 10:30" stops being useful
    // and "closes in 40 minutes" starts being the thing you act on.
    const closing = leftMs !== null && leftMs <= 60 * 60 * 1000;
    return {
        state: closing ? "closing" : "open",
        tone: closing ? "amber" : "green",
        badge: leftMs !== null ? `Closes in ${relSpanShort(leftMs)}` : `Till ${formatTime(meal.cutoffTime)}`,
        clock: when,
        leftMs,
        line: leftMs !== null
            ? `Book within ${relSpan(leftMs)} — the counter closes at ${when} — and it's confirmed straight away.`
            : `Book before ${when} and it's confirmed straight away.`,
    };
}

export const TONE_CLASS = { green: "badge-green", amber: "badge-amber", red: "badge-red", gray: "badge-gray" };
