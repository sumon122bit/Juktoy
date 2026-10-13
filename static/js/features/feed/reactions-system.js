// ==================================================
// window.REACTIONS SYSTEM — 6 Facebook-style reactions
// ==================================================

window.REACTIONS = {
  like:  { emoji: "👍", label: "লাইক",   class: "reaction-like" },
  love:  { emoji: "❤️", label: "ভালোবাসা", class: "reaction-love" },
  haha:  { emoji: "😆", label: "হাসি",   class: "reaction-haha" },
  wow:   { emoji: "😮", label: "বিস্ময়",  class: "reaction-wow" },
  sad:   { emoji: "😢", label: "দুঃখ",   class: "reaction-sad" },
  angry: { emoji: "😡", label: "রাগ",    class: "reaction-angry" },
};

export function renderReactionIcon(reaction) {
  if (!reaction || !window.REACTIONS[reaction]) {
    return `<i class="fa-regular fa-heart"></i>`;
  }
  return `<span class="reaction-emoji">${window.REACTIONS[reaction].emoji}</span>`;
}

// ---------- Build reaction picker (shared) ----------

window._activePicker = null;

export function buildReactionPicker() {
  const picker = document.createElement("div");
  picker.className = "reaction-picker hidden";
  picker.innerHTML = Object.entries(window.REACTIONS).map(([key, r]) => `
    <button class="reaction-btn" data-reaction="${key}" data-label="${r.label}">
      ${r.emoji}
    </button>
  `).join("");
  return picker;
}

export function closePicker() {
  if (window._activePicker) {
    window._activePicker.classList.add("hidden");
    window._activePicker = null;
  }
}

// Close picker when clicking elsewhere
document.addEventListener("click", (e) => {
  if (!e.target.closest(".reaction-picker") && !e.target.closest(".like-btn")) {
    closePicker();
  }
});

// Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePicker();
});

// ---------- Show picker for a like button ----------

export function showPicker(likeBtn) { /* disabled */ }

// ---------- Apply a reaction (from picker or quick tap) ----------

async function applyReaction(likeBtn, reaction) { /* disabled */ }

export function applyReactionStyles(btn, reaction) {
  // Remove all reaction classes
  Object.values(window.REACTIONS).forEach((r) => btn.classList.remove(r.class));
  btn.classList.remove("reaction-active");
  btn.classList.remove("liked");

  if (reaction && window.REACTIONS[reaction]) {
    btn.classList.add("reaction-active", window.REACTIONS[reaction].class);
    // Keep "liked" for backwards compat with CSS
    btn.classList.add("liked");
  }
}

export function burstReaction(likeBtn, emoji) {
  const burst = document.createElement("span");
  burst.className = "reaction-burst";
  burst.textContent = emoji;
  likeBtn.appendChild(burst);
  setTimeout(() => burst.remove(), 1000);
}

// ---------- Attach picker + tap handlers to a like button ----------

export function attachReactionHandlers(likeBtn) { /* disabled — using delegation */ }

export function quickToggleLike(likeBtn) {
  const current = likeBtn.dataset.reaction || "";
  if (current) {
    // Has reaction → remove
    applyReaction(likeBtn, current);
  } else {
    // No reaction → default like
    applyReaction(likeBtn, "like");
  }
}

// ---------- Hook into window.bindPostEvents ----------

window._origBindPostEventsReactions = window.bindPostEvents;
window.bindPostEvents = function () {
  window._origBindPostEventsReactions();

  document.querySelectorAll(".like-btn").forEach((btn) => {
    applyReactionStyles(btn, btn.dataset.reaction || "");
    attachReactionHandlers(btn);
  });
};

// Also after initial feed render
window._enterAppHooks.push(() => {
  setTimeout(() => {
    document.querySelectorAll(".like-btn").forEach((btn) => {
      applyReactionStyles(btn, btn.dataset.reaction || "");
      attachReactionHandlers(btn);
    });
  }, 500);
});

// ---------- Double-tap post body → love reaction ----------

document.addEventListener("dblclick", (e) => {
  const post = e.target.closest(".post");
  if (!post) return;
  const likeBtn = post.querySelector(".like-btn");
  if (!likeBtn) return;
  const current = likeBtn.dataset.reaction || "";
  if (current !== "love") {
    applyReaction(likeBtn, "love");
    burstReaction(likeBtn, "❤️");
  }
});

