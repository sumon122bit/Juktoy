// ==================================================
// MESSAGING SYSTEM
// ==================================================

const messagesPage = document.getElementById("messages-page");
const convItems = document.getElementById("conv-items");

async function loadConversations() {
  if (!convItems) return;
  try {
    const convs = await api("/api/conversations");
    renderConversations(convs);
  } catch (err) {
    console.error("[CONV]", err);
    convItems.innerHTML = '<div class="conv-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>লোড করা যায়নি</p></div>';
  }
}

function renderConversations(convs) {
  if (!Array.isArray(convs) || !convs.length) {
    convItems.innerHTML =
      '<div class="conv-empty">' +
        '<i class="fa-regular fa-comment-dots"></i>' +
        '<p>এখনো কোনো চ্যাট নেই।<br>উপরের ✍️ বাটনে চাপ দিয়ে শুরু করুন।</p>' +
      '</div>';
    return;
  }

  convItems.innerHTML = convs.map(function (c) {
    var isMine = state.me && c.last_sender === state.me.id;
    var isMuted = !!c.is_muted;
    var isPinned = !!c.is_pinned;
    var unread = c.unread || 0;

    // Real online status from user.last_seen (not message time)
    var onlineDot = "";
    if (typeof c.other_secs === "number" && c.other_secs >= 0 && c.other_secs < 300) {
      onlineDot = '<span class="conv-online-dot"></span>';
    }

    var lastHtml = "";
    if (unread > 0) {
      lastHtml = '<div class="conv-last conv-last-unread"><strong>' + unread + 'টি নতুন মেসেজ</strong></div>';
    } else if (isMine) {
      lastHtml = '<div class="conv-last mine">' + escapeHtml(c.last_message) + '</div>';
    } else {
      lastHtml = '<div class="conv-last">' + escapeHtml(c.last_message) + '</div>';
    }

    var blueDot = (unread > 0 && !isMuted)
      ? '<span class="conv-unread-dot"></span>'
      : "";

    var nameIcons = "";
    if (isPinned) nameIcons += '<span class="conv-icn pin"><i class="fa-solid fa-thumbtack"></i></span>';
    if (isMuted) nameIcons += '<span class="conv-icn mute"><i class="fa-solid fa-bell-slash"></i></span>';

    var classes = ["conv-item"];
    if (isPinned) classes.push("pinned");
    if (isMuted) classes.push("muted");
    if (unread > 0) classes.push("has-unread");

    var _listName = (c.nickname && c.nickname.trim()) ? c.nickname : c.display_name;

    return (
      '<div class="' + classes.join(" ") + '" data-username="' + escapeHtml(c.username) + '">' +
        '<div class="conv-avatar">' +
          avatarInner(_listName, c.profile_pic) +
          onlineDot +
        '</div>' +
        '<div class="conv-info">' +
          '<div class="conv-name">' +
            escapeHtml(_listName) +
            nameIcons +
          '</div>' +
          lastHtml +
        '</div>' +
        '<div class="conv-meta">' +
          '<span class="conv-time">' + shortTime(c.last_time) + '</span>' +
          blueDot +
        '</div>' +
      '</div>'
    );
  }).join("");

  convItems.querySelectorAll(".conv-item").forEach(function (el) {
    el.addEventListener("click", function () { openChat(el.dataset.username); });
  });
}

const chatWindow = document.getElementById("chat-window");
const chatMessages = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatUserInfo = document.getElementById("chat-user-info");
const newChatModal = document.getElementById("new-chat-modal");

let currentChatUser = null;
let chatPollTimer = null;
let lastMsgCount = 0;

// S29.5 - chat settings cache.
// These values (theme/nickname/wallpaper/pinned/muted) only change when
// the user taps a menu action. Previously loadChatMessages() re-fetched
// them every 3 seconds. Now: fetch once per chat-open (or after a write),
// then read from cache. In-flight dedupe prevents duplicate fetches.
let _chatSettingsCache = {};
let _chatSettingsInflight = {};

function _invalidateChatSettings(username) {
  if (!username) return;
  delete _chatSettingsCache[username];
  delete _chatSettingsInflight[username];
}

