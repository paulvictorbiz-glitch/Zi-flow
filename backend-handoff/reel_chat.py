"""Rocket.Chat /reel slash command → look up a pipeline reel and post it back.

Flow
────
A Rocket.Chat *Slash Command* (configured via an Outgoing Integration of type
"slashcommand", or the built-in slash-command webhook) POSTs here when a user
types `/reel <query>` in any channel. We:

  1. Parse the command text (the search query, e.g. "temple" or a reel id).
  2. Look up matching rows in the Supabase `reels` table (the dashboard's DB)
     via PostgREST, using the service-role key held ONLY in the backend env.
  3. Post a formatted reference card back into the same channel using the
     existing Rocket.Chat admin token (chat.postMessage).
  4. Record a `reel_chat_refs` row so the dashboard reel card tags back to the
     conversation (parity with the in-app "Discuss" button).

This adds no heavyweight runtime — it reuses httpx (already a dependency) and
the Rocket.Chat creds already in the backend env. The only new env it needs is
SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (the dashboard's project), which the
backend did not previously have.

Security: Rocket.Chat slash commands include a `token` field that must match a
shared secret (REEL_SLASH_TOKEN) so arbitrary callers can't drive this route.
"""
from __future__ import annotations

import os
import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/rocketchat", tags=["rocketchat"])

# ── Rocket.Chat REST (same conventions as app/api/rocketchat.py) ──────────────
def _rc_headers() -> dict:
    return {
        "X-Auth-Token": os.environ.get("ROCKETCHAT_ADMIN_TOKEN", ""),
        "X-User-Id": os.environ.get("ROCKETCHAT_ADMIN_USER_ID", ""),
        "Content-Type": "application/json",
    }


def _rc_base() -> str:
    return os.environ.get("ROCKETCHAT_URL", "http://rocketchat:3000").rstrip("/")


# Public-facing Rocket.Chat URL for building click-back links in the dashboard.
def _rc_public() -> str:
    return os.environ.get("ROCKETCHAT_PUBLIC_URL", "https://chat.footagebrain.com").rstrip("/")


# ── Supabase PostgREST (dashboard DB) ─────────────────────────────────────────
def _sb_base() -> str:
    return os.environ.get("SUPABASE_URL", "").rstrip("/")


def _sb_key() -> str:
    return os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


def _sb_headers() -> dict:
    key = _sb_key()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


async def _find_reels(query: str, limit: int = 5) -> list[dict]:
    """Search public.reels by id or title (case-insensitive), newest first.

    Returns [] on any error/misconfiguration so the slash command degrades to a
    friendly "not found" rather than a 500.
    """
    base = _sb_base()
    if not base or not _sb_key():
        return []
    q = (query or "").strip()
    url = f"{base}/rest/v1/reels"
    # OR filter: id ilike %q% OR title ilike %q%; exclude archived.
    params = {
        "select": "id,title,stage,owner",
        "or": f"(id.ilike.*{q}*,title.ilike.*{q}*)",
        "archived_at": "is.null",
        "order": "stage_entered_at.desc",
        "limit": str(limit),
    }
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(url, headers=_sb_headers(), params=params)
            if r.status_code != 200:
                return []
            return r.json() or []
    except Exception:
        return []


