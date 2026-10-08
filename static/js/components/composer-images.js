// ==================================================

// ---------- Composer: image management ----------

window._pendingImages = []; // array of data URI strings
window.MAX_IMAGES = 10;

window.imagePreviewGrid = document.getElementById("image-preview-grid");
window.imageFileInput = document.getElementById("image-file-input");
window.btnPickImages = document.getElementById("btn-pick-images");

if (window.btnPickImages) {
  window.btnPickImages.addEventListener("click", (e) => {
    e.preventDefault();
    if (window.imageFileInput) window.imageFileInput.click();
  });
}

if (window.imageFileInput) {
  window.imageFileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files) {
      if (window._pendingImages.length >= window.MAX_IMAGES) {
        window.showToast(`সর্বোচ্চ ${window.MAX_IMAGES}টি ছবি`);
        break;
      }
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 8_000_000) {
        window.showToast("ছবির সাইজ ৮ MB এর নিচে হতে হবে");
        continue;
      }
      try {
        const resized = await resizeImage(file, 1200, 0.8);
        window._pendingImages.push(resized);
      } catch (err) {
        console.error("Image resize failed", err);
      }
    }

    window.imageFileInput.value = "";
    renderImagePreviewGrid();
    window.updateComposerState();
  });
}

export function renderImagePreviewGrid() {
  if (!window.imagePreviewGrid) return;

  if (!window._pendingImages.length) {
    window.imagePreviewGrid.classList.add("hidden");
    window.imagePreviewGrid.innerHTML = "";
    return;
  }

  window.imagePreviewGrid.classList.remove("hidden");

  let html = window._pendingImages.map((src, i) => `
    <div class="image-preview-item" data-idx="${i}">
      <img src="${src}" alt="" loading="lazy" decoding="async">
      <button class="image-preview-remove" data-idx="${i}" title="মুছুন">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `).join("");

  // Add "more" tile if under max
  if (window._pendingImages.length < window.MAX_IMAGES) {
    html += `
      <div class="image-preview-add" id="image-preview-add-tile">
        <i class="fa-solid fa-plus"></i>
        <span>আরও</span>
      </div>
    `;
  }

  window.imagePreviewGrid.innerHTML = html;

  // Remove handlers
  window.imagePreviewGrid.querySelectorAll(".image-preview-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const idx = parseInt(btn.dataset.idx);
      window._pendingImages.splice(idx, 1);
      renderImagePreviewGrid();
      window.updateComposerState();
    });
  });

  // Add more tile
  const addTile = document.getElementById("image-preview-add-tile");
  if (addTile) {
    addTile.addEventListener("click", () => window.imageFileInput?.click());
  }
}

export function resetComposerImages() {
  window._pendingImages = [];
  renderImagePreviewGrid();
}

// ---------- Override window.updateComposerState to consider images ----------

const _origUpdateComposerState = window.updateComposerState;
window.updateComposerState = function() {
  if (!window.postContent || !window.postBtn) return;
  window.postContent.style.height = "auto";
  window.postContent.style.height = Math.min(window.postContent.scrollHeight, 180) + "px";
  const hasText = window.postContent.value.trim().length > 0;
  const hasImages = window._pendingImages.length > 0;
  const active = hasText || hasImages;
  window.postBtn.classList.toggle("visible", active);

  // Glow composer when something is ready
  const composer = window.postBtn.closest(".composer-box");
  if (composer) composer.classList.toggle("has-content", active);
};

// ---------- Override post creation handler ----------

// Remove old window.postBtn click handler by cloning
if (window.postBtn) {
  const newPostBtn = window.postBtn.cloneNode(true);
  window.postBtn.parentNode.replaceChild(newPostBtn, window.postBtn);
  window.postBtn = newPostBtn;   // S30.29 — reassign so const-holder keeps working

  newPostBtn.addEventListener("click", async () => {
    if (!window.postContent) return;
    const text = window.postContent.value.trim();
    const media = window._pendingImages.slice();

    if (!text && !media.length) return;

    newPostBtn.disabled = true;
    const oldHTML = newPostBtn.innerHTML;
    newPostBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

    try {
      const res = await window.api("/window.api/posts", {
        method: "POST",
        body: JSON.stringify({ content: text, media }),
      });
      window.postContent.value = "";
      resetComposerImages();
      window.updateComposerState();
      window.__highlightNextPost = true;
      await loadFeed();
      window.showToast("✅ পোস্ট হয়েছে!");
    } catch (err) {
      alert(err.message);
    } finally {
      newPostBtn.disabled = false;
      newPostBtn.innerHTML = oldHTML;
    }
  });
}

// ---------- Carousel render for posts ----------

