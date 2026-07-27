# GOFA Shipping - Backend API

A small Node.js + Express + SQLite server that powers customer accounts, package tracking, orders, and invoices for the GOFA Shipping website.

## What it does

- **Customer accounts** - register, log in, and fetch the signed-in user + their shipments.
- **Tracking** - look up a package's status and event history by tracking number.
- **Admin** - sign in as admin and view/manage orders and invoices.

Data is stored in a **PostgreSQL** database (via the `DATABASE_URL` connection string). Tables are created automatically on first run and seeded with sample data. Postgres keeps your data permanently, even across restarts and redeploys.

---

## Get a free database (Neon)

1. Go to [neon.tech](https://neon.tech) and sign up (free, no card).
2. Create a project. Copy the **connection string** (starts with `postgresql://...` and ends with `?sslmode=require`).
3. Use it as `DATABASE_URL` locally and on Render.

Supabase (supabase.com) works too - use its "Connection string / URI".

---

## Run it locally

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
cd backend
cp .env.example .env        # then set DATABASE_URL and JWT_SECRET
npm install
npm start
```

The API starts at `http://localhost:4000`.

On first start it creates the tables and seeds sample customers, orders, and invoices.

**Demo customer login:** `maria@example.com` / `password123`
**Admin login:** `Gofa` / `Raelynn23$` (change these in `.env`).

### Quick test

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/tracking/GOFA-284419
```

---

## Connect the website to it

In the website's `config.js`, set `apiBaseUrl` to the server's URL:

```js
apiBaseUrl: "http://localhost:4000",   // local testing
// apiBaseUrl: "https://your-api.onrender.com",   // once deployed
```

The account page, tracking page, and admin dashboard will then use live data. Also add your website's address to `ALLOWED_ORIGINS` in `.env` (or leave `*` while testing).

---

## Deploy it free (Render)

1. Push this repo to GitHub (already done).
2. Go to [render.com](https://render.com) and create a **New > Web Service**, connect your repo.
3. Settings:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add Environment Variables: `DATABASE_URL` (your Neon connection string), `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ALLOWED_ORIGINS` (set this to your live site URL, e.g. `https://gofashipping.com`).
5. Deploy. Render gives you a URL like `https://gofa-shipping-api.onrender.com` - put that in `config.js` as `apiBaseUrl`.

> Data lives in your Neon Postgres database, so it persists permanently across restarts and redeploys - nothing is lost. (The free web instance still "sleeps" when idle, so the first request after a nap takes ~50 seconds to wake.)

---

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/register` | - | Create a customer account |
| POST | `/api/auth/login` | - | Customer login |
| GET | `/api/auth/me` | customer | Current user + shipments |
| GET | `/api/tracking/:id` | - | Track a package |
| POST | `/api/admin/login` | - | Admin login |
| GET | `/api/admin/orders` | admin | List orders |
| POST | `/api/admin/orders` | admin | Create an order |
| PATCH | `/api/admin/orders/:id` | admin | Update an order's status |
| GET | `/api/admin/invoices` | admin | List invoices |
| POST | `/api/admin/invoices` | admin | Create an invoice |
| PATCH | `/api/admin/invoices/:id` | admin | Update an invoice's status |
| GET | `/api/admin/customers` | admin | List customers |

Passwords are hashed with bcrypt. Logins return a JWT that the front-end sends as `Authorization: Bearer <token>`.
