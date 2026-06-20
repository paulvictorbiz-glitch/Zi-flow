"""
Longform YouTube → Reel DNA narrative deconstruction worker — DEPLOY TARGET: Hetzner backend.

This file does NOT run in the Vercel app. Copy it to the Hetzner backend at:
    /srv/footagebrain/footage-brain-test/backend/app/api/reel_deconstruct.py
then register the router (see REEL-DECONSTRUCT-DEPLOY.md) and rebuild the container.

WHAT IT DOES
------------
Phase 0 of the flagship "Reel DNA" reverse-engineering process: take a longform
YouTube capture (a reel_dna row with format='long', media_status='pending_analyze')
and AUTO-DECONSTRUCT it into the `narrative` jsonb the dashboard's Story panel reads
— zero manual steps after the owner clicks "Analyze".

Pipeline for one claimed row (writes `progress` jsonb at each step):
  1. acquiring    — yt-dlp pulls bestaudio→mp3 + native English auto-captions (.vtt)
  2. transcribing — parse the .vtt into timestamped segments; if no captions exist,
                    fall back to faster-whisper (small, int8) on the audio.
  3. analyzing    — ONE free-LLM narrative pass over the timestamped transcript,
                    producing the C2 `narrative` shape exactly (hook/arc/open_loops/
                    emotion_curve/rehooks/retention_flags/payoff/cta/scorecard/verdict).
  4. done         — service-role UPDATE: narrative=…, media_status='analyzed',
                    analyzed_at=now(). Frontend re-renders live via Supabase realtime.

CONCURRENCY=1: the claim is a STATUS-GUARDED PATCH
(set media_status='analyzing' where id=? and media_status='pending_analyze') with
PostgREST returning the representation — so two concurrent runs can never grab the
same row (the loser's PATCH matches 0 rows). Mirrors the optimistic-guard idea from
the plan; no advisory lock needed.

PROVIDER SEAM: `run_narrative(segments, *, model) -> dict` is the ONLY place the LLM
provider is chosen. It uses a FREE OpenRouter model today; Claude/Anthropic can be
swapped in later by changing the `model` id + adding a branch — nothing else changes.
This mirrors the project's `_insights-core.js` / `tag-footage.js` not-Anthropic-gated
convention.

NEVER touches the human `timeline` column — `narrative` is machine-only (per the
migration 0045 rule). This worker only writes:
    media_status, progress, narrative, media_error, analyzed_at, source_url_resolved.

All secrets are read from environment variables — NOTHING is hardcoded:
    REEL_DECONSTRUCT_SECRET     Shared secret gating the endpoint (?secret=…)
    SUPABASE_URL                Supabase project URL
    SUPABASE_SERVICE_ROLE_KEY   Service role key (server-side only)
    OPENROUTER_API_KEY          Free-tier OpenRouter key for the narrative pass
    DATA_DIR                    (optional) base temp dir; default /tmp/reel_dna
    REEL_DECONSTRUCT_MODEL      (optional) override the OpenRouter model id
    FEATURE_REEL_DECONSTRUCT    "1" to enable the pipeline (default OFF — ack & no-op)

NOTE on the router pattern: this matches the conventional FastAPI APIRouter style,
identical to ig_webhook.py. The router declares prefix="/reel", assuming "/api" is
added at include_router(prefix="/api"). The full live path must resolve to:
    POST /api/reel/deconstruct
    GET  /api/reel/status     (readiness smoke test)
If facebook.py / ig_webhook.py bake "/api" into their own prefix instead, change the
prefix below to "/api/reel". `httpx` is already a backend dep.

CALIBRATION / FIRST TEST (the important bit)
--------------------------------------------
With FEATURE_REEL_DECONSTRUCT=1, flip ONE real capture to format='long' +
media_status='pending_analyze' (the app's Analyze button does this), then:
    curl -s -X POST "https://api.footagebrain.com/api/reel/deconstruct?secret=$REEL_DECONSTRUCT_SECRET&wait=1"
(?wait=1 runs the pipeline synchronously for the first test; without it the endpoint
claims the row and finishes in the BACKGROUND, returning immediately — the cron path.)
Watch `docker compose logs backend | grep reel_deconstruct` — you'll see the row
progress acquiring→transcribing→analyzing→done, and the spreadsheet/Story panel
update live. A bad/unavailable URL lands the row in media_status='analyze_failed'
with the stderr tail in media_error (the queue is never poisoned). System deps
(yt-dlp, ffmpeg, faster-whisper) MUST be installed in the container first — see the
DEPLOY.md.
"""

from __future__ import annotations

import os
import re
import csv
import hmac
import time
import json
import shutil
import hashlib
import asyncio
import logging
import datetime as _dt
import statistics
import subprocess
from typing import Any

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, FileResponse

log = logging.getLogger("reel_deconstruct")

# If facebook.py / ig_webhook.py use a different prefix convention, mirror it here so
# the live path is /api/reel/deconstruct.
router = APIRouter(prefix="/reel", tags=["reel"])

# OpenRouter (OpenAI-compatible) — the FREE narrative provider for now. The seam in
# run_narrative() is the ONLY place this is referenced, so swapping to Anthropic later
# is a localized change.
OPENROUTER_BASE = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "google/gemini-2.0-flash-exp:free"

# yt-dlp / whisper guardrails
ACQUIRE_TIMEOUT = 600        # seconds — audio + caption download
WHISPER_TIMEOUT = 1200       # seconds — local transcription fallback
LLM_TIMEOUT = 120            # seconds — single narrative pass
ERR_TAIL = 1500              # max chars of stderr/exc we persist to media_error

# ── Phase 1 (Reel MVP) guardrails ─────────────────────────────────────────────
# The reel branch (format='short') downloads the actual VIDEO (media-retained, NOT
# purged), extracts audio, detects cuts (PySceneDetect ContentDetector), grabs one
# keyframe per shot, and computes pacing metrics — then serves the retained layers
# via a short-lived HMAC-signed GET. No LLM call; pure ffmpeg/scenedetect.
REEL_VIDEO_TIMEOUT = 900     # seconds — full-video download (capped 100M)
FFMPEG_TIMEOUT = 600         # seconds — audio extract / keyframe grab
SCENE_TIMEOUT = 1200         # seconds — PySceneDetect pass on the video
SCENE_THRESHOLD = 27.0       # PySceneDetect ContentDetector default
MAX_VIDEO_BYTES = "100M"     # yt-dlp --max-filesize for reels
SIGN_TTL = 300               # seconds — signed-download URL lifetime (matches H1)
# Bare-segment guard: id/file must each match this (rejects /, \\, "..", query chars)
# — mirrors the API minter's SEG regex (H2) so a forged path can never traverse.
_SEG_RE = re.compile(r"^[A-Za-z0-9._-]+$")


# ── env helpers ──────────────────────────────────────────────────────────────
def _secret() -> str | None:
    return os.environ.get("REEL_DECONSTRUCT_SECRET")


