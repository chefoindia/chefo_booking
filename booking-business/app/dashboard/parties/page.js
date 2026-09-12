"use client";
// Customers — the persistent, phone-keyed booking parties.
//
// Not accounts. Nothing here is verified; a party is created the first time a
// phone number books and recognised every time after, which is what lets an
// operator see "this is the usual project site" rather than a name retyped
// every morning.
import { useCallback, useEffect, useState } from "react";
import { get } from "@/lib/api";
import { useAccess } from "../layout";
import { useToast } from "@/components/ToastProvider";
import { formatDate, prettyPhone, timeAgo } from "@/lib/format";
import Empty from "@/components/Empty";
import Modal from "@/components/Modal";
import StatusBadge from "@/components/StatusBadge";
import Pagination from "@/components/Pagination";
import { Input, Select } from "@/components/Field";
import { downloadFromApi } from "@/lib/download";

export default function PartiesPage() {
    const access = useAccess();
    const toast = useToast();
    const [q, setQ] = useState("");
    const [partyType, setPartyType] = useState("");
    const [sort, setSort] = useState("recent");
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(50);
    const [meta, setMeta] = useState({ total: 0 });
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState(null);
    const types = access.business?.partyTypes || [];

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const qs = new URLSearchParams({ page, limit: perPage, sort });
            if (q.trim()) qs.set("q", q.trim());
            if (partyType) qs.set("partyType", partyType);
            const res = await get(`/api/parties?${qs}`);
            setRows(res.parties || []);
            setMeta({ total: res.total || 0, page: res.page || 1, perPage: res.perPage || perPage });
        } catch (e) {
            toast("error", "Couldn't load customers", e.message);
        } finally { setLoading(false); }
    }, [q, partyType, sort, page, perPage, toast]);

    useEffect(() => {
        const id = setTimeout(load, q ? 300 : 0);
        return () => clearTimeout(id);
    }, [load, q]);

    const exportCsv = async () => {
        try { await downloadFromApi("/api/parties/export.csv", "customers.csv"); toast("success", "CSV downloaded", "The full customer list. This export is recorded."); }
        catch (e) { toast("error", "Couldn't export", e.message); }
    };

    return (
        <div>
            <div className="page-head">
                <div>
                    <h1 className="page-title">Customers</h1>
                    <p className="page-sub">
                        Everyone who has booked, recognised by their mobile number.
                    </p>
                </div>
                <button className="btn btn-secondary" onClick={exportCsv} disabled={!meta.total}>Export CSV</button>
            </div>

            <div className="card card-pad" style={{ marginBottom: 14 }}>
                <div className="filters">
                    <Input className="input grow" placeholder="Search name, organisation or mobile number"
                        value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
                    <Select value={partyType} onChange={(e) => { setPartyType(e.target.value); setPage(1); }}>
                        <option value="">All types</option>
                        {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </Select>
                    <Select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
                        <option value="recent">Most recent first</option>
                        <option value="bookings">Most bookings first</option>
                        <option value="name">Name A–Z</option>
                    </Select>
                </div>
            </div>

            <div className="card">
                {loading && !rows.length ? (
                    <div className="card-pad"><div className="sk" style={{ height: 160 }} /></div>
                ) : !rows.length ? (
                    <Empty title={q || partyType ? "No customers match" : "No customers yet"}
                        note={q || partyType ? "Try a different search or type." : "A record is created automatically the first time somebody books."} />
                ) : (
                    <div className="table-wrap">
                        <table className="tbl">
                            <thead>
                                <tr><th>Name</th><th>Mobile</th><th>Organisation</th><th>Type</th>
                                    <th className="num">Bookings</th><th>Last booking</th><th></th></tr>
                            </thead>
                            <tbody>
                                {rows.map((p) => (
                                    <tr key={p._id} className="row-click" onClick={() => setDetail(p._id)}>
                                        <td><strong>{p.name}</strong>{p.internalNote && <div className="xsmall faint">{p.internalNote}</div>}</td>
                                        <td className="mono">{prettyPhone(p.phone)}</td>
                                        <td className="small muted">{p.organisation || "—"}</td>
                                        <td className="small muted">{types.find((t) => t.key === p.partyType)?.label || p.partyType || "—"}</td>
                                        <td className="num">{p.bookingCount || 0}</td>
                                        <td className="small muted">
                                            {p.lastBookingAt ? timeAgo(p.lastBookingAt) : "—"}
                                        </td>
                                        <td>
                                            <button className="btn btn-ghost btn-sm"
                                                onClick={(e) => { e.stopPropagation(); setDetail(p._id); }}>View</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {(rows.length > 0 || page > 1) && (
                    <Pagination page={meta.page || page} perPage={meta.perPage || perPage} total={meta.total}
                        onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />
                )}
            </div>

            {detail && <PartyDetail id={detail} onClose={() => setDetail(null)} />}
        </div>
    );
}

function PartyDetail({ id, onClose }) {
    const toast = useToast();
    const [data, setData] = useState(null);

    useEffect(() => {
        get(`/api/parties/${id}`).then(setData)
            .catch((e) => { toast("error", "Couldn't load", e.message); onClose(); });
    }, [id, toast, onClose]);

    const p = data?.party;
    return (
        <Modal open wide onClose={onClose} title={p?.name || "Customer"}
            subtitle={p ? prettyPhone(p.phone) : ""}
            footer={<button className="btn btn-ghost" onClick={onClose}>Close</button>}>
            {!data ? <div className="sk" style={{ height: 160 }} /> : (
                <div className="stack">
                    <div className="row wrap" style={{ gap: 14 }}>
                        <Stat label="Bookings" value={data.stats.total} />
                        <Stat label="Confirmed" value={data.stats.confirmed} />
                        <Stat label="Meals served" value={data.stats.mealsConfirmed} />
                        <Stat label="Cancelled" value={data.stats.cancelled} />
                    </div>

                    {p.organisation && (
                        <div><div className="num-label">Organisation</div><div>{p.organisation}</div></div>
                    )}
                    {p.location && (
                        <div><div className="num-label">Location</div><div className="small">{p.location}</div></div>
                    )}

                    <div>
                        <div className="num-label" style={{ marginBottom: 6 }}>Booking history</div>
                        {!data.bookings.length ? (
                            <p className="small muted">No bookings yet.</p>
                        ) : (
                            <div className="table-wrap">
                                <table className="tbl">
                                    <thead><tr><th>Reference</th><th>Meal</th><th>Date</th>
                                        <th className="num">Meals</th><th>Status</th></tr></thead>
                                    <tbody>
                                        {data.bookings.slice(0, 25).map((b) => (
                                            <tr key={b._id}>
                                                <td className="mono">{b.reference}</td>
                                                <td>{b.mealTypeName}</td>
                                                <td className="small">{formatDate(b.date)}</td>
                                                <td className="num">{b.totalQuantity}</td>
                                                <td><StatusBadge status={b.status} /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </Modal>
    );
}

const Stat = ({ label, value }) => (
    <div>
        <div className="num-label">{label}</div>
        <div className="mid-num">{value}</div>
    </div>
);
