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

// Matches the backend's +91 convention.
export const withCountryCode = (phone) => {
    const p = String(phone || "").trim().replace(/\s/g, "");
    if (p.startsWith("+")) return p;
    return `+91${p}`;
};

export const inr = (n) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })
        .format(Number(n) || 0);

// Instants (createdAt etc.), shown in IST like everything else in Chefo.
export const fmtDate = (d) =>
    d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";
export const fmtDateTime = (d) =>
    d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";

export const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

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

// SERVED IS NOT A STATUS. A booking is confirmed or it isn't; separately, the
// meal was handed over or it wasn't. Folding the second fact into STATUS_LABEL
// would force impossible answers ("is a cancelled-but-served booking green?"),
// so consumption gets its own small vocabulary that sits BESIDE the status.
export const SERVED_LABEL = { served: "Served", unserved: "Not served" };

export const CONSUMED_VIA_LABEL = {
    scan: "scanned",
    manual: "marked by hand",
};

export const isServed = (b) => Boolean(b?.consumedAt);

// Custom-field answers are snapshotted as strings whatever their type, so a
// ticked checkbox arrives as "true" and would otherwise be shown to an operator
// as the literal word. Only that type needs translating — everything else is
// already exactly what the customer typed.
export const answerText = (a) => {
    if (!a) return "";
    if (a.type === "checkbox") return (a.value === true || String(a.value) === "true") ? "Yes" : "No";
    return String(a.value ?? "");
};

// The counter question is never "was it served" alone — it is "who gave it out
// and when", because that is what settles a dispute. One line, both facts.
export function servedSummary(b) {
    if (!b?.consumedAt) return "";
    const who = b.consumedByName ? `by ${b.consumedByName}` : "by someone since removed";
    const how = CONSUMED_VIA_LABEL[b.consumedVia];
    return `${who} · ${fmtDateTime(b.consumedAt)}${how ? ` · ${how}` : ""}`;
}
