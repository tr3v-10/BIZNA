# Bizna

**Know where every shilling goes.**

Bizna is a business manager for small shops and dukas. It records sales, stock, expenses and customer credit, and adds something most till apps don't: a **live wallet that divides every payment into pots you choose** (restock, rent, savings, your own pay) and follows the money as it moves.

Try the demo without an account: open the app and choose **Look inside with sample data**. Nothing is saved.

---

## The idea: a wallet that divides itself

Most small businesses mix everything into one pocket, so rent money gets spent on stock and nobody can say how much is really "theirs". Bizna fixes that at the moment money arrives.

```
        You set the rules once
   Restock 50%  Rent and bills 20%  Savings 15%  Owner pay 15%

   A customer pays KES 1,500
            |
            v
   Restock +750   Rent and bills +300   Savings +225   Owner pay +225

   You pay KES 200 for transport from Restock
            |
            v
   Restock 550    (the other pots do not change)
```

- **Automatic split.** Sale payments and customer repayments are divided by your percentages, to the cent. The pieces always add up to exactly what came in.
- **Spend from a pot.** Every expense comes out of the pot you pick. If a pot is overspent it shows negative, so you can see where the pressure is.
- **Live metrics.** Wallet balance, money in and out today, balance per pot, a 24 hour in and out chart, days of cash left at your recent spending pace, and a feed of every movement. The screen updates the moment money moves, from any device.
- **You stay in control.** Move money between pots, change the rules any time (they apply to future money only), or leave part of each payment unassigned.

> The wallet is a bookkeeping view of what you record. Bizna does not connect to M-Pesa or a bank and never moves real money.

## Features

| Area | What you get |
| --- | --- |
| Wallet | Auto-split rules, pots, transfers, overspend tracking, live feed, 24 hour flow chart, cash runway |
| Sales | Multi-product baskets, cash / M-Pesa / card / credit, part-payment, live preview of how the sale splits into pots |
| Stock | Per-product alert levels, one-tap restock, low-stock list on the overview |
| Customers | Credit tabs and repayments that flow into the wallet |
| Expenses | Categories, paid-from pot, deletion that returns money to its pot |
| Overview | Sales today, 7 day chart, best sellers, who owes you, sales minus expenses |
| Accounts | Email signup, hashed passwords, sessions that survive restarts, clear Terms and Privacy pages |
| Demo | Full in-browser sample shop, no account and nothing sent to a server |

## Tech stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 18+ |
| Server | Express 4 |
| Database | SQLite through `better-sqlite3` (WAL mode, foreign keys on, transactional writes) |
| Auth | `bcryptjs` password hashing, random bearer tokens stored as SHA-256 hashes |
| Validation and safety | `express-validator`, `helmet` (CSP), `cors`, `express-rate-limit` |
| Real time | Server-Sent Events with a polling safety net |
| Frontend | Vanilla JavaScript ES modules, hand-written CSS, no build step, no framework |
| Fonts | Bricolage Grotesque and Figtree, bundled locally (SIL Open Font License) |
| Tests | Node's built-in test runner, 19 end-to-end API tests |

## Quick start

```bash
git clone https://github.com/<your-username>/bizna.git
cd bizna
npm install
cp .env.example .env      # then edit OPERATOR_NAME and CONTACT_EMAIL
npm start
```

Open the address printed in the terminal (for example `http://localhost:3000`), choose **Create account**, and the wallet comes with four starter pots you can edit.

Use `npm run dev` to restart automatically while developing, and `npm test` to run the test suite.

### Opening it on your phone

The terminal also prints a network address such as `http://192.168.1.20:3000`. Open that on any phone on the same Wi-Fi. Bizna does not force HTTPS upgrades on plain HTTP, so this works as is.

## Configuration

Set these in `.env` (see `.env.example`).

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Port to listen on | `3000` |
| `OPERATOR_NAME` | Who runs this installation. Shown in the Terms and Privacy pages | generic wording |
| `CONTACT_EMAIL` | Contact shown in the Terms and Privacy pages | generic wording |
| `TERMS_EFFECTIVE_DATE` | Date shown on the legal pages | `15 October 2026` |
| `FORCE_HTTPS` | `true` only when served over HTTPS: enables HSTS and upgrade-insecure-requests | `false` |
| `TRUST_PROXY` | Set to `1` behind a reverse proxy so rate limiting sees real IPs | unset |
| `CORS_ORIGIN` | Comma-separated origins, only if the frontend is hosted elsewhere | none (same origin) |
| `BIZNA_DB` | Path of the SQLite file | `./bizna.db` |

