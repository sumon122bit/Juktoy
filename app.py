from flask import Flask, request, jsonify, session, render_template, redirect
import sqlite3, subprocess, secrets, hashlib, os, re
import html as _html  # S16.7 — HTML escape
import time
import threading
from collections import defaultdict, deque
from functools import wraps

app = Flask(__name__)
from flask_cors import CORS
CORS(app, supports_credentials=True, origins=[
    "https://juktoy.onrender.com",
    "capacitor://localhost",
    "http://localhost",
    "https://localhost"
])
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
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

# ============================================
# SESSION / SECURITY CONFIG
# ============================================

from datetime import timedelta as _td
import os as _os

# ============================================
# HTTPS / SECURE COOKIE CONFIG (S7)
# ============================================

from werkzeug.middleware.proxy_fix import ProxyFix
# Trust one layer of proxy (nginx/gunicorn) — X-Forwarded-Proto, X-Forwarded-Host, X-Forwarded-For
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_for=1)

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

app.config.update(
    SESSION_COOKIE_NAME="juktoy_session",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="None",
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_PATH="/",
    SESSION_REFRESH_EACH_REQUEST=True,
    PERMANENT_SESSION_LIFETIME=_td(days=SESSION_MAX_AGE_DAYS),
    MAX_CONTENT_LENGTH=40 * 1024 * 1024,  # 12 MB max request body (reel base64 expansion)
)

# Log once on startup
print(f"[JUKTOY] HTTPS mode: {'ON' if _secure_flag else 'OFF'} "
      f"(set JUKTOY_HTTPS=1 to force)")


# ============================================
# HTTPS ENFORCEMENT + SECURITY HEADERS (S10)
# ============================================

def _is_localhost_request():
    host = (request.host or "").split(":")[0].lower()
    return host in ("localhost", "127.0.0.1", "::1", "0.0.0.0", "10.0.2.2", "10.0.3.2")


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


# ============================================
# TEMPORARY — Live active user count
# ============================================

_active_users = {}
_active_users_lock = threading.Lock()
_ACTIVE_WINDOW = 60  # seconds


def _cleanup_active_users():
    now = time.time()
    cutoff = now - _ACTIVE_WINDOW
    with _active_users_lock:
        for k in list(_active_users.keys()):
            if _active_users[k] < cutoff:
                del _active_users[k]
        return len(_active_users)


@app.route("/api/active/heartbeat", methods=["POST"])
@login_required
def active_heartbeat():
    uid = session["user_id"]
    with _active_users_lock:
        _active_users[uid] = time.time()
    count = _cleanup_active_users()
    return jsonify({"ok": True, "count": count})


@app.route("/api/active/count")
@login_required
def active_count():
    count = _cleanup_active_users()
    return jsonify({"count": count})


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
        if ok:
            codes.pop(i)
            return True, ",".join(codes)
    return False, stored_csv


# Pending 2FA sessions (in-memory) — token → {uid, ver, expires}
_pending_2fa = {}
_pending_2fa_lock = threading.Lock()
_PENDING_2FA_TTL = 300  # 5 minutes


def _pending_2fa_create(uid, ver):
    token = secrets.token_urlsafe(32)
    with _pending_2fa_lock:
        # Cleanup expired
        now = time.time()
        for k in list(_pending_2fa.keys()):
            if _pending_2fa[k]["expires"] < now:
                del _pending_2fa[k]
        _pending_2fa[token] = {"uid": uid, "ver": ver, "expires": now + _PENDING_2FA_TTL}
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

_HTTPS_ONLY = True


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
            samesite="None",
            secure=_HTTPS_ONLY,
            max_age=30 * 24 * 3600,
            path="/",
        )
    return response


@app.before_request
def _session_version_check():
    """S6+S7+S14+S16.5 — session version, expiry, ban, idle check."""
    uid = session.get("user_id")
    if not uid:
        return None
    stored = session.get("session_version")
    if stored is None:
        session.clear()
        return None

    # S7 — absolute expiry
    started = session.get("session_start", 0)
    if started and (time.time() - started) > ABSOLUTE_MAX_AGE_SECONDS:
        session.clear()
        return None

    # S16.5 — idle timeout (2 hours)
    # Stolen cookie becomes useless after 2h of inactivity.
    # Only enforced on API routes to avoid killing sessions during
    # static asset loads / page navigations.
    if request.path.startswith("/api/"):
        now_ts = time.time()
        last_active = session.get("last_active", 0)
        if last_active and (now_ts - last_active) > SESSION_IDLE_SECONDS:
            session.clear()
            return jsonify({
                "error": "নিষ্ক্রিয়তার কারণে সেশন বন্ধ হয়ে গেছে। আবার লগইন করুন।",
                "idle_timeout": True,
            }), 401
        session["last_active"] = now_ts

    # S14 — ban check
    if request.path.startswith("/api/"):
        banned, until, reason = _is_banned(uid)
        if banned:
            session.clear()
            return jsonify({
                "error": f"আপনার অ্যাকাউন্ট স্থগিত করা হয়েছে। কারণ: {reason or 'নীতিমালা লঙ্ঘন'}",
                "banned_until": until,
                "ban_reason": reason,
            }), 403

    # S15.2 — session fingerprint check
    if request.path.startswith("/api/"):
        ok, reason = _session_fp_ok()
        if not ok:
            session.clear()
            return jsonify({"error": reason}), 401

    # S15.4 — verify session record still exists (revoke check)
    if request.path.startswith("/api/"):
        if not _touch_session(uid):
            session.clear()
            return jsonify({"error": "আপনার সেশন বাতিল করা হয়েছে। আবার লগইন করুন।"}), 401
        # S18.9b — update last_seen (throttled: max once per 30s per session)
        _last_ping = session.get("_last_ping", 0)
        if time.time() - _last_ping > 30:
            try:
                _conn = db()
                _conn.execute("UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=?", (uid,))
                _conn.commit()
                _conn.close()
            except Exception:
                pass
            session["_last_ping"] = time.time()

    conn = db()
    row = conn.execute("SELECT COALESCE(session_version, 0) AS v FROM users WHERE id=?",
                       (uid,)).fetchone()
    conn.close()
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

