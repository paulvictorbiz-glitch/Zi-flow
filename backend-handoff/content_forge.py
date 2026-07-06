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
import asyncio
import logging
import datetime as _dt
from typing import Any
from urllib.parse import quote

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


# Country/trip folder label from an absolute disk path — a Python port of the frontend
# footageFolderLabel() (src/lib/footage-brain-client.js). MUST stay byte-for-byte
# equivalent so the Content Forge folder picker's option ("Japan") matches the value
# stamped on transcript_clips.folder (the discover filter is &folder=eq.<label>).
_FOLDER_GENERIC = re.compile(r"^(\d+\s*media|dcim|media|clips|videos?|footage|\d+)$", re.I)
_FOLDER_ORDINAL = re.compile(r"^\s*\d+(?:\.\d+)?\s*[\)\.]\s*")


def _folder_label(path: str | None) -> str | None:
    """e.g. r'D:\\Videos\\2024\\03) Japan\\DCIM\\clip.mp4' -> 'Japan'. None if undeterminable."""
    if not path:
        return None
    parts = [p for p in re.split(r"[\\/]+", str(path)) if p]
    if len(parts) < 2:
        return None
    for i in range(len(parts) - 2, 0, -1):        # walk up from the parent
        seg = parts[i]
        if _FOLDER_GENERIC.match(seg):            # skip 101MEDIA / DCIM / numbered dirs
            continue
        return _FOLDER_ORDINAL.sub("", seg).strip() or seg   # strip leading "03) "
    return None


# ── service-role Supabase REST helpers ────────────────────────────────────────────────
async def _fetch_reel_drive_maps(client: httpx.AsyncClient,
                                 reel_ids: list[str]) -> dict[str, dict[str, dict[str, Any]]]:
    """For a set of reel ids, read reels.detail.footageDrive (migration 0005) and return
    {reel_id: {footage_file_id: {drive_url, drive_folder_url}}}. This is where the real
    Google Drive links live (attached_footage_items has NO drive columns — 0009). Used at
    ingest to stamp drive_url/drive_folder_url onto each clip. Best-effort: {} on error."""
    url = _supabase_url()
    ids = [r for r in {str(x) for x in reel_ids if x}]
    if not url or not ids:
        return {}
    out: dict[str, dict[str, dict[str, Any]]] = {}
    # Chunk the in-list so the URL length stays sane.
    for i in range(0, len(ids), 100):
        in_list = ",".join(ids[i:i + 100])
        try:
            r = await client.get(
                f"{url}/rest/v1/reels?select=id,detail&id=in.({in_list})",
                headers=_supabase_headers(),
            )
            if r.status_code != 200:
                log.warning("content_forge: reel drive-map HTTP %s: %s", r.status_code, r.text[:200])
                continue
            for row in (r.json() or []):
                detail = row.get("detail")
                fd = detail.get("footageDrive") if isinstance(detail, dict) else None
                if isinstance(fd, dict):
                    out[str(row.get("id"))] = fd
        except Exception as e:  # noqa: BLE001
            log.warning("content_forge: reel drive-map failed: %s", e)
    return out


# Same-box FootageBrain backend base for the Drive-link fallback. /api/files/<id>
# returns drive_url/drive_folder_url — the live source the frontend uses when a reel's
# detail.footageDrive map is empty. Overridable via env for non-prod.
FB_FILES_BASE = (os.environ.get("FB_FILES_BASE") or "http://localhost:8000").rstrip("/")


async def _resolve_drive_via_fb(client: httpx.AsyncClient,
                                ffids: list[str]) -> dict[str, dict[str, Any]]:
    """Fallback Drive resolver: for footage_file_ids NOT covered by any reel's
    detail.footageDrive, ask the FootageBrain backend /api/files/<id> (same box) for the
    Drive links. Bounded concurrency, best-effort — a miss/null just degrades to None."""
    out: dict[str, dict[str, Any]] = {}
    ids = [i for i in {str(x) for x in ffids if x} if i]
    if not ids:
        return out
    sem = asyncio.Semaphore(8)

    async def _one(fid: str) -> None:
        async with sem:
            try:
                r = await client.get(f"{FB_FILES_BASE}/api/files/{fid}", timeout=10.0)
                if r.status_code == 200:
                    d = r.json()
                    if isinstance(d, dict) and (d.get("drive_url") or d.get("drive_folder_url")):
                        out[fid] = {"drive_url": d.get("drive_url"),
                                    "drive_folder_url": d.get("drive_folder_url")}
            except Exception:  # noqa: BLE001 — best-effort enrichment
                pass

    await asyncio.gather(*[_one(f) for f in ids])
    return out


# ── whole-library ingest source (FootageBrain /api/files catalog) ─────────────────────
# Beyond the ~12 reel-attached clips, the FootageBrain backend indexes the owner's ENTIRE
# footage library (~9.7k files, ~8.3k transcribed). These helpers pull that catalog (same
# box, localhost:8000) so Content Forge can mine the whole library, not just attached reels.
# For library clips the soft footage_file_id IS the real video-file id, so the Drive link is
# stamped straight off the file row (no reel→footageDrive lookup) and the modal's Drive
# resolver already works for them.
FB_FILES_PAGE = 500   # /api/files pagination size (matches the dashboard's own paging)


async def _fetch_library_files(client: httpx.AsyncClient, *, folder: str | None = None,
                               max_files: int = 0, offset: int = 0) -> list[dict[str, Any]]:
    """Paginate the FootageBrain /api/files catalog and return TRANSCRIBED file records,
    optionally restricted to one folder label (_folder_label(abs_path) == folder) and
    capped at max_files. folder filtering is client-side on abs_path (the API has no folder
    filter) so the label space exactly matches the picker + transcript_clips.folder.
    Best-effort: returns what it gathered (and stops) on any HTTP/parse error."""
    base = f"{FB_FILES_BASE}/api/files"
    out: list[dict[str, Any]] = []
    off = max(0, int(offset or 0))
    while True:
        try:
            r = await client.get(f"{base}?limit={FB_FILES_PAGE}&offset={off}", timeout=30.0)
        except Exception as e:  # noqa: BLE001
            log.warning("content_forge: library files fetch failed at offset %s: %s", off, e)
            break
        if r.status_code != 200:
            log.warning("content_forge: library files HTTP %s at offset %s", r.status_code, off)
            break
        try:
            batch = r.json()
        except Exception:  # noqa: BLE001
            break
        if not isinstance(batch, list) or not batch:
            break
        for f in batch:
            if not isinstance(f, dict) or not f.get("transcribed"):
                continue
            if folder and _folder_label(f.get("abs_path")) != folder:
                continue
            out.append(f)
            if max_files and len(out) >= max_files:
                return out
        if len(batch) < FB_FILES_PAGE:
            break
        off += len(batch)
    return out


async def _fetch_fb_transcript(client: httpx.AsyncClient, file_id: str) -> list[dict[str, Any]]:
    """Fetch one library file's transcript from FootageBrain /api/files/<id>/transcript →
    [{start_time, end_time, text, chunk_index}]. Many transcribed files have NO speech
    (scenery / b-roll) and return [] — those are skipped by the caller. Best-effort: [] on
    any error/empty."""
    try:
        r = await client.get(f"{FB_FILES_BASE}/api/files/{file_id}/transcript", timeout=20.0)
        if r.status_code == 200:
            data = r.json()
            return data if isinstance(data, list) else []
        log.info("content_forge: fb transcript HTTP %s (%s)", r.status_code, file_id)
    except Exception as e:  # noqa: BLE001
        log.info("content_forge: fb transcript fetch failed (%s): %s", file_id, e)
    return []


# Cap the existing-id skip-set read so a re-run never pages the whole table unbounded.
MAX_EXISTING_FFIDS = 60000


async def _existing_clip_file_ids(client: httpx.AsyncClient) -> set[str]:
    """Set of footage_file_ids already present in transcript_clips, so a library ingest
    re-run skips re-fetching transcripts it already has. Bounded paged read; best-effort —
    an empty set just means it re-fetches (still idempotent via the upsert key)."""
    url = _supabase_url()
    seen: set[str] = set()
    if not url:
        return seen
    page, off = 1000, 0
    while off < MAX_EXISTING_FFIDS:
        try:
            r = await client.get(
                f"{url}/rest/v1/transcript_clips?select=footage_file_id&limit={page}&offset={off}",
                headers=_supabase_headers(),
            )
            if r.status_code != 200:
                break
            rows = r.json()
            if not isinstance(rows, list) or not rows:
                break
            for x in rows:
                fid = x.get("footage_file_id") if isinstance(x, dict) else None
                if fid:
                    seen.add(str(fid))
            if len(rows) < page:
                break
            off += len(rows)
        except Exception:  # noqa: BLE001
            break
    return seen


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
    q = ("select=id,filename,reel_id,footage_file_id,source_path,full_transcript"
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


# Columns added by migration 0108 (folder-scoped discovery + per-clip Drive links). Kept as
# a set so upsert/select can DEGRADE-SAFE strip them if the migration hasn't run yet — same
# pattern as the last_discovered_at (0105) fallback below.
_CLIP_0108_COLS = ("folder", "source_path", "drive_url", "drive_folder_url")


async def _upsert_transcript_clips(client: httpx.AsyncClient,
                                   clips: list[dict[str, Any]]) -> int:
    """Upsert transcript_clips rows, deduped on a STABLE composite key
    (footage_file_id, start_time, end_time) so re-running ingest is idempotent. Requires a
    FULL unique index on those columns to act as the on_conflict arbiter (the DB team owns
    that). PostgREST bulk upsert in chunks; returns the count attempted (best-effort).

    DEGRADE-SAFE for migration 0108: clip dicts may carry folder/source_path/drive_url/
    drive_folder_url. If those columns don't exist yet, PostgREST 400s the whole chunk — we
    retry once with those keys stripped so ingest keeps working (columns just stay NULL,
    backfilled by a future re-ingest) instead of silently writing zero clips."""
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
                continue
            if r.status_code == 400:
                stripped = [{k: v for k, v in row.items() if k not in _CLIP_0108_COLS}
                            for row in chunk]
                r2 = await client.post(
                    f"{url}/rest/v1/transcript_clips"
                    "?on_conflict=footage_file_id,start_time,end_time",
                    headers=headers,
                    json=stripped,
                )
                if r2.status_code in (200, 201, 204):
                    written += len(stripped)
                    continue
                log.warning("content_forge: clip upsert HTTP %s (retry %s): %s",
                            r.status_code, r2.status_code, r2.text[:300])
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
                                    only_new: bool = True,
                                    folder: str | None = None) -> list[dict[str, Any]]:
    """Read a bounded window of transcript_clips for a discovery pass.

    INCREMENTAL by default (only_new=True): feeds only clips not yet analyzed
    (last_discovered_at IS NULL), newest first, capped at `limit` — so a repeat Discover
    pass doesn't re-spend the LLM on the same footage. An empty result then legitimately
    means "no new clips" (the worker logs + returns). DEGRADE-SAFE: if the
    last_discovered_at column doesn't exist yet (migration 0105 not applied), the filtered
    request 400s → we fall back to the original unfiltered recent window so prod behaviour
    is unchanged. only_new=False forces the full recent window (a deliberate ?rescan=1).

    FOLDER-SCOPED (folder set): restrict to clips whose folder column matches (migration
    0108) and order SEQUENTIALLY by source_path then start_time — so a small `limit`
    (e.g. 20) walks the folder in order, advancing each pass as clips are marked discovered.
    Unscoped (folder None): keep the legacy newest-first recent window.

    DEGRADE-SAFE for migration 0108: the extended select (folder/source_path/drive_url/
    drive_folder_url) and the folder= scope filter both 400 if 0108 hasn't run yet. On any
    non-200 from the extended query we retry once with the pre-0108 select + the legacy
    unscoped window, so Discover keeps working (just without folder-scoping) instead of
    silently returning zero clips."""
    url = _supabase_url()
    if not url:
        return []
    select_ext = ("select=id,footage_file_id,filename,start_time,end_time,transcript_text,"
                  "keywords,topics,folder,source_path,drive_url,drive_folder_url")
    select_legacy = ("select=id,footage_file_id,filename,start_time,end_time,transcript_text,"
                     "keywords,topics")
    scope_ext = ((f"&folder=eq.{quote(folder, safe='')}&order=source_path.asc,start_time.asc")
                 if folder else "&order=created_at.desc")

    async def _try(select: str, scope: str) -> tuple[bool, list[dict[str, Any]]]:
        base = f"{url}/rest/v1/transcript_clips?{select}{scope}&limit={int(limit)}"
        return await _read_clips_window(client, base, only_new)

    ok, data = await _try(select_ext, scope_ext)
    if ok:
        return data
    log.info("content_forge: extended clip select HTTP fail (0108 not applied?) — "
             "falling back to legacy select/window")
    ok, data = await _try(select_legacy, "&order=created_at.desc")
    return data if ok else []


