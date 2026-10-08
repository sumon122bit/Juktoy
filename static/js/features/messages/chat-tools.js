// ---------- Multi-select mode ----------
window._multiSelect = { active: false, ids: new Set(), username: null };

export function _enterChatMultiSelect(firstId) {
  window._multiSelect.active = true;
  window._multiSelect.username = window.currentChatUser;
  window._multiSelect.ids = new Set();
  if (firstId) window._multiSelect.ids.add(String(firstId));
  document.body.classList.add("chat-multi-select");
  _renderMultiSelectBar();
  _refreshMultiSelectCheckboxes();
}

export function _exitChatMultiSelect() {
  window._multiSelect.active = false;
  window._multiSelect.ids.clear();
  window._multiSelect.username = null;
  document.body.classList.remove("chat-multi-select");
  document.querySelectorAll(".chat-msg.selected").forEach(function (el) {
    el.classList.remove("selected");
  });
  document.querySelectorAll(".chat-msg-checkbox").forEach(function (el) { el.remove(); });
  var bar = document.getElementById("chat-multi-bar");
  if (bar) bar.remove();
}

export function _renderMultiSelectBar() {
  var bar = document.getElementById("chat-multi-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "chat-multi-bar";
    bar.className = "chat-multi-bar";
    var cw = document.getElementById("chat-window");
    if (cw) cw.appendChild(bar);
  }
  var n = window._multiSelect.ids.size;
  bar.innerHTML =
    '<button class="cmb-close" id="cmb-close"><i class="fa-solid fa-xmark"></i></button>' +
    '<span class="cmb-count">' + n + ' টি সিলেক্ট</span>' +
    '<div class="cmb-actions">' +
      '<button class="cmb-btn" id="cmb-star" title="স্টার"><i class="fa-regular fa-star"></i></button>' +
      '<button class="cmb-btn" id="cmb-forward" title="ফরওয়ার্ড"><i class="fa-solid fa-share"></i></button>' +
      '<button class="cmb-btn danger" id="cmb-delete" title="মুছুন"><i class="fa-regular fa-trash-can"></i></button>' +
    '</div>';

  document.getElementById("cmb-close").addEventListener("click", _exitChatMultiSelect);

  document.getElementById("cmb-star").addEventListener("click", async function () {
    if (!window._multiSelect.ids.size) return showToast("কিছু সিলেক্ট করুন");
    var count = 0;
    for (var id of window._multiSelect.ids) {
      try {
        var el = document.querySelector('.chat-msg[data-mid="' + id + '"]');
        var isStar = el && el.dataset.starred === "1";
        if (!isStar) {
          await api("/api/messages/" + id + "/star", { method: "POST" });
          count++;
        }
      } catch (e) {}
    }
    showToast("⭐ " + count + "টি স্টার করা হয়েছে");
    _exitChatMultiSelect();
    await loadChatMessages(true);
  });

  document.getElementById("cmb-forward").addEventListener("click", function () {
    if (!window._multiSelect.ids.size) return showToast("কিছু সিলেক্ট করুন");
    _openForwardModal(Array.from(window._multiSelect.ids), null, true);
  });

  document.getElementById("cmb-delete").addEventListener("click", function () {
    if (!window._multiSelect.ids.size) return;
    _openMultiDeleteSheet();
  });

}
export function _openMultiDeleteSheet() {
  var total = window._multiSelect.ids.size;
  if (!total) return;

  var mineCount = 0;
  var theirCount = 0;
  window._multiSelect.ids.forEach(function (id) {
    var el = document.querySelector('.chat-msg[data-mid="' + id + '"]');
    if (el && el.dataset.mine === "1") mineCount++;
    else theirCount++;
  });

  var old = document.getElementById("multi-del-sheet");
  if (old) old.remove();

  var sheet = document.createElement("div");
  sheet.id = "multi-del-sheet";
  sheet.className = "chat-msg-menu-root";
  sheet.innerHTML =
    '<div class="cmm-backdrop"></div>' +
    '<div class="dms-panel">' +
      '<div class="cms-handle"></div>' +
      '<div class="mds-header">' +
        '<i class="fa-solid fa-trash-can"></i>' +
        '<span>' + total + ' \u099f\u09bf \u09ae\u09c7\u09b8\u09c7\u099c \u09ae\u09c1\u099b\u09ac\u09c7\u09a8?' + '</span>' +
      '</div>' +
      '<button class="dms-item" data-act="del-me">' +
        '<span class="dms-icon"><i class="fa-solid fa-eye-slash"></i></span>' +
        '<span class="dms-info"><b>\u0986\u09ae\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c1\u09a8</b>' +
        '<small>' + total + ' \u099f\u09bf \u09ae\u09c7\u09b8\u09c7\u099c \u09b6\u09c1\u09a7\u09c1 \u0986\u09aa\u09a8\u09bf \u09a6\u09c7\u0996\u09ac\u09c7\u09a8 \u09a8\u09be</small></span>' +
      '</button>' +
      (mineCount > 0
        ? '<button class="dms-item dms-danger" data-act="del-all">' +
            '<span class="dms-icon"><i class="fa-regular fa-trash-can"></i></span>' +
            '<span class="dms-info"><b>\u09b8\u09ac\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u09ae\u09c1\u099b\u09c1\u09a8</b>' +
            '<small>' + (mineCount + theirCount > mineCount
              ? '\u0986\u09aa\u09a8\u09be\u09b0 ' + mineCount + ' \u099f\u09bf \u09b8\u09ac\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u0993 ' + theirCount + ' \u099f\u09bf \u09b6\u09c1\u09a7\u09c1 \u0986\u09aa\u09a8\u09be\u09b0 \u099c\u09a8\u09cd\u09af'
              : '\u0986\u09aa\u09a8\u09be\u09b0 ' + mineCount + ' \u099f\u09bf \u09ae\u09c7\u09b8\u09c7\u099c \u09a6\u09c1\u099c\u09a8\u09c7\u09b0 \u0995\u09be\u099b \u09a5\u09c7\u0995\u09c7') + '</small></span>' +
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
      var ids = Array.from(window._multiSelect.ids);
      var done = 0;
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var el = document.querySelector('.chat-msg[data-mid="' + id + '"]');
        var isMine = el && el.dataset.mine === "1";
        try {
          if (act === "del-me") {
            await api("/api/messages/" + id + "/delete-for-me", { method: "POST" });
            done++;
          } else if (act === "del-all") {
            if (isMine) {
              await api("/api/messages/" + id + "/delete-for-everyone", { method: "POST" });
            } else {
              await api("/api/messages/" + id + "/delete-for-me", { method: "POST" });
            }
            done++;
          }
        } catch (e) {
          console.warn("[MULTI-DEL]", id, e.message);
        }
      }
      _exitChatMultiSelect();
      await loadChatMessages(true);
      await loadConversations();
      showToast("\ud83d\uddd1\ufe0f " + done + " \u099f\u09bf \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09be \u09b9\u09df\u09c7\u099b\u09c7");
    });
  });
}


