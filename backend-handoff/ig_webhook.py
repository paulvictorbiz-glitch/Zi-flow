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
    return os.environ.get("META_APP_SECRET")


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
        # Dedupe: a repeated DM of the same message (Meta retries) must not create a
        # second row. external_ref carries the IG message id; the partial unique
        # index reel_dna_external_ref_uidx is the arbiter.
        "Prefer": "resolution=ignore-duplicates,return=minimal",
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
    Instagram messaging uses entry[].messaging[]; we tolerate the Messenger-style
    entry[].changes[].value.messages[] shape too, just in case."""
    for entry in body.get("entry") or []:
        for m in entry.get("messaging") or []:
            yield m
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            for m in value.get("messages") or []:
                yield m


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


async def _insert_reel_dna(row: dict[str, Any]) -> None:
    url = _supabase_url()
    if not url:
        log.warning("ig_webhook: SUPABASE_URL unset — cannot insert")
        return
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.post(
                f"{url}/rest/v1/reel_dna?on_conflict=external_ref",
                headers=_supabase_headers(),
                json=row,
            )
            if r.status_code not in (200, 201, 204):
                log.warning("ig_webhook: insert HTTP %s: %s", r.status_code, r.text[:300])
    except Exception as e:  # noqa: BLE001
        log.warning("ig_webhook: insert failed: %s", e)


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
