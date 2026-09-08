"use client";
// The customer booking page. Deliberately one screen, one column, one action.
//
// THE THING THAT MATTERS HERE: the customer is told BEFORE they fill anything
// in whether this booking will be confirmed on the spot or will need the
// canteen's approval, because the cutoff has passed. Finding that out only
// after submitting is the difference between a system that feels honest and one
// that feels broken.
//
// The server decides that (mealTypes[].cutoffPassed). This page renders it.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { get, post } from "@/lib/api";
import { formatDate, formatTime, todayKey } from "@/lib/format";

export default function BookingPage() {
    const { slug } = useParams();
    const [date, setDate] = useState(todayKey());
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [mealTypeId, setMealTypeId] = useState("");
    const [qty, setQty] = useState({});
    const [form, setForm] = useState({
        name: "", phone: "", organisation: "", partyType: "individual", location: "", note: "",
    });
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await get(`/api/public/business/${slug}?date=${date}`);
            setData(res);
            // Keep the chosen meal across a date change when it still exists.
            setMealTypeId((prev) =>
                res.mealTypes.some((m) => String(m.id) === String(prev)) ? prev : "");
        } catch (e) {
            setError(e.message || "Could not load this canteen.");
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [slug, date]);

    useEffect(() => { load(); }, [load]);

    // Remembering the last customer on THIS device is a convenience only —
    // the backend remains the source of truth, and this never authenticates
    // anything. It just saves retyping a name and number every morning.
    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem("chefo-booking-me") || "null");
            if (saved) setForm((f) => ({ ...f, ...saved }));
        } catch { /* private mode, or cleared storage — no problem */ }
    }, []);

    const meal = useMemo(
        () => data?.mealTypes.find((m) => String(m.id) === String(mealTypeId)) || null,
        [data, mealTypeId]
    );

    const total = Object.values(qty).reduce((n, v) => n + (Number(v) || 0), 0);
    const rules = data?.business?.rules || {};

    const ready = meal && total > 0 && form.name.trim() && form.phone.trim().length >= 10
        && (!rules.requireOrganisation || form.organisation.trim())
        && (!rules.requireLocation || form.location.trim());

    const submit = async () => {
        setBusy(true);
        setError("");
        try {
            const res = await post(`/api/public/business/${slug}/bookings`, {
                mealTypeId, date, quantities: qty,
                party: {
                    name: form.name.trim(), phone: form.phone.trim(),
                    organisation: form.organisation.trim(),
                    partyType: form.partyType,
                    location: form.location.trim(),
                },
                customerNote: form.note.trim(),
                location: form.location.trim(),
            });
            try {
                localStorage.setItem("chefo-booking-me", JSON.stringify({
                    name: form.name, phone: form.phone,
                    organisation: form.organisation, partyType: form.partyType,
                }));
            } catch { /* nothing important lost */ }
            setResult(res);
        } catch (e) {
            setError(e.message || "Could not submit your booking.");
        } finally {
            setBusy(false);
        }
    };

    if (loading) {
        return <div className="wrap"><div className="sk" style={{ height: 260 }} /></div>;
    }

    if (!data) {
        return (
            <div className="wrap">
                <div className="card">
                    <h2 style={{ fontSize: 16, marginBottom: 6 }}>Canteen not found</h2>
                    <p className="small muted">{error || "Check the link you were given."}</p>
                </div>
            </div>
        );
    }

    if (result) {
        return <Confirmation result={result} business={data.business} slug={slug} meal={meal} date={date} />;
    }

    const b = data.business;

    return (
        <div className="wrap">
            <div className="head">
                <span className="head-mark">{(b.name || "B").charAt(0).toUpperCase()}</span>
                <div style={{ minWidth: 0 }}>
                    <div className="head-name">{b.name}</div>
                    <div className="head-sub">
                        {[b.addressLine, b.city].filter(Boolean).join(", ") || "Meal booking"}
                    </div>
                </div>
            </div>

            {!b.acceptingBookings ? (
                <div className="card">
                    <div className="notice notice-bad">
                        {b.closedMessage || "This canteen isn't accepting bookings right now."}
                    </div>
                    <Link href={`/b/${slug}/status`} className="btn btn-ghost" style={{ marginTop: 12 }}>
                        Check an existing booking
                    </Link>
                </div>
            ) : (
                <>
                    {error && <div className="notice notice-bad" style={{ marginBottom: 12 }}>{error}</div>}

                    <div className="card">
                        <label className="label">Which day?</label>
                        <input className="input" type="date" value={date}
                            min={data.today} max={data.maxDate}
                            onChange={(e) => e.target.value && setDate(e.target.value)} />
                        <span className="hint">{formatDate(date, { year: true })}</span>
                    </div>

                    <div className="card">
                        <label className="label">Which meal?</label>
                        {!data.mealTypes.length ? (
                            <p className="small muted">No meals are open for booking on this day.</p>
                        ) : (
                            <div className="meal-list">
                                {data.mealTypes.map((m) => (
                                    <button key={m.id} type="button"
                                        className={`meal-opt ${String(m.id) === String(mealTypeId) ? "on" : ""}`}
                                        onClick={() => { setMealTypeId(m.id); setQty({}); }}>
                                        <span>
                                            <span className="meal-opt-name">{m.name}</span>
                                            {m.startTime && m.endTime && (
                                                <span className="xsmall faint" style={{ display: "block" }}>
                                                    Served {formatTime(m.startTime)}–{formatTime(m.endTime)}
                                                </span>
                                            )}
                                        </span>
                                        {/* Said up front, not after submitting. */}
                                        {m.cutoffPassed
                                            ? <span className="badge badge-amber">Needs approval</span>
                                            : m.hasCutoff
                                                ? <span className="badge badge-green">Till {formatTime(m.cutoffTime)}</span>
                                                : <span className="badge badge-green">Open</span>}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {meal && (
                        <>
                            {meal.cutoffPassed && (
                                <div className="notice notice-warn" style={{ marginBottom: 12 }}>
                                    <strong>Booking closed at {formatTime(meal.cutoffTime)}.</strong> You can
                                    still send this, but the canteen has to accept it before it&apos;s
                                    confirmed — they may already have started cooking.
                                </div>
                            )}

                            <div className="card">
                                <label className="label">How many meals?</label>
                                {meal.variants.map((v) => (
                                    <div key={v.id} className="qty-row">
                                        <div>
                                            <div className="qty-name">{v.name}</div>
                                            {v.description && <div className="xsmall faint">{v.description}</div>}
                                        </div>
                                        <Stepper
                                            value={qty[v.id] || 0}
                                            onChange={(n) => setQty((q) => ({ ...q, [v.id]: n }))}
                                            max={rules.maxQuantityPerBooking || 500}
                                        />
                                    </div>
                                ))}
                                <div className="total-bar">
                                    <span>Total</span>
                                    <span>{total}</span>
                                </div>
                            </div>

                            <div className="card">
                                <label className="label">Your details</label>
                                <div className="stack-sm">
                                    <input className="input" placeholder="Your name" value={form.name}
                                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                                    <input className="input" placeholder="Mobile number" inputMode="numeric"
                                        value={form.phone}
                                        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                                    <span className="hint" style={{ marginTop: -2 }}>
                                        Used to find your booking later. No account needed.
                                    </span>

                                    <select className="select" value={form.partyType}
                                        onChange={(e) => setForm((f) => ({ ...f, partyType: e.target.value }))}>
                                        {(b.partyTypes || []).map((p) => (
                                            <option key={p.key} value={p.key}>{p.label}</option>
                                        ))}
                                    </select>

                                    <input className="input"
                                        placeholder={`Organisation / site${rules.requireOrganisation ? "" : " (optional)"}`}
                                        value={form.organisation}
                                        onChange={(e) => setForm((f) => ({ ...f, organisation: e.target.value }))} />

                                    {rules.requireLocation && (
                                        <input className="input" placeholder="Where should it go?"
                                            value={form.location}
                                            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
                                    )}

                                    <textarea className="textarea" rows={2} placeholder="Anything else? (optional)"
                                        value={form.note}
                                        onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
                                </div>
                            </div>

                            <button className="btn btn-primary" disabled={!ready || busy} onClick={submit}>
                                {busy ? "Sending…"
                                    : meal.cutoffPassed
                                        ? `Request ${total || ""} meal${total === 1 ? "" : "s"}`.trim()
                                        : `Book ${total || ""} meal${total === 1 ? "" : "s"}`.trim()}
                            </button>
                        </>
                    )}
                </>
            )}

            <div className="center" style={{ marginTop: 18 }}>
                <Link href={`/b/${slug}/status`} className="link">Check an existing booking</Link>
            </div>
        </div>
    );
}

function Stepper({ value, onChange, max }) {
    return (
        <div className="qty-ctrl">
            <button type="button" className="qty-btn" disabled={value <= 0}
                onClick={() => onChange(Math.max(0, value - 1))} aria-label="One fewer">−</button>
            {/* Typable as well as steppable — nobody taps + eighty times. */}
            <input className="qty-num" inputMode="numeric" value={value}
                onChange={(e) => {
                    const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
                    onChange(Math.min(max, Number.isFinite(n) ? n : 0));
                }} />
            <button type="button" className="qty-btn" disabled={value >= max}
                onClick={() => onChange(Math.min(max, value + 1))} aria-label="One more">+</button>
        </div>
    );
}

function Confirmation({ result, business, slug, meal, date }) {
    const pending = result.outcome === "pending_approval";
    return (
        <div className="wrap">
            <div className="card center" style={{ paddingTop: 26, paddingBottom: 22 }}>
                <div className={`done-mark ${pending ? "done-wait" : "done-ok"}`}>
                    {pending ? "!" : "✓"}
                </div>
                <h1 style={{ fontSize: 19 }}>
                    {pending ? "Sent for approval" : "Booking confirmed"}
                </h1>
                <p className="small muted" style={{ marginTop: 7 }}>
                    {pending
                        ? `${business.name} has to accept this before it's confirmed, because booking had already closed for this meal. Check back here to see their answer.`
                        : `${business.name} has your booking. Nothing else to do.`}
                </p>

                <div className="ref">{result.booking.reference}</div>

                <div className="stack-sm" style={{ marginTop: 18, textAlign: "left" }}>
                    <div className="row-between small">
                        <span className="muted">Meal</span>
                        <strong>{result.booking.mealTypeName}</strong>
                    </div>
                    <div className="row-between small">
                        <span className="muted">Date</span>
                        <strong>{formatDate(result.booking.date, { year: true })}</strong>
                    </div>
                    {result.booking.lines.map((l) => (
                        <div key={l.variantId} className="row-between small">
                            <span className="muted">{l.variantName}</span>
                            <strong>{l.quantity}</strong>
                        </div>
                    ))}
                    <div className="row-between" style={{
                        paddingTop: 9, borderTop: "1px solid var(--border)", fontWeight: 750,
                    }}>
                        <span>Total</span>
                        <span>{result.booking.totalQuantity}</span>
                    </div>
                </div>
            </div>

            <Link href={`/b/${slug}/status`} className="btn">View my bookings</Link>
            <button className="btn btn-ghost" style={{ marginTop: 8 }}
                onClick={() => window.location.reload()}>
                Book something else
            </button>
        </div>
    );
}
