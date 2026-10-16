// ==================================================
// S14 — ADMIN PANEL
// ==================================================

window._isAdmin = false;

// ---- Detect admin status after login ----
export async function _checkAdminStatus() {
  try {
    var res = await window.api("/api/admin/check");
    window._isAdmin = !!res.is_admin;
    var navAdmin = document.getElementById("nav-admin");
    if (navAdmin) {
      navAdmin.classList.toggle("hidden", !window._isAdmin);
    }
    // S22 / Layer 6 — 2FA warning for admin
    if (window._isAdmin && res.needs_2fa_setup) {
      if (typeof window.showToast === "function") {
        setTimeout(function () {
          window.showToast("🛡️ অ্যাডমিন অ্যাক্সেসের জন্য 2FA চালু করুন — Settings → Two-Factor");
        }, 800);
      }
    }
  } catch (e) {
    window._isAdmin = false;
  }
}

// Call after window.enterApp
window._enterAppHooks.push(_checkAdminStatus);


// ---- Open admin page ----
export function openAdminPage() {
  if (!window._isAdmin) {
    window.showToast("🛡️ শুধু অ্যাডমিন অ্যাক্সেস করতে পারবেন");
    return;
  }
  var page = document.getElementById("admin-page");
  if (!page) return;
  page.classList.remove("hidden");
  document.body.classList.add("overlay-open");
  window._pushPage("admin");
  _adminShowTab("dashboard");
}

export function closeAdminPage() {
  var page = document.getElementById("admin-page");
  if (page) page.classList.add("hidden");
  document.body.classList.remove("overlay-open");
}

// ---- Tab switching ----
export function _adminShowTab(name) {
  document.querySelectorAll(".admin-tab").forEach(function (t) {
    t.classList.toggle("active", t.dataset.atab === name);
  });
  ["dashboard", "reports", "users", "log"].forEach(function (n) {
    var pane = document.getElementById("admin-pane-" + n);
    if (pane) pane.classList.toggle("hidden", n !== name);
  });
  if (name === "dashboard") _loadAdminDashboard();
  else if (name === "reports") _loadAdminReports();
  else if (name === "users") _loadAdminUsers();
  else if (name === "log") _loadAdminLog();
}

document.addEventListener("click", function (e) {
  var tab = e.target.closest(".admin-tab");
  if (tab) {
    e.preventDefault();
    _adminShowTab(tab.dataset.atab);
  }
});

// ---- Refresh ----
document.getElementById("admin-refresh")?.addEventListener("click", function () {
  var active = document.querySelector(".admin-tab.active");
  _adminShowTab(active ? active.dataset.atab : "dashboard");
});

// ---- Back ----
document.getElementById("admin-back")?.addEventListener("click", function () {
  if (window._PageStack.length > 0 && window._PageStack[window._PageStack.length - 1] === "admin") {
    history.back();
  } else {
    closeAdminPage();
  }
});

// ---- Extend window._closeTopPage ----
window._origCloseTopPageAdmin = window._closeTopPage;
window._closeTopPage = function () {
  var top = window._PageStack[window._PageStack.length - 1];
  if (top === "admin") {
    window._PageStack.pop();
    closeAdminPage();
    return true;
  }
  return window._origCloseTopPageAdmin();
};
  window._closeTopPage = window._closeTopPage;

// ---- Nav item click ----
document.addEventListener("click", function (e) {
  var nav = e.target.closest('#nav-admin');
  if (nav) {
    e.preventDefault();
    if (typeof closeSidebar === "function") closeSidebar();
    openAdminPage();
  }
}, true);


// ---- Dashboard ----
export async function _loadAdminDashboard() {
  var el = document.getElementById("admin-pane-dashboard");
  if (!el) return;
  el.innerHTML = '<p style="text-align:center;color:var(--muted);padding:40px">লোড হচ্ছে...</p>';
  try {
    var stats = await window.api("/api/admin/stats");
    el.innerHTML =
      '<div class="admin-stats-grid">' +
        _statCard("অপেক্ষমাণ রিপোর্ট", stats.pending_reports, "fa-flag", "orange") +
        _statCard("মোট রিপোর্ট", stats.total_reports, "fa-list", "blue") +
        _statCard("মোট ইউজার", stats.total_users, "fa-users", "purple") +
        _statCard("স্থগিত ইউজার", stats.banned_users, "fa-ban", "red") +
        _statCard("মোট পোস্ট", stats.total_posts, "fa-file-lines", "green") +
        _statCard("আজকের ব্যবস্থা", stats.actioned_today, "fa-check", "teal") +
      '</div>' +
      '<div class="admin-section-title">⚡ দ্রুত কাজ</div>' +
      '<div class="admin-quick-actions">' +
        '<button class="admin-quick-btn" data-goto="reports"><i class="fa-solid fa-flag"></i><span>রিপোর্ট দেখুন</span></button>' +
        '<button class="admin-quick-btn" data-goto="users"><i class="fa-solid fa-users"></i><span>ইউজার ম্যানেজ</span></button>' +
        '<button class="admin-quick-btn" data-goto="log"><i class="fa-solid fa-list-check"></i><span>মডারেশন লগ</span></button>' +
      '</div>';

    el.querySelectorAll("[data-goto]").forEach(function (b) {
      b.addEventListener("click", function () { _adminShowTab(b.dataset.goto); });
    });
  } catch (err) {
    el.innerHTML = '<p style="text-align:center;color:var(--danger);padding:40px">লোড করা যায়নি: ' + err.message + '</p>';
  }
}

