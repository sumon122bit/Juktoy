// ==================================================
// BATCH 1-10 — Profile extended features
// ==================================================

// Batch 1 — Profile buttons 1-10
// ==================================================
(function () {
  "use strict";
  if (window.__batch1Profile) return;
  window.__batch1Profile = true;

  // S39 — Close button (#profile-close-btn) removed from HTML.
  // Its behavior is now handled by the standard back button only.

  // ---- 3. Search in profile ----
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-search-btn")) return;
    e.preventDefault();
    var page = document.getElementById("search-page");
    var pageInput = document.getElementById("search-page-input");
    if (page && pageInput) {
      // S39 — push to page stack so back button works
      if (typeof window._pushPage === "function") window._pushPage("search-page");
      page.classList.remove("hidden");
      pageInput.value = "";
      setTimeout(function () { try { pageInput.focus(); } catch (err) {} }, 60);
    }
  }, true);

  // ---- 4. Profile menu (⋮) ----
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var isMe = window.state && window.state.me && window.state.me.username === data.user.username;

    // sheet-style menu
    var old = document.getElementById("profile-menu-sheet");
    if (old) old.remove();
    var sheet = document.createElement("div");
    sheet.id = "profile-menu-sheet";
    sheet.className = "sheet-root";
    var items = isMe ? [
      { a: "edit",   i: "fa-pen",               l: "প্রোফাইল এডিট" },
      { a: "share",  i: "fa-share-nodes",        l: "শেয়ার" },
      { a: "copy",   i: "fa-link",               l: "লিংক কপি" },
      { a: "copy",   i: "fa-qrcode",             l: "QR কোড (আসছে)" },
      { a: "settings", i: "fa-gear",             l: "সেটিংস" },
    ] : [
      { a: "copy",   i: "fa-link",               l: "লিংক কপি" },
      { a: "share",  i: "fa-share-nodes",        l: "শেয়ার" },
      { a: "mute",   i: "fa-bell-slash",         l: "মিউট" },
      { a: "block",  i: "fa-ban",                l: "ব্লক",       d: true },
      { a: "report", i: "fa-flag",               l: "রিপোর্ট",    d: true },
    ];
    sheet.innerHTML =
      '<div class="sheet-backdrop"></div>' +
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-menu-list">' +
          items.map(function (it) {
            return '<button type="button" class="sheet-menu-item' + (it.d ? " danger" : "") + '" data-act="' + it.a + '">' +
              '<i class="fa-solid ' + it.i + '"></i><span>' + it.l + '</span></button>';
          }).join("") +
        '</div>' +
      '</div>';
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });
    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 240);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
    sheet.querySelectorAll(".sheet-menu-item").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.dataset.act;
        close();
        if (act === "edit") {
          if (typeof window.openEditProfile === "function") window.openEditProfile();
        } else if (act === "share") {
          var url = window.location.origin + "/u/" + data.user.username;
          if (navigator.share) navigator.share({ title: "JUKTOY", url: url }).catch(function(){});
          else navigator.clipboard.writeText(url).then(function(){ if (typeof showToast === "function") window.showToast("🔗 কপি হয়েছে"); });
        } else if (act === "copy") {
          var url2 = window.location.origin + "/u/" + data.user.username;
          navigator.clipboard.writeText(url2).then(function(){ if (typeof showToast === "function") window.showToast("🔗 লিংক কপি"); });
        } else if (act === "settings") {
          if (typeof window.openSettingsPage === "function") window.openSettingsPage();
        } else if (act === "mute") {
          if (typeof showToast === "function") window.showToast("🔔 মিউট (আসছে)");
        } else if (act === "block") {
          var bb = document.getElementById("btn-block");
          if (bb) bb.click();
        } else if (act === "report") {
          var rb = document.getElementById("btn-report-user");
          if (rb) rb.click();
        }
      });
    });
  }, true);

  // ---- 5. Refresh profile ----
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-refresh-btn")) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var icon = e.target.closest("#profile-refresh-btn").querySelector("i");
    if (icon) {
      icon.style.transition = "transform 0.6s ease";
      icon.style.transform = "rotate(360deg)";
      setTimeout(function(){ icon.style.transition = ""; icon.style.transform = ""; }, 650);
    }
    if (typeof window.openProfile === "function") window.openProfile(data.user.username);
  }, true);

  // ---- 8/9. Follow state machine for OTHER profiles ----
  // Wrap window.openProfile to alter follow button based on is_requested/follows_me
  var _origOpenProfileB1 = window.openProfile;
  if (typeof _origOpenProfileB1 === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB1(username);
      // after render, adjust the follow button
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      if (isMe) return;

      var fb = document.getElementById("btn-follow");
      if (!fb) return;
      var stateAttr = "follow";
      if (data.is_following) stateAttr = "following";
      else if (data.is_requested) stateAttr = "requested";
      else if (data.follows_me) stateAttr = "follow-back";
      fb.dataset.followState = stateAttr;

      // adjust label
      var labelEl = fb.querySelector("span");
      var iconEl = fb.querySelector("i");
      if (stateAttr === "following") {
        if (labelEl) labelEl.textContent = "ফলো করছেন";
        if (iconEl) iconEl.className = "fa-solid fa-user-check";
      } else if (stateAttr === "requested") {
        if (labelEl) labelEl.textContent = "রিকোয়েস্ট পাঠানো";
        if (iconEl) iconEl.className = "fa-solid fa-clock";
      } else if (stateAttr === "follow-back") {
        if (labelEl) labelEl.textContent = "ফলো ব্যাক";
        if (iconEl) iconEl.className = "fa-solid fa-user-plus";
      } else {
        if (labelEl) labelEl.textContent = "ফলো করুন";
        if (iconEl) iconEl.className = "fa-solid fa-user-plus";
      }
    };
  }

  // ---- 10. Follow-requests banner (own profile) ----
  var _origOpenProfileB1b = window.openProfile;
  if (typeof _origOpenProfileB1b === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB1b(username);
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      var banner = document.getElementById("profile-follow-requests");
      if (!banner) return;
      if (!isMe) { banner.classList.add("hidden"); return; }
      try {
        var r = await window.api("/api/me/follow-requests/count");
        var n = (r && r.count) || 0;
        if (n > 0) {
          document.getElementById("frb-count").textContent = n + " জন অপেক্ষা করছেন";
          banner.classList.remove("hidden");
        } else {
          banner.classList.add("hidden");
        }
      } catch (err) { banner.classList.add("hidden"); }
    };
  }

  // ---- Banner open button → follow requests sheet ----
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#frb-open-btn")) return;
    e.preventDefault();
    (async function () {
      try {
        var list = await window.api("/api/me/follow-requests");
        if (!Array.isArray(list) || !list.length) {
          if (typeof showToast === "function") window.showToast("কোনো অনুরোধ নেই");
          return;
        }
        var old = document.getElementById("fr-list-sheet");
        if (old) old.remove();
        var sheet = document.createElement("div");
        sheet.id = "fr-list-sheet";
        sheet.className = "sheet-root";
        sheet.innerHTML =
          '<div class="sheet-backdrop"></div>' +
          '<div class="sheet-panel">' +
            '<div class="sheet-handle"></div>' +
            '<div class="sheet-header"><h3>ফলো রিকোয়েস্ট</h3>' +
            '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="sheet-body">' +
              list.map(function (u) {
                var av = u.profile_pic
                  ? '<img src="' + (window.escapeHtml ? window.escapeHtml(u.profile_pic) : u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
                  : (u.display_name || u.username || "?").charAt(0).toUpperCase();
                return '<div class="fr-row" data-uid="' + u.user_id + '">' +
                  '<div class="fr-av">' + av + '</div>' +
                  '<div class="fr-info">' +
                    '<div class="fr-name">' + (window.escapeHtml ? window.escapeHtml(u.display_name) : u.display_name) + '</div>' +
                    '<div class="fr-uname">@' + (window.escapeHtml ? window.escapeHtml(u.username) : u.username) + '</div>' +
                  '</div>' +
                  '<button class="fr-accept" data-uid="' + u.user_id + '">গ্রহণ</button>' +
                  '<button class="fr-reject" data-uid="' + u.user_id + '"><i class="fa-solid fa-xmark"></i></button>' +
                '</div>';
              }).join("") +
            '</div>' +
          '</div>';
        document.body.appendChild(sheet);
        document.body.classList.add("sheet-open");
        requestAnimationFrame(function () { sheet.classList.add("show"); });
        function close() {
          sheet.classList.remove("show");
          setTimeout(function () {
            if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
            document.body.classList.remove("sheet-open");
          }, 240);
        }
        sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
        sheet.querySelector(".sheet-close").addEventListener("click", close);
        sheet.querySelectorAll(".fr-accept").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              await window.api("/api/me/follow-requests/" + b.dataset.uid + "/accept", { method: "POST" });
              b.closest(".fr-row").remove();
              if (typeof showToast === "function") window.showToast("✅ গ্রহণ করা হয়েছে");
            } catch (err) { alert(err.message || "সমস্যা"); b.disabled = false; }
          });
        });
        sheet.querySelectorAll(".fr-reject").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              await window.api("/api/me/follow-requests/" + b.dataset.uid + "/reject", { method: "POST" });
              b.closest(".fr-row").remove();
              if (typeof showToast === "function") window.showToast("বাতিল");
            } catch (err) { alert(err.message || "সমস্যা"); b.disabled = false; }
          });
        });
      } catch (err) { alert(err.message || "লোড করা যায়নি"); }
    })();
  }, true);

  // ---- styles for follow-request sheet rows ----
  if (!document.getElementById("b1-fr-styles")) {
    var st = document.createElement("style");
    st.id = "b1-fr-styles";
    st.textContent =
      '.fr-row{display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid rgba(0,0,0,.05)}' +
      '.fr-row:last-child{border-bottom:0}' +
      '.fr-av{width:40px;height:40px;border-radius:50%;background:var(--gradient);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;overflow:hidden;flex-shrink:0}' +
      '.fr-av img{width:100%;height:100%;object-fit:cover}' +
      '.fr-info{flex:1;min-width:0}' +
      '.fr-name{font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.fr-uname{font-size:12px;color:var(--muted)}' +
      '.fr-accept{padding:6px 14px;border-radius:8px;background:var(--accent);color:#fff;border:0;font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit}' +
      '.fr-reject{width:34px;height:34px;border-radius:50%;background:rgba(0,0,0,.05);border:0;color:var(--muted);font-size:13px;cursor:pointer;flex-shrink:0;margin-left:4px}' +
      'body.dark .fr-reject{background:rgba(255,255,255,.06)}';
    document.head.appendChild(st);
  }

  console.log("[Batch1] profile buttons 1-10 ready");
})();


