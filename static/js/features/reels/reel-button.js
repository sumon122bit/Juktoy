// S36 — Reel button click → open reel upload modal
(function () {
  "use strict";
  if (window.__s36ReelBtn) return;
  window.__s36ReelBtn = true;

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("#btn-pick-reel");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    // Preferred: open reel upload modal (existing flow in app.js)
    if (typeof window.openReelUpload === "function") {
      try { window.openReelUpload(); return; } catch (err) {}
    }

    // Fallback A: click the hidden modal's internal button if present
    var insideBtn = document.getElementById("btn-choose-reel");
    var modal = document.getElementById("reel-upload-modal");
    if (modal) {
      modal.classList.remove("hidden");
      // reset state if helper exists
      if (typeof window.resetReelUpload === "function") {
        try { window.resetReelUpload(); } catch (err) {}
      }
      return;
    }

    // Fallback B: open reels page
    if (typeof window.openReelsPage === "function") {
      try { window.openReelsPage(); } catch (err) {}
    }
  }, true);

  console.log("[S36] reel button wired");
})();
