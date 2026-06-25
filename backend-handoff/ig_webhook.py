"""
Instagram share-to-DM → Reel DNA webhook — DEPLOY TARGET: Hetzner backend.

This file does NOT run in the Vercel app. Copy it to the Hetzner backend at:
    /srv/footagebrain/footage-brain-test/backend/app/api/ig_webhook.py
then register the router (see IG-DM-DEPLOY.md) and rebuild the container.

WHAT IT DOES
------------
When someone DMs an Instagram reel to the @paulvictortravels business/creator
account, Meta sends a `messages` webhook here. We pull the reel's link out of the
message attachment + the sender's typed text (their tag note like
`location=Bali, music=phonk`), and insert one row into Supabase `public.reel_dna`
with source='ig_dm'. The dashboard's Reel DNA spreadsheet shows it live via
Supabase realtime — no refresh, no app code needed for this leg. The frontend
`parseTagNote()` turns the typed text into the spreadsheet columns.

This is the official Instagram Messaging API — ToS-compliant, no scraping, no
yt-dlp. See docs/reel-dna-ig-webhook.md in the Vercel repo for the full spec.

CALIBRATION (the important bit for the first live test)
-------------------------------------------------------
Instagram's exact payload shape for a *shared reel* varies and can't be known
until we see a real one. So with FEATURE_IG_DM_DEBUG=1:
  · every raw request body is logged to stdout (`docker compose logs backend`), and
  · if we can't find a reel URL in the payload, we STILL insert a row whose
    quick_notes holds the raw message JSON — so you can read the real shape right
    in the spreadsheet without SSH. Delete those debug rows after, then flip the
    flag off. This converts "does it work?" into one observable test.

All secrets are read from environment variables — NOTHING is hardcoded:
    IG_WEBHOOK_VERIFY_TOKEN     Webhook handshake token (you choose its value)
    META_APP_SECRET             App secret, for X-Hub-Signature-256 verification
    SUPABASE_URL                Supabase project URL
    SUPABASE_SERVICE_ROLE_KEY   Service role key (server-side only)
    FEATURE_IG_DM_INGEST        "1" to enable inserts (default OFF)
    FEATURE_IG_DM_DEBUG         "1" to log raw payloads + capture unparsed shapes

NOTE on the router pattern: this matches the conventional FastAPI APIRouter style.
Before deploying, open the existing backend/app/api/facebook.py and confirm the
prefix/registration convention matches. The full live paths must resolve to:
    GET  /api/ig/webhook   (Meta verification handshake)
    POST /api/ig/webhook   (receive messages)
If facebook.py bakes "/api" into its own router prefix instead of adding it at
include_router(prefix="/api"), change the prefix below to "/api/ig".
"""

from __future__ import annotations

import os
import re
import json
import hmac
import hashlib
import asyncio
import logging
import datetime as _dt
from typing import Any

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse

log = logging.getLogger("ig_webhook")

# If facebook.py uses a different prefix convention, mirror it here so the live
# path is /api/ig/webhook.
router = APIRouter(prefix="/ig", tags=["ig"])


# ── env helpers ──────────────────────────────────────────────────────────────
def _verify_token() -> str | None:
    return os.environ.get("IG_WEBHOOK_VERIFY_TOKEN")


def _app_secret() -> str | None:
    # The "Instagram API with Instagram Login" signs webhooks with its OWN
    # *Instagram app secret*, which is DIFFERENT from the Facebook app secret.
    # Prefer IG_APP_SECRET; fall back to FB_APP_SECRET / META_APP_SECRET.
    return (os.environ.get("IG_APP_SECRET")
            or os.environ.get("FB_APP_SECRET")
            or os.environ.get("META_APP_SECRET"))


def _supabase_url() -> str | None:
    return os.environ.get("SUPABASE_URL")


def _ingest_on() -> bool:
    return os.environ.get("FEATURE_IG_DM_INGEST", "").strip() in ("1", "true", "TRUE", "yes")


def _debug_on() -> bool:
    return os.environ.get("FEATURE_IG_DM_DEBUG", "").strip() in ("1", "true", "TRUE", "yes")


def _supabase_headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


# Attachment types Instagram uses for a shared reel/post/story. We accept any of
# them and take the first one that carries a usable URL.
_REEL_ATTACH_TYPES = {"ig_reel", "reel", "share", "media_share", "story_mention", "story", "video"}

# content_type enum (migration 0075): ('reel','carousel','photo','story','video','unknown').
# Maps the raw Instagram attachment/share `type` vocabulary onto our enum. Anything
# we cannot confidently classify defaults to 'unknown' (calibrate-then-harden:
# observe the real shape with FEATURE_IG_DM_DEBUG before tightening this map).
_CONTENT_TYPE_MAP = {
    "ig_reel": "reel",
    "reel": "reel",
    "story_mention": "story",
    "story": "story",
    "video": "video",
    # media_share / share are ambiguous (could be a carousel, a photo, or a reel
    # post) — leave them to classify_content_type()'s heuristics, defaulting unknown.
}


