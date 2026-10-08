// ==================================================
// GROUP CHAT SYSTEM
// ==================================================

window._currentGroupId = null;
window._groupPollTimer = null;
window._groupPendingImage = null;
window._newGroupSelected = [];  // usernames

// ---------- Load groups into conv sidebar ----------
export async function loadGroups() {
  var wrap = document.getElementById("group-items");
  if (!wrap) return;
  try {
    var groups = await api("/api/groups");
    if (!groups.length) {
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML = groups.map(function (g) {
      var avHTML = (g.members || []).slice(0, 3).map(function (m) {
        return '<div class="conv-avatar mini">' +
          (m.profile_pic ? '<img src="' + escapeHtml(m.profile_pic) + '" alt="" loading="lazy" decoding="async">' : initial(m.display_name)) +
          '</div>';
      }).join("");
      return '<div class="conv-item group-item" data-group-id="' + g.id + '">' +
        '<div class="conv-avatars-stack">' + avHTML + '</div>' +
        '<div class="conv-info">' +
          '<div class="conv-name">' + escapeHtml(g.name) + '</div>' +
          '<div class="conv-last">' + escapeHtml((g.last_message || 'নতুন গ্রুপ').slice(0, 40)) + '</div>' +
        '</div>' +
        '<div class="conv-meta">' +
          '<span class="conv-time">' + (g.last_time ? shortTime(g.last_time) : '') + '</span>' +
        '</div>' +
      '</div>';
    }).join("");

    wrap.querySelectorAll(".group-item").forEach(function (el) {
      el.addEventListener("click", function () {
        openGroupChat(parseInt(el.dataset.groupId));
      });
    });
  } catch (err) {
    console.error("[Groups] load failed", err);
  }
}

// ---------- Open group chat ----------
export async function openGroupChat(gid) {
  window._currentGroupId = gid;
  var win = document.getElementById("group-chat-window");
  if (!win) return;

  // Hide individual chat window if visible
  var indv = document.getElementById("chat-window");
  if (indv) indv.classList.add("hidden");

  win.classList.remove("hidden");

  // Highlight
  document.querySelectorAll(".conv-item").forEach(function (el) {
    el.classList.toggle("active", el.dataset.groupId === String(gid));
  });

  await refreshGroupChat(true);
  startGroupPolling();
}

export async function refreshGroupChat(scrollToBottom) {
  if (!window._currentGroupId) return;
  try {
    var data = await api("/api/groups/" + window._currentGroupId);
    var g = data.group;
    var members = data.members || [];

    // Header
    var headerEl = document.getElementById("group-chat-header-info");
    if (headerEl) {
      var avHTML = members.slice(0, 3).map(function (m) {
        return '<div class="chat-user-avatar mini">' +
          (m.profile_pic ? '<img src="' + escapeHtml(m.profile_pic) + '" alt="" loading="lazy" decoding="async">' : initial(m.display_name)) +
          '</div>';
      }).join("");
      headerEl.innerHTML =
        '<div class="group-header-avatars">' + avHTML + '</div>' +
        '<div><div class="chat-user-name">' + escapeHtml(g.name) + '</div>' +
        '<div class="chat-user-status">' + members.length + ' জন সদস্য</div></div>';
      headerEl.onclick = function () { showGroupInfo(data); };
    }

    // Messages
    var msgEl = document.getElementById("group-chat-messages");
    if (!msgEl) return;

    var wasAtBottom = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight < 120;
    var html = data.messages.map(function (m) {
      var mine = m.sender_id === data.me_id;
      return '<div class="chat-msg group-msg ' + (mine ? "outgoing" : "incoming") + '">' +
        (!mine ? '<div class="group-msg-sender">' + escapeHtml(m.display_name) + '</div>' : '') +
        (m.attachment ? '<div class="chat-msg-image"><img src="' + escapeHtml(m.attachment) + '" alt="" loading="lazy" decoding="async"></div>' : '') +
        (m.content ? '<div class="chat-msg-text">' + escapeHtml(m.content) + '</div>' : '') +
        '<div class="chat-msg-time">' + shortTime(m.created_at) + '</div>' +
      '</div>';
    }).join("");

    msgEl.innerHTML = html || '<div class="conv-empty" style="padding:40px 20px"><p>গ্রুপে এখনো কোনো মেসেজ নেই</p></div>';

    if (scrollToBottom || wasAtBottom) {
      msgEl.scrollTop = msgEl.scrollHeight;
    }
  } catch (err) {
    console.error("[GroupChat] refresh failed", err);
  }
}

export function startGroupPolling() {
  stopGroupPolling();
  window._groupPollTimer = setInterval(function () {
    var win = document.getElementById("group-chat-window");
    if (win && !win.classList.contains("hidden") && !document.hidden) {
      refreshGroupChat(false);
    }
  }, 3000);
}

export function stopGroupPolling() {
  if (window._groupPollTimer) {
    clearInterval(window._groupPollTimer);
    window._groupPollTimer = null;
  }
}

// ---------- Send message ----------
(function () {
  var form = document.getElementById("group-chat-form");
  if (!form) return;
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var input = document.getElementById("group-chat-input");
    var text = (input.value || "").trim();
    var image = window._groupPendingImage || "";
    if (!text && !image) return;
    if (!window._currentGroupId) return;

    input.value = "";

    try {
      await api("/api/groups/" + window._currentGroupId + "/send", {
        method: "POST",
        body: JSON.stringify({ content: text, image: image }),
      });
      window._groupPendingImage = null;
      var prev = document.getElementById("group-image-preview");
      if (prev) prev.classList.add("hidden");
      await refreshGroupChat(true);
    } catch (err) {
      alert(err.message);
    } finally {
      // ALWAYS refocus — keep keyboard up for continuous typing
      try { input.focus({ preventScroll: true }); } catch (e) {}
    }
  });

  // Prevent send button from stealing focus (keep keyboard up)
  // We only block mousedown (desktop) — allow normal click to submit
  (function () {
    var sendBtn = document.getElementById("group-chat-send");
    if (!sendBtn) return;
    sendBtn.addEventListener("mousedown", function (e) { e.preventDefault(); });
  })();
})();