async def _save_feedback_comment(reel_id: str, text: str, author: str) -> bool:
    """Append a human comment to reels.detail.comments for `reel_id`.

    Mirrors the dashboard comment shape ({id, authorId, who, role, ts, txt,
    system}) so it renders in the reel detail feedback list and counts toward
    the unread-comment badge. Read-modify-write the JSONB `detail` column via
    PostgREST. Returns True on success.
    """
    base = _sb_base()
    if not base or not _sb_key() or not (text or "").strip():
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            # Read current detail.
            r = await c.get(f"{base}/rest/v1/reels",
                            headers=_sb_headers(),
                            params={"select": "detail", "id": f"eq.{reel_id}",
                                    "limit": "1"})
            if r.status_code != 200 or not r.json():
                return False
            detail = (r.json()[0].get("detail") or {})
            if not isinstance(detail, dict):
                detail = {}
            comments = detail.get("comments")
            if not isinstance(comments, list):
                comments = []
            import time
            name = (author or "Team chat").strip()
            # Avatar shows short initials; the bold label shows who + "via chat".
            parts = [p for p in name.replace("@", "").split() if p]
            initials = "".join(p[0] for p in parts[:2]).upper() or "TC"
            entry = {
                "id": "c-rc-" + format(int(time.time() * 1000), "x"),
                "authorId": None,
                "who": initials,
                "role": f"{name} · via chat",
                "ts": _now_iso(),
                "txt": text.strip(),
                "system": False,
            }
            detail["comments"] = comments + [entry]
            # Write it back.
            w = await c.patch(f"{base}/rest/v1/reels",
                              headers={**_sb_headers(), "Prefer": "return=minimal"},
                              params={"id": f"eq.{reel_id}"},
                              json={"detail": detail})
            return w.status_code in (200, 204)
    except Exception:
        return False


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def _record_ref(reel_id: str, channel: str, message_url: str, note: str,
                      created_by: str) -> None:
    """Insert a reel_chat_refs row so the dashboard card tags back. Best-effort."""
    base = _sb_base()
    if not base or not _sb_key():
        return
    url = f"{base}/rest/v1/reel_chat_refs"
    payload = {
        "reel_id": reel_id,
        "channel": channel,
        "message_url": message_url or None,
        "note": note or None,
        "created_by": created_by or None,
    }
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            await c.post(url, headers={**_sb_headers(), "Prefer": "return=minimal"},
                         json=payload)
    except Exception:
        pass


async def _post_to_channel(room_id: str, channel: str, text: str,
                           attachments: list | None = None) -> str | None:
    """Post a message to a channel; return the message id if known.

    `attachments` (Rocket.Chat message attachments) render as colored
    left-border cards and never auto-unfurl, so we use one to show the reel
    reference as a pink chip with a clickable title — instead of a raw URL in
    the text (which would generate a redundant footagebrain link preview)."""
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            body = {"text": text or ""}
            if attachments:
                body["attachments"] = attachments
            # Prefer the explicit room id Rocket.Chat handed us; fall back to name.
            if room_id:
                body["roomId"] = room_id
            else:
                body["channel"] = f"#{channel}"
            r = await c.post(f"{_rc_base()}/api/v1/chat.postMessage",
                             headers=_rc_headers(), json=body)
            if r.status_code not in (200, 201):
                return None
            return (r.json().get("message") or {}).get("_id")
    except Exception:
        return None


def _reel_attachment(reel_id: str, title: str, subtitle: str = "",
                     lead: str = "") -> dict:
    """Pink reel-reference card: the title is the clickable deep link (e.g.
    "Feedback on REEL-295 — I hope you find some peace in life") that opens the
    pipeline card. No raw URL, no auto-unfurl."""
    head = f"{lead} {reel_id} — {title}".strip() if lead else f"{reel_id} — {title}"
    return {
        "title": head,
        "title_link": _dashboard_reel_url(reel_id),
        "color": "#ec4899",  # app --c-pink
        "text": subtitle or "",
    }


def _dashboard_base() -> str:
    return os.environ.get("DASHBOARD_URL", "https://footagebrain.com").rstrip("/")


def _dashboard_pipeline_url() -> str:
    """Deep link into the dashboard (the app lives at /app, not /)."""
    return f"{_dashboard_base()}/app"


def _dashboard_reel_url(reel_id: str) -> str:
    """Deep link that opens a specific reel's detail card in the dashboard.

    Must point at /app (the authed SPA) — "/" is the public marketing landing
    page and never reaches the in-app deep-link handler. The SPA reads ?reel=
    on load and opens that reel's detail card.
    """
    from urllib.parse import quote
    return f"{_dashboard_base()}/app?reel={quote(reel_id)}"


