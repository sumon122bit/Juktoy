// ==================================================
// POST 3-DOT MENU
// ==================================================

let _postMenuOpenFor = null;

export function openPostMenu(btn, postEl, postId) {
  window.closePostMenu();
  if (_postMenuOpenFor === postId) {
    _postMenuOpenFor = null;
    return;
  }
  _postMenuOpenFor = postId;

  const isOwn = state.me && btn.dataset.owner === state.me.username;
  const isSaved = btn.dataset.saved === "1";
  const isReposted = btn.dataset.reposted === "1";

  const menu = document.createElement("div");
  menu.id = "post-menu-popup";
  menu.className = "post-menu-popup";

  let html = "";
  if (!isOwn) {
    html += `<button data-action="repost"><i class="fa-solid fa-retweet"></i><span>${isReposted ? "রিপোস্ট সরান" : "রিপোস্ট"}</span></button>`;
    html += `<button data-action="quote"><i class="fa-solid fa-quote-right"></i><span>কোট পোস্ট</span></button>`;
  }
  html += `<button data-action="save"><i class="${isSaved ? 'fa-solid' : 'fa-regular'} fa-bookmark"></i><span>${isSaved ? "সেভ সরান" : "সেভ"}</span></button>`;
  html += `<button data-action="share"><i class="fa-solid fa-share-nodes"></i><span>শেয়ার</span></button>`;
  html += `<button data-action="copy"><i class="fa-solid fa-link"></i><span>লিংক কপি</span></button>`;
  if (isOwn) {
    html += `<button data-action="edit"><i class="fa-solid fa-pen"></i><span>এডিট</span></button>`;
    html += `<button data-action="delete" class="danger"><i class="fa-regular fa-trash-can"></i><span>ডিলিট</span></button>`;
  } else {
    html += `<button data-action="report" class="danger"><i class="fa-solid fa-flag"></i><span>রিপোর্ট</span></button>`;
  }

  menu.innerHTML = html;
  document.body.appendChild(menu);

  // Position
  const rect = btn.getBoundingClientRect();
  const menuWidth = 220;
  const menuHeight = menu.offsetHeight || 320;
  let left = rect.right - menuWidth;
  let top = rect.bottom + 6;

  if (left < 10) left = 10;
  if (left + menuWidth > window.innerWidth - 10) left = window.innerWidth - menuWidth - 10;
  if (top + menuHeight > window.innerHeight - 10) top = Math.max(10, rect.top - menuHeight - 6);

  menu.style.left = left + "px";
  menu.style.top = top + "px";

  menu.querySelectorAll("button[data-action]").forEach((b) => {
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const action = b.dataset.action;
      window.closePostMenu();
      await window.handlePostMenuAction(action, btn, postEl, postId);
    });
  });

  setTimeout(() => {
    document.addEventListener("click", window._postMenuOutsideClick);
    // S18.9c — close on scroll/resize
    window.addEventListener("scroll", window.closePostMenu, { passive: true, once: true });
    window.addEventListener("resize", window.closePostMenu, { passive: true, once: true });
  }, 0);
}

export function closePostMenu() {
  const menu = document.getElementById("post-menu-popup");
  if (menu) menu.remove();
  document.removeEventListener("click", window._postMenuOutsideClick);
  window.removeEventListener("scroll", window.closePostMenu);
  window.removeEventListener("resize", window.closePostMenu);
  _postMenuOpenFor = null;
}

export function _postMenuOutsideClick(e) {
  const menu = document.getElementById("post-menu-popup");
  if (!menu) return;
  if (e.target.closest("#post-menu-popup")) return;
  if (e.target.closest(".post-menu-btn")) return;
  window.closePostMenu();
}

export async function handlePostMenuAction(action, btn, postEl, postId) {
  if (action === "repost") {
    try {
      const res = await api(`/api/posts/${postId}/repost`, { method: "POST" });
      btn.dataset.reposted = res.reposted ? "1" : "0";
      showToast(res.reposted ? "🔁 রিপোস্ট হয়েছে" : "রিপোস্ট সরানো হয়েছে");
      setTimeout(() => loadFeed(), 250);
    } catch (err) { alert(err.message); }
    return;
  }

  if (action === "quote") {
    if (typeof _openQuoteModal === "function") _openQuoteModal(postId);
    else showToast("কোট পোস্ট লোড হচ্ছে না");
    return;
  }

  if (action === "save") {
    const wasSaved = btn.dataset.saved === "1";
    try {
      const res = await api(`/api/posts/${postId}/save`, { method: "POST" });
      btn.dataset.saved = res.saved ? "1" : "0";
      showToast(res.saved ? "🔖 সেভ করা হয়েছে" : "সেভ সরানো হয়েছে");
    } catch (err) { alert(err.message); }
    return;
  }

  if (action === "share") {
    const content = postEl.querySelector(".post-content")?.textContent || "";
    const text = content + "\n\n— JUKTOY থেকে";
    try {
      if (navigator.share) await navigator.share({ title: "JUKTOY পোস্ট", text });
      else { await navigator.clipboard.writeText(text); showToast("📋 কপি করা হয়েছে"); }
    } catch (e) {}
    return;
  }

  if (action === "copy") {
    const url = window.location.origin + "/#" + postId;
    try {
      await navigator.clipboard.writeText(url);
      showToast("🔗 লিংক কপি হয়েছে");
    } catch (e) {}
    return;
  }

  if (action === "edit") {
    if (typeof window.enterEditMode === "function") window.enterEditMode(postEl, postId);
    return;
  }

  if (action === "delete") {
    if (!confirm("পোস্টটা ডিলিট করবেন?")) return;
    try {
      await api(`/api/posts/${postId}`, { method: "DELETE" });
      postEl.remove();
      showToast("🗑️ ডিলিট হয়েছে");
    } catch (err) { alert(err.message); }
    return;
  }

  if (action === "report") {
    openReportModal("post", postId, btn.dataset.owner || "");
    return;
  }
}


// ---------- Temporary bridge ----------
window.openPostMenu = openPostMenu;
window.closePostMenu = closePostMenu;
window.handlePostMenuAction = handlePostMenuAction;
window._postMenuOutsideClick = _postMenuOutsideClick;
