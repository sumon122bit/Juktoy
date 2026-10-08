// ==================================================
// FEED
// ==================================================

export async function loadFeed() {
  const list = document.getElementById("feed-list");
  if (!list) return;

  // S30.15 — dedup guard: if a load is already in flight, don't start another
  // (was: rapid nav or double mount would fire 2-3 parallel fetches)
  if (list.dataset.feedLoading === "1") return;

  list.dataset.feedLoading = "1";
  try {
    const posts = await api("/api/feed");

    if (!Array.isArray(posts)) {
      throw new Error("ফিডের তথ্য সঠিকভাবে পাওয়া যায়নি");
    }

    if (!posts.length) {
      list.innerHTML = `<div class="post" style="text-align:center;color:#94a3b8">
        এখনো কোনো পোস্ট নেই। প্রথম পোস্ট আপনিই করুন! ✨</div>`;
      return;
    }

    list.innerHTML = posts.map(postHTML).join("");

    if (window.__highlightNextPost) {
      const first = list.querySelector(".post");
      if (first) first.classList.add("just-created");
      window.__highlightNextPost = false;
    }

    bindPostEvents();
  } catch (err) {
    console.error("[JUKTOY] Feed load failed:", err);
    if (!list.children.length || list.querySelector(".feed-error")) {
      list.innerHTML = `<div class="post feed-error" style="text-align:center;color:var(--muted)">
        <div style="font-size:28px;margin-bottom:8px">⚠️</div>
        <div style="font-weight:700;color:var(--text);margin-bottom:5px">পোস্ট লোড করা যায়নি</div>
        <div style="font-size:13px;margin-bottom:12px">ইন্টারনেট/সার্ভার সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।</div>
        <button type="button" class="btn-secondary" id="feed-retry-btn">আবার চেষ্টা করুন</button>
      </div>`;
      document.getElementById("feed-retry-btn")?.addEventListener("click", () => loadFeed());
    }
  } finally {
    delete list.dataset.feedLoading;
  }
}

export function renderQuotedPost(p) {
  if (!p) return "";

  const username = p.username || "";
  const displayName = p.display_name || username || "ব্যবহারকারী";
  const media = Array.isArray(p.media) ? p.media : [];

  return `
    <div class="quoted-post" data-quote-user="${escapeHtml(username)}">
      <div class="quoted-header">
        <div class="quoted-avatar">
          ${avatarInner(displayName, p.profile_pic)}
        </div>
        <div>
          <div class="quoted-name">${escapeHtml(displayName)}</div>
          <div class="quoted-time">@${escapeHtml(username)}</div>
        </div>
      </div>
      ${p.content ? `<div class="quoted-content">${escapeHtml(p.content)}</div>` : ""}
      ${media.length ? `<div class="quoted-media">${media.slice(0, 1).map((src) => `<img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async">`).join("")}</div>` : ""}
    </div>
  `;
}

