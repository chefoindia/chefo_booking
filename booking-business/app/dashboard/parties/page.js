"use client";
// Customers — the persistent, phone-keyed booking parties.
//
// Not accounts. Nothing here is verified; a party is created the first time a
// phone number books and recognised every time after, which is what lets an
// operator see "this is the usual project site" rather than a name retyped
// every morning.
import { useCallback, useEffect, useState } from "react";
import { get } from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { formatDate, prettyPhone, timeAgo } from "@/lib/format";
import Empty from "@/components/Empty";
import Modal from "@/components/Modal";
import StatusBadge from "@/components/StatusBadge";
import { Input } from "@/components/Field";

export default function PartiesPage() {
    const toast = useToast();
    const [q, setQ] = useState("");
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await get(`/api/parties${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
            setRows(res.parties || []);
        } catch (e) {
            toast("error", "Couldn't load customers", e.message);
        } finally { setLoading(false); }
    }, [q, toast]);

    useEffect(() => {
        const id = setTimeout(load, q ? 300 : 0);
        return () => clearTimeout(id);
    }, [load, q]);

    return (
        <div>
            <div className="page-head">
                <h1 className="page-title">Customers</h1>
                <p className="page-sub">
                    Everyone who has booked, recognised by their mobile number.
                </p>
            </div>

            <div className="card card-pad" style={{ marginBottom: 14 }}>
                <Input placeholder="Search name, organisation or mobile number"
                    value={q} onChange={(e) => setQ(e.target.value)} />
            </div>

            <div className="card">
                {loading && !rows.length ? (
                    <div className="card-pad"><div className="sk" style={{ height: 160 }} /></div>
                ) : !rows.length ? (
                    <Empty title="No customers yet"
                        note="A record is created automatically the first time somebody books." />
                ) : (
                    <div className="table-wrap">
                        <table className="tbl">
                            <thead>
                                <tr><th>Name</th><th>Mobile</th><th>Organisation</th>
                                    <th className="num">Bookings</th><th>Last booking</th><th></th></tr>
                            </thead>
                            <tbody>
                                {rows.map((p) => (
                                    <tr key={p._id}>
                                        <td><strong>{p.name}</strong></td>
                                        <td className="mono">{prettyPhone(p.phone)}</td>
                                        <td className="small muted">{p.organisation || "—"}</td>
                                        <td className="num">{p.bookingCount || 0}</td>
                                        <td className="small muted">
                                            {p.lastBookingAt ? timeAgo(p.lastBookingAt) : "—"}
                                        </td>
                                        <td>
                                            <button className="btn btn-ghost btn-sm"
                                                onClick={() => setDetail(p._id)}>View</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
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
