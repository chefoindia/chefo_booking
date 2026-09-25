"use client";
// components/OutletSelector.js — "All outlets ▾" in the top-right.
//
// One control, on every page, deciding which slice of the canteen the page
// describes. The choice lives in the dashboard shell (see app/dashboard/
// layout.js) so it survives navigation, and every page reads it from there
// rather than keeping its own — two selectors that could disagree would put
// Block A's count next to Block B's list.
//
// What it offers is exactly what the server said this person may see:
//   · canteen-wide user   "All outlets" + every outlet
//   · several outlets     "All my outlets" + those outlets
//   · one outlet          no dropdown at all — a badge naming it, because a
//                          choice with one option is not a choice
// It is UX. The API enforces the same scope on its own.
export default function OutletSelector({ outlets, scope, value, onChange, disabled, compact = false }) {
    if (!outlets?.length) return null;

    const restricted = Array.isArray(scope);
    const single = restricted && outlets.length === 1;

    if (single) {
        return (
            <span className="badge badge-blue topbar-outlet-badge" title="You are assigned to this outlet">
                <OutletIcon />
                <span>{outlets[0].name}</span>
            </span>
        );
    }

    return (
        <label className={`topbar-outlet ${compact ? "compact" : ""}`}>
            <OutletIcon />
            <select
                className="select topbar-outlet-select"
                value={value || ""}
                disabled={disabled}
                aria-label="Outlet"
                onChange={(e) => onChange(e.target.value)}
            >
                <option value="">{restricted ? "All my outlets" : "All outlets"}</option>
                {outlets.map((o) => (
                    <option key={o.id} value={o.id}>
                        {o.name}{o.active === false ? " (inactive)" : ""}
                    </option>
                ))}
                {/* History from before outlets existed, for whoever may see
                    the whole canteen. Never offered to a restricted user —
                    it is nobody's outlet. */}
                {!restricted && <option value="unassigned">Unassigned (before outlets)</option>}
            </select>
        </label>
    );
}

export function OutletIcon({ size = 15 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 10.5 12 4l9 6.5" />
            <path d="M5 10v10h14V10" />
            <path d="M10 20v-6h4v6" />
        </svg>
    );
}
