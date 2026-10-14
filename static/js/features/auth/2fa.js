

// ==================================================
// S12 — TWO-FACTOR AUTHENTICATION (frontend)
// ==================================================

// Pending 2FA state
window._pending2fa = { token: null };

// ---- Login form: intercept needs_2fa ----
(function () {
  var loginForm = document.getElementById("login-form");
  var twoForm = document.getElementById("login-2fa-form");
  var regForm = document.getElementById("register-form");
  if (!loginForm || !twoForm) return;

  var oldSubmit = loginForm.onsubmit;
  loginForm.addEventListener("submit", async function (e) {
    // Don't let old handler double-fire
    e.preventDefault();
    e.stopImmediatePropagation();

    var f = e.target;
    window.showMessage("অপেক্ষা করুন...");
    try {
      var res = await window.api("/api/login", {
        method: "POST",
        body: JSON.stringify({
          username: f.username.value,
          password: f.password.value,
        }),
      });
      if (res && res.needs_2fa) {
        window._pending2fa.token = res.temp_token;
        window._pending2fa.method = res.method || "totp";
        window.showMessage("");
        loginForm.classList.add("hidden");
        twoForm.classList.remove("hidden");
        document.getElementById("footer-login").classList.add("hidden");

        // S27B-4 fix — show correct hint based on method
        var hintEl = document.getElementById("login-2fa-hint");
        var emailLine = document.getElementById("login-2fa-email-line");
        var emailMask = document.getElementById("login-2fa-email-mask");
        var codeInput = document.getElementById("login-2fa-code");

        var backupLine = document.getElementById("login-2fa-backup-line");

        if (res.method === "email") {
          if (hintEl) hintEl.textContent = "আপনার ইমেইলে পাঠানো ৬ ডিজিটের কোড দিন";
          if (emailLine) emailLine.classList.remove("hidden");
          if (emailMask) emailMask.textContent = res.email_masked || "your email";
          if (backupLine) backupLine.style.display = "none";
          if (codeInput) {
            codeInput.placeholder = "123456";
            codeInput.maxLength = 6;
            codeInput.style.letterSpacing = "6px";
            codeInput.style.fontSize = "18px";
          }
        } else {
          if (backupLine) backupLine.style.display = "";
          if (hintEl) hintEl.textContent = "আপনার authenticator app থেকে ৬ ডিজিটের কোড দিন";
          if (emailLine) emailLine.classList.add("hidden");
          if (codeInput) {
            codeInput.placeholder = "123456";
            codeInput.maxLength = 6;
            codeInput.style.letterSpacing = "6px";
            codeInput.style.fontSize = "18px";
          }
        }

        setTimeout(function () { codeInput.focus(); }, 80);
        return;
      }
      window.showMessage("");
      await window.enterApp();
    } catch (err) {
      window.showMessage(err.message, "error");
    }
  }, true);

  // ---- 2FA code form ----
  twoForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    var code = (document.getElementById("login-2fa-code").value || "").trim();
    if (!code) return;
    window.showMessage("যাচাই হচ্ছে...");
    try {
      var res = await window.api("/api/login/2fa", {
        method: "POST",
        body: JSON.stringify({ temp_token: window._pending2fa.token, code: code }),
      });
      window.showMessage("");
      document.getElementById("login-2fa-code").value = "";
      await window.enterApp();
      if (res.used_backup) {
        window.showToast("✅ Backup code ব্যবহৃত। বাকি: " + res.backup_codes_remaining);
      }
    } catch (err) {
      window.showMessage(err.message, "error");
    }
  }, true);

  // ---- Switch to backup code ----
  document.getElementById("switch-backup-code").addEventListener("click", function (e) {
    e.preventDefault();
    var codeInput = document.getElementById("login-2fa-code");
    codeInput.placeholder = "XXXXX-XXXXX";
    codeInput.maxLength = 11;
    codeInput.style.letterSpacing = "2px";
    codeInput.style.fontSize = "16px";
    codeInput.focus();
  });

  // ---- Back to password step ----
  document.getElementById("switch-login-2fa-back").addEventListener("click", function (e) {
    e.preventDefault();
    twoForm.classList.add("hidden");
    loginForm.classList.remove("hidden");
    document.getElementById("footer-login").classList.remove("hidden");
    window._pending2fa.token = null;
    window.showMessage("");
  });
})();
// ---- Settings: 2FA card ----
(function () {
  var card = document.getElementById("2fa-card");
  if (!card) return;

  var statusText = document.getElementById("2fa-status-text");
  var enabledView = document.getElementById("2fa-enabled-view");
  var disabledView = document.getElementById("2fa-disabled-view");
  var backupCount = document.getElementById("2fa-backup-count");

  async function refresh() {
    statusText.textContent = "লোড হচ্ছে...";
    try {
      var st = await window.api("/api/me/2fa/status");
      if (st.enabled) {
        enabledView.classList.remove("hidden");
        disabledView.classList.add("hidden");
        statusText.textContent = "Two-Factor Authentication সক্রিয়।";
        backupCount.textContent = st.backup_codes_remaining;
      } else {
        enabledView.classList.add("hidden");
        disabledView.classList.remove("hidden");
        statusText.textContent = "2FA চালু করলে পাসওয়ার্ড ছাড়াও একটি ৬ ডিজিটের কোড লাগবে।";
      }
    } catch (err) {
      statusText.textContent = "লোড করা যায়নি";
    }
  }

  // Load when settings opens
  // S39 — exposed for unified loader
  window._load2FAStatus = refresh;
  // S39 — wrapper disabled (unified loader at end of file)

  // ---- Enable flow ----
  document.getElementById("btn-enable-2fa").addEventListener("click", async function () {
    var modal = document.getElementById("2fa-setup-modal");
    try {
      var res = await window.api("/api/me/2fa/setup", { method: "POST" });
      document.getElementById("2fa-secret-display").value = res.secret;
      document.getElementById("2fa-otpauth-display").value = res.otpauth;
      document.getElementById("2fa-verify-code").value = "";
      modal.classList.remove("hidden");
    } catch (err) {
      alert(err.message);
    }
  });

  // Copy buttons
  document.getElementById("btn-copy-2fa-secret").addEventListener("click", function () {
    var val = document.getElementById("2fa-secret-display").value;
    navigator.clipboard.writeText(val).then(function () { window.showToast("📋 সিক্রেট কপি হয়েছে"); });
  });
  document.getElementById("btn-copy-2fa-otpauth").addEventListener("click", function () {
    var val = document.getElementById("2fa-otpauth-display").value;
    navigator.clipboard.writeText(val).then(function () { window.showToast("📋 URI কপি হয়েছে"); });
  });

  // Close setup modal
  function closeSetup() { document.getElementById("2fa-setup-modal").classList.add("hidden"); }
  document.getElementById("close-2fa-setup").addEventListener("click", closeSetup);
  document.getElementById("cancel-2fa-setup").addEventListener("click", closeSetup);
  document.getElementById("2fa-setup-modal").addEventListener("click", function (e) {
    if (e.target === this) closeSetup();
  });

  // Verify code → enable
  document.getElementById("submit-2fa-setup").addEventListener("click", async function () {
    var code = (document.getElementById("2fa-verify-code").value || "").trim();
    if (!code) return;
    var btn = this;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      var res = await window.api("/api/me/2fa/verify", {
        method: "POST",
        body: JSON.stringify({ code: code }),
      });
      closeSetup();
      // Show backup codes
      var list = document.getElementById("2fa-backup-list");
      list.innerHTML = res.backup_codes.map(function (c) {
        return '<div class="backup-code-item">' + c + '</div>';
      }).join("");
      document.getElementById("2fa-backup-modal").classList.remove("hidden");
      refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> চালু করুন';
    }
  });

  // Backup codes modal
  document.getElementById("btn-copy-backup").addEventListener("click", function () {
    var codes = [].slice.call(document.querySelectorAll(".backup-code-item"))
      .map(function (el) { return el.textContent; }).join("\n");
    navigator.clipboard.writeText(codes).then(function () { window.showToast("📋 সব কপি হয়েছে"); });
  });
  document.getElementById("btn-done-backup").addEventListener("click", function () {
    document.getElementById("2fa-backup-modal").classList.add("hidden");
    window.showToast("✅ 2FA চালু হয়েছে");
  });

  // ---- Disable flow ----
  document.getElementById("btn-disable-2fa").addEventListener("click", function () {
    document.getElementById("2fa-disable-pw").value = "";
    document.getElementById("2fa-disable-modal").classList.remove("hidden");
    setTimeout(function () { document.getElementById("2fa-disable-pw").focus(); }, 80);
  });

  function closeDisable() { document.getElementById("2fa-disable-modal").classList.add("hidden"); }
  document.getElementById("close-2fa-disable").addEventListener("click", closeDisable);
  document.getElementById("cancel-2fa-disable").addEventListener("click", closeDisable);
  document.getElementById("2fa-disable-modal").addEventListener("click", function (e) {
    if (e.target === this) closeDisable();
  });

  document.getElementById("submit-2fa-disable").addEventListener("click", async function () {
    var pw = document.getElementById("2fa-disable-pw").value;
    if (!pw) return;
    var btn = this;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      await window.api("/api/me/2fa/disable", {
        method: "POST",
        body: JSON.stringify({ password: pw }),
      });
      closeDisable();
      window.showToast("2FA নিষ্ক্রিয় করা হয়েছে");
      refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-shield-slash"></i> নিষ্ক্রিয় করুন';
    }
  });

  console.log("[S12] 2FA UI attached ✅");
})();