def _trigger_words() -> list[str]:
    """Trigger words to strip from incoming outgoing-webhook text (e.g. '!reel').

    Configurable via REEL_TRIGGER_WORDS (comma-separated); defaults to '!reel'
    and '/reel' so both the outgoing-webhook trigger-word style and a true
    slash-command style work.
    """
    raw = os.environ.get("REEL_TRIGGER_WORDS", "!reel,/reel")
    return [w.strip() for w in raw.split(",") if w.strip()]


@router.post("/slash/reel")
async def slash_reel(request: Request):
    """Rocket.Chat `/reel <query>` — works as a slash command OR as an
    outgoing-webhook trigger word (e.g. typing `!reel temple`).

    Slash commands POST form-encoded (token, channel_id, channel_name,
    user_id, user_name, text). Outgoing webhooks POST JSON (token,
    channel_id, channel_name, user_id, user_name, text) where `text` is the
    full message INCLUDING the trigger word. We handle both and post a rich
    reference back into the channel.
    """
    # Try form first (slash command), then JSON (outgoing webhook).
    data = {}
    try:
        form = await request.form()
        data = dict(form)
    except Exception:
        data = {}
    if not data:
        try:
            data = await request.json()
        except Exception:
            data = {}

    # Shared-secret guard.
    expected = os.environ.get("REEL_SLASH_TOKEN", "")
    if expected and data.get("token") != expected:
        return JSONResponse({"text": "Unauthorized."}, status_code=401)

    # Ignore messages from bots/ourselves to avoid an outgoing-webhook loop
    # (Rocket.Chat re-fires sendMessage for the bot's own reply otherwise).
    bot_id = os.environ.get("ROCKETCHAT_ADMIN_USER_ID", "")
    if data.get("bot") or (bot_id and data.get("user_id") == bot_id):
        return {"text": ""}

    text = (data.get("text") or "").strip()
    # Strip a leading trigger word ("!reel temple" -> "temple").
    for w in _trigger_words():
        if text.lower().startswith(w.lower()):
            text = text[len(w):].strip()
            break

    channel_name = data.get("channel_name") or data.get("channel") or "team"
    channel_id = data.get("channel_id") or ""
    user_name = data.get("user_name") or "someone"

    # Input styles we accept:
    #  · Slash App: explicit `reel_id` field + `text` is PURE feedback.
    #  · "<id-or-title> : <feedback>"  (colon separator)
    #  · "<id-or-title> - <feedback>"  (dash separator, spaces around it)
    #  · "REEL-300 <feedback>" or "300 <feedback>"  (id then feedback)
    #  · "<title>"  (title search, no feedback)
    # Bare numbers map to REEL-<n> (so "300" == "REEL-300").
    import re as _re

    def _norm_id(tok: str) -> str:
        t = (tok or "").strip()
        if _re.fullmatch(r"\d+", t):          # "300" -> "REEL-300"
            return f"REEL-{t}"
        return t

    explicit_id = (data.get("reel_id") or "").strip()
    feedback = ""
    query = text

    if explicit_id:
        query = _norm_id(explicit_id)
        feedback = text  # whole text is the feedback
    else:
        if not text:
            return {"text": "Usage: `!reel <id or title> : your feedback` — e.g. "
                            "`!reel REEL-201 : tighten the hook` or `!reel 201 - cut the intro`."}
        # Explicit separator first: ':' or ' - ' splits lookup from feedback.
        m = _re.match(r"^(.*?)\s*(?::|-)\s+(.*)$", text)
        if m and m.group(2).strip():
            query = _norm_id(m.group(1).strip())
            feedback = m.group(2).strip()
        else:
            first, _, rest = text.partition(" ")
            norm_first = _norm_id(first)
            # If the first token is a concrete reel id (REEL-### or a number),
            # treat the rest as feedback; otherwise the whole text is a title search.
            if norm_first.upper().startswith("REEL-") and rest.strip():
                query = norm_first
                feedback = rest.strip()
            else:
                query = _norm_id(text)

    pipeline_url = _dashboard_pipeline_url()
    reels = await _find_reels(query)
    if not reels:
        return {"text": f"No pipeline reel matches *{query}*. "
                        f"Open the board: {pipeline_url}"}

    # If the query matched many but one is an exact id hit, prefer that.
    if len(reels) > 1:
        exact = [r for r in reels if str(r.get("id", "")).upper() == query.upper()]
        if exact:
            reels = exact[:1]

    if len(reels) == 1:
        r = reels[0]
        rid = r.get("id")
        title = r.get("title") or "(untitled)"
        stage = r.get("stage") or "—"
        owner = r.get("owner") or "—"

        saved = False
        if feedback:
            saved = await _save_feedback_comment(rid, feedback, author=user_name)

        # Parity with the dashboard picker: feedback is the message text (no
        # author prefix); the reel is a pink attachment whose title is the
        # clickable deep link. No subtitle.
        if feedback and saved:
            msg = feedback
            lead = "Feedback on"
        else:
            msg = "🎬 shared a reel"
            lead = "Shared"
        attachment = _reel_attachment(rid, title, subtitle="", lead=lead)

        message_id = await _post_to_channel(channel_id, channel_name, msg,
                                            attachments=[attachment])
        msg_url = (f"{_rc_public()}/channel/{channel_name}"
                   f"?msg={message_id}" if message_id else "")
        await _record_ref(rid, channel_name, msg_url,
                          note=(feedback or f"/reel by {user_name}"),
                          created_by=user_name)
        return {"text": ""}

    # Multiple matches — list them so the user can re-run with a specific id.
    lines = [f"Found *{len(reels)}* reels matching *{query}*:"]
    for r in reels:
        lines.append(f"• *{r.get('id')}* — {r.get('title') or '(untitled)'} "
                     f"(`{r.get('stage') or '—'}`)")
    lines.append(f"Re-run with a specific id, e.g. `/reel {reels[0].get('id')} your feedback`.")
    return {"text": "\n".join(lines)}


