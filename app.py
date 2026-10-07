from flask import Flask, request, jsonify, session, render_template, redirect
import sqlite3, subprocess, secrets, hashlib, os, re

# S22 / Series 10.6 — load .env file (local dev convenience)
try:
    from dotenv import load_dotenv
    _dotenv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(_dotenv_path):
        load_dotenv(_dotenv_path, override=True)
        print(f"[JUKTOY] .env loaded from {_dotenv_path}")
    else:
        print(f"[JUKTOY] no .env at {_dotenv_path} — using shell env")
except ImportError:
    print("[JUKTOY] python-dotenv not installed — using shell env")
except Exception as _e:
    print(f"[JUKTOY] .env load failed: {_e}")  # Render uses env vars directly — .env not needed there

# S22 / Series 10.5 — flask-cors optional (same-origin web needs no CORS)
try:
    from flask_cors import CORS
    _HAS_CORS = True
except ImportError:
    _HAS_CORS = False
    print("[JUKTOY] flask-cors not installed — CORS skipped (OK for same-origin)")
import html as _html  # S16.7 — HTML escape

# ============================================
# S13-C / S15.7 — HTTP client + JSON + URL parse
# (used by HIBP breach check + Google OAuth)
# ============================================
import urllib.request as _ureq
import urllib.parse   as _uparse
import json           as _json
import time
import threading
from collections import defaultdict, deque
from functools import wraps

app = Flask(__name__)
if _HAS_CORS:
    CORS(app, supports_credentials=True, origins=[
        "https://juktoy.onrender.com",
        "capacitor://localhost",
        "http://localhost",
        "https://localhost"
    ])
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ============================================
# S22 (Series 5) — ADMIN SECURITY CONFIG
# ============================================
# The admin username is now configurable via env var.
# Default falls back to legacy hardcoded value for compatibility.
ADMIN_USERNAME = (os.environ.get("JUKTOY_ADMIN_USERNAME") or "").strip().lower()
# Register key — required to create the admin account (see register()).
# Set in Render env: JUKTOY_ADMIN_KEY=<long random string>
ADMIN_KEY = os.environ.get("JUKTOY_ADMIN_KEY") or ""
# S22 / Series 11 — auto-bootstrap admin on startup (env-var password)
ADMIN_PASSWORD = os.environ.get("JUKTOY_ADMIN_PASSWORD") or ""
# Search/privacy flags
ADMIN_HIDDEN_FROM_SEARCH = True
# If True: admin must enable 2FA before accessing /api/admin/*
ADMIN_2FA_ENFORCED = True

# S9 — preferred locations (outside project directory):
#   1. JUKTOY_SECRET_KEY env var (production)
#   2. ~/.juktoy_secret_key  (home dir)
#   3. legacy: BASE_DIR/.secret_key  (auto-migrate)
HOME_SECRET_FILE = os.path.expanduser("~/.juktoy_secret_key")
LEGACY_SECRET_FILE = os.path.join(BASE_DIR, ".secret_key")


def _load_secret_key():
    # 1. Env var (highest priority)
    env_key = os.environ.get("JUKTOY_SECRET_KEY")
    if env_key and len(env_key) >= 32:
        return env_key

    # 2. Home dir
    try:
        if os.path.exists(HOME_SECRET_FILE):
            with open(HOME_SECRET_FILE, "r", encoding="utf-8") as f:
                key = f.read().strip()
            if key and len(key) >= 32:
                return key
    except OSError:
        pass

    # 3. Legacy project file — read then migrate to home
    legacy_key = None
    try:
        if os.path.exists(LEGACY_SECRET_FILE):
            with open(LEGACY_SECRET_FILE, "r", encoding="utf-8") as f:
                legacy_key = f.read().strip()
    except OSError:
        legacy_key = None

    key = legacy_key if (legacy_key and len(legacy_key) >= 32) else secrets.token_hex(32)

    # Save to home dir
    try:
        with open(HOME_SECRET_FILE, "w", encoding="utf-8") as f:
            f.write(key)
        try:
            os.chmod(HOME_SECRET_FILE, 0o600)
        except OSError:
            pass
    except OSError:
        pass

    # Remove legacy copy if we migrated successfully
    if legacy_key and os.path.exists(HOME_SECRET_FILE):
        try:
            os.remove(LEGACY_SECRET_FILE)
            print("[JUKTOY] Secret key migrated to ~/.juktoy_secret_key (legacy removed)")
        except OSError:
            pass

    return key


app.secret_key = _load_secret_key()


# ============================================================
# S22 / Series 26 — auto-close request-scoped DB connection
# ============================================================
@app.teardown_appcontext
def _close_db_on_teardown(exc):
    """S22 / Series 26 (fixed) — close all DB connections opened during
    this request. Iterates g._juktoy_conns (registered by db()).
    Idempotent — already-closed connections are safely skipped.
    """
    try:
        from flask import g
        conns = getattr(g, "_juktoy_conns", None) or []
        for c in conns:
            try:
                c.close()
            except Exception:
                pass
        try:
            g._juktoy_conns = []
        except Exception:
            pass
    except Exception:
        pass

# ============================================
# SESSION / SECURITY CONFIG
# ============================================

from datetime import timedelta as _td
import os as _os

# ============================================
# HTTPS / SECURE COOKIE CONFIG (S7)
# ============================================

from werkzeug.middleware.proxy_fix import ProxyFix
# S22 / Series 28 — trust TWO proxy hops for X-Forwarded-For.
# Render's stack has 2 layers (LB + internal router), each adding one
# XFF entry. With x_for=1, ProxyFix stops at Render's internal IP
# (10.x.x.x) which rotates on every request → session fingerprint
# mismatch → non-stop logouts. x_for=2 makes ProxyFix skip both
# internal IPs and expose the REAL client IP from XFF.
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_for=3)

# ============================================================
# S22 / Series 19 — trusted client IP helper
# ============================================================
# ProxyFix (x_for=1) already rewrites request.remote_addr to the
# real client IP using the rightmost untrusted hop. Reading
# X-Forwarded-For directly is unsafe — that header is fully
# attacker-controlled and bypasses rate limits + IP binding.
def _client_ip():
    """Return trusted client IP (real remote_addr after ProxyFix)."""
    return request.remote_addr or "0.0.0.0"

_env_https = _os.environ.get("JUKTOY_HTTPS")
_env_name = _os.environ.get("JUKTOY_ENV") or _os.environ.get("FLASK_ENV") or ""

if _env_https == "1":
    _secure_flag = True
elif _env_https == "0":
    _secure_flag = False
elif _env_name.lower() == "production":
    # Auto-on in production
    _secure_flag = True
else:
    # Default for local dev
    _secure_flag = False

SESSION_MAX_AGE_DAYS = 30
ABSOLUTE_MAX_AGE_SECONDS = SESSION_MAX_AGE_DAYS * 24 * 3600
# S16.5 — idle timeout (2 hours). Session dies if no API call within window.
SESSION_IDLE_SECONDS = 2 * 3600

# S30.32 — SameSite/Secure align with actual HTTPS state
#   HTTPS → SameSite=None + Secure (works with cookies for cross-site)
#   HTTP  → SameSite=Lax + not Secure (browser accepts the cookie)
_ss = "None" if _secure_flag else "Lax"
app.config.update(
    SESSION_COOKIE_NAME="juktoy_session",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE=_ss,
    SESSION_COOKIE_SECURE=_secure_flag,
    SESSION_COOKIE_PATH="/",
    SESSION_REFRESH_EACH_REQUEST=True,
    PERMANENT_SESSION_LIFETIME=_td(days=SESSION_MAX_AGE_DAYS),
    MAX_CONTENT_LENGTH=40 * 1024 * 1024,
)
print(f"[JUKTOY] cookie mode: SameSite={_ss}, Secure={_secure_flag}")

# Log once on startup
print(f"[JUKTOY] HTTPS mode: {'ON' if _secure_flag else 'OFF'} "
      f"(set JUKTOY_HTTPS=1 to force)")


# ============================================
# HTTPS ENFORCEMENT + SECURITY HEADERS (S10)
# ============================================

def _is_localhost_request():
    """S10 + S29.17 - IPv6-safe hostname extraction.

    Previously we did request.host.split(":")[0], which correctly
    extracts the hostname for "localhost:5000" and "127.0.0.1:8000"
    but returns "[" for the bracketed IPv6 form "[::1]:5000". That
    broke the localhost exemption and could trigger an HTTP->HTTPS
    redirect loop on IPv6 dev environments.

    Now: parse the host properly, handling the bracketed IPv6 case.
    """
    raw = (request.host or "").strip().lower()
    if raw.startswith("["):
        # bracketed IPv6 like [::1]:5000
        end = raw.find("]")
        host = raw[1:end] if end != -1 else raw
    else:
        # IPv4 or hostname — colon separates port
        host = raw.split(":", 1)[0]
    return host in (
        "localhost", "127.0.0.1", "::1", "0.0.0.0",
        "10.0.2.2", "10.0.3.2"
    )


@app.before_request
def _enforce_https():
    """S10 — redirect HTTP → HTTPS in production. Skip localhost + health endpoints."""
    if not _secure_flag:
        return None
    if request.path in ("/healthz", "/health", "/ping"):
        return None
    if _is_localhost_request():
        return None
    if not request.is_secure:
        url = request.url.replace("http://", "https://", 1)
        return redirect(url, code=301)
    return None


@app.after_request
def _add_security_headers(response):
    """S10 + S11 — security headers + HSTS + CSP."""
    if _secure_flag and request.is_secure:
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains; preload"
        )
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    # Allow mic + camera on our own origin (self).
    # Still block geolocation and payment features.
    response.headers.setdefault(
        "Permissions-Policy",
        "geolocation=(), microphone=(self), camera=(self), payment=()"
    )
    # S16.7 — additional hardening headers
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
    response.headers.setdefault("X-Permitted-Cross-Domain-Policies", "none")

    # Performance: cache static files aggressively (they use ?v= versioning)
    if request.path.startswith("/static/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"

    # S11 — CSP report-only (safe: doesn't break anything, logs violations)
    if not response.headers.get("Content-Security-Policy-Report-Only"):
        csp = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' "
            "https://cdnjs.cloudflare.com; "
            "style-src 'self' 'unsafe-inline' "
            "https://fonts.googleapis.com https://cdnjs.cloudflare.com; "
            "font-src 'self' data: https://fonts.gstatic.com "
            "https://cdnjs.cloudflare.com; "
            "img-src 'self' data: blob: https:; "
            "media-src 'self' data: blob:; "
            "connect-src 'self'; "
            "frame-ancestors 'self'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        response.headers["Content-Security-Policy-Report-Only"] = csp
    return response


@app.route("/healthz")
def healthz():
    """S10 — plain HTTP health check for load balancers."""
    return jsonify({"ok": True}), 200
DB = os.path.join(BASE_DIR, "social.db")
SECURITY_BIN = os.path.join(BASE_DIR, "security")


# ============================================
# TOTP 2FA (S12) — pure Python, no deps
# ============================================

import base64 as _b64
import hmac as _hmac
import struct as _struct

_TOTP_STEP = 30
_TOTP_DIGITS = 6


def _gen_totp_secret():
    """Generate 20-byte base32 secret (RFC 6238 recommended)."""
    raw = secrets.token_bytes(20)
    return _b64.b32encode(raw).decode().rstrip("=")


def _totp_at(secret_b32, timestamp):
    """Compute 6-digit TOTP code at given unix time."""
    pad = (8 - len(secret_b32) % 8) % 8
    key = _b64.b32decode(secret_b32 + "=" * pad)
    counter = int(timestamp // _TOTP_STEP)
    msg = _struct.pack(">Q", counter)
    h = _hmac.new(key, msg, "sha1").digest()
    offset = h[-1] & 0x0F
    code = (
        ((h[offset] & 0x7F) << 24)
        | (h[offset + 1] << 16)
        | (h[offset + 2] << 8)
        | h[offset + 3]
    ) % (10 ** _TOTP_DIGITS)
    return str(code).zfill(_TOTP_DIGITS)


def _verify_totp(secret_b32, code, window=1):
    """Verify code allowing ±1 step (30s each) clock skew."""
    if not secret_b32 or not code:
        return False
    code = str(code).strip().replace(" ", "")
    if not code.isdigit() or len(code) != _TOTP_DIGITS:
        return False
    now = time.time()
    for offset in range(-window, window + 1):
        if _hmac.compare_digest(_totp_at(secret_b32, now + offset * _TOTP_STEP), code):
            return True
    return False


def _generate_recovery_code():
    """S22 / Series 27B — permanent recovery code.

    Format: JKT-RCV-XXXX-XXXX-XXXX-XXXX (Crockford base32, no 0/O/1/I/L)
    This is a ONE-TIME-PERMANENT code — survives backup code regeneration.
    Only regenerating the recovery code invalidates it.
    """
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # 31 chars
    groups = []
    for _ in range(4):
        groups.append("".join(secrets.choice(alphabet) for _ in range(4)))
    plain = "JKT-RCV-" + "-".join(groups)
    # Hash with scrypt (same as backup codes — strong)
    hashed = make_password_hash(plain)
    return plain, hashed


def _verify_recovery_code(stored_hash, code):
    """S22 / Series 27B — verify recovery code (case + separator tolerant)."""
    if not stored_hash or not code:
        return False
    # Normalize: uppercase, remove non-alphanumeric, keep JKT + 16 chars
    raw = str(code).upper().strip()
    cleaned = "".join(c for c in raw if c.isalnum())
    # Expected: JKTRCV + 16 chars = 22 alphanumeric
    if not cleaned.startswith("JKTRCV") or len(cleaned) != 22:
        return False
    # Reformat into canonical: JKT-RCV-XXXX-XXXX-XXXX-XXXX
    body = cleaned[6:]
    canonical = "JKT-RCV-" + "-".join(body[i:i+4] for i in range(0, 16, 4))
    try:
        return _verify_secure_hash(canonical, stored_hash)
    except Exception:
        return False


def _generate_backup_codes(n=10):
    """S16.4 — generate 2FA backup codes hashed with scrypt.

    Why scrypt instead of SHA-256:
      Backup code format is XXXXX-XXXXX (10 chars from 32-char alphabet).
      That's ~32^10 = 10^15 combinations. A single modern GPU can brute
      SHA-256 at ~10 billion/sec -> entire set recovered in ~30 hours.
      scrypt is memory-hard and takes ~300ms per hash on CPU -> brute
      force becomes astronomically expensive (~10^7 years).
    """
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0,1,I,O
    plain = []
    for _ in range(n):
        a = "".join(secrets.choice(alphabet) for _ in range(5))
        b = "".join(secrets.choice(alphabet) for _ in range(5))
        plain.append(f"{a}-{b}")
    hashed = ",".join(make_password_hash(c) for c in plain)
    return plain, hashed


def _verify_backup_code(stored_csv, code):
    """S16.4 — verify 2FA backup code; returns (matched, new_csv).

    Supports both:
      - scrypt hash (new, S16.4+)
      - SHA-256 hash (legacy, pre-S16.4)

    On match, the used code is removed (one-time use).
    Worst-case runs N scrypt verifications (~300ms each) -> ~3s.
    Acceptable: 2FA attempts are rate-limited (5 tries per token).
    """
    if not stored_csv:
        return False, stored_csv
    code = (code or "").strip().upper().replace(" ", "")
    codes = [c for c in stored_csv.split(",") if c]

    # S29.16 - constant-time iteration.
    # Previously we returned on the first matching index, so a code
    # stored at position 0 verified ~300ms faster than one at position 9
    # (each scrypt compare is ~30ms). That leaked the user's remaining
    # backup-code COUNT via response time. Now: always verify against
    # every stored hash (no early break) and record the match index.
    # One scrypt per code, always the same number of iterations
    # regardless of where the match sits.
    matched_idx = -1
    for i, stored in enumerate(codes):
        if not stored:
            continue
        ok = False
        if stored.startswith("scrypt$") or stored.startswith("pbkdf2$"):
            try:
                ok = _verify_secure_hash(code, stored)
            except Exception:
                ok = False
        else:
            # legacy SHA-256 hash (pre-S16.4)
            try:
                legacy_h = hashlib.sha256(code.encode()).hexdigest()
                ok = secrets.compare_digest(legacy_h, stored)
            except Exception:
                ok = False
        if ok and matched_idx == -1:
            matched_idx = i
    if matched_idx >= 0:
        codes.pop(matched_idx)
        return True, ",".join(codes)
    return False, stored_csv


# Pending 2FA sessions (in-memory) — token → {uid, ver, expires}
_pending_2fa = {}
_pending_2fa_lock = threading.Lock()
_PENDING_2FA_TTL = 300  # 5 minutes


def _pending_2fa_create(uid, ver, method="totp", code_hash=None):
    """S22 / Series 27B-4 — supports both TOTP and email-2FA methods."""
    token = secrets.token_urlsafe(32)
    with _pending_2fa_lock:
        now = time.time()
        for k in list(_pending_2fa.keys()):
            if _pending_2fa[k]["expires"] < now:
                del _pending_2fa[k]
        _pending_2fa[token] = {
            "uid": uid,
            "ver": ver,
            "method": method,
            "code_hash": code_hash,
            "expires": now + _PENDING_2FA_TTL,
        }
    return token


def _pending_2fa_get(token):
    with _pending_2fa_lock:
        rec = _pending_2fa.get(token)
        if not rec:
            return None
        if rec["expires"] < time.time():
            del _pending_2fa[token]
            return None
        return rec


def _pending_2fa_consume(token):
    with _pending_2fa_lock:
        return _pending_2fa.pop(token, None)


# ============================================
# CSRF PROTECTION (S3)
# ============================================

# S30.32 — derive from env (_secure_flag); was hardcoded True → HTTP broke
_HTTPS_ONLY = _secure_flag


@app.before_request
def _ensure_csrf_token():
    """Make sure the session has a CSRF token."""
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)


@app.after_request
def _set_csrf_cookie(response):
    """Sync readable CSRF cookie with session token."""
    token = session.get("csrf_token")
    if not token:
        return response
    existing = request.cookies.get("csrf_token")
    if existing != token:
        response.set_cookie(
            "csrf_token",
            token,
            httponly=False,        # JS must be able to read it
            samesite=("None" if _HTTPS_ONLY else "Lax"),   # S30.32
            secure=_HTTPS_ONLY,
            max_age=30 * 24 * 3600,
            path="/",
        )
    return response


@app.before_request
def _session_version_check():
    """S6+S7+S14+S16.5 — session version, expiry, ban, idle check.

    S30.16 — hot-path throttling:
      Previously ran 4 DB queries on EVERY /api/* request
      (ban check + touch_session + last_seen update + version check).
      Now each sub-check is throttled with a session-stored timestamp:
        • ban check     → every 90s
        • touch_session → every 60s
        • version check → every 120s
        • fingerprint   → every 60s
      Net: ~0-1 DB queries on most requests, up to 4 on the boundary.
      Session revocation still works within 60-120s (acceptable).
    """
    uid = session.get("user_id")
    if not uid:
        return None
    stored = session.get("session_version")
    if stored is None:
        session.clear()
        return None

    now_ts = time.time()

    # S7 — absolute expiry (cheap, no DB)
    started = session.get("session_start", 0)
    if started and (now_ts - started) > ABSOLUTE_MAX_AGE_SECONDS:
        session.clear()
        return None

    # Only /api/* routes do the heavy checks
    if not request.path.startswith("/api/"):
        return None

    # S16.5 — idle timeout (2 hours) — cheap, no DB
    last_active = session.get("last_active", 0)
    if last_active and (now_ts - last_active) > SESSION_IDLE_SECONDS:
        session.clear()
        return jsonify({
            "error": "নিষ্ক্রিয়তার কারণে সেশন বন্ধ হয়ে গেছে। আবার লগইন করুন।",
            "idle_timeout": True,
        }), 401
    session["last_active"] = now_ts

    # ─── S14 — ban check (throttled 90s) ───
    # S30.21 — ban check every 15s (was 90s): banned user feels kicked fast
    # but still cheaper than per-request. Sessions are also deleted on ban,
    # so the touch_session check (60s) will catch it independently.
    if now_ts - session.get("_last_ban_check", 0) > 15:
        banned, until, reason = _is_banned(uid)
        session["_last_ban_check"] = now_ts
        if banned:
            session.clear()
            return jsonify({
                "error": f"আপনার অ্যাকাউন্ট স্থগিত করা হয়েছে। কারণ: {reason or 'নীতিমালা লঙ্ঘন'}",
                "banned_until": until,
                "ban_reason": reason,
            }), 403

    # ─── S15.2 — session fingerprint (throttled 60s) ───
    if now_ts - session.get("_last_fp_check", 0) > 60:
        ok, reason = _session_fp_ok()
        session["_last_fp_check"] = now_ts
        if not ok:
            session.clear()
            return jsonify({"error": reason}), 401

    # ─── S15.4 — touch session (throttled 60s) ───
    if now_ts - session.get("_last_touch", 0) > 60:
        if not _touch_session(uid):
            session.clear()
            return jsonify({"error": "আপনার সেশন বাতিল করা হয়েছে। আবার লগইন করুন।"}), 401
        session["_last_touch"] = now_ts

        # S18.9b — update users.last_seen (piggybacked on touch, no extra query if skip)
        try:
            _conn = db()
            _conn.execute("UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=?", (uid,))
            _conn.commit()
            _conn.close()
        except Exception:
            pass
        session["_last_ping"] = now_ts

    # ─── S6 — session version check (throttled 120s) ───
    if now_ts - session.get("_last_ver_check", 0) > 120:
        conn = db()
        row = conn.execute(
            "SELECT COALESCE(session_version, 0) AS v FROM users WHERE id=?",
            (uid,)
        ).fetchone()
        conn.close()
        session["_last_ver_check"] = now_ts
        if not row:
            session.clear()
            return None
        if row["v"] != stored:
            session.clear()
            return None

    return None
@app.before_request
def _csrf_check():
    """Validate CSRF token for all mutating API requests."""
    origin = request.headers.get("Origin", "")
    if origin.startswith("capacitor://") or origin in ("http://localhost", "https://localhost"):
        return None
    # S30.32 — if we're not in HTTPS mode, skip origin check for same-host HTTP
    # (CSRF token + SameSite=Lax still protect against cross-origin)
    if not _secure_flag and origin and origin.startswith("http://"):
        try:
            from urllib.parse import urlparse as _up
            if _up(origin).hostname == request.host.split(":")[0]:
                return None
        except Exception:
            pass
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return None
    if not request.path.startswith("/api/"):
        return None
    header = request.headers.get("X-CSRF-Token", "")
    token = session.get("csrf_token", "")
    if not header or not token or not secrets.compare_digest(header, token):
        return jsonify({"error": "নিরাপত্তা টোকেন সঠিক নয়। পেজ রিফ্রেশ করুন।"}), 403
    return None

# ============================================
# DATABASE
# ============================================

def _ensure_performance_indexes():
    """S39 Phase 2A — performance indexes for common queries.

    Idempotent (uses IF NOT EXISTS). Safe to call on every startup.
    Each index targets a specific query pattern:
      - idx_posts_user_created      → profile posts list
      - idx_reactions_post          → post like count
      - idx_reactions_user_post     → user's reactions lookup
      - idx_comments_post           → post comments load
      - idx_comments_parent         → comment replies
      - idx_messages_thread         → chat history fetch
      - idx_messages_receiver_unread→ unread badge count
      - idx_follows_follower        → "who I follow" list
      - idx_follows_following       → "who follows me" list
      - idx_notifications_user_read → notification bell + list
      - idx_saves_user              → bookmarks page
      - idx_post_media_post         → post media fetch
      - idx_stories_user_created    → active stories lookup
    """
    indexes = [
        ("idx_posts_user_created",
         "CREATE INDEX IF NOT EXISTS idx_posts_user_created "
         "ON posts(user_id, created_at DESC)"),
        ("idx_reactions_post",
         "CREATE INDEX IF NOT EXISTS idx_reactions_post "
         "ON reactions(post_id)"),
        ("idx_reactions_user_post",
         "CREATE INDEX IF NOT EXISTS idx_reactions_user_post "
         "ON reactions(user_id, post_id)"),
        ("idx_comments_post",
         "CREATE INDEX IF NOT EXISTS idx_comments_post "
         "ON comments(post_id, created_at)"),
        ("idx_comments_parent",
         "CREATE INDEX IF NOT EXISTS idx_comments_parent "
         "ON comments(parent_id)"),
        ("idx_messages_thread",
         "CREATE INDEX IF NOT EXISTS idx_messages_thread "
         "ON messages(sender_id, receiver_id, created_at DESC)"),
        ("idx_messages_receiver_unread",
         "CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread "
         "ON messages(receiver_id, is_read)"),
        ("idx_follows_follower",
         "CREATE INDEX IF NOT EXISTS idx_follows_follower "
         "ON follows(follower_id)"),
        ("idx_follows_following",
         "CREATE INDEX IF NOT EXISTS idx_follows_following "
         "ON follows(following_id)"),
        ("idx_notifications_user_read",
         "CREATE INDEX IF NOT EXISTS idx_notifications_user_read "
         "ON notifications(user_id, is_read, created_at DESC)"),
        ("idx_saves_user",
         "CREATE INDEX IF NOT EXISTS idx_saves_user "
         "ON saves(user_id, created_at DESC)"),
        ("idx_post_media_post",
         "CREATE INDEX IF NOT EXISTS idx_post_media_post "
         "ON post_media(post_id, position)"),
        ("idx_stories_user_created",
         "CREATE INDEX IF NOT EXISTS idx_stories_user_created "
         "ON stories(user_id, created_at DESC)"),
    ]

    try:
        conn = sqlite3.connect(DB, timeout=15.0)
        try:
            conn.execute("PRAGMA busy_timeout=10000")
            c = conn.cursor()
            created = 0
            for name, sql in indexes:
                try:
                    c.execute(sql)
                    created += 1
                except sqlite3.OperationalError as e:
                    if "already exists" not in str(e).lower():
                        print(f"[INDEX] {name} skipped: {e}")
            conn.commit()
            print(f"[INDEX] {created}/{len(indexes)} indexes ensured")
        finally:
            conn.close()
    except Exception as e:
        print(f"[INDEX] fatal: {e}")


def init_db():
    conn = sqlite3.connect(DB, timeout=10.0)
    # S17.3 — set persistent DB-level pragmas ONCE
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
        # S39 Phase 2A — enable incremental auto-vacuum so the periodic
        # _run_data_hygiene() DELETE calls actually free disk space.
        # NOTE: auto_vacuum can only change from NONE→INCREMENTAL on a
        # VACUUM, so this sets the intent; the next VACUUM applies it.
        try:
            conn.execute("PRAGMA auto_vacuum=INCREMENTAL")
        except Exception:
            pass
    except Exception:
        pass
    c = conn.cursor()

    c.execute("""CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        bio TEXT DEFAULT '',
        profile_pic TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    try:
        c.execute("ALTER TABLE users ADD COLUMN cover_pic TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE users ADD COLUMN onboarded INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE users ADD COLUMN is_private INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE users ADD COLUMN session_version INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE users ADD COLUMN email TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE users ADD COLUMN google_id TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE users ADD COLUMN banned_until TIMESTAMP")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE users ADD COLUMN ban_reason TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE users ADD COLUMN totp_secret TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE users ADD COLUMN backup_codes TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    # S18.9b — track last activity for real online status
    try:
        c.execute("ALTER TABLE users ADD COLUMN last_seen TIMESTAMP")
    except sqlite3.OperationalError:
        pass

    # S22 / Series 27B-4 — email-based 2FA flag
    try:
        c.execute("ALTER TABLE users ADD COLUMN email_2fa_enabled INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass

    # S22 / Series 27B — recovery & phone fields
    for _col, _type in [
        ("phone", "TEXT"),
        ("phone_verified", "INTEGER DEFAULT 0"),
        ("phone_verified_at", "TIMESTAMP"),
        ("recovery_code_hash", "TEXT"),
        ("backup_email", "TEXT"),
        ("backup_email_verified", "INTEGER DEFAULT 0"),
    ]:
        try:
            c.execute(f"ALTER TABLE users ADD COLUMN {_col} {_type}")
        except sqlite3.OperationalError:
            pass

    c.execute("""CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        quote_post_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    try:
        c.execute("ALTER TABLE posts ADD COLUMN edited_at TIMESTAMP")
    except sqlite3.OperationalError:
        pass

    c.execute("""CREATE TABLE IF NOT EXISTS post_media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        media TEXT NOT NULL,
        position INTEGER DEFAULT 0
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS reactions (
        user_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        reaction TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, post_id)
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER,
        user_id INTEGER,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    try:
        c.execute("ALTER TABLE comments ADD COLUMN parent_id INTEGER")
    except sqlite3.OperationalError:
        pass

    c.execute("""CREATE TABLE IF NOT EXISTS comment_likes (
        user_id INTEGER NOT NULL,
        comment_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, comment_id)
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS saves (
        user_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, post_id)
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS reposts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, post_id)
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS follows (
        follower_id INTEGER NOT NULL,
        following_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(follower_id, following_id)
    )""")
    try:
        c.execute("ALTER TABLE follows ADD COLUMN status TEXT DEFAULT 'accepted'")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE follows ADD COLUMN is_close INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE follows ADD COLUMN is_favorite INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    # Batch 10 — subscription / verification / claims / reports
    c.execute("""CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscriber_id INTEGER NOT NULL,
        creator_id INTEGER NOT NULL,
        tier TEXT DEFAULT 'basic',
        amount REAL NOT NULL,
        status TEXT DEFAULT 'active',
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        until_ts TIMESTAMP,
        UNIQUE(subscriber_id, creator_id)
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS verification_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        full_name TEXT,
        id_doc TEXT,
        reason TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS business_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        business_name TEXT,
        contact_email TEXT,
        notes TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS problem_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        category TEXT,
        message TEXT NOT NULL,
        device_info TEXT,
        status TEXT DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    # Batch 9 — monetization intent tables
    c.execute("""CREATE TABLE IF NOT EXISTS tips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'BDT',
        note TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS gifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        gift_code TEXT NOT NULL,
        note TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        booker_id INTEGER NOT NULL,
        datetime_slot TEXT NOT NULL,
        duration_mins INTEGER DEFAULT 30,
        note TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS shop_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        price REAL NOT NULL,
        currency TEXT DEFAULT 'BDT',
        image TEXT,
        description TEXT DEFAULT '',
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS product_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        buyer_id INTEGER NOT NULL,
        seller_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        status TEXT DEFAULT 'pending',
        note TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS boosts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        budget REAL NOT NULL,
        duration_days INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    # Batch 8 — extended profile fields
    for _col, _type in [
        ("pronouns",     "TEXT"),
        ("gender",       "TEXT"),
        ("birthday",     "TEXT"),
        ("location",     "TEXT"),
        ("category",     "TEXT"),
        ("is_professional","INTEGER DEFAULT 0"),
        ("bio_links",    "TEXT DEFAULT ''"),
    ]:
        try:
            c.execute(f"ALTER TABLE users ADD COLUMN {_col} {_type}")
        except sqlite3.OperationalError:
            pass

    # Batch 7 — hidden posts + snoozed users + break log
    c.execute("""CREATE TABLE IF NOT EXISTS hidden_posts (
        user_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, post_id)
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS snoozed_users (
        user_id INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        until_ts TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, target_id)
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS story_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_id INTEGER NOT NULL,
        story_id INTEGER NOT NULL,
        story_owner_id INTEGER NOT NULL,
        reason TEXT NOT NULL,
        notes TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(reporter_id, story_id)
    )""")

    # Batch 6 — mute + restrict + no-retweets
    c.execute("""CREATE TABLE IF NOT EXISTS mutes (
        user_id INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, target_id)
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS restricts (
        user_id INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, target_id)
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS no_retweets (
        user_id INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, target_id)
    )""")

    # Batch 5 — pinned post + archived + highlights + live
    try:
        c.execute("ALTER TABLE users ADD COLUMN pinned_post_id INTEGER")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE users ADD COLUMN is_live INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE posts ADD COLUMN is_archived INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    c.execute("""CREATE TABLE IF NOT EXISTS story_highlights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        cover TEXT NOT NULL,
        story_ids TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    # Batch 3 — saved profiles + notify toggle
    c.execute("""CREATE TABLE IF NOT EXISTS profile_saves (
        user_id INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, target_id)
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS profile_notify (
        user_id INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, target_id)
    )""")

    # Batch 2 — message requests table
    c.execute("""CREATE TABLE IF NOT EXISTS message_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(sender_id, receiver_id)
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    try:
        c.execute("ALTER TABLE messages ADD COLUMN attachment TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE messages ADD COLUMN parent_id INTEGER")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE messages ADD COLUMN kind TEXT DEFAULT 'text'")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE messages ADD COLUMN duration REAL")
    except sqlite3.OperationalError:
        pass

    c.execute("""CREATE TABLE IF NOT EXISTS message_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        reaction TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(message_id, user_id)
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS group_chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_by INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS group_members (
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(group_id, user_id)
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS group_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        attachment TEXT,
        is_read_by TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS stories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        media TEXT NOT NULL,
        media_type TEXT DEFAULT 'image',
        caption TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS starred_messages (
        user_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, message_id)
    )""")

    # Series 4A — Voice/Video call sessions
    c.execute("""CREATE TABLE IF NOT EXISTS call_sessions (
        id TEXT PRIMARY KEY,
        caller_id INTEGER NOT NULL,
        callee_id INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'audio',
        status TEXT NOT NULL DEFAULT 'ringing',
        offer TEXT,
        answer TEXT,
        caller_ice TEXT DEFAULT '',
        callee_ice TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        answered_at TIMESTAMP,
        ended_at TIMESTAMP,
        ended_by INTEGER,
        end_reason TEXT
    )""")
    c.execute("""CREATE INDEX IF NOT EXISTS idx_calls_callee
                 ON call_sessions(callee_id, status, created_at)""")
    c.execute("""CREATE INDEX IF NOT EXISTS idx_calls_caller
                 ON call_sessions(caller_id, status, created_at)""")

    # Series 4E — heartbeat columns (moved AFTER CREATE)
    # Fresh DB: ALTER now succeeds because table already exists.
    for _col in ("caller_last_seen", "callee_last_seen"):
        try:
            c.execute(f"ALTER TABLE call_sessions ADD COLUMN {_col} TIMESTAMP")
        except sqlite3.OperationalError:
            pass

    c.execute("""CREATE TABLE IF NOT EXISTS chat_settings (
        user_id INTEGER NOT NULL,
        other_user_id INTEGER NOT NULL,
        is_pinned INTEGER DEFAULT 0,
        is_muted INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, other_user_id)
    )""")

    # Series 3B — chat personalization (AFTER chat_settings exists)
    for _col, _dflt in [
        ("theme", "'default'"),
        ("nickname", "''"),
        ("wallpaper", "'default'"),
        ("nickname_public", "0"),
        ("my_nickname", "''"),
    ]:
        try:
            c.execute(f"ALTER TABLE chat_settings ADD COLUMN {_col} TEXT DEFAULT {_dflt}")
        except sqlite3.OperationalError:
            pass

    c.execute("""CREATE TABLE IF NOT EXISTS story_views (
        story_id INTEGER,
        viewer_id INTEGER,
        viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(story_id, viewer_id)
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS story_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        story_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        reaction TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS blocks (
        blocker_id INTEGER NOT NULL,
        blocked_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(blocker_id, blocked_id)
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_id INTEGER NOT NULL,
        target_type TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        reason TEXT NOT NULL,
        notes TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(reporter_id, target_type, target_id)
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        ip TEXT,
        user_agent TEXT,
        device_label TEXT,
        method TEXT DEFAULT 'password',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS login_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        ip TEXT,
        user_agent TEXT,
        device_label TEXT,
        method TEXT DEFAULT 'password',
        is_new_device INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS moderation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        notes TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        actor_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        post_id INTEGER,
        is_read INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    # S16.6 — security event log (audit trail)
    c.execute("""CREATE TABLE IF NOT EXISTS security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        event TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    c.execute("""CREATE INDEX IF NOT EXISTS idx_sec_events_user
                 ON security_events(user_id, created_at)""")
    c.execute("""CREATE INDEX IF NOT EXISTS idx_sec_events_event
                 ON security_events(event, created_at)""")

    c.execute("""CREATE TABLE IF NOT EXISTS reels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        video TEXT NOT NULL,
        caption TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS reel_likes (
        user_id INTEGER,
        reel_id INTEGER,
        PRIMARY KEY(user_id, reel_id)
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS reel_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reel_id INTEGER,
        user_id INTEGER,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    # S21.2 — saved reels
    c.execute("""CREATE TABLE IF NOT EXISTS reel_saves (
        user_id INTEGER NOT NULL,
        reel_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, reel_id)
    )""")

    conn.commit()
    conn.close()


# ============================================
# MESSAGING — Typing state (in-memory)
# ============================================

_typing_state = {}
_typing_lock = threading.Lock()
_TYPING_TTL = 6


def _mark_typing(from_uid, to_uid):
    with _typing_lock:
        now = time.time()
        _typing_state[(from_uid, to_uid)] = now
        # periodic cleanup
        if len(_typing_state) > 500:
            for k in list(_typing_state.keys()):
                if now - _typing_state[k] > _TYPING_TTL * 2:
                    del _typing_state[k]


def _is_typing(from_uid, to_uid):
    with _typing_lock:
        ts = _typing_state.get((from_uid, to_uid), 0)
        return (time.time() - ts) < _TYPING_TTL


# ============================================
# S16.6 — SECURITY EVENT LOG
# ============================================

def _log_security_event(event, uid=None, username=None, metadata=None):
    """S16.6 — append an audit-trail row. Never raises.

    Args:
        event:     short tag, e.g. "login_success", "password_change"
        uid:       user id (optional)
        username:  username (optional; useful when uid unknown, e.g. failed login)
        metadata:  dict (optional) — extra context (device, reason, etc.)
    """
    try:
        import json as _j
        ip = ""
        ua = ""
        try:
            ip = _client_ip()
            ua = (request.headers.get("User-Agent") or "")[:300]
        except Exception:
            pass
        meta_str = ""
        if metadata:
            try:
                meta_str = _j.dumps(metadata, ensure_ascii=False)[:1000]
            except Exception:
                meta_str = str(metadata)[:1000]
        conn = db()
        conn.execute("""INSERT INTO security_events
            (user_id, username, event, ip, user_agent, metadata)
            VALUES (?,?,?,?,?,?)""",
            (uid, username, event, ip, ua, meta_str))
        conn.commit()
        conn.close()
    except Exception as e:
        try:
            print(f"[S16.6] log failed: {e}")
        except Exception:
            pass


# ============================================
# S17.1 — FILE UPLOAD HELPERS
# ============================================

UPLOAD_ROOT = os.path.join(BASE_DIR, "static", "uploads")
UPLOAD_SUBDIRS = ("avatars", "covers", "posts", "stories", "reels", "messages")
_UPLOAD_MAX_BYTES = 10 * 1024 * 1024   # 10 MB per file (after decode)


def _ensure_upload_dirs():
    """Create upload folder structure. Idempotent."""
    try:
        for sub in UPLOAD_SUBDIRS:
            os.makedirs(os.path.join(UPLOAD_ROOT, sub), exist_ok=True)
    except Exception as e:
        print(f"[UPLOAD] mkdir failed: {e}")


_MIME_EXT = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
    "image/gif": "gif", "image/webp": "webp",
    "video/mp4": "mp4", "video/webm": "webm",
    "video/quicktime": "mov", "video/ogg": "ogv",
    # Voice messages
    "audio/webm": "webm", "audio/ogg": "ogg", "audio/oga": "ogg",
    "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav",
    "audio/x-wav": "wav", "audio/aac": "aac",
}


def _save_data_uri(data_uri, subfolder, prefix=""):
    """S17.1 — decode a data-URI and write to static/uploads/<subfolder>/.

    Returns public path (e.g. /static/uploads/posts/123_abc.jpg) or None on error.
    If input already looks like a public path (starts with /static/), returns it unchanged.
    """
    if not isinstance(data_uri, str) or not data_uri:
        return None
    # Already a public path (e.g. migrated earlier)
    if data_uri.startswith("/static/uploads/"):
        return data_uri
    # Must be a data URI
    if not data_uri.startswith("data:"):
        return None
    try:
        header, b64 = data_uri.split(",", 1)
    except ValueError:
        return None
    if "base64" not in header.lower():
        return None
    mime = header.split(";")[0].replace("data:", "").strip().lower()
    ext = _MIME_EXT.get(mime)
    if not ext:
        return None
    try:
        raw = _b64.b64decode(b64, validate=False)
    except Exception:
        return None
    if not raw or len(raw) > _UPLOAD_MAX_BYTES:
        return None

    try:
        _ensure_upload_dirs()
        ts = int(time.time() * 1000)
        rand = secrets.token_hex(4)
        safe_prefix = "".join(c for c in (prefix or "") if c.isalnum() or c in ("_", "-"))[:20]
        fname = f"{safe_prefix}{ts}_{rand}.{ext}" if safe_prefix else f"{ts}_{rand}.{ext}"
        full = os.path.join(UPLOAD_ROOT, subfolder, fname)
        with open(full, "wb") as fp:
            fp.write(raw)
        return f"/static/uploads/{subfolder}/{fname}"
    except Exception as e:
        print(f"[UPLOAD] write failed: {e}")
        return None


def _delete_upload_file(public_path):
    """S17.1 — delete a file under uploads/. Safe: rejects '..' and outside paths."""
    if not public_path or not isinstance(public_path, str):
        return
    if not public_path.startswith("/static/uploads/"):
        return
    rel = public_path[len("/static/uploads/"):]
    if ".." in rel or rel.startswith("/") or rel == "":
        return
    full = os.path.join(UPLOAD_ROOT, rel)
    try:
        if os.path.isfile(full):
            os.remove(full)
    except Exception:
        pass


def _delete_upload_many(paths):
    for p in paths or []:
        _delete_upload_file(p)


def db():
    """S22 / Series 26 (fixed) — leak-safe SQLite connection.

    Returns a FRESH connection each call so routes that call
    conn.close() mid-request keep working. Every connection is
    registered in g._juktoy_conns and closed by teardown_appcontext
    so early-return leaks are prevented.
    """
    conn = sqlite3.connect(DB, timeout=10.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=3000")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-16000")

    # Register for request-end cleanup (best effort)
    try:
        from flask import g
        if not hasattr(g, "_juktoy_conns"):
            g._juktoy_conns = []
        g._juktoy_conns.append(conn)
    except Exception:
        pass

    return conn


def hash_password(password, salt):
    """LEGACY — only used to verify pre-existing passwords.
    Do NOT use for new passwords. Use make_password_hash() instead."""
    try:
        result = subprocess.run(
            [SECURITY_BIN],
            input=f"{password}\n{salt}\n",
            capture_output=True,
            text=True,
            timeout=2,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass
    return hashlib.sha256((salt + password + salt).encode()).hexdigest()


# ============================================
# S15.1 — STRONG PASSWORD CHECK
# ============================================

# Top common passwords (lowercase)
_COMMON_PASSWORDS = {
    "password", "password1", "password123", "12345678", "123456789",
    "1234567890", "qwerty", "qwerty123", "abc12345", "letmein",
    "iloveyou", "welcome", "monkey", "dragon", "sunshine",
    "princess", "football", "baseball", "master", "shadow",
    "superman", "batman", "admin", "admin123", "root",
    "test1234", "test12345", "testpass", "user1234", "guest",
    "changeme", "login123", "sample123", "abcd1234", "a1b2c3d4",
    "1q2w3e4r", "1qaz2wsx", "qazwsxedc", "zaq12wsx", "asdfghjkl",
    "0987654321", "987654321", "11111111", "00000000", "aaaaaaaa",
    "bbbbbbbb", "123123123", "1234512345", "87654321", "135792468",
    "bangladesh", "dhaka", "bd123456", "bangla123", "iloveyou1",
    "kolkata", "cricket", "football1", "hello123", "passw0rd",
    "p@ssword", "p@ssw0rd", "welcome1", "letmein123", "test123456",
}


# ============================================
# S15.7 — HIBP BREACHED PASSWORD CHECK (k-anonymity)
# ============================================
# Privacy-safe: only SHA-1 prefix (5 chars) sent to HIBP.
# Full password never leaves the server.
# Fail-open: network error → allow (don't block user).

_HIBP_API = "https://api.pwnedpasswords.com/range/"
_hibp_cache = {}              # prefix -> (fetched_at, {suffix: count})
_hibp_cache_lock = threading.Lock()
_HIBP_CACHE_TTL = 3600        # 1 hour
_HIBP_TIMEOUT = 3.0           # seconds


def _hibp_check(password):
    """Returns (count, status).
       count > 0  → breached N times
       count = 0  → safe OR unknown
       status     → None | "network" | "invalid"
    Never raises.
    """
    if not isinstance(password, str) or not password or len(password) > 200:
        return 0, "invalid"

    sha1 = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()
    prefix, suffix = sha1[:5], sha1[5:]
    now = time.time()

    # Cache hit
    with _hibp_cache_lock:
        cached = _hibp_cache.get(prefix)
        if cached and (now - cached[0]) < _HIBP_CACHE_TTL:
            return cached[1].get(suffix, 0), None

    # Fetch
    try:
        req = _ureq.Request(
            _HIBP_API + prefix,
            headers={
                "User-Agent": "JUKTOY-Security-Check",
                "Add-Padding": "true",
            },
        )
        with _ureq.urlopen(req, timeout=_HIBP_TIMEOUT) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"[HIBP] network error: {e}")
        return 0, "network"

    # Parse "SUFFIX:COUNT" lines
    results = {}
    for line in body.splitlines():
        if ":" not in line:
            continue
        suf, _, cnt = line.partition(":")
        try:
            results[suf.strip().upper()] = int(cnt.strip())
        except ValueError:
            pass

    with _hibp_cache_lock:
        _hibp_cache[prefix] = (now, results)
        if len(_hibp_cache) > 500:
            dead = [k for k, v in _hibp_cache.items()
                    if (now - v[0]) > _HIBP_CACHE_TTL]
            for k in dead:
                _hibp_cache.pop(k, None)

    return results.get(suffix, 0), None


def validate_password_strength(password, check_breach=False):
    """Return (ok, error_message).
    Strong password rules:
      - At least 8 characters
      - At least 1 letter
      - At least 1 digit
      - Not in common passwords list
      - Not a simple repeated pattern
    """
    if not isinstance(password, str):
        return False, "পাসওয়ার্ড দিতে হবে"
    if len(password) < 8:
        return False, "পাসওয়ার্ড অন্তত ৮ অক্ষরের হতে হবে"
    if len(password) > 128:
        return False, "পাসওয়ার্ড অনেক বড় (সর্বোচ্চ ১২৮ অক্ষর)"
    if password.lower() in _COMMON_PASSWORDS:
        return False, "এই পাসওয়ার্ডটি অনেক প্রচলিত — ভিন্ন কিছু ব্যবহার করুন"

    has_letter = any(c.isalpha() for c in password)
    has_digit = any(c.isdigit() for c in password)
    if not has_letter:
        return False, "পাসওয়ার্ডে অন্তত ১টি অক্ষর (a-z, A-Z) থাকতে হবে"
    if not has_digit:
        return False, "পাসওয়ার্ডে অন্তত ১টি সংখ্যা (0-9) থাকতে হবে"

    # Repeated pattern check (aaaaaa, 111111)
    if len(set(password)) < 4:
        return False, "পাসওয়ার্ডে বিভিন্ন ধরনের অক্ষর ব্যবহার করুন"

    # Sequential patterns
    lowered = password.lower()
    sequential = ["0123456789", "9876543210", "abcdefghij", "jihgfedcba"]
    for seq in sequential:
        for i in range(len(seq) - 6):
            if seq[i:i+7] in lowered:
                return False, "পরপর সংখ্যা/অক্ষরের ধারা ব্যবহার করবেন না"

    # S15.7 — breached password check (fail-open)
    if check_breach:
        _cnt, _status = _hibp_check(password)
        if _cnt > 0:
            bn_digits = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")
            cnt_str = f"{_cnt:,}".translate(bn_digits)
            return False, (
                f"এই পাসওয়ার্ডটি {cnt_str} বার ডেটা লিক-এ পাওয়া গেছে। "
                "নিরাপত্তার জন্য ভিন্ন পাসওয়ার্ড ব্যবহার করুন।"
            )

    return True, None


# ============================================
# SECURE PASSWORD HASHING (v2 — S1 fix)
# ============================================

def _detect_secure_algo():
    """Prefer scrypt; fallback to pbkdf2 if scrypt unavailable."""
    try:
        hashlib.scrypt(b"t", salt=b"12345678", n=2**14, r=8, p=1,
                       dklen=32, maxmem=64 * 1024 * 1024)
        return "scrypt"
    except Exception:
        return "pbkdf2"


SECURE_ALGO = _detect_secure_algo()


def make_password_hash(password):
    """Create a secure password hash. Format: 'algo$salt_hex$hash_hex'.
    scrypt params: n=2^14, r=8, p=1 (OWASP 2023 recommended).
    pbkdf2 params: SHA-256, 600,000 iterations (OWASP 2023)."""
    if isinstance(password, str):
        password = password.encode("utf-8")
    salt = secrets.token_bytes(16)

    if SECURE_ALGO == "scrypt":
        dk = hashlib.scrypt(password, salt=salt, n=2**14, r=8, p=1,
                            dklen=32, maxmem=64 * 1024 * 1024)
        return f"scrypt${salt.hex()}${dk.hex()}"
    else:
        dk = hashlib.pbkdf2_hmac("sha256", password, salt, 600000, dklen=32)
        return f"pbkdf2${salt.hex()}${dk.hex()}"


def _verify_secure_hash(password, stored):
    """Verify against new 'algo$salt$hash' format."""
    try:
        parts = stored.split("$")
        if len(parts) != 3:
            return False
        algo, salt_hex, hash_hex = parts
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)

        if isinstance(password, str):
            password = password.encode("utf-8")

        if algo == "scrypt":
            dk = hashlib.scrypt(password, salt=salt, n=2**14, r=8, p=1,
                                dklen=len(expected), maxmem=64 * 1024 * 1024)
        elif algo == "pbkdf2":
            dk = hashlib.pbkdf2_hmac("sha256", password, salt, 600000,
                                     dklen=len(expected))
        else:
            return False

        return secrets.compare_digest(dk, expected)
    except Exception:
        return False


def verify_password(password, stored_hash, salt):
    """Verify a password (both new and legacy formats).
    Returns (is_valid, new_hash_if_migration_needed).
    If new_hash returned (not None), caller must save it."""
    if not stored_hash:
        return False, None

    if stored_hash.startswith("scrypt$") or stored_hash.startswith("pbkdf2$"):
        return _verify_secure_hash(password, stored_hash), None

    # Legacy verification
    legacy = hash_password(password, salt or "")
    if secrets.compare_digest(legacy, stored_hash):
        return True, make_password_hash(password)

    return False, None


def login_required(f):
    @wraps(f)
    def wrapper(*a, **kw):
        if "user_id" not in session:
            return jsonify({"error": "লগইন প্রয়োজন"}), 401
        return f(*a, **kw)
    return wrapper


# ============================================
# RATE LIMITER (S2)
# ============================================

class _SlidingWindowLimiter:
    """Simple in-memory sliding-window rate limiter."""
    def __init__(self):
        self._buckets = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_cleanup = time.time()

    def hit(self, key, limit, window):
        """Return True if allowed, False if rate-limited."""
        now = time.time()
        with self._lock:
            bucket = self._buckets[key]
            cutoff = now - window
            # Trim expired
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                return False
            bucket.append(now)

            # Periodic global cleanup (every 5 min)
            if now - self._last_cleanup > 300:
                self._last_cleanup = now
                dead = [k for k, v in self._buckets.items()
                        if not v or v[-1] < now - 3600]
                for k in dead:
                    self._buckets.pop(k, None)
            return True


_limiter = _SlidingWindowLimiter()


# ============================================
# S17.2p — PERSISTENT STATE (survives restart)
# ============================================
# Rate-limit buckets are written to disk periodically so a server
# restart does NOT reset attacker cooldowns. Without this, an attacker
# can force a restart (or wait for one) to reset all rate limits.
# This gives ~90% of the Redis benefit with zero external services.

_STATE_FILE = os.path.join(BASE_DIR, ".juktoy_state.json")
_STATE_LOCK = threading.Lock()


# S29.12 - cross-process safe state persistence.
#
# Previous version used a single tmp file (".juktoy_state.json.tmp") and
# a per-process threading lock. Under gunicorn/waitress with N workers,
# all N processes wrote to the SAME tmp path AND overwrote each other's
# os.replace() target, so only the last worker's rate-limit buckets
# survived a restart. The fix:
#   1. per-PID tmp file, so concurrent writes never collide
#   2. advisory cross-process lock (fcntl.flock on Unix, msvcrt on Win)
#   3. merge: newest timestamps per bucket key win
try:
    import fcntl as _fcntl
    _HAVE_FCNTL = True
except ImportError:
    _fcntl = None
    _HAVE_FCNTL = False

try:
    import msvcrt as _msvcrt
    _HAVE_MSVCRT = True
except ImportError:
    _msvcrt = None
    _HAVE_MSVCRT = False


def _with_file_lock(lock_path, mode, fn):
    """Run fn() while holding an advisory cross-process file lock."""
    os.makedirs(os.path.dirname(lock_path) or ".", exist_ok=True)
    fh = open(lock_path, "a+")
    try:
        if _HAVE_FCNTL:
            _fcntl.flock(fh.fileno(), _fcntl.LOCK_EX)
        elif _HAVE_MSVCRT:
            _msvcrt.locking(fh.fileno(), _msvcrt.LK_LOCK, 1)
        return fn()
    finally:
        try:
            if _HAVE_FCNTL:
                _fcntl.flock(fh.fileno(), _fcntl.LOCK_UN)
            elif _HAVE_MSVCRT:
                _msvcrt.locking(fh.fileno(), _msvcrt.LK_UNLCK, 1)
        except Exception:
            pass
        try:
            fh.close()
        except Exception:
            pass


def _save_state():
    """S29.12 - write rate-limit buckets to disk safely across workers.

    Concurrency model:
      - In-process lock (_STATE_LOCK) serializes threads inside one worker
      - Per-PID tmp file prevents concurrent-write corruption
      - Cross-process file lock serializes the final os.replace step
      - Merge: existing on-disk buckets are unioned with in-memory ones,
        keeping the newest timestamp per (bucket, time) pair.
    """
    import json as _j
    try:
        with _STATE_LOCK:
            now = time.time()
            cutoff = now - 3600
            buckets = {}
            for k, v in list(_limiter._buckets.items()):
                recent = [t for t in v if t > cutoff]
                if recent:
                    buckets[k] = recent
            data = {"saved_at": now, "rate_limiter": buckets}

        lock_path = _STATE_FILE + ".lock"
        tmp = f"{_STATE_FILE}.{os.getpid()}.tmp"

        def _do_write():
            # Merge: read whatever is on disk now, union with our data
            merged = dict(buckets)
            try:
                if os.path.exists(_STATE_FILE):
                    with open(_STATE_FILE, "r", encoding="utf-8") as fh:
                        prev = _j.load(fh)
                    prev_buckets = (prev or {}).get("rate_limiter", {}) or {}
                    for pk, pv in prev_buckets.items():
                        if pk in merged:
                            # union of timestamps, keep only recent
                            union = set(merged[pk]) | set(
                                t for t in pv if t > cutoff
                            )
                            merged[pk] = sorted(union)
                        else:
                            recent_pv = [t for t in pv if t > cutoff]
                            if recent_pv:
                                merged[pk] = recent_pv
            except Exception:
                pass

            payload = {"saved_at": now, "rate_limiter": merged}

            with open(tmp, "w", encoding="utf-8") as fh:
                _j.dump(payload, fh)
                try:
                    fh.flush()
                    os.fsync(fh.fileno())
                except Exception:
                    pass
            os.replace(tmp, _STATE_FILE)

        _with_file_lock(lock_path, "w", _do_write)
    except Exception as e:
        try:
            print(f"[STATE] save failed (pid={os.getpid()}): {e}")
        except Exception:
            pass
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except Exception:
            pass


def _load_state():
    """Load rate-limit buckets from disk (called at startup)."""
    try:
        if not os.path.exists(_STATE_FILE):
            return
        with open(_STATE_FILE, "r", encoding="utf-8") as fh:
            import json as _j
            data = _j.load(fh)
        buckets = data.get("rate_limiter", {})
        now = time.time()
        cutoff = now - 3600
        loaded = 0
        with _STATE_LOCK:
            for k, v in buckets.items():
                recent = [t for t in v if t > cutoff]
                if recent:
                    _limiter._buckets[k] = deque(recent)
                    loaded += 1
        if loaded:
            print(f"[STATE] loaded {loaded} rate-limit buckets from disk")
    except Exception as e:
        try:
            print(f"[STATE] load failed: {e}")
        except Exception:
            pass


def _start_state_persister():
    """Save state every 60s + on process exit."""
    def _loop():
        while True:
            time.sleep(60)
            _save_state()
    t = threading.Thread(target=_loop, daemon=True)
    t.start()

    # Also save on clean shutdown
    import atexit
    atexit.register(_save_state)


def rate_limit(name, limit, window, per_username=False):
    """Decorator. Key: f"{name}:ip:{ip}" (+ optional f"{name}:user:{username}")."""
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            ip = request.remote_addr or "unknown"
            if not _limiter.hit(f"{name}:ip:{ip}", limit, window):
                return jsonify({
                    "error": "অনেক বেশি চেষ্টা। কিছুক্ষণ পর আবার চেষ্টা করুন।"
                }), 429
            if per_username:
                d = request.json or {}
                un = (d.get("username") or "").strip().lower()
                if un and not _limiter.hit(f"{name}:user:{un}", limit * 2, window):
                    return jsonify({
                        "error": "এই অ্যাকাউন্টে অনেক চেষ্টা হয়েছে। অপেক্ষা করুন।"
                    }), 429
            return fn(*a, **kw)
        return wrapper
    return deco


def extract_hashtags(text):
    """S30.17 — cap input + tag length, dedup via set (returns list)."""
    if not text:
        return []
    s = str(text)
    if len(s) > 20000:
        s = s[:20000]
    # Cap tag length to 50 (was unbounded — ReDoS risk on long inputs)
    return list(set(re.findall(r'#([\w\u0980-\u09FF\u200c\u200d]{1,50})', s.lower())))


# ============================================
# MEDIA VALIDATION (XSS + size protection)
# ============================================

DATA_URI_RE = re.compile(
    r'^data:image/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$',
    re.IGNORECASE
)


def is_valid_image_uri(value, max_len=3_000_000):
    """Strictly validate a data-URI image string."""
    if not isinstance(value, str):
        return False
    if len(value) > max_len:
        return False
    return bool(DATA_URI_RE.match(value))


# ============================================
# POST VISIBILITY (S4 — private account enforcement)
# ============================================

def _can_view_post(post_id, viewer_uid):
    """Check if viewer can see post.
    Returns:
      None  → post doesn't exist
      True  → can view
      False → blocked (private + not following)
    """
    conn = db()
    row = conn.execute("""
        SELECT p.user_id, COALESCE(u.is_private, 0) AS is_private
        FROM posts p JOIN users u ON u.id = p.user_id
        WHERE p.id=?
    """, (post_id,)).fetchone()
    conn.close()
    if not row:
        return None
    if row["user_id"] == viewer_uid:
        return True
    if not row["is_private"]:
        return True
    conn = db()
    f = conn.execute(
        "SELECT 1 FROM follows WHERE follower_id=? AND following_id=?",
        (viewer_uid, row["user_id"])
    ).fetchone()
    conn.close()
    return f is not None


# ============================================
# BLOCK HELPER (S5)
# ============================================

def _is_blocked_either_way(uid1, uid2):
    """Return True if either user blocked the other."""
    if not uid1 or not uid2 or uid1 == uid2:
        return False
    conn = db()
    row = conn.execute("""SELECT 1 FROM blocks
        WHERE (blocker_id=? AND blocked_id=?)
           OR (blocker_id=? AND blocked_id=?)
        LIMIT 1""", (uid1, uid2, uid2, uid1)).fetchone()
    conn.close()
    return row is not None


# ============================================
# S13-A — EMAIL + PASSWORD RESET TOKENS
# ============================================

import smtplib as _smtp
from email.mime.text import MIMEText as _MIMEText
from email.mime.multipart import MIMEMultipart as _MIMEMultipart

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


def _is_valid_email(v):
    return bool(v) and len(v) <= 254 and bool(_EMAIL_RE.match(v))


def _smtp_config():
    """Return SMTP config dict or None if not configured."""
    host = (_os.environ.get("JUKTOY_SMTP_HOST") or "").strip()
    user = (_os.environ.get("JUKTOY_SMTP_USER") or "").strip()
    # Gmail app passwords are shown with spaces — strip them
    pwd = (_os.environ.get("JUKTOY_SMTP_PASS") or "").replace(" ", "").strip()
    if not (host and user and pwd):
        return None
    try:
        port = int((_os.environ.get("JUKTOY_SMTP_PORT") or "587").strip())
    except ValueError:
        port = 587
    return {
        "host": host,
        "port": port,
        "user": user,
        "password": pwd,
        "from_addr": (_os.environ.get("JUKTOY_SMTP_FROM") or user).strip(),
    }


def _brevo_config():
    """S27B Brevo HTTP API — works on Render free tier (SMTP ports blocked)."""
    key = (_os.environ.get("JUKTOY_BREVO_API_KEY") or "").strip()
    sender = (_os.environ.get("JUKTOY_MAIL_FROM")
              or _os.environ.get("JUKTOY_SMTP_FROM")
              or "").strip()
    if not (key and sender):
        return None
    return {"key": key, "sender": sender}


def _app_url():
    """Public base URL for reset links."""
    env_url = _os.environ.get("JUKTOY_APP_URL")
    if env_url:
        return env_url.rstrip("/")
    try:
        return request.url_root.rstrip("/")
    except Exception:
        return "http://127.0.0.1:5000"


_LAST_EMAIL_ERROR = {"err": None, "at": 0}


def _send_email(to_addr, subject, text_body, html_body=None):
    """Send email via Brevo HTTP API (if configured), else SMTP, else console (dev only).

    Returns True on success, False on failure. Last error in _LAST_EMAIL_ERROR.
    """
    import time as _tm
    import json as _json
    import ssl as _ssl
    import urllib.request as _ur

    def _ok():
        _LAST_EMAIL_ERROR["err"] = None
        _LAST_EMAIL_ERROR["at"] = _tm.time()
        return True

    def _fail(err_str):
        print(f"[JUKTOY EMAIL ERROR] {err_str}")
        _LAST_EMAIL_ERROR["err"] = err_str
        _LAST_EMAIL_ERROR["at"] = _tm.time()
        return False

    # ── Option A: Brevo HTTP API (port 443 — never blocked by Render) ──
    bcfg = _brevo_config()
    if bcfg:
        try:
            payload = {
                "sender": {"name": "JUKTOY", "email": bcfg["sender"]},
                "to": [{"email": to_addr}],
                "subject": subject,
                "textContent": text_body,
            }
            if html_body:
                payload["htmlContent"] = html_body
            req = _ur.Request(
                "https://api.brevo.com/v3/smtp/email",
                data=_json.dumps(payload).encode("utf-8"),
                headers={
                    "api-key": bcfg["key"],
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                method="POST",
            )
            with _ur.urlopen(req, timeout=15) as resp:
                resp.read()
            return _ok()
        except Exception as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "ignore")[:200]
            except Exception:
                pass
            return _fail(f"Brevo {type(e).__name__}: {str(e)[:150]} {detail}")

    # ── Option B: SMTP (only works off-Render or with a non-blocked port) ──
    cfg = _smtp_config()
    if not cfg:
        on_server = bool(_os.environ.get("RENDER")) or \
            (_os.environ.get("JUKTOY_ENV") or "").lower() in ("prod", "production")
        print("\n" + "=" * 60)
        print("[JUKTOY EMAIL — NOT CONFIGURED]")
        print(f"To: {to_addr} | Subject: {subject}")
        print(text_body)
        print("=" * 60 + "\n")
        _LAST_EMAIL_ERROR["err"] = "Email not configured (env vars missing)"
        _LAST_EMAIL_ERROR["at"] = _tm.time()
        # local dev: print to console and pretend success; on server: report failure
        return not on_server

    try:
        msg = _MIMEMultipart("alternative")
        msg["From"] = f"JUKTOY <{cfg['from_addr']}>"
        msg["To"] = to_addr
        msg["Subject"] = subject
        msg.attach(_MIMEText(text_body, "plain", "utf-8"))
        if html_body:
            msg.attach(_MIMEText(html_body, "html", "utf-8"))

        if cfg["port"] == 465:
            with _smtp.SMTP_SSL(cfg["host"], 465, timeout=15,
                                context=_ssl.create_default_context()) as smtp:
                smtp.login(cfg["user"], cfg["password"])
                smtp.send_message(msg)
        else:
            with _smtp.SMTP(cfg["host"], cfg["port"], timeout=15) as smtp:
                smtp.ehlo()
                smtp.starttls(context=_ssl.create_default_context())
                smtp.ehlo()
                smtp.login(cfg["user"], cfg["password"])
                smtp.send_message(msg)
        return _ok()
    except Exception as e:
        return _fail(f"{type(e).__name__}: {str(e)[:300]}")


def _create_reset_token(uid):
    plain = secrets.token_urlsafe(32)
    h = hashlib.sha256(plain.encode()).hexdigest()
    conn = db()
    conn.execute("DELETE FROM password_resets WHERE user_id=? OR expires_at < datetime('now')",
                 (uid,))
    conn.execute("""INSERT INTO password_resets (user_id, token_hash, expires_at)
                    VALUES (?, ?, datetime('now', '+15 minutes'))""",
                 (uid, h))
    conn.commit()
    conn.close()
    return plain


def _verify_reset_token(plain):
    if not plain:
        return None
    h = hashlib.sha256(plain.encode()).hexdigest()
    conn = db()
    row = conn.execute("""SELECT user_id FROM password_resets
                          WHERE token_hash=? AND used=0
                            AND expires_at > datetime('now')""", (h,)).fetchone()
    conn.close()
    return row["user_id"] if row else None


def _consume_reset_token(plain):
    h = hashlib.sha256(plain.encode()).hexdigest()
    conn = db()
    conn.execute("UPDATE password_resets SET used=1 WHERE token_hash=?", (h,))
    conn.commit()
    conn.close()


# ============================================
# S13-A — EMAIL + PASSWORD RESET ENDPOINTS
# ============================================

@app.route("/api/me/email/status")
@login_required
def email_status():
    uid = session["user_id"]
    conn = db()
    row = conn.execute("SELECT email, COALESCE(email_verified,0) AS v FROM users WHERE id=?",
                       (uid,)).fetchone()
    conn.close()
    return jsonify({
        "email": row["email"] if row else None,
        "verified": bool(row["v"]) if row else False,
    })


@app.route("/api/me/email", methods=["POST"])
@login_required
@rate_limit("set_email", 5, 3600)
def set_email():
    d = request.json or {}
    email = (d.get("email") or "").strip().lower()
    password = d.get("password") or ""

    if not email or not _is_valid_email(email):
        return jsonify({"error": "বৈধ ইমেইল দিন"}), 400
    if not password:
        return jsonify({"error": "পাসওয়ার্ড দিন"}), 400

    uid = session["user_id"]
    conn = db()
    row = conn.execute("SELECT salt, password_hash FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    ok, _ = verify_password(password, row["password_hash"], row["salt"])
    if not ok:
        conn.close()
        return jsonify({"error": "পাসওয়ার্ড ভুল"}), 400

    existing = conn.execute("SELECT id FROM users WHERE email=? AND id!=?",
                            (email, uid)).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "এই ইমেইল ব্যবহার করা যাবে না"}), 400

    # S27B fix-A — preserve verification if email unchanged
    prev = conn.execute(
        "SELECT email, COALESCE(email_verified,0) AS ev FROM users WHERE id=?",
        (uid,)
    ).fetchone()
    same_email = bool(prev and (prev["email"] or "").lower() == email)
    new_verified = 1 if (same_email and prev["ev"]) else 0

    try:
        conn.execute("UPDATE users SET email=?, email_verified=? WHERE id=?",
                     (email, new_verified, uid))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "এই ইমেইল ব্যবহার করা যাবে না"}), 400

    uname = conn.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()["username"]
    conn.close()

    # S27B fix — 6-digit code verification (not link)
    import secrets as _sec
    code = str(_sec.randbelow(900000) + 100000)
    code_hash = make_password_hash(code)

    conn2 = db()
    conn2.execute(
        "DELETE FROM password_resets WHERE user_id=? AND purpose='email_verify'",
        (uid,)
    )
    conn2.execute(
        """INSERT INTO password_resets (user_id, token_hash, expires_at, purpose)
           VALUES (?, ?, datetime('now', '+10 minutes'), 'email_verify')""",
        (uid, code_hash)
    )
    conn2.commit()
    conn2.close()

    _NL = chr(10)
    body = (
        "হ্যালো " + str(uname) + "," + _NL + _NL +
        "JUKTOY-তে email verify করার জন্য আপনার কোড:" + _NL + _NL +
        "        " + code + _NL + _NL +
        "কোডটি ১০ মিনিটের জন্য বৈধ।" + _NL + _NL +
        "আপনি না করে থাকলে এই email উপেক্ষা করুন।" + _NL + _NL +
        "— JUKTOY"
    )
    _send_email(email, "JUKTOY — Email verification code", body)

    return jsonify({
        "ok": True,
        "email": email,
        "verify_required": True,
        "message": "৬ ডিজিটের কোড email-এ পাঠানো হয়েছে",
    })


@app.route("/api/me/email/remove", methods=["POST"])
@login_required
def remove_email():
    d = request.json or {}
    password = d.get("password") or ""
    code = d.get("totp_code") or ""
    if not password:
        return jsonify({"error": "পাসওয়ার্ড দিন"}), 400
    uid = session["user_id"]
    # S15.5 — sensitive action verify
    ok, msg = _verify_sensitive_action(uid, password, code)
    if not ok:
        return jsonify({"error": msg}), 400
    conn = db()
    conn.execute("UPDATE users SET email=NULL, email_verified=0 WHERE id=?", (uid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/me/email/confirm-code", methods=["POST"])
@login_required
@rate_limit("email_confirm", 10, 900)
def confirm_email_code():
    """S27B fix — verify 6-digit code sent to user's email."""
    uid = session["user_id"]
    d = request.json or {}
    code = (d.get("code") or "").strip()

    if not code or len(code) != 6 or not code.isdigit():
        return jsonify({"error": "৬ ডিজিটের কোড দিন"}), 400

    conn = db()
    # Get latest unexpired email_verify token for this user
    rows = conn.execute(
        """SELECT id, token_hash FROM password_resets
           WHERE user_id=? AND purpose='email_verify' AND used=0
             AND expires_at > datetime('now')
           ORDER BY id DESC LIMIT 5""",
        (uid,)
    ).fetchall()

    matched_id = None
    for r in rows:
        try:
            if _verify_secure_hash(code, r["token_hash"]):
                matched_id = r["id"]
                break
        except Exception:
            continue

    if not matched_id:
        conn.close()
        _log_security_event("email_confirm_fail", uid=uid)
        return jsonify({"error": "ভুল কোড বা মেয়াদ শেষ"}), 400

    # Consume token + verify email
    conn.execute("UPDATE password_resets SET used=1 WHERE id=?", (matched_id,))
    conn.execute("UPDATE users SET email_verified=1 WHERE id=?", (uid,))
    conn.commit()
    conn.close()

    _log_security_event("email_verified", uid=uid)
    return jsonify({"ok": True, "message": "Email যাচাই সম্পন্ন হয়েছে ✅"})


@app.route("/api/me/email/resend-code", methods=["POST"])
@login_required
@rate_limit("email_resend_code", 3, 3600)
def resend_email_code():
    """S27B fix — resend verification code."""
    uid = session["user_id"]
    conn = db()
    row = conn.execute(
        "SELECT username, email, COALESCE(email_verified,0) AS ev FROM users WHERE id=?",
        (uid,)
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    if not row["email"]:
        conn.close()
        return jsonify({"error": "আগে ইমেইল যোগ করুন"}), 400
    if row["ev"]:
        conn.close()
        return jsonify({"ok": True, "already_verified": True})

    code = str(secrets.randbelow(900000) + 100000)
    code_hash = make_password_hash(code)
    conn.execute(
        "DELETE FROM password_resets WHERE user_id=? AND purpose='email_verify'",
        (uid,)
    )
    conn.execute(
        """INSERT INTO password_resets (user_id, token_hash, expires_at, purpose)
           VALUES (?, ?, datetime('now', '+10 minutes'), 'email_verify')""",
        (uid, code_hash)
    )
    conn.commit()
    email = row["email"]
    uname = row["username"]
    conn.close()

    _NL = chr(10)
    body = (
        "হ্যালো " + str(uname) + "," + _NL + _NL +
        "আপনার নতুন verification code:" + _NL + _NL +
        "        " + code + _NL + _NL +
        "কোডটি ১০ মিনিটের জন্য বৈধ।" + _NL + _NL +
        "— JUKTOY"
    )
    _send_email(email, "JUKTOY — Email verification code", body)
    return jsonify({"ok": True, "message": "নতুন কোড পাঠানো হয়েছে"})


@app.route("/api/me/email/verify", methods=["POST"])
def verify_email_token():
    """Email verification — no login required; token proves ownership."""
    d = request.json or {}
    token = (d.get("token") or "").strip()
    if not token:
        return jsonify({"error": "টোকেন দিন"}), 400
    uid = _verify_reset_token(token)
    if not uid:
        return jsonify({"error": "লিংকটি invalid বা expire হয়েছে"}), 400
    conn = db()
    conn.execute("UPDATE users SET email_verified=1 WHERE id=?", (uid,))
    conn.execute("UPDATE password_resets SET used=1 WHERE token_hash=?",
                 (hashlib.sha256(token.encode()).hexdigest(),))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/auth/forgot/send", methods=["POST"])
@rate_limit("forgot_send", 5, 900)
def forgot_send():
    d = request.json or {}
    email = (d.get("email") or "").strip().lower()
    if not _is_valid_email(email):
        return jsonify({"error": "বৈধ ইমেইল দিন"}), 400

    _t0 = time.time()
    conn = db()
    row = conn.execute("SELECT id, username FROM users WHERE LOWER(email)=?",
                       (email,)).fetchone()
    conn.close()

    if row:
        token = _create_reset_token(row["id"])
        base = _app_url()
        link = f"{base}/#reset={token}"
        _safe_uname = _html.escape(row["username"] or "")
        html = (
            f"<div style='font-family:sans-serif;max-width:520px;margin:auto;padding:24px'>"
            f"<h2 style='color:#1877f2'>JUKTOY পাসওয়ার্ড রিসেট</h2>"
            f"<p>হ্যালো <strong>{_safe_uname}</strong>,</p>"
            f"<p>পাসওয়ার্ড রিসেট করতে নিচের বাটনে ক্লিক করুন:</p>"
            f"<p style='text-align:center;margin:24px 0'>"
            f"<a href='{link}' style='background:#1877f2;color:#fff;padding:12px 24px;"
            f"border-radius:8px;text-decoration:none;font-weight:600'>পাসওয়ার্ড রিসেট</a></p>"
            f"<p style='color:#666;font-size:13px'>অথবা এই লিংক কপি করুন:<br>{link}</p>"
            f"<p style='color:#666;font-size:13px'>লিংকটি ১৫ মিনিট পর expire হবে।</p>"
            f"<p style='color:#666;font-size:13px'>আপনি অনুরোধ না করলে ইমেইল উপেক্ষা করুন।</p>"
            f"</div>"
        )
        text = (
            f"হ্যালো {row['username']},\n\n"
            f"পাসওয়ার্ড রিসেট করতে এই লিংকে যান:\n{link}\n\n"
            f"লিংকটি ১৫ মিনিট পর expire হবে।\n"
            f"আপনি অনুরোধ না করলে ইমেইল উপেক্ষা করুন।\n\n— JUKTOY"
        )
        _send_email(email, "JUKTOY — পাসওয়ার্ড রিসেট", text, html)

    _el = time.time() - _t0
    if _el < 0.6:
        time.sleep(0.6 - _el)

    return jsonify({"ok": True})


@app.route("/api/auth/reset/check", methods=["POST"])
def reset_check():
    d = request.json or {}
    token = (d.get("token") or "").strip()
    uid = _verify_reset_token(token)
    if not uid:
        return jsonify({"valid": False})
    conn = db()
    row = conn.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
    conn.close()
    return jsonify({"valid": True, "username": row["username"] if row else ""})


@app.route("/api/auth/reset/complete", methods=["POST"])
@rate_limit("reset_complete", 10, 3600)
def reset_complete():
    d = request.json or {}
    token = (d.get("token") or "").strip()
    new_pw = d.get("new_password") or ""
    if not token or not new_pw:
        return jsonify({"error": "সব তথ্য দিন"}), 400
    # S15.1 — strong password check (+ S15.7 breach check)
    ok, msg = validate_password_strength(new_pw, check_breach=True)
    if not ok:
        return jsonify({"error": msg}), 400

    uid = _verify_reset_token(token)
    if not uid:
        return jsonify({"error": "লিংকটি invalid বা expire হয়েছে"}), 400

    new_hash = make_password_hash(new_pw)
    conn = db()
    conn.execute("""UPDATE users SET password_hash=?, salt='',
                    session_version = COALESCE(session_version,0) + 1
                    WHERE id=?""", (new_hash, uid))
    conn.commit()
    conn.close()

    _consume_reset_token(token)
    return jsonify({"ok": True})


# ============================================
# S15.5 — SENSITIVE ACTION VERIFICATION
# ============================================

def _verify_sensitive_action(uid, password, code=None):
    """Verify user for a sensitive action.
    Returns (ok, error_message).

    S29.22 - explicit scope note:
      This verifier gates SENSITIVE post-login actions (password change,
      account deletion, email removal, session revoke, 2FA disable,
      recovery-code regeneration). It checks:
        (a) the account password, and
        (b) IF totp_enabled = 1, a TOTP code (or backup code).

      Email-based 2FA (email_2fa_enabled) is NOT checked here on purpose:
      it protects the LOGIN step only. Requiring an email round-trip for
      every sensitive action would deadlock the UI when SMTP is slow.
      The frontend (_askSensitiveVerify) is aligned to this contract —
      it prompts for a code only when totp_enabled is true.
    """
    conn = db()
    row = conn.execute("""SELECT salt, password_hash,
                                 COALESCE(totp_enabled,0) AS tfa,
                                 totp_secret, COALESCE(backup_codes,'') AS bc
                          FROM users WHERE id=?""", (uid,)).fetchone()
    conn.close()
    if not row:
        return False, "ইউজার পাওয়া যায়নি"

    # Verify password
    ok, _ = verify_password(password, row["password_hash"], row["salt"])
    if not ok:
        return False, "পাসওয়ার্ড ভুল"

    # If 2FA is enabled, verify code
    if row["tfa"]:
        if not code:
            return False, "2FA কোড দিন"
        code_str = str(code).strip().upper().replace(" ", "")

        # Try TOTP
        if _verify_totp(row["totp_secret"], code_str):
            return True, None

        # Try backup code
        if len(code_str) >= 8:
            ok_bk, new_bc = _verify_backup_code(row["bc"], code_str)
            if ok_bk:
                conn = db()
                conn.execute("UPDATE users SET backup_codes=? WHERE id=?", (new_bc, uid))
                conn.commit()
                conn.close()
                return True, None

        return False, "2FA কোড ভুল"

    return True, None


# ============================================
# S15.4 — ACTIVE SESSIONS TRACKING
# ============================================

def _create_session_record(uid, method="password"):
    """Create a sessions row and store token in flask session."""
    token = secrets.token_urlsafe(32)
    ua = request.headers.get("User-Agent") or ""
    ip = _client_ip()
    label = _ua_to_device_label(ua)

    conn = db()
    cur = conn.execute("""INSERT INTO sessions
        (user_id, token, ip, user_agent, device_label, method)
        VALUES (?,?,?,?,?,?)""",
        (uid, token, ip, ua[:500], label, method))
    sid = cur.lastrowid
    conn.commit()
    conn.close()

    session["session_sid"] = token
    return sid, token


def _touch_session(uid):
    """Update last_seen for current session. Return True if session is valid."""
    token = session.get("session_sid")
    if not token:
        return True  # old session without tracking
    conn = db()
    row = conn.execute("SELECT id, user_id FROM sessions WHERE token=?",
                       (token,)).fetchone()
    if not row or row["user_id"] != uid:
        conn.close()
        return False  # session revoked
    conn.execute("UPDATE sessions SET last_seen=CURRENT_TIMESTAMP WHERE id=?",
                 (row["id"],))
    conn.commit()
    conn.close()
    return True


def _revoke_session(sid):
    conn = db()
    conn.execute("DELETE FROM sessions WHERE id=?", (sid,))
    conn.commit()
    conn.close()


def _revoke_all_sessions(uid, except_token=None):
    conn = db()
    if except_token:
        conn.execute("DELETE FROM sessions WHERE user_id=? AND token!=?",
                     (uid, except_token))
    else:
        conn.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
    conn.commit()
    conn.close()


def _bootstrap_admin_if_missing():
    """S22 / Series 11 — Auto-create admin on startup if missing.

    Runs when:
      - JUKTOY_ADMIN_USERNAME set (always)
      - JUKTOY_ADMIN_PASSWORD set (required for auto-create)
      - Admin user does NOT already exist in DB

    Skip silently if any condition fails. Idempotent — safe to run every boot.
    """
    if not ADMIN_PASSWORD:
        return
    try:
        conn = db()
        row = conn.execute(
            "SELECT id FROM users WHERE LOWER(username)=?", (ADMIN_USERNAME,)
        ).fetchone()
        if row:
            print(f"[BOOTSTRAP] Admin @{ADMIN_USERNAME} already exists — skipping")
            conn.close()
            return

        # Create admin
        pw_hash = make_password_hash(ADMIN_PASSWORD)
        cur = conn.execute("""
            INSERT INTO users
              (username, display_name, password_hash, salt, is_admin, is_private, onboarded)
            VALUES (?, ?, ?, '', 1, 1, 1)
        """, (ADMIN_USERNAME, "Sumon Islam", pw_hash))
        conn.commit()
        conn.close()
        print(f"[BOOTSTRAP] ✅ Admin @{ADMIN_USERNAME} auto-created (id={cur.lastrowid})")
    except sqlite3.IntegrityError as e:
        print(f"[BOOTSTRAP] Admin already exists (race): {e}")
    except Exception as e:
        print(f"[BOOTSTRAP] ❌ Failed: {e}")


def _run_startup_migrations():
    """S27B hotfix - ensure ALL schema migrations applied at startup.
    Render's ephemeral DB may not have latest schema.

    S29.11 - harden connection handling:
      - row_factory = sqlite3.Row so column access is by name (r["name"])
        instead of positional (r[1]). PRAGMA table_info order is stable
        today but this prevents silent breakage if sqlite ever changes.
      - try/finally so the connection closes even if an exception fires
        mid-migration.
      - busy_timeout pragma matches db() so concurrent writers don't
        crash the boot.
    """
    try:
        conn = sqlite3.connect(DB, timeout=10.0)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA busy_timeout=5000")
            c = conn.cursor()
            migrations = [
                ("password_resets", "purpose",              "TEXT NOT NULL DEFAULT 'password_reset'"),
                ("users",           "email_2fa_enabled",   "INTEGER DEFAULT 0"),
                ("users",           "phone",               "TEXT"),
                ("users",           "phone_verified",      "INTEGER DEFAULT 0"),
                ("users",           "phone_verified_at",   "TIMESTAMP"),
                ("users",           "recovery_code_hash",  "TEXT"),
                ("users",           "backup_email",        "TEXT"),
                ("users",           "backup_email_verified","INTEGER DEFAULT 0"),
                ("users",           "last_seen",           "TIMESTAMP"),
                ("call_sessions",   "caller_last_seen",    "TIMESTAMP"),
                ("call_sessions",   "callee_last_seen",    "TIMESTAMP"),
                ("follows",         "status",              "TEXT DEFAULT 'accepted'"),
                ("follows",         "is_close",            "INTEGER DEFAULT 0"),
                ("follows",         "is_favorite",         "INTEGER DEFAULT 0"),
            ]
            added = 0
            for table, col, typ in migrations:
                try:
                    existing = [
                        r["name"]
                        for r in c.execute(f"PRAGMA table_info({table})").fetchall()
                    ]
                    if col not in existing:
                        c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
                        added += 1
                        print(f"[MIGRATE] added {table}.{col}")
                except Exception as e:
                    print(f"[MIGRATE] {table}.{col} skipped: {e}")
            conn.commit()
            print(
                f"[MIGRATE] {added} column(s) added"
                if added else "[MIGRATE] schema up to date"
            )
        finally:
            conn.close()
    except Exception as e:
        print(f"[MIGRATE] error: {e}")



def _purge_old_sessions():
    """Remove sessions older than 30 days."""
    try:
        conn = db()
        conn.execute("DELETE FROM sessions WHERE last_seen < datetime('now', '-30 days')")
        conn.commit()
        conn.close()
    except Exception:
        pass


# ============================================
# S15.4 — SESSIONS API
# ============================================

@app.route("/api/me/sessions")
@login_required
def my_sessions():
    uid = session["user_id"]
    current_token = session.get("session_sid")
    conn = db()
    rows = conn.execute("""SELECT id, token, ip, device_label, method, created_at, last_seen
                           FROM sessions WHERE user_id=?
                           ORDER BY last_seen DESC LIMIT 50""", (uid,)).fetchall()
    conn.close()

    method_labels = {
        "password": "পাসওয়ার্ড", "google": "Google",
        "2fa": "2FA", "recovery": "রিকভারি কোড",
    }
    out = []
    for r in rows:
        d = dict(r)
        d["is_current"] = (r["token"] == current_token)
        d["method_label"] = method_labels.get(d["method"], d["method"])
        d.pop("token", None)  # don't expose token
        out.append(d)
    return jsonify(out)


@app.route("/api/me/sessions/<int:sid>/revoke", methods=["POST"])
@login_required
def revoke_my_session(sid):
    uid = session["user_id"]
    current_token = session.get("session_sid")
    conn = db()
    row = conn.execute("SELECT token FROM sessions WHERE id=? AND user_id=?",
                       (sid, uid)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "সেশন পাওয়া যায়নি"}), 404
    if row["token"] == current_token:
        conn.close()
        return jsonify({"error": "চলতি সেশন বাতিল করা যাবে না। লগআউট ব্যবহার করুন।"}), 400
    conn.execute("DELETE FROM sessions WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/me/sessions/revoke-others", methods=["POST"])
@login_required
def revoke_others():
    d = request.json or {}
    password = d.get("password") or ""
    code = d.get("totp_code") or ""
    if not password:
        return jsonify({"error": "পাসওয়ার্ড দিন"}), 400
    uid = session["user_id"]
    # S15.5 — sensitive action verify
    ok, msg = _verify_sensitive_action(uid, password, code)
    if not ok:
        return jsonify({"error": msg}), 400
    current_token = session.get("session_sid")
    _revoke_all_sessions(uid, except_token=current_token)
    return jsonify({"ok": True})


# ============================================
# S15.3 — LOGIN ALERTS (new device detection)
# ============================================

def _ua_to_device_label(ua):
    """Human-friendly device name from User-Agent."""
    ua = (ua or "").lower()
    if "android" in ua and "mobile" in ua: return "Android phone"
    if "android" in ua: return "Android tablet"
    if "iphone" in ua: return "iPhone"
    if "ipad" in ua: return "iPad"
    if "windows" in ua: return "Windows PC"
    if "macintosh" in ua or "mac os" in ua: return "Mac"
    if "linux" in ua: return "Linux PC"
    if "chrome" in ua: return "Chrome browser"
    if "firefox" in ua: return "Firefox browser"
    if "safari" in ua: return "Safari browser"
    return "Unknown device"


def _record_login(uid, method="password"):
    """Insert a login record. Return True if it's a new device."""
    ua = request.headers.get("User-Agent") or ""
    ip = _client_ip()
    label = _ua_to_device_label(ua)

    # Compute an IP subnet key
    ip_key = ip
    if ":" not in ip:
        parts = ip.split(".")
        if len(parts) == 4:
            ip_key = ".".join(parts[:3])

    conn = db()
    # Check if we've seen this user+ip_subnet+ua combo before
    prior = conn.execute("""SELECT 1 FROM login_history
        WHERE user_id=?
          AND substr(ip, 1, length(?))=?
          AND user_agent=?
        LIMIT 1""", (uid, ip_key, ip_key, ua)).fetchone()
    is_new = 1 if not prior else 0

    conn.execute("""INSERT INTO login_history
        (user_id, ip, user_agent, device_label, method, is_new_device)
        VALUES (?,?,?,?,?,?)""", (uid, ip, ua[:500], label, method, is_new))
    conn.commit()
    conn.close()
    return bool(is_new)


def _send_login_alert(uid, method="password", ua="", ip=""):
    """Send email alert about new device login.
    NOTE: ua and ip must be captured BEFORE spawning thread (request context not available in thread)."""
    try:
        conn = db()
        row = conn.execute("SELECT username, display_name, email FROM users WHERE id=?",
                           (uid,)).fetchone()
        conn.close()
        if not row or not row["email"]:
            print(f"[LOGIN ALERT] user {uid} has no email")
            return
        email = row["email"]
        if not _is_valid_email(email):
            print(f"[LOGIN ALERT] invalid email: {email}")
            return

        label = _ua_to_device_label(ua)
        now = time.strftime("%d %b %Y, %H:%M", time.localtime())
        method_label = {
            "password": "পাসওয়ার্ড",
            "google": "Google",
            "2fa": "2FA + পাসওয়ার্ড",
            "recovery": "রিকভারি কোড",
        }.get(method, method)

        subject = "🔔 JUKTOY — নতুন ডিভাইস থেকে লগইন"
        text = (
            f"হ্যালো {row['display_name']},\n\n"
            f"আপনার JUKTOY অ্যাকাউন্টে নতুন একটি ডিভাইস থেকে লগইন হয়েছে।\n\n"
            f"📱 ডিভাইস: {label}\n"
            f"🌐 IP: {ip}\n"
            f"🔑 পদ্ধতি: {method_label}\n"
            f"🕒 সময়: {now}\n\n"
            f"⚠️ যদি আপনি না করে থাকেন, সাথে সাথে পাসওয়ার্ড পরিবর্তন করুন এবং সব ডিভাইস থেকে লগআউট করুন।\n\n"
            f"— JUKTOY Security"
        )
        _safe_dn = _html.escape(row["display_name"] or "")
        _safe_ua = _html.escape(label or "")
        _safe_ip = _html.escape(ip or "")
        html = (
            f"<div style='font-family:sans-serif;max-width:520px;margin:auto;padding:24px'>"
            f"<h2 style='color:#1877f2'>🔔 নতুন ডিভাইস লগইন</h2>"
            f"<p>হ্যালো <strong>{_safe_dn}</strong>,</p>"
            f"<p>আপনার অ্যাকাউন্টে নতুন একটি ডিভাইস থেকে লগইন হয়েছে:</p>"
            f"<ul style='line-height:1.8'>"
            f"<li>📱 ডিভাইস: <strong>{_safe_ua}</strong></li>"
            f"<li>🌐 IP: <code>{_safe_ip}</code></li>"
            f"<li>🔑 পদ্ধতি: {method_label}</li>"
            f"<li>🕒 সময়: {now}</li>"
            f"</ul>"
            f"<p style='color:#ef4444'><strong>⚠️ আপনি না করে থাকলে</strong> — "
            f"সাথে সাথে পাসওয়ার্ড পরিবর্তন করুন।</p>"
            f"<p style='color:#666;font-size:13px'>— JUKTOY Security</p>"
            f"</div>"
        )
        _send_email(email, subject, text, html)
    except Exception as e:
        print(f"[LOGIN ALERT] failed: {e}")


def _login_alert_async(uid, method="password", ua="", ip=""):
    """Run alert in background thread so login isn't delayed."""
    def _run():
        try:
            _send_login_alert(uid, method, ua, ip)
        except Exception as e:
            import traceback
            print(f"[LOGIN ALERT async] {e}")
            traceback.print_exc()
    t = threading.Thread(target=_run, daemon=True)
    t.start()


def _admin_login_alert_async(uid, ua="", ip=""):
    """S22 / Layer 3 — urgent alert on EVERY admin login (not just new device)."""
    def _run():
        try:
            conn = db()
            row = conn.execute(
                "SELECT username, display_name, email FROM users WHERE id=?",
                (uid,)
            ).fetchone()
            conn.close()
            if not row or not row["email"] or not _is_valid_email(row["email"]):
                return
            label = _ua_to_device_label(ua)
            now = time.strftime("%d %b %Y, %H:%M", time.localtime())
            subject = "🔐 JUKTOY — ADMIN লগইন সতর্কতা"
            text = (
                f"হ্যালো {row['display_name']},\n\n"
                f"আপনার ADMIN অ্যাকাউন্টে সদ্য লগইন হয়েছে।\n\n"
                f"📱 ডিভাইস: {label}\n"
                f"🌐 IP: {ip}\n"
                f"🕒 সময়: {now}\n\n"
                f"⚠️ আপনি না করলে সাথে সাথে পাসওয়ার্ড পরিবর্তন করুন "
                f"এবং সব ডিভাইস থেকে লগআউট করুন।\n\n"
                f"— JUKTOY Security"
            )
            _send_email(row["email"], subject, text)
        except Exception as e:
            print(f"[ADMIN ALERT] failed: {e}")
    t = threading.Thread(target=_run, daemon=True)
    t.start()


# ============================================
# S15.2 — SESSION FINGERPRINT (IP + UA binding)
# ============================================

def _session_fp():
    """Compute fingerprint from current request (UA + IP)."""
    ua = (request.headers.get("User-Agent") or "")[:500]
    ip = _client_ip()
    # Use first /24 for IPv4 (allow subnet roaming) or full IPv6 prefix
    ip_key = ip
    if ":" not in ip:
        parts = ip.split(".")
        if len(parts) == 4:
            ip_key = ".".join(parts[:3])  # /24
    raw = (ua + "|" + ip_key).encode()
    return hashlib.sha256(raw).hexdigest()


def _bind_session():
    """Called at login. Store fingerprint."""
    session["session_fp"] = _session_fp()
    session["session_ip"] = _client_ip()
    session["session_ua"] = (request.headers.get("User-Agent") or "")[:200]
    session["session_fp_set_at"] = int(time.time())


def _session_fp_ok():
    """Return (ok, reason) for current session fingerprint."""
    stored = session.get("session_fp")
    if not stored:
        # Older session without fingerprint — bind now
        _bind_session()
        return True, None
    current = _session_fp()
    if secrets.compare_digest(stored, current):
        return True, None

    # Mismatch — check age
    set_at = session.get("session_fp_set_at", 0)
    age = time.time() - set_at
    GRACE = 300  # 5 minutes
    if age < GRACE:
        # Allow and re-bind (legitimate network change during login)
        _bind_session()
        return True, None

    return False, "আপনার সেশনের অবস্থান/ব্রাউজার পরিবর্তন হয়েছে। নিরাপত্তার জন্য আবার লগইন করুন।"


@app.route("/api/me/logins")
@login_required
def my_login_history():
    """Return recent login records."""
    uid = session["user_id"]
    limit = min(int(request.args.get("limit") or 20), 100)
    conn = db()
    rows = conn.execute("""SELECT id, ip, device_label, method, is_new_device, created_at
                           FROM login_history
                           WHERE user_id=?
                           ORDER BY created_at DESC LIMIT ?""", (uid, limit)).fetchall()
    conn.close()

    method_labels = {
        "password": "পাসওয়ার্ড",
        "google": "Google",
        "2fa": "2FA",
        "recovery": "রিকভারি কোড",
    }
    out = []
    for r in rows:
        d = dict(r)
        d["method_label"] = method_labels.get(d["method"], d["method"])
        out.append(d)
    return jsonify(out)


@app.route("/api/me/sessions/clear", methods=["POST"])
@login_required
def clear_my_login_history():
    """Delete own login history."""
    uid = session["user_id"]
    conn = db()
    conn.execute("DELETE FROM login_history WHERE user_id=?", (uid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ============================================
# S14 — ADMIN / MODERATION HELPERS
# ============================================

def _is_admin(uid):
    """Check if user has admin flag."""
    if not uid:
        return False
    conn = db()
    row = conn.execute("SELECT COALESCE(is_admin,0) AS a FROM users WHERE id=?",
                       (uid,)).fetchone()
    conn.close()
    return bool(row and row["a"])


def _is_banned(uid):
    """Return (is_banned, banned_until, reason)."""
    if not uid:
        return False, None, None
    conn = db()
    row = conn.execute("""SELECT banned_until, ban_reason FROM users WHERE id=?""",
                       (uid,)).fetchone()
    conn.close()
    if not row:
        return False, None, None
    bu = row["banned_until"]
    if not bu:
        return False, None, None
    # Compare with current time
    conn = db()
    still = conn.execute("SELECT datetime('now') < datetime(?) AS s", (bu,)).fetchone()["s"]
    conn.close()
    if still:
        return True, bu, row["ban_reason"]
    # Expired — clear
    conn = db()
    conn.execute("UPDATE users SET banned_until=NULL, ban_reason=NULL WHERE id=?", (uid,))
    conn.commit()
    conn.close()
    return False, None, None


def _get_client_ip_key():
    """S22 / Layer 7 — normalize client IP to /24 (IPv4) or prefix (IPv6).

    Used for admin session IP binding. Returning a subnet (not exact IP)
    allows minor network changes (mobile NAT, ISP reassignment) without
    killing the session, while still blocking cross-network hijacks.
    """
    ip = _client_ip()
    if ":" not in ip:
        parts = ip.split(".")
        if len(parts) == 4:
            return ".".join(parts[:3])           # IPv4 /24
    parts = ip.split(":")
    return ":".join(parts[:4])                   # IPv6 /64


def _is_admin_id(target_uid):
    """S22 / Series 27A-2 — check if a user_id belongs to an admin.
    Used to hide admin profiles from non-admin viewers everywhere."""
    if not target_uid:
        return False
    try:
        conn = db()
        row = conn.execute(
            "SELECT COALESCE(is_admin, 0) AS a FROM users WHERE id=?",
            (target_uid,)
        ).fetchone()
        conn.close()
        return bool(row and row["a"])
    except Exception:
        return False


def _is_public_action_blocked_for_admin():
    """S22 / Series 27A — admin account cannot perform public actions.

    Admin username must NEVER leak via posts, comments, likes, messages,
    follows, etc. This helper blocks all public activity from admin.
    Private admin actions (settings, 2FA, panel) are unaffected.

    S29.21 — scope clarification (why DM is blocked):
      "public action" here means ANY action that could surface the admin
      username to a non-admin user's UI. That includes DMs, since a DM
      reveals the sender's username in the recipient's chat list and
      conversation header. The admin account is a maintenance identity,
      not a social one — it never initiates contact. If a policy change
      ever requires admin outreach (e.g. moderation notices), do NOT
      route it through /api/messages; add a dedicated moderation-notice
      endpoint that renders as a system message with no reply path.
    """
    uid = session.get("user_id")
    if uid and _is_admin(uid):
        return jsonify({
            "error": "Admin অ্যাকাউন্ট শুধু প্রশাসনিক কাজের জন্য। Public activity বন্ধ।"
        }), 403
    return None


def admin_required_no_2fa(fn):
    """S27B — admin check WITHOUT 2FA (debug only)."""
    @wraps(fn)
    def wrapper(*a, **kw):
        uid = session.get("user_id")
        if not uid:
            return jsonify({"error": "লগইন প্রয়োজন"}), 401
        if not _is_admin(uid):
            return jsonify({"error": "শুধু অ্যাডমিন অ্যাক্সেস করতে পারবেন"}), 403
        return fn(*a, **kw)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        uid = session.get("user_id")
        if not uid:
            return jsonify({"error": "লগইন প্রয়োজন"}), 401
        if not _is_admin(uid):
            return jsonify({"error": "শুধু অ্যাডমিন অ্যাক্সেস করতে পারবেন"}), 403
        # S22 / Layer 7 — admin session IP binding
        stored_ip = session.get("admin_ip")
        if stored_ip:
            current_ip = _get_client_ip_key()
            if not secrets.compare_digest(stored_ip, current_ip):
                _log_security_event("admin_ip_mismatch", uid=uid,
                                    metadata={"expected": stored_ip,
                                              "got": current_ip})
                session.clear()
                return jsonify({
                    "error": "সেশনের অবস্থান পরিবর্তন হয়েছে। আবার লগইন করুন।"
                }), 401

        # S22 / Layer 6 + S27B-4 — admin MUST have 2FA enabled
        # Accept EITHER TOTP (authenticator) OR email-based 2FA
        if ADMIN_2FA_ENFORCED:
            conn = db()
            row = conn.execute(
                "SELECT COALESCE(totp_enabled, 0) AS totp, "
                "COALESCE(email_2fa_enabled, 0) AS email2fa "
                "FROM users WHERE id=?",
                (uid,)
            ).fetchone()
            conn.close()
            if not row or (not row["totp"] and not row["email2fa"]):
                return jsonify({
                    "error": "🛡️ অ্যাডমিন অ্যাক্সেসের জন্য 2FA চালু করা আবশ্যক। "
                             "Settings → Two-Factor Authentication থেকে চালু করুন।",
                    "needs_2fa_setup": True,
                }), 403

        return fn(*a, **kw)
    return wrapper


def _enforce_sole_admin():
    """S22 / Layer 8 + Layer 4 - sole admin policy + force private.

    S29.1 - Root-cause fix:
      Previously conn.close() ran BEFORE the is_private UPDATE,
      so the UPDATE hit a closed connection, raised ProgrammingError,
      and got silently swallowed by 'except Exception: pass'.
    """
    _SOLE = ADMIN_USERNAME
    try:
        conn = db()
        try:
            demoted = conn.execute(
                "UPDATE users SET is_admin=0 "
                "WHERE LOWER(username) != ? AND COALESCE(is_admin,0)=1",
                (_SOLE,)
            ).rowcount
            promoted = conn.execute(
                "UPDATE users SET is_admin=1 WHERE LOWER(username)=?",
                (_SOLE,)
            ).rowcount
            conn.execute(
                "UPDATE users SET is_private=1 WHERE LOWER(username)=?",
                (_SOLE,)
            )
            conn.commit()
            has = conn.execute(
                "SELECT 1 FROM users "
                "WHERE LOWER(username)=? AND COALESCE(is_admin,0)=1",
                (_SOLE,)
            ).fetchone()
            priv = conn.execute(
                "SELECT COALESCE(is_private,0) AS p "
                "FROM users WHERE LOWER(username)=?",
                (_SOLE,)
            ).fetchone()
        finally:
            conn.close()
        if demoted:
            print(f"[SOLE-ADMIN] Demoted {demoted} other admin(s)")
        if has:
            _priv_ok = bool(priv and priv["p"])
            _priv_note = "private" if _priv_ok else "!! NOT private - check DB"
            print(f"[SOLE-ADMIN] @{_SOLE} is the sole admin ({_priv_note})")
        else:
            print(
                f"[SOLE-ADMIN] @{_SOLE} not yet registered - "
                "will auto-admin on register/login"
            )
    except Exception as e:
        import traceback
        print(f"[SOLE-ADMIN] enforce failed: {e}")
        traceback.print_exc()
# ============================================
# S13-C — GOOGLE OAUTH ENDPOINT CONSTANTS
# ============================================
_GOOGLE_AUTH_URL     = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL    = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


def _google_config():
    cid = _os.environ.get("JUKTOY_GOOGLE_CLIENT_ID")
    secret = _os.environ.get("JUKTOY_GOOGLE_CLIENT_SECRET")
    if not cid or not secret:
        return None
    return {"client_id": cid, "client_secret": secret}


def _google_redirect_uri():
    """Must exactly match Google Cloud Console's Authorized redirect URIs."""
    base = _os.environ.get("JUKTOY_APP_URL")
    if base:
        return base.rstrip("/") + "/api/auth/google/callback"
    try:
        return request.url_root.rstrip("/") + "/api/auth/google/callback"
    except Exception:
        return "http://127.0.0.1:5000/api/auth/google/callback"


def _google_state_create():
    """Store state in session for CSRF protection."""
    state = secrets.token_urlsafe(24)
    session["google_oauth_state"] = state
    session["google_oauth_started"] = int(time.time())
    return state


def _google_state_verify(state):
    """Verify state matches session, then clear it."""
    saved = session.pop("google_oauth_state", None)
    started = session.pop("google_oauth_started", 0)
    if not saved or not state:
        return False
    if not secrets.compare_digest(saved, state):
        return False
    # 10 minute window
    if started and (time.time() - started) > 600:
        return False
    return True


def _google_http_post(url, data):
    """POST form data, return parsed JSON or raise."""
    body = _uparse.urlencode(data).encode()
    req = _ureq.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("Accept", "application/json")
    with _ureq.urlopen(req, timeout=15) as resp:
        return _json.loads(resp.read().decode())


def _google_http_get(url, bearer):
    """GET with Bearer token, return parsed JSON or raise."""
    req = _ureq.Request(url, method="GET")
    req.add_header("Authorization", "Bearer " + bearer)
    req.add_header("Accept", "application/json")
    with _ureq.urlopen(req, timeout=15) as resp:
        return _json.loads(resp.read().decode())


def _generate_unique_username_from_email(email):
    """Create a valid unique username based on email prefix."""
    base = (email or "").split("@")[0].lower()
    base = re.sub(r"[^a-z0-9_]", "", base) or "user"
    base = base[:24]
    conn = db()
    candidate = base
    i = 1
    while True:
        exists = conn.execute("SELECT 1 FROM users WHERE username=?", (candidate,)).fetchone()
        if not exists:
            conn.close()
            return candidate
        candidate = f"{base}{i}"
        i += 1
        if i > 9999:
            conn.close()
            return base + secrets.token_hex(3)


@app.route("/api/auth/google/login")
def google_login():
    """Redirect user to Google's OAuth consent screen."""
    cfg = _google_config()
    if not cfg:
        return jsonify({"error": "Google Sign-In কনফিগার করা হয়নি"}), 503

    state = _google_state_create()
    params = {
        "client_id": cfg["client_id"],
        "redirect_uri": _google_redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    url = _GOOGLE_AUTH_URL + "?" + _uparse.urlencode(params)
    return redirect(url, code=302)


@app.route("/api/auth/google/callback")
def google_callback():
    """Handle Google's callback: verify state, exchange code, login/create user."""
    # Check for errors from Google
    err = request.args.get("error")
    if err:
        return redirect("/?google_error=" + _uparse.quote(err), code=302)

    code = request.args.get("code")
    state = request.args.get("state")
    if not code or not state:
        return redirect("/?google_error=missing_code", code=302)
    if not _google_state_verify(state):
        return redirect("/?google_error=invalid_state", code=302)

    cfg = _google_config()
    if not cfg:
        return redirect("/?google_error=not_configured", code=302)

    # Exchange code for access token
    try:
        token_resp = _google_http_post(_GOOGLE_TOKEN_URL, {
            "code": code,
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "redirect_uri": _google_redirect_uri(),
            "grant_type": "authorization_code",
        })
    except Exception as e:
        print(f"[GOOGLE] token exchange failed: {e}")
        return redirect("/?google_error=token_exchange", code=302)

    access_token = token_resp.get("access_token")
    if not access_token:
        return redirect("/?google_error=no_token", code=302)

    # Fetch user info
    try:
        info = _google_http_get(_GOOGLE_USERINFO_URL, access_token)
    except Exception as e:
        print(f"[GOOGLE] userinfo failed: {e}")
        return redirect("/?google_error=userinfo", code=302)

    google_id = str(info.get("id") or "").strip()
    email = (info.get("email") or "").strip().lower()
    name = (info.get("name") or "").strip() or "Google User"
    picture = info.get("picture") or ""
    email_verified = bool(info.get("verified_email"))

    if not google_id:
        return redirect("/?google_error=no_google_id", code=302)

    conn = db()

    # Case 1: google_id already linked
    row = conn.execute("SELECT id, COALESCE(session_version,0) AS v FROM users WHERE google_id=?",
                       (google_id,)).fetchone()
    if row:
        uid = row["id"]
        ver = row["v"]
        # Optionally refresh profile pic if empty
        if picture:
            cur = conn.execute("SELECT profile_pic FROM users WHERE id=?", (uid,)).fetchone()
            if cur and not cur["profile_pic"]:
                conn.execute("UPDATE users SET profile_pic=? WHERE id=?", (picture, uid))
        conn.commit()
        conn.close()
        # Create session
        session.clear()
        session["user_id"] = uid
        session["session_version"] = ver
        session["session_start"] = int(time.time())
        session.permanent = True
        _bind_session()  # S15.2
        _create_session_record(uid, method="google")  # S15.4
        try:
            is_new = _record_login(uid, method="google")
            if is_new:
                _ua = request.headers.get("User-Agent") or ""
                _ip = _client_ip()
                _login_alert_async(uid, method="google", ua=_ua, ip=_ip)
        except Exception as e:
            print(f"[LOGIN RECORD google] {e}")
        return redirect("/", code=302)

    # Case 2: email exists — link google_id to existing account
    if email:
        row2 = conn.execute("SELECT id, COALESCE(session_version,0) AS v FROM users WHERE LOWER(email)=?",
                            (email,)).fetchone()
        if row2:
            uid = row2["id"]
            ver = row2["v"]
            conn.execute("UPDATE users SET google_id=?, email_verified=? WHERE id=?",
                         (google_id, 1 if email_verified else 0, uid))
            if picture:
                cur = conn.execute("SELECT profile_pic FROM users WHERE id=?", (uid,)).fetchone()
                if cur and not cur["profile_pic"]:
                    conn.execute("UPDATE users SET profile_pic=? WHERE id=?", (picture, uid))
            conn.commit()
            conn.close()
            session.clear()
            session["user_id"] = uid
            session["session_version"] = ver
            session["session_start"] = int(time.time())
            session.permanent = True
            return redirect("/", code=302)

    # Case 3: create a new account
    conn.close()
    username = _generate_unique_username_from_email(email or ("g" + google_id[:8]))

    conn = db()
    # Random password (never used — user logs in via Google)
    random_pw = secrets.token_urlsafe(32)
    pw_hash = make_password_hash(random_pw)

    try:
        cur = conn.execute("""INSERT INTO users
            (username, display_name, password_hash, salt, email, email_verified,
             google_id, profile_pic, onboarded)
            VALUES (?,?,?,?,?,?,?,?,0)""",
            (username, name, pw_hash, "", email or None, 1 if email_verified else 0,
             google_id, picture or None))
        uid = cur.lastrowid
        conn.commit()
    except sqlite3.IntegrityError as e:
        conn.close()
        print(f"[GOOGLE] insert failed: {e}")
        return redirect("/?google_error=create_failed", code=302)

    ver_row = conn.execute("SELECT COALESCE(session_version,0) AS v FROM users WHERE id=?",
                           (uid,)).fetchone()
    ver = ver_row["v"] if ver_row else 0
    conn.close()

    session.clear()
    session["user_id"] = uid
    session["session_version"] = ver
    session["session_start"] = int(time.time())
    session.permanent = True
    return redirect("/", code=302)


# ============================================
# AUTH
# ============================================

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/register", methods=["POST"])
@rate_limit("register", 3, 3600)
def register():
    # S29.6 - uniform response timing across ALL register paths.
    # Prevents username-enumeration via response-time side channel.
    # Every return pads to the same total wall-clock time so
    # DB-insert cost (success vs IntegrityError vs no-DB admin path)
    # cannot be observed by an attacker.
    _REG_MIN_SECONDS = 0.55
    _reg_start = time.time()

    def _reg_pad():
        _elapsed = time.time() - _reg_start
        if _elapsed < _REG_MIN_SECONDS:
            time.sleep(
                _REG_MIN_SECONDS - _elapsed
                + secrets.randbelow(80) / 1000.0
            )

    d = request.json or {}
    username = (d.get("username") or "").strip().lower()
    name = (d.get("display_name") or "").strip()
    pw = d.get("password") or ""

    if not username or not name or not pw:
        _reg_pad()
        return jsonify({"error": "সব তথ্য পূরণ করুন"}), 400
    if len(username) > 30 or len(name) > 60:
        _reg_pad()
        return jsonify({"error": "ইউজারনেম/নাম অনেক বড়"}), 400
    if not re.match(r"^[a-z0-9_]+$", username):
        _reg_pad()
        return jsonify({"error": "ইউজারনেমে শুধু a-z, 0-9, _ ব্যবহার করুন"}), 400

    # S15.1 - strong password check (+ S15.7 breach check)
    ok, msg = validate_password_strength(pw, check_breach=True)
    if not ok:
        _reg_pad()
        return jsonify({"error": msg}), 400

    # S29.6 - hash BEFORE the admin-key branch so both admin and
    # non-admin paths incur the same scrypt cost.
    pw_hash = make_password_hash(pw)

    # S22 / Layer 1 - admin register protection
    if username == ADMIN_USERNAME:
        provided_key = (d.get("admin_key") or "").strip()
        if not ADMIN_KEY:
            print("[S22] Blocked admin register attempt (no JUKTOY_ADMIN_KEY set on server)")
            _log_security_event(
                "admin_register_blocked", username=username,
                metadata={"ip": request.remote_addr, "reason": "no_server_key"}
            )
            _reg_pad()
            return jsonify({"error": "এই ইউজারনেম দিয়ে সাইনআপ করা যাচ্ছে না। ভিন্ন নাম চেষ্টা করুন।"}), 400
        if provided_key != ADMIN_KEY:
            print(f"[S22] Blocked admin register attempt (wrong key) from IP {request.remote_addr}")
            _log_security_event(
                "admin_register_blocked", username=username,
                metadata={"ip": request.remote_addr, "reason": "wrong_key"}
            )
            _reg_pad()
            return jsonify({"error": "এই ইউজারনেম দিয়ে সাইনআপ করা যাচ্ছে না। ভিন্ন নাম চেষ্টা করুন।"}), 400

    conn = db()
    try:
        is_admin_flag = 1 if username == ADMIN_USERNAME else 0
        conn.execute(
            "INSERT INTO users (username, display_name, password_hash, salt, is_admin) VALUES (?,?,?,?,?)",
            (username, name, pw_hash, "", is_admin_flag)
        )
        conn.commit()
        if is_admin_flag:
            print(f"[SOLE-ADMIN] @{username} registered as THE admin")
    except sqlite3.IntegrityError:
        conn.close()
        _reg_pad()
        return jsonify({"error": "এই ইউজারনেম দিয়ে সাইনআপ করা যাচ্ছে না। ভিন্ন নাম চেষ্টা করুন।"}), 400
    conn.close()
    _reg_pad()
    return jsonify({"ok": True})

# S16.2b — precomputed dummy hash for constant-time login
#
# S29.13 - thread-safe lazy init.
# Under uvicorn/gunicorn each worker has its own Python interpreter,
# but WITHIN a worker, Flask's threaded mode runs handlers concurrently.
# Without a lock, a cold-start burst of N login requests would each see
# _DUMMY_PW_HASH is None and each run the full ~250ms scrypt — wasting
# N-1 CPU-heavy computations. Double-checked locking keeps the hot path
# lock-free and serializes only the one-time initialization.
_DUMMY_PW_HASH = None
_DUMMY_PW_LOCK = threading.Lock()


def _get_dummy_password_hash():
    """Return a cached hash used to keep login response timing constant.

    Non-existent users verify against this hash so both code paths
    (real + dummy) do identical scrypt work.

    S29.13 - double-checked locking:
      - fast path (no lock) once initialized
      - single lock acquisition during cold start only
    """
    global _DUMMY_PW_HASH
    if _DUMMY_PW_HASH is not None:      # fast path, no lock
        return _DUMMY_PW_HASH
    with _DUMMY_PW_LOCK:                 # cold path
        if _DUMMY_PW_HASH is None:       # double-check
            _DUMMY_PW_HASH = make_password_hash(
                "constant_time_dummy_" + secrets.token_urlsafe(16)
            )
        return _DUMMY_PW_HASH


@app.route("/api/login", methods=["POST"])
@rate_limit("login", 5, 900, per_username=True)
def login():
    d = request.json or {}
    username = (d.get("username") or "").strip().lower()
    pw = d.get("password") or ""

    # S22 / Layer 2 — stricter rate limit for admin username
    if username == ADMIN_USERNAME:
        ip = request.remote_addr or "unknown"
        if not _limiter.hit(f"admin_login:{ip}", 3, 3600):
            _log_security_event("admin_login_ratelimited", username=username)
            return jsonify({
                "error": "অনেক বেশি চেষ্টা হয়েছে। ১ ঘণ্টা পর আবার চেষ্টা করুন।"
            }), 429

    conn = db()
    row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()

    _t_start = time.time()  # S16.2b-DEBUG
    # S16.2b — constant-time compare:
    # Non-existent users go through the SAME code path as real users:
    # verify_password() against a precomputed dummy hash. Identical scrypt
    # cost → response time indistinguishable. No padding needed.
    if not row:
        conn.close()
        try:
            verify_password(pw or "_", _get_dummy_password_hash(), "")
        except Exception:
            pass        # S16.6 — log unknown-user attempt
        _log_security_event("login_fail_nouser", username=username)
        return jsonify({"error": "ভুল ইউজারনেম বা পাসওয়ার্ড"}), 400

    ok, new_hash = verify_password(pw, row["password_hash"], row["salt"])
    if not ok:
        conn.close()        # S16.6 — log failed login (bad password)
        _log_security_event("login_fail_password", uid=row["id"],
                            username=row["username"])
        return jsonify({"error": "ভুল ইউজারনেম বা পাসওয়ার্ড"}), 400
    # Silent migration: old hash → new secure hash
    if new_hash:
        conn.execute("UPDATE users SET password_hash=?, salt='' WHERE id=?",
                     (new_hash, row["id"]))
        conn.commit()
    # Get current session_version for this user
    ver_row = conn.execute("SELECT COALESCE(session_version, 0) AS v FROM users WHERE id=?",
                           (row["id"],)).fetchone()
    ver = ver_row["v"] if ver_row else 0

    # S12 + S27B-4 — 2FA flow. Email 2FA is PREFERRED when enabled.
    totp_enabled = row["totp_enabled"] if "totp_enabled" in row.keys() else 0
    email_2fa_enabled = 0
    try:
        email_2fa_enabled = row["email_2fa_enabled"] if "email_2fa_enabled" in row.keys() else 0
    except Exception:
        email_2fa_enabled = 0

    # Email 2FA takes priority when both are enabled
    if email_2fa_enabled:
        email_addr = row["email"] if "email" in row.keys() else None
        email_ok = False
        try:
            email_ok = bool(email_addr) and bool(row["email_verified"])
        except Exception:
            email_ok = False

        if email_ok:
            # Generate 6-digit code
            code = str(secrets.randbelow(900000) + 100000)
            code_hash = make_password_hash(code)
            conn.close()

            # Send email
            try:
                _NL = chr(10)
                body = (
                    "হ্যালো " + str(row["username"]) + "," + _NL + _NL +
                    "আপনার JUKTOY অ্যাকাউন্টে login verification code:" + _NL + _NL +
                    "        " + code + _NL + _NL +
                    "কোডটি 10 মিনিটের জন্য বৈধ।" + _NL + _NL +
                    "⚠️ আপনি না করে থাকলে এই ইমেইল উপেক্ষা করুন।" + _NL + _NL +
                    "— JUKTOY Security"
                )
                _send_email(email_addr, "JUKTOY — Login code", body)
            except Exception as e:
                print(f"[login-email-2fa] send failed: {e}")

            token = _pending_2fa_create(row["id"], ver, method="email", code_hash=code_hash)
            return jsonify({
                "needs_2fa": True,
                "temp_token": token,
                "method": "email",
                "email_masked": _mask_email(email_addr) if email_addr else "",
            })
        # fallback to TOTP if email not verified

    if totp_enabled:
        conn.close()
        token = _pending_2fa_create(row["id"], ver, method="totp")
        return jsonify({"needs_2fa": True, "temp_token": token, "method": "totp"})

    conn.close()

    # Sole-admin enforcement on login (in case DB reset removed flag)
    if username == ADMIN_USERNAME and not row["is_admin"]:
        conn = db()
        conn.execute("UPDATE users SET is_admin=1 WHERE id=?", (row["id"],))
        conn.commit()
        conn.close()
        print(f"[SOLE-ADMIN] Force-promoted @{username} on login")

    # S6 — rotate session on login (kill fixation)
    session.clear()
    session["user_id"] = row["id"]
    session["session_version"] = ver
    session["session_start"] = int(time.time())
    session["last_active"] = time.time()   # S16.5
    session.permanent = True
    # S15.2 — bind fingerprint
    _bind_session()
    # S15.4 — create session record
    _create_session_record(row["id"], method="password")
    # S16.6 — log successful login
    _log_security_event("login_success", uid=row["id"],
                        username=row["username"], metadata={"method": "password"})

    # S22 / Layer 7 — bind admin session to client IP
    _is_admin_user = bool(row["is_admin"]) or (username == ADMIN_USERNAME)
    if _is_admin_user:
        session["admin_ip"] = _get_client_ip_key()

    # S15.3 — record login + send alert if new device
    try:
        is_new = _record_login(row["id"], method="password")
        _ua = request.headers.get("User-Agent") or ""
        _ip = _client_ip()
        if is_new:
            _login_alert_async(row["id"], method="password", ua=_ua, ip=_ip)
        # S22 / Layer 3 — always alert on admin login (regardless of device)
        if _is_admin_user:
            _admin_login_alert_async(row["id"], ua=_ua, ip=_ip)
    except Exception as e:
        print(f"[LOGIN RECORD] {e}")
    return jsonify({"ok": True})


@app.route("/api/login/2fa", methods=["POST"])
def login_2fa():
    """S12 — second step of 2FA login."""
    d = request.json or {}
    token = (d.get("temp_token") or "").strip()
    code = (d.get("code") or "").strip().upper().replace(" ", "")

    if not token or not code:
        return jsonify({"error": "কোড দিন"}), 400

    rec = _pending_2fa_get(token)
    if not rec:
        return jsonify({"error": "সেশন শেষ হয়ে গেছে। আবার লগইন করুন।"}), 400

    # Rate limit 2FA attempts per token — max 5 tries
    if not _limiter.hit(f"2fa:{token}", 5, 900):
        _pending_2fa_consume(token)
        return jsonify({"error": "অনেক বেশি ভুল চেষ্টা। আবার লগইন করুন।"}), 429

    uid = rec["uid"]
    ver = rec["ver"]
    method = rec.get("method") or "totp"

    # S27B-4 — EMAIL method: verify 6-digit code against stored hash
    if method == "email":
        stored_hash = rec.get("code_hash") or ""
        if not stored_hash:
            _pending_2fa_consume(token)
            return jsonify({"error": "সেশন শেষ। আবার লগইন করুন।"}), 400
        try:
            ok_email = _verify_secure_hash(code, stored_hash)
        except Exception:
            ok_email = False
        if not ok_email:
            return jsonify({"error": "ভুল কোড। আবার চেষ্টা করুন।"}), 400

        _pending_2fa_consume(token)
        session.clear()
        session["user_id"] = uid
        session["session_version"] = ver
        session["session_start"] = int(time.time())
        session["last_active"] = time.time()
        session.permanent = True
        _bind_session()
        _create_session_record(uid, method="email_2fa")

        # Admin IP binding
        try:
            _c2 = db()
            _ar = _c2.execute("SELECT COALESCE(is_admin,0) AS a FROM users WHERE id=?", (uid,)).fetchone()
            _c2.close()
            if _ar and _ar["a"]:
                session["admin_ip"] = _get_client_ip_key()
        except Exception:
            pass

        _log_security_event("login_success_email_2fa", uid=uid)
        try:
            _ua = request.headers.get("User-Agent") or ""
            _ip = _client_ip()
            is_new = _record_login(uid, method="email_2fa")
            if is_new:
                _login_alert_async(uid, method="email_2fa", ua=_ua, ip=_ip)
        except Exception as e:
            print(f"[LOGIN RECORD email_2fa] {e}")

        return jsonify({"ok": True, "method": "email"})

    # TOTP method
    conn = db()
    row = conn.execute("""SELECT totp_secret, COALESCE(totp_enabled,0) AS en,
                                COALESCE(backup_codes,'') AS bc
                          FROM users WHERE id=?""", (uid,)).fetchone()
    if not row or not row["en"]:
        conn.close()
        _pending_2fa_consume(token)
        return jsonify({"error": "2FA নিষ্ক্রিয়"}), 400

    ok = _verify_totp(row["totp_secret"], code)
    used_backup = False
    new_bc = row["bc"]

    if not ok and len(code) >= 8:
        ok_bk, new_bc_after = _verify_backup_code(row["bc"], code)
        if ok_bk:
            ok = True
            used_backup = True
            new_bc = new_bc_after
            conn.execute("UPDATE users SET backup_codes=? WHERE id=?", (new_bc, uid))

    if not ok:
        conn.close()
        return jsonify({"error": "ভুল কোড। আবার চেষ্টা করুন।"}), 400

    conn.commit()
    conn.close()

    # Consume pending token, create real session
    _pending_2fa_consume(token)
    session.clear()
    session["user_id"] = uid
    session["session_version"] = ver
    session["session_start"] = int(time.time())
    session["last_active"] = time.time()   # S22 / Series 20 — idle timeout tracking
    session.permanent = True
    # S15.2 — bind fingerprint
    _bind_session()
    # S15.4 — create session record
    _create_session_record(uid, method="2fa")

    # S22 / Series 20 — admin IP binding on 2FA path
    # (was missing → admin session hijack bypass on 2FA logins)
    try:
        _c2 = db()
        _ar = _c2.execute(
            "SELECT COALESCE(is_admin,0) AS a, COALESCE(totp_enabled,0) AS tfa "
            "FROM users WHERE id=?", (uid,)
        ).fetchone()
        _c2.close()
        _is_adm = bool(_ar and _ar["a"])
        if _is_adm:
            session["admin_ip"] = _get_client_ip_key()
    except Exception:
        _is_adm = False

    # S16.6 — security event log
    try:
        _log_security_event(
            "login_success_2fa", uid=uid,
            metadata={"used_backup": used_backup}
        )
    except Exception:
        pass

    # S15.3 + S22 / Layer 3 — record login + send alerts
    try:
        _ua = request.headers.get("User-Agent") or ""
        _ip = _client_ip()
        is_new = _record_login(uid, method="2fa")
        if is_new:
            _login_alert_async(uid, method="2fa", ua=_ua, ip=_ip)
        if _is_adm:
            _admin_login_alert_async(uid, ua=_ua, ip=_ip)
    except Exception as e:
        print(f"[LOGIN RECORD 2fa] {e}")

    return jsonify({
        "ok": True,
        "used_backup": used_backup,
        "backup_codes_remaining": (len(new_bc.split(",")) if new_bc else 0) if used_backup else None,
    })


@app.route("/api/auth/recover-2fa/request", methods=["POST"])
@rate_limit("recover_2fa_req", 5, 900)
def recover_2fa_request():
    """S27B-3 (email-based) step 1 - request recovery code via email.

    S29.7 - uniform response timing across ALL paths.
      Previously the user-not-found branch used time.sleep(0.3),
      which produced an EXACTLY 300ms response while the
      wrong-password branch took a variable ~250-350ms (scrypt).
      An attacker could distinguish "username exists" by the
      fixed-vs-variable timing shape alone.

      Now: every path (missing user, wrong pw, no-2FA, no-email,
      success) pads to the same 550-630ms wall-clock window.
      Dummy scrypt on the not-found path ensures the CPU cost is
      also matched, not just the sleep.
    """
    _MIN = 0.55
    _t_start = time.time()

    def _pad():
        _el = time.time() - _t_start
        if _el < _MIN:
            time.sleep(_MIN - _el + secrets.randbelow(80) / 1000.0)

    d = request.json or {}
    username = (d.get("username") or "").strip().lower()
    password = d.get("password") or ""
    GENERIC = "ভুল তথ্য। নিশ্চিত হয়ে আবার চেষ্টা করুন।"

    if not username or not password:
        _pad()
        return jsonify({"error": "সব তথ্য পূরণ করুন"}), 400

    conn = db()
    row = conn.execute(
        """SELECT id, username, COALESCE(totp_enabled,0) AS tfa,
                  salt, password_hash, email, COALESCE(email_verified,0) AS ev
           FROM users WHERE LOWER(username)=?""",
        (username,)
    ).fetchone()

    # S29.7 - dummy scrypt on missing-user path so CPU cost matches
    if not row:
        conn.close()
        try:
            verify_password(password, _get_dummy_password_hash(), "")
        except Exception:
            pass
        _log_security_event("recover_2fa_req_nouser", username=username)
        _pad()
        return jsonify({"error": GENERIC}), 400

    pw_ok, _ = verify_password(password, row["password_hash"], row["salt"])
    if not pw_ok:
        conn.close()
        _log_security_event(
            "recover_2fa_req_fail", uid=row["id"], username=row["username"]
        )
        _pad()
        return jsonify({"error": GENERIC}), 400

    if not row["tfa"]:
        conn.close()
        _pad()
        return jsonify({"error": "এই অ্যাকাউন্টে 2FA চালু নেই। সরাসরি login করুন।"}), 400

    if not row["email"] or not row["ev"]:
        conn.close()
        _pad()
        return jsonify({"error": "এই অ্যাকাউন্টে verified email নেই। Admin-এর সাথে যোগাযোগ করুন।"}), 400

    # Generate 6-digit code + store hash + expiry
    code = str(secrets.randbelow(900000) + 100000)
    code_hash = make_password_hash(code)
    conn.execute("DELETE FROM password_resets WHERE user_id=? AND purpose='2fa_recovery'",
                 (row["id"],))
    conn.execute(
        """INSERT INTO password_resets (user_id, token_hash, expires_at, purpose)
           VALUES (?, ?, datetime('now', '+10 minutes'), '2fa_recovery')""",
        (row["id"], code_hash)
    )
    conn.commit()
    conn.close()

    # Send email
    try:
        _NL = chr(10)
        body = (
            "হ্যালো " + str(row["username"]) + "," + _NL + _NL +
            "আপনার JUKTOY অ্যাকাউন্টে 2FA রিকভারি অনুরোধ করা হয়েছে।" + _NL + _NL +
            "আপনার কোড: " + code + _NL + _NL +
            "কোডটি 10 মিনিটের জন্য বৈধ।" + _NL + _NL +
            "⚠️ আপনি না করে থাকলে এই ইমেইল উপেক্ষা করুন এবং সাথে সাথে পাসওয়ার্ড পরিবর্তন করুন।" + _NL + _NL +
            "— JUKTOY Security"
        )
        _send_email(row["email"], "JUKTOY — 2FA রিকভারি কোড", body)
    except Exception as e:
        print(f"[recover_2fa] send failed: {e}")

    _log_security_event("recover_2fa_code_sent", uid=row["id"], username=row["username"])
    _pad()
    return jsonify({
        "ok": True,
        "email_masked": _mask_email(row["email"]),
        "message": "রিকভারি কোড আপনার verified email-এ পাঠানো হয়েছে।",
    })



def _mask_email(email):
    try:
        local, _, domain = email.partition("@")
        if len(local) <= 2:
            masked_local = local[0] + "*"
        else:
            masked_local = local[0] + "*" * (len(local) - 2) + local[-1]
        return masked_local + "@" + domain
    except Exception:
        return "***"


@app.route("/api/auth/recover-2fa/verify", methods=["POST"])
@rate_limit("recover_2fa_ver", 10, 900)
def recover_2fa_verify():
    """S27B-3 (email-based) step 2 — submit email code → disable 2FA."""
    d = request.json or {}
    username = (d.get("username") or "").strip().lower()
    email_code = (d.get("email_code") or "").strip()
    GENERIC = "ভুল কোড বা মেয়াদ শেষ।"

    if not username or not email_code:
        return jsonify({"error": "সব তথ্য পূরণ করুন"}), 400

    conn = db()
    row = conn.execute(
        "SELECT id, username FROM users WHERE LOWER(username)=?",
        (username,)
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": GENERIC}), 400

    # Find latest unused 2fa_recovery token for this user
    tokens = conn.execute(
        """SELECT id, token_hash FROM password_resets
           WHERE user_id=? AND purpose='2fa_recovery' AND used=0
             AND expires_at > datetime('now')
           ORDER BY id DESC LIMIT 5""",
        (row["id"],)
    ).fetchall()

    matched_id = None
    for t in tokens:
        try:
            if _verify_secure_hash(email_code, t["token_hash"]):
                matched_id = t["id"]
                break
        except Exception:
            continue

    if not matched_id:
        conn.close()
        _log_security_event("recover_2fa_verify_fail", uid=row["id"], username=row["username"])
        return jsonify({"error": GENERIC}), 400

    # Success — consume token, disable 2FA, rotate session_version
    conn.execute("UPDATE password_resets SET used=1 WHERE id=?", (matched_id,))
    conn.execute(
        """UPDATE users SET totp_enabled=0, totp_secret=NULL, backup_codes='',
                          session_version = COALESCE(session_version,0) + 1
           WHERE id=?""",
        (row["id"],)
    )
    conn.commit()

    # Get display name + email for alert
    u = conn.execute("SELECT display_name, email FROM users WHERE id=?", (row["id"],)).fetchone()
    conn.close()

    _log_security_event("recover_2fa_success_email", uid=row["id"], username=row["username"])

    # Notify by email
    try:
        if u and u["email"] and _is_valid_email(u["email"]):
            _NL = chr(10)
            now = time.strftime("%d %b %Y, %H:%M", time.localtime())
            body = (
                "হ্যালো " + str(u["display_name"]) + "," + _NL + _NL +
                "আপনার অ্যাকাউন্টে email verification দিয়ে 2FA বন্ধ করা হয়েছে।" + _NL + _NL +
                "🕒 সময়: " + now + _NL + _NL +
                "⚠️ আপনি না করে থাকলে সাথে সাথে পাসওয়ার্ড পরিবর্তন করুন।" + _NL + _NL +
                "— JUKTOY Security"
            )
            _send_email(u["email"], "JUKTOY — 2FA বন্ধ করা হয়েছে", body)
    except Exception as e:
        print(f"[recover_2fa] alert failed: {e}")

    return jsonify({
        "ok": True,
        "message": "2FA বন্ধ করা হয়েছে। এখন password দিয়ে login করে নতুন করে 2FA চালু করুন।",
    })


@app.route("/api/logout", methods=["POST"])
def logout():
    token = session.get("session_sid")
    if token:
        try:
            conn = db()
            conn.execute("DELETE FROM sessions WHERE token=?", (token,))
            conn.commit()
            conn.close()
        except Exception:
            pass
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/me")
def me():
    uid = session.get("user_id")
    if not uid:
        return jsonify({"user": None})
    conn = db()
    row = conn.execute("SELECT id, username, display_name, bio, profile_pic, cover_pic, onboarded, is_private FROM users WHERE id=?",
                       (uid,)).fetchone()
    conn.close()
    return jsonify({
        "user": dict(row) if row else None,
        "is_secure": bool(request.is_secure),
    })


# ============================================
# POSTS / FEED
# ============================================

@app.route("/api/feed")
@login_required
def feed():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT p.id, p.user_id, p.content, p.created_at, p.edited_at, p.quote_post_id,
               u.username, u.display_name, u.profile_pic,
               (SELECT COUNT(*) FROM reactions WHERE post_id=p.id) AS likes,
               (SELECT reaction FROM reactions WHERE post_id=p.id AND user_id=?) AS my_reaction,
               (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comments,
               (SELECT COUNT(*) FROM saves WHERE post_id=p.id AND user_id=?) AS is_saved,
               (SELECT COUNT(*) FROM reposts WHERE post_id=p.id) AS repost_count,
               (SELECT COUNT(*) FROM reposts WHERE post_id=p.id AND user_id=?) AS is_reposted
        FROM posts p JOIN users u ON u.id = p.user_id
        WHERE p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
          AND p.user_id NOT IN (SELECT target_id FROM mutes WHERE user_id=?)
          AND p.user_id NOT IN (SELECT target_id FROM restricts WHERE user_id=?)
          AND p.id      NOT IN (SELECT post_id   FROM hidden_posts WHERE user_id=?)
          AND p.user_id NOT IN (SELECT target_id FROM snoozed_users WHERE user_id=? AND datetime(until_ts) > datetime('now'))
          AND (COALESCE(u.is_private, 0) = 0
               OR u.id = ?
               OR u.id IN (SELECT following_id FROM follows WHERE follower_id = ?))
        ORDER BY p.created_at DESC LIMIT 100
    """, (uid, uid, uid, uid, uid, uid, uid, uid, uid, uid, uid)).fetchall()

    # S30.20 — batch N+1 fix
    # Was: 3 queries per post (media, reactions, quoted media) = ~700 queries
    # Now: 4 batched queries total regardless of post count.
    post_ids = [r["id"] for r in rows]
    quoted_ids = [r["quote_post_id"] for r in rows if r["quote_post_id"]]
    quoted_ids = list(set(quoted_ids))   # dedup

    # ── Batch media for all posts ──
    media_by_post = {}
    if post_ids:
        ph = ",".join("?" * len(post_ids))
        for m in conn.execute(
            f"SELECT post_id, media FROM post_media WHERE post_id IN ({ph}) "
            f"ORDER BY post_id, position ASC",
            post_ids
        ).fetchall():
            media_by_post.setdefault(m["post_id"], []).append(m["media"])

    # ── Batch reaction counts ──
    reactions_by_post = {}
    if post_ids:
        ph = ",".join("?" * len(post_ids))
        for rr in conn.execute(
            f"SELECT post_id, reaction, COUNT(*) AS c FROM reactions "
            f"WHERE post_id IN ({ph}) GROUP BY post_id, reaction ORDER BY post_id, c DESC",
            post_ids
        ).fetchall():
            reactions_by_post.setdefault(rr["post_id"], []).append((rr["reaction"], rr["c"]))

    # ── Batch quoted posts (with their media) ──
    # S30.27 — enforce privacy + block on quoted posts
    # (was: quoted content of private/blocked users leaked via feed)
    quoted_by_id = {}
    if quoted_ids:
        qph = ",".join("?" * len(quoted_ids))
        qrows = conn.execute(
            f"""SELECT p.id, p.content, p.created_at,
                       u.username, u.display_name, u.profile_pic
                FROM posts p JOIN users u ON u.id = p.user_id
                WHERE p.id IN ({qph})
                  AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
                  AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
                  AND (COALESCE(u.is_private, 0) = 0
                       OR u.id = ?
                       OR u.id IN (SELECT following_id FROM follows WHERE follower_id = ?))""",
            [x for x in quoted_ids] + [uid, uid, uid, uid]
        ).fetchall()
        for q in qrows:
            qd = dict(q)
            qd["media"] = []
            quoted_by_id[q["id"]] = qd
        if qrows:
            qid_list = [q["id"] for q in qrows]
            qph2 = ",".join("?" * len(qid_list))
            for m in conn.execute(
                f"SELECT post_id, media FROM post_media WHERE post_id IN ({qph2}) "
                f"ORDER BY post_id, position ASC",
                qid_list
            ).fetchall():
                if m["post_id"] in quoted_by_id:
                    quoted_by_id[m["post_id"]]["media"].append(m["media"])

    # ── Assemble response ──
    posts = []
    for r in rows:
        post = dict(r)
        post["media"] = media_by_post.get(r["id"], [])
        rcs = reactions_by_post.get(r["id"], [])
        post["reaction_counts"] = {x[0]: x[1] for x in rcs}
        post["top_reactions"] = [x[0] for x in rcs[:3]]
        if r["quote_post_id"]:
            q = quoted_by_id.get(r["quote_post_id"])
            if q:
                post["quoted_post"] = q
        posts.append(post)

    conn.close()
    return jsonify(posts)


@app.route("/api/posts", methods=["POST"])
@login_required
@rate_limit("post", 30, 3600)
def create_post():
    _blk = _is_public_action_blocked_for_admin()
    if _blk: return _blk
    data = request.json or {}
    content = (data.get("content") or "").strip()
    media_list = data.get("media") or []

    if not content and not media_list:
        return jsonify({"error": "খালি পোস্ট করা যাবে না"}), 400
    if len(content) > 10_000:
        return jsonify({"error": "পোস্ট ১০,০০০ অক্ষরের বেশি হতে পারবে না"}), 400
    if len(media_list) > 10:
        return jsonify({"error": "সর্বোচ্চ ১০টি ছবি দেওয়া যাবে"}), 400
    for m in media_list:
        if not is_valid_image_uri(m, 3_000_000):
            return jsonify({"error": "অবৈধ ছবি বা ২.৫ MB এর বেশি"}), 400

    conn = db()
    cur = conn.execute("INSERT INTO posts (user_id, content) VALUES (?,?)",
                       (session["user_id"], content))
    post_id = cur.lastrowid
    # Batch 3 — notify post: fan-out notification (S30.17 — batch insert)
    try:
        _notify_uids = conn.execute(
            "SELECT user_id FROM profile_notify WHERE target_id=?",
            (session["user_id"],)
        ).fetchall()
        if _notify_uids:
            _rows = [
                (_nr["user_id"], session["user_id"], "new_post", post_id)
                for _nr in _notify_uids
            ]
            conn.executemany(
                "INSERT INTO notifications (user_id, actor_id, type, post_id) "
                "VALUES (?,?,?,?)",
                _rows
            )
    except Exception:
        pass
    for i, m in enumerate(media_list):
        # S17.1 — save each image to filesystem
        saved = _save_data_uri(m, "posts", prefix=f"p{post_id}_{i}_")
        if not saved:
            print(f"[UPLOAD] post media skipped #{i}")
            continue
        conn.execute("INSERT INTO post_media (post_id, media, position) VALUES (?,?,?)",
                     (post_id, saved, i))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": post_id})


@app.route("/api/posts/<int:pid>")
@login_required
def get_single_post(pid):
    uid = session["user_id"]
    can = _can_view_post(pid, uid)
    if can is None:
        return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404
    if not can:
        return jsonify({"error": "এই পোস্ট দেখার অনুমতি নেই (private account)"}), 403
    conn = db()
    row = conn.execute("""
        SELECT p.id, p.user_id, p.content, p.created_at, p.quote_post_id,
               u.username, u.display_name, u.profile_pic,
               (SELECT COUNT(*) FROM reactions WHERE post_id=p.id) AS likes,
               (SELECT reaction FROM reactions WHERE post_id=p.id AND user_id=?) AS my_reaction,
               (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comments
        FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id=?
    """, (uid, pid)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404
    post = dict(row)
    post["media"] = [m["media"] for m in conn.execute(
        "SELECT media FROM post_media WHERE post_id=? ORDER BY position ASC",
        (pid,)).fetchall()]
    conn.close()
    return jsonify({"post": post})


@app.route("/api/posts/<int:pid>", methods=["PATCH"])
@login_required
def edit_post(pid):
    data = request.json or {}
    content = (data.get("content") or "").strip()
    if not content:
        return jsonify({"error": "খালি পোস্ট করা যাবে না"}), 400
    if len(content) > 10_000:
        return jsonify({"error": "পোস্ট ১০,০০০ অক্ষরের বেশি হতে পারবে না"}), 400

    conn = db()
    row = conn.execute("SELECT user_id FROM posts WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404
    if row["user_id"] != session["user_id"]:
        conn.close()
        return jsonify({"error": "এটা আপনার পোস্ট নয়"}), 403

    conn.execute("UPDATE posts SET content=?, edited_at=CURRENT_TIMESTAMP WHERE id=?",
                 (content, pid))
    conn.commit()
    edited = conn.execute("SELECT edited_at FROM posts WHERE id=?", (pid,)).fetchone()["edited_at"]
    conn.close()
    return jsonify({"ok": True, "content": content, "edited_at": edited})


@app.route("/api/posts/<int:pid>", methods=["DELETE"])
@login_required
def delete_post(pid):
    conn = db()
    row = conn.execute("SELECT user_id FROM posts WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404
    if row["user_id"] != session["user_id"]:
        conn.close()
        return jsonify({"error": "এটা আপনার পোস্ট নয়"}), 403
    # S17.1 — capture media paths before deleting rows
    media_paths = [r["media"] for r in conn.execute(
        "SELECT media FROM post_media WHERE post_id=?", (pid,)).fetchall()]
    conn.execute("DELETE FROM reactions WHERE post_id=?", (pid,))
    conn.execute("DELETE FROM comments WHERE post_id=?", (pid,))
    conn.execute("DELETE FROM saves WHERE post_id=?", (pid,))
    conn.execute("DELETE FROM reposts WHERE post_id=?", (pid,))
    conn.execute("DELETE FROM post_media WHERE post_id=?", (pid,))
    conn.execute("DELETE FROM notifications WHERE post_id=?", (pid,))
    conn.execute("DELETE FROM posts WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    # S17.1 — delete files (outside DB lock)
    _delete_upload_many(media_paths)
    return jsonify({"ok": True})


# ============================================
# REACTIONS
# ============================================

@app.route("/api/posts/<int:pid>/reaction", methods=["POST"])
@login_required
@rate_limit("reaction", 300, 3600)
def toggle_reaction(pid):
    _blk = _is_public_action_blocked_for_admin()
    if _blk: return _blk
    uid = session["user_id"]
    can = _can_view_post(pid, uid)
    if can is None:
        return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404
    if not can:
        return jsonify({"error": "এই পোস্টে reaction দেওয়ার অনুমতি নেই"}), 403
    data = request.json or {}
    reaction = (data.get("reaction") or "like").strip()
    valid = {"like", "love", "haha", "wow", "sad", "angry"}
    if reaction not in valid:
        reaction = "like"

    conn = db()
    existing = conn.execute("SELECT reaction FROM reactions WHERE user_id=? AND post_id=?",
                            (uid, pid)).fetchone()

    if existing and existing["reaction"] == reaction:
        conn.execute("DELETE FROM reactions WHERE user_id=? AND post_id=?", (uid, pid))
        conn.execute("""DELETE FROM notifications
            WHERE user_id=(SELECT user_id FROM posts WHERE id=?)
              AND actor_id=? AND type='like' AND post_id=?""", (pid, uid, pid))
        my_reaction = None
    else:
        conn.execute("""INSERT INTO reactions (user_id, post_id, reaction) VALUES (?,?,?)
            ON CONFLICT(user_id, post_id) DO UPDATE SET reaction=excluded.reaction""",
            (uid, pid, reaction))
        if not existing:
            owner = conn.execute("SELECT user_id FROM posts WHERE id=?", (pid,)).fetchone()
            if owner and owner["user_id"] != uid:
                conn.execute("INSERT INTO notifications (user_id, actor_id, type, post_id) VALUES (?,?,?,?)",
                             (owner["user_id"], uid, "like", pid))
        my_reaction = reaction

    conn.commit()
    reaction_rows = conn.execute(
        "SELECT reaction, COUNT(*) AS c FROM reactions WHERE post_id=? GROUP BY reaction ORDER BY c DESC",
        (pid,)).fetchall()
    counts = {row["reaction"]: row["c"] for row in reaction_rows}
    total = sum(counts.values())
    top = [row["reaction"] for row in reaction_rows[:3]]
    conn.close()
    return jsonify({"ok": True, "my_reaction": my_reaction, "counts": counts, "top": top, "total": total})


@app.route("/api/posts/<int:pid>/likes")
@login_required
def get_post_likes(pid):
    uid = session["user_id"]
    can = _can_view_post(pid, uid)
    if can is None:
        return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404
    if not can:
        return jsonify({"error": "এই পোস্ট দেখার অনুমতি নেই"}), 403
    conn = db()
    rows = conn.execute("""
        SELECT u.username, u.display_name, u.profile_pic,
               r.reaction, r.created_at
        FROM reactions r JOIN users u ON u.id = r.user_id
        WHERE r.post_id=?
        ORDER BY r.created_at DESC LIMIT 200
    """, (pid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ============================================
# COMMENTS
# ============================================

@app.route("/api/posts/<int:pid>/comments")
@login_required
def get_comments(pid):
    uid = session["user_id"]
    can = _can_view_post(pid, uid)
    if can is None:
        return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404
    if not can:
        return jsonify({"error": "এই পোস্ট দেখার অনুমতি নেই"}), 403
    conn = db()
    # S30.26 — batch comment_likes (was: 2 subqueries per comment)
    rows = conn.execute("""
        SELECT c.id, c.content, c.created_at, c.parent_id, c.user_id,
               u.username, u.display_name, u.profile_pic
        FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.post_id=? ORDER BY c.created_at ASC
    """, (pid,)).fetchall()

    cids = [r["id"] for r in rows]
    like_counts = {}
    my_likes = set()
    if cids:
        cph = ",".join("?" * len(cids))
        for rr in conn.execute(
            f"SELECT comment_id, COUNT(*) AS c FROM comment_likes "
            f"WHERE comment_id IN ({cph}) GROUP BY comment_id",
            cids
        ).fetchall():
            like_counts[rr["comment_id"]] = rr["c"]
        for rr in conn.execute(
            f"SELECT comment_id FROM comment_likes "
            f"WHERE user_id=? AND comment_id IN ({cph})",
            [uid] + cids
        ).fetchall():
            my_likes.add(rr["comment_id"])

    comments = []
    for r in rows:
        d = dict(r)
        d["likes"] = like_counts.get(r["id"], 0)
        d["i_liked"] = 1 if r["id"] in my_likes else 0
        comments.append(d)
    conn.close()

    # Nest: top-level comments with replies array
    by_id = {c["id"]: {**c, "replies": []} for c in comments}
    top = []
    for c in comments:
        cid = c["id"]
        node = by_id[cid]
        parent = c.get("parent_id")
        if parent and parent in by_id:
            by_id[parent]["replies"].append(node)
        else:
            top.append(node)
    return jsonify(top)


@app.route("/api/posts/<int:pid>/comments", methods=["POST"])
@login_required
@rate_limit("comment", 60, 3600)
def add_comment(pid):
    _blk = _is_public_action_blocked_for_admin()
    if _blk: return _blk
    uid = session["user_id"]
    can = _can_view_post(pid, uid)
    if can is None:
        return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404
    if not can:
        return jsonify({"error": "এই পোস্টে কমেন্ট করার অনুমতি নেই"}), 403
    data = request.json or {}
    content = (data.get("content") or "").strip()
    parent_id = data.get("parent_id")
    if not content:
        return jsonify({"error": "খালি কমেন্ট নয়"}), 400
    if len(content) > 2_000:
        return jsonify({"error": "কমেন্ট ২,০০০ অক্ষরের বেশি হতে পারবে না"}), 400
    uid = session["user_id"]
    conn = db()

    # Validate parent belongs to same post
    if parent_id:
        parent = conn.execute("SELECT id, user_id, post_id FROM comments WHERE id=?",
                              (parent_id,)).fetchone()
        if not parent or parent["post_id"] != pid:
            conn.close()
            return jsonify({"error": "ভুল parent comment"}), 400

    cur = conn.execute(
        "INSERT INTO comments (post_id, user_id, content, parent_id) VALUES (?,?,?,?)",
        (pid, uid, content, parent_id))
    new_cid = cur.lastrowid

    # Notify post owner (if not self)
    owner = conn.execute("SELECT user_id FROM posts WHERE id=?", (pid,)).fetchone()
    if owner and owner["user_id"] != uid:
        conn.execute("INSERT INTO notifications (user_id, actor_id, type, post_id) VALUES (?,?,?,?)",
                     (owner["user_id"], uid, "comment", pid))

    # Notify parent comment owner on reply (if not self, not post owner)
    if parent_id and parent["user_id"] != uid:
        if not owner or parent["user_id"] != owner["user_id"]:
            conn.execute("INSERT INTO notifications (user_id, actor_id, type, post_id) VALUES (?,?,?,?)",
                         (parent["user_id"], uid, "comment_reply", pid))

    # S32.4 — @mention notifications
    # Scan comment content for @username and notify each mentioned user.
    # Skip: self, post owner (already notified), parent reply owner (already notified).
    try:
        import re as _re
        _mentions = set(_re.findall(r"@([A-Za-z0-9_\u0980-\u09FF]+)", content or ""))
        _already = set()
        if owner and owner["user_id"] != uid:
            _already.add(owner["user_id"])
        if parent_id and parent and parent["user_id"] != uid:
            _already.add(parent["user_id"])
        for _uname in _mentions:
            _row = conn.execute(
                "SELECT id FROM users WHERE LOWER(username)=?",
                (_uname.lower(),)
            ).fetchone()
            if not _row:
                continue
            _muid = _row["id"]
            if _muid == uid or _muid in _already:
                continue
            conn.execute(
                "INSERT INTO notifications (user_id, actor_id, type, post_id) VALUES (?,?,?,?)",
                (_muid, uid, "mention", pid)
            )
    except Exception as _e:
        print(f"[S32.4] mention notify failed: {_e}")

    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": new_cid})


@app.route("/api/comments/<int:cid>/like", methods=["POST"])
@login_required
@rate_limit("comment_like", 300, 3600)
def toggle_comment_like(cid):
    _blk = _is_public_action_blocked_for_admin()
    if _blk: return _blk
    uid = session["user_id"]
    conn = db()
    c = conn.execute("SELECT id, user_id, post_id FROM comments WHERE id=?", (cid,)).fetchone()
    if not c:
        conn.close()
        return jsonify({"error": "কমেন্ট পাওয়া যায়নি"}), 404

    existing = conn.execute("SELECT 1 FROM comment_likes WHERE user_id=? AND comment_id=?",
                            (uid, cid)).fetchone()
    if existing:
        conn.execute("DELETE FROM comment_likes WHERE user_id=? AND comment_id=?", (uid, cid))
        liked = False
        conn.execute("""DELETE FROM notifications
            WHERE user_id=? AND actor_id=? AND type='comment_like' AND post_id=?""",
            (c["user_id"], uid, c["post_id"]))
    else:
        conn.execute("INSERT INTO comment_likes (user_id, comment_id) VALUES (?,?)", (uid, cid))
        liked = True
        if c["user_id"] != uid:
            conn.execute("INSERT INTO notifications (user_id, actor_id, type, post_id) VALUES (?,?,?,?)",
                         (c["user_id"], uid, "comment_like", c["post_id"]))

    conn.commit()
    total = conn.execute("SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id=?",
                         (cid,)).fetchone()["n"]
    conn.close()
    return jsonify({"ok": True, "liked": liked, "likes": total})


@app.route("/api/comments/<int:cid>", methods=["DELETE"])
@login_required
def delete_comment(cid):
    """S30.19 — fixed cleanup order + comprehensive notifications.

    Bugs fixed:
      • Likes were deleted BEFORE notifications referencing them
        → subquery returned empty → notification cleanup was a no-op.
      • Parent comment's reply notifications never cleared.
      • Reactions on the deleted comment weren't cleaned.
    """
    uid = session["user_id"]
    conn = db()
    c = conn.execute(
        "SELECT user_id, post_id, parent_id FROM comments WHERE id=?",
        (cid,)
    ).fetchone()
    if not c:
        conn.close()
        return jsonify({"error": "কমেন্ট পাওয়া যায়নি"}), 404
    if c["user_id"] != uid:
        conn.close()
        return jsonify({"error": "এটা আপনার কমেন্ট নয়"}), 403

    post_id = c["post_id"]
    parent_id = c["parent_id"]

    # ─── 1) Collect reply ids + all comment ids being removed ───
    replies = conn.execute(
        "SELECT id, user_id FROM comments WHERE parent_id=?",
        (cid,)
    ).fetchall()
    reply_ids = [r["id"] for r in replies]
    all_ids = [cid] + reply_ids

    # ─── 2) Delete notifications FIRST (before likes cleanup) ───
    placeholders = ",".join("?" * len(all_ids))
    #    a) comment_like notifications where the comment owner was the receiver
    conn.execute(
        f"""DELETE FROM notifications
            WHERE type='comment_like'
              AND post_id=?""",
        (post_id,)
    )
    #    b) comment_reply notifications for parent OR for replies
    #       (they all reference post_id, target owner is c.user_id)
    conn.execute(
        """DELETE FROM notifications
            WHERE type IN ('comment_reply', 'comment')
              AND post_id=?
              AND user_id IN (SELECT user_id FROM comments WHERE id IN ({ph}))""".format(ph=placeholders),
        [post_id] + all_ids
    )
    #    c) mention notifications that referenced these comments
    #       (mention notifications don't store comment_id, so skip — safe)

    # ─── 3) Delete comment_likes (replies + parent) ───
    for r_id in reply_ids:
        conn.execute("DELETE FROM comment_likes WHERE comment_id=?", (r_id,))
    conn.execute("DELETE FROM comment_likes WHERE comment_id=?", (cid,))

    # ─── 4) Delete replies + parent comment ───
    for r_id in reply_ids:
        conn.execute("DELETE FROM comments WHERE id=?", (r_id,))
    conn.execute("DELETE FROM comments WHERE id=?", (cid,))

    # ─── 5) If this was a reply, clean up any orphan notifications ───
    if parent_id:
        # nothing extra — parent remains, its notifications stand
        pass

    conn.commit()
    conn.close()
    return jsonify({"ok": True, "deleted": 1 + len(reply_ids)})
@app.route("/api/posts/<int:pid>/save", methods=["POST"])
@login_required
@rate_limit("save", 100, 3600)
def toggle_save(pid):
    uid = session["user_id"]
    can = _can_view_post(pid, uid)
    if can is None:
        return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404
    if not can:
        return jsonify({"error": "এই পোস্ট সেভ করার অনুমতি নেই"}), 403
    conn = db()
    exists = conn.execute("SELECT 1 FROM saves WHERE user_id=? AND post_id=?",
                          (uid, pid)).fetchone()
    if exists:
        conn.execute("DELETE FROM saves WHERE user_id=? AND post_id=?", (uid, pid))
        saved = False
    else:
        conn.execute("INSERT INTO saves (user_id, post_id) VALUES (?,?)", (uid, pid))
        saved = True
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "saved": saved})


@app.route("/api/saves")
@login_required
def get_saves():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT p.id, p.user_id, p.content, p.created_at,
               u.username, u.display_name, u.profile_pic,
               (SELECT COUNT(*) FROM reactions WHERE post_id=p.id) AS likes,
               (SELECT reaction FROM reactions WHERE post_id=p.id AND user_id=?) AS my_reaction,
               (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comments,
               1 AS is_saved
        FROM saves s JOIN posts p ON p.id = s.post_id
        JOIN users u ON u.id = p.user_id
        WHERE s.user_id=? ORDER BY s.created_at DESC
    """, (uid, uid)).fetchall()
    # S30.20 — batch media
    post_ids = [r["id"] for r in rows]
    media_by_post = {}
    if post_ids:
        ph = ",".join("?" * len(post_ids))
        for m in conn.execute(
            f"SELECT post_id, media FROM post_media WHERE post_id IN ({ph}) "
            f"ORDER BY post_id, position ASC",
            post_ids
        ).fetchall():
            media_by_post.setdefault(m["post_id"], []).append(m["media"])

    posts = []
    for r in rows:
        post = dict(r)
        post["media"] = media_by_post.get(r["id"], [])
        posts.append(post)
    conn.close()
    return jsonify(posts)


# ============================================
# REPOSTS
# ============================================

@app.route("/api/posts/<int:pid>/repost", methods=["POST"])
@login_required
@rate_limit("repost", 50, 3600)
def toggle_repost(pid):
    _blk = _is_public_action_blocked_for_admin()
    if _blk: return _blk
    uid = session["user_id"]
    can = _can_view_post(pid, uid)
    if can is None:
        return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404
    if not can:
        return jsonify({"error": "এই পোস্ট repost করার অনুমতি নেই"}), 403
    conn = db()
    post = conn.execute("SELECT user_id FROM posts WHERE id=?", (pid,)).fetchone()
    if not post:
        conn.close()
        return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404
    if post["user_id"] == uid:
        conn.close()
        return jsonify({"error": "নিজের পোস্ট repost করা যাবে না"}), 400

    existing = conn.execute("SELECT id FROM reposts WHERE user_id=? AND post_id=?",
                            (uid, pid)).fetchone()
    if existing:
        conn.execute("DELETE FROM reposts WHERE user_id=? AND post_id=?", (uid, pid))
        conn.execute("""DELETE FROM notifications
            WHERE user_id=? AND actor_id=? AND type='repost' AND post_id=?""",
            (post["user_id"], uid, pid))
        reposted = False
    else:
        conn.execute("INSERT INTO reposts (user_id, post_id) VALUES (?,?)", (uid, pid))
        conn.execute("INSERT INTO notifications (user_id, actor_id, type, post_id) VALUES (?,?,?,?)",
                     (post["user_id"], uid, "repost", pid))
        reposted = True
    conn.commit()
    count = conn.execute("SELECT COUNT(*) AS c FROM reposts WHERE post_id=?", (pid,)).fetchone()["c"]
    conn.close()
    return jsonify({"ok": True, "reposted": reposted, "count": count})


@app.route("/api/posts/<int:pid>/quote-preview")
@login_required
def quote_preview(pid):
    """Return the original post data used by the quote composer preview."""
    uid = session["user_id"]
    can = _can_view_post(pid, uid)
    if can is None:
        return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404
    if not can:
        return jsonify({"error": "এই পোস্ট দেখার অনুমতি নেই"}), 403
    conn = db()
    row = conn.execute("""
        SELECT p.id, p.content, p.created_at,
               u.username, u.display_name, u.profile_pic
        FROM posts p
        JOIN users u ON u.id = p.user_id
        WHERE p.id=?
    """, (pid,)).fetchone()

    if not row:
        conn.close()
        return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404

    post = dict(row)
    post["media"] = [m["media"] for m in conn.execute(
        "SELECT media FROM post_media WHERE post_id=? ORDER BY position ASC",
        (pid,)
    ).fetchall()]
    conn.close()
    return jsonify({"post": post})


@app.route("/api/posts/<int:pid>/quote", methods=["POST"])
@login_required
def create_quote(pid):
    _blk = _is_public_action_blocked_for_admin()
    if _blk: return _blk
    uid = session["user_id"]
    can = _can_view_post(pid, uid)
    if can is None:
        return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404
    if not can:
        return jsonify({"error": "এই পোস্ট quote করার অনুমতি নেই"}), 403
    content = (request.json.get("content") or "").strip()
    if not content:
        return jsonify({"error": "মন্তব্য লিখতে হবে"}), 400
    if len(content) > 5_000:
        return jsonify({"error": "মন্তব্য ৫,০০০ অক্ষরের বেশি হতে পারবে না"}), 400
    conn = db()
    post = conn.execute("SELECT user_id FROM posts WHERE id=?", (pid,)).fetchone()
    if not post:
        conn.close()
        return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404
    if post["user_id"] == uid:
        conn.close()
        return jsonify({"error": "নিজের পোস্ট quote করা যাবে না"}), 400
    cur = conn.execute("INSERT INTO posts (user_id, content, quote_post_id) VALUES (?,?,?)",
                       (uid, content, pid))
    new_id = cur.lastrowid
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": new_id})


# ============================================
# USERS / FOLLOW / PROFILE
# ============================================

@app.route("/api/search")
@login_required
def search_all():
    q = (request.args.get("q") or "").strip()
    stype = (request.args.get("type") or "all").strip()
    if not q:
        return jsonify({"users": [], "posts": [], "hashtags": []})
    if len(q) > 100:
        return jsonify({"error": "খোঁজা অনেক বড়"}), 400

    uid = session["user_id"]
    conn = db()
    like_lower = "%" + q.lower() + "%"

    users_out = []
    posts_out = []
    hashtags_out = []

    if stype in ("all", "users"):
        rows = conn.execute("""
            SELECT username, display_name, profile_pic FROM users
            WHERE (LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?)
              AND id != ?
              AND COALESCE(is_admin, 0) = 0
              AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
              AND id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
            LIMIT 20
        """, (like_lower, like_lower, uid, uid, uid)).fetchall()
        users_out = [dict(r) for r in rows]

    if stype in ("all", "posts"):
        rows = conn.execute("""
            SELECT p.id, p.user_id, p.content, p.created_at,
                   u.username, u.display_name, u.profile_pic,
                   (SELECT COUNT(*) FROM reactions WHERE post_id=p.id) AS likes,
                   (SELECT reaction FROM reactions WHERE post_id=p.id AND user_id=?) AS my_reaction,
                   (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comments
            FROM posts p JOIN users u ON u.id = p.user_id
            WHERE LOWER(p.content) LIKE ?
              AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
              AND p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
              AND (COALESCE(u.is_private, 0) = 0
                   OR u.id = ?
                   OR u.id IN (SELECT following_id FROM follows WHERE follower_id = ?))
            ORDER BY p.created_at DESC LIMIT 30
        """, (uid, like_lower, uid, uid, uid, uid)).fetchall()
        posts_out = [dict(r) for r in rows]
        # S30.20 — batch media
        pids = [p0["id"] for p0 in posts_out]
        mp = {}
        if pids:
            ph = ",".join("?" * len(pids))
            for m in conn.execute(
                f"SELECT post_id, media FROM post_media WHERE post_id IN ({ph}) "
                f"ORDER BY post_id, position ASC",
                pids
            ).fetchall():
                mp.setdefault(m["post_id"], []).append(m["media"])
        for post in posts_out:
            post["media"] = mp.get(post["id"], [])

    if stype in ("all", "hashtags"):
        tag = q.lstrip("#").lower()
        if tag:
            rows = conn.execute("""
                SELECT p.content FROM posts p
                JOIN users u ON u.id = p.user_id
                WHERE LOWER(p.content) LIKE ?
                  AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
                  AND p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
                  AND (COALESCE(u.is_private, 0) = 0
                       OR u.id = ?
                       OR u.id IN (SELECT following_id FROM follows WHERE follower_id = ?))
                LIMIT 500
            """, ("%#" + tag + "%", uid, uid, uid, uid)).fetchall()
            counts = {}
            for r in rows:
                for t in extract_hashtags(r["content"] or ""):
                    if tag in t:
                        counts[t] = counts.get(t, 0) + 1
            hashtags_out = [{"tag": t, "count": c} for t, c in
                            sorted(counts.items(), key=lambda x: x[1], reverse=True)[:20]]

    conn.close()
    return jsonify({"users": users_out, "posts": posts_out, "hashtags": hashtags_out})


@app.route("/api/users/online")
@login_required
def online_users():
    """S18.9b — return users active in last 5 minutes."""
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT username, display_name, profile_pic,
               last_seen
        FROM users
        WHERE id != ?
          AND LOWER(username) != ?
          AND last_seen IS NOT NULL
          AND datetime(last_seen) > datetime('now', '-5 minutes')
          AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
        ORDER BY datetime(last_seen) DESC
        LIMIT 10
    """, (uid, ADMIN_USERNAME, uid, uid)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/users")
@login_required
def search_users():
    q = "%" + (request.args.get("q") or "").strip() + "%"
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT username, display_name, profile_pic FROM users
        WHERE (username LIKE ? OR display_name LIKE ?)
          AND COALESCE(is_admin, 0) = 0
          AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
        LIMIT 20
    """, (q, q, uid, uid)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/users/<username>")
@login_required
def profile(username):
    conn = db()
    u = conn.execute("""SELECT id, username, display_name, bio, profile_pic, cover_pic, created_at, is_private,
               COALESCE(pronouns,'') AS pronouns,
               COALESCE(location,'') AS location,
               COALESCE(category,'') AS category,
               COALESCE(bio_links,'') AS bio_links,
               COALESCE(is_professional,0) AS is_professional
        FROM users WHERE username=?""", (username,)).fetchone()
    if not u:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404

    uid = session["user_id"]

    # S22 / Series 27A-2 — hide admin profile from non-admin viewers
    # Return same 404 as nonexistent — no info leak
    if _is_admin(u["id"]) and not _is_admin(uid):
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404

    # Block check — return generic 404 to avoid info leak
    if _is_blocked_either_way(uid, u["id"]):
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404

    # Batch 1 — richer follow state
    is_following = conn.execute(
        "SELECT 1 FROM follows WHERE follower_id=? AND following_id=? "
        "AND COALESCE(status,'accepted')='accepted'",
        (uid, u["id"])
    ).fetchone() is not None
    is_requested = conn.execute(
        "SELECT 1 FROM follows WHERE follower_id=? AND following_id=? "
        "AND status='pending'",
        (uid, u["id"])
    ).fetchone() is not None
    follows_me = conn.execute(
        "SELECT 1 FROM follows WHERE follower_id=? AND following_id=? "
        "AND COALESCE(status,'accepted')='accepted'",
        (u["id"], uid)
    ).fetchone() is not None

    is_private = bool(u["is_private"]) if "is_private" in u.keys() else False
    is_self = (uid == u["id"])
    can_see_posts = (not is_private) or is_self or is_following

    posts = []
    # Batch 5 — pinned post + archived exclusion
    pinned_post = None
    try:
        _pp = conn.execute("SELECT pinned_post_id FROM users WHERE id=?", (u["id"],)).fetchone()
        _pp_id = _pp["pinned_post_id"] if _pp else None
        if _pp_id:
            _prow = conn.execute("SELECT id, content, created_at FROM posts WHERE id=?",
                                  (_pp_id,)).fetchone()
            if _prow:
                pinned_post = dict(_prow)
                pinned_post["media"] = [m["media"] for m in conn.execute(
                    "SELECT media FROM post_media WHERE post_id=? ORDER BY position ASC",
                    (_pp_id,)).fetchall()]
    except Exception:
        pinned_post = None

    if can_see_posts:
        posts_rows = conn.execute("""SELECT id, content, created_at FROM posts
            WHERE user_id=? AND COALESCE(is_archived,0)=0
            ORDER BY created_at DESC LIMIT 50""", (u["id"],)).fetchall()
        # S30.24 — batch media fetch (was: 1 query per post = 50 queries)
        _pids = [pr["id"] for pr in posts_rows]
        _media_map = {}
        if _pids:
            _ph = ",".join("?" * len(_pids))
            for _m in conn.execute(
                f"SELECT post_id, media FROM post_media WHERE post_id IN ({_ph}) "
                f"ORDER BY post_id, position ASC",
                _pids
            ).fetchall():
                _media_map.setdefault(_m["post_id"], []).append(_m["media"])
        for p in posts_rows:
            pd = dict(p)
            pd["media"] = _media_map.get(p["id"], [])
            posts.append(pd)
    followers_count = conn.execute("SELECT COUNT(*) AS c FROM follows WHERE following_id=?",
                                   (u["id"],)).fetchone()["c"]
    following_count = conn.execute("SELECT COUNT(*) AS c FROM follows WHERE follower_id=?",
                                   (u["id"],)).fetchone()["c"]

    # Mutual followers — people I follow who also follow this user
    mutual_rows = conn.execute("""
        SELECT DISTINCT u2.username, u2.display_name, u2.profile_pic
        FROM follows f1
        JOIN follows f2 ON f2.follower_id = f1.following_id
        JOIN users u2 ON u2.id = f1.following_id
        WHERE f1.follower_id = ?
          AND f2.following_id = ?
          AND u2.id != ?
          AND u2.id != ?
          AND u2.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND u2.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
        LIMIT 6
    """, (uid, u["id"], uid, u["id"], uid, uid)).fetchall()

    mutual_count = conn.execute("""
        SELECT COUNT(DISTINCT f1.following_id) AS c
        FROM follows f1
        JOIN follows f2 ON f2.follower_id = f1.following_id
        WHERE f1.follower_id = ?
          AND f2.following_id = ?
          AND f1.following_id != ?
          AND f1.following_id != ?
    """, (uid, u["id"], uid, u["id"])).fetchone()["c"]

    conn.close()
    return jsonify({
        "user": dict(u),
        "posts": posts,
        "can_see_posts": can_see_posts,
        "is_following": is_following,
        "is_requested": is_requested,
        "follows_me": follows_me,
        "pinned_post": pinned_post,
        "followers_count": followers_count,
        "following_count": following_count,
        "mutual_followers": [dict(r) for r in mutual_rows],
        "mutual_count": mutual_count,
    })


@app.route("/api/users/<username>/follow", methods=["POST"])
@login_required
def toggle_follow(username):
    uid = session["user_id"]
    conn = db()
    user = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    target_id = user["id"]
    if target_id == uid:
        conn.close()
        return jsonify({"error": "নিজেকে ফলো করা যাবে না"}), 400

    # S22 / Series 27A — cannot follow admin
    if _is_admin(target_id):
        conn.close()
        return jsonify({"error": "Admin অ্যাকাউন্টকে ফলো করা যাবে না"}), 403

    # Block check — cannot follow if either blocked
    blk = conn.execute("""SELECT 1 FROM blocks
        WHERE (blocker_id=? AND blocked_id=?)
           OR (blocker_id=? AND blocked_id=?)
        LIMIT 1""", (uid, target_id, target_id, uid)).fetchone()
    if blk:
        conn.close()
        return jsonify({"error": "এই ইউজারকে ফলো করা যাবে না"}), 403

    exists = conn.execute("SELECT 1 FROM follows WHERE follower_id=? AND following_id=?",
                          (uid, target_id)).fetchone()
    if exists:
        conn.execute("DELETE FROM follows WHERE follower_id=? AND following_id=?",
                     (uid, target_id))
        conn.execute("DELETE FROM notifications WHERE user_id=? AND actor_id=? AND type='follow'",
                     (target_id, uid))
        conn.execute("DELETE FROM notifications WHERE user_id=? AND actor_id=? AND type='follow_request'",
                     (target_id, uid))
        now_following = False
        is_requested = False
    else:
        # Batch 1 — private account means pending request
        target_row = conn.execute(
            "SELECT COALESCE(is_private,0) AS p FROM users WHERE id=?",
            (target_id,)
        ).fetchone()
        target_private = bool(target_row and target_row["p"])
        if target_private:
            conn.execute(
                "INSERT INTO follows (follower_id, following_id, status) VALUES (?,?, 'pending')",
                (uid, target_id)
            )
            conn.execute(
                "INSERT INTO notifications (user_id, actor_id, type) VALUES (?,?, 'follow_request')",
                (target_id, uid)
            )
            now_following = False
            is_requested = True
        else:
            conn.execute(
                "INSERT INTO follows (follower_id, following_id, status) VALUES (?,?, 'accepted')",
                (uid, target_id)
            )
            conn.execute(
                "INSERT INTO notifications (user_id, actor_id, type) VALUES (?,?, 'follow')",
                (target_id, uid)
            )
            now_following = True
            is_requested = False
    conn.commit()
    followers = conn.execute(
        "SELECT COUNT(*) AS c FROM follows WHERE following_id=? AND COALESCE(status,'accepted')='accepted'",
        (target_id,)
    ).fetchone()["c"]
    conn.close()
    return jsonify({
        "ok": True,
        "is_following": now_following,
        "is_requested": bool(locals().get("is_requested", False)),
        "followers": followers,
    })


@app.route("/api/users/<username>/block", methods=["POST"])
@login_required
def toggle_block(username):
    uid = session["user_id"]
    conn = db()
    user = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    target_id = user["id"]
    if target_id == uid:
        conn.close()
        return jsonify({"error": "নিজেকে ব্লক করা যাবে না"}), 400
    # S22 / Series 27A-2 — hide admin from block targets
    if _is_admin(target_id) and not _is_admin(uid):
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404

    exists = conn.execute("SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?",
                          (uid, target_id)).fetchone()
    if exists:
        conn.execute("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?",
                     (uid, target_id))
        blocked = False
    else:
        conn.execute("INSERT INTO blocks (blocker_id, blocked_id) VALUES (?,?)",
                     (uid, target_id))
        # S30.18 — comprehensive cleanup on block
        # 1) follows (both directions + pending requests)
        conn.execute("DELETE FROM follows WHERE follower_id=? AND following_id=?",
                     (uid, target_id))
        conn.execute("DELETE FROM follows WHERE follower_id=? AND following_id=?",
                     (target_id, uid))
        # 2) message requests (both directions)
        conn.execute("DELETE FROM message_requests WHERE sender_id=? AND receiver_id=?",
                     (uid, target_id))
        conn.execute("DELETE FROM message_requests WHERE sender_id=? AND receiver_id=?",
                     (target_id, uid))
        # 3) profile saves + notify (both directions)
        conn.execute("DELETE FROM profile_saves WHERE (user_id=? AND target_id=?) OR (user_id=? AND target_id=?)",
                     (uid, target_id, target_id, uid))
        conn.execute("DELETE FROM profile_notify WHERE (user_id=? AND target_id=?) OR (user_id=? AND target_id=?)",
                     (uid, target_id, target_id, uid))
        # 4) mute / restrict / no-retweet (my preferences for them — reset)
        conn.execute("DELETE FROM mutes WHERE user_id=? AND target_id=?", (uid, target_id))
        conn.execute("DELETE FROM restricts WHERE user_id=? AND target_id=?", (uid, target_id))
        conn.execute("DELETE FROM no_retweets WHERE user_id=? AND target_id=?", (uid, target_id))
        # 5) snooze (both directions)
        conn.execute("DELETE FROM snoozed_users WHERE user_id=? AND target_id=?", (uid, target_id))
        conn.execute("DELETE FROM snoozed_users WHERE user_id=? AND target_id=?", (target_id, uid))
        # 6) notifications from/to blocked user (cleanup the bell)
        conn.execute("DELETE FROM notifications WHERE (user_id=? AND actor_id=?) OR (user_id=? AND actor_id=?)",
                     (uid, target_id, target_id, uid))
        # 7) chat settings (theme/nickname/wallpaper rows)
        conn.execute("DELETE FROM chat_settings WHERE (user_id=? AND other_user_id=?) OR (user_id=? AND other_user_id=?)",
                     (uid, target_id, target_id, uid))
        blocked = True

    conn.commit()
    conn.close()
    return jsonify({"ok": True, "blocked": blocked})


@app.route("/api/users/<username>/block-status")
@login_required
def block_status(username):
    uid = session["user_id"]
    conn = db()
    user = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    blocked = conn.execute("SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?",
                           (uid, user["id"])).fetchone() is not None
    # S8 — do NOT reveal whether they blocked us (privacy leak)
    conn.close()
    return jsonify({"blocked": blocked})


@app.route("/api/report", methods=["POST"])
@login_required
@rate_limit("report", 10, 3600)
def create_report():
    d = request.json or {}
    target_type = (d.get("target_type") or "").strip()
    target_id = d.get("target_id")
    reason = (d.get("reason") or "").strip()
    notes = (d.get("notes") or "").strip()[:500]

    if target_type not in ("post", "user", "comment", "reel"):
        return jsonify({"error": "ভুল রিপোর্ট টাইপ"}), 400
    try:
        target_id = int(target_id)
    except (ValueError, TypeError):
        return jsonify({"error": "ভুল টার্গেট"}), 400
    if reason not in ("spam", "harassment", "violence", "false_info", "other"):
        return jsonify({"error": "কারণ নির্বাচন করুন"}), 400

    uid = session["user_id"]
    conn = db()

    # Validate target exists + not self
    if target_type == "post":
        t = conn.execute("SELECT user_id FROM posts WHERE id=?", (target_id,)).fetchone()
        if not t:
            conn.close(); return jsonify({"error": "পোস্ট পাওয়া যায়নি"}), 404
        if t["user_id"] == uid:
            conn.close(); return jsonify({"error": "নিজের পোস্ট রিপোর্ট করা যাবে না"}), 400
    elif target_type == "user":
        t = conn.execute("SELECT id FROM users WHERE id=?", (target_id,)).fetchone()
        if not t:
            conn.close(); return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
        if t["id"] == uid:
            conn.close(); return jsonify({"error": "নিজেকে রিপোর্ট করা যাবে না"}), 400
    elif target_type == "comment":
        t = conn.execute("SELECT user_id FROM comments WHERE id=?", (target_id,)).fetchone()
        if not t:
            conn.close(); return jsonify({"error": "কমেন্ট পাওয়া যায়নি"}), 404
        if t["user_id"] == uid:
            conn.close(); return jsonify({"error": "নিজের কমেন্ট রিপোর্ট করা যাবে না"}), 400
    elif target_type == "reel":
        t = conn.execute("SELECT user_id FROM reels WHERE id=?", (target_id,)).fetchone()
        if not t:
            conn.close(); return jsonify({"error": "রিল পাওয়া যায়নি"}), 404
        if t["user_id"] == uid:
            conn.close(); return jsonify({"error": "নিজের রিল রিপোর্ট করা যাবে না"}), 400

    try:
        conn.execute("""INSERT INTO reports (reporter_id, target_type, target_id, reason, notes)
            VALUES (?,?,?,?,?)""", (uid, target_type, target_id, reason, notes))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "আপনি আগেই এটা রিপোর্ট করেছেন"}), 400

    conn.close()
    return jsonify({"ok": True})


@app.route("/api/me/reports")
@login_required
def my_reports():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""SELECT id, target_type, target_id, reason, status, created_at
        FROM reports WHERE reporter_id=? ORDER BY created_at DESC LIMIT 50""",
        (uid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/me/blocked-list")
@login_required
def my_blocked_list():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT u.username, u.display_name, u.profile_pic, b.created_at
        FROM blocks b JOIN users u ON u.id = b.blocked_id
        WHERE b.blocker_id=? ORDER BY b.created_at DESC
    """, (uid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/users/<username>/mutual")
@login_required
def get_mutual_followers(username):
    uid = session["user_id"]
    conn = db()
    user = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    # S22 / Series 27A-2 — hide admin mutual followers
    if _is_admin(user["id"]) and not _is_admin(uid):
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    rows = conn.execute("""
        SELECT DISTINCT u2.username, u2.display_name, u2.profile_pic
        FROM follows f1
        JOIN follows f2 ON f2.follower_id = f1.following_id
        JOIN users u2 ON u2.id = f1.following_id
        WHERE f1.follower_id = ?
          AND f2.following_id = ?
          AND u2.id != ?
          AND u2.id != ?
        ORDER BY u2.display_name
        LIMIT 200
    """, (uid, user["id"], uid, user["id"])).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/users/<username>/followers")
@login_required
def get_followers(username):
    conn = db()
    user = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    # S22 / Series 27A-2 — hide admin followers
    if _is_admin(user["id"]) and not _is_admin(session["user_id"]):
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    rows = conn.execute("""SELECT u.username, u.display_name, u.profile_pic
        FROM follows f JOIN users u ON u.id = f.follower_id
        WHERE f.following_id=?
          AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
        ORDER BY f.created_at DESC""", (user["id"], session["user_id"], session["user_id"])).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/users/<username>/following")
@login_required
def get_following(username):
    conn = db()
    user = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    # S22 / Series 27A-2 — hide admin following list
    if _is_admin(user["id"]) and not _is_admin(session["user_id"]):
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    rows = conn.execute("""SELECT u.username, u.display_name, u.profile_pic
        FROM follows f JOIN users u ON u.id = f.following_id
        WHERE f.follower_id=?
          AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
        ORDER BY f.created_at DESC""", (user["id"], session["user_id"], session["user_id"])).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/debug/privacy-check")
@login_required
def debug_privacy_check():
    """S18.9h3 — diagnostic for privacy state."""
    uid = session["user_id"]
    conn = db()
    user = conn.execute("""SELECT username,
                                  COALESCE(is_private,0) AS is_private,
                                  COALESCE(is_admin,0) AS is_admin
                           FROM users WHERE id=?""", (uid,)).fetchone()
    total_posts = conn.execute(
        "SELECT COUNT(*) AS c FROM posts WHERE user_id=?", (uid,)
    ).fetchone()["c"]
    followers = conn.execute(
        "SELECT COUNT(*) AS c FROM follows WHERE following_id=?", (uid,)
    ).fetchone()["c"]
    conn.close()

    is_priv = bool(user["is_private"])
    can_view_by_others = (not is_priv)

    return jsonify({
        "username": user["username"],
        "is_private_in_db": is_priv,
        "is_admin": bool(user["is_admin"]),
        "total_posts": total_posts,
        "followers": followers,
        "non_followers_can_see": can_view_by_others,
        "verdict": (
            "✅ PUBLIC — all users can see your posts" if not is_priv
            else f"🔒 PRIVATE — only {followers} followers can see your posts"
        ),
    })


@app.route("/api/debug/my-status")
@login_required
def debug_my_status():
    uid = session["user_id"]
    conn = db()
    user = conn.execute("""SELECT username, display_name,
                                  COALESCE(is_private,0) AS is_private,
                                  COALESCE(is_admin,0) AS is_admin
                           FROM users WHERE id=?""", (uid,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "user not found"}), 404

    total_posts = conn.execute("SELECT COUNT(*) AS c FROM posts WHERE user_id=?", (uid,)).fetchone()["c"]
    recent_7d = conn.execute("SELECT COUNT(*) AS c FROM posts WHERE user_id=? AND datetime(created_at) > datetime('now','-7 days')", (uid,)).fetchone()["c"]
    hashtag_posts = conn.execute("SELECT COUNT(*) AS c FROM posts WHERE user_id=? AND content LIKE '%#%'", (uid,)).fetchone()["c"]
    followers = conn.execute("SELECT COUNT(*) AS c FROM follows WHERE following_id=?", (uid,)).fetchone()["c"]
    conn.close()

    is_priv = bool(user["is_private"])
    if is_priv:
        diag = "PRIVATE_ACCOUNT — posts only visible to followers"
    elif recent_7d == 0 and total_posts > 0:
        diag = "NO_RECENT_POSTS — older than 7 days, Explore hides them"
    elif hashtag_posts == 0:
        diag = "NO_HASHTAGS — add #hashtag to appear in Trending"
    else:
        diag = "OK — should be visible"

    return jsonify({
        "username": user["username"],
        "is_private": is_priv,
        "is_admin": bool(user["is_admin"]),
        "total_posts": total_posts,
        "posts_last_7_days": recent_7d,
        "hashtag_posts": hashtag_posts,
        "followers": followers,
        "diagnosis": diag,
    })


@app.route("/api/me/privacy", methods=["POST"])
@login_required
def update_privacy():
    """S18.9h2 — user-controlled privacy (removed admin enforcement)."""
    d = request.json or {}
    is_private = 1 if d.get("is_private") else 0
    uid = session["user_id"]

    conn = db()
    conn.execute("UPDATE users SET is_private=? WHERE id=?", (is_private, uid))
    conn.commit()
    # Verify it saved
    saved = conn.execute("SELECT COALESCE(is_private,0) AS p FROM users WHERE id=?",
                         (uid,)).fetchone()
    conn.close()

    return jsonify({
        "ok": True,
        "is_private": bool(saved["p"]) if saved else False,
    })


@app.route("/api/me/onboarded", methods=["POST"])
@login_required
def mark_onboarded():
    conn = db()
    conn.execute("UPDATE users SET onboarded=1 WHERE id=?", (session["user_id"],))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/me/logout-all", methods=["POST"])
@login_required
def logout_all_devices():
    """S6 — bump session_version to invalidate every session, then refresh current one."""
    uid = session["user_id"]
    current_token = session.get("session_sid")
    conn = db()
    conn.execute("UPDATE users SET session_version = COALESCE(session_version, 0) + 1 WHERE id=?",
                 (uid,))
    if current_token:
        conn.execute("DELETE FROM sessions WHERE user_id=? AND token!=?", (uid, current_token))
    else:
        conn.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
    conn.commit()
    new_ver = conn.execute("SELECT session_version FROM users WHERE id=?",
                           (uid,)).fetchone()["session_version"]
    conn.close()
    # Keep this session alive
    session["session_version"] = new_ver
    session["session_start"] = int(time.time())
    return jsonify({"ok": True})


@app.route("/api/me/2fa/setup", methods=["POST"])
@login_required
def setup_2fa():
    """Generate a fresh TOTP secret (does not enable yet).

    S22 / Series 27B-2 — requires verified recovery email.
    """
    uid = session["user_id"]

    # S22 / Series 27B-2 — mandatory verified email before 2FA
    _conn_check = db()
    _row_check = _conn_check.execute(
        "SELECT email, COALESCE(email_verified, 0) AS v FROM users WHERE id=?",
        (uid,)
    ).fetchone()
    _conn_check.close()
    if not _row_check or not _row_check["email"] or not _row_check["v"]:
        return jsonify({
            "error": "2FA চালু করার আগে একটি verified recovery email যোগ করুন। "
                     "নাহলে device হারালে অ্যাকাউন্টে আর ঢুকতে পারবেন না।",
            "needs_email": True,
        }), 403

    secret_b32 = _gen_totp_secret()
    conn = db()
    row = conn.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    conn.execute("UPDATE users SET totp_secret=?, totp_enabled=0 WHERE id=?",
                 (secret_b32, uid))
    conn.commit()
    conn.close()

    # otpauth URI for authenticator apps
    issuer = "JUKTOY"
    label = f"{issuer}:{row['username']}"
    otpauth = (
        f"otpauth://totp/{label}?"
        f"secret={secret_b32}&issuer={issuer}&algorithm=SHA1"
        f"&digits={_TOTP_DIGITS}&period={_TOTP_STEP}"
    )
    return jsonify({"ok": True, "secret": secret_b32, "otpauth": otpauth})


@app.route("/api/me/2fa/verify", methods=["POST"])
@login_required
def verify_2fa_setup():
    """Verify code from authenticator; on success, enable 2FA + return backup codes."""
    d = request.json or {}
    code = (d.get("code") or "").strip()
    uid = session["user_id"]

    # S22 / Series 27B-2 — defense in depth: also block verify without email
    _conn_check = db()
    _row_check = _conn_check.execute(
        "SELECT email, COALESCE(email_verified, 0) AS v FROM users WHERE id=?",
        (uid,)
    ).fetchone()
    _conn_check.close()
    if not _row_check or not _row_check["email"] or not _row_check["v"]:
        return jsonify({
            "error": "2FA চালু করার আগে verified recovery email লাগবে।",
            "needs_email": True,
        }), 403

    conn = db()
    row = conn.execute("SELECT totp_secret FROM users WHERE id=?", (uid,)).fetchone()
    if not row or not row["totp_secret"]:
        conn.close()
        return jsonify({"error": "প্রথমে setup শুরু করুন"}), 400

    if not _verify_totp(row["totp_secret"], code):
        conn.close()
        return jsonify({"error": "ভুল কোড। আবার চেষ্টা করুন।"}), 400

    plain_codes, hashed_csv = _generate_backup_codes(10)
    conn.execute("""UPDATE users SET totp_enabled=1, backup_codes=?
                    WHERE id=?""", (hashed_csv, uid))
    conn.commit()
    conn.close()

    # S16.6 — log 2FA enable
    _log_security_event("2fa_enable", uid=uid)

    return jsonify({"ok": True, "backup_codes": plain_codes})


@app.route("/api/me/2fa/disable", methods=["POST"])
@login_required
def disable_2fa():
    d = request.json or {}
    password = d.get("password") or ""
    code = d.get("totp_code") or ""
    if not password:
        return jsonify({"error": "পাসওয়ার্ড দিন"}), 400
    uid = session["user_id"]
    # S15.5 — sensitive action verify
    ok, msg = _verify_sensitive_action(uid, password, code)
    if not ok:
        return jsonify({"error": msg}), 400

    conn = db()
    # S27B-4 — only clear TOTP; email 2FA has its own endpoint
    conn.execute("""UPDATE users SET totp_enabled=0, totp_secret=NULL,
                    backup_codes='' WHERE id=?""", (uid,))
    conn.commit()
    conn.close()
    _log_security_event("2fa_disable", uid=uid)
    return jsonify({"ok": True})


@app.route("/api/me/security-overview")
@login_required
def security_overview():
    """S22 / Series 27B-1 — one-glance security posture for current user."""
    uid = session["user_id"]
    conn = db()
    row = conn.execute("""
        SELECT COALESCE(totp_enabled, 0) AS tfa,
               COALESCE(backup_codes, '') AS bc,
               recovery_code_hash,
               email,
               COALESCE(email_verified, 0) AS email_v,
               phone,
               COALESCE(phone_verified, 0) AS phone_v,
               backup_email,
               COALESCE(backup_email_verified, 0) AS backup_email_v,
               password_hash,
               created_at,
               last_seen
        FROM users WHERE id=?
    """, (uid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404

    backup_count = len([c for c in (row["bc"] or "").split(",") if c])
    has_password = bool(row["password_hash"])

    # Simple risk scoring
    score = 0
    score += 30 if has_password else 0
    score += 40 if row["tfa"] else 0
    score += 10 if row["email_v"] else 0
    score += 10 if backup_count >= 5 else (5 if backup_count > 0 else 0)
    score += 10 if row["recovery_code_hash"] else 0
    score = min(score, 100)

    if score >= 90:
        risk = "excellent"
        risk_label = "দুর্দান্ত সুরক্ষিত"
    elif score >= 70:
        risk = "good"
        risk_label = "ভালো সুরক্ষিত"
    elif score >= 40:
        risk = "moderate"
        risk_label = "মাঝারি সুরক্ষিত"
    else:
        risk = "weak"
        risk_label = "দুর্বল সুরক্ষা"

    return jsonify({
        "score": score,
        "risk": risk,
        "risk_label": risk_label,
        "checks": {
            "password": {
                "ok": has_password,
                "label": "পাসওয়ার্ড",
                "hint": "শক্তিশালী পাসওয়ার্ড সেট আছে" if has_password else "পাসওয়ার্ড সেট করুন",
            },
            "two_factor": {
                "ok": bool(row["tfa"]),
                "label": "Two-Factor Authentication",
                "hint": "চালু আছে" if row["tfa"] else "এখনো চালু করা হয়নি — অ্যাকাউন্ট বেশি সুরক্ষিত করুন",
            },
            "email": {
                "ok": bool(row["email_v"]),
                "label": "Recovery Email",
                "email": row["email"] or "",
                "hint": "যাচাইকৃত" if row["email_v"] else ("ইমেইল যুক্ত আছে কিন্তু verify হয়নি" if row["email"] else "কোনো recovery email নেই"),
            },
            "backup_codes": {
                "ok": backup_count > 0,
                "label": "Backup Codes",
                "count": backup_count,
                "hint": f"{backup_count}টি কোড বাকি" if backup_count else "কোনো backup code নেই",
            },
            "recovery_code": {
                "ok": bool(row["recovery_code_hash"]),
                "label": "Recovery Code",
                "hint": "সেট আছে — device হারালে এটা দিয়ে 2FA বন্ধ করতে পারবেন" if row["recovery_code_hash"] else "এখনো সেট করা হয়নি",
            },
            "phone": {
                "ok": bool(row["phone_v"]),
                "label": "Phone (SMS)",
                "phone": row["phone"] or "",
                "coming_soon": not bool(os.environ.get("JUKTOY_SMS_PROVIDER") or os.environ.get("JUKTOY_TWILIO_ACCOUNT_SID")),
                "hint": "যুক্ত আছে" if row["phone_v"] else "শীঘ্রই আসছে",
            },
            "backup_email": {
                "ok": bool(row["backup_email_v"]),
                "label": "Backup Email",
                "email": row["backup_email"] or "",
                "hint": "যাচাইকৃত" if row["backup_email_v"] else ("যুক্ত আছে, verify হয়নি" if row["backup_email"] else "এখনো সেট করা হয়নি"),
            },
        },
        "account_created_at": row["created_at"],
        "last_seen": row["last_seen"],
    })


@app.route("/api/me/recovery-code/regenerate", methods=["POST"])
@login_required
@rate_limit("recovery_regen", 3, 3600)
def regenerate_recovery_code():
    """S22 / Series 27B — generate a new permanent recovery code.

    Requires password + (if 2FA on) TOTP/backup code.
    Returns plaintext code ONCE — user must save it.
    """
    d = request.json or {}
    password = d.get("password") or ""
    code = d.get("totp_code") or ""
    if not password:
        return jsonify({"error": "পাসওয়ার্ড দিন"}), 400

    uid = session["user_id"]
    ok, msg = _verify_sensitive_action(uid, password, code)
    if not ok:
        return jsonify({"error": msg}), 400

    plain, hashed = _generate_recovery_code()
    conn = db()
    conn.execute("UPDATE users SET recovery_code_hash=? WHERE id=?", (hashed, uid))
    conn.commit()
    conn.close()

    _log_security_event("recovery_code_regenerated", uid=uid)
    return jsonify({
        "ok": True,
        "recovery_code": plain,
        "warning": "এই কোড শুধু একবার দেখানো হবে। এখনই নিরাপদে সংরক্ষণ করুন।",
    })


@app.route("/api/me/recovery-code/status")
@login_required
def recovery_code_status():
    """Check if user has a recovery code set."""
    uid = session["user_id"]
    conn = db()
    row = conn.execute("SELECT recovery_code_hash FROM users WHERE id=?", (uid,)).fetchone()
    conn.close()
    return jsonify({"has_code": bool(row and row["recovery_code_hash"])})


@app.route("/api/me/2fa/email/enable", methods=["POST"])
@login_required
def enable_email_2fa():
    """S27B-4 — enable email-based 2FA (requires verified email)."""
    uid = session["user_id"]
    d = request.json or {}
    password = d.get("password") or ""
    if not password:
        return jsonify({"error": "পাসওয়ার্ড দিন"}), 400

    # Verify password
    ok, msg = _verify_sensitive_action(uid, password, None)
    if not ok:
        return jsonify({"error": msg}), 400

    conn = db()
    row = conn.execute(
        "SELECT email, COALESCE(email_verified,0) AS ev FROM users WHERE id=?",
        (uid,)
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    if not row["email"] or not row["ev"]:
        conn.close()
        return jsonify({
            "error": "আগে verified recovery email যোগ করুন।",
            "needs_email": True,
        }), 403

    conn.execute("UPDATE users SET email_2fa_enabled=1 WHERE id=?", (uid,))
    conn.commit()
    conn.close()

    _log_security_event("email_2fa_enabled", uid=uid)
    return jsonify({
        "ok": True,
        "message": "Email 2FA চালু হয়েছে। এখন login-এ ইমেইলে কোড আসবে।",
    })


@app.route("/api/me/2fa/email/disable", methods=["POST"])
@login_required
def disable_email_2fa():
    """S27B-4 — disable email-based 2FA."""
    uid = session["user_id"]
    d = request.json or {}
    password = d.get("password") or ""
    code = d.get("totp_code") or ""
    if not password:
        return jsonify({"error": "পাসওয়ার্ড দিন"}), 400

    ok, msg = _verify_sensitive_action(uid, password, code)
    if not ok:
        return jsonify({"error": msg}), 400

    conn = db()
    conn.execute("UPDATE users SET email_2fa_enabled=0 WHERE id=?", (uid,))
    conn.commit()
    conn.close()

    _log_security_event("email_2fa_disabled", uid=uid)
    return jsonify({"ok": True, "message": "Email 2FA বন্ধ করা হয়েছে।"})


@app.route("/api/me/recovery-kit")
@login_required
def recovery_kit():
    """S27B-7 — generate a downloadable recovery kit (plain text)."""
    uid = session["user_id"]
    conn = db()
    row = conn.execute("""
        SELECT username, display_name, email,
               COALESCE(email_verified,0) AS ev,
               COALESCE(backup_codes,'') AS bc,
               recovery_code_hash,
               COALESCE(totp_enabled,0) AS totp,
               COALESCE(email_2fa_enabled,0) AS email2fa,
               created_at
        FROM users WHERE id=?
    """, (uid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404

    NL = chr(10)
    SEP = "=" * 60

    backup_count = len([c for c in (row["bc"] or "").split(",") if c])
    methods = []
    if row["totp"]: methods.append("Authenticator App (TOTP)")
    if row["email2fa"]: methods.append("Email 2FA")
    methods_str = ", ".join(methods) if methods else "None"

    lines = [
        SEP,
        "JUKTOY ACCOUNT RECOVERY KIT",
        SEP,
        "",
        "Generated: " + time.strftime("%d %b %Y, %H:%M", time.localtime()),
        "",
        "ACCOUNT INFO",
        "-" * 60,
        "Username:      " + str(row["username"]),
        "Display Name:  " + str(row["display_name"] or ""),
        "Recovery Email: " + str(row["email"] or "(not set)")
            + (" (verified)" if row["ev"] else ""),
        "Account Created: " + str(row["created_at"]),
        "",
        "SECURITY STATUS",
        "-" * 60,
        "2FA Methods:   " + methods_str,
        "Backup Codes:  " + str(backup_count) + " remaining",
        "Recovery Code: " + ("SET (stored in DB)" if row["recovery_code_hash"]
                             else "NOT SET"),
        "",
        "RECOVERY INSTRUCTIONS",
        "-" * 60,
        "",
        "If you lose your 2FA device:",
        "  1. Go to the login page",
        "  2. Click '2FA device হারিয়ে ফেলেছেন?'",
        "  3. Enter your username + password",
        "  4. Enter a backup code OR wait for email code",
        "  5. 2FA will be disabled — then login and re-enable",
        "",
        "IMPORTANT SAFETY RULES:",
        "  * NEVER share this file with anyone",
        "  * Store in a password manager OR print & lock away",
        "  * If you suspect compromise, change password immediately",
        "",
        "If you have lost ALL methods (2FA device, backup codes,",
        "recovery code, AND email access), your account CANNOT",
        "be recovered. This is by design for your security.",
        "",
        SEP,
        "Generated by JUKTOY — " + str(row["username"]),
        SEP,
    ]
    body = NL.join(lines)
    return body, 200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": 'attachment; filename="juktoy-recovery-"'
                               + str(row["username"]) + '.txt"',
    }


@app.route("/api/me/phone/set", methods=["POST"])
@login_required
def set_phone():
    """S27B-8 — phone placeholder (coming soon)."""
    return jsonify({
        "error": "SMS ভেরিফিকেশন শীঘ্রই আসছে (Twilio integration pending)।",
        "coming_soon": True,
    }), 501


@app.route("/api/me/phone/status")
@login_required
def phone_status():
    """S27B-8 — report SMS provider availability."""
    provider = os.environ.get("JUKTOY_SMS_PROVIDER") or ""
    twilio = bool(os.environ.get("JUKTOY_TWILIO_ACCOUNT_SID"))
    return jsonify({
        "available": bool(provider or twilio),
        "coming_soon": not bool(provider or twilio),
    })


@app.route("/api/me/backup-email/set", methods=["POST"])
@login_required
def set_backup_email():
    """S27B-9 — set secondary recovery email."""
    uid = session["user_id"]
    d = request.json or {}
    email = (d.get("email") or "").strip().lower()
    password = d.get("password") or ""

    if not email or not _is_valid_email(email):
        return jsonify({"error": "বৈধ ইমেইল দিন"}), 400
    if not password:
        return jsonify({"error": "পাসওয়ার্ড দিন"}), 400

    ok, msg = _verify_sensitive_action(uid, password, None)
    if not ok:
        return jsonify({"error": msg}), 400

    conn = db()
    # Prevent duplicate with primary email
    row = conn.execute("SELECT email FROM users WHERE id=?", (uid,)).fetchone()
    if row and row["email"] and row["email"].lower() == email:
        conn.close()
        return jsonify({"error": "এটি আপনার primary email — ভিন্ন ইমেইল দিন"}), 400

    # Save (unverified until they click link)
    conn.execute("UPDATE users SET backup_email=?, backup_email_verified=0 WHERE id=?",
                 (email, uid))
    conn.commit()
    conn.close()

    _log_security_event("backup_email_set", uid=uid, metadata={"email": email})
    return jsonify({"ok": True, "email": email,
                    "message": "Backup email সেট হয়েছে। যাচাইয়ের ইমেইল পাঠানো হবে।"})


@app.route("/api/me/backup-email/remove", methods=["POST"])
@login_required
def remove_backup_email():
    """S27B-9 — remove backup email."""
    uid = session["user_id"]
    d = request.json or {}
    password = d.get("password") or ""
    if not password:
        return jsonify({"error": "পাসওয়ার্ড দিন"}), 400
    ok, msg = _verify_sensitive_action(uid, password, None)
    if not ok:
        return jsonify({"error": msg}), 400

    conn = db()
    conn.execute("UPDATE users SET backup_email=NULL, backup_email_verified=0 WHERE id=?",
                 (uid,))
    conn.commit()
    conn.close()
    _log_security_event("backup_email_removed", uid=uid)
    return jsonify({"ok": True})


@app.route("/api/admin/debug/smtp")
@admin_required_no_2fa
def admin_debug_smtp():
    """S27B — email diagnostic (admin only). Prefers Brevo, falls back to SMTP."""
    bcfg = _brevo_config()
    if bcfg:
        return jsonify({
            "configured": True,
            "mode": "brevo-api",
            "sender": bcfg["sender"],
            "key_len": len(bcfg["key"]),
            "key_prefix": bcfg["key"][:12] + "...",
            "last_error": _LAST_EMAIL_ERROR.get("err"),
            "last_error_at": _LAST_EMAIL_ERROR.get("at"),
        })

    cfg = _smtp_config()
    if not cfg:
        return jsonify({
            "configured": False,
            "error": "Neither Brevo nor SMTP configured",
            "env_check": {
                "BREVO_KEY": bool(_os.environ.get("JUKTOY_BREVO_API_KEY")),
                "MAIL_FROM": bool(_os.environ.get("JUKTOY_MAIL_FROM")),
                "SMTP_HOST": bool(_os.environ.get("JUKTOY_SMTP_HOST")),
                "SMTP_USER": bool(_os.environ.get("JUKTOY_SMTP_USER")),
                "SMTP_PASS": bool(_os.environ.get("JUKTOY_SMTP_PASS")),
            }
        })
    return jsonify({
        "configured": True,
        "mode": "smtp",
        "host": cfg["host"],
        "port": cfg["port"],
        "user": cfg["user"],
        "pass_len": len(cfg["password"]),
        "from_addr": cfg["from_addr"],
        "last_error": _LAST_EMAIL_ERROR.get("err"),
        "last_error_at": _LAST_EMAIL_ERROR.get("at"),
    })


@app.route("/api/admin/debug/test-email", methods=["POST"])
@admin_required_no_2fa
@rate_limit("test_email", 3, 3600)
def admin_debug_test_email():
    """S27B — send a test email (admin only)."""
    d = request.json or {}
    to = (d.get("to") or "").strip()
    if not to or not _is_valid_email(to):
        return jsonify({"error": "বৈধ ইমেইল দিন"}), 400
    ok = _send_email(to, "JUKTOY SMTP test",
                     "This is a test email from JUKTOY admin panel.")
    return jsonify({
        "ok": ok,
        "error": _LAST_EMAIL_ERROR.get("err") if not ok else None,
    })


@app.route("/api/admin/debug/reset-email-verified", methods=["POST"])
@admin_required_no_2fa
def admin_debug_reset_verified():
    """S27B — reset own email_verified to 0 for testing."""
    uid = session["user_id"]
    conn = db()
    conn.execute("UPDATE users SET email_verified=0 WHERE id=?", (uid,))
    conn.commit()
    conn.close()
    _log_security_event("admin_reset_email_verified", uid=uid)
    return jsonify({"ok": True, "message": "email_verified reset to 0"})


@app.route("/api/me/2fa/status")
@login_required
def status_2fa():
    uid = session["user_id"]
    conn = db()
    row = conn.execute("""SELECT COALESCE(totp_enabled,0) AS en,
                                COALESCE(backup_codes,'') AS bc,
                                COALESCE(email_2fa_enabled,0) AS email_en,
                                email,
                                COALESCE(email_verified,0) AS email_v
                          FROM users WHERE id=?""", (uid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"enabled": False, "email_2fa_enabled": False,
                        "backup_codes_remaining": 0, "email_verified": False})
    remaining = len([c for c in (row["bc"] or "").split(",") if c])
    email_ok = bool(row["email"] and row["email_v"])
    return jsonify({
        "enabled": bool(row["en"]) or bool(row["email_en"]),
        "totp_enabled": bool(row["en"]),
        "email_2fa_enabled": bool(row["email_en"]),
        "email_verified": email_ok,
        "backup_codes_remaining": remaining,
    })


@app.route("/api/me/bio", methods=["POST"])
@login_required
def update_bio():
    data = request.json or {}
    bio = (data.get("bio") or "").strip()[:200]
    name = (data.get("display_name") or "").strip()
    conn = db()
    if name:
        conn.execute("UPDATE users SET bio=?, display_name=? WHERE id=?",
                     (bio, name, session["user_id"]))
    else:
        conn.execute("UPDATE users SET bio=? WHERE id=?", (bio, session["user_id"]))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "bio": bio})


@app.route("/api/me/cover", methods=["POST"])
@login_required
def update_cover():
    data = (request.json.get("cover") or "").strip()
    conn = db()

    if not data:
        conn.execute(
            "UPDATE users SET cover_pic=NULL WHERE id=?",
            (session["user_id"],)
        )
        conn.commit()
        conn.close()
        return jsonify({"ok": True, "cover": None})

    if not is_valid_image_uri(data, 4_000_000):
        conn.close()
        return jsonify({"error": "অবৈধ ছবি বা ৩ MB এর বেশি"}), 400

    # S17.1 — save to filesystem
    saved = _save_data_uri(data, "covers", prefix=f"u{session['user_id']}_")
    if not saved:
        conn.close()
        return jsonify({"error": "ছবি সংরক্ষণ করা যায়নি"}), 500
    old = conn.execute("SELECT cover_pic FROM users WHERE id=?",
                       (session["user_id"],)).fetchone()
    if old and old["cover_pic"]:
        _delete_upload_file(old["cover_pic"])
    conn.execute(
        "UPDATE users SET cover_pic=? WHERE id=?",
        (saved, session["user_id"])
    )
    conn.commit()
    conn.close()

    return jsonify({"ok": True, "cover": saved})


@app.route("/api/me/avatar", methods=["POST"])
@login_required
def update_avatar():
    data = (request.json.get("avatar") or "").strip()
    conn = db()
    if not data:
        conn.execute("UPDATE users SET profile_pic=NULL WHERE id=?", (session["user_id"],))
        conn.commit()
        conn.close()
        return jsonify({"ok": True, "avatar": None})
    if not is_valid_image_uri(data, 3_000_000):
        conn.close()
        return jsonify({"error": "অবৈধ ছবি বা ২ MB এর বেশি"}), 400
    # S17.1 — save to filesystem
    saved = _save_data_uri(data, "avatars", prefix=f"u{session['user_id']}_")
    if not saved:
        conn.close()
        return jsonify({"error": "ছবি সংরক্ষণ করা যায়নি"}), 500
    # Delete old avatar file (if it was a file, not base64)
    old = conn.execute("SELECT profile_pic FROM users WHERE id=?",
                       (session["user_id"],)).fetchone()
    if old and old["profile_pic"]:
        _delete_upload_file(old["profile_pic"])
    conn.execute("UPDATE users SET profile_pic=? WHERE id=?",
                 (saved, session["user_id"]))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "avatar": saved})


@app.route("/api/me/password", methods=["POST"])
@login_required
@rate_limit("chpw", 5, 3600)
def change_password():
    d = request.json or {}
    current = d.get("current_password") or ""
    new_pw = d.get("new_password") or ""
    code = d.get("totp_code") or ""
    if not current or not new_pw:
        return jsonify({"error": "সব ফিল্ড পূরণ করুন"}), 400
    # S15.1 — strong password check (+ S15.7 breach check)
    ok, msg = validate_password_strength(new_pw, check_breach=True)
    if not ok:
        return jsonify({"error": msg}), 400
    # S15.5 — sensitive action verify
    ok, msg = _verify_sensitive_action(session["user_id"], current, code)
    if not ok:
        return jsonify({"error": msg}), 400
    conn = db()
    row = conn.execute("SELECT id FROM users WHERE id=?",
                       (session["user_id"],)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    new_hash = make_password_hash(new_pw)
    # S6 — bump version, then keep only this session
    conn.execute("""UPDATE users SET salt='', password_hash=?,
                    session_version = COALESCE(session_version, 0) + 1
                    WHERE id=?""",
                 (new_hash, session["user_id"]))
    conn.commit()
    new_ver = conn.execute("SELECT session_version FROM users WHERE id=?",
                           (session["user_id"],)).fetchone()["session_version"]
    conn.close()
    # Update current session with new version (so we don't get logged out)
    session["session_version"] = new_ver
    session["session_start"] = int(time.time())
    # S16.6 — log password change
    _log_security_event("password_change", uid=session["user_id"])
    return jsonify({"ok": True})


@app.route("/api/me/username", methods=["POST"])
@login_required
@rate_limit("chuname", 3, 86400)
def change_username():
    d = request.json or {}
    new_username = (d.get("username") or "").strip().lower()
    password = d.get("password") or ""
    code = d.get("totp_code") or ""
    if not new_username:
        return jsonify({"error": "ইউজারনেম দিতে হবে"}), 400
    if not password:
        return jsonify({"error": "নিশ্চিত করতে পাসওয়ার্ড দিন"}), 400
    # S15.5 — sensitive action verify
    ok, msg = _verify_sensitive_action(session["user_id"], password, code)
    if not ok:
        return jsonify({"error": msg}), 400
    if len(new_username) > 30:
        return jsonify({"error": "ইউজারনেম অনেক বড়"}), 400
    if not re.match(r'^[a-z0-9_]+$', new_username):
        return jsonify({"error": "শুধু a-z, 0-9, _ ব্যবহার করুন"}), 400
    # S8 — timing normalization
    _t0 = time.time()
    conn = db()
    existing = conn.execute("SELECT id FROM users WHERE username=? AND id!=?",
                            (new_username, session["user_id"])).fetchone()
    if existing:
        conn.close()
        _elapsed = time.time() - _t0
        if _elapsed < 0.25:
            time.sleep(0.25 - _elapsed)
        # S8 — neutral wording
        return jsonify({"error": "এই ইউজারনেম ব্যবহার করা যাবে না। ভিন্ন নাম চেষ্টা করুন।"}), 400
    conn.execute("UPDATE users SET username=? WHERE id=?",
                 (new_username, session["user_id"]))
    conn.commit()
    conn.close()
    _elapsed = time.time() - _t0
    if _elapsed < 0.25:
        time.sleep(0.25 - _elapsed)
    return jsonify({"ok": True, "username": new_username})


@app.route("/api/me/delete-account", methods=["POST"])
@login_required
@rate_limit("delacct", 3, 3600)
def delete_account():
    d = request.json or {}
    password = d.get("password") or ""
    code = d.get("totp_code") or ""
    if not password:
        return jsonify({"error": "পাসওয়ার্ড দিন"}), 400

    uid = session["user_id"]
    # S15.5 — sensitive action verify
    ok, msg = _verify_sensitive_action(uid, password, code)
    if not ok:
        return jsonify({"error": msg}), 400

    conn = db()
    row = conn.execute("SELECT id, profile_pic, cover_pic FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404

    # S22 / Series 8B — collect file paths BEFORE deleting DB rows
    files_to_delete = []
    if row["profile_pic"]:
        files_to_delete.append(row["profile_pic"])
    if row["cover_pic"]:
        files_to_delete.append(row["cover_pic"])
    for r in conn.execute("""
        SELECT media FROM post_media
        WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)
    """, (uid,)).fetchall():
        if r["media"]:
            files_to_delete.append(r["media"])
    for r in conn.execute("SELECT media FROM stories WHERE user_id=?", (uid,)).fetchall():
        if r["media"]:
            files_to_delete.append(r["media"])
    for r in conn.execute("SELECT video FROM reels WHERE user_id=?", (uid,)).fetchall():
        if r["video"]:
            files_to_delete.append(r["video"])
    for r in conn.execute("SELECT attachment FROM messages WHERE sender_id=? AND attachment IS NOT NULL", (uid,)).fetchall():
        if r["attachment"]:
            files_to_delete.append(r["attachment"])
    for r in conn.execute("SELECT attachment FROM group_messages WHERE sender_id=? AND attachment IS NOT NULL", (uid,)).fetchall():
        if r["attachment"]:
            files_to_delete.append(r["attachment"])

    # Cascade delete
    conn.execute("DELETE FROM post_media WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)", (uid,))
    conn.execute("DELETE FROM reactions WHERE user_id=? OR post_id IN (SELECT id FROM posts WHERE user_id=?)", (uid, uid))
    conn.execute("DELETE FROM comment_likes WHERE user_id=? OR comment_id IN (SELECT id FROM comments WHERE user_id=?)", (uid, uid))
    conn.execute("DELETE FROM comments WHERE user_id=? OR post_id IN (SELECT id FROM posts WHERE user_id=?)", (uid, uid))
    conn.execute("DELETE FROM saves WHERE user_id=? OR post_id IN (SELECT id FROM posts WHERE user_id=?)", (uid, uid))
    conn.execute("DELETE FROM reposts WHERE user_id=? OR post_id IN (SELECT id FROM posts WHERE user_id=?)", (uid, uid))
    conn.execute("DELETE FROM notifications WHERE user_id=? OR actor_id=?", (uid, uid))
    conn.execute("DELETE FROM follows WHERE follower_id=? OR following_id=?", (uid, uid))
    conn.execute("DELETE FROM message_reactions WHERE user_id=? OR message_id IN (SELECT id FROM messages WHERE sender_id=? OR receiver_id=?)", (uid, uid, uid))
    conn.execute("UPDATE messages SET parent_id=NULL WHERE parent_id IN (SELECT id FROM messages WHERE sender_id=? OR receiver_id=?)", (uid, uid))
    conn.execute("DELETE FROM messages WHERE sender_id=? OR receiver_id=?", (uid, uid))
    conn.execute("DELETE FROM story_views WHERE viewer_id=? OR story_id IN (SELECT id FROM stories WHERE user_id=?)", (uid, uid))
    conn.execute("DELETE FROM story_reactions WHERE user_id=? OR story_id IN (SELECT id FROM stories WHERE user_id=?)", (uid, uid))
    conn.execute("DELETE FROM stories WHERE user_id=?", (uid,))
    conn.execute("DELETE FROM reel_likes WHERE user_id=? OR reel_id IN (SELECT id FROM reels WHERE user_id=?)", (uid, uid))
    conn.execute("DELETE FROM reel_comments WHERE user_id=? OR reel_id IN (SELECT id FROM reels WHERE user_id=?)", (uid, uid))
    conn.execute("DELETE FROM reels WHERE user_id=?", (uid,))
    conn.execute("DELETE FROM blocks WHERE blocker_id=? OR blocked_id=?", (uid, uid))
    conn.execute("DELETE FROM reports WHERE reporter_id=?", (uid,))
    conn.execute("DELETE FROM reel_saves WHERE user_id=?", (uid,))
    conn.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
    conn.execute("DELETE FROM login_history WHERE user_id=?", (uid,))
    conn.execute("DELETE FROM password_resets WHERE user_id=?", (uid,))
    conn.execute("UPDATE security_events SET user_id=NULL, username=NULL WHERE user_id=?", (uid,))
    conn.execute("DELETE FROM group_messages WHERE sender_id=?", (uid,))
    conn.execute("DELETE FROM group_members WHERE user_id=?", (uid,))

    # S22 / Series 25 — missing tables (previously orphaned after user delete)
    conn.execute("DELETE FROM starred_messages WHERE user_id=?", (uid,))
    conn.execute("DELETE FROM chat_settings WHERE user_id=? OR other_user_id=?", (uid, uid))

    # Call sessions where user was caller or callee
    conn.execute("DELETE FROM call_sessions WHERE caller_id=? OR callee_id=?", (uid, uid))

    # Group chats created by this user (orphan prevention)
    # First: delete messages + members of those groups, then delete the groups
    conn.execute(
        "DELETE FROM group_messages WHERE group_id IN "
        "(SELECT id FROM group_chats WHERE created_by=?)", (uid,)
    )
    conn.execute(
        "DELETE FROM group_members WHERE group_id IN "
        "(SELECT id FROM group_chats WHERE created_by=?)", (uid,)
    )
    conn.execute("DELETE FROM group_chats WHERE created_by=?", (uid,))

    # Reports where user is the TARGET (not just reporter)
    conn.execute(
        "DELETE FROM reports WHERE target_type='user' AND target_id=?", (uid,)
    )
    conn.execute(
        "DELETE FROM reports WHERE target_type='post' AND target_id IN "
        "(SELECT id FROM posts WHERE user_id=?)", (uid,)
    )
    conn.execute(
        "DELETE FROM reports WHERE target_type='comment' AND target_id IN "
        "(SELECT id FROM comments WHERE user_id=?)", (uid,)
    )
    conn.execute(
        "DELETE FROM reports WHERE target_type='reel' AND target_id IN "
        "(SELECT id FROM reels WHERE user_id=?)", (uid,)
    )

    # Moderation log — anonymize admin_id (preserve audit trail but unlink PII)
    conn.execute(
        "UPDATE moderation_log SET admin_id=0, notes=notes || ' [user deleted]' "
        "WHERE admin_id=?", (uid,)
    )

    conn.execute("DELETE FROM posts WHERE user_id=?", (uid,))
    conn.execute("DELETE FROM users WHERE id=?", (uid,))
    conn.commit()
    conn.close()

    # S22 / Series 8B — delete orphan files from disk (outside DB lock)
    try:
        _delete_upload_many(files_to_delete)
        print(f"[Series 8B] user {uid} delete → {len(files_to_delete)} files removed")
    except Exception as e:
        print(f"[Series 8B] file cleanup failed for user {uid}: {e}")

    session.clear()
    return jsonify({"ok": True})


@app.route("/api/me/export-data")
@login_required
def export_data():
    uid = session["user_id"]
    conn = db()
    user = conn.execute("SELECT id, username, display_name, bio, created_at FROM users WHERE id=?", (uid,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404

    data = {
        "profile": dict(user),
        "exported_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "posts": [],
        "comments": [],
        "messages_sent": [],
        "stories": [],
        "follows": {"following": [], "followers": []},
    }

    for p in conn.execute("SELECT id, content, created_at FROM posts WHERE user_id=? ORDER BY created_at DESC", (uid,)).fetchall():
        pd = dict(p)
        pd["media_count"] = conn.execute("SELECT COUNT(*) AS c FROM post_media WHERE post_id=?", (p["id"],)).fetchone()["c"]
        data["posts"].append(pd)

    for c in conn.execute("SELECT content, post_id, created_at FROM comments WHERE user_id=? ORDER BY created_at DESC", (uid,)).fetchall():
        data["comments"].append(dict(c))

    for m in conn.execute("SELECT receiver_id, content, created_at FROM messages WHERE sender_id=? ORDER BY created_at DESC LIMIT 500", (uid,)).fetchall():
        data["messages_sent"].append(dict(m))

    for st in conn.execute("SELECT caption, created_at FROM stories WHERE user_id=? ORDER BY created_at DESC", (uid,)).fetchall():
        data["stories"].append(dict(st))

    data["follows"]["following"] = [r["username"] for r in conn.execute(
        "SELECT u.username FROM follows f JOIN users u ON u.id=f.following_id WHERE f.follower_id=?", (uid,)).fetchall()]
    data["follows"]["followers"] = [r["username"] for r in conn.execute(
        "SELECT u.username FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.following_id=?", (uid,)).fetchall()]

    conn.close()
    return jsonify(data)


# ============================================
# S14 — ADMIN API ENDPOINTS
# ============================================

@app.route("/api/debug/schema")
@admin_required
def debug_schema():
    """Show all tables and their columns."""
    conn = db()
    tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
    result = {}
    for t in tables:
        name = t["name"]
        cols = conn.execute(f"PRAGMA table_info({name})").fetchall()
        result[name] = [c["name"] for c in cols]
    conn.close()
    return jsonify(result)


@app.route("/api/debug/fix-schema")
@admin_required
def debug_fix_schema():
    """Auto-add any missing critical columns."""
    conn = db()
    fixes = []
    critical = [
        ("users", "last_seen", "TIMESTAMP"),
        ("users", "is_admin", "INTEGER DEFAULT 0"),
        ("users", "totp_secret", "TEXT"),
        ("users", "totp_enabled", "INTEGER DEFAULT 0"),
        ("users", "backup_codes", "TEXT DEFAULT ''"),
        ("users", "banned_until", "TIMESTAMP"),
        ("users", "ban_reason", "TEXT"),
        ("users", "email", "TEXT"),
        ("users", "email_verified", "INTEGER DEFAULT 0"),
        ("users", "google_id", "TEXT"),
        ("users", "is_private", "INTEGER DEFAULT 0"),
        ("users", "onboarded", "INTEGER DEFAULT 0"),
        ("users", "session_version", "INTEGER DEFAULT 0"),
        ("chat_settings", "theme", "TEXT DEFAULT 'default'"),
        ("chat_settings", "nickname", "TEXT DEFAULT ''"),
        ("chat_settings", "my_nickname", "TEXT DEFAULT ''"),
        ("chat_settings", "nickname_public", "INTEGER DEFAULT 0"),
        ("chat_settings", "wallpaper", "TEXT DEFAULT 'default'"),
        ("messages", "kind", "TEXT DEFAULT 'text'"),
        ("messages", "duration", "REAL"),
        ("messages", "edited_at", "TIMESTAMP"),
        ("messages", "deleted_at", "TIMESTAMP"),
        ("messages", "hidden_for", "TEXT DEFAULT ''"),
        ("call_sessions", "caller_last_seen", "TIMESTAMP"),
        ("call_sessions", "callee_last_seen", "TIMESTAMP"),
    ]
    for table, col, typ in critical:
        try:
            existing = [r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
            if col not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
                fixes.append(f"✅ Added {table}.{col}")
            else:
                fixes.append(f"⏭️ {table}.{col} exists")
        except Exception as e:
            fixes.append(f"❌ {table}.{col}: {str(e)[:80]}")
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "total": len(fixes), "details": fixes})


@app.route("/api/admin/stats")
@admin_required
def admin_stats():
    """S30.22 — single query with subselects (was: 6 round-trips)."""
    conn = db()
    row = conn.execute("""
        SELECT
          (SELECT COUNT(*) FROM reports WHERE status='pending') AS pending_reports,
          (SELECT COUNT(*) FROM reports) AS total_reports,
          (SELECT COUNT(*) FROM users) AS total_users,
          (SELECT COUNT(*) FROM users
             WHERE banned_until IS NOT NULL
               AND datetime('now') < datetime(banned_until)) AS banned_users,
          (SELECT COUNT(*) FROM posts) AS total_posts,
          (SELECT COUNT(*) FROM moderation_log
             WHERE date(created_at) = date('now')) AS actioned_today
    """).fetchone()
    conn.close()
    return jsonify(dict(row))


@app.route("/api/admin/reports")
@admin_required
def admin_reports():
    status = (request.args.get("status") or "all").strip()
    limit = min(int(request.args.get("limit") or 100), 500)

    conn = db()
    q = """SELECT r.id, r.target_type, r.target_id, r.reason, r.notes,
                  r.status, r.created_at,
                  u.id AS reporter_id, u.username AS reporter_username,
                  u.display_name AS reporter_name, u.profile_pic AS reporter_pic
           FROM reports r JOIN users u ON u.id = r.reporter_id"""
    args = []
    if status != "all":
        q += " WHERE r.status=?"
        args.append(status)
    q += " ORDER BY r.created_at DESC LIMIT ?"
    args.append(limit)

    rows = conn.execute(q, args).fetchall()
    reports = []

    for r in rows:
        rd = dict(r)
        # Fetch target details
        if r["target_type"] == "post":
            t = conn.execute("""SELECT p.id, p.content, p.created_at,
                                       u.id AS author_id, u.username, u.display_name,
                                       u.profile_pic, COALESCE(u.is_admin,0) AS author_admin
                                FROM posts p JOIN users u ON u.id = p.user_id
                                WHERE p.id=?""", (r["target_id"],)).fetchone()
            if t:
                rd["target"] = dict(t)
                rd["target"]["media"] = [m["media"] for m in conn.execute(
                    "SELECT media FROM post_media WHERE post_id=? ORDER BY position ASC",
                    (r["target_id"],)).fetchall()]
        elif r["target_type"] == "user":
            t = conn.execute("""SELECT id, username, display_name, profile_pic,
                                       COALESCE(is_admin,0) AS is_admin,
                                       banned_until, ban_reason
                                FROM users WHERE id=?""", (r["target_id"],)).fetchone()
            if t:
                rd["target"] = dict(t)
        elif r["target_type"] == "comment":
            t = conn.execute("""SELECT c.id, c.content, c.created_at, c.post_id,
                                       u.id AS author_id, u.username, u.display_name,
                                       u.profile_pic
                                FROM comments c JOIN users u ON u.id = c.user_id
                                WHERE c.id=?""", (r["target_id"],)).fetchone()
            if t:
                rd["target"] = dict(t)
        elif r["target_type"] == "reel":
            t = conn.execute("""SELECT r.id, r.caption, r.created_at, r.video,
                                       u.id AS author_id, u.username, u.display_name,
                                       u.profile_pic
                                FROM reels r JOIN users u ON u.id = r.user_id
                                WHERE r.id=?""", (r["target_id"],)).fetchone()
            if t:
                rd["target"] = dict(t)
        reports.append(rd)

    conn.close()
    return jsonify(reports)


@app.route("/api/admin/reports/<int:rid>/action", methods=["POST"])
@admin_required
def admin_report_action(rid):
    """Perform action on a report:
    action = 'delete' | 'ban' | 'dismiss' | 'reopen'
    ban_days = optional (for ban)
    ban_reason = optional
    """
    d = request.json or {}
    action = (d.get("action") or "").strip()
    admin_uid = session["user_id"]

    if action not in ("delete", "ban", "dismiss", "reopen"):
        return jsonify({"error": "ভুল action"}), 400

    conn = db()
    rep = conn.execute("""SELECT id, reporter_id, target_type, target_id, reason, status
                          FROM reports WHERE id=?""", (rid,)).fetchone()
    if not rep:
        conn.close()
        return jsonify({"error": "রিপোর্ট পাওয়া যায়নি"}), 404

    target_type = rep["target_type"]
    target_id = rep["target_id"]
    reporter_id = rep["reporter_id"]
    reason = rep["reason"]

    # Find target's author id (for ban)
    target_author_id = None
    if target_type == "post":
        t = conn.execute("SELECT user_id FROM posts WHERE id=?", (target_id,)).fetchone()
        if t: target_author_id = t["user_id"]
    elif target_type == "user":
        target_author_id = target_id
    elif target_type == "comment":
        t = conn.execute("SELECT user_id FROM comments WHERE id=?", (target_id,)).fetchone()
        if t: target_author_id = t["user_id"]
    elif target_type == "reel":
        t = conn.execute("SELECT user_id FROM reels WHERE id=?", (target_id,)).fetchone()
        if t: target_author_id = t["user_id"]

    if action == "delete":
        # S22 / Series 8 Bonus — collect file paths BEFORE DB deletes
        _files_to_delete = []
        if target_type == "post":
            for _r in conn.execute(
                "SELECT media FROM post_media WHERE post_id=?", (target_id,)
            ).fetchall():
                if _r["media"]:
                    _files_to_delete.append(_r["media"])
        elif target_type == "reel":
            _r = conn.execute(
                "SELECT video FROM reels WHERE id=?", (target_id,)
            ).fetchone()
            if _r and _r["video"]:
                _files_to_delete.append(_r["video"])
        elif target_type == "comment":
            pass  # comments have no file attachments

        if target_type == "post":
            conn.execute("DELETE FROM reactions WHERE post_id=?", (target_id,))
            conn.execute("DELETE FROM comments WHERE post_id=?", (target_id,))
            conn.execute("DELETE FROM saves WHERE post_id=?", (target_id,))
            conn.execute("DELETE FROM reposts WHERE post_id=?", (target_id,))
            conn.execute("DELETE FROM post_media WHERE post_id=?", (target_id,))
            conn.execute("DELETE FROM notifications WHERE post_id=?", (target_id,))
            conn.execute("DELETE FROM posts WHERE id=?", (target_id,))
        elif target_type == "comment":
            conn.execute("DELETE FROM comments WHERE id=? OR parent_id=?", (target_id, target_id))
        elif target_type == "reel":
            conn.execute("DELETE FROM reel_likes WHERE reel_id=?", (target_id,))
            conn.execute("DELETE FROM reel_comments WHERE reel_id=?", (target_id,))
            conn.execute("DELETE FROM reels WHERE id=?", (target_id,))

        conn.execute("UPDATE reports SET status='actioned' WHERE id=?", (rid,))
        conn.execute("""INSERT INTO moderation_log (admin_id, action, target_type, target_id, notes)
                        VALUES (?,?,?,?,?)""",
                     (admin_uid, "delete", target_type, target_id, f"Report #{rid}: {reason}"))

        if reporter_id and reporter_id != admin_uid:
            conn.execute("""INSERT INTO notifications (user_id, actor_id, type, post_id)
                            VALUES (?,?,?,?)""",
                         (reporter_id, admin_uid, "mod_action",
                          target_id if target_type == "post" else None))

    elif action == "ban":
        if not target_author_id:
            conn.close()
            return jsonify({"error": "Target এর মালিক পাওয়া যায়নি"}), 400
        if _is_admin(target_author_id):
            conn.close()
            return jsonify({"error": "Admin কে ban করা যাবে না"}), 400
        ban_days = d.get("ban_days")
        ban_reason = (d.get("ban_reason") or reason or "নীতিমালা লঙ্ঘন").strip()[:200]

        if ban_days is None or ban_days == 0 or ban_days == "forever":
            until_expr = "datetime('now', '+100 years')"
            note = f"Report #{rid}: forever — {ban_reason}"
        else:
            try:
                ban_days = int(ban_days)
                if ban_days < 1 or ban_days > 3650:
                    raise ValueError
            except (ValueError, TypeError):
                conn.close()
                return jsonify({"error": "ভুল ban_days"}), 400
            until_expr = f"datetime('now', '+{ban_days} days')"
            note = f"Report #{rid}: {ban_days} days — {ban_reason}"

        # S30.21 — instant ban via report action too
        conn.execute(
            f"""UPDATE users SET banned_until={until_expr}, ban_reason=?,
                        session_version = COALESCE(session_version, 0) + 1
                WHERE id=?""",
            (ban_reason, target_author_id)
        )
        conn.execute("DELETE FROM sessions WHERE user_id=?", (target_author_id,))
        try:
            with _pending_2fa_lock:
                for _k in list(_pending_2fa.keys()):
                    if _pending_2fa[_k].get("uid") == target_author_id:
                        del _pending_2fa[_k]
        except Exception:
            pass
        conn.execute("UPDATE reports SET status='actioned' WHERE id=?", (rid,))
        conn.execute("""INSERT INTO moderation_log (admin_id, action, target_type, target_id, notes)
                        VALUES (?,?,?,?,?)""",
                     (admin_uid, "ban", "user", target_author_id, note))

        if reporter_id and reporter_id != admin_uid:
            conn.execute("""INSERT INTO notifications (user_id, actor_id, type)
                            VALUES (?,?,?)""", (reporter_id, admin_uid, "mod_action"))

    elif action == "dismiss":
        conn.execute("UPDATE reports SET status='dismissed' WHERE id=?", (rid,))
        conn.execute("""INSERT INTO moderation_log (admin_id, action, target_type, target_id, notes)
                        VALUES (?,?,?,?,?)""",
                     (admin_uid, "dismiss", target_type, target_id, f"Report #{rid} dismissed"))

    elif action == "reopen":
        conn.execute("UPDATE reports SET status='pending' WHERE id=?", (rid,))

    conn.commit()
    conn.close()

    # S22 / Series 8 Bonus — delete orphan files from disk (outside DB lock)
    try:
        if action == "delete" and _files_to_delete:
            _delete_upload_many(_files_to_delete)
            print(f"[Series 8B-Bonus] report #{rid} delete → "
                  f"{len(_files_to_delete)} files removed")
    except Exception as _e:
        print(f"[Series 8B-Bonus] file cleanup failed for report #{rid}: {_e}")

    return jsonify({"ok": True, "action": action})


@app.route("/api/admin/users")
@admin_required
def admin_users():
    q = (request.args.get("q") or "").strip().lower()
    conn = db()
    if q:
        rows = conn.execute("""SELECT id, username, display_name, profile_pic,
                                      COALESCE(is_admin,0) AS is_admin,
                                      banned_until, ban_reason,
                                      COALESCE(google_id IS NOT NULL,0) AS google_linked,
                                      email, created_at
                               FROM users
                               WHERE LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?
                               ORDER BY id DESC LIMIT 100""",
                            ("%"+q+"%", "%"+q+"%")).fetchall()
    else:
        rows = conn.execute("""SELECT id, username, display_name, profile_pic,
                                      COALESCE(is_admin,0) AS is_admin,
                                      banned_until, ban_reason,
                                      COALESCE(google_id IS NOT NULL,0) AS google_linked,
                                      email, created_at
                               FROM users
                               ORDER BY id DESC LIMIT 100""").fetchall()

    # Get reports count per user (for convenience)
    users = []
    for r in rows:
        ud = dict(r)
        ud["pending_reports"] = conn.execute("""SELECT COUNT(*) AS c FROM reports r
            WHERE r.status='pending' AND (
              (r.target_type='user' AND r.target_id=?)
              OR (r.target_type='post' AND r.target_id IN (SELECT id FROM posts WHERE user_id=?))
              OR (r.target_type='comment' AND r.target_id IN (SELECT id FROM comments WHERE user_id=?))
            )""", (r["id"], r["id"], r["id"])).fetchone()["c"]
        # S22 / Series 9B — reuse existing conn (was: N+1 connections)
        ud["is_banned"] = False
        if r["banned_until"]:
            try:
                still = conn.execute("SELECT datetime('now') < datetime(?) AS s",
                                     (r["banned_until"],)).fetchone()["s"]
                ud["is_banned"] = bool(still)
            except Exception:
                pass
        users.append(ud)

    conn.close()
    return jsonify(users)


@app.route("/api/admin/users/<int:uid>/ban", methods=["POST"])
@admin_required
def admin_ban_user(uid):
    if uid == session["user_id"]:
        return jsonify({"error": "নিজেকে ban করা যাবে না"}), 400
    if _is_admin(uid):
        return jsonify({"error": "Admin কে ban করা যাবে না"}), 400
    d = request.json or {}
    ban_days = d.get("ban_days")
    ban_reason = (d.get("ban_reason") or "নীতিমালা লঙ্ঘন").strip()[:200]

    if ban_days is None or ban_days in (0, "forever"):
        until_expr = "datetime('now', '+100 years')"
        note = f"forever — {ban_reason}"
    else:
        try:
            ban_days = int(ban_days)
            if ban_days < 1 or ban_days > 3650:
                raise ValueError
        except (ValueError, TypeError):
            return jsonify({"error": "ভুল ban_days"}), 400
        until_expr = f"datetime('now', '+{ban_days} days')"
        note = f"{ban_days} days — {ban_reason}"

    conn = db()
    row = conn.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404

    # S30.21 — instant ban: bump version + delete ALL sessions
    conn.execute(
        f"""UPDATE users SET banned_until={until_expr}, ban_reason=?,
                    session_version = COALESCE(session_version, 0) + 1
            WHERE id=?""",
        (ban_reason, uid)
    )
    # Kill every active session immediately (was: cookie could still work for ~120s)
    deleted = conn.execute(
        "DELETE FROM sessions WHERE user_id=?", (uid,)
    ).rowcount
    # Also clear their pending 2FA tokens (in-memory)
    try:
        with _pending_2fa_lock:
            for _k in list(_pending_2fa.keys()):
                if _pending_2fa[_k].get("uid") == uid:
                    del _pending_2fa[_k]
    except Exception:
        pass
    conn.execute("""INSERT INTO moderation_log (admin_id, action, target_type, target_id, notes)
                    VALUES (?,?,?,?,?)""",
                 (session["user_id"], "ban", "user", uid, note + f" [sessions_killed={deleted}]"))
    conn.commit()
    conn.close()
    # S16.6 — audit event
    _log_security_event(
        "admin_ban", uid=session["user_id"],
        metadata={"target_uid": uid, "until": note,
                  "sessions_revoked": deleted}
    )
    return jsonify({"ok": True, "sessions_revoked": deleted})


@app.route("/api/admin/users/<int:uid>/unban", methods=["POST"])
@admin_required
def admin_unban_user(uid):
    conn = db()
    row = conn.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404

    conn.execute("UPDATE users SET banned_until=NULL, ban_reason=NULL WHERE id=?", (uid,))
    conn.execute("""INSERT INTO moderation_log (admin_id, action, target_type, target_id, notes)
                    VALUES (?,?,?,?,?)""",
                 (session["user_id"], "unban", "user", uid, "unbanned"))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/admin/log")
@admin_required
def admin_log():
    limit = min(int(request.args.get("limit") or 200), 1000)
    conn = db()
    rows = conn.execute("""SELECT m.id, m.action, m.target_type, m.target_id,
                                  m.notes, m.created_at,
                                  u.id AS admin_id, u.username AS admin_username,
                                  u.display_name AS admin_name, u.profile_pic AS admin_pic
                           FROM moderation_log m JOIN users u ON u.id = m.admin_id
                           ORDER BY m.created_at DESC LIMIT ?""", (limit,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/admin/security-events")
@admin_required
def admin_security_events():
    """S16.6 — recent security events (audit trail)."""
    limit = min(int(request.args.get("limit") or 100), 500)
    event_filter = (request.args.get("event") or "").strip()
    conn = db()
    if event_filter:
        rows = conn.execute("""
            SELECT id, user_id, username, event, ip, user_agent, metadata, created_at
            FROM security_events
            WHERE event=?
            ORDER BY created_at DESC LIMIT ?
        """, (event_filter, limit)).fetchall()
    else:
        rows = conn.execute("""
            SELECT id, user_id, username, event, ip, user_agent, metadata, created_at
            FROM security_events
            ORDER BY created_at DESC LIMIT ?
        """, (limit,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/admin/check")
@login_required
def admin_check():
    """Returns whether current user is admin + 2FA status (TOTP or email)."""
    uid = session["user_id"]
    is_adm = _is_admin(uid)
    totp_on = False
    email2fa_on = False
    if is_adm:
        conn = db()
        row = conn.execute(
            "SELECT COALESCE(totp_enabled, 0) AS totp, "
            "COALESCE(email_2fa_enabled, 0) AS email2fa "
            "FROM users WHERE id=?",
            (uid,)
        ).fetchone()
        conn.close()
        if row:
            totp_on = bool(row["totp"])
            email2fa_on = bool(row["email2fa"])
    has_2fa = totp_on or email2fa_on
    return jsonify({
        "is_admin": is_adm,
        "has_2fa": has_2fa,
        "has_totp": totp_on,
        "has_email_2fa": email2fa_on,
        "needs_2fa_setup": bool(is_adm and ADMIN_2FA_ENFORCED and not has_2fa),
    })


# ============================================
# EXPLORE
# ============================================

@app.route("/api/explore/trending")
@login_required
def trending_hashtags():
    # S30.17 — cache + smaller scan window + truncated content
    # (was: full 500 rows scanned on every call; no cache)
    import time as _t
    now = _t.time()
    _cache = getattr(trending_hashtags, "_cache", None)
    if _cache and (now - _cache["at"]) < 60:
        return jsonify(_cache["data"])

    conn = db()
    # Cap content to 800 chars (hashtags typically near start; cuts memory)
    rows = conn.execute("""
        SELECT substr(content, 1, 800) AS content
        FROM posts
        WHERE datetime(created_at) > datetime('now', '-7 days')
        ORDER BY created_at DESC
        LIMIT 500
    """).fetchall()
    conn.close()

    counts = {}
    for row in rows:
        c = row["content"] or ""
        for t in extract_hashtags(c):
            counts[t] = counts.get(t, 0) + 1

    result = [
        {"tag": t, "count": c}
        for t, c in sorted(counts.items(), key=lambda x: x[1], reverse=True)[:20]
    ]
    trending_hashtags._cache = {"at": now, "data": result}
    return jsonify(result)


@app.route("/api/explore/top-posts")
@login_required
def explore_top_posts():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT p.id, p.user_id, p.content, p.created_at,
               u.username, u.display_name, u.profile_pic
        FROM posts p JOIN users u ON u.id = p.user_id
        WHERE datetime(p.created_at) > datetime('now', '-7 days')
          AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
          AND (COALESCE(u.is_private, 0) = 0
               OR u.id = ?
               OR u.id IN (SELECT following_id FROM follows WHERE follower_id = ?))
        ORDER BY p.created_at DESC LIMIT 60
    """, (uid, uid, uid, uid)).fetchall()

    # S30.26 — batch like/comment counts
    pids = [r["id"] for r in rows]
    like_count = {}
    comment_count = {}
    my_reactions = {}
    if pids:
        ph = ",".join("?" * len(pids))
        for rr in conn.execute(
            f"SELECT post_id, COUNT(*) AS c FROM reactions WHERE post_id IN ({ph}) GROUP BY post_id",
            pids
        ).fetchall():
            like_count[rr["post_id"]] = rr["c"]
        for rr in conn.execute(
            f"SELECT post_id, COUNT(*) AS c FROM comments WHERE post_id IN ({ph}) GROUP BY post_id",
            pids
        ).fetchall():
            comment_count[rr["post_id"]] = rr["c"]
        for rr in conn.execute(
            f"SELECT post_id, reaction FROM reactions WHERE user_id=? AND post_id IN ({ph})",
            [uid] + pids
        ).fetchall():
            my_reactions[rr["post_id"]] = rr["reaction"]

    out = []
    for r in rows:
        d = dict(r)
        d["likes"] = like_count.get(r["id"], 0)
        d["comments"] = comment_count.get(r["id"], 0)
        d["my_reaction"] = my_reactions.get(r["id"])
        out.append(d)

    # sort by likes DESC (was done in SQL; now in Python after batch)
    out.sort(key=lambda x: (x["likes"], x["created_at"]), reverse=True)
    out = out[:30]
    conn.close()
    return jsonify(out)


@app.route("/api/explore/suggested-users")
@login_required
def explore_suggested_users():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT u.id, u.username, u.display_name, u.profile_pic,
               (SELECT COUNT(*) FROM follows WHERE following_id=u.id) AS followers,
               (SELECT COUNT(*) FROM posts WHERE user_id=u.id) AS posts_count
        FROM users u WHERE u.id != ?
          AND LOWER(u.username) != ?
          AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id=?)
          AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
        ORDER BY followers DESC LIMIT 12
    """, (uid, ADMIN_USERNAME, uid, uid, uid)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/hashtag/<tag>")
@login_required
def hashtag_feed(tag):
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT p.id, p.user_id, p.content, p.created_at,
               u.username, u.display_name, u.profile_pic
        FROM posts p JOIN users u ON u.id = p.user_id
        WHERE LOWER(p.content) LIKE ?
          AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
          AND (COALESCE(u.is_private, 0) = 0
               OR u.id = ?
               OR u.id IN (SELECT following_id FROM follows WHERE follower_id = ?))
        ORDER BY p.created_at DESC LIMIT 100
    """, ("%#" + tag.lower() + "%", uid, uid, uid, uid)).fetchall()

    pids = [r["id"] for r in rows]
    like_count = {}
    comment_count = {}
    my_reactions = {}
    if pids:
        ph = ",".join("?" * len(pids))
        for rr in conn.execute(
            f"SELECT post_id, COUNT(*) AS c FROM reactions WHERE post_id IN ({ph}) GROUP BY post_id",
            pids
        ).fetchall():
            like_count[rr["post_id"]] = rr["c"]
        for rr in conn.execute(
            f"SELECT post_id, COUNT(*) AS c FROM comments WHERE post_id IN ({ph}) GROUP BY post_id",
            pids
        ).fetchall():
            comment_count[rr["post_id"]] = rr["c"]
        for rr in conn.execute(
            f"SELECT post_id, reaction FROM reactions WHERE user_id=? AND post_id IN ({ph})",
            [uid] + pids
        ).fetchall():
            my_reactions[rr["post_id"]] = rr["reaction"]

    out = []
    for r in rows:
        d = dict(r)
        d["likes"] = like_count.get(r["id"], 0)
        d["comments"] = comment_count.get(r["id"], 0)
        d["my_reaction"] = my_reactions.get(r["id"])
        out.append(d)

    conn.close()
    return jsonify({"tag": tag, "count": len(out), "posts": out})


# ============================================
# SERIES 4A — VOICE/VIDEO CALLS
# ============================================

import secrets as _secrets

_CALL_STALE_SECONDS = 45   # ringing auto-expires
_CALL_ENDED_KEEP = 24      # hours to keep in log


import base64 as _b64sdp


def _sdp_encode(v):
    """Base64-encode SDP to preserve bytes through SQLite."""
    if not v:
        return v
    try:
        return _b64sdp.b64encode(v.encode("utf-8")).decode("ascii")
    except Exception:
        return v


def _sdp_decode(v):
    """Decode base64 SDP; fallback to raw for legacy rows."""
    if not v:
        return v
    if v[:2] in ("v=", "o=", "s="):
        return v
    try:
        return _b64sdp.b64decode(v).decode("utf-8")
    except Exception:
        return v


def _call_public(row):
    """Serialize a call row for the client."""
    if not row:
        return None
    return {
        "id": row["id"],
        "caller_id": row["caller_id"],
        "callee_id": row["callee_id"],
        "kind": row["kind"],
        "status": row["status"],
        "offer": _sdp_decode(row["offer"]),
        "answer": _sdp_decode(row["answer"]),
        "caller_ice": row["caller_ice"],
        "callee_ice": row["callee_ice"],
        "created_at": row["created_at"],
        "answered_at": row["answered_at"],
        "ended_at": row["ended_at"],
        "ended_by": row["ended_by"],
        "end_reason": row["end_reason"],
        "caller_last_seen": row["caller_last_seen"] if "caller_last_seen" in row.keys() else None,
        "callee_last_seen": row["callee_last_seen"] if "callee_last_seen" in row.keys() else None,
    }


@app.route("/api/calls/start", methods=["POST"])
@login_required
@rate_limit("call_start", 30, 3600)
def call_start():
    uid = session["user_id"]
    d = request.json or {}
    username = (d.get("username") or "").strip().lower()
    kind = (d.get("kind") or "audio").strip().lower()
    if kind not in ("audio", "video"):
        kind = "audio"
    if not username:
        return jsonify({"error": "\u0987\u0989\u099c\u09be\u09b0\u09a8\u09c7\u09ae \u09a6\u09bf\u09a8"}), 400

    conn = db()
    other = conn.execute("SELECT id, username, display_name, profile_pic FROM users WHERE username=?",
                         (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "\u0987\u0989\u099c\u09be\u09b0 \u09aa\u09be\u0993\u09af\u09bc\u09be \u09af\u09be\u09af\u09bc\u09a8\u09bf"}), 404
    other_id = other["id"]
    if other_id == uid:
        conn.close()
        return jsonify({"error": "\u09a8\u09bf\u099c\u09c7\u0995\u09c7 \u0995\u09b2 \u0995\u09b0\u09be \u09af\u09be\u09ac\u09c7 \u09a8\u09be"}), 400

    blk = conn.execute("""SELECT 1 FROM blocks
        WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)
        LIMIT 1""", (uid, other_id, other_id, uid)).fetchone()
    if blk:
        conn.close()
        return jsonify({"error": "\u09ac\u09cd\u09b2\u0995\u09a1 \u0987\u0989\u099c\u09be\u09b0"}), 403

    # Kill any prior ringing call from me to same person
    conn.execute("""UPDATE call_sessions SET status='missed', ended_at=CURRENT_TIMESTAMP, end_reason='replaced'
                    WHERE caller_id=? AND callee_id=? AND status IN ('ringing','active')""",
                 (uid, other_id))

    call_id = _secrets.token_urlsafe(16)
    conn.execute("""INSERT INTO call_sessions (id, caller_id, callee_id, kind, status)
                    VALUES (?,?,?,?, 'ringing')""",
                 (call_id, uid, other_id, kind))
    conn.commit()

    # Look up the caller's profile to send back
    me = conn.execute("SELECT id, username, display_name, profile_pic FROM users WHERE id=?",
                      (uid,)).fetchone()
    conn.close()

    return jsonify({
        "ok": True,
        "call_id": call_id,
        "callee": dict(other),
        "me": dict(me),
        "kind": kind,
    })


@app.route("/api/calls/poll")
@login_required
def call_poll():
    """Client polls this every 2s while idle in the app."""
    uid = session["user_id"]
    conn = db()

    # Auto-expire stale ringing calls (older than 45s)
    conn.execute("""UPDATE call_sessions
                    SET status='missed', ended_at=CURRENT_TIMESTAMP, end_reason='timeout'
                    WHERE status='ringing'
                      AND (strftime('%s','now') - strftime('%s', created_at)) > ?""",
                 (_CALL_STALE_SECONDS,))

    # Look for an incoming ringing call for me
    incoming = conn.execute("""SELECT * FROM call_sessions
                               WHERE callee_id=? AND status='ringing'
                               ORDER BY created_at DESC LIMIT 1""",
                            (uid,)).fetchone()

    # Look for a call where I'm the caller and status changed (accepted/declined/ended)
    outgoing = conn.execute("""SELECT * FROM call_sessions
                               WHERE caller_id=? AND status IN ('active','declined','ended','missed')
                               ORDER BY created_at DESC LIMIT 1""",
                            (uid,)).fetchone()

    # Find a still-active call I'm in
    active = conn.execute("""SELECT * FROM call_sessions
                             WHERE (caller_id=? OR callee_id=?) AND status='active'
                             ORDER BY created_at DESC LIMIT 1""",
                          (uid, uid)).fetchone()

    conn.commit()

    # Include caller info if there's an incoming call
    caller_info = None
    if incoming:
        caller_info = conn.execute("SELECT id, username, display_name, profile_pic FROM users WHERE id=?",
                                   (incoming["caller_id"],)).fetchone()

    conn.close()

    return jsonify({
        "incoming": _call_public(incoming) if incoming else None,
        "incoming_caller": dict(caller_info) if caller_info else None,
        "outgoing": _call_public(outgoing) if outgoing else None,
        "active": _call_public(active) if active else None,
    })


_CALL_HEARTBEAT_TIMEOUT = 90  # seconds of silence → treat as dead


def _call_heartbeat(call_id, uid):
    """Update my heartbeat. End the call if either side went silent."""
    conn = db()
    try:
        row = conn.execute(
            "SELECT caller_id, callee_id, status FROM call_sessions WHERE id=?",
            (call_id,)
        ).fetchone()
        if not row or row["status"] != "active":
            return
        if uid == row["caller_id"]:
            conn.execute(
                "UPDATE call_sessions SET caller_last_seen=CURRENT_TIMESTAMP WHERE id=?",
                (call_id,)
            )
        elif uid == row["callee_id"]:
            conn.execute(
                "UPDATE call_sessions SET callee_last_seen=CURRENT_TIMESTAMP WHERE id=?",
                (call_id,)
            )
        check = conn.execute("""
            SELECT
              (strftime('%s','now') - strftime('%s', caller_last_seen)) AS caller_age,
              (strftime('%s','now') - strftime('%s', callee_last_seen)) AS callee_age
            FROM call_sessions WHERE id=?
        """, (call_id,)).fetchone()
        if check:
            ca = check["caller_age"]
            ka = check["callee_age"]
            if (ca is not None and ca > _CALL_HEARTBEAT_TIMEOUT) and \
               (ka is not None and ka > _CALL_HEARTBEAT_TIMEOUT):
                print(f"[HEARTBEAT] TIMEOUT → ending call {call_id[:8]}")
                conn.execute("""UPDATE call_sessions SET status='ended',
                                ended_at=CURRENT_TIMESTAMP, end_reason='heartbeat_timeout'
                                WHERE id=?""", (call_id,))
                print(f"[CALL] heartbeat timeout ended call {call_id[:8]}")
        conn.commit()
    except Exception as e:
        print(f"[CALL] heartbeat error: {e}")
    finally:
        conn.close()


@app.route("/api/calls/<call_id>")
@login_required
def call_get(call_id):
    uid = session["user_id"]
    conn = db()
    row = conn.execute("SELECT * FROM call_sessions WHERE id=?", (call_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "\u0995\u09b2 \u09aa\u09be\u0993\u09af\u09bc\u09be \u09af\u09be\u09af\u09bc\u09a8\u09bf"}), 404
    if uid not in (row["caller_id"], row["callee_id"]):
        conn.close()
        return jsonify({"error": "\u0985\u09a8\u09c1\u09ae\u09a4\u09bf \u09a8\u09c7\u0987"}), 403
    conn.close()
    # heartbeat before returning
    _call_heartbeat(call_id, uid)
    # re-read (may have been ended)
    conn = db()
    row2 = conn.execute("SELECT * FROM call_sessions WHERE id=?", (call_id,)).fetchone()
    conn.close()
    return jsonify(_call_public(row2))


@app.route("/api/calls/<call_id>/offer", methods=["POST"])
@login_required
def call_offer(call_id):
    """Caller submits SDP offer."""
    uid = session["user_id"]
    d = request.json or {}
    offer = d.get("offer") or ""
    if not offer:
        return jsonify({"error": "offer required"}), 400
    conn = db()
    row = conn.execute("SELECT caller_id, status FROM call_sessions WHERE id=?", (call_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not found"}), 404
    if row["caller_id"] != uid:
        conn.close()
        return jsonify({"error": "only caller"}), 403
    conn.execute("UPDATE call_sessions SET offer=? WHERE id=?", (_sdp_encode(offer), call_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/calls/<call_id>/answer", methods=["POST"])
@login_required
def call_answer(call_id):
    """Callee submits SDP answer OR declines/accepts."""
    uid = session["user_id"]
    d = request.json or {}
    action = (d.get("action") or "accept").strip().lower()
    conn = db()
    row = conn.execute("SELECT * FROM call_sessions WHERE id=?", (call_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not found"}), 404
    if row["callee_id"] != uid:
        conn.close()
        return jsonify({"error": "only callee"}), 403

    # S22 / Series 23 — only allow answer when call is still ringing.
    # Prevents re-accepting an ended/declined/missed call (call revival).
    if action in ("accept", "decline") and row["status"] != "ringing":
        conn.close()
        return jsonify({
            "error": "call is no longer ringing",
            "status": row["status"],
        }), 409

    if action == "decline":
        conn.execute("""UPDATE call_sessions SET status='declined',
                        ended_at=CURRENT_TIMESTAMP, ended_by=?, end_reason='declined'
                        WHERE id=?""", (uid, call_id))
        conn.commit()
        conn.close()
        return jsonify({"ok": True, "status": "declined"})

    if action == "accept":
        answer = d.get("answer") or ""
        if not answer:
            # Just accepting — mark active, SDP answer comes later
            conn.execute("""UPDATE call_sessions SET status='active',
                            answered_at=CURRENT_TIMESTAMP WHERE id=?""", (call_id,))
        else:
            conn.execute("""UPDATE call_sessions SET status='active',
                            answered_at=CURRENT_TIMESTAMP, answer=?,
                            caller_last_seen=CURRENT_TIMESTAMP,
                            callee_last_seen=CURRENT_TIMESTAMP
                            WHERE id=?""",
                         (_sdp_encode(answer), call_id))
        conn.commit()
        conn.close()
        return jsonify({"ok": True, "status": "active"})

    conn.close()
    return jsonify({"error": "bad action"}), 400


@app.route("/api/calls/<call_id>/answer-sdp", methods=["POST"])
@login_required
def call_answer_sdp(call_id):
    """Callee submits SDP answer after already accepting."""
    uid = session["user_id"]
    d = request.json or {}
    answer = d.get("answer") or ""
    if not answer:
        return jsonify({"error": "answer required"}), 400
    conn = db()
    row = conn.execute(
        "SELECT callee_id, status FROM call_sessions WHERE id=?",
        (call_id,)
    ).fetchone()
    if not row or row["callee_id"] != uid:
        conn.close()
        return jsonify({"error": "forbidden"}), 403
    # S22 / Series 23 — SDP only accepted while call is active
    if row["status"] != "active":
        conn.close()
        return jsonify({"error": "call is not active", "status": row["status"]}), 409
    conn.execute("UPDATE call_sessions SET answer=? WHERE id=?", (_sdp_encode(answer), call_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/calls/<call_id>/ice", methods=["POST"])
@login_required
def call_ice(call_id):
    """Submit an ICE candidate. Appends to my side's list (JSON-encoded).

    S22 / Series 24 — added:
      - BEGIN IMMEDIATE transaction to prevent race between concurrent appends
      - Per-candidate size cap (4 KB)
      - Per-side count cap (100)
      - Per-side total size cap (100 KB)
    """
    uid = session["user_id"]
    d = request.json or {}
    cand = d.get("candidate")
    if not cand:
        return jsonify({"error": "candidate required"}), 400

    # S22 / Series 24 — validate candidate is a dict-like, not a huge blob
    import json as _json
    try:
        cand_str = _json.dumps(cand)
    except (TypeError, ValueError):
        return jsonify({"error": "invalid candidate"}), 400
    if len(cand_str) > 4096:
        return jsonify({"error": "candidate too large"}), 400

    conn = db()
    # S29.8 - manual transaction control.
    # Python's sqlite3 default isolation_level="" causes an implicit
    # BEGIN to be issued before any DML, which collides with our
    # explicit BEGIN IMMEDIATE below and raises:
    #   sqlite3.OperationalError: cannot start a transaction within a transaction
    # Setting isolation_level=None disables the implicit BEGIN so our
    # explicit BEGIN IMMEDIATE / COMMIT / ROLLBACK take full control.
    conn.isolation_level = None
    try:
        # S22 / Series 24 — serialized read-modify-write (prevents lost updates)
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT caller_id, callee_id, caller_ice, callee_ice, status "
            "FROM call_sessions WHERE id=?",
            (call_id,)
        ).fetchone()
        if not row:
            conn.rollback()
            conn.close()
            return jsonify({"error": "not found"}), 404

        # S22 / Series 24 — don't accept ICE on ended calls
        if row["status"] not in ("ringing", "active"):
            conn.rollback()
            conn.close()
            return jsonify({"error": "call not active", "status": row["status"]}), 409

        if uid == row["caller_id"]:
            col = "caller_ice"
            cur = row["caller_ice"] or ""
        elif uid == row["callee_id"]:
            col = "callee_ice"
            cur = row["callee_ice"] or ""
        else:
            conn.rollback()
            conn.close()
            return jsonify({"error": "forbidden"}), 403

        try:
            arr = _json.loads(cur) if cur else []
            if not isinstance(arr, list):
                arr = []
        except Exception:
            arr = []

        # S22 / Series 24 — hard caps
        if len(arr) >= 100:
            conn.rollback()
            conn.close()
            return jsonify({"error": "too many candidates"}), 429

        arr.append(cand)
        new_json = _json.dumps(arr)

        if len(new_json) > 102400:  # 100 KB total per side
            conn.rollback()
            conn.close()
            return jsonify({"error": "candidate list too large"}), 413

        conn.execute(
            f"UPDATE call_sessions SET {col}=? WHERE id=?",
            (new_json, call_id)
        )
        conn.commit()
        return jsonify({"ok": True, "count": len(arr)})
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.route("/api/calls/<call_id>/end", methods=["POST"])
@login_required
def call_end(call_id):
    uid = session["user_id"]
    d = request.json or {}
    reason = (d.get("reason") or "hangup").strip()[:40]
    conn = db()
    row = conn.execute("SELECT caller_id, callee_id, status FROM call_sessions WHERE id=?",
                       (call_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not found"}), 404
    if uid not in (row["caller_id"], row["callee_id"]):
        conn.close()
        return jsonify({"error": "forbidden"}), 403
    conn.execute("""UPDATE call_sessions SET status='ended',
                    ended_at=CURRENT_TIMESTAMP, ended_by=?, end_reason=?
                    WHERE id=?""", (uid, reason, call_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/calls/history")
@login_required
def call_history():
    """Return call log — calls I made or received."""
    uid = session["user_id"]
    limit = min(int(request.args.get("limit") or 50), 200)
    conn = db()
    rows = conn.execute("""
        SELECT c.*,
               cu.username AS caller_username, cu.display_name AS caller_name, cu.profile_pic AS caller_pic,
               ce.username AS callee_username, ce.display_name AS callee_name, ce.profile_pic AS callee_pic
        FROM call_sessions c
        JOIN users cu ON cu.id = c.caller_id
        JOIN users ce ON ce.id = c.callee_id
        WHERE c.caller_id=? OR c.callee_id=?
        ORDER BY c.created_at DESC
        LIMIT ?
    """, (uid, uid, limit)).fetchall()
    conn.close()
    out = []
    for r in rows:
        out.append({
            "id": r["id"],
            "kind": r["kind"],
            "status": r["status"],
            "is_missed": r["status"] in ("missed", "declined"),
            "outgoing": r["caller_id"] == uid,
            "created_at": r["created_at"],
            "ended_at": r["ended_at"],
            "end_reason": r["end_reason"],
            "caller": {"username": r["caller_username"], "display_name": r["caller_name"], "profile_pic": r["caller_pic"]},
            "callee": {"username": r["callee_username"], "display_name": r["callee_name"], "profile_pic": r["callee_pic"]},
        })
    return jsonify(out)


# ============================================
# MESSAGES
# ============================================

@app.route("/api/conversations")
@login_required
def conversations():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT u.id AS user_id, u.username, u.display_name, u.profile_pic,
               m.content AS last_message, m.created_at AS last_time, m.sender_id AS last_sender,
               (SELECT COUNT(*) FROM messages WHERE sender_id=u.id AND receiver_id=? AND is_read=0) AS unread,
               COALESCE(cs.is_pinned, 0) AS is_pinned,
               COALESCE(cs.is_muted, 0) AS is_muted,
               COALESCE(cs.nickname, '') AS nickname,
               COALESCE(cs.theme, 'default') AS theme,
               (strftime('%s','now') - strftime('%s', COALESCE(u.last_seen, u.created_at))) AS other_secs
        FROM (SELECT CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END AS other_id,
                     MAX(id) AS last_id
              FROM messages WHERE sender_id=? OR receiver_id=? GROUP BY other_id) AS c
        JOIN messages m ON m.id = c.last_id
        JOIN users u ON u.id = c.other_id
        LEFT JOIN chat_settings cs ON cs.user_id=? AND cs.other_user_id=u.id
        WHERE c.other_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND c.other_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
        ORDER BY COALESCE(cs.is_pinned,0) DESC, m.created_at DESC
    """, (uid, uid, uid, uid, uid, uid, uid)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/messages/<username>")
@login_required
def get_messages(username):
    """S30.24 — batched parent lookup + reactions + starred.

    Was: 6 correlated subqueries per message × up to 500 messages
         = ~3000 subqueries per chat open.
    Now: 1 main query + 3 batched queries = 4 total regardless of message count.
    """
    uid = session["user_id"]
    conn = db()
    other = conn.execute(
        "SELECT id, username, display_name, profile_pic FROM users WHERE username=?",
        (username,)
    ).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    other_id = other["id"]

    # S30.31 — only run UPDATE if there's actually unread to mark
    # (was: UPDATE + commit ran on every 3s poll → DB lock contention on mobile)
    _unread_row = conn.execute(
        "SELECT 1 FROM messages WHERE sender_id=? AND receiver_id=? AND is_read=0 LIMIT 1",
        (other_id, uid)
    ).fetchone()
    if _unread_row:
        conn.execute(
            "UPDATE messages SET is_read=1 WHERE sender_id=? AND receiver_id=? AND is_read=0",
            (other_id, uid)
        )
        conn.commit()

    # ─── 1) fetch raw messages (no subqueries) ───
    rows = conn.execute("""
        SELECT m.id, m.sender_id, m.receiver_id, m.content,
               m.attachment, m.parent_id, m.is_read, m.kind, m.duration,
               m.created_at, m.edited_at, m.deleted_at, m.hidden_for
        FROM messages m
        WHERE ((m.sender_id=? AND m.receiver_id=?)
           OR (m.sender_id=? AND m.receiver_id=?))
          AND (COALESCE(m.hidden_for,'') = '' OR m.hidden_for NOT LIKE ?)
        ORDER BY m.created_at DESC LIMIT 500
    """, (uid, other_id, other_id, uid, "%," + str(uid) + ",%")).fetchall()
    rows = list(reversed(rows))

    msg_ids = [r["id"] for r in rows]
    parent_ids = list(set(r["parent_id"] for r in rows if r["parent_id"]))

    # ─── 2) batch: parent message metadata ───
    parent_data = {}
    if parent_ids:
        pph = ",".join("?" * len(parent_ids))
        for pr in conn.execute(
            f"""SELECT m.id, m.content, m.attachment, m.sender_id,
                       u.display_name AS sender_name
                FROM messages m
                LEFT JOIN users u ON u.id = m.sender_id
                WHERE m.id IN ({pph})""",
            parent_ids
        ).fetchall():
            parent_data[pr["id"]] = {
                "content": pr["content"],
                "attachment": pr["attachment"],
                "sender_id": pr["sender_id"],
                "sender_name": pr["sender_name"],
            }

    # ─── 3) batch: reactions (my reaction + count) ───
    reaction_my = {}
    reaction_count = {}
    if msg_ids:
        mph = ",".join("?" * len(msg_ids))
        for rr in conn.execute(
            f"SELECT message_id, COUNT(*) AS c FROM message_reactions "
            f"WHERE message_id IN ({mph}) GROUP BY message_id",
            msg_ids
        ).fetchall():
            reaction_count[rr["message_id"]] = rr["c"]
        for rr in conn.execute(
            f"SELECT message_id, reaction FROM message_reactions "
            f"WHERE user_id=? AND message_id IN ({mph})",
            [uid] + msg_ids
        ).fetchall():
            reaction_my[rr["message_id"]] = rr["reaction"]

    # ─── 4) batch: starred ───
    starred_set = set()
    if msg_ids:
        sph = ",".join("?" * len(msg_ids))
        for sr in conn.execute(
            f"SELECT message_id FROM starred_messages "
            f"WHERE user_id=? AND message_id IN ({sph})",
            [uid] + msg_ids
        ).fetchall():
            starred_set.add(sr["message_id"])

    # ─── assemble ───
    msgs = []
    for r in rows:
        m = dict(r)
        pid = r["parent_id"]
        if pid and pid in parent_data:
            pd = parent_data[pid]
            m["parent_content"] = pd["content"]
            m["parent_attachment"] = pd["attachment"]
            m["parent_sender_id"] = pd["sender_id"]
            m["parent_sender_name"] = pd["sender_name"]
        else:
            m["parent_content"] = None
            m["parent_attachment"] = None
            m["parent_sender_id"] = None
            m["parent_sender_name"] = None
        m["my_reaction"] = reaction_my.get(r["id"])
        m["reaction_count"] = reaction_count.get(r["id"], 0)
        m["is_starred"] = 1 if r["id"] in starred_set else 0
        msgs.append(m)

    # ─── presence + their nicknames (unchanged) ───
    pres = conn.execute("""
        SELECT (strftime('%s','now') - strftime('%s', COALESCE(last_seen, created_at))) AS secs
        FROM users WHERE id=?
    """, (other_id,)).fetchone()
    other_secs = pres["secs"] if pres else None

    their_cs = conn.execute(
        """SELECT COALESCE(nickname,'') AS n,
                  COALESCE(my_nickname,'') AS mn
           FROM chat_settings WHERE user_id=? AND other_user_id=?""",
        (other_id, uid)
    ).fetchone()
    my_cs = conn.execute(
        """SELECT COALESCE(nickname,'') AS n,
                  COALESCE(my_nickname,'') AS mn
           FROM chat_settings WHERE user_id=? AND other_user_id=?""",
        (uid, other_id)
    ).fetchone()

    my_nickname_for_them = (my_cs["n"] if my_cs else "") or ""
    my_self_nickname = (my_cs["mn"] if my_cs else "") or ""
    their_self_nickname = (their_cs["mn"] if their_cs else "") or ""

    conn.close()
    return jsonify({
        "user": dict(other),
        "me_id": uid,
        "messages": msgs,
        "other_seconds_ago": other_secs,
        "other_is_typing": _is_typing(other_id, uid),
        "my_nickname_for_them": my_nickname_for_them,
        "my_self_nickname": my_self_nickname,
        "their_self_nickname": their_self_nickname,
    })
@app.route("/api/messages/<username>", methods=["POST"])
@login_required
@rate_limit("msg", 200, 3600)
def send_message(username):
    _blk = _is_public_action_blocked_for_admin()
    if _blk: return _blk
    uid = session["user_id"]
    d = request.json or {}
    content = (d.get("content") or "").strip()
    image = (d.get("image") or "").strip()
    parent_id = d.get("parent_id")

    if not content and not image:
        return jsonify({"error": "খালি মেসেজ পাঠানো যাবে না"}), 400
    if len(content) > 5_000:
        return jsonify({"error": "মেসেজ ৫,০০০ অক্ষরের বেশি হতে পারবে না"}), 400
    if image and not is_valid_image_uri(image, 3_000_000):
        return jsonify({"error": "ছবি ২ MB এর কম হতে হবে"}), 400

    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    if other["id"] == uid:
        conn.close()
        return jsonify({"error": "নিজেকে মেসেজ পাঠানো যাবে না"}), 400
    # S22 / Series 27A — cannot message admin
    if _is_admin(other["id"]):
        conn.close()
        return jsonify({"error": "Admin অ্যাকাউন্টে মেসেজ পাঠানো যাবে না"}), 403
    blk = conn.execute("""SELECT 1 FROM blocks
        WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)""",
        (uid, other["id"], other["id"], uid)).fetchone()
    if blk:
        conn.close()
        return jsonify({"error": "ব্লক করা ইউজারকে মেসেজ পাঠানো যাবে না"}), 403

    if parent_id:
        p = conn.execute("SELECT sender_id, receiver_id FROM messages WHERE id=?",
                         (parent_id,)).fetchone()
        if not p:
            conn.close()
            return jsonify({"error": "ভুল parent message"}), 400
        ids = {p["sender_id"], p["receiver_id"]}
        if not (uid in ids and other["id"] in ids):
            conn.close()
            return jsonify({"error": "ভুল parent message"}), 400

    # S22 / Series 8 — save image AFTER all validation (no orphan files)
    saved_image = None
    if image:
        saved_image = _save_data_uri(image, "messages", prefix=f"u{session['user_id']}_")
        if not saved_image:
            conn.close()
            return jsonify({"error": "ছবি সংরক্ষণ করা যায়নি"}), 500

    with _typing_lock:
        _typing_state.pop((uid, other["id"]), None)
    cur = conn.execute("""INSERT INTO messages (sender_id, receiver_id, content, attachment, parent_id)
        VALUES (?,?,?,?,?)""",
        (uid, other["id"], content, saved_image, parent_id))
    conn.commit()
    row = conn.execute("SELECT * FROM messages WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify({"ok": True, "message": dict(row)})


@app.route("/api/messages/<int:mid>/star", methods=["POST"])
@login_required
@rate_limit("star_msg", 200, 3600)
def toggle_star_message(mid):
    uid = session["user_id"]
    conn = db()
    m = conn.execute("SELECT sender_id, receiver_id FROM messages WHERE id=?", (mid,)).fetchone()
    if not m:
        conn.close()
        return jsonify({"error": "মেসেজ পাওয়া যায়নি"}), 404
    if uid not in (m["sender_id"], m["receiver_id"]):
        conn.close()
        return jsonify({"error": "অনুমতি নেই"}), 403
    existing = conn.execute("SELECT 1 FROM starred_messages WHERE user_id=? AND message_id=?",
                            (uid, mid)).fetchone()
    if existing:
        conn.execute("DELETE FROM starred_messages WHERE user_id=? AND message_id=?", (uid, mid))
        starred = False
    else:
        conn.execute("INSERT INTO starred_messages (user_id, message_id) VALUES (?,?)", (uid, mid))
        starred = True
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "starred": starred})


@app.route("/api/chats/<username>/starred")
@login_required
def list_starred(username):
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    other_id = other["id"]
    rows = conn.execute("""SELECT m.id, m.content, m.attachment, m.sender_id, m.created_at,
                                  sm.created_at AS starred_at
        FROM starred_messages sm
        JOIN messages m ON m.id = sm.message_id
        WHERE sm.user_id=?
          AND ((m.sender_id=? AND m.receiver_id=?) OR (m.sender_id=? AND m.receiver_id=?))
        ORDER BY sm.created_at DESC LIMIT 200""",
        (uid, uid, other_id, other_id, uid)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/messages/<int:mid>/forward", methods=["POST"])
@login_required
def forward_message(mid):
    uid = session["user_id"]
    d = request.json or {}
    targets = d.get("to") or []
    if not isinstance(targets, list) or not targets:
        return jsonify({"error": "কাউকে বেছে নিন"}), 400
    if len(targets) > 20:
        return jsonify({"error": "সর্বোচ্চ ২০ জনকে ফরওয়ার্ড"}), 400

    conn = db()
    m = conn.execute("""SELECT sender_id, receiver_id, content, attachment
                        FROM messages WHERE id=?""", (mid,)).fetchone()
    if not m:
        conn.close()
        return jsonify({"error": "মেসেজ পাওয়া যায়নি"}), 404
    if uid not in (m["sender_id"], m["receiver_id"]):
        conn.close()
        return jsonify({"error": "অনুমতি নেই"}), 403

    sent = 0
    skipped = 0
    for uname in targets:
        uname = (uname or "").strip().lower()
        if not uname:
            continue
        other = conn.execute("SELECT id FROM users WHERE username=?", (uname,)).fetchone()
        if not other:
            skipped += 1
            continue
        other_id = other["id"]
        if other_id == uid:
            skipped += 1
            continue
        blk = conn.execute("""SELECT 1 FROM blocks
            WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)
            LIMIT 1""", (uid, other_id, other_id, uid)).fetchone()
        if blk:
            skipped += 1
            continue
        conn.execute("""INSERT INTO messages (sender_id, receiver_id, content, attachment)
                        VALUES (?,?,?,?)""",
                     (uid, other_id, m["content"], m["attachment"]))
        sent += 1
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "sent": sent, "skipped": skipped})


@app.route("/api/chats/<username>/search")
@login_required
def search_in_chat(username):
    uid = session["user_id"]
    q = (request.args.get("q") or "").strip()
    if not q or len(q) > 100:
        return jsonify({"results": [], "count": 0})
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    other_id = other["id"]
    like = "%" + q.lower() + "%"
    rows = conn.execute("""SELECT id, content, sender_id, created_at
        FROM messages
        WHERE ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))
          AND LOWER(content) LIKE ?
        ORDER BY created_at DESC LIMIT 100""",
        (uid, other_id, other_id, uid, like)).fetchall()
    conn.close()
    return jsonify({"results": [dict(r) for r in rows], "count": len(rows)})


@app.route("/api/chats/<username>/settings", methods=["POST"])
@login_required
def update_chat_settings(username):
    uid = session["user_id"]
    d = request.json or {}
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    other_id = other["id"]

    is_pinned = 1 if d.get("pinned") else 0
    is_muted = 1 if d.get("muted") else 0
    theme = (d.get("theme") or "default").strip().lower()
    nickname = (d.get("nickname") or "").strip()[:40]
    my_nickname = (d.get("my_nickname") or "").strip()[:40]
    wallpaper = (d.get("wallpaper") or "default").strip()[:500]
    nickname_public = 1 if d.get("nickname_public") else 0

    _ALLOWED_THEMES = (
        "default", "coral", "ocean", "emerald", "sunset", "royal", "mono",
        "instagram", "linear", "notion", "teal", "vercel",
    )
    if theme not in _ALLOWED_THEMES:
        theme = "default"

    existing = conn.execute(
        "SELECT 1 FROM chat_settings WHERE user_id=? AND other_user_id=?",
        (uid, other_id)
    ).fetchone()

    # Read PREVIOUS nickname BEFORE saving (so we can detect a change)
    _prev_nick = ""
    _prev_row = conn.execute(
        "SELECT COALESCE(nickname,'') AS n FROM chat_settings WHERE user_id=? AND other_user_id=?",
        (uid, other_id)
    ).fetchone()
    if _prev_row:
        _prev_nick = _prev_row["n"] or ""

    if existing:
        conn.execute("""UPDATE chat_settings
                        SET is_pinned=?, is_muted=?, theme=?, nickname=?, my_nickname=?, wallpaper=?, nickname_public=?
                        WHERE user_id=? AND other_user_id=?""",
                     (is_pinned, is_muted, theme, nickname, my_nickname, wallpaper, nickname_public, uid, other_id))
    else:
        conn.execute("""INSERT INTO chat_settings
                        (user_id, other_user_id, is_pinned, is_muted, theme, nickname, my_nickname, wallpaper, nickname_public)
                        VALUES (?,?,?,?,?,?,?,?,?)""",
                     (uid, other_id, is_pinned, is_muted, theme, nickname, my_nickname, wallpaper, nickname_public))

    if nickname and nickname != _prev_nick:
        _sys_text = "\u09a8\u09bf\u0995\u09a8\u09c7\u09ae '" + nickname + "' \u09b8\u09c7\u099f \u0995\u09b0\u09be \u09b9\u09df\u09c7\u099b\u09c7"
        try:
            conn.execute("""INSERT INTO messages
                            (sender_id, receiver_id, content, kind)
                            VALUES (?,?,?,?)""",
                         (uid, other_id, _sys_text, "system"))
        except sqlite3.OperationalError:
            # kind column may not exist yet — fallback
            try:
                conn.execute("""INSERT INTO messages
                                (sender_id, receiver_id, content)
                                VALUES (?,?,?)""",
                             (uid, other_id, _sys_text))
            except Exception:
                pass

    # Series 3B fix — mirror theme + wallpaper to reverse row (shared look)
    conn.execute("""INSERT INTO chat_settings (user_id, other_user_id, theme, wallpaper)
                    VALUES (?,?,?,?)
                    ON CONFLICT(user_id, other_user_id) DO UPDATE SET
                        theme = excluded.theme,
                        wallpaper = excluded.wallpaper""",
                 (other_id, uid, theme, wallpaper))
    conn.commit()
    conn.close()
    return jsonify({
        "ok": True,
        "pinned": bool(is_pinned),
        "muted": bool(is_muted),
        "theme": theme,
        "nickname": nickname,
        "my_nickname": my_nickname,
        "wallpaper": wallpaper,
        "nickname_public": bool(nickname_public),
    })


@app.route("/api/chats/<username>/settings")
@login_required
def get_chat_settings(username):
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    row = conn.execute(
        """SELECT COALESCE(is_pinned,0) AS p,
                  COALESCE(is_muted,0) AS m,
                  COALESCE(theme,'default') AS t,
                  COALESCE(nickname,'') AS n,
                  COALESCE(my_nickname,'') AS mn,
                  COALESCE(wallpaper,'default') AS w,
                  COALESCE(nickname_public,0) AS np
           FROM chat_settings WHERE user_id=? AND other_user_id=?""",
        (uid, other["id"])
    ).fetchone()
    conn.close()
    return jsonify({
        "pinned": bool(row["p"]) if row else False,
        "muted": bool(row["m"]) if row else False,
        "theme": (row["t"] if row else "default") or "default",
        "nickname": (row["n"] if row else "") or "",
        "my_nickname": (row["mn"] if row else "") or "",
        "wallpaper": (row["w"] if row else "default") or "default",
        "nickname_public": bool(row["np"]) if row else False,
    })


@app.route("/api/chats/<username>/clear", methods=["POST"])
@login_required
def clear_chat(username):
    """S22 batch — clear ONLY for current user (hide, not delete both)."""
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    other_id = other["id"]
    # Mark all messages in this conversation as hidden for ME only
    rows = conn.execute("""SELECT id, COALESCE(hidden_for,'') AS hf FROM messages
        WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)""",
        (uid, other_id, other_id, uid)).fetchall()
    for r in rows:
        hidden = set(x.strip() for x in (r["hf"] or "").split(",") if x.strip())
        hidden.add(str(uid))
        new_hf = "," + ",".join(sorted(hidden)) + ","
        conn.execute("UPDATE messages SET hidden_for=? WHERE id=?", (new_hf, r["id"]))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "cleared": len(rows)})


@app.route("/api/messages/<username>/voice", methods=["POST"])
@login_required
@rate_limit("voice", 60, 3600)
def send_voice_message(username):
    """Series 3A — send voice message (base64 audio/webm)."""
    uid = session["user_id"]
    d = request.json or {}
    audio = (d.get("audio") or "").strip()
    try:
        duration = float(d.get("duration") or 0)
    except (ValueError, TypeError):
        duration = 0
    parent_id = d.get("parent_id")

    if not audio or not audio.startswith("data:audio/"):
        return jsonify({"error": "\u09ad\u09af\u09bc\u09c7\u09b8 \u09a1\u09c7\u099f\u09be \u09a6\u09bf\u09a8"}), 400
    if len(audio) > 4_000_000:
        return jsonify({"error": "\u09ad\u09af\u09bc\u09c7\u09b8 \u0985\u09a8\u09c7\u0995 \u09ac\u09a1\u09bc (\u09e9 MB \u0985\u09a8\u09c7\u0995)"}), 400
    if duration <= 0 or duration > 300:
        return jsonify({"error": "\u09ad\u09af\u09bc\u09c7\u09b8 \u09e7-\u09e9\u09e6\u09e6 \u09b8\u09c7\u0995\u09c7\u09a8\u09cd\u09a1\u09c7\u09b0 \u09ae\u09a7\u09cd\u09af\u09c7 \u09b9\u09a4\u09c7 \u09b9\u09ac\u09c7"}), 400

    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "\u0987\u0989\u099c\u09be\u09b0 \u09aa\u09be\u0993\u09af\u09bc\u09be \u09af\u09be\u09af\u09bc\u09a8\u09bf"}), 404
    other_id = other["id"]
    if other_id == uid:
        conn.close()
        return jsonify({"error": "\u09a8\u09bf\u099c\u09c7\u0995\u09c7 \u09aa\u09be\u09a0\u09be\u09a8\u09cb \u09af\u09be\u09ac\u09c7 \u09a8\u09be"}), 400

    blk = conn.execute("""SELECT 1 FROM blocks
        WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)
        LIMIT 1""", (uid, other_id, other_id, uid)).fetchone()
    if blk:
        conn.close()
        return jsonify({"error": "\u09ac\u09cd\u09b2\u0995\u09a1 \u0987\u0989\u099c\u09be\u09b0\u0995\u09c7 \u09ae\u09c7\u09b8\u09c7\u099c \u09aa\u09be\u09a0\u09be\u09a8\u09cb \u09af\u09be\u09ac\u09c7 \u09a8\u09be"}), 403

    if parent_id:
        p = conn.execute(
            "SELECT sender_id, receiver_id FROM messages WHERE id=?",
            (parent_id,)
        ).fetchone()
        if not p:
            conn.close()
            return jsonify({"error": "\u09ad\u09c1\u09b2 parent"}), 400
        # S22 / Series 22 — verify parent belongs to same conversation
        # (prevents reading messages from OTHER chats via parent_id)
        ids = {p["sender_id"], p["receiver_id"]}
        if not (uid in ids and other_id in ids):
            conn.close()
            return jsonify({"error": "\u09ad\u09c1\u09b2 parent"}), 400

    saved = _save_data_uri(audio, "messages", prefix=f"v{uid}_")
    if not saved:
        conn.close()
        return jsonify({"error": "\u09ad\u09af\u09bc\u09c7\u09b8 \u09b8\u09c7\u09ad \u0995\u09b0\u09be \u09af\u09be\u09af\u09bc\u09a8\u09bf"}), 500

    cur = conn.execute("""INSERT INTO messages
        (sender_id, receiver_id, content, attachment, parent_id, kind, duration)
        VALUES (?,?,?,?,?,?,?)""",
        (uid, other_id, "", saved, parent_id, "voice", duration))
    conn.commit()
    row = conn.execute("SELECT * FROM messages WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify({"ok": True, "id": cur.lastrowid})


@app.route("/api/messages/<username>/typing", methods=["POST"])
@login_required
def mark_typing(username):
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    conn.close()
    if not other:
        return jsonify({"ok": False}), 404
    _mark_typing(uid, other["id"])
    return jsonify({"ok": True})


@app.route("/api/messages/<int:mid>/react", methods=["POST"])
@login_required
def react_message(mid):
    uid = session["user_id"]
    d = request.json or {}
    reaction = (d.get("reaction") or "love").strip()
    if reaction not in ("love", "like", "haha", "wow", "sad"):
        reaction = "love"

    conn = db()
    m = conn.execute("SELECT sender_id, receiver_id FROM messages WHERE id=?", (mid,)).fetchone()
    if not m:
        conn.close()
        return jsonify({"error": "মেসেজ পাওয়া যায়নি"}), 404
    if uid not in (m["sender_id"], m["receiver_id"]):
        conn.close()
        return jsonify({"error": "এই মেসেজে reaction দেওয়া যাবে না"}), 403

    existing = conn.execute("SELECT reaction FROM message_reactions WHERE message_id=? AND user_id=?",
                            (mid, uid)).fetchone()
    if existing and existing["reaction"] == reaction:
        conn.execute("DELETE FROM message_reactions WHERE message_id=? AND user_id=?", (mid, uid))
        my = None
    else:
        conn.execute("""INSERT INTO message_reactions (message_id, user_id, reaction) VALUES (?,?,?)
            ON CONFLICT(message_id, user_id) DO UPDATE SET reaction=excluded.reaction""",
            (mid, uid, reaction))
        my = reaction

    conn.commit()
    count = conn.execute("SELECT COUNT(*) AS c FROM message_reactions WHERE message_id=?",
                         (mid,)).fetchone()["c"]
    conn.close()
    return jsonify({"ok": True, "my_reaction": my, "count": count})


@app.route("/api/messages/<int:mid>", methods=["PATCH"])
@login_required
@rate_limit("edit_msg", 100, 3600)
def edit_message(mid):
    """Series 3C — edit own text message (within 15 min)."""
    uid = session["user_id"]
    d = request.json or {}
    new_content = (d.get("content") or "").strip()

    if not new_content:
        return jsonify({"error": "\u0996\u09be\u09b2\u09bf \u09ae\u09c7\u09b8\u09c7\u099c \u09b9\u09ac\u09c7 \u09a8\u09be"}), 400
    if len(new_content) > 5000:
        return jsonify({"error": "\u09ac\u09a1\u09bc \u09ae\u09c7\u09b8\u09c7\u099c"}), 400

    conn = db()
    m = conn.execute("""SELECT sender_id, receiver_id, kind, content, created_at,
                              deleted_at
                        FROM messages WHERE id=?""", (mid,)).fetchone()
    if not m:
        conn.close()
        return jsonify({"error": "\u09ae\u09c7\u09b8\u09c7\u099c \u09a8\u09c7\u0987"}), 404
    # S22 / Series 21 — cannot edit a message that was deleted for everyone
    if m["deleted_at"]:
        conn.close()
        return jsonify({"error": "\u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09be \u09ae\u09c7\u09b8\u09c7\u099c \u098f\u09a1\u09bf\u099f \u0995\u09b0\u09be \u09af\u09be\u09ac\u09c7 \u09a8\u09be"}), 400
    if m["sender_id"] != uid:
        conn.close()
        return jsonify({"error": "\u09b6\u09c1\u09a7\u09c1 \u09a8\u09bf\u099c\u09c7\u09b0 \u09ae\u09c7\u09b8\u09c7\u099c \u098f\u09a1\u09bf\u099f"}), 403
    if m["kind"] == "voice" or m["kind"] == "system":
        conn.close()
        return jsonify({"error": "\u098f\u0987 \u09ae\u09c7\u09b8\u09c7\u099c \u098f\u09a1\u09bf\u099f \u0995\u09b0\u09be \u09af\u09be\u09ac\u09c7 \u09a8\u09be"}), 400

    # Time limit: 15 minutes
    age = conn.execute("""SELECT (strftime('%s','now') - strftime('%s', ?)) AS secs""",
                       (m["created_at"],)).fetchone()["secs"]
    if age is not None and age > 900:
        conn.close()
        return jsonify({"error": "\u09e7\u09eb \u09ae\u09bf\u09a8\u09bf\u099f \u09aa\u09b0 \u098f\u09a1\u09bf\u099f \u0995\u09b0\u09be \u09af\u09be\u09ac\u09c7 \u09a8\u09be"}), 400

    conn.execute("""UPDATE messages SET content=?, edited_at=CURRENT_TIMESTAMP WHERE id=?""",
                 (new_content, mid))
    conn.commit()
    edited = conn.execute("SELECT edited_at FROM messages WHERE id=?", (mid,)).fetchone()["edited_at"]
    conn.close()
    return jsonify({"ok": True, "content": new_content, "edited_at": edited})


@app.route("/api/messages/<int:mid>/delete-for-me", methods=["POST"])
@login_required
def delete_for_me(mid):
    """Series 3C — hide message only for me."""
    uid = session["user_id"]
    conn = db()
    m = conn.execute("SELECT sender_id, receiver_id, COALESCE(hidden_for,'') AS hf FROM messages WHERE id=?",
                     (mid,)).fetchone()
    if not m:
        conn.close()
        return jsonify({"error": "\u09ae\u09c7\u09b8\u09c7\u099c \u09a8\u09c7\u0987"}), 404
    if uid not in (m["sender_id"], m["receiver_id"]):
        conn.close()
        return jsonify({"error": "\u0985\u09a8\u09c1\u09ae\u09a4\u09bf \u09a8\u09c7\u0987"}), 403

    hidden = set(x.strip() for x in (m["hf"] or "").split(",") if x.strip())
    hidden.add(str(uid))
    new_hf = "," + ",".join(sorted(hidden)) + ","
    conn.execute("UPDATE messages SET hidden_for=? WHERE id=?", (new_hf, mid))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/messages/<int:mid>/delete-for-everyone", methods=["POST"])
@login_required
def delete_for_everyone(mid):
    """Series 3C — mark message as deleted for both sides (within 60 min)."""
    uid = session["user_id"]
    conn = db()
    m = conn.execute("""SELECT sender_id, receiver_id, kind, created_at, attachment
                        FROM messages WHERE id=?""", (mid,)).fetchone()
    if not m:
        conn.close()
        return jsonify({"error": "\u09ae\u09c7\u09b8\u09c7\u099c \u09a8\u09c7\u0987"}), 404
    if m["sender_id"] != uid:
        conn.close()
        return jsonify({"error": "\u09b6\u09c1\u09a7\u09c1 \u09a8\u09bf\u099c\u09c7\u09b0 \u09ae\u09c7\u09b8\u09c7\u099c \u09ae\u09c1\u099b\u09be \u09af\u09be\u09ac\u09c7"}), 403
    if m["kind"] == "system":
        conn.close()
        return jsonify({"error": "\u09b8\u09bf\u09b8\u099f\u09c7\u09ae \u09ae\u09c7\u09b8\u09c7\u099c"}), 400

    # 60 min time limit
    age = conn.execute("""SELECT (strftime('%s','now') - strftime('%s', ?)) AS secs""",
                       (m["created_at"],)).fetchone()["secs"]
    if age is not None and age > 3600:
        conn.close()
        return jsonify({"error": "\u09e6\u09ed \u09ae\u09bf\u09a8\u09bf\u099f \u09aa\u09b0 \u09ae\u09c1\u099b\u09be \u09af\u09be\u09ac\u09c7 \u09a8\u09be"}), 400

    # S22 / Series 21 — capture attachment path BEFORE clearing DB
    _attachment_to_delete = m["attachment"]

    # S22 / Series 21 — clear BOTH content and attachment
    conn.execute(
        """UPDATE messages SET deleted_at=CURRENT_TIMESTAMP,
                              content='',
                              attachment=NULL
           WHERE id=?""",
        (mid,),
    )
    conn.commit()
    conn.close()

    # S22 / Series 21 — delete file from disk (outside DB lock)
    if _attachment_to_delete:
        try:
            _delete_upload_file(_attachment_to_delete)
        except Exception as e:
            print(f"[Series 21] attachment delete failed: {e}")

    return jsonify({"ok": True})


@app.route("/api/messages/<int:mid>", methods=["DELETE"])
@login_required
def delete_message(mid):
    uid = session["user_id"]
    conn = db()
    m = conn.execute("SELECT sender_id FROM messages WHERE id=?", (mid,)).fetchone()
    if not m:
        conn.close()
        return jsonify({"error": "মেসেজ পাওয়া যায়নি"}), 404
    if m["sender_id"] != uid:
        conn.close()
        return jsonify({"error": "শুধু নিজের মেসেজ মুছতে পারবেন"}), 403
    conn.execute("DELETE FROM message_reactions WHERE message_id=?", (mid,))
    conn.execute("UPDATE messages SET parent_id=NULL WHERE parent_id=?", (mid,))
    conn.execute("DELETE FROM messages WHERE id=?", (mid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/groups", methods=["POST"])
@login_required
@rate_limit("grp", 10, 3600)
def create_group():
    _blk = _is_public_action_blocked_for_admin()
    if _blk: return _blk
    d = request.json or {}
    name = (d.get("name") or "").strip()
    member_usernames = d.get("members") or []

    if not name or len(name) > 80:
        return jsonify({"error": "গ্রুপের নাম দিন (৮০ অক্ষরের কম)"}), 400
    if not isinstance(member_usernames, list) or len(member_usernames) < 2:
        return jsonify({"error": "কমপক্ষে ২ জন সদস্য লাগবে"}), 400
    if len(member_usernames) > 50:
        return jsonify({"error": "সর্বোচ্চ ৫০ জন সদস্য"}), 400

    uid = session["user_id"]
    conn = db()

    # Resolve usernames to ids
    member_ids = []
    for un in member_usernames:
        row = conn.execute("SELECT id FROM users WHERE username=?", (un,)).fetchone()
        if row and row["id"] != uid:
            member_ids.append(row["id"])

    if len(member_ids) < 2:
        conn.close()
        return jsonify({"error": "কমপক্ষে ২ জন বৈধ সদস্য লাগবে"}), 400

    for _mid in member_ids:
        _blk = conn.execute("""SELECT 1 FROM blocks
            WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)
            LIMIT 1""", (uid, _mid, _mid, uid)).fetchone()
        if _blk:
            conn.close()
            return jsonify({"error": "blocked user in group"}), 403

    cur = conn.execute("INSERT INTO group_chats (name, created_by) VALUES (?,?)", (name, uid))
    gid = cur.lastrowid

    # Add creator + members
    conn.execute("INSERT INTO group_members (group_id, user_id) VALUES (?,?)", (gid, uid))
    for mid in member_ids:
        conn.execute("INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?,?)", (gid, mid))

    conn.commit()
    conn.close()
    return jsonify({"ok": True, "group_id": gid})


@app.route("/api/groups")
@login_required
def list_groups():
    """S30.22 — batched member avatars (was: 1 query per group)."""
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT g.id, g.name, g.created_by, g.created_at,
               (SELECT COUNT(*) FROM group_members WHERE group_id=g.id) AS member_count,
               (SELECT content FROM group_messages WHERE group_id=g.id ORDER BY id DESC LIMIT 1) AS last_message,
               (SELECT created_at FROM group_messages WHERE group_id=g.id ORDER BY id DESC LIMIT 1) AS last_time,
               (SELECT sender_id FROM group_messages WHERE group_id=g.id ORDER BY id DESC LIMIT 1) AS last_sender
        FROM group_chats g
        JOIN group_members gm ON gm.group_id=g.id
        WHERE gm.user_id=?
        ORDER BY COALESCE(last_time, g.created_at) DESC
    """, (uid,)).fetchall()

    group_ids = [r["id"] for r in rows]

    # ─── Batch fetch first 3 members per group (window function via SQLite 3.25+) ───
    members_by_group = {}
    if group_ids:
        ph = ",".join("?" * len(group_ids))
        # Use a correlated ranking to get 3 per group in one pass
        mrows = conn.execute(f"""
            SELECT group_id, username, display_name, profile_pic
            FROM (
                SELECT gm.group_id,
                       u.username, u.display_name, u.profile_pic,
                       ROW_NUMBER() OVER (PARTITION BY gm.group_id ORDER BY gm.joined_at ASC) AS rn
                FROM group_members gm
                JOIN users u ON u.id = gm.user_id
                WHERE gm.group_id IN ({ph})
            )
            WHERE rn <= 3
        """, group_ids).fetchall()
        for mr in mrows:
            members_by_group.setdefault(mr["group_id"], []).append(dict(mr))

    groups = []
    for r in rows:
        gd = dict(r)
        gd["members"] = members_by_group.get(r["id"], [])
        groups.append(gd)

    conn.close()
    return jsonify(groups)
@app.route("/api/groups/<int:gid>")
@login_required
def get_group(gid):
    uid = session["user_id"]
    conn = db()
    member = conn.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",
                          (gid, uid)).fetchone()
    if not member:
        conn.close()
        return jsonify({"error": "আপনি এই গ্রুপের সদস্য নন"}), 403

    g = conn.execute("SELECT id, name, created_by, created_at FROM group_chats WHERE id=?",
                     (gid,)).fetchone()
    if not g:
        conn.close()
        return jsonify({"error": "গ্রুপ পাওয়া যায়নি"}), 404

    # All members
    members = conn.execute("""
        SELECT u.id, u.username, u.display_name, u.profile_pic
        FROM group_members gm JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id=?
        ORDER BY gm.joined_at ASC
    """, (gid,)).fetchall()

    # Messages
    msgs = conn.execute("""
        SELECT m.id, m.sender_id, m.content, m.attachment, m.created_at,
               u.username, u.display_name, u.profile_pic
        FROM group_messages m JOIN users u ON u.id = m.sender_id
        WHERE m.group_id=?
        ORDER BY m.created_at ASC LIMIT 500
    """, (gid,)).fetchall()

    conn.close()
    return jsonify({
        "group": dict(g),
        "members": [dict(m) for m in members],
        "messages": [dict(m) for m in msgs],
        "me_id": uid,
    })


@app.route("/api/groups/<int:gid>/send", methods=["POST"])
@login_required
def send_group_message(gid):
    _blk = _is_public_action_blocked_for_admin()
    if _blk: return _blk
    uid = session["user_id"]
    d = request.json or {}
    content = (d.get("content") or "").strip()
    image = (d.get("image") or "").strip()

    if not content and not image:
        return jsonify({"error": "খালি মেসেজ পাঠানো যাবে না"}), 400
    if len(content) > 5000:
        return jsonify({"error": "মেসেজ ৫,০০০ অক্ষরের বেশি হতে পারবে না"}), 400
    if image and not is_valid_image_uri(image, 3_000_000):
        return jsonify({"error": "ছবি ২ MB এর কম হতে হবে"}), 400

    conn = db()
    member = conn.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",
                          (gid, uid)).fetchone()
    if not member:
        conn.close()
        return jsonify({"error": "আপনি এই গ্রুপের সদস্য নন"}), 403

    # S22 / Series 8 — save image AFTER membership check (no orphan files)
    saved_image = None
    if image:
        saved_image = _save_data_uri(image, "messages", prefix=f"g{gid}_u{uid}_")
        if not saved_image:
            conn.close()
            return jsonify({"error": "ছবি সংরক্ষণ করা যায়নি"}), 500

    cur = conn.execute("""INSERT INTO group_messages (group_id, sender_id, content, attachment)
        VALUES (?,?,?,?)""", (gid, uid, content, saved_image))
    conn.commit()
    row = conn.execute("""
        SELECT m.id, m.sender_id, m.content, m.attachment, m.created_at,
               u.username, u.display_name, u.profile_pic
        FROM group_messages m JOIN users u ON u.id = m.sender_id
        WHERE m.id=?
    """, (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify({"ok": True, "message": dict(row)})


@app.route("/api/groups/<int:gid>/leave", methods=["POST"])
@login_required
def leave_group(gid):
    uid = session["user_id"]
    conn = db()
    member = conn.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",
                          (gid, uid)).fetchone()
    if not member:
        conn.close()
        return jsonify({"error": "আপনি এই গ্রুপে নেই"}), 404

    conn.execute("DELETE FROM group_members WHERE group_id=? AND user_id=?", (gid, uid))

    # If no members left, delete group + messages
    remaining = conn.execute("SELECT COUNT(*) AS c FROM group_members WHERE group_id=?",
                             (gid,)).fetchone()["c"]
    if remaining == 0:
        conn.execute("DELETE FROM group_messages WHERE group_id=?", (gid,))
        conn.execute("DELETE FROM group_chats WHERE id=?", (gid,))

    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/groups/<int:gid>/add-member", methods=["POST"])
@login_required
def add_group_member(gid):
    uid = session["user_id"]
    d = request.json or {}
    username = (d.get("username") or "").strip().lower()
    if not username:
        return jsonify({"error": "ইউজারনেম দিন"}), 400

    conn = db()
    # Must be a member
    member = conn.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",
                          (gid, uid)).fetchone()
    if not member:
        conn.close()
        return jsonify({"error": "আপনি এই গ্রুপের সদস্য নন"}), 403

    target = conn.execute("SELECT id, display_name FROM users WHERE username=?", (username,)).fetchone()
    if not target:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404

    exists = conn.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",
                          (gid, target["id"])).fetchone()
    if exists:
        conn.close()
        return jsonify({"error": "ইতিমধ্যে গ্রুপে আছেন"}), 400

    # Check group size
    count = conn.execute("SELECT COUNT(*) AS c FROM group_members WHERE group_id=?", (gid,)).fetchone()["c"]
    if count >= 50:
        conn.close()
        return jsonify({"error": "গ্রুপ পূর্ণ (৫০ জন)"}), 400

    conn.execute("INSERT INTO group_members (group_id, user_id) VALUES (?,?)", (gid, target["id"]))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "display_name": target["display_name"]})


@app.route("/api/messages/online-contacts")
@login_required
def online_contacts():
    """Messenger-style: story/contact row for messages page."""
    uid = session["user_id"]
    conn = db()

    # Self (for "Your story" tile)
    me_row = conn.execute("""
        SELECT u.id, u.username, u.display_name, u.profile_pic,
               (strftime('%s','now') - strftime('%s', COALESCE(u.last_seen, u.created_at))) AS secs,
               (SELECT COUNT(*) FROM stories s WHERE s.user_id=u.id
                    AND datetime(s.created_at) > datetime('now','-24 hours')) AS story_count
        FROM users u WHERE u.id=?
    """, (uid,)).fetchone()

    # Others: contacts + story-holders + following + recent message partners
    rows = conn.execute("""
        SELECT u.id, u.username, u.display_name, u.profile_pic,
               (strftime('%s','now') - strftime('%s', COALESCE(u.last_seen, u.created_at))) AS secs,
               (SELECT COUNT(*) FROM stories s WHERE s.user_id=u.id
                    AND datetime(s.created_at) > datetime('now','-24 hours')) AS story_count,
               (SELECT COUNT(*) FROM stories s WHERE s.user_id=u.id
                    AND datetime(s.created_at) > datetime('now','-24 hours')
                    AND NOT EXISTS (SELECT 1 FROM story_views sv
                                    WHERE sv.story_id=s.id AND sv.viewer_id=?)) AS unread_story
        FROM users u
        WHERE u.id != ?
          AND LOWER(u.username) != ?
          AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
          AND (
            -- has active story
            EXISTS (SELECT 1 FROM stories s WHERE s.user_id=u.id
                    AND datetime(s.created_at) > datetime('now','-24 hours'))
            -- or follows
            OR u.id IN (SELECT following_id FROM follows WHERE follower_id=?)
            -- or recent message partner
            OR u.id IN (SELECT CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END
                          FROM messages WHERE sender_id=? OR receiver_id=?)
            -- or recently active
            OR (u.last_seen IS NOT NULL
                AND datetime(u.last_seen) > datetime('now','-7 days'))
          )
        ORDER BY
          -- Story holders first
          (CASE WHEN EXISTS (SELECT 1 FROM stories s WHERE s.user_id=u.id
                    AND datetime(s.created_at) > datetime('now','-24 hours'))
                THEN 0 ELSE 1 END) ASC,
          -- Then online
          (CASE WHEN COALESCE(u.last_seen, u.created_at) >
                    datetime('now','-1 hour') THEN 0 ELSE 1 END) ASC,
          datetime(COALESCE(u.last_seen, u.created_at)) DESC
        LIMIT 25
    """, (uid, uid, ADMIN_USERNAME, uid, uid, uid, uid, uid, uid)).fetchall()

    conn.close()

    me = None
    if me_row:
        me = {
            "id": me_row["id"],
            "username": me_row["username"],
            "display_name": me_row["display_name"],
            "profile_pic": me_row["profile_pic"],
            "story_count": me_row["story_count"],
        }

    return jsonify({
        "me": me,
        "contacts": [dict(r) for r in rows],
    })


@app.route("/api/messages/unread/count")
@login_required
def unread_count():
    uid = session["user_id"]
    conn = db()
    row = conn.execute("SELECT COUNT(*) AS c FROM messages WHERE receiver_id=? AND is_read=0",
                       (uid,)).fetchone()
    conn.close()
    return jsonify({"count": row["c"]})


# ============================================
# STORIES
# ============================================

@app.route("/api/stories")
@login_required
def get_all_stories():
    """S30.23 — batched views count (was: 2 correlated subqueries per row)."""
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT s.id, s.user_id, s.media, s.media_type, s.caption, s.created_at,
               u.username, u.display_name, u.profile_pic
        FROM stories s JOIN users u ON u.id = s.user_id
        WHERE datetime(s.created_at) > datetime('now', '-24 hours')
          AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
        ORDER BY s.created_at ASC
    """, (uid, uid)).fetchall()

    story_ids = [r["id"] for r in rows]

    # batch view counts + which I've seen
    views_count = {}
    seen_by_me = set()
    if story_ids:
        ph = ",".join("?" * len(story_ids))
        for vr in conn.execute(
            f"SELECT story_id, COUNT(*) AS c FROM story_views WHERE story_id IN ({ph}) GROUP BY story_id",
            story_ids
        ).fetchall():
            views_count[vr["story_id"]] = vr["c"]
        for vr in conn.execute(
            f"SELECT story_id FROM story_views WHERE viewer_id=? AND story_id IN ({ph})",
            [uid] + story_ids
        ).fetchall():
            seen_by_me.add(vr["story_id"])

    groups = {}
    for r in rows:
        uname = r["username"]
        if uname not in groups:
            groups[uname] = {
                "user": {"id": r["user_id"], "username": r["username"],
                         "display_name": r["display_name"], "profile_pic": r["profile_pic"]},
                "stories": [], "has_unseen": False, "latest": r["created_at"]}
        st = {"id": r["id"], "media": r["media"], "media_type": r["media_type"],
              "caption": r["caption"], "created_at": r["created_at"],
              "views": views_count.get(r["id"], 0),
              "viewed": r["id"] in seen_by_me}
        groups[uname]["stories"].append(st)
        if not st["viewed"]:
            groups[uname]["has_unseen"] = True
        if r["created_at"] > groups[uname]["latest"]:
            groups[uname]["latest"] = r["created_at"]
    conn.close()
    result = sorted(groups.values(), key=lambda g: g["has_unseen"], reverse=True)
    return jsonify(result)
@app.route("/api/stories", methods=["POST"])
@login_required
@rate_limit("story", 20, 86400)
def create_story():
    _blk = _is_public_action_blocked_for_admin()
    if _blk: return _blk
    data = request.json or {}
    media = (data.get("media") or "").strip()
    caption = (data.get("caption") or "").strip()[:200]
    if not is_valid_image_uri(media, 4_000_000):
        return jsonify({"error": "অবৈধ ছবি বা ৩ MB এর বেশি"}), 400
    # S17.1 — save to filesystem
    saved = _save_data_uri(media, "stories", prefix=f"u{session['user_id']}_")
    if not saved:
        return jsonify({"error": "স্টোরি সংরক্ষণ করা যায়নি"}), 500
    conn = db()
    cur = conn.execute("INSERT INTO stories (user_id, media, caption) VALUES (?,?,?)",
                       (session["user_id"], saved, caption))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": cur.lastrowid})


@app.route("/api/stories/<int:sid>/view", methods=["POST"])
@login_required
def mark_story_viewed(sid):
    uid = session["user_id"]
    conn = db()
    story = conn.execute("SELECT user_id FROM stories WHERE id=?", (sid,)).fetchone()
    if not story:
        conn.close()
        return jsonify({"error": "স্টোরি পাওয়া যায়নি"}), 404
    # Block check
    if _is_blocked_either_way(uid, story["user_id"]):
        conn.close()
        return jsonify({"error": "স্টোরি পাওয়া যায়নি"}), 404
    if story["user_id"] != uid:
        conn.execute("INSERT OR IGNORE INTO story_views (story_id, viewer_id) VALUES (?,?)",
                     (sid, uid))
        conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/stories/<int:sid>/react", methods=["POST"])
@login_required
def react_to_story(sid):
    d = request.json or {}
    reaction = (d.get("reaction") or "").strip()
    valid = {"love", "haha", "wow", "sad", "clap", "fire"}
    if reaction not in valid:
        return jsonify({"error": "ভুল reaction"}), 400

    uid = session["user_id"]
    conn = db()
    story = conn.execute("SELECT user_id FROM stories WHERE id=?", (sid,)).fetchone()
    if not story:
        conn.close()
        return jsonify({"error": "স্টোরি পাওয়া যায়নি"}), 404
    # Block check
    if _is_blocked_either_way(uid, story["user_id"]):
        conn.close()
        return jsonify({"error": "স্টোরি পাওয়া যায়নি"}), 404
    if story["user_id"] == uid:
        conn.close()
        return jsonify({"error": "নিজের স্টোরিতে reaction দেওয়া যাবে না"}), 400

    # একই user একই story তে multiple reaction দিতে পারবে — কিন্তু একই reaction থাকলে duplicate হবে না
    existing = conn.execute("""SELECT id FROM story_reactions
        WHERE story_id=? AND user_id=? AND reaction=?""",
        (sid, uid, reaction)).fetchone()
    if not existing:
        conn.execute("""INSERT INTO story_reactions (story_id, user_id, reaction)
            VALUES (?,?,?)""", (sid, uid, reaction))
        # Notification
        conn.execute("""INSERT INTO notifications (user_id, actor_id, type, post_id)
            VALUES (?,?,?,?)""", (story["user_id"], uid, "story_reaction", sid))
        conn.commit()

    count = conn.execute("""SELECT COUNT(*) AS n FROM story_reactions
        WHERE story_id=?""", (sid,)).fetchone()["n"]
    conn.close()
    return jsonify({"ok": True, "count": count})


@app.route("/api/stories/<int:sid>/reactions")
@login_required
def get_story_reactions(sid):
    uid = session["user_id"]
    conn = db()
    story = conn.execute("SELECT user_id FROM stories WHERE id=?", (sid,)).fetchone()
    if not story:
        conn.close()
        return jsonify({"error": "স্টোরি পাওয়া যায়নি"}), 404
    if story["user_id"] != uid:
        conn.close()
        return jsonify({"error": "শুধু মালিক দেখতে পারবেন"}), 403
    rows = conn.execute("""
        SELECT u.username, u.display_name, u.profile_pic, r.reaction, r.created_at
        FROM story_reactions r JOIN users u ON u.id = r.user_id
        WHERE r.story_id=?
        ORDER BY r.created_at DESC LIMIT 200
    """, (sid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/stories/<int:sid>", methods=["DELETE"])
@login_required
def delete_story(sid):
    conn = db()
    row = conn.execute("SELECT user_id FROM stories WHERE id=?", (sid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "স্টোরি পাওয়া যায়নি"}), 404
    if row["user_id"] != session["user_id"]:
        conn.close()
        return jsonify({"error": "এটা আপনার স্টোরি নয়"}), 403
    # S17.1 — capture media path
    story_media = conn.execute("SELECT media FROM stories WHERE id=?", (sid,)).fetchone()
    media_path = story_media["media"] if story_media else None
    conn.execute("DELETE FROM story_views WHERE story_id=?", (sid,))
    conn.execute("DELETE FROM stories WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    # S17.1 — delete file
    _delete_upload_file(media_path)
    return jsonify({"ok": True})


@app.route("/api/stories/<int:sid>/viewers")
@login_required
def get_story_viewers(sid):
    uid = session["user_id"]
    conn = db()
    story = conn.execute("SELECT user_id FROM stories WHERE id=?", (sid,)).fetchone()
    if not story:
        conn.close()
        return jsonify({"error": "স্টোরি পাওয়া যায়নি"}), 404
    if story["user_id"] != uid:
        conn.close()
        return jsonify({"error": "শুধু মালিক দেখতে পারবেন"}), 403
    rows = conn.execute("""
        SELECT u.username, u.display_name, u.profile_pic, sv.viewed_at
        FROM story_views sv JOIN users u ON u.id = sv.viewer_id
        WHERE sv.story_id=?
        ORDER BY sv.viewed_at DESC LIMIT 500
    """, (sid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ============================================
# NOTIFICATIONS
# ============================================

@app.route("/api/notifications")
@login_required
def get_notifications():
    """S30.23 — LEFT JOIN instead of correlated subquery."""
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT n.id, n.type, n.post_id, n.is_read, n.created_at,
               u.id AS actor_id, u.username AS actor_username,
               u.display_name AS actor_name, u.profile_pic AS actor_pic,
               p.content AS post_content
        FROM notifications n
        JOIN users u ON u.id = n.actor_id
        LEFT JOIN posts p ON p.id = n.post_id
        WHERE n.user_id=?
        ORDER BY n.created_at DESC LIMIT 100
    """, (uid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/notifications/unread/count")
@login_required
def notif_unread_count():
    uid = session["user_id"]
    conn = db()
    row = conn.execute("SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND is_read=0",
                       (uid,)).fetchone()
    conn.close()
    return jsonify({"count": row["c"]})


@app.route("/api/notifications/<int:nid>/read", methods=["POST"])
@login_required
def notif_mark_one_read(nid):
    conn = db()
    conn.execute("UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?",
                 (nid, session["user_id"]))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/notifications/read-all", methods=["POST"])
@login_required
def notif_read_all():
    conn = db()
    conn.execute("UPDATE notifications SET is_read=1 WHERE user_id=?", (session["user_id"],))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ============================================
# REELS
# ============================================

@app.route("/api/reels")
@login_required
def get_reels():
    """S30.23 — batched likes/saves (was: 4 correlated subqueries per row)."""
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT r.id, r.user_id, r.video, r.caption, r.created_at,
               u.username, u.display_name, u.profile_pic
        FROM reels r JOIN users u ON u.id = r.user_id
        WHERE r.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND r.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
        ORDER BY r.created_at DESC LIMIT 50
    """, (uid, uid)).fetchall()

    reel_ids = [r["id"] for r in rows]

    # batch: like counts per reel
    like_counts = {}
    my_likes = set()
    comment_counts = {}
    my_saves = set()
    if reel_ids:
        ph = ",".join("?" * len(reel_ids))
        for rr in conn.execute(
            f"SELECT reel_id, COUNT(*) AS c FROM reel_likes WHERE reel_id IN ({ph}) GROUP BY reel_id",
            reel_ids
        ).fetchall():
            like_counts[rr["reel_id"]] = rr["c"]
        for rr in conn.execute(
            f"SELECT reel_id FROM reel_likes WHERE user_id=? AND reel_id IN ({ph})",
            [uid] + reel_ids
        ).fetchall():
            my_likes.add(rr["reel_id"])
        for rr in conn.execute(
            f"SELECT reel_id, COUNT(*) AS c FROM reel_comments WHERE reel_id IN ({ph}) GROUP BY reel_id",
            reel_ids
        ).fetchall():
            comment_counts[rr["reel_id"]] = rr["c"]
        for rr in conn.execute(
            f"SELECT reel_id FROM reel_saves WHERE user_id=? AND reel_id IN ({ph})",
            [uid] + reel_ids
        ).fetchall():
            my_saves.add(rr["reel_id"])

    out = []
    for r in rows:
        d = dict(r)
        d["likes"] = like_counts.get(r["id"], 0)
        d["liked"] = 1 if r["id"] in my_likes else 0
        d["comments"] = comment_counts.get(r["id"], 0)
        d["is_saved"] = 1 if r["id"] in my_saves else 0
        out.append(d)
    conn.close()
    return jsonify(out)
@app.route("/api/reels", methods=["POST"])
@login_required
@rate_limit("reel", 10, 86400)
def create_reel():
    _blk = _is_public_action_blocked_for_admin()
    if _blk: return _blk
    data = request.json or {}
    video = (data.get("video") or "").strip()
    caption = (data.get("caption") or "").strip()[:300]
    if not video or not video.startswith("data:video/"):
        return jsonify({"error": "ভিডিও দিতে হবে"}), 400
    if len(video) > 8_000_000:
        return jsonify({"error": "ভিডিও অনেক বড় (৫ MB এর নিচে)"}), 400
    # S17.1 — save to filesystem
    saved = _save_data_uri(video, "reels", prefix=f"u{session['user_id']}_")
    if not saved:
        return jsonify({"error": "ভিডিও সংরক্ষণ করা যায়নি"}), 500
    conn = db()
    cur = conn.execute("INSERT INTO reels (user_id, video, caption) VALUES (?,?,?)",
                       (session["user_id"], saved, caption))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": cur.lastrowid})


@app.route("/api/reels/<int:rid>", methods=["DELETE"])
@login_required
def delete_reel(rid):
    conn = db()
    row = conn.execute("SELECT user_id FROM reels WHERE id=?", (rid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "রিল পাওয়া যায়নি"}), 404
    if row["user_id"] != session["user_id"]:
        conn.close()
        return jsonify({"error": "এটা আপনার রিল নয়"}), 403
    # S17.1 — capture media path
    reel_video = conn.execute("SELECT video FROM reels WHERE id=?", (rid,)).fetchone()
    video_path = reel_video["video"] if reel_video else None
    conn.execute("DELETE FROM reel_likes WHERE reel_id=?", (rid,))
    conn.execute("DELETE FROM reel_comments WHERE reel_id=?", (rid,))
    conn.execute("DELETE FROM reels WHERE id=?", (rid,))
    conn.commit()
    conn.close()
    # S17.1 — delete file
    _delete_upload_file(video_path)
    return jsonify({"ok": True})


@app.route("/api/reels/<int:rid>/save", methods=["POST"])
@login_required
def toggle_reel_save(rid):
    """S21.2 — save/unsave a reel."""
    uid = session["user_id"]
    conn = db()
    reel = conn.execute("SELECT 1 FROM reels WHERE id=?", (rid,)).fetchone()
    if not reel:
        conn.close()
        return jsonify({"error": "রিল পাওয়া যায়নি"}), 404
    exists = conn.execute("SELECT 1 FROM reel_saves WHERE user_id=? AND reel_id=?",
                          (uid, rid)).fetchone()
    if exists:
        conn.execute("DELETE FROM reel_saves WHERE user_id=? AND reel_id=?", (uid, rid))
        saved = False
    else:
        conn.execute("INSERT INTO reel_saves (user_id, reel_id) VALUES (?,?)", (uid, rid))
        saved = True
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "saved": saved})


@app.route("/api/reels/<int:rid>/like", methods=["POST"])
@login_required
def toggle_reel_like(rid):
    _blk = _is_public_action_blocked_for_admin()
    if _blk: return _blk
    uid = session["user_id"]
    conn = db()
    # S22 batch — reel existence + block
    rr = conn.execute("SELECT user_id FROM reels WHERE id=?", (rid,)).fetchone()
    if not rr:
        conn.close()
        return jsonify({"error": "রিল পাওয়া যায়নি"}), 404
    if rr["user_id"] != uid:
        _bid = rr["user_id"]
        _bc = conn.execute("""SELECT 1 FROM blocks
            WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)
            LIMIT 1""", (uid, _bid, _bid, uid)).fetchone()
        if _bc:
            conn.close()
            return jsonify({"error": "রিল পাওয়া যায়নি"}), 404
    exists = conn.execute("SELECT 1 FROM reel_likes WHERE user_id=? AND reel_id=?",
                          (uid, rid)).fetchone()
    if exists:
        conn.execute("DELETE FROM reel_likes WHERE user_id=? AND reel_id=?", (uid, rid))
        liked = False
    else:
        conn.execute("INSERT INTO reel_likes (user_id, reel_id) VALUES (?,?)", (uid, rid))
        liked = True
    conn.commit()
    count = conn.execute("SELECT COUNT(*) AS c FROM reel_likes WHERE reel_id=?",
                         (rid,)).fetchone()["c"]
    conn.close()
    return jsonify({"ok": True, "liked": liked, "likes": count})


@app.route("/api/reels/<int:rid>/comments")
@login_required
def get_reel_comments(rid):
    conn = db()
    rows = conn.execute("""SELECT c.id, c.content, c.created_at,
        u.username, u.display_name, u.profile_pic
        FROM reel_comments c JOIN users u ON u.id = c.user_id
        WHERE c.reel_id=? ORDER BY c.created_at ASC""", (rid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/reels/<int:rid>/comments", methods=["POST"])
@login_required
def add_reel_comment(rid):
    _blk = _is_public_action_blocked_for_admin()
    if _blk: return _blk
    content = (request.json.get("content") or "").strip()
    if not content:
        return jsonify({"error": "খালি কমেন্ট নয়"}), 400
    if len(content) > 2_000:
        return jsonify({"error": "কমেন্ট ২,০০০ অক্ষরের বেশি হতে পারবে না"}), 400
    uid = session["user_id"]
    conn = db()
    # S22 batch-2 — reel existence + block
    rr = conn.execute("SELECT user_id FROM reels WHERE id=?", (rid,)).fetchone()
    if not rr:
        conn.close()
        return jsonify({"error": "রিল পাওয়া যায়নি"}), 404
    if rr["user_id"] != uid:
        _bid = rr["user_id"]
        _bc = conn.execute("""SELECT 1 FROM blocks
            WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)
            LIMIT 1""", (uid, _bid, _bid, uid)).fetchone()
        if _bc:
            conn.close()
            return jsonify({"error": "রিল পাওয়া যায়নি"}), 404
    conn.execute("INSERT INTO reel_comments (reel_id, user_id, content) VALUES (?,?,?)",
                 (rid, uid, content))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ============================================

# Initialize DB at import time so gunicorn/waitress also work
init_db()
_ensure_performance_indexes()   # S39 Phase 2A — indexes
_run_startup_migrations()   # S27B hotfix — ensure all columns exist
_ensure_upload_dirs()   # S17.1 — create upload folders
_load_state()           # S17.2p — restore rate-limit buckets
_start_state_persister()  # S17.2p — save every 60s + on exit
_enforce_sole_admin()
_bootstrap_admin_if_missing()   # S22 / Series 11 — auto-create admin
    # S30.25 — hygiene call moved to end of file (was here, before def)


# ============================================
# S38 — AI-style reel recommendation
# ============================================
# Content-based classifier + user preference learner.
# Each reel caption is classified into one or more of 16 categories
# using weighted keyword matching. The user's engagement history
# (likes × 1, comments × 2, saves × 3) trains a per-category
# affinity profile. Reels that match the user's top categories are
# ranked higher in the feed.

_REEL_CATEGORY_KEYWORDS = {
    "comedy":     ["হাসি","মজা","কৌতুক","ঠাট্টা","হাস্য","funny","joke","lol","comedy","haha","meme","রম্য","হাসির"],
    "food":       ["খাবার","রান্না","খাওয়া","স্বাদ","রেসিপি","food","recipe","cook","khabar","ranna","eat","tasty","biryani","biriyani","রেস্টুরেন্ট","restaurant","স্ট্রিট ফুড","street food"],
    "travel":     ["ভ্রমণ","ঘুরা","ভ্রমন","tour","travel","journey","trip","tourist","পাহাড়","সমুদ্র","beach","mountain","নদী"],
    "nature":     ["প্রকৃতি","nature","গাছ","ফুল","পাখি","river","sky","আকাশ","sunset","sunrise","cloud","বৃষ্টি","rain","forest","বন","সমুদ্র"],
    "music":      ["গান","গীত","music","song","singer","গায়ক","গায়িকা","melody","beat","গিটার","guitar","piano","বাঁশি"],
    "dance":      ["নাচ","dance","dancing","নৃত্য","choreography","dance cover"],
    "fashion":    ["ফ্যাশন","fashion","style","outfit","dress","শাড়ি","saree","kurti","makeup","মেকআপ","trend"],
    "sports":     ["খেলা","sports","football","cricket","ক্রিকেট","ফুটবল","game","match","খেলোয়াড়","player","bat","ball"],
    "tech":       ["টেক","tech","coding","computer","mobile","software","programming","developer","app","gadget","রোবট","এআই"],
    "education":  ["শিক্ষা","education","learn","শিখা","study","পড়া","পরীক্ষা","exam","math","গণিত","science","বিজ্ঞান","ক্লাস"],
    "motivation": ["মোটিভেশন","motivation","inspire","উৎসাহ","প্রেরণা","সাফল্য","success","goal","লক্ষ্য","স্বপ্ন","dream"],
    "art":        ["আর্ট","art","drawing","painting","design","ছবি আঁকা","craft","হাতের কাজ","DIY","handmade","sketch"],
    "animals":    ["প্রাণী","animals","পশু","পাখি","বিড়াল","কুকুর","cat","dog","bird","tiger","lion","elephant","মাছ","fish"],
    "lifestyle":  ["জীবন","lifestyle","daily","routine","morning","সকাল","habit","ভ্লগ","vlog"],
    "family":     ["পরিবার","family","বাবা","মা","সন্তান","kid","child","baby","ভাই","বোন","wedding","বিয়ে","birthday"],
    "love":       ["ভালোবাসা","love","প্রেম","romance","romantic","couple","প্রেমিক","প্রেমিকা"],
}


def _classify_reel_caption(caption):
    """Return {category: hit_count} for a reel caption.

    S38 — keyword-based multi-label classifier. Matches Bengali and
    English tokens. A caption can belong to multiple categories.
    """
    if not caption or not isinstance(caption, str):
        return {}
    text = caption.lower()
    hits = {}
    for cat, kws in _REEL_CATEGORY_KEYWORDS.items():
        c = 0
        for kw in kws:
            if kw in text:
                c += 1
        if c > 0:
            hits[cat] = c
    return hits


def _user_reel_category_affinity(uid, conn):
    """Return {category: score} learned from the user's engagement.

    S38 — weighting:
        like    = 1 point per category hit
        comment = 2 points per category hit
        save    = 3 points per category hit (strongest signal)
    """
    aff = {}

    # likes × 1
    for r in conn.execute("""
        SELECT r.caption FROM reel_likes rl
        JOIN reels r ON r.id = rl.reel_id
        WHERE rl.user_id=?
    """, (uid,)).fetchall():
        for cat, hit in _classify_reel_caption(r["caption"]).items():
            aff[cat] = aff.get(cat, 0) + hit * 1

    # comments × 2
    for r in conn.execute("""
        SELECT r.caption FROM reel_comments rc
        JOIN reels r ON r.id = rc.reel_id
        WHERE rc.user_id=?
    """, (uid,)).fetchall():
        for cat, hit in _classify_reel_caption(r["caption"]).items():
            aff[cat] = aff.get(cat, 0) + hit * 2

    # saves × 3
    for r in conn.execute("""
        SELECT r.caption FROM reel_saves rs
        JOIN reels r ON r.id = rs.reel_id
        WHERE rs.user_id=?
    """, (uid,)).fetchall():
        for cat, hit in _classify_reel_caption(r["caption"]).items():
            aff[cat] = aff.get(cat, 0) + hit * 3

    return aff


@app.route("/api/reels/suggested")
@login_required
def reels_suggested():
    """S38 — AI-style reel feed.

    Content-based classification + per-user preference learning.

    Scoring (per candidate reel):
      ┌────────────────────────────────────────────────────────┐
      │ category match  ×  120   ← DOMINANT (from user profile) │
      │ keyword affinity ×   3   ← fallback if no category hit  │
      │ log(likes+1)    ×   4   ← popularity                    │
      │ log(comments+1) ×   6   ← engagement                    │
      │ recency bonus  +30/+15/+5                              │
      │ already liked   −   4                                   │
      │ already saved   +   6                                   │
      │ own reel        × 0.3                                   │
      └────────────────────────────────────────────────────────┘

    Cold start: if the user has no learned affinity, the feed falls
    back to popularity + freshness (like a discover page).
    """
    # S30.23 — 45s per-user cache (AI scoring loop is heavy)
    import time as _t
    _cnow = _t.time()
    _uid_c = session.get("user_id")
    _c = getattr(reels_suggested, "_cache", {})
    _hit = _c.get(_uid_c)
    if _hit and (_cnow - _hit["at"]) < 45:
        return jsonify(_hit["data"])

    import math as _math
    import datetime as _dt

    uid = session["user_id"]
    limit = min(int(request.args.get("limit") or 50), 100)
    conn = db()

    # ---------- 1. Candidates ----------
    rows = conn.execute("""
        SELECT r.id, r.user_id, r.video, r.caption, r.created_at,
               u.username, u.display_name, u.profile_pic,
               (SELECT COUNT(*) FROM reel_likes    WHERE reel_id=r.id) AS likes,
               (SELECT COUNT(*) FROM reel_comments WHERE reel_id=r.id) AS comments,
               (SELECT COUNT(*) FROM reel_likes WHERE reel_id=r.id AND user_id=?) AS i_liked,
               (SELECT COUNT(*) FROM reel_saves WHERE reel_id=r.id AND user_id=?) AS i_saved
        FROM reels r JOIN users u ON u.id = r.user_id
        WHERE r.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND r.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
        ORDER BY r.created_at DESC
        LIMIT 300
    """, (uid, uid, uid, uid)).fetchall()

    # ---------- 2. Learned category affinity ----------
    user_aff = _user_reel_category_affinity(uid, conn)
    top_aff = max(user_aff.values()) if user_aff else 0
    has_profile = top_aff > 0

    # ---------- 3. Score each reel ----------
    now_ts = time.time()
    scored = []
    for r in rows:
        score = 0.0

        # ---- Category match (dominant) ----
        reel_cats = _classify_reel_caption(r["caption"])
        if has_profile and reel_cats:
            cat_score = 0.0
            for cat, hit in reel_cats.items():
                if cat in user_aff:
                    # normalized by user's strongest category, so
                    # 1.0 = perfect match with their #1 preference
                    cat_score += (user_aff[cat] / top_aff) * hit
            score += cat_score * 120.0

        # ---- Author affinity (secondary) — reuse learned map ----
        # (kept small so it never beats category preference)
        # skip for now; category signal already dominates

        # ---- Popularity (log-scaled so new creators surface) ----
        likes = r["likes"] or 0
        comments = r["comments"] or 0
        score += _math.log(likes + 1) * 4.0
        score += _math.log(comments + 1) * 6.0

        # ---- Recency ----
        try:
            created = _dt.datetime.strptime((r["created_at"] or "")[:19],
                                            "%Y-%m-%d %H:%M:%S")
            age = now_ts - created.timestamp()
        except Exception:
            age = 86400 * 30
        if age < 3600:            score += 30
        elif age < 86400:         score += 15
        elif age < 86400 * 7:     score += 5

        # ---- Interaction memory ----
        if r["i_liked"]:
            score -= 4.0
        if r["i_saved"]:
            score += 6.0

        # ---- Own reels: dampen ----
        if r["user_id"] == uid:
            score *= 0.3

        scored.append((score, r, reel_cats))

    scored.sort(key=lambda x: x[0], reverse=True)
    conn.close()

    out = []
    for _score, r, cats in scored[:limit]:
        d = dict(r)
        # expose categories to the client (optional, useful for UI)
        d["categories"] = list(cats.keys()) if cats else []
        out.append(d)
    if not hasattr(reels_suggested, "_cache"):
        reels_suggested._cache = {}
    reels_suggested._cache[_uid_c] = {"at": _cnow, "data": out}
    return jsonify(out)




# ============================================
# Batch 1 — Follow Requests endpoints
# ============================================
@app.route("/api/me/follow-requests")
@login_required
def my_follow_requests():
    """List pending follow requests for the current user."""
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT f.follower_id AS user_id, f.created_at,
               u.username, u.display_name, u.profile_pic
        FROM follows f JOIN users u ON u.id = f.follower_id
        WHERE f.following_id=? AND COALESCE(f.status,'accepted')='pending'
        ORDER BY f.created_at DESC
        LIMIT 100
    """, (uid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/me/follow-requests/count")
@login_required
def my_follow_requests_count():
    uid = session["user_id"]
    conn = db()
    n = conn.execute("""
        SELECT COUNT(*) AS c FROM follows
        WHERE following_id=? AND COALESCE(status,'accepted')='pending'
    """, (uid,)).fetchone()["c"]
    conn.close()
    return jsonify({"count": n})


@app.route("/api/me/follow-requests/<int:follower_id>/accept", methods=["POST"])
@login_required
def accept_follow_request(follower_id):
    uid = session["user_id"]
    conn = db()
    row = conn.execute("""
        SELECT 1 FROM follows
        WHERE follower_id=? AND following_id=?
          AND COALESCE(status,'accepted')='pending'
    """, (follower_id, uid)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "অনুরোধ পাওয়া যায়নি"}), 404
    conn.execute("""
        UPDATE follows SET status='accepted'
        WHERE follower_id=? AND following_id=?
    """, (follower_id, uid))
    # notify requester
    try:
        conn.execute("""
            INSERT INTO notifications (user_id, actor_id, type)
            VALUES (?,?, 'follow_accepted')
        """, (follower_id, uid))
    except Exception:
        pass
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/me/follow-requests/<int:follower_id>/reject", methods=["POST"])
@login_required
def reject_follow_request(follower_id):
    uid = session["user_id"]
    conn = db()
    conn.execute("""
        DELETE FROM follows
        WHERE follower_id=? AND following_id=?
          AND COALESCE(status,'accepted')='pending'
    """, (follower_id, uid))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})




# ============================================
# Batch 2 — Profile buttons 11-20 endpoints
# ============================================

@app.route("/api/me/followers/<int:follower_id>/remove", methods=["POST"])
@login_required
def remove_my_follower(follower_id):
    """12. Remove a follower."""
    uid = session["user_id"]
    conn = db()
    conn.execute("DELETE FROM follows WHERE follower_id=? AND following_id=?",
                 (follower_id, uid))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/users/<username>/close-friend", methods=["POST"])
@login_required
def toggle_close_friend(username):
    """15. Add / remove user from Close Friends list."""
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    oid = other["id"]
    row = conn.execute(
        "SELECT is_close FROM follows WHERE follower_id=? AND following_id=?",
        (uid, oid)
    ).fetchone()
    if row:
        new_val = 0 if row["is_close"] else 1
        conn.execute(
            "UPDATE follows SET is_close=? WHERE follower_id=? AND following_id=?",
            (new_val, uid, oid)
        )
    else:
        # not following → create with close=1
        conn.execute(
            "INSERT INTO follows (follower_id, following_id, status, is_close) "
            "VALUES (?,?, 'accepted', 1)",
            (uid, oid)
        )
        new_val = 1
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "is_close": bool(new_val)})


@app.route("/api/users/<username>/favorite", methods=["POST"])
@login_required
def toggle_favorite(username):
    """16. Add / remove user from Favorites."""
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    oid = other["id"]
    row = conn.execute(
        "SELECT is_favorite FROM follows WHERE follower_id=? AND following_id=?",
        (uid, oid)
    ).fetchone()
    if row:
        new_val = 0 if row["is_favorite"] else 1
        conn.execute(
            "UPDATE follows SET is_favorite=? WHERE follower_id=? AND following_id=?",
            (new_val, uid, oid)
        )
    else:
        conn.execute(
            "INSERT INTO follows (follower_id, following_id, status, is_favorite) "
            "VALUES (?,?, 'accepted', 1)",
            (uid, oid)
        )
        new_val = 1
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "is_favorite": bool(new_val)})


@app.route("/api/me/close-friends")
@login_required
def list_close_friends():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT u.id AS user_id, u.username, u.display_name, u.profile_pic
        FROM follows f JOIN users u ON u.id = f.following_id
        WHERE f.follower_id=? AND COALESCE(f.is_close,0)=1
        ORDER BY f.created_at DESC
        LIMIT 200
    """, (uid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/me/favorites")
@login_required
def list_favorites():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT u.id AS user_id, u.username, u.display_name, u.profile_pic
        FROM follows f JOIN users u ON u.id = f.following_id
        WHERE f.follower_id=? AND COALESCE(f.is_favorite,0)=1
        ORDER BY f.created_at DESC
        LIMIT 200
    """, (uid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/me/following-list")
@login_required
def list_my_following():
    """Full following list (used by Favorites/Close-friends sheet to add)."""
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT u.id AS user_id, u.username, u.display_name, u.profile_pic,
               COALESCE(f.is_close,0)     AS is_close,
               COALESCE(f.is_favorite,0)  AS is_favorite
        FROM follows f JOIN users u ON u.id = f.following_id
        WHERE f.follower_id=? AND COALESCE(f.status,'accepted')='accepted'
        ORDER BY u.display_name COLLATE NOCASE
        LIMIT 500
    """, (uid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/messages/request/send", methods=["POST"])
@login_required
@rate_limit("msg_request", 20, 3600)
def send_message_request():
    """19. Send a message request (unverified recipient)."""
    uid = session["user_id"]
    d = request.json or {}
    username = (d.get("username") or "").strip().lower()
    content = (d.get("content") or "").strip()
    if not username or not content:
        return jsonify({"error": "সব তথ্য দিন"}), 400
    if len(content) > 1000:
        return jsonify({"error": "মেসেজ বড়"}), 400

    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    oid = other["id"]
    if oid == uid:
        conn.close()
        return jsonify({"error": "নিজেকে নয়"}), 400

    # already following? then no need for a request
    is_following = conn.execute(
        "SELECT 1 FROM follows WHERE follower_id=? AND following_id=? "
        "AND COALESCE(status,'accepted')='accepted'",
        (oid, uid)  # is recipient following me?
    ).fetchone()

    if is_following:
        conn.close()
        return jsonify({"ok": True, "delivered": True, "info": "already_accepted"})

    try:
        conn.execute(
            "INSERT INTO message_requests (sender_id, receiver_id, content, status) "
            "VALUES (?,?,?, 'pending') "
            "ON CONFLICT(sender_id, receiver_id) DO UPDATE SET "
            "content=excluded.content, status='pending', "
            "created_at=CURRENT_TIMESTAMP",
            (uid, oid, content)
        )
        conn.commit()
    except sqlite3.OperationalError:
        # older SQLite without ON CONFLICT support for this pattern
        conn.execute("DELETE FROM message_requests WHERE sender_id=? AND receiver_id=?",
                     (uid, oid))
        conn.execute(
            "INSERT INTO message_requests (sender_id, receiver_id, content) VALUES (?,?,?)",
            (uid, oid, content)
        )
        conn.commit()
    conn.close()
    return jsonify({"ok": True, "delivered": False})


@app.route("/api/messages/requests")
@login_required
def list_message_requests():
    """18. List pending message requests (received)."""
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT mr.id, mr.sender_id, mr.content, mr.status, mr.created_at,
               u.username, u.display_name, u.profile_pic
        FROM message_requests mr JOIN users u ON u.id = mr.sender_id
        WHERE mr.receiver_id=? AND mr.status='pending'
        ORDER BY mr.created_at DESC
        LIMIT 100
    """, (uid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/messages/requests/count")
@login_required
def message_requests_count():
    uid = session["user_id"]
    conn = db()
    n = conn.execute(
        "SELECT COUNT(*) AS c FROM message_requests "
        "WHERE receiver_id=? AND status='pending'",
        (uid,)
    ).fetchone()["c"]
    conn.close()
    return jsonify({"count": n})


@app.route("/api/messages/requests/<int:req_id>/accept", methods=["POST"])
@login_required
def accept_message_request(req_id):
    uid = session["user_id"]
    conn = db()
    row = conn.execute(
        "SELECT sender_id, content FROM message_requests "
        "WHERE id=? AND receiver_id=? AND status='pending'",
        (req_id, uid)
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "অনুরোধ পাওয়া যায়নি"}), 404
    # deliver into real messages
    conn.execute(
        "INSERT INTO messages (sender_id, receiver_id, content) VALUES (?,?,?)",
        (row["sender_id"], uid, row["content"])
    )
    # accept the request
    conn.execute("UPDATE message_requests SET status='accepted' WHERE id=?", (req_id,))
    # auto-follow back so subsequent messages skip the request flow
    try:
        conn.execute(
            "INSERT OR IGNORE INTO follows (follower_id, following_id, status) "
            "VALUES (?,?, 'accepted')",
            (uid, row["sender_id"])
        )
    except Exception:
        pass
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/messages/requests/<int:req_id>/reject", methods=["POST"])
@login_required
def reject_message_request(req_id):
    uid = session["user_id"]
    conn = db()
    conn.execute(
        "UPDATE message_requests SET status='rejected' "
        "WHERE id=? AND receiver_id=? AND status='pending'",
        (req_id, uid)
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})




# ============================================
# Batch 3 — Save / Notify / Wave endpoints
# ============================================

@app.route("/api/users/<username>/save-profile", methods=["POST"])
@login_required
def toggle_save_profile(username):
    """29. Bookmark a profile."""
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    oid = other["id"]
    if oid == uid:
        conn.close()
        return jsonify({"error": "নিজের প্রোফাইল সেভ করা যাবে না"}), 400
    exists = conn.execute(
        "SELECT 1 FROM profile_saves WHERE user_id=? AND target_id=?",
        (uid, oid)
    ).fetchone()
    if exists:
        conn.execute("DELETE FROM profile_saves WHERE user_id=? AND target_id=?", (uid, oid))
        conn.commit(); conn.close()
        return jsonify({"ok": True, "saved": False})
    conn.execute("INSERT INTO profile_saves (user_id, target_id) VALUES (?,?)", (uid, oid))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "saved": True})


@app.route("/api/users/<username>/save-profile/status")
@login_required
def save_profile_status(username):
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"saved": False})
    row = conn.execute(
        "SELECT 1 FROM profile_saves WHERE user_id=? AND target_id=?",
        (uid, other["id"])
    ).fetchone()
    conn.close()
    return jsonify({"saved": bool(row)})


@app.route("/api/me/saved-profiles")
@login_required
def list_saved_profiles():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT u.id AS user_id, u.username, u.display_name, u.profile_pic, ps.created_at
        FROM profile_saves ps JOIN users u ON u.id = ps.target_id
        WHERE ps.user_id=?
        ORDER BY ps.created_at DESC
        LIMIT 200
    """, (uid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/users/<username>/notify", methods=["POST"])
@login_required
def toggle_notify(username):
    """30. Notify bell — get notified on every new post from this user."""
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    oid = other["id"]
    if oid == uid:
        conn.close()
        return jsonify({"error": "নিজের প্রোফাইলে নয়"}), 400
    exists = conn.execute(
        "SELECT 1 FROM profile_notify WHERE user_id=? AND target_id=?",
        (uid, oid)
    ).fetchone()
    if exists:
        conn.execute("DELETE FROM profile_notify WHERE user_id=? AND target_id=?", (uid, oid))
        conn.commit(); conn.close()
        return jsonify({"ok": True, "notify": False})
    conn.execute("INSERT INTO profile_notify (user_id, target_id) VALUES (?,?)", (uid, oid))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "notify": True})


@app.route("/api/users/<username>/notify/status")
@login_required
def notify_status(username):
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"notify": False})
    row = conn.execute(
        "SELECT 1 FROM profile_notify WHERE user_id=? AND target_id=?",
        (uid, other["id"])
    ).fetchone()
    conn.close()
    return jsonify({"notify": bool(row)})


@app.route("/api/users/<username>/wave", methods=["POST"])
@login_required
@rate_limit("wave", 30, 3600)
def send_wave(username):
    """28. Send a quick wave 👋 notification."""
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    oid = other["id"]
    if oid == uid:
        conn.close()
        return jsonify({"error": "নিজেকে wave নয়"}), 400
    # send via messages (light message)
    try:
        conn.execute(
            "INSERT INTO messages (sender_id, receiver_id, content) VALUES (?,?,?)",
            (uid, oid, "👋")
        )
        conn.commit()
    except Exception as e:
        conn.close()
        return jsonify({"error": str(e)}), 500
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/me/save-background-check", methods=["POST"])
@login_required
def save_bg_check():
    """Bulk-check saved + notify states for a profile view (client cache)."""
    uid = session["user_id"]
    d = request.json or {}
    username = (d.get("username") or "").strip().lower()
    if not username:
        return jsonify({"saved": False, "notify": False})
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"saved": False, "notify": False})
    oid = other["id"]
    saved = conn.execute(
        "SELECT 1 FROM profile_saves WHERE user_id=? AND target_id=?",
        (uid, oid)
    ).fetchone()
    notify = conn.execute(
        "SELECT 1 FROM profile_notify WHERE user_id=? AND target_id=?",
        (uid, oid)
    ).fetchone()
    conn.close()
    return jsonify({"saved": bool(saved), "notify": bool(notify)})




# ============ Batch 4 — Profile tabs endpoints ============
@app.route("/api/users/<username>/reels-list")
@login_required
def user_reels_list(username):
    """35. Reels tab."""
    uid = session["user_id"]
    conn = db()
    u = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not u:
        conn.close(); return jsonify({"error": "নেই"}), 404
    oid = u["id"]
    if _is_blocked_either_way(uid, oid):
        conn.close(); return jsonify([])
    rows = conn.execute("""
        SELECT r.id, r.video, r.caption, r.created_at
        FROM reels r WHERE r.user_id=?
        ORDER BY r.created_at DESC LIMIT 100
    """, (oid,)).fetchall()
    # S30.26 — batch counts
    rids = [r["id"] for r in rows]
    lk = {}
    cm = {}
    if rids:
        ph = ",".join("?" * len(rids))
        for rr in conn.execute(
            f"SELECT reel_id, COUNT(*) AS c FROM reel_likes WHERE reel_id IN ({ph}) GROUP BY reel_id",
            rids
        ).fetchall():
            lk[rr["reel_id"]] = rr["c"]
        for rr in conn.execute(
            f"SELECT reel_id, COUNT(*) AS c FROM reel_comments WHERE reel_id IN ({ph}) GROUP BY reel_id",
            rids
        ).fetchall():
            cm[rr["reel_id"]] = rr["c"]
    out = []
    for r in rows:
        d = dict(r)
        d["likes"] = lk.get(r["id"], 0)
        d["comments"] = cm.get(r["id"], 0)
        out.append(d)
    conn.close()
    return jsonify(out)


@app.route("/api/users/<username>/tagged-posts")
@login_required
def user_tagged_posts(username):
    """38. Tagged posts — posts mentioning @username."""
    uid = session["user_id"]
    conn = db()
    u = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not u:
        conn.close(); return jsonify({"error": "নেই"}), 404
    oid = u["id"]
    if _is_blocked_either_way(uid, oid):
        conn.close(); return jsonify([])
    rows = conn.execute("""
        SELECT p.id, p.user_id, p.content, p.created_at,
               u.username, u.display_name, u.profile_pic
        FROM posts p JOIN users u ON u.id = p.user_id
        WHERE p.content LIKE ?
          AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
        ORDER BY p.created_at DESC LIMIT 100
    """, (f"%@{username}%", uid, uid)).fetchall()
    # S30.26 — batch counts
    pids = [r["id"] for r in rows]
    lk = {}
    cm = {}
    if pids:
        ph = ",".join("?" * len(pids))
        for rr in conn.execute(
            f"SELECT post_id, COUNT(*) AS c FROM reactions WHERE post_id IN ({ph}) GROUP BY post_id",
            pids
        ).fetchall():
            lk[rr["post_id"]] = rr["c"]
        for rr in conn.execute(
            f"SELECT post_id, COUNT(*) AS c FROM comments WHERE post_id IN ({ph}) GROUP BY post_id",
            pids
        ).fetchall():
            cm[rr["post_id"]] = rr["c"]
    out = []
    for r in rows:
        d = dict(r)
        d["likes"] = lk.get(r["id"], 0)
        d["comments"] = cm.get(r["id"], 0)
        out.append(d)
    conn.close()
    return jsonify(out)


@app.route("/api/me/liked-posts")
@login_required
def my_liked_posts():
    """39. Own liked posts."""
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT p.id, p.user_id, p.content, p.created_at,
               u.username, u.display_name, u.profile_pic,
               (SELECT COUNT(*) FROM reactions WHERE post_id=p.id) AS likes,
               (SELECT reaction FROM reactions WHERE post_id=p.id AND user_id=?) AS my_reaction,
               (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comments,
               (SELECT COUNT(*) FROM saves    WHERE post_id=p.id AND user_id=?) AS is_saved
        FROM reactions rr JOIN posts p ON p.id = rr.post_id
        JOIN users u ON u.id = p.user_id
        WHERE rr.user_id=?
        ORDER BY rr.created_at DESC LIMIT 200
    """, (uid, uid, uid)).fetchall()
    # S30.24 — batch media
    _pids = [r["id"] for r in rows]
    _mmap = {}
    if _pids:
        _ph = ",".join("?" * len(_pids))
        for _m in conn.execute(
            f"SELECT post_id, media FROM post_media WHERE post_id IN ({_ph}) "
            f"ORDER BY post_id, position ASC",
            _pids
        ).fetchall():
            _mmap.setdefault(_m["post_id"], []).append(_m["media"])
    out = []
    for r in rows:
        d = dict(r)
        d["media"] = _mmap.get(r["id"], [])
        out.append(d)
    conn.close()
    return jsonify(out)


@app.route("/api/me/saved-posts")
@login_required
def my_saved_posts():
    """40. Own saved posts."""
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT p.id, p.user_id, p.content, p.created_at,
               u.username, u.display_name, u.profile_pic,
               (SELECT COUNT(*) FROM reactions WHERE post_id=p.id) AS likes,
               (SELECT reaction FROM reactions WHERE post_id=p.id AND user_id=?) AS my_reaction,
               (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comments,
               1 AS is_saved
        FROM saves s JOIN posts p ON p.id = s.post_id
        JOIN users u ON u.id = p.user_id
        WHERE s.user_id=?
        ORDER BY s.created_at DESC LIMIT 200
    """, (uid, uid)).fetchall()
    # S30.24 — batch media
    _pids = [r["id"] for r in rows]
    _mmap = {}
    if _pids:
        _ph = ",".join("?" * len(_pids))
        for _m in conn.execute(
            f"SELECT post_id, media FROM post_media WHERE post_id IN ({_ph}) "
            f"ORDER BY post_id, position ASC",
            _pids
        ).fetchall():
            _mmap.setdefault(_m["post_id"], []).append(_m["media"])
    out = []
    for r in rows:
        d = dict(r)
        d["media"] = _mmap.get(r["id"], [])
        out.append(d)
    conn.close()
    return jsonify(out)




# ============ Batch 5 — Reposts / Archive / Pin / Highlights ============
@app.route("/api/users/<username>/reposts-list")
@login_required
def user_reposts_list(username):
    """41. Reposts tab."""
    uid = session["user_id"]
    conn = db()
    u = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not u: conn.close(); return jsonify([])
    oid = u["id"]
    rows = conn.execute("""
        SELECT p.id, p.user_id, p.content, p.created_at,
               u2.username, u2.display_name, u2.profile_pic,
               rp.created_at AS reposted_at
        FROM reposts rp JOIN posts p ON p.id = rp.post_id
        JOIN users u2 ON u2.id = p.user_id
        WHERE rp.user_id=?
        ORDER BY rp.created_at DESC LIMIT 100
    """, (oid,)).fetchall()
    # S30.26 — batch counts
    pids = [r["id"] for r in rows]
    lk = {}
    cm = {}
    if pids:
        ph = ",".join("?" * len(pids))
        for rr in conn.execute(
            f"SELECT post_id, COUNT(*) AS c FROM reactions WHERE post_id IN ({ph}) GROUP BY post_id",
            pids
        ).fetchall():
            lk[rr["post_id"]] = rr["c"]
        for rr in conn.execute(
            f"SELECT post_id, COUNT(*) AS c FROM comments WHERE post_id IN ({ph}) GROUP BY post_id",
            pids
        ).fetchall():
            cm[rr["post_id"]] = rr["c"]
    out = []
    for r in rows:
        d = dict(r)
        d["likes"] = lk.get(r["id"], 0)
        d["comments"] = cm.get(r["id"], 0)
        out.append(d)
    conn.close()
    return jsonify(out)


@app.route("/api/me/archived-posts")
@login_required
def my_archived_posts():
    """42. Archived posts (own only)."""
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT id, content, created_at FROM posts
        WHERE user_id=? AND COALESCE(is_archived,0)=1
        ORDER BY created_at DESC LIMIT 200
    """, (uid,)).fetchall()
    conn.close()
    return jsonify([dict(x) for x in rows])


@app.route("/api/posts/<int:pid>/archive", methods=["POST"])
@login_required
def toggle_archive_post(pid):
    uid = session["user_id"]
    conn = db()
    row = conn.execute("SELECT user_id, COALESCE(is_archived,0) AS a FROM posts WHERE id=?",
                       (pid,)).fetchone()
    if not row or row["user_id"] != uid:
        conn.close(); return jsonify({"error": "নেই"}), 404
    new = 0 if row["a"] else 1
    conn.execute("UPDATE posts SET is_archived=? WHERE id=?", (new, pid))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "archived": bool(new)})


@app.route("/api/posts/<int:pid>/pin", methods=["POST"])
@login_required
def toggle_pin_post(pid):
    """45. Pin post to top of own profile."""
    uid = session["user_id"]
    conn = db()
    row = conn.execute("SELECT user_id FROM posts WHERE id=?", (pid,)).fetchone()
    if not row or row["user_id"] != uid:
        conn.close(); return jsonify({"error": "নেই"}), 404
    cur = conn.execute("SELECT pinned_post_id FROM users WHERE id=?", (uid,)).fetchone()
    pinned = cur["pinned_post_id"] if cur else None
    new = None if pinned == pid else pid
    conn.execute("UPDATE users SET pinned_post_id=? WHERE id=?", (new, uid))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "pinned": bool(new)})


@app.route("/api/users/<username>/highlights")
@login_required
def user_highlights(username):
    """44. Story highlights row."""
    conn = db()
    u = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not u: conn.close(); return jsonify([])
    rows = conn.execute("""
        SELECT id, title, cover, created_at FROM story_highlights
        WHERE user_id=? ORDER BY created_at DESC LIMIT 20
    """, (u["id"],)).fetchall()
    conn.close()
    return jsonify([dict(x) for x in rows])


@app.route("/api/me/highlights/add", methods=["POST"])
@login_required
def add_highlight():
    """Add a highlight (own)."""
    uid = session["user_id"]
    d = request.json or {}
    title = (d.get("title") or "").strip()[:40]
    cover = (d.get("cover") or "").strip()
    if not title or not cover:
        return jsonify({"error": "টাইটেল ও কভার দিন"}), 400
    saved = _save_data_uri(cover, "stories", prefix=f"hl{uid}_")
    if not saved:
        return jsonify({"error": "কভার সেভ হয়নি"}), 500
    conn = db()
    conn.execute("INSERT INTO story_highlights (user_id, title, cover) VALUES (?,?,?)",
                 (uid, title, saved))
    conn.commit(); conn.close()
    return jsonify({"ok": True})


@app.route("/api/users/<username>/similar")
@login_required
def similar_users(username):
    """47. Similar accounts suggestion."""
    uid = session["user_id"]
    conn = db()
    u = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not u: conn.close(); return jsonify([])
    oid = u["id"]
    # people who follow the same authors that this user follows
    rows = conn.execute("""
        SELECT DISTINCT u2.id, u2.username, u2.display_name, u2.profile_pic,
               (SELECT COUNT(*) FROM follows WHERE following_id=u2.id) AS followers
        FROM follows f1
        JOIN follows f2 ON f2.following_id = f1.following_id
        JOIN users u2 ON u2.id = f2.follower_id
        WHERE f1.follower_id = ?
          AND u2.id != ?
          AND u2.id != ?
          AND u2.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND u2.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
          AND COALESCE(u2.is_admin,0)=0
        ORDER BY followers DESC
        LIMIT 6
    """, (oid, uid, oid, uid, uid)).fetchall()
    conn.close()
    return jsonify([dict(x) for x in rows])




# ============ Batch 6 — Mute / Restrict / No-Retweet ============
@app.route("/api/users/<username>/mute", methods=["POST"])
@login_required
def toggle_mute_user(username):
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other: conn.close(); return jsonify({"error": "নেই"}), 404
    oid = other["id"]
    if oid == uid: conn.close(); return jsonify({"error": "নিজেকে নয়"}), 400
    exists = conn.execute("SELECT 1 FROM mutes WHERE user_id=? AND target_id=?",
                          (uid, oid)).fetchone()
    if exists:
        conn.execute("DELETE FROM mutes WHERE user_id=? AND target_id=?", (uid, oid))
        conn.commit(); conn.close()
        return jsonify({"ok": True, "muted": False})
    conn.execute("INSERT INTO mutes (user_id, target_id) VALUES (?,?)", (uid, oid))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "muted": True})


@app.route("/api/users/<username>/mute/status")
@login_required
def mute_status(username):
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other: conn.close(); return jsonify({"muted": False})
    r = conn.execute("SELECT 1 FROM mutes WHERE user_id=? AND target_id=?",
                     (uid, other["id"])).fetchone()
    conn.close()
    return jsonify({"muted": bool(r)})


@app.route("/api/users/<username>/restrict", methods=["POST"])
@login_required
def toggle_restrict_user(username):
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other: conn.close(); return jsonify({"error": "নেই"}), 404
    oid = other["id"]
    if oid == uid: conn.close(); return jsonify({"error": "নিজেকে নয়"}), 400
    exists = conn.execute("SELECT 1 FROM restricts WHERE user_id=? AND target_id=?",
                          (uid, oid)).fetchone()
    if exists:
        conn.execute("DELETE FROM restricts WHERE user_id=? AND target_id=?", (uid, oid))
        conn.commit(); conn.close()
        return jsonify({"ok": True, "restricted": False})
    conn.execute("INSERT INTO restricts (user_id, target_id) VALUES (?,?)", (uid, oid))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "restricted": True})


@app.route("/api/users/<username>/restrict/status")
@login_required
def restrict_status(username):
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other: conn.close(); return jsonify({"restricted": False})
    r = conn.execute("SELECT 1 FROM restricts WHERE user_id=? AND target_id=?",
                     (uid, other["id"])).fetchone()
    conn.close()
    return jsonify({"restricted": bool(r)})


@app.route("/api/users/<username>/no-retweet", methods=["POST"])
@login_required
def toggle_no_retweet(username):
    """51. Turn off retweets from this user."""
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other: conn.close(); return jsonify({"error": "নেই"}), 404
    oid = other["id"]
    if oid == uid: conn.close(); return jsonify({"error": "নিজের নয়"}), 400
    exists = conn.execute("SELECT 1 FROM no_retweets WHERE user_id=? AND target_id=?",
                          (uid, oid)).fetchone()
    if exists:
        conn.execute("DELETE FROM no_retweets WHERE user_id=? AND target_id=?", (uid, oid))
        conn.commit(); conn.close()
        return jsonify({"ok": True, "no_retweet": False})
    conn.execute("INSERT INTO no_retweets (user_id, target_id) VALUES (?,?)", (uid, oid))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "no_retweet": True})


@app.route("/api/users/<username>/no-retweet/status")
@login_required
def no_retweet_status(username):
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other: conn.close(); return jsonify({"no_retweet": False})
    r = conn.execute("SELECT 1 FROM no_retweets WHERE user_id=? AND target_id=?",
                     (uid, other["id"])).fetchone()
    conn.close()
    return jsonify({"no_retweet": bool(r)})


@app.route("/api/me/muted-list")
@login_required
def my_muted_list():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT u.username, u.display_name, u.profile_pic, m.created_at
        FROM mutes m JOIN users u ON u.id = m.target_id
        WHERE m.user_id=? ORDER BY m.created_at DESC LIMIT 200
    """, (uid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])




# ============ Batch 7 — Report / Hide / Snooze / Break ============
@app.route("/api/posts/<int:pid>/hide", methods=["POST"])
@login_required
def hide_post_from_feed(pid):
    """63. Hide a post from your feed."""
    uid = session["user_id"]
    conn = db()
    row = conn.execute("SELECT id FROM posts WHERE id=?", (pid,)).fetchone()
    if not row: conn.close(); return jsonify({"error": "নেই"}), 404
    exists = conn.execute("SELECT 1 FROM hidden_posts WHERE user_id=? AND post_id=?",
                          (uid, pid)).fetchone()
    if exists:
        conn.execute("DELETE FROM hidden_posts WHERE user_id=? AND post_id=?", (uid, pid))
        conn.commit(); conn.close()
        return jsonify({"ok": True, "hidden": False})
    conn.execute("INSERT INTO hidden_posts (user_id, post_id) VALUES (?,?)", (uid, pid))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "hidden": True})


@app.route("/api/users/<username>/snooze", methods=["POST"])
@login_required
def snooze_user(username):
    """64. Snooze a user for N days."""
    uid = session["user_id"]
    d = request.json or {}
    try: days = int(d.get("days") or 30)
    except (ValueError, TypeError): days = 30
    if days < 1 or days > 365: days = 30

    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other: conn.close(); return jsonify({"error": "নেই"}), 404
    oid = other["id"]
    if oid == uid: conn.close(); return jsonify({"error": "নিজেকে নয়"}), 400

    conn.execute("DELETE FROM snoozed_users WHERE user_id=? AND target_id=?", (uid, oid))
    conn.execute(
        "INSERT INTO snoozed_users (user_id, target_id, until_ts) "
        "VALUES (?,?, datetime('now', '+' || ? || ' days'))",
        (uid, oid, days)
    )
    conn.commit(); conn.close()
    return jsonify({"ok": True, "days": days})


@app.route("/api/users/<username>/snooze/status")
@login_required
def snooze_status(username):
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other: conn.close(); return jsonify({"snoozed": False, "days_left": 0})
    r = conn.execute(
        "SELECT until_ts, "
        "(strftime('%s', until_ts) - strftime('%s','now')) / 86400 AS days_left "
        "FROM snoozed_users WHERE user_id=? AND target_id=? AND datetime(until_ts) > datetime('now')",
        (uid, other["id"])
    ).fetchone()
    conn.close()
    if not r: return jsonify({"snoozed": False, "days_left": 0})
    return jsonify({"snoozed": True, "days_left": int(r["days_left"] or 0)})


@app.route("/api/me/snoozed-list")
@login_required
def list_snoozed():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT u.username, u.display_name, u.profile_pic, s.until_ts,
               (strftime('%s', s.until_ts) - strftime('%s','now')) / 86400 AS days_left
        FROM snoozed_users s JOIN users u ON u.id = s.target_id
        WHERE s.user_id=? AND datetime(s.until_ts) > datetime('now')
        ORDER BY s.until_ts ASC LIMIT 100
    """, (uid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/stories/<int:sid>/report", methods=["POST"])
@login_required
@rate_limit("report_story", 10, 3600)
def report_story(sid):
    """62. Report a story."""
    uid = session["user_id"]
    d = request.json or {}
    reason = (d.get("reason") or "").strip()
    notes = (d.get("notes") or "").strip()[:500]
    if reason not in ("spam", "harassment", "violence", "false_info", "other"):
        return jsonify({"error": "কারণ নির্বাচন করুন"}), 400
    conn = db()
    row = conn.execute("SELECT user_id FROM stories WHERE id=?", (sid,)).fetchone()
    if not row: conn.close(); return jsonify({"error": "স্টোরি নেই"}), 404
    owner = row["user_id"]
    if owner == uid: conn.close(); return jsonify({"error": "নিজের নয়"}), 400
    try:
        conn.execute(
            "INSERT INTO story_reports (reporter_id, story_id, story_owner_id, reason, notes) "
            "VALUES (?,?,?,?,?)",
            (uid, sid, owner, reason, notes)
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close(); return jsonify({"error": "আগেই রিপোর্ট করেছেন"}), 400
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/me/take-break", methods=["POST"])
@login_required
def take_break():
    """65. Take a break — clear notifications + return stats."""
    uid = session["user_id"]
    conn = db()
    conn.execute("UPDATE notifications SET is_read=1 WHERE user_id=?", (uid,))
    conn.commit()
    conn.close()
    return jsonify({
        "ok": True,
        "message": "🌿 নোটিফিকেশন ক্লিয়ার করা হয়েছে। নিজের যত্ন নিন।"
    })


@app.route("/api/me/report-imposter", methods=["POST"])
@login_required
@rate_limit("report_imposter", 5, 3600)
def report_imposter():
    """66. Report an imposter account (reports to admin)."""
    uid = session["user_id"]
    d = request.json or {}
    username = (d.get("username") or "").strip().lower()
    notes = (d.get("notes") or "").strip()[:500]
    if not username: return jsonify({"error": "ইউজারনেম দিন"}), 400
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other: conn.close(); return jsonify({"error": "নেই"}), 404
    try:
        conn.execute(
            "INSERT INTO reports (reporter_id, target_type, target_id, reason, notes) "
            "VALUES (?,?,?,?,?)",
            (uid, "user", other["id"], "other", "Imposter: " + notes)
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close(); return jsonify({"error": "আগেই রিপোর্ট করেছেন"}), 400
    conn.close()
    return jsonify({"ok": True})




# ============ Batch 8 — Extended profile fields ============
@app.route("/api/me/profile-extended", methods=["POST"])
@login_required
def update_profile_extended():
    """73-79. Update pronouns, gender, birthday, location, category, links, professional."""
    uid = session["user_id"]
    d = request.json or {}
    fields = {
        "pronouns":      (d.get("pronouns") or "").strip()[:20],
        "gender":        (d.get("gender") or "").strip()[:20],
        "birthday":      (d.get("birthday") or "").strip()[:20],
        "location":      (d.get("location") or "").strip()[:60],
        "category":      (d.get("category") or "").strip()[:40],
        "bio_links":     (d.get("bio_links") or "").strip()[:500],
        "is_professional": 1 if d.get("is_professional") else 0,
    }
    # validate category
    allowed_cat = ("", "creator", "business", "personal", "public_figure", "brand", "community")
    if fields["category"] not in allowed_cat:
        fields["category"] = ""

    conn = db()
    try:
        conn.execute("""
            UPDATE users SET
              pronouns=?, gender=?, birthday=?, location=?, category=?,
              bio_links=?, is_professional=?
            WHERE id=?
        """, (
            fields["pronouns"], fields["gender"], fields["birthday"],
            fields["location"], fields["category"], fields["bio_links"],
            fields["is_professional"], uid
        ))
        conn.commit()
    except Exception as e:
        conn.close()
        return jsonify({"error": str(e)}), 500
    conn.close()
    return jsonify({"ok": True, **fields})


@app.route("/api/me/profile-extended")
@login_required
def get_profile_extended():
    uid = session["user_id"]
    conn = db()
    row = conn.execute("""
        SELECT COALESCE(pronouns,'')     AS pronouns,
               COALESCE(gender,'')        AS gender,
               COALESCE(birthday,'')      AS birthday,
               COALESCE(location,'')      AS location,
               COALESCE(category,'')      AS category,
               COALESCE(bio_links,'')     AS bio_links,
               COALESCE(is_professional,0) AS is_professional
        FROM users WHERE id=?
    """, (uid,)).fetchone()
    conn.close()
    return jsonify(dict(row) if row else {})


@app.route("/api/me/insights")
@login_required
def me_insights():
    """80. Own account analytics."""
    uid = session["user_id"]
    conn = db()
    # post count
    posts = conn.execute("SELECT COUNT(*) AS c FROM posts WHERE user_id=?", (uid,)).fetchone()["c"]
    # engagement totals
    likes_received = conn.execute(
        "SELECT COUNT(*) AS c FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)",
        (uid,)
    ).fetchone()["c"]
    comments_received = conn.execute(
        "SELECT COUNT(*) AS c FROM comments WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)",
        (uid,)
    ).fetchone()["c"]
    # followers gained last 7 days
    new_followers = conn.execute(
        "SELECT COUNT(*) AS c FROM follows WHERE following_id=? "
        "AND datetime(created_at) > datetime('now', '-7 days')",
        (uid,)
    ).fetchone()["c"]
    # profile views (login_history as proxy — approximate)
    profile_views = conn.execute(
        "SELECT COUNT(DISTINCT ip) AS c FROM login_history WHERE user_id=?",
        (uid,)
    ).fetchone()["c"]
    # top post (most likes)
    top = conn.execute("""
        SELECT p.id, p.content,
               (SELECT COUNT(*) FROM reactions WHERE post_id=p.id) AS likes
        FROM posts p WHERE p.user_id=?
        ORDER BY likes DESC LIMIT 1
    """, (uid,)).fetchone()
    top_post = dict(top) if top else None
    # weekly chart (likes on each of last 7 days)
    chart = []
    for i in range(6, -1, -1):
        row = conn.execute("""
            SELECT COUNT(*) AS c FROM reactions
            WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)
              AND date(created_at) = date('now', '-' || ? || ' days')
        """, (uid, i)).fetchone()
        chart.append({"day": i, "count": row["c"] if row else 0})
    conn.close()
    return jsonify({
        "posts": posts,
        "likes_received": likes_received,
        "comments_received": comments_received,
        "new_followers_7d": new_followers,
        "profile_views": profile_views,
        "top_post": top_post,
        "chart": chart,
    })




# ============ Batch 9 — Monetization endpoints ============
@app.route("/api/users/<username>/tip", methods=["POST"])
@login_required
@rate_limit("tip", 20, 3600)
def send_tip(username):
    """87. Send a tip (intent — payment gateway plugs in later)."""
    uid = session["user_id"]
    d = request.json or {}
    try: amount = float(d.get("amount") or 0)
    except (ValueError, TypeError): amount = 0
    note = (d.get("note") or "").strip()[:200]
    if amount < 10 or amount > 100000:
        return jsonify({"error": "পরিমাণ ১০-১,০০,০০০ টাকার মধ্যে দিন"}), 400
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other: conn.close(); return jsonify({"error": "নেই"}), 404
    oid = other["id"]
    if oid == uid: conn.close(); return jsonify({"error": "নিজেকে নয়"}), 400
    conn.execute(
        "INSERT INTO tips (sender_id, receiver_id, amount, note) VALUES (?,?,?,?)",
        (uid, oid, amount, note)
    )
    conn.commit(); conn.close()
    return jsonify({"ok": True, "amount": amount, "status": "pending",
                    "info": "Payment gateway integration pending"})


@app.route("/api/me/tips-sent")
@login_required
def my_tips_sent():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT t.id, t.amount, t.currency, t.note, t.status, t.created_at,
               u.username, u.display_name, u.profile_pic
        FROM tips t JOIN users u ON u.id = t.receiver_id
        WHERE t.sender_id=? ORDER BY t.created_at DESC LIMIT 100
    """, (uid,)).fetchall()
    conn.close()
    return jsonify([dict(x) for x in rows])


@app.route("/api/me/tips-received")
@login_required
def my_tips_received():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT t.id, t.amount, t.currency, t.note, t.status, t.created_at,
               u.username, u.display_name, u.profile_pic
        FROM tips t JOIN users u ON u.id = t.sender_id
        WHERE t.receiver_id=? ORDER BY t.created_at DESC LIMIT 100
    """, (uid,)).fetchall()
    conn.close()
    return jsonify([dict(x) for x in rows])


@app.route("/api/users/<username>/gift", methods=["POST"])
@login_required
@rate_limit("gift", 30, 3600)
def send_gift(username):
    """88. Send a virtual gift (sticker)."""
    uid = session["user_id"]
    d = request.json or {}
    gift_code = (d.get("gift") or "").strip()
    note = (d.get("note") or "").strip()[:100]
    allowed = ("rose", "heart", "star", "cake", "crown", "rocket", "coffee", "fire")
    if gift_code not in allowed:
        return jsonify({"error": "ভুল গিফট"}), 400
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other: conn.close(); return jsonify({"error": "নেই"}), 404
    oid = other["id"]
    if oid == uid: conn.close(); return jsonify({"error": "নিজেকে নয়"}), 400
    conn.execute(
        "INSERT INTO gifts (sender_id, receiver_id, gift_code, note) VALUES (?,?,?,?)",
        (uid, oid, gift_code, note)
    )
    # also drop a DM with the gift
    try:
        conn.execute("INSERT INTO messages (sender_id, receiver_id, content) VALUES (?,?,?)",
                     (uid, oid, "🎁 " + gift_code + (" — " + note if note else "")))
    except Exception:
        pass
    conn.commit(); conn.close()
    return jsonify({"ok": True, "gift": gift_code})


@app.route("/api/users/<username>/appointments", methods=["POST"])
@login_required
def book_appointment(username):
    """89. Book an appointment with a professional."""
    uid = session["user_id"]
    d = request.json or {}
    when = (d.get("datetime") or "").strip()
    dur = int(d.get("duration") or 30)
    note = (d.get("note") or "").strip()[:300]
    if not when:
        return jsonify({"error": "সময় নির্বাচন করুন"}), 400
    if dur < 15 or dur > 180: dur = 30
    conn = db()
    other = conn.execute("SELECT id, COALESCE(is_professional,0) AS p FROM users WHERE username=?",
                         (username,)).fetchone()
    if not other: conn.close(); return jsonify({"error": "নেই"}), 404
    if not other["p"]:
        conn.close(); return jsonify({"error": "এই অ্যাকাউন্ট professional নয়"}), 400
    oid = other["id"]
    if oid == uid: conn.close(); return jsonify({"error": "নিজেকে নয়"}), 400
    conn.execute(
        "INSERT INTO appointments (user_id, booker_id, datetime_slot, duration_mins, note) "
        "VALUES (?,?,?,?,?)",
        (oid, uid, when, dur, note)
    )
    conn.commit(); conn.close()
    return jsonify({"ok": True})


@app.route("/api/me/appointments")
@login_required
def my_appointments():
    uid = session["user_id"]
    conn = db()
    as_provider = conn.execute("""
        SELECT a.id, a.datetime_slot, a.duration_mins, a.note, a.status, a.created_at,
               u.username, u.display_name, u.profile_pic,
               'provider' AS role
        FROM appointments a JOIN users u ON u.id = a.booker_id
        WHERE a.user_id=? ORDER BY a.datetime_slot DESC LIMIT 100
    """, (uid,)).fetchall()
    as_booker = conn.execute("""
        SELECT a.id, a.datetime_slot, a.duration_mins, a.note, a.status, a.created_at,
               u.username, u.display_name, u.profile_pic,
               'booker' AS role
        FROM appointments a JOIN users u ON u.id = a.user_id
        WHERE a.booker_id=? ORDER BY a.datetime_slot DESC LIMIT 100
    """, (uid,)).fetchall()
    conn.close()
    return jsonify({
        "as_provider": [dict(x) for x in as_provider],
        "as_booker": [dict(x) for x in as_booker],
    })


@app.route("/api/users/<username>/shop", methods=["GET", "POST"])
@login_required
def user_shop(username):
    """82. Shop — list / add products (professional only)."""
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id, COALESCE(is_professional,0) AS p FROM users WHERE username=?",
                         (username,)).fetchone()
    if not other: conn.close(); return jsonify({"error": "নেই"}), 404
    oid = other["id"]

    if request.method == "GET":
        rows = conn.execute("""
            SELECT id, title, price, currency, image, description
            FROM shop_products
            WHERE user_id=? AND is_active=1
            ORDER BY created_at DESC LIMIT 100
        """, (oid,)).fetchall()
        conn.close()
        return jsonify([dict(x) for x in rows])

    # POST — add product (only self + professional)
    if oid != uid:
        conn.close(); return jsonify({"error": "শুধু নিজের শপ"}), 403
    if not other["p"]:
        conn.close(); return jsonify({"error": "Professional নয়"}), 400

    d = request.json or {}
    title = (d.get("title") or "").strip()[:100]
    try: price = float(d.get("price") or 0)
    except (ValueError, TypeError): price = 0
    image = (d.get("image") or "").strip()
    desc = (d.get("description") or "").strip()[:500]
    if not title or price < 0:
        conn.close(); return jsonify({"error": "টাইটেল ও দাম দিন"}), 400
    saved = _save_data_uri(image, "posts", prefix=f"shop{uid}_") if image else None
    cur = conn.execute(
        "INSERT INTO shop_products (user_id, title, price, image, description) VALUES (?,?,?,?,?)",
        (uid, title, price, saved, desc)
    )
    pid = cur.lastrowid
    conn.commit(); conn.close()
    return jsonify({"ok": True, "id": pid})


@app.route("/api/shop/products/<int:pid>/buy", methods=["POST"])
@login_required
def buy_product(pid):
    """90. Buy product."""
    uid = session["user_id"]
    d = request.json or {}
    note = (d.get("note") or "").strip()[:200]
    conn = db()
    p = conn.execute("SELECT id, user_id, price FROM shop_products WHERE id=? AND is_active=1",
                     (pid,)).fetchone()
    if not p: conn.close(); return jsonify({"error": "পণ্য নেই"}), 404
    if p["user_id"] == uid:
        conn.close(); return jsonify({"error": "নিজের পণ্য নয়"}), 400
    conn.execute(
        "INSERT INTO product_orders (product_id, buyer_id, seller_id, amount, note) "
        "VALUES (?,?,?,?,?)",
        (pid, uid, p["user_id"], p["price"], note)
    )
    conn.commit(); conn.close()
    return jsonify({"ok": True, "amount": p["price"], "status": "pending"})


@app.route("/api/posts/<int:pid>/boost", methods=["POST"])
@login_required
def boost_post(pid):
    """81. Boost a post."""
    uid = session["user_id"]
    d = request.json or {}
    try: budget = float(d.get("budget") or 0)
    except (ValueError, TypeError): budget = 0
    try: days = int(d.get("days") or 0)
    except (ValueError, TypeError): days = 0
    if budget < 50 or budget > 50000:
        return jsonify({"error": "বাজেট ৫০-৫০,০০০ টাকা"}), 400
    if days not in (1, 3, 7, 14, 30):
        return jsonify({"error": "দিন ১/৩/৭/১৪/৩০ দিন"}), 400
    conn = db()
    p = conn.execute("SELECT user_id FROM posts WHERE id=?", (pid,)).fetchone()
    if not p or p["user_id"] != uid:
        conn.close(); return jsonify({"error": "শুধু নিজের পোস্ট"}), 403
    conn.execute(
        "INSERT INTO boosts (user_id, post_id, budget, duration_days) VALUES (?,?,?,?)",
        (uid, pid, budget, days)
    )
    conn.commit(); conn.close()
    return jsonify({"ok": True, "status": "pending"})


@app.route("/api/me/gifts")
@login_required
def my_gifts():
    uid = session["user_id"]
    conn = db()
    received = conn.execute("""
        SELECT g.id, g.gift_code, g.note, g.status, g.created_at,
               u.username, u.display_name, u.profile_pic
        FROM gifts g JOIN users u ON u.id = g.sender_id
        WHERE g.receiver_id=? ORDER BY g.created_at DESC LIMIT 100
    """, (uid,)).fetchall()
    conn.close()
    return jsonify({"received": [dict(x) for x in received]})




# ============ Batch 10 — Subscription / Verify / Claim / Reports ============
@app.route("/api/users/<username>/subscribe", methods=["POST"])
@login_required
def subscribe_creator(username):
    """91. Subscribe to a creator (paid tier — intent)."""
    uid = session["user_id"]
    d = request.json or {}
    tier = (d.get("tier") or "basic").strip()
    if tier not in ("basic", "premium", "vip"): tier = "basic"
    price = {"basic": 99, "premium": 299, "vip": 999}.get(tier, 99)
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other: conn.close(); return jsonify({"error": "নেই"}), 404
    oid = other["id"]
    if oid == uid: conn.close(); return jsonify({"error": "নিজেকে নয়"}), 400
    try:
        conn.execute("""
            INSERT INTO subscriptions (subscriber_id, creator_id, tier, amount, until_ts)
            VALUES (?,?,?,?, datetime('now','+30 days'))
            ON CONFLICT(subscriber_id, creator_id) DO UPDATE SET
              tier=excluded.tier, amount=excluded.amount, status='active',
              started_at=CURRENT_TIMESTAMP,
              until_ts=datetime('now','+30 days')
        """, (uid, oid, tier, price))
        conn.commit()
    except Exception as e:
        conn.close(); return jsonify({"error": str(e)}), 500
    conn.close()
    return jsonify({"ok": True, "tier": tier, "amount": price,
                    "info": "Payment gateway integration pending"})


@app.route("/api/users/<username>/subscribe/status")
@login_required
def subscribe_status(username):
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other: conn.close(); return jsonify({"subscribed": False})
    r = conn.execute("""
        SELECT tier, until_ts FROM subscriptions
        WHERE subscriber_id=? AND creator_id=? AND status='active'
          AND datetime(until_ts) > datetime('now')
    """, (uid, other["id"])).fetchone()
    conn.close()
    if not r: return jsonify({"subscribed": False})
    return jsonify({"subscribed": True, "tier": r["tier"], "until": r["until_ts"]})


@app.route("/api/me/subscriptions")
@login_required
def my_subscriptions():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT s.id, s.tier, s.amount, s.until_ts, s.status,
               u.username, u.display_name, u.profile_pic
        FROM subscriptions s JOIN users u ON u.id = s.creator_id
        WHERE s.subscriber_id=? AND s.status='active'
          AND datetime(s.until_ts) > datetime('now')
        ORDER BY s.until_ts ASC LIMIT 100
    """, (uid,)).fetchall()
    conn.close()
    return jsonify([dict(x) for x in rows])


@app.route("/api/me/verify-request", methods=["POST"])
@login_required
@rate_limit("verify_req", 3, 86400)
def request_verification():
    """92. Request blue check verification."""
    uid = session["user_id"]
    d = request.json or {}
    full_name = (d.get("full_name") or "").strip()[:80]
    reason = (d.get("reason") or "").strip()[:500]
    id_doc = (d.get("id_doc") or "").strip()  # data URI
    if not full_name or not reason:
        return jsonify({"error": "সব তথ্য দিন"}), 400
    saved_doc = None
    if id_doc and id_doc.startswith("data:"):
        saved_doc = _save_data_uri(id_doc, "posts", prefix=f"verif{uid}_")
    conn = db()
    try:
        conn.execute("""
            INSERT INTO verification_requests (user_id, full_name, id_doc, reason)
            VALUES (?,?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET
              full_name=excluded.full_name, id_doc=excluded.id_doc,
              reason=excluded.reason, status='pending',
              created_at=CURRENT_TIMESTAMP
        """, (uid, full_name, saved_doc, reason))
        conn.commit()
    except Exception as e:
        conn.close(); return jsonify({"error": str(e)}), 500
    conn.close()
    return jsonify({"ok": True, "status": "pending"})


@app.route("/api/me/verify-request/status")
@login_required
def verification_status():
    uid = session["user_id"]
    conn = db()
    r = conn.execute("SELECT status, created_at FROM verification_requests WHERE user_id=?",
                     (uid,)).fetchone()
    conn.close()
    if not r: return jsonify({"requested": False})
    return jsonify({"requested": True, "status": r["status"], "at": r["created_at"]})


@app.route("/api/me/claim-business", methods=["POST"])
@login_required
@rate_limit("claim_biz", 3, 86400)
def claim_business():
    """93. Claim a business page."""
    uid = session["user_id"]
    d = request.json or {}
    name = (d.get("business_name") or "").strip()[:100]
    email = (d.get("contact_email") or "").strip().lower()
    notes = (d.get("notes") or "").strip()[:500]
    if not name or not _is_valid_email(email):
        return jsonify({"error": "ব্যবসার নাম ও বৈধ ইমেইল দিন"}), 400
    conn = db()
    conn.execute(
        "INSERT INTO business_claims (user_id, business_name, contact_email, notes) "
        "VALUES (?,?,?,?)",
        (uid, name, email, notes)
    )
    conn.commit(); conn.close()
    return jsonify({"ok": True, "status": "pending"})


@app.route("/api/users/<username>/send-contact", methods=["POST"])
@login_required
@rate_limit("send_contact", 20, 3600)
def send_contact(username):
    """95. Send contact card via DM."""
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other: conn.close(); return jsonify({"error": "নেই"}), 404
    oid = other["id"]
    if oid == uid: conn.close(); return jsonify({"error": "নিজেকে নয়"}), 400
    me = conn.execute("SELECT username, display_name, profile_pic FROM users WHERE id=?",
                      (uid,)).fetchone()
    contact_text = "📇 " + (me["display_name"] or me["username"]) + " (@"
    if me["username"]: contact_text += me["username"]
    contact_text += ") — JUKTOY contact card"
    conn.execute("INSERT INTO messages (sender_id, receiver_id, content) VALUES (?,?,?)",
                 (uid, oid, contact_text))
    conn.commit(); conn.close()
    return jsonify({"ok": True})


@app.route("/api/users/<username>/suggest", methods=["POST"])
@login_required
@rate_limit("suggest_friend", 30, 3600)
def suggest_friend(username):
    """97. Suggest a friend to another user via DM."""
    uid = session["user_id"]
    d = request.json or {}
    to = (d.get("to") or "").strip().lower()
    if not to: return jsonify({"error": "কাকে suggest করবেন দিন"}), 400
    conn = db()
    target = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    receiver = conn.execute("SELECT id FROM users WHERE username=?", (to,)).fetchone()
    if not target or not receiver:
        conn.close(); return jsonify({"error": "ইউজার নেই"}), 404
    tid = target["id"]; rid = receiver["id"]
    if tid == uid or rid == uid:
        conn.close(); return jsonify({"error": "নিজেকে নয়"}), 400
    conn.execute("""
        INSERT INTO messages (sender_id, receiver_id, content) VALUES (?,?,?)
    """, (uid, rid, "💡 @@" + username + " কে ফলো করার পরামর্শ — দেখে নিন!"))
    conn.commit(); conn.close()
    return jsonify({"ok": True})


@app.route("/api/me/report-problem", methods=["POST"])
@login_required
@rate_limit("report_problem", 10, 86400)
def report_problem():
    """98. Report a technical problem."""
    uid = session["user_id"]
    d = request.json or {}
    category = (d.get("category") or "other").strip()
    if category not in ("bug", "crash", "performance", "ui", "payment", "other"):
        category = "other"
    message = (d.get("message") or "").strip()[:1000]
    if len(message) < 10:
        return jsonify({"error": "কমপক্ষে ১০ অক্ষর"}), 400
    device_info = (request.headers.get("User-Agent") or "")[:300]
    conn = db()
    conn.execute(
        "INSERT INTO problem_reports (user_id, category, message, device_info) VALUES (?,?,?,?)",
        (uid, category, message, device_info)
    )
    conn.commit(); conn.close()
    return jsonify({"ok": True})


@app.route("/api/me/suggested-friends")
@login_required
def suggested_friends_for_invite():
    """94/97 helper — list of friends to invite/suggest."""
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT DISTINCT u.id, u.username, u.display_name, u.profile_pic
        FROM follows f1
        JOIN follows f2 ON f2.follower_id = f1.following_id
        JOIN users u ON u.id = f2.following_id
        WHERE f1.follower_id = ? AND u.id != ?
          AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
          AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
          AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
          AND COALESCE(u.is_admin,0) = 0
        LIMIT 20
    """, (uid, uid, uid, uid, uid)).fetchall()
    conn.close()
    return jsonify([dict(x) for x in rows])


@app.route("/api/groups/invite-from-profile", methods=["POST"])
@login_required
def invite_to_group_from_profile():
    """94. Invite a user to one of my groups."""
    uid = session["user_id"]
    d = request.json or {}
    gid = d.get("group_id")
    username = (d.get("username") or "").strip().lower()
    if not gid or not username:
        return jsonify({"error": "গ্রুপ ও ইউজারনেম দিন"}), 400
    conn = db()
    member = conn.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",
                          (gid, uid)).fetchone()
    if not member: conn.close(); return jsonify({"error": "আপনি সদস্য নন"}), 403
    target = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not target: conn.close(); return jsonify({"error": "ইউজার নেই"}), 404
    exists = conn.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",
                          (gid, target["id"])).fetchone()
    if exists: conn.close(); return jsonify({"error": "আগেই সদস্য"}), 400
    count = conn.execute("SELECT COUNT(*) AS c FROM group_members WHERE group_id=?", (gid,)).fetchone()["c"]
    if count >= 50: conn.close(); return jsonify({"error": "গ্রুপ পূর্ণ"}), 400
    conn.execute("INSERT INTO group_members (group_id, user_id) VALUES (?,?)", (gid, target["id"]))
    conn.commit(); conn.close()
    return jsonify({"ok": True})




# ============================================
# S30.25 — Periodic data hygiene
# ============================================
# Purges rows that have exceeded their useful life so the SQLite file
# doesn't grow unbounded. Runs in a daemon thread (every 6 hours).
# Each DELETE is independent — one failure never blocks others.

def _run_data_hygiene():
    """Delete aged rows from high-growth tables.

    Retention policy:
      • notifications        → 90 days
      • login_history        → 90 days
      • security_events      → 180 days
      • call_sessions        → 30 days (log)
      • message_requests     → 30 days when still pending
      • snoozed_users        → expired only
      • password_resets      → already-purged at insert
      • story_views          → orphaned (story deleted)
      • story_reactions      → orphaned
      • sessions             → 30 days (was: separate _purge_old_sessions)
    """
    try:
        conn = db()
        total = 0
        jobs = [
            ("notifications",    "DELETE FROM notifications    WHERE created_at < datetime('now','-90 days')"),
            ("login_history",    "DELETE FROM login_history    WHERE created_at < datetime('now','-90 days')"),
            ("security_events",  "DELETE FROM security_events  WHERE created_at < datetime('now','-180 days')"),
            ("call_sessions",    "DELETE FROM call_sessions    WHERE created_at < datetime('now','-30 days')"),
            ("message_requests", "DELETE FROM message_requests WHERE status='pending' AND created_at < datetime('now','-30 days')"),
            ("snoozed_users",    "DELETE FROM snoozed_users    WHERE datetime(until_ts) < datetime('now')"),
            ("story_views",      "DELETE FROM story_views      WHERE story_id NOT IN (SELECT id FROM stories)"),
            ("story_reactions",  "DELETE FROM story_reactions  WHERE story_id NOT IN (SELECT id FROM stories)"),
            ("sessions",         "DELETE FROM sessions         WHERE last_seen < datetime('now','-30 days')"),
            ("password_resets",  "DELETE FROM password_resets  WHERE expires_at < datetime('now','-7 days')"),
            ("hidden_posts",     "DELETE FROM hidden_posts     WHERE post_id NOT IN (SELECT id FROM posts)"),
            ("reel_saves",       "DELETE FROM reel_saves       WHERE reel_id NOT IN (SELECT id FROM reels)"),
        ]
        for label, sql in jobs:
            try:
                n = conn.execute(sql).rowcount
                if n:
                    total += n
                    print(f"[HYGIENE] {label}: removed {n} rows")
            except sqlite3.OperationalError as e:
                # table may not exist on fresh DB — safe to skip
                if "no such table" not in str(e).lower():
                    print(f"[HYGIENE] {label} failed: {e}")
            except Exception as e:
                print(f"[HYGIENE] {label} failed: {e}")
        conn.commit()
        # VACUUM occasionally (only when rows actually removed)
        if total > 500:
            try:
                # PRAGMA auto_vacuum doesn't require rebuild; incremental is enough
                conn.execute("PRAGMA incremental_vacuum")
            except Exception:
                pass
        conn.close()
        if total:
            print(f"[HYGIENE] total removed: {total} rows")
    except Exception as e:
        print(f"[HYGIENE] fatal: {e}")


def _start_hygiene_thread():
    """Run hygiene once at boot + every 6 hours."""
    def _loop():
        # first run after 5 min (let boot settle)
        time.sleep(300)
        while True:
            try:
                _run_data_hygiene()
            except Exception as e:
                print(f"[HYGIENE] loop error: {e}")
            time.sleep(6 * 3600)
    t = threading.Thread(target=_loop, daemon=True)
    t.start()


_start_hygiene_thread()  # S39 — single call

if __name__ == "__main__":
    app.run(host='0.0.0.0', debug=False, port=5000)