export function _statCard(label, value, icon, color) {
  return '<div class="admin-stat-card ' + color + '">' +
    '<div class="admin-stat-icon"><i class="fa-solid ' + icon + '"></i></div>' +
    '<div class="admin-stat-value">' + value + '</div>' +
    '<div class="admin-stat-label">' + label + '</div>' +
  '</div>';
}


// ---- Reports list ----
export async function _loadAdminReports() {
  var el = document.getElementById("admin-pane-reports");
  if (!el) return;
  el.innerHTML = '<p style="text-align:center;color:var(--muted);padding:40px">লোড হচ্ছে...</p>';
  try {
    var reports = await window.api("/api/admin/reports?status=all");
    if (!reports.length) {
      el.innerHTML = '<div class="admin-empty"><i class="fa-solid fa-check-circle"></i><p>কোনো রিপোর্ট নেই ✨</p></div>';
      return;
    }
    el.innerHTML = reports.map(_adminReportHTML).join("");
    el.querySelectorAll("[data-action]").forEach(function (b) {
      b.addEventListener("click", function () {
        _adminHandleReportAction(b);
      });
    });
  } catch (err) {
    el.innerHTML = '<p style="text-align:center;color:var(--danger);padding:40px">লোড করা যায়নি</p>';
  }
}

export function _adminReportHTML(r) {
  var target = r.target || {};
  var reasonLabels = {
    spam: "স্প্যাম", harassment: "হয়রান", violence: "হিংস্রতা",
    false_info: "মিথ্যা তথ্য", other: "অন্য",
  };
  var statusLabels = {
    pending: "⏳ অপেক্ষমাণ", actioned: "✅ ব্যবস্থা নেওয়া", dismissed: "✖️ বাতিল",
  };
  var typeLabels = { post: "পোস্ট", user: "ইউজার", comment: "কমেন্ট", reel: "রিল" };

  var preview = "";
  if (r.target_type === "post" && target.content) {
    preview = '<div class="admin-report-preview">' + window.escapeHtml(target.content.slice(0, 200)) + '</div>';
    if (target.media && target.media.length) {
      preview += '<div class="admin-report-media">' + target.media.slice(0, 3).map(function (m) {
        return '<img src="' + window.escapeHtml(m) + '" alt="" loading="lazy" decoding="async">';
      }).join("") + '</div>';
    }
  } else if (r.target_type === "comment" && target.content) {
    preview = '<div class="admin-report-preview">' + window.escapeHtml(target.content.slice(0, 200)) + '</div>';
  } else if (r.target_type === "user") {
    preview = '<div class="admin-report-preview">ইউজার: @' + window.escapeHtml(target.username || "?") + '</div>';
  } else if (r.target_type === "reel" && target.caption) {
    preview = '<div class="admin-report-preview">' + window.escapeHtml(target.caption.slice(0, 200)) + '</div>';
  }

  var targetAuthor = "";
  if (target.username && r.target_type !== "user") {
    targetAuthor = '<div class="admin-report-author">লেখক: <strong>@' + window.escapeHtml(target.username) + '</strong></div>';
  }

  return '<div class="admin-report-card ' + (r.status === "pending" ? "pending" : "resolved") + '" data-rid="' + r.id + '">' +
    '<div class="admin-report-head">' +
      '<div class="admin-report-type">' +
        '<i class="fa-solid fa-flag"></i> ' + (typeLabels[r.target_type] || r.target_type) +
      '</div>' +
      '<div class="admin-report-status">' + (statusLabels[r.status] || r.status) + '</div>' +
    '</div>' +
    '<div class="admin-report-meta">' +
      'কারণ: <strong>' + (reasonLabels[r.reason] || r.reason) + '</strong>' +
      ' • রিপোর্টার: <strong>@' + window.escapeHtml(r.reporter_username) + '</strong>' +
      ' • ' + timeAgo(r.created_at) +
    '</div>' +
    targetAuthor +
    preview +
    (r.notes ? '<div class="admin-report-notes">📝 ' + window.escapeHtml(r.notes) + '</div>' : '') +
    (r.status === "pending"
      ? '<div class="admin-report-actions">' +
          (r.target_type === "post" || r.target_type === "comment" || r.target_type === "reel"
            ? '<button class="admin-btn danger" data-action="delete" data-rid="' + r.id + '"><i class="fa-solid fa-trash"></i> কনটেন্ট মুছুন</button>'
            : "") +
          '<button class="admin-btn danger" data-action="ban" data-rid="' + r.id + '"><i class="fa-solid fa-ban"></i> ইউজার ban</button>' +
          '<button class="admin-btn" data-action="dismiss" data-rid="' + r.id + '"><i class="fa-solid fa-xmark"></i> বাতিল</button>' +
        '</div>'
      : '<div class="admin-report-actions"><button class="admin-btn" data-action="reopen" data-rid="' + r.id + '"><i class="fa-solid fa-rotate-left"></i> আবার খুলুন</button></div>') +
  '</div>';
}

