"use client";
// components/BookingQr.js — one booking's QR code, for showing at the counter.
//
// WHY THE SERVER DRAWS IT: the code has to mean the same thing everywhere the
// booking appears — the counter tablet scans it, the customer may screenshot it
// and send it to a colleague. A <img> pointed at /api/public/t/:ticket/qr.png
// is one canonical image, cached for a day, with no QR library shipped to a
// phone on canteen wifi.
//
// WHY TAP-TO-ENLARGE EXISTS: phones sit at low brightness, counters sit under
// bright light, and a scanner wants a big high-contrast target. The enlarged
// view is deliberately plain white and edge to edge — nothing to read, nothing
// to tap by accident, one instruction to get out of it.
import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";

export default function BookingQr({ ticket, reference, hint = "Show this at the counter" }) {
    const [big, setBig] = useState(false);
    const [broken, setBroken] = useState(false);

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

    // No ticket, or the image would not load: the reference is still a thing a
    // human at the counter can type in, so the card stays useful.
    if (!ticket || broken) {
        return (
            <div className="qr-panel">
                <div className="notice" style={{ marginBottom: 10 }}>
                    Your code couldn&apos;t be loaded. Read this reference out at the counter instead.
                </div>
                <div className="mono qr-ref">{reference}</div>
            </div>
        );
    }

    return (
        <div className="qr-panel">
            <button type="button" className="qr-tap" onClick={() => setBig(true)} aria-label="Enlarge the code">
                <img src={src} alt={`QR code for booking ${reference || ""}`} onError={() => setBroken(true)} />
            </button>
            <div className="mono qr-ref">{reference}</div>
            <p className="xsmall faint" style={{ marginTop: 4 }}>{hint} · tap the code to enlarge</p>

            {big && (
                <div className="qr-full" onClick={() => setBig(false)} role="dialog" aria-modal="true">
                    <img className="qr-full-img" src={src} alt={`QR code for booking ${reference || ""}`} />
                    <div className="mono qr-full-ref">{reference}</div>
                    <div className="qr-full-hint">{hint} · tap anywhere to close</div>
                </div>
            )}

            <style>{`
              .qr-panel { text-align: center; }
              .qr-tap {
                border: 1px solid var(--border); background: #fff; border-radius: var(--radius);
                padding: 10px; cursor: pointer; line-height: 0; display: inline-block;
              }
              .qr-tap img { width: 190px; height: 190px; display: block; image-rendering: pixelated; }
              .qr-ref {
                font-size: 15px; font-weight: 600; letter-spacing: .04em;
                margin-top: 9px; color: var(--ink);
              }
              /* Plain white, full bleed, maximum contrast for a counter scanner. */
              .qr-full {
                position: fixed; inset: 0; z-index: 60; background: #fff;
                display: flex; flex-direction: column; align-items: center; justify-content: center;
                gap: 14px; padding: 20px; cursor: pointer;
              }
              .qr-full-img {
                width: min(86vw, 86vh, 420px); height: min(86vw, 86vh, 420px);
                image-rendering: pixelated;
              }
              .qr-full-ref {
                font-size: 19px; font-weight: 600; letter-spacing: .05em; color: var(--ink);
              }
              .qr-full-hint { font-size: 12.5px; color: var(--faint); }
            `}</style>
        </div>
    );
}
