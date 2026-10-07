async function openNotificationsPage() {
  const page = document.getElementById("notifications-page");
  if (!page) return;
  page.classList.remove("hidden");
  await loadNotifications();
  // NOTE: Don't auto-mark as read — individual notifications stay
  // unread until the user taps them (or uses "mark all" button).
}

async function loadNotifications() {
  const list = document.getElementById("notif-list");
  if (!list) return;
  list.innerHTML = `<p style="text-align:center;color:var(--muted);padding:40px 20px">লোড হচ্ছে...</p>`;

  try {
    const notifs = await api("/api/notifications");
    if (!notifs.length) {
      list.innerHTML = `<div class="notif-empty">
        <i class="fa-regular fa-bell"></i>
        <p>এখনো কোনো নোটিফিকেশন নেই।<br>কেউ লাইক, কমেন্ট বা ফলো করলে এখানে দেখা যাবে।</p>
      </div>`;
      return;
    }

    const groups = groupNotifications(notifs);
    list.innerHTML = groups.map((g) =>
      g.items.length === 1 ? notifHTML(g.items[0]) : notifGroupHTML(g)
    ).join("");

    // Individual notifications
    list.querySelectorAll(".notif-item:not(.notif-grouped)").forEach((item) => {
      item.addEventListener("click", async () => {
        const notifId = item.dataset.notifId;
        const actorUsername = item.dataset.actor;
        const postId = item.dataset.postId;
        const notifType = item.dataset.type;
        if (item.classList.contains("unread") && notifId) {
          try {
            await api(`/api/notifications/${notifId}/read`, { method: "POST" });
            item.classList.remove("unread");
            updateNotifBadge();
          } catch (e) {}
        }
        // Post-related notification → open post view
        if (postId && (notifType === "like" || notifType === "comment" ||
                       notifType === "comment_like" || notifType === "comment_reply" ||
                       notifType === "repost")) {
          openPostFromNotif(parseInt(postId));
        } else if (actorUsername) {
          document.getElementById("notifications-page").classList.add("hidden");
          openProfile(actorUsername);
        }
      });
    });

    // Grouped notifications
    list.querySelectorAll(".notif-grouped").forEach((item) => {
      item.addEventListener("click", async () => {
        const ids = (item.dataset.ids || "").split(",").filter(Boolean);
        const firstActor = item.dataset.firstActor;
        // Mark all as read
        if (item.classList.contains("unread")) {
          for (const nid of ids) {
            try {
              await api(`/api/notifications/${nid}/read`, { method: "POST" });
            } catch (e) {}
          }
          item.classList.remove("unread");
          updateNotifBadge();
        }
        document.getElementById("notifications-page").classList.add("hidden");
        if (firstActor) openProfile(firstActor);
      });
    });
  } catch (err) {
    list.innerHTML = `<div class="notif-empty"><p>লোড করা যায়নি</p></div>`;
  }
}

// ---------- Grouping logic ----------

function _notifGroupKey(n) {
  if (n.type === "like" && n.post_id) return "like:" + n.post_id;
  if (n.type === "repost" && n.post_id) return "repost:" + n.post_id;
  if (n.type === "comment_like" && n.post_id) return "clike:" + n.post_id;
  if (n.type === "follow") return "follow";
  return null; // comment, comment_reply — no grouping
}

function _notifTimeMs(n) {
  return new Date(String(n.created_at).replace(" ", "T") + "Z").getTime();
}

function groupNotifications(notifs) {
  const groups = [];
  const used = new Set();
  const WINDOW = 48 * 3600 * 1000;

  for (let i = 0; i < notifs.length; i++) {
    if (used.has(i)) continue;
    const n = notifs[i];
    const key = _notifGroupKey(n);

    if (!key) {
      groups.push({ type: n.type, items: [n] });
      used.add(i);
      continue;
    }

    const group = { type: n.type, items: [n], key };
    used.add(i);
    const baseTime = _notifTimeMs(n);

    for (let j = i + 1; j < notifs.length; j++) {
      if (used.has(j)) continue;
      const m = notifs[j];
      if (_notifGroupKey(m) !== key) continue;
      if (Math.abs(_notifTimeMs(m) - baseTime) > WINDOW) continue;
      group.items.push(m);
      used.add(j);
    }

    groups.push(group);
  }
  return groups;
}

// ---------- Group rendering ----------

function _notifAvatarMini(actorName, actorPic) {
  if (actorPic) return `<img src="${escapeHtml(actorPic)}" alt="" loading="lazy" decoding="async">`;
  return initial(actorName);
}

