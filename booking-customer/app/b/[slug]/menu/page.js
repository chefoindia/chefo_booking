"use client";
// Menu — what is actually being cooked, day by day.
//
// Read-only and browsable: a week of days across the top, every meal service
// underneath with its options, its dishes, its price and — because it is the
// thing that decides whether looking turns into booking — how long is left to
// book it. A lot of people open a canteen's link with no intention of booking
// yet; making them start a booking to find out what is for lunch trains them
// to stop opening the link.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { get } from "@/lib/api";
import { formatDate, formatTime, cutoffInfo, dayWord, dayNote } from "@/lib/format";
import { CutoffBadge } from "@/components/Cutoff";
import { useBooking } from "@/components/BookingShell";
import DayStrip from "@/components/DayStrip";
import { Icon, PATHS } from "@/components/Icons";
import useNow from "@/lib/useNow";

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export default function MenuTab() {
    const { slug } = useParams();
    const { today, maxDate, openBooking } = useBooking();
    const now = useNow(30000);

    const [date, setDate] = useState(today);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => { setDate((d) => d || today); }, [today]);

    const load = useCallback(async () => {
        if (!date) return;
        setLoading(true);
        setError("");
        try { setData(await get(`/api/public/business/${slug}?date=${date}`)); }
        catch (e) { setError(e.message || "Could not load the menu."); setData(null); }
        finally { setLoading(false); }
    }, [slug, date]);

    useEffect(() => { load(); }, [load]);

    const meals = data?.mealTypes || [];
    const served = meals.filter((m) => m.servedToday);

    return (
        <>
            <DayStrip today={today} maxDate={maxDate} value={date} onChange={setDate} days={7}
                onMore={() => openBooking({ date })} moreOpen={false} />
            <div className="row-between" style={{ margin: "2px 2px 12px" }}>
                <h2 style={{ fontSize: 17 }}>{formatDate(date, { year: true })}</h2>
                <span className="xsmall faint">{dayNote(date, today).replace(" · ", "") || formatDate(date).split(",")[0]}</span>
            </div>

            {error && <div className="notice notice-bad" style={{ marginBottom: 12 }}>{error}</div>}

            {loading && !data ? (
                <>
                    <div className="sk" style={{ height: 150, marginBottom: 12 }} />
                    <div className="sk" style={{ height: 150 }} />
                </>
            ) : !served.length ? (
                <div className="card center" style={{ padding: 28 }}>
                    <div className="done-mark" style={{ background: "var(--paper)", color: "var(--faint)" }}><Icon d={PATHS.utensils} size={28} /></div>
                    <strong>Nothing served {dayWord(date, today)}</strong>
                    <p className="small muted" style={{ marginTop: 6 }}>The kitchen isn&apos;t running a service that day. Try another.</p>
                </div>
            ) : (
                served.map((m, i) => {
                    const info = cutoffInfo(m, now, today);
                    return (
                        <div key={m.id} className={`meal-card rail-${(i % 5) + 1}`} style={{ flexDirection: "column", gap: 0 }}>
                            <div className="row-between" style={{ alignItems: "flex-start" }}>
                                <div style={{ minWidth: 0 }}>
                                    <div className="meal-name" style={{ fontSize: 17 }}>{m.name}</div>
                                    {m.startTime && m.endTime && <div className="meal-time">Served {formatTime(m.startTime)}–{formatTime(m.endTime)}</div>}
                                </div>
                                <CutoffBadge meal={m} today={today} />
                            </div>

                            <span className={`cut-line cut-${info.tone}`}>
                                <span className="cut-dot" aria-hidden="true" />
                                <span>{info.line}</span>
                            </span>

                            {m.menuNote && <div className="notice" style={{ marginTop: 10, fontSize: 13 }}>{m.menuNote}</div>}

                            <div style={{ marginTop: 8 }}>
                                {m.variants.map((v) => (
                                    <div key={v.id} className="menu-opt">
                                        <div className="row-between">
                                            <span className="qty-name">{v.name}</span>
                                            {v.price > 0 ? <span className="price-tag">{inr(v.price)}</span> : <span className="xsmall faint">Pay at the counter</span>}
                                        </div>
                                        {(v.dishes?.length > 0 || v.description) && (
                                            <div className="tk-lines" style={{ marginTop: 6 }}>
                                                {(v.dishes?.length > 0 ? v.dishes : [v.description]).map((d, j) => <span key={j} className="tk-line">{d}</span>)}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {info.state === "closed" ? (
                                <p className="hint" style={{ marginTop: 10 }}>Booking is closed for this meal. Try another day.</p>
                            ) : (
                                <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => openBooking({ date, meal: m.id })}>
                                    Book {m.name}
                                </button>
                            )}
                        </div>
                    );
                })
            )}

            <style>{`
              .menu-opt { padding: 10px 0; border-bottom: 1px dashed var(--border); }
              .menu-opt:last-child { border-bottom: none; padding-bottom: 2px; }
            `}</style>
        </>
    );
}
