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
        <div class="sd-check-label">${window.escapeHtml(label)}</div>
        <div class="sd-check-hint">${window.escapeHtml(hint || "")}</div>
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
        <div class="sd-score-label" style="color:${color}">${window.escapeHtml(riskLabel)}</div>
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
        ${window.escapeHtml(code)}
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
      if (typeof showToast === "function") window.showToast("📋 কপি হয়েছে");
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
          <input type="text" id="r2f-username" placeholder="your_username" value="${window.escapeHtml(prefillUser)}">
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
        window.showToast("✅ " + (res.message || "2FA বন্ধ করা হয়েছে"));
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
          window.showToast("✅ Email 2FA বন্ধ হয়েছে");
        } else {
          const res = await window.api("/api/me/2fa/email/enable", {
            method: "POST",
            body: JSON.stringify({ password }),
          });
          window.showToast("✅ " + (res.message || "Email 2FA চালু হয়েছে"));
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
          window.showToast("✅ Authenticator 2FA বন্ধ হয়েছে");
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
    if (typeof showToast === "function") window.showToast("✅ Recovery Kit ডাউনলোড হয়েছে");
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
      if (typeof showToast === "function") window.showToast("✅ " + (res.message || "Backup email সেভ হয়েছে"));
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

