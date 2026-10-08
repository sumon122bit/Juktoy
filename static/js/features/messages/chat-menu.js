window._lpMsgId = null;
window._lpMsgEl = null;
window._lastTapMs = 0;
window._lastTapId = null;

export function _chatMsgMenu(msgId, isMine, senderName, text, msgEl) {
  var root = document.getElementById("chat-msg-menu");
  if (root) root.remove();

  var isStarred = msgEl && msgEl.dataset.starred === "1";
  var hasText = !!(text && text.trim());
  var hasImage = msgEl && msgEl.querySelector(".chat-msg-image");

  // ============ ROOT ============
  root = document.createElement("div");
  root.id = "chat-msg-menu";
  root.className = "chat-msg-menu-root";
  root.innerHTML = '<div class="cmm-backdrop"></div>';
  document.body.appendChild(root);
  requestAnimationFrame(function () { root.classList.add("show"); });

  // ============ LEFT RAIL (bottom → top) ============
  var rail = document.createElement("div");
  rail.className = "cmm-rail";

  // DOM order: top of DOM = bottom of stack (using column-reverse)
  // So write: reply, copy, forward, star, select, info, then delete with separator
  var _myKind = msgEl ? (msgEl.dataset.kind || "text") : "text";
  var _canEdit = isMine && _myKind !== "voice" && _myKind !== "system";
  var items = [
    { act: "reply",   icon: "fa-solid fa-reply",         label: "উত্তর" },
    { act: "edit",    icon: "fa-solid fa-pen",           label: "এডিট",  show: _canEdit },
    { act: "copy",    icon: "fa-regular fa-copy",         label: "কপি",   show: hasText },
    { act: "forward", icon: "fa-solid fa-share",          label: "ফরওয়ার্ড" },
    { act: "star",    icon: (isStarred ? "fa-solid" : "fa-regular") + " fa-star", label: (isStarred ? "আনস্টার" : "স্টার") },
    { act: "select",  icon: "fa-solid fa-list-check",     label: "সিলেক্ট" },
    { act: "info",    icon: "fa-solid fa-circle-info",    label: "তথ্য" }
  ];

  items.forEach(function (it) {
    if (it.show === false) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "cmm-rail-btn";
    b.dataset.act = it.act;
    b.setAttribute("aria-label", it.label);
    b.innerHTML = '<i class="' + it.icon + '"></i><span class="cmm-rail-tip">' + it.label + '</span>';
    rail.appendChild(b);
  });

  // Divider + delete (danger) — sits at top of rail
  if (isMine) {
    var sep = document.createElement("div");
    sep.className = "cmm-rail-divider";
    rail.appendChild(sep);

    var del = document.createElement("button");
    del.type = "button";
    del.className = "cmm-rail-btn cmm-rail-danger";
    del.dataset.act = "delete";
    del.setAttribute("aria-label", "মুছুন");
    del.innerHTML = '<i class="fa-regular fa-trash-can"></i><span class="cmm-rail-tip">মুছুন</span>';
    rail.appendChild(del);
  }

  root.appendChild(rail);

  // ============ REACTION STRIP (inline, near message) ============
  var strip = document.createElement("div");
  strip.className = "cmm-reaction-strip";
  strip.innerHTML =
    '<button class="cmm-react" data-react="love" aria-label="love">❤️</button>' +
    '<button class="cmm-react" data-react="like" aria-label="like">👍</button>' +
    '<button class="cmm-react" data-react="haha" aria-label="haha">😂</button>' +
    '<button class="cmm-react" data-react="wow" aria-label="wow">😮</button>' +
    '<button class="cmm-react" data-react="sad" aria-label="sad">😢</button>';
  root.appendChild(strip);

  _positionReactionStrip(strip, msgEl);

  // Entrance
  requestAnimationFrame(function () {
    rail.classList.add("in");
    setTimeout(function () { strip.classList.add("in"); }, 80);
  });

  // ============ CLOSE ============
  function close() {
    root.classList.remove("show");
    rail.classList.remove("in");
    strip.classList.remove("in");
    setTimeout(function () {
      if (root.parentNode) root.parentNode.removeChild(root);
    }, 260);
  }
  root.querySelector(".cmm-backdrop").addEventListener("click", close);

  // ============ REACTIONS ============
  strip.querySelectorAll(".cmm-react").forEach(function (rb) {
    rb.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var reaction = rb.dataset.react;
      var emoji = rb.textContent;
      _flyReactionToMessage(rb, msgEl, emoji);
      setTimeout(close, 100);
      (async function () {
        try {
          var res = await api("/api/messages/" + msgId + "/react", {
            method: "POST",
            body: JSON.stringify({ reaction: reaction }),
          });
          if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
          if (msgEl) {
            setTimeout(function () {
              var oldR = msgEl.querySelector(".chat-msg-reactions");
              if (oldR) oldR.remove();
              var emojiMap = { love: "❤️", like: "👍", haha: "😂", wow: "😮", sad: "😢" };
              var em = emojiMap[res.my_reaction] || emoji;
              if (res.count > 0) {
                var el = document.createElement("div");
                el.className = "chat-msg-reactions landing";
                el.innerHTML = '<span class="cmr-pill">' + em + ' ' + res.count + '</span>';
                msgEl.appendChild(el);
                setTimeout(function () { el.classList.remove("landing"); }, 500);
              }
            }, 520);
          }
        } catch (e) { showToast("রিঅ্যাক্ট করা যায়নি"); }
      })();
    });
  });

  // ============ ACTIONS ============
  rail.querySelectorAll(".cmm-rail-btn").forEach(function (b) {
    b.addEventListener("click", async function (ev) {
      ev.stopPropagation();
      var act = b.dataset.act;
      close();

      if (act === "reply") {
        _chatReplyTo = { id: parseInt(msgId), name: senderName, text: text };
        document.getElementById("crp-name").textContent = senderName;
        document.getElementById("crp-text").textContent = (text || "📷 ছবি").slice(0, 60);
        document.getElementById("chat-reply-preview").classList.remove("hidden");
        var inp = document.getElementById("chat-input");
        if (inp) inp.focus();
      } else if (act === "copy") {
        try { await navigator.clipboard.writeText(text || ""); showToast("📋 কপি করা হয়েছে"); }
        catch (e) { showToast("কপি করা যায়নি"); }
      } else if (act === "forward") {
        try { await _openForwardModal(parseInt(msgId), text); }
        catch (e) { showToast("ফরওয়ার্ড খোলা যায়নি"); }
      } else if (act === "star") {
        try {
          var res = await api("/api/messages/" + msgId + "/star", { method: "POST" });
          if (msgEl) {
            msgEl.dataset.starred = res.starred ? "1" : "0";
            var st = msgEl.querySelector(".chat-msg-starred");
            if (res.starred && !st) {
              st = document.createElement("div");
              st.className = "chat-msg-starred";
              st.title = "স্টার করা";
              st.innerHTML = '<i class="fa-solid fa-star"></i>';
              msgEl.appendChild(st);
            } else if (!res.starred && st) { st.remove(); }
          }
          showToast(res.starred ? "⭐ স্টার করা হয়েছে" : "স্টার সরানো হয়েছে");
        } catch (e) { alert(e.message); }
      } else if (act === "select") {
        _enterChatMultiSelect(parseInt(msgId));
      } else if (act === "info") {
        _showMessageInfo(msgEl, msgId, isMine, senderName);
      } else if (act === "delete") {
        if (!confirm("মেসেজটা মুছবেন?")) return;
        try {
        window._openDeleteMessageSheet(msgId, msgEl, isMine);
      } catch (e) { alert(e.message); }
      }
    });
  });
}