async def _read_clips_window(client: httpx.AsyncClient, base: str,
                             only_new: bool) -> tuple[bool, list[dict[str, Any]]]:
    """Shared GET+fallback body for _read_clips_for_discovery: tries the incremental
    last_discovered_at filter first (DEGRADE-SAFE for migration 0105), then the unfiltered
    window. Returns (ok, rows) — ok=False means both attempts failed (caller decides whether
    to retry with a different select/scope, or give up)."""
    try:
        if only_new:
            r = await client.get(base + "&last_discovered_at=is.null", headers=_supabase_headers())
            if r.status_code == 200:
                data = r.json()
                return True, (data if isinstance(data, list) else [])
            # Column missing (pre-0105) or filter rejected → fall back to the full window.
            log.info("content_forge: incremental clip read HTTP %s — falling back to full window",
                     r.status_code)
        r = await client.get(base, headers=_supabase_headers())
        if r.status_code == 200:
            data = r.json()
            return True, (data if isinstance(data, list) else [])
        log.warning("content_forge: clip read HTTP %s: %s", r.status_code, r.text[:300])
    except Exception as e:  # noqa: BLE001
        log.warning("content_forge: clip read failed: %s", e)
    return False, []


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


# Columns added by migration 0111 (entities_mentioned) — degrade-safe like the 0108 clip
# columns: if the migration hasn't been applied yet, PostgREST 400s the whole batch on an
# unknown column, so we retry once with these keys stripped rather than losing the run.
_OPP_0111_COLS = {"entities_mentioned"}


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
        if r.status_code == 400:
            stripped = [{k: v for k, v in row.items() if k not in _OPP_0111_COLS}
                        for row in rows]
            r2 = await client.post(
                f"{url}/rest/v1/content_opportunities"
                "?on_conflict=discovery_run_id,country,title",
                headers=headers,
                json=stripped,
            )
            if r2.status_code in (200, 201, 204):
                return len(stripped)
            log.warning("content_forge: opportunity upsert HTTP %s (retry %s): %s",
                        r.status_code, r2.status_code, r2.text[:300])
        else:
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


async def _read_last_discover(client: httpx.AsyncClient) -> dict[str, Any] | None:
    """Read the last discovery pass's clip/truncation stats from app_settings
    (key 'content_forge_last_discover', written by _write_last_discover). Powers the
    Monitor's transcript-truncation line. Returns None if absent or on any error."""
    url = _supabase_url()
    if not url:
        return None
    try:
        r = await client.get(
            f"{url}/rest/v1/app_settings?key=eq.content_forge_last_discover&select=value&limit=1",
            headers=_supabase_headers(),
        )
        if r.status_code == 200 and isinstance(r.json(), list) and r.json():
            v = r.json()[0].get("value")
            return v if isinstance(v, dict) else None
    except Exception as e:  # noqa: BLE001
        log.info("content_forge: last-discover read failed: %s", e)
    return None


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
    "script": (
        "You are a voice-over scriptwriter for short-form video (45-60 seconds, ~150-200 words). "
        "You write in the exact template structure requested — never skip a beat, never pad. "
        "You reply with STRICT JSON ONLY: no prose, no code fences."
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
               kind: str = "discovery",
               model_override: str | None = None) -> tuple[str, dict[str, Any]]:
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

    # Per-call model override (the owner's UI model toggle, e.g. 2.5-flash vs the
    # ~6x-cheaper 2.0-flash). Validated to a known model by the endpoint before it
    # reaches here. The Vertex rung uses the "google/"-prefixed form; the AI-Studio
    # (Gemini API) rung uses the bare form, so strip the prefix for that rung.
    ov = (model_override or "").strip() or None

    def _rung_gemini_api():
        # Cost/latency lever: when the AI-Studio Gemini key is card-tainted (every call
        # 100%-errors before escalating to Vertex), set CONTENT_FORGE_DISABLE_GEMINI_API=1
        # to skip this rung entirely — the ladder goes straight to Vertex with no wasted
        # failing round-trip. Keeps GEMINI_API_KEY in place for when the taint clears.
        if (os.environ.get("CONTENT_FORGE_DISABLE_GEMINI_API") or "").strip().lower() in ("1", "true", "yes"):
            return None
        if not _gemini_key():
            return None
        model = (ov.split("/")[-1] if ov else None) \
            or (os.environ.get("CONTENT_FORGE_MODEL_GEMINI") or "").strip() or DEFAULT_GEMINI_MODEL
        text, used, usage = _call_gemini_api(messages, model=model)
        return text, {"provider": "gemini_api", "model": used, "tier_used": "gemini", "usage": usage}

    def _rung_vertex_gemini():
        if not (_gcp_project() and _gcp_sa_json()):
            return None
        model = ov \
            or (os.environ.get("CONTENT_FORGE_MODEL_VERTEX_GEMINI") or "").strip() \
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

ENTITIES MENTIONED — the anti-generic step. For each opportunity, also pull out the concrete,
NAMEABLE things the transcript states or clearly implies: a place/landmark, a historical
event, a person, a cultural practice or tradition, a specific record/number/date. These are
the nouns a viewer could type into a search engine — NOT vague themes (those belong in
"topics"). A later step looks these up to pull real facts/history so the hook/title can cite
something specific ("the 700-year-old bridge" beats "an old bridge"). Only list entities the
transcript actually names or unambiguously implies — leave the array empty rather than guess.

