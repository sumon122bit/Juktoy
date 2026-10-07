
// ==================================================
// SIDEBAR
// ==================================================

const sidebar = document.getElementById("left-sidebar");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const menuToggle = document.getElementById("menu-toggle");

function openSidebar() {
  if (!sidebar) return;
  sidebar.classList.add("open");
  sidebarBackdrop.classList.add("open");
}
function closeSidebar() {
  if (!sidebar) return;
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("open");
}
function toggleSidebar() {
  if (!sidebar) return;
  if (sidebar.classList.contains("open")) closeSidebar();
  else openSidebar();
}

if (menuToggle) menuToggle.addEventListener("click", toggleSidebar);
if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", closeSidebar);
