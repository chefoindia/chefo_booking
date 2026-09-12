// middleware/rateLimiters.js
//
// The public booking form has NO login and NO OTP, which is a deliberate V1
// tradeoff — and rate limiting is the one thing standing between that decision
// and a script filling a kitchen's morning with fake plates. Per-IP, so one
// abusive source cannot spoil the service for everyone.
const rateLimit = require("express-rate-limit");

const json = (message) => (req, res) => res.status(429).json({ message, code: "RATE_LIMITED" });

const globalLimiter = rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    handler: json("Too many requests. Please slow down."),
});

// Credential stuffing is the threat here, so this is tight.
const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 20,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    handler: json("Too many sign-in attempts. Try again in a few minutes."),
});

// Registration creates a business — a real person does this once. Loose
// enough for a retry after a typo, tight enough to stop a script minting
// tenants.
const registerLimiter = rateLimit({
    windowMs: 60 * 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: json("Too many registration attempts. Try again in an hour."),
});

// Every allowed request here can cost a real SMS on Chefo's Firebase bill, so
// this guards the *lookup* that precedes one. Firebase enforces its own quota
// on the send itself; this stops a script walking through numbers to discover
// which ones hold accounts, and stops one browser burning the daily quota.
const otpLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    handler: json("Too many code requests. Try again in a few minutes."),
});

// Password-reset codes are 4 digits, so the whole scheme rests on nobody
// getting many tries. Sending is capped per IP here; guessing is capped per
// code (5 attempts) in the route itself.
const resetLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    handler: json("Too many attempts. Try again in a few minutes."),
});

// Public writes: a real person books a handful of times, not thirty.
const publicWriteLimiter = rateLimit({
    windowMs: 10 * 60_000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: json("Too many booking attempts. Please try again shortly."),
});

// Phone lookup is unauthenticated and enumerable by nature; this caps how fast
// somebody could walk through numbers.
const lookupLimiter = rateLimit({
    windowMs: 10 * 60_000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    handler: json("Too many lookups. Please try again shortly."),
});

module.exports = {
    globalLimiter, authLimiter, registerLimiter, resetLimiter, otpLimiter,
    publicWriteLimiter, lookupLimiter,
};
