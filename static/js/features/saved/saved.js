// ==================================================
// SAVED PAGE
// ==================================================

export async function openSavedPage() {
  const page = document.getElementById("saved-page");
  if (!page) return;
  page.classList.remove("hidden");
  const list = document.getElementById("saved-list");
  list.innerHTML = `<p style="text-align:center;color:var(--muted);padding:40px 20px">লোড হচ্ছে...</p>`;

  try {
    const posts = await api("/api/saves");
    if (!posts.length) {
      list.innerHTML = `<div class="explore-empty">
        <i class="fa-regular fa-bookmark"></i>
        <p>এখনো কোনো পোস্ট সেভ করেননি।<br>পোস্টের নিচে <strong>সেভ</strong> বাটনে চাপ দিন!</p>
      </div>`;
      return;
    }
    list.innerHTML = posts.map(postHTML).join("");
    bindPostEvents();
    attachHashtagListeners(list);
  } catch (err) {
    list.innerHTML = `<div class="explore-empty"><p>লোড করা যায়নি</p></div>`;
  }
}

const savedBackBtn = document.getElementById("saved-back");
if (savedBackBtn) {
  const fresh = savedBackBtn.cloneNode(true);
  savedBackBtn.parentNode.replaceChild(fresh, savedBackBtn);
  fresh.addEventListener("click", () => {
    if (window._PageStack.length > 0) history.back();
    else document.getElementById("saved-page")?.classList.add("hidden");
  });
}

// Wrap window.openSavedPage to push stack
const _origOpenSavedPage = openSavedPage;
window.openSavedPage = async function () {
  await _origOpenSavedPage();
  const page = document.getElementById("saved-page");
  if (page && !page.classList.contains("hidden")) {
    window._pushPage("saved");
  }
};

// Extend window._closeTopPage to handle saved
const _origCloseTopPage = window._closeTopPage;
window._closeTopPage = function () {
  const top = window._PageStack[window._PageStack.length - 1];
  if (top === "saved") {
    window._PageStack.pop();
    document.getElementById("saved-page")?.classList.add("hidden");
    return true;
  }
  return _origCloseTopPage();
};

