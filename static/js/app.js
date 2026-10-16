// ==================================================
// SMART BASE URL RESOLVER
// - Localhost / Render / any hosting  → relative URLs (auto)
// - Capacitor (APK) / Electron / file://  → absolute production URL
// - Override anytime from console:
//     localStorage.setItem("juktoy_api_base", "https://staging.example.com")
//     (then reload)
//     localStorage.removeItem("juktoy_api_base")   ← revert
// ==================================================
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
// ==================================================
// JUKTOY — Complete JavaScript
// All features: auth, feed, profile, theme, messages
// ==================================================

// ---------- State ----------
const state = { me: null };
// FIX: expose to window (const doesn't auto-expose like var)
if (typeof window !== "undefined") {
  window.state = state;
  window.__juktoyState = state;
}


// ==================================================
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


// ==================================================
// S15.3 — LOGIN HISTORY UI
// ==================================================

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


// ==================================================
// S15.4 — ACTIVE SESSIONS UI
// ==================================================

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


// ==================================================
// S15.4b — INSTANT LOGOUT ON SESSION REVOKE
// ==================================================

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


// ==================================================
// S15.5 — SENSITIVE ACTION VERIFICATION (frontend)
// ==================================================
// ৬টা sensitive action-এ password + (2FA on হলে) TOTP code
// Strategy: document-capture delegation, stopImmediatePropagation
// কোনো clone নেই → original handler fire করে না → state অটুট
// ==================================================

async function _askSensitiveVerify(opts) {
  opts = opts || {};
  var title       = opts.title       || "নিশ্চিত করুন";
  var description = opts.description || "এই কাজটি সম্পন্ন করতে আপনার পাসওয়ার্ড দিন।";
  var submitLabel = opts.submitLabel || "নিশ্চিত করুন";
  var danger      = !!opts.danger;
  var prefill     = opts.prefillPassword || "";

  var tfaEnabled = false;
  try {
    var st = await window.api("/api/me/2fa/status");
    // S29.4 - Only TOTP gates sensitive actions.
    // Email-2FA protects LOGIN only. The backend verifier
    // (_verify_sensitive_action) checks only totp_enabled, so
    // asking for a code from email-2FA users would deadlock
    // the flow (no code is ever sent for sensitive actions).
    tfaEnabled = !!(st && st.totp_enabled);
  } catch (e) {}

  return new Promise(function (resolve) {
    var old = document.getElementById("sensitive-verify-modal");
    if (old) old.remove();

    var modal = document.createElement("div");
    modal.id = "sensitive-verify-modal";
    modal.className = "modal";
    modal.innerHTML =
      '<div class="modal-content" style="max-width:440px">' +
        '<button class="close-btn" id="sv-close" type="button">×</button>' +
        '<h2 style="margin-bottom:10px;font-size:19px;display:flex;align-items:center;gap:10px">' +
          '<i class="fa-solid ' + (danger ? "fa-triangle-exclamation" : "fa-lock") + '" ' +
            'style="color:' + (danger ? "var(--danger)" : "var(--accent)") + '"></i> ' +
          escapeHtml(title) +
        '</h2>' +
        '<p class="settings-hint" style="margin-bottom:14px">' + escapeHtml(description) + '</p>' +
        '<div class="input-group" style="margin-bottom:10px">' +
          '<i class="fa-solid fa-lock input-icon"></i>' +
          '<input type="password" id="sv-password" placeholder="পাসওয়ার্ড" autocomplete="current-password">' +
        '</div>' +
        (tfaEnabled
          ? '<div class="input-group" style="margin-bottom:10px">' +
              '<i class="fa-solid fa-shield-halved input-icon"></i>' +
              '<input type="text" id="sv-code" placeholder="2FA কোড বা backup code" ' +
                'inputmode="text" autocomplete="one-time-code">' +
            '</div>'
          : '') +
        '<p id="sv-error" class="hidden" style="color:var(--danger);font-size:13px;' +
          'margin:0 0 10px;text-align:center;font-weight:600"></p>' +
        '<div class="edit-actions">' +
          '<button class="btn-secondary" type="button" id="sv-cancel">বাতিল</button>' +
          '<button class="btn-primary' + (danger ? ' danger-btn' : '') + '" ' +
            'type="button" id="sv-submit" style="width:auto;padding:12px 24px">' +
            '<i class="fa-solid fa-check"></i> ' + escapeHtml(submitLabel) +
          '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    function close(result) { modal.remove(); resolve(result || null); }

    function showError(msg) {
      var el = document.getElementById("sv-error");
      if (el) { el.textContent = msg; el.classList.remove("hidden"); }
    }

    document.getElementById("sv-close").onclick  = function () { close(null); };
    document.getElementById("sv-cancel").onclick = function () { close(null); };
    modal.addEventListener("click", function (e) {
      if (e.target === modal) close(null);
    });

    setTimeout(function () {
      var p = document.getElementById("sv-password");
      var c = document.getElementById("sv-code");
      if (p && prefill) p.value = prefill;
      if (c) c.focus();
      else if (p) p.focus();
    }, 80);

    function submit() {
      var pwEl   = document.getElementById("sv-password");
      var codeEl = document.getElementById("sv-code");
      var pw   = pwEl   ? (pwEl.value   || "").trim() : "";
      var code = codeEl ? (codeEl.value || "").trim() : "";

      if (!pw) return showError("পাসওয়ার্ড দিন");
      if (tfaEnabled && !code) return showError("2FA কোড দিন");

      close({ password: pw, totp_code: code });
    }

    document.getElementById("sv-submit").onclick = submit;
    document.getElementById("sv-password").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });
    var codeIn = document.getElementById("sv-code");
    if (codeIn) codeIn.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });
  });
}


// --------------------------------------------------
// 1) Change password
// --------------------------------------------------
document.addEventListener("click", async function (e) {
  var btn = e.target.closest("#btn-change-pw");
  if (!btn) return;
  e.preventDefault();
  e.stopImmediatePropagation();

  var cur  = (document.getElementById("set-current-pw").value || "").trim();
  var neu  = (document.getElementById("set-new-pw").value     || "").trim();
  var conf = (document.getElementById("set-confirm-pw").value || "").trim();

  if (!cur || !neu || !conf) return showToast("সব ফিল্ড পূরণ করুন");
  if (neu.length < 8)        return showToast("নতুন পাসওয়ার্ড ৮+ অক্ষর হতে হবে");
  if (neu !== conf)          return showToast("নতুন পাসওয়ার্ড দুইবার একই লিখুন");
  if (cur === neu)           return showToast("নতুন পাসওয়ার্ড পুরোনোর মতো হতে পারে না");

  var v = await _askSensitiveVerify({
    title: "পাসওয়ার্ড পরিবর্তন",
    description: "নিশ্চিত করতে আপনার পাসওয়ার্ড দিন।",
    submitLabel: "পরিবর্তন করুন",
    prefillPassword: cur
  });
  if (!v) return;

  var old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await window.api("/api/me/password", {
      method: "POST",
      body: JSON.stringify({
        current_password: v.password,
        new_password:     neu,
        totp_code:        v.totp_code || ""
      })
    });
    ["set-current-pw", "set-new-pw", "set-confirm-pw"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
    showToast("✅ পাসওয়ার্ড পরিবর্তন হয়েছে");
  } catch (err) {
    alert((err && err.message) || "কিছু ভুল হয়েছে");
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}, true);


// --------------------------------------------------
// 2) Change username
// --------------------------------------------------
document.addEventListener("click", async function (e) {
  var btn = e.target.closest("#btn-change-uname");
  if (!btn) return;
  e.preventDefault();
  e.stopImmediatePropagation();

  var uname = (document.getElementById("set-username").value || "").trim().toLowerCase();
  if (!uname)                       return showToast("নতুন ইউজারনেম লিখুন");
  if (!/^[a-z0-9_]+$/.test(uname))  return showToast("শুধু a-z, 0-9, _ ব্যবহার করুন");
  if (window.state.me && uname === window.state.me.username)
    return showToast("এটাই আপনার বর্তমান ইউজারনেম");

  var v = await _askSensitiveVerify({
    title: "ইউজারনেম পরিবর্তন",
    description: "নিশ্চিত করতে পাসওয়ার্ড দিন।",
    submitLabel: "পরিবর্তন"
  });
  if (!v) return;

  var old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    var res = await window.api("/api/me/username", {
      method: "POST",
      body: JSON.stringify({
        username:  uname,
        password:  v.password,
        totp_code: v.totp_code || ""
      })
    });
    if (window.state.me) window.state.me.username = res.username;
    if (typeof window.refreshProfileUI === "function") window.refreshProfileUI();
    var cu = document.getElementById("set-current-uname");
    if (cu) cu.textContent = "@" + res.username;
    showToast("✅ ইউজারনেম পরিবর্তন হয়েছে");
  } catch (err) {
    alert((err && err.message) || "কিছু ভুল হয়েছে");
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}, true);


// --------------------------------------------------
// 3) Delete account
// --------------------------------------------------
document.addEventListener("click", async function (e) {
  var btn = e.target.closest("#btn-delete-account");
  if (!btn) return;
  e.preventDefault();
  e.stopImmediatePropagation();

  if (!confirm("আপনি কি সত্যিই অ্যাকাউন্ট ডিলিট করতে চান? এটি ফেরানো যাবে না।")) return;

  var v = await _askSensitiveVerify({
    title: "অ্যাকাউন্ট ডিলিট",
    description: "এই কাজ স্থায়ী। নিশ্চিত করতে পাসওয়ার্ড দিন।",
    submitLabel: "চিরতরে মুছুন",
    danger: true
  });
  if (!v) return;

  var old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await window.api("/api/me/delete-account", {
      method: "POST",
      body: JSON.stringify({
        password:  v.password,
        totp_code: v.totp_code || ""
      })
    });
    try { localStorage.clear(); } catch (er) {}
    showToast("অ্যাকাউন্ট মুছে ফেলা হয়েছে");
    setTimeout(function () { window.location.reload(); }, 1200);
    return;
  } catch (err) {
    alert((err && err.message) || "কিছু ভুল হয়েছে");
    btn.disabled = false;
    btn.innerHTML = old;
  }
}, true);


// --------------------------------------------------
// 4) Remove email
// --------------------------------------------------
document.addEventListener("click", async function (e) {
  var btn = e.target.closest("#btn-remove-email");
  if (!btn) return;
  e.preventDefault();
  e.stopImmediatePropagation();

  var v = await _askSensitiveVerify({
    title: "ইমেইল সরান",
    description: "নিশ্চিত করতে পাসওয়ার্ড দিন।",
    submitLabel: "সরান",
    danger: true
  });
  if (!v) return;

  var old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await window.api("/api/me/email/remove", {
      method: "POST",
      body: JSON.stringify({
        password:  v.password,
        totp_code: v.totp_code || ""
      })
    });
    showToast("✅ ইমেইল সরানো হয়েছে");
    window.dispatchEvent(new Event("focus"));
  } catch (err) {
    alert((err && err.message) || "কিছু ভুল হয়েছে");
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}, true);


// --------------------------------------------------
// 5) Disable 2FA
// --------------------------------------------------
document.addEventListener("click", async function (e) {
  var btn = e.target.closest("#btn-disable-2fa");
  if (!btn) return;
  e.preventDefault();
  e.stopImmediatePropagation();

  var v = await _askSensitiveVerify({
    title: "2FA নিষ্ক্রিয় করুন",
    description: "নিশ্চিত করতে পাসওয়ার্ড এবং বর্তমান 2FA কোড দিন।",
    submitLabel: "নিষ্ক্রিয় করুন",
    danger: true
  });
  if (!v) return;

  var old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await window.api("/api/me/2fa/disable", {
      method: "POST",
      body: JSON.stringify({
        password:  v.password,
        totp_code: v.totp_code || ""
      })
    });
    showToast("✅ 2FA নিষ্ক্রিয় করা হয়েছে");
    window.dispatchEvent(new Event("focus"));
  } catch (err) {
    alert((err && err.message) || "কিছু ভুল হয়েছে");
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}, true);


// --------------------------------------------------
// 6) Revoke all other sessions
// --------------------------------------------------
document.addEventListener("click", async function (e) {
  var btn = e.target.closest("#btn-revoke-others");
  if (!btn) return;
  e.preventDefault();
  e.stopImmediatePropagation();

  var v = await _askSensitiveVerify({
    title: "অন্য সব থেকে লগআউট",
    description: "সব অন্য ডিভাইস থেকে লগআউট হবে। এই ডিভাইস চালু থাকবে।",
    submitLabel: "লগআউট করুন"
  });
  if (!v) return;

  var old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await window.api("/api/me/sessions/revoke-others", {
      method: "POST",
      body: JSON.stringify({
        password:  v.password,
        totp_code: v.totp_code || ""
      })
    });
    showToast("✅ অন্য সব ডিভাইস থেকে লগআউট");
    try {
      var bc = new BroadcastChannel("juktoy_session");
      bc.postMessage({ type: "logout", reason: "revoked-others" });
      bc.close();
    } catch (er) {}
  } catch (err) {
    alert((err && err.message) || "কিছু ভুল হয়েছে");
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}, true);


console.log("[S15.5] all 6 sensitive-action overrides attached ✅");

// ==================================================
// S21.3e — _attachReelProgress (force top-level)
// Ensures loadReels() can always find this
// ==================================================
if (typeof window._attachReelProgress !== "function") {
  window._attachReelProgress = function _attachReelProgress(video, item) {
    if (!video || !item) return;
    var fill = item.querySelector(".reel-progress-fill");
    if (!fill) return;

    function update() {
      if (video.duration && isFinite(video.duration) && video.duration > 0) {
        var pct = (video.currentTime / video.duration) * 100;
        fill.style.width = pct + "%";
      }
    }

    // Avoid double-attach
    if (video.dataset.progressAttached === "1") return;
    video.dataset.progressAttached = "1";

    video.addEventListener("timeupdate", update);
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("seeked", update);
    video.addEventListener("play", update);
  };
  console.log("[S21.3e] _attachReelProgress registered");
}


// ═══════════════════════════════════════════════
// Series 3A — Voice Recorder
// ═══════════════════════════════════════════════

var _vr = {
  recorder: null,
  chunks: [],
  startAt: 0,
  timer: null,
  cancelled: false,
  stream: null,
  rawStream: null,
  actx: null,
  active: false
};

function _blobToDataURL(blob) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function _vrFormatTime(ms) {
  var s = Math.floor(ms / 1000);
  var m = Math.floor(s / 60);
  var r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
}

function _vrShowUI() {
  var el = document.getElementById("voice-recorder");
  if (!el) return;
  el.classList.remove("hidden");
  el.classList.add("show");
}

function _vrHideUI() {
  var el = document.getElementById("voice-recorder");
  if (!el) return;
  el.classList.remove("show");
  setTimeout(function () { el.classList.add("hidden"); }, 220);
  var timer = document.getElementById("vr-timer");
  if (timer) timer.textContent = "0:00";
  var hint = document.getElementById("vr-hint");
  if (hint) hint.textContent = "রেকর্ড হচ্ছে... ছেড়ে দিলে বা ✓ চাপুন";
  var cancel = document.getElementById("vr-cancel");
  if (cancel) cancel.classList.remove("armed");
  var send = document.getElementById("vr-send");
  if (send) send.classList.remove("disabled");
}

async function _vrStart() {
  if (_vr.active) return;
  if (!window.currentChatUser) return;

  console.log("[VR] secure:", window.isSecureContext,
              "| mediaDevices:", !!navigator.mediaDevices,
              "| getUserMedia:", !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
              "| MediaRecorder:", !!window.MediaRecorder,
              "| protocol:", window.location.protocol,
              "| host:", window.location.host);

  if (!window.isSecureContext) {
    showToast("⚠️ HTTP-এ mic কাজ করে না — HTTPS দরকার");
    console.error("[VR] insecure context");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast("এই ব্রাউজারে mic সাপোর্ট নেই");
    return;
  }
  if (!window.MediaRecorder) {
    showToast("এই ব্রাউজারে MediaRecorder নেই");
    return;
  }

  try {
    var rawStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      }
    });

    // === Amplify: use Web Audio gain node to boost recorded volume ===
    var stream = rawStream;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        if (!_vr.actx) _vr.actx = new AC();
        var actx = _vr.actx;
        if (actx.state === "suspended") { try { await actx.resume(); } catch (e) {} }
        var srcNode = actx.createMediaStreamSource(rawStream);
        var gainNode = actx.createGain();
        // 3.5x amplification — safe for typical smartphone mic input
        gainNode.gain.value = 3.5;
        // Compressor to prevent clipping
        var comp = actx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 12;
        comp.ratio.value = 6;
        comp.attack.value = 0.003;
        comp.release.value = 0.25;

        var dest = actx.createMediaStreamDestination();
        srcNode.connect(gainNode);
        gainNode.connect(comp);
        comp.connect(dest);
        stream = dest.stream;
        _vr.rawStream = rawStream;
      }
    } catch (gErr) {
      console.warn("[VR] gain node failed, using raw:", gErr);
      stream = rawStream;
    }

    _vr.stream = stream;
    _vr.rawStream = rawStream;
    _vr.chunks = [];
    _vr.cancelled = false;

    var mime = "audio/webm";
    if (!MediaRecorder.isTypeSupported(mime)) mime = "";
    _vr.recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128000 })
      : new MediaRecorder(stream);

    _vr.recorder.ondataavailable = function (e) {
      if (e.data && e.data.size > 0) _vr.chunks.push(e.data);
    };

    _vr.recorder.onstop = async function () {
      var duration = (Date.now() - _vr.startAt) / 1000;
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try {
        if (_vr.rawStream) _vr.rawStream.getTracks().forEach(function (t) { t.stop(); });
      } catch (e) {}
      _vr.stream = null;
      _vr.rawStream = null;
      _vr.active = false;

      if (_vr.cancelled) { _vrHideUI(); return; }
      if (duration < 0.6) {
        showToast("খুব ছোট — একটু বড় করে বলুন");
        _vrHideUI();
        return;
      }
      if (duration > 300) {
        showToast("৫ মিনিটের বেশি রেকর্ড করা যাবে না");
        _vrHideUI();
        return;
      }

      _vrHideUI();
      try {
        var blob = new Blob(_vr.chunks, { type: "audio/webm" });
        var dataUrl = await _blobToDataURL(blob);
        await _vrSend(dataUrl, duration);
      } catch (e) {
        showToast("ভয়েস পাঠানো যায়নি");
      }
    };

    _vr.recorder.start();
    _vr.active = true;
    _vr.startAt = Date.now();
    _vrShowUI();

    // Timer
    if (_vr.timer) clearInterval(_vr.timer);
    _vr.timer = setInterval(function () {
      var el = document.getElementById("vr-timer");
      if (el) el.textContent = _vrFormatTime(Date.now() - _vr.startAt);
      var el2 = document.getElementById("vr-timer");
      var dur = (Date.now() - _vr.startAt) / 1000;
      if (dur > 300) _vrStop(true);
    }, 120);

    if (navigator.vibrate) navigator.vibrate(12);
  } catch (e) {
    console.error("[VR] error name:", e.name, "| message:", e.message);
    var msg = "মাইক চালু করা যায়নি";
    if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
      msg = "মাইক অনুমতি denied — Chrome সেটিংস থেকে Allow করুন";
    } else if (e.name === "NotFoundError") {
      msg = "মাইক্রোফোন পাওয়া যায়নি";
    } else if (e.name === "NotReadableError") {
      msg = "মাইক্রোফোন অন্য অ্যাপ ব্যবহার করছে";
    } else if (e.name === "SecurityError") {
      msg = "নিরাপত্তা ত্রুটি — HTTPS দরকার";
    } else if (e.name === "AbortError") {
      msg = "রেকর্ডিং বন্ধ হয়েছে";
    } else if (e.name) {
      msg = "Mic error: " + e.name;
    }
    showToast(msg);
    _vr.active = false;
  }
}

function _vrStop(cancel) {
  if (!_vr.active) return;
  _vr.cancelled = !!cancel;
  try { _vr.recorder.stop(); } catch (e) {}
  if (_vr.timer) { clearInterval(_vr.timer); _vr.timer = null; }
  if (navigator.vibrate) navigator.vibrate(15);
}

async function _vrSend(dataUrl, duration) {
  if (!window.currentChatUser) return;
  try {
    var res = await window.api("/api/messages/" + encodeURIComponent(window.currentChatUser) + "/voice", {
      method: "POST",
      body: JSON.stringify({ audio: dataUrl, duration: duration }),
    });
    await loadChatMessages(true);
    await loadConversations();
    if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
  } catch (e) {
    alert(e.message || "ভয়েস পাঠানো যায়নি");
  }
}

// ---- Wire mic button ----
(function () {
  var btn = document.getElementById("chat-mic-btn");
  if (!btn) return;

  var startedByPress = false;
  var pressTimer = null;

  function startPress(e) {
    if (e) e.preventDefault();
    if (_vr.active) return;
    startedByPress = true;
    _vrStart();
  }
  function endPress(e) {
    if (e) e.preventDefault();
    if (!startedByPress) return;
    startedByPress = false;
    if (!_vr.active) return;

    // If cancel button armed → cancel
    var cancelBtn = document.getElementById("vr-cancel");
    if (cancelBtn && cancelBtn.classList.contains("armed")) {
      _vrStop(true);
      return;
    }

    // Auto-send after ~1.2s of recording (fast path)
    // Below that threshold, keep the overlay open so user can decide
    var heldMs = Date.now() - _vr.startAt;
    if (heldMs >= 1200) {
      _vrStop(false);
    } else {
      // Keep recording — user must explicitly tap ✓ পাঠান
      // (they can also hit ✕ বাতিল)
      var hint = document.getElementById("vr-hint");
      if (hint) hint.textContent = "✓ পাঠান চাপুন";
    }
  }

  // Touch (mobile)
  btn.addEventListener("touchstart", startPress, { passive: false });
  btn.addEventListener("touchend", endPress);
  btn.addEventListener("touchcancel", function (e) { endPress(e); });

  // Mouse (desktop)
  btn.addEventListener("mousedown", startPress);
  btn.addEventListener("mouseup", endPress);
  btn.addEventListener("mouseleave", function (e) {
    if (startedByPress) endPress(e);
  });
})();

// ---- Send button ----
(function () {
  var sb = document.getElementById("vr-send");
  if (!sb) return;
  sb.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    _vrStop(false);   // stop & send
  });
  // long-press safe (no repeat)
  sb.addEventListener("mousedown", function (e) { e.preventDefault(); });
})();

// ---- Cancel button ----
(function () {
  var cb = document.getElementById("vr-cancel");
  if (!cb) return;
  cb.addEventListener("touchstart", function (e) {
    e.preventDefault();
    cb.classList.add("armed");
  }, { passive: false });
  cb.addEventListener("touchend", function (e) {
    e.preventDefault();
    _vrStop(true);
  });
  cb.addEventListener("mouseenter", function () { cb.classList.add("armed"); });
  cb.addEventListener("mouseleave", function () { cb.classList.remove("armed"); });
  cb.addEventListener("click", function (e) {
    e.preventDefault();
    _vrStop(true);
  });
})();

// ---- Voice player (delegated) ----
document.addEventListener("click", function (e) {
  var playBtn = e.target.closest(".cv-play");
  if (!playBtn) return;
  e.preventDefault();
  e.stopPropagation();
  var wrap = playBtn.closest(".chat-voice");
  if (!wrap) return;
  var src = wrap.dataset.src;
  if (!src) return;
  var isPlaying = wrap.classList.contains("playing");

  // Stop any other playing voice
  document.querySelectorAll(".chat-voice.playing").forEach(function (v) {
    if (v !== wrap) {
      v.classList.remove("playing");
      var b = v.querySelector(".cv-play i");
      if (b) b.className = "fa-solid fa-play";
      if (v._audio) { try { v._audio.pause(); } catch (err) {} }
    }
  });

  if (!wrap._audio) {
    wrap._audio = new Audio(src);
    // Player-side boost: use Web Audio to amplify beyond 100%
    try {
      var AC2 = window.AudioContext || window.webkitAudioContext;
      if (AC2) {
        if (!window._vrPlayCtx) window._vrPlayCtx = new AC2();
        var pctx = window._vrPlayCtx;
        if (pctx.state === "suspended") { try { pctx.resume(); } catch (e) {} }
        var psrc = pctx.createMediaElementSource(wrap._audio);
        var pgain = pctx.createGain();
        var pcomp = pctx.createDynamicsCompressor();
        pgain.gain.value = 2.2;
        pcomp.threshold.value = -12;
        pcomp.knee.value = 10;
        pcomp.ratio.value = 4;
        pcomp.attack.value = 0.003;
        pcomp.release.value = 0.25;
        psrc.connect(pgain);
        pgain.connect(pcomp);
        pcomp.connect(pctx.destination);
        wrap._audio._pctx = pctx;
        wrap._audio._psrc = psrc;
      }
    } catch (gErr) {
      console.warn("[PLAY] gain boost failed:", gErr);
    }
    wrap._audio.addEventListener("ended", function () {
      wrap.classList.remove("playing");
      var bi = wrap.querySelector(".cv-play i");
      if (bi) bi.className = "fa-solid fa-play";
    });
    wrap._audio.addEventListener("timeupdate", function () {
      if (!wrap._audio.duration) return;
      var pct = (wrap._audio.currentTime / wrap._audio.duration) * 100;
      wrap.style.setProperty("--cv-progress", pct + "%");
    });
  }

  if (isPlaying) {
    try { wrap._audio.pause(); } catch (err) {}
    wrap.classList.remove("playing");
    var i2 = wrap.querySelector(".cv-play i");
    if (i2) i2.className = "fa-solid fa-play";
  } else {
    try {
      wrap._audio.currentTime = 0;
      wrap._audio.play();
      wrap.classList.add("playing");
      var i3 = wrap.querySelector(".cv-play i");
      if (i3) i3.className = "fa-solid fa-pause";
    } catch (err) {
      showToast("বাজানো যায়নি");
    }
  }
}, true);


// ═══════════════════════════════════════════════
// Series 3B — Chat Theme / Nickname / Wallpaper
// ═══════════════════════════════════════════════

var CHAT_THEMES = {
  default:   { label: "Coral",     out: "linear-gradient(135deg, #F05555 0%, #E14B4B 100%)", in: "#ffffff", bg: "#FDF6F3", dot: "rgba(255,107,107,0.09)", swatch: "linear-gradient(135deg, #FF6B6B, #F43F5E)" },
  emerald:   { label: "Emerald",   out: "linear-gradient(135deg, #10B981 0%, #059669 100%)", in: "#ffffff", bg: "#F0FDF4", dot: "rgba(16,185,129,0.10)", swatch: "linear-gradient(135deg, #10B981, #047857)" },
  ocean:     { label: "Ocean",     out: "linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%)", in: "#ffffff", bg: "#F0F9FF", dot: "rgba(14,165,233,0.10)", swatch: "linear-gradient(135deg, #0EA5E9, #0369A1)" },
  sunset:    { label: "Sunset",    out: "linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)", in: "#ffffff", bg: "#FFFBEB", dot: "rgba(245,158,11,0.10)", swatch: "linear-gradient(135deg, #F59E0B, #EA580C)" },
  royal:     { label: "Royal",     out: "linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)", in: "#ffffff", bg: "#F5F3FF", dot: "rgba(139,92,246,0.10)", swatch: "linear-gradient(135deg, #8B5CF6, #6D28D9)" },
  mono:      { label: "Mono",      out: "linear-gradient(135deg, #4B5563 0%, #1F2937 100%)", in: "#ffffff", bg: "#F9FAFB", dot: "rgba(75,85,99,0.10)",   swatch: "linear-gradient(135deg, #6B7280, #1F2937)" },
  instagram: { label: "Instagram", out: "linear-gradient(135deg, #833AB4 0%, #E1306C 50%, #F77737 100%)", in: "#ffffff", bg: "#FDF8FF", dot: "rgba(131,58,180,0.10)", swatch: "linear-gradient(135deg, #833AB4, #E1306C, #F77737)" },
  linear:    { label: "Linear",    out: "linear-gradient(135deg, #5E6AD2 0%, #4F46E5 100%)", in: "#ffffff", bg: "#F5F6FA", dot: "rgba(94,106,210,0.10)", swatch: "linear-gradient(135deg, #5E6AD2, #4F46E5)" },
  notion:    { label: "Notion",    out: "linear-gradient(135deg, #4F4A47 0%, #2F2B28 100%)", in: "#ffffff", bg: "#FBF9F5", dot: "rgba(79,74,71,0.10)",   swatch: "linear-gradient(135deg, #6B645F, #2F2B28)" },
  teal:      { label: "Teal",      out: "linear-gradient(135deg, #14B8A6 0%, #0D9488 100%)", in: "#ffffff", bg: "#F0FDFA", dot: "rgba(20,184,166,0.10)", swatch: "linear-gradient(135deg, #14B8A6, #0D9488)" },
  vercel:    { label: "Vercel",    out: "linear-gradient(135deg, #262626 0%, #000000 100%)", in: "#ffffff", bg: "#FAFAFA", dot: "rgba(0,0,0,0.08)",     swatch: "linear-gradient(135deg, #333333, #000000)" }
};