// ---------- Attach image ----------
(function () {
  var btn = document.getElementById("group-attach-btn");
  var inp = document.getElementById("group-image-input");
  if (!btn || !inp) return;
  btn.addEventListener("click", function (e) {
    e.preventDefault();
    inp.click();
  });
  inp.addEventListener("change", async function (e) {
    var file = e.target.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      var resized = await resizeImage(file, 800, 0.82);
      window._groupPendingImage = resized;
      var prev = document.getElementById("group-image-preview");
      var img = document.getElementById("group-image-preview-img");
      img.src = resized;
      prev.classList.remove("hidden");
    } catch (err) {
      alert("ছবি লোড করা যায়নি");
    } finally {
      inp.value = "";
    }
  });
})();

(function () {
  var removeBtn = document.getElementById("group-image-remove");
  if (!removeBtn) return;
  removeBtn.addEventListener("click", function () {
    window._groupPendingImage = null;
    document.getElementById("group-image-preview").classList.add("hidden");
  });
})();

// ---------- Close group chat ----------
(function () {
  var closeBtn = document.getElementById("group-chat-close");
  if (!closeBtn) return;
  closeBtn.addEventListener("click", function () {
    stopGroupPolling();
    var win = document.getElementById("group-chat-window");
    if (win) win.classList.add("hidden");
    window._currentGroupId = null;
    document.querySelectorAll(".conv-item").forEach(function (el) { el.classList.remove("active"); });
  });
})();

