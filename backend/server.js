/* GOFA SHIPPING backend - API server (PostgreSQL)
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
const { pool, init } = require("./db");

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "Gofa";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Raelynn23$";
const ALLOWED = (process.env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim());

// ---- AI Quote (Gemini) + customs fee rules ----
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const VAT_RATE = Number(process.env.VAT_RATE || "0.10");          // 10% customs VAT
const PROCESSING_RATE = Number(process.env.PROCESSING_RATE || "0.01"); // 1% processing fee
const PROC_MIN = Number(process.env.PROC_MIN || "10");            // processing fee minimum $10
const PROC_MAX = Number(process.env.PROC_MAX || "750");           // processing fee maximum $750
const ENV_LEVY = Number(process.env.ENV_LEVY || "0");             // flat environmental levy (editable on the page)

const app = express();
app.use(express.json({ limit: "15mb" })); // allow base64 invoice images
app.use(cors({
  origin: (origin, cb) => {
    if (ALLOWED.includes("*") || !origin || ALLOWED.includes(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  }
}));

// ---- Helpers ----
function sign(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" }); }
function publicUser(u) { return { id: u.id, name: u.name, email: u.email, plan: u.plan }; }
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
// Wrap async handlers so errors return JSON instead of crashing
const wrap = (fn) => (req, res) => fn(req, res).catch(err => {
  console.error(err);
  res.status(500).json({ message: "Server error" });
});

// ---- Health ----
app.get("/", (_req, res) => res.json({ ok: true, service: "GOFA Shipping API" }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ================= CUSTOMER AUTH =================
app.post("/api/auth/register", wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !isEmail(email) || !password || String(password).length < 6) {
    return res.status(400).json({ message: "Name, a valid email, and a 6+ char password are required." });
  }
  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
  if (existing.rows.length) return res.status(409).json({ message: "An account with that email already exists." });

  const hash = bcrypt.hashSync(String(password), 10);
  const { rows } = await pool.query(
    "INSERT INTO users (name, email, password_hash, plan) VALUES ($1,$2,$3,'basic') RETURNING *",
    [name.trim(), email.toLowerCase(), hash]
  );
  const user = rows[0];
  res.status(201).json({ token: sign({ id: user.id, email: user.email, role: "customer" }), user: publicUser(user) });
}));

app.post("/api/auth/login", wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email) || !password) return res.status(400).json({ message: "Email and password are required." });
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [String(email).toLowerCase()]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ message: "Incorrect email or password." });
  }
  res.json({ token: sign({ id: user.id, email: user.email, role: "customer" }), user: publicUser(user) });
}));

app.get("/api/auth/me", auth("customer"), wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ message: "User not found" });
  const shipments = (await pool.query(
    "SELECT tracking_number AS \"trackingNumber\", status, origin, destination, eta FROM shipments WHERE user_id = $1 ORDER BY created_at DESC",
    [user.id]
  )).rows;
  res.json({ user: publicUser(user), shipments });
}));

// ================= TRACKING (public) =================
app.get("/api/tracking/:id", wrap(async (req, res) => {
  const tn = req.params.id;
  const { rows } = await pool.query(
    "SELECT tracking_number AS \"trackingNumber\", status, origin, destination, eta FROM shipments WHERE tracking_number = $1",
    [tn]
  );
  if (!rows.length) return res.status(404).json({ message: "Tracking number not found." });
  const events = (await pool.query(
    "SELECT status, location, timestamp, done FROM tracking_events WHERE tracking_number = $1 ORDER BY timestamp ASC",
    [tn]
  )).rows;
  res.json({ ...rows[0], events });
}));

// ================= AI QUOTE (Gemini) =================
app.post("/api/quote", wrap(async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ code: "AI_NOT_CONFIGURED", message: "AI quote is not enabled yet. Set GEMINI_API_KEY on the server." });
  }
  const { image, mimeType } = req.body || {};
  if (!image) return res.status(400).json({ message: "No image provided." });

  const prompt = [
    "You are a customs classification assistant for GOFA Shipping, which imports goods into The Bahamas.",
    "Read this invoice/receipt/order image and extract every purchased product line item.",
    "For EACH item return: description (short, human readable), quantity (integer), unitCost (number in USD),",
    "category (best product category), and dutyRate (the Bahamas import DUTY rate as a percentage NUMBER for that item type).",
    "Use realistic Bahamas customs duty rates for the item type (common values include 0, 10, 20, 25, 35, 45, 65).",
    "Ignore shipping, tax, subtotal, discount and total lines - only real products.",
    "Respond ONLY as JSON of the form: {\"items\":[{\"description\":\"\",\"quantity\":1,\"unitCost\":0,\"category\":\"\",\"dutyRate\":0}]}"
  ].join(" ");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  let aiResp;
  try {
    aiResp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType || "image/jpeg", data: image } }
        ]}],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      })
    });
  } catch (_) {
    return res.status(502).json({ message: "Could not reach the AI service." });
  }
  if (!aiResp.ok) {
    const t = await aiResp.text().catch(() => "");
    console.error("Gemini error", aiResp.status, t);
    return res.status(502).json({ message: "The AI could not read that file. Try a clearer photo." });
  }
  const data = await aiResp.json();
  let parsed;
  try {
    const text = data.candidates[0].content.parts.map(p => p.text || "").join("");
    parsed = JSON.parse(text);
  } catch (_) {
    return res.status(422).json({ code: "UNREADABLE", message: "We had trouble reading that file. Try a clearer photo of the invoice." });
  }

  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  if (!rawItems.length) return res.status(422).json({ code: "UNREADABLE", message: "No items were found. Try a clearer photo of the invoice." });

  const items = rawItems.map(it => {
    const quantity = Math.max(1, Math.round(Number(it.quantity) || 1));
    const unitCost = Math.max(0, Number(it.unitCost) || 0);
    const dutyRate = Math.max(0, Number(it.dutyRate) || 0);
    const value = +(quantity * unitCost).toFixed(2);
    const duty = +(value * dutyRate / 100).toFixed(2);
    return { description: String(it.description || "Item"), category: String(it.category || ""), quantity, unitCost, dutyRate, value, duty };
  });

  const valueTotal = +items.reduce((s, i) => s + i.value, 0).toFixed(2);
  const dutyTotal = +items.reduce((s, i) => s + i.duty, 0).toFixed(2);
  const processing = valueTotal > 0
    ? +Math.min(PROC_MAX, Math.max(PROC_MIN, valueTotal * PROCESSING_RATE)).toFixed(2)
    : 0;
  const levy = +ENV_LEVY.toFixed(2);
  const vat = +((valueTotal + dutyTotal + processing + levy) * VAT_RATE).toFixed(2);
  const totalFees = +(dutyTotal + processing + levy + vat).toFixed(2);

  res.json({
    items, valueTotal, dutyTotal, processing, levy, vat, totalFees,
    rules: { vatRate: VAT_RATE, processingRate: PROCESSING_RATE, processingMin: PROC_MIN, processingMax: PROC_MAX, levy }
  });
}));

// ================= ADMIN =================
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return res.json({ token: sign({ username, role: "admin" }) });
  }
  res.status(401).json({ message: "Incorrect username or password." });
});

app.get("/api/admin/orders", auth("admin"), wrap(async (_req, res) => {
  res.json((await pool.query("SELECT * FROM orders ORDER BY date DESC")).rows);
}));
app.post("/api/admin/orders", auth("admin"), wrap(async (req, res) => {
  const { id, customer, email, service, date, status, total } = req.body || {};
  if (!id || !customer) return res.status(400).json({ message: "id and customer are required." });
  const { rows } = await pool.query(
    "INSERT INTO orders (id, customer, email, service, date, status, total) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [id, customer, email || null, service || null, date || null, status || "Pending", Number(total) || 0]
  );
  res.status(201).json(rows[0]);
}));
app.patch("/api/admin/orders/:id", auth("admin"), wrap(async (req, res) => {
  const { customer, email, service, date, status, total } = req.body || {};
  const { rows } = await pool.query(
    "UPDATE orders SET customer=$1, email=$2, service=$3, date=$4, status=$5, total=$6 WHERE id=$7 RETURNING *",
    [customer, email || null, service || null, date || null, status || "Pending", Number(total) || 0, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ message: "Order not found." });
  res.json(rows[0]);
}));
app.delete("/api/admin/orders/:id", auth("admin"), wrap(async (req, res) => {
  const { rowCount } = await pool.query("DELETE FROM orders WHERE id = $1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ message: "Order not found." });
  res.status(204).end();
}));

app.get("/api/admin/invoices", auth("admin"), wrap(async (_req, res) => {
  res.json((await pool.query("SELECT * FROM invoices ORDER BY issued DESC")).rows);
}));
app.post("/api/admin/invoices", auth("admin"), wrap(async (req, res) => {
  const { id, customer, email, issued, due, status, amount } = req.body || {};
  if (!id || !customer) return res.status(400).json({ message: "id and customer are required." });
  const { rows } = await pool.query(
    "INSERT INTO invoices (id, customer, email, issued, due, status, amount) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [id, customer, email || null, issued || null, due || null, status || "Unpaid", Number(amount) || 0]
  );
  res.status(201).json(rows[0]);
}));
app.patch("/api/admin/invoices/:id", auth("admin"), wrap(async (req, res) => {
  const { customer, email, issued, due, status, amount } = req.body || {};
  const { rows } = await pool.query(
    "UPDATE invoices SET customer=$1, email=$2, issued=$3, due=$4, status=$5, amount=$6 WHERE id=$7 RETURNING *",
    [customer, email || null, issued || null, due || null, status || "Unpaid", Number(amount) || 0, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ message: "Invoice not found." });
  res.json(rows[0]);
}));
app.delete("/api/admin/invoices/:id", auth("admin"), wrap(async (req, res) => {
  const { rowCount } = await pool.query("DELETE FROM invoices WHERE id = $1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ message: "Invoice not found." });
  res.status(204).end();
}));

app.get("/api/admin/customers", auth("admin"), wrap(async (_req, res) => {
  res.json((await pool.query("SELECT id, name, email, plan, created_at FROM users ORDER BY created_at DESC")).rows);
}));

// ---- Start (after DB is ready) ----
init()
  .then(() => app.listen(PORT, () => console.log(`GOFA Shipping API running on http://localhost:${PORT}`)))
  .catch(err => { console.error("Failed to initialize database:", err); process.exit(1); });
