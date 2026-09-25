"use client";
// components/BookSheet.js — the booking form, as a bottom sheet.
//
// Four numbered steps, top to bottom, in the order a person actually decides:
// which day, which meal, how many, who you are. The footer keeps a running
// summary and the one button, reachable with a thumb without scrolling.
//
// The server decides everything that matters — whether a day is bookable,
// whether a meal's window has closed, what is on the menu, what each option
// costs, which outlets exist and which questions this canteen asks. This
// renders those answers and works none of them out itself. The one thing it
// keeps on its own is the ledger: a note on this phone of what it booked, so a
// customer with no account can still find their pass afterwards.
import { useCallback, useEffect, useMemo, useState } from "react";
import { get, post } from "@/lib/api";
import { formatDate, formatTime, todayKey, shiftDate, cutoffInfo, dayWord } from "@/lib/format";
import Calendar, { monthOf, monthStart, monthEnd } from "@/components/Calendar";
import CustomFields, { missingRequired, visibleFields } from "@/components/CustomFields";
import { CutoffNotice } from "@/components/Cutoff";
import BookingQr from "@/components/BookingQr";
import Sheet from "@/components/Sheet";
import DayStrip from "@/components/DayStrip";
import { Icon, PATHS } from "@/components/Icons";
import { addToLedger, readMe, writeMe } from "@/lib/ledger";
import { CLOSED_STATUSES } from "@/lib/mybookings";
import useNow from "@/lib/useNow";

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export default function BookSheet({
    open, slug, biz, rules, today: bizToday, maxDate: bizMax, account, mine,
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

    // The calendar's per-day state (which days the kitchen runs). Fetched for
    // the visible month, and for the first week so the day strip can grey out
    // a Sunday the kitchen is shut before anyone taps it.
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
    const shownFields = useMemo(() => visibleFields(fields, meal?.key, form.partyType), [fields, meal, form.partyType]);
    const missing = useMemo(() => missingRequired(fields, meal?.key, form.partyType, answers), [fields, meal, form.partyType, answers]);
    const fieldErrors = Object.fromEntries(missing.filter((k) => touched[k]).map((k) => [k, "Needed"]));

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
    // deadline while typing, and the form has to close under them.
    const info = meal ? cutoffInfo(meal, now, today) : null;

    // Days this phone already has a booking on, for the strip's dot.
    const marks = useMemo(() => new Set(
        (mine?.bookings || []).filter((x) => !CLOSED_STATUSES.includes(x.status)).map((x) => x.date)
    ), [mine]);

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
            const kept = addToLedger(slug, res.booking);
            setSavedHere(kept.some((x) => x.ticket === res.booking?.ticket));
            setResult(res);
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
            <Sheet open onClose={onClose} title="You're booked" subtitle={b?.name}
                footer={
                    <div className="btn-row">
                        <button className="btn btn-primary btn-lg" onClick={onClose}>Done</button>
                        <button className="btn btn-lg" onClick={() => { setResult(null); setQty({}); setAnswers({}); setTouched({}); }}>
                            Book another
                        </button>
                    </div>
                }>
                <div className="center" style={{ paddingTop: 6 }}>
                    <div className="done-mark"><Icon d={PATHS.check} size={34} sw={2.8} /></div>
                    <h2 style={{ fontSize: 20 }}>{bk.mealTypeName} on {dayWord(bk.date, today)}</h2>
                    <p className="small muted" style={{ marginTop: 6 }}>
                        {b.name} has your booking. Show the pass below at the counter — nothing else to do.
                    </p>
                </div>

                <div style={{ marginTop: 16 }}>
                    <BookingQr ticket={bk.ticket} reference={bk.reference} booking={bk} businessName={b.name} />
                </div>

                <div className="card" style={{ marginTop: 14, marginBottom: 0 }}>
                    <div className="summary-rows">
                        {bk.outletName && <div className="row-between"><span className="muted">Collect at</span><strong>{bk.outletName}</strong></div>}
                        <div className="row-between"><span className="muted">Meal</span><strong>{bk.mealTypeName}</strong></div>
                        <div className="row-between"><span className="muted">Date</span><strong>{formatDate(bk.date, { year: true })}</strong></div>
                        {bk.lines.map((l) => (
                            <div key={l.variantId} className="row-between"><span className="muted">{l.variantName}</span><strong>{l.quantity}</strong></div>
                        ))}
                        <div className="summary-total">
                            <span>{bk.totalQuantity} meal{bk.totalQuantity === 1 ? "" : "s"}</span>
                            <span>{bk.totalAmount > 0 ? inr(bk.totalAmount) : "Pay at the counter"}</span>
                        </div>
                    </div>
                </div>

                {savedHere && !account?.signedIn && (
                    <p className="xsmall faint center" style={{ marginTop: 12 }}>
                        Saved on this phone. To keep it on any phone, confirm your number under Profile.
                    </p>
                )}
            </Sheet>
        );
    }

    /* ---------------------------------------------------- the form */
    const closedForDay = data && !data.mealTypes.some((m) => m.servedToday && !m.cutoffPassed);

    const footer = data && b?.acceptingBookings ? (
        <>
            {meal && total > 0 ? (
                <div className="foot-line">
                    <span>{meal.name} · {dayWord(date, today)}{outlet ? ` · ${outlet.name}` : ""}</span>
                    <b>{total} meal{total === 1 ? "" : "s"}{anyPriced && amount ? ` · ${inr(amount)}` : ""}</b>
                </div>
            ) : (
                <div className="foot-line"><span>{!meal ? "Choose a meal to continue" : "Add at least one meal"}</span></div>
            )}
            <button className="btn btn-primary btn-lg" disabled={!ready || busy} onClick={submit}>
                {busy ? "Booking…" : "Confirm booking"}
            </button>
            {!ready && total > 0 && outletRequired && !outlet ? (
                <p className="hint center" style={{ marginTop: -2 }}>Choose which outlet you&apos;ll collect from.</p>
            ) : !ready && total > 0 && !form.name.trim() ? (
                <p className="hint center" style={{ marginTop: -2 }}>Add your name so the counter knows who it&apos;s for.</p>
            ) : !ready && total > 0 && !phoneOk ? (
                <p className="hint center" style={{ marginTop: -2 }}>Enter a 10-digit mobile number.</p>
            ) : !ready && total > 0 && phoneOk && missing.length > 0 ? (
                <p className="hint center" style={{ marginTop: -2 }}>
                    Still needed: {shownFields.filter((f) => missing.includes(f.key)).map((f) => f.label).join(", ")}.
                </p>
            ) : null}
        </>
    ) : null;

    return (
        <Sheet open onClose={onClose} title="Book a meal" subtitle={b?.name} footer={footer}>
            {error && <div className="notice notice-bad" style={{ marginBottom: 12 }}>{error}</div>}

            {!b?.acceptingBookings ? (
                <div className="notice notice-bad">{b?.closedMessage || "This canteen isn't accepting bookings right now."}</div>
            ) : loading && !data ? (
                <>
                    <div className="sk" style={{ height: 70, marginBottom: 12 }} />
                    <div className="sk" style={{ height: 200 }} />
                </>
            ) : !data ? (
                <p className="small muted">Couldn&apos;t load this canteen. Check your connection and try again.</p>
            ) : (
                <>
                    {/* ---- 1. which day ---- */}
                    <div className="step">
                        <div className="step-h">
                            <span className="step-n">1</span>
                            <h3>Which day?</h3>
                            <span className="step-sub">{formatDate(date, { year: true })}</span>
                        </div>
                        <DayStrip today={data.today} maxDate={data.maxDate} value={date} dayState={dayState} marks={marks}
                            onChange={(d) => { setDate(d); setCalOpen(false); }}
                            onMore={() => setCalOpen((o) => !o)} moreOpen={calOpen} />
                        {calOpen && (
                            <Calendar
                                month={month} onMonthChange={setMonth}
                                value={date} onChange={(d) => { setDate(d); setCalOpen(false); }}
                                today={data.today} maxDate={data.maxDate} dayState={dayState} marks={marks}
                            />
                        )}
                    </div>

                    {/* ---- 2. which meal ---- */}
                    <div className="step">
                        <div className="step-h">
                            <span className="step-n">2</span>
                            <h3>Which meal?</h3>
                            {closedForDay && <span className="step-sub" style={{ color: "var(--brick)" }}>Nothing open</span>}
                        </div>
                        {!data.mealTypes.length ? (
                            <p className="small muted">No meals are set up for this day.</p>
                        ) : (
                            <div className="pick-list" style={{ marginTop: 0 }}>
                                {data.mealTypes.map((m) => {
                                    const on = String(m.id) === String(mealTypeId);
                                    const mi = cutoffInfo(m, now, today);
                                    const dishes = m.variants.flatMap((v) => v.dishes || []);
                                    return (
                                        <button key={m.id} type="button"
                                            disabled={!m.servedToday || m.cutoffPassed}
                                            className={`pick ${on ? "on" : ""}`}
                                            onClick={() => { setMealTypeId(m.id); setQty({}); }}>
                                            <span className="pick-main">
                                                <span className="pick-name">{m.name}</span>
                                                <span className={`pick-when cut-${mi.tone}`}>
                                                    {mi.state === "not-served" ? "Not served this day"
                                                        : mi.state === "closed" ? `Closed at ${mi.clock}`
                                                            : mi.state === "no-cutoff" ? "Open — book any time"
                                                                : `${mi.badge} · till ${mi.clock}`}
                                                </span>
                                                {m.startTime && m.endTime && (
                                                    <span className="xsmall faint">Served {formatTime(m.startTime)}–{formatTime(m.endTime)}{dishes.length ? ` · ${dishes.slice(0, 3).join(", ")}${dishes.length > 3 ? "…" : ""}` : ""}</span>
                                                )}
                                            </span>
                                            <span className="pick-tick" aria-hidden="true"><Icon d={PATHS.check} size={14} sw={3} /></span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {closedForDay && (
                            <p className="hint">Every meal for {dayWord(date, today)} has closed. Pick another day above, or ask {b.name} at the counter.</p>
                        )}
                    </div>

                    {meal && (
                        <>
                            {info?.state === "closing" && (
                                <div style={{ marginTop: 12 }}>
                                    <CutoffNotice meal={meal} today={today} businessName={b.name} />
                                </div>
                            )}

                            {/* ---- 3. how many ---- */}
                            <div className="step">
                                <div className="step-h">
                                    <span className="step-n">3</span>
                                    <h3>How many?</h3>
                                    <span className="step-sub">Max {r.maxQuantityPerBooking || 500} per booking</span>
                                </div>
                                <div className="card" style={{ marginBottom: 0, paddingTop: 4, paddingBottom: 12 }}>
                                    {meal.menuNote && <p className="small muted" style={{ margin: "10px 0 4px" }}>{meal.menuNote}</p>}
                                    {meal.variants.map((v) => (
                                        <div key={v.id} className="qty-row">
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                                                    <span className="qty-name">{v.name}</span>
                                                    {v.price > 0 && <span className="price-tag">{inr(v.price)}</span>}
                                                </div>
                                                {(v.dishes?.length > 0 || v.description) && (
                                                    <p className="dish-line">{v.dishes?.length > 0 ? v.dishes.join(", ") : v.description}</p>
                                                )}
                                            </div>
                                            <Stepper value={qty[v.id] || 0} max={r.maxQuantityPerBooking || 500}
                                                onChange={(n) => setQty((q) => ({ ...q, [v.id]: typeof n === "function" ? n(q[v.id] || 0) : n }))} />
                                        </div>
                                    ))}
                                    <div className="total-bar">
                                        <span>{total} meal{total === 1 ? "" : "s"}</span>
                                        {anyPriced ? <span>{inr(amount)}</span> : <span className="small muted" style={{ fontWeight: 500 }}>Pay at the counter</span>}
                                    </div>
                                </div>
                            </div>

                            {/* ---- 4. who ---- */}
                            <div className="step">
                                <div className="step-h">
                                    <span className="step-n">4</span>
                                    <h3>Your details</h3>
                                    {account?.signedIn && <span className="step-sub" style={{ color: "var(--basil-dark)" }}>Signed in</span>}
                                </div>
                                <div className="card stack-sm" style={{ marginBottom: 0 }}>
                                    {/* Which outlet — first, because it decides where
                                        the food is and where the pass is accepted. */}
                                    {outlets.length > 0 && (
                                        <div>
                                            <label className="label" htmlFor="book-outlet">Collect from</label>
                                            {outlets.length <= 3 ? (
                                                <div className="seg" role="radiogroup" aria-label="Outlet">
                                                    {outlets.map((o) => (
                                                        <button key={o.id} type="button" role="radio" aria-checked={String(o.id) === String(outletId)}
                                                            className={String(o.id) === String(outletId) ? "on" : ""} onClick={() => setOutletId(String(o.id))}>
                                                            {o.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            ) : (
                                                <select id="book-outlet" className="select" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
                                                    <option value="">Choose an outlet…</option>
                                                    {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}{o.description ? ` — ${o.description}` : ""}</option>)}
                                                </select>
                                            )}
                                            <span className="hint">{outlet?.addressLine || outlet?.description || "Your pass is only accepted at the outlet you choose."}</span>
                                        </div>
                                    )}

                                    <div>
                                        <label className="label" htmlFor="book-name">Your name</label>
                                        <input id="book-name" className="input" placeholder="As the counter should call you" value={form.name} autoComplete="name"
                                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="label" htmlFor="book-phone">Mobile number</label>
                                        <div className="row" style={{ gap: 8 }}>
                                            <span className="input-prefix" style={{ alignSelf: "stretch" }}>+91</span>
                                            <input id="book-phone" className="input" placeholder="10-digit number" inputMode="numeric" maxLength={10}
                                                autoComplete="tel-national" value={form.phone}
                                                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))} />
                                        </div>
                                        <span className="hint">Used to find and change this booking later. No OTP, no account needed.</span>
                                    </div>

                                    {(b.partyTypes || []).length > 1 && (
                                        <div>
                                            <label className="label">Booking as</label>
                                            {(b.partyTypes || []).length <= 3 ? (
                                                <div className="seg" role="radiogroup" aria-label="Customer type">
                                                    {(b.partyTypes || []).map((p) => (
                                                        <button key={p.key} type="button" role="radio" aria-checked={form.partyType === p.key}
                                                            className={form.partyType === p.key ? "on" : ""}
                                                            onClick={() => setForm((f) => ({ ...f, partyType: p.key }))}>{p.label}</button>
                                                    ))}
                                                </div>
                                            ) : (
                                                <select className="select" value={form.partyType} onChange={(e) => setForm((f) => ({ ...f, partyType: e.target.value }))}>
                                                    {(b.partyTypes || []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                                                </select>
                                            )}
                                        </div>
                                    )}

                                    {(r.requireOrganisation || (b.partyTypes || []).find((p) => p.key === form.partyType)?.isGroup) && (
                                        <div>
                                            <label className="label" htmlFor="book-org">Organisation / site{r.requireOrganisation ? "" : " (optional)"}</label>
                                            <input id="book-org" className="input" placeholder="Company, department or site name" value={form.organisation}
                                                onChange={(e) => setForm((f) => ({ ...f, organisation: e.target.value }))} />
                                        </div>
                                    )}

                                    {r.requireLocation && (
                                        <div>
                                            <label className="label" htmlFor="book-loc">Deliver to</label>
                                            <input id="book-loc" className="input" placeholder="Floor, block, gate…" value={form.location}
                                                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
                                        </div>
                                    )}

                                    <CustomFields
                                        fields={fields} mealTypeKey={meal.key} partyTypeKey={form.partyType}
                                        values={answers} errors={fieldErrors}
                                        onChange={(key, value) => {
                                            setAnswers((a) => ({ ...a, [key]: value }));
                                            setTouched((t) => (t[key] ? t : { ...t, [key]: true }));
                                        }}
                                    />

                                    {r.requireNote || noteOpen ? (
                                        <div>
                                            <label className="label" htmlFor="book-note">Note for the kitchen{r.requireNote ? "" : " (optional)"}</label>
                                            <textarea id="book-note" className="textarea" rows={2} autoFocus={noteOpen}
                                                placeholder="Allergies, timing, anything they should know" value={form.note}
                                                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
                                        </div>
                                    ) : (
                                        <button type="button" className="link" style={{ alignSelf: "flex-start", fontSize: 13.5 }} onClick={() => setNoteOpen(true)}>
                                            + Add a note for the kitchen
                                        </button>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                    <div style={{ height: 8 }} />
                </>
            )}
        </Sheet>
    );
}

// Increments are functional updates, so two quick taps count twice even if
// React has not re-rendered between them.
export function Stepper({ value, onChange, max = 500 }) {
    return (
        <div className="qty-ctrl">
            <button type="button" className="qty-btn" disabled={value <= 0} onClick={() => onChange((cur) => Math.max(0, (Number(cur) || 0) - 1))} aria-label="One fewer">−</button>
            <input className="qty-num" inputMode="numeric" value={value} aria-label="Quantity"
                onChange={(e) => {
                    const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
                    onChange(Math.min(max, Number.isFinite(n) ? n : 0));
                }} />
            <button type="button" className="qty-btn" disabled={value >= max} onClick={() => onChange((cur) => Math.min(max, (Number(cur) || 0) + 1))} aria-label="One more">+</button>
        </div>
    );
}
