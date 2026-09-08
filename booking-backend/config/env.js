// config/env.js — fail loudly at boot, not mysteriously on the first request.
const REQUIRED = ["MONGODB_URI", "JWT_SECRET"];

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
}

module.exports = { validateEnv };