def _supabase_url() -> str | None:
    return os.environ.get("SUPABASE_URL")


def _openrouter_key() -> str | None:
    return os.environ.get("OPENROUTER_API_KEY")


def _model() -> str:
    return (os.environ.get("REEL_DECONSTRUCT_MODEL") or "").strip() or DEFAULT_MODEL


def _data_dir() -> str:
    return os.environ.get("DATA_DIR", "/tmp/reel_dna")


def _reels_dir() -> str:
    """Base dir for MEDIA-RETAINED reel layers (NOT purged after analyze). The signed
    /fb/reels/<id>/<file> GET streams files from <reels_dir>/<id>/<file>. Defaults to
    <DATA_DIR>/reels (so the deploy only needs to volume-persist DATA_DIR); REELS_DIR
    overrides it. asset_manifest base_dir is the logical 'reels/<id>' (no /fb/ prefix)."""
    override = (os.environ.get("REELS_DIR") or "").strip()
    return override or os.path.join(_data_dir(), "reels")


def _download_signing_secret() -> str | None:
    """Shared HMAC secret for signed reel downloads — MUST byte-match the Vercel
    minter's FB_DOWNLOAD_SIGNING_SECRET (api/ai/suggest.js ?action=sign-download)."""
    return os.environ.get("FB_DOWNLOAD_SIGNING_SECRET")


def _feature_on() -> bool:
    # Default OFF — matches ig_webhook's FEATURE flag convention (ack & no-op when off).
    return os.environ.get("FEATURE_REEL_DECONSTRUCT", "").strip() in ("1", "true", "TRUE", "yes")


def _ytdlp_cookies() -> str:
    """Path to a Netscape-format cookies.txt for yt-dlp, or "" if unset/missing. Lets the
    worker auto-acquire bot-gated YouTube + login-walled Instagram sources (else manual
    upload is the only path). Env name matches DEPLOY-PHASE1.md (YTDLP_COOKIES);
    IG_COOKIES_FILE accepted as an alias. Returns "" if the file doesn't exist so a stale
    path silently degrades to the upload CTA rather than passing a bad --cookies arg."""
    p = (os.environ.get("YTDLP_COOKIES") or os.environ.get("IG_COOKIES_FILE") or "").strip()
    return p if (p and os.path.exists(p)) else ""


def _with_cookies(cmd: list[str]) -> list[str]:
    """Prepend `--cookies <file>` to a yt-dlp argv (right after "yt-dlp") when a cookies
    file is configured. Single source of truth for BOTH the longform and reel acquire
    paths so they can never drift. No-op when no cookies are set."""
    c = _ytdlp_cookies()
    if c:
        cmd[1:1] = ["--cookies", c]
    return cmd


def _supabase_headers(prefer: str = "return=minimal") -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def _now_iso() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).isoformat()


# ── service-role Supabase REST helpers (same idiom as ig_webhook._insert_reel_dna:
#    raw httpx, apikey + Bearer service-role headers, PostgREST on reel_dna) ──────
async def _claim_one(client: httpx.AsyncClient, row_id: str | None) -> dict | None:
    """Atomically claim ONE longform row to analyze.

    STATUS-GUARDED PATCH (concurrency=1): we PATCH media_status 'pending_analyze' →
    'analyzing' with the OLD status pinned in the filter. PostgREST applies the
    UPDATE row-by-row under Postgres row locks, so two concurrent workers racing the
    same row → exactly one matches `media_status=eq.pending_analyze` and gets the
    representation back; the loser's filter matches 0 rows (empty list). This is the
    same optimistic-guard the plan specifies — no advisory lock required.

    If `row_id` is given we target ONLY that id (still status-guarded). Returns the
    claimed row dict, or None when there is nothing to claim.

    FORMAT-AGNOSTIC CLAIM (H6): we select purely by media_status='pending_analyze' —
    NOT a format filter — so BOTH longform ('long') and reel ('short') rows drain off
    the SAME sentinel/queue. The branch (narrative vs reel-deconstruct) is chosen AFTER
    the claim by reading row['format'] in _process_row. This means the reel path reuses
    the existing analyzeReelDna sentinel with NO new claim value / NO store change."""
    url = _supabase_url()
    if not url:
        log.warning("reel_deconstruct: SUPABASE_URL unset — cannot claim")
        return None
    # Filter: media_status=pending_analyze (AND id if specified). format-agnostic.
    # order=created_at.asc → deterministic oldest-first draining so overlapping cron
    # runs tend to target the same head row (one wins the guard, the other gets 0 rows
    # and returns claimed:0) rather than fanning out unpredictably.
    q = "media_status=eq.pending_analyze&order=created_at.asc&limit=1"
    if row_id:
        q += f"&id=eq.{row_id}"
    patch = {"media_status": "analyzing",
             "progress": {"step": "acquiring", "pct": 1,
                          "msg": "claimed", "updated_at": _now_iso()}}
    try:
        r = await client.patch(
            f"{url}/rest/v1/reel_dna?{q}",
            headers=_supabase_headers("return=representation"),
            json=patch,
        )
        if r.status_code in (200, 201):
            data = r.json()
            if isinstance(data, list) and data:
                return data[0]
            return None
        log.warning("reel_deconstruct: claim HTTP %s: %s", r.status_code, r.text[:300])
    except Exception as e:  # noqa: BLE001
        log.warning("reel_deconstruct: claim failed: %s", e)
    return None


async def _patch_row(client: httpx.AsyncClient, row_id: str, fields: dict[str, Any]) -> bool:
    """Service-role PATCH of selected columns on one reel_dna row by id. Used for
    progress + terminal-status writes. NEVER includes the human `timeline` column."""
    url = _supabase_url()
    if not url:
        return False
    # Hard guard: this worker must never write the human timeline column.
    fields.pop("timeline", None)
    try:
        r = await client.patch(
            f"{url}/rest/v1/reel_dna?id=eq.{row_id}",
            headers=_supabase_headers("return=minimal"),
            json=fields,
        )
        if r.status_code in (200, 204):
            return True
        log.warning("reel_deconstruct: patch HTTP %s: %s", r.status_code, r.text[:300])
    except Exception as e:  # noqa: BLE001
        log.warning("reel_deconstruct: patch failed: %s", e)
    return False


async def _write_progress(client: httpx.AsyncClient, row_id: str,
                          step: str, pct: int, msg: str) -> None:
    """Write the C3 progress jsonb shape: {step, pct, msg, updated_at}. Best-effort —
    a progress write failure must not abort the pipeline."""
    await _patch_row(client, row_id, {
        "progress": {"step": step, "pct": pct, "msg": msg, "updated_at": _now_iso()},
    })


# ── yt-dlp / caption / whisper helpers (subprocess; stderr captured) ───────────
def _run(cmd: list[str], *, timeout: int) -> subprocess.CompletedProcess:
    """Run a subprocess capturing stdout+stderr as text. Raises on timeout (handled
    by the caller, which converts it into media_error)."""
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _stderr_tail(cp: subprocess.CompletedProcess) -> str:
    out = ((cp.stderr or "") + "\n" + (cp.stdout or "")).strip()
    return out[-ERR_TAIL:]


