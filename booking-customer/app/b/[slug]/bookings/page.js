"use client";
// Bookings — the calendar, and everything on it.
//
// One screen answers both "when am I booked" and "what exactly did I book",
// because they are the same question asked at two zoom levels. The month grid
// fills the days this customer has a meal coming; tapping one narrows the list
// below it to that day. Tapping nothing shows everything, upcoming first.
//
// It finds the customer without asking: the account cookie, then the tickets
// this browser collected, then — only if neither knew anything — their mobile
// number. Whichever answers first wins silently.
//
// The server decides what may still be done to a booking (canEdit, canCancel,
// cutoffPassed). This page renders those answers and never works out a deadline
// for itself; it only says, in words, what the deadline means.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { get, post } from "@/lib/api";
import { formatDate, prettyPhone, dayWord, dayNote, relSpan } from "@/lib/format";
import { readMe } from "@/lib/ledger";
import { fromLedger, fromPhone, splitByTime, CLOSED_STATUSES } from "@/lib/mybookings";
import { useBooking } from "@/components/BookingShell";
import Calendar, { monthOf, monthStart, monthEnd } from "@/components/Calendar";
import BookingQr from "@/components/BookingQr";
import { Stepper } from "@/components/BookSheet";
import { Icon, PATHS } from "@/components/Icons";

// `pending_approval` cannot happen any more — the cutoff is a wall — but
// bookings made before that change still exist and must not read as confirmed.
const STATUS = {
    confirmed: { label: "Confirmed", cls: "badge-green" },
    pending_approval: { label: "Waiting for the canteen", cls: "badge-amber" },
    rejected: { label: "Not accepted", cls: "badge-red" },
    cancelled: { label: "Cancelled", cls: "badge-gray" },
};
const REQUEST_LABEL = { new_booking: "Late booking", change: "Change request", cancellation: "Cancellation request" };

const servedWhen = (iso) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); }
    catch { return ""; }
};

