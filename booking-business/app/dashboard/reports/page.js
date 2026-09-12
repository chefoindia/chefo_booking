"use client";
// app/dashboard/reports/page.js — what the kitchen prints, what the office files.
//
// Two reports:
//   DAY SHEET  one date, every meal service: the count per option, then the
//              list of bookings to serve against. PDF for the kitchen wall,
//              CSV for the spreadsheet.
//   SUMMARY    a date range, per day per meal: totals, amounts, requests.
//              PDF for a weekly review, CSV for accounts.
// Plus the raw bookings export with the same filters as the Bookings page.
//
// Every download is recorded in the activity log and, if switched on, emailed
// to the owner — reports contain customers' phone numbers.
import { useCallback, useEffect, useState } from "react";
import { get } from "@/lib/api";
import { useAccess } from "../layout";
import { useToast } from "@/components/ToastProvider";
import { formatDate, formatTime, todayKey, shiftDate, prettyPhone, STATUS_LABEL } from "@/lib/format";
import { Field, Input, Select } from "@/components/Field";
import Empty from "@/components/Empty";
import { SkeletonTiles, SkeletonTable } from "@/components/Skeleton";
import { downloadFromApi } from "@/lib/download";
import { openDoc, table, heading, tiles, closeDoc, rs } from "@/lib/pdf";

const TABS = [["day", "Day sheet"], ["summary", "Period summary"], ["bookings", "Bookings export"]];

