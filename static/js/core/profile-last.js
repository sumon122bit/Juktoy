

// S30.15 — clear _currentProfileData when profile page closes
(function () {
  if (window.__profileCleanup) return;
  window.__profileCleanup = true;
  var page = document.getElementById("profile-page");
  if (!page) return;
  try {
    new MutationObserver(function () {
      if (page.classList.contains("hidden")) {
        // page went hidden → release cached profile data (memory + stale-state safe)
        window._currentProfileData = null;
      }
    }).observe(page, { attributes: true, attributeFilter: ["class"] });
  } catch (e) {}
  console.log("[PROFILE_CLEANUP] watching profile-page close");
})();


// ═══════════════════════════════════════════════
// S39 — Unified profile tab handler
// ═══════════════════════════════════════════════
// Problem: 3 different click handlers (lines ~10172, ~17040, ~17185)
// were all listening on .profile-tab, causing visibility conflicts.
// This unified handler runs LAST (bubble phase on document) and
// sets the FINAL correct state regardless of what the others did.
(function () {
  if (window.__s39UnifiedProfileTabs) return;
  window.__s39UnifiedProfileTabs = true;

  var ALL_PANES = ["posts", "reels", "photos", "tagged", "liked",
                   "saved", "reposts", "archived", "about"];

  document.addEventListener("click", function (e) {
    var tab = e.target.closest(".profile-tab");
    if (!tab) return;
    var name = tab.dataset.tab;
    if (!name) return;

    // Force active state
    document.querySelectorAll(".profile-tab").forEach(function (x) {
      x.classList.toggle("active", x === tab);
    });

    // Force hide all panes, show only target
    ALL_PANES.forEach(function (n) {
      var el = document.getElementById("profile-tab-" + n);
      if (!el) return;
      if (n === name) el.classList.remove("hidden");
      else el.classList.add("hidden");
    });

    // Load data for target tab
    var data = window._currentProfileData;
    var uname = data && data.user ? data.user.username : null;

    try {
      if (name === "reels" && uname && typeof _renderReels === "function") {
        _renderReels(uname);
      } else if (name === "liked" && typeof _renderLiked === "function") {
        _renderLiked();
      } else if (name === "saved" && typeof _renderSaved === "function") {
        _renderSaved();
      } else if (name === "reposts" && uname && typeof _renderReposts === "function") {
        _renderReposts(uname);
      }
    } catch (err) {
      console.warn("[S39 tab load]", name, err);
    }
  });  // bubble phase (default) → runs AFTER existing capture handlers
})();


// ═══════════════════════════════════════════════
// S39 — Add "Notify" option to profile ⋮ menu
// ═══════════════════════════════════════════════
(function () {
  if (window.__s39NotifyInMenu) return;
  window.__s39NotifyInMenu = true;

  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;

    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel || panel.dataset.s39Notify === "1") return;
      panel.dataset.s39Notify = "1";

      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && state.me && state.me.username === data.user.username;
      if (isMe) return;

      // Check notify status
      var isNotifying = false;
      api("/api/users/" + encodeURIComponent(data.user.username) + "/notify/status")
        .then(function (r) {
          isNotifying = !!(r && r.notify);
          updateBtnLabel();
        })
        .catch(function () {});

      // Create the button
      var notifyBtn = document.createElement("button");
      notifyBtn.type = "button";
      notifyBtn.className = "sheet-menu-item";
      notifyBtn.setAttribute("data-s39-notify", "1");
      notifyBtn.innerHTML = '<i class="fa-regular fa-bell"></i><span>নোটিফিকেশন চালু করুন</span>';

      function updateBtnLabel() {
        var span = notifyBtn.querySelector("span");
        var i = notifyBtn.querySelector("i");
        if (isNotifying) {
          span.textContent = "নোটিফিকেশন বন্ধ করুন";
          i.className = "fa-solid fa-bell";
          notifyBtn.classList.add("active");
        } else {
          span.textContent = "নোটিফিকেশন চালু করুন";
          i.className = "fa-regular fa-bell";
          notifyBtn.classList.remove("active");
        }
      }

      notifyBtn.addEventListener("click", function () {
        api("/api/users/" + encodeURIComponent(data.user.username) + "/notify", { method: "POST" })
          .then(function (r) {
            isNotifying = !!(r && r.notify);
            updateBtnLabel();
            if (typeof showToast === "function") {
              showToast(isNotifying ? "🔔 নোটিফিকেশন চালু" : "🔕 নোটিফিকেশন বন্ধ");
            }
          })
          .catch(function (err) { alert(err.message); });
      });

      // Insert before the last item (usually Block or Report)
      panel.appendChild(notifyBtn);
    }, 80);
  }, true);

  console.log("[S39] notify option added to ⋮ menu");
})();


