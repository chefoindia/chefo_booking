"use client";
// /t/<ticket> — where a QR code lands when a phone's own camera scans it.
//
// WHY THIS PAGE EXISTS SEPARATELY FROM "My bookings": the QR encodes a URL, and
// a URL gets opened by whatever scanned it — the customer's camera app, a
// colleague's phone the booking was forwarded to, a laptop. So this page has to
// stand entirely on its own: one ticket, no cookie, no lookup, nothing typed.
//
// WHY IT WRITES TO THE LEDGER: opening your own code on a new phone is the
// simplest possible way to move a booking to it. Arriving here IS the adoption
// — the booking joins this device's ledger and shows up in "My bookings" from
// then on, without an account and without a lookup.
//
// The operator's scanner reads the same ticket from the counter side; what a
// customer sees here is only their own booking, never who served it to whom.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { get } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { addToLedger } from "@/lib/ledger";
import BookingQr from "@/components/BookingQr";

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

const servedWhen = (iso) => {
    if (!iso) return "";
    try {
        return new Date(iso).toLocaleString("en-IN", {
            day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
        });
    } catch { return ""; }
};

export default function TicketPage() {
    const { ticket } = useParams();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await get(`/api/public/t/${encodeURIComponent(ticket)}`);
                if (!alive) return;
                setData(res);
                // The ticket may not be echoed back inside the booking shape;
                // the one in the URL is the one that got us here either way.
                if (res?.business?.slug && res?.booking) {
                    addToLedger(res.business.slug, { ...res.booking, ticket: res.booking.ticket || ticket });
                }
            } catch (err) {
                if (!alive) return;
                // A wrong or expired code is an ordinary thing to happen to a
                // scanned image, not an error worth shouting about.
                if (err.status === 404 || err.code === "NO_TICKET") setMissing(true);
                else setError(err.message || "Could not open that booking.");
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [ticket]);

    if (loading) {
        return (
            <div className="wrap">
                <div className="sk" style={{ height: 74, marginBottom: 12 }} />
                <div className="sk" style={{ height: 300 }} />
            </div>
        );
    }

    if (missing || !data) {
        return (
            <div className="wrap">
                <div className="head">
                    <span className="head-mark">?</span>
                    <div>
                        <div className="head-name">Booking</div>
                        <div className="head-sub">Scanned code</div>
                    </div>
                </div>
                <div className="card">
                    <h2 style={{ fontSize: 16, marginBottom: 6 }}>We could not find that booking</h2>
                    <p className="small muted">
                        {error || "The code may have been mistyped, or the booking is no longer there. Ask the canteen to look it up with your mobile number."}
                    </p>
                </div>
                <p className="powered">Powered by <strong>Chefo</strong> Booking</p>
            </div>
        );
    }

    const b = data.booking || {};
    const biz = data.business || {};
    const s = STATUS[b.status] || STATUS.confirmed;
    const served = data.consumed || null;
    const closed = ["cancelled", "rejected"].includes(b.status);

    return (
        <div className="wrap">
            <div className="head">
                <span className="head-mark">
                    {biz.logoUrl ? <img src={biz.logoUrl} alt="" /> : (biz.name || "B").charAt(0).toUpperCase()}
                </span>
                <div style={{ minWidth: 0 }}>
                    <div className="head-name">{biz.name}</div>
                    <div className="head-sub">
                        {[biz.addressLine, biz.landmark, biz.city].filter(Boolean).join(", ") || "Meal booking"}
                        {biz.contactPhone ? ` · ${biz.contactPhone}` : ""}
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="row-between" style={{ marginBottom: 10 }}>
                    <div style={{ minWidth: 0 }}>
                        <strong>{b.mealTypeName}</strong>
                        <div className="xsmall faint">
                            {formatDate(b.date, { year: true })}{b.outletName ? ` · ${b.outletName}` : ""}
                        </div>
                    </div>
                    <span className={`badge ${s.cls}`}>{s.label}</span>
                </div>

                <div className="stack-sm">
                    {(b.lines || []).map((l) => (
                        <div key={l.variantId} className="row-between small">
                            <span className="muted">{l.variantName}</span>
                            <strong>{l.quantity}</strong>
                        </div>
                    ))}
                    <div className="row-between" style={{
                        paddingTop: 8, borderTop: "1px solid var(--border)", fontWeight: 700,
                    }}>
                        <span>Total</span>
                        <span>{b.totalQuantity} meal{b.totalQuantity === 1 ? "" : "s"}</span>
                    </div>
                </div>

                {served ? (
                    <div className="t-served">
                        <span aria-hidden="true">✓</span>
                        <span>
                            Already collected{served.at ? ` · ${servedWhen(served.at)}` : ""}
                            {served.by ? ` · ${served.by}` : ""}
                        </span>
                    </div>
                ) : closed ? (
                    <div className="notice notice-bad" style={{ marginTop: 12 }}>
                        This booking is {s.label.toLowerCase()} — there is nothing to collect.
                    </div>
                ) : null}

                {/* A cancelled booking gets no code — there is nothing to present,
                    and a scannable image would say otherwise. A collected one keeps
                    its code, because it is still the proof of which booking this is. */}
                {closed ? (
                    <div className="center" style={{ marginTop: 12 }}>
                        <span className="mono xsmall faint">{b.reference}</span>
                    </div>
                ) : (
                    <div className="t-qr">
                        <BookingQr
                            ticket={b.ticket || ticket}
                            reference={b.reference}
                            booking={b}
                            businessName={biz?.name || ""}
                            hint={served ? "Already collected" : "Show this at the counter"}
                        />
                    </div>
                )}

                {b.requestHistory?.filter((r) => r.note).map((r) => (
                    <p key={r.reference} className="xsmall faint" style={{ marginTop: 8 }}>
                        {REQUEST_LABEL[r.type]} {r.status}: “{r.note}”
                    </p>
                ))}
            </div>

            {biz.slug && (
                <>
                    <Link href={`/b/${biz.slug}/bookings`} className="btn">My bookings</Link>
                    <Link href={`/b/${biz.slug}`} className="btn btn-ghost" style={{ marginTop: 8 }}>
                        Book something else
                    </Link>
                    <p className="hint center" style={{ marginTop: 10 }}>
                        This booking has been saved to this device, so you can find it again
                        without the code.
                    </p>
                </>
            )}

            <p className="powered">Powered by <strong>Chefo</strong> Booking</p>

            <style>{`
              .t-served {
                display: flex; align-items: center; gap: 7px; margin-top: 12px;
                padding: 10px 12px; border-radius: var(--radius-sm);
                background: var(--basil-soft); color: var(--basil-dark); font-size: 13px;
              }
              .t-qr { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); }
            `}</style>
        </div>
    );
}
