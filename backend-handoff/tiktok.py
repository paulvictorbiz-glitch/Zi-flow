"""
TikTok analytics router (RapidAPI tiktok-api23) — DEPLOY TARGET: Hetzner backend.

This is the server-side proxy that keeps the RapidAPI key OUT of the browser
bundle. The frontend (social-client.js → fetchLiveTikTokAnalytics) calls
/fb/api/auth/tiktok/analytics, which the Vercel rewrite proxies to
api.footagebrain.com/api/auth/tiktok/analytics → this router. The key never
leaves the server.

Copy to: /srv/footagebrain/footage-brain-test/backend/app/api/tiktok.py
Register the router the same way as facebook.py (see DEPLOY-CHECKLIST.md).

Secrets are read from env — NOTHING hardcoded:
    TIKTOK_SEC_UID    personal page secUid
    RAPIDAPI_KEY      RapidAPI key
    RAPIDAPI_HOST     defaults to tiktok-api23.p.rapidapi.com
"""

from __future__ import annotations

import os

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/auth/tiktok", tags=["tiktok"])


def _sec_uid() -> str | None:
    return os.environ.get("TIKTOK_SEC_UID")


def _rapid_key() -> str | None:
    return os.environ.get("RAPIDAPI_KEY")


def _rapid_host() -> str:
    return os.environ.get("RAPIDAPI_HOST", "tiktok-api23.p.rapidapi.com")


@router.get("/status")
async def status():
    return {"connected": bool(_sec_uid() and _rapid_key())}


@router.get("/analytics")
async def analytics():
    """Fetch recent videos for the configured secUid and return aggregated
    totals. Returns {connected: false} when not configured so the frontend
    transparently shows its empty state."""
    sec_uid = _sec_uid()
    key = _rapid_key()
    host = _rapid_host()
    if not sec_uid or not key:
        return {"connected": False}

    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(
                f"https://{host}/api/user/oldest-posts",
                params={"secUid": sec_uid, "count": 30, "cursor": 0},
                headers={
                    "x-rapidapi-host": host,
                    "x-rapidapi-key": key,
                },
            )
            if r.status_code != 200:
                return JSONResponse(
                    {"connected": True, "error": f"rapidapi {r.status_code}",
                     "videos": [], "totals": _empty_totals(),
                     "videoCount": 0, "topVideo": None},
                    status_code=200,
                )
            d = r.json()
            videos = d.get("itemList") or []
            totals = _empty_totals()
            for v in videos:
                stats = v.get("stats") or {}
                totals["views"] += int(stats.get("playCount") or 0)
                totals["likes"] += int(stats.get("diggCount") or 0)
                totals["comments"] += int(stats.get("commentCount") or 0)
                totals["shares"] += int(stats.get("shareCount") or 0)
            top = None
            if videos:
                top = max(
                    videos,
                    key=lambda v: int((v.get("stats") or {}).get("playCount") or 0),
                )
            return {
                "connected": True,
                "platform": "tiktok",
                "videos": videos,
                "totals": totals,
                "videoCount": len(videos),
                "topVideo": top,
            }
    except Exception as e:  # noqa: BLE001
        return JSONResponse(
            {"connected": True, "error": str(e), "videos": [],
             "totals": _empty_totals(), "videoCount": 0, "topVideo": None},
            status_code=200,
        )


def _empty_totals() -> dict[str, int]:
    return {"views": 0, "likes": 0, "comments": 0, "shares": 0}