function _getChatSettings(username) {
  if (!username) return Promise.resolve(null);
  if (_chatSettingsCache[username]) {
    return Promise.resolve(_chatSettingsCache[username]);
  }
  if (_chatSettingsInflight[username]) {
    return _chatSettingsInflight[username];
  }
  var p = api("/api/chats/" + encodeURIComponent(username) + "/settings")
    .then(function (st) {
      _chatSettingsCache[username] = st || {};
      delete _chatSettingsInflight[username];
      return _chatSettingsCache[username];
    })
    .catch(function () {
      delete _chatSettingsInflight[username];
      return {};
    });
  _chatSettingsInflight[username] = p;
  return p;
}

async function openMessagesPage() {
  if (!messagesPage) return;
  messagesPage.classList.remove("hidden");
  chatWindow.classList.add("hidden");
  document.body.classList.remove("messages-chat-open");
  currentChatUser = null;
  _refreshMsgTitleBadge();
  _loadMsgStoryRow();
  await loadConversations();
}

// ---------- Horizontal contacts / story row ----------
async function _refreshMsgTitleBadge() {
  try {
    const data = await api("/api/messages/unread/count");
    const n = data.count || 0;
    const el = document.getElementById("msg-title-badge");
    if (!el) return;
    if (n > 0) {
      el.textContent = n > 99 ? "99+" : String(n);
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  } catch (e) {}
}

async function _loadMsgStoryRow() {
  var row = document.getElementById("msg-stories-row");
  if (!row) return;
  row.innerHTML = '<div class="msg-story-skel"></div>'.repeat(6);

  // Refresh story groups so tap opens correct viewer
  if (typeof loadStories === "function") {
    try { await loadStories(); } catch (e) {}
  }

  try {
    var res = await api("/api/messages/online-contacts");
    var contacts = (res && res.contacts) ? res.contacts : (Array.isArray(res) ? res : []);
    var me = (res && res.me) ? res.me : null;

    var html = "";

    // ==== Self tile — "Your story" if exists, else "Add story" ====
    if (me) {
      var myAv = me.profile_pic
        ? '<img src="' + escapeHtml(me.profile_pic) + '" alt="" loading="lazy" decoding="async">'
        : initial(me.display_name || "?");
      var hasMyStory = (me.story_count || 0) > 0;

      html +=
        '<div class="msg-story-item msg-story-self" data-act="self" data-story="' + (hasMyStory ? "1" : "0") + '">' +
          '<div class="msg-story-av-wrap ' + (hasMyStory ? "has-story" : "") + '">' +
            '<div class="msg-story-av">' + myAv + '</div>' +
            (hasMyStory
              ? '<span class="msg-story-eye"><i class="fa-regular fa-eye"></i></span>'
              : '<div class="msg-story-plus"><i class="fa-solid fa-plus"></i></div>') +
          '</div>' +
          '<div class="msg-story-name">' +
            (hasMyStory ? "আপনার স্টোরি" : "স্টোরি দিন") +
          '</div>' +
        '</div>';
    }

    // ==== Others ====
    if (!contacts.length) {
      html += '<div class="msg-story-empty">কেউ এখনো আসেনি</div>';
    } else {
      contacts.forEach(function (c) {
        var secs = c.secs || 0;
        var isOnline = secs < 300;
        var av = c.profile_pic
          ? '<img src="' + escapeHtml(c.profile_pic) + '" alt="" loading="lazy" decoding="async">'
          : initial(c.display_name);
        var hasStory = (c.story_count || 0) > 0;
        var hasUnreadStory = (c.unread_story || 0) > 0;

        var ringClass = "";
        if (hasUnreadStory) ringClass = "has-unread";
        else if (hasStory) ringClass = "has-story";

        html +=
          '<div class="msg-story-item" data-user="' + escapeHtml(c.username) + '" data-story="' + (hasStory ? "1" : "0") + '">' +
            '<div class="msg-story-av-wrap ' + ringClass + '">' +
              '<div class="msg-story-av">' + av + '</div>' +
              (isOnline ? '<span class="online-dot"></span>' : '') +
            '</div>' +
            '<div class="msg-story-name">' +
              escapeHtml((c.display_name || "").split(" ")[0]) +
            '</div>' +
          '</div>';
      });
    }

    row.innerHTML = html;

    // Wire actions
    row.querySelectorAll(".msg-story-item").forEach(function (el) {
      el.addEventListener("click", function () {
        var act = el.dataset.act;
        var u = el.dataset.user;
        var hasStory = el.dataset.story === "1";

        // Self tile
        if (act === "self") {
          if (hasStory) {
            // Open own story viewer
            if (typeof storyGroups !== "undefined" && state.me) {
              var myIdx = -1;
              for (var i = 0; i < storyGroups.length; i++) {
                if (storyGroups[i].user && storyGroups[i].user.username === state.me.username) {
                  myIdx = i; break;
                }
              }
              if (myIdx !== -1 && typeof openStoryViewer === "function") {
                openStoryViewer(myIdx, 0);
                return;
              }
            }
          }
          // No story → open upload
          if (typeof resetStoryUpload === "function") resetStoryUpload();
          var m = document.getElementById("story-upload-modal");
          if (m) m.classList.remove("hidden");
          return;
        }

        if (!u) return;

        if (hasStory && typeof openStoryForUser === "function") {
          var ok = openStoryForUser(u);
          if (ok) return;
        }
        openChat(u);
      });
    });
  } catch (err) {
    console.error("[STORY ROW]", err);
    row.innerHTML = "";
  }
}

// ---------- Open story viewer for a specific username ----------
function openStoryForUser(username) {
  if (!username) return false;
  if (typeof storyGroups === "undefined" || !Array.isArray(storyGroups)) return false;
  // Find group index
  var idx = -1;
  for (var i = 0; i < storyGroups.length; i++) {
    var g = storyGroups[i];
    if (g && g.user && g.user.username === username) { idx = i; break; }
  }
  if (idx === -1) return false;
  // Find first unseen story index (else 0)
  var stories = storyGroups[idx].stories || [];
  var startAt = 0;
  for (var j = 0; j < stories.length; j++) {
    if (!stories[j].viewed) { startAt = j; break; }
  }
  if (typeof openStoryViewer === "function") {
    try {
      openStoryViewer(idx, startAt);
      return true;
    } catch (e) {
      console.warn("[STORY] openStoryViewer failed", e);
      return false;
    }
  }
  return false;
}

async function openChat(username) {
  if (!messagesPage) return;
  messagesPage.classList.remove("hidden");
  document.body.classList.add("messages-chat-open");
  currentChatUser = username;
  chatWindow.classList.remove("hidden");
  if (typeof _applyChatPrefs === "function") _applyChatPrefs(username);

  convItems.querySelectorAll(".conv-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.username === username);
  });

  await loadChatMessages(true);
  startChatPolling();
  if (chatInput) chatInput.focus();
}

