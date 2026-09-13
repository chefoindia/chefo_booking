"use client";
// components/AccountSheet.js — the optional account, offered and never insisted on.
//
// WHY IT IS OPTIONAL AT ALL: a booking works perfectly well with nothing but a
// phone number typed into a form, and asking a hungry person to make an account
// before lunch is how you lose them. But the device ledger that remembers their
// bookings lives in localStorage, and localStorage dies — a new phone, a
// cleared browser, a private tab. Verifying the number once moves that memory
// to the server, where it survives all three.
//
// So the tone here is an offer, not a gate: it explains what it buys, it is
// dismissible from every step, and the thing it protects (their bookings) is
// named out loud rather than dressed up as "create an account".
//
// Two steps, because a phone keyboard can only do one thing at a time:
// name + number, then the code. The code auto-submits on the sixth digit —
// nobody should have to find a button after typing a number they just read.
import { useCallback, useEffect, useRef, useState } from "react";
import { post } from "@/lib/api";
import { prettyPhone } from "@/lib/format";
import { readMe, writeMe } from "@/lib/ledger";
import { sendOtp, confirmOtp, otpErrorMessage, isFirebaseConfigured } from "@/lib/firebase";

const RECAPTCHA_ID = "account-recaptcha";
const RESEND_SECONDS = 30;

// Mirrors the backend's utils/phone.js so the number we text is the number the
// server will store.
const toE164 = (raw) => {
    const d = String(raw || "").replace(/\D/g, "");
    if (d.length === 10) return `+91${d}`;
    if (d.length === 12 && d.startsWith("91")) return `+${d}`;
    if (d.length === 11 && d.startsWith("0")) return `+91${d.slice(1)}`;
    return d ? `+${d}` : "";
};

