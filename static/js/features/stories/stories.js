
// ==================================================
// SVG AVATAR GENERATOR (for stories)
// ==================================================

export function fillStoryAvatars() {
  document.querySelectorAll(".story-hex-content[data-avatar]").forEach((el) => {
    if (el.dataset.filled === "1") return;
    const parts = (el.dataset.avatar || "").split(":");
    const seed = parts[0] || "user";
    const name = parts[1] || seed;
    el.innerHTML = generateAvatarSVG(seed, name);
    el.dataset.filled = "1";
  });
}
// STORIES SYSTEM
// ==================================================

let storyGroups = [];       // all active story groups
let currentGroupIdx = 0;    // which user's stories we're viewing
let currentStoryIdx = 0;    // which story within the group
window.storyTimer = null;
window._storyTimerRemaining = 5000;
window._storyTimerStartTime = 0;
window._storyTimerPaused = false;
window._storyTimerDuration = 5000;

// ---------- Load stories from server ----------

export async function loadStories() {
  const row = document.querySelector(".stories-row");
  if (!row) return;
  try {
    storyGroups = await api("/api/stories");

    // Clear existing story cards (keep the add button)
    row.querySelectorAll(".story-card:not(.story-add)").forEach((el) => el.remove());

    // Check if I have stories
    const myGroup = storyGroups.find((g) => g.user.username === state.me.username);
    const addCard = row.querySelector(".story-add");
    if (addCard) addCard.classList.toggle("has-story", !!myGroup);

    // Add other users' stories
    storyGroups.forEach((group, idx) => {
      if (group.user.username === state.me.username) return; // skip self (self shown as "+")
      const card = document.createElement("div");
      card.className = "story-card";
      card.dataset.idx = idx;
      card.innerHTML = `
        <div class="story-hex ${group.has_unseen ? "unseen" : "seen"}">
          <div class="story-hex-content">
            ${group.user.profile_pic
              ? `<img src="${escapeHtml(group.user.profile_pic)}" alt="${escapeHtml(group.user.display_name)}" loading="lazy" decoding="async">`
              : generateAvatarSVG(group.user.username, group.user.display_name)}
          </div>
        </div>
        <span>${escapeHtml(group.user.display_name.split(" ")[0])}</span>
      `;
      card.addEventListener("click", () => openStoryViewer(idx, 0));
      row.appendChild(card);
    });
  } catch (err) {
    console.error("Stories load failed:", err);
  }
}

// ---------- Open viewer ----------

export async function openStoryViewer(groupIdx, storyIdx) {
  if (!storyGroups[groupIdx]) return;
  currentGroupIdx = groupIdx;
  currentStoryIdx = storyIdx || 0;

  const viewer = document.getElementById("story-viewer");
  if (!viewer) return;
  viewer.classList.remove("hidden");

  await renderCurrentStory();
}

