import "./globals.css";
import { BRAND } from "@/lib/brand";
import ToastProvider from "@/components/ToastProvider";

export const metadata = {
    title: `${BRAND.productName} — Operations`,
    description: "Meal-service bookings and daily preparation counts.",
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body><ToastProvider>{children}</ToastProvider></body>
        </html>
    );
}
