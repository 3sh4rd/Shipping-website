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

// ---- Membership billing ----
const PLAN_PRICES = {
  plus: Number(process.env.PRICE_PLUS || "19.99"),
  business: Number(process.env.PRICE_BUSINESS || "49.99"),
  family: Number(process.env.PRICE_FAMILY || "29.99")
};
const PLAN_DAYS = Number(process.env.PLAN_DAYS || "30");
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const PAYPAL_SECRET = process.env.PAYPAL_SECRET || "";
const PAYPAL_BASE = process.env.PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

async function paypalToken() {
  const r = await fetch(PAYPAL_BASE + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(PAYPAL_CLIENT_ID + ":" + PAYPAL_SECRET).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!r.ok) throw new Error("PayPal auth failed");
  return (await r.json()).access_token;
}
async function paypalGetOrder(orderID, token) {
  const r = await fetch(PAYPAL_BASE + "/v2/checkout/orders/" + encodeURIComponent(orderID), {
    headers: { Authorization: "Bearer " + token }
  });
  if (!r.ok) throw new Error("PayPal order lookup failed");
  return r.json();
}
async function activatePlan(userId, plan) {
  await pool.query(
    `UPDATE users SET plan = $1, plan_expires = now() + ($2 || ' days')::interval WHERE id = $3`,
    [plan, String(PLAN_DAYS), userId]
  );
}

// ---- SunCash checkout (V1) ----
const SUNCASH_ENV = process.env.SUNCASH_ENV || "dev";
const SUNCASH_BASE = SUNCASH_ENV === "prod" ? "https://prod.mysuncash.com" : "http://dev.mysuncash.com";
const SUNCASH_MERCHANT_KEY = process.env.SUNCASH_MERCHANT_KEY || "";
const SUNCASH_MERCHANT_NAME = process.env.SUNCASH_MERCHANT_NAME || "";
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || "").replace(/\/+$/, "");
const SITE_URL = (process.env.SITE_URL || "").replace(/\/+$/, "");

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
function publicUser(u) { return { id: u.id, name: u.name, email: u.email, plan: u.plan, planExpires: u.plan_expires || null }; }
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

// Customer's own orders + invoices (matched by their account email) - powers statements
app.get("/api/auth/activity", auth("customer"), wrap(async (req, res) => {
  const email = String(req.user.email || "").toLowerCase();
  const orders = (await pool.query("SELECT * FROM orders WHERE lower(email) = $1 ORDER BY date DESC", [email])).rows;
  const invoices = (await pool.query("SELECT * FROM invoices WHERE lower(email) = $1 ORDER BY issued DESC", [email])).rows;
  res.json({ orders, invoices });
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

// ================= MEMBERSHIP BILLING =================
// PayPal: verify the captured order server-side, then activate the plan.
app.post("/api/billing/paypal", auth("customer"), wrap(async (req, res) => {
  const { plan, orderID } = req.body || {};
  if (!PLAN_PRICES[plan]) return res.status(400).json({ message: "Unknown plan." });
  if (!orderID) return res.status(400).json({ message: "Missing PayPal order." });
  if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
    return res.status(503).json({ code: "PAYPAL_NOT_CONFIGURED", message: "PayPal is not enabled on the server yet." });
  }
  // Prevent replaying the same order
  const dup = await pool.query("SELECT id FROM payments WHERE reference = $1", [orderID]);
  if (dup.rows.length) {
    const u = (await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id])).rows[0];
    return res.json({ ok: true, alreadyProcessed: true, user: publicUser(u) });
  }
  const token = await paypalToken();
  const order = await paypalGetOrder(orderID, token);
  const pu = (order.purchase_units && order.purchase_units[0]) || {};
  const amt = pu.amount || (pu.payments && pu.payments.captures && pu.payments.captures[0] && pu.payments.captures[0].amount) || {};
  const paidValue = Number(amt.value || 0);
  const expected = PLAN_PRICES[plan];
  if (order.status !== "COMPLETED" && order.status !== "APPROVED") {
    return res.status(400).json({ message: "Payment not completed." });
  }
  if (paidValue + 0.01 < expected) {
    return res.status(400).json({ message: "Paid amount does not match the plan price." });
  }
  await pool.query(
    "INSERT INTO payments (user_id, email, customer, plan, method, amount, reference, status) VALUES ($1,$2,$3,$4,'paypal',$5,$6,'paid')",
    [req.user.id, req.user.email, order.payer && order.payer.name ? (order.payer.name.given_name + " " + (order.payer.name.surname || "")).trim() : null, plan, paidValue, orderID]
  );
  await activatePlan(req.user.id, plan);
  const user = (await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id])).rows[0];
  res.json({ ok: true, user: publicUser(user) });
}));

