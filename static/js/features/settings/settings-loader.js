// ═══════════════════════════════════════════════
// S39 — Unified settings loader
// Replaces 7 separate wrapper functions with one.
// Runs after base window.openSettingsPage, then calls
// every loader in parallel.
// ═══════════════════════════════════════════════
(function () {
  if (window.__s39SettingsLoader) return;
  window.__s39SettingsLoader = true;

  var LOADERS = [
    "_loadBlockedUsers",
    "_loadMyReports",
    "_load2FAStatus",
    "_loadEmailStatus",
    "_loadSessions",
    "_loadLoginHistory",
    "_load2FAToggles"
  ];

  async function runAllLoaders() {
    var tasks = [];
    for (var i = 0; i < LOADERS.length; i++) {
      var name = LOADERS[i];
      var fn = window[name];
      if (typeof fn !== "function") continue;
      try {
        tasks.push(
          Promise.resolve(fn()).catch(function (e) {
            console.error("[S39 settings] " + name + " failed:", e);
          })
        );
      } catch (e) {
        console.error("[S39 settings] " + name + " threw:", e);
      }
    }
    await Promise.all(tasks);
  }

  var _origOpenSettings = window.openSettingsPage;
  if (typeof _origOpenSettings === "function") {
    window.openSettingsPage = async function () {
      await _origOpenSettings.apply(this, arguments);
      await runAllLoaders();
    };
  }

  console.log("[S39] unified settings loader ready");
})();
