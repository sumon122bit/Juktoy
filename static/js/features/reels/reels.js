// ==================================================
// REELS SYSTEM — TikTok-style
// ==================================================

let _reelsData = [];
let _currentReelIdx = 0;
let _reelObserver = null;
let _currentCommentReelId = null;

// ---------- Open Reels page ----------

async function openReelsPage() {
  const page = document.getElementById("reels-page");
  if (!page) return;
  page.classList.remove("hidden");
  // S21.3f — hide bottom nav while reels open (fullscreen)
  document.body.classList.add("reels-active");
  await loadReels();
  _pushPage("reels");
}

// ---------- Load all reels ----------

async function loadReels() {
  console.log("[REELS] loadReels() called");
  const feed = document.getElementById("reels-feed");
  const empty = document.getElementById("reels-empty");
  console.log("[REELS] feed=", !!feed, "empty=", !!empty);
  if (!feed || !empty) {
    console.error("[REELS] feed or empty element MISSING");
    return;
  }

  feed.innerHTML = '<div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:inherit;background:#000">' +
    '<div style="font-size:28px;margin-bottom:8px"><i class="fa-solid fa-spinner fa-spin"></i></div>' +
    '<div style="font-size:14px">লোড হচ্ছে...</div>' +
    '<div style="font-size:11px;opacity:0.5;margin-top:8px">API: /api/reels</div>' +
  '</div>';

  try {
    console.log("[REELS] fetching /api/reels ...");
    const reels = await api("/api/reels");
    console.log("[REELS] got", reels ? reels.length : 0, "reels");
    _reelsData = reels;

    if (!reels.length) {
      feed.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    feed.innerHTML = reels.map((r, i) => reelHTML(r, i)).join("");
    attachReelListeners();
    // S21.3e — attach progress to each video (guarded)
    feed.querySelectorAll(".reel-item").forEach(function (item) {
      var video = item.querySelector(".reel-video");
      if (video && typeof _attachReelProgress === "function") {
        try { _attachReelProgress(video, item); } catch (e) { console.warn("[REELS] progress attach:", e); }
      }
    });

    // Auto-play first reel
    setTimeout(() => {
      const firstVideo = feed.querySelector(".reel-video");
      if (firstVideo) firstVideo.play().catch(() => {});
    }, 400);

    // Setup intersection observer for auto-play
    setupReelObserver();
  } catch (err) {
    console.error("[REELS] load failed:", err, err && err.message, err && err.stack);
    var errMsg = (err && err.message) ? err.message : "unknown error";
    var errStack = (err && err.stack) ? err.stack : "";
    var fullErr = (err && String(err)) ? String(err) : "";
    feed.innerHTML = '<div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center;padding:24px;font-family:inherit;background:#000;overflow:auto">' +
      '<div style="font-size:22px;font-weight:800;margin-bottom:16px">রিল লোড করা যায়নি</div>' +
      '<div style="color:#ff8e8e;font-size:14px;margin-bottom:12px;max-width:90%;word-break:break-all">Error: ' + errMsg + '</div>' +
      '<div style="color:#ffb3b3;font-size:11px;max-width:90%;word-break:break-all;background:rgba(255,107,107,0.15);padding:12px;border-radius:8px;text-align:left;white-space:pre-wrap">' + errStack.slice(0, 500) + '</div>' +
      '<div style="color:#ffb3b3;font-size:11px;margin-top:12px;max-width:90%">Full: ' + fullErr.slice(0, 200) + '</div>' +
    '</div>';
  }
}

// ---------- Reel item HTML ----------

function reelHTML(r, idx) {
  const isOwn = state.me && state.me.username === r.username;
  const avatar = r.profile_pic
    ? `<img src="${escapeHtml(r.profile_pic)}" alt="" loading="lazy" decoding="async">`
    : initial(r.display_name);

  return `
    <div class="reel-item" data-idx="${idx}" data-id="${r.id}" data-user="${escapeHtml(r.username)}" data-own="${isOwn ? "1" : "0"}" data-saved="${r.is_saved ? "1" : "0"}">
      <video class="reel-video" src="${r.video}" loop playsinline preload="metadata" muted></video>

      <div class="reel-progress"><div class="reel-progress-fill"></div></div>

      <div class="reel-play-indicator">
        <i class="fa-solid fa-play"></i>
      </div>

      <div class="reel-flash"></div>
      <div class="reel-heart-ring"></div>
      <div class="reel-heart-burst">
        <i class="fa-solid fa-heart"></i>
      </div>

      <div class="reel-overlay">
        <div class="reel-user-row">
          <div class="reel-user-avatar">${avatar}</div>
          <div class="reel-user-info">
            <div class="reel-username">${escapeHtml(r.display_name)}</div>
            <div class="reel-time">${timeAgo(r.created_at)}</div>
          </div>
        </div>
        ${r.caption ? `<div class="reel-caption">${linkifyHashtags(r.caption)}</div>` : ""}
      </div>

      <div class="reel-side-rail">
        <button class="reel-toggle-actions" title="বাটন লুকান / দেখান" type="button">
          <i class="fa-solid fa-chevron-up"></i>
        </button>
        <div class="reel-actions">
          <button class="reel-action like-btn ${r.liked ? "liked" : ""}"
                  data-liked="${r.liked ? "1" : "0"}" type="button">
            <div class="reel-action-icon">
              <i class="${r.liked ? "fa-solid" : "fa-regular"} fa-heart"></i>
            </div>
            <span class="reel-action-label like-count">${r.likes}</span>
          </button>

          <button class="reel-action comment-btn" type="button">
            <div class="reel-action-icon">
              <i class="fa-regular fa-comment"></i>
            </div>
            <span class="reel-action-label">${r.comments}</span>
          </button>

          <button class="reel-action share-btn" type="button">
            <div class="reel-action-icon">
              <i class="fa-solid fa-share"></i>
            </div>
            <span class="reel-action-label">শেয়ার</span>
          </button>

          <button class="reel-action more-btn" title="আরও" type="button">
            <div class="reel-action-icon">
              <i class="fa-solid fa-ellipsis-vertical"></i>
            </div>
            <span class="reel-action-label">আরও</span>
          </button>
        </div>
      </div>
    </div>
  `;
}


// ---------- Reel toggle button (show/hide actions) ----------
document.addEventListener("click", function (e) {
  const btn = e.target.closest(".reel-toggle-actions");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const item = btn.closest(".reel-item");
  if (!item) return;
  item.classList.toggle("ui-hidden");
  if (navigator.vibrate) navigator.vibrate(8);
}, true);


// ---------- Premium double-tap heart effect ----------
function playReelHeart(item) {
  const burst = item.querySelector(".reel-heart-burst");
  const ring = item.querySelector(".reel-heart-ring");
  const flash = item.querySelector(".reel-flash");

  // Reset & play main heart
  if (burst) {
    burst.classList.remove("pop");
    void burst.offsetWidth;
    burst.classList.add("pop");
  }

  // Ring pulse
  if (ring) {
    ring.classList.remove("pop");
    void ring.offsetWidth;
    ring.classList.add("pop");
  }

  // Subtle screen flash
  if (flash) {
    flash.classList.remove("pop");
    void flash.offsetWidth;
    flash.classList.add("pop");
  }

  // Floating mini-hearts
  const flyCount = 6;
  for (let i = 0; i < flyCount; i++) {
    const fly = document.createElement("div");
    fly.className = "reel-heart-fly";
    fly.textContent = "❤️";

    // Start near center, slightly offset
    const startX = 50 + (Math.random() - 0.5) * 20;
    const startY = 50 + (Math.random() - 0.5) * 15;
    fly.style.left = startX + "%";
    fly.style.top = startY + "%";

    // End offset — spread outward + upward
    const angle = (-90 + (i - flyCount / 2) * 22) * (Math.PI / 180);
    const distance = 90 + Math.random() * 60;
    const fx = Math.cos(angle) * distance;
    const fy = Math.sin(angle) * distance - 40; // bias upward
    fly.style.setProperty("--fx", fx + "px");
    fly.style.setProperty("--fy", fy + "px");

    // Random delay + size
    fly.style.fontSize = (18 + Math.random() * 12) + "px";
    fly.style.animationDelay = (i * 45) + "ms";

    item.appendChild(fly);
    setTimeout(() => fly.remove(), 1800);
  }

  // Bump like icon + count
  item.classList.add("double-tapped");
  setTimeout(() => item.classList.remove("double-tapped"), 600);

  // Haptics
  if (navigator.vibrate) navigator.vibrate([12, 30, 12]);
}

// ---------- Reel more-menu (bottom sheet) ----------
function openReelMoreMenu(item) {
  const reelId = item.dataset.id;
  const isOwn = item.dataset.own === "1";
  const isSaved = item.dataset.saved === "1";
  const video = item.querySelector(".reel-video");
  const isMuted = video ? video.muted : true;

  const old = document.getElementById("reel-more-menu");
  if (old) old.remove();

  const menu = document.createElement("div");
  menu.id = "reel-more-menu";
  menu.className = "reel-more-menu";
  menu.innerHTML = `
    <div class="rmm-backdrop"></div>
    <div class="rmm-panel">
      <div class="rmm-handle"></div>
      <button class="rmm-item" data-act="mute">
        <i class="fa-solid ${isMuted ? "fa-volume-xmark" : "fa-volume-high"}"></i>
        <span>${isMuted ? "সাউন্ড চালু করুন" : "মিউট করুন"}</span>
      </button>
      <button class="rmm-item" data-act="save">
        <i class="${isSaved ? "fa-solid" : "fa-regular"} fa-bookmark"></i>
        <span>${isSaved ? "সেভ সরান" : "সেভ করুন"}</span>
      </button>
      <button class="rmm-item" data-act="copy">
        <i class="fa-solid fa-link"></i>
        <span>লিংক কপি করুন</span>
      </button>
      ${isOwn ? `
        <button class="rmm-item danger" data-act="delete">
          <i class="fa-regular fa-trash-can"></i>
          <span>রিল মুছুন</span>
        </button>
      ` : ""}
    </div>
  `;
  document.body.appendChild(menu);
  requestAnimationFrame(function () { menu.classList.add("show"); });

  function close() {
    menu.classList.remove("show");
    setTimeout(function () { menu.remove(); }, 260);
  }

  menu.querySelector(".rmm-backdrop").addEventListener("click", close);

  menu.querySelectorAll(".rmm-item").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      const act = btn.dataset.act;
      close();

      if (act === "mute") {
        if (video) {
          video.muted = !video.muted;
          showToast(video.muted ? "🔇 মিউট" : "🔊 সাউন্ড চালু");
        }
      } else if (act === "save") {
        try {
          const res = await api("/api/reels/" + reelId + "/save", { method: "POST" });
          item.dataset.saved = res.saved ? "1" : "0";
          showToast(res.saved ? "🔖 সেভ হয়েছে" : "সেভ সরানো হয়েছে");
        } catch (err) { alert(err.message); }
      } else if (act === "edit") {
        _openEditMessageModal(msgId, msgEl, text);
      } else if (act === "copy") {
        const url = window.location.origin + "/reel/" + reelId;
        try {
          await navigator.clipboard.writeText(url);
          showToast("🔗 লিংক কপি হয়েছে");
        } catch (err) {
          showToast("লিংক কপি করা যায়নি");
        }
      } else if (act === "delete") {
        if (!confirm("রিলটা মুছে ফেলবেন?")) return;
        try {
          await api("/api/reels/" + reelId, { method: "DELETE" });
          showToast("🗑️ রিল মুছে ফেলা হয়েছে");
          loadReels();
        } catch (err) { alert(err.message); }
      }
    });
  });
}