function _notifGroupAction(type) {
  if (type === "like") return "আপনার পোস্টে লাইক দিয়েছেন";
  if (type === "repost") return "আপনার পোস্ট রিপোস্ট করেছেন";
  if (type === "comment_like") return "আপনার কমেন্টে লাইক দিয়েছেন";
  if (type === "follow") return "আপনাকে ফলো করেছেন";
  return "নোটিফিকেশন";
}

function notifGroupHTML(g) {
  const items = g.items;
  const count = items.length;
  const action = _notifGroupAction(g.type);

  // Build name list
  const names = items.map((i) => i.actor_name);
  let nameText = "";
  if (count === 2) {
    nameText = `<strong>${escapeHtml(names[0])}</strong> এবং <strong>${escapeHtml(names[1])}</strong>`;
  } else {
    const others = count - 2;
    nameText = `<strong>${escapeHtml(names[0])}</strong>, <strong>${escapeHtml(names[1])}</strong> এবং <strong>আরও ${others} জন</strong>`;
  }

  // Stacked avatars — show up to 3, then "+N"
  let avatarsHTML = "";
  if (count <= 3) {
    avatarsHTML = items.slice(0, 3).map((i) =>
      `<div class="nas-av">${_notifAvatarMini(i.actor_name, i.actor_pic)}</div>`
    ).join("");
  } else {
    avatarsHTML = items.slice(0, 2).map((i) =>
      `<div class="nas-av">${_notifAvatarMini(i.actor_name, i.actor_pic)}</div>`
    ).join("") + `<div class="nas-av nas-more">+${count - 2}</div>`;
  }

  // Type icon
  let typeIcon = "fa-heart";
  if (g.type === "follow") typeIcon = "fa-user-plus";
  else if (g.type === "repost") typeIcon = "fa-retweet";
  else if (g.type === "comment_like") typeIcon = "fa-heart";

  // Unread: any item unread
  const hasUnread = items.some((i) => !i.is_read);
  const unreadClass = hasUnread ? "unread" : "";

  // Preview from first post
  const firstPost = items.find((i) => i.post_content);
  const preview = firstPost && firstPost.post_content
    ? `<div class="notif-preview">"${escapeHtml(firstPost.post_content.slice(0, 60))}${firstPost.post_content.length > 60 ? "..." : ""}"</div>`
    : "";

  // Time: use newest
  const newest = items.reduce((a, b) =>
    _notifTimeMs(a) > _notifTimeMs(b) ? a : b
  );

  // IDs + first actor for click
  const ids = items.map((i) => i.id).join(",");
  const firstActor = items[0].actor_username;

  return `
    <div class="notif-item notif-grouped ${unreadClass}"
         data-ids="${ids}"
         data-first-actor="${escapeHtml(firstActor)}">
      <div class="notif-avatars-stack">
        ${avatarsHTML}
        <div class="nas-type-icon ${g.type}">
          <i class="fa-solid ${typeIcon}"></i>
        </div>
      </div>
      <div class="notif-body">
        <div class="notif-text">
          ${nameText}
          <span class="notif-action">${action}</span>
        </div>
        ${preview}
        <div class="notif-time ${hasUnread ? "unread-time" : ""}">
          ${timeAgo(newest.created_at)}
        </div>
      </div>
    </div>
  `;
}

// ---------- (old loadNotifications end) ----------

function notifHTML(n) {
  const avatar = n.actor_pic
    ? `<img src="${escapeHtml(n.actor_pic)}" alt="" loading="lazy" decoding="async">`
    : initial(n.actor_name);

  let icon, action;
  if (n.type === "like") {
    icon = "fa-heart";
    action = "আপনার পোস্টে লাইক দিয়েছেন";
  } else if (n.type === "comment") {
    icon = "fa-comment";
    action = "আপনার পোস্টে কমেন্ট করেছেন";
  } else if (n.type === "comment_like") {
    icon = "fa-heart";
    action = "আপনার কমেন্টে লাইক দিয়েছেন";
  } else if (n.type === "comment_reply") {
    icon = "fa-reply";
    action = "আপনার কমেন্টে উত্তর দিয়েছেন";
  } else if (n.type === "story_reaction") {
    icon = "fa-heart";
    action = "আপনার স্টোরিতে রিঅ্যাকশন দিয়েছেন";
  } else if (n.type === "follow") {
    icon = "fa-user-plus";
    action = "আপনাকে ফলো করেছেন";
  } else {
    icon = "fa-bell";
    action = "নোটিফিকেশন";
  }

  const preview = n.post_content
    ? `<div class="notif-preview">"${escapeHtml(n.post_content.slice(0, 60))}${n.post_content.length > 60 ? "..." : ""}"</div>`
    : "";

  // S19.7 — Follow back button for follow notifications
  const followBackHTML = (n.type === "follow")
    ? `<button class="notif-followback-btn" data-followback="${escapeHtml(n.actor_username)}">
         <i class="fa-solid fa-user-plus"></i> ফলো ব্যাক
       </button>`
    : "";

  return `
    <div class="notif-item ${n.is_read ? "" : "unread"}"
         data-notif-id="${n.id}"
         data-type="${n.type}"
         data-actor="${escapeHtml(n.actor_username)}"
         data-post-id="${n.post_id || ""}">
      <div class="notif-avatar-wrap">
        <div class="notif-avatar">${avatar}</div>
        <div class="notif-type-icon ${n.type}">
          <i class="fa-solid ${icon}"></i>
        </div>
      </div>
      <div class="notif-body">
        <div class="notif-text">
          <strong>${escapeHtml(n.actor_name)}</strong>
          <span class="notif-action">${action}</span>
        </div>
        ${preview}
        <div class="notif-bottom-row">
          <div class="notif-time ${n.is_read ? "" : "unread-time"}">
            ${timeAgo(n.created_at)}
          </div>
          ${followBackHTML}
        </div>
      </div>
    </div>
  `;
}