def _acquire(url: str, work: str) -> None:
    """Download bestaudio→mp3 and English auto-captions (.vtt) into `work`. Raises
    RuntimeError with the stderr tail if the audio pull fails (captions are
    best-effort — their absence triggers the whisper fallback in _transcribe)."""
    os.makedirs(work, exist_ok=True)
    # 1. audio: bestaudio → mp3 (small, fast). -o template stays inside the temp dir.
    #    _with_cookies injects --cookies when configured (YouTube is bot-gated without it).
    audio = _run(
        _with_cookies(
            ["yt-dlp", "-f", "bestaudio", "-x", "--audio-format", "mp3",
             "--no-playlist", "-o", os.path.join(work, "audio.%(ext)s"), url]),
        timeout=ACQUIRE_TIMEOUT,
    )
    if audio.returncode != 0:
        raise RuntimeError("yt-dlp audio failed: " + _stderr_tail(audio))
    # 2. captions: native English auto-subs as .vtt, no media download (FREE path).
    #    Non-fatal: a video with no captions just falls back to whisper.
    caps = _run(
        _with_cookies(
            ["yt-dlp", "--write-auto-sub", "--sub-lang", "en",
             "--skip-download", "--sub-format", "vtt",
             "--no-playlist", "-o", os.path.join(work, "caps"), url]),
        timeout=ACQUIRE_TIMEOUT,
    )
    if caps.returncode != 0:
        log.info("reel_deconstruct: caption fetch non-zero (will try whisper): %s",
                 _stderr_tail(caps)[:300])


_VTT_TS = re.compile(
    r"(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})")
_VTT_TAG = re.compile(r"<[^>]+>")            # inline <c> / <00:00:00.000> timing tags
_HTML_AMP = {"&amp;": "&", "&lt;": "<", "&gt;": ">", "&#39;": "'", "&quot;": '"'}


def _find_vtt(work: str) -> str | None:
    for fn in sorted(os.listdir(work)) if os.path.isdir(work) else []:
        if fn.endswith(".vtt"):
            return os.path.join(work, fn)
    return None


def _clean_caption_line(line: str) -> str:
    line = _VTT_TAG.sub("", line)
    for k, v in _HTML_AMP.items():
        line = line.replace(k, v)
    return line.strip()


def _parse_vtt(path: str) -> list[dict[str, Any]]:
    """Parse a WebVTT caption file into timestamped segments [{ts, text}] where ts is
    the cue START in integer seconds. De-dupes the rolling-duplicate lines YouTube
    auto-captions emit. Returns [] on any parse trouble (→ whisper fallback)."""
    segments: list[dict[str, Any]] = []
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            raw = fh.read()
    except Exception as e:  # noqa: BLE001
        log.warning("reel_deconstruct: vtt read failed: %s", e)
        return []
    blocks = re.split(r"\n\s*\n", raw)
    last_text = ""
    for block in blocks:
        lines = [ln for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        ts = None
        text_parts: list[str] = []
        for ln in lines:
            m = _VTT_TS.search(ln)
            if m:
                h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
                ts = h * 3600 + mi * 60 + s
                continue
            if ln.strip().upper() in ("WEBVTT",) or ln.strip().startswith(("NOTE", "Kind:", "Language:")):
                continue
            cleaned = _clean_caption_line(ln)
            if cleaned:
                text_parts.append(cleaned)
        if ts is None or not text_parts:
            continue
        text = " ".join(text_parts).strip()
        if not text or text == last_text:
            continue
        last_text = text
        segments.append({"ts": ts, "text": text})
    return segments


def _whisper_transcribe(audio_path: str) -> list[dict[str, Any]]:
    """Fallback transcription via faster-whisper (small, int8). Imported lazily so the
    module loads even where the package isn't installed (caption-only deployments).
    Returns timestamped segments [{ts, text}]; raises RuntimeError on hard failure."""
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"faster-whisper not installed: {e}")
    try:
        model = WhisperModel("small", device="cpu", compute_type="int8")
        seg_iter, _info = model.transcribe(audio_path, language="en", vad_filter=True)
        out: list[dict[str, Any]] = []
        for s in seg_iter:
            txt = (s.text or "").strip()
            if txt:
                out.append({"ts": int(s.start or 0), "text": txt})
        return out
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"whisper transcribe failed: {e}")


def _transcribe(work: str) -> tuple[list[dict[str, Any]], str]:
    """Return (segments, source) where source is 'yt_captions' or 'whisper'. Prefers
    native captions; falls back to whisper on the audio.mp3 when none are present.
    Raises RuntimeError if neither path yields any usable text."""
    vtt = _find_vtt(work)
    if vtt:
        segs = _parse_vtt(vtt)
        if segs:
            return segs, "yt_captions"
        log.info("reel_deconstruct: vtt present but empty/unparsed — trying whisper")
    audio = os.path.join(work, "audio.mp3")
    if not os.path.exists(audio):
        # yt-dlp may have produced a differently-named extracted file; find any audio.
        cand = [os.path.join(work, f) for f in (os.listdir(work) if os.path.isdir(work) else [])
                if f.startswith("audio.")]
        audio = cand[0] if cand else audio
    if not os.path.exists(audio):
        raise RuntimeError("no captions and no audio file to transcribe")
    segs = _whisper_transcribe(audio)
    if not segs:
        raise RuntimeError("transcription produced no text")
    return segs, "whisper"


# ── PROVIDER SEAM ─────────────────────────────────────────────────────────────
# run_narrative() is the ONLY place the LLM provider is chosen. Today it calls a FREE
# OpenRouter model (OpenAI-compatible chat completions). To swap to Claude later:
# branch on `model` (e.g. model.startswith("claude") / "anthropic/") and call the
# Anthropic Messages API instead — NOTHING else in this file changes. Mirrors the
# project's _insights-core.js / tag-footage.js not-Anthropic-gated convention.

_NARRATIVE_SYSTEM = (
    "You are a retention-obsessed short-form/longform story analyst for a YouTube "
    "creator. You deconstruct a video's narrative engineering from its timestamped "
    "transcript. You reply with STRICT JSON ONLY — no prose, no code fences."
)

