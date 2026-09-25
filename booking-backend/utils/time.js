// utils/time.js — every date and time decision in this product goes through
// here, because the cutoff is the one rule the whole application turns on and
// it must never disagree with itself.
//
// WHY NOT `new Date()` AND LOCAL TIME
//
// The server may run in UTC (Render), the operator sits in IST, and the
// customer's browser could be anywhere. "Has the 10:30 cutoff passed?" has
// exactly one correct answer — the one measured in the BUSINESS's timezone —
// so a cutoff is resolved to a real UTC instant here and compared as an
// instant. Nothing downstream ever parses a clock string again.
//
// IST is UTC+5:30 with no daylight saving, ever, so the conversion is exact
// arithmetic rather than a guess. If Chefo later serves a business outside
// India, `offsetMinutes` is the single thing that changes.

const IST_OFFSET_MINUTES = 330; // +05:30

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const isDateKey = (v) => typeof v === "string" && DATE_RE.test(v);
const isTimeOfDay = (v) => typeof v === "string" && TIME_RE.test(v);

/**
 * A wall-clock date+time in the business timezone -> the real UTC instant.
 *
 * Date.UTC() gives us the instant that wall-clock reading would be IF the zone
 * were UTC; subtracting the zone's offset slides it to the correct instant.
 */
function zonedInstant(dateKey, timeOfDay, offsetMinutes = IST_OFFSET_MINUTES) {
    if (!isDateKey(dateKey) || !isTimeOfDay(timeOfDay)) return null;
    const [y, m, d] = dateKey.split("-").map(Number);
    const [hh, mm] = timeOfDay.split(":").map(Number);
    return new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0) - offsetMinutes * 60_000);
}

/** "Today" as the BUSINESS sees it — not as the server's clock sees it. */
function todayKey(offsetMinutes = IST_OFFSET_MINUTES, now = new Date()) {
    const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
    return shifted.toISOString().slice(0, 10);
}

/** Current wall-clock time in the business zone, as "HH:MM". */
function nowTimeOfDay(offsetMinutes = IST_OFFSET_MINUTES, now = new Date()) {
    const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
    return shifted.toISOString().slice(11, 16);
}

/** Calendar arithmetic on a date key, with no timezone involvement at all. */
function shiftDateKey(dateKey, days) {
    if (!isDateKey(dateKey)) return null;
    const [y, m, d] = dateKey.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function weekdayOf(dateKey) {
    if (!isDateKey(dateKey)) return null;
    const [y, m, d] = dateKey.split("-").map(Number);
    return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * THE CUTOFF INSTANT for one meal service on one date.
 *
 * `mealType.cutoffTime` is a wall-clock "HH:MM". `cutoffPreviousDay` shifts it
 * to the evening before, which is what a kitchen that shops or preps the night
 * before actually needs (the existing Cafeteria product does this for
 * breakfast). Both are per-meal-type configuration — nothing here is hardcoded
 * to breakfast/lunch/dinner, because operators define their own meal services.
 *
 * @returns {Date|null} null means THIS MEAL HAS NO CUTOFF — it never closes,
 *   so bookings are always auto-confirmed. That is a legitimate configuration
 *   (a stall taking orders until it runs out), not a missing value to guess at.
 */
function cutoffInstant(mealType, dateKey, offsetMinutes = IST_OFFSET_MINUTES) {
    if (!mealType || !isTimeOfDay(mealType.cutoffTime)) return null;
    const effectiveDate = mealType.cutoffPreviousDay ? shiftDateKey(dateKey, -1) : dateKey;
    return zonedInstant(effectiveDate, mealType.cutoffTime, offsetMinutes);
}

/**
 * The single question the whole product hangs on: is this meal already closed?
 *
 * Returns a small report rather than a bare boolean so callers can show the
 * customer WHY their booking needs approval and WHEN the deadline was, without
 * recomputing any of it themselves.
 */
function cutoffState(mealType, dateKey, { now = new Date(), offsetMinutes = IST_OFFSET_MINUTES } = {}) {
    const instant = cutoffInstant(mealType, dateKey, offsetMinutes);
    if (!instant) {
        return { hasCutoff: false, passed: false, cutoffAt: null, cutoffTime: null, cutoffDate: null };
    }
    return {
        hasCutoff: true,
        // `>=` so the cutoff minute itself is already closed. A booking landing
        // exactly at 10:30:00 for a 10:30 cutoff is late — the kitchen was
        // promised a final number AT 10:30, not a moment after it.
        passed: now.getTime() >= instant.getTime(),
        cutoffAt: instant,
        cutoffTime: mealType.cutoffTime,
        cutoffDate: mealType.cutoffPreviousDay ? shiftDateKey(dateKey, -1) : dateKey,
    };
}

/** "2026-09-08" -> "Tue, 8 Sep 2026" for human-facing output. */
function formatDateKey(dateKey) {
    if (!isDateKey(dateKey)) return "";
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
        weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    });
}

/** "14:30" -> "2:30 PM". */
function formatTimeOfDay(timeOfDay) {
    if (!isTimeOfDay(timeOfDay)) return "";
    const [hh, mm] = timeOfDay.split(":").map(Number);
    const period = hh >= 12 ? "PM" : "AM";
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:${String(mm).padStart(2, "0")} ${period}`;
}

/** "IST" for India, otherwise "UTC+05:30"-style — for a report's timestamp line. */
function zoneLabel(offsetMinutes = IST_OFFSET_MINUTES) {
    if (offsetMinutes === IST_OFFSET_MINUTES) return "IST";
    const sign = offsetMinutes < 0 ? "-" : "+";
    const abs = Math.abs(offsetMinutes);
    return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * An instant as "Tue, 8 Sep 2026, 9:05 PM IST" in the business zone. Pure
 * offset arithmetic, like everything else here, so it never depends on the
 * server's own timezone database.
 */
function formatInstant(instant, offsetMinutes = IST_OFFSET_MINUTES, { date = true, time = true } = {}) {
    if (!instant) return "";
    const d = instant instanceof Date ? instant : new Date(instant);
    if (Number.isNaN(d.getTime())) return "";
    const shifted = new Date(d.getTime() + offsetMinutes * 60_000);
    const key = shifted.toISOString().slice(0, 10);
    const parts = [];
    if (date) parts.push(formatDateKey(key));
    if (time) parts.push(`${formatTimeOfDay(shifted.toISOString().slice(11, 16))} ${zoneLabel(offsetMinutes)}`);
    return parts.join(", ");
}

module.exports = {
    IST_OFFSET_MINUTES,
    zoneLabel,
    formatInstant,
    isDateKey,
    isTimeOfDay,
    zonedInstant,
    todayKey,
    nowTimeOfDay,
    shiftDateKey,
    weekdayOf,
    cutoffInstant,
    cutoffState,
    formatDateKey,
    formatTimeOfDay,
};
