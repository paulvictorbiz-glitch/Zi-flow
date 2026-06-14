"""
WhatsApp Business Cloud API router — DEPLOY TARGET: Hetzner backend.

This file does NOT run in the Vercel app. Copy it to the Hetzner backend at:
    /srv/footagebrain/footage-brain-test/backend/app/api/whatsapp.py
then register the router (see DEPLOY-CHECKLIST.md) and rebuild the container.

All secrets are read from environment variables — NOTHING is hardcoded:
    WHATSAPP_TOKEN                System User access token (Graph API)
    WHATSAPP_PHONE_NUMBER_ID      Phone Number ID
    WHATSAPP_BUSINESS_ACCOUNT_ID  WABA ID (stored on inbound messages)
    WHATSAPP_VERIFY_TOKEN         Webhook verification token
    SUPABASE_URL                  Supabase project URL
    SUPABASE_SERVICE_ROLE_KEY     Service role key (server-side only)

NOTE on the router pattern: this matches the conventional FastAPI APIRouter
style. Before deploying, open the existing backend/app/api/facebook.py and
confirm the prefix/registration convention matches (some codebases register the
"/api" prefix in main.py via include_router(prefix="/api"); others bake it into
each router). The full live paths must resolve to /api/auth/whatsapp/*.
"""

from __future__ import annotations

import os
import datetime as _dt
from typing import Any

import httpx
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse

# If facebook.py uses a different prefix convention, mirror it here.
router = APIRouter(prefix="/auth/whatsapp", tags=["whatsapp"])

GRAPH = "https://graph.facebook.com/v19.0"


# ── env helpers ──────────────────────────────────────────────────────────────
def _token() -> str | None:
    return os.environ.get("WHATSAPP_TOKEN")


def _phone_id() -> str | None:
    return os.environ.get("WHATSAPP_PHONE_NUMBER_ID")


def _waba_id() -> str | None:
    return os.environ.get("WHATSAPP_BUSINESS_ACCOUNT_ID")


def _verify_token() -> str | None:
    return os.environ.get("WHATSAPP_VERIFY_TOKEN")


def _supabase_headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }


def _supabase_url() -> str | None:
    return os.environ.get("SUPABASE_URL")


# ── 1. Webhook verification (GET) ─────────────────────────────────────────────
@router.get("/verify")
async def verify(request: Request):
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")
    if mode == "subscribe" and token and token == _verify_token():
        # Meta expects the raw challenge echoed back as text/plain, HTTP 200.
        return PlainTextResponse(challenge or "", status_code=200)
    return PlainTextResponse("forbidden", status_code=403)


