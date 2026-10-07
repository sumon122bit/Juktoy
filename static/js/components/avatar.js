export function avatarInner(name, pic) {
  if (pic) return `<img src="${escapeHtml(pic)}" alt="${escapeHtml(name)}" loading="lazy" decoding="async">`;
  return initial(name);
}

export function avatarHTML(name, pic, className = "avatar", dataUser = "") {
  const userAttr = dataUser ? ` data-user="${escapeHtml(dataUser)}"` : "";
  const inner = avatarInner(name, pic);
  return `<div class="${className}"${userAttr}>${inner}</div>`;
}

export function setAvatar(el, name, pic) {
  if (!el) return;
  if (pic) {
    el.innerHTML = `<img src="${escapeHtml(pic)}" alt="${escapeHtml(name)}" loading="lazy" decoding="async">`;
  } else {
    el.textContent = initial(name);
  }
}

export function generateAvatarSVG(seed, name) {
  let hash = 0;
  const str = String(seed || "user");
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  const absHash = Math.abs(hash);

  const palettes = [
    ["#8b5cf6", "#6366f1", "#3b82f6"],
    ["#a78bfa", "#7c3aed", "#4f46e5"],
    ["#60a5fa", "#3b82f6", "#6366f1"],
    ["#818cf8", "#6366f1", "#8b5cf6"],
    ["#c084fc", "#8b5cf6", "#6366f1"],
    ["#22d3ee", "#6366f1", "#8b5cf6"],
    ["#f472b6", "#a855f7", "#6366f1"],
    ["#38bdf8", "#818cf8", "#a78bfa"],
  ];
  const palette = palettes[absHash % palettes.length];
  const initialChar = String(name || "?").trim().charAt(0).toUpperCase();

  const gradId = "ag" + absHash;
  const radialId = "ar" + absHash;
  const c1x = 60 + (absHash % 30);
  const c1y = 15 + (absHash % 20);
  const c2x = 10 + (absHash % 25);
  const c2y = 70 + (absHash % 20);
  const c3r = 12 + (absHash % 8);

  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${palette[0]}"/>
        <stop offset="55%" stop-color="${palette[1]}"/>
        <stop offset="100%" stop-color="${palette[2]}"/>
      </linearGradient>
      <radialGradient id="${radialId}" cx="30%" cy="30%" r="70%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.4)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
      </radialGradient>
    </defs>
    <rect width="100" height="100" fill="url(#${gradId})"/>
    <circle cx="${c1x}" cy="${c1y}" r="34" fill="url(#${radialId})" opacity="0.65"/>
    <circle cx="${c2x}" cy="${c2y}" r="26" fill="rgba(255,255,255,0.16)"/>
    <circle cx="${100 - c2x}" cy="${100 - c2y}" r="${c3r}" fill="rgba(0,0,0,0.22)"/>
    <circle cx="${c1x - 8}" cy="${100 - c1y + 5}" r="${c3r - 2}" fill="rgba(255,255,255,0.1)"/>
    <text x="50" y="53" text-anchor="middle" dominant-baseline="middle"
          font-family="Inter, sans-serif" font-weight="800"
          font-size="42" fill="#ffffff"
          style="text-shadow: 0 3px 10px rgba(0,0,0,0.45); letter-spacing: -1px">${initialChar}</text>
  </svg>`;
}


// ---------- Temporary bridge (remove after full ESM migration) ----------
window.avatarInner = avatarInner;
window.avatarHTML = avatarHTML;
window.setAvatar = setAvatar;
window.generateAvatarSVG = generateAvatarSVG;
