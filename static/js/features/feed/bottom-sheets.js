// S32 — Post interactions via bottom sheets
(function () {
  "use strict";
  if (window.__s32Sheets) return;
  window.__s32Sheets = true;

  function _closeAllSheets() {
    document.querySelectorAll(".sheet-root").forEach(function (el) {
      el.classList.remove("show");
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    });
    document.body.classList.remove("sheet-open");
    // also close old floating menus if present
    try { if (typeof window.closePostMenu === "function") window.closePostMenu(); } catch (e) {}
    try { if (typeof window._closeRepostMenu === "function") window._closeRepostMenu(); } catch (e) {}
  }

  // ---------- Comment Sheet ----------
  window._openCommentSheet = async function (postId) {
    if (!postId) return;
    _closeAllSheets();

    var sheet = document.createElement("div");
    sheet.id = "comment-sheet";
    sheet.className = "sheet-root";
    sheet.innerHTML =
      '<div class="sheet-backdrop"></div>' +
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header">' +
          '<h3>মন্তব্য</h3>' +
          '<button class="sheet-close" type="button" aria-label="close">' +
            '<i class="fa-solid fa-xmark"></i>' +
          '</button>' +
        '</div>' +
        '<div class="sheet-body" id="cs-body">' +
          '<p style="text-align:center;padding:30px 20px;color:var(--muted)">লোড হচ্ছে...</p>' +
        '</div>' +
        '<form class="sheet-form" id="cs-form">' +
          '<input type="text" id="cs-input" placeholder="মন্তব্য লিখুন..." maxlength="2000" autocomplete="off">' +
          '<button type="submit" class="sheet-send"><i class="fa-solid fa-paper-plane"></i></button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });

    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 260);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
    sheet.querySelector(".sheet-close").addEventListener("click", close);

    var body = sheet.querySelector("#cs-body");

    // S32.1 — use shared reload helper (keeps bindCommentEvents consistent)
    await _reloadSheetComments(postId);

    var form = sheet.querySelector("#cs-form");
    var input = sheet.querySelector("#cs-input");
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var text = (input.value || "").trim();
      if (!text) return;
      var sendBtn = form.querySelector(".sheet-send");
      sendBtn.disabled = true;
      try {
        await window.api("/api/posts/" + postId + "/comments", {
          method: "POST",
          body: JSON.stringify({ content: text }),
        });
        input.value = "";
        await _reloadSheetComments(postId);
        // update count on underlying post card
        var postEl = document.querySelector('.post[data-id="' + postId + '"]');
        if (postEl) {
          var cc = postEl.querySelector(".comment-btn .comment-count");
          if (cc) cc.textContent = parseInt(cc.textContent || "0", 10) + 1;
        }
      } catch (err) {
        alert(err.message || "মন্তব্য পাঠানো যায়নি");
      } finally {
        sendBtn.disabled = false;
        try { input.focus(); } catch (e) {}
      }
    });

    setTimeout(function () { try { input.focus(); } catch (e) {} }, 320);
  };

  // ---------- Post Menu Sheet ----------
  window._openPostMenuSheet = function (btn, postEl, postId) {
    if (!btn || !postId) return;
    _closeAllSheets();

    var isOwn = window.state.me && btn.dataset.owner === window.state.me.username;
    var isSaved = btn.dataset.saved === "1";
    var isReposted = btn.dataset.reposted === "1";

    var items = [];
    if (!isOwn) {
      items.push({ a: "repost", i: "fa-retweet", l: isReposted ? "রিপোস্ট সরান" : "রিপোস্ট" });
      items.push({ a: "quote", i: "fa-quote-right", l: "কোট পোস্ট" });
    }
    items.push({ a: "save", i: isSaved ? "fa-solid fa-bookmark" : "fa-regular fa-bookmark", l: isSaved ? "সেভ সরান" : "সেভ" });
    items.push({ a: "share", i: "fa-share-nodes", l: "শেয়ার" });
    items.push({ a: "copy", i: "fa-link", l: "লিংক কপি" });
    if (isOwn) {
      items.push({ a: "edit", i: "fa-pen", l: "এডিট" });
      items.push({ a: "delete", i: "fa-trash-can", l: "ডিলিট", d: true });
    } else {
      items.push({ a: "report", i: "fa-flag", l: "রিপোর্ট", d: true });
    }

    var sheet = document.createElement("div");
    sheet.id = "post-menu-sheet";
    sheet.className = "sheet-root";
    sheet.innerHTML =
      '<div class="sheet-backdrop"></div>' +
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-menu-list">' +
          items.map(function (it) {
            return '<button type="button" class="sheet-menu-item' + (it.d ? " danger" : "") + '" data-action="' + it.a + '">' +
              '<i class="fa-solid ' + it.i + '"></i>' +
              '<span>' + it.l + '</span>' +
            '</button>';
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
      }, 260);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);

    sheet.querySelectorAll(".sheet-menu-item").forEach(function (b) {
      b.addEventListener("click", function () {
        var action = b.dataset.action;
        close();
        setTimeout(function () {
          try {
            if (typeof window.handlePostMenuAction === "function") {
              window.handlePostMenuAction(action, btn, postEl, postId);
            }
          } catch (e) { console.error("[S32] menu action failed:", e); }
        }, 60);
      });
    });
  };

  // ---------- Override: post content click → comment sheet ----------
  window.openPostDetail = function (postId) {
    if (typeof window._openCommentSheet === "function") {
      window._openCommentSheet(postId);
    }
  };

  // ---------- Override: 3-dot → menu sheet ----------
  window.openPostMenu = function (btn, postEl, postId) {
    if (typeof window._openPostMenuSheet === "function") {
      window._openPostMenuSheet(btn, postEl, postId);
    }
  };

  // ---------- Override: comment-btn (capture) → comment sheet ----------
  document.addEventListener("click", function (e) {
    var cb = e.target.closest(".comment-btn");
    if (!cb) return;
    // skip if inside sheet already
    if (e.target.closest(".sheet-root")) return;
    e.stopPropagation();
    e.preventDefault();
    var post = cb.closest(".post");
    if (post && post.dataset.id) {
      window._openCommentSheet(post.dataset.id);
    }
  }, true);

  // S32.6 — post content wrap + time click → comment sheet
  document.addEventListener("click", function (e) {
    if (e.target.closest(".sheet-root")) return;
    if (e.target.closest("button, a, input, textarea")) return;
    if (e.target.closest(".post-actions")) return;
    if (e.target.closest(".post-menu-btn")) return;
    if (e.target.closest(".post-header .avatar")) return;
    if (e.target.closest(".post-meta .name")) return;
    if (e.target.closest(".hashtag-link")) return;
    if (e.target.closest(".quoted-post")) return;

    var wrap = e.target.closest(".post-content-wrap");
    var time = e.target.closest(".post-meta .time");
    if (!wrap && !time) return;

    var post = e.target.closest(".post");
    if (!post || !post.dataset.id) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof window._openCommentSheet === "function") {
      window._openCommentSheet(post.dataset.id);
    }
  }, true);

  // ---------- Esc closes sheet ----------
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var any = document.querySelector(".sheet-root.show");
      if (any) {
        any.classList.remove("show");
        setTimeout(function () {
          if (any.parentNode) any.parentNode.removeChild(any);
          document.body.classList.remove("sheet-open");
        }, 260);
      }
    }
  });

  console.log("[S32] bottom-sheet interactions ready");
})();