export function _refreshMultiSelectCheckboxes() {
  document.querySelectorAll("#chat-messages .chat-msg").forEach(function (el) {
    var mid = el.dataset.mid;
    var cb = el.querySelector(".chat-msg-checkbox");
    if (!cb) {
      cb = document.createElement("div");
      cb.className = "chat-msg-checkbox";
      cb.innerHTML = '<i class="fa-solid fa-check"></i>';
      el.appendChild(cb);
    }
    el.classList.toggle("selected", window._multiSelect.ids.has(String(mid)));
  });
}

document.addEventListener("click", function (e) {
  if (!window._multiSelect.active) return;
  var msg = e.target.closest("#chat-messages .chat-msg");
  if (!msg) return;
  e.preventDefault();
  e.stopPropagation();
  var mid = String(msg.dataset.mid);
  if (window._multiSelect.ids.has(mid)) window._multiSelect.ids.delete(mid);
  else window._multiSelect.ids.add(mid);
  msg.classList.toggle("selected", window._multiSelect.ids.has(mid));
  var bar = document.getElementById("chat-multi-bar");
  if (bar) {
    var c = bar.querySelector(".cmb-count");
    if (c) c.textContent = window._multiSelect.ids.size + " টি সিলেক্ট";
  }
}, true);

// ---------- Forward modal ----------
window._forwardMsgIds = [];
export async function _openForwardModal(msgIdOrIds, previewText, isMulti) {
  var ids = Array.isArray(msgIdOrIds) ? msgIdOrIds : [msgIdOrIds];
  window._forwardMsgIds = ids;

  var modal = document.getElementById("forward-modal");
  if (modal) modal.remove();

  modal = document.createElement("div");
  modal.id = "forward-modal";
  modal.className = "modal";
  modal.style.display = "flex";
  modal.style.zIndex = "99999";
  modal.style.alignItems = "center";
  modal.style.justifyContent = "center";
  modal.innerHTML =
    '<div class="modal-content forward-modal-content">' +
      '<div class="forward-modal-header">' +
        '<h3>ফরওয়ার্ড করুন</h3>' +
        '<button class="close-btn" id="fwd-close" type="button">×</button>' +
      '</div>' +
      '<div class="forward-modal-search">' +
        '<i class="fa-solid fa-magnifying-glass"></i>' +
        '<input type="text" id="fwd-search" placeholder="নাম বা ইউজারনেম...">' +
      '</div>' +
      '<div class="forward-modal-list" id="fwd-list"><p class="fwd-empty">লোড হচ্ছে...</p></div>' +
      '<div class="forward-modal-footer">' +
        '<span id="fwd-count">০ সিলেক্ট</span>' +
        '<button class="btn-primary" id="fwd-send" style="width:auto;padding:10px 22px" disabled>' +
          '<i class="fa-solid fa-paper-plane"></i> পাঠান' +
        '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var selected = new Set();
  var listEl = modal.querySelector("#fwd-list");
  var countEl = modal.querySelector("#fwd-count");
  var sendBtn = modal.querySelector("#fwd-send");

  function updateCount() {
    var n = selected.size;
    countEl.textContent = n === 0 ? "০ সিলেক্ট" : n + " জনকে পাঠাবেন";
    sendBtn.disabled = n === 0;
  }

  async function loadUsers(q) {
    try {
      var users = await api("/api/users?q=" + encodeURIComponent(q || ""));
      if (!Array.isArray(users)) {
        listEl.innerHTML = '<p class="fwd-empty">লোড করা যায়নি</p>';
        return;
      }
      var filtered = users.filter(function (u) {
        return u.username !== (state.me && state.me.username);
      });
      if (!filtered.length) {
        listEl.innerHTML = '<p class="fwd-empty">কেউ পাওয়া যায়নি</p>';
        return;
      }
      listEl.innerHTML = filtered.map(function (u) {
        return '<div class="fwd-item" data-username="' + escapeHtml(u.username) + '">' +
          '<div class="fwd-avatar">' + avatarInner(u.display_name, u.profile_pic) + '</div>' +
          '<div class="fwd-info">' +
            '<div class="fwd-name">' + escapeHtml(u.display_name) + '</div>' +
            '<div class="fwd-uname">@' + escapeHtml(u.username) + '</div>' +
          '</div>' +
          '<div class="fwd-check"><i class="fa-solid fa-check"></i></div>' +
        '</div>';
      }).join("");

      listEl.querySelectorAll(".fwd-item").forEach(function (el) {
        el.addEventListener("click", function () {
          var uname = el.dataset.username;
          if (selected.has(uname)) {
            selected.delete(uname);
            el.classList.remove("selected");
          } else {
            selected.add(uname);
            el.classList.add("selected");
          }
          updateCount();
        });
      });
    } catch (e) {
      console.error("[FWD loadUsers]", e);
      listEl.innerHTML = '<p class="fwd-empty">লোড করা যায়নি</p>';
    }
  }

  modal.querySelector("#fwd-close").addEventListener("click", function () { modal.remove(); });
  modal.addEventListener("click", function (e) { if (e.target === modal) modal.remove(); });
  modal.querySelector("#fwd-search").addEventListener("input", function (e) {
    loadUsers(e.target.value.trim());
  });

  sendBtn.addEventListener("click", async function () {
    if (!selected.size) return;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      var sentTotal = 0;
      for (var i = 0; i < window._forwardMsgIds.length; i++) {
        var res = await api("/api/messages/" + window._forwardMsgIds[i] + "/forward", {
          method: "POST",
          body: JSON.stringify({ to: Array.from(selected) }),
        });
        sentTotal += res.sent || 0;
      }
      modal.remove();
      showToast("✅ " + sentTotal + "টি ফরওয়ার্ড পাঠানো হয়েছে");
      if (isMulti && window._multiSelect.active) _exitChatMultiSelect();
      await loadConversations();
    } catch (e) {
      alert(e.message);
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> পাঠান';
    }
  });

  await loadUsers("");
  updateCount();
}

