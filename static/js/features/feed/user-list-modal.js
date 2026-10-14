// ==================================================
// LIKE LIST + STORY VIEWERS
// ==================================================

window._REACTION_EMOJI = {
  like: "👍", love: "❤️", haha: "😆",
  wow: "😮", sad: "😢", angry: "😡"
};

export function openUserListModal(title, users, emptyText) {
  const old = document.getElementById("user-list-modal");
  if (old) old.remove();

  const modal = document.createElement("div");
  modal.id = "user-list-modal";
  modal.className = "modal";

  let bodyHTML;
  if (!users.length) {
    bodyHTML = `<p class="user-list-empty">${window.escapeHtml(emptyText)}</p>`;
  } else {
    bodyHTML = users.map(function(u) {
      const reactionEmoji = u.reaction && window._REACTION_EMOJI[u.reaction]
        ? `<div class="user-list-reaction">${window._REACTION_EMOJI[u.reaction]}</div>` : "";
      return '<div class="user-list-item" data-username="' + window.escapeHtml(u.username) + '">' +
        '<div class="user-list-avatar">' + window.avatarInner(u.display_name, u.profile_pic) + '</div>' +
        '<div class="user-list-info">' +
          '<div class="user-list-name">' + window.escapeHtml(u.display_name) + '</div>' +
          '<div class="user-list-username">@' + window.escapeHtml(u.username) + '</div>' +
        '</div>' + reactionEmoji + '</div>';
    }).join("");
  }

  modal.innerHTML =
    '<div class="modal-content user-list-modal-content">' +
      '<div class="user-list-header">' +
        '<h3 class="user-list-title">' + window.escapeHtml(title) + '</h3>' +
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
      if (typeof window.openProfile === "function") window.openProfile(el.dataset.username);
    });
  });
}

export async function openLikesList(postId) {
  try {
    const users = await window.api("/api/posts/" + postId + "/likes");
    openUserListModal("লাইক দিয়েছেন", users, "এখনো কেউ লাইক দেয়নি");
  } catch (err) {
    window.showToast("লোড করা যায়নি");
  }
}

export async function openStoryViewers(storyId) {
  try {
    const users = await window.api("/api/stories/" + storyId + "/viewers");
    openUserListModal("স্টোরি দেখেছেন", users, "এখনো কেউ দেখেনি");
  } catch (err) {
    window.showToast("লোড করা যায়নি");
  }
}

// Event delegation — likes line + story views btn + comment avatars
document.addEventListener("click", function(e) {
  var likesLine = e.target.closest(".post-reaction-summary");
  if (likesLine) {
    e.preventDefault();
    e.stopPropagation();
    var _post = likesLine.closest(".post");
    var _pid = _post ? _post.dataset.id : null;
    if (_pid) openLikesList(parseInt(_pid));
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


// ---------- Temporary bridge ----------
window.openUserListModal = openUserListModal;
window.openLikesList = openLikesList;
window.openStoryViewers = openStoryViewers;
