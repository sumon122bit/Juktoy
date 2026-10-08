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
        if (typeof window.openImageViewer === "function") {
          window.openImageViewer(cell.dataset.src);
        }
      });
    });
  }

  // Expose globally for onOpen usage
  window._renderProfilePhotos = _renderProfilePhotos;

  console.log("[Profile] photos tab handler attached ✅");
})();


