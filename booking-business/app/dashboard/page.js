"use client";
// Today — the screen that answers "how much work do we have?" without anyone
// opening a single booking.
//
// The layout deliberately separates two numbers that must never be added
// together: CONFIRMED (what the kitchen cooks to) and PENDING (what is waiting
// on a decision). Merging them would have the kitchen cooking to a figure
// nobody approved, which is the exact failure this product exists to prevent.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { get } from "@/lib/api";
import { useAccess } from "./layout";
import { useToast } from "@/components/ToastProvider";
import { formatDate, formatTime, todayKey, shiftDate } from "@/lib/format";
import Empty from "@/components/Empty";

export default function TodayPage() {
    const access = useAccess();
    const toast = useToast();
    const [date, setDate] = useState(todayKey());
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setData(await get(`/api/dashboard/today?date=${date}`));
        } catch (e) {
            toast("error", "Couldn't load today's counts", e.message);
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [date, toast]);

    useEffect(() => { load(); }, [load]);

    // A count on screen goes stale while a rush is happening, and an operator
    // reading a stale number is the whole problem. Refresh quietly.
    useEffect(() => {
        const id = setInterval(load, 60_000);
        return () => clearInterval(id);
    }, [load]);

    const isToday = date === todayKey();

    return (
        <div>
            <div className="page-head row-between wrap">
                <div>
                    <h1 className="page-title">{isToday ? "Today" : formatDate(date, { year: true })}</h1>
                    <p className="page-sub">
                        What the kitchen needs to prepare. Confirmed counts only — pending
                        requests are listed separately until you decide on them.
                    </p>
                </div>
                <div className="row">
                    <button className="btn btn-secondary btn-sm" onClick={() => setDate(shiftDate(date, -1))}>←</button>
                    <input className="input" type="date" value={date} style={{ width: 156 }}
                        onChange={(e) => e.target.value && setDate(e.target.value)} />
                    <button className="btn btn-secondary btn-sm" onClick={() => setDate(shiftDate(date, 1))}>→</button>
                    {!isToday && (
                        <button className="btn btn-secondary btn-sm" onClick={() => setDate(todayKey())}>Today</button>
                    )}
                </div>
            </div>

            {loading && !data ? (
                <div className="svc-grid">
                    {[0, 1, 2].map((i) => <div key={i} className="sk" style={{ height: 190 }} />)}
                </div>
            ) : !data?.services?.length ? (
                <div className="card">
                    <Empty
                        title="No meal services configured"
                        note="Add the meals this business serves — breakfast, lunch, anything — and their cutoff times, then bookings can start coming in."
                        action={access.can("config.edit") && (
                            <Link href="/dashboard/settings" className="btn btn-primary btn-sm">
                                Set up meal services
                            </Link>
                        )}
                    />
                </div>
            ) : (
                <>
                    <div className="row wrap" style={{ gap: 14, marginBottom: 16 }}>
                        <SummaryTile label="Meals to prepare" value={data.totals.confirmedQuantity} strong />
                        <SummaryTile label="Confirmed bookings" value={data.totals.bookings} />
                        <SummaryTile
                            label="Awaiting your decision"
                            value={data.totals.pendingRequests}
                            tone={data.totals.pendingRequests > 0 ? "amber" : undefined}
                            href={data.totals.pendingRequests > 0 ? "/dashboard/requests" : undefined}
                        />
                    </div>

                    <div className="svc-grid">
                        {data.services.map((s) => <ServiceCard key={s.mealTypeId} s={s} date={date} />)}
                    </div>
                </>
            )}
        </div>
    );
}

function SummaryTile({ label, value, strong, tone, href }) {
    const body = (
        <div className="card card-pad" style={{
            minWidth: 168,
            ...(tone === "amber" ? { background: "var(--turmeric-soft)", borderColor: "#eadcae" } : {}),
        }}>
            <div className="num-label">{label}</div>
            <div className={strong ? "big-num" : "mid-num"} style={{ marginTop: 3 }}>{value}</div>
        </div>
    );
    return href ? <Link href={href}>{body}</Link> : body;
}

function ServiceCard({ s, date }) {
    // Only meaningful once the deadline exists and has passed — a meal with no
    // cutoff never closes, and saying "closed" about it would be a lie.
    const closed = s.hasCutoff && s.cutoffPassed;

    return (
        <div className="card svc-card">
            <span className="svc-rail" style={{ background: closed ? "var(--brick)" : "var(--basil)" }} />

            <div className="svc-head">
                <div>
                    <div className="svc-name">{s.name}</div>
                    <div className="svc-time">
                        {s.startTime && s.endTime ? `Served ${formatTime(s.startTime)}–${formatTime(s.endTime)}` : " "}
                    </div>
                </div>
                {!s.hasCutoff ? (
                    <span className="badge badge-blue">No cutoff</span>
                ) : closed ? (
                    <span className="badge badge-red">Closed {formatTime(s.cutoffTime)}</span>
                ) : (
                    <span className="badge badge-green">Open till {formatTime(s.cutoffTime)}</span>
                )}
            </div>

            <div>
                <div className="num-label">To prepare</div>
                <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
                    <span className="big-num">{s.confirmed.totalQuantity}</span>
                    <span className="small muted">
                        from {s.confirmed.bookingCount} booking{s.confirmed.bookingCount === 1 ? "" : "s"}
                    </span>
                </div>
            </div>

            {/* Per variant, because "185 plates" is not an instruction a kitchen
                can act on. Zero rows are kept — a kitchen needs to see the zero. */}
            <div className="variant-grid">
                {s.confirmed.byVariant.map((v) => (
                    <div key={v.variantId} className={`variant-chip ${v.quantity === 0 ? "zero" : ""}`}>
                        <div className="n">{v.quantity}</div>
                        <div className="l">{v.variantName}</div>
                    </div>
                ))}
            </div>

            {(s.pending.count > 0 || s.lateAccepted.quantity > 0) && (
                <div style={{ marginTop: 12, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
                    {s.pending.count > 0 && (
                        <Link href="/dashboard/requests" className="row-between"
                            style={{ marginBottom: s.lateAccepted.quantity > 0 ? 7 : 0 }}>
                            <span className="small" style={{ color: "var(--turmeric)", fontWeight: 650 }}>
                                {s.pending.count} awaiting decision
                            </span>
                            <span className="small mono" style={{ color: "var(--turmeric)" }}>
                                {s.pending.quantityDelta >= 0 ? "+" : ""}{s.pending.quantityDelta} meals
                            </span>
                        </Link>
                    )}
                    {s.lateAccepted.quantity > 0 && (
                        // Surfaced on its own because it is the number that tells
                        // an operator whether their cutoff is set at the right
                        // time — a meal taking 40 late plates daily has a cutoff
                        // problem, not a discipline problem.
                        <div className="row-between">
                            <span className="xsmall faint">Accepted after cutoff</span>
                            <span className="xsmall faint mono">{s.lateAccepted.quantity} meals</span>
                        </div>
                    )}
                </div>
            )}

            <div style={{ marginTop: 12 }}>
                <Link href={`/dashboard/bookings?date=${date}&mealTypeId=${s.mealTypeId}`}
                    className="btn btn-secondary btn-sm btn-block">
                    View bookings
                </Link>
            </div>
        </div>
    );
}
