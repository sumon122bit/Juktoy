// ==================================================
// CREATE POST
// ==================================================

// S30.29 — use let (was: const) so we can update after clone/replace
let postBtn = document.getElementById("post-btn");
const postContent = document.getElementById("post-content");

function updateComposerState() {
  if (!postContent || !postBtn) return;
  postContent.style.height = "auto";
  postContent.style.height = Math.min(postContent.scrollHeight, 180) + "px";
  const hasText = postContent.value.trim().length > 0;
  postBtn.classList.toggle("visible", hasText);
}

if (postContent) {
  postContent.addEventListener("input", updateComposerState);
  postContent.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (postBtn && postBtn.classList.contains("visible")) postBtn.click();
    }
  });
  updateComposerState();
}

if (postBtn) {
  postBtn.addEventListener("click", async () => {
    if (!postContent) return;
    const content = postContent.value.trim();
    if (!content) return;

    postBtn.disabled = true;
    const oldIcon = postBtn.innerHTML;
    postBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

    try {
      await api("/api/posts", {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      postContent.value = "";
      updateComposerState();
      await loadFeed();
    } catch (err) {
      alert(err.message);
    } finally {
      postBtn.disabled = false;
      postBtn.innerHTML = oldIcon;
    }
  });
}

// Tool buttons (photo / video / feeling / location)
document.querySelectorAll(".c-icon-btn").forEach((btn) => {
  // Skip photo (multi-image picker) and emoji (own handler)
  if (btn.dataset.tool === "photo" || btn.dataset.tool === "emoji") return;

  btn.addEventListener("click", () => {
    const tool = btn.dataset.tool;
    const labels = {
      video: "🎥 ভিডিও পোস্ট শীঘ্রই আসছে!",
      tag: "👥 বন্ধু ট্যাগ শীঘ্রই আসছে!",
      feeling: "😊 অনুভূতি শীঘ্রই আসছে!",
      location: "📍 লোকেশন শীঘ্রই আসছে!",
    };
    showToast(labels[tool] || "শীঘ্রই আসছে!");
  });
});
