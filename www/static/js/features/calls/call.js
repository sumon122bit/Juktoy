/* ═══════════════════════════════════════════════
   SERIES 4B — Voice/Video Call Client
   Isolated module — no conflicts with existing code
   ═══════════════════════════════════════════════ */

(function () {
  "use strict";

  // ============================================
  // S22 / Series 10 — Debug-gated logging
  // Runs on localhost only (or when ?debug=1 in URL).
  // ============================================
  var _CALL_DEBUG_MODE = (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    /[?&]debug=1/.test(window.location.search)
  );
  function _cdlog() {
    if (!_CALL_DEBUG_MODE) return;
    try { console.log.apply(console, arguments); } catch (e) {}
  }
  function _cdwarn() {
    if (!_CALL_DEBUG_MODE) return;
    try { console.warn.apply(console, arguments); } catch (e) {}
  }

  // ============================================
  // State
  // ============================================
  var CALL = {
    active: null,          // current call object
    pc: null,              // RTCPeerConnection
    localStream: null,
    remoteStream: null,
    pollTimer: null,
    durationTimer: null,
    startedAt: 0,
    muted: false,
    cameraOff: false,
    speakerOn: true,
    _facing: "user",   // S30.10 - camera facing mode
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
    seenCallIds: {},       // dedupe
    bannerCallId: null,
    _starting: false,      // S30.3 - sync lock for startCall/accept
    _gen: 0,               // S30.3 - increment on every new call (cancel-safe)
  };
  // S29.3 - idempotency guard so we only send ONE end request per call
  var _endSyncSent = false;

  // ============================================
  // Utils
  // ============================================
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function fmtDuration(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  function api(url, opts) {
    if (typeof window.api === "function") return window.api(url, opts);
    // Fallback
    opts = opts || {};
    opts.credentials = "same-origin";
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    return fetch(url, opts).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || "request failed");
        return d;
      });
    });
  }

  // ============================================
  // Toast (reuse existing if available)
  // ============================================
  // Series 4B fix — properly resolve current user (const state doesn't live on window)
  function _getMe() {
    try { if (typeof state !== "undefined" && state && state.me) return state.me; } catch (e) {}
    try { if (window.state && window.state.me) return window.state.me; } catch (e) {}
    try { if (window.__juktoyState && window.__juktoyState.me) return window.__juktoyState.me; } catch (e) {}
    return null;
  }

  function toast(msg) {
    if (typeof window.showToast === "function") return window.showToast(msg);
    _cdlog("[CALL]", msg);
  }

  // ============================================
  // Vibration helper
  // ============================================
  function vib(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  // ============================================
  // Build overlay DOM (once)
  // ============================================
  function ensureOverlay() {
    if ($("call-overlay")) return;

    var el = document.createElement("div");
    el.id = "call-overlay";
    el.className = "call-overlay hidden";
    el.innerHTML =
      '<div class="call-header">' +
        '<div class="call-kind" id="co-kind"><i class="fa-solid fa-phone"></i> <span>অডিও কল</span></div>' +
        '<div class="call-timer" id="co-timer"></div>' +
      '</div>' +
      '<div class="call-user">' +
        '<div class="call-avatar-wrap" id="co-avatar-wrap">' +
          '<div class="call-avatar-ring"></div>' +
          '<div class="call-avatar-ring"></div>' +
          '<div class="call-avatar-ring"></div>' +
          '<div class="call-avatar" id="co-avatar"></div>' +
        '</div>' +
        '<div class="call-name" id="co-name">—</div>' +
        '<div class="call-sub" id="co-sub"><span class="dots"></span></div>' +
      '</div>' +
      '<div class="call-video-wrap hidden" id="co-video-wrap">' +
        '<video class="call-video-remote" id="co-video-remote" playsinline autoplay></video>' +
        '<video class="call-video-local" id="co-video-local" playsinline autoplay muted></video>' +
      '</div>' +
      '<div class="call-actions" id="co-actions"></div>';

    document.body.appendChild(el);
  }

  function ensureBanner() {
    if ($("call-mini-banner")) return;
    var el = document.createElement("div");
    el.id = "call-mini-banner";
    el.className = "call-mini-banner hidden";
    document.body.appendChild(el);
  }

  // ============================================
  // Overlay show/hide
  // ============================================
  function showOverlay() { var el = $("call-overlay"); if (el) el.classList.remove("hidden"); }
  function hideOverlay() { var el = $("call-overlay"); if (el) el.classList.add("hidden"); }

  function setAvatar(name, pic) {
    var a = $("co-avatar");
    if (!a) return;
    if (pic) {
      a.innerHTML = '<img src="' + esc(pic) + '" alt="">';
    } else {
      a.textContent = (name || "?").trim().charAt(0).toUpperCase();
    }
  }

  function setKind(kind) {
    var k = $("co-kind");
    if (!k) return;
    if (kind === "video") {
      k.innerHTML = '<i class="fa-solid fa-video"></i> <span>ভিডিও কল</span>';
    } else {
      k.innerHTML = '<i class="fa-solid fa-phone"></i> <span>অডিও কল</span>';
    }
  }

  function setSub(text, ringing) {
    var s = $("co-sub");
    if (!s) return;
    s.innerHTML = ringing ? '<span class="dots"></span>' : esc(text);
    if (ringing) {
      var t = $("co-timer");
      if (t) t.classList.add("ringing");
    } else {
      var t2 = $("co-timer");
      if (t2) t2.classList.remove("ringing");
    }
  }

  function setVideoMode(kind) {
    var el = $("call-overlay");
    if (!el) return;
    if (kind === "video") el.classList.add("video-mode");
    else el.classList.remove("video-mode");
  }

  function setTimerText(txt) {
    var t = $("co-timer");
    if (t) t.textContent = txt;
  }

  // ============================================
  // Action buttons
  // ============================================
  function renderActions(mode, kind) {
    var a = $("co-actions");
    if (!a) return;

    if (mode === "incoming") {
      a.innerHTML =
        '<button class="call-btn decline" id="co-decline" title="ডিক্লাইন"><i class="fa-solid fa-phone-slash"></i></button>' +
        '<button class="call-btn accept" id="co-accept" title="Accept"><i class="fa-solid fa-phone"></i></button>';
    } else if (mode === "outgoing") {
      a.innerHTML =
        '<button class="call-btn end" id="co-cancel" title="বাতিল"><i class="fa-solid fa-phone-slash"></i></button>';
    } else if (mode === "active") {
      if (kind === "video") {
        a.innerHTML =
          '<button class="call-btn secondary" id="co-mute" title="মিউট"><i class="fa-solid fa-microphone"></i></button>' +
          '<button class="call-btn secondary" id="co-cam" title="ক্যামেরা"><i class="fa-solid fa-video"></i></button>' +
          '<button class="call-btn end" id="co-end" title="End"><i class="fa-solid fa-phone-slash"></i></button>' +
          '<button class="call-btn secondary" id="co-switch" title="Switch camera"><i class="fa-solid fa-camera-rotate"></i></button>';
      } else {
        a.innerHTML =
          '<button class="call-btn secondary" id="co-mute" title="মিউট"><i class="fa-solid fa-microphone"></i></button>' +
          '<button class="call-btn end" id="co-end" title="End"><i class="fa-solid fa-phone-slash"></i></button>' +
          '<button class="call-btn secondary" id="co-spk" title="Speaker"><i class="fa-solid fa-volume-high"></i></button>';
      }
    } else {
      a.innerHTML = "";
    }
  }

  // ============================================
  // Local media
  // ============================================
  function getLocalStream(kind) {
    if (CALL.localStream) return Promise.resolve(CALL.localStream);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error("media devices not available"));
    }
    var constraints = kind === "video"
      ? { audio: true, video: { width: { ideal: 720 }, height: { ideal: 1280 }, facingMode: "user" } }
      : { audio: true, video: false };

    // S30.3 - capture the call generation. If call ends while we're awaiting
    // getUserMedia, stop the stream instead of assigning it to CALL.localStream.
    var _gen = CALL._gen || 0;

    return navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      if ((CALL._gen || 0) !== _gen || !CALL.active) {
        // call was cancelled while waiting for permission → drop the stream
        try { stream.getTracks().forEach(function(t){ t.stop(); }); } catch(e){}
        return Promise.reject(new Error("call cancelled"));
      }
      CALL.localStream = stream;
      return stream;
    });
  }

  function stopLocalStream() {
    if (CALL.localStream) {
      try { CALL.localStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      CALL.localStream = null;
    }
  }

  // ============================================
  // WebRTC peer connection
  // ============================================
  function createPeer(callId, isCaller) {
    if (CALL.pc) try { CALL.pc.close(); } catch (e) {}
    var pc = new RTCPeerConnection({ iceServers: CALL.iceServers });
    CALL.pc = pc;

    pc.onicecandidate = function (ev) {
      if (ev.candidate) {
        api("/api/calls/" + callId + "/ice", {
          method: "POST",
          body: JSON.stringify({ candidate: ev.candidate }),
        }).catch(function () {});
      }
    };

    pc.ontrack = function (ev) {
      // S30.10 - always attach to a media stream
      if (!CALL.remoteStream) CALL.remoteStream = new MediaStream();
      try { CALL.remoteStream.addTrack(ev.track); } catch (e) {}

      var remote = $("co-video-remote");
      if (remote) {
        remote.srcObject = CALL.remoteStream;
        remote.play().catch(function () {});
      }

      // For audio-only calls, create a hidden <audio> element
      if (ev.track.kind === "audio" && !CALL._remoteAudioEl) {
        try {
          var a = document.createElement("audio");
          a.autoplay = true;
          a.playsInline = true;
          a.style.display = "none";
          a.srcObject = CALL.remoteStream;
          document.body.appendChild(a);
          CALL._remoteAudioEl = a;
          a.play().catch(function () {});
        } catch (e) {}
      }
    };

    pc.onconnectionstatechange = function () {
      _cdlog("[CALL] pc state:", pc.connectionState);

      // S30.10 - graceful handling of connection failures
      if (pc.connectionState === "connected") {
        // clear any pending disconnect watchdog
        if (CALL._discTimer) { clearTimeout(CALL._discTimer); CALL._discTimer = null; }
        if (CALL._connFailed) CALL._connFailed = false;
        return;
      }

      if (pc.connectionState === "disconnected") {
        // temporary network blip — give 12s grace before ending
        if (CALL._discTimer) return;
        CALL._discTimer = setTimeout(function () {
          CALL._discTimer = null;
          if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            _cdwarn("[CALL] disconnected too long → ending");
            try { toast("সংযোগ হারিয়ে গেছে"); } catch (e) {}
            endCall("connection_lost");
          }
        }, 12000);
        return;
      }

      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        if (CALL._connFailed) return;   // only handle once
        CALL._connFailed = true;
        if (CALL._discTimer) { clearTimeout(CALL._discTimer); CALL._discTimer = null; }
        _cdwarn("[CALL] pc failed → ending");
        try { toast("সংযোগ ব্যর্থ হয়েছে"); } catch (e) {}
        endCall("connection_failed");
      }
    };

    return pc;
  }

  function attachLocalTracks(pc) {
    if (!CALL.localStream) return;
    CALL.localStream.getTracks().forEach(function (track) {
      pc.addTrack(track, CALL.localStream);
    });
  }

  // ============================================
  // S30.8 - Unified call ticker
  //   Polls /api/calls/<id> once per tick and handles:
  //     • answer arrival (caller side)
  //     • ICE candidate append (both sides)
  //     • remote-end detection (both sides)
  //   Replaces 3 separate timers (was ~3.8 req/sec/client).
  // ============================================
  var _callTicker = null;
  var _callTickCallId = null;
  var _callTickRole = null;   // "caller" | "callee"
  var _callTickPhase = null;  // "answer" | "active"
  var _callTickSeen = { caller: 0, callee: 0 };

  function _startCallTicker(callId, role, phase) {
    _stopCallTicker();
    _callTickCallId = callId;
    _callTickRole = role;
    _callTickPhase = phase;
    _callTickSeen = { caller: 0, callee: 0 };

    var isCaller = (role === "caller");

    _callTicker = setInterval(function () {
      if (!_callTickCallId) return;
      api("/api/calls/" + _callTickCallId).then(function (c) {
        // safety: call may have been closed
        if (!CALL.active || CALL.active.id !== _callTickCallId) return;

        // ---------- Phase 1: caller waiting for answer ----------
        if (_callTickPhase === "answer") {
          // pull callee's ICE while ringing
          if (isCaller && c.callee_ice && CALL.pc) {
            try {
              var arr = JSON.parse(c.callee_ice) || [];
              for (var i = _callTickSeen.callee; i < arr.length; i++) {
                try { CALL.pc.addIceCandidate(new RTCIceCandidate(arr[i])); } catch (e) {}
              }
              _callTickSeen.callee = arr.length;
            } catch (e) {}
          }

          if (c.status === "active" && c.answer) {
            if (CALL.pc && CALL.pc.signalingState !== "stable") {
              try {
                CALL.pc.setRemoteDescription({ type: "answer", sdp: c.answer });
              } catch (e) { _cdwarn("[CALL] setRemote answer:", e); }
            }
            // promote to active phase
            _callTickPhase = "active";
            setSub("", false);
            if (CALL.active) {
              setKind(CALL.active.kind);
              setVideoMode(CALL.active.kind);
              renderActions("active", CALL.active.kind);
              wireActiveButtons();
              startDurationTimer();
            }
          } else if (c.status === "declined" || c.status === "ended" || c.status === "missed") {
            var msg = (c.status === "declined") ? "\u0995\u09b2 \u09a1\u09bf\u0995\u09b2\u09be\u0987\u09a8 \u0995\u09b0\u09be \u09b9\u09df\u09c7\u099b\u09c7"
                     : (c.status === "missed")  ? "\u0995\u09c7\u0989 \u0995\u09b2 \u09a7\u09b0\u09c7\u09a8\u09bf"
                     : "\u0995\u09b2 \u09b6\u09c7\u09b7 \u09b9\u09df\u09c7\u099b\u09c7";
            toast(msg);
            cleanup(true);
          }
          return;
        }

        // ---------- Phase 2: active call ----------
        if (_callTickPhase === "active") {
          // pull counterpart's ICE
          var remoteList = isCaller ? c.callee_ice : c.caller_ice;
          var seenKey = isCaller ? "callee" : "caller";
          if (remoteList && CALL.pc) {
            try {
              var arr2 = JSON.parse(remoteList) || [];
              for (var j = _callTickSeen[seenKey]; j < arr2.length; j++) {
                try { CALL.pc.addIceCandidate(new RTCIceCandidate(arr2[j])); } catch (e) {}
              }
              _callTickSeen[seenKey] = arr2.length;
            } catch (e) {}
          }

          // remote ended?
          if (c.status === "ended" || c.status === "declined" || c.status === "missed") {
            if (c.status === "ended") toast("\u0995\u09b2 \u09b6\u09c7\u09b7");
            if (c.status === "declined") toast("\u0995\u09b2 \u09a1\u09bf\u0995\u09b2\u09be\u0987\u09a8");
            if (c.status === "missed") toast("\u09ae\u09bf\u09b8 \u0995\u09b2");
            cleanup(true);
          }
        }
      }).catch(function () {});
    }, 1500);
  }

  function _stopCallTicker() {
    if (_callTicker) {
      clearInterval(_callTicker);
      _callTicker = null;
    }
    _callTickCallId = null;
    _callTickRole = null;
    _callTickPhase = null;
  }

  // ============================================
  // ICE polling loop (read counterpart's ICE)
  // ============================================
  var _iceSeen = { caller: 0, callee: 0 };
  function startIcePolling(callId, isCaller) {
    // S30.8 - route through unified ticker (role inferred)
    var role = isCaller ? "caller" : "callee";
    _startCallTicker(callId, role, "active");
    CALL.icePollTimer = _callTicker;   // legacy compat
  }

  function stopIcePolling() {
    // S30.8 - unified ticker clears everything
    if (typeof _stopCallTicker === "function") _stopCallTicker();
    if (CALL.icePollTimer) { clearInterval(CALL.icePollTimer); CALL.icePollTimer = null; }
    if (CALL.answerPollTimer) { clearInterval(CALL.answerPollTimer); CALL.answerPollTimer = null; }
    if (CALL.remoteEndTimer) { clearInterval(CALL.remoteEndTimer); CALL.remoteEndTimer = null; }
  }

  // ============================================
  // Poll the counterpart's answer (caller side)
  // ============================================
  function startAnswerPolling(callId) {
    // S30.8 - route through unified ticker
    _startCallTicker(callId, "caller", "answer");
    CALL.answerPollTimer = _callTicker;   // legacy compat
  }

  function stopAnswerPolling() {
    // S30.8 - unified ticker clears everything
    if (typeof _stopCallTicker === "function") _stopCallTicker();
    if (CALL.icePollTimer) { clearInterval(CALL.icePollTimer); CALL.icePollTimer = null; }
    if (CALL.answerPollTimer) { clearInterval(CALL.answerPollTimer); CALL.answerPollTimer = null; }
    if (CALL.remoteEndTimer) { clearInterval(CALL.remoteEndTimer); CALL.remoteEndTimer = null; }
  }

  // ============================================
  // Duration timer
  // ============================================
  function startDurationTimer() {
    CALL.startedAt = Date.now();
    stopDurationTimer();
    CALL.durationTimer = setInterval(function () {
      var sec = Math.floor((Date.now() - CALL.startedAt) / 1000);
      setTimerText(fmtDuration(sec));
    }, 1000);
    setTimerText("0:00");
  }
  function stopDurationTimer() {
    if (CALL.durationTimer) {
      clearInterval(CALL.durationTimer);
      CALL.durationTimer = null;
    }
  }

  // ============================================
  // OUTGOING — start a call
  // ============================================
  function startCall(username, kind) {
    if (!username) return;
    if (CALL.active || CALL._starting) { toast("একটা কল চলছে"); return; }
    // S30.3 - synchronous lock prevents double-tap creating two calls
    CALL._starting = true;

    toast("কল করা হচ্ছে...");
    api("/api/calls/start", {
      method: "POST",
      body: JSON.stringify({ username: username, kind: kind }),
    }).then(function (res) {
      CALL._starting = false;
      CALL.active = {
        id: res.call_id,
        kind: res.kind,
        role: "caller",
        peerUsername: username,
        peer: res.callee,
      };

      ensureOverlay();
      setKind(res.kind);
      setAvatar(res.callee.display_name, res.callee.profile_pic);
      $("co-name").textContent = res.callee.display_name;
      setSub("রিং হচ্ছে", true);
      setVideoMode(res.kind);
      renderActions("outgoing", res.kind);
      $("co-cancel").onclick = function () { endCall("cancel"); };

      showOverlay();
      vib(30);

      // Get local media + create offer
      getLocalStream(res.kind).then(function (stream) {
        // Show local video preview if video call
        if (res.kind === "video") {
          $("co-video-wrap").classList.remove("hidden");
          var lv = $("co-video-local");
          if (lv) lv.srcObject = stream;
        }

        var pc = createPeer(res.call_id, true);
        attachLocalTracks(pc);

        return pc.createOffer().then(function (offer) {
          return pc.setLocalDescription(offer).then(function () {
            return api("/api/calls/" + res.call_id + "/offer", {
              method: "POST",
              body: JSON.stringify({ offer: offer.sdp }),
            });
          });
        });
      }).then(function () {
        // Wait for callee to accept
        startAnswerPolling(res.call_id);
        startIcePolling(res.call_id, true);
      }).catch(function (err) {
        console.error("[CALL] start failed:", err);
        toast("মিডিয়া চালু করা যায়নি: " + (err.message || ""));
        endCall("error");
      });
    }).catch(function (err) {
      CALL._starting = false;
      alert(err.message || "কল শুরু করা যায়নি");
    });
  }

  // ============================================
  // ACCEPT incoming call (callee)
  // ============================================
  function acceptIncoming(callId, fromUser, kind) {
    _cdlog("[ACCEPT] ▶ step 1 — start", { callId: callId, user: fromUser && fromUser.username, kind: kind });
    hideBanner();
    if (CALL.active || CALL._starting) { toast("একটা কল চলছে"); return; }
    CALL._starting = true;

    CALL._starting = false;
    CALL.active = {
      id: callId,
      kind: kind,
      role: "callee",
      peerUsername: fromUser.username,
      peer: fromUser,
    };

    ensureOverlay();
    setKind(kind);
    setAvatar(fromUser.display_name, fromUser.profile_pic);
    $("co-name").textContent = fromUser.display_name;
    setSub("সংযোগ হচ্ছে", true);
    setVideoMode(kind);
    renderActions("active", kind);
    var a = $("co-actions");
    if (a) a.innerHTML = '<button class="call-btn end" id="co-end"><i class="fa-solid fa-phone-slash"></i></button>';
    $("co-end").onclick = function () { endCall("hangup"); };
    showOverlay();
    vib([30, 40, 30]);

    _cdlog("[ACCEPT] ▶ step 2 — calling /answer accept");
    api("/api/calls/" + callId + "/answer", {
      method: "POST",
      body: JSON.stringify({ action: "accept" }),
    }).then(function (r) {
      _cdlog("[ACCEPT] ✔ step 2 done:", r);
      _cdlog("[ACCEPT] ▶ step 3 — getting mic");
      // Try mic; fallback to no-mic if it fails
      return getLocalStream(kind).then(
        function (stream) {
          _cdlog("[ACCEPT] ✔ step 3 mic ok — tracks:",
                      stream.getTracks().map(function (t) { return t.kind + ":" + t.readyState; }));
          return { stream: stream, hasMic: true };
        },
        function (err) {
          _cdwarn("[ACCEPT] ⚠ step 3 mic FAILED:", err && err.name, err && err.message);
          toast("মাইক পাওয়া যায়নি — শুধু শুনতে পারবেন");
          return { stream: null, hasMic: false };
        }
      );
    }).then(function (res) {
      if (res.stream && kind === "video") {
        $("co-video-wrap").classList.remove("hidden");
        var lv = $("co-video-local");
        if (lv) lv.srcObject = res.stream;
      }
      _cdlog("[ACCEPT] ▶ step 4 — fetching offer");
      return api("/api/calls/" + callId).then(function (c) {
        _cdlog("[ACCEPT] ✔ step 4 got call:", {
          status: c.status,
          hasOffer: !!(c.offer),
          offerLen: c.offer ? c.offer.length : 0,
        });
        return { c: c, stream: res.stream };
      });
    }).then(function (res) {
      var c = res.c;
      var stream = res.stream;
      if (!c.offer) throw new Error("offer missing on server (caller didn't upload)");

      _cdlog("[ACCEPT] ▶ step 5 — create peer + setRemote");
      var pc = createPeer(callId, false);
      if (stream) attachLocalTracks(pc);

      return pc.setRemoteDescription({ type: "offer", sdp: c.offer }).then(function () {
        _cdlog("[ACCEPT] ✔ step 5 remote set");
        _cdlog("[ACCEPT] ▶ step 6 — createAnswer");
        return pc.createAnswer();
      }).then(function (answer) {
        _cdlog("[ACCEPT] ✔ step 6 answer ready, sdp len:", answer.sdp.length);
        return pc.setLocalDescription(answer).then(function () {
          _cdlog("[ACCEPT] ▶ step 7 — posting answer-sdp");
          return api("/api/calls/" + callId + "/answer-sdp", {
            method: "POST",
            body: JSON.stringify({ answer: answer.sdp }),
          });
        });
      });
    }).then(function () {
      _cdlog("[ACCEPT] ✔ step 7 done — entering active mode");
      setSub("", false);
      setKind(kind);
      renderActions("active", kind);
      wireActiveButtons();
      startDurationTimer();
      startIcePolling(callId, false);
      startRemoteEndWatch(callId);
      _cdlog("[ACCEPT] ✅ fully connected");
    }).catch(function (err) {
      console.error("[ACCEPT] ❌ FAILED at some step:", err);
      console.error("[ACCEPT] ❌ error name:", err && err.name, "| message:", err && err.message);
      toast("কল গ্রহণ ব্যর্থ: " + (err && err.message ? err.message : "অজানা সমস্যা"));
      endCall("error");
    });
  }

  // ============================================
  // Wire active buttons
  // ============================================
  function wireActiveButtons() {
    var m = $("co-mute");
    if (m) m.onclick = function () {
      CALL.muted = !CALL.muted;
      if (CALL.localStream) {
        CALL.localStream.getAudioTracks().forEach(function (t) { t.enabled = !CALL.muted; });
      }
      m.classList.toggle("muted", CALL.muted);
      var i = m.querySelector("i");
      if (i) i.className = CALL.muted ? "fa-solid fa-microphone-slash" : "fa-solid fa-microphone";
    };

    var c = $("co-cam");
    if (c) c.onclick = function () {
      CALL.cameraOff = !CALL.cameraOff;
      if (CALL.localStream) {
        CALL.localStream.getVideoTracks().forEach(function (t) { t.enabled = !CALL.cameraOff; });
      }
      c.classList.toggle("muted", CALL.cameraOff);
      var i = c.querySelector("i");
      if (i) i.className = CALL.cameraOff ? "fa-solid fa-video-slash" : "fa-solid fa-video";
    };

    var spk = $("co-spk");
    if (spk) spk.onclick = function () {
      CALL.speakerOn = !CALL.speakerOn;
      spk.classList.toggle("active", !CALL.speakerOn);
      var i = spk.querySelector("i");
      if (i) i.className = CALL.speakerOn ? "fa-solid fa-volume-high" : "fa-solid fa-volume-xmark";

      // S30.10 - actually apply: mute remote audio element (visual consistent with button)
      var remote = $("co-video-remote");
      if (remote) remote.muted = !CALL.speakerOn;
      // also toggle for audio-only calls (no video element, but WebAudio attached elsewhere)
      try {
        if (CALL._remoteAudioEl) CALL._remoteAudioEl.muted = !CALL.speakerOn;
      } catch (e) {}
    };

    var end = $("co-end");
    if (end) end.onclick = function () { endCall("hangup"); };

    var sw = $("co-switch");
    if (sw) sw.onclick = async function () {
      // S30.10 - real camera flip
      if (!CALL.localStream) return;
      var vt = CALL.localStream.getVideoTracks();
      if (!vt.length) { toast("শুধু ভিডিও কলে"); return; }

      // toggle facingMode and re-getUserMedia for the video track
      var newMode = CALL._facing === "user" ? "environment" : "user";
      var oldTrack = vt[0];
      try {
        sw.disabled = true;
        var newStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: newMode, width: { ideal: 720 }, height: { ideal: 1280 } }
        });
        var newVid = newStream.getVideoTracks()[0];
        if (!newVid) throw new Error("no video track");

        // swap track on all peer senders
        if (CALL.pc) {
          var senders = CALL.pc.getSenders();
          for (var i = 0; i < senders.length; i++) {
            if (senders[i].track && senders[i].track.kind === "video") {
              try { await senders[i].replaceTrack(newVid); } catch (e) {}
            }
          }
        }
        // stop old track + remove from localStream
        try { oldTrack.stop(); } catch (e) {}
        try { CALL.localStream.removeTrack(oldTrack); } catch (e) {}
        CALL.localStream.addTrack(newVid);

        // update preview video element
        var lv = $("co-video-local");
        if (lv) lv.srcObject = CALL.localStream;

        CALL._facing = newMode;
        if (navigator.vibrate) navigator.vibrate(10);
      } catch (err) {
        _cdwarn("[CALL] switch camera failed:", err);
        toast("ক্যামেরা সুইচ ব্যর্থ");
      } finally {
        sw.disabled = false;
      }
    };
  }

  // ============================================
  // Watch for remote hangup (both sides)
  // ============================================
  function startRemoteEndWatch(callId) {
    // S30.8 - no-op; unified ticker handles remote-end detection
  }

  function stopRemoteEndWatch() {
    // S30.8 - unified ticker clears everything
    if (typeof _stopCallTicker === "function") _stopCallTicker();
    if (CALL.icePollTimer) { clearInterval(CALL.icePollTimer); CALL.icePollTimer = null; }
    if (CALL.answerPollTimer) { clearInterval(CALL.answerPollTimer); CALL.answerPollTimer = null; }
    if (CALL.remoteEndTimer) { clearInterval(CALL.remoteEndTimer); CALL.remoteEndTimer = null; }
  }

  // ============================================
  // END call (I'm ending)
  // ============================================
  function endCall(reason) {
    var id = CALL.active && CALL.active.id;
    if (id) {
      api("/api/calls/" + id + "/end", {
        method: "POST",
        body: JSON.stringify({ reason: reason || "hangup" }),
      }).catch(function () {});
    }
    cleanup(false);
  }

  function cleanup(silent) {
    _endSyncSent = false;
    CALL._starting = false;
    // S30.10 - clear connection watchdog
    if (CALL._discTimer) { clearTimeout(CALL._discTimer); CALL._discTimer = null; }
    CALL._connFailed = false;
    // S30.3 - reset remote stream (was: old tracks accumulated across calls)
    CALL.remoteStream = null;
    CALL._cc = 0;
    CALL._cr = 0;
    try { if (CALL.pc) CALL.pc.close(); } catch (e) {}
    CALL.pc = null;
    stopLocalStream();
    stopIcePolling();
    stopAnswerPolling();
    stopDurationTimer();
    stopRemoteEndWatch();

    var remote = $("co-video-remote");
    if (remote) remote.srcObject = null;
    if (CALL._remoteAudioEl) {
      try { CALL._remoteAudioEl.pause(); CALL._remoteAudioEl.srcObject = null; CALL._remoteAudioEl.remove(); } catch (e) {}
      CALL._remoteAudioEl = null;
    }
    var local = $("co-video-local");
    if (local) local.srcObject = null;
    var vw = $("co-video-wrap");
    if (vw) vw.classList.add("hidden");

    CALL.active = null;
    CALL.muted = false;
    CALL.cameraOff = false;
    CALL._facing = "user";
    var ov = $("call-overlay");
    if (ov) ov.classList.remove("video-mode");

    hideOverlay();
    if (!silent) vib(20);
  }

  // ============================================
  // Incoming call banner
  // ============================================
  function showBanner(call, caller) {
    ensureBanner();
    var b = $("call-mini-banner");
    if (!b) return;
    CALL.bannerCallId = call.id;

    var avatar = caller && caller.profile_pic
      ? '<img src="' + esc(caller.profile_pic) + '" alt="">'
      : esc((caller && caller.display_name || "?").charAt(0).toUpperCase());

    b.innerHTML =
      '<div class="call-mini-avatar">' + avatar + '</div>' +
      '<div class="call-mini-info">' +
        '<div class="call-mini-name">' + esc(caller ? caller.display_name : "Unknown") + '</div>' +
        '<div class="call-mini-sub">' + (call.kind === "video" ? "ভিডিও কল আসছে" : "অডিও কল আসছে") + '</div>' +
      '</div>' +
      '<button class="call-mini-btn decline" id="cb-decline"><i class="fa-solid fa-phone-slash"></i></button>' +
      '<button class="call-mini-btn accept" id="cb-accept"><i class="fa-solid fa-phone"></i></button>';

    b.classList.remove("hidden");
    vib([100, 60, 100, 60, 100]);

    $("cb-accept").onclick = function () { acceptIncoming(call.id, caller, call.kind); };
    $("cb-decline").onclick = function () {
      api("/api/calls/" + call.id + "/answer", {
        method: "POST",
        body: JSON.stringify({ action: "decline" }),
      }).catch(function () {});
      hideBanner();
    };
  }

  function hideBanner() {
    var b = $("call-mini-banner");
    if (b) b.classList.add("hidden");
    CALL.bannerCallId = null;
  }

  // ============================================
  // Polling loop — runs app-wide
  // ============================================
  function startPolling() {
    // S22 batch — clear previous timer first (prevents duplicates)
    if (CALL.pollTimer) {
      clearInterval(CALL.pollTimer);
      clearTimeout(CALL.pollTimer);
      CALL.pollTimer = null;
    }
    _cdlog("[CALL] startPolling called");
    // S30.11 - adaptive interval: 3.5s foreground, 12s background
    // (was: always 3.5s even when tab hidden → wasted server load)
    CALL.pollTimer = setInterval(function () {
      // Series 4B fix — poll even when tab is hidden (multi-tab testing)
      if (!_getMe()) return;
      if (CALL.active) return; // in call → separate polling handles it

      api("/api/calls/poll").then(function (d) {
        // Series 4B debug logging
        if (d.incoming) {
          _cdlog("[CALL POLL] incoming found:", d.incoming, d.incoming_caller);
        }
        // Incoming call?
        if (d.incoming && d.incoming_caller) {
          if (CALL.seenCallIds[d.incoming.id]) return;
          CALL.seenCallIds[d.incoming.id] = true;
          showBanner(d.incoming, d.incoming_caller);
        } else {
          hideBanner();
        }
      }).catch(function (e) { _cdlog("[CALL POLL] error:", e); });
    }, 3500); // (legacy — replaced by recursive setTimeout above) */
    /* end legacy */
  }

  // ============================================
  // Public API — wire from chat header
  // ============================================
  // Debug exposure
  window.CALL_DEBUG = CALL;
  window.callStatus = function () {
    if (!CALL.active) { _cdlog("[CALL DEBUG] no active call"); return; }
    var id = CALL.active.id;
    _cdlog("[CALL DEBUG] id =", id, "| role =", CALL.active.role, "| kind =", CALL.active.kind);
    api("/api/calls/" + id).then(function (c) {
      _cdlog("[CALL DEBUG] server status:", c.status);
      _cdlog("[CALL DEBUG] caller_last_seen:", c.caller_last_seen);
      _cdlog("[CALL DEBUG] callee_last_seen:", c.callee_last_seen);
      _cdlog("[CALL DEBUG] end_reason:", c.end_reason);
      return c;
    });
  };

  window.callStartPolling = function () {
    _cdlog("[CALL] manual start requested");
    startPolling();
    return "ok";
  };
  // Series 4D — end the call synchronously when the tab unloads/refreshes
  function endCallSync(reason) {
    if (_endSyncSent) return;
    if (!CALL.active || !CALL.active.id) return;
    _endSyncSent = true;
    var id = CALL.active.id;
    var token = "";
    try {
      var m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
      token = m ? decodeURIComponent(m[1]) : "";
    } catch (e) {}
    // S30.1 - keepalive fetch survives page dismissal
    try {
      var baseUrl = (typeof BASE_URL === "string") ? BASE_URL : "";
      fetch(baseUrl + "/api/calls/" + id + "/end", {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token
        },
        body: JSON.stringify({ reason: reason || "refresh" })
      }).catch(function(){});
      _cdlog("[CALL] endCallSync sent for", id);
    } catch (e) {
      _cdwarn("[CALL] endCallSync failed:", e);
    }
  }

  // S30.11 - visibilitychange → immediate poll for incoming calls
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && CALL.pollTimer && !CALL.active) {
      // fire an immediate poll (don't wait for the 12s)
      try { startPolling(); } catch (e) {}
    }
  });

  // S29.3 - visibilitychange handler REMOVED.
  // Previously this ended the call whenever the tab became hidden
  // (user switched apps/tabs, locked the screen, etc.), which broke
  // long calls. Real "page is going away" is now handled by
  // pagehide (mobile) + beforeunload (desktop) below.

  window.addEventListener("beforeunload", function () {
    endCallSync("unload");
  });
  window.addEventListener("pagehide", function (e) {
    if (e && e.persisted) return;
    endCallSync("pagehide");
  });
  // S29.3 - removed redundant 'unload' handler.
  // beforeunload + pagehide already cover every real unload scenario.

  window.startVoiceCall = function (username) { startCall(username, "audio"); };

  // Series 4B — manual debug helper (type callDebug() in console)
  window.callDebug = function () {
    _cdlog("[CALL DEBUG] me =", _getMe());
    return api("/api/calls/poll").then(function (d) {
      _cdlog("[CALL DEBUG] poll =", d);
      return d;
    });
  };
  window.callForceShowBanner = function () {
    return api("/api/calls/poll").then(function (d) {
      if (d.incoming && d.incoming_caller) {
        _cdlog("[CALL DEBUG] forcing banner");
        showBanner(d.incoming, d.incoming_caller);
      } else {
        _cdlog("[CALL DEBUG] no incoming to show");
      }
      return d;
    });
  };
  _cdlog("[CALL] debug helpers ready: callDebug(), callForceShowBanner()");
  window.startVideoCall = function (username) { startCall(username, "video"); };

  // ============================================
  // Boot
  // ============================================
  function boot() {
    ensureOverlay();
    ensureBanner();

    // Hook into enterApp — start polling only when logged in
    if (typeof window._enterAppHooks !== "undefined" && Array.isArray(window._enterAppHooks)) {
      window._enterAppHooks.push(function () { startPolling(); });
    } else {
      // Retry a bit later
      var tries = 0;
      var t = setInterval(function () {
        tries++;
        if (typeof window._enterAppHooks !== "undefined" && Array.isArray(window._enterAppHooks)) {
          window._enterAppHooks.push(function () { startPolling(); });
          clearInterval(t);
        } else if (tries > 20) {
          clearInterval(t);
          startPolling();
        }
      }, 250);
    }
    _cdlog("[CALL] module ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
