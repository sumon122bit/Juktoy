// ==================================================
// POST EDIT
// ==================================================

export function enterEditMode(postEl, postId) {
  const wrap = postEl.querySelector(".post-content-wrap");
  if (!wrap) return;
  if (wrap.dataset.editing === "1") return;

  const contentEl = wrap.querySelector(".post-content");
  const originalText = contentEl ? contentEl.textContent : "";
  const actionsEl = postEl.querySelector(".post-actions");
  if (actionsEl) actionsEl.dataset.editHidden = "1";

  wrap.dataset.editing = "1";
  wrap.innerHTML = `
    <div class="edit-post-form">
      <textarea class="edit-post-ta" maxlength="10000">${escapeHtml(originalText)}</textarea>
      <div class="edit-post-actions">
        <button class="ep-cancel btn-secondary">বাতিল</button>
        <button class="ep-save btn-primary"><i class="fa-solid fa-check"></i> সংরক্ষণ</button>
      </div>
    </div>
  `;

  const ta = wrap.querySelector(".edit-post-ta");
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  // Auto-resize
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  ta.addEventListener("input", () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  });

  wrap.querySelector(".ep-cancel").addEventListener("click", () => {
    cancelEditMode(postEl, originalText);
  });

  wrap.querySelector(".ep-save").addEventListener("click", async () => {
    const newContent = ta.value.trim();
    if (!newContent) return showToast("খালি পোস্ট রাখা যাবে না");
    if (newContent === originalText.trim()) {
      cancelEditMode(postEl, originalText);
      return;
    }

    const saveBtn = wrap.querySelector(".ep-save");
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
      const res = await api("/api/posts/" + postId, {
        method: "PATCH",
        body: JSON.stringify({ content: newContent }),
      });
      // Update content
      wrap.dataset.editing = "0";
      wrap.innerHTML = `<div class="post-content">${linkifyHashtags(res.content)}</div>`;

      // Add/update edited mark (sibling of wrap)
      let mark = postEl.querySelector(".post-edited-mark");
      if (!mark) {
        mark = document.createElement("div");
        mark.className = "post-edited-mark";
        mark.textContent = "(সম্পাদিত)";
        wrap.parentNode.insertBefore(mark, wrap);
      } else {
        mark.classList.add("pulse-once");
        setTimeout(() => mark.classList.remove("pulse-once"), 600);
      }

      // Restore actions
      if (actionsEl) delete actionsEl.dataset.editHidden;
      attachHashtagListeners(wrap);
      showToast("✅ পোস্ট আপডেট হয়েছে");
    } catch (err) {
      alert(err.message);
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> সংরক্ষণ';
    }
  });
}

export function cancelEditMode(postEl, originalText) {
  const wrap = postEl.querySelector(".post-content-wrap");
  if (!wrap) return;
  wrap.dataset.editing = "0";
  wrap.innerHTML = originalText
    ? `<div class="post-content">${linkifyHashtags(originalText)}</div>`
    : "";
  const actionsEl = postEl.querySelector(".post-actions");
  if (actionsEl) delete actionsEl.dataset.editHidden;
  attachHashtagListeners(wrap);
}

// ---------- Temporary bridge ----------
window.enterEditMode = enterEditMode;
window.cancelEditMode = cancelEditMode;
