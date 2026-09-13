// routes/public.js — THE CUSTOMER SIDE. No authentication, by design.
//
// This is the separable layer. When Chefo eventually builds one common customer
// platform across Subscription, Cafeteria, Canteen and Booking, THIS is the
// surface it replaces — so it deliberately shares nothing with the operator API
// beyond the domain service, exposes no operator concepts, and identifies a
// business by public slug rather than by any id the dashboard uses.
//
// WHAT IT REFUSES TO LEAK. A booking is addressed by its reference plus the
// phone number that booked it. Neither alone is enough. Without that pairing,
// sequential references (BK-1001, BK-1002...) would let anyone read every
// booking a canteen has ever taken.
//
// THE ONE EXCEPTION, AND WHY IT IS SAFE. A booking also carries a TICKET: 128
// random bits, minted at create (utils/ticket.js). A ticket needs no phone
// number because it is not guessable — where the reference is sequential and
// therefore is. That distinction is the entire security argument for the
// /api/public/t/* endpoints below, and it only holds while the ticket stays on
// the customer's own slip: it is as sensitive as the booking behind it.
const express = require("express");
const router = express.Router();

const QRCode = require("qrcode");

const Business = require("../models/Business");
const MealType = require("../models/MealType");
const MealVariant = require("../models/MealVariant");
const Booking = require("../models/Booking");
const BookingParty = require("../models/BookingParty");
const BookingRequest = require("../models/BookingRequest");
const WeeklyMenu = require("../models/WeeklyMenu");

const bookingService = require("../services/bookingService");
const { cutoffState, todayKey, shiftDateKey, isDateKey, weekdayOf } = require("../utils/time");
const { normalisePhone } = require("../utils/phone");
const { isTicket } = require("../utils/ticket");
const { customerUrl } = require("../config/brand");
const { publicWriteLimiter, lookupLimiter, globalLimiter } = require("../middleware/rateLimiters");

const meta = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] || "" });

// A calendar is a glance, not an export. Two months is already more than any
// booking horizon this product allows, and the cap is what stops
// ?from=1900-01-01 turning one request into 45,000 days of cutoff arithmetic.
const MAX_CALENDAR_DAYS = 62;

// Batch ticket lookup exists for a phone holding a wallet of slips, not for
// walking a keyspace — and the keyspace is 128 bits, so 100 is generous.
const MAX_TICKET_BATCH = 100;

async function loadBusiness(slug) {
    const business = await Business.findOne({ slug: String(slug || "").toLowerCase() }).lean();
    if (!business) {
        const e = new Error("We couldn't find that canteen.");
        e.status = 404;
        throw e;
    }
    return business;
}

/* ------------------------------------------------------------------ */
/* What can I book?                                                     */
/* ------------------------------------------------------------------ */
/**
 * Everything the booking form needs for one business on one date, in a single
 * request: meal services, their variants, and — importantly — the cutoff state
 * of each meal RIGHT NOW.
 *
 * The form shows "this will need the canteen's approval" before the customer
 * types anything, rather than surprising them after they submit. The server
 * decides that; the client only renders it.
 */