// ---------- New Group Modal ----------
(function () {
  var modal = document.getElementById("new-group-modal");
  var openBtn = document.getElementById("new-group-btn");
  var closeBtn = document.getElementById("close-new-group");
  var cancelBtn = document.getElementById("cancel-new-group");
  var nameInput = document.getElementById("group-name-input");
  var searchInput = document.getElementById("group-member-search");
  var resultsWrap = document.getElementById("group-search-results");
  var selectedWrap = document.getElementById("group-selected-members");
  var countEl = document.getElementById("group-member-count");
  var createBtn = document.getElementById("create-group-btn");
  if (!modal || !openBtn) return;

  function open() {
    window._newGroupSelected = [];
    nameInput.value = "";
    searchInput.value = "";
    resultsWrap.innerHTML = "";
    renderSelected();
    modal.classList.remove("hidden");
    setTimeout(function () { nameInput.focus(); }, 100);
  }
  function close() { modal.classList.add("hidden"); }
  function renderSelected() {
    selectedWrap.innerHTML = window._newGroupSelected.map(function (u) {
      return '<div class="selected-member" data-username="' + escapeHtml(u.username) + '">' +
        '<span>' + escapeHtml(u.display_name) + '</span>' +
        '<i class="fa-solid fa-xmark"></i></div>';
    }).join("");
    selectedWrap.querySelectorAll(".selected-member").forEach(function (el) {
      el.addEventListener("click", function () {
        window._newGroupSelected = window._newGroupSelected.filter(function (u) { return u.username !== el.dataset.username; });
        renderSelected();
      });
    });
    countEl.textContent = "(" + window._newGroupSelected.length + " জন)";
    var ok = nameInput.value.trim().length > 0 && window._newGroupSelected.length >= 2;
    createBtn.disabled = !ok;
  }

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  nameInput.addEventListener("input", renderSelected);

  var searchTimer = null;
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimer);
    var q = searchInput.value.trim();
    if (!q) { resultsWrap.innerHTML = ""; return; }
    searchTimer = setTimeout(async function () {
      try {
        var users = await api("/api/users?q=" + encodeURIComponent(q));
        var filtered = users.filter(function (u) {
          return u.username !== (state.me && state.me.username);
        });
        if (!filtered.length) {
          resultsWrap.innerHTML = '<p style="text-align:center;color:var(--muted);padding:12px">কেউ পাওয়া যায়নি</p>';
          return;
        }
        resultsWrap.innerHTML = filtered.slice(0, 10).map(function (u) {
          var selected = window._newGroupSelected.some(function (s) { return s.username === u.username; });
          return '<div class="search-result ' + (selected ? 'selected' : '') + '" data-user="' + escapeHtml(u.username) + '" data-name="' + escapeHtml(u.display_name) + '">' +
            avatarHTML(u.display_name, u.profile_pic, "avatar-sm") +
            '<div><div class="name">' + escapeHtml(u.display_name) + '</div>' +
            '<div class="uname">@' + escapeHtml(u.username) + '</div></div>' +
            (selected ? '<i class="fa-solid fa-check" style="margin-left:auto;color:var(--accent)"></i>' : '') +
          '</div>';
        }).join("");
        resultsWrap.querySelectorAll("[data-user]").forEach(function (el) {
          el.addEventListener("click", function () {
            var un = el.dataset.user;
            var nm = el.dataset.name;
            var idx = window._newGroupSelected.findIndex(function (u) { return u.username === un; });
            if (idx >= 0) window._newGroupSelected.splice(idx, 1);
            else window._newGroupSelected.push({ username: un, display_name: nm });
            renderSelected();
            // Refresh list to update checkmarks
            searchInput.dispatchEvent(new Event("input"));
          });
        });
      } catch (err) {
        resultsWrap.innerHTML = "";
      }
    }, 250);
  });

  createBtn.addEventListener("click", async function () {
    var name = nameInput.value.trim();
    var members = window._newGroupSelected.map(function (u) { return u.username; });
    if (!name || members.length < 2) return;

    createBtn.disabled = true;
    createBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> তৈরি হচ্ছে...';

    try {
      var res = await api("/api/groups", {
        method: "POST",
        body: JSON.stringify({ name: name, members: members }),
      });
      close();
      showToast("✅ গ্রুপ তৈরি হয়েছে");
      await loadGroups();
      openGroupChat(res.group_id);
    } catch (err) {
      alert(err.message);
    } finally {
      createBtn.disabled = false;
      createBtn.innerHTML = '<i class="fa-solid fa-check"></i> গ্রুপ তৈরি করুন';
    }
  });

  console.log("[Groups] modal attached ✅");
})();


