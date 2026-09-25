"use client";
// components/Calendar.js — a month the customer can look at, instead of the
// phone's native date roller.
//
// WHY: the roller hides the one thing that matters — which days this canteen
// actually serves. Spinning to a Sunday the kitchen is shut is a dead end the
// customer only discovers after landing on it, and a booking window that ends
// in nine days is invisible until you overshoot it. A grid says all of that
// before the tap: past days and days past the window are plainly out, a day
// with nothing open reads as closed, today is ringed, the chosen day is filled.
//
// It decides nothing. `bookable` per day and `cutoffPassed` per meal come from
// the server's calendar endpoint; this file only colours them in. When the
// server hasn't answered for a month yet, days render plain rather than
// guessing — the meal step still tells the truth once a day is picked.
//
// Sized for a phone first: seven columns inside a 520px column, 44px targets.
import { formatDate } from "@/lib/format";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];   // Sunday-first, as Indian calendars read

/* Month maths lives here rather than in lib/format.js, because the calendar is
   the only thing that thinks in months. A month is the "YYYY-MM" string. */
export const monthOf = (dateKey) => String(dateKey || "").slice(0, 7);
export const monthStart = (month) => `${monthOf(month)}-01`;

export function monthEnd(month) {
    const [y, m] = monthOf(month).split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${monthOf(month)}-${String(last).padStart(2, "0")}`;
}

export function shiftMonth(month, by) {
    const [y, m] = monthOf(month).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + by, 1));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

function cellsFor(month) {
    const [y, m] = monthOf(month).split("-").map(Number);
    const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = new Array(lead).fill(null);
    for (let d = 1; d <= days; d++) cells.push(`${monthOf(month)}-${String(d).padStart(2, "0")}`);
    return cells;
}

function monthLabel(month) {
    const [y, m] = monthOf(month).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1))
        .toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * props
 *   month         "YYYY-MM" currently on screen
 *   onMonthChange (month) => void
 *   value         selected "YYYY-MM-DD"
 *   onChange      (dateKey) => void
 *   today         "YYYY-MM-DD" from the server, never the browser's clock
 *   maxDate       last bookable day, from the server
 *   dayState      { "YYYY-MM-DD": { bookable, meals } } for the days fetched so far
 *   marks         Set of "YYYY-MM-DD" this customer already has a booking on —
 *                 the one thing on the grid that is about them and not the
 *                 kitchen, so it reads as a filled bar rather than a dot.
 */
export default function Calendar({ month, onMonthChange, value, onChange, today, maxDate, dayState, marks }) {
    const m = monthOf(month || value || today);
    const cells = cellsFor(m);
    const state = dayState || {};

    // Nothing to go back to before today's month, nothing to go forward to past
    // the window — so those arrows are simply not offered.
    const canPrev = !today || monthEnd(shiftMonth(m, -1)) >= today;
    const canNext = !maxDate || monthStart(shiftMonth(m, 1)) <= maxDate;

    let anyClosed = false;
    let anyLate = false;
    let anyMine = false;
    const mine = marks || new Set();

    const grid = cells.map((d, i) => {
        if (!d) return <span key={`x${i}`} className="cal-cell" aria-hidden="true" />;

        const st = state[d];
        const past = today && d < today;
        const beyond = maxDate && d > maxDate;
        const out = Boolean(past || beyond);
        const closed = !out && st ? st.bookable === false : false;

        // Open meals whose cutoff has already gone: still bookable, but the
        // canteen has to accept it. Worth a mark, not worth a wall of text.
        const open = (st?.meals || []).filter((x) => x.servedToday);
        const late = !out && !closed && open.length > 0 && open.every((x) => x.cutoffPassed);

        const booked = mine.has ? mine.has(d) : Boolean(mine[d]);
        if (closed) anyClosed = true;
        if (late) anyLate = true;
        if (booked) anyMine = true;

        const cls = [
            "cal-cell", "cal-day",
            d === value ? "is-on" : "",
            d === today ? "is-today" : "",
            out ? "is-out" : "",
            closed ? "is-closed" : "",
            booked ? "is-mine" : "",
        ].filter(Boolean).join(" ");

        return (
            <button key={d} type="button" className={cls} disabled={out}
                onClick={() => onChange?.(d)}
                aria-pressed={d === value}
                aria-current={d === today ? "date" : undefined}
                aria-label={`${formatDate(d, { year: true })}${closed ? ", nothing served" : ""}${booked ? ", you have a booking" : ""}`}>
                <span className="cal-n">{Number(d.slice(8))}</span>
                <span className={`cal-dot ${late ? "on" : ""}`} aria-hidden="true" />
            </button>
        );
    });

    return (
        <div className="cal">
            <div className="cal-head">
                <button type="button" className="cal-nav" disabled={!canPrev}
                    onClick={() => onMonthChange?.(shiftMonth(m, -1))} aria-label="Previous month">‹</button>
                <span className="cal-title">{monthLabel(m)}</span>
                <button type="button" className="cal-nav" disabled={!canNext}
                    onClick={() => onMonthChange?.(shiftMonth(m, 1))} aria-label="Next month">›</button>
            </div>

            <div className="cal-grid cal-dow" aria-hidden="true">
                {DOW.map((d, i) => <span key={i}>{d}</span>)}
            </div>
            <div className="cal-grid">{grid}</div>

            {(anyClosed || anyLate || anyMine) && (
                <div className="cal-legend">
                    {anyMine && <span className="cal-key"><span className="cal-swatch mine" />You&apos;re booked</span>}
                    {anyClosed && <span className="cal-key"><span className="cal-swatch closed" />Nothing served</span>}
                    {anyLate && <span className="cal-key"><span className="cal-dot on" />Booking closed</span>}
                </div>
            )}

            <style>{`
              .cal { margin-top: 12px; padding: 12px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-sm); }
              .cal-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
              .cal-title { font-family: var(--font-display), sans-serif; font-weight: 700; font-size: 15px; }
              .cal-nav {
                width: 36px; height: 36px; border-radius: 999px; flex-shrink: 0;
                border: 1px solid var(--border); background: var(--paper);
                color: var(--ink); font-size: 20px; line-height: 1; cursor: pointer;
              }
              .cal-nav:disabled { opacity: .3; cursor: not-allowed; }
              .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
              .cal-dow { margin-bottom: 4px; }
              .cal-dow span { text-align: center; font-size: 11px; font-weight: 700; color: var(--faint); }
              .cal-cell { min-height: 42px; }
              .cal-day {
                display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
                border: 1.5px solid transparent; border-radius: 12px; background: var(--paper);
                font: inherit; font-size: 14.5px; font-weight: 600; color: var(--ink);
                cursor: pointer; padding: 0; width: 100%;
                font-variant-numeric: tabular-nums;
                transition: background-color 120ms var(--ease), border-color 120ms var(--ease), transform 120ms var(--ease);
              }
              .cal-day:active:not(:disabled) { transform: scale(.94); }
              .cal-day.is-today { border-color: var(--basil-line); color: var(--basil-dark); background: var(--basil-soft); }
              .cal-day.is-closed { background: transparent; color: var(--faint); text-decoration: line-through; }
              .cal-day.is-out { background: transparent; color: var(--faint); opacity: .4; cursor: not-allowed; text-decoration: none; }
              .cal-day.is-mine { background: var(--basil-soft); border-color: var(--basil); color: var(--basil-deep); text-decoration: none; }
              .cal-day.is-on { background: var(--basil); border-color: var(--basil); color: #fff; text-decoration: none; box-shadow: 0 8px 16px -10px rgba(15,61,43,.8); }
              .cal-day.is-on .cal-dot.on { background: #fff; }
              .cal-dot { width: 4px; height: 4px; border-radius: 999px; background: transparent; }
              .cal-dot.on { background: var(--saffron); }
              .cal-legend { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; }
              .cal-key { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--faint); }
              .cal-swatch { width: 11px; height: 2px; background: var(--faint); border-radius: 2px; }
              .cal-swatch.mine { height: 9px; width: 9px; border-radius: 3px; background: var(--basil-soft); border: 1px solid var(--basil); }
            `}</style>
        </div>
    );
}
