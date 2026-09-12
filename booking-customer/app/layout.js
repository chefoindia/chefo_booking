import { Sora, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { BRAND } from "@/lib/brand";

// Same faces as every Chefo surface, so the booking page a customer opens
// from a canteen's link looks like part of the same family.
const display = Sora({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-display" });
const body = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

export const metadata = {
    title: `${BRAND.productName}`,
    description: "Book your meals.",
    icons: { icon: "/chefo-mark.png", apple: "/chefo-mark.png" },
};

export const viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 5,
    themeColor: "#f6f7f5",
};

export default function RootLayout({ children }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={`${display.variable} ${body.variable} ${mono.variable}`}>{children}</body>
        </html>
    );
}
