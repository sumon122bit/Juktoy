// Series 3A — Voice Recorder
// ═══════════════════════════════════════════════

var _vr = {
  recorder: null,
  chunks: [],
  startAt: 0,
  timer: null,
  cancelled: false,
  stream: null,
  rawStream: null,
  actx: null,
  active: false
};

function _blobToDataURL(blob) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function _vrFormatTime(ms) {
  var s = Math.floor(ms / 1000);
  var m = Math.floor(s / 60);
  var r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
}

function _vrShowUI() {
  var el = document.getElementById("voice-recorder");
  if (!el) return;
  el.classList.remove("hidden");
  el.classList.add("show");
}

function _vrHideUI() {
  var el = document.getElementById("voice-recorder");
  if (!el) return;
  el.classList.remove("show");
  setTimeout(function () { el.classList.add("hidden"); }, 220);
  var timer = document.getElementById("vr-timer");
  if (timer) timer.textContent = "0:00";
  var hint = document.getElementById("vr-hint");
  if (hint) hint.textContent = "রেকর্ড হচ্ছে... ছেড়ে দিলে বা ✓ চাপুন";
  var cancel = document.getElementById("vr-cancel");
  if (cancel) cancel.classList.remove("armed");
  var send = document.getElementById("vr-send");
  if (send) send.classList.remove("disabled");
}

async function _vrStart() {
  if (_vr.active) return;
  if (!window.currentChatUser) return;

  console.log("[VR] secure:", window.isSecureContext,
              "| mediaDevices:", !!navigator.mediaDevices,
              "| getUserMedia:", !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
              "| MediaRecorder:", !!window.MediaRecorder,
              "| protocol:", window.location.protocol,
              "| host:", window.location.host);

  if (!window.isSecureContext) {
    window.showToast("⚠️ HTTP-এ mic কাজ করে না — HTTPS দরকার");
    console.error("[VR] insecure context");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    window.showToast("এই ব্রাউজারে mic সাপোর্ট নেই");
    return;
  }
  if (!window.MediaRecorder) {
    window.showToast("এই ব্রাউজারে MediaRecorder নেই");
    return;
  }

  try {
    var rawStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      }
    });

    // === Amplify: use Web Audio gain node to boost recorded volume ===
    var stream = rawStream;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        if (!_vr.actx) _vr.actx = new AC();
        var actx = _vr.actx;
        if (actx.state === "suspended") { try { await actx.resume(); } catch (e) {} }
        var srcNode = actx.createMediaStreamSource(rawStream);
        var gainNode = actx.createGain();
        // 3.5x amplification — safe for typical smartphone mic input
        gainNode.gain.value = 3.5;
        // Compressor to prevent clipping
        var comp = actx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 12;
        comp.ratio.value = 6;
        comp.attack.value = 0.003;
        comp.release.value = 0.25;

        var dest = actx.createMediaStreamDestination();
        srcNode.connect(gainNode);
        gainNode.connect(comp);
        comp.connect(dest);
        stream = dest.stream;
        _vr.rawStream = rawStream;
      }
    } catch (gErr) {
      console.warn("[VR] gain node failed, using raw:", gErr);
      stream = rawStream;
    }

    _vr.stream = stream;
    _vr.rawStream = rawStream;
    _vr.chunks = [];
    _vr.cancelled = false;

    var mime = "audio/webm";
    if (!MediaRecorder.isTypeSupported(mime)) mime = "";
    _vr.recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128000 })
      : new MediaRecorder(stream);

    _vr.recorder.ondataavailable = function (e) {
      if (e.data && e.data.size > 0) _vr.chunks.push(e.data);
    };

    _vr.recorder.onstop = async function () {
      var duration = (Date.now() - _vr.startAt) / 1000;
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try {
        if (_vr.rawStream) _vr.rawStream.getTracks().forEach(function (t) { t.stop(); });
      } catch (e) {}
      _vr.stream = null;
      _vr.rawStream = null;
      _vr.active = false;

      if (_vr.cancelled) { _vrHideUI(); return; }
      if (duration < 0.6) {
        window.showToast("খুব ছোট — একটু বড় করে বলুন");
        _vrHideUI();
        return;
      }
      if (duration > 300) {
        window.showToast("৫ মিনিটের বেশি রেকর্ড করা যাবে না");
        _vrHideUI();
        return;
      }

      _vrHideUI();
      try {
        var blob = new Blob(_vr.chunks, { type: "audio/webm" });
        var dataUrl = await _blobToDataURL(blob);
        await _vrSend(dataUrl, duration);
      } catch (e) {
        window.showToast("ভয়েস পাঠানো যায়নি");
      }
    };

    _vr.recorder.start();
    _vr.active = true;
    _vr.startAt = Date.now();
    _vrShowUI();

    // Timer
    if (_vr.timer) clearInterval(_vr.timer);
    _vr.timer = setInterval(function () {
      var el = document.getElementById("vr-timer");
      if (el) el.textContent = _vrFormatTime(Date.now() - _vr.startAt);
      var el2 = document.getElementById("vr-timer");
      var dur = (Date.now() - _vr.startAt) / 1000;
      if (dur > 300) _vrStop(true);
    }, 120);

    if (navigator.vibrate) navigator.vibrate(12);
  } catch (e) {
    console.error("[VR] error name:", e.name, "| message:", e.message);
    var msg = "মাইক চালু করা যায়নি";
    if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
      msg = "মাইক অনুমতি denied — Chrome সেটিংস থেকে Allow করুন";
    } else if (e.name === "NotFoundError") {
      msg = "মাইক্রোফোন পাওয়া যায়নি";
    } else if (e.name === "NotReadableError") {
      msg = "মাইক্রোফোন অন্য অ্যাপ ব্যবহার করছে";
    } else if (e.name === "SecurityError") {
      msg = "নিরাপত্তা ত্রুটি — HTTPS দরকার";
    } else if (e.name === "AbortError") {
      msg = "রেকর্ডিং বন্ধ হয়েছে";
    } else if (e.name) {
      msg = "Mic error: " + e.name;
    }
    window.showToast(msg);
    _vr.active = false;
  }
}

