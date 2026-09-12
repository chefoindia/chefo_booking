// config/env.js — fail loudly at boot, not mysteriously on the first request.
const REQUIRED = ["MONGODB_URI", "JWT_SECRET"];

// Needed for password resets (the code is emailed). Missing locally is a
// warning — the rest of the product works without email — but production must
// not start half-configured, or the first owner to forget a password is stuck.
const MAIL = ["BREVO_API_KEY", "MAIL_FROM"];

function validateEnv() {
    const missing = REQUIRED.filter((k) => !process.env[k]);
    if (missing.length) {
        console.error(`\nMissing required environment variables: ${missing.join(", ")}`);
        console.error("Copy .env.example to .env and fill them in.\n");
        process.exit(1);
    }
    if (String(process.env.JWT_SECRET).length < 24) {
        console.error("\nJWT_SECRET is too short — use at least 24 characters.\n");
        process.exit(1);
    }

    const mailMissing = MAIL.filter((k) => !process.env[k]);
    if (mailMissing.length) {
        if (process.env.NODE_ENV === "production") {
            console.error(`\nMissing email configuration: ${mailMissing.join(", ")} — password resets need it.\n`);
            process.exit(1);
        }
        console.warn(`Email not configured (${mailMissing.join(", ")}) — password-reset codes cannot be sent.`);
    }
}

module.exports = { validateEnv };
