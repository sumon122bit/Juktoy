// ==================================================
// BLOCK SYSTEM
// ==================================================

export async function toggleBlock(e) {
  const btn = e.currentTarget;
  const username = btn.dataset.username;
  const isBlocked = btn.dataset.blocked === "1";

  if (!isBlocked) {
    if (!confirm("@" + username + " কে ব্লক করবেন?\n\nতিনি আপনার পোস্ট দেখতে পাবেন না, আপনি তার পোস্ট দেখবেন না, এবং কেউ কাউকে মেসেজ পাঠাতে পারবে না।")) return;
  }

  btn.disabled = true;
  try {
    const res = await api("/api/users/" + encodeURIComponent(username) + "/block", {
      method: "POST",
    });
    btn.dataset.blocked = res.blocked ? "1" : "0";
    btn.classList.toggle("blocked", res.blocked);
    btn.innerHTML = res.blocked
      ? '<i class="fa-solid fa-unlock"></i>'
      : '<i class="fa-solid fa-ban"></i>';
    btn.title = res.blocked ? "আনব্লক করুন" : "ব্লক করুন";

    // Show/hide follow + message
    const followBtn = document.getElementById("btn-follow");
    const msgBtn = document.getElementById("btn-msg");
    if (res.blocked) {
      followBtn?.classList.add("hidden");
      msgBtn?.classList.add("hidden");
    } else {
      followBtn?.classList.remove("hidden");
      msgBtn?.classList.remove("hidden");
    }

    showToast(res.blocked ? "🚫 ব্লক করা হয়েছে" : "✅ আনব্লক করা হয়েছে");
    // Refresh feed + conversations to exclude/include their content
    setTimeout(() => loadFeed(), 300);
    // S30.18 — refresh conversation list, close chat if blocking
    try {
      if (typeof loadConversations === "function") loadConversations();
      if (res.blocked && typeof window.currentChatUser !== "undefined" && window.currentChatUser === username) {
        if (typeof stopChatPolling === "function") stopChatPolling();
        var cw = document.getElementById("chat-window");
        if (cw) cw.classList.add("hidden");
        document.body.classList.remove("messages-chat-open");
        window.currentChatUser = null;
        window.lastMsgCount = 0;
      }
    } catch (e) {}
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

export async function loadBlockedUsers() {
  const list = document.getElementById("blocked-users-list");
  if (!list) return;
  try {
    const users = await api("/api/me/blocked-list");
    if (!users.length) {
      list.innerHTML = '<p class="empty-text" style="padding:12px 0">আপনি কাউকে ব্লক করেননি।</p>';
      return;
    }
    list.innerHTML = users.map((u) => `
      <div class="blocked-user-row" data-username="${escapeHtml(u.username)}">
        <div class="blocked-avatar">${avatarInner(u.display_name, u.profile_pic)}</div>
        <div class="blocked-info">
          <div class="blocked-name">${escapeHtml(u.display_name)}</div>
          <div class="blocked-username">@${escapeHtml(u.username)}</div>
        </div>
        <button class="btn-unblock" data-username="${escapeHtml(u.username)}">আনব্লক</button>
      </div>
    `).join("");

    list.querySelectorAll(".btn-unblock").forEach((b) => {
      b.addEventListener("click", async () => {
        const username = b.dataset.username;
        if (!confirm("@" + username + " কে আনব্লক করবেন?")) return;
        b.disabled = true;
        try {
          await api("/api/users/" + encodeURIComponent(username) + "/block", { method: "POST" });
          showToast("✅ আনব্লক করা হয়েছে");
          loadBlockedUsers();
        } catch (err) {
          alert(err.message);
          b.disabled = false;
        }
      });
    });
  } catch (err) {
    list.innerHTML = '<p class="empty-text" style="padding:12px 0">লোড করা যায়নি</p>';
  }
}

// Extend openSettingsPage to load blocked list
// S39 — exposed for unified loader
window._loadBlockedUsers = loadBlockedUsers;

// ---------- Additional bridge ----------
window.toggleBlock = toggleBlock;
