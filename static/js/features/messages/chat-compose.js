// ==================================================
// CHAT: image, reply, reaction, delete
// ==================================================

let _chatPendingImage = null;
let _chatReplyTo = null;

// ---- Attach button ----
var _chatImageInput = document.getElementById("chat-image-input");

if (_chatImageInput) {
  _chatImageInput.addEventListener("change", async function(e) {
    var file = e.target.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      var resized = await resizeImage(file, 800, 0.82);
      _chatPendingImage = resized;
      var prev = document.getElementById("chat-image-preview");
      var img = document.getElementById("chat-image-preview-img");
      img.src = resized;
      prev.classList.remove("hidden");
    } catch (err) {
      alert("ছবি লোড করা যায়নি");
    } finally {
      _chatImageInput.value = "";
    }
  });
}

// ---- Remove image ----
var _chatImgRemove = document.getElementById("chat-image-remove");
if (_chatImgRemove) {
  _chatImgRemove.addEventListener("click", function() {
    _chatPendingImage = null;
    document.getElementById("chat-image-preview").classList.add("hidden");
    document.getElementById("chat-image-preview-img").src = "";
  });
}

// ---- Cancel reply ----
var _chatReplyClose = document.getElementById("crp-close");
if (_chatReplyClose) {
  _chatReplyClose.addEventListener("click", function() {
    _chatReplyTo = null;
    document.getElementById("chat-reply-preview").classList.add("hidden");
  });
}

// ---- Send handler (delegation — no clone) ----
document.addEventListener("submit", async function(e) {
  var form = e.target.closest("#chat-form");
  if (!form) return;
  e.preventDefault();

  var input = form.querySelector("#chat-input");
  if (!input) return;
  var text = (input.value || "").trim();
  var image = _chatPendingImage || "";
  if (!text && !image) return;
  if (!window.currentChatUser) return;

  var wasFocused = document.activeElement === input;
  input.value = "";

  // Optimistic UI
  var temp = document.createElement("div");
  temp.className = "chat-msg outgoing" + (image ? " has-image" : "");
  var tempHTML = "";
  if (_chatReplyTo) {
    tempHTML += '<div class="chat-msg-reply"><div class="cmr-name">' + escapeHtml(_chatReplyTo.name || "") + '</div><div class="cmr-text">' + escapeHtml(_chatReplyTo.text || "") + '</div></div>';
  }
  if (image) tempHTML += '<div class="chat-msg-image"><img src="' + escapeHtml(image) + '" alt="" loading="lazy" decoding="async"></div>';
  if (text) tempHTML += '<div class="chat-msg-text">' + escapeHtml(text) + '</div>';
  tempHTML += '<div class="chat-msg-time">এইমাত্র</div>';
  temp.innerHTML = tempHTML;
  window.chatMessages.appendChild(temp);
  window.chatMessages.scrollTop = window.chatMessages.scrollHeight;
  window.lastMsgCount++;

  var payload = { content: text, image: image };
  if (_chatReplyTo) payload.parent_id = _chatReplyTo.id;

  try {
    await window.api("/api/messages/" + encodeURIComponent(window.currentChatUser), {
      method: "POST",
      body: JSON.stringify(payload),
    });
    _chatPendingImage = null;
    _chatReplyTo = null;
    var ip = document.getElementById("chat-image-preview");
    if (ip) ip.classList.add("hidden");
    var rp = document.getElementById("chat-reply-preview");
    if (rp) rp.classList.add("hidden");
    await loadChatMessages(true);
    await loadConversations();
  } catch (err) {
    temp.remove();
    window.lastMsgCount--;
    alert(err.message);
  } finally {
    // ALWAYS refocus — keep keyboard up for continuous typing
    try { input.focus({ preventScroll: true }); } catch (e) {}
  }
}, true);

// Prevent individual chat send button from stealing focus (keep keyboard up)
// We only block mousedown (desktop) — allow normal click to submit
(function () {
  var sendBtn = document.getElementById("chat-send-btn");
  if (!sendBtn) return;
  sendBtn.addEventListener("mousedown", function (e) { e.preventDefault(); });
})();

// ---- Attach button delegation (works even if form cloned) ----
document.addEventListener("click", function(e) {
  var btn = e.target.closest("#chat-attach-btn");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  var inp = document.getElementById("chat-image-input");
  if (inp) inp.click();
}, true);


// ---------- Hook into openMessagesPage ----------
(function () {
  if (typeof window.openMessagesPage !== "function") return;
  var _origOpen = window.openMessagesPage;
  window.openMessagesPage = async function () {
    await _origOpen();
    try { await window.loadGroups(); } catch (e) {}
  };
})();

