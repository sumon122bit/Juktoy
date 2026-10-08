// ==================================================
// ONBOARDING FLOW
// ==================================================

let _obState = { step: 1, pendingAvatar: null, pendingCover: null, followed: new Set() };

export async function startOnboarding() {
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

  if (typeof window.refreshProfileUI === "function") window.refreshProfileUI();
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

// ---------- Temporary bridge ----------
window.startOnboarding = startOnboarding;
