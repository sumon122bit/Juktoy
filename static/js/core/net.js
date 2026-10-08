
// ═══════════════════════════════════════════════
// S30.9 — Offline banner + network resilience
// ═══════════════════════════════════════════════
(function () {
  if (window.__offlineBanner) return;
  window.__offlineBanner = true;

  var banner = null;
  var hideTimer = null;

  function ensureBanner() {
    if (banner) return banner;
    banner = document.createElement("div");
    banner.id = "net-banner";
    banner.style.cssText = [
      "position:fixed",
      "top:0","left:0","right:0",
      "z-index:9999999",
      "background:linear-gradient(90deg,#dc2626,#ef4444)",
      "color:#fff",
      "font-family:inherit",
      "font-size:13px",
      "font-weight:700",
      "text-align:center",
      "padding:8px 16px",
      "transform:translateY(-100%)",
      "transition:transform .3s cubic-bezier(.34,1.56,.64,1)",
      "box-shadow:0 4px 16px rgba(0,0,0,.25)",
      "display:flex","align-items:center","justify-content:center","gap:8px",
      "pointer-events:none"
    ].join(";");
    banner.innerHTML = '<i class="fa-solid fa-wifi"></i><span>ইন্টারনেট সংযোগ নেই — আবার সংযোগ করুন</span>';
    document.body.appendChild(banner);
    return banner;
  }

  function showBanner(text, kind) {
    var b = ensureBanner();
    if (kind === "warn") {
      b.style.background = "linear-gradient(90deg,#d97706,#f59e0b)";
      b.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i><span>' + text + '</span>';
    } else if (kind === "ok") {
      b.style.background = "linear-gradient(90deg,#059669,#10b981)";
      b.innerHTML = '<i class="fa-solid fa-check-circle"></i><span>' + text + '</span>';
    } else {
      b.style.background = "linear-gradient(90deg,#dc2626,#ef4444)";
      b.innerHTML = '<i class="fa-solid fa-wifi"></i><span>' + text + '</span>';
    }
    b.style.transform = "translateY(0)";
    if (hideTimer) clearTimeout(hideTimer);
    if (kind === "ok") {
      hideTimer = setTimeout(hideBanner, 2200);
    }
  }

  function hideBanner() {
    if (!banner) return;
    banner.style.transform = "translateY(-100%)";
  }

  // Native offline/online events
  window.addEventListener("offline", function () {
    showBanner("ইন্টারনেট সংযোগ নেই", "error");
  });
  window.addEventListener("online", function () {
    showBanner("সংযোগ ফিরে এসেছে", "ok");
  });

  // Expose for api() to call
  window.__showNetBanner = showBanner;
  window.__hideNetBanner = hideBanner;

  // Initial state
  if (!navigator.onLine) showBanner("ইন্টারনেট সংযোগ নেই", "error");

  console.log("[OFFLINE_BANNER] ready");
})();


// ═══════════════════════════════════════════════
// S30.9 — wrap api() with 1 retry on network failure
// (only network throws, not 4xx/5xx — avoid double POST)
// ═══════════════════════════════════════════════
(function () {
  if (window.__apiRetry) return;
  window.__apiRetry = true;
  if (typeof window.api !== "function") return;

  var _origApi = window.api;

  window.api = async function (url, options) {
    var attempts = 0;
    var maxAttempts = 2;   // original + 1 retry
    var lastErr = null;

    while (attempts < maxAttempts) {
      try {
        return await _origApi(url, options);
      } catch (err) {
        lastErr = err;
        var msg = (err && err.message) || "";
        var isNetwork = /Failed to fetch|NetworkError|Load failed|ERR_NETWORK|ERR_INTERNET|Network request failed/i.test(msg);
        var isMethod = options && options.method ? options.method.toUpperCase() : "GET";
        var isSafe = (isMethod === "GET" || isMethod === "HEAD");

        if (!isNetwork || !isSafe) throw err;

        attempts++;
        if (attempts >= maxAttempts) throw err;

        try { if (window.__showNetBanner) window.__showNetBanner("পুনরায় চেষ্টা করা হচ্ছে...", "warn"); } catch (e) {}
        await new Promise(function (r) { setTimeout(r, 900); });
      }
    }
    throw lastErr || new Error("api failed");
  };

  console.log("[API_RETRY] ready");
})();


// ═══════════════════════════════════════════════
// S30.11 — Unified badge poller (was: 2×8s intervals)
// ═══════════════════════════════════════════════
(function () {
  if (window.__badgePoll) return;
  window.__badgePoll = true;

  var _timer = null;
  var _lastRun = 0;

  function tick() {
    try {
      var s = (typeof state !== "undefined" && state) || window.state;
      if (!s || !s.me) return;
      if (document.hidden) return;
      if (typeof updateUnreadBadge === "function") updateUnreadBadge().catch(function(){});
      if (typeof updateNotifBadge === "function") updateNotifBadge().catch(function(){});
      _lastRun = Date.now();
    } catch (e) {}
  }

  function start() {
    if (_timer) return;
    _timer = setInterval(tick, 10000);   // 10s (was 8s + 8s = 2 calls)
    setTimeout(tick, 200);               // immediate first tick
  }

  // visibility-aware — return to tab → immediate poll
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) setTimeout(tick, 300);
  });

  // start when user logs in
  if (typeof window._enterAppHooks !== "undefined" && Array.isArray(window._enterAppHooks)) {
    window._enterAppHooks.push(function () { start(); });
  } else {
    // retry fallback
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (typeof window._enterAppHooks !== "undefined" && Array.isArray(window._enterAppHooks)) {
        window._enterAppHooks.push(function () { start(); });
        clearInterval(t);
      } else if (tries > 20) {
        clearInterval(t);
        start();
      }
    }, 250);
  }

  console.log("[BADGE_POLL] ready (10s unified)");
})();


// ═══════════════════════════════════════════════
// S30.13 — image load state tracking
// ═══════════════════════════════════════════════
(function () {
  if (window.__imgStateTrack) return;
  window.__imgStateTrack = true;

  function markState(img) {
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      img.dataset.srcState = "loaded";
      return;
    }
    img.dataset.srcState = "loading";
  }

  // Mark all images (existing + future)
  function scan() {
    document.querySelectorAll('img[loading="lazy"]').forEach(function (img) {
      if (!img.dataset.srcState) markState(img);
      if (img.dataset.bound === "1") return;
      img.dataset.bound = "1";
      img.addEventListener("load", function () { img.dataset.srcState = "loaded"; });
      img.addEventListener("error", function () { img.dataset.srcState = "error"; });
    });
  }

  // observe DOM for new images
  try {
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  } catch (e) {}

  setInterval(scan, 800);
  scan();
  console.log("[IMG_STATE] ready");
})();