# The exact C2 shape the UI reads. Every field is optional/nullable; emit what the
# transcript supports and OMIT (or null) what it doesn't — never invent timestamps
# beyond the transcript's range.
_NARRATIVE_SCHEMA_HINT = """Return a JSON object with EXACTLY these keys (all optional, omit if unknown):
{
  "hook":      { "ts": [startSec, endSec], "type": "stakes|curiosity|question|shock|promise|other", "strength": 0.0-1.0, "quote": "verbatim opening line" },
  "arc":       [ { "beat": "setup|rising|turn|climax|resolution", "startTs": sec, "endTs": sec, "summary": "..." } ],
  "open_loops":[ { "seededTs": sec, "paidTs": sec_or_null, "paid": true|false, "desc": "the question/tension opened" } ],
  "emotion_curve": [ { "ts": sec, "label": "curiosity|tension|relief|awe|...", "valence": -1.0..1.0 } ],
  "rehooks":   [ secondsInt, ... ],   // timestamps where a new hook/pattern-interrupt re-grabs attention
  "retention_flags": [ { "startTs": sec, "endTs": sec, "reason": "why viewers likely drop here" } ],
  "payoff":    { "ts": sec, "strength": 0.0-1.0 },
  "cta":       { "ts": sec_or_null, "present": true|false },
  "scorecard": { "hook": 0-100, "arc": 0-100, "emotion": 0-100, "pacing": 0-100, "payoff": 0-100, "cta": 0-100, "overall": 0-100 },
  "verdict":   "one or two sentence plain-English summary of the story engineering"
}
Use integer seconds for all timestamps (hook.ts is a [start,end] pair). Base every
value on the transcript only. Output JSON object ONLY."""

_C2_KEYS = (
    "hook", "arc", "open_loops", "emotion_curve", "rehooks",
    "retention_flags", "payoff", "cta", "scorecard", "verdict",
)


def _segments_to_prompt(segments: list[dict[str, Any]], *, max_chars: int = 24000) -> str:
    """Flatten timestamped segments into a compact `[mm:ss] text` transcript for the
    LLM, truncating from the front-end of the tail if it would blow the budget (keep
    the opening — hook analysis needs it — and as much body as fits)."""
    lines: list[str] = []
    for s in segments:
        ts = int(s.get("ts") or 0)
        mm, ss = divmod(ts, 60)
        txt = (s.get("text") or "").strip()
        if txt:
            lines.append(f"[{mm:02d}:{ss:02d}] {txt}")
    joined = "\n".join(lines)
    if len(joined) <= max_chars:
        return joined
    # Keep the first 60% (hook + setup) and the last 40% (payoff/CTA), drop the mushy
    # middle with a marker — preserves the structurally-important ends.
    head = int(max_chars * 0.6)
    tail = max_chars - head
    return joined[:head] + "\n…[transcript trimmed]…\n" + joined[-tail:]


def _extract_json_object(text: str) -> dict[str, Any]:
    """Robustly pull a JSON OBJECT out of an LLM reply: strip code fences, tolerate
    surrounding prose, and fall back to brace-matching the first balanced {...} block.
    Raises ValueError if nothing parseable is found."""
    if not text:
        raise ValueError("empty LLM response")
    s = text.strip()
    # Strip ```json … ``` / ``` … ``` fences.
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", s, re.DOTALL)
    if fence:
        s = fence.group(1).strip()
    # Fast path.
    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    # Brace-match the first balanced top-level object (ignoring braces inside strings).
    start = s.find("{")
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
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    candidate = s[start:i + 1]
                    try:
                        obj = json.loads(candidate)
                        if isinstance(obj, dict):
                            return obj
                    except Exception:
                        break  # try next "{" start
        start = s.find("{", start + 1)
    raise ValueError("no JSON object found in LLM response")


def _coerce_c2(obj: dict[str, Any]) -> dict[str, Any]:
    """Keep ONLY the C2 keys the model returned (drop any extras the model hallucinated),
    so the persisted narrative never carries unknown fields. Missing keys are simply
    absent — the UI degrades gracefully on partial output (per C2)."""
    return {k: obj[k] for k in _C2_KEYS if k in obj and obj[k] is not None}


def run_narrative(segments: list[dict[str, Any]], *, model: str) -> dict[str, Any]:
    """PROVIDER SEAM — the ONLY place the narrative LLM provider is selected.

    Takes timestamped transcript segments [{ts, text}], runs ONE narrative pass, and
    returns a dict matching the C2 `narrative` contract (hook/arc/open_loops/
    emotion_curve/rehooks/retention_flags/payoff/cta/scorecard/verdict). Robustly
    extracts JSON (strips code fences, tolerates prose). Does NOT stamp
    transcript_source/model/computed_at — the caller does that so this stays a pure
    transform.

    Today: FREE OpenRouter (OpenAI-compatible). To use Claude later, branch on `model`
    here and call the Anthropic Messages API — no other code changes.
    """
    key = _openrouter_key()
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY unset — cannot run narrative pass")
    transcript = _segments_to_prompt(segments)
    user_msg = (
        f"{_NARRATIVE_SCHEMA_HINT}\n\n"
        f"TIMESTAMPED TRANSCRIPT:\n{transcript}"
    )

    # ── Provider branch ────────────────────────────────────────────────────────
    # if model.startswith(("claude", "anthropic/")):
    #     return _run_narrative_anthropic(user_msg, model=model)   # future seam
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _NARRATIVE_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.3,
        "max_tokens": 2400,
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        # OpenRouter etiquette headers (optional, identify the app).
        "HTTP-Referer": "https://footagebrain.com",
        "X-Title": "FootageBrain Reel DNA",
    }
    with httpx.Client(timeout=LLM_TIMEOUT) as client:
        r = client.post(f"{OPENROUTER_BASE}/chat/completions",
                        headers=headers, json=payload)
    if r.status_code != 200:
        raise RuntimeError(f"OpenRouter HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    try:
        content = data["choices"][0]["message"]["content"]
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"OpenRouter malformed response: {e}: {json.dumps(data)[:300]}")
    obj = _extract_json_object(content)
    return _coerce_c2(obj)


# ── dispatcher: route a claimed row to the longform OR reel pipeline ───────────
async def _process_row(client: httpx.AsyncClient, row: dict[str, Any]) -> bool:
    """Route ONE already-CLAIMED (media_status='analyzing') row to the right pipeline
    by its `format` (H6): 'long' → narrative deconstruction (Phase 0); anything else
    (default 'short') → reel layer/pacing deconstruction (Phase 1). Both pipelines
    never raise and always land the row in a terminal status."""
    fmt = (row.get("format") or "short").strip().lower()
    if fmt == "long":
        return await _process_longform(client, row)
    return await _process_reel(client, row)


