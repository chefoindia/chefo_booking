"use client";
// app/dashboard/logs/page.js — the activity log.
//
// Everything the server recorded, newest first, with the filters that answer
// the questions people actually ask: "what did X do", "what happened to this
// booking", "who changed settings last Tuesday". Each row expands to show the
// before/after and details exactly as stored.
import { useCallback, useEffect, useState } from "react";
import { get } from "@/lib/api";
import { useAccess } from "../layout";
import { useToast } from "@/components/ToastProvider";
import { fmtDateTime } from "@/lib/format";
import { Input, Select } from "@/components/Field";
import Empty from "@/components/Empty";
import Pagination from "@/components/Pagination";
import { SkeletonTable } from "@/components/Skeleton";
import { downloadFromApi } from "@/lib/download";

const KIND_TONE = { operator: "badge-blue", customer: "badge-green", system: "badge-gray" };

// A little colour for the action text, so a scan of the log picks out the
// dangerous verbs without reading every line.
const tone = (action = "") => {
    const a = action.toLowerCase();
    if (/removed|deactivat|archiv|cancel|reject|cleared|reset/.test(a)) return "var(--brick)";
    if (/added|created|accept|confirm|signed in|set a sign-in/.test(a)) return "var(--basil-dark)";
    if (/export/.test(a)) return "var(--turmeric)";
    return "var(--ink)";
};

export default function LogsPage() {
    const access = useAccess();
    const toast = useToast();
    const [filters, setFilters] = useState({ q: "", actorKind: "", actorUserId: "", from: "", to: "" });
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(50);
    const [data, setData] = useState(null);
    const [actors, setActors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(null);

    useEffect(() => { get("/api/audit/actors").then((r) => setActors(r.actors || [])).catch(() => {}); }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const qs = new URLSearchParams({ page, perPage });
            Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
            if (access.outlet) qs.set("outletId", access.outlet);
            setData(await get(`/api/audit?${qs}`));
        } catch (e) { toast("error", "Couldn't load the log", e.message); }
        finally { setLoading(false); }
    }, [filters, page, perPage, access.outlet, toast]);

    useEffect(() => {
        const t = setTimeout(load, filters.q ? 300 : 0);
        return () => clearTimeout(t);
    }, [load, filters.q]);

    const setF = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
    const exportCsv = async () => {
        try {
            const qs = new URLSearchParams();
            Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
            if (access.outlet) qs.set("outletId", access.outlet);
            await downloadFromApi(`/api/audit/export.csv?${qs}`, "activity-log.csv");
            toast("success", "Export started", "Your CSV is downloading. This export is itself recorded.");
        } catch (e) { toast("error", "Couldn't export", e.message); }
    };

    return (
        <div>
            <div className="page-head">
                <div>
                    <h1 className="page-title">Activity log</h1>
                    <p className="page-sub">Who did what, and when. Every change to bookings, settings, team and access is here — nothing is edited or deleted from this list.</p>
                    {access.outlet && <p className="xsmall faint" style={{ marginTop: 4 }}>Showing only actions on {access.outletName}&apos;s bookings. Business-level actions appear under All outlets.</p>}
                </div>
                {access.can("audit.export") && <button className="btn btn-secondary" onClick={exportCsv}>Export CSV</button>}
            </div>

            <div className="card card-pad" style={{ marginBottom: 14 }}>
                <div className="filters">
                    <Input className="input grow" placeholder="Search actions or names — e.g. “role”, “cancelled”, “Priya”" value={filters.q} onChange={(e) => setF("q", e.target.value)} />
                    <Select value={filters.actorUserId} onChange={(e) => setF("actorUserId", e.target.value)}>
                        <option value="">Anyone</option>
                        {actors.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isOwner ? " (owner)" : ""}{!a.isActive ? " (inactive)" : ""}</option>)}
                    </Select>
                    <Select value={filters.actorKind} onChange={(e) => setF("actorKind", e.target.value)}>
                        <option value="">Staff & customers</option>
                        <option value="operator">Staff only</option>
                        <option value="customer">Customers only</option>
                        <option value="system">System</option>
                    </Select>
                    <Input type="date" value={filters.from} onChange={(e) => setF("from", e.target.value)} aria-label="From" />
                    <Input type="date" value={filters.to} onChange={(e) => setF("to", e.target.value)} aria-label="To" />
                    <button className="btn btn-ghost btn-sm" onClick={() => { setFilters({ q: "", actorKind: "", actorUserId: "", from: "", to: "" }); setPage(1); }}>Clear</button>
                </div>
            </div>

            <div className="card">
                {loading && !data ? <div className="card-pad"><SkeletonTable rows={8} cols={4} /></div>
                    : !data?.entries?.length ? <Empty title="Nothing recorded for that filter" note="Try a wider date range or clear the search." icon="search" />
                        : (
                            <div className="table-wrap">
                                <table className="tbl">
                                    <thead><tr><th style={{ width: 160 }}>When</th><th>Who</th><th>What</th><th style={{ width: 90 }}></th></tr></thead>
                                    <tbody>
                                        {data.entries.map((e) => (
                                            <LogRow key={e._id} e={e} open={open === e._id} onToggle={() => setOpen(open === e._id ? null : e._id)} />
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                {data && <Pagination page={data.page} perPage={data.perPage} total={data.total} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />}
            </div>
        </div>
    );
}

function LogRow({ e, open, onToggle }) {
    const hasMore = e.before || e.after || (e.details && Object.keys(e.details).length) || e.ip;
    return (
        <>
            <tr className={hasMore ? "row-click" : ""} onClick={hasMore ? onToggle : undefined}>
                <td className="small mono muted">{fmtDateTime(e.createdAt)}</td>
                <td>
                    <div className="row" style={{ gap: 6 }}>
                        <strong className="small">{e.actorName || "—"}</strong>
                        <span className={`badge ${KIND_TONE[e.actorKind] || "badge-gray"}`}>{e.actorKind}</span>
                    </div>
                </td>
                <td style={{ color: tone(e.action), fontWeight: 500 }}>{e.action}</td>
                <td className="xsmall faint" style={{ textAlign: "right" }}>{hasMore ? (open ? "Hide ▴" : "Details ▾") : ""}</td>
            </tr>
            {open && (
                <tr>
                    <td colSpan={4} style={{ background: "var(--paper)" }}>
                        <div className="grid grid-3" style={{ gap: 14 }}>
                            {e.before && <Json label="Before" value={e.before} />}
                            {e.after && <Json label="After" value={e.after} />}
                            {e.details && Object.keys(e.details).length > 0 && <Json label="Details" value={e.details} />}
                        </div>
                        <div className="xsmall faint" style={{ marginTop: 10 }}>
                            {e.bookingId && <span style={{ marginRight: 14 }}>Booking {String(e.bookingId)}</span>}
                            {e.requestId && <span style={{ marginRight: 14 }}>Request {String(e.requestId)}</span>}
                            {e.ip && <span style={{ marginRight: 14 }}>From {e.ip}</span>}
                            {e.userAgent && <span title={e.userAgent}>{e.userAgent.slice(0, 80)}{e.userAgent.length > 80 ? "…" : ""}</span>}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

const Json = ({ label, value }) => (
    <div>
        <div className="num-label" style={{ marginBottom: 4 }}>{label}</div>
        <pre className="mono" style={{ margin: 0, fontSize: 11.5, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, maxHeight: 220, overflow: "auto" }}>
            {JSON.stringify(value, null, 2)}
        </pre>
    </div>
);