function _vrStop(cancel) {
  if (!_vr.active) return;
  _vr.cancelled = !!cancel;
  try { _vr.recorder.stop(); } catch (e) {}
  if (_vr.timer) { clearInterval(_vr.timer); _vr.timer = null; }
  if (navigator.vibrate) navigator.vibrate(15);
}

async function _vrSend(dataUrl, duration) {
  if (!window.currentChatUser) return;
  try {
    var res = await window.api("/api/messages/" + encodeURIComponent(window.currentChatUser) + "/voice", {
      method: "POST",
      body: JSON.stringify({ audio: dataUrl, duration: duration }),
    });
    await window.loadChatMessages(true);
    await window.loadConversations();
    if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
  } catch (e) {
    alert(e.message || "ভয়েস পাঠানো যায়নি");
  }
}

// ---- Wire mic button ----
(function () {
  var btn = document.getElementById("chat-mic-btn");
  if (!btn) return;

  var startedByPress = false;
  var pressTimer = null;

  function startPress(e) {
    if (e) e.preventDefault();
    if (_vr.active) return;
    startedByPress = true;
    _vrStart();
  }
  function endPress(e) {
    if (e) e.preventDefault();
    if (!startedByPress) return;
    startedByPress = false;
    if (!_vr.active) return;

    // If cancel button armed → cancel
    var cancelBtn = document.getElementById("vr-cancel");
    if (cancelBtn && cancelBtn.classList.contains("armed")) {
      _vrStop(true);
      return;
    }

    // Auto-send after ~1.2s of recording (fast path)
    // Below that threshold, keep the overlay open so user can decide
    var heldMs = Date.now() - _vr.startAt;
    if (heldMs >= 1200) {
      _vrStop(false);
    } else {
      // Keep recording — user must explicitly tap ✓ পাঠান
      // (they can also hit ✕ বাতিল)
      var hint = document.getElementById("vr-hint");
      if (hint) hint.textContent = "✓ পাঠান চাপুন";
    }
  }

  // Touch (mobile)
  btn.addEventListener("touchstart", startPress, { passive: false });
  btn.addEventListener("touchend", endPress);
  btn.addEventListener("touchcancel", function (e) { endPress(e); });

  // Mouse (desktop)
  btn.addEventListener("mousedown", startPress);
  btn.addEventListener("mouseup", endPress);
  btn.addEventListener("mouseleave", function (e) {
    if (startedByPress) endPress(e);
  });
})();

// ---- Send button ----
(function () {
  var sb = document.getElementById("vr-send");
  if (!sb) return;
  sb.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    _vrStop(false);   // stop & send
  });
  // long-press safe (no repeat)
  sb.addEventListener("mousedown", function (e) { e.preventDefault(); });
})();

// ---- Cancel button ----
(function () {
  var cb = document.getElementById("vr-cancel");
  if (!cb) return;
  cb.addEventListener("touchstart", function (e) {
    e.preventDefault();
    cb.classList.add("armed");
  }, { passive: false });
  cb.addEventListener("touchend", function (e) {
    e.preventDefault();
    _vrStop(true);
  });
  cb.addEventListener("mouseenter", function () { cb.classList.add("armed"); });
  cb.addEventListener("mouseleave", function () { cb.classList.remove("armed"); });
  cb.addEventListener("click", function (e) {
    e.preventDefault();
    _vrStop(true);
  });
})();

// ---- Voice player (delegated) ----
document.addEventListener("click", function (e) {
  var playBtn = e.target.closest(".cv-play");
  if (!playBtn) return;
  e.preventDefault();
  e.stopPropagation();
  var wrap = playBtn.closest(".chat-voice");
  if (!wrap) return;
  var src = wrap.dataset.src;
  if (!src) return;
  var isPlaying = wrap.classList.contains("playing");

  // Stop any other playing voice
  document.querySelectorAll(".chat-voice.playing").forEach(function (v) {
    if (v !== wrap) {
      v.classList.remove("playing");
      var b = v.querySelector(".cv-play i");
      if (b) b.className = "fa-solid fa-play";
      if (v._audio) { try { v._audio.pause(); } catch (err) {} }
    }
  });

  if (!wrap._audio) {
    wrap._audio = new Audio(src);
    // Player-side boost: use Web Audio to amplify beyond 100%
    try {
      var AC2 = window.AudioContext || window.webkitAudioContext;
      if (AC2) {
        if (!window._vrPlayCtx) window._vrPlayCtx = new AC2();
        var pctx = window._vrPlayCtx;
        if (pctx.state === "suspended") { try { pctx.resume(); } catch (e) {} }
        var psrc = pctx.createMediaElementSource(wrap._audio);
        var pgain = pctx.createGain();
        var pcomp = pctx.createDynamicsCompressor();
        pgain.gain.value = 2.2;
        pcomp.threshold.value = -12;
        pcomp.knee.value = 10;
        pcomp.ratio.value = 4;
        pcomp.attack.value = 0.003;
        pcomp.release.value = 0.25;
        psrc.connect(pgain);
        pgain.connect(pcomp);
        pcomp.connect(pctx.destination);
        wrap._audio._pctx = pctx;
        wrap._audio._psrc = psrc;
      }
    } catch (gErr) {
      console.warn("[PLAY] gain boost failed:", gErr);
    }
    wrap._audio.addEventListener("ended", function () {
      wrap.classList.remove("playing");
      var bi = wrap.querySelector(".cv-play i");
      if (bi) bi.className = "fa-solid fa-play";
    });
    wrap._audio.addEventListener("timeupdate", function () {
      if (!wrap._audio.duration) return;
      var pct = (wrap._audio.currentTime / wrap._audio.duration) * 100;
      wrap.style.setProperty("--cv-progress", pct + "%");
    });
  }

  if (isPlaying) {
    try { wrap._audio.pause(); } catch (err) {}
    wrap.classList.remove("playing");
    var i2 = wrap.querySelector(".cv-play i");
    if (i2) i2.className = "fa-solid fa-play";
  } else {
    try {
      wrap._audio.currentTime = 0;
      wrap._audio.play();
      wrap.classList.add("playing");
      var i3 = wrap.querySelector(".cv-play i");
      if (i3) i3.className = "fa-solid fa-pause";
    } catch (err) {
      window.showToast("বাজানো যায়নি");
    }
  }
}, true);


