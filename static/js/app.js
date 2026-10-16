// SMART BASE URL RESOLVER
// - Localhost / Render / any hosting  → relative URLs (auto)
// - Capacitor (APK) / Electron / file://  → absolute production URL
// - Override anytime from console:
//     localStorage.setItem("juktoy_api_base", "https://staging.example.com")
//     (then reload)
//     localStorage.removeItem("juktoy_api_base")   ← revert
function _resolveBaseUrl() {
  try {
    const override = localStorage.getItem("juktoy_api_base");
    if (override && override.trim()) {
      return override.trim().replace(/\/$/, "");
    }
  } catch (e) { /* private mode — ignore */ }

  const proto = window.location.protocol;

  // Capacitor mobile app OR Electron desktop OR local file
  if (proto === "capacitor:" || proto === "file:") {
    // Absolute production URL required (no same-origin available)
    return localStorage.getItem("juktoy_prod_url") || "https://juktoy.onrender.com";
  }

  // Everything else (http/https) → relative URLs
  // Works on: localhost, Render, Vercel, Railway, VPS, any domain
  return "";
}
const BASE_URL = _resolveBaseUrl();
console.log("[JUKTOY] API base:", BASE_URL || "(same-origin)");
// JUKTOY — Complete JavaScript
// All features: auth, feed, profile, theme, messages

// ---------- State ----------
const state = { me: null };
// FIX: expose to window (const doesn't auto-expose like var)
if (typeof window !== "undefined") {
  window.state = state;
  window.__juktoyState = state;
}


// TOPBAR + MOBILE NAV HANDLERS

// Hook loadFeed to attach hashtag listeners after render
const _origBindPostEvents = window.bindPostEvents;
window.bindPostEvents = function() {
  _origBindPostEvents();
  attachHashtagListeners(document.getElementById("feed-list"));
};



// Change password validation
(function () {
  var btn = document.getElementById("btn-change-pw");
  if (!btn) return;
  btn.addEventListener("click", function (e) {
    var pw = document.getElementById("set-new-pw").value;
    var err = window._clientPasswordCheck(pw);
    if (err) {
      e.preventDefault();
      e.stopImmediatePropagation();
      showToast("⚠️ " + err);
    }
  }, true);
})();

// Forgot reset (reset-modal) validation
(function () {
  var btn = document.getElementById("reset-submit");
  if (!btn) return;
  btn.addEventListener("click", function (e) {
    var pw = document.getElementById("reset-new-pw").value;
    var err = window._clientPasswordCheck(pw);
    if (err) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var errEl = document.getElementById("reset-error");
      if (errEl) { errEl.textContent = err; errEl.classList.remove("hidden"); }
    }
  }, true);
})();

console.log("[S15.1] strong password check attached ✅");


// S15.3 — LOGIN HISTORY UI

(function () {
  var card = document.getElementById("login-history-card");
  if (!card) return;

  var list = document.getElementById("login-history-list");

  async function load() {
    list.innerHTML = '<p class="empty-text" style="padding:12px 0">লোড হচ্ছে...</p>';
    try {
      var rows = await window.api("/api/me/logins?limit=10");
      if (!rows.length) {
        list.innerHTML = '<p class="empty-text" style="padding:12px 0">কোনো লগইন ইতিহাস নেই</p>';
        return;
      }
      list.innerHTML = rows.map(function (r) {
        return '<div class="login-history-row">' +
          '<div class="login-history-icon ' + (r.is_new_device ? "new" : "") + '">' +
            '<i class="fa-solid ' + (r.is_new_device ? "fa-triangle-exclamation" : "fa-circle-check") + '"></i>' +
          '</div>' +
          '<div class="login-history-info">' +
            '<div class="login-history-device">' + escapeHtml(r.device_label || "Unknown") +
              (r.is_new_device ? ' <span class="login-history-new">নতুন</span>' : '') +
            '</div>' +
            '<div class="login-history-meta">' +
              escapeHtml(r.method_label) + ' • ' + escapeHtml(r.ip || "?") + ' • ' + timeAgo(r.created_at) +
            '</div>' +
          '</div>' +
        '</div>';
      }).join("");
    } catch (err) {
      list.innerHTML = '<p class="empty-text" style="padding:12px 0">লোড করা যায়নি</p>';
    }
  }

  // Load when settings opens
  // S39 — exposed for unified loader
  window._loadLoginHistory = load;
  // S39 — wrapper disabled (unified loader at end of file)

  // Clear button
  document.getElementById("btn-clear-logins").addEventListener("click", async function () {
    if (!confirm("সব লগইন ইতিহাস মুছে ফেলবেন?")) return;
    try {
      await window.api("/api/me/sessions/clear", { method: "POST" });
      showToast("🗑️ ইতিহাস মুছে ফেলা হয়েছে");
      load();
    } catch (err) { alert(err.message); }
  });

  console.log("[S15.3] login history attached ✅");
})();


// S15.4 — ACTIVE SESSIONS UI

