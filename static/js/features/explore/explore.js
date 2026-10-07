// ==================================================
// FOLLOW SYSTEM (frontend)
// ==================================================

async function toggleFollow(e) {
  const btn = e.currentTarget;
  const username = btn.dataset.username;
  const isFollowing = btn.dataset.following === "1";

  btn.disabled = true;
  try {
    const res = await api("/api/users/" + encodeURIComponent(username) + "/follow", {
      method: "POST",
    });

    btn.dataset.following = res.is_following ? "1" : "0";
    btn.classList.toggle("btn-follow", !res.is_following);
    const icon = res.is_following ? "fa-user-check" : "fa-user-plus";
    const label = res.is_following ? "আনফলো" : "ফলো করুন";
    btn.innerHTML = `<i class="fa-solid ${icon}"></i><span>${label}</span>`;

    const statEls = document.querySelectorAll(".profile-stats .stat-item .stat-num");
    if (statEls.length >= 3) statEls[1].textContent = res.followers;

    showToast(res.is_following ? "✅ ফলো করা হয়েছে" : "আনফলো করা হয়েছে");

    if (typeof loadStories === "function") loadStories();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function showFollowList(username, type) {
  try {
    const users = await api("/api/users/" + encodeURIComponent(username) + "/" + type);

    let modal = document.getElementById("follow-list-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "follow-list-modal";
      modal.className = "modal hidden";
      modal.innerHTML = `
        <div class="modal-content" style="max-width:400px">
          <button class="close-btn" id="close-follow-list">×</button>
          <h2 id="follow-list-title" style="margin-bottom:18px;font-size:18px"></h2>
          <div id="follow-list-items" style="max-height:400px;overflow-y:auto"></div>
        </div>
      `;
      document.body.appendChild(modal);
      document.getElementById("close-follow-list").onclick = () => modal.classList.add("hidden");
      modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.add("hidden");
      });
    }

    document.getElementById("follow-list-title").textContent =
      type === "followers" ? "👥 ফলোয়ার" : "👤 ফলোয়িং";

    const itemsEl = document.getElementById("follow-list-items");
    if (!users.length) {
      itemsEl.innerHTML = `<p style="color:var(--muted);text-align:center;padding:20px">কেউ নেই</p>`;
    } else {
      itemsEl.innerHTML = users
        .map(
          (u) => `
        <div class="new-chat-result" data-user="${escapeHtml(u.username)}">
          <div class="new-chat-avatar">${avatarInner(u.display_name, u.profile_pic)}</div>
          <div>
            <div style="font-weight:600">${escapeHtml(u.display_name)}</div>
            <div style="font-size:12px;color:var(--muted)">@${escapeHtml(u.username)}</div>
          </div>
        </div>
      `
        )
        .join("");
      itemsEl.querySelectorAll("[data-user]").forEach((el) => {
        el.addEventListener("click", () => {
          modal.classList.add("hidden");
          openProfile(el.dataset.user);
        });
      });
    }

    modal.classList.remove("hidden");
  } catch (err) {
    alert(err.message);
  }
}


// ==================================================
// EXPLORE + HASHTAG SYSTEM
// ==================================================

function linkifyHashtags(text) {
  // S30.15/30.27 — ReDoS cap + apostrophe-safe hashtag detection
  if (!text) return "";
  var s = String(text);
  if (s.length > 20000) s = s.slice(0, 20000);
  const escaped = escapeHtml(s);
  // S30.27 — require # to be preceded by whitespace/punctuation (NOT & from entity)
  // was: "#39" from &#39; was being treated as a hashtag → "it&#39;s" broke
  return escaped.replace(/(^|[\s\u00A0.,!?;:()\[\]"—–-])#([\w\u0980-\u09FF\u200c\u200d]{1,50})/g,
    function(match, prefix, tag) {
      return prefix + `<a href="#" class="hashtag-link" data-tag="${tag}">#${tag}</a>`;
    });
}

function attachHashtagListeners(container) {
  if (!container) return;
  container.querySelectorAll(".hashtag-link").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openHashtag(el.dataset.tag);
    });
  });
}

