"use client";
// The customer booking page. One screen, one column, one action — used on a
// phone by someone who may never have seen it before.
//
// WHAT IT TELLS THE CUSTOMER, IN ORDER:
//   which day · which meal (and whether it will confirm now or need approval)
//   · what's on the menu for that day, per option · how many, at what price
//   · who they are · the total · one button.
//
// The server decides everything that matters (cutoff state, the day's menu,
// prices); this page renders it and never works any of it out itself.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { get, post } from "@/lib/api";
import { formatDate, formatTime, todayKey, shiftDate } from "@/lib/format";

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

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
    // it never authenticates anything. It just saves retyping every morning.
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
    const amount = meal ? meal.variants.reduce((n, v) => n + (Number(qty[v.id]) || 0) * (v.price || 0), 0) : 0;
    const anyPriced = meal ? meal.variants.some((v) => v.price > 0) : false;
    const rules = data?.business?.rules || {};
    const b = data?.business;

    const phoneOk = form.phone.replace(/\D/g, "").length >= 10;
    const ready = meal && meal.servedToday && total > 0 && form.name.trim() && phoneOk
        && (!rules.requireOrganisation || form.organisation.trim())
        && (!rules.requireLocation || form.location.trim())
        && (!rules.requireNote || form.note.trim());

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
            window.scrollTo({ top: 0 });
        } catch (e) {
            setError(e.message || "Could not submit your booking.");
        } finally {
            setBusy(false);
        }
    };

    if (loading && !data) {
        return <div className="wrap"><div className="sk" style={{ height: 80, marginBottom: 12 }} /><div className="sk" style={{ height: 260 }} /></div>;
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
        return <Confirmation result={result} business={b} slug={slug} onAgain={() => { setResult(null); setQty({}); }} />;
    }

    const quick = [
        { d: data.today, l: "Today" },
        { d: shiftDate(data.today, 1), l: "Tomorrow" },
        { d: shiftDate(data.today, 2), l: formatDate(shiftDate(data.today, 2)).split(",")[0] },
    ].filter((x) => x.d <= data.maxDate);

    return (
        <div className="wrap">
            <Header b={b} />

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

                    {/* ---- 1. the day ---- */}
                    <div className="card">
                        <div className="step-head"><span className="step-n">1</span><label className="label" style={{ margin: 0 }}>Which day?</label></div>
                        <div className="chip-row">
                            {quick.map((x) => (
                                <button key={x.d} type="button" className={`chip ${date === x.d ? "on" : ""}`} onClick={() => setDate(x.d)}>{x.l}</button>
                            ))}
                            <input className="input chip-date" type="date" value={date} min={data.today} max={data.maxDate}
                                onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Pick a date" />
                        </div>
                        <span className="hint">{formatDate(date, { year: true })} · bookings open up to {rules.maxDaysAhead ?? 14} day{(rules.maxDaysAhead ?? 14) === 1 ? "" : "s"} ahead</span>
                    </div>

                    {/* ---- 2. the meal ---- */}
                    <div className="card">
                        <div className="step-head"><span className="step-n">2</span><label className="label" style={{ margin: 0 }}>Which meal?</label></div>
                        {!data.mealTypes.length ? (
                            <p className="small muted">No meals are open for booking on this day.</p>
                        ) : (
                            <div className="meal-list">
                                {data.mealTypes.map((m) => {
                                    const on = String(m.id) === String(mealTypeId);
                                    const dishes = m.variants.flatMap((v) => v.dishes || []);
                                    return (
                                        <button key={m.id} type="button" disabled={!m.servedToday}
                                            className={`meal-opt ${on ? "on" : ""}`}
                                            onClick={() => { setMealTypeId(m.id); setQty({}); }}>
                                            <span style={{ minWidth: 0 }}>
                                                <span className="meal-opt-name">{m.name}</span>
                                                {m.startTime && m.endTime && (
                                                    <span className="xsmall faint" style={{ display: "block" }}>
                                                        Served {formatTime(m.startTime)}–{formatTime(m.endTime)}
                                                    </span>
                                                )}
                                                {!m.servedToday ? (
                                                    <span className="xsmall" style={{ display: "block", color: "var(--brick)" }}>Not served on {formatDate(date).split(",")[0]}</span>
                                                ) : dishes.length > 0 && !on ? (
                                                    <span className="xsmall muted meal-peek">{dishes.slice(0, 3).join(" · ")}{dishes.length > 3 ? " …" : ""}</span>
                                                ) : null}
                                            </span>
                                            {/* Said up front, not after submitting. */}
                                            {!m.servedToday ? <span className="badge badge-gray">Closed</span>
                                                : m.cutoffPassed ? <span className="badge badge-amber">Needs approval</span>
                                                    : m.hasCutoff ? <span className="badge badge-green">Book till {formatTime(m.cutoffTime)}</span>
                                                        : <span className="badge badge-green">Open</span>}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {meal && (
                        <>
                            {meal.cutoffPassed ? (
                                <div className="notice notice-warn" style={{ marginBottom: 12 }}>
                                    <strong>Booking for {meal.name} closed at {formatTime(meal.cutoffTime)}{meal.cutoffPreviousDay ? " the day before" : ""}.</strong>{" "}
                                    You can still send this. {b.name} has to accept it before it&apos;s confirmed — they may already have started cooking.
                                </div>
                            ) : meal.hasCutoff ? (
                                <div className="notice notice-ok" style={{ marginBottom: 12 }}>
                                    Book before <strong>{formatTime(meal.cutoffTime)}{meal.cutoffPreviousDay ? " the day before" : ""}</strong> and it&apos;s confirmed on the spot.
                                </div>
                            ) : null}

                            {/* ---- 3. how many ---- */}
                            <div className="card">
                                <div className="step-head"><span className="step-n">3</span><label className="label" style={{ margin: 0 }}>How many meals?</label></div>
                                {meal.menuNote && <div className="notice" style={{ marginBottom: 10, fontSize: 13 }}>{meal.menuNote}</div>}
                                {meal.variants.map((v) => (
                                    <div key={v.id} className="qty-row">
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                                                <span className="qty-name">{v.name}</span>
                                                {v.price > 0 && <span className="price-tag">{inr(v.price)} each</span>}
                                            </div>
                                            {v.description && <div className="xsmall faint">{v.description}</div>}
                                            {v.dishes?.length > 0 ? (
                                                <ul className="dishes">{v.dishes.map((d, i) => <li key={i}>{d}</li>)}</ul>
                                            ) : meal.hasMenu ? (
                                                <div className="xsmall faint" style={{ marginTop: 3 }}>Menu not listed for this option today.</div>
                                            ) : null}
                                        </div>
                                        <Stepper
                                            value={qty[v.id] || 0}
                                            onChange={(n) => setQty((q) => ({ ...q, [v.id]: n }))}
                                            max={rules.maxQuantityPerBooking || 500}
                                        />
                                    </div>
                                ))}
                                <div className="total-bar">
                                    <span>{total} meal{total === 1 ? "" : "s"}</span>
                                    {anyPriced ? <span>{inr(amount)}</span> : <span className="small muted" style={{ fontWeight: 500 }}>Pay at the counter</span>}
                                </div>
                                {anyPriced && <span className="hint">Amount is indicative — payment is settled with {b.name} directly.</span>}
                            </div>

                            {/* ---- 4. who ---- */}
                            <div className="card">
                                <div className="step-head"><span className="step-n">4</span><label className="label" style={{ margin: 0 }}>Your details</label></div>
                                <div className="stack-sm">
                                    <input className="input" placeholder="Your name" value={form.name} autoComplete="name"
                                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                                    <div className="row" style={{ gap: 8 }}>
                                        <span className="input" style={{ width: 62, textAlign: "center", background: "var(--paper)", flexShrink: 0 }}>+91</span>
                                        <input className="input" placeholder="Mobile number" inputMode="numeric" maxLength={10} autoComplete="tel-national"
                                            value={form.phone}
                                            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))} />
                                    </div>
                                    <span className="hint" style={{ marginTop: -2 }}>
                                        Used to find or change your booking later. No account, no password.
                                    </span>

                                    {(b.partyTypes || []).length > 1 && (
                                        <select className="select" value={form.partyType}
                                            onChange={(e) => setForm((f) => ({ ...f, partyType: e.target.value }))}>
                                            {(b.partyTypes || []).map((p) => (
                                                <option key={p.key} value={p.key}>{p.label}</option>
                                            ))}
                                        </select>
                                    )}

                                    {(rules.requireOrganisation || (b.partyTypes || []).find((p) => p.key === form.partyType)?.isGroup) && (
                                        <input className="input"
                                            placeholder={`Organisation / site${rules.requireOrganisation ? "" : " (optional)"}`}
                                            value={form.organisation}
                                            onChange={(e) => setForm((f) => ({ ...f, organisation: e.target.value }))} />
                                    )}

                                    {rules.requireLocation && (
                                        <input className="input" placeholder="Where should it go?"
                                            value={form.location}
                                            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
                                    )}

                                    <textarea className="textarea" rows={2} placeholder={rules.requireNote ? "A note for the kitchen" : "Anything else? (optional)"}
                                        value={form.note}
                                        onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
                                </div>
                            </div>

                            <button className="btn btn-primary btn-lg" disabled={!ready || busy} onClick={submit}>
                                {busy ? "Sending…"
                                    : meal.cutoffPassed
                                        ? `Request ${total || ""} meal${total === 1 ? "" : "s"}${anyPriced && amount ? ` · ${inr(amount)}` : ""}`.replace("  ", " ")
                                        : `Book ${total || ""} meal${total === 1 ? "" : "s"}${anyPriced && amount ? ` · ${inr(amount)}` : ""}`.replace("  ", " ")}
                            </button>
                            {!ready && total > 0 && !phoneOk && <p className="hint center" style={{ marginTop: 8 }}>Enter a 10-digit mobile number to continue.</p>}
                        </>
                    )}
                </>
            )}

            <div className="center" style={{ marginTop: 18 }}>
                <Link href={`/b/${slug}/status`} className="link">Check or cancel an existing booking</Link>
            </div>
            <p className="powered">Powered by <strong>Chefo</strong> Booking</p>

            <style>{`
              .step-head { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
              .step-n { width: 22px; height: 22px; border-radius: 999px; background: var(--basil); color: #fff; font-size: 12px; font-weight: 700; display: grid; place-items: center; flex-shrink: 0; }
              .chip-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
              .chip { border: 1.5px solid var(--border); background: var(--card); border-radius: 999px; padding: 8px 14px; font: inherit; font-size: 13.5px; font-weight: 600; color: var(--slate); cursor: pointer; }
              .chip.on { border-color: var(--basil); background: var(--basil-soft); color: var(--basil-dark); }
              .chip-date { width: auto; flex: 1 1 150px; padding: 8px 10px; font-size: 13.5px; }
              .meal-peek { display: block; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
              .price-tag { font-size: 12px; font-weight: 600; color: var(--basil-dark); background: var(--basil-soft); border-radius: 999px; padding: 2px 8px; }
              .dishes { margin: 4px 0 0; padding-left: 16px; font-size: 13px; color: var(--slate); line-height: 1.5; }
              .btn-lg { padding: 15px 18px; font-size: 16px; }
            `}</style>
        </div>
    );
}

