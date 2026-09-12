// services/mailer.js — transactional email through Brevo's REST API.
//
// One function, one provider, no SDK: the v3 "smtp/email" endpoint is a
// single JSON POST and Node 18+ ships fetch, so pulling in a client library
// would only add a dependency for the sake of one request shape.
//
// Every message goes out from MAIL_FROM ("Chefo Booking <no-reply@chefo.in>").
// The API key and sender are read from the environment ONLY — never logged,
// never returned to a caller, never part of an error message.
const { BRAND } = require("../config/brand");

const ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/** "Chefo Booking <no-reply@chefo.in>" -> { name, email }. A bare address works too. */
function parseFrom(raw) {
    const s = String(raw || "").trim();
    const m = s.match(/^(.*?)\s*<([^>]+)>$/);
    if (m) return { name: m[1].trim() || BRAND.productName, email: m[2].trim() };
    return { name: BRAND.productName, email: s };
}

const isConfigured = () => Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM);

/**
 * Send one email. Resolves when Brevo has accepted it; rejects on any failure
 * with a message safe to surface ("Couldn't send the email").
 */
async function sendMail({ to, toName = "", subject, html, text }) {
    if (!isConfigured()) {
        const e = new Error("Email isn't set up on this server.");
        e.status = 503;
        e.code = "MAIL_UNCONFIGURED";
        e.expose = true;   // a 5xx the caller is meant to read — see middleware/errors.js
        throw e;
    }
    const sender = parseFrom(process.env.MAIL_FROM);

    let res;
    try {
        res = await fetch(ENDPOINT, {
            method: "POST",
            headers: {
                "api-key": process.env.BREVO_API_KEY,
                "content-type": "application/json",
                accept: "application/json",
            },
            body: JSON.stringify({
                sender,
                to: [{ email: to, ...(toName ? { name: toName } : {}) }],
                subject,
                htmlContent: html,
                ...(text ? { textContent: text } : {}),
            }),
        });
    } catch (err) {
        console.error("mailer: network error:", err.message);
        const e = new Error("Couldn't send the email. Please try again.");
        e.status = 502;
        e.code = "MAIL_FAILED";
        throw e;
    }

    if (!res.ok) {
        // Brevo's error body names the problem (bad sender, bad key) — useful
        // in the server log, never on the wire.
        let detail = "";
        try { detail = (await res.json())?.message || ""; } catch { /* ignore */ }
        console.error(`mailer: Brevo responded ${res.status}${detail ? ` — ${detail}` : ""}`);
        const e = new Error("Couldn't send the email. Please try again.");
        e.status = 502;
        e.code = "MAIL_FAILED";
        throw e;
    }
}

/* ------------------------------------------------------------------ */
/* Templates                                                            */
/* ------------------------------------------------------------------ */
// Plain, table-free HTML in the brand palette. Email clients strip most CSS,
// so everything is inline and the layout is a single column.
const shell = (title, body) => `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7f5;font-family:'Public Sans',Segoe UI,Roboto,Arial,sans-serif;color:#1c2520;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="font-family:Sora,Segoe UI,Arial,sans-serif;font-weight:700;font-size:18px;color:#1c2520;margin-bottom:18px;">
      Chef<span style="color:#206e4e;">o</span> <span style="font-weight:500;color:#5b6660;font-size:14px;">${BRAND.shortName}</span>
    </div>
    <div style="background:#ffffff;border:1px solid #e3e7e1;border-radius:12px;padding:24px;">
      <h1 style="margin:0 0 10px;font-family:Sora,Segoe UI,Arial,sans-serif;font-size:19px;">${title}</h1>
      ${body}
    </div>
    <p style="font-size:12px;color:#8a948e;margin:16px 4px 0;">
      Sent by ${BRAND.productName}. If you didn't ask for this, you can ignore it — nothing changes without the code.
    </p>
  </div>
</body></html>`;