async function loadChatMessages(scrollToBottom = false) {
  if (!currentChatUser) return;
  // S30.2 - snapshot the user we're loading for; if the chat changes mid-flight,
  // abandon this render (was: results from old user could render into new chat)
  var _myUser = currentChatUser;

  try {
    const data = await api("/api/messages/" + encodeURIComponent(_myUser));
    // bail if user changed while we were awaiting
    if (currentChatUser !== _myUser) return;

    const u = data.user;

    const _pres = _presenceText(data.other_seconds_ago);
    const _typingNow = !!data.other_is_typing;
    let _statusHTML;
    if (_typingNow) {
      _statusHTML = '<span class="chat-status typing"><span class="typing-dots"><span></span><span></span><span></span></span> লিখছেন...</span>';
    } else {
      _statusHTML = '<span class="chat-status ' + (_pres.online ? "online" : "offline") + '">' +
        (_pres.online ? '<span class="online-dot"></span> ' : '') +
        escapeHtml(_pres.text) + '</span>';
    }
    var _headerName = u.display_name;
    try {
      var _st = await _getChatSettings(u.username);
      if (currentChatUser !== _myUser) return;
      if (_st && _st.nickname && _st.nickname.trim()) {
        _headerName = _st.nickname;
      } else if (data.their_self_nickname && data.their_self_nickname.trim()) {
        _headerName = data.their_self_nickname;
      }
    } catch (e) {}
    if (currentChatUser !== _myUser) return;

    // S30.2 - only rewrite header if content actually changed (stop 3s flicker)
    var _newHeaderHTML = `
      <div class="chat-user-avatar">${avatarInner(_headerName, u.profile_pic)}</div>
      <div style="min-width:0;flex:1">
        <div class="chat-user-name">${escapeHtml(_headerName)}</div>
        <div class="chat-user-status">${_statusHTML}</div>
      </div>`;
    if (chatUserInfo.dataset.sig !== _newHeaderHTML) {
      chatUserInfo.innerHTML = _newHeaderHTML;
      chatUserInfo.dataset.sig = _newHeaderHTML;
    }
    chatUserInfo.onclick = () => {
      stopChatPolling();
      messagesPage.classList.add("hidden");
      openProfile(u.username);
    };

    const msgs = data.messages;
    // S30.2 - use msg id (not count) to detect changes (was: delete/edit kept count same)
    var _lastId = msgs.length ? String(msgs[msgs.length - 1].id) : "0";
    var _sig = _lastId + ":" + msgs.length + ":" + (data.other_is_typing ? "1" : "0");

    if (chatMessages.dataset.sig === _sig && !scrollToBottom) return;

    const wasAtBottom =
      chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 120;

    let _lastDay = "";
    const _parts = msgs.map(function (m) {
      const d = parseISO(m.created_at);
      const dayKey = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
      let sep = "";
      if (dayKey !== _lastDay) {
        _lastDay = dayKey;
        sep = _chatDateSepHTML(m.created_at);
      }
      return sep + _chatMsgHTML(m, data.me_id);
    });
    chatMessages.innerHTML = _parts.join("");
    chatMessages.dataset.sig = _sig;
    lastMsgCount = msgs.length;

    if (scrollToBottom || wasAtBottom) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  } catch (err) {
    // S30.2 - do NOT wipe existing messages on transient error.
    // Show inline indicator instead. Next successful poll will recover.
    if (currentChatUser !== _myUser) return;
    if (!chatMessages.dataset.sig) {
      // truly empty — show placeholder
      chatMessages.innerHTML = '<div class="conv-empty" style="padding:40px 20px"><p>লোড করা যায়নি</p></div>';
    }
    // reset signature so next poll ALWAYS re-renders (was: count matched → early return → stuck)
    chatMessages.dataset.sig = "";
    console.warn("[CHAT] load failed, will retry:", err && err.message);
  }
}