export async function renderCurrentStory() {
  const group = storyGroups[currentGroupIdx];
  if (!group) return closeStoryViewer();

  const stories = group.stories;
  const story = stories[currentStoryIdx];
  if (!story) return closeStoryViewer();

  // Header
  const av = document.getElementById("sv-avatar");
  if (group.user.profile_pic) {
    av.innerHTML = `<img src="${escapeHtml(group.user.profile_pic)}" alt="" loading="lazy" decoding="async">`;
  } else {
    av.textContent = initial(group.user.display_name);
  }
  document.getElementById("sv-name").textContent = group.user.display_name;
  document.getElementById("sv-time").textContent = shortTime(story.created_at);

  // Media
  const media = document.getElementById("sv-media");
  media.innerHTML = "";
  if (story.media_type === "video") {
    const vid = document.createElement("video");
    vid.src = story.media;
    vid.autoplay = true;
    vid.muted = false;
    vid.playsInline = true;
    vid.onended = nextStory;
    media.appendChild(vid);
  } else {
    const img = document.createElement("img");
    img.src = story.media;
    img.alt = "Story";
    media.appendChild(img);
  }

  // Caption hidden in story viewer (will be shown in edit later)

  // Progress bars
  const prog = document.getElementById("sv-progress");
  prog.innerHTML = stories.map((s, i) => {
    let cls = "sv-progress-bar";
    if (i < currentStoryIdx) cls += " viewed";
    if (i === currentStoryIdx) cls += " active";
    return `<div class="${cls}"><div class="sv-progress-fill"></div></div>`;
  }).join("");

  // Reactions bar (only for other's stories) — append to BODY to avoid parent CSS issues
  const isMine = state.me && state.me.username === group.user.username;
  let reactBarEl = document.getElementById("sv-reactions-bar");
  if (!reactBarEl) {
    reactBarEl = document.createElement("div");
    reactBarEl.id = "sv-reactions-bar";
    reactBarEl.className = "sv-reactions-bar";
    reactBarEl.innerHTML =
      '<button type="button" class="sv-react" data-r="love">❤️</button>' +
      '<button type="button" class="sv-react" data-r="haha">😂</button>' +
      '<button type="button" class="sv-react" data-r="wow">😮</button>' +
      '<button type="button" class="sv-react" data-r="sad">😢</button>' +
      '<button type="button" class="sv-react" data-r="clap">👏</button>' +
      '<button type="button" class="sv-react" data-r="fire">🔥</button>';
    document.body.appendChild(reactBarEl);
  }
  reactBarEl.dataset.storyId = story.id;
  reactBarEl.classList.toggle("hidden", isMine);

  // Reply box (only for other's stories)
  let replyBarEl = document.getElementById("sv-reply-bar");
  if (!replyBarEl) {
    replyBarEl = document.createElement("div");
    replyBarEl.id = "sv-reply-bar";
    replyBarEl.className = "sv-reply-bar";
    replyBarEl.innerHTML =
      '<button type="button" class="sv-reply-trigger" id="sv-reply-trigger">' +
        '<i class="fa-regular fa-comment"></i> উত্তর লিখুন...' +
      '</button>' +
      '<form class="sv-reply-form hidden" id="sv-reply-form">' +
        '<input type="text" id="sv-reply-input" placeholder="উত্তর লিখুন..." maxlength="500" autocomplete="off">' +
        '<button type="submit" class="sv-reply-send" title="পাঠান"><i class="fa-solid fa-paper-plane"></i></button>' +
        '<button type="button" class="sv-reply-close" title="বাতিল"><i class="fa-solid fa-xmark"></i></button>' +
      '</form>';
    document.body.appendChild(replyBarEl);

    // Wire trigger
    replyBarEl.querySelector("#sv-reply-trigger").addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      var form = document.getElementById("sv-reply-form");
      var trig = document.getElementById("sv-reply-trigger");
      form.classList.remove("hidden");
      trig.classList.add("hidden");
      setTimeout(function() { document.getElementById("sv-reply-input").focus(); }, 50);
    });

    // Wire close
    replyBarEl.querySelector(".sv-reply-close").addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      var form = document.getElementById("sv-reply-form");
      var trig = document.getElementById("sv-reply-trigger");
      form.classList.add("hidden");
      trig.classList.remove("hidden");
      document.getElementById("sv-reply-input").value = "";
    });

    // Wire form submit
    replyBarEl.querySelector("#sv-reply-form").addEventListener("submit", async function(e) {
      e.preventDefault();
      e.stopPropagation();
      var input = document.getElementById("sv-reply-input");
      var text = (input.value || "").trim();
      if (!text) return;
      var bar = document.getElementById("sv-reactions-bar");
      var username = replyBarEl.dataset.username;
      if (!username) return;

      var sendBtn = replyBarEl.querySelector(".sv-reply-send");
      sendBtn.disabled = true;

      try {
        await api("/api/messages/" + encodeURIComponent(username), {
          method: "POST",
          body: JSON.stringify({ content: "📸 স্টোরি রিপ্লাই: " + text }),
        });
        // Inline success feedback
        sendBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
        sendBtn.classList.add("sent");
        input.disabled = true;
        input.placeholder = "✓ পাঠানো হয়েছে";
        if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
        setTimeout(function() {
          input.value = "";
          input.disabled = false;
          input.placeholder = "উত্তর লিখুন...";
          sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
          sendBtn.classList.remove("sent");
          sendBtn.disabled = false;
          replyBarEl.querySelector("#sv-reply-form").classList.add("hidden");
          replyBarEl.querySelector("#sv-reply-trigger").classList.remove("hidden");
        }, 1200);
      } catch (err) {
        sendBtn.disabled = false;
        input.placeholder = "পাঠানো যায়নি, আবার চেষ্টা করুন";
        input.classList.add("error");
        setTimeout(function() {
          input.placeholder = "উত্তর লিখুন...";
          input.classList.remove("error");
        }, 2000);
      }
    });
  }
  replyBarEl.dataset.username = group.user.username;
  replyBarEl.classList.toggle("hidden", isMine);

  // Views + delete
  const viewsEl = document.getElementById("sv-views");
  if (isMine) {
    if (story.views > 0) {
      viewsEl.innerHTML = `<button type="button" class="sv-views-btn" data-story-id="${story.id}"><i class="fa-regular fa-eye"></i> ${story.views} জন দেখেছে</button>`;
      viewsEl.classList.add("clickable");
    } else {
      viewsEl.innerHTML = `<i class="fa-regular fa-eye"></i> ০ জন দেখেছে`;
      viewsEl.classList.remove("clickable");
    }
    document.getElementById("sv-delete").classList.remove("hidden");
    document.getElementById("sv-delete").onclick = () => deleteCurrentStory(story.id);
  } else {
    viewsEl.innerHTML = "";
    document.getElementById("sv-delete").classList.add("hidden");
  }

  // Start auto-advance immediately (no await before timer)
  if (story.media_type !== "video") {
    _storyTimerStart(5000);
  } else {
    _storyTimerStop();
  }

  // Mark viewed in background (non-blocking)
  if (!isMine && !story.viewed) {
    api(`/api/stories/${story.id}/view`, { method: "POST" }).then(() => {
      story.viewed = true;
      group.has_unseen = group.stories.some((s) => !s.viewed);
    }).catch(() => {});
  }
}