// ---------- Group info panel ----------
export function showGroupInfo(data) {
  var win = document.getElementById("group-chat-window");
  if (!win) return;
  var infoTab = document.getElementById("group-info-tab");
  if (!infoTab) return;

  var isMember = true; // we are (we opened the chat)
  var html =
    '<div class="gi-header">' +
      '<button class="back-btn" id="gi-close"><i class="fa-solid fa-arrow-left"></i></button>' +
      '<div class="gi-title">গ্রুপ তথ্য</div>' +
    '</div>' +
    '<div class="gi-body">' +
      '<div class="gi-avatars">' +
        data.members.slice(0, 5).map(function (m) {
          return '<div class="gi-av">' +
            (m.profile_pic ? '<img src="' + escapeHtml(m.profile_pic) + '" alt="" loading="lazy" decoding="async">' : initial(m.display_name)) +
          '</div>';
        }).join("") +
      '</div>' +
      '<h2 class="gi-name">' + escapeHtml(data.group.name) + '</h2>' +
      '<div class="gi-meta">' + data.members.length + ' জন সদস্য</div>' +

      '<div class="gi-section">' +
        '<div class="gi-section-title">সদস্যগণ</div>' +
        data.members.map(function (m) {
          return '<div class="gi-member" data-user="' + escapeHtml(m.username) + '">' +
            '<div class="gi-member-avatar">' +
              (m.profile_pic ? '<img src="' + escapeHtml(m.profile_pic) + '" alt="" loading="lazy" decoding="async">' : initial(m.display_name)) +
            '</div>' +
            '<div class="gi-member-name">' + escapeHtml(m.display_name) + '</div>' +
          '</div>';
        }).join("") +
      '</div>' +

      '<button class="btn-secondary danger-btn" id="gi-leave" style="width:100%;margin-top:20px">' +
        '<i class="fa-solid fa-right-from-bracket"></i> গ্রুপ ত্যাগ করুন' +
      '</button>' +
    '</div>';

  infoTab.innerHTML = html;
  infoTab.classList.remove("hidden");

  document.getElementById("gi-close").addEventListener("click", function () {
    infoTab.classList.add("hidden");
  });

  infoTab.querySelectorAll("[data-user]").forEach(function (el) {
    el.addEventListener("click", function () {
      infoTab.classList.add("hidden");
      openProfile(el.dataset.user);
    });
  });

  document.getElementById("gi-leave").addEventListener("click", async function () {
    if (!confirm("গ্রুপ থেকে বেরিয়ে যাবেন?")) return;
    try {
      await api("/api/groups/" + data.group.id + "/leave", { method: "POST" });
      infoTab.classList.add("hidden");
      var win = document.getElementById("group-chat-window");
      if (win) win.classList.add("hidden");
      window._currentGroupId = null;
      stopGroupPolling();
      showToast("গ্রুপ ত্যাগ করা হয়েছে");
      await loadGroups();
    } catch (err) {
      alert(err.message);
    }
  });
}

// ---------- Temporary bridge ----------
window.loadGroups = loadGroups;
window.openGroupChat = openGroupChat;
window.refreshGroupChat = refreshGroupChat;
window.startGroupPolling = startGroupPolling;
window.stopGroupPolling = stopGroupPolling;
window.showGroupInfo = showGroupInfo;