// S19.11 — date separator helper
function _chatDateSepHTML(iso) {
  const d = parseISO(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - target) / 86400000);
  let label;
  if (diffDays === 0) label = "আজ";
  else if (diffDays === 1) label = "গতকাল";
  else if (diffDays < 7) {
    const days = ["রবিবার", "সোমবার", "মঙ্গলবার", "বুধবার", "বৃহস্পতিবার", "শুক্রবার", "শনিবার"];
    label = days[d.getDay()];
  } else {
    const months = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
                    "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
    const bnDay = String(d.getDate()).replace(/[0-9]/g, function (x) { return "০১২৩৪৫৬৭৮৯"[x]; });
    const bnYear = String(d.getFullYear()).replace(/[0-9]/g, function (x) { return "০১২৩৪৫৬৭৮৯"[x]; });
    label = bnDay + " " + months[d.getMonth()] + " " + bnYear;
  }
  return '<div class="chat-date-sep"><span>' + escapeHtml(label) + '</span></div>';
}


function _presenceText(secs) {
  if (secs === null || secs === undefined) return { text: "অফলাইন", online: false };
  if (secs < 60) return { text: "অনলাইন", online: true };
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    return { text: `শেষ দেখা ${m} মিনিট আগে`, online: false };
  }
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    return { text: `শেষ দেখা ${h} ঘণ্টা আগে`, online: false };
  }
  if (secs < 604800) {
    const d = Math.floor(secs / 86400);
    return { text: `শেষ দেখা ${d} দিন আগে`, online: false };
  }
  return { text: "শেষ দেখা অনেক আগে", online: false };
}

