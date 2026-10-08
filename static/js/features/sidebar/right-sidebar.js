// ==================================================

// Top "Create Post" button
const topCreateBtn = document.getElementById("top-create-post");
if (topCreateBtn) {
  topCreateBtn.addEventListener("click", () => {
    const postContent = document.getElementById("post-content");
    if (postContent) {
      postContent.focus();
      postContent.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}

// Top messages button
const topMessagesBtn = document.getElementById("top-messages-btn");
if (topMessagesBtn) {
  topMessagesBtn.addEventListener("click", function() { if (typeof window.openMessagesPage === "function") window.openMessagesPage(); });
}

// Mobile bottom nav
document.querySelectorAll(".mbn-item").forEach((btn) => {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".mbn-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    var target = btn.dataset.mbn;
    console.log("[MBNAV] clicked:", target);

    if (target === "home") {
      var av = document.getElementById("app-view");
      if (av) av.classList.remove("hidden");
      ["profile-page", "messages-page", "explore-page", "hashtag-page",
       "notifications-page", "saved-page", "reels-page", "story-viewer",
       "profile-modal"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.classList.add("hidden");
      });
      if (typeof window._PageStack !== "undefined") window._PageStack.length = 0;
      if (state.me && typeof loadFeed === "function") loadFeed();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (target === "explore") {
      var av2 = document.getElementById("app-view");
      if (av2) av2.classList.remove("hidden");
      if (typeof window.openExplorePage === "function") window.openExplorePage();
    } else if (target === "create") {
      var av3 = document.getElementById("app-view");
      if (av3) av3.classList.remove("hidden");
      var ta = document.getElementById("post-content");
      if (ta) {
        ta.focus();
        ta.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } else if (target === "reel") {
      console.log("[MBNAV] opening reels...");
      if (typeof openReelsPage === "function") {
        openReelsPage().catch(function (e) { console.error("Reels error:", e); });
      } else {
        console.error("[MBNAV] openReelsPage is not defined!");
      }
    } else if (target === "messages") {
      if (typeof window.openMessagesPage === "function") window.openMessagesPage();
    } else if (target === "notifications") {
      if (typeof openNotificationsPage === "function") openNotificationsPage();
    } else if (target === "profile" && state.me) {
      if (typeof window.openProfile === "function") window.openProfile(state.me.username);
    }
  });
});
// ==================================================
// RIGHT SIDEBAR — Profile / Suggestions / Online
// ==================================================

export async function loadRightSidebar() {
  if (!state.me) return;

  // Profile preview
  const rsAvatar = document.getElementById("rs-avatar");
  const rsName = document.getElementById("rs-name");
  const rsUser = document.getElementById("rs-username");
  const rsBio = document.getElementById("rs-bio");
  const rsPosts = document.getElementById("rs-posts");

  if (rsAvatar) setAvatar(rsAvatar, state.me.display_name, state.me.profile_pic);
  if (rsName) rsName.textContent = state.me.display_name;
  if (rsUser) rsUser.textContent = "@" + state.me.username;
  if (rsBio) rsBio.textContent = state.me.bio || "বায়ো নেই";

  try {
    const myProfile = await api("/api/users/" + state.me.username);
    if (rsPosts) rsPosts.textContent = myProfile.posts.length;
  } catch (e) {}

  // S18.9d — Load real trending topics
  try {
    const trending = await api("/api/explore/trending");
    const trendEl = document.getElementById("rs-trending");
    if (trendEl) {
      if (!trending || !trending.length) {
        trendEl.innerHTML = `<p style="color:var(--muted);font-size:13px;padding:8px 0">এখনো কোনো ট্রেন্ডিং নেই</p>`;
      } else {
        trendEl.innerHTML = trending
          .slice(0, 5)
          .map((t) => `
            <a href="#" class="trend-item" data-tag="${window.escapeHtml(t.tag)}">
              <span class="trend-tag">#${window.escapeHtml(t.tag)}</span>
              <span class="trend-count">${t.count} পোস্ট</span>
            </a>
          `)
          .join("");
        trendEl.querySelectorAll(".trend-item").forEach((el) => {
          el.addEventListener("click", (e) => {
            e.preventDefault();
            if (typeof openHashtag === "function") openHashtag(el.dataset.tag);
          });
        });
      }
    }
  } catch (err) {}

  // Suggestions + Online — use all users
  try {
    const users = await api("/api/users?q=");
    const others = users.filter((u) => u.username !== state.me.username).slice(0, 5);

    // Suggestions
    const sugg = document.getElementById("rs-suggestions");
    if (sugg) {
      if (!others.length) {
        sugg.innerHTML = `<p style="color:var(--muted);font-size:13px;padding:8px 0">কোনো সাজেশন নেই</p>`;
      } else {
        sugg.innerHTML = others
          .map((u) => `
            <div class="rs-suggest-item">
              <div class="rs-suggest-avatar" data-user="${window.escapeHtml(u.username)}">
                ${window.avatarInner(u.display_name, u.profile_pic)}
              </div>
              <div class="rs-suggest-info" data-user="${window.escapeHtml(u.username)}">
                <div class="rs-suggest-name">${window.escapeHtml(u.display_name)}</div>
                <div class="rs-suggest-meta">@${window.escapeHtml(u.username)}</div>
              </div>
              <button class="rs-follow-btn" data-user="${window.escapeHtml(u.username)}">ফলো</button>
            </div>
          `)
          .join("");

        sugg.querySelectorAll("[data-user]").forEach((el) => {
          if (el.classList.contains("rs-follow-btn")) {
            el.addEventListener("click", (e) => {
              e.stopPropagation();
              window.showToast("✅ ফলো করা হয়েছে!");
            });
          } else {
            el.addEventListener("click", () => window.openProfile(el.dataset.user));
          }
        });
      }
    }

    // S18.9b — Online contacts (real, based on last_seen < 5 min)
    const online = document.getElementById("rs-online");
    if (online) {
      try {
        const onlineUsers = await api("/api/users/online");
        if (!onlineUsers || !onlineUsers.length) {
          online.innerHTML = `<p style="color:var(--muted);font-size:13px;padding:8px 0">এখন কেউ অনলাইনে নেই</p>`;
        } else {
          online.innerHTML = onlineUsers
            .slice(0, 6)
            .map(
              (u) => `
          <div class="online-item" data-user="${window.escapeHtml(u.username)}">
            <div class="online-avatar">${window.avatarInner(u.display_name, u.profile_pic)}</div>
            <div class="online-name">${window.escapeHtml(u.display_name)}</div>
          </div>
        `
            )
            .join("");
          online.querySelectorAll(".online-item").forEach((el) => {
            el.addEventListener("click", () => window.openProfile(el.dataset.user));
          });
        }
      } catch (err) {
        online.innerHTML = `<p style="color:var(--muted);font-size:13px;padding:8px 0">লোড করা যায়নি</p>`;
      }
    }
  } catch (e) {}
}

window._enterAppHooks.push(() => loadRightSidebar());


// S19.3 — "সব দেখুন" → open first unseen story
(function () {
  document.addEventListener("click", function (e) {
    var link = e.target.closest(".stories-section .see-all");
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    // Find first unseen group
    var idx = -1;
    for (var i = 0; i < storyGroups.length; i++) {
      var g = storyGroups[i];
      if (g.user && state.me && g.user.username === state.me.username) continue;
      if (g.has_unseen) { idx = i; break; }
    }
    if (idx === -1) {
      // fallback: first non-self story
      for (var j = 0; j < storyGroups.length; j++) {
        if (storyGroups[j].user && state.me && storyGroups[j].user.username !== state.me.username) {
          idx = j; break;
        }
      }
    }
    if (idx !== -1) {
      if (typeof openStoryViewer === "function") openStoryViewer(idx, 0);
    } else {
      window.showToast("এখনো কোনো স্টোরি নেই");
    }
  }, true);
})();


// ==================================================

// ---------- Hook into window.enterApp ----------

window._enterAppHooks.push(() => loadStories());


// Load suggested users
export async function loadSuggestedUsers() {
  const el = document.getElementById("explore-users");
  if (!el) return;
  try {
    const users = await api("/api/explore/suggested-users");
    if (!users.length) {
      el.innerHTML = `<div class="explore-empty">
        <i class="fa-solid fa-user-plus"></i>
        <p>আপনি সবাইকে ফলো করে ফেলেছেন! 🎉</p>
      </div>`;
      return;
    }
    el.innerHTML = `<div class="explore-section-title"><i class="fa-solid fa-user-plus"></i> যাদের ফলো করতে পারেন</div>
      <div class="explore-users-grid">${users.map(userCardHTML).join("")}</div>`;

    el.querySelectorAll(".explore-user-card").forEach((card) => {
      const username = card.dataset.username;
      card.querySelector(".explore-user-avatar").addEventListener("click", () => window.openProfile(username));
      card.querySelector(".explore-user-name").addEventListener("click", () => window.openProfile(username));
      card.querySelector(".explore-user-follow").addEventListener("click", async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const res = await api("/api/users/" + encodeURIComponent(username) + "/follow", {
            method: "POST",
          });
          btn.classList.toggle("following", res.is_following);
          btn.innerHTML = res.is_following
            ? '<i class="fa-solid fa-check"></i> ফলো করছেন'
            : '<i class="fa-solid fa-user-plus"></i> ফলো করুন';
          window.showToast(res.is_following ? "✅ ফলো করা হয়েছে" : "আনফলো করা হয়েছে");
        } catch (err) {
          alert(err.message);
        } finally {
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="explore-empty"><p>লোড করা যায়নি</p></div>`;
  }
}

export function userCardHTML(u) {
  return `
    <div class="explore-user-card" data-username="${window.escapeHtml(u.username)}">
      <div class="explore-user-avatar">${window.avatarInner(u.display_name, u.profile_pic)}</div>
      <div class="explore-user-name">${window.escapeHtml(u.display_name)}</div>
      <div class="explore-user-username">@${window.escapeHtml(u.username)}</div>
      <div class="explore-user-stats">
        <span><strong>${u.followers || 0}</strong> ফলোয়ার</span>
        <span><strong>${u.posts_count || 0}</strong> পোস্ট</span>
      </div>
      <button class="explore-user-follow">
        <i class="fa-solid fa-user-plus"></i> ফলো করুন
      </button>
    </div>
  `;
}

// Hashtag page
export async function openHashtag(tag) {
  const page = document.getElementById("hashtag-page");
  if (!page) return;
  page.classList.remove("hidden");
  document.getElementById("hashtag-title").textContent = "#" + tag;
  const info = document.getElementById("hashtag-info");
  const postsEl = document.getElementById("hashtag-posts");
  info.innerHTML = `<p style="color:var(--muted)">লোড হচ্ছে...</p>`;
  postsEl.innerHTML = "";

  try {
    const data = await api("/api/hashtag/" + encodeURIComponent(tag));
    info.innerHTML = `
      <div class="hashtag-icon">#</div>
      <div class="hashtag-details">
        <h2>${window.escapeHtml(data.tag)}</h2>
        <p>${data.count} পোস্ট</p>
      </div>
    `;
    if (!data.posts.length) {
      postsEl.innerHTML = `<div class="explore-empty"><p>এই হ্যাশট্যাগে কোনো পোস্ট নেই।</p></div>`;
      return;
    }
    postsEl.innerHTML = `<div class="explore-section-title"><i class="fa-solid fa-hashtag"></i> পোস্টগুলো</div>` +
      `<div class="explore-posts-grid">${data.posts.map(explorePostHTML).join("")}</div>`;
    attachHashtagListeners(postsEl);
    postsEl.querySelectorAll(".explore-post-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.classList.contains("hashtag-link")) return;
        window.openProfile(card.dataset.user);
      });
    });
  } catch (err) {
    info.innerHTML = `<p style="color:var(--danger)">লোড করা যায়নি</p>`;
  }
}

// ---------- Temporary bridge ----------
window.loadRightSidebar = loadRightSidebar;
window.loadSuggestedUsers = loadSuggestedUsers;
window.userCardHTML = userCardHTML;
window.openHashtag = openHashtag;
