// lib/brand.js — product name and domain in ONE place, mirroring the backend's
// config/brand.js. Nothing in the UI hardcodes "Chefo Booking" or
// "booking.chefo.in", so renaming the product or moving the domain is an env
// change rather than a search-and-replace.
export const BRAND = {
    productName: process.env.NEXT_PUBLIC_BRAND_PRODUCT_NAME || "Chefo Booking",
    shortName: process.env.NEXT_PUBLIC_BRAND_SHORT_NAME || "Booking",
    company: process.env.NEXT_PUBLIC_BRAND_COMPANY || "Chefo",
    domain: process.env.NEXT_PUBLIC_BRAND_DOMAIN || "booking.chefo.in",
};