# ── Autocomplete feed for the Rocket.Chat Slash Command App ───────────────────
@router.get("/reels/search")
async def reels_search(request: Request, q: str = "", limit: int = 8):
    """Return matching reels for the /reel App's autocomplete dropdown.

    Guarded by the same shared secret via the `X-Reel-Token` header so only the
    App (which holds the token) can enumerate reels.
    """
    expected = os.environ.get("REEL_SLASH_TOKEN", "")
    if expected and request.headers.get("x-reel-token") != expected:
        return JSONResponse({"items": []}, status_code=401)
    reels = await _find_reels(q or "", limit=limit) if q else await _recent_reels(limit)
    items = [{"id": r.get("id"), "title": r.get("title") or "(untitled)",
              "stage": r.get("stage") or ""} for r in reels]
    return {"items": items}


async def _recent_reels(limit: int = 8) -> list[dict]:
    """Newest non-archived reels (for an empty-query dropdown)."""
    base = _sb_base()
    if not base or not _sb_key():
        return []
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(f"{base}/rest/v1/reels", headers=_sb_headers(),
                            params={"select": "id,title,stage", "archived_at": "is.null",
                                    "order": "stage_entered_at.desc", "limit": str(limit)})
            return r.json() if r.status_code == 200 else []
    except Exception:
        return []


# ── Dashboard-facing endpoints (browser-callable, Supabase-JWT auth) ───────────
# The dashboard cannot hold REEL_SLASH_TOKEN, so these routes authenticate the
# caller with their Supabase JWT (the same session token the SPA already uses)
# instead of the shared slash secret. The browser sends
# `Authorization: Bearer <supabase access token>`; we verify it against the
# Supabase Auth API to resolve the user, then reuse the same post+save helpers.
async def _verify_supabase_user(request: Request) -> dict | None:
    """Return {id, name} for a valid Supabase JWT, else None."""
    base = _sb_base()
    auth = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    if not base or not auth.lower().startswith("bearer "):
        return None
    token = auth.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            # /auth/v1/user validates the JWT and returns the user record.
            r = await c.get(f"{base}/auth/v1/user",
                            headers={"apikey": _sb_key(),
                                     "Authorization": f"Bearer {token}"})
            if r.status_code != 200:
                return None
            u = r.json() or {}
            meta = u.get("user_metadata") or {}
            name = (meta.get("name") or meta.get("full_name")
                    or (u.get("email") or "").split("@")[0] or "teammate")
            return {"id": u.get("id"), "name": name, "email": u.get("email") or ""}
    except Exception:
        return None


