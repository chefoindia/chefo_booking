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
