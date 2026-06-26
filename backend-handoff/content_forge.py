"""
Content Forge — AI content discovery + hook generation — DEPLOY TARGET: Hetzner backend.

This file does NOT run in the Vercel app. Copy it to the Hetzner backend at:
    /srv/footagebrain/footage-brain-test/backend/app/api/content_forge.py
then REGISTER THE ROUTER in the live app's main module (the human deploy step):
    from app.api import content_forge
    app.include_router(content_forge.router, prefix="/api")     # → /api/content-forge/*
(mirror the include convention facebook.py / ig_webhook.py / reel_deconstruct.py use —
this router declares prefix="/content-forge", assuming "/api" is added at include_router.
If those routers bake "/api" into their own prefix instead, change the prefix below to
"/api/content-forge".) Then rebuild the container from deploy/hetzner (see
reference_hetzner-fb-backend-compose). The edge proxy must forward /api/content-forge/*
to backend:8000 — if /api/* isn't already wildcarded in the Caddyfile, add a
`handle /api/content-forge/*` block + `docker exec fb-caddy caddy reload`.

WHAT IT DOES
------------
v1 lean core of the flagship "Content Forge" pipeline:
  1. ingest-transcript — pull already-transcribed footage into a unified `transcript_clips`
     table. Source = BOTH: (a) Supabase `attached_footage_items.full_transcript` rows
     (migration 0024, shape [{text, start_time, end_time, score}]) read directly, AND
     (b) — only when CONTENT_FORGE_TRANSCRIPT_DIR is set — loose disk files on the box
     (Whisper-JSON segments[].{start,end,text} / SRT / plain-text), parsed with the same
     _parse_vtt/_transcribe idioms reel_deconstruct.py uses. The disk branch is a strict
     no-op when the env var is unset (path/format on Hetzner is unconfirmed).
  2. discover — read transcript_clips, run ONE batched LLM pass to surface ranked content
     opportunities (S/A/B/C virality tiers), upsert into `content_opportunities`. Fire-and-
     forget; returns a batch_id the frontend polls.
  3. expand — synchronously generate EXACTLY 3 hook versions (curiosity / controversy /
     personal_stakes) for one opportunity, with OPTIONAL Tavily fact-check grounding that
     degrades gracefully on 429/quota. Writes hook_versions JSONB back onto the row.

PROVIDER SEAM (the important bit): `_forge_llm(messages, *, tier, kind)` is the ONLY place
the LLM provider is chosen. `tier="free"` (default) reuses the existing FREE OpenRouter
Gemini client/key (OPENROUTER_API_KEY) — same idiom as reel_deconstruct.run_narrative().
`tier="pro"` uses the `anthropic` SDK: claude-haiku-4-5 for kind=="discovery",
claude-sonnet-4-6 for kind=="expansion" (ANTHROPIC_API_KEY). If "pro" is requested but
ANTHROPIC_API_KEY is missing, it FALLS BACK to free and records that in the result.

SECRET GATE: every endpoint compares a ?secret= query param to CONTENT_FORGE_SECRET and
returns 401 on missing/mismatch — mirrors ig_webhook's IG_SYNC_SECRET gate, so a curl
without the secret returns 401 (matches the deploy smoke test:
    curl -o /dev/null -s -w "%{http_code}" https://api.footagebrain.com/api/content-forge/health
    # expect 401).

All secrets are read from environment variables — NOTHING is hardcoded:
    CONTENT_FORGE_SECRET           Shared secret gating every endpoint (?secret=…)
    SUPABASE_URL                   Supabase project URL
    SUPABASE_SERVICE_ROLE_KEY      Service role key (server-side only)
    OPENROUTER_API_KEY             FREE-tier OpenRouter key (default "free" provider)
    ANTHROPIC_API_KEY              Claude key for the "pro" tier (optional → free fallback)
    TAVILY_API_KEY                 (optional) Tavily grounding for expansion; absent → skip
    CONTENT_FORGE_TRANSCRIPT_DIR   (optional) base dir for disk-file transcript ingest;
                                   UNSET → the disk branch is a no-op (Supabase-only)
    CONTENT_FORGE_MODEL_FREE       (optional) override the OpenRouter model id (free tier)
    CONTENT_FORGE_MODEL_DISCOVERY  (optional) override the pro discovery model (Haiku)
    CONTENT_FORGE_MODEL_EXPANSION  (optional) override the pro expansion model (Sonnet)

`httpx` and `anthropic` are the only external deps used here — both in
requirements-hosting.txt (anthropic added alongside this file).
"""

from __future__ import annotations

import os
import re
import json
import uuid
import logging
import datetime as _dt
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse

log = logging.getLogger("content_forge")

# This router declares prefix="/content-forge", assuming "/api" is added at
# include_router(prefix="/api") in the live app's main module (the human deploy step
# noted in the module docstring). If facebook.py / ig_webhook.py bake "/api" into their
# own prefix instead, change this to "/api/content-forge" so the live paths resolve to
# /api/content-forge/*.
router = APIRouter(prefix="/content-forge", tags=["content-forge"])

# ── FREE provider (OpenRouter, OpenAI-compatible) — mirrors reel_deconstruct.py ─────
OPENROUTER_BASE = "https://openrouter.ai/api/v1"
# Ordered fallback chain of free OpenRouter models. Free models get rate-limited
# (429) or retired (404) upstream with no warning (e.g. google/gemini-2.0-flash-exp
# :free was removed; llama-3.3-70b:free 429s under load), so the free path tries
# each in turn and only fails if ALL are unavailable. CONTENT_FORGE_MODEL_FREE, if
# set, is tried FIRST. Keep these to currently-available ':free' chat models.
DEFAULT_FREE_MODELS = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "openai/gpt-oss-120b:free",
]
DEFAULT_FREE_MODEL = DEFAULT_FREE_MODELS[0]   # primary (shown in /health)

# ── PRO provider (Anthropic) — model ids per kind ───────────────────────────────────
# Haiku 4.5 for cheap/fast batched discovery; Sonnet 4.6 for higher-quality hook writing.
# Exact, complete model-id strings (no date suffixes).
DEFAULT_DISCOVERY_MODEL = "claude-haiku-4-5"
DEFAULT_EXPANSION_MODEL = "claude-sonnet-4-6"

# ── Tavily grounding ────────────────────────────────────────────────────────────────
TAVILY_URL = "https://api.tavily.com/search"

# Timeouts (seconds)
LLM_TIMEOUT = 120            # one discovery/expansion LLM pass
TAVILY_TIMEOUT = 10          # keep grounding short — never block hook generation
SUPABASE_TIMEOUT = 20        # service-role REST reads/writes

# Guardrails
MAX_CLIPS_FOR_DISCOVERY = 400      # cap clips fed to one discovery pass (token budget)
DISCOVERY_TRANSCRIPT_CHARS = 24000  # max chars of flattened transcript in the prompt
HOOK_STYLES = ("curiosity", "controversy", "personal_stakes")  # EXACTLY these 3, in order


