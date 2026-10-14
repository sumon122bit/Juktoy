// ==================================================
// HELPERS
// ==================================================

export function _readCsrfCookie() {
  try {
    const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : "";
  } catch (e) { return ""; }
}

export async function api(url, options = {}) {
  const opts = { ...options };
  opts.credentials = "include";
  opts.headers = { "Content-Type": "application/json", ...(options.headers || {}) };

  const method = (opts.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = _readCsrfCookie();
    if (token) opts.headers["X-CSRF-Token"] = token;
  }

  // S30.14 — 30s timeout via AbortController
  // (was: infinite wait if server hangs → UI stuck on "লোড হচ্ছে...")
  var _ac = null;
  var _tid = null;
  if (typeof AbortController !== "undefined") {
    _ac = new AbortController();
    // preserve any existing signal from caller
    if (options && options.signal) {
      try {
        options.signal.addEventListener("abort", function () { _ac.abort(); });
      } catch (e) {}
    }
    opts.signal = _ac.signal;
    _tid = setTimeout(function () { try { _ac.abort(); } catch (e) {} }, 30000);
  }

  let res;
  try {
    res = await fetch(BASE_URL + url, opts);
  } catch (err) {
    if (_tid) clearTimeout(_tid);
    // AbortError → friendly message
    if (err && (err.name === "AbortError" || /abort/i.test(err.message || ""))) {
      const _toErr = new Error("সার্ভার সময়মতো সাড়া দেয়নি। আবার চেষ্টা করুন।");
      _toErr.isTimeout = true;
      throw _toErr;
    }
    throw err;
  } finally {
    if (_tid) clearTimeout(_tid);
  }

  const data = await res.json().catch(() => ({}));

  // 401 handling (unchanged)
  if (res.status === 401) {
    var _isMeCheck = (url === "/api/me");
    var _wasLoggedIn = false;
    try {
      _wasLoggedIn = !!(window.state && window.state.me);
    } catch (e) {}

    if (data && data.idle_timeout) {
      try {
        if (typeof showToast === "function") {
          showToast("⏱️ নিষ্ক্রিয়তার কারণে লগআউট হয়েছেন");
        }
      } catch (e) {}
      setTimeout(function () { window.location.reload(); }, 1500);
    } else if (!_isMeCheck && _wasLoggedIn) {
      try {
        if (typeof showToast === "function") {
          showToast(data.error || "সেশন শেষ হয়ে গেছে। আবার লগইন করুন।");
        }
      } catch (e) {}
      setTimeout(function () { window.location.reload(); }, 1500);
    }
  }

  if (!res.ok) throw new Error(data.error || "কিছু ভুল হয়েছে");
  return data;
}

export function showMessage(text, type = "") {
  const el = document.getElementById("auth-message");
  if (!el) return;
  el.textContent = text;
  el.className = "message " + type;
}

// ---------- Temporary bridge ----------
window.api = api;
window._readCsrfCookie = _readCsrfCookie;
window.showMessage = showMessage;