// SunCash online checkout: create a hosted checkout and return the redirect URL.
app.post("/api/billing/suncash/start", auth("customer"), wrap(async (req, res) => {
  const { plan } = req.body || {};
  if (!PLAN_PRICES[plan]) return res.status(400).json({ message: "Unknown plan." });
  if (!SUNCASH_MERCHANT_KEY || !SUNCASH_MERCHANT_NAME || !PUBLIC_API_URL) {
    return res.status(503).json({ code: "SUNCASH_NOT_CONFIGURED", message: "SunCash online checkout not enabled yet." });
  }
  const price = PLAN_PRICES[plan];
  const token = "SC" + Date.now() + Math.random().toString(36).slice(2, 8);
  const user = (await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id])).rows[0];
  const ins = await pool.query(
    "INSERT INTO payments (user_id, email, customer, plan, method, amount, reference, status) VALUES ($1,$2,$3,$4,'suncash',$5,$6,'pending') RETURNING id",
    [req.user.id, req.user.email, user ? user.name : null, plan, price, token]
  );
  const callback = `${PUBLIC_API_URL}/api/billing/suncash/callback/${token}`;
  const params = new URLSearchParams({
    method: "payment",
    P01: SUNCASH_MERCHANT_KEY,
    P02: SUNCASH_MERCHANT_NAME,
    P03: price.toFixed(2),
    P04: token,
    P05: callback,
    P06: `GOFA ${plan} Membership|1|${price.toFixed(2)}`
  });
  let scResp;
  try {
    const r = await fetch(`${SUNCASH_BASE}/api/checkout.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    scResp = await r.json();
  } catch (_) {
    return res.status(502).json({ message: "Could not reach SunCash. Please try again." });
  }
  const ok = scResp && String(scResp.Success).toUpperCase() === "YES" && scResp.ResponseMessage && scResp.ResponseMessage.url;
  if (!ok) {
    const msg = (scResp && typeof scResp.ResponseMessage === "string") ? scResp.ResponseMessage : "SunCash checkout could not be started.";
    return res.status(502).json({ message: msg });
  }
  await pool.query("UPDATE payments SET provider_ref = $1 WHERE id = $2", [String(scResp.ResponseMessage.reference_id || ""), ins.rows[0].id]);
  res.json({ url: scResp.ResponseMessage.url });
}));

// SunCash callback: SunCash appends /{base64} to our callback URL after payment.
app.get("/api/billing/suncash/callback/:ref/:data", wrap(async (req, res) => {
  const { ref, data } = req.params;
  let decoded = "";
  try { decoded = Buffer.from(data, "base64").toString("utf8"); } catch (_) {}
  const success = /success/i.test(decoded);
  const p = (await pool.query("SELECT * FROM payments WHERE reference = $1", [ref])).rows[0];
  if (p && p.status === "pending") {
    if (success) {
      await pool.query("UPDATE payments SET status = 'paid' WHERE id = $1", [p.id]);
      if (p.user_id) await activatePlan(p.user_id, p.plan);
    } else {
      await pool.query("UPDATE payments SET status = 'rejected' WHERE id = $1", [p.id]);
    }
  }
  res.redirect(302, (SITE_URL || "") + "/account/?sc=" + (success ? "success" : "failed"));
}));
// Fallback if SunCash calls back without the encoded segment
app.get("/api/billing/suncash/callback/:ref", (_req, res) => {
  res.redirect(302, (SITE_URL || "") + "/account/?sc=failed");
});

// SunCash manual fallback: record a pending payment for admin to confirm.
app.post("/api/billing/suncash", auth("customer"), wrap(async (req, res) => {
  const { plan, reference } = req.body || {};
  if (!PLAN_PRICES[plan]) return res.status(400).json({ message: "Unknown plan." });
  const user = (await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id])).rows[0];
  await pool.query(
    "INSERT INTO payments (user_id, email, customer, plan, method, amount, reference, status) VALUES ($1,$2,$3,$4,'suncash',$5,$6,'pending')",
    [req.user.id, req.user.email, user ? user.name : null, plan, PLAN_PRICES[plan], String(reference || "").trim() || null]
  );
  res.status(201).json({ pending: true, message: "Payment submitted. We'll activate your plan once we confirm your SunCash payment." });
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
  // Include the customer's membership plan (if they have an account) so staff can prioritize
  res.json((await pool.query(
    "SELECT o.*, u.plan AS customer_plan FROM orders o LEFT JOIN users u ON lower(u.email) = lower(o.email) ORDER BY o.date DESC"
  )).rows);
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
  res.json((await pool.query("SELECT id, name, email, plan, plan_expires, created_at FROM users ORDER BY created_at DESC")).rows);
}));

app.get("/api/admin/payments", auth("admin"), wrap(async (_req, res) => {
  res.json((await pool.query("SELECT * FROM payments ORDER BY created_at DESC")).rows);
}));
app.post("/api/admin/payments/:id/approve", auth("admin"), wrap(async (req, res) => {
  const p = (await pool.query("SELECT * FROM payments WHERE id = $1", [req.params.id])).rows[0];
  if (!p) return res.status(404).json({ message: "Payment not found." });
  if (p.status !== "paid") {
    await pool.query("UPDATE payments SET status = 'paid' WHERE id = $1", [p.id]);
    if (p.user_id) await activatePlan(p.user_id, p.plan);
  }
  res.json({ ok: true });
}));
app.post("/api/admin/payments/:id/reject", auth("admin"), wrap(async (req, res) => {
  const r = await pool.query("UPDATE payments SET status = 'rejected' WHERE id = $1", [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ message: "Payment not found." });
  res.json({ ok: true });
}));

// ---- Start (after DB is ready) ----
init()
  .then(() => app.listen(PORT, () => console.log(`GOFA Shipping API running on http://localhost:${PORT}`)))
  .catch(err => { console.error("Failed to initialize database:", err); process.exit(1); });
