// routes/customerAccount.js — the customer's OWN account: prove the phone
// number once, stay recognised for a year.
//
// WHAT THIS FIXES. routes/public.js identifies a customer by typing a phone
// number into a lookup box — recognition, not authentication, and it says so
// plainly. That was the right V1 trade, but it means anybody who guesses a
// number can read that party's bookings, and it means the customer re-types
// their number on every visit. Verifying the number through the same Firebase
// phone auth the operator side already uses closes both at once, without
// inventing a password the customer would forget.
//
// STILL THE SEPARABLE CUSTOMER LAYER. Everything here lives under
// /api/public/*, holds no operator concepts, and addresses a business by its
// public slug. When Chefo builds one common customer platform, this goes with
// routes/public.js and nothing on the operator side has to move.
//
// A SESSION IS NOT A PERMISSION. The cookie proves one thing — this phone
// number was verified — and grants exactly one thing: that party's own bookings
// at this one business. Everything else a customer may do still goes through
// the same ownership checks in routes/public.js.
const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const Business = require("../models/Business");
const MealType = require("../models/MealType");
const Booking = require("../models/Booking");
const BookingParty = require("../models/BookingParty");
const BookingRequest = require("../models/BookingRequest");

const { cutoffState } = require("../utils/time");
const { normalisePhone } = require("../utils/phone");
const { verifiedPhoneFrom, isFirebaseReady } = require("../config/firebaseAdmin");
const { record } = require("../services/audit");
const {
    readCustomerSession, signCustomerSession, CUSTOMER_COOKIE, CUSTOMER_COOKIE_OPTIONS,
} = require("../middleware/customerAuth");

const meta = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] || "" });
const clean = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// Style of publicWriteLimiter: per-IP, generous enough for a real person
// retrying after a typo, tight enough that walking through numbers to discover
// which ones hold accounts is slow. Every allowed /start can precede an SMS on
// Chefo's Firebase bill, which is the other reason this is capped here and not
// only at Firebase.
const accountLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) =>
        res.status(429).json({ message: "Too many attempts. Please try again in a few minutes.", code: "RATE_LIMITED" }),
});

async function loadBusiness(slug) {
    const business = await Business.findOne({ slug: String(slug || "").toLowerCase() }).lean();
    if (!business) {
        const e = new Error("We couldn't find that canteen.");
        e.status = 404;
        throw e;
    }
    return business;
}

/** Two E.164 numbers are the same person even if one carries a country code. */
const samePhone = (a, b) =>
    String(a || "").replace(/\D/g, "").replace(/^91/, "") ===
    String(b || "").replace(/\D/g, "").replace(/^91/, "");

/* ------------------------------------------------------------------ */
/* Shaping — the same per-booking shape /lookup returns                 */
/* ------------------------------------------------------------------ */
// Built explicitly rather than returned wholesale, for the same reason
// routes/public.js does it: operator notes and internal fields must never reach
// the customer app just because somebody later adds a column to the schema.
function shapeForCustomer(b) {
    return {
        id: b._id,
        reference: b.reference,
        // The ticket is what the QR encodes, so the account page can show the
        // same code the customer would otherwise dig out of a confirmation.
        ticket: b.ticket || null,
        date: b.date,
        mealTypeId: b.mealTypeId,
        mealTypeName: b.mealTypeName,
        status: b.status,
        lines: (b.lines || []).map((l) => ({
            variantId: l.variantId, variantName: l.variantName, quantity: l.quantity,
        })),
        totalQuantity: b.totalQuantity,
        totalAmount: b.totalAmount,
        submittedAfterCutoff: b.submittedAfterCutoff,
        customerNote: b.customerNote,
        createdAt: b.createdAt,
        // Collected or not — so a customer looking at a used ticket is told
        // that plainly instead of presenting it again at the counter.
        consumed: b.consumedAt
            ? { at: b.consumedAt, by: b.consumedByName || "", via: b.consumedVia || null }
            : null,
    };
}

