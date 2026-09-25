"use client";
// components/DayStrip.js — the next week as a row of pills.
//
// Nearly every booking is for today, tomorrow or a day this week, and a full
// month grid for that is a wall of numbers. So the strip comes first and the
// calendar sits behind a "More" pill. A day the kitchen doesn't run is
// crossed out before anyone taps it; a day you already have a booking on
// carries a dot, so booking the same lunch twice is a choice, not an accident.
//
// Like the calendar it decides nothing: `bookable` per day comes from the
// server's calendar endpoint and this only colours it in.
import { formatDate, shiftDate } from "@/lib/format";
import { Icon, PATHS } from "@/components/Icons";

export default function DayStrip({ today, maxDate, value, onChange, dayState, marks, onMore, moreOpen, days = 7 }) {
    const list = [];
    for (let i = 0; i < days; i++) {
        const d = shiftDate(today, i);
        if (maxDate && d > maxDate) break;
        list.push(d);
    }
    const st = dayState || {};
    const mine = marks || new Set();
    const beyond = value && !list.includes(value);

    return (
        <div className="day-strip" role="listbox" aria-label="Day">
            {list.map((d) => {
                const closed = st[d] ? st[d].bookable === false : false;
                const dow = i18nDow(d);
                const on = d === value;
                return (
                    <button key={d} type="button" role="option" aria-selected={on}
                        className={`day-pill ${on ? "on" : ""} ${d === today ? "is-today" : ""} ${closed ? "is-out" : ""}`}
                        disabled={closed} onClick={() => onChange?.(d)}
                        aria-label={`${formatDate(d, { year: true })}${closed ? ", nothing served" : ""}${mine.has(d) ? ", you have a booking" : ""}`}>
                        <span className="day-dow">{d === today ? "Today" : dow}</span>
                        <span className="day-n">{Number(d.slice(8))}</span>
                        <span className={`day-dot ${mine.has(d) ? "on" : ""}`} aria-hidden="true" />
                    </button>
                );
            })}
            <button type="button" className={`day-pill ${moreOpen || beyond ? "on" : ""}`} onClick={onMore} aria-expanded={moreOpen}
                aria-label="Pick another date">
                <span className="day-dow">{beyond ? formatDate(value).split(",")[0] : "More"}</span>
                <span className="day-n">{beyond ? Number(value.slice(8)) : <Icon d={PATHS.calendar} size={18} />}</span>
                <span className="day-dot" aria-hidden="true" />
            </button>
        </div>
    );
}

const i18nDow = (d) => formatDate(d).split(",")[0];
