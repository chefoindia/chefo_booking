// components/Icons.js — the handful of line icons this app uses, inline so
// nothing is fetched and the stroke matches the text weight next to it.
const base = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

export const Icon = ({ d, size = 20, sw, ...rest }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} {...(sw ? { strokeWidth: sw } : {})} {...rest}>
        {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
    </svg>
);

export const PATHS = {
    home: "M3 10.5 12 3l9 7.5V21H3z",
    menu: ["M4 6h16", "M4 12h16", "M4 18h10"],
    calendar: ["M4 6h16v15H4z", "M4 10h16", "M8 3v4", "M16 3v4"],
    profile: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8", "M4.5 20.5a7.5 7.5 0 0 1 15 0"],
    plus: ["M12 5v14", "M5 12h14"],
    check: "m5 12 5 5L20 7",
    chevron: "m9 6 6 6-6 6",
    clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", "M12 7v5l3 2"],
    pin: ["M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z", "M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6"],
    qr: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h2v2h-2z", "M18 14h2v2h-2z", "M14 18h2v2h-2z", "M18 18h2v2h-2z"],
    phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
    shield: ["M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6z", "m9 12 2 2 4-4"],
    edit: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"],
    x: ["M18 6 6 18", "M6 6l12 12"],
    utensils: ["M7 3v8", "M4 3v5a3 3 0 0 0 6 0V3", "M7 11v10", "M17 3c-2 0-3 2-3 5v3h3v10", "M17 3v18"],
    sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
};