Return a JSON ARRAY (8-20 items) of objects with EXACTLY these keys:
[
  {
    "title": "short, punchy working title for the opportunity",
    "angle_summary": "1-2 sentences on the angle and why it could perform",
    "country": "global" OR an ISO-ish country/region the angle targets (default "global"),
    "topics": ["topic", ...],
    "keywords": ["keyword", ...],
    "entities_mentioned": ["<specific named place/event/person/tradition/record from the transcript>", ...],
    "source_clip_ids": ["<clip id from the transcript>", ...],
    "virality_tier": "S" | "A" | "B" | "C",
    "virality_score": 0.0-1.0,
    "best_hook_style": "curiosity" | "controversy" | "personal_stakes"
  }
]
Output the JSON array ONLY — no prose, no code fences."""


# ── expansion prompt ──────────────────────────────────────────────────────────────────
def _expansion_user_prompt(opp: dict[str, Any], grounding: list[str]) -> str:
    entities = [str(e) for e in (opp.get("entities_mentioned") or []) if str(e).strip()]
    facts = ""
    if grounding:
        bullet = "\n".join(f"- {g}" for g in grounding[:6])
        facts = f"\n\nGROUNDING FACTS (verified; use only if relevant, do NOT contradict):\n{bullet}"
    specificity_note = (
        "\n\nAt least one hook SHOULD cite a concrete fact from the grounding facts above "
        "(a name, date, number) so it reads as specific rather than generic."
        if grounding else
        "\n\nNo verified outside facts were found for this one — stay strictly footage-grounded "
        "(the angle/topics/keywords above); do not invent history or statistics."
    )
    return (
        "Write EXACTLY 3 opening hooks for this short-form video opportunity — one in each "
        "style, in this order: curiosity, controversy, personal_stakes.\n\n"
        f"TITLE: {opp.get('title') or ''}\n"
        f"ANGLE: {opp.get('angle_summary') or ''}\n"
        f"TOPICS: {', '.join(opp.get('topics') or [])}\n"
        f"KEYWORDS: {', '.join(opp.get('keywords') or [])}\n"
        f"ENTITIES MENTIONED IN FOOTAGE: {', '.join(entities) if entities else '(none captured)'}"
        f"{facts}"
        f"{specificity_note}\n\n"
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


def _grounding_query(opp: dict[str, Any]) -> str:
    """Build the Tavily search query for an opportunity. Prefers the concrete named
    entities the discovery pass extracted from the transcript (a place, event, person,
    tradition, record) over the generic title/angle — "Zhangjiajie glass bridge history"
    returns real facts, "The Bridge Locals Fear" does not. Falls back to title+angle when
    no entities were captured (e.g. rows discovered before migration 0111, or genuinely
    entity-less footage)."""
    entities = [str(e).strip() for e in (opp.get("entities_mentioned") or []) if str(e).strip()]
    if entities:
        return (", ".join(entities[:3]) + " " + (opp.get("title") or "")).strip()
    return ((opp.get("title") or "") + " " + (opp.get("angle_summary") or "")).strip()


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
async def _ingest_worker(reel_id: str | None, footage: str | None,
                         source: str = "attached", folder: str | None = None,
                         max_files: int = 0, offset: int = 0) -> None:
    """Fire-and-forget worker. Pulls already-transcribed footage into transcript_clips from
    one of two SOURCES (the owner's toggle; attached stays the default so old behaviour is
    unchanged):
      • source="attached" (default) — (a) attached_footage_items.full_transcript from
        Supabase + (b) loose disk files IF CONTENT_FORGE_TRANSCRIPT_DIR is set. The ~12
        reel-attached clips. Honours reel_id / footage scoping.
      • source="library" — the WHOLE FootageBrain library via /api/files (paginated):
        every transcribed file's transcript, optionally scoped to one `folder` and capped
        at `max_files` (from `offset`). Drive link comes straight off the file row. Files
        already in transcript_clips are skipped (incremental re-run).
      • source="both" — attached THEN library.
    Never raises (a background-task failure must not crash the event loop). Dedup is on the
    (footage_file_id, start_time, end_time) upsert key."""
    run_id = str(uuid.uuid4())
    clips: list[dict[str, Any]] = []
    src = (source or "attached").strip().lower()
    if src not in ("attached", "library", "both"):
        src = "attached"
    do_attached = src in ("attached", "both")
    do_library = src in ("library", "both")
    try:
        async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as client:
            if not do_attached:
                rows = []
            else:
                # (a) Supabase source — full_transcript on attached_footage_items.
                rows = await _fetch_footage_transcripts(client, reel_id, footage)
            # Drive links live on the parent reel's detail.footageDrive, keyed by the
            # video-file id (attached_footage_items.footage_file_id), NOT the row PK.
            drive_maps = await _fetch_reel_drive_maps(
                client, [str(r.get("reel_id") or "") for r in rows])
            # Fallback: footage with no footageDrive entry → resolve Drive links from the
            # live FootageBrain /api/files/<id> (the same source the dashboard uses).
            missing_ffids = []
            for r in rows:
                rid0 = str(r.get("reel_id") or "")
                ffid0 = str(r.get("footage_file_id") or "")
                if ffid0 and not (drive_maps.get(rid0) or {}).get(ffid0):
                    missing_ffids.append(ffid0)
            fb_drive = await _resolve_drive_via_fb(client, missing_ffids)
            for row in rows:
                fid = str(row.get("id") or "")     # row PK → stays the clip's footage_file_id
                fname = row.get("filename")
                src_path = row.get("source_path")
                folder_lbl = _folder_label(src_path)   # NB: not `folder` — that's the lib-scope param
                # Resolve the Drive links for this footage via reel → footageDrive[video id].
                rid = str(row.get("reel_id") or "")
                ffid = str(row.get("footage_file_id") or "")
                dlink = (drive_maps.get(rid) or {}).get(ffid) or fb_drive.get(ffid) or {}
                drive_url = dlink.get("drive_url")
                drive_folder_url = dlink.get("drive_folder_url")
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
                        "folder": folder_lbl,
                        "source_path": src_path,
                        "drive_url": drive_url,
                        "drive_folder_url": drive_folder_url,
                    })

            # (b) Disk source — STRICT no-op unless CONTENT_FORGE_TRANSCRIPT_DIR is set.
            # Only on the attached/both path (it's the legacy attached-side disk fallback).
            if do_attached:
                disk = _transcript_dir()
                if disk:
                    clips.extend(_collect_disk_clips(disk, run_id))
                else:
                    log.info("content_forge: disk transcript branch skipped "
                             "(CONTENT_FORGE_TRANSCRIPT_DIR unset)")

            # Attached/disk clips collected above → upsert them as one batch.
            written = await _upsert_transcript_clips(client, clips)

            # (c) WHOLE-LIBRARY source — every transcribed file in /api/files, optionally
            # scoped to one folder + capped. Processed in file-chunks with an incremental
            # upsert per chunk so the clip-count poll rises during a long run.
            if do_library:
                written += await _ingest_library(
                    client, run_id, folder=folder, max_files=max_files, offset=offset)

            log.info("content_forge: ingest run=%s source=%s reel=%s footage=%s folder=%s "
                     "clips=%d upserted=%d",
                     run_id, src, reel_id, footage, folder or "-", len(clips), written)
    except Exception as e:  # noqa: BLE001 — never crash the worker
        log.exception("content_forge: ingest worker error: %s", e)


# Files processed per upsert chunk during a whole-library ingest. Each chunk fetches its
# transcripts concurrently (bounded), then upserts — so a long run makes visible progress
# (the clip-count poll rises) and memory stays bounded.
LIBRARY_FILE_CHUNK = 80
LIBRARY_FETCH_CONCURRENCY = 8


def _library_clips_for_file(f: dict[str, Any], segs: list[dict[str, Any]],
                            run_id: str) -> list[dict[str, Any]]:
    """Build transcript_clips rows for ONE library file from its FB transcript segments.
    footage_file_id = the real video-file id, so the Drive link comes straight off the file
    row and the modal's existing /api/files/<id> Drive resolver already covers it."""
    fid = str(f.get("id") or "")
    if not fid:
        return []
    abs_path = f.get("abs_path")
    folder_lbl = _folder_label(abs_path)
    fname = f.get("filename")
    drive_url = f.get("drive_url")
    drive_folder_url = f.get("drive_folder_url")
    out: list[dict[str, Any]] = []
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
        out.append({
            "footage_file_id": fid,
            "filename": fname,
            "start_time": st,
            "end_time": en,
            "transcript_text": txt,
            "keywords": _extract_keywords(txt),
            "topics": [],
            "language": "en",
            "confidence": None,
            "ingest_run_id": run_id,
            "folder": folder_lbl,
            "source_path": abs_path,
            "drive_url": drive_url,
            "drive_folder_url": drive_folder_url,
        })
    return out


async def _ingest_library(client: httpx.AsyncClient, run_id: str, *,
                          folder: str | None = None, max_files: int = 0,
                          offset: int = 0) -> int:
    """Ingest the WHOLE FootageBrain library (or one folder) into transcript_clips: list
    transcribed files via /api/files, skip ones already ingested, fetch each transcript
    (bounded concurrency), and upsert in file-chunks. Returns the count upserted. Files with
    no speech transcript (scenery/b-roll → []) contribute nothing. Best-effort; never raises."""
    files = await _fetch_library_files(client, folder=folder, max_files=max_files, offset=offset)
    if not files:
        log.info("content_forge: library ingest folder=%s — no transcribed files", folder or "-")
        return 0
    skip = await _existing_clip_file_ids(client)
    todo = [f for f in files if str(f.get("id") or "") not in skip]
    log.info("content_forge: library ingest folder=%s files=%d todo=%d (skipped %d already-ingested)",
             folder or "-", len(files), len(todo), len(files) - len(todo))
    sem = asyncio.Semaphore(LIBRARY_FETCH_CONCURRENCY)
    written = 0
    for i in range(0, len(todo), LIBRARY_FILE_CHUNK):
        group = todo[i:i + LIBRARY_FILE_CHUNK]

        async def _one(f: dict[str, Any]) -> list[dict[str, Any]]:
            async with sem:
                segs = await _fetch_fb_transcript(client, str(f.get("id") or ""))
            return _library_clips_for_file(f, segs, run_id) if segs else []

        results = await asyncio.gather(*[_one(f) for f in group])
        chunk_clips = [c for rows in results for c in rows]
        if chunk_clips:
            written += await _upsert_transcript_clips(client, chunk_clips)
    log.info("content_forge: library ingest folder=%s done — upserted=%d", folder or "-", written)
    return written


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
                    "folder": _folder_label(path),
                    "source_path": path,
                    "drive_url": None,
                    "drive_folder_url": None,
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


# Models the owner's UI toggle may request (validated before reaching _forge_llm).
# Both Vertex-prefixed and bare forms are accepted; the rungs normalize per-provider.
_ALLOWED_MODELS = {
    "google/gemini-2.5-flash",
    "google/gemini-2.0-flash-001",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
}


def _clean_model(v: Any) -> str:
    """Validate a requested model against the allowlist. Returns "" (→ env/default)
    for anything not explicitly allowed, so the toggle can never inject an arbitrary
    or unpriced model."""
    s = (str(v or "")).strip()
    return s if s in _ALLOWED_MODELS else ""


async def _write_last_discover(client: httpx.AsyncClient, stats: dict[str, Any]) -> None:
    """Persist the most recent discovery pass's clip/truncation stats into app_settings
    key 'content_forge_last_discover' (service role; no migration). Surfaced by /usage so
    the Monitor can show how much of the transcript corpus actually reached the LLM vs was
    truncated by the 24k-char prompt cap. Best-effort — never raises."""
    url = _supabase_url()
    if not url:
        return
    try:
        await client.post(
            f"{url}/rest/v1/app_settings?on_conflict=key",
            headers={**_supabase_headers("return=minimal"),
                     "Prefer": "resolution=merge-duplicates"},
            json={"key": "content_forge_last_discover", "value": stats,
                  "updated_at": _now_iso()},
        )
    except Exception as e:  # noqa: BLE001
        log.info("content_forge: last-discover write failed: %s", e)