def _classify_content_type(
    attach_type: str | None,
    share: dict | None = None,
    url_override: str | None = None,
) -> str:
    """Best-effort map of an Instagram share/attachment to the reel_dna content_type
    enum. Returns one of ('reel','carousel','photo','story','video','unknown').

    When the attachment type maps to 'unknown' (e.g. media_share/share, which is
    ambiguous for IG carousels, photos, or external-platform video links), we fall
    back to URL-based classification via _content_type_from_url(). This ensures
    YouTube and Facebook links shared via IG DM get content_type='video' even
    though Instagram's attachment type is the generic 'media_share'."""
    t = (attach_type or "").strip().lower()
    if t in _CONTENT_TYPE_MAP:
        return _CONTENT_TYPE_MAP[t]
    # URL fallback: if the URL identifies a known video platform, use that.
    if url_override:
        url_result = _content_type_from_url(url_override)
        if url_result != "unknown":
            return url_result
    return "unknown"


def _detect_platform(url: str | None) -> str:
    """Sniff platform from a URL host. Mirrors the frontend platformFromUrl()
    in src/lib/reel-dna.jsx so the two stay consistent. Defaults to 'ig'
    (the most common capture); guards None → 'ig'."""
    u = (url or "").lower()
    if "youtube.com" in u or "youtu.be" in u:
        return "yt"
    if "facebook.com" in u or "fb.watch" in u:
        return "fb"
    if "tiktok.com" in u:
        return "tiktok"
    return "ig"


def _content_type_from_url(url: str | None) -> str:
    """Best-effort content_type for a plain-text (non-share) URL. A YouTube or
    Facebook video host maps to 'video'; everything else is 'unknown' (within
    the 0075 enum: reel/carousel/photo/story/video/unknown)."""
    u = (url or "").lower()
    if ("youtube.com" in u or "youtu.be" in u
            or "facebook.com" in u or "fb.watch" in u
            or "tiktok.com" in u):
        return "video"
    return "unknown"


# ── 1. Webhook verification (GET) ─────────────────────────────────────────────
@router.get("/webhook")
async def verify(request: Request):
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")
    if mode == "subscribe" and token and token == _verify_token():
        # Meta expects the raw challenge echoed back as text/plain, HTTP 200.
        return PlainTextResponse(challenge or "", status_code=200)
    return PlainTextResponse("forbidden", status_code=403)


# ── 2. Receive messages (POST) ────────────────────────────────────────────────
@router.post("/webhook")
async def webhook(request: Request):
    """Receive incoming DMs and persist any shared reel. ALWAYS returns 200 (once
    past signature check) so Meta does not retry — retries + a slow insert must not
    create duplicates (the unique index + ignore-duplicates guarantee that)."""
    raw = await request.body()

    # Verify X-Hub-Signature-256 over the RAW body bytes (NOT re-serialized JSON).
    # Skip only if no secret is configured yet (early dev) — log loudly in that case.
    secret = _app_secret()
    if secret:
        sig = request.headers.get("X-Hub-Signature-256", "")
        expected = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            log.warning("ig_webhook: bad signature (got %r)", sig[:24])
            return PlainTextResponse("forbidden", status_code=403)
    else:
        log.warning("ig_webhook: META_APP_SECRET unset — skipping signature check (set it!)")

    try:
        body = json.loads(raw or b"{}")
    except Exception:
        return JSONResponse({"ok": True}, status_code=200)

    if _debug_on():
        log.info("ig_webhook RAW: %s", json.dumps(body)[:4000])

    if not _ingest_on() and not _debug_on():
        # Flag fully off → ack and do nothing (proves manual/share_target unaffected).
        return JSONResponse({"ok": True}, status_code=200)

    try:
        for event in _iter_message_events(body):
            await _handle_event(event)
    except Exception as e:  # noqa: BLE001 — never surface a 500 to Meta (retry storm)
        log.exception("ig_webhook: handler error: %s", e)

    return JSONResponse({"ok": True}, status_code=200)


def _iter_message_events(body: dict[str, Any]):
    """Yield each individual inbound message event across the webhook envelope.
    Instagram (Instagram-Login API) delivers either:
      · entry[].messaging[]                          (Messenger-style), or
      · entry[].changes[] with field == 'messages' and value being the event
        itself ({sender, recipient, message{mid,text,attachments}}) — the shape
        Meta's 'Test' button and live IG DMs actually send.
    We also tolerate value.messages[] (a list) defensively."""
    for entry in body.get("entry") or []:
        for m in entry.get("messaging") or []:
            yield m
        for change in entry.get("changes") or []:
            value = change.get("value")
            if not isinstance(value, dict):
                continue
            if isinstance(value.get("messages"), list):      # list form
                for m in value["messages"]:
                    yield m
            elif value.get("message") or value.get("attachments") or value.get("sender"):
                yield value                                   # value IS the event