# ── Phase 0 pipeline (longform narrative) for ONE claimed row ──────────────────
async def _process_longform(client: httpx.AsyncClient, row: dict[str, Any]) -> bool:
    """Run the full longform NARRATIVE pipeline for one already-CLAIMED
    (media_status='analyzing') row. Writes progress at each step and ALWAYS lands the
    row in a terminal status (analyzed | analyze_failed). Returns True on success.
    Never raises — a per-row failure must not poison the queue."""
    row_id = row.get("id")
    src = row.get("reel_url") or row.get("source_url_resolved")
    work = os.path.join(_data_dir(), str(row_id))

    try:
        if not src:
            raise RuntimeError("row has no reel_url to analyze")

        # 1. acquiring ──────────────────────────────────────────────────────────
        _ck = " (cookies)" if _ytdlp_cookies() else ""
        await _write_progress(client, row_id, "acquiring", 10, "downloading audio + captions" + _ck)
        # Persist the resolved URL we acted on (canonical-ish; full normalize is C1's job).
        await _patch_row(client, row_id, {"source_url_resolved": src})
        await asyncio.to_thread(_acquire, src, work)

        # 2. transcribing ───────────────────────────────────────────────────────
        await _write_progress(client, row_id, "transcribing", 45, "building transcript")
        segments, source = await asyncio.to_thread(_transcribe, work)
        await _write_progress(client, row_id, "transcribing", 60,
                              f"{len(segments)} segments ({source})")

        # 3. analyzing ──────────────────────────────────────────────────────────
        await _write_progress(client, row_id, "analyzing", 75, "LLM narrative pass")
        model = _model()
        narrative = await asyncio.to_thread(run_narrative, segments, model=model)
        # Stamp provenance fields (kept OUTSIDE run_narrative so the seam stays pure).
        narrative["transcript_source"] = source
        narrative["model"] = model
        narrative["computed_at"] = _now_iso()

        # 4. done ────────────────────────────────────────────────────────────────
        ok = await _patch_row(client, row_id, {
            "narrative": narrative,
            "media_status": "analyzed",
            "analyzed_at": _now_iso(),
            "media_error": None,           # clear any prior failure on success
            "progress": {"step": "done", "pct": 100, "msg": "analyzed",
                         "updated_at": _now_iso()},
        })
        if not ok:
            log.warning("reel_deconstruct: final PATCH failed for %s", row_id)
        log.info("reel_deconstruct: analyzed %s (source=%s, model=%s)", row_id, source, model)
        return True

    except subprocess.TimeoutExpired as e:  # noqa: BLE001
        await _fail_row(client, row_id, f"timeout: {e}")
        return False
    except Exception as e:  # noqa: BLE001 — never crash the worker; never poison the queue
        log.exception("reel_deconstruct: pipeline error for %s: %s", row_id, e)
        await _fail_row(client, row_id, str(e))
        return False
    finally:
        # Always clean up the per-id temp dir.
        try:
            shutil.rmtree(work, ignore_errors=True)
        except Exception:  # noqa: BLE001
            pass


# ── Phase 1 (Reel MVP) helpers — media-retained layer extraction + pacing ──────
# Unlike the longform path (which discards its /tmp work dir), the reel path KEEPS
# everything under <REELS_DIR>/<id>/ so the signed-download GET can stream the layers
# back to the dashboard. All file names in asset_manifest are BARE (H3).
class _AcquireError(RuntimeError):
    """Raised when the reel VIDEO cannot be acquired (→ media_status='acquire_failed').
    Distinct from generic post-acquire failures (→ 'analyze_failed') so the UI can show
    an 'upload the file' CTA, per the manual-upload-first design."""


def _reel_work_dir(row_id: str) -> str:
    d = os.path.join(_reels_dir(), str(row_id))
    os.makedirs(d, exist_ok=True)
    return d


def _find_uploaded_video(work: str) -> str | None:
    """MANUAL-UPLOAD-FIRST: if a base video was pre-placed in the reel dir (manual upload
    or a prior run), reuse it — never re-download. Accepts the canonical base.mp4 or any
    common video container already present."""
    canonical = os.path.join(work, "base.mp4")
    if os.path.exists(canonical) and os.path.getsize(canonical) > 0:
        return canonical
    if os.path.isdir(work):
        for fn in sorted(os.listdir(work)):
            low = fn.lower()
            if low.startswith("base.") and low.rsplit(".", 1)[-1] in ("mp4", "mov", "webm", "mkv", "m4v"):
                p = os.path.join(work, fn)
                if os.path.getsize(p) > 0:
                    return p
    return None


def _acquire_reel_video(src: str | None, work: str) -> str:
    """Acquire the reel video into <work>/base.mp4 and return its path.

    MANUAL-UPLOAD-FIRST: a pre-placed base video wins (no network). Otherwise yt-dlp
    pulls an mp4 (`-f "mp4/best[ext=mp4]"`), capped at 100M, optionally with IG cookies
    (IG_COOKIES_FILE) for private/login-walled reels. Raises _AcquireError (→
    acquire_failed) on any failure so the UI surfaces an upload CTA."""
    pre = _find_uploaded_video(work)
    if pre:
        if pre != os.path.join(work, "base.mp4"):
            try:
                shutil.move(pre, os.path.join(work, "base.mp4"))
            except Exception:  # noqa: BLE001
                return pre
        return os.path.join(work, "base.mp4")

    if not src:
        raise _AcquireError("no uploaded video and no reel_url to download")

    # IG/login-walled reels (and bot-gated YouTube) may need a cookies file; _with_cookies
    # injects --cookies when YTDLP_COOKIES/IG_COOKIES_FILE points at an existing file.
    cmd = _with_cookies(
        ["yt-dlp", "-f", "mp4/best[ext=mp4]", "--no-playlist",
         "--max-filesize", MAX_VIDEO_BYTES,
         "--merge-output-format", "mp4",
         "-o", os.path.join(work, "base.%(ext)s"), src])
    cp = _run(cmd, timeout=REEL_VIDEO_TIMEOUT)
    if cp.returncode != 0:
        hint = "" if _ytdlp_cookies() else " (no YTDLP_COOKIES configured — bot-gated/login-walled sources need one)"
        raise _AcquireError("yt-dlp video failed: " + _stderr_tail(cp) + hint)
    out = _find_uploaded_video(work)
    if not out:
        raise _AcquireError("yt-dlp produced no base video file")
    return out


def _ffprobe_duration(path: str) -> float:
    """Best-effort container duration in seconds via ffprobe; 0.0 if unavailable."""
    try:
        cp = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                   "-of", "default=noprint_wrappers=1:nokey=1", path], timeout=60)
        if cp.returncode == 0:
            return float((cp.stdout or "0").strip() or 0.0)
    except Exception:  # noqa: BLE001
        pass
    return 0.0


def _extract_reel_audio(video: str, work: str) -> str | None:
    """Extract an mp3 audio layer (H3 audio.file). Reels can be SILENT — a non-zero exit
    or a missing/empty output returns None (asset_manifest.audio = null), never fatal."""
    out = os.path.join(work, "audio.mp3")
    cp = _run(["ffmpeg", "-y", "-i", video, "-vn",
               "-acodec", "libmp3lame", "-q:a", "2", out], timeout=FFMPEG_TIMEOUT)
    if cp.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 0:
        return out
    log.info("reel_deconstruct: audio extract empty/failed (reel may be silent): %s",
             _stderr_tail(cp)[:200])
    try:
        if os.path.exists(out):
            os.remove(out)
    except Exception:  # noqa: BLE001
        pass
    return None