// ---------- Position reaction strip near message ----------
export function _positionReactionStrip(strip, msgEl) {
  if (!msgEl) return;
  var r = msgEl.getBoundingClientRect();
  var stripW = 224;
  var stripH = 44;
  var pad = 10;
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  var isOut = msgEl.dataset.mine === "1";

  var top;
  if (r.top - stripH - 10 >= pad) top = r.top - stripH - 10;
  else top = r.bottom + 10;
  if (top + stripH > vh - pad) top = vh - stripH - pad;

  var left;
  if (isOut) left = r.right - stripW;
  else left = r.left;
  if (left < pad) left = pad;
  if (left + stripW > vw - pad) left = vw - stripW - pad;

  strip.style.top = top + "px";
  strip.style.left = left + "px";
}

// ---------- Fly reaction emoji ----------
export function _flyReactionToMessage(sourceEl, targetEl, emoji) {
  if (!sourceEl || !targetEl) return;
  var sr = sourceEl.getBoundingClientRect();
  var tr = targetEl.getBoundingClientRect();
  var isOut = targetEl.dataset.mine === "1";
  var sx = sr.left + sr.width / 2;
  var sy = sr.top + sr.height / 2;
  var tx = isOut ? (tr.left + 26) : (tr.right - 26);
  var ty = tr.bottom - 18;

  var fly = document.createElement("div");
  fly.className = "cmm-fly-emoji";
  fly.textContent = emoji;
  fly.style.left = sx + "px";
  fly.style.top = sy + "px";
  document.body.appendChild(fly);

  var dx = tx - sx;
  var dy = ty - sy;

  requestAnimationFrame(function () {
    fly.style.transform = "translate(-50%,-50%) translate(" + (dx * 0.5) + "px," + (dy * 0.5 - 46) + "px) scale(1.55) rotate(-12deg)";
    fly.style.opacity = "1";
    setTimeout(function () {
      fly.style.transform = "translate(-50%,-50%) translate(" + dx + "px," + dy + "px) scale(0.85) rotate(0deg)";
      fly.style.opacity = "0.35";
    }, 300);
    setTimeout(function () { if (fly.parentNode) fly.parentNode.removeChild(fly); }, 700);
  });
}