## Going live

1. Serve Bizna over **HTTPS** (Render, Railway, Fly.io, or Nginx/Caddy in front of Node), then set `FORCE_HTTPS=true` and `TRUST_PROXY=1`.
2. Put `bizna.db` on persistent storage and **back it up** regularly. It is a single file.
3. Set `OPERATOR_NAME` and `CONTACT_EMAIL`, and have an advocate review the Terms and Privacy pages in `views/` for your business.
4. Forgotten password? There is no recovery email by design. Whoever runs the server can run:

   ```bash
   npm run reset-password -- you@example.com NewPassword123
   ```

## Upgrading an existing installation

Start the new version on your existing `bizna.db`. Tables and columns are upgraded in place. Your past sales, repayments and expenses are mirrored into the wallet once, as **Unallocated** money with their original dates, and four editable starter pots are created. Move money into pots from the Wallet screen. Existing accounts keep logging in with their username.

## Project structure

```
bizna/
  server.js            Express app, security headers, legal pages, startup banner
  db.js                SQLite schema and in-place migrations
  lib/
    wallet.js          The wallet engine: split, debit, transfer, summary, change bus
    http.js            Validation helper and shared error type
  routes/              auth, products, sales, customers, expenses, dashboard, wallet
  views/               Terms and Privacy templates (filled from .env)
  scripts/             reset-password.js
  test/                End-to-end API tests
  public/
    index.html         Landing page, auth screens and the app shell
    css/style.css      Design system
    fonts/             Bundled variable fonts
    js/
      main.js          Router and session handling
      api.js           API client with clear error messages
      wallet.js        Live store, event stream and the Wallet screen
      demo.js          In-browser sample shop
      split.js         The split rule, shared by the form, demo and landing page
      overview.js sell.js stock.js expenses.js customers.js auth.js landing.js
```

## How the wallet works inside

- Every movement is a row in `wallet_events`; each event has one or more signed rows in `wallet_entries` saying which pot gained or lost money. Balances are always **derived by summing entries**, so they can never drift from the history behind them.
- A sale, repayment or expense writes its record and its wallet movement in **one transaction**. If any step fails, nothing changes.
- Percentages are applied in whole cents. The leftover cent goes to the pot with the largest share, and anything not covered by a percentage becomes Unallocated.
- After each committed change the server emits an event. Connected browsers hold a Server-Sent Events stream (read with `fetch`, so it can send the auth header), reconnect with backoff, and also poll slowly as a safety net.
- Closing a pot sweeps its balance into Unallocated, so history stays intact and no money disappears.

## API overview

All routes except `/api/health` and `/api/auth/*` need `Authorization: Bearer <token>`.

| Route | Purpose |
| --- | --- |
| `POST /api/auth/signup`, `/login`, `/logout`, `GET /me`, `/status` | Accounts and sessions |
| `GET/POST /api/products`, `POST /:id/restock`, `DELETE /:id` | Stock |
| `GET/POST /api/sales` | Sales (credits the wallet) |
| `GET/POST /api/customers`, `POST /:id/pay` | Customers and repayments |
| `GET/POST /api/expenses`, `DELETE /:id` | Expenses (debit a pot) |
| `GET /api/dashboard` | Overview figures |
| `GET /api/wallet`, `PUT /rules`, `POST /transfer`, `GET /stream` | Wallet summary, rules, transfers, live stream |

## Known limitations

- One owner account per installation. Bizna is not yet multi-user or multi-shop.
- "Profit" is **sales minus expenses**. There is no cost price per product yet, so it is not true profit.
- No password-recovery email and no email verification. Recovery is the command above.
- The live stream runs inside one Node process. Scaling to several instances would need a shared message channel.
- Money is recorded in KES only.

## Roadmap

- Cost price per product and true profit
- Multi-shop and staff accounts with roles
- Savings goals per pot with progress
- M-Pesa statement import to reconcile recorded payments
- CSV and PDF export, daily summary by SMS or email
- Installable PWA with offline sales that sync later

## Credits

Fonts: [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) and [Figtree](https://github.com/erikdkennedy/figtree), both under the SIL Open Font License.
