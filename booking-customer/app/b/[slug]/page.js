"use client";
// Home — the first screen after scanning the canteen's code.
//
// It answers, in this order, the only three questions anybody has on arrival:
//   · can I book right now, and how long have I got?
//   · have I already booked something? (with the pass one tap away)
//   · what is on today?
//
// The deadline is the point of this screen. Someone opening it at 9:58 for a
// lunch that shuts at 10:00 should see "closes in 2 minutes" and be one tap
// from the form; someone opening it at 10:05 should see plainly that it is
// shut, and by how long, before investing any typing in it. So every meal
// carries its window in words, and the clock ticks while the screen is open.
import { useState } from "react";
import Link from "next/link";
import { formatDate, formatTime, cutoffInfo, dayNote, relSpanShort } from "@/lib/format";
import { CutoffBadge } from "@/components/Cutoff";
import BookingQr from "@/components/BookingQr";
import { useBooking } from "@/components/BookingShell";
import { Icon, PATHS } from "@/components/Icons";
import { splitByTime } from "@/lib/mybookings";
import useNow from "@/lib/useNow";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function HomeTab() {
    const { slug, biz, mealTypesToday, today, loading, account, mine, openBooking } = useBooking();
    const now = useNow(30000);
    const [passFor, setPassFor] = useState("");

    if (loading && !biz) {
        return (
            <>
                <div className="sk" style={{ height: 170, marginBottom: 14, borderRadius: 22 }} />
                <div className="sk" style={{ height: 90, marginBottom: 10 }} />
                <div className="sk" style={{ height: 90 }} />
            </>
        );
    }
    if (!biz) return null;

    const { upcoming } = splitByTime(mine.bookings, today);
    const infos = mealTypesToday.map((m) => ({ m, info: cutoffInfo(m, now, today) }));
    const served = infos.filter((x) => x.info.state !== "not-served");
    const bookable = served.filter((x) => x.info.state !== "closed");
    const soonest = bookable.filter((x) => x.info.leftMs != null).sort((a, b) => a.info.leftMs - b.info.leftMs)[0];

    const closed = biz.acceptingBookings === false;
    const headline = closed ? "Bookings are paused"
        : !served.length ? "Nothing served today"
            : bookable.length ? `${bookable.length} meal${bookable.length === 1 ? "" : "s"} still open`
                : "Booking has closed for today";
    const sub = closed ? (biz.closedMessage || "This canteen isn't accepting bookings right now. Existing bookings are unaffected.")
        : !served.length ? "The kitchen isn't running a service today. You can still book for another day."
            : bookable.length
                ? (soonest ? `${soonest.m.name} closes in ${relSpanShort(soonest.info.leftMs)}. Tap a meal below, or book any day this week.` : "Tap a meal below to book it, or pick another day.")
                : "Every deadline for today has passed. Booking for a later day is still open.";

    return (
        <>
            {/* ---- today, in one glance ---- */}
            <section className="hero">
                <div className="hero-kicker">{formatDate(today, { year: true })}</div>
                <h1>{headline}</h1>
                <p>{sub}</p>
                {!closed && (
                    <div className="hero-stats">
                        {served.slice(0, 4).map(({ m, info }) => (
                            <span key={m.id} className="hero-stat" style={{ opacity: info.state === "closed" ? .6 : 1 }}>
                                {m.name} <b>{info.state === "closed" ? "closed" : info.state === "no-cutoff" ? "open" : relSpanShort(info.leftMs)}</b>
                            </span>
                        ))}
                    </div>
                )}
                <button className="btn btn-lg" onClick={() => openBooking({ date: today })} disabled={closed}>
                    <Icon d={PATHS.plus} size={18} sw={2.6} /> Book a meal
                </button>
            </section>

            {/* ---- what you have coming, with the pass on it ---- */}
            {upcoming.length > 0 && (
                <>
                    <h2 className="sec-h">{upcoming.length === 1 ? "Your next meal" : "Your next meals"}</h2>
                    {upcoming.slice(0, 3).map((bk) => {
                        const openPass = passFor === bk.id;
                        const [, mm, dd] = bk.date.split("-");
                        return (
                            <div key={bk.id} className="next-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                                <div className="row" style={{ gap: 14 }}>
                                    <div className="next-date">
                                        <span className="d">{Number(dd)}</span>
                                        <span className="m">{MONTHS[Number(mm) - 1]}</span>
                                    </div>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div className="tk-meal">{bk.mealTypeName}</div>
                                        <div className="tk-when">
                                            {dayNote(bk.date, today).replace(" · ", "") || formatDate(bk.date).split(",")[0]}
                                            {bk.totalQuantity ? ` · ${bk.totalQuantity} meal${bk.totalQuantity === 1 ? "" : "s"}` : ""}
                                            {bk.outletName ? ` · ${bk.outletName}` : ""}
                                        </div>
                                    </div>
                                    <span className={`badge ${bk.status === "pending_approval" ? "badge-amber" : bk.consumed ? "badge-gray" : "badge-green"}`}>
                                        {bk.status === "pending_approval" ? "Awaiting" : bk.consumed ? "Collected" : "Confirmed"}
                                    </span>
                                </div>

                                <div className="btn-row">
                                    {bk.ticket && (
                                        <button className={`btn btn-sm ${openPass ? "" : "btn-primary"}`} style={{ flex: "0 0 auto" }}
                                            onClick={() => setPassFor(openPass ? "" : bk.id)}>
                                            <Icon d={PATHS.qr} size={16} /> {openPass ? "Hide pass" : "Show pass"}
                                        </button>
                                    )}
                                    {(bk.canEdit || bk.canCancel) && (
                                        <Link href={`/b/${slug}/bookings`} className="btn btn-sm" style={{ flex: "0 0 auto" }}>
                                            {bk.canEdit && bk.canCancel ? "Change or cancel" : bk.canEdit ? "Change" : "Cancel"}
                                        </Link>
                                    )}
                                    {!bk.canEdit && !bk.canCancel && bk.status !== "cancelled" && !bk.consumed && (
                                        <span className="xsmall faint" style={{ alignSelf: "center" }}>Booking closed — final now.</span>
                                    )}
                                </div>

                                {openPass && bk.ticket && (
                                    <BookingQr ticket={bk.ticket} reference={bk.reference} booking={bk} businessName={biz.name} />
                                )}
                            </div>
                        );
                    })}
                    {upcoming.length > 3 && (
                        <Link href={`/b/${slug}/bookings`} className="link" style={{ display: "block", margin: "2px 2px 14px", fontSize: 13.5 }}>
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
                infos.map(({ m, info }, i) => {
                    const dishes = m.variants.flatMap((v) => v.dishes || []);
                    const canOpen = !closed && info.state !== "closed" && info.state !== "not-served";
                    const inner = (
                        <>
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <div className="row-between" style={{ alignItems: "flex-start" }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div className="meal-name">{m.name}</div>
                                        {m.startTime && m.endTime && <div className="meal-time">Served {formatTime(m.startTime)}–{formatTime(m.endTime)}</div>}
                                    </div>
                                    <CutoffBadge meal={m} today={today} />
                                </div>
                                <span className={`cut-line cut-${info.tone}`}>
                                    <span className="cut-dot" aria-hidden="true" />
                                    <span>{info.line}</span>
                                </span>
                                {dishes.length > 0 && (
                                    <p className="meal-dishes">{dishes.slice(0, 4).join(", ")}{dishes.length > 4 ? "…" : ""}</p>
                                )}
                            </div>
                            {canOpen && <span className="meal-arrow"><Icon d={PATHS.chevron} size={20} /></span>}
                        </>
                    );
                    const cls = `meal-card rail-${(i % 5) + 1} ${canOpen ? "card-tap" : "is-closed"}`;
                    return canOpen
                        ? <button key={m.id} type="button" className={cls} onClick={() => openBooking({ date: today, meal: m.id })}>{inner}</button>
                        : <div key={m.id} className={cls}>{inner}</div>;
                })
            )}

            <Link href={`/b/${slug}/menu`} className="btn" style={{ marginTop: 6 }}>
                <Icon d={PATHS.menu} size={18} /> See the menu for the week
            </Link>

            {/* ---- the optional account, offered once and never nagged ---- */}
            {account.checked && !account.signedIn && mine.bookings.length > 0 && (
                <div className="card" style={{ marginTop: 16, background: "var(--basil-soft)", borderColor: "var(--basil-line)" }}>
                    <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                        <span style={{ color: "var(--basil-dark)", marginTop: 2 }}><Icon d={PATHS.shield} size={22} /></span>
                        <div>
                            <strong style={{ fontSize: 15 }}>Keep these bookings safe</strong>
                            <p className="small muted" style={{ marginTop: 4 }}>
                                Right now they live in this browser. Confirm your mobile number once and they follow you to a new phone.
                            </p>
                            <Link href={`/b/${slug}/profile`} className="btn btn-primary btn-sm" style={{ marginTop: 10 }}>Confirm my number</Link>
                        </div>
                    </div>
                </div>
            )}

            <p className="powered">Powered by <strong>Chefo</strong> Booking</p>
        </>
    );
}
