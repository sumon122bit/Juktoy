// ==================================================
// BADGE UPDATE — Bulletproof
// ==================================================

// Call window.updateNotifBadge after every meaningful action
window._origLoadFeedForBadge = window.loadFeed;
window.loadFeed = async function () {
  await window._origLoadFeedForBadge();
  window.updateNotifBadge().catch(() => {});
};

// Also update on visibility change (user returns to tab)
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && window.state && window.state.me) {
    window.updateNotifBadge().catch(() => {});
    window.updateUnreadBadge().catch(() => {});
  }
});

// Force update right now (if logged in)
if (window.state && window.state.me) {
  setTimeout(() => window.updateNotifBadge().catch(() => {}), 500);
}


