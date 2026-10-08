
// ==================================================
// NOTIFICATION FILTER TABS + POST VIEW
// ==================================================

(function () {
  var tabsWrap = document.getElementById("notif-tabs");
  if (!tabsWrap || tabsWrap.dataset.bound === "1") return;
  tabsWrap.dataset.bound = "1";

  var activeTab = "all";

  function _matchTab(n) {
    if (activeTab === "all") return true;
    if (activeTab === "likes") {
      return n.type === "like" || n.type === "comment_like" || n.type === "story_reaction";
    }
    if (activeTab === "comments") {
      return n.type === "comment" || n.type === "comment_reply";
    }
    if (activeTab === "follows") {
      return n.type === "follow";
    }
    return true;
  }

  tabsWrap.addEventListener("click", function (e) {
    var tab = e.target.closest(".notif-tab");
    if (!tab) return;
    e.preventDefault();
    activeTab = tab.dataset.type;
    tabsWrap.querySelectorAll(".notif-tab").forEach(function (t) {
      t.classList.toggle("active", t === tab);
    });
    // Re-filter existing items
    document.querySelectorAll("#notif-list .notif-item").forEach(function (el) {
      var itemType = el.dataset.type;
      var visible = false;
      if (activeTab === "all") visible = true;
      else if (activeTab === "likes") visible = (itemType === "like" || itemType === "comment_like" || itemType === "story_reaction");
      else if (activeTab === "comments") visible = (itemType === "comment" || itemType === "comment_reply");
      else if (activeTab === "follows") visible = (itemType === "follow");
      el.style.display = visible ? "" : "none";
    });
    // Show empty state if nothing matches
    var list = document.getElementById("notif-list");
    if (list) {
      var visibleCount = 0;
      list.querySelectorAll(".notif-item").forEach(function (el) {
        if (el.style.display !== "none") visibleCount++;
      });
      var emptyMsg = list.querySelector(".notif-filter-empty");
      if (visibleCount === 0 && list.querySelectorAll(".notif-item").length > 0) {
        if (!emptyMsg) {
          emptyMsg = document.createElement("div");
          emptyMsg.className = "notif-filter-empty";
          emptyMsg.innerHTML = '<i class="fa-regular fa-face-smile"></i><p>এই ধরনের কোনো নোটিফিকেশন নেই</p>';
          list.appendChild(emptyMsg);
        }
        emptyMsg.style.display = "";
      } else if (emptyMsg) {
        emptyMsg.style.display = "none";
      }
    }
  });

  console.log("[Notif] filter tabs attached ✅");
})();


