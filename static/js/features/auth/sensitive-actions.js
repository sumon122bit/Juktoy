export async function _askSensitiveVerify(opts) {
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
          window.escapeHtml(title) +
        '</h2>' +
        '<p class="settings-hint" style="margin-bottom:14px">' + window.escapeHtml(description) + '</p>' +
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
            '<i class="fa-solid fa-check"></i> ' + window.escapeHtml(submitLabel) +
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

  if (!cur || !neu || !conf) return window.showToast("সব ফিল্ড পূরণ করুন");
  if (neu.length < 8)        return window.showToast("নতুন পাসওয়ার্ড ৮+ অক্ষর হতে হবে");
  if (neu !== conf)          return window.showToast("নতুন পাসওয়ার্ড দুইবার একই লিখুন");
  if (cur === neu)           return window.showToast("নতুন পাসওয়ার্ড পুরোনোর মতো হতে পারে না");

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
    window.showToast("✅ পাসওয়ার্ড পরিবর্তন হয়েছে");
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
  if (!uname)                       return window.showToast("নতুন ইউজারনেম লিখুন");
  if (!/^[a-z0-9_]+$/.test(uname))  return window.showToast("শুধু a-z, 0-9, _ ব্যবহার করুন");
  if (window.state.me && uname === window.state.me.username)
    return window.showToast("এটাই আপনার বর্তমান ইউজারনেম");

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
    window.showToast("✅ ইউজারনেম পরিবর্তন হয়েছে");
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
    window.showToast("অ্যাকাউন্ট মুছে ফেলা হয়েছে");
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
    window.showToast("✅ ইমেইল সরানো হয়েছে");
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
    window.showToast("✅ 2FA নিষ্ক্রিয় করা হয়েছে");
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
    window.showToast("✅ অন্য সব ডিভাইস থেকে লগআউট");
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

// ---------- Temporary bridge ----------
window._askSensitiveVerify = _askSensitiveVerify;
