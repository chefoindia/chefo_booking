"use client";
// The booking form — the only screen in this app that writes anything.
//
// Four steps, top to bottom, in the order a person actually decides: which day,
// which meal, how many, who you are. Nothing is hidden behind a tab or an
// accordion, because a form you have to explore is a form people abandon.
//
// The server decides everything that matters — whether a day is bookable,
// whether a meal's window has closed, what is on the menu, what each option
// costs, and which questions this canteen asks. This page renders those answers
// and works none of them out itself. The one thing it keeps on its own is the
// ledger: a note on this phone of what it booked, so a customer with no account
// can still find their pass afterwards.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { get, post } from "@/lib/api";
import { formatDate, formatTime, todayKey, shiftDate, cutoffInfo } from "@/lib/format";
import Calendar, { monthOf, monthStart, monthEnd } from "@/components/Calendar";
import CustomFields, { missingRequired, visibleFields } from "@/components/CustomFields";
import { CutoffBadge, CutoffNotice } from "@/components/Cutoff";
import { useBooking } from "@/components/BookingShell";
import { addToLedger, readMe, writeMe } from "@/lib/ledger";
import useNow from "@/lib/useNow";

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

// useSearchParams() reads the ?date= and ?meal= a tab handed over, and the App
// Router will not prerender a route that calls it outside a Suspense boundary.
export default function BookPage() {
    return (
        <Suspense fallback={<div className="sk" style={{ height: 260 }} />}>
            <BookForm />
        </Suspense>
    );
}

