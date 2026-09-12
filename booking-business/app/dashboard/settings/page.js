"use client";
// app/dashboard/settings/page.js — business configuration, laid out the way the
// Chefo owner dashboard does it.
//
// TWO MODES. "Setup overview" scores how complete the configuration is and
// points at what to fix next; "Manage settings" is every control, grouped in
// anchored sections. Jumping from a suggestion scrolls to its section.
//
// THE SAVE PATTERN. There is no whole-form submit. Every field group has its
// own button whose label ends in an ellipsis, because pressing it does not
// save — it opens the confirmation drawer with a plain-English statement of
// what will happen, and only the drawer's action button mutates anything.
import { useCallback, useEffect, useMemo, useState } from "react";
import { get, patch, post, put, del } from "@/lib/api";
import { useAccess } from "../layout";
import { useToast } from "@/components/ToastProvider";
import { formatTime, fmtDate, prettyPhone } from "@/lib/format";
import { Field, Input, Select, Textarea, Check } from "@/components/Field";
import Drawer from "@/components/Drawer";
import ClockTimeInput from "@/components/ClockTimeInput";
import Empty from "@/components/Empty";
import { SkeletonTiles, SkeletonCards } from "@/components/Skeleton";

const RAILS = ["rail-breakfast", "rail-lunch", "rail-dinner"];
const railFor = (m, i) => {
    const k = String(m.key || m.name || "").toLowerCase();
    if (k.includes("break")) return "rail-breakfast";
    if (k.includes("lunch")) return "rail-lunch";
    if (k.includes("dinner")) return "rail-dinner";
    return RAILS[i % RAILS.length];
};

/* ------------------------------------------------------------------ */
/* SETUP SCORE                                                          */
/* ------------------------------------------------------------------ */
function scoreSetup({ business, mealTypes, variants, user }) {
    const sections = [];
    const add = (key, name, max, pts, why, peek, sug) => sections.push({ key, name, max, pts: Math.min(max, pts), why, peek, sug });

    const active = mealTypes.filter((m) => m.active);
    const withCutoff = active.filter((m) => m.cutoffTime);
    {
        let pts = 0; const sug = [];
        if (active.length) pts += 15;
        if (withCutoff.length === active.length && active.length) pts += 10;
        if (active.every((m) => m.startTime && m.endTime) && active.length) pts += 5;
        if (!active.length) sug.push({ text: "Add the meal services you run — breakfast, lunch, anything.", gain: 30, anchor: "services" });
        else {
            active.filter((m) => !m.cutoffTime).forEach((m) => sug.push({ text: `Set a booking cutoff for ${m.name} so late bookings come to you for approval.`, gain: 10, anchor: "services" }));
            if (!active.every((m) => m.startTime && m.endTime)) sug.push({ text: "Add serving times so customers know when each meal is served.", gain: 5, anchor: "services" });
        }
        add("services", "Meal services & cutoffs", 30, pts,
            "Every booking is for one service, and the cutoff is what decides whether it confirms itself or waits for you.",
            active.length ? active.map((m) => `${m.name}${m.cutoffTime ? ` · till ${formatTime(m.cutoffTime)}` : " · no cutoff"}`).join(", ") : "None yet", sug);
    }
    {
        const on = variants.filter((v) => v.active);
        let pts = 0; const sug = [];
        if (on.length >= 1) pts += 12;
        if (on.length >= 2) pts += 8;
        if (!on.length) sug.push({ text: "Add at least one meal option — Veg, Non-Veg, Jain — for customers to book against.", gain: 12, anchor: "options" });
        else if (on.length === 1) sug.push({ text: "Add a second option so a booking can be split (Veg 7 + Non-Veg 8).", gain: 8, anchor: "options" });
        add("options", "Meal options", 20, pts, "What a booking's quantity is split across. The kitchen cooks per option, not per plate.",
            on.length ? on.map((v) => v.name).join(", ") : "None yet", sug);
    }
    {
        let pts = 0; const sug = [];
        if (business.name) pts += 5;
        if (business.contactPhone) pts += 5;
        if (business.city || business.addressLine) pts += 5;
        if (business.acceptingBookings !== false) pts += 5;
        if (!business.contactPhone) sug.push({ text: "Add a contact phone — it's shown on your booking page.", gain: 5, anchor: "profile" });
        if (!business.city && !business.addressLine) sug.push({ text: "Add your address or city so customers know where the food comes from.", gain: 5, anchor: "profile" });
        if (business.acceptingBookings === false) sug.push({ text: "Bookings are switched off — customers can't book right now.", gain: 5, anchor: "profile" });
        add("profile", "Business profile", 20, pts, "What customers see on your booking page.",
            [business.name, business.city].filter(Boolean).join(" · ") || "—", sug);
    }
    {
        const r = business.rules || {};
        let pts = 5; const sug = [];
        if (r.maxDaysAhead !== undefined) pts += 5;
        add("rules", "Booking rules", 10, pts, "How far ahead customers may book, and what they may change on their own.",
            `Up to ${r.maxDaysAhead ?? 14} days ahead · max ${r.maxQuantityPerBooking ?? 500} meals`, sug);
    }
    {
        const types = (business.partyTypes || []).filter((p) => p.active);
        add("parties", "Customer types", 5, types.length ? 5 : 0, "Individual, group, corporate — how bookings are categorised.",
            types.map((p) => p.label).join(", ") || "None",
            types.length ? [] : [{ text: "Keep at least one customer type active.", gain: 5, anchor: "parties" }]);
    }
    {
        const ok = Boolean(user.email);
        add("notifications", "Email notifications", 5, ok ? 5 : 0, "Formal notices when access, settings or data change.",
            ok ? `Delivered to ${user.email}` : "No email on the account",
            ok ? [] : [{ text: "Add an email so activity notices can reach you.", gain: 5, anchor: "account" }]);
    }
    {
        let pts = 0; const sug = [];
        if (user.phone) pts += 5;
        if (user.email) pts += 5;
        if (user.loginId && user.passwordSet) pts += 5;
        if (!user.email) sug.push({ text: "Add an email so you can recover a forgotten password.", gain: 5, anchor: "account" });
        if (!user.loginId || !user.passwordSet) {
            sug.push({ text: "Set a login ID and password as a backup way in, for when you don't have your phone.", gain: 5, anchor: "account" });
        }
        add("account", "Account & identity", 15, pts, "How you sign in, and where password-reset codes go.",
            [user.phone && prettyPhone(user.phone), user.email, user.loginId].filter(Boolean).join(" · ") || "—", sug);
    }

    const total = sections.reduce((n, s) => n + s.pts, 0);
    const max = sections.reduce((n, s) => n + s.max, 0);
    return { sections, pct: Math.round((total / max) * 100) };
}