// Touch-based double-tap
window._lastTapPost = null;
window._lastTapTime = 0;
document.addEventListener("touchend", (e) => {
  const post = e.target.closest(".post");
  if (!post) return;
  // Only if not tapping buttons
  if (e.target.closest("button") || e.target.closest("a") || e.target.closest("input")) return;

  const now = Date.now();
  if (window._lastTapPost === post && now - window._lastTapTime < 300) {
    const likeBtn = post.querySelector(".like-btn");
    if (likeBtn) {
      const current = likeBtn.dataset.reaction || "";
      if (current !== "love") {
        applyReaction(likeBtn, "love");
        burstReaction(likeBtn, "❤️");
      }
    }
    window._lastTapPost = null;
  } else {
    window._lastTapPost = post;
    window._lastTapTime = now;
  }
});


// ==================================================
// FINAL REACTION SYSTEM — Clean Implementation
// ==================================================

window.FIN_REACTION_DATA = {
  like:  { emoji: "👍", label: "লাইক",      color: "#1877f2" },
  love:  { emoji: "❤️", label: "ভালোবাসা",  color: "#ef4444" },
  haha:  { emoji: "😆", label: "হাসি",      color: "#f59e0b" },
  wow:   { emoji: "😮", label: "বিস্ময়",     color: "#f59e0b" },
  sad:   { emoji: "😢", label: "দুঃখ",      color: "#f59e0b" },
  angry: { emoji: "😡", label: "রাগ",       color: "#ef4444" },
};

window._finGlobalPicker = null;
window._finPickerTargetBtn = null;

// ---------- Build picker (once, global) ----------

export function _finBuildGlobalPicker() {
  if (window._finGlobalPicker) return window._finGlobalPicker;

  const picker = document.createElement("div");
  picker.className = "reaction-picker-global";
  picker.innerHTML = Object.entries(window.FIN_REACTION_DATA).map(([key, r]) =>
    `<button type="button" class="rp-emoji" data-reaction="${key}" title="${r.label}">${r.emoji}</button>`
  ).join("");

  // Attach click with onclick for guaranteed binding
  picker.querySelectorAll(".rp-emoji").forEach((btn) => {
    // S30.34 — use touchstart + mousedown for reliable mobile response
    const doPick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const reaction = btn.dataset.reaction;
      const target = window._finPickerTargetBtn;
      if (!target || !reaction) return;
      // hide but KEEP target reference so _finDoReaction works
      if (window._finGlobalPicker) window._finGlobalPicker.style.display = "none";
      window._finPickerCooldown = Date.now() + 300;
      window._finPickerTargetBtn = null;
      _finDoReaction(target, reaction);
    };
    btn.onclick = doPick;
    // fallback for browsers that don't fire click on touch
    btn.addEventListener("touchend", function (e) {
      // small delay so click doesn't double-fire
      setTimeout(function () { doPick(e); }, 10);
    }, { passive: false });
  });

  document.body.appendChild(picker);
  window._finGlobalPicker = picker;
  return picker;
}

window._finPickerCooldown = 0;

export function _finShowGlobalPicker(anchorBtn) {
  // Cooldown — don't re-show within 1.2 seconds of hiding
  if (Date.now() < window._finPickerCooldown) return;

  const picker = _finBuildGlobalPicker();
  window._finPickerTargetBtn = anchorBtn;

  // Position picker above the anchor button
  const rect = anchorBtn.getBoundingClientRect();
  const pickerWidth = 300; // approx
  const pickerHeight = 60;

  let left = rect.left;
  let top = rect.top - pickerHeight - 10;

  // Keep within viewport
  if (left + pickerWidth > window.innerWidth - 10) {
    left = window.innerWidth - pickerWidth - 10;
  }
  if (left < 10) left = 10;
  if (top < 10) top = rect.bottom + 10;

  picker.style.position = "fixed";
  picker.style.left = left + "px";
  picker.style.top = top + "px";
  picker.style.display = "flex";
  picker.style.opacity = "0";
  picker.style.transform = "translateY(10px) scale(0.85)";

  // Animate in
  requestAnimationFrame(() => {
    picker.style.transition = "all 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)";
    picker.style.opacity = "1";
    picker.style.transform = "translateY(0) scale(1)";
  });

  // Mark current reaction as active
  const current = anchorBtn.dataset.reaction || "";
  picker.querySelectorAll(".rp-emoji").forEach((b) => {
    b.classList.toggle("active", b.dataset.reaction === current);
  });
}