// ---------- In-chat search ----------
window._chatSearchResults = [];
window._chatSearchIdx = -1;

export function _openChatSearch() {
  var bar = document.getElementById("chat-search-bar");
  if (bar) { _closeChatSearch(); return; }
  bar = document.createElement("div");
  bar.id = "chat-search-bar";
  bar.className = "chat-search-bar";
  bar.innerHTML =
    '<button class="csb-back" id="csb-back"><i class="fa-solid fa-arrow-left"></i></button>' +
    '<div class="csb-input-wrap">' +
      '<i class="fa-solid fa-magnifying-glass csb-icon"></i>' +
      '<input type="text" id="csb-input" placeholder="এই চ্যাটে খুঁজুন..." autocomplete="off">' +
    '</div>' +
    '<span class="csb-count" id="csb-count"></span>' +
    '<button class="csb-nav" id="csb-up" title="আগের"><i class="fa-solid fa-chevron-up"></i></button>' +
    '<button class="csb-nav" id="csb-down" title="পরের"><i class="fa-solid fa-chevron-down"></i></button>';
  var cw = document.getElementById("chat-window");
  if (cw) cw.prepend(bar);

  var input = bar.querySelector("#csb-input");
  setTimeout(function () { input.focus(); }, 80);

  bar.querySelector("#csb-back").addEventListener("click", _closeChatSearch);
  var timer = null;
  input.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(_runChatSearch, 220);
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); _searchNavigate(1); }
  });
  bar.querySelector("#csb-up").addEventListener("click", function () { _searchNavigate(-1); });
  bar.querySelector("#csb-down").addEventListener("click", function () { _searchNavigate(1); });
}