// ==================================================
// Batch 2 — Profile buttons 11-20
// ==================================================
(function () {
  "use strict";
  if (window.__batch2Profile) return;
  window.__batch2Profile = true;

  function _sheet(html, id) {
    var old = document.getElementById(id);
    if (old) old.remove();
    var sheet = document.createElement("div");
    sheet.id = id;
    sheet.className = "sheet-root";
    sheet.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });
    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 240);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = sheet.querySelector(".sheet-close");
    if (x) x.addEventListener("click", close);
    return { root: sheet, close: close };
  }

  function _esc(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    return String(s || "").replace(/[<>&"']/g, function (c) {
      return { "<":"&lt;", ">":"&gt;", "&":"&amp;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }

  function _av(name, pic) {
    if (pic) return '<img src="' + _esc(pic) + '" alt="" loading="lazy" decoding="async">';
    return _esc((name || "?").charAt(0).toUpperCase());
  }

  // ============ 11. Reject follow request (already in batch 1 sheet) — ensure it exists ============
  // (batch 1 handles it)

  // ============ 12. Remove follower (own profile) ============
  document.addEventListener("click", function (e) {
    // Hook into existing followers-count stat click → opens list with remove buttons
    var statEls = document.querySelectorAll(".profile-stats .stat-item .stat-num");
    if (!statEls.length) return;
    if (!e.target.closest(".profile-stats")) return;
    var clicked = e.target.closest(".stat-item");
    if (!clicked) return;
    var idx = Array.prototype.indexOf.call(clicked.parentNode.children, clicked);
    if (idx !== 1) return; // only "followers"
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    if (!window.state || !window.state.me || window.state.me.username !== data.user.username) return;
    e.preventDefault();
    e.stopPropagation();
    (async function () {
      try {
        var list = await window.api("/api/users/" + encodeURIComponent(data.user.username) + "/followers");
        var s = _sheet(
          '<div class="sheet-panel">' +
            '<div class="sheet-handle"></div>' +
            '<div class="sheet-header"><h3>ফলোয়ার</h3>' +
            '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="sheet-body">' +
              (list.length
                ? list.map(function (u) {
                    return '<div class="b2-list-row">' +
                      '<div class="b2-list-av">' + _av(u.display_name, u.profile_pic) + '</div>' +
                      '<div class="b2-list-info">' +
                        '<div class="b2-list-name">' + _esc(u.display_name) + '</div>' +
                        '<div class="b2-list-uname">@' + _esc(u.username) + '</div>' +
                      '</div>' +
                      '<button class="b2-list-action danger" data-remove="' + _esc(u.username) + '">সরান</button>' +
                    '</div>';
                  }).join("")
                : '<p style="text-align:center;padding:30px;color:var(--muted)">কোনো ফলোয়ার নেই</p>') +
            '</div>' +
          '</div>', "b2-followers-sheet");
        s.root.querySelectorAll("[data-remove]").forEach(function (b) {
          b.addEventListener("click", async function () {
            if (!confirm("@" + b.dataset.remove + " কে ফলোয়ার থেকে সরাবেন?")) return;
            b.disabled = true;
            try {
              // find user_id
              var list2 = await window.api("/api/users/" + encodeURIComponent(b.dataset.remove));
              if (!list2 || !list2.user) throw new Error("ইউজার পাওয়া যায়নি");
              await window.api("/api/me/followers/" + list2.user.id + "/remove", { method: "POST" });
              b.closest(".b2-list-row").remove();
              if (typeof showToast === "function") window.showToast("✅ সরানো হয়েছে");
            } catch (err) { alert(err.message || "সমস্যা"); b.disabled = false; }
          });
        });
      } catch (err) { alert(err.message || "লোড করা যায়নি"); }
    })();
  }, true);

  // ============ 15/16. Close Friends & Favorites tiles ============
  function _openCfList(mode) {
    var url  = mode === "close" ? "/api/me/close-friends" : "/api/me/favorites";
    var flag = mode === "close" ? "is_close" : "is_favorite";
    var title = mode === "close" ? "Close Friends" : "Favorites";
    var toggleUrl = mode === "close" ? "/close-friend" : "/favorite";

    (async function () {
      try {
        var current = await window.api(url);
        var curNames = {};
        (current || []).forEach(function (u) { curNames[u.username] = true; });

        var all = await window.api("/api/me/following-list");
        var html = (all || []).map(function (u) {
          var isOn = !!u[flag];
          return '<div class="b2-list-row">' +
            '<div class="b2-list-av">' + _av(u.display_name, u.profile_pic) + '</div>' +
            '<div class="b2-list-info">' +
              '<div class="b2-list-name">' + _esc(u.display_name) + '</div>' +
              '<div class="b2-list-uname">@' + _esc(u.username) + '</div>' +
            '</div>' +
            '<button class="b2-list-action' + (isOn ? " on" : "") + '" data-toggle="' + _esc(u.username) + '" data-on="' + (isOn ? "1" : "0") + '">' +
              (isOn ? "✓ " + title : "যোগ") +
            '</button>' +
          '</div>';
        }).join("");

        var s = _sheet(
          '<div class="sheet-panel">' +
            '<div class="sheet-handle"></div>' +
            '<div class="sheet-header"><h3>' + title + '</h3>' +
            '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="sheet-body">' +
              (all && all.length
                ? html
                : '<p style="text-align:center;padding:30px;color:var(--muted)">আপনি এখনো কাউকে ফলো করেননি</p>') +
            '</div>' +
          '</div>', "b2-cf-sheet");

        s.root.querySelectorAll("[data-toggle]").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              var r = await window.api("/api/users/" + encodeURIComponent(b.dataset.toggle) + toggleUrl, { method: "POST" });
              var on = mode === "close" ? r.is_close : r.is_favorite;
              b.classList.toggle("on", on);
              b.textContent = on ? "✓ " + title : "যোগ";
            } catch (err) { alert(err.message || "সমস্যা"); }
            finally { b.disabled = false; }
          });
        });
      } catch (err) { alert(err.message || "লোড করা যায়নি"); }
    })();
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("#cf-close-open")) {
      e.preventDefault(); _openCfList("close");
    } else if (e.target.closest("#cf-fav-open")) {
      e.preventDefault(); _openCfList("fav");
    }
  }, true);

  // show tiles + counts on own profile
  var _origOpenProfileB2 = window.openProfile;
  if (typeof _origOpenProfileB2 === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB2(username);
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      var row = document.getElementById("profile-cf-row");
      if (!row) return;
      if (!isMe) { row.classList.add("hidden"); return; }
      try {
        var c1 = await window.api("/api/me/close-friends");
        var c2 = await window.api("/api/me/favorites");
        document.getElementById("cf-close-count").textContent = (c1 || []).length;
        document.getElementById("cf-fav-count").textContent = (c2 || []).length;
        row.classList.remove("hidden");
      } catch (err) { row.classList.add("hidden"); }
    };
  }

  // ============ 17. Message icon in topbar ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-msg-btn")) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    // S39 — button is hidden on own profile (see window.openProfile), so this
    // only fires on others. Safety check kept just in case:
    if (window.state && window.state.me && window.state.me.username === data.user.username) {
      return;
    }
    // close profile, open chat
    var p = document.getElementById("profile-page");
    if (p) p.classList.add("hidden");
    setTimeout(function () {
      if (typeof window.openMessagesPage === "function") {
        window.openMessagesPage().then(function () {
          if (typeof openChat === "function") openChat(data.user.username);
        });
      }
    }, 150);
  }, true);

  // ============ 20. Voice + Video call buttons in profile-buttons ============
  // Patch the profile-buttons rendering so voice/video circle buttons appear next to message
  var _origOpenProfileB2b = window.openProfile;
  if (typeof _origOpenProfileB2b === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB2b(username);
      return;   // S39 — disabled: voice/video injection removed (handled by main window.openProfile)
      // eslint-disable-next-line no-unreachable
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      if (isMe) return;
      var btns = document.getElementById("profile-buttons");
      if (!btns) return;
      if (btns.dataset.b2Patched === "1") return;
      btns.dataset.b2Patched = "1";

      // add voice + video circles before block/report
      var voice = document.createElement("button");
      voice.className = "btn-call-circle";
      voice.id = "btn-profile-voice";
      voice.title = "Voice call";
      voice.innerHTML = '<i class="fa-solid fa-phone"></i>';

      var video = document.createElement("button");
      video.className = "btn-call-circle";
      video.id = "btn-profile-video";
      video.title = "Video call";
      video.innerHTML = '<i class="fa-solid fa-video"></i>';

      var msgBtn = btns.querySelector("#btn-msg");
      if (msgBtn) {
        msgBtn.parentNode.insertBefore(video, msgBtn.nextSibling);
        msgBtn.parentNode.insertBefore(voice, msgBtn.nextSibling);
      } else {
        btns.appendChild(voice);
        btns.appendChild(video);
      }

      voice.addEventListener("click", function () {
        if (typeof window.startVoiceCall === "function") {
          window.startVoiceCall(data.user.username);
        } else if (typeof showToast === "function") {
          window.showToast("📞 কল মডিউল লোড হচ্ছে...");
        }
      });
      video.addEventListener("click", function () {
        if (typeof window.startVideoCall === "function") {
          window.startVideoCall(data.user.username);
        } else if (typeof showToast === "function") {
          window.showToast("📹 কল মডিউল লোড হচ্ছে...");
        }
      });
    };
  }

  // ============ 18/19. Message request flow ============
  // Wrap sendMessage: if recipient isn't following us, use /request/send
  var _origOpenChatB2 = window.openChat;
  if (typeof _origOpenChatB2 === "function") {
    // We hook into chat send via document-level listener; safer approach:
    // add a small indicator when opening a chat with an unverified user
    window.openChat = async function (username) {
      await _origOpenChatB2(username);
      // Show a subtle hint bar if the chat-input exists and receiver isn't a mutual
      var inp = document.getElementById("chat-input");
      if (!inp) return;
      // Fetch state to decide
      try {
        var p = await window.api("/api/users/" + encodeURIComponent(username));
        var theyFollowMe = !!(p && p.follows_me);
        var chatHeader = document.querySelector(".chat-header");
        var oldHint = document.getElementById("b2-msg-request-hint");
        if (oldHint) oldHint.remove();
        if (!theyFollowMe && chatHeader) {
          var hint = document.createElement("div");
          hint.id = "b2-msg-request-hint";
          hint.style.cssText =
            "padding:6px 12px;font-size:11.5px;font-weight:700;" +
            "background:linear-gradient(135deg,rgba(255,107,107,0.12),rgba(251,146,60,0.08));" +
            "color:var(--accent);text-align:center;border-bottom:1px solid var(--border-soft);";
          hint.textContent = "📨 এটা মেসেজ রিকোয়েস্ট — গ্রহণ করলে চ্যাট শুরু হবে";
          chatHeader.parentNode.insertBefore(hint, chatHeader.nextSibling);
        }
      } catch (e) {}
    };
  }

  // Accept message requests sheet (open from messages topbar / inbox)
  // Add a hint icon in the messages-topbar
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#b2-msg-requests-btn")) return;
    e.preventDefault();
    (async function () {
      try {
        var list = await window.api("/api/messages/requests");
        var s = _sheet(
          '<div class="sheet-panel">' +
            '<div class="sheet-handle"></div>' +
            '<div class="sheet-header"><h3>মেসেজ রিকোয়েস্ট</h3>' +
            '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="sheet-body">' +
              (list && list.length
                ? list.map(function (r) {
                    return '<div class="b2-list-row">' +
                      '<div class="b2-list-av">' + _av(r.display_name, r.profile_pic) + '</div>' +
                      '<div class="b2-list-info">' +
                        '<div class="b2-list-name">' + _esc(r.display_name) + '</div>' +
                        '<div class="b2-list-uname">@' + _esc(r.username) + ' · ' + _esc((r.content || "").slice(0, 40)) + '</div>' +
                      '</div>' +
                      '<button class="b2-list-action on" data-accept="' + r.id + '">গ্রহণ</button>' +
                      '<button class="b2-list-action danger" data-reject="' + r.id + '" style="margin-left:4px">বাতিল</button>' +
                    '</div>';
                  }).join("")
                : '<p style="text-align:center;padding:30px;color:var(--muted)">কোনো মেসেজ রিকোয়েস্ট নেই</p>') +
            '</div>' +
          '</div>', "b2-msg-requests-sheet");

        s.root.querySelectorAll("[data-accept]").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              await window.api("/api/messages/requests/" + b.dataset.accept + "/accept", { method: "POST" });
              b.closest(".b2-list-row").remove();
              if (typeof showToast === "function") window.showToast("✅ গ্রহণ করা হয়েছে");
            } catch (err) { alert(err.message || "সমস্যা"); b.disabled = false; }
          });
        });
        s.root.querySelectorAll("[data-reject]").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              await window.api("/api/messages/requests/" + b.dataset.reject + "/reject", { method: "POST" });
              b.closest(".b2-list-row").remove();
            } catch (err) { alert(err.message || "সমস্যা"); b.disabled = false; }
          });
        });
      } catch (err) { alert(err.message || "লোড করা যায়নি"); }
    })();
  }, true);

  console.log("[Batch2] profile buttons 11-20 ready");
})();