async def _handle_event(event: dict[str, Any]) -> None:
    msg = event.get("message") or {}
    mid = msg.get("mid") or msg.get("id") or event.get("id")
    text = (msg.get("text") or "").strip() or None  # the sender's tag note
    attachments = msg.get("attachments") or []

    reel_url = None
    attach_type = None
    for att in attachments:
        payload = att.get("payload") or {}
        url = payload.get("url") or payload.get("link")
        if url:
            reel_url = url
            attach_type = att.get("type")
            # Some shapes carry the caption/title here; keep it if the sender
            # didn't type their own note.
            if not text:
                text = payload.get("title") or payload.get("caption")
            break

    if reel_url:
        if not _ingest_on():
            return  # debug-only mode: we logged the raw shape above, don't insert
        row = {
            "reel_url": reel_url,
            "platform": _detect_platform(reel_url),
            "source": "ig_dm",
            "status": "captured",
            "external_ref": mid,            # dedupe key
            "content_type": _classify_content_type(attach_type, url_override=reel_url),
            "quick_notes": text,            # parseTagNote() fills the columns frontend-side
        }
        await _insert_reel_dna(row)
        log.info("ig_webhook: captured reel %s (mid=%s, type=%s)", reel_url[:60], mid, attach_type)
        return

    # No reel URL found. In debug mode, capture the raw event so the real payload
    # shape is visible right in the spreadsheet (delete these rows after calibrating).
    if _debug_on():
        row = {
            "reel_url": "(debug — no reel url; raw payload in notes)",
            "platform": _detect_platform(reel_url),
            "source": "ig_dm",
            "status": "captured",
            "external_ref": (mid + "-dbg") if mid else None,
            "content_type": _classify_content_type(attach_type, url_override=reel_url),
            "quick_notes": ("RAW_IG_EVENT: " + json.dumps(event))[:1800],
        }
        await _insert_reel_dna(row)
        log.info("ig_webhook: DEBUG captured raw event (mid=%s, no url)", mid)


async def _insert_reel_dna(row: dict[str, Any]) -> str:
    """Insert a reel_dna row via the service role. Returns a STATUS string:
      · "inserted" — a NEW row was created (200/201/204)
      · "dedupe"   — 409 conflict against the partial unique index = already
                     captured (the HEALTHY skip outcome, NOT an error)
      · "error"    — any other HTTP status, or an exception / missing config
    Mismatch math depends on distinguishing 409-dedupe from a real error, so this
    must never collapse the two."""
    url = _supabase_url()
    if not url:
        log.warning("ig_webhook: SUPABASE_URL unset — cannot insert")
        return "error"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.post(
                f"{url}/rest/v1/reel_dna",
                headers=_supabase_headers(),
                json=row,
            )
            # Dedupe: the partial unique index reel_dna_external_ref_uidx makes a
            # repeated capture of the same message fail with 409 — that's the
            # desired "already captured" outcome, not an error. (We can't use
            # PostgREST on_conflict here: it rejects a partial index as the arbiter.)
            if r.status_code == 409:
                return "dedupe"
            if r.status_code in (200, 201, 204):
                return "inserted"
            log.warning("ig_webhook: insert HTTP %s: %s", r.status_code, r.text[:300])
            return "error"
    except Exception as e:  # noqa: BLE001
        log.warning("ig_webhook: insert failed: %s", e)
        return "error"


# ── 2b. Poll-based sync (works WITHOUT app publishing / App Review) ───────────
# Real IG DM webhooks only fire once the app is published + review-approved. Until
# then we POLL the Page's Instagram inbox (the Business-Suite conversations) with
# the stored Page token — the shared reel's permalink is in shares.data[].link, and
# the tag note is the adjacent text message from the same sender. Idempotent: each
# share message id is the dedupe key, so re-runs are cheap (409 → skip).
GRAPH = "https://graph.facebook.com/v21.0"

# ── Graph sweep tuning ────────────────────────────────────────────────────────
# A single messages.limit(50){...,attachments{type,payload},story} fetch on a
# heavy IG thread makes Graph 500 with code 1 "Please reduce the amount of data
# you're asking for" (and sometimes the subcode-99 "unknown error"). The old code
# dropped the ENTIRE conversation on that 500, losing every reel in it — the root
# cause of "not all my reels show up". So: keep the steady-state payload SMALL
# (only the fields we actually use — `shares{link}`), page it, and ADAPTIVELY
# shrink the page when Graph still says it's too much.
MSGS_PAGE_LIMIT = 25      # messages per page (was an inline limit(50))
MSGS_MIN_LIMIT  = 5       # adaptive floor when a thread is too heavy to fetch
MSGS_PAGE_CAP   = 20      # max message-pages to follow per conversation (safety)
GRAPH_RETRY_ATTEMPTS = 4
GRAPH_BACKOFF = (0.0, 1.0, 2.5, 5.0)   # seconds slept BEFORE attempt i (i=0 → no wait)


def _newest_hydrate_count() -> int:
    """How many of each conversation's MOST-RECENT messages to ALWAYS pull via a
    tiny per-message fetch, independent of the bulk paginated sweep. Tune via
    IG_NEWEST_HYDRATE; 0 disables. This is the fix for "new reels never show up
    even though the run is clean (graph_errors=0, inserted=0)": the bulk
    messages.limit() sweep can return a STABLE window (capped at MSGS_PAGE_CAP, or
    truncated by a heavy-thread #230/500) that never includes the latest DMs — so
    messages_seen stays frozen and nothing new is captured. A `messages{id}`
    projection + individual /{mid} hydration is light enough to NEVER trip the
    'reduce the amount of data' 500, so the newest N reels are always reachable."""
    try:
        return max(0, int(os.environ.get("IG_NEWEST_HYDRATE", "60")))
    except Exception:  # noqa: BLE001
        return 60