router.get("/api/public/business/:slug", async (req, res, next) => {
    try {
        const business = await loadBusiness(req.params.slug);
        const tz = business.timezoneOffsetMinutes ?? 330;
        const today = todayKey(tz);
        const date = isDateKey(req.query.date) ? req.query.date : today;

        // The weekly menu for whichever weekday this date falls on — what the
        // customer is actually choosing between, shown under each option.
        const weekday = weekdayOf(date);
        const [mealTypes, variants, menus] = await Promise.all([
            MealType.find({ businessId: business._id, active: true, customerBookable: true })
                .sort({ sortOrder: 1, name: 1 }).lean(),
            MealVariant.find({ businessId: business._id, active: true })
                .sort({ sortOrder: 1, name: 1 }).lean(),
            WeeklyMenu.find({ businessId: business._id, weekday }).lean(),
        ]);
        const menuByMeal = new Map(menus.map((m) => [String(m.mealTypeId), m]));

        const now = new Date();
        res.json({
            business: {
                ...businessCard(business),
                acceptingBookings: business.acceptingBookings,
                closedMessage: business.closedMessage,
                partyTypes: (business.partyTypes || []).filter((p) => p.active),
                rules: {
                    maxDaysAhead: business.rules?.maxDaysAhead ?? 14,
                    maxQuantityPerBooking: business.rules?.maxQuantityPerBooking ?? 500,
                    requireOrganisation: Boolean(business.rules?.requireOrganisation),
                    requireLocation: Boolean(business.rules?.requireLocation),
                    requireNote: Boolean(business.rules?.requireNote),
                },
                // The business's own questions. Sent WITH their scoping keys so
                // the form can show the right ones as the customer switches
                // meal service or party type, without a round trip per change —
                // and inactive ones never leave the server at all.
                bookingFields: publicBookingFields(business),
            },
            date,
            today,
            weekday,
            maxDate: shiftDateKey(today, business.rules?.maxDaysAhead ?? 14),
            mealTypes: mealTypes.map((m) => {
                const menu = menuByMeal.get(String(m._id));
                const dishesFor = (variantId) =>
                    menu?.entries?.find((e) => String(e.variantId) === String(variantId))?.items || [];
                return {
                    // Cutoff and "is it served that day" come from the SAME
                    // helper the calendar uses, so a calendar cell and this form
                    // can never disagree about whether a meal is open.
                    ...mealAvailability(m, date, { now, tz, menu }),
                    startTime: m.startTime,
                    endTime: m.endTime,
                    menuNote: menu?.note || "",
                    hasMenu: Boolean(menu && menu.entries?.some((e) => e.items?.length)),
                    // A variant restricted to certain meals only appears on those.
                    variants: variants
                        .filter((v) => !v.mealTypeIds?.length
                            || v.mealTypeIds.some((id) => String(id) === String(m._id)))
                        .map((v) => ({
                            id: v._id, key: v.key, name: v.name,
                            price: v.price, description: v.description,
                            dishes: dishesFor(v._id),
                        })),
                };
            }),
        });
    } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* Book                                                                 */
/* ------------------------------------------------------------------ */
router.post("/api/public/business/:slug/bookings", publicWriteLimiter, async (req, res, next) => {
    try {
        const business = await loadBusiness(req.params.slug);
        const { mealTypeId, date, quantities, party, customerNote, location, answers } = req.body || {};

        const { booking, request, cutoff } = await bookingService.createBooking({
            businessId: business._id,
            mealTypeId, date, quantities,
            party: party || {},
            customerNote, location,
            // Passed straight to the domain, which validates them against this
            // business's configured questions. The route deliberately knows
            // nothing about what a valid answer is.
            answers: answers || {},
            source: "customer",
            requestMeta: meta(req),
        });

        res.status(201).json({
            booking: shapeForCustomer(booking),
            // The customer is told plainly which of the two things happened,
            // and why, rather than being left to infer it from a status word.
            outcome: booking.status === "pending_approval" ? "pending_approval" : "confirmed",
            cutoff: { hasCutoff: cutoff.hasCutoff, passed: cutoff.passed, cutoffAt: cutoff.cutoffAt },
            requestReference: request?.reference || null,
        });
    } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* My bookings                                                          */
/* ------------------------------------------------------------------ */
/**
 * The status experience, in place of accounts and notifications.
 *
 * Enter your phone number, see your bookings. Nothing is verified, which is the
 * accepted V1 tradeoff — so this returns only what the person who made the
 * booking already knows, and no operator notes. Rate limited to make walking
 * through numbers slow.
 */
router.post("/api/public/business/:slug/lookup", lookupLimiter, async (req, res, next) => {
    try {
        const business = await loadBusiness(req.params.slug);
        const phone = normalisePhone(req.body?.phone);
        if (!phone) return res.status(400).json({ message: "Enter a valid mobile number." });

        const party = await BookingParty.findOne({ businessId: business._id, phone }).lean();
        // No party is not an error — it is "you have no bookings here yet", and
        // saying so plainly avoids confirming which numbers exist.
        if (!party) return res.json({ party: null, bookings: [] });

        const bookings = await Booking.find({ businessId: business._id, partyId: party._id })
            .sort({ date: -1, createdAt: -1 }).limit(50).lean();

        res.json({
            party: { name: party.name, phone: party.phone, organisation: party.organisation },
            bookings: await shapeBookingsForCustomer({ business, bookings }),
        });
    } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* By ticket — the QR on the slip                                       */
/* ------------------------------------------------------------------ */
/**
 * One booking, opened by its ticket alone.
 *
 * NO PHONE NUMBER IS ASKED FOR, AND THAT IS THE DESIGN: possession of the
 * ticket IS the proof. It is 128 bits of randomness that nothing derives and
 * nobody can walk to — unlike the reference, which is sequential and is exactly
 * why the reference route demands a phone number as well. Asking for a phone
 * number here would also defeat the point, since the person holding the phone
 * at the counter is often not the person whose number booked the group's lunch.
 *
 * Still rate limited: cheap for the holder, slow for a script.
 */
router.get("/api/public/t/:ticket", lookupLimiter, async (req, res, next) => {
    try {
        const ticket = String(req.params.ticket || "");
        // Shape-checked before the query, and a bad shape answers exactly as a
        // real-but-unknown ticket does — nothing here distinguishes "malformed"
        // from "not found" for anyone probing.
        if (!isTicket(ticket)) return noTicket(res);

        // The ONE lookup in this file not scoped by business, because the
        // ticket arrives without one and identifies a single booking globally.
        // That is safe only because of the uniqueness guaranteed in the model.
        const booking = await Booking.findOne({ ticket }).lean();
        if (!booking) return noTicket(res);

        const business = await Business.findById(booking.businessId).lean();
        if (!business) return noTicket(res);

        const [shaped] = await shapeBookingsForCustomer({ business, bookings: [booking] });

        res.json({
            business: businessCard(business),
            booking: shaped,
            // Repeated at the top level because "already collected" is the
            // headline a counter screen leads with, not a nested detail.
            consumed: shaped.consumed,
        });
    } catch (err) { next(err); }
});

/**
 * The QR itself, as a PNG.
 *
 * Deliberately does NOT touch the database. The image is a pure function of the
 * ticket string, so it caches for a day at every layer and an unknown ticket
 * simply renders a code that leads to a 404 page — which is the same outcome,
 * without giving a prober a way to test tickets by watching status codes.
 */
router.get("/api/public/t/:ticket/qr.png", lookupLimiter, async (req, res, next) => {
    try {
        const ticket = String(req.params.ticket || "");
        if (!isTicket(ticket)) return noTicket(res);

        // The QR encodes the CUSTOMER APP url, never an API one: what a scan
        // must open is the page a human reads, not a JSON document.
        const png = await QRCode.toBuffer(customerUrl(`/t/${ticket}`), {
            errorCorrectionLevel: "M",   // survives a creased, reprinted slip
            margin: 1,
            width: 512,
        });

        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        // helmet() sets Cross-Origin-Resource-Policy: same-origin for the whole
        // API, which is right for JSON but fatal here: the customer app is a
        // DIFFERENT origin, so an <img> pointed at this route is refused by the
        // browser and the customer sees a broken code at the counter. fetch()
        // still works (that is CORS, and it is allowed), so this only shows up
        // in a real page. Relaxed for this one public image, nothing else.
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.send(png);
    } catch (err) { next(err); }
});

/**
 * Several tickets at once, for a device holding a wallet of saved slips.
 *
 * Scoped to one business by slug, so a wallet spanning two canteens asks each
 * of them for its own — a business never learns about tickets that are not its
 * own even when they are sent here. Unknown tickets are simply absent from the
 * response rather than reported, so this cannot be used as an oracle.
 */
router.post("/api/public/business/:slug/tickets", lookupLimiter, async (req, res, next) => {
    try {
        const business = await loadBusiness(req.params.slug);

        const raw = Array.isArray(req.body?.tickets) ? req.body.tickets : [];
        const tickets = [...new Set(raw.map((t) => String(t || "")).filter(isTicket))]
            .slice(0, MAX_TICKET_BATCH);
        if (!tickets.length) return res.json({ bookings: [] });

        const bookings = await Booking.find({ businessId: business._id, ticket: { $in: tickets } })
            .sort({ date: -1, createdAt: -1 }).lean();

        res.json({ bookings: await shapeBookingsForCustomer({ business, bookings }) });
    } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* Calendar                                                             */
/* ------------------------------------------------------------------ */
/**
 * Which days are bookable, and which meals are still open on each.
 *
 * Every cell comes from the SAME two helpers the booking form uses —
 * isDateBookable() (which calls the domain's own horizon rule) and
 * mealAvailability() (which calls cutoffState). Nothing about the rules is
 * restated here, because a calendar that says "open" over a form that says
 * "needs approval" is worse than no calendar at all.
 */
router.get("/api/public/business/:slug/calendar", globalLimiter, async (req, res, next) => {
    try {
        const business = await loadBusiness(req.params.slug);
        const tz = business.timezoneOffsetMinutes ?? 330;
        const now = new Date();
        const today = todayKey(tz, now);
        const maxDate = shiftDateKey(today, business.rules?.maxDaysAhead ?? 14);

        const from = isDateKey(req.query.from) ? req.query.from : today;
        let to = isDateKey(req.query.to) ? req.query.to : shiftDateKey(from, 13);
        if (to < from) to = from;
        // Clamped rather than refused, and the clamped `to` is returned, so a
        // client that asked for a year gets a valid month and can see that it
        // did — an error would just make it retry blindly.
        const last = shiftDateKey(from, MAX_CALENDAR_DAYS - 1);
        if (to > last) to = last;

        const [mealTypes, menus] = await Promise.all([
            MealType.find({ businessId: business._id, active: true, customerBookable: true })
                .sort({ sortOrder: 1, name: 1 }).lean(),
            // The whole weekly plan in one read: a menu is per WEEKDAY, so a
            // 62-day range needs at most seven days' worth of documents, never
            // one query per date.
            WeeklyMenu.find({ businessId: business._id }).lean(),
        ]);

        const menuKey = (weekday, mealTypeId) => `${weekday}|${mealTypeId}`;
        const menuBy = new Map(menus.map((m) => [menuKey(m.weekday, String(m.mealTypeId)), m]));

        const days = [];
        for (let d = from; d <= to; d = shiftDateKey(d, 1)) {
            const weekday = weekdayOf(d);
            days.push({
                date: d,
                weekday,
                bookable: isDateBookable(business, d, now),
                meals: mealTypes.map((m) => mealAvailability(m, d, {
                    now, tz, menu: menuBy.get(menuKey(weekday, String(m._id))),
                })),
            });
        }

        res.json({ from, to, today, maxDate, days });
    } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* Change / cancel my own booking                                       */
/* ------------------------------------------------------------------ */
// The phone number that made the booking must be supplied to act on it. Without
// it, a guessed reference would be enough to cancel a stranger's lunch.
async function assertOwnership(req, business) {
    const phone = normalisePhone(req.body?.phone);
    if (!phone) {
        const e = new Error("Enter the mobile number used for this booking.");
        e.status = 400;
        throw e;
    }
    const booking = await Booking.findOne({ _id: req.params.bookingId, businessId: business._id });
    if (!booking) {
        const e = new Error("Booking not found.");
        e.status = 404;
        throw e;
    }
    // Same 404 as a genuinely missing booking, so a wrong phone number does not
    // reveal that the reference is real.
    if (booking.partySnapshot?.phone !== phone) {
        const e = new Error("Booking not found.");
        e.status = 404;
        throw e;
    }
    return booking;
}

router.post("/api/public/business/:slug/bookings/:bookingId/change",
    publicWriteLimiter, async (req, res, next) => {
        try {
            const business = await loadBusiness(req.params.slug);
            await assertOwnership(req, business);

            const { booking, request, applied } = await bookingService.changeBooking({
                businessId: business._id,
                bookingId: req.params.bookingId,
                quantities: req.body?.quantities,
                customerNote: req.body?.note,
                requestMeta: meta(req),
            });

            res.json({
                booking: shapeForCustomer(booking),
                applied,
                outcome: applied ? "updated" : "change_requested",
                requestReference: request?.reference || null,
            });
        } catch (err) { next(err); }
    });

router.post("/api/public/business/:slug/bookings/:bookingId/cancel",
    publicWriteLimiter, async (req, res, next) => {
        try {
            const business = await loadBusiness(req.params.slug);
            await assertOwnership(req, business);

            const { booking, request, applied } = await bookingService.cancelBooking({
                businessId: business._id,
                bookingId: req.params.bookingId,
                reason: req.body?.reason,
                requestMeta: meta(req),
            });

            res.json({
                booking: shapeForCustomer(booking),
                applied,
                outcome: applied ? "cancelled" : "cancellation_requested",
                requestReference: request?.reference || null,
            });
        } catch (err) { next(err); }
    });

/* ------------------------------------------------------------------ */
/* Shaping                                                              */
/* ------------------------------------------------------------------ */
// THE customer shape. Every customer surface in the product — the booking
// confirmation, the phone lookup, the saved-slip wallet, the ticket page —
// renders what this function returns, so what a customer may see about a
// booking is decided in exactly one place. Add a field here and it appears
// everywhere at once; that is the point, and it is why no route builds its own.
//
// Explicitly built rather than returned wholesale: internal notes, audit fields
// and operator-only flags must never reach the customer app just because
// somebody later adds a column to the schema.
function shapeForCustomer(b) {
    return {
        id: b._id,
        reference: b.reference,
        // The pass this booking opens with, and what its QR encodes. Only ever
        // sent to someone who has already proved they may see the booking —
        // by phone number, by ticket, or by having just created it.
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
        // The answers AS THEY WERE GIVEN, read from the booking's own snapshot
        // rather than re-joined against the current configuration — a question
        // renamed or retired since must not change what this booking says.
        answers: (b.answers || []).map((a) => ({
            key: a.key, label: a.label, type: a.type, value: a.value,
        })),
        // Consumption is a summary, never a status: the booking stays confirmed
        // and keeps counting toward what the kitchen cooked. null = not yet
        // collected, which is the state a counter screen acts on.
        consumed: b.consumedAt
            ? { at: b.consumedAt, by: b.consumedByName || "", via: b.consumedVia || null }
            : null,
        createdAt: b.createdAt,
    };
}

/**
 * The customer shape PLUS everything that depends on the clock and the rules:
 * cutoff state, what the customer may still do, and the request trail.
 *
 * One function for every list of bookings this file returns (phone lookup,
 * ticket batch, single ticket) so those three surfaces cannot drift apart, and
 * so none of them fires a query per booking.
 */
async function shapeBookingsForCustomer({ business, bookings }) {
    if (!bookings?.length) return [];

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
            // The deadline itself, not just whether it has gone: the customer
            // app says "you can still change this yourself for another 2 hours"
            // and "closed 20 minutes ago", and neither sentence can be written
            // from a boolean.
            hasCutoff: c.hasCutoff,
            cutoffAt: c.cutoffAt,
            // What the customer may still do, decided by the SERVER. The client
            // renders these; it never works them out itself, or the two would
            // drift.
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
                // The operator's reason, when they gave one — the closest thing
                // V1 has to telling a customer why.
                note: r.resolutionNote || "",
            })),
        };
    });
}

/** The business identity block every customer surface shows in its header. */
function businessCard(business) {
    return {
        name: business.name,
        slug: business.slug,
        logoUrl: business.logoUrl,
        contactPhone: business.contactPhone,
        addressLine: business.addressLine,
        city: business.city,
        landmark: business.landmark,
    };
}

/** Active custom questions, in display order, with nothing operator-only. */
function publicBookingFields(business) {
    return (business.bookingFields || [])
        .filter((f) => f.active !== false)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type || "text",
            options: f.options || [],
            placeholder: f.placeholder || "",
            help: f.help || "",
            required: Boolean(f.required),
            mealTypeKeys: f.mealTypeKeys || [],
            partyTypeKeys: f.partyTypeKeys || [],
            sortOrder: f.sortOrder || 0,
        }));
}

/**
 * One meal service's availability on one date — THE shared answer, used by both
 * the booking form and the calendar.
 *
 * Extracted rather than duplicated on purpose: these two surfaces show the same
 * fact at different zoom levels, and the day the calendar grows its own copy of
 * the cutoff rule is the day a customer picks a green cell and lands on a form
 * that tells them they are late.
 */
function mealAvailability(mealType, date, { now = new Date(), tz = 330, menu = null } = {}) {
    const c = cutoffState(mealType, date, { now, offsetMinutes: tz });
    return {
        id: mealType._id,
        key: mealType.key,
        name: mealType.name,
        // From the weekly menu. `served: false` means the kitchen doesn't run
        // this service that day at all.
        servedToday: menu ? menu.served !== false : true,
        // The whole point: tells the customer whether a booking here is instant
        // or needs approval, before they fill anything in.
        cutoffPassed: c.passed,
        hasCutoff: c.hasCutoff,
        cutoffAt: c.cutoffAt,
        cutoffTime: mealType.cutoffTime,
        cutoffPreviousDay: Boolean(mealType.cutoffPreviousDay),
    };
}

/**
 * May a customer book this date at all?
 *
 * Answered by ASKING THE DOMAIN rather than by restating its arithmetic: the
 * booking horizon lives in bookingService.assertDateBookable, which throws, so
 * this catches instead of re-deriving. A calendar cell is then true exactly
 * when a submission would be accepted, by construction.
 */
function isDateBookable(business, date, now = new Date()) {
    if (!business.acceptingBookings) return false;
    try {
        bookingService.assertDateBookable({ business, date, now });
        return true;
    } catch {
        return false;
    }
}

/**
 * The single answer for every "that ticket doesn't open anything" case:
 * malformed, unknown, or belonging to a business that no longer exists. One
 * reply for all three, so nothing here can be used to tell them apart.
 */
const noTicket = (res) =>
    res.status(404).json({ message: "We couldn't find that booking.", code: "NO_TICKET" });

/**
 * Server-side answer to "what can this customer still do with this booking?"
 *
 * Past the cutoff the answer is always no. There is no late-request path any
 * more: the deadline is where the customer's control ends, and anything after
 * it is arranged with the canteen, who act from their own dashboard. The app
 * must agree with that, or it offers a button whose API call is refused.
 */
function canCustomerAct(booking, business, cutoff, action) {
    if (["cancelled", "rejected"].includes(booking.status)) return false;
    if (cutoff.passed) return false;
    const r = business.rules || {};
    return action === "edit"
        ? r.allowCustomerEditBeforeCutoff !== false
        : r.allowCustomerCancelBeforeCutoff !== false;
}

module.exports = router;
