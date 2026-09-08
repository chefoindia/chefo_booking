# Chefo Booking

Meal-service booking and daily operations for food providers — canteens,
caterers, corporate cafeterias, college canteens, project-site kitchens, guest
houses.

**This is a standalone product.** It shares no code with the Chefo
Subscription or Cafeteria applications, has its own database, its own session
secret, and its own repository. Nothing here imports from, or is imported by,
`Chefo Project`.

---

## The problem it solves

> A food provider needs to know how many meals to prepare for each meal service,
> while still letting customers send late requests the operator can approve or
> reject.

```
Booking  →  Cutoff  →  Approval (if late)  →  Confirmed quantity  →  Preparation
```

### The cutoff is soft, and that is the whole point

This is the one place Chefo Booking deliberately differs from the existing
Subscription/Cafeteria products, where a cutoff is a hard wall the customer
simply cannot act past.

| | Before cutoff | After cutoff |
|---|---|---|
| **New booking** | Confirmed instantly, counts immediately | `Pending approval` + a request in the operator's queue |
| **Change** | Applied directly | Change **request**; the booking is untouched until decided |
| **Cancellation** | Applied directly | Cancellation **request**; the booking stays confirmed and still counts |

The rule this enforces everywhere: **after the cutoff, nothing silently alters
the kitchen's confirmed requirement.** A late request contributes exactly zero
until an operator accepts it.

---

## Layout

```
Chefo Booking/
├── booking-backend/     Express + MongoDB API           :40005
├── booking-business/    Operator dashboard (Next.js)    :4001
└── booking-customer/    Customer booking (Next.js)      :4003
```

`booking-customer` is a **separable layer**. It talks only to `/api/public/*`,
knows nothing about operator concepts, and addresses a business by public slug.
When Chefo builds one common customer platform across its products, this is the
piece it replaces — nothing else has to move.

---

## Running it

```bash
cd booking-backend  && npm install && cp .env.example .env   # fill in MONGODB_URI, JWT_SECRET
npm run seed        # creates a demo business, meal services, variants and an owner
npm run dev         # :40005

cd ../booking-business  && npm install && npm run dev -- -p 4001
cd ../booking-customer  && npm install && npm run dev -- -p 4003
```

Then:

- Operator dashboard — <http://localhost:4001> (seeded owner: `owner@demo.test` / `booking123`)
- Customer booking page — <http://localhost:4003/b/demo-canteen>

```bash
cd booking-backend && npm test    # acceptance scenarios A–J, end to end
```

---

## Domain model

| Model | What it is |
|---|---|
| `Business` | One food provider. The tenant boundary — everything else carries `businessId`. |
| `MealType` | A meal **service**: Breakfast, Lunch, Snacks, "Night shift meal". Holds its own cutoff. Not an enum. |
| `MealVariant` | What a quantity splits across: Veg, Non-Veg, Jain, Thali A. Configurable, not hardcoded. |
| `BookingParty` | Who books. Persistent, keyed by phone. **Recognition, not authentication.** |
| `Booking` | One submission: one party, one date, one meal, a quantity per variant. |
| `BookingRequest` | Something awaiting a decision: `new_booking`, `change`, or `cancellation`. |
| `BusinessUser` / `Role` | Dashboard sign-in and permission-based access. |
| `AuditLog` | Who changed what, with before and after quantities. |

A group booking of 80 meals is **one** `Booking` with lines, not 80 records.
A second submission for the same meal is a **separate** booking, never an edit.

### Three states kept structurally apart

Collapsing these into one column is the mistake the schema exists to avoid.

- **Booking status** — `confirmed` · `pending_approval` · `rejected` · `cancelled`
- **Request status** — `pending` · `accepted` · `rejected` · `withdrawn`
- **Cutoff state** — computed from the meal type at read time, never stored

---

## Where the rules live

- `utils/time.js` — cutoff arithmetic. A cutoff resolves to a real UTC instant in
  the business's timezone; nothing downstream parses a clock string.
- `services/bookingService.js` — every create / change / cancel / resolve. Routes
  call in here; they never re-implement the cutoff decision.
- `services/quantity.js` — **the** preparation count. Only `confirmed` bookings,
  aggregated per variant. Every screen reads this one function, so two views can
  never disagree about what the kitchen is cooking.

---

## Branding and domain

The product is "Booking" at `booking.chefo.in` today, and neither is hardcoded.
`booking-backend/config/brand.js` and each frontend's `lib/brand.js` read from
the environment, so a rename or a domain move is a config change.

---

## Deliberately not in V1

Analytics, feedback, inventory, forecasting, recipes, POS, loyalty, customer
accounts, mandatory OTP, SMS/WhatsApp notifications, capacity limits, and
recurring bookings.

The data model is shaped so these can be added without rewriting the booking
core — prices and payment status already exist on the schema, unused.

---

## Known V1 tradeoffs

- **Phone numbers are not verified.** Anyone can type a number that is not
  theirs and their booking is attributed to that party. Accepted deliberately in
  exchange for a booking form that takes thirty seconds; rate limiting is the
  only current mitigation. OTP slots in at the submission boundary without
  touching the model.
- **Customers are not notified.** There is no SMS or push. A customer learns the
  outcome by returning to the status page and entering their number. The
  operator's rejection note is shown there.
- **A pending request never expires.** It waits until an operator acts. If a
  meal is served with a request still open, it simply stays in the queue.