# Single-flight guard: only ONE sweep at a time. The */15 cron + a manual Refresh
# (or several) can otherwise overlap and hammer the Graph conversations edge into
# rate-limited 500s ("reduce the amount of data") — and race on the same run rows.
_SYNC_RUNNING = False


def _is_transient(status: int, body: str) -> bool:
    """Whether a Graph failure is worth retrying with the same request. IG's
    conversations/messages edges intermittently 500 with 'reduce the amount of
    data' or subcode-99 EVEN ON tiny (limit=1, fields=id) requests — that's flaky
    rate-limiting, not a deterministic size error, so we DO retry. The messages
    fetch additionally shrinks its page between attempts (see _fetch_messages) to
    also cover the genuinely-too-big thread."""
    if status in (429, 500, 502, 503, 504):
        return True
    return '"error_subcode":99' in body or 'subcode":99' in body


async def _graph_request(client, *, url: str | None = None, path: str | None = None,
                         token: str | None = None, params: dict | None = None) -> dict:
    """One Graph GET with bounded retry on transient errors (5xx / 429 / subcode 99).
    Pass either a full signed `url` (a paging.next cursor) OR path+token(+params).
    Returns parsed JSON on success, or {"_err": status_or_exc, "body": ...} on final
    failure. Permanent errors (400/403/404, or a 'reduce the amount of data' 500)
    return immediately without burning retries."""
    p = dict(params or {})
    if token and not url:
        p["access_token"] = token
    last: dict = {"_err": "unknown"}
    for attempt in range(GRAPH_RETRY_ATTEMPTS):
        if GRAPH_BACKOFF[attempt]:
            await asyncio.sleep(GRAPH_BACKOFF[attempt])
        try:
            r = await (client.get(url) if url else client.get(f"{GRAPH}/{path}", params=p))
            if r.status_code == 200:
                return r.json()
            body = r.text[:300]
            last = {"_err": r.status_code, "body": body}
            if not _is_transient(r.status_code, body):
                return last
        except Exception as e:  # noqa: BLE001 — network blip, retry
            last = {"_err": str(e), "body": ""}
    return last


def _parse_ts(s: str) -> float:
    try:
        return _dt.datetime.strptime(s, "%Y-%m-%dT%H:%M:%S%z").timestamp()
    except Exception:
        return 0.0


def _page_tokens() -> list[tuple[str, str]]:
    store_path = os.environ.get("FB_TOKEN_STORE", "/app/data/auth/facebook_token.json")
    try:
        store = json.load(open(store_path))
    except Exception as e:  # noqa: BLE001
        log.warning("ig_webhook sync: cannot read token store: %s", e)
        return []
    return [(p.get("id"), p.get("page_access_token"))
            for p in (store.get("pages") or []) if p.get("page_access_token")]


async def _graph_get(client, path: str, token: str, **params) -> dict:
    # Thin wrapper kept for callers; retries transient failures via _graph_request.
    return await _graph_request(client, path=path, token=token, params=params)


async def _list_ig_conversations(client, pid: str, tok: str, cap: int = 25,
                                 run: dict | None = None, run_id=None) -> list[str]:
    """List Instagram conversation ids for a Page, ONE per page-request following
    the `next` cursor. The conversations edge 500s when asked for many at once
    (subcode 99), but limit=1 + pagination is reliable."""
    ids: list[str] = []
    next_url = None
    for _ in range(cap):
        if next_url:
            j = await _graph_request(client, url=next_url)
        else:
            j = await _graph_request(
                client, path=f"{pid}/conversations", token=tok,
                params={"platform": "instagram", "fields": "id", "limit": 1})
        if j.get("_err") is not None:
            # 400 = this Page has no linked IG professional account (code 100). That's
            # EXPECTED for non-IG Pages in the token store — skip silently and do NOT
            # count it as an error (else it permanently inflates graph_errors / forces
            # a false mismatch). Any OTHER error is real: it TRUNCATES the conversation
            # list (threads past this cursor go unseen), so count + log it with detail.
            if j.get("_err") != 400:
                if run is not None:
                    run["graph_errors"] += 1
                    if _is_permission_error(j.get("_err"), str(j.get("body", ""))):
                        run["token_permission_error"] = True
                log.warning("ig_webhook sync: conversations error %s: %s",
                            j.get("_err"), str(j.get("body", ""))[:160])
                await _log_ingest_issue(
                    client, run_id, "graph_error",
                    detail=(f"conversations list truncated after {len(ids)} thread(s) "
                            f"on page={'cursor' if next_url else 'first'}: "
                            f"{j.get('_err')} {str(j.get('body',''))[:140]}"),
                    conversation_id=pid)
            break
        for c in (j.get("data") or []):
            if c.get("id"):
                ids.append(c["id"])
        next_url = (j.get("paging") or {}).get("next")
        if not next_url:
            break
    return ids


