window._lpTimer = null;
// Long-press wiring (event delegation on window.chatMessages)
if (window.chatMessages) {
  window.chatMessages.addEventListener("touchstart", function(e) {
    // Block long-press on date separators
    if (e.target.closest(".chat-date-sep")) return;
    // Block long-press on system messages
    if (e.target.closest(".chat-msg-system")) return;
    var msg = e.target.closest(".chat-msg");
    if (!msg) return;
    if (e.target.closest(".chat-msg-image")) return; // no long-press on images for now
    window._lpMsgId = msg.dataset.mid;
    window._lpMsgEl = msg;
    clearTimeout(window._lpTimer);
    window._lpTimer = setTimeout(function() {
      if (navigator.vibrate) navigator.vibrate(15);
      var isMine = msg.dataset.mine === "1";
      var senderName = isMine ? "আপনি" : (document.querySelector(".chat-user-name") ? document.querySelector(".chat-user-name").textContent : "—");
      var text = msg.querySelector(".chat-msg-text") ? msg.querySelector(".chat-msg-text").textContent : "";
      window._chatMsgMenu(window._lpMsgId, isMine, senderName, text, msg);
    }, 500);
  }, { passive: true });

  window.chatMessages.addEventListener("touchend", function() { clearTimeout(window._lpTimer); });
  window.chatMessages.addEventListener("touchmove", function() { clearTimeout(window._lpTimer); });

  // Also support mouse right-click for desktop
  window.chatMessages.addEventListener("contextmenu", function(e) {
    if (e.target.closest(".chat-date-sep")) { e.preventDefault(); return; }
    var msg = e.target.closest(".chat-msg");
    if (!msg) return;
    e.preventDefault();
    var isMine = msg.dataset.mine === "1";
    var senderName = isMine ? "আপনি" : (document.querySelector(".chat-user-name") ? document.querySelector(".chat-user-name").textContent : "—");
    var text = msg.querySelector(".chat-msg-text") ? msg.querySelector(".chat-msg-text").textContent : "";
    window._chatMsgMenu(msg.dataset.mid, isMine, senderName, text, msg);
  });

  // Double-tap → love reaction
  window.chatMessages.addEventListener("click", async function(e) {
    var msg = e.target.closest(".chat-msg");
    if (!msg) return;
    if (e.target.closest(".chat-msg-image")) return;
    var mid = msg.dataset.mid;
    var now = Date.now();
    if (window._lastTapId === mid && now - window._lastTapMs < 320) {
      // Double tap
      window._lastTapMs = 0; window._lastTapId = null;
      try {
        await api("/api/messages/" + mid + "/react", {
          method: "POST",
          body: JSON.stringify({ reaction: "love" }),
        });
        // Floating heart
        var rect = msg.getBoundingClientRect();
        var fly = document.createElement("div");
        fly.className = "chat-love-fly";
        fly.textContent = "❤️";
        fly.style.left = (rect.left + rect.width / 2) + "px";
        fly.style.top = (rect.top + rect.height / 2) + "px";
        document.body.appendChild(fly);
        setTimeout(function() { fly.remove(); }, 1200);
        if (navigator.vibrate) navigator.vibrate(12);
        await loadChatMessages(true);
      } catch (err) {}
    } else {
      window._lastTapMs = now;
      window._lastTapId = mid;
    }
  });
}