document.addEventListener("click", function (e) {
  const btn = e.target.closest(".reel-more-btn, .reel-action.more-btn");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const item = btn.closest(".reel-item");
  if (!item) return;
  openReelMoreMenu(item);
}, true);

// ---------- Attach events to each reel ----------

function attachReelListeners() {
  document.querySelectorAll(".reel-item").forEach((item) => {
    const id = item.dataset.id;
    const video = item.querySelector(".reel-video");
    const indicator = item.querySelector(".reel-play-indicator");
    const burst = item.querySelector(".reel-heart-burst");

    // Unified tap: single = pause/play, double = like
    let lastTap = 0;
    let tapTimeout = null;
    item.addEventListener("click", function (e) {
      if (e.target.closest(".reel-actions")) return;
      if (e.target.closest(".reel-side-rail")) return;
      if (e.target.closest(".reel-overlay")) return;

      const now = Date.now();
      const isDouble = (now - lastTap < 300);
      lastTap = now;

      if (isDouble) {
        if (tapTimeout) { clearTimeout(tapTimeout); tapTimeout = null; }
        const likeBtn = item.querySelector(".like-btn");
        if (likeBtn && likeBtn.dataset.liked !== "1") {
          likeBtn.click();
        }
        playReelHeart(item);
      } else {
        if (tapTimeout) clearTimeout(tapTimeout);
        tapTimeout = setTimeout(function () {
          togglePlayPause(video, indicator);
          tapTimeout = null;
        }, 280);
      }
    });

    // Like button
    const likeBtn = item.querySelector(".like-btn");
    if (likeBtn) {
      likeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const wasLiked = likeBtn.dataset.liked === "1";
        const nowLiked = !wasLiked;
        likeBtn.dataset.liked = nowLiked ? "1" : "0";
        likeBtn.classList.toggle("liked", nowLiked);
        const icon = likeBtn.querySelector(".reel-action-icon i");
        icon.className = `${nowLiked ? "fa-solid" : "fa-regular"} fa-heart`;
        const countEl = likeBtn.querySelector(".like-count");
        const newCount = parseInt(countEl.textContent) + (nowLiked ? 1 : -1);
        countEl.textContent = newCount;

        try {
          const res = await api(`/api/reels/${id}/like`, { method: "POST" });
          countEl.textContent = res.likes;
        } catch (err) {
          // Rollback
          likeBtn.dataset.liked = wasLiked ? "1" : "0";
          likeBtn.classList.toggle("liked", wasLiked);
          icon.className = `${wasLiked ? "fa-solid" : "fa-regular"} fa-heart`;
          countEl.textContent = parseInt(countEl.textContent) + (nowLiked ? -1 : 1);
        }
      });
    }

    // Comment button
    const commentBtn = item.querySelector(".comment-btn");
    if (commentBtn) {
      commentBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openReelComments(id);
      });
    }

    // Share button
    const shareBtn = item.querySelector(".share-btn");
    if (shareBtn) {
      shareBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const reel = _reelsData.find((r) => String(r.id) === String(id));
        if (!reel) return;
        const text = `${reel.display_name} এর রিল দেখুন — JUKTOY`;

        try {
          if (navigator.share) {
            await navigator.share({ title: "JUKTOY Reel", text });
          } else {
            await navigator.clipboard.writeText(text);
            showToast("📋 কপি করা হয়েছে");
          }
        } catch (err) {}
      });
    }

    // Delete (own reels)
    const delBtn = item.querySelector(".reel-delete");
    if (delBtn) {
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("রিলটা মুছে ফেলবেন?")) return;
        try {
          await api(`/api/reels/${id}`, { method: "DELETE" });
          showToast("🗑️ রিল মুছে ফেলা হয়েছে");
          loadReels();
        } catch (err) {
          alert(err.message);
        }
      });
    }

    // User avatar / name click
    item.querySelector(".reel-user-avatar").addEventListener("click", (e) => {
      e.stopPropagation();
      const username = item.dataset.user;
      closeReelsPage();
      setTimeout(() => openProfile(username), 200);
    });
    item.querySelector(".reel-username").addEventListener("click", (e) => {
      e.stopPropagation();
      const username = item.dataset.user;
      closeReelsPage();
      setTimeout(() => openProfile(username), 200);
    });

    // Hashtag links in caption
    attachHashtagListeners(item.querySelector(".reel-caption"));

    // Caption expand on click
    const caption = item.querySelector(".reel-caption");
    if (caption) {
      caption.addEventListener("click", (e) => {
        if (e.target.closest(".hashtag-link")) return;
        caption.classList.toggle("expanded");
      });
    }
  });

  // Observer for auto-play/pause
  setupReelObserver();
}