export async function _adminHandleReportAction(btn) {
  var action = btn.dataset.action;
  var rid = btn.dataset.rid;
  if (!action || !rid) return;

  if (action === "dismiss" || action === "reopen") {
    try {
      await window.api("/api/admin/reports/" + rid + "/action", {
        method: "POST",
        body: JSON.stringify({ action: action }),
      });
      window.showToast(action === "dismiss" ? "✖️ বাতিল করা হয়েছে" : "🔁 আবার খোলা হয়েছে");
      _loadAdminReports();
    } catch (err) { alert(err.message); }
    return;
  }

  if (action === "delete") {
    if (!confirm("এই কনটেন্ট মুছে ফেলবেন? এটি ফেরানো যাবে না।")) return;
    try {
      await window.api("/api/admin/reports/" + rid + "/action", {
        method: "POST",
        body: JSON.stringify({ action: "delete" }),
      });
      window.showToast("🗑️ মুছে ফেলা হয়েছে");
      _loadAdminReports();
    } catch (err) { alert(err.message); }
    return;
  }

  if (action === "ban") {
    _adminOpenBanModal(rid);
    return;
  }
}

export function _adminOpenBanModal(reportId) {
  var modal = document.getElementById("admin-action-modal");
  if (!modal) return;
  document.getElementById("admin-action-title").innerHTML = '<i class="fa-solid fa-ban" style="color:var(--danger)"></i> ইউজার ban করুন';
  document.getElementById("admin-action-body").innerHTML =
    '<p class="settings-hint">কতদিন ban থাকবে?</p>' +
    '<div class="ban-duration-grid">' +
      '<button class="ban-option" data-days="1">১ দিন</button>' +
      '<button class="ban-option" data-days="7">৭ দিন</button>' +
      '<button class="ban-option" data-days="30">৩০ দিন</button>' +
      '<button class="ban-option" data-days="forever">চিরতরে</button>' +
    '</div>' +
    '<label class="edit-label" style="margin-top:14px">কারণ (ঐচ্ছিক)</label>' +
    '<input type="text" id="admin-ban-reason" class="edit-bio-input" style="min-height:44px" placeholder="যেমন: spam, harassment" maxlength="200">' +
    '<div class="edit-actions" style="margin-top:14px">' +
      '<button class="btn-secondary" id="admin-ban-cancel">বাতিল</button>' +
    '</div>';

  modal.classList.remove("hidden");

  document.getElementById("admin-ban-cancel").onclick = function () {
    modal.classList.add("hidden");
  };
  document.getElementById("close-admin-action").onclick = function () {
    modal.classList.add("hidden");
  };

  modal.querySelectorAll(".ban-option").forEach(function (b) {
    b.addEventListener("click", async function () {
      var days = b.dataset.days;
      var reason = (document.getElementById("admin-ban-reason").value || "").trim() || "নীতিমালা লঙ্ঘন";
      try {
        await window.api("/api/admin/reports/" + reportId + "/action", {
          method: "POST",
          body: JSON.stringify({ action: "ban", ban_days: days, ban_reason: reason }),
        });
        modal.classList.add("hidden");
        window.showToast("🚫 ইউজার ban করা হয়েছে");
        _loadAdminReports();
      } catch (err) { alert(err.message); }
    });
  });
}