async def _discover_worker(batch_id: str, tier: str, country: str | None,
                           only_new: bool = True, max_opportunities: int = 0,
                           model_override: str | None = None,
                           folder: str | None = None,
                           clips_per_pass: int = 0) -> None:
    """Fire-and-forget discovery: read transcript_clips, run ONE batched LLM pass via the
    provider seam, upsert content_opportunities tagged with discovery_run_id=batch_id.
    only_new=True (default) feeds ONLY clips not yet analyzed (token-saver); ?rescan=1 forces
    the full recent window. Never raises.

    folder set → scope the clip read to that footage folder and walk it sequentially;
    clips_per_pass caps the INPUT clips per pass (defaults to 20 when a folder is scoped),
    so each Discover click advances ~20 clips through the folder."""
    try:
        async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as client:
            # Credit guard — kill switch / daily limit. Skip the whole pass (no clip read,
            # no LLM, no marking) when blocked, so re-enabling re-analyzes the same footage.
            allowed, reason = await _forge_llm_gate(client)
            if not allowed:
                log.info("content_forge: discover batch=%s SKIPPED — %s", batch_id, reason)
                return
            # Input-clip budget: explicit clips_per_pass wins; else 20 when folder-scoped,
            # else the legacy full recent window.
            in_limit = clips_per_pass if clips_per_pass > 0 else (20 if folder else MAX_CLIPS_FOR_DISCOVERY)
            clips = await _read_clips_for_discovery(
                client, limit=in_limit, only_new=only_new, folder=folder)
            if not clips:
                log.info("content_forge: discover batch=%s folder=%s — no clips to analyze%s",
                         batch_id, folder or "-",
                         " (no new clips since last pass)" if only_new else "")
                return
            existing = await _read_existing_titles(client, country)  # cross-run dedup hint
            transcript = _clips_to_prompt(clips)
            # Truncation accounting: _clips_to_prompt fills up to DISCOVERY_TRANSCRIPT_CHARS
            # then stops, so only the first N clips actually reach the LLM. Each clip is one
            # newline-joined line (_clip_to_line strips inner newlines), so the line count IS
            # the sent-clip count. Anything beyond that is truncated this pass.
            clips_read = len(clips)
            clips_sent = (transcript.count("\n") + 1) if transcript.strip() else 0
            truncated = max(0, clips_read - clips_sent)
            trunc_pct = round(100.0 * truncated / clips_read, 1) if clips_read else 0.0
            avoid = ""
            if existing:
                avoid = ("ALREADY COVERED — do NOT repeat or rephrase these existing angles; "
                         "propose only NEW ones:\n"
                         + "\n".join(f"- {t}" for t in existing) + "\n\n")
            cap = ""
            if max_opportunities and max_opportunities > 0:
                cap = (f"OUTPUT LIMIT: return AT MOST {max_opportunities} opportunities — only "
                       "the strongest. Prefer fewer high-quality angles over padding to a "
                       "count. This overrides the 8-20 range above.\n\n")
            user = (
                f"{_DISCOVERY_GUIDANCE}\n\n"
                + cap
                + (f"TARGET COUNTRY/REGION: {country}\n\n" if country else "")
                + avoid
                + f"FOOTAGE TRANSCRIPT CLIPS:\n{transcript}"
            )
            messages = [
                {"role": "system", "content": _SYSTEM_BY_KIND["discovery"]},
                {"role": "user", "content": user},
            ]
            # Provider seam — free (Gemini) by default, pro (Haiku) if requested+keyed.
            # model_override = the owner's UI model toggle (validated; "" → env default).
            text, meta = _forge_llm(messages, tier=tier, kind="discovery",
                                    model_override=model_override)
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
                # De-dup while preserving first-seen order — the LLM sometimes cites the same
                # clip id for more than one beat/angle within a single opportunity, which would
                # otherwise show that clip twice in the frontend's "source clips" reference
                # list and waste a slot in _fetch_clips_for_opp's 20-clip cap on a repeat.
                src_ids = list(dict.fromkeys(
                    str(x) for x in (it.get("source_clip_ids") or [])
                    if isinstance(x, (str, int))))
                rows.append({
                    "title": title,
                    "angle_summary": it.get("angle_summary"),
                    "country": ctry,
                    "topics": [str(t) for t in (it.get("topics") or [])],
                    "keywords": [str(k) for k in (it.get("keywords") or [])],
                    "entities_mentioned": [str(e) for e in (it.get("entities_mentioned") or []) if str(e).strip()],
                    "source_clip_ids": src_ids,
                    "virality_tier": _norm_tier(it.get("virality_tier")),
                    "virality_score": _norm_score(it.get("virality_score")),
                    "status": "discovered",
                    "discovery_run_id": batch_id,
                })
            written = await _upsert_opportunities(client, rows)
            # Windowing: stamp ONLY the clips that actually reached the LLM (the first
            # clips_sent). Previously ALL read clips were marked even when the 24k-char cap
            # truncated the tail — silently dropping those clips from ever being analyzed.
            # Marking only the sent ones means a truncated tail is retried on the NEXT pass
            # (incremental), so truncation self-heals across passes instead of losing footage.
            await _mark_clips_discovered(
                client, [str(c.get("id")) for c in clips[:clips_sent] if c.get("id")])
            # Persist this pass's truncation accounting for the Monitor (best-effort).
            await _write_last_discover(client, {
                "batch_id": batch_id,
                "at": _now_iso(),
                "provider": meta.get("provider"),
                "model": meta.get("model"),
                "clips_read": clips_read,
                "clips_sent": clips_sent,
                "clips_truncated": truncated,
                "truncated_pct": trunc_pct,
                "opportunities": written,
                "max_opportunities": max_opportunities,
            })
            log.info("content_forge: discover batch=%s provider=%s model=%s tier=%s folder=%s "
                     "clips_read=%d clips_sent=%d truncated=%d(%.1f%%) items=%d upserted=%d "
                     "avoid=%d only_new=%s",
                     batch_id, meta.get("provider"), meta.get("model"), meta.get("tier_used"),
                     folder or "-", clips_read, clips_sent, truncated, trunc_pct, len(rows),
                     written, len(existing), only_new)
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
        last_discover = await _read_last_discover(client)
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
                         "prices": prices, "budget": budget_out,
                         "last_discover": last_discover, **rollup}, status_code=200)


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
    # source: attached (default) | library | both. folder/max_files/offset scope the
    # library pull. All accepted from query OR the JSON body (the Vercel proxy POSTs a body).
    source = (request.query_params.get("source") or "").strip().lower() or None
    folder = (request.query_params.get("folder") or "").strip() or None
    mf = request.query_params.get("max_files")
    ofs = request.query_params.get("offset")
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = None
    if isinstance(body, dict):
        if reel_id is None:
            reel_id = body.get("reel_id") or None
        if footage is None:
            footage = body.get("footage") or body.get("footage_file_id") or None
        if source is None:
            s = body.get("source")
            source = (str(s).strip().lower() or None) if s else None
        if folder is None:
            f = body.get("folder")
            folder = (str(f).strip() or None) if f else None
        if mf is None:
            mf = body.get("max_files")
        if ofs is None:
            ofs = body.get("offset")
    source = source or "attached"
    try:
        max_files = max(0, int(mf)) if mf is not None else 0
    except (TypeError, ValueError):
        max_files = 0
    try:
        offset = max(0, int(ofs)) if ofs is not None else 0
    except (TypeError, ValueError):
        offset = 0
    background_tasks.add_task(_ingest_worker, reel_id, footage, source, folder,
                             max_files, offset)
    return JSONResponse({"ok": True, "started": True, "source": source,
                         "reel_id": reel_id, "footage": footage, "folder": folder,
                         "max_files": max_files, "offset": offset}, status_code=200)


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


@router.get("/library-folders")
async def library_folders(request: Request):
    """GET /api/content-forge/library-folders?secret=… → {folders:[{folder,files,with_drive}]}.

    Secret-gated. Walks the FootageBrain /api/files catalog (same box) and returns the
    transcribed-file count per folder label (the same _folder_label used at ingest), biggest
    first. Powers the 'Mine Library' folder picker so the owner can mine one region at a time."""
    if not _check_secret(request):
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=401)
    async with httpx.AsyncClient(timeout=90) as client:
        files = await _fetch_library_files(client)
    counts: dict[str, dict[str, Any]] = {}
    for f in files:
        lbl = _folder_label(f.get("abs_path")) or "(unknown)"
        c = counts.setdefault(lbl, {"folder": lbl, "files": 0, "with_drive": 0})
        c["files"] += 1
        if f.get("drive_url"):
            c["with_drive"] += 1
    rows = sorted(counts.values(), key=lambda x: (-x["files"], x["folder"]))
    return JSONResponse({"ok": True, "folders": rows, "total_files": len(files)},
                        status_code=200)


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
    # max_opportunities (optional cost cap) — the dominant cost lever, since OUTPUT
    # tokens (the opportunities written) dominate a discovery pass's bill. The Vercel
    # proxy sends it in the JSON body; read it from query or body. Also backfill
    # `country` from the body (the tier-gated parse above is skipped when tier arrives
    # as a query param, so a body-only country would otherwise be lost). 0/absent =
    # the backend default (8-20). Clamped to 1-50.
    max_opps = 0
    mq = request.query_params.get("max_opportunities") or request.query_params.get("count")
    try:
        b2 = await request.json()
    except Exception:  # noqa: BLE001
        b2 = None
    if isinstance(b2, dict):
        if country is None:
            country = b2.get("country") or None
        if mq is None:
            mq = b2.get("max_opportunities")
    try:
        max_opps = max(0, min(50, int(mq))) if mq is not None else 0
    except (TypeError, ValueError):
        max_opps = 0
    # model toggle (validated to the allowlist; "" → env/default). Query or body.
    model = _clean_model(request.query_params.get("model")
                         or (b2.get("model") if isinstance(b2, dict) else None))
    # folder scope (e.g. "Japan") + clips_per_pass (input-clip budget). Query or body.
    folder = (request.query_params.get("folder")
              or (b2.get("folder") if isinstance(b2, dict) else None)) or None
    if folder:
        folder = str(folder).strip() or None
    cpp = (request.query_params.get("clips_per_pass")
           or request.query_params.get("max_input_clips")
           or (b2.get("clips_per_pass") if isinstance(b2, dict) else None)
           or (b2.get("max_input_clips") if isinstance(b2, dict) else None))
    try:
        clips_per_pass = max(0, min(400, int(cpp))) if cpp is not None else 0
    except (TypeError, ValueError):
        clips_per_pass = 0
    batch_id = str(uuid.uuid4())
    background_tasks.add_task(_discover_worker, batch_id, tier, country, only_new,
                             max_opps, model or None, folder, clips_per_pass)
    return JSONResponse({"ok": True, "batch_id": batch_id, "tier": tier,
                         "country": country, "only_new": only_new,
                         "max_opportunities": max_opps, "model": model,
                         "folder": folder, "clips_per_pass": clips_per_pass}, status_code=200)


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


# ── ENTITY BACKFILL ───────────────────────────────────────────────────────────────────
# One-off enrichment: the entities_mentioned column (migration 0111) is populated for NEW
# discovery passes, but the ~2,600 opportunities discovered before this feature carry an
# empty array. This backfill re-reads each old opportunity's stored context (title/angle/
# topics/keywords + its source-clip transcripts, which are all still on the row) and asks
# the LLM ONLY to extract entities — NOT to re-discover or re-write anything. So it keeps
# every existing hook/script/vet-state/favorite intact and just fills the one column, cheap
# (output is tiny). Idempotent: re-running only re-touches rows still empty.

ENTITY_BACKFILL_BATCH = 10          # opportunities per LLM call (small ctx each → batchable)
ENTITY_BACKFILL_CONCURRENCY = 4     # LLM calls in flight per wave (keep modest — thinking model)
ENTITY_BACKFILL_MAX = 6000          # safety cap on rows processed per job

_ENTITY_SYSTEM = (
    "You extract the concrete, NAMEABLE entities from short-form video content opportunities. "
    "For each item you are given its title, angle, topics/keywords and (when available) the raw "
    "footage transcript it was drawn from. Return ONLY the specific look-up-able nouns the "
    "material names or unambiguously implies — a place/landmark, a historical event, a person, "
    "a cultural practice/tradition, a specific record/number/date. These are what a viewer could "
    "type into a search engine. Do NOT return vague themes (e.g. 'food', 'danger', 'travel') — "
    "those are topics, not entities. If an item has no concrete entity, return an empty array for "
    "it rather than guessing. You reply with STRICT JSON ONLY: no prose, no code fences."
)


