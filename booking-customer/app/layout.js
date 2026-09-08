import "./globals.css";
import { BRAND } from "@/lib/brand";

export const metadata = {
    title: `${BRAND.productName}`,
    description: "Book your meals.",
};

export const viewport = {
    width: "device-width",
    initialScale: 1,
    // The booking form is used one-handed on a phone; letting it zoom on focus
    // is disorienting, but zoom itself must stay available for accessibility.
    maximumScale: 5,
};

export default function RootLayout({ children }) {
    return <html lang="en"><body>{children}</body></html>;
}