def _msg_fields(limit: int) -> str:
    """The messages-edge field spec. In steady state we request ONLY what we use to
    capture a reel — `shares{link}` plus id/time/from/message for note-pairing —
    because the bulky `attachments{type,payload}` was the payload that tripped
    Graph's 'reduce the amount of data' 500 and got whole conversations dropped.
    attachments/story are fetched ONLY in debug mode (the NON-SHARE shape logging
    below consumes them); production never read them anyway."""
    base = "id,created_time,from,message,shares{link}"
    if _debug_on():
        base += ",attachments{type,payload},story"
    return f"messages.limit({limit}){{{base}}}"


async def _fetch_messages(client, cid: str, tok: str, run: dict, run_id) -> list:
    """Fetch ALL messages for one conversation. Paginates the messages edge AND
    adaptively shrinks the page size when Graph rejects the request as too large
    ('reduce the amount of data' / subcode 99). Previously a single 500 dropped the
    whole conversation and lost every reel in it. Returns whatever was retrieved
    (possibly partial); logs a graph_error only when even the smallest page fails."""
    msgs: list = []
    limit = MSGS_PAGE_LIMIT
    md: dict = {}
    # First page: shrink the limit until Graph accepts it (or we hit the floor).
    while True:
        md = await _graph_request(
            client, path=cid, token=tok, params={"fields": _msg_fields(limit)})
        if md.get("_err") is None:
            break
        body = str(md.get("body", ""))
        too_big = ("reduce the amount of data" in body
                   or '"error_subcode":99' in body or 'subcode":99' in body)
        if too_big and limit > MSGS_MIN_LIMIT:
            limit = max(MSGS_MIN_LIMIT, limit // 2)
            continue
        run["graph_errors"] += 1
        if _is_permission_error(md.get("_err"), body):
            run["token_permission_error"] = True
        await _log_ingest_issue(
            client, run_id, "graph_error",
            detail=f"messages fetch: {md.get('_err')} {body}"[:300],
            conversation_id=cid)
        return msgs
    node = md.get("messages") or {}
    msgs.extend(node.get("data") or [])
    next_url = (node.get("paging") or {}).get("next")
    pages = 1
    while next_url and pages < MSGS_PAGE_CAP:
        j = await _graph_request(client, url=next_url)
        if j.get("_err") is not None:
            run["graph_errors"] += 1
            if _is_permission_error(j.get("_err"), str(j.get("body", ""))):
                run["token_permission_error"] = True
            await _log_ingest_issue(
                client, run_id, "graph_error",
                detail=f"messages page {pages}: {j.get('_err')} {str(j.get('body',''))[:160]}",
                conversation_id=cid)
            break
        msgs.extend(j.get("data") or [])
        next_url = (j.get("paging") or {}).get("next")
        pages += 1
    return msgs


def _is_permission_error(err, body: str) -> bool:
    """A Graph (#230) 'not enough permission to view the object' / 403 OAuth error
    means the Page/IG token has LOST messaging permission (expired, app review
    lapsed, or the account was disconnected) — NOT a transient/heavy-thread error.
    Surfaced on the run note so 'inserted=0' isn't silently mistaken for 'all
    caught up' (the real fix is owner-side: reconnect Instagram/Facebook)."""
    b = body or ""
    return ("(#230)" in b or '"code":230' in b
            or (err == 403 and "permission" in b.lower()))


async def _fetch_newest_message_ids(client, cid: str, tok: str) -> list[str]:
    """Cheapest newest-first message-id list for a conversation. Tries the minimal
    `messages.limit(N){id,created_time}` projection on the conversation node, then
    falls back to the /{cid}/messages edge with the same cheap fields. Never carries
    the heavy shares/attachments payload, so it does NOT trip the heavy-thread 500
    that the bulk sweep hits. Returns ids newest-first (best-effort; [] on failure)."""
    n = _newest_hydrate_count()
    if n <= 0:
        return []
    data = None
    j = await _graph_request(client, path=cid, token=tok,
                             params={"fields": f"messages.limit({n}){{id,created_time}}"})
    if j.get("_err") is None:
        data = ((j.get("messages") or {}).get("data")) or []
    else:
        j2 = await _graph_request(client, path=f"{cid}/messages", token=tok,
                                  params={"fields": "id,created_time", "limit": n})
        if j2.get("_err") is None:
            data = j2.get("data") or []
    if not data:
        return []
    # Graph usually returns newest-first, but don't trust it — sort by time DESC.
    data.sort(key=lambda m: _parse_ts(m.get("created_time", "")), reverse=True)
    return [m.get("id") for m in data[:n] if m.get("id")]


async def _hydrate_message(client, mid: str, tok: str) -> dict | None:
    """Fetch ONE message with the full capture projection. A single-object request
    is tiny → it never trips the heavy-payload 500. Returns the node or None."""
    j = await _graph_request(
        client, path=mid, token=tok,
        params={"fields": "id,created_time,from,message,shares{link}"})
    if j.get("_err") is not None:
        return None
    return j


async def _existing_ext_refs(client) -> set:
    """The external_refs (share-message ids) we've already captured — so a polling
    run only WRITES genuinely-new reels instead of re-POSTing every reel each time
    (keeps Supabase usage near-zero in steady state)."""
    url = _supabase_url()
    if not url:
        return set()
    try:
        r = await client.get(
            f"{url}/rest/v1/reel_dna?source=eq.ig_dm&select=external_ref"
            "&order=created_at.desc&limit=5000",
            headers=_supabase_headers())
        if r.status_code == 200:
            return {row.get("external_ref") for row in r.json() if row.get("external_ref")}
    except Exception as e:  # noqa: BLE001
        log.warning("ig_webhook sync: ext-ref preload failed: %s", e)
    return set()


# ── reconciliation/monitoring REST helpers (reuse the Supabase service-role
#    pattern from _insert_reel_dna / _existing_ext_refs — same url + headers) ──
async def _open_sync_run(client, trigger: str) -> str | None:
    """POST one OPEN ig_sync_runs row (started_at + trigger) and return its id, so
    ig_ingest_log rows written during the loop satisfy the run_id FK. The run is
    PATCHed with final counts + finished_at + reconciliation at the end."""
    url = _supabase_url()
    if not url:
        return None
    try:
        r = await client.post(
            f"{url}/rest/v1/ig_sync_runs",
            # ask PostgREST to echo the inserted row so we get the generated id
            headers={**_supabase_headers(), "Prefer": "return=representation"},
            json={"started_at": _now_iso(), "trigger": trigger},
        )
        if r.status_code in (200, 201):
            data = r.json()
            row = data[0] if isinstance(data, list) and data else data
            if isinstance(row, dict):
                return row.get("id")
        log.warning("ig_webhook sync: open run HTTP %s: %s", r.status_code, r.text[:200])
    except Exception as e:  # noqa: BLE001
        log.warning("ig_webhook sync: open run failed: %s", e)
    return None


async def _close_sync_run(client, run_id: str, run: dict,
                          reconciled: bool, mismatch_count: int) -> None:
    """PATCH the run row with final counters + finished_at + reconciliation."""
    url = _supabase_url()
    if not url or not run_id:
        return
    patch = {
        "finished_at": _now_iso(),
        "conversations": run["conversations"],
        "messages_seen": run["messages_seen"],
        "shares_seen": run["shares_seen"],
        "inserted": run["inserted"],
        "dedupe_skip": run["dedupe_skip"],
        "skipped_no_link": run["skipped_no_link"],
        "multi_extra": run["multi_extra"],
        "parse_fail": run["parse_fail"],
        "insert_error": run["insert_error"],
        "graph_errors": run["graph_errors"],
        "reconciled": reconciled,
        "mismatch_count": mismatch_count,
    }
    # Loud signal on the run row when the token lost permission (#230) — so a
    # clean-looking run (inserted=0) isn't mistaken for "all caught up".
    if run.get("token_permission_error"):
        patch["note"] = ("TOKEN_PERMISSION (#230): the Page/IG token can't read message "
                         "objects — reconnect Instagram/Facebook to refresh it.")
    try:
        r = await client.patch(
            f"{url}/rest/v1/ig_sync_runs?id=eq.{run_id}",
            headers=_supabase_headers(),
            json=patch,
        )
        if r.status_code not in (200, 204):
            log.warning("ig_webhook sync: close run HTTP %s: %s", r.status_code, r.text[:200])
    except Exception as e:  # noqa: BLE001
        log.warning("ig_webhook sync: close run failed: %s", e)


async def _log_ingest_issue(client, run_id: str | None, issue_type: str,
                            detail: str | None = None,
                            conversation_id: str | None = None,
                            message_id: str | None = None) -> None:
    """Append ONE ig_ingest_log row for a NON-happy-path outcome only
    (skipped_no_link / multi_share_extra / parse_fail / insert_error / graph_error).
    Successful inserts and expected dedupe-skips are NEVER logged here. Best-effort:
    a logging failure must never abort the poll."""
    url = _supabase_url()
    if not url or not run_id:
        return
    try:
        await client.post(
            f"{url}/rest/v1/ig_ingest_log",
            headers=_supabase_headers(),
            json={
                "run_id": run_id,
                "conversation_id": conversation_id,
                "message_id": message_id,
                "issue_type": issue_type,
                "detail": (detail or "")[:1000] or None,
            },
        )
    except Exception as e:  # noqa: BLE001
        log.warning("ig_webhook sync: ingest-log write failed: %s", e)


async def _post_sync_alert(client, run_id: str, mismatch_count: int, issues: dict) -> None:
    """Best-effort Discord alert on a detected mismatch. POSTs to the app's
    suggest.js ?action=ig-sync-alert branch (authed by SUGGEST_CRON_SECRET). NEVER
    breaks the poll: any failure is swallowed. The receiving endpoint always 200s
    and posts to the owner Discord webhook itself."""
    base = (os.environ.get("APP_BASE_URL")
            or os.environ.get("PUBLIC_APP_URL")
            or os.environ.get("FB_APP_BASE_URL"))
    secret = os.environ.get("SUGGEST_CRON_SECRET")
    if not base or not secret:
        log.info("ig_webhook sync: mismatch alert skipped (APP_BASE_URL/SUGGEST_CRON_SECRET unset)")
        return
    try:
        await client.post(
            f"{base.rstrip('/')}/api/ai/suggest?action=ig-sync-alert",
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {secret}",
                     "x-cron-secret": secret},
            json={"run_id": run_id, "mismatch_count": mismatch_count, "issues": issues},
        )
    except Exception as e:  # noqa: BLE001
        log.warning("ig_webhook sync: mismatch alert post failed: %s", e)