def _detect_scenes(video: str, work: str) -> list[dict[str, float]]:
    """Detect shots with PySceneDetect ContentDetector and write a scenes.csv
    ([{start,end} seconds]). Imported lazily so the module loads where the package is
    absent. <1 detected scene → synthesize ONE shot [0, total_duration] (H4)."""
    total = _ffprobe_duration(video)
    shots: list[dict[str, float]] = []
    try:
        from scenedetect import detect, ContentDetector  # type: ignore
        scene_list = detect(video, ContentDetector(threshold=SCENE_THRESHOLD))
        for start, end in scene_list:
            s = float(start.get_seconds())
            e = float(end.get_seconds())
            if e > s:
                shots.append({"start": s, "end": e})
    except Exception as e:  # noqa: BLE001
        # Detector missing/failed → fall through to the single-shot synthesis below.
        log.info("reel_deconstruct: scenedetect unavailable/failed (%s) — single shot", e)

    if not shots:
        dur = total if total > 0 else max((_ffprobe_duration(video), 0.0))
        if dur <= 0:
            dur = 0.0
        shots = [{"start": 0.0, "end": dur}]

    # Persist scenes.csv (H3 scenes.file) — start_sec,end_sec per shot.
    csv_path = os.path.join(work, "scenes.csv")
    try:
        with open(csv_path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["shot", "start_sec", "end_sec"])
            for i, sh in enumerate(shots):
                w.writerow([i, f"{sh['start']:.3f}", f"{sh['end']:.3f}"])
    except Exception as e:  # noqa: BLE001
        log.warning("reel_deconstruct: scenes.csv write failed: %s", e)
    return shots


def _extract_keyframes(video: str, work: str, shots: list[dict[str, float]]) -> list[dict[str, Any]]:
    """Grab ONE keyframe per shot at its midpoint → cut_<i>.jpg. Returns the H3 keyframes
    list [{file, cutIndex, ts}] (bare file names). A failed grab for one shot is skipped,
    never fatal."""
    frames: list[dict[str, Any]] = []
    for i, sh in enumerate(shots):
        mid = (float(sh["start"]) + float(sh["end"])) / 2.0
        if mid < 0:
            mid = 0.0
        name = f"cut_{i}.jpg"
        out = os.path.join(work, name)
        cp = _run(["ffmpeg", "-y", "-ss", f"{mid:.3f}", "-i", video,
                   "-frames:v", "1", "-q:v", "3", out], timeout=FFMPEG_TIMEOUT)
        if cp.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 0:
            frames.append({"file": name, "cutIndex": i, "ts": round(mid, 3)})
        else:
            log.info("reel_deconstruct: keyframe %s failed: %s", i, _stderr_tail(cp)[:120])
    return frames


def _compute_pacing(shots: list[dict[str, float]]) -> dict[str, Any]:
    """Compute the H4 pacing jsonb from detected shots (seconds). Math is EXACTLY the
    GROUND spec — see the frozen contract. All divisions are guarded."""
    durations = [max(0.0, float(s["end"]) - float(s["start"])) for s in shots]
    shot_count = len(durations)
    starts = [float(s["start"]) for s in shots]
    ends = [float(s["end"]) for s in shots]
    total_duration = (max(ends) - min(starts)) if shots else 0.0
    if total_duration < 0:
        total_duration = 0.0

    asl = (total_duration / shot_count) if (shot_count > 0 and total_duration > 0) else 0.0
    median_shot = statistics.median(durations) if durations else 0.0
    cuts_per_sec = ((shot_count - 1) / total_duration) if total_duration > 0 else 0.0

    # H4 buckets: asl<1.0 frenetic, 1.0–2.0 punchy, 2.0–4.0 steady, >4.0 languid.
    if asl < 1.0:
        rhythm_label = "frenetic"
    elif asl <= 2.0:
        rhythm_label = "punchy"
    elif asl <= 4.0:
        rhythm_label = "steady"
    else:
        rhythm_label = "languid"

    front_loaded = False
    if len(durations) >= 3:
        third = len(durations) // 3
        first_third = durations[:third] or durations[:1]
        last_third = durations[-third:] or durations[-1:]
        mean_first = statistics.mean(first_third)
        mean_last = statistics.mean(last_third)
        front_loaded = mean_first < (mean_last * 0.8)

    return {
        "asl": round(asl, 4),
        "median_shot": round(median_shot, 4),
        "cuts_per_sec": round(cuts_per_sec, 4),
        "shot_count": shot_count,
        "total_duration": round(total_duration, 4),
        "rhythm_label": rhythm_label,
        "front_loaded": bool(front_loaded),
        "pacing_curve": [round(d, 4) for d in durations],
        "detector": "ContentDetector",
        "threshold": SCENE_THRESHOLD,
        "computed_at": _now_iso(),
    }


async def _process_reel(client: httpx.AsyncClient, row: dict[str, Any]) -> bool:
    """Phase 1 REEL pipeline for one already-CLAIMED (media_status='analyzing') row.

    Steps (each writes progress {step,pct,msg,updated_at}):
      acquire   — manual-upload-first → yt-dlp mp4 (cap 100M, IG cookies). fail →
                  media_status='acquire_failed' + media_error (surfaces an upload CTA).
      audio     — ffmpeg -vn libmp3lame -q:a 2 (null if silent, never fatal).
      scenes    — PySceneDetect ContentDetector → scenes.csv.
      keyframes — one ffmpeg frame per shot midpoint → cut_<i>.jpg.
      pacing    — the H4 pacing math.
      done      — write asset_manifest (H3) + pacing (H4) + media_status='analyzed' +
                  analyzed_at. post-acquire failure → media_status='analyze_failed'.

    MEDIA-RETAIN: unlike the longform path, the per-id dir under REELS_DIR is KEPT so the
    signed /fb/reels/<id>/<file> GET can stream the layers. Never raises."""
    row_id = row.get("id")
    src = row.get("reel_url") or row.get("source_url_resolved")
    work = _reel_work_dir(str(row_id))
    acquired = False
    try:
        # 1. acquire ──────────────────────────────────────────────────────────────
        await _write_progress(client, row_id, "acquire", 8,
                              "acquiring video" + (" (cookies)" if _ytdlp_cookies() else ""))
        if src:
            await _patch_row(client, row_id, {"source_url_resolved": src})
        video = await asyncio.to_thread(_acquire_reel_video, src, work)
        acquired = True
        base_bytes = os.path.getsize(video)
        base_duration = _ffprobe_duration(video)

        # 2. audio ──────────────────────────────────────────────────────────────
        await _write_progress(client, row_id, "audio", 30, "extracting audio")
        audio_path = await asyncio.to_thread(_extract_reel_audio, video, work)

        # 3. scenes ───────────────────────────────────────────────────────────────
        await _write_progress(client, row_id, "scenes", 50, "detecting cuts")
        shots = await asyncio.to_thread(_detect_scenes, video, work)

        # 4. keyframes ──────────────────────────────────────────────────────────
        await _write_progress(client, row_id, "keyframes", 70,
                              f"{len(shots)} shots — grabbing keyframes")
        keyframes = await asyncio.to_thread(_extract_keyframes, video, work, shots)

        # 5. pacing ───────────────────────────────────────────────────────────────
        await _write_progress(client, row_id, "pacing", 88, "computing pacing")
        pacing = _compute_pacing(shots)

        # 6. done — assemble H3 asset_manifest (BARE file names, base_dir no /fb/) ──
        audio_manifest = None
        if audio_path:
            audio_manifest = {"file": "audio.mp3", "bytes": os.path.getsize(audio_path)}
        asset_manifest = {
            "base_video": {
                "file": os.path.basename(video),
                "bytes": base_bytes,
                "duration": round(base_duration, 3),
            },
            "audio": audio_manifest,
            "keyframes": keyframes,
            "scenes": {"file": "scenes.csv", "shotCount": len(shots)},
            "base_dir": f"reels/{row_id}",
            "version": 1,
        }
        ok = await _patch_row(client, row_id, {
            "asset_manifest": asset_manifest,
            "pacing": pacing,
            "media_status": "analyzed",
            "analyzed_at": _now_iso(),
            "media_error": None,
            "progress": {"step": "done", "pct": 100, "msg": "analyzed",
                         "updated_at": _now_iso()},
        })
        if not ok:
            log.warning("reel_deconstruct: reel final PATCH failed for %s", row_id)
        log.info("reel_deconstruct: deconstructed reel %s (%d shots, audio=%s)",
                 row_id, len(shots), bool(audio_path))
        return True

    except _AcquireError as e:  # acquisition failed → 'acquire_failed' + upload CTA
        log.warning("reel_deconstruct: reel acquire failed for %s: %s", row_id, e)
        await _fail_reel(client, row_id, "acquire_failed", str(e))
        return False
    except subprocess.TimeoutExpired as e:  # noqa: BLE001
        status = "acquire_failed" if not acquired else "analyze_failed"
        await _fail_reel(client, row_id, status, f"timeout: {e}")
        return False
    except Exception as e:  # noqa: BLE001 — never crash the worker / poison the queue
        log.exception("reel_deconstruct: reel pipeline error for %s: %s", row_id, e)
        status = "acquire_failed" if not acquired else "analyze_failed"
        await _fail_reel(client, row_id, status, str(e))
        return False
    # NOTE: NO finally rmtree — reels MEDIA-RETAIN their layers under REELS_DIR.