export function _finHideGlobalPicker() {
  if (window._finGlobalPicker) {
    window._finGlobalPicker.style.display = "none";
  }
  window._finPickerTargetBtn = null;
  // Cooldown — block re-open for 1.2 seconds
  window._finPickerCooldown = Date.now() + 300;   // S30.31 — was 1200ms (too long after hide)
}

// ---------- Apply reaction ----------

// S29.9 - per-post lock (was: single global _finProcessing flag).
// Global lock dropped rapid reactions on DIFFERENT posts (any
// second click within 200ms was silently discarded, regardless of
// which post it targeted). Per-post map allows independent reactions
// while still preventing a duplicate POST on the SAME post.
window._finProcessingByPost = Object.create(null);

async function _finDoReaction(likeBtn, reaction) {
  console.log('[T1] _finDoReaction called, reaction=', reaction);
  // S30.34 — fallback: find postId from parent .post element if button lacks it
  let postId = likeBtn.dataset.id;
  if (!postId) {
    const postEl = likeBtn.closest(".post");
    if (postEl && postEl.dataset.id) postId = postEl.dataset.id;
  }
  if (!postId) {
    console.warn("[REACTION] no postId for button", likeBtn);
    return;
  }

  console.log('[T2] postId=', postId);
  if (window._finProcessingByPost[postId]) { console.log('[T2b] already processing'); return; }
  window._finProcessingByPost[postId] = true;

  const current = likeBtn.dataset.reaction || "";
  const newReaction = current === reaction ? "" : reaction;
  const oldReaction = current;
  const oldCount = parseInt(likeBtn.querySelector(".like-count")?.textContent || "0", 10);

  let newCount = oldCount;
  if (newReaction && !oldReaction) newCount = oldCount + 1;
  else if (!newReaction && oldReaction) newCount = Math.max(0, oldCount - 1);

  // Optimistic update
  likeBtn.dataset.reaction = newReaction;
  console.log('[T3] render start newReaction=', newReaction, 'newCount=', newCount);
  _finRenderReactionButton(likeBtn, newReaction, newCount);
  console.log('[T4] render done innerHTML=', likeBtn.innerHTML.slice(0,100));
  _finFlashReaction(likeBtn, newReaction || oldReaction);

  try {
    console.log("[T5] API POST start");
    const res = await api("/api/posts/" + postId + "/reaction", {
      method: "POST",
      body: JSON.stringify({ reaction: reaction }),
    });
    console.log("[T6] API response:", res);
    const finalReaction = res.my_reaction || "";
    likeBtn.dataset.reaction = finalReaction;

    // Reaction-fix — play once, only on real user action
    if (finalReaction) {
      likeBtn.classList.remove("just-reacted");
      void likeBtn.offsetWidth;
      likeBtn.classList.add("just-reacted");
      setTimeout(function () {
        likeBtn.classList.remove("just-reacted");
      }, 750);
    }
    _finRenderReactionButton(likeBtn, finalReaction, res.total || 0);

    // S30.35 — update post-reaction-summary (was: never updated after reaction)
    try { _finUpdatePostSummary(likeBtn, res); } catch (e) { console.warn("[SUMMARY]", e); }
  } catch (err) {
    likeBtn.dataset.reaction = oldReaction;
    _finRenderReactionButton(likeBtn, oldReaction, oldCount);
  } finally {
    setTimeout(function () { delete window._finProcessingByPost[postId]; }, 200);
  }
}

export function _finRenderReactionButton(btn, reaction, count) {
  try {
    var _r = btn.dataset.reaction || "";
    var _emEl = btn.querySelector(".reaction-emoji");
    var _heartI = btn.querySelector("i.fa-heart");
    var _em = _emEl ? _emEl.textContent : (_heartI ? "HEART" : "");
    var _want = (reaction && window.FIN_REACTION_DATA[reaction])
      ? window.FIN_REACTION_DATA[reaction].emoji : "HEART";
    var _cEl = btn.querySelector(".like-count");
    var _c = _cEl ? _cEl.textContent : "";
    if (_r === (reaction || "") && _em === _want && _c === String(count)) {
      return;
    }
  } catch (e) {}

  var labelText = reaction ? "রিঅ্যাক্ট" : "লাইক";
  var html = "";

  if (reaction && window.FIN_REACTION_DATA[reaction]) {
    html += '<span class="reaction-emoji">' + window.FIN_REACTION_DATA[reaction].emoji + '</span>';
    btn.classList.add("reaction-active", "reaction-" + reaction);
    btn.style.color = window.FIN_REACTION_DATA[reaction].color;
  } else {
    html += '<i class="fa-regular fa-heart"></i>';
    btn.classList.remove("reaction-active", "reaction-like", "reaction-love",
                          "reaction-haha", "reaction-wow", "reaction-sad", "reaction-angry");
    btn.style.color = "";
  }

  html += '<span class="reaction-label">' + labelText + '</span>';
  html += '<span class="like-count">' + count + '</span>';
  btn.innerHTML = html;
}