// ---------- Play/Pause ----------

function togglePlayPause(video, indicator) {
  if (video.paused) {
    video.play().catch(() => {});
    if (indicator) {
      indicator.querySelector("i").className = "fa-solid fa-play";
      indicator.classList.remove("show");
      void indicator.offsetWidth;
      indicator.classList.add("show");
    }
  } else {
    video.pause();
    if (indicator) {
      indicator.querySelector("i").className = "fa-solid fa-pause";
      indicator.classList.remove("show");
      void indicator.offsetWidth;
      indicator.classList.add("show");
    }
  }
}

// ---------- Intersection Observer: auto-play visible reel ----------

function setupReelObserver() {
  if (_reelObserver) _reelObserver.disconnect();

  const feed = document.getElementById("reels-feed");
  if (!feed) return;

  // S30.7 - track when each video left the viewport so we only reset
  // currentTime if it was gone for a while (was: reset on every partial scroll).
  var _outSince = {};

  _reelObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target.querySelector(".reel-video");
        if (!video) return;
        var idxKey = entry.target.dataset.idx;

        if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
          _currentReelIdx = parseInt(idxKey);
          // came back into view — clear the "out" marker
          delete _outSince[idxKey];

          video.muted = false;
          video.play().catch(() => {
            // S30.7 - autoplay blocked → mute and sync button state
            video.muted = true;
            video.play().catch(() => {});
            // sync mute button if present
            const item = video.closest(".reel-item");
            const muteBtn = item && item.querySelector(".reel-mute");
            if (muteBtn) {
              muteBtn.dataset.muted = "1";
              const mi = muteBtn.querySelector("i");
              if (mi) mi.className = "fa-solid fa-volume-xmark";
            }
          });
        } else {
          video.pause();
          // S30.7 - don't reset currentTime immediately.
          // Only reset if the video stays out of view for >1.5s.
          if (!_outSince[idxKey]) {
            _outSince[idxKey] = Date.now();
            setTimeout(function () {
              // still out of view after timeout? then reset
              if (_outSince[idxKey] &&
                  (Date.now() - _outSince[idxKey]) >= 1400) {
                // check if still not visible
                var r = entry.target.getBoundingClientRect();
                var h = window.innerHeight || 0;
                var visible = Math.max(0, Math.min(r.bottom, h) - Math.max(r.top, 0));
                var ratio = visible / Math.max(1, r.height);
                if (ratio < 0.5) {
                  try { video.currentTime = 0; } catch (e) {}
                }
                delete _outSince[idxKey];
              }
            }, 1500);
          }
        }
      });
    },
    {
      root: feed,
      threshold: [0, 0.6, 1],
    }
  );

  document.querySelectorAll(".reel-item").forEach((item) => {
    _reelObserver.observe(item);
  });
}

