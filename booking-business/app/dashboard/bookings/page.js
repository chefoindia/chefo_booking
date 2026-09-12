"use client";
// Booking management — search, filter, inspect, and act on a customer's behalf.
//
// The operator's edits apply directly whatever the clock says. Sending them
// through the approval queue would mean asking them to approve their own
// request, which is theatre; after cutoff, their edit IS the decision.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { get, post, patch } from "@/lib/api";
import { useAccess } from "../layout";
import { useToast } from "@/components/ToastProvider";
import { formatDate, prettyPhone, todayKey, shiftDate, STATUS_LABEL, timeAgo, REQUEST_TYPE_LABEL } from "@/lib/format";
import Empty from "@/components/Empty";
import Pagination from "@/components/Pagination";
import { downloadFromApi } from "@/lib/download";
import Modal from "@/components/Modal";
import StatusBadge from "@/components/StatusBadge";
import { Field, Input, Select, Textarea } from "@/components/Field";

export default function BookingsPage() {
    const access = useAccess();
    const toast = useToast();
    const params = useSearchParams();

    // `mode` decides whether the date filter is a single day or a range —
    // one date is what the counter needs, a range is what the office needs.
    const [filters, setFilters] = useState({
        mode: params.get("date") ? "day" : "day",
        date: params.get("date") || todayKey(),
        from: shiftDate(todayKey(), -6), to: todayKey(),
        mealTypeId: params.get("mealTypeId") || "",
        status: "",
        q: "",
    });
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(50);
    const [meta, setMeta] = useState({ total: 0 });
    const [config, setConfig] = useState({ mealTypes: [], variants: [] });
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState(null);
    const [creating, setCreating] = useState(false);

    // The booking form and the filters both need the configured meal services
    // and variants. config.view is owner-gated, so anyone without it falls back
    // to what the bookings themselves report.
    useEffect(() => {
        if (!access.can("config.view")) return;
        get("/api/config").then(setConfig).catch(() => {});
    }, [access]);

    const query = useCallback(() => {
        const qs = new URLSearchParams();
        if (filters.mode === "day") { if (filters.date) qs.set("date", filters.date); }
        else { if (filters.from) qs.set("from", filters.from); if (filters.to) qs.set("to", filters.to); }
        if (filters.mealTypeId) qs.set("mealTypeId", filters.mealTypeId);
        if (filters.status) qs.set("status", filters.status);
        if (filters.q.trim()) qs.set("q", filters.q.trim());
        return qs;
    }, [filters]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const qs = query();
            qs.set("page", page);
            qs.set("limit", perPage);
            const res = await get(`/api/bookings?${qs}`);
            setRows(res.bookings || []);
            setMeta({ total: res.total || 0, page: res.page || 1, perPage: res.perPage || perPage });
        } catch (e) {
            toast("error", "Couldn't load bookings", e.message);
        } finally {
            setLoading(false);
        }
    }, [query, page, perPage, toast]);

    useEffect(() => {
        const id = setTimeout(load, filters.q ? 300 : 0); // debounce typing only
        return () => clearTimeout(id);
    }, [load, filters.q]);

    const setF = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

    const exportCsv = async () => {
        try {
            const qs = query();
            if (filters.mode === "day") { qs.delete("date"); qs.set("from", filters.date); qs.set("to", filters.date); }
            await downloadFromApi(`/api/reports/bookings.csv?${qs}`, "bookings.csv");
            toast("success", "CSV downloaded", "The bookings matching these filters.");
        } catch (e) { toast("error", "Couldn't export", e.message); }
    };

    const mealName = useMemo(
        () => Object.fromEntries((config.mealTypes || []).map((m) => [String(m._id), m.name])),
        [config.mealTypes]
    );

    return (
        <div>
            <div className="page-head row-between wrap">
                <div>
                    <h1 className="page-title">Bookings</h1>
                    <p className="page-sub">Everything booked, with its full request history.</p>
                </div>
                <div className="row wrap">
                    {access.can("reports.export") && (
                        <button className="btn btn-secondary" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
                    )}
                    {access.can("bookings.create") && (
                        <button className="btn btn-primary" onClick={() => setCreating(true)}>
                            + New booking
                        </button>
                    )}
                </div>
            </div>

            <div className="card card-pad" style={{ marginBottom: 14 }}>
                <div className="filters">
                    <div className="seg" style={{ marginBottom: 0 }}>
                        <button className={filters.mode === "day" ? "on" : ""} onClick={() => setF({ mode: "day" })}>One day</button>
                        <button className={filters.mode === "range" ? "on" : ""} onClick={() => setF({ mode: "range" })}>Date range</button>
                    </div>
                    {filters.mode === "day" ? (
                        <>
                            <button className="btn btn-secondary btn-sm" onClick={() => setF({ date: shiftDate(filters.date || todayKey(), -1) })}>←</button>
                            <Input type="date" value={filters.date} onChange={(e) => setF({ date: e.target.value })} />
                            <button className="btn btn-secondary btn-sm" onClick={() => setF({ date: shiftDate(filters.date || todayKey(), 1) })}>→</button>
                            {filters.date !== todayKey() && <button className="btn btn-ghost btn-sm" onClick={() => setF({ date: todayKey() })}>Today</button>}
                        </>
                    ) : (
                        <>
                            <Input type="date" value={filters.from} onChange={(e) => setF({ from: e.target.value })} />
                            <span className="muted">to</span>
                            <Input type="date" value={filters.to} onChange={(e) => setF({ to: e.target.value })} />
                        </>
                    )}
                    <Select value={filters.mealTypeId} onChange={(e) => setF({ mealTypeId: e.target.value })}>
                        <option value="">All meals</option>
                        {(config.mealTypes || []).map((m) => (
                            <option key={m._id} value={m._id}>{m.name}</option>
                        ))}
                    </Select>
                    <Select value={filters.status} onChange={(e) => setF({ status: e.target.value })}>
                        <option value="">All statuses</option>
                        {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                    <Input placeholder="Search name, mobile, organisation or reference" className="input grow" value={filters.q}
                        onChange={(e) => setF({ q: e.target.value })} />
                    <button className="btn btn-ghost btn-sm"
                        onClick={() => setF({ mode: "day", date: todayKey(), mealTypeId: "", status: "", q: "" })}>
                        Clear
                    </button>
                </div>
            </div>

            <div className="card">
                {loading && !rows.length ? (
                    <div className="card-pad"><div className="sk" style={{ height: 180 }} /></div>
                ) : !rows.length ? (
                    <Empty title="No bookings match" note="Try a different date, or clear the filters." />
                ) : (
                    <div className="table-wrap">
                        <table className="tbl">
                            <thead>
                                <tr>
                                    <th>Reference</th><th>Customer</th><th>Meal</th><th>Date</th>
                                    <th className="num">Meals</th><th>Breakdown</th><th>Status</th><th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((b) => (
                                    <tr key={b._id}>
                                        <td className="mono">{b.reference}</td>
                                        <td>
                                            <div style={{ fontWeight: 650 }}>{b.partySnapshot?.name}</div>
                                            {b.partySnapshot?.organisation && (
                                                <div className="xsmall faint">{b.partySnapshot.organisation}</div>
                                            )}
                                        </td>
                                        <td>{b.mealTypeName || mealName[String(b.mealTypeId)]}</td>
                                        <td className="small">{formatDate(b.date)}</td>
                                        <td className="num">{b.totalQuantity}</td>
                                        <td className="small muted">
                                            {b.lines.map((l) => `${l.quantity} ${l.variantName}`).join(" · ")}
                                            {b.totalAmount > 0 && <div className="xsmall faint">₹{b.totalAmount.toLocaleString("en-IN")}</div>}
                                        </td>
                                        <td>
                                            <div className="row" style={{ gap: 5 }}>
                                                <StatusBadge status={b.status} />
                                                {b.openRequestType && (
                                                    <span className="badge badge-amber" title="Awaiting your decision">
                                                        {REQUEST_TYPE_LABEL[b.openRequestType]}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            <button className="btn btn-ghost btn-sm"
                                                onClick={() => setDetail(b._id)}>View</button>
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

            {detail && (
                <BookingDetail id={detail} onClose={() => setDetail(null)}
                    onChanged={() => { load(); access.refreshPending?.(); }} config={config} />
            )}
            {creating && (
                <NewBooking config={config} onClose={() => setCreating(false)}
                    onCreated={() => { setCreating(false); load(); }} />
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
function BookingDetail({ id, onClose, onChanged, config }) {
    const access = useAccess();
    const toast = useToast();
    const [data, setData] = useState(null);
    const [editing, setEditing] = useState(false);
    const [qty, setQty] = useState({});
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try { setData(await get(`/api/bookings/${id}`)); }
        catch (e) { toast("error", "Couldn't load that booking", e.message); onClose(); }
    }, [id, toast, onClose]);

    useEffect(() => { load(); }, [load]);

    const startEdit = () => {
        setQty(Object.fromEntries(data.booking.lines.map((l) => [String(l.variantId), l.quantity])));
        setEditing(true);
    };

    const save = async () => {
        setBusy(true);
        try {
            await patch(`/api/bookings/${id}`, { quantities: qty });
            toast("success", "Booking updated", "The preparation count has been adjusted.");
            setEditing(false);
            await load();
            onChanged();
        } catch (e) {
            toast("error", e.status === 403 ? "Not allowed" : "Couldn't update", e.message);
        } finally { setBusy(false); }
    };

    const cancel = async () => {
        setBusy(true);
        try {
            await post(`/api/bookings/${id}/cancel`, { reason: "Cancelled by operator" });
            toast("success", "Booking cancelled", "Those meals are off the preparation count.");
            await load();
            onChanged();
        } catch (e) {
            toast("error", e.status === 403 ? "Not allowed" : "Couldn't cancel", e.message);
        } finally { setBusy(false); }
    };

    const b = data?.booking;
    const variants = (config.variants || []).filter((v) => v.active
        && (!v.mealTypeIds?.length || v.mealTypeIds.some((m) => String(m) === String(b?.mealTypeId))));

    return (
        <Modal open wide onClose={onClose}
            title={b ? `${b.reference} · ${b.partySnapshot?.name}` : "Booking"}
            subtitle={b ? `${b.mealTypeName} · ${formatDate(b.date, { year: true })}` : ""}
            footer={
                <>
                    <button className="btn btn-ghost" onClick={onClose}>Close</button>
                    {b && data.canEditDirectly && access.can("bookings.cancel") && !editing && (
                        <button className="btn btn-danger" disabled={busy} onClick={cancel}>Cancel booking</button>
                    )}
                    {b && data.canEditDirectly && access.can("bookings.edit") && (
                        editing
                            ? <button className="btn btn-primary" disabled={busy} onClick={save}>
                                {busy ? "Saving…" : "Save changes"}
                            </button>
                            : <button className="btn btn-primary" onClick={startEdit}>Edit quantities</button>
                    )}
                </>
            }
        >
            {!b ? <div className="sk" style={{ height: 160 }} /> : (
                <div className="stack">
                    <div className="row wrap" style={{ gap: 8 }}>
                        <StatusBadge status={b.status} />
                        {b.submittedAfterCutoff && <span className="badge badge-amber">Submitted after cutoff</span>}
                        {b.source === "operator" && <span className="badge badge-blue">Entered at counter</span>}
                    </div>

                    <div className="grid-2">
                        <div>
                            <div className="num-label">Customer</div>
                            <div style={{ fontWeight: 650 }}>{b.partySnapshot?.name}</div>
                            <div className="small mono">{prettyPhone(b.partySnapshot?.phone)}</div>
                            {b.partySnapshot?.organisation && (
                                <div className="small muted">{b.partySnapshot.organisation}</div>
                            )}
                        </div>
                        <div>
                            <div className="num-label">Total meals</div>
                            <div className="mid-num">{b.totalQuantity}</div>
                        </div>
                    </div>

                    <div>
                        <div className="num-label" style={{ marginBottom: 6 }}>Breakdown</div>
                        {editing ? (
                            <div className="stack-sm">
                                {variants.map((v) => (
                                    <div key={v._id} className="row-between">
                                        <span className="small">{v.name}</span>
                                        <Input type="number" min="0" style={{ width: 92 }}
                                            value={qty[String(v._id)] ?? 0}
                                            onChange={(e) => setQty((q) => ({
                                                ...q, [String(v._id)]: Math.max(0, Number(e.target.value) || 0),
                                            }))} />
                                    </div>
                                ))}
                                <div className="row-between" style={{ paddingTop: 6, borderTop: "1px solid var(--border)" }}>
                                    <strong className="small">New total</strong>
                                    <strong>{Object.values(qty).reduce((n, v) => n + (Number(v) || 0), 0)}</strong>
                                </div>
                            </div>
                        ) : (
                            <div className="variant-grid">
                                {b.lines.map((l) => (
                                    <div key={l.variantId} className="variant-chip">
                                        <div className="n">{l.quantity}</div>
                                        <div className="l">{l.variantName}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {b.customerNote && (
                        <div>
                            <div className="num-label">Customer note</div>
                            <p className="small">{b.customerNote}</p>
                        </div>
                    )}

                    {/* Every request this booking ever carried, kept whole. */}
                    {data.requests?.length > 0 && (
                        <div>
                            <div className="num-label" style={{ marginBottom: 6 }}>Request history</div>
                            <div className="stack-sm">
                                {data.requests.map((r) => (
                                    <div key={r._id} className="row-between small"
                                        style={{ padding: "7px 10px", background: "var(--paper)", borderRadius: 8 }}>
                                        <div>
                                            <strong>{REQUEST_TYPE_LABEL[r.type]}</strong>
                                            <span className="muted"> · {r.quantityDelta >= 0 ? "+" : ""}{r.quantityDelta} meals</span>
                                            {r.resolutionNote && <div className="xsmall faint">{r.resolutionNote}</div>}
                                        </div>
                                        <div className="row" style={{ gap: 6 }}>
                                            <StatusBadge status={r.status} />
                                            <span className="xsmall faint">{timeAgo(r.createdAt)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </Modal>
    );
}

/* ------------------------------------------------------------------ */
function NewBooking({ config, onClose, onCreated }) {
    const toast = useToast();
    const [form, setForm] = useState({
        mealTypeId: "", date: todayKey(), name: "", phone: "",
        organisation: "", partyType: "individual", note: "",
    });
    const [qty, setQty] = useState({});
    const [busy, setBusy] = useState(false);

    const variants = (config.variants || []).filter((v) => v.active
        && (!v.mealTypeIds?.length || v.mealTypeIds.some((m) => String(m) === String(form.mealTypeId))));
    const total = Object.values(qty).reduce((n, v) => n + (Number(v) || 0), 0);

    const submit = async () => {
        setBusy(true);
        try {
            await post("/api/bookings", {
                mealTypeId: form.mealTypeId,
                date: form.date,
                quantities: qty,
                party: {
                    name: form.name, phone: form.phone,
                    organisation: form.organisation, partyType: form.partyType,
                },
                customerNote: form.note,
            });
            // Counter bookings confirm immediately even after cutoff — see the
            // note at the top of this file.
            toast("success", "Booking created", `${total} meals added to the preparation count.`);
            onCreated();
        } catch (e) {
            toast("error", e.status === 403 ? "Not allowed" : "Couldn't create the booking", e.message);
        } finally { setBusy(false); }
    };

    const ready = form.mealTypeId && form.date && form.name.trim() && form.phone.trim() && total > 0;

    return (
        <Modal open wide onClose={onClose}
            title="New booking"
            subtitle="Entered at the counter — confirmed straight away, even after the cutoff."
            footer={
                <>
                    <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                    <button className="btn btn-primary" disabled={busy || !ready} onClick={submit}>
                        {busy ? "Saving…" : `Create booking${total ? ` (${total})` : ""}`}
                    </button>
                </>
            }
        >
            <div className="stack">
                <div className="grid-2">
                    <Field label="Meal service">
                        <Select value={form.mealTypeId}
                            onChange={(e) => { setForm((f) => ({ ...f, mealTypeId: e.target.value })); setQty({}); }}>
                            <option value="">Choose…</option>
                            {(config.mealTypes || []).filter((m) => m.active).map((m) => (
                                <option key={m._id} value={m._id}>{m.name}</option>
                            ))}
                        </Select>
                    </Field>
                    <Field label="Date">
                        <Input type="date" value={form.date}
                            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
                    </Field>
                </div>

                <div className="grid-2">
                    <Field label="Customer name">
                        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                    </Field>
                    <Field label="Mobile number" hint="Links this to their existing record, if they have one.">
                        <Input value={form.phone} inputMode="numeric"
                            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                    </Field>
                </div>

                <div className="grid-2">
                    <Field label="Organisation / site (optional)">
                        <Input value={form.organisation}
                            onChange={(e) => setForm((f) => ({ ...f, organisation: e.target.value }))} />
                    </Field>
                    <Field label="Booking type">
                        <Select value={form.partyType}
                            onChange={(e) => setForm((f) => ({ ...f, partyType: e.target.value }))}>
                            <option value="individual">Individual</option>
                            <option value="group">Group / Site</option>
                        </Select>
                    </Field>
                </div>

                {form.mealTypeId && (
                    <div>
                        <div className="num-label" style={{ marginBottom: 6 }}>Quantities</div>
                        <div className="stack-sm">
                            {variants.map((v) => (
                                <div key={v._id} className="row-between">
                                    <span className="small">{v.name}</span>
                                    <Input type="number" min="0" style={{ width: 92 }}
                                        value={qty[String(v._id)] ?? ""}
                                        onChange={(e) => setQty((q) => ({
                                            ...q, [String(v._id)]: Math.max(0, Number(e.target.value) || 0),
                                        }))} />
                                </div>
                            ))}
                            <div className="row-between" style={{ paddingTop: 6, borderTop: "1px solid var(--border)" }}>
                                <strong className="small">Total</strong>
                                <strong>{total}</strong>
                            </div>
                        </div>
                    </div>
                )}

                <Field label="Note (optional)">
                    <Textarea rows={2} value={form.note}
                        onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
                </Field>
            </div>
        </Modal>
    );
}
