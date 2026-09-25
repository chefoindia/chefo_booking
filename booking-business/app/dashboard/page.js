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
import OutletScopeLine from "@/components/OutletScopeLine";

export default function TodayPage() {
    const access = useAccess();
    const toast = useToast();
    const [date, setDate] = useState(todayKey());
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    // The selector in the top bar decides which slice this page describes;
    // it goes to the server as a filter and the server checks it against the
    // user's own outlet scope. Nothing is filtered here.
    const outletQs = access.outletQs;
    const load = useCallback(async () => {
        setLoading(true);
        try {
            setData(await get(`/api/dashboard/today?date=${date}${outletQs ? `&${outletQs}` : ""}`));
        } catch (e) {
            toast("error", "Couldn't load today's counts", e.message);
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [date, outletQs, toast]);

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
                        What the kitchen needs to prepare. One confirmed number per
                        service — nothing is waiting on a decision any more.
                    </p>
                    <OutletScopeLine />
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
                    <div className="tile-row" style={{ marginBottom: 16 }}>
                        <SummaryTile label="Meals to prepare" value={data.totals.confirmedQuantity} strong />
                        <SummaryTile label="Confirmed bookings" value={data.totals.bookings} />
                    </div>

                    <div className="svc-grid">
                        {data.services.map((s) => <ServiceCard key={s.mealTypeId} s={s} date={date} outlet={access.outlet} />)}
                    </div>

                    {/* The same bookings, split by outlet. Only on the overall
                        view — a single outlet's page IS its own breakdown. The
                        server grouped these from the rows the cards above
                        summed, so the lines always add up to the cards. */}
                    {data.byOutlet && data.byOutlet.length > 0 && (
                        <OutletBreakdown byOutlet={data.byOutlet} services={data.services} date={date}
                            onPick={(id) => access.setOutlet(id)} />
                    )}
                </>
            )}
        </div>
    );
}

function OutletBreakdown({ byOutlet, services, date, onPick }) {
    return (
        <div className="card" style={{ marginTop: 16 }}>
            <div className="card-pad row-between wrap" style={{ paddingBottom: 10 }}>
                <div>
                    <strong style={{ fontFamily: "var(--font-display)", fontSize: 15 }}>By outlet</strong>
                    <div className="xsmall faint">Confirmed meals per outlet, per service. Pick an outlet to see only its bookings.</div>
                </div>
            </div>
            <div className="table-wrap">
                <table className="tbl">
                    <thead>
                        <tr>
                            <th>Outlet</th>
                            {services.map((s) => <th key={s.mealTypeId} className="num">{s.name}</th>)}
                            <th className="num">Total</th>
                            <th className="num">Bookings</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {byOutlet.map((o) => (
                            <tr key={o.outletId || "unassigned"} style={{ opacity: o.active === false ? 0.65 : 1 }}>
                                <td>
                                    <strong>{o.name}</strong>
                                    {o.active === false && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Inactive</span>}
                                </td>
                                {o.services.map((s) => (
                                    <td key={s.mealTypeId} className="num"
                                        title={s.byVariant.map((v) => `${v.quantity} ${v.variantName}`).join(", ")}>
                                        {s.totalQuantity || <span className="faint">—</span>}
                                    </td>
                                ))}
                                <td className="num"><strong>{o.totalQuantity}</strong></td>
                                <td className="num">{o.bookingCount}</td>
                                <td>
                                    {o.outletId ? (
                                        <button className="btn btn-ghost btn-sm" onClick={() => onPick(o.outletId)}>View</button>
                                    ) : (
                                        <Link className="btn btn-ghost btn-sm" href={`/dashboard/bookings?date=${date}&outletId=unassigned`}>View</Link>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function SummaryTile({ label, value, strong, tone, href }) {
    const body = (
        <div className="card card-pad" style={{
            // No minWidth: the .tile-row grid sets the track (min 168px), and a
            // floor here only re-created the ragged widths it exists to fix.
            height: "100%",
            ...(tone === "amber" ? { background: "var(--turmeric-soft)", borderColor: "#eadcae" } : {}),
        }}>
            <div className="num-label">{label}</div>
            <div className={strong ? "big-num" : "mid-num"} style={{ marginTop: 3 }}>{value}</div>
        </div>
    );
    return href ? <Link href={href}>{body}</Link> : body;
}

function ServiceCard({ s, date, outlet }) {
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

            {/* Surfaced on its own because it is the number that tells an
                operator whether their cutoff is set at the right time — a meal
                taking 40 late plates daily has a cutoff problem, and now that
                lateness is a wall, that is a setting to move. */}
            {s.lateAccepted.quantity > 0 && (
                <div className="row-between" style={{ marginTop: 12, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
                    <span className="xsmall faint">Taken at the counter after cutoff</span>
                    <span className="xsmall faint mono">{s.lateAccepted.quantity} meals</span>
                </div>
            )}

            <div style={{ marginTop: 12 }}>
                <Link href={`/dashboard/bookings?date=${date}&mealTypeId=${s.mealTypeId}${outlet ? `&outletId=${outlet}` : ""}`}
                    className="btn btn-secondary btn-sm btn-block">
                    View bookings
                </Link>
            </div>
        </div>
    );
}
