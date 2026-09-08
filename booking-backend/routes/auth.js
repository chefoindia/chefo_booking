// routes/auth.js — operator sign-in.
//
// Email OR phone, plus a password. See models/BusinessUser.js for why this
// product uses a password where the rest of Chefo uses phone OTP; the session
// it mints is the same shape as the existing owner dashboard's.
const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();

const BusinessUser = require("../models/BusinessUser");
const Business = require("../models/Business");
const Role = require("../models/Role");
const { normalisePhone } = require("../utils/phone");
const { sanitizePermissions, visibleModules, MODULES } = require("../utils/permissions");
const {
    authenticate, signSession, COOKIE_NAME, COOKIE_OPTIONS, actorOf,
} = require("../middleware/authenticate");

router.post("/api/auth/login", async (req, res, next) => {
    try {
        const identifier = String(req.body?.identifier || "").trim();
        const password = String(req.body?.password || "");
        if (!identifier || !password) {
            return res.status(400).json({ message: "Enter your email or mobile number and password." });
        }

        // Either identifier form resolves to the same lookup.
        const phone = normalisePhone(identifier);
        const or = [{ email: identifier.toLowerCase() }];
        if (phone) or.push({ phone });

        const user = await BusinessUser.findOne({ $or: or }).select("+passwordHash");

        // ONE message and one timing for "no such user" and "wrong password".
        // Distinguishing them turns this endpoint into a way to discover who
        // holds an account. The bcrypt compare runs against a dummy hash when
        // the user is missing so the two paths take a similar time.
        const DUMMY = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
        const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY);

        if (!user || !ok) {
            return res.status(401).json({ message: "That email/mobile and password don't match." });
        }
        if (user.isActive === false) {
            return res.status(403).json({
                message: "This account has been deactivated. Contact the business owner.",
                code: "ACCOUNT_DISABLED",
            });
        }

        const business = await Business.findById(user.businessId).select("name slug").lean();
        if (!business) {
            return res.status(403).json({ message: "This account isn't linked to a business." });
        }

        user.lastLoginAt = new Date();
        await user.save();

        res.cookie(COOKIE_NAME, signSession(user), COOKIE_OPTIONS);
        res.json({
            user: { id: user._id, name: user.name, isOwner: user.isOwner },
            business: { id: business._id, name: business.name, slug: business.slug },
        });
    } catch (err) { next(err); }
});

router.post("/api/auth/logout", (req, res) => {
    res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTIONS, maxAge: undefined });
    res.json({ ok: true });
});

/**
 * Who am I, and what may I do?
 *
 * Drives the dashboard shell — which nav items to render, which buttons to
 * offer — and reports the permissions authenticate() resolved fresh for THIS
 * request, so the UI can never claim access the API would refuse.
 */
router.get("/api/auth/me", authenticate, async (req, res, next) => {
    try {
        const business = await Business.findById(req.businessId)
            .select("name slug logoUrl acceptingBookings timezoneOffsetMinutes partyTypes rules").lean();

        let roleName = "";
        if (!req.user.isOwner && req.user.roleId) {
            const role = await Role.findOne({ _id: req.user.roleId, businessId: req.businessId })
                .select("name archivedAt").lean();
            // An archived role grants nothing, so it must not be displayed as
            // though it does.
            roleName = role && !role.archivedAt ? role.name : "";
        }

        res.json({
            user: {
                id: req.user._id,
                name: req.user.name,
                email: req.user.email,
                phone: req.user.phone,
                isOwner: Boolean(req.user.isOwner),
                roleName,
            },
            business,
            // null = owner = unrestricted. The client mirrors the server's own
            // can() semantics on exactly this value.
            permissions: req.user.isOwner ? null : (req.permissions || []),
            modules: req.user.isOwner ? null : visibleModules(actorOf(req)),
            catalogue: MODULES.map((m) => ({
                key: m.key, label: m.label, hint: m.hint || "",
                ownerOnly: Boolean(m.owner), actions: m.actions,
            })),
        });
    } catch (err) { next(err); }
});

/** Change your own password. Bumps tokenVersion, ending every other session. */
router.post("/api/auth/change-password", authenticate, async (req, res, next) => {
    try {
        const current = String(req.body?.currentPassword || "");
        const next_ = String(req.body?.newPassword || "");
        if (next_.length < 8) {
            return res.status(400).json({ message: "Choose a password of at least 8 characters." });
        }

        const user = await BusinessUser.findById(req.user._id).select("+passwordHash");
        if (!(await bcrypt.compare(current, user.passwordHash))) {
            return res.status(403).json({ message: "Your current password isn't right." });
        }

        user.passwordHash = await bcrypt.hash(next_, 10);
        user.tokenVersion += 1;
        await user.save();

        // This session included — the caller is re-issued a cookie so they are
        // not signed out by their own password change.
        res.cookie(COOKIE_NAME, signSession(user), COOKIE_OPTIONS);
        res.json({ ok: true });
    } catch (err) { next(err); }
});

module.exports = router;