function _applyChatTheme(themeKey) {
  var cw = document.getElementById("chat-window");
  if (!cw) return;
  var t = CHAT_THEMES[themeKey] || CHAT_THEMES.default;
  cw.style.setProperty("--chat-out-bg", t.out);
  cw.style.setProperty("--chat-in-bg", t.in);
  cw.style.setProperty("--chat-bg", t.bg);
  cw.style.setProperty("--chat-dot", t.dot);
  cw.setAttribute("data-chat-theme", themeKey || "default");
}

function _applyWallpaper(wp) {
  var cw = document.getElementById("chat-window");
  if (!cw) return;

  // Clear overrides
  cw.style.removeProperty("--chat-wallpaper-img");
  cw.style.removeProperty("--chat-wallpaper-size");
  cw.style.removeProperty("--chat-wallpaper-pos");
  cw.style.removeProperty("--chat-wallpaper-color");

  if (!wp || wp === "default") return;

  if (wp.indexOf("solid:") === 0) {
    cw.style.setProperty("--chat-wallpaper-color", wp.slice(6));
    cw.style.setProperty("--chat-wallpaper-img", "none");
    cw.style.setProperty("--chat-wallpaper-size", "auto");
    cw.style.setProperty("--chat-wallpaper-pos", "0 0");
  } else if (wp.indexOf("gradient:") === 0) {
    var parts = wp.slice(9).split("|");
    var a = parts[0] || "#FF6B6B";
    var b = parts[1] || "#F43F5E";
    cw.style.setProperty("--chat-wallpaper-img", "linear-gradient(135deg, " + a + ", " + b + ")");
    cw.style.setProperty("--chat-wallpaper-size", "cover");
    cw.style.setProperty("--chat-wallpaper-pos", "center");
  } else if (wp.indexOf("image:") === 0) {
    cw.style.setProperty("--chat-wallpaper-img", "url('" + wp.slice(6) + "')");
    cw.style.setProperty("--chat-wallpaper-size", "cover");
    cw.style.setProperty("--chat-wallpaper-pos", "center");
  }
}

function _applyChatPrefs(username) {
  if (!username) return;
  // S29.5 - read from cache (fetches once, reuses for ~chat lifetime)
  _getChatSettings(username).then(function (st) {
    if (!st) return;
    _applyChatTheme(st.theme || "default");
    _applyWallpaper(st.wallpaper || "default");
  });
}

function _openChatThemePicker(username) {
  var old = document.getElementById("chat-theme-modal");
  if (old) old.remove();

  var cw = document.getElementById("chat-window");
  var currentTheme = cw ? (cw.getAttribute("data-chat-theme") || "default") : "default";

  var html = "";
  var keys = Object.keys(CHAT_THEMES);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var t = CHAT_THEMES[k];
    var active = (k === currentTheme) ? " active" : "";
    html += '<button type="button" class="ctm-swatch' + active + '" data-theme="' + k + '">';
    html += '<span class="ctm-circle" style="background:' + t.swatch + '"></span>';
    html += '<span class="ctm-label">' + t.label + '</span>';
    html += '</button>';
  }

  var modal = document.createElement("div");
  modal.id = "chat-theme-modal";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML =
    '<div class="modal-content ctm-content">' +
      '<button class="close-btn" id="ctm-close" type="button">\u00d7</button>' +
      '<h3 class="ctm-title">\u099a\u09cd\u09af\u09be\u099f \u09a5\u09bf\u09ae</h3>' +
      '<p class="ctm-sub">\u09aa\u09cd\u09b0\u09a4\u09bf\u099f\u09bf \u099a\u09cd\u09af\u09be\u099f\u09c7\u09b0 \u099c\u09a8\u09cd\u09af \u0986\u09b2\u09be\u09a6\u09be \u09b0\u0999</p>' +
      '<div class="ctm-grid">' + html + '</div>' +
      '<div class="ctm-preview">' +
        '<div class="ctm-preview-row out"><div class="ctm-preview-bubble" id="ctm-prev-out">\u0986\u09ae\u09bf \u09ad\u09be\u09b2\u09cb \u0986\u099b\u09bf</div></div>' +
        '<div class="ctm-preview-row in"><div class="ctm-preview-bubble" id="ctm-prev-in">\u09a4\u09c1\u09ae\u09bf \u0995\u09c7\u09ae\u09a8 \u0986\u099b\u09cb?</div></div>' +
      '</div>' +
      '<div class="edit-actions" style="margin-top:16px">' +
        '<button class="btn-secondary" id="ctm-cancel">\u09ac\u09be\u09a4\u09bf\u09b2</button>' +
        '<button class="btn-primary" id="ctm-save" style="width:auto;padding:12px 28px"><i class="fa-solid fa-check"></i> \u09b8\u09c7\u09ad</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var selected = currentTheme;
  function updatePreview() {
    var t = CHAT_THEMES[selected] || CHAT_THEMES.default;
    var pOut = document.getElementById("ctm-prev-out");
    var pIn = document.getElementById("ctm-prev-in");
    if (pOut) { pOut.style.background = t.out; pOut.style.color = "#fff"; }
    if (pIn) { pIn.style.background = t.in; pIn.style.color = "#1A0F0E"; }
    var sws = modal.querySelectorAll(".ctm-swatch");
    for (var i = 0; i < sws.length; i++) {
      sws[i].classList.toggle("active", sws[i].dataset.theme === selected);
    }
  }
  var swatches = modal.querySelectorAll(".ctm-swatch");
  for (var i = 0; i < swatches.length; i++) {
    swatches[i].addEventListener("click", function () {
      selected = this.dataset.theme;
      updatePreview();
    });
  }
  function close() { modal.remove(); }
  document.getElementById("ctm-close").addEventListener("click", close);
  document.getElementById("ctm-cancel").addEventListener("click", close);
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  document.getElementById("ctm-save").addEventListener("click", async function () {
    try {
      var cur = await window.api("/api/chats/" + encodeURIComponent(username) + "/settings");
      await window.api("/api/chats/" + encodeURIComponent(username) + "/settings", {
        method: "POST",
        body: JSON.stringify({
          pinned: cur.pinned,
          muted: cur.muted,
          theme: selected,
          nickname: cur.nickname || "",
          wallpaper: cur.wallpaper || "default",
          nickname_public: cur.nickname_public || false
        })
      });
      _invalidateChatSettings(username);   // S29.5
      _applyChatTheme(selected);
      close();
      showToast("\u09a5\u09bf\u09ae \u09b8\u09c7\u09ad \u09b9\u09df\u09c7\u099b\u09c7");
    } catch (e) { alert(e.message); }
  });
  updatePreview();
}

async function _openNicknameModal(username) {
  var old = document.getElementById("chat-nickname-modal");
  if (old) old.remove();

  var cur = { nickname: "" };
  try { cur = await window.api("/api/chats/" + encodeURIComponent(username) + "/settings"); } catch (e) {}

  var modal = document.createElement("div");
  modal.id = "chat-nickname-modal";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML =
    '<div class="modal-content" style="max-width:420px">' +
      '<button class="close-btn" id="cnm-close" type="button">\u00d7</button>' +
      '<h3 style="margin-bottom:6px;font-size:19px">\ud83c\udff7\ufe0f \u09a8\u09bf\u0995\u09a8\u09c7\u09ae</h3>' +
      '<p class="settings-hint" style="margin-bottom:16px">' +
        '\u09b8\u09be\u09ae\u09a8\u09c7\u09b0 \u099c\u09a8\u0995\u09c7 \u0986\u09aa\u09a8\u09be\u09b0 \u09ae\u09a8\u09ae\u09a4\u09cb \u09a8\u09be\u09ae\u09c7 \u09a1\u09be\u0995\u09c1\u09a8\u0964 \u09a8\u09bf\u0995\u09a8\u09c7\u09ae \u09b8\u09c7\u099f \u0995\u09b0\u09b2\u09c7 \u099a\u09cd\u09af\u09be\u099f\u09c7 \u09a6\u09c1\u099c\u09a8\u0987 \u099c\u09be\u09a8\u09a4\u09c7 \u09aa\u09be\u09b0\u09ac\u09c7\u0964' +
      '</p>' +
      '<div class="cnm-box">' +
        '<div class="cnm-box-title">' +
          '<i class="fa-solid fa-user-friends"></i> \u09b8\u09be\u09ae\u09a8\u09c7\u09b0 \u099c\u09a8\u09c7\u09b0 \u09a8\u09bf\u0995\u09a8\u09c7\u09ae' +
        '</div>' +
        '<div class="input-group" style="margin-bottom:0;margin-top:8px">' +
          '<i class="fa-regular fa-id-badge input-icon"></i>' +
          '<input type="text" id="cnm-them" placeholder="\u09af\u09c7\u09ae\u09a8: Boss, \u09b8\u09c1\u09a8\u09cd\u09a6\u09b0\u09c0..." maxlength="40" value="' + escapeHtml(cur.nickname || "") + '">' +
        '</div>' +
      '</div>' +
      '<div class="edit-actions" style="margin-top:18px">' +
        '<button class="btn-secondary" id="cnm-clear">\u09b8\u09b0\u09be\u09a8</button>' +
        '<button class="btn-primary" id="cnm-save" style="width:auto;padding:12px 28px"><i class="fa-solid fa-check"></i> \u09b8\u09c7\u09ad</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var inpThem = document.getElementById("cnm-them");
  setTimeout(function () { if (inpThem) inpThem.focus(); }, 80);

  function close() { modal.remove(); }
  document.getElementById("cnm-close").addEventListener("click", close);
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  async function saveVal(val) {
    try {
      var st = await window.api("/api/chats/" + encodeURIComponent(username) + "/settings");
      await window.api("/api/chats/" + encodeURIComponent(username) + "/settings", {
        method: "POST",
        body: JSON.stringify({
          pinned: st.pinned,
          muted: st.muted,
          theme: st.theme || "default",
          nickname: val,
          my_nickname: st.my_nickname || "",
          wallpaper: st.wallpaper || "default",
          nickname_public: true
        })
      });
      _invalidateChatSettings(username);   // S29.5
      close();
      showToast(val ? "\u09a8\u09bf\u0995\u09a8\u09c7\u09ae \u09b8\u09c7\u09ad \u09b9\u09df\u09c7\u099b\u09c7" : "\u09a8\u09bf\u0995\u09a8\u09c7\u09ae \u09b8\u09b0\u09be\u09a8\u09cb \u09b9\u09df\u09c7\u099b\u09c7");
      await loadConversations();
      if (window.currentChatUser === username) await loadChatMessages(true);
    } catch (e) { alert(e.message); }
  }

  document.getElementById("cnm-save").addEventListener("click", function () {
    saveVal((inpThem.value || "").trim());
  });
  document.getElementById("cnm-clear").addEventListener("click", function () {
    inpThem.value = "";
    saveVal("");
  });
  inpThem.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); saveVal((inpThem.value || "").trim()); }
  });
}

function _openWallpaperPicker(username) {
  var old = document.getElementById("chat-wallpaper-modal");
  if (old) old.remove();

  var presets = [
    { id: "default", label: "\u09a1\u09bf\u09ab\u09b2\u09cd\u099f", bg: "#FDF6F3" },
    { id: "solid:#FFF7ED", label: "Cream", bg: "#FFF7ED" },
    { id: "solid:#F0F9FF", label: "Sky", bg: "#F0F9FF" },
    { id: "solid:#F0FDF4", label: "Mint", bg: "#F0FDF4" },
    { id: "solid:#FDF4FF", label: "Pink", bg: "#FDF4FF" },
    { id: "solid:#F9FAFB", label: "Gray", bg: "#F9FAFB" },
    { id: "gradient:#FFE4E6|#FECDD3", label: "Rose", bg: "linear-gradient(135deg, #FFE4E6, #FECDD3)" },
    { id: "gradient:#DBEAFE|#BFDBFE", label: "Blue", bg: "linear-gradient(135deg, #DBEAFE, #BFDBFE)" },
    { id: "gradient:#D1FAE5|#A7F3D0", label: "Emerald", bg: "linear-gradient(135deg, #D1FAE5, #A7F3D0)" },
    { id: "gradient:#FEF3C7|#FDE68A", label: "Amber", bg: "linear-gradient(135deg, #FEF3C7, #FDE68A)" },
    { id: "gradient:#EDE9FE|#DDD6FE", label: "Violet", bg: "linear-gradient(135deg, #EDE9FE, #DDD6FE)" },
    { id: "gradient:#CFFAFE|#A5F3FC", label: "Cyan", bg: "linear-gradient(135deg, #CFFAFE, #A5F3FC)" }
  ];

  var gridHtml = "";
  for (var i = 0; i < presets.length; i++) {
    var p = presets[i];
    gridHtml += '<button type="button" class="cwm-swatch" data-wp="' + p.id + '">';
    gridHtml += '<span class="cwm-circle" style="background:' + p.bg + '"></span>';
    gridHtml += '<span class="cwm-label">' + p.label + '</span>';
    gridHtml += '</button>';
  }

  var modal = document.createElement("div");
  modal.id = "chat-wallpaper-modal";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML =
    '<div class="modal-content ctm-content">' +
      '<button class="close-btn" id="cwm-close" type="button">\u00d7</button>' +
      '<h3 class="ctm-title">\u0993\u09df\u09be\u09b2\u09aa\u09c7\u09aa\u09be\u09b0</h3>' +
      '<p class="ctm-sub">\u099a\u09cd\u09af\u09be\u099f \u09ac\u09cd\u09af\u09be\u0995\u0997\u09cd\u09b0\u09be\u0989\u09a8\u09cd\u09a1</p>' +
      '<div class="cwm-grid">' + gridHtml + '</div>' +
      '<div class="edit-actions" style="margin-top:16px">' +
        '<button class="btn-secondary" id="cwm-cancel">\u09ac\u09be\u09a4\u09bf\u09b2</button>' +
        '<button class="btn-primary" id="cwm-save" style="width:auto;padding:12px 28px"><i class="fa-solid fa-check"></i> \u09b8\u09c7\u09ad</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var selected = "default";
  function mark() {
    var sws = modal.querySelectorAll(".cwm-swatch");
    for (var i = 0; i < sws.length; i++) {
      sws[i].classList.toggle("active", sws[i].dataset.wp === selected);
    }
  }
  var swatches = modal.querySelectorAll(".cwm-swatch");
  for (var i = 0; i < swatches.length; i++) {
    swatches[i].addEventListener("click", function () {
      selected = this.dataset.wp;
      mark();
      _applyWallpaper(selected);
    });
  }
  function close() { modal.remove(); }
  document.getElementById("cwm-close").addEventListener("click", close);
  document.getElementById("cwm-cancel").addEventListener("click", function () {
    _applyChatPrefs(username); close();
  });
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  document.getElementById("cwm-save").addEventListener("click", async function () {
    try {
      var st = await window.api("/api/chats/" + encodeURIComponent(username) + "/settings");
      await window.api("/api/chats/" + encodeURIComponent(username) + "/settings", {
        method: "POST",
        body: JSON.stringify({
          pinned: st.pinned,
          muted: st.muted,
          theme: st.theme || "default",
          nickname: st.nickname || "",
          wallpaper: selected,
          nickname_public: st.nickname_public || false
        })
      });
      _invalidateChatSettings(username);   // S29.5
      close();
      showToast("\u0993\u09df\u09be\u09b2\u09aa\u09c7\u09aa\u09be\u09b0 \u09b8\u09c7\u09ad");
    } catch (e) { alert(e.message); }
  });
  mark();
}


// ═══════════════════════════════════════════════
// Series 3C — Edit message + delete options
// ═══════════════════════════════════════════════

function _openEditMessageModal(msgId, msgEl, currentText) {
  var old = document.getElementById("edit-msg-modal");
  if (old) old.remove();

  var modal = document.createElement("div");
  modal.id = "edit-msg-modal";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML =
    '<div class="modal-content" style="max-width:480px">' +
      '<button class="close-btn" id="emm-close" type="button">\u00d7</button>' +
      '<h3 style="margin-bottom:8px;font-size:19px">\u270f\ufe0f \u09ae\u09c7\u09b8\u09c7\u099c \u098f\u09a1\u09bf\u099f</h3>' +
      '<p class="settings-hint" style="margin-bottom:14px">\u09e7\u09eb \u09ae\u09bf\u09a8\u09bf\u099f\u09c7\u09b0 \u09ae\u09a7\u09cd\u09af\u09c7 \u098f\u09a1\u09bf\u099f \u0995\u09b0\u09be \u09af\u09be\u09ac\u09c7\u0964</p>' +
      '<textarea id="emm-input" class="edit-bio-input" maxlength="5000" style="min-height:100px">' + escapeHtml(currentText || "") + '</textarea>' +
      '<div class="edit-actions">' +
        '<button class="btn-secondary" id="emm-cancel">\u09ac\u09be\u09a4\u09bf\u09b2</button>' +
        '<button class="btn-primary" id="emm-save" style="width:auto;padding:12px 28px"><i class="fa-solid fa-check"></i> \u09b8\u09c7\u09ad</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var ta = document.getElementById("emm-input");
  setTimeout(function () {
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }, 80);

  function close() { modal.remove(); }
  document.getElementById("emm-close").addEventListener("click", close);
  document.getElementById("emm-cancel").addEventListener("click", close);
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  document.getElementById("emm-save").addEventListener("click", async function () {
    var val = (ta.value || "").trim();
    if (!val) return showToast("\u0996\u09be\u09b2\u09bf \u09b9\u09ac\u09c7 \u09a8\u09be");
    try {
      var res = await window.api("/api/messages/" + msgId, {
        method: "PATCH",
        body: JSON.stringify({ content: val }),
      });
      if (msgEl) {
        var textEl = msgEl.querySelector(".chat-msg-text");
        if (textEl) textEl.textContent = res.content;
        if (!msgEl.querySelector(".chat-msg-edited")) {
          var em = document.createElement("span");
          em.className = "chat-msg-edited";
          em.textContent = "(\u09b8\u09ae\u09cd\u09aa\u09be\u09a6\u09bf\u09a4)";
          var timeEl = msgEl.querySelector(".chat-msg-time");
          if (timeEl) timeEl.parentNode.insertBefore(em, timeEl);
          else msgEl.appendChild(em);
        }
      }
      close();
      showToast("\u270f\ufe0f \u098f\u09a1\u09bf\u099f \u09b8\u09c7\u09ad \u09b9\u09df\u09c7\u099b\u09c7");
    } catch (e) { alert(e.message); }
  });

  ta.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      document.getElementById("emm-save").click();
    }
  });
}

function _openDeleteMessageSheet(msgId, msgEl, isMine) {
  var old = document.getElementById("del-msg-sheet");
  if (old) old.remove();

  var sheet = document.createElement("div");
  sheet.id = "del-msg-sheet";
  sheet.className = "chat-msg-menu-root";
  sheet.innerHTML =
    '<div class="cmm-backdrop"></div>' +
    '<div class="dms-panel">' +
      '<div class="cms-handle"></div>' +
      '<button class="dms-item" data-act="del-me">' +
        '<span class="dms-icon"><i class="fa-solid fa-eye-slash"></i></span>' +
        '<span class="dms-info"><b>\u0986\u09ae\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c1\u09a8</b>' +
        '<small>\u09b6\u09c1\u09a7\u09c1 \u0986\u09aa\u09a8\u09bf \u09a6\u09c7\u0996\u09ac\u09c7\u09a8 \u09a8\u09be</small></span>' +
      '</button>' +
      (isMine
        ? '<button class="dms-item dms-danger" data-act="del-all">' +
            '<span class="dms-icon"><i class="fa-regular fa-trash-can"></i></span>' +
            '<span class="dms-info"><b>\u09b8\u09ac\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c1\u09a8</b>' +
            '<small>\u09a6\u09c1\u099c\u09a8\u09c7\u09b0 \u0995\u09be\u099b \u09a5\u09c7\u0995\u09c7 \u09ae\u09c1\u099b\u09c7 \u09af\u09be\u09ac\u09c7</small></span>' +
          '</button>'
        : '') +
      '<button class="dms-item dms-cancel" data-act="cancel">\u09ac\u09be\u09a4\u09bf\u09b2</button>' +
    '</div>';
  document.body.appendChild(sheet);
  requestAnimationFrame(function () { sheet.classList.add("show"); });

  function close() {
    sheet.classList.remove("show");
    setTimeout(function () { sheet.remove(); }, 260);
  }
  sheet.querySelector(".cmm-backdrop").addEventListener("click", close);

  sheet.querySelectorAll(".dms-item").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var act = btn.dataset.act;
      if (act === "cancel") { close(); return; }
      close();
      try {
        if (act === "del-me") {
          await window.api("/api/messages/" + msgId + "/delete-for-me", { method: "POST" });
          if (msgEl) msgEl.remove();
          showToast("\u0986\u09ae\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09be \u09b9\u09df\u09c7\u099b\u09c7");
        } else if (act === "del-all") {
          await window.api("/api/messages/" + msgId + "/delete-for-everyone", { method: "POST" });
          await loadChatMessages(true);
          showToast("\u09b8\u09ac\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09be \u09b9\u09df\u09c7\u099b\u09c7");
        }
      } catch (e) { alert(e.message); }
    });
  });
}
window._openDeleteMessageSheet = _openDeleteMessageSheet;


// ═══════════════════════════════════════════════
// Series 4B — Chat header call buttons
// ═══════════════════════════════════════════════
(function () {
  if (window.__s4b_call_wire) return;
  window.__s4b_call_wire = true;

  document.addEventListener("click", function (e) {
    var callBtn = e.target.closest("#chat-call-btn");
    var videoBtn = e.target.closest("#chat-video-btn");
    if (!callBtn && !videoBtn) return;

    e.preventDefault();
    e.stopPropagation();

    var uname = (typeof window.currentChatUser !== "undefined") ? window.currentChatUser : null;
    if (!uname) {
      if (typeof showToast === "function") showToast("চ্যাট খুলুন আগে");
      return;
    }

    if (callBtn && typeof window.startVoiceCall === "function") {
      window.startVoiceCall(uname);
    } else if (videoBtn && typeof window.startVideoCall === "function") {
      window.startVideoCall(uname);
    } else {
      if (typeof showToast === "function") showToast("কল মডিউল লোড হচ্ছে...");
    }
  }, true);

  console.log("[S4B] call header wire ✅");
})();


// ═══════════════════════════════════════════════
// SERIES 4B — Call History Page
// ═══════════════════════════════════════════════
(function () {
  if (window.__s4b_call_history) return;
  window.__s4b_call_history = true;

  var _allCalls = [];
  var _callFilter = "all";

  function _t(txt) { return String(txt == null ? "" : txt); }
  function _esc(s) {
    return _t(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                 .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function _init(name) {
    return (_t(name).trim().charAt(0) || "?").toUpperCase();
  }

  function _timeShort(iso) {
    if (!iso) return "";
    try {
      if (typeof shortTime === "function") return shortTime(iso);
    } catch (e) {}
    var d = new Date(String(iso).replace(" ", "T") + "Z");
    return d.toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" });
  }

  function _statusIcon(c) {
    if (c.is_missed) return '<i class="fa-solid fa-phone-slash" style="color:#EF4444"></i>';
    if (c.outgoing) return '<i class="fa-solid fa-arrow-up-right-from-square" style="color:#10B981"></i>';
    return '<i class="fa-solid fa-arrow-down" style="color:#3B82F6"></i>';
  }

  function _statusLabel(c) {
    if (c.status === "missed") return "মিসড";
    if (c.status === "declined") return "ডিক্লাইন";
    if (c.outgoing) return "বহির্গামী";
    return "আগত";
  }

  function _renderList() {
    var list = document.getElementById("calls-list");
    if (!list) return;

    var filtered = _allCalls;
    if (_callFilter === "missed") {
      filtered = _allCalls.filter(function (c) { return c.is_missed; });
    } else if (_callFilter === "outgoing") {
      filtered = _allCalls.filter(function (c) { return c.outgoing; });
    } else if (_callFilter === "incoming") {
      filtered = _allCalls.filter(function (c) { return !c.outgoing; });
    }

    if (!filtered.length) {
      list.innerHTML =
        '<div class="explore-empty" style="padding:60px 20px">' +
          '<i class="fa-solid fa-phone" style="font-size:52px;opacity:0.3"></i>' +
          '<p>কোনো কল নেই</p>' +
        '</div>';
      return;
    }

    list.innerHTML = filtered.map(function (c) {
      var isOut = c.outgoing;
      var other = isOut ? c.callee : c.caller;
      var av = other.profile_pic
        ? '<img src="' + _esc(other.profile_pic) + '" alt="" loading="lazy" decoding="async">'
        : _init(other.display_name);

      var missCls = c.is_missed ? "missed" : "";

      return (
        '<div class="call-log-item" data-username="' + _esc(other.username) + '">' +
          '<div class="call-log-avatar">' + av + '</div>' +
          '<div class="call-log-info">' +
            '<div class="call-log-name ' + missCls + '">' +
              _esc(other.display_name) + ' ' +
              _statusIcon(c) + ' <small style="color:var(--muted);font-weight:600">' +
              _statusLabel(c) + '</small>' +
            '</div>' +
            '<div class="call-log-meta">' + _timeShort(c.created_at) + ' · ' +
              (c.kind === "video" ? "ভিডিও" : "অডিও") +
            '</div>' +
          '</div>' +
          '<button type="button" class="call-log-btn" data-act="voice" data-username="' + _esc(other.username) + '" title="অডিও কল">' +
            '<i class="fa-solid fa-phone"></i>' +
          '</button>' +
          '<button type="button" class="call-log-btn" data-act="video" data-username="' + _esc(other.username) + '" title="ভিডিও কল" style="margin-left:6px">' +
            '<i class="fa-solid fa-video"></i>' +
          '</button>' +
        '</div>'
      );
    }).join("");

    // Wire call buttons
    list.querySelectorAll(".call-log-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var u = btn.dataset.username;
        var act = btn.dataset.act;
        if (!u) return;
        if (act === "video") {
          if (typeof window.startVideoCall === "function") window.startVideoCall(u);
          else alert("কল মডিউল লোড হয়নি");
        } else {
          if (typeof window.startVoiceCall === "function") window.startVoiceCall(u);
          else alert("কল মডিউল লোড হয়নি");
        }
      });
    });

    // Tap row → open profile
    list.querySelectorAll(".call-log-item").forEach(function (row) {
      row.addEventListener("click", function (e) {
        if (e.target.closest(".call-log-btn")) return;
        var u = row.dataset.username;
        if (u && typeof window.openProfile === "function") window.openProfile(u);
      });
    });
  }

  function _renderTabs() {
    var tabs = document.getElementById("call-tabs");
    if (!tabs) return;
    tabs.querySelectorAll(".call-tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.ctab === _callFilter);
    });
  }

  window._openCallHistoryPage = async function () {
    var page = document.getElementById("call-history-page");
    if (!page) return;
    page.classList.remove("hidden");
    _callFilter = "all";
    _renderTabs();

    var list = document.getElementById("calls-list");
    if (list) list.innerHTML = '<div class="explore-empty" style="padding:40px"><p>লোড হচ্ছে...</p></div>';

    try {
      var data = await window.api("/api/calls/history?limit=100");
      _allCalls = Array.isArray(data) ? data : [];
      _renderList();
    } catch (e) {
      if (list) list.innerHTML = '<div class="explore-empty"><p>লোড করা যায়নি: ' + _esc(e.message) + '</p></div>';
    }
  };

  window._closeCallHistoryPage = function () {
    var page = document.getElementById("call-history-page");
    if (page) page.classList.add("hidden");
  };

  // Wire buttons
  document.addEventListener("click", function (e) {
    var nav = e.target.closest('[data-nav="calls"]');
    if (nav) {
      e.preventDefault();
      if (typeof closeSidebar === "function") closeSidebar();
      window._openCallHistoryPage();
      return;
    }
    if (e.target.closest("#messages-call-btn")) {
      e.preventDefault();
      var mp = document.getElementById("messages-page");
      if (mp) mp.classList.add("hidden");
      window._openCallHistoryPage();
      return;
    }
    if (e.target.closest("#calls-back")) {
      e.preventDefault();
      window._closeCallHistoryPage();
      return;
    }
    if (e.target.closest("#calls-refresh")) {
      e.preventDefault();
      window._openCallHistoryPage();
      return;
    }
    var tab = e.target.closest(".call-tab");
    if (tab) {
      e.preventDefault();
      _callFilter = tab.dataset.ctab || "all";
      _renderTabs();
      _renderList();
    }
  }, true);

  console.log("[S4B] call history ready");
})();

