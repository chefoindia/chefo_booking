"use client";
// "What happened to my booking?" — the status experience that stands in for
// accounts and notifications in V1.
//
// Enter the phone number you booked with, see your bookings and where each one
// stands. Nothing is verified, which is the accepted V1 tradeoff, so this shows
// only what the person who made the booking already knows, and acting on one
// requires the phone number again.
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { post } from "@/lib/api";
import { formatDate } from "@/lib/format";

const STATUS = {
    confirmed: { label: "Confirmed", cls: "badge-green" },
    pending_approval: { label: "Waiting for approval", cls: "badge-amber" },
    rejected: { label: "Not accepted", cls: "badge-red" },
    cancelled: { label: "Cancelled", cls: "badge-gray" },
};

const REQUEST_LABEL = {
    new_booking: "Late booking",
    change: "Change request",
    cancellation: "Cancellation request",
};

export default function StatusPage() {
    const { slug } = useParams();
    const [phone, setPhone] = useState("");
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [acting, setActing] = useState("");

    const lookup = async (e) => {
        e?.preventDefault();
        setBusy(true);
        setError("");
        try {
            setData(await post(`/api/public/business/${slug}/lookup`, { phone: phone.trim() }));
        } catch (err) {
            setError(err.message || "Could not look that up.");
            setData(null);
        } finally {
            setBusy(false);
        }
    };

    const cancel = async (booking) => {
        setActing(booking.id);
        setError("");
        try {
            const res = await post(
                `/api/public/business/${slug}/bookings/${booking.id}/cancel`,
                { phone: phone.trim(), reason: "Cancelled by customer" }
            );
            // The outcome differs by cutoff, and the customer is told which
            // happened rather than left to infer it from a status word.
            setError(res.applied
                ? ""
                : "Your cancellation request has been sent — the canteen needs to accept it.");
            await lookup();
        } catch (err) {
            setError(err.message || "Could not cancel that booking.");
        } finally {
            setActing("");
        }
    };

    return (
        <div className="wrap">
            <div className="head">
                <Link href={`/b/${slug}`} className="head-mark" style={{ textDecoration: "none" }}>←</Link>
                <div>
                    <div className="head-name">My bookings</div>
                    <div className="head-sub">Look them up with your mobile number</div>
                </div>
            </div>

            <form className="card" onSubmit={lookup}>
                <label className="label">Mobile number</label>
                <input className="input" inputMode="numeric" placeholder="The number you booked with"
                    value={phone} onChange={(e) => setPhone(e.target.value)} />
                <button className="btn btn-primary" style={{ marginTop: 11 }}
                    disabled={busy || phone.trim().length < 10}>
                    {busy ? "Looking…" : "Find my bookings"}
                </button>
            </form>

            {error && <div className="notice notice-warn" style={{ marginBottom: 12 }}>{error}</div>}

            {data && (
                data.bookings.length === 0 ? (
                    <div className="card center">
                        <p className="small muted">
                            No bookings found for that number at this canteen.
                        </p>
                        <Link href={`/b/${slug}`} className="btn" style={{ marginTop: 12 }}>
                            Make a booking
                        </Link>
                    </div>
                ) : (
                    <>
                        <p className="small muted" style={{ margin: "4px 2px 10px" }}>
                            {data.party?.name} · {data.bookings.length} booking
                            {data.bookings.length === 1 ? "" : "s"}
                        </p>

                        {data.bookings.map((b) => {
                            const s = STATUS[b.status] || STATUS.confirmed;
                            return (
                                <div key={b.id} className="card">
                                    <div className="row-between" style={{ marginBottom: 8 }}>
                                        <div>
                                            <strong>{b.mealTypeName}</strong>
                                            <div className="xsmall faint">{formatDate(b.date, { year: true })}</div>
                                        </div>
                                        <span className={`badge ${s.cls}`}>{s.label}</span>
                                    </div>

                                    <div className="stack-sm">
                                        {b.lines.map((l) => (
                                            <div key={l.variantId} className="row-between small">
                                                <span className="muted">{l.variantName}</span>
                                                <strong>{l.quantity}</strong>
                                            </div>
                                        ))}
                                        <div className="row-between" style={{
                                            paddingTop: 8, borderTop: "1px solid var(--border)", fontWeight: 700,
                                        }}>
                                            <span>Total</span><span>{b.totalQuantity}</span>
                                        </div>
                                    </div>

                                    <div className="row-between" style={{ marginTop: 10 }}>
                                        <span className="mono xsmall faint">{b.reference}</span>
                                        {b.canCancel && !["cancelled", "rejected"].includes(b.status) && (
                                            <button className="btn btn-sm" disabled={acting === b.id}
                                                onClick={() => cancel(b)}>
                                                {acting === b.id ? "…"
                                                    : b.cutoffPassed ? "Request cancellation" : "Cancel"}
                                            </button>
                                        )}
                                    </div>

                                    {b.openRequest && (
                                        <div className="notice notice-warn" style={{ marginTop: 10 }}>
                                            Your {REQUEST_LABEL[b.openRequest.type].toLowerCase()} is with
                                            the canteen. They&apos;ll accept or decline it.
                                        </div>
                                    )}

                                    {/* The operator's reason, when they left one — the closest
                                        thing V1 has to telling a customer why. */}
                                    {b.requestHistory?.filter((r) => r.note).map((r) => (
                                        <p key={r.reference} className="xsmall faint" style={{ marginTop: 8 }}>
                                            {REQUEST_LABEL[r.type]} {r.status}: “{r.note}”
                                        </p>
                                    ))}
                                </div>
                            );
                        })}
                    </>
                )
            )}
        </div>
    );
}
