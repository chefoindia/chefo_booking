// lib/scrollLock.js — the one place that freezes the page behind an overlay.
//
// Reference-counted, because overlays overlap (a clock picker inside a
// settings drawer, a modal raised from a drawer). Each component restoring
// whatever it happened to read on open re-applies a lock its owner already
// released, or releases one that is still wanted. Counting fixes both: the
// page is frozen while at least one overlay holds a lock and thaws on the
// release of the last one, whatever order they open and close in.
let held = 0;
let original = null;

/** Freeze the page. Returns the matching release function; call it once. */
export function lockScroll() {
    if (typeof document === "undefined") return () => {};

    if (held === 0) {
        original = document.body.style.overflow;
        document.body.style.overflow = "hidden";
    }
    held += 1;

    // Guarded so a double-invoked release (React 18 development remounts an
    // effect to surface exactly this kind of bug) can't drop the count below
    // the number of overlays actually open and thaw the page under them.
    let released = false;
    return () => {
        if (released) return;
        released = true;
        held -= 1;
        if (held === 0) {
            document.body.style.overflow = original;
            original = null;
        }
    };
}