// S22 / Series 27B-1 — Security Dashboard
async function _loadSecurityDashboard() {
  const container = document.getElementById("security-dashboard");
  if (!container) return;
  container.innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px">লোড হচ্ছে...</p>';
  try {
    const data = await window.api("/api/me/security-overview");
    container.innerHTML = _renderSecurityDashboard(data);
    _bindSecurityDashboardEvents();
  } catch (err) {
    container.innerHTML = '<p style="color:var(--danger);text-align:center;padding:20px">লোড করা যায়নি</p>';
  }
}
window._loadSecurityDashboard = _loadSecurityDashboard;

function _renderSecurityDashboard(d) {
  const c = d.checks || {};
  const score = d.score || 0;
  const risk = d.risk || "weak";
  const riskLabel = d.risk_label || "Unknown";
  const colors = { excellent:"#22c55e", good:"#10b981", moderate:"#f59e0b", weak:"#ef4444" };
  const color = colors[risk] || "#ef4444";

  const check = (label, ok, hint, extra = "") => `
    <div class="sd-check ${ok ? 'ok' : 'warn'}">
      <div class="sd-check-icon">${ok ? '✅' : '⚠️'}</div>
      <div class="sd-check-body">
        <div class="sd-check-label">${escapeHtml(label)}</div>
        <div class="sd-check-hint">${escapeHtml(hint || "")}</div>
        ${extra}
      </div>
    </div>`;

  return `
    <div class="sd-score-card">
      <div class="sd-score-ring" style="--sd-color:${color};--score:${score}">
        <div class="sd-score-value">${score}</div>
        <div class="sd-score-max">/100</div>
      </div>
      <div class="sd-score-info">
        <div class="sd-score-label" style="color:${color}">${escapeHtml(riskLabel)}</div>
        <div class="sd-score-sub">আপনার অ্যাকাউন্ট সুরক্ষার স্কোর</div>
      </div>
    </div>
    <div class="sd-checks">
      ${check(c.password?.label, c.password?.ok, c.password?.hint)}
      ${check(c.two_factor?.label, c.two_factor?.ok, c.two_factor?.hint,
        c.two_factor?.ok ? '' : '<button type="button" class="sd-action-btn" data-action="enable-2fa">2FA চালু করুন</button>')}
      ${check(c.email?.label, c.email?.ok,
        (c.email?.email ? c.email.email + ' — ' + c.email.hint : c.email?.hint),
        c.email?.ok ? '' : '<button type="button" class="sd-action-btn" data-action="verify-email">Email যাচাই করুন</button>')}
      ${check(c.backup_codes?.label, c.backup_codes?.ok, c.backup_codes?.hint)}
      ${check(c.recovery_code?.label, c.recovery_code?.ok, c.recovery_code?.hint,
        c.recovery_code?.ok ? '' : '<button type="button" class="sd-action-btn" data-action="gen-recovery">Recovery Code তৈরি করুন</button>')}
      ${check(c.phone?.label, c.phone?.ok, c.phone?.hint + (c.phone?.coming_soon ? ' (Coming soon)' : ''))}
      ${check(c.backup_email?.label, c.backup_email?.ok, c.backup_email?.hint)}
    </div>
    <div class="sd-footer-tip">
      💡 <strong>টিপস:</strong> 2FA চালু করলে এবং recovery code সংরক্ষণ করলে আপনার অ্যাকাউন্ট সর্বোচ্চ সুরক্ষিত থাকবে।
    </div>`;
}

function _bindSecurityDashboardEvents() {
  document.querySelectorAll('.sd-action-btn').forEach(btn => {
    btn.addEventListener('click', async function () {
      const act = this.dataset.action;
      if (act === 'enable-2fa') {
        const b = document.getElementById('btn-enable-2fa');
        if (b) b.click();
      } else if (act === 'verify-email') {
        const b = document.getElementById('btn-add-email') || document.getElementById('btn-change-email');
        if (b) b.click();
      } else if (act === 'gen-recovery') {
        await _openRecoveryCodeModal();
      }
    });
  });
}

async function _openRecoveryCodeModal() {
  // S27B fix — replace browser prompt() with custom modal (APK-friendly)
  const has2FA = await window.api("/api/me/2fa/status")
    // S29.4 - recovery-code regeneration calls _verify_sensitive_action,
    // which only checks TOTP. Align the UI with the backend.
    .then(r => !!(r && r.totp_enabled))
    .catch(() => false);

  const old = document.getElementById("recovery-code-modal");
  if (old) old.remove();

  const modal = document.createElement("div");
  modal.id = "recovery-code-modal";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML = `
    <div class="modal-content" style="max-width:460px">
      <button class="close-btn" id="rc2-close" type="button">×</button>
      <h3 style="margin-bottom:10px;font-size:19px">🎫 Recovery Code তৈরি করুন</h3>
      <p style="background:rgba(24,119,242,.08);border-left:3px solid var(--accent);padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.5;margin-bottom:14px">
        এই কোড দিয়ে <strong>device হারালে</strong> 2FA বন্ধ করতে পারবেন। কোড শুধু একবার দেখা যাবে — নিরাপদে সংরক্ষণ করুন।
      </p>

      <label class="edit-label">নিশ্চিত করতে আপনার পাসওয়ার্ড</label>
      <div class="input-group" style="margin-bottom:12px">
        <i class="fa-solid fa-lock input-icon"></i>
        <input type="password" id="rc2-password" placeholder="Account password" autocomplete="current-password">
      </div>

      <div id="rc2-2fa-wrap" style="display:${has2FA ? 'block' : 'none'}">
        <label class="edit-label">2FA কোড (Authenticator / Backup code)</label>
        <div class="input-group" style="margin-bottom:12px">
          <i class="fa-solid fa-shield-halved input-icon"></i>
          <input type="text" id="rc2-code" placeholder="123456 অথবা XXXXX-XXXXX" autocomplete="one-time-code">
        </div>
      </div>

      <p id="rc2-error" class="hidden" style="color:var(--danger);font-size:13px;margin:0 0 10px;text-align:center;font-weight:600"></p>

      <div class="edit-actions">
        <button class="btn-secondary" id="rc2-cancel" type="button">বাতিল</button>
        <button class="btn-primary" id="rc2-submit" type="button" style="width:auto;padding:12px 24px">
          <i class="fa-solid fa-key"></i> তৈরি করুন
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  function close() { modal.remove(); }
  function showErr(msg) {
    const el = document.getElementById("rc2-error");
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  document.getElementById("rc2-close").onclick = close;
  document.getElementById("rc2-cancel").onclick = close;
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  setTimeout(() => {
    const p = document.getElementById("rc2-password");
    if (p) p.focus();
  }, 100);

  document.getElementById("rc2-submit").onclick = async () => {
    const password = (document.getElementById("rc2-password").value || "").trim();
    const code = (document.getElementById("rc2-code")?.value || "").trim();
    if (!password) return showErr("পাসওয়ার্ড দিন");
    if (has2FA && !code) return showErr("2FA কোড দিন");

    const btn = document.getElementById("rc2-submit");
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
      const res = await window.api("/api/me/recovery-code/regenerate", {
        method: "POST",
        body: JSON.stringify({ password: password, totp_code: code }),
      });
      close();

      // Show the generated code in a second modal
      _showRecoveryCodeResult(res.recovery_code);
    } catch (err) {
      showErr(err.message || "কিছু ভুল হয়েছে");
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-key"></i> তৈরি করুন';
    }
  };
}

function _showRecoveryCodeResult(code) {
  const old = document.getElementById("recovery-code-result");
  if (old) old.remove();

  const modal = document.createElement("div");
  modal.id = "recovery-code-result";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML = `
    <div class="modal-content" style="max-width:480px">
      <h3 style="margin-bottom:10px;font-size:19px">🎫 আপনার Recovery Code</h3>
      <p style="background:rgba(245,158,11,.1);border-left:3px solid #f59e0b;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.5;margin-bottom:14px">
        ⚠️ এই কোড <strong>শুধু একবার</strong> দেখানো হবে। এখনই নিরাপদে সংরক্ষণ করুন (password manager / কাগজে)।
      </p>
      <div style="background:var(--card-2);border:1px dashed var(--accent);border-radius:12px;padding:18px;text-align:center;font-family:'Courier New',monospace;font-size:17px;font-weight:800;letter-spacing:1px;user-select:all;word-break:break-all;margin-bottom:14px">
        ${escapeHtml(code)}
      </div>
      <div class="edit-actions">
        <button class="btn-secondary" id="rcr-copy" style="flex:1">
          <i class="fa-regular fa-copy"></i> কপি
        </button>
        <button class="btn-primary" id="rcr-done" style="flex:1">
          <i class="fa-solid fa-check"></i> সংরক্ষণ করেছি
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById("rcr-copy").onclick = () => {
    navigator.clipboard.writeText(code).then(() => {
      if (typeof showToast === "function") showToast("📋 কপি হয়েছে");
    });
  };
  document.getElementById("rcr-done").onclick = () => {
    modal.remove();
    if (typeof _loadSecurityDashboard === "function") _loadSecurityDashboard();
  };
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
}
console.log("[S27B-1] security dashboard ready ✅");

// ═══════════════════════════════════════════════
// S22 / Series 27B-2 — Email gate for 2FA enable
// ═══════════════════════════════════════════════

async function _checkEmailGateFor2FA() {
  const enableBtn = document.getElementById("btn-enable-2fa");
  const disabledView = document.getElementById("2fa-disabled-view");
  if (!enableBtn || !disabledView) return;

  try {
    const st = await window.api("/api/me/email/status");
    const verified = st && st.verified;
    const existingWarn = document.getElementById("s27b2-gate-warning");

    if (!verified) {
      if (!existingWarn) {
        const warn = document.createElement("div");
        warn.id = "s27b2-gate-warning";
        warn.style.cssText = "padding:12px 14px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35);border-radius:12px;margin-bottom:10px";
        warn.innerHTML = '<div style="font-size:13.5px;font-weight:800;color:#f59e0b;margin-bottom:6px">\u26a0\ufe0f \u0986\u0997\u09c7 Recovery Email \u09af\u09be\u099a\u09be\u0987 \u0995\u09b0\u09c1\u09a8</div>' +
          '<div style="font-size:12.5px;color:var(--muted);line-height:1.5">Device \u09b9\u09be\u09b0\u09be\u09b2\u09c7 email \u09a6\u09bf\u09df\u09c7\u0987 2FA \u09ac\u09a8\u09cd\u09a7 \u0995\u09b0\u09a4\u09c7 \u09b9\u09df\u0964 \u09a4\u09be\u0987 \u0986\u0997\u09c7 verified email \u09a5\u09be\u0995\u09be \u0986\u09ac\u09b6\u09cd\u09af\u0995\u0964</div>' +
          '<button type="button" id="s27b2-goto-email" class="sd-action-btn" style="margin-top:10px;width:100%">\ud83d\udce7 Email \u09af\u09be\u099a\u09be\u0987 \u0995\u09b0\u09c1\u09a8</button>';
        disabledView.insertBefore(warn, disabledView.firstChild);
        const gotoBtn = document.getElementById("s27b2-goto-email");
        if (gotoBtn) {
          gotoBtn.onclick = function () {
            const eb = document.getElementById("btn-add-email") || document.getElementById("btn-change-email");
            if (eb) eb.click();
          };
        }
      }
      enableBtn.style.display = "none";
    } else {
      if (existingWarn) existingWarn.remove();
      enableBtn.style.display = "";
    }
  } catch (e) {}
}
window._checkEmailGateFor2FA = _checkEmailGateFor2FA;
console.log("[S27B-2] email gate ready ✅");

// ═══════════════════════════════════════════════
// S22 / Series 27B-3 — Lost 2FA device recovery
// ═══════════════════════════════════════════════

function _openRecover2FAModal() {
  const loginUserEl = document.querySelector('#login-form input[name="username"]');
  const prefillUser = loginUserEl ? loginUserEl.value.trim() : '';

  const old = document.getElementById("recover-2fa-modal");
  if (old) old.remove();

  const modal = document.createElement("div");
  modal.id = "recover-2fa-modal";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML = `
    <div class="modal-content" style="max-width:460px">
      <button class="close-btn" id="r2f-close" type="button">×</button>

      <div id="r2f-step1">
        <h3 style="margin-bottom:10px;font-size:19px">🔑 2FA Recovery</h3>
        <p style="background:rgba(34,197,94,.1);border-left:3px solid #22c55e;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.5;margin-bottom:14px">
          আপনার <strong>verified email</strong>-এ একটি কোড পাঠানো হবে। সেটি দিয়ে 2FA বন্ধ করতে পারবেন।
        </p>
        <label class="edit-label">ইউজারনেম</label>
        <div class="input-group" style="margin-bottom:10px">
          <i class="fa-solid fa-at input-icon"></i>
          <input type="text" id="r2f-username" placeholder="your_username" value="${escapeHtml(prefillUser)}">
        </div>
        <label class="edit-label">পাসওয়ার্ড</label>
        <div class="input-group" style="margin-bottom:14px">
          <i class="fa-solid fa-lock input-icon"></i>
          <input type="password" id="r2f-password" placeholder="Account password">
        </div>
        <p id="r2f-error1" class="hidden" style="color:var(--danger);font-size:13px;margin:0 0 10px;text-align:center;font-weight:600"></p>
        <div class="edit-actions">
          <button class="btn-secondary" id="r2f-cancel">বাতিল</button>
          <button class="btn-primary" id="r2f-send" style="width:auto;padding:12px 24px">
            <i class="fa-solid fa-paper-plane"></i> ইমেইলে কোড পাঠান
          </button>
        </div>
      </div>

      <div id="r2f-step2" style="display:none">
        <h3 style="margin-bottom:10px;font-size:19px">📧 ইমেইল কোড</h3>
        <p style="background:rgba(24,119,242,.1);border-left:3px solid #1877f2;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.5;margin-bottom:14px">
          কোড পাঠানো হয়েছে: <strong id="r2f-email-mask">—</strong><br>
          <span style="font-size:12px;color:var(--muted)">স্প্যাম ফোল্ডারও দেখুন। কোড 10 মিনিট বৈধ।</span>
        </p>
        <label class="edit-label">৬ ডিজিটের কোড</label>
        <div class="input-group" style="margin-bottom:14px">
          <i class="fa-solid fa-key input-icon"></i>
          <input type="text" id="r2f-code" placeholder="123456" inputmode="numeric" maxlength="6" style="text-align:center;letter-spacing:8px;font-size:20px;font-weight:800">
        </div>
        <p id="r2f-error2" class="hidden" style="color:var(--danger);font-size:13px;margin:0 0 10px;text-align:center;font-weight:600"></p>
        <div class="edit-actions">
          <button class="btn-secondary" id="r2f-back">← পিছনে</button>
          <button class="btn-primary" id="r2f-verify" style="width:auto;padding:12px 24px">
            <i class="fa-solid fa-shield-halved"></i> 2FA বন্ধ করুন
          </button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  let currentUser = prefillUser;

  function close() { modal.remove(); }
  document.getElementById("r2f-close").onclick = close;
  document.getElementById("r2f-cancel").onclick = close;
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  function showErr(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
  }
  function hideErr(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  }

  // STEP 1 — request code
  document.getElementById("r2f-send").onclick = async () => {
    const u = document.getElementById("r2f-username").value.trim();
    const p = document.getElementById("r2f-password").value;
    if (!u || !p) return showErr("r2f-error1", "ইউজারনেম ও পাসওয়ার্ড দিন");
    hideErr("r2f-error1");

    const btn = document.getElementById("r2f-send");
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
      const res = await window.api("/api/auth/recover-2fa/request", {
        method: "POST",
        body: JSON.stringify({ username: u, password: p }),
      });
      currentUser = u;
      document.getElementById("r2f-email-mask").textContent = res.email_masked || "your email";
      document.getElementById("r2f-step1").style.display = "none";
      document.getElementById("r2f-step2").style.display = "";
      setTimeout(() => document.getElementById("r2f-code").focus(), 100);
    } catch (err) {
      showErr("r2f-error1", err.message || "কিছু ভুল হয়েছে");
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> ইমেইলে কোড পাঠান';
    }
  };

  // STEP 2 — submit code
  document.getElementById("r2f-verify").onclick = async () => {
    const code = document.getElementById("r2f-code").value.trim();
    if (!code || code.length !== 6) return showErr("r2f-error2", "৬ ডিজিটের কোড দিন");
    hideErr("r2f-error2");

    const btn = document.getElementById("r2f-verify");
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
      const res = await window.api("/api/auth/recover-2fa/verify", {
        method: "POST",
        body: JSON.stringify({ username: currentUser, email_code: code }),
      });
      close();
      if (typeof showToast === "function") {
        showToast("✅ " + (res.message || "2FA বন্ধ করা হয়েছে"));
      } else {
        alert(res.message || "2FA disabled");
      }
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      showErr("r2f-error2", err.message || "কিছু ভুল হয়েছে");
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-shield-halved"></i> 2FA বন্ধ করুন';
    }
  };

  document.getElementById("r2f-back").onclick = () => {
    document.getElementById("r2f-step1").style.display = "";
    document.getElementById("r2f-step2").style.display = "none";
    hideErr("r2f-error1");
    hideErr("r2f-error2");
  };
}

// Wire the "Lost device?" link after DOM ready
(function () {
  function attach() {
    const link = document.getElementById("switch-lost-2fa");
    if (!link) { setTimeout(attach, 500); return; }
    if (link.dataset.bound === "1") return;
    link.dataset.bound = "1";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      _openRecover2FAModal();
    });
    console.log("[S27B-3] recovery link bound ✅");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
})();

console.log("[S27B-3] recovery flow ready ✅");

// ═══════════════════════════════════════════════
// S27B-4 — Email 2FA primary + TOTP optional toggles
// ═══════════════════════════════════════════════
(function () {
  function init() {
    const emailSwitch = document.getElementById("email-2fa-switch");
    const totpSwitch = document.getElementById("totp-2fa-switch");
    const emailSub = document.getElementById("2fa-email-sub");
    const totpSub = document.getElementById("2fa-totp-sub");
    const backupLine = document.getElementById("totp-backup-codes-line");
    const backupCount = document.getElementById("2fa-backup-count");
    if (!emailSwitch || !totpSwitch) {
      setTimeout(init, 500);
      return;
    }
    if (emailSwitch.dataset.bound === "1") return;
    emailSwitch.dataset.bound = "1";
    totpSwitch.dataset.bound = "1";

    async function refreshToggles() {
      try {
        const st = await window.api("/api/me/2fa/status");
        const emailOn = !!st.email_2fa_enabled;
        const totpOn = !!st.totp_enabled;
        const emailVerified = !!st.email_verified;

        emailSwitch.classList.toggle("on", emailOn);
        totpSwitch.classList.toggle("on", totpOn);

        if (emailSub) {
          emailSub.textContent = emailVerified
            ? (emailOn ? "✅ চালু — email-এ কোড আসবে" : "Email যাচাইকৃত, চালু করা যাবে")
            : "⚠️ আগে verified email যোগ করুন";
          emailSub.style.color = emailVerified ? "" : "#f59e0b";
        }
        if (totpSub) {
          totpSub.textContent = totpOn
            ? "✅ চালু — Authenticator app দিয়ে কোড"
            : "Google Authenticator / Authy";
        }
        if (backupLine) {
          backupLine.style.display = totpOn ? "block" : "none";
        }
        if (backupCount) backupCount.textContent = st.backup_codes_remaining || 0;
      } catch (e) {}
    }

    // Initial
    refreshToggles();
    // S39 — exposed for unified loader
    window._load2FAToggles = refreshToggles;
    // S39 — wrapper disabled (unified loader at end of file)

    // ---- Email 2FA toggle ----
    emailSwitch.addEventListener("click", async () => {
      const on = emailSwitch.classList.contains("on");
      const password = prompt(on
        ? "Email 2FA বন্ধ করতে পাসওয়ার্ড দিন:"
        : "Email 2FA চালু করতে পাসওয়ার্ড দিন:");
      if (!password) return;
      emailSwitch.disabled = true;
      try {
        if (on) {
          await window.api("/api/me/2fa/email/disable", {
            method: "POST",
            body: JSON.stringify({ password }),
          });
          showToast("✅ Email 2FA বন্ধ হয়েছে");
        } else {
          const res = await window.api("/api/me/2fa/email/enable", {
            method: "POST",
            body: JSON.stringify({ password }),
          });
          showToast("✅ " + (res.message || "Email 2FA চালু হয়েছে"));
        }
        await refreshToggles();
        if (typeof _loadSecurityDashboard === "function") _loadSecurityDashboard().catch(() => {});
      } catch (err) {
        alert(err.message || "কিছু ভুল হয়েছে");
      } finally {
        emailSwitch.disabled = false;
      }
    });

    // ---- TOTP toggle ----
    totpSwitch.addEventListener("click", async () => {
      const on = totpSwitch.classList.contains("on");
      if (on) {
        // Disable → existing modal flow
        const pw = prompt("Authenticator 2FA বন্ধ করতে পাসওয়ার্ড দিন:");
        if (!pw) return;
        try {
          await window.api("/api/me/2fa/disable", {
            method: "POST",
            body: JSON.stringify({ password: pw }),
          });
          showToast("✅ Authenticator 2FA বন্ধ হয়েছে");
          await refreshToggles();
          if (typeof _loadSecurityDashboard === "function") _loadSecurityDashboard().catch(() => {});
        } catch (err) {
          alert(err.message);
        }
      } else {
        // Enable → existing setup modal flow
        const btn = document.getElementById("btn-enable-2fa");
        if (btn) btn.click();
        // After modal done, refresh
        setTimeout(refreshToggles, 800);
      }
    });

    console.log("[S27B-4] email/totp toggles ready ✅");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

// ═══════════════════════════════════════════════
// S27B-7 — Recovery Kit download
// ═══════════════════════════════════════════════
async function downloadRecoveryKit() {
  try {
    var res = await fetch("/api/me/recovery-kit", {
      credentials: "include",
      headers: { "X-CSRF-Token": (document.cookie.match(/csrf_token=([^;]+)/) || [])[1] || "" }
    });
    if (!res.ok) {
      var err = await res.json().catch(() => ({}));
      alert(err.error || "ডাউনলোড করা যায়নি");
      return;
    }
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "juktoy-recovery.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    if (typeof showToast === "function") showToast("✅ Recovery Kit ডাউনলোড হয়েছে");
  } catch (e) {
    alert("ডাউনলোড করা যায়নি");
  }
}

// Auto-inject button into Security Overview card
(function () {
  function inject() {
    var dash = document.getElementById("security-dashboard");
    if (!dash) { setTimeout(inject, 500); return; }
    if (document.getElementById("kit-download-btn")) return;
    // Wait for dashboard content
    if (!dash.querySelector(".sd-footer-tip")) { setTimeout(inject, 500); return; }

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "kit-download-btn";
    btn.className = "btn-secondary";
    btn.style.cssText = "width:100%;margin-top:10px;padding:12px;font-size:13.5px;font-weight:700";
    btn.innerHTML = '<i class="fa-solid fa-file-arrow-down"></i> 📥 Recovery Kit ডাউনলোড (.txt)';
    btn.onclick = downloadRecoveryKit;

    var tip = dash.querySelector(".sd-footer-tip");
    tip.parentNode.insertBefore(btn, tip.nextSibling);
    console.log("[S27B-7] kit button injected ✅");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject);
  } else {
    inject();
  }
})();

// ═══════════════════════════════════════════════
// S27B-9 — Backup Email flow
// ═══════════════════════════════════════════════
function openBackupEmailModal() {
  const old = document.getElementById("backup-email-modal");
  if (old) old.remove();

  const modal = document.createElement("div");
  modal.id = "backup-email-modal";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML = `
    <div class="modal-content" style="max-width:460px">
      <button class="close-btn" id="be-close" type="button">×</button>
      <h3 style="margin-bottom:10px;font-size:19px">📭 Backup Email</h3>
      <p style="background:rgba(24,119,242,.08);border-left:3px solid var(--accent);padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.5;margin-bottom:14px">
        Primary email হারালে এই backup email দিয়ে account recover করতে পারবেন।
      </p>
      <label class="edit-label">Backup Email</label>
      <div class="input-group" style="margin-bottom:10px">
        <i class="fa-solid fa-envelope input-icon"></i>
        <input type="email" id="be-email" placeholder="backup@example.com" autocomplete="email">
      </div>
      <label class="edit-label">আপনার পাসওয়ার্ড</label>
      <div class="input-group" style="margin-bottom:14px">
        <i class="fa-solid fa-lock input-icon"></i>
        <input type="password" id="be-password" placeholder="Account password" autocomplete="current-password">
      </div>
      <p id="be-error" class="hidden" style="color:var(--danger);font-size:13px;margin:0 0 10px;text-align:center;font-weight:600"></p>
      <div class="edit-actions">
        <button class="btn-secondary" id="be-cancel" type="button">বাতিল</button>
        <button class="btn-primary" id="be-save" type="button" style="width:auto;padding:12px 24px">
          <i class="fa-solid fa-check"></i> সেভ
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  function close() { modal.remove(); }
  function showErr(m) {
    const el = document.getElementById("be-error");
    el.textContent = m;
    el.classList.remove("hidden");
  }
  document.getElementById("be-close").onclick = close;
  document.getElementById("be-cancel").onclick = close;
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  setTimeout(() => document.getElementById("be-email").focus(), 100);

  document.getElementById("be-save").onclick = async () => {
    const em = (document.getElementById("be-email").value || "").trim();
    const pw = document.getElementById("be-password").value || "";
    if (!em) return showErr("ইমেইল দিন");
    if (!pw) return showErr("পাসওয়ার্ড দিন");
    const btn = document.getElementById("be-save");
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      const res = await window.api("/api/me/backup-email/set", {
        method: "POST",
        body: JSON.stringify({ email: em, password: pw }),
      });
      close();
      if (typeof showToast === "function") showToast("✅ " + (res.message || "Backup email সেভ হয়েছে"));
      if (typeof _loadSecurityDashboard === "function") _loadSecurityDashboard();
    } catch (err) {
      showErr(err.message || "সেভ করা যায়নি");
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> সেভ';
    }
  };
}

// Auto-inject backup email button into security dashboard
(function () {
  function inject() {
    var dash = document.getElementById("security-dashboard");
    if (!dash || !dash.querySelector(".sd-footer-tip")) {
      setTimeout(inject, 500);
      return;
    }
    var checks = dash.querySelector(".sd-checks");
    if (!checks) { setTimeout(inject, 500); return; }
    if (document.getElementById("backup-email-inject-btn")) return;

    // Find the Backup Email check and add button
    var all = checks.querySelectorAll(".sd-check");
    for (var i = 0; i < all.length; i++) {
      var label = all[i].querySelector(".sd-check-label");
      if (label && /Backup Email/.test(label.textContent)) {
        var body = all[i].querySelector(".sd-check-body");
        if (body) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.id = "backup-email-inject-btn";
          btn.className = "sd-action-btn";
          btn.textContent = "📭 Backup Email সেট করুন";
          btn.onclick = openBackupEmailModal;
          body.appendChild(btn);
          console.log("[S27B-9] backup email button injected ✅");
        }
        break;
      }
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject);
  } else {
    inject();
  }
})();

