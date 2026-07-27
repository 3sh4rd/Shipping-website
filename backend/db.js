/* GOFA SHIPPING backend - database setup + seed (PostgreSQL)
 * Uses a hosted Postgres database via the DATABASE_URL connection string.
 * Get a free one at https://neon.tech (permanent free tier).
 */
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("ERROR: DATABASE_URL is not set. Add your Postgres connection string to the environment.");
}

// Most hosted Postgres (Neon, Supabase, Render) require SSL. Local does not.
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString || "");
const pool = new Pool({
  connectionString,
  ssl: connectionString && !isLocal ? { rejectUnauthorized: false } : false
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      plan          TEXT NOT NULL DEFAULT 'basic',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS shipments (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
      tracking_number TEXT NOT NULL UNIQUE,
      status          TEXT NOT NULL DEFAULT 'Processing',
      origin          TEXT,
      destination     TEXT,
      eta             TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tracking_events (
      id              SERIAL PRIMARY KEY,
      tracking_number TEXT NOT NULL,
      status          TEXT NOT NULL,
      location        TEXT,
      timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
      done            BOOLEAN NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS orders (
      id       TEXT PRIMARY KEY,
      customer TEXT NOT NULL,
      email    TEXT,
      service  TEXT,
      date     TEXT,
      status   TEXT NOT NULL DEFAULT 'Pending',
      total    NUMERIC NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id       TEXT PRIMARY KEY,
      customer TEXT NOT NULL,
      email    TEXT,
      issued   TEXT,
      due      TEXT,
      status   TEXT NOT NULL DEFAULT 'Unpaid',
      amount   NUMERIC NOT NULL DEFAULT 0
    );
  `);
  await seed();
}

async function seed() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM users");
  if (rows[0].c > 0) {
    console.log("Database already has data - skipping seed.");
    return;
  }
  console.log("Seeding sample data...");
  const demoHash = bcrypt.hashSync("password123", 10);

  const u1 = (await pool.query(
    "INSERT INTO users (name, email, password_hash, plan) VALUES ($1,$2,$3,$4) RETURNING id",
    ["Maria Rolle", "maria@example.com", demoHash, "plus"]
  )).rows[0].id;
  const u2 = (await pool.query(
    "INSERT INTO users (name, email, password_hash, plan) VALUES ($1,$2,$3,$4) RETURNING id",
    ["Andre Bethel", "andre@example.com", demoHash, "business"]
  )).rows[0].id;
  await pool.query(
    "INSERT INTO users (name, email, password_hash, plan) VALUES ($1,$2,$3,$4)",
    ["Tamika Smith", "tamika@example.com", demoHash, "family"]
  );

  await pool.query(
    "INSERT INTO shipments (user_id, tracking_number, status, origin, destination, eta) VALUES ($1,$2,$3,$4,$5,$6)",
    [u1, "GOFA-284419", "In Transit", "Miami, FL", "Nassau, Bahamas", "2 days"]
  );
  await pool.query(
    "INSERT INTO shipments (user_id, tracking_number, status, origin, destination, eta) VALUES ($1,$2,$3,$4,$5,$6)",
    [u2, "GOFA-284402", "Delivered", "Miami, FL", "Freeport, Bahamas", "Delivered"]
  );

  const events = [
    ["GOFA-284419", "Picked up", "Miami, FL", "2026-07-24T09:00:00Z", true],
    ["GOFA-284419", "Departed port", "Miami, FL", "2026-07-25T18:00:00Z", true],
    ["GOFA-284419", "In transit", "At sea", "2026-07-26T08:00:00Z", false],
    ["GOFA-284402", "Picked up", "Miami, FL", "2026-07-18T10:00:00Z", true],
    ["GOFA-284402", "Arrived", "Freeport, Bahamas", "2026-07-22T14:00:00Z", true],
    ["GOFA-284402", "Delivered", "Freeport, Bahamas", "2026-07-23T11:00:00Z", true]
  ];
  for (const e of events) {
    await pool.query(
      "INSERT INTO tracking_events (tracking_number, status, location, timestamp, done) VALUES ($1,$2,$3,$4,$5)",
      e
    );
  }

  const orders = [
    ["GOFA-1001", "Maria Rolle", "maria@example.com", "Ocean Freight", "2026-07-24", "In Transit", 148.5],
    ["GOFA-1002", "Andre Bethel", "andre@example.com", "Air Freight", "2026-07-23", "Delivered", 92.0],
    ["GOFA-1003", "Tamika Smith", "tamika@example.com", "Family Island Delivery", "2026-07-25", "Pending", 210.75],
    ["GOFA-1004", "Maria Rolle", "maria@example.com", "Package Consolidation", "2026-07-26", "Processing", 45.0]
  ];
  for (const o of orders) {
    await pool.query(
      "INSERT INTO orders (id, customer, email, service, date, status, total) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      o
    );
  }

  const invoices = [
    ["INV-2001", "Maria Rolle", "maria@example.com", "2026-07-24", "2026-08-07", "Unpaid", 148.5],
    ["INV-2002", "Andre Bethel", "andre@example.com", "2026-07-23", "2026-08-06", "Paid", 92.0],
    ["INV-2003", "Tamika Smith", "tamika@example.com", "2026-07-10", "2026-07-24", "Overdue", 210.75]
  ];
  for (const i of invoices) {
    await pool.query(
      "INSERT INTO invoices (id, customer, email, issued, due, status, amount) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      i
    );
  }

  console.log("Seed complete. Demo customer login: maria@example.com / password123");
}

module.exports = { pool, init };
