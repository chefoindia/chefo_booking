"use client";
// Menu — what is actually being cooked, day by day.
//
// Separated from the booking form on purpose. A lot of people open a canteen's
// link with no intention of booking yet; they want to know whether it is worth
// it. Making them start a booking to find out what is for lunch is the kind of
// thing that trains people to stop opening the link.
//
// So this tab is read-only and browsable: a week of days across the top, every
// meal service underneath with its options, its dishes, its price and — because
// it is the thing that decides whether looking turns into booking — how long is
// left to book it.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { get } from "@/lib/api";
import { formatDate, formatTime, shiftDate, cutoffInfo, dayWord, dayNote } from "@/lib/format";
import { CutoffBadge } from "@/components/Cutoff";
import { useBooking } from "@/components/BookingShell";
import useNow from "@/lib/useNow";

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export default function MenuTab() {
    const { slug } = useParams();
    const { today, maxDate } = useBooking();
    const now = useNow(30000);

    const [date, setDate] = useState(today);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // The shell answers with today a moment after this tab mounts; until then
    // `today` is the browser's guess and the chosen day follows it.
    useEffect(() => { setDate((d) => d || today); }, [today]);

    const load = useCallback(async () => {
        if (!date) return;
        setLoading(true);
        setError("");
        try {
            setData(await get(`/api/public/business/${slug}?date=${date}`));
        } catch (e) {
            setError(e.message || "Could not load the menu.");
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [slug, date]);

    useEffect(() => { load(); }, [load]);

    // A week of days is as far as anyone browses a menu; the booking form's
    // calendar is there for anything further out.
    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = shiftDate(today, i);
        if (maxDate && d > maxDate) break;
        days.push(d);
    }

    const meals = data?.mealTypes || [];
    const served = meals.filter((m) => m.servedToday);

    return (
        <>
            {/* ---- the week ---- */}
            <div className="day-strip">
                {days.map((d) => {
                    const [, , dd] = d.split("-");
                    return (
                        <button key={d} type="button"
                            className={`day-pill ${d === date ? "on" : ""}`}
                            onClick={() => setDate(d)}>
                            <span className="day-dow">{formatDate(d).split(",")[0]}</span>
                            <span className="day-n">{Number(dd)}</span>
                        </button>
                    );
                })}
            </div>
            <p className="hint" style={{ marginBottom: 12 }}>
                {formatDate(date, { year: true })}{dayNote(date, today)}
            </p>

            {error && <div className="notice notice-bad" style={{ marginBottom: 12 }}>{error}</div>}

            {loading && !data ? (
                <>
                    <div className="sk" style={{ height: 130, marginBottom: 12 }} />
                    <div className="sk" style={{ height: 130 }} />
                </>
            ) : !served.length ? (
                <div className="card center">
                    <p className="small muted">
                        Nothing is being served on {dayWord(date, today)}. Try another day.
                    </p>
                </div>
            ) : (
                served.map((m) => {
                    const info = cutoffInfo(m, now, today);
                    return (
                        <div key={m.id} className="card">
                            <div className="row-between" style={{ alignItems: "flex-start" }}>
                                <div style={{ minWidth: 0 }}>
                                    <strong style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 16 }}>{m.name}</strong>
                                    {m.startTime && m.endTime && (
                                        <div className="xsmall faint">
                                            Served {formatTime(m.startTime)}–{formatTime(m.endTime)}
                                        </div>
                                    )}
                                </div>
                                <CutoffBadge meal={m} today={today} />
                            </div>

                            <span className={`cut-line cut-${info.tone}`}>
                                <span className="cut-dot" aria-hidden="true" />
                                <span>{info.line}</span>
                            </span>

                            {m.menuNote && (
                                <div className="notice" style={{ marginTop: 10, fontSize: 13 }}>{m.menuNote}</div>
                            )}

                            <div style={{ marginTop: 10 }}>
                                {m.variants.map((v) => (
                                    <div key={v.id} className="menu-opt">
                                        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                                            <span className="qty-name">{v.name}</span>
                                            {v.price > 0
                                                ? <span className="price-tag">{inr(v.price)}</span>
                                                : <span className="xsmall faint">Pay at the counter</span>}
                                        </div>
                                        {v.description && <div className="xsmall faint">{v.description}</div>}
                                        {v.dishes?.length > 0 ? (
                                            <ul className="dishes">{v.dishes.map((d, i) => <li key={i}>{d}</li>)}</ul>
                                        ) : (
                                            <div className="xsmall faint" style={{ marginTop: 3 }}>
                                                The kitchen hasn&apos;t listed today&apos;s dishes for this option.
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <Link href={`/b/${slug}/book?date=${date}&meal=${m.id}`}
                                className={`btn ${info.state === "closed" ? "" : "btn-primary"}`}
                                style={{ marginTop: 12 }}>
                                {info.state === "closed" ? `Ask for ${m.name} anyway` : `Book ${m.name}`}
                            </Link>
                        </div>
                    );
                })
            )}

            <style>{`
              .day-strip {
                display: flex; gap: 8px; overflow-x: auto; padding: 2px 0 6px;
                scrollbar-width: none; -webkit-overflow-scrolling: touch;
              }
              .day-strip::-webkit-scrollbar { display: none; }
              .day-pill {
                flex: 0 0 auto; width: 52px; padding: 8px 0 9px;
                border: 1.5px solid var(--border); border-radius: 12px; background: var(--card);
                display: flex; flex-direction: column; align-items: center; gap: 2px;
                font: inherit; color: var(--slate); cursor: pointer;
              }
              .day-pill.on { border-color: var(--basil); background: var(--basil); color: #fff; }
              .day-dow { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
              .day-n {
                font-family: var(--font-display), sans-serif; font-weight: 700; font-size: 16px;
                font-variant-numeric: tabular-nums;
              }
              .menu-opt { padding: 9px 0; border-bottom: 1px solid var(--border); }
              .menu-opt:last-child { border-bottom: none; padding-bottom: 0; }
            `}</style>
        </>
    );
}
