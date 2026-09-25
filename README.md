# Chefo Booking

Meal-service booking and daily kitchen operations for food providers: canteens,
caterers, corporate cafeterias, college messes, project-site kitchens and guest
houses.

Customers book meals for a date and service (Breakfast, Lunch, ...) from a public
page. Operators see exactly how many of each variant (Veg, Non-Veg, Jain, ...)
to prepare, scan QR tickets at the counter, manage outlets, team, menus and
reports.

**This is a standalone product.** It shares no code with the Chefo Subscription
or Cafeteria applications. It has its own database, its own session secret and
its own repository.

---

## Contents

- [The problem it solves](#the-problem-it-solves)
- [Repository layout](#repository-layout)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Domain model](#domain-model)
- [Core rules](#core-rules)
- [Backend API](#backend-api)
- [Operator dashboard (booking-business)](#operator-dashboard-booking-business)
- [Customer app (booking-customer)](#customer-app-booking-customer)
- [Permissions and roles](#permissions-and-roles)
- [Outlets](#outlets)
- [Scripts](#scripts)
- [Testing](#testing)
- [Security notes](#security-notes)
- [Deliberately not in V1](#deliberately-not-in-v1)
- [Known tradeoffs](#known-tradeoffs)

---

## The problem it solves

> A food provider needs to know, with certainty, how many meals to prepare for
> each meal service, while giving customers a booking form that takes thirty
> seconds.

```
Customer books  →  Cutoff passes  →  Confirmed quantity is frozen  →  Kitchen prepares  →  Counter scans ticket and serves
```

### The cutoff is a wall for customers

Each meal service has its own cutoff time (optionally on the previous day).

| Action | Before cutoff | After cutoff |
|---|---|---|
| **Customer: new booking** | Confirmed instantly, counts immediately | Refused with `CUTOFF_PASSED`. "Ask the counter directly." |
| **Customer: change** | Applied directly (if the business allows online edits) | Refused. The booking is final. |
| **Customer: cancellation** | Applied directly | Refused. The booking stays confirmed and still counts. |
| **Operator (counter / dashboard)** | Applies directly | Applies directly. The cutoff never applies to an operator, because the person entering it *is* the decision. |

The rule this enforces everywhere: **after the cutoff, nothing a customer does
can silently alter the kitchen's confirmed requirement.** If the kitchen can
still fit a late diner in, the counter enters it.

A pending-approval request queue (`BookingRequest`) still exists in the schema
and API for legacy data and for future use, but customers no longer create
requests. Late customers are told to contact the counter.

---

## Repository layout

```
chefo_booking/
├── booking-backend/      Express + MongoDB REST API                 port 40005
├── booking-business/     Operator dashboard (Next.js 15, React 19)  port 4001
├── booking-customer/     Customer booking site (Next.js 15)         port 4003
└── chefo-booking.code-workspace
```

`booking-customer` is a **separable layer**. It talks only to `/api/public/*`,
knows nothing about operator concepts, and addresses a business by public slug.
When Chefo builds one common customer platform across its products, this is the
piece that gets replaced. Nothing else has to move.

### Backend structure

```
booking-backend/
├── server.js              Thin bootstrap: middleware, rate limits, route mounting
├── config/
│   ├── brand.js           Product name / domain from env
│   ├── cors.js            ALLOWED_ORIGINS handling
│   ├── db.js              Mongoose connection
│   ├── env.js             Startup validation of required env vars
│   └── firebaseAdmin.js   Firebase Admin init (phone-OTP verification)
├── middleware/
│   ├── authenticate.js    Operator JWT cookie session + permission checks
│   ├── customerAuth.js    Optional verified customer session
│   ├── errors.js          404 + central error handler (DomainError → HTTP)
│   └── rateLimiters.js    Global, auth, register, reset and OTP limiters
├── models/                Mongoose schemas (see Domain model)
├── routes/                One file per API area
├── services/
│   ├── bookingService.js  Every create / change / cancel / resolve. THE domain.
│   ├── quantity.js        The preparation count. Single source of truth.
│   ├── consumption.js     "Served at the counter" state rules
│   ├── audit.js           Fire-and-forget audit log writes
│   ├── notify.js          Owner email notices for sensitive events
│   ├── mailer.js          Brevo transactional email (attachments, lists)
│   ├── dailyReport.js     The daily booking report: numbers, email, PDF
│   └── reportScheduler.js Sends each business its report once a day
├── utils/
│   ├── time.js            Cutoff arithmetic in the business's timezone
│   ├── outletScope.js     Per-user outlet scoping for every operator read
│   ├── permissions.js     Permission catalogue and grant rules
│   ├── ticket.js          128-bit unguessable QR ticket tokens
│   ├── phone.js           Phone normalisation
│   └── csv.js             CSV export helpers
├── scripts/
│   ├── seed.js            Demo business, services, variants, owner
│   └── migrate-outlets.js Bring an existing database onto outlets
└── tests/run.js           End-to-end acceptance scenarios over real HTTP
```

---

## Tech stack

| Layer | Technology |
|---|---|
| API | Node.js 18+, Express 4, Mongoose 8 (MongoDB Atlas) |
| Auth (operators) | Email + password (bcrypt) or Firebase phone OTP, JWT in an httpOnly cookie |
| Auth (customers) | Optional Firebase phone OTP, year-long cookie session |
| Security | helmet, cors, express-rate-limit, express-mongo-sanitize |
| Email | Brevo (password-reset codes, owner notifications, the daily booking report) |
| QR | `qrcode` for generation, `html5-qrcode` for in-browser scanning |
| Exports | CSV from the API, PDF via `jspdf` + `jspdf-autotable` in the dashboard, daily report PDF via `pdfkit` on the server |
| Frontends | Next.js 15 (App Router), React 19, plain CSS |

---

## Getting started

### Prerequisites

- Node.js 18 or newer
- A MongoDB connection string (Atlas or local)
- Optional: a Firebase project (phone OTP) and a Brevo API key (email)

### 1. Backend

```bash
cd booking-backend
npm install
cp .env.example .env      # fill in MONGODB_URI and JWT_SECRET at minimum
npm run seed              # demo business, meal services, variants, owner
npm run dev               # http://localhost:40005
```

### 2. Operator dashboard

```bash
cd booking-business
npm install
cp .env.example .env.local
npm run dev -- -p 4001    # http://localhost:4001
```

### 3. Customer app

```bash
cd booking-customer
npm install
cp .env.example .env.local
npm run dev -- -p 4003    # http://localhost:4003
```

### 4. Sign in

| Surface | URL | Credentials |
|---|---|---|
| Operator dashboard | http://localhost:4001 | `owner@demo.test` / `booking123` (from seed) |
| Customer booking page | http://localhost:4003/b/demo-canteen | No login needed |
| API health | http://localhost:40005/api/health | |

Seed values are configurable through the `SEED_*` variables in the backend `.env`.

---

## Environment variables

### booking-backend/.env

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | Yes | Connection string. Use a dedicated `chefo-booking` database. |
| `JWT_SECRET` | Yes | 24+ characters. This product mints its own sessions. |
| `PORT` | | API port, default `40005`. |
| `NODE_ENV` | | `development` or `production`. |
| `ALLOWED_ORIGINS` | Yes | Comma-separated browser origins allowed with credentials. |
| `BRAND_PRODUCT_NAME`, `BRAND_SHORT_NAME`, `BRAND_DOMAIN` | | Branding, read by `config/brand.js`. |
| `CUSTOMER_APP_URL` | | Used to build QR poster and ticket links. |
| `BREVO_API_KEY`, `MAIL_FROM` | For email | Password-reset codes, owner notifications and the daily booking report. |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | For OTP | Base64 of the service-account JSON. Verifies phone-OTP id tokens. |
| `SEED_BUSINESS_NAME`, `SEED_BUSINESS_SLUG`, `SEED_OWNER_*`, `SEED_OUTLETS` | | Defaults for `npm run seed`. |

### booking-business/.env.local and booking-customer/.env.local

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend base URL, e.g. `http://localhost:40005`. |
| `NEXT_PUBLIC_CUSTOMER_URL` | Customer app base URL, used for links and posters. |
| `NEXT_PUBLIC_BRAND_PRODUCT_NAME`, `NEXT_PUBLIC_BRAND_SHORT_NAME`, `NEXT_PUBLIC_BRAND_DOMAIN`, `NEXT_PUBLIC_BRAND_COMPANY` | Branding, mirrors the backend. |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase Web SDK for phone OTP. Public by design. |
| `NEXT_PUBLIC_DEFAULT_BUSINESS` | Customer app only. Sends the bare domain straight to one business's page. |

---

## Domain model

| Model | What it is |
|---|---|
| `Business` | One food provider. The tenant boundary. Everything else carries `businessId`. Holds slug, timezone, booking rules, custom booking fields, party types, QR poster settings, `acceptingBookings` flag and the reference counter. |
| `Outlet` | A serving point of one business: Main Cafeteria, Block A, Guest House. A dimension on the booking, not a second tenant. Optional. |
| `MealType` | A meal **service**: Breakfast, Lunch, Snacks, "Night shift meal". Holds its own cutoff time, `cutoffPreviousDay`, `active` and `customerBookable` flags. Not an enum. |
| `MealVariant` | What a quantity splits across: Veg, Non-Veg, Jain, Thali A. Configurable, carries a price. |
| `BookingParty` | Who books. Persistent, keyed by phone per business. **Recognition, not authentication.** Has a party type (individual, department, site, ...). |
| `Booking` | One submission: one party, one date, one meal service, one outlet, a quantity per variant (lines with snapshotted names and prices), a sequential reference like `BK-1041`, an unguessable ticket, and consumption fields. |
| `BookingRequest` | Something awaiting an operator decision: `new_booking`, `change` or `cancellation`. Retained for legacy data. |
| `BusinessUser` | Dashboard sign-in. Has a role, optional `outletIds` restriction, notification preferences. |
| `Role` | A named bag of permission strings the owner assembles. |
| `WeeklyMenu` | What is served, per meal service, per weekday, split by variant. Shown on the customer page. |
| `AuditLog` | Who changed what, with before and after values. |
| `PasswordReset` | Short-lived email reset codes. |

A group booking of 80 meals is **one** `Booking` with lines, not 80 records.
A second submission for the same meal is a **separate** booking, never an edit.

### Three states kept structurally apart

Collapsing these into one column is the mistake the schema exists to avoid.

- **Booking status**: `confirmed` · `pending_approval` · `rejected` · `cancelled`. Answers "does this count toward what the kitchen cooks?"
- **Consumption**: separate fields on the booking. Answers "did this person collect it?" Marking a booking served never changes the preparation count.
- **Cutoff state**: computed from the meal type at read time in the business's timezone. Never stored.

---

## Core rules

Where the rules live, and why routes never re-implement them:

- **`utils/time.js`**: cutoff arithmetic. A cutoff resolves to a real UTC instant in the business's timezone. Nothing downstream parses a clock string.
- **`services/bookingService.js`**: every create, change, cancel and request resolution. Both the public form and the operator dashboard call in here. The cutoff decision is made in exactly one place.
- **`services/quantity.js`**: **the** preparation count. Only `confirmed` bookings, aggregated per variant. Dashboard, reports and kitchen sheets all read this one function, so two screens can never disagree about what the kitchen is cooking.
- **`services/consumption.js`**: the only place that decides whether a booking can be marked served or un-served. The QR scanner and the manual button both go through it.
- **`utils/outletScope.js`**: every operator read is scoped by the user's own outlet restriction. A requested `outletId` can only narrow it, never widen it.

Nothing trusts a client-supplied `businessId`, price, status or cutoff state.
Prices come from the variant record, the cutoff from the meal type, the business
from the session or the resolved public slug.

---

## Backend API

All operator endpoints require the session cookie and a specific permission.
All `/api/public/*` endpoints are unauthenticated and rate-limited.

### Health

| Method | Path |
|---|---|
| GET | `/api/health` |

### Public: customer surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/public/business/:slug` | Business profile, meal services, variants, booking fields, today's menu |
| GET | `/api/public/business/:slug/calendar` | Bookable dates and cutoff state per service |
| POST | `/api/public/business/:slug/bookings` | Submit a booking |
| POST | `/api/public/business/:slug/bookings/:bookingId/change` | Change quantities (before cutoff only) |
| POST | `/api/public/business/:slug/bookings/:bookingId/cancel` | Cancel (before cutoff only) |
| POST | `/api/public/business/:slug/lookup` | Find bookings by reference + phone |
| POST | `/api/public/business/:slug/tickets` | Resolve a set of tickets held in the browser |
| GET | `/api/public/t/:ticket` | Booking behind a ticket token |
| GET | `/api/public/t/:ticket/qr.png` | QR image for the ticket |
| POST | `/api/public/business/:slug/account/start` | Begin phone-OTP customer sign-in |
| POST | `/api/public/business/:slug/account/verify` | Verify OTP, open a customer session |
| GET | `/api/public/business/:slug/account/me` | Current customer session |
| POST | `/api/public/business/:slug/account/logout` | End customer session |

### Auth (operators)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Email + password |
| POST | `/api/auth/phone/exists` | Check whether a phone has an account |
| POST | `/api/auth/login/start`, `/api/auth/login/verify-otp` | Phone-OTP sign-in |
| POST | `/api/auth/signup/verify-otp`, `/api/auth/signup/business` | Self-serve business registration |
| POST | `/api/auth/forgot-password`, `/api/auth/verify-reset-code`, `/api/auth/reset-password` | Email reset flow |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/me` | Current user, permissions, outlet scope |
| PATCH | `/api/auth/profile` | Name, phone |
| POST | `/api/auth/change-password` | |
| GET / PATCH | `/api/auth/notifications` | Owner email notification preferences |

### Operator: bookings and operations

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/dashboard/today` | Today's preparation counts and workload |
| GET | `/api/bookings` | List with filters (date, service, outlet, status, search) |
| GET | `/api/bookings/:id` | |
| GET | `/api/bookings/by-ticket/:ticket` | Scanner lookup |
| GET | `/api/bookings/by-reference/:reference` | Counter lookup |
| GET | `/api/bookings/service/:mealTypeId/:date` | Everything for one service on one day |
| POST | `/api/bookings` | Create on a customer's behalf (cutoff does not apply) |
| PATCH | `/api/bookings/:id` | Change quantities |
| POST | `/api/bookings/:id/cancel` | |
| POST | `/api/bookings/:id/consume`, `/api/bookings/:id/unconsume` | Mark served / undo |
| GET | `/api/requests` | Pending request queue |
| POST | `/api/requests/:id/:decision` | `accept` or `reject` |
| GET / PATCH | `/api/parties`, `/api/parties/:id` | Booking parties |
| GET | `/api/parties/export.csv` | |

### Operator: configuration

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/config` | Full business configuration |
| PATCH | `/api/config/business` | Name, timezone, rules, accepting bookings |
| POST / PATCH / DELETE | `/api/config/meal-types[/:id]` | Meal services and cutoffs |
| POST / PATCH / DELETE | `/api/config/variants[/:id]` | Variants and prices |
| PUT | `/api/config/party-types` | Who books: individual, department, site... |
| GET / PUT | `/api/config/booking-fields` | Custom questions on the booking form |
| PUT | `/api/config/qr-poster` | Poster text and layout |
| GET / PATCH | `/api/config/daily-report` | Daily report schedule: time, recipients, contents, last delivery |
| POST | `/api/config/daily-report/send` | Send today's report now, or a test to one address (`to`) |
| GET | `/api/config/daily-report/preview`, `/api/config/daily-report/preview.pdf` | The email and the PDF exactly as they will be sent |
| GET / POST / PATCH / DELETE | `/api/outlets[/:id]`, `/api/outlets/manage` | Outlets |
| GET / PUT / DELETE | `/api/menu`, `/api/menu/:mealTypeId/:weekday` | Weekly menu |
| POST | `/api/menu/copy` | Copy a day's menu to other days |

### Operator: team, reports, audit

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/roles/catalogue` | All permissions with labels and hints |
| GET / POST / PATCH | `/api/roles[/:id]` | Roles |
| POST | `/api/roles/:id/archive` | |
| GET / POST / PATCH / DELETE | `/api/team[/:id]` | Business users |
| GET | `/api/reports/day`, `/api/reports/day.csv` | Kitchen sheet for one day |
| GET | `/api/reports/summary` | Range summary by service, variant, outlet |
| GET | `/api/reports/bookings.csv` | Raw booking export |
| POST | `/api/reports/exported` | Records an export in the audit log |
| GET | `/api/audit`, `/api/audit/actors`, `/api/audit/export.csv` | Activity log |

Errors are returned as `{ error, code }`. Domain refusals use stable codes such
as `CUTOFF_PASSED`, `CLOSED`, `MEAL_CLOSED`, `EDIT_OFF`, `REQUEST_OPEN`,
`WRONG_OUTLET`.

---

## Operator dashboard (booking-business)

| Route | Screen |
|---|---|
| `/login` | Email/password or phone-OTP sign-in |
| `/auth` | Self-serve business signup |
| `/dashboard` | Today: preparation counts per service and variant, served vs pending, outlet selector |
| `/dashboard/bookings` | Search, filter, create, change, cancel, mark served |
| `/dashboard/scan` | Camera QR scanner for the counter. Also accepts a typed reference. |
| `/dashboard/parties` | Customer and site contact records |
| `/dashboard/menu` | Weekly menu editor per service and variant |
| `/dashboard/reports` | Kitchen sheets and summaries, PDF and CSV download |
| `/dashboard/qr` | Printable QR poster linking to the customer booking page |
| `/dashboard/team` | Users, roles and permissions, outlet restrictions |
| `/dashboard/logs` | Activity log |
| `/dashboard/settings` | Business details, meal services, variants, rules, booking fields, outlets, daily report email, notifications, profile |

Shared components include `Topbar`, `OutletSelector` (switch the outlet a
canteen-wide user is viewing), `OutletScopeLine` (shows which outlets the
current user is limited to) and `OutletsSection` (settings editor).

---

## Customer app (booking-customer)

| Route | Screen |
|---|---|
| `/` | Landing, or redirect to `NEXT_PUBLIC_DEFAULT_BUSINESS` |
| `/b/[slug]` | Business home: services, cutoffs, today's menu |
| `/b/[slug]/book` | Opens the booking sheet (`BookSheet`): four numbered steps — day (week strip + calendar), meal service, quantities per variant, details (outlet, party, custom questions) — with a running summary in the footer and the pass on confirmation |
| `/b/[slug]/menu` | Weekly menu |
| `/b/[slug]/bookings` | My bookings: tickets held in this browser plus lookup by reference + phone |
| `/b/[slug]/status` | Legacy link, redirects to bookings |
| `/b/[slug]/profile` | Optional phone-verified customer account |
| `/t/[ticket]` | A single booking's ticket with QR (`BookingQr`) |

The app is a single column with a compact top bar (canteen name plus a live
"open today / closes in…" pill), four tabs and a raised **Book** button in the
middle of the bottom bar that opens the booking sheet over whichever tab is
showing. Every meal is shown with its own colour rail and its deadline in
words, ticking while the screen is open.

Tickets are kept in browser storage through `lib/ledger.js` so a customer sees
their bookings again without signing in. A verified account (Firebase phone
OTP) is optional and adds a year-long session across devices.

---

## Permissions and roles

There is no `if (role === "manager")` anywhere. A role is a named bag of
permission strings, so an operator can invent "Kitchen Lead" without a code
release. Code asks about a permission, never a role name.

| Module | Actions | Notes |
|---|---|---|
| `dashboard` | view | |
| `bookings` | view, create, edit, cancel, consume | `consume` is separate from `edit`. Serving food does not grant the right to rewrite quantities. |
| `scan` | use | The one permission a counter phone needs: scanner, lookup by code, mark served. Nothing else. |
| `parties` | view, edit | Personal data. |
| `menu` | view, edit | |
| `reports` | view, export | |
| `config` | view, edit | Owner-level |
| `users` | view, create, edit, delete | Owner-level |
| `roles` | view, create, edit, delete | Owner-level |
| `audit` | view, export | Owner-level |

Owner-level permissions can be used to obtain more permissions, so granting
them is guarded harder. A user can additionally be limited to specific outlets.

---

## Outlets

- A business with no outlets books exactly as before. Once it creates one, every new booking must name an outlet.
- `booking.outletId` is set once at create and never inferred later. `null` means the booking predates outlets. It is counted in canteen-wide totals and shown as "Unassigned (before outlets)".
- Every user has `outletIds`. Empty means canteen-wide. Every operator read is filtered through this scope.
- QR validation resolves the booking from the database, reads its outlet from the row, checks the scanning user's scope and the outlet the counter says it is standing at, and only then serves. Otherwise `WRONG_OUTLET`.

---

## Scripts

```bash
cd booking-backend

npm run seed                              # demo business + owner (idempotent on slug)
node scripts/migrate-outlets.js           # report pre-outlet bookings, ensure indexes, change nothing
node scripts/migrate-outlets.js --assign <businessId> <outletId> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]
                                          # the ONE explicit way to attach pre-outlet bookings to an outlet
```

Nothing assigns pre-outlet bookings automatically.

---

## Testing

```bash
cd booking-backend
npm test
```

`tests/run.js` runs the acceptance scenarios end to end over real HTTP against a
running MongoDB. It creates its own throwaway business, injects time where a
scenario must be before or after a cutoff, and covers booking, cutoff refusal,
operator override, change and cancel, consumption, permission gating, outlet
scoping, wrong-outlet scanning, and the daily report (settings validation,
numbers against the dashboard, email and PDF rendering, send-now versus test,
and the scheduler's claim, retry and give-up behaviour). The mail transport is
stubbed for the run, so no email is ever sent by the suite.

---

## Daily report email

Under **Settings → Daily report by email** the owner picks a delivery time,
up to ten recipients and what to include. Every day at that time (in the
business's own timezone) the day's bookings are emailed as a formal summary,
with the complete booking sheet attached as a PDF.

- **Content.** Meals per service and per option, bookings, what was collected
  at the counter, bookings taken after the cutoff, cancellations (listed, never
  counted), the amount when prices are configured, a per-outlet breakdown, and
  tomorrow's confirmed bookings as an outlook. Every number comes from
  `services/quantity.js`, so the email can never disagree with the dashboard.
- **Rendering.** `services/dailyReport.js` builds the numbers, the HTML/plain
  text email and the PDF (`pdfkit`, A4, letterhead, page numbers).
- **Scheduling.** `services/reportScheduler.js` ticks every minute. A due
  business is claimed with an atomic compare-and-swap on its document before
  anything is sent, so several server processes never send twice. A failed
  send is retried up to three times, ten minutes apart, then left for the
  owner, who sees the error on the settings page and can press "Send now".
- **Send now / test.** "Send today's report now" goes to the configured list
  and counts as today's delivery. A test send goes to one address and does
  not. Both are on the activity log. The settings page can also preview the
  email and download the PDF for any date.

---

## Security notes

- Operator sessions are JWTs in httpOnly cookies signed with this product's own `JWT_SECRET`. A token from another Chefo app is never valid here.
- `helmet`, CORS restricted to `ALLOWED_ORIGINS`, `express-mongo-sanitize`, and body size capped at 512 KB.
- Rate limits: a global limiter, plus tighter limits on login, password change, signup, OTP and reset endpoints.
- QR tickets are 128 random bits in base64url. Possession is the authorisation, so a ticket belongs only on the customer's own slip.
- Booking references are sequential, so public lookup always pairs the reference with the booking phone.
- Sensitive events (team changes, role changes, password changes, exports, service deactivation) email the owner. Each notice can be switched off in Settings.
- Every mutation is written to the audit log with before and after values.

---

## Branding and domain

The product is "Booking" at `booking.chefo.in` today, and neither is hardcoded.
`booking-backend/config/brand.js` and each frontend's `lib/brand.js` read from
the environment, so a rename or a domain move is a config change.

---

## Deliberately not in V1

Analytics, feedback, inventory, forecasting, recipes, POS, loyalty, mandatory
OTP for booking, SMS or WhatsApp notifications, capacity limits, payments and
recurring bookings.

The data model is shaped so these can be added without rewriting the booking
core. Prices and payment status already exist on the schema, unused.

---

## Known tradeoffs

- **Phone numbers are not verified for booking.** Anyone can type a number that is not theirs. Accepted deliberately in exchange for a thirty-second form. Rate limiting is the mitigation. The optional customer account adds verification without touching the booking model.
- **Customers are not notified.** No SMS or push. A customer learns the outcome from their ticket page or the bookings tab.
- **Late customers are simply late.** There is no online path past the cutoff. The counter decides whether to fit them in, and enters it.