# ── env helpers ──────────────────────────────────────────────────────────────────────
def _secret() -> str | None:
    return os.environ.get("CONTENT_FORGE_SECRET")


def _supabase_url() -> str | None:
    return os.environ.get("SUPABASE_URL")


def _openrouter_key() -> str | None:
    return os.environ.get("OPENROUTER_API_KEY")


def _anthropic_key() -> str | None:
    return os.environ.get("ANTHROPIC_API_KEY")


def _tavily_key() -> str | None:
    return os.environ.get("TAVILY_API_KEY")


def _transcript_dir() -> str | None:
    """Base dir for the OPTIONAL disk-file transcript ingest branch. Returns None unless
    CONTENT_FORGE_TRANSCRIPT_DIR is set AND points at an existing directory — so a stale
    path silently degrades to Supabase-only ingest rather than erroring. The disk branch
    is intentionally gated behind this because the real path/format on Hetzner is
    unconfirmed (see the v1 plan's open decision)."""
    p = (os.environ.get("CONTENT_FORGE_TRANSCRIPT_DIR") or "").strip()
    return p if (p and os.path.isdir(p)) else None


def _free_models() -> list[str]:
    """Ordered free-model fallback chain. CONTENT_FORGE_MODEL_FREE (if set) is tried
    first, then DEFAULT_FREE_MODELS. Deduped, order-preserving."""
    override = (os.environ.get("CONTENT_FORGE_MODEL_FREE") or "").strip()
    chain = ([override] if override else []) + DEFAULT_FREE_MODELS
    seen: set[str] = set()
    out: list[str] = []
    for m in chain:
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


def _free_model() -> str:
    """Primary free model (first in the fallback chain) — shown in /health output."""
    return _free_models()[0]


def _discovery_model() -> str:
    return (os.environ.get("CONTENT_FORGE_MODEL_DISCOVERY") or "").strip() or DEFAULT_DISCOVERY_MODEL


def _expansion_model() -> str:
    return (os.environ.get("CONTENT_FORGE_MODEL_EXPANSION") or "").strip() or DEFAULT_EXPANSION_MODEL


def _now_iso() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).isoformat()


def _supabase_headers(prefer: str = "return=minimal") -> dict[str, str]:
    """Service-role PostgREST headers — same idiom as ig_webhook._supabase_headers /
    reel_deconstruct._supabase_headers (apikey + Bearer service-role key)."""
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def _check_secret(request: Request) -> bool:
    """True only when CONTENT_FORGE_SECRET is set AND the ?secret= query param matches it.
    Mirrors ig_webhook's IG_SYNC_SECRET gate: a missing/unset secret or a mismatch is a
    hard 401 (no fail-open), so an unauthenticated curl to /health returns 401."""
    want = _secret()
    got = request.query_params.get("secret")
    return bool(want) and got == want


# ── transcript parsing (reuses reel_deconstruct.py idioms) ────────────────────────────
_VTT_TS = re.compile(
    r"(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})")
_VTT_TAG = re.compile(r"<[^>]+>")            # inline <c> / <00:00:00.000> timing tags
_HTML_AMP = {"&amp;": "&", "&lt;": "<", "&gt;": ">", "&#39;": "'", "&quot;": '"'}


def _clean_caption_line(line: str) -> str:
    line = _VTT_TAG.sub("", line)
    for k, v in _HTML_AMP.items():
        line = line.replace(k, v)
    return line.strip()


