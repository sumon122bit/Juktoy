// REPORT SYSTEM
// ==================================================

const REPORT_REASONS = [
  { value: "spam", label: "স্প্যাম / বিজ্ঞাপন", icon: "fa-bullhorn" },
  { value: "harassment", label: "হয়রানি / গালাগালি", icon: "fa-hand-fist" },
  { value: "violence", label: "হিংস্রতা / ভয় দেখানো", icon: "fa-triangle-exclamation" },
  { value: "false_info", label: "মিথ্যা তথ্য", icon: "fa-circle-exclamation" },
  { value: "other", label: "অন্য কিছু", icon: "fa-ellipsis" },
];

let _reportTarget = null;

export function openReportModal(type, id, username) {
  _reportTarget = { type, id, username };

  let modal = document.getElementById("report-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "report-modal";
    modal.className = "modal hidden";
    modal.innerHTML = `
      <div class="modal-content report-modal-content">
        <button class="close-btn" id="close-report-modal">×</button>
        <h2 class="report-title"><i class="fa-solid fa-flag"></i> রিপোর্ট করুন</h2>
        <p class="report-sub" id="report-subtitle">কারণ নির্বাচন করুন</p>

        <div class="report-reasons" id="report-reasons"></div>

        <textarea id="report-notes" class="edit-bio-input" placeholder="অতিরিক্ত কিছু বলতে চান? (ঐচ্ছিক)" maxlength="500" style="min-height:70px;margin-top:14px"></textarea>

        <div class="edit-actions">
          <button class="btn-secondary" id="cancel-report">বাতিল</button>
          <button class="btn-primary" id="submit-report" disabled style="width:auto;padding:12px 28px">
            <i class="fa-solid fa-paper-plane"></i> রিপোর্ট পাঠান
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("close-report-modal").onclick = closeReportModal;
    document.getElementById("cancel-report").onclick = closeReportModal;
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeReportModal();
    });
    document.getElementById("submit-report").onclick = submitReport;
  }

  // Rebuild reasons
  const reasonsEl = document.getElementById("report-reasons");
  reasonsEl.innerHTML = REPORT_REASONS.map((r) => `
    <button class="report-reason" data-value="${r.value}">
      <i class="fa-solid ${r.icon}"></i>
      <span>${r.label}</span>
    </button>
  `).join("");

  reasonsEl.querySelectorAll(".report-reason").forEach((b) => {
    b.addEventListener("click", () => {
      reasonsEl.querySelectorAll(".report-reason").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById("submit-report").disabled = false;
    });
  });

  document.getElementById("report-notes").value = "";
  document.getElementById("submit-report").disabled = true;

  const sub = document.getElementById("report-subtitle");
  if (username) {
    sub.innerHTML = `<strong>@${escapeHtml(username)}</strong> এর ${type === "post" ? "পোস্ট" : "অ্যাকাউন্ট"} রিপোর্ট করছেন`;
  } else {
    sub.textContent = "কারণ নির্বাচন করুন";
  }

  modal.classList.remove("hidden");
}

export function closeReportModal() {
  const modal = document.getElementById("report-modal");
  if (modal) modal.classList.add("hidden");
  _reportTarget = null;
}

export async function submitReport() {
  if (!_reportTarget) return;
  const activeReason = document.querySelector(".report-reason.active");
  if (!activeReason) return showToast("একটা কারণ নির্বাচন করুন");

  const notes = document.getElementById("report-notes").value.trim();
  const btn = document.getElementById("submit-report");
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    await api("/api/report", {
      method: "POST",
      body: JSON.stringify({
        target_type: _reportTarget.type,
        target_id: _reportTarget.id,
        reason: activeReason.dataset.value,
        notes,
      }),
    });
    closeReportModal();
    showToast("✅ রিপোর্ট পাঠানো হয়েছে। আমরা দ্রুত ব্যবস্থা নেব।");
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> রিপোর্ট পাঠান';
  }
}

// Load my reports in settings
export async function loadMyReports() {
  const list = document.getElementById("my-reports-list");
  if (!list) return;
  try {
    const reports = await api("/api/me/reports");
    if (!reports.length) {
      list.innerHTML = '<p class="empty-text" style="padding:12px 0">আপনি এখনো কিছু রিপোর্ট করেননি।</p>';
      return;
    }
    const typeLabel = { post: "পোস্ট", user: "ইউজার", comment: "কমেন্ট", reel: "রিল" };
    const reasonLabel = {
      spam: "স্প্যাম", harassment: "হয়রানি", violence: "হিংস্রতা",
      false_info: "মিথ্যা তথ্য", other: "অন্য",
    };
    const statusLabel = {
      pending: "⏳ অপেক্ষমাণ", reviewed: "👁️ পর্যালোচিত",
      actioned: "✅ ব্যবস্থা নেওয়া হয়েছে", dismissed: "✖️ বাতিল",
    };
    list.innerHTML = reports.map((r) => `
      <div class="my-report-row">
        <div class="my-report-icon my-report-${r.status}"><i class="fa-solid fa-flag"></i></div>
        <div class="my-report-info">
          <div class="my-report-title">${typeLabel[r.target_type] || r.target_type} — ${reasonLabel[r.reason] || r.reason}</div>
          <div class="my-report-meta">${statusLabel[r.status] || r.status} • ${timeAgo(r.created_at)}</div>
        </div>
      </div>
    `).join("");
  } catch (err) {
    list.innerHTML = '<p class="empty-text" style="padding:12px 0">লোড করা যায়নি</p>';
  }
}

// Extend openSettingsPage to load reports too
// S39 — exposed for unified loader
window._loadMyReports = loadMyReports;
// S39 — wrapper disabled (unified loader at end of file)



// ---------- Temporary bridge ----------
window.openReportModal = openReportModal;
window.closeReportModal = closeReportModal;
window.submitReport = submitReport;
window.loadMyReports = loadMyReports;
