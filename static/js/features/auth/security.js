// ==================================================
// S6 — LOGOUT ALL DEVICES
// ==================================================

(function () {
  var btn = document.getElementById("btn-logout-all");
  if (!btn) return;

  btn.addEventListener("click", async function () {
    if (!confirm("সব অন্য ডিভাইস থেকে লগআউট করবেন?\n\nএই ডিভাইস চালু থাকবে।")) return;

    var oldHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> প্রস্তুত হচ্ছে...';

    try {
      await window.api("/api/me/logout-all", { method: "POST" });
      window.showToast("✅ সব ডিভাইস থেকে লগআউট হয়েছে");
    } catch (err) {
      alert(err.message || "কিছু ভুল হয়েছে");
    } finally {
      btn.disabled = false;
      btn.innerHTML = oldHTML;
    }
  });

  console.log("[S6] logout-all attached ✅");
})();


// ==================================================
// S7 — HTTP WARNING BANNER (non-localhost only)
// ==================================================

(function () {
  if (window._s7BannerInit) return;
  window._s7BannerInit = true;

  function isLocalhost() {
    var h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0";
  }

  function bannerDismissed() {
    try { return localStorage.getItem("juktoy_https_banner_dismissed") === "1"; }
    catch (e) { return false; }
  }

  function shouldShow() {
    return window.location.protocol !== "https:"
        && !isLocalhost()
        && !bannerDismissed();
  }

  function show() {
    if (!shouldShow()) return;
    if (document.getElementById("https-warning-banner")) return;

    var b = document.createElement("div");
    b.id = "https-warning-banner";
    b.className = "https-warning-banner";
    b.innerHTML =
      '<i class="fa-solid fa-triangle-exclamation"></i>' +
      '<span>এই সংযোগটি নিরাপদ নয় (HTTP)। পাসওয়ার্ড বা গোপন তথ্য শেয়ার করার আগে সতর্ক থাকুন।</span>' +
      '<button type="button" class="hwb-close" aria-label="বন্ধ করুন"><i class="fa-solid fa-xmark"></i></button>';

    document.body.appendChild(b);

    b.querySelector(".hwb-close").addEventListener("click", function () {
      try { localStorage.setItem("juktoy_https_banner_dismissed", "1"); } catch (e) {}
      b.remove();
    });
  }

  // Show after a short delay so it doesn't clash with entry animations
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(show, 800); });
  } else {
    setTimeout(show, 800);
  }

  console.log("[S7] https warning banner init ✅");
})();