function _chatMsgHTML(m, meId) {
  // Series 3C — deleted message render
  if (m.deleted_at) {
    const _mineDel = m.sender_id === meId;
    const _sideDel = _mineDel ? "outgoing" : "incoming";
    return '<div class="chat-msg ' + _sideDel + ' deleted-msg" data-mid="' + m.id + '">' +
      '<i class="fa-solid fa-ban"></i> ' +
      '<span>\u098f\u0987 \u09ae\u09c7\u09b8\u09c7\u099c\u099f\u09bf \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09be \u09b9\u09df\u09c7\u099b\u09c7</span>' +
      '<div class="chat-msg-time">' + shortTime(m.created_at) + '</div>' +
    '</div>';
  }
  // Series 3B fix — system messages render as centered pills
  if (m.kind === "system") {
    return '<div class="chat-msg-system" data-mid="' + m.id + '">' +
      '<i class="fa-solid fa-circle-info"></i>' +
      '<span>' + escapeHtml(m.content || "") + '</span>' +
    '</div>';
  }
  const mine = m.sender_id === meId;
  const side = mine ? "outgoing" : "incoming";

  let replyHTML = "";
  if (m.parent_id) {
    const replyName = escapeHtml(m.parent_sender_name || "—");
    let preview = "";
    if (m.parent_attachment && !m.parent_content) preview = "📷 ছবি";
    else if (m.parent_content) preview = escapeHtml((m.parent_content || "").slice(0, 60));
    else preview = "—";
    replyHTML =
      '<div class="chat-msg-reply">' +
        '<div class="cmr-name">' + replyName + '</div>' +
        '<div class="cmr-text">' + preview + '</div>' +
      '</div>';
  }

  let imageHTML = "";
  if (m.attachment) {
    imageHTML = '<div class="chat-msg-image"><img src="' + escapeHtml(m.attachment) + '" alt="" loading="lazy"></div>';
  }

  let editedMark = m.edited_at ? '<span class="chat-msg-edited">(\u09b8\u09ae\u09cd\u09aa\u09be\u09a6\u09bf\u09a4)</span>' : "";

  let contentHTML = "";
  if (m.kind === "voice" && m.attachment) {
    var dur = m.duration ? Math.round(m.duration) : 0;
    var durStr = Math.floor(dur / 60) + ":" + String(dur % 60).padStart(2, "0");
    contentHTML =
      '<div class="chat-voice" data-src="' + escapeHtml(m.attachment) + '" data-dur="' + dur + '">' +
        '<button type="button" class="cv-play"><i class="fa-solid fa-play"></i></button>' +
        '<div class="cv-bars"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>' +
        '<span class="cv-dur">' + durStr + '</span>' +
      '</div>';
  } else if (m.content) {
    contentHTML = '<div class="chat-msg-text">' + escapeHtml(m.content) + '</div>';
  }

  let reactionHTML = "";
  if (m.reaction_count > 0) {
    var emoji = "❤️";
    if (m.my_reaction === "like") emoji = "👍";
    else if (m.my_reaction === "haha") emoji = "😂";
    else if (m.my_reaction === "wow") emoji = "😮";
    else if (m.my_reaction === "sad") emoji = "😢";
    reactionHTML = '<div class="chat-msg-reactions"><span class="cmr-pill">' + emoji + ' ' + m.reaction_count + '</span></div>';
  }

  let ticksHTML = "";
  if (mine) {
    if (m.is_read) {
      ticksHTML = '<span class="chat-ticks read" title="পঠিত"><i class="fa-solid fa-check-double"></i></span>';
    } else {
      ticksHTML = '<span class="chat-ticks" title="পাঠানো"><i class="fa-solid fa-check"></i></span>';
    }
  }

  return '<div class="chat-msg ' + side + (m.attachment ? " has-image" : "") + '" data-mid="' + m.id + '" data-mine="' + (mine ? "1" : "0") + '">' +
    replyHTML + imageHTML + contentHTML +
    '<div class="chat-msg-time">' + shortTime(m.created_at) + ticksHTML + '</div>' +
    reactionHTML +
  '</div>';
}

