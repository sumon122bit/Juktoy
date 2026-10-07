async function loadComments(postId, section) {
  // S32.1 — bail out if section is gone (sheet may have closed)
  if (!section) return;
  const list = section.querySelector(".comments-list");
  if (!list) return;
  _cmtSerial = 0;   // S32.2 — reset serial for this render
  list.innerHTML = '<p style="color:var(--muted);font-size:13px;padding:6px 0">লোড হচ্ছে...</p>';
  try {
    const comments = await api(`/api/posts/${postId}/comments`);
    if (window._s323CacheComments) window._s323CacheComments(postId, comments);
    if (!comments.length) {
      list.innerHTML = `<p style="color:var(--muted);font-size:14px;padding:6px 0">কোনো কমেন্ট নেই। প্রথম কমেন্ট আপনিই করুন!</p>`;
      return;
    }
    list.innerHTML = comments.map((c) => commentHTML(c, postId)).join("");
    bindCommentEvents(list, postId);
  } catch (err) {
    list.innerHTML = `<p style="color:var(--danger);font-size:13px;padding:6px 0">লোড করা যায়নি</p>`;
  }
}

const REPLIES_VISIBLE = 2; // কতটা reply ডিফল্টে দেখাবে

// S32.2 — comment serial counter + mention linkifier
let _cmtSerial = 0;