def _entity_backfill_prompt(items: list[dict[str, Any]]) -> str:
    """Build one batched extraction prompt for up to ENTITY_BACKFILL_BATCH opportunities.
    Each item is referenced by a batch-LOCAL index [i] (never its UUID — the model mangles
    long ids), mapped back to the real opportunity id on our side."""
    blocks: list[str] = []
    for it in items:
        clip_txt = ""
        clips = it.get("_clips") or []
        if clips:
            snips = []
            for c in clips[:3]:
                t = (c.get("transcript_text") or "").strip().replace("\n", " ")
                if t:
                    snips.append(t[:300])
            if snips:
                clip_txt = "\n  TRANSCRIPT: " + " … ".join(snips)
        blocks.append(
            f"[{it['_i']}] TITLE: {it.get('title') or ''}\n"
            f"  ANGLE: {it.get('angle_summary') or ''}\n"
            f"  TOPICS: {', '.join(it.get('topics') or [])}\n"
            f"  KEYWORDS: {', '.join(it.get('keywords') or [])}"
            f"{clip_txt}"
        )
    body = "\n\n".join(blocks)
    return (
        "Extract entities_mentioned for EACH opportunity below.\n\n"
        f"{body}\n\n"
        "Return a JSON ARRAY with one object per item, using the SAME index:\n"
        '[{"i": <index>, "entities": ["<specific named place/event/person/tradition/record>", ...]}, ...]\n'
        "Include every index exactly once (empty array if none). Output the JSON array ONLY — "
        "no prose, no code fences."
    )


async def _fetch_clips_for_ids(client: httpx.AsyncClient,
                               ids: list[str]) -> dict[str, dict[str, Any]]:
    """Fetch transcript_clips text for a batch of clip ids in ONE query (so a whole
    opportunity batch shares a single Supabase round-trip). Returns id → clip dict.
    Best-effort → {} on any error."""
    ids = [str(x) for x in ids if x]
    if not ids:
        return {}
    url = _supabase_url()
    if not url:
        return {}
    out: dict[str, dict[str, Any]] = {}
    # Chunk the IN() list so a big batch can't blow the URL length.
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        try:
            r = await client.get(
                f"{url}/rest/v1/transcript_clips"
                f"?select=id,transcript_text&id=in.({','.join(chunk)})&limit=200",
                headers=_supabase_headers(),
            )
            if r.status_code == 200 and isinstance(r.json(), list):
                for row in r.json():
                    if isinstance(row, dict) and row.get("id"):
                        out[str(row["id"])] = row
        except Exception as e:  # noqa: BLE001
            log.info("content_forge: backfill clip fetch failed: %s", e)
    return out


async def _read_opps_missing_entities(client: httpx.AsyncClient, *, offset: int,
                                      limit: int, only_missing: bool) -> list[dict[str, Any]]:
    """Page opportunities for the backfill, oldest first. only_missing=True selects rows whose
    entities_mentioned is still the empty array (the un-backfilled ones); False reprocesses
    all. Returns [] on any error (e.g. migration 0111 not applied → the filter/column 400s)."""
    url = _supabase_url()
    if not url:
        return []
    flt = "&entities_mentioned=eq.%7B%7D" if only_missing else ""   # %7B%7D = {}
    try:
        r = await client.get(
            f"{url}/rest/v1/content_opportunities"
            f"?select=id,title,angle_summary,topics,keywords,source_clip_ids"
            f"{flt}&order=created_at.asc&offset={offset}&limit={limit}",
            headers=_supabase_headers(),
        )
        if r.status_code == 200 and isinstance(r.json(), list):
            return r.json()
        log.warning("content_forge: backfill opp read HTTP %s: %s", r.status_code, r.text[:200])
    except Exception as e:  # noqa: BLE001
        log.warning("content_forge: backfill opp read failed: %s", e)
    return []


async def _count_opps_missing_entities(client: httpx.AsyncClient, only_missing: bool) -> int:
    url = _supabase_url()
    if not url:
        return 0
    flt = "&entities_mentioned=eq.%7B%7D" if only_missing else ""
    try:
        r = await client.get(
            f"{url}/rest/v1/content_opportunities?select=id{flt}&limit=1",
            headers={**_supabase_headers(), "Prefer": "count=exact"},
        )
        cr = r.headers.get("content-range") or ""
        if "/" in cr:
            tail = cr.split("/")[-1]
            return int(tail) if tail.isdigit() else 0
    except Exception as e:  # noqa: BLE001
        log.info("content_forge: backfill count failed: %s", e)
    return 0


async def _write_backfill_progress(client: httpx.AsyncClient, prog: dict[str, Any]) -> None:
    """Persist backfill progress into app_settings key 'content_forge_backfill' (service role;
    no migration). Polled by GET /backfill-status. Best-effort — never raises."""
    url = _supabase_url()
    if not url:
        return
    try:
        await client.post(
            f"{url}/rest/v1/app_settings?on_conflict=key",
            headers={**_supabase_headers("return=minimal"),
                     "Prefer": "resolution=merge-duplicates"},
            json={"key": "content_forge_backfill", "value": prog, "updated_at": _now_iso()},
        )
    except Exception as e:  # noqa: BLE001
        log.info("content_forge: backfill progress write failed: %s", e)


async def _read_backfill_progress(client: httpx.AsyncClient) -> dict[str, Any] | None:
    url = _supabase_url()
    if not url:
        return None
    try:
        r = await client.get(
            f"{url}/rest/v1/app_settings?key=eq.content_forge_backfill&select=value&limit=1",
            headers=_supabase_headers(),
        )
        if r.status_code == 200 and isinstance(r.json(), list) and r.json():
            v = r.json()[0].get("value")
            return v if isinstance(v, dict) else None
    except Exception as e:  # noqa: BLE001
        log.info("content_forge: backfill progress read failed: %s", e)
    return None


async def _extract_entities_batch(client: httpx.AsyncClient, items: list[dict[str, Any]], *,
                                  tier: str, model_override: str | None,
                                  job_id: str) -> int:
    """Run ONE LLM extraction over a batch of opportunities and patch each row's
    entities_mentioned. Returns the count patched. Never raises — a failed batch is skipped
    (those rows stay empty and are retried on a future run)."""
    if not items:
        return 0
    messages = [
        {"role": "system", "content": _ENTITY_SYSTEM},
        {"role": "user", "content": _entity_backfill_prompt(items)},
    ]
    try:
        text, meta = _forge_llm(messages, tier=tier, kind="discovery",
                                model_override=model_override or None)
        await _log_usage(client, kind="entity_backfill", meta=meta, batch_id=job_id)
        parsed = _extract_json(text)
    except Exception as e:  # noqa: BLE001
        log.warning("content_forge: entity backfill LLM failed: %s", e)
        return 0
    rows = parsed if isinstance(parsed, list) else parsed.get("items", [])
    by_index: dict[int, list[str]] = {}
    if isinstance(rows, list):
        for r in rows:
            if not isinstance(r, dict):
                continue
            try:
                idx = int(r.get("i"))
            except (TypeError, ValueError):
                continue
            ents = [str(e).strip() for e in (r.get("entities") or []) if str(e).strip()]
            by_index[idx] = ents
    patched = 0
    for it in items:
        ents = by_index.get(it["_i"])
        if ents is None:
            continue   # model dropped this index — leave empty, retried next run
        if await _patch_opportunity(client, it["id"], {"entities_mentioned": ents}):
            patched += 1
    return patched


async def _backfill_entities_worker(job_id: str, tier: str, model_override: str | None,
                                    only_missing: bool = True) -> None:
    """Fire-and-forget: page opportunities lacking entities, extract + patch in batched LLM
    calls (bounded concurrency), tracking progress in app_settings. Never raises. Stops early
    if the credit gate (kill switch / daily limit) closes mid-run."""
    import asyncio
    processed = 0
    patched = 0
    started = _now_iso()
    try:
        async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as client:
            total = await _count_opps_missing_entities(client, only_missing)
            await _write_backfill_progress(client, {
                "job_id": job_id, "running": True, "processed": 0, "patched": 0,
                "total": total, "started_at": started, "updated": started})
            offset = 0
            while processed < ENTITY_BACKFILL_MAX:
                allowed, reason = await _forge_llm_gate(client)
                if not allowed:
                    log.info("content_forge: backfill job=%s STOPPED — %s", job_id, reason)
                    await _write_backfill_progress(client, {
                        "job_id": job_id, "running": False, "processed": processed,
                        "patched": patched, "total": total, "started_at": started,
                        "finished_at": _now_iso(), "updated": _now_iso(),
                        "stopped_reason": reason})
                    return
                # Read a wave of opportunities (CONCURRENCY batches worth).
                wave_size = ENTITY_BACKFILL_BATCH * ENTITY_BACKFILL_CONCURRENCY
                # only_missing: patched rows drop out of the filter, so always read at offset 0.
                # not only_missing: rows stay, so advance offset to walk the whole table.
                read_offset = 0 if only_missing else offset
                opps = await _read_opps_missing_entities(
                    client, offset=read_offset, limit=wave_size, only_missing=only_missing)
                if not opps:
                    break
                # Prefetch every clip in the wave in one query, then attach to each opp.
                all_clip_ids: list[str] = []
                for o in opps:
                    all_clip_ids.extend(str(x) for x in (o.get("source_clip_ids") or [])[:3] if x)
                clip_map = await _fetch_clips_for_ids(client, all_clip_ids)
                # Split the wave into extraction batches, indexed locally.
                batches: list[list[dict[str, Any]]] = []
                for i in range(0, len(opps), ENTITY_BACKFILL_BATCH):
                    chunk = opps[i:i + ENTITY_BACKFILL_BATCH]
                    items = []
                    for j, o in enumerate(chunk):
                        clips = [clip_map[str(x)] for x in (o.get("source_clip_ids") or [])[:3]
                                 if str(x) in clip_map]
                        items.append({**o, "_i": j + 1, "_clips": clips})
                    batches.append(items)
                results = await asyncio.gather(
                    *[_extract_entities_batch(client, b, tier=tier,
                                              model_override=model_override, job_id=job_id)
                      for b in batches],
                    return_exceptions=True)
                for res in results:
                    if isinstance(res, int):
                        patched += res
                processed += len(opps)
                offset += len(opps)
                await _write_backfill_progress(client, {
                    "job_id": job_id, "running": True, "processed": processed,
                    "patched": patched, "total": total, "started_at": started,
                    "updated": _now_iso()})
                # only_missing with a full wave that patched nothing → avoid an infinite loop
                # (all remaining rows are genuinely entity-less and re-selected forever).
                if only_missing and not any(isinstance(r, int) and r > 0 for r in results):
                    break
            await _write_backfill_progress(client, {
                "job_id": job_id, "running": False, "processed": processed,
                "patched": patched, "total": total, "started_at": started,
                "finished_at": _now_iso(), "updated": _now_iso()})
            log.info("content_forge: backfill job=%s DONE processed=%d patched=%d total=%d",
                     job_id, processed, patched, total)
    except Exception as e:  # noqa: BLE001 — never crash the worker
        log.exception("content_forge: backfill worker error (job=%s): %s", job_id, e)
        try:
            async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as c2:
                await _write_backfill_progress(c2, {
                    "job_id": job_id, "running": False, "processed": processed,
                    "patched": patched, "started_at": started, "finished_at": _now_iso(),
                    "updated": _now_iso(), "error": str(e)[:200]})
        except Exception:  # noqa: BLE001
            pass


