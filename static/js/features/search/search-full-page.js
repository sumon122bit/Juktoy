
// ==================================================
// TOPBAR SEARCH — with tabs (users / posts / tags)
// ==================================================

(function () {
  var input = document.getElementById("search-input");
  var results = document.getElementById("search-results");
  var body = document.getElementById("search-body");
  var tabsWrap = document.getElementById("search-tabs");
  if (!input || !results || !body || !tabsWrap) return;

  var timer = null;
  var activeTab = "all";
  var lastData = { users: [], posts: [], hashtags: [] };
  var lastQ = "";

  function _sectionHTML(title, icon, itemsHTML) {
    return '<div class="search-section">' +
      '<div class="search-section-head"><span><i class="fa-solid ' + icon + '"></i> ' + title + '</span></div>' +
      itemsHTML +
    '</div>';
  }

  function _userItem(u) {
    return '<div class="search-result" data-user="' + escapeHtml(u.username) + '">' +
      avatarHTML(u.display_name, u.profile_pic, "avatar-sm") +
      '<div><div class="name">' + escapeHtml(u.display_name) + '</div>' +
      '<div class="uname">@' + escapeHtml(u.username) + '</div></div></div>';
  }

  function _hashtagItem(t) {
    return '<div class="search-hashtag-item" data-tag="' + escapeHtml(t.tag) + '">' +
      '<div class="search-tag-icon">#</div>' +
      '<div class="search-result-info">' +
        '<div class="name">#' + escapeHtml(t.tag) + '</div>' +
        '<div class="uname">' + t.count + ' পোস্ট</div>' +
      '</div></div>';
  }

  function _postItem(p) {
    return '<div class="search-post-item" data-user="' + escapeHtml(p.username) + '">' +
      '<div class="search-post-head">' +
        avatarHTML(p.display_name, p.profile_pic, "avatar-xs") +
        '<span class="search-post-name">' + escapeHtml(p.display_name) + '</span>' +
        '<span class="search-post-time">' + timeAgo(p.created_at) + '</span>' +
      '</div>' +
      '<div class="search-post-content">' + escapeHtml((p.content || "").slice(0, 160)) + '</div>' +
      '<div class="search-post-meta">' +
        '<span><i class="fa-regular fa-heart"></i> ' + (p.likes || 0) + '</span>' +
        '<span><i class="fa-regular fa-comment"></i> ' + (p.comments || 0) + '</span>' +
      '</div></div>';
  }

  function _bindClicks() {
    body.querySelectorAll("[data-user]").forEach(function (el) {
      el.addEventListener("click", function () {
        openProfile(el.dataset.user);
        results.classList.add("hidden");
        input.value = "";
      });
    });
    body.querySelectorAll("[data-tag]").forEach(function (el) {
      el.addEventListener("click", function () {
        if (typeof openHashtag === "function") openHashtag(el.dataset.tag);
        results.classList.add("hidden");
        input.value = "";
      });
    });
  }

  function renderResults() {
    var d = lastData;
    var tab = activeTab;
    var html = "";

    var showUsers = (tab === "all" || tab === "users");
    var showTags = (tab === "all" || tab === "hashtags");
    var showPosts = (tab === "all" || tab === "posts");

    if (showUsers && d.users && d.users.length) {
      html += _sectionHTML("মানুষ", "fa-user",
        d.users.slice(0, tab === "all" ? 4 : 20).map(_userItem).join(""));
    }
    if (showTags && d.hashtags && d.hashtags.length) {
      html += _sectionHTML("ট্যাগ", "fa-hashtag",
        d.hashtags.slice(0, tab === "all" ? 3 : 20).map(_hashtagItem).join(""));
    }
    if (showPosts && d.posts && d.posts.length) {
      html += _sectionHTML("পোস্ট", "fa-file-lines",
        d.posts.slice(0, tab === "all" ? 3 : 20).map(_postItem).join(""));
    }

    if (!html) {
      html = '<div class="search-result"><span class="uname">কিছু পাওয়া যায়নি</span></div>';
    }

    body.innerHTML = html;
    _bindClicks();
  }

  // S30.30 — request counter prevents stale-response race
  // (was: slow old request could overwrite faster new one's results)
  var _reqSerial = 0;

  async function fetchAndRender() {
    var q = input.value.trim();
    if (!q) {
      results.classList.add("hidden");
      body.innerHTML = "";
      lastData = { users: [], posts: [], hashtags: [] };
      lastQ = "";
      return;
    }
    lastQ = q;
    var _myReq = ++_reqSerial;
    try {
      var data = await api("/api/search?q=" + encodeURIComponent(q) + "&type=all");
      if (_myReq !== _reqSerial) return;   // stale — newer request already landed
      if (input.value.trim() !== q) return; // input changed
      lastData = data;
      results.classList.remove("hidden");
      renderResults();
    } catch (err) {
      if (_myReq !== _reqSerial) return;
      body.innerHTML = '<div class="search-result"><span class="uname">লোড করা যায়নি</span></div>';
      results.classList.remove("hidden");
    }
  }

  input.addEventListener("input", function () {
    clearTimeout(timer);
    if (!input.value.trim()) {
      results.classList.add("hidden");
      body.innerHTML = "";
      return;
    }
    timer = setTimeout(fetchAndRender, 250);
  });

  // Tab switching — pure client-side (no refetch)
  tabsWrap.addEventListener("click", function (e) {
    var tab = e.target.closest(".search-tab");
    if (!tab) return;
    e.preventDefault();
    e.stopPropagation();
    activeTab = tab.dataset.type;
    tabsWrap.querySelectorAll(".search-tab").forEach(function (t) {
      t.classList.toggle("active", t === tab);
    });
    if (lastQ) renderResults();
  });

  // Outside click
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".search-wrap") && results) {
      results.classList.add("hidden");
    }
  });

  console.log("[Search] tabs + listener attached ✅");
})();