function _linkifyMentions(escaped) {
  // S32.4 — produce clickable mention links (no navigation until JS handler)
  return String(escaped).replace(
    /(^|[\s(])@([\w\u0980-\u09FF\u200c\u200d_]{1,50})/g,
    '$1<a class="mention" href="#" data-mention="$2">@$2</a>'
  );
}

function commentHTML(c, postId, isReply = false) {
  const _serial = ++_cmtSerial;   // S32.2 — sequential number
  const isMine = state.me && state.me.username === c.username;
  const liked = c.i_liked ? "liked" : "";
  const icon = c.i_liked ? "fa-solid" : "fa-regular";

  // S32.3 — flat replies + sheet-opener button
  const allReplies = c.replies || [];
  const replyCount = allReplies.length;

  let repliesHTML = "";
  if (replyCount > 0) {
    // Show inline only 0-1 reply. >=2 replies → show button instead.
    if (replyCount <= 1) {
      repliesHTML = `
        <div class="comment-replies flat">
          ${allReplies.map((r) => commentHTML(r, postId, true)).join("")}
        </div>`;
    } else {
      repliesHTML = `
        <button type="button" class="view-replies-btn"
                data-parent="${c.id}"
                data-post="${postId}">
          <i class="fa-solid fa-comment-dots"></i>
          ${replyCount} টি উত্তর দেখুন
        </button>`;
    }
  }

  return `
    <div class="comment ${isReply ? "is-reply" : ""}" data-cid="${c.id}">
      ${avatarHTML(c.display_name, c.profile_pic, "avatar")}
      <div class="comment-body">
        <div class="cname" data-user="${escapeHtml(c.username || '')}">${escapeHtml(c.display_name)}</div>
        <div class="ctext">${_linkifyMentions(escapeHtml(c.content))}</div>
        <div class="comment-actions">
          <button class="c-like-btn ${liked}" data-cid="${c.id}">
            <i class="${icon} fa-heart"></i>
            <span class="c-like-count">${c.likes || 0}</span>
          </button>
          <button class="c-reply-btn" data-cid="${c.id}" data-name="${escapeHtml(c.display_name)}">উত্তর</button>
          ${isMine ? `<button class="c-delete-btn" data-cid="${c.id}"><i class="fa-regular fa-trash-can"></i></button>` : ""}
        </div>
        <div class="c-reply-form hidden" data-cid="${c.id}">
          <input type="text" placeholder="${escapeHtml(c.display_name)} কে উত্তর দিন..." maxlength="500">
          <button class="c-reply-send" data-cid="${c.id}">পাঠান</button>
        </div>
        ${repliesHTML}
      </div>
    </div>
  `;
}

function bindCommentEvents(container, postId) {
  // Like
  container.querySelectorAll(".c-like-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const cid = btn.dataset.cid;
      const wasLiked = btn.classList.contains("liked");
      const countEl = btn.querySelector(".c-like-count");
      const icon = btn.querySelector("i");

      // Optimistic
      btn.classList.toggle("liked", !wasLiked);
      icon.className = `${!wasLiked ? "fa-solid" : "fa-regular"} fa-heart`;
      countEl.textContent = Math.max(0, parseInt(countEl.textContent) + (wasLiked ? -1 : 1));

      try {
        const res = await api(`/api/comments/${cid}/like`, { method: "POST" });
        btn.classList.toggle("liked", res.liked);
        icon.className = `${res.liked ? "fa-solid" : "fa-regular"} fa-heart`;
        countEl.textContent = res.likes;
      } catch (err) {
        // Rollback
        btn.classList.toggle("liked", wasLiked);
        icon.className = `${wasLiked ? "fa-solid" : "fa-regular"} fa-heart`;
        countEl.textContent = Math.max(0, parseInt(countEl.textContent) + (wasLiked ? 1 : -1));
      }
    });
  });

  // Reply toggle — S32.2 auto-prefill @mention
  container.querySelectorAll(".c-reply-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const cid = btn.dataset.cid;
      const name = btn.dataset.name || "";
      const form = container.querySelector(`.c-reply-form[data-cid="${cid}"]`);
      if (!form) return;
      const input = form.querySelector("input");
      const willOpen = form.classList.contains("hidden");
      if (willOpen && input && name) {
        // auto-prepend @name, remove existing leading @tag if any
        const tag = "@" + name + " ";
        const stripped = input.value.replace(/^@[^\s]+\s+/, "");
        input.value = tag + stripped;
      }
      form.classList.toggle("hidden");
      if (!form.classList.contains("hidden") && input) {
        input.focus();
        const len = input.value.length;
        try { input.setSelectionRange(len, len); } catch (err) {}
      }
    });
  });

  // Reply send
  container.querySelectorAll(".c-reply-send").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const cid = btn.dataset.cid;
      const form = container.querySelector(`.c-reply-form[data-cid="${cid}"]`);
      if (!form) return;  // S32.1b — sheet may have closed
      const input = form.querySelector("input");
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      btn.disabled = true;
      try {
        await api(`/api/posts/${postId}/comments`, {
          method: "POST",
          body: JSON.stringify({ content: text, parent_id: parseInt(cid) }),
        });
        input.value = "";
        form.classList.add("hidden");
        const section = container.closest(".comments-section");
        // S32.1 — in a sheet there's no .comments-section; reload sheet body
        if (section) {
          await loadComments(postId, section);
        } else {
          await _reloadSheetComments(postId);
        }
        // Update comment count on post
        const postEl = container.closest(".post");
        if (postEl) {
          const countSpan = postEl.querySelector(".comment-btn .comment-count");
          if (countSpan) countSpan.textContent = parseInt(countSpan.textContent || "0", 10) + 1;
        }
      } catch (err) {
        alert(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  // Load more replies
  container.querySelectorAll(".load-more-replies").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const parentId = btn.dataset.parent;
      const hiddenBlock = container.querySelector(`.comment-replies-hidden[data-parent="${parentId}"]`);
      if (!hiddenBlock) return;

      if (hiddenBlock.classList.contains("hidden")) {
        // Show all
        hiddenBlock.classList.remove("hidden");
        btn.innerHTML = `<i class="fa-solid fa-arrow-turn-up"></i> উত্তর লুকান`;
        // Animate in
        hiddenBlock.style.animation = "slideDown 0.3s ease";
      } else {
        hiddenBlock.classList.add("hidden");
        btn.innerHTML = `<i class="fa-solid fa-arrow-turn-down"></i> আরও ${btn.dataset.count}টি উত্তর দেখুন`;
      }
    });
  });

  // Delete
  container.querySelectorAll(".c-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("এই কমেন্টটা মুছবেন?")) return;
      const cid = btn.dataset.cid;
      try {
        await api(`/api/comments/${cid}`, { method: "DELETE" });
        const section = container.closest(".comments-section");
        // S32.1 — sheet context guard
        if (section) {
          await loadComments(postId, section);
        } else {
          await _reloadSheetComments(postId);
        }
        const postEl = container.closest(".post");
        if (postEl) {
          const countSpan = postEl.querySelector(".comment-btn .comment-count");
          if (countSpan) countSpan.textContent = Math.max(0, parseInt(countSpan.textContent || "0", 10) - 1);
        }
      } catch (err) {
        alert(err.message);
      }
    });
  });
}