def init_db():
    conn = sqlite3.connect(DB, timeout=10.0)
    # S17.3 — set persistent DB-level pragmas ONCE
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
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

    # Series 4E — heartbeat columns
    for _col in ("caller_last_seen", "callee_last_seen"):
        try:
            c.execute(f"ALTER TABLE call_sessions ADD COLUMN {_col} TIMESTAMP")
        except sqlite3.OperationalError:
            pass

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
            ip = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip() \
                 or (request.remote_addr or "")
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
    # Performance: WAL mode is persistent — set once in init_db.
    # Here we only set connection-scoped pragmas (fast).
    conn = sqlite3.connect(DB, timeout=10.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=3000")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-16000")  # 16 MB per connection
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


def _save_state():
    """Write rate-limit buckets to disk (atomic write)."""
    try:
        with _STATE_LOCK:
            now = time.time()
            cutoff = now - 3600  # keep only last hour
            buckets = {}
            for k, v in list(_limiter._buckets.items()):
                recent = [t for t in v if t > cutoff]
                if recent:
                    buckets[k] = recent
            data = {
                "saved_at": now,
                "rate_limiter": buckets,
            }
        tmp = _STATE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            import json as _j
            _j.dump(data, fh)
        os.replace(tmp, _STATE_FILE)
    except Exception as e:
        try:
            print(f"[STATE] save failed: {e}")
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
    if not text:
        return []
    return list(set(re.findall(r'#([\w\u0980-\u09FF]+)', text.lower())))


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
    host = _os.environ.get("JUKTOY_SMTP_HOST")
    user = _os.environ.get("JUKTOY_SMTP_USER")
    pwd = _os.environ.get("JUKTOY_SMTP_PASS")
    if not (host and user and pwd):
        return None
    return {
        "host": host,
        "port": int(_os.environ.get("JUKTOY_SMTP_PORT") or 587),
        "user": user,
        "password": pwd,
        "from_addr": _os.environ.get("JUKTOY_SMTP_FROM") or user,
    }


def _app_url():
    """Public base URL for reset links."""
    env_url = _os.environ.get("JUKTOY_APP_URL")
    if env_url:
        return env_url.rstrip("/")
    try:
        return request.url_root.rstrip("/")
    except Exception:
        return "http://127.0.0.1:5000"


def _send_email(to_addr, subject, text_body, html_body=None):
    """Send email via SMTP if configured, otherwise print to console."""
    cfg = _smtp_config()
    if not cfg:
        print("\n" + "=" * 60)
        print("[JUKTOY EMAIL — DEV MODE]")
        print("=" * 60)
        print(f"To:      {to_addr}")
        print(f"Subject: {subject}")
        print("-" * 60)
        print(text_body)
        print("=" * 60 + "\n")
        return True

    try:
        msg = _MIMEMultipart("alternative")
        msg["From"] = f"JUKTOY <{cfg['from_addr']}>"
        msg["To"] = to_addr
        msg["Subject"] = subject
        msg.attach(_MIMEText(text_body, "plain", "utf-8"))
        if html_body:
            msg.attach(_MIMEText(html_body, "html", "utf-8"))

        with _smtp.SMTP(cfg["host"], cfg["port"], timeout=10) as smtp:
            smtp.starttls()
            smtp.login(cfg["user"], cfg["password"])
            smtp.send_message(msg)
        return True
    except Exception as e:
        print(f"[JUKTOY EMAIL ERROR] {e}")
        return False


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

    try:
        conn.execute("UPDATE users SET email=?, email_verified=0 WHERE id=?", (email, uid))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "এই ইমেইল ব্যবহার করা যাবে না"}), 400

    uname = conn.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()["username"]
    conn.close()

    verify_tok = _create_reset_token(uid)
    base = _app_url()
    link = f"{base}/#verify_email={verify_tok}"
    _send_email(
        email,
        "JUKTOY — ইমেইল যাচাই করুন",
        f"হ্যালো {uname},\n\nJUKTOY এ আপনার ইমেইল যোগ করার অনুরোধ পাওয়া গেছে।\n\n"
        f"যাচাই করতে নিচের লিংকে ক্লিক করুন:\n{link}\n\n"
        f"লিংকটি ১৫ মিনিট পর expire হয়ে যাবে।\n\n"
        f"আপনি না করলে এই ইমেইল উপেক্ষা করুন।\n\n— JUKTOY"
    )

    return jsonify({"ok": True, "email": email})


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
    Rules:
      - Always verify password
      - If 2FA enabled, also verify TOTP code (or backup code)
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
    ip = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip() or (request.remote_addr or "")
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
    ip = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip() or (request.remote_addr or "")
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