// ==================================================
// Batch 3 — Profile buttons 21-30
// ==================================================
(function () {
  "use strict";
  if (window.__batch3Profile) return;
  window.__batch3Profile = true;

  function _esc(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    return String(s || "").replace(/[<>&"']/g, function (c) {
      return { "<":"&lt;", ">":"&gt;", "&":"&amp;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }

  function _sheet(html, id) {
    var old = document.getElementById(id);
    if (old) old.remove();
    var sheet = document.createElement("div");
    sheet.id = id;
    sheet.className = "sheet-root";
    sheet.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });
    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 240);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = sheet.querySelector(".sheet-close");
    if (x) x.addEventListener("click", close);
    return { root: sheet, close: close };
  }

  function _profileUrl(username) {
    return window.location.origin + "/u/" + encodeURIComponent(username);
  }

  // ============ 21-26. Share sheet with copy/native/whatsapp/telegram/email/dm ============
  function _openShareSheet(username, displayName) {
    var url = _profileUrl(username);
    var text = (displayName || username) + " — JUKTOY-এ দেখুন";

    var s = _sheet(
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>শেয়ার করুন</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:6px 12px 14px">' +
          _row("copy", "bg-copy", "fa-link", "লিংক কপি করুন", "clipboard") +
          _row("native", "bg-nat", "fa-share-nodes", "আরো অপশন", "native share") +
          _row("whatsapp", "bg-wa", "fa-brands fa-whatsapp", "WhatsApp", "chat app") +
          _row("telegram", "bg-tg", "fa-brands fa-telegram", "Telegram", "chat app") +
          _row("email", "bg-mail", "fa-envelope", "Email", "mailto link") +
          _row("dm", "bg-dm", "fa-comment-dots", "JUKTOY DM", "pick a friend") +
        '</div>' +
      '</div>', "b3-share-sheet");

    function _row(a, bg, icon, label, sub) {
      var ic = icon.indexOf("fa-brands") === 0 ? icon : ("fa-solid " + icon);
      return '<div class="b3-share-row" data-act="' + a + '">' +
        '<div class="b3-share-icon ' + bg + '"><i class="' + ic + '"></i></div>' +
        '<div class="b3-share-label">' + _esc(label) +
          '<div class="b3-share-sub">' + _esc(sub) + '</div></div>' +
      '</div>';
    }

    s.root.querySelectorAll(".b3-share-row").forEach(function (r) {
      r.addEventListener("click", async function () {
        var act = r.dataset.act;
        if (act === "copy") {
          try {
            await navigator.clipboard.writeText(url);
            if (typeof showToast === "function") window.showToast("🔗 লিংক কপি হয়েছে");
          } catch (e) { alert("কপি করা যায়নি"); }
          s.close();
        } else if (act === "native") {
          if (navigator.share) {
            try { await navigator.share({ title: "JUKTOY", text: text, url: url }); } catch (e) {}
          } else {
            try { await navigator.clipboard.writeText(url); if (typeof showToast === "function") window.showToast("🔗 কপি হয়েছে"); } catch (e) {}
          }
          s.close();
        } else if (act === "whatsapp") {
          window.open("https://wa.me/?text=" + encodeURIComponent(text + " " + url), "_blank");
          s.close();
        } else if (act === "telegram") {
          window.open("https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(text), "_blank");
          s.close();
        } else if (act === "email") {
          window.location.href = "mailto:?subject=" + encodeURIComponent("JUKTOY — " + displayName) + "&body=" + encodeURIComponent(text + "\n\n" + url);
          s.close();
        } else if (act === "dm") {
          s.close();
          _openShareDM(username, url);
        }
      });
    });
  }

  function _openShareDM(username, url) {
    var s = _sheet(
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>কে পাঠাবেন?</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:8px 12px">' +
          '<div class="input-group" style="margin-bottom:10px">' +
            '<i class="fa-solid fa-magnifying-glass input-icon"></i>' +
            '<input type="text" id="b3-dm-search" placeholder="ইউজারনেম লিখুন...">' +
          '</div>' +
          '<div id="b3-dm-list"><p style="text-align:center;padding:20px;color:var(--muted)">লোড হচ্ছে...</p></div>' +
        '</div>' +
      '</div>', "b3-dm-sheet");

    var listEl = s.root.querySelector("#b3-dm-list");
    var input = s.root.querySelector("#b3-dm-search");

    async function load(q) {
      try {
        var users = await window.api("/api/users?q=" + encodeURIComponent(q || ""));
        var filtered = (users || []).filter(function (u) { return u.username !== username; });
        if (!filtered.length) {
          listEl.innerHTML = '<p style="text-align:center;padding:20px;color:var(--muted)">কেউ পাওয়া যায়নি</p>';
          return;
        }
        listEl.innerHTML = filtered.map(function (u) {
          var av = u.profile_pic
            ? '<img src="' + _esc(u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
            : _esc((u.display_name || "?").charAt(0).toUpperCase());
          return '<div class="b3-share-row" data-to="' + _esc(u.username) + '">' +
            '<div class="b3-share-icon bg-dm" style="overflow:hidden">' + av + '</div>' +
            '<div class="b3-share-label">' + _esc(u.display_name) +
              '<div class="b3-share-sub">@' + _esc(u.username) + '</div></div>' +
          '</div>';
        }).join("");
        listEl.querySelectorAll("[data-to]").forEach(function (b) {
          b.addEventListener("click", async function () {
            var to = b.dataset.to;
            b.disabled = true;
            try {
              await window.api("/api/messages/" + encodeURIComponent(to), {
                method: "POST",
                body: JSON.stringify({ content: "🔗 প্রোফাইল দেখুন: " + url })
              });
              if (typeof showToast === "function") window.showToast("✅ পাঠানো হয়েছে");
              s.close();
            } catch (err) { alert(err.message || "পাঠানো যায়নি"); b.disabled = false; }
          });
        });
      } catch (err) {
        listEl.innerHTML = '<p style="text-align:center;padding:20px;color:var(--danger)">লোড করা যায়নি</p>';
      }
    }
    load("");
    var t = null;
    input.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () { load(input.value.trim()); }, 220);
    });
  }

  // Hook into profile share button to open new sheet (replace old native-only)
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#btn-share-profile")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    _openShareSheet(data.user.username, data.user.display_name);
  }, true);

  // Also hook the "⋮" menu Share to open new sheet
  document.addEventListener("click", function (e) {
    var it = e.target.closest(".sheet-menu-item[data-act='share']");
    if (!it) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    // close existing sheet
    var open = document.querySelector(".sheet-root.show");
    if (open) { open.classList.remove("show"); setTimeout(function(){ if (open.parentNode) open.parentNode.removeChild(open); document.body.classList.remove("sheet-open"); }, 200); }
    setTimeout(function () { _openShareSheet(data.user.username, data.user.display_name); }, 220);
  }, true);

  // ============ 27. QR code (own profile) ============
  // Simple SVG QR-like visualization (not scannable but visually authentic)
  function _miniQR(text) {
    // build a deterministic pseudo-QR from hash of text
    var h = 0;
    for (var i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    var size = 21; // 21x21 like v1 QR
    var cells = [];
    // finder patterns (3 corners)
    function isFinder(r, c) {
      // top-left 7x7
      if (r < 7 && c < 7) return (r === 0 || r === 6 || c === 0 || c === 6 ||
                                  (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      // top-right
      if (r < 7 && c >= size - 7) {
        var cc = c - (size - 7);
        return (r === 0 || r === 6 || cc === 0 || cc === 6 ||
                (r >= 2 && r <= 4 && cc >= 2 && cc <= 4));
      }
      // bottom-left
      if (r >= size - 7 && c < 7) {
        var rr = r - (size - 7);
        return (rr === 0 || rr === 6 || c === 0 || c === 6 ||
                (rr >= 2 && rr <= 4 && c >= 2 && c <= 4));
      }
      return null;
    }
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var finder = isFinder(r, c);
        var on;
        if (finder !== null) {
          on = finder;
        } else {
          var seed = (h ^ (r * 31 + c * 17)) & 0xFFFF;
          on = ((seed * 2654435761) & 0xFFFF) % 3 !== 0;
        }
        cells.push({ r: r, c: c, on: on });
      }
    }
    var px = 6; // each cell 6px
    var dim = size * px + 8; // padding
    var rects = cells.map(function (c) {
      if (!c.on) return "";
      return '<rect x="' + (c.c * px + 4) + '" y="' + (c.r * px + 4) +
             '" width="' + px + '" height="' + px + '" fill="#050505"/>';
    }).join("");
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + dim + '" height="' + dim +
           '" viewBox="0 0 ' + dim + ' ' + dim + '" style="background:#fff;border-radius:12px">' +
           rects + '</svg>';
  }

  document.addEventListener("click", function (e) {
    if (!e.target.closest("#qr-open-btn")) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var url = _profileUrl(data.user.username);
    var wrap = document.getElementById("qr-image-wrap");
    if (wrap) wrap.innerHTML = _miniQR(url);
    var nameEl = document.getElementById("qr-username");
    if (nameEl) nameEl.textContent = "@" + data.user.username;
    var modal = document.getElementById("qr-modal");
    if (modal) modal.classList.remove("hidden");
  }, true);

  document.addEventListener("click", function (e) {
    if (e.target.closest("#qr-close")) {
      var m = document.getElementById("qr-modal");
      if (m) m.classList.add("hidden");
    } else if (e.target.closest("#qr-copy")) {
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      navigator.clipboard.writeText(_profileUrl(data.user.username)).then(function () {
        if (typeof showToast === "function") window.showToast("🔗 লিংক কপি");
      });
    }
  }, true);

  // ============ 28. Wave (👋) ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#btn-profile-wave")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var btn = e.target.closest("#btn-profile-wave");
    btn.disabled = true;
    window.api("/api/users/" + encodeURIComponent(data.user.username) + "/wave", { method: "POST" })
      .then(function () {
        if (typeof showToast === "function") window.showToast("👋 Wave পাঠানো হয়েছে");
        // brief pulse animation
        btn.style.transform = "scale(1.2)";
        setTimeout(function(){ btn.style.transform = ""; }, 200);
      })
      .catch(function (err) { alert(err.message || "পাঠানো যায়নি"); })
      .finally(function () { btn.disabled = false; });
  }, true);

  // ============ 29. Save profile (bookmark) ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#btn-profile-save")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var btn = e.target.closest("#btn-profile-save");
    btn.disabled = true;
    window.api("/api/users/" + encodeURIComponent(data.user.username) + "/save-profile", { method: "POST" })
      .then(function (r) {
        btn.classList.toggle("on", !!r.saved);
        var icon = btn.querySelector("i");
        if (icon) icon.className = r.saved ? "fa-solid fa-bookmark" : "fa-regular fa-bookmark";
        if (typeof showToast === "function") window.showToast(r.saved ? "🔖 সেভ হয়েছে" : "সেভ সরানো হয়েছে");
      })
      .catch(function (err) { alert(err.message || "সমস্যা"); })
      .finally(function () { btn.disabled = false; });
  }, true);

  // ============ 30. Notify bell ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#btn-profile-notify")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var btn = e.target.closest("#btn-profile-notify");
    btn.disabled = true;
    window.api("/api/users/" + encodeURIComponent(data.user.username) + "/notify", { method: "POST" })
      .then(function (r) {
        btn.classList.toggle("on", !!r.notify);
        var icon = btn.querySelector("i");
        if (icon) icon.className = r.notify ? "fa-solid fa-bell" : "fa-regular fa-bell";
        if (typeof showToast === "function") window.showToast(r.notify ? "🔔 নোটিফিকেশন চালু" : "🔕 বন্ধ করা হয়েছে");
      })
      .catch(function (err) { alert(err.message || "সমস্যা"); })
      .finally(function () { btn.disabled = false; });
  }, true);

  // ============ Attach new buttons to profile-buttons on open ============
  var _origOpenProfileB3 = window.openProfile;
  if (typeof _origOpenProfileB3 === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB3(username);
      return;   // S39 — disabled: wave/save/bell injection removed (handled by main window.openProfile)
      // eslint-disable-next-line no-unreachable
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      var btns = document.getElementById("profile-buttons");
      if (!btns) return;
      if (btns.dataset.b3 === "1") return;
      btns.dataset.b3 = "1";

      if (isMe) {
        // own profile → add QR button
        var qrBtn = document.createElement("button");
        qrBtn.id = "qr-open-btn";
        qrBtn.className = "btn-icon-circle";
        qrBtn.title = "QR কোড";
        qrBtn.innerHTML = '<i class="fa-solid fa-qrcode"></i>';
        btns.appendChild(qrBtn);
      } else {
        // other's profile → add wave, save, notify
        var waveBtn = document.createElement("button");
        waveBtn.id = "btn-profile-wave";
        waveBtn.className = "btn-icon-circle";
        waveBtn.title = "Wave 👋";
        waveBtn.innerHTML = '<i class="fa-regular fa-hand"></i>';

        var saveBtn = document.createElement("button");
        saveBtn.id = "btn-profile-save";
        saveBtn.className = "btn-icon-circle";
        saveBtn.title = "Save profile";
        saveBtn.innerHTML = '<i class="fa-regular fa-bookmark"></i>';

        var bellBtn = document.createElement("button");
        bellBtn.id = "btn-profile-notify";
        bellBtn.className = "btn-icon-circle";
        bellBtn.title = "Notify on posts";
        bellBtn.innerHTML = '<i class="fa-regular fa-bell"></i>';

        // insert after message btn if present
        var msgBtn = btns.querySelector("#btn-msg");
        if (msgBtn) {
          msgBtn.parentNode.insertBefore(waveBtn, msgBtn.nextSibling);
          msgBtn.parentNode.insertBefore(saveBtn, waveBtn.nextSibling);
          msgBtn.parentNode.insertBefore(bellBtn, saveBtn.nextSibling);
        } else {
          btns.appendChild(waveBtn);
          btns.appendChild(saveBtn);
          btns.appendChild(bellBtn);
        }

        // load saved/notify status
        try {
          var st = await window.api("/api/me/save-background-check", {
            method: "POST",
            body: JSON.stringify({ username: data.user.username })
          });
          if (st.saved) {
            saveBtn.classList.add("on");
            saveBtn.querySelector("i").className = "fa-solid fa-bookmark";
          }
          if (st.notify) {
            bellBtn.classList.add("on");
            bellBtn.querySelector("i").className = "fa-solid fa-bell";
          }
        } catch (e) {}
      }
    };
  }

  console.log("[Batch3] profile buttons 21-30 ready");
})();


// ===== Batch 4 — Profile tabs + Share to Story + Embed =====
(function () {
  "use strict";
  if (window.__batch4) return;
  window.__batch4 = true;

  function _esc(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function _hideAllPanes() {
    ["posts","reels","photos","tagged","liked","saved","about"].forEach(function (n) {
      var el = document.getElementById("profile-tab-" + n);
      if (el) el.classList.add("hidden");
    });
  }

  function _showPane(name) {
    var el = document.getElementById("profile-tab-" + name);
    if (el) el.classList.remove("hidden");
  }

  async function _renderReels(username) {
    var pane = document.getElementById("profile-tab-reels");
    if (!pane) return;
    pane.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await window.api("/api/users/" + encodeURIComponent(username) + "/reels-list");
      if (!list.length) {
        pane.innerHTML = '<div class="pf-reels-empty">🎬 এখনো কোনো রিল নেই</div>';
        return;
      }
      pane.innerHTML = '<div class="pf-reels-grid">' + list.map(function (r) {
        return '<div class="pf-reel-cell" data-id="' + r.id + '">' +
          '<video src="' + _esc(r.video) + '" muted playsinline preload="metadata"></video>' +
          '<div class="pf-reel-views"><i class="fa-solid fa-heart"></i>' + (r.likes||0) + '</div>' +
        '</div>';
      }).join("") + '</div>';
      pane.querySelectorAll(".pf-reel-cell").forEach(function (c) {
        c.addEventListener("click", function () {
          if (typeof openReelsPage === "function") openReelsPage();
        });
      });
    } catch (err) {
      pane.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>';
    }
  }

  async function _renderTagged(username) {
    var pane = document.getElementById("profile-tab-tagged");
    if (!pane) return;
    pane.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await window.api("/api/users/" + encodeURIComponent(username) + "/tagged-posts");
      if (!list.length) {
        pane.innerHTML = '<div class="pf-tagged-empty">📌 এখনো কেউ ট্যাগ করেনি</div>';
        return;
      }
      pane.innerHTML = list.map(function (p) {
        return '<div class="profile-post" data-post-id="' + p.id + '" data-user="' + _esc(p.username) + '">' +
          '<div class="pp-head" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
            '<strong style="font-size:13.5px">' + _esc(p.display_name) + '</strong>' +
            '<span style="color:var(--muted);font-size:12px">@' + _esc(p.username) + '</span>' +
          '</div>' +
          '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(p.content) : _esc(p.content)) + '</div>' +
          '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(p.created_at) : p.created_at) + '</div>' +
        '</div>';
      }).join("");
      if (window.attachHashtagListeners) attachHashtagListeners(pane);
    } catch (err) {
      pane.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>';
    }
  }

  async function _renderLiked() {
    var pane = document.getElementById("profile-tab-liked");
    if (!pane) return;
    pane.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await window.api("/api/me/liked-posts");
      if (!list.length) {
        pane.innerHTML = '<div class="pf-tagged-empty">❤️ এখনো কিছু লাইক করেননি</div>';
        return;
      }
      pane.innerHTML = list.map(function (p) {
        return '<div class="profile-post">' +
          '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(p.content) : _esc(p.content)) + '</div>' +
          '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(p.created_at) : p.created_at) + ' · @' + _esc(p.username) + '</div>' +
        '</div>';
      }).join("");
      if (window.attachHashtagListeners) attachHashtagListeners(pane);
    } catch (err) {
      pane.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>';
    }
  }

  async function _renderSaved() {
    var pane = document.getElementById("profile-tab-saved");
    if (!pane) return;
    pane.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await window.api("/api/me/saved-posts");
      if (!list.length) {
        pane.innerHTML = '<div class="pf-tagged-empty">🔖 এখনো কিছু সেভ করেননি</div>';
        return;
      }
      pane.innerHTML = list.map(function (p) {
        return '<div class="profile-post">' +
          '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(p.content) : _esc(p.content)) + '</div>' +
          '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(p.created_at) : p.created_at) + ' · @' + _esc(p.username) + '</div>' +
        '</div>';
      }).join("");
      if (window.attachHashtagListeners) attachHashtagListeners(pane);
    } catch (err) {
      pane.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>';
    }
  }


  // Hide liked/saved tabs on OTHER profiles, show only on own
  var _origOpenProfileB4 = window.openProfile;
  if (typeof _origOpenProfileB4 === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB4(username);
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      var liked = document.getElementById("pt-liked");
      var saved = document.getElementById("pt-saved");
      if (liked) liked.style.display = isMe ? "" : "none";
      if (saved) saved.style.display = isMe ? "" : "none";

      // auto-refresh reels count in tab
      try {
        var reels = await window.api("/api/users/" + encodeURIComponent(data.user.username) + "/reels-list");
        var rTab = document.querySelector('.profile-tab[data-tab="reels"]');
        if (rTab && reels.length) {
          var base = rTab.textContent.replace(/\(\d+\)/, "").trim();
          rTab.innerHTML = '<i class="fa-solid fa-film"></i> রিল (' + reels.length + ')';
        }
      } catch (e) {}
    };
  }

  // ===== 31. Share to Story =====
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b4='share-story']");
    if (!b) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var url = window.location.origin + "/u/" + data.user.username;
    if (typeof showToast === "function") window.showToast("📸 স্টোরিতে শেয়ার — লিংক কপি হয়েছে");
    navigator.clipboard.writeText(url).catch(function(){});
  }, true);

  // ===== 33. Embed profile =====
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b4='embed']");
    if (!b) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var url = window.location.origin + "/u/" + data.user.username;
    var code = '<iframe src="' + url + '" width="400" height="600" frameborder="0"></iframe>';
    navigator.clipboard.writeText(code).then(function () {
      if (typeof showToast === "function") window.showToast("📋 Embed code কপি হয়েছে");
    }).catch(function () { alert(code); });
  }, true);

  // Add "Share to Story" + "Embed" to share sheet by extending it
  var _origOpenShareSheet = window._openShareSheet;
  // expose our own version — replace function
  window._openShareSheet = function (username, displayName) {
    // call original first
    if (typeof _origOpenShareSheet === "function") return _origOpenShareSheet(username, displayName);
  };

  console.log("[Batch4] tabs + share-story + embed ready");
  // S39 — Expose for unified profile tab handler
  window._hideAllPanes = _hideAllPanes;
  window._showPane = _showPane;
  window._renderReels = _renderReels;
  window._renderTagged = _renderTagged;
  window._renderLiked = _renderLiked;
  window._renderSaved = _renderSaved;

})();