function Header({ b }) {
    const contact = [b.contactPhone, b.contactEmail].filter(Boolean).join(" · ");
    return (
        <div className="head">
            <span className="head-mark">
                {b.logoUrl ? <img src={b.logoUrl} alt="" /> : (b.name || "B").charAt(0).toUpperCase()}
            </span>
            <div style={{ minWidth: 0 }}>
                <div className="head-name">{b.name}</div>
                <div className="head-sub">
                    {[b.addressLine, b.landmark, b.city].filter(Boolean).join(", ") || "Meal booking"}
                    {contact ? ` · ${contact}` : ""}
                </div>
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

function Confirmation({ result, business, slug, onAgain }) {
    const pending = result.outcome === "pending_approval";
    const bk = result.booking;
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
                        ? `${business.name} has to accept this before it's confirmed, because booking had already closed for this meal. Check back with your mobile number to see their answer.`
                        : `${business.name} has your booking. Nothing else to do — just turn up.`}
                </p>

                <div className="ref">{bk.reference}</div>
                <p className="xsmall faint" style={{ marginTop: 6 }}>Your reference — keep it, or look it up with your mobile number.</p>

                <div className="stack-sm" style={{ marginTop: 18, textAlign: "left" }}>
                    <div className="row-between small">
                        <span className="muted">Meal</span>
                        <strong>{bk.mealTypeName}</strong>
                    </div>
                    <div className="row-between small">
                        <span className="muted">Date</span>
                        <strong>{formatDate(bk.date, { year: true })}</strong>
                    </div>
                    {bk.lines.map((l) => (
                        <div key={l.variantId} className="row-between small">
                            <span className="muted">{l.variantName}</span>
                            <strong>{l.quantity}</strong>
                        </div>
                    ))}
                    <div className="row-between" style={{
                        paddingTop: 9, borderTop: "1px solid var(--border)", fontWeight: 700,
                    }}>
                        <span>{bk.totalQuantity} meal{bk.totalQuantity === 1 ? "" : "s"}</span>
                        <span>{bk.totalAmount > 0 ? inr(bk.totalAmount) : ""}</span>
                    </div>
                </div>
            </div>

            <Link href={`/b/${slug}/status`} className="btn">View my bookings</Link>
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onAgain}>
                Book something else
            </button>
            <p className="powered">Powered by <strong>Chefo</strong> Booking</p>
        </div>
    );
}
