"use client";
// The counter screen — point the camera at a customer's QR, hand over the meal.
//
// Two rules shape everything here. First, the camera never starts on its own:
// a browser asks for permission exactly once, and a page that grabs the camera
// before the operator has asked it to is how a device ends up permanently
// blocked. So it starts on a press, and every way that press can fail gets a
// sentence of plain guidance instead of an error object.
//
// Second, the camera is never the only way in. Counters have cracked lenses,
// dead torches and customers reading a reference off a screenshot, so the typed
// box beside it does the same job and is always live. A scanner that stops the
// queue when the glass breaks is not a scanner, it is a liability.
//
// Marking a meal served is one-way in practice — the food is gone — so it is
// confirm-first: the button only opens the drawer, and only the drawer posts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { get, post } from "@/lib/api";
import { useAccess } from "../layout";
import { useToast } from "@/components/ToastProvider";
import {
    formatDate, formatTime, fmtDateTime, prettyPhone, timeAgo,
    servedSummary, answerText, STATUS_LABEL, REQUEST_TYPE_LABEL,
} from "@/lib/format";
import Drawer from "@/components/Drawer";
import Empty from "@/components/Empty";
import StatusBadge, { ServedBadge } from "@/components/StatusBadge";
import { Field, Input, Textarea } from "@/components/Field";
import Spinner from "@/components/Spinner";
import { OutletIcon } from "@/components/OutletSelector";
import { OutletTag } from "@/components/OutletScopeLine";
import {
    unlock as unlockFeedback, scanCaptured, scanFound, scanMiss, servedOk,
    soundOn, setSoundOn,
} from "@/lib/scanFeedback";

// html5-qrcode writes the <video> into this element by id, so it has to exist
// in the DOM before start() is called — it stays mounted and gets covered by an
// overlay when idle, rather than being conditionally rendered.
const CAM_ID = "scan-camera";