// ===== Batch 5 — tabs reposts/archived + highlights + similar + live =====
(function () {
  "use strict";
  if (window.__batch5) return;
  window.__batch5 = true;

  function _esc(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function _hideAll() {
    ["posts","reels","photos","tagged","liked","saved","reposts","archived","about"].forEach(function(n){
      var el = document.getElementById("profile-tab-"+n); if (el) el.classList.add("hidden");
    });
  }
  function _show(n) {
    var el = document.getElementById("profile-tab-"+n); if (el) el.classList.remove("hidden");
  }

  async function _renderReposts(username) {
    var p = document.getElementById("profile-tab-reposts");
    if (!p) return;
    p.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await window.api("/api/users/" + encodeURIComponent(username) + "/reposts-list");
      if (!list.length) { p.innerHTML = '<div class="pf-tagged-empty">🔁 এখনো রিপোস্ট নেই</div>'; return; }
      p.innerHTML = list.map(function (r) {
        return '<div class="profile-post">' +
          '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">' +
            '<i class="fa-solid fa-retweet" style="color:var(--accent)"></i>' +
            '<span style="font-size:12px;color:var(--muted)">@' + _esc(r.username) + '</span>' +
          '</div>' +
          '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(r.content) : _esc(r.content)) + '</div>' +
          '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(r.reposted_at) : r.reposted_at) + '</div>' +
        '</div>';
      }).join("");
    } catch (e) { p.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>'; }
  }

  async function _renderArchived() {
    var p = document.getElementById("profile-tab-archived");
    if (!p) return;
    p.innerHTML = '<p class="empty-text">লোড হচ্ছে...</p>';
    try {
      var list = await window.api("/api/me/archived-posts");
      if (!list.length) { p.innerHTML = '<div class="pf-tagged-empty">📦 কোনো আর্কাইভ নেই</div>'; return; }
      p.innerHTML = list.map(function (r) {
        return '<div class="profile-post">' +
          '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(r.content) : _esc(r.content)) + '</div>' +
          '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(r.created_at) : r.created_at) + '</div>' +
        '</div>';
      }).join("");
    } catch (e) { p.innerHTML = '<p class="empty-text">লোড করা যায়নি</p>'; }
  }


  // enrich window.openProfile: highlights + similar + pinned + live + hide own-only tabs
  var _orig = window.openProfile;
  if (typeof _orig === "function") {
    window.openProfile = async function (username) {
      await _orig(username);
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;

      // own-only tabs hide
      ["pt-liked","pt-saved"].forEach(function(id){
        var el = document.getElementById(id);
        if (el) el.style.display = isMe ? "" : "none";
      });

      // live badge
      var nameRow = document.querySelector("#profile-page .profile-name-row h2");
      if (nameRow) {
        var oldBadge = nameRow.parentNode.querySelector(".pf-live-badge");
        if (oldBadge) oldBadge.remove();
        if (data.user.is_live) {
          var b = document.createElement("span");
          b.className = "pf-live-badge";
          b.textContent = "LIVE";
          nameRow.appendChild(b);
        }
      }

      // highlights row
      var hlRow = document.getElementById("profile-highlights");
      if (hlRow) {
        try {
          var hls = await window.api("/api/users/" + encodeURIComponent(username) + "/highlights");
          var html = (hls || []).map(function (h) {
            return '<div class="pf-highlight" data-hl="' + h.id + '">' +
              '<div class="pf-hl-cover">' +
                '<img src="' + _esc(h.cover) + '" alt="" loading="lazy" decoding="async">' +
              '</div>' +
              '<div class="pf-hl-title">' + _esc(h.title) + '</div>' +
            '</div>';
          }).join("");
          if (isMe) {
            html += '<div class="pf-highlight add-hl" id="pf-add-hl">' +
              '<div class="pf-hl-cover"><i class="fa-solid fa-plus"></i></div>' +
              '<div class="pf-hl-title">নতুন</div>' +
            '</div>';
          }
          hlRow.innerHTML = html;
          hlRow.classList.toggle("hidden", !html);
          var addBtn = document.getElementById("pf-add-hl");
          if (addBtn) {
            addBtn.addEventListener("click", function () {
              if (typeof showToast === "function") window.showToast("✨ Highlights আসছে");
            });
          }
        } catch (e) { hlRow.classList.add("hidden"); }
      }

      // similar accounts (other profiles only)
      var simEl = document.getElementById("profile-similar");
      if (simEl) {
        if (isMe) { simEl.classList.add("hidden"); }
        else {
          try {
            var sim = await window.api("/api/users/" + encodeURIComponent(username) + "/similar");
            if (!sim.length) { simEl.classList.add("hidden"); }
            else {
              simEl.innerHTML = '<div class="pf-sim-title">👥 মিলে যায় এমন অ্যাকাউন্ট</div>' +
                '<div class="pf-sim-row">' +
                  sim.map(function (u) {
                    var av = u.profile_pic ? '<img src="' + _esc(u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
                                            : _esc((u.display_name||"?").charAt(0).toUpperCase());
                    return '<div class="pf-sim-item" data-user="' + _esc(u.username) + '">' +
                      '<div class="pf-sim-av">' + av + '</div>' +
                      '<div class="pf-sim-name">' + _esc(u.display_name) + '</div>' +
                    '</div>';
                  }).join("") +
                '</div>';
              simEl.classList.remove("hidden");
              simEl.querySelectorAll("[data-user]").forEach(function (c) {
                c.addEventListener("click", function () {
                  if (typeof window.openProfile === "function") window.openProfile(c.dataset.user);
                });
              });
            }
          } catch (e) { simEl.classList.add("hidden"); }
        }
      }

      // pinned post (prepend as a card at top of posts pane)
      if (data.pinned_post) {
        var postsPane = document.getElementById("profile-tab-posts");
        if (postsPane && !postsPane.dataset.pinnedRendered) {
          postsPane.dataset.pinnedRendered = "1";
          var pinnedHtml = '<div class="profile-post pinned-post-card" style="position:relative">' +
            '<div style="font-size:11.5px;color:var(--accent);font-weight:800;margin-bottom:6px">📌 Pinned</div>' +
            '<div class="post-content">' + (window.linkifyHashtags ? linkifyHashtags(data.pinned_post.content) : _esc(data.pinned_post.content)) + '</div>' +
            '<div class="post-time"><i class="fa-regular fa-clock"></i> ' + (window.timeAgo ? timeAgo(data.pinned_post.created_at) : data.pinned_post.created_at) + '</div>' +
          '</div>';
          postsPane.insertAdjacentHTML("afterbegin", pinnedHtml);
        }
      }
    };
  }

  console.log("[Batch5] highlights + similar + pinned + tabs ready");
  // S39 — Expose for unified profile tab handler
  window._hideAll = _hideAll;
  window._show = _show;
  window._renderReposts = _renderReposts;
  window._renderArchived = _renderArchived;

})();


// ===== Batch 6 — mute / restrict / no-retweet in profile menu =====
(function () {
  "use strict";
  if (window.__batch6) return;
  window.__batch6 = true;

  function _esc(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function _sheet(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var s = document.createElement("div");
    s.id = id; s.className = "sheet-root";
    s.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(s); document.body.classList.add("sheet-open");
    requestAnimationFrame(function(){ s.classList.add("show"); });
    function close(){ s.classList.remove("show");
      setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s);
        document.body.classList.remove("sheet-open"); }, 220); }
    s.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = s.querySelector(".sheet-close"); if (x) x.addEventListener("click", close);
    return { root: s, close: close };
  }

  // Extend the ⋮ profile menu with new items
  var _origOpenMenu = window.openPostMenu; // not used here — instead hook into the profile menu

  // We hook into the sheet-menu-item click for existing profile menu items
  // Add "mute / restrict / no-retweet / subscribe" to profile menu by extending the menu builder
  // Since batch1 already creates it in a click handler, patch via another click listener that
  // intercepts the menu open, then re-renders with extra items.

  // Simpler: add to the existing profile menu — detect menu, inject before it renders
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    // wait a tick for the menu to render, then inject extra items
    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel) return;
      if (panel.dataset.b6 === "1") return;
      panel.dataset.b6 = "1";
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      if (isMe) return;

      var extra = [
        { a: "mute",       i: "fa-bell-slash",   l: "মিউট (নীরব)",   c: "b6-mute" },
        { a: "restrict",   i: "fa-eye-slash",    l: "রেস্ট্রিক্ট",    c: "b6-restrict" },
        { a: "noretweet",  i: "fa-retweet",      l: "রিটুইট বন্ধ",   c: "b6-noretweet" },
        { a: "subscribe",  i: "fa-star",         l: "সাবস্ক্রাইব",    c: "b6-subscribe", coming: true },
      ];

      extra.forEach(function (it) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sheet-menu-item " + it.c;
        btn.innerHTML = '<i class="fa-solid ' + it.i + '"></i><span>' + it.l + '</span>' +
          (it.coming ? ' <span style="font-size:9.5px;font-weight:800;color:var(--accent);margin-left:6px">SOON</span>' : '');
        panel.appendChild(btn);
      });

      // load current states
      (async function () {
        try {
          var u = data.user.username;
          var st = await Promise.all([
            window.api("/api/users/" + encodeURIComponent(u) + "/mute/status"),
            window.api("/api/users/" + encodeURIComponent(u) + "/restrict/status"),
            window.api("/api/users/" + encodeURIComponent(u) + "/no-retweet/status"),
          ]);
          if (st[0].muted) {
            var b = panel.querySelector(".b6-mute span");
            if (b) b.textContent = "আনমিউট";
          }
          if (st[1].restricted) {
            var b2 = panel.querySelector(".b6-restrict span");
            if (b2) b2.textContent = "আনরেস্ট্রিক্ট";
          }
          if (st[2].no_retweet) {
            var b3 = panel.querySelector(".b6-noretweet span");
            if (b3) b3.textContent = "রিটুইট চালু";
          }
        } catch (err) {}
      })();

      // wire
      panel.querySelectorAll(".b6-mute, .b6-restrict, .b6-noretweet, .b6-subscribe").forEach(function (b) {
        b.addEventListener("click", async function () {
          var u = data.user.username;
          try {
            if (b.classList.contains("b6-mute")) {
              var r = await window.api("/api/users/" + encodeURIComponent(u) + "/mute", { method: "POST" });
              if (typeof showToast === "function") window.showToast(r.muted ? "🔕 মিউট করা হয়েছে" : "🔔 আনমিউট");
            } else if (b.classList.contains("b6-restrict")) {
              var r2 = await window.api("/api/users/" + encodeURIComponent(u) + "/restrict", { method: "POST" });
              if (typeof showToast === "function") window.showToast(r2.restricted ? "🔒 রেস্ট্রিক্টেড" : "✅ আনরেস্ট্রিক্ট");
            } else if (b.classList.contains("b6-noretweet")) {
              var r3 = await window.api("/api/users/" + encodeURIComponent(u) + "/no-retweet", { method: "POST" });
              if (typeof showToast === "function") window.showToast(r3.no_retweet ? "🚫 রিটুইট বন্ধ" : "🔁 রিটুইট চালু");
            } else if (b.classList.contains("b6-subscribe")) {
              if (typeof showToast === "function") window.showToast("⭐ সাবস্ক্রাইব — শীঘ্রই আসছে");
            }
          } catch (err) { alert(err.message || "সমস্যা"); }
          // close menu
          var open = document.querySelector("#profile-menu-sheet.show");
          if (open) { open.classList.remove("show"); setTimeout(function(){ if(open.parentNode) open.parentNode.removeChild(open); document.body.classList.remove("sheet-open"); }, 200); }
        });
      });
    }, 50);
  }, true);

  console.log("[Batch6] mute/restrict/no-retweet ready");
})();


