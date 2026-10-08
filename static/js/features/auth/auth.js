
// ==================================================
// AUTH SECTION
// ==================================================

const switchRegister = document.getElementById("switch-register");
if (switchRegister) {
  switchRegister.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("login-form").classList.add("hidden");
    document.getElementById("register-form").classList.remove("hidden");
    document.getElementById("footer-login").classList.add("hidden");
    document.getElementById("footer-register").classList.remove("hidden");
    showMessage("");
  });
}

const switchLogin = document.getElementById("switch-login");
if (switchLogin) {
  switchLogin.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("register-form").classList.add("hidden");
    document.getElementById("login-form").classList.remove("hidden");
    document.getElementById("footer-register").classList.add("hidden");
    document.getElementById("footer-login").classList.remove("hidden");
    showMessage("");
  });
}

document.querySelectorAll(".toggle-eye").forEach((icon) => {
  icon.addEventListener("click", () => {
    const target = document.getElementById(icon.dataset.target);
    if (!target) return;
    const isPassword = target.type === "password";
    target.type = isPassword ? "text" : "password";
    icon.classList.toggle("fa-eye", !isPassword);
    icon.classList.toggle("fa-eye-slash", isPassword);
  });
});

const loginForm = document.getElementById("login-form");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    showMessage("অপেক্ষা করুন...");
    try {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({
          username: f.username.value,
          password: f.password.value,
        }),
      });
      showMessage("");
      await enterApp();
    } catch (err) {
      showMessage(err.message, "error");
    }
  });
}

const registerForm = document.getElementById("register-form");
if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    showMessage("অপেক্ষা করুন...");
    try {
      await api("/api/register", {
        method: "POST",
        body: JSON.stringify({
          username: f.username.value,
          display_name: f.display_name.value,
          password: f.password.value,
        }),
      });
      showMessage("সফল! এখন লগ ইন করুন", "success");
      setTimeout(() => document.getElementById("switch-login").click(), 800);
    } catch (err) {
      showMessage(err.message, "error");
    }
  });
}

const logoutBtn = document.getElementById("logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST" });
    } catch (e) {}
    // S30.29 — full window.state wipe (was: only window.state.me null → previous data leaked)
    window.state.me = null;
    window._currentProfileData = null;
    window._pendingImages = [];
    // Clear feed
    try {
      var _fl = document.getElementById("feed-list");
      if (_fl) _fl.innerHTML = "";
    } catch (e) {}
    // Clear conversations
    try {
      var _ci = document.getElementById("conv-items");
      if (_ci) _ci.innerHTML = "";
      var _gi = document.getElementById("group-items");
      if (_gi) _gi.innerHTML = "";
    } catch (e) {}
    // Close chat / chat polling
    try { if (typeof stopChatPolling === "function") stopChatPolling(); } catch (e) {}
    try { if (typeof window.stopGroupPolling === "function") window.stopGroupPolling(); } catch (e) {}
    // Hide any open overlay pages
    try {
      ["profile-page","messages-page","explore-page","hashtag-page",
       "notifications-page","saved-page","reels-page","story-viewer",
       "settings-page","chat-window","group-chat-window"].forEach(function(id){
        var el = document.getElementById(id);
        if (el) el.classList.add("hidden");
      });
      document.body.classList.remove("messages-chat-open","overlay-open","reels-active");
    } catch (e) {}
    // Reset composer
    try {
      var _pc = document.getElementById("post-content");
      if (_pc) _pc.value = "";
      if (typeof resetComposerImages === "function") resetComposerImages();
    } catch (e) {}
    // Now switch views
    document.getElementById("app-view").classList.add("hidden");
    document.getElementById("auth-view").classList.remove("hidden");
    closeSidebar();
  });
}
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    item.classList.add("active");

    const nav = item.dataset.nav;
    if (nav === "profile" && window.state.me) {
      closeSidebar();
      window.openProfile(window.state.me.username);
    } else if (nav === "home") {
      closeSidebar();
      [
        "profile-page",
        "messages-page",
        "explore-page",
        "hashtag-page",
        "notifications-page",
        "saved-page",
        "reels-page",
        "story-viewer",
        "profile-modal"
      ].forEach((id) => document.getElementById(id)?.classList.add("hidden"));
      if (typeof _PageStack !== "undefined") _PageStack.length = 0;
      if (window.state.me) window.loadFeed();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (nav === "messages") {
      closeSidebar();
      window.openMessagesPage();
    } else if (nav === "suggestions") {
      // S19.1 — open Explore page, focus users tab
      closeSidebar();
      openExplorePage();
      setTimeout(() => {
        var usersTab = document.querySelector('.explore-tab[data-etab="users"]');
        if (usersTab) usersTab.click();
      }, 200);
    } else if (nav === "explore") {
      closeSidebar();
      openExplorePage();
    } else if (nav === "reels") {
      closeSidebar();
      openReelsPage();
    } else if (nav === "notifications") {
      closeSidebar();
      showToast("🔔 নোটিফিকেশন শীঘ্রই আসছে!");
    } else if (nav === "bookmarks") {
      closeSidebar();
      if (typeof window.openSavedPage === "function") window.openSavedPage();
    } else if (nav === "settings") {
      closeSidebar();
      if (typeof window.openSettingsPage === "function") window.openSettingsPage();
    } else {
      closeSidebar();
    }
  });
});

// ==================================================
// APP VIEW
// ==================================================

window._enterAppHooks = [];
// S22 / Series 6 — expose to window so call.js, stats pill, and any
// external module can register hooks reliably (const is NOT on window).
window._enterAppHooks = window._enterAppHooks;

export async function enterApp() {
  const { user } = await api("/api/me");
  if (!user) return;
  window.state.me = user;

  document.getElementById("auth-view").classList.add("hidden");
  document.getElementById("app-view").classList.remove("hidden");

  refreshProfileUI();
 window.__highlightNextPost = true; 
await window.loadFeed();
  updateUnreadBadge();

  // Run post-entry hooks (isolated: one failure won't break others)
  for (const hook of window._enterAppHooks) {
    try {
      await hook();
    } catch (err) {
      console.error("[JUKTOY] enterApp hook failed:", err);
    }
  }
}

export function refreshProfileUI() {
  const u = window.state.me;
  if (!u) return;

  const topAvatar = document.getElementById("topbar-avatar");
  if (topAvatar) {
    setAvatar(topAvatar, u.display_name, u.profile_pic);
    topAvatar.onclick = () => window.openProfile(u.username);
  }

  setAvatar(document.getElementById("composer-avatar"), u.display_name, u.profile_pic);

  const sp = document.getElementById("sidebar-profile");
  if (sp) {
    sp.innerHTML = `
      ${avatarHTML(u.display_name, u.profile_pic, "avatar-lg")}
      <div class="name-lg">${escapeHtml(u.display_name)}</div>
      <div class="uname-sm">@${escapeHtml(u.username)}</div>
    `;
  }

  const bioEl = document.getElementById("bio-text");
  if (bioEl) bioEl.textContent = u.bio || "বায়ো নেই";
}
window.refreshProfileUI = refreshProfileUI;



// ---------- Temporary bridge ----------
window.enterApp = enterApp;
window.refreshProfileUI = refreshProfileUI;