# ── 2. Inbound messages (POST) ────────────────────────────────────────────────
@router.post("/webhook")
async def webhook(request: Request):
    """Receive incoming messages and persist them. ALWAYS returns 200 so Meta
    does not retry (retries cause duplicate inserts)."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": True}, status_code=200)

    try:
        entry = (body.get("entry") or [{}])[0]
        change = (entry.get("changes") or [{}])[0]
        value = change.get("value") or {}
        messages = value.get("messages") or []
        if not messages:
            # status update or non-message event — ack silently
            return JSONResponse({"ok": True}, status_code=200)

        contacts = value.get("contacts") or [{}]
        from_name = (contacts[0].get("profile") or {}).get("name")

        msg = messages[0]
        msg_id = msg.get("id")
        from_number = msg.get("from")
        msg_type = msg.get("type")
        ts_unix = msg.get("timestamp")

        body_text = None
        media_type = None
        media_id = None
        media_url = None

        if msg_type == "text":
            body_text = (msg.get("text") or {}).get("body")
        elif msg_type in ("image", "video", "document", "audio"):
            media_type = msg_type
            media_obj = msg.get(msg_type) or {}
            media_id = media_obj.get("id")
            body_text = media_obj.get("caption")
            if media_id and _token():
                media_url = await _resolve_media_url(media_id)

        # unix epoch (seconds, as string) → ISO timestamptz
        try:
            ts_iso = _dt.datetime.fromtimestamp(
                int(ts_unix), tz=_dt.timezone.utc
            ).isoformat()
        except Exception:
            ts_iso = _dt.datetime.now(tz=_dt.timezone.utc).isoformat()

        row = {
            "id": msg_id,
            "from_number": from_number,
            "from_name": from_name,
            "body": body_text,
            "media_type": media_type,
            "media_url": media_url,
            "media_id": media_id,
            "timestamp": ts_iso,
            "wa_account_id": _waba_id(),
        }
        await _insert_message(row)
    except Exception:
        # Never surface a 500 to Meta — would trigger duplicate retries.
        pass

    return JSONResponse({"ok": True}, status_code=200)


async def _resolve_media_url(media_id: str) -> str | None:
    """Exchange a media id for a short-lived signed download URL."""
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                f"{GRAPH}/{media_id}",
                headers={"Authorization": f"Bearer {_token()}"},
            )
            if r.status_code == 200:
                return (r.json() or {}).get("url")
    except Exception:
        return None
    return None


async def _insert_message(row: dict[str, Any]) -> None:
    url = _supabase_url()
    if not url:
        return
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            await client.post(
                f"{url}/rest/v1/whatsapp_messages",
                headers=_supabase_headers(),
                json=row,
            )
    except Exception:
        pass


# ── 3. Stored messages for the Inbox (GET) ────────────────────────────────────
@router.get("/messages")
async def messages():
    url = _supabase_url()
    if not url:
        return {"messages": []}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                f"{url}/rest/v1/whatsapp_messages"
                "?select=*&order=timestamp.desc&limit=50",
                headers=_supabase_headers(),
            )
            if r.status_code == 200:
                return {"messages": r.json()}
    except Exception:
        pass
    return {"messages": []}


# ── 4. Connection status (GET) ────────────────────────────────────────────────
@router.get("/status")
async def status():
    phone_id = _phone_id()
    if not phone_id:
        return {"connected": False}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                f"{GRAPH}/{phone_id}",
                params={"fields": "display_phone_number,verified_name,quality_rating"},
                headers={"Authorization": f"Bearer {_token()}"},
            )
            if r.status_code != 200:
                return {"connected": False, "error": r.text}
            d = r.json()
            return {
                "connected": True,
                "phone_number_id": phone_id,
                "display_phone_number": d.get("display_phone_number"),
                "verified_name": d.get("verified_name"),
                "quality_rating": d.get("quality_rating"),
            }
    except Exception as e:  # noqa: BLE001
        return {"connected": False, "error": str(e)}


# ── 5. Usage for the Monitor tab (GET) ────────────────────────────────────────
@router.get("/usage")
async def usage():
    st = await status()
    # First day of next calendar month, ISO.
    now = _dt.datetime.now(tz=_dt.timezone.utc)
    if now.month == 12:
        reset = now.replace(year=now.year + 1, month=1, day=1,
                            hour=0, minute=0, second=0, microsecond=0)
    else:
        reset = now.replace(month=now.month + 1, day=1,
                            hour=0, minute=0, second=0, microsecond=0)
    return {
        "configured": bool(_token()),
        # Per-conversation counts are not queryable on the free tier — surface 0.
        "conversations_used": 0,
        "conversations_limit": 1000,
        "quota_resets": reset.isoformat(),
        "display_phone_number": st.get("display_phone_number"),
        "verified_name": st.get("verified_name"),
    }


# ── 6. Send a reply (POST) ────────────────────────────────────────────────────
@router.post("/reply")
async def reply(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)

    to = body.get("to")
    message = body.get("message")
    phone_id = _phone_id()
    if not to or not message:
        return JSONResponse({"error": "to and message required"}, status_code=400)
    if not phone_id or not _token():
        return JSONResponse({"error": "WhatsApp not configured"}, status_code=400)

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{GRAPH}/{phone_id}/messages",
                headers={
                    "Authorization": f"Bearer {_token()}",
                    "Content-Type": "application/json",
                },
                json={
                    "messaging_product": "whatsapp",
                    "to": to,
                    "type": "text",
                    "text": {"body": message},
                },
            )
            if r.status_code in (200, 201):
                return {"ok": True}
            return JSONResponse({"error": r.text}, status_code=502)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)}, status_code=502)