// ==================================================
// S29.10 - Unified page-closer (replaces 7-deep wrapper chain)
// ==================================================
// Previously window._closeTopPage was redefined 7 times via
//   const _origCloseTopPageX = window._closeTopPage;
//   window._closeTopPage = function() { ... return _origCloseTopPageX(); };
// producing an 8-level call chain. Any missed wrap meant that page
// type could never be closed via back button. This unified version
// uses a single dispatch table so adding a new overlay is one line.
window._closeTopPage = function _closeTopPageUnified() {
  // --- Step 1: if a chat conversation is open, close it first ---
  var cw = document.getElementById("chat-window");
  if (cw && !cw.classList.contains("hidden")) {
    try { if (typeof stopChatPolling === "function") stopChatPolling(); } catch (e) {}
    try { if (typeof _exitChatMultiSelect === "function") _exitChatMultiSelect(); } catch (e) {}
    try { if (typeof window._closeChatSearch === "function") window._closeChatSearch(); } catch (e) {}
    cw.classList.add("hidden");
    if (typeof window.currentChatUser !== "undefined") window.currentChatUser = null;
    if (typeof window.lastMsgCount !== "undefined") window.lastMsgCount = 0;
    if (typeof window._PageStack !== "undefined" && window._PageStack[window._PageStack.length - 1] === "chat") {
      window._PageStack.pop();
    }
    try { if (typeof loadConversations === "function") loadConversations(); } catch (e) {}
    try { if (typeof window._updateOverlayClass === "function") window._updateOverlayClass(); } catch (e) {}
    return true;
  }

  // --- Step 2: dispatch on stack top ---
  if (typeof window._PageStack === "undefined" || !window._PageStack.length) return false;
  var top = window._PageStack[window._PageStack.length - 1];

  var CLOSERS = {
    "profile": function () {
      var el = document.getElementById("profile-page");
      if (el) el.classList.add("hidden");
    },
    "messages": function () {
      try { if (typeof stopChatPolling === "function") stopChatPolling(); } catch (e) {}
      var el = document.getElementById("messages-page");
      if (el) el.classList.add("hidden");
    },
    "explore": function () {
      var el = document.getElementById("explore-page");
      if (el) el.classList.add("hidden");
    },
    "hashtag": function () {
      var el = document.getElementById("hashtag-page");
      if (el) el.classList.add("hidden");
    },
    "story-viewer": function () {
      try { if (typeof closeStoryViewer === "function") closeStoryViewer(); } catch (e) {}
    },
    "saved": function () {
      var el = document.getElementById("saved-page");
      if (el) el.classList.add("hidden");
    },
    "notifications": function () {
      var el = document.getElementById("notifications-page");
      if (el) el.classList.add("hidden");
    },
    "reels": function () {
      try { if (typeof closeReelsPage === "function") closeReelsPage(); } catch (e) {}
    },
    "settings": function () {
      var el = document.getElementById("settings-page");
      if (el) el.classList.add("hidden");
    },
    "search-page": function () {
      // S39 — close search page via exposed _close
      if (typeof window._closeSearchPage === "function") {
        window._closeSearchPage();
      } else {
        var el = document.getElementById("search-page");
        if (el) el.classList.add("hidden");
      }
    },
    "admin": function () {
      try { if (typeof window.closeAdminPage === "function") window.closeAdminPage(); } catch (e) {}
    },
    "chat": function () {
      // fallback when chat-window was already hidden
      try { if (typeof stopChatPolling === "function") stopChatPolling(); } catch (e) {}
      var el = document.getElementById("chat-window");
      if (el) el.classList.add("hidden");
      if (typeof window.currentChatUser !== "undefined") window.currentChatUser = null;
    }
  };

  var closer = CLOSERS[top];
  if (!closer) return false;

  window._PageStack.pop();
  try { closer(); }
  catch (err) { console.error("[S29.10] closer failed for", top, err); }
  try { if (typeof window._updateOverlayClass === "function") window._updateOverlayClass(); } catch (e) {}
  return true;
};
  window._closeTopPage = window._closeTopPage;
console.log("[S29.10] unified window._closeTopPage registered");


// ==================================================
// S32 — Post interactions via bottom sheets
// ==================================================
(function () {
  "use strict";
  if (window.__s32Sheets) return;
  window.__s32Sheets = true;

  function _closeAllSheets() {
    document.querySelectorAll(".sheet-root").forEach(function (el) {
      el.classList.remove("show");
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    });
    document.body.classList.remove("sheet-open");
    // also close old floating menus if present
    try { if (typeof window.closePostMenu === "function") window.closePostMenu(); } catch (e) {}
    try { if (typeof window._closeRepostMenu === "function") window._closeRepostMenu(); } catch (e) {}
  }

  // ---------- Comment Sheet ----------
  window._openCommentSheet = async function (postId) {
    if (!postId) return;
    _closeAllSheets();

    var sheet = document.createElement("div");
    sheet.id = "comment-sheet";
    sheet.className = "sheet-root";
    sheet.innerHTML =
      '<div class="sheet-backdrop"></div>' +
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header">' +
          '<h3>মন্তব্য</h3>' +
          '<button class="sheet-close" type="button" aria-label="close">' +
            '<i class="fa-solid fa-xmark"></i>' +
          '</button>' +
        '</div>' +
        '<div class="sheet-body" id="cs-body">' +
          '<p style="text-align:center;padding:30px 20px;color:var(--muted)">লোড হচ্ছে...</p>' +
        '</div>' +
        '<form class="sheet-form" id="cs-form">' +
          '<input type="text" id="cs-input" placeholder="মন্তব্য লিখুন..." maxlength="2000" autocomplete="off">' +
          '<button type="submit" class="sheet-send"><i class="fa-solid fa-paper-plane"></i></button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });

    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 260);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
    sheet.querySelector(".sheet-close").addEventListener("click", close);

    var body = sheet.querySelector("#cs-body");

    // S32.1 — use shared reload helper (keeps bindCommentEvents consistent)
    await _reloadSheetComments(postId);

    var form = sheet.querySelector("#cs-form");
    var input = sheet.querySelector("#cs-input");
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var text = (input.value || "").trim();
      if (!text) return;
      var sendBtn = form.querySelector(".sheet-send");
      sendBtn.disabled = true;
      try {
        await window.api("/api/posts/" + postId + "/comments", {
          method: "POST",
          body: JSON.stringify({ content: text }),
        });
        input.value = "";
        await _reloadSheetComments(postId);
        // update count on underlying post card
        var postEl = document.querySelector('.post[data-id="' + postId + '"]');
        if (postEl) {
          var cc = postEl.querySelector(".comment-btn .comment-count");
          if (cc) cc.textContent = parseInt(cc.textContent || "0", 10) + 1;
        }
      } catch (err) {
        alert(err.message || "মন্তব্য পাঠানো যায়নি");
      } finally {
        sendBtn.disabled = false;
        try { input.focus(); } catch (e) {}
      }
    });

    setTimeout(function () { try { input.focus(); } catch (e) {} }, 320);
  };

  // ---------- Post Menu Sheet ----------
  window._openPostMenuSheet = function (btn, postEl, postId) {
    if (!btn || !postId) return;
    _closeAllSheets();

    var isOwn = window.state.me && btn.dataset.owner === window.state.me.username;
    var isSaved = btn.dataset.saved === "1";
    var isReposted = btn.dataset.reposted === "1";

    var items = [];
    if (!isOwn) {
      items.push({ a: "repost", i: "fa-retweet", l: isReposted ? "রিপোস্ট সরান" : "রিপোস্ট" });
      items.push({ a: "quote", i: "fa-quote-right", l: "কোট পোস্ট" });
    }
    items.push({ a: "save", i: isSaved ? "fa-solid fa-bookmark" : "fa-regular fa-bookmark", l: isSaved ? "সেভ সরান" : "সেভ" });
    items.push({ a: "share", i: "fa-share-nodes", l: "শেয়ার" });
    items.push({ a: "copy", i: "fa-link", l: "লিংক কপি" });
    if (isOwn) {
      items.push({ a: "edit", i: "fa-pen", l: "এডিট" });
      items.push({ a: "delete", i: "fa-trash-can", l: "ডিলিট", d: true });
    } else {
      items.push({ a: "report", i: "fa-flag", l: "রিপোর্ট", d: true });
    }

    var sheet = document.createElement("div");
    sheet.id = "post-menu-sheet";
    sheet.className = "sheet-root";
    sheet.innerHTML =
      '<div class="sheet-backdrop"></div>' +
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-menu-list">' +
          items.map(function (it) {
            return '<button type="button" class="sheet-menu-item' + (it.d ? " danger" : "") + '" data-action="' + it.a + '">' +
              '<i class="fa-solid ' + it.i + '"></i>' +
              '<span>' + it.l + '</span>' +
            '</button>';
          }).join("") +
        '</div>' +
      '</div>';
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });

    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 260);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);

    sheet.querySelectorAll(".sheet-menu-item").forEach(function (b) {
      b.addEventListener("click", function () {
        var action = b.dataset.action;
        close();
        setTimeout(function () {
          try {
            if (typeof window.handlePostMenuAction === "function") {
              window.handlePostMenuAction(action, btn, postEl, postId);
            }
          } catch (e) { console.error("[S32] menu action failed:", e); }
        }, 60);
      });
    });
  };

  // ---------- Override: post content click → comment sheet ----------
  window.openPostDetail = function (postId) {
    if (typeof window._openCommentSheet === "function") {
      window._openCommentSheet(postId);
    }
  };

  // ---------- Override: 3-dot → menu sheet ----------
  window.openPostMenu = function (btn, postEl, postId) {
    if (typeof window._openPostMenuSheet === "function") {
      window._openPostMenuSheet(btn, postEl, postId);
    }
  };

  // ---------- Override: comment-btn (capture) → comment sheet ----------
  document.addEventListener("click", function (e) {
    var cb = e.target.closest(".comment-btn");
    if (!cb) return;
    // skip if inside sheet already
    if (e.target.closest(".sheet-root")) return;
    e.stopPropagation();
    e.preventDefault();
    var post = cb.closest(".post");
    if (post && post.dataset.id) {
      window._openCommentSheet(post.dataset.id);
    }
  }, true);

  // S32.6 — post content wrap + time click → comment sheet
  document.addEventListener("click", function (e) {
    if (e.target.closest(".sheet-root")) return;
    if (e.target.closest("button, a, input, textarea")) return;
    if (e.target.closest(".post-actions")) return;
    if (e.target.closest(".post-menu-btn")) return;
    if (e.target.closest(".post-header .avatar")) return;
    if (e.target.closest(".post-meta .name")) return;
    if (e.target.closest(".hashtag-link")) return;
    if (e.target.closest(".quoted-post")) return;

    var wrap = e.target.closest(".post-content-wrap");
    var time = e.target.closest(".post-meta .time");
    if (!wrap && !time) return;

    var post = e.target.closest(".post");
    if (!post || !post.dataset.id) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof window._openCommentSheet === "function") {
      window._openCommentSheet(post.dataset.id);
    }
  }, true);

  // ---------- Esc closes sheet ----------
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var any = document.querySelector(".sheet-root.show");
      if (any) {
        any.classList.remove("show");
        setTimeout(function () {
          if (any.parentNode) any.parentNode.removeChild(any);
          document.body.classList.remove("sheet-open");
        }, 260);
      }
    }
  });

  console.log("[S32] bottom-sheet interactions ready");
})();

// ==================================================
// S32.1 — Comment sheet helpers
// ==================================================
async function _reloadSheetComments(postId) {
  var body = document.getElementById("cs-body");
  if (!body || !postId) return;
  _cmtSerial = 0;   // S32.2 — reset serial for sheet render
  body.innerHTML = '<p style="text-align:center;padding:20px;color:var(--muted)">লোড হচ্ছে...</p>';
  try {
    var comments = await window.api("/api/posts/" + postId + "/comments");
    if (window._s323CacheComments) window._s323CacheComments(postId, comments);
    if (!comments || !comments.length) {
      body.innerHTML = '<p style="text-align:center;padding:36px 20px;color:var(--muted);font-size:14px">এখনো কোনো মন্তব্য নেই।<br>প্রথম মন্তব্য আপনিই করুন!</p>';
      return;
    }
    body.innerHTML = comments.map(function (c) { return commentHTML(c, postId); }).join("");
    try { bindCommentEvents(body, postId); } catch (e) { console.error("[S32.1]", e); }
  } catch (err) {
    body.innerHTML = '<p style="text-align:center;padding:20px;color:var(--danger)">লোড করা যায়নি</p>';
  }
}
window._reloadSheetComments = _reloadSheetComments;


// ==================================================
// S32.3 — Reply sheet (view all replies, flat + serial)
// ==================================================
(function () {
  "use strict";
  if (window.__s323ReplySheet) return;
  window.__s323ReplySheet = true;

  var _cachedComments = {};   // postId → comments array (for instant lookup)

  // cache comments whenever loaded
  var _origReload = window._reloadSheetComments;
  // expose cache setter for existing loaders
  window._s323CacheComments = function (postId, comments) {
    if (!postId || !Array.isArray(comments)) return;
    _cachedComments[postId] = comments;
  };

  // ---- find flat reply set for a parent comment id ----
  function _findParentAndReplies(postId, parentCid) {
    var all = _cachedComments[postId] || [];
    var parent = null;
    for (var i = 0; i < all.length; i++) {
      if (String(all[i].id) === String(parentCid)) { parent = all[i]; break; }
    }
    if (!parent) return null;
    var replies = parent.replies || [];
    return { parent: parent, replies: replies };
  }

  // ---- open reply sheet ----
  window._openRepliesSheet = async function (parentCid, postId) {
    var prev = document.querySelector(".sheet-root");
    if (prev) prev.remove();

    var sheet = document.createElement("div");
    sheet.id = "replies-sheet";
    sheet.className = "sheet-root";
    sheet.innerHTML =
      '<div class="sheet-backdrop"></div>' +
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header">' +
          '<h3>উত্তর</h3>' +
          '<button class="sheet-close" type="button">' +
            '<i class="fa-solid fa-xmark"></i>' +
          '</button>' +
        '</div>' +
        '<div class="sheet-body" id="rs-body">' +
          '<p style="text-align:center;padding:30px 20px;color:var(--muted)">লোড হচ্ছে...</p>' +
        '</div>' +
        '<form class="sheet-form" id="rs-form">' +
          '<input type="text" id="rs-input" placeholder="উত্তর লিখুন..." maxlength="2000" autocomplete="off">' +
          '<button type="submit" class="sheet-send"><i class="fa-solid fa-paper-plane"></i></button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });

    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 260);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
    sheet.querySelector(".sheet-close").addEventListener("click", close);

    var bodyEl = sheet.querySelector("#rs-body");
    var formEl = sheet.querySelector("#rs-form");
    var inputEl = sheet.querySelector("#rs-input");

    async function render() {
      // Fetch fresh comments
      var comments;
      try {
        comments = await window.api("/api/posts/" + postId + "/comments");
      } catch (err) {
        bodyEl.innerHTML = '<p style="text-align:center;padding:20px;color:var(--danger)">লোড করা যায়নি</p>';
        return;
      }
      _cachedComments[postId] = comments;

      var data = _findParentAndReplies(postId, parentCid);
      if (!data) {
        bodyEl.innerHTML = '<p style="text-align:center;padding:20px;color:var(--muted)">উত্তর খুঁজে পাওয়া যায়নি</p>';
        return;
      }

      // Parent comment index (1-based) in original list
      var parentIdx = comments.findIndex(function (c) { return String(c.id) === String(parentCid); });
      var parentSerial = parentIdx >= 0 ? parentIdx + 1 : 1;

      // Build flat list: parent + replies, serials continue
      _cmtSerial = parentSerial - 1;   // so next commentHTML gives parentSerial

      var parentHTML = commentHTML(data.parent, postId, false);
      var repliesHTML = (data.replies || []).map(function (r) {
        return commentHTML(r, postId, true);
      }).join("");

      bodyEl.innerHTML =
        '<div class="replies-thread flat">' +
          parentHTML +
          (repliesHTML ? '<div class="replies-flat-list">' + repliesHTML + '</div>' : '') +
        '</div>';

      try { bindCommentEvents(bodyEl, postId); } catch (e) {}

      // Prefill @mention in reply form (optional — user can delete)
      if (data.parent && data.parent.display_name) {
        var tag = "@" + data.parent.display_name + " ";
        inputEl.value = tag;
        setTimeout(function () {
          try { inputEl.focus(); } catch (e) {}
          try { inputEl.setSelectionRange(tag.length, tag.length); } catch (e) {}
        }, 200);
      }
    }

    formEl.addEventListener("submit", async function (e) {
      e.preventDefault();
      var text = (inputEl.value || "").trim();
      if (!text) return;
      var sendBtn = formEl.querySelector(".sheet-send");
      sendBtn.disabled = true;
      try {
        await window.api("/api/posts/" + postId + "/comments", {
          method: "POST",
          body: JSON.stringify({ content: text, parent_id: parseInt(parentCid) }),
        });
        inputEl.value = "@" + (window._rsParentName || "") + " ";
        await render();
        // refresh underlying comment sheet / post
        try { if (window._reloadSheetComments) await window._reloadSheetComments(postId); } catch (e) {}
      } catch (err) {
        alert(err.message || "উত্তর পাঠানো যায়নি");
      } finally {
        sendBtn.disabled = false;
      }
    });

    await render();
    // save parent name for post-send prefill
    var _p = _findParentAndReplies(postId, parentCid);
    if (_p && _p.parent) window._rsParentName = _p.parent.display_name || "";
  };

  // ---- click delegation for view-replies-btn ----
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".view-replies-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    var parentCid = btn.dataset.parent;
    var postId = btn.dataset.post;
    if (parentCid && postId) {
      window._openRepliesSheet(parentCid, postId);
    }
  }, true);

  console.log("[S32.3] reply sheet ready");
})();


// ==================================================
// S32.4 — mention click + comment name click
// ==================================================
(function () {
  "use strict";
  if (window.__s324Clicks) return;
  window.__s324Clicks = true;

  document.addEventListener("click", function (e) {
    // mention link
    var m = e.target.closest(".mention[data-mention]");
    if (m) {
      e.preventDefault();
      e.stopPropagation();
      var u = m.dataset.mention;
      if (u) {
        try {
          // close any open sheet first
          document.querySelectorAll(".sheet-root.show").forEach(function (s) {
            s.classList.remove("show");
            setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 220);
          });
          document.body.classList.remove("sheet-open");
        } catch (err) {}
        if (typeof window.openProfile === "function") {
          setTimeout(function () { window.openProfile(u); }, 200);
        }
      }
      return;
    }

    // comment cname click
    var cn = e.target.closest(".cname[data-user]");
    if (cn) {
      e.preventDefault();
      e.stopPropagation();
      var uname = cn.dataset.user;
      if (uname) {
        try {
          document.querySelectorAll(".sheet-root.show").forEach(function (s) {
            s.classList.remove("show");
            setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 220);
          });
          document.body.classList.remove("sheet-open");
        } catch (err) {}
        if (typeof window.openProfile === "function") {
          setTimeout(function () { window.openProfile(uname); }, 200);
        }
      }
      return;
    }
  }, true);

  console.log("[S32.4] mention + name click ready");
})();


// ==================================================
// S32.5 — @mention autocomplete on any input/textarea
// ==================================================
(function () {
  "use strict";
  if (window.__s325Mention) return;
  window.__s325Mention = true;

  var _dd = null;
  var _activeInput = null;
  var _activeAtPos = -1;
  var _userCache = null;
  var _userCacheAt = 0;

  function _destroyDD() {
    if (_dd && _dd.parentNode) _dd.parentNode.removeChild(_dd);
    _dd = null;
    _activeAtPos = -1;
  }

  async function _getUsers() {
    var now = Date.now();
    if (_userCache && (now - _userCacheAt) < 60000) return _userCache;
    try {
      var list = await window.api("/api/users?q=");
      _userCache = Array.isArray(list) ? list : [];
      _userCacheAt = now;
      return _userCache;
    } catch (e) {
      return [];
    }
  }

  function _posOfCaret(el) {
    var pos;
    if (el.selectionStart != null) pos = el.selectionStart;
    else pos = (el.value || "").length;
    return pos;
  }

  function _currentMentionQuery(el) {
    // find last @ before caret that has no whitespace in between
    var val = el.value || "";
    var caret = _posOfCaret(el);
    var before = val.slice(0, caret);
    var at = before.lastIndexOf("@");
    if (at === -1) return null;
    // char before @ must be start or whitespace
    if (at > 0) {
      var prev = before.charAt(at - 1);
      if (!/\s|\(|\[/.test(prev)) return null;
    }
    var frag = before.slice(at + 1);
    // must not contain whitespace after @
    if (/\s/.test(frag)) return null;
    // length limit
    if (frag.length > 30) return null;
    return { at: at, query: frag.toLowerCase() };
  }

  function _posOfInput(el) {
    // approximate caret pos on screen
    var rect = el.getBoundingClientRect();
    return { left: rect.left, top: rect.bottom + 4, width: rect.width };
  }

  async function _showMentions(el, query) {
    var users = await _getUsers();
    // filter
    var q = (query || "").toLowerCase();
    var filtered = users.filter(function (u) {
      if (!u || !u.username) return false;
      var uname = (u.username || "").toLowerCase();
      var dname = (u.display_name || "").toLowerCase();
      if (!q) return true;
      return uname.indexOf(q) === 0 || dname.indexOf(q) === 0;
    }).slice(0, 8);

    _destroyDD();
    if (!filtered.length) return;

    _activeInput = el;

    _dd = document.createElement("div");
    _dd.className = "mention-dropdown";
    _dd.innerHTML = filtered.map(function (u, i) {
      var av = u.profile_pic
        ? '<img src="' + escapeHtml(u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
        : (u.display_name || u.username || "?").charAt(0).toUpperCase();
      return '<div class="mention-item' + (i === 0 ? " active" : "") + '" data-username="' + escapeHtml(u.username) + '">' +
        '<div class="mention-item-avatar">' + av + '</div>' +
        '<div class="mention-item-info">' +
          '<div class="mention-item-name">' + escapeHtml(u.display_name || u.username) + '</div>' +
          '<div class="mention-item-username">@' + escapeHtml(u.username) + '</div>' +
        '</div>' +
      '</div>';
    }).join("");
    document.body.appendChild(_dd);

    // S32.6 — prevent click-outside from firing during scroll/touch inside dropdown
    _dd.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    _dd.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });
    _dd.addEventListener("touchmove", function (e) { e.stopPropagation(); }, { passive: true });

    // position
    var pos = _posOfInput(el);
    var ddRect = _dd.getBoundingClientRect();
    var left = pos.left;
    if (left + ddRect.width > window.innerWidth - 10) {
      left = window.innerWidth - ddRect.width - 10;
    }
    if (left < 10) left = 10;
    var top = pos.top;
    if (top + ddRect.height > window.innerHeight - 10) {
      top = pos.top - ddRect.height - el.offsetHeight - 8;
    }
    _dd.style.left = left + "px";
    _dd.style.top = top + "px";

    // click handling
    _dd.querySelectorAll(".mention-item").forEach(function (it) {
      it.addEventListener("mousedown", function (e) {
        e.preventDefault();
        _insertMention(el, it.dataset.username);
      });
      it.addEventListener("touchstart", function (e) {
        e.preventDefault();
        _insertMention(el, it.dataset.username);
      }, { passive: false });
    });
  }

  function _insertMention(el, username) {
    if (!el || !username) return;
    var info = _currentMentionQuery(el);
    if (!info) { _destroyDD(); return; }
    var val = el.value || "";
    var caret = _posOfCaret(el);
    var before = val.slice(0, info.at);
    var after = val.slice(caret);
    var insert = "@" + username + " ";
    el.value = before + insert + after;
    var newPos = info.at + insert.length;
    try { el.selectionStart = el.selectionEnd = newPos; } catch (e) {}
    _destroyDD();
    try { el.focus(); } catch (e) {}
    // trigger input event so state updates (post btn etc)
    try {
      var ev = new Event("input", { bubbles: true });
      el.dispatchEvent(ev);
    } catch (e) {}
  }

  // ---- Event binding ----
  function _isMentionable(el) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      var t = (el.type || "").toLowerCase();
      return t === "text" || t === "search" || t === "";
    }
    return false;
  }

  document.addEventListener("input", function (e) {
    var el = e.target;
    if (!_isMentionable(el)) return;
    var info = _currentMentionQuery(el);
    if (info === null) { _destroyDD(); return; }
    _showMentions(el, info.query);
  }, true);

  document.addEventListener("keydown", function (e) {
    if (!_dd) return;
    if (e.key === "Escape") {
      _destroyDD();
      e.stopPropagation();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      var items = _dd.querySelectorAll(".mention-item");
      if (!items.length) return;
      var cur = Array.prototype.indexOf.call(items, _dd.querySelector(".mention-item.active"));
      var next = e.key === "ArrowDown" ? (cur + 1) : (cur - 1);
      if (next < 0) next = items.length - 1;
      if (next >= items.length) next = 0;
      items.forEach(function (it, i) { it.classList.toggle("active", i === next); });
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      var active = _dd.querySelector(".mention-item.active");
      if (active) {
        e.preventDefault();
        e.stopPropagation();
        _insertMention(_activeInput, active.dataset.username);
      }
    }
  }, true);

  document.addEventListener("click", function (e) {
    if (_dd && !e.target.closest(".mention-dropdown")) _destroyDD();
  }, true);

  document.addEventListener("focusout", function (e) {
    if (e.target === _activeInput) {
      // S32.6 — delay longer so touch scroll doesn't kill it prematurely
      setTimeout(function () {
        // if user is touching dropdown, don't destroy
        if (_dd && _dd.matches(":active, :hover")) return;
        _destroyDD();
      }, 400);
    }
  }, true);

  console.log("[S32.5] mention autocomplete ready");
})();


