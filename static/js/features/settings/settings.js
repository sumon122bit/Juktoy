// ==================================================
// SETTINGS PAGE
// ==================================================

export async function openSettingsPage() {
  const page = document.getElementById("settings-page");
  if (!page) return;
  if (!page.classList.contains("hidden")) return;

  // S22 / Series 27B-1 — load security dashboard
  window._loadSecurityDashboard().catch(() => {});

  // S22 / Series 27B-2 — check email verified before 2FA enable
  window._checkEmailGateFor2FA().catch(() => {});

  // S18.9h3 — refresh window.state.me so privacy toggle shows correct value
  try {
    const fresh = await api("/api/me");
    if (fresh && fresh.user) window.state.me = fresh.user;
  } catch (e) {}

  const unameInput = document.getElementById("set-username");
  if (unameInput && window.state.me) unameInput.value = window.state.me.username;

  const curUname = document.getElementById("set-current-uname");
  if (curUname && window.state.me) curUname.textContent = "@" + window.state.me.username;

  ["set-current-pw", "set-new-pw", "set-confirm-pw"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  page.classList.remove("hidden");
  window._pushPage("settings");
}

document.getElementById("btn-change-pw")?.addEventListener("click", async () => {
  const cur = document.getElementById("set-current-pw").value;
  const neu = document.getElementById("set-new-pw").value;
  const conf = document.getElementById("set-confirm-pw").value;

  if (!cur || !neu || !conf) return showToast("সব ফিল্ড পূরণ করুন");
  if (neu.length < 6) return showToast("পাসওয়ার্ড ৬+ অক্ষর হতে হবে");
  if (neu !== conf) return showToast("নতুন পাসওয়ার্ড দুইবার একই লিখুন");
  if (cur === neu) return showToast("নতুন পাসওয়ার্ড পুরোনোর মতো হতে পারে না");

  const btn = document.getElementById("btn-change-pw");
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> অপেক্ষা করুন...';
  try {
    await api("/api/me/password", {
      method: "POST",
      body: JSON.stringify({ current_password: cur, new_password: neu }),
    });
    ["set-current-pw", "set-new-pw", "set-confirm-pw"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    showToast("✅ পাসওয়ার্ড পরিবর্তন হয়েছে");
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> পাসওয়ার্ড বদলান';
  }
});

document.getElementById("btn-change-uname")?.addEventListener("click", async () => {
  const uname = (document.getElementById("set-username").value || "").trim().toLowerCase();
  if (!uname) return showToast("নতুন ইউজারনেম লিখুন");
  if (!/^[a-z0-9_]+$/.test(uname)) return showToast("শুধু a-z, 0-9, _ ব্যবহার করুন");
  if (window.state.me && uname === window.state.me.username) return showToast("এটাই আপনার বর্তমান ইউজারনেম");

  const btn = document.getElementById("btn-change-uname");
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> অপেক্ষা করুন...';
  try {
    const res = await api("/api/me/username", {
      method: "POST",
      body: JSON.stringify({ username: uname }),
    });
    window.state.me.username = res.username;
    window.refreshProfileUI();

    const curUname = document.getElementById("set-current-uname");
    if (curUname) curUname.textContent = "@" + res.username;

    showToast("✅ ইউজারনেম পরিবর্তন হয়েছে");
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> ইউজারনেম বদলান';
  }
});

document.getElementById("settings-back")?.addEventListener("click", () => {
  if (window._PageStack.length > 0) history.back();
  else document.getElementById("settings-page")?.classList.add("hidden");
});

const _origCloseTopPageSettings = window._closeTopPage;
window._closeTopPage = function () {
  const top = window._PageStack[window._PageStack.length - 1];
  if (top === "settings") {
    window._PageStack.pop();
    document.getElementById("settings-page")?.classList.add("hidden");
    return true;
  }
  return _origCloseTopPageSettings();
};


// ---------- Temporary bridge ----------
window.openSettingsPage = openSettingsPage;
