// S21.3e — _attachReelProgress (force top-level)
// Ensures window.loadReels() can always find this
if (typeof window._attachReelProgress !== "function") {
  window._attachReelProgress = function _attachReelProgress(video, item) {
    if (!video || !item) return;
    var fill = item.querySelector(".reel-progress-fill");
    if (!fill) return;

    function update() {
      if (video.duration && isFinite(video.duration) && video.duration > 0) {
        var pct = (video.currentTime / video.duration) * 100;
        fill.style.width = pct + "%";
      }
    }

    // Avoid double-attach
    if (video.dataset.progressAttached === "1") return;
    video.dataset.progressAttached = "1";

    video.addEventListener("timeupdate", update);
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("seeked", update);
    video.addEventListener("play", update);
  };
  console.log("[S21.3e] _attachReelProgress registered");
}


// ═══════════════════════════════════════════════
