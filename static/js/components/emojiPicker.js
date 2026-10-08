// ==================================================
// EMOJI PICKER
// ==================================================

const EMOJI_HEX = {
  "হাসি": "1F600,1F601,1F602,1F603,1F604,1F605,1F606,1F609,1F60A,1F60B,1F60C,1F60D,1F60F,1F612,1F613,1F614,1F616,1F618,1F61A,1F61C,1F61D,1F61E,1F620,1F621,1F622,1F623,1F625,1F628,1F62A,1F62B,1F62D,1F630,1F631,1F632,1F633,1F635,1F637,1F638,1F639,1F63A,1F63B,1F63C,1F63D,1F63E,1F63F,1F640,1F645,1F646,1F647,1F648,1F649,1F64A",
  "ভালোবাসা": "2764,1F494,1F49B,1F49A,1F499,1F49C,1F49D,1F49E,1F49F,1F48B,1F48C,1F339,1F337,1F33A,1F338,1F33C,1F33B,1F490",
  "হাত": "1F44D,1F44E,1F44C,270A,270B,270C,1F44A,1F446,1F447,1F448,1F449,1F44B,1F44F,1F450,1F64C,1F64F,1F4AA,1F442,1F443,1F440,1F441,1F445,1F444,270D,1F485",
  "প্রাণী": "1F436,1F431,1F42D,1F439,1F430,1F43A,1F438,1F42F,1F428,1F43B,1F437,1F42E,1F417,1F435,1F412,1F434,1F40E,1F42B,1F411,1F418,1F43C,1F40D,1F426,1F424,1F414,1F427,1F41B,1F41D,1F41C,1F41E,1F40C,1F422,1F419,1F41F,1F420,1F421,1F42C,1F433,1F40B,1F40A,1F406,1F405,1F403,1F402,1F404,1F416,1F42A,1F42B,1F413,1F43F,1F54A",
  "খাবার": "1F34F,1F34E,1F34A,1F34B,1F34C,1F349,1F347,1F353,1F348,1F352,1F351,1F34D,1F345,1F346,1F33D,1F360,1F35E,1F356,1F357,1F354,1F35F,1F355,1F373,1F372,1F35C,1F35B,1F35D,1F35A,1F359,1F358,1F365,1F371,1F363,1F362,1F361,1F369,1F36A,1F382,1F370,1F36B,1F36C,1F36D,1F36E,1F36F,1F37C,2615,1F375,1F376,1F37A,1F37B,1F378,1F379,1F37E",
  "কার্যক্রম": "26BD,26BE,1F3C0,1F3C8,1F3BE,1F3D0,1F3B1,1F3B3,1F3AF,1F3AE,1F3B2,1F3B0,1F3A8,1F3AC,1F3A4,1F3A7,1F3BC,1F3B9,1F3B7,1F3BA,1F3B8,1F3BB,1F3AD,1F3C6,1F3C5",
  "ভ্রমণ": "1F697,1F695,1F699,1F68C,1F68E,1F693,1F691,1F692,1F690,1F69A,1F69B,1F69C,1F6B2,1F6A8,2708,1F680,1F681,26F5,1F6A4,1F6A2,2693,1F3E0,1F3E1,1F3E2,1F3E5,1F3E6,1F3E8,1F3EB,26EA,1F3F0,1F3EF,1F5FC,1F5FD,1F30B,1F3D4,1F305,1F304,1F306,1F303,1F308,2600,1F319,2B50,1F31F,2728,26A1,1F525,1F4A7,2744,26C4,1F30A,1F338,1F340,1F343",
  "বস্তু": "231A,1F4F1,1F4BB,1F5A5,1F5A8,1F5B1,1F4F7,1F4F9,1F3A5,1F4DE,260E,1F4FA,1F4FB,23F0,1F50B,1F4A1,1F526,1F4B0,1F4B3,1F48E,1F527,1F528,1F529,2699,1F512,1F513,1F511,1F4DA,1F4D6,270F,1F4DD,1F4CE,1F4CC,1F4CD,1F4C5,1F4CB,1F381,1F388,1F389,1F38A,1F514,1F4E2,1F4E3,1F4AC,1F4AD",
  "প্রতীক": "2705,274C,2B55,2757,2753,26A0,1F530,267B,1F4AF,1F534,1F535,26AB,26AA,2B1B,2B1C,25FC,25FB,2795,2796,2716,2797,27B0,00A9,00AE,2122,2714,2718"
};

function _emojiFromHex(hexStr) {
  return hexStr.split(",").map(function(h) {
    try { return String.fromCodePoint(parseInt(h, 16)); }
    catch(e) { return ""; }
  }).filter(Boolean);
}

