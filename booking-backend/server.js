// server.js — thin bootstrap. All logic lives in services/, routes/, models/.
//
// TWO SURFACES, ONE PROCESS, DELIBERATE BOUNDARY:
//
//   /api/public/*  — the customer side. No authentication, ever. This is the
//                    separable layer: when Chefo builds one common customer
//                    platform, this is what it replaces, and nothing else here
//                    has to move.
//   everything else — the operator side. Authenticated and permission-gated
//                    without exception.
require("dotenv").config();

const { validateEnv } = require("./config/env");
validateEnv();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const mongoSanitize = require("express-mongo-sanitize");

const { connectDB } = require("./config/db");
const { corsOptions, allowedOrigins } = require("./config/cors");
const { BRAND } = require("./config/brand");
const { initFirebase } = require("./config/firebaseAdmin");
const {
    globalLimiter, authLimiter, registerLimiter, resetLimiter, otpLimiter,
} = require("./middleware/rateLimiters");
const { notFound, errorHandler } = require("./middleware/errors");

// Phone-OTP verification. Started before the routes so a request can never
// arrive at a half-initialised verifier.
initFirebase();

const app = express();

// Behind a reverse proxy in production — required so rate limiting and secure
// cookies see the real client IP and protocol rather than the proxy's.
app.set("trust proxy", 1);

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ extended: true, limit: "512kb" }));
app.use(cookieParser());
app.use(mongoSanitize());
app.use(globalLimiter);

app.get("/api/health", (req, res) =>
    res.json({ ok: true, product: BRAND.productName, time: new Date().toISOString() })
);

// Tighter limiter on the credential endpoints specifically.
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/change-password", authLimiter);
app.use("/api/auth/signup/verify-otp", registerLimiter);
app.use("/api/auth/phone/exists", otpLimiter);
app.use("/api/auth/login/start", otpLimiter);
app.use("/api/auth/forgot-password", resetLimiter);
app.use("/api/auth/verify-reset-code", resetLimiter);
app.use("/api/auth/reset-password", resetLimiter);

// ---- customer surface (no auth) ----
// customerAccount is part of the same separable layer: it adds a verified,
// year-long customer session on top of the anonymous booking form, and shares
// the /api/public/* prefix so the whole surface still lifts out in one piece.
app.use(require("./routes/public"));
app.use(require("./routes/customerAccount"));

// ---- operator surface (authenticated + permission-gated inside) ----
app.use(require("./routes/auth"));
app.use(require("./routes/dashboard"));
app.use(require("./routes/outlets"));
app.use(require("./routes/bookings"));
app.use(require("./routes/requests"));
app.use(require("./routes/config"));
app.use(require("./routes/parties"));
app.use(require("./routes/team"));
app.use(require("./routes/menu"));
app.use(require("./routes/reports"));
app.use(require("./routes/audit"));

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 40005;

connectDB()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`${BRAND.productName} API running on port ${PORT}`);
            console.log(`Allowed origins: ${allowedOrigins.join(", ")}`);
        });
    })
    .catch((err) => {
        console.error("Failed to start — could not connect to MongoDB:", err.message);
        process.exit(1);
    });

module.exports = app;