@router.post("/backfill-entities")
async def backfill_entities(request: Request, background_tasks: BackgroundTasks):
    """POST /api/content-forge/backfill-entities?secret=…[&tier=free|pro][&only_missing=1]

    Secret-gated. Fire-and-forget: enrich existing content_opportunities with
    entities_mentioned (migration 0111) WITHOUT re-discovering or altering hooks/scripts.
    Returns a job_id immediately; poll /backfill-status for progress. only_missing=1 (default)
    only touches rows whose entities array is still empty; only_missing=0 reprocesses all."""
    if not _check_secret(request):
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=401)
    tier = (request.query_params.get("tier") or "free").strip().lower()
    only_missing = (request.query_params.get("only_missing") or "1").strip().lower() not in ("0", "false", "no")
    model = _clean_model(request.query_params.get("model"))
    try:
        body = await request.json()
        if isinstance(body, dict):
            tier = (body.get("tier") or tier or "free").strip().lower()
            if "only_missing" in body:
                only_missing = str(body.get("only_missing")).strip().lower() not in ("0", "false", "no")
            model = model or _clean_model(body.get("model"))
    except Exception:  # noqa: BLE001
        pass
    if tier not in ("free", "pro"):
        tier = "free"
    # Guard against a second job while one is already running.
    async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as client:
        prog = await _read_backfill_progress(client)
        if prog and prog.get("running"):
            return JSONResponse({"ok": False, "error": "a backfill is already running",
                                 "progress": prog}, status_code=409)
    job_id = str(uuid.uuid4())
    background_tasks.add_task(_backfill_entities_worker, job_id, tier, model or None, only_missing)
    return JSONResponse({"ok": True, "job_id": job_id, "tier": tier,
                         "only_missing": only_missing}, status_code=200)


@router.get("/backfill-status")
async def backfill_status(request: Request):
    """GET /api/content-forge/backfill-status?secret=… → the entity backfill progress record
    ({running, processed, patched, total, ...}) or {progress:null} if none has ever run."""
    if not _check_secret(request):
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=401)
    async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as client:
        prog = await _read_backfill_progress(client)
    return JSONResponse({"ok": True, "progress": prog}, status_code=200)


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
    # model toggle (validated to the allowlist; "" → env/default). Query or body.
    # request.json() caches the body, so re-reading here is safe.
    try:
        _mb = await request.json()
    except Exception:  # noqa: BLE001
        _mb = None
    expand_model = _clean_model(request.query_params.get("model")
                                or (_mb.get("model") if isinstance(_mb, dict) else None))

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
        # _grounding_query prefers the discovery pass's entities_mentioned (specific named
        # place/event/person) over the generic title+angle, so the search actually surfaces
        # real facts/history instead of nothing.
        gq = _grounding_query(opp)
        fact_check = _tavily_ground(gq) if gq else {"skipped": True, "reason": "no_query"}
        grounding = _grounding_bullets(fact_check)

        messages = [
            {"role": "system", "content": _SYSTEM_BY_KIND["expansion"]},
            {"role": "user", "content": _expansion_user_prompt(opp, grounding)},
        ]
        try:
            text, meta = _forge_llm(messages, tier=tier, kind="expansion",
                                    model_override=expand_model or None)
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


# ── VO Script helpers ──────────────────────────────────────────────────────────────────

_SCRIPT_TEMPLATE_BEATS: dict[str, list[str]] = {
    "fact-reveal": ["Hook (scroll-stopper observation)", "Premise (the surprising fact)",
                    "Pivot ('That's not an accident' moment)", "Reveal (cause / story)",
                    "Payoff (reflection or takeaway)"],
    "hot-take":    ["Hook (controversial statement)", "Premise (what most people think)",
                    "Pivot ('But here's what they miss')", "Reveal (the counterargument)",
                    "Payoff (drive to comments)"],
    "question-hook": ["Hook (direct question to viewer)", "Premise (stakes of the question)",
                      "Tease (answer teaser)", "Reveal (the answer + context)",
                      "Payoff (viewer challenge / CTA)"],
    "story-first": ["Hook (start mid-story)", "Scene (scene-setting)",
                    "Turn (conflict / turn)", "Resolution", "Moral (takeaway)"],
}


async def _fetch_clips_for_opp(client: httpx.AsyncClient,
                                opp: dict[str, Any]) -> list[dict[str, Any]]:
    """Fetch transcript_clips rows for the opportunity's source_clip_ids.
    Returns a list of {id, filename, transcript_text} dicts, capped at 20 clips.
    Best-effort: returns [] on any error."""
    clip_ids = [str(x) for x in (opp.get("source_clip_ids") or []) if x]
    if not clip_ids:
        return []
    url = _supabase_url()
    if not url:
        return []
    id_list = ",".join(clip_ids[:20])
    try:
        r = await client.get(
            f"{url}/rest/v1/transcript_clips"
            f"?select=id,filename,transcript_text,drive_url,drive_folder_url"
            f"&id=in.({id_list})&limit=20",
            headers=_supabase_headers(),
        )
        if r.status_code == 200:
            data = r.json()
            return data if isinstance(data, list) else []
        log.warning("content_forge: clip fetch HTTP %s", r.status_code)
    except Exception as e:  # noqa: BLE001
        log.warning("content_forge: clip fetch failed: %s", e)
    return []


def _script_user_prompt(
    opp: dict[str, Any],
    clips: list[dict[str, Any]],
    template: str,
    grounding_mode: str,
    tone: str,
    grounding_bullets: list[str],
) -> str:
    beats = _SCRIPT_TEMPLATE_BEATS.get(template, _SCRIPT_TEMPLATE_BEATS["fact-reveal"])
    beats_block = "\n".join(f"  {i+1}. {b}" for i, b in enumerate(beats))

    clips_block = ""
    if clips:
        lines = []
        for c in clips[:20]:
            fn = (c.get("filename") or "").strip() or "clip"
            txt = (c.get("transcript_text") or "").strip()[:600]
            if txt:
                lines.append(f"[clip:{c.get('id','')}] ({fn})\n{txt}")
        clips_block = "\n\n---\n".join(lines)

    grounding_note = ""
    if grounding_mode == "footage":
        grounding_note = (
            "GROUNDING RULE: use ONLY the footage clips above — no external facts. "
            "Each beat MUST cite the clip it draws from using [clip:<id>]."
        )
    elif grounding_mode == "model":
        grounding_note = (
            "You may enrich the script with relevant real-world facts from your training "
            "knowledge. Do NOT hallucinate specific dates, names, or statistics."
        )
    elif grounding_mode == "web":
        if grounding_bullets:
            bullet = "\n".join(f"- {g}" for g in grounding_bullets[:6])
            grounding_note = (
                f"WEB-GROUNDED FACTS (verified; use only if relevant; do NOT contradict):\n{bullet}\n"
                "Weave in at least one concrete fact above (a name, date, number) so the script "
                "reads as specific rather than generic."
            )
        else:
            grounding_note = "No web grounding available — use model knowledge as fallback."

    tone_map = {
        "neutral": "calm, informative, measured",
        "punchy":  "short punchy sentences, energetic, fast-paced",
        "educational": "clear, explanatory, teacher-voice",
        "provocative": "edgy, opinionated, debate-sparking",
    }
    tone_desc = tone_map.get(tone, "neutral")

    citations_instruction = ""
    if grounding_mode == "footage":
        citations_instruction = (
            '\n  "citations": [\n'
            '    {"beat": "<beat name>", "clip_id": "<id>", "quote": "<verbatim phrase>"}\n'
            '  ]'
        )

    entities = [str(e) for e in (opp.get("entities_mentioned") or []) if str(e).strip()]
    return (
        f'OPPORTUNITY\nTitle: {opp.get("title","")}\n'
        f'Angle: {opp.get("angle_summary","")}\n'
        f'Entities mentioned in footage: {", ".join(entities) if entities else "(none captured)"}\n\n'
        f'NARRATIVE TEMPLATE: {template}\n'
        f'Beat structure:\n{beats_block}\n\n'
        f'TONE: {tone_desc}\n\n'
        f'TARGET LENGTH: 150-200 words (45-60 seconds)\n\n'
        f'{grounding_note}\n\n'
        f'FOOTAGE CLIPS:\n{clips_block or "(no clips available — use model knowledge)"}\n\n'
        f'Respond with STRICT JSON:\n'
        f'{{\n'
        f'  "script": "<full VO script — 150-200 words, {len(beats)} beats structured per template>",\n'
        f'  "word_count": <integer>,{citations_instruction}\n'
        f'}}\n'
        f'No prose outside the JSON. No code fences.'
    )


