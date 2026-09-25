"use client";
// components/BookingQr.js — the pass a customer holds up at the counter.
//
// It is a PASS, not a picture of a QR code. Held out across a counter it has to
// answer, without anybody speaking: which canteen, which meal, which day, how
// many, and is this thing real. A bare black square answered none of that —
// the operator still had to ask, and the customer still had to explain.
//
// WHY THE SERVER DRAWS THE CODE: it has to mean the same thing everywhere the
// booking appears — the counter tablet scans it, the customer may screenshot it
// and send it to a colleague. One <img> pointed at /api/public/t/:ticket/qr.png
// is one canonical image, cached for a day, with no QR library shipped to a
// phone on canteen wifi.
//
// WHY THE LOADING AND FAILED STATES ARE SPELLED OUT: that image crosses to
// another origin on a connection that is often a canteen's guest wifi. Until it
// arrives the card used to be a blank gap, which reads as broken; if it never
// arrives, the reference underneath is still something a human can type in, so
// the card says exactly that instead of showing nothing.
//
// WHY TAP-TO-ENLARGE EXISTS: phones sit at low brightness, counters sit under
// bright light, and a scanner wants a big high-contrast target.
import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { BRAND } from "@/lib/brand";

export default function BookingQr({
    ticket, reference, booking = null, businessName = "",
    hint = "Show this at the counter",
}) {
    const [big, setBig] = useState(false);
    const [state, setState] = useState("loading");   // loading | ok | broken

    // Escape closes the enlarged view, and the page behind it must not scroll
    // under a full-screen overlay on a phone.
    useEffect(() => {
        if (!big) return;
        const onKey = (e) => { if (e.key === "Escape") setBig(false); };
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", onKey);
        return () => {
            document.body.style.overflow = prev;
            window.removeEventListener("keydown", onKey);
        };
    }, [big]);

    const src = ticket ? `${API_URL}/api/public/t/${encodeURIComponent(ticket)}/qr.png` : "";
    const meal = booking?.mealTypeName || "";
    const outlet = booking?.outletName || "";
    const when = booking?.date ? formatDate(booking.date, { year: true }) : "";
    const count = Number(booking?.totalQuantity) || 0;

    const Brand = (
        <div className="pass-brand">
            <img src="/chefo-mark.png" alt="" width={18} height={18} />
            <span>{BRAND.company} <b>{BRAND.shortName}</b></span>
        </div>
    );

    // No ticket at all: the reference is still something a human at the counter
    // can type, so the pass stays useful rather than disappearing.
    if (!ticket) {
        return (
            <div className="pass">
                <PassHead businessName={businessName} meal={meal} when={when} count={count} outlet={outlet} />
                <div className="pass-body">
                    <div className="notice" style={{ marginBottom: 10 }}>
                        This booking has no scannable code. Read the reference out at the counter.
                    </div>
                    <div className="mono pass-ref">{reference}</div>
                </div>
                {Brand}
            </div>
        );
    }

    return (
        <div className="pass">
            <PassHead businessName={businessName} meal={meal} when={when} count={count} outlet={outlet} />

            <div className="pass-body">
                {state === "broken" ? (
                    <div className="pass-fallback">
                        <strong>Couldn&apos;t load the code</strong>
                        <p className="small muted" style={{ marginTop: 4 }}>
                            Your booking is fine — only the picture failed. Read this reference
                            out at the counter, or try again on a better connection.
                        </p>
                    </div>
                ) : (
                    <button type="button" className="pass-tap" onClick={() => setBig(true)}
                        aria-label="Enlarge the code">
                        {state === "loading" && (
                            <span className="pass-loading">
                                <span className="sk" style={{ width: 190, height: 190, borderRadius: 10, display: "block" }} />
                            </span>
                        )}
                        <img src={src} alt={`QR code for booking ${reference || ""}`}
                            style={{ display: state === "ok" ? "block" : "none" }}
                            onLoad={() => setState("ok")}
                            onError={() => setState("broken")} />
                    </button>
                )}

                <div className="mono pass-ref">{reference}</div>
                <p className="xsmall faint" style={{ marginTop: 4 }}>
                    {state === "broken" ? "Reference — quote this at the counter"
                        : state === "loading" ? "Loading your code…"
                            : `${hint} · tap the code to enlarge`}
                </p>
            </div>

            {Brand}

            {big && state === "ok" && (
                <div className="pass-full" onClick={() => setBig(false)} role="dialog" aria-modal="true">
                    <div className="pass-full-top">
                        <strong>{meal || "Your booking"}</strong>
                        <span>{[businessName, outlet, when].filter(Boolean).join(" · ")}</span>
                    </div>
                    <img className="pass-full-img" src={src} alt={`QR code for booking ${reference || ""}`} />
                    <div className="mono pass-full-ref">{reference}</div>
                    <div className="pass-full-hint">{hint} · tap anywhere to close</div>
                    <div className="pass-brand" style={{ borderTop: "none" }}>
                        <img src="/chefo-mark.png" alt="" width={16} height={16} />
                        <span>{BRAND.company} <b>{BRAND.shortName}</b></span>
                    </div>
                </div>
            )}

            <style>{`
              /* A ticket stub: a coloured head that says what it is for, a white
                 body holding the code, and the Chefo mark along the bottom so an
                 operator can see at a glance which system it came from. */
              .pass {
                border: 1px solid var(--border); border-radius: var(--radius);
                overflow: hidden; background: var(--card); text-align: center;
              }
              .pass-head {
                background: var(--basil); color: #fff; padding: 11px 14px; text-align: left;
              }
              .pass-head .biz { font-size: 11.5px; opacity: .85; }
              .pass-head .meal {
                font-family: var(--font-display), sans-serif; font-weight: 700; font-size: 16px;
              }
              .pass-head .when { font-size: 12px; opacity: .9; }
              .pass-head .outlet {
                display: inline-block; margin-top: 5px; padding: 2px 9px; border-radius: 999px;
                background: rgba(255,255,255,.18); font-size: 12px; font-weight: 600;
              }
              .pass-body { padding: 14px; }
              .pass-tap {
                border: 1px solid var(--border); background: #fff; border-radius: var(--radius);
                padding: 10px; cursor: pointer; line-height: 0; display: inline-block;
                min-width: 212px; min-height: 212px;
              }
              .pass-tap img { width: 190px; height: 190px; display: block; image-rendering: pixelated; }
              .pass-loading { display: block; }
              .pass-fallback {
                border: 1px dashed var(--border-strong); border-radius: var(--radius);
                padding: 16px; background: var(--paper);
              }
              .pass-ref {
                font-size: 17px; font-weight: 600; letter-spacing: .05em;
                margin-top: 10px; color: var(--ink);
              }
              .pass-brand {
                display: flex; align-items: center; justify-content: center; gap: 6px;
                padding: 8px; border-top: 1px solid var(--border);
                background: var(--paper); font-size: 11px; color: var(--faint);
              }
              .pass-brand img { border-radius: 4px; }
              .pass-brand b { color: var(--slate); font-family: var(--font-display), sans-serif; }

              /* Plain white, full bleed, maximum contrast for a counter scanner. */
              .pass-full {
                position: fixed; inset: 0; z-index: 60; background: #fff;
                display: flex; flex-direction: column; align-items: center; justify-content: center;
                gap: 12px; padding: 20px; cursor: pointer;
              }
              .pass-full-top { text-align: center; display: flex; flex-direction: column; gap: 2px; }
              .pass-full-top strong { font-family: var(--font-display), sans-serif; font-size: 18px; }
              .pass-full-top span { font-size: 12.5px; color: var(--slate); }
              .pass-full-img {
                width: min(86vw, 70vh, 420px); height: min(86vw, 70vh, 420px);
                image-rendering: pixelated;
              }
              .pass-full-ref {
                font-size: 19px; font-weight: 600; letter-spacing: .05em; color: var(--ink);
              }
              .pass-full-hint { font-size: 12.5px; color: var(--faint); }
            `}</style>
        </div>
    );
}

function PassHead({ businessName, meal, when, count, outlet = "" }) {
    return (
        <div className="pass-head">
            {businessName && <div className="biz">{businessName}</div>}
            <div className="meal">
                {meal || "Your booking"}
                {count > 0 ? ` · ${count} meal${count === 1 ? "" : "s"}` : ""}
            </div>
            {when && <div className="when">{when}</div>}
            {/* Where to collect — the counter checks this before anything. */}
            {outlet && <div className="outlet">Collect at {outlet}</div>}
        </div>
    );
}
