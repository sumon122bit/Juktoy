// ==================================================
// S19.7 — FOLLOW BACK (from notification)
// ==================================================
document.addEventListener("click", async function (e) {
  var btn = e.target.closest(".notif-followback-btn");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();

  var username = btn.dataset.followback;
  if (!username) return;

  var oldHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    var res = await window.api("/api/users/" + encodeURIComponent(username) + "/follow", {
      method: "POST",
    });
    if (res.is_following) {
      btn.classList.add("following");
      btn.innerHTML = '<i class="fa-solid fa-check"></i> ফলো করছেন';
      if (typeof showToast === "function") window.showToast("✅ ফলো করা হয়েছে");
    } else {
      btn.classList.remove("following");
      btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> ফলো ব্যাক';
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = oldHTML;
    alert((err && err.message) || "কিছু ভুল হয়েছে");
  }
}, true);