@router.get("/dashboard/channels")
async def dashboard_channels(request: Request):
    """List Rocket.Chat channels + private groups for the picker. JWT-gated."""
    user = await _verify_supabase_user(request)
    if not user:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    out: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            pub = await c.get(f"{_rc_base()}/api/v1/channels.list",
                              headers=_rc_headers(), params={"count": 50})
            for ch in (pub.json().get("channels") or []):
                if ch.get("name"):
                    out.append({"name": ch["name"], "private": False})
            grp = await c.get(f"{_rc_base()}/api/v1/groups.listAll",
                              headers=_rc_headers(), params={"count": 50})
            for g in (grp.json().get("groups") or []):
                if g.get("name"):
                    out.append({"name": g["name"], "private": True})
    except Exception:
        pass
    # De-dupe by name, keep stable order.
    seen, channels = set(), []
    for ch in out:
        if ch["name"] not in seen:
            seen.add(ch["name"])
            channels.append(ch)
    return {"channels": channels}


@router.post("/dashboard/reel-feedback")
async def dashboard_reel_feedback(request: Request):
    """Browser-driven: attach feedback to a reel + post a card to a channel.

    Body: { reel_id, feedback, channel }. Auth: Supabase JWT (Authorization
    header). Mirrors what the slash command does, but trusts the verified user
    instead of the shared token.
    """
    user = await _verify_supabase_user(request)
    if not user:
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    try:
        body = await request.json()
    except Exception:
        body = {}
    reel_id = (body.get("reel_id") or "").strip()
    feedback = (body.get("feedback") or "").strip()
    channel = (body.get("channel") or "pipeline").strip() or "pipeline"
    if not reel_id:
        return JSONResponse({"error": "reel_id required"}, status_code=400)

    # Resolve the reel for a nicer card (title/stage/owner).
    reels = await _find_reels(reel_id, limit=1)
    exact = [r for r in reels if str(r.get("id", "")).upper() == reel_id.upper()]
    r = (exact or reels or [{}])[0]
    title = r.get("title") or reel_id
    stage = r.get("stage") or "—"
    author = user["name"]

    saved = False
    if feedback:
        saved = await _save_feedback_comment(reel_id, feedback, author=author)

    # The feedback (which may contain a reference IG url that SHOULD still
    # unfurl) is the message text — no author prefix. The reel reference is a
    # pink attachment whose title is the clickable deep link ("Feedback on
    # REEL-### — title"); no subtitle, no redundant footagebrain preview.
    msg = feedback if feedback else "🎬 shared a reel"
    lead = "Feedback on" if feedback else "Shared"
    attachment = _reel_attachment(reel_id, title, subtitle="", lead=lead)

    message_id = await _post_to_channel("", channel, msg, attachments=[attachment])
    msg_url = (f"{_rc_public()}/channel/{channel}?msg={message_id}"
               if message_id else "")
    await _record_ref(reel_id, channel, msg_url,
                      note=(feedback or f"shared by {author}"),
                      created_by=user.get("id") or author)
    return {"ok": True, "reel_id": reel_id, "saved_comment": saved,
            "message_url": msg_url}


# ── New-message notifier feed ─────────────────────────────────────────────────
# Powers the dashboard's Teams-chat notifier (audible ping + floating toast +
# My Work "Teams messages" card + Team-tab unread badge). The dashboard polls
# this with the previous poll's `server_time` as `since`; we return channel +
# private-group messages newer than that, EXCLUDING the caller's own messages.
# Reuses the admin Rocket.Chat token already in the backend env — no new env,
# and the same /dashboard/* prefix so no edge/proxy change is needed.

