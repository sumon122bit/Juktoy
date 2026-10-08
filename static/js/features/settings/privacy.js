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


