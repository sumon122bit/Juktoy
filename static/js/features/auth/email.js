
// ==================================================
// S13-A — EMAIL + PASSWORD RESET (frontend)
// ==================================================

// ---- Settings: email card ----
(function () {
  var card = document.getElementById("email-card");
  if (!card) return;

  var statusText = document.getElementById("email-status-text");
  var hasView = document.getElementById("email-has");
  var noneView = document.getElementById("email-none");
  var showEl = document.getElementById("email-show");
  var badge = document.getElementById("email-verified-badge");

  async function refresh() {
    statusText.textContent = "লোড হচ্ছে...";
    try {
      var st = await window.api("/api/me/email/status");
      if (st.email) {
        hasView.classList.remove("hidden");
        noneView.classList.add("hidden");
        statusText.textContent = "ইমেইল যুক্ত আছে।";
        showEl.textContent = st.email;
        badge.classList.toggle("hidden", !st.verified);
      } else {
        hasView.classList.add("hidden");
        noneView.classList.remove("hidden");
        statusText.textContent = "এখনো ইমেইল যোগ করা হয়নি।";
      }
    } catch (err) {
      statusText.textContent = "লোড করা যায়নি";
    }
  }

  // S39 — exposed for unified loader
  window._loadEmailStatus = refresh;
  // S39 — wrapper disabled (unified loader at end of file)

  function openEditModal() {
    document.getElementById("email-input-field").value = "";
    document.getElementById("email-password-field").value = "";
    document.getElementById("email-edit-error").classList.add("hidden");
    document.getElementById("email-edit-modal").classList.remove("hidden");
    setTimeout(function () { document.getElementById("email-input-field").focus(); }, 80);
  }
  function closeEditModal() {
    document.getElementById("email-edit-modal").classList.add("hidden");
  }

  document.getElementById("btn-add-email").addEventListener("click", openEditModal);
  document.getElementById("btn-change-email").addEventListener("click", openEditModal);
  document.getElementById("close-email-edit").addEventListener("click", closeEditModal);
  document.getElementById("cancel-email-edit").addEventListener("click", closeEditModal);
  document.getElementById("email-edit-modal").addEventListener("click", function (e) {
    if (e.target === this) closeEditModal();
  });

  document.getElementById("submit-email-edit").addEventListener("click", async function () {
    var em = (document.getElementById("email-input-field").value || "").trim().toLowerCase();
    var pw = document.getElementById("email-password-field").value;
    var errEl = document.getElementById("email-edit-error");
    errEl.classList.add("hidden");

    if (!em) { errEl.textContent = "ইমেইল দিন"; errEl.classList.remove("hidden"); return; }
    if (!pw) { errEl.textContent = "পাসওয়ার্ড দিন"; errEl.classList.remove("hidden"); return; }

    var btn = this;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      const res = await window.api("/api/me/email", {
        method: "POST",
        body: JSON.stringify({ email: em, password: pw }),
      });
      closeEditModal();
      if (res && res.already_verified) {
        window.showToast("✅ ইমেইল ইতিমধ্যে যাচাইকৃত");
      } else if (res && res.verify_required) {
        // S27B fix — open code-input modal
        window.showToast("📧 " + (res.message || "৬ ডিজিটের কোড পাঠানো হয়েছে"));
        _openEmailCodeModal(em);
      } else {
        window.showToast("✅ ইমেইল সেভ হয়েছে।");
      }
      refresh();
      _loadSecurityDashboard().catch(() => {});
      _checkEmailGateFor2FA().catch(() => {});
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> সেভ করুন';
    }
  });

  // ═══════════════════════════════════════════════
  // S27B fix — Email verification code modal
  // ═══════════════════════════════════════════════
  function _openEmailCodeModal(emailAddr) {
    var old = document.getElementById("email-code-modal");
    if (old) old.remove();

    var modal = document.createElement("div");
    modal.id = "email-code-modal";
    modal.className = "modal";
    modal.style.zIndex = "99999";
    modal.innerHTML = `
      <div class="modal-content" style="max-width:440px">
        <button class="close-btn" id="ec-close" type="button">×</button>
        <h3 style="margin-bottom:10px;font-size:19px">📧 Email যাচাই করুন</h3>
        <p style="background:rgba(24,119,242,.08);border-left:3px solid var(--accent);padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.5;margin-bottom:14px">
          <strong>${escapeHtml(emailAddr)}</strong> এ ৬ ডিজিটের কোড পাঠানো হয়েছে। কোডটি ১০ মিনিট বৈধ।
        </p>
        <label class="edit-label">৬ ডিজিটের কোড</label>
        <div class="input-group" style="margin-bottom:14px">
          <i class="fa-solid fa-key input-icon"></i>
          <input type="text" id="ec-code" placeholder="123456" inputmode="numeric" maxlength="6"
                 style="text-align:center;letter-spacing:8px;font-size:20px;font-weight:800">
        </div>
        <p id="ec-error" class="hidden" style="color:var(--danger);font-size:13px;margin:0 0 10px;text-align:center;font-weight:600"></p>
        <div class="edit-actions">
          <button class="btn-secondary" id="ec-resend" type="button">📧 আবার পাঠান</button>
          <button class="btn-primary" id="ec-submit" type="button" style="width:auto;padding:12px 24px">
            <i class="fa-solid fa-check"></i> যাচাই করুন
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    function close() { modal.remove(); }
    function showErr(m) {
      var el = document.getElementById("ec-error");
      el.textContent = m; el.classList.remove("hidden");
    }
    function hideErr() {
      var el = document.getElementById("ec-error");
      if (el) el.classList.add("hidden");
    }

    document.getElementById("ec-close").onclick = close;
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    setTimeout(function () { document.getElementById("ec-code").focus(); }, 100);

    document.getElementById("ec-code").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); document.getElementById("ec-submit").click(); }
    });

    document.getElementById("ec-submit").onclick = async function () {
      var code = (document.getElementById("ec-code").value || "").trim();
      if (!/^\d{6}$/.test(code)) return showErr("৬ ডিজিটের কোড দিন");
      hideErr();
      var btn = this;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      try {
        var r = await window.api("/api/me/email/confirm-code", {
          method: "POST",
          body: JSON.stringify({ code: code }),
        });
        close();
        if (typeof showToast === "function") window.showToast("✅ " + (r.message || "Email যাচাই সম্পন্ন"));
        if (typeof _loadSecurityDashboard === "function") _loadSecurityDashboard();
        if (typeof _checkEmailGateFor2FA === "function") _checkEmailGateFor2FA();
      } catch (err) {
        showErr(err.message || "যাচাই ব্যর্থ");
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> যাচাই করুন';
      }
    };

    document.getElementById("ec-resend").onclick = async function () {
      var btn = this;
      btn.disabled = true;
      var oldHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      try {
        var r = await window.api("/api/me/email/resend-code", { method: "POST" });
        hideErr();
        if (typeof showToast === "function") {
          window.showToast(r.already_verified ? "✅ ইমেইল ইতিমধ্যে যাচাইকৃত" : "📧 নতুন কোড পাঠানো হয়েছে");
        }
      } catch (err) {
        showErr(err.message || "পাঠানো যায়নি");
      } finally {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
      }
    };
  }

  document.getElementById("btn-remove-email").addEventListener("click", async function () {
    var pw = prompt("নিশ্চিতকরণের জন্য পাসওয়ার্ড দিন:");
    if (!pw) return;
    try {
      await window.api("/api/me/email/remove", {
        method: "POST",
        body: JSON.stringify({ password: pw }),
      });
      window.showToast("✅ ইমেইল মুছে ফেলা হয়েছে");
      refresh();
    } catch (err) { alert(err.message); }
  });

  console.log("[S13-A] email card attached ✅");
})();
// ---- Forgot password modal (email) ----
(function () {
  var modal = document.getElementById("forgot-modal");
  if (!modal) return;

  var step1 = document.getElementById("forgot-step-1");
  var step2 = document.getElementById("forgot-step-2");
  var openBtn = document.getElementById("open-forgot");
  var errEl = document.getElementById("forgot-error");

  function showError(msg) {
    errEl.textContent = msg || "";
    errEl.classList.toggle("hidden", !msg);
  }

  function resetModal() {
    document.getElementById("forgot-email").value = "";
    step1.classList.remove("hidden");
    step2.classList.add("hidden");
    showError("");
  }

  function open() {
    resetModal();
    modal.classList.remove("hidden");
    setTimeout(function () { document.getElementById("forgot-email").focus(); }, 80);
  }
  function close() { modal.classList.add("hidden"); }

  if (openBtn) openBtn.addEventListener("click", function (e) { e.preventDefault(); open(); });
  document.getElementById("close-forgot").addEventListener("click", close);
  document.getElementById("cancel-forgot-1").addEventListener("click", close);
  document.getElementById("forgot-done").addEventListener("click", close);
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  document.getElementById("btn-forgot-send").addEventListener("click", async function () {
    var em = (document.getElementById("forgot-email").value || "").trim().toLowerCase();
    if (!em) return showError("ইমেইল দিন");
    var btn = this;
    btn.disabled = true;
    var old = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      await window.api("/api/auth/forgot/send", {
        method: "POST",
        body: JSON.stringify({ email: em }),
      });
      showError("");
      document.getElementById("forgot-sent-to").textContent = em;
      step1.classList.add("hidden");
      step2.classList.remove("hidden");
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = old;
    }
  });

  console.log("[S13-A] forgot modal attached ✅");
})();


// ---- Reset password (from email link) + email verify ----
(function () {
  // S16.3 — read token from URL fragment (#reset=... / #verify_email=...).
  // Fragments are NEVER sent to the server → no leak in logs/referrer/analytics.
  // Query-string is still supported for backward compat (old emails).
  var hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  var queryParams = new URLSearchParams(window.location.search);
  var token = hashParams.get("reset") || queryParams.get("reset");
  var verifyTok = hashParams.get("verify_email") || queryParams.get("verify_email");

  // Email verification
  if (verifyTok) {
    (async function () {
      try {
        await window.api("/api/me/email/verify", {
          method: "POST",
          body: JSON.stringify({ token: verifyTok }),
        });
        window.showToast("✅ ইমেইল যাচাই সম্পন্ন");
      } catch (err) {
        window.showToast("❌ " + (err.message || "যাচাই ব্যর্থ"));
      } finally {
        history.replaceState({}, "", window.location.pathname);
      }
    })();
    return;
  }

  // Password reset
  if (!token) return;

  var modal = document.getElementById("reset-modal");
  if (!modal) return;

  (async function () {
    try {
      var res = await window.api("/api/auth/reset/check", {
        method: "POST",
        body: JSON.stringify({ token: token }),
      });
      if (!res.valid) {
        window.showToast("❌ লিংকটি invalid বা expire হয়েছে");
        history.replaceState({}, "", window.location.pathname);
        return;
      }
      document.getElementById("reset-for-user").classList.remove("hidden");
      document.getElementById("reset-username").textContent = "@" + res.username;
      document.getElementById("reset-new-pw").value = "";
      document.getElementById("reset-confirm-pw").value = "";
      document.getElementById("reset-error").classList.add("hidden");
      modal.classList.remove("hidden");
      setTimeout(function () { document.getElementById("reset-new-pw").focus(); }, 100);
    } catch (err) {
      window.showToast("❌ লিংক যাচাই করা যায়নি");
      history.replaceState({}, "", window.location.pathname);
    }
  })();

  function closeReset() {
    modal.classList.add("hidden");
    history.replaceState({}, "", window.location.pathname);
  }

  document.getElementById("reset-cancel").addEventListener("click", closeReset);
  modal.addEventListener("click", function (e) { if (e.target === modal) closeReset(); });

  document.getElementById("reset-submit").addEventListener("click", async function () {
    var pw1 = document.getElementById("reset-new-pw").value;
    var pw2 = document.getElementById("reset-confirm-pw").value;
    var errEl = document.getElementById("reset-error");
    errEl.classList.add("hidden");

    if (!pw1 || pw1.length < 6) { errEl.textContent = "পাসওয়ার্ড ৬+ অক্ষর"; errEl.classList.remove("hidden"); return; }
    if (pw1 !== pw2) { errEl.textContent = "পাসওয়ার্ড মিলছে না"; errEl.classList.remove("hidden"); return; }

    var btn = this;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      await window.api("/api/auth/reset/complete", {
        method: "POST",
        body: JSON.stringify({ token: token, new_password: pw1 }),
      });
      closeReset();
      window.showToast("✅ পাসওয়ার্ড রিসেট হয়েছে। এখন লগইন করুন।");
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> সেভ করুন';
    }
  });

  console.log("[S13-A] reset modal attached ✅");
})();

