function triggerBurst(btn) {
  const burst = btn.querySelector(".burst");
  if (!burst) return;
  burst.innerHTML = "";
  const count = 8;
  const colors = ["#a78bfa", "#8b5cf6", "#6366f1", "#c4b5fd"];
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const distance = 22 + Math.random() * 14;
    const bx = Math.cos(angle) * distance;
    const by = Math.sin(angle) * distance;
    const p = document.createElement("span");
    p.style.setProperty("--bx", bx + "px");
    p.style.setProperty("--by", by + "px");
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 60 + "ms";
    p.style.width = p.style.height = 4 + Math.random() * 4 + "px";
    burst.appendChild(p);
  }
  setTimeout(() => {
    if (burst) burst.innerHTML = "";
  }, 900);
}

