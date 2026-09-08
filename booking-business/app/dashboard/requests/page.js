"use client";
// The approval queue — the screen this whole product is built around.
//
// Everything needed to decide is in the card itself: who, which meal, how many
// plates it moves the count by, and what the booking currently says. Making an
// operator open each request to find that out during a lunch rush would defeat
// the point of having a queue at all.
//
// Oldest first, deliberately. Somebody has been waiting on an answer, and a
// queue that buries the longest wait is not a queue.
import { useCallback, useEffect, useState } from "react";
import { get, post } from "@/lib/api";
import { useAccess } from "../layout";
import { useToast } from "@/components/ToastProvider";
import { formatDate, timeAgo, prettyPhone, REQUEST_TYPE_LABEL } from "@/lib/format";
import Empty from "@/components/Empty";
import Modal from "@/components/Modal";
import StatusBadge from "@/components/StatusBadge";
import { Field, Textarea } from "@/components/Field";

export default function RequestsPage() {
    const access = useAccess();
    const toast = useToast();
    const [tab, setTab] = useState("pending");
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [decision, setDecision] = useState(null); // { request, action }
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);

    const canResolve = access.can("requests.resolve");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await get(`/api/requests?status=${tab === "pending" ? "pending" : "accepted,rejected,withdrawn"}`);
            setRows(res.requests || []);
        } catch (e) {
            toast("error", "Couldn't load requests", e.message);
        } finally {
            setLoading(false);
        }
    }, [tab, toast]);

    useEffect(() => { load(); }, [load]);

    // Late requests arrive while this page is open. Poll only the live queue.
    useEffect(() => {
        if (tab !== "pending") return;
        const id = setInterval(load, 20_000);
        return () => clearInterval(id);
    }, [tab, load]);

    const resolve = async () => {
        setBusy(true);
        try {
            const { request, action } = decision;
            await post(`/api/requests/${request._id}/${action}`, { note: note.trim() });
            toast(
                "success",
                action === "accept" ? "Request accepted" : "Request rejected",
                action === "accept"
                    ? describeEffect(request)
                    : "The booking is unchanged and the preparation count is unaffected."
            );
            setDecision(null);
            setNote("");
            await load();
            access.refreshPending?.();
        } catch (e) {
            // Left open on failure — a request the operator believes they
            // resolved but did not is exactly the state to avoid.
            toast("error", e.status === 403 ? "Not allowed" : "Couldn't save that decision", e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div>
            <div className="page-head">
                <h1 className="page-title">Approvals</h1>
                <p className="page-sub">
                    Bookings, changes and cancellations that arrived after the cutoff.
                    Nothing here affects the kitchen count until you accept it.
                </p>
            </div>

            <div className="row" style={{ marginBottom: 14 }}>
                {["pending", "resolved"].map((t) => (
                    <button key={t} className={`btn btn-sm ${tab === t ? "btn-primary" : ""}`}
                        onClick={() => setTab(t)}>
                        {t === "pending" ? "Waiting" : "Decided"}
                    </button>
                ))}
            </div>

            {loading && !rows.length ? (
                <div className="stack">{[0, 1].map((i) => <div key={i} className="sk" style={{ height: 130 }} />)}</div>
            ) : !rows.length ? (
                <div className="card">
                    <Empty
                        title={tab === "pending" ? "Nothing waiting" : "Nothing decided yet"}
                        note={tab === "pending"
                            ? "Late bookings and change requests will appear here the moment a customer submits one."
                            : "Requests you accept or reject are kept here as a record."}
                    />
                </div>
            ) : (
                <div className="stack">
                    {rows.map((r) => (
                        <RequestCard key={r._id} r={r} canResolve={canResolve && tab === "pending"}
                            onDecide={(action) => { setDecision({ request: r, action }); setNote(""); }} />
                    ))}
                </div>
            )}

            <Modal
                open={Boolean(decision)}
                onClose={() => !busy && setDecision(null)}
                title={decision?.action === "accept" ? "Accept this request?" : "Reject this request?"}
                subtitle={decision ? `${REQUEST_TYPE_LABEL[decision.request.type]} · ${decision.request.reference}` : ""}
                footer={
                    <>
                        <button className="btn btn-ghost" disabled={busy}
                            onClick={() => setDecision(null)}>Cancel</button>
                        <button className={`btn ${decision?.action === "accept" ? "btn-primary" : "btn-danger"}`}
                            disabled={busy} onClick={resolve}>
                            {busy ? "Saving…" : decision?.action === "accept" ? "Accept" : "Reject"}
                        </button>
                    </>
                }
            >
                {decision && (
                    <div className="stack">
                        <div className="banner banner-info">
                            {decision.action === "accept"
                                ? describeEffect(decision.request)
                                : "The booking stays exactly as it is, and the preparation count doesn't change."}
                        </div>
                        <Field
                            label="Note (optional)"
                            hint="The customer sees this on their booking status page. Worth a line when you reject."
                        >
                            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                                placeholder={decision.action === "accept"
                                    ? "e.g. Fitted in, collect from counter 2"
                                    : "e.g. Kitchen had already closed for lunch"} />
                        </Field>
                    </div>
                )}
            </Modal>
        </div>
    );
}

/** Plain English for what accepting will actually do to the kitchen count. */
function describeEffect(r) {
    const n = Math.abs(r.quantityDelta);
    if (r.type === "cancellation") return `The booking is cancelled and ${n} meals come off the preparation count.`;
    if (r.type === "new_booking") return `The booking is confirmed and ${n} meals are added to the preparation count.`;
    if (r.quantityDelta === 0) return "The variants change but the total stays the same.";
    return r.quantityDelta > 0
        ? `${n} more meals are added to the preparation count.`
        : `${n} meals come off the preparation count.`;
}

function RequestCard({ r, canResolve, onDecide }) {
    const up = r.quantityDelta > 0;
    // Anything waiting more than ten minutes is somebody standing around.
    const waited = Date.now() - new Date(r.createdAt).getTime();
    const urgent = r.status === "pending" && waited > 10 * 60 * 1000;

    return (
        <div className={`req-card ${urgent ? "urgent" : ""}`}>
            <div className="row-between wrap" style={{ marginBottom: 8 }}>
                <div className="row wrap">
                    <span className={`badge ${r.type === "cancellation" ? "badge-red" : "badge-amber"}`}>
                        {REQUEST_TYPE_LABEL[r.type]}
                    </span>
                    <strong>{r.partySnapshot?.name || "Unknown"}</strong>
                    {r.partySnapshot?.organisation && (
                        <span className="small muted">· {r.partySnapshot.organisation}</span>
                    )}
                    {r.status !== "pending" && <StatusBadge status={r.status} />}
                </div>
                <span className="xsmall faint">{timeAgo(r.createdAt)}</span>
            </div>

            <div className="row wrap small muted" style={{ gap: 12, marginBottom: 6 }}>
                <span>{r.mealTypeName} · {formatDate(r.date)}</span>
                <span className="mono">{prettyPhone(r.partySnapshot?.phone)}</span>
                <span className="mono">{r.reference}</span>
            </div>

            {/* What actually changes. For a change request the before and after
                are both shown, because "Veg 7 → 5" is the decision. */}
            <div className="req-diff">
                {r.type === "change" ? (
                    <ChangeDiff current={r.currentLines} requested={r.requestedLines} />
                ) : (
                    (r.type === "cancellation" ? r.currentLines : r.requestedLines).map((l) => (
                        <span key={l.variantId} className="diff-chip">
                            <span className="now">{l.quantity}</span> {l.variantName}
                        </span>
                    ))
                )}
            </div>

            <div className="row-between wrap">
                <div className="row" style={{ gap: 10 }}>
                    <span className={`req-delta ${up ? "up" : "down"}`}>
                        {up ? "+" : ""}{r.quantityDelta}
                    </span>
                    <span className="small muted">
                        meals {up ? "added to" : "off"} the count if accepted
                        {/* Only meaningful when the booking already counts for
                            something. On a NEW late booking the booking IS the
                            pending thing, so "booking currently 8" just repeats
                            the number above it. */}
                        {r.type !== "new_booking" && r.booking
                            && ` · booking currently ${r.booking.totalQuantity}`}
                    </span>
                </div>

                {canResolve && (
                    <div className="row">
                        <button className="btn btn-sm" onClick={() => onDecide("reject")}>Reject</button>
                        <button className="btn btn-sm btn-primary" onClick={() => onDecide("accept")}>Accept</button>
                    </div>
                )}
            </div>

            {r.customerNote && (
                <p className="small muted" style={{ marginTop: 8, fontStyle: "italic" }}>
                    “{r.customerNote}”
                </p>
            )}
            {r.status !== "pending" && r.resolutionNote && (
                <p className="xsmall faint" style={{ marginTop: 6 }}>
                    {r.resolvedByName ? `${r.resolvedByName}: ` : ""}{r.resolutionNote}
                </p>
            )}
        </div>
    );
}

/** Before → after per variant, showing only what actually moved. */
function ChangeDiff({ current = [], requested = [] }) {
    const byId = new Map();
    current.forEach((l) => byId.set(String(l.variantId), { name: l.variantName, was: l.quantity, now: 0 }));
    requested.forEach((l) => {
        const k = String(l.variantId);
        const e = byId.get(k) || { name: l.variantName, was: 0, now: 0 };
        e.now = l.quantity;
        byId.set(k, e);
    });

    return [...byId.entries()]
        .filter(([, v]) => v.was !== v.now)
        .map(([k, v]) => (
            <span key={k} className="diff-chip">
                <span className="was">{v.was}</span>
                <span className="now">{v.now}</span> {v.name}
            </span>
        ));
}