export function nextStory() {
  clearTimeout(window.storyTimer);
  const group = storyGroups[currentGroupIdx];
  if (!group) return closeStoryViewer();

  if (currentStoryIdx < group.stories.length - 1) {
    currentStoryIdx++;
    renderCurrentStory();
  } else {
    // Move to next user with unseen stories
    const nextIdx = findNextGroup(currentGroupIdx);
    if (nextIdx !== -1) {
      openStoryViewer(nextIdx, 0);
    } else {
      closeStoryViewer();
    }
  }
}

export function prevStory() {
  clearTimeout(window.storyTimer);
  if (currentStoryIdx > 0) {
    currentStoryIdx--;
    renderCurrentStory();
  } else {
    const prevIdx = findPrevGroup(currentGroupIdx);
    if (prevIdx !== -1) {
      const g = storyGroups[prevIdx];
      openStoryViewer(prevIdx, g.stories.length - 1);
    }
  }
}

export function findNextGroup(from) {
  for (let i = from + 1; i < storyGroups.length; i++) {
    if (storyGroups[i].user.username === state.me.username) continue;
    return i;
  }
  return -1;
}

export function findPrevGroup(from) {
  for (let i = from - 1; i >= 0; i--) {
    if (storyGroups[i].user.username === state.me.username) continue;
    return i;
  }
  return -1;
}

export function closeStoryViewer() {
  clearTimeout(window.storyTimer);
  const viewer = document.getElementById("story-viewer");
  if (viewer) viewer.classList.add("hidden");

  // S30.33 — explicitly pause any playing video before clearing
  const media = document.getElementById("sv-media");
  if (media) {
    try {
      media.querySelectorAll("video").forEach(function (v) {
        try { v.pause(); v.src = ""; v.load(); } catch (e) {}
      });
    } catch (e) {}
    media.innerHTML = "";
  }

  const bar = document.getElementById("sv-reactions-bar");
  if (bar) bar.classList.add("hidden");
  const rbar = document.getElementById("sv-reply-bar");
  if (rbar) rbar.classList.add("hidden");
  currentGroupIdx = 0;
  currentStoryIdx = 0;

  // S30.33 — do NOT call loadStories() here (was: row rebuilt → scroll reset)
  // Just mark viewed stories as viewed in the existing row data + refresh the
  // story ring classes to reflect new state, without rebuilding the row.
  try {
    var row = document.querySelector(".stories-row");
    if (row && Array.isArray(storyGroups)) {
      var idx = 0;
      row.querySelectorAll(".story-card").forEach(function (card) {
        if (card.classList.contains("story-add")) return;
        var g = storyGroups[idx];
        idx++;
        if (!g) return;
        var hex = card.querySelector(".story-hex");
        if (!hex) return;
        if (g.has_unseen) hex.classList.add("unseen");
        else hex.classList.remove("unseen");
        if (g.user && g.user.username === (window.state && state.me && state.me.username)) {
          // skip self
        }
      });
    }
  } catch (e) {}
}

