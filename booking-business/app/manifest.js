// app/manifest.js — served by Next at /manifest.webmanifest.
//
// This is what makes the operator dashboard installable. Chrome's criteria
// are: HTTPS (or localhost), a linked manifest with name/icons/start_url/
// display, and a registered service worker with a fetch handler — the last two
// live in public/sw.js and components/InstallApp.js.
import { BRAND } from "@/lib/brand";

export default function manifest() {
    return {
        name: `${BRAND.productName} — Operations`,
        // Android's launcher label prefers short_name. Deliberately NOT
        // BRAND.shortName — that is "Booking", which on a home screen full of
        // icons tells you nothing about whose booking app it is.
        short_name: BRAND.productName,
        description:
            "Take meal bookings, approve late changes and read the kitchen's preparation count for every service.",
        // An installed app should open where the work is, not on the marketing
        // page. Signed-out users still get bounced to /auth by the shell.
        start_url: "/dashboard",
        scope: "/",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#f6f7f5", // --paper, so the splash matches the app
        theme_color: "#f6f7f5",      // neutral status bar, not brand green
        categories: ["business", "food", "productivity"],
        lang: "en-IN",
        dir: "ltr",
        icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            // Android crops to its own shape; these keep the mark inside the
            // safe zone so a circular launcher doesn't slice it.
            { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
            { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // Long-press the installed icon to jump straight to the two screens a
        // counter actually opens.
        shortcuts: [
            { name: "Scan a booking", url: "/dashboard/scan" },
            { name: "Today's counts", url: "/dashboard" },
            { name: "Bookings", url: "/dashboard/bookings" },
        ],
    };
}