/** The 4-digit password-reset code. */
function passwordResetEmail({ name, code, minutes }) {
    const first = String(name || "").trim().split(" ")[0] || "there";
    return {
        subject: `${code} is your ${BRAND.productName} reset code`,
        html: shell("Reset your password", `
      <p style="margin:0 0 16px;font-size:14.5px;line-height:1.6;color:#5b6660;">
        Hi ${first}, use this code to set a new password for your ${BRAND.productName} account.
      </p>
      <div style="font-family:'IBM Plex Mono',Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:.32em;text-align:center;padding:16px 0;background:#e9f3ee;color:#185a40;border-radius:10px;">
        ${code}
      </div>
      <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#5b6660;">
        It expires in ${minutes} minutes and works once. Never share it — ${BRAND.company} will never ask you for it.
      </p>`),
        text: `Hi ${first},\n\nYour ${BRAND.productName} password reset code is ${code}. It expires in ${minutes} minutes and works once.\n\nIf you didn't ask for this, ignore this email.`,
    };
}

/** Welcome note after a business registers. Informational; failure is ignored. */
function welcomeEmail({ name, businessName, bookingUrl }) {
    const first = String(name || "").trim().split(" ")[0] || "there";
    return {
        subject: `Welcome to ${BRAND.productName}, ${first}`,
        html: shell(`${businessName} is set up`, `
      <p style="margin:0 0 12px;font-size:14.5px;line-height:1.6;color:#5b6660;">
        Your account is ready. Customers can book meals at your booking page:
      </p>
      <p style="margin:0 0 16px;"><a href="${bookingUrl}" style="font-family:'IBM Plex Mono',Menlo,Consolas,monospace;color:#185a40;word-break:break-all;">${bookingUrl}</a></p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#5b6660;">
        Next: open Settings to add your meal services, their cutoff times, and the options customers choose from.
      </p>`),
        text: `Hi ${first},\n\n${businessName} is set up on ${BRAND.productName}. Your booking page: ${bookingUrl}\n\nNext, open Settings to add meal services, cutoffs and options.`,
    };
}

/**
 * A formal activity notice. Plain language, one detail table, a clear "what to
 * do if this wasn't you" — the tone of a bank's account-activity letter, not a
 * marketing email. Used for every event in services/notify.js.
 *
 * @param rows [{ label, value }] — the facts, in the order they should be read
 */
function activityNoticeEmail({ title, summary, rows = [], concern, businessName, manageHint }) {
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const table = rows.map((r) => `
        <tr>
          <td style="padding:8px 12px 8px 0;font-size:13px;color:#5b6660;white-space:nowrap;vertical-align:top;border-bottom:1px solid #eef0ec;">${esc(r.label)}</td>
          <td style="padding:8px 0;font-size:13.5px;color:#1c2520;vertical-align:top;border-bottom:1px solid #eef0ec;">${esc(r.value)}</td>
        </tr>`).join("");
    return {
        subject: `[${BRAND.productName}] ${title}${businessName ? ` — ${businessName}` : ""}`,
        html: shell(title, `
      <p style="margin:0 0 14px;font-size:14.5px;line-height:1.6;color:#1c2520;">${esc(summary)}</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 16px;">${table}</table>
      ${concern ? `<div style="padding:12px 14px;border-radius:8px;background:#f8f0df;border:1px solid #ecdcb6;font-size:13px;line-height:1.55;color:#6b4d12;"><strong>If this wasn't expected:</strong> ${esc(concern)}</div>` : ""}
      <p style="margin:16px 0 0;font-size:12.5px;line-height:1.55;color:#8a948e;">${esc(manageHint || "You receive this notice because activity notifications are switched on for your account. Adjust which events are emailed under Settings → Notifications in your dashboard.")}</p>`),
        text: `${title}\n\n${summary}\n\n${rows.map((r) => `${r.label}: ${r.value}`).join("\n")}\n\n${concern ? `If this wasn't expected: ${concern}\n\n` : ""}${manageHint || "Adjust which events are emailed under Settings → Notifications."}`,
    };
}

module.exports = { sendMail, isConfigured, passwordResetEmail, welcomeEmail, activityNoticeEmail };
