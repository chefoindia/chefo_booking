import { STATUS_LABEL } from "@/lib/format";

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
