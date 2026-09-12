"use client";
// app/auth/page.js — sign in, create an account, reset a password.
//
// ONE THING PER SCREEN. Every state below asks for exactly one thing and then
// moves on: a number, then a code; an identifier, then a code, then a
// password. Nothing that belongs to a later step is on screen during an
// earlier one — a form showing an OTP box next to a password field reads as
// two unrelated questions and invites answering them in the wrong order.
//
// SIGN IN is mobile + OTP, the same Firebase phone verification the canteen
// owner portal uses. The login-ID + password alternative exists but is not
// shown by default: it sits behind a text link, because almost nobody needs it.
//
// CREATE AN ACCOUNT verifies the mobile FIRST — the account and its business
// are created the moment the code checks out, so an owner who abandons the
// rest can sign back in and finish where they left off (?resume=business).
//
//   1 Verify your mobile   name, email, mobile + OTP  -> account exists
//   2 Your business        name, city, address
//   3 Meal services        services with cutoffs, and the options customers pick
//   4 Review & submit
//
// The mobile is asked ONCE, in step 1, and reused as the business contact.
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { get, post } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { formatTime, prettyPhone, withCountryCode } from "@/lib/format";
import { sendOtp, confirmOtp, otpErrorMessage, isFirebaseConfigured } from "@/lib/firebase";
import { Field, Input, Check } from "@/components/Field";
import ClockTimeInput from "@/components/ClockTimeInput";
import OtpBoxes from "@/components/OtpBoxes";
import BootSplash from "@/components/BootSplash";
import { useAutoVerify } from "@/lib/useAutoVerify";
import { useToast } from "@/components/ToastProvider";

const STEP_LABELS = { 1: "Verify your mobile", 2: "Your business", 3: "Meal services", 4: "Review & submit" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_SECONDS = 45;

// Sensible starting points; the owner edits or removes any of them.
const QUICK_SERVICES = [
    { name: "Breakfast", startTime: "08:00", endTime: "09:30", cutoffTime: "07:00", cutoffPreviousDay: false },
    { name: "Lunch", startTime: "12:30", endTime: "14:30", cutoffTime: "10:30", cutoffPreviousDay: false },
    { name: "Snacks", startTime: "16:30", endTime: "17:30", cutoffTime: "", cutoffPreviousDay: false },
    { name: "Dinner", startTime: "20:00", endTime: "22:00", cutoffTime: "16:30", cutoffPreviousDay: false },
];
const QUICK_OPTIONS = ["Veg", "Non-Veg", "Jain", "Egg"];

/* ------------------------------------------------------------------ */
function WizardBar({ step }) {
    return (
        <div className="wizard-bar">
            {[1, 2, 3, 4].map((n, i) => (
                <span key={n} style={{ display: "contents" }}>
                    {i > 0 && <div className={`wizard-line ${n <= step ? "done" : ""}`} />}
                    <div className={`wizard-dot ${step === n ? "active" : ""} ${n < step ? "done" : ""}`}>{n < step ? "✓" : n}</div>
                </span>
            ))}
        </div>
    );
}

/** The +91 chip plus a 10-digit box, the one way a number is ever typed here. */
function PhoneInput({ value, onChange, disabled, autoFocus }) {
    return (
        <div style={{ display: "flex", gap: 8 }}>
            <span className="input" style={{ width: 62, textAlign: "center", background: "var(--paper)", flexShrink: 0 }}>+91</span>
            <Input inputMode="numeric" maxLength={10} placeholder="10-digit number" autoComplete="tel-national"
                autoFocus={autoFocus} disabled={disabled} value={value}
                onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 10))} />
        </div>
    );
}

