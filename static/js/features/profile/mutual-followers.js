// ==================================================
// MUTUAL FOLLOWERS MODAL
// ==================================================

export async function showMutualFollowers(username) {
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

// ---------- Temporary bridge ----------
window.showMutualFollowers = showMutualFollowers;
