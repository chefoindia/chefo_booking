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
