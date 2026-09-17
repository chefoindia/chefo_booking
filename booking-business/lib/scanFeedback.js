// lib/scanFeedback.js — the counter's ears and fingertips.
//
// An operator scanning a queue is not looking at the screen. They are looking
// at the customer, the food, and the next person. So the scanner has to report
// back without being read:
//
//   vibrate  the moment a code is DECODED — "got it, move the phone away"
//   a tone   when the lookup RESOLVES — rising for a hit, falling for a miss
//   a tone   when a meal is actually MARKED SERVED — the only irreversible one
//
// WHY SYNTHESISED, NOT AN MP3. A counter tablet is often on a bad connection or
// none at all, and an audio file that 404s is a scanner that silently stops
// giving feedback. Two oscillator notes need no network, no asset pipeline and
// no decoding delay, and they cannot go missing in a deploy.
//
// TWO BROWSER RULES SHAPE THE REST.
//   1. Audio cannot start without a user gesture. `unlock()` is called from the
//      Start camera / Look it up press — a real gesture — and everything after
//      that is allowed. Without it iOS silently plays nothing forever.
//   2. navigator.vibrate does not exist on iOS at all, and throws on some
//      embedded browsers. Every call is guarded; silence is an acceptable
//      degradation, an exception in the decode path is not.

const PREF_KEY = "chefo.scan.sound";

let ctx = null;

/** Sound can be turned off for a quiet room; haptics stay either way. */
export function soundOn() {
    if (typeof window === "undefined") return true;
    try { return window.localStorage.getItem(PREF_KEY) !== "off"; } catch { return true; }
}

export function setSoundOn(on) {
    try { window.localStorage.setItem(PREF_KEY, on ? "on" : "off"); } catch { /* private mode */ }
}

/**
 * Call from a real user gesture, before any feedback is needed. Creating the
 * context lazily here (rather than at module load) also keeps it out of the
 * server render and off pages that never scan.
 */
export function unlock() {
    if (typeof window === "undefined") return;
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!ctx) ctx = new AC();
        // Chrome parks the context until a gesture; resume() inside one revives it.
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
    } catch { ctx = null; }
}

// One short note. `when` is an offset in seconds so two notes can be sequenced
// without a setTimeout that might land after the page has navigated away.
function note(freq, startAt, dur, peak = 0.14) {
    const t0 = ctx.currentTime + startAt;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t0);
    // A hard start/stop on a sine is heard as a click. Ramping in and out over
    // a few milliseconds is the difference between a chime and a pop.
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
}

function play(notes) {
    if (!soundOn()) return;
    unlock();
    if (!ctx || ctx.state !== "running") return;   // never unlocked; stay silent
    try { notes.forEach(([f, at, d, p]) => note(f, at, d, p)); } catch { /* audio is a nicety */ }
}

function buzz(pattern) {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    // Chrome refuses to vibrate until the frame has been tapped, and logs a
    // console ERROR every time it refuses. The call is harmless either way,
    // but a scanner that fills the console with red on every lookup makes the
    // next real bug harder to find. Where the browser tells us whether the
    // page has been activated, ask first.
    if (navigator.userActivation && navigator.userActivation.hasBeenActive === false) return;
    try { navigator.vibrate(pattern); } catch { /* not permitted here */ }
}

/* ------------------------------------------------------------------ */

/** A code was read off the camera. Haptic only — this fires mid-queue, often. */
export function scanCaptured() {
    buzz(35);
}

/** The lookup found a booking. Two rising notes. */
export function scanFound() {
    play([[880, 0, 0.09], [1318.5, 0.075, 0.13]]);
    buzz(45);
}

/** Nothing matched, or more than one did — worth a beat of attention. */
export function scanMiss() {
    play([[440, 0, 0.11, 0.12], [311.1, 0.1, 0.2, 0.12]]);
    buzz([50, 60, 50]);
}

/** The meal was handed over. The one action that cannot be undone silently. */
export function servedOk() {
    play([[659.3, 0, 0.09], [880, 0.07, 0.1], [1174.7, 0.15, 0.18]]);
    buzz([40, 45, 70]);
}