# ============================================
# S15.2 — SESSION FINGERPRINT (IP + UA binding)
# ============================================

def _session_fp():
    """Compute fingerprint from current request (UA + IP)."""
    ua = (request.headers.get("User-Agent") or "")[:500]
    ip = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip() or (request.remote_addr or "")
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
    session["session_ip"] = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip() or (request.remote_addr or "")
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


def admin_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        uid = session.get("user_id")
        if not uid:
            return jsonify({"error": "লগইন প্রয়োজন"}), 401
        if not _is_admin(uid):
            return jsonify({"error": "শুধু অ্যাডমিন অ্যাক্সেস করতে পারবেন"}), 403
        return fn(*a, **kw)
    return wrapper


def _enforce_sole_admin():
    """Sole admin policy: only sumonislam12 has admin rights.
    Demotes any other admin, promotes sumonislam12 if present.
    Runs on every startup — even after DB reset.
    """
    _SOLE = "sumonislam12"
    try:
        conn = db()
        demoted = conn.execute(
            "UPDATE users SET is_admin=0 WHERE LOWER(username) != ? AND COALESCE(is_admin,0)=1",
            (_SOLE,)
        ).rowcount
        promoted = conn.execute(
            "UPDATE users SET is_admin=1 WHERE LOWER(username)=?",
            (_SOLE,)
        ).rowcount
        conn.commit()
        has = conn.execute(
            "SELECT 1 FROM users WHERE LOWER(username)=? AND is_admin=1",
            (_SOLE,)
        ).fetchone()
        conn.close()
        if demoted:
            print(f"[SOLE-ADMIN] Demoted {demoted} other admin(s)")
        if has:
            print(f"[SOLE-ADMIN] @{_SOLE} is the sole admin")
        else:
            print(f"[SOLE-ADMIN] @{_SOLE} not yet registered — will auto-admin on register/login")
    except Exception as e:
        print(f"[SOLE-ADMIN] enforce failed: {e}")


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
                _ip = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip() or (request.remote_addr or "")
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
    d = request.json or {}
    username = (d.get("username") or "").strip().lower()
    name = (d.get("display_name") or "").strip()
    pw = d.get("password") or ""
    if not username or not name or not pw:
        return jsonify({"error": "সব তথ্য পূরণ করুন"}), 400
    if len(username) > 30 or len(name) > 60:
        return jsonify({"error": "ইউজারনেম/নাম অনেক বড়"}), 400
    if not re.match(r'^[a-z0-9_]+$', username):
        return jsonify({"error": "ইউজারনেমে শুধু a-z, 0-9, _ ব্যবহার করুন"}), 400
    # S15.1 — strong password check (+ S15.7 breach check)
    ok, msg = validate_password_strength(pw, check_breach=True)
    if not ok:
        return jsonify({"error": msg}), 400
    # S8 — normalize timing to prevent enumeration via response time
    _t0 = time.time()
    pw_hash = make_password_hash(pw)
    # Add a small random delay so hash time isn't the dominant factor
    _hash_time = time.time() - _t0
    _target_min = 0.30
    if _hash_time < _target_min:
        time.sleep(_target_min - _hash_time + (secrets.randbelow(100) / 1000.0))

    # Sole admin — only sumonislam12 gets admin rights
    _SOLE_ADMIN = "sumonislam12"

    conn = db()
    try:
        is_admin_flag = 1 if username == _SOLE_ADMIN else 0
        conn.execute("INSERT INTO users (username, display_name, password_hash, salt, is_admin) VALUES (?,?,?,?,?)",
                     (username, name, pw_hash, "", is_admin_flag))
        conn.commit()
        if is_admin_flag:
            print(f"[SOLE-ADMIN] @{username} registered as THE admin")
    except sqlite3.IntegrityError:
        conn.close()
        # S8 — same generic message (does not confirm existence)
        return jsonify({"error": "এই ইউজারনেম দিয়ে সাইনআপ করা যাচ্ছে না। ভিন্ন নাম চেষ্টা করুন।"}), 400
    conn.close()
    return jsonify({"ok": True})


# S16.2b — precomputed dummy hash for constant-time login
_DUMMY_PW_HASH = None