function stopChatPolling() {
  if (chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
  // S39.15 — cleanup voice recorder stream on chat close
  try {
    if (typeof _vr !== "undefined" && _vr.active) {
      _vrStop(true);
    }
    if (typeof _vr !== "undefined" && _vr.rawStream) {
      _vr.rawStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      _vr.rawStream = null;
    }
    if (typeof _vr !== "undefined" && _vr.stream) {
      _vr.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      _vr.stream = null;
    }
  } catch (e) {}
}

function startChatPolling() {
  stopChatPolling();
  chatPollTimer = setInterval(() => {
    if (currentChatUser && messagesPage && !messagesPage.classList.contains("hidden") && !document.hidden) {
      loadChatMessages(false);
    }
  }, 3000);
}

// ---------- Chat 3-dot menu ----------
async function _openChatMenu() {
  if (!currentChatUser) return;
  const old = document.getElementById("chat-menu");
  if (old) old.remove();

  // S29.5 - read from cache (populated by openChat / prior menu open)
  let settings = { pinned: false, muted: false };
  try {
    var _s = await _getChatSettings(currentChatUser);
    if (_s) settings = _s;
  } catch (e) {}

  const menu = document.createElement("div");
  menu.id = "chat-menu";
  menu.className = "chat-menu";
  menu.innerHTML = `
    <div class="cm-backdrop"></div>
    <div class="cm-panel">
      <div class="cm-handle"></div>
      <button class="cm-item" data-act="profile">
        <i class="fa-regular fa-user"></i><span>প্রোফাইল দেখুন</span>
      </button>
      <button class="cm-item" data-act="search">
        <i class="fa-solid fa-magnifying-glass"></i><span>চ্যাটে খুঁজুন</span>
      </button>
      <button class="cm-item" data-act="theme">
        <i class="fa-solid fa-palette"></i>
        <span>চ্যাট থিম</span>
      </button>
      <button class="cm-item" data-act="nickname">
        <i class="fa-regular fa-id-badge"></i>
        <span>নিকনেম</span>
      </button>
      <button class="cm-item" data-act="wallpaper">
        <i class="fa-regular fa-image"></i>
        <span>ওয়ালপেপার</span>
      </button>
      <button class="cm-item" data-act="pin">
        <i class="fa-solid fa-thumbtack"></i>
        <span>${settings.pinned ? "পিন সরান" : "চ্যাট পিন করুন"}</span>
      </button>
      <button class="cm-item" data-act="mute">
        <i class="fa-solid ${settings.muted ? "fa-bell" : "fa-bell-slash"}"></i>
        <span>${settings.muted ? "আনমিউট করুন" : "মিউট করুন"}</span>
      </button>
      <button class="cm-item danger" data-act="clear">
        <i class="fa-solid fa-broom"></i><span>চ্যাট ক্লিয়ার করুন</span>
      </button>
      <button class="cm-item danger" data-act="block">
        <i class="fa-solid fa-ban"></i><span>ব্লক করুন</span>
      </button>
    </div>`;
  document.body.appendChild(menu);
  requestAnimationFrame(() => menu.classList.add("show"));

  const close = () => { menu.classList.remove("show"); setTimeout(() => menu.remove(), 260); };
  menu.querySelector(".cm-backdrop").addEventListener("click", close);

  menu.querySelectorAll(".cm-item").forEach(btn => {
    btn.addEventListener("click", async () => {
      const act = btn.dataset.act;
      close();
      const u = currentChatUser;
      if (!u) return;

      if (act === "profile") {
        document.getElementById("messages-page")?.classList.add("hidden");
        document.body.classList.remove("messages-chat-open");
        openProfile(u);
      } else if (act === "search") {
        showToast("🔍 চ্যাট সার্চ — Series 2");
      } else if (act === "theme") {
        _openChatThemePicker(u);
      } else if (act === "nickname") {
        _openNicknameModal(u);
      } else if (act === "wallpaper") {
        _openWallpaperPicker(u);
      } else if (act === "pin") {
        try {
          const r = await api("/api/chats/" + encodeURIComponent(u) + "/settings", {
            method: "POST",
            body: JSON.stringify({ pinned: !settings.pinned, muted: settings.muted }),
          });
          _invalidateChatSettings(u);   // S29.5
          showToast(r.pinned ? "📌 পিন করা হয়েছে" : "পিন সরানো হয়েছে");
          loadConversations();
        } catch (e) { alert(e.message); }
      } else if (act === "mute") {
        try {
          const r = await api("/api/chats/" + encodeURIComponent(u) + "/settings", {
            method: "POST",
            body: JSON.stringify({ pinned: settings.pinned, muted: !settings.muted }),
          });
          _invalidateChatSettings(u);   // S29.5
          showToast(r.muted ? "🔕 মিউট করা হয়েছে" : "🔔 আনমিউট");
          loadConversations();
        } catch (e) { alert(e.message); }
      } else if (act === "clear") {
        if (!confirm("এই চ্যাটের সব মেসেজ মুছবেন? এটা ফেরানো যাবে না।")) return;
        try {
          await api("/api/chats/" + encodeURIComponent(u) + "/clear", { method: "POST" });
          showToast("🧹 চ্যাট ক্লিয়ার হয়েছে");
          await loadChatMessages(true);
          lastMsgCount = 0;
        } catch (e) { alert(e.message); }
      } else if (act === "block") {
        if (!confirm("@" + u + " কে ব্লক করবেন?")) return;
        try {
          await api("/api/users/" + encodeURIComponent(u) + "/block", { method: "POST" });
          showToast("🚫 ব্লক করা হয়েছে");
          stopChatPolling();
          document.getElementById("chat-window")?.classList.add("hidden");
          document.body.classList.remove("messages-chat-open");
          currentChatUser = null;
          loadConversations();
        } catch (e) { alert(e.message); }
      }
    });
  });
}

document.addEventListener("click", (e) => {
  if (e.target.closest("#chat-more-btn")) {
    e.preventDefault();
    e.stopPropagation();
    _openChatMenu();
  } else if (e.target.closest("#chat-call-btn")) {
    showToast("📞 অডিও কল — Series 3");
  } else if (e.target.closest("#chat-video-btn")) {
    showToast("📹 ভিডিও কল — Series 3");
  }
}, true);

// Typing indicator: send on input (throttled)
(function () {
  const ci = document.getElementById("chat-input");
  if (!ci) return;
  let _lastTypingSent = 0;
  ci.addEventListener("input", function () {
    if (!currentChatUser) return;
    const now = Date.now();
    if (now - _lastTypingSent < 2500) return;
    _lastTypingSent = now;
    api("/api/messages/" + encodeURIComponent(currentChatUser) + "/typing", {
      method: "POST",
    }).catch(function () {});
  });
})();

if (chatForm) {
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !currentChatUser) return;

    chatInput.value = "";
    const sendBtn = document.getElementById("chat-send-btn");
    if (sendBtn) sendBtn.disabled = true;

    const temp = document.createElement("div");
    temp.className = "chat-msg outgoing";
    temp.innerHTML = `${escapeHtml(text)}<div class="chat-msg-time">এইমাত্র</div>`;
    chatMessages.appendChild(temp);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    lastMsgCount++;

    try {
      await api("/api/messages/" + encodeURIComponent(currentChatUser), {
        method: "POST",
        body: JSON.stringify({ content: text }),
      });
      await loadChatMessages(true);
      await loadConversations();
    } catch (err) {
      temp.remove();
      lastMsgCount--;
      alert(err.message);
    } finally {
      if (sendBtn) sendBtn.disabled = false;
      chatInput.focus();
    }
  });
}

