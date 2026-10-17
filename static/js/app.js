// SMART BASE URL RESOLVER
// - Localhost / Render / any hosting  → relative URLs (auto)
// - Capacitor (APK) / Electron / file://  → absolute production URL
// - Override anytime from console:
//     localStorage.setItem("juktoy_api_base", "https://staging.example.com")
//     (then reload)
//     localStorage.removeItem("juktoy_api_base")   ← revert
function _resolveBaseUrl() {
  try {
    const override = localStorage.getItem("juktoy_api_base");
    if (override && override.trim()) {
      return override.trim().replace(/\/$/, "");
    }
  } catch (e) { /* private mode — ignore */ }

  const proto = window.location.protocol;

  // Capacitor mobile app OR Electron desktop OR local file
  if (proto === "capacitor:" || proto === "file:") {
    // Absolute production URL required (no same-origin available)
    return localStorage.getItem("juktoy_prod_url") || "https://juktoy.onrender.com";
  }

  // Everything else (http/https) → relative URLs
  // Works on: localhost, Render, Vercel, Railway, VPS, any domain
  return "";
}
window.BASE_URL = _resolveBaseUrl();
console.log("[JUKTOY] API base:", BASE_URL || "(same-origin)");
// JUKTOY — Complete JavaScript
// All features: auth, feed, profile, theme, messages

// ---------- State ----------
window.state = window.state || { me: null };
window.__juktoyState = window.state;


// TOPBAR + MOBILE NAV HANDLERS

// Hook loadFeed to attach hashtag listeners after render
const _origBindPostEvents = window.bindPostEvents;
window.bindPostEvents = function() {
  if (typeof _origBindPostEvents === "function") _origBindPostEvents();
  if (typeof window.attachHashtagListeners === "function") {
    window.attachHashtagListeners(document.getElementById("feed-list"));
  }
};