@router.post("/script")
async def script(request: Request):
    """POST /api/content-forge/script?secret=…

    Secret-gated. SYNCHRONOUS. Generates a full ~150-200 word voice-over script for one
    opportunity using a chosen narrative template (fact-reveal / hot-take / question-hook /
    story-first) and grounding mode (footage / model / web). Writes script_json JSONB onto
    the content_opportunities row and returns it. Mirrors the /expand pattern."""
    if not _check_secret(request):
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=401)

    opp_id: str | None = None
    template = "fact-reveal"
    grounding_mode = "footage"
    tone = "neutral"
    model_override: str | None = None
    tier = "free"

    # Accept params from query string or JSON body.
    opp_id = request.query_params.get("opportunity_id") or request.query_params.get("id")
    try:
        body = await request.json()
        if isinstance(body, dict):
            opp_id = opp_id or body.get("opportunity_id") or body.get("id")
            template = (body.get("template") or template).strip().lower()
            grounding_mode = (body.get("grounding_mode") or grounding_mode).strip().lower()
            tone = (body.get("tone") or tone).strip().lower()
            tier = (body.get("tier") or tier).strip().lower()
            model_override = _clean_model(body.get("model"))
    except Exception:  # noqa: BLE001
        pass

    if template not in _SCRIPT_TEMPLATE_BEATS:
        template = "fact-reveal"
    if grounding_mode not in ("footage", "model", "web"):
        grounding_mode = "footage"
    if tone not in ("neutral", "punchy", "educational", "provocative"):
        tone = "neutral"
    if tier not in ("free", "pro"):
        tier = "free"

    if not opp_id:
        return JSONResponse({"ok": False, "error": "opportunity_id required"}, status_code=400)

    async with httpx.AsyncClient(timeout=SUPABASE_TIMEOUT) as client:
        opp = await _read_opportunity(client, opp_id)
        if not opp:
            return JSONResponse({"ok": False, "error": "opportunity not found"}, status_code=404)

        # Credit guard — same kill switch / daily limit as expand.
        allowed, reason = await _forge_llm_gate(client)
        if not allowed:
            return JSONResponse({"ok": False, "blocked": True, "error": reason,
                                 "opportunity_id": opp_id}, status_code=200)

        # Fetch source clips for footage context.
        clips = await _fetch_clips_for_opp(client, opp)

        # Web grounding (only when requested; degrades gracefully on no-key/quota).
        grounding_bullets: list[str] = []
        fact_check: dict[str, Any] = {"skipped": True, "reason": "not_requested"}
        if grounding_mode == "web":
            gq = _grounding_query(opp)
            if gq:
                fact_check = _tavily_ground(gq)
                grounding_bullets = _grounding_bullets(fact_check)

        messages = [
            {"role": "system", "content": _SYSTEM_BY_KIND["script"]},
            {"role": "user", "content": _script_user_prompt(
                opp, clips, template, grounding_mode, tone, grounding_bullets)},
        ]
        try:
            text, meta = _forge_llm(messages, tier=tier, kind="expansion",
                                    model_override=model_override or None)
            await _log_usage(client, kind="expansion", meta=meta, batch_id=None)
            parsed = _extract_json(text)
        except Exception as e:  # noqa: BLE001
            log.warning("content_forge: script LLM failed for %s: %s", opp_id, e)
            return JSONResponse({"ok": False, "error": f"script generation failed: {e}"},
                                status_code=502)

        if not isinstance(parsed, dict):
            parsed = {}

        script_text = (parsed.get("script") or "").strip()
        raw_wc = parsed.get("word_count")
        word_count = int(raw_wc) if isinstance(raw_wc, int) or (isinstance(raw_wc, str) and raw_wc.isdigit()) \
            else len(script_text.split())
        citations = parsed.get("citations") or None

        script_json_row: dict[str, Any] = {
            "text": script_text,
            "template": template,
            "grounding_mode": grounding_mode,
            "tone": tone,
            "word_count": word_count,
            "generated_at": _now_iso(),
            "provider": meta.get("provider"),
            "model": meta.get("model"),
        }
        if citations:
            script_json_row["citations"] = citations
        if grounding_mode == "web" and not fact_check.get("skipped"):
            script_json_row["grounding_sources"] = [
                {"title": s.get("title"), "url": s.get("url")}
                for s in (fact_check.get("sources") or []) if s.get("url")
            ][:6]

        persisted = await _patch_opportunity(client, opp_id, {"script_json": script_json_row})
        if not persisted:
            # Most likely migration 0107 (script_json column) not applied yet. Still return
            # the generated script to the UI — just flag it as unsaved rather than claiming
            # success and having it silently vanish on reload.
            log.warning("content_forge: script generated for %s but not persisted "
                        "(migration 0107 applied?)", opp_id)

    return JSONResponse({
        "ok": True,
        "persisted": persisted,
        "opportunity_id": opp_id,
        "script_json": script_json_row,
        "provider": meta.get("provider"),
        "fell_back": meta.get("fell_back", False),
    }, status_code=200)


# ══════════════════════════════════════════════════════════════════════════════════════
# ── FONT ID — identify the font in a reel frame (owner-only "Fonts" tab) ───────────────
# ══════════════════════════════════════════════════════════════════════════════════════
# Phase 1 = Gemini VISION only. Reuses the exact seams the rest of Content Forge uses:
#   · vision rides a dedicated ladder (_forge_vision): free AI-Studio Gemini → paid Vertex
#     Gemini (the two OpenAI-compatible rungs that accept image parts; the Anthropic /
#     OpenRouter text rungs are intentionally skipped — free models reject images).
#   · the SAME kill switch / daily cap (_forge_llm_gate) blocks a call before any spend.
#   · the SAME telemetry (_log_usage) logs kind="font_id" so the Monitor "API Budgets &
#     Limits" card shows font-ID spend by provider alongside discovery/expansion.
# Phase 2 (not here) swaps in a self-hosted ONNX classifier + optional WhatFontIs behind a
# FONT_ID_MODE flag — same route, zero frontend change.

# Vision models — 2.5-flash discriminates typography meaningfully (2.0-flash is near-chance
# on fonts per the FRB benchmark); both env-overridable if a project lacks 2.5 access.
FONT_VISION_MODEL_GEMINI = (os.environ.get("FONT_ID_MODEL_GEMINI") or "").strip() or "gemini-2.5-flash"
FONT_VISION_MODEL_VERTEX = (os.environ.get("FONT_ID_MODEL_VERTEX") or "").strip() or "google/gemini-2.5-flash"

# ~30 most-common short-form caption fonts — primes the prompt toward REAL, resolvable
# (mostly Google Fonts) families instead of open-ended guessing, and powers the honest
# "likely a CapCut/InShot preset" fallback. Shared source of truth with the frontend copy.
CAPCUT_PRESET_FONTS = [
    "Montserrat", "Poppins", "Bebas Neue", "Anton", "Oswald", "Roboto", "Roboto Condensed",
    "Archivo", "Archivo Black", "Inter", "League Spartan", "Impact", "Barlow", "Barlow Condensed",
    "Teko", "Rubik", "Nunito", "Nunito Sans", "Work Sans", "DM Sans", "Manrope", "Bebas Kai",
    "Kanit", "Fjalla One", "Sora", "Space Grotesk", "Libre Franklin", "Prompt", "Outfit",
    "Alfa Slab One", "Passion One", "Titan One",
]

_FONT_ID_SYSTEM = (
    "You are a professional typographer and font-identification expert. You examine an image "
    "of on-screen text (usually a caption overlay from a short-form social video) and identify "
    "the most likely typeface. You reason from letterform anatomy — stroke contrast, terminals, "
    "x-height, aperture, weight, whether it is a system/UI font vs. a display face — NOT from the "
    "words. Many social captions use bundled EDITOR PRESET fonts (CapCut / InShot / Instagram) or "
    "hand-set title cards that are NOT installable typefaces; when that is likely, say so honestly "
    "rather than forcing a match. You reply with STRICT JSON ONLY: no prose, no code fences."
)


def _font_id_user_prompt() -> str:
    """The strict-JSON font-ID instruction. Primes with the common-caption shortlist so the
    model biases toward real, resolvable families and Google-Fonts naming."""
    common = ", ".join(CAPCUT_PRESET_FONTS)
    return (
        "Identify the font of the most prominent text in this image. Return the TOP 3 most likely "
        "typefaces, best first.\n\n"
        f"Common short-form caption fonts (bias toward these when the letterforms fit, and prefer "
        f"exact Google Fonts family names): {common}.\n\n"
        "Reply with STRICT JSON in EXACTLY this shape:\n"
        "{\n"
        '  "matches": [\n'
        '    {"family": "<font family name>", "confidence": <0.0-1.0>, '
        '"rationale": "<one sentence on the letterform evidence>", '
        '"is_probably_preset": <true|false>, "google_fonts_guess": "<closest Google Fonts family, or empty>"}\n'
        "  ],\n"
        '  "notes": "<optional: e.g. \'text too small/blurry to be certain\' or \'likely a CapCut bundled preset\'>"\n'
        "}\n"
        "Rules: confidence is your honest calibrated probability (be conservative on blurry/short "
        "samples). Set is_probably_preset=true when it reads as a bundled editor caption style rather "
        "than a standard installable font. Always fill google_fonts_guess with the closest free "
        "look-alike even when unsure. Return 1-3 matches (fewer only if the text is unreadable)."
    )


def _forge_vision(image_data_url: str, *, model_override: str | None = None
                  ) -> tuple[str, dict[str, Any]]:
    """VISION PROVIDER SEAM — the only place the font-ID vision provider is chosen.

    A trimmed multimodal cousin of _forge_llm: free AI-Studio Gemini → paid Vertex Gemini
    (both OpenAI-compatible, both accept `image_url` content parts). Each rung is skipped
    when its keys are absent; a RuntimeError escalates. Returns (text, meta) in the SAME meta
    shape _forge_llm returns (provider/model/tier_used/usage/fell_back/cost_usd) so _log_usage
    works unchanged. Raises RuntimeError only when every configured vision rung is exhausted."""
    ov = (model_override or "").strip() or None
    messages = [
        {"role": "system", "content": _FONT_ID_SYSTEM},
        {"role": "user", "content": [
            {"type": "text", "text": _font_id_user_prompt()},
            {"type": "image_url", "image_url": {"url": image_data_url}},
        ]},
    ]

    def _rung_gemini_api():
        # Same card-taint kill lever as the text ladder.
        if (os.environ.get("CONTENT_FORGE_DISABLE_GEMINI_API") or "").strip().lower() in ("1", "true", "yes"):
            return None
        if not _gemini_key():
            return None
        model = (ov.split("/")[-1] if ov else None) or FONT_VISION_MODEL_GEMINI
        text, used, usage = _call_gemini_api(messages, model=model)
        return text, {"provider": "gemini_api", "model": used, "tier_used": "gemini", "usage": usage}

    def _rung_vertex_gemini():
        if not (_gcp_project() and _gcp_sa_json()):
            return None
        model = ov or FONT_VISION_MODEL_VERTEX
        text, used, usage = _call_vertex_gemini(messages, model=model)
        return text, {"provider": "vertex_gemini", "model": used, "tier_used": "vertex", "usage": usage}

    fell_back = False
    last_err = "no vision provider configured"
    for rung in (_rung_gemini_api, _rung_vertex_gemini):
        try:
            result = rung()
        except RuntimeError as e:
            last_err = str(e)
            log.info("content_forge: font-id vision rung failed (%s) — escalating", last_err)
            fell_back = True
            continue
        if result is None:
            continue
        text, meta = result
        meta["fell_back"] = fell_back
        meta.setdefault("usage", {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0})
        meta["cost_usd"] = _estimate_cost(meta.get("provider", ""), meta.get("model", ""), meta["usage"])
        return text, meta
    raise RuntimeError(f"all vision providers exhausted: {last_err}")


