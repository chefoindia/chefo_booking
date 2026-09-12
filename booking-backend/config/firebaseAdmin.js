// config/firebaseAdmin.js — verifies the phone-OTP idToken the browser mints.
//
// The browser runs Firebase phone auth and hands us an idToken. That token is
// the ONLY thing that proves the person controls the number, and it is checked
// here, server-side, every time — the frontend never decides who is signed in.
//
// Same Firebase project as the rest of Chefo, so a number verified in the
// canteen dashboard is the same identity here.
//
// Preferred: FIREBASE_SERVICE_ACCOUNT_BASE64 (base64 of the service-account
// JSON). Fallback: FIREBASE_SERVICE_ACCOUNT (raw JSON). The credentials must
// never live in the repository.
// The MODULAR entry points, not the old `admin.credential.cert(...)` namespace.
// firebase-admin v14 removed that namespace entirely — `admin.credential` is
// undefined there, which is exactly how this failed to initialise the first
// time. These subpaths exist in v11 through v14, so they are the version-proof
// way to write it.
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

function loadServiceAccount() {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
        return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf-8"));
    }
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    }
    return null;
}

let ready = false;

function initFirebase() {
    try {
        const serviceAccount = loadServiceAccount();
        if (!serviceAccount) {
            console.warn("⚠️  Firebase Admin NOT initialized (no credentials). Phone sign-in will be refused.");
            return;
        }
        if (!getApps().length) {
            initializeApp({ credential: cert(serviceAccount) });
        }
        ready = true;
        console.log("✅ Firebase Admin initialized");
    } catch (err) {
        console.error("Firebase Admin failed to initialize:", err.message);
    }
}

const isFirebaseReady = () => ready;

/**
 * Verify an idToken and return the phone number it proves control of, in the
 * "+91XXXXXXXXXX" form everything else stores.
 *
 * Throws a 4xx-tagged error with a message safe to show. Fails CLOSED: if
 * Firebase is not configured the request is refused rather than waved through,
 * because a missing verifier must never mean "anyone may sign in as anyone".
 */
async function verifiedPhoneFrom(idToken) {
    if (!ready) {
        const e = new Error("Phone sign-in isn't available right now. Try the password option or contact support.");
        e.status = 503;
        e.code = "OTP_UNAVAILABLE";
        e.expose = true;   // a 5xx the caller is meant to read — see middleware/errors.js
        throw e;
    }
    if (!idToken || typeof idToken !== "string") {
        const e = new Error("That verification didn't complete. Please request a new code.");
        e.status = 400;
        e.code = "NO_ID_TOKEN";
        throw e;
    }

    let decoded;
    try {
        decoded = await getAuth().verifyIdToken(idToken);
    } catch (err) {
        const e = new Error(
            err.code === "auth/id-token-expired"
                ? "That code took too long to confirm. Please request a new one."
                : "We couldn't verify that code. Please request a new one."
        );
        e.status = 401;
        e.code = "BAD_ID_TOKEN";
        throw e;
    }

    if (!decoded.phone_number) {
        const e = new Error("That sign-in wasn't a phone verification.");
        e.status = 400;
        e.code = "NOT_PHONE_TOKEN";
        throw e;
    }
    return decoded.phone_number;
}

module.exports = { initFirebase, isFirebaseReady, verifiedPhoneFrom };