// ===== Batch 7 — report story / hide / snooze / break =====
(function () {
  "use strict";
  if (window.__batch7) return;
  window.__batch7 = true;

  function _esc(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function _sheet(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var s = document.createElement("div");
    s.id = id; s.className = "sheet-root";
    s.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(s); document.body.classList.add("sheet-open");
    requestAnimationFrame(function(){ s.classList.add("show"); });
    function close(){ s.classList.remove("show");
      setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s);
        document.body.classList.remove("sheet-open"); }, 220); }
    s.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = s.querySelector(".sheet-close"); if (x) x.addEventListener("click", close);
    return { root: s, close: close };
  }

  function _modal(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var m = document.createElement("div");
    m.id = id; m.className = "modal";
    m.innerHTML = html;
    document.body.appendChild(m);
    return m;
  }

  // ============ 62. Report story — hook into story viewer ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#sv-report")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var viewer = document.getElementById("story-viewer");
    if (!viewer || viewer.classList.contains("hidden")) return;
    // find current story id
    var bar = document.getElementById("sv-reactions-bar");
    var sid = bar ? bar.dataset.storyId : null;
    if (!sid) return;
    _openReportStorySheet(sid);
  }, true);

  // Add "Report" button to story viewer footer (if not present)
  var _origRender = window.renderCurrentStory;
  if (typeof _origRender === "function") {
    window.renderCurrentStory = async function () {
      await _origRender();
      var footer = document.querySelector(".sv-footer");
      if (!footer || document.getElementById("sv-report")) return;
      var b = document.createElement("button");
      b.id = "sv-report";
      b.className = "sv-delete";
      b.style.background = "rgba(0,0,0,0.45)";
      b.style.marginLeft = "6px";
      b.innerHTML = '<i class="fa-solid fa-flag"></i> রিপোর্ট';
      footer.appendChild(b);
    };
  }

  function _openReportStorySheet(sid) {
    var reasons = [
      { v: "spam",        l: "স্প্যাম / বিজ্ঞাপন",         i: "fa-bullhorn" },
      { v: "harassment",  l: "হয়রানি / গালাগালি",         i: "fa-hand-fist" },
      { v: "violence",    l: "হিংস্রতা / ভয় দেখানো",     i: "fa-triangle-exclamation" },
      { v: "false_info",  l: "মিথ্যা তথ্য",                 i: "fa-circle-exclamation" },
      { v: "other",       l: "অন্য কিছু",                  i: "fa-ellipsis" },
    ];
    var s = _sheet("b7-report-story-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>স্টোরি রিপোর্ট</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:8px 12px">' +
          reasons.map(function(r){
            return '<div class="b3-share-row" data-reason="' + r.v + '">' +
              '<div class="b3-share-icon" style="background:var(--danger)"><i class="fa-solid ' + r.i + '"></i></div>' +
              '<div class="b3-share-label">' + _esc(r.l) + '</div>' +
            '</div>';
          }).join("") +
          '<textarea id="b7-story-notes" placeholder="অতিরিক্ত কিছু? (ঐচ্ছিক)" maxlength="500" ' +
          'style="width:100%;margin-top:10px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);' +
          'font-family:inherit;font-size:13.5px;color:var(--text);background:var(--card-2);min-height:70px;resize:vertical;outline:none"></textarea>' +
        '</div>' +
      '</div>');

    s.root.querySelectorAll("[data-reason]").forEach(function (r) {
      r.addEventListener("click", async function () {
        var reason = r.dataset.reason;
        var notes = (s.root.querySelector("#b7-story-notes").value || "").trim();
        r.style.pointerEvents = "none";
        try {
          await window.api("/api/stories/" + sid + "/report", {
            method: "POST",
            body: JSON.stringify({ reason: reason, notes: notes })
          });
          s.close();
          if (typeof showToast === "function") window.showToast("✅ রিপোর্ট পাঠানো হয়েছে");
        } catch (err) {
          alert(err.message || "সমস্যা");
          r.style.pointerEvents = "";
        }
      });
    });
  }

  // ============ 63. Hide from feed — post menu item ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest('[data-action="hide"]');
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var postEl = b.closest(".post");
    if (!postEl) return;
    var postId = postEl.dataset.id;
    if (!postId) return;
    if (typeof window.closePostMenu === "function") window.closePostMenu();
    (async function () {
      try {
        await window.api("/api/posts/" + postId + "/hide", { method: "POST" });
        postEl.style.transition = "opacity 0.3s, transform 0.3s";
        postEl.style.opacity = "0";
        postEl.style.transform = "scale(0.96)";
        setTimeout(function(){ postEl.remove(); }, 320);
        if (typeof showToast === "function") window.showToast("🙈 পোস্ট লুকানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); }
    })();
  }, true);

  // Extend post menu to include "Hide" for all posts (currently only delete for own)
  var _origHandle = window.handlePostMenuAction;
  if (typeof _origHandle === "function") {
    window.handlePostMenuAction = async function (action, btn, postEl, postId) {
      if (action === "hide") {
        try {
          await window.api("/api/posts/" + postId + "/hide", { method: "POST" });
          postEl.style.transition = "opacity 0.3s, transform 0.3s";
          postEl.style.opacity = "0";
          postEl.style.transform = "scale(0.96)";
          setTimeout(function(){ postEl.remove(); }, 320);
          if (typeof showToast === "function") window.showToast("🙈 পোস্ট লুকানো হয়েছে");
        } catch (err) { alert(err.message || "সমস্যা"); }
        return;
      }
      return _origHandle(action, btn, postEl, postId);
    };
  }

  // Inject "Hide" into post menu popup right after it's created
  var _origOpenPostMenu = window.openPostMenu;
  if (typeof _origOpenPostMenu === "function") {
    window.openPostMenu = function (btn, postEl, postId) {
      _origOpenPostMenu(btn, postEl, postId);
      setTimeout(function () {
        var menu = document.getElementById("post-menu-popup");
        if (!menu || menu.dataset.b7 === "1") return;
        menu.dataset.b7 = "1";
        // Insert "Hide" before report/delete
        var saveBtn = menu.querySelector('button[data-action="save"]');
        var target = menu.querySelector('button[data-action="report"]') || menu.querySelector('button[data-action="delete"]');
        if (!target) return;
        var hideBtn = document.createElement("button");
        hideBtn.setAttribute("data-action", "hide");
        hideBtn.innerHTML = '<i class="fa-regular fa-eye-slash"></i><span>লুকান</span>';
        menu.insertBefore(hideBtn, target);
      }, 30);
    };
  }

  // ============ 64. Snooze — profile menu item ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".b7-snooze-open");
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var username = data.user.username;
    // close existing menu
    var open = document.querySelector(".sheet-root.show");
    if (open) { open.classList.remove("show"); setTimeout(function(){ if(open.parentNode) open.parentNode.removeChild(open); document.body.classList.remove("sheet-open"); }, 180); }

    setTimeout(function () {
      var s = _sheet("b7-snooze-sheet",
        '<div class="sheet-panel">' +
          '<div class="sheet-handle"></div>' +
          '<div class="sheet-header"><h3>স্নুজ করুন</h3>' +
          '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
          '<div class="sheet-body" style="padding:6px 0">' +
            [1, 7, 30, 90, 365].map(function(d){
              var label = d === 365 ? "1 বছর" : (d + " দিন");
              return '<div class="b7-snooze-row">' +
                '<div><div class="b7-snooze-label">' + label + '</div>' +
                '<div class="b7-snooze-sub">এই সময়ে এই ইউজারের পোস্ট দেখবেন না</div></div>' +
                '<button class="b7-snooze-btn" data-days="' + d + '">স্নুজ</button>' +
              '</div>';
            }).join("") +
          '</div>' +
        '</div>');

      s.root.querySelectorAll(".b7-snooze-btn").forEach(function (b2) {
        b2.addEventListener("click", async function () {
          var days = b2.dataset.days;
          b2.disabled = true;
          try {
            await window.api("/api/users/" + encodeURIComponent(username) + "/snooze", {
              method: "POST",
              body: JSON.stringify({ days: parseInt(days) })
            });
            s.close();
            if (typeof showToast === "function") window.showToast("😴 " + days + " দিনের জন্য স্নুজ");
          } catch (err) { alert(err.message || "সমস্যা"); b2.disabled = false; }
        });
      });
    }, 220);
  }, true);

  // Inject Snooze into profile menu
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel || panel.dataset.b7s === "1") return;
      panel.dataset.b7s = "1";
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      if (isMe) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sheet-menu-item b7-snooze-open";
      btn.innerHTML = '<i class="fa-solid fa-moon"></i><span>স্নুজ করুন</span>';
      // insert after mute/restrict/noretweet section
      var last = panel.querySelector(".b6-noretweet");
      if (last && last.nextSibling) panel.insertBefore(btn, last.nextSibling);
      else panel.appendChild(btn);
    }, 55);
  }, true);

  // ============ 65. Take a break ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b7='take-break']");
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var m = _modal("b7-break-modal",
      '<div class="modal-content b7-break-modal-content">' +
        '<div class="b7-break-icon">🌿</div>' +
        '<div class="b7-break-title">একটু বিরতি নিন</div>' +
        '<div class="b7-break-text">' +
          'সোশ্যাল মিডিয়া থেকে কয়েক ঘণ্টা দূরে থাকুন।<br>' +
          'আপনার মন ভালো থাকবে। 🌱' +
        '</div>' +
        '<div class="b7-break-actions">' +
          '<button class="primary" id="b7-break-go">এখনই শুরু করুন</button>' +
          '<button id="b7-break-cancel">বাতিল</button>' +
        '</div>' +
      '</div>');
    m.querySelector("#b7-break-cancel").onclick = function () { m.remove(); };
    m.querySelector("#b7-break-go").onclick = async function () {
      try {
        var r = await window.api("/api/me/take-break", { method: "POST" });
        m.remove();
        if (typeof showToast === "function") window.showToast(r.message || "🌿 বিরতি নিন");
      } catch (err) { alert(err.message || "সমস্যা"); }
    };
    m.addEventListener("click", function (ev) { if (ev.target === m) m.remove(); });
  }, true);


  // ============ 66. Report imposter ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b7='report-imposter']");
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    var m = _modal("b7-imposter-modal",
      '<div class="modal-content" style="max-width:400px">' +
        '<button class="close-btn" id="b7-imp-close">×</button>' +
        '<h3 style="margin-bottom:14px;font-size:18px">🎭 ইম্পোস্টার রিপোর্ট</h3>' +
        '<p style="font-size:13px;color:var(--muted);margin-bottom:12px">' +
          'এই অ্যাকাউন্ট কাউকে নকল করছে মনে হলে নিচে বিস্তারিত লিখুন।' +
        '</p>' +
        '<textarea id="b7-imp-notes" placeholder="কার নকল করছে? বিস্তারিত..." maxlength="500" ' +
        'style="width:100%;min-height:90px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);' +
        'font-family:inherit;font-size:13.5px;background:var(--card-2);color:var(--text);outline:none;resize:vertical"></textarea>' +
        '<div class="edit-actions" style="margin-top:14px">' +
          '<button class="btn-secondary" id="b7-imp-cancel">বাতিল</button>' +
          '<button class="btn-primary danger-btn" id="b7-imp-send" style="width:auto;padding:11px 22px">' +
            '<i class="fa-solid fa-paper-plane"></i> পাঠান' +
          '</button>' +
        '</div>' +
      '</div>');
    m.querySelector("#b7-imp-close").onclick = function () { m.remove(); };
    m.querySelector("#b7-imp-cancel").onclick = function () { m.remove(); };
    m.addEventListener("click", function (ev) { if (ev.target === m) m.remove(); });
    m.querySelector("#b7-imp-send").onclick = async function () {
      var notes = (m.querySelector("#b7-imp-notes").value || "").trim();
      if (!notes) return alert("বিস্তারিত লিখুন");
      var sendBtn = m.querySelector("#b7-imp-send");
      sendBtn.disabled = true;
      try {
        await window.api("/api/me/report-imposter", {
          method: "POST",
          body: JSON.stringify({ username: data.user.username, notes: notes })
        });
        m.remove();
        if (typeof showToast === "function") window.showToast("✅ রিপোর্ট পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); sendBtn.disabled = false; }
    };
  }, true);

  // Inject Report Imposter into profile menu
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel || panel.dataset.b7i === "1") return;
      panel.dataset.b7i = "1";
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      if (isMe) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sheet-menu-item danger";
      btn.setAttribute("data-b7", "report-imposter");
      btn.innerHTML = '<i class="fa-solid fa-mask"></i><span>ইম্পোস্টার রিপোর্ট</span>';
      panel.appendChild(btn);
    }, 60);
  }, true);

  console.log("[Batch7] report-story + hide + snooze + break + imposter ready");
})();