// S30.35 — update the summary block at the bottom of the post
export function _finUpdatePostSummary(likeBtn, res) {
  var postEl = likeBtn.closest(".post");
  if (!postEl) return;

  var counts = res.counts || {};
  var total = res.total || 0;
  var top = res.top || [];

  var emojiMap = { like: "👍", love: "❤️", haha: "😆", wow: "😮", sad: "😢", angry: "😡" };
  var stackHTML = "";
  if (top && top.length) {
    stackHTML = top.map(function (r) {
      return '<span class="prs-emoji reaction-' + r + '" data-r="' + r + '">' +
        (emojiMap[r] || "❤️") + '</span>';
    }).join("");
  } else {
    stackHTML = '<span class="prs-emoji reaction-love">❤️</span>';
  }

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

  var commentBtn = postEl.querySelector(".comment-btn .comment-count");
  var repostBtn = postEl.querySelector(".repost-btn .repost-count");
  var commentCount = commentBtn ? parseInt(commentBtn.textContent || "0", 10) : 0;
  var repostCount = repostBtn ? parseInt(repostBtn.textContent || "0", 10) : 0;

  var summaryEl = postEl.querySelector(".post-reaction-summary");
  var dividerEl = postEl.querySelector(".post-actions-divider");

  if (total === 0 && commentCount === 0 && repostCount === 0) {
    if (summaryEl) summaryEl.remove();
    if (dividerEl) dividerEl.remove();
    return;
  }

  var summaryHTML = `
    <div class="post-reaction-summary">
      <div class="prs-left">
        ${total > 0 ? '<span class="prs-stack">' + stackHTML + '</span>' : ''}
        ${total > 0 ? '<span class="prs-count">' + _fmtNum(total) + '</span>' : ''}
      </div>
      <div class="prs-right">
        ${commentCount > 0 ? '<span>' + _fmtBn(commentCount) + ' মন্তব্য</span>' : ''}
        ${(commentCount > 0 && repostCount > 0) ? '<span class="prs-sep">·</span>' : ''}
        ${repostCount > 0 ? '<span>' + _fmtBn(repostCount) + ' শেয়ার</span>' : ''}
      </div>
    </div>
    <div class="post-actions-divider"></div>
  `;

  if (summaryEl) {
    summaryEl.outerHTML = summaryHTML;
  } else {
    // insert before .post-actions
    var actionsEl = postEl.querySelector(".post-actions");
    if (actionsEl) {
      actionsEl.insertAdjacentHTML("beforebegin", summaryHTML);
    }
  }
}

export function _finFlashReaction(btn, reaction) {
  if (!reaction || !window.FIN_REACTION_DATA[reaction]) return;
  const burst = document.createElement("span");
  burst.className = "reaction-burst";
  burst.textContent = window.FIN_REACTION_DATA[reaction].emoji;
  btn.appendChild(burst);
  setTimeout(() => burst.remove(), 1000);
}

// ---------- Event delegation ----------

window._finLastTouch = 0;
window._finHoverTimer = null;
window._finCurrentHoverBtn = null;
window._finLpTimer = null;
window._finLpBtn = null;
window._finLpDid = false;

// Click (desktop)
document.addEventListener("click", function (e) {
  // If clicked inside our global picker — ignore (handled by picker's own onclick)
  if (e.target.closest(".reaction-picker-global")) return;

  const likeBtn = e.target.closest(".like-btn");
  if (!likeBtn) {
    _finHideGlobalPicker();
    return;
  }

  console.log('[T7] click handler hit');
  if (Date.now() - window._finLastTouch < 700) { console.log('[T7b] skip ghost click'); return; } // Skip ghost click after touch

  // Quick toggle
  const current = likeBtn.dataset.reaction || "";
  if (current) {
    _finDoReaction(likeBtn, current);
  } else {
    _finDoReaction(likeBtn, "like");
  }
}, true);

