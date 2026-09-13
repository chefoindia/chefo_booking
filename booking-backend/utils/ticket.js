// utils/ticket.js — the booking's unguessable pass.
//
// WHY THIS EXISTS AT ALL. A booking is addressed publicly by its reference plus
// the phone number that booked it, because references are sequential: BK-1041
// tells you BK-1042 exists, and without the phone pairing anyone could read a
// canteen's entire book. That pairing is right for a lookup form and wrong for
// a QR code on a printed slip — nobody types a phone number at a serving
// counter, and the operator scanning it does not know the customer's number.
//
// So the ticket carries its own proof. 16 random bytes is 128 bits: not
// enumerable, not guessable, and not derivable from the reference. Possession
// IS the authorisation, which cuts both ways — a ticket is as sensitive as the
// booking behind it, so it belongs on the customer's own slip and nowhere else.
//
// base64url rather than hex because it has to survive being a URL path segment
// and being read off a screen: 22 characters instead of 32, with no character
// that needs escaping.
const crypto = require("crypto");

// 16 bytes -> 24 base64 characters, of which the last two are always "=="
// padding. base64url drops the padding, so every ticket is exactly 22 chars —
// which is why the regex can be a fixed length rather than a range.
const TICKET_BYTES = 16;
const TICKET_LENGTH = 22;

/** A fresh ticket. Random, never derived from the booking it will belong to. */
function newTicket() {
    return crypto.randomBytes(TICKET_BYTES).toString("base64url");
}

// Validate BEFORE touching the database: a route that hands Mongo whatever
// arrived in the URL is one bad path segment away from doing work on garbage,
// and this also keeps the QR endpoint from rendering an image for any string a
// script cares to send.
const TICKET_RE = /^[A-Za-z0-9_-]{22}$/;

/** True when `v` could be a ticket. Says nothing about whether one exists. */
const isTicket = (v) => typeof v === "string" && TICKET_RE.test(v);

module.exports = { newTicket, TICKET_RE, isTicket, TICKET_LENGTH };
