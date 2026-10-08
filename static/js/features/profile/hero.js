
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