export default function BookingsTab() {
    const { slug } = useParams();
    const { biz, today, maxDate, account, setAccount, mine, refreshMine, openBooking } = useBooking();

    const [booting, setBooting] = useState(true);
    const [source, setSource] = useState("");
    const [party, setParty] = useState(null);
    const [bookings, setBookings] = useState(null);

    const [phone, setPhone] = useState("");
    const [askPhone, setAskPhone] = useState(false);

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [acting, setActing] = useState("");
    const [qrFor, setQrFor] = useState("");
    const [confirmCancel, setConfirmCancel] = useState("");
    const [editing, setEditing] = useState(null);

    const [month, setMonth] = useState(() => monthOf(today));
    const [pick, setPick] = useState("");
    const [dayState, setDayState] = useState({});
    const [calOpen, setCalOpen] = useState(false);

    /* ---------------------------------------------------------- boot */
    useEffect(() => {
        const me = readMe() || {};
        if (me.phone) setPhone(String(me.phone));
    }, []);

    useEffect(() => {
        if (!mine.loaded) return;
        setBooting(false);
        if (source === "phone") return;
        if (!mine.source) { setAskPhone(true); setBookings([]); return; }
        setSource(mine.source);
        setParty(mine.party);
        setBookings(mine.bookings);
    }, [mine, source]);

    useEffect(() => { setMonth(monthOf(today)); }, [today]);

    useEffect(() => {
        if (!today || !maxDate || !calOpen) return;
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
            } catch { /* the grid stays plain */ }
        })();
        return () => { alive = false; };
    }, [slug, month, today, maxDate, calOpen]);

    const reload = useCallback(async () => {
        try {
            if (source === "phone") {
                const r = await fromPhone(slug, phone);
                if (r) { setParty(r.party); setBookings(r.bookings); }
                return;
            }
            await refreshMine();
        } catch (e) { setError(e.message || "Could not refresh your bookings."); }
    }, [source, slug, phone, refreshMine]);

    /* ---------------------------------------------------------- actions */
    const ownerPhone = () => {
        const me = readMe() || {};
        return String(party?.phone || account?.party?.phone || me.phone || phone || "").trim();
    };
    const needPhone = () => {
        setError("Enter the mobile number you booked with to change or cancel a booking.");
        setAskPhone(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const lookupSubmit = async (e) => {
        e?.preventDefault();
        setBusy(true); setError(""); setNotice("");
        try {
            const r = await fromPhone(slug, phone);
            setSource("phone"); setParty(r?.party || null); setBookings(r?.bookings || []);
            setAskPhone(false);
        } catch (err) { setError(err.message || "Could not look that up."); }
        finally { setBusy(false); }
    };

    const cancel = async (b) => {
        const p = ownerPhone();
        if (!p) return needPhone();
        setActing(b.id); setError(""); setNotice("");
        try {
            const res = await post(`/api/public/business/${slug}/bookings/${b.id}/cancel`, { phone: p, reason: "Cancelled by customer" });
            setNotice(res.applied ? "That booking is cancelled." : "Booking has closed for this meal, so it can't be cancelled here any more. Speak to the canteen.");
            setConfirmCancel("");
            await reload();
        } catch (err) { setError(err.message || "Could not cancel that booking."); }
        finally { setActing(""); }
    };

    const saveChange = async (b) => {
        const p = ownerPhone();
        if (!p) return needPhone();
        setActing(b.id); setError(""); setNotice("");
        try {
            const res = await post(`/api/public/business/${slug}/bookings/${b.id}/change`, { phone: p, quantities: editing?.qty || {} });
            setNotice(res.applied ? "Your booking has been updated." : "Booking has closed for this meal, so it can't be changed here any more. Speak to the canteen.");
            setEditing(null);
            await reload();
        } catch (err) { setError(err.message || "Could not change that booking."); }
        finally { setActing(""); }
    };

    const signOut = async () => {
        setBusy(true);
        try { await post(`/api/public/business/${slug}/account/logout`, {}); } catch { /* cookie is gone either way */ }
        setAccount({ checked: true, signedIn: false, party: null });
        setParty(null); setBookings(null); setSource("");
        setNotice("Signed out on this device. Your bookings are safe — sign in again any time.");
        try {
            const r = await fromLedger(slug);
            if (r) { setSource("ledger"); setBookings(r.bookings); } else setAskPhone(true);
        } catch { setAskPhone(true); }
        setBusy(false);
    };

    /* ---------------------------------------------------------- render */
    const list = bookings || [];
    const { upcoming, past } = splitByTime(list, today);
    const marks = useMemo(() => new Set(list.filter((b) => !CLOSED_STATUSES.includes(b.status)).map((b) => b.date)), [list]);
    const shownUpcoming = pick ? upcoming.filter((b) => b.date === pick) : upcoming;
    const shownPast = pick ? past.filter((b) => b.date === pick) : past;

    const card = (b) => (
        <BookingCard key={b.id} b={b} today={today} businessName={biz?.name || ""}
            acting={acting === b.id} qrOpen={qrFor === b.id} onQr={() => setQrFor(qrFor === b.id ? "" : b.id)}
            editing={editing?.id === b.id ? editing : null}
            onEdit={() => { setEditing({ id: b.id, qty: Object.fromEntries((b.lines || []).map((l) => [l.variantId, l.quantity])) }); setConfirmCancel(""); }}
            onEditQty={(variantId, n) => setEditing((s) => ({ ...s, qty: { ...s.qty, [variantId]: typeof n === "function" ? n(s.qty[variantId] ?? 0) : n } }))}
            onEditCancel={() => setEditing(null)} onEditSave={() => saveChange(b)}
            confirming={confirmCancel === b.id} onAskCancel={() => { setConfirmCancel(b.id); setEditing(null); }}
            onKeep={() => setConfirmCancel("")} onCancel={() => cancel(b)} />
    );

    return (
        <>
            {error && <div className="notice notice-bad" style={{ marginBottom: 12 }}>{error}</div>}
            {notice && <div className="notice notice-ok" style={{ marginBottom: 12 }}>{notice}</div>}

            {/* ---- the header: how many, and the calendar behind a toggle ---- */}
            <div className="card">
                <div className="row-between">
                    <div>
                        <h2 style={{ fontSize: 18 }}>{pick ? dayWord(pick, today)[0].toUpperCase() + dayWord(pick, today).slice(1) : "Your bookings"}</h2>
                        <p className="xsmall faint" style={{ marginTop: 2 }}>
                            {booting ? "Looking them up…" : `${upcoming.length} upcoming · ${past.length} past`}
                        </p>
                    </div>
                    <button className={`btn btn-sm ${calOpen ? "btn-soft" : ""}`} onClick={() => setCalOpen((o) => !o)} aria-expanded={calOpen}>
                        <Icon d={PATHS.calendar} size={16} /> {calOpen ? "Hide" : "Calendar"}
                    </button>
                </div>
                {calOpen && (
                    <>
                        <Calendar month={month} onMonthChange={setMonth} value={pick} onChange={(d) => setPick(pick === d ? "" : d)}
                            today={today} maxDate={maxDate} dayState={dayState} marks={marks} />
                        <div className="btn-row" style={{ marginTop: 12 }}>
                            <button className="btn btn-primary btn-sm" onClick={() => openBooking({ date: pick || today })}>
                                {pick ? `Book ${dayWord(pick, today)}` : "Book a meal"}
                            </button>
                            {pick && <button className="btn btn-sm" onClick={() => setPick("")}>Show all days</button>}
                        </div>
                    </>
                )}
            </div>

            {booting ? (
                <>
                    <div className="sk" style={{ height: 150, marginBottom: 12 }} />
                    <div className="sk" style={{ height: 150 }} />
                </>
            ) : (
                <>
                    {askPhone && (
                        <form className="card" onSubmit={lookupSubmit}>
                            <div className="row" style={{ gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
                                <span style={{ color: "var(--basil-dark)", marginTop: 2 }}><Icon d={PATHS.phone} size={20} /></span>
                                <div>
                                    <strong>Find your bookings</strong>
                                    <p className="small muted" style={{ marginTop: 3 }}>Nothing is saved on this device yet. Look them up with the number you booked with.</p>
                                </div>
                            </div>
                            <div className="row" style={{ gap: 8 }}>
                                <span className="input-prefix" style={{ alignSelf: "stretch" }}>+91</span>
                                <input className="input" inputMode="numeric" placeholder="The number you booked with" value={phone} onChange={(e) => setPhone(e.target.value)} />
                            </div>
                            <button className="btn btn-primary" style={{ marginTop: 11 }} disabled={busy || phone.replace(/\D/g, "").length < 10}>
                                {busy ? "Looking…" : "Find my bookings"}
                            </button>
                        </form>
                    )}

                    {pick && !shownUpcoming.length && !shownPast.length && (
                        <div className="card center"><p className="small muted">Nothing booked for {dayWord(pick, today)}.</p></div>
                    )}

                    {!pick && bookings && list.length === 0 && !askPhone && (
                        <div className="card center" style={{ padding: 28 }}>
                            <div className="done-mark" style={{ background: "var(--paper)", color: "var(--faint)" }}><Icon d={PATHS.calendar} size={28} /></div>
                            <strong>{source === "phone" ? "No bookings for that number here" : "Nothing booked here yet"}</strong>
                            <p className="small muted" style={{ marginTop: 6 }}>Book a meal and it appears here with its pass.</p>
                            <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => openBooking({ date: today })}>Book a meal</button>
                        </div>
                    )}

                    {shownUpcoming.length > 0 && (
                        <>
                            <h2 className="sec-h">{pick ? dayWord(pick, today) : "Upcoming"}</h2>
                            {shownUpcoming.map(card)}
                        </>
                    )}
                    {shownPast.length > 0 && (
                        <>
                            <h2 className="sec-h">{pick ? `Earlier on ${dayWord(pick, today)}` : "Past"}</h2>
                            {shownPast.map(card)}
                        </>
                    )}

                    {account.signedIn && party?.name && (
                        <p className="xsmall faint center" style={{ marginTop: 16 }}>
                            Signed in as {party.name} · {prettyPhone(party.phone)} ·{" "}
                            <button className="link" onClick={signOut} disabled={busy}>Sign out</button>
                        </p>
                    )}
                </>
            )}
        </>
    );
}

/* ---------------------------------------------------------------- card */
function BookingCard({
    b, today, businessName, acting, qrOpen, onQr, editing, onEdit, onEditQty, onEditCancel, onEditSave,
    confirming, onAskCancel, onKeep, onCancel,
}) {
    const s = STATUS[b.status] || STATUS.confirmed;
    const closed = CLOSED_STATUSES.includes(b.status);
    const served = b.consumed || (b.consumedAt ? { at: b.consumedAt } : null);

    const cutAt = b.cutoffAt ? new Date(b.cutoffAt).getTime() : null;
    const cutLine = !b.cutoffAt ? ""
        : b.cutoffPassed
            ? `Booking closed ${relSpan(Date.now() - cutAt)} ago — this is final now. Speak to the canteen if anything has to change.`
            : `You can change or cancel this yourself for another ${relSpan(cutAt - Date.now())}.`;

    return (
        <div className="tk" style={{ opacity: closed ? .75 : 1 }}>
            <div className="tk-head">
                <div style={{ minWidth: 0 }}>
                    <div className="tk-meal">{b.mealTypeName}</div>
                    <div className="tk-when">{formatDate(b.date, { year: true })}{dayNote(b.date, today)}{b.outletName ? ` · ${b.outletName}` : ""}</div>
                </div>
                <span className={`badge ${served && !closed ? "badge-gray" : s.cls}`}>{served && !closed ? "Collected" : s.label}</span>
            </div>

            <div className="tk-body">
                {editing ? (
                    <div className="tk-edit" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
                        <label className="label">How many now?</label>
                        {(b.lines || []).map((l) => (
                            <div key={l.variantId} className="qty-row">
                                <span className="qty-name">{l.variantName}</span>
                                <Stepper value={editing.qty[l.variantId] ?? 0} onChange={(n) => onEditQty(l.variantId, n)} />
                            </div>
                        ))}
                        <span className="hint">Set an option to zero to drop it. To add something new, make another booking.</span>
                        <div className="tk-act">
                            <button className="btn btn-primary btn-sm" disabled={acting} onClick={onEditSave}>{acting ? "Saving…" : "Save the change"}</button>
                            <button className="btn btn-sm" disabled={acting} onClick={onEditCancel}>Leave it</button>
                        </div>
                    </div>
                ) : (
                    <div className="row-between" style={{ alignItems: "flex-start" }}>
                        <div className="tk-lines">
                            {(b.lines || []).map((l) => <span key={l.variantId} className="tk-line"><b>{l.quantity}</b> {l.variantName}</span>)}
                        </div>
                        <span className="tk-ref">{b.reference}</span>
                    </div>
                )}

                {served && (
                    <div className="tk-served">
                        <Icon d={PATHS.check} size={16} sw={2.6} />
                        <span>Collected{served.at ? ` · ${servedWhen(served.at)}` : ""}{served.by ? ` · ${served.by}` : ""}</span>
                    </div>
                )}

                {!closed && !served && cutLine && (
                    <span className={`cut-line ${b.cutoffPassed ? "cut-red" : "cut-green"}`}>
                        <span className="cut-dot" aria-hidden="true" />
                        <span>{cutLine}</span>
                    </span>
                )}

                {!editing && (b.ticket && !closed || b.canEdit || b.canCancel) && (
                    <div className="tk-act">
                        {b.ticket && !closed && (
                            <button className={`btn btn-sm ${qrOpen ? "" : "btn-primary"}`} onClick={onQr}>
                                <Icon d={PATHS.qr} size={16} /> {qrOpen ? "Hide pass" : "Show pass"}
                            </button>
                        )}
                        {b.canEdit && !confirming && <button className="btn btn-sm" disabled={acting} onClick={onEdit}><Icon d={PATHS.edit} size={15} /> Change</button>}
                        {b.canCancel && !confirming && <button className="btn btn-sm btn-ghost" disabled={acting} onClick={onAskCancel}>Cancel</button>}
                    </div>
                )}

                {confirming && (
                    <div className="tk-edit">
                        <p className="small muted">Cancel this booking? It can&apos;t be undone — you&apos;d have to book again, and only before the deadline.</p>
                        <div className="tk-act">
                            <button className="btn btn-sm btn-danger" disabled={acting} onClick={onCancel}>{acting ? "Cancelling…" : "Yes, cancel it"}</button>
                            <button className="btn btn-sm" disabled={acting} onClick={onKeep}>Keep it</button>
                        </div>
                    </div>
                )}

                {qrOpen && b.ticket && (
                    <div style={{ marginTop: 12 }}>
                        <BookingQr ticket={b.ticket} reference={b.reference} booking={b} businessName={businessName} />
                    </div>
                )}

                {b.requestHistory?.filter((r) => r.note).map((r) => (
                    <p key={r.reference} className="xsmall faint" style={{ marginTop: 8 }}>{REQUEST_LABEL[r.type]} {r.status}: “{r.note}”</p>
                ))}
            </div>
        </div>
    );
}