const EMOJI_DATA = {};
const EMOJI_ARRAY = {};
for (const k in EMOJI_HEX) {
  EMOJI_ARRAY[k] = _emojiFromHex(EMOJI_HEX[k]);
  EMOJI_DATA[k] = EMOJI_ARRAY[k].join("");
}

let _emojiPickerOpen = false;
let _emojiTargetInput = null;
let _emojiMode = "post";

export function openEmojiPicker(targetInputId) {
  // Cleanup
  const old = document.getElementById("emoji-picker");
  if (old && old.parentNode) old.parentNode.removeChild(old);
  document.removeEventListener("click", _emojiOutsideClick);
  const oldSlot = document.getElementById("chat-emoji-slot");
  if (oldSlot) { oldSlot.classList.remove("open"); oldSlot.innerHTML = ""; }

  const inputEl = document.getElementById(targetInputId || "post-content");
  if (!inputEl) return;
  _emojiTargetInput = inputEl;
  _emojiMode = (targetInputId === "chat-input") ? "chat" : "post";

  // Blur so keyboard closes when picker opens
  if (document.activeElement && document.activeElement.blur && document.activeElement !== document.body) {
    try { document.activeElement.blur(); } catch (e) {}
  }

  const picker = document.createElement("div");
  picker.id = "emoji-picker";
  picker.className = "emoji-picker" + (_emojiMode === "chat" ? " emoji-picker-chat" : "");

  const tabsHTML = Object.keys(EMOJI_HEX)
    .map(function(cat, i) {
      return '<button type="button" class="ep-tab ' + (i === 0 ? "active" : "") +
             '" data-cat="' + cat + '">' + cat + '</button>';
    }).join("");

  picker.innerHTML =
    '<div class="ep-header">' +
      '<div class="ep-preview" id="ep-preview">ইমোজি ট্যাপ করুন...</div>' +
      '<button type="button" class="ep-backspace" title="শেষ অক্ষর মুছুন"><i class="fa-solid fa-delete-left"></i></button>' +
      '<button type="button" class="ep-close" title="বন্ধ"><i class="fa-solid fa-xmark"></i></button>' +
    '</div>' +
    '<div class="ep-tabs">' + tabsHTML + '</div>' +
    '<div class="ep-grid" id="ep-grid"></div>';

  // Insert into DOM first
  if (_emojiMode === "chat") {
    const slot = document.getElementById("chat-emoji-slot");
    if (slot) slot.appendChild(picker);
    else document.body.appendChild(picker);
  } else {
    document.body.appendChild(picker);
  }

  _emojiPickerOpen = true;

  // Grid click
  picker.querySelector("#ep-grid").addEventListener("click", function(e) {
    const btn = e.target.closest(".ep-emoji");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    _handleEmojiClick(btn.textContent);
  });

  // Tabs
  picker.querySelectorAll(".ep-tab").forEach(function(tab) {
    tab.addEventListener("click", function() {
      picker.querySelectorAll(".ep-tab").forEach(function(t) { t.classList.remove("active"); });
      tab.classList.add("active");
      _renderEmojiCategory(tab.dataset.cat, picker);
    });
  });

  // Backspace
  picker.querySelector(".ep-backspace").addEventListener("click", function(e) {
    e.stopPropagation();
    _backspaceEmoji();
  });

  // Close
  picker.querySelector(".ep-close").addEventListener("click", function(e) {
    e.stopPropagation();
    closeEmojiPicker();
  });

  // Chat slot open
  if (_emojiMode === "chat") {
    const slot = document.getElementById("chat-emoji-slot");
    if (slot) {
      void slot.offsetHeight;
      requestAnimationFrame(function() { slot.classList.add("open"); });
    }
  }

  // Render emojis after layout settles
  const doRender = function() {
    if (!document.getElementById("emoji-picker")) return;
    _renderEmojiCategory(Object.keys(EMOJI_HEX)[0], picker);
    picker.querySelectorAll(".ep-tab").forEach(function(t, i) {
      t.classList.toggle("active", i === 0);
    });
    _updateEpPreview();
  };
  requestAnimationFrame(doRender);
  setTimeout(doRender, 50);
  setTimeout(doRender, 200);

  setTimeout(function() { document.addEventListener("click", _emojiOutsideClick); }, 0);
}

function _handleEmojiClick(emoji) {
  insertEmoji(emoji);
  saveRecentEmoji(emoji);
  if (_emojiMode === "chat") _updateEpPreview();
}