async function updateNotifBadge() {
  try {
    const data = await api("/api/notifications/unread/count");
    const count = data.count || 0;

    // Sidebar nav badge
    const sidebarBadge = document.getElementById("notif-badge");
    if (sidebarBadge) {
      if (count > 0) {
        sidebarBadge.textContent = count > 99 ? "99+" : count;
        sidebarBadge.classList.remove("hidden");
      } else {
        sidebarBadge.classList.add("hidden");
      }
    }

    // Topbar small dot
    const topDot = document.getElementById("top-notif-dot");
    if (topDot) {
      if (count > 0) {
        topDot.textContent = count > 9 ? "9+" : count;
        topDot.classList.remove("hidden");
      } else {
        topDot.classList.add("hidden");
      }
    }

    // Mobile bottom nav badge
    const mbnBadge = document.getElementById("mbn-notif-badge");
    if (mbnBadge) {
      if (count > 0) {
        mbnBadge.textContent = count > 9 ? "9+" : count;
        mbnBadge.classList.remove("hidden");
      } else {
        mbnBadge.classList.add("hidden");
      }
    }
  } catch (e) {}
}

// Back button
const notifBackBtn = document.getElementById("notif-back");
if (notifBackBtn) {
  const fresh = notifBackBtn.cloneNode(true);
  notifBackBtn.parentNode.replaceChild(fresh, notifBackBtn);
  fresh.addEventListener("click", () => {
    if (_PageStack.length > 0) history.back();
    else document.getElementById("notifications-page")?.classList.add("hidden");
  });
}

// Mark all read button
const notifMarkAll = document.getElementById("notif-mark-all");
if (notifMarkAll) {
  notifMarkAll.addEventListener("click", async () => {
    try {
      await api("/api/notifications/read-all", { method: "POST" });
      document.querySelectorAll(".notif-item.unread").forEach((el) => {
        el.classList.remove("unread");
      });
      updateNotifBadge();
      showToast("✅ সব পড়া হয়েছে");
    } catch (e) {}
  });
}

// Wire topbar bell button
const topNotifBtn = document.getElementById("top-notif-btn");
if (topNotifBtn) {
  topNotifBtn.addEventListener("click", openNotificationsPage);
}

// Wrap openNotificationsPage for page stack
const _origOpenNotifPage = openNotificationsPage;
openNotificationsPage = async function () {
  await _origOpenNotifPage();
  const page = document.getElementById("notifications-page");
  if (page && !page.classList.contains("hidden")) {
    _pushPage("notifications");
  }
};

// Extend _closeTopPage for notifications
const _origCloseTopPage2 = _closeTopPage;
_closeTopPage = function () {
  const top = _PageStack[_PageStack.length - 1];
  if (top === "notifications") {
    _PageStack.pop();
    document.getElementById("notifications-page")?.classList.add("hidden");
    return true;
  }
  return _origCloseTopPage2();
};

// Extend nav handler for notifications
const _origNavNotif = document.querySelector('.nav-item[data-nav="notifications"]');
if (_origNavNotif) {
  _origNavNotif.addEventListener("click", (e) => {
    e.preventDefault();
    if (typeof closeSidebar === "function") closeSidebar();
    openNotificationsPage();
  });
}

// Poll unread count every 8s (in addition to messages)
// S30.11 - merged into _badgePoll below

// Initial call when entering app
_enterAppHooks.push(() => updateNotifBadge());

