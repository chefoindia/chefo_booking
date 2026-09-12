import { Sora, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { BRAND } from "@/lib/brand";
import ToastProvider from "@/components/ToastProvider";
import OfflineBanner from "@/components/OfflineBanner";
import LaunchSplash from "@/components/LaunchSplash";

// Same three faces as the Chefo owner dashboard, exposed as CSS variables so
// no stylesheet ever names a font: Sora for display, Public Sans for body,
// IBM Plex Mono for references and money.
const display = Sora({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display" });
const body = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

export const metadata = {
    title: `${BRAND.productName} — Operations`,
    description: "Meal-service bookings, approvals and daily preparation counts.",
    icons: { icon: "/chefo-mark.png", apple: "/chefo-mark.png" },
};

export const viewport = {
    width: "device-width",
    initialScale: 1,
    themeColor: "#f6f7f5",
    viewportFit: "cover",
};

export default function RootLayout({ children }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={`${display.variable} ${body.variable} ${mono.variable}`}>
                <LaunchSplash tagline="Book meals, count plates" />
                <OfflineBanner />
                <ToastProvider>{children}</ToastProvider>
            </body>
        </html>
    );
}
