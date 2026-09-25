"use client";
// components/BookingQr.js — the pass a customer holds up at the counter.
//
// It is a PASS, not a picture of a QR code. Held out across a counter it has to
// answer, without anybody speaking: which canteen, which meal, which day, how
// many, where to collect, and is this thing real.
//
// WHY THE SERVER DRAWS THE CODE: it has to mean the same thing everywhere the
// booking appears. One <img> pointed at /api/public/t/:ticket/qr.png is one
// canonical image, cached for a day, with no QR library shipped to a phone.
//
// WHY THE LOADING AND FAILED STATES ARE SPELLED OUT: that image crosses to
// another origin on canteen wifi. Until it arrives the card would be a blank
// gap; if it never arrives, the reference underneath is still something a
// human can type in, so the card says exactly that.
//
// WHY TAP-TO-ENLARGE EXISTS: phones sit at low brightness, counters sit under
// bright light, and a scanner wants a big high-contrast target.
import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { BRAND } from "@/lib/brand";

export default function BookingQr({ ticket, reference, booking = null, businessName = "", hint = "Show this at the counter" }) {
    const [big, setBig] = useState(false);
    const [state, setState] = useState("loading");   // loading | ok | broken

    useEffect(() => {
        if (!big) return;
        const onKey = (e) => { if (e.key === "Escape") setBig(false); };
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", onKey);
        return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
    }, [big]);

    const src = ticket ? `${API_URL}/api/public/t/${encodeURIComponent(ticket)}/qr.png` : "";
    const meal = booking?.mealTypeName || "";
    const outlet = booking?.outletName || "";
    const when = booking?.date ? formatDate(booking.date, { year: true }) : "";
    const count = Number(booking?.totalQuantity) || 0;
    const lines = booking?.lines || [];

    const Brand = (
        <div className="pass-brand">
            <img src="/chefo-mark.png" alt="" width={16} height={16} />
            <span>{BRAND.company} <b>{BRAND.shortName}</b></span>
            {reference && <span className="pass-brand-ref">{reference}</span>}
        </div>
    );

    return (
        <div className="pass">
            <div className="pass-head">
                <div className="pass-head-top">
                    <span className="biz">{businessName || "Meal pass"}</span>
                    {count > 0 && <span className="count">{count} meal{count === 1 ? "" : "s"}</span>}
                </div>
                <div className="meal">{meal || "Your booking"}</div>
                <div className="when">{[when, outlet ? `Collect at ${outlet}` : ""].filter(Boolean).join(" · ")}</div>
                {lines.length > 0 && (
                    <div className="pass-lines">{lines.map((l) => <span key={l.variantId || l.variantName}>{l.quantity} {l.variantName}</span>)}</div>
                )}
            </div>
            <div className="pass-notch" aria-hidden="true"><span /><span /></div>

            <div className="pass-body">
                {!ticket ? (
                    <div className="pass-fallback">
                        <strong>No scannable code</strong>
                        <p className="small muted" style={{ marginTop: 4 }}>Read the reference out at the counter.</p>
                    </div>
                ) : state === "broken" ? (
                    <div className="pass-fallback">
                        <strong>Couldn&apos;t load the code</strong>
                        <p className="small muted" style={{ marginTop: 4 }}>
                            Your booking is fine — only the picture failed. Read the reference out at the counter, or try again on a better connection.
                        </p>
                    </div>
                ) : (
                    <button type="button" className="pass-tap" onClick={() => setBig(true)} aria-label="Enlarge the code">
                        {state === "loading" && <span className="sk" style={{ width: 176, height: 176, borderRadius: 10, display: "block" }} />}
                        <img src={src} alt={`QR code for booking ${reference || ""}`} style={{ display: state === "ok" ? "block" : "none" }}
                            onLoad={() => setState("ok")} onError={() => setState("broken")} />
                    </button>
                )}
                <div className="mono pass-ref">{reference}</div>
                <p className="xsmall faint" style={{ marginTop: 4 }}>
                    {!ticket || state === "broken" ? "Reference — quote this at the counter" : state === "loading" ? "Loading your code…" : `${hint} · tap to enlarge`}
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
                </div>
            )}

            <style>{`
              /* A boarding-pass stub: coloured head with the facts, a notched
                 fold, a white body holding the code, the brand along the foot. */
              .pass { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--card); text-align: center; box-shadow: var(--shadow); }
              .pass-head { background: linear-gradient(140deg, var(--basil) 0%, var(--basil-deep) 100%); color: #fff; padding: 13px 16px 14px; text-align: left; }
              .pass-head-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11.5px; opacity: .9; font-weight: 600; letter-spacing: .02em; }
              .pass-head .count { background: rgba(255,255,255,.18); border-radius: 999px; padding: 2px 9px; }
              .pass-head .meal { font-family: var(--font-display), sans-serif; font-weight: 700; font-size: 19px; margin-top: 4px; letter-spacing: -0.01em; }
              .pass-head .when { font-size: 12.5px; opacity: .92; margin-top: 2px; }
              .pass-lines { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
              .pass-lines span { font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.22); }
              .pass-notch { position: relative; height: 0; border-top: 2px dashed var(--border-strong); margin: 0 10px; }
              .pass-notch span { position: absolute; top: -9px; width: 18px; height: 18px; border-radius: 999px; background: var(--paper); border: 1px solid var(--border); }
              .pass-notch span:first-child { left: -20px; } .pass-notch span:last-child { right: -20px; }
              .pass-body { padding: 16px 14px 12px; }
              .pass-tap { border: 1px solid var(--border); background: #fff; border-radius: var(--radius-sm); padding: 8px; cursor: pointer; line-height: 0; display: inline-block; min-width: 194px; min-height: 194px; }
              .pass-tap img { width: 176px; height: 176px; display: block; image-rendering: pixelated; }
              .pass-fallback { border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); padding: 16px; background: var(--paper); }
              .pass-ref { font-size: 18px; font-weight: 600; letter-spacing: .06em; margin-top: 10px; color: var(--ink); }
              .pass-brand { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--border); background: var(--paper); font-size: 11px; color: var(--faint); }
              .pass-brand img { border-radius: 4px; }
              .pass-brand b { color: var(--slate); font-family: var(--font-display), sans-serif; }
              .pass-brand-ref { margin-left: auto; font-family: var(--font-mono), monospace; letter-spacing: .04em; }
              .pass-full { position: fixed; inset: 0; z-index: 90; background: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 20px; cursor: pointer; }
              .pass-full-top { text-align: center; display: flex; flex-direction: column; gap: 2px; }
              .pass-full-top strong { font-family: var(--font-display), sans-serif; font-size: 19px; }
              .pass-full-top span { font-size: 12.5px; color: var(--slate); }
              .pass-full-img { width: min(86vw, 70vh, 420px); height: min(86vw, 70vh, 420px); image-rendering: pixelated; }
              .pass-full-ref { font-size: 20px; font-weight: 600; letter-spacing: .06em; color: var(--ink); }
              .pass-full-hint { font-size: 12.5px; color: var(--faint); }
            `}</style>
        </div>
    );
}
