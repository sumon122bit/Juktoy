
// ==================================================
// SIDEBAR
// ==================================================

const sidebar = document.getElementById("left-sidebar");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const menuToggle = document.getElementById("menu-toggle");

export function openSidebar() {
  if (!sidebar) return;
  sidebar.classList.add("open");
  sidebarBackdrop.classList.add("open");
}
export function closeSidebar() {
  if (!sidebar) return;
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("open");
}
export function toggleSidebar() {
  if (!sidebar) return;
  if (sidebar.classList.contains("open")) closeSidebar();
  else openSidebar();
}

if (menuToggle) menuToggle.addEventListener("click", toggleSidebar);
if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", closeSidebar);

// ---------- Temporary bridge (remove after full ESM migration) ----------
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;
window.toggleSidebar = toggleSidebar;
