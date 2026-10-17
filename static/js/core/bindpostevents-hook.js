// ==================================================
// BIND POST EVENTS HOOK — attaches hashtag listeners
// ==================================================

const _origBindPostEvents = window.bindPostEvents;
window.bindPostEvents = function() {
  if (typeof _origBindPostEvents === "function") _origBindPostEvents();
  if (typeof window.attachHashtagListeners === "function") {
    window.attachHashtagListeners(document.getElementById("feed-list"));
  }
};