// Hover (desktop)
document.addEventListener("mouseover", function (e) {
  // S30.34 — kill hover picker on ANY touch device (was: width<900 → tablets triggered)
  if ("ontouchstart" in window || navigator.maxTouchPoints > 0) return;
  const likeBtn = e.target.closest(".like-btn");
  if (!likeBtn) return;
  if (window._finCurrentHoverBtn === likeBtn) return;

  // Cooldown check
  if (Date.now() < window._finPickerCooldown) return;

  clearTimeout(window._finHoverTimer);
  window._finCurrentHoverBtn = likeBtn;
  window._finHoverTimer = setTimeout(function () {
    if (window._finCurrentHoverBtn === likeBtn && Date.now() >= window._finPickerCooldown) {
      _finShowGlobalPicker(likeBtn);
    }
  }, 450);
});

document.addEventListener("mouseout", function (e) {
  const likeBtn = e.target.closest(".like-btn");
  if (!likeBtn) return;
  const related = e.relatedTarget;
  if (related && (likeBtn.contains(related) || (window._finGlobalPicker && window._finGlobalPicker.contains(related)))) {
    return;
  }
  clearTimeout(window._finHoverTimer);
  window._finCurrentHoverBtn = null;
  // Delay hide so user can move into picker
  setTimeout(function () {
    if (window._finGlobalPicker && window._finGlobalPicker.matches(":hover")) return;
    if (window._finPickerTargetBtn && window._finPickerTargetBtn.matches(":hover")) return;
    _finHideGlobalPicker();
  }, 250);
});

// Long-press (mobile)
// S30.31 — touchmove scroll guard: cancel long-press + prevent accidental like
var _finTouchStartX = 0;
var _finTouchStartY = 0;
var _finTouchMoved = false;

document.addEventListener("touchstart", function (e) {
  const likeBtn = e.target.closest(".like-btn");
  if (!likeBtn) return;
  window._finLastTouch = Date.now();
  window._finLpBtn = likeBtn;
  window._finLpDid = false;
  _finTouchMoved = false;
  _finTouchStartX = e.touches[0].clientX;
  _finTouchStartY = e.touches[0].clientY;
  clearTimeout(window._finLpTimer);
  window._finLpTimer = setTimeout(function () {
    if (_finTouchMoved) return;
    window._finLpDid = true;
    if (navigator.vibrate) navigator.vibrate(15);
    _finShowGlobalPicker(likeBtn);
  }, 450);
}, { passive: true });

document.addEventListener("touchmove", function (e) {
  if (!window._finLpBtn) return;
  var dx = Math.abs(e.touches[0].clientX - _finTouchStartX);
  var dy = Math.abs(e.touches[0].clientY - _finTouchStartY);
  if (dx > 10 || dy > 10) {
    _finTouchMoved = true;
    clearTimeout(window._finLpTimer);
    window._finLpBtn = null;
    window._finLpDid = false;
  }
}, { passive: true });

document.addEventListener("touchend", function (e) {
  if (!window._finLpBtn) return;
  // ignore if user was scrolling
  if (_finTouchMoved) {
    window._finLpBtn = null;
    window._finLpDid = false;
    _finTouchMoved = false;
    return;
  }
  var endX = e.changedTouches[0].clientX;
  var endY = e.changedTouches[0].clientY;
  var finalDx = Math.abs(endX - _finTouchStartX);
  var finalDy = Math.abs(endY - _finTouchStartY);
  if (finalDx > 10 || finalDy > 10) {
    // user scrolled and lifted on the button → don't react
    window._finLpBtn = null;
    window._finLpDid = false;
    return;
  }

  const wasLong = window._finLpDid;
  clearTimeout(window._finLpTimer);
  window._finLastTouch = Date.now();

  if (!wasLong) {
    const likeBtn = e.target.closest(".like-btn") || window._finLpBtn;
    if (likeBtn === window._finLpBtn) {
      const current = likeBtn.dataset.reaction || "";
      console.log("[LIKE] tap → reaction:", current || "like");
      if (current) _finDoReaction(likeBtn, current);
      else _finDoReaction(likeBtn, "like");
    }
  }

  window._finLpBtn = null;
  window._finLpDid = false;
});

document.addEventListener("touchcancel", function () {
  clearTimeout(window._finLpTimer);
  window._finLpBtn = null;
  window._finLpDid = false;
});