/* ------------------------------------------------------------------ */
/* PAYLOAD PARSING                                                      */
/* ------------------------------------------------------------------ */
// The QR encodes <customer app>/t/<ticket>, but an operator will paste whatever
// is actually in front of them: that whole URL, the bare ticket out of it, or
// the BK- reference printed on the confirmation. All three have to land
// somewhere, so the shape is decided here once and the caller just routes.
function parseScanned(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;

    // A ticket is base64url — it can never contain a slash — so anything with
    // one is a URL (with or without its scheme) and only the last segment counts.
    let token = s;
    if (s.includes("/")) {
        const parts = s.split(/[?#]/)[0].split("/").filter(Boolean);
        token = parts[parts.length - 1] || "";
    }
    token = token.trim();
    if (!token) return null;

    if (/^BK-/i.test(token)) return { kind: "reference", value: token.toUpperCase() };
    return { kind: "ticket", value: token };
}

// Browser camera failures arrive as DOMExceptions whose name is the only useful
// part. Each one has a different fix, and telling an operator the wrong fix
// costs more than saying nothing.
function cameraTrouble(err) {
    const signal = `${err?.name || ""} ${err?.message || err || ""}`;
    if (/NotAllowed|Permission|denied|dismissed/i.test(signal)) {
        return {
            title: "The camera is blocked for this site",
            body: "The browser is refusing on this page's behalf, so no button here can undo it. Open the padlock (or camera icon) in the address bar, set Camera to Allow, then reload. Meanwhile the Type or paste box still works.",
        };
    }
    if (/NotFound|Overconstrained|DevicesNotFound|no camera/i.test(signal)) {
        return {
            title: "No camera on this device",
            body: "Nothing usable was reported back. If this is a desktop with a webcam plugged in, reconnect it and reload. Otherwise use the Type or paste box, or run this page on a phone.",
        };
    }
    if (/NotReadable|TrackStart|Aborted|AbortError|in use/i.test(signal)) {
        return {
            title: "Something else is holding the camera",
            body: "Another app or another browser tab already has it open. Close that one, then press Start camera again.",
        };
    }
    return {
        title: "The camera wouldn't start",
        body: `${err?.message || "The browser gave no reason."} Try again, or use the Type or paste box.`,
    };
}

/* ------------------------------------------------------------------ */
export default function ScanPage() {
    const access = useAccess();
    const toast = useToast();

    const camRef = useRef(null);        // the live Html5Qrcode instance, if any
    const decodingRef = useRef(false);  // the decode callback fires every frame
    const handlerRef = useRef(() => {}); // always the CURRENT decode handler

    const [starting, setStarting] = useState(false);
    const [running, setRunning] = useState(false);
    const [camError, setCamError] = useState(null);

    const [typed, setTyped] = useState("");
    const [phase, setPhase] = useState("idle"); // idle | looking | found | missing | many | wrong-outlet
    const [wrongOutlet, setWrongOutlet] = useState("");

    /* WHERE THIS COUNTER IS. The top bar's outlet is sent with every lookup
       and every serve as `outletId`. The server treats it as a claim that can
       only NARROW: the staff member's real scope comes from their own record,
       and a ticket for another outlet is refused whatever this says. For a
       scanner assigned to one outlet the selector is pinned, so the context
       is automatic. */
    const scanOutlet = access.outlet;
    const scanQs = scanOutlet ? `?outletId=${encodeURIComponent(scanOutlet)}` : "";
    const [lookedUp, setLookedUp] = useState("");
    const [data, setData] = useState(null);
    const [choices, setChoices] = useState([]);

    // Read from localStorage after mount — the server render cannot know it,
    // and guessing would flip the icon on hydration.
    const [sound, setSound] = useState(true);
    useEffect(() => { setSound(soundOn()); }, []);

    const [confirm, setConfirm] = useState(null); // { title, body, label, danger, action }
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);

    /* -------------------------------------------------- camera */
    // html5-qrcode's stop() THROWS SYNCHRONOUSLY while the camera is still
    // opening ("Cannot stop, scanner is not running or paused") — it only
    // counts as running once the first frame has rendered. So a stop must be
    // wrapped, never chained off a promise that does not exist, and the
    // instance must not be dropped until the teardown has actually happened.
    // Otherwise the MediaStream outlives every reference to it and the camera
    // light stays on with nothing left in the UI that can turn it off.
    const teardown = useCallback(async (cam) => {
        if (!cam) return;
        try {
            await cam.stop();
        } catch { /* never started, or already stopped — nothing to release */ }
        try { cam.clear(); } catch { /* the container is already gone */ }
    }, []);

    // Set while start() is in flight so a stop requested mid-start is honoured
    // the moment the camera finishes opening, instead of being lost.
    const stopWantedRef = useRef(false);

    const stopCamera = useCallback(async () => {
        stopWantedRef.current = true;
        const cam = camRef.current;
        setRunning(false);
        if (!cam) return;
        await teardown(cam);
        // Only now is it safe to forget the instance.
        if (camRef.current === cam) camRef.current = null;
    }, [teardown]);

    // Leaving the page with the camera light still on is alarming and, on a
    // shared counter tablet, reads as the dashboard spying on the room.
    useEffect(() => () => {
        stopWantedRef.current = true;
        const cam = camRef.current;
        camRef.current = null;
        // Fire-and-forget, but the synchronous throw is swallowed INSIDE
        // teardown — a .catch() on the outside would never see it and the
        // exception would escape the cleanup and take the dashboard down.
        teardown(cam);
    }, [teardown]);

    /* -------------------------------------------------- lookup */
    // "Belongs to another outlet" is its own screen, not a toast: at a
    // counter the answer has to stay on screen long enough to send the
    // customer to the right place.
    const handleWrongOutlet = (e) => {
        if (e?.code !== "WRONG_OUTLET" && e?.code !== "OUTLET_FORBIDDEN") return false;
        setWrongOutlet(e.message || "This booking belongs to another outlet.");
        setPhase("wrong-outlet");
        scanMiss();
        return true;
    };

    const openById = useCallback(async (id) => {
        try {
            const res = await get(`/api/bookings/${id}${scanQs}`);
            setData(res);
            setPhase("found");
            scanFound();
        } catch (e) {
            if (handleWrongOutlet(e)) return;
            if (e.status === 404) { setPhase("missing"); scanMiss(); return; }
            setPhase("idle");
            toast("error", e.status === 403 ? "Not allowed" : "Couldn\u2019t open that booking", e.message);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scanQs]);

    const lookup = useCallback(async (raw) => {
        const parsed = parseScanned(raw);
        if (!parsed) return;

        setLookedUp(String(raw).trim());
        setChoices([]);
        setData(null);
        setNote("");
        setPhase("looking");

        try {
            if (parsed.kind === "ticket") {
                setData(await get(`/api/bookings/by-ticket/${encodeURIComponent(parsed.value)}${scanQs}`));
                setPhase("found");
                scanFound();
                return;
            }

            // A BK- reference has its own endpoint: exact match, one record,
            // and openable by a role whose only permission is the scanner.
            try {
                setData(await get(`/api/bookings/by-reference/${encodeURIComponent(parsed.value)}${scanQs}`));
                setPhase("found");
                scanFound();
                return;
            } catch (e) {
                // Not an exact reference. Fall through to the broader search,
                // which also matches names and numbers — but only for somebody
                // allowed to list bookings at all.
                if (e.status !== 404) throw e;
            }

            if (!access.can("bookings.view")) { setPhase("missing"); scanMiss(); return; }
            const res = await get(`/api/bookings?q=${encodeURIComponent(parsed.value)}&limit=10`);
            const hits = res.bookings || [];
            // "BK-12" regex-matches BK-123 too. An exact reference wins outright;
            // anything else genuinely is a choice and must be handed back.
            const exact = hits.filter((h) => String(h.reference || "").toUpperCase() === parsed.value);
            const candidates = exact.length === 1 ? exact : hits;

            if (candidates.length === 1) { await openById(candidates[0]._id); return; }
            if (!candidates.length) { setPhase("missing"); scanMiss(); return; }
            setChoices(candidates);
            setPhase("many");
            scanMiss();   // a choice still stops the queue; it is not a clean hit
        } catch (e) {
            if (handleWrongOutlet(e)) return;
            if (e.status === 404 || e.code === "NO_TICKET") { setPhase("missing"); scanMiss(); return; }
            setPhase("idle");
            toast("error", e.status === 403 ? "Not allowed" : "Couldn't look that up", e.message);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openById, toast, access, scanQs]);

    const onDecode = useCallback((text) => {
        // The success callback fires on every frame the code stays in view.
        if (decodingRef.current) return;
        decodingRef.current = true;
        // FEEDBACK BEFORE WORK. Stopping the camera and fetching the booking
        // together take the best part of a second, and until this was here the
        // screen did not change at all in that window — so an operator scanned
        // again, and again, believing nothing had happened. The buzz says "got
        // it, move the phone away"; the phase change puts a spinner up at the
        // same instant instead of after the teardown.
        scanCaptured();
        setLookedUp(String(text).trim());
        setPhase("looking");
        stopCamera().finally(() => lookup(text));
    }, [stopCamera, lookup]);

    // The running camera holds whichever callback it was started with, forever.
    // Handing it a ref means a decode five minutes in still runs today's lookup.
    useEffect(() => { handlerRef.current = onDecode; }, [onDecode]);

    const startCamera = useCallback(async () => {
        setCamError(null);
        // Browsers only allow audio to begin inside a user gesture. This press
        // is one; a decode five minutes later is not.
        unlockFeedback();

        // getUserMedia is simply absent on http:// origins other than localhost.
        // Catching it here turns a silent nothing into an explanation.
        if (typeof window !== "undefined" && !window.isSecureContext) {
            setCamError({
                title: "This page isn't on a secure connection",
                body: "Browsers only hand the camera to pages served over https:// (or to localhost while developing). Open the dashboard on its https address to scan; until then, use the Type or paste box.",
            });
            return;
        }
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
            setCamError({
                title: "This browser won't give a web page the camera",
                body: "It's an older or restricted browser. Chrome, Edge or Safari on this device will work — or use the Type or paste box.",
            });
            return;
        }

        setStarting(true);
        stopWantedRef.current = false;
        try {
            // Imported here and nowhere else: the library reaches for window at
            // module scope and would break the server render.
            const { Html5Qrcode } = await import("html5-qrcode");
            const cam = new Html5Qrcode(CAM_ID, { verbose: false });
            camRef.current = cam;
            decodingRef.current = false;
            await cam.start(
                { facingMode: "environment" },
                {
                    fps: 10,
                    qrbox: (w, h) => {
                        const side = Math.floor(Math.min(w, h) * 0.72);
                        return { width: side, height: side };
                    },
                },
                (text) => { handlerRef.current(text); },
                () => { /* a frame with no code in it — every frame, ignored */ },
            );
            // Somebody asked it to stop while it was still opening (typed a
            // reference instead, or walked away from the page). The camera is
            // only actually stoppable now, so honour that request here rather
            // than leaving a live stream nothing holds a handle to.
            if (stopWantedRef.current) {
                await teardown(cam);
                if (camRef.current === cam) camRef.current = null;
                return;
            }
            setRunning(true);
        } catch (err) {
            camRef.current = null;
            setCamError(cameraTrouble(err));
        } finally {
            setStarting(false);
        }
    }, [teardown]);

    const scanNext = useCallback(() => {
        setPhase("idle");
        setData(null);
        setChoices([]);
        setLookedUp("");
        setTyped("");
        setNote("");
        decodingRef.current = false;
        // They pressed a button that says "scan", so asking for the camera now
        // is answering them rather than surprising them.
        startCamera();
    }, [startCamera]);

    // The camera stops the moment a record takes the screen. Hiding it while it
    // still runs would leave the light on behind a panel nobody can see.
    useEffect(() => {
        if (phase === "found" || phase === "many") stopCamera();
    }, [phase, stopCamera]);

    const submitTyped = (e) => {
        e?.preventDefault();
        if (!typed.trim()) return;
        unlockFeedback();
        decodingRef.current = false;
        setLookedUp(typed.trim());
        setPhase("looking");
        stopCamera().finally(() => lookup(typed));
    };

    /* -------------------------------------------------- consume */
    const b = data?.booking;
    // A scan-only role's whole job is to hand food over, so scan.use carries
    // the serve action with it. bookings.consume still works for the roles that
    // were built around the Bookings module.
    const canConsume = access.can("bookings.consume") || access.can("scan.use");

    const runConsume = async () => {
        setBusy(true);
        try {
            const res = await post(`/api/bookings/${b._id}/consume`, {
                via: "scan",
                ...(scanOutlet ? { outletId: scanOutlet } : {}),
                ...(note.trim() ? { note: note.trim() } : {}),
            });
            setData((d) => ({ ...d, booking: res.booking }));
            setConfirm(null);
            setNote("");
            servedOk();
            toast("success", "Marked as served", `${b.reference} · ${b.totalQuantity} meal${b.totalQuantity === 1 ? "" : "s"} handed over.`);
        } catch (e) {
            const known = {
                ALREADY_CONSUMED: ["Already served", "Someone else marked this one first — reload to see who."],
                NOT_CONSUMABLE: ["This booking doesn't stand", "It was cancelled or rejected, so there is nothing to hand over."],
                CONSUME_PENDING: ["Still waiting on a decision", "Approve the open request first, then mark it served."],
            }[e.code];
            if (e.code === "WRONG_OUTLET" || e.code === "OUTLET_FORBIDDEN") { setConfirm(null); handleWrongOutlet(e); }
            else if (e.status === 403) toast("error", "Not allowed", "Your role can't mark meals as served. Ask the owner for the booking consume permission.");
            else if (known) toast("error", known[0], known[1]);
            else toast("error", "Couldn't mark it served", e.message);
        } finally {
            setBusy(false);
        }
    };

    const runUnconsume = async () => {
        setBusy(true);
        try {
            const res = await post(`/api/bookings/${b._id}/unconsume`, scanOutlet ? { outletId: scanOutlet } : {});
            setData((d) => ({ ...d, booking: res.booking }));
            setConfirm(null);
            toast("success", "Served mark removed", "This booking is back to not served.");
        } catch (e) {
            toast("error", e.status === 403 ? "Not allowed" : "Couldn't undo that", e.message);
        } finally {
            setBusy(false);
        }
    };

    const askServe = () => setConfirm({
        title: "Mark this booking as served?",
        body: `${b.reference} · ${b.partySnapshot?.name} · ${b.totalQuantity} meal${b.totalQuantity === 1 ? "" : "s"} for ${b.mealTypeName} on ${formatDate(b.date, { year: true })}. Your name and the time go on the record.`,
        label: "Yes, mark as served",
        action: runConsume,
        withNote: true,
    });

    const askUndo = () => setConfirm({
        title: "Remove the served mark?",
        body: `${b.reference} goes back to not served, and this correction is logged against your name. Only do this if the meal was not actually handed over.`,
        label: "Yes, undo it",
        danger: true,
        action: runUnconsume,
    });

    // A found booking, or a list to choose from, owns the screen.
    const showScanner = phase !== "found" && phase !== "many" && phase !== "looking" && phase !== "wrong-outlet";

    return (
        <div>
            <div className="page-head row-between wrap">
                <div>
                    {/* Three states, not two. This keyed off `showScanner`,
                        which was fine while that meant "no result yet" — but the
                        scanner now also hides while a lookup is in flight, and the
                        heading read "Booking found" before anything was found. */}
                    <h1 className="page-title">
                        {phase === "looking" ? "Looking that up"
                            : phase === "wrong-outlet" ? "Not for this outlet"
                            : showScanner ? "Scan a booking" : "Booking found"}
                    </h1>
                    <p className="page-sub">
                        {phase === "looking"
                            ? "Checking this business’s bookings — a second at most."
                            : phase === "wrong-outlet"
                            ? "This code isn\u2019t for this counter."
                            : showScanner
                            ? "Point the camera at the customer\u2019s code, or type their reference."
                            : "Everything the counter needs for this one. Scan the next when you\u2019re done."}
                    </p>
                    {/* Which outlet this counter is validating for — the
                        context every scan runs in. Automatic for a scanner
                        assigned to one outlet; the top-bar selector otherwise. */}
                    {access.outlets.length > 0 && (
                        <span className="outlet-scope-line" title="Codes are only accepted for this outlet">
                            <OutletIcon size={13} />
                            {access.outlet
                                ? `Scanning at ${access.outletName}`
                                : `Scanning for ${Array.isArray(access.outletScope) ? "all your outlets" : "every outlet"}`}
                        </span>
                    )}
                </div>
                {/* The way back to the scanner, once the scanner is hidden. */}
                {!showScanner && phase !== "looking" && (
                    <button className="btn btn-secondary" onClick={scanNext}>Scan another</button>
                )}
            </div>

            {/* A result is what the counter is looking at, and a live camera
                above it is a second thing competing for the same eyes. Once a
                booking is on screen the scanner folds away until it is wanted
                again \u2014 and the camera is genuinely stopped, not just hidden. */}
            {showScanner && (
            <div className="scan-cols">
                {/* ---------------------------------------------- camera */}
                <div className="card card-pad">
                    <div className="row-between" style={{ marginBottom: 12 }}>
                        <div className="num-label">Camera</div>
                        <div className="row" style={{ gap: 8 }}>
                            {running && <span className="badge badge-green">Live</span>}
                            {/* A dining hall at noon is loud; a small office at
                                8am is not. The buzz stays either way — it is the
                                half that works with the phone in a pocket. */}
                            <button type="button" className="btn btn-ghost btn-sm scan-sound"
                                aria-pressed={sound}
                                title={sound ? "Scan sounds on — tap to mute" : "Scan sounds muted — tap to unmute"}
                                onClick={() => { const next = !sound; setSound(next); setSoundOn(next); if (next) { unlockFeedback(); scanFound(); } }}>
                                {sound ? (
                                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M11 5 6 9H3v6h3l5 4z" />
                                        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                                        <path d="M18.5 5.5a9 9 0 0 1 0 13" />
                                    </svg>
                                ) : (
                                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M11 5 6 9H3v6h3l5 4z" />
                                        <line x1="23" y1="9" x2="17" y2="15" />
                                        <line x1="17" y1="9" x2="23" y2="15" />
                                    </svg>
                                )}
                                <span className="hide-sm">{sound ? "Sound on" : "Muted"}</span>
                            </button>
                        </div>
                    </div>

                    <div className="scan-stage">
                        <div id={CAM_ID} className="scan-cam" />
                        {!running && (
                            <div className="scan-idle">
                                <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M3 8.5V5.5A2.5 2.5 0 0 1 5.5 3h3" />
                                    <path d="M15.5 3h3A2.5 2.5 0 0 1 21 5.5v3" />
                                    <path d="M21 15.5v3a2.5 2.5 0 0 1-2.5 2.5h-3" />
                                    <path d="M8.5 21h-3A2.5 2.5 0 0 1 3 18.5v-3" />
                                    <line x1="6" y1="12" x2="18" y2="12" />
                                </svg>
                                <p className="small muted" style={{ maxWidth: 280, margin: "10px auto 0" }}>
                                    The camera stays off until you start it, so the browser only asks once —
                                    when you actually want it.
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="row wrap" style={{ marginTop: 12 }}>
                        {running ? (
                            <button className="btn btn-secondary" onClick={stopCamera}>Stop camera</button>
                        ) : (
                            <button className="btn btn-primary" onClick={startCamera} disabled={starting}>
                                {starting ? "Starting…" : "Start camera"}
                            </button>
                        )}
                        {running && <span className="xsmall faint">Hold the code steady inside the frame.</span>}
                    </div>

                    {camError && (
                        <div className="banner banner-warn" style={{ marginTop: 12 }}>
                            <strong>{camError.title}</strong>
                            <div style={{ marginTop: 4 }}>{camError.body}</div>
                        </div>
                    )}
                </div>

                {/* ---------------------------------------------- typed */}
                <div className="card card-pad">
                    <div className="num-label" style={{ marginBottom: 12 }}>Type or paste</div>
                    <form onSubmit={submitTyped}>
                        <Field label="Ticket, link or reference"
                            hint="Anything from the customer’s screen: the whole link, the ticket in it, or a BK- reference.">
                            <Input value={typed} autoComplete="off" spellCheck="false"
                                placeholder="BK-1042  ·  https://…/t/abc123"
                                onChange={(e) => setTyped(e.target.value)} />
                        </Field>
                        <button className="btn btn-primary btn-block" type="submit"
                            style={{ marginTop: 10 }} disabled={!typed.trim() || phase === "looking"}>
                            {phase === "looking" ? "Looking…" : "Look it up"}
                        </button>
                    </form>
                    <p className="xsmall faint" style={{ marginTop: 12, marginBottom: 0, lineHeight: 1.6 }}>
                        This box works whatever the camera is doing \u2014 a cracked lens or a flat
                        battery shouldn\u2019t stop the queue.
                    </p>
                </div>
            </div>
            )}

            {/* ---------------------------------------------- result */}
            <div style={{ marginTop: showScanner ? 14 : 0 }}>
                {/* A grey skeleton block used to sit here. It reads as "something
                    is broken" rather than "something is happening", which is the
                    opposite of what a queue needs. */}
                {phase === "looking" && (
                    <div className="card card-pad" style={{ textAlign: "center", padding: "36px 20px" }}>
                        <Spinner large label="Looking up that booking" />
                        <div style={{ marginTop: 14, fontWeight: 600 }}>Looking up that booking…</div>
                        <p className="small muted" style={{ margin: "6px 0 0" }}>
                            {lookedUp ? <span className="mono">{lookedUp}</span> : "One moment"}
                        </p>
                    </div>
                )}

                {phase === "wrong-outlet" && (
                    <div className="card card-pad" style={{ borderColor: "var(--brick)", background: "var(--brick-soft)" }}>
                        <div className="row-between wrap" style={{ gap: 12 }}>
                            <div style={{ minWidth: 0 }}>
                                <div className="serve-head" style={{ color: "var(--brick)" }}>Not for this outlet</div>
                                <div className="small" style={{ marginTop: 4, color: "var(--brick)" }}>{wrongOutlet}</div>
                                <div className="xsmall" style={{ marginTop: 6, color: "var(--brick)", opacity: 0.85 }}>
                                    {access.outlet ? `You are scanning at ${access.outletName}. ` : ""}
                                    Ask the customer to collect at the outlet they booked. Nothing was marked.
                                </div>
                            </div>
                            <button className="btn btn-primary" onClick={scanNext}>Scan next</button>
                        </div>
                    </div>
                )}

                {phase === "missing" && (
                    <div className="card">
                        <Empty
                            title="Nothing matches that code"
                            note={`Nothing in this business matches “${lookedUp}”. It may belong to another business, or the booking may have been deleted.`}
                            action={<button className="btn btn-primary" onClick={scanNext}>Scan next</button>}
                        />
                    </div>
                )}

                {phase === "many" && (
                    <div className="card card-pad">
                        <div className="banner banner-info" style={{ marginBottom: 12 }}>
                            <strong>More than one booking matches “{lookedUp}”.</strong>
                            <div style={{ marginTop: 4 }}>Check the name with the customer, then pick the right one.</div>
                        </div>
                        <div className="stack-sm">
                            {choices.map((c) => (
                                <button key={c._id} className="scan-choice" onClick={() => openById(c._id)}>
                                    <span>
                                        <span className="mono" style={{ fontWeight: 650 }}>{c.reference}</span>
                                        <span className="small muted"> · {c.partySnapshot?.name}</span>
                                        <span className="xsmall faint" style={{ display: "block" }}>
                                            {c.mealTypeName} · {formatDate(c.date)} · {c.totalQuantity} meal{c.totalQuantity === 1 ? "" : "s"}
                                        </span>
                                    </span>
                                    <span className="row" style={{ gap: 5 }}>
                                        <StatusBadge status={c.status} />
                                        <ServedBadge booking={c} quiet />
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {phase === "found" && b && (
                    <Result
                        data={data}
                        canConsume={canConsume}
                        onServe={askServe}
                        onUndo={askUndo}
                        onNext={scanNext}
                    />
                )}
            </div>

            {/* ONLY this surface posts. The buttons above merely open it. */}
            <Drawer open={Boolean(confirm)} onClose={() => !busy && setConfirm(null)} title={confirm?.title || ""}
                footer={
                    <>
                        <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm(null)}>Go back</button>
                        <button className={`btn ${confirm?.danger ? "btn-danger" : "btn-primary"}`}
                            disabled={busy} onClick={confirm?.action}>
                            {busy ? "Working…" : confirm?.label}
                        </button>
                    </>
                }>
                <p style={{ marginTop: 0, lineHeight: 1.6 }}>{confirm?.body}</p>
                {confirm?.withNote && (
                    <Field label="Note (optional)" hint="Anything worth remembering — a short count, a substitution.">
                        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                    </Field>
                )}
            </Drawer>

            <style>{`
              .scan-cols { display: grid; gap: 14px; align-items: start; }
              @media (min-width: 860px) { .scan-cols { grid-template-columns: 1.25fr 1fr; } }

              .scan-stage { position: relative; border-radius: var(--radius); overflow: hidden; background: var(--ink); }
              .scan-cam { min-height: 300px; }
              .scan-cam video { display: block; width: 100% !important; height: auto !important; }
              .scan-idle {
                position: absolute; inset: 0; display: flex; flex-direction: column;
                align-items: center; justify-content: center; text-align: center; padding: 20px;
                background: var(--paper); color: var(--faint);
              }

              .scan-choice {
                display: flex; align-items: center; justify-content: space-between; gap: 12px;
                width: 100%; text-align: left; cursor: pointer; font: inherit; color: inherit;
                padding: 10px 12px; border-radius: var(--radius-sm);
                border: 1px solid var(--border); background: var(--card);
              }
              .scan-choice:hover { background: var(--paper); border-color: var(--border-strong); }

              .serve-panel { border-radius: var(--radius); padding: 16px 18px; border: 1px solid var(--border); }
              .serve-panel.yes { background: var(--basil-soft); border-color: var(--basil); }
              .serve-panel.no { background: var(--paper); }
              .serve-panel .serve-head {
                font-family: var(--font-display), sans-serif; font-size: 18px;
                font-weight: 700; letter-spacing: -.01em;
              }
              .serve-panel.yes .serve-head { color: var(--basil-dark); }

              /* The meal is the headline of a scanned record. */
              .scan-meal {
                font-family: var(--font-display), sans-serif; font-size: 26px;
                font-weight: 700; letter-spacing: -.02em; margin: 0 0 2px;
              }
              .scan-order { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
              .scan-line {
                display: inline-flex; align-items: baseline; gap: 7px;
                padding: 7px 13px; border-radius: 999px;
                background: var(--basil-soft); color: var(--basil-dark);
                border: 1px solid var(--basil);
              }
              .scan-line .n {
                font-family: var(--font-display), sans-serif; font-weight: 700; font-size: 19px;
                font-variant-numeric: tabular-nums;
              }
              .scan-line .l { font-size: 14px; font-weight: 600; }
              .scan-total { font-size: 13px; color: var(--slate); }

              .ans-grid { display: grid; gap: 10px; }
              @media (min-width: 620px) { .ans-grid { grid-template-columns: repeat(2, 1fr); } }
              .ans { padding: 9px 11px; background: var(--paper); border-radius: var(--radius-sm); }
              .ans .k { font-size: 11.5px; color: var(--faint); text-transform: uppercase; letter-spacing: .05em; font-weight: 700; }
              .ans .v { font-size: 14px; margin-top: 2px; overflow-wrap: anywhere; }
            `}</style>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* THE RECORD                                                           */
/* ------------------------------------------------------------------ */
// Everything the counter might be asked, on one screen, in the order it gets
// asked in: was this already served, who is standing here, and what do they get.
function Result({ data, canConsume, onServe, onUndo, onNext }) {
    const b = data.booking;
    const cutoff = data.cutoff;
    const served = Boolean(b.consumedAt);

    const answers = useMemo(
        () => (b.answers || []).filter((a) => a && String(a.value ?? "").trim() !== ""),
        [b.answers],
    );

    const openRequest = (data.requests || []).find((r) => r.status === "pending");

    // The API refuses a cancelled, rejected or still-pending booking. At a
    // counter the reason matters more than the button, so the panel says which
    // it is instead of silently dropping the action.
    const serveable = b.status === "confirmed";
    const blocked = b.status === "pending_approval"
        ? "Still waiting on a decision — resolve the open request before handing anything over."
        : `This booking was ${(STATUS_LABEL[b.status] || b.status).toLowerCase()}, so there is nothing to hand over.`;

    return (
        <div className="card card-pad">
            <div className="stack">
                {/* WHAT TO HAND OVER, first and biggest. The reference is how
                    the record is addressed, but it is not what anybody at the
                    counter is looking for — they want the meal, and how
                    many of which option. Those used to be small grey text and a
                    breakdown three sections further down. */}
                <div className="row-between wrap" style={{ gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                        <h2 className="scan-meal">{b.mealTypeName}</h2>
                        <div className="small muted">
                            {formatDate(b.date, { year: true })}
                            <span className="mono" style={{ marginLeft: 10 }}>{b.reference}</span>
                        </div>
                    </div>
                    <div className="row wrap" style={{ gap: 6 }}>
                        <OutletTag booking={b} />
                        <StatusBadge status={b.status} />
                        <ServedBadge booking={b} />
                        {openRequest && (
                            <span className="badge badge-amber" title="Awaiting a decision">
                                {REQUEST_TYPE_LABEL[openRequest.type]}
                            </span>
                        )}
                        {b.submittedAfterCutoff && <span className="badge badge-amber">Booked after cutoff</span>}
                        {b.source === "operator" && <span className="badge badge-blue">Entered at counter</span>}
                    </div>
                </div>

                {/* The order itself, in the words the kitchen uses for it. Only
                    the options actually ordered — a row of zeroes is noise
                    at a counter, whatever it is worth on a kitchen sheet. */}
                <div className="scan-order">
                    {b.lines.filter((l) => l.quantity > 0).map((l) => (
                        <span key={l.variantId} className="scan-line">
                            <span className="n">{l.quantity}</span>
                            <span className="l">{l.variantName}</span>
                        </span>
                    ))}
                    <span className="scan-total">
                        {b.totalQuantity} meal{b.totalQuantity === 1 ? "" : "s"} in total
                        {b.totalAmount > 0 ? ` · ₹${b.totalAmount.toLocaleString("en-IN")}` : ""}
                    </span>
                </div>

                {/* The single most important fact, above everything else. */}
                <div className={`serve-panel ${served ? "yes" : "no"}`}>
                    <div className="row-between wrap" style={{ gap: 12 }}>
                        <div style={{ minWidth: 0 }}>
                            <div className="serve-head">{served ? "Already served" : "Not served yet"}</div>
                            <div className="small" style={{ marginTop: 3, color: served ? "var(--basil-dark)" : "var(--slate)" }}>
                                {served
                                    ? `Handed over ${servedSummary(b)}`
                                    : serveable
                                        ? "Hand the meal over, then record it here so nobody is served twice."
                                        : blocked}
                            </div>
                            {served && b.consumedNote && (
                                <div className="small" style={{ marginTop: 6, color: "var(--basil-dark)" }}>
                                    “{b.consumedNote}”
                                </div>
                            )}
                        </div>
                        <div className="row wrap" style={{ gap: 8 }}>
                            {canConsume && (served
                                ? <button className="btn btn-secondary" onClick={onUndo}>Undo served mark…</button>
                                : serveable && <button className="btn btn-primary" onClick={onServe}>Mark as served…</button>
                            )}
                            <button className="btn btn-ghost" onClick={onNext}>Scan next</button>
                        </div>
                    </div>
                    {!canConsume && (
                        <div className="xsmall faint" style={{ marginTop: 8 }}>
                            Your role can look bookings up but not mark them served.
                        </div>
                    )}
                </div>

                <div className="grid-2">
                    <div>
                        <div className="num-label">Customer</div>
                        <div style={{ fontWeight: 650 }}>{b.partySnapshot?.name}</div>
                        {b.partySnapshot?.phone && (
                            <a className="small mono" href={`tel:${b.partySnapshot.phone}`}
                                style={{ color: "var(--basil-dark)" }}>
                                {prettyPhone(b.partySnapshot.phone)}
                            </a>
                        )}
                        {b.partySnapshot?.organisation && (
                            <div className="small muted">{b.partySnapshot.organisation}</div>
                        )}
                    </div>
                    <div>
                        <div className="num-label">Booked</div>
                        <div className="small">{fmtDateTime(b.createdAt)}</div>
                        <div className="xsmall faint">{timeAgo(b.createdAt)}</div>
                    </div>
                </div>

                {(b.customerNote || b.location) && (
                    <div className="grid-2">
                        {b.location && (
                            <div>
                                <div className="num-label">Location</div>
                                <div className="small">{b.location}</div>
                            </div>
                        )}
                        {b.customerNote && (
                            <div>
                                <div className="num-label">Note</div>
                                <div className="small">{b.customerNote}</div>
                            </div>
                        )}
                    </div>
                )}

                {/* Whatever this business decided to ask for, as it was answered
                    on the day — a snapshot, so later config edits can't rewrite
                    what the customer actually told them. */}
                {answers.length > 0 && (
                    <div>
                        <div className="num-label" style={{ marginBottom: 6 }}>Their answers</div>
                        <div className="ans-grid">
                            {answers.map((a) => (
                                <div key={a.key} className="ans">
                                    <div className="k">{a.label}</div>
                                    <div className="v">{answerText(a)}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="row-between wrap xsmall faint" style={{ gap: 10, paddingTop: 4, borderTop: "1px solid var(--border)" }}>
                    <span>{b.source === "operator" ? "Taken at the counter" : "Booked by the customer"}</span>
                    <span>
                        {!cutoff?.hasCutoff
                            ? "No cutoff on this service"
                            : cutoff.passed
                                ? `Cutoff passed — ${formatTime(cutoff.cutoffTime)} on ${formatDate(cutoff.cutoffDate)}`
                                : `Cutoff ${formatTime(cutoff.cutoffTime)} on ${formatDate(cutoff.cutoffDate)}`}
                    </span>
                </div>

                <div>
                    <Link className="small" href={`/dashboard/bookings?booking=${b._id}`}
                        style={{ color: "var(--basil-dark)", fontWeight: 600 }}>
                        Open in Bookings →
                    </Link>
                </div>
            </div>
        </div>
    );
}