/** Server-side answer to "what can this customer still do with this booking?" */
function canCustomerAct(booking, business, cutoff, action) {
    if (["cancelled", "rejected"].includes(booking.status)) return false;
    const r = business.rules || {};
    if (action === "edit") {
        return cutoff.passed
            ? r.allowCustomerChangeRequestAfterCutoff !== false
            : r.allowCustomerEditBeforeCutoff !== false;
    }
    return cutoff.passed
        ? r.allowCustomerCancelRequestAfterCutoff !== false
        : r.allowCustomerCancelBeforeCutoff !== false;
}

/**
 * This party's bookings, in the shape the customer app already renders.
 *
 * Every "may I still change this?" answer is decided HERE, on the server, and
 * handed over as a boolean. The client renders those; it never recomputes a
 * cutoff itself, or the two would drift and the customer would be offered a
 * button the API refuses.
 */
async function bookingsForParty(business, party) {
    const bookings = await Booking.find({ businessId: business._id, partyId: party._id })
        .sort({ date: -1, createdAt: -1 }).limit(50).lean();
    if (!bookings.length) return [];

    const [requests, mealTypes] = await Promise.all([
        BookingRequest.find({ bookingId: { $in: bookings.map((b) => b._id) } })
            .sort({ createdAt: -1 }).lean(),
        MealType.find({ businessId: business._id }).lean(),
    ]);

    const byBooking = new Map();
    for (const r of requests) {
        const k = String(r.bookingId);
        if (!byBooking.has(k)) byBooking.set(k, []);
        byBooking.get(k).push(r);
    }

    const mealById = new Map(mealTypes.map((m) => [String(m._id), m]));
    const now = new Date();
    const tz = business.timezoneOffsetMinutes ?? 330;

    return bookings.map((b) => {
        const c = cutoffState(mealById.get(String(b.mealTypeId)), b.date, { now, offsetMinutes: tz });
        const reqs = byBooking.get(String(b._id)) || [];
        const openRequest = reqs.find((r) => r.status === "pending") || null;
        return {
            ...shapeForCustomer(b),
            cutoffPassed: c.passed,
            // Same as the ticket view: the deadline itself, so the app can say
            // how long is left rather than only that it has or hasn't gone.
            hasCutoff: c.hasCutoff,
            cutoffAt: c.cutoffAt,
            canEdit: canCustomerAct(b, business, c, "edit"),
            canCancel: canCustomerAct(b, business, c, "cancel"),
            openRequest: openRequest && {
                reference: openRequest.reference,
                type: openRequest.type,
                status: openRequest.status,
                requestedTotal: openRequest.requestedTotal,
                quantityDelta: openRequest.quantityDelta,
                createdAt: openRequest.createdAt,
            },
            requestHistory: reqs.filter((r) => r.status !== "pending").map((r) => ({
                reference: r.reference, type: r.type, status: r.status,
                quantityDelta: r.quantityDelta, resolvedAt: r.resolvedAt,
                note: r.resolutionNote || "",
            })),
        };
    });
}

/** What the customer is allowed to see about themselves. Their own data only. */
const shapeParty = (p) => ({
    id: p._id,
    name: p.name,
    phone: p.phone,
    organisation: p.organisation || "",
    email: p.email || "",
    location: p.location || "",
    partyType: p.partyType || "individual",
    phoneVerifiedAt: p.phoneVerifiedAt || null,
    accountCreatedAt: p.accountCreatedAt || null,
});

/* ------------------------------------------------------------------ */
/* START — before any SMS is spent                                      */
/* ------------------------------------------------------------------ */
/**
 * "Is there already a party for this number here?"
 *
 * Answered before the browser burns an SMS, so the next screen can say "welcome
 * back" or "let's get your name" rather than asking a returning customer to
 * re-introduce themselves. Deliberately narrow: it reveals only whether the
 * number is known AT THIS BUSINESS, never anything about who they are, and it
 * is rate limited above.
 *
 * `otpAvailable: false` means Firebase is not configured — the client says so
 * honestly instead of spinning on a code that will never arrive.
 */
