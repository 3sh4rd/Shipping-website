/* GOFA SHIPPING backend - database setup + seed
 * Uses SQLite (via better-sqlite3). The database is a single file: gofa.db
 */
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "gofa.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// ---- Schema ----
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    plan          TEXT NOT NULL DEFAULT 'basic',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shipments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    tracking_number TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'Processing',
    origin          TEXT,
    destination     TEXT,
    eta             TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tracking_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_number TEXT NOT NULL,
    status          TEXT NOT NULL,
    location        TEXT,
    timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
    done            INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id         TEXT PRIMARY KEY,
    customer   TEXT NOT NULL,
    email      TEXT,
    service    TEXT,
    date       TEXT,
    status     TEXT NOT NULL DEFAULT 'Pending',
    total      REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id         TEXT PRIMARY KEY,
    customer   TEXT NOT NULL,
    email      TEXT,
    issued     TEXT,
    due        TEXT,
    status     TEXT NOT NULL DEFAULT 'Unpaid',
    amount     REAL NOT NULL DEFAULT 0
  );
`);

// ---- Seed (only runs when the DB is empty, or with: npm run seed) ----
function seed() {
  const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (userCount > 0) {
    console.log("Database already has data - skipping seed.");
    return;
  }
  console.log("Seeding sample data...");

  const insertUser = db.prepare(
    "INSERT INTO users (name, email, password_hash, plan) VALUES (?, ?, ?, ?)"
  );
  const demoHash = bcrypt.hashSync("password123", 10);
  const u1 = insertUser.run("Maria Rolle", "maria@example.com", demoHash, "plus").lastInsertRowid;
  const u2 = insertUser.run("Andre Bethel", "andre@example.com", demoHash, "business").lastInsertRowid;
  insertUser.run("Tamika Smith", "tamika@example.com", demoHash, "family");

  const insertShipment = db.prepare(
    "INSERT INTO shipments (user_id, tracking_number, status, origin, destination, eta) VALUES (?, ?, ?, ?, ?, ?)"
  );
  insertShipment.run(u1, "GOFA-284419", "In Transit", "Miami, FL", "Nassau, Bahamas", "2 days");
  insertShipment.run(u2, "GOFA-284402", "Delivered", "Miami, FL", "Freeport, Bahamas", "Delivered");

  const insertEvent = db.prepare(
    "INSERT INTO tracking_events (tracking_number, status, location, timestamp, done) VALUES (?, ?, ?, ?, ?)"
  );
  insertEvent.run("GOFA-284419", "Picked up", "Miami, FL", "2026-07-24T09:00:00Z", 1);
  insertEvent.run("GOFA-284419", "Departed port", "Miami, FL", "2026-07-25T18:00:00Z", 1);
  insertEvent.run("GOFA-284419", "In transit", "At sea", "2026-07-26T08:00:00Z", 0);
  insertEvent.run("GOFA-284402", "Picked up", "Miami, FL", "2026-07-18T10:00:00Z", 1);
  insertEvent.run("GOFA-284402", "Arrived", "Freeport, Bahamas", "2026-07-22T14:00:00Z", 1);
  insertEvent.run("GOFA-284402", "Delivered", "Freeport, Bahamas", "2026-07-23T11:00:00Z", 1);

  const insertOrder = db.prepare(
    "INSERT INTO orders (id, customer, email, service, date, status, total) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  insertOrder.run("GOFA-1001", "Maria Rolle", "maria@example.com", "Ocean Freight", "2026-07-24", "In Transit", 148.5);
  insertOrder.run("GOFA-1002", "Andre Bethel", "andre@example.com", "Air Freight", "2026-07-23", "Delivered", 92.0);
  insertOrder.run("GOFA-1003", "Tamika Smith", "tamika@example.com", "Family Island Delivery", "2026-07-25", "Pending", 210.75);
  insertOrder.run("GOFA-1004", "Maria Rolle", "maria@example.com", "Package Consolidation", "2026-07-26", "Processing", 45.0);

  const insertInvoice = db.prepare(
    "INSERT INTO invoices (id, customer, email, issued, due, status, amount) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  insertInvoice.run("INV-2001", "Maria Rolle", "maria@example.com", "2026-07-24", "2026-08-07", "Unpaid", 148.5);
  insertInvoice.run("INV-2002", "Andre Bethel", "andre@example.com", "2026-07-23", "2026-08-06", "Paid", 92.0);
  insertInvoice.run("INV-2003", "Tamika Smith", "tamika@example.com", "2026-07-10", "2026-07-24", "Overdue", 210.75);

  console.log("Seed complete. Demo customer login: maria@example.com / password123");
}

// Auto-seed on first run; force with: node db.js --seed
if (require.main === module || process.argv.includes("--seed")) {
  seed();
}

module.exports = { db, seed };
