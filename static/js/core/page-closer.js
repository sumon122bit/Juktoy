// S29.10 - Unified page-closer (replaces 7-deep wrapper chain)
// Previously window._closeTopPage was redefined 7 times via
//   const _origCloseTopPageX = window._closeTopPage;
//   window._closeTopPage = function() { ... return _origCloseTopPageX(); };
// producing an 8-level call chain. Any missed wrap meant that page
// type could never be closed via back button. This unified version
// uses a single dispatch table so adding a new overlay is one line.
window._closeTopPage = function _closeTopPageUnified() {
  // --- Step 1: if a chat conversation is open, close it first ---
  var cw = document.getElementById("chat-window");
  if (cw && !cw.classList.contains("hidden")) {
    try { if (typeof stopChatPolling === "function") window.stopChatPolling(); } catch (e) {}
    try { if (typeof _exitChatMultiSelect === "function") _exitChatMultiSelect(); } catch (e) {}
    try { if (typeof window._closeChatSearch === "function") window._closeChatSearch(); } catch (e) {}
    cw.classList.add("hidden");
    if (typeof window.currentChatUser !== "undefined") window.currentChatUser = null;
    if (typeof window.lastMsgCount !== "undefined") window.lastMsgCount = 0;
    if (typeof window._PageStack !== "undefined" && window._PageStack[window._PageStack.length - 1] === "chat") {
      window._PageStack.pop();
    }
    try { if (typeof loadConversations === "function") window.loadConversations(); } catch (e) {}
    try { if (typeof window._updateOverlayClass === "function") window._updateOverlayClass(); } catch (e) {}
    return true;
  }

  // --- Step 2: dispatch on stack top ---
  if (typeof window._PageStack === "undefined" || !window._PageStack.length) return false;
  var top = window._PageStack[window._PageStack.length - 1];

  var CLOSERS = {
    "profile": function () {
      var el = document.getElementById("profile-page");
      if (el) el.classList.add("hidden");
    },
    "messages": function () {
      try { if (typeof stopChatPolling === "function") window.stopChatPolling(); } catch (e) {}
      var el = document.getElementById("messages-page");
      if (el) el.classList.add("hidden");
    },
    "explore": function () {
      var el = document.getElementById("explore-page");
      if (el) el.classList.add("hidden");
    },
    "hashtag": function () {
      var el = document.getElementById("hashtag-page");
      if (el) el.classList.add("hidden");
    },
    "story-viewer": function () {
      try { if (typeof closeStoryViewer === "function") window.closeStoryViewer(); } catch (e) {}
    },
    "saved": function () {
      var el = document.getElementById("saved-page");
      if (el) el.classList.add("hidden");
    },
    "notifications": function () {
      var el = document.getElementById("notifications-page");
      if (el) el.classList.add("hidden");
    },
    "reels": function () {
      try { if (typeof closeReelsPage === "function") closeReelsPage(); } catch (e) {}
    },
    "settings": function () {
      var el = document.getElementById("settings-page");
      if (el) el.classList.add("hidden");
    },
    "search-page": function () {
      // S39 — close search page via exposed _close
      if (typeof window._closeSearchPage === "function") {
        window._closeSearchPage();
      } else {
        var el = document.getElementById("search-page");
        if (el) el.classList.add("hidden");
      }
    },
    "admin": function () {
      try { if (typeof window.closeAdminPage === "function") window.closeAdminPage(); } catch (e) {}
    },
    "chat": function () {
      // fallback when chat-window was already hidden
      try { if (typeof stopChatPolling === "function") window.stopChatPolling(); } catch (e) {}
      var el = document.getElementById("chat-window");
      if (el) el.classList.add("hidden");
      if (typeof window.currentChatUser !== "undefined") window.currentChatUser = null;
    }
  };

  var closer = CLOSERS[top];
  if (!closer) return false;

  window._PageStack.pop();
  try { closer(); }
  catch (err) { console.error("[S29.10] closer failed for", top, err); }
  try { if (typeof window._updateOverlayClass === "function") window._updateOverlayClass(); } catch (e) {}
  return true;
};
  window._closeTopPage = window._closeTopPage;
console.log("[S29.10] unified window._closeTopPage registered");