async def _fail_reel(client: httpx.AsyncClient, row_id: str | None,
                     status: str, detail: str) -> None:
    """Land a reel row in a terminal failure status ('acquire_failed' before the video is
    in hand, 'analyze_failed' after) with the error tail. Best-effort."""
    if not row_id:
        return
    await _patch_row(client, row_id, {
        "media_status": status,
        "media_error": (detail or "")[-ERR_TAIL:],
        "progress": {"step": "done", "pct": 100, "msg": status,
                     "updated_at": _now_iso()},
    })


async def _fail_row(client: httpx.AsyncClient, row_id: str | None, detail: str) -> None:
    """Land a row in the terminal analyze_failed status with the error tail. Best-effort:
    even if this write fails the worker still returns cleanly."""
    if not row_id:
        return
    await _patch_row(client, row_id, {
        "media_status": "analyze_failed",
        "media_error": (detail or "")[-ERR_TAIL:],
        "progress": {"step": "done", "pct": 100, "msg": "failed",
                     "updated_at": _now_iso()},
    })


# ── single-flight concurrency guard (OOM protection on the 5.2GB box) ──────────
# The */2 cron POSTs /deconstruct every 2 min; a heavy analysis (PySceneDetect + ffmpeg,
# whole video held in memory) can exceed 2 min, so WITHOUT a cap the next tick would claim
# a DIFFERENT pending row and run a SECOND pipeline concurrently → OOM kill on this box.
# We cap CONCURRENT analyses in THIS uvicorn process (default 1). Slots are reserved
# SYNCHRONOUSLY (no await between the busy-check and the reserve) so two near-simultaneous
# requests can't both pass. An OOM kills the process (restart: unless-stopped) → _INFLIGHT
# resets empty, so the queue is NEVER blocked by a cap that outlives its task; the single
# row left in 'analyzing' is requeued by the one-shot reaper below on the next call.
_MAX_CONCURRENT = max(1, int((os.environ.get("REEL_MAX_CONCURRENT") or "1").strip() or "1"))
_INFLIGHT: set[str] = set()   # row ids whose background pipeline is running in THIS process
_RESERVED = 0                 # slots reserved between the busy-check and _INFLIGHT.add / wait
_STALE_REAPED = False         # one-shot guard for the startup requeue below


async def _reap_stale_once(client: httpx.AsyncClient) -> None:
    """ONCE per process, when nothing is in-flight here, requeue rows stranded in
    'analyzing' by a prior crash/OOM/redeploy back to 'pending_analyze' so they re-drain.
    Safe because this is the ONLY worker: a DB 'analyzing' row with an empty in-process
    _INFLIGHT is necessarily a ghost from a previous incarnation (its task can't exist)."""
    global _STALE_REAPED
    if _STALE_REAPED:
        return
    _STALE_REAPED = True
    url = _supabase_url()
    if not url:
        return
    try:
        r = await client.patch(
            f"{url}/rest/v1/reel_dna?media_status=eq.analyzing",
            headers=_supabase_headers("return=minimal"),
            json={"media_status": "pending_analyze",
                  "progress": {"step": "queued", "pct": 0,
                               "msg": "requeued after worker restart", "updated_at": _now_iso()}},
        )
        if r.status_code in (200, 204):
            log.info("reel_deconstruct: reaped stale 'analyzing' rows on first drain")
    except Exception as e:  # noqa: BLE001
        log.warning("reel_deconstruct: stale reap failed: %s", e)


async def _process_row_bg(row: dict[str, Any]) -> None:
    """Background wrapper: open a fresh long-timeout client and process one already-
    claimed row. Used when the request returns immediately (the cron/owner path) so a
    multi-minute pipeline never holds the HTTP connection open. _process_row never
    raises, so this task always settles the row into a terminal status. The finally
    releases this row's concurrency slot even if the task is cancelled."""
    rid = str(row.get("id") or "")
    try:
        async with httpx.AsyncClient(timeout=ACQUIRE_TIMEOUT + WHISPER_TIMEOUT + LLM_TIMEOUT + 60) as client:
            await _process_row(client, row)
    finally:
        _INFLIGHT.discard(rid)