/* ---------------------------------------------------------------------
   Left panel — the Chefo Lottie, with a text fallback so it is never blank.
--------------------------------------------------------------------- */
function AuthLeftPanel() {
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (window.customElements?.get("lottie-player")) { setReady(true); return; }
        // StrictMode runs this twice in development; a second <script> would
        // re-register the custom element and throw. Reuse the first.
        let script = document.querySelector("script[data-lottie-player]");
        if (!script) {
            script = document.createElement("script");
            script.src = "https://unpkg.com/@lottiefiles/lottie-player@latest/dist/lottie-player.js";
            script.dataset.lottiePlayer = "1";
            document.body.appendChild(script);
        }
        const onLoad = () => setReady(true);
        const onErr = () => setFailed(true);
        script.addEventListener("load", onLoad);
        script.addEventListener("error", onErr);
        return () => { script.removeEventListener("load", onLoad); script.removeEventListener("error", onErr); };
    }, []);

    return (
        <div className="auth-left">
            <div className="auth-left-inner" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                <Link href="/" className="auth-left-brand">
                    <Image src="/chefo-mark.png" alt="Chefo" width={38} height={38} />
                    <strong style={{ fontSize: 18, fontFamily: "var(--font-display)" }}>
                        Chefo <span style={{ fontWeight: 500, color: "#b9c0ba" }}>Booking</span>
                    </strong>
                </Link>
                <div className="auth-left-lottie">
                    {ready && !failed ? (
                        <lottie-player src="/Login.json" autoplay loop onError={() => setFailed(true)}
                            style={{ width: "100%", maxWidth: 360, margin: "0 auto" }} />
                    ) : (
                        <div className="auth-left-fallback"><strong>Know how many plates to cook. Every meal.</strong></div>
                    )}
                </div>
                <div className="auth-points">
                    <div className="auth-point"><i>1</i><span>Customers book each meal service before its cutoff.</span></div>
                    <div className="auth-point"><i>2</i><span>Late bookings and changes wait for your approval.</span></div>
                    <div className="auth-point"><i>3</i><span>The kitchen cooks to a confirmed count, never a guess.</span></div>
                </div>
            </div>
        </div>
    );
}

export default function AuthPage() {
    return (
        <Suspense fallback={<BootSplash label="Opening the partner portal" />}>
            <AuthInner />
        </Suspense>
    );
}

