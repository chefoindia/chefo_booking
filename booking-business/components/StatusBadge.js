import { STATUS_LABEL, SERVED_LABEL, servedSummary } from "@/lib/format";

// One mapping for every status the product can show, so a booking looks the
// same wherever it appears.
const TONE = {
    confirmed: "badge-green",
    pending_approval: "badge-amber",
    rejected: "badge-red",
    cancelled: "badge-gray",
    pending: "badge-amber",
    accepted: "badge-green",
    withdrawn: "badge-gray",
};

export default function StatusBadge({ status, label }) {
    return (
        <span className={`badge ${TONE[status] || "badge-gray"}`}>
            {label || STATUS_LABEL[status] || status}
        </span>
    );
}

// Deliberately a SECOND badge rather than a seventh entry in TONE. Whether a
// meal was handed over is a different axis from whether the booking stands, and
// a confirmed booking is legitimately either. Render it next to StatusBadge, not
// in place of it. `quiet` drops the unserved badge entirely for dense lists
// where absence already reads as "not yet".
export function ServedBadge({ booking, quiet = false }) {
    const served = Boolean(booking?.consumedAt);
    if (!served && quiet) return null;
    return (
        <span
            className={`badge ${served ? "badge-green" : "badge-gray"}`}
            title={served ? servedSummary(booking) : "This meal has not been handed over yet."}
        >
            {served ? SERVED_LABEL.served : SERVED_LABEL.unserved}
        </span>
    );
}