def _ts_to_seconds(h: str, mi: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(mi) * 60 + int(s) + int(ms) / 1000.0


def _parse_vtt(raw: str) -> list[dict[str, Any]]:
    """Parse WebVTT / SRT cue text into [{start, end, text}] (seconds). Adapted from
    reel_deconstruct._parse_vtt — but keeps the cue END too (Content Forge clips need a
    [start, end] window, not just a start). De-dupes YouTube's rolling-duplicate lines.
    Returns [] on any trouble."""
    segments: list[dict[str, Any]] = []
    blocks = re.split(r"\n\s*\n", raw)
    last_text = ""
    for block in blocks:
        lines = [ln for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        start = end = None
        text_parts: list[str] = []
        for ln in lines:
            m = _VTT_TS.search(ln)
            if m:
                start = _ts_to_seconds(m.group(1), m.group(2), m.group(3), m.group(4))
                end = _ts_to_seconds(m.group(5), m.group(6), m.group(7), m.group(8))
                continue
            up = ln.strip().upper()
            if up in ("WEBVTT",) or ln.strip().startswith(("NOTE", "Kind:", "Language:")):
                continue
            # SRT sequence-number lines (a bare integer) carry no text — skip them.
            if ln.strip().isdigit() and start is None:
                continue
            cleaned = _clean_caption_line(ln)
            if cleaned:
                text_parts.append(cleaned)
        if start is None or not text_parts:
            continue
        text = " ".join(text_parts).strip()
        if not text or text == last_text:
            continue
        last_text = text
        segments.append({"start": float(start), "end": float(end if end is not None else start),
                         "text": text})
    return segments


def _parse_whisper_json(raw: str) -> list[dict[str, Any]]:
    """Parse a Whisper-style JSON transcript: a top-level object with `segments`, each
    {start, end, text}. Also tolerates a bare list of those segment objects. Returns
    [{start, end, text}] (seconds); [] on any trouble."""
    try:
        obj = json.loads(raw)
    except Exception:  # noqa: BLE001
        return []
    if isinstance(obj, dict):
        segs = obj.get("segments")
    elif isinstance(obj, list):
        segs = obj
    else:
        segs = None
    if not isinstance(segs, list):
        return []
    out: list[dict[str, Any]] = []
    for s in segs:
        if not isinstance(s, dict):
            continue
        txt = (s.get("text") or "").strip()
        if not txt:
            continue
        try:
            start = float(s.get("start") or 0.0)
            end = float(s.get("end") if s.get("end") is not None else start)
        except (TypeError, ValueError):
            continue
        out.append({"start": start, "end": end, "text": txt})
    return out


def _transcribe_disk_file(path: str) -> list[dict[str, Any]]:
    """Parse ONE on-disk transcript file into [{start, end, text}], trying formats in
    order: Whisper-JSON (.json), WebVTT/SRT cues, then a plain-text fallback (whole file
    as one [0,0] segment). Mirrors reel_deconstruct._transcribe's prefer-structured-then-
    fall-back shape. Best-effort: returns [] on a read error."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            raw = fh.read()
    except Exception as e:  # noqa: BLE001
        log.warning("content_forge: disk transcript read failed (%s): %s", path, e)
        return []
    low = path.lower()
    if low.endswith(".json"):
        segs = _parse_whisper_json(raw)
        if segs:
            return segs
    if low.endswith((".vtt", ".srt")) or "-->" in raw:
        segs = _parse_vtt(raw)
        if segs:
            return segs
    # Plain-text fallback: treat the whole file as one clip with an unknown window.
    text = raw.strip()
    return [{"start": 0.0, "end": 0.0, "text": text}] if text else []


def _extract_keywords(text: str, *, limit: int = 8) -> list[str]:
    """Cheap, dependency-free keyword guess for a clip: the most frequent lowercased word
    tokens minus a small stopword set. Purely a coarse index aid — discovery's LLM pass
    does the real topical work. Deterministic (ties broken by first appearance)."""
    stop = {
        "the", "and", "for", "are", "but", "not", "you", "your", "with", "this", "that",
        "have", "has", "had", "was", "were", "they", "them", "from", "what", "when",
        "will", "would", "could", "should", "about", "into", "just", "like", "really",
        "there", "their", "then", "than", "been", "because", "which", "while", "where",
        "here", "some", "more", "most", "very", "much", "also", "only", "even", "well",
        "get", "got", "going", "gonna", "yeah", "okay", "its", "it's", "i'm", "dont",
    }
    counts: dict[str, int] = {}
    order: list[str] = []
    for tok in re.findall(r"[a-zA-Z][a-zA-Z'\-]{2,}", (text or "").lower()):
        if tok in stop:
            continue
        if tok not in counts:
            order.append(tok)
        counts[tok] = counts.get(tok, 0) + 1
    # NB: precompute first-appearance positions BEFORE sorting. Do NOT call
    # order.index(w) inside the sort key — CPython empties the list in place
    # during list.sort() (its mutation guard), so .index() raises ValueError
    # ("<w> is not in list") and crashes the whole ingest/keyword pass.
    pos = {w: i for i, w in enumerate(order)}
    order.sort(key=lambda w: (-counts[w], pos[w]))
    return order[:limit]


# ── service-role Supabase REST helpers ────────────────────────────────────────────────
async def _fetch_footage_transcripts(client: httpx.AsyncClient, reel_id: str | None,
                                     footage: str | None) -> list[dict[str, Any]]:
    """Read attached_footage_items rows carrying full_transcript (migration 0024, shape
    [{text, start_time, end_time, score}]). Filters by reel_id when given, else by a
    specific footage file id (`footage`), else pulls a bounded recent window. Returns the
    raw rows (id + filename + full_transcript). Best-effort: [] on error/misconfig."""
    url = _supabase_url()
    if not url:
        log.warning("content_forge: SUPABASE_URL unset — cannot read footage transcripts")
        return []
    q = ("select=id,filename,reel_id,full_transcript"
         "&full_transcript=not.is.null&order=created_at.desc&limit=2000")
    if reel_id:
        q += f"&reel_id=eq.{reel_id}"
    elif footage:
        q += f"&id=eq.{footage}"
    try:
        r = await client.get(
            f"{url}/rest/v1/attached_footage_items?{q}",
            headers=_supabase_headers(),
        )
        if r.status_code == 200:
            data = r.json()
            return data if isinstance(data, list) else []
        log.warning("content_forge: footage fetch HTTP %s: %s", r.status_code, r.text[:300])
    except Exception as e:  # noqa: BLE001
        log.warning("content_forge: footage fetch failed: %s", e)
    return []


async def _upsert_transcript_clips(client: httpx.AsyncClient,
                                   clips: list[dict[str, Any]]) -> int:
    """Upsert transcript_clips rows, deduped on a STABLE composite key
    (footage_file_id, start_time, end_time) so re-running ingest is idempotent. Requires a
    FULL unique index on those columns to act as the on_conflict arbiter (the DB team owns
    that). PostgREST bulk upsert in chunks; returns the count attempted (best-effort)."""
    url = _supabase_url()
    if not url or not clips:
        return 0
    written = 0
    headers = {**_supabase_headers("return=minimal"), "Prefer": "resolution=merge-duplicates"}
    # Chunk to keep request bodies reasonable.
    for i in range(0, len(clips), 200):
        chunk = clips[i:i + 200]
        try:
            r = await client.post(
                f"{url}/rest/v1/transcript_clips"
                "?on_conflict=footage_file_id,start_time,end_time",
                headers=headers,
                json=chunk,
            )
            if r.status_code in (200, 201, 204):
                written += len(chunk)
            else:
                log.warning("content_forge: clip upsert HTTP %s: %s",
                            r.status_code, r.text[:300])
        except Exception as e:  # noqa: BLE001
            log.warning("content_forge: clip upsert failed: %s", e)
    return written


async def _count_clips(client: httpx.AsyncClient, reel_id: str | None) -> int:
    """Count transcript_clips (optionally for the footage of a given reel_id). Uses the
    PostgREST Prefer: count=exact header + Content-Range parsing."""
    url = _supabase_url()
    if not url:
        return 0
    q = "select=id"
    if reel_id:
        # transcript_clips has no reel_id column (soft footage_file_id ref). Scope by the
        # footage ids that belong to this reel.
        foot = await _fetch_footage_transcripts(client, reel_id, None)
        ids = [str(f.get("id")) for f in foot if f.get("id")]
        if not ids:
            return 0
        in_list = ",".join(ids)
        q += f"&footage_file_id=in.({in_list})"
    try:
        r = await client.get(
            f"{url}/rest/v1/transcript_clips?{q}&limit=1",
            headers={**_supabase_headers(), "Prefer": "count=exact", "Range-Unit": "items",
                     "Range": "0-0"},
        )
        # Content-Range: "0-0/<total>" (or "*/<total>")
        cr = r.headers.get("content-range") or r.headers.get("Content-Range") or ""
        if "/" in cr:
            total = cr.rsplit("/", 1)[-1].strip()
            if total.isdigit():
                return int(total)
    except Exception as e:  # noqa: BLE001
        log.warning("content_forge: clip count failed: %s", e)
    return 0


async def _read_clips_for_discovery(client: httpx.AsyncClient,
                                    limit: int = MAX_CLIPS_FOR_DISCOVERY) -> list[dict[str, Any]]:
    """Read a bounded recent window of transcript_clips for a discovery pass."""
    url = _supabase_url()
    if not url:
        return []
    try:
        r = await client.get(
            f"{url}/rest/v1/transcript_clips"
            f"?select=id,footage_file_id,filename,start_time,end_time,transcript_text,"
            f"keywords,topics&order=created_at.desc&limit={int(limit)}",
            headers=_supabase_headers(),
        )
        if r.status_code == 200:
            data = r.json()
            return data if isinstance(data, list) else []
        log.warning("content_forge: clip read HTTP %s: %s", r.status_code, r.text[:300])
    except Exception as e:  # noqa: BLE001
        log.warning("content_forge: clip read failed: %s", e)
    return []


async def _upsert_opportunities(client: httpx.AsyncClient,
                                rows: list[dict[str, Any]]) -> int:
    """Upsert content_opportunities deduped on the FULL unique index arbiter
    (discovery_run_id, country, title) WHERE discovery_run_id IS NOT NULL (the DB team
    owns the index; per the 42P10 gotcha it must be a FULL unique index). merge-duplicates
    so a re-run of the SAME batch updates rather than erroring. Returns count attempted."""
    url = _supabase_url()
    if not url or not rows:
        return 0
    headers = {**_supabase_headers("return=minimal"), "Prefer": "resolution=merge-duplicates"}
    try:
        r = await client.post(
            f"{url}/rest/v1/content_opportunities"
            "?on_conflict=discovery_run_id,country,title",
            headers=headers,
            json=rows,
        )
        if r.status_code in (200, 201, 204):
            return len(rows)
        log.warning("content_forge: opportunity upsert HTTP %s: %s", r.status_code, r.text[:300])
    except Exception as e:  # noqa: BLE001
        log.warning("content_forge: opportunity upsert failed: %s", e)
    return 0


async def _read_opportunities_for_batch(client: httpx.AsyncClient,
                                        batch_id: str) -> list[dict[str, Any]]:
    url = _supabase_url()
    if not url:
        return []
    try:
        r = await client.get(
            f"{url}/rest/v1/content_opportunities"
            f"?discovery_run_id=eq.{batch_id}"
            "&order=virality_score.desc&limit=200",
            headers=_supabase_headers(),
        )
        if r.status_code == 200:
            data = r.json()
            return data if isinstance(data, list) else []
        log.warning("content_forge: batch read HTTP %s: %s", r.status_code, r.text[:300])
    except Exception as e:  # noqa: BLE001
        log.warning("content_forge: batch read failed: %s", e)
    return []


async def _read_opportunity(client: httpx.AsyncClient, opp_id: str) -> dict[str, Any] | None:
    url = _supabase_url()
    if not url:
        return None
    try:
        r = await client.get(
            f"{url}/rest/v1/content_opportunities?id=eq.{opp_id}&limit=1",
            headers=_supabase_headers(),
        )
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list) and data:
                return data[0]
    except Exception as e:  # noqa: BLE001
        log.warning("content_forge: opportunity read failed: %s", e)
    return None


async def _patch_opportunity(client: httpx.AsyncClient, opp_id: str,
                             fields: dict[str, Any]) -> bool:
    url = _supabase_url()
    if not url:
        return False
    try:
        r = await client.patch(
            f"{url}/rest/v1/content_opportunities?id=eq.{opp_id}",
            headers=_supabase_headers("return=minimal"),
            json=fields,
        )
        if r.status_code in (200, 204):
            return True
        log.warning("content_forge: opportunity patch HTTP %s: %s", r.status_code, r.text[:300])
    except Exception as e:  # noqa: BLE001
        log.warning("content_forge: opportunity patch failed: %s", e)
    return False


# ── PROVIDER SEAM ─────────────────────────────────────────────────────────────────────
# _forge_llm() is the ONLY place the LLM provider is chosen. tier="free" reuses the
# existing FREE OpenRouter Gemini path (OpenAI-compatible chat completions) — the exact
# idiom reel_deconstruct.run_narrative() uses. tier="pro" calls the Anthropic Messages API
# (claude-haiku-4-5 for discovery, claude-sonnet-4-6 for expansion). If "pro" is requested
# but ANTHROPIC_API_KEY is missing, we transparently fall back to free.
#
# Returns (text, meta) where meta = {provider, model, tier_used, fell_back} so callers can
# stamp provenance / surface a "fell back to free" note.

_SYSTEM_BY_KIND = {
    "discovery": (
        "You are a viral short-form content strategist for a creator. You read a batch of "
        "timestamped footage transcript clips and surface the highest-potential CONTENT "
        "OPPORTUNITIES — distinct angles worth turning into a reel. You reply with STRICT "
        "JSON ONLY: no prose, no code fences."
    ),
    "expansion": (
        "You are a retention-obsessed hook writer for short-form video. Given one content "
        "opportunity (and optional grounding facts), you write opening hooks engineered to "
        "stop the scroll. You reply with STRICT JSON ONLY: no prose, no code fences."
    ),
}


def _forge_llm(messages: list[dict[str, str]], *, tier: str = "free",
               kind: str = "discovery") -> tuple[str, dict[str, Any]]:
    """PROVIDER SEAM — the ONLY place the Content Forge LLM provider is selected.

    `messages` is a chat-style [{role, content}] list (system + user). `tier` ∈ {free,pro}
    (default free). `kind` ∈ {discovery, expansion} selects the pro model.

      tier="free" → OpenRouter Gemini (OPENROUTER_API_KEY) over httpx.
      tier="pro"  → Anthropic SDK: claude-haiku-4-5 (discovery) / claude-sonnet-4-6
                    (expansion), via ANTHROPIC_API_KEY. Missing key → fall back to free.

    Returns (text, meta). Raises RuntimeError only when even the free path is unusable
    (no OPENROUTER_API_KEY), so callers always get a meaningful provider error."""
    tier = (tier or "free").strip().lower()
    if tier not in ("free", "pro"):
        tier = "free"

    fell_back = False
    if tier == "pro" and not _anthropic_key():
        # Pro requested but no Claude key configured → degrade to free, note it.
        log.info("content_forge: pro tier requested but ANTHROPIC_API_KEY unset — using free")
        tier = "free"
        fell_back = True

    if tier == "pro":
        model = _discovery_model() if kind == "discovery" else _expansion_model()
        text = _call_anthropic(messages, model=model)
        return text, {"provider": "anthropic", "model": model,
                      "tier_used": "pro", "fell_back": False}

    # FREE provider (OpenRouter) — try the fallback chain (429/404-resilient).
    text, used_model = _call_openrouter(messages, models=_free_models())
    return text, {"provider": "openrouter", "model": used_model,
                  "tier_used": "free", "fell_back": fell_back}


def _call_openrouter(messages: list[dict[str, str]], *, models: list[str] | str) -> tuple[str, str]:
    """FREE provider call — OpenRouter OpenAI-compatible chat completions over httpx.
    Same request/headers shape as reel_deconstruct.run_narrative().

    `models` is the ordered fallback chain (or a single id). Each model is tried in
    turn; a RETRYABLE upstream condition (404 model gone / 429 rate-limited / 5xx)
    falls through to the next model, while a hard client error (401/400) stops
    immediately. Returns (text, model_used). Raises RuntimeError only if EVERY model
    in the chain is unavailable, carrying the last error for diagnosis."""
    key = _openrouter_key()
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY unset — cannot run free-tier LLM pass")
    if isinstance(models, str):
        models = [models]
    if not models:
        raise RuntimeError("no free models configured")
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        # OpenRouter etiquette headers (optional, identify the app).
        "HTTP-Referer": "https://footagebrain.com",
        "X-Title": "FootageBrain Content Forge",
    }
    last_err = "no free model attempted"
    for model in models:
        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": 2400,
        }
        try:
            with httpx.Client(timeout=LLM_TIMEOUT) as client:
                r = client.post(f"{OPENROUTER_BASE}/chat/completions",
                                headers=headers, json=payload)
        except Exception as e:  # noqa: BLE001 — network blip → try next model
            last_err = f"OpenRouter request failed for {model}: {e}"
            log.info("content_forge: %s", last_err)
            continue
        if r.status_code == 200:
            data = r.json()
            try:
                return (data["choices"][0]["message"]["content"] or ""), model
            except Exception as e:  # noqa: BLE001 — odd body → try next model
                last_err = f"OpenRouter malformed response from {model}: {e}: {json.dumps(data)[:200]}"
                log.info("content_forge: %s", last_err)
                continue
        # 404 (model retired) / 429 (rate-limited) / 5xx (upstream) → next model.
        if r.status_code in (404, 408, 429, 500, 502, 503, 504):
            last_err = f"OpenRouter HTTP {r.status_code} for {model}: {r.text[:200]}"
            log.info("content_forge: %s — trying next free model", last_err)
            continue
        # Hard client error (401 bad key / 400 bad request) → no point retrying.
        raise RuntimeError(f"OpenRouter HTTP {r.status_code}: {r.text[:300]}")
    raise RuntimeError(f"all free models unavailable; last: {last_err}")


def _call_anthropic(messages: list[dict[str, str]], *, model: str) -> str:
    """PRO provider call — Anthropic Messages API via the `anthropic` SDK. Splits the
    chat-style messages into a top-level `system` string + user/assistant turns (the
    Messages API takes system separately). The large discovery system prompt carries a
    cache_control: {type: "ephemeral"} breakpoint so repeat discovery runs hit the prompt
    cache (it's padded well over the ~1024-token minimum; the short expansion prompt won't
    cache, which is fine). Imported lazily so this module loads even if `anthropic` isn't
    installed (the free-only deployments)."""
    key = _anthropic_key()
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY unset — cannot run pro-tier LLM pass")
    try:
        import anthropic  # type: ignore
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"anthropic SDK not installed: {e}")

    system_parts = [m.get("content", "") for m in messages if m.get("role") == "system"]
    convo = [{"role": m["role"], "content": m.get("content", "")}
             for m in messages if m.get("role") in ("user", "assistant")]
    if not convo:
        # Messages API requires at least one user turn; fold any system text in.
        convo = [{"role": "user", "content": "\n\n".join(system_parts) or ""}]

    # System as a cacheable content block (prefix-match prompt caching). The big discovery
    # prompt is padded past the minimum cacheable prefix; ephemeral is the default 5m TTL.
    system_text = "\n\n".join(p for p in system_parts if p)
    system_blocks = (
        [{"type": "text", "text": system_text, "cache_control": {"type": "ephemeral"}}]
        if system_text else None
    )

    client = anthropic.Anthropic(api_key=key)
    kwargs: dict[str, Any] = {
        "model": model,
        "max_tokens": 2400,
        "messages": convo,
    }
    if system_blocks is not None:
        kwargs["system"] = system_blocks
    resp = client.messages.create(**kwargs)

    # Concatenate text blocks (content is a list of typed blocks; guard on .type).
    parts: list[str] = []
    for block in (resp.content or []):
        if getattr(block, "type", None) == "text":
            parts.append(getattr(block, "text", "") or "")
    return "".join(parts)


# ── JSON extraction (robust to fences / surrounding prose) ────────────────────────────
def _extract_json(text: str) -> Any:
    """Pull a JSON value (object OR array) out of an LLM reply: strip ```json fences,
    tolerate surrounding prose, then brace/bracket-match the first balanced block. Adapted
    from reel_deconstruct._extract_json_object but also accepts a top-level array (the
    discovery pass returns a list of opportunities). Raises ValueError if nothing parses."""
    if not text:
        raise ValueError("empty LLM response")
    s = text.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", s, re.DOTALL)
    if fence:
        s = fence.group(1).strip()
    try:
        return json.loads(s)
    except Exception:
        pass
    # Brace/bracket-match the first balanced top-level container.
    for open_ch, close_ch in (("{", "}"), ("[", "]")):
        start = s.find(open_ch)
        while start != -1:
            depth = 0
            in_str = False
            esc = False
            for i in range(start, len(s)):
                ch = s[i]
                if in_str:
                    if esc:
                        esc = False
                    elif ch == "\\":
                        esc = True
                    elif ch == '"':
                        in_str = False
                    continue
                if ch == '"':
                    in_str = True
                elif ch == open_ch:
                    depth += 1
                elif ch == close_ch:
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(s[start:i + 1])
                        except Exception:
                            break
            start = s.find(open_ch, start + 1)
    raise ValueError("no JSON value found in LLM response")


def _clip_to_line(clip: dict[str, Any]) -> str:
    start = clip.get("start_time")
    try:
        ts = int(float(start)) if start is not None else 0
    except (TypeError, ValueError):
        ts = 0
    mm, ss = divmod(ts, 60)
    cid = clip.get("id") or ""
    txt = (clip.get("transcript_text") or "").strip().replace("\n", " ")
    return f"[{mm:02d}:{ss:02d}] (clip:{cid}) {txt}"


def _clips_to_prompt(clips: list[dict[str, Any]], *,
                     max_chars: int = DISCOVERY_TRANSCRIPT_CHARS) -> str:
    lines: list[str] = []
    total = 0
    for c in clips:
        line = _clip_to_line(c)
        if total + len(line) + 1 > max_chars:
            break
        lines.append(line)
        total += len(line) + 1
    return "\n".join(lines)


# ── discovery prompt (padded > 1024 tokens to engage prompt caching on the pro tier) ──
_DISCOVERY_GUIDANCE = """You surface CONTENT OPPORTUNITIES — distinct, postable angles — from raw footage transcripts.

VIRALITY TIERS (assign one per opportunity, with a 0.0-1.0 score):
  S (0.85-1.0): rare, highly shareable — a counter-intuitive truth, a dramatic reveal, a
     strong emotional spike, or a "you won't believe" moment with broad appeal.
  A (0.65-0.84): strong — a clear hook, a relatable tension, a useful/surprising takeaway.
  B (0.40-0.64): solid but niche, or a familiar angle executed well.
  C (0.0-0.39): weak — generic, low-stakes, or hard to hook.

WHAT MAKES A STRONG OPPORTUNITY (score against these signals):
  - A curiosity gap: it opens a loop the viewer needs closed.
  - Stakes: something is at risk, or the payoff is concrete and desirable.
  - Specificity: a concrete number, name, place, or vivid detail beats a vague claim.
  - Tension or contrast: a surprise, a reversal, a before/after, a myth busted.
  - Emotional charge: awe, outrage, relief, validation, fear-of-missing-out.
  - Relatability or aspiration: the viewer sees themselves, or who they want to be.

HOOK-STYLE FIT (note which of these the angle best supports, for later expansion):
  - curiosity: open an irresistible question ("The one thing nobody tells you about X…").
  - controversy: stake a divisive or contrarian claim ("X is a scam, here's proof…").
  - personal_stakes: make it about the viewer's own outcome ("If you do X, you're losing Y").

GROUND EVERY OPPORTUNITY IN THE TRANSCRIPT. Cite the clip ids it draws from. Do NOT invent
facts, quotes, numbers, or moments that are not supported by the clips. Prefer fewer,
higher-quality opportunities over many weak ones. De-duplicate near-identical angles.

Return a JSON ARRAY (8-20 items) of objects with EXACTLY these keys:
[
  {
    "title": "short, punchy working title for the opportunity",
    "angle_summary": "1-2 sentences on the angle and why it could perform",
    "country": "global" OR an ISO-ish country/region the angle targets (default "global"),
    "topics": ["topic", ...],
    "keywords": ["keyword", ...],
    "source_clip_ids": ["<clip id from the transcript>", ...],
    "virality_tier": "S" | "A" | "B" | "C",
    "virality_score": 0.0-1.0,
    "best_hook_style": "curiosity" | "controversy" | "personal_stakes"
  }
]
Output the JSON array ONLY — no prose, no code fences."""


# ── expansion prompt ──────────────────────────────────────────────────────────────────
def _expansion_user_prompt(opp: dict[str, Any], grounding: list[str]) -> str:
    facts = ""
    if grounding:
        bullet = "\n".join(f"- {g}" for g in grounding[:6])
        facts = f"\n\nGROUNDING FACTS (verified; use only if relevant, do NOT contradict):\n{bullet}"
    return (
        "Write EXACTLY 3 opening hooks for this short-form video opportunity — one in each "
        "style, in this order: curiosity, controversy, personal_stakes.\n\n"
        f"TITLE: {opp.get('title') or ''}\n"
        f"ANGLE: {opp.get('angle_summary') or ''}\n"
        f"TOPICS: {', '.join(opp.get('topics') or [])}\n"
        f"KEYWORDS: {', '.join(opp.get('keywords') or [])}"
        f"{facts}\n\n"
        "Each hook is 1-2 sentences, punchy, scroll-stopping, and faithful to the angle. "
        "Do NOT invent facts beyond the angle and any grounding facts above.\n\n"
        "Return a JSON ARRAY of EXACTLY 3 objects with these keys:\n"
        '[{"version": 1, "style": "curiosity", "text": "..."},\n'
        ' {"version": 2, "style": "controversy", "text": "..."},\n'
        ' {"version": 3, "style": "personal_stakes", "text": "..."}]\n'
        "Output the JSON array ONLY — no prose, no code fences."
    )


# ── Tavily grounding (optional; degrades gracefully on 429/quota) ─────────────────────
def _tavily_ground(query: str) -> dict[str, Any]:
    """Optional fact-check grounding for an expansion. Returns a fact_check_result dict:
      - no key set                → {skipped: true, reason: "no_api_key"}
      - 429 / quota / payment     → {skipped: true, reason: "quota"}   (graceful degrade)
      - other error / exception   → {skipped: true, reason: "error", ...}
      - success                   → {skipped: false, sources: [...], checked_at: iso}
    NEVER raises — hook generation must proceed even when grounding is unavailable."""
    key = _tavily_key()
    if not key:
        return {"skipped": True, "reason": "no_api_key"}
    payload = {
        "api_key": key,
        "query": query,
        "max_results": 5,
        "search_depth": "basic",
    }
    try:
        with httpx.Client(timeout=TAVILY_TIMEOUT) as client:
            r = client.post(TAVILY_URL, json=payload)
        if r.status_code in (402, 429):
            # Payment-required / rate-limited → quota exceeded. Degrade gracefully.
            return {"skipped": True, "reason": "quota"}
        if r.status_code != 200:
            return {"skipped": True, "reason": "error", "status": r.status_code}
        data = r.json()
        results = data.get("results") or []
        sources = [{"title": (x.get("title") or "")[:200],
                    "url": x.get("url") or "",
                    "snippet": (x.get("content") or "")[:400]}
                   for x in results if isinstance(x, dict)]
        return {"skipped": False, "sources": sources, "checked_at": _now_iso()}
    except Exception as e:  # noqa: BLE001
        log.info("content_forge: tavily grounding failed (degrading): %s", e)
        return {"skipped": True, "reason": "error", "detail": str(e)[:200]}


def _grounding_bullets(fact_check: dict[str, Any]) -> list[str]:
    if fact_check.get("skipped"):
        return []
    out: list[str] = []
    for s in fact_check.get("sources") or []:
        t = (s.get("title") or "").strip()
        sn = (s.get("snippet") or "").strip()
        if t or sn:
            out.append(f"{t}: {sn}".strip(": ").strip())
    return out


# ── ingest worker (BackgroundTasks) ───────────────────────────────────────────────────
async def _ingest_worker(reel_id: str | None, footage: str | None) -> None:
    """Fire-and-forget worker: (a) read attached_footage_items.full_transcript from
    Supabase and upsert clips; (b) IF CONTENT_FORGE_TRANSCRIPT_DIR is set, ALSO parse loose
    disk files there and upsert. Never raises (a background task failure must not crash the
    event loop). Dedup is on the (footage_file_id, start_time, end_time) upsert key."""
    run_id = str(uuid.uuid4())
    clips: list[dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as client:
            # (a) Supabase source — full_transcript on attached_footage_items.
            rows = await _fetch_footage_transcripts(client, reel_id, footage)
            for row in rows:
                fid = str(row.get("id") or "")
                fname = row.get("filename")
                segs = row.get("full_transcript") or []
                if not fid or not isinstance(segs, list):
                    continue
                for seg in segs:
                    if not isinstance(seg, dict):
                        continue
                    txt = (seg.get("text") or "").strip()
                    if not txt:
                        continue
                    try:
                        st = float(seg.get("start_time") or 0.0)
                        en = float(seg.get("end_time") if seg.get("end_time") is not None else st)
                    except (TypeError, ValueError):
                        continue
                    conf = seg.get("score")
                    clips.append({
                        "footage_file_id": fid,
                        "filename": fname,
                        "start_time": st,
                        "end_time": en,
                        "transcript_text": txt,
                        "keywords": _extract_keywords(txt),
                        "topics": [],
                        "language": "en",
                        "confidence": (float(conf) if isinstance(conf, (int, float)) else None),
                        "ingest_run_id": run_id,
                    })

            # (b) Disk source — STRICT no-op unless CONTENT_FORGE_TRANSCRIPT_DIR is set.
            disk = _transcript_dir()
            if disk:
                clips.extend(_collect_disk_clips(disk, run_id))
            else:
                log.info("content_forge: disk transcript branch skipped "
                         "(CONTENT_FORGE_TRANSCRIPT_DIR unset)")

            written = await _upsert_transcript_clips(client, clips)
            log.info("content_forge: ingest run=%s reel=%s footage=%s clips=%d upserted=%d",
                     run_id, reel_id, footage, len(clips), written)
    except Exception as e:  # noqa: BLE001 — never crash the worker
        log.exception("content_forge: ingest worker error: %s", e)


def _collect_disk_clips(base_dir: str, run_id: str) -> list[dict[str, Any]]:
    """Walk CONTENT_FORGE_TRANSCRIPT_DIR for transcript files (.json/.vtt/.srt/.txt),
    parse each, and build transcript_clips rows keyed by the bare filename (used as the
    soft footage_file_id for disk-sourced clips). Best-effort; skips unreadable files."""
    out: list[dict[str, Any]] = []
    exts = (".json", ".vtt", ".srt", ".txt")
    for root, _dirs, files in os.walk(base_dir):
        for fn in sorted(files):
            if not fn.lower().endswith(exts):
                continue
            path = os.path.join(root, fn)
            segs = _transcribe_disk_file(path)
            if not segs:
                continue
            # Stable soft id for disk clips: path relative to base_dir (unique per file).
            rel = os.path.relpath(path, base_dir).replace("\\", "/")
            for seg in segs:
                txt = (seg.get("text") or "").strip()
                if not txt:
                    continue
                out.append({
                    "footage_file_id": f"disk:{rel}",
                    "filename": fn,
                    "start_time": float(seg.get("start") or 0.0),
                    "end_time": float(seg.get("end") or 0.0),
                    "transcript_text": txt,
                    "keywords": _extract_keywords(txt),
                    "topics": [],
                    "language": "en",
                    "confidence": None,
                    "ingest_run_id": run_id,
                })
    return out


# ── discovery worker (BackgroundTasks) ────────────────────────────────────────────────
def _norm_tier(t: Any) -> str:
    t = str(t or "C").strip().upper()
    return t if t in ("S", "A", "B", "C") else "C"


def _norm_score(v: Any) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, f))


async def _discover_worker(batch_id: str, tier: str, country: str | None) -> None:
    """Fire-and-forget discovery: read transcript_clips, run ONE batched LLM pass via the
    provider seam, upsert content_opportunities tagged with discovery_run_id=batch_id.
    Never raises."""
    try:
        async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as client:
            clips = await _read_clips_for_discovery(client)
            if not clips:
                log.info("content_forge: discover batch=%s — no clips to analyze", batch_id)
                return
            transcript = _clips_to_prompt(clips)
            user = (
                f"{_DISCOVERY_GUIDANCE}\n\n"
                + (f"TARGET COUNTRY/REGION: {country}\n\n" if country else "")
                + f"FOOTAGE TRANSCRIPT CLIPS:\n{transcript}"
            )
            messages = [
                {"role": "system", "content": _SYSTEM_BY_KIND["discovery"]},
                {"role": "user", "content": user},
            ]
            # Provider seam — free (Gemini) by default, pro (Haiku) if requested+keyed.
            text, meta = _forge_llm(messages, tier=tier, kind="discovery")
            parsed = _extract_json(text)
            items = parsed if isinstance(parsed, list) else parsed.get("opportunities", [])
            if not isinstance(items, list):
                items = []

            rows: list[dict[str, Any]] = []
            seen_titles: set[str] = set()
            for it in items:
                if not isinstance(it, dict):
                    continue
                title = (it.get("title") or "").strip()
                if not title:
                    continue
                ctry = (it.get("country") or country or "global").strip() or "global"
                key = (ctry.lower(), title.lower())
                if key in seen_titles:   # within-run dedup (also guarded by the unique idx)
                    continue
                seen_titles.add(key)
                src_ids = [str(x) for x in (it.get("source_clip_ids") or [])
                           if isinstance(x, (str, int))]
                rows.append({
                    "title": title,
                    "angle_summary": it.get("angle_summary"),
                    "country": ctry,
                    "topics": [str(t) for t in (it.get("topics") or [])],
                    "keywords": [str(k) for k in (it.get("keywords") or [])],
                    "source_clip_ids": src_ids,
                    "virality_tier": _norm_tier(it.get("virality_tier")),
                    "virality_score": _norm_score(it.get("virality_score")),
                    "status": "discovered",
                    "discovery_run_id": batch_id,
                })
            written = await _upsert_opportunities(client, rows)
            log.info("content_forge: discover batch=%s provider=%s tier=%s items=%d upserted=%d",
                     batch_id, meta.get("provider"), meta.get("tier_used"), len(rows), written)
    except Exception as e:  # noqa: BLE001 — never crash the worker
        log.exception("content_forge: discover worker error (batch=%s): %s", batch_id, e)


# ── endpoints ─────────────────────────────────────────────────────────────────────────
@router.get("/health")
async def health(request: Request):
    """GET /api/content-forge/health?secret=<CONTENT_FORGE_SECRET>

    200 ONLY with a valid secret; 401 otherwise. A curl WITHOUT the secret returns 401 —
    matches the deploy smoke test. With a valid secret, reports which providers/config are
    wired (no secret values, just booleans)."""
    if not _check_secret(request):
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=401)
    return JSONResponse({
        "ok": True,
        "secret_set": bool(_secret()),
        "supabase_configured": bool(_supabase_url()) and bool(os.environ.get("SUPABASE_SERVICE_ROLE_KEY")),
        "openrouter_set": bool(_openrouter_key()),       # free tier
        "anthropic_set": bool(_anthropic_key()),         # pro tier
        "tavily_set": bool(_tavily_key()),               # optional grounding
        "transcript_dir_set": bool(_transcript_dir()),   # optional disk ingest
        "free_model": _free_model(),
        "discovery_model": _discovery_model(),
        "expansion_model": _expansion_model(),
    }, status_code=200)


@router.post("/ingest-transcript")
async def ingest_transcript(request: Request, background_tasks: BackgroundTasks):
    """POST /api/content-forge/ingest-transcript?secret=…[&reel_id=…][&footage=…]

    Secret-gated. Fire-and-forget (BackgroundTasks): pull transcripts into transcript_clips
    from BOTH Supabase (attached_footage_items.full_transcript) and — only when
    CONTENT_FORGE_TRANSCRIPT_DIR is set — loose disk files. Returns immediately; poll
    /ingest-status to watch the clip count rise. Body/query may carry reel_id and/or footage
    (a specific footage file id) to scope the Supabase pull."""
    if not _check_secret(request):
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=401)
    reel_id = request.query_params.get("reel_id") or None
    footage = request.query_params.get("footage") or None
    # Tolerate JSON body too (the Vercel proxy may POST a body instead of query params).
    if reel_id is None and footage is None:
        try:
            body = await request.json()
            if isinstance(body, dict):
                reel_id = body.get("reel_id") or None
                footage = body.get("footage") or body.get("footage_file_id") or None
        except Exception:  # noqa: BLE001
            pass
    background_tasks.add_task(_ingest_worker, reel_id, footage)
    return JSONResponse({"ok": True, "started": True,
                         "reel_id": reel_id, "footage": footage}, status_code=200)


@router.get("/ingest-status/{reel_id}")
async def ingest_status(reel_id: str, request: Request):
    """GET /api/content-forge/ingest-status/{reel_id}?secret=… → {clip_count}.

    Secret-gated. Counts transcript_clips for the footage belonging to reel_id; pass the
    sentinel reel_id "all" (or "_") to count every clip. Lets the frontend poll ingest
    progress."""
    if not _check_secret(request):
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=401)
    scope = None if reel_id in ("all", "_", "*") else reel_id
    async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as client:
        count = await _count_clips(client, scope)
    return JSONResponse({"ok": True, "reel_id": reel_id, "clip_count": count}, status_code=200)


@router.post("/discover")
async def discover(request: Request, background_tasks: BackgroundTasks):
    """POST /api/content-forge/discover?secret=…[&tier=free|pro][&country=…] → {batch_id}

    Secret-gated. Fire-and-forget (BackgroundTasks): read transcript_clips, run ONE batched
    discovery pass via the provider seam (free Gemini default; pro = Claude Haiku), upsert
    content_opportunities tagged with discovery_run_id=batch_id. Returns the batch_id
    immediately; poll /discover-status/{batch_id} for the results."""
    if not _check_secret(request):
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=401)
    tier = (request.query_params.get("tier") or "free").strip().lower()
    country = request.query_params.get("country") or None
    if tier not in ("free", "pro"):
        # Also accept tier/country from a JSON body (proxy convenience).
        try:
            body = await request.json()
            if isinstance(body, dict):
                tier = (body.get("tier") or tier or "free").strip().lower()
                country = body.get("country") or country
        except Exception:  # noqa: BLE001
            pass
        if tier not in ("free", "pro"):
            tier = "free"
    batch_id = str(uuid.uuid4())
    background_tasks.add_task(_discover_worker, batch_id, tier, country)
    return JSONResponse({"ok": True, "batch_id": batch_id,
                         "tier": tier, "country": country}, status_code=200)


@router.get("/discover-status/{batch_id}")
async def discover_status(batch_id: str, request: Request):
    """GET /api/content-forge/discover-status/{batch_id}?secret=… → {opportunities:[...]}.

    Secret-gated. Returns the content_opportunities upserted for this discovery batch
    (ordered by virality_score desc). Empty list = the background pass hasn't written yet
    (keep polling) or it produced nothing."""
    if not _check_secret(request):
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=401)
    async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as client:
        opps = await _read_opportunities_for_batch(client, batch_id)
    return JSONResponse({"ok": True, "batch_id": batch_id,
                         "count": len(opps), "opportunities": opps}, status_code=200)


@router.post("/expand")
async def expand(request: Request):
    """POST /api/content-forge/expand?secret=…&opportunity_id=…[&tier=free|pro] → hooks

    Secret-gated. SYNCHRONOUS (Sonnet/Gemini hook writing is fast). Generates EXACTLY 3
    hook versions (curiosity / controversy / personal_stakes) via the provider seam, with
    OPTIONAL Tavily grounding (skipped gracefully on no-key / 429 / quota → fact_check_result
    {skipped:true, reason:"quota"}). Writes hook_versions JSONB (+ fact_check_result, status
    'hook_generated') onto the content_opportunities row and returns them."""
    if not _check_secret(request):
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=401)

    opp_id = request.query_params.get("opportunity_id") or request.query_params.get("id")
    tier = (request.query_params.get("tier") or "free").strip().lower()
    if not opp_id or tier not in ("free", "pro"):
        try:
            body = await request.json()
            if isinstance(body, dict):
                opp_id = opp_id or body.get("opportunity_id") or body.get("id")
                tier = (body.get("tier") or tier or "free").strip().lower()
        except Exception:  # noqa: BLE001
            pass
    if tier not in ("free", "pro"):
        tier = "free"
    if not opp_id:
        return JSONResponse({"ok": False, "error": "opportunity_id required"}, status_code=400)

    async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as client:
        opp = await _read_opportunity(client, opp_id)
        if not opp:
            return JSONResponse({"ok": False, "error": "opportunity not found"}, status_code=404)

        # Optional grounding — never blocks hook generation; degrades on quota/no-key.
        gq = (opp.get("title") or "") + " " + (opp.get("angle_summary") or "")
        fact_check = _tavily_ground(gq.strip()) if gq.strip() else {"skipped": True,
                                                                    "reason": "no_query"}
        grounding = _grounding_bullets(fact_check)

        messages = [
            {"role": "system", "content": _SYSTEM_BY_KIND["expansion"]},
            {"role": "user", "content": _expansion_user_prompt(opp, grounding)},
        ]
        try:
            text, meta = _forge_llm(messages, tier=tier, kind="expansion")
            parsed = _extract_json(text)
        except Exception as e:  # noqa: BLE001
            log.warning("content_forge: expand LLM failed for %s: %s", opp_id, e)
            return JSONResponse({"ok": False, "error": f"hook generation failed: {e}"},
                                status_code=502)

        raw = parsed if isinstance(parsed, list) else parsed.get("hooks", [])
        hooks = _normalize_hooks(raw if isinstance(raw, list) else [])

        await _patch_opportunity(client, opp_id, {
            "hook_versions": hooks,
            "fact_check_result": fact_check,
            "status": "hook_generated",
        })

    return JSONResponse({
        "ok": True,
        "opportunity_id": opp_id,
        "hook_versions": hooks,
        "fact_check_result": fact_check,
        "provider": meta.get("provider"),
        "tier_used": meta.get("tier_used"),
        "fell_back": meta.get("fell_back", False),
    }, status_code=200)


def _normalize_hooks(raw: list[Any]) -> list[dict[str, Any]]:
    """Coerce the LLM's hooks into EXACTLY 3 versions in the canonical style order
    (curiosity, controversy, personal_stakes). Maps any returned hooks onto their style;
    fills any missing style with an empty-text placeholder so the frontend always gets 3
    columns (it shows a per-column skeleton/error when text is empty)."""
    by_style: dict[str, str] = {}
    for h in raw:
        if not isinstance(h, dict):
            continue
        style = str(h.get("style") or "").strip().lower()
        text = (h.get("text") or "").strip()
        if style in HOOK_STYLES and style not in by_style:
            by_style[style] = text
    # If the model returned hooks without recognizable styles, assign them positionally.
    if not by_style:
        for i, h in enumerate(raw[:3]):
            if isinstance(h, dict):
                by_style[HOOK_STYLES[i]] = (h.get("text") or "").strip()
    return [
        {"version": i + 1, "style": style, "text": by_style.get(style, "")}
        for i, style in enumerate(HOOK_STYLES)
    ]