export async function deleteCurrentStory(sid) {
  if (!confirm("এই স্টোরি মুছে ফেলবেন?")) return;
  try {
    await api(`/api/stories/${sid}`, { method: "DELETE" });
    const group = storyGroups[currentGroupIdx];
    group.stories = group.stories.filter((s) => s.id !== sid);
    if (group.stories.length === 0) {
      closeStoryViewer();
    } else {
      if (currentStoryIdx >= group.stories.length) currentStoryIdx = group.stories.length - 1;
      renderCurrentStory();
    }
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Upload flow ----------

let pendingStoryMedia = null;

const storyFileInput = document.getElementById("story-file-input");
const storyUploadEmpty = document.getElementById("story-upload-empty");
const storyUploadPreview = document.getElementById("story-upload-preview");
const storyPreviewImg = document.getElementById("story-preview-img");
const publishStoryBtn = document.getElementById("publish-story");
const storyUploadModal = document.getElementById("story-upload-modal");

const btnChooseStory = document.getElementById("btn-choose-story");
if (btnChooseStory) btnChooseStory.addEventListener("click", () => storyFileInput.click());

if (storyFileInput) {
  storyFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("শুধু ছবি দেওয়া যাবে");
      return;
    }
    try {
      // Resize to max 1080px wide, quality 0.8 → keeps under 3MB
      const dataUri = await resizeImage(file, 1080, 0.8);
      pendingStoryMedia = dataUri;
      storyPreviewImg.src = dataUri;
      storyUploadEmpty.classList.add("hidden");
      storyUploadPreview.classList.remove("hidden");
      publishStoryBtn.disabled = false;
    } catch (err) {
      alert("ছবি লোড করা যায়নি");
    }
  });
}

const cancelStoryUpload = document.getElementById("cancel-story-upload");
if (cancelStoryUpload) {
  cancelStoryUpload.addEventListener("click", resetStoryUpload);
}
const closeStoryUpload = document.getElementById("close-story-upload");
if (closeStoryUpload) {
  closeStoryUpload.addEventListener("click", resetStoryUpload);
}
if (storyUploadModal) {
  storyUploadModal.addEventListener("click", (e) => {
    if (e.target === storyUploadModal) resetStoryUpload();
  });
}

export function resetStoryUpload() {
  pendingStoryMedia = null;
  if (storyFileInput) storyFileInput.value = "";
  if (storyUploadEmpty) storyUploadEmpty.classList.remove("hidden");
  if (storyUploadPreview) storyUploadPreview.classList.add("hidden");
  if (storyPreviewImg) storyPreviewImg.src = "";
  const cap = document.getElementById("story-caption");
  if (cap) cap.value = "";
  // S30.27 — reset button HTML too (was: spinner stuck after first success)
  if (publishStoryBtn) {
    publishStoryBtn.disabled = true;
    publishStoryBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> পোস্ট করুন';
  }
  if (storyUploadModal) storyUploadModal.classList.add("hidden");
}

