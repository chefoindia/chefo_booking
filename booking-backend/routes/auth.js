// routes/auth.js — operator accounts: register, sign in, recover, profile.
//
// SIGN-IN IS PHONE + OTP. The browser runs Firebase phone auth; the idToken it
// produces is verified here (config/firebaseAdmin.js) and the phone it proves
// control of is matched against the account. Same Firebase project as the rest
// of Chefo, so an owner's number is one identity across the products.
//
// THE ALTERNATIVE is login ID (or email) + password, offered behind a link.
// A password only exists once someone deliberately sets one — from Settings,
// or by using the emailed reset code — so a fresh OTP account has none.
//
// REGISTRATION is self-service and multi-tenant, in two halves:
//   1. signup/verify-otp    mobile verified -> Business + owner + session
//   2. signup/business      (authenticated) details, meal services, options
// Half one is what makes the account real, so an owner who abandons the wizard
// can sign back in and finish; `business.setupCompletedAt` is the marker.
//
// FORGOTTEN PASSWORDS are recovered with a 4-digit code emailed to the address
// on the account, in three separate steps — identifier, then code, then the
// new password. The code is stored only as an HMAC, lives ten minutes, works
// once, and allows five guesses.
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const router = express.Router();

const BusinessUser = require("../models/BusinessUser");
const Business = require("../models/Business");
const Role = require("../models/Role");
const MealType = require("../models/MealType");
const MealVariant = require("../models/MealVariant");
const PasswordReset = require("../models/PasswordReset");
const { normalisePhone } = require("../utils/phone");
const { isTimeOfDay } = require("../utils/time");
const { visibleModules, MODULES } = require("../utils/permissions");
const { customerUrl } = require("../config/brand");
const { verifiedPhoneFrom, isFirebaseReady } = require("../config/firebaseAdmin");
const mailer = require("../services/mailer");
const { record } = require("../services/audit");
const { notify, CONCERN, EVENTS, effectivePrefs, storeKey, deviceLabel } = require("../services/notify");
const {
    authenticate, signSession, COOKIE_NAME, COOKIE_OPTIONS, actorOf,
} = require("../middleware/authenticate");

const clean = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const meta = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] || "" });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

const RESET_MINUTES = 10;
const RESET_MAX_ATTEMPTS = 5;
const RESET_RESEND_SECONDS = 45;
const RESET_TOKEN_MINUTES = 10;

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */
/**
 * One identifier, three possible fields. The phone form wins when the input
 * is a number; an email wins when it contains "@"; anything else is a login
 * ID. Returning the $or rather than a field keeps "9876…" typed into the
 * login-ID box working too — people do that.
 */
function identifierQuery(identifier) {
    const id = String(identifier || "").trim();
    if (!id) return null;
    const or = [];
    const phone = normalisePhone(id);
    if (phone) or.push({ phone });
    if (id.includes("@")) or.push({ email: id.toLowerCase() });
    else or.push({ loginId: id.toLowerCase() });
    return { $or: or };
}

/** Two E.164 numbers are the same person even if one carries a country code. */
const samePhone = (a, b) =>
    String(a || "").replace(/\D/g, "").replace(/^91/, "") ===
    String(b || "").replace(/\D/g, "").replace(/^91/, "");

