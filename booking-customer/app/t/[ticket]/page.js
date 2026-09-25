"use client";
// /t/<ticket> — where a QR code lands when a phone's own camera scans it.
//
// This page stands entirely on its own: one ticket, no cookie, no lookup,
// nothing typed — because whatever scanned it (the customer's camera, a
// colleague's phone, a laptop) has none of those.
//
// It writes to the ledger: opening your own code on a new phone is the
// simplest way to move a booking to it. Arriving here IS the adoption.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { get } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { addToLedger } from "@/lib/ledger";
import BookingQr from "@/components/BookingQr";
import { Icon, PATHS } from "@/components/Icons";
import { BRAND } from "@/lib/brand";

const STATUS = {
    confirmed: { label: "Confirmed", cls: "badge-green" },
    pending_approval: { label: "Waiting for approval", cls: "badge-amber" },
    rejected: { label: "Not accepted", cls: "badge-red" },
    cancelled: { label: "Cancelled", cls: "badge-gray" },
};
const REQUEST_LABEL = { new_booking: "Late booking", change: "Change request", cancellation: "Cancellation request" };
const servedWhen = (iso) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); }
    catch { return ""; }
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
                if (res?.business?.slug && res?.booking) {
                    addToLedger(res.business.slug, { ...res.booking, ticket: res.booking.ticket || ticket });
                }
            } catch (err) {
                if (!alive) return;
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
                <div className="sk" style={{ height: 320 }} />
            </div>
        );
    }

    if (missing || !data) {
        return (
            <div className="wrap">
                <div className="card center" style={{ padding: 28, marginTop: 24 }}>
                    <div className="done-mark" style={{ background: "var(--brick-soft)", color: "var(--brick)" }}><Icon d={PATHS.qr} size={30} /></div>
                    <h2 style={{ fontSize: 17, marginBottom: 6 }}>We couldn&apos;t find that booking</h2>
                    <p className="small muted">
                        {error || "The code may have been mistyped, or the booking is no longer there. Ask the canteen to look it up with your mobile number."}
                    </p>
                </div>
                <p className="powered">Powered by <strong>{BRAND.company}</strong> {BRAND.shortName}</p>
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
            <div className="row" style={{ gap: 12, padding: "12px 0 16px" }}>
                <span className="app-topbar-mark" style={{ width: 44, height: 44, fontSize: 18 }}>
                    {biz.logoUrl ? <img src={biz.logoUrl} alt="" /> : (biz.name || "B").charAt(0).toUpperCase()}
                </span>
                <div style={{ minWidth: 0 }}>
                    <div className="app-topbar-title" style={{ fontSize: 17 }}>{biz.name}</div>
                    <div className="app-topbar-sub">
                        {[biz.addressLine, biz.landmark, biz.city].filter(Boolean).join(", ") || "Meal booking"}
                        {biz.contactPhone ? ` · ${biz.contactPhone}` : ""}
                    </div>
                </div>
                <span className={`badge ${s.cls}`} style={{ marginLeft: "auto" }}>{served && !closed ? "Collected" : s.label}</span>
            </div>

            {served ? (
                <div className="notice notice-ok" style={{ marginBottom: 12 }}>
                    <strong>Already collected</strong>{served.at ? ` · ${servedWhen(served.at)}` : ""}{served.by ? ` · ${served.by}` : ""}
                </div>
            ) : closed ? (
                <div className="notice notice-bad" style={{ marginBottom: 12 }}>This booking is {s.label.toLowerCase()} — there is nothing to collect.</div>
            ) : null}

            {closed ? (
                <div className="card center">
                    <div className="tk-meal">{b.mealTypeName}</div>
                    <div className="tk-when">{formatDate(b.date, { year: true })}{b.outletName ? ` · ${b.outletName}` : ""}</div>
                    <div className="mono xsmall faint" style={{ marginTop: 10 }}>{b.reference}</div>
                </div>
            ) : (
                <BookingQr ticket={b.ticket || ticket} reference={b.reference} booking={b} businessName={biz?.name || ""}
                    hint={served ? "Already collected" : "Show this at the counter"} />
            )}

            {b.requestHistory?.filter((r) => r.note).map((r) => (
                <p key={r.reference} className="xsmall faint" style={{ marginTop: 8 }}>{REQUEST_LABEL[r.type]} {r.status}: “{r.note}”</p>
            ))}

            {biz.slug && (
                <div style={{ marginTop: 14 }}>
                    <div className="btn-row">
                        <Link href={`/b/${biz.slug}/bookings`} className="btn">My bookings</Link>
                        <Link href={`/b/${biz.slug}`} className="btn btn-primary">Book another</Link>
                    </div>
                    <p className="hint center" style={{ marginTop: 10 }}>This booking is now saved on this device, so you can find it again without the code.</p>
                </div>
            )}

            <p className="powered">Powered by <strong>{BRAND.company}</strong> {BRAND.shortName}</p>
        </div>
    );
}
