"use client";
// lib/ledger.js — the little notebook this phone keeps of its own bookings.
//
// WHY IT EXISTS: there are no accounts here. A booking is addressed by its
// reference plus the phone number that made it, and a customer who closes the
// tab has nothing but a reference they may never have written down. So the
// browser that made a booking remembers it: ticket first, because the ticket is
// what opens the pass the canteen scans.
//
// It is a convenience, never a credential. Nothing here proves who anybody is —
// the server still asks for the phone number before it will change anything.
// Losing this list (private mode, a cleared browser, a new phone) costs the
// customer nothing except the shortcut; the booking itself lives on the server
// and can still be found by mobile number.
//
// Every read and write is wrapped, because in private mode localStorage can
// throw on access rather than politely return null, and a thrown storage error
// must never take the booking page down with it.

const LIMIT = 200;          // a canteen regular, several years in, still fits.
const ME_KEY = "chefo-booking-me";

/** Per-canteen, because one phone may book at several. */
export const KEY = (slug) => `chefo-booking-ledger:${String(slug || "").toLowerCase()}`;

/** Newest first, only rows that still have a ticket to open. */
export function readLedger(slug) {
    try {
        const rows = JSON.parse(localStorage.getItem(KEY(slug)) || "[]");
        if (!Array.isArray(rows)) return [];
        return rows.filter((r) => r && r.ticket).slice(0, LIMIT);
    } catch { /* private mode, or storage cleared — this phone just forgets */ }
    return [];
}

// Returns what is ACTUALLY on the device afterwards, not what we hoped to put
// there: in private mode nothing was kept, and the page checks what came back
// before telling the customer their booking is saved on this phone.
function write(slug, rows) {
    const capped = rows.slice(0, LIMIT);
    try {
        localStorage.setItem(KEY(slug), JSON.stringify(capped));
        return capped;
    } catch { /* private mode or full storage — the booking still exists on the server */ }
    return readLedger(slug);
}

/**
 * Records a booking this browser just made. De-duplicated by ticket so the same
 * booking saved twice moves to the top rather than appearing twice, and capped
 * so a busy canteen's regular never fills their storage.
 *
 * Takes the booking exactly as the server returned it; returns the new list.
 */
export function addToLedger(slug, booking) {
    if (!booking || !booking.ticket) return readLedger(slug);
    const entry = {
        ticket: String(booking.ticket),
        reference: booking.reference || "",
        bookingId: String(booking.id || booking.bookingId || ""),
        date: booking.date || "",
        mealTypeName: booking.mealTypeName || "",
        outletName: booking.outletName || "",
        totalQuantity: Number(booking.totalQuantity) || 0,
        savedAt: new Date().toISOString(),
    };
    const rest = readLedger(slug).filter((r) => String(r.ticket) !== entry.ticket);
    return write(slug, [entry, ...rest]);
}

/**
 * Forgets one booking on this device only. It does NOT cancel anything — a
 * cancelled booking is still a booking, and only the canteen's server can say
 * so. Returns the new list.
 */
export function removeFromLedger(slug, ticket) {
    const t = String(ticket || "");
    if (!t) return readLedger(slug);
    return write(slug, readLedger(slug).filter((r) => String(r.ticket) !== t));
}

/**
 * Who this phone last booked as — name, phone, organisation, partyType. Saves
 * retyping the same four things every morning; it authenticates nothing.
 * Always returns an object, so callers can spread it without checking.
 */
export function readMe() {
    try {
        const saved = JSON.parse(localStorage.getItem(ME_KEY) || "null");
        if (saved && typeof saved === "object") return saved;
    } catch { /* private mode, or cleared storage — no problem, they type it again */ }
    return {};
}

/** Merges into what is already remembered, so one caller can't blank the rest. */
export function writeMe(partial) {
    const next = { ...readMe(), ...(partial || {}) };
    try {
        localStorage.setItem(ME_KEY, JSON.stringify(next));
    } catch { /* nothing important lost — it is only a typing shortcut */ }
    return next;
}