// ═══════════════════════════════════════════════
// Series 3B — Chat Theme / Nickname / Wallpaper
// ═══════════════════════════════════════════════

var CHAT_THEMES = {
  default:   { label: "Coral",     out: "linear-gradient(135deg, #F05555 0%, #E14B4B 100%)", in: "#ffffff", bg: "#FDF6F3", dot: "rgba(255,107,107,0.09)", swatch: "linear-gradient(135deg, #FF6B6B, #F43F5E)" },
  emerald:   { label: "Emerald",   out: "linear-gradient(135deg, #10B981 0%, #059669 100%)", in: "#ffffff", bg: "#F0FDF4", dot: "rgba(16,185,129,0.10)", swatch: "linear-gradient(135deg, #10B981, #047857)" },
  ocean:     { label: "Ocean",     out: "linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%)", in: "#ffffff", bg: "#F0F9FF", dot: "rgba(14,165,233,0.10)", swatch: "linear-gradient(135deg, #0EA5E9, #0369A1)" },
  sunset:    { label: "Sunset",    out: "linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)", in: "#ffffff", bg: "#FFFBEB", dot: "rgba(245,158,11,0.10)", swatch: "linear-gradient(135deg, #F59E0B, #EA580C)" },
  royal:     { label: "Royal",     out: "linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)", in: "#ffffff", bg: "#F5F3FF", dot: "rgba(139,92,246,0.10)", swatch: "linear-gradient(135deg, #8B5CF6, #6D28D9)" },
  mono:      { label: "Mono",      out: "linear-gradient(135deg, #4B5563 0%, #1F2937 100%)", in: "#ffffff", bg: "#F9FAFB", dot: "rgba(75,85,99,0.10)",   swatch: "linear-gradient(135deg, #6B7280, #1F2937)" },
  instagram: { label: "Instagram", out: "linear-gradient(135deg, #833AB4 0%, #E1306C 50%, #F77737 100%)", in: "#ffffff", bg: "#FDF8FF", dot: "rgba(131,58,180,0.10)", swatch: "linear-gradient(135deg, #833AB4, #E1306C, #F77737)" },
  linear:    { label: "Linear",    out: "linear-gradient(135deg, #5E6AD2 0%, #4F46E5 100%)", in: "#ffffff", bg: "#F5F6FA", dot: "rgba(94,106,210,0.10)", swatch: "linear-gradient(135deg, #5E6AD2, #4F46E5)" },
  notion:    { label: "Notion",    out: "linear-gradient(135deg, #4F4A47 0%, #2F2B28 100%)", in: "#ffffff", bg: "#FBF9F5", dot: "rgba(79,74,71,0.10)",   swatch: "linear-gradient(135deg, #6B645F, #2F2B28)" },
  teal:      { label: "Teal",      out: "linear-gradient(135deg, #14B8A6 0%, #0D9488 100%)", in: "#ffffff", bg: "#F0FDFA", dot: "rgba(20,184,166,0.10)", swatch: "linear-gradient(135deg, #14B8A6, #0D9488)" },
  vercel:    { label: "Vercel",    out: "linear-gradient(135deg, #262626 0%, #000000 100%)", in: "#ffffff", bg: "#FAFAFA", dot: "rgba(0,0,0,0.08)",     swatch: "linear-gradient(135deg, #333333, #000000)" }
};

function _applyChatTheme(themeKey) {
  var cw = document.getElementById("chat-window");
  if (!cw) return;
  var t = CHAT_THEMES[themeKey] || CHAT_THEMES.default;
  cw.style.setProperty("--chat-out-bg", t.out);
  cw.style.setProperty("--chat-in-bg", t.in);
  cw.style.setProperty("--chat-bg", t.bg);
  cw.style.setProperty("--chat-dot", t.dot);
  cw.setAttribute("data-chat-theme", themeKey || "default");
}