// ---- Users ----
export async function _loadAdminUsers() {
  var el = document.getElementById("admin-pane-users");
  if (!el) return;
  el.innerHTML =
    '<div class="admin-search-bar">' +
      '<i class="fa-solid fa-magnifying-glass"></i>' +
      '<input type="text" id="admin-user-search" placeholder="ইউজারনেম বা নাম...">' +
    '</div>' +
    '<div id="admin-users-list"></div>';

  var input = document.getElementById("admin-user-search");
  var timer = null;
  input.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(function () { _adminFetchUsers(input.value.trim()); }, 300);
  });
  _adminFetchUsers("");
}

export async function _adminFetchUsers(q) {
  var list = document.getElementById("admin-users-list");
  if (!list) return;
  list.innerHTML = '<p style="text-align:center;color:var(--muted);padding:30px">লোড হচ্ছে...</p>';
  try {
    var users = await window.api("/api/admin/users?q=" + encodeURIComponent(q));
    if (!users.length) {
      list.innerHTML = '<div class="admin-empty"><p>কোনো ইউজার নেই</p></div>';
      return;
    }
    list.innerHTML = users.map(_adminUserRowHTML).join("");
    list.querySelectorAll("[data-user-action]").forEach(function (b) {
      b.addEventListener("click", function () {
        _adminUserAction(b);
      });
    });
  } catch (err) {
    list.innerHTML = '<p style="color:var(--danger);padding:30px;text-align:center">লোড করা যায়নি</p>';
  }
}

export function _adminUserRowHTML(u) {
  var badge = "";
  if (u.is_admin) badge += ' <span class="admin-badge blue">Admin</span>';
  if (u.is_banned) badge += ' <span class="admin-badge red">Banned</span>';
  if (u.google_linked) badge += ' <span class="admin-badge gray">Google</span>';
  if (u.pending_reports > 0) badge += ' <span class="admin-badge orange">' + u.pending_reports + ' report</span>';

  return '<div class="admin-user-row">' +
    '<div class="admin-user-avatar">' + window.avatarInner(u.display_name, u.profile_pic) + '</div>' +
    '<div class="admin-user-info">' +
      '<div class="admin-user-name">' + window.escapeHtml(u.display_name) + badge + '</div>' +
      '<div class="admin-user-username">@' + window.escapeHtml(u.username) + '</div>' +
      (u.email ? '<div class="admin-user-email">' + window.escapeHtml(u.email) + '</div>' : "") +
      (u.is_banned ? '<div class="admin-user-ban-reason">কারণ: ' + window.escapeHtml(u.ban_reason || "—") + '</div>' : "") +
    '</div>' +
    '<div class="admin-user-actions">' +
      (u.is_banned
        ? '<button class="admin-btn" data-user-action="unban" data-uid="' + u.id + '"><i class="fa-solid fa-unlock"></i> আনব্যান</button>'
        : (u.is_admin
            ? ""
            : '<button class="admin-btn danger" data-user-action="ban" data-uid="' + u.id + '" data-uname="' + window.escapeHtml(u.username) + '"><i class="fa-solid fa-ban"></i> Ban</button>')) +
    '</div>' +
  '</div>';
}

export async function _adminUserAction(btn) {
  var action = btn.dataset.userAction;
  var uid = btn.dataset.uid;
  if (action === "unban") {
    try {
      await window.api("/api/admin/users/" + uid + "/unban", { method: "POST" });
      window.showToast("✅ আনব্যান করা হয়েছে");
      _adminFetchUsers(document.getElementById("admin-user-search")?.value || "");
    } catch (err) { alert(err.message); }
  } else if (action === "ban") {
    _adminOpenUserBanModal(uid, btn.dataset.uname || "");
  }
}

