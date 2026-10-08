// ==================================================
// PAGE STACK + HARDWARE BACK BUTTON HANDLER
// ==================================================

const _PageStack = [];
  window._PageStack = _PageStack;
let _historyBooted = false;
let _lastBackPress = 0;

export function _initHistoryOnce() {
  if (_historyBooted) return;
  _historyBooted = true;
  // Base window.state — so we have something to "stay on"
  history.replaceState({ page: "home" }, "", window.location.pathname);
}

export function _pushPage(name) {
  _initHistoryOnce();
  _PageStack.push(name);
  history.pushState({ page: name }, "", "");
}
  window._pushPage = _pushPage;

export function _closeTopPage() {
  const top = _PageStack.pop();
  if (!top) return false;

  if (top === "profile") {
    const el = document.getElementById("profile-page");
    if (el) el.classList.add("hidden");
  } else if (top === "messages") {
    if (typeof window.stopChatPolling === "function") window.stopChatPolling();
    const el = document.getElementById("messages-page");
    if (el) el.classList.add("hidden");
  } else if (top === "explore") {
    const el = document.getElementById("explore-page");
    if (el) el.classList.add("hidden");
  } else if (top === "hashtag") {
    const el = document.getElementById("hashtag-page");
    if (el) el.classList.add("hidden");
  } else if (top === "story-viewer") {
    if (typeof window.closeStoryViewer === "function") window.closeStoryViewer();
  } else if (top === "chat") {
    if (typeof window.stopChatPolling === "function") window.stopChatPolling();
    var _cw = document.getElementById("chat-window");
    if (_cw) _cw.classList.add("hidden");
    document.body.classList.remove("messages-chat-open");   // restore topbar
    if (typeof window.currentChatUser !== "undefined") window.currentChatUser = null;
    if (typeof window.lastMsgCount !== "undefined") window.lastMsgCount = 0;
    if (typeof window.loadConversations === "function") window.loadConversations();
    if (typeof window._updateOverlayClass === "function") window._updateOverlayClass();
  }
  return true;
}
  window._closeTopPage = _closeTopPage;

// Handle hardware back button + browser back
let _lastPopstateAt = 0;
window.addEventListener("popstate", (e) => {
  // Dedupe: some Android browsers fire popstate twice for one back press
  const _now = Date.now();
  if (_now - _lastPopstateAt < 150) return;
  _lastPopstateAt = _now;

  // If there is an open page, close it
  if (_PageStack.length > 0) {
    _closeTopPage();
    return;
  }

  // Nothing on the stack — user is trying to exit from home
  if (window.state.me) {
    const now = Date.now();
    if (now - _lastBackPress < 2000) {
      // Second press within 2s — let them exit
      // Do nothing, browser will exit
      return;
    }
    _lastBackPress = now;
    // Push window.state again so we stay in the app
    history.pushState({ page: "home" }, "", "");
    window.showToast("আবার back চাপলে অ্যাপ থেকে বের হবেন");
  }
});

// ---------- Wire internal back buttons to history.back() ----------

export function _rebindBackButton(id) {
  const old = document.getElementById(id);
  if (!old) return;
  const fresh = old.cloneNode(true);
  old.parentNode.replaceChild(fresh, old);
  fresh.addEventListener("click", () => {
    if (_PageStack.length > 0) {
      history.back();
    } else {
      // Fallback: manually close
      if (id === "profile-back") document.getElementById("profile-page")?.classList.add("hidden");
      if (id === "explore-back") document.getElementById("explore-page")?.classList.add("hidden");
      if (id === "hashtag-back") document.getElementById("hashtag-page")?.classList.add("hidden");
      if (id === "messages-back") document.getElementById("messages-page")?.classList.add("hidden");
    }
  });
}

_rebindBackButton("profile-back");
_rebindBackButton("explore-back");
_rebindBackButton("hashtag-back");
_rebindBackButton("messages-back");
_rebindBackButton("chat-close");
_rebindBackButton("sv-close");

// ---------- Wrap open functions to push stack ----------

// window.openProfile
const _origOpenProfile_stack = window.openProfile;
window.openProfile = async function (username) {
  await _origOpenProfile_stack(username);
  const page = document.getElementById("profile-page");
  if (page && !page.classList.contains("hidden")) {
    _pushPage("profile");
  }
};


window._enterAppHooks.push(() => {
  _initHistoryOnce();
  _PageStack.length = 0; // reset on login
});


// ---------- Temporary bridge ----------
window._initHistoryOnce = _initHistoryOnce;
window._rebindBackButton = _rebindBackButton;