router.post("/api/public/business/:slug/account/start",
    accountLimiter, async (req, res, next) => {
        try {
            const business = await loadBusiness(req.params.slug);
            const phone = normalisePhone(req.body?.phone);
            if (!phone) return res.status(400).json({ message: "Enter a valid 10-digit mobile number." });

            const party = await BookingParty.findOne({ businessId: business._id, phone }).select("_id").lean();
            res.json({ exists: Boolean(party), otpAvailable: isFirebaseReady() });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* VERIFY — the idToken becomes a year-long session                     */
/* ------------------------------------------------------------------ */
/**
 * THE ONLY PLACE A CUSTOMER SESSION IS MINTED.
 *
 * The browser runs Firebase phone auth; the idToken it produces is verified
 * server-side and the number it proves control of is the authoritative one. The
 * submitted phone must match it — the body is a hint the user typed, and a
 * mismatch means the code they confirmed was for a different number, which is
 * exactly the case a "verify my phone" flow exists to catch.
 *
 * Upserts the party for (businessId, verified phone), which is the same
 * identity rule bookings already use — so a customer who has been booking by
 * typing their number lands on their existing record with every past booking
 * attached, rather than starting empty.
 */
router.post("/api/public/business/:slug/account/verify",
    accountLimiter, async (req, res, next) => {
        try {
            const business = await loadBusiness(req.params.slug);
            const name = clean(req.body?.name, 80);
            const claimed = normalisePhone(req.body?.phone);
            if (!claimed) return res.status(400).json({ message: "Enter a valid 10-digit mobile number." });

            const verified = await verifiedPhoneFrom(req.body?.idToken);
            if (!samePhone(claimed, verified)) {
                return res.status(400).json({ message: "That code was for a different number.", code: "PHONE_MISMATCH" });
            }
            const phone = normalisePhone(verified);
            if (!phone) return res.status(400).json({ message: "That number isn't one we can use.", code: "BAD_PHONE" });

            const now = new Date();
            let party = await BookingParty.findOne({ businessId: business._id, phone });
            const isNewAccount = !party || !party.accountCreatedAt;

            if (!party) {
                if (!name) return res.status(400).json({ message: "Enter your name." });
                party = new BookingParty({ businessId: business._id, name, phone });
            } else if (name) {
                // A verified person correcting their own name is welcome; a
                // blank one never erases what a longer form already captured.
                party.name = name;
            }

            party.phoneVerifiedAt = now;
            // Stamped once and never moved. It is when this person became a
            // real account here, and re-verifying next year is not a new
            // beginning.
            if (!party.accountCreatedAt) party.accountCreatedAt = now;
            await party.save();

            // No `actor`: this was the customer acting, and record() reads the
            // absence of an actor as exactly that (actorKind "customer").
            record({
                businessId: business._id, party, requestMeta: meta(req),
                action: isNewAccount ? "Created a booking account" : "Signed in",
                details: { phone: party.phone },
            });

            res.cookie(CUSTOMER_COOKIE, signCustomerSession(party), CUSTOMER_COOKIE_OPTIONS);
            res.json({ party: shapeParty(party), bookings: await bookingsForParty(business, party) });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* ME — what the app calls on every load                                */
/* ------------------------------------------------------------------ */
/**
 * Signed out is a 200 with `party: null`, not a 401. Being signed out is the
 * normal state of a page anyone can open, and answering it with an error makes
 * every client wrap its own home screen in a failure branch.
 */
router.get("/api/public/business/:slug/account/me", async (req, res, next) => {
    try {
        const business = await loadBusiness(req.params.slug);
        const party = await readCustomerSession(req);

        // A session for a DIFFERENT canteen is nobody here. The same browser
        // can hold one cookie while visiting two businesses, and the party it
        // names must never be answered for the wrong one.
        if (!party || String(party.businessId) !== String(business._id)) {
            return res.json({ party: null, bookings: [] });
        }

        res.json({ party: shapeParty(party), bookings: await bookingsForParty(business, party) });
    } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* LOGOUT                                                               */
/* ------------------------------------------------------------------ */
// Clears this browser only, deliberately: bumping tokenVersion would sign the
// customer out of their phone as well because they signed out on a shared
// desktop, and the cost of getting back in is another SMS.
router.post("/api/public/business/:slug/account/logout", (req, res) => {
    res.clearCookie(CUSTOMER_COOKIE, { ...CUSTOMER_COOKIE_OPTIONS, maxAge: undefined });
    res.json({ ok: true });
});

module.exports = router;
