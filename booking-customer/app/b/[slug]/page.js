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
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDate, formatTime, cutoffInfo, dayNote } from "@/lib/format";
import { CutoffBadge } from "@/components/Cutoff";
import { useBooking } from "@/components/BookingShell";
import { loadMine, splitByTime } from "@/lib/mybookings";
import useNow from "@/lib/useNow";

export default function HomeTab() {
    const { slug, biz, mealTypesToday, today, loading, account } = useBooking();
    const now = useNow(30000);
    const [mine, setMine] = useState(null);

    // Quiet on purpose: somebody who has never booked here sees nothing about
    // bookings at all, rather than an empty box explaining its own emptiness.
    useEffect(() => {
        let alive = true;
        loadMine(slug)
            .then((r) => { if (alive) setMine(r?.bookings || []); })
            .catch(() => { if (alive) setMine([]); });
        return () => { alive = false; };
    }, [slug, account.checked]);

    if (loading && !biz) {
        return (
            <>
                <div className="sk" style={{ height: 92, marginBottom: 12 }} />
                <div className="sk" style={{ height: 200 }} />
            </>
        );
    }
    if (!biz) return null;

    const { upcoming } = splitByTime(mine || [], today);
    const next = upcoming[0] || null;

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
                <Link href={`/b/${slug}/book`} className="btn btn-primary btn-lg" style={{ marginTop: 12 }}>
                    Book a meal
                </Link>
            </div>

            {/* ---- your next booking ---- */}
            {next && (
                <>
                    <h2 className="sec-h">Your next meal</h2>
                    <Link href={`/b/${slug}/bookings`} className="card card-tap">
                        <div className="row-between">
                            <div style={{ minWidth: 0 }}>
                                <strong>{next.mealTypeName}</strong>
                                <div className="xsmall faint">
                                    {formatDate(next.date, { year: true })}{dayNote(next.date, today)}
                                    {next.totalQuantity ? ` · ${next.totalQuantity} meal${next.totalQuantity === 1 ? "" : "s"}` : ""}
                                </div>
                            </div>
                            <span className={`badge ${next.status === "pending_approval" ? "badge-amber" : "badge-green"}`}>
                                {next.status === "pending_approval" ? "Awaiting approval" : "Confirmed"}
                            </span>
                        </div>
                        <span className="hint">Tap to show the QR the counter scans, or to change it.</span>
                    </Link>
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
                            <Link key={m.id} href={`/b/${slug}/book?date=${today}&meal=${m.id}`}
                                className="card card-tap"
                                style={{ marginBottom: 0, opacity: info.state === "not-served" ? 0.7 : 1 }}>
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
                                        {dishes.slice(0, 4).join(" · ")}{dishes.length > 4 ? " …" : ""}
                                    </p>
                                )}

                                {info.state === "closed" && (
                                    <p className="xsmall faint" style={{ marginTop: 7 }}>
                                        You can still ask {biz.name} to fit you in — it&apos;s their call, not a booking.
                                    </p>
                                )}
                            </Link>
                        );
                    })}
                </div>
            )}

            <div style={{ marginTop: 14 }}>
                <Link href={`/b/${slug}/menu`} className="btn">See the menu for another day</Link>
            </div>

            {/* ---- the optional account, offered once and never nagged ---- */}
            {account.checked && !account.signedIn && mine && mine.length > 0 && (
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