// S32.1 — Comment sheet helpers
async function _reloadSheetComments(postId) {
  var body = document.getElementById("cs-body");
  if (!body || !postId) return;
  _cmtSerial = 0;   // S32.2 — reset serial for sheet render
  body.innerHTML = '<p style="text-align:center;padding:20px;color:var(--muted)">লোড হচ্ছে...</p>';
  try {
    var comments = await window.api("/api/posts/" + postId + "/comments");
    if (window._s323CacheComments) window._s323CacheComments(postId, comments);
    if (!comments || !comments.length) {
      body.innerHTML = '<p style="text-align:center;padding:36px 20px;color:var(--muted);font-size:14px">এখনো কোনো মন্তব্য নেই।<br>প্রথম মন্তব্য আপনিই করুন!</p>';
      return;
    }
    body.innerHTML = comments.map(function (c) { return commentHTML(c, postId); }).join("");
    try { bindCommentEvents(body, postId); } catch (e) { console.error("[S32.1]", e); }
  } catch (err) {
    body.innerHTML = '<p style="text-align:center;padding:20px;color:var(--danger)">লোড করা যায়নি</p>';
  }
}
window._reloadSheetComments = _reloadSheetComments;


// S32.3 — Reply sheet (view all replies, flat + serial)
(function () {
  "use strict";
  if (window.__s323ReplySheet) return;
  window.__s323ReplySheet = true;

  var _cachedComments = {};   // postId → comments array (for instant lookup)

  // cache comments whenever loaded
  var _origReload = window._reloadSheetComments;
  // expose cache setter for existing loaders
  window._s323CacheComments = function (postId, comments) {
    if (!postId || !Array.isArray(comments)) return;
    _cachedComments[postId] = comments;
  };

  // ---- find flat reply set for a parent comment id ----
  function _findParentAndReplies(postId, parentCid) {
    var all = _cachedComments[postId] || [];
    var parent = null;
    for (var i = 0; i < all.length; i++) {
      if (String(all[i].id) === String(parentCid)) { parent = all[i]; break; }
    }
    if (!parent) return null;
    var replies = parent.replies || [];
    return { parent: parent, replies: replies };
  }

  // ---- open reply sheet ----
  window._openRepliesSheet = async function (parentCid, postId) {
    var prev = document.querySelector(".sheet-root");
    if (prev) prev.remove();

    var sheet = document.createElement("div");
    sheet.id = "replies-sheet";
    sheet.className = "sheet-root";
    sheet.innerHTML =
      '<div class="sheet-backdrop"></div>' +
      '<div class="sheet-panel">' +
        '<div class="sheet-handle"></div>' +
        '<div class="sheet-header">' +
          '<h3>উত্তর</h3>' +
          '<button class="sheet-close" type="button">' +
            '<i class="fa-solid fa-xmark"></i>' +
          '</button>' +
        '</div>' +
        '<div class="sheet-body" id="rs-body">' +
          '<p style="text-align:center;padding:30px 20px;color:var(--muted)">লোড হচ্ছে...</p>' +
        '</div>' +
        '<form class="sheet-form" id="rs-form">' +
          '<input type="text" id="rs-input" placeholder="উত্তর লিখুন..." maxlength="2000" autocomplete="off">' +
          '<button type="submit" class="sheet-send"><i class="fa-solid fa-paper-plane"></i></button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(sheet);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(function () { sheet.classList.add("show"); });

    function close() {
      sheet.classList.remove("show");
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        document.body.classList.remove("sheet-open");
      }, 260);
    }
    sheet.querySelector(".sheet-backdrop").addEventListener("click", close);
    sheet.querySelector(".sheet-close").addEventListener("click", close);

    var bodyEl = sheet.querySelector("#rs-body");
    var formEl = sheet.querySelector("#rs-form");
    var inputEl = sheet.querySelector("#rs-input");

    async function render() {
      // Fetch fresh comments
      var comments;
      try {
        comments = await window.api("/api/posts/" + postId + "/comments");
      } catch (err) {
        bodyEl.innerHTML = '<p style="text-align:center;padding:20px;color:var(--danger)">লোড করা যায়নি</p>';
        return;
      }
      _cachedComments[postId] = comments;

      var data = _findParentAndReplies(postId, parentCid);
      if (!data) {
        bodyEl.innerHTML = '<p style="text-align:center;padding:20px;color:var(--muted)">উত্তর খুঁজে পাওয়া যায়নি</p>';
        return;
      }

      // Parent comment index (1-based) in original list
      var parentIdx = comments.findIndex(function (c) { return String(c.id) === String(parentCid); });
      var parentSerial = parentIdx >= 0 ? parentIdx + 1 : 1;

      // Build flat list: parent + replies, serials continue
      _cmtSerial = parentSerial - 1;   // so next commentHTML gives parentSerial

      var parentHTML = commentHTML(data.parent, postId, false);
      var repliesHTML = (data.replies || []).map(function (r) {
        return commentHTML(r, postId, true);
      }).join("");

      bodyEl.innerHTML =
        '<div class="replies-thread flat">' +
          parentHTML +
          (repliesHTML ? '<div class="replies-flat-list">' + repliesHTML + '</div>' : '') +
        '</div>';

      try { bindCommentEvents(bodyEl, postId); } catch (e) {}

      // Prefill @mention in reply form (optional — user can delete)
      if (data.parent && data.parent.display_name) {
        var tag = "@" + data.parent.display_name + " ";
        inputEl.value = tag;
        setTimeout(function () {
          try { inputEl.focus(); } catch (e) {}
          try { inputEl.setSelectionRange(tag.length, tag.length); } catch (e) {}
        }, 200);
      }
    }

    formEl.addEventListener("submit", async function (e) {
      e.preventDefault();
      var text = (inputEl.value || "").trim();
      if (!text) return;
      var sendBtn = formEl.querySelector(".sheet-send");
      sendBtn.disabled = true;
      try {
        await window.api("/api/posts/" + postId + "/comments", {
          method: "POST",
          body: JSON.stringify({ content: text, parent_id: parseInt(parentCid) }),
        });
        inputEl.value = "@" + (window._rsParentName || "") + " ";
        await render();
        // refresh underlying comment sheet / post
        try { if (window._reloadSheetComments) await window._reloadSheetComments(postId); } catch (e) {}
      } catch (err) {
        alert(err.message || "উত্তর পাঠানো যায়নি");
      } finally {
        sendBtn.disabled = false;
      }
    });

    await render();
    // save parent name for post-send prefill
    var _p = _findParentAndReplies(postId, parentCid);
    if (_p && _p.parent) window._rsParentName = _p.parent.display_name || "";
  };

  // ---- click delegation for view-replies-btn ----
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".view-replies-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    var parentCid = btn.dataset.parent;
    var postId = btn.dataset.post;
    if (parentCid && postId) {
      window._openRepliesSheet(parentCid, postId);
    }
  }, true);

  console.log("[S32.3] reply sheet ready");
})();


