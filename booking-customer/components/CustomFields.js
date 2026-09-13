"use client";
// components/CustomFields.js — the questions THIS canteen asks.
//
// WHY: every canteen wants one or two things nobody else wants. An employee
// code. A department. Which floor to send the trolley to. A vehicle number at
// the gate. Hardcoding those would mean a release per customer, and a form that
// asks everyone for a floor they don't have. So the operator configures them
// and this renders whatever comes back — in their order, with their labels,
// their help text, their required flags.
//
// Two rules it keeps. A field only appears for the meal services and party
// types it was configured for (an empty list means "all"), because a question
// about tiffin delivery has no business on a walk-in breakfast. And it answers
// nothing itself: the server snapshots the answers onto the booking at write
// time, so editing a field next month never rewrites what somebody said today.

const applies = (keys, k) => !Array.isArray(keys) || keys.length === 0 || (!!k && keys.includes(k));

/** The fields that apply right now, in the order the operator put them in. */
export function visibleFields(fields, mealTypeKey, partyTypeKey) {
    return (Array.isArray(fields) ? fields : [])
        .filter((f) => f && f.key && f.active !== false)
        .filter((f) => applies(f.mealTypeKeys, mealTypeKey) && applies(f.partyTypeKeys, partyTypeKey))
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
            || String(a.label || "").localeCompare(String(b.label || "")));
}

/**
 * Which required answers are still blank — the page gates its submit button on
 * this, so the customer is never allowed to send something the canteen will
 * only have to chase them about. Checkboxes are strings too ("yes" / ""), so
 * one emptiness test covers every type.
 */
export function missingRequired(fields, mealTypeKey, partyTypeKey, values) {
    return visibleFields(fields, mealTypeKey, partyTypeKey)
        .filter((f) => f.required)
        .filter((f) => !String(values?.[f.key] ?? "").trim())
        .map((f) => f.key);
}

/**
 * props
 *   fields        business.bookingFields, straight from the server
 *   mealTypeKey   the chosen meal service's key ("" until one is chosen)
 *   partyTypeKey  the chosen party type's key
 *   values        { [key]: string }
 *   onChange      (key, value) => void
 *   errors        { [key]: message } — shown only for fields already touched
 */
export default function CustomFields({ fields, mealTypeKey, partyTypeKey, values, onChange, errors }) {
    const shown = visibleFields(fields, mealTypeKey, partyTypeKey);
    if (!shown.length) return null;

    return (
        <div className="stack-sm cf">
            {shown.map((f) => {
                const v = values?.[f.key] ?? "";
                const bad = errors?.[f.key];
                const set = (val) => onChange?.(f.key, val);
                const ph = f.placeholder || f.label;

                // The label sits above everything except a checkbox, where the
                // label IS the thing being ticked and reads better beside it.
                return (
                    <div key={f.key} className="cf-field">
                        {f.type !== "checkbox" && (
                            <label className="label" htmlFor={`cf-${f.key}`} style={{ marginBottom: 5 }}>
                                {f.label}
                                {!f.required && <span className="faint" style={{ fontWeight: 500 }}> (optional)</span>}
                            </label>
                        )}

                        {f.type === "textarea" ? (
                            <textarea id={`cf-${f.key}`} className="textarea" rows={2} placeholder={ph}
                                value={v} onChange={(e) => set(e.target.value)} />
                        ) : f.type === "select" ? (
                            <select id={`cf-${f.key}`} className="select" value={v}
                                onChange={(e) => set(e.target.value)}>
                                <option value="">{f.placeholder || "Choose one"}</option>
                                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                        ) : f.type === "checkbox" ? (
                            <label className="cf-check">
                                <input id={`cf-${f.key}`} type="checkbox" checked={String(v) === "yes"}
                                    onChange={(e) => set(e.target.checked ? "yes" : "")} />
                                <span>
                                    {f.label}
                                    {!f.required && <span className="faint"> (optional)</span>}
                                </span>
                            </label>
                        ) : (
                            <input id={`cf-${f.key}`} className="input"
                                type={f.type === "date" ? "date" : f.type === "number" ? "number"
                                    : f.type === "tel" ? "tel" : f.type === "email" ? "email" : "text"}
                                inputMode={f.type === "number" ? "numeric" : f.type === "tel" ? "tel" : undefined}
                                placeholder={f.type === "date" ? undefined : ph}
                                value={v} onChange={(e) => set(e.target.value)} />
                        )}

                        {f.help && <span className="hint">{f.help}</span>}
                        {bad && <span className="hint cf-bad">{bad}</span>}
                    </div>
                );
            })}

            <style>{`
              .cf-field { display: block; }
              .cf-check { display: flex; align-items: flex-start; gap: 9px; font-size: 14px; cursor: pointer; }
              .cf-check input { width: 19px; height: 19px; margin: 1px 0 0; accent-color: var(--basil); flex-shrink: 0; }
              .cf-bad { color: var(--brick); font-weight: 600; }
            `}</style>
        </div>
    );
}