def _get_dummy_password_hash():
    """Return a cached hash used to keep login response timing constant.

    Non-existent users verify against this hash so both code paths
    (real + dummy) do identical scrypt work.
    """
    global _DUMMY_PW_HASH
    if _DUMMY_PW_HASH is None:
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
            pass
        print(f"[TIMING] dummy={time.time()-_t_start:.3f}s")  # S16.2b-DEBUG
        # S16.6 — log unknown-user attempt
        _log_security_event("login_fail_nouser", username=username)
        return jsonify({"error": "ভুল ইউজারনেম বা পাসওয়ার্ড"}), 400

    ok, new_hash = verify_password(pw, row["password_hash"], row["salt"])
    if not ok:
        conn.close()
        print(f"[TIMING] real={time.time()-_t_start:.3f}s")  # S16.2b-DEBUG
        # S16.6 — log failed login (bad password)
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

    # S12 — if 2FA enabled, do not create session yet
    totp_enabled = row["totp_enabled"] if "totp_enabled" in row.keys() else 0
    if totp_enabled:
        conn.close()
        token = _pending_2fa_create(row["id"], ver)
        return jsonify({"needs_2fa": True, "temp_token": token})

    conn.close()

    # Sole-admin enforcement on login (in case DB reset removed flag)
    if username == "sumonislam12" and not row["is_admin"]:
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
    # S15.3 — record login + send alert if new device
    try:
        is_new = _record_login(row["id"], method="password")
        if is_new:
            _ua = request.headers.get("User-Agent") or ""
            _ip = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip() or (request.remote_addr or "")
            _login_alert_async(row["id"], method="password", ua=_ua, ip=_ip)
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
    conn = db()
    row = conn.execute("""SELECT totp_secret, COALESCE(totp_enabled,0) AS en,
                                COALESCE(backup_codes,'') AS bc
                          FROM users WHERE id=?""", (uid,)).fetchone()
    if not row or not row["en"]:
        conn.close()
        _pending_2fa_consume(token)
        return jsonify({"error": "2FA নিষ্ক্রিয়"}), 400

    # Try TOTP first
    ok = _verify_totp(row["totp_secret"], code)
    used_backup = False
    new_bc = row["bc"]

    # Fallback: backup code
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
    session.permanent = True
    # S15.2 — bind fingerprint
    _bind_session()
    # S15.4 — create session record
    _create_session_record(uid, method="2fa")

    return jsonify({
        "ok": True,
        "used_backup": used_backup,
        "backup_codes_remaining": (len(new_bc.split(",")) if new_bc else 0) if used_backup else None,
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
          AND (COALESCE(u.is_private, 0) = 0
               OR u.id = ?
               OR u.id IN (SELECT following_id FROM follows WHERE follower_id = ?))
        ORDER BY p.created_at DESC LIMIT 100
    """, (uid, uid, uid, uid, uid, uid, uid)).fetchall()

    posts = []
    for r in rows:
        post = dict(r)
        post["media"] = [m["media"] for m in conn.execute(
            "SELECT media FROM post_media WHERE post_id=? ORDER BY position ASC",
            (r["id"],)).fetchall()]

        reaction_rows = conn.execute(
            "SELECT reaction, COUNT(*) AS c FROM reactions WHERE post_id=? GROUP BY reaction ORDER BY c DESC",
            (r["id"],)).fetchall()
        post["reaction_counts"] = {row["reaction"]: row["c"] for row in reaction_rows}
        post["top_reactions"] = [row["reaction"] for row in reaction_rows[:3]]

        if r["quote_post_id"]:
            q = conn.execute("""
                SELECT p.id, p.content, p.created_at, u.username, u.display_name, u.profile_pic
                FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id=?
            """, (r["quote_post_id"],)).fetchone()
            if q:
                qd = dict(q)
                qd["media"] = [m["media"] for m in conn.execute(
                    "SELECT media FROM post_media WHERE post_id=? ORDER BY position ASC",
                    (q["id"],)).fetchall()]
                post["quoted_post"] = qd

        posts.append(post)

    conn.close()
    return jsonify(posts)


@app.route("/api/posts", methods=["POST"])
@login_required
@rate_limit("post", 30, 3600)
def create_post():
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
def toggle_reaction(pid):
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
    rows = conn.execute("""
        SELECT c.id, c.content, c.created_at, c.parent_id, c.user_id,
               u.username, u.display_name, u.profile_pic,
               (SELECT COUNT(*) FROM comment_likes WHERE comment_id=c.id) AS likes,
               (SELECT 1 FROM comment_likes WHERE comment_id=c.id AND user_id=?) AS i_liked
        FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.post_id=? ORDER BY c.created_at ASC
    """, (uid, pid)).fetchall()

    comments = [dict(r) for r in rows]
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

    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": new_cid})


@app.route("/api/comments/<int:cid>/like", methods=["POST"])
@login_required
def toggle_comment_like(cid):
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
    uid = session["user_id"]
    conn = db()
    c = conn.execute("SELECT user_id, post_id FROM comments WHERE id=?", (cid,)).fetchone()
    if not c:
        conn.close()
        return jsonify({"error": "কমেন্ট পাওয়া যায়নি"}), 404
    if c["user_id"] != uid:
        conn.close()
        return jsonify({"error": "এটা আপনার কমেন্ট নয়"}), 403

    # Delete replies + their likes
    replies = conn.execute("SELECT id FROM comments WHERE parent_id=?", (cid,)).fetchall()
    for r in replies:
        conn.execute("DELETE FROM comment_likes WHERE comment_id=?", (r["id"],))
        conn.execute("DELETE FROM notifications WHERE type='comment_like' AND actor_id IN (SELECT user_id FROM comment_likes WHERE comment_id=?)", (r["id"],))
    conn.execute("DELETE FROM comments WHERE parent_id=?", (cid,))
    conn.execute("DELETE FROM comment_likes WHERE comment_id=?", (cid,))
    conn.execute("DELETE FROM comments WHERE id=?", (cid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ============================================
# SAVES
# ============================================

@app.route("/api/posts/<int:pid>/save", methods=["POST"])
@login_required
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
    posts = []
    for r in rows:
        post = dict(r)
        post["media"] = [m["media"] for m in conn.execute(
            "SELECT media FROM post_media WHERE post_id=? ORDER BY position ASC",
            (r["id"],)).fetchall()]
        posts.append(post)
    conn.close()
    return jsonify(posts)


# ============================================
# REPOSTS
# ============================================

@app.route("/api/posts/<int:pid>/repost", methods=["POST"])
@login_required
def toggle_repost(pid):
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
        for post in posts_out:
            post["media"] = [m["media"] for m in conn.execute(
                "SELECT media FROM post_media WHERE post_id=? ORDER BY position ASC",
                (post["id"],)).fetchall()]

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
          AND last_seen IS NOT NULL
          AND datetime(last_seen) > datetime('now', '-5 minutes')
          AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
        ORDER BY datetime(last_seen) DESC
        LIMIT 10
    """, (uid, uid, uid)).fetchall()
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
    u = conn.execute("""SELECT id, username, display_name, bio, profile_pic, cover_pic, created_at, is_private
        FROM users WHERE username=?""", (username,)).fetchone()
    if not u:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404

    uid = session["user_id"]

    # Block check — return generic 404 to avoid info leak
    if _is_blocked_either_way(uid, u["id"]):
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404

    is_following = conn.execute("SELECT 1 FROM follows WHERE follower_id=? AND following_id=?",
                                (uid, u["id"])).fetchone() is not None

    is_private = bool(u["is_private"]) if "is_private" in u.keys() else False
    is_self = (uid == u["id"])
    can_see_posts = (not is_private) or is_self or is_following

    posts = []
    if can_see_posts:
        posts_rows = conn.execute("""SELECT id, content, created_at FROM posts
            WHERE user_id=? ORDER BY created_at DESC LIMIT 50""", (u["id"],)).fetchall()
        for p in posts_rows:
            pd = dict(p)
            pd["media"] = [m["media"] for m in conn.execute(
                "SELECT media FROM post_media WHERE post_id=? ORDER BY position ASC",
                (p["id"],)).fetchall()]
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
        now_following = False
    else:
        conn.execute("INSERT INTO follows (follower_id, following_id) VALUES (?,?)",
                     (uid, target_id))
        conn.execute("INSERT INTO notifications (user_id, actor_id, type) VALUES (?,?,?)",
                     (target_id, uid, "follow"))
        now_following = True
    conn.commit()
    followers = conn.execute("SELECT COUNT(*) AS c FROM follows WHERE following_id=?",
                             (target_id,)).fetchone()["c"]
    conn.close()
    return jsonify({"ok": True, "is_following": now_following, "followers": followers})


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

    exists = conn.execute("SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?",
                          (uid, target_id)).fetchone()
    if exists:
        conn.execute("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?",
                     (uid, target_id))
        blocked = False
    else:
        conn.execute("INSERT INTO blocks (blocker_id, blocked_id) VALUES (?,?)",
                     (uid, target_id))
        # Auto-unfollow both ways on block
        conn.execute("DELETE FROM follows WHERE follower_id=? AND following_id=?",
                     (uid, target_id))
        conn.execute("DELETE FROM follows WHERE follower_id=? AND following_id=?",
                     (target_id, uid))
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
    """Generate a fresh TOTP secret (does not enable yet)."""
    uid = session["user_id"]
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
    conn.execute("""UPDATE users SET totp_enabled=0, totp_secret=NULL,
                    backup_codes='' WHERE id=?""", (uid,))
    conn.commit()
    conn.close()
    # S16.6 — log 2FA disable
    _log_security_event("2fa_disable", uid=uid)
    return jsonify({"ok": True})


@app.route("/api/me/2fa/status")
@login_required
def status_2fa():
    uid = session["user_id"]
    conn = db()
    row = conn.execute("""SELECT COALESCE(totp_enabled,0) AS en,
                                COALESCE(backup_codes,'') AS bc
                          FROM users WHERE id=?""", (uid,)).fetchone()
    conn.close()
    remaining = len([c for c in (row["bc"] or "").split(",") if c]) if row else 0
    return jsonify({"enabled": bool(row["en"]) if row else False,
                    "backup_codes_remaining": remaining})


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
    row = conn.execute("SELECT id FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404

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
    conn.execute("DELETE FROM posts WHERE user_id=?", (uid,))
    conn.execute("DELETE FROM users WHERE id=?", (uid,))
    conn.commit()
    conn.close()

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
@login_required
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
@login_required
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
    conn = db()
    stats = {
        "pending_reports": conn.execute(
            "SELECT COUNT(*) AS c FROM reports WHERE status='pending'").fetchone()["c"],
        "total_reports": conn.execute(
            "SELECT COUNT(*) AS c FROM reports").fetchone()["c"],
        "total_users": conn.execute(
            "SELECT COUNT(*) AS c FROM users").fetchone()["c"],
        "banned_users": conn.execute(
            "SELECT COUNT(*) AS c FROM users WHERE banned_until IS NOT NULL AND datetime('now') < datetime(banned_until)").fetchone()["c"],
        "total_posts": conn.execute(
            "SELECT COUNT(*) AS c FROM posts").fetchone()["c"],
        "actioned_today": conn.execute(
            "SELECT COUNT(*) AS c FROM moderation_log WHERE date(created_at) = date('now')").fetchone()["c"],
    }
    conn.close()
    return jsonify(stats)


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

        conn.execute(f"""UPDATE users SET banned_until={until_expr}, ban_reason=?
                        WHERE id=?""", (ban_reason, target_author_id))
        # Invalidate sessions of banned user
        conn.execute("UPDATE users SET session_version = COALESCE(session_version,0) + 1 WHERE id=?",
                     (target_author_id,))
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
        # Is currently banned?
        conn2 = db()
        ud["is_banned"] = False
        if r["banned_until"]:
            try:
                still = conn2.execute("SELECT datetime('now') < datetime(?) AS s",
                                      (r["banned_until"],)).fetchone()["s"]
                ud["is_banned"] = bool(still)
            except Exception:
                pass
        conn2.close()
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

    conn.execute(f"""UPDATE users SET banned_until={until_expr}, ban_reason=? WHERE id=?""",
                 (ban_reason, uid))
    conn.execute("UPDATE users SET session_version=COALESCE(session_version,0)+1 WHERE id=?", (uid,))
    conn.execute("""INSERT INTO moderation_log (admin_id, action, target_type, target_id, notes)
                    VALUES (?,?,?,?,?)""",
                 (session["user_id"], "ban", "user", uid, note))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


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
    """Returns whether current user is admin."""
    return jsonify({"is_admin": _is_admin(session["user_id"])})


# ============================================
# EXPLORE
# ============================================

@app.route("/api/explore/trending")
@login_required
def trending_hashtags():
    conn = db()
    rows = conn.execute("""SELECT content FROM posts
        WHERE datetime(created_at) > datetime('now', '-7 days') LIMIT 500""").fetchall()
    conn.close()
    counts = {}
    for row in rows:
        for t in extract_hashtags(row["content"]):
            counts[t] = counts.get(t, 0) + 1
    result = [{"tag": t, "count": c} for t, c in
              sorted(counts.items(), key=lambda x: x[1], reverse=True)[:20]]
    return jsonify(result)


@app.route("/api/explore/top-posts")
@login_required
def explore_top_posts():
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT p.id, p.user_id, p.content, p.created_at,
               u.username, u.display_name, u.profile_pic,
               (SELECT COUNT(*) FROM reactions WHERE post_id=p.id) AS likes,
               (SELECT reaction FROM reactions WHERE post_id=p.id AND user_id=?) AS my_reaction,
               (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comments
        FROM posts p JOIN users u ON u.id = p.user_id
        WHERE datetime(p.created_at) > datetime('now', '-7 days')
          AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
          AND (COALESCE(u.is_private, 0) = 0
               OR u.id = ?
               OR u.id IN (SELECT following_id FROM follows WHERE follower_id = ?))
        ORDER BY likes DESC, p.created_at DESC LIMIT 30
    """, (uid, uid, uid, uid, uid)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


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
          AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id=?)
          AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
        ORDER BY followers DESC LIMIT 12
    """, (uid, uid, uid, uid)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/hashtag/<tag>")
@login_required
def hashtag_feed(tag):
    uid = session["user_id"]
    conn = db()
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
        ORDER BY p.created_at DESC LIMIT 100
    """, (uid, "%#" + tag.lower() + "%", uid, uid, uid, uid)).fetchall()
    conn.close()
    return jsonify({"tag": tag, "count": len(rows), "posts": [dict(r) for r in rows]})


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


_CALL_HEARTBEAT_TIMEOUT = 30  # seconds of silence → treat as dead


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
            print(f"[HEARTBEAT] {call_id[:8]} uid={uid} caller_age={ca}s callee_age={ka}s")
            if (ca is not None and ca > _CALL_HEARTBEAT_TIMEOUT) or \
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
    row = conn.execute("SELECT callee_id FROM call_sessions WHERE id=?", (call_id,)).fetchone()
    if not row or row["callee_id"] != uid:
        conn.close()
        return jsonify({"error": "forbidden"}), 403
    conn.execute("UPDATE call_sessions SET answer=? WHERE id=?", (_sdp_encode(answer), call_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/calls/<call_id>/ice", methods=["POST"])
@login_required
def call_ice(call_id):
    """Submit an ICE candidate. Appends to my side's list (JSON-encoded)."""
    uid = session["user_id"]
    d = request.json or {}
    cand = d.get("candidate")
    if not cand:
        return jsonify({"error": "candidate required"}), 400
    import json as _json
    conn = db()
    row = conn.execute("SELECT caller_id, callee_id, caller_ice, callee_ice FROM call_sessions WHERE id=?",
                       (call_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not found"}), 404
    if uid == row["caller_id"]:
        col = "caller_ice"
        cur = row["caller_ice"] or ""
    elif uid == row["callee_id"]:
        col = "callee_ice"
        cur = row["callee_ice"] or ""
    else:
        conn.close()
        return jsonify({"error": "forbidden"}), 403

    try:
        arr = _json.loads(cur) if cur else []
    except Exception:
        arr = []
    arr.append(cand)
    conn.execute(f"UPDATE call_sessions SET {col}=? WHERE id=?",
                 (_json.dumps(arr), call_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "count": len(arr)})


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
        ORDER BY COALESCE(cs.is_pinned,0) DESC, m.created_at DESC
    """, (uid, uid, uid, uid, uid)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/messages/<username>")
@login_required
def get_messages(username):
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id, username, display_name, profile_pic FROM users WHERE username=?",
                         (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    other_id = other["id"]
    conn.execute("UPDATE messages SET is_read=1 WHERE sender_id=? AND receiver_id=? AND is_read=0",
                 (other_id, uid))
    conn.commit()
    rows = conn.execute("""SELECT m.id, m.sender_id, m.receiver_id, m.content,
        m.attachment, m.parent_id, m.is_read, m.kind, m.duration, m.created_at, m.edited_at, m.deleted_at, m.hidden_for,
        (SELECT content FROM messages WHERE id=m.parent_id) AS parent_content,
        (SELECT attachment FROM messages WHERE id=m.parent_id) AS parent_attachment,
        (SELECT sender_id FROM messages WHERE id=m.parent_id) AS parent_sender_id,
        (SELECT u2.display_name FROM messages mm JOIN users u2 ON u2.id=mm.sender_id WHERE mm.id=m.parent_id) AS parent_sender_name,
        (SELECT reaction FROM message_reactions WHERE message_id=m.id AND user_id=?) AS my_reaction,
        (SELECT COUNT(*) FROM message_reactions WHERE message_id=m.id) AS reaction_count,
        (SELECT 1 FROM starred_messages WHERE message_id=m.id AND user_id=?) AS is_starred
        FROM messages m
        WHERE ((m.sender_id=? AND m.receiver_id=?)
           OR (m.sender_id=? AND m.receiver_id=?))
          AND (COALESCE(m.hidden_for,'') = '' OR m.hidden_for NOT LIKE ?)
        ORDER BY m.created_at ASC LIMIT 500""",
        (uid, uid, uid, other_id, other_id, uid, "%,"+str(uid)+",%")).fetchall()

    # New: real presence (seconds since last_seen)
    pres = conn.execute("""
        SELECT (strftime('%s','now') - strftime('%s', COALESCE(last_seen, created_at))) AS secs
        FROM users WHERE id=?
    """, (other_id,)).fetchone()
    other_secs = pres["secs"] if pres else None

    # Their row (user_id=other, other_user_id=me): their private name for me + their self-name
    their_cs = conn.execute("""SELECT COALESCE(nickname,'') AS n,
                                      COALESCE(my_nickname,'') AS mn
                               FROM chat_settings WHERE user_id=? AND other_user_id=?""",
                            (other_id, uid)).fetchone()
    # My row (user_id=me, other_user_id=other): my private name for them + my self-name
    my_cs = conn.execute("""SELECT COALESCE(nickname,'') AS n,
                                   COALESCE(my_nickname,'') AS mn
                            FROM chat_settings WHERE user_id=? AND other_user_id=?""",
                         (uid, other_id)).fetchone()

    my_nickname_for_them = (my_cs["n"] if my_cs else "") or ""
    my_self_nickname = (my_cs["mn"] if my_cs else "") or ""
    their_self_nickname = (their_cs["mn"] if their_cs else "") or ""

    conn.close()
    return jsonify({
        "user": dict(other),
        "me_id": uid,
        "messages": [dict(r) for r in rows],
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

    # S17.1 — save message image to filesystem
    saved_image = None
    if image:
        saved_image = _save_data_uri(image, "messages", prefix=f"u{session['user_id']}_")
        if not saved_image:
            return jsonify({"error": "ছবি সংরক্ষণ করা যায়নি"}), 500

    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    if other["id"] == uid:
        conn.close()
        return jsonify({"error": "নিজেকে মেসেজ পাঠানো যাবে না"}), 400
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
    uid = session["user_id"]
    conn = db()
    other = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not other:
        conn.close()
        return jsonify({"error": "ইউজার পাওয়া যায়নি"}), 404
    other_id = other["id"]
    # Delete reactions to messages between these two
    conn.execute("""DELETE FROM message_reactions WHERE message_id IN (
        SELECT id FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)
    )""", (uid, other_id, other_id, uid))
    conn.execute("DELETE FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)",
                 (uid, other_id, other_id, uid))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


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
        p = conn.execute("SELECT sender_id, receiver_id FROM messages WHERE id=?", (parent_id,)).fetchone()
        if not p:
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
    m = conn.execute("""SELECT sender_id, receiver_id, kind, content, created_at
                        FROM messages WHERE id=?""", (mid,)).fetchone()
    if not m:
        conn.close()
        return jsonify({"error": "\u09ae\u09c7\u09b8\u09c7\u099c \u09a8\u09c7\u0987"}), 404
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
    m = conn.execute("""SELECT sender_id, receiver_id, kind, created_at
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

    conn.execute("""UPDATE messages SET deleted_at=CURRENT_TIMESTAMP, content=''
                    WHERE id=?""", (mid,))
    conn.commit()
    conn.close()
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

    groups = []
    for r in rows:
        gd = dict(r)
        # Fetch up to 3 member pics for avatar stack
        members = conn.execute("""
            SELECT u.username, u.display_name, u.profile_pic
            FROM group_members gm JOIN users u ON u.id = gm.user_id
            WHERE gm.group_id=? LIMIT 3
        """, (r["id"],)).fetchall()
        gd["members"] = [dict(m) for m in members]
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

    # S17.1 — save group message image to filesystem
    saved_image = None
    if image:
        saved_image = _save_data_uri(image, "messages", prefix=f"g{gid}_u{uid}_")
        if not saved_image:
            return jsonify({"error": "ছবি সংরক্ষণ করা যায়নি"}), 500

    conn = db()
    member = conn.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?",
                          (gid, uid)).fetchone()
    if not member:
        conn.close()
        return jsonify({"error": "আপনি এই গ্রুপের সদস্য নন"}), 403

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
    """, (uid, uid, uid, uid, uid, uid, uid, uid)).fetchall()

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
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT s.id, s.user_id, s.media, s.media_type, s.caption, s.created_at,
               u.username, u.display_name, u.profile_pic,
               (SELECT COUNT(*) FROM story_views WHERE story_id=s.id) AS views,
               (SELECT COUNT(*) FROM story_views WHERE story_id=s.id AND viewer_id=?) AS viewed
        FROM stories s JOIN users u ON u.id = s.user_id
        WHERE datetime(s.created_at) > datetime('now', '-24 hours')
          AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
        ORDER BY s.created_at ASC
    """, (uid, uid, uid)).fetchall()

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
              "views": r["views"], "viewed": r["viewed"] > 0}
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
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT n.id, n.type, n.post_id, n.is_read, n.created_at,
               u.id AS actor_id, u.username AS actor_username,
               u.display_name AS actor_name, u.profile_pic AS actor_pic,
               (SELECT content FROM posts WHERE id = n.post_id) AS post_content
        FROM notifications n JOIN users u ON u.id = n.actor_id
        WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 100
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
    uid = session["user_id"]
    conn = db()
    rows = conn.execute("""
        SELECT r.id, r.user_id, r.video, r.caption, r.created_at,
               u.username, u.display_name, u.profile_pic,
               (SELECT COUNT(*) FROM reel_likes WHERE reel_id=r.id) AS likes,
               (SELECT COUNT(*) FROM reel_likes WHERE reel_id=r.id AND user_id=?) AS liked,
               (SELECT COUNT(*) FROM reel_comments WHERE reel_id=r.id) AS comments,
               (SELECT COUNT(*) FROM reel_saves WHERE reel_id=r.id AND user_id=?) AS is_saved
        FROM reels r JOIN users u ON u.id = r.user_id
        WHERE r.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=?)
          AND r.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=?)
        ORDER BY r.created_at DESC LIMIT 50
    """, (uid, uid, uid, uid)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/reels", methods=["POST"])
@login_required
@rate_limit("reel", 10, 86400)
def create_reel():
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
    uid = session["user_id"]
    conn = db()
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
    content = (request.json.get("content") or "").strip()
    if not content:
        return jsonify({"error": "খালি কমেন্ট নয়"}), 400
    if len(content) > 2_000:
        return jsonify({"error": "কমেন্ট ২,০০০ অক্ষরের বেশি হতে পারবে না"}), 400
    conn = db()
    conn.execute("INSERT INTO reel_comments (reel_id, user_id, content) VALUES (?,?,?)",
                 (rid, session["user_id"], content))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ============================================

# Initialize DB at import time so gunicorn/waitress also work
init_db()
_ensure_upload_dirs()   # S17.1 — create upload folders
_load_state()           # S17.2p — restore rate-limit buckets
_start_state_persister()  # S17.2p — save every 60s + on exit
_enforce_sole_admin()


if __name__ == "__main__":
    app.run(host='0.0.0.0', debug=False, port=5000)
