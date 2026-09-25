// tests/run.js — the acceptance scenarios, end to end over real HTTP against a
// real database, through the real routers and the real auth middleware.
//
// Everything runs inside a throwaway business created and deleted per run, so
// this is safe against the live cluster and never touches another business's
// data. Time is injected where a scenario needs to be "before" or "after" a
// cutoff, because waiting until 10:31 AM is not a test strategy.
require("dotenv").config();
// The daily-report scenarios need the mailer to consider itself configured
// so the routes and the scheduler run; the transport is stubbed below, so no
// real email is ever sent from this suite.
process.env.BREVO_API_KEY = process.env.BREVO_API_KEY || "test-key";
process.env.MAIL_FROM = process.env.MAIL_FROM || "Test <test@test.local>";
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
const Outlet = require("../models/Outlet");

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
            Outlet.deleteMany({ businessId: { $in: staleIds } }),
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
        permissions: ["dashboard.view", "bookings.view", "menu.view"],
    });
    const viewer = await BusinessUser.create({
        businessId: business._id, name: "ZZ Viewer User", email: "zzviewer@test.local",
        passwordHash: await bcrypt.hash("password123", 10), roleId: viewRole._id,
    });

    // The role a real canteen actually has: one person at the hatch whose
    // entire job is the scanner. ONE permission, and it must be enough.
    const scanRole = await Role.create({
        businessId: business._id, name: "ZZ Counter",
        permissions: ["scan.use"],
    });
    const scanner = await BusinessUser.create({
        businessId: business._id, name: "ZZ Counter Staff", email: "zzcounter@test.local",
        passwordHash: await bcrypt.hash("password123", 10), roleId: scanRole._id,
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
    app.use(require("../routes/customerAccount"));
    app.use(require("../routes/outlets"));
    app.use(require("../routes/reports"));
    app.use(require("../routes/parties"));
    app.use(require("../routes/audit"));
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

    const shiftDays = (key, n) => {
        const [y, m, d] = key.split("-").map(Number);
        const t = new Date(Date.UTC(y, m - 1, d + n));
        return t.toISOString().slice(0, 10);
    };

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
    section("B — a late booking is REFUSED, not queued");
    // The cutoff is a wall for customers. There is no pending state, no queue
    // and nothing to wait on: the kitchen was promised a number at 10:30 and
    // anybody arriving after that arranges it at the counter.
    let refused = null;
    try {
        await bookingService.createBooking({
            businessId: business._id, mealTypeId: lunch._id, date: D,
            quantities: qty({ [veg._id]: 7, [nonVeg._id]: 8 }),
            party: party("Late Co", "9800000002"),
            now: AFTER,
        });
    } catch (err) { refused = err; }
    check("a late customer booking throws", Boolean(refused));
    check("refused with CUTOFF_PASSED", refused?.code === "CUTOFF_PASSED", refused?.code);
    check("the refusal says when it closed", /10:30/.test(refused?.message || ""), refused?.message);
    check("nothing was written", (await Booking.countDocuments({
        businessId: business._id, "partySnapshot.phone": "+919800000002",
    })) === 0);
    t = await totals();
    check("operational quantity UNCHANGED at 15", t.totalQuantity === 15, String(t.totalQuantity));

    /* ================= SCENARIO C ================= */
    section("C — no pending booking can exist any more");
    const anyPending = await Booking.countDocuments({ businessId: business._id, status: "pending_approval" });
    check("no booking is awaiting approval", anyPending === 0, String(anyPending));
    const anyRequest = await BookingRequest.countDocuments({ businessId: business._id });
    check("no request was raised at all", anyRequest === 0, String(anyRequest));

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
    check("veg now 5 across bookings", t.byVariant[String(veg._id)].quantity === 5,
        String(t.byVariant[String(veg._id)]?.quantity));

    /* ================= SCENARIO E ================= */
    section("E — a change after cutoff is refused and the booking is untouched");
    const beforeLines = JSON.stringify((await Booking.findById(a.booking._id).lean()).lines);
    let changeErr = null;
    try {
        await bookingService.changeBooking({
            businessId: business._id, bookingId: a.booking._id,
            quantities: qty({ [veg._id]: 20, [nonVeg._id]: 20 }),
            now: AFTER,
        });
    } catch (err) { changeErr = err; }
    check("refused with CUTOFF_PASSED", changeErr?.code === "CUTOFF_PASSED", changeErr?.code);
    const aMid = await Booking.findById(a.booking._id).lean();
    check("original booking bytes unchanged", JSON.stringify(aMid.lines) === beforeLines);
    check("original still confirmed", aMid.status === "confirmed");
    check("no request was created for it",
        (await BookingRequest.countDocuments({ bookingId: a.booking._id })) === 0);
    t = await totals();
    check("operational quantity unchanged at 15", t.totalQuantity === 15, String(t.totalQuantity));

    // An OPERATOR is never subject to the wall: the person entering it is the
    // decision, which is the whole reason the queue could be removed.
    const opChange = await bookingService.changeBooking({
        businessId: business._id, bookingId: a.booking._id,
        quantities: qty({ [veg._id]: 5, [nonVeg._id]: 10 }),
        byOperator: true, actor: { userId: owner._id, name: owner.name }, now: AFTER,
    });
    check("operator change applies after cutoff", opChange.applied === true);
    check("and it is a direct edit, not a request", opChange.request === null);

    /* ================= SCENARIO F ================= */
    section("F — cancel before cutoff drops the count immediately");
    const f = await bookingService.createBooking({
        businessId: business._id, mealTypeId: lunch._id, date: D,
        quantities: qty({ [veg._id]: 4 }),
        party: party("Cancel Co", "9800000004"), now: BEFORE,
    });
    t = await totals();
    check("count rose to 19", t.totalQuantity === 19, String(t.totalQuantity));
    const fc = await bookingService.cancelBooking({
        businessId: business._id, bookingId: f.booking._id, now: BEFORE,
    });
    check("applied immediately", fc.applied === true);
    check("status cancelled", fc.booking.status === "cancelled");
    t = await totals();
    check("count back to 15", t.totalQuantity === 15, String(t.totalQuantity));

    /* ================= SCENARIO G ================= */
    section("G — a cancellation after cutoff is refused");
    // The food may already be cooking. Dropping out after the count was struck
    // is an operational decision, and it is made at the counter.
    let cancelErr = null;
    try {
        await bookingService.cancelBooking({
            businessId: business._id, bookingId: a.booking._id, now: AFTER,
        });
    } catch (err) { cancelErr = err; }
    check("refused with CUTOFF_PASSED", cancelErr?.code === "CUTOFF_PASSED", cancelErr?.code);
    const aStill = await Booking.findById(a.booking._id).lean();
    check("booking is still confirmed", aStill.status === "confirmed", aStill.status);
    t = await totals();
    check("count unchanged at 15", t.totalQuantity === 15, String(t.totalQuantity));

    // ...and the operator can still cancel it, whatever the clock says.
    const g2src = await bookingService.createBooking({
        businessId: business._id, mealTypeId: lunch._id, date: D,
        quantities: qty({ [veg._id]: 6 }), party: party("Keep Co", "9800000005"), now: BEFORE,
    });
    const opCancel = await bookingService.cancelBooking({
        businessId: business._id, bookingId: g2src.booking._id,
        byOperator: true, actor: { userId: owner._id, name: owner.name }, now: AFTER,
    });
    check("operator cancellation applies after cutoff", opCancel.applied === true);
    check("and raises no request", opCancel.request === null);
    t = await totals();
    check("count back to 15", t.totalQuantity === 15, String(t.totalQuantity));

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
    section("The counter is never subject to the cutoff");
    const opBooking = await bookingService.createBooking({
        businessId: business._id, mealTypeId: lunch._id, date: D,
        quantities: qty({ [veg._id]: 2 }), party: party("Counter Walk-in", "9800000009"),
        source: "operator", actor: { userId: owner._id, name: owner.name }, now: AFTER,
    });
    check("operator booking is confirmed despite being late", opBooking.booking.status === "confirmed");
    check("nothing is queued for anybody to approve", opBooking.request === null);
    // Still flagged, because "how many did we take after the deadline today"
    // is the number that tells an operator their cutoff is set wrong.
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
    await expectFail("a customer cannot change a booking after the cutoff",
        () => bookingService.changeBooking({
            businessId: business._id, bookingId: a.booking._id,
            quantities: qty({ [veg._id]: 3 }), now: AFTER,
        }), "CUTOFF_PASSED");
    await expectFail("a customer cannot cancel a booking after the cutoff",
        () => bookingService.cancelBooking({
            businessId: business._id, bookingId: a.booking._id, now: AFTER,
        }), "CUTOFF_PASSED");

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
    r = await call("POST", `/api/bookings/${a.booking._id}/cancel`, { cookie: viewerCookie });
    check("viewer CANNOT cancel a booking (403)", r.status === 403, String(r.status));
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
    section("HTTP — the dashboard count has no pending half");
    r = await call("GET", `/api/dashboard/today?date=${D}`, { cookie: ownerCookie });
    check("dashboard loads", r.status === 200, String(r.status));
    const dinnerRow = r.data.services.find((s) => s.key === "dinner");
    check("dinner confirmed is 23", dinnerRow.confirmed.totalQuantity === 23,
        String(dinnerRow.confirmed.totalQuantity));
    // The number the kitchen cooks to is now the only number there is.
    check("nothing is pending anywhere", dinnerRow.pending.count === 0, String(dinnerRow.pending.count));
    const lunchRow = r.data.services.find((s) => s.key === "lunch");
    check("meals taken late at the counter are still surfaced", lunchRow.lateAccepted.quantity > 0,
        JSON.stringify(lunchRow.lateAccepted));
    check("variant rows are in configured order",
        dinnerRow.confirmed.byVariant.map((v) => v.variantName).join(",").startsWith("Veg,Non-Veg"),
        dinnerRow.confirmed.byVariant.map((v) => v.variantName).join(","));

    /* ================= audit ================= */
    section("Audit trail");
    await new Promise((res) => setTimeout(res, 700)); // writes are fire-and-forget
    const logs = await AuditLog.find({ businessId: business._id }).lean();
    const actions = new Set(logs.map((l) => l.action));
    check("booking creation recorded", [...actions].some((a) => /Created a booking/i.test(a)));
    check("change recorded", [...actions].some((a) => /[Cc]hanged a booking/.test(a)));
    check("cancellation recorded", [...actions].some((a) => /[Cc]ancel/.test(a)));
    const changed = logs.find((l) => /Operator changed a booking/i.test(l.action));
    check("before AND after quantities kept on a change",
        changed?.before?.totalQuantity === 15 && changed?.after?.totalQuantity === 15,
        JSON.stringify({ b: changed?.before?.totalQuantity, a: changed?.after?.totalQuantity }));
    check("operator attributed on their actions",
        logs.some((l) => String(l.actorUserId) === String(owner._id) && l.actorKind === "operator"));
    check("customer actions attributed to the party, not an operator",
        logs.some((l) => l.actorKind === "customer" && l.actorPartyId));
    // Precise on purpose: an action such as "Signed in with a login ID and
    // password" legitimately contains the WORD. What must never appear is a
    // credential-bearing KEY, or a VALUE shaped like a bcrypt hash or a JWT.
    const leaks = [];
    const walk = (v, path = "") => {
        if (v === null || typeof v !== "object") {
            if (typeof v === "string" && /^\$2[aby]\$\d\d\$|^eyJ[\w-]+\.[\w-]+\./.test(v)) leaks.push(`${path}=<secret-shaped>`);
            return;
        }
        for (const [k, val] of Object.entries(v)) {
            if (/^(password|passwordHash|token|idToken|otp|resetToken|code)$/i.test(k)) leaks.push(`${path}.${k}`);
            walk(val, `${path}.${k}`);
        }
    };
    logs.forEach((l, i) => walk({ before: l.before, after: l.after, details: l.details }, `log[${i}]`));
    check("no credential ever written to the trail", leaks.length === 0, leaks.join(", "));

    /* ================= no requests exist any more ================= */
    section("The approval queue is gone, not hidden");
    const leftover = await BookingRequest.countDocuments({ businessId: business._id });
    check("not one request was created anywhere in this run", leftover === 0, String(leftover));
    const stuck = await Booking.countDocuments({ businessId: business._id, status: "pending_approval" });
    check("and no booking is left waiting on one", stuck === 0, String(stuck));

    /* ================= SCENARIO K =================
       Business-defined booking questions. The whole point is that NOTHING
       about the form is hardcoded: the operator defines the questions, the
       customer answers them, and the answers are snapshotted onto the booking
       so editing the question later never rewrites what was asked. */
    section("K — business-defined booking questions");
    r = await call("PUT", "/api/config/booking-fields", {
        cookie: ownerCookie,
        body: {
            bookingFields: [
                { label: "Employee ID", type: "text", required: true, sortOrder: 0 },
                { label: "Department", type: "select", options: ["Ops", "Kitchen", "Admin"], required: false, sortOrder: 1 },
                { label: "Allergy note", type: "textarea", required: false, sortOrder: 2 },
                { label: "Gate pass", type: "text", required: false, mealTypeKeys: ["dinner"], sortOrder: 3 },
            ],
        },
    });
    check("questions saved", r.status === 200 && r.data.bookingFields.length === 4, JSON.stringify(r.data).slice(0, 200));
    const empKey = r.data.bookingFields[0]?.key;
    check("a stable key is derived from the label", empKey === "employee-id", String(empKey));

    r = await call("GET", `/api/public/business/${SLUG}?date=${D}`);
    check("public form is told what to ask", Array.isArray(r.data.business.bookingFields) && r.data.business.bookingFields.length === 4,
        String(r.data.business?.bookingFields?.length));
    check("scoping reaches the form",
        r.data.business.bookingFields.find((f) => f.key === "gate-pass")?.mealTypeKeys?.[0] === "dinner");

    r = await call("POST", `/api/public/business/${SLUG}/bookings`, {
        body: {
            mealTypeId: String(snacks._id), date: D, quantities: qty({ [veg._id]: 2 }),
            party: party("Answers Co", "9800000091"),
            answers: { "employee-id": "EMP-4417", department: "Kitchen" },
        },
    });
    check("booking with answers accepted", r.status === 201, JSON.stringify(r.data).slice(0, 200));
    const answered = r.data.booking;
    check("answers are snapshotted with their label",
        answered.answers?.some((x) => x.key === "employee-id" && x.value === "EMP-4417" && x.label === "Employee ID"),
        JSON.stringify(answered.answers));
    check("an unanswered optional question is not invented",
        !answered.answers?.some((x) => x.key === "allergy-note"), JSON.stringify(answered.answers));

    r = await call("POST", `/api/public/business/${SLUG}/bookings`, {
        body: {
            mealTypeId: String(snacks._id), date: D, quantities: qty({ [veg._id]: 1 }),
            party: party("No Emp", "9800000092"), answers: { department: "Ops" },
        },
    });
    check("a required question cannot be skipped", r.status === 400 && r.data.code === "ANSWER_REQUIRED",
        `${r.status} ${r.data.code}`);

    // The counter is not the public form. An operator taking a booking by
    // phone may not have the customer's employee ID, and losing the booking
    // over it would be worse than losing the answer. Same distinction the
    // service already makes for acceptingBookings / customerBookable.
    r = await call("POST", "/api/bookings", {
        cookie: ownerCookie,
        body: {
            mealTypeId: String(snacks._id), date: D, quantities: qty({ [veg._id]: 1 }),
            party: party("Counter Walk-in", "9800000099"),
        },
    });
    check("the operator is not blocked by a question they cannot answer", r.status === 201, 
        `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    r = await call("POST", "/api/bookings", {
        cookie: ownerCookie,
        body: {
            mealTypeId: String(snacks._id), date: D, quantities: qty({ [veg._id]: 1 }),
            party: party("Counter Typo", "9800000100"), answers: { department: "Nowhere" },
        },
    });
    check("but the operator still cannot record an off-list answer", r.status === 400,
        `${r.status} ${r.data.code}`);

    r = await call("POST", `/api/public/business/${SLUG}/bookings`, {
        body: {
            mealTypeId: String(snacks._id), date: D, quantities: qty({ [veg._id]: 1 }),
            party: party("Bad Select", "9800000093"),
            answers: { "employee-id": "E1", department: "Marketing" },
        },
    });
    check("an off-list choice is refused", r.status === 400 && r.data.code === "BAD_ANSWER", `${r.status} ${r.data.code}`);

    r = await call("POST", `/api/public/business/${SLUG}/bookings`, {
        body: {
            mealTypeId: String(snacks._id), date: D, quantities: qty({ [veg._id]: 1 }),
            party: party("Smuggler", "9800000094"),
            answers: { "employee-id": "E1", "secret-field": "x" },
        },
    });
    check("a question the operator never defined is refused", r.status === 400 && r.data.code === "BAD_ANSWERS",
        `${r.status} ${r.data.code}`);

    r = await call("POST", `/api/public/business/${SLUG}/bookings`, {
        body: {
            mealTypeId: String(snacks._id), date: D, quantities: qty({ [veg._id]: 1 }),
            party: party("Wrong Meal", "9800000095"),
            answers: { "employee-id": "E1", "gate-pass": "GP-9" },
        },
    });
    check("a question scoped to another meal is refused here", r.status === 400 && r.data.code === "BAD_ANSWERS",
        `${r.status} ${r.data.code}`);

    /* ================= SCENARIO L =================
       The ticket IS the proof. A customer keeps no account, so possession of
       the opaque ticket is what lets them (and only them) see the booking. */
    section("L — booking ticket, its QR, and rehydrating a browser");
    const ticket = answered.ticket;
    check("every booking carries a ticket", typeof ticket === "string" && ticket.length === 22, String(ticket));
    check("the ticket is not the reference", ticket !== answered.reference);

    r = await call("GET", `/api/public/t/${ticket}`);
    check("the ticket opens the booking with no phone", r.status === 200 && r.data.booking?.reference === answered.reference,
        `${r.status}`);
    check("the business is named on the ticket page", r.data.business?.slug === SLUG);
    check("the ticket page says whether it was served", "consumed" in r.data.booking || "consumed" in r.data,
        JSON.stringify(Object.keys(r.data)));

    r = await call("GET", "/api/public/t/zzzzzzzzzzzzzzzzzzzzzz");
    check("an unknown ticket is a flat 404, not an oracle", r.status === 404 && r.data.code === "NO_TICKET",
        `${r.status} ${r.data.code}`);

    const qrRes = await fetch(`${base}/api/public/t/${ticket}/qr.png`);
    const qrBuf = Buffer.from(await qrRes.arrayBuffer());
    check("the QR renders as a real PNG", qrRes.status === 200 && qrBuf.slice(1, 4).toString() === "PNG",
        `${qrRes.status} ${qrBuf.slice(0, 8).toString("hex")}`);
    check("the QR is cacheable", /max-age/.test(qrRes.headers.get("cache-control") || ""),
        String(qrRes.headers.get("cache-control")));
    // helmet() locks the whole API to CORP same-origin. The customer app is a
    // different origin, so without an explicit relaxation here the <img> is
    // refused by the browser and every customer sees a broken code at the
    // counter — while curl and fetch() both still succeed, which is exactly
    // how it survived the first round of testing.
    check("the QR may be embedded from the customer app's origin",
        (qrRes.headers.get("cross-origin-resource-policy") || "") === "cross-origin",
        String(qrRes.headers.get("cross-origin-resource-policy")));

    const secondBooking = await bookingService.createBooking({
        businessId: business._id, mealTypeId: snacks._id, date: D,
        quantities: qty({ [veg._id]: 3 }), party: party("Ledger Co", "9800000096"),
        answers: { "employee-id": "EMP-2" }, now: BEFORE,
    });
    r = await call("POST", `/api/public/business/${SLUG}/tickets`, {
        body: { tickets: [ticket, secondBooking.booking.ticket, "not-a-real-ticket-aaaa"] },
    });
    check("a browser can rehydrate several bookings at once", r.status === 200 && r.data.bookings.length === 2,
        `${r.status} ${r.data.bookings?.length}`);
    check("unknown tickets are dropped silently, not fatal",
        r.data.bookings.every((x) => x.ticket === ticket || x.ticket === secondBooking.booking.ticket));
    check("rehydrated bookings say what the customer may still do",
        r.data.bookings.every((x) => "canEdit" in x && "canCancel" in x));
    // The customer app says "you can still change this yourself for another
    // 2 hours" and "closed 20 minutes ago". Neither sentence can be written
    // from a boolean, so the deadline itself has to travel with the booking.
    check("rehydrated bookings carry the deadline itself, not just whether it passed",
        r.data.bookings.every((x) => "hasCutoff" in x && "cutoffAt" in x),
        JSON.stringify(Object.keys(r.data.bookings[0] || {})));

    /* ================= SCENARIO M ================= */
    section("M — the calendar agrees with the booking form");
    r = await call("GET", `/api/public/business/${SLUG}/calendar?from=${D}&to=${shiftDays(D, 6)}`);
    check("calendar returns a span of days", r.status === 200 && r.data.days?.length === 7,
        `${r.status} ${r.data.days?.length}`);
    check("each day names the meals and their state",
        r.data.days.every((d) => Array.isArray(d.meals) && d.meals.every((m) => "cutoffPassed" in m && "servedToday" in m)));
    const calToday = r.data.days.find((d) => d.date === D);
    const formToday = (await call("GET", `/api/public/business/${SLUG}?date=${D}`)).data;
    const calLunch = calToday.meals.find((m) => String(m.id) === String(lunch._id));
    const formLunch = formToday.mealTypes.find((m) => String(m.id) === String(lunch._id));
    check("a calendar cell can never disagree with the form",
        calLunch.cutoffPassed === formLunch.cutoffPassed && calLunch.servedToday === formLunch.servedToday,
        `cal ${calLunch.cutoffPassed}/${calLunch.servedToday} vs form ${formLunch.cutoffPassed}/${formLunch.servedToday}`);
    r = await call("GET", `/api/public/business/${SLUG}/calendar?from=${D}&to=${shiftDays(D, 400)}`);
    check("an absurd span is clamped, not served", r.status === 200 && r.data.days.length <= 62, String(r.data.days?.length));

    /* ================= SCENARIO N =================
       Serving a meal is not a booking status — a served booking is still a
       confirmed one. The scanner finds it by ticket and marks it once. */
    section("N — scan at the counter and mark served");
    r = await call("GET", `/api/bookings/by-ticket/${ticket}`, { cookie: ownerCookie });
    check("the operator can open a booking from its ticket", r.status === 200 && r.data.booking?.reference === answered.reference,
        `${r.status}`);
    check("the scan result carries everything needed to serve",
        Boolean(r.data.party) && Array.isArray(r.data.requests) && Boolean(r.data.cutoff),
        JSON.stringify(Object.keys(r.data)));
    check("the scan result carries the customer's answers",
        r.data.booking.answers?.some((x) => x.key === "employee-id"), JSON.stringify(r.data.booking.answers));
    const scannedId = r.data.booking._id;

    r = await call("GET", "/api/bookings/by-ticket/zzzzzzzzzzzzzzzzzzzzzz", { cookie: ownerCookie });
    check("an unknown ticket at the counter is a clean 404", r.status === 404 && r.data.code === "NO_TICKET",
        `${r.status} ${r.data.code}`);

    // A live operator who may READ bookings but was never granted
    // bookings.consume. (The shared viewer is deactivated earlier in this
    // suite on purpose, so reusing it would prove a dead session, not a
    // missing permission.)
    const serveRole = await Role.create({
        businessId: business._id, name: "ZZ Counter No-Serve",
        permissions: ["dashboard.view", "bookings.view"],
    });
    await BusinessUser.create({
        businessId: business._id, name: "ZZ No-Serve", email: "zznoserve@test.local",
        passwordHash: await bcrypt.hash("password123", 10), roleId: serveRole._id,
    });
    r = await call("POST", "/api/auth/login", { body: { identifier: "zznoserve@test.local", password: "password123" } });
    const noServeCookie = (r.setCookie || "").split(";")[0];
    r = await call("GET", `/api/bookings/by-ticket/${ticket}`, { cookie: noServeCookie });
    check("they can still look a booking up", r.status === 200, String(r.status));
    r = await call("POST", `/api/bookings/${scannedId}/consume`, { cookie: noServeCookie, body: { via: "scan" } });
    check("but without bookings.consume they cannot serve it", r.status === 403, String(r.status));

    r = await call("POST", `/api/bookings/${scannedId}/consume`, { cookie: ownerCookie, body: { via: "scan" } });
    check("the owner marks it served", r.status === 200 && Boolean(r.data.booking?.consumedAt), `${r.status}`);
    check("who served it is recorded", Boolean(r.data.booking.consumedByUserId), JSON.stringify(r.data.booking.consumedVia));
    check("serving does NOT change the booking's status", r.data.booking.status === "confirmed", r.data.booking.status);

    r = await call("POST", `/api/bookings/${scannedId}/consume`, { cookie: ownerCookie, body: { via: "scan" } });
    check("it cannot be served twice", r.status === 409 && r.data.code === "ALREADY_CONSUMED", `${r.status} ${r.data.code}`);

    r = await call("GET", `/api/public/t/${ticket}`);
    check("the customer's own page now shows it as served", Boolean(r.data.booking?.consumed?.at || r.data.consumed?.at),
        JSON.stringify(r.data.booking?.consumed || r.data.consumed));

    r = await call("POST", `/api/bookings/${scannedId}/unconsume`, { cookie: ownerCookie, body: {} });
    check("a mistake can be undone", r.status === 200 && !r.data.booking.consumedAt, `${r.status}`);
    r = await call("POST", `/api/bookings/${scannedId}/consume`, { cookie: ownerCookie, body: { via: "manual" } });
    check("and it can be served again afterwards", r.status === 200, String(r.status));

    // Nothing can REACH pending_approval any more, but rows from before the
    // cutoff became a wall still exist in real databases, and the counter must
    // keep refusing to hand food over for one. Built directly, because the
    // service will no longer produce it.
    const seedPending = await bookingService.createBooking({
        businessId: business._id, mealTypeId: lunch._id, date: D,
        quantities: qty({ [veg._id]: 2 }), party: party("Not Yet", "9800000097"),
        answers: { "employee-id": "EMP-P" }, now: BEFORE,
    });
    await Booking.updateOne({ _id: seedPending.booking._id },
        { $set: { status: "pending_approval", confirmedAt: null } });
    r = await call("POST", `/api/bookings/${seedPending.booking._id}/consume`, { cookie: ownerCookie, body: { via: "scan" } });
    check("a legacy booking still awaiting approval cannot be served",
        r.status === 409 && r.data.code === "CONSUME_PENDING", `${r.status} ${r.data.code}`);

    const deadBooking = await bookingService.createBooking({
        businessId: business._id, mealTypeId: snacks._id, date: D,
        quantities: qty({ [veg._id]: 1 }), party: party("Gone", "9800000098"),
        answers: { "employee-id": "E9" }, now: BEFORE,
    });
    await bookingService.cancelBooking({
        businessId: business._id, bookingId: deadBooking.booking._id, byOperator: true,
        actor: { userId: owner._id, name: owner.name }, now: BEFORE,
    });
    r = await call("POST", `/api/bookings/${deadBooking.booking._id}/consume`, { cookie: ownerCookie, body: { via: "scan" } });
    check("a cancelled booking cannot be served", r.status === 409 && r.data.code === "NOT_CONSUMABLE",
        `${r.status} ${r.data.code}`);

    const serveAudit = await AuditLog.find({ businessId: business._id, bookingId: scannedId }).lean();
    check("serving is written to the trail", serveAudit.some((x) => /served/i.test(x.action)),
        serveAudit.map((x) => x.action).join(" | ").slice(0, 160));
    check("undoing a served mark is written to the trail too",
        serveAudit.some((x) => /undid|undo/i.test(x.action)),
        serveAudit.map((x) => x.action).join(" | ").slice(0, 160));

    /* ================= SCENARIO P ================= */
    section("P — a role whose entire job is the scanner");
    r = await call("POST", "/api/auth/login", { body: { identifier: "zzcounter@test.local", password: "password123" } });
    check("counter staff can sign in", r.status === 200, String(r.status));
    const scanCookie = (r.setCookie || "").split(";")[0];

    r = await call("GET", "/api/auth/me", { cookie: scanCookie });
    check("they hold exactly one permission", r.data?.permissions?.length === 1,
        JSON.stringify(r.data?.permissions));
    check("...and it is scan.use", r.data?.permissions?.[0] === "scan.use");

    // What they CAN do: everything the hatch needs.
    const scanTarget = await bookingService.createBooking({
        businessId: business._id, mealTypeId: snacks._id, date: D,
        quantities: qty({ [veg._id]: 1 }), party: party("Counter Test", "9800000096"),
        answers: { "employee-id": "E-SCAN" }, now: BEFORE,
    });
    r = await call("GET", `/api/bookings/by-ticket/${scanTarget.booking.ticket}`, { cookie: scanCookie });
    check("they can open a booking from its code", r.status === 200, String(r.status));
    r = await call("GET", `/api/bookings/by-reference/${scanTarget.booking.reference}`, { cookie: scanCookie });
    check("they can open one from its reference too", r.status === 200, String(r.status));
    check("the record carries what the counter needs",
        r.data?.booking?.mealTypeName && Array.isArray(r.data?.booking?.lines),
        JSON.stringify(Object.keys(r.data?.booking || {})).slice(0, 120));
    r = await call("POST", `/api/bookings/${scanTarget.booking._id}/consume`,
        { cookie: scanCookie, body: { via: "scan" } });
    check("they can mark it served", r.status === 200, String(r.status));
    check("and are recorded as the one who did",
        r.data?.booking?.consumedByName === "ZZ Counter Staff", r.data?.booking?.consumedByName);

    // What they CANNOT do: everything else. This is the point of the role.
    r = await call("GET", `/api/bookings?date=${D}`, { cookie: scanCookie });
    check("they CANNOT list everybody's bookings (403)", r.status === 403, String(r.status));
    r = await call("GET", "/api/dashboard/today", { cookie: scanCookie });
    check("they CANNOT open the dashboard (403)", r.status === 403, String(r.status));
    r = await call("POST", "/api/bookings", {
        cookie: scanCookie,
        body: { mealTypeId: snacks._id, date: D, quantities: qty({ [veg._id]: 1 }), party: party("Y", "9800000095") },
    });
    check("they CANNOT create a booking (403)", r.status === 403, String(r.status));
    r = await call("GET", "/api/config", { cookie: scanCookie });
    check("they CANNOT read the business configuration (403)", r.status === 403, String(r.status));

    /* ================= SCENARIO O ================= */
    section("O — the optional customer account");
    r = await call("GET", `/api/public/business/${SLUG}/account/me`);
    check("a signed-out visitor is answered calmly, not with a 401",
        r.status === 200 && r.data.party === null, `${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);

    r = await call("POST", `/api/public/business/${SLUG}/account/start`, { body: { phone: "9800000091" } });
    check("an existing customer is recognised before any OTP", r.status === 200 && r.data.exists === true,
        `${r.status} ${JSON.stringify(r.data)}`);
    r = await call("POST", `/api/public/business/${SLUG}/account/start`, { body: { phone: "9700000000" } });
    check("a new number is reported as new", r.status === 200 && r.data.exists === false, JSON.stringify(r.data));

    r = await call("POST", `/api/public/business/${SLUG}/account/verify`, {
        body: { name: "Faker", phone: "9800000091", idToken: "not-a-real-token" },
    });
    check("a forged OTP token cannot create an account", r.status >= 400, String(r.status));


    /* ================= SCENARIO Q =================
       Multi-outlet. One canteen, several serving points. The outlet is a
       dimension on the booking — chosen once, frozen, enforced by the server
       at every read and at the counter — never a second tenant and never a
       frontend filter. */
    section("Q — outlets: creating them, and they belong to one canteen");
    const D1 = shiftDays(D, 1);   // a clean date: nothing above booked it
    const preOutletLunch = (await confirmedTotals({ businessId: business._id, date: D, mealTypeId: lunch._id })).totalQuantity;

    r = await call("GET", `/api/public/business/${SLUG}?date=${D1}`);
    check("a business with no outlets tells the form none are required", r.data.outletRequired === false && r.data.outlets.length === 0,
        JSON.stringify({ req: r.data.outletRequired, n: r.data.outlets?.length }));

    const mk = async (name) => (await call("POST", "/api/outlets", { cookie: ownerCookie, body: { name } }));
    r = await mk("Main Cafeteria");
    check("owner can create an outlet (201)", r.status === 201 && r.data.outlet?.name === "Main Cafeteria", `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    const main = r.data.outlet;
    const blockA = (await mk("Block A")).data.outlet;
    const blockB = (await mk("Block B")).data.outlet;
    check("...and several of them", Boolean(blockA?.id && blockB?.id));
    r = await mk("Block A");
    check("a duplicate name at the same canteen is refused (409)", r.status === 409, String(r.status));

    const otherOutlet = await Outlet.create({ businessId: otherBusiness._id, name: "Foreign Site", key: "foreign-site" });
    r = await call("GET", "/api/outlets", { cookie: ownerCookie });
    check("the owner lists exactly their own three", r.data.outlets?.length === 3 && !r.data.outlets.some((o) => String(o.id) === String(otherOutlet._id)),
        String(r.data.outlets?.length));
    check("the list says the scope is canteen-wide", r.data.scope === null);
    r = await call("PATCH", `/api/outlets/${otherOutlet._id}`, { cookie: ownerCookie, body: { name: "Hijacked" } });
    check("another canteen's outlet cannot be edited (404)", r.status === 404, String(r.status));
    check("...and was not touched", (await Outlet.findById(otherOutlet._id).lean()).name === "Foreign Site");

    r = await call("GET", "/api/outlets", { cookie: scanCookie });
    check("any signed-in staff member can read the outlet list for the selector", r.status === 200 && r.data.outlets.length === 3, String(r.status));

    /* ---- customer booking with an outlet ---- */
    section("Q — the customer chooses an outlet, and it is stored on the booking");
    r = await call("GET", `/api/public/business/${SLUG}?date=${D1}`);
    check("the form is told an outlet is now required", r.data.outletRequired === true && r.data.outlets.length === 3,
        JSON.stringify({ req: r.data.outletRequired, n: r.data.outlets?.length }));
    check("the form's outlets carry no operator-only fields", !JSON.stringify(r.data.outlets).includes("createdByUserId"));

    const bookPublic = (outletId, phone, quantities, mealTypeId = snacks._id) => call("POST", `/api/public/business/${SLUG}/bookings`, {
        body: { mealTypeId: String(mealTypeId), date: D1, quantities, outletId, party: party("Outlet Co", phone), answers: { "employee-id": "E-O" } },
    });
    r = await bookPublic(undefined, "9800000201", qty({ [veg._id]: 1 }));
    check("a booking WITHOUT an outlet is refused once outlets exist", r.status === 400 && r.data.code === "OUTLET_REQUIRED", `${r.status} ${r.data.code}`);
    r = await bookPublic(String(otherOutlet._id), "9800000201", qty({ [veg._id]: 1 }));
    check("another canteen's outlet id is not available here (404)", r.status === 404 && r.data.code === "NO_OUTLET", `${r.status} ${r.data.code}`);
    r = await bookPublic("not-an-id", "9800000201", qty({ [veg._id]: 1 }));
    check("a garbage outlet id is refused the same way", r.status === 404, String(r.status));

    r = await bookPublic(String(blockA.id), "9800000201", qty({ [veg._id]: 1 }));
    check("a booking with a valid outlet is accepted (201)", r.status === 201, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    const custA = r.data.booking;
    check("the customer is told which outlet", custA.outletName === "Block A" && String(custA.outletId) === String(blockA.id), JSON.stringify({ n: custA.outletName, id: custA.outletId }));
    const custARow = await Booking.findById(custA.id).lean();
    check("the outlet is stored permanently on the booking row", String(custARow.outletId) === String(blockA.id) && custARow.outletName === "Block A");

    r = await call("GET", `/api/public/t/${custA.ticket}`);
    check("the ticket page names the outlet", r.data.booking?.outletName === "Block A", r.data.booking?.outletName);
    r = await call("POST", `/api/public/business/${SLUG}/lookup`, { body: { phone: "9800000201" } });
    check("the phone lookup names the outlet", r.data.bookings?.[0]?.outletName === "Block A");

    /* ---- quantities: overall and per outlet, from the same rows ---- */
    section("Q — overall and per-outlet quantities aggregate the same bookings");
    // Lunch on D1 (open — BEFORE is 09:00 on D, and D1 is tomorrow): A gets
    // veg 3 + non-veg 2, B gets veg 4. Overall must read veg 7 / non-veg 2.
    const svcBook = (outletId, phone, quantities, extra = {}) => bookingService.createBooking({
        businessId: business._id, mealTypeId: lunch._id, date: D1, quantities, outletId,
        party: party("Outlet Lunch", phone), answers: { "employee-id": "E-L" }, now: BEFORE, ...extra,
    });
    const a1 = await svcBook(String(blockA.id), "9800000202", qty({ [veg._id]: 3, [nonVeg._id]: 2 }));
    const b1 = await svcBook(String(blockB.id), "9800000203", qty({ [veg._id]: 4 }));
    check("service-created bookings carry the outlet", a1.booking.outletName === "Block A" && b1.booking.outletName === "Block B");

    const all = await confirmedTotals({ businessId: business._id, date: D1, mealTypeId: lunch._id });
    const onlyA = await confirmedTotals({ businessId: business._id, date: D1, mealTypeId: lunch._id, outlet: String(blockA.id) });
    const onlyB = await confirmedTotals({ businessId: business._id, date: D1, mealTypeId: lunch._id, outlet: String(blockB.id) });
    check("overall lunch: veg 7, non-veg 2, total 9", all.totalQuantity === 9 && all.byVariant[String(veg._id)].quantity === 7 && all.byVariant[String(nonVeg._id)].quantity === 2,
        JSON.stringify(all));
    check("Block A lunch: veg 3, non-veg 2", onlyA.totalQuantity === 5 && onlyA.byVariant[String(veg._id)].quantity === 3, JSON.stringify(onlyA));
    check("Block B lunch: veg 4, no non-veg", onlyB.totalQuantity === 4 && !onlyB.byVariant[String(nonVeg._id)], JSON.stringify(onlyB));
    check("outlet totals add up to the overall — nothing counted twice", onlyA.totalQuantity + onlyB.totalQuantity === all.totalQuantity);

    r = await call("GET", `/api/dashboard/today?date=${D1}`, { cookie: ownerCookie });
    let lunchAll = r.data.services.find((s) => s.key === "lunch");
    check("dashboard (All outlets) lunch is 9", lunchAll.confirmed.totalQuantity === 9, String(lunchAll.confirmed.totalQuantity));
    check("dashboard (All outlets) carries a per-outlet breakdown", Array.isArray(r.data.byOutlet) && r.data.byOutlet.length === 3, String(r.data.byOutlet?.length));
    const lineA = r.data.byOutlet.find((o) => String(o.outletId) === String(blockA.id));
    const lineB = r.data.byOutlet.find((o) => String(o.outletId) === String(blockB.id));
    check("breakdown: Block A lunch 5, Block B lunch 4",
        lineA.services.find((s) => String(s.mealTypeId) === String(lunch._id)).totalQuantity === 5
        && lineB.services.find((s) => String(s.mealTypeId) === String(lunch._id)).totalQuantity === 4,
        JSON.stringify({ a: lineA.totalQuantity, b: lineB.totalQuantity }));
    check("breakdown: Main Cafeteria shows its zero rather than vanishing", r.data.byOutlet.some((o) => String(o.outletId) === String(main.id) && o.totalQuantity === 0));
    check("no 'unassigned' line on a date with no pre-outlet bookings", !r.data.byOutlet.some((o) => o.outletId === null));

    r = await call("GET", `/api/dashboard/today?date=${D1}&outletId=${blockA.id}`, { cookie: ownerCookie });
    check("dashboard scoped to Block A: lunch is 5", r.data.services.find((s) => s.key === "lunch").confirmed.totalQuantity === 5,
        String(r.data.services.find((s) => s.key === "lunch").confirmed.totalQuantity));
    check("...and it names the outlet it describes", r.data.outlet?.name === "Block A" && String(r.data.outletId) === String(blockA.id));
    check("...and has no breakdown of its own", r.data.byOutlet === null);
    r = await call("GET", `/api/dashboard/today?date=${D1}&outletId=${blockB.id}`, { cookie: ownerCookie });
    check("dashboard scoped to Block B: lunch is 4", r.data.services.find((s) => s.key === "lunch").confirmed.totalQuantity === 4);
    r = await call("GET", `/api/dashboard/today?date=${D1}&outletId=${otherOutlet._id}`, { cookie: ownerCookie });
    check("another canteen's outlet on the selector is refused (404, not an empty result)", r.status === 404 && r.data.code === "NO_OUTLET", `${r.status} ${r.data.code}`);

    r = await call("GET", `/api/bookings?date=${D1}&outletId=${blockA.id}`, { cookie: ownerCookie });
    check("bookings list filtered to Block A shows only its rows", r.data.bookings.length === 2 && r.data.bookings.every((b) => b.outletName === "Block A"), String(r.data.bookings?.length));
    r = await call("GET", `/api/bookings?date=${D1}`, { cookie: ownerCookie });
    check("bookings list unfiltered shows every outlet", r.data.bookings.length === 3, String(r.data.bookings?.length));
    r = await call("GET", `/api/bookings/service/${lunch._id}/${D1}?outletId=${blockB.id}`, { cookie: ownerCookie });
    check("the kitchen sheet for one outlet uses the same count", r.data.confirmed.totalQuantity === 4 && r.data.bookings.length === 1);
    r = await call("GET", `/api/reports/day?date=${D1}&outletId=${blockA.id}`, { cookie: ownerCookie });
    check("the day report scoped to an outlet agrees and names it", r.data.totals.confirmedQuantity === 6 && r.data.outlet?.name === "Block A",
        JSON.stringify({ q: r.data.totals?.confirmedQuantity, o: r.data.outlet }));
    r = await call("GET", `/api/reports/summary?from=${D1}&to=${D1}&outletId=${blockB.id}`, { cookie: ownerCookie });
    check("the period summary scoped to an outlet agrees", r.data.totals.quantity === 4, String(r.data.totals?.quantity));

    /* ---- history from before outlets ---- */
    section("Q — bookings from before outlets are intact and explicit");
    const nowLunch = (await confirmedTotals({ businessId: business._id, date: D, mealTypeId: lunch._id })).totalQuantity;
    check("today's pre-outlet lunch count is unchanged", nowLunch === preOutletLunch, `${nowLunch} vs ${preOutletLunch}`);
    const legacy = await Booking.countDocuments({ businessId: business._id, date: D, outletId: { $ne: null } });
    check("no historical booking was silently given an outlet", legacy === 0, String(legacy));
    r = await call("GET", `/api/dashboard/today?date=${D}`, { cookie: ownerCookie });
    check("the overall dashboard shows them as an explicit 'unassigned' line", r.data.byOutlet?.some((o) => o.outletId === null && o.totalQuantity > 0),
        JSON.stringify(r.data.byOutlet?.map((o) => [o.name, o.totalQuantity])));
    r = await call("GET", `/api/bookings?date=${D}&outletId=unassigned`, { cookie: ownerCookie });
    check("and they can be listed on their own", r.status === 200 && r.data.bookings.length > 0 && r.data.bookings.every((b) => !b.outletId));
    r = await call("GET", `/api/bookings/${a.booking._id}`, { cookie: ownerCookie });
    check("a historical booking still opens for the owner", r.status === 200 && !r.data.booking.outletId);

    /* ---- staff scoped to outlets ---- */
    section("Q — staff are assigned to outlets, and the API enforces it");
    const staffOf = async (name, email, permissions, outletIds) => {
        const role = await Role.create({ businessId: business._id, name: `ZZ ${name} role`, permissions });
        await BusinessUser.create({
            businessId: business._id, name, email, roleId: role._id, outletIds,
            passwordHash: await bcrypt.hash("password123", 10),
        });
        const lr = await call("POST", "/api/auth/login", { body: { identifier: email, password: "password123" } });
        return (lr.setCookie || "").split(";")[0];
    };
    const scanA = await staffOf("ZZ Scanner A", "zzscana@test.local", ["scan.use"], [blockA.id]);
    const scanAB = await staffOf("ZZ Scanner AB", "zzscanab@test.local", ["scan.use"], [blockA.id, blockB.id]);
    const viewA = await staffOf("ZZ Viewer A", "zzviewa@test.local", ["dashboard.view", "bookings.view", "reports.view"], [blockA.id]);

    r = await call("GET", "/api/auth/me", { cookie: scanA });
    check("a scanner assigned to Block A is told exactly that", Array.isArray(r.data.outletScope) && r.data.outletScope.length === 1 && String(r.data.outletScope[0]) === String(blockA.id),
        JSON.stringify(r.data.outletScope));
    check("...and sees only Block A in the selector", r.data.outlets?.length === 1 && r.data.outlets[0].name === "Block A");

    // Assignment through the team API, with the same tenant and escalation rules.
    r = await call("POST", "/api/team", { cookie: ownerCookie, body: { name: "ZZ Assigned", email: "zzassigned@test.local", password: "password123", roleId: scanRole._id, outletIds: [blockB.id] } });
    check("the owner can add a person assigned to an outlet", r.status === 201 && r.data.member?.outletNames?.[0] === "Block B", `${r.status} ${JSON.stringify(r.data.member?.outletNames)}`);
    const assignedId = r.data.member?.id;
    r = await call("PATCH", `/api/team/${assignedId}`, { cookie: ownerCookie, body: { outletIds: [otherOutlet._id] } });
    check("another canteen's outlet cannot be assigned (404)", r.status === 404, String(r.status));
    r = await call("PATCH", `/api/team/${assignedId}`, { cookie: ownerCookie, body: { outletIds: [blockA.id, blockB.id] } });
    check("a person can be assigned to several outlets", r.status === 200 && r.data.member.outletIds.length === 2, `${r.status}`);
    r = await call("PATCH", `/api/team/${assignedId}`, { cookie: ownerCookie, body: { outletIds: [] } });
    check("...or widened back to the whole canteen", r.status === 200 && r.data.member.outletIds.length === 0, `${r.status}`);

    const adminA = await staffOf("ZZ Admin A", "zzadmina@test.local", ["users.view", "users.edit", "users.create"], [blockA.id]);
    r = await call("POST", "/api/team", { cookie: adminA, body: { name: "ZZ Wide", email: "zzwide@test.local", password: "password123", outletIds: [] } });
    check("a Block A admin cannot hand out canteen-wide access (403)", r.status === 403 && r.data.code === "OUTLET_NOT_GRANTABLE", `${r.status} ${r.data.code}`);
    r = await call("POST", "/api/team", { cookie: adminA, body: { name: "ZZ Wide", email: "zzwide@test.local", password: "password123", outletIds: [blockB.id] } });
    check("...nor access to Block B, which they don't hold", r.status === 403, String(r.status));

    // Data access through the API, with manipulated parameters.
    r = await call("GET", `/api/bookings?date=${D1}`, { cookie: viewA });
    check("a Block A viewer listing bookings gets ONLY Block A rows", r.status === 200 && r.data.bookings.length === 2 && r.data.bookings.every((b) => String(b.outletId) === String(blockA.id)),
        `${r.status} ${r.data.bookings?.length}`);
    r = await call("GET", `/api/bookings?date=${D1}&outletId=${blockB.id}`, { cookie: viewA });
    check("asking for Block B by query parameter is refused (403)", r.status === 403 && r.data.code === "OUTLET_FORBIDDEN", `${r.status} ${r.data.code}`);
    r = await call("GET", `/api/bookings?date=${D}&outletId=unassigned`, { cookie: viewA });
    check("asking for the pre-outlet history is refused too", r.status === 403, String(r.status));
    r = await call("GET", `/api/bookings/${b1.booking._id}`, { cookie: viewA });
    check("opening a Block B booking by id is refused (403 WRONG_OUTLET)", r.status === 403 && r.data.code === "WRONG_OUTLET", `${r.status} ${r.data.code}`);
    r = await call("GET", `/api/bookings/${a.booking._id}`, { cookie: viewA });
    check("opening a pre-outlet booking is refused for outlet-restricted staff", r.status === 403, String(r.status));
    r = await call("GET", `/api/dashboard/today?date=${D1}`, { cookie: viewA });
    check("their dashboard shows only Block A: lunch 5", r.status === 200 && r.data.services.find((s) => s.key === "lunch").confirmed.totalQuantity === 5,
        `${r.status} ${r.data.services?.find((s) => s.key === "lunch")?.confirmed.totalQuantity}`);
    check("...and the breakdown holds only their outlet", r.data.byOutlet?.length === 1 && String(r.data.byOutlet[0].outletId) === String(blockA.id));
    r = await call("GET", `/api/dashboard/today?date=${D1}&outletId=${blockB.id}`, { cookie: viewA });
    check("their dashboard refuses Block B (403)", r.status === 403, String(r.status));
    r = await call("GET", `/api/reports/day?date=${D1}`, { cookie: viewA });
    check("their day report is Block A only", r.status === 200 && r.data.totals.confirmedQuantity === 6, `${r.status} ${r.data.totals?.confirmedQuantity}`);
    r = await call("GET", `/api/reports/day?date=${D1}&outletId=${blockB.id}`, { cookie: viewA });
    check("their day report refuses Block B", r.status === 403, String(r.status));

    /* ---- QR validation is outlet-specific ---- */
    section("Q — a QR for Block A works at Block A and nowhere else");
    const tA = custA.ticket;
    const tB = b1.booking.ticket;

    r = await call("GET", `/api/bookings/by-ticket/${tA}`, { cookie: scanA });
    check("Block A scanner opens a Block A ticket", r.status === 200 && r.data.booking.outletName === "Block A", `${r.status}`);
    r = await call("GET", `/api/bookings/by-ticket/${tB}`, { cookie: scanA });
    check("Block A scanner is refused a Block B ticket (403 WRONG_OUTLET)", r.status === 403 && r.data.code === "WRONG_OUTLET", `${r.status} ${r.data.code}`);
    check("...with a message that says so and names the outlet", /another outlet/i.test(r.data.message || "") && /Block B/.test(r.data.message || ""), r.data.message);
    r = await call("GET", `/api/bookings/by-reference/${b1.booking.reference}`, { cookie: scanA });
    check("the same by reference", r.status === 403 && r.data.code === "WRONG_OUTLET", `${r.status} ${r.data.code}`);

    r = await call("POST", `/api/bookings/${b1.booking._id}/consume`, { cookie: scanA, body: { via: "scan" } });
    check("Block A scanner CANNOT serve a Block B booking (403)", r.status === 403 && r.data.code === "WRONG_OUTLET", `${r.status} ${r.data.code}`);
    check("...and it was not served", !(await Booking.findById(b1.booking._id).lean()).consumedAt);
    r = await call("POST", `/api/bookings/${b1.booking._id}/consume`, { cookie: scanA, body: { via: "scan", outletId: String(blockB.id) } });
    check("claiming to be at Block B in the request body changes nothing (403)", r.status === 403, `${r.status} ${r.data.code}`);
    r = await call("POST", `/api/bookings/${b1.booking._id}/consume`, { cookie: scanA, body: { via: "scan", outletId: String(blockA.id) } });
    check("nor does claiming the booking is Block A's", r.status === 403 && r.data.code === "WRONG_OUTLET", `${r.status} ${r.data.code}`);

    r = await call("POST", `/api/bookings/${custA.id}/consume`, { cookie: scanA, body: { via: "scan" } });
    check("Block A scanner CAN serve a Block A booking", r.status === 200 && Boolean(r.data.booking.consumedAt), `${r.status} ${r.data.code || ""}`);
    check("the serving is recorded against Block A", String(r.data.booking.consumedAtOutletId) === String(blockA.id), String(r.data.booking.consumedAtOutletId));

    r = await call("POST", `/api/bookings/${b1.booking._id}/consume`, { cookie: scanAB, body: { via: "scan" } });
    check("a scanner assigned to A AND B can serve Block B", r.status === 200 && String(r.data.booking.consumedAtOutletId) === String(blockB.id), `${r.status} ${r.data.code || ""}`);
    r = await call("POST", `/api/bookings/${a1.booking._id}/consume`, { cookie: scanAB, body: { via: "scan" } });
    check("...and Block A", r.status === 200, `${r.status} ${r.data.code || ""}`);
    r = await call("POST", `/api/bookings/${a.booking._id}/consume`, { cookie: scanAB, body: { via: "scan" } });
    check("...but not a pre-outlet booking, which is nobody's outlet", r.status === 403, `${r.status} ${r.data.code || ""}`);

    // A canteen-wide manager standing at Block A (selector on Block A) is held
    // to the same rule for the ticket in their hand.
    const b2 = await svcBook(String(blockB.id), "9800000204", qty({ [veg._id]: 1 }));
    r = await call("GET", `/api/bookings/by-ticket/${b2.booking.ticket}?outletId=${blockA.id}`, { cookie: ownerCookie });
    check("the owner scanning AT Block A is refused a Block B ticket", r.status === 403 && r.data.code === "WRONG_OUTLET", `${r.status} ${r.data.code}`);
    r = await call("POST", `/api/bookings/${b2.booking._id}/consume`, { cookie: ownerCookie, body: { via: "scan", outletId: String(blockA.id) } });
    check("...and cannot serve it from there", r.status === 403 && r.data.code === "WRONG_OUTLET", `${r.status} ${r.data.code}`);
    r = await call("POST", `/api/bookings/${b2.booking._id}/consume`, { cookie: ownerCookie, body: { via: "scan", outletId: String(blockB.id) } });
    check("...but can at Block B", r.status === 200, `${r.status} ${r.data.code || ""}`);
    r = await call("POST", `/api/bookings/${a.booking._id}/consume`, { cookie: ownerCookie, body: { via: "manual", outletId: String(otherOutlet._id) } });
    check("claiming to be at another canteen's outlet is refused", r.status === 403, `${r.status} ${r.data.code || ""}`);

    /* ---- cross-canteen ---- */
    section("Q — the other canteen sees none of it");
    await BusinessUser.create({
        businessId: otherBusiness._id, name: "ZZ Other Owner", email: "zzotherowner@test.local",
        passwordHash: await bcrypt.hash("password123", 10), isOwner: true,
    });
    r = await call("POST", "/api/auth/login", { body: { identifier: "zzotherowner@test.local", password: "password123" } });
    const otherCookie = (r.setCookie || "").split(";")[0];
    r = await call("GET", "/api/outlets", { cookie: otherCookie });
    check("the other canteen lists only its own outlet", r.data.outlets?.length === 1 && r.data.outlets[0].name === "Foreign Site", JSON.stringify(r.data.outlets?.map((o) => o.name)));
    r = await call("GET", `/api/bookings/by-ticket/${tA}`, { cookie: otherCookie });
    check("our ticket is a plain miss at the other canteen (404)", r.status === 404, String(r.status));
    r = await call("POST", `/api/bookings/${custA.id}/consume`, { cookie: otherCookie, body: { via: "scan", outletId: String(blockA.id) } });
    check("our booking cannot be served from the other canteen", r.status === 404, String(r.status));
    r = await call("DELETE", `/api/outlets/${blockA.id}`, { cookie: otherCookie });
    check("our outlet cannot be deactivated from the other canteen (404)", r.status === 404, String(r.status));
    r = await call("GET", `/api/dashboard/today?date=${D1}&outletId=${blockA.id}`, { cookie: otherCookie });
    check("our outlet's numbers cannot be read from the other canteen", r.status === 403 || r.status === 404, String(r.status));
    r = await call("POST", `/api/public/business/zz-other-canteen/bookings`, {
        body: { mealTypeId: String(snacks._id), date: D1, quantities: qty({ [veg._id]: 1 }), outletId: String(blockA.id), party: party("Cross", "9800000205") },
    });
    check("a customer cannot book our outlet through the other canteen's page", r.status === 404 || r.status === 400, String(r.status));

    /* ---- the existing flows still work, outlet retained ---- */
    section("Q — change, cancel and the audit trail keep the outlet");
    r = await call("POST", `/api/public/business/${SLUG}/bookings/${custA.id}/change`, { body: { phone: "9800000201", quantities: qty({ [veg._id]: 2 }) } });
    check("a customer can still change their outlet booking", r.status === 200 && r.data.booking.totalQuantity === 2, `${r.status}`);
    check("...and it keeps its outlet", r.data.booking.outletName === "Block A");
    r = await call("PATCH", `/api/bookings/${b2.booking._id}`, { cookie: viewA, body: { quantities: qty({ [veg._id]: 5 }) } });
    check("a Block A operator cannot edit a Block B booking", r.status === 403, String(r.status));
    r = await call("POST", `/api/bookings/${b2.booking._id}/cancel`, { cookie: ownerCookie, body: { reason: "test" } });
    check("the operator can cancel it", r.status === 200 && r.data.booking.status === "cancelled", `${r.status}`);
    check("a cancelled booking keeps its outlet", r.data.booking.outletName === "Block B" && String(r.data.booking.outletId) === String(blockB.id));
    const cancelledTotal = await confirmedTotals({ businessId: business._id, date: D1, mealTypeId: lunch._id, outlet: String(blockB.id) });
    check("and leaves Block B's count", cancelledTotal.totalQuantity === 4, String(cancelledTotal.totalQuantity));
    r = await call("POST", "/api/bookings", { cookie: ownerCookie, body: { mealTypeId: String(snacks._id), date: D1, quantities: qty({ [veg._id]: 1 }), party: party("Counter", "9800000206") } });
    check("the counter must also choose an outlet now", r.status === 400 && r.data.code === "OUTLET_REQUIRED", `${r.status} ${r.data.code}`);
    r = await call("POST", "/api/bookings", { cookie: viewA, body: { mealTypeId: String(snacks._id), date: D1, quantities: qty({ [veg._id]: 1 }), outletId: String(blockB.id), party: party("Counter", "9800000206") } });
    check("a Block A operator cannot enter a Block B booking at the counter", r.status === 403, `${r.status} ${r.data.code}`);

    await new Promise((res) => setTimeout(res, 700));
    const outletAudit = await AuditLog.find({ businessId: business._id, bookingId: custA.id }).lean();
    check("every audit row for the booking derives its outlet from the booking", outletAudit.length > 0 && outletAudit.every((x) => String(x.outletId) === String(blockA.id)),
        JSON.stringify(outletAudit.map((x) => [x.action, x.outletId])));
    r = await call("GET", `/api/audit?outletId=${blockA.id}`, { cookie: ownerCookie });
    check("the activity log can be read per outlet", r.status === 200 && r.data.entries.length > 0 && r.data.entries.every((e) => String(e.outletId) === String(blockA.id)), `${r.status}`);
    r = await call("GET", `/api/parties/${custARow.partyId}?outletId=${blockB.id}`, { cookie: ownerCookie });
    check("a customer's history filters by outlet too", r.status === 200 && r.data.bookings.length === 0, `${r.status} ${r.data.bookings?.length}`);

    /* ---- deactivation ---- */
    section("Q — a deactivated outlet leaves the picker but keeps its history");
    r = await call("DELETE", `/api/outlets/${blockB.id}`, { cookie: ownerCookie });
    check("the owner deactivates Block B", r.status === 200 && r.data.deactivated === true && r.data.existingBookings >= 2, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
    r = await call("GET", `/api/public/business/${SLUG}?date=${D1}`);
    check("customers no longer see Block B", r.data.outlets.length === 2 && !r.data.outlets.some((o) => o.name === "Block B"), JSON.stringify(r.data.outlets.map((o) => o.name)));
    r = await bookPublic(String(blockB.id), "9800000207", qty({ [veg._id]: 1 }));
    check("a booking for Block B is refused (409 OUTLET_INACTIVE)", r.status === 409 && r.data.code === "OUTLET_INACTIVE", `${r.status} ${r.data.code}`);
    r = await call("GET", `/api/bookings/${b1.booking._id}`, { cookie: ownerCookie });
    check("its existing bookings still open and still say Block B", r.status === 200 && r.data.booking.outletName === "Block B", `${r.status}`);
    r = await call("GET", `/api/dashboard/today?date=${D1}`, { cookie: ownerCookie });
    check("its numbers still appear in the overall breakdown, marked inactive",
        r.data.byOutlet.some((o) => String(o.outletId) === String(blockB.id) && o.active === false && o.totalQuantity === 4),
        JSON.stringify(r.data.byOutlet.map((o) => [o.name, o.active, o.totalQuantity])));
    r = await call("PATCH", `/api/outlets/${blockB.id}`, { cookie: ownerCookie, body: { active: true } });
    check("and it can be reactivated", r.status === 200 && r.data.outlet.active === true);

    /* ================= SCENARIO R =================
       The daily report: a formal email of the day's bookings with the kitchen
       sheet attached as a PDF, sent once a day at the owner's chosen time.
       The mailer's transport is stubbed so every "send" here is captured
       rather than delivered, and the scheduler is driven with an injected
       clock. */
    section("R — daily report: settings are owner-level and validated");
    const mailer = require("../services/mailer");
    const dailyReport = require("../services/dailyReport");
    const scheduler = require("../services/reportScheduler");
    const sentMail = [];
    let transportShouldFail = false;
    mailer.setTransport(async (payload) => {
        if (transportShouldFail) throw Object.assign(new Error("Brevo is down (simulated)"), { status: 502, code: "MAIL_FAILED" });
        sentMail.push(payload);
        return { messageId: `stub-${sentMail.length}` };
    });

    r = await call("GET", "/api/config/daily-report", { cookie: scanCookie });
    check("counter staff cannot read the report settings (403)", r.status === 403, String(r.status));
    r = await call("PATCH", "/api/config/daily-report", { cookie: viewA, body: { enabled: true } });
    check("a viewer cannot change them (403)", r.status === 403, String(r.status));
    r = await call("GET", "/api/config/daily-report", { cookie: ownerCookie });
    check("the owner reads sensible defaults", r.status === 200 && r.data.dailyReport.enabled === false && r.data.dailyReport.time === "21:00" && r.data.dailyReport.recipients.length === 0,
        JSON.stringify(r.data.dailyReport));
    check("the page is told whether email is set up on the server", typeof r.data.dailyReport.mailConfigured === "boolean");

    r = await call("PATCH", "/api/config/daily-report", { cookie: ownerCookie, body: { time: "9pm" } });
    check("a malformed time is refused (400)", r.status === 400, `${r.status} ${r.data?.message}`);
    r = await call("PATCH", "/api/config/daily-report", { cookie: ownerCookie, body: { recipients: ["owner@test.local", "not-an-email"] } });
    check("a bad address is refused and named", r.status === 400 && /not-an-email/.test(r.data?.message || ""), `${r.status} ${r.data?.message}`);
    r = await call("PATCH", "/api/config/daily-report", { cookie: ownerCookie, body: { enabled: true } });
    check("it cannot be switched on with nobody to send to", r.status === 400, `${r.status} ${r.data?.message}`);
    r = await call("PATCH", "/api/config/daily-report", { cookie: ownerCookie, body: { recipients: Array.from({ length: 11 }, (_, i) => `r${i}@test.local`) } });
    check("more than ten recipients is refused", r.status === 400, String(r.status));

    r = await call("PATCH", "/api/config/daily-report", {
        cookie: ownerCookie,
        body: { time: "21:30", recipients: [" ZZOwner@test.local ", "kitchen@test.local", "zzowner@test.local"], enabled: true, includeTomorrow: true },
    });
    check("a valid schedule saves", r.status === 200 && r.data.dailyReport.enabled === true && r.data.dailyReport.time === "21:30", JSON.stringify(r.data));
    check("addresses are trimmed, lower-cased and de-duplicated",
        JSON.stringify(r.data.dailyReport.recipients) === JSON.stringify(["zzowner@test.local", "kitchen@test.local"]), JSON.stringify(r.data.dailyReport.recipients));

    /* ---- the numbers ---- */
    section("R — the report's numbers are the dashboard's numbers");
    const rep = await dailyReport.buildDayReport({ businessId: business._id, date: D });
    const dash = (await call("GET", `/api/dashboard/today?date=${D}`, { cookie: ownerCookie })).data;
    check("total meals match the dashboard exactly", rep.totals.confirmedQuantity === dash.totals.confirmedQuantity, `${rep.totals.confirmedQuantity} vs ${dash.totals.confirmedQuantity}`);
    check("total bookings match the dashboard exactly", rep.totals.bookings === dash.totals.bookings, `${rep.totals.bookings} vs ${dash.totals.bookings}`);
    const repLunch = rep.services.find((s) => s.name === "Lunch");
    const dashLunch = dash.services.find((s) => s.key === "lunch");
    check("per-service, per-option counts match", JSON.stringify(repLunch.confirmed.byVariant.map((v) => v.quantity)) === JSON.stringify(dashLunch.confirmed.byVariant.map((v) => v.quantity)),
        JSON.stringify([repLunch.confirmed.byVariant, dashLunch.confirmed.byVariant]));
    check("late (after-cutoff) bookings are surfaced", rep.totals.late.bookings >= 1 && repLunch.late.bookings >= 1, JSON.stringify(rep.totals.late));
    check("collected meals are counted from the counter's scans", rep.totals.served.bookings >= 1, JSON.stringify(rep.totals.served));
    check("collected never exceeds confirmed", rep.totals.served.quantity <= rep.totals.confirmedQuantity && rep.totals.awaiting.quantity === rep.totals.confirmedQuantity - rep.totals.served.quantity);
    check("cancelled bookings are reported but never counted", rep.totals.cancelled.bookings >= 1
        && rep.services.every((s) => s.bookings.filter((b) => b.status === "confirmed").reduce((n, b) => n + b.totalQuantity, 0) === s.confirmed.totalQuantity),
        JSON.stringify(rep.totals.cancelled));
    check("the outlet breakdown adds up to the overall", rep.byOutlet && rep.byOutlet.reduce((n, o) => n + o.totalQuantity, 0) === rep.totals.confirmedQuantity,
        JSON.stringify(rep.byOutlet?.map((o) => [o.name, o.totalQuantity])));
    check("tomorrow's outlook carries tomorrow's confirmed bookings", rep.tomorrow.date === D1 && rep.tomorrow.confirmedQuantity === (await call("GET", `/api/dashboard/today?date=${D1}`, { cookie: ownerCookie })).data.totals.confirmedQuantity,
        JSON.stringify(rep.tomorrow));
    check("the booking list carries what the kitchen needs", repLunch.bookings.every((b) => b.reference && b.customer && Array.isArray(b.lines) && "consumedAt" in b && "status" in b));
    check("no credential-shaped field reaches the report", !JSON.stringify(rep).includes("passwordHash") && !JSON.stringify(rep).includes("ticket"));

    /* ---- the documents ---- */
    section("R — the email and the PDF");
    const mail = dailyReport.renderEmail(rep, { pdfName: "x.pdf" });
    check("subject is formal and names business and date", mail.subject === `Daily Booking Report — ZZ Test Canteen — ${rep.dateLabel}`, mail.subject);
    check("the body reports the totals", mail.html.includes(String(rep.totals.confirmedQuantity)) && mail.html.includes("By meal service") && mail.html.includes("Lunch"), "");
    check("the body names the attachment", mail.html.includes("x.pdf"));
    check("the body has a plain-text twin", /DAILY BOOKING REPORT/.test(mail.text) && mail.text.includes("Lunch"));
    check("nothing informal in the copy", !/😀|🍽|awesome|hey there/i.test(mail.html));
    check("customer names are HTML-escaped", !mail.html.includes("<script"));
    const pdfBuf = await dailyReport.renderPdf(rep);
    check("the PDF renders", Buffer.isBuffer(pdfBuf) && pdfBuf.slice(0, 5).toString() === "%PDF-" && pdfBuf.length > 3000, `${pdfBuf.length}`);
    // Content streams are compressed, so the words are not greppable; the
    // page tree is. One page or more, and a real /Pages object.
    const pdfText = pdfBuf.toString("latin1");
    const pageCount = Number((pdfText.match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/) || pdfText.match(/\/Count\s+(\d+)[^>]*\/Type\s*\/Pages/) || [])[1] || 0);
    check("the PDF has a page tree with at least one page", pageCount >= 1 && pdfText.includes("/Type /Page"), String(pageCount));

    r = await call("GET", `/api/config/daily-report/preview?date=${D}`, { cookie: ownerCookie });
    check("the settings page can preview the email", r.status === 200 && r.data.subject === mail.subject && r.data.html.includes("Daily Booking Report"), `${r.status}`);
    const pdfRes = await fetch(`${base}/api/config/daily-report/preview.pdf?date=${D}`, { headers: { Cookie: ownerCookie } });
    const pdfBody = Buffer.from(await pdfRes.arrayBuffer());
    check("...and download the PDF exactly as it will be attached", pdfRes.status === 200 && /application\/pdf/.test(pdfRes.headers.get("content-type") || "") && pdfBody.slice(0, 5).toString() === "%PDF-",
        `${pdfRes.status} ${pdfRes.headers.get("content-type")}`);
    r = await call("GET", `/api/config/daily-report/preview?date=${D}`, { cookie: scanCookie });
    check("counter staff cannot preview it (403)", r.status === 403, String(r.status));

    /* ---- sending ---- */
    section("R — send now, send a test, and what each one counts as");
    sentMail.length = 0;
    r = await call("POST", "/api/config/daily-report/send", { cookie: ownerCookie, body: { to: "tester@test.local" } });
    check("a test send goes to that one address only", r.status === 200 && sentMail.length === 1 && sentMail[0].to.length === 1 && sentMail[0].to[0].email === "tester@test.local",
        `${r.status} ${JSON.stringify(sentMail.map((m) => m.to))}`);
    check("with the PDF attached", sentMail[0].attachment?.length === 1 && /\.pdf$/.test(sentMail[0].attachment[0].name)
        && Buffer.from(sentMail[0].attachment[0].content, "base64").slice(0, 5).toString() === "%PDF-", JSON.stringify(sentMail[0].attachment?.map((a) => a.name)));
    check("and both an HTML and a text body", sentMail[0].htmlContent?.includes("Daily Booking Report") && sentMail[0].textContent?.includes("DAILY BOOKING REPORT"));
    r = await call("GET", "/api/config/daily-report", { cookie: ownerCookie });
    check("a test does not count as today's delivery", r.data.dailyReport.lastSent === null, JSON.stringify(r.data.dailyReport.lastSent));
    r = await call("POST", "/api/config/daily-report/send", { cookie: ownerCookie, body: { to: "nope" } });
    check("a bad test address is refused", r.status === 400, String(r.status));

    sentMail.length = 0;
    r = await call("POST", "/api/config/daily-report/send", { cookie: ownerCookie, body: {} });
    check("send-now goes to every configured recipient in one message", r.status === 200 && sentMail.length === 1 && sentMail[0].to.map((t) => t.email).sort().join(",") === "kitchen@test.local,zzowner@test.local",
        `${r.status} ${JSON.stringify(sentMail.map((m) => m.to))}`);
    r = await call("GET", "/api/config/daily-report", { cookie: ownerCookie });
    check("and counts as today's delivery", r.data.dailyReport.lastSent?.date === D, JSON.stringify(r.data.dailyReport.lastSent));
    r = await call("POST", "/api/config/daily-report/send", { cookie: viewA, body: {} });
    check("a viewer cannot trigger a send (403)", r.status === 403, String(r.status));

    /* ---- the scheduler ---- */
    section("R — the scheduler sends once, at the chosen time, and retries sanely");
    process.env.DAILY_REPORT_FORCE = "1";
    const bizNow = () => Business.findById(business._id).lean();
    const clockAt = (hhmm) => zonedInstant(D, hhmm, 330);
    let bz = await bizNow();
    check("not due before the chosen time", scheduler.isDue(bz, clockAt("21:00")) === false);
    check("not due after the time either, because today's already went", scheduler.isDue(bz, clockAt("21:45")) === false);
    await Business.updateOne({ _id: business._id }, { $set: { "dailyReport.lastSent": { date: "", at: null, to: [] }, "dailyReport.lastAttempt": { date: "", at: null, attempts: 0, error: "" } } });
    bz = await bizNow();
    check("due once the time has passed and nothing went today", scheduler.isDue(bz, clockAt("21:31")) === true);
    check("still not due a minute before", scheduler.isDue(bz, clockAt("21:29")) === false);

    // Two processes racing for the same business: exactly one wins the claim.
    const [c1, c2] = await Promise.all([scheduler.claim(bz, clockAt("21:31")), scheduler.claim(bz, clockAt("21:31"))]);
    check("a concurrent claim is won by exactly one caller", [c1, c2].filter(Boolean).length === 1, JSON.stringify([Boolean(c1), Boolean(c2)]));
    await Business.updateOne({ _id: business._id }, { $set: { "dailyReport.lastAttempt": { date: "", at: null, attempts: 0, error: "" } } });

    sentMail.length = 0;
    let t1 = await scheduler.tick(clockAt("21:31"));
    check("a tick past the time sends the report", t1.sent.some((s) => s.business === "ZZ Test Canteen") && sentMail.length === 1, JSON.stringify(t1));
    check("to the configured recipients", sentMail[0]?.to.length === 2, JSON.stringify(sentMail[0]?.to));
    let t2 = await scheduler.tick(clockAt("21:32"));
    check("the next tick does not send it again", !t2.sent.some((s) => s.business === "ZZ Test Canteen") && sentMail.length === 1, JSON.stringify(t2));
    bz = await bizNow();
    check("the send is remembered on the business", bz.dailyReport.lastSent.date === D && bz.dailyReport.lastSent.to.length === 2, JSON.stringify(bz.dailyReport.lastSent));

    // Failure: recorded, retried after a pause, then given up on for the day.
    await Business.updateOne({ _id: business._id }, { $set: { "dailyReport.lastSent": { date: "", at: null, to: [] }, "dailyReport.lastAttempt": { date: "", at: null, attempts: 0, error: "" } } });
    transportShouldFail = true;
    sentMail.length = 0;
    t1 = await scheduler.tick(clockAt("21:31"));
    check("a failed send is reported, not thrown", t1.failed.some((f) => f.business === "ZZ Test Canteen"), JSON.stringify(t1));
    bz = await bizNow();
    check("the error is kept for the settings page", /simulated/.test(bz.dailyReport.lastAttempt.error) && bz.dailyReport.lastAttempt.attempts === 1, JSON.stringify(bz.dailyReport.lastAttempt));
    t2 = await scheduler.tick(clockAt("21:33"));
    check("it is not retried immediately", !t2.failed.some((f) => f.business === "ZZ Test Canteen") && !t2.sent.length, JSON.stringify(t2));
    t2 = await scheduler.tick(clockAt("21:45"));
    bz = await bizNow();
    check("it is retried after the pause", bz.dailyReport.lastAttempt.attempts === 2, JSON.stringify(bz.dailyReport.lastAttempt));
    transportShouldFail = false;
    t2 = await scheduler.tick(clockAt("22:00"));
    bz = await bizNow();
    check("and succeeds once the cause is fixed", t2.sent.some((s) => s.business === "ZZ Test Canteen") && bz.dailyReport.lastSent.date === D && bz.dailyReport.lastAttempt.error === "", JSON.stringify(bz.dailyReport));

    // Switched off: nothing goes, whatever the clock says.
    await Business.updateOne({ _id: business._id }, { $set: { "dailyReport.enabled": false, "dailyReport.lastSent": { date: "", at: null, to: [] } } });
    sentMail.length = 0;
    t2 = await scheduler.tick(clockAt("23:00"));
    check("a switched-off report never sends", sentMail.length === 0 && !t2.sent.some((s) => s.business === "ZZ Test Canteen"));

    await new Promise((res) => setTimeout(res, 700));
    const reportAudit = await AuditLog.find({ businessId: business._id, action: /daily/i }).lean();
    check("every send is on the activity log", reportAudit.some((x) => /Emailed the daily booking report/.test(x.action)) && reportAudit.some((x) => /test daily report/.test(x.action)) && reportAudit.some((x) => /on demand/.test(x.action)),
        reportAudit.map((x) => x.action).join(" | "));
    check("the schedule change is on the log too", reportAudit.some((x) => /Updated the daily report schedule/.test(x.action)));
    mailer.setTransport(null);
    delete process.env.DAILY_REPORT_FORCE;

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
        Outlet.deleteMany({ businessId: { $in: ids } }),
    ]);
    await Business.deleteMany({ _id: { $in: ids } });
    await mongoose.disconnect();

    console.log(out.join("\n"));
    console.log(`\n${"=".repeat(64)}\n  ${pass} passed, ${fail} failed\n${"=".repeat(64)}`);
    process.exit(fail ? 1 : 0);
}

main().catch((err) => { console.error("HARNESS ERROR:", err); process.exit(2); });
