function showToast(msg) {
  let toast = document.getElementById("app-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-toast";
    toast.style.cssText = `
      position: fixed;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%) translateY(80px);
      background: var(--card-2, #1a1d38);
      color: var(--text, #e2e8f0);
      padding: 12px 22px;
      border-radius: 999px;
      border: 1px solid rgba(167, 139, 250, 0.15);
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5);
      z-index: 300;
      opacity: 0;
      transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      pointer-events: none;
      font-family: inherit;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
  });
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(80px)";
  }, 2200);
}
