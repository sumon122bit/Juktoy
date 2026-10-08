// ==================================================
// OVERLAY PAGES — track body class + back button chain
// ==================================================

export function _updateOverlayClass() {
  var ids = ["messages-page", "profile-page", "reels-page", "explore-page",
             "hashtag-page", "notifications-page", "saved-page", "settings-page",
             "story-viewer", "onboarding"];
  var anyOpen = false;
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (el && !el.classList.contains("hidden")) { anyOpen = true; break; }
  }
  document.body.classList.toggle("overlay-open", anyOpen);
}

// Watch for class changes on overlay pages
["messages-page", "profile-page", "reels-page", "explore-page",
 "hashtag-page", "notifications-page", "saved-page", "settings-page",
 "story-viewer", "onboarding"].forEach(function(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var obs = new MutationObserver(_updateOverlayClass);
  obs.observe(el, { attributes: true, attributeFilter: ["class"] });
});
_updateOverlayClass();

// ---------- Chat window back button handling ----------
// When chat window is open, back button should close chat window first,
// then return to messages list.

(function() {
  var _chatStackDepth = 0;

  // Override openChat to push another history entry
  var _origOpenChat = window.openChat;
  if (typeof openChat === "function") {
    var _orig = openChat;
    window.openChat = async function(username) {
      await _orig(username);
      var cw = document.getElementById("chat-window");
      if (cw && !cw.classList.contains("hidden")) {
        // Push another state for chat window itself
        history.pushState({ page: "chat" }, "", "");
        _chatStackDepth++;
        // Fixed: also track "chat" in window._PageStack so back-stack works correctly
        if (typeof window._PageStack !== "undefined" && window._PageStack[window._PageStack.length - 1] !== "chat") {
          window._PageStack.push("chat");
        }
      }
    };
    // Reassign the actual variable used in code
    try { openChat = window.openChat; } catch (e) {}
  }

  // NOTE: chat back-handling now goes through window._closeTopPage("chat")
  // to avoid double-closing the messages page.
})();

// Also: when openChat is called, ensure body overlay class updates
document.addEventListener("click", function(e) {
  if (e.target.closest(".conv-item") || e.target.closest(".new-chat-result")) {
    setTimeout(_updateOverlayClass, 100);
  }
}, true);

// Update on chat-close click
document.addEventListener("click", function(e) {
  if (e.target.closest("#chat-close")) {
    setTimeout(_updateOverlayClass, 50);
  }
}, true);

// Make sure window._closeTopPage knows about chat state
const _origCloseTopPageChat = window._closeTopPage;
window._closeTopPage = function() {
  var cw = document.getElementById("chat-window");
  if (cw && !cw.classList.contains("hidden")) {
    // CRITICAL: pop "chat" from window._PageStack so stack stays consistent
    if (typeof window._PageStack !== "undefined" && window._PageStack.length > 0) {
      if (window._PageStack[window._PageStack.length - 1] === "chat") window._PageStack.pop();
    }
    if (typeof stopChatPolling === "function") stopChatPolling();
    cw.classList.add("hidden");
    window.currentChatUser = null;
    window.lastMsgCount = 0;
    if (typeof loadConversations === "function") loadConversations();
    _updateOverlayClass();
    return true;
  }
  var result = _origCloseTopPageChat();
  _updateOverlayClass();
  return result;
};

// ---------- Temporary bridge ----------
window._updateOverlayClass = _updateOverlayClass;
