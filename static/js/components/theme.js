// ==================================================
// THEME TOGGLE (Light / Dark)
// ==================================================

const THEME_KEY = "juktoy_theme_v2";

export function saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  try {
    document.cookie = THEME_KEY + "=" + theme + "; path=/; max-age=31536000; SameSite=Lax";
  } catch (e) {}
}

export function readSavedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch (e) {}
  try {
    const match = document.cookie.match(new RegExp("(?:^|; )" + THEME_KEY + "=([^;]*)"));
    if (match) {
      const v = decodeURIComponent(match[1]);
      if (v === "light" || v === "dark") return v;
    }
  } catch (e) {}
  return null;
}

export function applyTheme(theme) {
  const isLight = theme === "light";
document.body.classList.toggle("light", isLight);
document.body.classList.toggle("dark", !isLight);
  document.querySelectorAll("#auth-theme-toggle i").forEach((icon) => {
    icon.className = isLight ? "fa-solid fa-moon" : "fa-solid fa-sun";
  });

  const sw = document.getElementById("theme-switch");
  if (sw) sw.classList.toggle("on", !isLight);

  const labelText = document.getElementById("theme-label-text");
  const labelIcon = document.getElementById("theme-icon");
  if (labelText) labelText.textContent = isLight ? "লাইট মোড" : "ডার্ক মোড";
  if (labelIcon) labelIcon.className = isLight ? "fa-solid fa-sun" : "fa-solid fa-moon";

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isLight ? "#f5f7fb" : "#08091a");

  const colorScheme = document.querySelector('meta[name="color-scheme"]');
  if (colorScheme) colorScheme.setAttribute("content", isLight ? "light" : "dark");

  saveTheme(theme);
}

export function toggleTheme() {
  const isLight = document.body.classList.contains("light");
  applyTheme(isLight ? "dark" : "light");
}

const themeSwitchEl = document.getElementById("theme-switch");
const authThemeToggleEl = document.getElementById("auth-theme-toggle");

if (themeSwitchEl) themeSwitchEl.addEventListener("click", toggleTheme);
if (authThemeToggleEl) authThemeToggleEl.addEventListener("click", toggleTheme);

// ---------- Temporary bridge (remove after full ESM migration) ----------
window.saveTheme = saveTheme;
window.readSavedTheme = readSavedTheme;
window.applyTheme = applyTheme;
window.toggleTheme = toggleTheme;
