/* GOFA SHIPPING - front-end configuration
 * ------------------------------------------------------------------
 * Set apiBaseUrl to your backend URL to activate accounts + tracking.
 * Example: apiBaseUrl: "https://api.gofashipping.com"
 * While it is empty, the account and tracking pages run in "not
 * connected" mode and show clear setup instructions (no fake data).
 * ------------------------------------------------------------------ */
window.GOFA_CONFIG = {
  // Base URL of your API (no trailing slash). Leave "" until you have one.
  apiBaseUrl: "https://gofa-shipping-api.onrender.com",

  // ---- Contact / quote form (Web3Forms - free, 250 submissions/mo) ----
  // 1. Go to https://web3forms.com and enter gofabahamas@gmail.com to get
  //    your free Access Key (no signup needed - it emails you the key).
  // 2. Paste the key below (looks like a long UUID).
  // Submissions then email straight to gofabahamas@gmail.com.
  // Until it is set, the form falls back to opening the visitor's email app.
  web3formsAccessKey: "7432ec79-e8f5-4f8e-be03-ed65d457b047",

  // Endpoint paths your backend should expose (relative to apiBaseUrl):
  //   POST {apiBaseUrl}/api/auth/register   { name, email, password }         -> { token, user }
  //   POST {apiBaseUrl}/api/auth/login      { email, password }               -> { token, user }
  //   GET  {apiBaseUrl}/api/auth/me         (Bearer token)                    -> { user, shipments }
  //   GET  {apiBaseUrl}/api/tracking/:id                                      -> { trackingNumber, status, origin, destination, eta, events: [{ status, location, timestamp, done }] }
  endpoints: {
    register: "/api/auth/register",
    login: "/api/auth/login",
    me: "/api/auth/me",
    tracking: "/api/tracking/",
    quote: "/api/quote",
    adminLogin: "/api/admin/login",
    adminOrders: "/api/admin/orders",
    adminInvoices: "/api/admin/invoices"
  },

  // ---- Admin dashboard sign-in ----
  // NOTE: This is a front-end convenience gate only. A static site cannot
  // truly secure a password. The username is public and the password is
  // stored as a SHA-256 hash (not plain text) so it is not directly
  // readable, but a determined user could still bypass it. For real
  // security, move authentication to your backend.
  admin: {
    username: "Gofa",
    // SHA-256 hash of the admin password
    passwordHash: "3ccf707068385368ec819181fd8b35f72ea3fdfb7a036396cd0d1a782e88d5c2"
  },

  // ---- Membership billing ----
  billing: {
    // PayPal public Client ID from developer.paypal.com (the SECRET stays on the server).
    paypalClientId: "AafhQDdKnAsIxFBrf9rvbZmbYWxzj0ZAXSHTaGELXgf8ZvO12YueMDj6ABXPyRGaULFw53woxEXNAf9K",
    currency: "USD",
    // Your SunCash number customers send payment to (manual confirmation in admin).
    suncashNumber: "",
    // Monthly prices - keep in sync with the server's PRICE_* env vars.
    plans: { plus: 19.99, business: 49.99, family: 29.99 }
  }
};