// ---------- Close Reels page ----------

function closeReelsPage() {
  // Pause all videos
  document.querySelectorAll(".reel-video").forEach((v) => {
    v.pause();
  });
  if (_reelObserver) _reelObserver.disconnect();
  const page = document.getElementById("reels-page");
  if (page) page.classList.add("hidden");
  // S21.3f — show bottom nav again
  document.body.classList.remove("reels-active");
}

// ---------- Reel Comments Sheet ----------

async function openReelComments(reelId) {
  _currentCommentReelId = reelId;
  const sheet = document.getElementById("reel-comments-sheet");
  if (!sheet) return;
  sheet.classList.remove("hidden");
  await loadReelComments(reelId);
}

async function loadReelComments(reelId) {
  const list = document.getElementById("rcs-list");
  if (!list) return;
  list.innerHTML = `<p style="text-align:center;color:var(--muted);padding:20px">লোড হচ্ছে...</p>`;

  try {
    const comments = await api(`/api/reels/${reelId}/comments`);
    if (!comments.length) {
      list.innerHTML = `<div class="rcs-empty">
        এখনো কোনো মন্তব্য নেই।<br>প্রথম মন্তব্যটি আপনিই করুন!
      </div>`;
      return;
    }
    list.innerHTML = comments.map((c) => `
      <div class="comment">
        ${avatarHTML(c.display_name, c.profile_pic, "avatar")}
        <div class="comment-body">
          <div class="cname">${escapeHtml(c.display_name)}</div>
          <div class="ctext">${escapeHtml(c.content)}</div>
        </div>
      </div>
    `).join("");
  } catch (err) {
    list.innerHTML = `<div class="rcs-empty">লোড করা যায়নি</div>`;
  }
}

