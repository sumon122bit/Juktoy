// ==================================================
// SMART BASE URL RESOLVER
// - Localhost / Render / any hosting  → relative URLs (auto)
// - Capacitor (APK) / Electron / file://  → absolute production URL
// - Override anytime from console:
//     localStorage.setItem("juktoy_api_base", "https://staging.example.com")
//     (then reload)
//     localStorage.removeItem("juktoy_api_base")   ← revert
// ==================================================
function _resolveBaseUrl() {
  try {
    const override = localStorage.getItem("juktoy_api_base");
    if (override && override.trim()) {
      return override.trim().replace(/\/$/, "");
    }
  } catch (e) { /* private mode — ignore */ }

  const proto = window.location.protocol;

  // Capacitor mobile app OR Electron desktop OR local file
  if (proto === "capacitor:" || proto === "file:") {
    // Absolute production URL required (no same-origin available)
    return localStorage.getItem("juktoy_prod_url") || "https://juktoy.onrender.com";
  }

  // Everything else (http/https) → relative URLs
  // Works on: localhost, Render, Vercel, Railway, VPS, any domain
  return "";
}
const BASE_URL = _resolveBaseUrl();
console.log("[JUKTOY] API base:", BASE_URL || "(same-origin)");
// ==================================================
// JUKTOY — Complete JavaScript
// All features: auth, feed, profile, theme, messages
// ==================================================

// ---------- State ----------
const state = { me: null };
// FIX: expose to window (const doesn't auto-expose like var)
if (typeof window !== "undefined") {
  window.state = state;
  window.__juktoyState = state;
}

// ==================================================
// HELPERS
// ==================================================

function _readCsrfCookie() {
  try {
    const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : "";
  } catch (e) { return ""; }
}

async function api(url, options = {}) {
  const opts = { ...options };
  opts.credentials = "include";
  opts.headers = { "Content-Type": "application/json", ...(options.headers || {}) };

  const method = (opts.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = _readCsrfCookie();
    if (token) opts.headers["X-CSRF-Token"] = token;
  }

  // S30.14 — 30s timeout via AbortController
  // (was: infinite wait if server hangs → UI stuck on "লোড হচ্ছে...")
  var _ac = null;
  var _tid = null;
  if (typeof AbortController !== "undefined") {
    _ac = new AbortController();
    // preserve any existing signal from caller
    if (options && options.signal) {
      try {
        options.signal.addEventListener("abort", function () { _ac.abort(); });
      } catch (e) {}
    }
    opts.signal = _ac.signal;
    _tid = setTimeout(function () { try { _ac.abort(); } catch (e) {} }, 30000);
  }

  let res;
  try {
    res = await fetch(BASE_URL + url, opts);
  } catch (err) {
    if (_tid) clearTimeout(_tid);
    // AbortError → friendly message
    if (err && (err.name === "AbortError" || /abort/i.test(err.message || ""))) {
      const _toErr = new Error("সার্ভার সময়মতো সাড়া দেয়নি। আবার চেষ্টা করুন।");
      _toErr.isTimeout = true;
      throw _toErr;
    }
    throw err;
  } finally {
    if (_tid) clearTimeout(_tid);
  }

  const data = await res.json().catch(() => ({}));

  // 401 handling (unchanged)
  if (res.status === 401) {
    var _isMeCheck = (url === "/api/me");
    var _wasLoggedIn = false;
    try {
      _wasLoggedIn = !!(window.state && window.state.me);
    } catch (e) {}

    if (data && data.idle_timeout) {
      try {
        if (typeof showToast === "function") {
          showToast("⏱️ নিষ্ক্রিয়তার কারণে লগআউট হয়েছেন");
        }
      } catch (e) {}
      setTimeout(function () { window.location.reload(); }, 1500);
    } else if (!_isMeCheck && _wasLoggedIn) {
      try {
        if (typeof showToast === "function") {
          showToast(data.error || "সেশন শেষ হয়ে গেছে। আবার লগইন করুন।");
        }
      } catch (e) {}
      setTimeout(function () { window.location.reload(); }, 1500);
    }
  }

  if (!res.ok) throw new Error(data.error || "কিছু ভুল হয়েছে");
  return data;
}


function showMessage(text, type = "") {
  const el = document.getElementById("auth-message");
  if (!el) return;
  el.textContent = text;
  el.className = "message " + type;
}


// ==================================================
// SVG AVATAR GENERATOR (for stories)
// ==================================================

function fillStoryAvatars() {
  document.querySelectorAll(".story-hex-content[data-avatar]").forEach((el) => {
    if (el.dataset.filled === "1") return;
    const parts = (el.dataset.avatar || "").split(":");
    const seed = parts[0] || "user";
    const name = parts[1] || seed;
    el.innerHTML = generateAvatarSVG(seed, name);
    el.dataset.filled = "1";
  });
}

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
    // S30.29 — full state wipe (was: only state.me null → previous data leaked)
    state.me = null;
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
    try { if (typeof stopGroupPolling === "function") stopGroupPolling(); } catch (e) {}
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
    if (nav === "profile" && state.me) {
      closeSidebar();
      openProfile(state.me.username);
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
      if (state.me) loadFeed();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (nav === "messages") {
      closeSidebar();
      openMessagesPage();
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
      openSavedPage();
    } else if (nav === "settings") {
      closeSidebar();
      openSettingsPage();
    } else {
      closeSidebar();
    }
  });
});

// ==================================================
// APP VIEW
// ==================================================

const _enterAppHooks = [];
// S22 / Series 6 — expose to window so call.js, stats pill, and any
// external module can register hooks reliably (const is NOT on window).
window._enterAppHooks = _enterAppHooks;

async function enterApp() {
  const { user } = await api("/api/me");
  if (!user) return;
  state.me = user;

  document.getElementById("auth-view").classList.add("hidden");
  document.getElementById("app-view").classList.remove("hidden");

  refreshProfileUI();
 window.__highlightNextPost = true; 
await loadFeed();
  updateUnreadBadge();

  // Run post-entry hooks (isolated: one failure won't break others)
  for (const hook of _enterAppHooks) {
    try {
      await hook();
    } catch (err) {
      console.error("[JUKTOY] enterApp hook failed:", err);
    }
  }
}

function refreshProfileUI() {
  const u = state.me;
  if (!u) return;

  const topAvatar = document.getElementById("topbar-avatar");
  if (topAvatar) {
    setAvatar(topAvatar, u.display_name, u.profile_pic);
    topAvatar.onclick = () => openProfile(u.username);
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






// ==================================================
// PROFILE PAGE
// ==================================================

const modal = document.getElementById("profile-modal");
const closeProfile = document.getElementById("close-profile");

if (closeProfile) closeProfile.addEventListener("click", () => modal.classList.add("hidden"));
if (modal) {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
}

async function openProfile(username) {
  try {
    const data = await api("/api/users/" + encodeURIComponent(username));
    window._currentProfileData = data;
    const u = data.user;
    const isMe = state.me && state.me.username === u.username;

    const page = document.getElementById("profile-page");
    const editIcon = document.getElementById("profile-edit-icon");

    setAvatar(document.getElementById("profile-page-avatar"), u.display_name, u.profile_pic);
    setProfileCover(u.cover_pic);
    document.getElementById("profile-page-name").textContent = u.display_name;
    document.getElementById("profile-page-username").textContent = "@" + u.username;
    document.getElementById("profile-page-bio").textContent = u.bio || "বায়ো নেই";
    var _aboutBio = document.getElementById("about-bio");
    if (_aboutBio) _aboutBio.textContent = u.bio || "বায়ো নেই";

    // Profile completion bar (only on own profile)
    var compEl = document.getElementById("profile-completion");
    if (compEl) {
      if (isMe) {
        _renderProfileCompletion(u, data.posts ? data.posts.length : 0);
      } else {
        compEl.classList.add("hidden");
      }
    }

    // Mutual followers
    var mutualEl = document.getElementById("profile-page-mutual");
    if (mutualEl) {
      if (!isMe && data.mutual_count > 0 && data.mutual_followers && data.mutual_followers.length) {
        var preview = data.mutual_followers.slice(0, 3);
        var avatarsHTML = preview.map(function (m) {
          return '<div class="pm-av">' +
            (m.profile_pic
              ? '<img src="' + escapeHtml(m.profile_pic) + '" alt="" loading="lazy" decoding="async">'
              : initial(m.display_name)) +
            '</div>';
        }).join("");
        var names = preview.map(function (m) { return m.display_name; });
        var extra = data.mutual_count - preview.length;
        var text;
        if (names.length === 1) {
          text = '<strong>' + escapeHtml(names[0]) + '</strong> ফলো করেন';
        } else if (names.length === 2) {
          text = '<strong>' + escapeHtml(names[0]) + '</strong> এবং <strong>' + escapeHtml(names[1]) + '</strong> ফলো করেন';
        } else {
          text = '<strong>' + escapeHtml(names[0]) + '</strong>, <strong>' + escapeHtml(names[1]) + '</strong>';
          if (extra > 0) {
            text += ' এবং <strong>আরও ' + extra + ' জন</strong>';
          }
          text += ' ফলো করেন';
        }
        mutualEl.innerHTML =
          '<div class="pm-avatars">' + avatarsHTML + '</div>' +
          '<div class="pm-text">' + text + '</div>';
        mutualEl.classList.remove("hidden");
        mutualEl.style.cursor = "pointer";
        mutualEl.onclick = function () { showMutualFollowers(u.username); };
      } else {
        mutualEl.classList.add("hidden");
        mutualEl.innerHTML = "";
        mutualEl.onclick = null;
      }
    }

    // Join date
    var joinedEl = document.getElementById("profile-page-joined");
    if (joinedEl && u.created_at) {
      var dt = parseISO(u.created_at);
      var months = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
                    "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
      var day = dt.getDate();
      var month = months[dt.getMonth()];
      var year = dt.getFullYear();
      var bnDay = String(day).replace(/[0-9]/g, function (d) { return "০১২৩৪৫৬৭৮৯"[d]; });
      var bnYear = String(year).replace(/[0-9]/g, function (d) { return "০১২৩৪৫৬৭৮৯"[d]; });
      joinedEl.querySelector("span").textContent = bnDay + " " + month + " " + bnYear + " এ যোগ দিয়েছেন";
      joinedEl.style.display = "";
    } else if (joinedEl) {
      joinedEl.style.display = "none";
    }
    var _aboutUname = document.getElementById("about-username");
    if (_aboutUname) _aboutUname.textContent = "@" + u.username;

    // Update all 3 stats (posts / followers / following)
    const statEls = document.querySelectorAll(".profile-stats .stat-item .stat-num");
    if (statEls.length >= 3) {
      statEls[0].textContent = data.posts.length;
      statEls[1].textContent = data.followers_count || 0;
      statEls[2].textContent = data.following_count || 0;
      statEls[1].style.cursor = "pointer";
      statEls[2].style.cursor = "pointer";
      statEls[1].onclick = () => showFollowList(u.username, "followers");
      statEls[2].onclick = () => showFollowList(u.username, "following");
    }

    // S39 — Msg button: hide on own profile, show on other's
    var _msgBtn = document.getElementById("profile-msg-btn");
    if (_msgBtn) {
      if (isMe) {
        _msgBtn.classList.add("hidden");
      } else {
        _msgBtn.classList.remove("hidden");
      }
    }

    if (isMe) {
      editIcon.classList.remove("hidden");
      editIcon.onclick = openEditProfile;
    } else {
      editIcon.classList.add("hidden");
    }

    const btns = document.getElementById("profile-buttons");
    if (isMe) {
      btns.innerHTML = `
        <button id="btn-edit-profile"><i class="fa-solid fa-pen"></i> এডিট</button>
        <button id="btn-share-profile"><i class="fa-solid fa-share"></i> শেয়ার</button>
        <button id="profile-menu-btn" class="btn-menu-circle" title="আরও" aria-label="Menu"><i class="fa-solid fa-ellipsis-vertical"></i></button>
      `;
      btns.dataset.b3 = "0";
      document.getElementById("btn-edit-profile").onclick = openEditProfile;
      document.getElementById("btn-share-profile").onclick = function() { showToast("শীঘ্রই আসছে! ✨"); };
    } else {
      var _renderBtnHtml = function(flw) {
        var icon = flw ? "fa-user-check" : "fa-user-plus";
        var lbl = flw ? "ফলোয়িং" : "ফলো";
        var _h = '<button id="btn-follow" data-username="' + escapeHtml(u.username) + '" data-following="' + (flw ? "1" : "0") + '">' +
                 '<i class="fa-solid ' + icon + '"></i><span>' + lbl + '</span></button>';
        if (flw) {
          _h += '<button id="btn-msg"><i class="fa-regular fa-comment"></i> মেসেজ</button>';
          _h += '<button id="btn-profile-wave" class="btn-icon-sm" title="Wave"><i class="fa-regular fa-hand"></i></button>';
        }
        _h += '<button id="profile-menu-btn" class="btn-menu-circle" title="আরও" aria-label="Menu"><i class="fa-solid fa-ellipsis-vertical"></i></button>';
        return _h;
      };

      var _attachOtherHandlers = function() {
        var followBtn = document.getElementById("btn-follow");
        if (followBtn) {
          followBtn.onclick = function(ev) {
            var fb = ev.currentTarget;
            var uname = fb.dataset.username;
            fb.disabled = true;
            api("/api/users/" + encodeURIComponent(uname) + "/follow", { method: "POST" })
              .then(function(res) {
                var nowFollowing = res.is_following;
                btns.innerHTML = _renderBtnHtml(nowFollowing);
                _attachOtherHandlers();
                var statEls = document.querySelectorAll(".profile-stats .stat-item .stat-num");
                if (statEls.length >= 3) statEls[1].textContent = res.followers;
                if (typeof showToast === "function") {
                  showToast(nowFollowing ? "✅ ফলো করা হয়েছে" : "আনফলো করা হয়েছে");
                }
              })
              .catch(function(err) { alert(err.message); fb.disabled = false; });
          };
        }
        var mBtn = document.getElementById("btn-msg");
        if (mBtn) mBtn.onclick = function() {
          document.getElementById("profile-page").classList.add("hidden");
          openMessagesPage().then(function() { openChat(u.username); });
        };
        var wBtn = document.getElementById("btn-profile-wave");
        if (wBtn) wBtn.onclick = function() {
          api("/api/users/" + encodeURIComponent(u.username) + "/wave", { method: "POST" })
            .then(function() { showToast("👋 Wave পাঠানো হয়েছে"); })
            .catch(function(e) { alert(e.message); });
        };
      };

      btns.innerHTML = _renderBtnHtml(data.is_following);
      btns.dataset.b3 = "0";
      _attachOtherHandlers();
    }

    const postsEl = document.getElementById("profile-tab-posts");
    if (data.posts.length) {
      postsEl.innerHTML = data.posts
        .map(
          (p) => `
        <div class="profile-post">
          <div class="post-content">${escapeHtml(p.content)}</div>
          <div class="post-time"><i class="fa-regular fa-clock"></i> ${timeAgo(p.created_at)}</div>
        </div>
      `
        )
        .join("");
    } else {
      postsEl.innerHTML = `<p class="empty-text">📝 এখনো কোনো পোস্ট নেই</p>`;
    }

    document.querySelectorAll(".profile-tab").forEach((t) => t.classList.remove("active"));
    var _pt_default = document.querySelector('.profile-tab[data-tab="posts"]');
    if (_pt_default) _pt_default.classList.add("active");
    document.getElementById("profile-tab-posts").classList.remove("hidden");
    var _p_photos = document.getElementById("profile-tab-photos"); if (_p_photos) _p_photos.classList.add("hidden");
    var _p_about = document.getElementById("profile-tab-about"); if (_p_about) _p_about.classList.add("hidden");

    page.classList.remove("hidden");
    page.scrollTop = 0;
  } catch (err) {
    alert(err.message);
  }
}

function setProfileCover(url) {
  const el = document.getElementById("profile-page-cover");
  const gradient = document.querySelector("#profile-page .cover-gradient");

  if (!el) return;

  if (url) {
    el.src = url;
    el.classList.remove("hidden");
    if (gradient) gradient.style.display = "none";
  } else {
    el.removeAttribute("src");
    el.classList.add("hidden");
    if (gradient) gradient.style.display = "block";
  }
}

// ==================================================
// EDIT PROFILE + AVATAR UPLOAD
// ==================================================

let pendingAvatar = null;
let pendingCover = null;

const editProfileModal = document.getElementById("edit-profile-modal");
const closeEditProfile = document.getElementById("close-edit-profile");
const cancelEditProfile = document.getElementById("cancel-edit-profile");
const saveEditProfile = document.getElementById("save-edit-profile");
const avatarInput = document.getElementById("avatar-input");
const btnUploadAvatar = document.getElementById("btn-upload-avatar");
const btnRemoveAvatar = document.getElementById("btn-remove-avatar");
const avatarPreview = document.getElementById("avatar-preview");

const coverInput = document.getElementById("cover-input");
const btnUploadCover = document.getElementById("btn-upload-cover");
const btnRemoveCover = document.getElementById("btn-remove-cover");
const coverPreview = document.getElementById("cover-preview");

function openEditProfile() {
  document.getElementById("edit-name").value = state.me.display_name || "";
  document.getElementById("edit-bio").value = state.me.bio || "";
  pendingAvatar = null;
  pendingCover = null;

  setAvatar(avatarPreview, state.me.display_name, state.me.profile_pic);

  if (coverPreview) {
    if (state.me.cover_pic) {
      coverPreview.innerHTML =
        `<img src="${escapeHtml(state.me.cover_pic)}" alt="Cover preview" loading="lazy" decoding="async">`;
    } else {
      coverPreview.innerHTML =
        `<div class="cover-preview-placeholder">🖼️ কভার ফটো</div>`;
    }
  }
  editProfileModal.classList.remove("hidden");
}

if (closeEditProfile) closeEditProfile.addEventListener("click", () => editProfileModal.classList.add("hidden"));
if (cancelEditProfile) cancelEditProfile.addEventListener("click", () => editProfileModal.classList.add("hidden"));
if (editProfileModal) {
  editProfileModal.addEventListener("click", (e) => {
    if (e.target === editProfileModal) editProfileModal.classList.add("hidden");
  });
}

if (btnUploadAvatar && avatarInput) {
  btnUploadAvatar.addEventListener("click", () => avatarInput.click());
}

if (avatarInput) {
  avatarInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("শুধু ছবি আপলোড করা যাবে");
      return;
    }
    try {
      btnUploadAvatar.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> লোড হচ্ছে...`;
      const resized = await resizeImage(file, 400);
      pendingAvatar = resized;
      setAvatar(avatarPreview, state.me.display_name, pendingAvatar);
    } catch (err) {
      alert("ছবি লোড করা যায়নি");
    } finally {
      btnUploadAvatar.innerHTML = `<i class="fa-solid fa-camera"></i> ছবি আপলোড`;
      avatarInput.value = "";
    }
  });
}

if (btnRemoveAvatar) {
  btnRemoveAvatar.addEventListener("click", () => {
    if (!confirm("প্রোফাইল ছবি মুছে ফেলবেন?")) return;
    pendingAvatar = "";
    setAvatar(avatarPreview, state.me.display_name, null);
  });
}

if (btnUploadCover && coverInput) {
  btnUploadCover.addEventListener("click", () => coverInput.click());
}

if (coverInput) {
  coverInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("শুধু ছবি আপলোড করা যাবে");
      return;
    }

    try {
      btnUploadCover.innerHTML =
        `<i class="fa-solid fa-spinner fa-spin"></i> লোড হচ্ছে...`;

      pendingCover = await resizeImage(file, 1400, 0.86);

      if (coverPreview) {
        coverPreview.innerHTML =
          `<img src="${escapeHtml(pendingCover)}" alt="Cover preview" loading="lazy" decoding="async">`;
      }
    } catch (err) {
      alert("কভার ছবি লোড করা যায়নি");
    } finally {
      btnUploadCover.innerHTML =
        `<i class="fa-solid fa-image"></i> কভার ফটো`;
      coverInput.value = "";
    }
  });
}

if (btnRemoveCover) {
  btnRemoveCover.addEventListener("click", () => {
    if (!confirm("কভার ফটো মুছে ফেলবেন?")) return;

    pendingCover = "";

    if (coverPreview) {
      coverPreview.innerHTML =
        `<div class="cover-preview-placeholder">🖼️ কভার ফটো</div>`;
    }
  });
}

if (saveEditProfile) {
  saveEditProfile.addEventListener("click", async () => {
    const bio = document.getElementById("edit-bio").value.trim();
    const name = document.getElementById("edit-name").value.trim();

    saveEditProfile.disabled = true;
    saveEditProfile.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> সেভ হচ্ছে...`;

    try {
      await api("/api/me/bio", {
        method: "POST",
        body: JSON.stringify({ bio, display_name: name }),
      });

      if (pendingAvatar !== null) {
        const res = await api("/api/me/avatar", {
          method: "POST",
          body: JSON.stringify({ avatar: pendingAvatar }),
        });
        state.me.profile_pic = res.avatar;
      }

      if (pendingCover !== null) {
        const res = await api("/api/me/cover", {
          method: "POST",
          body: JSON.stringify({ cover: pendingCover }),
        });
        state.me.cover_pic = res.cover;
      }

      const meRes = await api("/api/me");
      state.me = meRes.user;

      refreshProfileUI();
      await loadFeed();

      const profilePage = document.getElementById("profile-page");
      if (!profilePage.classList.contains("hidden")) {
        setAvatar(
          document.getElementById("profile-page-avatar"),
          state.me.display_name,
          state.me.profile_pic
        );

        setProfileCover(state.me.cover_pic);

        document.getElementById("profile-page-name").textContent = state.me.display_name;
        document.getElementById("profile-page-bio").textContent = state.me.bio || "বায়ো নেই";
        document.getElementById("about-bio").textContent = state.me.bio || "বায়ো নেই";
      }

      pendingAvatar = null;
      pendingCover = null;
      editProfileModal.classList.add("hidden");
    } catch (err) {
      alert(err.message);
    } finally {
      saveEditProfile.disabled = false;
      saveEditProfile.innerHTML = `<i class="fa-solid fa-check"></i> সেভ করুন`;
    }
  });
}


// ==================================================
// MESSAGING SYSTEM
// ==================================================

const messagesPage = document.getElementById("messages-page");
const convItems = document.getElementById("conv-items");

async function loadConversations() {
  if (!convItems) return;
  try {
    const convs = await api("/api/conversations");
    renderConversations(convs);
  } catch (err) {
    console.error("[CONV]", err);
    convItems.innerHTML = '<div class="conv-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>লোড করা যায়নি</p></div>';
  }
}

function renderConversations(convs) {
  if (!Array.isArray(convs) || !convs.length) {
    convItems.innerHTML =
      '<div class="conv-empty">' +
        '<i class="fa-regular fa-comment-dots"></i>' +
        '<p>এখনো কোনো চ্যাট নেই।<br>উপরের ✍️ বাটনে চাপ দিয়ে শুরু করুন।</p>' +
      '</div>';
    return;
  }

  convItems.innerHTML = convs.map(function (c) {
    var isMine = state.me && c.last_sender === state.me.id;
    var isMuted = !!c.is_muted;
    var isPinned = !!c.is_pinned;
    var unread = c.unread || 0;

    // Real online status from user.last_seen (not message time)
    var onlineDot = "";
    if (typeof c.other_secs === "number" && c.other_secs >= 0 && c.other_secs < 300) {
      onlineDot = '<span class="conv-online-dot"></span>';
    }

    var lastHtml = "";
    if (unread > 0) {
      lastHtml = '<div class="conv-last conv-last-unread"><strong>' + unread + 'টি নতুন মেসেজ</strong></div>';
    } else if (isMine) {
      lastHtml = '<div class="conv-last mine">' + escapeHtml(c.last_message) + '</div>';
    } else {
      lastHtml = '<div class="conv-last">' + escapeHtml(c.last_message) + '</div>';
    }

    var blueDot = (unread > 0 && !isMuted)
      ? '<span class="conv-unread-dot"></span>'
      : "";

    var nameIcons = "";
    if (isPinned) nameIcons += '<span class="conv-icn pin"><i class="fa-solid fa-thumbtack"></i></span>';
    if (isMuted) nameIcons += '<span class="conv-icn mute"><i class="fa-solid fa-bell-slash"></i></span>';

    var classes = ["conv-item"];
    if (isPinned) classes.push("pinned");
    if (isMuted) classes.push("muted");
    if (unread > 0) classes.push("has-unread");

    var _listName = (c.nickname && c.nickname.trim()) ? c.nickname : c.display_name;

    return (
      '<div class="' + classes.join(" ") + '" data-username="' + escapeHtml(c.username) + '">' +
        '<div class="conv-avatar">' +
          avatarInner(_listName, c.profile_pic) +
          onlineDot +
        '</div>' +
        '<div class="conv-info">' +
          '<div class="conv-name">' +
            escapeHtml(_listName) +
            nameIcons +
          '</div>' +
          lastHtml +
        '</div>' +
        '<div class="conv-meta">' +
          '<span class="conv-time">' + shortTime(c.last_time) + '</span>' +
          blueDot +
        '</div>' +
      '</div>'
    );
  }).join("");

  convItems.querySelectorAll(".conv-item").forEach(function (el) {
    el.addEventListener("click", function () { openChat(el.dataset.username); });
  });
}

const chatWindow = document.getElementById("chat-window");
const chatMessages = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatUserInfo = document.getElementById("chat-user-info");
const newChatModal = document.getElementById("new-chat-modal");

let currentChatUser = null;
let chatPollTimer = null;
let lastMsgCount = 0;

// S29.5 - chat settings cache.
// These values (theme/nickname/wallpaper/pinned/muted) only change when
// the user taps a menu action. Previously loadChatMessages() re-fetched
// them every 3 seconds. Now: fetch once per chat-open (or after a write),
// then read from cache. In-flight dedupe prevents duplicate fetches.
let _chatSettingsCache = {};
let _chatSettingsInflight = {};

function _invalidateChatSettings(username) {
  if (!username) return;
  delete _chatSettingsCache[username];
  delete _chatSettingsInflight[username];
}

function _getChatSettings(username) {
  if (!username) return Promise.resolve(null);
  if (_chatSettingsCache[username]) {
    return Promise.resolve(_chatSettingsCache[username]);
  }
  if (_chatSettingsInflight[username]) {
    return _chatSettingsInflight[username];
  }
  var p = api("/api/chats/" + encodeURIComponent(username) + "/settings")
    .then(function (st) {
      _chatSettingsCache[username] = st || {};
      delete _chatSettingsInflight[username];
      return _chatSettingsCache[username];
    })
    .catch(function () {
      delete _chatSettingsInflight[username];
      return {};
    });
  _chatSettingsInflight[username] = p;
  return p;
}

async function openMessagesPage() {
  if (!messagesPage) return;
  messagesPage.classList.remove("hidden");
  chatWindow.classList.add("hidden");
  document.body.classList.remove("messages-chat-open");
  currentChatUser = null;
  _refreshMsgTitleBadge();
  _loadMsgStoryRow();
  await loadConversations();
}

// ---------- Horizontal contacts / story row ----------
async function _refreshMsgTitleBadge() {
  try {
    const data = await api("/api/messages/unread/count");
    const n = data.count || 0;
    const el = document.getElementById("msg-title-badge");
    if (!el) return;
    if (n > 0) {
      el.textContent = n > 99 ? "99+" : String(n);
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  } catch (e) {}
}

async function _loadMsgStoryRow() {
  var row = document.getElementById("msg-stories-row");
  if (!row) return;
  row.innerHTML = '<div class="msg-story-skel"></div>'.repeat(6);

  // Refresh story groups so tap opens correct viewer
  if (typeof loadStories === "function") {
    try { await loadStories(); } catch (e) {}
  }

  try {
    var res = await api("/api/messages/online-contacts");
    var contacts = (res && res.contacts) ? res.contacts : (Array.isArray(res) ? res : []);
    var me = (res && res.me) ? res.me : null;

    var html = "";

    // ==== Self tile — "Your story" if exists, else "Add story" ====
    if (me) {
      var myAv = me.profile_pic
        ? '<img src="' + escapeHtml(me.profile_pic) + '" alt="" loading="lazy" decoding="async">'
        : initial(me.display_name || "?");
      var hasMyStory = (me.story_count || 0) > 0;

      html +=
        '<div class="msg-story-item msg-story-self" data-act="self" data-story="' + (hasMyStory ? "1" : "0") + '">' +
          '<div class="msg-story-av-wrap ' + (hasMyStory ? "has-story" : "") + '">' +
            '<div class="msg-story-av">' + myAv + '</div>' +
            (hasMyStory
              ? '<span class="msg-story-eye"><i class="fa-regular fa-eye"></i></span>'
              : '<div class="msg-story-plus"><i class="fa-solid fa-plus"></i></div>') +
          '</div>' +
          '<div class="msg-story-name">' +
            (hasMyStory ? "আপনার স্টোরি" : "স্টোরি দিন") +
          '</div>' +
        '</div>';
    }

    // ==== Others ====
    if (!contacts.length) {
      html += '<div class="msg-story-empty">কেউ এখনো আসেনি</div>';
    } else {
      contacts.forEach(function (c) {
        var secs = c.secs || 0;
        var isOnline = secs < 300;
        var av = c.profile_pic
          ? '<img src="' + escapeHtml(c.profile_pic) + '" alt="" loading="lazy" decoding="async">'
          : initial(c.display_name);
        var hasStory = (c.story_count || 0) > 0;
        var hasUnreadStory = (c.unread_story || 0) > 0;

        var ringClass = "";
        if (hasUnreadStory) ringClass = "has-unread";
        else if (hasStory) ringClass = "has-story";

        html +=
          '<div class="msg-story-item" data-user="' + escapeHtml(c.username) + '" data-story="' + (hasStory ? "1" : "0") + '">' +
            '<div class="msg-story-av-wrap ' + ringClass + '">' +
              '<div class="msg-story-av">' + av + '</div>' +
              (isOnline ? '<span class="online-dot"></span>' : '') +
            '</div>' +
            '<div class="msg-story-name">' +
              escapeHtml((c.display_name || "").split(" ")[0]) +
            '</div>' +
          '</div>';
      });
    }

    row.innerHTML = html;

    // Wire actions
    row.querySelectorAll(".msg-story-item").forEach(function (el) {
      el.addEventListener("click", function () {
        var act = el.dataset.act;
        var u = el.dataset.user;
        var hasStory = el.dataset.story === "1";

        // Self tile
        if (act === "self") {
          if (hasStory) {
            // Open own story viewer
            if (typeof storyGroups !== "undefined" && state.me) {
              var myIdx = -1;
              for (var i = 0; i < storyGroups.length; i++) {
                if (storyGroups[i].user && storyGroups[i].user.username === state.me.username) {
                  myIdx = i; break;
                }
              }
              if (myIdx !== -1 && typeof openStoryViewer === "function") {
                openStoryViewer(myIdx, 0);
                return;
              }
            }
          }
          // No story → open upload
          if (typeof resetStoryUpload === "function") resetStoryUpload();
          var m = document.getElementById("story-upload-modal");
          if (m) m.classList.remove("hidden");
          return;
        }

        if (!u) return;

        if (hasStory && typeof openStoryForUser === "function") {
          var ok = openStoryForUser(u);
          if (ok) return;
        }
        openChat(u);
      });
    });
  } catch (err) {
    console.error("[STORY ROW]", err);
    row.innerHTML = "";
  }
}

// ---------- Open story viewer for a specific username ----------
function openStoryForUser(username) {
  if (!username) return false;
  if (typeof storyGroups === "undefined" || !Array.isArray(storyGroups)) return false;
  // Find group index
  var idx = -1;
  for (var i = 0; i < storyGroups.length; i++) {
    var g = storyGroups[i];
    if (g && g.user && g.user.username === username) { idx = i; break; }
  }
  if (idx === -1) return false;
  // Find first unseen story index (else 0)
  var stories = storyGroups[idx].stories || [];
  var startAt = 0;
  for (var j = 0; j < stories.length; j++) {
    if (!stories[j].viewed) { startAt = j; break; }
  }
  if (typeof openStoryViewer === "function") {
    try {
      openStoryViewer(idx, startAt);
      return true;
    } catch (e) {
      console.warn("[STORY] openStoryViewer failed", e);
      return false;
    }
  }
  return false;
}

async function openChat(username) {
  if (!messagesPage) return;
  messagesPage.classList.remove("hidden");
  document.body.classList.add("messages-chat-open");
  currentChatUser = username;
  chatWindow.classList.remove("hidden");
  if (typeof _applyChatPrefs === "function") _applyChatPrefs(username);

  convItems.querySelectorAll(".conv-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.username === username);
  });

  await loadChatMessages(true);
  startChatPolling();
  if (chatInput) chatInput.focus();
}

async function loadChatMessages(scrollToBottom = false) {
  if (!currentChatUser) return;
  // S30.2 - snapshot the user we're loading for; if the chat changes mid-flight,
  // abandon this render (was: results from old user could render into new chat)
  var _myUser = currentChatUser;

  try {
    const data = await api("/api/messages/" + encodeURIComponent(_myUser));
    // bail if user changed while we were awaiting
    if (currentChatUser !== _myUser) return;

    const u = data.user;

    const _pres = _presenceText(data.other_seconds_ago);
    const _typingNow = !!data.other_is_typing;
    let _statusHTML;
    if (_typingNow) {
      _statusHTML = '<span class="chat-status typing"><span class="typing-dots"><span></span><span></span><span></span></span> লিখছেন...</span>';
    } else {
      _statusHTML = '<span class="chat-status ' + (_pres.online ? "online" : "offline") + '">' +
        (_pres.online ? '<span class="online-dot"></span> ' : '') +
        escapeHtml(_pres.text) + '</span>';
    }
    var _headerName = u.display_name;
    try {
      var _st = await _getChatSettings(u.username);
      if (currentChatUser !== _myUser) return;
      if (_st && _st.nickname && _st.nickname.trim()) {
        _headerName = _st.nickname;
      } else if (data.their_self_nickname && data.their_self_nickname.trim()) {
        _headerName = data.their_self_nickname;
      }
    } catch (e) {}
    if (currentChatUser !== _myUser) return;

    // S30.2 - only rewrite header if content actually changed (stop 3s flicker)
    var _newHeaderHTML = `
      <div class="chat-user-avatar">${avatarInner(_headerName, u.profile_pic)}</div>
      <div style="min-width:0;flex:1">
        <div class="chat-user-name">${escapeHtml(_headerName)}</div>
        <div class="chat-user-status">${_statusHTML}</div>
      </div>`;
    if (chatUserInfo.dataset.sig !== _newHeaderHTML) {
      chatUserInfo.innerHTML = _newHeaderHTML;
      chatUserInfo.dataset.sig = _newHeaderHTML;
    }
    chatUserInfo.onclick = () => {
      stopChatPolling();
      messagesPage.classList.add("hidden");
      openProfile(u.username);
    };

    const msgs = data.messages;
    // S30.2 - use msg id (not count) to detect changes (was: delete/edit kept count same)
    var _lastId = msgs.length ? String(msgs[msgs.length - 1].id) : "0";
    var _sig = _lastId + ":" + msgs.length + ":" + (data.other_is_typing ? "1" : "0");

    if (chatMessages.dataset.sig === _sig && !scrollToBottom) return;

    const wasAtBottom =
      chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 120;

    let _lastDay = "";
    const _parts = msgs.map(function (m) {
      const d = parseISO(m.created_at);
      const dayKey = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
      let sep = "";
      if (dayKey !== _lastDay) {
        _lastDay = dayKey;
        sep = _chatDateSepHTML(m.created_at);
      }
      return sep + _chatMsgHTML(m, data.me_id);
    });
    chatMessages.innerHTML = _parts.join("");
    chatMessages.dataset.sig = _sig;
    lastMsgCount = msgs.length;

    if (scrollToBottom || wasAtBottom) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  } catch (err) {
    // S30.2 - do NOT wipe existing messages on transient error.
    // Show inline indicator instead. Next successful poll will recover.
    if (currentChatUser !== _myUser) return;
    if (!chatMessages.dataset.sig) {
      // truly empty — show placeholder
      chatMessages.innerHTML = '<div class="conv-empty" style="padding:40px 20px"><p>লোড করা যায়নি</p></div>';
    }
    // reset signature so next poll ALWAYS re-renders (was: count matched → early return → stuck)
    chatMessages.dataset.sig = "";
    console.warn("[CHAT] load failed, will retry:", err && err.message);
  }
}

// S19.11 — date separator helper
function _chatDateSepHTML(iso) {
  const d = parseISO(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - target) / 86400000);
  let label;
  if (diffDays === 0) label = "আজ";
  else if (diffDays === 1) label = "গতকাল";
  else if (diffDays < 7) {
    const days = ["রবিবার", "সোমবার", "মঙ্গলবার", "বুধবার", "বৃহস্পতিবার", "শুক্রবার", "শনিবার"];
    label = days[d.getDay()];
  } else {
    const months = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
                    "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
    const bnDay = String(d.getDate()).replace(/[0-9]/g, function (x) { return "০১২৩৪৫৬৭৮৯"[x]; });
    const bnYear = String(d.getFullYear()).replace(/[0-9]/g, function (x) { return "০১২৩৪৫৬৭৮৯"[x]; });
    label = bnDay + " " + months[d.getMonth()] + " " + bnYear;
  }
  return '<div class="chat-date-sep"><span>' + escapeHtml(label) + '</span></div>';
}


function _presenceText(secs) {
  if (secs === null || secs === undefined) return { text: "অফলাইন", online: false };
  if (secs < 60) return { text: "অনলাইন", online: true };
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    return { text: `শেষ দেখা ${m} মিনিট আগে`, online: false };
  }
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    return { text: `শেষ দেখা ${h} ঘণ্টা আগে`, online: false };
  }
  if (secs < 604800) {
    const d = Math.floor(secs / 86400);
    return { text: `শেষ দেখা ${d} দিন আগে`, online: false };
  }
  return { text: "শেষ দেখা অনেক আগে", online: false };
}

function _chatMsgHTML(m, meId) {
  // Series 3C — deleted message render
  if (m.deleted_at) {
    const _mineDel = m.sender_id === meId;
    const _sideDel = _mineDel ? "outgoing" : "incoming";
    return '<div class="chat-msg ' + _sideDel + ' deleted-msg" data-mid="' + m.id + '">' +
      '<i class="fa-solid fa-ban"></i> ' +
      '<span>\u098f\u0987 \u09ae\u09c7\u09b8\u09c7\u099c\u099f\u09bf \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09be \u09b9\u09df\u09c7\u099b\u09c7</span>' +
      '<div class="chat-msg-time">' + shortTime(m.created_at) + '</div>' +
    '</div>';
  }
  // Series 3B fix — system messages render as centered pills
  if (m.kind === "system") {
    return '<div class="chat-msg-system" data-mid="' + m.id + '">' +
      '<i class="fa-solid fa-circle-info"></i>' +
      '<span>' + escapeHtml(m.content || "") + '</span>' +
    '</div>';
  }
  const mine = m.sender_id === meId;
  const side = mine ? "outgoing" : "incoming";

  let replyHTML = "";
  if (m.parent_id) {
    const replyName = escapeHtml(m.parent_sender_name || "—");
    let preview = "";
    if (m.parent_attachment && !m.parent_content) preview = "📷 ছবি";
    else if (m.parent_content) preview = escapeHtml((m.parent_content || "").slice(0, 60));
    else preview = "—";
    replyHTML =
      '<div class="chat-msg-reply">' +
        '<div class="cmr-name">' + replyName + '</div>' +
        '<div class="cmr-text">' + preview + '</div>' +
      '</div>';
  }

  let imageHTML = "";
  if (m.attachment) {
    imageHTML = '<div class="chat-msg-image"><img src="' + escapeHtml(m.attachment) + '" alt="" loading="lazy"></div>';
  }

  let editedMark = m.edited_at ? '<span class="chat-msg-edited">(\u09b8\u09ae\u09cd\u09aa\u09be\u09a6\u09bf\u09a4)</span>' : "";

  let contentHTML = "";
  if (m.kind === "voice" && m.attachment) {
    var dur = m.duration ? Math.round(m.duration) : 0;
    var durStr = Math.floor(dur / 60) + ":" + String(dur % 60).padStart(2, "0");
    contentHTML =
      '<div class="chat-voice" data-src="' + escapeHtml(m.attachment) + '" data-dur="' + dur + '">' +
        '<button type="button" class="cv-play"><i class="fa-solid fa-play"></i></button>' +
        '<div class="cv-bars"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>' +
        '<span class="cv-dur">' + durStr + '</span>' +
      '</div>';
  } else if (m.content) {
    contentHTML = '<div class="chat-msg-text">' + escapeHtml(m.content) + '</div>';
  }

  let reactionHTML = "";
  if (m.reaction_count > 0) {
    var emoji = "❤️";
    if (m.my_reaction === "like") emoji = "👍";
    else if (m.my_reaction === "haha") emoji = "😂";
    else if (m.my_reaction === "wow") emoji = "😮";
    else if (m.my_reaction === "sad") emoji = "😢";
    reactionHTML = '<div class="chat-msg-reactions"><span class="cmr-pill">' + emoji + ' ' + m.reaction_count + '</span></div>';
  }

  let ticksHTML = "";
  if (mine) {
    if (m.is_read) {
      ticksHTML = '<span class="chat-ticks read" title="পঠিত"><i class="fa-solid fa-check-double"></i></span>';
    } else {
      ticksHTML = '<span class="chat-ticks" title="পাঠানো"><i class="fa-solid fa-check"></i></span>';
    }
  }

  return '<div class="chat-msg ' + side + (m.attachment ? " has-image" : "") + '" data-mid="' + m.id + '" data-mine="' + (mine ? "1" : "0") + '">' +
    replyHTML + imageHTML + contentHTML +
    '<div class="chat-msg-time">' + shortTime(m.created_at) + ticksHTML + '</div>' +
    reactionHTML +
  '</div>';
}

function stopChatPolling() {
  if (chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
  // S39.15 — cleanup voice recorder stream on chat close
  try {
    if (typeof _vr !== "undefined" && _vr.active) {
      _vrStop(true);
    }
    if (typeof _vr !== "undefined" && _vr.rawStream) {
      _vr.rawStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      _vr.rawStream = null;
    }
    if (typeof _vr !== "undefined" && _vr.stream) {
      _vr.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      _vr.stream = null;
    }
  } catch (e) {}
}

function startChatPolling() {
  stopChatPolling();
  chatPollTimer = setInterval(() => {
    if (currentChatUser && messagesPage && !messagesPage.classList.contains("hidden") && !document.hidden) {
      loadChatMessages(false);
    }
  }, 3000);
}

// ---------- Chat 3-dot menu ----------
async function _openChatMenu() {
  if (!currentChatUser) return;
  const old = document.getElementById("chat-menu");
  if (old) old.remove();

  // S29.5 - read from cache (populated by openChat / prior menu open)
  let settings = { pinned: false, muted: false };
  try {
    var _s = await _getChatSettings(currentChatUser);
    if (_s) settings = _s;
  } catch (e) {}

  const menu = document.createElement("div");
  menu.id = "chat-menu";
  menu.className = "chat-menu";
  menu.innerHTML = `
    <div class="cm-backdrop"></div>
    <div class="cm-panel">
      <div class="cm-handle"></div>
      <button class="cm-item" data-act="profile">
        <i class="fa-regular fa-user"></i><span>প্রোফাইল দেখুন</span>
      </button>
      <button class="cm-item" data-act="search">
        <i class="fa-solid fa-magnifying-glass"></i><span>চ্যাটে খুঁজুন</span>
      </button>
      <button class="cm-item" data-act="theme">
        <i class="fa-solid fa-palette"></i>
        <span>চ্যাট থিম</span>
      </button>
      <button class="cm-item" data-act="nickname">
        <i class="fa-regular fa-id-badge"></i>
        <span>নিকনেম</span>
      </button>
      <button class="cm-item" data-act="wallpaper">
        <i class="fa-regular fa-image"></i>
        <span>ওয়ালপেপার</span>
      </button>
      <button class="cm-item" data-act="pin">
        <i class="fa-solid fa-thumbtack"></i>
        <span>${settings.pinned ? "পিন সরান" : "চ্যাট পিন করুন"}</span>
      </button>
      <button class="cm-item" data-act="mute">
        <i class="fa-solid ${settings.muted ? "fa-bell" : "fa-bell-slash"}"></i>
        <span>${settings.muted ? "আনমিউট করুন" : "মিউট করুন"}</span>
      </button>
      <button class="cm-item danger" data-act="clear">
        <i class="fa-solid fa-broom"></i><span>চ্যাট ক্লিয়ার করুন</span>
      </button>
      <button class="cm-item danger" data-act="block">
        <i class="fa-solid fa-ban"></i><span>ব্লক করুন</span>
      </button>
    </div>`;
  document.body.appendChild(menu);
  requestAnimationFrame(() => menu.classList.add("show"));

  const close = () => { menu.classList.remove("show"); setTimeout(() => menu.remove(), 260); };
  menu.querySelector(".cm-backdrop").addEventListener("click", close);

  menu.querySelectorAll(".cm-item").forEach(btn => {
    btn.addEventListener("click", async () => {
      const act = btn.dataset.act;
      close();
      const u = currentChatUser;
      if (!u) return;

      if (act === "profile") {
        document.getElementById("messages-page")?.classList.add("hidden");
        document.body.classList.remove("messages-chat-open");
        openProfile(u);
      } else if (act === "search") {
        showToast("🔍 চ্যাট সার্চ — Series 2");
      } else if (act === "theme") {
        _openChatThemePicker(u);
      } else if (act === "nickname") {
        _openNicknameModal(u);
      } else if (act === "wallpaper") {
        _openWallpaperPicker(u);
      } else if (act === "pin") {
        try {
          const r = await api("/api/chats/" + encodeURIComponent(u) + "/settings", {
            method: "POST",
            body: JSON.stringify({ pinned: !settings.pinned, muted: settings.muted }),
          });
          _invalidateChatSettings(u);   // S29.5
          showToast(r.pinned ? "📌 পিন করা হয়েছে" : "পিন সরানো হয়েছে");
          loadConversations();
        } catch (e) { alert(e.message); }
      } else if (act === "mute") {
        try {
          const r = await api("/api/chats/" + encodeURIComponent(u) + "/settings", {
            method: "POST",
            body: JSON.stringify({ pinned: settings.pinned, muted: !settings.muted }),
          });
          _invalidateChatSettings(u);   // S29.5
          showToast(r.muted ? "🔕 মিউট করা হয়েছে" : "🔔 আনমিউট");
          loadConversations();
        } catch (e) { alert(e.message); }
      } else if (act === "clear") {
        if (!confirm("এই চ্যাটের সব মেসেজ মুছবেন? এটা ফেরানো যাবে না।")) return;
        try {
          await api("/api/chats/" + encodeURIComponent(u) + "/clear", { method: "POST" });
          showToast("🧹 চ্যাট ক্লিয়ার হয়েছে");
          await loadChatMessages(true);
          lastMsgCount = 0;
        } catch (e) { alert(e.message); }
      } else if (act === "block") {
        if (!confirm("@" + u + " কে ব্লক করবেন?")) return;
        try {
          await api("/api/users/" + encodeURIComponent(u) + "/block", { method: "POST" });
          showToast("🚫 ব্লক করা হয়েছে");
          stopChatPolling();
          document.getElementById("chat-window")?.classList.add("hidden");
          document.body.classList.remove("messages-chat-open");
          currentChatUser = null;
          loadConversations();
        } catch (e) { alert(e.message); }
      }
    });
  });
}

document.addEventListener("click", (e) => {
  if (e.target.closest("#chat-more-btn")) {
    e.preventDefault();
    e.stopPropagation();
    _openChatMenu();
  } else if (e.target.closest("#chat-call-btn")) {
    showToast("📞 অডিও কল — Series 3");
  } else if (e.target.closest("#chat-video-btn")) {
    showToast("📹 ভিডিও কল — Series 3");
  }
}, true);

// Typing indicator: send on input (throttled)
(function () {
  const ci = document.getElementById("chat-input");
  if (!ci) return;
  let _lastTypingSent = 0;
  ci.addEventListener("input", function () {
    if (!currentChatUser) return;
    const now = Date.now();
    if (now - _lastTypingSent < 2500) return;
    _lastTypingSent = now;
    api("/api/messages/" + encodeURIComponent(currentChatUser) + "/typing", {
      method: "POST",
    }).catch(function () {});
  });
})();

if (chatForm) {
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !currentChatUser) return;

    chatInput.value = "";
    const sendBtn = document.getElementById("chat-send-btn");
    if (sendBtn) sendBtn.disabled = true;

    const temp = document.createElement("div");
    temp.className = "chat-msg outgoing";
    temp.innerHTML = `${escapeHtml(text)}<div class="chat-msg-time">এইমাত্র</div>`;
    chatMessages.appendChild(temp);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    lastMsgCount++;

    try {
      await api("/api/messages/" + encodeURIComponent(currentChatUser), {
        method: "POST",
        body: JSON.stringify({ content: text }),
      });
      await loadChatMessages(true);
      await loadConversations();
    } catch (err) {
      temp.remove();
      lastMsgCount--;
      alert(err.message);
    } finally {
      if (sendBtn) sendBtn.disabled = false;
      chatInput.focus();
    }
  });
}

const chatCloseBtn = document.getElementById("chat-close");
if (chatCloseBtn) {
  chatCloseBtn.addEventListener("click", () => {
    stopChatPolling();
    chatWindow.classList.add("hidden");
    document.body.classList.remove("messages-chat-open");
    if (typeof _exitChatMultiSelect === "function") _exitChatMultiSelect();
    if (typeof _closeChatSearch === "function") _closeChatSearch();
    currentChatUser = null;
    lastMsgCount = 0;
    loadConversations();
  });
}

// New chat modal
const newChatBtn = document.getElementById("new-chat-btn");
if (newChatBtn) {
  newChatBtn.addEventListener("click", () => {
    newChatModal.classList.remove("hidden");
    document.getElementById("new-chat-search").value = "";
    document.getElementById("new-chat-results").innerHTML = "";
    document.getElementById("new-chat-search").focus();
  });
}

const closeNewChatBtn = document.getElementById("close-new-chat");
if (closeNewChatBtn) {
  closeNewChatBtn.addEventListener("click", () => newChatModal.classList.add("hidden"));
}

if (newChatModal) {
  newChatModal.addEventListener("click", (e) => {
    if (e.target === newChatModal) newChatModal.classList.add("hidden");
  });
}

const newChatSearch = document.getElementById("new-chat-search");
const newChatResults = document.getElementById("new-chat-results");

if (newChatSearch) {
  let ncTimer;
  newChatSearch.addEventListener("input", () => {
    clearTimeout(ncTimer);
    const q = newChatSearch.value.trim();
    if (!q) {
      newChatResults.innerHTML = "";
      return;
    }
    ncTimer = setTimeout(async () => {
      try {
        const users = await api("/api/users?q=" + encodeURIComponent(q));
        const filtered = users.filter((u) => u.username !== state.me.username);
        if (!filtered.length) {
          newChatResults.innerHTML = `<p style="color:var(--muted);text-align:center;padding:16px">কেউ পাওয়া যায়নি</p>`;
          return;
        }
        newChatResults.innerHTML = filtered
          .map(
            (u) => `
          <div class="new-chat-result" data-username="${escapeHtml(u.username)}">
            <div class="new-chat-avatar">${avatarInner(u.display_name, u.profile_pic)}</div>
            <div>
              <div style="font-weight:600">${escapeHtml(u.display_name)}</div>
              <div style="font-size:12px;color:var(--muted)">@${escapeHtml(u.username)}</div>
            </div>
          </div>
        `
          )
          .join("");

        newChatResults.querySelectorAll(".new-chat-result").forEach((el) => {
          el.addEventListener("click", () => {
            newChatModal.classList.add("hidden");
            openChat(el.dataset.username);
          });
        });
      } catch (err) {}
    }, 250);
  });
}

// Conversation search filter
const convSearchInput = document.getElementById("conv-search-input");
if (convSearchInput) {
  convSearchInput.addEventListener("input", () => {
    const q = convSearchInput.value.toLowerCase().trim();
    convItems.querySelectorAll(".conv-item").forEach((el) => {
      const name = el.querySelector(".conv-name").textContent.toLowerCase();
      el.style.display = name.includes(q) ? "" : "none";
    });
  });
}

// Unread badge on sidebar
const mbnMessages = document.querySelector('.mbn-item[data-mbn="messages"]');

async function updateUnreadBadge() {
  try {
    const data = await api("/api/messages/unread/count");
    const count = data.count || 0;

    // 1) Sidebar nav badge (desktop + drawer)
    const sidebarBadge = document.getElementById("msg-badge");
    if (sidebarBadge) {
      if (count > 0) {
        sidebarBadge.textContent = count > 99 ? "99+" : count;
        sidebarBadge.classList.remove("hidden");
      } else {
        sidebarBadge.classList.add("hidden");
      }
    }

    // 2) Topbar small dot (mobile)
    const topDot = document.querySelector("#top-messages-btn .notif-dot");
    if (topDot) {
      if (count > 0) {
        topDot.textContent = count > 9 ? "9+" : count;
        topDot.classList.remove("hidden");
      } else {
        topDot.classList.add("hidden");
      }
    }

    // Mobile bottom nav msg badge
    const mbnMsgBadge = document.getElementById("mbn-msg-badge");
    if (mbnMsgBadge) {
      if (count > 0) {
        mbnMsgBadge.textContent = count > 9 ? "9+" : count;
        mbnMsgBadge.classList.remove("hidden");
      } else {
        mbnMsgBadge.classList.add("hidden");
      }
    }

    // 3) Mobile bottom nav dot (optional)
    if (mbnMessages) {
      let dot = mbnMessages.querySelector(".notif-dot");
      if (count > 0) {
        if (!dot) {
          dot = document.createElement("span");
          dot.className = "notif-dot";
          dot.style.cssText = "position:absolute;top:2px;right:14px;";
          mbnMessages.style.position = "relative";
          mbnMessages.appendChild(dot);
        }
        dot.textContent = count > 9 ? "9+" : count;
      } else if (dot) {
        dot.remove();
      }
    }
  } catch (e) {}
}

// S30.11 - merged into _badgePoll below

// ==================================================
// STORIES
// ==================================================

// ==================================================
// BOOT
// ==================================================

(function boot() {
  // Apply theme first (before any other rendering)
  const saved = readSavedTheme() || "light";
  applyTheme(saved);

  // Fill stories
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fillStoryAvatars);
  } else {
    fillStoryAvatars();
  }

  // Auto-login if session exists
  (async () => {
    try {
      const { user } = await api("/api/me");
      if (user) await enterApp();
    } catch (e) {}
  })();
})();


// ==================================================
// TOPBAR + MOBILE NAV HANDLERS
// ==================================================

// Top "Create Post" button
const topCreateBtn = document.getElementById("top-create-post");
if (topCreateBtn) {
  topCreateBtn.addEventListener("click", () => {
    const postContent = document.getElementById("post-content");
    if (postContent) {
      postContent.focus();
      postContent.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}

// Top messages button
const topMessagesBtn = document.getElementById("top-messages-btn");
if (topMessagesBtn) {
  topMessagesBtn.addEventListener("click", openMessagesPage);
}

// Mobile bottom nav
document.querySelectorAll(".mbn-item").forEach((btn) => {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".mbn-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    var target = btn.dataset.mbn;
    console.log("[MBNAV] clicked:", target);

    if (target === "home") {
      var av = document.getElementById("app-view");
      if (av) av.classList.remove("hidden");
      ["profile-page", "messages-page", "explore-page", "hashtag-page",
       "notifications-page", "saved-page", "reels-page", "story-viewer",
       "profile-modal"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.classList.add("hidden");
      });
      if (typeof _PageStack !== "undefined") _PageStack.length = 0;
      if (state.me && typeof loadFeed === "function") loadFeed();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (target === "explore") {
      var av2 = document.getElementById("app-view");
      if (av2) av2.classList.remove("hidden");
      if (typeof openExplorePage === "function") openExplorePage();
    } else if (target === "create") {
      var av3 = document.getElementById("app-view");
      if (av3) av3.classList.remove("hidden");
      var ta = document.getElementById("post-content");
      if (ta) {
        ta.focus();
        ta.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } else if (target === "reel") {
      console.log("[MBNAV] opening reels...");
      if (typeof openReelsPage === "function") {
        openReelsPage().catch(function (e) { console.error("Reels error:", e); });
      } else {
        console.error("[MBNAV] openReelsPage is not defined!");
      }
    } else if (target === "messages") {
      if (typeof openMessagesPage === "function") openMessagesPage();
    } else if (target === "notifications") {
      if (typeof openNotificationsPage === "function") openNotificationsPage();
    } else if (target === "profile" && state.me) {
      if (typeof openProfile === "function") openProfile(state.me.username);
    }
  });
});
// ==================================================
// RIGHT SIDEBAR — Profile / Suggestions / Online
// ==================================================

async function loadRightSidebar() {
  if (!state.me) return;

  // Profile preview
  const rsAvatar = document.getElementById("rs-avatar");
  const rsName = document.getElementById("rs-name");
  const rsUser = document.getElementById("rs-username");
  const rsBio = document.getElementById("rs-bio");
  const rsPosts = document.getElementById("rs-posts");

  if (rsAvatar) setAvatar(rsAvatar, state.me.display_name, state.me.profile_pic);
  if (rsName) rsName.textContent = state.me.display_name;
  if (rsUser) rsUser.textContent = "@" + state.me.username;
  if (rsBio) rsBio.textContent = state.me.bio || "বায়ো নেই";

  try {
    const myProfile = await api("/api/users/" + state.me.username);
    if (rsPosts) rsPosts.textContent = myProfile.posts.length;
  } catch (e) {}

  // S18.9d — Load real trending topics
  try {
    const trending = await api("/api/explore/trending");
    const trendEl = document.getElementById("rs-trending");
    if (trendEl) {
      if (!trending || !trending.length) {
        trendEl.innerHTML = `<p style="color:var(--muted);font-size:13px;padding:8px 0">এখনো কোনো ট্রেন্ডিং নেই</p>`;
      } else {
        trendEl.innerHTML = trending
          .slice(0, 5)
          .map((t) => `
            <a href="#" class="trend-item" data-tag="${escapeHtml(t.tag)}">
              <span class="trend-tag">#${escapeHtml(t.tag)}</span>
              <span class="trend-count">${t.count} পোস্ট</span>
            </a>
          `)
          .join("");
        trendEl.querySelectorAll(".trend-item").forEach((el) => {
          el.addEventListener("click", (e) => {
            e.preventDefault();
            if (typeof openHashtag === "function") openHashtag(el.dataset.tag);
          });
        });
      }
    }
  } catch (err) {}

  // Suggestions + Online — use all users
  try {
    const users = await api("/api/users?q=");
    const others = users.filter((u) => u.username !== state.me.username).slice(0, 5);

    // Suggestions
    const sugg = document.getElementById("rs-suggestions");
    if (sugg) {
      if (!others.length) {
        sugg.innerHTML = `<p style="color:var(--muted);font-size:13px;padding:8px 0">কোনো সাজেশন নেই</p>`;
      } else {
        sugg.innerHTML = others
          .map((u) => `
            <div class="rs-suggest-item">
              <div class="rs-suggest-avatar" data-user="${escapeHtml(u.username)}">
                ${avatarInner(u.display_name, u.profile_pic)}
              </div>
              <div class="rs-suggest-info" data-user="${escapeHtml(u.username)}">
                <div class="rs-suggest-name">${escapeHtml(u.display_name)}</div>
                <div class="rs-suggest-meta">@${escapeHtml(u.username)}</div>
              </div>
              <button class="rs-follow-btn" data-user="${escapeHtml(u.username)}">ফলো</button>
            </div>
          `)
          .join("");

        sugg.querySelectorAll("[data-user]").forEach((el) => {
          if (el.classList.contains("rs-follow-btn")) {
            el.addEventListener("click", (e) => {
              e.stopPropagation();
              showToast("✅ ফলো করা হয়েছে!");
            });
          } else {
            el.addEventListener("click", () => openProfile(el.dataset.user));
          }
        });
      }
    }

    // S18.9b — Online contacts (real, based on last_seen < 5 min)
    const online = document.getElementById("rs-online");
    if (online) {
      try {
        const onlineUsers = await api("/api/users/online");
        if (!onlineUsers || !onlineUsers.length) {
          online.innerHTML = `<p style="color:var(--muted);font-size:13px;padding:8px 0">এখন কেউ অনলাইনে নেই</p>`;
        } else {
          online.innerHTML = onlineUsers
            .slice(0, 6)
            .map(
              (u) => `
          <div class="online-item" data-user="${escapeHtml(u.username)}">
            <div class="online-avatar">${avatarInner(u.display_name, u.profile_pic)}</div>
            <div class="online-name">${escapeHtml(u.display_name)}</div>
          </div>
        `
            )
            .join("");
          online.querySelectorAll(".online-item").forEach((el) => {
            el.addEventListener("click", () => openProfile(el.dataset.user));
          });
        }
      } catch (err) {
        online.innerHTML = `<p style="color:var(--muted);font-size:13px;padding:8px 0">লোড করা যায়নি</p>`;
      }
    }
  } catch (e) {}
}

_enterAppHooks.push(() => loadRightSidebar());


// S19.3 — "সব দেখুন" → open first unseen story
(function () {
  document.addEventListener("click", function (e) {
    var link = e.target.closest(".stories-section .see-all");
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    // Find first unseen group
    var idx = -1;
    for (var i = 0; i < storyGroups.length; i++) {
      var g = storyGroups[i];
      if (g.user && state.me && g.user.username === state.me.username) continue;
      if (g.has_unseen) { idx = i; break; }
    }
    if (idx === -1) {
      // fallback: first non-self story
      for (var j = 0; j < storyGroups.length; j++) {
        if (storyGroups[j].user && state.me && storyGroups[j].user.username !== state.me.username) {
          idx = j; break;
        }
      }
    }
    if (idx !== -1) {
      if (typeof openStoryViewer === "function") openStoryViewer(idx, 0);
    } else {
      showToast("এখনো কোনো স্টোরি নেই");
    }
  }, true);
})();


// ==================================================
// STORIES SYSTEM
// ==================================================

let storyGroups = [];       // all active story groups
let currentGroupIdx = 0;    // which user's stories we're viewing
let currentStoryIdx = 0;    // which story within the group
let storyTimer = null;
let _storyTimerRemaining = 5000;
let _storyTimerStartTime = 0;
let _storyTimerPaused = false;
let _storyTimerDuration = 5000;

// ---------- Load stories from server ----------

async function loadStories() {
  const row = document.querySelector(".stories-row");
  if (!row) return;
  try {
    storyGroups = await api("/api/stories");

    // Clear existing story cards (keep the add button)
    row.querySelectorAll(".story-card:not(.story-add)").forEach((el) => el.remove());

    // Check if I have stories
    const myGroup = storyGroups.find((g) => g.user.username === state.me.username);
    const addCard = row.querySelector(".story-add");
    if (addCard) addCard.classList.toggle("has-story", !!myGroup);

    // Add other users' stories
    storyGroups.forEach((group, idx) => {
      if (group.user.username === state.me.username) return; // skip self (self shown as "+")
      const card = document.createElement("div");
      card.className = "story-card";
      card.dataset.idx = idx;
      card.innerHTML = `
        <div class="story-hex ${group.has_unseen ? "unseen" : "seen"}">
          <div class="story-hex-content">
            ${group.user.profile_pic
              ? `<img src="${escapeHtml(group.user.profile_pic)}" alt="${escapeHtml(group.user.display_name)}" loading="lazy" decoding="async">`
              : generateAvatarSVG(group.user.username, group.user.display_name)}
          </div>
        </div>
        <span>${escapeHtml(group.user.display_name.split(" ")[0])}</span>
      `;
      card.addEventListener("click", () => openStoryViewer(idx, 0));
      row.appendChild(card);
    });
  } catch (err) {
    console.error("Stories load failed:", err);
  }
}

// ---------- Open viewer ----------

async function openStoryViewer(groupIdx, storyIdx) {
  if (!storyGroups[groupIdx]) return;
  currentGroupIdx = groupIdx;
  currentStoryIdx = storyIdx || 0;

  const viewer = document.getElementById("story-viewer");
  if (!viewer) return;
  viewer.classList.remove("hidden");

  await renderCurrentStory();
}

async function renderCurrentStory() {
  const group = storyGroups[currentGroupIdx];
  if (!group) return closeStoryViewer();

  const stories = group.stories;
  const story = stories[currentStoryIdx];
  if (!story) return closeStoryViewer();

  // Header
  const av = document.getElementById("sv-avatar");
  if (group.user.profile_pic) {
    av.innerHTML = `<img src="${escapeHtml(group.user.profile_pic)}" alt="" loading="lazy" decoding="async">`;
  } else {
    av.textContent = initial(group.user.display_name);
  }
  document.getElementById("sv-name").textContent = group.user.display_name;
  document.getElementById("sv-time").textContent = shortTime(story.created_at);

  // Media
  const media = document.getElementById("sv-media");
  media.innerHTML = "";
  if (story.media_type === "video") {
    const vid = document.createElement("video");
    vid.src = story.media;
    vid.autoplay = true;
    vid.muted = false;
    vid.playsInline = true;
    vid.onended = nextStory;
    media.appendChild(vid);
  } else {
    const img = document.createElement("img");
    img.src = story.media;
    img.alt = "Story";
    media.appendChild(img);
  }

  // Caption hidden in story viewer (will be shown in edit later)

  // Progress bars
  const prog = document.getElementById("sv-progress");
  prog.innerHTML = stories.map((s, i) => {
    let cls = "sv-progress-bar";
    if (i < currentStoryIdx) cls += " viewed";
    if (i === currentStoryIdx) cls += " active";
    return `<div class="${cls}"><div class="sv-progress-fill"></div></div>`;
  }).join("");

  // Reactions bar (only for other's stories) — append to BODY to avoid parent CSS issues
  const isMine = state.me && state.me.username === group.user.username;
  let reactBarEl = document.getElementById("sv-reactions-bar");
  if (!reactBarEl) {
    reactBarEl = document.createElement("div");
    reactBarEl.id = "sv-reactions-bar";
    reactBarEl.className = "sv-reactions-bar";
    reactBarEl.innerHTML =
      '<button type="button" class="sv-react" data-r="love">❤️</button>' +
      '<button type="button" class="sv-react" data-r="haha">😂</button>' +
      '<button type="button" class="sv-react" data-r="wow">😮</button>' +
      '<button type="button" class="sv-react" data-r="sad">😢</button>' +
      '<button type="button" class="sv-react" data-r="clap">👏</button>' +
      '<button type="button" class="sv-react" data-r="fire">🔥</button>';
    document.body.appendChild(reactBarEl);
  }
  reactBarEl.dataset.storyId = story.id;
  reactBarEl.classList.toggle("hidden", isMine);

  // Reply box (only for other's stories)
  let replyBarEl = document.getElementById("sv-reply-bar");
  if (!replyBarEl) {
    replyBarEl = document.createElement("div");
    replyBarEl.id = "sv-reply-bar";
    replyBarEl.className = "sv-reply-bar";
    replyBarEl.innerHTML =
      '<button type="button" class="sv-reply-trigger" id="sv-reply-trigger">' +
        '<i class="fa-regular fa-comment"></i> উত্তর লিখুন...' +
      '</button>' +
      '<form class="sv-reply-form hidden" id="sv-reply-form">' +
        '<input type="text" id="sv-reply-input" placeholder="উত্তর লিখুন..." maxlength="500" autocomplete="off">' +
        '<button type="submit" class="sv-reply-send" title="পাঠান"><i class="fa-solid fa-paper-plane"></i></button>' +
        '<button type="button" class="sv-reply-close" title="বাতিল"><i class="fa-solid fa-xmark"></i></button>' +
      '</form>';
    document.body.appendChild(replyBarEl);

    // Wire trigger
    replyBarEl.querySelector("#sv-reply-trigger").addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      var form = document.getElementById("sv-reply-form");
      var trig = document.getElementById("sv-reply-trigger");
      form.classList.remove("hidden");
      trig.classList.add("hidden");
      setTimeout(function() { document.getElementById("sv-reply-input").focus(); }, 50);
    });

    // Wire close
    replyBarEl.querySelector(".sv-reply-close").addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      var form = document.getElementById("sv-reply-form");
      var trig = document.getElementById("sv-reply-trigger");
      form.classList.add("hidden");
      trig.classList.remove("hidden");
      document.getElementById("sv-reply-input").value = "";
    });

    // Wire form submit
    replyBarEl.querySelector("#sv-reply-form").addEventListener("submit", async function(e) {
      e.preventDefault();
      e.stopPropagation();
      var input = document.getElementById("sv-reply-input");
      var text = (input.value || "").trim();
      if (!text) return;
      var bar = document.getElementById("sv-reactions-bar");
      var username = replyBarEl.dataset.username;
      if (!username) return;

      var sendBtn = replyBarEl.querySelector(".sv-reply-send");
      sendBtn.disabled = true;

      try {
        await api("/api/messages/" + encodeURIComponent(username), {
          method: "POST",
          body: JSON.stringify({ content: "📸 স্টোরি রিপ্লাই: " + text }),
        });
        // Inline success feedback
        sendBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
        sendBtn.classList.add("sent");
        input.disabled = true;
        input.placeholder = "✓ পাঠানো হয়েছে";
        if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
        setTimeout(function() {
          input.value = "";
          input.disabled = false;
          input.placeholder = "উত্তর লিখুন...";
          sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
          sendBtn.classList.remove("sent");
          sendBtn.disabled = false;
          replyBarEl.querySelector("#sv-reply-form").classList.add("hidden");
          replyBarEl.querySelector("#sv-reply-trigger").classList.remove("hidden");
        }, 1200);
      } catch (err) {
        sendBtn.disabled = false;
        input.placeholder = "পাঠানো যায়নি, আবার চেষ্টা করুন";
        input.classList.add("error");
        setTimeout(function() {
          input.placeholder = "উত্তর লিখুন...";
          input.classList.remove("error");
        }, 2000);
      }
    });
  }
  replyBarEl.dataset.username = group.user.username;
  replyBarEl.classList.toggle("hidden", isMine);

  // Views + delete
  const viewsEl = document.getElementById("sv-views");
  if (isMine) {
    if (story.views > 0) {
      viewsEl.innerHTML = `<button type="button" class="sv-views-btn" data-story-id="${story.id}"><i class="fa-regular fa-eye"></i> ${story.views} জন দেখেছে</button>`;
      viewsEl.classList.add("clickable");
    } else {
      viewsEl.innerHTML = `<i class="fa-regular fa-eye"></i> ০ জন দেখেছে`;
      viewsEl.classList.remove("clickable");
    }
    document.getElementById("sv-delete").classList.remove("hidden");
    document.getElementById("sv-delete").onclick = () => deleteCurrentStory(story.id);
  } else {
    viewsEl.innerHTML = "";
    document.getElementById("sv-delete").classList.add("hidden");
  }

  // Start auto-advance immediately (no await before timer)
  if (story.media_type !== "video") {
    _storyTimerStart(5000);
  } else {
    _storyTimerStop();
  }

  // Mark viewed in background (non-blocking)
  if (!isMine && !story.viewed) {
    api(`/api/stories/${story.id}/view`, { method: "POST" }).then(() => {
      story.viewed = true;
      group.has_unseen = group.stories.some((s) => !s.viewed);
    }).catch(() => {});
  }
}

function nextStory() {
  clearTimeout(storyTimer);
  const group = storyGroups[currentGroupIdx];
  if (!group) return closeStoryViewer();

  if (currentStoryIdx < group.stories.length - 1) {
    currentStoryIdx++;
    renderCurrentStory();
  } else {
    // Move to next user with unseen stories
    const nextIdx = findNextGroup(currentGroupIdx);
    if (nextIdx !== -1) {
      openStoryViewer(nextIdx, 0);
    } else {
      closeStoryViewer();
    }
  }
}

function prevStory() {
  clearTimeout(storyTimer);
  if (currentStoryIdx > 0) {
    currentStoryIdx--;
    renderCurrentStory();
  } else {
    const prevIdx = findPrevGroup(currentGroupIdx);
    if (prevIdx !== -1) {
      const g = storyGroups[prevIdx];
      openStoryViewer(prevIdx, g.stories.length - 1);
    }
  }
}

function findNextGroup(from) {
  for (let i = from + 1; i < storyGroups.length; i++) {
    if (storyGroups[i].user.username === state.me.username) continue;
    return i;
  }
  return -1;
}

function findPrevGroup(from) {
  for (let i = from - 1; i >= 0; i--) {
    if (storyGroups[i].user.username === state.me.username) continue;
    return i;
  }
  return -1;
}

function closeStoryViewer() {
  clearTimeout(storyTimer);
  const viewer = document.getElementById("story-viewer");
  if (viewer) viewer.classList.add("hidden");

  // S30.33 — explicitly pause any playing video before clearing
  const media = document.getElementById("sv-media");
  if (media) {
    try {
      media.querySelectorAll("video").forEach(function (v) {
        try { v.pause(); v.src = ""; v.load(); } catch (e) {}
      });
    } catch (e) {}
    media.innerHTML = "";
  }

  const bar = document.getElementById("sv-reactions-bar");
  if (bar) bar.classList.add("hidden");
  const rbar = document.getElementById("sv-reply-bar");
  if (rbar) rbar.classList.add("hidden");
  currentGroupIdx = 0;
  currentStoryIdx = 0;

  // S30.33 — do NOT call loadStories() here (was: row rebuilt → scroll reset)
  // Just mark viewed stories as viewed in the existing row data + refresh the
  // story ring classes to reflect new state, without rebuilding the row.
  try {
    var row = document.querySelector(".stories-row");
    if (row && Array.isArray(storyGroups)) {
      var idx = 0;
      row.querySelectorAll(".story-card").forEach(function (card) {
        if (card.classList.contains("story-add")) return;
        var g = storyGroups[idx];
        idx++;
        if (!g) return;
        var hex = card.querySelector(".story-hex");
        if (!hex) return;
        if (g.has_unseen) hex.classList.add("unseen");
        else hex.classList.remove("unseen");
        if (g.user && g.user.username === (window.state && state.me && state.me.username)) {
          // skip self
        }
      });
    }
  } catch (e) {}
}

async function deleteCurrentStory(sid) {
  if (!confirm("এই স্টোরি মুছে ফেলবেন?")) return;
  try {
    await api(`/api/stories/${sid}`, { method: "DELETE" });
    const group = storyGroups[currentGroupIdx];
    group.stories = group.stories.filter((s) => s.id !== sid);
    if (group.stories.length === 0) {
      closeStoryViewer();
    } else {
      if (currentStoryIdx >= group.stories.length) currentStoryIdx = group.stories.length - 1;
      renderCurrentStory();
    }
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Upload flow ----------

let pendingStoryMedia = null;

const storyFileInput = document.getElementById("story-file-input");
const storyUploadEmpty = document.getElementById("story-upload-empty");
const storyUploadPreview = document.getElementById("story-upload-preview");
const storyPreviewImg = document.getElementById("story-preview-img");
const publishStoryBtn = document.getElementById("publish-story");
const storyUploadModal = document.getElementById("story-upload-modal");

const btnChooseStory = document.getElementById("btn-choose-story");
if (btnChooseStory) btnChooseStory.addEventListener("click", () => storyFileInput.click());

if (storyFileInput) {
  storyFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("শুধু ছবি দেওয়া যাবে");
      return;
    }
    try {
      // Resize to max 1080px wide, quality 0.8 → keeps under 3MB
      const dataUri = await resizeImage(file, 1080, 0.8);
      pendingStoryMedia = dataUri;
      storyPreviewImg.src = dataUri;
      storyUploadEmpty.classList.add("hidden");
      storyUploadPreview.classList.remove("hidden");
      publishStoryBtn.disabled = false;
    } catch (err) {
      alert("ছবি লোড করা যায়নি");
    }
  });
}

const cancelStoryUpload = document.getElementById("cancel-story-upload");
if (cancelStoryUpload) {
  cancelStoryUpload.addEventListener("click", resetStoryUpload);
}
const closeStoryUpload = document.getElementById("close-story-upload");
if (closeStoryUpload) {
  closeStoryUpload.addEventListener("click", resetStoryUpload);
}
if (storyUploadModal) {
  storyUploadModal.addEventListener("click", (e) => {
    if (e.target === storyUploadModal) resetStoryUpload();
  });
}

function resetStoryUpload() {
  pendingStoryMedia = null;
  if (storyFileInput) storyFileInput.value = "";
  if (storyUploadEmpty) storyUploadEmpty.classList.remove("hidden");
  if (storyUploadPreview) storyUploadPreview.classList.add("hidden");
  if (storyPreviewImg) storyPreviewImg.src = "";
  const cap = document.getElementById("story-caption");
  if (cap) cap.value = "";
  // S30.27 — reset button HTML too (was: spinner stuck after first success)
  if (publishStoryBtn) {
    publishStoryBtn.disabled = true;
    publishStoryBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> পোস্ট করুন';
  }
  if (storyUploadModal) storyUploadModal.classList.add("hidden");
}

if (publishStoryBtn) {
  publishStoryBtn.addEventListener("click", async () => {
    if (!pendingStoryMedia) return;
    const caption = (document.getElementById("story-caption").value || "").trim();

    publishStoryBtn.disabled = true;
    publishStoryBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> পোস্ট হচ্ছে...`;

    try {
      await api("/api/stories", {
        method: "POST",
        body: JSON.stringify({
          media: pendingStoryMedia,
          media_type: "image",
          caption,
        }),
      });
      resetStoryUpload();
      await loadStories();
      showToast("✅ স্টোরি পোস্ট হয়েছে!");
    } catch (err) {
      alert(err.message);
      publishStoryBtn.disabled = false;
      publishStoryBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> পোস্ট করুন`;
    }
  });
}

// ---------- Wire up Add Story button ----------

const addStoryBtnEl = document.getElementById("add-story");
if (addStoryBtnEl) {
  // Remove old listener by replacing the node
  const newAdd = addStoryBtnEl.cloneNode(true);
  addStoryBtnEl.parentNode.replaceChild(newAdd, addStoryBtnEl);

  newAdd.addEventListener("click", () => {
    // If I have stories, open viewer for my own stories
    const myIdx = storyGroups.findIndex((g) => g.user.username === state.me.username);
    if (myIdx !== -1) {
      openStoryViewer(myIdx, 0);
    } else {
      // No stories yet → open upload
      resetStoryUpload();
      storyUploadModal.classList.remove("hidden");
    }
  });
}

// ---------- Viewer controls ----------

document.getElementById("sv-close")?.addEventListener("click", closeStoryViewer);
document.getElementById("sv-next")?.addEventListener("click", nextStory);
document.getElementById("sv-prev")?.addEventListener("click", prevStory);

// Tap zones on the media
// S30.31 — story tap: guard against accidental next after a hold-release
(function () {
  var _svHoldStart = 0;
  var _svHoldMoved = false;
  var _svLastHoldEnd = 0;
  var media = document.getElementById("sv-media");
  if (!media) return;

  media.addEventListener("touchstart", function (e) {
    _svHoldStart = Date.now();
    _svHoldMoved = false;
  }, { passive: true });

  media.addEventListener("touchmove", function (e) {
    if (Date.now() - _svHoldStart > 200) _svHoldMoved = true;
  }, { passive: true });

  media.addEventListener("touchend", function (e) {
    var held = Date.now() - _svHoldStart;
    _svLastHoldEnd = Date.now();
    if (_svHoldMoved || held > 500) {
      // it was a long press → don't navigate
      e.stopPropagation();
      e.preventDefault();
      return false;
    }
  }, true);

  media.addEventListener("click", function (e) {
    // discard click that fires right after a long hold (browser ghost click)
    if (Date.now() - _svLastHoldEnd < 300) {
      e.stopPropagation();
      e.preventDefault();
      return false;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 3) prevStory();
    else nextStory();
  }, true);
})();

// Keyboard
document.addEventListener("keydown", (e) => {
  const viewer = document.getElementById("story-viewer");
  if (!viewer || viewer.classList.contains("hidden")) return;
  // S30.29 — ignore keyboard nav when typing in an input/textarea
  // (was: space + arrows in reply input triggered story navigation)
  var t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); nextStory(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); prevStory(); }
  else if (e.key === "Escape") closeStoryViewer();
});

// ---------- Hook into enterApp ----------

_enterAppHooks.push(() => loadStories());


// ==================================================
// FOLLOW SYSTEM (frontend)
// ==================================================

async function toggleFollow(e) {
  const btn = e.currentTarget;
  const username = btn.dataset.username;
  const isFollowing = btn.dataset.following === "1";

  btn.disabled = true;
  try {
    const res = await api("/api/users/" + encodeURIComponent(username) + "/follow", {
      method: "POST",
    });

    btn.dataset.following = res.is_following ? "1" : "0";
    btn.classList.toggle("btn-follow", !res.is_following);
    const icon = res.is_following ? "fa-user-check" : "fa-user-plus";
    const label = res.is_following ? "আনফলো" : "ফলো করুন";
    btn.innerHTML = `<i class="fa-solid ${icon}"></i><span>${label}</span>`;

    const statEls = document.querySelectorAll(".profile-stats .stat-item .stat-num");
    if (statEls.length >= 3) statEls[1].textContent = res.followers;

    showToast(res.is_following ? "✅ ফলো করা হয়েছে" : "আনফলো করা হয়েছে");

    if (typeof loadStories === "function") loadStories();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function showFollowList(username, type) {
  try {
    const users = await api("/api/users/" + encodeURIComponent(username) + "/" + type);

    let modal = document.getElementById("follow-list-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "follow-list-modal";
      modal.className = "modal hidden";
      modal.innerHTML = `
        <div class="modal-content" style="max-width:400px">
          <button class="close-btn" id="close-follow-list">×</button>
          <h2 id="follow-list-title" style="margin-bottom:18px;font-size:18px"></h2>
          <div id="follow-list-items" style="max-height:400px;overflow-y:auto"></div>
        </div>
      `;
      document.body.appendChild(modal);
      document.getElementById("close-follow-list").onclick = () => modal.classList.add("hidden");
      modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.add("hidden");
      });
    }

    document.getElementById("follow-list-title").textContent =
      type === "followers" ? "👥 ফলোয়ার" : "👤 ফলোয়িং";

    const itemsEl = document.getElementById("follow-list-items");
    if (!users.length) {
      itemsEl.innerHTML = `<p style="color:var(--muted);text-align:center;padding:20px">কেউ নেই</p>`;
    } else {
      itemsEl.innerHTML = users
        .map(
          (u) => `
        <div class="new-chat-result" data-user="${escapeHtml(u.username)}">
          <div class="new-chat-avatar">${avatarInner(u.display_name, u.profile_pic)}</div>
          <div>
            <div style="font-weight:600">${escapeHtml(u.display_name)}</div>
            <div style="font-size:12px;color:var(--muted)">@${escapeHtml(u.username)}</div>
          </div>
        </div>
      `
        )
        .join("");
      itemsEl.querySelectorAll("[data-user]").forEach((el) => {
        el.addEventListener("click", () => {
          modal.classList.add("hidden");
          openProfile(el.dataset.user);
        });
      });
    }

    modal.classList.remove("hidden");
  } catch (err) {
    alert(err.message);
  }
}


// ==================================================
// EXPLORE + HASHTAG SYSTEM
// ==================================================

function linkifyHashtags(text) {
  // S30.15/30.27 — ReDoS cap + apostrophe-safe hashtag detection
  if (!text) return "";
  var s = String(text);
  if (s.length > 20000) s = s.slice(0, 20000);
  const escaped = escapeHtml(s);
  // S30.27 — require # to be preceded by whitespace/punctuation (NOT & from entity)
  // was: "#39" from &#39; was being treated as a hashtag → "it&#39;s" broke
  return escaped.replace(/(^|[\s\u00A0.,!?;:()\[\]"—–-])#([\w\u0980-\u09FF\u200c\u200d]{1,50})/g,
    function(match, prefix, tag) {
      return prefix + `<a href="#" class="hashtag-link" data-tag="${tag}">#${tag}</a>`;
    });
}

function attachHashtagListeners(container) {
  if (!container) return;
  container.querySelectorAll(".hashtag-link").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openHashtag(el.dataset.tag);
    });
  });
}

async function openExplorePage() {
  const page = document.getElementById("explore-page");
  if (!page) return;
  page.classList.remove("hidden");
  document.getElementById("explore-trending").classList.remove("hidden");
  document.getElementById("explore-posts").classList.add("hidden");
  document.getElementById("explore-users").classList.add("hidden");
  document.querySelectorAll(".explore-tab").forEach((t, i) => t.classList.toggle("active", i === 0));

  await loadTrendingTags();
  await loadTopPosts();
  await loadSuggestedUsers();
}

// Tabs
document.querySelectorAll(".explore-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".explore-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const name = tab.dataset.etab;
    ["trending", "posts", "users"].forEach((n) => {
      document.getElementById("explore-" + n).classList.toggle("hidden", n !== name);
    });
  });
});

// Back buttons


// Load trending tags
async function loadTrendingTags() {
  const el = document.getElementById("explore-trending");
  if (!el) return;
  try {
    const tags = await api("/api/explore/trending");
    if (!tags.length) {
      el.innerHTML = `<div class="explore-empty">
        <i class="fa-solid fa-fire"></i>
        <p>এখনো কোনো ট্রেন্ডিং হ্যাশট্যাগ নেই।<br>পোস্টে <strong>#হ্যাশট্যাগ</strong> দিয়ে শুরু করুন!</p>
      </div>`;
      return;
    }
    el.innerHTML = `<div class="explore-section-title"><i class="fa-solid fa-fire"></i> এই সপ্তাহে ট্রেন্ডিং</div>` +
      tags.map((t) => `
        <div class="tag-chip" data-tag="${escapeHtml(t.tag)}">
          <div class="tag-chip-icon">#</div>
          <div class="tag-chip-info">
            <div class="tag-chip-name">${escapeHtml(t.tag)}</div>
            <div class="tag-chip-count">${t.count} পোস্ট</div>
          </div>
        </div>
      `).join("");

    el.querySelectorAll(".tag-chip").forEach((chip) => {
      chip.addEventListener("click", () => openHashtag(chip.dataset.tag));
    });
  } catch (err) {
    el.innerHTML = `<div class="explore-empty"><p>লোড করা যায়নি</p></div>`;
  }
}

// Load top posts
async function loadTopPosts() {
  const el = document.getElementById("explore-posts");
  if (!el) return;
  try {
    const posts = await api("/api/explore/top-posts");
    if (!posts.length) {
      el.innerHTML = `<div class="explore-empty">
        <i class="fa-solid fa-image"></i>
        <p>এখনো কোনো টপ পোস্ট নেই।<br>অন্যরা লাইক করলে এখানে দেখা যাবে।</p>
      </div>`;
      return;
    }
    el.innerHTML = `<div class="explore-section-title"><i class="fa-solid fa-image"></i> টপ পোস্ট</div>
      <div class="explore-posts-grid">${posts.map(explorePostHTML).join("")}</div>`;
    attachHashtagListeners(el);
    el.querySelectorAll(".explore-post-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.classList.contains("hashtag-link")) return;
        openProfile(card.dataset.user);
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="explore-empty"><p>লোড করা যায়নি</p></div>`;
  }
}

function explorePostHTML(p) {
  return `
    <div class="explore-post-card" data-user="${escapeHtml(p.username)}">
      <div class="explore-post-head">
        <div class="avatar-sm">${avatarInner(p.display_name, p.profile_pic)}</div>
        <div class="explore-post-name">${escapeHtml(p.display_name)}</div>
      </div>
      <div class="explore-post-content">${linkifyHashtags(p.content)}</div>
      <div class="explore-post-footer">
        <span class="${p.liked ? "liked" : ""}">
          <i class="${p.liked ? "fa-solid" : "fa-regular"} fa-heart"></i> ${p.likes}
        </span>
        <span><i class="fa-regular fa-comment"></i> ${p.comments}</span>
      </div>
    </div>
  `;
}

// Load suggested users
async function loadSuggestedUsers() {
  const el = document.getElementById("explore-users");
  if (!el) return;
  try {
    const users = await api("/api/explore/suggested-users");
    if (!users.length) {
      el.innerHTML = `<div class="explore-empty">
        <i class="fa-solid fa-user-plus"></i>
        <p>আপনি সবাইকে ফলো করে ফেলেছেন! 🎉</p>
      </div>`;
      return;
    }
    el.innerHTML = `<div class="explore-section-title"><i class="fa-solid fa-user-plus"></i> যাদের ফলো করতে পারেন</div>
      <div class="explore-users-grid">${users.map(userCardHTML).join("")}</div>`;

    el.querySelectorAll(".explore-user-card").forEach((card) => {
      const username = card.dataset.username;
      card.querySelector(".explore-user-avatar").addEventListener("click", () => openProfile(username));
      card.querySelector(".explore-user-name").addEventListener("click", () => openProfile(username));
      card.querySelector(".explore-user-follow").addEventListener("click", async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const res = await api("/api/users/" + encodeURIComponent(username) + "/follow", {
            method: "POST",
          });
          btn.classList.toggle("following", res.is_following);
          btn.innerHTML = res.is_following
            ? '<i class="fa-solid fa-check"></i> ফলো করছেন'
            : '<i class="fa-solid fa-user-plus"></i> ফলো করুন';
          showToast(res.is_following ? "✅ ফলো করা হয়েছে" : "আনফলো করা হয়েছে");
        } catch (err) {
          alert(err.message);
        } finally {
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="explore-empty"><p>লোড করা যায়নি</p></div>`;
  }
}

function userCardHTML(u) {
  return `
    <div class="explore-user-card" data-username="${escapeHtml(u.username)}">
      <div class="explore-user-avatar">${avatarInner(u.display_name, u.profile_pic)}</div>
      <div class="explore-user-name">${escapeHtml(u.display_name)}</div>
      <div class="explore-user-username">@${escapeHtml(u.username)}</div>
      <div class="explore-user-stats">
        <span><strong>${u.followers || 0}</strong> ফলোয়ার</span>
        <span><strong>${u.posts_count || 0}</strong> পোস্ট</span>
      </div>
      <button class="explore-user-follow">
        <i class="fa-solid fa-user-plus"></i> ফলো করুন
      </button>
    </div>
  `;
}

// Hashtag page
async function openHashtag(tag) {
  const page = document.getElementById("hashtag-page");
  if (!page) return;
  page.classList.remove("hidden");
  document.getElementById("hashtag-title").textContent = "#" + tag;
  const info = document.getElementById("hashtag-info");
  const postsEl = document.getElementById("hashtag-posts");
  info.innerHTML = `<p style="color:var(--muted)">লোড হচ্ছে...</p>`;
  postsEl.innerHTML = "";

  try {
    const data = await api("/api/hashtag/" + encodeURIComponent(tag));
    info.innerHTML = `
      <div class="hashtag-icon">#</div>
      <div class="hashtag-details">
        <h2>${escapeHtml(data.tag)}</h2>
        <p>${data.count} পোস্ট</p>
      </div>
    `;
    if (!data.posts.length) {
      postsEl.innerHTML = `<div class="explore-empty"><p>এই হ্যাশট্যাগে কোনো পোস্ট নেই।</p></div>`;
      return;
    }
    postsEl.innerHTML = `<div class="explore-section-title"><i class="fa-solid fa-hashtag"></i> পোস্টগুলো</div>` +
      `<div class="explore-posts-grid">${data.posts.map(explorePostHTML).join("")}</div>`;
    attachHashtagListeners(postsEl);
    postsEl.querySelectorAll(".explore-post-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.classList.contains("hashtag-link")) return;
        openProfile(card.dataset.user);
      });
    });
  } catch (err) {
    info.innerHTML = `<p style="color:var(--danger)">লোড করা যায়নি</p>`;
  }
}

// Hook loadFeed to attach hashtag listeners after render
const _origBindPostEvents = bindPostEvents;
bindPostEvents = function() {
  _origBindPostEvents();
  attachHashtagListeners(document.getElementById("feed-list"));
};


// ==================================================
// PAGE STACK + HARDWARE BACK BUTTON HANDLER
// ==================================================

const _PageStack = [];
let _historyBooted = false;
let _lastBackPress = 0;

function _initHistoryOnce() {
  if (_historyBooted) return;
  _historyBooted = true;
  // Base state — so we have something to "stay on"
  history.replaceState({ page: "home" }, "", window.location.pathname);
}

function _pushPage(name) {
  _initHistoryOnce();
  _PageStack.push(name);
  history.pushState({ page: name }, "", "");
}

function _closeTopPage() {
  const top = _PageStack.pop();
  if (!top) return false;

  if (top === "profile") {
    const el = document.getElementById("profile-page");
    if (el) el.classList.add("hidden");
  } else if (top === "messages") {
    if (typeof stopChatPolling === "function") stopChatPolling();
    const el = document.getElementById("messages-page");
    if (el) el.classList.add("hidden");
  } else if (top === "explore") {
    const el = document.getElementById("explore-page");
    if (el) el.classList.add("hidden");
  } else if (top === "hashtag") {
    const el = document.getElementById("hashtag-page");
    if (el) el.classList.add("hidden");
  } else if (top === "story-viewer") {
    if (typeof closeStoryViewer === "function") closeStoryViewer();
  } else if (top === "chat") {
    if (typeof stopChatPolling === "function") stopChatPolling();
    var _cw = document.getElementById("chat-window");
    if (_cw) _cw.classList.add("hidden");
    document.body.classList.remove("messages-chat-open");   // restore topbar
    if (typeof currentChatUser !== "undefined") currentChatUser = null;
    if (typeof lastMsgCount !== "undefined") lastMsgCount = 0;
    if (typeof loadConversations === "function") loadConversations();
    if (typeof _updateOverlayClass === "function") _updateOverlayClass();
  }
  return true;
}

// Handle hardware back button + browser back
let _lastPopstateAt = 0;
window.addEventListener("popstate", (e) => {
  // Dedupe: some Android browsers fire popstate twice for one back press
  const _now = Date.now();
  if (_now - _lastPopstateAt < 150) return;
  _lastPopstateAt = _now;

  // If there is an open page, close it
  if (_PageStack.length > 0) {
    _closeTopPage();
    return;
  }

  // Nothing on the stack — user is trying to exit from home
  if (state.me) {
    const now = Date.now();
    if (now - _lastBackPress < 2000) {
      // Second press within 2s — let them exit
      // Do nothing, browser will exit
      return;
    }
    _lastBackPress = now;
    // Push state again so we stay in the app
    history.pushState({ page: "home" }, "", "");
    showToast("আবার back চাপলে অ্যাপ থেকে বের হবেন");
  }
});

// ---------- Wire internal back buttons to history.back() ----------

function _rebindBackButton(id) {
  const old = document.getElementById(id);
  if (!old) return;
  const fresh = old.cloneNode(true);
  old.parentNode.replaceChild(fresh, old);
  fresh.addEventListener("click", () => {
    if (_PageStack.length > 0) {
      history.back();
    } else {
      // Fallback: manually close
      if (id === "profile-back") document.getElementById("profile-page")?.classList.add("hidden");
      if (id === "explore-back") document.getElementById("explore-page")?.classList.add("hidden");
      if (id === "hashtag-back") document.getElementById("hashtag-page")?.classList.add("hidden");
      if (id === "messages-back") document.getElementById("messages-page")?.classList.add("hidden");
    }
  });
}

_rebindBackButton("profile-back");
_rebindBackButton("explore-back");
_rebindBackButton("hashtag-back");
_rebindBackButton("messages-back");
_rebindBackButton("chat-close");
_rebindBackButton("sv-close");

// ---------- Wrap open functions to push stack ----------

// openProfile
const _origOpenProfile_stack = openProfile;
openProfile = async function (username) {
  await _origOpenProfile_stack(username);
  const page = document.getElementById("profile-page");
  if (page && !page.classList.contains("hidden")) {
    _pushPage("profile");
  }
};

// openMessagesPage
const _origOpenMessagesPage_stack = openMessagesPage;
openMessagesPage = async function () {
  await _origOpenMessagesPage_stack();
  const page = document.getElementById("messages-page");
  if (page && !page.classList.contains("hidden")) {
    _pushPage("messages");
  }
};

// openExplorePage
const _origOpenExplorePage_stack = openExplorePage;
openExplorePage = async function () {
  await _origOpenExplorePage_stack();
  const page = document.getElementById("explore-page");
  if (page && !page.classList.contains("hidden")) {
    _pushPage("explore");
  }
};

// openHashtag
const _origOpenHashtag_stack = openHashtag;
openHashtag = async function (tag) {
  await _origOpenHashtag_stack(tag);
  const page = document.getElementById("hashtag-page");
  if (page && !page.classList.contains("hidden")) {
    _pushPage("hashtag");
  }
};

// openStoryViewer
const _origOpenStoryViewer_stack = openStoryViewer;
openStoryViewer = async function (groupIdx, storyIdx) {
  await _origOpenStoryViewer_stack(groupIdx, storyIdx);
  const viewer = document.getElementById("story-viewer");
  if (viewer && !viewer.classList.contains("hidden")) {
    _pushPage("story-viewer");
  }
};

// ---------- Initialize on app entry ----------

_enterAppHooks.push(() => {
  _initHistoryOnce();
  _PageStack.length = 0; // reset on login
});


// ==================================================
// SAVED PAGE
// ==================================================

async function openSavedPage() {
  const page = document.getElementById("saved-page");
  if (!page) return;
  page.classList.remove("hidden");
  const list = document.getElementById("saved-list");
  list.innerHTML = `<p style="text-align:center;color:var(--muted);padding:40px 20px">লোড হচ্ছে...</p>`;

  try {
    const posts = await api("/api/saves");
    if (!posts.length) {
      list.innerHTML = `<div class="explore-empty">
        <i class="fa-regular fa-bookmark"></i>
        <p>এখনো কোনো পোস্ট সেভ করেননি।<br>পোস্টের নিচে <strong>সেভ</strong> বাটনে চাপ দিন!</p>
      </div>`;
      return;
    }
    list.innerHTML = posts.map(postHTML).join("");
    bindPostEvents();
    attachHashtagListeners(list);
  } catch (err) {
    list.innerHTML = `<div class="explore-empty"><p>লোড করা যায়নি</p></div>`;
  }
}

const savedBackBtn = document.getElementById("saved-back");
if (savedBackBtn) {
  const fresh = savedBackBtn.cloneNode(true);
  savedBackBtn.parentNode.replaceChild(fresh, savedBackBtn);
  fresh.addEventListener("click", () => {
    if (_PageStack.length > 0) history.back();
    else document.getElementById("saved-page")?.classList.add("hidden");
  });
}

// Wrap openSavedPage to push stack
const _origOpenSavedPage = openSavedPage;
openSavedPage = async function () {
  await _origOpenSavedPage();
  const page = document.getElementById("saved-page");
  if (page && !page.classList.contains("hidden")) {
    _pushPage("saved");
  }
};

// Extend _closeTopPage to handle saved
const _origCloseTopPage = _closeTopPage;
_closeTopPage = function () {
  const top = _PageStack[_PageStack.length - 1];
  if (top === "saved") {
    _PageStack.pop();
    document.getElementById("saved-page")?.classList.add("hidden");
    return true;
  }
  return _origCloseTopPage();
};


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
    var res = await api("/api/users/" + encodeURIComponent(username) + "/follow", {
      method: "POST",
    });
    if (res.is_following) {
      btn.classList.add("following");
      btn.innerHTML = '<i class="fa-solid fa-check"></i> ফলো করছেন';
      if (typeof showToast === "function") showToast("✅ ফলো করা হয়েছে");
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


// ==================================================
// REELS SYSTEM — TikTok-style
// ==================================================

let _reelsData = [];
let _currentReelIdx = 0;
let _reelObserver = null;
let _currentCommentReelId = null;

// ---------- Open Reels page ----------

async function openReelsPage() {
  const page = document.getElementById("reels-page");
  if (!page) return;
  page.classList.remove("hidden");
  // S21.3f — hide bottom nav while reels open (fullscreen)
  document.body.classList.add("reels-active");
  await loadReels();
  _pushPage("reels");
}

// ---------- Load all reels ----------

async function loadReels() {
  console.log("[REELS] loadReels() called");
  const feed = document.getElementById("reels-feed");
  const empty = document.getElementById("reels-empty");
  console.log("[REELS] feed=", !!feed, "empty=", !!empty);
  if (!feed || !empty) {
    console.error("[REELS] feed or empty element MISSING");
    return;
  }

  feed.innerHTML = '<div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:inherit;background:#000">' +
    '<div style="font-size:28px;margin-bottom:8px"><i class="fa-solid fa-spinner fa-spin"></i></div>' +
    '<div style="font-size:14px">লোড হচ্ছে...</div>' +
    '<div style="font-size:11px;opacity:0.5;margin-top:8px">API: /api/reels</div>' +
  '</div>';

  try {
    console.log("[REELS] fetching /api/reels ...");
    const reels = await api("/api/reels");
    console.log("[REELS] got", reels ? reels.length : 0, "reels");
    _reelsData = reels;

    if (!reels.length) {
      feed.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    feed.innerHTML = reels.map((r, i) => reelHTML(r, i)).join("");
    attachReelListeners();
    // S21.3e — attach progress to each video (guarded)
    feed.querySelectorAll(".reel-item").forEach(function (item) {
      var video = item.querySelector(".reel-video");
      if (video && typeof _attachReelProgress === "function") {
        try { _attachReelProgress(video, item); } catch (e) { console.warn("[REELS] progress attach:", e); }
      }
    });

    // Auto-play first reel
    setTimeout(() => {
      const firstVideo = feed.querySelector(".reel-video");
      if (firstVideo) firstVideo.play().catch(() => {});
    }, 400);

    // Setup intersection observer for auto-play
    setupReelObserver();
  } catch (err) {
    console.error("[REELS] load failed:", err, err && err.message, err && err.stack);
    var errMsg = (err && err.message) ? err.message : "unknown error";
    var errStack = (err && err.stack) ? err.stack : "";
    var fullErr = (err && String(err)) ? String(err) : "";
    feed.innerHTML = '<div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center;padding:24px;font-family:inherit;background:#000;overflow:auto">' +
      '<div style="font-size:22px;font-weight:800;margin-bottom:16px">রিল লোড করা যায়নি</div>' +
      '<div style="color:#ff8e8e;font-size:14px;margin-bottom:12px;max-width:90%;word-break:break-all">Error: ' + errMsg + '</div>' +
      '<div style="color:#ffb3b3;font-size:11px;max-width:90%;word-break:break-all;background:rgba(255,107,107,0.15);padding:12px;border-radius:8px;text-align:left;white-space:pre-wrap">' + errStack.slice(0, 500) + '</div>' +
      '<div style="color:#ffb3b3;font-size:11px;margin-top:12px;max-width:90%">Full: ' + fullErr.slice(0, 200) + '</div>' +
    '</div>';
  }
}

// ---------- Reel item HTML ----------

function reelHTML(r, idx) {
  const isOwn = state.me && state.me.username === r.username;
  const avatar = r.profile_pic
    ? `<img src="${escapeHtml(r.profile_pic)}" alt="" loading="lazy" decoding="async">`
    : initial(r.display_name);

  return `
    <div class="reel-item" data-idx="${idx}" data-id="${r.id}" data-user="${escapeHtml(r.username)}" data-own="${isOwn ? "1" : "0"}" data-saved="${r.is_saved ? "1" : "0"}">
      <video class="reel-video" src="${r.video}" loop playsinline preload="metadata" muted></video>

      <div class="reel-progress"><div class="reel-progress-fill"></div></div>

      <div class="reel-play-indicator">
        <i class="fa-solid fa-play"></i>
      </div>

      <div class="reel-flash"></div>
      <div class="reel-heart-ring"></div>
      <div class="reel-heart-burst">
        <i class="fa-solid fa-heart"></i>
      </div>

      <div class="reel-overlay">
        <div class="reel-user-row">
          <div class="reel-user-avatar">${avatar}</div>
          <div class="reel-user-info">
            <div class="reel-username">${escapeHtml(r.display_name)}</div>
            <div class="reel-time">${timeAgo(r.created_at)}</div>
          </div>
        </div>
        ${r.caption ? `<div class="reel-caption">${linkifyHashtags(r.caption)}</div>` : ""}
      </div>

      <div class="reel-side-rail">
        <button class="reel-toggle-actions" title="বাটন লুকান / দেখান" type="button">
          <i class="fa-solid fa-chevron-up"></i>
        </button>
        <div class="reel-actions">
          <button class="reel-action like-btn ${r.liked ? "liked" : ""}"
                  data-liked="${r.liked ? "1" : "0"}" type="button">
            <div class="reel-action-icon">
              <i class="${r.liked ? "fa-solid" : "fa-regular"} fa-heart"></i>
            </div>
            <span class="reel-action-label like-count">${r.likes}</span>
          </button>

          <button class="reel-action comment-btn" type="button">
            <div class="reel-action-icon">
              <i class="fa-regular fa-comment"></i>
            </div>
            <span class="reel-action-label">${r.comments}</span>
          </button>

          <button class="reel-action share-btn" type="button">
            <div class="reel-action-icon">
              <i class="fa-solid fa-share"></i>
            </div>
            <span class="reel-action-label">শেয়ার</span>
          </button>

          <button class="reel-action more-btn" title="আরও" type="button">
            <div class="reel-action-icon">
              <i class="fa-solid fa-ellipsis-vertical"></i>
            </div>
            <span class="reel-action-label">আরও</span>
          </button>
        </div>
      </div>
    </div>
  `;
}


// ---------- Reel toggle button (show/hide actions) ----------
document.addEventListener("click", function (e) {
  const btn = e.target.closest(".reel-toggle-actions");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const item = btn.closest(".reel-item");
  if (!item) return;
  item.classList.toggle("ui-hidden");
  if (navigator.vibrate) navigator.vibrate(8);
}, true);


// ---------- Premium double-tap heart effect ----------
function playReelHeart(item) {
  const burst = item.querySelector(".reel-heart-burst");
  const ring = item.querySelector(".reel-heart-ring");
  const flash = item.querySelector(".reel-flash");

  // Reset & play main heart
  if (burst) {
    burst.classList.remove("pop");
    void burst.offsetWidth;
    burst.classList.add("pop");
  }

  // Ring pulse
  if (ring) {
    ring.classList.remove("pop");
    void ring.offsetWidth;
    ring.classList.add("pop");
  }

  // Subtle screen flash
  if (flash) {
    flash.classList.remove("pop");
    void flash.offsetWidth;
    flash.classList.add("pop");
  }

  // Floating mini-hearts
  const flyCount = 6;
  for (let i = 0; i < flyCount; i++) {
    const fly = document.createElement("div");
    fly.className = "reel-heart-fly";
    fly.textContent = "❤️";

    // Start near center, slightly offset
    const startX = 50 + (Math.random() - 0.5) * 20;
    const startY = 50 + (Math.random() - 0.5) * 15;
    fly.style.left = startX + "%";
    fly.style.top = startY + "%";

    // End offset — spread outward + upward
    const angle = (-90 + (i - flyCount / 2) * 22) * (Math.PI / 180);
    const distance = 90 + Math.random() * 60;
    const fx = Math.cos(angle) * distance;
    const fy = Math.sin(angle) * distance - 40; // bias upward
    fly.style.setProperty("--fx", fx + "px");
    fly.style.setProperty("--fy", fy + "px");

    // Random delay + size
    fly.style.fontSize = (18 + Math.random() * 12) + "px";
    fly.style.animationDelay = (i * 45) + "ms";

    item.appendChild(fly);
    setTimeout(() => fly.remove(), 1800);
  }

  // Bump like icon + count
  item.classList.add("double-tapped");
  setTimeout(() => item.classList.remove("double-tapped"), 600);

  // Haptics
  if (navigator.vibrate) navigator.vibrate([12, 30, 12]);
}

// ---------- Reel more-menu (bottom sheet) ----------
function openReelMoreMenu(item) {
  const reelId = item.dataset.id;
  const isOwn = item.dataset.own === "1";
  const isSaved = item.dataset.saved === "1";
  const video = item.querySelector(".reel-video");
  const isMuted = video ? video.muted : true;

  const old = document.getElementById("reel-more-menu");
  if (old) old.remove();

  const menu = document.createElement("div");
  menu.id = "reel-more-menu";
  menu.className = "reel-more-menu";
  menu.innerHTML = `
    <div class="rmm-backdrop"></div>
    <div class="rmm-panel">
      <div class="rmm-handle"></div>
      <button class="rmm-item" data-act="mute">
        <i class="fa-solid ${isMuted ? "fa-volume-xmark" : "fa-volume-high"}"></i>
        <span>${isMuted ? "সাউন্ড চালু করুন" : "মিউট করুন"}</span>
      </button>
      <button class="rmm-item" data-act="save">
        <i class="${isSaved ? "fa-solid" : "fa-regular"} fa-bookmark"></i>
        <span>${isSaved ? "সেভ সরান" : "সেভ করুন"}</span>
      </button>
      <button class="rmm-item" data-act="copy">
        <i class="fa-solid fa-link"></i>
        <span>লিংক কপি করুন</span>
      </button>
      ${isOwn ? `
        <button class="rmm-item danger" data-act="delete">
          <i class="fa-regular fa-trash-can"></i>
          <span>রিল মুছুন</span>
        </button>
      ` : ""}
    </div>
  `;
  document.body.appendChild(menu);
  requestAnimationFrame(function () { menu.classList.add("show"); });

  function close() {
    menu.classList.remove("show");
    setTimeout(function () { menu.remove(); }, 260);
  }

  menu.querySelector(".rmm-backdrop").addEventListener("click", close);

  menu.querySelectorAll(".rmm-item").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      const act = btn.dataset.act;
      close();

      if (act === "mute") {
        if (video) {
          video.muted = !video.muted;
          showToast(video.muted ? "🔇 মিউট" : "🔊 সাউন্ড চালু");
        }
      } else if (act === "save") {
        try {
          const res = await api("/api/reels/" + reelId + "/save", { method: "POST" });
          item.dataset.saved = res.saved ? "1" : "0";
          showToast(res.saved ? "🔖 সেভ হয়েছে" : "সেভ সরানো হয়েছে");
        } catch (err) { alert(err.message); }
      } else if (act === "edit") {
        _openEditMessageModal(msgId, msgEl, text);
      } else if (act === "copy") {
        const url = window.location.origin + "/reel/" + reelId;
        try {
          await navigator.clipboard.writeText(url);
          showToast("🔗 লিংক কপি হয়েছে");
        } catch (err) {
          showToast("লিংক কপি করা যায়নি");
        }
      } else if (act === "delete") {
        if (!confirm("রিলটা মুছে ফেলবেন?")) return;
        try {
          await api("/api/reels/" + reelId, { method: "DELETE" });
          showToast("🗑️ রিল মুছে ফেলা হয়েছে");
          loadReels();
        } catch (err) { alert(err.message); }
      }
    });
  });
}

document.addEventListener("click", function (e) {
  const btn = e.target.closest(".reel-more-btn, .reel-action.more-btn");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const item = btn.closest(".reel-item");
  if (!item) return;
  openReelMoreMenu(item);
}, true);

// ---------- Attach events to each reel ----------

function attachReelListeners() {
  document.querySelectorAll(".reel-item").forEach((item) => {
    const id = item.dataset.id;
    const video = item.querySelector(".reel-video");
    const indicator = item.querySelector(".reel-play-indicator");
    const burst = item.querySelector(".reel-heart-burst");

    // Unified tap: single = pause/play, double = like
    let lastTap = 0;
    let tapTimeout = null;
    item.addEventListener("click", function (e) {
      if (e.target.closest(".reel-actions")) return;
      if (e.target.closest(".reel-side-rail")) return;
      if (e.target.closest(".reel-overlay")) return;

      const now = Date.now();
      const isDouble = (now - lastTap < 300);
      lastTap = now;

      if (isDouble) {
        if (tapTimeout) { clearTimeout(tapTimeout); tapTimeout = null; }
        const likeBtn = item.querySelector(".like-btn");
        if (likeBtn && likeBtn.dataset.liked !== "1") {
          likeBtn.click();
        }
        playReelHeart(item);
      } else {
        if (tapTimeout) clearTimeout(tapTimeout);
        tapTimeout = setTimeout(function () {
          togglePlayPause(video, indicator);
          tapTimeout = null;
        }, 280);
      }
    });

    // Like button
    const likeBtn = item.querySelector(".like-btn");
    if (likeBtn) {
      likeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const wasLiked = likeBtn.dataset.liked === "1";
        const nowLiked = !wasLiked;
        likeBtn.dataset.liked = nowLiked ? "1" : "0";
        likeBtn.classList.toggle("liked", nowLiked);
        const icon = likeBtn.querySelector(".reel-action-icon i");
        icon.className = `${nowLiked ? "fa-solid" : "fa-regular"} fa-heart`;
        const countEl = likeBtn.querySelector(".like-count");
        const newCount = parseInt(countEl.textContent) + (nowLiked ? 1 : -1);
        countEl.textContent = newCount;

        try {
          const res = await api(`/api/reels/${id}/like`, { method: "POST" });
          countEl.textContent = res.likes;
        } catch (err) {
          // Rollback
          likeBtn.dataset.liked = wasLiked ? "1" : "0";
          likeBtn.classList.toggle("liked", wasLiked);
          icon.className = `${wasLiked ? "fa-solid" : "fa-regular"} fa-heart`;
          countEl.textContent = parseInt(countEl.textContent) + (nowLiked ? -1 : 1);
        }
      });
    }

    // Comment button
    const commentBtn = item.querySelector(".comment-btn");
    if (commentBtn) {
      commentBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openReelComments(id);
      });
    }

    // Share button
    const shareBtn = item.querySelector(".share-btn");
    if (shareBtn) {
      shareBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const reel = _reelsData.find((r) => String(r.id) === String(id));
        if (!reel) return;
        const text = `${reel.display_name} এর রিল দেখুন — JUKTOY`;

        try {
          if (navigator.share) {
            await navigator.share({ title: "JUKTOY Reel", text });
          } else {
            await navigator.clipboard.writeText(text);
            showToast("📋 কপি করা হয়েছে");
          }
        } catch (err) {}
      });
    }

    // Delete (own reels)
    const delBtn = item.querySelector(".reel-delete");
    if (delBtn) {
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("রিলটা মুছে ফেলবেন?")) return;
        try {
          await api(`/api/reels/${id}`, { method: "DELETE" });
          showToast("🗑️ রিল মুছে ফেলা হয়েছে");
          loadReels();
        } catch (err) {
          alert(err.message);
        }
      });
    }

    // User avatar / name click
    item.querySelector(".reel-user-avatar").addEventListener("click", (e) => {
      e.stopPropagation();
      const username = item.dataset.user;
      closeReelsPage();
      setTimeout(() => openProfile(username), 200);
    });
    item.querySelector(".reel-username").addEventListener("click", (e) => {
      e.stopPropagation();
      const username = item.dataset.user;
      closeReelsPage();
      setTimeout(() => openProfile(username), 200);
    });

    // Hashtag links in caption
    attachHashtagListeners(item.querySelector(".reel-caption"));

    // Caption expand on click
    const caption = item.querySelector(".reel-caption");
    if (caption) {
      caption.addEventListener("click", (e) => {
        if (e.target.closest(".hashtag-link")) return;
        caption.classList.toggle("expanded");
      });
    }
  });

  // Observer for auto-play/pause
  setupReelObserver();
}

// ---------- Play/Pause ----------

function togglePlayPause(video, indicator) {
  if (video.paused) {
    video.play().catch(() => {});
    if (indicator) {
      indicator.querySelector("i").className = "fa-solid fa-play";
      indicator.classList.remove("show");
      void indicator.offsetWidth;
      indicator.classList.add("show");
    }
  } else {
    video.pause();
    if (indicator) {
      indicator.querySelector("i").className = "fa-solid fa-pause";
      indicator.classList.remove("show");
      void indicator.offsetWidth;
      indicator.classList.add("show");
    }
  }
}

// ---------- Intersection Observer: auto-play visible reel ----------

function setupReelObserver() {
  if (_reelObserver) _reelObserver.disconnect();

  const feed = document.getElementById("reels-feed");
  if (!feed) return;

  // S30.7 - track when each video left the viewport so we only reset
  // currentTime if it was gone for a while (was: reset on every partial scroll).
  var _outSince = {};

  _reelObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target.querySelector(".reel-video");
        if (!video) return;
        var idxKey = entry.target.dataset.idx;

        if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
          _currentReelIdx = parseInt(idxKey);
          // came back into view — clear the "out" marker
          delete _outSince[idxKey];

          video.muted = false;
          video.play().catch(() => {
            // S30.7 - autoplay blocked → mute and sync button state
            video.muted = true;
            video.play().catch(() => {});
            // sync mute button if present
            const item = video.closest(".reel-item");
            const muteBtn = item && item.querySelector(".reel-mute");
            if (muteBtn) {
              muteBtn.dataset.muted = "1";
              const mi = muteBtn.querySelector("i");
              if (mi) mi.className = "fa-solid fa-volume-xmark";
            }
          });
        } else {
          video.pause();
          // S30.7 - don't reset currentTime immediately.
          // Only reset if the video stays out of view for >1.5s.
          if (!_outSince[idxKey]) {
            _outSince[idxKey] = Date.now();
            setTimeout(function () {
              // still out of view after timeout? then reset
              if (_outSince[idxKey] &&
                  (Date.now() - _outSince[idxKey]) >= 1400) {
                // check if still not visible
                var r = entry.target.getBoundingClientRect();
                var h = window.innerHeight || 0;
                var visible = Math.max(0, Math.min(r.bottom, h) - Math.max(r.top, 0));
                var ratio = visible / Math.max(1, r.height);
                if (ratio < 0.5) {
                  try { video.currentTime = 0; } catch (e) {}
                }
                delete _outSince[idxKey];
              }
            }, 1500);
          }
        }
      });
    },
    {
      root: feed,
      threshold: [0, 0.6, 1],
    }
  );

  document.querySelectorAll(".reel-item").forEach((item) => {
    _reelObserver.observe(item);
  });
}

// ---------- Close Reels page ----------

function closeReelsPage() {
  // Pause all videos
  document.querySelectorAll(".reel-video").forEach((v) => {
    v.pause();
  });
  if (_reelObserver) _reelObserver.disconnect();
  const page = document.getElementById("reels-page");
  if (page) page.classList.add("hidden");
  // S21.3f — show bottom nav again
  document.body.classList.remove("reels-active");
}

// ---------- Reel Comments Sheet ----------

async function openReelComments(reelId) {
  _currentCommentReelId = reelId;
  const sheet = document.getElementById("reel-comments-sheet");
  if (!sheet) return;
  sheet.classList.remove("hidden");
  await loadReelComments(reelId);
}

async function loadReelComments(reelId) {
  const list = document.getElementById("rcs-list");
  if (!list) return;
  list.innerHTML = `<p style="text-align:center;color:var(--muted);padding:20px">লোড হচ্ছে...</p>`;

  try {
    const comments = await api(`/api/reels/${reelId}/comments`);
    if (!comments.length) {
      list.innerHTML = `<div class="rcs-empty">
        এখনো কোনো মন্তব্য নেই।<br>প্রথম মন্তব্যটি আপনিই করুন!
      </div>`;
      return;
    }
    list.innerHTML = comments.map((c) => `
      <div class="comment">
        ${avatarHTML(c.display_name, c.profile_pic, "avatar")}
        <div class="comment-body">
          <div class="cname">${escapeHtml(c.display_name)}</div>
          <div class="ctext">${escapeHtml(c.content)}</div>
        </div>
      </div>
    `).join("");
  } catch (err) {
    list.innerHTML = `<div class="rcs-empty">লোড করা যায়নি</div>`;
  }
}

// Comment form
const rcsForm = document.getElementById("rcs-form");
if (rcsForm) {
  rcsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("rcs-input");
    const content = input.value.trim();
    if (!content || !_currentCommentReelId) return;

    const sendBtn = rcsForm.querySelector(".rcs-send");
    sendBtn.disabled = true;
    try {
      await api(`/api/reels/${_currentCommentReelId}/comments`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      input.value = "";
      await loadReelComments(_currentCommentReelId);
      // Update comment count in reel item
      const item = document.querySelector(`.reel-item[data-id="${_currentCommentReelId}"]`);
      if (item) {
        const countEl = item.querySelector(".comment-btn .reel-action-label");
        if (countEl) countEl.textContent = parseInt(countEl.textContent) + 1;
      }
    } catch (err) {
      alert(err.message);
    } finally {
      sendBtn.disabled = false;
    }
  });
}

// Close comment sheet
document.querySelector("#reel-comments-sheet .rcs-backdrop")?.addEventListener("click", () => {
  document.getElementById("reel-comments-sheet").classList.add("hidden");
  _currentCommentReelId = null;
});

// ---------- Reel Upload ----------

let _pendingReelVideo = null;

const reelFileInput = document.getElementById("reel-file-input");
const reelUploadEmpty = document.getElementById("reel-upload-empty");
const reelUploadPreview = document.getElementById("reel-upload-preview");
const reelPreviewVideo = document.getElementById("reel-preview-video");
const publishReelBtn = document.getElementById("publish-reel");
const reelUploadModal = document.getElementById("reel-upload-modal");

document.getElementById("btn-choose-reel")?.addEventListener("click", () => reelFileInput?.click());
document.getElementById("reels-upload-btn")?.addEventListener("click", openReelUpload);
document.getElementById("reels-empty-upload")?.addEventListener("click", openReelUpload);

function openReelUpload() {
  resetReelUpload();
  reelUploadModal.classList.remove("hidden");
}

if (reelFileInput) {
  reelFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      alert("শুধু ভিডিও আপলোড করা যাবে");
      return;
    }
    if (file.size > 5_500_000) {
      alert("ভিডিও ৫ MB এর কম হতে হবে");
      return;
    }
    try {
      const dataUri = await readFileAsDataURL(file);
      _pendingReelVideo = dataUri;
      reelPreviewVideo.src = dataUri;
      reelUploadEmpty.classList.add("hidden");
      reelUploadPreview.classList.remove("hidden");
      publishReelBtn.disabled = false;
    } catch (err) {
      alert("ভিডিও লোড করা যায়নি");
    }
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById("cancel-reel-upload")?.addEventListener("click", resetReelUpload);
document.getElementById("close-reel-upload")?.addEventListener("click", resetReelUpload);
reelUploadModal?.addEventListener("click", (e) => {
  if (e.target === reelUploadModal) resetReelUpload();
});

function resetReelUpload() {
  _pendingReelVideo = null;
  if (reelFileInput) reelFileInput.value = "";
  if (reelUploadEmpty) reelUploadEmpty.classList.remove("hidden");
  if (reelUploadPreview) reelUploadPreview.classList.add("hidden");
  if (reelPreviewVideo) {
    reelPreviewVideo.pause();
    reelPreviewVideo.src = "";
  }
  const cap = document.getElementById("reel-caption");
  if (cap) cap.value = "";
  if (publishReelBtn) {
    publishReelBtn.disabled = true;
    publishReelBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> পোস্ট করুন';
  }
  if (reelUploadModal) reelUploadModal.classList.add("hidden");
}

if (publishReelBtn) {
  publishReelBtn.addEventListener("click", async () => {
    if (!_pendingReelVideo) return;
    const caption = (document.getElementById("reel-caption").value || "").trim();
    publishReelBtn.disabled = true;
    publishReelBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> পোস্ট হচ্ছে...`;

    try {
      await api("/api/reels", {
        method: "POST",
        body: JSON.stringify({ video: _pendingReelVideo, caption }),
      });
      resetReelUpload();
      showToast("🎬 রিল পোস্ট হয়েছে!");
      await loadReels();
    } catch (err) {
      alert(err.message);
      publishReelBtn.disabled = false;
      publishReelBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> পোস্ট করুন`;
    }
  });
}

// ---------- Wire bottom nav "reel" button ----------

// Remove existing listener by cloning
document.querySelectorAll('.mbn-item[data-mbn="reel"]').forEach((btn) => {
  const fresh = btn.cloneNode(true);
  btn.parentNode.replaceChild(fresh, btn);
  fresh.addEventListener("click", () => {
    document.querySelectorAll(".mbn-item").forEach((b) => b.classList.remove("active"));
    fresh.classList.add("active");
    openReelsPage();
  });
});

// ---------- Back button ----------

const reelsBackBtn = document.getElementById("reels-back");
if (reelsBackBtn) {
  reelsBackBtn.addEventListener("click", () => {
    if (_PageStack.length > 0 && _PageStack[_PageStack.length - 1] === "reels") {
      history.back();
    } else {
      closeReelsPage();
    }
  });
}

// ---------- Extend page stack close for reels ----------

const _origCloseTopPage3 = _closeTopPage;
_closeTopPage = function () {
  const top = _PageStack[_PageStack.length - 1];
  if (top === "reels") {
    _PageStack.pop();
    closeReelsPage();
    return true;
  }
  return _origCloseTopPage3();
};

// Escape key to close reels
document.addEventListener("keydown", (e) => {
  const reelsPage = document.getElementById("reels-page");
  if (e.key === "Escape" && reelsPage && !reelsPage.classList.contains("hidden")) {
    closeReelsPage();
  }
});


// ==================================================
// MULTI-IMAGE COMPOSER + CAROUSEL
// ==================================================

// ---------- Composer: image management ----------

let _pendingImages = []; // array of data URI strings
const MAX_IMAGES = 10;

const imagePreviewGrid = document.getElementById("image-preview-grid");
const imageFileInput = document.getElementById("image-file-input");
const btnPickImages = document.getElementById("btn-pick-images");

if (btnPickImages) {
  btnPickImages.addEventListener("click", (e) => {
    e.preventDefault();
    if (imageFileInput) imageFileInput.click();
  });
}

if (imageFileInput) {
  imageFileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files) {
      if (_pendingImages.length >= MAX_IMAGES) {
        showToast(`সর্বোচ্চ ${MAX_IMAGES}টি ছবি`);
        break;
      }
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 8_000_000) {
        showToast("ছবির সাইজ ৮ MB এর নিচে হতে হবে");
        continue;
      }
      try {
        const resized = await resizeImage(file, 1200, 0.8);
        _pendingImages.push(resized);
      } catch (err) {
        console.error("Image resize failed", err);
      }
    }

    imageFileInput.value = "";
    renderImagePreviewGrid();
    updateComposerState();
  });
}

function renderImagePreviewGrid() {
  if (!imagePreviewGrid) return;

  if (!_pendingImages.length) {
    imagePreviewGrid.classList.add("hidden");
    imagePreviewGrid.innerHTML = "";
    return;
  }

  imagePreviewGrid.classList.remove("hidden");

  let html = _pendingImages.map((src, i) => `
    <div class="image-preview-item" data-idx="${i}">
      <img src="${src}" alt="" loading="lazy" decoding="async">
      <button class="image-preview-remove" data-idx="${i}" title="মুছুন">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `).join("");

  // Add "more" tile if under max
  if (_pendingImages.length < MAX_IMAGES) {
    html += `
      <div class="image-preview-add" id="image-preview-add-tile">
        <i class="fa-solid fa-plus"></i>
        <span>আরও</span>
      </div>
    `;
  }

  imagePreviewGrid.innerHTML = html;

  // Remove handlers
  imagePreviewGrid.querySelectorAll(".image-preview-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const idx = parseInt(btn.dataset.idx);
      _pendingImages.splice(idx, 1);
      renderImagePreviewGrid();
      updateComposerState();
    });
  });

  // Add more tile
  const addTile = document.getElementById("image-preview-add-tile");
  if (addTile) {
    addTile.addEventListener("click", () => imageFileInput?.click());
  }
}

function resetComposerImages() {
  _pendingImages = [];
  renderImagePreviewGrid();
}

// ---------- Override updateComposerState to consider images ----------

const _origUpdateComposerState = updateComposerState;
updateComposerState = function() {
  if (!postContent || !postBtn) return;
  postContent.style.height = "auto";
  postContent.style.height = Math.min(postContent.scrollHeight, 180) + "px";
  const hasText = postContent.value.trim().length > 0;
  const hasImages = _pendingImages.length > 0;
  const active = hasText || hasImages;
  postBtn.classList.toggle("visible", active);

  // Glow composer when something is ready
  const composer = postBtn.closest(".composer-box");
  if (composer) composer.classList.toggle("has-content", active);
};

// ---------- Override post creation handler ----------

// Remove old postBtn click handler by cloning
if (postBtn) {
  const newPostBtn = postBtn.cloneNode(true);
  postBtn.parentNode.replaceChild(newPostBtn, postBtn);
  postBtn = newPostBtn;   // S30.29 — reassign so const-holder keeps working

  newPostBtn.addEventListener("click", async () => {
    if (!postContent) return;
    const text = postContent.value.trim();
    const media = _pendingImages.slice();

    if (!text && !media.length) return;

    newPostBtn.disabled = true;
    const oldHTML = newPostBtn.innerHTML;
    newPostBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

    try {
      const res = await api("/api/posts", {
        method: "POST",
        body: JSON.stringify({ content: text, media }),
      });
      postContent.value = "";
      resetComposerImages();
      updateComposerState();
      window.__highlightNextPost = true;
      await loadFeed();
      showToast("✅ পোস্ট হয়েছে!");
    } catch (err) {
      alert(err.message);
    } finally {
      newPostBtn.disabled = false;
      newPostBtn.innerHTML = oldHTML;
    }
  });
}

// ---------- Carousel render for posts ----------

function renderCarousel(media) {
  if (!media || !media.length) return "";

  // Single image — simple
  if (media.length === 1) {
    return `
      <div class="post-carousel">
        <div class="post-carousel-track">
          <div class="post-carousel-slide">
            <img src="${escapeHtml(media[0])}" alt="" loading="lazy" decoding="async">
          </div>
        </div>
      </div>
    `;
  }

  // Multiple — full carousel
  const slides = media.map((src) => `
    <div class="post-carousel-slide">
      <img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async">
    </div>
  `).join("");

  const dots = media.map((_, i) => `
    <span class="post-carousel-dot ${i === 0 ? "active" : ""}" data-idx="${i}"></span>
  `).join("");

  return `
    <div class="post-carousel" data-current="0" data-total="${media.length}">
      <div class="post-carousel-counter">1 / ${media.length}</div>
      <div class="post-carousel-track">${slides}</div>
      <button class="post-carousel-arrow prev hidden">
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <button class="post-carousel-arrow next">
        <i class="fa-solid fa-chevron-right"></i>
      </button>
      <div class="post-carousel-dots">${dots}</div>
    </div>
  `;
}

// ---------- Carousel interactions (attach after rendering) ----------

function attachCarouselListeners(container) {
  if (!container) return;

  container.querySelectorAll(".post-carousel").forEach((carousel) => {
    const track = carousel.querySelector(".post-carousel-track");
    const total = parseInt(carousel.dataset.total);
    if (!track || total <= 1) return;

    let current = 0;
    const counter = carousel.querySelector(".post-carousel-counter");
    const dots = carousel.querySelectorAll(".post-carousel-dot");
    const prevBtn = carousel.querySelector(".post-carousel-arrow.prev");
    const nextBtn = carousel.querySelector(".post-carousel-arrow.next");

    function goTo(idx, fromSwipe = false) {
      if (idx < 0) idx = 0;
      if (idx >= total) idx = total - 1;
      current = idx;

      track.style.transition = fromSwipe ? "none" : "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
      track.style.transform = `translateX(-${current * 100}%)`;

      if (counter) counter.textContent = `${current + 1} / ${total}`;

      dots.forEach((d, i) => d.classList.toggle("active", i === current));

      if (prevBtn) prevBtn.classList.toggle("hidden", current === 0);
      if (nextBtn) nextBtn.classList.toggle("hidden", current === total - 1);

      // Fix for swipe mode: restore transition after
      if (fromSwipe) {
        requestAnimationFrame(() => {
          track.style.transition = "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
        });
      }
    }

    // Arrows
    prevBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      goTo(current - 1);
    });
    nextBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      goTo(current + 1);
    });

    // Dots
    dots.forEach((dot) => {
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        goTo(parseInt(dot.dataset.idx));
      });
    });

    // Swipe (touch + mouse)
    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let locked = false;

    function onStart(x, y) {
      startX = x;
      startY = y;
      isDragging = true;
      locked = false;
    }

    function onMove(x, y) {
      if (!isDragging) return;
      const dx = x - startX;
      const dy = y - startY;

      // Lock direction on first significant move
      if (!locked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        locked = true;
        if (Math.abs(dy) > Math.abs(dx)) {
          // Vertical scroll → cancel horizontal swipe
          isDragging = false;
          return;
        }
      }
      if (!locked) return;
      if (Math.abs(dx) < 5) return;

      // Prevent text selection
      if (Math.abs(dx) > 15) {
        const offset = -current * 100 + (dx / carousel.offsetWidth) * 100;
        track.style.transition = "none";
        track.style.transform = `translateX(${offset}%)`;
      }
    }

    function onEnd(x) {
      if (!isDragging) {
        isDragging = false;
        return;
      }
      const dx = x - startX;
      isDragging = false;
      if (!locked) return;

      const threshold = carousel.offsetWidth * 0.2;
      if (dx < -threshold && current < total - 1) {
        goTo(current + 1);
      } else if (dx > threshold && current > 0) {
        goTo(current - 1);
      } else {
        goTo(current);
      }
    }

    // Touch
    carousel.addEventListener("touchstart", (e) => {
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    carousel.addEventListener("touchmove", (e) => {
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    carousel.addEventListener("touchend", (e) => {
      onEnd(e.changedTouches[0].clientX);
    });

    // Mouse drag (desktop)
    carousel.addEventListener("mousedown", (e) => {
      e.preventDefault();
      onStart(e.clientX, e.clientY);
    });

    carousel.addEventListener("mousemove", (e) => {
      onMove(e.clientX, e.clientY);
    });

    carousel.addEventListener("mouseup", (e) => {
      onEnd(e.clientX);
    });

    carousel.addEventListener("mouseleave", (e) => {
      if (isDragging) onEnd(e.clientX);
    });

    // Prevent img drag
    carousel.querySelectorAll("img").forEach((img) => {
      img.addEventListener("dragstart", (e) => e.preventDefault());
    });
  });
}

// ---------- Hook carousel into bindPostEvents ----------

const _origBindPostEventsMulti = bindPostEvents;
bindPostEvents = function() {
  _origBindPostEventsMulti();
  attachCarouselListeners(document.getElementById("feed-list"));
};

// Also run on enterApp for initial feed
_enterAppHooks.push(() => {
  setTimeout(() => {
    attachCarouselListeners(document.getElementById("feed-list"));
  }, 500);
});

// Cleanup pending images when switching themes etc. — reset on load


// ==================================================
// POST BUTTON STATE SYNC — Bulletproof (polling)
// ==================================================

function _syncPostBtnState() {
  const btn = document.getElementById("post-btn");
  const ta = document.getElementById("post-content");
  if (!btn || !ta) return;

  const hasText = ta.value.trim().length > 0;
  const hasImages = (typeof _pendingImages !== "undefined" && _pendingImages.length > 0);
  const active = hasText || hasImages;

  const currentlyVisible = btn.classList.contains("visible");

  if (active !== currentlyVisible) {
    btn.classList.toggle("visible", active);

    const composer = btn.closest(".composer-box");
    if (composer) composer.classList.toggle("has-content", active);
  }
}

// Poll every 250ms — bulletproof, JS-reference-safe
// S30.4 - polling removed; call _syncPostBtnState on input events instead
// (was: setInterval 250ms = constant CPU/battery drain on every page)
document.addEventListener("input", function(e){
  if (e.target && e.target.id === "post-content") _syncPostBtnState();
}, true);

// Initial calls
setTimeout(_syncPostBtnState, 100);
setTimeout(_syncPostBtnState, 800);


// ==================================================
// REACTIONS SYSTEM — 6 Facebook-style reactions
// ==================================================

const REACTIONS = {
  like:  { emoji: "👍", label: "লাইক",   class: "reaction-like" },
  love:  { emoji: "❤️", label: "ভালোবাসা", class: "reaction-love" },
  haha:  { emoji: "😆", label: "হাসি",   class: "reaction-haha" },
  wow:   { emoji: "😮", label: "বিস্ময়",  class: "reaction-wow" },
  sad:   { emoji: "😢", label: "দুঃখ",   class: "reaction-sad" },
  angry: { emoji: "😡", label: "রাগ",    class: "reaction-angry" },
};

function renderReactionIcon(reaction) {
  if (!reaction || !REACTIONS[reaction]) {
    return `<i class="fa-regular fa-heart"></i>`;
  }
  return `<span class="reaction-emoji">${REACTIONS[reaction].emoji}</span>`;
}

// ---------- Build reaction picker (shared) ----------

let _activePicker = null;

function buildReactionPicker() {
  const picker = document.createElement("div");
  picker.className = "reaction-picker hidden";
  picker.innerHTML = Object.entries(REACTIONS).map(([key, r]) => `
    <button class="reaction-btn" data-reaction="${key}" data-label="${r.label}">
      ${r.emoji}
    </button>
  `).join("");
  return picker;
}

function closePicker() {
  if (_activePicker) {
    _activePicker.classList.add("hidden");
    _activePicker = null;
  }
}

// Close picker when clicking elsewhere
document.addEventListener("click", (e) => {
  if (!e.target.closest(".reaction-picker") && !e.target.closest(".like-btn")) {
    closePicker();
  }
});

// Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePicker();
});

// ---------- Show picker for a like button ----------

function showPicker(likeBtn) { /* disabled */ }

// ---------- Apply a reaction (from picker or quick tap) ----------

async function applyReaction(likeBtn, reaction) { /* disabled */ }

function applyReactionStyles(btn, reaction) {
  // Remove all reaction classes
  Object.values(REACTIONS).forEach((r) => btn.classList.remove(r.class));
  btn.classList.remove("reaction-active");
  btn.classList.remove("liked");

  if (reaction && REACTIONS[reaction]) {
    btn.classList.add("reaction-active", REACTIONS[reaction].class);
    // Keep "liked" for backwards compat with CSS
    btn.classList.add("liked");
  }
}

function burstReaction(likeBtn, emoji) {
  const burst = document.createElement("span");
  burst.className = "reaction-burst";
  burst.textContent = emoji;
  likeBtn.appendChild(burst);
  setTimeout(() => burst.remove(), 1000);
}

// ---------- Attach picker + tap handlers to a like button ----------

function attachReactionHandlers(likeBtn) { /* disabled — using delegation */ }

function quickToggleLike(likeBtn) {
  const current = likeBtn.dataset.reaction || "";
  if (current) {
    // Has reaction → remove
    applyReaction(likeBtn, current);
  } else {
    // No reaction → default like
    applyReaction(likeBtn, "like");
  }
}

// ---------- Hook into bindPostEvents ----------

const _origBindPostEventsReactions = bindPostEvents;
bindPostEvents = function () {
  _origBindPostEventsReactions();

  document.querySelectorAll(".like-btn").forEach((btn) => {
    applyReactionStyles(btn, btn.dataset.reaction || "");
    attachReactionHandlers(btn);
  });
};

// Also after initial feed render
_enterAppHooks.push(() => {
  setTimeout(() => {
    document.querySelectorAll(".like-btn").forEach((btn) => {
      applyReactionStyles(btn, btn.dataset.reaction || "");
      attachReactionHandlers(btn);
    });
  }, 500);
});

// ---------- Double-tap post body → love reaction ----------

document.addEventListener("dblclick", (e) => {
  const post = e.target.closest(".post");
  if (!post) return;
  const likeBtn = post.querySelector(".like-btn");
  if (!likeBtn) return;
  const current = likeBtn.dataset.reaction || "";
  if (current !== "love") {
    applyReaction(likeBtn, "love");
    burstReaction(likeBtn, "❤️");
  }
});

// Touch-based double-tap
let _lastTapPost = null;
let _lastTapTime = 0;
document.addEventListener("touchend", (e) => {
  const post = e.target.closest(".post");
  if (!post) return;
  // Only if not tapping buttons
  if (e.target.closest("button") || e.target.closest("a") || e.target.closest("input")) return;

  const now = Date.now();
  if (_lastTapPost === post && now - _lastTapTime < 300) {
    const likeBtn = post.querySelector(".like-btn");
    if (likeBtn) {
      const current = likeBtn.dataset.reaction || "";
      if (current !== "love") {
        applyReaction(likeBtn, "love");
        burstReaction(likeBtn, "❤️");
      }
    }
    _lastTapPost = null;
  } else {
    _lastTapPost = post;
    _lastTapTime = now;
  }
});


// ==================================================
// FINAL REACTION SYSTEM — Clean Implementation
// ==================================================

const FIN_REACTION_DATA = {
  like:  { emoji: "👍", label: "লাইক",      color: "#1877f2" },
  love:  { emoji: "❤️", label: "ভালোবাসা",  color: "#ef4444" },
  haha:  { emoji: "😆", label: "হাসি",      color: "#f59e0b" },
  wow:   { emoji: "😮", label: "বিস্ময়",     color: "#f59e0b" },
  sad:   { emoji: "😢", label: "দুঃখ",      color: "#f59e0b" },
  angry: { emoji: "😡", label: "রাগ",       color: "#ef4444" },
};

let _finGlobalPicker = null;
let _finPickerTargetBtn = null;

// ---------- Build picker (once, global) ----------

function _finBuildGlobalPicker() {
  if (_finGlobalPicker) return _finGlobalPicker;

  const picker = document.createElement("div");
  picker.className = "reaction-picker-global";
  picker.innerHTML = Object.entries(FIN_REACTION_DATA).map(([key, r]) =>
    `<button type="button" class="rp-emoji" data-reaction="${key}" title="${r.label}">${r.emoji}</button>`
  ).join("");

  // Attach click with onclick for guaranteed binding
  picker.querySelectorAll(".rp-emoji").forEach((btn) => {
    // S30.34 — use touchstart + mousedown for reliable mobile response
    const doPick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const reaction = btn.dataset.reaction;
      const target = _finPickerTargetBtn;
      if (!target || !reaction) return;
      // hide but KEEP target reference so _finDoReaction works
      if (_finGlobalPicker) _finGlobalPicker.style.display = "none";
      _finPickerCooldown = Date.now() + 300;
      _finPickerTargetBtn = null;
      _finDoReaction(target, reaction);
    };
    btn.onclick = doPick;
    // fallback for browsers that don't fire click on touch
    btn.addEventListener("touchend", function (e) {
      // small delay so click doesn't double-fire
      setTimeout(function () { doPick(e); }, 10);
    }, { passive: false });
  });

  document.body.appendChild(picker);
  _finGlobalPicker = picker;
  return picker;
}

let _finPickerCooldown = 0;

function _finShowGlobalPicker(anchorBtn) {
  // Cooldown — don't re-show within 1.2 seconds of hiding
  if (Date.now() < _finPickerCooldown) return;

  const picker = _finBuildGlobalPicker();
  _finPickerTargetBtn = anchorBtn;

  // Position picker above the anchor button
  const rect = anchorBtn.getBoundingClientRect();
  const pickerWidth = 300; // approx
  const pickerHeight = 60;

  let left = rect.left;
  let top = rect.top - pickerHeight - 10;

  // Keep within viewport
  if (left + pickerWidth > window.innerWidth - 10) {
    left = window.innerWidth - pickerWidth - 10;
  }
  if (left < 10) left = 10;
  if (top < 10) top = rect.bottom + 10;

  picker.style.position = "fixed";
  picker.style.left = left + "px";
  picker.style.top = top + "px";
  picker.style.display = "flex";
  picker.style.opacity = "0";
  picker.style.transform = "translateY(10px) scale(0.85)";

  // Animate in
  requestAnimationFrame(() => {
    picker.style.transition = "all 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)";
    picker.style.opacity = "1";
    picker.style.transform = "translateY(0) scale(1)";
  });

  // Mark current reaction as active
  const current = anchorBtn.dataset.reaction || "";
  picker.querySelectorAll(".rp-emoji").forEach((b) => {
    b.classList.toggle("active", b.dataset.reaction === current);
  });
}

function _finHideGlobalPicker() {
  if (_finGlobalPicker) {
    _finGlobalPicker.style.display = "none";
  }
  _finPickerTargetBtn = null;
  // Cooldown — block re-open for 1.2 seconds
  _finPickerCooldown = Date.now() + 300;   // S30.31 — was 1200ms (too long after hide)
}

// ---------- Apply reaction ----------

// S29.9 - per-post lock (was: single global _finProcessing flag).
// Global lock dropped rapid reactions on DIFFERENT posts (any
// second click within 200ms was silently discarded, regardless of
// which post it targeted). Per-post map allows independent reactions
// while still preventing a duplicate POST on the SAME post.
let _finProcessingByPost = Object.create(null);

async function _finDoReaction(likeBtn, reaction) {
  console.log('[T1] _finDoReaction called, reaction=', reaction);
  // S30.34 — fallback: find postId from parent .post element if button lacks it
  let postId = likeBtn.dataset.id;
  if (!postId) {
    const postEl = likeBtn.closest(".post");
    if (postEl && postEl.dataset.id) postId = postEl.dataset.id;
  }
  if (!postId) {
    console.warn("[REACTION] no postId for button", likeBtn);
    return;
  }

  console.log('[T2] postId=', postId);
  if (_finProcessingByPost[postId]) { console.log('[T2b] already processing'); return; }
  _finProcessingByPost[postId] = true;

  const current = likeBtn.dataset.reaction || "";
  const newReaction = current === reaction ? "" : reaction;
  const oldReaction = current;
  const oldCount = parseInt(likeBtn.querySelector(".like-count")?.textContent || "0", 10);

  let newCount = oldCount;
  if (newReaction && !oldReaction) newCount = oldCount + 1;
  else if (!newReaction && oldReaction) newCount = Math.max(0, oldCount - 1);

  // Optimistic update
  likeBtn.dataset.reaction = newReaction;
  console.log('[T3] render start newReaction=', newReaction, 'newCount=', newCount);
  _finRenderReactionButton(likeBtn, newReaction, newCount);
  console.log('[T4] render done innerHTML=', likeBtn.innerHTML.slice(0,100));
  _finFlashReaction(likeBtn, newReaction || oldReaction);

  try {
    console.log("[T5] API POST start");
    const res = await api("/api/posts/" + postId + "/reaction", {
      method: "POST",
      body: JSON.stringify({ reaction: reaction }),
    });
    console.log("[T6] API response:", res);
    const finalReaction = res.my_reaction || "";
    likeBtn.dataset.reaction = finalReaction;

    // Reaction-fix — play once, only on real user action
    if (finalReaction) {
      likeBtn.classList.remove("just-reacted");
      void likeBtn.offsetWidth;
      likeBtn.classList.add("just-reacted");
      setTimeout(function () {
        likeBtn.classList.remove("just-reacted");
      }, 750);
    }
    _finRenderReactionButton(likeBtn, finalReaction, res.total || 0);

    // S30.35 — update post-reaction-summary (was: never updated after reaction)
    try { _finUpdatePostSummary(likeBtn, res); } catch (e) { console.warn("[SUMMARY]", e); }
  } catch (err) {
    likeBtn.dataset.reaction = oldReaction;
    _finRenderReactionButton(likeBtn, oldReaction, oldCount);
  } finally {
    setTimeout(function () { delete _finProcessingByPost[postId]; }, 200);
  }
}

function _finRenderReactionButton(btn, reaction, count) {
  try {
    var _r = btn.dataset.reaction || "";
    var _emEl = btn.querySelector(".reaction-emoji");
    var _heartI = btn.querySelector("i.fa-heart");
    var _em = _emEl ? _emEl.textContent : (_heartI ? "HEART" : "");
    var _want = (reaction && FIN_REACTION_DATA[reaction])
      ? FIN_REACTION_DATA[reaction].emoji : "HEART";
    var _cEl = btn.querySelector(".like-count");
    var _c = _cEl ? _cEl.textContent : "";
    if (_r === (reaction || "") && _em === _want && _c === String(count)) {
      return;
    }
  } catch (e) {}

  var labelText = reaction ? "রিঅ্যাক্ট" : "লাইক";
  var html = "";

  if (reaction && FIN_REACTION_DATA[reaction]) {
    html += '<span class="reaction-emoji">' + FIN_REACTION_DATA[reaction].emoji + '</span>';
    btn.classList.add("reaction-active", "reaction-" + reaction);
    btn.style.color = FIN_REACTION_DATA[reaction].color;
  } else {
    html += '<i class="fa-regular fa-heart"></i>';
    btn.classList.remove("reaction-active", "reaction-like", "reaction-love",
                          "reaction-haha", "reaction-wow", "reaction-sad", "reaction-angry");
    btn.style.color = "";
  }

  html += '<span class="reaction-label">' + labelText + '</span>';
  html += '<span class="like-count">' + count + '</span>';
  btn.innerHTML = html;
}



// S30.35 — update the summary block at the bottom of the post
function _finUpdatePostSummary(likeBtn, res) {
  var postEl = likeBtn.closest(".post");
  if (!postEl) return;

  var counts = res.counts || {};
  var total = res.total || 0;
  var top = res.top || [];

  var emojiMap = { like: "👍", love: "❤️", haha: "😆", wow: "😮", sad: "😢", angry: "😡" };
  var stackHTML = "";
  if (top && top.length) {
    stackHTML = top.map(function (r) {
      return '<span class="prs-emoji reaction-' + r + '" data-r="' + r + '">' +
        (emojiMap[r] || "❤️") + '</span>';
    }).join("");
  } else {
    stackHTML = '<span class="prs-emoji reaction-love">❤️</span>';
  }

  function _fmtNum(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 1000000) {
      var k = n / 1000;
      return (k >= 10 ? Math.floor(k) : k.toFixed(1).replace(/\.0$/, "")) + "k";
    }
    var m = n / 1000000;
    return (m >= 10 ? Math.floor(m) : m.toFixed(1).replace(/\.0$/, "")) + "M";
  }
  function _fmtBn(n) {
    return String(Number(n) || 0).replace(/[0-9]/g, function (d) {
      return "০১২৩৪৫৬৭৮৯"[d];
    });
  }

  var commentBtn = postEl.querySelector(".comment-btn .comment-count");
  var repostBtn = postEl.querySelector(".repost-btn .repost-count");
  var commentCount = commentBtn ? parseInt(commentBtn.textContent || "0", 10) : 0;
  var repostCount = repostBtn ? parseInt(repostBtn.textContent || "0", 10) : 0;

  var summaryEl = postEl.querySelector(".post-reaction-summary");
  var dividerEl = postEl.querySelector(".post-actions-divider");

  if (total === 0 && commentCount === 0 && repostCount === 0) {
    if (summaryEl) summaryEl.remove();
    if (dividerEl) dividerEl.remove();
    return;
  }

  var summaryHTML = `
    <div class="post-reaction-summary">
      <div class="prs-left">
        ${total > 0 ? '<span class="prs-stack">' + stackHTML + '</span>' : ''}
        ${total > 0 ? '<span class="prs-count">' + _fmtNum(total) + '</span>' : ''}
      </div>
      <div class="prs-right">
        ${commentCount > 0 ? '<span>' + _fmtBn(commentCount) + ' মন্তব্য</span>' : ''}
        ${(commentCount > 0 && repostCount > 0) ? '<span class="prs-sep">·</span>' : ''}
        ${repostCount > 0 ? '<span>' + _fmtBn(repostCount) + ' শেয়ার</span>' : ''}
      </div>
    </div>
    <div class="post-actions-divider"></div>
  `;

  if (summaryEl) {
    summaryEl.outerHTML = summaryHTML;
  } else {
    // insert before .post-actions
    var actionsEl = postEl.querySelector(".post-actions");
    if (actionsEl) {
      actionsEl.insertAdjacentHTML("beforebegin", summaryHTML);
    }
  }
}

function _finFlashReaction(btn, reaction) {
  if (!reaction || !FIN_REACTION_DATA[reaction]) return;
  const burst = document.createElement("span");
  burst.className = "reaction-burst";
  burst.textContent = FIN_REACTION_DATA[reaction].emoji;
  btn.appendChild(burst);
  setTimeout(() => burst.remove(), 1000);
}

// ---------- Event delegation ----------

let _finLastTouch = 0;
let _finHoverTimer = null;
let _finCurrentHoverBtn = null;
let _finLpTimer = null;
let _finLpBtn = null;
let _finLpDid = false;

// Click (desktop)
document.addEventListener("click", function (e) {
  // If clicked inside our global picker — ignore (handled by picker's own onclick)
  if (e.target.closest(".reaction-picker-global")) return;

  const likeBtn = e.target.closest(".like-btn");
  if (!likeBtn) {
    _finHideGlobalPicker();
    return;
  }

  console.log('[T7] click handler hit');
  if (Date.now() - _finLastTouch < 700) { console.log('[T7b] skip ghost click'); return; } // Skip ghost click after touch

  // Quick toggle
  const current = likeBtn.dataset.reaction || "";
  if (current) {
    _finDoReaction(likeBtn, current);
  } else {
    _finDoReaction(likeBtn, "like");
  }
}, true);

// Hover (desktop)
document.addEventListener("mouseover", function (e) {
  // S30.34 — kill hover picker on ANY touch device (was: width<900 → tablets triggered)
  if ("ontouchstart" in window || navigator.maxTouchPoints > 0) return;
  const likeBtn = e.target.closest(".like-btn");
  if (!likeBtn) return;
  if (_finCurrentHoverBtn === likeBtn) return;

  // Cooldown check
  if (Date.now() < _finPickerCooldown) return;

  clearTimeout(_finHoverTimer);
  _finCurrentHoverBtn = likeBtn;
  _finHoverTimer = setTimeout(function () {
    if (_finCurrentHoverBtn === likeBtn && Date.now() >= _finPickerCooldown) {
      _finShowGlobalPicker(likeBtn);
    }
  }, 450);
});

document.addEventListener("mouseout", function (e) {
  const likeBtn = e.target.closest(".like-btn");
  if (!likeBtn) return;
  const related = e.relatedTarget;
  if (related && (likeBtn.contains(related) || (_finGlobalPicker && _finGlobalPicker.contains(related)))) {
    return;
  }
  clearTimeout(_finHoverTimer);
  _finCurrentHoverBtn = null;
  // Delay hide so user can move into picker
  setTimeout(function () {
    if (_finGlobalPicker && _finGlobalPicker.matches(":hover")) return;
    if (_finPickerTargetBtn && _finPickerTargetBtn.matches(":hover")) return;
    _finHideGlobalPicker();
  }, 250);
});

// Long-press (mobile)
// S30.31 — touchmove scroll guard: cancel long-press + prevent accidental like
var _finTouchStartX = 0;
var _finTouchStartY = 0;
var _finTouchMoved = false;

document.addEventListener("touchstart", function (e) {
  const likeBtn = e.target.closest(".like-btn");
  if (!likeBtn) return;
  _finLastTouch = Date.now();
  _finLpBtn = likeBtn;
  _finLpDid = false;
  _finTouchMoved = false;
  _finTouchStartX = e.touches[0].clientX;
  _finTouchStartY = e.touches[0].clientY;
  clearTimeout(_finLpTimer);
  _finLpTimer = setTimeout(function () {
    if (_finTouchMoved) return;
    _finLpDid = true;
    if (navigator.vibrate) navigator.vibrate(15);
    _finShowGlobalPicker(likeBtn);
  }, 450);
}, { passive: true });

document.addEventListener("touchmove", function (e) {
  if (!_finLpBtn) return;
  var dx = Math.abs(e.touches[0].clientX - _finTouchStartX);
  var dy = Math.abs(e.touches[0].clientY - _finTouchStartY);
  if (dx > 10 || dy > 10) {
    _finTouchMoved = true;
    clearTimeout(_finLpTimer);
    _finLpBtn = null;
    _finLpDid = false;
  }
}, { passive: true });

document.addEventListener("touchend", function (e) {
  if (!_finLpBtn) return;
  // ignore if user was scrolling
  if (_finTouchMoved) {
    _finLpBtn = null;
    _finLpDid = false;
    _finTouchMoved = false;
    return;
  }
  var endX = e.changedTouches[0].clientX;
  var endY = e.changedTouches[0].clientY;
  var finalDx = Math.abs(endX - _finTouchStartX);
  var finalDy = Math.abs(endY - _finTouchStartY);
  if (finalDx > 10 || finalDy > 10) {
    // user scrolled and lifted on the button → don't react
    _finLpBtn = null;
    _finLpDid = false;
    return;
  }

  const wasLong = _finLpDid;
  clearTimeout(_finLpTimer);
  _finLastTouch = Date.now();

  if (!wasLong) {
    const likeBtn = e.target.closest(".like-btn") || _finLpBtn;
    if (likeBtn === _finLpBtn) {
      const current = likeBtn.dataset.reaction || "";
      console.log("[LIKE] tap → reaction:", current || "like");
      if (current) _finDoReaction(likeBtn, current);
      else _finDoReaction(likeBtn, "like");
    }
  }

  _finLpBtn = null;
  _finLpDid = false;
});

document.addEventListener("touchcancel", function () {
  clearTimeout(_finLpTimer);
  _finLpBtn = null;
  _finLpDid = false;
});

// S30.31 — scroll/resize should HIDE picker but not lock the cooldown
// (was: every scroll extended 1.2s cooldown → long-press after scroll didn't work)
window.addEventListener("scroll", function () {
  if (_finGlobalPicker && _finGlobalPicker.style.display !== "none") {
    _finGlobalPicker.style.display = "none";
    _finPickerTargetBtn = null;
    // no cooldown set here
  }
}, { passive: true });
window.addEventListener("resize", function () {
  if (_finGlobalPicker && _finGlobalPicker.style.display !== "none") {
    _finGlobalPicker.style.display = "none";
    _finPickerTargetBtn = null;
  }
});

// Escape key
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") _finHideGlobalPicker();
});

// Double-tap → love reaction
let _finDtPost = null;
let _finDtTime = 0;

document.addEventListener("touchend", function (e) {
  const post = e.target.closest(".post");
  if (!post) return;
  if (e.target.closest("button, a, input, .reaction-picker-global")) return;
  // S29.15 - don't fire love-reaction when double-tapping date separator
  if (e.target.closest(".chat-date-sep")) return;

  const now = Date.now();
  if (_finDtPost === post && now - _finDtTime < 350) {
    const likeBtn = post.querySelector(".like-btn");
    if (likeBtn) {
      const current = likeBtn.dataset.reaction || "";
      if (current !== "love") _finDoReaction(likeBtn, "love");
    }
    _finDtPost = null;
  } else {
    _finDtPost = post;
    _finDtTime = now;
  }
});

document.addEventListener("dblclick", function (e) {
  const post = e.target.closest(".post");
  if (!post) return;
  if (e.target.closest("button, a, input, .reaction-picker-global")) return;
  // S29.15 - same guard for desktop dblclick
  if (e.target.closest(".chat-date-sep")) return;
  const likeBtn = post.querySelector(".like-btn");
  if (!likeBtn) return;
  const current = likeBtn.dataset.reaction || "";
  if (current !== "love") _finDoReaction(likeBtn, "love");
});

// Initialize existing buttons on page load
function _finInitExistingReactions() {
  document.querySelectorAll(".like-btn").forEach(function (btn) {
    const r = btn.dataset.reaction || "";
    const c = parseInt(btn.querySelector(".like-count")?.textContent || "0", 10);
    if (r) _finRenderReactionButton(btn, r, c);
  });
}

// Run on load and after feed updates
setTimeout(_finInitExistingReactions, 800);
// Reaction-fix — S29.20 observer disabled.
// It caused an infinite loop: observer → _finInitExistingReactions
// → DOM write → observer again. bindPostEvents() already styles
// reactions after every feed render, so the observer is redundant.


// ==================================================
// STRIP OLD LIKE BUTTON HANDLERS (safety net)
// ==================================================
// This removes any per-button event listeners that may have
// been attached by older code. Document-level delegation still works.

// S30.30 — _finStripButtonHandlers REMOVED.
// Was: cloned every .like-btn on every DOM change → in-flight reactions
// silently detached → ♥ never filled. Also reels use .like-btn class,
// so feed reactions broke reels. Document-level delegation in the
// FINAL REACTION SYSTEM handles all buttons without needing this hack.
function _finStripButtonHandlers() { /* no-op */ }
// No setTimeout calls — delegation does the work.
// S29.14 - catch late-loaded posts (infinite scroll, profile, search, feed refresh)
// Old approach only ran twice at 500ms + 1500ms; posts rendered after that
// never got their handlers stripped. MutationObserver on #feed-list (and any
// future container) re-runs on new .post insertions.
// S30.30 — MutationObserver for _finStripButtonHandlers REMOVED.
// Was calling the strip function on every DOM mutation — combined with
// the function itself, this created a self-triggering loop. Document-level
// reaction delegation in FINAL REACTION SYSTEM doesn't need this.
(function () {
  window.__s2914Observer = true;   // marker so old external refs are no-ops
})();


// ==================================================
// S19.10 — POST "আরও দেখুন" expand
// ==================================================
document.addEventListener("click", function (e) {
  var btn = e.target.closest(".post-see-more");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  var postId = btn.dataset.expand;
  if (!postId) return;

  // Easiest: open detail modal
  if (typeof openPostDetail === "function") {
    openPostDetail(parseInt(postId));
  } else {
    // fallback: expand inline via fetch
    (async function () {
      try {
        var data = await api("/api/posts/" + postId);
        if (!data || !data.post) return;
        var post = btn.closest(".post");
        if (!post) return;
        var wrap = post.querySelector(".post-content-wrap");
        if (!wrap) return;
        wrap.innerHTML = '<div class="post-content">' + linkifyHashtags(data.post.content) + '</div>';
        if (typeof attachHashtagListeners === "function") {
          attachHashtagListeners(wrap);
        }
      } catch (err) {}
    })();
  }
}, true);


// ==================================================
// S19.5 — POST DETAIL VIEW (click post → modal)
// ==================================================

async function openPostDetail(postId) {
  if (!postId) return;
  try {
    var data = await api("/api/posts/" + postId);
    if (!data || !data.post) return;
    var p = data.post;

    var old = document.getElementById("post-detail-modal");
    if (old) old.remove();

    var modal = document.createElement("div");
    modal.id = "post-detail-modal";
    modal.className = "modal";
    modal.innerHTML =
      '<div class="modal-content post-detail-content">' +
        '<button class="close-btn" id="pd-close" type="button">×</button>' +
        '<div class="pd-scroll">' +
          '<div class="pd-head">' +
            avatarHTML(p.display_name, p.profile_pic, "avatar", p.username) +
            '<div class="pd-head-info">' +
              '<div class="pd-name">' + escapeHtml(p.display_name) + '</div>' +
              '<div class="pd-meta">@' + escapeHtml(p.username) + ' · ' + timeAgo(p.created_at) + '</div>' +
            '</div>' +
          '</div>' +
          (p.content ? '<div class="pd-text">' + linkifyHashtags(p.content) + '</div>' : '') +
          (Array.isArray(p.media) && p.media.length
            ? '<div class="pd-media">' + p.media.map(function (m) {
                return '<img src="' + escapeHtml(m) + '" alt="" loading="lazy">';
              }).join("") + '</div>'
            : '') +
          '<div class="pd-stats">' +
            '<span><i class="fa-solid fa-heart" style="color:#ef4444"></i> ' + (p.likes || 0) + '</span>' +
            '<span><i class="fa-solid fa-comment" style="color:var(--accent)"></i> ' + (p.comments || 0) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    document.getElementById("pd-close").onclick = function () { modal.remove(); };
    modal.addEventListener("click", function (e) {
      if (e.target === modal) modal.remove();
    });
    modal.querySelector(".pd-head .avatar").addEventListener("click", function () {
      modal.remove();
      if (typeof openProfile === "function") openProfile(p.username);
    });
    // Hashtags
    modal.querySelectorAll(".hashtag-link").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        modal.remove();
        if (typeof openHashtag === "function") openHashtag(el.dataset.tag);
      });
    });
  } catch (err) {
    if (typeof showToast === "function") showToast("পোস্ট লোড করা যায়নি");
  }
}

// Delegate: click on post content → detail
document.addEventListener("click", function (e) {
  // Skip interactive elements
  if (e.target.closest("button, a, input, textarea, .reaction-picker-global, .post-menu-btn, .post-menu-popup, .action-btn, .hashtag-link, .quoted-post")) {
    return;
  }
  var content = e.target.closest(".post-content, .post-content-wrap, .post-carousel");
  if (!content) return;
  var post = content.closest(".post");
  if (!post) return;
  var postId = post.dataset.id;
  if (!postId) return;
  // Don't trigger on double-tap loves
  if (e.detail > 1) return;
  openPostDetail(parseInt(postId));
}, true);


// ==================================================
// S19.4 — SAVE BUTTON (post bar) handler
// ==================================================
document.addEventListener("click", async function (e) {
  var btn = e.target.closest(".save-btn");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();

  var postId = btn.dataset.id;
  if (!postId) return;
  var wasSaved = btn.dataset.saved === "1";

  // Optimistic
  btn.dataset.saved = wasSaved ? "0" : "1";
  var icon = btn.querySelector("i");
  if (icon) {
    icon.className = (wasSaved ? "fa-regular" : "fa-solid") + " fa-bookmark";
  }
  btn.classList.toggle("saved", !wasSaved);

  try {
    var res = await api("/api/posts/" + postId + "/save", { method: "POST" });
    var isSaved = !!res.saved;
    btn.dataset.saved = isSaved ? "1" : "0";
    if (icon) {
      icon.className = (isSaved ? "fa-solid" : "fa-regular") + " fa-bookmark";
    }
    btn.classList.toggle("saved", isSaved);
    if (typeof showToast === "function") {
      showToast(isSaved ? "🔖 সেভ করা হয়েছে" : "সেভ সরানো হয়েছে");
    }
    // Sync menu button state if present
    var menuBtn = btn.closest(".post") && btn.closest(".post").querySelector(".post-menu-btn");
    if (menuBtn) menuBtn.dataset.saved = isSaved ? "1" : "0";
  } catch (err) {
    // rollback
    btn.dataset.saved = wasSaved ? "1" : "0";
    if (icon) {
      icon.className = (wasSaved ? "fa-solid" : "fa-regular") + " fa-bookmark";
    }
    btn.classList.toggle("saved", wasSaved);
    alert((err && err.message) || "সেভ করা যায়নি");
  }
}, true);


// ==================================================
// REPOST + QUOTE SYSTEM — Frontend
// ==================================================

let _repostActiveBtn = null;
let _quoteTargetPostId = null;

// ---------- Repost menu (handlers below) ----------

function _closeRepostMenu() {
  const menu = document.getElementById("repost-menu");
  if (menu) menu.classList.add("hidden");
  _repostActiveBtn = null;
}

// ---------- Bulletproof Repost Handler (delegation) ----------

document.addEventListener("click", function (e) {
  // Case 1: click on repost button
  const btn = e.target.closest(".repost-btn");
  if (btn) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    const isOwn = state.me && btn.dataset.owner === state.me.username;
    if (isOwn) {
      showToast("ℹ️ নিজের পোস্ট রিপোস্ট করা যাবে না");
      return;
    }
    _openRepostMenu(btn);
    return;
  }

  // Case 2: click inside the repost menu → let menu handle it
  if (e.target.closest(".repost-menu")) {
    return;
  }

  // Case 3: click elsewhere → close menu
  _closeRepostMenu();
}, true);


function _openRepostMenu(btn) {
  let menu = document.getElementById("repost-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "repost-menu";
    menu.className = "repost-menu hidden";
    menu.innerHTML = `
      <button class="repost-menu-item" data-action="repost">
        <i class="fa-solid fa-retweet"></i>
        <div>
          <div class="rmi-title">রিপোস্ট</div>
          <div class="rmi-sub">আপনার ফিডে শেয়ার করুন</div>
        </div>
      </button>
      <button class="repost-menu-item" data-action="quote">
        <i class="fa-solid fa-quote-right"></i>
        <div>
          <div class="rmi-title">কোট পোস্ট</div>
          <div class="rmi-sub">মন্তব্যসহ শেয়ার করুন</div>
        </div>
      </button>
    `;
    document.body.appendChild(menu);

    menu.querySelectorAll(".repost-menu-item").forEach((item) => {
      item.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();

        const action = this.dataset.action;
        const targetBtn = _repostActiveBtn;
        const targetPostId = targetBtn ? targetBtn.dataset.id : null;

        // Hide menu
        menu.classList.add("hidden");
        _repostActiveBtn = null;

        if (!targetPostId) return;

        if (action === "repost") {
          _doRepost(targetBtn);
        } else if (action === "quote") {
          _openQuoteModal(targetPostId);
        }
      });
    });
  }

  _repostActiveBtn = btn;

  // Position menu above button
  const rect = btn.getBoundingClientRect();
  const menuWidth = 220;
  let left = rect.left;
  let top = rect.top - 10;

  if (left + menuWidth > window.innerWidth - 10) {
    left = window.innerWidth - menuWidth - 10;
  }
  if (left < 10) left = 10;

  menu.style.position = "fixed";
  menu.style.left = left + "px";
  menu.style.top = "auto";
  menu.style.bottom = (window.innerHeight - rect.top + 8) + "px";
  menu.style.width = menuWidth + "px";

  menu.classList.remove("hidden");
}

// ---------- Do repost ----------

async function _doRepost(btn) {
  const postId = btn.dataset.id;
  if (!postId) return;

  const wasReposted = btn.dataset.reposted === "1";

  try {
    const res = await api(`/api/posts/${postId}/repost`, { method: "POST" });

    btn.dataset.reposted = res.reposted ? "1" : "0";
    btn.classList.toggle("reposted", res.reposted);

    const countEl = btn.querySelector(".repost-count");
    if (countEl) countEl.textContent = res.count;

    showToast(res.reposted ? "🔁 রিপোস্ট হয়েছে" : "রিপোস্ট সরানো হয়েছে");
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Quote modal ----------

function _openQuoteModal(postId) {
  _quoteTargetPostId = postId;

  let modal = document.getElementById("quote-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "quote-modal";
    modal.className = "modal hidden";
    modal.innerHTML = `
      <div class="modal-content" style="max-width:500px">
        <button class="close-btn" id="close-quote-modal">×</button>
        <h2 style="margin-bottom:18px;font-size:20px">✍️ কোট পোস্ট</h2>
        <div id="quote-preview" class="quote-preview"></div>
        <textarea id="quote-text" class="edit-bio-input" placeholder="আপনার মন্তব্য লিখুন..." maxlength="500" style="min-height:100px;margin-top:14px"></textarea>
        <div class="edit-actions">
          <button class="btn-secondary" id="cancel-quote">বাতিল</button>
          <button class="btn-primary" id="submit-quote" style="width:auto;padding:12px 28px">
            <i class="fa-solid fa-paper-plane"></i> পোস্ট করুন
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("close-quote-modal").addEventListener("click", _closeQuoteModal);
    document.getElementById("cancel-quote").addEventListener("click", _closeQuoteModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) _closeQuoteModal();
    });
    document.getElementById("submit-quote").addEventListener("click", _submitQuote);
  }

  // Load preview
  const preview = document.getElementById("quote-preview");
  preview.innerHTML = `<p style="color:var(--muted);text-align:center;padding:20px">লোড হচ্ছে...</p>`;

  api("/api/posts/" + postId + "/quote-preview")
    .then((data) => {
      if (data.post) {
        const p = data.post;
        preview.innerHTML = `
          <div class="quoted-post">
            <div class="quoted-header">
              <div class="quoted-avatar">${avatarInner(p.display_name, p.profile_pic)}</div>
              <div>
                <div class="quoted-name">${escapeHtml(p.display_name)}</div>
                <div class="quoted-time">@${escapeHtml(p.username)}</div>
              </div>
            </div>
            <div class="quoted-content">${escapeHtml(p.content || "").slice(0, 200)}</div>
          </div>
        `;
      }
    })
    .catch(() => {
      preview.innerHTML = `<p style="color:var(--muted);text-align:center;padding:20px">প্রিভিউ লোড করা যায়নি</p>`;
    });

  modal.classList.remove("hidden");
  document.getElementById("quote-text").focus();
}

function _closeQuoteModal() {
  const modal = document.getElementById("quote-modal");
  if (modal) modal.classList.add("hidden");
  _quoteTargetPostId = null;
  const txt = document.getElementById("quote-text");
  if (txt) txt.value = "";
}

async function _submitQuote() {
  if (!_quoteTargetPostId) return;

  const content = document.getElementById("quote-text").value.trim();
  if (!content) {
    showToast("মন্তব্য লিখুন");
    return;
  }

  const submitBtn = document.getElementById("submit-quote");
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

  try {
    await api(`/api/posts/${_quoteTargetPostId}/quote`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    _closeQuoteModal();
    showToast("✅ কোট পোস্ট হয়েছে");
    window.__highlightNextPost = true;
    await loadFeed();
  } catch (err) {
    alert(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> পোস্ট করুন`;
  }
}

// ---------- Quoted post click → go to original author ----------

document.addEventListener("click", function (e) {
  const quoted = e.target.closest(".quoted-post");
  if (!quoted) return;
  e.stopPropagation();
  const username = quoted.dataset.quoteUser;
  if (username) openProfile(username);
});


// ==================================================
// SETTINGS PAGE
// ==================================================

async function openSettingsPage() {
  const page = document.getElementById("settings-page");
  if (!page) return;
  if (!page.classList.contains("hidden")) return;

  // S22 / Series 27B-1 — load security dashboard
  _loadSecurityDashboard().catch(() => {});

  // S22 / Series 27B-2 — check email verified before 2FA enable
  _checkEmailGateFor2FA().catch(() => {});

  // S18.9h3 — refresh state.me so privacy toggle shows correct value
  try {
    const fresh = await api("/api/me");
    if (fresh && fresh.user) state.me = fresh.user;
  } catch (e) {}

  const unameInput = document.getElementById("set-username");
  if (unameInput && state.me) unameInput.value = state.me.username;

  const curUname = document.getElementById("set-current-uname");
  if (curUname && state.me) curUname.textContent = "@" + state.me.username;

  ["set-current-pw", "set-new-pw", "set-confirm-pw"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  page.classList.remove("hidden");
  _pushPage("settings");
}

document.getElementById("btn-change-pw")?.addEventListener("click", async () => {
  const cur = document.getElementById("set-current-pw").value;
  const neu = document.getElementById("set-new-pw").value;
  const conf = document.getElementById("set-confirm-pw").value;

  if (!cur || !neu || !conf) return showToast("সব ফিল্ড পূরণ করুন");
  if (neu.length < 6) return showToast("পাসওয়ার্ড ৬+ অক্ষর হতে হবে");
  if (neu !== conf) return showToast("নতুন পাসওয়ার্ড দুইবার একই লিখুন");
  if (cur === neu) return showToast("নতুন পাসওয়ার্ড পুরোনোর মতো হতে পারে না");

  const btn = document.getElementById("btn-change-pw");
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> অপেক্ষা করুন...';
  try {
    await api("/api/me/password", {
      method: "POST",
      body: JSON.stringify({ current_password: cur, new_password: neu }),
    });
    ["set-current-pw", "set-new-pw", "set-confirm-pw"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    showToast("✅ পাসওয়ার্ড পরিবর্তন হয়েছে");
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> পাসওয়ার্ড বদলান';
  }
});

document.getElementById("btn-change-uname")?.addEventListener("click", async () => {
  const uname = (document.getElementById("set-username").value || "").trim().toLowerCase();
  if (!uname) return showToast("নতুন ইউজারনেম লিখুন");
  if (!/^[a-z0-9_]+$/.test(uname)) return showToast("শুধু a-z, 0-9, _ ব্যবহার করুন");
  if (state.me && uname === state.me.username) return showToast("এটাই আপনার বর্তমান ইউজারনেম");

  const btn = document.getElementById("btn-change-uname");
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> অপেক্ষা করুন...';
  try {
    const res = await api("/api/me/username", {
      method: "POST",
      body: JSON.stringify({ username: uname }),
    });
    state.me.username = res.username;
    refreshProfileUI();

    const curUname = document.getElementById("set-current-uname");
    if (curUname) curUname.textContent = "@" + res.username;

    showToast("✅ ইউজারনেম পরিবর্তন হয়েছে");
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> ইউজারনেম বদলান';
  }
});

document.getElementById("settings-back")?.addEventListener("click", () => {
  if (_PageStack.length > 0) history.back();
  else document.getElementById("settings-page")?.classList.add("hidden");
});

const _origCloseTopPageSettings = _closeTopPage;
_closeTopPage = function () {
  const top = _PageStack[_PageStack.length - 1];
  if (top === "settings") {
    _PageStack.pop();
    document.getElementById("settings-page")?.classList.add("hidden");
    return true;
  }
  return _origCloseTopPageSettings();
};


// ==================================================
// BLOCK SYSTEM
// ==================================================

async function toggleBlock(e) {
  const btn = e.currentTarget;
  const username = btn.dataset.username;
  const isBlocked = btn.dataset.blocked === "1";

  if (!isBlocked) {
    if (!confirm("@" + username + " কে ব্লক করবেন?\n\nতিনি আপনার পোস্ট দেখতে পাবেন না, আপনি তার পোস্ট দেখবেন না, এবং কেউ কাউকে মেসেজ পাঠাতে পারবে না।")) return;
  }

  btn.disabled = true;
  try {
    const res = await api("/api/users/" + encodeURIComponent(username) + "/block", {
      method: "POST",
    });
    btn.dataset.blocked = res.blocked ? "1" : "0";
    btn.classList.toggle("blocked", res.blocked);
    btn.innerHTML = res.blocked
      ? '<i class="fa-solid fa-unlock"></i>'
      : '<i class="fa-solid fa-ban"></i>';
    btn.title = res.blocked ? "আনব্লক করুন" : "ব্লক করুন";

    // Show/hide follow + message
    const followBtn = document.getElementById("btn-follow");
    const msgBtn = document.getElementById("btn-msg");
    if (res.blocked) {
      followBtn?.classList.add("hidden");
      msgBtn?.classList.add("hidden");
    } else {
      followBtn?.classList.remove("hidden");
      msgBtn?.classList.remove("hidden");
    }

    showToast(res.blocked ? "🚫 ব্লক করা হয়েছে" : "✅ আনব্লক করা হয়েছে");
    // Refresh feed + conversations to exclude/include their content
    setTimeout(() => loadFeed(), 300);
    // S30.18 — refresh conversation list, close chat if blocking
    try {
      if (typeof loadConversations === "function") loadConversations();
      if (res.blocked && typeof currentChatUser !== "undefined" && currentChatUser === username) {
        if (typeof stopChatPolling === "function") stopChatPolling();
        var cw = document.getElementById("chat-window");
        if (cw) cw.classList.add("hidden");
        document.body.classList.remove("messages-chat-open");
        currentChatUser = null;
        lastMsgCount = 0;
      }
    } catch (e) {}
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function loadBlockedUsers() {
  const list = document.getElementById("blocked-users-list");
  if (!list) return;
  try {
    const users = await api("/api/me/blocked-list");
    if (!users.length) {
      list.innerHTML = '<p class="empty-text" style="padding:12px 0">আপনি কাউকে ব্লক করেননি।</p>';
      return;
    }
    list.innerHTML = users.map((u) => `
      <div class="blocked-user-row" data-username="${escapeHtml(u.username)}">
        <div class="blocked-avatar">${avatarInner(u.display_name, u.profile_pic)}</div>
        <div class="blocked-info">
          <div class="blocked-name">${escapeHtml(u.display_name)}</div>
          <div class="blocked-username">@${escapeHtml(u.username)}</div>
        </div>
        <button class="btn-unblock" data-username="${escapeHtml(u.username)}">আনব্লক</button>
      </div>
    `).join("");

    list.querySelectorAll(".btn-unblock").forEach((b) => {
      b.addEventListener("click", async () => {
        const username = b.dataset.username;
        if (!confirm("@" + username + " কে আনব্লক করবেন?")) return;
        b.disabled = true;
        try {
          await api("/api/users/" + encodeURIComponent(username) + "/block", { method: "POST" });
          showToast("✅ আনব্লক করা হয়েছে");
          loadBlockedUsers();
        } catch (err) {
          alert(err.message);
          b.disabled = false;
        }
      });
    });
  } catch (err) {
    list.innerHTML = '<p class="empty-text" style="padding:12px 0">লোড করা যায়নি</p>';
  }
}

// Extend openSettingsPage to load blocked list
// S39 — exposed for unified loader
window._loadBlockedUsers = loadBlockedUsers;
// S39 — wrapper disabled (unified loader at end of file)


// ==================================================
// POST EDIT
// ==================================================

function enterEditMode(postEl, postId) {
  const wrap = postEl.querySelector(".post-content-wrap");
  if (!wrap) return;
  if (wrap.dataset.editing === "1") return;

  const contentEl = wrap.querySelector(".post-content");
  const originalText = contentEl ? contentEl.textContent : "";
  const actionsEl = postEl.querySelector(".post-actions");
  if (actionsEl) actionsEl.dataset.editHidden = "1";

  wrap.dataset.editing = "1";
  wrap.innerHTML = `
    <div class="edit-post-form">
      <textarea class="edit-post-ta" maxlength="10000">${escapeHtml(originalText)}</textarea>
      <div class="edit-post-actions">
        <button class="ep-cancel btn-secondary">বাতিল</button>
        <button class="ep-save btn-primary"><i class="fa-solid fa-check"></i> সংরক্ষণ</button>
      </div>
    </div>
  `;

  const ta = wrap.querySelector(".edit-post-ta");
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  // Auto-resize
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  ta.addEventListener("input", () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  });

  wrap.querySelector(".ep-cancel").addEventListener("click", () => {
    cancelEditMode(postEl, originalText);
  });

  wrap.querySelector(".ep-save").addEventListener("click", async () => {
    const newContent = ta.value.trim();
    if (!newContent) return showToast("খালি পোস্ট রাখা যাবে না");
    if (newContent === originalText.trim()) {
      cancelEditMode(postEl, originalText);
      return;
    }

    const saveBtn = wrap.querySelector(".ep-save");
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
      const res = await api("/api/posts/" + postId, {
        method: "PATCH",
        body: JSON.stringify({ content: newContent }),
      });
      // Update content
      wrap.dataset.editing = "0";
      wrap.innerHTML = `<div class="post-content">${linkifyHashtags(res.content)}</div>`;

      // Add/update edited mark (sibling of wrap)
      let mark = postEl.querySelector(".post-edited-mark");
      if (!mark) {
        mark = document.createElement("div");
        mark.className = "post-edited-mark";
        mark.textContent = "(সম্পাদিত)";
        wrap.parentNode.insertBefore(mark, wrap);
      } else {
        mark.classList.add("pulse-once");
        setTimeout(() => mark.classList.remove("pulse-once"), 600);
      }

      // Restore actions
      if (actionsEl) delete actionsEl.dataset.editHidden;
      attachHashtagListeners(wrap);
      showToast("✅ পোস্ট আপডেট হয়েছে");
    } catch (err) {
      alert(err.message);
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> সংরক্ষণ';
    }
  });
}

function cancelEditMode(postEl, originalText) {
  const wrap = postEl.querySelector(".post-content-wrap");
  if (!wrap) return;
  wrap.dataset.editing = "0";
  wrap.innerHTML = originalText
    ? `<div class="post-content">${linkifyHashtags(originalText)}</div>`
    : "";
  const actionsEl = postEl.querySelector(".post-actions");
  if (actionsEl) delete actionsEl.dataset.editHidden;
  attachHashtagListeners(wrap);
}


// ==================================================
// POST 3-DOT MENU
// ==================================================

let _postMenuOpenFor = null;

function openPostMenu(btn, postEl, postId) {
  closePostMenu();
  if (_postMenuOpenFor === postId) {
    _postMenuOpenFor = null;
    return;
  }
  _postMenuOpenFor = postId;

  const isOwn = state.me && btn.dataset.owner === state.me.username;
  const isSaved = btn.dataset.saved === "1";
  const isReposted = btn.dataset.reposted === "1";

  const menu = document.createElement("div");
  menu.id = "post-menu-popup";
  menu.className = "post-menu-popup";

  let html = "";
  if (!isOwn) {
    html += `<button data-action="repost"><i class="fa-solid fa-retweet"></i><span>${isReposted ? "রিপোস্ট সরান" : "রিপোস্ট"}</span></button>`;
    html += `<button data-action="quote"><i class="fa-solid fa-quote-right"></i><span>কোট পোস্ট</span></button>`;
  }
  html += `<button data-action="save"><i class="${isSaved ? 'fa-solid' : 'fa-regular'} fa-bookmark"></i><span>${isSaved ? "সেভ সরান" : "সেভ"}</span></button>`;
  html += `<button data-action="share"><i class="fa-solid fa-share-nodes"></i><span>শেয়ার</span></button>`;
  html += `<button data-action="copy"><i class="fa-solid fa-link"></i><span>লিংক কপি</span></button>`;
  if (isOwn) {
    html += `<button data-action="edit"><i class="fa-solid fa-pen"></i><span>এডিট</span></button>`;
    html += `<button data-action="delete" class="danger"><i class="fa-regular fa-trash-can"></i><span>ডিলিট</span></button>`;
  } else {
    html += `<button data-action="report" class="danger"><i class="fa-solid fa-flag"></i><span>রিপোর্ট</span></button>`;
  }

  menu.innerHTML = html;
  document.body.appendChild(menu);

  // Position
  const rect = btn.getBoundingClientRect();
  const menuWidth = 220;
  const menuHeight = menu.offsetHeight || 320;
  let left = rect.right - menuWidth;
  let top = rect.bottom + 6;

  if (left < 10) left = 10;
  if (left + menuWidth > window.innerWidth - 10) left = window.innerWidth - menuWidth - 10;
  if (top + menuHeight > window.innerHeight - 10) top = Math.max(10, rect.top - menuHeight - 6);

  menu.style.left = left + "px";
  menu.style.top = top + "px";

  menu.querySelectorAll("button[data-action]").forEach((b) => {
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const action = b.dataset.action;
      closePostMenu();
      await handlePostMenuAction(action, btn, postEl, postId);
    });
  });

  setTimeout(() => {
    document.addEventListener("click", _postMenuOutsideClick);
    // S18.9c — close on scroll/resize
    window.addEventListener("scroll", closePostMenu, { passive: true, once: true });
    window.addEventListener("resize", closePostMenu, { passive: true, once: true });
  }, 0);
}

function closePostMenu() {
  const menu = document.getElementById("post-menu-popup");
  if (menu) menu.remove();
  document.removeEventListener("click", _postMenuOutsideClick);
  window.removeEventListener("scroll", closePostMenu);
  window.removeEventListener("resize", closePostMenu);
  _postMenuOpenFor = null;
}

function _postMenuOutsideClick(e) {
  const menu = document.getElementById("post-menu-popup");
  if (!menu) return;
  if (e.target.closest("#post-menu-popup")) return;
  if (e.target.closest(".post-menu-btn")) return;
  closePostMenu();
}

async function handlePostMenuAction(action, btn, postEl, postId) {
  if (action === "repost") {
    try {
      const res = await api(`/api/posts/${postId}/repost`, { method: "POST" });
      btn.dataset.reposted = res.reposted ? "1" : "0";
      showToast(res.reposted ? "🔁 রিপোস্ট হয়েছে" : "রিপোস্ট সরানো হয়েছে");
      setTimeout(() => loadFeed(), 250);
    } catch (err) { alert(err.message); }
    return;
  }

  if (action === "quote") {
    if (typeof _openQuoteModal === "function") _openQuoteModal(postId);
    else showToast("কোট পোস্ট লোড হচ্ছে না");
    return;
  }

  if (action === "save") {
    const wasSaved = btn.dataset.saved === "1";
    try {
      const res = await api(`/api/posts/${postId}/save`, { method: "POST" });
      btn.dataset.saved = res.saved ? "1" : "0";
      showToast(res.saved ? "🔖 সেভ করা হয়েছে" : "সেভ সরানো হয়েছে");
    } catch (err) { alert(err.message); }
    return;
  }

  if (action === "share") {
    const content = postEl.querySelector(".post-content")?.textContent || "";
    const text = content + "\n\n— JUKTOY থেকে";
    try {
      if (navigator.share) await navigator.share({ title: "JUKTOY পোস্ট", text });
      else { await navigator.clipboard.writeText(text); showToast("📋 কপি করা হয়েছে"); }
    } catch (e) {}
    return;
  }

  if (action === "copy") {
    const url = window.location.origin + "/#" + postId;
    try {
      await navigator.clipboard.writeText(url);
      showToast("🔗 লিংক কপি হয়েছে");
    } catch (e) {}
    return;
  }

  if (action === "edit") {
    enterEditMode(postEl, postId);
    return;
  }

  if (action === "delete") {
    if (!confirm("পোস্টটা ডিলিট করবেন?")) return;
    try {
      await api(`/api/posts/${postId}`, { method: "DELETE" });
      postEl.remove();
      showToast("🗑️ ডিলিট হয়েছে");
    } catch (err) { alert(err.message); }
    return;
  }

  if (action === "report") {
    openReportModal("post", postId, btn.dataset.owner || "");
    return;
  }
}


// ==================================================
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

function openReportModal(type, id, username) {
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

function closeReportModal() {
  const modal = document.getElementById("report-modal");
  if (modal) modal.classList.add("hidden");
  _reportTarget = null;
}

async function submitReport() {
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
async function loadMyReports() {
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


// ==================================================
// BADGE UPDATE — Bulletproof
// ==================================================

// Call updateNotifBadge after every meaningful action
const _origLoadFeedForBadge = loadFeed;
loadFeed = async function () {
  await _origLoadFeedForBadge();
  updateNotifBadge().catch(() => {});
};

// Also update on visibility change (user returns to tab)
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.me) {
    updateNotifBadge().catch(() => {});
    updateUnreadBadge().catch(() => {});
  }
});

// Force update right now (if logged in)
if (state.me) {
  setTimeout(() => updateNotifBadge().catch(() => {}), 500);
}


// ==================================================
// EMOJI PICKER
// ==================================================

const EMOJI_HEX = {
  "হাসি": "1F600,1F601,1F602,1F603,1F604,1F605,1F606,1F609,1F60A,1F60B,1F60C,1F60D,1F60F,1F612,1F613,1F614,1F616,1F618,1F61A,1F61C,1F61D,1F61E,1F620,1F621,1F622,1F623,1F625,1F628,1F62A,1F62B,1F62D,1F630,1F631,1F632,1F633,1F635,1F637,1F638,1F639,1F63A,1F63B,1F63C,1F63D,1F63E,1F63F,1F640,1F645,1F646,1F647,1F648,1F649,1F64A",
  "ভালোবাসা": "2764,1F494,1F49B,1F49A,1F499,1F49C,1F49D,1F49E,1F49F,1F48B,1F48C,1F339,1F337,1F33A,1F338,1F33C,1F33B,1F490",
  "হাত": "1F44D,1F44E,1F44C,270A,270B,270C,1F44A,1F446,1F447,1F448,1F449,1F44B,1F44F,1F450,1F64C,1F64F,1F4AA,1F442,1F443,1F440,1F441,1F445,1F444,270D,1F485",
  "প্রাণী": "1F436,1F431,1F42D,1F439,1F430,1F43A,1F438,1F42F,1F428,1F43B,1F437,1F42E,1F417,1F435,1F412,1F434,1F40E,1F42B,1F411,1F418,1F43C,1F40D,1F426,1F424,1F414,1F427,1F41B,1F41D,1F41C,1F41E,1F40C,1F422,1F419,1F41F,1F420,1F421,1F42C,1F433,1F40B,1F40A,1F406,1F405,1F403,1F402,1F404,1F416,1F42A,1F42B,1F413,1F43F,1F54A",
  "খাবার": "1F34F,1F34E,1F34A,1F34B,1F34C,1F349,1F347,1F353,1F348,1F352,1F351,1F34D,1F345,1F346,1F33D,1F360,1F35E,1F356,1F357,1F354,1F35F,1F355,1F373,1F372,1F35C,1F35B,1F35D,1F35A,1F359,1F358,1F365,1F371,1F363,1F362,1F361,1F369,1F36A,1F382,1F370,1F36B,1F36C,1F36D,1F36E,1F36F,1F37C,2615,1F375,1F376,1F37A,1F37B,1F378,1F379,1F37E",
  "কার্যক্রম": "26BD,26BE,1F3C0,1F3C8,1F3BE,1F3D0,1F3B1,1F3B3,1F3AF,1F3AE,1F3B2,1F3B0,1F3A8,1F3AC,1F3A4,1F3A7,1F3BC,1F3B9,1F3B7,1F3BA,1F3B8,1F3BB,1F3AD,1F3C6,1F3C5",
  "ভ্রমণ": "1F697,1F695,1F699,1F68C,1F68E,1F693,1F691,1F692,1F690,1F69A,1F69B,1F69C,1F6B2,1F6A8,2708,1F680,1F681,26F5,1F6A4,1F6A2,2693,1F3E0,1F3E1,1F3E2,1F3E5,1F3E6,1F3E8,1F3EB,26EA,1F3F0,1F3EF,1F5FC,1F5FD,1F30B,1F3D4,1F305,1F304,1F306,1F303,1F308,2600,1F319,2B50,1F31F,2728,26A1,1F525,1F4A7,2744,26C4,1F30A,1F338,1F340,1F343",
  "বস্তু": "231A,1F4F1,1F4BB,1F5A5,1F5A8,1F5B1,1F4F7,1F4F9,1F3A5,1F4DE,260E,1F4FA,1F4FB,23F0,1F50B,1F4A1,1F526,1F4B0,1F4B3,1F48E,1F527,1F528,1F529,2699,1F512,1F513,1F511,1F4DA,1F4D6,270F,1F4DD,1F4CE,1F4CC,1F4CD,1F4C5,1F4CB,1F381,1F388,1F389,1F38A,1F514,1F4E2,1F4E3,1F4AC,1F4AD",
  "প্রতীক": "2705,274C,2B55,2757,2753,26A0,1F530,267B,1F4AF,1F534,1F535,26AB,26AA,2B1B,2B1C,25FC,25FB,2795,2796,2716,2797,27B0,00A9,00AE,2122,2714,2718"
};

function _emojiFromHex(hexStr) {
  return hexStr.split(",").map(function(h) {
    try { return String.fromCodePoint(parseInt(h, 16)); }
    catch(e) { return ""; }
  }).filter(Boolean);
}

const EMOJI_DATA = {};
const EMOJI_ARRAY = {};
for (const k in EMOJI_HEX) {
  EMOJI_ARRAY[k] = _emojiFromHex(EMOJI_HEX[k]);
  EMOJI_DATA[k] = EMOJI_ARRAY[k].join("");
}

let _emojiPickerOpen = false;
let _emojiTargetInput = null;
let _emojiMode = "post";

function openEmojiPicker(targetInputId) {
  // Cleanup
  const old = document.getElementById("emoji-picker");
  if (old && old.parentNode) old.parentNode.removeChild(old);
  document.removeEventListener("click", _emojiOutsideClick);
  const oldSlot = document.getElementById("chat-emoji-slot");
  if (oldSlot) { oldSlot.classList.remove("open"); oldSlot.innerHTML = ""; }

  const inputEl = document.getElementById(targetInputId || "post-content");
  if (!inputEl) return;
  _emojiTargetInput = inputEl;
  _emojiMode = (targetInputId === "chat-input") ? "chat" : "post";

  // Blur so keyboard closes when picker opens
  if (document.activeElement && document.activeElement.blur && document.activeElement !== document.body) {
    try { document.activeElement.blur(); } catch (e) {}
  }

  const picker = document.createElement("div");
  picker.id = "emoji-picker";
  picker.className = "emoji-picker" + (_emojiMode === "chat" ? " emoji-picker-chat" : "");

  const tabsHTML = Object.keys(EMOJI_HEX)
    .map(function(cat, i) {
      return '<button type="button" class="ep-tab ' + (i === 0 ? "active" : "") +
             '" data-cat="' + cat + '">' + cat + '</button>';
    }).join("");

  picker.innerHTML =
    '<div class="ep-header">' +
      '<div class="ep-preview" id="ep-preview">ইমোজি ট্যাপ করুন...</div>' +
      '<button type="button" class="ep-backspace" title="শেষ অক্ষর মুছুন"><i class="fa-solid fa-delete-left"></i></button>' +
      '<button type="button" class="ep-close" title="বন্ধ"><i class="fa-solid fa-xmark"></i></button>' +
    '</div>' +
    '<div class="ep-tabs">' + tabsHTML + '</div>' +
    '<div class="ep-grid" id="ep-grid"></div>';

  // Insert into DOM first
  if (_emojiMode === "chat") {
    const slot = document.getElementById("chat-emoji-slot");
    if (slot) slot.appendChild(picker);
    else document.body.appendChild(picker);
  } else {
    document.body.appendChild(picker);
  }

  _emojiPickerOpen = true;

  // Grid click
  picker.querySelector("#ep-grid").addEventListener("click", function(e) {
    const btn = e.target.closest(".ep-emoji");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    _handleEmojiClick(btn.textContent);
  });

  // Tabs
  picker.querySelectorAll(".ep-tab").forEach(function(tab) {
    tab.addEventListener("click", function() {
      picker.querySelectorAll(".ep-tab").forEach(function(t) { t.classList.remove("active"); });
      tab.classList.add("active");
      _renderEmojiCategory(tab.dataset.cat, picker);
    });
  });

  // Backspace
  picker.querySelector(".ep-backspace").addEventListener("click", function(e) {
    e.stopPropagation();
    _backspaceEmoji();
  });

  // Close
  picker.querySelector(".ep-close").addEventListener("click", function(e) {
    e.stopPropagation();
    closeEmojiPicker();
  });

  // Chat slot open
  if (_emojiMode === "chat") {
    const slot = document.getElementById("chat-emoji-slot");
    if (slot) {
      void slot.offsetHeight;
      requestAnimationFrame(function() { slot.classList.add("open"); });
    }
  }

  // Render emojis after layout settles
  const doRender = function() {
    if (!document.getElementById("emoji-picker")) return;
    _renderEmojiCategory(Object.keys(EMOJI_HEX)[0], picker);
    picker.querySelectorAll(".ep-tab").forEach(function(t, i) {
      t.classList.toggle("active", i === 0);
    });
    _updateEpPreview();
  };
  requestAnimationFrame(doRender);
  setTimeout(doRender, 50);
  setTimeout(doRender, 200);

  setTimeout(function() { document.addEventListener("click", _emojiOutsideClick); }, 0);
}

function _handleEmojiClick(emoji) {
  insertEmoji(emoji);
  saveRecentEmoji(emoji);
  if (_emojiMode === "chat") _updateEpPreview();
}

function _updateEpPreview() {
  const preview = document.getElementById("ep-preview");
  if (!preview) return;
  const inp = _emojiTargetInput;
  if (inp && inp.value) {
    const arr = Array.from(inp.value);
    const tail = arr.slice(-24).join("");
    preview.textContent = tail;
    preview.classList.add("has-content");
  } else {
    preview.textContent = "ইমোজি ট্যাপ করুন...";
    preview.classList.remove("has-content");
  }
  preview.classList.add("pulse");
  setTimeout(function() { preview.classList.remove("pulse"); }, 300);
}

function _renderEmojiCategory(cat, picker) {
  const arr = EMOJI_ARRAY[cat] || [];
  const grid = picker.querySelector("#ep-grid");
  if (!grid || !arr.length) return;
  grid.innerHTML = arr.map(function(e) { return '<button type="button" class="ep-emoji">' + e + '</button>'; }).join("");
}

function insertEmoji(emoji) {
  const ta = _emojiTargetInput || document.getElementById("post-content");
  if (!ta) return;
  const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
  const end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  ta.value = before + emoji + after;
  try { ta.selectionStart = ta.selectionEnd = start + emoji.length; } catch (e) {}
  // IMPORTANT: do NOT call ta.focus() — keeps keyboard closed
  if (ta.id === "post-content" && typeof updateComposerState === "function") updateComposerState();
  if (typeof _syncPostBtnState === "function") _syncPostBtnState();
  _updateEpPreview();
}

function _backspaceEmoji() {
  const ta = _emojiTargetInput || document.getElementById("post-content");
  if (!ta || !ta.value) return;
  const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
  const end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;

  if (start !== end) {
    // Delete selection
    ta.value = ta.value.slice(0, start) + ta.value.slice(end);
    try { ta.selectionStart = ta.selectionEnd = start; } catch (e) {}
  } else if (start > 0) {
    // Delete one grapheme (emoji may be multi-codepoint)
    const beforeArr = Array.from(ta.value.slice(0, start));
    beforeArr.pop();
    const newBefore = beforeArr.join("");
    const after = ta.value.slice(start);
    ta.value = newBefore + after;
    try { ta.selectionStart = ta.selectionEnd = newBefore.length; } catch (e) {}
  }

  if (ta.id === "post-content" && typeof updateComposerState === "function") updateComposerState();
  if (typeof _syncPostBtnState === "function") _syncPostBtnState();
  _updateEpPreview();
}

function closeEmojiPicker() {
  const picker = document.getElementById("emoji-picker");
  if (picker) picker.remove();
  const slot = document.getElementById("chat-emoji-slot");
  if (slot) {
    slot.classList.remove("open");
    slot.innerHTML = "";
  }
  _emojiPickerOpen = false;
  document.removeEventListener("click", _emojiOutsideClick);
}

function _emojiOutsideClick(e) {
  if (e.target.closest("#emoji-picker")) return;
  if (e.target.closest("#btn-emoji")) return;
  if (e.target.closest("#chat-emoji-btn")) return;
  closeEmojiPicker();
}

function getRecentEmojis() {
  try {
    const raw = JSON.parse(localStorage.getItem("juktoy_recent_emojis") || "[]");
    return raw.filter(function(e) {
      if (!e || typeof e !== "string") return false;
      if (e === "?" || e === "\uFFFD" || e === "\uFFFE") return false;
      // Must be a valid string with at least one emoji-range code point
      const arr = Array.from(e);
      return arr.some(function(ch) {
        const cp = ch.codePointAt(0);
        return cp > 0x2000 && cp < 0x1FAFF;
      });
    }).slice(0, 16);
  } catch (e) { return []; }
}

function saveRecentEmoji(e) {
  if (!e || e === "?") return;
  try {
    let list = getRecentEmojis().filter(function(x) { return x !== e; });
    list.unshift(e);
    list = list.slice(0, 16);
    localStorage.setItem("juktoy_recent_emojis", JSON.stringify(list));
  } catch (err) {}
}


// Wire button
document.addEventListener("click", (e) => {
  const postBtn = e.target.closest("#btn-emoji");
  if (postBtn) {
    e.preventDefault();
    e.stopPropagation();
    openEmojiPicker("post-content");
    return;
  }
  const chatBtn = e.target.closest("#chat-emoji-btn");
  if (chatBtn) {
    e.preventDefault();
    e.stopPropagation();
    openEmojiPicker("chat-input");
  }
}, true);

// Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && _emojiPickerOpen) closeEmojiPicker();
});

// Exclude emoji button from generic toast handler
document.querySelectorAll('.c-icon-btn[data-tool="emoji"]').forEach((b) => {
  b.dataset.emojiBound = "1";
});


// ==================================================
// BETTER FEED UX — skeleton + empty state + pull-to-refresh
// ==================================================

function _feedSkeletonHTML() {
  var sk = '';
  for (var i = 0; i < 3; i++) {
    sk += '<div class="post-skeleton">' +
      '<div class="sk-header">' +
        '<div class="sk-avatar"></div>' +
        '<div class="sk-lines">' +
          '<div class="sk-line sk-line-1"></div>' +
          '<div class="sk-line sk-line-2"></div>' +
        '</div>' +
      '</div>' +
      '<div class="sk-content">' +
        '<div class="sk-line sk-line-3"></div>' +
        '<div class="sk-line sk-line-4"></div>' +
      '</div>' +
    '</div>';
  }
  return sk;
}

function _feedEmptyHTML() {
  return '<div class="empty-state">' +
    '<div class="empty-state-icon">🌱</div>' +
    '<h3 class="empty-state-title">ফিড এখনো ফাঁকা</h3>' +
    '<p class="empty-state-text">প্রথম পোস্ট আপনিই করুন — সবাই দেখতে পাবে!<br>অথবা নতুন মানুষ খুঁজে ফলো করুন।</p>' +
    '<div class="empty-state-actions">' +
      '<button type="button" class="empty-state-btn" id="empty-create-post">' +
        '<i class="fa-solid fa-plus"></i> পোস্ট তৈরি করুন' +
      '</button>' +
      '<button type="button" class="empty-state-btn secondary" id="empty-explore">' +
        '<i class="fa-regular fa-compass"></i> মানুষ খুঁজুন' +
      '</button>' +
    '</div>' +
  '</div>';
}

function _bindEmptyFeedEvents() {
  var c = document.getElementById("empty-create-post");
  if (c) c.addEventListener("click", function() {
    var ta = document.getElementById("post-content");
    if (ta) { ta.focus(); ta.scrollIntoView({behavior:"smooth", block:"center"}); }
  });
  var e = document.getElementById("empty-explore");
  if (e) e.addEventListener("click", function() {
    if (typeof openExplorePage === "function") openExplorePage();
  });
}

// Override loadFeed to show skeleton + better empty state
var _origLoadFeedForUX = loadFeed;
loadFeed = async function () {
  var list = document.getElementById("feed-list");
  if (!list) return _origLoadFeedForUX();

  var hadContent = list.children.length > 0;
  if (!hadContent) list.innerHTML = _feedSkeletonHTML();

  await _origLoadFeedForUX();

  var first = list.firstElementChild;
  if (first && first.classList.contains("post") &&
      first.textContent.indexOf("প্রথম পোস্ট আপনিই করুন") !== -1) {
    list.innerHTML = _feedEmptyHTML();
    _bindEmptyFeedEvents();
  }
};

// ============== Pull to refresh ==============

var _ptrReady = false;
function _setupPullToRefresh() {
  if (_ptrReady) return;
  _ptrReady = true;

  var startY = 0;
  var pulling = false;
  var indicator = null;

  function isHomeVisible() {
    var hideIds = ["profile-page", "messages-page", "explore-page", "hashtag-page",
                   "notifications-page", "saved-page", "reels-page", "settings-page"];
    for (var i = 0; i < hideIds.length; i++) {
      var el = document.getElementById(hideIds[i]);
      if (el && !el.classList.contains("hidden")) return false;
    }
    var av = document.getElementById("app-view");
    return av && !av.classList.contains("hidden");
  }

  document.addEventListener("touchstart", function (e) {
    if (!isHomeVisible()) return;
    if (window.scrollY > 5) return;
    if (e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    if (!pulling) return;
    if (window.scrollY > 5) { pulling = false; return; }
    var dy = e.touches[0].clientY - startY;
    if (dy > 70) {
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.className = "pull-refresh-indicator";
        document.body.appendChild(indicator);
        if (navigator.vibrate) navigator.vibrate(8);
      }
      if (dy > 120) {
        indicator.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> ছেড়ে দিন';
        indicator.classList.add("ready");
      } else {
        indicator.innerHTML = '<i class="fa-solid fa-arrow-down"></i> টেনে ছাড়ুন';
        indicator.classList.remove("ready");
      }
    } else if (indicator) {
      indicator.parentNode.removeChild(indicator);
      indicator = null;
    }
  }, { passive: true });

  document.addEventListener("touchend", async function () {
    if (!indicator) { pulling = false; return; }
    if (!indicator.classList.contains("ready")) {
      indicator.parentNode.removeChild(indicator);
      indicator = null;
      pulling = false;
      return;
    }
    indicator.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> লোড হচ্ছে...';
    try {
      await loadFeed();
      if (typeof updateNotifBadge === "function") updateNotifBadge().catch(function(){});
      if (typeof updateUnreadBadge === "function") updateUnreadBadge().catch(function(){});
      if (navigator.vibrate) navigator.vibrate([10, 50, 10]);
    } catch (err) {}
    setTimeout(function () {
      if (indicator && indicator.parentNode) indicator.parentNode.removeChild(indicator);
      indicator = null;
    }, 400);
    pulling = false;
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () { setTimeout(_setupPullToRefresh, 500); });
} else {
  setTimeout(_setupPullToRefresh, 500);
}


// ==================================================
// LIKE LIST + STORY VIEWERS
// ==================================================

const _REACTION_EMOJI = {
  like: "👍", love: "❤️", haha: "😆",
  wow: "😮", sad: "😢", angry: "😡"
};

function openUserListModal(title, users, emptyText) {
  const old = document.getElementById("user-list-modal");
  if (old) old.remove();

  const modal = document.createElement("div");
  modal.id = "user-list-modal";
  modal.className = "modal";

  let bodyHTML;
  if (!users.length) {
    bodyHTML = `<p class="user-list-empty">${escapeHtml(emptyText)}</p>`;
  } else {
    bodyHTML = users.map(function(u) {
      const reactionEmoji = u.reaction && _REACTION_EMOJI[u.reaction]
        ? `<div class="user-list-reaction">${_REACTION_EMOJI[u.reaction]}</div>` : "";
      return '<div class="user-list-item" data-username="' + escapeHtml(u.username) + '">' +
        '<div class="user-list-avatar">' + avatarInner(u.display_name, u.profile_pic) + '</div>' +
        '<div class="user-list-info">' +
          '<div class="user-list-name">' + escapeHtml(u.display_name) + '</div>' +
          '<div class="user-list-username">@' + escapeHtml(u.username) + '</div>' +
        '</div>' + reactionEmoji + '</div>';
    }).join("");
  }

  modal.innerHTML =
    '<div class="modal-content user-list-modal-content">' +
      '<div class="user-list-header">' +
        '<h3 class="user-list-title">' + escapeHtml(title) + '</h3>' +
        '<button type="button" class="close-btn" id="user-list-close">&times;</button>' +
      '</div>' +
      '<div class="user-list-body">' + bodyHTML + '</div>' +
    '</div>';

  document.body.appendChild(modal);

  modal.querySelector("#user-list-close").addEventListener("click", function() { modal.remove(); });
  modal.addEventListener("click", function(e) { if (e.target === modal) modal.remove(); });
  modal.querySelectorAll(".user-list-item[data-username]").forEach(function(el) {
    el.addEventListener("click", function() {
      modal.remove();
      if (typeof openProfile === "function") openProfile(el.dataset.username);
    });
  });
}

async function openLikesList(postId) {
  try {
    const users = await api("/api/posts/" + postId + "/likes");
    openUserListModal("লাইক দিয়েছেন", users, "এখনো কেউ লাইক দেয়নি");
  } catch (err) {
    showToast("লোড করা যায়নি");
  }
}

async function openStoryViewers(storyId) {
  try {
    const users = await api("/api/stories/" + storyId + "/viewers");
    openUserListModal("স্টোরি দেখেছেন", users, "এখনো কেউ দেখেনি");
  } catch (err) {
    showToast("লোড করা যায়নি");
  }
}

// Event delegation — likes line + story views btn + comment avatars
document.addEventListener("click", function(e) {
  var likesLine = e.target.closest(".post-likes-line");
  if (likesLine) {
    e.preventDefault();
    e.stopPropagation();
    openLikesList(parseInt(likesLine.dataset.postId));
    return;
  }
  var svBtn = e.target.closest(".sv-views-btn");
  if (svBtn) {
    e.preventDefault();
    e.stopPropagation();
    openStoryViewers(parseInt(svBtn.dataset.storyId));
    return;
  }
}, true);


// ==================================================
// STORY REACTIONS
// ==================================================

document.addEventListener("click", async function(e) {
  var btn = e.target.closest(".sv-react");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();

  var bar = document.getElementById("sv-reactions-bar");
  if (!bar) return;
  var storyId = bar.dataset.storyId;
  if (!storyId) return;

  var reaction = btn.dataset.r;
  if (!reaction) return;

  // Visual feedback
  btn.classList.add("active");
  if (navigator.vibrate) navigator.vibrate(10);

  // Flying emoji animation
  var fly = document.createElement("div");
  fly.className = "sv-react-fly";
  fly.textContent = btn.textContent;
  var rect = btn.getBoundingClientRect();
  fly.style.left = rect.left + rect.width / 2 + "px";
  fly.style.top = rect.top + "px";
  document.body.appendChild(fly);
  setTimeout(function() { if (fly.parentNode) fly.parentNode.removeChild(fly); }, 1200);

  try {
    await api("/api/stories/" + storyId + "/react", {
      method: "POST",
      body: JSON.stringify({ reaction: reaction }),
    });
    // S18.9f — removed toast (visual feedback sufficient)
  } catch (err) {
    btn.classList.remove("active");
    // Duplicate reaction is not an error
    if (err.message && err.message.indexOf("নিজের") !== -1) {
      showToast("নিজের স্টোরিতে reaction দেওয়া যাবে না");
    }
  } finally {
    setTimeout(function() { btn.classList.remove("active"); }, 600);
  }
}, true);


// ==================================================
// S19.12 — STORY VIEWER: swipe-down to close
// ==================================================
(function () {
  let startY = 0;
  let startX = 0;
  let dragging = false;
  let currentY = 0;

  function isViewerOpen() {
    var v = document.getElementById("story-viewer");
    return v && !v.classList.contains("hidden");
  }

  document.addEventListener("touchstart", function (e) {
    if (!isViewerOpen()) return;
    if (e.touches.length !== 1) return;
    // Don't start if on interactive elements
    if (e.target.closest(".sv-nav, .sv-close, .sv-delete, .sv-reactions-bar, .sv-reply-bar, button")) return;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    currentY = startY;
    dragging = true;
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    if (!dragging) return;
    currentY = e.touches[0].clientY;
    var dy = currentY - startY;
    var dx = e.touches[0].clientX - startX;
    // Only vertical down
    if (dy < 0) return;
    if (Math.abs(dx) > Math.abs(dy)) return;
    var container = document.querySelector(".sv-container");
    if (!container) return;
    container.style.transition = "none";
    container.style.transform = "translateY(" + dy + "px) scale(" + (1 - Math.min(dy / 1000, 0.15)) + ")";
    container.style.opacity = String(Math.max(1 - dy / 400, 0.3));
  }, { passive: true });

  document.addEventListener("touchend", function () {
    if (!dragging) return;
    var dy = currentY - startY;
    dragging = false;
    var container = document.querySelector(".sv-container");
    if (!container) return;
    if (dy > 100) {
      // Close
      container.style.transition = "transform 0.25s ease, opacity 0.25s ease";
      container.style.transform = "translateY(100vh) scale(0.85)";
      container.style.opacity = "0";
      setTimeout(function () {
        if (typeof closeStoryViewer === "function") closeStoryViewer();
        container.style.transform = "";
        container.style.opacity = "";
        container.style.transition = "";
      }, 260);
    } else {
      // Snap back
      container.style.transition = "transform 0.25s var(--ease-spring), opacity 0.25s";
      container.style.transform = "";
      container.style.opacity = "";
      setTimeout(function () {
        container.style.transition = "";
      }, 280);
    }
  });
})();


// ==================================================
// S19.6 — STORY VIEWER: click profile → open profile
// ==================================================
document.addEventListener("click", function (e) {
  var el = e.target.closest(".sv-avatar, .sv-name");
  if (!el) return;
  // Find current story group
  if (typeof storyGroups === "undefined" || !storyGroups.length) return;
  if (typeof currentGroupIdx !== "number") return;
  var group = storyGroups[currentGroupIdx];
  if (!group || !group.user) return;
  e.preventDefault();
  e.stopPropagation();

  // Close story viewer first
  if (typeof closeStoryViewer === "function") {
    closeStoryViewer();
  }
  // Slight delay so viewer closes before profile opens
  setTimeout(function () {
    if (typeof openProfile === "function") openProfile(group.user.username);
  }, 150);
}, true);


// ==================================================
// STORY TIMER CONTROL (pause / resume / reset)
// ==================================================

function _storyTimerStart(duration) {
  clearTimeout(storyTimer);
  _storyTimerDuration = duration || 5000;
  _storyTimerRemaining = _storyTimerDuration;
  _storyTimerStartTime = Date.now();
  _storyTimerPaused = false;
  storyTimer = setTimeout(function() { nextStory(); }, _storyTimerRemaining);
  _updateStoryProgressBar(_storyTimerDuration);
}

function _storyTimerStop() {
  clearTimeout(storyTimer);
  storyTimer = null;
  _storyTimerPaused = false;
  _storyTimerRemaining = _storyTimerDuration;
}

function _storyTimerPause() {
  if (_storyTimerPaused || !storyTimer) return;
  clearTimeout(storyTimer);
  storyTimer = null;
  var elapsed = Date.now() - _storyTimerStartTime;
  _storyTimerRemaining = Math.max(500, _storyTimerRemaining - elapsed);
  _storyTimerPaused = true;
  _freezeStoryProgressBar();
}

function _storyTimerResume() {
  if (!_storyTimerPaused) return;
  _storyTimerPaused = false;
  _storyTimerStartTime = Date.now();
  storyTimer = setTimeout(function() { nextStory(); }, _storyTimerRemaining);
  _resumeStoryProgressBar(_storyTimerRemaining);
}

function _storyTimerReset() {
  _storyTimerStart(_storyTimerDuration);
}

// Progress bar sync — restart CSS animation
function _updateStoryProgressBar(duration) {
  var active = document.querySelector(".sv-progress-bar.active .sv-progress-fill");
  if (!active) return;
  active.style.transition = "none";
  active.style.width = "0%";
  void active.offsetWidth;
  active.style.transition = "width " + (duration / 1000) + "s linear";
  active.style.width = "100%";
}

function _freezeStoryProgressBar() {
  var active = document.querySelector(".sv-progress-bar.active .sv-progress-fill");
  if (!active) return;
  var w = getComputedStyle(active).width;
  active.style.transition = "none";
  active.style.width = w;
}

function _resumeStoryProgressBar(remaining) {
  var active = document.querySelector(".sv-progress-bar.active .sv-progress-fill");
  if (!active) return;
  var currentPct = 0;
  try { currentPct = parseFloat(getComputedStyle(active).width) /
    parseFloat(getComputedStyle(active.parentNode).width) * 100 || 0; } catch (e) {}
  var remainingPct = 100 - currentPct;
  var durSec = remaining / 1000;
  active.style.transition = "none";
  active.style.width = currentPct + "%";
  void active.offsetWidth;
  active.style.transition = "width " + durSec + "s linear";
  active.style.width = "100%";
}

// ---- Event wiring ----

// S30.33 — reset timer on reaction, but ONLY for image stories
// (was: video stories got a 5s timer after reacting → advanced before video ended)
document.addEventListener("click", function(e) {
  var btn = e.target.closest(".sv-react");
  if (!btn) return;
  var group = storyGroups[currentGroupIdx];
  if (!group) return;
  var story = group.stories[currentStoryIdx];
  if (!story) return;
  // skip for video stories — they use onended
  if (story.media_type === "video") return;
  _storyTimerReset();
}, true);

// Pause on keyboard open (input focus)
document.addEventListener("focusin", function(e) {
  if (e.target && e.target.id === "sv-reply-input") {
    _storyTimerPause();
  }
});

// Resume on keyboard close (input blur)
document.addEventListener("focusout", function(e) {
  if (e.target && e.target.id === "sv-reply-input") {
    setTimeout(function() {
      // S30.29 — only reset timer if viewer is still OPEN
      // (was: viewer close via X triggered focusout → timer restart → next story opened)
      var v = document.getElementById("story-viewer");
      if (!v || v.classList.contains("hidden")) return;
      if (document.getElementById("sv-reply-input") &&
          document.activeElement !== document.getElementById("sv-reply-input")) {
        _storyTimerReset();
      }
    }, 100);
  }
});

// Pause on touch hold (long press on media)
document.addEventListener("touchstart", function(e) {
  if (!e.target.closest(".sv-media")) return;
  if (e.target.closest(".sv-reactions-bar")) return;
  if (e.target.closest(".sv-reply-bar")) return;
  // don't pause immediately — wait to see if it's a hold
  window._svHoldTimer = setTimeout(function() {
    _storyTimerPause();
    window._svHolding = true;
  }, 250);
}, { passive: true });

document.addEventListener("touchend", function() {
  clearTimeout(window._svHoldTimer);
  if (window._svHolding) {
    window._svHolding = false;
    _storyTimerResume();
  }
});

document.addEventListener("touchcancel", function() {
  clearTimeout(window._svHoldTimer);
  if (window._svHolding) {
    window._svHolding = false;
    _storyTimerResume();
  }
});


// ==================================================
// ONBOARDING FLOW
// ==================================================

let _obState = { step: 1, pendingAvatar: null, pendingCover: null, followed: new Set() };

async function startOnboarding() {
  const el = document.getElementById("onboarding");
  if (!el) return;
  el.classList.remove("hidden");
  _obGoStep(1);
}

function _obGoStep(n) {
  _obState.step = n;
  document.querySelectorAll(".ob-step").forEach(function(s) {
    s.classList.toggle("hidden", parseInt(s.dataset.step) !== n);
  });
  document.querySelectorAll(".ob-dot").forEach(function(d) {
    var dn = parseInt(d.dataset.step);
    d.classList.toggle("active", dn === n);
    d.classList.toggle("done", dn < n);
  });

  if (n === 2) {
    var av = document.getElementById("ob-avatar");
    if (av && state.me) setAvatar(av, state.me.display_name, state.me.profile_pic);
    var cov = document.getElementById("ob-cover");
    if (cov && state.me && state.me.cover_pic) {
      cov.innerHTML = '<img src="' + state.me.cover_pic + '" alt="" loading="lazy" decoding="async">';
      cov.classList.add("has-image");
    }
  }
  if (n === 3) _obLoadUsers();
}

async function _obLoadUsers() {
  var wrap = document.getElementById("ob-users");
  if (!wrap) return;
  wrap.innerHTML = '<p class="ob-loading">লোড হচ্ছে...</p>';
  try {
    var users = await api("/api/explore/suggested-users");
    if (!users.length) {
      wrap.innerHTML = '<p class="ob-loading">এখনো কোনো সাজেশন নেই। পরে আবার দেখুন।</p>';
      return;
    }
    wrap.innerHTML = users.slice(0, 6).map(function(u) {
      return '<div class="ob-user" data-username="' + escapeHtml(u.username) + '">' +
        '<div class="ob-user-avatar">' + avatarInner(u.display_name, u.profile_pic) + '</div>' +
        '<div class="ob-user-info">' +
          '<div class="ob-user-name">' + escapeHtml(u.display_name) + '</div>' +
          '<div class="ob-user-meta">@' + escapeHtml(u.username) + ' • ' + (u.followers || 0) + ' ফলোয়ার</div>' +
        '</div>' +
        '<button class="ob-follow-btn" data-username="' + escapeHtml(u.username) + '">' +
          '<i class="fa-solid fa-user-plus"></i> ফলো' +
        '</button>' +
      '</div>';
    }).join("");

    wrap.querySelectorAll(".ob-follow-btn").forEach(function(btn) {
      btn.addEventListener("click", async function(e) {
        e.stopPropagation();
        var uname = btn.dataset.username;
        if (_obState.followed.has(uname)) return;
        btn.disabled = true;
        try {
          await api("/api/users/" + encodeURIComponent(uname) + "/follow", { method: "POST" });
          _obState.followed.add(uname);
          btn.classList.add("following");
          btn.innerHTML = '<i class="fa-solid fa-check"></i> ফলো করছেন';
        } catch (err) {
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    wrap.innerHTML = '<p class="ob-loading">লোড করা যায়নি</p>';
  }
}

async function _obFinish(skipped) {
  // Save bio + avatar if set
  if (!skipped) {
    try {
      var bio = (document.getElementById("ob-bio").value || "").trim();
      if (bio) {
        await api("/api/me/bio", {
          method: "POST",
          body: JSON.stringify({ bio: bio, display_name: state.me.display_name })
        });
        state.me.bio = bio;
      }
      if (_obState.pendingAvatar) {
        var r = await api("/api/me/avatar", {
          method: "POST",
          body: JSON.stringify({ avatar: _obState.pendingAvatar })
        });
        state.me.profile_pic = r.avatar;
      }
      // S22 / Series 7 — onboarding cover photo was being lost
      if (_obState.pendingCover) {
        var rc = await api("/api/me/cover", {
          method: "POST",
          body: JSON.stringify({ cover: _obState.pendingCover })
        });
        state.me.cover_pic = rc.cover;
      }
    } catch (e) {}
  }

  // Mark onboarded
  try {
    await api("/api/me/onboarded", { method: "POST" });
    if (state.me) state.me.onboarded = 1;
  } catch (e) {}

  var el = document.getElementById("onboarding");
  if (el) el.classList.add("hidden");

  if (typeof refreshProfileUI === "function") refreshProfileUI();
  if (typeof loadFeed === "function") loadFeed();
  if (typeof loadRightSidebar === "function") loadRightSidebar();
}

// -------- Wire up --------

document.addEventListener("click", function(e) {
  // Next button
  var next = e.target.closest("[data-next]");
  if (next) { e.preventDefault(); _obGoStep(parseInt(next.dataset.next)); return; }
  // Back button
  var back = e.target.closest("[data-back]");
  if (back) { e.preventDefault(); _obGoStep(parseInt(back.dataset.back)); return; }
  // Skip
  var skip = e.target.closest("[data-skip]");
  if (skip) { e.preventDefault(); _obFinish(true); return; }
  // Finish
  if (e.target.closest("#ob-finish")) { e.preventDefault(); _obFinish(false); return; }
  // Avatar button
  if (e.target.closest("#ob-avatar-btn")) {
    e.preventDefault();
    var inp = document.getElementById("ob-avatar-input");
    if (inp) inp.click();
    return;
  }
  // Cover button
  if (e.target.closest("#ob-cover-btn")) {
    e.preventDefault();
    var cinp = document.getElementById("ob-cover-input");
    if (cinp) cinp.click();
    return;
  }
  // Cover area click also opens picker
  if (e.target.closest("#ob-cover") && !e.target.closest("#ob-cover-btn")) {
    e.preventDefault();
    var cinp2 = document.getElementById("ob-cover-input");
    if (cinp2) cinp2.click();
    return;
  }
});

// Avatar upload
var _obAvatarInput = document.getElementById("ob-avatar-input");
if (_obAvatarInput) {
  _obAvatarInput.addEventListener("change", async function(e) {
    var file = e.target.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      var btn = document.getElementById("ob-avatar-btn");
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      var resized = await resizeImage(file, 400, 0.85);
      _obState.pendingAvatar = resized;
      var av = document.getElementById("ob-avatar");
      av.innerHTML = '<img src="' + resized + '" alt="" loading="lazy" decoding="async">';
    } catch (err) {} finally {
      document.getElementById("ob-avatar-btn").innerHTML = '<i class="fa-solid fa-camera"></i>';
      _obAvatarInput.value = "";
    }
  });
}

// Cover upload
var _obCoverInput = document.getElementById("ob-cover-input");
if (_obCoverInput) {
  _obCoverInput.addEventListener("change", async function(e) {
    var file = e.target.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      var btn = document.getElementById("ob-cover-btn");
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> লোড হচ্ছে...';
      var resized = await resizeImage(file, 1200, 0.82);
      _obState.pendingCover = resized;
      var cov = document.getElementById("ob-cover");
      cov.innerHTML = '<img src="' + resized + '" alt="" loading="lazy" decoding="async">';
      cov.classList.add("has-image");
    } catch (err) {
      alert("কভার লোড করা যায়নি");
    } finally {
      document.getElementById("ob-cover-btn").innerHTML = '<i class="fa-solid fa-camera"></i> কভার';
      _obCoverInput.value = "";
    }
  });
}

// Auto-start for new users after enterApp
const _origEnterAppOb = enterApp;
enterApp = async function () {
  await _origEnterAppOb();
  if (state.me && !state.me.onboarded) {
    setTimeout(function() { startOnboarding(); }, 400);
  }
};


// ==================================================
// CHAT: image, reply, reaction, delete
// ==================================================

let _chatPendingImage = null;
let _chatReplyTo = null;

// ---- Attach button ----
var _chatImageInput = document.getElementById("chat-image-input");

if (_chatImageInput) {
  _chatImageInput.addEventListener("change", async function(e) {
    var file = e.target.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      var resized = await resizeImage(file, 800, 0.82);
      _chatPendingImage = resized;
      var prev = document.getElementById("chat-image-preview");
      var img = document.getElementById("chat-image-preview-img");
      img.src = resized;
      prev.classList.remove("hidden");
    } catch (err) {
      alert("ছবি লোড করা যায়নি");
    } finally {
      _chatImageInput.value = "";
    }
  });
}

// ---- Remove image ----
var _chatImgRemove = document.getElementById("chat-image-remove");
if (_chatImgRemove) {
  _chatImgRemove.addEventListener("click", function() {
    _chatPendingImage = null;
    document.getElementById("chat-image-preview").classList.add("hidden");
    document.getElementById("chat-image-preview-img").src = "";
  });
}

// ---- Cancel reply ----
var _chatReplyClose = document.getElementById("crp-close");
if (_chatReplyClose) {
  _chatReplyClose.addEventListener("click", function() {
    _chatReplyTo = null;
    document.getElementById("chat-reply-preview").classList.add("hidden");
  });
}

// ---- Send handler (delegation — no clone) ----
document.addEventListener("submit", async function(e) {
  var form = e.target.closest("#chat-form");
  if (!form) return;
  e.preventDefault();

  var input = form.querySelector("#chat-input");
  if (!input) return;
  var text = (input.value || "").trim();
  var image = _chatPendingImage || "";
  if (!text && !image) return;
  if (!currentChatUser) return;

  var wasFocused = document.activeElement === input;
  input.value = "";

  // Optimistic UI
  var temp = document.createElement("div");
  temp.className = "chat-msg outgoing" + (image ? " has-image" : "");
  var tempHTML = "";
  if (_chatReplyTo) {
    tempHTML += '<div class="chat-msg-reply"><div class="cmr-name">' + escapeHtml(_chatReplyTo.name || "") + '</div><div class="cmr-text">' + escapeHtml(_chatReplyTo.text || "") + '</div></div>';
  }
  if (image) tempHTML += '<div class="chat-msg-image"><img src="' + escapeHtml(image) + '" alt="" loading="lazy" decoding="async"></div>';
  if (text) tempHTML += '<div class="chat-msg-text">' + escapeHtml(text) + '</div>';
  tempHTML += '<div class="chat-msg-time">এইমাত্র</div>';
  temp.innerHTML = tempHTML;
  chatMessages.appendChild(temp);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  lastMsgCount++;

  var payload = { content: text, image: image };
  if (_chatReplyTo) payload.parent_id = _chatReplyTo.id;

  try {
    await api("/api/messages/" + encodeURIComponent(currentChatUser), {
      method: "POST",
      body: JSON.stringify(payload),
    });
    _chatPendingImage = null;
    _chatReplyTo = null;
    var ip = document.getElementById("chat-image-preview");
    if (ip) ip.classList.add("hidden");
    var rp = document.getElementById("chat-reply-preview");
    if (rp) rp.classList.add("hidden");
    await loadChatMessages(true);
    await loadConversations();
  } catch (err) {
    temp.remove();
    lastMsgCount--;
    alert(err.message);
  } finally {
    // ALWAYS refocus — keep keyboard up for continuous typing
    try { input.focus({ preventScroll: true }); } catch (e) {}
  }
}, true);

// Prevent individual chat send button from stealing focus (keep keyboard up)
// We only block mousedown (desktop) — allow normal click to submit
(function () {
  var sendBtn = document.getElementById("chat-send-btn");
  if (!sendBtn) return;
  sendBtn.addEventListener("mousedown", function (e) { e.preventDefault(); });
})();

// ---- Attach button delegation (works even if form cloned) ----
document.addEventListener("click", function(e) {
  var btn = e.target.closest("#chat-attach-btn");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  var inp = document.getElementById("chat-image-input");
  if (inp) inp.click();
}, true);

// ---- Long press context menu + double-tap reaction ----
var _lpTimer = null;
var _lpMsgId = null;
var _lpMsgEl = null;
var _lastTapMs = 0;
var _lastTapId = null;

function _chatMsgMenu(msgId, isMine, senderName, text, msgEl) {
  var root = document.getElementById("chat-msg-menu");
  if (root) root.remove();

  var isStarred = msgEl && msgEl.dataset.starred === "1";
  var hasText = !!(text && text.trim());
  var hasImage = msgEl && msgEl.querySelector(".chat-msg-image");

  // ============ ROOT ============
  root = document.createElement("div");
  root.id = "chat-msg-menu";
  root.className = "chat-msg-menu-root";
  root.innerHTML = '<div class="cmm-backdrop"></div>';
  document.body.appendChild(root);
  requestAnimationFrame(function () { root.classList.add("show"); });

  // ============ LEFT RAIL (bottom → top) ============
  var rail = document.createElement("div");
  rail.className = "cmm-rail";

  // DOM order: top of DOM = bottom of stack (using column-reverse)
  // So write: reply, copy, forward, star, select, info, then delete with separator
  var _myKind = msgEl ? (msgEl.dataset.kind || "text") : "text";
  var _canEdit = isMine && _myKind !== "voice" && _myKind !== "system";
  var items = [
    { act: "reply",   icon: "fa-solid fa-reply",         label: "উত্তর" },
    { act: "edit",    icon: "fa-solid fa-pen",           label: "এডিট",  show: _canEdit },
    { act: "copy",    icon: "fa-regular fa-copy",         label: "কপি",   show: hasText },
    { act: "forward", icon: "fa-solid fa-share",          label: "ফরওয়ার্ড" },
    { act: "star",    icon: (isStarred ? "fa-solid" : "fa-regular") + " fa-star", label: (isStarred ? "আনস্টার" : "স্টার") },
    { act: "select",  icon: "fa-solid fa-list-check",     label: "সিলেক্ট" },
    { act: "info",    icon: "fa-solid fa-circle-info",    label: "তথ্য" }
  ];

  items.forEach(function (it) {
    if (it.show === false) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "cmm-rail-btn";
    b.dataset.act = it.act;
    b.setAttribute("aria-label", it.label);
    b.innerHTML = '<i class="' + it.icon + '"></i><span class="cmm-rail-tip">' + it.label + '</span>';
    rail.appendChild(b);
  });

  // Divider + delete (danger) — sits at top of rail
  if (isMine) {
    var sep = document.createElement("div");
    sep.className = "cmm-rail-divider";
    rail.appendChild(sep);

    var del = document.createElement("button");
    del.type = "button";
    del.className = "cmm-rail-btn cmm-rail-danger";
    del.dataset.act = "delete";
    del.setAttribute("aria-label", "মুছুন");
    del.innerHTML = '<i class="fa-regular fa-trash-can"></i><span class="cmm-rail-tip">মুছুন</span>';
    rail.appendChild(del);
  }

  root.appendChild(rail);

  // ============ REACTION STRIP (inline, near message) ============
  var strip = document.createElement("div");
  strip.className = "cmm-reaction-strip";
  strip.innerHTML =
    '<button class="cmm-react" data-react="love" aria-label="love">❤️</button>' +
    '<button class="cmm-react" data-react="like" aria-label="like">👍</button>' +
    '<button class="cmm-react" data-react="haha" aria-label="haha">😂</button>' +
    '<button class="cmm-react" data-react="wow" aria-label="wow">😮</button>' +
    '<button class="cmm-react" data-react="sad" aria-label="sad">😢</button>';
  root.appendChild(strip);

  _positionReactionStrip(strip, msgEl);

  // Entrance
  requestAnimationFrame(function () {
    rail.classList.add("in");
    setTimeout(function () { strip.classList.add("in"); }, 80);
  });

  // ============ CLOSE ============
  function close() {
    root.classList.remove("show");
    rail.classList.remove("in");
    strip.classList.remove("in");
    setTimeout(function () {
      if (root.parentNode) root.parentNode.removeChild(root);
    }, 260);
  }
  root.querySelector(".cmm-backdrop").addEventListener("click", close);

  // ============ REACTIONS ============
  strip.querySelectorAll(".cmm-react").forEach(function (rb) {
    rb.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var reaction = rb.dataset.react;
      var emoji = rb.textContent;
      _flyReactionToMessage(rb, msgEl, emoji);
      setTimeout(close, 100);
      (async function () {
        try {
          var res = await api("/api/messages/" + msgId + "/react", {
            method: "POST",
            body: JSON.stringify({ reaction: reaction }),
          });
          if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
          if (msgEl) {
            setTimeout(function () {
              var oldR = msgEl.querySelector(".chat-msg-reactions");
              if (oldR) oldR.remove();
              var emojiMap = { love: "❤️", like: "👍", haha: "😂", wow: "😮", sad: "😢" };
              var em = emojiMap[res.my_reaction] || emoji;
              if (res.count > 0) {
                var el = document.createElement("div");
                el.className = "chat-msg-reactions landing";
                el.innerHTML = '<span class="cmr-pill">' + em + ' ' + res.count + '</span>';
                msgEl.appendChild(el);
                setTimeout(function () { el.classList.remove("landing"); }, 500);
              }
            }, 520);
          }
        } catch (e) { showToast("রিঅ্যাক্ট করা যায়নি"); }
      })();
    });
  });

  // ============ ACTIONS ============
  rail.querySelectorAll(".cmm-rail-btn").forEach(function (b) {
    b.addEventListener("click", async function (ev) {
      ev.stopPropagation();
      var act = b.dataset.act;
      close();

      if (act === "reply") {
        _chatReplyTo = { id: parseInt(msgId), name: senderName, text: text };
        document.getElementById("crp-name").textContent = senderName;
        document.getElementById("crp-text").textContent = (text || "📷 ছবি").slice(0, 60);
        document.getElementById("chat-reply-preview").classList.remove("hidden");
        var inp = document.getElementById("chat-input");
        if (inp) inp.focus();
      } else if (act === "copy") {
        try { await navigator.clipboard.writeText(text || ""); showToast("📋 কপি করা হয়েছে"); }
        catch (e) { showToast("কপি করা যায়নি"); }
      } else if (act === "forward") {
        try { await _openForwardModal(parseInt(msgId), text); }
        catch (e) { showToast("ফরওয়ার্ড খোলা যায়নি"); }
      } else if (act === "star") {
        try {
          var res = await api("/api/messages/" + msgId + "/star", { method: "POST" });
          if (msgEl) {
            msgEl.dataset.starred = res.starred ? "1" : "0";
            var st = msgEl.querySelector(".chat-msg-starred");
            if (res.starred && !st) {
              st = document.createElement("div");
              st.className = "chat-msg-starred";
              st.title = "স্টার করা";
              st.innerHTML = '<i class="fa-solid fa-star"></i>';
              msgEl.appendChild(st);
            } else if (!res.starred && st) { st.remove(); }
          }
          showToast(res.starred ? "⭐ স্টার করা হয়েছে" : "স্টার সরানো হয়েছে");
        } catch (e) { alert(e.message); }
      } else if (act === "select") {
        _enterChatMultiSelect(parseInt(msgId));
      } else if (act === "info") {
        _showMessageInfo(msgEl, msgId, isMine, senderName);
      } else if (act === "delete") {
        if (!confirm("মেসেজটা মুছবেন?")) return;
        try {
        _openDeleteMessageSheet(msgId, msgEl, isMine);
      } catch (e) { alert(e.message); }
      }
    });
  });
}

// ---------- Position reaction strip near message ----------
function _positionReactionStrip(strip, msgEl) {
  if (!msgEl) return;
  var r = msgEl.getBoundingClientRect();
  var stripW = 224;
  var stripH = 44;
  var pad = 10;
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  var isOut = msgEl.dataset.mine === "1";

  var top;
  if (r.top - stripH - 10 >= pad) top = r.top - stripH - 10;
  else top = r.bottom + 10;
  if (top + stripH > vh - pad) top = vh - stripH - pad;

  var left;
  if (isOut) left = r.right - stripW;
  else left = r.left;
  if (left < pad) left = pad;
  if (left + stripW > vw - pad) left = vw - stripW - pad;

  strip.style.top = top + "px";
  strip.style.left = left + "px";
}

// ---------- Fly reaction emoji ----------
function _flyReactionToMessage(sourceEl, targetEl, emoji) {
  if (!sourceEl || !targetEl) return;
  var sr = sourceEl.getBoundingClientRect();
  var tr = targetEl.getBoundingClientRect();
  var isOut = targetEl.dataset.mine === "1";
  var sx = sr.left + sr.width / 2;
  var sy = sr.top + sr.height / 2;
  var tx = isOut ? (tr.left + 26) : (tr.right - 26);
  var ty = tr.bottom - 18;

  var fly = document.createElement("div");
  fly.className = "cmm-fly-emoji";
  fly.textContent = emoji;
  fly.style.left = sx + "px";
  fly.style.top = sy + "px";
  document.body.appendChild(fly);

  var dx = tx - sx;
  var dy = ty - sy;

  requestAnimationFrame(function () {
    fly.style.transform = "translate(-50%,-50%) translate(" + (dx * 0.5) + "px," + (dy * 0.5 - 46) + "px) scale(1.55) rotate(-12deg)";
    fly.style.opacity = "1";
    setTimeout(function () {
      fly.style.transform = "translate(-50%,-50%) translate(" + dx + "px," + dy + "px) scale(0.85) rotate(0deg)";
      fly.style.opacity = "0.35";
    }, 300);
    setTimeout(function () { if (fly.parentNode) fly.parentNode.removeChild(fly); }, 700);
  });
}

// ---------- Message info modal ----------
function _showMessageInfo(msgEl, msgId, isMine, senderName) {
  var timeEl = msgEl ? msgEl.querySelector(".chat-msg-time") : null;
  var timeText = timeEl ? timeEl.textContent.replace(/[\u2713\u2714\s]+/g, " ").trim() : "—";
  var read = isMine && (msgEl && msgEl.querySelector(".chat-ticks.read")) ? "✅ পঠিত" : (isMine ? "⏳ পাঠানো" : "—");

  var modal = document.createElement("div");
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML =
    '<div class="modal-content" style="max-width:380px">' +
      '<button class="close-btn" id="info-close" type="button">×</button>' +
      '<h3 style="margin-bottom:16px;font-size:17px">ℹ️ মেসেজের তথ্য</h3>' +
      '<div class="msg-info-row"><span>প্রেরক</span><strong>' + escapeHtml(senderName || "—") + '</strong></div>' +
      '<div class="msg-info-row"><span>সময়</span><strong>' + escapeHtml(timeText) + '</strong></div>' +
      (isMine ? '<div class="msg-info-row"><span>স্ট্যাটাস</span><strong>' + read + '</strong></div>' : '') +
      '<div class="msg-info-row"><span>ID</span><strong>#' + msgId + '</strong></div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.querySelector("#info-close").addEventListener("click", function () { modal.remove(); });
  modal.addEventListener("click", function (e) { if (e.target === modal) modal.remove(); });
}

// ---------- Multi-select mode ----------
var _multiSelect = { active: false, ids: new Set(), username: null };

function _enterChatMultiSelect(firstId) {
  _multiSelect.active = true;
  _multiSelect.username = currentChatUser;
  _multiSelect.ids = new Set();
  if (firstId) _multiSelect.ids.add(String(firstId));
  document.body.classList.add("chat-multi-select");
  _renderMultiSelectBar();
  _refreshMultiSelectCheckboxes();
}

function _exitChatMultiSelect() {
  _multiSelect.active = false;
  _multiSelect.ids.clear();
  _multiSelect.username = null;
  document.body.classList.remove("chat-multi-select");
  document.querySelectorAll(".chat-msg.selected").forEach(function (el) {
    el.classList.remove("selected");
  });
  document.querySelectorAll(".chat-msg-checkbox").forEach(function (el) { el.remove(); });
  var bar = document.getElementById("chat-multi-bar");
  if (bar) bar.remove();
}

function _renderMultiSelectBar() {
  var bar = document.getElementById("chat-multi-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "chat-multi-bar";
    bar.className = "chat-multi-bar";
    var cw = document.getElementById("chat-window");
    if (cw) cw.appendChild(bar);
  }
  var n = _multiSelect.ids.size;
  bar.innerHTML =
    '<button class="cmb-close" id="cmb-close"><i class="fa-solid fa-xmark"></i></button>' +
    '<span class="cmb-count">' + n + ' টি সিলেক্ট</span>' +
    '<div class="cmb-actions">' +
      '<button class="cmb-btn" id="cmb-star" title="স্টার"><i class="fa-regular fa-star"></i></button>' +
      '<button class="cmb-btn" id="cmb-forward" title="ফরওয়ার্ড"><i class="fa-solid fa-share"></i></button>' +
      '<button class="cmb-btn danger" id="cmb-delete" title="মুছুন"><i class="fa-regular fa-trash-can"></i></button>' +
    '</div>';

  document.getElementById("cmb-close").addEventListener("click", _exitChatMultiSelect);

  document.getElementById("cmb-star").addEventListener("click", async function () {
    if (!_multiSelect.ids.size) return showToast("কিছু সিলেক্ট করুন");
    var count = 0;
    for (var id of _multiSelect.ids) {
      try {
        var el = document.querySelector('.chat-msg[data-mid="' + id + '"]');
        var isStar = el && el.dataset.starred === "1";
        if (!isStar) {
          await api("/api/messages/" + id + "/star", { method: "POST" });
          count++;
        }
      } catch (e) {}
    }
    showToast("⭐ " + count + "টি স্টার করা হয়েছে");
    _exitChatMultiSelect();
    await loadChatMessages(true);
  });

  document.getElementById("cmb-forward").addEventListener("click", function () {
    if (!_multiSelect.ids.size) return showToast("কিছু সিলেক্ট করুন");
    _openForwardModal(Array.from(_multiSelect.ids), null, true);
  });

  document.getElementById("cmb-delete").addEventListener("click", function () {
    if (!_multiSelect.ids.size) return;
    _openMultiDeleteSheet();
  });

function _openMultiDeleteSheet() {
  var total = _multiSelect.ids.size;
  if (!total) return;

  var mineCount = 0;
  var theirCount = 0;
  _multiSelect.ids.forEach(function (id) {
    var el = document.querySelector('.chat-msg[data-mid="' + id + '"]');
    if (el && el.dataset.mine === "1") mineCount++;
    else theirCount++;
  });

  var old = document.getElementById("multi-del-sheet");
  if (old) old.remove();

  var sheet = document.createElement("div");
  sheet.id = "multi-del-sheet";
  sheet.className = "chat-msg-menu-root";
  sheet.innerHTML =
    '<div class="cmm-backdrop"></div>' +
    '<div class="dms-panel">' +
      '<div class="cms-handle"></div>' +
      '<div class="mds-header">' +
        '<i class="fa-solid fa-trash-can"></i>' +
        '<span>' + total + ' \u099f\u09bf \u09ae\u09c7\u09b8\u09c7\u099c \u09ae\u09c1\u099b\u09ac\u09c7\u09a8?' + '</span>' +
      '</div>' +
      '<button class="dms-item" data-act="del-me">' +
        '<span class="dms-icon"><i class="fa-solid fa-eye-slash"></i></span>' +
        '<span class="dms-info"><b>\u0986\u09ae\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c1\u09a8</b>' +
        '<small>' + total + ' \u099f\u09bf \u09ae\u09c7\u09b8\u09c7\u099c \u09b6\u09c1\u09a7\u09c1 \u0986\u09aa\u09a8\u09bf \u09a6\u09c7\u0996\u09ac\u09c7\u09a8 \u09a8\u09be</small></span>' +
      '</button>' +
      (mineCount > 0
        ? '<button class="dms-item dms-danger" data-act="del-all">' +
            '<span class="dms-icon"><i class="fa-regular fa-trash-can"></i></span>' +
            '<span class="dms-info"><b>\u09b8\u09ac\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c1\u09a8</b>' +
            '<small>' + (mineCount + theirCount > mineCount
              ? '\u0986\u09aa\u09a8\u09be\u09b0 ' + mineCount + ' \u099f\u09bf \u09b8\u09ac\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u0993 ' + theirCount + ' \u099f\u09bf \u09b6\u09c1\u09a7\u09c1 \u0986\u09aa\u09a8\u09be\u09b0 \u099c\u09a8\u09cd\u09af'
              : '\u0986\u09aa\u09a8\u09be\u09b0 ' + mineCount + ' \u099f\u09bf \u09ae\u09c7\u09b8\u09c7\u099c \u09a6\u09c1\u099c\u09a8\u09c7\u09b0 \u0995\u09be\u099b \u09a5\u09c7\u0995\u09c7') + '</small></span>' +
          '</button>'
        : '') +
      '<button class="dms-item dms-cancel" data-act="cancel">\u09ac\u09be\u09a4\u09bf\u09b2</button>' +
    '</div>';
  document.body.appendChild(sheet);
  requestAnimationFrame(function () { sheet.classList.add("show"); });

  function close() {
    sheet.classList.remove("show");
    setTimeout(function () { sheet.remove(); }, 260);
  }

  sheet.querySelector(".cmm-backdrop").addEventListener("click", close);

  sheet.querySelectorAll(".dms-item").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var act = btn.dataset.act;
      if (act === "cancel") { close(); return; }
      close();
      var ids = Array.from(_multiSelect.ids);
      var done = 0;
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var el = document.querySelector('.chat-msg[data-mid="' + id + '"]');
        var isMine = el && el.dataset.mine === "1";
        try {
          if (act === "del-me") {
            await api("/api/messages/" + id + "/delete-for-me", { method: "POST" });
            done++;
          } else if (act === "del-all") {
            if (isMine) {
              await api("/api/messages/" + id + "/delete-for-everyone", { method: "POST" });
            } else {
              await api("/api/messages/" + id + "/delete-for-me", { method: "POST" });
            }
            done++;
          }
        } catch (e) {
          console.warn("[MULTI-DEL]", id, e.message);
        }
      }
      _exitChatMultiSelect();
      await loadChatMessages(true);
      await loadConversations();
      showToast("\ud83d\uddd1\ufe0f " + done + " \u099f\u09bf \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09be \u09b9\u09df\u09c7\u099b\u09c7");
    });
  });
}

}

function _refreshMultiSelectCheckboxes() {
  document.querySelectorAll("#chat-messages .chat-msg").forEach(function (el) {
    var mid = el.dataset.mid;
    var cb = el.querySelector(".chat-msg-checkbox");
    if (!cb) {
      cb = document.createElement("div");
      cb.className = "chat-msg-checkbox";
      cb.innerHTML = '<i class="fa-solid fa-check"></i>';
      el.appendChild(cb);
    }
    el.classList.toggle("selected", _multiSelect.ids.has(String(mid)));
  });
}

document.addEventListener("click", function (e) {
  if (!_multiSelect.active) return;
  var msg = e.target.closest("#chat-messages .chat-msg");
  if (!msg) return;
  e.preventDefault();
  e.stopPropagation();
  var mid = String(msg.dataset.mid);
  if (_multiSelect.ids.has(mid)) _multiSelect.ids.delete(mid);
  else _multiSelect.ids.add(mid);
  msg.classList.toggle("selected", _multiSelect.ids.has(mid));
  var bar = document.getElementById("chat-multi-bar");
  if (bar) {
    var c = bar.querySelector(".cmb-count");
    if (c) c.textContent = _multiSelect.ids.size + " টি সিলেক্ট";
  }
}, true);

// ---------- Forward modal ----------
var _forwardMsgIds = [];
async function _openForwardModal(msgIdOrIds, previewText, isMulti) {
  var ids = Array.isArray(msgIdOrIds) ? msgIdOrIds : [msgIdOrIds];
  _forwardMsgIds = ids;

  var modal = document.getElementById("forward-modal");
  if (modal) modal.remove();

  modal = document.createElement("div");
  modal.id = "forward-modal";
  modal.className = "modal";
  modal.style.display = "flex";
  modal.style.zIndex = "99999";
  modal.style.alignItems = "center";
  modal.style.justifyContent = "center";
  modal.innerHTML =
    '<div class="modal-content forward-modal-content">' +
      '<div class="forward-modal-header">' +
        '<h3>ফরওয়ার্ড করুন</h3>' +
        '<button class="close-btn" id="fwd-close" type="button">×</button>' +
      '</div>' +
      '<div class="forward-modal-search">' +
        '<i class="fa-solid fa-magnifying-glass"></i>' +
        '<input type="text" id="fwd-search" placeholder="নাম বা ইউজারনেম...">' +
      '</div>' +
      '<div class="forward-modal-list" id="fwd-list"><p class="fwd-empty">লোড হচ্ছে...</p></div>' +
      '<div class="forward-modal-footer">' +
        '<span id="fwd-count">০ সিলেক্ট</span>' +
        '<button class="btn-primary" id="fwd-send" style="width:auto;padding:10px 22px" disabled>' +
          '<i class="fa-solid fa-paper-plane"></i> পাঠান' +
        '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var selected = new Set();
  var listEl = modal.querySelector("#fwd-list");
  var countEl = modal.querySelector("#fwd-count");
  var sendBtn = modal.querySelector("#fwd-send");

  function updateCount() {
    var n = selected.size;
    countEl.textContent = n === 0 ? "০ সিলেক্ট" : n + " জনকে পাঠাবেন";
    sendBtn.disabled = n === 0;
  }

  async function loadUsers(q) {
    try {
      var users = await api("/api/users?q=" + encodeURIComponent(q || ""));
      if (!Array.isArray(users)) {
        listEl.innerHTML = '<p class="fwd-empty">লোড করা যায়নি</p>';
        return;
      }
      var filtered = users.filter(function (u) {
        return u.username !== (state.me && state.me.username);
      });
      if (!filtered.length) {
        listEl.innerHTML = '<p class="fwd-empty">কেউ পাওয়া যায়নি</p>';
        return;
      }
      listEl.innerHTML = filtered.map(function (u) {
        return '<div class="fwd-item" data-username="' + escapeHtml(u.username) + '">' +
          '<div class="fwd-avatar">' + avatarInner(u.display_name, u.profile_pic) + '</div>' +
          '<div class="fwd-info">' +
            '<div class="fwd-name">' + escapeHtml(u.display_name) + '</div>' +
            '<div class="fwd-uname">@' + escapeHtml(u.username) + '</div>' +
          '</div>' +
          '<div class="fwd-check"><i class="fa-solid fa-check"></i></div>' +
        '</div>';
      }).join("");

      listEl.querySelectorAll(".fwd-item").forEach(function (el) {
        el.addEventListener("click", function () {
          var uname = el.dataset.username;
          if (selected.has(uname)) {
            selected.delete(uname);
            el.classList.remove("selected");
          } else {
            selected.add(uname);
            el.classList.add("selected");
          }
          updateCount();
        });
      });
    } catch (e) {
      console.error("[FWD loadUsers]", e);
      listEl.innerHTML = '<p class="fwd-empty">লোড করা যায়নি</p>';
    }
  }

  modal.querySelector("#fwd-close").addEventListener("click", function () { modal.remove(); });
  modal.addEventListener("click", function (e) { if (e.target === modal) modal.remove(); });
  modal.querySelector("#fwd-search").addEventListener("input", function (e) {
    loadUsers(e.target.value.trim());
  });

  sendBtn.addEventListener("click", async function () {
    if (!selected.size) return;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      var sentTotal = 0;
      for (var i = 0; i < _forwardMsgIds.length; i++) {
        var res = await api("/api/messages/" + _forwardMsgIds[i] + "/forward", {
          method: "POST",
          body: JSON.stringify({ to: Array.from(selected) }),
        });
        sentTotal += res.sent || 0;
      }
      modal.remove();
      showToast("✅ " + sentTotal + "টি ফরওয়ার্ড পাঠানো হয়েছে");
      if (isMulti && _multiSelect.active) _exitChatMultiSelect();
      await loadConversations();
    } catch (e) {
      alert(e.message);
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> পাঠান';
    }
  });

  await loadUsers("");
  updateCount();
}

// ---------- In-chat search ----------
var _chatSearchResults = [];
var _chatSearchIdx = -1;

function _openChatSearch() {
  var bar = document.getElementById("chat-search-bar");
  if (bar) { _closeChatSearch(); return; }
  bar = document.createElement("div");
  bar.id = "chat-search-bar";
  bar.className = "chat-search-bar";
  bar.innerHTML =
    '<button class="csb-back" id="csb-back"><i class="fa-solid fa-arrow-left"></i></button>' +
    '<div class="csb-input-wrap">' +
      '<i class="fa-solid fa-magnifying-glass csb-icon"></i>' +
      '<input type="text" id="csb-input" placeholder="এই চ্যাটে খুঁজুন..." autocomplete="off">' +
    '</div>' +
    '<span class="csb-count" id="csb-count"></span>' +
    '<button class="csb-nav" id="csb-up" title="আগের"><i class="fa-solid fa-chevron-up"></i></button>' +
    '<button class="csb-nav" id="csb-down" title="পরের"><i class="fa-solid fa-chevron-down"></i></button>';
  var cw = document.getElementById("chat-window");
  if (cw) cw.prepend(bar);

  var input = bar.querySelector("#csb-input");
  setTimeout(function () { input.focus(); }, 80);

  bar.querySelector("#csb-back").addEventListener("click", _closeChatSearch);
  var timer = null;
  input.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(_runChatSearch, 220);
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); _searchNavigate(1); }
  });
  bar.querySelector("#csb-up").addEventListener("click", function () { _searchNavigate(-1); });
  bar.querySelector("#csb-down").addEventListener("click", function () { _searchNavigate(1); });
}

function _closeChatSearch() {
  var bar = document.getElementById("chat-search-bar");
  if (bar) bar.remove();
  _chatSearchResults = [];
  _chatSearchIdx = -1;
  document.querySelectorAll(".chat-msg.search-match, .chat-msg.search-current").forEach(function (el) {
    el.classList.remove("search-match", "search-current");
  });
}

async function _runChatSearch() {
  var inputEl = document.getElementById("csb-input");
  var q = (inputEl && inputEl.value || "").trim();
  var countEl = document.getElementById("csb-count");
  document.querySelectorAll(".chat-msg.search-match, .chat-msg.search-current").forEach(function (el) {
    el.classList.remove("search-match", "search-current");
  });
  if (!q || !currentChatUser) {
    _chatSearchResults = [];
    if (countEl) countEl.textContent = "";
    return;
  }
  try {
    var res = await api("/api/chats/" + encodeURIComponent(currentChatUser) + "/search?q=" + encodeURIComponent(q));
    _chatSearchResults = (res.results || []).map(function (r) { return String(r.id); });
    _chatSearchResults.forEach(function (id) {
      var el = document.querySelector('.chat-msg[data-mid="' + id + '"]');
      if (el) el.classList.add("search-match");
    });
    if (countEl) countEl.textContent = _chatSearchResults.length ? (_chatSearchResults.length + "টি") : "০";
    _chatSearchIdx = -1;
    if (_chatSearchResults.length) _searchNavigate(1);
  } catch (e) {
    if (countEl) countEl.textContent = "";
  }
}

function _searchNavigate(dir) {
  if (!_chatSearchResults.length) return;
  document.querySelectorAll(".chat-msg.search-current").forEach(function (el) { el.classList.remove("search-current"); });
  _chatSearchIdx = (_chatSearchIdx + dir + _chatSearchResults.length) % _chatSearchResults.length;
  var id = _chatSearchResults[_chatSearchIdx];
  var el = document.querySelector('.chat-msg[data-mid="' + id + '"]');
  if (el) {
    el.classList.add("search-current");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

document.addEventListener("click", function (e) {
  if (e.target.closest("#chat-search-btn")) {
    e.preventDefault();
    e.stopPropagation();
    _openChatSearch();
  }
}, true);

// Long-press wiring (event delegation on chatMessages)
if (chatMessages) {
  chatMessages.addEventListener("touchstart", function(e) {
    // Block long-press on date separators
    if (e.target.closest(".chat-date-sep")) return;
    // Block long-press on system messages
    if (e.target.closest(".chat-msg-system")) return;
    var msg = e.target.closest(".chat-msg");
    if (!msg) return;
    if (e.target.closest(".chat-msg-image")) return; // no long-press on images for now
    _lpMsgId = msg.dataset.mid;
    _lpMsgEl = msg;
    clearTimeout(_lpTimer);
    _lpTimer = setTimeout(function() {
      if (navigator.vibrate) navigator.vibrate(15);
      var isMine = msg.dataset.mine === "1";
      var senderName = isMine ? "আপনি" : (document.querySelector(".chat-user-name") ? document.querySelector(".chat-user-name").textContent : "—");
      var text = msg.querySelector(".chat-msg-text") ? msg.querySelector(".chat-msg-text").textContent : "";
      _chatMsgMenu(_lpMsgId, isMine, senderName, text, msg);
    }, 500);
  }, { passive: true });

  chatMessages.addEventListener("touchend", function() { clearTimeout(_lpTimer); });
  chatMessages.addEventListener("touchmove", function() { clearTimeout(_lpTimer); });

  // Also support mouse right-click for desktop
  chatMessages.addEventListener("contextmenu", function(e) {
    if (e.target.closest(".chat-date-sep")) { e.preventDefault(); return; }
    var msg = e.target.closest(".chat-msg");
    if (!msg) return;
    e.preventDefault();
    var isMine = msg.dataset.mine === "1";
    var senderName = isMine ? "আপনি" : (document.querySelector(".chat-user-name") ? document.querySelector(".chat-user-name").textContent : "—");
    var text = msg.querySelector(".chat-msg-text") ? msg.querySelector(".chat-msg-text").textContent : "";
    _chatMsgMenu(msg.dataset.mid, isMine, senderName, text, msg);
  });

  // Double-tap → love reaction
  chatMessages.addEventListener("click", async function(e) {
    var msg = e.target.closest(".chat-msg");
    if (!msg) return;
    if (e.target.closest(".chat-msg-image")) return;
    var mid = msg.dataset.mid;
    var now = Date.now();
    if (_lastTapId === mid && now - _lastTapMs < 320) {
      // Double tap
      _lastTapMs = 0; _lastTapId = null;
      try {
        await api("/api/messages/" + mid + "/react", {
          method: "POST",
          body: JSON.stringify({ reaction: "love" }),
        });
        // Floating heart
        var rect = msg.getBoundingClientRect();
        var fly = document.createElement("div");
        fly.className = "chat-love-fly";
        fly.textContent = "❤️";
        fly.style.left = (rect.left + rect.width / 2) + "px";
        fly.style.top = (rect.top + rect.height / 2) + "px";
        document.body.appendChild(fly);
        setTimeout(function() { fly.remove(); }, 1200);
        if (navigator.vibrate) navigator.vibrate(12);
        await loadChatMessages(true);
      } catch (err) {}
    } else {
      _lastTapMs = now;
      _lastTapId = mid;
    }
  });
}


// ==================================================
// CHAT IMAGE VIEWER + SAVE
// ==================================================

function openImageViewer(src) {
  var old = document.getElementById("img-viewer");
  if (old) old.remove();

  var viewer = document.createElement("div");
  viewer.id = "img-viewer";
  viewer.className = "img-viewer";
  viewer.innerHTML =
    '<div class="img-viewer-backdrop"></div>' +
    '<div class="img-viewer-actions">' +
      '<a class="img-viewer-btn" id="img-viewer-download" download="juktoy-image.jpg" title="ডাউনলোড">' +
        '<i class="fa-solid fa-download"></i>' +
      '</a>' +
      '<button type="button" class="img-viewer-btn" id="img-viewer-close" title="বন্ধ">' +
        '<i class="fa-solid fa-xmark"></i>' +
      '</button>' +
    '</div>' +
    '<img class="img-viewer-img" src="' + src + '" alt="" loading="lazy" decoding="async">';

  document.body.appendChild(viewer);

  var dl = viewer.querySelector("#img-viewer-download");
  dl.href = src;

  viewer.querySelector("#img-viewer-close").addEventListener("click", closeImageViewer);
  viewer.querySelector(".img-viewer-backdrop").addEventListener("click", closeImageViewer);
  viewer.querySelector(".img-viewer-img").addEventListener("click", closeImageViewer);

  if (navigator.vibrate) navigator.vibrate(8);
}

function closeImageViewer() {
  var v = document.getElementById("img-viewer");
  if (v) v.remove();
}

document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") closeImageViewer();
});

// Click on chat image → open viewer
document.addEventListener("click", function(e) {
  var img = e.target.closest(".chat-msg-image img");
  if (!img) return;
  e.preventDefault();
  e.stopPropagation();
  // Only open if not currently in double-tap sequence
  openImageViewer(img.src);
}, true);

// Long-press on chat image → opens native save (browser default)
// We just make sure it's not blocked


// ==================================================
// OVERLAY PAGES — track body class + back button chain
// ==================================================

function _updateOverlayClass() {
  var ids = ["messages-page", "profile-page", "reels-page", "explore-page",
             "hashtag-page", "notifications-page", "saved-page", "settings-page",
             "story-viewer", "onboarding"];
  var anyOpen = false;
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (el && !el.classList.contains("hidden")) { anyOpen = true; break; }
  }
  document.body.classList.toggle("overlay-open", anyOpen);
}

// Watch for class changes on overlay pages
["messages-page", "profile-page", "reels-page", "explore-page",
 "hashtag-page", "notifications-page", "saved-page", "settings-page",
 "story-viewer", "onboarding"].forEach(function(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var obs = new MutationObserver(_updateOverlayClass);
  obs.observe(el, { attributes: true, attributeFilter: ["class"] });
});
_updateOverlayClass();

// ---------- Chat window back button handling ----------
// When chat window is open, back button should close chat window first,
// then return to messages list.

(function() {
  var _chatStackDepth = 0;

  // Override openChat to push another history entry
  var _origOpenChat = window.openChat;
  if (typeof openChat === "function") {
    var _orig = openChat;
    window.openChat = async function(username) {
      await _orig(username);
      var cw = document.getElementById("chat-window");
      if (cw && !cw.classList.contains("hidden")) {
        // Push another state for chat window itself
        history.pushState({ page: "chat" }, "", "");
        _chatStackDepth++;
        // Fixed: also track "chat" in _PageStack so back-stack works correctly
        if (typeof _PageStack !== "undefined" && _PageStack[_PageStack.length - 1] !== "chat") {
          _PageStack.push("chat");
        }
      }
    };
    // Reassign the actual variable used in code
    try { openChat = window.openChat; } catch (e) {}
  }

  // NOTE: chat back-handling now goes through _closeTopPage("chat")
  // to avoid double-closing the messages page.
})();

// Also: when openChat is called, ensure body overlay class updates
document.addEventListener("click", function(e) {
  if (e.target.closest(".conv-item") || e.target.closest(".new-chat-result")) {
    setTimeout(_updateOverlayClass, 100);
  }
}, true);

// Update on chat-close click
document.addEventListener("click", function(e) {
  if (e.target.closest("#chat-close")) {
    setTimeout(_updateOverlayClass, 50);
  }
}, true);

// Make sure _closeTopPage knows about chat state
const _origCloseTopPageChat = _closeTopPage;
_closeTopPage = function() {
  var cw = document.getElementById("chat-window");
  if (cw && !cw.classList.contains("hidden")) {
    // CRITICAL: pop "chat" from _PageStack so stack stays consistent
    if (typeof _PageStack !== "undefined" && _PageStack.length > 0) {
      if (_PageStack[_PageStack.length - 1] === "chat") _PageStack.pop();
    }
    if (typeof stopChatPolling === "function") stopChatPolling();
    cw.classList.add("hidden");
    currentChatUser = null;
    lastMsgCount = 0;
    if (typeof loadConversations === "function") loadConversations();
    _updateOverlayClass();
    return true;
  }
  var result = _origCloseTopPageChat();
  _updateOverlayClass();
  return result;
};


// ==================================================
// TOPBAR SEARCH — with tabs (users / posts / tags)
// ==================================================

(function () {
  var input = document.getElementById("search-input");
  var results = document.getElementById("search-results");
  var body = document.getElementById("search-body");
  var tabsWrap = document.getElementById("search-tabs");
  if (!input || !results || !body || !tabsWrap) return;

  var timer = null;
  var activeTab = "all";
  var lastData = { users: [], posts: [], hashtags: [] };
  var lastQ = "";

  function _sectionHTML(title, icon, itemsHTML) {
    return '<div class="search-section">' +
      '<div class="search-section-head"><span><i class="fa-solid ' + icon + '"></i> ' + title + '</span></div>' +
      itemsHTML +
    '</div>';
  }

  function _userItem(u) {
    return '<div class="search-result" data-user="' + escapeHtml(u.username) + '">' +
      avatarHTML(u.display_name, u.profile_pic, "avatar-sm") +
      '<div><div class="name">' + escapeHtml(u.display_name) + '</div>' +
      '<div class="uname">@' + escapeHtml(u.username) + '</div></div></div>';
  }

  function _hashtagItem(t) {
    return '<div class="search-hashtag-item" data-tag="' + escapeHtml(t.tag) + '">' +
      '<div class="search-tag-icon">#</div>' +
      '<div class="search-result-info">' +
        '<div class="name">#' + escapeHtml(t.tag) + '</div>' +
        '<div class="uname">' + t.count + ' পোস্ট</div>' +
      '</div></div>';
  }

  function _postItem(p) {
    return '<div class="search-post-item" data-user="' + escapeHtml(p.username) + '">' +
      '<div class="search-post-head">' +
        avatarHTML(p.display_name, p.profile_pic, "avatar-xs") +
        '<span class="search-post-name">' + escapeHtml(p.display_name) + '</span>' +
        '<span class="search-post-time">' + timeAgo(p.created_at) + '</span>' +
      '</div>' +
      '<div class="search-post-content">' + escapeHtml((p.content || "").slice(0, 160)) + '</div>' +
      '<div class="search-post-meta">' +
        '<span><i class="fa-regular fa-heart"></i> ' + (p.likes || 0) + '</span>' +
        '<span><i class="fa-regular fa-comment"></i> ' + (p.comments || 0) + '</span>' +
      '</div></div>';
  }

  function _bindClicks() {
    body.querySelectorAll("[data-user]").forEach(function (el) {
      el.addEventListener("click", function () {
        openProfile(el.dataset.user);
        results.classList.add("hidden");
        input.value = "";
      });
    });
    body.querySelectorAll("[data-tag]").forEach(function (el) {
      el.addEventListener("click", function () {
        if (typeof openHashtag === "function") openHashtag(el.dataset.tag);
        results.classList.add("hidden");
        input.value = "";
      });
    });
  }

  function renderResults() {
    var d = lastData;
    var tab = activeTab;
    var html = "";

    var showUsers = (tab === "all" || tab === "users");
    var showTags = (tab === "all" || tab === "hashtags");
    var showPosts = (tab === "all" || tab === "posts");

    if (showUsers && d.users && d.users.length) {
      html += _sectionHTML("মানুষ", "fa-user",
        d.users.slice(0, tab === "all" ? 4 : 20).map(_userItem).join(""));
    }
    if (showTags && d.hashtags && d.hashtags.length) {
      html += _sectionHTML("ট্যাগ", "fa-hashtag",
        d.hashtags.slice(0, tab === "all" ? 3 : 20).map(_hashtagItem).join(""));
    }
    if (showPosts && d.posts && d.posts.length) {
      html += _sectionHTML("পোস্ট", "fa-file-lines",
        d.posts.slice(0, tab === "all" ? 3 : 20).map(_postItem).join(""));
    }

    if (!html) {
      html = '<div class="search-result"><span class="uname">কিছু পাওয়া যায়নি</span></div>';
    }

    body.innerHTML = html;
    _bindClicks();
  }

  // S30.30 — request counter prevents stale-response race
  // (was: slow old request could overwrite faster new one's results)
  var _reqSerial = 0;

  async function fetchAndRender() {
    var q = input.value.trim();
    if (!q) {
      results.classList.add("hidden");
      body.innerHTML = "";
      lastData = { users: [], posts: [], hashtags: [] };
      lastQ = "";
      return;
    }
    lastQ = q;
    var _myReq = ++_reqSerial;
    try {
      var data = await api("/api/search?q=" + encodeURIComponent(q) + "&type=all");
      if (_myReq !== _reqSerial) return;   // stale — newer request already landed
      if (input.value.trim() !== q) return; // input changed
      lastData = data;
      results.classList.remove("hidden");
      renderResults();
    } catch (err) {
      if (_myReq !== _reqSerial) return;
      body.innerHTML = '<div class="search-result"><span class="uname">লোড করা যায়নি</span></div>';
      results.classList.remove("hidden");
    }
  }

  input.addEventListener("input", function () {
    clearTimeout(timer);
    if (!input.value.trim()) {
      results.classList.add("hidden");
      body.innerHTML = "";
      return;
    }
    timer = setTimeout(fetchAndRender, 250);
  });

  // Tab switching — pure client-side (no refetch)
  tabsWrap.addEventListener("click", function (e) {
    var tab = e.target.closest(".search-tab");
    if (!tab) return;
    e.preventDefault();
    e.stopPropagation();
    activeTab = tab.dataset.type;
    tabsWrap.querySelectorAll(".search-tab").forEach(function (t) {
      t.classList.toggle("active", t === tab);
    });
    if (lastQ) renderResults();
  });

  // Outside click
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".search-wrap") && results) {
      results.classList.add("hidden");
    }
  });

  console.log("[Search] tabs + listener attached ✅");
})();

// ==================================================
// FULL-PAGE SEARCH (v1)
// ==================================================

(function () {
  // Marker for duplicate check
  var MARK = "full-page-search-v1";

  var page = document.getElementById("search-page");
  var pageInput = document.getElementById("search-page-input");
  var pageBody = document.getElementById("search-page-body");
  var pageTabs = document.getElementById("search-page-tabs");
  var pageBack = document.getElementById("search-page-back");
  var pageClear = document.getElementById("search-page-clear");
  var topInput = document.getElementById("search-input");
  if (!page || !pageInput || !pageBody || !pageTabs) return;

  var activeTab = "all";
  var timer = null;
  var lastData = { users: [], posts: [], hashtags: [] };
  var lastQ = "";
  var _isOpen = false;

  // --- HTML helpers ---
  function _section(title, icon, inner) {
    return '<div class="search-section">' +
      '<div class="search-section-head"><span><i class="fa-solid ' + icon + '"></i> ' + title + '</span></div>' +
      inner + '</div>';
  }
  function _userItem(u) {
    return '<div class="search-result" data-user="' + escapeHtml(u.username) + '">' +
      avatarHTML(u.display_name, u.profile_pic, "avatar-sm") +
      '<div class="search-result-info"><div class="name">' + escapeHtml(u.display_name) + '</div>' +
      '<div class="uname">@' + escapeHtml(u.username) + '</div></div>' +
      '<i class="fa-solid fa-chevron-right search-result-arrow"></i></div>';
  }
  function _tagItem(t) {
    return '<div class="search-hashtag-item" data-tag="' + escapeHtml(t.tag) + '">' +
      '<div class="search-tag-icon">#</div>' +
      '<div class="search-result-info"><div class="name">#' + escapeHtml(t.tag) + '</div>' +
      '<div class="uname">' + t.count + ' পোস্ট</div></div>' +
      '<i class="fa-solid fa-chevron-right search-result-arrow"></i></div>';
  }
  function _postItem(p) {
    return '<div class="search-post-item" data-user="' + escapeHtml(p.username) + '">' +
      '<div class="search-post-head">' +
        avatarHTML(p.display_name, p.profile_pic, "avatar-xs") +
        '<span class="search-post-name">' + escapeHtml(p.display_name) + '</span>' +
        '<span class="search-post-time">' + timeAgo(p.created_at) + '</span>' +
      '</div>' +
      '<div class="search-post-content">' + escapeHtml((p.content || "").slice(0, 200)) + '</div>' +
      '<div class="search-post-meta">' +
        '<span><i class="fa-regular fa-heart"></i> ' + (p.likes || 0) + '</span>' +
        '<span><i class="fa-regular fa-comment"></i> ' + (p.comments || 0) + '</span>' +
      '</div></div>';
  }

  function _bindClicks() {
    pageBody.querySelectorAll("[data-user]").forEach(function (el) {
      el.addEventListener("click", function () {
        var u = el.dataset.user;
        _close();
        if (typeof openProfile === "function") openProfile(u);
      });
    });
    pageBody.querySelectorAll("[data-tag]").forEach(function (el) {
      el.addEventListener("click", function () {
        var t = el.dataset.tag;
        _close();
        if (typeof openHashtag === "function") openHashtag(t);
      });
    });
  }

  function _render() {
    var d = lastData, tab = activeTab, html = "";
    var showU = (tab === "all" || tab === "users");
    var showT = (tab === "all" || tab === "hashtags");
    var showP = (tab === "all" || tab === "posts");

    if (showU && d.users && d.users.length)
      html += _section("মানুষ", "fa-user",
        d.users.slice(0, tab === "all" ? 4 : 20).map(_userItem).join(""));
    if (showT && d.hashtags && d.hashtags.length)
      html += _section("ট্যাগ", "fa-hashtag",
        d.hashtags.slice(0, tab === "all" ? 4 : 20).map(_tagItem).join(""));
    if (showP && d.posts && d.posts.length)
      html += _section("পোস্ট", "fa-file-lines",
        d.posts.slice(0, tab === "all" ? 4 : 20).map(_postItem).join(""));

    if (!html) {
      html = '<div class="search-empty"><i class="fa-solid fa-face-frown"></i>' +
        '<p>"' + escapeHtml(lastQ) + '" এর জন্য কিছু পাওয়া যায়নি</p></div>';
    }
    pageBody.innerHTML = html;
    _bindClicks();
  }

  function _renderEmpty() {
    var recents = [];
    try { recents = JSON.parse(localStorage.getItem("juktoy_recent_searches") || "[]"); } catch (e) {}
    if (!recents.length) {
      pageBody.innerHTML = '<div class="search-empty"><i class="fa-solid fa-magnifying-glass"></i>' +
        '<p>কিছু খুঁজুন<br>মানুষ, পোস্ট, বা #ট্যাগ</p></div>';
      return;
    }
    pageBody.innerHTML = '<div class="search-section">' +
      '<div class="search-section-head"><span>সাম্প্রতিক</span></div>' +
      recents.map(function (r) {
        return '<div class="search-recent-item" data-q="' + escapeHtml(r) + '">' +
          '<i class="fa-solid fa-clock-rotate-left"></i><span>' + escapeHtml(r) + '</span></div>';
      }).join("") + '</div>';
    pageBody.querySelectorAll(".search-recent-item").forEach(function (el) {
      el.addEventListener("click", function () {
        pageInput.value = el.dataset.q;
        _fetch();
      });
    });
  }

  function _saveRecent(q) {
    if (!q || q.length < 2) return;
    try {
      var list = JSON.parse(localStorage.getItem("juktoy_recent_searches") || "[]");
      list = list.filter(function (x) { return x !== q; });
      list.unshift(q);
      list = list.slice(0, 8);
      localStorage.setItem("juktoy_recent_searches", JSON.stringify(list));
    } catch (e) {}
  }

  var _fsSerial = 0;

  async function _fetch() {
    var q = pageInput.value.trim();
    if (!q) {
      lastQ = "";
      lastData = { users: [], posts: [], hashtags: [] };
      _renderEmpty();
      if (pageClear) pageClear.classList.add("hidden");
      return;
    }
    lastQ = q;
    var _myReq = ++_fsSerial;
    if (pageClear) pageClear.classList.remove("hidden");
    pageBody.innerHTML = '<div class="search-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>খোঁজা হচ্ছে...</p></div>';
    try {
      var data = await api("/api/search?q=" + encodeURIComponent(q) + "&type=all");
      if (_myReq !== _fsSerial) return;
      lastData = data;
      _render();
    } catch (err) {
      if (_myReq !== _fsSerial) return;
      pageBody.innerHTML = '<div class="search-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>লোড করা যায়নি</p></div>';
    }
  }

  function _open() {
    if (_isOpen) return;
    _isOpen = true;
    page.classList.remove("hidden");
    document.body.classList.add("overlay-open");
    try { history.pushState({ page: "full-search" }, "", ""); } catch (e) {}
    pageInput.value = "";
    activeTab = "all";
    pageTabs.querySelectorAll(".search-tab").forEach(function (t, i) {
      t.classList.toggle("active", i === 0);
    });
    lastData = { users: [], posts: [], hashtags: [] };
    lastQ = "";
    _renderEmpty();
    setTimeout(function () { pageInput.focus(); }, 80);
  }

  function _close() {
    // S39 — idempotent close (was: `if (!_isOpen) return;` blocked close
    // when search was opened via profile-search-btn which doesn't set _isOpen)
    _isOpen = false;
    page.classList.add("hidden");
    document.body.classList.remove("overlay-open");
    pageInput.value = "";
    pageBody.innerHTML = "";
    pageInput.blur();
  }

  // --- Wire: topbar input opens full-page search ---
  if (topInput) {
    var _onTop = function (e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      topInput.blur();
      _open();
    };
    topInput.addEventListener("focus", _onTop);
    topInput.addEventListener("click", _onTop);
    topInput.addEventListener("touchstart", _onTop, { passive: false });
  }

  // --- Wire: page input ---
  pageInput.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(_fetch, 250);
  });
  pageInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      _saveRecent(pageInput.value.trim());
      _fetch();
    }
  });

  // --- Wire: tabs ---
  pageTabs.addEventListener("click", function (e) {
    var tab = e.target.closest(".search-tab");
    if (!tab) return;
    e.preventDefault();
    e.stopPropagation();
    activeTab = tab.dataset.type;
    pageTabs.querySelectorAll(".search-tab").forEach(function (t) {
      t.classList.toggle("active", t === tab);
    });
    if (lastQ) _render();
  });

  // --- Wire: back button ---
  if (pageBack) {
    pageBack.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      // S39 — direct close (simplest, always works)
      // Also clean up the page stack if it has our entry
      if (typeof _PageStack !== "undefined") {
        var idx = _PageStack.lastIndexOf("search-page");
        if (idx !== -1) _PageStack.splice(idx, 1);
      }
      _close();
    });
  }

  // --- Wire: clear button ---
  if (pageClear) {
    pageClear.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      pageInput.value = "";
      pageInput.focus();
      lastData = { users: [], posts: [], hashtags: [] };
      lastQ = "";
      _renderEmpty();
      pageClear.classList.add("hidden");
    });
  }

  // --- Hardware/browser back ---
  window.addEventListener("popstate", function () {
    if (_isOpen) _close();
  });

  // --- Escape key ---
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && _isOpen) {
      try { history.back(); } catch (err) { _close(); }
    }
  });

  // S39 — expose _close globally for _closeTopPage
  window._closeSearchPage = _close;

  console.log("[Search] full-page " + MARK + " ready ✅");
})();

// ==================================================
// MUTUAL FOLLOWERS MODAL
// ==================================================

async function showMutualFollowers(username) {
  try {
    var users = await api("/api/users/" + encodeURIComponent(username) + "/mutual");
    if (typeof openUserListModal === "function") {
      openUserListModal("মিউচুয়াল ফলোয়ার", users, "কোনো মিউচুয়াল ফলোয়ার নেই");
      return;
    }
    // Fallback: build a simple modal
    var modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML =
      '<div class="modal-content user-list-modal-content">' +
        '<div class="user-list-header">' +
          '<h3 class="user-list-title">মিউচুয়াল ফলোয়ার</h3>' +
          '<button type="button" class="close-btn" id="mutual-modal-close">&times;</button>' +
        '</div>' +
        '<div class="user-list-body">' +
          (users.length ? users.map(function (u) {
            return '<div class="user-list-item" data-user="' + escapeHtml(u.username) + '">' +
              '<div class="user-list-avatar">' + avatarInner(u.display_name, u.profile_pic) + '</div>' +
              '<div class="user-list-info">' +
                '<div class="user-list-name">' + escapeHtml(u.display_name) + '</div>' +
                '<div class="user-list-username">@' + escapeHtml(u.username) + '</div>' +
              '</div></div>';
          }).join("") : '<p class="user-list-empty">কোনো মিউচুয়াল ফলোয়ার নেই</p>') +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener("click", function (e) {
      if (e.target === modal) modal.remove();
    });
    var closeBtn = modal.querySelector("#mutual-modal-close");
    if (closeBtn) closeBtn.addEventListener("click", function () { modal.remove(); });
    modal.querySelectorAll("[data-user]").forEach(function (el) {
      el.addEventListener("click", function () {
        modal.remove();
        if (typeof openProfile === "function") openProfile(el.dataset.user);
      });
    });
  } catch (err) {
    console.error("[MutualFollowers] failed", err);
  }
}


// ==================================================
// PROFILE PHOTOS TAB
// ==================================================

// S39 — Profile photos renderer (exposed globally for unified handler).
// Old tab click handler was removed; unified handler at end of file
// handles all tab clicks and calls this when "photos" tab is selected.
(function () {

  function _renderProfilePhotos() {
    var pane = document.getElementById("profile-tab-photos");
    if (!pane) return;

    var data = window._currentProfileData;
    if (!data || !Array.isArray(data.posts)) {
      pane.innerHTML = '<p class="empty-text">📷 এখনো কোনো ছবি নেই</p>';
      return;
    }

    var allMedia = [];
    data.posts.forEach(function (p) {
      if (Array.isArray(p.media)) {
        p.media.forEach(function (m) {
          if (m) allMedia.push(m);
        });
      }
    });

    if (!allMedia.length) {
      pane.innerHTML = '<div class="profile-photos-empty">' +
        '<div class="pp-empty-icon">📷</div>' +
        '<div class="pp-empty-title">এখনো কোনো ছবি নেই</div>' +
        '<div class="pp-empty-text">ছবি সহ পোস্ট করলে এখানে দেখা যাবে</div>' +
        '</div>';
      return;
    }

    pane.innerHTML = '<div class="profile-photos-grid">' +
      allMedia.map(function (src) {
        return '<div class="profile-photo-cell" data-src="' + escapeHtml(src) + '">' +
          '<img src="' + escapeHtml(src) + '" alt="" loading="lazy">' +
        '</div>';
      }).join("") +
    '</div>';

    pane.querySelectorAll(".profile-photo-cell").forEach(function (cell) {
      cell.addEventListener("click", function () {
        if (typeof openImageViewer === "function") {
          openImageViewer(cell.dataset.src);
        }
      });
    });
  }

  // Expose globally for onOpen usage
  window._renderProfilePhotos = _renderProfilePhotos;

  console.log("[Profile] photos tab handler attached ✅");
})();


// ==================================================
// PROFILE COMPLETION BAR
// ==================================================

function _renderProfileCompletion(user, postCount) {
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


// ==================================================
// NOTIFICATION FILTER TABS + POST VIEW
// ==================================================

(function () {
  var tabsWrap = document.getElementById("notif-tabs");
  if (!tabsWrap || tabsWrap.dataset.bound === "1") return;
  tabsWrap.dataset.bound = "1";

  var activeTab = "all";

  function _matchTab(n) {
    if (activeTab === "all") return true;
    if (activeTab === "likes") {
      return n.type === "like" || n.type === "comment_like" || n.type === "story_reaction";
    }
    if (activeTab === "comments") {
      return n.type === "comment" || n.type === "comment_reply";
    }
    if (activeTab === "follows") {
      return n.type === "follow";
    }
    return true;
  }

  tabsWrap.addEventListener("click", function (e) {
    var tab = e.target.closest(".notif-tab");
    if (!tab) return;
    e.preventDefault();
    activeTab = tab.dataset.type;
    tabsWrap.querySelectorAll(".notif-tab").forEach(function (t) {
      t.classList.toggle("active", t === tab);
    });
    // Re-filter existing items
    document.querySelectorAll("#notif-list .notif-item").forEach(function (el) {
      var itemType = el.dataset.type;
      var visible = false;
      if (activeTab === "all") visible = true;
      else if (activeTab === "likes") visible = (itemType === "like" || itemType === "comment_like" || itemType === "story_reaction");
      else if (activeTab === "comments") visible = (itemType === "comment" || itemType === "comment_reply");
      else if (activeTab === "follows") visible = (itemType === "follow");
      el.style.display = visible ? "" : "none";
    });
    // Show empty state if nothing matches
    var list = document.getElementById("notif-list");
    if (list) {
      var visibleCount = 0;
      list.querySelectorAll(".notif-item").forEach(function (el) {
        if (el.style.display !== "none") visibleCount++;
      });
      var emptyMsg = list.querySelector(".notif-filter-empty");
      if (visibleCount === 0 && list.querySelectorAll(".notif-item").length > 0) {
        if (!emptyMsg) {
          emptyMsg = document.createElement("div");
          emptyMsg.className = "notif-filter-empty";
          emptyMsg.innerHTML = '<i class="fa-regular fa-face-smile"></i><p>এই ধরনের কোনো নোটিফিকেশন নেই</p>';
          list.appendChild(emptyMsg);
        }
        emptyMsg.style.display = "";
      } else if (emptyMsg) {
        emptyMsg.style.display = "none";
      }
    }
  });

  console.log("[Notif] filter tabs attached ✅");
})();


// ==================================================
// POST VIEW FROM NOTIFICATION
// ==================================================

async function openPostFromNotif(postId) {
  if (!postId) return;
  try {
    var data = await api("/api/posts/" + postId);
    if (!data.post) return;
    var p = data.post;
    // Build a minimal post view modal
    var modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "notif-post-modal";
    modal.innerHTML =
      '<div class="modal-content notif-post-content">' +
        '<div class="user-list-header">' +
          '<h3 class="user-list-title">পোস্ট</h3>' +
          '<button type="button" class="close-btn" id="notif-post-close">&times;</button>' +
        '</div>' +
        '<div class="notif-post-body">' +
          '<div class="notif-post-head">' +
            avatarHTML(p.display_name, p.profile_pic, "avatar") +
            '<div><div class="notif-post-name">' + escapeHtml(p.display_name) + '</div>' +
            '<div class="notif-post-time">@' + escapeHtml(p.username) + ' • ' + timeAgo(p.created_at) + '</div></div>' +
          '</div>' +
          '<div class="notif-post-text">' + escapeHtml(p.content || "") + '</div>' +
          (Array.isArray(p.media) && p.media.length
            ? '<div class="notif-post-media">' + p.media.slice(0, 3).map(function (m) {
                return '<img src="' + escapeHtml(m) + '" alt="" loading="lazy" decoding="async">';
              }).join("") + '</div>'
            : '') +
          '<div class="notif-post-stats">' +
            '<span><i class="fa-solid fa-heart"></i> ' + (p.likes || 0) + '</span>' +
            '<span><i class="fa-solid fa-comment"></i> ' + (p.comments || 0) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    document.getElementById("notif-post-close").addEventListener("click", function () { modal.remove(); });
    modal.addEventListener("click", function (e) {
      if (e.target === modal) modal.remove();
    });
  } catch (err) {
    console.error("[NotifPost] failed", err);
    showToast("পোস্ট লোড করা যায়নি");
  }
}


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


// ==================================================
// PRIVACY SETTINGS
// ==================================================

(function () {
  var sw = document.getElementById("privacy-switch");
  var label = document.getElementById("privacy-label");
  var sub = document.getElementById("privacy-sub");
  if (!sw) return;

  function _apply(privateOn) {
    sw.classList.toggle("on", privateOn);
    if (label) label.textContent = privateOn ? "Private প্রোফাইল" : "Public প্রোফাইল";
    if (sub) sub.textContent = privateOn
      ? "শুধু followers আপনার posts দেখতে পাবে"
      : "সবাই আপনার posts দেখতে পাবে";
  }

  // Initialize from state
  if (state.me) {
    _apply(!!state.me.is_private);
  }

  sw.addEventListener("click", async function (e) {
    e.preventDefault();
    e.stopPropagation();
    var current = sw.classList.contains("on");
    var next = !current;

    // Optimistic
    _apply(next);
    sw.disabled = true;

    try {
      var res = await api("/api/me/privacy", {
        method: "POST",
        body: JSON.stringify({ is_private: next }),
      });
      // S18.9h3 — use ACTUAL saved state from server
      var savedPrivate = !!res.is_private;
      if (state.me) state.me.is_private = savedPrivate ? 1 : 0;
      _apply(savedPrivate);  // re-sync UI with server truth
      showToast(savedPrivate ? "🔒 Private করা হয়েছে — শুধু followers দেখবে" : "🌐 Public করা হয়েছে — সবাই দেখবে");
    } catch (err) {
      _apply(current);
      alert(err.message);
    } finally {
      sw.disabled = false;
    }
  });

  console.log("[Privacy] toggle attached ✅");
})();


// ==================================================
// PROFILE PRIVACY LOCK + HIDDEN POSTS VIEW
// ==================================================

// Hook openProfile to add lock icon + handle can_see_posts
(function () {
  if (typeof window.openProfile !== "function") return;
  var _origOpenProfile = window.openProfile;

  window.openProfile = async function (username) {
    await _origOpenProfile(username);
    // After profile data loaded, check private state
    var data = window._currentProfileData;
    if (!data) return;

    var isPrivate = data.user && (data.user.is_private === 1 || data.user.is_private === true);
    var canSee = data.can_see_posts !== false;
    var isFollowing = data.is_following;
    // S18.9h — never show lock on own profile
    var isSelf = state.me && data.user && state.me.username === data.user.username;

    // Add/remove lock icon next to name
    var nameRow = document.querySelector("#profile-page .profile-name-row h2");
    if (nameRow) {
      var existingLock = nameRow.parentNode.querySelector(".profile-private-lock");
      if (existingLock) existingLock.remove();
      if (isPrivate && !isSelf) {
        var lock = document.createElement("span");
        lock.className = "profile-private-lock";
        lock.title = "Private account";
        lock.innerHTML = '<i class="fa-solid fa-lock"></i>';
        nameRow.appendChild(lock);
      }
    }

    // If can't see posts, replace posts tab with locked message
    var postsPane = document.getElementById("profile-tab-posts");
    if (postsPane && !canSee) {
      postsPane.innerHTML =
        '<div class="profile-private-notice">' +
          '<div class="ppn-icon"><i class="fa-solid fa-lock"></i></div>' +
          '<div class="ppn-title">এই অ্যাকাউন্টটি Private</div>' +
          '<div class="ppn-text">' +
            'পোস্ট দেখতে হলে এই ইউজারকে follow করুন।' +
            (isFollowing ? '' : '<br><br>আপনার follow request গ্রহণ করলে posts দেখতে পাবেন।') +
          '</div>' +
        '</div>';
    }
  };
})();


// ==================================================
// GROUP CHAT SYSTEM
// ==================================================

var _currentGroupId = null;
var _groupPollTimer = null;
var _groupPendingImage = null;
var _newGroupSelected = [];  // usernames

// ---------- Load groups into conv sidebar ----------
async function loadGroups() {
  var wrap = document.getElementById("group-items");
  if (!wrap) return;
  try {
    var groups = await api("/api/groups");
    if (!groups.length) {
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML = groups.map(function (g) {
      var avHTML = (g.members || []).slice(0, 3).map(function (m) {
        return '<div class="conv-avatar mini">' +
          (m.profile_pic ? '<img src="' + escapeHtml(m.profile_pic) + '" alt="" loading="lazy" decoding="async">' : initial(m.display_name)) +
          '</div>';
      }).join("");
      return '<div class="conv-item group-item" data-group-id="' + g.id + '">' +
        '<div class="conv-avatars-stack">' + avHTML + '</div>' +
        '<div class="conv-info">' +
          '<div class="conv-name">' + escapeHtml(g.name) + '</div>' +
          '<div class="conv-last">' + escapeHtml((g.last_message || 'নতুন গ্রুপ').slice(0, 40)) + '</div>' +
        '</div>' +
        '<div class="conv-meta">' +
          '<span class="conv-time">' + (g.last_time ? shortTime(g.last_time) : '') + '</span>' +
        '</div>' +
      '</div>';
    }).join("");

    wrap.querySelectorAll(".group-item").forEach(function (el) {
      el.addEventListener("click", function () {
        openGroupChat(parseInt(el.dataset.groupId));
      });
    });
  } catch (err) {
    console.error("[Groups] load failed", err);
  }
}

// ---------- Open group chat ----------
async function openGroupChat(gid) {
  _currentGroupId = gid;
  var win = document.getElementById("group-chat-window");
  if (!win) return;

  // Hide individual chat window if visible
  var indv = document.getElementById("chat-window");
  if (indv) indv.classList.add("hidden");

  win.classList.remove("hidden");

  // Highlight
  document.querySelectorAll(".conv-item").forEach(function (el) {
    el.classList.toggle("active", el.dataset.groupId === String(gid));
  });

  await refreshGroupChat(true);
  startGroupPolling();
}

async function refreshGroupChat(scrollToBottom) {
  if (!_currentGroupId) return;
  try {
    var data = await api("/api/groups/" + _currentGroupId);
    var g = data.group;
    var members = data.members || [];

    // Header
    var headerEl = document.getElementById("group-chat-header-info");
    if (headerEl) {
      var avHTML = members.slice(0, 3).map(function (m) {
        return '<div class="chat-user-avatar mini">' +
          (m.profile_pic ? '<img src="' + escapeHtml(m.profile_pic) + '" alt="" loading="lazy" decoding="async">' : initial(m.display_name)) +
          '</div>';
      }).join("");
      headerEl.innerHTML =
        '<div class="group-header-avatars">' + avHTML + '</div>' +
        '<div><div class="chat-user-name">' + escapeHtml(g.name) + '</div>' +
        '<div class="chat-user-status">' + members.length + ' জন সদস্য</div></div>';
      headerEl.onclick = function () { showGroupInfo(data); };
    }

    // Messages
    var msgEl = document.getElementById("group-chat-messages");
    if (!msgEl) return;

    var wasAtBottom = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight < 120;
    var html = data.messages.map(function (m) {
      var mine = m.sender_id === data.me_id;
      return '<div class="chat-msg group-msg ' + (mine ? "outgoing" : "incoming") + '">' +
        (!mine ? '<div class="group-msg-sender">' + escapeHtml(m.display_name) + '</div>' : '') +
        (m.attachment ? '<div class="chat-msg-image"><img src="' + escapeHtml(m.attachment) + '" alt="" loading="lazy" decoding="async"></div>' : '') +
        (m.content ? '<div class="chat-msg-text">' + escapeHtml(m.content) + '</div>' : '') +
        '<div class="chat-msg-time">' + shortTime(m.created_at) + '</div>' +
      '</div>';
    }).join("");

    msgEl.innerHTML = html || '<div class="conv-empty" style="padding:40px 20px"><p>গ্রুপে এখনো কোনো মেসেজ নেই</p></div>';

    if (scrollToBottom || wasAtBottom) {
      msgEl.scrollTop = msgEl.scrollHeight;
    }
  } catch (err) {
    console.error("[GroupChat] refresh failed", err);
  }
}

function startGroupPolling() {
  stopGroupPolling();
  _groupPollTimer = setInterval(function () {
    var win = document.getElementById("group-chat-window");
    if (win && !win.classList.contains("hidden") && !document.hidden) {
      refreshGroupChat(false);
    }
  }, 3000);
}

function stopGroupPolling() {
  if (_groupPollTimer) {
    clearInterval(_groupPollTimer);
    _groupPollTimer = null;
  }
}

// ---------- Send message ----------
(function () {
  var form = document.getElementById("group-chat-form");
  if (!form) return;
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var input = document.getElementById("group-chat-input");
    var text = (input.value || "").trim();
    var image = _groupPendingImage || "";
    if (!text && !image) return;
    if (!_currentGroupId) return;

    input.value = "";

    try {
      await api("/api/groups/" + _currentGroupId + "/send", {
        method: "POST",
        body: JSON.stringify({ content: text, image: image }),
      });
      _groupPendingImage = null;
      var prev = document.getElementById("group-image-preview");
      if (prev) prev.classList.add("hidden");
      await refreshGroupChat(true);
    } catch (err) {
      alert(err.message);
    } finally {
      // ALWAYS refocus — keep keyboard up for continuous typing
      try { input.focus({ preventScroll: true }); } catch (e) {}
    }
  });

  // Prevent send button from stealing focus (keep keyboard up)
  // We only block mousedown (desktop) — allow normal click to submit
  (function () {
    var sendBtn = document.getElementById("group-chat-send");
    if (!sendBtn) return;
    sendBtn.addEventListener("mousedown", function (e) { e.preventDefault(); });
  })();
})();

// ---------- Attach image ----------
(function () {
  var btn = document.getElementById("group-attach-btn");
  var inp = document.getElementById("group-image-input");
  if (!btn || !inp) return;
  btn.addEventListener("click", function (e) {
    e.preventDefault();
    inp.click();
  });
  inp.addEventListener("change", async function (e) {
    var file = e.target.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      var resized = await resizeImage(file, 800, 0.82);
      _groupPendingImage = resized;
      var prev = document.getElementById("group-image-preview");
      var img = document.getElementById("group-image-preview-img");
      img.src = resized;
      prev.classList.remove("hidden");
    } catch (err) {
      alert("ছবি লোড করা যায়নি");
    } finally {
      inp.value = "";
    }
  });
})();

(function () {
  var removeBtn = document.getElementById("group-image-remove");
  if (!removeBtn) return;
  removeBtn.addEventListener("click", function () {
    _groupPendingImage = null;
    document.getElementById("group-image-preview").classList.add("hidden");
  });
})();

// ---------- Close group chat ----------
(function () {
  var closeBtn = document.getElementById("group-chat-close");
  if (!closeBtn) return;
  closeBtn.addEventListener("click", function () {
    stopGroupPolling();
    var win = document.getElementById("group-chat-window");
    if (win) win.classList.add("hidden");
    _currentGroupId = null;
    document.querySelectorAll(".conv-item").forEach(function (el) { el.classList.remove("active"); });
  });
})();

// ---------- New Group Modal ----------
(function () {
  var modal = document.getElementById("new-group-modal");
  var openBtn = document.getElementById("new-group-btn");
  var closeBtn = document.getElementById("close-new-group");
  var cancelBtn = document.getElementById("cancel-new-group");
  var nameInput = document.getElementById("group-name-input");
  var searchInput = document.getElementById("group-member-search");
  var resultsWrap = document.getElementById("group-search-results");
  var selectedWrap = document.getElementById("group-selected-members");
  var countEl = document.getElementById("group-member-count");
  var createBtn = document.getElementById("create-group-btn");
  if (!modal || !openBtn) return;

  function open() {
    _newGroupSelected = [];
    nameInput.value = "";
    searchInput.value = "";
    resultsWrap.innerHTML = "";
    renderSelected();
    modal.classList.remove("hidden");
    setTimeout(function () { nameInput.focus(); }, 100);
  }
  function close() { modal.classList.add("hidden"); }
  function renderSelected() {
    selectedWrap.innerHTML = _newGroupSelected.map(function (u) {
      return '<div class="selected-member" data-username="' + escapeHtml(u.username) + '">' +
        '<span>' + escapeHtml(u.display_name) + '</span>' +
        '<i class="fa-solid fa-xmark"></i></div>';
    }).join("");
    selectedWrap.querySelectorAll(".selected-member").forEach(function (el) {
      el.addEventListener("click", function () {
        _newGroupSelected = _newGroupSelected.filter(function (u) { return u.username !== el.dataset.username; });
        renderSelected();
      });
    });
    countEl.textContent = "(" + _newGroupSelected.length + " জন)";
    var ok = nameInput.value.trim().length > 0 && _newGroupSelected.length >= 2;
    createBtn.disabled = !ok;
  }

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  nameInput.addEventListener("input", renderSelected);

  var searchTimer = null;
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimer);
    var q = searchInput.value.trim();
    if (!q) { resultsWrap.innerHTML = ""; return; }
    searchTimer = setTimeout(async function () {
      try {
        var users = await api("/api/users?q=" + encodeURIComponent(q));
        var filtered = users.filter(function (u) {
          return u.username !== (state.me && state.me.username);
        });
        if (!filtered.length) {
          resultsWrap.innerHTML = '<p style="text-align:center;color:var(--muted);padding:12px">কেউ পাওয়া যায়নি</p>';
          return;
        }
        resultsWrap.innerHTML = filtered.slice(0, 10).map(function (u) {
          var selected = _newGroupSelected.some(function (s) { return s.username === u.username; });
          return '<div class="search-result ' + (selected ? 'selected' : '') + '" data-user="' + escapeHtml(u.username) + '" data-name="' + escapeHtml(u.display_name) + '">' +
            avatarHTML(u.display_name, u.profile_pic, "avatar-sm") +
            '<div><div class="name">' + escapeHtml(u.display_name) + '</div>' +
            '<div class="uname">@' + escapeHtml(u.username) + '</div></div>' +
            (selected ? '<i class="fa-solid fa-check" style="margin-left:auto;color:var(--accent)"></i>' : '') +
          '</div>';
        }).join("");
        resultsWrap.querySelectorAll("[data-user]").forEach(function (el) {
          el.addEventListener("click", function () {
            var un = el.dataset.user;
            var nm = el.dataset.name;
            var idx = _newGroupSelected.findIndex(function (u) { return u.username === un; });
            if (idx >= 0) _newGroupSelected.splice(idx, 1);
            else _newGroupSelected.push({ username: un, display_name: nm });
            renderSelected();
            // Refresh list to update checkmarks
            searchInput.dispatchEvent(new Event("input"));
          });
        });
      } catch (err) {
        resultsWrap.innerHTML = "";
      }
    }, 250);
  });

  createBtn.addEventListener("click", async function () {
    var name = nameInput.value.trim();
    var members = _newGroupSelected.map(function (u) { return u.username; });
    if (!name || members.length < 2) return;

    createBtn.disabled = true;
    createBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> তৈরি হচ্ছে...';

    try {
      var res = await api("/api/groups", {
        method: "POST",
        body: JSON.stringify({ name: name, members: members }),
      });
      close();
      showToast("✅ গ্রুপ তৈরি হয়েছে");
      await loadGroups();
      openGroupChat(res.group_id);
    } catch (err) {
      alert(err.message);
    } finally {
      createBtn.disabled = false;
      createBtn.innerHTML = '<i class="fa-solid fa-check"></i> গ্রুপ তৈরি করুন';
    }
  });

  console.log("[Groups] modal attached ✅");
})();


// ---------- Group info panel ----------
function showGroupInfo(data) {
  var win = document.getElementById("group-chat-window");
  if (!win) return;
  var infoTab = document.getElementById("group-info-tab");
  if (!infoTab) return;

  var isMember = true; // we are (we opened the chat)
  var html =
    '<div class="gi-header">' +
      '<button class="back-btn" id="gi-close"><i class="fa-solid fa-arrow-left"></i></button>' +
      '<div class="gi-title">গ্রুপ তথ্য</div>' +
    '</div>' +
    '<div class="gi-body">' +
      '<div class="gi-avatars">' +
        data.members.slice(0, 5).map(function (m) {
          return '<div class="gi-av">' +
            (m.profile_pic ? '<img src="' + escapeHtml(m.profile_pic) + '" alt="" loading="lazy" decoding="async">' : initial(m.display_name)) +
          '</div>';
        }).join("") +
      '</div>' +
      '<h2 class="gi-name">' + escapeHtml(data.group.name) + '</h2>' +
      '<div class="gi-meta">' + data.members.length + ' জন সদস্য</div>' +

      '<div class="gi-section">' +
        '<div class="gi-section-title">সদস্যগণ</div>' +
        data.members.map(function (m) {
          return '<div class="gi-member" data-user="' + escapeHtml(m.username) + '">' +
            '<div class="gi-member-avatar">' +
              (m.profile_pic ? '<img src="' + escapeHtml(m.profile_pic) + '" alt="" loading="lazy" decoding="async">' : initial(m.display_name)) +
            '</div>' +
            '<div class="gi-member-name">' + escapeHtml(m.display_name) + '</div>' +
          '</div>';
        }).join("") +
      '</div>' +

      '<button class="btn-secondary danger-btn" id="gi-leave" style="width:100%;margin-top:20px">' +
        '<i class="fa-solid fa-right-from-bracket"></i> গ্রুপ ত্যাগ করুন' +
      '</button>' +
    '</div>';

  infoTab.innerHTML = html;
  infoTab.classList.remove("hidden");

  document.getElementById("gi-close").addEventListener("click", function () {
    infoTab.classList.add("hidden");
  });

  infoTab.querySelectorAll("[data-user]").forEach(function (el) {
    el.addEventListener("click", function () {
      infoTab.classList.add("hidden");
      openProfile(el.dataset.user);
    });
  });

  document.getElementById("gi-leave").addEventListener("click", async function () {
    if (!confirm("গ্রুপ থেকে বেরিয়ে যাবেন?")) return;
    try {
      await api("/api/groups/" + data.group.id + "/leave", { method: "POST" });
      infoTab.classList.add("hidden");
      var win = document.getElementById("group-chat-window");
      if (win) win.classList.add("hidden");
      _currentGroupId = null;
      stopGroupPolling();
      showToast("গ্রুপ ত্যাগ করা হয়েছে");
      await loadGroups();
    } catch (err) {
      alert(err.message);
    }
  });
}


// ---------- Hook into openMessagesPage ----------
(function () {
  if (typeof window.openMessagesPage !== "function") return;
  var _origOpen = window.openMessagesPage;
  window.openMessagesPage = async function () {
    await _origOpen();
    try { await loadGroups(); } catch (e) {}
  };
})();


// ==================================================
// MODAL — auto-scroll input into view on focus
// ==================================================

(function () {
  if (window._modalKbV2) return;
  window._modalKbV2 = true;

  function scrollInputIntoView(el) {
    var mc = el.closest(".modal-content");
    if (!mc) return;
    var rect = el.getBoundingClientRect();
    var vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    var target = vh * 0.35; // keep input 35% from top

    if (rect.top > target) {
      mc.scrollTop += (rect.top - target);
    }
  }

  document.addEventListener("focusin", function (e) {
    var t = e.target;
    if (!t || (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA")) return;
    if (!t.closest(".modal")) return;
    // Delay so keyboard finishes appearing
    setTimeout(function () { scrollInputIntoView(t); }, 100);
    setTimeout(function () { scrollInputIntoView(t); }, 350);
  });

  // Track viewport resize (keyboard show/hide)
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () {
      var t = document.activeElement;
      if (!t || (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA")) return;
      if (!t.closest(".modal")) return;
      scrollInputIntoView(t);
    });
  }

  console.log("[Modal] keyboard scroll v2 attached ✅");
})();


// ==================================================
// S6 — LOGOUT ALL DEVICES
// ==================================================

(function () {
  var btn = document.getElementById("btn-logout-all");
  if (!btn) return;

  btn.addEventListener("click", async function () {
    if (!confirm("সব অন্য ডিভাইস থেকে লগআউট করবেন?\n\nএই ডিভাইস চালু থাকবে।")) return;

    var oldHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> প্রস্তুত হচ্ছে...';

    try {
      await api("/api/me/logout-all", { method: "POST" });
      showToast("✅ সব ডিভাইস থেকে লগআউট হয়েছে");
    } catch (err) {
      alert(err.message || "কিছু ভুল হয়েছে");
    } finally {
      btn.disabled = false;
      btn.innerHTML = oldHTML;
    }
  });

  console.log("[S6] logout-all attached ✅");
})();


// ==================================================
// S7 — HTTP WARNING BANNER (non-localhost only)
// ==================================================

(function () {
  if (window._s7BannerInit) return;
  window._s7BannerInit = true;

  function isLocalhost() {
    var h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0";
  }

  function bannerDismissed() {
    try { return localStorage.getItem("juktoy_https_banner_dismissed") === "1"; }
    catch (e) { return false; }
  }

  function shouldShow() {
    return window.location.protocol !== "https:"
        && !isLocalhost()
        && !bannerDismissed();
  }

  function show() {
    if (!shouldShow()) return;
    if (document.getElementById("https-warning-banner")) return;

    var b = document.createElement("div");
    b.id = "https-warning-banner";
    b.className = "https-warning-banner";
    b.innerHTML =
      '<i class="fa-solid fa-triangle-exclamation"></i>' +
      '<span>এই সংযোগটি নিরাপদ নয় (HTTP)। পাসওয়ার্ড বা গোপন তথ্য শেয়ার করার আগে সতর্ক থাকুন।</span>' +
      '<button type="button" class="hwb-close" aria-label="বন্ধ করুন"><i class="fa-solid fa-xmark"></i></button>';

    document.body.appendChild(b);

    b.querySelector(".hwb-close").addEventListener("click", function () {
      try { localStorage.setItem("juktoy_https_banner_dismissed", "1"); } catch (e) {}
      b.remove();
    });
  }

  // Show after a short delay so it doesn't clash with entry animations
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(show, 800); });
  } else {
    setTimeout(show, 800);
  }

  console.log("[S7] https warning banner init ✅");
})();


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
    showMessage("অপেক্ষা করুন...");
    try {
      var res = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({
          username: f.username.value,
          password: f.password.value,
        }),
      });
      if (res && res.needs_2fa) {
        window._pending2fa.token = res.temp_token;
        window._pending2fa.method = res.method || "totp";
        showMessage("");
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
      showMessage("");
      await enterApp();
    } catch (err) {
      showMessage(err.message, "error");
    }
  }, true);

  // ---- 2FA code form ----
  twoForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    var code = (document.getElementById("login-2fa-code").value || "").trim();
    if (!code) return;
    showMessage("যাচাই হচ্ছে...");
    try {
      var res = await api("/api/login/2fa", {
        method: "POST",
        body: JSON.stringify({ temp_token: window._pending2fa.token, code: code }),
      });
      showMessage("");
      document.getElementById("login-2fa-code").value = "";
      await enterApp();
      if (res.used_backup) {
        showToast("✅ Backup code ব্যবহৃত। বাকি: " + res.backup_codes_remaining);
      }
    } catch (err) {
      showMessage(err.message, "error");
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
    showMessage("");
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
      var st = await api("/api/me/2fa/status");
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
      var res = await api("/api/me/2fa/setup", { method: "POST" });
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
    navigator.clipboard.writeText(val).then(function () { showToast("📋 সিক্রেট কপি হয়েছে"); });
  });
  document.getElementById("btn-copy-2fa-otpauth").addEventListener("click", function () {
    var val = document.getElementById("2fa-otpauth-display").value;
    navigator.clipboard.writeText(val).then(function () { showToast("📋 URI কপি হয়েছে"); });
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
      var res = await api("/api/me/2fa/verify", {
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
    navigator.clipboard.writeText(codes).then(function () { showToast("📋 সব কপি হয়েছে"); });
  });
  document.getElementById("btn-done-backup").addEventListener("click", function () {
    document.getElementById("2fa-backup-modal").classList.add("hidden");
    showToast("✅ 2FA চালু হয়েছে");
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
      await api("/api/me/2fa/disable", {
        method: "POST",
        body: JSON.stringify({ password: pw }),
      });
      closeDisable();
      showToast("2FA নিষ্ক্রিয় করা হয়েছে");
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
      var st = await api("/api/me/email/status");
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
      const res = await api("/api/me/email", {
        method: "POST",
        body: JSON.stringify({ email: em, password: pw }),
      });
      closeEditModal();
      if (res && res.already_verified) {
        showToast("✅ ইমেইল ইতিমধ্যে যাচাইকৃত");
      } else if (res && res.verify_required) {
        // S27B fix — open code-input modal
        showToast("📧 " + (res.message || "৬ ডিজিটের কোড পাঠানো হয়েছে"));
        _openEmailCodeModal(em);
      } else {
        showToast("✅ ইমেইল সেভ হয়েছে।");
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
        var r = await api("/api/me/email/confirm-code", {
          method: "POST",
          body: JSON.stringify({ code: code }),
        });
        close();
        if (typeof showToast === "function") showToast("✅ " + (r.message || "Email যাচাই সম্পন্ন"));
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
        var r = await api("/api/me/email/resend-code", { method: "POST" });
        hideErr();
        if (typeof showToast === "function") {
          showToast(r.already_verified ? "✅ ইমেইল ইতিমধ্যে যাচাইকৃত" : "📧 নতুন কোড পাঠানো হয়েছে");
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
      await api("/api/me/email/remove", {
        method: "POST",
        body: JSON.stringify({ password: pw }),
      });
      showToast("✅ ইমেইল মুছে ফেলা হয়েছে");
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
      await api("/api/auth/forgot/send", {
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
        await api("/api/me/email/verify", {
          method: "POST",
          body: JSON.stringify({ token: verifyTok }),
        });
        showToast("✅ ইমেইল যাচাই সম্পন্ন");
      } catch (err) {
        showToast("❌ " + (err.message || "যাচাই ব্যর্থ"));
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
      var res = await api("/api/auth/reset/check", {
        method: "POST",
        body: JSON.stringify({ token: token }),
      });
      if (!res.valid) {
        showToast("❌ লিংকটি invalid বা expire হয়েছে");
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
      showToast("❌ লিংক যাচাই করা যায়নি");
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
      await api("/api/auth/reset/complete", {
        method: "POST",
        body: JSON.stringify({ token: token, new_password: pw1 }),
      });
      closeReset();
      showToast("✅ পাসওয়ার্ড রিসেট হয়েছে। এখন লগইন করুন।");
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


// ==================================================
// S13-C — GOOGLE SIGN-IN (frontend)
// ==================================================

(function () {
  var btn = document.getElementById("btn-google-login");
  if (btn) {
    btn.addEventListener("click", function () {
      // Full-page redirect to backend (avoids popup blockers)
      window.location.href = "/api/auth/google/login";
    });
  }

  // Show error if redirected back with google_error
  var params = new URLSearchParams(window.location.search);
  var err = params.get("google_error");
  if (err) {
    var msgs = {
      missing_code: "Google থেকে অনুমতি আসেনি। আবার চেষ্টা করুন।",
      invalid_state: "নিরাপত্তা চেক ব্যর্থ। আবার চেষ্টা করুন।",
      not_configured: "Google Sign-In এখনো সেটআপ করা হয়নি।",
      token_exchange: "Google থেকে টোকেন পাওয়া যায়নি।",
      no_token: "Google অ্যাক্সেস টোকেন পাওয়া যায়নি।",
      userinfo: "Google প্রোফাইল পড়া যায়নি।",
      no_google_id: "Google আইডি পাওয়া যায়নি।",
      create_failed: "অ্যাকাউন্ট তৈরি করা যায়নি।",
      access_denied: "আপনি অনুমতি দেননি।",
      // S22 / Series 13 — new error codes
      "2fa_enabled": "এই ইমেইলের একটি অ্যাকাউন্টে 2FA চালু আছে। Google দিয়ে লগইন করা যাবে না — পাসওয়ার্ড দিয়ে লগইন করুন।",
    };
    var text = msgs[err] || ("Google error: " + err);
    setTimeout(function () {
      if (typeof showMessage === "function") showMessage(text, "error");
      else alert(text);
    }, 100);
    history.replaceState({}, "", window.location.pathname);
  }
})();


// ==================================================
// S14 — ADMIN PANEL
// ==================================================

var _isAdmin = false;

// ---- Detect admin status after login ----
async function _checkAdminStatus() {
  try {
    var res = await api("/api/admin/check");
    _isAdmin = !!res.is_admin;
    var navAdmin = document.getElementById("nav-admin");
    if (navAdmin) {
      navAdmin.classList.toggle("hidden", !_isAdmin);
    }
    // S22 / Layer 6 — 2FA warning for admin
    if (_isAdmin && res.needs_2fa_setup) {
      if (typeof showToast === "function") {
        setTimeout(function () {
          showToast("🛡️ অ্যাডমিন অ্যাক্সেসের জন্য 2FA চালু করুন — Settings → Two-Factor");
        }, 800);
      }
    }
  } catch (e) {
    _isAdmin = false;
  }
}

// Call after enterApp
_enterAppHooks.push(_checkAdminStatus);


// ---- Open admin page ----
function openAdminPage() {
  if (!_isAdmin) {
    showToast("🛡️ শুধু অ্যাডমিন অ্যাক্সেস করতে পারবেন");
    return;
  }
  var page = document.getElementById("admin-page");
  if (!page) return;
  page.classList.remove("hidden");
  document.body.classList.add("overlay-open");
  _pushPage("admin");
  _adminShowTab("dashboard");
}

function closeAdminPage() {
  var page = document.getElementById("admin-page");
  if (page) page.classList.add("hidden");
  document.body.classList.remove("overlay-open");
}

// ---- Tab switching ----
function _adminShowTab(name) {
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
  if (_PageStack.length > 0 && _PageStack[_PageStack.length - 1] === "admin") {
    history.back();
  } else {
    closeAdminPage();
  }
});

// ---- Extend _closeTopPage ----
const _origCloseTopPageAdmin = _closeTopPage;
_closeTopPage = function () {
  var top = _PageStack[_PageStack.length - 1];
  if (top === "admin") {
    _PageStack.pop();
    closeAdminPage();
    return true;
  }
  return _origCloseTopPageAdmin();
};

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
async function _loadAdminDashboard() {
  var el = document.getElementById("admin-pane-dashboard");
  if (!el) return;
  el.innerHTML = '<p style="text-align:center;color:var(--muted);padding:40px">লোড হচ্ছে...</p>';
  try {
    var stats = await api("/api/admin/stats");
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

function _statCard(label, value, icon, color) {
  return '<div class="admin-stat-card ' + color + '">' +
    '<div class="admin-stat-icon"><i class="fa-solid ' + icon + '"></i></div>' +
    '<div class="admin-stat-value">' + value + '</div>' +
    '<div class="admin-stat-label">' + label + '</div>' +
  '</div>';
}


// ---- Reports list ----
async function _loadAdminReports() {
  var el = document.getElementById("admin-pane-reports");
  if (!el) return;
  el.innerHTML = '<p style="text-align:center;color:var(--muted);padding:40px">লোড হচ্ছে...</p>';
  try {
    var reports = await api("/api/admin/reports?status=all");
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

function _adminReportHTML(r) {
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
    preview = '<div class="admin-report-preview">' + escapeHtml(target.content.slice(0, 200)) + '</div>';
    if (target.media && target.media.length) {
      preview += '<div class="admin-report-media">' + target.media.slice(0, 3).map(function (m) {
        return '<img src="' + escapeHtml(m) + '" alt="" loading="lazy" decoding="async">';
      }).join("") + '</div>';
    }
  } else if (r.target_type === "comment" && target.content) {
    preview = '<div class="admin-report-preview">' + escapeHtml(target.content.slice(0, 200)) + '</div>';
  } else if (r.target_type === "user") {
    preview = '<div class="admin-report-preview">ইউজার: @' + escapeHtml(target.username || "?") + '</div>';
  } else if (r.target_type === "reel" && target.caption) {
    preview = '<div class="admin-report-preview">' + escapeHtml(target.caption.slice(0, 200)) + '</div>';
  }

  var targetAuthor = "";
  if (target.username && r.target_type !== "user") {
    targetAuthor = '<div class="admin-report-author">লেখক: <strong>@' + escapeHtml(target.username) + '</strong></div>';
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
      ' • রিপোর্টার: <strong>@' + escapeHtml(r.reporter_username) + '</strong>' +
      ' • ' + timeAgo(r.created_at) +
    '</div>' +
    targetAuthor +
    preview +
    (r.notes ? '<div class="admin-report-notes">📝 ' + escapeHtml(r.notes) + '</div>' : '') +
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

async function _adminHandleReportAction(btn) {
  var action = btn.dataset.action;
  var rid = btn.dataset.rid;
  if (!action || !rid) return;

  if (action === "dismiss" || action === "reopen") {
    try {
      await api("/api/admin/reports/" + rid + "/action", {
        method: "POST",
        body: JSON.stringify({ action: action }),
      });
      showToast(action === "dismiss" ? "✖️ বাতিল করা হয়েছে" : "🔁 আবার খোলা হয়েছে");
      _loadAdminReports();
    } catch (err) { alert(err.message); }
    return;
  }

  if (action === "delete") {
    if (!confirm("এই কনটেন্ট মুছে ফেলবেন? এটি ফেরানো যাবে না।")) return;
    try {
      await api("/api/admin/reports/" + rid + "/action", {
        method: "POST",
        body: JSON.stringify({ action: "delete" }),
      });
      showToast("🗑️ মুছে ফেলা হয়েছে");
      _loadAdminReports();
    } catch (err) { alert(err.message); }
    return;
  }

  if (action === "ban") {
    _adminOpenBanModal(rid);
    return;
  }
}

function _adminOpenBanModal(reportId) {
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
        await api("/api/admin/reports/" + reportId + "/action", {
          method: "POST",
          body: JSON.stringify({ action: "ban", ban_days: days, ban_reason: reason }),
        });
        modal.classList.add("hidden");
        showToast("🚫 ইউজার ban করা হয়েছে");
        _loadAdminReports();
      } catch (err) { alert(err.message); }
    });
  });
}


// ---- Users ----
async function _loadAdminUsers() {
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

async function _adminFetchUsers(q) {
  var list = document.getElementById("admin-users-list");
  if (!list) return;
  list.innerHTML = '<p style="text-align:center;color:var(--muted);padding:30px">লোড হচ্ছে...</p>';
  try {
    var users = await api("/api/admin/users?q=" + encodeURIComponent(q));
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

function _adminUserRowHTML(u) {
  var badge = "";
  if (u.is_admin) badge += ' <span class="admin-badge blue">Admin</span>';
  if (u.is_banned) badge += ' <span class="admin-badge red">Banned</span>';
  if (u.google_linked) badge += ' <span class="admin-badge gray">Google</span>';
  if (u.pending_reports > 0) badge += ' <span class="admin-badge orange">' + u.pending_reports + ' report</span>';

  return '<div class="admin-user-row">' +
    '<div class="admin-user-avatar">' + avatarInner(u.display_name, u.profile_pic) + '</div>' +
    '<div class="admin-user-info">' +
      '<div class="admin-user-name">' + escapeHtml(u.display_name) + badge + '</div>' +
      '<div class="admin-user-username">@' + escapeHtml(u.username) + '</div>' +
      (u.email ? '<div class="admin-user-email">' + escapeHtml(u.email) + '</div>' : "") +
      (u.is_banned ? '<div class="admin-user-ban-reason">কারণ: ' + escapeHtml(u.ban_reason || "—") + '</div>' : "") +
    '</div>' +
    '<div class="admin-user-actions">' +
      (u.is_banned
        ? '<button class="admin-btn" data-user-action="unban" data-uid="' + u.id + '"><i class="fa-solid fa-unlock"></i> আনব্যান</button>'
        : (u.is_admin
            ? ""
            : '<button class="admin-btn danger" data-user-action="ban" data-uid="' + u.id + '" data-uname="' + escapeHtml(u.username) + '"><i class="fa-solid fa-ban"></i> Ban</button>')) +
    '</div>' +
  '</div>';
}

async function _adminUserAction(btn) {
  var action = btn.dataset.userAction;
  var uid = btn.dataset.uid;
  if (action === "unban") {
    try {
      await api("/api/admin/users/" + uid + "/unban", { method: "POST" });
      showToast("✅ আনব্যান করা হয়েছে");
      _adminFetchUsers(document.getElementById("admin-user-search")?.value || "");
    } catch (err) { alert(err.message); }
  } else if (action === "ban") {
    _adminOpenUserBanModal(uid, btn.dataset.uname || "");
  }
}

function _adminOpenUserBanModal(uid, username) {
  var modal = document.getElementById("admin-action-modal");
  if (!modal) return;
  document.getElementById("admin-action-title").innerHTML = '<i class="fa-solid fa-ban" style="color:var(--danger)"></i> @' + escapeHtml(username) + ' কে ban';
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
        await api("/api/admin/users/" + uid + "/ban", {
          method: "POST",
          body: JSON.stringify({ ban_days: days, ban_reason: reason }),
        });
        modal.classList.add("hidden");
        showToast("🚫 ইউজার ban করা হয়েছে");
        _adminFetchUsers(document.getElementById("admin-user-search")?.value || "");
      } catch (err) { alert(err.message); }
    });
  });
}


// ---- Log ----
async function _loadAdminLog() {
  var el = document.getElementById("admin-pane-log");
  if (!el) return;
  el.innerHTML = '<p style="text-align:center;color:var(--muted);padding:40px">লোড হচ্ছে...</p>';
  try {
    var logs = await api("/api/admin/log");
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
        '<div class="admin-log-avatar">' + avatarInner(l.admin_name, l.admin_pic) + '</div>' +
        '<div class="admin-log-body">' +
          '<div class="admin-log-action">' + (actionLabels[l.action] || l.action) + ' — <strong>' + escapeHtml(l.target_type) + ' #' + l.target_id + '</strong></div>' +
          '<div class="admin-log-admin">এডমিন: @' + escapeHtml(l.admin_username) + '</div>' +
          (l.notes ? '<div class="admin-log-notes">' + escapeHtml(l.notes) + '</div>' : "") +
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

function _clientPasswordCheck(pw) {
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
      showMessage(err, "error");
    }
  }, true);
})();

// Change password validation
(function () {
  var btn = document.getElementById("btn-change-pw");
  if (!btn) return;
  btn.addEventListener("click", function (e) {
    var pw = document.getElementById("set-new-pw").value;
    var err = _clientPasswordCheck(pw);
    if (err) {
      e.preventDefault();
      e.stopImmediatePropagation();
      showToast("⚠️ " + err);
    }
  }, true);
})();

// Forgot reset (reset-modal) validation
(function () {
  var btn = document.getElementById("reset-submit");
  if (!btn) return;
  btn.addEventListener("click", function (e) {
    var pw = document.getElementById("reset-new-pw").value;
    var err = _clientPasswordCheck(pw);
    if (err) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var errEl = document.getElementById("reset-error");
      if (errEl) { errEl.textContent = err; errEl.classList.remove("hidden"); }
    }
  }, true);
})();

console.log("[S15.1] strong password check attached ✅");


// ==================================================
// S15.3 — LOGIN HISTORY UI
// ==================================================

(function () {
  var card = document.getElementById("login-history-card");
  if (!card) return;

  var list = document.getElementById("login-history-list");

  async function load() {
    list.innerHTML = '<p class="empty-text" style="padding:12px 0">লোড হচ্ছে...</p>';
    try {
      var rows = await api("/api/me/logins?limit=10");
      if (!rows.length) {
        list.innerHTML = '<p class="empty-text" style="padding:12px 0">কোনো লগইন ইতিহাস নেই</p>';
        return;
      }
      list.innerHTML = rows.map(function (r) {
        return '<div class="login-history-row">' +
          '<div class="login-history-icon ' + (r.is_new_device ? "new" : "") + '">' +
            '<i class="fa-solid ' + (r.is_new_device ? "fa-triangle-exclamation" : "fa-circle-check") + '"></i>' +
          '</div>' +
          '<div class="login-history-info">' +
            '<div class="login-history-device">' + escapeHtml(r.device_label || "Unknown") +
              (r.is_new_device ? ' <span class="login-history-new">নতুন</span>' : '') +
            '</div>' +
            '<div class="login-history-meta">' +
              escapeHtml(r.method_label) + ' • ' + escapeHtml(r.ip || "?") + ' • ' + timeAgo(r.created_at) +
            '</div>' +
          '</div>' +
        '</div>';
      }).join("");
    } catch (err) {
      list.innerHTML = '<p class="empty-text" style="padding:12px 0">লোড করা যায়নি</p>';
    }
  }

  // Load when settings opens
  // S39 — exposed for unified loader
  window._loadLoginHistory = load;
  // S39 — wrapper disabled (unified loader at end of file)

  // Clear button
  document.getElementById("btn-clear-logins").addEventListener("click", async function () {
    if (!confirm("সব লগইন ইতিহাস মুছে ফেলবেন?")) return;
    try {
      await api("/api/me/sessions/clear", { method: "POST" });
      showToast("🗑️ ইতিহাস মুছে ফেলা হয়েছে");
      load();
    } catch (err) { alert(err.message); }
  });

  console.log("[S15.3] login history attached ✅");
})();


// ==================================================
// S15.4 — ACTIVE SESSIONS UI
// ==================================================

(function () {
  var card = document.getElementById("active-sessions-card");
  if (!card) return;

  var list = document.getElementById("active-sessions-list");

  async function load() {
    list.innerHTML = '<p class="empty-text" style="padding:12px 0">লোড হচ্ছে...</p>';
    try {
      var rows = await api("/api/me/sessions");
      if (!rows.length) {
        list.innerHTML = '<p class="empty-text" style="padding:12px 0">কোনো সক্রিয় সেশন নেই</p>';
        return;
      }
      list.innerHTML = rows.map(function (s) {
        return '<div class="session-row' + (s.is_current ? " current" : "") + '">' +
          '<div class="session-icon">' +
            '<i class="fa-solid ' + (s.is_current ? "fa-circle-check" : "fa-desktop") + '"></i>' +
          '</div>' +
          '<div class="session-info">' +
            '<div class="session-device">' + escapeHtml(s.device_label || "Unknown") +
              (s.is_current ? ' <span class="session-current-badge">এই ডিভাইস</span>' : '') +
            '</div>' +
            '<div class="session-meta">' +
              escapeHtml(s.method_label) + ' • ' + escapeHtml(s.ip || "?") + '<br>' +
              'সর্বশেষ: ' + timeAgo(s.last_seen) +
            '</div>' +
          '</div>' +
          (s.is_current ? '' :
            '<button class="session-revoke" data-sid="' + s.id + '" title="লগআউট করুন">' +
              '<i class="fa-solid fa-xmark"></i>' +
            '</button>') +
        '</div>';
      }).join("");

      list.querySelectorAll(".session-revoke").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          if (!confirm("এই ডিভাইস থেকে লগআউট করবেন?")) return;
          try {
            await api("/api/me/sessions/" + btn.dataset.sid + "/revoke", { method: "POST" });
            showToast("✅ ডিভাইস থেকে লগআউট হয়েছে");
            load();
          } catch (err) { alert(err.message); }
        });
      });
    } catch (err) {
      list.innerHTML = '<p class="empty-text" style="padding:12px 0">লোড করা যায়নি</p>';
    }
  }

  // Load on settings open
  // S39 — exposed for unified loader
  window._loadSessions = load;
  // S39 — wrapper disabled (unified loader at end of file)

  // Revoke all others
  document.getElementById("btn-revoke-others").addEventListener("click", async function () {
    if (!confirm("অন্য সব ডিভাইস থেকে লগআউট করবেন?\n\nআপনার এই ডিভাইস চালু থাকবে।")) return;
    try {
      await api("/api/me/sessions/revoke-others", { method: "POST" });
      showToast("✅ অন্য সব ডিভাইস থেকে লগআউট হয়েছে");
      load();
    } catch (err) { alert(err.message); }
  });

  console.log("[S15.4] sessions UI attached ✅");
})();


// ==================================================
// S15.4b — INSTANT LOGOUT ON SESSION REVOKE
// ==================================================

(function () {
  // BroadcastChannel — same browser এর সব tabs এ message পাঠাবে
  var bc = null;
  try {
    bc = new BroadcastChannel("juktoy_session");
  } catch (e) {
    console.warn("[S15.4b] BroadcastChannel not supported");
  }

  // Listen for logout broadcast from other tabs
  if (bc) {
    bc.addEventListener("message", function (e) {
      if (e.data && e.data.type === "logout") {
        console.log("[S15.4b] Logout broadcast received");
        // Force logout — reload page
        window.location.reload();
      }
    });
  }

  // Hook into revoke actions — broadcast to other tabs
  var _origRevokeSession = null;

  // Broadcast when user clicks "revoke others"
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("#btn-revoke-others");
    if (btn && bc) {
      // Small delay so the API call completes first
      setTimeout(function () {
        try { bc.postMessage({ type: "logout", reason: "revoked-others" }); } catch (err) {}
      }, 500);
    }
  }, true);

  // Broadcast when individual session is revoked
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".session-revoke");
    if (btn && bc) {
      setTimeout(function () {
        try { bc.postMessage({ type: "logout", reason: "revoked-one" }); } catch (err) {}
      }, 500);
    }
  }, true);

  // ---- Polling for different-device revocation ----
  // Every 30 seconds, ping /api/me to check session validity
  var _pollTimer = null;
  var _pollInterval = 30000;  // 30 seconds
  var _lastPollAt = Date.now();

  function startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(function () {
      // Skip if page hidden (battery save)
      if (document.hidden) return;
      // Skip if no user (not logged in)
      if (!state.me) return;
      // Skip if last poll < interval
      if (Date.now() - _lastPollAt < _pollInterval - 5000) return;
      _lastPollAt = Date.now();

      fetch(BASE_URL + "/api/me", { credentials: "include" })
        .then(function (r) {
          if (r.status === 401) {
            // Session revoked
            console.log("[S15.4b] Session revoked (poll detected)");
            window.location.reload();
          }
          return r.json();
        })
        .then(function (d) {
          if (!d || !d.user) {
            console.log("[S15.4b] No user in /api/me response");
            window.location.reload();
          }
        })
        .catch(function () {
          // Network error — ignore
        });
    }, 5000);  // Check every 5s if interval elapsed
  }

  // Start polling after login
  _enterAppHooks.push(function () {
    startPolling();
    _lastPollAt = Date.now();
  });

  // Also poll on visibility change (user returns to tab)
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && state.me) {
      _lastPollAt = 0;  // Force immediate check
    }
  });

  console.log("[S15.4b] instant logout attached ✅");
})();


// ==================================================
// S15.5 — SENSITIVE ACTION VERIFICATION (frontend)
// ==================================================
// ৬টা sensitive action-এ password + (2FA on হলে) TOTP code
// Strategy: document-capture delegation, stopImmediatePropagation
// কোনো clone নেই → original handler fire করে না → state অটুট
// ==================================================

async function _askSensitiveVerify(opts) {
  opts = opts || {};
  var title       = opts.title       || "নিশ্চিত করুন";
  var description = opts.description || "এই কাজটি সম্পন্ন করতে আপনার পাসওয়ার্ড দিন।";
  var submitLabel = opts.submitLabel || "নিশ্চিত করুন";
  var danger      = !!opts.danger;
  var prefill     = opts.prefillPassword || "";

  var tfaEnabled = false;
  try {
    var st = await api("/api/me/2fa/status");
    // S29.4 - Only TOTP gates sensitive actions.
    // Email-2FA protects LOGIN only. The backend verifier
    // (_verify_sensitive_action) checks only totp_enabled, so
    // asking for a code from email-2FA users would deadlock
    // the flow (no code is ever sent for sensitive actions).
    tfaEnabled = !!(st && st.totp_enabled);
  } catch (e) {}

  return new Promise(function (resolve) {
    var old = document.getElementById("sensitive-verify-modal");
    if (old) old.remove();

    var modal = document.createElement("div");
    modal.id = "sensitive-verify-modal";
    modal.className = "modal";
    modal.innerHTML =
      '<div class="modal-content" style="max-width:440px">' +
        '<button class="close-btn" id="sv-close" type="button">×</button>' +
        '<h2 style="margin-bottom:10px;font-size:19px;display:flex;align-items:center;gap:10px">' +
          '<i class="fa-solid ' + (danger ? "fa-triangle-exclamation" : "fa-lock") + '" ' +
            'style="color:' + (danger ? "var(--danger)" : "var(--accent)") + '"></i> ' +
          escapeHtml(title) +
        '</h2>' +
        '<p class="settings-hint" style="margin-bottom:14px">' + escapeHtml(description) + '</p>' +
        '<div class="input-group" style="margin-bottom:10px">' +
          '<i class="fa-solid fa-lock input-icon"></i>' +
          '<input type="password" id="sv-password" placeholder="পাসওয়ার্ড" autocomplete="current-password">' +
        '</div>' +
        (tfaEnabled
          ? '<div class="input-group" style="margin-bottom:10px">' +
              '<i class="fa-solid fa-shield-halved input-icon"></i>' +
              '<input type="text" id="sv-code" placeholder="2FA কোড বা backup code" ' +
                'inputmode="text" autocomplete="one-time-code">' +
            '</div>'
          : '') +
        '<p id="sv-error" class="hidden" style="color:var(--danger);font-size:13px;' +
          'margin:0 0 10px;text-align:center;font-weight:600"></p>' +
        '<div class="edit-actions">' +
          '<button class="btn-secondary" type="button" id="sv-cancel">বাতিল</button>' +
          '<button class="btn-primary' + (danger ? ' danger-btn' : '') + '" ' +
            'type="button" id="sv-submit" style="width:auto;padding:12px 24px">' +
            '<i class="fa-solid fa-check"></i> ' + escapeHtml(submitLabel) +
          '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    function close(result) { modal.remove(); resolve(result || null); }

    function showError(msg) {
      var el = document.getElementById("sv-error");
      if (el) { el.textContent = msg; el.classList.remove("hidden"); }
    }

    document.getElementById("sv-close").onclick  = function () { close(null); };
    document.getElementById("sv-cancel").onclick = function () { close(null); };
    modal.addEventListener("click", function (e) {
      if (e.target === modal) close(null);
    });

    setTimeout(function () {
      var p = document.getElementById("sv-password");
      var c = document.getElementById("sv-code");
      if (p && prefill) p.value = prefill;
      if (c) c.focus();
      else if (p) p.focus();
    }, 80);

    function submit() {
      var pwEl   = document.getElementById("sv-password");
      var codeEl = document.getElementById("sv-code");
      var pw   = pwEl   ? (pwEl.value   || "").trim() : "";
      var code = codeEl ? (codeEl.value || "").trim() : "";

      if (!pw) return showError("পাসওয়ার্ড দিন");
      if (tfaEnabled && !code) return showError("2FA কোড দিন");

      close({ password: pw, totp_code: code });
    }

    document.getElementById("sv-submit").onclick = submit;
    document.getElementById("sv-password").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });
    var codeIn = document.getElementById("sv-code");
    if (codeIn) codeIn.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });
  });
}


// --------------------------------------------------
// 1) Change password
// --------------------------------------------------
document.addEventListener("click", async function (e) {
  var btn = e.target.closest("#btn-change-pw");
  if (!btn) return;
  e.preventDefault();
  e.stopImmediatePropagation();

  var cur  = (document.getElementById("set-current-pw").value || "").trim();
  var neu  = (document.getElementById("set-new-pw").value     || "").trim();
  var conf = (document.getElementById("set-confirm-pw").value || "").trim();

  if (!cur || !neu || !conf) return showToast("সব ফিল্ড পূরণ করুন");
  if (neu.length < 8)        return showToast("নতুন পাসওয়ার্ড ৮+ অক্ষর হতে হবে");
  if (neu !== conf)          return showToast("নতুন পাসওয়ার্ড দুইবার একই লিখুন");
  if (cur === neu)           return showToast("নতুন পাসওয়ার্ড পুরোনোর মতো হতে পারে না");

  var v = await _askSensitiveVerify({
    title: "পাসওয়ার্ড পরিবর্তন",
    description: "নিশ্চিত করতে আপনার পাসওয়ার্ড দিন।",
    submitLabel: "পরিবর্তন করুন",
    prefillPassword: cur
  });
  if (!v) return;

  var old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await api("/api/me/password", {
      method: "POST",
      body: JSON.stringify({
        current_password: v.password,
        new_password:     neu,
        totp_code:        v.totp_code || ""
      })
    });
    ["set-current-pw", "set-new-pw", "set-confirm-pw"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
    showToast("✅ পাসওয়ার্ড পরিবর্তন হয়েছে");
  } catch (err) {
    alert((err && err.message) || "কিছু ভুল হয়েছে");
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}, true);


// --------------------------------------------------
// 2) Change username
// --------------------------------------------------
document.addEventListener("click", async function (e) {
  var btn = e.target.closest("#btn-change-uname");
  if (!btn) return;
  e.preventDefault();
  e.stopImmediatePropagation();

  var uname = (document.getElementById("set-username").value || "").trim().toLowerCase();
  if (!uname)                       return showToast("নতুন ইউজারনেম লিখুন");
  if (!/^[a-z0-9_]+$/.test(uname))  return showToast("শুধু a-z, 0-9, _ ব্যবহার করুন");
  if (state.me && uname === state.me.username)
    return showToast("এটাই আপনার বর্তমান ইউজারনেম");

  var v = await _askSensitiveVerify({
    title: "ইউজারনেম পরিবর্তন",
    description: "নিশ্চিত করতে পাসওয়ার্ড দিন।",
    submitLabel: "পরিবর্তন"
  });
  if (!v) return;

  var old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    var res = await api("/api/me/username", {
      method: "POST",
      body: JSON.stringify({
        username:  uname,
        password:  v.password,
        totp_code: v.totp_code || ""
      })
    });
    if (state.me) state.me.username = res.username;
    if (typeof refreshProfileUI === "function") refreshProfileUI();
    var cu = document.getElementById("set-current-uname");
    if (cu) cu.textContent = "@" + res.username;
    showToast("✅ ইউজারনেম পরিবর্তন হয়েছে");
  } catch (err) {
    alert((err && err.message) || "কিছু ভুল হয়েছে");
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}, true);


// --------------------------------------------------
// 3) Delete account
// --------------------------------------------------
document.addEventListener("click", async function (e) {
  var btn = e.target.closest("#btn-delete-account");
  if (!btn) return;
  e.preventDefault();
  e.stopImmediatePropagation();

  if (!confirm("আপনি কি সত্যিই অ্যাকাউন্ট ডিলিট করতে চান? এটি ফেরানো যাবে না।")) return;

  var v = await _askSensitiveVerify({
    title: "অ্যাকাউন্ট ডিলিট",
    description: "এই কাজ স্থায়ী। নিশ্চিত করতে পাসওয়ার্ড দিন।",
    submitLabel: "চিরতরে মুছুন",
    danger: true
  });
  if (!v) return;

  var old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await api("/api/me/delete-account", {
      method: "POST",
      body: JSON.stringify({
        password:  v.password,
        totp_code: v.totp_code || ""
      })
    });
    try { localStorage.clear(); } catch (er) {}
    showToast("অ্যাকাউন্ট মুছে ফেলা হয়েছে");
    setTimeout(function () { window.location.reload(); }, 1200);
    return;
  } catch (err) {
    alert((err && err.message) || "কিছু ভুল হয়েছে");
    btn.disabled = false;
    btn.innerHTML = old;
  }
}, true);


// --------------------------------------------------
// 4) Remove email
// --------------------------------------------------
document.addEventListener("click", async function (e) {
  var btn = e.target.closest("#btn-remove-email");
  if (!btn) return;
  e.preventDefault();
  e.stopImmediatePropagation();

  var v = await _askSensitiveVerify({
    title: "ইমেইল সরান",
    description: "নিশ্চিত করতে পাসওয়ার্ড দিন।",
    submitLabel: "সরান",
    danger: true
  });
  if (!v) return;

  var old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await api("/api/me/email/remove", {
      method: "POST",
      body: JSON.stringify({
        password:  v.password,
        totp_code: v.totp_code || ""
      })
    });
    showToast("✅ ইমেইল সরানো হয়েছে");
    window.dispatchEvent(new Event("focus"));
  } catch (err) {
    alert((err && err.message) || "কিছু ভুল হয়েছে");
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}, true);


// --------------------------------------------------
// 5) Disable 2FA
// --------------------------------------------------
document.addEventListener("click", async function (e) {
  var btn = e.target.closest("#btn-disable-2fa");
  if (!btn) return;
  e.preventDefault();
  e.stopImmediatePropagation();

  var v = await _askSensitiveVerify({
    title: "2FA নিষ্ক্রিয় করুন",
    description: "নিশ্চিত করতে পাসওয়ার্ড এবং বর্তমান 2FA কোড দিন।",
    submitLabel: "নিষ্ক্রিয় করুন",
    danger: true
  });
  if (!v) return;

  var old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await api("/api/me/2fa/disable", {
      method: "POST",
      body: JSON.stringify({
        password:  v.password,
        totp_code: v.totp_code || ""
      })
    });
    showToast("✅ 2FA নিষ্ক্রিয় করা হয়েছে");
    window.dispatchEvent(new Event("focus"));
  } catch (err) {
    alert((err && err.message) || "কিছু ভুল হয়েছে");
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}, true);


// --------------------------------------------------
// 6) Revoke all other sessions
// --------------------------------------------------
document.addEventListener("click", async function (e) {
  var btn = e.target.closest("#btn-revoke-others");
  if (!btn) return;
  e.preventDefault();
  e.stopImmediatePropagation();

  var v = await _askSensitiveVerify({
    title: "অন্য সব থেকে লগআউট",
    description: "সব অন্য ডিভাইস থেকে লগআউট হবে। এই ডিভাইস চালু থাকবে।",
    submitLabel: "লগআউট করুন"
  });
  if (!v) return;

  var old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await api("/api/me/sessions/revoke-others", {
      method: "POST",
      body: JSON.stringify({
        password:  v.password,
        totp_code: v.totp_code || ""
      })
    });
    showToast("✅ অন্য সব ডিভাইস থেকে লগআউট");
    try {
      var bc = new BroadcastChannel("juktoy_session");
      bc.postMessage({ type: "logout", reason: "revoked-others" });
      bc.close();
    } catch (er) {}
  } catch (err) {
    alert((err && err.message) || "কিছু ভুল হয়েছে");
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}, true);


console.log("[S15.5] all 6 sensitive-action overrides attached ✅");

// ==================================================
// S21.3e — _attachReelProgress (force top-level)
// Ensures loadReels() can always find this
// ==================================================
if (typeof window._attachReelProgress !== "function") {
  window._attachReelProgress = function _attachReelProgress(video, item) {
    if (!video || !item) return;
    var fill = item.querySelector(".reel-progress-fill");
    if (!fill) return;

    function update() {
      if (video.duration && isFinite(video.duration) && video.duration > 0) {
        var pct = (video.currentTime / video.duration) * 100;
        fill.style.width = pct + "%";
      }
    }

    // Avoid double-attach
    if (video.dataset.progressAttached === "1") return;
    video.dataset.progressAttached = "1";

    video.addEventListener("timeupdate", update);
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("seeked", update);
    video.addEventListener("play", update);
  };
  console.log("[S21.3e] _attachReelProgress registered");
}


// ═══════════════════════════════════════════════
// Series 3A — Voice Recorder
// ═══════════════════════════════════════════════

var _vr = {
  recorder: null,
  chunks: [],
  startAt: 0,
  timer: null,
  cancelled: false,
  stream: null,
  rawStream: null,
  actx: null,
  active: false
};

function _blobToDataURL(blob) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function _vrFormatTime(ms) {
  var s = Math.floor(ms / 1000);
  var m = Math.floor(s / 60);
  var r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
}

function _vrShowUI() {
  var el = document.getElementById("voice-recorder");
  if (!el) return;
  el.classList.remove("hidden");
  el.classList.add("show");
}

function _vrHideUI() {
  var el = document.getElementById("voice-recorder");
  if (!el) return;
  el.classList.remove("show");
  setTimeout(function () { el.classList.add("hidden"); }, 220);
  var timer = document.getElementById("vr-timer");
  if (timer) timer.textContent = "0:00";
  var hint = document.getElementById("vr-hint");
  if (hint) hint.textContent = "রেকর্ড হচ্ছে... ছেড়ে দিলে বা ✓ চাপুন";
  var cancel = document.getElementById("vr-cancel");
  if (cancel) cancel.classList.remove("armed");
  var send = document.getElementById("vr-send");
  if (send) send.classList.remove("disabled");
}

async function _vrStart() {
  if (_vr.active) return;
  if (!currentChatUser) return;

  console.log("[VR] secure:", window.isSecureContext,
              "| mediaDevices:", !!navigator.mediaDevices,
              "| getUserMedia:", !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
              "| MediaRecorder:", !!window.MediaRecorder,
              "| protocol:", window.location.protocol,
              "| host:", window.location.host);

  if (!window.isSecureContext) {
    showToast("⚠️ HTTP-এ mic কাজ করে না — HTTPS দরকার");
    console.error("[VR] insecure context");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast("এই ব্রাউজারে mic সাপোর্ট নেই");
    return;
  }
  if (!window.MediaRecorder) {
    showToast("এই ব্রাউজারে MediaRecorder নেই");
    return;
  }

  try {
    var rawStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      }
    });

    // === Amplify: use Web Audio gain node to boost recorded volume ===
    var stream = rawStream;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        if (!_vr.actx) _vr.actx = new AC();
        var actx = _vr.actx;
        if (actx.state === "suspended") { try { await actx.resume(); } catch (e) {} }
        var srcNode = actx.createMediaStreamSource(rawStream);
        var gainNode = actx.createGain();
        // 3.5x amplification — safe for typical smartphone mic input
        gainNode.gain.value = 3.5;
        // Compressor to prevent clipping
        var comp = actx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 12;
        comp.ratio.value = 6;
        comp.attack.value = 0.003;
        comp.release.value = 0.25;

        var dest = actx.createMediaStreamDestination();
        srcNode.connect(gainNode);
        gainNode.connect(comp);
        comp.connect(dest);
        stream = dest.stream;
        _vr.rawStream = rawStream;
      }
    } catch (gErr) {
      console.warn("[VR] gain node failed, using raw:", gErr);
      stream = rawStream;
    }

    _vr.stream = stream;
    _vr.rawStream = rawStream;
    _vr.chunks = [];
    _vr.cancelled = false;

    var mime = "audio/webm";
    if (!MediaRecorder.isTypeSupported(mime)) mime = "";
    _vr.recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128000 })
      : new MediaRecorder(stream);

    _vr.recorder.ondataavailable = function (e) {
      if (e.data && e.data.size > 0) _vr.chunks.push(e.data);
    };

    _vr.recorder.onstop = async function () {
      var duration = (Date.now() - _vr.startAt) / 1000;
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try {
        if (_vr.rawStream) _vr.rawStream.getTracks().forEach(function (t) { t.stop(); });
      } catch (e) {}
      _vr.stream = null;
      _vr.rawStream = null;
      _vr.active = false;

      if (_vr.cancelled) { _vrHideUI(); return; }
      if (duration < 0.6) {
        showToast("খুব ছোট — একটু বড় করে বলুন");
        _vrHideUI();
        return;
      }
      if (duration > 300) {
        showToast("৫ মিনিটের বেশি রেকর্ড করা যাবে না");
        _vrHideUI();
        return;
      }

      _vrHideUI();
      try {
        var blob = new Blob(_vr.chunks, { type: "audio/webm" });
        var dataUrl = await _blobToDataURL(blob);
        await _vrSend(dataUrl, duration);
      } catch (e) {
        showToast("ভয়েস পাঠানো যায়নি");
      }
    };

    _vr.recorder.start();
    _vr.active = true;
    _vr.startAt = Date.now();
    _vrShowUI();

    // Timer
    if (_vr.timer) clearInterval(_vr.timer);
    _vr.timer = setInterval(function () {
      var el = document.getElementById("vr-timer");
      if (el) el.textContent = _vrFormatTime(Date.now() - _vr.startAt);
      var el2 = document.getElementById("vr-timer");
      var dur = (Date.now() - _vr.startAt) / 1000;
      if (dur > 300) _vrStop(true);
    }, 120);

    if (navigator.vibrate) navigator.vibrate(12);
  } catch (e) {
    console.error("[VR] error name:", e.name, "| message:", e.message);
    var msg = "মাইক চালু করা যায়নি";
    if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
      msg = "মাইক অনুমতি denied — Chrome সেটিংস থেকে Allow করুন";
    } else if (e.name === "NotFoundError") {
      msg = "মাইক্রোফোন পাওয়া যায়নি";
    } else if (e.name === "NotReadableError") {
      msg = "মাইক্রোফোন অন্য অ্যাপ ব্যবহার করছে";
    } else if (e.name === "SecurityError") {
      msg = "নিরাপত্তা ত্রুটি — HTTPS দরকার";
    } else if (e.name === "AbortError") {
      msg = "রেকর্ডিং বন্ধ হয়েছে";
    } else if (e.name) {
      msg = "Mic error: " + e.name;
    }
    showToast(msg);
    _vr.active = false;
  }
}

function _vrStop(cancel) {
  if (!_vr.active) return;
  _vr.cancelled = !!cancel;
  try { _vr.recorder.stop(); } catch (e) {}
  if (_vr.timer) { clearInterval(_vr.timer); _vr.timer = null; }
  if (navigator.vibrate) navigator.vibrate(15);
}

async function _vrSend(dataUrl, duration) {
  if (!currentChatUser) return;
  try {
    var res = await api("/api/messages/" + encodeURIComponent(currentChatUser) + "/voice", {
      method: "POST",
      body: JSON.stringify({ audio: dataUrl, duration: duration }),
    });
    await loadChatMessages(true);
    await loadConversations();
    if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
  } catch (e) {
    alert(e.message || "ভয়েস পাঠানো যায়নি");
  }
}

// ---- Wire mic button ----
(function () {
  var btn = document.getElementById("chat-mic-btn");
  if (!btn) return;

  var startedByPress = false;
  var pressTimer = null;

  function startPress(e) {
    if (e) e.preventDefault();
    if (_vr.active) return;
    startedByPress = true;
    _vrStart();
  }
  function endPress(e) {
    if (e) e.preventDefault();
    if (!startedByPress) return;
    startedByPress = false;
    if (!_vr.active) return;

    // If cancel button armed → cancel
    var cancelBtn = document.getElementById("vr-cancel");
    if (cancelBtn && cancelBtn.classList.contains("armed")) {
      _vrStop(true);
      return;
    }

    // Auto-send after ~1.2s of recording (fast path)
    // Below that threshold, keep the overlay open so user can decide
    var heldMs = Date.now() - _vr.startAt;
    if (heldMs >= 1200) {
      _vrStop(false);
    } else {
      // Keep recording — user must explicitly tap ✓ পাঠান
      // (they can also hit ✕ বাতিল)
      var hint = document.getElementById("vr-hint");
      if (hint) hint.textContent = "✓ পাঠান চাপুন";
    }
  }

  // Touch (mobile)
  btn.addEventListener("touchstart", startPress, { passive: false });
  btn.addEventListener("touchend", endPress);
  btn.addEventListener("touchcancel", function (e) { endPress(e); });

  // Mouse (desktop)
  btn.addEventListener("mousedown", startPress);
  btn.addEventListener("mouseup", endPress);
  btn.addEventListener("mouseleave", function (e) {
    if (startedByPress) endPress(e);
  });
})();

// ---- Send button ----
(function () {
  var sb = document.getElementById("vr-send");
  if (!sb) return;
  sb.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    _vrStop(false);   // stop & send
  });
  // long-press safe (no repeat)
  sb.addEventListener("mousedown", function (e) { e.preventDefault(); });
})();

// ---- Cancel button ----
(function () {
  var cb = document.getElementById("vr-cancel");
  if (!cb) return;
  cb.addEventListener("touchstart", function (e) {
    e.preventDefault();
    cb.classList.add("armed");
  }, { passive: false });
  cb.addEventListener("touchend", function (e) {
    e.preventDefault();
    _vrStop(true);
  });
  cb.addEventListener("mouseenter", function () { cb.classList.add("armed"); });
  cb.addEventListener("mouseleave", function () { cb.classList.remove("armed"); });
  cb.addEventListener("click", function (e) {
    e.preventDefault();
    _vrStop(true);
  });
})();

// ---- Voice player (delegated) ----
document.addEventListener("click", function (e) {
  var playBtn = e.target.closest(".cv-play");
  if (!playBtn) return;
  e.preventDefault();
  e.stopPropagation();
  var wrap = playBtn.closest(".chat-voice");
  if (!wrap) return;
  var src = wrap.dataset.src;
  if (!src) return;
  var isPlaying = wrap.classList.contains("playing");

  // Stop any other playing voice
  document.querySelectorAll(".chat-voice.playing").forEach(function (v) {
    if (v !== wrap) {
      v.classList.remove("playing");
      var b = v.querySelector(".cv-play i");
      if (b) b.className = "fa-solid fa-play";
      if (v._audio) { try { v._audio.pause(); } catch (err) {} }
    }
  });

  if (!wrap._audio) {
    wrap._audio = new Audio(src);
    // Player-side boost: use Web Audio to amplify beyond 100%
    try {
      var AC2 = window.AudioContext || window.webkitAudioContext;
      if (AC2) {
        if (!window._vrPlayCtx) window._vrPlayCtx = new AC2();
        var pctx = window._vrPlayCtx;
        if (pctx.state === "suspended") { try { pctx.resume(); } catch (e) {} }
        var psrc = pctx.createMediaElementSource(wrap._audio);
        var pgain = pctx.createGain();
        var pcomp = pctx.createDynamicsCompressor();
        pgain.gain.value = 2.2;
        pcomp.threshold.value = -12;
        pcomp.knee.value = 10;
        pcomp.ratio.value = 4;
        pcomp.attack.value = 0.003;
        pcomp.release.value = 0.25;
        psrc.connect(pgain);
        pgain.connect(pcomp);
        pcomp.connect(pctx.destination);
        wrap._audio._pctx = pctx;
        wrap._audio._psrc = psrc;
      }
    } catch (gErr) {
      console.warn("[PLAY] gain boost failed:", gErr);
    }
    wrap._audio.addEventListener("ended", function () {
      wrap.classList.remove("playing");
      var bi = wrap.querySelector(".cv-play i");
      if (bi) bi.className = "fa-solid fa-play";
    });
    wrap._audio.addEventListener("timeupdate", function () {
      if (!wrap._audio.duration) return;
      var pct = (wrap._audio.currentTime / wrap._audio.duration) * 100;
      wrap.style.setProperty("--cv-progress", pct + "%");
    });
  }

  if (isPlaying) {
    try { wrap._audio.pause(); } catch (err) {}
    wrap.classList.remove("playing");
    var i2 = wrap.querySelector(".cv-play i");
    if (i2) i2.className = "fa-solid fa-play";
  } else {
    try {
      wrap._audio.currentTime = 0;
      wrap._audio.play();
      wrap.classList.add("playing");
      var i3 = wrap.querySelector(".cv-play i");
      if (i3) i3.className = "fa-solid fa-pause";
    } catch (err) {
      showToast("বাজানো যায়নি");
    }
  }
}, true);


// ═══════════════════════════════════════════════
// Series 3B — Chat Theme / Nickname / Wallpaper
// ═══════════════════════════════════════════════

var CHAT_THEMES = {
  default:   { label: "Coral",     out: "linear-gradient(135deg, #F05555 0%, #E14B4B 100%)", in: "#ffffff", bg: "#FDF6F3", dot: "rgba(255,107,107,0.09)", swatch: "linear-gradient(135deg, #FF6B6B, #F43F5E)" },
  emerald:   { label: "Emerald",   out: "linear-gradient(135deg, #10B981 0%, #059669 100%)", in: "#ffffff", bg: "#F0FDF4", dot: "rgba(16,185,129,0.10)", swatch: "linear-gradient(135deg, #10B981, #047857)" },
  ocean:     { label: "Ocean",     out: "linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%)", in: "#ffffff", bg: "#F0F9FF", dot: "rgba(14,165,233,0.10)", swatch: "linear-gradient(135deg, #0EA5E9, #0369A1)" },
  sunset:    { label: "Sunset",    out: "linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)", in: "#ffffff", bg: "#FFFBEB", dot: "rgba(245,158,11,0.10)", swatch: "linear-gradient(135deg, #F59E0B, #EA580C)" },
  royal:     { label: "Royal",     out: "linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)", in: "#ffffff", bg: "#F5F3FF", dot: "rgba(139,92,246,0.10)", swatch: "linear-gradient(135deg, #8B5CF6, #6D28D9)" },
  mono:      { label: "Mono",      out: "linear-gradient(135deg, #4B5563 0%, #1F2937 100%)", in: "#ffffff", bg: "#F9FAFB", dot: "rgba(75,85,99,0.10)",   swatch: "linear-gradient(135deg, #6B7280, #1F2937)" },
  instagram: { label: "Instagram", out: "linear-gradient(135deg, #833AB4 0%, #E1306C 50%, #F77737 100%)", in: "#ffffff", bg: "#FDF8FF", dot: "rgba(131,58,180,0.10)", swatch: "linear-gradient(135deg, #833AB4, #E1306C, #F77737)" },
  linear:    { label: "Linear",    out: "linear-gradient(135deg, #5E6AD2 0%, #4F46E5 100%)", in: "#ffffff", bg: "#F5F6FA", dot: "rgba(94,106,210,0.10)", swatch: "linear-gradient(135deg, #5E6AD2, #4F46E5)" },
  notion:    { label: "Notion",    out: "linear-gradient(135deg, #4F4A47 0%, #2F2B28 100%)", in: "#ffffff", bg: "#FBF9F5", dot: "rgba(79,74,71,0.10)",   swatch: "linear-gradient(135deg, #6B645F, #2F2B28)" },
  teal:      { label: "Teal",      out: "linear-gradient(135deg, #14B8A6 0%, #0D9488 100%)", in: "#ffffff", bg: "#F0FDFA", dot: "rgba(20,184,166,0.10)", swatch: "linear-gradient(135deg, #14B8A6, #0D9488)" },
  vercel:    { label: "Vercel",    out: "linear-gradient(135deg, #262626 0%, #000000 100%)", in: "#ffffff", bg: "#FAFAFA", dot: "rgba(0,0,0,0.08)",     swatch: "linear-gradient(135deg, #333333, #000000)" }
};

function _applyChatTheme(themeKey) {
  var cw = document.getElementById("chat-window");
  if (!cw) return;
  var t = CHAT_THEMES[themeKey] || CHAT_THEMES.default;
  cw.style.setProperty("--chat-out-bg", t.out);
  cw.style.setProperty("--chat-in-bg", t.in);
  cw.style.setProperty("--chat-bg", t.bg);
  cw.style.setProperty("--chat-dot", t.dot);
  cw.setAttribute("data-chat-theme", themeKey || "default");
}

function _applyWallpaper(wp) {
  var cw = document.getElementById("chat-window");
  if (!cw) return;

  // Clear overrides
  cw.style.removeProperty("--chat-wallpaper-img");
  cw.style.removeProperty("--chat-wallpaper-size");
  cw.style.removeProperty("--chat-wallpaper-pos");
  cw.style.removeProperty("--chat-wallpaper-color");

  if (!wp || wp === "default") return;

  if (wp.indexOf("solid:") === 0) {
    cw.style.setProperty("--chat-wallpaper-color", wp.slice(6));
    cw.style.setProperty("--chat-wallpaper-img", "none");
    cw.style.setProperty("--chat-wallpaper-size", "auto");
    cw.style.setProperty("--chat-wallpaper-pos", "0 0");
  } else if (wp.indexOf("gradient:") === 0) {
    var parts = wp.slice(9).split("|");
    var a = parts[0] || "#FF6B6B";
    var b = parts[1] || "#F43F5E";
    cw.style.setProperty("--chat-wallpaper-img", "linear-gradient(135deg, " + a + ", " + b + ")");
    cw.style.setProperty("--chat-wallpaper-size", "cover");
    cw.style.setProperty("--chat-wallpaper-pos", "center");
  } else if (wp.indexOf("image:") === 0) {
    cw.style.setProperty("--chat-wallpaper-img", "url('" + wp.slice(6) + "')");
    cw.style.setProperty("--chat-wallpaper-size", "cover");
    cw.style.setProperty("--chat-wallpaper-pos", "center");
  }
}

function _applyChatPrefs(username) {
  if (!username) return;
  // S29.5 - read from cache (fetches once, reuses for ~chat lifetime)
  _getChatSettings(username).then(function (st) {
    if (!st) return;
    _applyChatTheme(st.theme || "default");
    _applyWallpaper(st.wallpaper || "default");
  });
}

function _openChatThemePicker(username) {
  var old = document.getElementById("chat-theme-modal");
  if (old) old.remove();

  var cw = document.getElementById("chat-window");
  var currentTheme = cw ? (cw.getAttribute("data-chat-theme") || "default") : "default";

  var html = "";
  var keys = Object.keys(CHAT_THEMES);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var t = CHAT_THEMES[k];
    var active = (k === currentTheme) ? " active" : "";
    html += '<button type="button" class="ctm-swatch' + active + '" data-theme="' + k + '">';
    html += '<span class="ctm-circle" style="background:' + t.swatch + '"></span>';
    html += '<span class="ctm-label">' + t.label + '</span>';
    html += '</button>';
  }

  var modal = document.createElement("div");
  modal.id = "chat-theme-modal";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML =
    '<div class="modal-content ctm-content">' +
      '<button class="close-btn" id="ctm-close" type="button">\u00d7</button>' +
      '<h3 class="ctm-title">\u099a\u09cd\u09af\u09be\u099f \u09a5\u09bf\u09ae</h3>' +
      '<p class="ctm-sub">\u09aa\u09cd\u09b0\u09a4\u09bf\u099f\u09bf \u099a\u09cd\u09af\u09be\u099f\u09c7\u09b0 \u099c\u09a8\u09cd\u09af \u0986\u09b2\u09be\u09a6\u09be \u09b0\u0999</p>' +
      '<div class="ctm-grid">' + html + '</div>' +
      '<div class="ctm-preview">' +
        '<div class="ctm-preview-row out"><div class="ctm-preview-bubble" id="ctm-prev-out">\u0986\u09ae\u09bf \u09ad\u09be\u09b2\u09cb \u0986\u099b\u09bf</div></div>' +
        '<div class="ctm-preview-row in"><div class="ctm-preview-bubble" id="ctm-prev-in">\u09a4\u09c1\u09ae\u09bf \u0995\u09c7\u09ae\u09a8 \u0986\u099b\u09cb?</div></div>' +
      '</div>' +
      '<div class="edit-actions" style="margin-top:16px">' +
        '<button class="btn-secondary" id="ctm-cancel">\u09ac\u09be\u09a4\u09bf\u09b2</button>' +
        '<button class="btn-primary" id="ctm-save" style="width:auto;padding:12px 28px"><i class="fa-solid fa-check"></i> \u09b8\u09c7\u09ad</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var selected = currentTheme;
  function updatePreview() {
    var t = CHAT_THEMES[selected] || CHAT_THEMES.default;
    var pOut = document.getElementById("ctm-prev-out");
    var pIn = document.getElementById("ctm-prev-in");
    if (pOut) { pOut.style.background = t.out; pOut.style.color = "#fff"; }
    if (pIn) { pIn.style.background = t.in; pIn.style.color = "#1A0F0E"; }
    var sws = modal.querySelectorAll(".ctm-swatch");
    for (var i = 0; i < sws.length; i++) {
      sws[i].classList.toggle("active", sws[i].dataset.theme === selected);
    }
  }
  var swatches = modal.querySelectorAll(".ctm-swatch");
  for (var i = 0; i < swatches.length; i++) {
    swatches[i].addEventListener("click", function () {
      selected = this.dataset.theme;
      updatePreview();
    });
  }
  function close() { modal.remove(); }
  document.getElementById("ctm-close").addEventListener("click", close);
  document.getElementById("ctm-cancel").addEventListener("click", close);
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  document.getElementById("ctm-save").addEventListener("click", async function () {
    try {
      var cur = await api("/api/chats/" + encodeURIComponent(username) + "/settings");
      await api("/api/chats/" + encodeURIComponent(username) + "/settings", {
        method: "POST",
        body: JSON.stringify({
          pinned: cur.pinned,
          muted: cur.muted,
          theme: selected,
          nickname: cur.nickname || "",
          wallpaper: cur.wallpaper || "default",
          nickname_public: cur.nickname_public || false
        })
      });
      _invalidateChatSettings(username);   // S29.5
      _applyChatTheme(selected);
      close();
      showToast("\u09a5\u09bf\u09ae \u09b8\u09c7\u09ad \u09b9\u09df\u09c7\u099b\u09c7");
    } catch (e) { alert(e.message); }
  });
  updatePreview();
}

async function _openNicknameModal(username) {
  var old = document.getElementById("chat-nickname-modal");
  if (old) old.remove();

  var cur = { nickname: "" };
  try { cur = await api("/api/chats/" + encodeURIComponent(username) + "/settings"); } catch (e) {}

  var modal = document.createElement("div");
  modal.id = "chat-nickname-modal";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML =
    '<div class="modal-content" style="max-width:420px">' +
      '<button class="close-btn" id="cnm-close" type="button">\u00d7</button>' +
      '<h3 style="margin-bottom:6px;font-size:19px">\ud83c\udff7\ufe0f \u09a8\u09bf\u0995\u09a8\u09c7\u09ae</h3>' +
      '<p class="settings-hint" style="margin-bottom:16px">' +
        '\u09b8\u09be\u09ae\u09a8\u09c7\u09b0 \u099c\u09a8\u0995\u09c7 \u0986\u09aa\u09a8\u09be\u09b0 \u09ae\u09a8\u09ae\u09a4\u09cb \u09a8\u09be\u09ae\u09c7 \u09a1\u09be\u0995\u09c1\u09a8\u0964 \u09a8\u09bf\u0995\u09a8\u09c7\u09ae \u09b8\u09c7\u099f \u0995\u09b0\u09b2\u09c7 \u099a\u09cd\u09af\u09be\u099f\u09c7 \u09a6\u09c1\u099c\u09a8\u0987 \u099c\u09be\u09a8\u09a4\u09c7 \u09aa\u09be\u09b0\u09ac\u09c7\u0964' +
      '</p>' +
      '<div class="cnm-box">' +
        '<div class="cnm-box-title">' +
          '<i class="fa-solid fa-user-friends"></i> \u09b8\u09be\u09ae\u09a8\u09c7\u09b0 \u099c\u09a8\u09c7\u09b0 \u09a8\u09bf\u0995\u09a8\u09c7\u09ae' +
        '</div>' +
        '<div class="input-group" style="margin-bottom:0;margin-top:8px">' +
          '<i class="fa-regular fa-id-badge input-icon"></i>' +
          '<input type="text" id="cnm-them" placeholder="\u09af\u09c7\u09ae\u09a8: Boss, \u09b8\u09c1\u09a8\u09cd\u09a6\u09b0\u09c0..." maxlength="40" value="' + escapeHtml(cur.nickname || "") + '">' +
        '</div>' +
      '</div>' +
      '<div class="edit-actions" style="margin-top:18px">' +
        '<button class="btn-secondary" id="cnm-clear">\u09b8\u09b0\u09be\u09a8</button>' +
        '<button class="btn-primary" id="cnm-save" style="width:auto;padding:12px 28px"><i class="fa-solid fa-check"></i> \u09b8\u09c7\u09ad</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var inpThem = document.getElementById("cnm-them");
  setTimeout(function () { if (inpThem) inpThem.focus(); }, 80);

  function close() { modal.remove(); }
  document.getElementById("cnm-close").addEventListener("click", close);
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  async function saveVal(val) {
    try {
      var st = await api("/api/chats/" + encodeURIComponent(username) + "/settings");
      await api("/api/chats/" + encodeURIComponent(username) + "/settings", {
        method: "POST",
        body: JSON.stringify({
          pinned: st.pinned,
          muted: st.muted,
          theme: st.theme || "default",
          nickname: val,
          my_nickname: st.my_nickname || "",
          wallpaper: st.wallpaper || "default",
          nickname_public: true
        })
      });
      _invalidateChatSettings(username);   // S29.5
      close();
      showToast(val ? "\u09a8\u09bf\u0995\u09a8\u09c7\u09ae \u09b8\u09c7\u09ad \u09b9\u09df\u09c7\u099b\u09c7" : "\u09a8\u09bf\u0995\u09a8\u09c7\u09ae \u09b8\u09b0\u09be\u09a8\u09cb \u09b9\u09df\u09c7\u099b\u09c7");
      await loadConversations();
      if (currentChatUser === username) await loadChatMessages(true);
    } catch (e) { alert(e.message); }
  }

  document.getElementById("cnm-save").addEventListener("click", function () {
    saveVal((inpThem.value || "").trim());
  });
  document.getElementById("cnm-clear").addEventListener("click", function () {
    inpThem.value = "";
    saveVal("");
  });
  inpThem.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); saveVal((inpThem.value || "").trim()); }
  });
}

function _openWallpaperPicker(username) {
  var old = document.getElementById("chat-wallpaper-modal");
  if (old) old.remove();

  var presets = [
    { id: "default", label: "\u09a1\u09bf\u09ab\u09b2\u09cd\u099f", bg: "#FDF6F3" },
    { id: "solid:#FFF7ED", label: "Cream", bg: "#FFF7ED" },
    { id: "solid:#F0F9FF", label: "Sky", bg: "#F0F9FF" },
    { id: "solid:#F0FDF4", label: "Mint", bg: "#F0FDF4" },
    { id: "solid:#FDF4FF", label: "Pink", bg: "#FDF4FF" },
    { id: "solid:#F9FAFB", label: "Gray", bg: "#F9FAFB" },
    { id: "gradient:#FFE4E6|#FECDD3", label: "Rose", bg: "linear-gradient(135deg, #FFE4E6, #FECDD3)" },
    { id: "gradient:#DBEAFE|#BFDBFE", label: "Blue", bg: "linear-gradient(135deg, #DBEAFE, #BFDBFE)" },
    { id: "gradient:#D1FAE5|#A7F3D0", label: "Emerald", bg: "linear-gradient(135deg, #D1FAE5, #A7F3D0)" },
    { id: "gradient:#FEF3C7|#FDE68A", label: "Amber", bg: "linear-gradient(135deg, #FEF3C7, #FDE68A)" },
    { id: "gradient:#EDE9FE|#DDD6FE", label: "Violet", bg: "linear-gradient(135deg, #EDE9FE, #DDD6FE)" },
    { id: "gradient:#CFFAFE|#A5F3FC", label: "Cyan", bg: "linear-gradient(135deg, #CFFAFE, #A5F3FC)" }
  ];

  var gridHtml = "";
  for (var i = 0; i < presets.length; i++) {
    var p = presets[i];
    gridHtml += '<button type="button" class="cwm-swatch" data-wp="' + p.id + '">';
    gridHtml += '<span class="cwm-circle" style="background:' + p.bg + '"></span>';
    gridHtml += '<span class="cwm-label">' + p.label + '</span>';
    gridHtml += '</button>';
  }

  var modal = document.createElement("div");
  modal.id = "chat-wallpaper-modal";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML =
    '<div class="modal-content ctm-content">' +
      '<button class="close-btn" id="cwm-close" type="button">\u00d7</button>' +
      '<h3 class="ctm-title">\u0993\u09df\u09be\u09b2\u09aa\u09c7\u09aa\u09be\u09b0</h3>' +
      '<p class="ctm-sub">\u099a\u09cd\u09af\u09be\u099f \u09ac\u09cd\u09af\u09be\u0995\u0997\u09cd\u09b0\u09be\u0989\u09a8\u09cd\u09a1</p>' +
      '<div class="cwm-grid">' + gridHtml + '</div>' +
      '<div class="edit-actions" style="margin-top:16px">' +
        '<button class="btn-secondary" id="cwm-cancel">\u09ac\u09be\u09a4\u09bf\u09b2</button>' +
        '<button class="btn-primary" id="cwm-save" style="width:auto;padding:12px 28px"><i class="fa-solid fa-check"></i> \u09b8\u09c7\u09ad</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var selected = "default";
  function mark() {
    var sws = modal.querySelectorAll(".cwm-swatch");
    for (var i = 0; i < sws.length; i++) {
      sws[i].classList.toggle("active", sws[i].dataset.wp === selected);
    }
  }
  var swatches = modal.querySelectorAll(".cwm-swatch");
  for (var i = 0; i < swatches.length; i++) {
    swatches[i].addEventListener("click", function () {
      selected = this.dataset.wp;
      mark();
      _applyWallpaper(selected);
    });
  }
  function close() { modal.remove(); }
  document.getElementById("cwm-close").addEventListener("click", close);
  document.getElementById("cwm-cancel").addEventListener("click", function () {
    _applyChatPrefs(username); close();
  });
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  document.getElementById("cwm-save").addEventListener("click", async function () {
    try {
      var st = await api("/api/chats/" + encodeURIComponent(username) + "/settings");
      await api("/api/chats/" + encodeURIComponent(username) + "/settings", {
        method: "POST",
        body: JSON.stringify({
          pinned: st.pinned,
          muted: st.muted,
          theme: st.theme || "default",
          nickname: st.nickname || "",
          wallpaper: selected,
          nickname_public: st.nickname_public || false
        })
      });
      _invalidateChatSettings(username);   // S29.5
      close();
      showToast("\u0993\u09df\u09be\u09b2\u09aa\u09c7\u09aa\u09be\u09b0 \u09b8\u09c7\u09ad");
    } catch (e) { alert(e.message); }
  });
  mark();
}


// ═══════════════════════════════════════════════
// Series 3C — Edit message + delete options
// ═══════════════════════════════════════════════

function _openEditMessageModal(msgId, msgEl, currentText) {
  var old = document.getElementById("edit-msg-modal");
  if (old) old.remove();

  var modal = document.createElement("div");
  modal.id = "edit-msg-modal";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML =
    '<div class="modal-content" style="max-width:480px">' +
      '<button class="close-btn" id="emm-close" type="button">\u00d7</button>' +
      '<h3 style="margin-bottom:8px;font-size:19px">\u270f\ufe0f \u09ae\u09c7\u09b8\u09c7\u099c \u098f\u09a1\u09bf\u099f</h3>' +
      '<p class="settings-hint" style="margin-bottom:14px">\u09e7\u09eb \u09ae\u09bf\u09a8\u09bf\u099f\u09c7\u09b0 \u09ae\u09a7\u09cd\u09af\u09c7 \u098f\u09a1\u09bf\u099f \u0995\u09b0\u09be \u09af\u09be\u09ac\u09c7\u0964</p>' +
      '<textarea id="emm-input" class="edit-bio-input" maxlength="5000" style="min-height:100px">' + escapeHtml(currentText || "") + '</textarea>' +
      '<div class="edit-actions">' +
        '<button class="btn-secondary" id="emm-cancel">\u09ac\u09be\u09a4\u09bf\u09b2</button>' +
        '<button class="btn-primary" id="emm-save" style="width:auto;padding:12px 28px"><i class="fa-solid fa-check"></i> \u09b8\u09c7\u09ad</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var ta = document.getElementById("emm-input");
  setTimeout(function () {
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }, 80);

  function close() { modal.remove(); }
  document.getElementById("emm-close").addEventListener("click", close);
  document.getElementById("emm-cancel").addEventListener("click", close);
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  document.getElementById("emm-save").addEventListener("click", async function () {
    var val = (ta.value || "").trim();
    if (!val) return showToast("\u0996\u09be\u09b2\u09bf \u09b9\u09ac\u09c7 \u09a8\u09be");
    try {
      var res = await api("/api/messages/" + msgId, {
        method: "PATCH",
        body: JSON.stringify({ content: val }),
      });
      if (msgEl) {
        var textEl = msgEl.querySelector(".chat-msg-text");
        if (textEl) textEl.textContent = res.content;
        if (!msgEl.querySelector(".chat-msg-edited")) {
          var em = document.createElement("span");
          em.className = "chat-msg-edited";
          em.textContent = "(\u09b8\u09ae\u09cd\u09aa\u09be\u09a6\u09bf\u09a4)";
          var timeEl = msgEl.querySelector(".chat-msg-time");
          if (timeEl) timeEl.parentNode.insertBefore(em, timeEl);
          else msgEl.appendChild(em);
        }
      }
      close();
      showToast("\u270f\ufe0f \u098f\u09a1\u09bf\u099f \u09b8\u09c7\u09ad \u09b9\u09df\u09c7\u099b\u09c7");
    } catch (e) { alert(e.message); }
  });

  ta.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      document.getElementById("emm-save").click();
    }
  });
}

function _openDeleteMessageSheet(msgId, msgEl, isMine) {
  var old = document.getElementById("del-msg-sheet");
  if (old) old.remove();

  var sheet = document.createElement("div");
  sheet.id = "del-msg-sheet";
  sheet.className = "chat-msg-menu-root";
  sheet.innerHTML =
    '<div class="cmm-backdrop"></div>' +
    '<div class="dms-panel">' +
      '<div class="cms-handle"></div>' +
      '<button class="dms-item" data-act="del-me">' +
        '<span class="dms-icon"><i class="fa-solid fa-eye-slash"></i></span>' +
        '<span class="dms-info"><b>\u0986\u09ae\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c1\u09a8</b>' +
        '<small>\u09b6\u09c1\u09a7\u09c1 \u0986\u09aa\u09a8\u09bf \u09a6\u09c7\u0996\u09ac\u09c7\u09a8 \u09a8\u09be</small></span>' +
      '</button>' +
      (isMine
        ? '<button class="dms-item dms-danger" data-act="del-all">' +
            '<span class="dms-icon"><i class="fa-regular fa-trash-can"></i></span>' +
            '<span class="dms-info"><b>\u09b8\u09ac\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c1\u09a8</b>' +
            '<small>\u09a6\u09c1\u099c\u09a8\u09c7\u09b0 \u0995\u09be\u099b \u09a5\u09c7\u0995\u09c7 \u09ae\u09c1\u099b\u09c7 \u09af\u09be\u09ac\u09c7</small></span>' +
          '</button>'
        : '') +
      '<button class="dms-item dms-cancel" data-act="cancel">\u09ac\u09be\u09a4\u09bf\u09b2</button>' +
    '</div>';
  document.body.appendChild(sheet);
  requestAnimationFrame(function () { sheet.classList.add("show"); });

  function close() {
    sheet.classList.remove("show");
    setTimeout(function () { sheet.remove(); }, 260);
  }
  sheet.querySelector(".cmm-backdrop").addEventListener("click", close);

  sheet.querySelectorAll(".dms-item").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var act = btn.dataset.act;
      if (act === "cancel") { close(); return; }
      close();
      try {
        if (act === "del-me") {
          await api("/api/messages/" + msgId + "/delete-for-me", { method: "POST" });
          if (msgEl) msgEl.remove();
          showToast("\u0986\u09ae\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09be \u09b9\u09df\u09c7\u099b\u09c7");
        } else if (act === "del-all") {
          await api("/api/messages/" + msgId + "/delete-for-everyone", { method: "POST" });
          await loadChatMessages(true);
          showToast("\u09b8\u09ac\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09be \u09b9\u09df\u09c7\u099b\u09c7");
        }
      } catch (e) { alert(e.message); }
    });
  });
}



// ═══════════════════════════════════════════════
// Series 4B — Chat header call buttons
// ═══════════════════════════════════════════════
(function () {
  if (window.__s4b_call_wire) return;
  window.__s4b_call_wire = true;

  document.addEventListener("click", function (e) {
    var callBtn = e.target.closest("#chat-call-btn");
    var videoBtn = e.target.closest("#chat-video-btn");
    if (!callBtn && !videoBtn) return;

    e.preventDefault();
    e.stopPropagation();

    var uname = (typeof currentChatUser !== "undefined") ? currentChatUser : null;
    if (!uname) {
      if (typeof showToast === "function") showToast("চ্যাট খুলুন আগে");
      return;
    }

    if (callBtn && typeof window.startVoiceCall === "function") {
      window.startVoiceCall(uname);
    } else if (videoBtn && typeof window.startVideoCall === "function") {
      window.startVideoCall(uname);
    } else {
      if (typeof showToast === "function") showToast("কল মডিউল লোড হচ্ছে...");
    }
  }, true);

  console.log("[S4B] call header wire ✅");
})();


// ═══════════════════════════════════════════════
// SERIES 4B — Call History Page
// ═══════════════════════════════════════════════
(function () {
  if (window.__s4b_call_history) return;
  window.__s4b_call_history = true;

  var _allCalls = [];
  var _callFilter = "all";

  function _t(txt) { return String(txt == null ? "" : txt); }
  function _esc(s) {
    return _t(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                 .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function _init(name) {
    return (_t(name).trim().charAt(0) || "?").toUpperCase();
  }

  function _timeShort(iso) {
    if (!iso) return "";
    try {
      if (typeof shortTime === "function") return shortTime(iso);
    } catch (e) {}
    var d = new Date(String(iso).replace(" ", "T") + "Z");
    return d.toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" });
  }

  function _statusIcon(c) {
    if (c.is_missed) return '<i class="fa-solid fa-phone-slash" style="color:#EF4444"></i>';
    if (c.outgoing) return '<i class="fa-solid fa-arrow-up-right-from-square" style="color:#10B981"></i>';
    return '<i class="fa-solid fa-arrow-down" style="color:#3B82F6"></i>';
  }

  function _statusLabel(c) {
    if (c.status === "missed") return "মিসড";
    if (c.status === "declined") return "ডিক্লাইন";
    if (c.outgoing) return "বহির্গামী";
    return "আগত";
  }

  function _renderList() {
    var list = document.getElementById("calls-list");
    if (!list) return;

    var filtered = _allCalls;
    if (_callFilter === "missed") {
      filtered = _allCalls.filter(function (c) { return c.is_missed; });
    } else if (_callFilter === "outgoing") {
      filtered = _allCalls.filter(function (c) { return c.outgoing; });
    } else if (_callFilter === "incoming") {
      filtered = _allCalls.filter(function (c) { return !c.outgoing; });
    }

    if (!filtered.length) {
      list.innerHTML =
        '<div class="explore-empty" style="padding:60px 20px">' +
          '<i class="fa-solid fa-phone" style="font-size:52px;opacity:0.3"></i>' +
          '<p>কোনো কল নেই</p>' +
        '</div>';
      return;
    }

    list.innerHTML = filtered.map(function (c) {
      var isOut = c.outgoing;
      var other = isOut ? c.callee : c.caller;
      var av = other.profile_pic
        ? '<img src="' + _esc(other.profile_pic) + '" alt="" loading="lazy" decoding="async">'
        : _init(other.display_name);

      var missCls = c.is_missed ? "missed" : "";

      return (
        '<div class="call-log-item" data-username="' + _esc(other.username) + '">' +
          '<div class="call-log-avatar">' + av + '</div>' +
          '<div class="call-log-info">' +
            '<div class="call-log-name ' + missCls + '">' +
              _esc(other.display_name) + ' ' +
              _statusIcon(c) + ' <small style="color:var(--muted);font-weight:600">' +
              _statusLabel(c) + '</small>' +
            '</div>' +
            '<div class="call-log-meta">' + _timeShort(c.created_at) + ' · ' +
              (c.kind === "video" ? "ভিডিও" : "অডিও") +
            '</div>' +
          '</div>' +
          '<button type="button" class="call-log-btn" data-act="voice" data-username="' + _esc(other.username) + '" title="অডিও কল">' +
            '<i class="fa-solid fa-phone"></i>' +
          '</button>' +
          '<button type="button" class="call-log-btn" data-act="video" data-username="' + _esc(other.username) + '" title="ভিডিও কল" style="margin-left:6px">' +
            '<i class="fa-solid fa-video"></i>' +
          '</button>' +
        '</div>'
      );
    }).join("");

    // Wire call buttons
    list.querySelectorAll(".call-log-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var u = btn.dataset.username;
        var act = btn.dataset.act;
        if (!u) return;
        if (act === "video") {
          if (typeof window.startVideoCall === "function") window.startVideoCall(u);
          else alert("কল মডিউল লোড হয়নি");
        } else {
          if (typeof window.startVoiceCall === "function") window.startVoiceCall(u);
          else alert("কল মডিউল লোড হয়নি");
        }
      });
    });

    // Tap row → open profile
    list.querySelectorAll(".call-log-item").forEach(function (row) {
      row.addEventListener("click", function (e) {
        if (e.target.closest(".call-log-btn")) return;
        var u = row.dataset.username;
        if (u && typeof openProfile === "function") openProfile(u);
      });
    });
  }

  function _renderTabs() {
    var tabs = document.getElementById("call-tabs");
    if (!tabs) return;
    tabs.querySelectorAll(".call-tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.ctab === _callFilter);
    });
  }

  window._openCallHistoryPage = async function () {
    var page = document.getElementById("call-history-page");
    if (!page) return;
    page.classList.remove("hidden");
    _callFilter = "all";
    _renderTabs();

    var list = document.getElementById("calls-list");
    if (list) list.innerHTML = '<div class="explore-empty" style="padding:40px"><p>লোড হচ্ছে...</p></div>';

    try {
      var data = await api("/api/calls/history?limit=100");
      _allCalls = Array.isArray(data) ? data : [];
      _renderList();
    } catch (e) {
      if (list) list.innerHTML = '<div class="explore-empty"><p>লোড করা যায়নি: ' + _esc(e.message) + '</p></div>';
    }
  };

  window._closeCallHistoryPage = function () {
    var page = document.getElementById("call-history-page");
    if (page) page.classList.add("hidden");
  };

  // Wire buttons
  document.addEventListener("click", function (e) {
    var nav = e.target.closest('[data-nav="calls"]');
    if (nav) {
      e.preventDefault();
      if (typeof closeSidebar === "function") closeSidebar();
      window._openCallHistoryPage();
      return;
    }
    if (e.target.closest("#messages-call-btn")) {
      e.preventDefault();
      var mp = document.getElementById("messages-page");
      if (mp) mp.classList.add("hidden");
      window._openCallHistoryPage();
      return;
    }
    if (e.target.closest("#calls-back")) {
      e.preventDefault();
      window._closeCallHistoryPage();
      return;
    }
    if (e.target.closest("#calls-refresh")) {
      e.preventDefault();
      window._openCallHistoryPage();
      return;
    }
    var tab = e.target.closest(".call-tab");
    if (tab) {
      e.preventDefault();
      _callFilter = tab.dataset.ctab || "all";
      _renderTabs();
      _renderList();
    }
  }, true);

  console.log("[S4B] call history ready");
})();

// S22 / Series 27B-1 — Security Dashboard
async function _loadSecurityDashboard() {
  const container = document.getElementById("security-dashboard");
  if (!container) return;
  container.innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px">লোড হচ্ছে...</p>';
  try {
    const data = await api("/api/me/security-overview");
    container.innerHTML = _renderSecurityDashboard(data);
    _bindSecurityDashboardEvents();
  } catch (err) {
    container.innerHTML = '<p style="color:var(--danger);text-align:center;padding:20px">লোড করা যায়নি</p>';
  }
}

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
        <div class="sd-check-label">${escapeHtml(label)}</div>
        <div class="sd-check-hint">${escapeHtml(hint || "")}</div>
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
        <div class="sd-score-label" style="color:${color}">${escapeHtml(riskLabel)}</div>
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
  const has2FA = await api("/api/me/2fa/status")
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
      const res = await api("/api/me/recovery-code/regenerate", {
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
        ${escapeHtml(code)}
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
      if (typeof showToast === "function") showToast("📋 কপি হয়েছে");
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
    const st = await api("/api/me/email/status");
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
          <input type="text" id="r2f-username" placeholder="your_username" value="${escapeHtml(prefillUser)}">
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
      const res = await api("/api/auth/recover-2fa/request", {
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
      const res = await api("/api/auth/recover-2fa/verify", {
        method: "POST",
        body: JSON.stringify({ username: currentUser, email_code: code }),
      });
      close();
      if (typeof showToast === "function") {
        showToast("✅ " + (res.message || "2FA বন্ধ করা হয়েছে"));
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
        const st = await api("/api/me/2fa/status");
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
          await api("/api/me/2fa/email/disable", {
            method: "POST",
            body: JSON.stringify({ password }),
          });
          showToast("✅ Email 2FA বন্ধ হয়েছে");
        } else {
          const res = await api("/api/me/2fa/email/enable", {
            method: "POST",
            body: JSON.stringify({ password }),
          });
          showToast("✅ " + (res.message || "Email 2FA চালু হয়েছে"));
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
          await api("/api/me/2fa/disable", {
            method: "POST",
            body: JSON.stringify({ password: pw }),
          });
          showToast("✅ Authenticator 2FA বন্ধ হয়েছে");
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
    if (typeof showToast === "function") showToast("✅ Recovery Kit ডাউনলোড হয়েছে");
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
      const res = await api("/api/me/backup-email/set", {
        method: "POST",
        body: JSON.stringify({ email: em, password: pw }),
      });
      close();
      if (typeof showToast === "function") showToast("✅ " + (res.message || "Backup email সেভ হয়েছে"));
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

// ==================================================
// S29.10 - Unified page-closer (replaces 7-deep wrapper chain)
// ==================================================
// Previously _closeTopPage was redefined 7 times via
//   const _origCloseTopPageX = _closeTopPage;
//   _closeTopPage = function() { ... return _origCloseTopPageX(); };
// producing an 8-level call chain. Any missed wrap meant that page
// type could never be closed via back button. This unified version
// uses a single dispatch table so adding a new overlay is one line.
_closeTopPage = function _closeTopPageUnified() {
  // --- Step 1: if a chat conversation is open, close it first ---
  var cw = document.getElementById("chat-window");
  if (cw && !cw.classList.contains("hidden")) {
    try { if (typeof stopChatPolling === "function") stopChatPolling(); } catch (e) {}
    try { if (typeof _exitChatMultiSelect === "function") _exitChatMultiSelect(); } catch (e) {}
    try { if (typeof _closeChatSearch === "function") _closeChatSearch(); } catch (e) {}
    cw.classList.add("hidden");
    if (typeof currentChatUser !== "undefined") currentChatUser = null;
    if (typeof lastMsgCount !== "undefined") lastMsgCount = 0;
    if (typeof _PageStack !== "undefined" && _PageStack[_PageStack.length - 1] === "chat") {
      _PageStack.pop();
    }
    try { if (typeof loadConversations === "function") loadConversations(); } catch (e) {}
    try { if (typeof _updateOverlayClass === "function") _updateOverlayClass(); } catch (e) {}
    return true;
  }

  // --- Step 2: dispatch on stack top ---
  if (typeof _PageStack === "undefined" || !_PageStack.length) return false;
  var top = _PageStack[_PageStack.length - 1];

  var CLOSERS = {
    "profile": function () {
      var el = document.getElementById("profile-page");
      if (el) el.classList.add("hidden");
    },
    "messages": function () {
      try { if (typeof stopChatPolling === "function") stopChatPolling(); } catch (e) {}
      var el = document.getElementById("messages-page");
      if (el) el.classList.add("hidden");
    },
    "explore": function () {
      var el = document.getElementById("explore-page");
      if (el) el.classList.add("hidden");
    },
    "hashtag": function () {
      var el = document.getElementById("hashtag-page");
      if (el) el.classList.add("hidden");
    },
    "story-viewer": function () {
      try { if (typeof closeStoryViewer === "function") closeStoryViewer(); } catch (e) {}
    },
    "saved": function () {
      var el = document.getElementById("saved-page");
      if (el) el.classList.add("hidden");
    },
    "notifications": function () {
      var el = document.getElementById("notifications-page");
      if (el) el.classList.add("hidden");
    },
    "reels": function () {
      try { if (typeof closeReelsPage === "function") closeReelsPage(); } catch (e) {}
    },
    "settings": function () {
      var el = document.getElementById("settings-page");
      if (el) el.classList.add("hidden");
    },
    "search-page": function () {
      // S39 — close search page via exposed _close
      if (typeof window._closeSearchPage === "function") {
        window._closeSearchPage();
      } else {
        var el = document.getElementById("search-page");
        if (el) el.classList.add("hidden");
      }
    },
    "admin": function () {
      try { if (typeof closeAdminPage === "function") closeAdminPage(); } catch (e) {}
    },
    "chat": function () {
      // fallback when chat-window was already hidden
      try { if (typeof stopChatPolling === "function") stopChatPolling(); } catch (e) {}
      var el = document.getElementById("chat-window");
      if (el) el.classList.add("hidden");
      if (typeof currentChatUser !== "undefined") currentChatUser = null;
    }
  };

  var closer = CLOSERS[top];
  if (!closer) return false;

  _PageStack.pop();
  try { closer(); }
  catch (err) { console.error("[S29.10] closer failed for", top, err); }
  try { if (typeof _updateOverlayClass === "function") _updateOverlayClass(); } catch (e) {}
  return true;
};
console.log("[S29.10] unified _closeTopPage registered");


// ==================================================
// S32 — Post interactions via bottom sheets
// ==================================================
(function () {
  "use strict";
  if (window.__s32Sheets) return;
  window.__s32Sheets = true;

  function _closeAllSheets() {
    document.querySelectorAll(".sheet-root").forEach(function (el) {
      el.classList.remove("show");
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    });
    document.body.classList.remove("sheet-open");
    // also close old floating menus if present
    try { if (typeof closePostMenu === "function") closePostMenu(); } catch (e) {}
    try { if (typeof _closeRepostMenu === "function") _closeRepostMenu(); } catch (e) {}
  }

  // ---------- Comment Sheet ----------
  window._openCommentSheet = async function (postId) {
    if (!postId) return;
    _closeAllSheets();

    var sheet = document.createElement("div");
    sheet.id = "comment-sheet";
    sheet.className = "sheet-root";
    sheet.innerHTML =
      '<div class="sheet-backdrop"></div>' +
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header">' +
          '<h3>মন্তব্য</h3>' +
          '<button class="sheet-close" type="button" aria-label="close">' +
            '<i class="fa-solid fa-xmark"></i>' +
          '</button>' +
        '</div>' +
        '<div class="sheet-body" id="cs-body">' +
          '<p style="text-align:center;padding:30px 20px;color:var(--muted)">লোড হচ্ছে...</p>' +
        '</div>' +
        '<form class="sheet-form" id="cs-form">' +
          '<input type="text" id="cs-input" placeholder="মন্তব্য লিখুন..." maxlength="2000" autocomplete="off">' +
          '<button type="submit" class="sheet-send"><i class="fa-solid fa-paper-plane"></i></button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });

    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 260);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
    sheet.querySelector(".sheet-close").addEventListener("click", close);

    var body = sheet.querySelector("#cs-body");

    // S32.1 — use shared reload helper (keeps bindCommentEvents consistent)
    await _reloadSheetComments(postId);

    var form = sheet.querySelector("#cs-form");
    var input = sheet.querySelector("#cs-input");
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var text = (input.value || "").trim();
      if (!text) return;
      var sendBtn = form.querySelector(".sheet-send");
      sendBtn.disabled = true;
      try {
        await api("/api/posts/" + postId + "/comments", {
          method: "POST",
          body: JSON.stringify({ content: text }),
        });
        input.value = "";
        await _reloadSheetComments(postId);
        // update count on underlying post card
        var postEl = document.querySelector('.post[data-id="' + postId + '"]');
        if (postEl) {
          var cc = postEl.querySelector(".comment-btn .comment-count");
          if (cc) cc.textContent = parseInt(cc.textContent || "0", 10) + 1;
        }
      } catch (err) {
        alert(err.message || "মন্তব্য পাঠানো যায়নি");
      } finally {
        sendBtn.disabled = false;
        try { input.focus(); } catch (e) {}
      }
    });

    setTimeout(function () { try { input.focus(); } catch (e) {} }, 320);
  };

  // ---------- Post Menu Sheet ----------
  window._openPostMenuSheet = function (btn, postEl, postId) {
    if (!btn || !postId) return;
    _closeAllSheets();

    var isOwn = state.me && btn.dataset.owner === state.me.username;
    var isSaved = btn.dataset.saved === "1";
    var isReposted = btn.dataset.reposted === "1";

    var items = [];
    if (!isOwn) {
      items.push({ a: "repost", i: "fa-retweet", l: isReposted ? "রিপোস্ট সরান" : "রিপোস্ট" });
      items.push({ a: "quote", i: "fa-quote-right", l: "কোট পোস্ট" });
    }
    items.push({ a: "save", i: isSaved ? "fa-solid fa-bookmark" : "fa-regular fa-bookmark", l: isSaved ? "সেভ সরান" : "সেভ" });
    items.push({ a: "share", i: "fa-share-nodes", l: "শেয়ার" });
    items.push({ a: "copy", i: "fa-link", l: "লিংক কপি" });
    if (isOwn) {
      items.push({ a: "edit", i: "fa-pen", l: "এডিট" });
      items.push({ a: "delete", i: "fa-trash-can", l: "ডিলিট", d: true });
    } else {
      items.push({ a: "report", i: "fa-flag", l: "রিপোর্ট", d: true });
    }

    var sheet = document.createElement("div");
    sheet.id = "post-menu-sheet";
    sheet.className = "sheet-root";
    sheet.innerHTML =
      '<div class="sheet-backdrop"></div>' +
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-menu-list">' +
          items.map(function (it) {
            return '<button type="button" class="sheet-menu-item' + (it.d ? " danger" : "") + '" data-action="' + it.a + '">' +
              '<i class="fa-solid ' + it.i + '"></i>' +
              '<span>' + it.l + '</span>' +
            '</button>';
          }).join("") +
        '</div>' +
      '</div>';
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });

    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 260);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);

    sheet.querySelectorAll(".sheet-menu-item").forEach(function (b) {
      b.addEventListener("click", function () {
        var action = b.dataset.action;
        close();
        setTimeout(function () {
          try {
            if (typeof handlePostMenuAction === "function") {
              handlePostMenuAction(action, btn, postEl, postId);
            }
          } catch (e) { console.error("[S32] menu action failed:", e); }
        }, 60);
      });
    });
  };

  // ---------- Override: post content click → comment sheet ----------
  window.openPostDetail = function (postId) {
    if (typeof window._openCommentSheet === "function") {
      window._openCommentSheet(postId);
    }
  };

  // ---------- Override: 3-dot → menu sheet ----------
  window.openPostMenu = function (btn, postEl, postId) {
    if (typeof window._openPostMenuSheet === "function") {
      window._openPostMenuSheet(btn, postEl, postId);
    }
  };

  // ---------- Override: comment-btn (capture) → comment sheet ----------
  document.addEventListener("click", function (e) {
    var cb = e.target.closest(".comment-btn");
    if (!cb) return;
    // skip if inside sheet already
    if (e.target.closest(".sheet-root")) return;
    e.stopPropagation();
    e.preventDefault();
    var post = cb.closest(".post");
    if (post && post.dataset.id) {
      window._openCommentSheet(post.dataset.id);
    }
  }, true);

  // S32.6 — post content wrap + time click → comment sheet
  document.addEventListener("click", function (e) {
    if (e.target.closest(".sheet-root")) return;
    if (e.target.closest("button, a, input, textarea")) return;
    if (e.target.closest(".post-actions")) return;
    if (e.target.closest(".post-menu-btn")) return;
    if (e.target.closest(".post-header .avatar")) return;
    if (e.target.closest(".post-meta .name")) return;
    if (e.target.closest(".hashtag-link")) return;
    if (e.target.closest(".quoted-post")) return;

    var wrap = e.target.closest(".post-content-wrap");
    var time = e.target.closest(".post-meta .time");
    if (!wrap && !time) return;

    var post = e.target.closest(".post");
    if (!post || !post.dataset.id) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof window._openCommentSheet === "function") {
      window._openCommentSheet(post.dataset.id);
    }
  }, true);

  // ---------- Esc closes sheet ----------
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var any = document.querySelector(".sheet-root.show");
      if (any) {
        any.classList.remove("show");
        setTimeout(function () {
          if (any.parentNode) any.parentNode.removeChild(any);
          document.body.classList.remove("sheet-open");
        }, 260);
      }
    }
  });

  console.log("[S32] bottom-sheet interactions ready");
})();

// ==================================================
// S32.1 — Comment sheet helpers
// ==================================================
async function _reloadSheetComments(postId) {
  var body = document.getElementById("cs-body");
  if (!body || !postId) return;
  _cmtSerial = 0;   // S32.2 — reset serial for sheet render
  body.innerHTML = '<p style="text-align:center;padding:20px;color:var(--muted)">লোড হচ্ছে...</p>';
  try {
    var comments = await api("/api/posts/" + postId + "/comments");
    if (window._s323CacheComments) window._s323CacheComments(postId, comments);
    if (!comments || !comments.length) {
      body.innerHTML = '<p style="text-align:center;padding:36px 20px;color:var(--muted);font-size:14px">এখনো কোনো মন্তব্য নেই।<br>প্রথম মন্তব্য আপনিই করুন!</p>';
      return;
    }
    body.innerHTML = comments.map(function (c) { return commentHTML(c, postId); }).join("");
    try { bindCommentEvents(body, postId); } catch (e) { console.error("[S32.1]", e); }
  } catch (err) {
    body.innerHTML = '<p style="text-align:center;padding:20px;color:var(--danger)">লোড করা যায়নি</p>';
  }
}
window._reloadSheetComments = _reloadSheetComments;


// ==================================================
// S32.3 — Reply sheet (view all replies, flat + serial)
// ==================================================
(function () {
  "use strict";
  if (window.__s323ReplySheet) return;
  window.__s323ReplySheet = true;

  var _cachedComments = {};   // postId → comments array (for instant lookup)

  // cache comments whenever loaded
  var _origReload = window._reloadSheetComments;
  // expose cache setter for existing loaders
  window._s323CacheComments = function (postId, comments) {
    if (!postId || !Array.isArray(comments)) return;
    _cachedComments[postId] = comments;
  };

  // ---- find flat reply set for a parent comment id ----
  function _findParentAndReplies(postId, parentCid) {
    var all = _cachedComments[postId] || [];
    var parent = null;
    for (var i = 0; i < all.length; i++) {
      if (String(all[i].id) === String(parentCid)) { parent = all[i]; break; }
    }
    if (!parent) return null;
    var replies = parent.replies || [];
    return { parent: parent, replies: replies };
  }

  // ---- open reply sheet ----
  window._openRepliesSheet = async function (parentCid, postId) {
    var prev = document.querySelector(".sheet-root");
    if (prev) prev.remove();

    var sheet = document.createElement("div");
    sheet.id = "replies-sheet";
    sheet.className = "sheet-root";
    sheet.innerHTML =
      '<div class="sheet-backdrop"></div>' +
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header">' +
          '<h3>উত্তর</h3>' +
          '<button class="sheet-close" type="button">' +
            '<i class="fa-solid fa-xmark"></i>' +
          '</button>' +
        '</div>' +
        '<div class="sheet-body" id="rs-body">' +
          '<p style="text-align:center;padding:30px 20px;color:var(--muted)">লোড হচ্ছে...</p>' +
        '</div>' +
        '<form class="sheet-form" id="rs-form">' +
          '<input type="text" id="rs-input" placeholder="উত্তর লিখুন..." maxlength="2000" autocomplete="off">' +
          '<button type="submit" class="sheet-send"><i class="fa-solid fa-paper-plane"></i></button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });

    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 260);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
    sheet.querySelector(".sheet-close").addEventListener("click", close);

    var bodyEl = sheet.querySelector("#rs-body");
    var formEl = sheet.querySelector("#rs-form");
    var inputEl = sheet.querySelector("#rs-input");

    async function render() {
      // Fetch fresh comments
      var comments;
      try {
        comments = await api("/api/posts/" + postId + "/comments");
      } catch (err) {
        bodyEl.innerHTML = '<p style="text-align:center;padding:20px;color:var(--danger)">লোড করা যায়নি</p>';
        return;
      }
      _cachedComments[postId] = comments;

      var data = _findParentAndReplies(postId, parentCid);
      if (!data) {
        bodyEl.innerHTML = '<p style="text-align:center;padding:20px;color:var(--muted)">উত্তর খুঁজে পাওয়া যায়নি</p>';
        return;
      }

      // Parent comment index (1-based) in original list
      var parentIdx = comments.findIndex(function (c) { return String(c.id) === String(parentCid); });
      var parentSerial = parentIdx >= 0 ? parentIdx + 1 : 1;

      // Build flat list: parent + replies, serials continue
      _cmtSerial = parentSerial - 1;   // so next commentHTML gives parentSerial

      var parentHTML = commentHTML(data.parent, postId, false);
      var repliesHTML = (data.replies || []).map(function (r) {
        return commentHTML(r, postId, true);
      }).join("");

      bodyEl.innerHTML =
        '<div class="replies-thread flat">' +
          parentHTML +
          (repliesHTML ? '<div class="replies-flat-list">' + repliesHTML + '</div>' : '') +
        '</div>';

      try { bindCommentEvents(bodyEl, postId); } catch (e) {}

      // Prefill @mention in reply form (optional — user can delete)
      if (data.parent && data.parent.display_name) {
        var tag = "@" + data.parent.display_name + " ";
        inputEl.value = tag;
        setTimeout(function () {
          try { inputEl.focus(); } catch (e) {}
          try { inputEl.setSelectionRange(tag.length, tag.length); } catch (e) {}
        }, 200);
      }
    }

    formEl.addEventListener("submit", async function (e) {
      e.preventDefault();
      var text = (inputEl.value || "").trim();
      if (!text) return;
      var sendBtn = formEl.querySelector(".sheet-send");
      sendBtn.disabled = true;
      try {
        await api("/api/posts/" + postId + "/comments", {
          method: "POST",
          body: JSON.stringify({ content: text, parent_id: parseInt(parentCid) }),
        });
        inputEl.value = "@" + (window._rsParentName || "") + " ";
        await render();
        // refresh underlying comment sheet / post
        try { if (window._reloadSheetComments) await window._reloadSheetComments(postId); } catch (e) {}
      } catch (err) {
        alert(err.message || "উত্তর পাঠানো যায়নি");
      } finally {
        sendBtn.disabled = false;
      }
    });

    await render();
    // save parent name for post-send prefill
    var _p = _findParentAndReplies(postId, parentCid);
    if (_p && _p.parent) window._rsParentName = _p.parent.display_name || "";
  };

  // ---- click delegation for view-replies-btn ----
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".view-replies-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    var parentCid = btn.dataset.parent;
    var postId = btn.dataset.post;
    if (parentCid && postId) {
      window._openRepliesSheet(parentCid, postId);
    }
  }, true);

  console.log("[S32.3] reply sheet ready");
})();


// ==================================================
// S32.4 — mention click + comment name click
// ==================================================
(function () {
  "use strict";
  if (window.__s324Clicks) return;
  window.__s324Clicks = true;

  document.addEventListener("click", function (e) {
    // mention link
    var m = e.target.closest(".mention[data-mention]");
    if (m) {
      e.preventDefault();
      e.stopPropagation();
      var u = m.dataset.mention;
      if (u) {
        try {
          // close any open sheet first
          document.querySelectorAll(".sheet-root.show").forEach(function (s) {
            s.classList.remove("show");
            setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 220);
          });
          document.body.classList.remove("sheet-open");
        } catch (err) {}
        if (typeof openProfile === "function") {
          setTimeout(function () { openProfile(u); }, 200);
        }
      }
      return;
    }

    // comment cname click
    var cn = e.target.closest(".cname[data-user]");
    if (cn) {
      e.preventDefault();
      e.stopPropagation();
      var uname = cn.dataset.user;
      if (uname) {
        try {
          document.querySelectorAll(".sheet-root.show").forEach(function (s) {
            s.classList.remove("show");
            setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 220);
          });
          document.body.classList.remove("sheet-open");
        } catch (err) {}
        if (typeof openProfile === "function") {
          setTimeout(function () { openProfile(uname); }, 200);
        }
      }
      return;
    }
  }, true);

  console.log("[S32.4] mention + name click ready");
})();


// ==================================================
// S32.5 — @mention autocomplete on any input/textarea
// ==================================================
(function () {
  "use strict";
  if (window.__s325Mention) return;
  window.__s325Mention = true;

  var _dd = null;
  var _activeInput = null;
  var _activeAtPos = -1;
  var _userCache = null;
  var _userCacheAt = 0;

  function _destroyDD() {
    if (_dd && _dd.parentNode) _dd.parentNode.removeChild(_dd);
    _dd = null;
    _activeAtPos = -1;
  }

  async function _getUsers() {
    var now = Date.now();
    if (_userCache && (now - _userCacheAt) < 60000) return _userCache;
    try {
      var list = await api("/api/users?q=");
      _userCache = Array.isArray(list) ? list : [];
      _userCacheAt = now;
      return _userCache;
    } catch (e) {
      return [];
    }
  }

  function _posOfCaret(el) {
    var pos;
    if (el.selectionStart != null) pos = el.selectionStart;
    else pos = (el.value || "").length;
    return pos;
  }

  function _currentMentionQuery(el) {
    // find last @ before caret that has no whitespace in between
    var val = el.value || "";
    var caret = _posOfCaret(el);
    var before = val.slice(0, caret);
    var at = before.lastIndexOf("@");
    if (at === -1) return null;
    // char before @ must be start or whitespace
    if (at > 0) {
      var prev = before.charAt(at - 1);
      if (!/\s|\(|\[/.test(prev)) return null;
    }
    var frag = before.slice(at + 1);
    // must not contain whitespace after @
    if (/\s/.test(frag)) return null;
    // length limit
    if (frag.length > 30) return null;
    return { at: at, query: frag.toLowerCase() };
  }

  function _posOfInput(el) {
    // approximate caret pos on screen
    var rect = el.getBoundingClientRect();
    return { left: rect.left, top: rect.bottom + 4, width: rect.width };
  }

  async function _showMentions(el, query) {
    var users = await _getUsers();
    // filter
    var q = (query || "").toLowerCase();
    var filtered = users.filter(function (u) {
      if (!u || !u.username) return false;
      var uname = (u.username || "").toLowerCase();
      var dname = (u.display_name || "").toLowerCase();
      if (!q) return true;
      return uname.indexOf(q) === 0 || dname.indexOf(q) === 0;
    }).slice(0, 8);

    _destroyDD();
    if (!filtered.length) return;

    _activeInput = el;

    _dd = document.createElement("div");
    _dd.className = "mention-dropdown";
    _dd.innerHTML = filtered.map(function (u, i) {
      var av = u.profile_pic
        ? '<img src="' + escapeHtml(u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
        : (u.display_name || u.username || "?").charAt(0).toUpperCase();
      return '<div class="mention-item' + (i === 0 ? " active" : "") + '" data-username="' + escapeHtml(u.username) + '">' +
        '<div class="mention-item-avatar">' + av + '</div>' +
        '<div class="mention-item-info">' +
          '<div class="mention-item-name">' + escapeHtml(u.display_name || u.username) + '</div>' +
          '<div class="mention-item-username">@' + escapeHtml(u.username) + '</div>' +
        '</div>' +
      '</div>';
    }).join("");
    document.body.appendChild(_dd);

    // S32.6 — prevent click-outside from firing during scroll/touch inside dropdown
    _dd.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    _dd.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });
    _dd.addEventListener("touchmove", function (e) { e.stopPropagation(); }, { passive: true });

    // position
    var pos = _posOfInput(el);
    var ddRect = _dd.getBoundingClientRect();
    var left = pos.left;
    if (left + ddRect.width > window.innerWidth - 10) {
      left = window.innerWidth - ddRect.width - 10;
    }
    if (left < 10) left = 10;
    var top = pos.top;
    if (top + ddRect.height > window.innerHeight - 10) {
      top = pos.top - ddRect.height - el.offsetHeight - 8;
    }
    _dd.style.left = left + "px";
    _dd.style.top = top + "px";

    // click handling
    _dd.querySelectorAll(".mention-item").forEach(function (it) {
      it.addEventListener("mousedown", function (e) {
        e.preventDefault();
        _insertMention(el, it.dataset.username);
      });
      it.addEventListener("touchstart", function (e) {
        e.preventDefault();
        _insertMention(el, it.dataset.username);
      }, { passive: false });
    });
  }

  function _insertMention(el, username) {
    if (!el || !username) return;
    var info = _currentMentionQuery(el);
    if (!info) { _destroyDD(); return; }
    var val = el.value || "";
    var caret = _posOfCaret(el);
    var before = val.slice(0, info.at);
    var after = val.slice(caret);
    var insert = "@" + username + " ";
    el.value = before + insert + after;
    var newPos = info.at + insert.length;
    try { el.selectionStart = el.selectionEnd = newPos; } catch (e) {}
    _destroyDD();
    try { el.focus(); } catch (e) {}
    // trigger input event so state updates (post btn etc)
    try {
      var ev = new Event("input", { bubbles: true });
      el.dispatchEvent(ev);
    } catch (e) {}
  }

  // ---- Event binding ----
  function _isMentionable(el) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      var t = (el.type || "").toLowerCase();
      return t === "text" || t === "search" || t === "";
    }
    return false;
  }

  document.addEventListener("input", function (e) {
    var el = e.target;
    if (!_isMentionable(el)) return;
    var info = _currentMentionQuery(el);
    if (info === null) { _destroyDD(); return; }
    _showMentions(el, info.query);
  }, true);

  document.addEventListener("keydown", function (e) {
    if (!_dd) return;
    if (e.key === "Escape") {
      _destroyDD();
      e.stopPropagation();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      var items = _dd.querySelectorAll(".mention-item");
      if (!items.length) return;
      var cur = Array.prototype.indexOf.call(items, _dd.querySelector(".mention-item.active"));
      var next = e.key === "ArrowDown" ? (cur + 1) : (cur - 1);
      if (next < 0) next = items.length - 1;
      if (next >= items.length) next = 0;
      items.forEach(function (it, i) { it.classList.toggle("active", i === next); });
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      var active = _dd.querySelector(".mention-item.active");
      if (active) {
        e.preventDefault();
        e.stopPropagation();
        _insertMention(_activeInput, active.dataset.username);
      }
    }
  }, true);

  document.addEventListener("click", function (e) {
    if (_dd && !e.target.closest(".mention-dropdown")) _destroyDD();
  }, true);

  document.addEventListener("focusout", function (e) {
    if (e.target === _activeInput) {
      // S32.6 — delay longer so touch scroll doesn't kill it prematurely
      setTimeout(function () {
        // if user is touching dropdown, don't destroy
        if (_dd && _dd.matches(":active, :hover")) return;
        _destroyDD();
      }, 400);
    }
  }, true);

  console.log("[S32.5] mention autocomplete ready");
})();


// ==================================================
// S34 — Premium Search Behavior
// ==================================================
(function () {
  "use strict";
  if (window.__s34Search) return;
  window.__s34Search = true;

  function $id(x) { return document.getElementById(x); }

  function init() {
    var wrap  = $id("search-wrap");
    var pill  = $id("search-pill");
    var input = $id("search-input");
    var clearBtn = $id("search-clear");
    var icon = $id("search-icon");
    var results = $id("search-results");
    if (!wrap || !pill || !input || !results) return;
    if (input.dataset.s34Bound === "1") return;
    input.dataset.s34Bound = "1";

    // ---- Responsive readonly ----
    function applyMode() {
      // Desktop: editable inline search
      // Mobile: readonly trigger (tap opens full-page)
      if (window.innerWidth >= 900) {
        input.removeAttribute("readonly");
      } else {
        input.setAttribute("readonly", "readonly");
      }
    }
    applyMode();
    window.addEventListener("resize", applyMode);

    // ---- Block old "open full-page on focus" on desktop ----
    function blockOldDesktop(e) {
      if (window.innerWidth >= 900) {
        e.stopImmediatePropagation();
      }
    }
    input.addEventListener("focus", blockOldDesktop, true);
    input.addEventListener("click", blockOldDesktop, true);
    input.addEventListener("touchstart", blockOldDesktop, true);

    // ---- Clear button ----
    function refreshClear() {
      if (!clearBtn) return;
      if ((input.value || "").trim().length > 0) {
        clearBtn.classList.remove("hidden");
      } else {
        clearBtn.classList.add("hidden");
      }
    }
    refreshClear();

    input.addEventListener("input", refreshClear);

    if (clearBtn) {
      clearBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        input.value = "";
        refreshClear();
        results.classList.add("hidden");
        input.setAttribute("aria-expanded", "false");
        try { input.focus(); } catch (err) {}
      });
    }

    // ---- Icon click → focus ----
    if (icon) {
      icon.addEventListener("click", function () {
        try { input.focus(); } catch (e) {}
      });
      icon.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          try { input.focus(); } catch (err) {}
        }
      });
    }

    // ---- Ctrl+K / Cmd+K ----
    document.addEventListener("keydown", function (e) {
      var k = (e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "k") {
        // skip if user typing in another input/textarea
        var tag = (document.activeElement && document.activeElement.tagName) || "";
        if (tag === "TEXTAREA") return;
        e.preventDefault();
        if (window.innerWidth < 900) {
          // mobile: open full-page search
          var pageInput = $id("search-page-input");
          var page = $id("search-page");
          if (page && pageInput && page.classList.contains("hidden")) {
            page.classList.remove("hidden");
            setTimeout(function () { try { pageInput.focus(); } catch (err) {} }, 80);
          }
        } else {
          try { input.focus(); } catch (err) {}
        }
      }
      // Escape → close dropdown + blur
      if (e.key === "Escape" && document.activeElement === input) {
        input.blur();
        results.classList.add("hidden");
        input.setAttribute("aria-expanded", "false");
      }
    }, true);

    // ---- Enter → open full-page search with the query ----
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var q = (input.value || "").trim();
        if (!q) return;
        e.preventDefault();
        var page = $id("search-page");
        var pageInput = $id("search-page-input");
        if (page && pageInput) {
          page.classList.remove("hidden");
          pageInput.value = q;
          try {
            pageInput.dispatchEvent(new Event("input", { bubbles: true }));
          } catch (err) {}
          setTimeout(function () { try { pageInput.focus(); } catch (err) {} }, 60);
        }
        results.classList.add("hidden");
        input.setAttribute("aria-expanded", "false");
      }
    });

    // ---- aria-expanded sync ----
    var mo = null;
    try {
      mo = new MutationObserver(function () {
        var open = !results.classList.contains("hidden");
        input.setAttribute("aria-expanded", open ? "true" : "false");
      });
      mo.observe(results, { attributes: true, attributeFilter: ["class"] });
    } catch (e) {}

    // ---- Keyboard navigation (↑ ↓ Enter) inside dropdown ----
    input.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      if (results.classList.contains("hidden")) return;
      var items = results.querySelectorAll(
        ".search-body .search-result, .search-body .search-hashtag-item, .search-body .search-post-item"
      );
      if (!items.length) return;

      var cur = Array.prototype.indexOf.call(
        items,
        results.querySelector(".search-body .s34-active")
      );

      if (e.key === "ArrowDown") {
        e.preventDefault();
        var n1 = cur < 0 ? 0 : (cur + 1) % items.length;
        items.forEach(function (it, i) { it.classList.toggle("s34-active", i === n1); });
        items[n1].scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        var n2 = cur < 0 ? items.length - 1 : (cur - 1 + items.length) % items.length;
        items.forEach(function (it, i) { it.classList.toggle("s34-active", i === n2); });
        items[n2].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        var active = results.querySelector(".search-body .s34-active");
        if (active) {
          e.preventDefault();
          active.click();
          results.classList.add("hidden");
        }
      }
    });

    // ---- Click outside → close ----
    document.addEventListener("click", function (e) {
      if (!e.target.closest("#search-wrap")) {
        results.classList.add("hidden");
        input.setAttribute("aria-expanded", "false");
      }
    });

    console.log("[S34] premium search ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();


// ==================================================
// S36 — Reel button click → open reel upload modal
// ==================================================
(function () {
  "use strict";
  if (window.__s36ReelBtn) return;
  window.__s36ReelBtn = true;

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("#btn-pick-reel");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    // Preferred: open reel upload modal (existing flow in app.js)
    if (typeof window.openReelUpload === "function") {
      try { window.openReelUpload(); return; } catch (err) {}
    }

    // Fallback A: click the hidden modal's internal button if present
    var insideBtn = document.getElementById("btn-choose-reel");
    var modal = document.getElementById("reel-upload-modal");
    if (modal) {
      modal.classList.remove("hidden");
      // reset state if helper exists
      if (typeof window.resetReelUpload === "function") {
        try { window.resetReelUpload(); } catch (err) {}
      }
      return;
    }

    // Fallback B: open reels page
    if (typeof window.openReelsPage === "function") {
      try { window.openReelsPage(); } catch (err) {}
    }
  }, true);

  console.log("[S36] reel button wired");
})();


// ==================================================
// Batch 1 — Profile buttons 1-10
// ==================================================
(function () {
  "use strict";
  if (window.__batch1Profile) return;
  window.__batch1Profile = true;

  // S39 — Close button (#profile-close-btn) removed from HTML.
  // Its behavior is now handled by the standard back button only.

  // ---- 3. Search in profile ----
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-search-btn")) return;
    e.preventDefault();
    var page = document.getElementById("search-page");
    var pageInput = document.getElementById("search-page-input");
    if (page && pageInput) {
      // S39 — push to page stack so back button works
      if (typeof _pushPage === "function") _pushPage("search-page");
      page.classList.remove("hidden");
      pageInput.value = "";
      setTimeout(function () { try { pageInput.focus(); } catch (err) {} }, 60);
    }
  }, true);

  // ---- 4. Profile menu (⋮) ----
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var isMe = window.state && state.me && state.me.username === data.user.username;

    // sheet-style menu
    var old = document.getElementById("profile-menu-sheet");
    if (old) old.remove();
    var sheet = document.createElement("div");
    sheet.id = "profile-menu-sheet";
    sheet.className = "sheet-root";
    var items = isMe ? [
      { a: "edit",   i: "fa-pen",               l: "প্রোফাইল এডিট" },
      { a: "share",  i: "fa-share-nodes",        l: "শেয়ার" },
      { a: "copy",   i: "fa-link",               l: "লিংক কপি" },
      { a: "copy",   i: "fa-qrcode",             l: "QR কোড (আসছে)" },
      { a: "settings", i: "fa-gear",             l: "সেটিংস" },
    ] : [
      { a: "copy",   i: "fa-link",               l: "লিংক কপি" },
      { a: "share",  i: "fa-share-nodes",        l: "শেয়ার" },
      { a: "mute",   i: "fa-bell-slash",         l: "মিউট" },
      { a: "block",  i: "fa-ban",                l: "ব্লক",       d: true },
      { a: "report", i: "fa-flag",               l: "রিপোর্ট",    d: true },
    ];
    sheet.innerHTML =
      '<div class="sheet-backdrop"></div>' +
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-menu-list">' +
          items.map(function (it) {
            return '<button type="button" class="sheet-menu-item' + (it.d ? " danger" : "") + '" data-act="' + it.a + '">' +
              '<i class="fa-solid ' + it.i + '"></i><span>' + it.l + '</span></button>';
          }).join("") +
        '</div>' +
      '</div>';
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });
    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 240);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
    sheet.querySelectorAll(".sheet-menu-item").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.dataset.act;
        close();
        if (act === "edit") {
          if (typeof openEditProfile === "function") openEditProfile();
        } else if (act === "share") {
          var url = window.location.origin + "/u/" + data.user.username;
          if (navigator.share) navigator.share({ title: "JUKTOY", url: url }).catch(function(){});
          else navigator.clipboard.writeText(url).then(function(){ if (typeof showToast === "function") showToast("🔗 কপি হয়েছে"); });
        } else if (act === "copy") {
          var url2 = window.location.origin + "/u/" + data.user.username;
          navigator.clipboard.writeText(url2).then(function(){ if (typeof showToast === "function") showToast("🔗 লিংক কপি"); });
        } else if (act === "settings") {
          if (typeof openSettingsPage === "function") openSettingsPage();
        } else if (act === "mute") {
          if (typeof showToast === "function") showToast("🔔 মিউট (আসছে)");
        } else if (act === "block") {
          var bb = document.getElementById("btn-block");
          if (bb) bb.click();
        } else if (act === "report") {
          var rb = document.getElementById("btn-report-user");
          if (rb) rb.click();
        }
      });
    });
  }, true);

  // ---- 5. Refresh profile ----
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-refresh-btn")) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var icon = e.target.closest("#profile-refresh-btn").querySelector("i");
    if (icon) {
      icon.style.transition = "transform 0.6s ease";
      icon.style.transform = "rotate(360deg)";
      setTimeout(function(){ icon.style.transition = ""; icon.style.transform = ""; }, 650);
    }
    if (typeof openProfile === "function") openProfile(data.user.username);
  }, true);

  // ---- 8/9. Follow state machine for OTHER profiles ----
  // Wrap openProfile to alter follow button based on is_requested/follows_me
  var _origOpenProfileB1 = window.openProfile;
  if (typeof _origOpenProfileB1 === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB1(username);
      // after render, adjust the follow button
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && state.me && state.me.username === data.user.username;
      if (isMe) return;

      var fb = document.getElementById("btn-follow");
      if (!fb) return;
      var stateAttr = "follow";
      if (data.is_following) stateAttr = "following";
      else if (data.is_requested) stateAttr = "requested";
      else if (data.follows_me) stateAttr = "follow-back";
      fb.dataset.followState = stateAttr;

      // adjust label
      var labelEl = fb.querySelector("span");
      var iconEl = fb.querySelector("i");
      if (stateAttr === "following") {
        if (labelEl) labelEl.textContent = "ফলো করছেন";
        if (iconEl) iconEl.className = "fa-solid fa-user-check";
      } else if (stateAttr === "requested") {
        if (labelEl) labelEl.textContent = "রিকোয়েস্ট পাঠানো";
        if (iconEl) iconEl.className = "fa-solid fa-clock";
      } else if (stateAttr === "follow-back") {
        if (labelEl) labelEl.textContent = "ফলো ব্যাক";
        if (iconEl) iconEl.className = "fa-solid fa-user-plus";
      } else {
        if (labelEl) labelEl.textContent = "ফলো করুন";
        if (iconEl) iconEl.className = "fa-solid fa-user-plus";
      }
    };
  }

  // ---- 10. Follow-requests banner (own profile) ----
  var _origOpenProfileB1b = window.openProfile;
  if (typeof _origOpenProfileB1b === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB1b(username);
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && state.me && state.me.username === data.user.username;
      var banner = document.getElementById("profile-follow-requests");
      if (!banner) return;
      if (!isMe) { banner.classList.add("hidden"); return; }
      try {
        var r = await api("/api/me/follow-requests/count");
        var n = (r && r.count) || 0;
        if (n > 0) {
          document.getElementById("frb-count").textContent = n + " জন অপেক্ষা করছেন";
          banner.classList.remove("hidden");
        } else {
          banner.classList.add("hidden");
        }
      } catch (err) { banner.classList.add("hidden"); }
    };
  }

  // ---- Banner open button → follow requests sheet ----
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#frb-open-btn")) return;
    e.preventDefault();
    (async function () {
      try {
        var list = await api("/api/me/follow-requests");
        if (!Array.isArray(list) || !list.length) {
          if (typeof showToast === "function") showToast("কোনো অনুরোধ নেই");
          return;
        }
        var old = document.getElementById("fr-list-sheet");
        if (old) old.remove();
        var sheet = document.createElement("div");
        sheet.id = "fr-list-sheet";
        sheet.className = "sheet-root";
        sheet.innerHTML =
          '<div class="sheet-backdrop"></div>' +
          '<div class="sheet-panel">' +
            '<div class="sheet-handle"></div>' +
            '<div class="sheet-header"><h3>ফলো রিকোয়েস্ট</h3>' +
            '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="sheet-body">' +
              list.map(function (u) {
                var av = u.profile_pic
                  ? '<img src="' + (window.escapeHtml ? escapeHtml(u.profile_pic) : u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
                  : (u.display_name || u.username || "?").charAt(0).toUpperCase();
                return '<div class="fr-row" data-uid="' + u.user_id + '">' +
                  '<div class="fr-av">' + av + '</div>' +
                  '<div class="fr-info">' +
                    '<div class="fr-name">' + (window.escapeHtml ? escapeHtml(u.display_name) : u.display_name) + '</div>' +
                    '<div class="fr-uname">@' + (window.escapeHtml ? escapeHtml(u.username) : u.username) + '</div>' +
                  '</div>' +
                  '<button class="fr-accept" data-uid="' + u.user_id + '">গ্রহণ</button>' +
                  '<button class="fr-reject" data-uid="' + u.user_id + '"><i class="fa-solid fa-xmark"></i></button>' +
                '</div>';
              }).join("") +
            '</div>' +
          '</div>';
        document.body.appendChild(sheet);
        document.body.classList.add("sheet-open");
        requestAnimationFrame(function () { sheet.classList.add("show"); });
        function close() {
          sheet.classList.remove("show");
          setTimeout(function () {
            if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
            document.body.classList.remove("sheet-open");
          }, 240);
        }
        sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
        sheet.querySelector(".sheet-close").addEventListener("click", close);
        sheet.querySelectorAll(".fr-accept").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              await api("/api/me/follow-requests/" + b.dataset.uid + "/accept", { method: "POST" });
              b.closest(".fr-row").remove();
              if (typeof showToast === "function") showToast("✅ গ্রহণ করা হয়েছে");
            } catch (err) { alert(err.message || "সমস্যা"); b.disabled = false; }
          });
        });
        sheet.querySelectorAll(".fr-reject").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              await api("/api/me/follow-requests/" + b.dataset.uid + "/reject", { method: "POST" });
              b.closest(".fr-row").remove();
              if (typeof showToast === "function") showToast("বাতিল");
            } catch (err) { alert(err.message || "সমস্যা"); b.disabled = false; }
          });
        });
      } catch (err) { alert(err.message || "লোড করা যায়নি"); }
    })();
  }, true);

  // ---- styles for follow-request sheet rows ----
  if (!document.getElementById("b1-fr-styles")) {
    var st = document.createElement("style");
    st.id = "b1-fr-styles";
    st.textContent =
      '.fr-row{display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid rgba(0,0,0,.05)}' +
      '.fr-row:last-child{border-bottom:0}' +
      '.fr-av{width:40px;height:40px;border-radius:50%;background:var(--gradient);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;overflow:hidden;flex-shrink:0}' +
      '.fr-av img{width:100%;height:100%;object-fit:cover}' +
      '.fr-info{flex:1;min-width:0}' +
      '.fr-name{font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.fr-uname{font-size:12px;color:var(--muted)}' +
      '.fr-accept{padding:6px 14px;border-radius:8px;background:var(--accent);color:#fff;border:0;font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit}' +
      '.fr-reject{width:34px;height:34px;border-radius:50%;background:rgba(0,0,0,.05);border:0;color:var(--muted);font-size:13px;cursor:pointer;flex-shrink:0;margin-left:4px}' +
      'body.dark .fr-reject{background:rgba(255,255,255,.06)}';
    document.head.appendChild(st);
  }

  console.log("[Batch1] profile buttons 1-10 ready");
})();


// ==================================================
// Batch 2 — Profile buttons 11-20
// ==================================================
(function () {
  "use strict";
  if (window.__batch2Profile) return;
  window.__batch2Profile = true;

  function _sheet(html, id) {
    var old = document.getElementById(id);
    if (old) old.remove();
    var sheet = document.createElement("div");
    sheet.id = id;
    sheet.className = "sheet-root";
    sheet.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });
    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 240);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = sheet.querySelector(".sheet-close");
    if (x) x.addEventListener("click", close);
    return { root: sheet, close: close };
  }

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s || "").replace(/[<>&"']/g, function (c) {
      return { "<":"&lt;", ">":"&gt;", "&":"&amp;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }

  function _av(name, pic) {
    if (pic) return '<img src="' + _esc(pic) + '" alt="" loading="lazy" decoding="async">';
    return _esc((name || "?").charAt(0).toUpperCase());
  }

  // ============ 11. Reject follow request (already in batch 1 sheet) — ensure it exists ============
  // (batch 1 handles it)

  // ============ 12. Remove follower (own profile) ============
  document.addEventListener("click", function (e) {
    // Hook into existing followers-count stat click → opens list with remove buttons
    var statEls = document.querySelectorAll(".profile-stats .stat-item .stat-num");
    if (!statEls.length) return;
    if (!e.target.closest(".profile-stats")) return;
    var clicked = e.target.closest(".stat-item");
    if (!clicked) return;
    var idx = Array.prototype.indexOf.call(clicked.parentNode.children, clicked);
    if (idx !== 1) return; // only "followers"
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    if (!window.state || !state.me || state.me.username !== data.user.username) return;
    e.preventDefault();
    e.stopPropagation();
    (async function () {
      try {
        var list = await api("/api/users/" + encodeURIComponent(data.user.username) + "/followers");
        var s = _sheet(
          '<div class="sheet-panel">' +
            '<div class="sheet-handle"></div>' +
            '<div class="sheet-header"><h3>ফলোয়ার</h3>' +
            '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="sheet-body">' +
              (list.length
                ? list.map(function (u) {
                    return '<div class="b2-list-row">' +
                      '<div class="b2-list-av">' + _av(u.display_name, u.profile_pic) + '</div>' +
                      '<div class="b2-list-info">' +
                        '<div class="b2-list-name">' + _esc(u.display_name) + '</div>' +
                        '<div class="b2-list-uname">@' + _esc(u.username) + '</div>' +
                      '</div>' +
                      '<button class="b2-list-action danger" data-remove="' + _esc(u.username) + '">সরান</button>' +
                    '</div>';
                  }).join("")
                : '<p style="text-align:center;padding:30px;color:var(--muted)">কোনো ফলোয়ার নেই</p>') +
            '</div>' +
          '</div>', "b2-followers-sheet");
        s.root.querySelectorAll("[data-remove]").forEach(function (b) {
          b.addEventListener("click", async function () {
            if (!confirm("@" + b.dataset.remove + " কে ফলোয়ার থেকে সরাবেন?")) return;
            b.disabled = true;
            try {
              // find user_id
              var list2 = await api("/api/users/" + encodeURIComponent(b.dataset.remove));
              if (!list2 || !list2.user) throw new Error("ইউজার পাওয়া যায়নি");
              await api("/api/me/followers/" + list2.user.id + "/remove", { method: "POST" });
              b.closest(".b2-list-row").remove();
              if (typeof showToast === "function") showToast("✅ সরানো হয়েছে");
            } catch (err) { alert(err.message || "সমস্যা"); b.disabled = false; }
          });
        });
      } catch (err) { alert(err.message || "লোড করা যায়নি"); }
    })();
  }, true);

  // ============ 15/16. Close Friends & Favorites tiles ============
  function _openCfList(mode) {
    var url  = mode === "close" ? "/api/me/close-friends" : "/api/me/favorites";
    var flag = mode === "close" ? "is_close" : "is_favorite";
    var title = mode === "close" ? "Close Friends" : "Favorites";
    var toggleUrl = mode === "close" ? "/close-friend" : "/favorite";

    (async function () {
      try {
        var current = await api(url);
        var curNames = {};
        (current || []).forEach(function (u) { curNames[u.username] = true; });

        var all = await api("/api/me/following-list");
        var html = (all || []).map(function (u) {
          var isOn = !!u[flag];
          return '<div class="b2-list-row">' +
            '<div class="b2-list-av">' + _av(u.display_name, u.profile_pic) + '</div>' +
            '<div class="b2-list-info">' +
              '<div class="b2-list-name">' + _esc(u.display_name) + '</div>' +
              '<div class="b2-list-uname">@' + _esc(u.username) + '</div>' +
            '</div>' +
            '<button class="b2-list-action' + (isOn ? " on" : "") + '" data-toggle="' + _esc(u.username) + '" data-on="' + (isOn ? "1" : "0") + '">' +
              (isOn ? "✓ " + title : "যোগ") +
            '</button>' +
          '</div>';
        }).join("");

        var s = _sheet(
          '<div class="sheet-panel">' +
            '<div class="sheet-handle"></div>' +
            '<div class="sheet-header"><h3>' + title + '</h3>' +
            '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="sheet-body">' +
              (all && all.length
                ? html
                : '<p style="text-align:center;padding:30px;color:var(--muted)">আপনি এখনো কাউকে ফলো করেননি</p>') +
            '</div>' +
          '</div>', "b2-cf-sheet");

        s.root.querySelectorAll("[data-toggle]").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              var r = await api("/api/users/" + encodeURIComponent(b.dataset.toggle) + toggleUrl, { method: "POST" });
              var on = mode === "close" ? r.is_close : r.is_favorite;
              b.classList.toggle("on", on);
              b.textContent = on ? "✓ " + title : "যোগ";
            } catch (err) { alert(err.message || "সমস্যা"); }
            finally { b.disabled = false; }
          });
        });
      } catch (err) { alert(err.message || "লোড করা যায়নি"); }
    })();
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("#cf-close-open")) {
      e.preventDefault(); _openCfList("close");
    } else if (e.target.closest("#cf-fav-open")) {
      e.preventDefault(); _openCfList("fav");
    }
  }, true);

  // show tiles + counts on own profile
  var _origOpenProfileB2 = window.openProfile;
  if (typeof _origOpenProfileB2 === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB2(username);
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && state.me && state.me.username === data.user.username;
      var row = document.getElementById("profile-cf-row");
      if (!row) return;
      if (!isMe) { row.classList.add("hidden"); return; }
      try {
        var c1 = await api("/api/me/close-friends");
        var c2 = await api("/api/me/favorites");
        document.getElementById("cf-close-count").textContent = (c1 || []).length;
        document.getElementById("cf-fav-count").textContent = (c2 || []).length;
        row.classList.remove("hidden");
      } catch (err) { row.classList.add("hidden"); }
    };
  }

  // ============ 17. Message icon in topbar ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-msg-btn")) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    // S39 — button is hidden on own profile (see openProfile), so this
    // only fires on others. Safety check kept just in case:
    if (window.state && state.me && state.me.username === data.user.username) {
      return;
    }
    // close profile, open chat
    var p = document.getElementById("profile-page");
    if (p) p.classList.add("hidden");
    setTimeout(function () {
      if (typeof openMessagesPage === "function") {
        openMessagesPage().then(function () {
          if (typeof openChat === "function") openChat(data.user.username);
        });
      }
    }, 150);
  }, true);

  // ============ 20. Voice + Video call buttons in profile-buttons ============
  // Patch the profile-buttons rendering so voice/video circle buttons appear next to message
  var _origOpenProfileB2b = window.openProfile;
  if (typeof _origOpenProfileB2b === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB2b(username);
      return;   // S39 — disabled: voice/video injection removed (handled by main openProfile)
      // eslint-disable-next-line no-unreachable
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && state.me && state.me.username === data.user.username;
      if (isMe) return;
      var btns = document.getElementById("profile-buttons");
      if (!btns) return;
      if (btns.dataset.b2Patched === "1") return;
      btns.dataset.b2Patched = "1";

      // add voice + video circles before block/report
      var voice = document.createElement("button");
      voice.className = "btn-call-circle";
      voice.id = "btn-profile-voice";
      voice.title = "Voice call";
      voice.innerHTML = '<i class="fa-solid fa-phone"></i>';

      var video = document.createElement("button");
      video.className = "btn-call-circle";
      video.id = "btn-profile-video";
      video.title = "Video call";
      video.innerHTML = '<i class="fa-solid fa-video"></i>';

      var msgBtn = btns.querySelector("#btn-msg");
      if (msgBtn) {
        msgBtn.parentNode.insertBefore(video, msgBtn.nextSibling);
        msgBtn.parentNode.insertBefore(voice, msgBtn.nextSibling);
      } else {
        btns.appendChild(voice);
        btns.appendChild(video);
      }

      voice.addEventListener("click", function () {
        if (typeof window.startVoiceCall === "function") {
          window.startVoiceCall(data.user.username);
        } else if (typeof showToast === "function") {
          showToast("📞 কল মডিউল লোড হচ্ছে...");
        }
      });
      video.addEventListener("click", function () {
        if (typeof window.startVideoCall === "function") {
          window.startVideoCall(data.user.username);
        } else if (typeof showToast === "function") {
          showToast("📹 কল মডিউল লোড হচ্ছে...");
        }
      });
    };
  }

  // ============ 18/19. Message request flow ============
  // Wrap sendMessage: if recipient isn't following us, use /request/send
  var _origOpenChatB2 = window.openChat;
  if (typeof _origOpenChatB2 === "function") {
    // We hook into chat send via document-level listener; safer approach:
    // add a small indicator when opening a chat with an unverified user
    window.openChat = async function (username) {
      await _origOpenChatB2(username);
      // Show a subtle hint bar if the chat-input exists and receiver isn't a mutual
      var inp = document.getElementById("chat-input");
      if (!inp) return;
      // Fetch state to decide
      try {
        var p = await api("/api/users/" + encodeURIComponent(username));
        var theyFollowMe = !!(p && p.follows_me);
        var chatHeader = document.querySelector(".chat-header");
        var oldHint = document.getElementById("b2-msg-request-hint");
        if (oldHint) oldHint.remove();
        if (!theyFollowMe && chatHeader) {
          var hint = document.createElement("div");
          hint.id = "b2-msg-request-hint";
          hint.style.cssText =
            "padding:6px 12px;font-size:11.5px;font-weight:700;" +
            "background:linear-gradient(135deg,rgba(255,107,107,0.12),rgba(251,146,60,0.08));" +
            "color:var(--accent);text-align:center;border-bottom:1px solid var(--border-soft);";
          hint.textContent = "📨 এটা মেসেজ রিকোয়েস্ট — গ্রহণ করলে চ্যাট শুরু হবে";
          chatHeader.parentNode.insertBefore(hint, chatHeader.nextSibling);
        }
      } catch (e) {}
    };
  }

  // Accept message requests sheet (open from messages topbar / inbox)
  // Add a hint icon in the messages-topbar
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#b2-msg-requests-btn")) return;
    e.preventDefault();
    (async function () {
      try {
        var list = await api("/api/messages/requests");
        var s = _sheet(
          '<div class="sheet-panel">' +
            '<div class="sheet-handle"></div>' +
            '<div class="sheet-header"><h3>মেসেজ রিকোয়েস্ট</h3>' +
            '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="sheet-body">' +
              (list && list.length
                ? list.map(function (r) {
                    return '<div class="b2-list-row">' +
                      '<div class="b2-list-av">' + _av(r.display_name, r.profile_pic) + '</div>' +
                      '<div class="b2-list-info">' +
                        '<div class="b2-list-name">' + _esc(r.display_name) + '</div>' +
                        '<div class="b2-list-uname">@' + _esc(r.username) + ' · ' + _esc((r.content || "").slice(0, 40)) + '</div>' +
                      '</div>' +
                      '<button class="b2-list-action on" data-accept="' + r.id + '">গ্রহণ</button>' +
                      '<button class="b2-list-action danger" data-reject="' + r.id + '" style="margin-left:4px">বাতিল</button>' +
                    '</div>';
                  }).join("")
                : '<p style="text-align:center;padding:30px;color:var(--muted)">কোনো মেসেজ রিকোয়েস্ট নেই</p>') +
            '</div>' +
          '</div>', "b2-msg-requests-sheet");

        s.root.querySelectorAll("[data-accept]").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              await api("/api/messages/requests/" + b.dataset.accept + "/accept", { method: "POST" });
              b.closest(".b2-list-row").remove();
              if (typeof showToast === "function") showToast("✅ গ্রহণ করা হয়েছে");
            } catch (err) { alert(err.message || "সমস্যা"); b.disabled = false; }
          });
        });
        s.root.querySelectorAll("[data-reject]").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              await api("/api/messages/requests/" + b.dataset.reject + "/reject", { method: "POST" });
              b.closest(".b2-list-row").remove();
            } catch (err) { alert(err.message || "সমস্যা"); b.disabled = false; }
          });
        });
      } catch (err) { alert(err.message || "লোড করা যায়নি"); }
    })();
  }, true);

  console.log("[Batch2] profile buttons 11-20 ready");
})();


// ==================================================
// Batch 3 — Profile buttons 21-30
// ==================================================
(function () {
  "use strict";
  if (window.__batch3Profile) return;
  window.__batch3Profile = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s || "").replace(/[<>&"']/g, function (c) {
      return { "<":"&lt;", ">":"&gt;", "&":"&amp;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }

  function _sheet(html, id) {
    var old = document.getElementById(id);
    if (old) old.remove();
    var sheet = document.createElement("div");
    sheet.id = id;
    sheet.className = "sheet-root";
    sheet.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });
    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 240);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = sheet.querySelector(".sheet-close");
    if (x) x.addEventListener("click", close);
    return { root: sheet, close: close };
  }

  function _profileUrl(username) {
    return window.location.origin + "/u/" + encodeURIComponent(username);
  }

  // ============ 21-26. Share sheet with copy/native/whatsapp/telegram/email/dm ============
  function _openShareSheet(username, displayName) {
    var url = _profileUrl(username);
    var text = (displayName || username) + " — JUKTOY-এ দেখুন";

    var s = _sheet(
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>শেয়ার করুন</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:6px 12px 14px">' +
          _row("copy", "bg-copy", "fa-link", "লিংক কপি করুন", "clipboard") +
          _row("native", "bg-nat", "fa-share-nodes", "আরো অপশন", "native share") +
          _row("whatsapp", "bg-wa", "fa-brands fa-whatsapp", "WhatsApp", "chat app") +
          _row("telegram", "bg-tg", "fa-brands fa-telegram", "Telegram", "chat app") +
          _row("email", "bg-mail", "fa-envelope", "Email", "mailto link") +
          _row("dm", "bg-dm", "fa-comment-dots", "JUKTOY DM", "pick a friend") +
        '</div>' +
      '</div>', "b3-share-sheet");

    function _row(a, bg, icon, label, sub) {
      var ic = icon.indexOf("fa-brands") === 0 ? icon : ("fa-solid " + icon);
      return '<div class="b3-share-row" data-act="' + a + '">' +
        '<div class="b3-share-icon ' + bg + '"><i class="' + ic + '"></i></div>' +
        '<div class="b3-share-label">' + _esc(label) +
          '<div class="b3-share-sub">' + _esc(sub) + '</div></div>' +
      '</div>';
    }

    s.root.querySelectorAll(".b3-share-row").forEach(function (r) {
      r.addEventListener("click", async function () {
        var act = r.dataset.act;
        if (act === "copy") {
          try {
            await navigator.clipboard.writeText(url);
            if (typeof showToast === "function") showToast("🔗 লিংক কপি হয়েছে");
          } catch (e) { alert("কপি করা যায়নি"); }
          s.close();
        } else if (act === "native") {
          if (navigator.share) {
            try { await navigator.share({ title: "JUKTOY", text: text, url: url }); } catch (e) {}
          } else {
            try { await navigator.clipboard.writeText(url); if (typeof showToast === "function") showToast("🔗 কপি হয়েছে"); } catch (e) {}
          }
          s.close();
        } else if (act === "whatsapp") {
          window.open("https://wa.me/?text=" + encodeURIComponent(text + " " + url), "_blank");
          s.close();
        } else if (act === "telegram") {
          window.open("https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(text), "_blank");
          s.close();
        } else if (act === "email") {
          window.location.href = "mailto:?subject=" + encodeURIComponent("JUKTOY — " + displayName) + "&body=" + encodeURIComponent(text + "\n\n" + url);
          s.close();
        } else if (act === "dm") {
          s.close();
          _openShareDM(username, url);
        }
      });
    });
  }

  function _openShareDM(username, url) {
    var s = _sheet(
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>কে পাঠাবেন?</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:8px 12px">' +
          '<div class="input-group" style="margin-bottom:10px">' +
            '<i class="fa-solid fa-magnifying-glass input-icon"></i>' +
            '<input type="text" id="b3-dm-search" placeholder="ইউজারনেম লিখুন...">' +
          '</div>' +
          '<div id="b3-dm-list"><p style="text-align:center;padding:20px;color:var(--muted)">লোড হচ্ছে...</p></div>' +
        '</div>' +
      '</div>', "b3-dm-sheet");

    var listEl = s.root.querySelector("#b3-dm-list");
    var input = s.root.querySelector("#b3-dm-search");

    async function load(q) {
      try {
        var users = await api("/api/users?q=" + encodeURIComponent(q || ""));
        var filtered = (users || []).filter(function (u) { return u.username !== username; });
        if (!filtered.length) {
          listEl.innerHTML = '<p style="text-align:center;padding:20px;color:var(--muted)">কেউ পাওয়া যায়নি</p>';
          return;
        }
        listEl.innerHTML = filtered.map(function (u) {
          var av = u.profile_pic
            ? '<img src="' + _esc(u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
            : _esc((u.display_name || "?").charAt(0).toUpperCase());
          return '<div class="b3-share-row" data-to="' + _esc(u.username) + '">' +
            '<div class="b3-share-icon bg-dm" style="overflow:hidden">' + av + '</div>' +
            '<div class="b3-share-label">' + _esc(u.display_name) +
              '<div class="b3-share-sub">@' + _esc(u.username) + '</div></div>' +
          '</div>';
        }).join("");
        listEl.querySelectorAll("[data-to]").forEach(function (b) {
          b.addEventListener("click", async function () {
            var to = b.dataset.to;
            b.disabled = true;
            try {
              await api("/api/messages/" + encodeURIComponent(to), {
                method: "POST",
                body: JSON.stringify({ content: "🔗 প্রোফাইল দেখুন: " + url })
              });
              if (typeof showToast === "function") showToast("✅ পাঠানো হয়েছে");
              s.close();
            } catch (err) { alert(err.message || "পাঠানো যায়নি"); b.disabled = false; }
          });
        });
      } catch (err) {
        listEl.innerHTML = '<p style="text-align:center;padding:20px;color:var(--danger)">লোড করা যায়নি</p>';
      }
    }
    load("");
    var t = null;
    input.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () { load(input.value.trim()); }, 220);
    });
  }

  // Hook into profile share button to open new sheet (replace old native-only)
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#btn-share-profile")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    _openShareSheet(data.user.username, data.user.display_name);
  }, true);

  // Also hook the "⋮" menu Share to open new sheet
  document.addEventListener("click", function (e) {
    var it = e.target.closest(".sheet-menu-item[data-act='share']");
    if (!it) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    // close existing sheet
    var open = document.querySelector(".sheet-root.show");
    if (open) { open.classList.remove("show"); setTimeout(function(){ if (open.parentNode) open.parentNode.removeChild(open); document.body.classList.remove("sheet-open"); }, 200); }
    setTimeout(function () { _openShareSheet(data.user.username, data.user.display_name); }, 220);
  }, true);

  // ============ 27. QR code (own profile) ============
  // Simple SVG QR-like visualization (not scannable but visually authentic)
  function _miniQR(text) {
    // build a deterministic pseudo-QR from hash of text
    var h = 0;
    for (var i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    var size = 21; // 21x21 like v1 QR
    var cells = [];
    // finder patterns (3 corners)
    function isFinder(r, c) {
      // top-left 7x7
      if (r < 7 && c < 7) return (r === 0 || r === 6 || c === 0 || c === 6 ||
                                  (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      // top-right
      if (r < 7 && c >= size - 7) {
        var cc = c - (size - 7);
        return (r === 0 || r === 6 || cc === 0 || cc === 6 ||
                (r >= 2 && r <= 4 && cc >= 2 && cc <= 4));
      }
      // bottom-left
      if (r >= size - 7 && c < 7) {
        var rr = r - (size - 7);
        return (rr === 0 || rr === 6 || c === 0 || c === 6 ||
                (rr >= 2 && rr <= 4 && c >= 2 && c <= 4));
      }
      return null;
    }
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var finder = isFinder(r, c);
        var on;
        if (finder !== null) {
          on = finder;
        } else {
          var seed = (h ^ (r * 31 + c * 17)) & 0xFFFF;
          on = ((seed * 2654435761) & 0xFFFF) % 3 !== 0;
        }
        cells.push({ r: r, c: c, on: on });
      }
    }
    var px = 6; // each cell 6px
    var dim = size * px + 8; // padding
    var rects = cells.map(function (c) {
      if (!c.on) return "";
      return '<rect x="' + (c.c * px + 4) + '" y="' + (c.r * px + 4) +
             '" width="' + px + '" height="' + px + '" fill="#050505"/>';
    }).join("");
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + dim + '" height="' + dim +
           '" viewBox="0 0 ' + dim + ' ' + dim + '" style="background:#fff;border-radius:12px">' +
           rects + '</svg>';
  }

  document.addEventListener("click", function (e) {
    if (!e.target.closest("#qr-open-btn")) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var url = _profileUrl(data.user.username);
    var wrap = document.getElementById("qr-image-wrap");
    if (wrap) wrap.innerHTML = _miniQR(url);
    var nameEl = document.getElementById("qr-username");
    if (nameEl) nameEl.textContent = "@" + data.user.username;
    var modal = document.getElementById("qr-modal");
    if (modal) modal.classList.remove("hidden");
  }, true);

  document.addEventListener("click", function (e) {
    if (e.target.closest("#qr-close")) {
      var m = document.getElementById("qr-modal");
      if (m) m.classList.add("hidden");
    } else if (e.target.closest("#qr-copy")) {
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      navigator.clipboard.writeText(_profileUrl(data.user.username)).then(function () {
        if (typeof showToast === "function") showToast("🔗 লিংক কপি");
      });
    }
  }, true);

  // ============ 28. Wave (👋) ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#btn-profile-wave")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var btn = e.target.closest("#btn-profile-wave");
    btn.disabled = true;
    api("/api/users/" + encodeURIComponent(data.user.username) + "/wave", { method: "POST" })
      .then(function () {
        if (typeof showToast === "function") showToast("👋 Wave পাঠানো হয়েছে");
        // brief pulse animation
        btn.style.transform = "scale(1.2)";
        setTimeout(function(){ btn.style.transform = ""; }, 200);
      })
      .catch(function (err) { alert(err.message || "পাঠানো যায়নি"); })
      .finally(function () { btn.disabled = false; });
  }, true);

  // ============ 29. Save profile (bookmark) ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#btn-profile-save")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var btn = e.target.closest("#btn-profile-save");
    btn.disabled = true;
    api("/api/users/" + encodeURIComponent(data.user.username) + "/save-profile", { method: "POST" })
      .then(function (r) {
        btn.classList.toggle("on", !!r.saved);
        var icon = btn.querySelector("i");
        if (icon) icon.className = r.saved ? "fa-solid fa-bookmark" : "fa-regular fa-bookmark";
        if (typeof showToast === "function") showToast(r.saved ? "🔖 সেভ হয়েছে" : "সেভ সরানো হয়েছে");
      })
      .catch(function (err) { alert(err.message || "সমস্যা"); })
      .finally(function () { btn.disabled = false; });
  }, true);

  // ============ 30. Notify bell ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#btn-profile-notify")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var btn = e.target.closest("#btn-profile-notify");
    btn.disabled = true;
    api("/api/users/" + encodeURIComponent(data.user.username) + "/notify", { method: "POST" })
      .then(function (r) {
        btn.classList.toggle("on", !!r.notify);
        var icon = btn.querySelector("i");
        if (icon) icon.className = r.notify ? "fa-solid fa-bell" : "fa-regular fa-bell";
        if (typeof showToast === "function") showToast(r.notify ? "🔔 নোটিফিকেশন চালু" : "🔕 বন্ধ করা হয়েছে");
      })
      .catch(function (err) { alert(err.message || "সমস্যা"); })
      .finally(function () { btn.disabled = false; });
  }, true);

  // ============ Attach new buttons to profile-buttons on open ============
  var _origOpenProfileB3 = window.openProfile;
  if (typeof _origOpenProfileB3 === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB3(username);
      return;   // S39 — disabled: wave/save/bell injection removed (handled by main openProfile)
      // eslint-disable-next-line no-unreachable
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && state.me && state.me.username === data.user.username;
      var btns = document.getElementById("profile-buttons");
      if (!btns) return;
      if (btns.dataset.b3 === "1") return;
      btns.dataset.b3 = "1";

      if (isMe) {
        // own profile → add QR button
        var qrBtn = document.createElement("button");
        qrBtn.id = "qr-open-btn";
        qrBtn.className = "btn-icon-circle";
        qrBtn.title = "QR কোড";
        qrBtn.innerHTML = '<i class="fa-solid fa-qrcode"></i>';
        btns.appendChild(qrBtn);
      } else {
        // other's profile → add wave, save, notify
        var waveBtn = document.createElement("button");
        waveBtn.id = "btn-profile-wave";
        waveBtn.className = "btn-icon-circle";
        waveBtn.title = "Wave 👋";
        waveBtn.innerHTML = '<i class="fa-regular fa-hand"></i>';

        var saveBtn = document.createElement("button");
        saveBtn.id = "btn-profile-save";
        saveBtn.className = "btn-icon-circle";
        saveBtn.title = "Save profile";
        saveBtn.innerHTML = '<i class="fa-regular fa-bookmark"></i>';

        var bellBtn = document.createElement("button");
        bellBtn.id = "btn-profile-notify";
        bellBtn.className = "btn-icon-circle";
        bellBtn.title = "Notify on posts";
        bellBtn.innerHTML = '<i class="fa-regular fa-bell"></i>';

        // insert after message btn if present
        var msgBtn = btns.querySelector("#btn-msg");
        if (msgBtn) {
          msgBtn.parentNode.insertBefore(waveBtn, msgBtn.nextSibling);
          msgBtn.parentNode.insertBefore(saveBtn, waveBtn.nextSibling);
          msgBtn.parentNode.insertBefore(bellBtn, saveBtn.nextSibling);
        } else {
          btns.appendChild(waveBtn);
          btns.appendChild(saveBtn);
          btns.appendChild(bellBtn);
        }

        // load saved/notify status
        try {
          var st = await api("/api/me/save-background-check", {
            method: "POST",
            body: JSON.stringify({ username: data.user.username })
          });
          if (st.saved) {
            saveBtn.classList.add("on");
            saveBtn.querySelector("i").className = "fa-solid fa-bookmark";
          }
          if (st.notify) {
            bellBtn.classList.add("on");
            bellBtn.querySelector("i").className = "fa-solid fa-bell";
          }
        } catch (e) {}
      }
    };
  }

  console.log("[Batch3] profile buttons 21-30 ready");
})();


// ===== Batch 4 — Profile tabs + Share to Story + Embed =====
(function () {
  "use strict";
  if (window.__batch4) return;
  window.__batch4 = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function _hideAllPanes() {
    ["posts","reels","photos","tagged","liked","saved","about"].forEach(function (n) {
      var el = document.getElementById("profile-tab-" + n);
      if (el) el.classList.add("hidden");
    });
  }

  function _showPane(name) {
    var el = document.getElementById("profile-tab-" + name);
    if (el) el.classList.remove("hidden");
  }

  async function _renderReels(username) {
    var pane = document.getElementById("profile-tab-reels");
    if (!pane) return;
    pane.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await api("/api/users/" + encodeURIComponent(username) + "/reels-list");
      if (!list.length) {
        pane.innerHTML = '<div class="pf-reels-empty">🎬 এখনো কোনো রিল নেই</div>';
        return;
      }
      pane.innerHTML = '<div class="pf-reels-grid">' + list.map(function (r) {
        return '<div class="pf-reel-cell" data-id="' + r.id + '">' +
          '<video src="' + _esc(r.video) + '" muted playsinline preload="metadata"></video>' +
          '<div class="pf-reel-views"><i class="fa-solid fa-heart"></i>' + (r.likes||0) + '</div>' +
        '</div>';
      }).join("") + '</div>';
      pane.querySelectorAll(".pf-reel-cell").forEach(function (c) {
        c.addEventListener("click", function () {
          if (typeof openReelsPage === "function") openReelsPage();
        });
      });
    } catch (err) {
      pane.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>';
    }
  }

  async function _renderTagged(username) {
    var pane = document.getElementById("profile-tab-tagged");
    if (!pane) return;
    pane.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await api("/api/users/" + encodeURIComponent(username) + "/tagged-posts");
      if (!list.length) {
        pane.innerHTML = '<div class="pf-tagged-empty">📌 এখনো কেউ ট্যাগ করেনি</div>';
        return;
      }
      pane.innerHTML = list.map(function (p) {
        return '<div class="profile-post" data-post-id="' + p.id + '" data-user="' + _esc(p.username) + '">' +
          '<div class="pp-head" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
            '<strong style="font-size:13.5px">' + _esc(p.display_name) + '</strong>' +
            '<span style="color:var(--muted);font-size:12px">@' + _esc(p.username) + '</span>' +
          '</div>' +
          '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(p.content) : _esc(p.content)) + '</div>' +
          '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(p.created_at) : p.created_at) + '</div>' +
        '</div>';
      }).join("");
      if (window.attachHashtagListeners) attachHashtagListeners(pane);
    } catch (err) {
      pane.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>';
    }
  }

  async function _renderLiked() {
    var pane = document.getElementById("profile-tab-liked");
    if (!pane) return;
    pane.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await api("/api/me/liked-posts");
      if (!list.length) {
        pane.innerHTML = '<div class="pf-tagged-empty">❤️ এখনো কিছু লাইক করেননি</div>';
        return;
      }
      pane.innerHTML = list.map(function (p) {
        return '<div class="profile-post">' +
          '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(p.content) : _esc(p.content)) + '</div>' +
          '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(p.created_at) : p.created_at) + ' · @' + _esc(p.username) + '</div>' +
        '</div>';
      }).join("");
      if (window.attachHashtagListeners) attachHashtagListeners(pane);
    } catch (err) {
      pane.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>';
    }
  }

  async function _renderSaved() {
    var pane = document.getElementById("profile-tab-saved");
    if (!pane) return;
    pane.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await api("/api/me/saved-posts");
      if (!list.length) {
        pane.innerHTML = '<div class="pf-tagged-empty">🔖 এখনো কিছু সেভ করেননি</div>';
        return;
      }
      pane.innerHTML = list.map(function (p) {
        return '<div class="profile-post">' +
          '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(p.content) : _esc(p.content)) + '</div>' +
          '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(p.created_at) : p.created_at) + ' · @' + _esc(p.username) + '</div>' +
        '</div>';
      }).join("");
      if (window.attachHashtagListeners) attachHashtagListeners(pane);
    } catch (err) {
      pane.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>';
    }
  }


  // Hide liked/saved tabs on OTHER profiles, show only on own
  var _origOpenProfileB4 = window.openProfile;
  if (typeof _origOpenProfileB4 === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB4(username);
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && state.me && state.me.username === data.user.username;
      var liked = document.getElementById("pt-liked");
      var saved = document.getElementById("pt-saved");
      if (liked) liked.style.display = isMe ? "" : "none";
      if (saved) saved.style.display = isMe ? "" : "none";

      // auto-refresh reels count in tab
      try {
        var reels = await api("/api/users/" + encodeURIComponent(data.user.username) + "/reels-list");
        var rTab = document.querySelector('.profile-tab[data-tab="reels"]');
        if (rTab && reels.length) {
          var base = rTab.textContent.replace(/\(\d+\)/, "").trim();
          rTab.innerHTML = '<i class="fa-solid fa-film"></i> রিল (' + reels.length + ')';
        }
      } catch (e) {}
    };
  }

  // ===== 31. Share to Story =====
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b4='share-story']");
    if (!b) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var url = window.location.origin + "/u/" + data.user.username;
    if (typeof showToast === "function") showToast("📸 স্টোরিতে শেয়ার — লিংক কপি হয়েছে");
    navigator.clipboard.writeText(url).catch(function(){});
  }, true);

  // ===== 33. Embed profile =====
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b4='embed']");
    if (!b) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var url = window.location.origin + "/u/" + data.user.username;
    var code = '<iframe src="' + url + '" width="400" height="600" frameborder="0"></iframe>';
    navigator.clipboard.writeText(code).then(function () {
      if (typeof showToast === "function") showToast("📋 Embed code কপি হয়েছে");
    }).catch(function () { alert(code); });
  }, true);

  // Add "Share to Story" + "Embed" to share sheet by extending it
  var _origOpenShareSheet = window._openShareSheet;
  // expose our own version — replace function
  window._openShareSheet = function (username, displayName) {
    // call original first
    if (typeof _origOpenShareSheet === "function") return _origOpenShareSheet(username, displayName);
  };

  console.log("[Batch4] tabs + share-story + embed ready");
  // S39 — Expose for unified profile tab handler
  window._hideAllPanes = _hideAllPanes;
  window._showPane = _showPane;
  window._renderReels = _renderReels;
  window._renderTagged = _renderTagged;
  window._renderLiked = _renderLiked;
  window._renderSaved = _renderSaved;

})();


// ===== Batch 5 — tabs reposts/archived + highlights + similar + live =====
(function () {
  "use strict";
  if (window.__batch5) return;
  window.__batch5 = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function _hideAll() {
    ["posts","reels","photos","tagged","liked","saved","reposts","archived","about"].forEach(function(n){
      var el = document.getElementById("profile-tab-"+n); if (el) el.classList.add("hidden");
    });
  }
  function _show(n) {
    var el = document.getElementById("profile-tab-"+n); if (el) el.classList.remove("hidden");
  }

  async function _renderReposts(username) {
    var p = document.getElementById("profile-tab-reposts");
    if (!p) return;
    p.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await api("/api/users/" + encodeURIComponent(username) + "/reposts-list");
      if (!list.length) { p.innerHTML = '<div class="pf-tagged-empty">🔁 এখনো রিপোস্ট নেই</div>'; return; }
      p.innerHTML = list.map(function (r) {
        return '<div class="profile-post">' +
          '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">' +
            '<i class="fa-solid fa-retweet" style="color:var(--accent)"></i>' +
            '<span style="font-size:12px;color:var(--muted)">@' + _esc(r.username) + '</span>' +
          '</div>' +
          '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(r.content) : _esc(r.content)) + '</div>' +
          '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(r.reposted_at) : r.reposted_at) + '</div>' +
        '</div>';
      }).join("");
    } catch (e) { p.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>'; }
  }

  async function _renderArchived() {
    var p = document.getElementById("profile-tab-archived");
    if (!p) return;
    p.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await api("/api/me/archived-posts");
      if (!list.length) { p.innerHTML = '<div class="pf-tagged-empty">📦 কোনো আর্কাইভ নেই</div>'; return; }
      p.innerHTML = list.map(function (r) {
        return '<div class="profile-post">' +
          '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(r.content) : _esc(r.content)) + '</div>' +
          '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(r.created_at) : r.created_at) + '</div>' +
        '</div>';
      }).join("");
    } catch (e) { p.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>'; }
  }


  // enrich openProfile: highlights + similar + pinned + live + hide own-only tabs
  var _orig = window.openProfile;
  if (typeof _orig === "function") {
    window.openProfile = async function (username) {
      await _orig(username);
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && state.me && state.me.username === data.user.username;

      // own-only tabs hide
      ["pt-liked","pt-saved"].forEach(function(id){
        var el = document.getElementById(id);
        if (el) el.style.display = isMe ? "" : "none";
      });

      // live badge
      var nameRow = document.querySelector("#profile-page .profile-name-row h2");
      if (nameRow) {
        var oldBadge = nameRow.parentNode.querySelector(".pf-live-badge");
        if (oldBadge) oldBadge.remove();
        if (data.user.is_live) {
          var b = document.createElement("span");
          b.className = "pf-live-badge";
          b.textContent = "LIVE";
          nameRow.appendChild(b);
        }
      }

      // highlights row
      var hlRow = document.getElementById("profile-highlights");
      if (hlRow) {
        try {
          var hls = await api("/api/users/" + encodeURIComponent(username) + "/highlights");
          var html = (hls || []).map(function (h) {
            return '<div class="pf-highlight" data-hl="' + h.id + '">' +
              '<div class="pf-hl-cover">' +
                '<img src="' + _esc(h.cover) + '" alt="" loading="lazy" decoding="async">' +
              '</div>' +
              '<div class="pf-hl-title">' + _esc(h.title) + '</div>' +
            '</div>';
          }).join("");
          if (isMe) {
            html += '<div class="pf-highlight add-hl" id="pf-add-hl">' +
              '<div class="pf-hl-cover"><i class="fa-solid fa-plus"></i></div>' +
              '<div class="pf-hl-title">নতুন</div>' +
            '</div>';
          }
          hlRow.innerHTML = html;
          hlRow.classList.toggle("hidden", !html);
          var addBtn = document.getElementById("pf-add-hl");
          if (addBtn) {
            addBtn.addEventListener("click", function () {
              if (typeof showToast === "function") showToast("✨ Highlights আসছে");
            });
          }
        } catch (e) { hlRow.classList.add("hidden"); }
      }

      // similar accounts (other profiles only)
      var simEl = document.getElementById("profile-similar");
      if (simEl) {
        if (isMe) { simEl.classList.add("hidden"); }
        else {
          try {
            var sim = await api("/api/users/" + encodeURIComponent(username) + "/similar");
            if (!sim.length) { simEl.classList.add("hidden"); }
            else {
              simEl.innerHTML = '<div class="pf-sim-title">👥 মিলে যায় এমন অ্যাকাউন্ট</div>' +
                '<div class="pf-sim-row">' +
                  sim.map(function (u) {
                    var av = u.profile_pic ? '<img src="' + _esc(u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
                                            : _esc((u.display_name||"?").charAt(0).toUpperCase());
                    return '<div class="pf-sim-item" data-user="' + _esc(u.username) + '">' +
                      '<div class="pf-sim-av">' + av + '</div>' +
                      '<div class="pf-sim-name">' + _esc(u.display_name) + '</div>' +
                    '</div>';
                  }).join("") +
                '</div>';
              simEl.classList.remove("hidden");
              simEl.querySelectorAll("[data-user]").forEach(function (c) {
                c.addEventListener("click", function () {
                  if (typeof openProfile === "function") openProfile(c.dataset.user);
                });
              });
            }
          } catch (e) { simEl.classList.add("hidden"); }
        }
      }

      // pinned post (prepend as a card at top of posts pane)
      if (data.pinned_post) {
        var postsPane = document.getElementById("profile-tab-posts");
        if (postsPane && !postsPane.dataset.pinnedRendered) {
          postsPane.dataset.pinnedRendered = "1";
          var pinnedHtml = '<div class="profile-post pinned-post-card" style="position:relative">' +
            '<div style="font-size:11.5px;color:var(--accent);font-weight:800;margin-bottom:6px">📌 Pinned</div>' +
            '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(data.pinned_post.content) : _esc(data.pinned_post.content)) + '</div>' +
            '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(data.pinned_post.created_at) : data.pinned_post.created_at) + '</div>' +
          '</div>';
          postsPane.insertAdjacentHTML("afterbegin", pinnedHtml);
        }
      }
    };
  }

  console.log("[Batch5] highlights + similar + pinned + tabs ready");
  // S39 — Expose for unified profile tab handler
  window._hideAll = _hideAll;
  window._show = _show;
  window._renderReposts = _renderReposts;
  window._renderArchived = _renderArchived;

})();


// ===== Batch 6 — mute / restrict / no-retweet in profile menu =====
(function () {
  "use strict";
  if (window.__batch6) return;
  window.__batch6 = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function _sheet(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var s = document.createElement("div");
    s.id = id; s.className = "sheet-root";
    s.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(s); document.body.classList.add("sheet-open");
    requestAnimationFrame(function(){ s.classList.add("show"); });
    function close(){ s.classList.remove("show");
      setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s);
        document.body.classList.remove("sheet-open"); }, 220); }
    s.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = s.querySelector(".sheet-close"); if (x) x.addEventListener("click", close);
    return { root: s, close: close };
  }

  // Extend the ⋮ profile menu with new items
  var _origOpenMenu = window.openPostMenu; // not used here — instead hook into the profile menu

  // We hook into the sheet-menu-item click for existing profile menu items
  // Add "mute / restrict / no-retweet / subscribe" to profile menu by extending the menu builder
  // Since batch1 already creates it in a click handler, patch via another click listener that
  // intercepts the menu open, then re-renders with extra items.

  // Simpler: add to the existing profile menu — detect menu, inject before it renders
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    // wait a tick for the menu to render, then inject extra items
    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel) return;
      if (panel.dataset.b6 === "1") return;
      panel.dataset.b6 = "1";
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && state.me && state.me.username === data.user.username;
      if (isMe) return;

      var extra = [
        { a: "mute",       i: "fa-bell-slash",   l: "মিউট (নীরব)",   c: "b6-mute" },
        { a: "restrict",   i: "fa-eye-slash",    l: "রেস্ট্রিক্ট",    c: "b6-restrict" },
        { a: "noretweet",  i: "fa-retweet",      l: "রিটুইট বন্ধ",   c: "b6-noretweet" },
        { a: "subscribe",  i: "fa-star",         l: "সাবস্ক্রাইব",    c: "b6-subscribe", coming: true },
      ];

      extra.forEach(function (it) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sheet-menu-item " + it.c;
        btn.innerHTML = '<i class="fa-solid ' + it.i + '"></i><span>' + it.l + '</span>' +
          (it.coming ? ' <span style="font-size:9.5px;font-weight:800;color:var(--accent);margin-left:6px">SOON</span>' : '');
        panel.appendChild(btn);
      });

      // load current states
      (async function () {
        try {
          var u = data.user.username;
          var st = await Promise.all([
            api("/api/users/" + encodeURIComponent(u) + "/mute/status"),
            api("/api/users/" + encodeURIComponent(u) + "/restrict/status"),
            api("/api/users/" + encodeURIComponent(u) + "/no-retweet/status"),
          ]);
          if (st[0].muted) {
            var b = panel.querySelector(".b6-mute span");
            if (b) b.textContent = "আনমিউট";
          }
          if (st[1].restricted) {
            var b2 = panel.querySelector(".b6-restrict span");
            if (b2) b2.textContent = "আনরেস্ট্রিক্ট";
          }
          if (st[2].no_retweet) {
            var b3 = panel.querySelector(".b6-noretweet span");
            if (b3) b3.textContent = "রিটুইট চালু";
          }
        } catch (err) {}
      })();

      // wire
      panel.querySelectorAll(".b6-mute, .b6-restrict, .b6-noretweet, .b6-subscribe").forEach(function (b) {
        b.addEventListener("click", async function () {
          var u = data.user.username;
          try {
            if (b.classList.contains("b6-mute")) {
              var r = await api("/api/users/" + encodeURIComponent(u) + "/mute", { method: "POST" });
              if (typeof showToast === "function") showToast(r.muted ? "🔕 মিউট করা হয়েছে" : "🔔 আনমিউট");
            } else if (b.classList.contains("b6-restrict")) {
              var r2 = await api("/api/users/" + encodeURIComponent(u) + "/restrict", { method: "POST" });
              if (typeof showToast === "function") showToast(r2.restricted ? "🔒 রেস্ট্রিক্টেড" : "✅ আনরেস্ট্রিক্ট");
            } else if (b.classList.contains("b6-noretweet")) {
              var r3 = await api("/api/users/" + encodeURIComponent(u) + "/no-retweet", { method: "POST" });
              if (typeof showToast === "function") showToast(r3.no_retweet ? "🚫 রিটুইট বন্ধ" : "🔁 রিটুইট চালু");
            } else if (b.classList.contains("b6-subscribe")) {
              if (typeof showToast === "function") showToast("⭐ সাবস্ক্রাইব — শীঘ্রই আসছে");
            }
          } catch (err) { alert(err.message || "সমস্যা"); }
          // close menu
          var open = document.querySelector("#profile-menu-sheet.show");
          if (open) { open.classList.remove("show"); setTimeout(function(){ if(open.parentNode) open.parentNode.removeChild(open); document.body.classList.remove("sheet-open"); }, 200); }
        });
      });
    }, 50);
  }, true);

  console.log("[Batch6] mute/restrict/no-retweet ready");
})();


// ===== Batch 7 — report story / hide / snooze / break =====
(function () {
  "use strict";
  if (window.__batch7) return;
  window.__batch7 = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function _sheet(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var s = document.createElement("div");
    s.id = id; s.className = "sheet-root";
    s.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(s); document.body.classList.add("sheet-open");
    requestAnimationFrame(function(){ s.classList.add("show"); });
    function close(){ s.classList.remove("show");
      setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s);
        document.body.classList.remove("sheet-open"); }, 220); }
    s.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = s.querySelector(".sheet-close"); if (x) x.addEventListener("click", close);
    return { root: s, close: close };
  }

  function _modal(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var m = document.createElement("div");
    m.id = id; m.className = "modal";
    m.innerHTML = html;
    document.body.appendChild(m);
    return m;
  }

  // ============ 62. Report story — hook into story viewer ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#sv-report")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var viewer = document.getElementById("story-viewer");
    if (!viewer || viewer.classList.contains("hidden")) return;
    // find current story id
    var bar = document.getElementById("sv-reactions-bar");
    var sid = bar ? bar.dataset.storyId : null;
    if (!sid) return;
    _openReportStorySheet(sid);
  }, true);

  // Add "Report" button to story viewer footer (if not present)
  var _origRender = window.renderCurrentStory;
  if (typeof _origRender === "function") {
    window.renderCurrentStory = async function () {
      await _origRender();
      var footer = document.querySelector(".sv-footer");
      if (!footer || document.getElementById("sv-report")) return;
      var b = document.createElement("button");
      b.id = "sv-report";
      b.className = "sv-delete";
      b.style.background = "rgba(0,0,0,0.45)";
      b.style.marginLeft = "6px";
      b.innerHTML = '<i class="fa-solid fa-flag"></i> রিপোর্ট';
      footer.appendChild(b);
    };
  }

  function _openReportStorySheet(sid) {
    var reasons = [
      { v: "spam",        l: "স্প্যাম / বিজ্ঞাপন",         i: "fa-bullhorn" },
      { v: "harassment",  l: "হয়রানি / গালাগালি",         i: "fa-hand-fist" },
      { v: "violence",    l: "হিংস্রতা / ভয় দেখানো",     i: "fa-triangle-exclamation" },
      { v: "false_info",  l: "মিথ্যা তথ্য",                 i: "fa-circle-exclamation" },
      { v: "other",       l: "অন্য কিছু",                  i: "fa-ellipsis" },
    ];
    var s = _sheet("b7-report-story-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>স্টোরি রিপোর্ট</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:8px 12px">' +
          reasons.map(function(r){
            return '<div class="b3-share-row" data-reason="' + r.v + '">' +
              '<div class="b3-share-icon" style="background:var(--danger)"><i class="fa-solid ' + r.i + '"></i></div>' +
              '<div class="b3-share-label">' + _esc(r.l) + '</div>' +
            '</div>';
          }).join("") +
          '<textarea id="b7-story-notes" placeholder="অতিরিক্ত কিছু? (ঐচ্ছিক)" maxlength="500" ' +
          'style="width:100%;margin-top:10px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);' +
          'font-family:inherit;font-size:13.5px;color:var(--text);background:var(--card-2);min-height:70px;resize:vertical;outline:none"></textarea>' +
        '</div>' +
      '</div>');

    s.root.querySelectorAll("[data-reason]").forEach(function (r) {
      r.addEventListener("click", async function () {
        var reason = r.dataset.reason;
        var notes = (s.root.querySelector("#b7-story-notes").value || "").trim();
        r.style.pointerEvents = "none";
        try {
          await api("/api/stories/" + sid + "/report", {
            method: "POST",
            body: JSON.stringify({ reason: reason, notes: notes })
          });
          s.close();
          if (typeof showToast === "function") showToast("✅ রিপোর্ট পাঠানো হয়েছে");
        } catch (err) {
          alert(err.message || "সমস্যা");
          r.style.pointerEvents = "";
        }
      });
    });
  }

  // ============ 63. Hide from feed — post menu item ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest('[data-action="hide"]');
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var postEl = b.closest(".post");
    if (!postEl) return;
    var postId = postEl.dataset.id;
    if (!postId) return;
    if (typeof closePostMenu === "function") closePostMenu();
    (async function () {
      try {
        await api("/api/posts/" + postId + "/hide", { method: "POST" });
        postEl.style.transition = "opacity 0.3s, transform 0.3s";
        postEl.style.opacity = "0";
        postEl.style.transform = "scale(0.96)";
        setTimeout(function(){ postEl.remove(); }, 320);
        if (typeof showToast === "function") showToast("🙈 পোস্ট লুকানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); }
    })();
  }, true);

  // Extend post menu to include "Hide" for all posts (currently only delete for own)
  var _origHandle = window.handlePostMenuAction;
  if (typeof _origHandle === "function") {
    window.handlePostMenuAction = async function (action, btn, postEl, postId) {
      if (action === "hide") {
        try {
          await api("/api/posts/" + postId + "/hide", { method: "POST" });
          postEl.style.transition = "opacity 0.3s, transform 0.3s";
          postEl.style.opacity = "0";
          postEl.style.transform = "scale(0.96)";
          setTimeout(function(){ postEl.remove(); }, 320);
          if (typeof showToast === "function") showToast("🙈 পোস্ট লুকানো হয়েছে");
        } catch (err) { alert(err.message || "সমস্যা"); }
        return;
      }
      return _origHandle(action, btn, postEl, postId);
    };
  }

  // Inject "Hide" into post menu popup right after it's created
  var _origOpenPostMenu = window.openPostMenu;
  if (typeof _origOpenPostMenu === "function") {
    window.openPostMenu = function (btn, postEl, postId) {
      _origOpenPostMenu(btn, postEl, postId);
      setTimeout(function () {
        var menu = document.getElementById("post-menu-popup");
        if (!menu || menu.dataset.b7 === "1") return;
        menu.dataset.b7 = "1";
        // Insert "Hide" before report/delete
        var saveBtn = menu.querySelector('button[data-action="save"]');
        var target = menu.querySelector('button[data-action="report"]') || menu.querySelector('button[data-action="delete"]');
        if (!target) return;
        var hideBtn = document.createElement("button");
        hideBtn.setAttribute("data-action", "hide");
        hideBtn.innerHTML = '<i class="fa-regular fa-eye-slash"></i><span>লুকান</span>';
        menu.insertBefore(hideBtn, target);
      }, 30);
    };
  }

  // ============ 64. Snooze — profile menu item ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".b7-snooze-open");
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var username = data.user.username;
    // close existing menu
    var open = document.querySelector(".sheet-root.show");
    if (open) { open.classList.remove("show"); setTimeout(function(){ if(open.parentNode) open.parentNode.removeChild(open); document.body.classList.remove("sheet-open"); }, 180); }

    setTimeout(function () {
      var s = _sheet("b7-snooze-sheet",
        '<div class="sheet-panel">' +
          '<div class="sheet-handle"></div>' +
          '<div class="sheet-header"><h3>স্নুজ করুন</h3>' +
          '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
          '<div class="sheet-body" style="padding:6px 0">' +
            [1, 7, 30, 90, 365].map(function(d){
              var label = d === 365 ? "1 বছর" : (d + " দিন");
              return '<div class="b7-snooze-row">' +
                '<div><div class="b7-snooze-label">' + label + '</div>' +
                '<div class="b7-snooze-sub">এই সময়ে এই ইউজারের পোস্ট দেখবেন না</div></div>' +
                '<button class="b7-snooze-btn" data-days="' + d + '">স্নুজ</button>' +
              '</div>';
            }).join("") +
          '</div>' +
        '</div>');

      s.root.querySelectorAll(".b7-snooze-btn").forEach(function (b2) {
        b2.addEventListener("click", async function () {
          var days = b2.dataset.days;
          b2.disabled = true;
          try {
            await api("/api/users/" + encodeURIComponent(username) + "/snooze", {
              method: "POST",
              body: JSON.stringify({ days: parseInt(days) })
            });
            s.close();
            if (typeof showToast === "function") showToast("😴 " + days + " দিনের জন্য স্নুজ");
          } catch (err) { alert(err.message || "সমস্যা"); b2.disabled = false; }
        });
      });
    }, 220);
  }, true);

  // Inject Snooze into profile menu
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel || panel.dataset.b7s === "1") return;
      panel.dataset.b7s = "1";
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && state.me && state.me.username === data.user.username;
      if (isMe) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sheet-menu-item b7-snooze-open";
      btn.innerHTML = '<i class="fa-solid fa-moon"></i><span>স্নুজ করুন</span>';
      // insert after mute/restrict/noretweet section
      var last = panel.querySelector(".b6-noretweet");
      if (last && last.nextSibling) panel.insertBefore(btn, last.nextSibling);
      else panel.appendChild(btn);
    }, 55);
  }, true);

  // ============ 65. Take a break ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b7='take-break']");
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var m = _modal("b7-break-modal",
      '<div class="modal-content b7-break-modal-content">' +
        '<div class="b7-break-icon">🌿</div>' +
        '<div class="b7-break-title">একটু বিরতি নিন</div>' +
        '<div class="b7-break-text">' +
          'সোশ্যাল মিডিয়া থেকে কয়েক ঘণ্টা দূরে থাকুন।<br>' +
          'আপনার মন ভালো থাকবে। 🌱' +
        '</div>' +
        '<div class="b7-break-actions">' +
          '<button class="primary" id="b7-break-go">এখনই শুরু করুন</button>' +
          '<button id="b7-break-cancel">বাতিল</button>' +
        '</div>' +
      '</div>');
    m.querySelector("#b7-break-cancel").onclick = function () { m.remove(); };
    m.querySelector("#b7-break-go").onclick = async function () {
      try {
        var r = await api("/api/me/take-break", { method: "POST" });
        m.remove();
        if (typeof showToast === "function") showToast(r.message || "🌿 বিরতি নিন");
      } catch (err) { alert(err.message || "সমস্যা"); }
    };
    m.addEventListener("click", function (ev) { if (ev.target === m) m.remove(); });
  }, true);


  // ============ 66. Report imposter ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b7='report-imposter']");
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var m = _modal("b7-imposter-modal",
      '<div class="modal-content" style="max-width:400px">' +
        '<button class="close-btn" id="b7-imp-close">×</button>' +
        '<h3 style="margin-bottom:14px;font-size:18px">🎭 ইম্পোস্টার রিপোর্ট</h3>' +
        '<p style="font-size:13px;color:var(--muted);margin-bottom:12px">' +
          'এই অ্যাকাউন্ট কাউকে নকল করছে মনে হলে নিচে বিস্তারিত লিখুন।' +
        '</p>' +
        '<textarea id="b7-imp-notes" placeholder="কার নকল করছে? বিস্তারিত..." maxlength="500" ' +
        'style="width:100%;min-height:90px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);' +
        'font-family:inherit;font-size:13.5px;background:var(--card-2);color:var(--text);outline:none;resize:vertical"></textarea>' +
        '<div class="edit-actions" style="margin-top:14px">' +
          '<button class="btn-secondary" id="b7-imp-cancel">বাতিল</button>' +
          '<button class="btn-primary danger-btn" id="b7-imp-send" style="width:auto;padding:11px 22px">' +
            '<i class="fa-solid fa-paper-plane"></i> পাঠান' +
          '</button>' +
        '</div>' +
      '</div>');
    m.querySelector("#b7-imp-close").onclick = function () { m.remove(); };
    m.querySelector("#b7-imp-cancel").onclick = function () { m.remove(); };
    m.addEventListener("click", function (ev) { if (ev.target === m) m.remove(); });
    m.querySelector("#b7-imp-send").onclick = async function () {
      var notes = (m.querySelector("#b7-imp-notes").value || "").trim();
      if (!notes) return alert("বিস্তারিত লিখুন");
      var sendBtn = m.querySelector("#b7-imp-send");
      sendBtn.disabled = true;
      try {
        await api("/api/me/report-imposter", {
          method: "POST",
          body: JSON.stringify({ username: data.user.username, notes: notes })
        });
        m.remove();
        if (typeof showToast === "function") showToast("✅ রিপোর্ট পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); sendBtn.disabled = false; }
    };
  }, true);

  // Inject Report Imposter into profile menu
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel || panel.dataset.b7i === "1") return;
      panel.dataset.b7i = "1";
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && state.me && state.me.username === data.user.username;
      if (isMe) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sheet-menu-item danger";
      btn.setAttribute("data-b7", "report-imposter");
      btn.innerHTML = '<i class="fa-solid fa-mask"></i><span>ইম্পোস্টার রিপোর্ট</span>';
      panel.appendChild(btn);
    }, 60);
  }, true);

  console.log("[Batch7] report-story + hide + snooze + break + imposter ready");
})();


// ===== Batch 8 — extended profile + insights =====
(function () {
  "use strict";
  if (window.__batch8) return;
  window.__batch8 = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  // ============ Extend Edit Profile modal — load current values ============
  var _origOpenEdit = window.openEditProfile;
  if (typeof _origOpenEdit === "function") {
    window.openEditProfile = async function () {
      _origOpenEdit();
      try {
        var ext = await api("/api/me/profile-extended");
        var pr = document.getElementById("edit-pronouns");
        var lo = document.getElementById("edit-location");
        var ca = document.getElementById("edit-category");
        var bl = document.getElementById("edit-bio-links");
        if (pr) pr.value = ext.pronouns || "";
        if (lo) lo.value = ext.location || "";
        if (ca) ca.value = ext.category || "";
        if (bl) bl.value = ext.bio_links || "";
      } catch (e) {}
    };
  }

  // ============ Extend save ============
  var _origSave = window.saveEditProfile;
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#save-edit-profile")) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    (async function () {
      var name = document.getElementById("edit-name");
      var bio = document.getElementById("edit-bio");
      var pr = document.getElementById("edit-pronouns");
      var lo = document.getElementById("edit-location");
      var ca = document.getElementById("edit-category");
      var bl = document.getElementById("edit-bio-links");
      var btn = document.getElementById("save-edit-profile");
      btn.disabled = true;
      var oldHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> সেভ...';
      try {
        // 1. Basic bio + name
        await api("/api/me/bio", {
          method: "POST",
          body: JSON.stringify({
            bio: bio ? bio.value.trim() : "",
            display_name: name ? name.value.trim() : "",
          })
        });
        // 2. Extended fields
        await api("/api/me/profile-extended", {
          method: "POST",
          body: JSON.stringify({
            pronouns: pr ? pr.value.trim() : "",
            location: lo ? lo.value.trim() : "",
            category: ca ? ca.value : "",
            bio_links: bl ? bl.value.trim() : "",
          })
        });
        // 3. avatar/cover (handled by original save code) — call them if pending
        if (typeof pendingAvatar !== "undefined" && pendingAvatar !== null) {
          var r = await api("/api/me/avatar", {
            method: "POST",
            body: JSON.stringify({ avatar: pendingAvatar })
          });
          if (state.me) state.me.profile_pic = r.avatar;
        }
        if (typeof pendingCover !== "undefined" && pendingCover !== null) {
          var rc = await api("/api/me/cover", {
            method: "POST",
            body: JSON.stringify({ cover: pendingCover })
          });
          if (state.me) state.me.cover_pic = rc.cover;
        }
        // refresh
        var me = await api("/api/me");
        if (me && me.user) state.me = me.user;
        if (typeof refreshProfileUI === "function") refreshProfileUI();
        if (typeof loadFeed === "function") loadFeed();
        // close modal
        var m = document.getElementById("edit-profile-modal");
        if (m) m.classList.add("hidden");
        if (typeof showToast === "function") showToast("✅ প্রোফাইল সেভ হয়েছে");
        // re-render profile if open
        if (state.me && typeof openProfile === "function") openProfile(state.me.username);
      } catch (err) {
        alert(err.message || "সেভ করা যায়নি");
      } finally {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
      }
    })();
  }, true);

  // ============ Render extended info on profile page ============
  var _origOpenProfileB8 = window.openProfile;
  if (typeof _origOpenProfileB8 === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB8(username);
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var u = data.user;

      // Pronouns badge next to name
      var nameEl = document.getElementById("profile-page-name");
      if (nameEl) {
        var oldPr = nameEl.parentNode.querySelector(".pf-pronouns-badge");
        if (oldPr) oldPr.remove();
        if (u.pronouns) {
          var b = document.createElement("span");
          b.className = "pf-pronouns-badge";
          b.textContent = u.pronouns;
          nameEl.appendChild(b);
        }
      }

      // Category badge
      if (nameEl) {
        var oldCat = nameEl.parentNode.querySelector(".pf-category-badge");
        if (oldCat) oldCat.remove();
        if (u.category) {
          var catLabel = {
            "personal": "👤 ব্যক্তিগত",
            "creator": "🎨 ক্রিয়েটর",
            "business": "💼 ব্যবসা",
            "public_figure": "⭐ পাবলিক ফিগার",
            "brand": "🏷 ব্র্যান্ড",
            "community": "👥 কমিউনিটি",
          }[u.category] || u.category;
          var cb = document.createElement("span");
          cb.className = "pf-category-badge";
          cb.textContent = catLabel;
          nameEl.appendChild(cb);
        }
      }

      // Location line under username
      var unameEl = document.getElementById("profile-page-username");
      if (unameEl) {
        var oldLoc = unameEl.parentNode.querySelector(".pf-location-line");
        if (oldLoc) oldLoc.remove();
        if (u.location) {
          var l = document.createElement("div");
          l.className = "pf-location-line";
          l.innerHTML = '<i class="fa-solid fa-location-dot"></i> ' + _esc(u.location);
          unameEl.parentNode.appendChild(l);
        }
      }

      // Bio links
      var bioEl = document.getElementById("profile-page-bio");
      if (bioEl) {
        var oldLinks = bioEl.parentNode.querySelector(".pf-bio-links");
        if (oldLinks) oldLinks.remove();
        if (u.bio_links) {
          var links = u.bio_links.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
          if (links.length) {
            var wrap = document.createElement("div");
            wrap.className = "pf-bio-links";
            wrap.innerHTML = links.map(function (link) {
              var display = link.replace(/^https?:\/\//, "").split("/")[0];
              var href = /^https?:\/\//.test(link) ? link : ("https://" + link);
              return '<a class="pf-bio-link" href="' + _esc(href) + '" target="_blank" rel="noopener">' +
                '<i class="fa-solid fa-link"></i> ' + _esc(display) + '</a>';
            }).join("");
            bioEl.parentNode.appendChild(wrap);
          }
        }
      }

      // ============ Inject Insights button (own profile only) ============
      var isMe = window.state && state.me && state.me.username === u.username;
      var btns = document.getElementById("profile-buttons");
      if (btns && isMe) {
        if (!document.getElementById("btn-open-insights")) {
          var b = document.createElement("button");
          b.id = "btn-open-insights";
          b.className = "btn-icon-circle";
          b.title = "ইনসাইট";
          b.innerHTML = '<i class="fa-solid fa-chart-line"></i>';
          b.addEventListener("click", function () {
            if (typeof window.openInsightsPage === "function") window.openInsightsPage();
          });
          btns.appendChild(b);
        }
      }
    };
  }

  // ============ Insights page ============
  window.openInsightsPage = async function () {
    var page = document.getElementById("insights-page");
    if (!page) return;
    page.classList.remove("hidden");
    var body = document.getElementById("insights-body");
    body.innerHTML = '<p style="text-align:center;padding:40px;color:var(--muted)">লোড হচ্ছে...</p>';
    try {
      var d = await api("/api/me/insights");
      var cards = [
        { i: "fa-file-lines",     v: d.posts,             l: "মোট পোস্ট" },
        { i: "fa-heart",          v: d.likes_received,    l: "মোট লাইক" },
        { i: "fa-comment",        v: d.comments_received, l: "মোট মন্তব্য" },
        { i: "fa-user-plus",      v: d.new_followers_7d,  l: "নতুন ফলোয়ার (৭দিন)" },
      ];
      var cardsHTML = cards.map(function (c) {
        return '<div class="ins-card">' +
          '<div class="ins-icon"><i class="fa-solid ' + c.i + '"></i></div>' +
          '<div class="ins-value">' + (c.v || 0) + '</div>' +
          '<div class="ins-label">' + c.l + '</div>' +
        '</div>';
      }).join("");

      // weekly chart
      var max = Math.max.apply(null, d.chart.map(function (x) { return x.count; })) || 1;
      var dayLabels = ["আজ","১","২","৩","৪","৫","৬"];
      var barsHTML = d.chart.map(function (x) {
        var pct = (x.count / max) * 100;
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center">' +
          '<div class="ins-bar" style="height:' + Math.max(pct, 4) + '%" title="' + x.count + '"></div>' +
          '<div class="ins-bar-day">' + dayLabels[6 - x.day] + '</div>' +
        '</div>';
      }).join("");

      var topHTML = "";
      if (d.top_post) {
        topHTML = '<div class="ins-top-post">' +
          '<h4>🏆 সর্বোচ্চ এনগেজড পোস্ট</h4>' +
          '<div class="post-content">' + _esc((d.top_post.content || "").slice(0, 200)) + '</div>' +
          '<div style="font-size:12.5px;color:var(--muted);font-weight:700">' +
            '<i class="fa-solid fa-heart" style="color:#ef4444"></i> ' + d.top_post.likes + ' লাইক' +
          '</div>' +
        '</div>';
      }

      body.innerHTML = '<div class="insights-grid">' + cardsHTML + '</div>' +
        '<div class="ins-chart">' +
          '<div class="ins-chart-title">📈 সাপ্তাহিক লাইক</div>' +
          '<div class="ins-bars">' + barsHTML + '</div>' +
        '</div>' +
        topHTML;
    } catch (err) {
      body.innerHTML = '<p style="text-align:center;padding:40px;color:var(--danger)">লোড করা যায়নি</p>';
    }
  };

  document.addEventListener("click", function (e) {
    if (e.target.closest("#insights-back")) {
      var p = document.getElementById("insights-page");
      if (p) p.classList.add("hidden");
    }
  }, true);

  console.log("[Batch8] extended profile + insights ready");
})();


// ===== Batch 9 — monetization UI =====
(function () {
  "use strict";
  if (window.__batch9) return;
  window.__batch9 = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function _sheet(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var s = document.createElement("div");
    s.id = id; s.className = "sheet-root";
    s.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(s); document.body.classList.add("sheet-open");
    requestAnimationFrame(function(){ s.classList.add("show"); });
    function close(){ s.classList.remove("show");
      setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s);
        document.body.classList.remove("sheet-open"); }, 220); }
    s.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = s.querySelector(".sheet-close"); if (x) x.addEventListener("click", close);
    return { root: s, close: close };
  }

  // ============ 87. Tip ============
  window._openTipSheet = function (username, displayName) {
    var amounts = [50, 100, 200, 500, 1000, 2000];
    var s = _sheet("b9-tip-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>💰 টিপ পাঠান</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<p style="font-size:13px;color:var(--muted);margin-bottom:12px">' +
            '<strong>@' + _esc(username) + '</strong> কে টিপ পাঠান' +
          '</p>' +
          '<input type="number" class="b9-price-input" id="b9-tip-amount" placeholder="৳ পরিমাণ" min="10" max="100000">' +
          '<div class="b9-quick-amounts">' +
            amounts.map(function(a){
              return '<button type="button" class="b9-quick-btn" data-amt="' + a + '">৳ ' + a + '</button>';
            }).join("") +
          '</div>' +
          '<textarea id="b9-tip-note" placeholder="একটি নোট (ঐচ্ছিক)" maxlength="200" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:14px;color:var(--text);outline:none;' +
            'min-height:64px;resize:vertical;margin-bottom:14px"></textarea>' +
          '<button class="btn-primary" id="b9-tip-send" style="width:100%;padding:14px;border-radius:12px">' +
            '<i class="fa-solid fa-paper-plane"></i> টিপ পাঠান' +
          '</button>' +
          '<p style="font-size:11.5px;color:var(--muted);text-align:center;margin-top:8px">' +
            '⚠️ পেমেন্ট গেটওয়ে আসছে — আপনার অনুরোধ সংরক্ষিত হয়' +
          '</p>' +
        '</div>' +
      '</div>');

    s.root.querySelectorAll(".b9-quick-btn").forEach(function(b){
      b.addEventListener("click", function(){
        var inp = s.root.querySelector("#b9-tip-amount");
        if (inp) inp.value = b.dataset.amt;
      });
    });

    s.root.querySelector("#b9-tip-send").addEventListener("click", async function(){
      var amt = parseFloat(s.root.querySelector("#b9-tip-amount").value || 0);
      var note = (s.root.querySelector("#b9-tip-note").value || "").trim();
      if (!amt || amt < 10) return alert("১০ টাকার বেশি দিন");
      this.disabled = true;
      try {
        await api("/api/users/" + encodeURIComponent(username) + "/tip", {
          method: "POST",
          body: JSON.stringify({ amount: amt, note: note })
        });
        s.close();
        if (typeof showToast === "function") showToast("💰 ৳ " + amt + " টিপ পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 88. Gift ============
  window._openGiftSheet = function (username, displayName) {
    var gifts = [
      { code: "rose",   emoji: "🌹", label: "গোলাপ" },
      { code: "heart",  emoji: "❤️", label: "হার্ট" },
      { code: "star",   emoji: "⭐", label: "স্টার" },
      { code: "cake",   emoji: "🎂", label: "কেক" },
      { code: "crown",  emoji: "👑", label: "ক্রাউন" },
      { code: "rocket", emoji: "🚀", label: "রকেট" },
      { code: "coffee", emoji: "☕", label: "কফি" },
      { code: "fire",   emoji: "🔥", label: "ফায়ার" },
      { code: "diamond", emoji: "💎", label: "ডায়মন্ড" },
    ];
    var s = _sheet("b9-gift-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>🎁 গিফট পাঠান</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="b9-grid">' +
          gifts.map(function(g){
            return '<button class="b9-gift" data-code="' + g.code + '">' +
              '<span class="b9-emoji">' + g.emoji + '</span>' +
              '<span class="b9-label">' + g.label + '</span>' +
            '</button>';
          }).join("") +
        '</div>' +
        '<div style="padding:0 16px 14px">' +
          '<textarea id="b9-gift-note" placeholder="নোট (ঐচ্ছিক)" maxlength="100" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:13.5px;color:var(--text);outline:none;' +
            'min-height:50px;resize:vertical;margin-bottom:12px"></textarea>' +
          '<button class="btn-primary" id="b9-gift-send" style="width:100%;padding:12px;border-radius:12px" disabled>' +
            'একটি গিফট বেছে নিন' +
          '</button>' +
        '</div>' +
      '</div>');

    var selected = null;
    s.root.querySelectorAll(".b9-gift").forEach(function(b){
      b.addEventListener("click", function(){
        s.root.querySelectorAll(".b9-gift").forEach(function(x){ x.classList.remove("on"); });
        b.classList.add("on");
        selected = b.dataset.code;
        var btn = s.root.querySelector("#b9-gift-send");
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> গিফট পাঠান';
      });
    });

    s.root.querySelector("#b9-gift-send").addEventListener("click", async function(){
      if (!selected) return;
      var note = (s.root.querySelector("#b9-gift-note").value || "").trim();
      this.disabled = true;
      try {
        await api("/api/users/" + encodeURIComponent(username) + "/gift", {
          method: "POST",
          body: JSON.stringify({ gift: selected, note: note })
        });
        s.close();
        if (typeof showToast === "function") showToast("🎁 গিফট পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 89. Book appointment ============
  window._openAppointmentSheet = function (username, displayName) {
    var s = _sheet("b9-appt-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>📅 অ্যাপয়েন্টমেন্ট বুক</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<p style="font-size:13px;color:var(--muted);margin-bottom:12px">' +
            '<strong>@' + _esc(username) + '</strong> এর সাথে অ্যাপয়েন্টমেন্ট' +
          '</p>' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px">তারিখ ও সময়</label>' +
          '<input type="datetime-local" id="b9-appt-when" class="b9-price-input" style="font-size:14px;font-weight:600">' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;margin-top:12px">সময়কাল (মিনিট)</label>' +
          '<select id="b9-appt-dur" class="b9-price-input" style="font-size:14px">' +
            '<option value="15">১৫ মিনিট</option>' +
            '<option value="30" selected>৩০ মিনিট</option>' +
            '<option value="60">১ ঘণ্টা</option>' +
            '<option value="120">২ ঘণ্টা</option>' +
          '</select>' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;margin-top:12px">নোট</label>' +
          '<textarea id="b9-appt-note" placeholder="কী নিয়ে আলোচনা করতে চান?" maxlength="300" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:14px;color:var(--text);outline:none;' +
            'min-height:70px;resize:vertical;margin-bottom:14px"></textarea>' +
          '<button class="btn-primary" id="b9-appt-send" style="width:100%;padding:14px;border-radius:12px">' +
            '<i class="fa-solid fa-calendar-check"></i> বুক করুন' +
          '</button>' +
        '</div>' +
      '</div>');

    s.root.querySelector("#b9-appt-send").addEventListener("click", async function(){
      var when = s.root.querySelector("#b9-appt-when").value;
      var dur = parseInt(s.root.querySelector("#b9-appt-dur").value || 30);
      var note = (s.root.querySelector("#b9-appt-note").value || "").trim();
      if (!when) return alert("তারিখ ও সময় দিন");
      this.disabled = true;
      try {
        await api("/api/users/" + encodeURIComponent(username) + "/appointments", {
          method: "POST",
          body: JSON.stringify({ datetime: when, duration: dur, note: note })
        });
        s.close();
        if (typeof showToast === "function") showToast("📅 অ্যাপয়েন্টমেন্ট বুক হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 82. Shop ============
  window._openShopSheet = async function (username, displayName, isOwn) {
    var s = _sheet("b9-shop-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>🛍️ শপ — @' + _esc(username) + '</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 14px">' +
          '<div id="b9-shop-list"><p style="text-align:center;padding:20px;color:var(--muted)">লোড হচ্ছে...</p></div>' +
          (isOwn ? '<button class="btn-secondary" id="b9-shop-add" style="width:100%;margin-top:12px"><i class="fa-solid fa-plus"></i> নতুন পণ্য যোগ করুন</button>' : '') +
        '</div>' +
      '</div>');

    async function load() {
      var list = s.root.querySelector("#b9-shop-list");
      try {
        var products = await api("/api/users/" + encodeURIComponent(username) + "/shop");
        if (!products.length) {
          list.innerHTML = '<p style="text-align:center;padding:30px;color:var(--muted);font-size:14px">🛍️ এখনো কোনো পণ্য নেই</p>';
          return;
        }
        list.innerHTML = '<div class="b9-shop-grid">' +
          products.map(function(p){
            var img = p.image ? '<img src="' + _esc(p.image) + '" alt="" loading="lazy" decoding="async">'
                              : '<i class="fa-solid fa-box"></i>';
            return '<div class="b9-product" data-pid="' + p.id + '" data-price="' + p.price + '">' +
              '<div class="b9-product-img">' + img + '</div>' +
              '<div class="b9-product-info">' +
                '<div class="b9-product-title">' + _esc(p.title) + '</div>' +
                '<div class="b9-product-price">৳ ' + p.price + '</div>' +
              '</div>' +
            '</div>';
          }).join("") + '</div>';
        list.querySelectorAll(".b9-product").forEach(function(cell){
          cell.addEventListener("click", async function(){
            if (isOwn) return;
            if (!confirm("এই পণ্য কিনবেন — ৳ " + cell.dataset.price + " ?")) return;
            try {
              await api("/api/shop/products/" + cell.dataset.pid + "/buy", { method: "POST" });
              if (typeof showToast === "function") showToast("✅ অর্ডার প্লেস হয়েছে");
            } catch (err) { alert(err.message || "সমস্যা"); }
          });
        });
      } catch (err) {
        list.innerHTML = '<p style="text-align:center;padding:20px;color:var(--danger)">লোড করা যায়নি</p>';
      }
    }
    await load();

    var addBtn = s.root.querySelector("#b9-shop-add");
    if (addBtn) {
      addBtn.addEventListener("click", function(){
        var title = prompt("পণ্যের নাম:");
        if (!title) return;
        var price = parseFloat(prompt("দাম (টাকা):") || "0");
        if (!price || price < 0) return alert("দাম দিন");
        api("/api/users/" + encodeURIComponent(username) + "/shop", {
          method: "POST",
          body: JSON.stringify({ title: title, price: price })
        }).then(function(){
          if (typeof showToast === "function") showToast("✅ পণ্য যোগ হয়েছে");
          load();
        }).catch(function(e){ alert(e.message); });
      });
    }
  };

  // ============ 81. Boost ============
  window._openBoostSheet = function (postId) {
    var s = _sheet("b9-boost-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>🚀 পোস্ট বুস্ট</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px">বাজেট (টাকা)</label>' +
          '<input type="number" id="b9-boost-budget" class="b9-price-input" placeholder="কমপক্ষে ৫০" min="50" max="50000">' +
          '<div class="b9-quick-amounts">' +
            [100, 250, 500, 1000, 2500].map(function(a){
              return '<button type="button" class="b9-quick-btn" data-amt="' + a + '">৳ ' + a + '</button>';
            }).join("") +
          '</div>' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;margin-top:6px">সময়কাল</label>' +
          '<select id="b9-boost-days" class="b9-price-input">' +
            '<option value="1">১ দিন</option>' +
            '<option value="3">৩ দিন</option>' +
            '<option value="7" selected>৭ দিন</option>' +
            '<option value="14">১৪ দিন</option>' +
            '<option value="30">৩০ দিন</option>' +
          '</select>' +
          '<button class="btn-primary" id="b9-boost-send" style="width:100%;padding:14px;border-radius:12px;margin-top:12px">' +
            '<i class="fa-solid fa-rocket"></i> বুস্ট শুরু' +
          '</button>' +
          '<p style="font-size:11.5px;color:var(--muted);text-align:center;margin-top:8px">' +
            '⚠️ পেমেন্ট গেটওয়ে আসছে' +
          '</p>' +
        '</div>' +
      '</div>');

    s.root.querySelectorAll(".b9-quick-btn").forEach(function(b){
      b.addEventListener("click", function(){
        var inp = s.root.querySelector("#b9-boost-budget");
        if (inp) inp.value = b.dataset.amt;
      });
    });

    s.root.querySelector("#b9-boost-send").addEventListener("click", async function(){
      var budget = parseFloat(s.root.querySelector("#b9-boost-budget").value || 0);
      var days = parseInt(s.root.querySelector("#b9-boost-days").value || 7);
      if (!budget || budget < 50) return alert("কমপক্ষে ৫০ টাকা");
      this.disabled = true;
      try {
        await api("/api/posts/" + postId + "/boost", {
          method: "POST",
          body: JSON.stringify({ budget: budget, days: days })
        });
        s.close();
        if (typeof showToast === "function") showToast("🚀 বুস্ট অনুরোধ পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ Menu items in profile ⋮ ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel || panel.dataset.b9 === "1") return;
      panel.dataset.b9 = "1";
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && state.me && state.me.username === data.user.username;
      if (isMe) return;

      var items = [
        { a: "tip",   i: "fa-money-bill-wave", l: "টিপ পাঠান" },
        { a: "gift",  i: "fa-gift",            l: "গিফট পাঠান" },
      ];
      if (data.user.is_professional) {
        items.push({ a: "shop", i: "fa-store",       l: "শপ দেখুন" });
        items.push({ a: "appt", i: "fa-calendar-check", l: "অ্যাপয়েন্টমেন্ট" });
      }

      items.forEach(function (it) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "sheet-menu-item";
        b.setAttribute("data-b9-act", it.a);
        b.innerHTML = '<i class="fa-solid ' + it.i + '"></i><span>' + it.l + '</span>';
        b.addEventListener("click", function () {
          var act = it.a;
          // close menu
          var open = document.querySelector("#profile-menu-sheet.show");
          if (open) { open.classList.remove("show");
            setTimeout(function(){ if (open.parentNode) open.parentNode.removeChild(open);
              document.body.classList.remove("sheet-open"); }, 180); }
          setTimeout(function () {
            var uname = data.user.username;
            var dname = data.user.display_name;
            if (act === "tip")   window._openTipSheet(uname, dname);
            if (act === "gift")  window._openGiftSheet(uname, dname);
            if (act === "shop")  window._openShopSheet(uname, dname, false);
            if (act === "appt")  window._openAppointmentSheet(uname, dname);
          }, 200);
        });
        panel.appendChild(b);
      });
    }, 55);
  }, true);

  // ============ Add "Boost" to own post menu ============
  var _origOpenPostMenuB9 = window.openPostMenu;
  if (typeof _origOpenPostMenuB9 === "function") {
    window.openPostMenu = function (btn, postEl, postId) {
      _origOpenPostMenuB9(btn, postEl, postId);
      setTimeout(function () {
        var menu = document.getElementById("post-menu-popup");
        if (!menu || menu.dataset.b9 === "1") return;
        menu.dataset.b9 = "1";
        var isOwn = window.state && state.me && btn.dataset.owner === state.me.username;
        if (!isOwn) return;
        var boost = document.createElement("button");
        boost.setAttribute("data-action", "boost");
        boost.innerHTML = '<i class="fa-solid fa-rocket"></i><span>বুস্ট</span>';
        var editBtn = menu.querySelector('button[data-action="edit"]');
        if (editBtn) menu.insertBefore(boost, editBtn);
        else menu.appendChild(boost);
        boost.addEventListener("click", function (ev) {
          ev.stopPropagation();
          if (typeof closePostMenu === "function") closePostMenu();
          setTimeout(function () { window._openBoostSheet(postId); }, 150);
        });
      }, 30);
    };
  }

  console.log("[Batch9] monetization UI ready");
})();


// ===== Batch 10 — subscription / verify / claim / misc =====
(function () {
  "use strict";
  if (window.__batch10) return;
  window.__batch10 = true;

  function _esc(s) {
    if (window.escapeHtml) return escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function _sheet(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var s = document.createElement("div");
    s.id = id; s.className = "sheet-root";
    s.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(s); document.body.classList.add("sheet-open");
    requestAnimationFrame(function(){ s.classList.add("show"); });
    function close(){ s.classList.remove("show");
      setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s);
        document.body.classList.remove("sheet-open"); }, 220); }
    s.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = s.querySelector(".sheet-close"); if (x) x.addEventListener("click", close);
    return { root: s, close: close };
  }
  function _modal(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var m = document.createElement("div");
    m.id = id; m.className = "modal";
    m.innerHTML = html;
    document.body.appendChild(m);
    return m;
  }

  // ============ 91. Subscribe tier sheet ============
  window._openSubscribeSheet = function (username, displayName) {
    var tiers = [
      { id: "basic",   name: "Basic",   price: 99,  icon: "fa-star",       perks: "প্রিমিয়াম পোস্ট + সাপ্তাহিক Q&A" },
      { id: "premium", name: "Premium", price: 299, icon: "fa-crown",      perks: "সব Basic + মাসিক লাইভ সেশন" },
      { id: "vip",     name: "VIP",     price: 999, icon: "fa-gem",        perks: "সব Premium + 1-on-1 ভিডিও কল" },
    ];
    var s = _sheet("b10-sub-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>⭐ সাবস্ক্রাইব — @' + _esc(username) + '</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 14px">' +
          '<div class="b10-sub-tiers">' +
            tiers.map(function(t){
              return '<button type="button" class="b10-tier" data-tier="' + t.id + '">' +
                '<span class="b10-tier-icon"><i class="fa-solid ' + t.icon + '"></i></span>' +
                '<span class="b10-tier-info">' +
                  '<span class="b10-tier-name">' + t.name + '</span>' +
                  '<span class="b10-tier-price">৳ ' + t.price + ' / মাস</span>' +
                  '<span class="b10-tier-perks">' + t.perks + '</span>' +
                '</span>' +
              '</button>';
            }).join("") +
          '</div>' +
          '<button class="btn-primary" id="b10-sub-confirm" style="width:100%;padding:14px;border-radius:12px;margin-top:14px" disabled>' +
            '<i class="fa-solid fa-check"></i> টায়ার নির্বাচন করুন' +
          '</button>' +
          '<p style="font-size:11.5px;color:var(--muted);text-align:center;margin-top:8px">' +
            '⚠️ পেমেন্ট গেটওয়ে শীঘ্রই আসছে' +
          '</p>' +
        '</div>' +
      '</div>');
    var selected = null;
    s.root.querySelectorAll(".b10-tier").forEach(function(b){
      b.addEventListener("click", function(){
        s.root.querySelectorAll(".b10-tier").forEach(function(x){ x.classList.remove("on"); });
        b.classList.add("on");
        selected = b.dataset.tier;
        var btn = s.root.querySelector("#b10-sub-confirm");
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> সাবস্ক্রাইব করুন';
      });
    });
    s.root.querySelector("#b10-sub-confirm").addEventListener("click", async function(){
      if (!selected) return;
      this.disabled = true;
      try {
        var r = await api("/api/users/" + encodeURIComponent(username) + "/subscribe", {
          method: "POST",
          body: JSON.stringify({ tier: selected })
        });
        s.close();
        if (typeof showToast === "function") showToast("⭐ " + r.tier + " টায়ারে সাবস্ক্রাইব — ৳ " + r.amount + "/মাস");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 92. Verify request ============
  window._openVerifySheet = function () {
    var s = _sheet("b10-verify-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>✓ Verified হতে আবেদন</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<p style="font-size:13px;color:var(--muted);margin-bottom:14px;line-height:1.5">' +
            'Blue check পেতে আপনার আসল পরিচয় যাচাই করা হবে। জাল তথ্য দিলে অ্যাকাউন্ট বন্ধ হতে পারে।' +
          '</p>' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px">পুরো নাম</label>' +
          '<input type="text" id="b10-vf-name" class="b9-price-input" style="font-size:14px;font-weight:600" placeholder="আসল নাম">' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;margin-top:6px">কেন verified হওয়া দরকার?</label>' +
          '<textarea id="b10-vf-reason" placeholder="যেমন: পাবলিক ফিগার, সাংবাদিক, ক্রিয়েটর..." maxlength="500" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:13.5px;color:var(--text);outline:none;' +
            'min-height:80px;resize:vertical;margin-bottom:14px"></textarea>' +
          '<button class="btn-primary" id="b10-vf-send" style="width:100%;padding:14px;border-radius:12px">' +
            '<i class="fa-solid fa-paper-plane"></i> আবেদন পাঠান' +
          '</button>' +
        '</div>' +
      '</div>');
    s.root.querySelector("#b10-vf-send").addEventListener("click", async function(){
      var name = s.root.querySelector("#b10-vf-name").value.trim();
      var reason = s.root.querySelector("#b10-vf-reason").value.trim();
      if (!name || !reason) return alert("সব তথ্য দিন");
      this.disabled = true;
      try {
        await api("/api/me/verify-request", {
          method: "POST",
          body: JSON.stringify({ full_name: name, reason: reason })
        });
        s.close();
        if (typeof showToast === "function") showToast("✅ আবেদন পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 93. Claim business ============
  window._openClaimBusiness = function () {
    var s = _sheet("b10-claim-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>🏢 Business ক্লেইম</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<p style="font-size:13px;color:var(--muted);margin-bottom:12px">' +
            'আপনি যদি এই business-এর মালিক হন, তথ্য দিয়ে ক্লেইম করুন।' +
          '</p>' +
          '<input type="text" id="b10-cl-name" class="b9-price-input" style="font-size:14px" placeholder="Business নাম">' +
          '<input type="email" id="b10-cl-email" class="b9-price-input" style="font-size:14px" placeholder="Contact email">' +
          '<textarea id="b10-cl-notes" placeholder="অতিরিক্ত তথ্য / ট্রেড লাইসেন্স নম্বর" maxlength="500" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:13.5px;color:var(--text);outline:none;' +
            'min-height:70px;resize:vertical;margin-bottom:14px"></textarea>' +
          '<button class="btn-primary" id="b10-cl-send" style="width:100%;padding:14px;border-radius:12px">' +
            '<i class="fa-solid fa-check"></i> ক্লেইম করুন' +
          '</button>' +
        '</div>' +
      '</div>');
    s.root.querySelector("#b10-cl-send").addEventListener("click", async function(){
      var name = s.root.querySelector("#b10-cl-name").value.trim();
      var email = s.root.querySelector("#b10-cl-email").value.trim();
      var notes = s.root.querySelector("#b10-cl-notes").value.trim();
      if (!name || !email) return alert("নাম ও ইমেইল দিন");
      this.disabled = true;
      try {
        await api("/api/me/claim-business", {
          method: "POST",
          body: JSON.stringify({ business_name: name, contact_email: email, notes: notes })
        });
        s.close();
        if (typeof showToast === "function") showToast("🏢 ক্লেইম অনুরোধ পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 94. Invite to group ============
  window._openInviteToGroup = async function (username) {
    try {
      var groups = await api("/api/groups");
      if (!groups.length) {
        if (typeof showToast === "function") showToast("আপনার কোনো গ্রুপ নেই — আগে একটি বানান");
        return;
      }
      var s = _sheet("b10-invite-sheet",
        '<div class="sheet-panel">' +
          '<div class="sheet-handle"></div>' +
          '<div class="sheet-header"><h3>👥 গ্রুপে যোগ করুন</h3>' +
          '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
          '<div class="sheet-body" style="padding:6px 12px">' +
            groups.map(function(g){
              return '<div class="b3-share-row" data-gid="' + g.id + '">' +
                '<div class="b3-share-icon" style="background:var(--gradient)">' +
                  '<i class="fa-solid fa-users"></i>' +
                '</div>' +
                '<div class="b3-share-label">' + _esc(g.name) +
                  '<div class="b3-share-sub">' + (g.member_count || 0) + ' জন সদস্য</div>' +
                '</div>' +
              '</div>';
            }).join("") +
          '</div>' +
        '</div>');
      s.root.querySelectorAll("[data-gid]").forEach(function(b){
        b.addEventListener("click", async function(){
          try {
            await api("/api/groups/invite-from-profile", {
              method: "POST",
              body: JSON.stringify({ group_id: parseInt(b.dataset.gid), username: username })
            });
            s.close();
            if (typeof showToast === "function") showToast("✅ গ্রুপে যোগ করা হয়েছে");
          } catch (err) { alert(err.message || "সমস্যা"); }
        });
      });
    } catch (err) { alert(err.message || "গ্রুপ লোড করা যায়নি"); }
  };

  // ============ 95. Send contact ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b10='send-contact']");
    if (!b) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    api("/api/users/" + encodeURIComponent(data.user.username) + "/send-contact", { method: "POST" })
      .then(function(){ if (typeof showToast === "function") showToast("📇 Contact পাঠানো হয়েছে"); })
      .catch(function(e){ alert(e.message); });
  }, true);

  // ============ 97. Suggest friend ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b10='suggest']");
    if (!b) return;
    e.preventDefault();
    (async function(){
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      try {
        var friends = await api("/api/me/suggested-friends");
        if (!friends.length) { if (typeof showToast === "function") showToast("কেউ নেই"); return; }
        var s = _sheet("b10-suggest-sheet",
          '<div class="sheet-panel">' +
            '<div class="sheet-handle"></div>' +
            '<div class="sheet-header"><h3>কে suggest করবেন?</h3>' +
            '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="sheet-body" style="padding:6px 12px">' +
              friends.map(function(u){
                var av = u.profile_pic ? '<img src="' + _esc(u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
                                       : _esc((u.display_name||"?").charAt(0).toUpperCase());
                return '<div class="b3-share-row" data-to="' + _esc(u.username) + '">' +
                  '<div class="b3-share-icon bg-dm" style="overflow:hidden">' + av + '</div>' +
                  '<div class="b3-share-label">' + _esc(u.display_name) +
                    '<div class="b3-share-sub">@' + _esc(u.username) + '</div></div>' +
                '</div>';
              }).join("") +
            '</div>' +
          '</div>');
        s.root.querySelectorAll("[data-to]").forEach(function(row){
          row.addEventListener("click", async function(){
            try {
              await api("/api/users/" + encodeURIComponent(data.user.username) + "/suggest", {
                method: "POST",
                body: JSON.stringify({ to: row.dataset.to })
              });
              s.close();
              if (typeof showToast === "function") showToast("💡 Suggest পাঠানো হয়েছে");
            } catch (err) { alert(err.message || "সমস্যা"); }
          });
        });
      } catch (err) { alert(err.message || "লোড করা যায়নি"); }
    })();
  }, true);

  // ============ 98. Report a problem ============
  window._openReportProblem = function () {
    var s = _sheet("b10-rp-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>🐞 সমস্যা জানান</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px">সমস্যার ধরন</label>' +
          '<select id="b10-rp-cat" class="b9-price-input" style="font-size:14px">' +
            '<option value="bug">🐞 Bug</option>' +
            '<option value="crash">💥 ক্র্যাশ</option>' +
            '<option value="performance">🐌 ধীরগতি</option>' +
            '<option value="ui">🎨 UI/UX</option>' +
            '<option value="payment">💳 পেমেন্ট</option>' +
            '<option value="other">অন্য কিছু</option>' +
          '</select>' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;margin-top:8px">সমস্যার বিবরণ</label>' +
          '<textarea id="b10-rp-msg" placeholder="বিস্তারিত লিখুন (কী করছিলেন, কী হয়েছিল)..." maxlength="1000" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:13.5px;color:var(--text);outline:none;' +
            'min-height:110px;resize:vertical;margin-bottom:14px"></textarea>' +
          '<button class="btn-primary" id="b10-rp-send" style="width:100%;padding:14px;border-radius:12px">' +
            '<i class="fa-solid fa-paper-plane"></i> পাঠান' +
          '</button>' +
        '</div>' +
      '</div>');
    s.root.querySelector("#b10-rp-send").addEventListener("click", async function(){
      var cat = s.root.querySelector("#b10-rp-cat").value;
      var msg = s.root.querySelector("#b10-rp-msg").value.trim();
      if (msg.length < 10) return alert("কমপক্ষে ১০ অক্ষর লিখুন");
      this.disabled = true;
      try {
        await api("/api/me/report-problem", {
          method: "POST",
          body: JSON.stringify({ category: cat, message: msg })
        });
        s.close();
        if (typeof showToast === "function") showToast("✅ সমস্যা রিপোর্ট হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 99. QR scan ============
  window._openQrScan = function () {
    var overlay = document.createElement("div");
    overlay.className = "b10-qr-overlay";
    overlay.innerHTML =
      '<div style="font-size:44px">📷</div>' +
      '<div class="b10-qr-hint">JUKTOY QR কোড স্ক্যান করুন</div>' +
      '<video id="b10-qr-video" playsinline></video>' +
      '<div class="b10-qr-actions">' +
        '<button id="b10-qr-cancel">বাতিল</button>' +
      '</div>';
    document.body.appendChild(overlay);

    var stream = null;
    (async function(){
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        var v = document.getElementById("b10-qr-video");
        if (v) { v.srcObject = stream; v.play().catch(function(){}); }
      } catch (e) {
        var hint = overlay.querySelector(".b10-qr-hint");
        if (hint) hint.textContent = "ক্যামেরা চালু করা যায়নি — অনুমতি দিন";
      }
    })();

    function close() {
      if (stream) stream.getTracks().forEach(function(t){ try{t.stop();}catch(e){} });
      overlay.remove();
    }
    document.getElementById("b10-qr-cancel").addEventListener("click", close);
  };

  // ============ Wire into profile ⋮ menu ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel || panel.dataset.b10 === "1") return;
      panel.dataset.b10 = "1";
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && state.me && state.me.username === data.user.username;

      if (isMe) {
        // own profile additions
        var items = [
          { a: "verify", i: "fa-circle-check",  l: "✓ Verified হতে আবেদন" },
          { a: "claim",  i: "fa-building",       l: "🏢 Business ক্লেইম" },
          { a: "report-problem", i: "fa-bug",    l: "🐞 সমস্যা জানান" },
          { a: "qr-scan",        i: "fa-qrcode", l: "📷 QR স্ক্যান" },
        ];
        items.forEach(function (it) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "sheet-menu-item";
          b.innerHTML = '<i class="fa-solid ' + it.i + '"></i><span>' + it.l + '</span>';
          b.addEventListener("click", function () {
            var open = document.querySelector("#profile-menu-sheet.show");
            if (open) { open.classList.remove("show");
              setTimeout(function(){ if (open.parentNode) open.parentNode.removeChild(open);
                document.body.classList.remove("sheet-open"); }, 180); }
            setTimeout(function () {
              if (it.a === "verify")         window._openVerifySheet();
              if (it.a === "claim")          window._openClaimBusiness();
              if (it.a === "report-problem") window._openReportProblem();
              if (it.a === "qr-scan")        window._openQrScan();
            }, 200);
          });
          panel.appendChild(b);
        });
      } else {
        // other's profile additions
        var items2 = [
          { a: "subscribe", i: "fa-star",           l: "⭐ সাবস্ক্রাইব" },
          { a: "invite",    i: "fa-user-plus",      l: "👥 গ্রুপে যোগ" },
          { a: "send-contact", i: "fa-address-card", l: "📇 Contact পাঠান" },
          { a: "suggest",   i: "fa-lightbulb",      l: "💡 Suggest a friend" },
        ];
        items2.forEach(function (it) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "sheet-menu-item";
          b.setAttribute("data-b10", it.a);
          b.innerHTML = '<i class="fa-solid ' + it.i + '"></i><span>' + it.l + '</span>';
          b.addEventListener("click", function () {
            var open = document.querySelector("#profile-menu-sheet.show");
            if (open) { open.classList.remove("show");
              setTimeout(function(){ if (open.parentNode) open.parentNode.removeChild(open);
                document.body.classList.remove("sheet-open"); }, 180); }
            setTimeout(function () {
              var u = data.user.username;
              var d = data.user.display_name;
              if (it.a === "subscribe")   window._openSubscribeSheet(u, d);
              if (it.a === "invite")      window._openInviteToGroup(u);
              if (it.a === "send-contact") {
                api("/api/users/" + encodeURIComponent(u) + "/send-contact", { method: "POST" })
                  .then(function(){ if (typeof showToast === "function") showToast("📇 Contact পাঠানো হয়েছে"); })
                  .catch(function(e){ alert(e.message); });
              }
              if (it.a === "suggest") {
                var tmp = document.createElement("button");
                tmp.setAttribute("data-b10", "suggest");
                tmp.style.display = "none";
                document.body.appendChild(tmp);
                tmp.click();
                tmp.remove();
              }
            }, 200);
          });
          panel.appendChild(b);
        });
      }
    }, 60);
  }, true);

  console.log("[Batch10] subscription / verify / claim / misc ready");
})();



// ═══════════════════════════════════════════════
// PROFILE HERO v1 — click handlers + CV modal
// ═══════════════════════════════════════════════
(function () {
  "use strict";
  if (window.__profileHeroV1) return;
  window.__profileHeroV1 = true;

  function _isOwnProfile() {
    var data = window._currentProfileData;
    return !!(data && data.user && window.state && state.me
      && data.user.username === state.me.username);
  }

  function _openEdit() {
    if (typeof openEditProfile === "function") openEditProfile();
  }

  // ---- Avatar click ----
  document.addEventListener("click", function (e) {
    var av = e.target.closest("#profile-page-avatar");
    if (!av || !_isOwnProfile()) return;
    if (e.target.closest("#avatar-edit-fab")) return;
    e.preventDefault(); e.stopPropagation();
    _openEdit();
  }, true);

  // ---- Avatar edit FAB ----
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("#avatar-edit-fab");
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    if (!_isOwnProfile()) return;
    _openEdit();
    setTimeout(function () {
      var inp = document.getElementById("avatar-input");
      if (inp) inp.click();
    }, 260);
  }, true);

  // ---- Cover click ----
  document.addEventListener("click", function (e) {
    var cov = e.target.closest("#profile-cover-clickable, .profile-cover");
    if (!cov || !_isOwnProfile()) return;
    if (e.target.closest("#cover-edit-fab")) return;
    e.preventDefault(); e.stopPropagation();
    _openEdit();
  }, true);

  // ---- Cover edit FAB ----
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("#cover-edit-fab");
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    if (!_isOwnProfile()) return;
    _openEdit();
    setTimeout(function () {
      var inp = document.getElementById("cover-input");
      if (inp) inp.click();
    }, 260);
  }, true);

  // ---- Name click ----
  document.addEventListener("click", function (e) {
    var nm = e.target.closest("#profile-page-name.profile-signature-name");
    if (!nm || !_isOwnProfile()) return;
    e.preventDefault(); e.stopPropagation();
    _openEdit();
  }, true);

  // ---- Bio click ----
  document.addEventListener("click", function (e) {
    var bio = e.target.closest("#profile-page-bio.profile-hero-bio");
    if (!bio || !_isOwnProfile()) return;
    e.preventDefault(); e.stopPropagation();
    _openEdit();
  }, true);

  // ---- More Info → CV modal ----
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("#profile-open-cv");
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    _openCVModal();
  }, true);

  function _openCVModal() {
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var u = data.user;

    var old = document.getElementById("cv-modal");
    if (old) old.remove();

    var joinedTxt = "—";
    try {
      var dt = new Date((u.created_at || "").replace(" ", "T") + "Z");
      var months = ["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন",
                    "জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"];
      var bn = function(n){ return String(n).replace(/[0-9]/g, function(x){ return "০১২৩৪৫৬৭৮৯"[x]; }); };
      joinedTxt = bn(dt.getDate()) + " " + months[dt.getMonth()] + " " + bn(dt.getFullYear());
    } catch (err) {}

    var stats = {
      posts: data.posts ? data.posts.length : 0,
      followers: data.followers_count || 0,
      following: data.following_count || 0,
    };

    var bannerPic = u.cover_pic
      ? '<img src="' + escapeHtml(u.cover_pic) + '" alt="" loading="lazy" decoding="async">'
      : '<div class="cv-banner-grad"></div>';
    var avatarPic = u.profile_pic
      ? '<img src="' + escapeHtml(u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
      : (u.display_name || "?").charAt(0).toUpperCase();

    var linksHTML = "";
    if (u.bio_links) {
      var links = u.bio_links.split("\n").map(function(x){return x.trim();}).filter(Boolean);
      if (links.length) {
        linksHTML = '<div class="cv-section">' +
          '<div class="cv-section-title"><i class="fa-solid fa-link"></i> লিংক</div>' +
          '<div class="cv-links">' +
            links.map(function(link){
              var display = link.replace(/^https?:\/\//, "").split("/")[0];
              var href = /^https?:\/\//.test(link) ? link : ("https://" + link);
              return '<a class="cv-link" href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' +
                '<i class="fa-solid fa-arrow-up-right-from-square"></i>' +
                '<span>' + escapeHtml(display) + '</span>' +
              '</a>';
            }).join("") +
          '</div>' +
        '</div>';
      }
    }

    var modal = document.createElement("div");
    modal.id = "cv-modal";
    modal.className = "modal";
    modal.style.zIndex = "99999";
    modal.innerHTML =
      '<div class="modal-content cv-modal-content">' +
        '<button class="close-btn" id="cv-close" type="button">×</button>' +
        '<div class="cv-banner">' + bannerPic + '</div>' +
        '<div class="cv-body">' +
          '<div class="cv-header-row">' +
            '<div class="cv-avatar">' + avatarPic + '</div>' +
            '<div class="cv-header-text">' +
              '<h2 class="cv-name">' + escapeHtml(u.display_name) + '</h2>' +
              '<p class="cv-uname">@' + escapeHtml(u.username) + '</p>' +
              (u.pronouns ? '<span class="cv-pronoun">' + escapeHtml(u.pronouns) + '</span>' : "") +
            '</div>' +
          '</div>' +
          '<div class="cv-quick-stats">' +
            '<div class="cv-stat"><strong>' + stats.posts + '</strong><span>পোস্ট</span></div>' +
            '<div class="cv-stat"><strong>' + stats.followers + '</strong><span>ফলোয়ার</span></div>' +
            '<div class="cv-stat"><strong>' + stats.following + '</strong><span>ফলোয়িং</span></div>' +
          '</div>' +
          (u.bio ?
            '<div class="cv-section">' +
              '<div class="cv-section-title"><i class="fa-solid fa-quote-left"></i> পরিচিতি</div>' +
              '<p class="cv-bio">' + escapeHtml(u.bio) + '</p>' +
            '</div>' : "") +
          '<div class="cv-grid">' +
            '<div class="cv-field"><i class="fa-solid fa-location-dot"></i><div><span>লোকেশন</span><strong>' + escapeHtml(u.location || "—") + '</strong></div></div>' +
            '<div class="cv-field"><i class="fa-solid fa-calendar"></i><div><span>যোগদান</span><strong>' + joinedTxt + '</strong></div></div>' +
            (u.category ? '<div class="cv-field"><i class="fa-solid fa-briefcase"></i><div><span>ক্যাটাগরি</span><strong>' + escapeHtml(u.category) + '</strong></div></div>' : "") +
          '</div>' +
          linksHTML +
          '<div class="cv-footer">' +
            '<button type="button" class="cv-btn-primary" id="cv-share">' +
              '<i class="fa-solid fa-share-nodes"></i> শেয়ার করুন' +
            '</button>' +
            '<button type="button" class="cv-btn-ghost" id="cv-close-2">বন্ধ করুন</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    function close() { modal.remove(); }
    document.getElementById("cv-close").onclick = close;
    document.getElementById("cv-close-2").onclick = close;
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

    var shareBtn = document.getElementById("cv-share");
    if (shareBtn) {
      shareBtn.onclick = function () {
        var url = window.location.origin + "/u/" + u.username;
        if (navigator.share) {
          navigator.share({ title: u.display_name, text: "JUKTOY প্রোফাইল", url: url }).catch(function(){});
        } else {
          navigator.clipboard.writeText(url).then(function () {
            if (typeof showToast === "function") showToast("🔗 লিংক কপি হয়েছে");
          });
        }
      };
    }
  }

  window._openCVModal = _openCVModal;
  console.log("[PROFILE HERO] v1 ready ✅");
})();


// ═══════════════════════════════════════════════
// S30.9 — Offline banner + network resilience
// ═══════════════════════════════════════════════
(function () {
  if (window.__offlineBanner) return;
  window.__offlineBanner = true;

  var banner = null;
  var hideTimer = null;

  function ensureBanner() {
    if (banner) return banner;
    banner = document.createElement("div");
    banner.id = "net-banner";
    banner.style.cssText = [
      "position:fixed",
      "top:0","left:0","right:0",
      "z-index:9999999",
      "background:linear-gradient(90deg,#dc2626,#ef4444)",
      "color:#fff",
      "font-family:inherit",
      "font-size:13px",
      "font-weight:700",
      "text-align:center",
      "padding:8px 16px",
      "transform:translateY(-100%)",
      "transition:transform .3s cubic-bezier(.34,1.56,.64,1)",
      "box-shadow:0 4px 16px rgba(0,0,0,.25)",
      "display:flex","align-items:center","justify-content:center","gap:8px",
      "pointer-events:none"
    ].join(";");
    banner.innerHTML = '<i class="fa-solid fa-wifi"></i><span>ইন্টারনেট সংযোগ নেই — আবার সংযোগ করুন</span>';
    document.body.appendChild(banner);
    return banner;
  }

  function showBanner(text, kind) {
    var b = ensureBanner();
    if (kind === "warn") {
      b.style.background = "linear-gradient(90deg,#d97706,#f59e0b)";
      b.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i><span>' + text + '</span>';
    } else if (kind === "ok") {
      b.style.background = "linear-gradient(90deg,#059669,#10b981)";
      b.innerHTML = '<i class="fa-solid fa-check-circle"></i><span>' + text + '</span>';
    } else {
      b.style.background = "linear-gradient(90deg,#dc2626,#ef4444)";
      b.innerHTML = '<i class="fa-solid fa-wifi"></i><span>' + text + '</span>';
    }
    b.style.transform = "translateY(0)";
    if (hideTimer) clearTimeout(hideTimer);
    if (kind === "ok") {
      hideTimer = setTimeout(hideBanner, 2200);
    }
  }

  function hideBanner() {
    if (!banner) return;
    banner.style.transform = "translateY(-100%)";
  }

  // Native offline/online events
  window.addEventListener("offline", function () {
    showBanner("ইন্টারনেট সংযোগ নেই", "error");
  });
  window.addEventListener("online", function () {
    showBanner("সংযোগ ফিরে এসেছে", "ok");
  });

  // Expose for api() to call
  window.__showNetBanner = showBanner;
  window.__hideNetBanner = hideBanner;

  // Initial state
  if (!navigator.onLine) showBanner("ইন্টারনেট সংযোগ নেই", "error");

  console.log("[OFFLINE_BANNER] ready");
})();


// ═══════════════════════════════════════════════
// S30.9 — wrap api() with 1 retry on network failure
// (only network throws, not 4xx/5xx — avoid double POST)
// ═══════════════════════════════════════════════
(function () {
  if (window.__apiRetry) return;
  window.__apiRetry = true;
  if (typeof window.api !== "function") return;

  var _origApi = window.api;

  window.api = async function (url, options) {
    var attempts = 0;
    var maxAttempts = 2;   // original + 1 retry
    var lastErr = null;

    while (attempts < maxAttempts) {
      try {
        return await _origApi(url, options);
      } catch (err) {
        lastErr = err;
        var msg = (err && err.message) || "";
        var isNetwork = /Failed to fetch|NetworkError|Load failed|ERR_NETWORK|ERR_INTERNET|Network request failed/i.test(msg);
        var isMethod = options && options.method ? options.method.toUpperCase() : "GET";
        var isSafe = (isMethod === "GET" || isMethod === "HEAD");

        if (!isNetwork || !isSafe) throw err;

        attempts++;
        if (attempts >= maxAttempts) throw err;

        try { if (window.__showNetBanner) window.__showNetBanner("পুনরায় চেষ্টা করা হচ্ছে...", "warn"); } catch (e) {}
        await new Promise(function (r) { setTimeout(r, 900); });
      }
    }
    throw lastErr || new Error("api failed");
  };

  console.log("[API_RETRY] ready");
})();


// ═══════════════════════════════════════════════
// S30.11 — Unified badge poller (was: 2×8s intervals)
// ═══════════════════════════════════════════════
(function () {
  if (window.__badgePoll) return;
  window.__badgePoll = true;

  var _timer = null;
  var _lastRun = 0;

  function tick() {
    try {
      var s = (typeof state !== "undefined" && state) || window.state;
      if (!s || !s.me) return;
      if (document.hidden) return;
      if (typeof updateUnreadBadge === "function") updateUnreadBadge().catch(function(){});
      if (typeof updateNotifBadge === "function") updateNotifBadge().catch(function(){});
      _lastRun = Date.now();
    } catch (e) {}
  }

  function start() {
    if (_timer) return;
    _timer = setInterval(tick, 10000);   // 10s (was 8s + 8s = 2 calls)
    setTimeout(tick, 200);               // immediate first tick
  }

  // visibility-aware — return to tab → immediate poll
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) setTimeout(tick, 300);
  });

  // start when user logs in
  if (typeof window._enterAppHooks !== "undefined" && Array.isArray(window._enterAppHooks)) {
    window._enterAppHooks.push(function () { start(); });
  } else {
    // retry fallback
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (typeof window._enterAppHooks !== "undefined" && Array.isArray(window._enterAppHooks)) {
        window._enterAppHooks.push(function () { start(); });
        clearInterval(t);
      } else if (tries > 20) {
        clearInterval(t);
        start();
      }
    }, 250);
  }

  console.log("[BADGE_POLL] ready (10s unified)");
})();


// ═══════════════════════════════════════════════
// S30.13 — image load state tracking
// ═══════════════════════════════════════════════
(function () {
  if (window.__imgStateTrack) return;
  window.__imgStateTrack = true;

  function markState(img) {
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      img.dataset.srcState = "loaded";
      return;
    }
    img.dataset.srcState = "loading";
  }

  // Mark all images (existing + future)
  function scan() {
    document.querySelectorAll('img[loading="lazy"]').forEach(function (img) {
      if (!img.dataset.srcState) markState(img);
      if (img.dataset.bound === "1") return;
      img.dataset.bound = "1";
      img.addEventListener("load", function () { img.dataset.srcState = "loaded"; });
      img.addEventListener("error", function () { img.dataset.srcState = "error"; });
    });
  }

  // observe DOM for new images
  try {
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  } catch (e) {}

  setInterval(scan, 800);
  scan();
  console.log("[IMG_STATE] ready");
})();

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


// ═══════════════════════════════════════════════
// S39 — Unified settings loader
// Replaces 7 separate wrapper functions with one.
// Runs after base openSettingsPage, then calls
// every loader in parallel.
// ═══════════════════════════════════════════════
(function () {
  if (window.__s39SettingsLoader) return;
  window.__s39SettingsLoader = true;

  var LOADERS = [
    "_loadBlockedUsers",
    "_loadMyReports",
    "_load2FAStatus",
    "_loadEmailStatus",
    "_loadSessions",
    "_loadLoginHistory",
    "_load2FAToggles"
  ];

  async function runAllLoaders() {
    var tasks = [];
    for (var i = 0; i < LOADERS.length; i++) {
      var name = LOADERS[i];
      var fn = window[name];
      if (typeof fn !== "function") continue;
      try {
        tasks.push(
          Promise.resolve(fn()).catch(function (e) {
            console.error("[S39 settings] " + name + " failed:", e);
          })
        );
      } catch (e) {
        console.error("[S39 settings] " + name + " threw:", e);
      }
    }
    await Promise.all(tasks);
  }

  var _origOpenSettings = window.openSettingsPage;
  if (typeof _origOpenSettings === "function") {
    window.openSettingsPage = async function () {
      await _origOpenSettings.apply(this, arguments);
      await runAllLoaders();
    };
  }

  console.log("[S39] unified settings loader ready");
})();