// ==================================================
// S34 — Premium Search Behavior
// ==================================================
(function () {
  "use strict";
  if (window.__s34Search) return;
  window.__s34Search = true;

  function $id(x) { return document.getElementById(x); }

  function init() {
    var wrap  = $id("search-wrap");
    var pill  = $id("search-pill");
    var input = $id("search-input");
    var clearBtn = $id("search-clear");
    var icon = $id("search-icon");
    var results = $id("search-results");
    if (!wrap || !pill || !input || !results) return;
    if (input.dataset.s34Bound === "1") return;
    input.dataset.s34Bound = "1";

    // ---- Responsive readonly ----
    function applyMode() {
      // Desktop: editable inline search
      // Mobile: readonly trigger (tap opens full-page)
      if (window.innerWidth >= 900) {
        input.removeAttribute("readonly");
      } else {
        input.setAttribute("readonly", "readonly");
      }
    }
    applyMode();
    window.addEventListener("resize", applyMode);

    // ---- Block old "open full-page on focus" on desktop ----
    function blockOldDesktop(e) {
      if (window.innerWidth >= 900) {
        e.stopImmediatePropagation();
      }
    }
    input.addEventListener("focus", blockOldDesktop, true);
    input.addEventListener("click", blockOldDesktop, true);
    input.addEventListener("touchstart", blockOldDesktop, true);

    // ---- Clear button ----
    function refreshClear() {
      if (!clearBtn) return;
      if ((input.value || "").trim().length > 0) {
        clearBtn.classList.remove("hidden");
      } else {
        clearBtn.classList.add("hidden");
      }
    }
    refreshClear();

    input.addEventListener("input", refreshClear);

    if (clearBtn) {
      clearBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        input.value = "";
        refreshClear();
        results.classList.add("hidden");
        input.setAttribute("aria-expanded", "false");
        try { input.focus(); } catch (err) {}
      });
    }

    // ---- Icon click → focus ----
    if (icon) {
      icon.addEventListener("click", function () {
        try { input.focus(); } catch (e) {}
      });
      icon.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          try { input.focus(); } catch (err) {}
        }
      });
    }

    // ---- Ctrl+K / Cmd+K ----
    document.addEventListener("keydown", function (e) {
      var k = (e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "k") {
        // skip if user typing in another input/textarea
        var tag = (document.activeElement && document.activeElement.tagName) || "";
        if (tag === "TEXTAREA") return;
        e.preventDefault();
        if (window.innerWidth < 900) {
          // mobile: open full-page search
          var pageInput = $id("search-page-input");
          var page = $id("search-page");
          if (page && pageInput && page.classList.contains("hidden")) {
            page.classList.remove("hidden");
            setTimeout(function () { try { pageInput.focus(); } catch (err) {} }, 80);
          }
        } else {
          try { input.focus(); } catch (err) {}
        }
      }
      // Escape → close dropdown + blur
      if (e.key === "Escape" && document.activeElement === input) {
        input.blur();
        results.classList.add("hidden");
        input.setAttribute("aria-expanded", "false");
      }
    }, true);

    // ---- Enter → open full-page search with the query ----
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var q = (input.value || "").trim();
        if (!q) return;
        e.preventDefault();
        var page = $id("search-page");
        var pageInput = $id("search-page-input");
        if (page && pageInput) {
          page.classList.remove("hidden");
          pageInput.value = q;
          try {
            pageInput.dispatchEvent(new Event("input", { bubbles: true }));
          } catch (err) {}
          setTimeout(function () { try { pageInput.focus(); } catch (err) {} }, 60);
        }
        results.classList.add("hidden");
        input.setAttribute("aria-expanded", "false");
      }
    });

    // ---- aria-expanded sync ----
    var mo = null;
    try {
      mo = new MutationObserver(function () {
        var open = !results.classList.contains("hidden");
        input.setAttribute("aria-expanded", open ? "true" : "false");
      });
      mo.observe(results, { attributes: true, attributeFilter: ["class"] });
    } catch (e) {}

    // ---- Keyboard navigation (↑ ↓ Enter) inside dropdown ----
    input.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      if (results.classList.contains("hidden")) return;
      var items = results.querySelectorAll(
        ".search-body .search-result, .search-body .search-hashtag-item, .search-body .search-post-item"
      );
      if (!items.length) return;

      var cur = Array.prototype.indexOf.call(
        items,
        results.querySelector(".search-body .s34-active")
      );

      if (e.key === "ArrowDown") {
        e.preventDefault();
        var n1 = cur < 0 ? 0 : (cur + 1) % items.length;
        items.forEach(function (it, i) { it.classList.toggle("s34-active", i === n1); });
        items[n1].scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        var n2 = cur < 0 ? items.length - 1 : (cur - 1 + items.length) % items.length;
        items.forEach(function (it, i) { it.classList.toggle("s34-active", i === n2); });
        items[n2].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        var active = results.querySelector(".search-body .s34-active");
        if (active) {
          e.preventDefault();
          active.click();
          results.classList.add("hidden");
        }
      }
    });

    // ---- Click outside → close ----
    document.addEventListener("click", function (e) {
      if (!e.target.closest("#search-wrap")) {
        results.classList.add("hidden");
        input.setAttribute("aria-expanded", "false");
      }
    });

    console.log("[S34] premium search ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();


// ==================================================
// S36 — Reel button click → open reel upload modal
// ==================================================
(function () {
  "use strict";
  if (window.__s36ReelBtn) return;
  window.__s36ReelBtn = true;

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("#btn-pick-reel");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    // Preferred: open reel upload modal (existing flow in app.js)
    if (typeof window.openReelUpload === "function") {
      try { window.openReelUpload(); return; } catch (err) {}
    }

    // Fallback A: click the hidden modal's internal button if present
    var insideBtn = document.getElementById("btn-choose-reel");
    var modal = document.getElementById("reel-upload-modal");
    if (modal) {
      modal.classList.remove("hidden");
      // reset state if helper exists
      if (typeof window.resetReelUpload === "function") {
        try { window.resetReelUpload(); } catch (err) {}
      }
      return;
    }

    // Fallback B: open reels page
    if (typeof window.openReelsPage === "function") {
      try { window.openReelsPage(); } catch (err) {}
    }
  }, true);

  console.log("[S36] reel button wired");
})();


// ==================================================
// Batch 1 — Profile buttons 1-10
// ==================================================
(function () {
  "use strict";
  if (window.__batch1Profile) return;
  window.__batch1Profile = true;

  // S39 — Close button (#profile-close-btn) removed from HTML.
  // Its behavior is now handled by the standard back button only.

  // ---- 3. Search in profile ----
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-search-btn")) return;
    e.preventDefault();
    var page = document.getElementById("search-page");
    var pageInput = document.getElementById("search-page-input");
    if (page && pageInput) {
      // S39 — push to page stack so back button works
      if (typeof window._pushPage === "function") window._pushPage("search-page");
      page.classList.remove("hidden");
      pageInput.value = "";
      setTimeout(function () { try { pageInput.focus(); } catch (err) {} }, 60);
    }
  }, true);

  // ---- 4. Profile menu (⋮) ----
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var isMe = window.state && window.state.me && window.state.me.username === data.user.username;

    // sheet-style menu
    var old = document.getElementById("profile-menu-sheet");
    if (old) old.remove();
    var sheet = document.createElement("div");
    sheet.id = "profile-menu-sheet";
    sheet.className = "sheet-root";
    var items = isMe ? [
      { a: "edit",   i: "fa-pen",               l: "প্রোফাইল এডিট" },
      { a: "share",  i: "fa-share-nodes",        l: "শেয়ার" },
      { a: "copy",   i: "fa-link",               l: "লিংক কপি" },
      { a: "copy",   i: "fa-qrcode",             l: "QR কোড (আসছে)" },
      { a: "settings", i: "fa-gear",             l: "সেটিংস" },
    ] : [
      { a: "copy",   i: "fa-link",               l: "লিংক কপি" },
      { a: "share",  i: "fa-share-nodes",        l: "শেয়ার" },
      { a: "mute",   i: "fa-bell-slash",         l: "মিউট" },
      { a: "block",  i: "fa-ban",                l: "ব্লক",       d: true },
      { a: "report", i: "fa-flag",               l: "রিপোর্ট",    d: true },
    ];
    sheet.innerHTML =
      '<div class="sheet-backdrop"></div>' +
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-menu-list">' +
          items.map(function (it) {
            return '<button type="button" class="sheet-menu-item' + (it.d ? " danger" : "") + '" data-act="' + it.a + '">' +
              '<i class="fa-solid ' + it.i + '"></i><span>' + it.l + '</span></button>';
          }).join("") +
        '</div>' +
      '</div>';
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });
    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 240);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
    sheet.querySelectorAll(".sheet-menu-item").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.dataset.act;
        close();
        if (act === "edit") {
          if (typeof window.openEditProfile === "function") window.openEditProfile();
        } else if (act === "share") {
          var url = window.location.origin + "/u/" + data.user.username;
          if (navigator.share) navigator.share({ title: "JUKTOY", url: url }).catch(function(){});
          else navigator.clipboard.writeText(url).then(function(){ if (typeof showToast === "function") showToast("🔗 কপি হয়েছে"); });
        } else if (act === "copy") {
          var url2 = window.location.origin + "/u/" + data.user.username;
          navigator.clipboard.writeText(url2).then(function(){ if (typeof showToast === "function") showToast("🔗 লিংক কপি"); });
        } else if (act === "settings") {
          if (typeof window.openSettingsPage === "function") window.openSettingsPage();
        } else if (act === "mute") {
          if (typeof showToast === "function") showToast("🔔 মিউট (আসছে)");
        } else if (act === "block") {
          var bb = document.getElementById("btn-block");
          if (bb) bb.click();
        } else if (act === "report") {
          var rb = document.getElementById("btn-report-user");
          if (rb) rb.click();
        }
      });
    });
  }, true);

  // ---- 5. Refresh profile ----
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-refresh-btn")) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var icon = e.target.closest("#profile-refresh-btn").querySelector("i");
    if (icon) {
      icon.style.transition = "transform 0.6s ease";
      icon.style.transform = "rotate(360deg)";
      setTimeout(function(){ icon.style.transition = ""; icon.style.transform = ""; }, 650);
    }
    if (typeof window.openProfile === "function") window.openProfile(data.user.username);
  }, true);

  // ---- 8/9. Follow state machine for OTHER profiles ----
  // Wrap window.openProfile to alter follow button based on is_requested/follows_me
  var _origOpenProfileB1 = window.openProfile;
  if (typeof _origOpenProfileB1 === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB1(username);
      // after render, adjust the follow button
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      if (isMe) return;

      var fb = document.getElementById("btn-follow");
      if (!fb) return;
      var stateAttr = "follow";
      if (data.is_following) stateAttr = "following";
      else if (data.is_requested) stateAttr = "requested";
      else if (data.follows_me) stateAttr = "follow-back";
      fb.dataset.followState = stateAttr;

      // adjust label
      var labelEl = fb.querySelector("span");
      var iconEl = fb.querySelector("i");
      if (stateAttr === "following") {
        if (labelEl) labelEl.textContent = "ফলো করছেন";
        if (iconEl) iconEl.className = "fa-solid fa-user-check";
      } else if (stateAttr === "requested") {
        if (labelEl) labelEl.textContent = "রিকোয়েস্ট পাঠানো";
        if (iconEl) iconEl.className = "fa-solid fa-clock";
      } else if (stateAttr === "follow-back") {
        if (labelEl) labelEl.textContent = "ফলো ব্যাক";
        if (iconEl) iconEl.className = "fa-solid fa-user-plus";
      } else {
        if (labelEl) labelEl.textContent = "ফলো করুন";
        if (iconEl) iconEl.className = "fa-solid fa-user-plus";
      }
    };
  }

  // ---- 10. Follow-requests banner (own profile) ----
  var _origOpenProfileB1b = window.openProfile;
  if (typeof _origOpenProfileB1b === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB1b(username);
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      var banner = document.getElementById("profile-follow-requests");
      if (!banner) return;
      if (!isMe) { banner.classList.add("hidden"); return; }
      try {
        var r = await window.api("/api/me/follow-requests/count");
        var n = (r && r.count) || 0;
        if (n > 0) {
          document.getElementById("frb-count").textContent = n + " জন অপেক্ষা করছেন";
          banner.classList.remove("hidden");
        } else {
          banner.classList.add("hidden");
        }
      } catch (err) { banner.classList.add("hidden"); }
    };
  }

  // ---- Banner open button → follow requests sheet ----
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#frb-open-btn")) return;
    e.preventDefault();
    (async function () {
      try {
        var list = await window.api("/api/me/follow-requests");
        if (!Array.isArray(list) || !list.length) {
          if (typeof showToast === "function") showToast("কোনো অনুরোধ নেই");
          return;
        }
        var old = document.getElementById("fr-list-sheet");
        if (old) old.remove();
        var sheet = document.createElement("div");
        sheet.id = "fr-list-sheet";
        sheet.className = "sheet-root";
        sheet.innerHTML =
          '<div class="sheet-backdrop"></div>' +
          '<div class="sheet-panel">' +
            '<div class="sheet-handle"></div>' +
            '<div class="sheet-header"><h3>ফলো রিকোয়েস্ট</h3>' +
            '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="sheet-body">' +
              list.map(function (u) {
                var av = u.profile_pic
                  ? '<img src="' + (window.escapeHtml ? escapeHtml(u.profile_pic) : u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
                  : (u.display_name || u.username || "?").charAt(0).toUpperCase();
                return '<div class="fr-row" data-uid="' + u.user_id + '">' +
                  '<div class="fr-av">' + av + '</div>' +
                  '<div class="fr-info">' +
                    '<div class="fr-name">' + (window.escapeHtml ? escapeHtml(u.display_name) : u.display_name) + '</div>' +
                    '<div class="fr-uname">@' + (window.escapeHtml ? escapeHtml(u.username) : u.username) + '</div>' +
                  '</div>' +
                  '<button class="fr-accept" data-uid="' + u.user_id + '">গ্রহণ</button>' +
                  '<button class="fr-reject" data-uid="' + u.user_id + '"><i class="fa-solid fa-xmark"></i></button>' +
                '</div>';
              }).join("") +
            '</div>' +
          '</div>';
        document.body.appendChild(sheet);
        document.body.classList.add("sheet-open");
        requestAnimationFrame(function () { sheet.classList.add("show"); });
        function close() {
          sheet.classList.remove("show");
          setTimeout(function () {
            if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
            document.body.classList.remove("sheet-open");
          }, 240);
        }
        sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
        sheet.querySelector(".sheet-close").addEventListener("click", close);
        sheet.querySelectorAll(".fr-accept").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              await window.api("/api/me/follow-requests/" + b.dataset.uid + "/accept", { method: "POST" });
              b.closest(".fr-row").remove();
              if (typeof showToast === "function") showToast("✅ গ্রহণ করা হয়েছে");
            } catch (err) { alert(err.message || "সমস্যা"); b.disabled = false; }
          });
        });
        sheet.querySelectorAll(".fr-reject").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              await window.api("/api/me/follow-requests/" + b.dataset.uid + "/reject", { method: "POST" });
              b.closest(".fr-row").remove();
              if (typeof showToast === "function") showToast("বাতিল");
            } catch (err) { alert(err.message || "সমস্যা"); b.disabled = false; }
          });
        });
      } catch (err) { alert(err.message || "লোড করা যায়নি"); }
    })();
  }, true);

  // ---- styles for follow-request sheet rows ----
  if (!document.getElementById("b1-fr-styles")) {
    var st = document.createElement("style");
    st.id = "b1-fr-styles";
    st.textContent =
      '.fr-row{display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid rgba(0,0,0,.05)}' +
      '.fr-row:last-child{border-bottom:0}' +
      '.fr-av{width:40px;height:40px;border-radius:50%;background:var(--gradient);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;overflow:hidden;flex-shrink:0}' +
      '.fr-av img{width:100%;height:100%;object-fit:cover}' +
      '.fr-info{flex:1;min-width:0}' +
      '.fr-name{font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.fr-uname{font-size:12px;color:var(--muted)}' +
      '.fr-accept{padding:6px 14px;border-radius:8px;background:var(--accent);color:#fff;border:0;font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit}' +
      '.fr-reject{width:34px;height:34px;border-radius:50%;background:rgba(0,0,0,.05);border:0;color:var(--muted);font-size:13px;cursor:pointer;flex-shrink:0;margin-left:4px}' +
      'body.dark .fr-reject{background:rgba(255,255,255,.06)}';
    document.head.appendChild(st);
  }

  console.log("[Batch1] profile buttons 1-10 ready");
})();


// ==================================================
// Batch 2 — Profile buttons 11-20
// ==================================================
(function () {
  "use strict";
  if (window.__batch2Profile) return;
  window.__batch2Profile = true;

  function _sheet(html, id) {
    var old = document.getElementById(id);
    if (old) old.remove();
    var sheet = document.createElement("div");
    sheet.id = id;
    sheet.className = "sheet-root";
    sheet.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });
    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 240);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = sheet.querySelector(".sheet-close");
    if (x) x.addEventListener("click", close);
    return { root: sheet, close: close };
  }

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s || "").replace(/[<>&"']/g, function (c) {
      return { "<":"&lt;", ">":"&gt;", "&":"&amp;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }

  function _av(name, pic) {
    if (pic) return '<img src="' + _esc(pic) + '" alt="" loading="lazy" decoding="async">';
    return _esc((name || "?").charAt(0).toUpperCase());
  }

  // ============ 11. Reject follow request (already in batch 1 sheet) — ensure it exists ============
  // (batch 1 handles it)

  // ============ 12. Remove follower (own profile) ============
  document.addEventListener("click", function (e) {
    // Hook into existing followers-count stat click → opens list with remove buttons
    var statEls = document.querySelectorAll(".profile-stats .stat-item .stat-num");
    if (!statEls.length) return;
    if (!e.target.closest(".profile-stats")) return;
    var clicked = e.target.closest(".stat-item");
    if (!clicked) return;
    var idx = Array.prototype.indexOf.call(clicked.parentNode.children, clicked);
    if (idx !== 1) return; // only "followers"
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    if (!window.state || !window.state.me || window.state.me.username !== data.user.username) return;
    e.preventDefault();
    e.stopPropagation();
    (async function () {
      try {
        var list = await window.api("/api/users/" + encodeURIComponent(data.user.username) + "/followers");
        var s = _sheet(
          '<div class="sheet-panel">' +
            '<div class="sheet-handle"></div>' +
            '<div class="sheet-header"><h3>ফলোয়ার</h3>' +
            '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="sheet-body">' +
              (list.length
                ? list.map(function (u) {
                    return '<div class="b2-list-row">' +
                      '<div class="b2-list-av">' + _av(u.display_name, u.profile_pic) + '</div>' +
                      '<div class="b2-list-info">' +
                        '<div class="b2-list-name">' + _esc(u.display_name) + '</div>' +
                        '<div class="b2-list-uname">@' + _esc(u.username) + '</div>' +
                      '</div>' +
                      '<button class="b2-list-action danger" data-remove="' + _esc(u.username) + '">সরান</button>' +
                    '</div>';
                  }).join("")
                : '<p style="text-align:center;padding:30px;color:var(--muted)">কোনো ফলোয়ার নেই</p>') +
            '</div>' +
          '</div>', "b2-followers-sheet");
        s.root.querySelectorAll("[data-remove]").forEach(function (b) {
          b.addEventListener("click", async function () {
            if (!confirm("@" + b.dataset.remove + " কে ফলোয়ার থেকে সরাবেন?")) return;
            b.disabled = true;
            try {
              // find user_id
              var list2 = await window.api("/api/users/" + encodeURIComponent(b.dataset.remove));
              if (!list2 || !list2.user) throw new Error("ইউজার পাওয়া যায়নি");
              await window.api("/api/me/followers/" + list2.user.id + "/remove", { method: "POST" });
              b.closest(".b2-list-row").remove();
              if (typeof showToast === "function") showToast("✅ সরানো হয়েছে");
            } catch (err) { alert(err.message || "সমস্যা"); b.disabled = false; }
          });
        });
      } catch (err) { alert(err.message || "লোড করা যায়নি"); }
    })();
  }, true);

  // ============ 15/16. Close Friends & Favorites tiles ============
  function _openCfList(mode) {
    var url  = mode === "close" ? "/api/me/close-friends" : "/api/me/favorites";
    var flag = mode === "close" ? "is_close" : "is_favorite";
    var title = mode === "close" ? "Close Friends" : "Favorites";
    var toggleUrl = mode === "close" ? "/close-friend" : "/favorite";

    (async function () {
      try {
        var current = await window.api(url);
        var curNames = {};
        (current || []).forEach(function (u) { curNames[u.username] = true; });

        var all = await window.api("/api/me/following-list");
        var html = (all || []).map(function (u) {
          var isOn = !!u[flag];
          return '<div class="b2-list-row">' +
            '<div class="b2-list-av">' + _av(u.display_name, u.profile_pic) + '</div>' +
            '<div class="b2-list-info">' +
              '<div class="b2-list-name">' + _esc(u.display_name) + '</div>' +
              '<div class="b2-list-uname">@' + _esc(u.username) + '</div>' +
            '</div>' +
            '<button class="b2-list-action' + (isOn ? " on" : "") + '" data-toggle="' + _esc(u.username) + '" data-on="' + (isOn ? "1" : "0") + '">' +
              (isOn ? "✓ " + title : "যোগ") +
            '</button>' +
          '</div>';
        }).join("");

        var s = _sheet(
          '<div class="sheet-panel">' +
            '<div class="sheet-handle"></div>' +
            '<div class="sheet-header"><h3>' + title + '</h3>' +
            '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="sheet-body">' +
              (all && all.length
                ? html
                : '<p style="text-align:center;padding:30px;color:var(--muted)">আপনি এখনো কাউকে ফলো করেননি</p>') +
            '</div>' +
          '</div>', "b2-cf-sheet");

        s.root.querySelectorAll("[data-toggle]").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              var r = await window.api("/api/users/" + encodeURIComponent(b.dataset.toggle) + toggleUrl, { method: "POST" });
              var on = mode === "close" ? r.is_close : r.is_favorite;
              b.classList.toggle("on", on);
              b.textContent = on ? "✓ " + title : "যোগ";
            } catch (err) { alert(err.message || "সমস্যা"); }
            finally { b.disabled = false; }
          });
        });
      } catch (err) { alert(err.message || "লোড করা যায়নি"); }
    })();
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("#cf-close-open")) {
      e.preventDefault(); _openCfList("close");
    } else if (e.target.closest("#cf-fav-open")) {
      e.preventDefault(); _openCfList("fav");
    }
  }, true);

  // show tiles + counts on own profile
  var _origOpenProfileB2 = window.openProfile;
  if (typeof _origOpenProfileB2 === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB2(username);
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      var row = document.getElementById("profile-cf-row");
      if (!row) return;
      if (!isMe) { row.classList.add("hidden"); return; }
      try {
        var c1 = await window.api("/api/me/close-friends");
        var c2 = await window.api("/api/me/favorites");
        document.getElementById("cf-close-count").textContent = (c1 || []).length;
        document.getElementById("cf-fav-count").textContent = (c2 || []).length;
        row.classList.remove("hidden");
      } catch (err) { row.classList.add("hidden"); }
    };
  }

  // ============ 17. Message icon in topbar ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-msg-btn")) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    // S39 — button is hidden on own profile (see window.openProfile), so this
    // only fires on others. Safety check kept just in case:
    if (window.state && window.state.me && window.state.me.username === data.user.username) {
      return;
    }
    // close profile, open chat
    var p = document.getElementById("profile-page");
    if (p) p.classList.add("hidden");
    setTimeout(function () {
      if (typeof window.openMessagesPage === "function") {
        window.openMessagesPage().then(function () {
          if (typeof openChat === "function") openChat(data.user.username);
        });
      }
    }, 150);
  }, true);

  // ============ 20. Voice + Video call buttons in profile-buttons ============
  // Patch the profile-buttons rendering so voice/video circle buttons appear next to message
  var _origOpenProfileB2b = window.openProfile;
  if (typeof _origOpenProfileB2b === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB2b(username);
      return;   // S39 — disabled: voice/video injection removed (handled by main window.openProfile)
      // eslint-disable-next-line no-unreachable
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      if (isMe) return;
      var btns = document.getElementById("profile-buttons");
      if (!btns) return;
      if (btns.dataset.b2Patched === "1") return;
      btns.dataset.b2Patched = "1";

      // add voice + video circles before block/report
      var voice = document.createElement("button");
      voice.className = "btn-call-circle";
      voice.id = "btn-profile-voice";
      voice.title = "Voice call";
      voice.innerHTML = '<i class="fa-solid fa-phone"></i>';

      var video = document.createElement("button");
      video.className = "btn-call-circle";
      video.id = "btn-profile-video";
      video.title = "Video call";
      video.innerHTML = '<i class="fa-solid fa-video"></i>';

      var msgBtn = btns.querySelector("#btn-msg");
      if (msgBtn) {
        msgBtn.parentNode.insertBefore(video, msgBtn.nextSibling);
        msgBtn.parentNode.insertBefore(voice, msgBtn.nextSibling);
      } else {
        btns.appendChild(voice);
        btns.appendChild(video);
      }

      voice.addEventListener("click", function () {
        if (typeof window.startVoiceCall === "function") {
          window.startVoiceCall(data.user.username);
        } else if (typeof showToast === "function") {
          showToast("📞 কল মডিউল লোড হচ্ছে...");
        }
      });
      video.addEventListener("click", function () {
        if (typeof window.startVideoCall === "function") {
          window.startVideoCall(data.user.username);
        } else if (typeof showToast === "function") {
          showToast("📹 কল মডিউল লোড হচ্ছে...");
        }
      });
    };
  }

  // ============ 18/19. Message request flow ============
  // Wrap sendMessage: if recipient isn't following us, use /request/send
  var _origOpenChatB2 = window.openChat;
  if (typeof _origOpenChatB2 === "function") {
    // We hook into chat send via document-level listener; safer approach:
    // add a small indicator when opening a chat with an unverified user
    window.openChat = async function (username) {
      await _origOpenChatB2(username);
      // Show a subtle hint bar if the chat-input exists and receiver isn't a mutual
      var inp = document.getElementById("chat-input");
      if (!inp) return;
      // Fetch state to decide
      try {
        var p = await window.api("/api/users/" + encodeURIComponent(username));
        var theyFollowMe = !!(p && p.follows_me);
        var chatHeader = document.querySelector(".chat-header");
        var oldHint = document.getElementById("b2-msg-request-hint");
        if (oldHint) oldHint.remove();
        if (!theyFollowMe && chatHeader) {
          var hint = document.createElement("div");
          hint.id = "b2-msg-request-hint";
          hint.style.cssText =
            "padding:6px 12px;font-size:11.5px;font-weight:700;" +
            "background:linear-gradient(135deg,rgba(255,107,107,0.12),rgba(251,146,60,0.08));" +
            "color:var(--accent);text-align:center;border-bottom:1px solid var(--border-soft);";
          hint.textContent = "📨 এটা মেসেজ রিকোয়েস্ট — গ্রহণ করলে চ্যাট শুরু হবে";
          chatHeader.parentNode.insertBefore(hint, chatHeader.nextSibling);
        }
      } catch (e) {}
    };
  }

  // Accept message requests sheet (open from messages topbar / inbox)
  // Add a hint icon in the messages-topbar
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#b2-msg-requests-btn")) return;
    e.preventDefault();
    (async function () {
      try {
        var list = await window.api("/api/messages/requests");
        var s = _sheet(
          '<div class="sheet-panel">' +
            '<div class="sheet-handle"></div>' +
            '<div class="sheet-header"><h3>মেসেজ রিকোয়েস্ট</h3>' +
            '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="sheet-body">' +
              (list && list.length
                ? list.map(function (r) {
                    return '<div class="b2-list-row">' +
                      '<div class="b2-list-av">' + _av(r.display_name, r.profile_pic) + '</div>' +
                      '<div class="b2-list-info">' +
                        '<div class="b2-list-name">' + _esc(r.display_name) + '</div>' +
                        '<div class="b2-list-uname">@' + _esc(r.username) + ' · ' + _esc((r.content || "").slice(0, 40)) + '</div>' +
                      '</div>' +
                      '<button class="b2-list-action on" data-accept="' + r.id + '">গ্রহণ</button>' +
                      '<button class="b2-list-action danger" data-reject="' + r.id + '" style="margin-left:4px">বাতিল</button>' +
                    '</div>';
                  }).join("")
                : '<p style="text-align:center;padding:30px;color:var(--muted)">কোনো মেসেজ রিকোয়েস্ট নেই</p>') +
            '</div>' +
          '</div>', "b2-msg-requests-sheet");

        s.root.querySelectorAll("[data-accept]").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              await window.api("/api/messages/requests/" + b.dataset.accept + "/accept", { method: "POST" });
              b.closest(".b2-list-row").remove();
              if (typeof showToast === "function") showToast("✅ গ্রহণ করা হয়েছে");
            } catch (err) { alert(err.message || "সমস্যা"); b.disabled = false; }
          });
        });
        s.root.querySelectorAll("[data-reject]").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              await window.api("/api/messages/requests/" + b.dataset.reject + "/reject", { method: "POST" });
              b.closest(".b2-list-row").remove();
            } catch (err) { alert(err.message || "সমস্যা"); b.disabled = false; }
          });
        });
      } catch (err) { alert(err.message || "লোড করা যায়নি"); }
    })();
  }, true);

  console.log("[Batch2] profile buttons 11-20 ready");
})();