function _applyWallpaper(wp) {
  var cw = document.getElementById("chat-window");
  if (!cw) return;

  // Clear overrides
  cw.style.removeProperty("--chat-wallpaper-img");
  cw.style.removeProperty("--chat-wallpaper-size");
  cw.style.removeProperty("--chat-wallpaper-pos");
  cw.style.removeProperty("--chat-wallpaper-color");

  if (!wp || wp === "default") return;

  if (wp.indexOf("solid:") === 0) {
    cw.style.setProperty("--chat-wallpaper-color", wp.slice(6));
    cw.style.setProperty("--chat-wallpaper-img", "none");
    cw.style.setProperty("--chat-wallpaper-size", "auto");
    cw.style.setProperty("--chat-wallpaper-pos", "0 0");
  } else if (wp.indexOf("gradient:") === 0) {
    var parts = wp.slice(9).split("|");
    var a = parts[0] || "#FF6B6B";
    var b = parts[1] || "#F43F5E";
    cw.style.setProperty("--chat-wallpaper-img", "linear-gradient(135deg, " + a + ", " + b + ")");
    cw.style.setProperty("--chat-wallpaper-size", "cover");
    cw.style.setProperty("--chat-wallpaper-pos", "center");
  } else if (wp.indexOf("image:") === 0) {
    cw.style.setProperty("--chat-wallpaper-img", "url('" + wp.slice(6) + "')");
    cw.style.setProperty("--chat-wallpaper-size", "cover");
    cw.style.setProperty("--chat-wallpaper-pos", "center");
  }
}

function _applyChatPrefs(username) {
  if (!username) return;
  // S29.5 - read from cache (fetches once, reuses for ~chat lifetime)
  _getChatSettings(username).then(function (st) {
    if (!st) return;
    _applyChatTheme(st.theme || "default");
    _applyWallpaper(st.wallpaper || "default");
  });
}

function _openChatThemePicker(username) {
  var old = document.getElementById("chat-theme-modal");
  if (old) old.remove();

  var cw = document.getElementById("chat-window");
  var currentTheme = cw ? (cw.getAttribute("data-chat-theme") || "default") : "default";

  var html = "";
  var keys = Object.keys(CHAT_THEMES);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var t = CHAT_THEMES[k];
    var active = (k === currentTheme) ? " active" : "";
    html += '<button type="button" class="ctm-swatch' + active + '" data-theme="' + k + '">';
    html += '<span class="ctm-circle" style="background:' + t.swatch + '"></span>';
    html += '<span class="ctm-label">' + t.label + '</span>';
    html += '</button>';
  }

  var modal = document.createElement("div");
  modal.id = "chat-theme-modal";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML =
    '<div class="modal-content ctm-content">' +
      '<button class="close-btn" id="ctm-close" type="button">\u00d7</button>' +
      '<h3 class="ctm-title">\u099a\u09cd\u09af\u09be\u099f \u09a5\u09bf\u09ae</h3>' +
      '<p class="ctm-sub">\u09aa\u09cd\u09b0\u09a4\u09bf\u099f\u09bf \u099a\u09cd\u09af\u09be\u099f\u09c7\u09b0 \u099c\u09a8\u09cd\u09af \u0986\u09b2\u09be\u09a6\u09be \u09b0\u0999</p>' +
      '<div class="ctm-grid">' + html + '</div>' +
      '<div class="ctm-preview">' +
        '<div class="ctm-preview-row out"><div class="ctm-preview-bubble" id="ctm-prev-out">\u0986\u09ae\u09bf \u09ad\u09be\u09b2\u09cb \u0986\u099b\u09bf</div></div>' +
        '<div class="ctm-preview-row in"><div class="ctm-preview-bubble" id="ctm-prev-in">\u09a4\u09c1\u09ae\u09bf \u0995\u09c7\u09ae\u09a8 \u0986\u099b\u09cb?</div></div>' +
      '</div>' +
      '<div class="edit-actions" style="margin-top:16px">' +
        '<button class="btn-secondary" id="ctm-cancel">\u09ac\u09be\u09a4\u09bf\u09b2</button>' +
        '<button class="btn-primary" id="ctm-save" style="width:auto;padding:12px 28px"><i class="fa-solid fa-check"></i> \u09b8\u09c7\u09ad</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var selected = currentTheme;
  function updatePreview() {
    var t = CHAT_THEMES[selected] || CHAT_THEMES.default;
    var pOut = document.getElementById("ctm-prev-out");
    var pIn = document.getElementById("ctm-prev-in");
    if (pOut) { pOut.style.background = t.out; pOut.style.color = "#fff"; }
    if (pIn) { pIn.style.background = t.in; pIn.style.color = "#1A0F0E"; }
    var sws = modal.querySelectorAll(".ctm-swatch");
    for (var i = 0; i < sws.length; i++) {
      sws[i].classList.toggle("active", sws[i].dataset.theme === selected);
    }
  }
  var swatches = modal.querySelectorAll(".ctm-swatch");
  for (var i = 0; i < swatches.length; i++) {
    swatches[i].addEventListener("click", function () {
      selected = this.dataset.theme;
      updatePreview();
    });
  }
  function close() { modal.remove(); }
  document.getElementById("ctm-close").addEventListener("click", close);
  document.getElementById("ctm-cancel").addEventListener("click", close);
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  document.getElementById("ctm-save").addEventListener("click", async function () {
    try {
      var cur = await window.api("/api/chats/" + encodeURIComponent(username) + "/settings");
      await window.api("/api/chats/" + encodeURIComponent(username) + "/settings", {
        method: "POST",
        body: JSON.stringify({
          pinned: cur.pinned,
          muted: cur.muted,
          theme: selected,
          nickname: cur.nickname || "",
          wallpaper: cur.wallpaper || "default",
          nickname_public: cur.nickname_public || false
        })
      });
      _invalidateChatSettings(username);   // S29.5
      _applyChatTheme(selected);
      close();
      window.showToast("\u09a5\u09bf\u09ae \u09b8\u09c7\u09ad \u09b9\u09df\u09c7\u099b\u09c7");
    } catch (e) { alert(e.message); }
  });
  updatePreview();
}

