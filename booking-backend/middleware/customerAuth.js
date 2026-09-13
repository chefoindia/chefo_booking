// middleware/customerAuth.js — the CUSTOMER's session, which is a different
// thing from the operator's and deliberately shares nothing with it.
//
// TWO COOKIES, NOT ONE WITH A ROLE FLAG. An operator session says "this person
// may act on this business"; a customer session says only "this phone number
// was proven, and these are that party's own bookings". Keeping them as two
// separately-named cookies means no operator route can ever be reached with a
// customer token by accident — no operator route reads this name, and nothing
// here reads theirs.
//
// WHY 365 DAYS. The customer surface has no password to fall back on: the only
// way back in is another SMS, which costs Chefo money and the customer their
// patience. Somebody who books lunch twice a month should not be re-verified
// every week. A long session is safe here precisely because of how little it
// grants — one party's own bookings at one business — and it is revocable
// without waiting for expiry through BookingParty.tokenVersion.
//
// Mirrors middleware/authenticate.js in shape on purpose: same jwt.verify,
// same tokenVersion check, same cookie-option reasoning, so anyone who has read
// one file already understands the other.
const jwt = require("jsonwebtoken");
const BookingParty = require("../models/BookingParty");

const CUSTOMER_DAYS = 365;
const CUSTOMER_MS = CUSTOMER_DAYS * 24 * 60 * 60 * 1000;
const CUSTOMER_COOKIE = "booking_customer";

// Same environment reasoning as the operator cookie: production is cross-site
// (booking.chefo.in -> api.booking.chefo.in), which requires SameSite=None and
// therefore Secure; development is http://localhost, where a Secure cookie is
// refused and different ports are still the same site, so Lax is correct.
const isProd = process.env.NODE_ENV === "production";
const CUSTOMER_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    maxAge: CUSTOMER_MS,
    path: "/",
};

const signCustomerSession = (party) =>
    jwt.sign(
        { partyId: String(party._id), businessId: String(party.businessId), v: party.tokenVersion || 0 },
        process.env.JWT_SECRET,
        { expiresIn: `${CUSTOMER_DAYS}d` }
    );

/**
 * Who is this customer, if anyone?
 *
 * Returns the BookingParty document, or null. NEVER throws and never sends a
 * response: every customer endpoint has a signed-out answer that is a normal
 * 200 ("you have no bookings here yet"), not an error, so a missing or stale
 * cookie must read as "nobody" rather than as a failure.
 *
 * Returns the live document rather than a lean object because callers stamp
 * verification timestamps on it.
 */
async function readCustomerSession(req) {
    const token = req.cookies?.[CUSTOMER_COOKIE];
    if (!token) return null;

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return null;   // expired or tampered — simply nobody
    }
    if (!decoded?.partyId) return null;

    const party = await BookingParty.findById(decoded.partyId);
    if (!party) return null;

    // The token names the business it was issued for. Checking it against the
    // party's own businessId means a cookie can never be replayed against a
    // different canteen even if the two ever shared a party id.
    if (String(party.businessId) !== String(decoded.businessId)) return null;

    // Invalidated deliberately — a customer signing out everywhere, or an
    // operator having to cut a session loose. Without this a long-lived token
    // would outlive both.
    if ((decoded.v ?? 0) !== (party.tokenVersion || 0)) return null;

    return party;
}

module.exports = {
    readCustomerSession,
    signCustomerSession,
    CUSTOMER_COOKIE,
    CUSTOMER_COOKIE_OPTIONS,
    CUSTOMER_DAYS,
};