// Comment form
const rcsForm = document.getElementById("rcs-form");
if (rcsForm) {
  rcsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("rcs-input");
    const content = input.value.trim();
    if (!content || !_currentCommentReelId) return;

    const sendBtn = rcsForm.querySelector(".rcs-send");
    sendBtn.disabled = true;
    try {
      await api(`/api/reels/${_currentCommentReelId}/comments`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      input.value = "";
      await loadReelComments(_currentCommentReelId);
      // Update comment count in reel item
      const item = document.querySelector(`.reel-item[data-id="${_currentCommentReelId}"]`);
      if (item) {
        const countEl = item.querySelector(".comment-btn .reel-action-label");
        if (countEl) countEl.textContent = parseInt(countEl.textContent) + 1;
      }
    } catch (err) {
      alert(err.message);
    } finally {
      sendBtn.disabled = false;
    }
  });
}

// Close comment sheet
document.querySelector("#reel-comments-sheet .rcs-backdrop")?.addEventListener("click", () => {
  document.getElementById("reel-comments-sheet").classList.add("hidden");
  _currentCommentReelId = null;
});

// ---------- Reel Upload ----------

let _pendingReelVideo = null;

const reelFileInput = document.getElementById("reel-file-input");
const reelUploadEmpty = document.getElementById("reel-upload-empty");
const reelUploadPreview = document.getElementById("reel-upload-preview");
const reelPreviewVideo = document.getElementById("reel-preview-video");
const publishReelBtn = document.getElementById("publish-reel");
const reelUploadModal = document.getElementById("reel-upload-modal");