def _new_run_counters() -> dict:
    return {
        "conversations": 0, "messages_seen": 0, "shares_seen": 0,
        "inserted": 0, "dedupe_skip": 0, "skipped_no_link": 0,
        "multi_extra": 0, "parse_fail": 0, "insert_error": 0, "graph_errors": 0,
    }


async def _do_sync(trigger: str = "cron") -> dict:
    """Single-flight wrapper: skip if a sweep is already in progress, so the cron
    and manual Refreshes never overlap (overlap = Graph rate-limit 500s + run-row
    races). Always clears the flag, even on error."""
    global _SYNC_RUNNING
    if _SYNC_RUNNING:
        log.info("ig_webhook sync: skipped (%s) — a sweep is already running", trigger)
        return {"ok": True, "skipped": "already_running"}
    _SYNC_RUNNING = True
    try:
        return await _do_sync_inner(trigger)
    finally:
        _SYNC_RUNNING = False


async def _do_sync_inner(trigger: str = "cron") -> dict:
    run = _new_run_counters()
    async with httpx.AsyncClient(timeout=40) as client:
        run_id = await _open_sync_run(client, trigger)
        known = await _existing_ext_refs(client)   # skip already-captured reels
        for pid, tok in _page_tokens():
            cids = await _list_ig_conversations(client, pid, tok, cap=40, run=run, run_id=run_id)
            run["conversations"] += len(cids)
            for cid in cids:
                # Paginated + adaptively-shrinking fetch so a heavy thread no longer
                # 500s-and-drops; returns all messages it could retrieve.
                msgs = await _fetch_messages(client, cid, tok, run, run_id)
                # Hardening: ALWAYS hydrate the newest N messages individually, so
                # a bulk sweep that returned a STALE window (heavy-thread truncation
                # or the MSGS_PAGE_CAP) can't hide the latest DMs. Cheap per-message
                # fetches can't trip the heavy-payload 500. De-duped against what the
                # sweep already returned AND against already-captured refs.
                seen_ids = {m.get("id") for m in msgs if m.get("id")}
                newest_ids = await _fetch_newest_message_ids(client, cid, tok)
                for nmid in newest_ids:
                    if not nmid or nmid in seen_ids or nmid in known:
                        continue
                    node = await _hydrate_message(client, nmid, tok)
                    if node and node.get("id"):
                        msgs.append(node)
                        seen_ids.add(node["id"])
                # index the text notes by sender for nearest-time pairing
                notes = [(_parse_ts(m.get("created_time", "")),
                          (m.get("from") or {}).get("id"),
                          (m.get("message") or "").strip())
                         for m in msgs if (m.get("message") or "").strip()]
                for m in msgs:
                    run["messages_seen"] += 1
                    mid = m.get("id")
                    sender = (m.get("from") or {}).get("id")
                    ts = _parse_ts(m.get("created_time", ""))
                    shares = ((m.get("shares") or {}).get("data")) or []
                    if not shares:
                        # No share edge on this message → not a captured-via-share
                        # item. (Non-share media classification is calibrate-then-
                        # harden; see attachments/story below.) Nothing to seed.
                        attachments = m.get("attachments")
                        story = m.get("story")
                        if _debug_on() and (attachments or story):
                            log.info("ig_webhook sync: NON-SHARE shape mid=%s attachments=%s story=%s",
                                     mid, json.dumps(attachments)[:600] if attachments else None,
                                     json.dumps(story)[:600] if story else None)
                        m_text = (m.get("message") or "").strip()
                        match = re.search(r"https?://\S+", m_text)
                        if match and mid and mid not in known:
                            url = match.group(0).rstrip(".,;:!?)]}>\"'“”‘’")
                            run["shares_seen"] += 1
                            status = await _insert_reel_dna({
                                "reel_url": url,
                                "platform": _detect_platform(url),
                                "source": "ig_dm",
                                "status": "captured",
                                "external_ref": mid,
                                "content_type": _content_type_from_url(url),
                                "quick_notes": m_text,
                            })
                            if status == "inserted":
                                run["inserted"] += 1
                                known.add(mid)
                            elif status == "dedupe":
                                run["dedupe_skip"] += 1
                                known.add(mid)
                            else:  # "error"
                                run["insert_error"] += 1
                                await _log_ingest_issue(
                                    client, run_id, "insert_error",
                                    detail=f"text-link insert failed for mid={mid}",
                                    conversation_id=cid, message_id=mid)
                        continue
                    # nearest same-sender text note within 25s becomes the tag note
                    cand = sorted((abs(nt - ts), tx) for nt, ns, tx in notes
                                  if ns == sender and abs(nt - ts) <= 25)
                    note = cand[0][1] if cand else None
                    # Iterate ALL shared items. First item keeps external_ref = mid
                    # (so existing captured rows stay deduped); items >=1 use a
                    # composite ref. CRITICAL: the `known` membership check is on the
                    # COMPUTED ref, not mid — otherwise multi-item messages re-insert
                    # every run.
                    for i, sh in enumerate(shares):
                        link = (sh or {}).get("link")
                        ref = mid if i == 0 else f"{mid}:{i}"
                        if i >= 1:
                            run["multi_extra"] += 1
                        if not link:
                            run["skipped_no_link"] += 1
                            await _log_ingest_issue(
                                client, run_id, "skipped_no_link",
                                detail=f"share index {i} has no link",
                                conversation_id=cid, message_id=mid)
                            continue
                        run["shares_seen"] += 1
                        if ref in known:        # already captured — no Supabase write
                            run["dedupe_skip"] += 1
                            continue
                        content_type = _classify_content_type(sh.get("type"), sh, url_override=link)
                        status = await _insert_reel_dna({
                            "reel_url": link, "platform": _detect_platform(link), "source": "ig_dm",
                            "status": "captured", "external_ref": ref,
                            "content_type": content_type,
                            "quick_notes": note,
                        })
                        if status == "inserted":
                            run["inserted"] += 1
                            known.add(ref)
                            if i >= 1:
                                # record the extra-share capture (non-happy-path:
                                # surfaces multi-item messages in the error log)
                                await _log_ingest_issue(
                                    client, run_id, "multi_share_extra",
                                    detail=f"captured extra share index {i} (ref={ref})",
                                    conversation_id=cid, message_id=mid)
                        elif status == "dedupe":
                            run["dedupe_skip"] += 1
                            known.add(ref)
                        else:  # "error"
                            run["insert_error"] += 1
                            await _log_ingest_issue(
                                client, run_id, "insert_error",
                                detail=f"insert failed for ref={ref}",
                                conversation_id=cid, message_id=mid)

    # ── reconciliation ──
    # graph_errors count too: a conversation we couldn't fetch may hold reels we
    # never saw, so a run with ANY graph_error is NOT fully reconciled — otherwise
    # dropped conversations show green and the missing reels stay invisible.
    seen = run["shares_seen"]
    accounted = run["inserted"] + run["dedupe_skip"]
    reconciled = ((accounted == seen) and run["insert_error"] == 0
                  and run["parse_fail"] == 0 and run["graph_errors"] == 0)
    mismatch_count = (seen - accounted + run["insert_error"]
                      + run["parse_fail"] + run["graph_errors"])

    async with httpx.AsyncClient(timeout=20) as client2:
        await _close_sync_run(client2, run_id, run, reconciled, mismatch_count)
        if not reconciled and run_id:
            issues = {
                "skipped_no_link": run["skipped_no_link"],
                "multi_extra": run["multi_extra"],
                "parse_fail": run["parse_fail"],
                "insert_error": run["insert_error"],
                "graph_errors": run["graph_errors"],
            }
            await _post_sync_alert(client2, run_id, mismatch_count, issues)

    log.info("ig_webhook sync: convs=%s msgs=%s shares=%s inserted=%s dedupe=%s "
             "no_link=%s multi=%s insert_err=%s graph_err=%s reconciled=%s mismatch=%s",
             run["conversations"], run["messages_seen"], run["shares_seen"],
             run["inserted"], run["dedupe_skip"], run["skipped_no_link"],
             run["multi_extra"], run["insert_error"], run["graph_errors"],
             reconciled, mismatch_count)
    return {"ok": True, "run_id": run_id,
            "conversations": run["conversations"],
            "messages_seen": run["messages_seen"],
            "shares_seen": run["shares_seen"],
            "inserted": run["inserted"],
            "dedupe_skip": run["dedupe_skip"],
            "skipped_no_link": run["skipped_no_link"],
            "multi_extra": run["multi_extra"],
            "parse_fail": run["parse_fail"],
            "insert_error": run["insert_error"],
            "graph_errors": run["graph_errors"],
            "reconciled": reconciled,
            "mismatch_count": mismatch_count}