// S32.4 — mention click + comment name click
(function () {
  "use strict";
  if (window.__s324Clicks) return;
  window.__s324Clicks = true;

  document.addEventListener("click", function (e) {
    // mention link
    var m = e.target.closest(".mention[data-mention]");
    if (m) {
      e.preventDefault();
      e.stopPropagation();
      var u = m.dataset.mention;
      if (u) {
        try {
          // close any open sheet first
          document.querySelectorAll(".sheet-root.show").forEach(function (s) {
            s.classList.remove("show");
            setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 220);
          });
          document.body.classList.remove("sheet-open");
        } catch (err) {}
        if (typeof window.openProfile === "function") {
          setTimeout(function () { window.openProfile(u); }, 200);
        }
      }
      return;
    }

    // comment cname click
    var cn = e.target.closest(".cname[data-user]");
    if (cn) {
      e.preventDefault();
      e.stopPropagation();
      var uname = cn.dataset.user;
      if (uname) {
        try {
          document.querySelectorAll(".sheet-root.show").forEach(function (s) {
            s.classList.remove("show");
            setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 220);
          });
          document.body.classList.remove("sheet-open");
        } catch (err) {}
        if (typeof window.openProfile === "function") {
          setTimeout(function () { window.openProfile(uname); }, 200);
        }
      }
      return;
    }
  }, true);

  console.log("[S32.4] mention + name click ready");
})();


