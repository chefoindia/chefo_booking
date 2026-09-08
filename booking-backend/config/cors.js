// config/cors.js — who may call this API from a browser.
//
// credentials:true is required because the session is an httpOnly cookie, and
// that in turn forbids a wildcard origin — so the allow-list is explicit and
// comes from the environment.
const DEFAULTS = ["http://localhost:4001", "http://localhost:4003"];

const allowed = new Set(
    (process.env.ALLOWED_ORIGINS || DEFAULTS.join(","))
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
);

const corsOptions = {
    origin(origin, callback) {
        // No Origin header: server-to-server, curl, health checks. Not a
        // browser, so the cookie policy this protects does not apply.
        if (!origin) return callback(null, true);
        if (allowed.has(origin)) return callback(null, true);
        callback(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
};

module.exports = { corsOptions, allowedOrigins: [...allowed] };