// ==================================================
// Batch 3 — Profile buttons 21-30
// ==================================================
(function () {
  "use strict";
  if (window.__batch3Profile) return;
  window.__batch3Profile = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s || "").replace(/[<>&"']/g, function (c) {
      return { "<":"&lt;", ">":"&gt;", "&":"&amp;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }

  function _sheet(html, id) {
    var old = document.getElementById(id);
    if (old) old.remove();
    var sheet = document.createElement("div");
    sheet.id = id;
    sheet.className = "sheet-root";
    sheet.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });
    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 240);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = sheet.querySelector(".sheet-close");
    if (x) x.addEventListener("click", close);
    return { root: sheet, close: close };
  }

  function _profileUrl(username) {
    return window.location.origin + "/u/" + encodeURIComponent(username);
  }

  // ============ 21-26. Share sheet with copy/native/whatsapp/telegram/email/dm ============
  function _openShareSheet(username, displayName) {
    var url = _profileUrl(username);
    var text = (displayName || username) + " — JUKTOY-এ দেখুন";

    var s = _sheet(
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>শেয়ার করুন</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:6px 12px 14px">' +
          _row("copy", "bg-copy", "fa-link", "লিংক কপি করুন", "clipboard") +
          _row("native", "bg-nat", "fa-share-nodes", "আরো অপশন", "native share") +
          _row("whatsapp", "bg-wa", "fa-brands fa-whatsapp", "WhatsApp", "chat app") +
          _row("telegram", "bg-tg", "fa-brands fa-telegram", "Telegram", "chat app") +
          _row("email", "bg-mail", "fa-envelope", "Email", "mailto link") +
          _row("dm", "bg-dm", "fa-comment-dots", "JUKTOY DM", "pick a friend") +
        '</div>' +
      '</div>', "b3-share-sheet");

    function _row(a, bg, icon, label, sub) {
      var ic = icon.indexOf("fa-brands") === 0 ? icon : ("fa-solid " + icon);
      return '<div class="b3-share-row" data-act="' + a + '">' +
        '<div class="b3-share-icon ' + bg + '"><i class="' + ic + '"></i></div>' +
        '<div class="b3-share-label">' + _esc(label) +
          '<div class="b3-share-sub">' + _esc(sub) + '</div></div>' +
      '</div>';
    }

    s.root.querySelectorAll(".b3-share-row").forEach(function (r) {
      r.addEventListener("click", async function () {
        var act = r.dataset.act;
        if (act === "copy") {
          try {
            await navigator.clipboard.writeText(url);
            if (typeof showToast === "function") showToast("🔗 লিংক কপি হয়েছে");
          } catch (e) { alert("কপি করা যায়নি"); }
          s.close();
        } else if (act === "native") {
          if (navigator.share) {
            try { await navigator.share({ title: "JUKTOY", text: text, url: url }); } catch (e) {}
          } else {
            try { await navigator.clipboard.writeText(url); if (typeof showToast === "function") showToast("🔗 কপি হয়েছে"); } catch (e) {}
          }
          s.close();
        } else if (act === "whatsapp") {
          window.open("https://wa.me/?text=" + encodeURIComponent(text + " " + url), "_blank");
          s.close();
        } else if (act === "telegram") {
          window.open("https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(text), "_blank");
          s.close();
        } else if (act === "email") {
          window.location.href = "mailto:?subject=" + encodeURIComponent("JUKTOY — " + displayName) + "&body=" + encodeURIComponent(text + "\n\n" + url);
          s.close();
        } else if (act === "dm") {
          s.close();
          _openShareDM(username, url);
        }
      });
    });
  }

  function _openShareDM(username, url) {
    var s = _sheet(
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>কে পাঠাবেন?</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:8px 12px">' +
          '<div class="input-group" style="margin-bottom:10px">' +
            '<i class="fa-solid fa-magnifying-glass input-icon"></i>' +
            '<input type="text" id="b3-dm-search" placeholder="ইউজারনেম লিখুন...">' +
          '</div>' +
          '<div id="b3-dm-list"><p style="text-align:center;padding:20px;color:var(--muted)">লোড হচ্ছে...</p></div>' +
        '</div>' +
      '</div>', "b3-dm-sheet");

    var listEl = s.root.querySelector("#b3-dm-list");
    var input = s.root.querySelector("#b3-dm-search");

    async function load(q) {
      try {
        var users = await window.api("/api/users?q=" + encodeURIComponent(q || ""));
        var filtered = (users || []).filter(function (u) { return u.username !== username; });
        if (!filtered.length) {
          listEl.innerHTML = '<p style="text-align:center;padding:20px;color:var(--muted)">কেউ পাওয়া যায়নি</p>';
          return;
        }
        listEl.innerHTML = filtered.map(function (u) {
          var av = u.profile_pic
            ? '<img src="' + _esc(u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
            : _esc((u.display_name || "?").charAt(0).toUpperCase());
          return '<div class="b3-share-row" data-to="' + _esc(u.username) + '">' +
            '<div class="b3-share-icon bg-dm" style="overflow:hidden">' + av + '</div>' +
            '<div class="b3-share-label">' + _esc(u.display_name) +
              '<div class="b3-share-sub">@' + _esc(u.username) + '</div></div>' +
          '</div>';
        }).join("");
        listEl.querySelectorAll("[data-to]").forEach(function (b) {
          b.addEventListener("click", async function () {
            var to = b.dataset.to;
            b.disabled = true;
            try {
              await window.api("/api/messages/" + encodeURIComponent(to), {
                method: "POST",
                body: JSON.stringify({ content: "🔗 প্রোফাইল দেখুন: " + url })
              });
              if (typeof showToast === "function") showToast("✅ পাঠানো হয়েছে");
              s.close();
            } catch (err) { alert(err.message || "পাঠানো যায়নি"); b.disabled = false; }
          });
        });
      } catch (err) {
        listEl.innerHTML = '<p style="text-align:center;padding:20px;color:var(--danger)">লোড করা যায়নি</p>';
      }
    }
    load("");
    var t = null;
    input.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () { load(input.value.trim()); }, 220);
    });
  }

  // Hook into profile share button to open new sheet (replace old native-only)
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#btn-share-profile")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    _openShareSheet(data.user.username, data.user.display_name);
  }, true);

  // Also hook the "⋮" menu Share to open new sheet
  document.addEventListener("click", function (e) {
    var it = e.target.closest(".sheet-menu-item[data-act='share']");
    if (!it) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    // close existing sheet
    var open = document.querySelector(".sheet-root.show");
    if (open) { open.classList.remove("show"); setTimeout(function(){ if (open.parentNode) open.parentNode.removeChild(open); document.body.classList.remove("sheet-open"); }, 200); }
    setTimeout(function () { _openShareSheet(data.user.username, data.user.display_name); }, 220);
  }, true);

  // ============ 27. QR code (own profile) ============
  // Simple SVG QR-like visualization (not scannable but visually authentic)
  function _miniQR(text) {
    // build a deterministic pseudo-QR from hash of text
    var h = 0;
    for (var i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    var size = 21; // 21x21 like v1 QR
    var cells = [];
    // finder patterns (3 corners)
    function isFinder(r, c) {
      // top-left 7x7
      if (r < 7 && c < 7) return (r === 0 || r === 6 || c === 0 || c === 6 ||
                                  (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      // top-right
      if (r < 7 && c >= size - 7) {
        var cc = c - (size - 7);
        return (r === 0 || r === 6 || cc === 0 || cc === 6 ||
                (r >= 2 && r <= 4 && cc >= 2 && cc <= 4));
      }
      // bottom-left
      if (r >= size - 7 && c < 7) {
        var rr = r - (size - 7);
        return (rr === 0 || rr === 6 || c === 0 || c === 6 ||
                (rr >= 2 && rr <= 4 && c >= 2 && c <= 4));
      }
      return null;
    }
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var finder = isFinder(r, c);
        var on;
        if (finder !== null) {
          on = finder;
        } else {
          var seed = (h ^ (r * 31 + c * 17)) & 0xFFFF;
          on = ((seed * 2654435761) & 0xFFFF) % 3 !== 0;
        }
        cells.push({ r: r, c: c, on: on });
      }
    }
    var px = 6; // each cell 6px
    var dim = size * px + 8; // padding
    var rects = cells.map(function (c) {
      if (!c.on) return "";
      return '<rect x="' + (c.c * px + 4) + '" y="' + (c.r * px + 4) +
             '" width="' + px + '" height="' + px + '" fill="#050505"/>';
    }).join("");
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + dim + '" height="' + dim +
           '" viewBox="0 0 ' + dim + ' ' + dim + '" style="background:#fff;border-radius:12px">' +
           rects + '</svg>';
  }

  document.addEventListener("click", function (e) {
    if (!e.target.closest("#qr-open-btn")) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var url = _profileUrl(data.user.username);
    var wrap = document.getElementById("qr-image-wrap");
    if (wrap) wrap.innerHTML = _miniQR(url);
    var nameEl = document.getElementById("qr-username");
    if (nameEl) nameEl.textContent = "@" + data.user.username;
    var modal = document.getElementById("qr-modal");
    if (modal) modal.classList.remove("hidden");
  }, true);

  document.addEventListener("click", function (e) {
    if (e.target.closest("#qr-close")) {
      var m = document.getElementById("qr-modal");
      if (m) m.classList.add("hidden");
    } else if (e.target.closest("#qr-copy")) {
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      navigator.clipboard.writeText(_profileUrl(data.user.username)).then(function () {
        if (typeof showToast === "function") showToast("🔗 লিংক কপি");
      });
    }
  }, true);

  // ============ 28. Wave (👋) ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#btn-profile-wave")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var btn = e.target.closest("#btn-profile-wave");
    btn.disabled = true;
    window.api("/api/users/" + encodeURIComponent(data.user.username) + "/wave", { method: "POST" })
      .then(function () {
        if (typeof showToast === "function") showToast("👋 Wave পাঠানো হয়েছে");
        // brief pulse animation
        btn.style.transform = "scale(1.2)";
        setTimeout(function(){ btn.style.transform = ""; }, 200);
      })
      .catch(function (err) { alert(err.message || "পাঠানো যায়নি"); })
      .finally(function () { btn.disabled = false; });
  }, true);

  // ============ 29. Save profile (bookmark) ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#btn-profile-save")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var btn = e.target.closest("#btn-profile-save");
    btn.disabled = true;
    window.api("/api/users/" + encodeURIComponent(data.user.username) + "/save-profile", { method: "POST" })
      .then(function (r) {
        btn.classList.toggle("on", !!r.saved);
        var icon = btn.querySelector("i");
        if (icon) icon.className = r.saved ? "fa-solid fa-bookmark" : "fa-regular fa-bookmark";
        if (typeof showToast === "function") showToast(r.saved ? "🔖 সেভ হয়েছে" : "সেভ সরানো হয়েছে");
      })
      .catch(function (err) { alert(err.message || "সমস্যা"); })
      .finally(function () { btn.disabled = false; });
  }, true);

  // ============ 30. Notify bell ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#btn-profile-notify")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var btn = e.target.closest("#btn-profile-notify");
    btn.disabled = true;
    window.api("/api/users/" + encodeURIComponent(data.user.username) + "/notify", { method: "POST" })
      .then(function (r) {
        btn.classList.toggle("on", !!r.notify);
        var icon = btn.querySelector("i");
        if (icon) icon.className = r.notify ? "fa-solid fa-bell" : "fa-regular fa-bell";
        if (typeof showToast === "function") showToast(r.notify ? "🔔 নোটিফিকেশন চালু" : "🔕 বন্ধ করা হয়েছে");
      })
      .catch(function (err) { alert(err.message || "সমস্যা"); })
      .finally(function () { btn.disabled = false; });
  }, true);

  // ============ Attach new buttons to profile-buttons on open ============
  var _origOpenProfileB3 = window.openProfile;
  if (typeof _origOpenProfileB3 === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB3(username);
      return;   // S39 — disabled: wave/save/bell injection removed (handled by main window.openProfile)
      // eslint-disable-next-line no-unreachable
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      var btns = document.getElementById("profile-buttons");
      if (!btns) return;
      if (btns.dataset.b3 === "1") return;
      btns.dataset.b3 = "1";

      if (isMe) {
        // own profile → add QR button
        var qrBtn = document.createElement("button");
        qrBtn.id = "qr-open-btn";
        qrBtn.className = "btn-icon-circle";
        qrBtn.title = "QR কোড";
        qrBtn.innerHTML = '<i class="fa-solid fa-qrcode"></i>';
        btns.appendChild(qrBtn);
      } else {
        // other's profile → add wave, save, notify
        var waveBtn = document.createElement("button");
        waveBtn.id = "btn-profile-wave";
        waveBtn.className = "btn-icon-circle";
        waveBtn.title = "Wave 👋";
        waveBtn.innerHTML = '<i class="fa-regular fa-hand"></i>';

        var saveBtn = document.createElement("button");
        saveBtn.id = "btn-profile-save";
        saveBtn.className = "btn-icon-circle";
        saveBtn.title = "Save profile";
        saveBtn.innerHTML = '<i class="fa-regular fa-bookmark"></i>';

        var bellBtn = document.createElement("button");
        bellBtn.id = "btn-profile-notify";
        bellBtn.className = "btn-icon-circle";
        bellBtn.title = "Notify on posts";
        bellBtn.innerHTML = '<i class="fa-regular fa-bell"></i>';

        // insert after message btn if present
        var msgBtn = btns.querySelector("#btn-msg");
        if (msgBtn) {
          msgBtn.parentNode.insertBefore(waveBtn, msgBtn.nextSibling);
          msgBtn.parentNode.insertBefore(saveBtn, waveBtn.nextSibling);
          msgBtn.parentNode.insertBefore(bellBtn, saveBtn.nextSibling);
        } else {
          btns.appendChild(waveBtn);
          btns.appendChild(saveBtn);
          btns.appendChild(bellBtn);
        }

        // load saved/notify status
        try {
          var st = await window.api("/api/me/save-background-check", {
            method: "POST",
            body: JSON.stringify({ username: data.user.username })
          });
          if (st.saved) {
            saveBtn.classList.add("on");
            saveBtn.querySelector("i").className = "fa-solid fa-bookmark";
          }
          if (st.notify) {
            bellBtn.classList.add("on");
            bellBtn.querySelector("i").className = "fa-solid fa-bell";
          }
        } catch (e) {}
      }
    };
  }

  console.log("[Batch3] profile buttons 21-30 ready");
})();


// ===== Batch 4 — Profile tabs + Share to Story + Embed =====
(function () {
  "use strict";
  if (window.__batch4) return;
  window.__batch4 = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function _hideAllPanes() {
    ["posts","reels","photos","tagged","liked","saved","about"].forEach(function (n) {
      var el = document.getElementById("profile-tab-" + n);
      if (el) el.classList.add("hidden");
    });
  }

  function _showPane(name) {
    var el = document.getElementById("profile-tab-" + name);
    if (el) el.classList.remove("hidden");
  }

  async function _renderReels(username) {
    var pane = document.getElementById("profile-tab-reels");
    if (!pane) return;
    pane.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await window.api("/api/users/" + encodeURIComponent(username) + "/reels-list");
      if (!list.length) {
        pane.innerHTML = '<div class="pf-reels-empty">🎬 এখনো কোনো রিল নেই</div>';
        return;
      }
      pane.innerHTML = '<div class="pf-reels-grid">' + list.map(function (r) {
        return '<div class="pf-reel-cell" data-id="' + r.id + '">' +
          '<video src="' + _esc(r.video) + '" muted playsinline preload="metadata"></video>' +
          '<div class="pf-reel-views"><i class="fa-solid fa-heart"></i>' + (r.likes||0) + '</div>' +
        '</div>';
      }).join("") + '</div>';
      pane.querySelectorAll(".pf-reel-cell").forEach(function (c) {
        c.addEventListener("click", function () {
          if (typeof openReelsPage === "function") openReelsPage();
        });
      });
    } catch (err) {
      pane.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>';
    }
  }

  async function _renderTagged(username) {
    var pane = document.getElementById("profile-tab-tagged");
    if (!pane) return;
    pane.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await window.api("/api/users/" + encodeURIComponent(username) + "/tagged-posts");
      if (!list.length) {
        pane.innerHTML = '<div class="pf-tagged-empty">📌 এখনো কেউ ট্যাগ করেনি</div>';
        return;
      }
      pane.innerHTML = list.map(function (p) {
        return '<div class="profile-post" data-post-id="' + p.id + '" data-user="' + _esc(p.username) + '">' +
          '<div class="pp-head" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
            '<strong style="font-size:13.5px">' + _esc(p.display_name) + '</strong>' +
            '<span style="color:var(--muted);font-size:12px">@' + _esc(p.username) + '</span>' +
          '</div>' +
          '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(p.content) : _esc(p.content)) + '</div>' +
          '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(p.created_at) : p.created_at) + '</div>' +
        '</div>';
      }).join("");
      if (window.attachHashtagListeners) attachHashtagListeners(pane);
    } catch (err) {
      pane.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>';
    }
  }

  async function _renderLiked() {
    var pane = document.getElementById("profile-tab-liked");
    if (!pane) return;
    pane.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await window.api("/api/me/liked-posts");
      if (!list.length) {
        pane.innerHTML = '<div class="pf-tagged-empty">❤️ এখনো কিছু লাইক করেননি</div>';
        return;
      }
      pane.innerHTML = list.map(function (p) {
        return '<div class="profile-post">' +
          '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(p.content) : _esc(p.content)) + '</div>' +
          '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(p.created_at) : p.created_at) + ' · @' + _esc(p.username) + '</div>' +
        '</div>';
      }).join("");
      if (window.attachHashtagListeners) attachHashtagListeners(pane);
    } catch (err) {
      pane.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>';
    }
  }

  async function _renderSaved() {
    var pane = document.getElementById("profile-tab-saved");
    if (!pane) return;
    pane.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await window.api("/api/me/saved-posts");
      if (!list.length) {
        pane.innerHTML = '<div class="pf-tagged-empty">🔖 এখনো কিছু সেভ করেননি</div>';
        return;
      }
      pane.innerHTML = list.map(function (p) {
        return '<div class="profile-post">' +
          '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(p.content) : _esc(p.content)) + '</div>' +
          '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(p.created_at) : p.created_at) + ' · @' + _esc(p.username) + '</div>' +
        '</div>';
      }).join("");
      if (window.attachHashtagListeners) attachHashtagListeners(pane);
    } catch (err) {
      pane.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>';
    }
  }


  // Hide liked/saved tabs on OTHER profiles, show only on own
  var _origOpenProfileB4 = window.openProfile;
  if (typeof _origOpenProfileB4 === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB4(username);
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      var liked = document.getElementById("pt-liked");
      var saved = document.getElementById("pt-saved");
      if (liked) liked.style.display = isMe ? "" : "none";
      if (saved) saved.style.display = isMe ? "" : "none";

      // auto-refresh reels count in tab
      try {
        var reels = await window.api("/api/users/" + encodeURIComponent(data.user.username) + "/reels-list");
        var rTab = document.querySelector('.profile-tab[data-tab="reels"]');
        if (rTab && reels.length) {
          var base = rTab.textContent.replace(/\(\d+\)/, "").trim();
          rTab.innerHTML = '<i class="fa-solid fa-film"></i> রিল (' + reels.length + ')';
        }
      } catch (e) {}
    };
  }

  // ===== 31. Share to Story =====
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b4='share-story']");
    if (!b) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var url = window.location.origin + "/u/" + data.user.username;
    if (typeof showToast === "function") showToast("📸 স্টোরিতে শেয়ার — লিংক কপি হয়েছে");
    navigator.clipboard.writeText(url).catch(function(){});
  }, true);

  // ===== 33. Embed profile =====
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b4='embed']");
    if (!b) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var url = window.location.origin + "/u/" + data.user.username;
    var code = '<iframe src="' + url + '" width="400" height="600" frameborder="0"></iframe>';
    navigator.clipboard.writeText(code).then(function () {
      if (typeof showToast === "function") showToast("📋 Embed code কপি হয়েছে");
    }).catch(function () { alert(code); });
  }, true);

  // Add "Share to Story" + "Embed" to share sheet by extending it
  var _origOpenShareSheet = window._openShareSheet;
  // expose our own version — replace function
  window._openShareSheet = function (username, displayName) {
    // call original first
    if (typeof _origOpenShareSheet === "function") return _origOpenShareSheet(username, displayName);
  };

  console.log("[Batch4] tabs + share-story + embed ready");
  // S39 — Expose for unified profile tab handler
  window._hideAllPanes = _hideAllPanes;
  window._showPane = _showPane;
  window._renderReels = _renderReels;
  window._renderTagged = _renderTagged;
  window._renderLiked = _renderLiked;
  window._renderSaved = _renderSaved;

})();


// ===== Batch 5 — tabs reposts/archived + highlights + similar + live =====
(function () {
  "use strict";
  if (window.__batch5) return;
  window.__batch5 = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function _hideAll() {
    ["posts","reels","photos","tagged","liked","saved","reposts","archived","about"].forEach(function(n){
      var el = document.getElementById("profile-tab-"+n); if (el) el.classList.add("hidden");
    });
  }
  function _show(n) {
    var el = document.getElementById("profile-tab-"+n); if (el) el.classList.remove("hidden");
  }

  async function _renderReposts(username) {
    var p = document.getElementById("profile-tab-reposts");
    if (!p) return;
    p.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await window.api("/api/users/" + encodeURIComponent(username) + "/reposts-list");
      if (!list.length) { p.innerHTML = '<div class="pf-tagged-empty">🔁 এখনো রিপোস্ট নেই</div>'; return; }
      p.innerHTML = list.map(function (r) {
        return '<div class="profile-post">' +
          '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">' +
            '<i class="fa-solid fa-retweet" style="color:var(--accent)"></i>' +
            '<span style="font-size:12px;color:var(--muted)">@' + _esc(r.username) + '</span>' +
          '</div>' +
          '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(r.content) : _esc(r.content)) + '</div>' +
          '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(r.reposted_at) : r.reposted_at) + '</div>' +
        '</div>';
      }).join("");
    } catch (e) { p.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>'; }
  }

  async function _renderArchived() {
    var p = document.getElementById("profile-tab-archived");
    if (!p) return;
    p.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await window.api("/api/me/archived-posts");
      if (!list.length) { p.innerHTML = '<div class="pf-tagged-empty">📦 কোনো আর্কাইভ নেই</div>'; return; }
      p.innerHTML = list.map(function (r) {
        return '<div class="profile-post">' +
          '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(r.content) : _esc(r.content)) + '</div>' +
          '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(r.created_at) : r.created_at) + '</div>' +
        '</div>';
      }).join("");
    } catch (e) { p.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>'; }
  }


  // enrich window.openProfile: highlights + similar + pinned + live + hide own-only tabs
  var _orig = window.openProfile;
  if (typeof _orig === "function") {
    window.openProfile = async function (username) {
      await _orig(username);
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;

      // own-only tabs hide
      ["pt-liked","pt-saved"].forEach(function(id){
        var el = document.getElementById(id);
        if (el) el.style.display = isMe ? "" : "none";
      });

      // live badge
      var nameRow = document.querySelector("#profile-page .profile-name-row h2");
      if (nameRow) {
        var oldBadge = nameRow.parentNode.querySelector(".pf-live-badge");
        if (oldBadge) oldBadge.remove();
        if (data.user.is_live) {
          var b = document.createElement("span");
          b.className = "pf-live-badge";
          b.textContent = "LIVE";
          nameRow.appendChild(b);
        }
      }

      // highlights row
      var hlRow = document.getElementById("profile-highlights");
      if (hlRow) {
        try {
          var hls = await window.api("/api/users/" + encodeURIComponent(username) + "/highlights");
          var html = (hls || []).map(function (h) {
            return '<div class="pf-highlight" data-hl="' + h.id + '">' +
              '<div class="pf-hl-cover">' +
                '<img src="' + _esc(h.cover) + '" alt="" loading="lazy" decoding="async">' +
              '</div>' +
              '<div class="pf-hl-title">' + _esc(h.title) + '</div>' +
            '</div>';
          }).join("");
          if (isMe) {
            html += '<div class="pf-highlight add-hl" id="pf-add-hl">' +
              '<div class="pf-hl-cover"><i class="fa-solid fa-plus"></i></div>' +
              '<div class="pf-hl-title">নতুন</div>' +
            '</div>';
          }
          hlRow.innerHTML = html;
          hlRow.classList.toggle("hidden", !html);
          var addBtn = document.getElementById("pf-add-hl");
          if (addBtn) {
            addBtn.addEventListener("click", function () {
              if (typeof showToast === "function") showToast("✨ Highlights আসছে");
            });
          }
        } catch (e) { hlRow.classList.add("hidden"); }
      }

      // similar accounts (other profiles only)
      var simEl = document.getElementById("profile-similar");
      if (simEl) {
        if (isMe) { simEl.classList.add("hidden"); }
        else {
          try {
            var sim = await window.api("/api/users/" + encodeURIComponent(username) + "/similar");
            if (!sim.length) { simEl.classList.add("hidden"); }
            else {
              simEl.innerHTML = '<div class="pf-sim-title">👥 মিলে যায় এমন অ্যাকাউন্ট</div>' +
                '<div class="pf-sim-row">' +
                  sim.map(function (u) {
                    var av = u.profile_pic ? '<img src="' + _esc(u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
                                            : _esc((u.display_name||"?").charAt(0).toUpperCase());
                    return '<div class="pf-sim-item" data-user="' + _esc(u.username) + '">' +
                      '<div class="pf-sim-av">' + av + '</div>' +
                      '<div class="pf-sim-name">' + _esc(u.display_name) + '</div>' +
                    '</div>';
                  }).join("") +
                '</div>';
              simEl.classList.remove("hidden");
              simEl.querySelectorAll("[data-user]").forEach(function (c) {
                c.addEventListener("click", function () {
                  if (typeof window.openProfile === "function") window.openProfile(c.dataset.user);
                });
              });
            }
          } catch (e) { simEl.classList.add("hidden"); }
        }
      }

      // pinned post (prepend as a card at top of posts pane)
      if (data.pinned_post) {
        var postsPane = document.getElementById("profile-tab-posts");
        if (postsPane && !postsPane.dataset.pinnedRendered) {
          postsPane.dataset.pinnedRendered = "1";
          var pinnedHtml = '<div class="profile-post pinned-post-card" style="position:relative">' +
            '<div style="font-size:11.5px;color:var(--accent);font-weight:800;margin-bottom:6px">📌 Pinned</div>' +
            '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(data.pinned_post.content) : _esc(data.pinned_post.content)) + '</div>' +
            '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(data.pinned_post.created_at) : data.pinned_post.created_at) + '</div>' +
          '</div>';
          postsPane.insertAdjacentHTML("afterbegin", pinnedHtml);
        }
      }
    };
  }

  console.log("[Batch5] highlights + similar + pinned + tabs ready");
  // S39 — Expose for unified profile tab handler
  window._hideAll = _hideAll;
  window._show = _show;
  window._renderReposts = _renderReposts;
  window._renderArchived = _renderArchived;

})();


// ===== Batch 6 — mute / restrict / no-retweet in profile menu =====
(function () {
  "use strict";
  if (window.__batch6) return;
  window.__batch6 = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function _sheet(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var s = document.createElement("div");
    s.id = id; s.className = "sheet-root";
    s.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(s); document.body.classList.add("sheet-open");
    requestAnimationFrame(function(){ s.classList.add("show"); });
    function close(){ s.classList.remove("show");
      setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s);
        document.body.classList.remove("sheet-open"); }, 220); }
    s.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = s.querySelector(".sheet-close"); if (x) x.addEventListener("click", close);
    return { root: s, close: close };
  }

  // Extend the ⋮ profile menu with new items
  var _origOpenMenu = window.openPostMenu; // not used here — instead hook into the profile menu

  // We hook into the sheet-menu-item click for existing profile menu items
  // Add "mute / restrict / no-retweet / subscribe" to profile menu by extending the menu builder
  // Since batch1 already creates it in a click handler, patch via another click listener that
  // intercepts the menu open, then re-renders with extra items.

  // Simpler: add to the existing profile menu — detect menu, inject before it renders
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    // wait a tick for the menu to render, then inject extra items
    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel) return;
      if (panel.dataset.b6 === "1") return;
      panel.dataset.b6 = "1";
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      if (isMe) return;

      var extra = [
        { a: "mute",       i: "fa-bell-slash",   l: "মিউট (নীরব)",   c: "b6-mute" },
        { a: "restrict",   i: "fa-eye-slash",    l: "রেস্ট্রিক্ট",    c: "b6-restrict" },
        { a: "noretweet",  i: "fa-retweet",      l: "রিটুইট বন্ধ",   c: "b6-noretweet" },
        { a: "subscribe",  i: "fa-star",         l: "সাবস্ক্রাইব",    c: "b6-subscribe", coming: true },
      ];

      extra.forEach(function (it) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sheet-menu-item " + it.c;
        btn.innerHTML = '<i class="fa-solid ' + it.i + '"></i><span>' + it.l + '</span>' +
          (it.coming ? ' <span style="font-size:9.5px;font-weight:800;color:var(--accent);margin-left:6px">SOON</span>' : '');
        panel.appendChild(btn);
      });

      // load current states
      (async function () {
        try {
          var u = data.user.username;
          var st = await Promise.all([
            window.api("/api/users/" + encodeURIComponent(u) + "/mute/status"),
            window.api("/api/users/" + encodeURIComponent(u) + "/restrict/status"),
            window.api("/api/users/" + encodeURIComponent(u) + "/no-retweet/status"),
          ]);
          if (st[0].muted) {
            var b = panel.querySelector(".b6-mute span");
            if (b) b.textContent = "আনমিউট";
          }
          if (st[1].restricted) {
            var b2 = panel.querySelector(".b6-restrict span");
            if (b2) b2.textContent = "আনরেস্ট্রিক্ট";
          }
          if (st[2].no_retweet) {
            var b3 = panel.querySelector(".b6-noretweet span");
            if (b3) b3.textContent = "রিটুইট চালু";
          }
        } catch (err) {}
      })();

      // wire
      panel.querySelectorAll(".b6-mute, .b6-restrict, .b6-noretweet, .b6-subscribe").forEach(function (b) {
        b.addEventListener("click", async function () {
          var u = data.user.username;
          try {
            if (b.classList.contains("b6-mute")) {
              var r = await window.api("/api/users/" + encodeURIComponent(u) + "/mute", { method: "POST" });
              if (typeof showToast === "function") showToast(r.muted ? "🔕 মিউট করা হয়েছে" : "🔔 আনমিউট");
            } else if (b.classList.contains("b6-restrict")) {
              var r2 = await window.api("/api/users/" + encodeURIComponent(u) + "/restrict", { method: "POST" });
              if (typeof showToast === "function") showToast(r2.restricted ? "🔒 রেস্ট্রিক্টেড" : "✅ আনরেস্ট্রিক্ট");
            } else if (b.classList.contains("b6-noretweet")) {
              var r3 = await window.api("/api/users/" + encodeURIComponent(u) + "/no-retweet", { method: "POST" });
              if (typeof showToast === "function") showToast(r3.no_retweet ? "🚫 রিটুইট বন্ধ" : "🔁 রিটুইট চালু");
            } else if (b.classList.contains("b6-subscribe")) {
              if (typeof showToast === "function") showToast("⭐ সাবস্ক্রাইব — শীঘ্রই আসছে");
            }
          } catch (err) { alert(err.message || "সমস্যা"); }
          // close menu
          var open = document.querySelector("#profile-menu-sheet.show");
          if (open) { open.classList.remove("show"); setTimeout(function(){ if(open.parentNode) open.parentNode.removeChild(open); document.body.classList.remove("sheet-open"); }, 200); }
        });
      });
    }, 50);
  }, true);

  console.log("[Batch6] mute/restrict/no-retweet ready");
})();