// S30.31 — scroll/resize should HIDE picker but not lock the cooldown
// (was: every scroll extended 1.2s cooldown → long-press after scroll didn't work)
window.addEventListener("scroll", function () {
  if (window._finGlobalPicker && window._finGlobalPicker.style.display !== "none") {
    window._finGlobalPicker.style.display = "none";
    window._finPickerTargetBtn = null;
    // no cooldown set here
  }
}, { passive: true });
window.addEventListener("resize", function () {
  if (window._finGlobalPicker && window._finGlobalPicker.style.display !== "none") {
    window._finGlobalPicker.style.display = "none";
    window._finPickerTargetBtn = null;
  }
});

// Escape key
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") _finHideGlobalPicker();
});

// Double-tap → love reaction
window._finDtPost = null;
window._finDtTime = 0;

document.addEventListener("touchend", function (e) {
  const post = e.target.closest(".post");
  if (!post) return;
  if (e.target.closest("button, a, input, .reaction-picker-global")) return;
  // S29.15 - don't fire love-reaction when double-tapping date separator
  if (e.target.closest(".chat-date-sep")) return;

  const now = Date.now();
  if (window._finDtPost === post && now - window._finDtTime < 350) {
    const likeBtn = post.querySelector(".like-btn");
    if (likeBtn) {
      const current = likeBtn.dataset.reaction || "";
      if (current !== "love") _finDoReaction(likeBtn, "love");
    }
    window._finDtPost = null;
  } else {
    window._finDtPost = post;
    window._finDtTime = now;
  }
});

document.addEventListener("dblclick", function (e) {
  const post = e.target.closest(".post");
  if (!post) return;
  if (e.target.closest("button, a, input, .reaction-picker-global")) return;
  // S29.15 - same guard for desktop dblclick
  if (e.target.closest(".chat-date-sep")) return;
  const likeBtn = post.querySelector(".like-btn");
  if (!likeBtn) return;
  const current = likeBtn.dataset.reaction || "";
  if (current !== "love") _finDoReaction(likeBtn, "love");
});

// Initialize existing buttons on page load
export function _finInitExistingReactions() {
  document.querySelectorAll(".like-btn").forEach(function (btn) {
    const r = btn.dataset.reaction || "";
    const c = parseInt(btn.querySelector(".like-count")?.textContent || "0", 10);
    if (r) _finRenderReactionButton(btn, r, c);
  });
}

// Run on load and after feed updates
setTimeout(_finInitExistingReactions, 800);
// Reaction-fix — S29.20 observer disabled.
// It caused an infinite loop: observer → _finInitExistingReactions
// → DOM write → observer again. window.bindPostEvents() already styles
// reactions after every feed render, so the observer is redundant.


// ==================================================
// STRIP OLD LIKE BUTTON HANDLERS (safety net)
// ==================================================
// This removes any per-button event listeners that may have
// been attached by older code. Document-level delegation still works.

// S30.30 — _finStripButtonHandlers REMOVED.
// Was: cloned every .like-btn on every DOM change → in-flight reactions
// silently detached → ♥ never filled. Also reels use .like-btn class,
// so feed reactions broke reels. Document-level delegation in the
// FINAL REACTION SYSTEM handles all buttons without needing this hack.
export function _finStripButtonHandlers() { /* no-op */ }
// No setTimeout calls — delegation does the work.
// S29.14 - catch late-loaded posts (infinite scroll, profile, search, feed refresh)
// Old approach only ran twice at 500ms + 1500ms; posts rendered after that
// never got their handlers stripped. MutationObserver on #feed-list (and any
// future container) re-runs on new .post insertions.
// S30.30 — MutationObserver for _finStripButtonHandlers REMOVED.
// Was calling the strip function on every DOM mutation — combined with
// the function itself, this created a self-triggering loop. Document-level
// reaction delegation in FINAL REACTION SYSTEM doesn't need this.
(function () {
  window.__s2914Observer = true;   // marker so old external refs are no-ops
})();

// ---------- Temporary bridge ----------
window.renderReactionIcon = renderReactionIcon;
window.applyReactionStyles = applyReactionStyles;
window.burstReaction = burstReaction;
window.quickToggleLike = quickToggleLike;
window.buildReactionPicker = buildReactionPicker;
window.closePicker = closePicker;
window.attachReactionHandlers = attachReactionHandlers;
window._finRenderReactionButton = _finRenderReactionButton;
window._finUpdatePostSummary = _finUpdatePostSummary;
window._finShowGlobalPicker = _finShowGlobalPicker;
window._finHideGlobalPicker = _finHideGlobalPicker;
