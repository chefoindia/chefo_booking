// services/reportScheduler.js — sends each business its daily report once, at
// the time it asked for, in its own timezone.
//
// HOW IT WORKS. Every minute, `tick()` reads the businesses with the report
// switched on and asks, for each one, "is it past their chosen time today,
// and has today's report not gone out yet?" Those that qualify are CLAIMED
// with an atomic compare-and-swap on the business document before anything is
// built or sent. The claim is what makes this safe to run in more than one
// process, and safe across a restart mid-send: two tickers that see the same
// business both try to claim it, and exactly one wins.
//
// FAILURES RETRY, BUT NOT FOREVER. A send that fails (Brevo down, a bad
// address) is retried a few times, spaced out, and then left alone until the
// next day — the error is kept on the business so the settings page can show
// it and the owner can press "Send now" once the cause is fixed. Retrying
// every minute all night would be a good way to get a sender blocked.
//
// NOTHING HERE IS SUMMED OR RENDERED: services/dailyReport.js does that, and
// the scheduler only decides WHEN.
const Business = require("../models/Business");
const { sendDailyReport } = require("./dailyReport");
const { todayKey, nowTimeOfDay, isTimeOfDay } = require("../utils/time");
const mailer = require("./mailer");

const TICK_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 10 * 60_000;

let timer = null;
let running = false;

/**
 * Pure: is this business due right now? Exported so the tests can drive it
 * with an injected clock.
 */
function isDue(business, now = new Date()) {
    const cfg = business.dailyReport || {};
    if (!cfg.enabled) return false;
    if (!Array.isArray(cfg.recipients) || !cfg.recipients.length) return false;
    if (!isTimeOfDay(cfg.time)) return false;

    const tz = business.timezoneOffsetMinutes ?? 330;
    const today = todayKey(tz, now);
    if (nowTimeOfDay(tz, now) < cfg.time) return false;
    if (cfg.lastSent?.date === today) return false;

    const la = cfg.lastAttempt || {};
    if (la.date === today) {
        if ((la.attempts || 0) >= MAX_ATTEMPTS) return false;
        if (la.at && now.getTime() - new Date(la.at).getTime() < RETRY_AFTER_MS) return false;
    }
    return true;
}

/**
 * Atomically mark "we are sending today's report now". Returns the claimed
 * document, or null if somebody else got there first (or it is no longer due).
 */
async function claim(business, now = new Date()) {
    const tz = business.timezoneOffsetMinutes ?? 330;
    const today = todayKey(tz, now);
    const la = business.dailyReport?.lastAttempt || {};
    const sameDay = la.date === today;

    const filter = {
        _id: business._id,
        "dailyReport.enabled": true,
        "dailyReport.lastSent.date": { $ne: today },
        // The compare half of compare-and-swap: the attempt record must still
        // read exactly as it did when we decided this business was due.
        ...(sameDay
            ? { "dailyReport.lastAttempt.date": today, "dailyReport.lastAttempt.attempts": la.attempts || 0 }
            : { "dailyReport.lastAttempt.date": { $ne: today } }),
    };
    const update = {
        $set: {
            "dailyReport.lastAttempt.date": today,
            "dailyReport.lastAttempt.at": now,
            "dailyReport.lastAttempt.attempts": sameDay ? (la.attempts || 0) + 1 : 1,
            "dailyReport.lastAttempt.error": "",
        },
    };
    return Business.findOneAndUpdate(filter, update, { new: true });
}

async function markSent(businessId, date, to, now = new Date()) {
    await Business.updateOne({ _id: businessId }, {
        $set: { "dailyReport.lastSent": { date, at: now, to }, "dailyReport.lastAttempt.error": "" },
    });
}

async function markFailed(businessId, message) {
    await Business.updateOne({ _id: businessId }, { $set: { "dailyReport.lastAttempt.error": String(message || "Failed").slice(0, 300) } });
}

/**
 * One pass. Returns a small summary so a test (or a log line) can see what
 * happened. Never throws: one business's failure must not stop the others.
 */
async function tick(now = new Date()) {
    const out = { checked: 0, sent: [], failed: [], skipped: 0 };
    if (!mailer.isConfigured() && !process.env.DAILY_REPORT_FORCE) {
        // Without a sender there is nothing to do, and saying so once a minute
        // would drown the log. The settings page tells the owner instead.
        return out;
    }
    let candidates = [];
    try {
        candidates = await Business.find({ "dailyReport.enabled": true, "dailyReport.recipients.0": { $exists: true } })
            .select("name slug timezoneOffsetMinutes dailyReport").lean();
    } catch (e) {
        console.error("reportScheduler: could not list businesses:", e.message);
        return out;
    }

    for (const b of candidates) {
        out.checked++;
        if (!isDue(b, now)) { out.skipped++; continue; }
        let claimed = null;
        try { claimed = await claim(b, now); } catch (e) { console.error("reportScheduler: claim failed:", e.message); }
        if (!claimed) { out.skipped++; continue; }

        const tz = claimed.timezoneOffsetMinutes ?? 330;
        const date = todayKey(tz, now);
        try {
            const result = await sendDailyReport({ business: claimed, date, now, trigger: "schedule" });
            await markSent(claimed._id, date, result.to, now);
            out.sent.push({ business: claimed.name, date, to: result.to });
        } catch (e) {
            console.error(`reportScheduler: ${claimed.name} (${date}) failed:`, e.message);
            await markFailed(claimed._id, e.message).catch(() => {});
            out.failed.push({ business: claimed.name, date, error: e.message });
        }
    }
    return out;
}

/** Start ticking. Idempotent. */
function start() {
    if (timer) return;
    const run = async () => {
        if (running) return;   // a slow tick must not overlap the next
        running = true;
        try { await tick(); } catch (e) { console.error("reportScheduler tick error:", e.message); }
        finally { running = false; }
    };
    timer = setInterval(run, TICK_MS);
    if (typeof timer.unref === "function") timer.unref();
    // First pass shortly after boot, so a restart at 21:03 still sends the
    // 21:00 report rather than waiting a day.
    setTimeout(run, 5_000).unref?.();
    console.log("Daily report scheduler running (checks every minute).");
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = { start, stop, tick, isDue, claim, MAX_ATTEMPTS, RETRY_AFTER_MS };