# Cache the caller-email → Rocket.Chat user-id mapping (tiny team; resolved via
# the admin users.list endpoint) so we can drop the caller's own messages.
_RC_ID_CACHE: dict[str, str] = {}


async def _rc_user_id_for_email(email: str) -> str:
    """Best-effort Rocket.Chat user id for a Supabase email. '' if unknown."""
    email = (email or "").strip().lower()
    if not email:
        return ""
    if email in _RC_ID_CACHE:
        return _RC_ID_CACHE[email]
    rc_id = ""
    try:
        import json as _json
        query = _json.dumps({"emails.address": email})
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(f"{_rc_base()}/api/v1/users.list",
                            headers=_rc_headers(),
                            params={"query": query, "count": 1})
            if r.status_code == 200:
                users = r.json().get("users") or []
                if users:
                    rc_id = users[0].get("_id") or ""
    except Exception:
        rc_id = ""
    _RC_ID_CACHE[email] = rc_id
    return rc_id


# Cache admin-minted per-user auth tokens so the dashboard notifier can read each
# caller's OWN rooms/DMs AS that user (personalized), not the whole team firehose.
_RC_TOKEN_CACHE: dict[str, tuple[str, str]] = {}


async def _rc_user_token(client: httpx.AsyncClient, rc_id: str) -> tuple[str, str]:
    """Admin-mint (and cache) an auth token for a Rocket.Chat user id.
    Returns (authToken, userId), or ('', '') if unavailable (e.g. the
    users.createToken admin endpoint is disabled on this instance)."""
    if not rc_id:
        return ("", "")
    cached = _RC_TOKEN_CACHE.get(rc_id)
    if cached:
        return cached
    tok = ("", "")
    try:
        r = await client.post(f"{_rc_base()}/api/v1/users.createToken",
                              headers=_rc_headers(), json={"userId": rc_id})
        if r.status_code == 200:
            data = (r.json() or {}).get("data") or {}
            tok = (data.get("authToken") or "", data.get("userId") or rc_id)
    except Exception:
        tok = ("", "")
    if tok[0]:
        _RC_TOKEN_CACHE[rc_id] = tok
    return tok


def _user_headers(auth_token: str, user_id: str) -> dict:
    """Per-user Rocket.Chat REST headers (acts AS that user, not the admin)."""
    return {"X-Auth-Token": auth_token, "X-User-Id": user_id,
            "Content-Type": "application/json"}


async def _user_rooms(client: httpx.AsyncClient, headers: dict) -> list[dict]:
    """The caller's OWN subscribed rooms via the user-scoped subscriptions.get —
    channels (t='c'), private groups (t='p') and direct messages (t='d').
    Each → {id, name, type}; DMs use the counterpart's display name. Empty on
    any error."""
    rooms: list[dict] = []
    try:
        r = await client.get(f"{_rc_base()}/api/v1/subscriptions.get", headers=headers)
        if r.status_code != 200:
            return rooms
        for s in (r.json().get("update") or []):
            rid = s.get("rid")
            t = s.get("t") or "c"
            if not rid:
                continue
            name = s.get("fname") or s.get("name") or ("Direct message" if t == "d" else "")
            rooms.append({"id": rid, "name": name, "type": t})
    except Exception:
        pass
    return rooms


async def _list_rooms(client: httpx.AsyncClient) -> list[dict]:
    """Enumerate public channels + private groups as {id, name, type}."""
    rooms: list[dict] = []
    try:
        pub = await client.get(f"{_rc_base()}/api/v1/channels.list",
                               headers=_rc_headers(), params={"count": 50})
        for ch in (pub.json().get("channels") or []):
            if ch.get("_id") and ch.get("name"):
                rooms.append({"id": ch["_id"], "name": ch["name"], "type": "c"})
    except Exception:
        pass
    try:
        grp = await client.get(f"{_rc_base()}/api/v1/groups.listAll",
                               headers=_rc_headers(), params={"count": 50})
        for g in (grp.json().get("groups") or []):
            if g.get("_id") and g.get("name"):
                rooms.append({"id": g["_id"], "name": g["name"], "type": "p"})
    except Exception:
        pass
    return rooms


