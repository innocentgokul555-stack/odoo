# odoo - Subscription Management System

One system to run **plans, subscriptions and recurring billing**: set up products and plans, turn a quotation into a
subscription, create invoices automatically on billing day, record payments, apply taxes and discounts by rule,
and show the finance lead active subscriptions, revenue, what is owed and what is overdue.

Built for the fictional company *Brightloop Software*. Customers get their own portal.

- **Backend:** Node.js + Express + SQLite (`backend/`)
- **Frontend:** React + Vite (`frontend/`)
- No database server to install - the data lives in one file.

---

## 1. Run it (3 commands)

You need **Node.js 22 LTS** (or 20.19 or newer). Get it from https://nodejs.org (choose the "LTS" button) and install it once.

```bash
git clone <your-repository-address> odoo
cd odoo

npm run setup     # installs everything (about a minute)
npm run seed      # fills the system with demo data
npm run dev       # starts it
```

Now open **http://localhost:5173** in your browser. Press `Ctrl+C` in the terminal to stop.

### Demo logins

| Role | Email | Password |
|---|---|---|
| Admin (controls everything) | `admin@brightloop.test` | `Admin@12345` |
| Staff (day-to-day, limited) | `staff@brightloop.test` | `Staff@12345` |
| Customer (portal only) | `customer@brightloop.test` | `Customer@123` |

The sign-in page has "Fill in Admin / Staff / Customer" buttons so you do not have to type these.

### Other ways to run it

| Command | What it does |
|---|---|
| `npm run build` then `npm start` | Runs everything on one address: **http://localhost:4000** |
| `npm run seed:reset` | Wipes the database and loads the demo data again |
| `npm run seed:bulk` | Adds 5,000 subscriptions and about 20,000 invoices to test speed |
| `npm test` | Runs all automated tests (backend and website) |

---

## 2. Put it on GitHub

1. Create a free account at https://github.com and click **New repository**. Name it `odoo`. Leave it empty (no README, no .gitignore).
2. Unzip this project. In a terminal, go into the `odoo` folder and run:

```bash
git init
git add .
git commit -m "Subscription management system"
git branch -M main
git remote add origin https://github.com/<your-username>/odoo.git
git push -u origin main
```

3. Anyone can now run it on their own computer with the commands in section 1. To let people just open it in a browser, see the next part.
   The `.gitignore` file already keeps passwords, the database and downloaded packages out of GitHub.
4. A GitHub Actions check (`.github/workflows/ci.yml`) runs the tests automatically on every push.

### Get a public link anyone can open in a browser (free)

GitHub only stores the code - it cannot run the system. To get a web address that anyone can open, host it on Render
(free, no credit card needed for the free plan). Do this once, after pushing to GitHub:

1. Go to https://render.com and sign up with your GitHub account.
2. Click **New** > **Blueprint**, choose your `odoo` repository and click **Apply**.
   (Render reads the `render.yaml` file in the project and does the rest.)
3. Wait about 5 minutes. Render shows an address like `https://odoo-subscriptions.onrender.com`.
4. Open it - the sign-in page has "Fill in Admin / Staff / Customer" buttons. Put the address in your GitHub repository description so visitors find it.

Good to know: on the free plan the site goes to sleep when nobody uses it (the first visit then takes about a minute), and the data is reset
when it restarts - the demo data is simply loaded again, so it always looks fresh. For a permanent system, use a paid plan with a disk
mounted at `/data`, and set `DEMO_MODE=false`.

Any other Docker host works too (Railway, Fly.io, a server): set `JWT_SECRET` (a long random text) and, for demo data, `SEED_DEMO=true`.

---

## 3. How the system matches the brief

| Scene | Where to find it |
|---|---|
| **A new customer signs up** - one account per email, password more than 8 characters with an uppercase letter, a lowercase letter and a special character | *Create an account* page (live rule checklist). Rules are enforced by the server too. |
| Forgotten password - reset link to the registered email | *Forgot your password?* The link is saved in **Email outbox** (admin) and, in demo mode, shown on screen. Add `SMTP_*` settings to send real email. |
| Admin, staff and customer see different things; only the admin adds staff | **Staff** page (admin only). Staff cannot edit products, plans, taxes or discounts. Customers only get the portal. |
| **Launching a new plan** - product with name, type, sales price, cost price, notes and variants (Odoo brand = +560) | **Products** (variants editor) and **Plans** (price, daily/weekly/monthly/yearly, minimum quantity, available dates, and per plan: closes by itself / can be closed early / can be paused / can be renewed) |
| **Quote to subscription** - quotation template, validity in days, subscription number, lines with taxes, Draft > Quotation > Confirmed > Active > Closed | **Quotation templates**, then **Subscriptions > New**. The detail page shows a status bar, action buttons and the full history. |
| **Billing day** - nobody types invoices; taxes automatic; confirm, cancel, send, print; Draft > Confirmed > Paid; never billed twice or skipped | **Run billing** button (also runs by itself every hour). Invoices open as drafts; confirm, send, print or cancel them. |
| **A better price** - admin-only discount rules (fixed or %), minimum purchase or quantity, dates, usage limit, per product or whole subscription | **Discounts** (admin). They appear on the next matching invoice on their own and stop when expired or used up. |
| **The money comes in** - method, amount, date, note, against the right invoice; who is paid, who is overdue | **Payments** and the *Record payment* button on an invoice. Overdue invoices are flagged everywhere. |
| **Finance lead** - active subscriptions, revenue, owed, overdue; filters and a summary | **Dashboard** (filters by dates, customer and plan; monthly chart; overdue by age; renewals coming up) |
| **Under two seconds** with thousands of subscriptions | Measured with 5,000+ subscriptions and 22,000+ invoices: every page and report answers in well under 0.1 second (lists are paged on the server and indexed). |