function BookForm() {
    const { slug } = useParams();
    const params = useSearchParams();
    const { biz, rules, today: bizToday, maxDate: bizMax, account } = useBooking();
    const now = useNow(30000);

    // Arriving from the Home or Menu tab carries the day and meal already
    // chosen there, so a customer never picks the same thing twice.
    const [date, setDate] = useState(() => params.get("date") || todayKey());
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [month, setMonth] = useState(() => monthOf(params.get("date") || todayKey()));
    const [calOpen, setCalOpen] = useState(false);
    const [dayState, setDayState] = useState({});

    const [mealTypeId, setMealTypeId] = useState(() => params.get("meal") || "");
    const [qty, setQty] = useState({});
    const [form, setForm] = useState({
        name: "", phone: "", organisation: "", partyType: "individual", location: "", note: "",
    });
    const [answers, setAnswers] = useState({});
    const [touched, setTouched] = useState({});
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [savedHere, setSavedHere] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await get(`/api/public/business/${slug}?date=${date}`);
            setData(res);
            // A meal chosen on another day may not exist on this one, and one
            // that is not served must not stay picked silently.
            setMealTypeId((prev) => {
                const still = res.mealTypes.find((m) => String(m.id) === String(prev));
                return still && still.servedToday ? prev : "";
            });
        } catch (e) {
            setError(e.message || "Could not load this canteen.");
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [slug, date]);

    useEffect(() => { load(); }, [load]);

    // Remembering the last customer on THIS device is a convenience only — it
    // never authenticates anything. A signed-in account fills the same two
    // boxes, from a number that has actually been verified.
    useEffect(() => {
        setForm((f) => ({ ...f, ...readMe() }));
    }, []);
    const party = account?.party;
    useEffect(() => {
        if (!party) return;
        setForm((f) => ({
            ...f,
            name: f.name || party.name || "",
            phone: f.phone || String(party.phone || "").replace(/\D/g, "").slice(-10),
        }));
    }, [party]);

    useEffect(() => { setMonth(monthOf(date)); }, [date]);

    const today = data?.today || bizToday;
    const maxDate = data?.maxDate || bizMax;

    useEffect(() => {
        if (!today || !maxDate) return;
        const from = monthStart(month) < today ? today : monthStart(month);
        const to = monthEnd(month) > maxDate ? maxDate : monthEnd(month);
        if (from > to) return;
        let alive = true;
        (async () => {
            try {
                const res = await get(`/api/public/business/${slug}/calendar?from=${from}&to=${to}`);
                if (!alive) return;
                setDayState((prev) => {
                    const next = { ...prev };
                    for (const d of res.days || []) next[d.date] = { bookable: d.bookable, meals: d.meals || [] };
                    return next;
                });
            } catch { /* the grid stays plain — picking a day still tells the truth */ }
        })();
        return () => { alive = false; };
    }, [slug, month, today, maxDate]);

    const meal = useMemo(
        () => data?.mealTypes.find((m) => String(m.id) === String(mealTypeId)) || null,
        [data, mealTypeId]
    );

    const total = Object.values(qty).reduce((n, v) => n + (Number(v) || 0), 0);
    const amount = meal ? meal.variants.reduce((n, v) => n + (Number(qty[v.id]) || 0) * (v.price || 0), 0) : 0;
    const anyPriced = meal ? meal.variants.some((v) => v.price > 0) : false;
    const b = data?.business || biz;
    const r = data?.business?.rules || rules || {};

    const fields = useMemo(() => b?.bookingFields || [], [b]);
    const shownFields = useMemo(
        () => visibleFields(fields, meal?.key, form.partyType),
        [fields, meal, form.partyType]
    );
    const missing = useMemo(
        () => missingRequired(fields, meal?.key, form.partyType, answers),
        [fields, meal, form.partyType, answers]
    );
    // Red only where they have already been — nobody is told off for a field
    // they have not reached yet.
    const fieldErrors = Object.fromEntries(
        missing.filter((k) => touched[k]).map((k) => [k, "Needed"])
    );

    const phoneOk = form.phone.replace(/\D/g, "").length >= 10;
    const ready = meal && meal.servedToday && total > 0 && form.name.trim() && phoneOk
        && (!r.requireOrganisation || form.organisation.trim())
        && (!r.requireLocation || form.location.trim())
        && (!r.requireNote || form.note.trim())
        && missing.length === 0;

    // Recomputed against the ticking clock, not against whatever the server said
    // when the page loaded: somebody filling the form slowly can cross the
    // deadline while typing, and the button has to change under them.
    const info = meal ? cutoffInfo(meal, now, today) : null;
    const late = info?.state === "closed";

    const submit = async () => {
        setBusy(true);
        setError("");
        try {
            // Only answers to questions actually on screen are sent — something
            // typed before switching meal is not this booking's answer.
            const given = {};
            for (const f of shownFields) {
                const v = String(answers[f.key] ?? "").trim();
                if (v) given[f.key] = v;
            }

            const res = await post(`/api/public/business/${slug}/bookings`, {
                mealTypeId, date, quantities: qty,
                party: {
                    name: form.name.trim(), phone: form.phone.trim(),
                    organisation: form.organisation.trim(),
                    partyType: form.partyType,
                    location: form.location.trim(),
                },
                answers: given,
                customerNote: form.note.trim(),
                location: form.location.trim(),
            });
            writeMe({
                name: form.name, phone: form.phone,
                organisation: form.organisation, partyType: form.partyType,
            });
            // The ticket is how this phone gets back to the pass later, so it
            // goes in the ledger the moment it exists.
            const kept = addToLedger(slug, res.booking);
            setSavedHere(kept.some((x) => x.ticket === res.booking?.ticket));
            setResult(res);
            window.scrollTo({ top: 0 });
        } catch (e) {
            setError(e.message || "Could not submit your booking.");
        } finally {
            setBusy(false);
        }
    };

    if (loading && !data) {
        return (
            <>
                <div className="sk" style={{ height: 80, marginBottom: 12 }} />
                <div className="sk" style={{ height: 260 }} />
            </>
        );
    }

    if (!data) {
        return (
            <div className="card">
                <h2 style={{ fontSize: 16, marginBottom: 6 }}>Couldn&apos;t load this canteen</h2>
                <p className="small muted">{error || "Check the link you were given."}</p>
            </div>
        );
    }

    if (result) {
        return (
            <Confirmation result={result} business={b} slug={slug} savedHere={savedHere}
                signedIn={account?.signedIn}
                onAgain={() => { setResult(null); setQty({}); setAnswers({}); setTouched({}); }} />
        );
    }

    if (!b.acceptingBookings) {
        return (
            <div className="card">
                <div className="notice notice-bad">
                    {b.closedMessage || "This canteen isn't accepting bookings right now."}
                </div>
                <Link href={`/b/${slug}/bookings`} className="btn" style={{ marginTop: 12 }}>
                    My bookings
                </Link>
            </div>
        );
    }

    const quick = [
        { d: data.today, l: "Today" },
        { d: shiftDate(data.today, 1), l: "Tomorrow" },
        { d: shiftDate(data.today, 2), l: formatDate(shiftDate(data.today, 2)).split(",")[0] },
    ].filter((x) => x.d <= data.maxDate);

    return (
        <>
            {error && <div className="notice notice-bad" style={{ marginBottom: 12 }}>{error}</div>}

            {/* ---- 1. the day ---- */}
            <div className="card">
                <div className="step-head"><span className="step-n">1</span><label className="label" style={{ margin: 0 }}>Which day?</label></div>
                {/* Nearly every booking is for today or tomorrow, so those stay
                    one tap. The calendar is for everything further out. */}
                <div className="chip-row">
                    {quick.map((x) => (
                        <button key={x.d} type="button" className={`chip ${date === x.d ? "on" : ""}`} onClick={() => setDate(x.d)}>{x.l}</button>
                    ))}
                    <button type="button" className={`chip ${calOpen ? "on" : ""}`}
                        aria-expanded={calOpen} onClick={() => setCalOpen((o) => !o)}>
                        {calOpen ? "Hide calendar" : "Another day"}
                    </button>
                </div>

                {calOpen && (
                    <Calendar
                        month={month} onMonthChange={setMonth}
                        value={date} onChange={(d) => setDate(d)}
                        today={data.today} maxDate={data.maxDate} dayState={dayState}
                    />
                )}

                <span className="hint">
                    {formatDate(date, { year: true })} · bookings open up to {r.maxDaysAhead ?? 14} day{(r.maxDaysAhead ?? 14) === 1 ? "" : "s"} ahead
                </span>
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
                            const mi = cutoffInfo(m, now, today);
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
                                        {/* The deadline, on every option, always —
                                            not only on the one already chosen. */}
                                        <span className={`cut-line cut-${mi.tone}`}>
                                            <span className="cut-dot" aria-hidden="true" />
                                            <span>
                                                {mi.state === "not-served" ? `Not served on ${formatDate(date).split(",")[0]}`
                                                    : mi.state === "closed" ? `Closed — shut at ${mi.clock}`
                                                        : mi.state === "no-cutoff" ? "Open until the meal starts"
                                                            : `${mi.badge} · at ${mi.clock}`}
                                            </span>
                                        </span>
                                        {dishes.length > 0 && !on && (
                                            <span className="xsmall muted meal-peek">{dishes.slice(0, 3).join(" · ")}{dishes.length > 3 ? " …" : ""}</span>
                                        )}
                                    </span>
                                    <CutoffBadge meal={m} today={today} />
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {meal && (
                <>
                    <div style={{ marginBottom: 12 }}>
                        <CutoffNotice meal={meal} today={today} businessName={b.name} />
                    </div>

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
                                    max={r.maxQuantityPerBooking || 500}
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
                                {account?.signedIn
                                    ? "From your account — this booking is kept with it automatically."
                                    : "Used to find or change your booking later. No account, no password."}
                            </span>

                            {(b.partyTypes || []).length > 1 && (
                                <select className="select" value={form.partyType}
                                    onChange={(e) => setForm((f) => ({ ...f, partyType: e.target.value }))}>
                                    {(b.partyTypes || []).map((p) => (
                                        <option key={p.key} value={p.key}>{p.label}</option>
                                    ))}
                                </select>
                            )}

                            {(r.requireOrganisation || (b.partyTypes || []).find((p) => p.key === form.partyType)?.isGroup) && (
                                <input className="input"
                                    placeholder={`Organisation / site${r.requireOrganisation ? "" : " (optional)"}`}
                                    value={form.organisation}
                                    onChange={(e) => setForm((f) => ({ ...f, organisation: e.target.value }))} />
                            )}

                            {r.requireLocation && (
                                <input className="input" placeholder="Where should it go?"
                                    value={form.location}
                                    onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
                            )}

                            {/* Whatever else this canteen asks for. Their
                                questions, their order, their wording. */}
                            <CustomFields
                                fields={fields}
                                mealTypeKey={meal.key}
                                partyTypeKey={form.partyType}
                                values={answers}
                                errors={fieldErrors}
                                onChange={(key, value) => {
                                    setAnswers((a) => ({ ...a, [key]: value }));
                                    setTouched((t) => (t[key] ? t : { ...t, [key]: true }));
                                }}
                            />

                            <textarea className="textarea" rows={2} placeholder={r.requireNote ? "A note for the kitchen" : "Anything else? (optional)"}
                                value={form.note}
                                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
                        </div>
                    </div>

                    <button className="btn btn-primary btn-lg" disabled={!ready || busy} onClick={submit}>
                        {busy ? "Sending…"
                            : late
                                ? `Ask for ${total || ""} meal${total === 1 ? "" : "s"}`.replace("  ", " ")
                                : `Book ${total || ""} meal${total === 1 ? "" : "s"}${anyPriced && amount ? ` · ${inr(amount)}` : ""}`.replace("  ", " ")}
                    </button>
                    {late && (
                        <p className="hint center" style={{ marginTop: 8 }}>
                            Booking has closed, so this goes to {b.name} as a request — not a confirmed meal.
                        </p>
                    )}
                    {!ready && total > 0 && !phoneOk && <p className="hint center" style={{ marginTop: 8 }}>Enter a 10-digit mobile number to continue.</p>}
                    {/* Say what is still missing, rather than leaving a dead
                        button and no explanation. */}
                    {!ready && total > 0 && phoneOk && missing.length > 0 && (
                        <p className="hint center" style={{ marginTop: 8 }}>
                            Still needed: {shownFields.filter((f) => missing.includes(f.key)).map((f) => f.label).join(", ")}.
                        </p>
                    )}
                </>
            )}

            <style>{`
              .step-head { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
              .step-n { width: 22px; height: 22px; border-radius: 999px; background: var(--basil); color: #fff; font-size: 12px; font-weight: 700; display: grid; place-items: center; flex-shrink: 0; }
              .meal-peek { display: block; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
            `}</style>
        </>
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

function Confirmation({ result, business, slug, savedHere, signedIn, onAgain }) {
    const pending = result.outcome === "pending_approval";
    const bk = result.booking;
    return (
        <>
            <div className="card center" style={{ paddingTop: 26, paddingBottom: 22 }}>
                <div className={`done-mark ${pending ? "done-wait" : "done-ok"}`}>
                    {pending ? "!" : "✓"}
                </div>
                <h1 style={{ fontSize: 19 }}>
                    {pending ? "Sent for approval" : "Booking confirmed"}
                </h1>
                <p className="small muted" style={{ marginTop: 7 }}>
                    {pending
                        ? `Booking had already closed for this meal, so ${business.name} has to accept it. Their answer shows up under Bookings.`
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

            <Link href={`/b/${slug}/bookings`} className="btn btn-primary">Show my pass</Link>
            {/* Said plainly, because "saved" usually means "saved to an account"
                and without one it is this phone, and only this phone. */}
            {savedHere && !signedIn && (
                <p className="xsmall faint center" style={{ marginTop: 8 }}>
                    Saved on this phone. To keep it on any phone, confirm your number under{" "}
                    <Link href={`/b/${slug}/profile`} className="link">Profile</Link>.
                </p>
            )}
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onAgain}>
                Book something else
            </button>
        </>
    );
}
