// app/page.js — marketing landing for Chefo Booking (booking.chefo.in).
//
// Server component, so the `metadata` export keeps working for SEO. The
// scroll-reveal is a tiny client component (ScrollReveal), not React state.
//
// Every claim here describes something the product actually does: the soft
// cutoff and its approval queue, per-option preparation counts, the public
// booking page, phone-OTP sign-in, roles, and the audit trail. Nothing
// invented — no fictional customers, no numbers we can't stand behind.
import Image from "next/image";
import Link from "next/link";
import ScrollReveal from "@/components/ScrollReveal";
import { BRAND } from "@/lib/brand";

export const metadata = {
    title: "Chefo Booking — meal bookings, late-request approvals & exact kitchen counts",
    description:
        "Take meal bookings for every service you run. Before your cutoff they confirm themselves; after it, late bookings, changes and cancellations wait for your approval — so the kitchen always cooks to a number you actually agreed to.",
};

/* ---------------------------------------------------------------------
   Line icons — stroke = currentColor. No emoji, no stock art.
--------------------------------------------------------------------- */
const ip = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
const IconClock = () => (<svg {...ip}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>);
const IconInbox = () => (<svg {...ip}><path d="M3 12h5l2 3h4l2-3h5" /><path d="M5.5 5h13l2.5 7v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6z" /></svg>);
const IconClipboard = () => (<svg {...ip}><rect x="6" y="4" width="12" height="17" rx="2" /><rect x="9" y="2" width="6" height="4" rx="1" /><line x1="9" y1="11" x2="15" y2="11" /><line x1="9" y1="15" x2="13" y2="15" /></svg>);
const IconHistory = () => (<svg {...ip}><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 3 3 9 9 9" /><polyline points="12 7 12 12 15 14" /></svg>);
const IconGlobe = () => (<svg {...ip}><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" /></svg>);
const IconUsers = () => (<svg {...ip}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>);
const IconSliders = () => (<svg {...ip}><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>);
const IconShield = () => (<svg {...ip}><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" /><polyline points="9 12 11 14 15 10" /></svg>);
const IconSmartphone = () => (<svg {...ip}><rect x="7" y="2" width="10" height="20" rx="2" /><line x1="11" y1="18" x2="13" y2="18" /></svg>);
const IconBuilding = () => (<svg {...ip}><rect x="5" y="3" width="14" height="18" rx="1" /><rect x="10" y="14" width="4" height="7" /><line x1="9" y1="7" x2="9" y2="7" /><line x1="15" y1="7" x2="15" y2="7" /></svg>);
const IconTruck = () => (<svg {...ip}><path d="M3 7h11v8H3z" /><path d="M14 10h4l3 3v2h-7z" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></svg>);
const IconHome = () => (<svg {...ip}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>);
const IconLayers = () => (<svg {...ip}><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>);

const VALUES = [
    { Icon: IconClipboard, title: "An exact count, per option", body: "Every meal service shows the confirmed quantity split across the options you actually serve — Veg, Non-Veg, Jain, whatever you've set up. A zero is shown too, because a kitchen needs to see the zero." },
    { Icon: IconClock, title: "A cutoff that isn't a wall", body: "Set a deadline per service. Bookings before it confirm themselves instantly. Bookings after it aren't refused — they become a request you can accept when you have room, or decline when you don't." },
    { Icon: IconInbox, title: "Nothing changes behind your back", body: "Once the cutoff passes, no customer can quietly alter a confirmed booking. A late change leaves the original untouched and waits in your queue until you decide." },
    { Icon: IconHistory, title: "Every decision on the record", body: "Who accepted what, when, and what the numbers were before and after. When somebody asks why the kitchen cooked 200 and not 185, the answer is written down." },
];

const AUDIENCE = [
    { Icon: IconBuilding, title: "Corporate cafeterias", body: "Take headcounts from every floor or team, then hand the kitchen one confirmed number per service." },
    { Icon: IconTruck, title: "Caterers & project sites", body: "A site supervisor books 80 lunches in one submission — one record with a per-option breakdown, not eighty rows." },
    { Icon: IconHome, title: "Guest houses & hostels", body: "Residents book the meals they'll actually eat, so nothing is cooked for a room that's empty tonight." },
    { Icon: IconLayers, title: "Canteens & food stalls", body: "Run a service with no cutoff at all — orders stay open and auto-confirm until you stop taking them." },
];

const STEPS = [
    { n: "1", title: "Register in two minutes", body: "Verify your mobile with an SMS code, name your business, and add the meal services you run. Nothing else is required to start taking bookings." },
    { n: "2", title: "Share your booking link", body: "You get a public page at booking.chefo.in. Customers open it, pick a meal and a date, enter quantities, and leave a phone number. No account, no app, no password." },
    { n: "3", title: "Decide on the late ones", body: "Anything that arrives after the cutoff lands in your approval queue with the plate difference spelled out — +8 meals, −3 meals — so a decision takes a second." },
    { n: "4", title: "Cook to the confirmed number", body: "The Today screen holds one number per service, split by option, refreshed as decisions are made. Pending requests are listed separately and never counted until you accept them." },
];

const CUTOFF_ROWS = [
    { what: "A new booking", before: "Confirmed instantly and counted", after: "Waits in your queue as a pending request" },
    { what: "A change to quantities", before: "Applied straight away", after: "Change request — the booking keeps its old numbers until you accept" },
    { what: "A cancellation", before: "Applied straight away", after: "Cancellation request — the meals stay in the count until you accept" },
];

const SERVICES = [
    { Icon: IconSliders, title: "Meal services, defined by you", body: "Breakfast, Lunch, a night-shift meal — each with its own serving window and its own cutoff, which can fall on the day before for a kitchen that preps overnight." },
    { Icon: IconLayers, title: "Options that aren't hardcoded", body: "Veg and Non-Veg are just rows you can rename or replace. Add Jain, Egg or Thali A, restrict one to lunch only, and every booking form and kitchen count follows." },
    { Icon: IconInbox, title: "One approval queue", body: "Late bookings, change requests and cancellations in a single list, oldest first, each showing exactly how many plates the decision moves." },
    { Icon: IconGlobe, title: "A public booking page", body: "Your own link with your name, address and live cutoff status. It tells the customer up front whether their booking will confirm or need your approval." },
    { Icon: IconUsers, title: "Team roles you invent", body: "Build a role like “Counter staff” from a grid of permissions and assign it. Viewing never implies editing, and nobody can grant a permission they don't hold." },
    { Icon: IconHistory, title: "Customers who are remembered", body: "A phone number is recognised on the next booking, so a regular site or office arrives with its history attached instead of being retyped every morning." },
];

const TRUST = [
    { Icon: IconSmartphone, title: "OTP-verified sign-in", body: "You sign in with an SMS code to your registered mobile — the same phone verification as the rest of Chefo. A password is optional and only exists if you set one." },
    { Icon: IconShield, title: "Permissions enforced at the API", body: "Hiding a button is presentation. Every action is independently checked on the server, so a hidden page reached by typing its URL still returns nothing." },
    { Icon: IconHistory, title: "Records are never rewritten", body: "A resolved request keeps what was asked and what it replaced, forever. Renaming an option later doesn't rewrite what last month's kitchen sheets said." },
    { Icon: IconClock, title: "One clock, everywhere", body: "A cutoff resolves to a real instant in your business's timezone, so the answer to “has it closed?” is the same on your screen, the customer's, and the server." },
];

const FAQS = [
    { q: "Do my customers need an account?", a: "No. They open your link, book, and leave a mobile number. That number is how they look up or cancel a booking later — there is no signup, password or app." },
    { q: "What if a meal service never really closes?", a: "Leave its cutoff empty. That service stays open and every booking auto-confirms, which is the right setup for a stall taking orders until it runs out." },
    { q: "Can I take a booking myself, at the counter?", a: "Yes, and it confirms immediately whatever the clock says — asking you to approve your own booking would be theatre." },
    { q: "Does a late request change my kitchen count?", a: "Not until you accept it. Confirmed and pending are shown as two separate numbers and are never added together." },
    { q: "Can I stop taking bookings for a while?", a: "Switch bookings off from the dashboard and write a short message customers will see. Existing bookings are untouched — only new ones stop." },
    { q: "What happens if I rename a meal option?", a: "Future bookings use the new name; past ones keep the name they were made with, so an old kitchen sheet still matches the day it described." },
    { q: "Can my staff sign in without my phone?", a: "Yes. Give them their own account with a login ID and password, and a role that says exactly what they may open." },
    { q: "Is this the same as Chefo's canteen subscriptions?", a: "No — this is a separate product for one-off meal bookings rather than recurring subscription plans. It has its own dashboard, its own data, and its own booking page." },
];

/* ---------------------------------------------------------------------
   Hero phone mock — header fixed, body cycles through three real screens.
--------------------------------------------------------------------- */
function BookingPhoneMock() {
    const variants = [{ l: "Veg", n: 96 }, { l: "Non-Veg", n: 74 }, { l: "Jain", n: 12 }];
    const bars = [{ l: "B", h: 26 }, { l: "L", h: 56 }, { l: "D", h: 38 }];

    return (
        <div className="ol-phone" aria-hidden="true">
            <div className="ol-phone-notch" />
            <div className="ol-phone-screen">
                <div className="ol-pm-top">
                    <span className="ol-pm-brand">CHEFO BOOKING</span>
                    <span className="ol-pm-pill">● Live</span>
                </div>

                <div className="ol-pm-body">
                    {/* 1 — Today's counts */}
                    <div className="ol-pm-screen p1">
                        <div className="ol-pm-loc">Today · Lunch</div>
                        <div className="ol-pm-card">
                            <div className="ol-pm-card-head">To prepare</div>
                            <div className="ol-pm-big">182</div>
                            <div className="ol-pm-sub">from 24 confirmed bookings</div>
                            <div className="ol-pm-varrow">
                                {variants.map((v) => (
                                    <div className="ol-pm-var" key={v.l}>
                                        <b>{v.n}</b><span>{v.l}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="ol-pm-card">
                            <div className="ol-pm-card-head">Across the day</div>
                            <div className="ol-pm-bars">
                                {bars.map((b) => (
                                    <div className="ol-pm-bar-col" key={b.l}>
                                        <div className="ol-pm-bar-fill2" style={{ height: `${b.h}px` }} />
                                        <span>{b.l}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="ol-pm-chip-dark">Lunch closed at 10:30 AM</div>
                        </div>
                    </div>

                    {/* 2 — The approval queue */}
                    <div className="ol-pm-screen p2">
                        <div className="ol-pm-loc">Approvals · 2 waiting</div>
                        <div className="ol-pm-card ol-pm-urgent">
                            <div className="ol-pm-reqhead">
                                <span className="ol-pm-badge amber">Late booking</span>
                                <span className="ol-pm-ago">4 min ago</span>
                            </div>
                            <div className="ol-pm-item-name">ABC Project Site</div>
                            <div className="ol-pm-item-sub">Lunch · today</div>
                            <div className="ol-pm-delta">+8<span> meals if accepted</span></div>
                            <div className="ol-pm-btnrow">
                                <span className="ol-pm-btn">Reject</span>
                                <span className="ol-pm-btn primary">Accept</span>
                            </div>
                        </div>
                        <div className="ol-pm-card">
                            <div className="ol-pm-reqhead">
                                <span className="ol-pm-badge red">Cancellation</span>
                                <span className="ol-pm-ago">12 min ago</span>
                            </div>
                            <div className="ol-pm-item-name">Tower B — 3rd floor</div>
                            <div className="ol-pm-delta down">−3<span> meals if accepted</span></div>
                        </div>
                    </div>

                    {/* 3 — What the customer sees */}
                    <div className="ol-pm-screen p3">
                        <div className="ol-pm-loc">Your booking page</div>
                        <div className="ol-pm-card">
                            <div className="ol-pm-card-head">Which meal?</div>
                            <div className="ol-pm-meal on">
                                <span><b>Lunch</b><i>Served 12:30–2:30 PM</i></span>
                                <span className="ol-pm-badge green">Till 10:30 AM</span>
                            </div>
                            <div className="ol-pm-meal">
                                <span><b>Dinner</b><i>Served 8:00–10:00 PM</i></span>
                                <span className="ol-pm-badge green">Till 4:30 PM</span>
                            </div>
                        </div>
                        <div className="ol-pm-card">
                            <div className="ol-pm-card-head">How many meals?</div>
                            {[{ l: "Veg", n: 7 }, { l: "Non-Veg", n: 8 }].map((r) => (
                                <div className="ol-pm-qty" key={r.l}>
                                    <span>{r.l}</span>
                                    <span className="ol-pm-stepper"><i>−</i><b>{r.n}</b><i>+</i></span>
                                </div>
                            ))}
                            <div className="ol-pm-total"><span>Total</span><b>15</b></div>
                        </div>
                        <div className="ol-pm-chip-dark">Book 15 meals</div>
                    </div>
                </div>
            </div>
            <div className="ol-pm-foot">Chefo Booking — the count, the queue, the page</div>
        </div>
    );
}

function CutoffTable() {
    return (
        <div className="ol-cut">
            <div className="ol-cut-head">
                <span />
                <span className="ol-cut-th before">Before your cutoff</span>
                <span className="ol-cut-th after">After your cutoff</span>
            </div>
            {CUTOFF_ROWS.map((r) => (
                <div className="ol-cut-row" key={r.what}>
                    <span className="ol-cut-what">{r.what}</span>
                    <span className="ol-cut-cell before">{r.before}</span>
                    <span className="ol-cut-cell after">{r.after}</span>
                </div>
            ))}
        </div>
    );
}

/** The customer booking page at real scale, reused in a browser and a phone frame. */
function BookingPagePreview({ wide }) {
    const meals = [
        { n: "Breakfast", t: "8:00–9:30 AM", s: "Till 7:00 AM", tone: "green" },
        { n: "Lunch", t: "12:30–2:30 PM", s: "Needs approval", tone: "amber" },
        { n: "Snacks", t: "4:30–5:30 PM", s: "Open", tone: "green" },
        { n: "Dinner", t: "8:00–10:00 PM", s: "Till 4:30 PM", tone: "green" },
    ];
    return (
        <div className="ol-web-body">
            <div className="ol-web-hero">
                <div className="ol-web-hero-title">Sunrise Kitchen</div>
                <div className="ol-web-hero-sub">Infocity Square, Bhubaneswar</div>
            </div>
            <div className="ol-web-menu-head">Which meal?</div>
            <div className={`ol-web-menu-grid ${wide ? "wide" : ""}`}>
                {meals.map((m) => (
                    <div className="ol-web-menu-item" key={m.n}>
                        <span className="ol-web-menu-name">
                            {m.n}<i>{m.t}</i>
                        </span>
                        <span className={`ol-web-pill ${m.tone}`}>{m.s}</span>
                    </div>
                ))}
            </div>
            <div className="ol-web-join">Book meals →</div>
            <div className="ol-web-note">No account needed — just your mobile number.</div>
        </div>
    );
}

export default function LandingPage() {
    return (
        <div className="ol">
            <style>{`
        .ol { min-height: 100vh; background: #faf7f2; color: #1c2520; font-family: var(--font-body), system-ui, sans-serif; }
        .ol * { box-sizing: border-box; }
        .ol-max { max-width: 1400px; margin: 0 auto; padding: 0 20px; }
        .ol h1, .ol h2, .ol h3 { font-family: var(--font-display), sans-serif; }
        .ol-accent { text-decoration: underline; text-decoration-color: #d99a2b; text-decoration-thickness: 4px; text-underline-offset: 6px; }

        @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }

        /* ---- scroll reveal ---- */
        .reveal { opacity: 0; transform: translateY(28px); transition: opacity .8s ease, transform .8s ease; }
        .reveal.in-view { opacity: 1; transform: none; }
        .reveal .ol-value, .reveal .ol-step-card, .reveal .ol-service, .reveal .ol-faq-item {
          opacity: 0; transform: translateY(14px); transition: opacity .6s ease, transform .6s ease;
        }
        .reveal.in-view .ol-value, .reveal.in-view .ol-step-card, .reveal.in-view .ol-service, .reveal.in-view .ol-faq-item { opacity: 1; transform: none; }
        .reveal.in-view .ol-value:nth-child(1), .reveal.in-view .ol-step-card:nth-child(1), .reveal.in-view .ol-service:nth-child(1), .reveal.in-view .ol-faq-item:nth-child(1) { transition-delay: .05s; }
        .reveal.in-view .ol-value:nth-child(2), .reveal.in-view .ol-step-card:nth-child(2), .reveal.in-view .ol-service:nth-child(2), .reveal.in-view .ol-faq-item:nth-child(2) { transition-delay: .12s; }
        .reveal.in-view .ol-value:nth-child(3), .reveal.in-view .ol-step-card:nth-child(3), .reveal.in-view .ol-service:nth-child(3), .reveal.in-view .ol-faq-item:nth-child(3) { transition-delay: .19s; }
        .reveal.in-view .ol-value:nth-child(4), .reveal.in-view .ol-step-card:nth-child(4), .reveal.in-view .ol-service:nth-child(4), .reveal.in-view .ol-faq-item:nth-child(4) { transition-delay: .26s; }
        .reveal.in-view .ol-service:nth-child(5), .reveal.in-view .ol-faq-item:nth-child(5) { transition-delay: .33s; }
        .reveal.in-view .ol-service:nth-child(6), .reveal.in-view .ol-faq-item:nth-child(6) { transition-delay: .4s; }
        .reveal.in-view .ol-faq-item:nth-child(7) { transition-delay: .47s; }
        .reveal.in-view .ol-faq-item:nth-child(8) { transition-delay: .54s; }
        @media (prefers-reduced-motion: reduce) {
          .reveal, .reveal .ol-value, .reveal .ol-step-card, .reveal .ol-service, .reveal .ol-faq-item { opacity: 1 !important; transform: none !important; transition: none !important; }
        }

        .ol-nav { position: sticky; top: 0; z-index: 20; background: rgba(250,247,242,.94); backdrop-filter: blur(6px); border-bottom: 1px solid #e6e1d8; }
        .ol-nav-in { display: flex; align-items: center; justify-content: space-between; min-height: 62px; gap: 12px; flex-wrap: wrap; row-gap: 10px; padding: 10px 0; }
        .ol-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: #1c2520; }
        .ol-brand b { font-size: 17px; font-family: var(--font-display), sans-serif; }
        .ol-brand i { font-style: normal; font-weight: 500; color: #5c6660; }
        .ol-links { display: none; gap: 24px; align-items: center; }
        .ol-links a { color: #5c6660; text-decoration: none; font-size: 14px; font-weight: 600; }
        .ol-links a:hover { color: #1c2520; }
        .ol-cta { display: inline-flex; align-items: center; justify-content: center; background: #206e4e; color: #fff; border-radius: 999px; text-decoration: none; font-weight: 700; font-size: 14px; padding: 10px 20px; border: 1px solid #206e4e; white-space: nowrap; }
        .ol-cta:hover { background: #185a40; }
        .ol-cta.ghost { background: transparent; color: #1c2520; border-color: #d8d2c6; }
        .ol-cta.ghost:hover { background: #f1efe8; }

        .ol-hero { padding: 44px 0 34px; }
        .ol-hero-in { display: grid; grid-template-columns: 1fr; gap: 34px; align-items: center; }
        .ol-kicker { display: inline-block; background: #e7f2ea; color: #185a40; font-weight: 700; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; border-radius: 999px; padding: 5px 13px; }
        .ol-h1 { font-size: clamp(30px, 5.2vw, 46px); line-height: 1.14; font-weight: 800; margin: 14px 0; letter-spacing: -.01em; }

        /* inline-grid with every word in the SAME cell: the words stack without
           absolute positioning, so the rotator is a real box as wide as its
           widest word and wraps like any other word instead of spilling out. */
        .hero-rotator { display: inline-grid; vertical-align: bottom; }
        .hero-word { grid-area: 1 / 1; white-space: nowrap; color: #206e4e; opacity: 0; animation: heroCycle 12s infinite; }
        .hero-word.w1 { animation-delay: 0s; }
        .hero-word.w2 { animation-delay: 3s; }
        .hero-word.w3 { animation-delay: 6s; }
        .hero-word.w4 { animation-delay: 9s; }
        @keyframes heroCycle { 0% { opacity: 0; } 3% { opacity: 1; } 22% { opacity: 1; } 25% { opacity: 0; } 100% { opacity: 0; } }
        .ol-cursor { display: inline-block; width: 3px; height: .85em; background: #206e4e; margin-left: 3px; vertical-align: -.1em; animation: olBlink 1s steps(1) infinite; }
        @keyframes olBlink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
        .ol-sub { color: #5c6660; font-size: clamp(14.5px, 2.2vw, 16.5px); line-height: 1.65; max-width: 490px; margin: 0 0 22px; }
        .ol-hero-ctas { display: flex; gap: 12px; flex-wrap: wrap; }
        .ol-hero-note { margin-top: 14px; font-size: 12.5px; color: #9aa39d; }

        /* ---- phone mock ---- */
        .ol-phone-wrap { display: flex; justify-content: center; }
        .ol-phone { width: min(88vw, 300px); border: 9px solid #1c2520; border-radius: 34px; background: #1c2520; position: relative; box-shadow: 0 26px 54px rgba(28,37,32,.24); }
        .ol-phone-notch { position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 112px; height: 20px; background: #1c2520; border-radius: 0 0 12px 12px; z-index: 2; }
        .ol-phone-screen { background: #f1efe8; border-radius: 25px; padding: 32px 12px 14px; }
        .ol-pm-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .ol-pm-brand { font-size: 9px; font-weight: 800; letter-spacing: .06em; color: #5c6660; }
        .ol-pm-pill { background: #e7f2ea; color: #185a40; font-size: 9.5px; font-weight: 700; border-radius: 999px; padding: 3px 9px; }
        .ol-pm-body { position: relative; height: 440px; }
        .ol-pm-screen { position: absolute; inset: 0; opacity: 0; animation: pmCycle 15s infinite; }
        .ol-pm-screen.p1 { animation-delay: 0s; }
        .ol-pm-screen.p2 { animation-delay: 5s; }
        .ol-pm-screen.p3 { animation-delay: 10s; }
        @keyframes pmCycle { 0% { opacity: 0; } 3% { opacity: 1; } 30% { opacity: 1; } 33.3% { opacity: 0; } 100% { opacity: 0; } }
        .ol-pm-loc { font-size: 10.5px; color: #9aa39d; margin-bottom: 9px; }
        .ol-pm-card { background: #fff; border: 1px solid #e6e1d8; border-radius: 14px; padding: 12px 13px; margin-bottom: 11px; box-shadow: 0 2px 6px rgba(28,37,32,.04); }
        .ol-pm-card.ol-pm-urgent { border-color: #e8c9a0; background: #fffdf7; }
        .ol-pm-card-head { font-size: 11.5px; font-weight: 800; margin-bottom: 8px; }
        .ol-pm-big { font-family: var(--font-display), sans-serif; font-size: 34px; font-weight: 800; line-height: 1; letter-spacing: -.02em; }
        .ol-pm-sub { font-size: 10px; color: #9aa39d; margin-top: 3px; }
        .ol-pm-varrow { display: flex; gap: 6px; margin-top: 10px; }
        .ol-pm-var { flex: 1; background: #f7f6f2; border: 1px solid #ece8e0; border-radius: 9px; padding: 6px 4px; text-align: center; }
        .ol-pm-var b { display: block; font-size: 15px; font-weight: 800; }
        .ol-pm-var span { font-size: 8.5px; color: #9aa39d; }
        .ol-pm-bars { display: flex; gap: 8px; align-items: flex-end; height: 60px; margin: 6px 0 10px; }
        .ol-pm-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
        .ol-pm-bar-fill2 { width: 100%; border-radius: 5px; background: #206e4e; }
        .ol-pm-bar-col span { font-size: 8px; color: #9aa39d; }
        .ol-pm-chip-dark { background: #1c2520; color: #fff; font-size: 10.5px; font-weight: 700; border-radius: 8px; padding: 9px 10px; text-align: center; }
        .ol-pm-badge { font-size: 9px; font-weight: 700; border-radius: 999px; padding: 3px 9px; flex-shrink: 0; }
        .ol-pm-badge.green { background: #e7f2ea; color: #185a40; }
        .ol-pm-badge.amber { background: #faf0dc; color: #8a6218; }
        .ol-pm-badge.red { background: #f7e6e2; color: #ae3b32; }
        .ol-pm-reqhead { display: flex; justify-content: space-between; align-items: center; margin-bottom: 7px; }
        .ol-pm-ago { font-size: 9px; color: #9aa39d; }
        .ol-pm-item-name { font-size: 12px; font-weight: 700; }
        .ol-pm-item-sub { font-size: 9.5px; color: #9aa39d; margin-top: 1px; }
        .ol-pm-delta { font-family: var(--font-display), sans-serif; font-size: 19px; font-weight: 800; color: #185a40; margin-top: 8px; }
        .ol-pm-delta.down { color: #ae3b32; }
        .ol-pm-delta span { font-family: var(--font-body), sans-serif; font-size: 9.5px; font-weight: 500; color: #9aa39d; margin-left: 5px; }
        .ol-pm-btnrow { display: flex; gap: 6px; margin-top: 10px; }
        .ol-pm-btn { flex: 1; text-align: center; font-size: 10px; font-weight: 700; border: 1px solid #d8d2c6; border-radius: 7px; padding: 7px 0; }
        .ol-pm-btn.primary { background: #206e4e; border-color: #206e4e; color: #fff; }
        .ol-pm-meal { display: flex; justify-content: space-between; align-items: center; gap: 8px; border: 1.5px solid #ece8e0; border-radius: 10px; padding: 9px 10px; margin-bottom: 7px; }
        .ol-pm-meal.on { border-color: #206e4e; background: #e7f2ea; }
        .ol-pm-meal b { font-size: 11.5px; display: block; }
        .ol-pm-meal i { font-style: normal; font-size: 9px; color: #9aa39d; }
        .ol-pm-qty { display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 600; padding: 7px 0; border-bottom: 1px solid #f0ede6; }
        .ol-pm-stepper { display: flex; align-items: center; gap: 8px; }
        .ol-pm-stepper i { font-style: normal; width: 22px; height: 22px; border: 1px solid #d8d2c6; border-radius: 6px; display: grid; place-items: center; font-size: 12px; }
        .ol-pm-stepper b { font-size: 13px; min-width: 18px; text-align: center; }
        .ol-pm-total { display: flex; justify-content: space-between; font-weight: 800; font-size: 12.5px; padding-top: 9px; }
        .ol-pm-foot { text-align: center; font-size: 10px; font-weight: 700; color: #b9c0ba; padding: 8px 0 12px; background: #1c2520; }

        .ol-sec { padding: 36px 0; }
        .ol-sec h2 { font-size: clamp(20px, 3.2vw, 27px); margin: 0 0 6px; text-align: center; }
        .ol-sec .lead { color: #5c6660; font-size: 14.5px; text-align: center; max-width: 620px; margin: 0 auto 24px; line-height: 1.6; }

        .ol-values { display: grid; grid-template-columns: 1fr; gap: 14px; }
        .ol-value { background: #fff; border: 1px solid #e6e1d8; border-radius: 16px; padding: 20px 18px; text-align: center; }
        .ol-badge { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; }
        .ol-badge.basil { background: #e7f2ea; color: #185a40; }
        .ol-badge.turmeric { background: #faf0dc; color: #8a6218; }
        .ol-badge.blue { background: #e9eff5; color: #3e5c76; }
        .ol-badge.brick { background: #f7e6e2; color: #ae3b32; }
        .ol-value h3 { font-size: 15px; margin: 0 0 6px; }
        .ol-value p { margin: 0; color: #5c6660; font-size: 13px; line-height: 1.6; }

        .ol-steps { display: grid; grid-template-columns: 1fr; gap: 14px; }
        .ol-step-card { background: #fff; border: 1px solid #e6e1d8; border-radius: 14px; padding: 18px; display: flex; gap: 14px; align-items: flex-start; }
        .ol-step-num { background: #1c2520; color: #fff; font-weight: 800; font-size: 13px; width: 30px; height: 30px; border-radius: 999px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .ol-step-card h3 { font-size: 14.5px; margin: 0 0 6px; }
        .ol-step-card p { margin: 0; color: #5c6660; font-size: 13px; line-height: 1.6; }

        /* ---- the cutoff table: the product's whole idea in one grid ---- */
        .ol-cut { background: #fff; border: 1px solid #e6e1d8; border-radius: 18px; overflow: hidden; max-width: 900px; margin: 0 auto; }
        .ol-cut-head, .ol-cut-row { display: grid; grid-template-columns: 1fr; }
        .ol-cut-head { display: none; }
        .ol-cut-th { font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; padding: 12px 16px; }
        .ol-cut-th.before { color: #185a40; background: #e7f2ea; }
        .ol-cut-th.after { color: #8a6218; background: #faf0dc; }
        .ol-cut-row { border-top: 1px solid #f0ede6; }
        .ol-cut-row:first-of-type { border-top: 1px solid #e6e1d8; }
        .ol-cut-what { font-weight: 700; font-size: 13.5px; padding: 14px 16px 4px; }
        .ol-cut-cell { font-size: 13px; line-height: 1.55; padding: 6px 16px 10px; color: #5c6660; position: relative; padding-left: 34px; }
        .ol-cut-cell::before { position: absolute; left: 16px; top: 6px; font-weight: 800; font-size: 12px; }
        .ol-cut-cell.before::before { content: "✓"; color: #206e4e; }
        .ol-cut-cell.after::before { content: "!"; color: #b8860b; }
        @media (min-width: 780px) {
          .ol-cut-head { display: grid; }
          .ol-cut-head, .ol-cut-row { grid-template-columns: 1.1fr 1.3fr 1.6fr; }
          .ol-cut-what { padding: 16px; align-self: center; }
          .ol-cut-cell { padding: 16px 16px 16px 36px; }
          .ol-cut-cell::before { top: 16px; left: 18px; }
          .ol-cut-cell.before { background: #fbfdfb; }
          .ol-cut-cell.after { background: #fffdf7; }
        }

        .ol-feature { display: grid; grid-template-columns: 1fr; gap: 28px; align-items: center; }
        .ol-feature-copy h2 { text-align: left; font-size: clamp(21px, 3.4vw, 28px); margin: 0 0 12px; }
        .ol-feature-copy p { color: #5c6660; font-size: 14.5px; line-height: 1.75; max-width: 460px; margin: 0 0 20px; }

        .ol-wwd { display: grid; grid-template-columns: 1fr; gap: 30px; align-items: start; }
        .ol-wwd-copy h2 { text-align: left; font-size: clamp(22px, 3.6vw, 30px); margin: 0 0 10px; }
        .ol-wwd-copy p { color: #5c6660; font-size: 14.5px; line-height: 1.7; max-width: 400px; margin: 0 0 20px; }
        .ol-services { display: grid; grid-template-columns: 1fr; gap: 12px; }
        .ol-service { background: #fff; border: 1px solid #e6e1d8; border-radius: 14px; padding: 16px; display: flex; gap: 12px; align-items: flex-start; }
        .ol-service .ol-badge { margin: 0; flex-shrink: 0; }
        .ol-service h3 { font-size: 14.5px; margin: 0 0 5px; }
        .ol-service p { margin: 0; color: #5c6660; font-size: 13px; line-height: 1.55; }

        /* ---- device preview ---- */
        .ol-device-row { display: flex; justify-content: center; align-items: flex-start; gap: 34px; flex-wrap: wrap; padding: 14px 0 6px; }
        .ol-browser-frame { width: 460px; max-width: 100%; border: 1px solid #e6e1d8; border-radius: 16px; overflow: hidden; box-shadow: 0 30px 60px rgba(28,37,32,.2); background: #fff; }
        .ol-web-chrome { display: flex; align-items: center; gap: 8px; padding: 12px 14px; background: #f1efe8; border-bottom: 1px solid #e6e1d8; }
        .ol-web-dot { width: 10px; height: 10px; border-radius: 50%; }
        .ol-web-dot.r { background: #e2988c; }
        .ol-web-dot.y { background: #e0b978; }
        .ol-web-dot.g { background: #8ec9a2; }
        .ol-web-url { flex: 1; background: #fff; border: 1px solid #e6e1d8; border-radius: 7px; padding: 6px 12px; font-size: 12px; color: #5c6660; margin-left: 6px; font-family: var(--font-mono), monospace; }
        .ol-phone-frame-sm { width: 260px; max-width: 100%; border: 8px solid #1c2520; border-radius: 30px; background: #1c2520; box-shadow: 0 22px 46px rgba(28,37,32,.22); position: relative; }
        .ol-phone-notch-sm { position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 88px; height: 16px; background: #1c2520; border-radius: 0 0 10px 10px; z-index: 2; }
        .ol-phone-frame-sm .ol-web-body { border-radius: 22px; padding-top: 24px; }
        .ol-web-body { padding: 22px 24px; background: #faf7f2; }
        .ol-web-hero { text-align: center; margin-bottom: 18px; }
        .ol-web-hero-title { font-family: var(--font-display), sans-serif; font-size: 21px; font-weight: 800; }
        .ol-web-hero-sub { font-size: 12px; color: #9aa39d; margin-top: 4px; }
        .ol-web-menu-head { font-size: 10.5px; font-weight: 700; color: #9aa39d; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 10px; }
        .ol-web-menu-grid { display: grid; grid-template-columns: 1fr; gap: 8px; margin-bottom: 16px; }
        .ol-web-menu-grid.wide { grid-template-columns: repeat(2, 1fr); }
        .ol-web-menu-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; background: #fff; border: 1px solid #e6e1d8; border-radius: 9px; padding: 9px 12px; font-size: 12px; font-weight: 600; }
        .ol-web-menu-name i { font-style: normal; display: block; font-size: 9.5px; color: #9aa39d; font-weight: 500; }
        .ol-web-pill { font-size: 9.5px; font-weight: 700; border-radius: 999px; padding: 3px 8px; white-space: nowrap; }
        .ol-web-pill.green { background: #e7f2ea; color: #185a40; }
        .ol-web-pill.amber { background: #faf0dc; color: #8a6218; }
        .ol-web-join { text-align: center; background: #206e4e; color: #fff; font-weight: 700; border-radius: 9px; padding: 12px; font-size: 13px; }
        .ol-web-note { text-align: center; font-size: 10.5px; color: #9aa39d; margin-top: 10px; }

        .ol-faq { display: grid; grid-template-columns: 1fr; gap: 12px; }
        .ol-faq-item { background: #fff; border: 1px solid #e6e1d8; border-radius: 14px; padding: 18px; }
        .ol-faq-item h3 { font-size: 14.5px; margin: 0 0 7px; }
        .ol-faq-item p { margin: 0; color: #5c6660; font-size: 13.5px; line-height: 1.6; }

        .ol-dark { background: #1c2520; color: #f2efe8; border-radius: 18px; padding: 34px 22px; text-align: center; }
        .ol-dark h2 { margin: 0 0 10px; font-size: clamp(20px, 3vw, 26px); }
        .ol-dark p { margin: 0 auto 20px; max-width: 560px; color: #b9c0ba; font-size: 14.5px; line-height: 1.65; }

        .ol-foot { border-top: 1px solid #e6e1d8; padding: 22px 20px; display: flex; flex-direction: column; gap: 8px; align-items: center; color: #9aa39d; font-size: 12.5px; text-align: center; }
        .ol-foot a { color: #5c6660; text-decoration: none; font-weight: 600; }

        @media (prefers-reduced-motion: reduce) {
          .ol-cursor, .hero-word, .ol-pm-screen { animation: none !important; }
          .hero-word.w1 { opacity: 1 !important; }
          .ol-pm-screen.p1 { opacity: 1 !important; }
        }

        @media (min-width: 720px) {
          .ol-values { grid-template-columns: repeat(2, 1fr); }
          .ol-steps { grid-template-columns: repeat(2, 1fr); }
          .ol-services { grid-template-columns: repeat(2, 1fr); }
          .ol-faq { grid-template-columns: repeat(2, 1fr); }
        }
        @media (min-width: 880px) {
          .ol-links { display: flex; }
          .ol-hero-in { grid-template-columns: 1.05fr .95fr; text-align: left; }
          .ol-values { grid-template-columns: repeat(4, 1fr); }
          .ol-steps { grid-template-columns: repeat(4, 1fr); }
          .ol-feature { grid-template-columns: 1fr 1fr; }
          .ol-feature.reverse .ol-feature-copy { order: 2; }
          .ol-wwd { grid-template-columns: .85fr 1.15fr; }
        }
      `}</style>

            <nav className="ol-nav">
                <div className="ol-max ol-nav-in">
                    <Link href="/" className="ol-brand">
                        <Image src="/chefo-mark.png" alt="Chefo" width={36} height={36} priority />
                        <b>Chefo <i>Booking</i></b>
                    </Link>
                    <div className="ol-links">
                        <a href="#how-it-works">How it works</a>
                        <a href="#the-cutoff">The cutoff</a>
                        <a href="#what-you-get">What you get</a>
                        <a href="#faq">FAQ</a>
                        <Link href="/auth">Sign in</Link>
                    </div>
                    <Link href="/auth?mode=signup" className="ol-cta">Create your account</Link>
                </div>
            </nav>

            <header className="ol-hero">
                <div className="ol-max ol-hero-in">
                    <div>
                        <span className="ol-kicker">For canteens, caterers &amp; cafeterias in India</span>
                        <h1 className="ol-h1">
                            Cook to{" "}
                            <span className="hero-rotator">
                                <span className="hero-word w1">Exact Counts</span>
                                <span className="hero-word w2">Approved Changes</span>
                                <span className="hero-word w3">Real Bookings</span>
                                <span className="hero-word w4">Zero Guesswork</span>
                            </span>
                            <span className="ol-cursor" />
                        </h1>
                        <p className="ol-sub">
                            Take meal bookings for every service you run. Before your cutoff they confirm
                            themselves. After it, late bookings, changes and cancellations wait in one
                            queue for your decision — so the kitchen never cooks to a number nobody agreed to.
                        </p>
                        <div className="ol-hero-ctas">
                            <Link href="/auth?mode=signup" className="ol-cta">Create your account</Link>
                            <Link href="/auth" className="ol-cta ghost">Sign in</Link>
                        </div>
                        <p className="ol-hero-note">Sign up with your mobile number · no card, no setup fee</p>
                    </div>
                    <div className="ol-phone-wrap">
                        <BookingPhoneMock />
                    </div>
                </div>
            </header>

            <section className="ol-sec reveal">
                <div className="ol-max">
                    <div className="ol-values">
                        {VALUES.map((v, i) => {
                            const tones = ["basil", "turmeric", "blue", "brick"];
                            return (
                                <div key={v.title} className="ol-value">
                                    <div className={`ol-badge ${tones[i % tones.length]}`}><v.Icon /></div>
                                    <h3>{v.title}</h3>
                                    <p>{v.body}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className="ol-sec reveal" id="the-cutoff">
                <div className="ol-max">
                    <h2>The cutoff is <span className="ol-accent">soft</span> — and that&apos;s the point</h2>
                    <p className="lead">
                        A hard deadline just tells a customer &ldquo;no&rdquo; and leaves you on the phone.
                        Here, the deadline decides who confirms a booking — the system, or you.
                    </p>
                    <CutoffTable />
                    <p className="lead" style={{ marginTop: 22, marginBottom: 0 }}>
                        The rule underneath all three: <strong style={{ color: "#1c2520" }}>after the cutoff,
                            nothing silently alters the kitchen&apos;s confirmed requirement.</strong> A late request
                        contributes exactly zero until you accept it.
                    </p>
                </div>
            </section>

            <section className="ol-sec reveal" id="how-it-works">
                <div className="ol-max">
                    <h2>How <span className="ol-accent">it works</span></h2>
                    <p className="lead">From registering to a confirmed plate count, four steps — nothing hidden in between.</p>
                    <div className="ol-steps">
                        {STEPS.map((s) => (
                            <div key={s.n} className="ol-step-card">
                                <span className="ol-step-num">{s.n}</span>
                                <div><h3>{s.title}</h3><p>{s.body}</p></div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="ol-sec reveal">
                <div className="ol-max">
                    <h2>Who <span className="ol-accent">it&apos;s for</span></h2>
                    <p className="lead">Anywhere people book meals ahead — one plate or eighty, once or every day.</p>
                    <div className="ol-values">
                        {AUDIENCE.map((a, i) => {
                            const tones = ["basil", "turmeric", "blue", "brick"];
                            return (
                                <div key={a.title} className="ol-value">
                                    <div className={`ol-badge ${tones[i % tones.length]}`}><a.Icon /></div>
                                    <h3>{a.title}</h3>
                                    <p>{a.body}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className="ol-sec reveal" id="what-you-get">
                <div className="ol-max">
                    <div className="ol-wwd">
                        <div className="ol-wwd-copy">
                            <h2>What <span className="ol-accent">you get</span></h2>
                            <p>
                                Everything needed to take a booking, decide on the late ones, and hand the
                                kitchen a number it can cook to — in one dashboard, with nothing hardcoded
                                to somebody else&apos;s menu.
                            </p>
                            <Link href="/auth?mode=signup" className="ol-cta">Create your account</Link>
                        </div>
                        <div className="ol-services">
                            {SERVICES.map((s, i) => {
                                const tones = ["basil", "turmeric", "blue", "brick"];
                                return (
                                    <div key={s.title} className="ol-service">
                                        <div className={`ol-badge ${tones[i % tones.length]}`}><s.Icon /></div>
                                        <div><h3>{s.title}</h3><p>{s.body}</p></div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </section>

            <section className="ol-sec reveal">
                <div className="ol-max">
                    <h2>Your booking page — <span className="ol-accent">on any device</span></h2>
                    <p className="lead">
                        A link you hand out or print as a code. It shows the meals you&apos;re taking today and
                        says, before anything is filled in, whether a booking will confirm or need your approval.
                    </p>
                    <div className="ol-device-row">
                        <div className="ol-browser-frame">
                            <div className="ol-web-chrome">
                                <span className="ol-web-dot r" /><span className="ol-web-dot y" /><span className="ol-web-dot g" />
                                <div className="ol-web-url">{BRAND.domain}/b/sunrise-kitchen</div>
                            </div>
                            <BookingPagePreview wide />
                        </div>
                        <div className="ol-phone-frame-sm">
                            <div className="ol-phone-notch-sm" />
                            <BookingPagePreview />
                        </div>
                    </div>
                </div>
            </section>

            <section className="ol-sec reveal">
                <div className="ol-max">
                    <h2>Built on <span className="ol-accent">trust &amp; security</span></h2>
                    <p className="lead">The parts you don&apos;t see, working the same way every time.</p>
                    <div className="ol-values">
                        {TRUST.map((t, i) => {
                            const tones = ["basil", "turmeric", "blue", "brick"];
                            return (
                                <div key={t.title} className="ol-value">
                                    <div className={`ol-badge ${tones[i % tones.length]}`}><t.Icon /></div>
                                    <h3>{t.title}</h3>
                                    <p>{t.body}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className="ol-sec reveal" id="faq">
                <div className="ol-max">
                    <h2>Questions, <span className="ol-accent">answered</span></h2>
                    <p className="lead">The practical things operators ask before signing up.</p>
                    <div className="ol-faq">
                        {FAQS.map((f) => (
                            <div key={f.q} className="ol-faq-item">
                                <h3>{f.q}</h3>
                                <p>{f.a}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="ol-sec reveal">
                <div className="ol-max">
                    <div className="ol-dark">
                        <h2>Start taking bookings today</h2>
                        <p>
                            Verify your mobile, name your business, add your meal services — and share your
                            booking link. There&apos;s nothing to install and nothing to pay upfront.
                        </p>
                        <Link href="/auth?mode=signup" className="ol-cta">Create your account</Link>
                    </div>
                </div>
            </section>

            <footer className="ol-foot">
                <span>© {new Date().getFullYear()} Chefo · {BRAND.productName}</span>
                <span>
                    <Link href="/auth" style={{ marginRight: 16 }}>Sign in</Link>
                    <Link href="/auth?mode=signup">Create an account</Link>
                </span>
            </footer>

            <ScrollReveal />
            {/* Safety net: if JS is blocked entirely, never leave the page blank. */}
            <noscript>
                <style>{`.reveal, .reveal .ol-value, .reveal .ol-step-card, .reveal .ol-service, .reveal .ol-faq-item { opacity: 1 !important; transform: none !important; }`}</style>
            </noscript>
        </div>
    );
}