function AuthInner() {
    const router = useRouter();
    const params = useSearchParams();
    const toast = useToast();

    // signin | password | forgot | signup
    const [mode, setMode] = useState("signin");
    const [busy, setBusy] = useState(false);
    const [booting, setBooting] = useState(true);

    /* -------------------------------------------------- shared OTP plumbing */
    const [confirmation, setConfirmation] = useState(null); // Firebase confirmationResult
    const [otpPhone, setOtpPhone] = useState("");           // E.164, the code went here
    const [code, setCode] = useState("");
    const [cooldown, setCooldown] = useState(0);

    useEffect(() => {
        if (cooldown <= 0) return;
        const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [cooldown]);

    const clearOtp = () => { setConfirmation(null); setCode(""); setOtpPhone(""); };

    /** Sends the SMS and moves to the code screen. */
    const startOtp = async (phoneDigits) => {
        const phone = withCountryCode(phoneDigits);
        if (!isFirebaseConfigured()) throw new Error("Phone sign-in isn't set up on this deployment.");
        const conf = await sendOtp(phone, "recaptcha-container");
        setConfirmation(conf);
        setOtpPhone(phone);
        setCode("");
        setCooldown(RESEND_SECONDS);
        toast("success", "Code sent", `We texted a 6-digit code to ${prettyPhone(phone)}.`);
    };

    /* -------------------------------------------------- already signed in? */
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const me = await get("/api/auth/me");
                if (!alive) return;
                if (me.setupPending && me.user?.isOwner) {
                    // Verified their mobile but never finished. Pick up at step 2.
                    setAccountCreated(true);
                    setIdentity((s) => ({ ...s, name: me.user.name || "", email: me.user.email || "", phone: (me.user.phone || "").replace(/^\+91/, "") }));
                    setBiz((s) => ({
                        ...s,
                        name: me.business?.name || "", city: me.business?.city || "",
                        addressLine: me.business?.addressLine || "", landmark: me.business?.landmark || "",
                    }));
                    setMode("signup");
                    setStep(2);
                    toast("success", "Almost there", "Finish your business details to open the dashboard.");
                } else {
                    router.replace("/dashboard");
                    return;
                }
            } catch {
                // Not signed in — the normal case on this page.
                if (alive && params.get("mode") === "signup") setMode("signup");
            } finally {
                if (alive) setBooting(false);
            }
        })();
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* -------------------------------------------------- SIGN IN (phone OTP) */
    const [signinPhone, setSigninPhone] = useState("");

    const signinSendCode = async () => {
        const digits = signinPhone.replace(/\D/g, "");
        if (digits.length !== 10) return toast("error", "Check the number", "Enter your 10-digit mobile number.");
        setBusy(true);
        try {
            await post("/api/auth/login/start", { phone: withCountryCode(digits) });
            await startOtp(digits);
        } catch (err) {
            if (err.code === "NO_ACCOUNT") {
                toast("error", "No account yet", err.message);
                setIdentity((s) => ({ ...s, phone: digits }));
                setMode("signup");
                setStep(1);
            } else if (err.code === "OTP_UNAVAILABLE") {
                toast("error", "Phone sign-in unavailable", err.message);
                setMode("password");
            } else {
                toast("error", "Couldn't send a code", otpErrorMessage(err));
            }
        } finally { setBusy(false); }
    };

    const signinVerify = useCallback(async () => {
        if (code.length !== 6) return toast("error", "Check the code", "Enter all 6 digits.");
        setBusy(true);
        try {
            const idToken = await confirmOtp(confirmation, code);
            const res = await post("/api/auth/login/verify-otp", { phone: otpPhone, idToken });
            router.replace(res.setupPending ? "/auth?resume=business" : "/dashboard");
            if (res.setupPending) window.location.reload();
        } catch (err) {
            setCode("");
            toast("error", "Verification failed", otpErrorMessage(err));
            setBusy(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [code, confirmation, otpPhone, router, toast]);

    /* -------------------------------------------------- SIGN IN (password) */
    const [pw, setPw] = useState({ identifier: "", password: "" });

    const passwordSignin = async (e) => {
        e?.preventDefault();
        if (!pw.identifier.trim() || !pw.password) {
            return toast("error", "Missing details", "Enter your login ID and password.");
        }
        setBusy(true);
        try {
            const res = await post("/api/auth/login", { identifier: pw.identifier.trim(), password: pw.password });
            router.replace(res.setupPending ? "/auth?resume=business" : "/dashboard");
            if (res.setupPending) window.location.reload();
        } catch (err) {
            toast("error", "Sign-in failed", err.message);
            setBusy(false);
        }
    };

    /* -------------------------------------------------- FORGOT PASSWORD */
    // who -> code -> password. Three screens, one question each.
    const [fgStep, setFgStep] = useState("who");
    const [fg, setFg] = useState({ identifier: "", code: "", hint: "", resetToken: "", password: "", confirm: "" });
    const setFgField = (k, v) => setFg((s) => ({ ...s, [k]: v }));

    const fgSend = async () => {
        const id = fg.identifier.trim();
        if (!id) return toast("error", "Missing details", "Enter your mobile number, login ID or email.");
        setBusy(true);
        try {
            const res = await post("/api/auth/forgot-password", { identifier: fgIdentifier(id) });
            setFg((s) => ({ ...s, hint: res.emailHint || "", code: "" }));
            setFgStep("code");
            setCooldown(RESEND_SECONDS);
            toast("success", res.sent ? "Code sent" : "Check your inbox", res.message);
        } catch (err) {
            if (err.code === "RESEND_TOO_SOON") { setCooldown(err.data?.retryAfter || 30); setFgStep("code"); }
            toast("error", "Couldn't send a code", err.message);
        } finally { setBusy(false); }
    };

    const fgVerifyCode = useCallback(async () => {
        if (fg.code.length !== 4) return;
        setBusy(true);
        try {
            const res = await post("/api/auth/verify-reset-code", { identifier: fgIdentifier(fg.identifier.trim()), code: fg.code });
            setFg((s) => ({ ...s, resetToken: res.resetToken }));
            setFgStep("password");
        } catch (err) {
            setFg((s) => ({ ...s, code: "" }));
            toast("error", "Couldn't verify", err.message);
        } finally { setBusy(false); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fg.code, fg.identifier, toast]);

    const fgSetPassword = async () => {
        if (fg.password.length < 8) return toast("error", "Password too short", "Use at least 8 characters.");
        if (fg.password !== fg.confirm) return toast("error", "Passwords differ", "Both fields must match.");
        setBusy(true);
        try {
            await post("/api/auth/reset-password", { resetToken: fg.resetToken, newPassword: fg.password });
            toast("success", "Password set", "You're signed in.");
            router.replace("/dashboard");
        } catch (err) {
            toast("error", "Couldn't set your password", err.message);
            setBusy(false);
        }
    };

    /* -------------------------------------------------- SIGN UP WIZARD */
    const [step, setStep] = useState(1);
    const [accountCreated, setAccountCreated] = useState(false);
    const [identity, setIdentity] = useState({ name: "", email: "", phone: "" });
    const [biz, setBiz] = useState({ name: "", city: "", addressLine: "", landmark: "" });
    const [services, setServices] = useState([]);
    const [options, setOptions] = useState([]);
    const [newService, setNewService] = useState("");
    const [newOption, setNewOption] = useState("");

    const setId = (k, v) => setIdentity((s) => ({ ...s, [k]: v }));
    const setBz = (k, v) => setBiz((s) => ({ ...s, [k]: v }));

    const signupSendCode = async () => {
        const digits = identity.phone.replace(/\D/g, "");
        if (!identity.name.trim()) return toast("error", "Missing details", "Enter your name.");
        if (digits.length !== 10) return toast("error", "Check the number", "Enter a 10-digit mobile number.");
        if (identity.email.trim() && !EMAIL_RE.test(identity.email.trim())) {
            return toast("error", "Check the email", "That email address doesn't look right.");
        }
        setBusy(true);
        try {
            const res = await post("/api/auth/phone/exists", { phone: withCountryCode(digits) });
            if (res.exists) throw new Error("This mobile number already has an account. Sign in instead.");
            await startOtp(digits);
        } catch (err) {
            toast("error", "Couldn't send a code", otpErrorMessage(err));
        } finally { setBusy(false); }
    };

    const signupVerify = useCallback(async () => {
        if (code.length !== 6) return toast("error", "Check the code", "Enter all 6 digits.");
        setBusy(true);
        try {
            const idToken = await confirmOtp(confirmation, code);
            await post("/api/auth/signup/verify-otp", {
                name: identity.name.trim(),
                email: identity.email.trim() || undefined,
                phone: otpPhone,
                idToken,
            });
            setAccountCreated(true);
            clearOtp();
            setStep(2);
            toast("success", "Mobile verified", "Now tell us about your business.");
        } catch (err) {
            setCode("");
            toast("error", "Verification failed", otpErrorMessage(err));
        } finally { setBusy(false); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [code, confirmation, identity, otpPhone, toast]);

    // One auto-verify hook, pointed at whichever verification is on screen.
    const otpTarget = mode === "signup" ? signupVerify : signinVerify;
    useAutoVerify(code, 6, busy, otpTarget, Boolean(confirmation));
    useAutoVerify(fg.code, 4, busy, fgVerifyCode, mode === "forgot" && fgStep === "code");

    const addService = (preset) => {
        const name = (preset?.name || newService).trim();
        if (!name || services.some((s) => s.name.toLowerCase() === name.toLowerCase())) return;
        setServices((s) => [...s, preset || { name, startTime: "", endTime: "", cutoffTime: "", cutoffPreviousDay: false }]);
        setNewService("");
    };
    const updateService = (i, patch) => setServices((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    const removeService = (i) => setServices((s) => s.filter((_, j) => j !== i));

    const addOption = (name) => {
        const n = (name || newOption).trim();
        if (!n || options.some((o) => o.toLowerCase() === n.toLowerCase())) return;
        setOptions((o) => [...o, n]);
        setNewOption("");
    };

    const finishSetup = async () => {
        setBusy(true);
        try {
            await post("/api/auth/signup/business", {
                name: biz.name.trim() || undefined,
                city: biz.city.trim(),
                addressLine: biz.addressLine.trim(),
                landmark: biz.landmark.trim(),
                mealTypes: services,
                variants: options.map((name) => ({ name })),
            });
            toast("success", "You're all set", "Welcome to Chefo Booking.");
            router.replace("/dashboard");
        } catch (err) {
            toast("error", "Couldn't finish setup", err.message);
            setBusy(false);
        }
    };

    const switchMode = (m) => {
        setMode(m);
        setBusy(false);
        clearOtp();
        setCooldown(0);
        if (m === "signup") setStep(accountCreated ? 2 : 1);
        if (m === "forgot") { setFgStep("who"); setFg({ identifier: "", code: "", hint: "", resetToken: "", password: "", confirm: "" }); }
    };

    const businessNameOrDefault = biz.name.trim() || `${identity.name.trim().split(" ")[0] || "Owner"}'s Canteen`;

    if (booting) return <BootSplash label="Opening the partner portal" />;

    return (
        <div className="auth-split">
            <AuthLeftPanel />
            <div className="auth-right">
                <div className="auth-card card">
                    <div className="auth-head">
                        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
                            <Image src="/chefo-mark.png" alt="Chefo" width={38} height={38} />
                            <strong style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>Chefo</strong>
                        </Link>
                        <span className="small muted">{BRAND.shortName} partner portal</span>
                    </div>

                    {/* ============ SIGN IN — mobile + OTP ============ */}
                    {mode === "signin" && !confirmation && (
                        <div className="wizard-step" key="signin-phone">
                            <h1 className="auth-title">Sign in</h1>
                            <Field label="Mobile number" hint="We'll text a 6-digit code to this number.">
                                <PhoneInput value={signinPhone} onChange={setSigninPhone} disabled={busy} autoFocus />
                            </Field>
                            <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy || signinPhone.length !== 10}
                                onClick={signinSendCode}>
                                {busy ? "Sending…" : "Send code"}
                            </button>
                            <div className="auth-alt">
                                <button className="link-btn" onClick={() => switchMode("password")}>
                                    Sign in with a login ID and password instead
                                </button>
                            </div>
                            <div className="auth-links" style={{ justifyContent: "center" }}>
                                <span className="muted small">
                                    New to Chefo? <button className="link-btn" onClick={() => switchMode("signup")}>Create an account</button>
                                </span>
                            </div>
                        </div>
                    )}

                    {/* ============ SIGN IN — the code ============ */}
                    {mode === "signin" && confirmation && (
                        <div className="wizard-step" key="signin-code">
                            <h1 className="auth-title">Enter the code</h1>
                            <p className="small muted" style={{ textAlign: "center", marginBottom: 4 }}>
                                Sent by SMS to <strong>{prettyPhone(otpPhone)}</strong>.
                            </p>
                            <OtpBoxes value={code} onChange={setCode} length={6} disabled={busy} />
                            <button className="btn btn-primary" style={{ width: "100%", marginTop: 16 }}
                                disabled={busy || code.length !== 6} onClick={signinVerify}>
                                {busy ? "Verifying…" : "Verify & sign in"}
                            </button>
                            <div className="auth-links">
                                <button className="link-btn" disabled={busy || cooldown > 0}
                                    style={{ opacity: cooldown > 0 ? 0.6 : 1 }}
                                    onClick={() => startOtp(signinPhone).catch((e) => toast("error", "Couldn't resend", otpErrorMessage(e)))}>
                                    {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                                </button>
                                <button className="link-btn" onClick={clearOtp}>Use a different number</button>
                            </div>
                        </div>
                    )}

                    {/* ============ SIGN IN — the alternative ============ */}
                    {mode === "password" && (
                        <form className="wizard-step" key="signin-password" onSubmit={passwordSignin}>
                            <h1 className="auth-title">Sign in with a password</h1>
                            <Field label="Login ID or email">
                                <Input autoFocus autoComplete="username" placeholder="kitchen-a or you@example.com"
                                    value={pw.identifier} onChange={(e) => setPw((s) => ({ ...s, identifier: e.target.value }))} />
                            </Field>
                            <Field label="Password">
                                <Input type="password" autoComplete="current-password" value={pw.password}
                                    onChange={(e) => setPw((s) => ({ ...s, password: e.target.value }))} />
                            </Field>
                            <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>
                                {busy ? "Signing in…" : "Sign in"}
                            </button>
                            <div className="auth-links">
                                <button type="button" className="link-btn" onClick={() => switchMode("forgot")}>Forgot password?</button>
                                <button type="button" className="link-btn" onClick={() => switchMode("signin")}>← Use my mobile number</button>
                            </div>
                        </form>
                    )}

                    {/* ============ FORGOT — 1. who ============ */}
                    {mode === "forgot" && fgStep === "who" && (
                        <div className="wizard-step" key="fg-who">
                            <h1 className="auth-title">Reset your password</h1>
                            <Field label="Mobile number, login ID or email" hint="We'll email a 4-digit code to the address on your account.">
                                <Input autoFocus autoComplete="username" value={fg.identifier} onChange={(e) => setFgField("identifier", e.target.value)} />
                            </Field>
                            <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy || !fg.identifier.trim()} onClick={fgSend}>
                                {busy ? "Sending…" : "Email me a code"}
                            </button>
                            <div className="auth-links" style={{ justifyContent: "center" }}>
                                <button className="link-btn" onClick={() => switchMode("signin")}>Back to sign in</button>
                            </div>
                        </div>
                    )}

                    {/* ============ FORGOT — 2. the code, alone ============ */}
                    {mode === "forgot" && fgStep === "code" && (
                        <div className="wizard-step" key="fg-code">
                            <h1 className="auth-title">Enter the code</h1>
                            <p className="small muted" style={{ textAlign: "center", marginBottom: 4 }}>
                                Emailed{fg.hint ? <> to <strong>{fg.hint}</strong></> : ""}. It expires in 10 minutes.
                            </p>
                            <OtpBoxes value={fg.code} onChange={(v) => setFgField("code", v)} length={4} disabled={busy} />
                            <button className="btn btn-primary" style={{ width: "100%", marginTop: 16 }}
                                disabled={busy || fg.code.length !== 4} onClick={fgVerifyCode}>
                                {busy ? "Checking…" : "Continue"}
                            </button>
                            <div className="auth-links">
                                <button className="link-btn" disabled={busy || cooldown > 0} style={{ opacity: cooldown > 0 ? 0.6 : 1 }} onClick={fgSend}>
                                    {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                                </button>
                                <button className="link-btn" onClick={() => setFgStep("who")}>Use a different account</button>
                            </div>
                        </div>
                    )}

                    {/* ============ FORGOT — 3. the new password, alone ============ */}
                    {mode === "forgot" && fgStep === "password" && (
                        <div className="wizard-step" key="fg-password">
                            <h1 className="auth-title">Choose a new password</h1>
                            <p className="small muted" style={{ marginTop: -8, marginBottom: 16 }}>
                                Your code checked out. This signs you in and ends every other session.
                            </p>
                            <Field label="New password" hint="At least 8 characters.">
                                <Input type="password" autoFocus autoComplete="new-password" value={fg.password} onChange={(e) => setFgField("password", e.target.value)} />
                            </Field>
                            <Field label="Confirm new password">
                                <Input type="password" autoComplete="new-password" value={fg.confirm} onChange={(e) => setFgField("confirm", e.target.value)} />
                            </Field>
                            {fg.password && fg.confirm && fg.password !== fg.confirm && (
                                <p className="xsmall" style={{ color: "var(--brick)", marginTop: -8, marginBottom: 10 }}>Those two don&apos;t match.</p>
                            )}
                            <button className="btn btn-primary" style={{ width: "100%" }}
                                disabled={busy || fg.password.length < 8 || fg.password !== fg.confirm} onClick={fgSetPassword}>
                                {busy ? "Saving…" : "Set password & sign in"}
                            </button>
                        </div>
                    )}

                    {/* ============ CREATE AN ACCOUNT ============ */}
                    {mode === "signup" && (
                        <>
                            <h1 className="auth-title" style={{ textAlign: "center", marginBottom: 4 }}>Create your account</h1>
                            <WizardBar step={step} />
                            <p className="small muted" style={{ textAlign: "center", marginTop: -4, marginBottom: 16 }}>
                                Step {step} of 4 — {STEP_LABELS[step]}
                            </p>

                            {/* ---- 1a. details ---- */}
                            {step === 1 && !confirmation && (
                                <div className="wizard-step" key="s1-form">
                                    <Field label="Your name">
                                        <Input autoFocus placeholder="Full name" autoComplete="name" value={identity.name} onChange={(e) => setId("name", e.target.value)} />
                                    </Field>
                                    <Field label="Mobile number" hint="Verified with an SMS code — this is how you'll sign in.">
                                        <PhoneInput value={identity.phone} onChange={(v) => setId("phone", v)} disabled={busy} />
                                    </Field>
                                    <Field label="Email" hint="Optional, but it's the only way to recover a forgotten password.">
                                        <Input type="email" placeholder="you@example.com" autoComplete="email" value={identity.email} onChange={(e) => setId("email", e.target.value)} />
                                    </Field>
                                    <button className="btn btn-primary" style={{ width: "100%" }}
                                        disabled={busy || !identity.name.trim() || identity.phone.length !== 10} onClick={signupSendCode}>
                                        {busy ? "Sending…" : "Verify my mobile"}
                                    </button>
                                    <div className="auth-links" style={{ justifyContent: "center" }}>
                                        <span className="muted small">
                                            Already registered? <button className="link-btn" onClick={() => switchMode("signin")}>Sign in</button>
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* ---- 1b. the code ---- */}
                            {step === 1 && confirmation && (
                                <div className="wizard-step" key="s1-code">
                                    <p className="small muted" style={{ textAlign: "center", marginBottom: 4 }}>
                                        Sent by SMS to <strong>{prettyPhone(otpPhone)}</strong>.
                                    </p>
                                    <OtpBoxes value={code} onChange={setCode} length={6} disabled={busy} />
                                    <button className="btn btn-primary" style={{ width: "100%", marginTop: 16 }}
                                        disabled={busy || code.length !== 6} onClick={signupVerify}>
                                        {busy ? "Verifying…" : "Verify & continue"}
                                    </button>
                                    <div className="auth-links">
                                        <button className="link-btn" disabled={busy || cooldown > 0} style={{ opacity: cooldown > 0 ? 0.6 : 1 }}
                                            onClick={() => startOtp(identity.phone).catch((e) => toast("error", "Couldn't resend", otpErrorMessage(e)))}>
                                            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                                        </button>
                                        <button className="link-btn" onClick={clearOtp}>Edit my details</button>
                                    </div>
                                </div>
                            )}

                            {/* ---- 2. business ---- */}
                            {step === 2 && (
                                <div className="wizard-step" key="s2">
                                    <Field label="Business name" hint="What customers see on your booking page.">
                                        <Input autoFocus placeholder={`Optional — “${businessNameOrDefault}” if left blank`}
                                            value={biz.name} onChange={(e) => setBz("name", e.target.value)} />
                                    </Field>
                                    <div className="grid grid-2">
                                        <Field label="City"><Input placeholder="Optional" value={biz.city} onChange={(e) => setBz("city", e.target.value)} /></Field>
                                        <Field label="Landmark"><Input placeholder="Optional" value={biz.landmark} onChange={(e) => setBz("landmark", e.target.value)} /></Field>
                                    </div>
                                    <Field label="Address" hint="Where the food is prepared or collected from.">
                                        <Input placeholder="Optional" value={biz.addressLine} onChange={(e) => setBz("addressLine", e.target.value)} />
                                    </Field>
                                    <p className="xsmall faint" style={{ marginBottom: 14 }}>
                                        Customers will see {prettyPhone(withCountryCode(identity.phone))} as your contact number. You can change that in Settings.
                                    </p>
                                    <div className="wizard-nav">
                                        <button className="btn btn-secondary" onClick={() => setStep(3)}>Skip for now</button>
                                        <button className="btn btn-primary" onClick={() => setStep(3)}>Continue</button>
                                    </div>
                                </div>
                            )}

                            {/* ---- 3. meal services & options ---- */}
                            {step === 3 && (
                                <div className="wizard-step" key="s3">
                                    <Field label="Meal services" hint="Each has its own booking cutoff. Before it, bookings confirm automatically; after it, they wait for your approval.">
                                        <div className="chip-list" style={{ marginBottom: 8 }}>
                                            {QUICK_SERVICES.filter((q) => !services.some((s) => s.name.toLowerCase() === q.name.toLowerCase())).map((q) => (
                                                <button key={q.name} type="button" className="btn btn-secondary btn-sm" onClick={() => addService(q)}>+ {q.name}</button>
                                            ))}
                                        </div>
                                        <div style={{ display: "flex", gap: 8 }}>
                                            <Input placeholder="Or add your own — e.g. Night shift meal" value={newService}
                                                onChange={(e) => setNewService(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addService(); } }} />
                                            <button type="button" className="btn btn-secondary" onClick={() => addService()} disabled={!newService.trim()}>Add</button>
                                        </div>
                                    </Field>

                                    {services.map((s, i) => (
                                        <div key={s.name} className="svc-nest" style={{ margin: "0 0 12px" }}>
                                            <div className="svc-nest-note row-between">
                                                <strong style={{ color: "var(--ink)", fontSize: 13.5 }}>{s.name}</strong>
                                                <button type="button" className="link-btn" style={{ color: "var(--brick)" }} onClick={() => removeService(i)}>Remove</button>
                                            </div>
                                            <Field label="Booking cutoff" hint="Empty = never closes.">
                                                <ClockTimeInput value={s.cutoffTime} onChange={(v) => updateService(i, { cutoffTime: v })} clearable
                                                    placeholder="No cutoff" ariaLabel={`${s.name} cutoff`} />
                                            </Field>
                                            <Field label="Served from – until">
                                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                                    <ClockTimeInput value={s.startTime} onChange={(v) => updateService(i, { startTime: v })} clearable placeholder="From" ariaLabel={`${s.name} served from`} />
                                                    <ClockTimeInput value={s.endTime} onChange={(v) => updateService(i, { endTime: v })} clearable placeholder="Until" ariaLabel={`${s.name} served until`} />
                                                </div>
                                            </Field>
                                            {s.cutoffTime && (
                                                <div style={{ gridColumn: "1 / -1" }}>
                                                    <Check label="Cutoff falls on the day before" checked={Boolean(s.cutoffPreviousDay)}
                                                        onChange={(e) => updateService(i, { cutoffPreviousDay: e.target.checked })} />
                                                </div>
                                            )}
                                        </div>
                                    ))}

                                    <Field label="Meal options" hint="What a booking's quantity is split across — Veg, Non-Veg, Jain, Thali A.">
                                        <div className="chip-list" style={{ marginBottom: 8 }}>
                                            {options.map((o) => (
                                                <span key={o} className="chip">{o}<button type="button" aria-label={`Remove ${o}`} onClick={() => setOptions((os) => os.filter((x) => x !== o))}>✕</button></span>
                                            ))}
                                            {QUICK_OPTIONS.filter((q) => !options.some((o) => o.toLowerCase() === q.toLowerCase())).map((q) => (
                                                <button key={q} type="button" className="btn btn-secondary btn-sm" onClick={() => addOption(q)}>+ {q}</button>
                                            ))}
                                        </div>
                                        <div style={{ display: "flex", gap: 8 }}>
                                            <Input placeholder="Or add your own — e.g. Special Thali" value={newOption}
                                                onChange={(e) => setNewOption(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOption(); } }} />
                                            <button type="button" className="btn btn-secondary" onClick={() => addOption()} disabled={!newOption.trim()}>Add</button>
                                        </div>
                                    </Field>

                                    <div className="wizard-nav">
                                        <button className="btn btn-secondary" onClick={() => setStep(2)}>Back</button>
                                        <button className="btn btn-primary" onClick={() => setStep(4)}>Continue</button>
                                    </div>
                                </div>
                            )}

                            {/* ---- 4. review ---- */}
                            {step === 4 && (
                                <div className="wizard-step" key="s4">
                                    <div className="review-block">
                                        <div className="review-row"><span>Name</span><b>{identity.name.trim() || "—"}</b></div>
                                        <div className="review-row">
                                            <span>Mobile</span>
                                            <b>{prettyPhone(withCountryCode(identity.phone))} <span className="badge badge-green" style={{ marginLeft: 6 }}>Verified</span></b>
                                        </div>
                                        <div className="review-row"><span>Email</span><b>{identity.email.trim() || "—"}</b></div>
                                        <div className="review-row"><span>Business</span><b>{businessNameOrDefault}</b><button className="link-btn" onClick={() => setStep(2)}>Edit</button></div>
                                        <div className="review-row"><span>City</span><b>{biz.city.trim() || "—"}</b></div>
                                        <div className="review-row">
                                            <span>Meal services</span>
                                            <b>{services.length ? services.map((s) => `${s.name}${s.cutoffTime ? ` (till ${formatTime(s.cutoffTime)})` : ""}`).join(", ") : "None yet"}</b>
                                            <button className="link-btn" onClick={() => setStep(3)}>Edit</button>
                                        </div>
                                        <div className="review-row"><span>Options</span><b>{options.length ? options.join(", ") : "None yet"}</b></div>
                                    </div>
                                    <p className="small muted">Anything you skipped can be added later from Settings.</p>
                                    <div className="wizard-nav">
                                        <button className="btn btn-secondary" disabled={busy} onClick={() => setStep(3)}>Back</button>
                                        <button className="btn btn-primary" disabled={busy} onClick={finishSetup}>
                                            {busy ? "Finishing…" : "Open my dashboard"}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Firebase invisible reCAPTCHA mounts here. Must stay in the
                        DOM for every state, or a resend after a screen change
                        would find its container gone. */}
                    <div id="recaptcha-container" />
                </div>
            </div>
        </div>
    );
}

/** A bare 10-digit number typed into a generic box is a phone; anything else isn't. */
function fgIdentifier(id) {
    const digits = id.replace(/\D/g, "");
    return !id.includes("@") && digits.length === 10 ? withCountryCode(digits) : id;
}
