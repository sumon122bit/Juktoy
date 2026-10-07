// ==================================================
// UNIFIED SEARCH (users + posts + hashtags + recent)
// ==================================================

let _searchActiveTab = "all";
let _searchTimer = null;
let _searchCache = { users: [], posts: [], hashtags: [] };

const RECENT_KEY = "juktoy_recent_searches";

function _getRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 8);
  } catch (e) { return []; }
}
function _pushRecentSearch(q) {
  if (!q || q.length < 2) return;
  try {
    let list = _getRecentSearches().filter(function(x) { return x !== q; });
    list.unshift(q);
    list = list.slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch (e) {}
}
function _clearRecentSearches() {
  try { localStorage.removeItem(RECENT_KEY); } catch (e) {}
}

function _renderSearchBody() {
  var body = document.getElementById("search-body");
  if (!body) return;

  var q = (document.getElementById("search-input").value || "").trim();
  var tab = _searchActiveTab;
  var c = _searchCache;

  // Empty state — show recent searches
  if (!q) {
    var recents = _getRecentSearches();
    if (!recents.length) {
      body.innerHTML = '<div class="search-empty"><i class="fa-solid fa-magnifying-glass"></i><p>কিছু খুঁজুন — মানুষ, পোস্ট, বা #ট্যাগ</p></div>';
      return;
    }
    body.innerHTML =
      '<div class="search-section">' +
        '<div class="search-section-head"><span>সাম্প্রতিক</span><button type="button" class="search-clear-btn" id="search-clear-recent">সব মুছুন</button></div>' +
        recents.map(function(r) {
          return '<div class="search-recent-item" data-q="' + escapeHtml(r) + '">' +
            '<i class="fa-solid fa-clock-rotate-left"></i>' +
            '<span>' + escapeHtml(r) + '</span>' +
          '</div>';
        }).join("") +
      '</div>';
    var clearBtn = document.getElementById("search-clear-recent");
    if (clearBtn) {
      clearBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        _clearRecentSearches();
        _renderSearchBody();
      });
    }
    body.querySelectorAll(".search-recent-item").forEach(function(el) {
      el.addEventListener("click", function() {
        var input = document.getElementById("search-input");
        input.value = el.dataset.q;
        _triggerSearch();
      });
    });
    return;
  }

  // Sections
  var html = "";

  if ((tab === "all" || tab === "users") && c.users.length) {
    html += '<div class="search-section">' +
      '<div class="search-section-head"><span>মানুষ</span>' +
        (tab === "all" ? '<button type="button" class="search-see-all" data-type="users">সব দেখুন</button>' : '') +
      '</div>' +
      c.users.slice(0, tab === "all" ? 4 : 20).map(function(u) {
        return '<div class="search-result" data-user="' + escapeHtml(u.username) + '">' +
          avatarHTML(u.display_name, u.profile_pic, "avatar-sm") +
          '<div class="search-result-info">' +
            '<div class="name">' + escapeHtml(u.display_name) + '</div>' +
            '<div class="uname">@' + escapeHtml(u.username) + '</div>' +
          '</div>' +
        '</div>';
      }).join("") +
    '</div>';
  }

  if ((tab === "all" || tab === "hashtags") && c.hashtags.length) {
    html += '<div class="search-section">' +
      '<div class="search-section-head"><span>ট্যাগ</span>' +
        (tab === "all" ? '<button type="button" class="search-see-all" data-type="hashtags">সব দেখুন</button>' : '') +
      '</div>' +
      c.hashtags.slice(0, tab === "all" ? 4 : 20).map(function(t) {
        return '<div class="search-hashtag-item" data-tag="' + escapeHtml(t.tag) + '">' +
          '<div class="search-tag-icon">#</div>' +
          '<div class="search-result-info">' +
            '<div class="name">#' + escapeHtml(t.tag) + '</div>' +
            '<div class="uname">' + t.count + ' পোস্ট</div>' +
          '</div>' +
        '</div>';
      }).join("") +
    '</div>';
  }

  if ((tab === "all" || tab === "posts") && c.posts.length) {
    html += '<div class="search-section">' +
      '<div class="search-section-head"><span>পোস্ট</span>' +
        (tab === "all" ? '<button type="button" class="search-see-all" data-type="posts">সব দেখুন</button>' : '') +
      '</div>' +
      c.posts.slice(0, tab === "all" ? 3 : 20).map(function(p) {
        return '<div class="search-post-item" data-user="' + escapeHtml(p.username) + '" data-post-id="' + p.id + '">' +
          '<div class="search-post-head">' +
            avatarHTML(p.display_name, p.profile_pic, "avatar-xs") +
            '<span class="search-post-name">' + escapeHtml(p.display_name) + '</span>' +
            '<span class="search-post-time">' + timeAgo(p.created_at) + '</span>' +
          '</div>' +
          '<div class="search-post-content">' + escapeHtml((p.content || "").slice(0, 180)) + '</div>' +
          '<div class="search-post-meta">' +
            '<span><i class="fa-regular fa-heart"></i> ' + (p.likes || 0) + '</span>' +
            '<span><i class="fa-regular fa-comment"></i> ' + (p.comments || 0) + '</span>' +
          '</div>' +
        '</div>';
      }).join("") +
    '</div>';
  }

  if (!html) {
    body.innerHTML = '<div class="search-empty"><i class="fa-solid fa-face-frown"></i><p>"' + escapeHtml(q) + '" এর জন্য কিছু পাওয়া যায়নি</p></div>';
    return;
  }

  body.innerHTML = html;

  // Wire results
  body.querySelectorAll("[data-user]").forEach(function(el) {
    el.addEventListener("click", function() {
      _pushRecentSearch(q);
      openProfile(el.dataset.user);
      _closeSearchResults();
    });
  });
  body.querySelectorAll("[data-tag]").forEach(function(el) {
    el.addEventListener("click", function() {
      _pushRecentSearch(q);
      openHashtag(el.dataset.tag);
      _closeSearchResults();
    });
  });
  body.querySelectorAll(".search-see-all").forEach(function(el) {
    el.addEventListener("click", function(e) {
      e.stopPropagation();
      _searchActiveTab = el.dataset.type;
      document.querySelectorAll(".search-tab").forEach(function(t) {
        t.classList.toggle("active", t.dataset.type === _searchActiveTab);
      });
      _renderSearchBody();
    });
  });
}