// ===== Batch 8 — extended profile + insights =====
(function () {
  "use strict";
  if (window.__batch8) return;
  window.__batch8 = true;

  function _esc(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  // ============ Extend Edit Profile modal — load current values ============
  var _origOpenEdit = window.openEditProfile;
  if (typeof _origOpenEdit === "function") {
    window.openEditProfile = async function () {
      _origOpenEdit();
      try {
        var ext = await window.api("/api/me/profile-extended");
        var pr = document.getElementById("edit-pronouns");
        var lo = document.getElementById("edit-location");
        var ca = document.getElementById("edit-category");
        var bl = document.getElementById("edit-bio-links");
        if (pr) pr.value = ext.pronouns || "";
        if (lo) lo.value = ext.location || "";
        if (ca) ca.value = ext.category || "";
        if (bl) bl.value = ext.bio_links || "";
      } catch (e) {}
    };
  }

  // ============ Extend save ============
  var _origSave = window.saveEditProfile;
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#save-edit-profile")) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    (async function () {
      var name = document.getElementById("edit-name");
      var bio = document.getElementById("edit-bio");
      var pr = document.getElementById("edit-pronouns");
      var lo = document.getElementById("edit-location");
      var ca = document.getElementById("edit-category");
      var bl = document.getElementById("edit-bio-links");
      var btn = document.getElementById("save-edit-profile");
      btn.disabled = true;
      var oldHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> সেভ...';
      try {
        // 1. Basic bio + name
        await window.api("/api/me/bio", {
          method: "POST",
          body: JSON.stringify({
            bio: bio ? bio.value.trim() : "",
            display_name: name ? name.value.trim() : "",
          })
        });
        // 2. Extended fields
        await window.api("/api/me/profile-extended", {
          method: "POST",
          body: JSON.stringify({
            pronouns: pr ? pr.value.trim() : "",
            location: lo ? lo.value.trim() : "",
            category: ca ? ca.value : "",
            bio_links: bl ? bl.value.trim() : "",
          })
        });
        // 3. avatar/cover (handled by original save code) — call them if pending
        if (typeof pendingAvatar !== "undefined" && pendingAvatar !== null) {
          var r = await window.api("/api/me/avatar", {
            method: "POST",
            body: JSON.stringify({ avatar: pendingAvatar })
          });
          if (window.state.me) window.state.me.profile_pic = r.avatar;
        }
        if (typeof pendingCover !== "undefined" && pendingCover !== null) {
          var rc = await window.api("/api/me/cover", {
            method: "POST",
            body: JSON.stringify({ cover: pendingCover })
          });
          if (window.state.me) window.state.me.cover_pic = rc.cover;
        }
        // refresh
        var me = await window.api("/api/me");
        if (me && me.user) window.state.me = me.user;
        if (typeof window.refreshProfileUI === "function") window.refreshProfileUI();
        if (typeof loadFeed === "function") window.loadFeed();
        // close modal
        var m = document.getElementById("edit-profile-modal");
        if (m) m.classList.add("hidden");
        if (typeof showToast === "function") window.showToast("✅ প্রোফাইল সেভ হয়েছে");
        // re-render profile if open
        if (window.state.me && typeof window.openProfile === "function") window.openProfile(window.state.me.username);
      } catch (err) {
        alert(err.message || "সেভ করা যায়নি");
      } finally {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
      }
    })();
  }, true);

  // ============ Render extended info on profile page ============
  var _origOpenProfileB8 = window.openProfile;
  if (typeof _origOpenProfileB8 === "function") {
    window.openProfile = async function (username) {
      await _origOpenProfileB8(username);
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var u = data.user;

      // Pronouns badge next to name
      var nameEl = document.getElementById("profile-page-name");
      if (nameEl) {
        var oldPr = nameEl.parentNode.querySelector(".pf-pronouns-badge");
        if (oldPr) oldPr.remove();
        if (u.pronouns) {
          var b = document.createElement("span");
          b.className = "pf-pronouns-badge";
          b.textContent = u.pronouns;
          nameEl.appendChild(b);
        }
      }

      // Category badge
      if (nameEl) {
        var oldCat = nameEl.parentNode.querySelector(".pf-category-badge");
        if (oldCat) oldCat.remove();
        if (u.category) {
          var catLabel = {
            "personal": "👤 ব্যক্তিগত",
            "creator": "🎨 ক্রিয়েটর",
            "business": "💼 ব্যবসা",
            "public_figure": "⭐ পাবলিক ফিগার",
            "brand": "🏷 ব্র্যান্ড",
            "community": "👥 কমিউনিটি",
          }[u.category] || u.category;
          var cb = document.createElement("span");
          cb.className = "pf-category-badge";
          cb.textContent = catLabel;
          nameEl.appendChild(cb);
        }
      }

      // Location line under username
      var unameEl = document.getElementById("profile-page-username");
      if (unameEl) {
        var oldLoc = unameEl.parentNode.querySelector(".pf-location-line");
        if (oldLoc) oldLoc.remove();
        if (u.location) {
          var l = document.createElement("div");
          l.className = "pf-location-line";
          l.innerHTML = '<i class="fa-solid fa-location-dot"></i> ' + _esc(u.location);
          unameEl.parentNode.appendChild(l);
        }
      }

      // Bio links
      var bioEl = document.getElementById("profile-page-bio");
      if (bioEl) {
        var oldLinks = bioEl.parentNode.querySelector(".pf-bio-links");
        if (oldLinks) oldLinks.remove();
        if (u.bio_links) {
          var links = u.bio_links.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
          if (links.length) {
            var wrap = document.createElement("div");
            wrap.className = "pf-bio-links";
            wrap.innerHTML = links.map(function (link) {
              var display = link.replace(/^https?:\/\//, "").split("/")[0];
              var href = /^https?:\/\//.test(link) ? link : ("https://" + link);
              return '<a class="pf-bio-link" href="' + _esc(href) + '" target="_blank" rel="noopener">' +
                '<i class="fa-solid fa-link"></i> ' + _esc(display) + '</a>';
            }).join("");
            bioEl.parentNode.appendChild(wrap);
          }
        }
      }

      // ============ Inject Insights button (own profile only) ============
      var isMe = window.state && window.state.me && window.state.me.username === u.username;
      var btns = document.getElementById("profile-buttons");
      if (btns && isMe) {
        if (!document.getElementById("btn-open-insights")) {
          var b = document.createElement("button");
          b.id = "btn-open-insights";
          b.className = "btn-icon-circle";
          b.title = "ইনসাইট";
          b.innerHTML = '<i class="fa-solid fa-chart-line"></i>';
          b.addEventListener("click", function () {
            if (typeof window.openInsightsPage === "function") window.openInsightsPage();
          });
          btns.appendChild(b);
        }
      }
    };
  }

  // ============ Insights page ============
  window.openInsightsPage = async function () {
    var page = document.getElementById("insights-page");
    if (!page) return;
    page.classList.remove("hidden");
    var body = document.getElementById("insights-body");
    body.innerHTML = '<p style="text-align:center;padding:40px;color:var(--muted)">লোড হচ্ছে...</p>';
    try {
      var d = await window.api("/api/me/insights");
      var cards = [
        { i: "fa-file-lines",     v: d.posts,             l: "মোট পোস্ট" },
        { i: "fa-heart",          v: d.likes_received,    l: "মোট লাইক" },
        { i: "fa-comment",        v: d.comments_received, l: "মোট মন্তব্য" },
        { i: "fa-user-plus",      v: d.new_followers_7d,  l: "নতুন ফলোয়ার (৭দিন)" },
      ];
      var cardsHTML = cards.map(function (c) {
        return '<div class="ins-card">' +
          '<div class="ins-icon"><i class="fa-solid ' + c.i + '"></i></div>' +
          '<div class="ins-value">' + (c.v || 0) + '</div>' +
          '<div class="ins-label">' + c.l + '</div>' +
        '</div>';
      }).join("");

      // weekly chart
      var max = Math.max.apply(null, d.chart.map(function (x) { return x.count; })) || 1;
      var dayLabels = ["আজ","১","২","৩","৪","৫","৬"];
      var barsHTML = d.chart.map(function (x) {
        var pct = (x.count / max) * 100;
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center">' +
          '<div class="ins-bar" style="height:' + Math.max(pct, 4) + '%" title="' + x.count + '"></div>' +
          '<div class="ins-bar-day">' + dayLabels[6 - x.day] + '</div>' +
        '</div>';
      }).join("");

      var topHTML = "";
      if (d.top_post) {
        topHTML = '<div class="ins-top-post">' +
          '<h4>🏆 সর্বোচ্চ এনগেজড পোস্ট</h4>' +
          '<div class="post-content">' + _esc((d.top_post.content || "").slice(0, 200)) + '</div>' +
          '<div style="font-size:12.5px;color:var(--muted);font-weight:700">' +
            '<i class="fa-solid fa-heart" style="color:#ef4444"></i> ' + d.top_post.likes + ' লাইক' +
          '</div>' +
        '</div>';
      }

      body.innerHTML = '<div class="insights-grid">' + cardsHTML + '</div>' +
        '<div class="ins-chart">' +
          '<div class="ins-chart-title">📈 সাপ্তাহিক লাইক</div>' +
          '<div class="ins-bars">' + barsHTML + '</div>' +
        '</div>' +
        topHTML;
    } catch (err) {
      body.innerHTML = '<p style="text-align:center;padding:40px;color:var(--danger)">লোড করা যায়নি</p>';
    }
  };

  document.addEventListener("click", function (e) {
    if (e.target.closest("#insights-back")) {
      var p = document.getElementById("insights-page");
      if (p) p.classList.add("hidden");
    }
  }, true);

  console.log("[Batch8] extended profile + insights ready");
})();


