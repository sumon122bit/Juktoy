// ==================================================
// POST BUTTON STATE SYNC — Bulletproof (polling)
// ==================================================

export function _syncPostBtnState() {
  const btn = document.getElementById("post-btn");
  const ta = document.getElementById("post-content");
  if (!btn || !ta) return;

  const hasText = ta.value.trim().length > 0;
  const hasImages = (typeof window._pendingImages !== "undefined" && window._pendingImages.length > 0);
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
  if (typeof window.openPostDetail === "function") {
    window.openPostDetail(parseInt(postId));
  } else {
    // fallback: expand inline via fetch
    (async function () {
      try {
        var data = await window.api("/api/posts/" + postId);
        if (!data || !data.post) return;
        var post = btn.closest(".post");
        if (!post) return;
        var wrap = post.querySelector(".post-content-wrap");
        if (!wrap) return;
        wrap.innerHTML = '<div class="post-content">' + window.linkifyHashtags(data.post.content) + '</div>';
        if (typeof window.attachHashtagListeners === "function") {
          window.attachHashtagListeners(wrap);
        }
      } catch (err) {}
    })();
  }
}, true);


// ==================================================
// S19.5 — POST DETAIL VIEW (click post → modal)
// ==================================================

export async function openPostDetail(postId) {
  if (!postId) return;
  try {
    var data = await window.api("/api/posts/" + postId);
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
              '<div class="pd-name">' + window.escapeHtml(p.display_name) + '</div>' +
              '<div class="pd-meta">@' + window.escapeHtml(p.username) + ' · ' + timeAgo(p.created_at) + '</div>' +
            '</div>' +
          '</div>' +
          (p.content ? '<div class="pd-text">' + window.linkifyHashtags(p.content) + '</div>' : '') +
          (Array.isArray(p.media) && p.media.length
            ? '<div class="pd-media">' + p.media.map(function (m) {
                return '<img src="' + window.escapeHtml(m) + '" alt="" loading="lazy">';
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
      if (typeof window.openProfile === "function") window.openProfile(p.username);
    });
    // Hashtags
    modal.querySelectorAll(".hashtag-link").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        modal.remove();
        if (typeof window.openHashtag === "function") window.openHashtag(el.dataset.tag);
      });
    });
  } catch (err) {
    if (typeof window.showToast === "function") window.showToast("পোস্ট লোড করা যায়নি");
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
  window.openPostDetail(parseInt(postId));
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
    var res = await window.api("/api/posts/" + postId + "/save", { method: "POST" });
    var isSaved = !!res.saved;
    btn.dataset.saved = isSaved ? "1" : "0";
    if (icon) {
      icon.className = (isSaved ? "fa-solid" : "fa-regular") + " fa-bookmark";
    }
    btn.classList.toggle("saved", isSaved);
    if (typeof window.showToast === "function") {
      window.showToast(isSaved ? "🔖 সেভ করা হয়েছে" : "সেভ সরানো হয়েছে");
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

// ---------- Temporary bridge ----------
window._syncPostBtnState = _syncPostBtnState;
window.openPostDetail = openPostDetail;
