// ==================================================
// STORY REACTIONS
// ==================================================

document.addEventListener("click", async function(e) {
  var btn = e.target.closest(".sv-react");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();

  var bar = document.getElementById("sv-reactions-bar");
  if (!bar) return;
  var storyId = bar.dataset.storyId;
  if (!storyId) return;

  var reaction = btn.dataset.r;
  if (!reaction) return;

  // Visual feedback
  btn.classList.add("active");
  if (navigator.vibrate) navigator.vibrate(10);

  // Flying emoji animation
  var fly = document.createElement("div");
  fly.className = "sv-react-fly";
  fly.textContent = btn.textContent;
  var rect = btn.getBoundingClientRect();
  fly.style.left = rect.left + rect.width / 2 + "px";
  fly.style.top = rect.top + "px";
  document.body.appendChild(fly);
  setTimeout(function() { if (fly.parentNode) fly.parentNode.removeChild(fly); }, 1200);

  try {
    await api("/api/stories/" + storyId + "/react", {
      method: "POST",
      body: JSON.stringify({ reaction: reaction }),
    });
    // S18.9f — removed toast (visual feedback sufficient)
  } catch (err) {
    btn.classList.remove("active");
    // Duplicate reaction is not an error
    if (err.message && err.message.indexOf("নিজের") !== -1) {
      showToast("নিজের স্টোরিতে reaction দেওয়া যাবে না");
    }
  } finally {
    setTimeout(function() { btn.classList.remove("active"); }, 600);
  }
}, true);


// ==================================================
// S19.12 — STORY VIEWER: swipe-down to close
// ==================================================
(function () {
  let startY = 0;
  let startX = 0;
  let dragging = false;
  let currentY = 0;

  function isViewerOpen() {
    var v = document.getElementById("story-viewer");
    return v && !v.classList.contains("hidden");
  }

  document.addEventListener("touchstart", function (e) {
    if (!isViewerOpen()) return;
    if (e.touches.length !== 1) return;
    // Don't start if on interactive elements
    if (e.target.closest(".sv-nav, .sv-close, .sv-delete, .sv-reactions-bar, .sv-reply-bar, button")) return;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    currentY = startY;
    dragging = true;
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    if (!dragging) return;
    currentY = e.touches[0].clientY;
    var dy = currentY - startY;
    var dx = e.touches[0].clientX - startX;
    // Only vertical down
    if (dy < 0) return;
    if (Math.abs(dx) > Math.abs(dy)) return;
    var container = document.querySelector(".sv-container");
    if (!container) return;
    container.style.transition = "none";
    container.style.transform = "translateY(" + dy + "px) scale(" + (1 - Math.min(dy / 1000, 0.15)) + ")";
    container.style.opacity = String(Math.max(1 - dy / 400, 0.3));
  }, { passive: true });

  document.addEventListener("touchend", function () {
    if (!dragging) return;
    var dy = currentY - startY;
    dragging = false;
    var container = document.querySelector(".sv-container");
    if (!container) return;
    if (dy > 100) {
      // Close
      container.style.transition = "transform 0.25s ease, opacity 0.25s ease";
      container.style.transform = "translateY(100vh) scale(0.85)";
      container.style.opacity = "0";
      setTimeout(function () {
        if (typeof closeStoryViewer === "function") closeStoryViewer();
        container.style.transform = "";
        container.style.opacity = "";
        container.style.transition = "";
      }, 260);
    } else {
      // Snap back
      container.style.transition = "transform 0.25s var(--ease-spring), opacity 0.25s";
      container.style.transform = "";
      container.style.opacity = "";
      setTimeout(function () {
        container.style.transition = "";
      }, 280);
    }
  });
})();


// ==================================================
// S19.6 — STORY VIEWER: click profile → open profile
// ==================================================
document.addEventListener("click", function (e) {
  var el = e.target.closest(".sv-avatar, .sv-name");
  if (!el) return;
  // Find current story group
  if (typeof storyGroups === "undefined" || !storyGroups.length) return;
  if (typeof currentGroupIdx !== "number") return;
  var group = storyGroups[currentGroupIdx];
  if (!group || !group.user) return;
  e.preventDefault();
  e.stopPropagation();

  // Close story viewer first
  if (typeof closeStoryViewer === "function") {
    closeStoryViewer();
  }
  // Slight delay so viewer closes before profile opens
  setTimeout(function () {
    if (typeof openProfile === "function") openProfile(group.user.username);
  }, 150);
}, true);


// ==================================================
// STORY TIMER CONTROL (pause / resume / reset)
// ==================================================

export function _storyTimerStart(duration) {
  clearTimeout(window.storyTimer);
  window._storyTimerDuration = duration || 5000;
  window._storyTimerRemaining = window._storyTimerDuration;
  window._storyTimerStartTime = Date.now();
  window._storyTimerPaused = false;
  window.storyTimer = setTimeout(function() { nextStory(); }, window._storyTimerRemaining);
  _updateStoryProgressBar(window._storyTimerDuration);
}