async function _openNicknameModal(username) {
  var old = document.getElementById("chat-nickname-modal");
  if (old) old.remove();

  var cur = { nickname: "" };
  try { cur = await window.api("/api/chats/" + encodeURIComponent(username) + "/settings"); } catch (e) {}

  var modal = document.createElement("div");
  modal.id = "chat-nickname-modal";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML =
    '<div class="modal-content" style="max-width:420px">' +
      '<button class="close-btn" id="cnm-close" type="button">\u00d7</button>' +
      '<h3 style="margin-bottom:6px;font-size:19px">\ud83c\udff7\ufe0f \u09a8\u09bf\u0995\u09a8\u09c7\u09ae</h3>' +
      '<p class="settings-hint" style="margin-bottom:16px">' +
        '\u09b8\u09be\u09ae\u09a8\u09c7\u09b0 \u099c\u09a8\u0995\u09c7 \u0986\u09aa\u09a8\u09be\u09b0 \u09ae\u09a8\u09ae\u09a4\u09cb \u09a8\u09be\u09ae\u09c7 \u09a1\u09be\u0995\u09c1\u09a8\u0964 \u09a8\u09bf\u0995\u09a8\u09c7\u09ae \u09b8\u09c7\u099f \u0995\u09b0\u09b2\u09c7 \u099a\u09cd\u09af\u09be\u099f\u09c7 \u09a6\u09c1\u099c\u09a8\u0987 \u099c\u09be\u09a8\u09a4\u09c7 \u09aa\u09be\u09b0\u09ac\u09c7\u0964' +
      '</p>' +
      '<div class="cnm-box">' +
        '<div class="cnm-box-title">' +
          '<i class="fa-solid fa-user-friends"></i> \u09b8\u09be\u09ae\u09a8\u09c7\u09b0 \u099c\u09a8\u09c7\u09b0 \u09a8\u09bf\u0995\u09a8\u09c7\u09ae' +
        '</div>' +
        '<div class="input-group" style="margin-bottom:0;margin-top:8px">' +
          '<i class="fa-regular fa-id-badge input-icon"></i>' +
          '<input type="text" id="cnm-them" placeholder="\u09af\u09c7\u09ae\u09a8: Boss, \u09b8\u09c1\u09a8\u09cd\u09a6\u09b0\u09c0..." maxlength="40" value="' + window.escapeHtml(cur.nickname || "") + '">' +
        '</div>' +
      '</div>' +
      '<div class="edit-actions" style="margin-top:18px">' +
        '<button class="btn-secondary" id="cnm-clear">\u09b8\u09b0\u09be\u09a8</button>' +
        '<button class="btn-primary" id="cnm-save" style="width:auto;padding:12px 28px"><i class="fa-solid fa-check"></i> \u09b8\u09c7\u09ad</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var inpThem = document.getElementById("cnm-them");
  setTimeout(function () { if (inpThem) inpThem.focus(); }, 80);

  function close() { modal.remove(); }
  document.getElementById("cnm-close").addEventListener("click", close);
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  async function saveVal(val) {
    try {
      var st = await window.api("/api/chats/" + encodeURIComponent(username) + "/settings");
      await window.api("/api/chats/" + encodeURIComponent(username) + "/settings", {
        method: "POST",
        body: JSON.stringify({
          pinned: st.pinned,
          muted: st.muted,
          theme: st.theme || "default",
          nickname: val,
          my_nickname: st.my_nickname || "",
          wallpaper: st.wallpaper || "default",
          nickname_public: true
        })
      });
      _invalidateChatSettings(username);   // S29.5
      close();
      window.showToast(val ? "\u09a8\u09bf\u0995\u09a8\u09c7\u09ae \u09b8\u09c7\u09ad \u09b9\u09df\u09c7\u099b\u09c7" : "\u09a8\u09bf\u0995\u09a8\u09c7\u09ae \u09b8\u09b0\u09be\u09a8\u09cb \u09b9\u09df\u09c7\u099b\u09c7");
      await window.loadConversations();
      if (window.currentChatUser === username) await window.loadChatMessages(true);
    } catch (e) { alert(e.message); }
  }

  document.getElementById("cnm-save").addEventListener("click", function () {
    saveVal((inpThem.value || "").trim());
  });
  document.getElementById("cnm-clear").addEventListener("click", function () {
    inpThem.value = "";
    saveVal("");
  });
  inpThem.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); saveVal((inpThem.value || "").trim()); }
  });
}