// S32.5 — @mention autocomplete on any input/textarea
(function () {
  "use strict";
  if (window.__s325Mention) return;
  window.__s325Mention = true;

  var _dd = null;
  var _activeInput = null;
  var _activeAtPos = -1;
  var _userCache = null;
  var _userCacheAt = 0;

  function _destroyDD() {
    if (_dd && _dd.parentNode) _dd.parentNode.removeChild(_dd);
    _dd = null;
    _activeAtPos = -1;
  }

  async function _getUsers() {
    var now = Date.now();
    if (_userCache && (now - _userCacheAt) < 60000) return _userCache;
    try {
      var list = await window.api("/api/users?q=");
      _userCache = Array.isArray(list) ? list : [];
      _userCacheAt = now;
      return _userCache;
    } catch (e) {
      return [];
    }
  }

  function _posOfCaret(el) {
    var pos;
    if (el.selectionStart != null) pos = el.selectionStart;
    else pos = (el.value || "").length;
    return pos;
  }

  function _currentMentionQuery(el) {
    // find last @ before caret that has no whitespace in between
    var val = el.value || "";
    var caret = _posOfCaret(el);
    var before = val.slice(0, caret);
    var at = before.lastIndexOf("@");
    if (at === -1) return null;
    // char before @ must be start or whitespace
    if (at > 0) {
      var prev = before.charAt(at - 1);
      if (!/\s|\(|\[/.test(prev)) return null;
    }
    var frag = before.slice(at + 1);
    // must not contain whitespace after @
    if (/\s/.test(frag)) return null;
    // length limit
    if (frag.length > 30) return null;
    return { at: at, query: frag.toLowerCase() };
  }

  function _posOfInput(el) {
    // approximate caret pos on screen
    var rect = el.getBoundingClientRect();
    return { left: rect.left, top: rect.bottom + 4, width: rect.width };
  }

  async function _showMentions(el, query) {
    var users = await _getUsers();
    // filter
    var q = (query || "").toLowerCase();
    var filtered = users.filter(function (u) {
      if (!u || !u.username) return false;
      var uname = (u.username || "").toLowerCase();
      var dname = (u.display_name || "").toLowerCase();
      if (!q) return true;
      return uname.indexOf(q) === 0 || dname.indexOf(q) === 0;
    }).slice(0, 8);

    _destroyDD();
    if (!filtered.length) return;

    _activeInput = el;

    _dd = document.createElement("div");
    _dd.className = "mention-dropdown";
    _dd.innerHTML = filtered.map(function (u, i) {
      var av = u.profile_pic
        ? '<img src="' + window.escapeHtml(u.profile_pic) + '" alt="" loading="lazy" decoding="async">'
        : (u.display_name || u.username || "?").charAt(0).toUpperCase();
      return '<div class="mention-item' + (i === 0 ? " active" : "") + '" data-username="' + window.escapeHtml(u.username) + '">' +
        '<div class="mention-item-avatar">' + av + '</div>' +
        '<div class="mention-item-info">' +
          '<div class="mention-item-name">' + window.escapeHtml(u.display_name || u.username) + '</div>' +
          '<div class="mention-item-username">@' + window.escapeHtml(u.username) + '</div>' +
        '</div>' +
      '</div>';
    }).join("");
    document.body.appendChild(_dd);

    // S32.6 — prevent click-outside from firing during scroll/touch inside dropdown
    _dd.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    _dd.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });
    _dd.addEventListener("touchmove", function (e) { e.stopPropagation(); }, { passive: true });

    // position
    var pos = _posOfInput(el);
    var ddRect = _dd.getBoundingClientRect();
    var left = pos.left;
    if (left + ddRect.width > window.innerWidth - 10) {
      left = window.innerWidth - ddRect.width - 10;
    }
    if (left < 10) left = 10;
    var top = pos.top;
    if (top + ddRect.height > window.innerHeight - 10) {
      top = pos.top - ddRect.height - el.offsetHeight - 8;
    }
    _dd.style.left = left + "px";
    _dd.style.top = top + "px";

    // click handling
    _dd.querySelectorAll(".mention-item").forEach(function (it) {
      it.addEventListener("mousedown", function (e) {
        e.preventDefault();
        _insertMention(el, it.dataset.username);
      });
      it.addEventListener("touchstart", function (e) {
        e.preventDefault();
        _insertMention(el, it.dataset.username);
      }, { passive: false });
    });
  }

  function _insertMention(el, username) {
    if (!el || !username) return;
    var info = _currentMentionQuery(el);
    if (!info) { _destroyDD(); return; }
    var val = el.value || "";
    var caret = _posOfCaret(el);
    var before = val.slice(0, info.at);
    var after = val.slice(caret);
    var insert = "@" + username + " ";
    el.value = before + insert + after;
    var newPos = info.at + insert.length;
    try { el.selectionStart = el.selectionEnd = newPos; } catch (e) {}
    _destroyDD();
    try { el.focus(); } catch (e) {}
    // trigger input event so state updates (post btn etc)
    try {
      var ev = new Event("input", { bubbles: true });
      el.dispatchEvent(ev);
    } catch (e) {}
  }

  // ---- Event binding ----
  function _isMentionable(el) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      var t = (el.type || "").toLowerCase();
      return t === "text" || t === "search" || t === "";
    }
    return false;
  }

  document.addEventListener("input", function (e) {
    var el = e.target;
    if (!_isMentionable(el)) return;
    var info = _currentMentionQuery(el);
    if (info === null) { _destroyDD(); return; }
    _showMentions(el, info.query);
  }, true);

  document.addEventListener("keydown", function (e) {
    if (!_dd) return;
    if (e.key === "Escape") {
      _destroyDD();
      e.stopPropagation();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      var items = _dd.querySelectorAll(".mention-item");
      if (!items.length) return;
      var cur = Array.prototype.indexOf.call(items, _dd.querySelector(".mention-item.active"));
      var next = e.key === "ArrowDown" ? (cur + 1) : (cur - 1);
      if (next < 0) next = items.length - 1;
      if (next >= items.length) next = 0;
      items.forEach(function (it, i) { it.classList.toggle("active", i === next); });
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      var active = _dd.querySelector(".mention-item.active");
      if (active) {
        e.preventDefault();
        e.stopPropagation();
        _insertMention(_activeInput, active.dataset.username);
      }
    }
  }, true);

  document.addEventListener("click", function (e) {
    if (_dd && !e.target.closest(".mention-dropdown")) _destroyDD();
  }, true);

  document.addEventListener("focusout", function (e) {
    if (e.target === _activeInput) {
      // S32.6 — delay longer so touch scroll doesn't kill it prematurely
      setTimeout(function () {
        // if user is touching dropdown, don't destroy
        if (_dd && _dd.matches(":active, :hover")) return;
        _destroyDD();
      }, 400);
    }
  }, true);

  console.log("[S32.5] mention autocomplete ready");
})();

