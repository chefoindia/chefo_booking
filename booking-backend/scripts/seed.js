// scripts/seed.js — a working business to sign into and book against.
//
// Idempotent: safe to run repeatedly. It creates what is missing and leaves
// anything that already exists alone, so it never clobbers real configuration
// or data if pointed at a live database.
//
//   npm run seed
require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const { connectDB } = require("../config/db");
const Business = require("../models/Business");
const BusinessUser = require("../models/BusinessUser");
const MealType = require("../models/MealType");
const MealVariant = require("../models/MealVariant");

const SLUG = process.env.SEED_BUSINESS_SLUG || "demo-canteen";
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL || "owner@demo.test";
const OWNER_PHONE = process.env.SEED_OWNER_PHONE || "+919000000001";
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD || "booking123";

// Cutoffs chosen to match the acceptance scenarios: breakfast 07:00 (set the
// night before), lunch 10:30, dinner 16:30. Snacks has NO cutoff, which
// exercises the "never closes, always auto-confirm" path.
const MEAL_TYPES = [
    { name: "Breakfast", key: "breakfast", startTime: "08:00", endTime: "09:30", cutoffTime: "07:00", cutoffPreviousDay: false, sortOrder: 0 },
    { name: "Lunch", key: "lunch", startTime: "12:30", endTime: "14:30", cutoffTime: "10:30", cutoffPreviousDay: false, sortOrder: 1 },
    { name: "Snacks", key: "snacks", startTime: "16:30", endTime: "17:30", cutoffTime: "", cutoffPreviousDay: false, sortOrder: 2 },
    { name: "Dinner", key: "dinner", startTime: "20:00", endTime: "22:00", cutoffTime: "16:30", cutoffPreviousDay: false, sortOrder: 3 },
];

// Four variants on purpose — enough to prove nothing is hardcoded to the
// veg/non-veg pair the older Chefo products assume.
const VARIANTS = [
    { name: "Veg", key: "veg", price: 0, sortOrder: 0 },
    { name: "Non-Veg", key: "non-veg", price: 0, sortOrder: 1 },
    { name: "Jain", key: "jain", price: 0, sortOrder: 2 },
    { name: "Special Thali", key: "special-thali", price: 0, sortOrder: 3 },
];

(async () => {
    await connectDB();

    let business = await Business.findOne({ slug: SLUG });
    if (!business) {
        business = await Business.create({
            name: process.env.SEED_BUSINESS_NAME || "Demo Canteen",
            slug: SLUG,
            contactPhone: "+919000000000",
            city: "Bhubaneswar",
            addressLine: "Plot 12, Industrial Estate",
            acceptingBookings: true,
            // Seeded businesses skip the signup wizard, so mark the setup done
            // or the dashboard would send the demo owner back to finish it.
            setupCompletedAt: new Date(),
        });
        console.log(`Created business "${business.name}" (/b/${business.slug})`);
    } else {
        console.log(`Business "${business.name}" already exists — leaving it as it is.`);
    }

    for (const m of MEAL_TYPES) {
        const existing = await MealType.findOne({ businessId: business._id, key: m.key });
        if (existing) { console.log(`  meal service "${m.name}" already exists`); continue; }
        await MealType.create({ businessId: business._id, ...m });
        console.log(`  + meal service "${m.name}" (cutoff ${m.cutoffTime || "none"})`);
    }

    for (const v of VARIANTS) {
        const existing = await MealVariant.findOne({ businessId: business._id, key: v.key });
        if (existing) { console.log(`  option "${v.name}" already exists`); continue; }
        await MealVariant.create({ businessId: business._id, ...v });
        console.log(`  + option "${v.name}"`);
    }

    let owner = await BusinessUser.findOne({ businessId: business._id, isOwner: true });
    if (!owner) {
        owner = await BusinessUser.create({
            businessId: business._id,
            name: process.env.SEED_OWNER_NAME || "Demo Owner",
            email: OWNER_EMAIL,
            phone: OWNER_PHONE,
            passwordHash: await bcrypt.hash(OWNER_PASSWORD, 10),
            // A real password, deliberately — the demo owner is meant to be
            // signed into with the login-ID form, without an SMS.
            passwordSet: true,
            isOwner: true,
            isActive: true,
        });
        console.log(`\nOwner created:\n  mobile:   ${OWNER_PHONE}\n  email:    ${OWNER_EMAIL}\n  password: ${OWNER_PASSWORD}`);
        console.log("  Change this password after signing in.");
    } else {
        console.log(`\nOwner already exists (${owner.email || owner.phone}) — password left unchanged.`);
    }

    console.log(`\nCustomer booking page: /b/${business.slug}`);
    await mongoose.disconnect();
})().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
});
