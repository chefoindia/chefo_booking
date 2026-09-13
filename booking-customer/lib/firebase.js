"use client";
// lib/firebase.js — client-side Firebase, used ONLY for the phone-OTP step of
// the optional customer account.
//
// WHY IT LOOKS DIFFERENT FROM booking-business/lib/firebase.js: the operator
// dashboard is an app you sign into, so loading Firebase up front costs it
// nothing. This is a booking page a stranger opens once from a QR code on a
// noticeboard, on a phone, on canteen wifi — and the overwhelming majority of
// them will never create an account. So nothing here is imported at module
// load: the SDK is pulled in the first time somebody actually asks for a code,
// and a page that never signs in pays nothing for the possibility.
//
// The idToken this produces is always verified again by the backend
// (config/firebaseAdmin.js). The frontend never decides who is authenticated.
//
// These values are public by design — a Firebase web config ships to every
// browser. What protects the project is the authorized-domains list and the
// reCAPTCHA step, not the secrecy of this object.
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Deliberately synchronous and import-free, so a page can decide whether to
// even offer the account without dragging the SDK in to ask.
export const isFirebaseConfigured = () => Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

async function firebaseAuth() {
    const [{ initializeApp, getApps }, { getAuth }] = await Promise.all([
        import("firebase/app"),
        import("firebase/auth"),
    ]);
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    return getAuth(app);
}

const verifiers = {};

// One invisible reCAPTCHA per container div. If the container was unmounted
// (the sheet was dismissed and reopened), the stale verifier is cleared and
// rebuilt — reusing one whose element has gone makes the next send fail
// silently, which on a phone looks exactly like "the SMS never came".
async function getRecaptcha(containerId) {
    const { RecaptchaVerifier } = await import("firebase/auth");
    const auth = await firebaseAuth();
    const existing = verifiers[containerId];
    if (existing && document.getElementById(containerId)) return existing;
    try { existing?.clear(); } catch { /* already gone */ }
    verifiers[containerId] = new RecaptchaVerifier(auth, containerId, { size: "invisible" });
    return verifiers[containerId];
}

/** Sends the SMS. `phoneE164` must carry the country code ("+919876543210"). */
export async function sendOtp(phoneE164, recaptchaContainerId = "recaptcha-container") {
    const { signInWithPhoneNumber } = await import("firebase/auth");
    const auth = await firebaseAuth();
    return signInWithPhoneNumber(auth, phoneE164, await getRecaptcha(recaptchaContainerId));
}

// confirmationResult.confirm(code) -> userCredential; the idToken is the only
// thing the backend will accept as proof that this phone answered.
export async function confirmOtp(confirmation, code) {
    const cred = await confirmation.confirm(code);
    return cred.user.getIdToken();
}

/** Firebase's error codes, in words a customer can act on. */
export function otpErrorMessage(err) {
    switch (err?.code) {
        case "auth/invalid-verification-code": return "That code isn't right — check it and try again.";
        case "auth/code-expired": return "That code has expired. Ask for a new one.";
        case "auth/invalid-phone-number": return "That mobile number isn't valid.";
        case "auth/too-many-requests": return "Too many tries from this phone. Give it a little while.";
        case "auth/quota-exceeded": return "Too many codes are being sent right now. Please try again later.";
        case "auth/captcha-check-failed": return "The security check failed. Reload the page and try again.";
        case "auth/network-request-failed": return "Network problem — check your connection and try again.";
        default: return err?.message || "Something went wrong. Please try again.";
    }
}
