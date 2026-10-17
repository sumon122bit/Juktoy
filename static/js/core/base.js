// ==================================================
// BASE — URL resolver + global state
// ==================================================

function _resolveBaseUrl() {
  try {
    const override = localStorage.getItem("juktoy_api_base");
    if (override && override.trim()) {
      return override.trim().replace(/\/$/, "");
    }
  } catch (e) { /* private mode — ignore */ }

  const proto = window.location.protocol;
  if (proto === "capacitor:" || proto === "file:") {
    return localStorage.getItem("juktoy_prod_url") || "https://juktoy.onrender.com";
  }
  return "";
}

window.BASE_URL = _resolveBaseUrl();
console.log("[JUKTOY] API base:", window.BASE_URL || "(same-origin)");

window.state = window.state || { me: null };
window.__juktoyState = window.state;