async function _triggerSearch() {
  var q = (document.getElementById("search-input").value || "").trim();
  var results = document.getElementById("search-results");
  var body = document.getElementById("search-body");
  if (!results || !body) return;

  results.classList.remove("hidden");

  if (!q) {
    _renderSearchBody();
    return;
  }

  // Cache same-query
  if (q === _searchCache._lastQ && _searchCache._lastType === _searchActiveTab) {
    _renderSearchBody();
    return;
  }

  body.innerHTML = '<div class="search-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>খোঁজা হচ্ছে...</p></div>';

  try {
    var res = await api("/api/search?q=" + encodeURIComponent(q) + "&type=" + _searchActiveTab);
    _searchCache = res;
    _searchCache._lastQ = q;
    _searchCache._lastType = _searchActiveTab;
    _renderSearchBody();
  } catch (err) {
    body.innerHTML = '<div class="search-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>লোড করা যায়নি</p></div>';
  }
}

function _closeSearchResults() {
  var r = document.getElementById("search-results");
  if (r) r.classList.add("hidden");
  var inp = document.getElementById("search-input");
  if (inp) inp.value = "";
}

// Wire input
(function() {
  var input = document.getElementById("search-input");
  if (!input) return;
  input.addEventListener("input", function() {
    clearTimeout(_searchTimer);
    var q = input.value.trim();
    if (!q) {
      _searchCache = { users: [], posts: [], hashtags: [] };
      _triggerSearch();
      return;
    }
    _searchTimer = setTimeout(_triggerSearch, 250);
  });
  input.addEventListener("focus", function() {
    if (input.value.trim()) _triggerSearch();
  });
  // Enter key saves to recent
  input.addEventListener("keydown", function(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      _pushRecentSearch(input.value.trim());
      _triggerSearch();
    }
  });
})();

// Wire tabs (delegation in case HTML re-renders)
document.addEventListener("click", function(e) {
  var tab = e.target.closest(".search-tab");
  if (!tab) return;
  e.stopPropagation();
  _searchActiveTab = tab.dataset.type;
  document.querySelectorAll(".search-tab").forEach(function(t) {
    t.classList.toggle("active", t === tab);
  });
  _searchCache._lastQ = null;
  _triggerSearch();
}, true);

// Outside click closes
document.addEventListener("click", function(e) {
  var results = document.getElementById("search-results");
  if (!results) return;
  if (e.target.closest(".search-wrap")) return;
  _closeSearchResults();
});