// ==================================================
// FULL-PAGE SEARCH (v1)
// ==================================================

(function () {
  // Marker for duplicate check
  var MARK = "full-page-search-v1";

  var page = document.getElementById("search-page");
  var pageInput = document.getElementById("search-page-input");
  var pageBody = document.getElementById("search-page-body");
  var pageTabs = document.getElementById("search-page-tabs");
  var pageBack = document.getElementById("search-page-back");
  var pageClear = document.getElementById("search-page-clear");
  var topInput = document.getElementById("search-input");
  if (!page || !pageInput || !pageBody || !pageTabs) return;

  var activeTab = "all";
  var timer = null;
  var lastData = { users: [], posts: [], hashtags: [] };
  var lastQ = "";
  var _isOpen = false;

  // --- HTML helpers ---
  function _section(title, icon, inner) {
    return '<div class="search-section">' +
      '<div class="search-section-head"><span><i class="fa-solid ' + icon + '"></i> ' + title + '</span></div>' +
      inner + '</div>';
  }
  function _userItem(u) {
    return '<div class="search-result" data-user="' + escapeHtml(u.username) + '">' +
      avatarHTML(u.display_name, u.profile_pic, "avatar-sm") +
      '<div class="search-result-info"><div class="name">' + escapeHtml(u.display_name) + '</div>' +
      '<div class="uname">@' + escapeHtml(u.username) + '</div></div>' +
      '<i class="fa-solid fa-chevron-right search-result-arrow"></i></div>';
  }
  function _tagItem(t) {
    return '<div class="search-hashtag-item" data-tag="' + escapeHtml(t.tag) + '">' +
      '<div class="search-tag-icon">#</div>' +
      '<div class="search-result-info"><div class="name">#' + escapeHtml(t.tag) + '</div>' +
      '<div class="uname">' + t.count + ' পোস্ট</div></div>' +
      '<i class="fa-solid fa-chevron-right search-result-arrow"></i></div>';
  }
  function _postItem(p) {
    return '<div class="search-post-item" data-user="' + escapeHtml(p.username) + '">' +
      '<div class="search-post-head">' +
        avatarHTML(p.display_name, p.profile_pic, "avatar-xs") +
        '<span class="search-post-name">' + escapeHtml(p.display_name) + '</span>' +
        '<span class="search-post-time">' + timeAgo(p.created_at) + '</span>' +
      '</div>' +
      '<div class="search-post-content">' + escapeHtml((p.content || "").slice(0, 200)) + '</div>' +
      '<div class="search-post-meta">' +
        '<span><i class="fa-regular fa-heart"></i> ' + (p.likes || 0) + '</span>' +
        '<span><i class="fa-regular fa-comment"></i> ' + (p.comments || 0) + '</span>' +
      '</div></div>';
  }

  function _bindClicks() {
    pageBody.querySelectorAll("[data-user]").forEach(function (el) {
      el.addEventListener("click", function () {
        var u = el.dataset.user;
        _close();
        if (typeof openProfile === "function") openProfile(u);
      });
    });
    pageBody.querySelectorAll("[data-tag]").forEach(function (el) {
      el.addEventListener("click", function () {
        var t = el.dataset.tag;
        _close();
        if (typeof openHashtag === "function") openHashtag(t);
      });
    });
  }

  function _render() {
    var d = lastData, tab = activeTab, html = "";
    var showU = (tab === "all" || tab === "users");
    var showT = (tab === "all" || tab === "hashtags");
    var showP = (tab === "all" || tab === "posts");

    if (showU && d.users && d.users.length)
      html += _section("মানুষ", "fa-user",
        d.users.slice(0, tab === "all" ? 4 : 20).map(_userItem).join(""));
    if (showT && d.hashtags && d.hashtags.length)
      html += _section("ট্যাগ", "fa-hashtag",
        d.hashtags.slice(0, tab === "all" ? 4 : 20).map(_tagItem).join(""));
    if (showP && d.posts && d.posts.length)
      html += _section("পোস্ট", "fa-file-lines",
        d.posts.slice(0, tab === "all" ? 4 : 20).map(_postItem).join(""));

    if (!html) {
      html = '<div class="search-empty"><i class="fa-solid fa-face-frown"></i>' +
        '<p>"' + escapeHtml(lastQ) + '" এর জন্য কিছু পাওয়া যায়নি</p></div>';
    }
    pageBody.innerHTML = html;
    _bindClicks();
  }

  function _renderEmpty() {
    var recents = [];
    try { recents = JSON.parse(localStorage.getItem("juktoy_recent_searches") || "[]"); } catch (e) {}
    if (!recents.length) {
      pageBody.innerHTML = '<div class="search-empty"><i class="fa-solid fa-magnifying-glass"></i>' +
        '<p>কিছু খুঁজুন<br>মানুষ, পোস্ট, বা #ট্যাগ</p></div>';
      return;
    }
    pageBody.innerHTML = '<div class="search-section">' +
      '<div class="search-section-head"><span>সাম্প্রতিক</span></div>' +
      recents.map(function (r) {
        return '<div class="search-recent-item" data-q="' + escapeHtml(r) + '">' +
          '<i class="fa-solid fa-clock-rotate-left"></i><span>' + escapeHtml(r) + '</span></div>';
      }).join("") + '</div>';
    pageBody.querySelectorAll(".search-recent-item").forEach(function (el) {
      el.addEventListener("click", function () {
        pageInput.value = el.dataset.q;
        _fetch();
      });
    });
  }

  function _saveRecent(q) {
    if (!q || q.length < 2) return;
    try {
      var list = JSON.parse(localStorage.getItem("juktoy_recent_searches") || "[]");
      list = list.filter(function (x) { return x !== q; });
      list.unshift(q);
      list = list.slice(0, 8);
      localStorage.setItem("juktoy_recent_searches", JSON.stringify(list));
    } catch (e) {}
  }

  var _fsSerial = 0;

  async function _fetch() {
    var q = pageInput.value.trim();
    if (!q) {
      lastQ = "";
      lastData = { users: [], posts: [], hashtags: [] };
      _renderEmpty();
      if (pageClear) pageClear.classList.add("hidden");
      return;
    }
    lastQ = q;
    var _myReq = ++_fsSerial;
    if (pageClear) pageClear.classList.remove("hidden");
    pageBody.innerHTML = '<div class="search-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>খোঁজা হচ্ছে...</p></div>';
    try {
      var data = await api("/api/search?q=" + encodeURIComponent(q) + "&type=all");
      if (_myReq !== _fsSerial) return;
      lastData = data;
      _render();
    } catch (err) {
      if (_myReq !== _fsSerial) return;
      pageBody.innerHTML = '<div class="search-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>লোড করা যায়নি</p></div>';
    }
  }

  function _open() {
    if (_isOpen) return;
    _isOpen = true;
    page.classList.remove("hidden");
    document.body.classList.add("overlay-open");
    try { history.pushState({ page: "full-search" }, "", ""); } catch (e) {}
    pageInput.value = "";
    activeTab = "all";
    pageTabs.querySelectorAll(".search-tab").forEach(function (t, i) {
      t.classList.toggle("active", i === 0);
    });
    lastData = { users: [], posts: [], hashtags: [] };
    lastQ = "";
    _renderEmpty();
    setTimeout(function () { pageInput.focus(); }, 80);
  }

  function _close() {
    // S39 — idempotent close (was: `if (!_isOpen) return;` blocked close
    // when search was opened via profile-search-btn which doesn't set _isOpen)
    _isOpen = false;
    page.classList.add("hidden");
    document.body.classList.remove("overlay-open");
    pageInput.value = "";
    pageBody.innerHTML = "";
    pageInput.blur();
  }

  // --- Wire: topbar input opens full-page search ---
  if (topInput) {
    var _onTop = function (e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      topInput.blur();
      _open();
    };
    topInput.addEventListener("focus", _onTop);
    topInput.addEventListener("click", _onTop);
    topInput.addEventListener("touchstart", _onTop, { passive: false });
  }

  // --- Wire: page input ---
  pageInput.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(_fetch, 250);
  });
  pageInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      _saveRecent(pageInput.value.trim());
      _fetch();
    }
  });

  // --- Wire: tabs ---
  pageTabs.addEventListener("click", function (e) {
    var tab = e.target.closest(".search-tab");
    if (!tab) return;
    e.preventDefault();
    e.stopPropagation();
    activeTab = tab.dataset.type;
    pageTabs.querySelectorAll(".search-tab").forEach(function (t) {
      t.classList.toggle("active", t === tab);
    });
    if (lastQ) _render();
  });

  // --- Wire: back button ---
  if (pageBack) {
    pageBack.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      // S39 — direct close (simplest, always works)
      // Also clean up the page stack if it has our entry
      if (typeof _PageStack !== "undefined") {
        var idx = _PageStack.lastIndexOf("search-page");
        if (idx !== -1) _PageStack.splice(idx, 1);
      }
      _close();
    });
  }

  // --- Wire: clear button ---
  if (pageClear) {
    pageClear.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      pageInput.value = "";
      pageInput.focus();
      lastData = { users: [], posts: [], hashtags: [] };
      lastQ = "";
      _renderEmpty();
      pageClear.classList.add("hidden");
    });
  }

  // --- Hardware/browser back ---
  window.addEventListener("popstate", function () {
    if (_isOpen) _close();
  });

  // --- Escape key ---
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && _isOpen) {
      try { history.back(); } catch (err) { _close(); }
    }
  });

  // S39 — expose _close globally for _closeTopPage
  window._closeSearchPage = _close;

  console.log("[Search] full-page " + MARK + " ready ✅");
})();
