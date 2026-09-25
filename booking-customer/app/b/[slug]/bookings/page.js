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
import Link from "next/link";
import { useParams } from "next/navigation";
import { get, post } from "@/lib/api";
import { formatDate, prettyPhone, dayWord, dayNote, relSpan } from "@/lib/format";
import { readMe } from "@/lib/ledger";
import { fromLedger, fromPhone, splitByTime, CLOSED_STATUSES } from "@/lib/mybookings";
import { useBooking } from "@/components/BookingShell";
import Calendar, { monthOf, monthStart, monthEnd } from "@/components/Calendar";
import BookingQr from "@/components/BookingQr";

// `pending_approval` cannot happen any more — the cutoff is a wall, so nothing
// is ever submitted for a decision. It stays in this map because bookings made
// before that change still exist and must not be shown as confirmed.
const STATUS = {
    confirmed: { label: "Confirmed", cls: "badge-green" },
    pending_approval: { label: "Waiting for the canteen", cls: "badge-amber" },
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

    // The calendar half.
    const [month, setMonth] = useState(() => monthOf(today));
    const [pick, setPick] = useState("");
    const [dayState, setDayState] = useState({});

    /* ---------------------------------------------------------- boot */

    // The shell already asked. This tab only reacts to the answer, so opening
    // it is instant rather than another two round trips.
    useEffect(() => {
        const me = readMe() || {};
        if (me.phone) setPhone(String(me.phone));
    }, []);

    useEffect(() => {
        if (!mine.loaded) return;
        setBooting(false);
        // A phone lookup done on this tab is newer than anything the shell
        // knows, so it is not overwritten by the shared copy.
        if (source === "phone") return;
        if (!mine.source) { setAskPhone(true); setBookings([]); return; }
        setSource(mine.source);
        setParty(mine.party);
        setBookings(mine.bookings);
    }, [mine, source]);

    useEffect(() => { setMonth(monthOf(today)); }, [today]);

    // What is open across the visible month, so the grid can grey out days the
    // kitchen isn't running — the same call the booking form makes.
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
            } catch { /* the grid stays plain */ }
        })();
        return () => { alive = false; };
    }, [slug, month, today, maxDate]);

    // Re-reads from whichever source found these bookings in the first place.
    const reload = useCallback(async () => {
        try {
            // A phone lookup belongs to this tab; everything else is the shared
            // copy, so refreshing it updates Home at the same time.
            if (source === "phone") {
                const r = await fromPhone(slug, phone);
                if (r) { setParty(r.party); setBookings(r.bookings); }
                return;
            }
            await refreshMine();
        } catch (e) {
            setError(e.message || "Could not refresh your bookings.");
        }
    }, [source, slug, phone, refreshMine]);

    /* ---------------------------------------------------------- actions */

    // Changing or cancelling proves ownership with the phone number the booking
    // was made with. It is never asked for twice — it comes from the signed-in
    // party, or from what this device already remembers.
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
        } catch (err) {
            setError(err.message || "Could not look that up.");
        } finally {
            setBusy(false);
        }
    };

    const cancel = async (b) => {
        const p = ownerPhone();
        if (!p) return needPhone();
        setActing(b.id); setError(""); setNotice("");
        try {
            const res = await post(`/api/public/business/${slug}/bookings/${b.id}/cancel`,
                { phone: p, reason: "Cancelled by customer" });
            // The outcome differs by cutoff, and the customer is told which
            // happened rather than left to infer it from a status word.
            setNotice(res.applied
                ? "That booking is cancelled."
                : "Booking has closed for this meal, so it can't be cancelled here any more. Speak to the canteen.");
            setConfirmCancel("");
            await reload();
        } catch (err) {
            setError(err.message || "Could not cancel that booking.");
        } finally {
            setActing("");
        }
    };

    const saveChange = async (b) => {
        const p = ownerPhone();
        if (!p) return needPhone();
        setActing(b.id); setError(""); setNotice("");
        try {
            const res = await post(`/api/public/business/${slug}/bookings/${b.id}/change`,
                { phone: p, quantities: editing?.qty || {} });
            setNotice(res.applied
                ? "Your booking has been updated."
                : "Booking has closed for this meal, so it can't be changed here any more. Speak to the canteen.");
            setEditing(null);
            await reload();
        } catch (err) {
            setError(err.message || "Could not change that booking.");
        } finally {
            setActing("");
        }
    };

    const signOut = async () => {
        setBusy(true);
        try {
            await post(`/api/public/business/${slug}/account/logout`, {});
        } catch { /* the cookie is gone either way as far as this page cares */ }
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

    // Days with a live booking on them, for the grid.
    const marks = useMemo(() => new Set(
        list.filter((b) => !CLOSED_STATUSES.includes(b.status)).map((b) => b.date)
    ), [list]);

    const shownUpcoming = pick ? upcoming.filter((b) => b.date === pick) : upcoming;
    const shownPast = pick ? past.filter((b) => b.date === pick) : past;

    const card = (b) => (
        <BookingCard
            key={b.id}
            b={b}
            today={today}
            businessName={biz?.name || ""}
            acting={acting === b.id}
            qrOpen={qrFor === b.id}
            onQr={() => setQrFor(qrFor === b.id ? "" : b.id)}
            editing={editing?.id === b.id ? editing : null}
            onEdit={() => {
                setEditing({
                    id: b.id,
                    qty: Object.fromEntries((b.lines || []).map((l) => [l.variantId, l.quantity])),
                });
                setConfirmCancel("");
            }}
            onEditQty={(variantId, n) =>
                setEditing((s) => ({ ...s, qty: { ...s.qty, [variantId]: n } }))}
            onEditCancel={() => setEditing(null)}
            onEditSave={() => saveChange(b)}
            confirming={confirmCancel === b.id}
            onAskCancel={() => { setConfirmCancel(b.id); setEditing(null); }}
            onKeep={() => setConfirmCancel("")}
            onCancel={() => cancel(b)}
        />
    );

    return (
        <>
            {error && <div className="notice notice-bad" style={{ marginBottom: 12 }}>{error}</div>}
            {notice && <div className="notice notice-ok" style={{ marginBottom: 12 }}>{notice}</div>}

            {/* ---- the calendar ---- */}
            <div className="card">
                <Calendar
                    month={month} onMonthChange={setMonth}
                    value={pick} onChange={(d) => setPick(pick === d ? "" : d)}
                    today={today} maxDate={maxDate} dayState={dayState} marks={marks}
                />
                <div className="btn-row" style={{ marginTop: 12 }}>
                    <button className="btn btn-primary btn-sm"
                        onClick={() => openBooking({ date: pick || today })}>
                        {pick ? `Book ${dayWord(pick, today)}` : "Book a meal"}
                    </button>
                    {pick && (
                        <button className="btn btn-sm" onClick={() => setPick("")}>Show all days</button>
                    )}
                </div>
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
                            <label className="label">Find your bookings</label>
                            <p className="small muted" style={{ marginBottom: 9 }}>
                                Nothing is saved on this device yet. Look them up with the number
                                you booked with.
                            </p>
                            <input className="input" inputMode="numeric" placeholder="The number you booked with"
                                value={phone} onChange={(e) => setPhone(e.target.value)} />
                            <button className="btn btn-primary" style={{ marginTop: 11 }}
                                disabled={busy || phone.replace(/\D/g, "").length < 10}>
                                {busy ? "Looking…" : "Find my bookings"}
                            </button>
                        </form>
                    )}

                    {pick && !shownUpcoming.length && !shownPast.length && (
                        <div className="card center">
                            <p className="small muted">Nothing booked for {dayWord(pick, today)}.</p>
                        </div>
                    )}

                    {!pick && bookings && list.length === 0 && !askPhone && (
                        <div className="card center">
                            <p className="small muted">
                                {source === "phone"
                                    ? "No bookings found for that number at this canteen."
                                    : "Nothing booked here yet."}
                            </p>
                            <button className="btn" style={{ marginTop: 12 }}
                                onClick={() => openBooking({ date: today })}>
                                Make a booking
                            </button>
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

            <style>{`
              .bk-act { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 11px; }
              .bk-act .btn { width: auto; }
              .bk-served {
                display: flex; align-items: center; gap: 7px; margin-top: 10px;
                padding: 9px 11px; border-radius: var(--radius-sm);
                background: var(--basil-soft); color: var(--basil-dark); font-size: 13px;
              }
              .bk-qr { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
              .bk-edit { margin-top: 11px; padding-top: 11px; border-top: 1px solid var(--border); }
            `}</style>
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

    // The deadline, said once per booking, in the tense it belongs in: still
    // ahead means "you can change this yourself until then"; already gone means
    // the booking is final and anything else is a conversation at the counter.
    const cutAt = b.cutoffAt ? new Date(b.cutoffAt).getTime() : null;
    const cutLine = !b.cutoffAt ? ""
        : b.cutoffPassed
            ? `Booking closed ${relSpan(Date.now() - cutAt)} ago, so this is final now. Speak to the canteen if anything has to change.`
            : `You can change or cancel this yourself for another ${relSpan(cutAt - Date.now())}.`;

    return (
        <div className="card">
            <div className="row-between" style={{ marginBottom: 8 }}>
                <div style={{ minWidth: 0 }}>
                    <strong>{b.mealTypeName}</strong>
                    <div className="xsmall faint">
                        {formatDate(b.date, { year: true })}{dayNote(b.date, today)}
                        {b.outletName ? ` · ${b.outletName}` : ""}
                    </div>
                </div>
                <span className={`badge ${s.cls}`}>{s.label}</span>
            </div>

            {editing ? (
                <div className="bk-edit">
                    <label className="label">How many now?</label>
                    {(b.lines || []).map((l) => (
                        <div key={l.variantId} className="qty-row">
                            <span className="qty-name">{l.variantName}</span>
                            <Stepper
                                value={editing.qty[l.variantId] ?? 0}
                                onChange={(n) => onEditQty(l.variantId, n)}
                            />
                        </div>
                    ))}
                    <span className="hint">
                        Set an option to zero to drop it. To add something new, make another booking.
                    </span>
                    <div className="bk-act">
                        <button className="btn btn-primary btn-sm" disabled={acting} onClick={onEditSave}>
                            {acting ? "Saving…" : "Save the change"}
                        </button>
                        <button className="btn btn-sm" disabled={acting} onClick={onEditCancel}>
                            Leave it as it is
                        </button>
                    </div>
                </div>
            ) : (
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
                        <span>Total</span><span>{b.totalQuantity}</span>
                    </div>
                </div>
            )}

            {served && (
                <div className="bk-served">
                    <span aria-hidden="true">✓</span>
                    <span>
                        Collected{served.at ? ` · ${servedWhen(served.at)}` : ""}
                        {served.by ? ` · ${served.by}` : ""}
                    </span>
                </div>
            )}

            {!closed && !served && cutLine && (
                <span className={`cut-line ${b.cutoffPassed ? "cut-red" : "cut-green"}`}>
                    <span className="cut-dot" aria-hidden="true" />
                    <span>{cutLine}</span>
                </span>
            )}

            <div className="row-between" style={{ marginTop: 10 }}>
                <span className="mono xsmall faint">{b.reference}</span>
            </div>

            {!editing && (
                <div className="bk-act">
                    {b.ticket && !closed && (
                        <button className="btn btn-sm" onClick={onQr}>
                            {qrOpen ? "Hide pass" : "Show pass"}
                        </button>
                    )}
                    {/* canEdit / canCancel are the SERVER's answer. This page
                        never works out whether a cutoff has passed. */}
                    {b.canEdit && !confirming && (
                        <button className="btn btn-sm" disabled={acting} onClick={onEdit}>
                            Change
                        </button>
                    )}
                    {b.canCancel && !confirming && (
                        <button className="btn btn-sm" disabled={acting} onClick={onAskCancel}>
                            Cancel
                        </button>
                    )}
                </div>
            )}

            {confirming && (
                <div className="bk-edit">
                    <p className="small muted">
                        Cancel this booking? It can&apos;t be undone — you&apos;d have to book again,
                        and only before the deadline.
                    </p>
                    <div className="bk-act">
                        <button className="btn btn-sm" disabled={acting} onClick={onCancel}
                            style={{ borderColor: "var(--brick)", color: "var(--brick)" }}>
                            {acting ? "Cancelling…" : "Yes, cancel it"}
                        </button>
                        <button className="btn btn-sm" disabled={acting} onClick={onKeep}>
                            Keep it
                        </button>
                    </div>
                </div>
            )}

            {qrOpen && b.ticket && (
                <div className="bk-qr">
                    <BookingQr ticket={b.ticket} reference={b.reference}
                        booking={b} businessName={businessName} />
                </div>
            )}

            {/* The operator's reason, when they left one — the closest thing
                this app has to telling a customer why. */}
            {b.requestHistory?.filter((r) => r.note).map((r) => (
                <p key={r.reference} className="xsmall faint" style={{ marginTop: 8 }}>
                    {REQUEST_LABEL[r.type]} {r.status}: “{r.note}”
                </p>
            ))}
        </div>
    );
}

function Stepper({ value, onChange, max = 500 }) {
    return (
        <div className="qty-ctrl">
            <button type="button" className="qty-btn" disabled={value <= 0}
                onClick={() => onChange(Math.max(0, value - 1))} aria-label="One fewer">−</button>
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