export default function ReportsPage() {
    const access = useAccess();
    const [tab, setTab] = useState("day");
    const canExport = access.can("reports.export");
    return (
        <div>
            <div className="page-head">
                <div>
                    <h1 className="page-title">Reports</h1>
                    <p className="page-sub">Kitchen sheets and summaries, as PDF or CSV. Counts are confirmed bookings only; pending requests are shown separately and never added in.</p>
                </div>
            </div>
            <div className="row wrap" style={{ marginBottom: 14 }}>
                {TABS.map(([k, l]) => <button key={k} className={`btn btn-sm ${tab === k ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab(k)}>{l}</button>)}
            </div>
            {tab === "day" && <DaySheet canExport={canExport} business={access.business} />}
            {tab === "summary" && <Summary canExport={canExport} business={access.business} />}
            {tab === "bookings" && <BookingsExport canExport={canExport} />}
        </div>
    );
}

/* ------------------------------------------------------------------ */
function DaySheet({ canExport, business }) {
    const toast = useToast();
    const [date, setDate] = useState(todayKey());
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try { setData(await get(`/api/reports/day?date=${date}`)); }
        catch (e) { toast("error", "Couldn't load the day", e.message); }
        finally { setLoading(false); }
    }, [date, toast]);
    useEffect(() => { load(); }, [load]);

    const pdf = async () => {
        const doc = openDoc({ business, title: "Kitchen sheet", subtitle: data.dateLabel });
        tiles(doc, [
            { label: "Meals to prepare", value: data.totals.confirmedQuantity },
            { label: "Confirmed bookings", value: data.totals.bookings },
            { label: "Awaiting decision", value: data.totals.pending, tone: data.totals.pending ? "amber" : undefined },
            { label: "Confirmed amount", value: rs(data.totals.amount) },
        ]);
        for (const s of data.services) {
            const served = s.startTime && s.endTime ? `Served ${formatTime(s.startTime)} – ${formatTime(s.endTime)}` : "";
            const cut = s.cutoff.hasCutoff ? `${s.cutoff.passed ? "Closed" : "Open till"} ${formatTime(s.cutoff.cutoffTime)}` : "No cutoff";
            heading(doc, `${s.name} — ${s.confirmed.totalQuantity} meals`, [served, cut].filter(Boolean).join("  ·  "));
            table(doc, {
                head: ["Option", "Confirmed qty"],
                body: s.confirmed.byVariant.map((v) => [v.variantName, String(v.quantity)]),
                foot: ["Total", String(s.confirmed.totalQuantity)],
                columnStyles: { 1: { halign: "right", cellWidth: 100 } },
            });
            const confirmed = s.bookings.filter((b) => b.status === "confirmed");
            if (confirmed.length) {
                table(doc, {
                    head: ["Ref", "Customer", "Mobile", "Organisation", "Breakdown", "Qty", "Note"],
                    body: confirmed.map((b) => [
                        b.reference, b.partySnapshot?.name || "", prettyPhone(b.partySnapshot?.phone), b.partySnapshot?.organisation || "",
                        b.lines.map((l) => `${l.quantity} ${l.variantName}`).join(", "), String(b.totalQuantity), b.customerNote || "",
                    ]),
                    compact: true,
                    columnStyles: { 5: { halign: "right", cellWidth: 36 }, 0: { cellWidth: 56 } },
                });
            }
            const other = s.bookings.filter((b) => b.status !== "confirmed");
            if (other.length) {
                table(doc, {
                    head: ["Not counted", "Customer", "Qty", "Status"],
                    body: other.map((b) => [b.reference, b.partySnapshot?.name || "", String(b.totalQuantity), STATUS_LABEL[b.status] || b.status]),
                    compact: true, theme: "plain",
                    columnStyles: { 2: { halign: "right", cellWidth: 36 } },
                });
            }
        }
        await closeDoc(doc, `kitchen-sheet-${data.date}.pdf`, { what: "the day sheet", details: { Date: data.date, Meals: data.totals.confirmedQuantity } });
        toast("success", "PDF downloaded", `Kitchen sheet for ${data.dateLabel}.`);
    };

    const csv = async () => {
        try { await downloadFromApi(`/api/reports/day.csv?date=${date}`, `bookings-${date}.csv`); toast("success", "CSV downloaded", `Bookings for ${formatDate(date)}.`); }
        catch (e) { toast("error", "Couldn't export", e.message); }
    };

    return (
        <>
            <div className="card card-pad" style={{ marginBottom: 14 }}>
                <div className="filters">
                    <button className="btn btn-secondary btn-sm" onClick={() => setDate(shiftDate(date, -1))}>←</button>
                    <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
                    <button className="btn btn-secondary btn-sm" onClick={() => setDate(shiftDate(date, 1))}>→</button>
                    {date !== todayKey() && <button className="btn btn-ghost btn-sm" onClick={() => setDate(todayKey())}>Today</button>}
                    <span className="grow" />
                    {canExport && <button className="btn btn-secondary" disabled={!data} onClick={csv}>Download CSV</button>}
                    {canExport && <button className="btn btn-primary" disabled={!data} onClick={pdf}>Download kitchen sheet (PDF)</button>}
                </div>
            </div>

            {loading && !data ? <><SkeletonTiles count={4} /><SkeletonTable rows={4} cols={4} /></> : !data ? null : (
                <>
                    <div className="p-tiles">
                        <div className="p-tile"><div className="n">{data.totals.confirmedQuantity}</div><div className="l">Meals to prepare</div></div>
                        <div className="p-tile"><div className="n">{data.totals.bookings}</div><div className="l">Confirmed bookings</div></div>
                        <div className={`p-tile ${data.totals.pending ? "amber" : ""}`}><div className="n">{data.totals.pending}</div><div className="l">Awaiting decision</div></div>
                        <div className="p-tile"><div className="n">₹{data.totals.amount.toLocaleString("en-IN")}</div><div className="l">Confirmed amount</div></div>
                    </div>
                    {!data.services.length ? <div className="card"><Empty title="No meal services" note="Nothing is configured for this date." icon="calendar" /></div>
                        : data.services.map((s) => (
                            <div key={s.mealTypeId} className="card" style={{ marginBottom: 14 }}>
                                <div className="card-pad row-between wrap" style={{ paddingBottom: 12 }}>
                                    <div>
                                        <strong style={{ fontFamily: "var(--font-display)", fontSize: 15 }}>{s.name}</strong>
                                        <div className="xsmall faint">
                                            {s.startTime && s.endTime ? `Served ${formatTime(s.startTime)}–${formatTime(s.endTime)} · ` : ""}
                                            {s.cutoff.hasCutoff ? `${s.cutoff.passed ? "Closed" : "Open till"} ${formatTime(s.cutoff.cutoffTime)}` : "No cutoff"}
                                        </div>
                                    </div>
                                    <div className="row wrap" style={{ gap: 8 }}>
                                        <span className="big-num">{s.confirmed.totalQuantity}</span>
                                        <span className="small muted">meals · {s.confirmed.bookingCount} booking{s.confirmed.bookingCount === 1 ? "" : "s"}</span>
                                        {s.pendingCount > 0 && <span className="badge badge-amber">{s.pendingCount} pending</span>}
                                    </div>
                                </div>
                                <div className="variant-grid" style={{ padding: "0 20px 14px", marginTop: 0 }}>
                                    {s.confirmed.byVariant.map((v) => (
                                        <div key={v.variantId} className={`variant-chip ${v.quantity ? "" : "zero"}`}><div className="n">{v.quantity}</div><div className="l">{v.variantName}</div></div>
                                    ))}
                                </div>
                                {s.bookings.length > 0 && (
                                    <div className="table-wrap">
                                        <table className="tbl">
                                            <thead><tr><th>Ref</th><th>Customer</th><th>Breakdown</th><th className="num">Qty</th><th className="num">Amount</th><th>Status</th></tr></thead>
                                            <tbody>
                                                {s.bookings.map((b) => (
                                                    <tr key={b._id} style={{ opacity: b.status === "confirmed" ? 1 : 0.6 }}>
                                                        <td className="mono small">{b.reference}</td>
                                                        <td><div style={{ fontWeight: 600 }}>{b.partySnapshot?.name}</div><div className="xsmall faint">{prettyPhone(b.partySnapshot?.phone)}{b.partySnapshot?.organisation ? ` · ${b.partySnapshot.organisation}` : ""}</div></td>
                                                        <td className="small muted">{b.lines.map((l) => `${l.quantity} ${l.variantName}`).join(" · ")}</td>
                                                        <td className="num">{b.totalQuantity}</td>
                                                        <td className="num">{b.totalAmount ? `₹${b.totalAmount}` : "—"}</td>
                                                        <td><span className={`badge ${b.status === "confirmed" ? "badge-green" : b.status === "pending_approval" ? "badge-amber" : "badge-gray"}`}>{STATUS_LABEL[b.status]}</span></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        ))}
                </>
            )}
        </>
    );
}

/* ------------------------------------------------------------------ */
function Summary({ canExport, business }) {
    const toast = useToast();
    const [range, setRange] = useState({ from: shiftDate(todayKey(), -6), to: todayKey() });
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try { setData(await get(`/api/reports/summary?from=${range.from}&to=${range.to}`)); }
        catch (e) { toast("error", "Couldn't load the summary", e.message); setData(null); }
        finally { setLoading(false); }
    }, [range, toast]);
    useEffect(() => { load(); }, [load]);

    const preset = (days) => setRange({ from: shiftDate(todayKey(), -(days - 1)), to: todayKey() });

    const pdf = async () => {
        const doc = openDoc({ business, title: "Booking summary", subtitle: `${formatDate(data.from, { year: true })} – ${formatDate(data.to, { year: true })}`, orientation: "landscape" });
        tiles(doc, [
            { label: "Meals confirmed", value: data.totals.quantity },
            { label: "Bookings", value: data.totals.bookings },
            { label: "Confirmed amount", value: rs(data.totals.amount) },
            { label: "Requests accepted / rejected", value: `${data.totals.requests.accepted} / ${data.totals.requests.rejected}` },
        ]);
        heading(doc, "Per day, per meal service");
        table(doc, {
            head: ["Date", ...data.mealTypes.map((m) => m.name), "Total meals", "Bookings", "Amount"],
            body: data.rows.map((d) => [formatDate(d.date), ...d.services.map((s) => String(s.totalQuantity)), String(d.totalQuantity), String(d.bookingCount), rs(d.amount)]),
            foot: ["Total", ...data.mealTypes.map((m) => String(data.rows.reduce((n, d) => n + (d.services.find((s) => String(s.mealTypeId) === String(m.id))?.totalQuantity || 0), 0))), String(data.totals.quantity), String(data.totals.bookings), rs(data.totals.amount)],
            compact: true,
        });
        heading(doc, "By option, whole period");
        table(doc, { head: ["Option", "Meals"], body: data.totals.byVariant.map((v) => [v.variantName, String(v.quantity)]), columnStyles: { 1: { halign: "right", cellWidth: 100 } } });
        await closeDoc(doc, `booking-summary-${data.from}-to-${data.to}.pdf`, { what: "the period summary", details: { From: data.from, To: data.to } });
        toast("success", "PDF downloaded", "Period summary.");
    };
    const csv = async () => {
        try { await downloadFromApi(`/api/reports/bookings.csv?from=${range.from}&to=${range.to}`, "bookings.csv"); toast("success", "CSV downloaded", "Every booking in the period."); }
        catch (e) { toast("error", "Couldn't export", e.message); }
    };

    return (
        <>
            <div className="card card-pad" style={{ marginBottom: 14 }}>
                <div className="filters">
                    <Input type="date" value={range.from} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} />
                    <span className="muted">to</span>
                    <Input type="date" value={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} />
                    <button className="btn btn-ghost btn-sm" onClick={() => preset(7)}>Last 7 days</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => preset(30)}>Last 30 days</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { const t = todayKey(); setRange({ from: `${t.slice(0, 7)}-01`, to: t }); }}>This month</button>
                    <span className="grow" />
                    {canExport && <button className="btn btn-secondary" disabled={!data} onClick={csv}>Bookings CSV</button>}
                    {canExport && <button className="btn btn-primary" disabled={!data} onClick={pdf}>Download summary (PDF)</button>}
                </div>
            </div>
            {loading && !data ? <><SkeletonTiles count={4} /><SkeletonTable rows={7} cols={6} /></> : !data ? null : (
                <>
                    <div className="p-tiles">
                        <div className="p-tile"><div className="n">{data.totals.quantity}</div><div className="l">Meals confirmed</div></div>
                        <div className="p-tile"><div className="n">{data.totals.bookings}</div><div className="l">Bookings</div></div>
                        <div className="p-tile"><div className="n">₹{data.totals.amount.toLocaleString("en-IN")}</div><div className="l">Confirmed amount</div></div>
                        <div className="p-tile"><div className="n">{data.totals.requests.accepted} / {data.totals.requests.rejected}</div><div className="l">Requests accepted / rejected</div></div>
                        {data.totals.byVariant.map((v) => <div key={v.variantId} className="p-tile"><div className="n">{v.quantity}</div><div className="l">{v.variantName}</div></div>)}
                    </div>
                    <div className="card">
                        <div className="table-wrap">
                            <table className="tbl">
                                <thead><tr><th>Date</th>{data.mealTypes.map((m) => <th key={m.id} className="num">{m.name}</th>)}<th className="num">Total</th><th className="num">Bookings</th><th className="num">Amount</th><th className="num">Requests</th></tr></thead>
                                <tbody>
                                    {data.rows.map((d) => {
                                        const req = d.services.reduce((a, s) => ({ p: a.p + s.requests.pending, acc: a.acc + s.requests.accepted, rej: a.rej + s.requests.rejected }), { p: 0, acc: 0, rej: 0 });
                                        return (
                                            <tr key={d.date} style={{ opacity: d.totalQuantity ? 1 : 0.55 }}>
                                                <td className="small">{formatDate(d.date)}</td>
                                                {d.services.map((s) => <td key={s.mealTypeId} className="num" title={s.byVariant.map((v) => `${v.quantity} ${v.variantName}`).join(", ")}>{s.totalQuantity || "—"}</td>)}
                                                <td className="num"><strong>{d.totalQuantity}</strong></td>
                                                <td className="num">{d.bookingCount}</td>
                                                <td className="num">{d.amount ? `₹${d.amount.toLocaleString("en-IN")}` : "—"}</td>
                                                <td className="num xsmall muted">{req.p ? <span className="badge badge-amber">{req.p} pending</span> : `${req.acc}✓ ${req.rej}✕`}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

/* ------------------------------------------------------------------ */
function BookingsExport({ canExport }) {
    const toast = useToast();
    const [f, setF] = useState({ from: shiftDate(todayKey(), -29), to: todayKey(), mealTypeId: "", status: "", q: "" });
    const [config, setConfig] = useState({ mealTypes: [] });
    useEffect(() => { get("/api/config").then(setConfig).catch(() => {}); }, []);
    const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
    const go = async () => {
        try {
            const qs = new URLSearchParams();
            Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
            await downloadFromApi(`/api/reports/bookings.csv?${qs}`, "bookings.csv");
            toast("success", "CSV downloaded", "One row per booking, one column per option.");
        } catch (e) { toast("error", "Couldn't export", e.message); }
    };
    return (
        <div className="card card-pad" style={{ maxWidth: 720 }}>
            <strong>Bookings export</strong>
            <p className="small muted" style={{ margin: "2px 0 14px" }}>One row per booking with a column per meal option, the amount, status, source and whether it arrived after the cutoff. Opens in Excel or Google Sheets.</p>
            <div className="grid grid-2" style={{ marginBottom: 12 }}>
                <Field label="From"><Input type="date" value={f.from} onChange={(e) => set("from", e.target.value)} /></Field>
                <Field label="To"><Input type="date" value={f.to} onChange={(e) => set("to", e.target.value)} /></Field>
                <Field label="Meal service"><Select value={f.mealTypeId} onChange={(e) => set("mealTypeId", e.target.value)}><option value="">All</option>{(config.mealTypes || []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</Select></Field>
                <Field label="Status"><Select value={f.status} onChange={(e) => set("status", e.target.value)}><option value="">All</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            </div>
            <Field label="Search (optional)" hint="Reference, customer name, organisation or mobile."><Input value={f.q} onChange={(e) => set("q", e.target.value)} /></Field>
            {canExport ? <button className="btn btn-primary" onClick={go}>Download CSV</button>
                : <p className="small muted">You don&apos;t have permission to export.</p>}
        </div>
    );
}