export function postHTML(p) {
  const isOwn = state.me && state.me.username === p.username;

  // ---- S31 — reactions stack ----
  const _counts = p.reaction_counts || {};
  const _order = ["like", "love", "haha", "wow", "sad", "angry"];
  const _top = _order.filter(function (r) { return _counts[r] > 0; }).slice(0, 3);
  const _emojiMap = { like: "👍", love: "❤️", haha: "😆", wow: "😮", sad: "😢", angry: "😡" };
  const _stackHTML = _top.length
    ? _top.map(function (r) {
        return '<span class="prs-emoji reaction-' + r + '" data-r="' + r + '">' + _emojiMap[r] + '</span>';
      }).join("")
    : '<span class="prs-emoji reaction-love">❤️</span>';

  const _likes = p.likes || 0;
  const _comments = p.comments || 0;
  const _shares = p.repost_count || 0;

  // S32.6 — compact number formatter
  function _fmtNum(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 1000000) {
      var k = n / 1000;
      return (k >= 10 ? Math.floor(k) : k.toFixed(1).replace(/\.0$/, "")) + "k";
    }
    var m = n / 1000000;
    return (m >= 10 ? Math.floor(m) : m.toFixed(1).replace(/\.0$/, "")) + "M";
  }
  function _fmtBn(n) {
    return String(Number(n) || 0).replace(/[0-9]/g, function (d) {
      return "০১২৩৪৫৬৭৮৯"[d];
    });
  }

  const summaryHTML = (p.likes > 0 || _comments > 0 || _shares > 0) ? `
    <div class="post-reaction-summary">
      <div class="prs-left">
        ${p.likes > 0 ? `<span class="prs-stack">${_stackHTML}</span>` : ""}
        ${p.likes > 0 ? `<span class="prs-count">${_fmtNum(_likes)}</span>` : ""}
      </div>
      <div class="prs-right">
        ${_comments > 0 ? `<span>${_fmtBn(_comments)} মন্তব্য</span>` : ""}
        ${(_comments > 0 && _shares > 0) ? '<span class="prs-sep">·</span>' : ""}
        ${_shares > 0 ? `<span>${_fmtBn(_shares)} শেয়ার</span>` : ""}
      </div>
    </div>
    <div class="post-actions-divider"></div>
  ` : "";

  // ---- action buttons with labels ----
  const likeLabel = p.my_reaction ? "রিঅ্যাক্ট" : "লাইক";
  const repostLabel = p.is_reposted ? "রিপোস্টেড" : "রিপোস্ট";

  return `
  <div class="post" data-id="${p.id}">
    <div class="post-header">
      ${avatarHTML(p.display_name, p.profile_pic, "avatar", p.username)}
      <div class="post-meta">
        <div class="name" data-user="${escapeHtml(p.username)}">${escapeHtml(p.display_name)}</div>
        <div class="time">${timeAgo(p.created_at)}</div>
      </div>
      <button class="post-menu-btn" data-id="${p.id}" data-owner="${escapeHtml(p.username)}" data-saved="${p.is_saved ? "1" : "0"}" data-reposted="${p.is_reposted ? "1" : "0"}" title="আরও অপশন">
        <i class="fa-solid fa-ellipsis"></i>
      </button>
    </div>
    ${p.edited_at ? '<div class="post-edited-mark">(সম্পাদিত)</div>' : ""}
    <div class="post-content-wrap">
      ${p.content ? (Array.from(p.content).length > 400
        ? `<div class="post-content truncate">${linkifyHashtags(_trunc(p.content, 400))}</div>
           <button class="post-see-more" data-expand="${p.id}">আরও দেখুন</button>`
        : `<div class="post-content">${linkifyHashtags(p.content)}</div>`) : ""}
    </div>
    ${renderCarousel(p.media)}
    ${p.quoted_post ? renderQuotedPost(p.quoted_post) : ""}
    ${summaryHTML}
    <div class="post-actions">
      <button class="action-btn like-btn" data-reaction="${p.my_reaction || ""}" data-id="${p.id}">
        ${renderReactionIcon(p.my_reaction)}
        <span>${likeLabel}</span>
        <span class="like-count">${p.likes}</span>
      </button>
      <button class="action-btn comment-btn">
        <i class="fa-regular fa-comment"></i>
        <span>মন্তব্য</span>
        <span class="comment-count">${p.comments}</span>
      </button>
      <button class="action-btn repost-btn" data-id="${p.id}" data-owner="${escapeHtml(p.username)}" data-reposted="${p.is_reposted ? "1" : "0"}">
        <i class="fa-solid fa-retweet"></i>
        <span>${repostLabel}</span>
        <span class="repost-count">${p.repost_count || 0}</span>
      </button>
      <button class="action-btn save-btn" data-id="${p.id}" data-saved="${p.is_saved ? "1" : "0"}">
        <i class="${p.is_saved ? "fa-solid" : "fa-regular"} fa-bookmark"></i>
        <span>সেভ</span>
      </button>
    </div>
    <div class="comments-section hidden">
      <div class="comments-list"></div>
      <form class="comment-form">
        <input type="text" placeholder="কমেন্ট লিখুন..." required>
        <button type="submit" class="btn-primary">পাঠান</button>
      </form>
    </div>
  </div>`;
}

export function bindPostEvents() {
  document.querySelectorAll(".post").forEach((post) => {
    const id = post.dataset.id;

    const commentBtn = post.querySelector(".comment-btn");
    if (commentBtn) {
      commentBtn.addEventListener("click", async () => {
        const sec = post.querySelector(".comments-section");
        if (!sec) return;
        sec.classList.toggle("hidden");
        if (!sec.classList.contains("hidden")) await loadComments(id, sec);
      });
    }

    const commentForm = post.querySelector(".comment-form");
    if (commentForm) {
      commentForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = e.target.querySelector("input");
        const text = input.value.trim();
        if (!text) return;
        try {
          await api(`/api/posts/${id}/comments`, {
            method: "POST",
            body: JSON.stringify({ content: text }),
          });
          input.value = "";
          await loadComments(id, post.querySelector(".comments-section"));
          const countSpan = post.querySelector(".comment-btn .comment-count");
          if (countSpan) countSpan.textContent = parseInt(countSpan.textContent || "0", 10) + 1;
        } catch (err) {
          alert(err.message);
        }
      });
    }

    const menuBtn = post.querySelector(".post-menu-btn");
    if (menuBtn) {
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openPostMenu(menuBtn, post, id);
      });
    }

    post.querySelectorAll("[data-user]").forEach((el) => {
      el.addEventListener("click", () => openProfile(el.dataset.user));
    });
  });
}

// ---------- Temporary bridge ----------
window.loadFeed = loadFeed;
window.renderQuotedPost = renderQuotedPost;
window.postHTML = postHTML;
window.bindPostEvents = bindPostEvents;
