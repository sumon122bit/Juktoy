
// ==================================================
// BOOT
// ==================================================

(function boot() {
  // Apply theme first (before any other rendering)
  const _themeFn = typeof readSavedTheme === "function" ? readSavedTheme : (window.readSavedTheme || null);
  const _applyFn = typeof applyTheme === "function" ? applyTheme : (window.applyTheme || null);
  if (_themeFn && _applyFn) {
    const saved = _themeFn() || "light";
    _applyFn(saved);
  } else {
    // Fallback: try after DOM ready (in case module loads late)
    document.addEventListener("DOMContentLoaded", function() {
      if (typeof window.readSavedTheme === "function" && typeof window.applyTheme === "function") {
        window.applyTheme(window.readSavedTheme() || "light");
      }
    });
  }

  // Fill stories (guarded — stories.js loads after app.js)
  if (typeof fillStoryAvatars === "function") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fillStoryAvatars);
    } else {
      fillStoryAvatars();
    }
  }

  // Auto-login if session exists
  (async () => {
    try {
      const { user } = await api("/api/me");
      if (user) await window.enterApp();
    } catch (e) {}
  })();
})();

