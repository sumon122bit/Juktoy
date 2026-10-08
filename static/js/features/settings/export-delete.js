
// ==================================================
// SETTINGS — EXPORT DATA + DELETE ACCOUNT
// ==================================================

(function () {
  // --- Export Data ---
  var exportBtn = document.getElementById("btn-export-data");
  if (exportBtn) {
    exportBtn.addEventListener("click", async function () {
      var old = exportBtn.innerHTML;
      exportBtn.disabled = true;
      exportBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> প্রস্তুত হচ্ছে...';
      try {
        var data = await api("/api/me/export-data");
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "juktoy-data-" + new Date().toISOString().slice(0, 10) + ".json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
        showToast("✅ ডেটা download হয়েছে");
      } catch (err) {
        alert(err.message || "ডেটা download করা যায়নি");
      } finally {
        exportBtn.disabled = false;
        exportBtn.innerHTML = old;
      }
    });
  }

  // --- Delete Account ---
  var delBtn = document.getElementById("btn-delete-account");
  if (delBtn) {
    delBtn.addEventListener("click", function () {
      _openDeleteAccountModal();
    });
  }

  function _openDeleteAccountModal() {
    var existing = document.getElementById("delete-account-modal");
    if (existing) existing.remove();

    var modal = document.createElement("div");
    modal.id = "delete-account-modal";
    modal.className = "modal";
    modal.innerHTML =
      '<div class="modal-content danger-modal-content">' +
        '<button class="close-btn" id="del-acc-close">×</button>' +
        '<div class="danger-modal-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>' +
        '<h2 class="danger-modal-title">অ্যাকাউন্ট ডিলিট?</h2>' +
        '<p class="danger-modal-text">' +
          'এটি <strong>চিরতরে</strong> মুছে ফেলবে:<br>' +
          '• আপনার সব পোস্ট ও ছবি<br>' +
          '• সব মেসেজ ও কমেন্ট<br>' +
          '• স্টোরি, রিল, ফলোয়ার<br>' +
          '<br>এই কাজটি <strong>ফেরানো যাবে না</strong>।' +
        '</p>' +
        '<label class="edit-label" style="text-align:left;padding-left:0">নিশ্চিত করতে আপনার পাসওয়ার্ড দিন</label>' +
        '<div class="input-group" style="margin-bottom:16px">' +
          '<i class="fa-solid fa-lock input-icon"></i>' +
          '<input type="password" id="del-acc-pw" placeholder="আপনার পাসওয়ার্ড">' +
        '</div>' +
        '<div class="danger-modal-actions">' +
          '<button class="btn-secondary" id="del-acc-cancel">বাতিল</button>' +
          '<button class="btn-primary danger-btn" id="del-acc-confirm" disabled>' +
            '<i class="fa-regular fa-trash-can"></i> চিরতরে মুছুন' +
          '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    var pwInput = document.getElementById("del-acc-pw");
    var confirmBtn = document.getElementById("del-acc-confirm");

    pwInput.focus();
    pwInput.addEventListener("input", function () {
      confirmBtn.disabled = pwInput.value.length < 6;
    });

    function close() { modal.remove(); }
    document.getElementById("del-acc-close").onclick = close;
    document.getElementById("del-acc-cancel").onclick = close;
    modal.addEventListener("click", function (e) {
      if (e.target === modal) close();
    });

    confirmBtn.addEventListener("click", async function () {
      var pw = pwInput.value;
      if (!pw) return;
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> মুছে ফেলা হচ্ছে...';

      try {
        await api("/api/me/delete-account", {
          method: "POST",
          body: JSON.stringify({ password: pw }),
        });
        // Clear local state and reload
        try { localStorage.clear(); } catch (e) {}
        showToast("অ্যাকাউন্ট মুছে ফেলা হয়েছে");
        setTimeout(function () { window.location.reload(); }, 1200);
      } catch (err) {
        alert(err.message || "মুছে ফেলা যায়নি");
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fa-regular fa-trash-can"></i> চিরতরে মুছুন';
      }
    });
  }

  console.log("[Settings] export + delete handlers attached ✅");
})();