/** The code is 4 digits; only this survives in the database. */
const hashCode = (code, userId) =>
    crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${userId}:${code}`).digest("hex");

/** "rakesh.biswal@gmail.com" -> "ra•••••@gmail.com" — enough to recognise, not to harvest. */
function maskEmail(email) {
    const [local = "", domain = ""] = String(email).split("@");
    const keep = local.slice(0, Math.min(2, local.length));
    return `${keep}${"•".repeat(Math.max(3, local.length - keep.length))}@${domain}`;
}

/** Is this phone/email/loginId already used by ANY user? (Identifiers are global.) */
async function identifierTaken({ phone, email, loginId }, exceptId = null) {
    const or = [];
    if (phone) or.push({ phone });
    if (email) or.push({ email });
    if (loginId) or.push({ loginId });
    if (!or.length) return null;
    const clash = await BusinessUser.findOne({ $or: or, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })
        .select("phone email loginId").lean();
    if (!clash) return null;
    if (phone && clash.phone === phone) return "phone";
    if (email && clash.email === email) return "email";
    return "loginId";
}

const slugify = (v) =>
    String(v || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** A URL slug for a new business: from its name, made unique with a suffix. */
async function uniqueSlug(name) {
    let base = slugify(name);
    if (base.length < 3) base = `${base}${base ? "-" : ""}canteen`.replace(/^-/, "");
    if (base.length < 3) base = "canteen";
    let slug = base;
    for (let n = 2; await Business.exists({ slug }); n++) slug = `${base}-${n}`;
    return slug;
}

function sessionPayload(user, business) {
    return {
        user: { id: user._id, name: user.name, isOwner: Boolean(user.isOwner) },
        business: { id: business._id, name: business.name, slug: business.slug },
        // The dashboard sends an owner back to the wizard when this is true.
        setupPending: !business.setupCompletedAt,
    };
}

/** An account nobody can sign into with a password, until they set one. */
const unusablePassword = () => bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

/* ------------------------------------------------------------------ */
/* PHONE AVAILABILITY                                                   */
/* ------------------------------------------------------------------ */
/**
 * "Does an account exist for this number?" — asked before any SMS is spent.
 *
 * Sign-in needs it to exist; signup needs it not to. Deliberately narrow: it
 * says only whether the number is taken, never whose it is, and it is rate
 * limited in server.js.
 */
router.post("/api/auth/phone/exists", async (req, res, next) => {
    try {
        const phone = normalisePhone(req.body?.phone);
        if (!phone) return res.status(400).json({ message: "Enter a valid 10-digit mobile number." });
        const user = await BusinessUser.findOne({ phone }).select("isActive").lean();
        res.json({ exists: Boolean(user), phone, otpAvailable: isFirebaseReady() });
    } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* SIGN IN — phone + OTP                                                */
/* ------------------------------------------------------------------ */
/**
 * Step 1: confirm the number has an account before the browser spends an SMS
 * on it, and refuse a deactivated one here rather than after the code.
 */
router.post("/api/auth/login/start", async (req, res, next) => {
    try {
        const phone = normalisePhone(req.body?.phone);
        if (!phone) return res.status(400).json({ message: "Enter a valid 10-digit mobile number." });
        if (!isFirebaseReady()) {
            return res.status(503).json({
                message: "Phone sign-in isn't available right now. Use a login ID and password instead.",
                code: "OTP_UNAVAILABLE",
            });
        }

        const user = await BusinessUser.findOne({ phone }).select("isActive").lean();
        if (!user) {
            return res.status(404).json({
                message: "No account uses that mobile number. Create one instead.",
                code: "NO_ACCOUNT",
            });
        }
        if (user.isActive === false) {
            return res.status(403).json({
                message: "This account has been deactivated. Contact the business owner.",
                code: "ACCOUNT_DISABLED",
            });
        }
        res.json({ ok: true, phone });
    } catch (err) { next(err); }
});

/** Step 2: the verified idToken becomes a session. */
router.post("/api/auth/login/verify-otp", async (req, res, next) => {
    try {
        const claimed = normalisePhone(req.body?.phone);
        const verified = await verifiedPhoneFrom(req.body?.idToken);

        // The token's own number is authoritative; the body is only a hint.
        if (claimed && !samePhone(claimed, verified)) {
            return res.status(400).json({ message: "That code was for a different number." });
        }

        const user = await BusinessUser.findOne({ phone: normalisePhone(verified) });
        if (!user) {
            return res.status(404).json({ message: "No account uses that mobile number.", code: "NO_ACCOUNT" });
        }
        if (user.isActive === false) {
            return res.status(403).json({
                message: "This account has been deactivated. Contact the business owner.",
                code: "ACCOUNT_DISABLED",
            });
        }

        const business = await Business.findById(user.businessId).select("name slug setupCompletedAt").lean();
        if (!business) return res.status(403).json({ message: "This account isn't linked to a business." });

        user.lastLoginAt = new Date();
        await user.save();

        record({
            businessId: user.businessId, actor: { userId: user._id, name: user.name }, requestMeta: meta(req),
            action: "Signed in with a mobile OTP", details: { device: deviceLabel(req.headers["user-agent"]) },
        });
        res.cookie(COOKIE_NAME, signSession(user), COOKIE_OPTIONS);
        res.json(sessionPayload(user, business));
    } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* SIGN IN — the alternative: login ID / email + password               */
/* ------------------------------------------------------------------ */
router.post("/api/auth/login", async (req, res, next) => {
    try {
        const identifier = String(req.body?.identifier || "").trim();
        const password = String(req.body?.password || "");
        if (!identifier || !password) {
            return res.status(400).json({ message: "Enter your login ID and password." });
        }

        const query = identifierQuery(identifier);
        const user = query ? await BusinessUser.findOne(query).select("+passwordHash") : null;

        // ONE message and one timing for "no such user", "no password set" and
        // "wrong password". Distinguishing them turns this endpoint into a way
        // to discover who holds an account. The bcrypt compare runs against a
        // dummy hash when the user is missing so the paths take a similar time.
        const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);

        if (!user || !ok || user.passwordSet === false) {
            return res.status(401).json({ message: "Those details don't match an account. Check them and try again." });
        }
        if (user.isActive === false) {
            return res.status(403).json({
                message: "This account has been deactivated. Contact the business owner.",
                code: "ACCOUNT_DISABLED",
            });
        }

        const business = await Business.findById(user.businessId).select("name slug setupCompletedAt").lean();
        if (!business) return res.status(403).json({ message: "This account isn't linked to a business." });

        user.lastLoginAt = new Date();
        await user.save();

        record({
            businessId: user.businessId, actor: { userId: user._id, name: user.name }, requestMeta: meta(req),
            action: "Signed in with a login ID and password", details: { device: deviceLabel(req.headers["user-agent"]) },
        });
        notify("security.login", {
            businessId: user.businessId, actor: { userId: user._id, name: user.name }, requestMeta: meta(req),
            title: "Password sign-in",
            summary: `${user.name} signed into the dashboard using a login ID and password.`,
            rows: [{ label: "Account", value: `${user.name}${user.isOwner ? " (owner)" : ""}` }],
            concern: CONCERN.security,
        });
        res.cookie(COOKIE_NAME, signSession(user), COOKIE_OPTIONS);
        res.json(sessionPayload(user, business));
    } catch (err) { next(err); }
});

router.post("/api/auth/logout", (req, res) => {
    res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTIONS, maxAge: undefined });
    res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* NOTIFICATION PREFERENCES                                             */
/* ------------------------------------------------------------------ */
/** The catalogue plus this person's effective settings (defaults applied). */
router.get("/api/auth/notifications", authenticate, (req, res) => {
    res.json({
        events: EVENTS.map((e) => ({ key: e.key, group: e.group, label: e.label, hint: e.hint, default: e.default })),
        prefs: effectivePrefs(req.user.notificationPrefs),
        deliversTo: req.user.email || "",
        ownerOnly: !req.user.isOwner,
    });
});

/**
 * Switch events on or off. The body is a LIST — [{ key, on }] — not an object
 * keyed by event: the sanitiser strips dotted object keys from every request,
 * and "security.login" as a key would silently vanish. Unknown keys are ignored.
 */
router.patch("/api/auth/notifications", authenticate, async (req, res, next) => {
    try {
        const list = Array.isArray(req.body?.prefs) ? req.body.prefs : [];
        const known = new Set(EVENTS.map((e) => e.key));
        const user = await BusinessUser.findById(req.user._id);
        const next_ = { ...(user.notificationPrefs || {}) };
        const changed = [];
        for (const item of list) {
            if (item && known.has(item.key) && typeof item.on === "boolean") {
                next_[storeKey(item.key)] = item.on;
                changed.push(`${item.key}=${item.on ? "on" : "off"}`);
            }
        }
        user.notificationPrefs = next_;
        user.markModified("notificationPrefs");
        await user.save();
        record({
            businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
            action: "Changed email notification settings", details: { changed },
        });
        res.json({ prefs: effectivePrefs(user.notificationPrefs) });
    } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* REGISTER — step 1: verified mobile creates the account               */
/* ------------------------------------------------------------------ */
/**
 * The mobile number is proven BEFORE anything is written, so no tenant is ever
 * created for a number nobody controls. Creates the business (with a working
 * default name the next step renames) plus its owner, and signs them in.
 */
router.post("/api/auth/signup/verify-otp", async (req, res, next) => {
    let business = null;
    try {
        const name = clean(req.body?.name, 60);
        const email = clean(req.body?.email, 120).toLowerCase();
        const claimed = normalisePhone(req.body?.phone);
        if (!name) return res.status(400).json({ message: "Enter your name." });
        if (email && !EMAIL_RE.test(email)) return res.status(400).json({ message: "Enter a valid email address." });

        const verified = await verifiedPhoneFrom(req.body?.idToken);
        if (claimed && !samePhone(claimed, verified)) {
            return res.status(400).json({ message: "That code was for a different number." });
        }
        const phone = normalisePhone(verified);

        const taken = await identifierTaken({ phone, email });
        if (taken === "phone") {
            return res.status(409).json({ message: "That mobile number already has an account. Sign in instead.", code: "PHONE_TAKEN" });
        }
        if (taken === "email") {
            return res.status(409).json({ message: "That email already has an account.", code: "EMAIL_TAKEN" });
        }

        const businessName = `${name.split(" ")[0]}'s Canteen`;
        business = await Business.create({
            name: businessName,
            slug: await uniqueSlug(businessName),
            contactPhone: phone,
            contactEmail: email,
            acceptingBookings: true,
            setupCompletedAt: null,   // the wizard has not finished yet
        });

        const user = await BusinessUser.create({
            businessId: business._id,
            name, phone, email,
            // Nobody chose this. See BusinessUser.passwordSet.
            passwordHash: await unusablePassword(),
            passwordSet: false,
            isOwner: true,
            isActive: true,
            lastLoginAt: new Date(),
        });

        record({
            businessId: business._id, actor: { userId: user._id, name: user.name }, requestMeta: meta(req),
            action: "Verified their mobile and started registration",
        });

        res.cookie(COOKIE_NAME, signSession(user), COOKIE_OPTIONS);
        res.status(201).json(sessionPayload(user, business));
    } catch (err) {
        // Roll back a half-made tenant so the number is free to retry.
        if (business?._id) {
            await Promise.allSettled([
                BusinessUser.deleteMany({ businessId: business._id }),
                Business.deleteOne({ _id: business._id }),
            ]);
        }
        next(err);
    }
});

