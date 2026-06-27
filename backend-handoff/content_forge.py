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
the LLM provider is chosen. It walks an ESCALATING LADDER (cheapest-first); each rung is
skipped when its env keys are absent, and a RuntimeError at any rung escalates to the next:
    1. Gemini API (AI Studio) — GEMINI_API_KEY, free tier ~1500/day (OpenAI-compatible).
    2. Vertex AI Gemini       — GCP_PROJECT_ID + GCP_SA_JSON, bills the $300 GCP credit.
    3. Anthropic direct (opt) — ANTHROPIC_API_KEY; claude-haiku-4-5 (discovery) /
                                claude-sonnet-4-6 (expansion).
    4. OpenRouter free chain  — OPENROUTER_API_KEY, the existing safety net.
`kind` ∈ {discovery, expansion} still selects the Anthropic model. `tier` is retained for
call-site compat but no longer gates free-vs-pro. The result meta carries the provider/model
actually used plus fell_back (True once an earlier rung errored). NOTE: Claude-on-Vertex is
intentionally NOT wired — GCP promo credits exclude Marketplace purchases, so it would bill a
real card; a future session can add a `_rung_vertex_claude` above the OpenRouter rung.

SECRET GATE: every endpoint compares a ?secret= query param to CONTENT_FORGE_SECRET and
returns 401 on missing/mismatch — mirrors ig_webhook's IG_SYNC_SECRET gate, so a curl
without the secret returns 401 (matches the deploy smoke test:
    curl -o /dev/null -s -w "%{http_code}" https://api.footagebrain.com/api/content-forge/health
    # expect 401).

All secrets are read from environment variables — NOTHING is hardcoded:
    CONTENT_FORGE_SECRET           Shared secret gating every endpoint (?secret=…)
    SUPABASE_URL                   Supabase project URL
    SUPABASE_SERVICE_ROLE_KEY      Service role key (server-side only)
    GEMINI_API_KEY                 Ladder rung 1 — AI Studio Gemini key (free tier)
    GCP_PROJECT_ID                 Ladder rung 2 — GCP project for Vertex (e.g. footage-brain-database)
    GCP_SA_JSON                    Ladder rung 2 — full service-account JSON (one line) for Vertex auth
    GCP_REGION                     (optional) Vertex region (default us-central1)
    OPENROUTER_API_KEY             Ladder rung 4 — FREE-tier OpenRouter key (safety net)
    ANTHROPIC_API_KEY              Ladder rung 3 — Claude key (optional)
    TAVILY_API_KEY                 (optional) Tavily grounding for expansion; absent → skip
    CONTENT_FORGE_TRANSCRIPT_DIR   (optional) base dir for disk-file transcript ingest;
                                   UNSET → the disk branch is a no-op (Supabase-only)
    CONTENT_FORGE_MODEL_GEMINI         (optional) override the Gemini API model (rung 1)
    CONTENT_FORGE_MODEL_VERTEX_GEMINI  (optional) override the Vertex Gemini model (rung 2)
    CONTENT_FORGE_MODEL_FREE       (optional) override the OpenRouter model id (free chain)
    CONTENT_FORGE_MODEL_DISCOVERY  (optional) override the Anthropic discovery model (Haiku)
    CONTENT_FORGE_MODEL_EXPANSION  (optional) override the Anthropic expansion model (Sonnet)

`httpx`, `anthropic`, and `google-auth` are the only external deps used here — all in
requirements-hosting.txt (anthropic + google-auth already present).
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
# Curated to instruction-tuned models that reliably emit STRICT JSON (no
# reasoning/thinking preambles that break _extract_json). Ordered by observed
# reliability; spread across providers so a per-provider 429 falls through to a
# different upstream. (Reasoning models like nvidia/nemotron-*-reasoning return
# 200 but 0 parseable opportunities, so they're deliberately excluded.)
DEFAULT_FREE_MODELS = [
    "openai/gpt-oss-120b:free",                    # OpenAI OSS — proven good JSON
    "meta-llama/llama-3.3-70b-instruct:free",      # Meta
    "qwen/qwen3-next-80b-a3b-instruct:free",       # Qwen / Alibaba
    "google/gemma-4-31b-it:free",                  # Google
    "nousresearch/hermes-3-llama-3.1-405b:free",   # Nous
]
DEFAULT_FREE_MODEL = DEFAULT_FREE_MODELS[0]   # primary (shown in /health)

# ── Gemini API (AI Studio) — OpenAI-compat, free tier ~1500 req/day ─────────────────
# Default ladder rung 1. Runs on AI Studio's FREE tier (the $300 GCP credit does NOT
# apply to the Gemini API — Google excludes it — but the free quota is ~30x OpenRouter's,
# which is the whole reason this rung exists). Same OpenAI-compatible request shape as
# OpenRouter, so _call_gemini_api reuses that idiom. CONTENT_FORGE_MODEL_GEMINI overrides.
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/openai"
DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"

# ── Vertex AI (Gemini) — GCP-$300-credit-backed ─────────────────────────────────────
# Ladder rung 2. Bills the owner's $300 GCP credit directly (Vertex is a native Google
# product, credit-eligible — unlike the Gemini API and unlike Marketplace/Claude). Uses a
# service-account Bearer token (GCP_SA_JSON). CONTENT_FORGE_MODEL_VERTEX_GEMINI overrides.
# (Claude-on-Vertex is intentionally NOT wired this session — promo credit excludes
# Marketplace purchases, so it would bill a real card. Deferred.)
DEFAULT_VERTEX_GEMINI_MODEL = "google/gemini-2.0-flash-001"

# ── PRO provider (Anthropic) — model ids per kind ───────────────────────────────────
# Haiku 4.5 for cheap/fast batched discovery; Sonnet 4.6 for higher-quality hook writing.
# Exact, complete model-id strings (no date suffixes).
DEFAULT_DISCOVERY_MODEL = "claude-haiku-4-5"
DEFAULT_EXPANSION_MODEL = "claude-sonnet-4-6"

# ── PRICING (USD per 1,000,000 tokens: (input, output)) ──────────────────────────────
# Maintained constant — these list prices rarely move. Used to stamp a cost_usd on every
# logged LLM call so the Monitor "API Budgets & Limits" card can show live Vertex spend
# (calls / tokens / $) against the $300 GCP credit. Keys are the EXACT model strings the
# provider rungs pass (Vertex prefixes Gemini with "google/"; the AI-Studio rung doesn't).
# OpenRouter's free chain is always $0 (priced by provider, not model). Unknown models
# price at $0 (logged with their real model id so a price can be added later).
#   Vertex/Gemini 2.5-flash $0.30/$2.50 · 2.0-flash $0.10/$0.40 (public list, 2026-06).
#   Claude Haiku 4.5 $1/$5 · Sonnet 4.6 $3/$15 (per the claude-api pricing table).
_MODEL_PRICES: dict[str, tuple[float, float]] = {
    "google/gemini-2.5-flash":      (0.30, 2.50),   # Vertex rung default (LIVE)
    "google/gemini-2.0-flash-001":  (0.10, 0.40),   # Vertex rung legacy default
    "gemini-2.5-flash":             (0.30, 2.50),   # AI-Studio rung
    "gemini-2.0-flash":             (0.10, 0.40),   # AI-Studio rung default
    "gemini-2.0-flash-001":         (0.10, 0.40),
    "claude-haiku-4-5":             (1.00, 5.00),    # Anthropic discovery
    "claude-sonnet-4-6":            (3.00, 15.00),   # Anthropic expansion
}


def _usage_from_openai(data: dict[str, Any]) -> dict[str, int]:
    """Pull token usage out of an OpenAI-compatible chat-completions body (the shape Gemini
    API, Vertex Gemini, and OpenRouter all return): data["usage"] = {prompt_tokens,
    completion_tokens, total_tokens}. Best-effort — returns zeros if the field is missing or
    malformed (some providers omit usage on edge responses). Never raises."""
    u = (data or {}).get("usage") or {}
    try:
        pt = int(u.get("prompt_tokens") or 0)
        ct = int(u.get("completion_tokens") or 0)
        tt = int(u.get("total_tokens") or (pt + ct))
    except (TypeError, ValueError):
        return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    return {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": tt}


def _estimate_cost(provider: str, model: str, usage: dict[str, int]) -> float:
    """Estimate the USD cost of one call from its token usage + the price table. OpenRouter's
    free chain is always $0. Unknown models price at $0 (so the column never lies upward) —
    add the model to _MODEL_PRICES to start counting it. Rounded to 6 dp (micro-dollars)."""
    if provider == "openrouter":
        return 0.0
    prices = _MODEL_PRICES.get(model) or _MODEL_PRICES.get(model.split("/")[-1])
    if not prices:
        return 0.0
    p_in, p_out = prices
    pt = usage.get("prompt_tokens", 0) or 0
    ct = usage.get("completion_tokens", 0) or 0
    return round(pt / 1_000_000.0 * p_in + ct / 1_000_000.0 * p_out, 6)

# ── Tavily grounding ────────────────────────────────────────────────────────────────
TAVILY_URL = "https://api.tavily.com/search"

# Timeouts (seconds)
LLM_TIMEOUT = 120            # one discovery/expansion LLM pass
TAVILY_TIMEOUT = 10          # keep grounding short — never block hook generation
SUPABASE_TIMEOUT = 20        # service-role REST reads/writes

# Guardrails
MAX_CLIPS_FOR_DISCOVERY = 400      # cap clips fed to one discovery pass (token budget)
DISCOVERY_TRANSCRIPT_CHARS = 24000  # max chars of flattened transcript in the prompt
GEMINI_MAX_TOKENS = 8192           # Gemini 2.5 thinking shares this budget — wide enough that
                                   # reasoning + a full 8-20 item discovery JSON both fit (a
                                   # 2400 cap truncated the array → "no JSON value found")
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


def _gemini_key() -> str | None:
    """AI Studio Gemini API key (ladder rung 1, free tier). Absent → rung skipped."""
    return os.environ.get("GEMINI_API_KEY")


def _gcp_project() -> str | None:
    """GCP project id for the Vertex rung (e.g. footage-brain-database)."""
    return os.environ.get("GCP_PROJECT_ID")


def _gcp_region() -> str:
    """Vertex region (defaults to us-central1 where Gemini models are served)."""
    return os.environ.get("GCP_REGION", "us-central1")


def _gcp_sa_json() -> str | None:
    """Full service-account JSON (one line) for Vertex auth. Absent → Vertex rung skipped."""
    return os.environ.get("GCP_SA_JSON")


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
                                    limit: int = MAX_CLIPS_FOR_DISCOVERY,
                                    only_new: bool = True) -> list[dict[str, Any]]:
    """Read a bounded window of transcript_clips for a discovery pass.

    INCREMENTAL by default (only_new=True): feeds only clips not yet analyzed
    (last_discovered_at IS NULL), newest first, capped at `limit` — so a repeat Discover
    pass doesn't re-spend the LLM on the same footage. An empty result then legitimately
    means "no new clips" (the worker logs + returns). DEGRADE-SAFE: if the
    last_discovered_at column doesn't exist yet (migration 0105 not applied), the filtered
    request 400s → we fall back to the original unfiltered recent window so prod behaviour
    is unchanged. only_new=False forces the full recent window (a deliberate ?rescan=1)."""
    url = _supabase_url()
    if not url:
        return []
    select = ("select=id,footage_file_id,filename,start_time,end_time,transcript_text,"
              "keywords,topics")
    base = f"{url}/rest/v1/transcript_clips?{select}&order=created_at.desc&limit={int(limit)}"
    try:
        if only_new:
            r = await client.get(base + "&last_discovered_at=is.null", headers=_supabase_headers())
            if r.status_code == 200:
                data = r.json()
                return data if isinstance(data, list) else []
            # Column missing (pre-0105) or filter rejected → fall back to the full window.
            log.info("content_forge: incremental clip read HTTP %s — falling back to full window",
                     r.status_code)
        r = await client.get(base, headers=_supabase_headers())
        if r.status_code == 200:
            data = r.json()
            return data if isinstance(data, list) else []
        log.warning("content_forge: clip read HTTP %s: %s", r.status_code, r.text[:300])
    except Exception as e:  # noqa: BLE001
        log.warning("content_forge: clip read failed: %s", e)
    return []


async def _mark_clips_discovered(client: httpx.AsyncClient, clip_ids: list[str]) -> None:
    """Stamp last_discovered_at=now() on the clips fed into a discovery pass so the next
    incremental pass skips them (the windowing half of the token-saver). Best-effort: if the
    column doesn't exist yet (pre-0105) the PATCH 400s and we log-and-continue. Never raises."""
    url = _supabase_url()
    if not url or not clip_ids:
        return
    now = _now_iso()
    # PostgREST in-list; chunk so the URL length stays sane.
    for i in range(0, len(clip_ids), 100):
        ids = ",".join(str(c) for c in clip_ids[i:i + 100])
        try:
            r = await client.patch(
                f"{url}/rest/v1/transcript_clips?id=in.({ids})",
                headers=_supabase_headers("return=minimal"),
                json={"last_discovered_at": now},
            )
            if r.status_code not in (200, 204):
                log.info("content_forge: mark-discovered HTTP %s: %s", r.status_code, r.text[:200])
        except Exception as e:  # noqa: BLE001
            log.info("content_forge: mark-discovered failed: %s", e)


async def _read_existing_titles(client: httpx.AsyncClient, country: str | None,
                                limit: int = 80) -> list[str]:
    """Recent content_opportunities titles for the same country (+ global) — fed into the
    discovery prompt as a 'do NOT repeat' list so the LLM spends output on NOVEL angles
    instead of regenerating ones already discovered (the cross-run dedup half of the
    token-saver; prompt-level only, no index change). Best-effort: returns [] on any error."""
    url = _supabase_url()
    if not url:
        return []
    # country filter: match the target country OR rows tagged 'global'; if no country, take all.
    if country:
        ctry = country.replace(",", "")  # PostgREST in-list is comma-delimited
        flt = f"&country=in.({ctry},global)"
    else:
        flt = ""
    try:
        r = await client.get(
            f"{url}/rest/v1/content_opportunities"
            f"?select=title&order=created_at.desc&limit={int(limit)}{flt}",
            headers=_supabase_headers(),
        )
        if r.status_code == 200 and isinstance(r.json(), list):
            seen: set[str] = set()
            out: list[str] = []
            for row in r.json():
                t = (row.get("title") or "").strip()
                k = t.lower()
                if t and k not in seen:
                    seen.add(k)
                    out.append(t)
            return out
        log.info("content_forge: existing-titles read HTTP %s", r.status_code)
    except Exception as e:  # noqa: BLE001
        log.info("content_forge: existing-titles read failed: %s", e)
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


# ── LLM usage logging (powers the Monitor "API Budgets & Limits" live spend) ──────────
async def _log_usage(client: httpx.AsyncClient, *, kind: str, meta: dict[str, Any],
                     batch_id: str | None = None) -> None:
    """Append ONE content_forge_usage row per LLM call: the provider/model actually used,
    the token usage captured from the response, and the cost_usd _forge_llm already stamped
    onto meta. Best-effort: if the table doesn't exist yet (migration 0106 not applied) the
    insert 400s and we log-and-continue — discovery/expansion must never fail on telemetry.
    Never raises."""
    url = _supabase_url()
    if not url:
        return
    usage = meta.get("usage") or {}
    row = {
        "provider": meta.get("provider"),
        "model": meta.get("model"),
        "kind": kind,
        "prompt_tokens": int(usage.get("prompt_tokens") or 0),
        "completion_tokens": int(usage.get("completion_tokens") or 0),
        "total_tokens": int(usage.get("total_tokens") or 0),
        "cost_usd": float(meta.get("cost_usd") or 0.0),
        "fell_back": bool(meta.get("fell_back")),
        "batch_id": batch_id,
    }
    try:
        r = await client.post(
            f"{url}/rest/v1/content_forge_usage",
            headers=_supabase_headers("return=minimal"),
            json=row,
        )
        if r.status_code not in (200, 201, 204):
            log.info("content_forge: usage log HTTP %s: %s", r.status_code, r.text[:200])
    except Exception as e:  # noqa: BLE001 — telemetry must never break the pipeline
        log.info("content_forge: usage log failed: %s", e)


# Cap the rows pulled for the /usage rollup. At ~$0.002/run this covers years of history;
# all_time_calls is still reported exactly from the Content-Range header even when capped.
MAX_USAGE_ROWS = 5000


async def _read_usage_rollup(client: httpx.AsyncClient) -> dict[str, Any]:
    """Aggregate content_forge_usage for the Monitor budgets card: all-time + today + last-30d
    totals (calls / tokens / cost), plus per-provider and per-kind breakdowns and the last
    call. Pulls a bounded recent window (MAX_USAGE_ROWS) and rolls it up in Python — robust
    across PostgREST versions and plenty for this volume. all_time_calls comes from the exact
    count header so the headline call count is never capped. Degrade-safe: returns an empty
    rollup (all zeros, configured=False) if the table is missing (pre-0106) or on any error."""
    empty = {
        "configured": False,
        "totals": {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0,
                   "total_tokens": 0, "cost_usd": 0.0},
        "today": {"calls": 0, "total_tokens": 0, "cost_usd": 0.0},
        "last_30d": {"calls": 0, "total_tokens": 0, "cost_usd": 0.0},
        "by_provider": [], "by_kind": [], "last_call": None,
        "all_time_calls": 0, "window_capped": False,
    }
    url = _supabase_url()
    if not url:
        return empty
    select = ("select=created_at,provider,model,kind,prompt_tokens,completion_tokens,"
              "total_tokens,cost_usd,fell_back")
    try:
        r = await client.get(
            f"{url}/rest/v1/content_forge_usage?{select}"
            f"&order=created_at.desc&limit={MAX_USAGE_ROWS}",
            headers={**_supabase_headers(), "Prefer": "count=exact",
                     "Range-Unit": "items", "Range": f"0-{MAX_USAGE_ROWS - 1}"},
        )
    except Exception as e:  # noqa: BLE001
        log.info("content_forge: usage rollup read failed: %s", e)
        return empty
    if r.status_code not in (200, 206):
        # Table missing (pre-0106) or query rejected → return the empty (configured:False) shape.
        log.info("content_forge: usage rollup HTTP %s — returning empty", r.status_code)
        return empty
    rows = r.json() if isinstance(r.json(), list) else []

    # Exact all-time count from the Content-Range header ("0-N/<total>").
    cr = r.headers.get("content-range") or r.headers.get("Content-Range") or ""
    all_time = len(rows)
    if "/" in cr:
        tail = cr.rsplit("/", 1)[-1].strip()
        if tail.isdigit():
            all_time = int(tail)

    now = _dt.datetime.now(tz=_dt.timezone.utc)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    cutoff_30d = now - _dt.timedelta(days=30)

    def _blank():
        return {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0,
                "total_tokens": 0, "cost_usd": 0.0}

    totals = _blank()
    today = {"calls": 0, "total_tokens": 0, "cost_usd": 0.0}
    last_30d = {"calls": 0, "total_tokens": 0, "cost_usd": 0.0}
    by_provider: dict[str, dict[str, Any]] = {}
    by_kind: dict[str, dict[str, Any]] = {}

    def _parse_ts(s: str) -> _dt.datetime | None:
        try:
            return _dt.datetime.fromisoformat((s or "").replace("Z", "+00:00"))
        except Exception:  # noqa: BLE001
            return None

    for row in rows:
        if not isinstance(row, dict):
            continue
        pt = int(row.get("prompt_tokens") or 0)
        ct = int(row.get("completion_tokens") or 0)
        tt = int(row.get("total_tokens") or (pt + ct))
        cost = float(row.get("cost_usd") or 0.0)
        totals["calls"] += 1
        totals["prompt_tokens"] += pt
        totals["completion_tokens"] += ct
        totals["total_tokens"] += tt
        totals["cost_usd"] += cost

        prov = row.get("provider") or "unknown"
        bp = by_provider.setdefault(prov, {"provider": prov, "calls": 0,
                                           "total_tokens": 0, "cost_usd": 0.0})
        bp["calls"] += 1
        bp["total_tokens"] += tt
        bp["cost_usd"] += cost

        knd = row.get("kind") or "unknown"
        bk = by_kind.setdefault(knd, {"kind": knd, "calls": 0,
                                      "total_tokens": 0, "cost_usd": 0.0})
        bk["calls"] += 1
        bk["total_tokens"] += tt
        bk["cost_usd"] += cost

        ts = _parse_ts(row.get("created_at"))
        if ts and ts >= midnight:
            today["calls"] += 1
            today["total_tokens"] += tt
            today["cost_usd"] += cost
        if ts and ts >= cutoff_30d:
            last_30d["calls"] += 1
            last_30d["total_tokens"] += tt
            last_30d["cost_usd"] += cost

    # Round the money fields (avoid float-dust like 0.0020000000003 in the UI).
    for d in (totals, today, last_30d):
        d["cost_usd"] = round(d["cost_usd"], 6)
    for d in list(by_provider.values()) + list(by_kind.values()):
        d["cost_usd"] = round(d["cost_usd"], 6)

    last_call = None
    if rows and isinstance(rows[0], dict):
        h = rows[0]
        last_call = {
            "created_at": h.get("created_at"),
            "provider": h.get("provider"),
            "model": h.get("model"),
            "kind": h.get("kind"),
            "total_tokens": int(h.get("total_tokens") or 0),
            "cost_usd": float(h.get("cost_usd") or 0.0),
            "fell_back": bool(h.get("fell_back")),
        }

    return {
        "configured": True,
        "totals": totals,
        "today": today,
        "last_30d": last_30d,
        "by_provider": sorted(by_provider.values(), key=lambda x: x["cost_usd"], reverse=True),
        "by_kind": sorted(by_kind.values(), key=lambda x: x["calls"], reverse=True),
        "last_call": last_call,
        "all_time_calls": all_time,
        "window_capped": all_time > len(rows),
    }


# ── BUDGET / KILL SWITCH — owner-controlled credit guard (app_settings) ───────────────
# The owner toggles these on the Monitor "API Budgets & Limits" card; they live in
# app_settings key "content_forge_budget" (owner-write RLS, read here via service role —
# no new migration). Shape: {enabled: bool, daily_limit_usd: number, daily_call_limit: int}.
# When enabled is false (kill switch) OR a positive daily limit is hit, discover + expand
# SKIP the LLM entirely — zero credit spend. Defaults are permissive (enabled, no limit) so
# a missing/empty setting never blocks the pipeline.
async def _read_budget_settings(client: httpx.AsyncClient) -> dict[str, Any]:
    """Read the Content Forge budget/kill-switch from app_settings. Best-effort — returns the
    permissive default (enabled, no limits) if the key/table is absent or on any error, so the
    guard can only ever be tightened deliberately, never break the pipeline by accident."""
    out = {"enabled": True, "daily_limit_usd": 0.0, "daily_call_limit": 0}
    url = _supabase_url()
    if not url:
        return out
    try:
        r = await client.get(
            f"{url}/rest/v1/app_settings?key=eq.content_forge_budget&select=value&limit=1",
            headers=_supabase_headers(),
        )
        if r.status_code == 200 and isinstance(r.json(), list) and r.json():
            v = r.json()[0].get("value") or {}
            if isinstance(v, dict):
                en = v.get("enabled")
                out["enabled"] = True if en is None else bool(en)
                try:
                    out["daily_limit_usd"] = max(0.0, float(v.get("daily_limit_usd") or 0))
                except (TypeError, ValueError):
                    pass
                try:
                    out["daily_call_limit"] = max(0, int(v.get("daily_call_limit") or 0))
                except (TypeError, ValueError):
                    pass
    except Exception as e:  # noqa: BLE001
        log.info("content_forge: budget-settings read failed (default permissive): %s", e)
    return out


async def _today_usage(client: httpx.AsyncClient) -> tuple[int, float]:
    """Today's (UTC) Content Forge LLM usage from content_forge_usage: (calls, cost_usd).
    Call count is exact (Content-Range header); cost is summed from the day's rows (tiny
    volume). Best-effort: (0, 0.0) if the table is missing or on any error."""
    url = _supabase_url()
    if not url:
        return (0, 0.0)
    midnight = _dt.datetime.now(tz=_dt.timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0).isoformat()
    try:
        r = await client.get(
            f"{url}/rest/v1/content_forge_usage?select=cost_usd&created_at=gte.{midnight}&limit=5000",
            headers={**_supabase_headers(), "Prefer": "count=exact",
                     "Range-Unit": "items", "Range": "0-4999"},
        )
        if r.status_code in (200, 206):
            rows = r.json() if isinstance(r.json(), list) else []
            cost = round(sum(float(x.get("cost_usd") or 0) for x in rows if isinstance(x, dict)), 6)
            cr = r.headers.get("content-range") or r.headers.get("Content-Range") or ""
            calls = len(rows)
            if "/" in cr:
                tail = cr.rsplit("/", 1)[-1].strip()
                if tail.isdigit():
                    calls = int(tail)
            return (calls, cost)
    except Exception as e:  # noqa: BLE001
        log.info("content_forge: today-usage read failed: %s", e)
    return (0, 0.0)


async def _forge_llm_gate(client: httpx.AsyncClient) -> tuple[bool, str]:
    """The credit guard checked before every discover/expand LLM call. Returns
    (allowed, reason). Blocks when the kill switch is off, or when a positive daily spend /
    call limit has been reached today. Permissive on any read failure (allowed=True)."""
    s = await _read_budget_settings(client)
    if not s["enabled"]:
        return False, "Content Forge LLM is switched OFF (kill switch) — no credit spend"
    lim, clim = s["daily_limit_usd"], s["daily_call_limit"]
    if (lim and lim > 0) or (clim and clim > 0):
        calls, cost = await _today_usage(client)
        if lim and lim > 0 and cost >= lim:
            return False, f"daily spend limit ${lim:.2f} reached (today ${cost:.4f})"
        if clim and clim > 0 and calls >= clim:
            return False, f"daily call limit {clim} reached (today {calls})"
    return True, ""


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


# ── Vertex auth — service-account access token (cached) ───────────────────────────────
# Vertex calls need a short-lived OAuth Bearer token minted from the service-account JSON.
# Tokens last ~1h; we cache for 45m to avoid refreshing on every LLM call. Module-level
# cache is fine — the box runs single-process per worker and the token is read-only.
_vertex_token_cache: dict[str, Any] = {"token": None, "valid_until": 0.0}


def _get_vertex_token() -> str | None:
    """Return a cached/refreshed GCP access token from GCP_SA_JSON, or None if the SA JSON
    is absent/invalid (Vertex rung then skips). Never raises — a refresh failure logs a
    warning and returns None so the ladder escalates to the next rung."""
    import time
    if _vertex_token_cache["token"] and time.time() < _vertex_token_cache["valid_until"]:
        return _vertex_token_cache["token"]
    sa_json = _gcp_sa_json()
    if not sa_json:
        return None
    try:
        from google.oauth2 import service_account            # type: ignore
        import google.auth.transport.requests as _gr         # type: ignore
        creds = service_account.Credentials.from_service_account_info(
            json.loads(sa_json),
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        creds.refresh(_gr.Request())
        _vertex_token_cache["token"] = creds.token
        _vertex_token_cache["valid_until"] = time.time() + 2700  # 45 min
        return creds.token
    except Exception as e:  # noqa: BLE001 — bad JSON / network / missing dep → skip rung
        log.warning("content_forge: Vertex SA token refresh failed: %s", e)
        _vertex_token_cache["token"] = None
        return None


def _call_gemini_api(messages: list[dict[str, str]], *,
                     model: str = DEFAULT_GEMINI_MODEL) -> tuple[str, str, dict[str, int]]:
    """Ladder rung 1 — Gemini API (AI Studio) free tier, OpenAI-compatible. Same request
    shape as _call_openrouter; single model (the free quota is per-project, not per-model,
    so a model fallback chain buys nothing here). Returns (text, model_used, usage). Raises
    RuntimeError on any non-200 so the ladder escalates (429/5xx == rate/temp; 4xx == key)."""
    key = _gemini_key()
    if not key:
        raise RuntimeError("GEMINI_API_KEY unset")
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {"model": model, "messages": messages, "temperature": 0.4,
               # Gemini 2.5 is a THINKING model — reasoning tokens share the output budget, so
               # a tight cap truncates the JSON array. Headroom + minimal thinking keep it whole.
               "max_tokens": GEMINI_MAX_TOKENS, "reasoning_effort": "minimal"}
    with httpx.Client(timeout=LLM_TIMEOUT) as client:
        r = client.post(f"{GEMINI_API_BASE}/chat/completions", headers=headers, json=payload)
    if r.status_code == 200:
        try:
            data = r.json()
            return (data["choices"][0]["message"]["content"] or ""), model, _usage_from_openai(data)
        except Exception as e:  # noqa: BLE001 — odd body → escalate
            raise RuntimeError(f"Gemini API malformed response: {e}")
    raise RuntimeError(f"Gemini API HTTP {r.status_code}: {r.text[:300]}")


def _call_vertex_gemini(messages: list[dict[str, str]], *,
                        model: str = DEFAULT_VERTEX_GEMINI_MODEL) -> tuple[str, str, dict[str, int]]:
    """Ladder rung 2 — Vertex AI Gemini (bills the $300 GCP credit), OpenAI-compatible
    endpoint authed with the cached SA Bearer token. Returns (text, model_used, usage). Raises
    RuntimeError on missing token / non-200 so the ladder escalates."""
    project, region = _gcp_project(), _gcp_region()
    token = _get_vertex_token()
    if not token:
        raise RuntimeError("Vertex SA token unavailable (GCP_SA_JSON missing/invalid)")
    url = (f"https://{region}-aiplatform.googleapis.com/v1/projects/{project}"
           f"/locations/{region}/endpoints/openapi/chat/completions")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {"model": model, "messages": messages, "temperature": 0.4,
               # Gemini 2.5 thinking — see _call_gemini_api: give the JSON room past reasoning.
               "max_tokens": GEMINI_MAX_TOKENS, "reasoning_effort": "minimal"}
    with httpx.Client(timeout=LLM_TIMEOUT) as client:
        r = client.post(url, headers=headers, json=payload)
    if r.status_code == 200:
        try:
            data = r.json()
            return (data["choices"][0]["message"]["content"] or ""), model, _usage_from_openai(data)
        except Exception as e:  # noqa: BLE001 — odd body → escalate
            raise RuntimeError(f"Vertex Gemini malformed response: {e}")
    raise RuntimeError(f"Vertex Gemini HTTP {r.status_code}: {r.text[:300]}")


def _forge_llm(messages: list[dict[str, str]], *, tier: str = "free",
               kind: str = "discovery") -> tuple[str, dict[str, Any]]:
    """PROVIDER SEAM — the ONLY place the Content Forge LLM provider is selected.

    Escalating ladder (cheapest-first; each rung skipped when its keys are absent, a
    RuntimeError at any rung escalates to the next):
        1. Gemini API (AI Studio, free ~1500/day)   — GEMINI_API_KEY
        2. Vertex AI Gemini ($300 GCP credit)        — GCP_PROJECT_ID + GCP_SA_JSON
        3. Anthropic direct (optional pro)           — ANTHROPIC_API_KEY
        4. OpenRouter free chain (existing safety net) — OPENROUTER_API_KEY
    (Claude-on-Vertex is intentionally NOT wired — the promo credit excludes Marketplace
    purchases, so it would bill a real card. A future session can add a `_rung_vertex_claude`
    above the OpenRouter rung.)

    `messages` is a chat-style [{role, content}] list. `kind` ∈ {discovery, expansion}
    still selects the Anthropic model. `tier` is retained for call-site backward-compat but
    no longer gates free-vs-pro — the ladder auto-escalates. Returns (text, meta) where meta
    carries provider/model/tier_used + fell_back (True once any earlier rung errored).
    Raises RuntimeError only when EVERY configured rung is exhausted."""

    def _rung_gemini_api():
        if not _gemini_key():
            return None
        model = (os.environ.get("CONTENT_FORGE_MODEL_GEMINI") or "").strip() or DEFAULT_GEMINI_MODEL
        text, used, usage = _call_gemini_api(messages, model=model)
        return text, {"provider": "gemini_api", "model": used, "tier_used": "gemini", "usage": usage}

    def _rung_vertex_gemini():
        if not (_gcp_project() and _gcp_sa_json()):
            return None
        model = (os.environ.get("CONTENT_FORGE_MODEL_VERTEX_GEMINI") or "").strip() \
            or DEFAULT_VERTEX_GEMINI_MODEL
        text, used, usage = _call_vertex_gemini(messages, model=model)
        return text, {"provider": "vertex_gemini", "model": used, "tier_used": "vertex", "usage": usage}

    def _rung_anthropic():
        if not _anthropic_key():
            return None
        model = _discovery_model() if kind == "discovery" else _expansion_model()
        text, usage = _call_anthropic(messages, model=model)
        return text, {"provider": "anthropic", "model": model, "tier_used": "pro", "usage": usage}

    def _rung_openrouter():
        text, used, usage = _call_openrouter(messages, models=_free_models())
        return text, {"provider": "openrouter", "model": used, "tier_used": "free", "usage": usage}

    rungs = [_rung_gemini_api, _rung_vertex_gemini, _rung_anthropic, _rung_openrouter]

    fell_back = False
    last_err = "no provider configured"
    for rung in rungs:
        try:
            result = rung()
        except RuntimeError as e:
            last_err = str(e)
            log.info("content_forge: provider rung failed (%s) — escalating", last_err)
            fell_back = True
            continue
        if result is None:
            continue  # provider not configured → skip silently
        text, meta = result
        meta["fell_back"] = fell_back
        # Stamp an estimated USD cost from the captured token usage + price table, so the
        # caller can log it for the Monitor budgets card. usage defaults to zeros if a
        # provider omitted it; cost is $0 for unknown models / the free OpenRouter chain.
        meta.setdefault("usage", {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0})
        meta["cost_usd"] = _estimate_cost(meta.get("provider", ""), meta.get("model", ""), meta["usage"])
        return text, meta
    raise RuntimeError(f"all providers exhausted; last: {last_err}")


def _call_openrouter(messages: list[dict[str, str]], *,
                     models: list[str] | str) -> tuple[str, str, dict[str, int]]:
    """FREE provider call — OpenRouter OpenAI-compatible chat completions over httpx.
    Same request/headers shape as reel_deconstruct.run_narrative().

    `models` is the ordered fallback chain (or a single id). Each model is tried in
    turn; a RETRYABLE upstream condition (404 model gone / 429 rate-limited / 5xx)
    falls through to the next model, while a hard client error (401/400) stops
    immediately. Returns (text, model_used, usage). Raises RuntimeError only if EVERY model
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
                return (data["choices"][0]["message"]["content"] or ""), model, _usage_from_openai(data)
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


def _call_anthropic(messages: list[dict[str, str]], *, model: str) -> tuple[str, dict[str, int]]:
    """PRO provider call — Anthropic Messages API via the `anthropic` SDK. Splits the
    chat-style messages into a top-level `system` string + user/assistant turns (the
    Messages API takes system separately). The large discovery system prompt carries a
    cache_control: {type: "ephemeral"} breakpoint so repeat discovery runs hit the prompt
    cache (it's padded well over the ~1024-token minimum; the short expansion prompt won't
    cache, which is fine). Returns (text, usage). Imported lazily so this module loads even
    if `anthropic` isn't installed (the free-only deployments)."""
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
    # Map Anthropic's input/output token names onto the shared prompt/completion shape so
    # _estimate_cost prices it uniformly. Cache reads/writes are billed differently, but at
    # Content Forge volume the small discrepancy isn't worth tracking separately.
    u = getattr(resp, "usage", None)
    pt = int(getattr(u, "input_tokens", 0) or 0) if u else 0
    ct = int(getattr(u, "output_tokens", 0) or 0) if u else 0
    usage = {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": pt + ct}
    return "".join(parts), usage


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


async def _discover_worker(batch_id: str, tier: str, country: str | None,
                           only_new: bool = True) -> None:
    """Fire-and-forget discovery: read transcript_clips, run ONE batched LLM pass via the
    provider seam, upsert content_opportunities tagged with discovery_run_id=batch_id.
    only_new=True (default) feeds ONLY clips not yet analyzed (token-saver); ?rescan=1 forces
    the full recent window. Never raises."""
    try:
        async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as client:
            # Credit guard — kill switch / daily limit. Skip the whole pass (no clip read,
            # no LLM, no marking) when blocked, so re-enabling re-analyzes the same footage.
            allowed, reason = await _forge_llm_gate(client)
            if not allowed:
                log.info("content_forge: discover batch=%s SKIPPED — %s", batch_id, reason)
                return
            clips = await _read_clips_for_discovery(client, only_new=only_new)
            if not clips:
                log.info("content_forge: discover batch=%s — no clips to analyze%s",
                         batch_id, " (no new clips since last pass)" if only_new else "")
                return
            existing = await _read_existing_titles(client, country)  # cross-run dedup hint
            transcript = _clips_to_prompt(clips)
            avoid = ""
            if existing:
                avoid = ("ALREADY COVERED — do NOT repeat or rephrase these existing angles; "
                         "propose only NEW ones:\n"
                         + "\n".join(f"- {t}" for t in existing) + "\n\n")
            user = (
                f"{_DISCOVERY_GUIDANCE}\n\n"
                + (f"TARGET COUNTRY/REGION: {country}\n\n" if country else "")
                + avoid
                + f"FOOTAGE TRANSCRIPT CLIPS:\n{transcript}"
            )
            messages = [
                {"role": "system", "content": _SYSTEM_BY_KIND["discovery"]},
                {"role": "user", "content": user},
            ]
            # Provider seam — free (Gemini) by default, pro (Haiku) if requested+keyed.
            text, meta = _forge_llm(messages, tier=tier, kind="discovery")
            # Log the call's token usage + cost (best-effort; never blocks discovery).
            await _log_usage(client, kind="discovery", meta=meta, batch_id=batch_id)
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
            # Windowing: stamp the clips we just analyzed so the next pass skips them.
            # Mark on a successful LLM pass even if 0 rows (the footage WAS analyzed), but not
            # on a hard provider failure (handled by the outer except → clips stay un-stamped
            # and get retried next pass).
            await _mark_clips_discovered(client, [str(c.get("id")) for c in clips if c.get("id")])
            log.info("content_forge: discover batch=%s provider=%s tier=%s clips=%d items=%d "
                     "upserted=%d avoid=%d only_new=%s", batch_id, meta.get("provider"),
                     meta.get("tier_used"), len(clips), len(rows), written, len(existing), only_new)
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
        "openrouter_set": bool(_openrouter_key()),       # free tier (safety-net rung)
        "gemini_api_set": bool(_gemini_key()),           # ladder rung 1 (AI Studio free)
        "vertex_configured": bool(_gcp_project() and _gcp_sa_json()),  # ladder rung 2 ($300 credit)
        "gcp_project": _gcp_project() or "",
        "gcp_region": _gcp_region(),
        "anthropic_set": bool(_anthropic_key()),         # optional pro rung
        "tavily_set": bool(_tavily_key()),               # optional grounding
        "transcript_dir_set": bool(_transcript_dir()),   # optional disk ingest
        "free_model": _free_model(),
        "gemini_model": (os.environ.get("CONTENT_FORGE_MODEL_GEMINI") or "").strip() or DEFAULT_GEMINI_MODEL,
        "vertex_gemini_model": (os.environ.get("CONTENT_FORGE_MODEL_VERTEX_GEMINI") or "").strip() or DEFAULT_VERTEX_GEMINI_MODEL,
        "discovery_model": _discovery_model(),
        "expansion_model": _expansion_model(),
    }, status_code=200)


@router.get("/usage")
async def usage(request: Request):
    """GET /api/content-forge/usage?secret=<CONTENT_FORGE_SECRET> → live LLM spend rollup.

    Secret-gated (401 without a valid secret). Aggregates content_forge_usage — one row per
    discovery/expansion LLM call — into all-time + today + last-30d totals (calls / tokens /
    cost_usd), per-provider and per-kind breakdowns, and the last call. Powers the Monitor
    "API Budgets & Limits" card's live Vertex usage. `configured:false` (all zeros) means the
    0106 table isn't applied yet — the card then falls back to its static credit-window view.
    Also echoes the price table so the card can show each provider's per-MTok rate."""
    if not _check_secret(request):
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=401)
    async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as client:
        rollup = await _read_usage_rollup(client)
        budget = await _read_budget_settings(client)
    # Compute the live blocked state from today's spend (already in the rollup) vs the limits,
    # so the card can render the same verdict the backend gate enforces.
    today_cost = (rollup.get("today") or {}).get("cost_usd", 0.0) or 0.0
    today_calls = (rollup.get("today") or {}).get("calls", 0) or 0
    blocked = (not budget["enabled"]) \
        or (budget["daily_limit_usd"] > 0 and today_cost >= budget["daily_limit_usd"]) \
        or (budget["daily_call_limit"] > 0 and today_calls >= budget["daily_call_limit"])
    budget_out = {**budget, "blocked": blocked}
    # Per-MTok price table (input, output) so the frontend can label live rates without
    # hardcoding numbers that could drift from the backend's pricing.
    prices = {m: {"input_per_mtok": p[0], "output_per_mtok": p[1]}
              for m, p in _MODEL_PRICES.items()}
    return JSONResponse({"ok": True, "generated_at": _now_iso(),
                         "prices": prices, "budget": budget_out, **rollup}, status_code=200)


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
    immediately; poll /discover-status/{batch_id} for the results.

    Incremental by default (feeds only un-analyzed clips). Pass ?rescan=1 to force a full
    re-scan of the recent clip window (e.g. to re-discover after the backlog is drained)."""
    if not _check_secret(request):
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=401)
    tier = (request.query_params.get("tier") or "free").strip().lower()
    country = request.query_params.get("country") or None
    only_new = (request.query_params.get("rescan") or "").strip().lower() not in ("1", "true", "yes")
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
    background_tasks.add_task(_discover_worker, batch_id, tier, country, only_new)
    return JSONResponse({"ok": True, "batch_id": batch_id, "tier": tier,
                         "country": country, "only_new": only_new}, status_code=200)


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

        # Credit guard — kill switch / daily limit. Return a non-error "blocked" so the UI can
        # surface it without treating it as a backend failure (HTTP 200, ok:false, blocked).
        allowed, reason = await _forge_llm_gate(client)
        if not allowed:
            return JSONResponse({"ok": False, "blocked": True, "error": reason,
                                 "opportunity_id": opp_id}, status_code=200)

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
            # Log the call's token usage + cost (best-effort; never blocks hook generation).
            await _log_usage(client, kind="expansion", meta=meta, batch_id=None)
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
