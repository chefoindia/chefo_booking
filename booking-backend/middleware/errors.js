// middleware/errors.js — consistent failures, and no internals on the wire.
const { DomainError } = require("../services/bookingService");

const notFound = (req, res) =>
    res.status(404).json({ message: `No route for ${req.method} ${req.originalUrl}` });

function errorHandler(err, req, res, _next) {
    // A rule the domain deliberately refused — the message is written for the
    // person reading it and is safe to show.
    if (err instanceof DomainError) {
        return res.status(err.status).json({ message: err.message, code: err.code });
    }

    // A route deliberately refused the request with an explicit 4xx, e.g.
    // Object.assign(new Error("Booking not found."), { status: 404 }).
    // Restricted to 4xx on purpose: only client-facing refusals get to choose
    // their own message, so a genuine server fault can never dress itself up as
    // a handled response or leak its internals.
    //
    // `expose: true` is the narrow exception, for the handful of 5xx that ARE
    // written for the person reading them — "email isn't configured", "phone
    // sign-in is unavailable". It must be set deliberately at the throw site,
    // so an unexpected fault still falls through to the generic 500 below.
    if (Number.isInteger(err?.status) && err.status >= 400 && (err.status < 500 || err.expose === true)) {
        return res.status(err.status).json({
            message: err.message || "That request could not be completed.",
            code: err.code || "REQUEST",
        });
    }

    if (err?.name === "ValidationError") {
        const first = Object.values(err.errors || {})[0];
        return res.status(400).json({ message: first?.message || "That input isn't valid.", code: "VALIDATION" });
    }
    if (err?.name === "CastError") {
        return res.status(400).json({ message: "That reference isn't valid.", code: "BAD_ID" });
    }
    if (err?.code === 11000) {
        return res.status(409).json({ message: "That already exists.", code: "DUPLICATE" });
    }
    if (/Origin not allowed/.test(err?.message || "")) {
        return res.status(403).json({ message: "Origin not allowed.", code: "CORS" });
    }

    // Anything unexpected is logged in full and reported as a generic failure:
    // a stack trace on the wire tells an attacker about the internals.
    console.error("Unhandled error:", err);
    res.status(500).json({ message: "Something went wrong. Please try again.", code: "SERVER" });
}

module.exports = { notFound, errorHandler };
