// tests/run.js — the acceptance scenarios, end to end over real HTTP against a
// real database, through the real routers and the real auth middleware.
//
// Everything runs inside a throwaway business created and deleted per run, so
// this is safe against the live cluster and never touches another business's
// data. Time is injected where a scenario needs to be "before" or "after" a
// cutoff, because waiting until 10:31 AM is not a test strategy.
require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const { connectDB } = require("../config/db");
const Business = require("../models/Business");
const BusinessUser = require("../models/BusinessUser");
const Role = require("../models/Role");
const MealType = require("../models/MealType");
const MealVariant = require("../models/MealVariant");
const Booking = require("../models/Booking");
const BookingRequest = require("../models/BookingRequest");
const BookingParty = require("../models/BookingParty");
const AuditLog = require("../models/AuditLog");

const bookingService = require("../services/bookingService");
const { confirmedTotals } = require("../services/quantity");
const { zonedInstant, cutoffState, todayKey } = require("../utils/time");

let pass = 0, fail = 0;
const out = [];
const check = (name, ok, extra = "") => {
    ok ? pass++ : fail++;
    out.push(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${extra}`}`);
};
const section = (t) => out.push(`\n--- ${t}`);

const TAG = "ZZTEST";
const SLUG = "zz-test-canteen";

async function main() {
    await connectDB();

    /* ---------- clean slate ----------
       Matches BOTH fixture slugs. A run that dies mid-way leaves rows behind,
       and a cleanup that only knew about the primary business meant the next
       run failed on a duplicate slug instead of starting clean. */
    const stale = await Business.find({ slug: { $in: [SLUG, "zz-other-canteen"] } })
        .select("_id").lean();
    const staleIds = stale.map((b) => b._id);
    if (staleIds.length) {
        await Promise.all([
            Booking.deleteMany({ businessId: { $in: staleIds } }),
            BookingRequest.deleteMany({ businessId: { $in: staleIds } }),
            BookingParty.deleteMany({ businessId: { $in: staleIds } }),
            MealType.deleteMany({ businessId: { $in: staleIds } }),
            MealVariant.deleteMany({ businessId: { $in: staleIds } }),
            BusinessUser.deleteMany({ businessId: { $in: staleIds } }),
            Role.deleteMany({ businessId: { $in: staleIds } }),
            AuditLog.deleteMany({ businessId: { $in: staleIds } }),
        ]);
        await Business.deleteMany({ _id: { $in: staleIds } });
    }

    /* ---------- fixtures ---------- */
    const business = await Business.create({
        name: "ZZ Test Canteen", slug: SLUG, acceptingBookings: true,
    });
    const otherBusiness = await Business.create({ name: "ZZ Other", slug: "zz-other-canteen" });

    const [breakfast, lunch, dinner, snacks] = await Promise.all([
        MealType.create({ businessId: business._id, name: "Breakfast", key: "breakfast", cutoffTime: "07:00", sortOrder: 0 }),
        MealType.create({ businessId: business._id, name: "Lunch", key: "lunch", cutoffTime: "10:30", sortOrder: 1 }),
        MealType.create({ businessId: business._id, name: "Dinner", key: "dinner", cutoffTime: "16:30", sortOrder: 2 }),
        MealType.create({ businessId: business._id, name: "Snacks", key: "snacks", cutoffTime: "", sortOrder: 3 }),
    ]);
    const [veg, nonVeg, jain, special] = await Promise.all([
        MealVariant.create({ businessId: business._id, name: "Veg", key: "veg", sortOrder: 0 }),
        MealVariant.create({ businessId: business._id, name: "Non-Veg", key: "non-veg", sortOrder: 1 }),
        MealVariant.create({ businessId: business._id, name: "Jain", key: "jain", sortOrder: 2 }),
        MealVariant.create({ businessId: business._id, name: "Special", key: "special", sortOrder: 3 }),
    ]);
    const otherVariant = await MealVariant.create({
        businessId: otherBusiness._id, name: "Foreign", key: "foreign",
    });

    const owner = await BusinessUser.create({
        businessId: business._id, name: "ZZ Owner", email: "zzowner@test.local",
        passwordHash: await bcrypt.hash("password123", 10), isOwner: true,
    });
    const viewRole = await Role.create({
        businessId: business._id, name: "ZZ Viewer",
        permissions: ["dashboard.view", "bookings.view", "requests.view"],
    });
    const viewer = await BusinessUser.create({
        businessId: business._id, name: "ZZ Viewer User", email: "zzviewer@test.local",
        passwordHash: await bcrypt.hash("password123", 10), roleId: viewRole._id,
    });

    /* ---------- harness app: the REAL routers ---------- */
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(require("../routes/public"));
    app.use(require("../routes/auth"));
    app.use(require("../routes/dashboard"));
    app.use(require("../routes/bookings"));
    app.use(require("../routes/requests"));
    app.use(require("../routes/config"));
    app.use(require("../routes/team"));
    app.use(require("../middleware/errors").notFound);
    app.use(require("../middleware/errors").errorHandler);

    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;

    const call = async (method, path, { body, cookie } = {}) => {
        const res = await fetch(base + path, {
            method,
            headers: {
                ...(body ? { "Content-Type": "application/json" } : {}),
                ...(cookie ? { Cookie: cookie } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 160) }; }
        return { status: res.status, data, setCookie: res.headers.get("set-cookie") };
    };

    // Dates chosen so "today" always has a future date available for the
    // before-cutoff cases regardless of when the suite runs.
    const TODAY = todayKey(330);
    const D = TODAY;

    // Injected clocks: 09:00 IST is before the 10:30 lunch cutoff, 11:00 after.
    const at = (hhmm) => zonedInstant(D, hhmm, 330);
    const BEFORE = at("09:00");
    const AFTER = at("11:00");

    const party = (name, phone, extra = {}) => ({
        name, phone, partyType: "group", organisation: `${name} Site`, ...extra,
    });
    const qty = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [String(k), v]));
    const totals = () => confirmedTotals({ businessId: business._id, date: D, mealTypeId: lunch._id });

    /* ================= SCENARIO A ================= */
    section("A — booking before cutoff is confirmed immediately");
    const a = await bookingService.createBooking({
        businessId: business._id, mealTypeId: lunch._id, date: D,
        quantities: qty({ [veg._id]: 7, [nonVeg._id]: 8 }),
        party: party("ABC Project Site", "9800000001"),
        now: BEFORE,
    });
    check("status is confirmed", a.booking.status === "confirmed", a.booking.status);
    check("total is 15", a.booking.totalQuantity === 15, String(a.booking.totalQuantity));
    check("no approval request raised", a.request === null);
    check("not flagged as late", a.booking.submittedAfterCutoff === false);
    let t = await totals();
    check("operational quantity is 15", t.totalQuantity === 15, String(t.totalQuantity));
    check("veg 7 / non-veg 8 per variant",
        t.byVariant[String(veg._id)].quantity === 7 && t.byVariant[String(nonVeg._id)].quantity === 8,
        JSON.stringify(t.byVariant));

    /* ================= SCENARIO B ================= */
    section("B — late booking is pending, then accepted");
    const b = await bookingService.createBooking({
        businessId: business._id, mealTypeId: lunch._id, date: D,
        quantities: qty({ [veg._id]: 7, [nonVeg._id]: 8 }),
        party: party("Late Co", "9800000002"),
        now: AFTER,
    });
    check("status is pending_approval", b.booking.status === "pending_approval", b.booking.status);
    check("a new_booking request was raised", b.request?.type === "new_booking");
    check("request delta is +15", b.request?.quantityDelta === 15, String(b.request?.quantityDelta));
    t = await totals();
    check("operational quantity UNCHANGED at 15", t.totalQuantity === 15, String(t.totalQuantity));

    await bookingService.resolveRequest({
        businessId: business._id, requestId: b.request._id, decision: "accept",
        actor: { userId: owner._id, name: owner.name }, now: AFTER,
    });
    const bAfter = await Booking.findById(b.booking._id).lean();
    check("accepted -> confirmed", bAfter.status === "confirmed", bAfter.status);
    t = await totals();
    check("operational quantity now 30", t.totalQuantity === 30, String(t.totalQuantity));
    check("still flagged as submitted late", bAfter.submittedAfterCutoff === true);

    /* ================= SCENARIO C ================= */
    section("C — late booking rejected");
    const c = await bookingService.createBooking({
        businessId: business._id, mealTypeId: lunch._id, date: D,
        quantities: qty({ [veg._id]: 5 }),
        party: party("Rejected Co", "9800000003"),
        now: AFTER,
    });
    await bookingService.resolveRequest({
        businessId: business._id, requestId: c.request._id, decision: "reject",
        note: "Kitchen already closed", actor: { userId: owner._id, name: owner.name }, now: AFTER,
    });
    const cAfter = await Booking.findById(c.booking._id).lean();
    check("rejected -> status rejected", cAfter.status === "rejected", cAfter.status);
    t = await totals();
    check("operational quantity still 30", t.totalQuantity === 30, String(t.totalQuantity));
    const cReq = await BookingRequest.findById(c.request._id).lean();
    check("rejection reason retained", cReq.resolutionNote === "Kitchen already closed");
    check("resolver recorded", String(cReq.resolvedByUserId) === String(owner._id));

    /* ================= SCENARIO D ================= */
    section("D — change before cutoff applies directly");
    const d = await bookingService.changeBooking({
        businessId: business._id, bookingId: a.booking._id,
        quantities: qty({ [veg._id]: 5, [nonVeg._id]: 10 }),
        now: BEFORE,
    });
    check("applied directly", d.applied === true);
    check("no request created", d.request === null);
    check("booking total is 15", d.booking.totalQuantity === 15, String(d.booking.totalQuantity));
    t = await totals();
    check("veg now 12 across bookings", t.byVariant[String(veg._id)].quantity === 12,
        String(t.byVariant[String(veg._id)]?.quantity));

    /* ================= SCENARIO E ================= */
    section("E — change after cutoff leaves the booking untouched");
    const beforeLines = JSON.stringify((await Booking.findById(a.booking._id).lean()).lines);
    const e = await bookingService.changeBooking({
        businessId: business._id, bookingId: a.booking._id,
        quantities: qty({ [veg._id]: 20, [nonVeg._id]: 20 }),
        now: AFTER,
    });
    check("not applied", e.applied === false);
    check("change request raised", e.request?.type === "change");
    check("delta is +25", e.request?.quantityDelta === 25, String(e.request?.quantityDelta));
    check("BEFORE state captured on the request", e.request.currentTotal === 15, String(e.request.currentTotal));
    const aMid = await Booking.findById(a.booking._id).lean();
    check("original booking bytes unchanged", JSON.stringify(aMid.lines) === beforeLines);
    check("original still confirmed", aMid.status === "confirmed");
    t = await totals();
    check("operational quantity unchanged at 30", t.totalQuantity === 30, String(t.totalQuantity));

    await bookingService.resolveRequest({
        businessId: business._id, requestId: e.request._id, decision: "accept",
        actor: { userId: owner._id, name: owner.name }, now: AFTER,
    });
    const aAfter = await Booking.findById(a.booking._id).lean();
    check("accepted change applied", aAfter.totalQuantity === 40, String(aAfter.totalQuantity));
    t = await totals();
    check("operational quantity now 55", t.totalQuantity === 55, String(t.totalQuantity));

    // ... and a rejected change must leave everything alone.
    const e2 = await bookingService.changeBooking({
        businessId: business._id, bookingId: a.booking._id,
        quantities: qty({ [veg._id]: 1 }), now: AFTER,
    });
    await bookingService.resolveRequest({
        businessId: business._id, requestId: e2.request._id, decision: "reject",
        actor: { userId: owner._id, name: owner.name }, now: AFTER,
    });
    const aAfter2 = await Booking.findById(a.booking._id).lean();
    check("rejected change leaves booking at 40", aAfter2.totalQuantity === 40, String(aAfter2.totalQuantity));

    /* ================= SCENARIO F ================= */
    section("F — cancel before cutoff drops the count immediately");
    const f = await bookingService.createBooking({
        businessId: business._id, mealTypeId: lunch._id, date: D,
        quantities: qty({ [veg._id]: 4 }),
        party: party("Cancel Co", "9800000004"), now: BEFORE,
    });
    t = await totals();
    check("count rose to 59", t.totalQuantity === 59, String(t.totalQuantity));
    const fc = await bookingService.cancelBooking({
        businessId: business._id, bookingId: f.booking._id, now: BEFORE,
    });
    check("applied immediately", fc.applied === true);
    check("status cancelled", fc.booking.status === "cancelled");
    t = await totals();
    check("count back to 55", t.totalQuantity === 55, String(t.totalQuantity));

    /* ================= SCENARIO G ================= */
    section("G — cancel after cutoff needs approval");
    const g = await bookingService.cancelBooking({
        businessId: business._id, bookingId: b.booking._id, now: AFTER,
    });
    check("not applied", g.applied === false);
    check("cancellation request raised", g.request?.type === "cancellation");
    check("delta is -15", g.request?.quantityDelta === -15, String(g.request?.quantityDelta));
    const bMid = await Booking.findById(b.booking._id).lean();
    check("booking STILL confirmed while pending", bMid.status === "confirmed", bMid.status);
    t = await totals();
    check("count unchanged at 55 while pending", t.totalQuantity === 55, String(t.totalQuantity));

    await bookingService.resolveRequest({
        businessId: business._id, requestId: g.request._id, decision: "accept",
        actor: { userId: owner._id, name: owner.name }, now: AFTER,
    });
    t = await totals();
    check("accepted -> count drops to 40", t.totalQuantity === 40, String(t.totalQuantity));

    // A rejected cancellation must leave the booking confirmed and counted.
    const g2src = await bookingService.createBooking({
        businessId: business._id, mealTypeId: lunch._id, date: D,
        quantities: qty({ [veg._id]: 6 }), party: party("Keep Co", "9800000005"), now: BEFORE,
    });
    const g2 = await bookingService.cancelBooking({
        businessId: business._id, bookingId: g2src.booking._id, now: AFTER,
    });
    await bookingService.resolveRequest({
        businessId: business._id, requestId: g2.request._id, decision: "reject",
        actor: { userId: owner._id, name: owner.name }, now: AFTER,
    });
    const g2After = await Booking.findById(g2src.booking._id).lean();
    check("rejected cancellation leaves it confirmed", g2After.status === "confirmed", g2After.status);
    t = await totals();
    check("count still includes it (46)", t.totalQuantity === 46, String(t.totalQuantity));

    /* ================= SCENARIO H ================= */
    section("H — a second submission is a separate booking");
    const h1 = await bookingService.createBooking({
        businessId: business._id, mealTypeId: dinner._id, date: D,
        quantities: qty({ [veg._id]: 7, [nonVeg._id]: 8 }),
        party: party("Multi Co", "9800000006"), now: BEFORE,
    });
    const h2 = await bookingService.createBooking({
        businessId: business._id, mealTypeId: dinner._id, date: D,
        quantities: qty({ [veg._id]: 5, [nonVeg._id]: 3 }),
        party: party("Multi Co", "9800000006"), now: BEFORE,
    });
    check("two distinct bookings", String(h1.booking._id) !== String(h2.booking._id));
    check("first booking untouched at 15", h1.booking.totalQuantity === 15);
    check("references differ", h1.booking.reference !== h2.booking.reference);
    const hSame = await BookingParty.countDocuments({ businessId: business._id, phone: "+919800000006" });
    check("same phone -> ONE party record", hSame === 1, String(hSame));
    const hT = await confirmedTotals({ businessId: business._id, date: D, mealTypeId: dinner._id });
    check("aggregate veg 12", hT.byVariant[String(veg._id)].quantity === 12, String(hT.byVariant[String(veg._id)]?.quantity));
    check("aggregate non-veg 11", hT.byVariant[String(nonVeg._id)].quantity === 11);
    check("aggregate total 23", hT.totalQuantity === 23, String(hT.totalQuantity));

    /* ================= SCENARIO I ================= */
    section("I — four configurable variants, nothing hardcoded");
    const i = await bookingService.createBooking({
        businessId: business._id, mealTypeId: breakfast._id, date: D,
        quantities: qty({ [veg._id]: 2, [nonVeg._id]: 3, [jain._id]: 4, [special._id]: 5 }),
        party: party("Variety Co", "9800000007"),
        now: at("06:00"), // before the 07:00 breakfast cutoff
    });
    check("all four variants stored", i.booking.lines.length === 4, String(i.booking.lines.length));
    check("total 14", i.booking.totalQuantity === 14, String(i.booking.totalQuantity));
    const iT = await confirmedTotals({ businessId: business._id, date: D, mealTypeId: breakfast._id });
    check("jain counted separately", iT.byVariant[String(jain._id)].quantity === 4);
    check("special counted separately", iT.byVariant[String(special._id)].quantity === 5);
    check("variant NAME snapshotted onto the line",
        i.booking.lines.find((l) => String(l.variantId) === String(jain._id)).variantName === "Jain");

    /* ================= SCENARIO J ================= */
    section("J — each meal service uses its own cutoff");
    const nine = at("09:00");
    check("breakfast (07:00) closed at 09:00", cutoffState(breakfast, D, { now: nine }).passed === true);
    check("lunch (10:30) open at 09:00", cutoffState(lunch, D, { now: nine }).passed === false);
    check("dinner (16:30) open at 09:00", cutoffState(dinner, D, { now: nine }).passed === false);
    const seventeen = at("17:00");
    check("dinner closed at 17:00", cutoffState(dinner, D, { now: seventeen }).passed === true);
    check("snacks has NO cutoff -> never closes", cutoffState(snacks, D, { now: seventeen }).passed === false);
    check("snacks reports hasCutoff false", cutoffState(snacks, D, { now: seventeen }).hasCutoff === false);
    // The boundary minute itself is late: the kitchen was promised a number AT
    // 10:30, not a moment after it.
    check("exactly 10:30:00 counts as closed", cutoffState(lunch, D, { now: at("10:30") }).passed === true);
    check("10:29 is still open", cutoffState(lunch, D, { now: at("10:29") }).passed === false);

    const snackBooking = await bookingService.createBooking({
        businessId: business._id, mealTypeId: snacks._id, date: D,
        quantities: qty({ [veg._id]: 3 }), party: party("Snack Co", "9800000008"), now: at("23:00"),
    });
    check("no-cutoff meal auto-confirms even at 23:00", snackBooking.booking.status === "confirmed");

    /* ================= previous-day cutoff ================= */
    section("Previous-day cutoff");
    const preppedBreakfast = await MealType.create({
        businessId: business._id, name: "Early Breakfast", key: "early-breakfast",
        cutoffTime: "20:00", cutoffPreviousDay: true,
    });
    const tomorrow = require("../utils/time").shiftDateKey(D, 1);
    check("tomorrow's meal closes at 20:00 TODAY",
        cutoffState(preppedBreakfast, tomorrow, { now: at("20:30") }).passed === true);
    check("...and is still open at 19:00 today",
        cutoffState(preppedBreakfast, tomorrow, { now: at("19:00") }).passed === false);

    /* ================= operator override ================= */
    section("Operator bookings bypass the approval queue");
    const opBooking = await bookingService.createBooking({
        businessId: business._id, mealTypeId: lunch._id, date: D,
        quantities: qty({ [veg._id]: 2 }), party: party("Counter Walk-in", "9800000009"),
        source: "operator", actor: { userId: owner._id, name: owner.name }, now: AFTER,
    });
    check("operator booking is confirmed despite being late", opBooking.booking.status === "confirmed");
    check("no request for the operator to approve", opBooking.request === null);
    check("but still recorded as late for reporting", opBooking.booking.submittedAfterCutoff === true);

    /* ================= validation + tenancy ================= */
    section("Validation and tenant isolation");
    const expectFail = async (label, fn, codeOrText) => {
        try { await fn(); check(label, false, "no error thrown"); }
        catch (err) {
            const hay = `${err.code || ""} ${err.message}`;
            check(label, hay.includes(codeOrText), hay.slice(0, 90));
        }
    };
    await expectFail("another business's variant is refused",
        () => bookingService.createBooking({
            businessId: business._id, mealTypeId: lunch._id, date: D,
            quantities: qty({ [otherVariant._id]: 5 }),
            party: party("Sneaky", "9800000010"), now: BEFORE,
        }), "isn't available");
    await expectFail("a past date is refused",
        () => bookingService.createBooking({
            businessId: business._id, mealTypeId: lunch._id, date: "2020-01-01",
            quantities: qty({ [veg._id]: 1 }), party: party("Past", "9800000011"), now: BEFORE,
        }), "PAST_DATE");
    await expectFail("zero quantities are refused",
        () => bookingService.createBooking({
            businessId: business._id, mealTypeId: lunch._id, date: D,
            quantities: qty({ [veg._id]: 0 }), party: party("Zero", "9800000012"), now: BEFORE,
        }), "at least one");
    await expectFail("fractional quantities are refused",
        () => bookingService.createBooking({
            businessId: business._id, mealTypeId: lunch._id, date: D,
            quantities: qty({ [veg._id]: 2.5 }), party: party("Frac", "9800000013"), now: BEFORE,
        }), "whole numbers");
    await expectFail("a bad phone number is refused",
        () => bookingService.createBooking({
            businessId: business._id, mealTypeId: lunch._id, date: D,
            quantities: qty({ [veg._id]: 1 }), party: { name: "X", phone: "123" }, now: BEFORE,
        }), "BAD_PHONE");
    await expectFail("resolving an already-resolved request is refused",
        () => bookingService.resolveRequest({
            businessId: business._id, requestId: c.request._id, decision: "accept",
            actor: { userId: owner._id, name: owner.name },
        }), "ALREADY_RESOLVED");
    await expectFail("a second open request on one booking is refused",
        async () => {
            await bookingService.changeBooking({
                businessId: business._id, bookingId: g2src.booking._id,
                quantities: qty({ [veg._id]: 3 }), now: AFTER,
            });
            await bookingService.changeBooking({
                businessId: business._id, bookingId: g2src.booking._id,
                quantities: qty({ [veg._id]: 4 }), now: AFTER,
            });
        }, "REQUEST_OPEN");

    /* ================= HTTP: auth + permissions ================= */
    section("HTTP — authentication and permissions");
    let r = await call("GET", "/api/dashboard/today");
    check("dashboard requires a session (401)", r.status === 401, String(r.status));

    r = await call("POST", "/api/auth/login", { body: { identifier: "zzowner@test.local", password: "wrong" } });
    check("wrong password rejected (401)", r.status === 401, String(r.status));
    check("...without revealing whether the account exists",
        /don't match/i.test(r.data?.message || ""), r.data?.message);

    r = await call("POST", "/api/auth/login", { body: { identifier: "zzowner@test.local", password: "password123" } });
    check("owner can sign in", r.status === 200, String(r.status));
    const ownerCookie = (r.setCookie || "").split(";")[0];
    check("session cookie is httpOnly", /HttpOnly/i.test(r.setCookie || ""));

    r = await call("POST", "/api/auth/login", { body: { identifier: "zzviewer@test.local", password: "password123" } });
    const viewerCookie = (r.setCookie || "").split(";")[0];

    r = await call("GET", "/api/auth/me", { cookie: ownerCookie });
    check("owner reports unrestricted (permissions null)", r.data?.permissions === null);
    r = await call("GET", "/api/auth/me", { cookie: viewerCookie });
    check("viewer reports exactly their 3 permissions", r.data?.permissions?.length === 3,
        JSON.stringify(r.data?.permissions));

    r = await call("GET", "/api/dashboard/today", { cookie: viewerCookie });
    check("viewer CAN read the dashboard", r.status === 200, String(r.status));
    r = await call("POST", "/api/bookings", {
        cookie: viewerCookie,
        body: { mealTypeId: lunch._id, date: D, quantities: qty({ [veg._id]: 1 }), party: party("X", "9800000014") },
    });
    check("viewer CANNOT create a booking (403)", r.status === 403, String(r.status));
    check("...and is told which permission is missing",
        r.data?.requiredPermission === "bookings.create", r.data?.requiredPermission);
    r = await call("POST", `/api/requests/${g2.request._id}/accept`, { cookie: viewerCookie });
    check("viewer CANNOT resolve requests (403)", r.status === 403, String(r.status));
    r = await call("GET", "/api/config", { cookie: viewerCookie });
    check("viewer CANNOT read config (403)", r.status === 403, String(r.status));
    r = await call("GET", "/api/team", { cookie: viewerCookie });
    check("viewer CANNOT read the team (403)", r.status === 403, String(r.status));

    // Deactivation must bite on the very next request, not at token expiry.
    await BusinessUser.updateOne({ _id: viewer._id }, { $set: { isActive: false }, $inc: { tokenVersion: 1 } });
    r = await call("GET", "/api/dashboard/today", { cookie: viewerCookie });
    check("deactivated user is blocked immediately", r.status === 401 || r.status === 403, String(r.status));

    /* ================= HTTP: the public customer surface ================= */
    section("HTTP — customer surface (no auth)");
    r = await call("GET", `/api/public/business/${SLUG}?date=${D}`);
    check("booking page loads without a session", r.status === 200, String(r.status));
    check("meal services listed", (r.data?.mealTypes || []).length >= 4);
    check("cutoff state exposed per meal",
        r.data.mealTypes.every((m) => typeof m.cutoffPassed === "boolean"));
    check("variants nested per meal", (r.data.mealTypes[0].variants || []).length >= 4);
    check("no operator-only fields leak",
        !JSON.stringify(r.data).includes("internalNote") && !JSON.stringify(r.data).includes("passwordHash"));

    r = await call("POST", `/api/public/business/${SLUG}/bookings`, {
        body: {
            mealTypeId: snacks._id, date: D,
            quantities: qty({ [veg._id]: 2 }),
            party: { name: "Public Person", phone: "9800000020", partyType: "individual" },
        },
    });
    check("public booking accepted (201)", r.status === 201, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
    check("outcome reported to the customer", r.data?.outcome === "confirmed", r.data?.outcome);
    const publicRef = r.data?.booking?.reference;
    const publicId = r.data?.booking?.id;
    check("a reference is returned", Boolean(publicRef), String(publicRef));

    r = await call("POST", `/api/public/business/${SLUG}/lookup`, { body: { phone: "9800000020" } });
    check("phone lookup returns their booking", (r.data?.bookings || []).length === 1, String(r.data?.bookings?.length));
    check("lookup exposes what they may still do",
        typeof r.data.bookings[0].canEdit === "boolean" && typeof r.data.bookings[0].canCancel === "boolean");

    r = await call("POST", `/api/public/business/${SLUG}/lookup`, { body: { phone: "9700000099" } });
    check("unknown number returns empty, not an error", r.status === 200 && r.data?.party === null);

    // Ownership: a reference alone must not be enough to touch a booking.
    r = await call("POST", `/api/public/business/${SLUG}/bookings/${publicId}/cancel`, {
        body: { phone: "9800000099" },
    });
    check("wrong phone cannot cancel someone else's booking (404)", r.status === 404, String(r.status));
    r = await call("POST", `/api/public/business/${SLUG}/bookings/${publicId}/cancel`, { body: {} });
    check("no phone at all is refused (400)", r.status === 400, String(r.status));
    r = await call("POST", `/api/public/business/${SLUG}/bookings/${publicId}/cancel`, {
        body: { phone: "9800000020" },
    });
    check("the real owner CAN cancel", r.status === 200 && r.data?.outcome === "cancelled",
        `${r.status} ${r.data?.outcome}`);

    // Cross-tenant: another business's booking must be invisible here.
    r = await call("POST", `/api/public/business/zz-other-canteen/bookings/${publicId}/cancel`, {
        body: { phone: "9800000020" },
    });
    check("cross-business booking access refused (404)", r.status === 404, String(r.status));

    /* ================= HTTP: dashboard numbers ================= */
    section("HTTP — dashboard reports confirmed and pending separately");
    const pendingChange = await bookingService.changeBooking({
        businessId: business._id, bookingId: h1.booking._id,
        quantities: qty({ [veg._id]: 30, [nonVeg._id]: 30 }), now: at("17:00"),
    });
    r = await call("GET", `/api/dashboard/today?date=${D}`, { cookie: ownerCookie });
    check("dashboard loads", r.status === 200, String(r.status));
    const dinnerRow = r.data.services.find((s) => s.key === "dinner");
    check("dinner confirmed is still 23", dinnerRow.confirmed.totalQuantity === 23,
        String(dinnerRow.confirmed.totalQuantity));
    check("one pending request shown", dinnerRow.pending.count === 1, String(dinnerRow.pending.count));
    check("pending delta shown separately (+45)", dinnerRow.pending.quantityDelta === 45,
        String(dinnerRow.pending.quantityDelta));
    check("pending is NOT folded into confirmed", dinnerRow.confirmed.totalQuantity === 23);
    const lunchRow = r.data.services.find((s) => s.key === "lunch");
    check("late-accepted meals surfaced", lunchRow.lateAccepted.quantity > 0,
        JSON.stringify(lunchRow.lateAccepted));
    check("variant rows are in configured order",
        dinnerRow.confirmed.byVariant.map((v) => v.variantName).join(",").startsWith("Veg,Non-Veg"),
        dinnerRow.confirmed.byVariant.map((v) => v.variantName).join(","));

    /* ================= audit ================= */
    section("Audit trail");
    await new Promise((res) => setTimeout(res, 700)); // writes are fire-and-forget
    const logs = await AuditLog.find({ businessId: business._id }).lean();
    const actions = new Set(logs.map((l) => l.action));
    check("late submission recorded", [...actions].some((a) => /late booking/i.test(a)));
    check("acceptance recorded", [...actions].some((a) => /Accepted a/i.test(a)));
    check("rejection recorded", [...actions].some((a) => /Rejected a/i.test(a)));
    check("cancellation recorded", [...actions].some((a) => /[Cc]ancel/.test(a)));
    const accept = logs.find((l) => /Accepted a change/i.test(l.action));
    check("before AND after quantities kept on an accepted change",
        accept?.before?.totalQuantity === 15 && accept?.after?.totalQuantity === 40,
        JSON.stringify({ b: accept?.before?.totalQuantity, a: accept?.after?.totalQuantity }));
    check("operator attributed on their actions",
        logs.some((l) => String(l.actorUserId) === String(owner._id) && l.actorKind === "operator"));
    check("customer actions attributed to the party, not an operator",
        logs.some((l) => l.actorKind === "customer" && l.actorPartyId));
    check("no credential ever written to the trail",
        !/password|passwordHash|token/i.test(JSON.stringify(logs)));

    /* ================= resolved requests are immutable history ================= */
    section("Request history is preserved");
    const allReqs = await BookingRequest.find({ businessId: business._id }).lean();
    check("resolved requests are kept, not deleted", allReqs.filter((x) => x.status !== "pending").length >= 5,
        String(allReqs.filter((x) => x.status !== "pending").length));
    check("each keeps what was asked and what it replaced",
        allReqs.filter((x) => x.type === "change").every((x) => x.currentTotal >= 0 && x.requestedTotal >= 0));
    const aReqs = allReqs.filter((x) => String(x.bookingId) === String(a.booking._id));
    check("one booking carries several requests over its life", aReqs.length >= 2, String(aReqs.length));

    /* ---------- cleanup ---------- */
    server.close();
    const ids = [business._id, otherBusiness._id];
    await Promise.all([
        Booking.deleteMany({ businessId: { $in: ids } }),
        BookingRequest.deleteMany({ businessId: { $in: ids } }),
        BookingParty.deleteMany({ businessId: { $in: ids } }),
        MealType.deleteMany({ businessId: { $in: ids } }),
        MealVariant.deleteMany({ businessId: { $in: ids } }),
        BusinessUser.deleteMany({ businessId: { $in: ids } }),
        Role.deleteMany({ businessId: { $in: ids } }),
        AuditLog.deleteMany({ businessId: { $in: ids } }),
    ]);
    await Business.deleteMany({ _id: { $in: ids } });
    await mongoose.disconnect();

    console.log(out.join("\n"));
    console.log(`\n${"=".repeat(64)}\n  ${pass} passed, ${fail} failed\n${"=".repeat(64)}`);
    process.exit(fail ? 1 : 0);
}

main().catch((err) => { console.error("HARNESS ERROR:", err); process.exit(2); });