function _openWallpaperPicker(username) {
  var old = document.getElementById("chat-wallpaper-modal");
  if (old) old.remove();

  var presets = [
    { id: "default", label: "\u09a1\u09bf\u09ab\u09b2\u09cd\u099f", bg: "#FDF6F3" },
    { id: "solid:#FFF7ED", label: "Cream", bg: "#FFF7ED" },
    { id: "solid:#F0F9FF", label: "Sky", bg: "#F0F9FF" },
    { id: "solid:#F0FDF4", label: "Mint", bg: "#F0FDF4" },
    { id: "solid:#FDF4FF", label: "Pink", bg: "#FDF4FF" },
    { id: "solid:#F9FAFB", label: "Gray", bg: "#F9FAFB" },
    { id: "gradient:#FFE4E6|#FECDD3", label: "Rose", bg: "linear-gradient(135deg, #FFE4E6, #FECDD3)" },
    { id: "gradient:#DBEAFE|#BFDBFE", label: "Blue", bg: "linear-gradient(135deg, #DBEAFE, #BFDBFE)" },
    { id: "gradient:#D1FAE5|#A7F3D0", label: "Emerald", bg: "linear-gradient(135deg, #D1FAE5, #A7F3D0)" },
    { id: "gradient:#FEF3C7|#FDE68A", label: "Amber", bg: "linear-gradient(135deg, #FEF3C7, #FDE68A)" },
    { id: "gradient:#EDE9FE|#DDD6FE", label: "Violet", bg: "linear-gradient(135deg, #EDE9FE, #DDD6FE)" },
    { id: "gradient:#CFFAFE|#A5F3FC", label: "Cyan", bg: "linear-gradient(135deg, #CFFAFE, #A5F3FC)" }
  ];

  var gridHtml = "";
  for (var i = 0; i < presets.length; i++) {
    var p = presets[i];
    gridHtml += '<button type="button" class="cwm-swatch" data-wp="' + p.id + '">';
    gridHtml += '<span class="cwm-circle" style="background:' + p.bg + '"></span>';
    gridHtml += '<span class="cwm-label">' + p.label + '</span>';
    gridHtml += '</button>';
  }

  var modal = document.createElement("div");
  modal.id = "chat-wallpaper-modal";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML =
    '<div class="modal-content ctm-content">' +
      '<button class="close-btn" id="cwm-close" type="button">\u00d7</button>' +
      '<h3 class="ctm-title">\u0993\u09df\u09be\u09b2\u09aa\u09c7\u09aa\u09be\u09b0</h3>' +
      '<p class="ctm-sub">\u099a\u09cd\u09af\u09be\u099f \u09ac\u09cd\u09af\u09be\u0995\u0997\u09cd\u09b0\u09be\u0989\u09a8\u09cd\u09a1</p>' +
      '<div class="cwm-grid">' + gridHtml + '</div>' +
      '<div class="edit-actions" style="margin-top:16px">' +
        '<button class="btn-secondary" id="cwm-cancel">\u09ac\u09be\u09a4\u09bf\u09b2</button>' +
        '<button class="btn-primary" id="cwm-save" style="width:auto;padding:12px 28px"><i class="fa-solid fa-check"></i> \u09b8\u09c7\u09ad</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var selected = "default";
  function mark() {
    var sws = modal.querySelectorAll(".cwm-swatch");
    for (var i = 0; i < sws.length; i++) {
      sws[i].classList.toggle("active", sws[i].dataset.wp === selected);
    }
  }
  var swatches = modal.querySelectorAll(".cwm-swatch");
  for (var i = 0; i < swatches.length; i++) {
    swatches[i].addEventListener("click", function () {
      selected = this.dataset.wp;
      mark();
      _applyWallpaper(selected);
    });
  }
  function close() { modal.remove(); }
  document.getElementById("cwm-close").addEventListener("click", close);
  document.getElementById("cwm-cancel").addEventListener("click", function () {
    _applyChatPrefs(username); close();
  });
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  document.getElementById("cwm-save").addEventListener("click", async function () {
    try {
      var st = await window.api("/api/chats/" + encodeURIComponent(username) + "/settings");
      await window.api("/api/chats/" + encodeURIComponent(username) + "/settings", {
        method: "POST",
        body: JSON.stringify({
          pinned: st.pinned,
          muted: st.muted,
          theme: st.theme || "default",
          nickname: st.nickname || "",
          wallpaper: selected,
          nickname_public: st.nickname_public || false
        })
      });
      _invalidateChatSettings(username);   // S29.5
      close();
      window.showToast("\u0993\u09df\u09be\u09b2\u09aa\u09c7\u09aa\u09be\u09b0 \u09b8\u09c7\u09ad");
    } catch (e) { alert(e.message); }
  });
  mark();
}


// ═══════════════════════════════════════════════
// Series 3C — Edit message + delete options
// ═══════════════════════════════════════════════

function _openEditMessageModal(msgId, msgEl, currentText) {
  var old = document.getElementById("edit-msg-modal");
  if (old) old.remove();

  var modal = document.createElement("div");
  modal.id = "edit-msg-modal";
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML =
    '<div class="modal-content" style="max-width:480px">' +
      '<button class="close-btn" id="emm-close" type="button">\u00d7</button>' +
      '<h3 style="margin-bottom:8px;font-size:19px">\u270f\ufe0f \u09ae\u09c7\u09b8\u09c7\u099c \u098f\u09a1\u09bf\u099f</h3>' +
      '<p class="settings-hint" style="margin-bottom:14px">\u09e7\u09eb \u09ae\u09bf\u09a8\u09bf\u099f\u09c7\u09b0 \u09ae\u09a7\u09cd\u09af\u09c7 \u098f\u09a1\u09bf\u099f \u0995\u09b0\u09be \u09af\u09be\u09ac\u09c7\u0964</p>' +
      '<textarea id="emm-input" class="edit-bio-input" maxlength="5000" style="min-height:100px">' + window.escapeHtml(currentText || "") + '</textarea>' +
      '<div class="edit-actions">' +
        '<button class="btn-secondary" id="emm-cancel">\u09ac\u09be\u09a4\u09bf\u09b2</button>' +
        '<button class="btn-primary" id="emm-save" style="width:auto;padding:12px 28px"><i class="fa-solid fa-check"></i> \u09b8\u09c7\u09ad</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var ta = document.getElementById("emm-input");
  setTimeout(function () {
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }, 80);

  function close() { modal.remove(); }
  document.getElementById("emm-close").addEventListener("click", close);
  document.getElementById("emm-cancel").addEventListener("click", close);
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  document.getElementById("emm-save").addEventListener("click", async function () {
    var val = (ta.value || "").trim();
    if (!val) return window.showToast("\u0996\u09be\u09b2\u09bf \u09b9\u09ac\u09c7 \u09a8\u09be");
    try {
      var res = await window.api("/api/messages/" + msgId, {
        method: "PATCH",
        body: JSON.stringify({ content: val }),
      });
      if (msgEl) {
        var textEl = msgEl.querySelector(".chat-msg-text");
        if (textEl) textEl.textContent = res.content;
        if (!msgEl.querySelector(".chat-msg-edited")) {
          var em = document.createElement("span");
          em.className = "chat-msg-edited";
          em.textContent = "(\u09b8\u09ae\u09cd\u09aa\u09be\u09a6\u09bf\u09a4)";
          var timeEl = msgEl.querySelector(".chat-msg-time");
          if (timeEl) timeEl.parentNode.insertBefore(em, timeEl);
          else msgEl.appendChild(em);
        }
      }
      close();
      window.showToast("\u270f\ufe0f \u098f\u09a1\u09bf\u099f \u09b8\u09c7\u09ad \u09b9\u09df\u09c7\u099b\u09c7");
    } catch (e) { alert(e.message); }
  });

  ta.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      document.getElementById("emm-save").click();
    }
  });
}

