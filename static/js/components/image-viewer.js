// ==================================================
// CHAT IMAGE VIEWER + SAVE
// ==================================================

export function openImageViewer(src) {
  var old = document.getElementById("img-viewer");
  if (old) old.remove();

  var viewer = document.createElement("div");
  viewer.id = "img-viewer";
  viewer.className = "img-viewer";
  viewer.innerHTML =
    '<div class="img-viewer-backdrop"></div>' +
    '<div class="img-viewer-actions">' +
      '<a class="img-viewer-btn" id="img-viewer-download" download="juktoy-image.jpg" title="ডাউনলোড">' +
        '<i class="fa-solid fa-download"></i>' +
      '</a>' +
      '<button type="button" class="img-viewer-btn" id="img-viewer-close" title="বন্ধ">' +
        '<i class="fa-solid fa-xmark"></i>' +
      '</button>' +
    '</div>' +
    '<img class="img-viewer-img" src="' + src + '" alt="" loading="lazy" decoding="async">';

  document.body.appendChild(viewer);

  var dl = viewer.querySelector("#img-viewer-download");
  dl.href = src;

  viewer.querySelector("#img-viewer-close").addEventListener("click", closeImageViewer);
  viewer.querySelector(".img-viewer-backdrop").addEventListener("click", closeImageViewer);
  viewer.querySelector(".img-viewer-img").addEventListener("click", closeImageViewer);

  if (navigator.vibrate) navigator.vibrate(8);
}

export function closeImageViewer() {
  var v = document.getElementById("img-viewer");
  if (v) v.remove();
}

document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") closeImageViewer();
});

// Click on chat image → open viewer
document.addEventListener("click", function(e) {
  var img = e.target.closest(".chat-msg-image img");
  if (!img) return;
  e.preventDefault();
  e.stopPropagation();
  // Only open if not currently in double-tap sequence
  openImageViewer(img.src);
}, true);


// ---------- Temporary bridge ----------
window.openImageViewer = openImageViewer;
window.closeImageViewer = closeImageViewer;
