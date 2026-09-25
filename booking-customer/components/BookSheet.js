"use client";
// components/BookSheet.js — the booking form, as a bottom sheet.
//
// It used to be its own page. Tapping a meal navigated away from whatever you
// were looking at, and coming back meant a second navigation and a second load
// — which is exactly what made a four-field form feel like a website. Now it
// slides up over the tab you were on, and closing it puts you back where you
// were with nothing reloaded.
//
// Four steps, top to bottom, in the order a person actually decides: which day,
// which meal, how many, who you are. The submit button lives in the sheet's
// footer so it is reachable with a thumb without scrolling to the bottom.
//
// The server decides everything that matters — whether a day is bookable,
// whether a meal's window has closed, what is on the menu, what each option
// costs, and which questions this canteen asks. This renders those answers and
// works none of them out itself. The one thing it keeps on its own is the
// ledger: a note on this phone of what it booked, so a customer with no account
// can still find their pass afterwards.
import { useCallback, useEffect, useMemo, useState } from "react";
import { get, post } from "@/lib/api";
import { formatDate, todayKey, shiftDate, cutoffInfo } from "@/lib/format";
import Calendar, { monthOf, monthStart, monthEnd } from "@/components/Calendar";
import CustomFields, { missingRequired, visibleFields } from "@/components/CustomFields";
import { CutoffBadge, CutoffNotice } from "@/components/Cutoff";
import BookingQr from "@/components/BookingQr";
import Sheet from "@/components/Sheet";
import { addToLedger, readMe, writeMe } from "@/lib/ledger";
import useNow from "@/lib/useNow";

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export default function BookSheet({
    open, slug, biz, rules, today: bizToday, maxDate: bizMax, account,
    initialDate, initialMeal, onClose, onBooked,
}) {
    const now = useNow(30000);

    const [date, setDate] = useState(initialDate || todayKey());
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [month, setMonth] = useState(() => monthOf(initialDate || todayKey()));
    const [calOpen, setCalOpen] = useState(false);
    const [dayState, setDayState] = useState({});

    const [mealTypeId, setMealTypeId] = useState(initialMeal || "");
    // WHICH OUTLET. The list comes from the server (whatever this canteen
    // created — nothing is hardcoded) and so does whether one is required.
    // Remembered on this phone as a convenience, like the name and number.
    const [outletId, setOutletId] = useState("");
    const [qty, setQty] = useState({});
    const [form, setForm] = useState({
        name: "", phone: "", organisation: "", partyType: "individual", location: "", note: "",
    });
    const [answers, setAnswers] = useState({});
    const [touched, setTouched] = useState({});
    const [noteOpen, setNoteOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [savedHere, setSavedHere] = useState(false);

    // Opening the sheet is a fresh start: whatever day and meal the tab handed
    // over wins, and nothing is left over from the last time it was open.
    useEffect(() => {
        if (!open) return;
        setDate(initialDate || todayKey());
        setMonth(monthOf(initialDate || todayKey()));
        setMealTypeId(initialMeal || "");
        setQty({});
        setAnswers({});
        setTouched({});
        setNoteOpen(false);
        setResult(null);
        setError("");
        setCalOpen(false);
    }, [open, initialDate, initialMeal]);

    const load = useCallback(async () => {
        if (!open || !date) return;
        setLoading(true);
        setError("");
        try {
            const res = await get(`/api/public/business/${slug}?date=${date}`);
            setData(res);
            // A remembered or preselected outlet only stands if it is still
            // one the canteen offers — a deactivated one must not stay picked.
            setOutletId((prev) => {
                const list = res.outlets || [];
                const still = prev && list.some((o) => String(o.id) === String(prev));
                if (still) return prev;
                const remembered = String(readMe().outletId || "");
                if (remembered && list.some((o) => String(o.id) === remembered)) return remembered;
                return list.length === 1 ? String(list[0].id) : "";
            });
            // A meal chosen on another day may not exist on this one, and one
            // that is closed or not served must not stay picked silently.
            setMealTypeId((prev) => {
                const still = res.mealTypes.find((m) => String(m.id) === String(prev));
                return still && still.servedToday && !still.cutoffPassed ? prev : "";
            });
        } catch (e) {
            setError(e.message || "Could not load this canteen.");
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [slug, date, open]);

    useEffect(() => { load(); }, [load]);

    // Remembering the last customer on THIS device is a convenience only — it
    // never authenticates anything. A signed-in account fills the same two
    // boxes, from a number that has actually been verified.
    useEffect(() => {
        if (!open) return;
        setForm((f) => ({ ...f, ...readMe() }));
    }, [open]);

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
        if (!open || !today || !maxDate) return;
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
    }, [slug, month, today, maxDate, open]);

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

    const outlets = data?.outlets || [];
    const outletRequired = Boolean(data?.outletRequired);
    const outlet = outlets.find((o) => String(o.id) === String(outletId)) || null;

    const phoneOk = form.phone.replace(/\D/g, "").length >= 10;
    const ready = meal && meal.servedToday && !meal.cutoffPassed && total > 0
        && (!outletRequired || outlet)
        && form.name.trim() && phoneOk
        && (!r.requireOrganisation || form.organisation.trim())
        && (!r.requireLocation || form.location.trim())
        && (!r.requireNote || form.note.trim())
        && missing.length === 0;

    // Recomputed against the ticking clock, not against whatever the server said
    // when the sheet opened: somebody filling the form slowly can cross the
    // deadline while typing, and the form has to close under them rather than
    // let them submit something the server will refuse.
    const info = meal ? cutoffInfo(meal, now, today) : null;

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
                // Sent only when chosen; the server insists on one whenever
                // this canteen has outlets, so nothing slips through without.
                ...(outletId ? { outletId } : {}),
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
                outletId: outletId || "",
            });
            // The ticket is how this phone gets back to the pass later, so it
            // goes in the ledger the moment it exists.
            const kept = addToLedger(slug, res.booking);
            setSavedHere(kept.some((x) => x.ticket === res.booking?.ticket));
            setResult(res);
            // The tabs behind this sheet are showing a list that is now out of
            // date. Telling them immediately is the difference between "my
            // booking is there" and "I had to refresh".
            onBooked?.(res.booking);
        } catch (e) {
            setError(e.message || "Could not submit your booking.");
        } finally {
            setBusy(false);
        }
    };

    if (!open) return null;

    /* ---------------------------------------------------- confirmation */
    if (result) {
        const bk = result.booking;
        return (
            <Sheet open onClose={onClose} title="Booking confirmed" subtitle={b?.name}>
                <div className="center">
                    <div className="done-mark done-ok">✓</div>
                    <p className="small muted">
                        {b.name} has your booking. Nothing else to do — just turn up.
                    </p>
                </div>

                <div style={{ marginTop: 14 }}>
                    <BookingQr ticket={bk.ticket} reference={bk.reference}
                        booking={bk} businessName={b.name} />
                </div>

                <div className="stack-sm" style={{ marginTop: 14 }}>
                    {/* The outlet, first: it is where they have to go. */}
                    {bk.outletName && (
                        <div className="row-between small">
                            <span className="muted">Outlet</span><strong>{bk.outletName}</strong>
                        </div>
                    )}
                    <div className="row-between small">
                        <span className="muted">Meal</span><strong>{bk.mealTypeName}</strong>
                    </div>
                    <div className="row-between small">
                        <span className="muted">Date</span><strong>{formatDate(bk.date, { year: true })}</strong>
                    </div>
                    {bk.lines.map((l) => (
                        <div key={l.variantId} className="row-between small">
                            <span className="muted">{l.variantName}</span><strong>{l.quantity}</strong>
                        </div>
                    ))}
                    <div className="row-between" style={{ paddingTop: 9, borderTop: "1px solid var(--border)", fontWeight: 700 }}>
                        <span>{bk.totalQuantity} meal{bk.totalQuantity === 1 ? "" : "s"}</span>
                        <span>{bk.totalAmount > 0 ? inr(bk.totalAmount) : ""}</span>
                    </div>
                </div>

                {/* Said plainly, because "saved" usually means "saved to an
                    account" and without one it is this phone, and only this. */}
                {savedHere && !account?.signedIn && (
                    <p className="xsmall faint center" style={{ marginTop: 12 }}>
                        Saved on this phone. To keep it on any phone, confirm your number
                        under Profile.
                    </p>
                )}

                <div className="btn-row" style={{ marginTop: 14 }}>
                    <button className="btn btn-primary" onClick={onClose}>Done</button>
                    <button className="btn" onClick={() => { setResult(null); setQty({}); setAnswers({}); setTouched({}); }}>
                        Book something else
                    </button>
                </div>
            </Sheet>
        );
    }

    /* ---------------------------------------------------- the form */
    const quick = data ? [
        { d: data.today, l: "Today" },
        { d: shiftDate(data.today, 1), l: "Tomorrow" },
        { d: shiftDate(data.today, 2), l: formatDate(shiftDate(data.today, 2)).split(",")[0] },
    ].filter((x) => x.d <= data.maxDate) : [];

    const footer = meal ? (
        <>
            <button className="btn btn-primary btn-lg" disabled={!ready || busy} onClick={submit}>
                {busy ? "Booking…"
                    : `Book ${total || ""} meal${total === 1 ? "" : "s"}${anyPriced && amount ? ` · ${inr(amount)}` : ""}`.replace("  ", " ")}
            </button>
            {/* One line, and only when something is actually stopping them. */}
            {!ready && total > 0 && outletRequired && !outlet ? (
                <p className="hint center" style={{ marginTop: 0 }}>Choose which outlet you&apos;ll collect from.</p>
            ) : !ready && total > 0 && !phoneOk ? (
                <p className="hint center" style={{ marginTop: 0 }}>Enter a 10-digit mobile number.</p>
            ) : !ready && total > 0 && phoneOk && missing.length > 0 ? (
                <p className="hint center" style={{ marginTop: 0 }}>
                    Still needed: {shownFields.filter((f) => missing.includes(f.key)).map((f) => f.label).join(", ")}.
                </p>
            ) : null}
        </>
    ) : null;

    return (
        <Sheet open onClose={onClose}
            title="Book a meal"
            subtitle={b?.name}
            footer={footer}>

            {error && <div className="notice notice-bad" style={{ marginBottom: 12 }}>{error}</div>}

            {!b?.acceptingBookings ? (
                <div className="notice notice-bad">
                    {b?.closedMessage || "This canteen isn't accepting bookings right now."}
                </div>
            ) : loading && !data ? (
                <>
                    <div className="sk" style={{ height: 70, marginBottom: 12 }} />
                    <div className="sk" style={{ height: 200 }} />
                </>
            ) : !data ? (
                <p className="small muted">Couldn&apos;t load this canteen. Check your connection and try again.</p>
            ) : (
                <>
                    {/* ---- which outlet ----
                        First, because it decides where the food is and where
                        the pass will be accepted. A plain dropdown: the list is
                        the canteen's own, however long it is. */}
                    {outlets.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                            <label className="label" htmlFor="book-outlet">Outlet</label>
                            <select id="book-outlet" className="select" value={outletId}
                                onChange={(e) => setOutletId(e.target.value)}>
                                <option value="">Choose an outlet…</option>
                                {outlets.map((o) => (
                                    <option key={o.id} value={o.id}>
                                        {o.name}{o.description ? ` — ${o.description}` : ""}
                                    </option>
                                ))}
                            </select>
                            {outlet?.addressLine && <span className="hint">{outlet.addressLine}</span>}
                            {!outlet && (
                                <span className="hint">Your pass will only be accepted at the outlet you choose.</span>
                            )}
                        </div>
                    )}

                    {/* ---- which day, and which meal ---- */}
                    <div className="chip-row">
                        {quick.map((x) => (
                            <button key={x.d} type="button" className={`chip ${date === x.d ? "on" : ""}`}
                                onClick={() => setDate(x.d)}>{x.l}</button>
                        ))}
                        <button type="button" className={`chip ${calOpen ? "on" : ""}`}
                            aria-expanded={calOpen} onClick={() => setCalOpen((o) => !o)}>
                            {calOpen ? "Close" : "Pick a date"}
                        </button>
                    </div>

                    {calOpen && (
                        <Calendar
                            month={month} onMonthChange={setMonth}
                            value={date} onChange={(d) => { setDate(d); setCalOpen(false); }}
                            today={data.today} maxDate={data.maxDate} dayState={dayState}
                        />
                    )}

                    {!quick.some((x) => x.d === date) && (
                        <p className="hint">Booking for {formatDate(date, { year: true })}</p>
                    )}

                    {!data.mealTypes.length ? (
                        <p className="small muted" style={{ marginTop: 12 }}>No meals are open on this day.</p>
                    ) : (
                        <div className="pick-list">
                            {data.mealTypes.map((m) => {
                                const on = String(m.id) === String(mealTypeId);
                                const mi = cutoffInfo(m, now, today);
                                // A closed meal is not selectable. Letting
                                // somebody pick it and fill in a form the server
                                // will refuse is worse than a greyed-out row
                                // that says why.
                                return (
                                    <button key={m.id} type="button"
                                        disabled={!m.servedToday || m.cutoffPassed}
                                        className={`pick ${on ? "on" : ""}`}
                                        onClick={() => { setMealTypeId(m.id); setQty({}); }}>
                                        <span className="pick-main">
                                            <span className="pick-name">{m.name}</span>
                                            <span className={`pick-when cut-${mi.tone}`}>
                                                {mi.state === "not-served" ? "Not served"
                                                    : mi.state === "closed" ? `Closed ${mi.clock}`
                                                        : mi.state === "no-cutoff" ? "Open"
                                                            : `${mi.badge}, ${mi.clock}`}
                                            </span>
                                        </span>
                                        <span className="pick-tick" aria-hidden="true">✓</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {meal && (
                        <>
                            {info?.state === "closing" && (
                                <div style={{ marginTop: 12 }}>
                                    <CutoffNotice meal={meal} today={today} businessName={b.name} />
                                </div>
                            )}

                            {/* ---- how many ---- */}
                            <div style={{ marginTop: 14 }}>
                                {meal.menuNote && <p className="small muted" style={{ marginBottom: 10 }}>{meal.menuNote}</p>}
                                {meal.variants.map((v) => (
                                    <div key={v.id} className="qty-row">
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                                                <span className="qty-name">{v.name}</span>
                                                {v.price > 0 && <span className="price-tag">{inr(v.price)}</span>}
                                            </div>
                                            {/* The day's dishes read as one line
                                                of prose, not a bulleted list. */}
                                            {(v.dishes?.length > 0 || v.description) && (
                                                <p className="dish-line">
                                                    {v.dishes?.length > 0 ? v.dishes.join(", ") : v.description}
                                                </p>
                                            )}
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
                                    {anyPriced ? <span>{inr(amount)}</span>
                                        : <span className="small muted" style={{ fontWeight: 500 }}>Pay at the counter</span>}
                                </div>
                            </div>

                            {/* ---- who ---- */}
                            <div className="stack-sm" style={{ marginTop: 14 }}>
                                <input className="input" placeholder="Your name" value={form.name} autoComplete="name"
                                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                                <div className="row" style={{ gap: 8 }}>
                                    <span className="input" style={{ width: 62, textAlign: "center", background: "var(--paper)", flexShrink: 0 }}>+91</span>
                                    <input className="input" placeholder="Mobile number" inputMode="numeric" maxLength={10}
                                        autoComplete="tel-national" value={form.phone}
                                        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))} />
                                </div>

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

                                {/* The note is the one optional box, and an empty
                                    textarea sitting open makes the form look
                                    longer than it is. */}
                                {r.requireNote || noteOpen ? (
                                    <textarea className="textarea" rows={2} autoFocus={noteOpen}
                                        placeholder={r.requireNote ? "A note for the kitchen" : "Note for the kitchen"}
                                        value={form.note}
                                        onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
                                ) : (
                                    <button type="button" className="link" style={{ alignSelf: "flex-start" }}
                                        onClick={() => setNoteOpen(true)}>
                                        + Add a note for the kitchen
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </>
            )}
        </Sheet>
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
