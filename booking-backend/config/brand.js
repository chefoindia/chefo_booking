// config/brand.js — product name and domain in ONE place.
//
// The product is called "Booking" and lives at booking.chefo.in today, and
// neither of those is expected to survive contact with marketing. Nothing in
// the codebase hardcodes either: emails, page titles, reference prefixes and
// CORS origins all read from here, so a rename is an env change.
const BRAND = {
    productName: process.env.BRAND_PRODUCT_NAME || "Chefo Booking",
    shortName: process.env.BRAND_SHORT_NAME || "Booking",
    company: process.env.BRAND_COMPANY || "Chefo",
    // No scheme, no trailing slash.
    domain: process.env.BRAND_DOMAIN || "booking.chefo.in",
    supportEmail: process.env.BRAND_SUPPORT_EMAIL || "support@chefo.in",
};

const customerUrl = (path = "") =>
    `${process.env.CUSTOMER_APP_URL || `https://${BRAND.domain}`}${path}`;

module.exports = { BRAND, customerUrl };
