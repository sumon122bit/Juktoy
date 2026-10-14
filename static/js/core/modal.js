
// ==================================================
// MODAL — auto-scroll input into view on focus
// ==================================================

(function () {
  if (window._modalKbV2) return;
  window._modalKbV2 = true;

  function scrollInputIntoView(el) {
    var mc = el.closest(".modal-content");
    if (!mc) return;
    var rect = el.getBoundingClientRect();
    var vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    var target = vh * 0.35; // keep input 35% from top

    if (rect.top > target) {
      mc.scrollTop += (rect.top - target);
    }
  }

  document.addEventListener("focusin", function (e) {
    var t = e.target;
    if (!t || (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA")) return;
    if (!t.closest(".modal")) return;
    // Delay so keyboard finishes appearing
    setTimeout(function () { scrollInputIntoView(t); }, 100);
    setTimeout(function () { scrollInputIntoView(t); }, 350);
  });

  // Track viewport resize (keyboard show/hide)
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () {
      var t = document.activeElement;
      if (!t || (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA")) return;
      if (!t.closest(".modal")) return;
      scrollInputIntoView(t);
    });
  }

  console.log("[Modal] keyboard scroll v2 attached ✅");
})();