@router.get("/dashboard/recent-messages")
async def dashboard_recent_messages(request: Request, since: str = "", limit: int = 40):
    """Recent messages from the CALLER'S OWN rooms/DMs for the notifier. JWT-gated.

    Personalized: reads only the rooms the signed-in user belongs to — their
    channels, private groups, and direct messages — by acting AS that user via an
    admin-minted token. So each user sees their OWN conversations (including
    replies from others), not the whole team's firehose. The caller's own
    messages are excluded (it's a new-message notifier). Thread replies carry
    `tmid` so the frontend can mark them.

    Query: `since` (ISO ts; empty = baseline) + `limit`. Returns
    { messages: [{id, room, roomType, sender, senderId, text, tmid, ts, url}],
    server_time }. Degrades to an empty list on any upstream error so the
    dashboard notifier never breaks.
    """
    user = await _verify_supabase_user(request)
    if not user:
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    my_rc_id = await _rc_user_id_for_email(user.get("email", ""))
    my_name = (user.get("name") or "").strip().lower()
    since = (since or "").strip()
    try:
        per_room = 8 if not since else 25
        limit = max(1, min(int(limit or 40), 100))
    except Exception:
        per_room, limit = 8, 40

    out: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=12) as c:
            auth_token, uid = await _rc_user_token(c, my_rc_id)
            if not auth_token:
                # Can't act as the caller (no RC id / users.createToken disabled)
                # → return nothing rather than leak the whole team's firehose.
                return {"messages": [], "server_time": _now_iso()}
            uheaders = _user_headers(auth_token, uid)
            rooms = await _user_rooms(c, uheaders)
            for room in rooms[:25]:
                t = room["type"]
                ep = ("im.history" if t == "d"
                      else "groups.history" if t == "p"
                      else "channels.history")
                params = {"roomId": room["id"], "count": per_room, "inclusive": "false"}
                if since:
                    params["oldest"] = since
                try:
                    # Read AS the caller so private groups + DMs are visible.
                    r = await c.get(f"{_rc_base()}/api/v1/{ep}",
                                    headers=uheaders, params=params)
                    if r.status_code != 200:
                        continue
                    for m in (r.json().get("messages") or []):
                        # Skip system messages (room renames, joins, etc.) + empties.
                        if m.get("t"):
                            continue
                        text = (m.get("msg") or "").strip()
                        if not text:
                            continue
                        u = m.get("u") or {}
                        sender_id = u.get("_id") or ""
                        sender_name = u.get("name") or u.get("username") or "Someone"
                        # Exclude the caller's own messages (by RC id, name fallback).
                        if my_rc_id and sender_id == my_rc_id:
                            continue
                        if (not my_rc_id) and my_name and sender_name.strip().lower() == my_name:
                            continue
                        mid = m.get("_id") or ""
                        room_label = room["name"] or ("dm" if t == "d" else "")
                        if mid and t != "d" and room_label:
                            url = f"{_rc_public()}/channel/{room_label}?msg={mid}"
                        elif mid and t == "d":
                            url = f"{_rc_public()}/direct/{room['id']}?msg={mid}"
                        else:
                            url = ""
                        out.append({
                            "id": mid,
                            "room": room_label,
                            "roomType": t,
                            "sender": sender_name,
                            "senderId": sender_id,
                            "text": text,
                            "tmid": m.get("tmid") or "",
                            "ts": m.get("ts") or "",
                            "url": url,
                        })
                except Exception:
                    continue
    except Exception:
        pass

    # Newest first, de-dupe by id, cap.
    out.sort(key=lambda x: x.get("ts") or "", reverse=True)
    seen, messages = set(), []
    for m in out:
        if m["id"] in seen:
            continue
        seen.add(m["id"])
        messages.append(m)
        if len(messages) >= limit:
            break
    return {"messages": messages, "server_time": _now_iso()}