# ── endpoint (C6) ──────────────────────────────────────────────────────────────
@router.post("/deconstruct")
async def deconstruct(request: Request):
    """POST /api/reel/deconstruct?secret=<REEL_DECONSTRUCT_SECRET>[&id=<uuid>][&wait=1]

    Verifies the secret (401 otherwise), atomically claims ONE format='long' /
    media_status='pending_analyze' row (or the named &id), then runs the
    deconstruction pipeline writing C2/C3 + the terminal status via the service role.

    The CLAIM is synchronous so the response truthfully reports `claimed`. By default
    the heavy pipeline runs in the BACKGROUND (asyncio task) and we return immediately
    — mirrors ig_webhook's /sync, so the */2 cron curl doesn't hold a connection open
    for the whole (multi-minute) analysis. Pass ?wait=1 to run synchronously for
    debugging (returns {processed} too). Never crashes — a per-row failure becomes
    media_status='analyze_failed' in the background and the queue is never poisoned."""
    want = _secret()
    got = request.query_params.get("secret")
    if not want or got != want:
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=401)

    if not _feature_on():
        # Flag off → ack and do nothing (proves the queue/endpoint is wired without
        # acting). Matches ig_webhook's FEATURE-flag convention.
        return JSONResponse({"ok": True, "claimed": 0, "processed": 0,
                             "disabled": True}, status_code=200)

    row_id = request.query_params.get("id") or None
    wait = request.query_params.get("wait") == "1"

    global _RESERVED
    # Claim with a short-timeout client (the claim is a single fast PATCH).
    async with httpx.AsyncClient(timeout=30) as client:
        # One-shot: requeue rows stranded 'analyzing' by a prior crash/OOM/redeploy. Runs
        # only when this process holds nothing, so it can never touch a live analysis.
        if not _INFLIGHT and _RESERVED == 0:
            await _reap_stale_once(client)

        # CONCURRENCY CAP (OOM guard): if a heavy pipeline is already running in this
        # process, don't claim another — the row stays 'pending_analyze' and the next */2
        # tick drains it once a slot frees. ?wait=1 (debug) bypasses so it always runs.
        if not wait and (len(_INFLIGHT) + _RESERVED) >= _MAX_CONCURRENT:
            return JSONResponse({"ok": True, "claimed": 0, "busy": True}, status_code=200)

        _RESERVED += 1   # reserve a slot SYNCHRONOUSLY before the claim await
        try:
            row = await _claim_one(client, row_id)
            if not row:
                return JSONResponse({"ok": True, "claimed": 0, "processed": 0},
                                    status_code=200)
            if wait:
                # Synchronous debug path: process inline, report the outcome. _process_row
                # never raises → a failure is recorded as analyze_failed, still 200.
                ok = await _process_row(client, row)
                return JSONResponse({"ok": bool(ok), "claimed": 1,
                                     "processed": 1 if ok else 0, "waited": True},
                                    status_code=200)
            # Default cron/owner path: hold the claim (media_status='analyzing'); finish the
            # pipeline in the background so the request returns immediately. Hand the slot to
            # the background task (it discards from _INFLIGHT in its finally).
            _INFLIGHT.add(str(row.get("id") or ""))
            asyncio.create_task(_process_row_bg(row))
            return JSONResponse({"ok": True, "claimed": 1, "started": True}, status_code=200)
        finally:
            _RESERVED -= 1   # release the temporary reservation (slot now in _INFLIGHT or freed)


# ── signed reel-asset download (HMAC validator + stream) ──────────────────────
# A SECOND router with NO prefix so the deploy owner can mount it at the path the
# nginx/caddy `/fb/reels` location forwards to (H7). The Vercel rewrite strips `/fb/`,
# so api.footagebrain.com receives `/reels/<id>/<file>?t=…&exp=…`. Registering this
# router WITHOUT a prefix (app.include_router(reel_deconstruct.serve_router)) makes the
# live path `/reels/<id>/<file>` resolve here. (If the stack adds `/api` globally,
# point the nginx location at `/api/reels/...` and register with prefix="/api".)
serve_router = APIRouter(tags=["reel-serve"])


def _verify_download_sig(reel_id: str, file: str, t: str | None, exp: str | None) -> tuple[bool, str]:
    """Validate a signed reel-download request against the H1 CANONICAL HMAC.

    Recomputes message = f"reels/{reel_id}/{file}:{exp}" (NO /fb/, NO leading slash, NO
    query — BYTE-IDENTICAL to the JS minter `reels/${id}/${file}:${exp}`), HMACs it with
    FB_DOWNLOAD_SIGNING_SECRET (sha256, lowercase hex), and constant-time-compares.
    Rejects on: bad segment chars, missing/unconfigured secret, missing/non-int exp,
    expiry (now > exp), or signature mismatch. Returns (ok, reason)."""
    if not _SEG_RE.match(reel_id or "") or not _SEG_RE.match(file or ""):
        return False, "invalid id or file"
    secret = _download_signing_secret()
    if not secret:
        return False, "signing secret not configured"
    if not t or not exp:
        return False, "missing t or exp"
    try:
        exp_int = int(exp)
    except (TypeError, ValueError):
        return False, "bad exp"
    if int(time.time()) > exp_int:
        return False, "expired"
    # H1 canonical message — must byte-match the JS minter exactly.
    message = f"reels/{reel_id}/{file}:{exp_int}"
    expected = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, t):
        return False, "signature mismatch"
    return True, "ok"


@serve_router.get("/reels/{reel_id}/{file}")
async def serve_reel_asset(reel_id: str, file: str, request: Request):
    """GET /reels/<id>/<file>?t=<hmac>&exp=<exp> — stream a MEDIA-RETAINED reel layer.

    Validates the H1 HMAC (constant-time, expiry-checked) BEFORE touching the disk, then
    streams <REELS_DIR>/<id>/<file> with Content-Disposition: attachment (defense in
    depth — vercel.json H7 also forces it). 403 on bad/expired signature, 404 on a
    missing file. The _SEG_RE guard + os.path.basename make path traversal impossible."""
    t = request.query_params.get("t")
    exp = request.query_params.get("exp")
    ok, reason = _verify_download_sig(reel_id, file, t, exp)
    if not ok:
        return JSONResponse({"ok": False, "error": reason}, status_code=403)
    # Re-assert bare names (defense in depth) and build the on-disk path.
    safe_id = os.path.basename(reel_id)
    safe_file = os.path.basename(file)
    path = os.path.join(_reels_dir(), safe_id, safe_file)
    if not os.path.isfile(path):
        return JSONResponse({"ok": False, "error": "not found"}, status_code=404)
    return FileResponse(
        path,
        filename=safe_file,
        headers={"Content-Disposition": f'attachment; filename="{safe_file}"'},
    )


# ── health / readiness (GET) — handy for the deploy smoke test ────────────────
@router.get("/status")
async def status():
    return {
        "ok": True,
        "feature_enabled": _feature_on(),
        "secret_set": bool(_secret()),
        "openrouter_set": bool(_openrouter_key()),
        "model": _model(),
        "data_dir": _data_dir(),
        "reels_dir": _reels_dir(),
        "download_signing_set": bool(_download_signing_secret()),
        "supabase_configured": bool(_supabase_url()) and bool(os.environ.get("SUPABASE_SERVICE_ROLE_KEY")),
        "cookies_set": bool(_ytdlp_cookies()),
        "max_concurrent": _MAX_CONCURRENT,
        "inflight": len(_INFLIGHT),
    }
