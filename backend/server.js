/* GOFA SHIPPING backend - API server
 * Endpoints (match the front-end config.js):
 *   Customer:
 *     POST /api/auth/register   { name, email, password }        -> { token, user }
 *     POST /api/auth/login      { email, password }              -> { token, user }
 *     GET  /api/auth/me         (Bearer)                         -> { user, shipments }
 *   Tracking (public):
 *     GET  /api/tracking/:id                                     -> { trackingNumber, status, origin, destination, eta, events }
 *   Admin:
 *     POST /api/admin/login     { username, password }           -> { token }
 *     GET  /api/admin/orders    (Bearer admin)                   -> [ orders ]
 *     POST /api/admin/orders    (Bearer admin) { ...order }      -> order
 *     PATCH/api/admin/orders/:id(Bearer admin) { status }        -> order
 *     GET  /api/admin/invoices  (Bearer admin)                   -> [ invoices ]
 *     POST /api/admin/invoices  (Bearer admin) { ...invoice }    -> invoice
 *     PATCH/api/admin/invoices/:id (Bearer admin) { status }     -> invoice
 *     GET  /api/admin/customers (Bearer admin)                   -> [ users ]
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { db, seed } = require("./db");

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "Gofa";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Raelynn23$";
const ALLOWED = (process.env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim());

// Make sure sample data exists on first boot
seed();

const app = express();
app.use(express.json());
app.use(cors({
  origin: (origin, cb) => {
    if (ALLOWED.includes("*") || !origin || ALLOWED.includes(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  }
}));

// ---- Helpers ----
function sign(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, plan: u.plan };
}
function auth(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Missing token" });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (role && decoded.role !== role) return res.status(403).json({ message: "Forbidden" });
      req.user = decoded;
      next();
    } catch (_) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
  };
}
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ""));

// ---- Health ----
app.get("/", (_req, res) => res.json({ ok: true, service: "GOFA Shipping API" }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ================= CUSTOMER AUTH =================
app.post("/api/auth/register", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !isEmail(email) || !password || String(password).length < 6) {
    return res.status(400).json({ message: "Name, a valid email, and a 6+ char password are required." });
  }
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) return res.status(409).json({ message: "An account with that email already exists." });

  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare(
    "INSERT INTO users (name, email, password_hash, plan) VALUES (?, ?, ?, 'basic')"
  ).run(name.trim(), email.toLowerCase(), hash);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  const token = sign({ id: user.id, email: user.email, role: "customer" });
  res.status(201).json({ token, user: publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email) || !password) return res.status(400).json({ message: "Email and password are required." });
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).toLowerCase());
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ message: "Incorrect email or password." });
  }
  const token = sign({ id: user.id, email: user.email, role: "customer" });
  res.json({ token, user: publicUser(user) });
});

app.get("/api/auth/me", auth("customer"), (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  const shipments = db.prepare(
    "SELECT tracking_number AS trackingNumber, status, origin, destination, eta FROM shipments WHERE user_id = ? ORDER BY created_at DESC"
  ).all(user.id);
  res.json({ user: publicUser(user), shipments });
});

// ================= TRACKING (public) =================
app.get("/api/tracking/:id", (req, res) => {
  const tn = req.params.id;
  const s = db.prepare(
    "SELECT tracking_number AS trackingNumber, status, origin, destination, eta FROM shipments WHERE tracking_number = ?"
  ).get(tn);
  if (!s) return res.status(404).json({ message: "Tracking number not found." });
  const events = db.prepare(
    "SELECT status, location, timestamp, done FROM tracking_events WHERE tracking_number = ? ORDER BY timestamp ASC"
  ).all(tn).map(e => ({ ...e, done: !!e.done }));
  res.json({ ...s, events });
});

// ================= ADMIN =================
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return res.json({ token: sign({ username, role: "admin" }) });
  }
  res.status(401).json({ message: "Incorrect username or password." });
});

app.get("/api/admin/orders", auth("admin"), (_req, res) => {
  res.json(db.prepare("SELECT * FROM orders ORDER BY date DESC").all());
});
app.post("/api/admin/orders", auth("admin"), (req, res) => {
  const { id, customer, email, service, date, status, total } = req.body || {};
  if (!id || !customer) return res.status(400).json({ message: "id and customer are required." });
  db.prepare(
    "INSERT INTO orders (id, customer, email, service, date, status, total) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, customer, email || null, service || null, date || null, status || "Pending", Number(total) || 0);
  res.status(201).json(db.prepare("SELECT * FROM orders WHERE id = ?").get(id));
});
app.patch("/api/admin/orders/:id", auth("admin"), (req, res) => {
  const { status } = req.body || {};
  const result = db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, req.params.id);
  if (!result.changes) return res.status(404).json({ message: "Order not found." });
  res.json(db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id));
});

app.get("/api/admin/invoices", auth("admin"), (_req, res) => {
  res.json(db.prepare("SELECT * FROM invoices ORDER BY issued DESC").all());
});
app.post("/api/admin/invoices", auth("admin"), (req, res) => {
  const { id, customer, email, issued, due, status, amount } = req.body || {};
  if (!id || !customer) return res.status(400).json({ message: "id and customer are required." });
  db.prepare(
    "INSERT INTO invoices (id, customer, email, issued, due, status, amount) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, customer, email || null, issued || null, due || null, status || "Unpaid", Number(amount) || 0);
  res.status(201).json(db.prepare("SELECT * FROM invoices WHERE id = ?").get(id));
});
app.patch("/api/admin/invoices/:id", auth("admin"), (req, res) => {
  const { status } = req.body || {};
  const result = db.prepare("UPDATE invoices SET status = ? WHERE id = ?").run(status, req.params.id);
  if (!result.changes) return res.status(404).json({ message: "Invoice not found." });
  res.json(db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id));
});

app.get("/api/admin/customers", auth("admin"), (_req, res) => {
  res.json(db.prepare("SELECT id, name, email, plan, created_at FROM users ORDER BY created_at DESC").all());
});

app.listen(PORT, () => {
  console.log(`GOFA Shipping API running on http://localhost:${PORT}`);
});