// ---------- Message info modal ----------
export function _showMessageInfo(msgEl, msgId, isMine, senderName) {
  var timeEl = msgEl ? msgEl.querySelector(".chat-msg-time") : null;
  var timeText = timeEl ? timeEl.textContent.replace(/[\u2713\u2714\s]+/g, " ").trim() : "—";
  var read = isMine && (msgEl && msgEl.querySelector(".chat-ticks.read")) ? "✅ পঠিত" : (isMine ? "⏳ পাঠানো" : "—");

  var modal = document.createElement("div");
  modal.className = "modal";
  modal.style.zIndex = "99999";
  modal.innerHTML =
    '<div class="modal-content" style="max-width:380px">' +
      '<button class="close-btn" id="info-close" type="button">×</button>' +
      '<h3 style="margin-bottom:16px;font-size:17px">ℹ️ মেসেজের তথ্য</h3>' +
      '<div class="msg-info-row"><span>প্রেরক</span><strong>' + escapeHtml(senderName || "—") + '</strong></div>' +
      '<div class="msg-info-row"><span>সময়</span><strong>' + escapeHtml(timeText) + '</strong></div>' +
      (isMine ? '<div class="msg-info-row"><span>স্ট্যাটাস</span><strong>' + read + '</strong></div>' : '') +
      '<div class="msg-info-row"><span>ID</span><strong>#' + msgId + '</strong></div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.querySelector("#info-close").addEventListener("click", function () { modal.remove(); });
  modal.addEventListener("click", function (e) { if (e.target === modal) modal.remove(); });
}


// ---------- Temporary bridge ----------
window._chatMsgMenu = _chatMsgMenu;
window._positionReactionStrip = _positionReactionStrip;
window._flyReactionToMessage = _flyReactionToMessage;
window._showMessageInfo = _showMessageInfo;