export function _closeChatSearch() {
  var bar = document.getElementById("chat-search-bar");
  if (bar) bar.remove();
  window._chatSearchResults = [];
  window._chatSearchIdx = -1;
  document.querySelectorAll(".chat-msg.search-match, .chat-msg.search-current").forEach(function (el) {
    el.classList.remove("search-match", "search-current");
  });
}

export async function _runChatSearch() {
  var inputEl = document.getElementById("csb-input");
  var q = (inputEl && inputEl.value || "").trim();
  var countEl = document.getElementById("csb-count");
  document.querySelectorAll(".chat-msg.search-match, .chat-msg.search-current").forEach(function (el) {
    el.classList.remove("search-match", "search-current");
  });
  if (!q || !window.currentChatUser) {
    window._chatSearchResults = [];
    if (countEl) countEl.textContent = "";
    return;
  }
  try {
    var res = await api("/api/chats/" + encodeURIComponent(window.currentChatUser) + "/search?q=" + encodeURIComponent(q));
    window._chatSearchResults = (res.results || []).map(function (r) { return String(r.id); });
    window._chatSearchResults.forEach(function (id) {
      var el = document.querySelector('.chat-msg[data-mid="' + id + '"]');
      if (el) el.classList.add("search-match");
    });
    if (countEl) countEl.textContent = window._chatSearchResults.length ? (window._chatSearchResults.length + "টি") : "০";
    window._chatSearchIdx = -1;
    if (window._chatSearchResults.length) _searchNavigate(1);
  } catch (e) {
    if (countEl) countEl.textContent = "";
  }
}

export function _searchNavigate(dir) {
  if (!window._chatSearchResults.length) return;
  document.querySelectorAll(".chat-msg.search-current").forEach(function (el) { el.classList.remove("search-current"); });
  window._chatSearchIdx = (window._chatSearchIdx + dir + window._chatSearchResults.length) % window._chatSearchResults.length;
  var id = window._chatSearchResults[window._chatSearchIdx];
  var el = document.querySelector('.chat-msg[data-mid="' + id + '"]');
  if (el) {
    el.classList.add("search-current");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

document.addEventListener("click", function (e) {
  if (e.target.closest("#chat-search-btn")) {
    e.preventDefault();
    e.stopPropagation();
    _openChatSearch();
  }
}, true);







// ---------- Temporary bridge ----------
window._enterChatMultiSelect = _enterChatMultiSelect;
window._exitChatMultiSelect = _exitChatMultiSelect;
window._renderMultiSelectBar = _renderMultiSelectBar;
window._openMultiDeleteSheet = _openMultiDeleteSheet;
window._refreshMultiSelectCheckboxes = _refreshMultiSelectCheckboxes;
window._openForwardModal = _openForwardModal;
window._openChatSearch = _openChatSearch;
window._closeChatSearch = _closeChatSearch;
window._runChatSearch = _runChatSearch;
window._searchNavigate = _searchNavigate;