const tierOf = (pct) =>
    pct >= 90 ? { label: "Excellent", color: "var(--basil)", text: "Everything a customer needs is in place. Keep it current." }
        : pct >= 70 ? { label: "Strong", color: "var(--basil)", text: "Bookings work end to end. A few details would make it smoother." }
            : pct >= 40 ? { label: "Getting there", color: "var(--turmeric)", text: "The basics exist, but customers will hit gaps. Fix the items below." }
                : { label: "Incomplete", color: "var(--brick)", text: "Customers can't book properly yet. Start with meal services." };

/* ------------------------------------------------------------------ */
/* PAGE                                                                 */
/* ------------------------------------------------------------------ */
export default function SettingsPage() {
    const access = useAccess();
    const toast = useToast();
    const [mode, setMode] = useState("overview");
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [confirm, setConfirm] = useState(null); // { title, body, label, danger, action }
    const [busy, setBusy] = useState(false);

    const canEdit = access.can("config.edit");

    const load = useCallback(async () => {
        try {
            setConfig(await get("/api/config"));
            await access.reload?.();
        } catch (e) { toast("error", "Couldn't load settings", e.message); }
        finally { setLoading(false); }
    }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { load(); }, [load]);

    // The one drawer every section shares. `after` lets a section skip the
    // full reload (e.g. a password change that just needs a toast).
    const runConfirmed = (fn, title, msg, after) => async () => {
        setBusy(true);
        try {
            await fn();
            toast("success", title, msg);
            setConfirm(null);
            if (after) await after(); else await load();
        } catch (e) {
            toast("error", "Couldn't save", e.message);
        } finally { setBusy(false); }
    };
    const ask = (cfg) => setConfirm(cfg);

    const jumpTo = (anchor) => {
        setMode("manage");
        setTimeout(() => document.getElementById(`sec-${anchor}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    };

    const score = useMemo(
        () => (config ? scoreSetup({ business: config.business, mealTypes: config.mealTypes, variants: config.variants, user: access.user }) : null),
        [config, access.user]
    );

    if (loading || !config) {
        return (
            <div>
                <div className="page-head"><div><h1 className="page-title">Settings</h1></div></div>
                <SkeletonTiles count={3} /><SkeletonCards count={2} />
            </div>
        );
    }

    const b = config.business;

    return (
        <div>
            <div className="page-head">
                <div>
                    <h1 className="page-title">Settings</h1>
                    <p className="page-sub">{b.name} · member since {fmtDate(b.createdAt)}</p>
                </div>
                <button className="btn btn-secondary" onClick={() => setMode(mode === "overview" ? "manage" : "overview")}>
                    {mode === "overview" ? "Manage settings" : "← Setup overview"}
                </button>
            </div>

            {mode === "overview"
                ? <Overview score={score} jumpTo={jumpTo} />
                : (
                    <div className="stack" style={{ gap: 16 }}>
                        <AccountSection user={access.user} canEdit ask={ask} run={runConfirmed} />
                        <ProfileSection business={b} canEdit={canEdit} ask={ask} run={runConfirmed} />
                        <ServicesSection mealTypes={config.mealTypes} canEdit={canEdit} ask={ask} run={runConfirmed} />
                        <OptionsSection variants={config.variants} mealTypes={config.mealTypes} canEdit={canEdit} ask={ask} run={runConfirmed} />
                        <RulesSection business={b} canEdit={canEdit} ask={ask} run={runConfirmed} />
                        <PartyTypesSection business={b} canEdit={canEdit} ask={ask} run={runConfirmed} />
                        <NotificationsSection user={access.user} ask={ask} run={runConfirmed} />
                    </div>
                )}

            <Drawer open={Boolean(confirm)} onClose={() => !busy && setConfirm(null)} title={confirm?.title || ""}
                footer={
                    <>
                        <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm(null)}>Go back</button>
                        <button className={`btn ${confirm?.danger ? "btn-danger" : "btn-primary"}`} disabled={busy} onClick={confirm?.action}>
                            {busy ? "Working…" : confirm?.label}
                        </button>
                    </>
                }>
                <p style={{ marginTop: 0, lineHeight: 1.6 }}>{confirm?.body}</p>
            </Drawer>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* OVERVIEW                                                             */
/* ------------------------------------------------------------------ */
function Overview({ score, jumpTo }) {
    const tier = tierOf(score.pct);
    const suggestions = score.sections.flatMap((s) => s.sug).sort((a, b) => b.gain - a.gain).slice(0, 6);
    const badgeFor = (s) => (s.pts === 0 ? ["badge-red", "Missing"] : s.pts < s.max * 0.6 ? ["badge-red", "Weak"] : s.pts < s.max ? ["badge-amber", "Good"] : ["badge-green", "Strong"]);

    return (
        <div className="stack" style={{ gap: 16 }}>
            <div className="card card-pad score-hero">
                <div className="score-ring" style={{ "--pct": score.pct, "--ring": tier.color }}>
                    <div className="inner">{score.pct}<small>/ 100</small></div>
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                    <div className="row" style={{ gap: 10, marginBottom: 4 }}>
                        <h2 style={{ fontSize: 18 }}>Setup score</h2>
                        <span className="badge" style={{ background: "var(--paper)", color: tier.color, border: "1px solid var(--border)" }}>{tier.label}</span>
                    </div>
                    <p className="small muted">{tier.text}</p>
                </div>
            </div>

            <div className="sec-grid">
                {score.sections.map((s) => {
                    const [cls, label] = badgeFor(s);
                    return (
                        <div key={s.key} className="sec-card">
                            <div className="row-between">
                                <strong style={{ fontSize: 14 }}>{s.name}</strong>
                                <span className={`badge ${cls}`}>{label}</span>
                            </div>
                            <div className="sec-bar"><i style={{ width: `${(s.pts / s.max) * 100}%` }} /></div>
                            <p className="xsmall faint">{s.why}</p>
                            <p className="small" style={{ color: "var(--ink)" }}>{s.peek}</p>
                            <button className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => jumpTo(s.key)}>Edit {s.name.toLowerCase()}</button>
                        </div>
                    );
                })}
            </div>

            <div className="card card-pad">
                <strong>What to fix next</strong>
                {!suggestions.length ? (
                    <p className="small muted" style={{ marginTop: 6 }}>Nothing outstanding — your setup is complete.</p>
                ) : (
                    <div style={{ marginTop: 6 }}>
                        {suggestions.map((s, i) => (
                            <div key={i} className="sug-row">
                                <span className="sug-gain">+{s.gain} pts</span>
                                <span className="small grow">{s.text}</span>
                                <button className="btn btn-ghost btn-sm" onClick={() => jumpTo(s.anchor)}>Fix →</button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* ACCOUNT & IDENTITY                                                   */
/* ------------------------------------------------------------------ */
function AccountSection({ user, ask, run }) {
    const [f, setF] = useState({ name: user.name || "", email: user.email || "", loginId: user.loginId || "" });
    const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
    const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

    // An account created by mobile OTP has no password anybody chose, so there
    // is nothing to ask for as "current" — see the backend's change-password.
    const hasPassword = user.passwordSet !== false;

    const confirmDetails = () => ask({
        title: "Save account details?",
        body: "Your email is where password-reset codes go, and a login ID is the backup way to sign in when you don't have your phone. Both must be unique across Chefo Booking.",
        label: "Save details",
        action: run(() => patch("/api/auth/profile", {
            name: f.name, email: f.email, loginId: f.loginId,
        }), "Details saved", "Your sign-in details are updated."),
    });

    const confirmPassword = () => {
        if (pw.next.length < 8 || pw.next !== pw.confirm) return;
        ask({
            title: hasPassword ? "Change your password?" : "Set a sign-in password?",
            body: hasPassword
                ? "Every other device signed into this account is signed out immediately. This one stays signed in."
                : "You'll be able to sign in with your login ID and this password, as well as with a code to your mobile. Any other device signed into this account is signed out.",
            label: hasPassword ? "Update password" : "Set password",
            action: run(
                () => post("/api/auth/change-password", { currentPassword: pw.current, newPassword: pw.next }),
                hasPassword ? "Password changed" : "Password set",
                "Other sessions have been signed out.",
                async () => setPw({ current: "", next: "", confirm: "" })
            ),
        });
    };

    return (
        <section id="sec-account" className="card card-pad sec-anchor">
            <h2 style={{ fontSize: 16 }}>Account &amp; identity</h2>
            <p className="why">How you sign in, and where password-reset codes go.</p>

            <div className="banner banner-info" style={{ marginBottom: 14 }}>
                <div className="row wrap" style={{ gap: 8 }}>
                    <strong className="small">Mobile number</strong>
                    <span className="mono small">{prettyPhone(user.phone) || "—"}</span>
                    <span className="badge badge-green">Verified</span>
                </div>
                <p className="xsmall" style={{ marginTop: 5 }}>
                    Your number is your sign-in — we text a 6-digit code to it. Changing it needs a fresh
                    verification, so contact support if you&apos;ve moved to a new number.
                </p>
            </div>

            <Field label="Your name"><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <div className="grid grid-2">
                <Field label="Email" hint={user.isOwner ? "Required for the owner — reset codes go here." : "Reset codes go here."}>
                    <Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
                </Field>
                <Field label="Login ID" hint="Optional — 3–32 characters: letters, numbers, dots, underscores, hyphens.">
                    <Input placeholder="e.g. kitchen-a" value={f.loginId} onChange={(e) => set("loginId", e.target.value.toLowerCase())} maxLength={32} />
                </Field>
            </div>
            <button className="btn btn-primary" onClick={confirmDetails} disabled={!f.name.trim()}>Save account details…</button>

            <hr className="divider" />
            <strong style={{ fontSize: 14 }}>{hasPassword ? "Change password" : "Set a sign-in password"}</strong>
            <p className="small muted" style={{ margin: "2px 0 12px" }}>
                {hasPassword
                    ? "Forgot it? Sign out and use “Forgot password” — a 4-digit code is emailed to you."
                    : "Optional. Pair it with a login ID above and you can sign in without waiting for an SMS."}
            </p>
            <div className={hasPassword ? "grid grid-3" : "grid grid-2"}>
                {hasPassword && (
                    <Field label="Current password">
                        <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} />
                    </Field>
                )}
                <Field label={hasPassword ? "New password" : "Password"} hint="At least 8 characters.">
                    <Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} />
                </Field>
                <Field label="Confirm password">
                    <Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} />
                </Field>
            </div>
            {pw.next && pw.confirm && pw.next !== pw.confirm && (
                <p className="xsmall" style={{ color: "var(--brick)", marginBottom: 8 }}>Those two don&apos;t match.</p>
            )}
            <button className="btn btn-secondary" onClick={confirmPassword}
                disabled={(hasPassword && !pw.current) || pw.next.length < 8 || pw.next !== pw.confirm}>
                {hasPassword ? "Update password…" : "Set password…"}
            </button>
        </section>
    );
}

/* ------------------------------------------------------------------ */
/* BUSINESS PROFILE                                                     */
/* ------------------------------------------------------------------ */
function ProfileSection({ business, canEdit, ask, run }) {
    const [p, setP] = useState({
        name: business.name || "", contactPhone: business.contactPhone || "", contactEmail: business.contactEmail || "",
        addressLine: business.addressLine || "", city: business.city || "", landmark: business.landmark || "",
        acceptingBookings: business.acceptingBookings !== false, closedMessage: business.closedMessage || "",
    });
    const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
    const customerUrl = `${process.env.NEXT_PUBLIC_CUSTOMER_URL || "http://localhost:4003"}/b/${business.slug}`;

    const confirmSave = () => ask({
        title: "Save business profile?",
        body: p.acceptingBookings
            ? "Customers see these details on your booking page from their next visit."
            : "Bookings will be switched OFF: customers see your closed message instead of the booking form. Existing bookings are unaffected.",
        label: "Save profile",
        danger: !p.acceptingBookings && business.acceptingBookings !== false,
        action: run(() => patch("/api/config/business", p), "Profile saved", "Your booking page is up to date."),
    });

    return (
        <section id="sec-profile" className="card card-pad sec-anchor">
            <h2 style={{ fontSize: 16 }}>Business profile</h2>
            <p className="why">What customers see on your booking page.</p>

            <div className="banner banner-info" style={{ marginBottom: 14 }}>
                <div className="small" style={{ marginBottom: 4 }}>Your booking page — share this link with customers</div>
                <a className="mono small" href={customerUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline", wordBreak: "break-all" }}>{customerUrl}</a>
            </div>

            <Field label="Business name"><Input value={p.name} disabled={!canEdit} onChange={(e) => set("name", e.target.value)} /></Field>
            <div className="grid grid-2">
                <Field label="Contact phone"><Input value={p.contactPhone} disabled={!canEdit} onChange={(e) => set("contactPhone", e.target.value)} /></Field>
                <Field label="Contact email"><Input type="email" value={p.contactEmail} disabled={!canEdit} onChange={(e) => set("contactEmail", e.target.value)} /></Field>
            </div>
            <Field label="Address"><Input value={p.addressLine} disabled={!canEdit} onChange={(e) => set("addressLine", e.target.value)} /></Field>
            <div className="grid grid-2">
                <Field label="City"><Input value={p.city} disabled={!canEdit} onChange={(e) => set("city", e.target.value)} /></Field>
                <Field label="Landmark"><Input value={p.landmark} disabled={!canEdit} onChange={(e) => set("landmark", e.target.value)} /></Field>
            </div>
            <div style={{ marginBottom: 14 }}>
                <Check label="Accepting new bookings" disabled={!canEdit} checked={p.acceptingBookings} onChange={(e) => set("acceptingBookings", e.target.checked)} />
            </div>
            {!p.acceptingBookings && (
                <Field label="Message shown to customers" hint="Existing bookings are unaffected — this only stops new ones.">
                    <Textarea rows={2} value={p.closedMessage} disabled={!canEdit} onChange={(e) => set("closedMessage", e.target.value)} placeholder="e.g. Closed for Diwali — back on Monday." />
                </Field>
            )}
            {canEdit && <button className="btn btn-primary" onClick={confirmSave} disabled={!p.name.trim()}>Save profile…</button>}
        </section>
    );
}

/* ------------------------------------------------------------------ */
/* MEAL SERVICES & CUTOFFS                                              */
/* ------------------------------------------------------------------ */
const emptyService = () => ({ name: "", startTime: "", endTime: "", cutoffTime: "", cutoffPreviousDay: false, active: true, customerBookable: true });

function ServicesSection({ mealTypes, canEdit, ask, run }) {
    const [editing, setEditing] = useState(null); // drawer form: new or existing

    const save = (form) => {
        const body = {
            name: form.name, startTime: form.startTime, endTime: form.endTime, cutoffTime: form.cutoffTime,
            cutoffPreviousDay: form.cutoffPreviousDay, active: form.active, customerBookable: form.customerBookable,
        };
        const isNew = !form._id;
        ask({
            title: isNew ? `Add ${form.name}?` : `Save ${form.name}?`,
            body: form.cutoffTime
                ? `Bookings for ${form.name} confirm automatically until ${formatTime(form.cutoffTime)}${form.cutoffPreviousDay ? " the day before" : ""}. After that, every new booking, change or cancellation comes to you for approval.`
                : `${form.name} has NO cutoff — it never closes, and every booking confirms itself without your approval.`,
            label: isNew ? "Add meal service" : "Save changes",
            action: run(
                () => (isNew ? post("/api/config/meal-types", body) : patch(`/api/config/meal-types/${form._id}`, body)),
                "Saved", `${form.name} is set up.`,
                null
            ),
        });
        setEditing(null);
    };

    const deactivate = (m) => ask({
        title: `Deactivate ${m.name}?`,
        danger: true,
        body: `Customers can no longer book ${m.name}. Existing bookings are kept and still count toward preparation. You can reactivate it any time.`,
        label: "Deactivate",
        action: run(() => del(`/api/config/meal-types/${m._id}`), "Deactivated", `${m.name} has left the booking form.`),
    });

    const reactivate = (m) => ask({
        title: `Reactivate ${m.name}?`,
        body: `${m.name} returns to the booking form with its saved cutoff${m.cutoffTime ? ` (${formatTime(m.cutoffTime)})` : " (none)"}.`,
        label: "Reactivate",
        action: run(() => patch(`/api/config/meal-types/${m._id}`, { active: true }), "Reactivated", `${m.name} is bookable again.`),
    });

    return (
        <section id="sec-services" className="card card-pad sec-anchor">
            <div className="row-between wrap" style={{ marginBottom: 2 }}>
                <h2 style={{ fontSize: 16 }}>Meal services & booking cutoffs</h2>
                {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing(emptyService())}>+ Add meal service</button>}
            </div>
            <p className="why">Each service has its own cutoff. Before it, bookings confirm automatically; after it, they wait for your approval. That rule itself isn&apos;t configurable — the time is.</p>

            {!mealTypes.length ? (
                <Empty title="No meal services yet" note="Add the meals this business serves — breakfast, lunch, a night-shift meal, anything." icon="menu"
                    action={canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing(emptyService())}>Add your first meal service</button>} />
            ) : (
                <div className="grid grid-2">
                    {mealTypes.map((m, i) => (
                        <div key={m._id} className={`card card-pad rail ${railFor(m, i)}`} style={{ padding: 16, opacity: m.active ? 1 : 0.7 }}>
                            <div className="row-between" style={{ marginBottom: 8 }}>
                                <strong style={{ fontFamily: "var(--font-display)", fontSize: 15 }}>{m.name}</strong>
                                <div className="row" style={{ gap: 5 }}>
                                    <span className={`badge ${m.active ? "badge-green" : "badge-gray"}`}>{m.active ? "Active" : "Inactive"}</span>
                                    {m.active && !m.customerBookable && <span className="badge badge-amber">Counter only</span>}
                                </div>
                            </div>
                            <div className="stack-sm small">
                                <div className="row-between"><span className="muted">Served</span><span>{m.startTime && m.endTime ? `${formatTime(m.startTime)} – ${formatTime(m.endTime)}` : "—"}</span></div>
                                <div className="row-between">
                                    <span className="muted">Booking cutoff</span>
                                    {m.cutoffTime
                                        ? <span>{formatTime(m.cutoffTime)}{m.cutoffPreviousDay && <span className="xsmall faint"> (day before)</span>}</span>
                                        : <span className="badge badge-blue">No cutoff</span>}
                                </div>
                            </div>
                            {canEdit && (
                                <div className="row" style={{ marginTop: 12, gap: 6 }}>
                                    <button className="btn btn-secondary btn-sm" onClick={() => setEditing({ ...m })}>Edit</button>
                                    {m.active
                                        ? <button className="btn btn-ghost btn-sm" onClick={() => deactivate(m)}>Deactivate…</button>
                                        : <button className="btn btn-ghost btn-sm" onClick={() => reactivate(m)}>Reactivate…</button>}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <Drawer open={Boolean(editing)} onClose={() => setEditing(null)}
                title={editing?._id ? `Edit ${editing.name}` : "New meal service"}
                footer={editing && (
                    <>
                        <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                        <button className="btn btn-primary" disabled={!editing.name.trim()} onClick={() => save(editing)}>
                            {editing._id ? "Save…" : "Add…"}
                        </button>
                    </>
                )}>
                {editing && <ServiceForm f={editing} set={(k, v) => setEditing((p) => ({ ...p, [k]: v }))} />}
            </Drawer>
        </section>
    );
}

function ServiceForm({ f, set }) {
    return (
        <div>
            <Field label="Name" hint="Whatever this business calls it — Lunch, Snacks, Night shift meal.">
                <Input value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus maxLength={60} />
            </Field>
            <div className="grid grid-2" style={{ marginBottom: 14 }}>
                <Field label="Served from"><ClockTimeInput value={f.startTime} onChange={(v) => set("startTime", v)} clearable placeholder="Not set" ariaLabel="Served from" /></Field>
                <Field label="Served until"><ClockTimeInput value={f.endTime} onChange={(v) => set("endTime", v)} clearable placeholder="Not set" ariaLabel="Served until" /></Field>
            </div>
            <Field label="Booking cutoff" hint="Clear it and this meal never closes — every booking confirms automatically.">
                <ClockTimeInput value={f.cutoffTime} onChange={(v) => set("cutoffTime", v)} clearable placeholder="No cutoff" ariaLabel="Booking cutoff" />
            </Field>
            {f.cutoffTime && (
                <div style={{ marginBottom: 14 }}>
                    <Check label="Cutoff falls on the day before" checked={Boolean(f.cutoffPreviousDay)} onChange={(e) => set("cutoffPreviousDay", e.target.checked)} />
                    <p className="xsmall faint" style={{ marginTop: 4, marginLeft: 26 }}>For a kitchen that shops or preps the night before — tomorrow&apos;s breakfast closes this evening.</p>
                </div>
            )}
            <div className="stack-sm">
                <Check label="Active" checked={Boolean(f.active)} onChange={(e) => set("active", e.target.checked)} />
                <Check label="Customers can book this online" checked={Boolean(f.customerBookable)} onChange={(e) => set("customerBookable", e.target.checked)} />
                <p className="xsmall faint" style={{ marginLeft: 26 }}>Untick to keep it open only for bookings you enter at the counter.</p>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* MEAL OPTIONS                                                         */
/* ------------------------------------------------------------------ */
function OptionsSection({ variants, mealTypes, canEdit, ask, run }) {
    const [editing, setEditing] = useState(null);
    const activeMeals = mealTypes.filter((m) => m.active);

    const save = (form) => {
        const body = {
            name: form.name, description: form.description, price: Number(form.price) || 0, active: form.active,
            mealTypeIds: form.mealTypeIds || [],
        };
        const isNew = !form._id;
        const scope = body.mealTypeIds.length
            ? `Offered only for ${mealTypes.filter((m) => body.mealTypeIds.some((id) => String(id) === String(m._id))).map((m) => m.name).join(", ")}.`
            : "Offered for every meal service.";
        ask({
            title: isNew ? `Add ${form.name}?` : `Save ${form.name}?`,
            body: `${scope} ${body.price ? `Priced at ₹${body.price} per meal.` : "No price recorded."} Existing bookings keep the name they were made with.`,
            label: isNew ? "Add option" : "Save changes",
            action: run(
                () => (isNew ? post("/api/config/variants", body) : patch(`/api/config/variants/${form._id}`, body)),
                "Saved", `${form.name} is available.`
            ),
        });
        setEditing(null);
    };

    const deactivate = (v) => ask({
        title: `Deactivate ${v.name}?`, danger: true,
        body: `${v.name} leaves the booking form. Existing bookings keep it and it still counts toward those days' preparation.`,
        label: "Deactivate",
        action: run(() => del(`/api/config/variants/${v._id}`), "Deactivated", `${v.name} has left the booking form.`),
    });
    const reactivate = (v) => ask({
        title: `Reactivate ${v.name}?`, body: `${v.name} returns to the booking form.`, label: "Reactivate",
        action: run(() => patch(`/api/config/variants/${v._id}`, { active: true }), "Reactivated", `${v.name} is available again.`),
    });

    return (
        <section id="sec-options" className="card card-pad sec-anchor">
            <div className="row-between wrap" style={{ marginBottom: 2 }}>
                <h2 style={{ fontSize: 16 }}>Meal options</h2>
                {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing({ name: "", description: "", price: 0, active: true, mealTypeIds: [] })}>+ Add option</button>}
            </div>
            <p className="why">What a booking&apos;s quantity is split across — Veg, Non-Veg, Jain, Thali A, whatever this business actually serves.</p>

            {!variants.length ? (
                <Empty title="No options yet" note="Add at least one — customers choose quantities against these." icon="menu" />
            ) : (
                <div className="table-wrap">
                    <table className="tbl">
                        <thead><tr><th>Name</th><th>Description</th><th>Meals</th><th className="num">Price</th><th>Status</th><th></th></tr></thead>
                        <tbody>
                            {variants.map((v) => (
                                <tr key={v._id}>
                                    <td><strong>{v.name}</strong></td>
                                    <td className="small muted">{v.description || "—"}</td>
                                    <td className="small muted">
                                        {v.mealTypeIds?.length
                                            ? mealTypes.filter((m) => v.mealTypeIds.some((id) => String(id) === String(m._id))).map((m) => m.name).join(", ")
                                            : "All"}
                                    </td>
                                    <td className="num">{v.price ? `₹${v.price}` : "—"}</td>
                                    <td><span className={`badge ${v.active ? "badge-green" : "badge-gray"}`}>{v.active ? "Active" : "Inactive"}</span></td>
                                    <td>
                                        {canEdit && (
                                            <div className="row" style={{ gap: 4 }}>
                                                <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...v, mealTypeIds: (v.mealTypeIds || []).map(String) })}>Edit</button>
                                                {v.active
                                                    ? <button className="btn btn-ghost btn-sm" onClick={() => deactivate(v)}>Deactivate…</button>
                                                    : <button className="btn btn-ghost btn-sm" onClick={() => reactivate(v)}>Reactivate…</button>}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <Drawer open={Boolean(editing)} onClose={() => setEditing(null)}
                title={editing?._id ? `Edit ${editing.name}` : "New meal option"}
                footer={editing && (
                    <>
                        <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                        <button className="btn btn-primary" disabled={!editing.name.trim()} onClick={() => save(editing)}>{editing._id ? "Save…" : "Add…"}</button>
                    </>
                )}>
                {editing && (
                    <div>
                        <Field label="Name" hint="Veg, Non-Veg, Jain, Egg, Thali A — anything.">
                            <Input value={editing.name} autoFocus maxLength={60} onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))} />
                        </Field>
                        <Field label="Description (optional)" hint="A short hint shown under the option on the booking form.">
                            <Input value={editing.description || ""} maxLength={160} onChange={(e) => setEditing((p) => ({ ...p, description: e.target.value }))} />
                        </Field>
                        <Field label="Price per meal (₹, optional)" hint="Leave at 0 unless you're recording amounts. Payment isn't handled here.">
                            <Input type="number" min="0" value={editing.price ?? 0} onChange={(e) => setEditing((p) => ({ ...p, price: e.target.value }))} />
                        </Field>
                        <Field label="Available for" hint="Untick everything to offer it on every meal service.">
                            <div className="stack-sm">
                                {activeMeals.map((m) => {
                                    const on = (editing.mealTypeIds || []).includes(String(m._id));
                                    return (
                                        <Check key={m._id} label={m.name} checked={on} onChange={(e) => setEditing((p) => ({
                                            ...p,
                                            mealTypeIds: e.target.checked
                                                ? [...(p.mealTypeIds || []), String(m._id)]
                                                : (p.mealTypeIds || []).filter((id) => id !== String(m._id)),
                                        }))} />
                                    );
                                })}
                                {!activeMeals.length && <p className="xsmall faint">No active meal services yet.</p>}
                            </div>
                        </Field>
                        <Check label="Active" checked={Boolean(editing.active)} onChange={(e) => setEditing((p) => ({ ...p, active: e.target.checked }))} />
                    </div>
                )}
            </Drawer>
        </section>
    );
}

/* ------------------------------------------------------------------ */
/* BOOKING RULES                                                        */
/* ------------------------------------------------------------------ */
function RulesSection({ business, canEdit, ask, run }) {
    const [r, setR] = useState({ ...(business.rules || {}) });
    const set = (k, v) => setR((p) => ({ ...p, [k]: v }));

    const confirmSave = () => ask({
        title: "Save booking rules?",
        body: `Customers may book up to ${r.maxDaysAhead ?? 14} day(s) ahead, at most ${r.maxQuantityPerBooking ?? 500} meals per booking. ${r.allowCustomerChangeRequestAfterCutoff === false && r.allowCustomerCancelRequestAfterCutoff === false ? "After the cutoff a confirmed booking is FINAL — no requests at all." : "Requests after the cutoff still come to you for approval."}`,
        label: "Save rules",
        action: run(() => patch("/api/config/business", { rules: r }), "Rules saved", "New bookings follow these rules from now."),
    });

    return (
        <section id="sec-rules" className="card card-pad sec-anchor">
            <h2 style={{ fontSize: 16 }}>Booking rules</h2>
            <p className="why">What customers may do on their own. The cutoff behaviour itself isn&apos;t configurable — after the cutoff, changes always come to you for approval.</p>

            <div className="grid grid-2" style={{ marginBottom: 14 }}>
                <Field label="Book up to (days ahead)" hint="0 means today only.">
                    <Input type="number" min="0" max="365" value={r.maxDaysAhead ?? 14} disabled={!canEdit} onChange={(e) => set("maxDaysAhead", Number(e.target.value))} />
                </Field>
                <Field label="Max meals per booking" hint="A guard against a fat finger becoming 5,000 plates.">
                    <Input type="number" min="1" value={r.maxQuantityPerBooking ?? 500} disabled={!canEdit} onChange={(e) => set("maxQuantityPerBooking", Number(e.target.value))} />
                </Field>
            </div>

            <div className="grid grid-3" style={{ marginBottom: 14 }}>
                <div className="stack-sm">
                    <div className="num-label">Before the cutoff, customers may</div>
                    <Check label="Change their own booking" disabled={!canEdit} checked={r.allowCustomerEditBeforeCutoff !== false} onChange={(e) => set("allowCustomerEditBeforeCutoff", e.target.checked)} />
                    <Check label="Cancel their own booking" disabled={!canEdit} checked={r.allowCustomerCancelBeforeCutoff !== false} onChange={(e) => set("allowCustomerCancelBeforeCutoff", e.target.checked)} />
                </div>
                <div className="stack-sm">
                    <div className="num-label">After the cutoff, customers may ask you to</div>
                    <Check label="Change a confirmed booking" disabled={!canEdit} checked={r.allowCustomerChangeRequestAfterCutoff !== false} onChange={(e) => set("allowCustomerChangeRequestAfterCutoff", e.target.checked)} />
                    <Check label="Cancel a confirmed booking" disabled={!canEdit} checked={r.allowCustomerCancelRequestAfterCutoff !== false} onChange={(e) => set("allowCustomerCancelRequestAfterCutoff", e.target.checked)} />
                </div>
                <div className="stack-sm">
                    <div className="num-label">Ask customers for</div>
                    <Check label="Organisation / site name" disabled={!canEdit} checked={Boolean(r.requireOrganisation)} onChange={(e) => set("requireOrganisation", e.target.checked)} />
                    <Check label="Delivery location" disabled={!canEdit} checked={Boolean(r.requireLocation)} onChange={(e) => set("requireLocation", e.target.checked)} />
                    <Check label="A note" disabled={!canEdit} checked={Boolean(r.requireNote)} onChange={(e) => set("requireNote", e.target.checked)} />
                </div>
            </div>
            {canEdit && <button className="btn btn-primary" onClick={confirmSave}>Save rules…</button>}
        </section>
    );
}

/* ------------------------------------------------------------------ */
/* EMAIL NOTIFICATIONS                                                  */
/* ------------------------------------------------------------------ */
// Which activity notices reach the owner's inbox. The catalogue comes from
// the server (services/notify.js), so a new event appears here without a
// frontend change. Toggles are per event; grouped so the list reads as a
// handful of decisions rather than a wall of switches.
function NotificationsSection({ user, ask, run }) {
    const toast = useToast();
    const [cfg, setCfg] = useState(null);
    const [prefs, setPrefs] = useState({});

    useEffect(() => {
        get("/api/auth/notifications").then((r) => { setCfg(r); setPrefs(r.prefs); })
            .catch((e) => toast("error", "Couldn't load notification settings", e.message));
    }, [toast]);

    if (!cfg) return null;
    const groups = [...new Set(cfg.events.map((e) => e.group))];
    const dirty = cfg.events.some((e) => prefs[e.key] !== cfg.prefs[e.key]);
    const onCount = cfg.events.filter((e) => prefs[e.key]).length;

    const confirmSave = () => ask({
        title: "Save notification settings?",
        body: `${onCount} of ${cfg.events.length} activity notices will be emailed to ${cfg.deliversTo || "your account email"}. Switching one off means that event is still recorded in the activity log — it just isn't emailed.`,
        label: "Save settings",
        action: run(() => patch("/api/auth/notifications", { prefs: cfg.events.map((e) => ({ key: e.key, on: Boolean(prefs[e.key]) })) }),
            "Notification settings saved", `${onCount} notice${onCount === 1 ? "" : "s"} switched on.`,
            async () => { const r = await get("/api/auth/notifications"); setCfg(r); setPrefs(r.prefs); }),
    });

    return (
        <section id="sec-notifications" className="card card-pad sec-anchor">
            <h2 style={{ fontSize: 16 }}>Email notifications</h2>
            <p className="why">
                A formal notice is emailed to {cfg.deliversTo ? <strong>{cfg.deliversTo}</strong> : "your account email"} when something sensitive happens —
                who did it, when, from where, and what to do if it wasn&apos;t expected. Everything is always written to the activity log regardless.
            </p>
            {!user.isOwner && <div className="banner banner-warn" style={{ marginBottom: 14 }}>Notices are sent to business owners only. Your choices here apply if your account is made an owner.</div>}
            {!cfg.deliversTo && <div className="banner banner-warn" style={{ marginBottom: 14 }}>Your account has no email address — add one under Account &amp; identity or nothing can be delivered.</div>}

            <div className="grid grid-2" style={{ gap: 14 }}>
                {groups.map((g) => (
                    <div key={g} className="card" style={{ padding: 14, boxShadow: "none" }}>
                        <div className="num-label" style={{ marginBottom: 8 }}>{g}</div>
                        <div className="stack-sm">
                            {cfg.events.filter((e) => e.group === g).map((e) => (
                                <label key={e.key} className="notif-row">
                                    <input type="checkbox" checked={Boolean(prefs[e.key])} onChange={(ev) => setPrefs((p) => ({ ...p, [e.key]: ev.target.checked }))} />
                                    <span>
                                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{e.label}</span>
                                        <span className="xsmall faint" style={{ display: "block" }}>{e.hint}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            <div className="row" style={{ marginTop: 14, gap: 8 }}>
                <button className="btn btn-primary" onClick={confirmSave} disabled={!dirty}>Save notification settings…</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setPrefs(Object.fromEntries(cfg.events.map((e) => [e.key, true])))}>All on</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setPrefs(Object.fromEntries(cfg.events.map((e) => [e.key, e.default])))}>Defaults</button>
            </div>
            <style>{`
              .notif-row { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; padding: 6px 0; }
              .notif-row input { width: 16px; height: 16px; accent-color: var(--basil); margin-top: 3px; flex-shrink: 0; }
            `}</style>
        </section>
    );
}

/* ------------------------------------------------------------------ */
/* CUSTOMER (PARTY) TYPES                                               */
/* ------------------------------------------------------------------ */
function PartyTypesSection({ business, canEdit, ask, run }) {
    const [types, setTypes] = useState((business.partyTypes || []).map((p) => ({ ...p })));
    const [draft, setDraft] = useState({ label: "", isGroup: false });
    const update = (i, patchObj) => setTypes((t) => t.map((x, j) => (j === i ? { ...x, ...patchObj } : x)));

    const addType = () => {
        const label = draft.label.trim();
        if (!label || types.some((t) => t.label.toLowerCase() === label.toLowerCase())) return;
        setTypes((t) => [...t, { key: "", label, active: true, isGroup: draft.isGroup }]);
        setDraft({ label: "", isGroup: false });
    };

    const confirmSave = () => ask({
        title: "Save customer types?",
        body: `The booking form offers: ${types.filter((t) => t.active).map((t) => t.label).join(", ") || "nothing"}. Group types ask for an organisation or site name. Existing bookings keep the type they were made with.`,
        label: "Save customer types",
        action: run(() => put("/api/config/party-types", { partyTypes: types }), "Customer types saved", "The booking form is updated."),
    });

    return (
        <section id="sec-parties" className="card card-pad sec-anchor">
            <h2 style={{ fontSize: 16 }}>Customer types</h2>
            <p className="why">How bookings are categorised — Individual, Group / Site, Corporate, Event. Group types ask the customer for an organisation or site name.</p>

            <div className="table-wrap" style={{ marginBottom: 12 }}>
                <table className="tbl">
                    <thead><tr><th>Label</th><th>Group booking</th><th>Active</th><th></th></tr></thead>
                    <tbody>
                        {types.map((t, i) => (
                            <tr key={t.key || t.label}>
                                <td><Input value={t.label} disabled={!canEdit} maxLength={40} onChange={(e) => update(i, { label: e.target.value })} style={{ maxWidth: 240 }} /></td>
                                <td><Check label="Asks for organisation" disabled={!canEdit} checked={Boolean(t.isGroup)} onChange={(e) => update(i, { isGroup: e.target.checked })} /></td>
                                <td><Check label="Shown on form" disabled={!canEdit} checked={t.active !== false} onChange={(e) => update(i, { active: e.target.checked })} /></td>
                                <td>{canEdit && types.length > 1 && <button className="btn btn-ghost btn-sm" onClick={() => setTypes((x) => x.filter((_, j) => j !== i))}>Remove</button>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {canEdit && (
                <>
                    <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
                        <Input placeholder="New type — e.g. Corporate" value={draft.label} style={{ maxWidth: 240 }}
                            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addType(); } }} />
                        <Check label="Group booking" checked={draft.isGroup} onChange={(e) => setDraft((d) => ({ ...d, isGroup: e.target.checked }))} />
                        <button className="btn btn-secondary btn-sm" onClick={addType} disabled={!draft.label.trim()}>+ Add type</button>
                    </div>
                    <button className="btn btn-primary" onClick={confirmSave} disabled={!types.some((t) => t.active !== false && t.label.trim())}>Save customer types…</button>
                </>
            )}
        </section>
    );
}
