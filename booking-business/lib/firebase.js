// lib/firebase.js — client-side Firebase, used ONLY for the phone-OTP UI.
//
// The resulting idToken is always verified again by the backend
// (config/firebaseAdmin.js); the frontend never decides who is authenticated.
// Same Firebase project as the rest of Chefo, so an owner's mobile number is
// one identity across the products.
//
// These values are public by design — a Firebase web config is shipped to
// every browser. What protects the project is the authorized-domains list and
// the App Check / reCAPTCHA step, not the secrecy of this object.
import { initializeApp, getApps } from "firebase/app";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = () => Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

export function getFirebaseAuth() {
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    return getAuth(app);
}

const verifiers = {};

// Invisible reCAPTCHA per container div. If a container was unmounted (the
// screen changed), the stale verifier is cleared and rebuilt — reusing one
// whose element has gone makes the next send fail silently.
export function getRecaptcha(containerId = "recaptcha-container") {
    const auth = getFirebaseAuth();
    const existing = verifiers[containerId];
    if (existing && document.getElementById(containerId)) return existing;
    try { existing?.clear(); } catch { /* already gone */ }
    verifiers[containerId] = new RecaptchaVerifier(auth, containerId, { size: "invisible" });
    return verifiers[containerId];
}

/** Sends the SMS. `phoneWithCode` must be E.164 ("+919876543210"). */
export async function sendOtp(phoneWithCode, containerId = "recaptcha-container") {
    const auth = getFirebaseAuth();
    return signInWithPhoneNumber(auth, phoneWithCode, getRecaptcha(containerId));
}

// confirmationResult.confirm(code) -> userCredential; we need the idToken,
// which is the only thing the backend will accept as proof.
export async function confirmOtp(confirmationResult, code) {
    const cred = await confirmationResult.confirm(code);
    return cred.user.getIdToken();
}

/** Firebase's error codes, in words an owner can act on. */
export function otpErrorMessage(err) {
    switch (err?.code) {
        case "auth/invalid-verification-code": return "That code isn't right — check it and try again.";
        case "auth/code-expired": return "That code has expired. Request a new one.";
        case "auth/invalid-phone-number": return "That mobile number isn't valid.";
        case "auth/too-many-requests": return "Too many attempts from this device. Try again in a little while.";
        case "auth/quota-exceeded": return "Too many codes sent right now. Please try again later.";
        case "auth/captcha-check-failed": return "The security check failed. Reload the page and try again.";
        case "auth/network-request-failed": return "Network problem — check your connection and try again.";
        default: return err?.message || "Something went wrong. Please try again.";
    }
}