// ===== Batch 7 — report story / hide / snooze / break =====
(function () {
  "use strict";
  if (window.__batch7) return;
  window.__batch7 = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function _sheet(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var s = document.createElement("div");
    s.id = id; s.className = "sheet-root";
    s.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(s); document.body.classList.add("sheet-open");
    requestAnimationFrame(function(){ s.classList.add("show"); });
    function close(){ s.classList.remove("show");
      setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s);
        document.body.classList.remove("sheet-open"); }, 220); }
    s.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = s.querySelector(".sheet-close"); if (x) x.addEventListener("click", close);
    return { root: s, close: close };
  }

  function _modal(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var m = document.createElement("div");
    m.id = id; m.className = "modal";
    m.innerHTML = html;
    document.body.appendChild(m);
    return m;
  }

  // ============ 62. Report story — hook into story viewer ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#sv-report")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var viewer = document.getElementById("story-viewer");
    if (!viewer || viewer.classList.contains("hidden")) return;
    // find current story id
    var bar = document.getElementById("sv-reactions-bar");
    var sid = bar ? bar.dataset.storyId : null;
    if (!sid) return;
    _openReportStorySheet(sid);
  }, true);

  // Add "Report" button to story viewer footer (if not present)
  var _origRender = window.renderCurrentStory;
  if (typeof _origRender === "function") {
    window.renderCurrentStory = async function () {
      await _origRender();
      var footer = document.querySelector(".sv-footer");
      if (!footer || document.getElementById("sv-report")) return;
      var b = document.createElement("button");
      b.id = "sv-report";
      b.className = "sv-delete";
      b.style.background = "rgba(0,0,0,0.45)";
      b.style.marginLeft = "6px";
      b.innerHTML = '<i class="fa-solid fa-flag"></i> রিপোর্ট';
      footer.appendChild(b);
    };
  }

  function _openReportStorySheet(sid) {
    var reasons = [
      { v: "spam",        l: "স্প্যাম / বিজ্ঞাপন",         i: "fa-bullhorn" },
      { v: "harassment",  l: "হয়রানি / গালাগালি",         i: "fa-hand-fist" },
      { v: "violence",    l: "হিংস্রতা / ভয় দেখানো",     i: "fa-triangle-exclamation" },
      { v: "false_info",  l: "মিথ্যা তথ্য",                 i: "fa-circle-exclamation" },
      { v: "other",       l: "অন্য কিছু",                  i: "fa-ellipsis" },
    ];
    var s = _sheet("b7-report-story-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>স্টোরি রিপোর্ট</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:8px 12px">' +
          reasons.map(function(r){
            return '<div class="b3-share-row" data-reason="' + r.v + '">' +
              '<div class="b3-share-icon" style="background:var(--danger)"><i class="fa-solid ' + r.i + '"></i></div>' +
              '<div class="b3-share-label">' + _esc(r.l) + '</div>' +
            '</div>';
          }).join("") +
          '<textarea id="b7-story-notes" placeholder="অতিরিক্ত কিছু? (ঐচ্ছিক)" maxlength="500" ' +
          'style="width:100%;margin-top:10px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);' +
          'font-family:inherit;font-size:13.5px;color:var(--text);background:var(--card-2);min-height:70px;resize:vertical;outline:none"></textarea>' +
        '</div>' +
      '</div>');

    s.root.querySelectorAll("[data-reason]").forEach(function (r) {
      r.addEventListener("click", async function () {
        var reason = r.dataset.reason;
        var notes = (s.root.querySelector("#b7-story-notes").value || "").trim();
        r.style.pointerEvents = "none";
        try {
          await window.api("/api/stories/" + sid + "/report", {
            method: "POST",
            body: JSON.stringify({ reason: reason, notes: notes })
          });
          s.close();
          if (typeof showToast === "function") showToast("✅ রিপোর্ট পাঠানো হয়েছে");
        } catch (err) {
          alert(err.message || "সমস্যা");
          r.style.pointerEvents = "";
        }
      });
    });
  }

  // ============ 63. Hide from feed — post menu item ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest('[data-action="hide"]');
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var postEl = b.closest(".post");
    if (!postEl) return;
    var postId = postEl.dataset.id;
    if (!postId) return;
    if (typeof window.closePostMenu === "function") window.closePostMenu();
    (async function () {
      try {
        await window.api("/api/posts/" + postId + "/hide", { method: "POST" });
        postEl.style.transition = "opacity 0.3s, transform 0.3s";
        postEl.style.opacity = "0";
        postEl.style.transform = "scale(0.96)";
        setTimeout(function(){ postEl.remove(); }, 320);
        if (typeof showToast === "function") showToast("🙈 পোস্ট লুকানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); }
    })();
  }, true);

  // Extend post menu to include "Hide" for all posts (currently only delete for own)
  var _origHandle = window.handlePostMenuAction;
  if (typeof _origHandle === "function") {
    window.handlePostMenuAction = async function (action, btn, postEl, postId) {
      if (action === "hide") {
        try {
          await window.api("/api/posts/" + postId + "/hide", { method: "POST" });
          postEl.style.transition = "opacity 0.3s, transform 0.3s";
          postEl.style.opacity = "0";
          postEl.style.transform = "scale(0.96)";
          setTimeout(function(){ postEl.remove(); }, 320);
          if (typeof showToast === "function") showToast("🙈 পোস্ট লুকানো হয়েছে");
        } catch (err) { alert(err.message || "সমস্যা"); }
        return;
      }
      return _origHandle(action, btn, postEl, postId);
    };
  }

  // Inject "Hide" into post menu popup right after it's created
  var _origOpenPostMenu = window.openPostMenu;
  if (typeof _origOpenPostMenu === "function") {
    window.openPostMenu = function (btn, postEl, postId) {
      _origOpenPostMenu(btn, postEl, postId);
      setTimeout(function () {
        var menu = document.getElementById("post-menu-popup");
        if (!menu || menu.dataset.b7 === "1") return;
        menu.dataset.b7 = "1";
        // Insert "Hide" before report/delete
        var saveBtn = menu.querySelector('button[data-action="save"]');
        var target = menu.querySelector('button[data-action="report"]') || menu.querySelector('button[data-action="delete"]');
        if (!target) return;
        var hideBtn = document.createElement("button");
        hideBtn.setAttribute("data-action", "hide");
        hideBtn.innerHTML = '<i class="fa-regular fa-eye-slash"></i><span>লুকান</span>';
        menu.insertBefore(hideBtn, target);
      }, 30);
    };
  }

  // ============ 64. Snooze — profile menu item ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".b7-snooze-open");
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var username = data.user.username;
    // close existing menu
    var open = document.querySelector(".sheet-root.show");
    if (open) { open.classList.remove("show"); setTimeout(function(){ if(open.parentNode) open.parentNode.removeChild(open); document.body.classList.remove("sheet-open"); }, 180); }

    setTimeout(function () {
      var s = _sheet("b7-snooze-sheet",
        '<div class="sheet-panel">' +
          '<div class="sheet-handle"></div>' +
          '<div class="sheet-header"><h3>স্নুজ করুন</h3>' +
          '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
          '<div class="sheet-body" style="padding:6px 0">' +
            [1, 7, 30, 90, 365].map(function(d){
              var label = d === 365 ? "1 বছর" : (d + " দিন");
              return '<div class="b7-snooze-row">' +
                '<div><div class="b7-snooze-label">' + label + '</div>' +
                '<div class="b7-snooze-sub">এই সময়ে এই ইউজারের পোস্ট দেখবেন না</div></div>' +
                '<button class="b7-snooze-btn" data-days="' + d + '">স্নুজ</button>' +
              '</div>';
            }).join("") +
          '</div>' +
        '</div>');

      s.root.querySelectorAll(".b7-snooze-btn").forEach(function (b2) {
        b2.addEventListener("click", async function () {
          var days = b2.dataset.days;
          b2.disabled = true;
          try {
            await window.api("/api/users/" + encodeURIComponent(username) + "/snooze", {
              method: "POST",
              body: JSON.stringify({ days: parseInt(days) })
            });
            s.close();
            if (typeof showToast === "function") showToast("😴 " + days + " দিনের জন্য স্নুজ");
          } catch (err) { alert(err.message || "সমস্যা"); b2.disabled = false; }
        });
      });
    }, 220);
  }, true);

  // Inject Snooze into profile menu
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel || panel.dataset.b7s === "1") return;
      panel.dataset.b7s = "1";
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      if (isMe) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sheet-menu-item b7-snooze-open";
      btn.innerHTML = '<i class="fa-solid fa-moon"></i><span>স্নুজ করুন</span>';
      // insert after mute/restrict/noretweet section
      var last = panel.querySelector(".b6-noretweet");
      if (last && last.nextSibling) panel.insertBefore(btn, last.nextSibling);
      else panel.appendChild(btn);
    }, 55);
  }, true);

  // ============ 65. Take a break ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b7='take-break']");
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var m = _modal("b7-break-modal",
      '<div class="modal-content b7-break-modal-content">' +
        '<div class="b7-break-icon">🌿</div>' +
        '<div class="b7-break-title">একটু বিরতি নিন</div>' +
        '<div class="b7-break-text">' +
          'সোশ্যাল মিডিয়া থেকে কয়েক ঘণ্টা দূরে থাকুন।<br>' +
          'আপনার মন ভালো থাকবে। 🌱' +
        '</div>' +
        '<div class="b7-break-actions">' +
          '<button class="primary" id="b7-break-go">এখনই শুরু করুন</button>' +
          '<button id="b7-break-cancel">বাতিল</button>' +
        '</div>' +
      '</div>');
    m.querySelector("#b7-break-cancel").onclick = function () { m.remove(); };
    m.querySelector("#b7-break-go").onclick = async function () {
      try {
        var r = await window.api("/api/me/take-break", { method: "POST" });
        m.remove();
        if (typeof showToast === "function") showToast(r.message || "🌿 বিরতি নিন");
      } catch (err) { alert(err.message || "সমস্যা"); }
    };
    m.addEventListener("click", function (ev) { if (ev.target === m) m.remove(); });
  }, true);


  // ============ 66. Report imposter ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b7='report-imposter']");
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var m = _modal("b7-imposter-modal",
      '<div class="modal-content" style="max-width:400px">' +
        '<button class="close-btn" id="b7-imp-close">×</button>' +
        '<h3 style="margin-bottom:14px;font-size:18px">🎭 ইম্পোস্টার রিপোর্ট</h3>' +
        '<p style="font-size:13px;color:var(--muted);margin-bottom:12px">' +
          'এই অ্যাকাউন্ট কাউকে নকল করছে মনে হলে নিচে বিস্তারিত লিখুন।' +
        '</p>' +
        '<textarea id="b7-imp-notes" placeholder="কার নকল করছে? বিস্তারিত..." maxlength="500" ' +
        'style="width:100%;min-height:90px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);' +
        'font-family:inherit;font-size:13.5px;background:var(--card-2);color:var(--text);outline:none;resize:vertical"></textarea>' +
        '<div class="edit-actions" style="margin-top:14px">' +
          '<button class="btn-secondary" id="b7-imp-cancel">বাতিল</button>' +
          '<button class="btn-primary danger-btn" id="b7-imp-send" style="width:auto;padding:11px 22px">' +
            '<i class="fa-solid fa-paper-plane"></i> পাঠান' +
          '</button>' +
        '</div>' +
      '</div>');
    m.querySelector("#b7-imp-close").onclick = function () { m.remove(); };
    m.querySelector("#b7-imp-cancel").onclick = function () { m.remove(); };
    m.addEventListener("click", function (ev) { if (ev.target === m) m.remove(); });
    m.querySelector("#b7-imp-send").onclick = async function () {
      var notes = (m.querySelector("#b7-imp-notes").value || "").trim();
      if (!notes) return alert("বিস্তারিত লিখুন");
      var sendBtn = m.querySelector("#b7-imp-send");
      sendBtn.disabled = true;
      try {
        await window.api("/api/me/report-imposter", {
          method: "POST",
          body: JSON.stringify({ username: data.user.username, notes: notes })
        });
        m.remove();
        if (typeof showToast === "function") showToast("✅ রিপোর্ট পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); sendBtn.disabled = false; }
    };
  }, true);

  // Inject Report Imposter into profile menu
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel || panel.dataset.b7i === "1") return;
      panel.dataset.b7i = "1";
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      if (isMe) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sheet-menu-item danger";
      btn.setAttribute("data-b7", "report-imposter");
      btn.innerHTML = '<i class="fa-solid fa-mask"></i><span>ইম্পোস্টার রিপোর্ট</span>';
      panel.appendChild(btn);
    }, 60);
  }, true);

  console.log("[Batch7] report-story + hide + snooze + break + imposter ready");
})();


// ===== Batch 8 — extended profile + insights =====
(function () {
  "use strict";
  if (window.__batch8) return;
  window.__batch8 = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  // ============ Extend Edit Profile modal — load current values ============
  var _origOpenEdit = window.openEditProfile;
  if (typeof _origOpenEdit === "function") {
    window.openEditProfile = async function () {
      _origOpenEdit();
      try {
        var ext = await window.api("/api/me/profile-extended");
        var pr = document.getElementById("edit-pronouns");
        var lo = document.getElementById("edit-location");
        var ca = document.getElementById("edit-category");
        var bl = document.getElementById("edit-bio-links");
        if (pr) pr.value = ext.pronouns || "";
        if (lo) lo.value = ext.location || "";
        if (ca) ca.value = ext.category || "";
        if (bl) bl.value = ext.bio_links || "";
      } catch (e) {}
    };
  }

  // ============ Extend save ============
  var _origSave = window.saveEditProfile;
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#save-edit-profile")) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    (async function () {
      var name = document.getElementById("edit-name");
      var bio = document.getElementById("edit-bio");
      var pr = document.getElementById("edit-pronouns");
      var lo = document.getElementById("edit-location");
      var ca = document.getElementById("edit-category");
      var bl = document.getElementById("edit-bio-links");
      var btn = document.getElementById("save-edit-profile");
      btn.disabled = true;
      var oldHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> সেভ...';
      try {
        // 1. Basic bio + name
        await window.api("/api/me/bio", {
          method: "POST",
          body: JSON.stringify({
            bio: bio ? bio.value.trim() : "",
            display_name: name ? name.value.trim() : "",
          })
        });
        // 2. Extended fields
        await window.api("/api/me/profile-extended", {
          method: "POST",
          body: JSON.stringify({
            pronouns: pr ? pr.value.trim() : "",
            location: lo ? lo.value.trim() : "",
            category: ca ? ca.value : "",
            bio_links: bl ? bl.value.trim() : "",
          })
        });
        // 3. avatar/cover (handled by original save code) — call them if pending
        if (typeof pendingAvatar !== "undefined" && pendingAvatar !== null) {
          var r = await window.api("/api/me/avatar", {
            method: "POST",
            body: JSON.stringify({ avatar: pendingAvatar })
          });
          if (window.state.me) window.state.me.profile_pic = r.avatar;
        }
        if (typeof pendingCover !== "undefined" && pendingCover !== null) {
          var rc = await window.api("/api/me/cover", {
            method: "POST",
            body: JSON.stringify({ cover: pendingCover })
          });
          if (window.state.me) window.state.me.cover_pic = rc.cover;
        }
        // refresh
        var me = await window.api("/api/me");
        if (me && me.user) window.state.me = me.user;
        if (typeof window.refreshProfileUI === "function") window.refreshProfileUI();
        if (typeof loadFeed === "function") loadFeed();
        // close modal
        var m = document.getElementById("edit-profile-modal");
        if (m) m.classList.add("hidden");
        if (typeof showToast === "function") showToast("✅ প্রোফাইল সেভ হয়েছে");
        // re-render profile if open
        if (window.state.me && typeof window.openProfile === "function") window.openProfile(window.state.me.username);
      } catch (err) {
        alert(err.message || "সেভ করা যায়নি");
      } finally {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
      }
    })();
  }, true);

  // ============ Render extended info on profile page ============
  var _origOpenProfileB8 = window.openProfile;
  if (typeof _origOpenProfileB8 === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB8(username);
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var u = data.user;

      // Pronouns badge next to name
      var nameEl = document.getElementById("profile-page-name");
      if (nameEl) {
        var oldPr = nameEl.parentNode.querySelector(".pf-pronouns-badge");
        if (oldPr) oldPr.remove();
        if (u.pronouns) {
          var b = document.createElement("span");
          b.className = "pf-pronouns-badge";
          b.textContent = u.pronouns;
          nameEl.appendChild(b);
        }
      }

      // Category badge
      if (nameEl) {
        var oldCat = nameEl.parentNode.querySelector(".pf-category-badge");
        if (oldCat) oldCat.remove();
        if (u.category) {
          var catLabel = {
            "personal": "👤 ব্যক্তিগত",
            "creator": "🎨 ক্রিয়েটর",
            "business": "💼 ব্যবসা",
            "public_figure": "⭐ পাবলিক ফিগার",
            "brand": "🏷 ব্র্যান্ড",
            "community": "👥 কমিউনিটি",
          }[u.category] || u.category;
          var cb = document.createElement("span");
          cb.className = "pf-category-badge";
          cb.textContent = catLabel;
          nameEl.appendChild(cb);
        }
      }

      // Location line under username
      var unameEl = document.getElementById("profile-page-username");
      if (unameEl) {
        var oldLoc = unameEl.parentNode.querySelector(".pf-location-line");
        if (oldLoc) oldLoc.remove();
        if (u.location) {
          var l = document.createElement("div");
          l.className = "pf-location-line";
          l.innerHTML = '<i class="fa-solid fa-location-dot"></i> ' + _esc(u.location);
          unameEl.parentNode.appendChild(l);
        }
      }

      // Bio links
      var bioEl = document.getElementById("profile-page-bio");
      if (bioEl) {
        var oldLinks = bioEl.parentNode.querySelector(".pf-bio-links");
        if (oldLinks) oldLinks.remove();
        if (u.bio_links) {
          var links = u.bio_links.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
          if (links.length) {
            var wrap = document.createElement("div");
            wrap.className = "pf-bio-links";
            wrap.innerHTML = links.map(function (link) {
              var display = link.replace(/^https?:\/\//, "").split("/")[0];
              var href = /^https?:\/\//.test(link) ? link : ("https://" + link);
              return '<a class="pf-bio-link" href="' + _esc(href) + '" target="_blank" rel="noopener">' +
                '<i class="fa-solid fa-link"></i> ' + _esc(display) + '</a>';
            }).join("");
            bioEl.parentNode.appendChild(wrap);
          }
        }
      }

      // ============ Inject Insights button (own profile only) ============
      var isMe = window.state && window.state.me && window.state.me.username === u.username;
      var btns = document.getElementById("profile-buttons");
      if (btns && isMe) {
        if (!document.getElementById("btn-open-insights")) {
          var b = document.createElement("button");
          b.id = "btn-open-insights";
          b.className = "btn-icon-circle";
          b.title = "ইনসাইট";
          b.innerHTML = '<i class="fa-solid fa-chart-line"></i>';
          b.addEventListener("click", function () {
            if (typeof window.openInsightsPage === "function") window.openInsightsPage();
          });
          btns.appendChild(b);
        }
      }
    };
  }

  // ============ Insights page ============
  window.openInsightsPage = async function () {
    var page = document.getElementById("insights-page");
    if (!page) return;
    page.classList.remove("hidden");
    var body = document.getElementById("insights-body");
    body.innerHTML = '<p style="text-align:center;padding:40px;color:var(--muted)">লোড হচ্ছে...</p>';
    try {
      var d = await window.api("/api/me/insights");
      var cards = [
        { i: "fa-file-lines",     v: d.posts,             l: "মোট পোস্ট" },
        { i: "fa-heart",          v: d.likes_received,    l: "মোট লাইক" },
        { i: "fa-comment",        v: d.comments_received, l: "মোট মন্তব্য" },
        { i: "fa-user-plus",      v: d.new_followers_7d,  l: "নতুন ফলোয়ার (৭দিন)" },
      ];
      var cardsHTML = cards.map(function (c) {
        return '<div class="ins-card">' +
          '<div class="ins-icon"><i class="fa-solid ' + c.i + '"></i></div>' +
          '<div class="ins-value">' + (c.v || 0) + '</div>' +
          '<div class="ins-label">' + c.l + '</div>' +
        '</div>';
      }).join("");

      // weekly chart
      var max = Math.max.apply(null, d.chart.map(function (x) { return x.count; })) || 1;
      var dayLabels = ["আজ","১","২","৩","৪","৫","৬"];
      var barsHTML = d.chart.map(function (x) {
        var pct = (x.count / max) * 100;
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center">' +
          '<div class="ins-bar" style="height:' + Math.max(pct, 4) + '%" title="' + x.count + '"></div>' +
          '<div class="ins-bar-day">' + dayLabels[6 - x.day] + '</div>' +
        '</div>';
      }).join("");

      var topHTML = "";
      if (d.top_post) {
        topHTML = '<div class="ins-top-post">' +
          '<h4>🏆 সর্বোচ্চ এনগেজড পোস্ট</h4>' +
          '<div class="post-content">' + _esc((d.top_post.content || "").slice(0, 200)) + '</div>' +
          '<div style="font-size:12.5px;color:var(--muted);font-weight:700">' +
            '<i class="fa-solid fa-heart" style="color:#ef4444"></i> ' + d.top_post.likes + ' লাইক' +
          '</div>' +
        '</div>';
      }

      body.innerHTML = '<div class="insights-grid">' + cardsHTML + '</div>' +
        '<div class="ins-chart">' +
          '<div class="ins-chart-title">📈 সাপ্তাহিক লাইক</div>' +
          '<div class="ins-bars">' + barsHTML + '</div>' +
        '</div>' +
        topHTML;
    } catch (err) {
      body.innerHTML = '<p style="text-align:center;padding:40px;color:var(--danger)">লোড করা যায়নি</p>';
    }
  };

  document.addEventListener("click", function (e) {
    if (e.target.closest("#insights-back")) {
      var p = document.getElementById("insights-page");
      if (p) p.classList.add("hidden");
    }
  }, true);

  console.log("[Batch8] extended profile + insights ready");
})();


