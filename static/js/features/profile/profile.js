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

export async function openProfile(username) {
  try {
    const data = await api("/api/users/" + encodeURIComponent(username));
    window._currentProfileData = data;
    const u = data.user;
    const isMe = window.state.me && window.state.me.username === u.username;

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
        if (typeof window._renderProfileCompletion === "function") window._renderProfileCompletion(u, data.posts ? data.posts.length : 0);
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
              ? '<img src="' + window.escapeHtml(m.profile_pic) + '" alt="" loading="lazy" decoding="async">'
              : initial(m.display_name)) +
            '</div>';
        }).join("");
        var names = preview.map(function (m) { return m.display_name; });
        var extra = data.mutual_count - preview.length;
        var text;
        if (names.length === 1) {
          text = '<strong>' + window.escapeHtml(names[0]) + '</strong> ফলো করেন';
        } else if (names.length === 2) {
          text = '<strong>' + window.escapeHtml(names[0]) + '</strong> এবং <strong>' + window.escapeHtml(names[1]) + '</strong> ফলো করেন';
        } else {
          text = '<strong>' + window.escapeHtml(names[0]) + '</strong>, <strong>' + window.escapeHtml(names[1]) + '</strong>';
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
      document.getElementById("btn-share-profile").onclick = function() { window.showToast("শীঘ্রই আসছে! ✨"); };
    } else {
      var _renderBtnHtml = function(flw) {
        var icon = flw ? "fa-user-check" : "fa-user-plus";
        var lbl = flw ? "ফলোয়িং" : "ফলো";
        var _h = '<button id="btn-follow" data-username="' + window.escapeHtml(u.username) + '" data-following="' + (flw ? "1" : "0") + '">' +
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
                if (typeof window.showToast === "function") {
                  window.showToast(nowFollowing ? "✅ ফলো করা হয়েছে" : "আনফলো করা হয়েছে");
                }
              })
              .catch(function(err) { alert(err.message); fb.disabled = false; });
          };
        }
        var mBtn = document.getElementById("btn-msg");
        if (mBtn) mBtn.onclick = function() {
          document.getElementById("profile-page").classList.add("hidden");
          window.openMessagesPage().then(function() { openChat(u.username); });
        };
        var wBtn = document.getElementById("btn-profile-wave");
        if (wBtn) wBtn.onclick = function() {
          api("/api/users/" + encodeURIComponent(u.username) + "/wave", { method: "POST" })
            .then(function() { window.showToast("👋 Wave পাঠানো হয়েছে"); })
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
          <div class="post-content">${window.escapeHtml(p.content)}</div>
          <div class="post-time"><i class="fa-regular fa-clock"></i> ${window.timeAgo(p.created_at)}</div>
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

export function setProfileCover(url) {
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

export function openEditProfile() {
  document.getElementById("edit-name").value = window.state.me.display_name || "";
  document.getElementById("edit-bio").value = window.state.me.bio || "";
  pendingAvatar = null;
  pendingCover = null;

  setAvatar(avatarPreview, window.state.me.display_name, window.state.me.profile_pic);

  if (coverPreview) {
    if (window.state.me.cover_pic) {
      coverPreview.innerHTML =
        `<img src="${window.escapeHtml(window.state.me.cover_pic)}" alt="Cover preview" loading="lazy" decoding="async">`;
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
      setAvatar(avatarPreview, window.state.me.display_name, pendingAvatar);
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
    setAvatar(avatarPreview, window.state.me.display_name, null);
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
          `<img src="${window.escapeHtml(pendingCover)}" alt="Cover preview" loading="lazy" decoding="async">`;
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
        window.state.me.profile_pic = res.avatar;
      }

      if (pendingCover !== null) {
        const res = await api("/api/me/cover", {
          method: "POST",
          body: JSON.stringify({ cover: pendingCover }),
        });
        window.state.me.cover_pic = res.cover;
      }

      const meRes = await api("/api/me");
      window.state.me = meRes.user;

      window.refreshProfileUI();
      await window.loadFeed();

      const profilePage = document.getElementById("profile-page");
      if (!profilePage.classList.contains("hidden")) {
        setAvatar(
          document.getElementById("profile-page-avatar"),
          window.state.me.display_name,
          window.state.me.profile_pic
        );

        setProfileCover(window.state.me.cover_pic);

        document.getElementById("profile-page-name").textContent = window.state.me.display_name;
        document.getElementById("profile-page-bio").textContent = window.state.me.bio || "বায়ো নেই";
        document.getElementById("about-bio").textContent = window.state.me.bio || "বায়ো নেই";
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

// ---------- Temporary bridge ----------
window.openProfile = openProfile;
window.setProfileCover = setProfileCover;
window.openEditProfile = openEditProfile;