// ===== Batch 9 — monetization UI =====
(function () {
  "use strict";
  if (window.__batch9) return;
  window.__batch9 = true;

  function _esc(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function _sheet(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var s = document.createElement("div");
    s.id = id; s.className = "sheet-root";
    s.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(s); document.body.classList.add("sheet-open");
    requestAnimationFrame(function(){ s.classList.add("show"); });
    function close(){ s.classList.remove("show");
      setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s);
        document.body.classList.remove("sheet-open"); }, 220); }
    s.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = s.querySelector(".sheet-close"); if (x) x.addEventListener("click", close);
    return { root: s, close: close };
  }

  // ============ 87. Tip ============
  window._openTipSheet = function (username, displayName) {
    var amounts = [50, 100, 200, 500, 1000, 2000];
    var s = _sheet("b9-tip-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>💰 টিপ পাঠান</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<p style="font-size:13px;color:var(--muted);margin-bottom:12px">' +
            '<strong>@' + _esc(username) + '</strong> কে টিপ পাঠান' +
          '</p>' +
          '<input type="number" class="b9-price-input" id="b9-tip-amount" placeholder="৳ পরিমাণ" min="10" max="100000">' +
          '<div class="b9-quick-amounts">' +
            amounts.map(function(a){
              return '<button type="button" class="b9-quick-btn" data-amt="' + a + '">৳ ' + a + '</button>';
            }).join("") +
          '</div>' +
          '<textarea id="b9-tip-note" placeholder="একটি নোট (ঐচ্ছিক)" maxlength="200" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:14px;color:var(--text);outline:none;' +
            'min-height:64px;resize:vertical;margin-bottom:14px"></textarea>' +
          '<button class="btn-primary" id="b9-tip-send" style="width:100%;padding:14px;border-radius:12px">' +
            '<i class="fa-solid fa-paper-plane"></i> টিপ পাঠান' +
          '</button>' +
          '<p style="font-size:11.5px;color:var(--muted);text-align:center;margin-top:8px">' +
            '⚠️ পেমেন্ট গেটওয়ে আসছে — আপনার অনুরোধ সংরক্ষিত হয়' +
          '</p>' +
        '</div>' +
      '</div>');

    s.root.querySelectorAll(".b9-quick-btn").forEach(function(b){
      b.addEventListener("click", function(){
        var inp = s.root.querySelector("#b9-tip-amount");
        if (inp) inp.value = b.dataset.amt;
      });
    });

    s.root.querySelector("#b9-tip-send").addEventListener("click", async function(){
      var amt = parseFloat(s.root.querySelector("#b9-tip-amount").value || 0);
      var note = (s.root.querySelector("#b9-tip-note").value || "").trim();
      if (!amt || amt < 10) return alert("১০ টাকার বেশি দিন");
      this.disabled = true;
      try {
        await window.api("/api/users/" + encodeURIComponent(username) + "/tip", {
          method: "POST",
          body: JSON.stringify({ amount: amt, note: note })
        });
        s.close();
        if (typeof showToast === "function") window.showToast("💰 ৳ " + amt + " টিপ পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 88. Gift ============
  window._openGiftSheet = function (username, displayName) {
    var gifts = [
      { code: "rose",   emoji: "🌹", label: "গোলাপ" },
      { code: "heart",  emoji: "❤️", label: "হার্ট" },
      { code: "star",   emoji: "⭐", label: "স্টার" },
      { code: "cake",   emoji: "🎂", label: "কেক" },
      { code: "crown",  emoji: "👑", label: "ক্রাউন" },
      { code: "rocket", emoji: "🚀", label: "রকেট" },
      { code: "coffee", emoji: "☕", label: "কফি" },
      { code: "fire",   emoji: "🔥", label: "ফায়ার" },
      { code: "diamond", emoji: "💎", label: "ডায়মন্ড" },
    ];
    var s = _sheet("b9-gift-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>🎁 গিফট পাঠান</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="b9-grid">' +
          gifts.map(function(g){
            return '<button class="b9-gift" data-code="' + g.code + '">' +
              '<span class="b9-emoji">' + g.emoji + '</span>' +
              '<span class="b9-label">' + g.label + '</span>' +
            '</button>';
          }).join("") +
        '</div>' +
        '<div style="padding:0 16px 14px">' +
          '<textarea id="b9-gift-note" placeholder="নোট (ঐচ্ছিক)" maxlength="100" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:13.5px;color:var(--text);outline:none;' +
            'min-height:50px;resize:vertical;margin-bottom:12px"></textarea>' +
          '<button class="btn-primary" id="b9-gift-send" style="width:100%;padding:12px;border-radius:12px" disabled>' +
            'একটি গিফট বেছে নিন' +
          '</button>' +
        '</div>' +
      '</div>');

    var selected = null;
    s.root.querySelectorAll(".b9-gift").forEach(function(b){
      b.addEventListener("click", function(){
        s.root.querySelectorAll(".b9-gift").forEach(function(x){ x.classList.remove("on"); });
        b.classList.add("on");
        selected = b.dataset.code;
        var btn = s.root.querySelector("#b9-gift-send");
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> গিফট পাঠান';
      });
    });

    s.root.querySelector("#b9-gift-send").addEventListener("click", async function(){
      if (!selected) return;
      var note = (s.root.querySelector("#b9-gift-note").value || "").trim();
      this.disabled = true;
      try {
        await window.api("/api/users/" + encodeURIComponent(username) + "/gift", {
          method: "POST",
          body: JSON.stringify({ gift: selected, note: note })
        });
        s.close();
        if (typeof showToast === "function") window.showToast("🎁 গিফট পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 89. Book appointment ============
  window._openAppointmentSheet = function (username, displayName) {
    var s = _sheet("b9-appt-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>📅 অ্যাপয়েন্টমেন্ট বুক</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<p style="font-size:13px;color:var(--muted);margin-bottom:12px">' +
            '<strong>@' + _esc(username) + '</strong> এর সাথে অ্যাপয়েন্টমেন্ট' +
          '</p>' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px">তারিখ ও সময়</label>' +
          '<input type="datetime-local" id="b9-appt-when" class="b9-price-input" style="font-size:14px;font-weight:600">' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;margin-top:12px">সময়কাল (মিনিট)</label>' +
          '<select id="b9-appt-dur" class="b9-price-input" style="font-size:14px">' +
            '<option value="15">১৫ মিনিট</option>' +
            '<option value="30" selected>৩০ মিনিট</option>' +
            '<option value="60">১ ঘণ্টা</option>' +
            '<option value="120">২ ঘণ্টা</option>' +
          '</select>' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;margin-top:12px">নোট</label>' +
          '<textarea id="b9-appt-note" placeholder="কী নিয়ে আলোচনা করতে চান?" maxlength="300" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:14px;color:var(--text);outline:none;' +
            'min-height:70px;resize:vertical;margin-bottom:14px"></textarea>' +
          '<button class="btn-primary" id="b9-appt-send" style="width:100%;padding:14px;border-radius:12px">' +
            '<i class="fa-solid fa-calendar-check"></i> বুক করুন' +
          '</button>' +
        '</div>' +
      '</div>');

    s.root.querySelector("#b9-appt-send").addEventListener("click", async function(){
      var when = s.root.querySelector("#b9-appt-when").value;
      var dur = parseInt(s.root.querySelector("#b9-appt-dur").value || 30);
      var note = (s.root.querySelector("#b9-appt-note").value || "").trim();
      if (!when) return alert("তারিখ ও সময় দিন");
      this.disabled = true;
      try {
        await window.api("/api/users/" + encodeURIComponent(username) + "/appointments", {
          method: "POST",
          body: JSON.stringify({ datetime: when, duration: dur, note: note })
        });
        s.close();
        if (typeof showToast === "function") window.showToast("📅 অ্যাপয়েন্টমেন্ট বুক হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 82. Shop ============
  window._openShopSheet = async function (username, displayName, isOwn) {
    var s = _sheet("b9-shop-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>🛍️ শপ — @' + _esc(username) + '</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 14px">' +
          '<div id="b9-shop-list"><p style="text-align:center;padding:20px;color:var(--muted)">লোড হচ্ছে...</p></div>' +
          (isOwn ? '<button class="btn-secondary" id="b9-shop-add" style="width:100%;margin-top:12px"><i class="fa-solid fa-plus"></i> নতুন পণ্য যোগ করুন</button>' : '') +
        '</div>' +
      '</div>');

    async function load() {
      var list = s.root.querySelector("#b9-shop-list");
      try {
        var products = await window.api("/api/users/" + encodeURIComponent(username) + "/shop");
        if (!products.length) {
          list.innerHTML = '<p style="text-align:center;padding:30px;color:var(--muted);font-size:14px">🛍️ এখনো কোনো পণ্য নেই</p>';
          return;
        }
        list.innerHTML = '<div class="b9-shop-grid">' +
          products.map(function(p){
            var img = p.image ? '<img src="' + _esc(p.image) + '" alt="" loading="lazy" decoding="async">'
                              : '<i class="fa-solid fa-box"></i>';
            return '<div class="b9-product" data-pid="' + p.id + '" data-price="' + p.price + '">' +
              '<div class="b9-product-img">' + img + '</div>' +
              '<div class="b9-product-info">' +
                '<div class="b9-product-title">' + _esc(p.title) + '</div>' +
                '<div class="b9-product-price">৳ ' + p.price + '</div>' +
              '</div>' +
            '</div>';
          }).join("") + '</div>';
        list.querySelectorAll(".b9-product").forEach(function(cell){
          cell.addEventListener("click", async function(){
            if (isOwn) return;
            if (!confirm("এই পণ্য কিনবেন — ৳ " + cell.dataset.price + " ?")) return;
            try {
              await window.api("/api/shop/products/" + cell.dataset.pid + "/buy", { method: "POST" });
              if (typeof showToast === "function") window.showToast("✅ অর্ডার প্লেস হয়েছে");
            } catch (err) { alert(err.message || "সমস্যা"); }
          });
        });
      } catch (err) {
        list.innerHTML = '<p style="text-align:center;padding:20px;color:var(--danger)">লোড করা যায়নি</p>';
      }
    }
    await load();

    var addBtn = s.root.querySelector("#b9-shop-add");
    if (addBtn) {
      addBtn.addEventListener("click", function(){
        var title = prompt("পণ্যের নাম:");
        if (!title) return;
        var price = parseFloat(prompt("দাম (টাকা):") || "0");
        if (!price || price < 0) return alert("দাম দিন");
        window.api("/api/users/" + encodeURIComponent(username) + "/shop", {
          method: "POST",
          body: JSON.stringify({ title: title, price: price })
        }).then(function(){
          if (typeof showToast === "function") window.showToast("✅ পণ্য যোগ হয়েছে");
          load();
        }).catch(function(e){ alert(e.message); });
      });
    }
  };

  // ============ 81. Boost ============
  window._openBoostSheet = function (postId) {
    var s = _sheet("b9-boost-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>🚀 পোস্ট বুস্ট</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px">বাজেট (টাকা)</label>' +
          '<input type="number" id="b9-boost-budget" class="b9-price-input" placeholder="কমপক্ষে ৫০" min="50" max="50000">' +
          '<div class="b9-quick-amounts">' +
            [100, 250, 500, 1000, 2500].map(function(a){
              return '<button type="button" class="b9-quick-btn" data-amt="' + a + '">৳ ' + a + '</button>';
            }).join("") +
          '</div>' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;margin-top:6px">সময়কাল</label>' +
          '<select id="b9-boost-days" class="b9-price-input">' +
            '<option value="1">১ দিন</option>' +
            '<option value="3">৩ দিন</option>' +
            '<option value="7" selected>৭ দিন</option>' +
            '<option value="14">১৪ দিন</option>' +
            '<option value="30">৩০ দিন</option>' +
          '</select>' +
          '<button class="btn-primary" id="b9-boost-send" style="width:100%;padding:14px;border-radius:12px;margin-top:12px">' +
            '<i class="fa-solid fa-rocket"></i> বুস্ট শুরু' +
          '</button>' +
          '<p style="font-size:11.5px;color:var(--muted);text-align:center;margin-top:8px">' +
            '⚠️ পেমেন্ট গেটওয়ে আসছে' +
          '</p>' +
        '</div>' +
      '</div>');

    s.root.querySelectorAll(".b9-quick-btn").forEach(function(b){
      b.addEventListener("click", function(){
        var inp = s.root.querySelector("#b9-boost-budget");
        if (inp) inp.value = b.dataset.amt;
      });
    });

    s.root.querySelector("#b9-boost-send").addEventListener("click", async function(){
      var budget = parseFloat(s.root.querySelector("#b9-boost-budget").value || 0);
      var days = parseInt(s.root.querySelector("#b9-boost-days").value || 7);
      if (!budget || budget < 50) return alert("কমপক্ষে ৫০ টাকা");
      this.disabled = true;
      try {
        await window.api("/api/posts/" + postId + "/boost", {
          method: "POST",
          body: JSON.stringify({ budget: budget, days: days })
        });
        s.close();
        if (typeof showToast === "function") window.showToast("🚀 বুস্ট অনুরোধ পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ Menu items in profile ⋮ ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel || panel.dataset.b9 === "1") return;
      panel.dataset.b9 = "1";
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;
      if (isMe) return;

      var items = [
        { a: "tip",   i: "fa-money-bill-wave", l: "টিপ পাঠান" },
        { a: "gift",  i: "fa-gift",            l: "গিফট পাঠান" },
      ];
      if (data.user.is_professional) {
        items.push({ a: "shop", i: "fa-store",       l: "শপ দেখুন" });
        items.push({ a: "appt", i: "fa-calendar-check", l: "অ্যাপয়েন্টমেন্ট" });
      }

      items.forEach(function (it) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "sheet-menu-item";
        b.setAttribute("data-b9-act", it.a);
        b.innerHTML = '<i class="fa-solid ' + it.i + '"></i><span>' + it.l + '</span>';
        b.addEventListener("click", function () {
          var act = it.a;
          // close menu
          var open = document.querySelector("#profile-menu-sheet.show");
          if (open) { open.classList.remove("show");
            setTimeout(function(){ if (open.parentNode) open.parentNode.removeChild(open);
              document.body.classList.remove("sheet-open"); }, 180); }
          setTimeout(function () {
            var uname = data.user.username;
            var dname = data.user.display_name;
            if (act === "tip")   window._openTipSheet(uname, dname);
            if (act === "gift")  window._openGiftSheet(uname, dname);
            if (act === "shop")  window._openShopSheet(uname, dname, false);
            if (act === "appt")  window._openAppointmentSheet(uname, dname);
          }, 200);
        });
        panel.appendChild(b);
      });
    }, 55);
  }, true);

  // ============ Add "Boost" to own post menu ============
  var _origOpenPostMenuB9 = window.openPostMenu;
  if (typeof _origOpenPostMenuB9 === "function") {
    window.openPostMenu = function (btn, postEl, postId) {
      _origOpenPostMenuB9(btn, postEl, postId);
      setTimeout(function () {
        var menu = document.getElementById("post-menu-popup");
        if (!menu || menu.dataset.b9 === "1") return;
        menu.dataset.b9 = "1";
        var isOwn = window.state && window.state.me && btn.dataset.owner === window.state.me.username;
        if (!isOwn) return;
        var boost = document.createElement("button");
        boost.setAttribute("data-action", "boost");
        boost.innerHTML = '<i class="fa-solid fa-rocket"></i><span>বুস্ট</span>';
        var editBtn = menu.querySelector('button[data-action="edit"]');
        if (editBtn) menu.insertBefore(boost, editBtn);
        else menu.appendChild(boost);
        boost.addEventListener("click", function (ev) {
          ev.stopPropagation();
          if (typeof window.closePostMenu === "function") window.closePostMenu();
          setTimeout(function () { window._openBoostSheet(postId); }, 150);
        });
      }, 30);
    };
  }

  console.log("[Batch9] monetization UI ready");
})();


// ===== Batch 10 — subscription / verify / claim / misc =====
(function () {
  "use strict";
  if (window.__batch10) return;
  window.__batch10 = true;

  function _esc(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    return String(s||"").replace(/[<>&"']/g, function(c){
      return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function _sheet(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var s = document.createElement("div");
    s.id = id; s.className = "sheet-root";
    s.innerHTML = '<div class="sheet-backdrop"></div>' + html;
    document.body.appendChild(s); document.body.classList.add("sheet-open");
    requestAnimationFrame(function(){ s.classList.add("show"); });
    function close(){ s.classList.remove("show");
      setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s);
        document.body.classList.remove("sheet-open"); }, 220); }
    s.querySelector(".sheet-backdrop").addEventListener("click", close);
    var x = s.querySelector(".sheet-close"); if (x) x.addEventListener("click", close);
    return { root: s, close: close };
  }
  function _modal(id, html) {
    var old = document.getElementById(id); if (old) old.remove();
    var m = document.createElement("div");
    m.id = id; m.className = "modal";
    m.innerHTML = html;
    document.body.appendChild(m);
    return m;
  }

  // ============ 91. Subscribe tier sheet ============
  window._openSubscribeSheet = function (username, displayName) {
    var tiers = [
      { id: "basic",   name: "Basic",   price: 99,  icon: "fa-star",       perks: "প্রিমিয়াম পোস্ট + সাপ্তাহিক Q&A" },
      { id: "premium", name: "Premium", price: 299, icon: "fa-crown",      perks: "সব Basic + মাসিক লাইভ সেশন" },
      { id: "vip",     name: "VIP",     price: 999, icon: "fa-gem",        perks: "সব Premium + 1-on-1 ভিডিও কল" },
    ];
    var s = _sheet("b10-sub-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>⭐ সাবস্ক্রাইব — @' + _esc(username) + '</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 14px">' +
          '<div class="b10-sub-tiers">' +
            tiers.map(function(t){
              return '<button type="button" class="b10-tier" data-tier="' + t.id + '">' +
                '<span class="b10-tier-icon"><i class="fa-solid ' + t.icon + '"></i></span>' +
                '<span class="b10-tier-info">' +
                  '<span class="b10-tier-name">' + t.name + '</span>' +
                  '<span class="b10-tier-price">৳ ' + t.price + ' / মাস</span>' +
                  '<span class="b10-tier-perks">' + t.perks + '</span>' +
                '</span>' +
              '</button>';
            }).join("") +
          '</div>' +
          '<button class="btn-primary" id="b10-sub-confirm" style="width:100%;padding:14px;border-radius:12px;margin-top:14px" disabled>' +
            '<i class="fa-solid fa-check"></i> টায়ার নির্বাচন করুন' +
          '</button>' +
          '<p style="font-size:11.5px;color:var(--muted);text-align:center;margin-top:8px">' +
            '⚠️ পেমেন্ট গেটওয়ে শীঘ্রই আসছে' +
          '</p>' +
        '</div>' +
      '</div>');
    var selected = null;
    s.root.querySelectorAll(".b10-tier").forEach(function(b){
      b.addEventListener("click", function(){
        s.root.querySelectorAll(".b10-tier").forEach(function(x){ x.classList.remove("on"); });
        b.classList.add("on");
        selected = b.dataset.tier;
        var btn = s.root.querySelector("#b10-sub-confirm");
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> সাবস্ক্রাইব করুন';
      });
    });
    s.root.querySelector("#b10-sub-confirm").addEventListener("click", async function(){
      if (!selected) return;
      this.disabled = true;
      try {
        var r = await window.api("/api/users/" + encodeURIComponent(username) + "/subscribe", {
          method: "POST",
          body: JSON.stringify({ tier: selected })
        });
        s.close();
        if (typeof showToast === "function") window.showToast("⭐ " + r.tier + " টায়ারে সাবস্ক্রাইব — ৳ " + r.amount + "/মাস");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 92. Verify request ============
  window._openVerifySheet = function () {
    var s = _sheet("b10-verify-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>✓ Verified হতে আবেদন</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<p style="font-size:13px;color:var(--muted);margin-bottom:14px;line-height:1.5">' +
            'Blue check পেতে আপনার আসল পরিচয় যাচাই করা হবে। জাল তথ্য দিলে অ্যাকাউন্ট বন্ধ হতে পারে।' +
          '</p>' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px">পুরো নাম</label>' +
          '<input type="text" id="b10-vf-name" class="b9-price-input" style="font-size:14px;font-weight:600" placeholder="আসল নাম">' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;margin-top:6px">কেন verified হওয়া দরকার?</label>' +
          '<textarea id="b10-vf-reason" placeholder="যেমন: পাবলিক ফিগার, সাংবাদিক, ক্রিয়েটর..." maxlength="500" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:13.5px;color:var(--text);outline:none;' +
            'min-height:80px;resize:vertical;margin-bottom:14px"></textarea>' +
          '<button class="btn-primary" id="b10-vf-send" style="width:100%;padding:14px;border-radius:12px">' +
            '<i class="fa-solid fa-paper-plane"></i> আবেদন পাঠান' +
          '</button>' +
        '</div>' +
      '</div>');
    s.root.querySelector("#b10-vf-send").addEventListener("click", async function(){
      var name = s.root.querySelector("#b10-vf-name").value.trim();
      var reason = s.root.querySelector("#b10-vf-reason").value.trim();
      if (!name || !reason) return alert("সব তথ্য দিন");
      this.disabled = true;
      try {
        await window.api("/api/me/verify-request", {
          method: "POST",
          body: JSON.stringify({ full_name: name, reason: reason })
        });
        s.close();
        if (typeof showToast === "function") window.showToast("✅ আবেদন পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 93. Claim business ============
  window._openClaimBusiness = function () {
    var s = _sheet("b10-claim-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>🏢 Business ক্লেইম</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<p style="font-size:13px;color:var(--muted);margin-bottom:12px">' +
            'আপনি যদি এই business-এর মালিক হন, তথ্য দিয়ে ক্লেইম করুন।' +
          '</p>' +
          '<input type="text" id="b10-cl-name" class="b9-price-input" style="font-size:14px" placeholder="Business নাম">' +
          '<input type="email" id="b10-cl-email" class="b9-price-input" style="font-size:14px" placeholder="Contact email">' +
          '<textarea id="b10-cl-notes" placeholder="অতিরিক্ত তথ্য / ট্রেড লাইসেন্স নম্বর" maxlength="500" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:13.5px;color:var(--text);outline:none;' +
            'min-height:70px;resize:vertical;margin-bottom:14px"></textarea>' +
          '<button class="btn-primary" id="b10-cl-send" style="width:100%;padding:14px;border-radius:12px">' +
            '<i class="fa-solid fa-check"></i> ক্লেইম করুন' +
          '</button>' +
        '</div>' +
      '</div>');
    s.root.querySelector("#b10-cl-send").addEventListener("click", async function(){
      var name = s.root.querySelector("#b10-cl-name").value.trim();
      var email = s.root.querySelector("#b10-cl-email").value.trim();
      var notes = s.root.querySelector("#b10-cl-notes").value.trim();
      if (!name || !email) return alert("নাম ও ইমেইল দিন");
      this.disabled = true;
      try {
        await window.api("/api/me/claim-business", {
          method: "POST",
          body: JSON.stringify({ business_name: name, contact_email: email, notes: notes })
        });
        s.close();
        if (typeof showToast === "function") window.showToast("🏢 ক্লেইম অনুরোধ পাঠানো হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 94. Invite to group ============
  window._openInviteToGroup = async function (username) {
    try {
      var groups = await window.api("/api/groups");
      if (!groups.length) {
        if (typeof showToast === "function") window.showToast("আপনার কোনো গ্রুপ নেই — আগে একটি বানান");
        return;
      }
      var s = _sheet("b10-invite-sheet",
        '<div class="sheet-panel">' +
          '<div class="sheet-handle"></div>' +
          '<div class="sheet-header"><h3>👥 গ্রুপে যোগ করুন</h3>' +
          '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
          '<div class="sheet-body" style="padding:6px 12px">' +
            groups.map(function(g){
              return '<div class="b3-share-row" data-gid="' + g.id + '">' +
                '<div class="b3-share-icon" style="background:var(--gradient)">' +
                  '<i class="fa-solid fa-users"></i>' +
                '</div>' +
                '<div class="b3-share-label">' + _esc(g.name) +
                  '<div class="b3-share-sub">' + (g.member_count || 0) + ' জন সদস্য</div>' +
                '</div>' +
              '</div>';
            }).join("") +
          '</div>' +
        '</div>');
      s.root.querySelectorAll("[data-gid]").forEach(function(b){
        b.addEventListener("click", async function(){
          try {
            await window.api("/api/groups/invite-from-profile", {
              method: "POST",
              body: JSON.stringify({ group_id: parseInt(b.dataset.gid), username: username })
            });
            s.close();
            if (typeof showToast === "function") window.showToast("✅ গ্রুপে যোগ করা হয়েছে");
          } catch (err) { alert(err.message || "সমস্যা"); }
        });
      });
    } catch (err) { alert(err.message || "গ্রুপ লোড করা যায়নি"); }
  };

  // ============ 95. Send contact ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b10='send-contact']");
    if (!b) return;
    e.preventDefault();
    var data = window._currentProfileData;
    if (!data || !data.user) return;
    window.api("/api/users/" + encodeURIComponent(data.user.username) + "/send-contact", { method: "POST" })
      .then(function(){ if (typeof showToast === "function") window.showToast("📇 Contact পাঠানো হয়েছে"); })
      .catch(function(e){ alert(e.message); });
  }, true);

  // ============ 97. Suggest friend ============
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-b10='suggest']");
    if (!b) return;
    e.preventDefault();
    (async function(){
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      try {
        var friends = await window.api("/api/me/suggested-friends");
        if (!friends.length) { if (typeof showToast === "function") window.showToast("কেউ নেই"); return; }
        var s = _sheet("b10-suggest-sheet",
          '<div class="sheet-panel">' +
            '<div class="sheet-handle"></div>' +
            '<div class="sheet-header"><h3>কে suggest করবেন?</h3>' +
            '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="sheet-body" style="padding:6px 12px">' +
              friends.map(function(u){
                var av = u.profile_pic ? '<img src="' + _esc(u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
                                       : _esc((u.display_name||"?").charAt(0).toUpperCase());
                return '<div class="b3-share-row" data-to="' + _esc(u.username) + '">' +
                  '<div class="b3-share-icon bg-dm" style="overflow:hidden">' + av + '</div>' +
                  '<div class="b3-share-label">' + _esc(u.display_name) +
                    '<div class="b3-share-sub">@' + _esc(u.username) + '</div></div>' +
                '</div>';
              }).join("") +
            '</div>' +
          '</div>');
        s.root.querySelectorAll("[data-to]").forEach(function(row){
          row.addEventListener("click", async function(){
            try {
              await window.api("/api/users/" + encodeURIComponent(data.user.username) + "/suggest", {
                method: "POST",
                body: JSON.stringify({ to: row.dataset.to })
              });
              s.close();
              if (typeof showToast === "function") window.showToast("💡 Suggest পাঠানো হয়েছে");
            } catch (err) { alert(err.message || "সমস্যা"); }
          });
        });
      } catch (err) { alert(err.message || "লোড করা যায়নি"); }
    })();
  }, true);

  // ============ 98. Report a problem ============
  window._openReportProblem = function () {
    var s = _sheet("b10-rp-sheet",
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header"><h3>🐞 সমস্যা জানান</h3>' +
        '<button class="sheet-close" type="button"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="sheet-body" style="padding:10px 16px">' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px">সমস্যার ধরন</label>' +
          '<select id="b10-rp-cat" class="b9-price-input" style="font-size:14px">' +
            '<option value="bug">🐞 Bug</option>' +
            '<option value="crash">💥 ক্র্যাশ</option>' +
            '<option value="performance">🐌 ধীরগতি</option>' +
            '<option value="ui">🎨 UI/UX</option>' +
            '<option value="payment">💳 পেমেন্ট</option>' +
            '<option value="other">অন্য কিছু</option>' +
          '</select>' +
          '<label style="font-size:13px;font-weight:700;color:var(--text);display:block;margin-bottom:6px;margin-top:8px">সমস্যার বিবরণ</label>' +
          '<textarea id="b10-rp-msg" placeholder="বিস্তারিত লিখুন (কী করছিলেন, কী হয়েছিল)..." maxlength="1000" ' +
            'style="width:100%;padding:10px 12px;border-radius:12px;border:1.5px solid var(--border);' +
            'background:var(--card-2);font-family:inherit;font-size:13.5px;color:var(--text);outline:none;' +
            'min-height:110px;resize:vertical;margin-bottom:14px"></textarea>' +
          '<button class="btn-primary" id="b10-rp-send" style="width:100%;padding:14px;border-radius:12px">' +
            '<i class="fa-solid fa-paper-plane"></i> পাঠান' +
          '</button>' +
        '</div>' +
      '</div>');
    s.root.querySelector("#b10-rp-send").addEventListener("click", async function(){
      var cat = s.root.querySelector("#b10-rp-cat").value;
      var msg = s.root.querySelector("#b10-rp-msg").value.trim();
      if (msg.length < 10) return alert("কমপক্ষে ১০ অক্ষর লিখুন");
      this.disabled = true;
      try {
        await window.api("/api/me/report-problem", {
          method: "POST",
          body: JSON.stringify({ category: cat, message: msg })
        });
        s.close();
        if (typeof showToast === "function") window.showToast("✅ সমস্যা রিপোর্ট হয়েছে");
      } catch (err) { alert(err.message || "সমস্যা"); this.disabled = false; }
    });
  };

  // ============ 99. QR scan ============
  window._openQrScan = function () {
    var overlay = document.createElement("div");
    overlay.className = "b10-qr-overlay";
    overlay.innerHTML =
      '<div style="font-size:44px">📷</div>' +
      '<div class="b10-qr-hint">JUKTOY QR কোড স্ক্যান করুন</div>' +
      '<video id="b10-qr-video" playsinline></video>' +
      '<div class="b10-qr-actions">' +
        '<button id="b10-qr-cancel">বাতিল</button>' +
      '</div>';
    document.body.appendChild(overlay);

    var stream = null;
    (async function(){
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        var v = document.getElementById("b10-qr-video");
        if (v) { v.srcObject = stream; v.play().catch(function(){}); }
      } catch (e) {
        var hint = overlay.querySelector(".b10-qr-hint");
        if (hint) hint.textContent = "ক্যামেরা চালু করা যায়নি — অনুমতি দিন";
      }
    })();

    function close() {
      if (stream) stream.getTracks().forEach(function(t){ try{t.stop();}catch(e){} });
      overlay.remove();
    }
    document.getElementById("b10-qr-cancel").addEventListener("click", close);
  };

  // ============ Wire into profile ⋮ menu ============
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#profile-menu-btn")) return;
    setTimeout(function () {
      var panel = document.querySelector("#profile-menu-sheet .sheet-menu-list");
      if (!panel || panel.dataset.b10 === "1") return;
      panel.dataset.b10 = "1";
      var data = window._currentProfileData;
      if (!data || !data.user) return;
      var isMe = window.state && window.state.me && window.state.me.username === data.user.username;

      if (isMe) {
        // own profile additions
        var items = [
          { a: "verify", i: "fa-circle-check",  l: "✓ Verified হতে আবেদন" },
          { a: "claim",  i: "fa-building",       l: "🏢 Business ক্লেইম" },
          { a: "report-problem", i: "fa-bug",    l: "🐞 সমস্যা জানান" },
          { a: "qr-scan",        i: "fa-qrcode", l: "📷 QR স্ক্যান" },
        ];
        items.forEach(function (it) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "sheet-menu-item";
          b.innerHTML = '<i class="fa-solid ' + it.i + '"></i><span>' + it.l + '</span>';
          b.addEventListener("click", function () {
            var open = document.querySelector("#profile-menu-sheet.show");
            if (open) { open.classList.remove("show");
              setTimeout(function(){ if (open.parentNode) open.parentNode.removeChild(open);
                document.body.classList.remove("sheet-open"); }, 180); }
            setTimeout(function () {
              if (it.a === "verify")         window._openVerifySheet();
              if (it.a === "claim")          window._openClaimBusiness();
              if (it.a === "report-problem") window._openReportProblem();
              if (it.a === "qr-scan")        window._openQrScan();
            }, 200);
          });
          panel.appendChild(b);
        });
      } else {
        // other's profile additions
        var items2 = [
          { a: "subscribe", i: "fa-star",           l: "⭐ সাবস্ক্রাইব" },
          { a: "invite",    i: "fa-user-plus",      l: "👥 গ্রুপে যোগ" },
          { a: "send-contact", i: "fa-address-card", l: "📇 Contact পাঠান" },
          { a: "suggest",   i: "fa-lightbulb",      l: "💡 Suggest a friend" },
        ];
        items2.forEach(function (it) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "sheet-menu-item";
          b.setAttribute("data-b10", it.a);
          b.innerHTML = '<i class="fa-solid ' + it.i + '"></i><span>' + it.l + '</span>';
          b.addEventListener("click", function () {
            var open = document.querySelector("#profile-menu-sheet.show");
            if (open) { open.classList.remove("show");
              setTimeout(function(){ if (open.parentNode) open.parentNode.removeChild(open);
                document.body.classList.remove("sheet-open"); }, 180); }
            setTimeout(function () {
              var u = data.user.username;
              var d = data.user.display_name;
              if (it.a === "subscribe")   window._openSubscribeSheet(u, d);
              if (it.a === "invite")      window._openInviteToGroup(u);
              if (it.a === "send-contact") {
                window.api("/api/users/" + encodeURIComponent(u) + "/send-contact", { method: "POST" })
                  .then(function(){ if (typeof showToast === "function") window.showToast("📇 Contact পাঠানো হয়েছে"); })
                  .catch(function(e){ alert(e.message); });
              }
              if (it.a === "suggest") {
                var tmp = document.createElement("button");
                tmp.setAttribute("data-b10", "suggest");
                tmp.style.display = "none";
                document.body.appendChild(tmp);
                tmp.click();
                tmp.remove();
              }
            }, 200);
          });
          panel.appendChild(b);
        });
      }
    }, 60);
  }, true);

  console.log("[Batch10] subscription / verify / claim / misc ready");
})();