if (publishStoryBtn) {
  publishStoryBtn.addEventListener("click", async () => {
    if (!pendingStoryMedia) return;
    const caption = (document.getElementById("story-caption").value || "").trim();

    publishStoryBtn.disabled = true;
    publishStoryBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> পোস্ট হচ্ছে...`;

    try {
      await api("/api/stories", {
        method: "POST",
        body: JSON.stringify({
          media: pendingStoryMedia,
          media_type: "image",
          caption,
        }),
      });
      resetStoryUpload();
      await loadStories();
      showToast("✅ স্টোরি পোস্ট হয়েছে!");
    } catch (err) {
      alert(err.message);
      publishStoryBtn.disabled = false;
      publishStoryBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> পোস্ট করুন`;
    }
  });
}

// ---------- Wire up Add Story button ----------

const addStoryBtnEl = document.getElementById("add-story");
if (addStoryBtnEl) {
  // Remove old listener by replacing the node
  const newAdd = addStoryBtnEl.cloneNode(true);
  addStoryBtnEl.parentNode.replaceChild(newAdd, addStoryBtnEl);

  newAdd.addEventListener("click", () => {
    // If I have stories, open viewer for my own stories
    const myIdx = storyGroups.findIndex((g) => g.user.username === state.me.username);
    if (myIdx !== -1) {
      openStoryViewer(myIdx, 0);
    } else {
      // No stories yet → open upload
      resetStoryUpload();
      storyUploadModal.classList.remove("hidden");
    }
  });
}

// ---------- Viewer controls ----------

document.getElementById("sv-close")?.addEventListener("click", closeStoryViewer);
document.getElementById("sv-next")?.addEventListener("click", nextStory);
document.getElementById("sv-prev")?.addEventListener("click", prevStory);

// Tap zones on the media
// S30.31 — story tap: guard against accidental next after a hold-release
(function () {
  var _svHoldStart = 0;
  var _svHoldMoved = false;
  var _svLastHoldEnd = 0;
  var media = document.getElementById("sv-media");
  if (!media) return;

  media.addEventListener("touchstart", function (e) {
    _svHoldStart = Date.now();
    _svHoldMoved = false;
  }, { passive: true });

  media.addEventListener("touchmove", function (e) {
    if (Date.now() - _svHoldStart > 200) _svHoldMoved = true;
  }, { passive: true });

  media.addEventListener("touchend", function (e) {
    var held = Date.now() - _svHoldStart;
    _svLastHoldEnd = Date.now();
    if (_svHoldMoved || held > 500) {
      // it was a long press → don't navigate
      e.stopPropagation();
      e.preventDefault();
      return false;
    }
  }, true);

  media.addEventListener("click", function (e) {
    // discard click that fires right after a long hold (browser ghost click)
    if (Date.now() - _svLastHoldEnd < 300) {
      e.stopPropagation();
      e.preventDefault();
      return false;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 3) prevStory();
    else nextStory();
  }, true);
})();

// Keyboard
document.addEventListener("keydown", (e) => {
  const viewer = document.getElementById("story-viewer");
  if (!viewer || viewer.classList.contains("hidden")) return;
  // S30.29 — ignore keyboard nav when typing in an input/textarea
  // (was: space + arrows in reply input triggered story navigation)
  var t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); nextStory(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); prevStory(); }
  else if (e.key === "Escape") closeStoryViewer();
});

// ---------- Auto-call after scripts loaded ----------
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", fillStoryAvatars);
} else {
  fillStoryAvatars();
}

// ---------- Self-wrap: page-stack integration ----------
if (typeof _pushPage === "function") {
  const _origOpenStoryViewer = openStoryViewer;
  openStoryViewer = async function (groupIdx, storyIdx) {
    await _origOpenStoryViewer(groupIdx, storyIdx);
    const viewer = document.getElementById("story-viewer");
    if (viewer && !viewer.classList.contains("hidden")) {
      _pushPage("story-viewer");
    }
  };
}

// ---------- Temporary bridge ----------
window.fillStoryAvatars = fillStoryAvatars;
window.loadStories = loadStories;
window.openStoryViewer = openStoryViewer;
window.renderCurrentStory = renderCurrentStory;
window.nextStory = nextStory;
window.prevStory = prevStory;
window.findNextGroup = findNextGroup;
window.findPrevGroup = findPrevGroup;
window.closeStoryViewer = closeStoryViewer;
window.deleteCurrentStory = deleteCurrentStory;
window.resetStoryUpload = resetStoryUpload;
