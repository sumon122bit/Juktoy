
// S34 — Premium Search Behavior
(function () {
  "use strict";
  if (window.__s34Search) return;
  window.__s34Search = true;

  function $id(x) { return document.getElementById(x); }

  function init() {
    var wrap  = $id("search-wrap");
    var pill  = $id("search-pill");
    var input = $id("search-input");
    var clearBtn = $id("search-clear");
    var icon = $id("search-icon");
    var results = $id("search-results");
    if (!wrap || !pill || !input || !results) return;
    if (input.dataset.s34Bound === "1") return;
    input.dataset.s34Bound = "1";

    // ---- Responsive readonly ----
    function applyMode() {
      // Desktop: editable inline search
      // Mobile: readonly trigger (tap opens full-page)
      if (window.innerWidth >= 900) {
        input.removeAttribute("readonly");
      } else {
        input.setAttribute("readonly", "readonly");
      }
    }
    applyMode();
    window.addEventListener("resize", applyMode);

    // ---- Block old "open full-page on focus" on desktop ----
    function blockOldDesktop(e) {
      if (window.innerWidth >= 900) {
        e.stopImmediatePropagation();
      }
    }
    input.addEventListener("focus", blockOldDesktop, true);
    input.addEventListener("click", blockOldDesktop, true);
    input.addEventListener("touchstart", blockOldDesktop, true);

    // ---- Clear button ----
    function refreshClear() {
      if (!clearBtn) return;
      if ((input.value || "").trim().length > 0) {
        clearBtn.classList.remove("hidden");
      } else {
        clearBtn.classList.add("hidden");
      }
    }
    refreshClear();

    input.addEventListener("input", refreshClear);

    if (clearBtn) {
      clearBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        input.value = "";
        refreshClear();
        results.classList.add("hidden");
        input.setAttribute("aria-expanded", "false");
        try { input.focus(); } catch (err) {}
      });
    }

    // ---- Icon click → focus ----
    if (icon) {
      icon.addEventListener("click", function () {
        try { input.focus(); } catch (e) {}
      });
      icon.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          try { input.focus(); } catch (err) {}
        }
      });
    }

    // ---- Ctrl+K / Cmd+K ----
    document.addEventListener("keydown", function (e) {
      var k = (e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "k") {
        // skip if user typing in another input/textarea
        var tag = (document.activeElement && document.activeElement.tagName) || "";
        if (tag === "TEXTAREA") return;
        e.preventDefault();
        if (window.innerWidth < 900) {
          // mobile: open full-page search
          var pageInput = $id("search-page-input");
          var page = $id("search-page");
          if (page && pageInput && page.classList.contains("hidden")) {
            page.classList.remove("hidden");
            setTimeout(function () { try { pageInput.focus(); } catch (err) {} }, 80);
          }
        } else {
          try { input.focus(); } catch (err) {}
        }
      }
      // Escape → close dropdown + blur
      if (e.key === "Escape" && document.activeElement === input) {
        input.blur();
        results.classList.add("hidden");
        input.setAttribute("aria-expanded", "false");
      }
    }, true);

    // ---- Enter → open full-page search with the query ----
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var q = (input.value || "").trim();
        if (!q) return;
        e.preventDefault();
        var page = $id("search-page");
        var pageInput = $id("search-page-input");
        if (page && pageInput) {
          page.classList.remove("hidden");
          pageInput.value = q;
          try {
            pageInput.dispatchEvent(new Event("input", { bubbles: true }));
          } catch (err) {}
          setTimeout(function () { try { pageInput.focus(); } catch (err) {} }, 60);
        }
        results.classList.add("hidden");
        input.setAttribute("aria-expanded", "false");
      }
    });

    // ---- aria-expanded sync ----
    var mo = null;
    try {
      mo = new MutationObserver(function () {
        var open = !results.classList.contains("hidden");
        input.setAttribute("aria-expanded", open ? "true" : "false");
      });
      mo.observe(results, { attributes: true, attributeFilter: ["class"] });
    } catch (e) {}

    // ---- Keyboard navigation (↑ ↓ Enter) inside dropdown ----
    input.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      if (results.classList.contains("hidden")) return;
      var items = results.querySelectorAll(
        ".search-body .search-result, .search-body .search-hashtag-item, .search-body .search-post-item"
      );
      if (!items.length) return;

      var cur = Array.prototype.indexOf.call(
        items,
        results.querySelector(".search-body .s34-active")
      );

      if (e.key === "ArrowDown") {
        e.preventDefault();
        var n1 = cur < 0 ? 0 : (cur + 1) % items.length;
        items.forEach(function (it, i) { it.classList.toggle("s34-active", i === n1); });
        items[n1].scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        var n2 = cur < 0 ? items.length - 1 : (cur - 1 + items.length) % items.length;
        items.forEach(function (it, i) { it.classList.toggle("s34-active", i === n2); });
        items[n2].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        var active = results.querySelector(".search-body .s34-active");
        if (active) {
          e.preventDefault();
          active.click();
          results.classList.add("hidden");
        }
      }
    });

    // ---- Click outside → close ----
    document.addEventListener("click", function (e) {
      if (!e.target.closest("#search-wrap")) {
        results.classList.add("hidden");
        input.setAttribute("aria-expanded", "false");
      }
    });

    console.log("[S34] premium search ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();