/* ------------------------------------------------------------------ */
/* REGISTER — step 2: the business itself                               */
/* ------------------------------------------------------------------ */
/**
 * Authenticated, because step 1 already signed them in. Renames the business,
 * fills its details, creates any meal services and options the wizard
 * collected, and marks the setup finished.
 *
 * Idempotent enough to be re-run: an owner who comes back to finish simply
 * overwrites what they left, and meal services are matched by key so a repeat
 * submission updates rather than duplicates.
 */
router.post("/api/auth/signup/business", authenticate, async (req, res, next) => {
    try {
        if (!req.user.isOwner) {
            return res.status(403).json({ message: "Only the business owner can complete setup." });
        }
        const business = await Business.findById(req.businessId);
        if (!business) return res.status(404).json({ message: "Business not found." });

        const b = req.body || {};

        // ---- profile ----
        const name = clean(b.name, 80);
        if (name && name !== business.name) {
            business.name = name;
            // The slug is only free to change while no customer has the link.
            if (!business.setupCompletedAt) business.slug = await uniqueSlug(name);
        }
        if (b.city !== undefined) business.city = clean(b.city, 80);
        if (b.addressLine !== undefined) business.addressLine = clean(b.addressLine, 200);
        if (b.landmark !== undefined) business.landmark = clean(b.landmark, 120);
        if (b.contactEmail !== undefined) business.contactEmail = clean(b.contactEmail, 120).toLowerCase();

        // ---- meal services ----
        const mealTypes = Array.isArray(b.mealTypes) ? b.mealTypes.slice(0, 12) : [];
        for (let i = 0; i < mealTypes.length; i++) {
            const m = mealTypes[i] || {};
            const mName = clean(m.name, 60);
            const key = slugify(mName);
            if (!mName || !key) continue;
            for (const f of ["startTime", "endTime", "cutoffTime"]) {
                if (m[f] && !isTimeOfDay(m[f])) {
                    return res.status(400).json({ message: `${mName}: times must be in HH:MM format.` });
                }
            }
            await MealType.findOneAndUpdate(
                { businessId: business._id, key },
                {
                    $set: {
                        name: mName,
                        startTime: m.startTime || "",
                        endTime: m.endTime || "",
                        cutoffTime: m.cutoffTime || "",
                        cutoffPreviousDay: Boolean(m.cutoffPreviousDay),
                        active: true, customerBookable: true, sortOrder: i,
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
        }

        // ---- meal options ----
        const variants = Array.isArray(b.variants) ? b.variants.slice(0, 20) : [];
        for (let i = 0; i < variants.length; i++) {
            const v = variants[i] || {};
            const vName = clean(v.name, 60);
            const key = slugify(vName);
            if (!vName || !key) continue;
            const price = Number(v.price || 0);
            await MealVariant.findOneAndUpdate(
                { businessId: business._id, key },
                {
                    $set: {
                        name: vName,
                        price: Number.isFinite(price) && price >= 0 ? price : 0,
                        description: clean(v.description, 160),
                        active: true, sortOrder: i,
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
        }

        const firstTime = !business.setupCompletedAt;
        business.setupCompletedAt = business.setupCompletedAt || new Date();
        await business.save();

        record({
            businessId: business._id, actor: req.actor, requestMeta: meta(req),
            action: firstTime ? "Completed registration" : "Updated registration details",
            after: { name: business.name, slug: business.slug },
        });

        // Welcome note — informational, so a mail failure never fails signup.
        if (firstTime && req.user.email && mailer.isConfigured()) {
            const m = mailer.welcomeEmail({
                name: req.user.name, businessName: business.name,
                bookingUrl: customerUrl(`/b/${business.slug}`),
            });
            mailer.sendMail({ to: req.user.email, toName: req.user.name, ...m }).catch(() => {});
        }

        res.json(sessionPayload(req.user, business));
    } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* FORGOT / RESET PASSWORD — 4-digit code by email, three steps         */
/* ------------------------------------------------------------------ */
/**
 * Step 1: "send me a code". Always answers 200 with the same shape whether or
 * not the identifier exists, so this cannot be used to discover accounts;
 * when it does exist, the response also says where the code went (masked)
 * so the person knows which inbox to open.
 */
router.post("/api/auth/forgot-password", async (req, res, next) => {
    try {
        const identifier = String(req.body?.identifier || "").trim();
        if (!identifier) return res.status(400).json({ message: "Enter your mobile number, login ID or email." });

        if (!mailer.isConfigured()) {
            return res.status(503).json({
                message: "Password reset by email isn't available right now. Contact the business owner.",
                code: "MAIL_UNCONFIGURED",
            });
        }

        const query = identifierQuery(identifier);
        const user = query ? await BusinessUser.findOne(query).select("name email isActive").lean() : null;

        // A generic reply for the not-found, inactive and no-email cases alike.
        const generic = { ok: true, sent: false, message: "If that account exists and has an email address, a code is on its way." };
        if (!user || user.isActive === false || !user.email) return res.json(generic);

        // Resend throttle per account, independent of IP — two people on one
        // office connection should not lock each other out, and one person
        // should not be able to flood a colleague's inbox.
        const recent = await PasswordReset.findOne({ userId: user._id, consumedAt: null })
            .sort({ createdAt: -1 }).select("createdAt").lean();
        if (recent && Date.now() - new Date(recent.createdAt).getTime() < RESET_RESEND_SECONDS * 1000) {
            const wait = Math.ceil((RESET_RESEND_SECONDS * 1000 - (Date.now() - new Date(recent.createdAt).getTime())) / 1000);
            return res.status(429).json({ message: `A code was sent moments ago. Try again in ${wait}s.`, code: "RESEND_TOO_SOON", retryAfter: wait });
        }

        // crypto, not Math.random — a 4-digit space is small enough that a
        // predictable generator would be the weakest link.
        const code = String(crypto.randomInt(0, 10000)).padStart(4, "0");

        // Only one live code per account: a fresh request voids the old one.
        await PasswordReset.updateMany({ userId: user._id, consumedAt: null }, { $set: { consumedAt: new Date() } });
        await PasswordReset.create({
            userId: user._id,
            codeHash: hashCode(code, user._id),
            email: user.email,
            expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000),
            ip: req.ip || "",
        });

        const m = mailer.passwordResetEmail({ name: user.name, code, minutes: RESET_MINUTES });
        await mailer.sendMail({ to: user.email, toName: user.name, ...m });

        res.json({
            ok: true, sent: true,
            emailHint: maskEmail(user.email),
            expiresInMinutes: RESET_MINUTES,
            message: `We emailed a 4-digit code to ${maskEmail(user.email)}.`,
        });
    } catch (err) { next(err); }
});

/**
 * Step 2: the code alone, on its own screen.
 *
 * Kept separate from the new password so the person is asked one thing at a
 * time: a form showing an OTP box and a password field together reads as two
 * unrelated questions and invites filling them in the wrong order. Exchanging
 * the code for a short-lived token also means the code itself is spent once,
 * here, rather than travelling again with the password.
 */
router.post("/api/auth/verify-reset-code", async (req, res, next) => {
    try {
        const identifier = String(req.body?.identifier || "").trim();
        const code = String(req.body?.code || "").replace(/\D/g, "");
        if (!identifier || code.length !== 4) {
            return res.status(400).json({ message: "Enter the 4-digit code from the email." });
        }

        const query = identifierQuery(identifier);
        const user = query ? await BusinessUser.findOne(query).select("_id").lean() : null;
        const reset = user
            ? await PasswordReset.findOne({ userId: user._id, consumedAt: null, expiresAt: { $gt: new Date() } })
                .sort({ createdAt: -1 })
            : null;

        // Same message for "no code outstanding" and "wrong code".
        const WRONG = { message: "That code isn't right or has expired. Request a new one.", code: "BAD_CODE" };
        if (!user || !reset) return res.status(400).json(WRONG);

        if (reset.attempts >= RESET_MAX_ATTEMPTS) {
            reset.consumedAt = new Date();
            await reset.save();
            return res.status(400).json({ message: "Too many wrong codes. Request a new one.", code: "CODE_LOCKED" });
        }

        const expected = Buffer.from(reset.codeHash, "hex");
        const given = Buffer.from(hashCode(code, user._id), "hex");
        if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
            reset.attempts += 1;
            await reset.save();
            const left = RESET_MAX_ATTEMPTS - reset.attempts;
            return res.status(400).json({
                ...WRONG,
                message: left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong codes. Request a new one.",
                attemptsLeft: left,
            });
        }

        // Spent here. The password step carries this token instead.
        reset.consumedAt = new Date();
        await reset.save();

        const resetToken = jwt.sign(
            { purpose: "password-reset", userId: String(user._id), rid: String(reset._id) },
            process.env.JWT_SECRET,
            { expiresIn: `${RESET_TOKEN_MINUTES}m` }
        );
        res.json({ ok: true, resetToken, expiresInMinutes: RESET_TOKEN_MINUTES });
    } catch (err) { next(err); }
});

/** Step 3: the new password, on its own screen. Signs them in on success. */
router.post("/api/auth/reset-password", async (req, res, next) => {
    try {
        const password = String(req.body?.newPassword || "");
        if (password.length < 8) {
            return res.status(400).json({ message: "Choose a password of at least 8 characters." });
        }

        let decoded;
        try {
            decoded = jwt.verify(String(req.body?.resetToken || ""), process.env.JWT_SECRET);
        } catch {
            return res.status(400).json({ message: "That reset took too long. Request a new code.", code: "RESET_EXPIRED" });
        }
        if (decoded.purpose !== "password-reset") {
            return res.status(400).json({ message: "That reset isn't valid. Request a new code.", code: "RESET_INVALID" });
        }

        const user = await BusinessUser.findById(decoded.userId);
        if (!user || user.isActive === false) {
            return res.status(400).json({ message: "That reset isn't valid. Request a new code.", code: "RESET_INVALID" });
        }

        user.passwordHash = await bcrypt.hash(password, 10);
        user.passwordSet = true;
        user.tokenVersion += 1;   // every existing session ends
        user.lastLoginAt = new Date();
        await user.save();

        const business = await Business.findById(user.businessId).select("name slug setupCompletedAt").lean();
        record({
            businessId: user.businessId, actor: { userId: user._id, name: user.name }, requestMeta: meta(req),
            action: "Reset their password by email code",
        });
        notify("security.password", {
            businessId: user.businessId, actor: { userId: user._id, name: user.name }, requestMeta: meta(req),
            title: "Password reset by email code",
            summary: `${user.name}'s password was reset using a code sent to their email. Every previous session on that account has been signed out.`,
            rows: [{ label: "Account", value: `${user.name}${user.isOwner ? " (owner)" : ""}` }],
            concern: CONCERN.security,
        });

        res.cookie(COOKIE_NAME, signSession(user), COOKIE_OPTIONS);
        res.json({ ok: true, ...(business ? sessionPayload(user, business) : {}) });
    } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* WHO AM I                                                             */
/* ------------------------------------------------------------------ */
/**
 * Drives the dashboard shell — which nav items to render, which buttons to
 * offer — and reports the permissions authenticate() resolved fresh for THIS
 * request, so the UI can never claim access the API would refuse.
 */
router.get("/api/auth/me", authenticate, async (req, res, next) => {
    try {
        const Outlet = require("../models/Outlet");
        const outletFilter = { businessId: req.businessId };
        if (req.outletScope) outletFilter._id = { $in: req.outletScope };
        const [business, outlets, anyActiveOutlet] = await Promise.all([
            Business.findById(req.businessId)
                .select("name slug logoUrl acceptingBookings closedMessage timezoneOffsetMinutes partyTypes rules city addressLine landmark contactPhone contactEmail setupCompletedAt qrPoster createdAt").lean(),
            Outlet.find(outletFilter).sort({ sortOrder: 1, name: 1 }).select("name key active sortOrder description").lean(),
            Outlet.exists({ businessId: req.businessId, active: true }),
        ]);

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
                loginId: req.user.loginId || "",
                isOwner: Boolean(req.user.isOwner),
                // Drives "Set a password" vs "Change password" in Settings.
                passwordSet: req.user.passwordSet !== false,
                roleName,
                createdAt: req.user.createdAt,
            },
            business,
            setupPending: Boolean(business && !business.setupCompletedAt),
            /* WHERE this person may act. The outlet selector on every page is
               rendered from `outlets`; `outletScope` null means the whole
               canteen (so "All outlets" is honest), an array means the
               selector is confined to those. Mirrors the server's own scope
               exactly, the way `permissions` mirrors can(). */
            outlets: outlets.map((o) => ({ id: o._id, name: o.name, key: o.key, active: o.active !== false, description: o.description || "" })),
            outletScope: req.outletScope,
            outletRequired: Boolean(anyActiveOutlet),
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

/* ------------------------------------------------------------------ */
/* MY PROFILE                                                           */
/* ------------------------------------------------------------------ */
/**
 * Edit your own name and sign-in identifiers (Settings → Account).
 *
 * The phone is NOT editable here: it is the OTP sign-in credential, and
 * changing it would have to re-verify the new number. Everything else is fair
 * game.
 */
router.patch("/api/auth/profile", authenticate, async (req, res, next) => {
    try {
        const user = await BusinessUser.findById(req.user._id);
        const b = req.body || {};
        const before = { name: user.name, email: user.email, loginId: user.loginId };

        if (b.name !== undefined) user.name = clean(b.name, 60) || user.name;

        const next_ = { email: user.email, loginId: user.loginId };
        if (b.email !== undefined) {
            const email = clean(b.email, 120).toLowerCase();
            if (email && !EMAIL_RE.test(email)) return res.status(400).json({ message: "Enter a valid email address." });
            next_.email = email;
        }
        if (b.loginId !== undefined) {
            const loginId = clean(b.loginId, 32).toLowerCase();
            if (loginId && !BusinessUser.isValidLoginId(loginId)) {
                return res.status(400).json({ message: "A login ID is 3–32 characters: letters, numbers, dots, underscores or hyphens." });
            }
            next_.loginId = loginId;
        }
        // The owner must keep an email — it is the only password-recovery
        // channel — and everyone must keep something to sign in with.
        if (user.isOwner && !next_.email) {
            return res.status(400).json({ message: "The owner account needs an email address — it's where reset codes go." });
        }
        if (!user.phone && !next_.email && !next_.loginId) {
            return res.status(400).json({ message: "Keep at least one way to sign in." });
        }

        const taken = await identifierTaken({
            email: next_.email !== user.email ? next_.email : "",
            loginId: next_.loginId !== user.loginId ? next_.loginId : "",
        }, user._id);
        if (taken === "email") return res.status(409).json({ message: "That email is already in use." });
        if (taken === "loginId") return res.status(409).json({ message: "That login ID is already taken." });

        Object.assign(user, next_);
        await user.save();

        record({
            businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
            action: "Updated their account details",
            before, after: { name: user.name, email: user.email, loginId: user.loginId },
        });
        res.json({ user: { id: user._id, name: user.name, phone: user.phone, email: user.email, loginId: user.loginId } });
    } catch (err) { next(err); }
});

/**
 * Set or change your own password.
 *
 * An account created by mobile OTP has no password anybody chose, so there is
 * no "current password" to ask for — the caller is already holding a valid
 * session, which is the proof. Once a password exists, the current one is
 * required, so a borrowed unlocked screen can't be used to lock the owner out.
 */
router.post("/api/auth/change-password", authenticate, async (req, res, next) => {
    try {
        const current = String(req.body?.currentPassword || "");
        const next_ = String(req.body?.newPassword || "");
        if (next_.length < 8) {
            return res.status(400).json({ message: "Choose a password of at least 8 characters." });
        }

        const user = await BusinessUser.findById(req.user._id).select("+passwordHash");
        const hadPassword = user.passwordSet !== false;

        if (hadPassword && !(await bcrypt.compare(current, user.passwordHash))) {
            return res.status(403).json({ message: "Your current password isn't right." });
        }

        user.passwordHash = await bcrypt.hash(next_, 10);
        user.passwordSet = true;
        user.tokenVersion += 1;
        await user.save();

        record({
            businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
            action: hadPassword ? "Changed their password" : "Set a sign-in password",
        });
        notify("security.password", {
            businessId: req.businessId, actor: req.actor, requestMeta: meta(req),
            title: hadPassword ? "Password changed" : "Sign-in password set",
            summary: hadPassword
                ? `${user.name} changed their password from Settings. Every other session on that account has been signed out.`
                : `${user.name} set a password, so their account can now be opened with a login ID and password as well as a mobile code.`,
            rows: [{ label: "Account", value: `${user.name}${user.isOwner ? " (owner)" : ""}` }],
            concern: CONCERN.security,
        });

        // This session included — the caller is re-issued a cookie so they are
        // not signed out by their own password change.
        res.cookie(COOKIE_NAME, signSession(user), COOKIE_OPTIONS);
        res.json({ ok: true, wasSet: hadPassword });
    } catch (err) { next(err); }
});

module.exports = router;
