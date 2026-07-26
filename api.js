/* GOFA SHIPPING - API layer
 * Thin wrapper around fetch for auth + tracking. All calls hit the
 * backend defined in config.js. If no backend is configured, calls
 * reject with code "BACKEND_NOT_CONFIGURED" so the UI can show a
 * helpful setup message instead of failing silently.
 */
(function () {
  const CFG = window.GOFA_CONFIG || { apiBaseUrl: "", endpoints: {} };
  const TOKEN_KEY = "gofa_token";

  function base() {
    return (CFG.apiBaseUrl || "").replace(/\/+$/, "");
  }

  function notConfigured() {
    const e = new Error("Backend not connected yet.");
    e.code = "BACKEND_NOT_CONFIGURED";
    return e;
  }

  async function request(path, options = {}) {
    if (!base()) throw notConfigured();
    const token = localStorage.getItem(TOKEN_KEY);
    let res;
    try {
      res = await fetch(base() + path, {
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (networkErr) {
      const e = new Error("Could not reach the server. Check your connection and API URL.");
      e.code = "NETWORK_ERROR";
      throw e;
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) {
      const e = new Error((data && (data.message || data.error)) || ("Request failed (" + res.status + ")"));
      e.code = "HTTP_" + res.status;
      e.status = res.status;
      throw e;
    }
    return data;
  }

  const ep = CFG.endpoints || {};

  window.GofaAPI = {
    isConfigured: () => !!base(),
    getToken: () => localStorage.getItem(TOKEN_KEY),
    setToken: (t) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY),
    logout: () => localStorage.removeItem(TOKEN_KEY),

    register: (payload) => request(ep.register || "/api/auth/register", { method: "POST", body: payload }),
    login: (payload) => request(ep.login || "/api/auth/login", { method: "POST", body: payload }),
    me: () => request(ep.me || "/api/auth/me"),
    track: (trackingNumber) => request((ep.tracking || "/api/tracking/") + encodeURIComponent(trackingNumber))
  };
})();
