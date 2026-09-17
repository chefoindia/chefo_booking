"use client";
// components/InstallApp.js — "Get the app": registers the service worker and
// drives the browser's PWA install flow, so an operator can put this dashboard
// on a home screen instead of hunting for a bookmark.
//
// Chrome/Edge (desktop and Android) fire `beforeinstallprompt` once the install
// criteria are met. The event is captured and replayed on click, because the
// prompt may only be shown from a user gesture.
//
// Browsers that never fire it — notably iOS Safari, which has no programmatic
// install API at all — get written instructions rather than a dead button.
// Ported from the Chefo canteen dashboard; the TWA detection is deliberately
// left out, because this product has no Android wrapper to be confused with.
import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useToast } from "@/components/ToastProvider";
import { BRAND } from "@/lib/brand";

function AppIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12" /><polyline points="7 10 12 15 17 10" />
            <path d="M20 16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3" />
        </svg>
    );
}

// iPadOS 13+ reports itself as a Mac, so the touch-point check is what keeps
// iPad users from being handed desktop instructions they cannot follow.
const isIos = () =>
    typeof navigator !== "undefined" &&
    (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

// Already installed: a PWA window, or iOS Safari's older non-standard flag.
const isStandalone = () => {
    if (typeof window === "undefined") return false;
    if (window.matchMedia?.("(display-mode: standalone)")?.matches) return true;
    return window.navigator?.standalone === true;
};

export default function InstallApp({ className = "", label = "Get the app" }) {
    const toast = useToast();
    const [promptEvent, setPromptEvent] = useState(null);
    const [installed, setInstalled] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        setInstalled(isStandalone());

        // Registered here rather than in the layout so the whole PWA concern
        // lives in one file and pages that never show this pay nothing.
        let onControllerChange = null;
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("/sw.js").catch(() => {
                // Only costs the offline fallback; the dashboard still works.
            });

            // A newer sw.js activates and claims the page on its own, but the
            // JavaScript already running in this tab does not refresh with it.
            // Without this reload, a deployed fix can sit invisibly stale until
            // the operator happens to close the tab. `hadController` keeps a
            // first-ever install from reloading, where there is no old version.
            const hadController = Boolean(navigator.serviceWorker.controller);
            let reloaded = false;
            onControllerChange = () => {
                if (reloaded || !hadController) return;
                reloaded = true;
                window.location.reload();
            };
            navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
        }

        const onPrompt = (e) => {
            // Suppress Chrome's own mini-infobar so this button is the one
            // place install is offered.
            e.preventDefault();
            setPromptEvent(e);
        };
        const onInstalled = () => {
            setInstalled(true);
            setPromptEvent(null);
            toast("success", `${BRAND.productName} installed`, "You'll find it with your other apps.");
        };

        window.addEventListener("beforeinstallprompt", onPrompt);
        window.addEventListener("appinstalled", onInstalled);
        const mq = window.matchMedia?.("(display-mode: standalone)");
        const onDisplayChange = (e) => setInstalled(e.matches);
        mq?.addEventListener?.("change", onDisplayChange);

        return () => {
            window.removeEventListener("beforeinstallprompt", onPrompt);
            window.removeEventListener("appinstalled", onInstalled);
            mq?.removeEventListener?.("change", onDisplayChange);
            if (onControllerChange) navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
        };
    }, [toast]);

    const install = useCallback(async () => {
        if (!promptEvent) {
            // Either the browser has no install API, or the criteria are not
            // met yet. Explaining beats a button that appears to do nothing.
            setHelpOpen(true);
            return;
        }
        try {
            promptEvent.prompt();
            const { outcome } = await promptEvent.userChoice;
            // Single-use: a dismissed prompt cannot be replayed.
            setPromptEvent(null);
            if (outcome === "dismissed") {
                toast("success", "No problem", "You can install it any time from this button.");
            }
        } catch {
            setHelpOpen(true);
        }
    }, [promptEvent, toast]);

    // Already running as the installed app — offering to install it again is
    // noise, and confusing noise at that.
    if (installed) return null;

    return (
        <>
            <button type="button" className={className || "btn btn-secondary btn-sm"} onClick={install}>
                <AppIcon />
                {label}
            </button>

            <Modal
                open={helpOpen}
                onClose={() => setHelpOpen(false)}
                title={`Install ${BRAND.productName} on this device`}
                subtitle="Get an app icon on your home screen or desktop — no app store needed."
                footer={<button className="btn btn-primary" onClick={() => setHelpOpen(false)}>Got it</button>}
            >
                <style>{`
                  .ia-steps { margin: 0; padding-left: 18px; }
                  .ia-steps li { font-size: 13.5px; line-height: 1.7; color: var(--slate); margin-bottom: 6px; }
                  .ia-steps strong { color: var(--ink); font-weight: 600; }
                  .ia-h { font-size: 13px; font-weight: 700; margin: 0 0 8px; }
                  .ia-block + .ia-block { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--border); }
                  .ia-note { font-size: 12.5px; color: var(--faint); line-height: 1.6; margin: 16px 0 0; }
                `}</style>

                {isIos() ? (
                    <div className="ia-block">
                        <p className="ia-h">On iPhone or iPad</p>
                        <ol className="ia-steps">
                            <li>Open this dashboard in <strong>Safari</strong> (Chrome on iOS can&apos;t install apps).</li>
                            <li>Tap the <strong>Share</strong> button at the bottom of the screen.</li>
                            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                            <li>Tap <strong>Add</strong> — it appears with your other apps.</li>
                        </ol>
                    </div>
                ) : (
                    <>
                        <div className="ia-block">
                            <p className="ia-h">On Android</p>
                            <ol className="ia-steps">
                                <li>Open this dashboard in <strong>Chrome</strong>.</li>
                                <li>Tap the <strong>⋮</strong> menu, top right.</li>
                                <li>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</li>
                            </ol>
                        </div>
                        <div className="ia-block">
                            <p className="ia-h">On desktop</p>
                            <ol className="ia-steps">
                                <li>Use <strong>Chrome</strong> or <strong>Edge</strong>.</li>
                                <li>Click the <strong>install icon</strong> in the address bar, on the right.</li>
                                <li>Or open the <strong>⋮</strong> menu and choose <strong>Install</strong>.</li>
                            </ol>
                        </div>
                    </>
                )}

                <p className="ia-note">
                    If you don&apos;t see the option, your browser may not support installing web apps —
                    Firefox on desktop and Chrome on iOS don&apos;t. The dashboard keeps working
                    normally in the browser either way.
                </p>
            </Modal>
        </>
    );
}
