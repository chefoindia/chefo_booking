// middleware/authenticate.js — who is calling, which business they belong to,
// and what they may do.
//
// Same session architecture as the existing Chefo owner dashboard: a JWT in an
// httpOnly cookie, renewed on a sliding window, with permissions resolved FRESH
// from the role document on every single request.
//
// Fresh-per-request matters. If permissions were baked into the token, an owner
// revoking someone's access would be waiting days for it to take effect. Here,
// editing a role changes what that person can do on their very next click.
const jwt = require("jsonwebtoken");
const BusinessUser = require("../models/BusinessUser");
const Role = require("../models/Role");
const { sanitizePermissions, can } = require("../utils/permissions");

const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const COOKIE_NAME = "booking_session";

// Cookie flags differ by environment for a real reason, not convenience.
//
// Production is cross-site (booking.chefo.in -> api.booking.chefo.in), which
// REQUIRES SameSite=None, and a None cookie must also be Secure.
//
// Development is http://localhost, where a Secure cookie is refused by some
// browsers. Different ports are still the SAME SITE, so Lax is both sufficient
// and correct locally — the cookie rides along on calls from :4001 to :40005.
const isProd = process.env.NODE_ENV === "production";
const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    maxAge: SESSION_MS,
    path: "/",
};

const signSession = (user) =>
    jwt.sign(
        { userId: String(user._id), businessId: String(user.businessId), v: user.tokenVersion },
        process.env.JWT_SECRET,
        { expiresIn: `${SESSION_DAYS}d` }
    );

const shouldRenew = (decoded, now = Date.now()) =>
    Boolean(decoded?.iat) && now - decoded.iat * 1000 >= RENEW_AFTER_MS;

async function authenticate(req, res, next) {
    try {
        const token = req.cookies?.[COOKIE_NAME];
        if (!token) return res.status(401).json({ message: "Please sign in." });

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch {
            return res.status(401).json({ message: "Your session has expired. Please sign in again." });
        }

        const user = await BusinessUser.findById(decoded.userId);
        if (!user) return res.status(401).json({ message: "Your session is no longer valid." });

        // Invalidated by a deactivation or a password change. Without this, a
        // stolen or stale token would outlive both.
        if (decoded.v !== user.tokenVersion) {
            res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTIONS, maxAge: undefined });
            return res.status(401).json({ message: "Your session has ended. Please sign in again." });
        }

        // Checked on EVERY request, not only at login, so switching someone off
        // stops them at their next action instead of at token expiry.
        if (user.isActive === false) {
            return res.status(403).json({
                message: "This account has been deactivated. Contact the business owner.",
                code: "ACCOUNT_DISABLED",
            });
        }

        /* IDENTITY vs TENANT — two different things, and conflating them is how
           cross-tenant bugs happen.

             req.businessId — WHICH BUSINESS this request may touch. Taken from
                              the user's own record, never from the URL or body,
                              so a forged id cannot reach another business.
             req.actor      — WHO is acting, for the audit trail. */
        req.user = user;
        req.businessId = user.businessId;
        req.actor = { userId: user._id, name: user.name, isOwner: user.isOwner };

        if (user.isOwner) {
            req.permissions = null; // null = unrestricted
        } else {
            const role = user.roleId
                ? await Role.findOne({ _id: user.roleId, businessId: user.businessId })
                    .select("permissions archivedAt").lean()
                : null;
            // No role, or an archived one, means NO permissions — never
            // "everything". Failing closed is the only safe default.
            req.permissions = role && !role.archivedAt ? sanitizePermissions(role.permissions) : [];
        }

        // Sliding renewal, at most once a day. Deliberately after every check
        // above, so a rejected session can never renew itself back to life.
        if (shouldRenew(decoded)) {
            res.cookie(COOKIE_NAME, signSession(user), COOKIE_OPTIONS);
        }

        next();
    } catch (err) {
        console.error("auth error:", err);
        res.status(401).json({ message: "Could not verify your session." });
    }
}

/** The actor shape the permission helpers expect. */
const actorOf = (req) => ({
    isOwner: Boolean(req.user?.isOwner),
    isActive: req.user?.isActive !== false,
    permissions: req.permissions || [],
});

/**
 * THE authorization boundary. Hiding a button is UX; this is the gate.
 *
 * Fails closed: if authenticate() has not run, req.user is undefined, the actor
 * has no permissions and the request is refused rather than waved through.
 */
function requirePermission(permission) {
    return (req, res, next) => {
        if (!can(actorOf(req), permission)) {
            return res.status(403).json({
                message: "You don't have permission to do that.",
                code: "FORBIDDEN",
                requiredPermission: permission,
            });
        }
        next();
    };
}

/**
 * The same gate, satisfied by ANY ONE of several permissions.
 *
 * Exists for the counter: looking a booking up by its code is authorised either
 * by `bookings.view` (you can see bookings anyway) or by `scan.use` (your whole
 * job is the scanner). Requiring both would mean a scan-only role had to be
 * given the entire booking list to do the one thing it is for.
 */
function requireAnyPermission(...permissions) {
    return (req, res, next) => {
        const actor = actorOf(req);
        if (!permissions.some((p) => can(actor, p))) {
            return res.status(403).json({
                message: "You don't have permission to do that.",
                code: "FORBIDDEN",
                requiredPermission: permissions[0],
            });
        }
        next();
    };
}

/** For things that must not be delegable at all, like transferring ownership. */
function requireOwner() {
    return (req, res, next) => {
        if (!req.user?.isOwner) {
            return res.status(403).json({
                message: "Only the business owner can do that.",
                code: "OWNER_ONLY",
            });
        }
        next();
    };
}

module.exports = {
    authenticate,
    requirePermission,
    requireAnyPermission,
    requireOwner,
    actorOf,
    signSession,
    COOKIE_NAME,
    COOKIE_OPTIONS,
    SESSION_DAYS,
};