function _openDeleteMessageSheet(msgId, msgEl, isMine) {
  var old = document.getElementById("del-msg-sheet");
  if (old) old.remove();

  var sheet = document.createElement("div");
  sheet.id = "del-msg-sheet";
  sheet.className = "chat-msg-menu-root";
  sheet.innerHTML =
    '<div class="cmm-backdrop"></div>' +
    '<div class="dms-panel">' +
      '<div class="cms-handle"></div>' +
      '<button class="dms-item" data-act="del-me">' +
        '<span class="dms-icon"><i class="fa-solid fa-eye-slash"></i></span>' +
        '<span class="dms-info"><b>\u0986\u09ae\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c1\u09a8</b>' +
        '<small>\u09b6\u09c1\u09a7\u09c1 \u0986\u09aa\u09a8\u09bf \u09a6\u09c7\u0996\u09ac\u09c7\u09a8 \u09a8\u09be</small></span>' +
      '</button>' +
      (isMine
        ? '<button class="dms-item dms-danger" data-act="del-all">' +
            '<span class="dms-icon"><i class="fa-regular fa-trash-can"></i></span>' +
            '<span class="dms-info"><b>\u09b8\u09ac\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c1\u09a8</b>' +
            '<small>\u09a6\u09c1\u099c\u09a8\u09c7\u09b0 \u0995\u09be\u099b \u09a5\u09c7\u0995\u09c7 \u09ae\u09c1\u099b\u09c7 \u09af\u09be\u09ac\u09c7</small></span>' +
          '</button>'
        : '') +
      '<button class="dms-item dms-cancel" data-act="cancel">\u09ac\u09be\u09a4\u09bf\u09b2</button>' +
    '</div>';
  document.body.appendChild(sheet);
  requestAnimationFrame(function () { sheet.classList.add("show"); });

  function close() {
    sheet.classList.remove("show");
    setTimeout(function () { sheet.remove(); }, 260);
  }
  sheet.querySelector(".cmm-backdrop").addEventListener("click", close);

  sheet.querySelectorAll(".dms-item").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var act = btn.dataset.act;
      if (act === "cancel") { close(); return; }
      close();
      try {
        if (act === "del-me") {
          await window.api("/api/messages/" + msgId + "/delete-for-me", { method: "POST" });
          if (msgEl) msgEl.remove();
          window.showToast("\u0986\u09ae\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09be \u09b9\u09df\u09c7\u099b\u09c7");
        } else if (act === "del-all") {
          await window.api("/api/messages/" + msgId + "/delete-for-everyone", { method: "POST" });
          await window.loadChatMessages(true);
          window.showToast("\u09b8\u09ac\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09be \u09b9\u09df\u09c7\u099b\u09c7");
        }
      } catch (e) { alert(e.message); }
    });
  });
}
window._openDeleteMessageSheet = _openDeleteMessageSheet;


// ═══════════════════════════════════════════════
// Series 4B — Chat header call buttons
// ═══════════════════════════════════════════════
(function () {
  if (window.__s4b_call_wire) return;
  window.__s4b_call_wire = true;

  document.addEventListener("click", function (e) {
    var callBtn = e.target.closest("#chat-call-btn");
    var videoBtn = e.target.closest("#chat-video-btn");
    if (!callBtn && !videoBtn) return;

    e.preventDefault();
    e.stopPropagation();

    var uname = (typeof window.currentChatUser !== "undefined") ? window.currentChatUser : null;
    if (!uname) {
      if (typeof showToast === "function") window.showToast("চ্যাট খুলুন আগে");
      return;
    }

    if (callBtn && typeof window.startVoiceCall === "function") {
      window.startVoiceCall(uname);
    } else if (videoBtn && typeof window.startVideoCall === "function") {
      window.startVideoCall(uname);
    } else {
      if (typeof showToast === "function") window.showToast("কল মডিউল লোড হচ্ছে...");
    }
  }, true);

  console.log("[S4B] call header wire ✅");
})();