document.getElementById("btn-choose-reel")?.addEventListener("click", () => reelFileInput?.click());
document.getElementById("reels-upload-btn")?.addEventListener("click", openReelUpload);
document.getElementById("reels-empty-upload")?.addEventListener("click", openReelUpload);

function openReelUpload() {
  resetReelUpload();
  reelUploadModal.classList.remove("hidden");
}

if (reelFileInput) {
  reelFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      alert("শুধু ভিডিও আপলোড করা যাবে");
      return;
    }
    if (file.size > 5_500_000) {
      alert("ভিডিও ৫ MB এর কম হতে হবে");
      return;
    }
    try {
      const dataUri = await readFileAsDataURL(file);
      _pendingReelVideo = dataUri;
      reelPreviewVideo.src = dataUri;
      reelUploadEmpty.classList.add("hidden");
      reelUploadPreview.classList.remove("hidden");
      publishReelBtn.disabled = false;
    } catch (err) {
      alert("ভিডিও লোড করা যায়নি");
    }
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById("cancel-reel-upload")?.addEventListener("click", resetReelUpload);
document.getElementById("close-reel-upload")?.addEventListener("click", resetReelUpload);
reelUploadModal?.addEventListener("click", (e) => {
  if (e.target === reelUploadModal) resetReelUpload();
});

function resetReelUpload() {
  _pendingReelVideo = null;
  if (reelFileInput) reelFileInput.value = "";
  if (reelUploadEmpty) reelUploadEmpty.classList.remove("hidden");
  if (reelUploadPreview) reelUploadPreview.classList.add("hidden");
  if (reelPreviewVideo) {
    reelPreviewVideo.pause();
    reelPreviewVideo.src = "";
  }
  const cap = document.getElementById("reel-caption");
  if (cap) cap.value = "";
  if (publishReelBtn) {
    publishReelBtn.disabled = true;
    publishReelBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> পোস্ট করুন';
  }
  if (reelUploadModal) reelUploadModal.classList.add("hidden");
}

if (publishReelBtn) {
  publishReelBtn.addEventListener("click", async () => {
    if (!_pendingReelVideo) return;
    const caption = (document.getElementById("reel-caption").value || "").trim();
    publishReelBtn.disabled = true;
    publishReelBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> পোস্ট হচ্ছে...`;

    try {
      await api("/api/reels", {
        method: "POST",
        body: JSON.stringify({ video: _pendingReelVideo, caption }),
      });
      resetReelUpload();
      showToast("🎬 রিল পোস্ট হয়েছে!");
      await loadReels();
    } catch (err) {
      alert(err.message);
      publishReelBtn.disabled = false;
      publishReelBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> পোস্ট করুন`;
    }
  });
}

// ---------- Wire bottom nav "reel" button ----------

// Remove existing listener by cloning
document.querySelectorAll('.mbn-item[data-mbn="reel"]').forEach((btn) => {
  const fresh = btn.cloneNode(true);
  btn.parentNode.replaceChild(fresh, btn);
  fresh.addEventListener("click", () => {
    document.querySelectorAll(".mbn-item").forEach((b) => b.classList.remove("active"));
    fresh.classList.add("active");
    openReelsPage();
  });
});

// ---------- Back button ----------

const reelsBackBtn = document.getElementById("reels-back");
if (reelsBackBtn) {
  reelsBackBtn.addEventListener("click", () => {
    if (_PageStack.length > 0 && _PageStack[_PageStack.length - 1] === "reels") {
      history.back();
    } else {
      closeReelsPage();
    }
  });
}

// ---------- Extend page stack close for reels ----------

const _origCloseTopPage3 = _closeTopPage;
_closeTopPage = function () {
  const top = _PageStack[_PageStack.length - 1];
  if (top === "reels") {
    _PageStack.pop();
    closeReelsPage();
    return true;
  }
  return _origCloseTopPage3();
};

// Escape key to close reels
document.addEventListener("keydown", (e) => {
  const reelsPage = document.getElementById("reels-page");
  if (e.key === "Escape" && reelsPage && !reelsPage.classList.contains("hidden")) {
    closeReelsPage();
  }
});