def _parse_font_matches(text: str) -> tuple[list[dict[str, Any]], str]:
    """Coerce the model's JSON into (matches[≤3], notes). Tolerant: accepts either the
    documented object or a bare list; clamps confidence to 0-1; drops nameless rows."""
    parsed = _extract_json(text)
    notes = ""
    raw: Any
    if isinstance(parsed, dict):
        raw = parsed.get("matches") or []
        notes = str(parsed.get("notes") or "")
    elif isinstance(parsed, list):
        raw = parsed
    else:
        raw = []
    out: list[dict[str, Any]] = []
    for m in raw[:3] if isinstance(raw, list) else []:
        if not isinstance(m, dict):
            continue
        family = str(m.get("family") or "").strip()
        if not family:
            continue
        try:
            conf = float(m.get("confidence"))
        except (TypeError, ValueError):
            conf = 0.0
        conf = max(0.0, min(1.0, conf))
        out.append({
            "family": family,
            "confidence": round(conf, 3),
            "rationale": str(m.get("rationale") or "").strip(),
            "is_probably_preset": bool(m.get("is_probably_preset")),
            "google_fonts_guess": str(m.get("google_fonts_guess") or "").strip(),
        })
    return out, notes


async def _identify_font(client: httpx.AsyncClient, image_data_url: str,
                         *, model_override: str | None = None) -> JSONResponse:
    """Shared tail for both font routes: gate → vision → parse → log usage → respond.
    Returns a ready JSONResponse (200 ok / 200 blocked / 502 on LLM failure)."""
    allowed, reason = await _forge_llm_gate(client)
    if not allowed:
        return JSONResponse({"ok": False, "blocked": True, "error": reason}, status_code=200)
    try:
        text, meta = _forge_vision(image_data_url, model_override=model_override)
        await _log_usage(client, kind="font_id", meta=meta, batch_id=None)
    except Exception as e:  # noqa: BLE001
        log.warning("content_forge: font-id vision failed: %s", e)
        return JSONResponse({"ok": False, "error": f"font identification failed: {e}"},
                            status_code=502)
    matches, notes = _parse_font_matches(text)
    return JSONResponse({
        "ok": True,
        "matches": matches,
        "notes": notes,
        "provider": meta.get("provider"),
        "model": meta.get("model"),
        "fell_back": meta.get("fell_back", False),
    }, status_code=200)


# yt-dlp/ffmpeg frame extraction for the reel-URL path (toolchain already on the box —
# mirrors reel_deconstruct's mp4 pull + ffmpeg keyframe grab, but downscaled + base64'd so
# a handful of frames ride the vision call cheaply). Self-contained on purpose (no coupling
# to the full deconstruct pipeline / its scene-detect deps).
FONT_FRAME_TIMEOUT = 90       # per-subprocess seconds (download / ffmpeg)
FONT_FRAME_COUNT = 5          # evenly-spaced frames sampled from the reel
FONT_MAX_VIDEO_BYTES = "60M"  # cap the reel download


def _extract_reel_frames(url: str) -> list[str]:
    """Download a reel (yt-dlp mp4, capped) and return up to FONT_FRAME_COUNT evenly-spaced,
    downscaled frames as base64 PNG data-URLs. Best-effort; raises RuntimeError with a short
    reason on download failure so the route can surface it. Cleans up its temp dir."""
    import subprocess, tempfile, base64, glob as _glob, shutil as _shutil
    work = tempfile.mkdtemp(prefix="fontid_")
    try:
        out_tpl = os.path.join(work, "base.%(ext)s")
        cmd = ["yt-dlp", "-f", "mp4/best[ext=mp4]", "--no-playlist",
               "--max-filesize", FONT_MAX_VIDEO_BYTES, "--merge-output-format", "mp4",
               "-o", out_tpl, url]
        # Inject cookies for login-walled reels when configured (same env yt-dlp uses elsewhere).
        cookies = (os.environ.get("YTDLP_COOKIES") or os.environ.get("IG_COOKIES_FILE") or "").strip()
        if cookies and os.path.exists(cookies):
            cmd = ["yt-dlp", "--cookies", cookies] + cmd[1:]
        cp = subprocess.run(cmd, capture_output=True, text=True, timeout=FONT_FRAME_TIMEOUT, check=False)
        vids = _glob.glob(os.path.join(work, "base.*"))
        if cp.returncode != 0 or not vids:
            tail = ((cp.stderr or "") + (cp.stdout or "")).strip()[-200:]
            raise RuntimeError(f"reel download failed: {tail}")
        video = vids[0]
        # Sample FONT_FRAME_COUNT frames across the clip via ffmpeg fps filter, scaled to 640w.
        # thumbnail-style even sampling: -vf fps=count/duration is fiddly; use select of N frames.
        pat = os.path.join(work, "f_%02d.png")
        vf = f"thumbnail,scale=640:-1"
        # Grab one representative frame per 1/N of the video using the thumbnail filter batched.
        subprocess.run(["ffmpeg", "-y", "-i", video, "-vf",
                        f"select='not(mod(n\\,15))',scale=640:-1", "-vsync", "vfr",
                        "-frames:v", str(FONT_FRAME_COUNT * 4), pat],
                       capture_output=True, text=True, timeout=FONT_FRAME_TIMEOUT, check=False)
        files = sorted(_glob.glob(os.path.join(work, "f_*.png")))
        if not files:
            # Fallback: single midpoint frame.
            single = os.path.join(work, "f_00.png")
            subprocess.run(["ffmpeg", "-y", "-i", video, "-vf", vf, "-frames:v", "1", single],
                           capture_output=True, text=True, timeout=FONT_FRAME_TIMEOUT, check=False)
            files = sorted(_glob.glob(os.path.join(work, "f_*.png")))
        # Evenly subsample down to FONT_FRAME_COUNT.
        if len(files) > FONT_FRAME_COUNT:
            step = len(files) / FONT_FRAME_COUNT
            files = [files[int(i * step)] for i in range(FONT_FRAME_COUNT)]
        frames: list[str] = []
        for f in files:
            try:
                with open(f, "rb") as fh:
                    b64 = base64.b64encode(fh.read()).decode("ascii")
                frames.append(f"data:image/png;base64,{b64}")
            except Exception:  # noqa: BLE001
                continue
        if not frames:
            raise RuntimeError("no frames could be extracted from the reel")
        return frames
    finally:
        try:
            import shutil as _sh
            _sh.rmtree(work, ignore_errors=True)
        except Exception:  # noqa: BLE001
            pass


@router.post("/font-id")
async def font_id(request: Request):
    """POST /api/content-forge/font-id?secret=…  body {image: "data:image/...;base64,..."}

    Secret-gated. SYNCHRONOUS. Identifies the font of the most prominent text in a supplied
    screenshot via the vision ladder (free Gemini → paid Vertex). Returns top-3 matches with
    confidence + download hints. Gated by the same kill switch / daily cap as discover/expand;
    logs kind="font_id" usage to the Monitor budgets card."""
    if not _check_secret(request):
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=401)
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = None
    if not isinstance(body, dict):
        body = {}
    image = (body.get("image") or "").strip()
    model_override = _clean_model(body.get("model"))
    if not image.startswith("data:image/"):
        return JSONResponse({"ok": False, "error": "image (data URL) required"}, status_code=400)

    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        return await _identify_font(client, image, model_override=model_override or None)


@router.post("/font-id-keyframes")
async def font_id_keyframes(request: Request):
    """POST /api/content-forge/font-id-keyframes?secret=…  body {url: "<reel url>"}

    Secret-gated. Downloads the reel, samples a few frames, asks the vision model to identify
    the font of the most prominent caption across them (one call, frames passed together), and
    returns top-3 matches + the chosen frame preview. Same gate + telemetry as /font-id."""
    if not _check_secret(request):
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=401)
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = None
    if not isinstance(body, dict):
        body = {}
    url = (body.get("url") or "").strip()
    model_override = _clean_model(body.get("model"))
    if not url.startswith("http"):
        return JSONResponse({"ok": False, "error": "url required"}, status_code=400)

    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        # Gate BEFORE the (heavier) download so a killed switch spends nothing.
        allowed, reason = await _forge_llm_gate(client)
        if not allowed:
            return JSONResponse({"ok": False, "blocked": True, "error": reason}, status_code=200)
        try:
            frames = _extract_reel_frames(url)
        except Exception as e:  # noqa: BLE001
            log.warning("content_forge: font-id keyframe extraction failed: %s", e)
            return JSONResponse({"ok": False, "error": f"couldn't extract frames: {e}"},
                                status_code=502)

        # Multi-frame vision: send all sampled frames in one call; the model picks the frame
        # with the clearest caption and identifies its font.
        messages = [
            {"role": "system", "content": _FONT_ID_SYSTEM},
            {"role": "user", "content": (
                [{"type": "text", "text":
                  "These are frames sampled from one short-form video. Find the frame with the "
                  "clearest, most prominent on-screen caption text and identify ITS font. "
                  + _font_id_user_prompt()}]
                + [{"type": "image_url", "image_url": {"url": f}} for f in frames]
            )},
        ]
        try:
            # Reuse the vision rungs directly with the multi-image message.
            ov = (model_override or "").strip() or None
            fell_back = False
            text = None
            meta: dict[str, Any] = {}
            last_err = "no vision provider configured"
            for provider in ("gemini_api", "vertex_gemini"):
                try:
                    if provider == "gemini_api":
                        if (os.environ.get("CONTENT_FORGE_DISABLE_GEMINI_API") or "").strip().lower() in ("1", "true", "yes"):
                            continue
                        if not _gemini_key():
                            continue
                        model = (ov.split("/")[-1] if ov else None) or FONT_VISION_MODEL_GEMINI
                        text, used, usage = _call_gemini_api(messages, model=model)
                        meta = {"provider": "gemini_api", "model": used, "tier_used": "gemini", "usage": usage}
                    else:
                        if not (_gcp_project() and _gcp_sa_json()):
                            continue
                        model = ov or FONT_VISION_MODEL_VERTEX
                        text, used, usage = _call_vertex_gemini(messages, model=model)
                        meta = {"provider": "vertex_gemini", "model": used, "tier_used": "vertex", "usage": usage}
                    break
                except RuntimeError as e:
                    last_err = str(e)
                    fell_back = True
                    text = None
                    continue
            if text is None:
                raise RuntimeError(f"all vision providers exhausted: {last_err}")
            meta["fell_back"] = fell_back
            meta.setdefault("usage", {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0})
            meta["cost_usd"] = _estimate_cost(meta.get("provider", ""), meta.get("model", ""), meta["usage"])
            await _log_usage(client, kind="font_id", meta=meta, batch_id=None)
        except Exception as e:  # noqa: BLE001
            log.warning("content_forge: font-id keyframe vision failed: %s", e)
            return JSONResponse({"ok": False, "error": f"font identification failed: {e}"},
                                status_code=502)

    matches, notes = _parse_font_matches(text)
    return JSONResponse({
        "ok": True,
        "matches": matches,
        "notes": notes,
        "frame_count": len(frames),
        "provider": meta.get("provider"),
        "model": meta.get("model"),
        "fell_back": meta.get("fell_back", False),
    }, status_code=200)