// ═══════════════════════════════════════════════
// SERIES 4B — Call History Page
// ═══════════════════════════════════════════════
(function () {
  if (window.__s4b_call_history) return;
  window.__s4b_call_history = true;

  var _allCalls = [];
  var _callFilter = "all";

  function _t(txt) { return String(txt == null ? "" : txt); }
  function _esc(s) {
    return _t(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                 .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function _init(name) {
    return (_t(name).trim().charAt(0) || "?").toUpperCase();
  }

  function _timeShort(iso) {
    if (!iso) return "";
    try {
      if (typeof shortTime === "function") return shortTime(iso);
    } catch (e) {}
    var d = new Date(String(iso).replace(" ", "T") + "Z");
    return d.toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" });
  }

  function _statusIcon(c) {
    if (c.is_missed) return '<i class="fa-solid fa-phone-slash" style="color:#EF4444"></i>';
    if (c.outgoing) return '<i class="fa-solid fa-arrow-up-right-from-square" style="color:#10B981"></i>';
    return '<i class="fa-solid fa-arrow-down" style="color:#3B82F6"></i>';
  }

  function _statusLabel(c) {
    if (c.status === "missed") return "মিসড";
    if (c.status === "declined") return "ডিক্লাইন";
    if (c.outgoing) return "বহির্গামী";
    return "আগত";
  }

  function _renderList() {
    var list = document.getElementById("calls-list");
    if (!list) return;

    var filtered = _allCalls;
    if (_callFilter === "missed") {
      filtered = _allCalls.filter(function (c) { return c.is_missed; });
    } else if (_callFilter === "outgoing") {
      filtered = _allCalls.filter(function (c) { return c.outgoing; });
    } else if (_callFilter === "incoming") {
      filtered = _allCalls.filter(function (c) { return !c.outgoing; });
    }

    if (!filtered.length) {
      list.innerHTML =
        '<div class="explore-empty" style="padding:60px 20px">' +
          '<i class="fa-solid fa-phone" style="font-size:52px;opacity:0.3"></i>' +
          '<p>কোনো কল নেই</p>' +
        '</div>';
      return;
    }

    list.innerHTML = filtered.map(function (c) {
      var isOut = c.outgoing;
      var other = isOut ? c.callee : c.caller;
      var av = other.profile_pic
        ? '<img src="' + _esc(other.profile_pic) + '" alt="" loading="lazy" decoding="async">'
        : _init(other.display_name);

      var missCls = c.is_missed ? "missed" : "";

      return (
        '<div class="call-log-item" data-username="' + _esc(other.username) + '">' +
          '<div class="call-log-avatar">' + av + '</div>' +
          '<div class="call-log-info">' +
            '<div class="call-log-name ' + missCls + '">' +
              _esc(other.display_name) + ' ' +
              _statusIcon(c) + ' <small style="color:var(--muted);font-weight:600">' +
              _statusLabel(c) + '</small>' +
            '</div>' +
            '<div class="call-log-meta">' + _timeShort(c.created_at) + ' · ' +
              (c.kind === "video" ? "ভিডিও" : "অডিও") +
            '</div>' +
          '</div>' +
          '<button type="button" class="call-log-btn" data-act="voice" data-username="' + _esc(other.username) + '" title="অডিও কল">' +
            '<i class="fa-solid fa-phone"></i>' +
          '</button>' +
          '<button type="button" class="call-log-btn" data-act="video" data-username="' + _esc(other.username) + '" title="ভিডিও কল" style="margin-left:6px">' +
            '<i class="fa-solid fa-video"></i>' +
          '</button>' +
        '</div>'
      );
    }).join("");

    // Wire call buttons
    list.querySelectorAll(".call-log-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var u = btn.dataset.username;
        var act = btn.dataset.act;
        if (!u) return;
        if (act === "video") {
          if (typeof window.startVideoCall === "function") window.startVideoCall(u);
          else alert("কল মডিউল লোড হয়নি");
        } else {
          if (typeof window.startVoiceCall === "function") window.startVoiceCall(u);
          else alert("কল মডিউল লোড হয়নি");
        }
      });
    });

    // Tap row → open profile
    list.querySelectorAll(".call-log-item").forEach(function (row) {
      row.addEventListener("click", function (e) {
        if (e.target.closest(".call-log-btn")) return;
        var u = row.dataset.username;
        if (u && typeof window.openProfile === "function") window.openProfile(u);
      });
    });
  }

  function _renderTabs() {
    var tabs = document.getElementById("call-tabs");
    if (!tabs) return;
    tabs.querySelectorAll(".call-tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.ctab === _callFilter);
    });
  }

  window._openCallHistoryPage = async function () {
    var page = document.getElementById("call-history-page");
    if (!page) return;
    page.classList.remove("hidden");
    _callFilter = "all";
    _renderTabs();

    var list = document.getElementById("calls-list");
    if (list) list.innerHTML = '<div class="explore-empty" style="padding:40px"><p>লোড হচ্ছে...</p></div>';

    try {
      var data = await window.api("/api/calls/history?limit=100");
      _allCalls = Array.isArray(data) ? data : [];
      _renderList();
    } catch (e) {
      if (list) list.innerHTML = '<div class="explore-empty"><p>লোড করা যায়নি: ' + _esc(e.message) + '</p></div>';
    }
  };

  window._closeCallHistoryPage = function () {
    var page = document.getElementById("call-history-page");
    if (page) page.classList.add("hidden");
  };

  // Wire buttons
  document.addEventListener("click", function (e) {
    var nav = e.target.closest('[data-nav="calls"]');
    if (nav) {
      e.preventDefault();
      if (typeof closeSidebar === "function") closeSidebar();
      window._openCallHistoryPage();
      return;
    }
    if (e.target.closest("#messages-call-btn")) {
      e.preventDefault();
      var mp = document.getElementById("messages-page");
      if (mp) mp.classList.add("hidden");
      window._openCallHistoryPage();
      return;
    }
    if (e.target.closest("#calls-back")) {
      e.preventDefault();
      window._closeCallHistoryPage();
      return;
    }
    if (e.target.closest("#calls-refresh")) {
      e.preventDefault();
      window._openCallHistoryPage();
      return;
    }
    var tab = e.target.closest(".call-tab");
    if (tab) {
      e.preventDefault();
      _callFilter = tab.dataset.ctab || "all";
      _renderTabs();
      _renderList();
    }
  }, true);

  console.log("[S4B] call history ready");
})();