async function openExplorePage() {
  const page = document.getElementById("explore-page");
  if (!page) return;
  page.classList.remove("hidden");
  document.getElementById("explore-trending").classList.remove("hidden");
  document.getElementById("explore-posts").classList.add("hidden");
  document.getElementById("explore-users").classList.add("hidden");
  document.querySelectorAll(".explore-tab").forEach((t, i) => t.classList.toggle("active", i === 0));

  await loadTrendingTags();
  await loadTopPosts();
  await loadSuggestedUsers();
}

// Tabs
document.querySelectorAll(".explore-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".explore-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const name = tab.dataset.etab;
    ["trending", "posts", "users"].forEach((n) => {
      document.getElementById("explore-" + n).classList.toggle("hidden", n !== name);
    });
  });
});

// Back buttons


// Load trending tags
async function loadTrendingTags() {
  const el = document.getElementById("explore-trending");
  if (!el) return;
  try {
    const tags = await api("/api/explore/trending");
    if (!tags.length) {
      el.innerHTML = `<div class="explore-empty">
        <i class="fa-solid fa-fire"></i>
        <p>এখনো কোনো ট্রেন্ডিং হ্যাশট্যাগ নেই।<br>পোস্টে <strong>#হ্যাশট্যাগ</strong> দিয়ে শুরু করুন!</p>
      </div>`;
      return;
    }
    el.innerHTML = `<div class="explore-section-title"><i class="fa-solid fa-fire"></i> এই সপ্তাহে ট্রেন্ডিং</div>` +
      tags.map((t) => `
        <div class="tag-chip" data-tag="${escapeHtml(t.tag)}">
          <div class="tag-chip-icon">#</div>
          <div class="tag-chip-info">
            <div class="tag-chip-name">${escapeHtml(t.tag)}</div>
            <div class="tag-chip-count">${t.count} পোস্ট</div>
          </div>
        </div>
      `).join("");

    el.querySelectorAll(".tag-chip").forEach((chip) => {
      chip.addEventListener("click", () => openHashtag(chip.dataset.tag));
    });
  } catch (err) {
    el.innerHTML = `<div class="explore-empty"><p>লোড করা যায়নি</p></div>`;
  }
}

// Load top posts
async function loadTopPosts() {
  const el = document.getElementById("explore-posts");
  if (!el) return;
  try {
    const posts = await api("/api/explore/top-posts");
    if (!posts.length) {
      el.innerHTML = `<div class="explore-empty">
        <i class="fa-solid fa-image"></i>
        <p>এখনো কোনো টপ পোস্ট নেই।<br>অন্যরা লাইক করলে এখানে দেখা যাবে।</p>
      </div>`;
      return;
    }
    el.innerHTML = `<div class="explore-section-title"><i class="fa-solid fa-image"></i> টপ পোস্ট</div>
      <div class="explore-posts-grid">${posts.map(explorePostHTML).join("")}</div>`;
    attachHashtagListeners(el);
    el.querySelectorAll(".explore-post-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.classList.contains("hashtag-link")) return;
        openProfile(card.dataset.user);
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="explore-empty"><p>লোড করা যায়নি</p></div>`;
  }
}

function explorePostHTML(p) {
  return `
    <div class="explore-post-card" data-user="${escapeHtml(p.username)}">
      <div class="explore-post-head">
        <div class="avatar-sm">${avatarInner(p.display_name, p.profile_pic)}</div>
        <div class="explore-post-name">${escapeHtml(p.display_name)}</div>
      </div>
      <div class="explore-post-content">${linkifyHashtags(p.content)}</div>
      <div class="explore-post-footer">
        <span class="${p.liked ? "liked" : ""}">
          <i class="${p.liked ? "fa-solid" : "fa-regular"} fa-heart"></i> ${p.likes}
        </span>
        <span><i class="fa-regular fa-comment"></i> ${p.comments}</span>
      </div>
    </div>
  `;
}