export function _storyTimerStop() {
  clearTimeout(window.storyTimer);
  window.storyTimer = null;
  window._storyTimerPaused = false;
  window._storyTimerRemaining = window._storyTimerDuration;
}

export function _storyTimerPause() {
  if (window._storyTimerPaused || !window.storyTimer) return;
  clearTimeout(window.storyTimer);
  window.storyTimer = null;
  var elapsed = Date.now() - window._storyTimerStartTime;
  window._storyTimerRemaining = Math.max(500, window._storyTimerRemaining - elapsed);
  window._storyTimerPaused = true;
  _freezeStoryProgressBar();
}

export function _storyTimerResume() {
  if (!window._storyTimerPaused) return;
  window._storyTimerPaused = false;
  window._storyTimerStartTime = Date.now();
  window.storyTimer = setTimeout(function() { nextStory(); }, window._storyTimerRemaining);
  _resumeStoryProgressBar(window._storyTimerRemaining);
}

export function _storyTimerReset() {
  _storyTimerStart(window._storyTimerDuration);
}

// Progress bar sync — restart CSS animation
export function _updateStoryProgressBar(duration) {
  var active = document.querySelector(".sv-progress-bar.active .sv-progress-fill");
  if (!active) return;
  active.style.transition = "none";
  active.style.width = "0%";
  void active.offsetWidth;
  active.style.transition = "width " + (duration / 1000) + "s linear";
  active.style.width = "100%";
}

export function _freezeStoryProgressBar() {
  var active = document.querySelector(".sv-progress-bar.active .sv-progress-fill");
  if (!active) return;
  var w = getComputedStyle(active).width;
  active.style.transition = "none";
  active.style.width = w;
}

export function _resumeStoryProgressBar(remaining) {
  var active = document.querySelector(".sv-progress-bar.active .sv-progress-fill");
  if (!active) return;
  var currentPct = 0;
  try { currentPct = parseFloat(getComputedStyle(active).width) /
    parseFloat(getComputedStyle(active.parentNode).width) * 100 || 0; } catch (e) {}
  var remainingPct = 100 - currentPct;
  var durSec = remaining / 1000;
  active.style.transition = "none";
  active.style.width = currentPct + "%";
  void active.offsetWidth;
  active.style.transition = "width " + durSec + "s linear";
  active.style.width = "100%";
}

// ---- Event wiring ----

// S30.33 — reset timer on reaction, but ONLY for image stories
// (was: video stories got a 5s timer after reacting → advanced before video ended)
document.addEventListener("click", function(e) {
  var btn = e.target.closest(".sv-react");
  if (!btn) return;
  var group = storyGroups[currentGroupIdx];
  if (!group) return;
  var story = group.stories[currentStoryIdx];
  if (!story) return;
  // skip for video stories — they use onended
  if (story.media_type === "video") return;
  _storyTimerReset();
}, true);

// Pause on keyboard open (input focus)
document.addEventListener("focusin", function(e) {
  if (e.target && e.target.id === "sv-reply-input") {
    _storyTimerPause();
  }
});

// Resume on keyboard close (input blur)
document.addEventListener("focusout", function(e) {
  if (e.target && e.target.id === "sv-reply-input") {
    setTimeout(function() {
      // S30.29 — only reset timer if viewer is still OPEN
      // (was: viewer close via X triggered focusout → timer restart → next story opened)
      var v = document.getElementById("story-viewer");
      if (!v || v.classList.contains("hidden")) return;
      if (document.getElementById("sv-reply-input") &&
          document.activeElement !== document.getElementById("sv-reply-input")) {
        _storyTimerReset();
      }
    }, 100);
  }
});

// Pause on touch hold (long press on media)
document.addEventListener("touchstart", function(e) {
  if (!e.target.closest(".sv-media")) return;
  if (e.target.closest(".sv-reactions-bar")) return;
  if (e.target.closest(".sv-reply-bar")) return;
  // don't pause immediately — wait to see if it's a hold
  window._svHoldTimer = setTimeout(function() {
    _storyTimerPause();
    window._svHolding = true;
  }, 250);
}, { passive: true });

document.addEventListener("touchend", function() {
  clearTimeout(window._svHoldTimer);
  if (window._svHolding) {
    window._svHolding = false;
    _storyTimerResume();
  }
});

document.addEventListener("touchcancel", function() {
  clearTimeout(window._svHoldTimer);
  if (window._svHolding) {
    window._svHolding = false;
    _storyTimerResume();
  }
});



// ---------- Temporary bridge ----------
window._storyTimerStart = _storyTimerStart;
window._storyTimerStop = _storyTimerStop;
window._storyTimerPause = _storyTimerPause;
window._storyTimerResume = _storyTimerResume;
window._storyTimerReset = _storyTimerReset;
window._updateStoryProgressBar = _updateStoryProgressBar;
window._freezeStoryProgressBar = _freezeStoryProgressBar;
window._resumeStoryProgressBar = _resumeStoryProgressBar;