function _updateEpPreview() {
  const preview = document.getElementById("ep-preview");
  if (!preview) return;
  const inp = _emojiTargetInput;
  if (inp && inp.value) {
    const arr = Array.from(inp.value);
    const tail = arr.slice(-24).join("");
    preview.textContent = tail;
    preview.classList.add("has-content");
  } else {
    preview.textContent = "ইমোজি ট্যাপ করুন...";
    preview.classList.remove("has-content");
  }
  preview.classList.add("pulse");
  setTimeout(function() { preview.classList.remove("pulse"); }, 300);
}

function _renderEmojiCategory(cat, picker) {
  const arr = EMOJI_ARRAY[cat] || [];
  const grid = picker.querySelector("#ep-grid");
  if (!grid || !arr.length) return;
  grid.innerHTML = arr.map(function(e) { return '<button type="button" class="ep-emoji">' + e + '</button>'; }).join("");
}

export function insertEmoji(emoji) {
  const ta = _emojiTargetInput || document.getElementById("post-content");
  if (!ta) return;
  const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
  const end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  ta.value = before + emoji + after;
  try { ta.selectionStart = ta.selectionEnd = start + emoji.length; } catch (e) {}
  // IMPORTANT: do NOT call ta.focus() — keeps keyboard closed
  if (ta.id === "post-content" && typeof updateComposerState === "function") updateComposerState();
  if (typeof _syncPostBtnState === "function") _syncPostBtnState();
  _updateEpPreview();
}

function _backspaceEmoji() {
  const ta = _emojiTargetInput || document.getElementById("post-content");
  if (!ta || !ta.value) return;
  const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
  const end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;

  if (start !== end) {
    // Delete selection
    ta.value = ta.value.slice(0, start) + ta.value.slice(end);
    try { ta.selectionStart = ta.selectionEnd = start; } catch (e) {}
  } else if (start > 0) {
    // Delete one grapheme (emoji may be multi-codepoint)
    const beforeArr = Array.from(ta.value.slice(0, start));
    beforeArr.pop();
    const newBefore = beforeArr.join("");
    const after = ta.value.slice(start);
    ta.value = newBefore + after;
    try { ta.selectionStart = ta.selectionEnd = newBefore.length; } catch (e) {}
  }

  if (ta.id === "post-content" && typeof updateComposerState === "function") updateComposerState();
  if (typeof _syncPostBtnState === "function") _syncPostBtnState();
  _updateEpPreview();
}

export function closeEmojiPicker() {
  const picker = document.getElementById("emoji-picker");
  if (picker) picker.remove();
  const slot = document.getElementById("chat-emoji-slot");
  if (slot) {
    slot.classList.remove("open");
    slot.innerHTML = "";
  }
  _emojiPickerOpen = false;
  document.removeEventListener("click", _emojiOutsideClick);
}

function _emojiOutsideClick(e) {
  if (e.target.closest("#emoji-picker")) return;
  if (e.target.closest("#btn-emoji")) return;
  if (e.target.closest("#chat-emoji-btn")) return;
  closeEmojiPicker();
}

function getRecentEmojis() {
  try {
    const raw = JSON.parse(localStorage.getItem("juktoy_recent_emojis") || "[]");
    return raw.filter(function(e) {
      if (!e || typeof e !== "string") return false;
      if (e === "?" || e === "\uFFFD" || e === "\uFFFE") return false;
      // Must be a valid string with at least one emoji-range code point
      const arr = Array.from(e);
      return arr.some(function(ch) {
        const cp = ch.codePointAt(0);
        return cp > 0x2000 && cp < 0x1FAFF;
      });
    }).slice(0, 16);
  } catch (e) { return []; }
}

function saveRecentEmoji(e) {
  if (!e || e === "?") return;
  try {
    let list = getRecentEmojis().filter(function(x) { return x !== e; });
    list.unshift(e);
    list = list.slice(0, 16);
    localStorage.setItem("juktoy_recent_emojis", JSON.stringify(list));
  } catch (err) {}
}


// Wire button
document.addEventListener("click", (e) => {
  const postBtn = e.target.closest("#btn-emoji");
  if (postBtn) {
    e.preventDefault();
    e.stopPropagation();
    openEmojiPicker("post-content");
    return;
  }
  const chatBtn = e.target.closest("#chat-emoji-btn");
  if (chatBtn) {
    e.preventDefault();
    e.stopPropagation();
    openEmojiPicker("chat-input");
  }
}, true);

// Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && _emojiPickerOpen) closeEmojiPicker();
});

// Exclude emoji button from generic toast handler
document.querySelectorAll('.c-icon-btn[data-tool="emoji"]').forEach((b) => {
  b.dataset.emojiBound = "1";
});

// ---------- Temporary bridge ----------
window.openEmojiPicker = openEmojiPicker;
window.closeEmojiPicker = closeEmojiPicker;
window.insertEmoji = insertEmoji;
