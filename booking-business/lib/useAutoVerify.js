"use client";
// lib/useAutoVerify.js — fire OTP verification the moment a complete code is
// entered, instead of making the user reach for a button.
//
// Each complete code is attempted exactly once, tracked in a ref:
//   • complete + not yet attempted -> verify
//   • complete + already attempted -> do nothing (the failed code is still on
//     screen; the user is reading the error)
//   • incomplete                   -> forget the attempt, so deleting a digit
//                                     and retyping the SAME code verifies again
import { useEffect, useRef } from "react";

export function useAutoVerify(code, length, busy, onVerify, enabled = true) {
    const attemptedRef = useRef("");
    const verifyRef = useRef(onVerify);
    verifyRef.current = onVerify;

    useEffect(() => {
        if (!enabled) return;
        if (!code || code.length < length) {
            attemptedRef.current = "";
            return;
        }
        if (busy) return;
        if (attemptedRef.current === code) return;
        attemptedRef.current = code;
        verifyRef.current();
    }, [code, length, busy, enabled]);

    // Call after a resend so the next identical code is allowed to verify.
    return () => { attemptedRef.current = ""; };
}