@router.api_route("/sync", methods=["GET", "POST"])
async def sync(request: Request):
    """Pull recent Instagram DMs from the Page inbox and capture shared reels.
    Gated by ?secret= matching IG_SYNC_SECRET. Returns immediately and runs in the
    background (the cron path); pass ?wait=1 to run synchronously for debugging."""
    want = os.environ.get("IG_SYNC_SECRET")
    if want and request.query_params.get("secret") != want:
        return JSONResponse({"error": "forbidden"}, status_code=403)
    # trigger: ?trigger=manual (Refresh button) | webhook | default cron
    trigger = request.query_params.get("trigger") or "cron"
    if trigger not in ("cron", "manual", "webhook"):
        trigger = "cron"
    if request.query_params.get("wait") == "1":
        return await _do_sync(trigger)
    asyncio.create_task(_do_sync(trigger))
    return {"ok": True, "started": True}


# ── 3. Health / readiness (GET) — handy for the deploy smoke test ─────────────
@router.get("/status")
async def status():
    return {
        "ok": True,
        "ingest_enabled": _ingest_on(),
        "debug_enabled": _debug_on(),
        "verify_token_set": bool(_verify_token()),
        "app_secret_set": bool(_app_secret()),
        "supabase_configured": bool(_supabase_url()) and bool(os.environ.get("SUPABASE_SERVICE_ROLE_KEY")),
    }


# unix ts helper kept for parity with other routers (not currently needed).
def _now_iso() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).isoformat()
