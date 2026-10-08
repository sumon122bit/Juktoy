
// ==================================================
// PROFILE COMPLETION BAR
// ==================================================

export function _renderProfileCompletion(user, postCount) {
  var compEl = document.getElementById("profile-completion");
  if (!compEl) return;

  var checks = [
    { key: "pic", label: "প্রোফাইল ছবি যোগ করুন", icon: "fa-camera", done: !!user.profile_pic },
    { key: "cover", label: "কভার ফটো যোগ করুন", icon: "fa-image", done: !!user.cover_pic },
    { key: "bio", label: "বায়ো লিখুন", icon: "fa-pen", done: !!(user.bio && user.bio.trim()) },
    { key: "post", label: "প্রথম পোস্ট করুন", icon: "fa-feather", done: postCount > 0 }
  ];

  var doneCount = checks.filter(function (c) { return c.done; }).length;
  var percent = Math.round((doneCount / checks.length) * 100);

  if (percent >= 100) {
    compEl.classList.add("hidden");
    return;
  }

  compEl.classList.remove("hidden");

  var percentText = document.getElementById("pc-percent-text");
  if (percentText) {
    percentText.textContent = percent.toString().replace(/[0-9]/g, function (d) {
      return "০১২৩৪৫৬৭৮৯"[d];
    }) + "%";
  }

  var fill = document.getElementById("pc-bar-fill");
  if (fill) {
    setTimeout(function () { fill.style.width = percent + "%"; }, 60);
  }

  var missing = checks.filter(function (c) { return !c.done; });
  var missingEl = document.getElementById("pc-missing");
  if (missingEl && missing.length) {
    missingEl.innerHTML =
      '<div class="pc-missing-head">কি বাকি আছে:</div>' +
      missing.map(function (m) {
        return '<div class="pc-missing-item" data-action="' + m.key + '">' +
          '<i class="fa-solid ' + m.icon + '"></i>' +
          '<span>' + escapeHtml(m.label) + '</span>' +
        '</div>';
      }).join("");

    missingEl.querySelectorAll(".pc-missing-item").forEach(function (el) {
      el.addEventListener("click", function () {
        var act = el.dataset.action;
        if (act === "pic" || act === "cover" || act === "bio") {
          if (typeof openEditProfile === "function") openEditProfile();
        } else if (act === "post") {
          var ta = document.getElementById("post-content");
          if (ta) { ta.focus(); ta.scrollIntoView({ behavior: "smooth", block: "center" }); }
        }
      });
    });
  }

  // Make bar clickable to expand/collapse missing
  compEl.addEventListener("click", function (e) {
    if (e.target.closest(".pc-missing-item")) return;
    var m = document.getElementById("pc-missing");
    if (m) m.classList.toggle("hidden");
  });
}

// ---------- Temporary bridge ----------
window._renderProfileCompletion = _renderProfileCompletion;
