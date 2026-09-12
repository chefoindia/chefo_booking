// components/Empty.js — the "nothing here yet" / edge-case message shown across
// every data page. Same as Chefo's EmptyState: every instance gets a relevant
// icon, inferred from the title/note text unless `icon` is passed explicitly.
const ICONS = {
    customers: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" /><path d="M17.5 20a5.5 5.5 0 0 0-2.4-4.5" /></>,
    reports: <><path d="M4 4v16h16" /><rect x="7" y="11" width="3" height="6" /><rect x="12" y="7" width="3" height="10" /><rect x="17" y="13" width="3" height="4" /></>,
    calendar: <><rect x="3" y="4" width="18" height="17" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /></>,
    requests: <><path d="M4 5h16v10H8l-4 4z" /><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="12" x2="13" y2="12" /></>,
    menu: <><path d="M6 3v7a2 2 0 0 0 4 0V3" /><line x1="8" y1="10" x2="8" y2="21" /><path d="M16 3c-1.5 0-2.5 2-2.5 5s1 4 2.5 4v9" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4 13.4H3.9a2 2 0 0 1 0-4H4a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 4h.1a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><line x1="20" y1="20" x2="15.5" y2="15.5" /></>,
    error: <><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="13" /><circle cx="12" cy="16.5" r="0.6" fill="currentColor" /></>,
    users: <><circle cx="8.5" cy="8" r="3.2" /><path d="M2.5 20a6 6 0 0 1 12 0" /><circle cx="17.5" cy="9.5" r="2.4" /><path d="M15 20a5 5 0 0 1 6.5-4.3" /></>,
    roles: <><path d="M12 3l7 3v5.5c0 4-3 7-7 8.5-4-1.5-7-4.5-7-8.5V6z" /><polyline points="9 12 11 14 15 10" /></>,
    check: <><circle cx="12" cy="12" r="9" /><polyline points="8 12.5 11 15.5 16 9.5" /></>,
    inbox: <><path d="M3 12h5l2 3h4l2-3h5" /><path d="M5.5 5h13l2.5 7v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6z" /></>,
};

const KEYWORD_MAP = [
    [/customer|party|parties|nobody/i, "customers"],
    [/role/i, "roles"],
    [/team|people|staff/i, "users"],
    [/report|analytic/i, "reports"],
    [/meal service|option|menu/i, "menu"],
    [/setting|config|cutoff|cut-off/i, "settings"],
    [/nothing waiting|nothing decided|decided|waiting/i, "check"],
    [/request|approval|booking/i, "requests"],
    [/date|today|day/i, "calendar"],
    [/search|match|found|filter/i, "search"],
    [/couldn.t|fail|error|unavailable|wrong|invalid/i, "error"],
];

function inferIcon(title, note) {
    const text = `${title || ""} ${note || ""}`;
    for (const [re, key] of KEYWORD_MAP) if (re.test(text)) return key;
    return "inbox";
}

export default function Empty({ title, note, action, icon }) {
    const key = icon || inferIcon(title, note);
    const paths = ICONS[key] || ICONS.inbox;
    return (
        <div className="empty">
            <svg className="empty-ico" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {paths}
            </svg>
            <h3>{title}</h3>
            {note && <p className="small">{note}</p>}
            {action && <div className="empty-action">{action}</div>}
        </div>
    );
}
