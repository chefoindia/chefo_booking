"use client";
// Home — the first screen after scanning the canteen's code.
//
// It answers, in this order, the only three questions anybody has on arrival:
//   · can I book right now, and how long have I got?
//   · what is on today?
//   · have I already booked something?
//
// The deadline is the point of this screen. Someone opening it at 9:58 for a
// lunch that shuts at 10:00 should see "closes in 2 minutes" and be one tap
// from the form; someone opening it at 10:05 should see plainly that it is
// shut, and by how long, before investing any typing in it. So every meal
// carries its window in words, and the clock ticks while the screen is open.
import { useState } from "react";
import Link from "next/link";
import { formatDate, formatTime, cutoffInfo, dayNote } from "@/lib/format";
import { CutoffBadge } from "@/components/Cutoff";
import BookingQr from "@/components/BookingQr";
import { useBooking } from "@/components/BookingShell";
import { splitByTime } from "@/lib/mybookings";
import useNow from "@/lib/useNow";

export default function HomeTab() {
    const { slug, biz, mealTypesToday, today, loading, account, mine, openBooking } = useBooking();
    const now = useNow(30000);
    // Which booking's pass is open. The pass belongs HERE and not only on the
    // Bookings tab: somebody standing at the counter opens the app and wants
    // the code, not a tab hunt.
    const [passFor, setPassFor] = useState("");

    if (loading && !biz) {
        return (
            <>
                <div className="sk" style={{ height: 92, marginBottom: 12 }} />
                <div className="sk" style={{ height: 200 }} />
            </>
        );
    }
    if (!biz) return null;

    const { upcoming } = splitByTime(mine.bookings, today);

    const open = mealTypesToday.filter((m) => m.servedToday);
    const bookable = open.filter((m) => !m.cutoffPassed);

    return (
        <>
            {!biz.acceptingBookings && (
                <div className="notice notice-bad" style={{ marginBottom: 12 }}>
                    {biz.closedMessage || "This canteen isn't accepting bookings right now."}
                </div>
            )}

            {/* ---- today, in one line ---- */}
            <div className="card">
                <div className="xsmall faint" style={{ textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>
                    {formatDate(today, { year: true })}
                </div>
                <h1 style={{ fontSize: 18, marginTop: 3 }}>
                    {!open.length ? "Nothing served today"
                        : bookable.length ? `${bookable.length} meal${bookable.length === 1 ? "" : "s"} still open`
                            : "Booking has closed for today"}
                </h1>
                <p className="small muted" style={{ marginTop: 6 }}>
                    {!open.length
                        ? "The kitchen isn't running a service today. You can still book for another day."
                        : bookable.length
                            ? "Tap a meal below to book it, or pick another day."
                            : "Every deadline for today has passed. Booking for a later day is still open."}
                </p>
                <button className="btn btn-primary btn-lg" style={{ marginTop: 12 }}
                    onClick={() => openBooking({ date: today })}>
                    Book a meal
                </button>
            </div>

            {/* ---- what you have coming, with the pass on it ---- */}
            {upcoming.length > 0 && (
                <>
                    <h2 className="sec-h">{upcoming.length === 1 ? "Your next meal" : "Your next meals"}</h2>
                    {upcoming.slice(0, 3).map((bk) => {
                        const openPass = passFor === bk.id;
                        return (
                            <div key={bk.id} className="card">
                                <div className="row-between">
                                    <div style={{ minWidth: 0 }}>
                                        <strong>{bk.mealTypeName}</strong>
                                        <div className="xsmall faint">
                                            {formatDate(bk.date, { year: true })}{dayNote(bk.date, today)}
                                            {bk.totalQuantity ? ` · ${bk.totalQuantity} meal${bk.totalQuantity === 1 ? "" : "s"}` : ""}
                                            {bk.outletName ? ` · ${bk.outletName}` : ""}
                                        </div>
                                    </div>
                                    <span className={`badge ${bk.status === "pending_approval" ? "badge-amber" : "badge-green"}`}>
                                        {bk.status === "pending_approval" ? "Awaiting approval" : "Confirmed"}
                                    </span>
                                </div>

                                <div className="btn-row" style={{ marginTop: 11 }}>
                                    {bk.ticket && (
                                        <button className={`btn btn-sm ${openPass ? "" : "btn-primary"}`}
                                            onClick={() => setPassFor(openPass ? "" : bk.id)}>
                                            {openPass ? "Hide pass" : "Show pass"}
                                        </button>
                                    )}
                                    {/* canEdit / canCancel are the SERVER's answer.
                                        Offering the button after the deadline sent
                                        people to a screen with nothing to press. */}
                                    {(bk.canEdit || bk.canCancel) && (
                                        <Link href={`/b/${slug}/bookings`} className="btn btn-sm">
                                            {bk.canEdit && bk.canCancel ? "Change or cancel"
                                                : bk.canEdit ? "Change" : "Cancel"}
                                        </Link>
                                    )}
                                </div>
                                {!bk.canEdit && !bk.canCancel && bk.status !== "cancelled" && (
                                    <p className="xsmall faint" style={{ marginTop: 8 }}>
                                        Booking has closed for this meal — it can&apos;t be changed now.
                                    </p>
                                )}

                                {openPass && bk.ticket && (
                                    <div style={{ marginTop: 12 }}>
                                        <BookingQr ticket={bk.ticket} reference={bk.reference}
                                            booking={bk} businessName={biz.name} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {upcoming.length > 3 && (
                        <Link href={`/b/${slug}/bookings`} className="link" style={{ display: "block", margin: "2px 2px 14px" }}>
                            See all {upcoming.length} bookings
                        </Link>
                    )}
                </>
            )}

            {/* ---- today's meals, each with its window ---- */}
            <h2 className="sec-h">Today&apos;s meals</h2>
            {!mealTypesToday.length ? (
                <div className="card"><p className="small muted">This canteen hasn&apos;t set up any meal services yet.</p></div>
            ) : (
                <div className="stack-sm">
                    {mealTypesToday.map((m) => {
                        const info = cutoffInfo(m, now, today);
                        const dishes = m.variants.flatMap((v) => v.dishes || []);
                        return (
                            <MealRow key={m.id}
                                onOpen={info.state === "closed" || info.state === "not-served"
                                    ? null
                                    : () => openBooking({ date: today, meal: m.id })}
                                dim={info.state === "not-served"}>
                                <div className="row-between" style={{ alignItems: "flex-start" }}>
                                    <div style={{ minWidth: 0 }}>
                                        <strong style={{ fontFamily: "var(--font-display), sans-serif" }}>{m.name}</strong>
                                        {m.startTime && m.endTime && (
                                            <div className="xsmall faint">
                                                Served {formatTime(m.startTime)}–{formatTime(m.endTime)}
                                            </div>
                                        )}
                                    </div>
                                    <CutoffBadge meal={m} today={today} />
                                </div>

                                {/* The whole sentence, not just the badge: how
                                    long is left, or how long ago it shut. */}
                                <span className={`cut-line cut-${info.tone}`}>
                                    <span className="cut-dot" aria-hidden="true" />
                                    <span>{info.line}</span>
                                </span>

                                {dishes.length > 0 && (
                                    <p className="xsmall muted" style={{ marginTop: 7 }}>
                                        {dishes.slice(0, 4).join(", ")}{dishes.length > 4 ? "…" : ""}
                                    </p>
                                )}

                            </MealRow>
                        );
                    })}
                </div>
            )}

            <div style={{ marginTop: 14 }}>
                <Link href={`/b/${slug}/menu`} className="btn">See the menu for another day</Link>
            </div>

            {/* ---- the optional account, offered once and never nagged ---- */}
            {account.checked && !account.signedIn && mine.bookings.length > 0 && (
                <div className="card" style={{ marginTop: 14, background: "var(--basil-soft)", borderColor: "var(--border-strong)" }}>
                    <strong style={{ fontSize: 15 }}>Keep these bookings safe</strong>
                    <p className="small muted" style={{ marginTop: 5 }}>
                        Right now they live in this browser. Confirm your mobile number once and
                        they follow you to a new phone or a cleared browser.
                    </p>
                    <Link href={`/b/${slug}/profile`} className="btn btn-primary btn-sm" style={{ marginTop: 11, width: "auto" }}>
                        Confirm my number
                    </Link>
                </div>
            )}

            <p className="powered">Powered by <strong>Chefo</strong> Booking</p>
        </>
    );
}

/**
 * A meal on the overview. It opens the booking sheet when there is something to
 * book, and is a plain card when booking has closed — a tappable row that
 * opens a form you cannot submit is worse than a row that does not move.
 */
function MealRow({ onOpen, dim, children }) {
    const style = { marginBottom: 0, opacity: dim ? 0.7 : 1 };
    if (!onOpen) return <div className="card" style={style}>{children}</div>;
    return (
        <button type="button" className="card card-tap" style={style} onClick={onOpen}>
            {children}
        </button>
    );
}
