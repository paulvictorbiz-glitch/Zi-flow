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
            "platform": "ig",
            "source": "ig_dm",
            "status": "captured",
            "external_ref": mid,            # dedupe key
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
            "platform": "ig",
            "source": "ig_dm",
            "status": "captured",
            "external_ref": (mid + "-dbg") if mid else None,
            "quick_notes": ("RAW_IG_EVENT: " + json.dumps(event))[:1800],
        }
        await _insert_reel_dna(row)
        log.info("ig_webhook: DEBUG captured raw event (mid=%s, no url)", mid)


async def _insert_reel_dna(row: dict[str, Any]) -> bool:
    """Insert a reel_dna row via the service role. Returns True iff a NEW row was
    created (409 = already captured → False)."""
    url = _supabase_url()
    if not url:
        log.warning("ig_webhook: SUPABASE_URL unset — cannot insert")
        return False
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
                return False
            if r.status_code in (200, 201, 204):
                return True
            log.warning("ig_webhook: insert HTTP %s: %s", r.status_code, r.text[:300])
            return False
    except Exception as e:  # noqa: BLE001
        log.warning("ig_webhook: insert failed: %s", e)
        return False


# ── 2b. Poll-based sync (works WITHOUT app publishing / App Review) ───────────
# Real IG DM webhooks only fire once the app is published + review-approved. Until
# then we POLL the Page's Instagram inbox (the Business-Suite conversations) with
# the stored Page token — the shared reel's permalink is in shares.data[].link, and
# the tag note is the adjacent text message from the same sender. Idempotent: each
# share message id is the dedupe key, so re-runs are cheap (409 → skip).
GRAPH = "https://graph.facebook.com/v21.0"


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
    params["access_token"] = token
    try:
        r = await client.get(f"{GRAPH}/{path}", params=params)
        if r.status_code != 200:
            return {"_err": r.status_code, "body": r.text[:200]}
        return r.json()
    except Exception as e:  # noqa: BLE001
        return {"_err": str(e)}


async def _list_ig_conversations(client, pid: str, tok: str, cap: int = 25) -> list[str]:
    """List Instagram conversation ids for a Page, ONE per page-request following
    the `next` cursor. The conversations edge 500s when asked for many at once
    (subcode 99), but limit=1 + pagination is reliable."""
    ids: list[str] = []
    next_url = None
    for _ in range(cap):
        try:
            if next_url:
                r = await client.get(next_url)
            else:
                r = await client.get(
                    f"{GRAPH}/{pid}/conversations",
                    params={"platform": "instagram", "fields": "id",
                            "limit": 1, "access_token": tok})
        except Exception as e:  # noqa: BLE001
            log.warning("ig_webhook sync: conversations fetch error: %s", e)
            break
        if r.status_code != 200:
            # 400 = page has no IG account (skip silently); else log once
            if r.status_code != 400:
                log.warning("ig_webhook sync: conversations HTTP %s: %s", r.status_code, r.text[:160])
            break
        j = r.json()
        for c in (j.get("data") or []):
            if c.get("id"):
                ids.append(c["id"])
        next_url = (j.get("paging") or {}).get("next")
        if not next_url:
            break
    return ids


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
            "&order=created_at.desc&limit=2000",
            headers=_supabase_headers())
        if r.status_code == 200:
            return {row.get("external_ref") for row in r.json() if row.get("external_ref")}
    except Exception as e:  # noqa: BLE001
        log.warning("ig_webhook sync: ext-ref preload failed: %s", e)
    return set()


async def _do_sync() -> dict:
    reels_seen = 0
    inserted = 0
    convs_total = 0
    async with httpx.AsyncClient(timeout=40) as client:
        known = await _existing_ext_refs(client)   # skip already-captured reels
        for pid, tok in _page_tokens():
            cids = await _list_ig_conversations(client, pid, tok, cap=15)
            convs_total += len(cids)
            for cid in cids:
                md = await _graph_get(
                    client, cid, tok,
                    fields="messages.limit(25){id,created_time,from,message,shares{link}}")
                msgs = ((md.get("messages") or {}).get("data")) or []
                # index the text notes by sender for nearest-time pairing
                notes = [(_parse_ts(m.get("created_time", "")),
                          (m.get("from") or {}).get("id"),
                          (m.get("message") or "").strip())
                         for m in msgs if (m.get("message") or "").strip()]
                for m in msgs:
                    shares = ((m.get("shares") or {}).get("data")) or []
                    link = shares[0].get("link") if shares else None
                    if not link:
                        continue
                    reels_seen += 1
                    mid = m.get("id")
                    if mid in known:        # already captured — no Supabase write
                        continue
                    ts = _parse_ts(m.get("created_time", ""))
                    sender = (m.get("from") or {}).get("id")
                    # nearest same-sender text note within 25s becomes the tag note
                    cand = sorted((abs(nt - ts), tx) for nt, ns, tx in notes
                                  if ns == sender and abs(nt - ts) <= 25)
                    note = cand[0][1] if cand else None
                    if await _insert_reel_dna({
                        "reel_url": link, "platform": "ig", "source": "ig_dm",
                        "status": "captured", "external_ref": mid,
                        "quick_notes": note,
                    }):
                        inserted += 1
                        known.add(mid)
    log.info("ig_webhook sync: convs=%s reels_seen=%s inserted=%s",
             convs_total, reels_seen, inserted)
    return {"ok": True, "conversations": convs_total,
            "reels_seen": reels_seen, "inserted": inserted}


@router.api_route("/sync", methods=["GET", "POST"])
async def sync(request: Request):
    """Pull recent Instagram DMs from the Page inbox and capture shared reels.
    Gated by ?secret= matching IG_SYNC_SECRET. Returns immediately and runs in the
    background (the cron path); pass ?wait=1 to run synchronously for debugging."""
    want = os.environ.get("IG_SYNC_SECRET")
    if want and request.query_params.get("secret") != want:
        return JSONResponse({"error": "forbidden"}, status_code=403)
    if request.query_params.get("wait") == "1":
        return await _do_sync()
    asyncio.create_task(_do_sync())
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