const chatCloseBtn = document.getElementById("chat-close");
if (chatCloseBtn) {
  chatCloseBtn.addEventListener("click", () => {
    stopChatPolling();
    chatWindow.classList.add("hidden");
    document.body.classList.remove("messages-chat-open");
    if (typeof _exitChatMultiSelect === "function") _exitChatMultiSelect();
    if (typeof _closeChatSearch === "function") _closeChatSearch();
    currentChatUser = null;
    lastMsgCount = 0;
    loadConversations();
  });
}

// New chat modal
const newChatBtn = document.getElementById("new-chat-btn");
if (newChatBtn) {
  newChatBtn.addEventListener("click", () => {
    newChatModal.classList.remove("hidden");
    document.getElementById("new-chat-search").value = "";
    document.getElementById("new-chat-results").innerHTML = "";
    document.getElementById("new-chat-search").focus();
  });
}

const closeNewChatBtn = document.getElementById("close-new-chat");
if (closeNewChatBtn) {
  closeNewChatBtn.addEventListener("click", () => newChatModal.classList.add("hidden"));
}

if (newChatModal) {
  newChatModal.addEventListener("click", (e) => {
    if (e.target === newChatModal) newChatModal.classList.add("hidden");
  });
}

const newChatSearch = document.getElementById("new-chat-search");
const newChatResults = document.getElementById("new-chat-results");

