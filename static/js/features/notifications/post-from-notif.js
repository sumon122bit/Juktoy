// ==================================================
// POST VIEW FROM NOTIFICATION
// ==================================================

export async function openPostFromNotif(postId) {
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

// ---------- Temporary bridge ----------
window.openPostFromNotif = openPostFromNotif;