(function () {
  var card = document.getElementById("active-sessions-card");
  if (!card) return;

  var list = document.getElementById("active-sessions-list");

  async function load() {
    list.innerHTML = '<p class="empty-text" style="padding:12px 0">লোড হচ্ছে...</p>';
    try {
      var rows = await window.api("/api/me/sessions");
      if (!rows.length) {
        list.innerHTML = '<p class="empty-text" style="padding:12px 0">কোনো সক্রিয় সেশন নেই</p>';
        return;
      }
      list.innerHTML = rows.map(function (s) {
        return '<div class="session-row' + (s.is_current ? " current" : "") + '">' +
          '<div class="session-icon">' +
            '<i class="fa-solid ' + (s.is_current ? "fa-circle-check" : "fa-desktop") + '"></i>' +
          '</div>' +
          '<div class="session-info">' +
            '<div class="session-device">' + escapeHtml(s.device_label || "Unknown") +
              (s.is_current ? ' <span class="session-current-badge">এই ডিভাইস</span>' : '') +
            '</div>' +
            '<div class="session-meta">' +
              escapeHtml(s.method_label) + ' • ' + escapeHtml(s.ip || "?") + '<br>' +
              'সর্বশেষ: ' + timeAgo(s.last_seen) +
            '</div>' +
          '</div>' +
          (s.is_current ? '' :
            '<button class="session-revoke" data-sid="' + s.id + '" title="লগআউট করুন">' +
              '<i class="fa-solid fa-xmark"></i>' +
            '</button>') +
        '</div>';
      }).join("");

      list.querySelectorAll(".session-revoke").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          if (!confirm("এই ডিভাইস থেকে লগআউট করবেন?")) return;
          try {
            await window.api("/api/me/sessions/" + btn.dataset.sid + "/revoke", { method: "POST" });
            showToast("✅ ডিভাইস থেকে লগআউট হয়েছে");
            load();
          } catch (err) { alert(err.message); }
        });
      });
    } catch (err) {
      list.innerHTML = '<p class="empty-text" style="padding:12px 0">লোড করা যায়নি</p>';
    }
  }

  // Load on settings open
  // S39 — exposed for unified loader
  window._loadSessions = load;
  // S39 — wrapper disabled (unified loader at end of file)

  // Revoke all others
  document.getElementById("btn-revoke-others").addEventListener("click", async function () {
    if (!confirm("অন্য সব ডিভাইস থেকে লগআউট করবেন?\n\nআপনার এই ডিভাইস চালু থাকবে।")) return;
    try {
      await window.api("/api/me/sessions/revoke-others", { method: "POST" });
      showToast("✅ অন্য সব ডিভাইস থেকে লগআউট হয়েছে");
      load();
    } catch (err) { alert(err.message); }
  });

  console.log("[S15.4] sessions UI attached ✅");
})();


// S15.4b — INSTANT LOGOUT ON SESSION REVOKE

(function () {
  // BroadcastChannel — same browser এর সব tabs এ message পাঠাবে
  var bc = null;
  try {
    bc = new BroadcastChannel("juktoy_session");
  } catch (e) {
    console.warn("[S15.4b] BroadcastChannel not supported");
  }

  // Listen for logout broadcast from other tabs
  if (bc) {
    bc.addEventListener("message", function (e) {
      if (e.data && e.data.type === "logout") {
        console.log("[S15.4b] Logout broadcast received");
        // Force logout — reload page
        window.location.reload();
      }
    });
  }

  // Hook into revoke actions — broadcast to other tabs
  var _origRevokeSession = null;

  // Broadcast when user clicks "revoke others"
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("#btn-revoke-others");
    if (btn && bc) {
      // Small delay so the API call completes first
      setTimeout(function () {
        try { bc.postMessage({ type: "logout", reason: "revoked-others" }); } catch (err) {}
      }, 500);
    }
  }, true);

  // Broadcast when individual session is revoked
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".session-revoke");
    if (btn && bc) {
      setTimeout(function () {
        try { bc.postMessage({ type: "logout", reason: "revoked-one" }); } catch (err) {}
      }, 500);
    }
  }, true);

  // ---- Polling for different-device revocation ----
  // Every 30 seconds, ping /api/me to check session validity
  var _pollTimer = null;
  var _pollInterval = 30000;  // 30 seconds
  var _lastPollAt = Date.now();

  function startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(function () {
      // Skip if page hidden (battery save)
      if (document.hidden) return;
      // Skip if no user (not logged in)
      if (!window.state.me) return;
      // Skip if last poll < interval
      if (Date.now() - _lastPollAt < _pollInterval - 5000) return;
      _lastPollAt = Date.now();

      fetch(BASE_URL + "/api/me", { credentials: "include" })
        .then(function (r) {
          if (r.status === 401) {
            // Session revoked
            console.log("[S15.4b] Session revoked (poll detected)");
            window.location.reload();
          }
          return r.json();
        })
        .then(function (d) {
          if (!d || !d.user) {
            console.log("[S15.4b] No user in /api/me response");
            window.location.reload();
          }
        })
        .catch(function () {
          // Network error — ignore
        });
    }, 5000);  // Check every 5s if interval elapsed
  }

  // Start polling after login
  window._enterAppHooks.push(function () {
    startPolling();
    _lastPollAt = Date.now();
  });

  // Also poll on visibility change (user returns to tab)
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && window.state.me) {
      _lastPollAt = 0;  // Force immediate check
    }
  });

  console.log("[S15.4b] instant logout attached ✅");
})();


// S15.5 — SENSITIVE ACTION VERIFICATION (frontend)
// ৬টা sensitive action-এ password + (2FA on হলে) TOTP code
// Strategy: document-capture delegation, stopImmediatePropagation
// কোনো clone নেই → original handler fire করে না → state অটুট