export function renderCarousel(media) {
  if (!media || !media.length) return "";

  // Single image — simple
  if (media.length === 1) {
    return `
      <div class="post-carousel">
        <div class="post-carousel-track">
          <div class="post-carousel-slide">
            <img src="${window.escapeHtml(media[0])}" alt="" loading="lazy" decoding="async">
          </div>
        </div>
      </div>
    `;
  }

  // Multiple — full carousel
  const slides = media.map((src) => `
    <div class="post-carousel-slide">
      <img src="${window.escapeHtml(src)}" alt="" loading="lazy" decoding="async">
    </div>
  `).join("");

  const dots = media.map((_, i) => `
    <span class="post-carousel-dot ${i === 0 ? "active" : ""}" data-idx="${i}"></span>
  `).join("");

  return `
    <div class="post-carousel" data-current="0" data-total="${media.length}">
      <div class="post-carousel-counter">1 / ${media.length}</div>
      <div class="post-carousel-track">${slides}</div>
      <button class="post-carousel-arrow prev hidden">
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <button class="post-carousel-arrow next">
        <i class="fa-solid fa-chevron-right"></i>
      </button>
      <div class="post-carousel-dots">${dots}</div>
    </div>
  `;
}

// ---------- Carousel interactions (attach after rendering) ----------

export function attachCarouselListeners(container) {
  if (!container) return;

  container.querySelectorAll(".post-carousel").forEach((carousel) => {
    const track = carousel.querySelector(".post-carousel-track");
    const total = parseInt(carousel.dataset.total);
    if (!track || total <= 1) return;

    let current = 0;
    const counter = carousel.querySelector(".post-carousel-counter");
    const dots = carousel.querySelectorAll(".post-carousel-dot");
    const prevBtn = carousel.querySelector(".post-carousel-arrow.prev");
    const nextBtn = carousel.querySelector(".post-carousel-arrow.next");

    function goTo(idx, fromSwipe = false) {
      if (idx < 0) idx = 0;
      if (idx >= total) idx = total - 1;
      current = idx;

      track.style.transition = fromSwipe ? "none" : "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
      track.style.transform = `translateX(-${current * 100}%)`;

      if (counter) counter.textContent = `${current + 1} / ${total}`;

      dots.forEach((d, i) => d.classList.toggle("active", i === current));

      if (prevBtn) prevBtn.classList.toggle("hidden", current === 0);
      if (nextBtn) nextBtn.classList.toggle("hidden", current === total - 1);

      // Fix for swipe mode: restore transition after
      if (fromSwipe) {
        requestAnimationFrame(() => {
          track.style.transition = "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
        });
      }
    }

    // Arrows
    prevBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      goTo(current - 1);
    });
    nextBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      goTo(current + 1);
    });

    // Dots
    dots.forEach((dot) => {
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        goTo(parseInt(dot.dataset.idx));
      });
    });

    // Swipe (touch + mouse)
    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let locked = false;

    function onStart(x, y) {
      startX = x;
      startY = y;
      isDragging = true;
      locked = false;
    }

    function onMove(x, y) {
      if (!isDragging) return;
      const dx = x - startX;
      const dy = y - startY;

      // Lock direction on first significant move
      if (!locked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        locked = true;
        if (Math.abs(dy) > Math.abs(dx)) {
          // Vertical scroll → cancel horizontal swipe
          isDragging = false;
          return;
        }
      }
      if (!locked) return;
      if (Math.abs(dx) < 5) return;

      // Prevent text selection
      if (Math.abs(dx) > 15) {
        const offset = -current * 100 + (dx / carousel.offsetWidth) * 100;
        track.style.transition = "none";
        track.style.transform = `translateX(${offset}%)`;
      }
    }

    function onEnd(x) {
      if (!isDragging) {
        isDragging = false;
        return;
      }
      const dx = x - startX;
      isDragging = false;
      if (!locked) return;

      const threshold = carousel.offsetWidth * 0.2;
      if (dx < -threshold && current < total - 1) {
        goTo(current + 1);
      } else if (dx > threshold && current > 0) {
        goTo(current - 1);
      } else {
        goTo(current);
      }
    }

    // Touch
    carousel.addEventListener("touchstart", (e) => {
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    carousel.addEventListener("touchmove", (e) => {
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    carousel.addEventListener("touchend", (e) => {
      onEnd(e.changedTouches[0].clientX);
    });

    // Mouse drag (desktop)
    carousel.addEventListener("mousedown", (e) => {
      e.preventDefault();
      onStart(e.clientX, e.clientY);
    });

    carousel.addEventListener("mousemove", (e) => {
      onMove(e.clientX, e.clientY);
    });

    carousel.addEventListener("mouseup", (e) => {
      onEnd(e.clientX);
    });

    carousel.addEventListener("mouseleave", (e) => {
      if (isDragging) onEnd(e.clientX);
    });

    // Prevent img drag
    carousel.querySelectorAll("img").forEach((img) => {
      img.addEventListener("dragstart", (e) => e.preventDefault());
    });
  });
}

// ---------- Hook carousel into window.bindPostEvents ----------

const _origBindPostEventsMulti = window.bindPostEvents;
window.bindPostEvents = function() {
  _origBindPostEventsMulti();
  attachCarouselListeners(document.getElementById("feed-list"));
};

// Also run on window.enterApp for initial feed
window._enterAppHooks.push(() => {
  setTimeout(() => {
    attachCarouselListeners(document.getElementById("feed-list"));
  }, 500);
});

// Cleanup pending images when switching themes etc. — reset on load



// ---------- Temporary bridge ----------
window.renderImagePreviewGrid = renderImagePreviewGrid;
window.resetComposerImages = resetComposerImages;
window.renderCarousel = renderCarousel;
window.attachCarouselListeners = attachCarouselListeners;
