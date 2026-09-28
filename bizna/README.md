# Bizna — SME Business Manager (MVP)

"Bizna" is Sheng (Kenyan urban slang) for "business" — casual and immediately
recognizable to the shop owners this is built for.

A single-business Sales / Inventory / Expenses / Customers / Dashboard system,
built as step 1 of the "generic system, adapt per business" plan.

## Naming — what got renamed and what didn't
- Project folder, `package.json` name, page title, and the SQLite database
  file are all `bizna` now.
- Framework entry points (`server.js`, `db.js`, `routes/*.js`) keep their
  conventional names on purpose — any Node developer (including future you)
  recognizes `server.js` as the entry point instantly. Renaming those to
  `biznaServer.js` etc. would fight the convention for no real benefit.

## Stack
- Backend: Node.js + Express
- Database: SQLite (via `better-sqlite3`, parameterized queries throughout)
- Frontend: plain HTML/CSS/JS (no build step — just static files)
- Auth: single owner account, bcrypt-hashed password, bearer token

## Setup (test this locally)

```bash
cd bizna
npm install
cp .env.example .env
```

Open `.env` and set `OWNER_USERNAME` and `OWNER_PASSWORD` to something real
(not the placeholder) before starting the server — the app will not create
a login unless a password is set.

```bash
npm start
```

Visit `http://localhost:3000`, log in with the credentials from `.env`.
A `bizna.db` SQLite file is created automatically on first run — nothing
else to configure.

## What's implemented
- Products: add, edit, delete, stock tracking, colour-coded low-stock badges
- Sales: multi-item sale, auto-decrements stock, pill-style payment method
  picker (cash/M-Pesa/card/credit), atomic transaction (a sale either fully
  succeeds or fully rolls back — no half-recorded sales)
- Customers: track who owes what, record payments against their balance
- Expenses: category + amount + description
- Dashboard: today's sales, total sales, total expenses, profit, outstanding
  customer credit, low-stock alerts, and a 7-day sales sparkline

## UI / interaction details
- Toast notifications on every action (sale recorded, product added, etc.)
  instead of silent updates
- Custom confirm/payment-amount modals — no jarring native browser popups
- Buttons show an inline spinner and disable themselves mid-request, so a
  slow connection never invites a double-tap and a duplicate sale
- Dashboard numbers count up on load rather than snapping into place
- Skeleton loading placeholders instead of a blank flash
- Respects `prefers-reduced-motion` and `prefers-color-scheme` (dark mode)
- Kenyan market-stall palette (ink-navy + marigold) instead of a generic
  SaaS-card look, with money set in monospace for a ledger feel

## Security measures already in place
- Every SQL query is parameterized (no string-built SQL, no injection risk)
- Passwords hashed with bcrypt, never stored or logged in plaintext
- All API routes except `/api/auth/login` require a bearer token
- Login attempts rate-limited (10 per 15 min) to slow brute force
- General API rate limit (120 req/min) as a backstop
- `helmet` sets standard security headers
- Request body size capped at 100kb
- Input validated server-side on every write endpoint (`express-validator`) —
  the frontend validation is a convenience, not the real defense
- `.env` (secrets) and the SQLite file are git-ignored by default
- Generic error responses to the client; full errors only go to the server console

## Known limitations (intentional, for MVP scope)
- Single user account only — no employee roles yet.
- Auth tokens are stored in memory — restarting the server logs everyone out.
  Fine for local testing; swap for a persistent session store before real use.
- No HTTPS locally — put this behind HTTPS (Render/Railway provide it
  automatically) before anyone uses it over the internet.
- No cost-price field yet, so "profit" is revenue minus expenses, not true
  gross margin.
- M-Pesa "payment method" is just a label right now — it doesn't call the
  Daraja API yet.

## Suggested next steps (in order)
1. Test every flow locally against the checklist below.
2. Add `cost_price` to products for real profit-margin math.
3. Move from a single owner account to real multi-user roles (owner/employee).
4. Deploy (Render or Railway for the backend + DB, same origin serves the
   static frontend — no separate hosting needed for this MVP).
5. Integrate M-Pesa Daraja API for real payment confirmation.
6. Only after all of the above is solid: generalize the schema to adapt
   to different business types (salon vs. hardware shop vs. wholesaler).

## Manual test checklist
- [ ] Can't reach any `/api/*` route without logging in first (should get 401)
- [ ] Add 2–3 products with different stock levels — watch the badge colour
      change when stock drops to/below the low-stock threshold
- [ ] Record a sale using more than one product, confirm stock decreases
- [ ] Try to sell more of a product than is in stock — should be rejected
      with a toast, and stock should not change (transaction rollback)
- [ ] Add a customer, make a sale on credit for them, confirm their balance
      shows on the Customers tab, then record a payment via the modal and
      confirm it drops
- [ ] Add an expense, confirm profit on the dashboard updates and the
      sparkline reflects today's sales
- [ ] Log out, confirm you're returned to the login screen and API calls
      now fail with 401