### The rules in plain words

- **What an invoice contains:** the plan fee plus every product line of the subscription. Customer details are copied onto the invoice.
- **Taxes:** the admin creates tax rules and attaches one to a product or plan. Tax is calculated automatically on the amount *after* discounts.
- **Billing is in advance.** A monthly subscription that starts on the 15th is invoiced on the 15th of every month. Billing dates stay on the original day (31 Jan, 28 Feb, 31 Mar...).
- **Nothing billed twice, nothing skipped:** each subscription remembers its next billing date, and the database refuses a second live invoice for the same period. If billing was not run for a while, the next run catches up on every missed period.
- **When a plan ends:** if the plan "closes automatically" the subscription closes at its expiry date (after billing every period before it). If not, it renews itself for another term. Closing early, pausing and renewing are only possible when the plan allows them.
- **Pausing** stops invoices; on resume, billing dates and the expiry move forward by the paused days.
- **Plan changes** do not alter existing subscriptions (they keep the price they started with).
- **Discounts** are checked on every invoice: active dates, minimum purchase/quantity, usage limit, optional single customer. Cancelling an invoice gives the discount use back.
- **A payment** can be partial. When the paid amount reaches the invoice total the invoice becomes *Paid*. More than the balance is refused.
- **Customers** see only their own subscriptions and invoices (no drafts) and can pause, close or renew where the plan allows.

---

## 4. Settings (all optional)

Everything works without changing anything. To change settings, copy `backend/.env.example` to `backend/.env` and edit it:

| Setting | Meaning |
|---|---|
| `PORT` | API port (default 4000) |
| `JWT_SECRET` | Secret used for sign-in tokens. **Set this for real use.** |
| `DEMO_MODE` | `true` shows reset links on screen. Use `false` in production. |
| `CURRENCY`, `COMPANY_NAME` | Shown across the app |
| `BILLING_AUTORUN`, `BILLING_AUTO_CONFIRM` | Hourly automatic billing, and whether new invoices are confirmed straight away |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Send real emails |
| `DB_PATH` | Where the database file lives (default `backend/data/odoo.db`) |

---

## 5. Folder map

```
odoo/
  backend/
    src/
      app.js, server.js, db.js, schema.js   start-up, database and tables
      routes/                               the API (auth, catalog, subscriptions, finance, portal...)
      services/                             business rules: billing.js, subscriptions.js, invoices.js, reports.js
      seed/                                 demo data and bulk test data
    test/api.test.js                        28 tests of the business rules
  frontend/
    src/pages/                              one file per screen
    src/components/, ui.jsx                 shared building blocks
    tests/                                  browser-style tests (they start the real backend)
  scripts/dev.mjs                           starts backend + website together
  Dockerfile, .github/workflows/ci.yml
```

### Main API addresses (all under `/api`)

`/auth/*` sign up, sign in, reset password - `/products` `/plans` `/taxes` `/payment-terms` `/templates` `/discounts` catalogue -
`/customers` `/staff` people - `/subscriptions` (+ `/:id/quote|confirm|activate|pause|resume|renew|close|bill`) -
`/invoices` (+ `/:id/confirm|cancel|send|payments`) - `/payments` - `/billing/run` - `/reports/summary` - `/portal/*` customer portal.

---

## 6. If something goes wrong

- **`npm run setup` fails on `better-sqlite3`:** install Node.js 22 LTS. The system then falls back to Node's built-in SQLite automatically.
- **"Port already in use":** another program uses 4000 or 5173. Close it, or set `PORT` in `backend/.env`.
- **"Cannot reach the server" in the browser:** the backend is not running - start it with `npm run dev`.
- **Forgot the demo logins / want clean data:** `npm run seed:reset`.
- **Hosting without SMTP:** read all emails under **Email outbox** (admin).
