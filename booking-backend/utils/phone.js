// utils/phone.js — one phone format, normalised at the boundary.
//
// The phone number IS the booking party's identity, so "9938179834",
// "919938179834" and "+91 99381 79834" must all resolve to the same party or
// the recognition promise quietly breaks. Every write and every lookup goes
// through normalisePhone(); nothing stores what the user typed.
const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY_CODE || "91";

function normalisePhone(raw) {
    if (raw === null || raw === undefined) return null;
    const digits = String(raw).replace(/\D/g, "");
    if (!digits) return null;

    // Already carries the country code.
    if (digits.length === 12 && digits.startsWith(DEFAULT_COUNTRY)) return `+${digits}`;
    // Indian numbers dialled with a leading 0.
    if (digits.length === 11 && digits.startsWith("0")) return `+${DEFAULT_COUNTRY}${digits.slice(1)}`;
    if (digits.length === 10) return `+${DEFAULT_COUNTRY}${digits}`;
    // Anything else plausible as an international number is kept as-is rather
    // than mangled — a guest house may well have a foreign guest.
    if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
    return null;
}

/** "+919938179834" -> "+91 99381 79834", for reading aloud over a phone. */
function prettyPhone(stored) {
    const s = String(stored || "");
    const m = s.match(/^\+(\d{1,3})(\d{5})(\d{5})$/);
    return m ? `+${m[1]} ${m[2]} ${m[3]}` : s;
}

module.exports = { normalisePhone, prettyPhone, DEFAULT_COUNTRY };