if (newChatSearch) {
  let ncTimer;
  newChatSearch.addEventListener("input", () => {
    clearTimeout(ncTimer);
    const q = newChatSearch.value.trim();
    if (!q) {
      newChatResults.innerHTML = "";
      return;
    }
    ncTimer = setTimeout(async () => {
      try {
        const users = await api("/api/users?q=" + encodeURIComponent(q));
        const filtered = users.filter((u) => u.username !== state.me.username);
        if (!filtered.length) {
          newChatResults.innerHTML = `<p style="color:var(--muted);text-align:center;padding:16px">কেউ পাওয়া যায়নি</p>`;
          return;
        }
        newChatResults.innerHTML = filtered
          .map(
            (u) => `
          <div class="new-chat-result" data-username="${escapeHtml(u.username)}">
            <div class="new-chat-avatar">${avatarInner(u.display_name, u.profile_pic)}</div>
            <div>
              <div style="font-weight:600">${escapeHtml(u.display_name)}</div>
              <div style="font-size:12px;color:var(--muted)">@${escapeHtml(u.username)}</div>
            </div>
          </div>
        `
          )
          .join("");

        newChatResults.querySelectorAll(".new-chat-result").forEach((el) => {
          el.addEventListener("click", () => {
            newChatModal.classList.add("hidden");
            openChat(el.dataset.username);
          });
        });
      } catch (err) {}
    }, 250);
  });
}

// Conversation search filter
const convSearchInput = document.getElementById("conv-search-input");
if (convSearchInput) {
  convSearchInput.addEventListener("input", () => {
    const q = convSearchInput.value.toLowerCase().trim();
    convItems.querySelectorAll(".conv-item").forEach((el) => {
      const name = el.querySelector(".conv-name").textContent.toLowerCase();
      el.style.display = name.includes(q) ? "" : "none";
    });
  });
}

// Unread badge on sidebar
const mbnMessages = document.querySelector('.mbn-item[data-mbn="messages"]');

async function updateUnreadBadge() {
  try {
    const data = await api("/api/messages/unread/count");
    const count = data.count || 0;

    // 1) Sidebar nav badge (desktop + drawer)
    const sidebarBadge = document.getElementById("msg-badge");
    if (sidebarBadge) {
      if (count > 0) {
        sidebarBadge.textContent = count > 99 ? "99+" : count;
        sidebarBadge.classList.remove("hidden");
      } else {
        sidebarBadge.classList.add("hidden");
      }
    }

    // 2) Topbar small dot (mobile)
    const topDot = document.querySelector("#top-messages-btn .notif-dot");
    if (topDot) {
      if (count > 0) {
        topDot.textContent = count > 9 ? "9+" : count;
        topDot.classList.remove("hidden");
      } else {
        topDot.classList.add("hidden");
      }
    }

    // Mobile bottom nav msg badge
    const mbnMsgBadge = document.getElementById("mbn-msg-badge");
    if (mbnMsgBadge) {
      if (count > 0) {
        mbnMsgBadge.textContent = count > 9 ? "9+" : count;
        mbnMsgBadge.classList.remove("hidden");
      } else {
        mbnMsgBadge.classList.add("hidden");
      }
    }

    // 3) Mobile bottom nav dot (optional)
    if (mbnMessages) {
      let dot = mbnMessages.querySelector(".notif-dot");
      if (count > 0) {
        if (!dot) {
          dot = document.createElement("span");
          dot.className = "notif-dot";
          dot.style.cssText = "position:absolute;top:2px;right:14px;";
          mbnMessages.style.position = "relative";
          mbnMessages.appendChild(dot);
        }
        dot.textContent = count > 9 ? "9+" : count;
      } else if (dot) {
        dot.remove();
      }
    }
  } catch (e) {}
}
