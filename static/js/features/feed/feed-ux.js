// ==================================================
// BETTER FEED UX — skeleton + empty state + pull-to-refresh
// ==================================================

export function _feedSkeletonHTML() {
  var sk = '';
  for (var i = 0; i < 3; i++) {
    sk += '<div class="post-skeleton">' +
      '<div class="sk-header">' +
        '<div class="sk-avatar"></div>' +
        '<div class="sk-lines">' +
          '<div class="sk-line sk-line-1"></div>' +
          '<div class="sk-line sk-line-2"></div>' +
        '</div>' +
      '</div>' +
      '<div class="sk-content">' +
        '<div class="sk-line sk-line-3"></div>' +
        '<div class="sk-line sk-line-4"></div>' +
      '</div>' +
    '</div>';
  }
  return sk;
}

export function _feedEmptyHTML() {
  return '<div class="empty-state">' +
    '<div class="empty-state-icon">🌱</div>' +
    '<h3 class="empty-state-title">ফিড এখনো ফাঁকা</h3>' +
    '<p class="empty-state-text">প্রথম পোস্ট আপনিই করুন — সবাই দেখতে পাবে!<br>অথবা নতুন মানুষ খুঁজে ফলো করুন।</p>' +
    '<div class="empty-state-actions">' +
      '<button type="button" class="empty-state-btn" id="empty-create-post">' +
        '<i class="fa-solid fa-plus"></i> পোস্ট তৈরি করুন' +
      '</button>' +
      '<button type="button" class="empty-state-btn secondary" id="empty-explore">' +
        '<i class="fa-regular fa-compass"></i> মানুষ খুঁজুন' +
      '</button>' +
    '</div>' +
  '</div>';
}

export function _bindEmptyFeedEvents() {
  var c = document.getElementById("empty-create-post");
  if (c) c.addEventListener("click", function() {
    var ta = document.getElementById("post-content");
    if (ta) { ta.focus(); ta.scrollIntoView({behavior:"smooth", block:"center"}); }
  });
  var e = document.getElementById("empty-explore");
  if (e) e.addEventListener("click", function() {
    if (typeof window.openExplorePage === "function") window.openExplorePage();
  });
}

// Override loadFeed to show skeleton + better empty state
var _origLoadFeedForUX = window.loadFeed;
window.loadFeed = async function () {
  var list = document.getElementById("feed-list");
  if (!list) return _origLoadFeedForUX();

  var hadContent = list.children.length > 0;
  if (!hadContent) list.innerHTML = _feedSkeletonHTML();

  await _origLoadFeedForUX();

  var first = list.firstElementChild;
  if (first && first.classList.contains("post") &&
      first.textContent.indexOf("প্রথম পোস্ট আপনিই করুন") !== -1) {
    list.innerHTML = _feedEmptyHTML();
    _bindEmptyFeedEvents();
  }
};

// ============== Pull to refresh ==============

var _ptrReady = false;
export function _setupPullToRefresh() {
  if (_ptrReady) return;
  _ptrReady = true;

  var startY = 0;
  var pulling = false;
  var indicator = null;

  function isHomeVisible() {
    var hideIds = ["profile-page", "messages-page", "explore-page", "hashtag-page",
                   "notifications-page", "saved-page", "reels-page", "settings-page"];
    for (var i = 0; i < hideIds.length; i++) {
      var el = document.getElementById(hideIds[i]);
      if (el && !el.classList.contains("hidden")) return false;
    }
    var av = document.getElementById("app-view");
    return av && !av.classList.contains("hidden");
  }

  document.addEventListener("touchstart", function (e) {
    if (!isHomeVisible()) return;
    if (window.scrollY > 5) return;
    if (e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    if (!pulling) return;
    if (window.scrollY > 5) { pulling = false; return; }
    var dy = e.touches[0].clientY - startY;
    if (dy > 70) {
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.className = "pull-refresh-indicator";
        document.body.appendChild(indicator);
        if (navigator.vibrate) navigator.vibrate(8);
      }
      if (dy > 120) {
        indicator.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> ছেড়ে দিন';
        indicator.classList.add("ready");
      } else {
        indicator.innerHTML = '<i class="fa-solid fa-arrow-down"></i> টেনে ছাড়ুন';
        indicator.classList.remove("ready");
      }
    } else if (indicator) {
      indicator.parentNode.removeChild(indicator);
      indicator = null;
    }
  }, { passive: true });

  document.addEventListener("touchend", async function () {
    if (!indicator) { pulling = false; return; }
    if (!indicator.classList.contains("ready")) {
      indicator.parentNode.removeChild(indicator);
      indicator = null;
      pulling = false;
      return;
    }
    indicator.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> লোড হচ্ছে...';
    try {
      await window.loadFeed();
      if (typeof updateNotifBadge === "function") updateNotifBadge().catch(function(){});
      if (typeof updateUnreadBadge === "function") updateUnreadBadge().catch(function(){});
      if (navigator.vibrate) navigator.vibrate([10, 50, 10]);
    } catch (err) {}
    setTimeout(function () {
      if (indicator && indicator.parentNode) indicator.parentNode.removeChild(indicator);
      indicator = null;
    }, 400);
    pulling = false;
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () { setTimeout(_setupPullToRefresh, 500); });
} else {
  setTimeout(_setupPullToRefresh, 500);
}


// ---------- Temporary bridge ----------
window._feedSkeletonHTML = _feedSkeletonHTML;
window._feedEmptyHTML = _feedEmptyHTML;
window._bindEmptyFeedEvents = _bindEmptyFeedEvents;
window._setupPullToRefresh = _setupPullToRefresh;
