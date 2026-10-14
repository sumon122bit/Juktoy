// ==================================================
// REPOST + QUOTE SYSTEM — Frontend
// ==================================================

window._repostActiveBtn = null;
window._quoteTargetPostId = null;

// ---------- Repost menu (handlers below) ----------

export function _closeRepostMenu() {
  const menu = document.getElementById("repost-menu");
  if (menu) menu.classList.add("hidden");
  window._repostActiveBtn = null;
}

// ---------- Bulletproof Repost Handler (delegation) ----------

document.addEventListener("click", function (e) {
  // Case 1: click on repost button
  const btn = e.target.closest(".repost-btn");
  if (btn) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    const isOwn = state.me && btn.dataset.owner === state.me.username;
    if (isOwn) {
      window.showToast("ℹ️ নিজের পোস্ট রিপোস্ট করা যাবে না");
      return;
    }
    _openRepostMenu(btn);
    return;
  }

  // Case 2: click inside the repost menu → let menu handle it
  if (e.target.closest(".repost-menu")) {
    return;
  }

  // Case 3: click elsewhere → close menu
  _closeRepostMenu();
}, true);


export function _openRepostMenu(btn) {
  let menu = document.getElementById("repost-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "repost-menu";
    menu.className = "repost-menu hidden";
    menu.innerHTML = `
      <button class="repost-menu-item" data-action="repost">
        <i class="fa-solid fa-retweet"></i>
        <div>
          <div class="rmi-title">রিপোস্ট</div>
          <div class="rmi-sub">আপনার ফিডে শেয়ার করুন</div>
        </div>
      </button>
      <button class="repost-menu-item" data-action="quote">
        <i class="fa-solid fa-quote-right"></i>
        <div>
          <div class="rmi-title">কোট পোস্ট</div>
          <div class="rmi-sub">মন্তব্যসহ শেয়ার করুন</div>
        </div>
      </button>
    `;
    document.body.appendChild(menu);

    menu.querySelectorAll(".repost-menu-item").forEach((item) => {
      item.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();

        const action = this.dataset.action;
        const targetBtn = window._repostActiveBtn;
        const targetPostId = targetBtn ? targetBtn.dataset.id : null;

        // Hide menu
        menu.classList.add("hidden");
        window._repostActiveBtn = null;

        if (!targetPostId) return;

        if (action === "repost") {
          _doRepost(targetBtn);
        } else if (action === "quote") {
          _openQuoteModal(targetPostId);
        }
      });
    });
  }

  window._repostActiveBtn = btn;

  // Position menu above button
  const rect = btn.getBoundingClientRect();
  const menuWidth = 220;
  let left = rect.left;
  let top = rect.top - 10;

  if (left + menuWidth > window.innerWidth - 10) {
    left = window.innerWidth - menuWidth - 10;
  }
  if (left < 10) left = 10;

  menu.style.position = "fixed";
  menu.style.left = left + "px";
  menu.style.top = "auto";
  menu.style.bottom = (window.innerHeight - rect.top + 8) + "px";
  menu.style.width = menuWidth + "px";

  menu.classList.remove("hidden");
}

// ---------- Do repost ----------

export async function _doRepost(btn) {
  const postId = btn.dataset.id;
  if (!postId) return;

  const wasReposted = btn.dataset.reposted === "1";

  try {
    const res = await window.api(`/api/posts/${postId}/repost`, { method: "POST" });

    btn.dataset.reposted = res.reposted ? "1" : "0";
    btn.classList.toggle("reposted", res.reposted);

    const countEl = btn.querySelector(".repost-count");
    if (countEl) countEl.textContent = res.count;

    window.showToast(res.reposted ? "🔁 রিপোস্ট হয়েছে" : "রিপোস্ট সরানো হয়েছে");
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Quote modal ----------

export function _openQuoteModal(postId) {
  window._quoteTargetPostId = postId;

  let modal = document.getElementById("quote-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "quote-modal";
    modal.className = "modal hidden";
    modal.innerHTML = `
      <div class="modal-content" style="max-width:500px">
        <button class="close-btn" id="close-quote-modal">×</button>
        <h2 style="margin-bottom:18px;font-size:20px">✍️ কোট পোস্ট</h2>
        <div id="quote-preview" class="quote-preview"></div>
        <textarea id="quote-text" class="edit-bio-input" placeholder="আপনার মন্তব্য লিখুন..." maxlength="500" style="min-height:100px;margin-top:14px"></textarea>
        <div class="edit-actions">
          <button class="btn-secondary" id="cancel-quote">বাতিল</button>
          <button class="btn-primary" id="submit-quote" style="width:auto;padding:12px 28px">
            <i class="fa-solid fa-paper-plane"></i> পোস্ট করুন
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("close-quote-modal").addEventListener("click", _closeQuoteModal);
    document.getElementById("cancel-quote").addEventListener("click", _closeQuoteModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) _closeQuoteModal();
    });
    document.getElementById("submit-quote").addEventListener("click", _submitQuote);
  }

  // Load preview
  const preview = document.getElementById("quote-preview");
  preview.innerHTML = `<p style="color:var(--muted);text-align:center;padding:20px">লোড হচ্ছে...</p>`;

  window.api("/api/posts/" + postId + "/quote-preview")
    .then((data) => {
      if (data.post) {
        const p = data.post;
        preview.innerHTML = `
          <div class="quoted-post">
            <div class="quoted-header">
              <div class="quoted-avatar">${avatarInner(p.display_name, p.profile_pic)}</div>
              <div>
                <div class="quoted-name">${escapeHtml(p.display_name)}</div>
                <div class="quoted-time">@${escapeHtml(p.username)}</div>
              </div>
            </div>
            <div class="quoted-content">${escapeHtml(p.content || "").slice(0, 200)}</div>
          </div>
        `;
      }
    })
    .catch(() => {
      preview.innerHTML = `<p style="color:var(--muted);text-align:center;padding:20px">প্রিভিউ লোড করা যায়নি</p>`;
    });

  modal.classList.remove("hidden");
  document.getElementById("quote-text").focus();
}

export function _closeQuoteModal() {
  const modal = document.getElementById("quote-modal");
  if (modal) modal.classList.add("hidden");
  window._quoteTargetPostId = null;
  const txt = document.getElementById("quote-text");
  if (txt) txt.value = "";
}

export async function _submitQuote() {
  if (!window._quoteTargetPostId) return;

  const content = document.getElementById("quote-text").value.trim();
  if (!content) {
    window.showToast("মন্তব্য লিখুন");
    return;
  }

  const submitBtn = document.getElementById("submit-quote");
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

  try {
    await window.api(`/api/posts/${window._quoteTargetPostId}/quote`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    _closeQuoteModal();
    window.showToast("✅ কোট পোস্ট হয়েছে");
    window.__highlightNextPost = true;
    await window.loadFeed();
  } catch (err) {
    alert(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> পোস্ট করুন`;
  }
}

// ---------- Quoted post click → go to original author ----------

document.addEventListener("click", function (e) {
  const quoted = e.target.closest(".quoted-post");
  if (!quoted) return;
  e.stopPropagation();
  const username = quoted.dataset.quoteUser;
  if (username) window.openProfile(username);
});




// ---------- Temporary bridge ----------
window._closeRepostMenu = _closeRepostMenu;
window._openRepostMenu = _openRepostMenu;
window._openQuoteModal = _openQuoteModal;
window._closeQuoteModal = _closeQuoteModal;
window._submitQuote = _submitQuote;