export default function AccountSheet({ slug, onClose, onDone }) {
    const [step, setStep] = useState("details");
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [known, setKnown] = useState(false);     // the server already has bookings for this number
    const [confirmation, setConfirmation] = useState(null);
    const [otpPhone, setOtpPhone] = useState("");  // E.164 — where the code actually went
    const [code, setCode] = useState("");
    const [cooldown, setCooldown] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    // Prefilled, always: they typed this into the booking form minutes ago and
    // retyping it is the fastest way to make an optional step feel like a tax.
    useEffect(() => {
        const me = readMe() || {};
        if (me.name) setName(me.name);
        if (me.phone) setPhone(String(me.phone).replace(/\D/g, "").slice(-10));
    }, []);

    useEffect(() => {
        if (cooldown <= 0) return;
        const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [cooldown]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", onKey);
        return () => {
            document.body.style.overflow = prev;
            window.removeEventListener("keydown", onKey);
        };
    }, [onClose]);

    const digits = phone.replace(/\D/g, "");

    const start = async () => {
        setBusy(true);
        setError("");
        try {
            if (!isFirebaseConfigured()) {
                throw new Error("Saving your bookings isn't set up on this deployment.");
            }
            const e164 = toE164(digits);
            const res = await post(`/api/public/business/${slug}/account/start`, { phone: e164 });
            if (res?.otpAvailable === false) {
                throw new Error("We can't text a code right now. Your bookings still work without this.");
            }
            const conf = await sendOtp(e164, RECAPTCHA_ID);
            setKnown(Boolean(res?.exists));
            setConfirmation(conf);
            setOtpPhone(e164);
            setCode("");
            setCooldown(RESEND_SECONDS);
            setStep("code");
        } catch (err) {
            setError(otpErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const verify = useCallback(async () => {
        setBusy(true);
        setError("");
        try {
            const idToken = await confirmOtp(confirmation, code);
            // The cookie is set server-side on this response; nothing about the
            // session is kept in JavaScript.
            const res = await post(`/api/public/business/${slug}/account/verify`, {
                name: name.trim(), phone: otpPhone, idToken,
            });
            writeMe({ name: name.trim() || res?.party?.name || "", phone: digits });
            onDone?.(res);
        } catch (err) {
            setCode("");
            setError(otpErrorMessage(err));
            setBusy(false);
        }
    }, [confirmation, code, slug, name, otpPhone, digits, onDone]);

    // Auto-submit on the sixth digit.
    useEffect(() => {
        if (step === "code" && code.length === 6 && !busy) verify();
    }, [step, code, busy, verify]);

    return (
        <div className="sheet-back" onClick={() => onClose?.()}>
            <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                <div className="row-between" style={{ marginBottom: 10 }}>
                    <strong style={{ fontSize: 16 }}>
                        {step === "details" ? "Keep your bookings" : "Check your messages"}
                    </strong>
                    <button type="button" className="sheet-x" onClick={() => onClose?.()} aria-label="Close">×</button>
                </div>

                {error && <div className="notice notice-bad" style={{ marginBottom: 12 }}>{error}</div>}

                {step === "details" ? (
                    <>
                        <p className="small muted" style={{ marginBottom: 14 }}>
                            Confirm your mobile number once and your bookings stay with you — on a new
                            phone, a laptop, or after you clear your browser. It&apos;s optional, and
                            booking works exactly the same without it.
                        </p>

                        <div className="stack-sm">
                            <input className="input" placeholder="Your name" autoComplete="name"
                                value={name} onChange={(e) => setName(e.target.value)} />
                            <div className="row" style={{ gap: 8 }}>
                                <span className="input" style={{ width: 62, textAlign: "center", background: "var(--paper)", flexShrink: 0 }}>+91</span>
                                <input className="input" placeholder="Mobile number" inputMode="numeric"
                                    maxLength={10} autoComplete="tel-national" value={phone}
                                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} />
                            </div>
                            <span className="hint">
                                We text a 6-digit code to check it&apos;s really your number. Nothing else is sent.
                            </span>
                        </div>

                        <button className="btn btn-primary" style={{ marginTop: 14 }}
                            disabled={busy || digits.length < 10} onClick={start}>
                            {busy ? "Sending…" : "Send me a code"}
                        </button>
                        <button className="btn btn-ghost" style={{ marginTop: 6 }} onClick={() => onClose?.()}>
                            Not now
                        </button>
                    </>
                ) : (
                    <>
                        <p className="small muted" style={{ marginBottom: 12 }}>
                            {known
                                ? `We found bookings for ${prettyPhone(otpPhone)}. Enter the 6-digit code we just texted.`
                                : `Enter the 6-digit code we just texted to ${prettyPhone(otpPhone)}.`}
                        </p>

                        <OtpBoxes value={code} onChange={setCode} length={6} disabled={busy} />

                        <p className="hint center" style={{ marginTop: 10 }}>
                            {busy ? "Checking…" : "The code checks itself as soon as you finish typing."}
                        </p>

                        <div className="row-between" style={{ marginTop: 14 }}>
                            <button type="button" className="link" onClick={() => { setStep("details"); setError(""); }}>
                                Use a different number
                            </button>
                            <button type="button" className="link" disabled={busy || cooldown > 0}
                                style={{ opacity: cooldown > 0 ? 0.5 : 1 }}
                                onClick={() => start()}>
                                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                            </button>
                        </div>
                    </>
                )}

                {/* Firebase phone auth needs a real element to attach the invisible
                    reCAPTCHA to, and it must still be in the DOM when the code is
                    sent — so it lives inside the sheet, not on the page. */}
                <div id={RECAPTCHA_ID} />
            </div>

            <style>{`
              .sheet-back {
                position: fixed; inset: 0; z-index: 50; background: rgba(28, 37, 32, .38);
                display: flex; align-items: flex-end; justify-content: center;
                padding: 0; overscroll-behavior: contain;
              }
              .sheet {
                background: var(--card); width: 100%; max-width: 520px;
                border-radius: var(--radius) var(--radius) 0 0;
                border: 1px solid var(--border); border-bottom: none;
                padding: 18px 16px calc(20px + env(safe-area-inset-bottom));
                max-height: 92vh; overflow-y: auto;
              }
              .sheet-x {
                border: none; background: none; font-size: 24px; line-height: 1;
                color: var(--faint); cursor: pointer; padding: 0 4px;
              }
              .otp-row { display: flex; gap: 8px; justify-content: center; margin: 6px 0 4px; }
              .otp-box {
                width: 46px; height: 54px; text-align: center; font-size: 22px; font-weight: 700;
                padding: 0; font-family: var(--font-mono), monospace;
              }
              @media (min-width: 560px) {
                .sheet-back { align-items: center; padding: 20px; }
                .sheet { border-radius: var(--radius); border-bottom: 1px solid var(--border); }
              }
            `}</style>
        </div>
    );
}

// One box per digit: auto-advances, backspace steps back, and a pasted or
// autofilled code fills every box at once. Mirrors the operator app's
// OtpBoxes; it lives here because this is the only place the customer app
// ever types a code.
function OtpBoxes({ value, onChange, length = 6, disabled = false }) {
    const refs = useRef([]);

    const setDigit = (i, d) => {
        const chars = value.split("");
        while (chars.length <= i) chars.push("");
        chars[i] = d;
        onChange(chars.join("").replace(/\s+/g, ""));
    };

    const handleChange = (i, e) => {
        const raw = e.target.value.replace(/\D/g, "");
        if (!raw) { setDigit(i, ""); return; }
        if (raw.length > 1) {
            onChange(raw.slice(0, length));
            refs.current[Math.min(raw.length, length) - 1]?.focus();
            return;
        }
        setDigit(i, raw);
        if (i < length - 1) refs.current[i + 1]?.focus();
    };

    const handleKeyDown = (i, e) => {
        if (e.key === "Backspace" && !value[i] && i > 0) refs.current[i - 1]?.focus();
    };

    return (
        <div className="otp-row">
            {Array.from({ length }).map((_, i) => (
                <input
                    key={i}
                    ref={(el) => (refs.current[i] = el)}
                    className="input otp-box"
                    inputMode="numeric"
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    // Not 1: the browser would truncate a pasted code before
                    // handleChange could see it, making the paste branch unreachable.
                    maxLength={length}
                    autoFocus={i === 0}
                    disabled={disabled}
                    value={value[i] || ""}
                    onChange={(e) => handleChange(i, e)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    aria-label={`Digit ${i + 1}`}
                />
            ))}
        </div>
    );
}