// ===== Batch 9 — monetization UI =====
(function () {
  "use strict";
  if (window.__batch9) return;
  window.__batch9 = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function _sheet(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var s = document.createElement("div");
    s.id = id; s.className = "sheet-root";
    s.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(s); document.body.classList.add("sheet-open");
    requestAnimationFrame(function(){ s.classList.add("show"); });
    function close(){ s.classList.remove("show");
      setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s);
        document.body.classList.remove("sheet-open"); }, 220); }
    s.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = s.querySelector(".sheet-close"); if (x) x.addEventListener("click", close);
    return { root: s, close: close };
  }

  // ============ 87. Tip ============
  window._openTipSheet = function (username, displayName) {
    var amounts = [50, 100, 200, 500, 1000, 2000];
    var s = _sheet("b9-tip-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>💰 টিপ পাঠান</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<p style="font-size:13px;color:var(--muted);margin-bottom:12px">' +
            '<strong>@' + _esc(username) + '</strong> কে টিপ পাঠান' +
          '</p>' +
          '<input type="number" class="b9-price-input" id="b9-tip-amount" placeholder="৳ পরিমাণ" min="10" max="100000">' +
          '<div class="b9-quick-amounts">' +
            amounts.map(function(a){
              return '<button type="button" class="b9-quick-btn" data-amt="' + a + '">৳ ' + a + '</button>';
            }).join("") +
          '</div>' +
          '<textarea id="b9-tip-note" placeholder="একটি নোট (ঐচ্ছিক)" maxlength="200" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:14px;color:var(--text);outline:none;' +
            'min-height:64px;resize:vertical;margin-bottom:14px"></textarea>' +
          '<button class="btn-primary" id="b9-tip-send" style="width:100%;padding:14px;border-radius:12px">' +
            '<i class="fa-solid fa-paper-plane"></i> টিপ পাঠান' +
          '</button>' +
          '<p style="font-size:11.5px;color:var(--muted);text-align:center;margin-top:8px">' +
            '⚠️ পেমেন্ট গেটওয়ে আসছে — আপনার অনুরোধ সংরক্ষিত হয়' +
          '</p>' +
        '</div>' +
      '</div>');

    s.root.querySelectorAll(".b9-quick-btn").forEach(function(b){
      b.addEventListener("click", function(){
        var inp = s.root.querySelector("#b9-tip-amount");
        if (inp) inp.value = b.dataset.amt;
      });
    });

    s.root.querySelector("#b9-tip-send").addEventListener("click", async function(){
      var amt = parseFloat(s.root.querySelector("#b9-tip-amount").value || 0);
      var note = (s.root.querySelector("#b9-tip-note").value || "").trim();
      if (!amt || amt < 10) return alert("১০ টাকার বেশি দিন");
      this.disabled = true;
      try {
        await window.api("/api/users/" + encodeURIComponent(username) + "/tip", {
          method: "POST",
          body: JSON.stringify({ amount: amt, note: note })
        });
        s.close();
        if (typeof showToast === "function") showToast("💰 ৳ " + amt + " টিপ পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 88. Gift ============
  window._openGiftSheet = function (username, displayName) {
    var gifts = [
      { code: "rose",   emoji: "🌹", label: "গোলাপ" },
      { code: "heart",  emoji: "❤️", label: "হার্ট" },
      { code: "star",   emoji: "⭐", label: "স্টার" },
      { code: "cake",   emoji: "🎂", label: "কেক" },
      { code: "crown",  emoji: "👑", label: "ক্রাউন" },
      { code: "rocket", emoji: "🚀", label: "রকেট" },
      { code: "coffee", emoji: "☕", label: "কফি" },
      { code: "fire",   emoji: "🔥", label: "ফায়ার" },
      { code: "diamond", emoji: "💎", label: "ডায়মন্ড" },
    ];
    var s = _sheet("b9-gift-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>🎁 গিফট পাঠান</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="b9-grid">' +
          gifts.map(function(g){
            return '<button class="b9-gift" data-code="' + g.code + '">' +
              '<span class="b9-emoji">' + g.emoji + '</span>' +
              '<span class="b9-label">' + g.label + '</span>' +
            '</button>';
          }).join("") +
        '</div>' +
        '<div style="padding:0 16px 14px">' +
          '<textarea id="b9-gift-note" placeholder="নোট (ঐচ্ছিক)" maxlength="100" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:13.5px;color:var(--text);outline:none;' +
            'min-height:50px;resize:vertical;margin-bottom:12px"></textarea>' +
          '<button class="btn-primary" id="b9-gift-send" style="width:100%;padding:12px;border-radius:12px" disabled>' +
            'একটি গিফট বেছে নিন' +
          '</button>' +
        '</div>' +
      '</div>');

    var selected = null;
    s.root.querySelectorAll(".b9-gift").forEach(function(b){
      b.addEventListener("click", function(){
        s.root.querySelectorAll(".b9-gift").forEach(function(x){ x.classList.remove("on"); });
        b.classList.add("on");
        selected = b.dataset.code;
        var btn = s.root.querySelector("#b9-gift-send");
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> গিফট পাঠান';
      });
    });

    s.root.querySelector("#b9-gift-send").addEventListener("click", async function(){
      if (!selected) return;
      var note = (s.root.querySelector("#b9-gift-note").value || "").trim();
      this.disabled = true;
      try {
        await window.api("/api/users/" + encodeURIComponent(username) + "/gift", {
          method: "POST",
          body: JSON.stringify({ gift: selected, note: note })
        });
        s.close();
        if (typeof showToast === "function") showToast("🎁 গিফট পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 89. Book appointment ============
  window._openAppointmentSheet = function (username, displayName) {
    var s = _sheet("b9-appt-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>📅 অ্যাপয়েন্টমেন্ট বুক</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<p style="font-size:13px;color:var(--muted);margin-bottom:12px">' +
            '<strong>@' + _esc(username) + '</strong> এর সাথে অ্যাপয়েন্টমেন্ট' +
          '</p>' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px">তারিখ ও সময়</label>' +
          '<input type="datetime-local" id="b9-appt-when" class="b9-price-input" style="font-size:14px;font-weight:600">' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;margin-top:12px">সময়কাল (মিনিট)</label>' +
          '<select id="b9-appt-dur" class="b9-price-input" style="font-size:14px">' +
            '<option value="15">১৫ মিনিট</option>' +
            '<option value="30" selected>৩০ মিনিট</option>' +
            '<option value="60">১ ঘণ্টা</option>' +
            '<option value="120">২ ঘণ্টা</option>' +
          '</select>' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;margin-top:12px">নোট</label>' +
          '<textarea id="b9-appt-note" placeholder="কী নিয়ে আলোচনা করতে চান?" maxlength="300" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:14px;color:var(--text);outline:none;' +
            'min-height:70px;resize:vertical;margin-bottom:14px"></textarea>' +
          '<button class="btn-primary" id="b9-appt-send" style="width:100%;padding:14px;border-radius:12px">' +
            '<i class="fa-solid fa-calendar-check"></i> বুক করুন' +
          '</button>' +
        '</div>' +
      '</div>');

    s.root.querySelector("#b9-appt-send").addEventListener("click", async function(){
      var when = s.root.querySelector("#b9-appt-when").value;
      var dur = parseInt(s.root.querySelector("#b9-appt-dur").value || 30);
      var note = (s.root.querySelector("#b9-appt-note").value || "").trim();
      if (!when) return alert("তারিখ ও সময় দিন");
      this.disabled = true;
      try {
        await window.api("/api/users/" + encodeURIComponent(username) + "/appointments", {
          method: "POST",
          body: JSON.stringify({ datetime: when, duration: dur, note: note })
        });
        s.close();
        if (typeof showToast === "function") showToast("📅 অ্যাপয়েন্টমেন্ট বুক হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 82. Shop ============
  window._openShopSheet = async function (username, displayName, isOwn) {
    var s = _sheet("b9-shop-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>🛍️ শপ — @' + _esc(username) + '</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 14px">' +
          '<div id="b9-shop-list"><p style="text-align:center;padding:20px;color:var(--muted)">লোড হচ্ছে...</p></div>' +
          (isOwn ? '<button class="btn-secondary" id="b9-shop-add" style="width:100%;margin-top:12px"><i class="fa-solid fa-plus"></i> নতুন পণ্য যোগ করুন</button>' : '') +
        '</div>' +
      '</div>');

    async function load() {
      var list = s.root.querySelector("#b9-shop-list");
      try {
        var products = await window.api("/api/users/" + encodeURIComponent(username) + "/shop");
        if (!products.length) {
          list.innerHTML = '<p style="text-align:center;padding:30px;color:var(--muted);font-size:14px">🛍️ এখনো কোনো পণ্য নেই</p>';
          return;
        }
        list.innerHTML = '<div class="b9-shop-grid">' +
          products.map(function(p){
            var img = p.image ? '<img src="' + _esc(p.image) + '" alt="" loading="lazy" decoding="async">'
                              : '<i class="fa-solid fa-box"></i>';
            return '<div class="b9-product" data-pid="' + p.id + '" data-price="' + p.price + '">' +
              '<div class="b9-product-img">' + img + '</div>' +
              '<div class="b9-product-info">' +
                '<div class="b9-product-title">' + _esc(p.title) + '</div>' +
                '<div class="b9-product-price">৳ ' + p.price + '</div>' +
              '</div>' +
            '</div>';
          }).join("") + '</div>';
        list.querySelectorAll(".b9-product").forEach(function(cell){
          cell.addEventListener("click", async function(){
            if (isOwn) return;
            if (!confirm("এই পণ্য কিনবেন — ৳ " + cell.dataset.price + " ?")) return;
            try {
              await window.api("/api/shop/products/" + cell.dataset.pid + "/buy", { method: "POST" });
              if (typeof showToast === "function") showToast("✅ অর্ডার প্লেস হয়েছে");
            } catch (err) { alert(err.message || "সমস্যা"); }
          });
        });
      } catch (err) {
        list.innerHTML = '<p style="text-align:center;padding:20px;color:var(--danger)">লোড করা যায়নি</p>';
      }
    }
    await load();

    var addBtn = s.root.querySelector("#b9-shop-add");
    if (addBtn) {
      addBtn.addEventListener("click", function(){
        var title = prompt("পণ্যের নাম:");
        if (!title) return;
        var price = parseFloat(prompt("দাম (টাকা):") || "0");
        if (!price || price < 0) return alert("দাম দিন");
        window.api("/api/users/" + encodeURIComponent(username) + "/shop", {
          method: "POST",
          body: JSON.stringify({ title: title, price: price })
        }).then(function(){
          if (typeof showToast === "function") showToast("✅ পণ্য যোগ হয়েছে");
          load();
        }).catch(function(e){ alert(e.message); });
      });
    }
  };

  // ============ 81. Boost ============
  window._openBoostSheet = function (postId) {
    var s = _sheet("b9-boost-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>🚀 পোস্ট বুস্ট</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px">বাজেট (টাকা)</label>' +
          '<input type="number" id="b9-boost-budget" class="b9-price-input" placeholder="কমপক্ষে ৫০" min="50" max="50000">' +
          '<div class="b9-quick-amounts">' +
            [100, 250, 500, 1000, 2500].map(function(a){
              return '<button type="button" class="b9-quick-btn" data-amt="' + a + '">৳ ' + a + '</button>';
            }).join("") +
          '</div>' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;margin-top:6px">সময়কাল</label>' +
          '<select id="b9-boost-days" class="b9-price-input">' +
            '<option value="1">১ দিন</option>' +
            '<option value="3">৩ দিন</option>' +
            '<option value="7" selected>৭ দিন</option>' +
            '<option value="14">১৪ দিন</option>' +
            '<option value="30">৩০ দিন</option>' +
          '</select>' +
          '<button class="btn-primary" id="b9-boost-send" style="width:100%;padding:14px;border-radius:12px;margin-top:12px">' +
            '<i class="fa-solid fa-rocket"></i> বুস্ট শুরু' +
          '</button>' +
          '<p style="font-size:11.5px;color:var(--muted);text-align:center;margin-top:8px">' +
            '⚠️ পেমেন্ট গেটওয়ে আসছে' +
          '</p>' +
        '</div>' +
      '</div>');

    s.root.querySelectorAll(".b9-quick-btn").forEach(function(b){
      b.addEventListener("click", function(){
        var inp = s.root.querySelector("#b9-boost-budget");
        if (inp) inp.value = b.dataset.amt;
      });
    });

    s.root.querySelector("#b9-boost-send").addEventListener("click", async function(){
      var budget = parseFloat(s.root.querySelector("#b9-boost-budget").value || 0);
      var days = parseInt(s.root.querySelector("#b9-boost-days").value || 7);
      if (!budget || budget < 50) return alert("কমপক্ষে ৫০ টাকা");
      this.disabled = true;
      try {
        await window.api("/api/posts/" + postId + "/boost", {
          method: "POST",
          body: JSON.stringify({ budget: budget, days: days })
        });
        s.close();
        if (typeof showToast === "function") showToast("🚀 বুস্ট অনুরোধ পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ Menu items in profile ⋮ ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel || panel.dataset.b9 === "1") return;
      panel.dataset.b9 = "1";
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      if (isMe) return;

      var items = [
        { a: "tip",   i: "fa-money-bill-wave", l: "টিপ পাঠান" },
        { a: "gift",  i: "fa-gift",            l: "গিফট পাঠান" },
      ];
      if (data.user.is_professional) {
        items.push({ a: "shop", i: "fa-store",       l: "শপ দেখুন" });
        items.push({ a: "appt", i: "fa-calendar-check", l: "অ্যাপয়েন্টমেন্ট" });
      }

      items.forEach(function (it) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "sheet-menu-item";
        b.setAttribute("data-b9-act", it.a);
        b.innerHTML = '<i class="fa-solid ' + it.i + '"></i><span>' + it.l + '</span>';
        b.addEventListener("click", function () {
          var act = it.a;
          // close menu
          var open = document.querySelector("#profile-menu-sheet.show");
          if (open) { open.classList.remove("show");
            setTimeout(function(){ if (open.parentNode) open.parentNode.removeChild(open);
              document.body.classList.remove("sheet-open"); }, 180); }
          setTimeout(function () {
            var uname = data.user.username;
            var dname = data.user.display_name;
            if (act === "tip")   window._openTipSheet(uname, dname);
            if (act === "gift")  window._openGiftSheet(uname, dname);
            if (act === "shop")  window._openShopSheet(uname, dname, false);
            if (act === "appt")  window._openAppointmentSheet(uname, dname);
          }, 200);
        });
        panel.appendChild(b);
      });
    }, 55);
  }, true);

  // ============ Add "Boost" to own post menu ============
  var _origOpenPostMenuB9 = window.openPostMenu;
  if (typeof _origOpenPostMenuB9 === "function") {
    window.openPostMenu = function (btn, postEl, postId) {
      _origOpenPostMenuB9(btn, postEl, postId);
      setTimeout(function () {
        var menu = document.getElementById("post-menu-popup");
        if (!menu || menu.dataset.b9 === "1") return;
        menu.dataset.b9 = "1";
        var isOwn = window.state && window.state.me && btn.dataset.owner === window.state.me.username;
        if (!isOwn) return;
        var boost = document.createElement("button");
        boost.setAttribute("data-action", "boost");
        boost.innerHTML = '<i class="fa-solid fa-rocket"></i><span>বুস্ট</span>';
        var editBtn = menu.querySelector('button[data-action="edit"]');
        if (editBtn) menu.insertBefore(boost, editBtn);
        else menu.appendChild(boost);
        boost.addEventListener("click", function (ev) {
          ev.stopPropagation();
          if (typeof window.closePostMenu === "function") window.closePostMenu();
          setTimeout(function () { window._openBoostSheet(postId); }, 150);
        });
      }, 30);
    };
  }

  console.log("[Batch9] monetization UI ready");
})();


// ===== Batch 10 — subscription / verify / claim / misc =====
(function () {
  "use strict";
  if (window.__batch10) return;
  window.__batch10 = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function _sheet(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var s = document.createElement("div");
    s.id = id; s.className = "sheet-root";
    s.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(s); document.body.classList.add("sheet-open");
    requestAnimationFrame(function(){ s.classList.add("show"); });
    function close(){ s.classList.remove("show");
      setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s);
        document.body.classList.remove("sheet-open"); }, 220); }
    s.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = s.querySelector(".sheet-close"); if (x) x.addEventListener("click", close);
    return { root: s, close: close };
  }
  function _modal(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var m = document.createElement("div");
    m.id = id; m.className = "modal";
    m.innerHTML = html;
    document.body.appendChild(m);
    return m;
  }

  // ============ 91. Subscribe tier sheet ============
  window._openSubscribeSheet = function (username, displayName) {
    var tiers = [
      { id: "basic",   name: "Basic",   price: 99,  icon: "fa-star",       perks: "প্রিমিয়াম পোস্ট + সাপ্তাহিক Q&A" },
      { id: "premium", name: "Premium", price: 299, icon: "fa-crown",      perks: "সব Basic + মাসিক লাইভ সেশন" },
      { id: "vip",     name: "VIP",     price: 999, icon: "fa-gem",        perks: "সব Premium + 1-on-1 ভিডিও কল" },
    ];
    var s = _sheet("b10-sub-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>⭐ সাবস্ক্রাইব — @' + _esc(username) + '</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 14px">' +
          '<div class="b10-sub-tiers">' +
            tiers.map(function(t){
              return '<button type="button" class="b10-tier" data-tier="' + t.id + '">' +
                '<span class="b10-tier-icon"><i class="fa-solid ' + t.icon + '"></i></span>' +
                '<span class="b10-tier-info">' +
                  '<span class="b10-tier-name">' + t.name + '</span>' +
                  '<span class="b10-tier-price">৳ ' + t.price + ' / মাস</span>' +
                  '<span class="b10-tier-perks">' + t.perks + '</span>' +
                '</span>' +
              '</button>';
            }).join("") +
          '</div>' +
          '<button class="btn-primary" id="b10-sub-confirm" style="width:100%;padding:14px;border-radius:12px;margin-top:14px" disabled>' +
            '<i class="fa-solid fa-check"></i> টায়ার নির্বাচন করুন' +
          '</button>' +
          '<p style="font-size:11.5px;color:var(--muted);text-align:center;margin-top:8px">' +
            '⚠️ পেমেন্ট গেটওয়ে শীঘ্রই আসছে' +
          '</p>' +
        '</div>' +
      '</div>');
    var selected = null;
    s.root.querySelectorAll(".b10-tier").forEach(function(b){
      b.addEventListener("click", function(){
        s.root.querySelectorAll(".b10-tier").forEach(function(x){ x.classList.remove("on"); });
        b.classList.add("on");
        selected = b.dataset.tier;
        var btn = s.root.querySelector("#b10-sub-confirm");
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> সাবস্ক্রাইব করুন';
      });
    });
    s.root.querySelector("#b10-sub-confirm").addEventListener("click", async function(){
      if (!selected) return;
      this.disabled = true;
      try {
        var r = await window.api("/api/users/" + encodeURIComponent(username) + "/subscribe", {
          method: "POST",
          body: JSON.stringify({ tier: selected })
        });
        s.close();
        if (typeof showToast === "function") showToast("⭐ " + r.tier + " টায়ারে সাবস্ক্রাইব — ৳ " + r.amount + "/মাস");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 92. Verify request ============
  window._openVerifySheet = function () {
    var s = _sheet("b10-verify-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>✓ Verified হতে আবেদন</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<p style="font-size:13px;color:var(--muted);margin-bottom:14px;line-height:1.5">' +
            'Blue check পেতে আপনার আসল পরিচয় যাচাই করা হবে। জাল তথ্য দিলে অ্যাকাউন্ট বন্ধ হতে পারে।' +
          '</p>' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px">পুরো নাম</label>' +
          '<input type="text" id="b10-vf-name" class="b9-price-input" style="font-size:14px;font-weight:600" placeholder="আসল নাম">' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;margin-top:6px">কেন verified হওয়া দরকার?</label>' +
          '<textarea id="b10-vf-reason" placeholder="যেমন: পাবলিক ফিগার, সাংবাদিক, ক্রিয়েটর..." maxlength="500" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:13.5px;color:var(--text);outline:none;' +
            'min-height:80px;resize:vertical;margin-bottom:14px"></textarea>' +
          '<button class="btn-primary" id="b10-vf-send" style="width:100%;padding:14px;border-radius:12px">' +
            '<i class="fa-solid fa-paper-plane"></i> আবেদন পাঠান' +
          '</button>' +
        '</div>' +
      '</div>');
    s.root.querySelector("#b10-vf-send").addEventListener("click", async function(){
      var name = s.root.querySelector("#b10-vf-name").value.trim();
      var reason = s.root.querySelector("#b10-vf-reason").value.trim();
      if (!name || !reason) return alert("সব তথ্য দিন");
      this.disabled = true;
      try {
        await window.api("/api/me/verify-request", {
          method: "POST",
          body: JSON.stringify({ full_name: name, reason: reason })
        });
        s.close();
        if (typeof showToast === "function") showToast("✅ আবেদন পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 93. Claim business ============
  window._openClaimBusiness = function () {
    var s = _sheet("b10-claim-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>🏢 Business ক্লেইম</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<p style="font-size:13px;color:var(--muted);margin-bottom:12px">' +
            'আপনি যদি এই business-এর মালিক হন, তথ্য দিয়ে ক্লেইম করুন।' +
          '</p>' +
          '<input type="text" id="b10-cl-name" class="b9-price-input" style="font-size:14px" placeholder="Business নাম">' +
          '<input type="email" id="b10-cl-email" class="b9-price-input" style="font-size:14px" placeholder="Contact email">' +
          '<textarea id="b10-cl-notes" placeholder="অতিরিক্ত তথ্য / ট্রেড লাইসেন্স নম্বর" maxlength="500" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:13.5px;color:var(--text);outline:none;' +
            'min-height:70px;resize:vertical;margin-bottom:14px"></textarea>' +
          '<button class="btn-primary" id="b10-cl-send" style="width:100%;padding:14px;border-radius:12px">' +
            '<i class="fa-solid fa-check"></i> ক্লেইম করুন' +
          '</button>' +
        '</div>' +
      '</div>');
    s.root.querySelector("#b10-cl-send").addEventListener("click", async function(){
      var name = s.root.querySelector("#b10-cl-name").value.trim();
      var email = s.root.querySelector("#b10-cl-email").value.trim();
      var notes = s.root.querySelector("#b10-cl-notes").value.trim();
      if (!name || !email) return alert("নাম ও ইমেইল দিন");
      this.disabled = true;
      try {
        await window.api("/api/me/claim-business", {
          method: "POST",
          body: JSON.stringify({ business_name: name, contact_email: email, notes: notes })
        });
        s.close();
        if (typeof showToast === "function") showToast("🏢 ক্লেইম অনুরোধ পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 94. Invite to group ============
  window._openInviteToGroup = async function (username) {
    try {
      var groups = await window.api("/api/groups");
      if (!groups.length) {
        if (typeof showToast === "function") showToast("আপনার কোনো গ্রুপ নেই — আগে একটি বানান");
        return;
      }
      var s = _sheet("b10-invite-sheet",
        '<div class="sheet-panel">' +
          '<div class="sheet-handle"></div>' +
          '<div class="sheet-header"><h3>👥 গ্রুপে যোগ করুন</h3>' +
          '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
          '<div class="sheet-body" style="padding:6px 12px">' +
            groups.map(function(g){
              return '<div class="b3-share-row" data-gid="' + g.id + '">' +
                '<div class="b3-share-icon" style="background:var(--gradient)">' +
                  '<i class="fa-solid fa-users"></i>' +
                '</div>' +
                '<div class="b3-share-label">' + _esc(g.name) +
                  '<div class="b3-share-sub">' + (g.member_count || 0) + ' জন সদস্য</div>' +
                '</div>' +
              '</div>';
            }).join("") +
          '</div>' +
        '</div>');
      s.root.querySelectorAll("[data-gid]").forEach(function(b){
        b.addEventListener("click", async function(){
          try {
            await window.api("/api/groups/invite-from-profile", {
              method: "POST",
              body: JSON.stringify({ group_id: parseInt(b.dataset.gid), username: username })
            });
            s.close();
            if (typeof showToast === "function") showToast("✅ গ্রুপে যোগ করা হয়েছে");
          } catch (err) { alert(err.message || "সমস্যা"); }
        });
      });
    } catch (err) { alert(err.message || "গ্রুপ লোড করা যায়নি"); }
  };

  // ============ 95. Send contact ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b10='send-contact']");
    if (!b) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    window.api("/api/users/" + encodeURIComponent(data.user.username) + "/send-contact", { method: "POST" })
      .then(function(){ if (typeof showToast === "function") showToast("📇 Contact পাঠানো হয়েছে"); })
      .catch(function(e){ alert(e.message); });
  }, true);

  // ============ 97. Suggest friend ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b10='suggest']");
    if (!b) return;
    e.preventDefault();
    (async function(){
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      try {
        var friends = await window.api("/api/me/suggested-friends");
        if (!friends.length) { if (typeof showToast === "function") showToast("কেউ নেই"); return; }
        var s = _sheet("b10-suggest-sheet",
          '<div class="sheet-panel">' +
            '<div class="sheet-handle"></div>' +
            '<div class="sheet-header"><h3>কে suggest করবেন?</h3>' +
            '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="sheet-body" style="padding:6px 12px">' +
              friends.map(function(u){
                var av = u.profile_pic ? '<img src="' + _esc(u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
                                       : _esc((u.display_name||"?").charAt(0).toUpperCase());
                return '<div class="b3-share-row" data-to="' + _esc(u.username) + '">' +
                  '<div class="b3-share-icon bg-dm" style="overflow:hidden">' + av + '</div>' +
                  '<div class="b3-share-label">' + _esc(u.display_name) +
                    '<div class="b3-share-sub">@' + _esc(u.username) + '</div></div>' +
                '</div>';
              }).join("") +
            '</div>' +
          '</div>');
        s.root.querySelectorAll("[data-to]").forEach(function(row){
          row.addEventListener("click", async function(){
            try {
              await window.api("/api/users/" + encodeURIComponent(data.user.username) + "/suggest", {
                method: "POST",
                body: JSON.stringify({ to: row.dataset.to })
              });
              s.close();
              if (typeof showToast === "function") showToast("💡 Suggest পাঠানো হয়েছে");
            } catch (err) { alert(err.message || "সমস্যা"); }
          });
        });
      } catch (err) { alert(err.message || "লোড করা যায়নি"); }
    })();
  }, true);

  // ============ 98. Report a problem ============
  window._openReportProblem = function () {
    var s = _sheet("b10-rp-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>🐞 সমস্যা জানান</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px">সমস্যার ধরন</label>' +
          '<select id="b10-rp-cat" class="b9-price-input" style="font-size:14px">' +
            '<option value="bug">🐞 Bug</option>' +
            '<option value="crash">💥 ক্র্যাশ</option>' +
            '<option value="performance">🐌 ধীরগতি</option>' +
            '<option value="ui">🎨 UI/UX</option>' +
            '<option value="payment">💳 পেমেন্ট</option>' +
            '<option value="other">অন্য কিছু</option>' +
          '</select>' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;margin-top:8px">সমস্যার বিবরণ</label>' +
          '<textarea id="b10-rp-msg" placeholder="বিস্তারিত লিখুন (কী করছিলেন, কী হয়েছিল)..." maxlength="1000" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:13.5px;color:var(--text);outline:none;' +
            'min-height:110px;resize:vertical;margin-bottom:14px"></textarea>' +
          '<button class="btn-primary" id="b10-rp-send" style="width:100%;padding:14px;border-radius:12px">' +
            '<i class="fa-solid fa-paper-plane"></i> পাঠান' +
          '</button>' +
        '</div>' +
      '</div>');
    s.root.querySelector("#b10-rp-send").addEventListener("click", async function(){
      var cat = s.root.querySelector("#b10-rp-cat").value;
      var msg = s.root.querySelector("#b10-rp-msg").value.trim();
      if (msg.length < 10) return alert("কমপক্ষে ১০ অক্ষর লিখুন");
      this.disabled = true;
      try {
        await window.api("/api/me/report-problem", {
          method: "POST",
          body: JSON.stringify({ category: cat, message: msg })
        });
        s.close();
        if (typeof showToast === "function") showToast("✅ সমস্যা রিপোর্ট হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 99. QR scan ============
  window._openQrScan = function () {
    var overlay = document.createElement("div");
    overlay.className = "b10-qr-overlay";
    overlay.innerHTML =
      '<div style="font-size:44px">📷</div>' +
      '<div class="b10-qr-hint">JUKTOY QR কোড স্ক্যান করুন</div>' +
      '<video id="b10-qr-video" playsinline></video>' +
      '<div class="b10-qr-actions">' +
        '<button id="b10-qr-cancel">বাতিল</button>' +
      '</div>';
    document.body.appendChild(overlay);

    var stream = null;
    (async function(){
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        var v = document.getElementById("b10-qr-video");
        if (v) { v.srcObject = stream; v.play().catch(function(){}); }
      } catch (e) {
        var hint = overlay.querySelector(".b10-qr-hint");
        if (hint) hint.textContent = "ক্যামেরা চালু করা যায়নি — অনুমতি দিন";
      }
    })();

    function close() {
      if (stream) stream.getTracks().forEach(function(t){ try{t.stop();}catch(e){} });
      overlay.remove();
    }
    document.getElementById("b10-qr-cancel").addEventListener("click", close);
  };

  // ============ Wire into profile ⋮ menu ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel || panel.dataset.b10 === "1") return;
      panel.dataset.b10 = "1";
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;

      if (isMe) {
        // own profile additions
        var items = [
          { a: "verify", i: "fa-circle-check",  l: "✓ Verified হতে আবেদন" },
          { a: "claim",  i: "fa-building",       l: "🏢 Business ক্লেইম" },
          { a: "report-problem", i: "fa-bug",    l: "🐞 সমস্যা জানান" },
          { a: "qr-scan",        i: "fa-qrcode", l: "📷 QR স্ক্যান" },
        ];
        items.forEach(function (it) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "sheet-menu-item";
          b.innerHTML = '<i class="fa-solid ' + it.i + '"></i><span>' + it.l + '</span>';
          b.addEventListener("click", function () {
            var open = document.querySelector("#profile-menu-sheet.show");
            if (open) { open.classList.remove("show");
              setTimeout(function(){ if (open.parentNode) open.parentNode.removeChild(open);
                document.body.classList.remove("sheet-open"); }, 180); }
            setTimeout(function () {
              if (it.a === "verify")         window._openVerifySheet();
              if (it.a === "claim")          window._openClaimBusiness();
              if (it.a === "report-problem") window._openReportProblem();
              if (it.a === "qr-scan")        window._openQrScan();
            }, 200);
          });
          panel.appendChild(b);
        });
      } else {
        // other's profile additions
        var items2 = [
          { a: "subscribe", i: "fa-star",           l: "⭐ সাবস্ক্রাইব" },
          { a: "invite",    i: "fa-user-plus",      l: "👥 গ্রুপে যোগ" },
          { a: "send-contact", i: "fa-address-card", l: "📇 Contact পাঠান" },
          { a: "suggest",   i: "fa-lightbulb",      l: "💡 Suggest a friend" },
        ];
        items2.forEach(function (it) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "sheet-menu-item";
          b.setAttribute("data-b10", it.a);
          b.innerHTML = '<i class="fa-solid ' + it.i + '"></i><span>' + it.l + '</span>';
          b.addEventListener("click", function () {
            var open = document.querySelector("#profile-menu-sheet.show");
            if (open) { open.classList.remove("show");
              setTimeout(function(){ if (open.parentNode) open.parentNode.removeChild(open);
                document.body.classList.remove("sheet-open"); }, 180); }
            setTimeout(function () {
              var u = data.user.username;
              var d = data.user.display_name;
              if (it.a === "subscribe")   window._openSubscribeSheet(u, d);
              if (it.a === "invite")      window._openInviteToGroup(u);
              if (it.a === "send-contact") {
                window.api("/api/users/" + encodeURIComponent(u) + "/send-contact", { method: "POST" })
                  .then(function(){ if (typeof showToast === "function") showToast("📇 Contact পাঠানো হয়েছে"); })
                  .catch(function(e){ alert(e.message); });
              }
              if (it.a === "suggest") {
                var tmp = document.createElement("button");
                tmp.setAttribute("data-b10", "suggest");
                tmp.style.display = "none";
                document.body.appendChild(tmp);
                tmp.click();
                tmp.remove();
              }
            }, 200);
          });
          panel.appendChild(b);
        });
      }
    }, 60);
  }, true);

  console.log("[Batch10] subscription / verify / claim / misc ready");
})();
