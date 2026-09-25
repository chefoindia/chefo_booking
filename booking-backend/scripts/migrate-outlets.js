// scripts/migrate-outlets.js — bringing an existing database onto outlets.
//
// WHAT HAPPENS TO EXISTING DATA, stated once, here.
//
//   * Every booking made before this feature has outletId: null. That is a
//     real, explicit value meaning "this business had no outlets when this was
//     booked" — NOT "unknown". Nothing in the application ever guesses an
//     outlet for such a row: it counts in the canteen-wide totals, it appears
//     as "Unassigned (before outlets)" on the overall dashboard, and it stays
//     viewable forever.
//   * Every user has outletIds: [] — canteen-wide — so nobody loses access.
//   * A business with no outlets keeps working exactly as before. Outlets
//     become mandatory on NEW bookings only once the business creates one.
//
// This script therefore does two things, both safe to re-run:
//
//   node scripts/migrate-outlets.js
//       Ensures the new indexes exist and prints, per business, how many
//       bookings have no outlet and which outlets are configured. Changes
//       nothing else.
//
//   node scripts/migrate-outlets.js --assign <businessId> <outletId> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]
//       The ONE explicit way to attach pre-outlet bookings to an outlet — for
//       a canteen that genuinely had a single site all along and wants its
//       history under that site. It only ever touches rows whose outletId is
//       null, only inside the named business, only for an outlet of that
//       business, and prints what it would do first with --dry-run. It is a
//       decision an operator makes on purpose, never something that happens
//       on deploy.
require("dotenv").config();
const mongoose = require("mongoose");

const { connectDB } = require("../config/db");
const Business = require("../models/Business");
const Booking = require("../models/Booking");
const BookingRequest = require("../models/BookingRequest");
const BusinessUser = require("../models/BusinessUser");
const AuditLog = require("../models/AuditLog");
const Outlet = require("../models/Outlet");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const after = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function report() {
    const businesses = await Business.find().select("name slug").sort({ name: 1 }).lean();
    const [unassigned, outlets] = await Promise.all([
        Booking.aggregate([{ $match: { outletId: null } }, { $group: { _id: "$businessId", n: { $sum: 1 } } }]),
        Outlet.aggregate([{ $group: { _id: "$businessId", names: { $push: { name: "$name", active: "$active" } } } }]),
    ]);
    const unBy = new Map(unassigned.map((u) => [String(u._id), u.n]));
    const outBy = new Map(outlets.map((o) => [String(o._id), o.names]));

    console.log("\nBusiness                                 Outlets                                   Bookings without outlet");
    console.log("-".repeat(110));
    for (const b of businesses) {
        const names = (outBy.get(String(b._id)) || []).map((o) => `${o.name}${o.active === false ? " (inactive)" : ""}`).join(", ") || "none";
        console.log(`${b.name.padEnd(40).slice(0, 40)} ${names.padEnd(42).slice(0, 42)} ${unBy.get(String(b._id)) || 0}   [${b._id}]`);
    }
    console.log("\nBookings without an outlet stay as they are. To attach a business's pre-outlet history to one of its outlets on purpose:");
    console.log("  node scripts/migrate-outlets.js --assign <businessId> <outletId> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]\n");
}

async function assign() {
    const businessId = after("--assign");
    const outletId = args[args.indexOf("--assign") + 2];
    if (!mongoose.Types.ObjectId.isValid(businessId) || !mongoose.Types.ObjectId.isValid(outletId)) {
        throw new Error("--assign needs a business id and an outlet id.");
    }
    const business = await Business.findById(businessId).lean();
    if (!business) throw new Error("Business not found.");
    // Tenant rule, even here: an outlet of another business is refused.
    const outlet = await Outlet.findOne({ _id: outletId, businessId }).lean();
    if (!outlet) throw new Error("That outlet does not belong to that business.");

    const filter = { businessId, outletId: null };
    const from = after("--from"), to = after("--to");
    if (from || to) {
        filter.date = {};
        if (from) { if (!DATE_RE.test(from)) throw new Error("--from must be YYYY-MM-DD"); filter.date.$gte = from; }
        if (to) { if (!DATE_RE.test(to)) throw new Error("--to must be YYYY-MM-DD"); filter.date.$lte = to; }
    }

    const count = await Booking.countDocuments(filter);
    console.log(`\n${business.name}: ${count} booking(s) without an outlet${from || to ? ` between ${from || "…"} and ${to || "…"}` : ""}.`);
    if (flag("--dry-run")) {
        console.log(`Dry run — nothing changed. Without --dry-run these would be assigned to "${outlet.name}".\n`);
        return;
    }
    if (!count) { console.log("Nothing to do.\n"); return; }

    const ids = (await Booking.find(filter).select("_id").lean()).map((b) => b._id);
    const set = { $set: { outletId: outlet._id, outletName: outlet.name } };
    const [b, r, a] = await Promise.all([
        Booking.updateMany({ _id: { $in: ids } }, set),
        BookingRequest.updateMany({ bookingId: { $in: ids }, outletId: null }, set),
        AuditLog.updateMany({ bookingId: { $in: ids }, outletId: null }, { $set: { outletId: outlet._id } }),
    ]);
    // Leave a trace of the decision in the trail itself.
    await AuditLog.create({
        businessId, actorKind: "system", actorName: "migrate-outlets",
        action: `Assigned ${b.modifiedCount} pre-outlet bookings to "${outlet.name}"`,
        outletId: outlet._id,
        details: { bookings: b.modifiedCount, requests: r.modifiedCount, auditRows: a.modifiedCount, from: from || null, to: to || null },
    });
    console.log(`Assigned ${b.modifiedCount} booking(s), ${r.modifiedCount} request(s) and ${a.modifiedCount} audit row(s) to "${outlet.name}".\n`);
}

(async () => {
    await connectDB();
    // Idempotent: creates what is missing, leaves what exists. One model at a
    // time and never fatal — an index this MongoDB version cannot build (the
    // report must still run) is warned about, not allowed to block the report.
    for (const m of [Outlet, Booking, BookingRequest, BusinessUser, AuditLog]) {
        try { await m.createIndexes(); }
        catch (e) { console.warn(`  index warning on ${m.modelName}: ${e.message.split("::").pop().trim()}`); }
    }
    console.log("Indexes are in place.");
    if (flag("--assign")) await assign(); else await report();
    await mongoose.disconnect();
})().catch((err) => {
    console.error("Migration failed:", err.message);
    process.exit(1);
});
