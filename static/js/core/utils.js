export function parseISO(iso) {
  if (!iso) return new Date(0);
  var str = String(iso);
  // If already has timezone info, use as-is
  if (/[Zz]$/.test(str) || /[+-]\d{2}:?\d{2}$/.test(str)) {
    return new Date(str);
  }
  // SQLite "2024-01-01 12:00:00" — treat as UTC
  return new Date(str.replace(" ", "T") + "Z");
}

export function timeAgo(iso) {
  const diff = (Date.now() - parseISO(iso).getTime()) / 1000;
  if (diff < 60) return "এইমাত্র";
  if (diff < 3600) return Math.floor(diff / 60) + " মিনিট আগে";
  if (diff < 86400) return Math.floor(diff / 3600) + " ঘণ্টা আগে";
  return Math.floor(diff / 86400) + " দিন আগে";
}

export function shortTime(iso) {
  if (!iso) return "";
  const diff = (Date.now() - parseISO(iso).getTime()) / 1000;
  if (diff < 60) return "এইমাত্র";
  if (diff < 3600) return Math.floor(diff / 60) + "মি";
  if (diff < 86400) return Math.floor(diff / 3600) + "ঘ";
  if (diff < 604800) return Math.floor(diff / 86400) + "দি";
  return parseISO(iso).toLocaleDateString("bn-BD", { day: "numeric", month: "short" });
}

export function initial(name) {
  return (name || "?").charAt(0).toUpperCase();
}

// S30.15 — Unicode-safe truncation (bengali conjuncts + emoji safe)
export function _trunc(str, maxChars) {
  if (!str) return "";
  // Use Array.from to iterate code points, preserving emoji/variation selectors
  // Then join and append ellipsis only if actually trimmed.
  var arr = Array.from(String(str));
  if (arr.length <= maxChars) return String(str);
  return arr.slice(0, maxChars).join("").replace(/[\s\u200B-\u200D\uFEFF]+$/g, "") + "…";
}


export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- Temporary bridge ----------
window.parseISO = parseISO;
window.timeAgo = timeAgo;
window.shortTime = shortTime;
window.initial = initial;
window._trunc = _trunc;
window.escapeHtml = escapeHtml;