export function _adminOpenUserBanModal(uid, username) {
  var modal = document.getElementById("admin-action-modal");
  if (!modal) return;
  document.getElementById("admin-action-title").innerHTML = '<i class="fa-solid fa-ban" style="color:var(--danger)"></i> @' + window.escapeHtml(username) + ' কে ban';
  document.getElementById("admin-action-body").innerHTML =
    '<p class="settings-hint">কতদিন ban থাকবে?</p>' +
    '<div class="ban-duration-grid">' +
      '<button class="ban-option" data-days="1">১ দিন</button>' +
      '<button class="ban-option" data-days="7">৭ দিন</button>' +
      '<button class="ban-option" data-days="30">৩০ দিন</button>' +
      '<button class="ban-option" data-days="forever">চিরতরে</button>' +
    '</div>' +
    '<label class="edit-label" style="margin-top:14px">কারণ (ঐচ্ছিক)</label>' +
    '<input type="text" id="admin-ban-reason" class="edit-bio-input" style="min-height:44px" placeholder="যেমন: spam, harassment" maxlength="200">' +
    '<div class="edit-actions" style="margin-top:14px">' +
      '<button class="btn-secondary" id="admin-ban-cancel">বাতিল</button>' +
    '</div>';

  modal.classList.remove("hidden");
  document.getElementById("admin-ban-cancel").onclick = function () { modal.classList.add("hidden"); };
  document.getElementById("close-admin-action").onclick = function () { modal.classList.add("hidden"); };

  modal.querySelectorAll(".ban-option").forEach(function (b) {
    b.addEventListener("click", async function () {
      var days = b.dataset.days;
      var reason = (document.getElementById("admin-ban-reason").value || "").trim() || "নীতিমালা লঙ্ঘন";
      try {
        await window.api("/api/admin/users/" + uid + "/ban", {
          method: "POST",
          body: JSON.stringify({ ban_days: days, ban_reason: reason }),
        });
        modal.classList.add("hidden");
        window.showToast("🚫 ইউজার ban করা হয়েছে");
        _adminFetchUsers(document.getElementById("admin-user-search")?.value || "");
      } catch (err) { alert(err.message); }
    });
  });
}


// ---- Log ----
export async function _loadAdminLog() {
  var el = document.getElementById("admin-pane-log");
  if (!el) return;
  el.innerHTML = '<p style="text-align:center;color:var(--muted);padding:40px">লোড হচ্ছে...</p>';
  try {
    var logs = await window.api("/api/admin/log");
    if (!logs.length) {
      el.innerHTML = '<div class="admin-empty"><p>এখনো কোনো action নেওয়া হয়নি</p></div>';
      return;
    }
    var actionLabels = {
      delete: "🗑️ মুছেছে", ban: "🚫 Ban করেছে",
      unban: "✅ আনব্যান করেছে", dismiss: "✖️ বাতিল করেছে",
    };
    el.innerHTML = '<div class="admin-log-list">' + logs.map(function (l) {
      return '<div class="admin-log-row">' +
        '<div class="admin-log-avatar">' + window.avatarInner(l.admin_name, l.admin_pic) + '</div>' +
        '<div class="admin-log-body">' +
          '<div class="admin-log-action">' + (actionLabels[l.action] || l.action) + ' — <strong>' + window.escapeHtml(l.target_type) + ' #' + l.target_id + '</strong></div>' +
          '<div class="admin-log-admin">এডমিন: @' + window.escapeHtml(l.admin_username) + '</div>' +
          (l.notes ? '<div class="admin-log-notes">' + window.escapeHtml(l.notes) + '</div>' : "") +
          '<div class="admin-log-time">' + timeAgo(l.created_at) + '</div>' +
        '</div>' +
      '</div>';
    }).join("") + '</div>';
  } catch (err) {
    el.innerHTML = '<p style="color:var(--danger);text-align:center;padding:40px">লোড করা যায়নি</p>';
  }
}

console.log("[S14] Admin Panel attached ✅");


// ==================================================
// S15.1 — Strong password client-side check
// ==================================================

export function _clientPasswordCheck(pw) {
  if (!pw) return "পাসওয়ার্ড দিন";
  if (pw.length < 8) return "পাসওয়ার্ড অন্তত ৮ অক্ষর";
  if (!/[a-zA-Z]/.test(pw)) return "পাসওয়ার্ডে অক্ষর থাকতে হবে";
  if (!/[0-9]/.test(pw)) return "পাসওয়ার্ডে সংখ্যা থাকতে হবে";
  if (new Set(pw).size < 4) return "পাসওয়ার্ডে ভিন্ন অক্ষর ব্যবহার করুন";
  return null;
}

// Register form validation
(function () {
  var regForm = document.getElementById("register-form");
  if (!regForm) return;
  regForm.addEventListener("submit", function (e) {
    var pw = regForm.querySelector('input[name="password"]').value;
    var err = _clientPasswordCheck(pw);
    if (err) {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.showMessage(err, "error");
    }
  }, true);
})();

// ---------- Temporary bridge ----------
window._checkAdminStatus = _checkAdminStatus;
window.openAdminPage = openAdminPage;
window.closeAdminPage = closeAdminPage;
window._loadAdminDashboard = _loadAdminDashboard;
window._loadAdminReports = _loadAdminReports;
window._loadAdminUsers = _loadAdminUsers;
window._loadAdminLog = _loadAdminLog;
window._clientPasswordCheck = _clientPasswordCheck;
