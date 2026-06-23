"""
edit_ai.py — Hetzner AI-edit worker for FootageBrain's OpenCut editor.

Two background AI jobs that POWER the multitrack editor:

  CAPTIONS — download a Google-Drive source clip → extract audio → faster-whisper
             (small/int8/cpu, word_timestamps) → group words into short cues
             ({text, startAt, endAt}) → write to the edit_ai_jobs row. The editor
             maps captions[] onto a type:"text" captions TRACK.

  SILENCE / FILLER — download the source → run ffmpeg silencedetect for dead-air
             ranges AND scan whisper word timestamps for filler words ("um", "uh",
             "like", …) → merge + clamp to source bounds → suggestedCuts
             [{start,end,kind:"silence"|"filler",word?}]. The editor renders these
             as removable highlight regions whose Apply SPLITS the clip (a pure
             client trimIn/trimOut transform — NEVER auto-applied here).

Same fire-and-forget + poll architecture as render.py / reel_deconstruct.py:
  POST /api/edit/captions/submit  → inserts an edit_ai_jobs row (kind='captions'),
                                    fires _captions_job() in the background, returns
                                    { job_id } immediately.
  GET  /api/edit/captions/status/{job_id}  → { status, progress, captions:[…] }
  POST /api/edit/silence/submit   → inserts an edit_ai_jobs row (kind='silence'),
                                    fires _silence_job() in the background, returns
                                    { job_id }.
  GET  /api/edit/silence/status/{job_id}   → { status, progress, suggestedCuts:[…] }

The secret gate, the Google-Drive download approach, and the single-flight
concurrency cap are IDENTICAL to render.py (same REEL_DECONSTRUCT_SECRET, same
service-account Drive client, same EDIT_MAX_CONCURRENT pattern). The whisper helper
is REPLICATED (not imported) from reel_deconstruct.py — that file is read-only —
using the same WhisperModel("small", device="cpu", compute_type="int8") +
transcribe(language=…, vad_filter=True, word_timestamps=True) calibration.

ENVIRONMENT VARIABLES:
  REEL_DECONSTRUCT_SECRET      (reuse for edit auth — same shared secret)
  GOOGLE_SERVICE_ACCOUNT_JSON  (JSON string of service-account creds for Drive)
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  EDIT_AI_DIR                  (default: /srv/footagebrain/edit_ai — temp work dirs)
  EDIT_MAX_CONCURRENT          (default: 1 — safe co-resident with render/whisper)

────────────────────────────────────────────────────────────────────────────────
DEPLOY (HUMAN-GATED — owner runs these, NOT the worker)
────────────────────────────────────────────────────────────────────────────────
1. Copy this file to the Hetzner backend (it is NOT volume-mounted — code is baked
   into the image):
     scp "backend-handoff/edit_ai.py" \
       root@178.105.14.144:/srv/footagebrain/footage-brain-test/backend/app/api/edit_ai.py

2. Register the router in backend/app/api/__init__.py (same idiom render.py uses):
     from .edit_ai import edit_router
     app.include_router(edit_router)
   (edit_router declares NO prefix; its routes already start "/edit/…". If the app
    mounts routers with include_router(prefix="/api") the live path becomes
    /api/edit/captions/submit etc. If "/api" is NOT global, register with
    prefix="/api": app.include_router(edit_router, prefix="/api").)

3. Caddyfile — expose /api/edit/* at the edge. The frontend nginx only proxies
   /api/, /thumbnails/, /health, so /api/edit/* already rides the existing /api/
   handle IF that handle is a prefix match. To be explicit / future-proof, add a
   dedicated handle to deploy/hetzner/Caddyfile (query-strings auto-forward):
     handle /api/edit/* {
         reverse_proxy backend:8000
     }
   then reload WITHOUT an image rebuild:
     docker exec fb-caddy caddy reload

4. System deps in the backend image (already present for reel_deconstruct/render):
     ffmpeg + ffprobe        (silencedetect, audio extract)
     faster-whisper (small)  (word_timestamps transcription)
     google-api-python-client + google-auth  (Drive download)
   FONTS: the captions TRACK is rendered/burned by the RENDER worker (render.py),
   not here — but for any future server-side caption burn-in ensure a TrueType font
   is installed in the image (e.g. `apt-get install -y fonts-dejavu-core`) so
   ffmpeg drawtext can find DejaVuSans.ttf. This worker only emits caption DATA, so
   fonts are not required for captions/silence to function.

5. Rebuild + recreate the backend (code is baked, not mounted):
     docker compose build backend && docker compose up -d backend
   Verify in-container:
     docker exec fb-backend python3 -c "import app.api.edit_ai as m; print('ok')"
     curl -s "https://api.footagebrain.com/api/edit/health?secret=$REEL_DECONSTRUCT_SECRET"

6. DB: requires the edit_ai_jobs table (migration — apply is HUMAN-GATED). Columns
   read/written here: id (uuid pk), project_id, source_drive_id, kind
   ('captions'|'silence'), language, options (jsonb), status
   ('queued'|'processing'|'done'|'failed'), progress (int), captions (jsonb),
   suggested_cuts (jsonb), error (text), created_at, updated_at, completed_at.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

logger = logging.getLogger("edit_ai")

# NO prefix — routes start "/edit/…"; "/api" is added at include_router time (mirrors
# render.py's render_router, whose routes start "/render/…").
edit_router = APIRouter()

# ── Config ──────────────────────────────────────────────────────────────────────

EDIT_SECRET          = os.environ.get("REEL_DECONSTRUCT_SECRET", "")
GOOGLE_SA_JSON       = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
EDIT_AI_DIR          = Path(os.environ.get("EDIT_AI_DIR", "/srv/footagebrain/edit_ai"))
EDIT_MAX_CONCURRENT  = int(os.environ.get("EDIT_MAX_CONCURRENT", "1"))

# Job guardrails.
DOWNLOAD_TIMEOUT = 600       # seconds — Drive download
FFMPEG_TIMEOUT   = 900       # seconds — audio extract / silencedetect
WHISPER_TIMEOUT  = 1800      # seconds — local transcription
ERR_TAIL         = 2000      # max chars of error we persist

# Caption cueing: group words into cues no longer than this.
CUE_MAX_WORDS = 7
CUE_MAX_SECS  = 3.0
CUE_GAP_SPLIT = 0.8          # a silent gap > this between words forces a new cue

# Default silencedetect calibration (overridable per-request via options).
DEFAULT_SILENCE_DB  = -30.0  # noise floor in dB (silencedetect noise=<db>dB)
DEFAULT_MIN_SILENCE = 0.6    # minimum silence duration in seconds (d=<sec>)

# Default filler set (normalized, punctuation-stripped, lower-cased) — overridable
# per-request via options.fillers[].
DEFAULT_FILLERS = {
    "um", "uh", "uhm", "umm", "er", "erm", "ah", "hmm", "mhm",
    "like", "so", "well", "actually", "basically", "literally",
    "you know", "i mean", "kind of", "sort of",
}

_RUNNING = 0
_LOCK = asyncio.Lock()


# ── Auth helper (identical idiom to render.py._check_secret) ─────────────────────

def _check_secret(request: Request) -> None:
    secret = request.query_params.get("secret", "")
    import hmac
    if not EDIT_SECRET or not hmac.compare_digest(secret, EDIT_SECRET):
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Supabase helpers (mirror render.py / reel_deconstruct.py) ────────────────────

def _sb_headers(prefer: str = "return=representation") -> dict:
    return {
        "apikey":        SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        prefer,
    }


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


async def _sb_patch(client: httpx.AsyncClient, job_id: str, patch: dict) -> None:
    patch.setdefault("updated_at", _now_iso())
    try:
        r = await client.patch(
            f"{SUPABASE_URL}/rest/v1/edit_ai_jobs?id=eq.{job_id}",
            headers=_sb_headers("return=minimal"),
            json=patch,
            timeout=15,
        )
        if r.status_code >= 400:
            logger.error("edit_ai: PATCH %s → %d %s", job_id, r.status_code, r.text[:200])
    except Exception as exc:  # noqa: BLE001
        logger.warning("edit_ai: PATCH %s failed: %s", job_id, exc)


async def _sb_get_job(client: httpx.AsyncClient, job_id: str) -> Optional[dict]:
    try:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/edit_ai_jobs?id=eq.{job_id}&select=*",
            headers=_sb_headers(),
            timeout=15,
        )
        rows = r.json() if r.status_code == 200 else []
        return rows[0] if rows else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("edit_ai: GET %s failed: %s", job_id, exc)
        return None


async def _progress(client: httpx.AsyncClient, job_id: str, pct: int) -> None:
    await _sb_patch(client, job_id, {"status": "processing", "progress": int(pct)})


# ── Google Drive source download (IDENTICAL approach to render.py) ───────────────

async def _download_drive_file(drive_id: str, dest: Path) -> None:
    """Download a Google Drive file to `dest` using the service account in
    GOOGLE_SERVICE_ACCOUNT_JSON — same code path render.py uses."""
    if not GOOGLE_SA_JSON:
        raise RuntimeError("GOOGLE_SERVICE_ACCOUNT_JSON not set — cannot download from Drive")

    def _sync_download() -> None:
        from google.oauth2 import service_account  # type: ignore
        from googleapiclient.discovery import build  # type: ignore
        from googleapiclient.http import MediaIoBaseDownload  # type: ignore

        creds = service_account.Credentials.from_service_account_info(
            json.loads(GOOGLE_SA_JSON),
            scopes=["https://www.googleapis.com/auth/drive.readonly"],
        )
        service = build("drive", "v3", credentials=creds, cache_discovery=False)
        req = service.files().get_media(fileId=drive_id)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as fh:
            downloader = MediaIoBaseDownload(fh, req)
            done = False
            while not done:
                status, done = downloader.next_chunk()
                if status:
                    logger.debug("Drive %s: %d%%", drive_id, int(status.progress() * 100))

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _sync_download)


# ── ffmpeg / ffprobe helpers ─────────────────────────────────────────────────────

async def _ffprobe_duration(path: Path) -> float:
    """Container duration in seconds via ffprobe; 0.0 if unavailable. Used to CLAMP
    every suggested cut to the real source bounds."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await proc.communicate()
        return float((out.decode(errors="replace") or "0").strip() or 0.0)
    except Exception as exc:  # noqa: BLE001
        logger.warning("ffprobe failed for %s: %s", path, exc)
        return 0.0


async def _extract_audio(video: Path, work: Path) -> Path:
    """Extract a 16kHz mono wav for whisper + silencedetect. Raises on hard failure."""
    out = work / "audio.wav"
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-i", str(video), "-vn",
        "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", str(out),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0 or not out.exists() or out.stat().st_size == 0:
        raise RuntimeError(
            "ffmpeg audio extract failed: "
            + (stderr.decode(errors="replace")[-ERR_TAIL:] if stderr else "no output")
        )
    return out


_SILENCE_START_RE = re.compile(r"silence_start:\s*(-?\d+(?:\.\d+)?)")
_SILENCE_END_RE   = re.compile(r"silence_end:\s*(-?\d+(?:\.\d+)?)")


async def _detect_silence(audio: Path, silence_db: float, min_silence: float) -> list[dict[str, float]]:
    """Run `ffmpeg -af silencedetect=noise=<db>dB:d=<sec>` and parse STDERR for the
    silent [start, end] ranges. Returns [{start, end}] in seconds. A trailing
    silence_start without a matching silence_end (silence runs to EOF) is left to the
    caller to clamp against the probed duration."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-i", str(audio),
        "-af", f"silencedetect=noise={silence_db}dB:d={min_silence}",
        "-f", "null", "-",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    text = stderr.decode(errors="replace") if stderr else ""

    ranges: list[dict[str, float]] = []
    pending_start: Optional[float] = None
    for line in text.splitlines():
        ms = _SILENCE_START_RE.search(line)
        if ms:
            pending_start = float(ms.group(1))
            continue
        me = _SILENCE_END_RE.search(line)
        if me and pending_start is not None:
            start = max(0.0, pending_start)
            end = float(me.group(1))
            if end > start:
                ranges.append({"start": start, "end": end})
            pending_start = None
    if pending_start is not None:
        # Silence ran to EOF; mark an open-ended range (clamped by caller).
        ranges.append({"start": max(0.0, pending_start), "end": -1.0})
    return ranges


# ── WHISPER helper (REPLICATED from reel_deconstruct.py — that file is read-only) ─
# Same calibration the project's longform worker uses: WhisperModel("small",
# device="cpu", compute_type="int8") + transcribe(language=…, vad_filter=True,
# word_timestamps=True). Imported lazily so the module loads where the package is
# absent. Returns flat word list [{word, start, end}] in SOURCE seconds.

def _whisper_words(audio_path: str, language: Optional[str]) -> list[dict[str, Any]]:
    """Transcribe with faster-whisper and return per-WORD timestamps
    [{word, start, end}] (absolute source seconds). Empty list if the model produces
    nothing. Raises RuntimeError if faster-whisper is missing or transcription hard-
    fails (the caller converts that into a failed job)."""
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"faster-whisper not installed: {e}")
    try:
        model = WhisperModel("small", device="cpu", compute_type="int8")
        lang = (language or "").strip() or None
        seg_iter, _info = model.transcribe(
            audio_path,
            language=lang,
            vad_filter=True,
            word_timestamps=True,
        )
        words: list[dict[str, Any]] = []
        for seg in seg_iter:
            seg_words = getattr(seg, "words", None) or []
            if seg_words:
                for w in seg_words:
                    txt = (getattr(w, "word", "") or "").strip()
                    if not txt:
                        continue
                    start = float(getattr(w, "start", 0.0) or 0.0)
                    end = float(getattr(w, "end", start) or start)
                    if end < start:
                        end = start
                    words.append({"word": txt, "start": start, "end": end})
            else:
                # No word-level timing for this segment — fall back to a segment-level
                # pseudo-word so captions still get text (cueing handles it gracefully).
                txt = (getattr(seg, "text", "") or "").strip()
                if txt:
                    start = float(getattr(seg, "start", 0.0) or 0.0)
                    end = float(getattr(seg, "end", start) or start)
                    words.append({"word": txt, "start": start, "end": max(end, start)})
        return words
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"whisper transcribe failed: {e}")


# ── caption cueing ───────────────────────────────────────────────────────────────

def _group_into_cues(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group flat per-word timestamps into caption cues {text, startAt, endAt}
    (absolute source seconds). A cue is flushed when it would exceed CUE_MAX_WORDS,
    span more than CUE_MAX_SECS, or a silent gap > CUE_GAP_SPLIT opens before the next
    word. startAt = first word's start; endAt = last word's end."""
    cues: list[dict[str, Any]] = []
    buf: list[dict[str, Any]] = []

    def _flush() -> None:
        if not buf:
            return
        text = " ".join((w["word"] or "").strip() for w in buf).strip()
        text = re.sub(r"\s+", " ", text)
        if not text:
            buf.clear()
            return
        start = round(float(buf[0]["start"]), 3)
        end = round(float(buf[-1]["end"]), 3)
        if end < start:
            end = start
        cues.append({"text": text, "startAt": start, "endAt": end})
        buf.clear()

    for w in words:
        if buf:
            gap = float(w["start"]) - float(buf[-1]["end"])
            span = float(w["end"]) - float(buf[0]["start"])
            if (len(buf) >= CUE_MAX_WORDS) or (span > CUE_MAX_SECS) or (gap > CUE_GAP_SPLIT):
                _flush()
        buf.append(w)
    _flush()
    return cues


# ── filler + silence → suggestedCuts ─────────────────────────────────────────────

_PUNCT_RE = re.compile(r"[^\w']+", re.UNICODE)


def _normalize_word(w: str) -> str:
    return _PUNCT_RE.sub("", (w or "").strip().lower())


def _filler_cuts(words: list[dict[str, Any]], fillers: set[str]) -> list[dict[str, Any]]:
    """Mark each word whose normalized text is in the filler set as a removable
    [start, end] range (kind='filler', word=<verbatim>)."""
    cuts: list[dict[str, Any]] = []
    for w in words:
        norm = _normalize_word(w["word"])
        if norm and norm in fillers:
            start = float(w["start"])
            end = float(w["end"])
            if end <= start:
                end = start + 0.05
            cuts.append({
                "start": round(start, 3),
                "end": round(end, 3),
                "kind": "filler",
                "word": (w["word"] or "").strip(),
            })
    return cuts


def _merge_and_clamp(cuts: list[dict[str, Any]], duration: float) -> list[dict[str, Any]]:
    """Sort, clamp to [0, duration] (duration<=0 → no upper clamp), and MERGE
    overlapping/adjacent ranges. When two overlapping cuts disagree on kind, a
    'silence' span wins (it subsumes the filler word it contains) and the word label is
    preserved only when the merged span stays purely 'filler'."""
    norm: list[dict[str, Any]] = []
    for c in cuts:
        start = max(0.0, float(c["start"]))
        end = float(c["end"])
        if duration > 0:
            end = min(end, duration)
            start = min(start, duration)
        if end <= start:
            continue
        norm.append({
            "start": start,
            "end": end,
            "kind": c.get("kind", "silence"),
            "word": c.get("word"),
        })
    norm.sort(key=lambda c: (c["start"], c["end"]))

    merged: list[dict[str, Any]] = []
    for c in norm:
        if merged and c["start"] <= merged[-1]["end"] + 1e-3:
            last = merged[-1]
            last["end"] = max(last["end"], c["end"])
            # silence subsumes filler; once a span is silence it stays silence.
            if "silence" in (last["kind"], c["kind"]):
                last["kind"] = "silence"
                last["word"] = None
            continue
        merged.append(dict(c))

    out: list[dict[str, Any]] = []
    for c in merged:
        item = {"start": round(c["start"], 3), "end": round(c["end"], 3), "kind": c["kind"]}
        if c["kind"] == "filler" and c.get("word"):
            item["word"] = c["word"]
        out.append(item)
    return out


# ── background jobs ───────────────────────────────────────────────────────────────

async def _captions_job(job_id: str) -> None:
    """CAPTIONS pipeline: download → extract audio → whisper word_timestamps → group
    into cues → write captions[] + status='done'. Never raises (failure → failed)."""
    global _RUNNING
    work = EDIT_AI_DIR / job_id
    work.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient() as client:
        try:
            job = await _sb_get_job(client, job_id)
            if not job:
                logger.error("edit_ai: captions job %s not found", job_id)
                return
            drive_id = job.get("source_drive_id")
            language = job.get("language")
            if not drive_id:
                raise RuntimeError("source_drive_id required")

            await _progress(client, job_id, 8)
            video = work / "source"
            await asyncio.wait_for(_download_drive_file(drive_id, video),
                                   timeout=DOWNLOAD_TIMEOUT)

            await _progress(client, job_id, 35)
            audio = await asyncio.wait_for(_extract_audio(video, work), timeout=FFMPEG_TIMEOUT)

            await _progress(client, job_id, 55)
            words = await asyncio.wait_for(
                asyncio.to_thread(_whisper_words, str(audio), language),
                timeout=WHISPER_TIMEOUT,
            )

            await _progress(client, job_id, 85)
            captions = _group_into_cues(words)

            await _sb_patch(client, job_id, {
                "status": "done",
                "progress": 100,
                "captions": captions,
                "error": None,
                "completed_at": _now_iso(),
            })
            logger.info("edit_ai: captions job %s done (%d cues)", job_id, len(captions))
        except Exception as exc:  # noqa: BLE001
            logger.exception("edit_ai: captions job %s failed: %s", job_id, exc)
            await _sb_patch(client, job_id, {
                "status": "failed",
                "error": str(exc)[:ERR_TAIL],
                "completed_at": _now_iso(),
            })
        finally:
            shutil.rmtree(work, ignore_errors=True)
            async with _LOCK:
                _RUNNING -= 1


async def _silence_job(job_id: str) -> None:
    """SILENCE/FILLER pipeline: download → extract audio → ffmpeg silencedetect ranges
    + whisper filler-word ranges → merge + clamp to source bounds → write
    suggestedCuts[] + status='done'. Never raises (failure → failed)."""
    global _RUNNING
    work = EDIT_AI_DIR / job_id
    work.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient() as client:
        try:
            job = await _sb_get_job(client, job_id)
            if not job:
                logger.error("edit_ai: silence job %s not found", job_id)
                return
            drive_id = job.get("source_drive_id")
            language = job.get("language")
            options = job.get("options") or {}

            silence_db = float(options.get("silenceDb", DEFAULT_SILENCE_DB))
            min_silence = float(options.get("minSilenceSec", DEFAULT_MIN_SILENCE))
            raw_fillers = options.get("fillers")
            if isinstance(raw_fillers, list) and raw_fillers:
                fillers = {_normalize_word(f) for f in raw_fillers if _normalize_word(f)}
            else:
                fillers = set(DEFAULT_FILLERS)

            if not drive_id:
                raise RuntimeError("source_drive_id required")

            await _progress(client, job_id, 8)
            video = work / "source"
            await asyncio.wait_for(_download_drive_file(drive_id, video),
                                   timeout=DOWNLOAD_TIMEOUT)

            await _progress(client, job_id, 30)
            audio = await asyncio.wait_for(_extract_audio(video, work), timeout=FFMPEG_TIMEOUT)
            duration = await _ffprobe_duration(video)

            # ── ffmpeg silencedetect ranges ──────────────────────────────────────
            await _progress(client, job_id, 50)
            silence_ranges = await asyncio.wait_for(
                _detect_silence(audio, silence_db, min_silence), timeout=FFMPEG_TIMEOUT
            )
            silence_cuts: list[dict[str, Any]] = []
            for r in silence_ranges:
                end = r["end"]
                if end < 0:  # ran to EOF — clamp to probed duration
                    end = duration if duration > 0 else r["start"] + min_silence
                silence_cuts.append({"start": r["start"], "end": end, "kind": "silence"})

            # ── whisper filler-word ranges ───────────────────────────────────────
            await _progress(client, job_id, 65)
            words = await asyncio.wait_for(
                asyncio.to_thread(_whisper_words, str(audio), language),
                timeout=WHISPER_TIMEOUT,
            )
            filler_cuts = _filler_cuts(words, fillers)

            # ── merge + clamp to source bounds ───────────────────────────────────
            await _progress(client, job_id, 88)
            suggested = _merge_and_clamp(silence_cuts + filler_cuts, duration)

            await _sb_patch(client, job_id, {
                "status": "done",
                "progress": 100,
                "suggested_cuts": suggested,
                "error": None,
                "completed_at": _now_iso(),
            })
            logger.info("edit_ai: silence job %s done (%d cuts: %d silence + %d filler raw)",
                        job_id, len(suggested), len(silence_cuts), len(filler_cuts))
        except Exception as exc:  # noqa: BLE001
            logger.exception("edit_ai: silence job %s failed: %s", job_id, exc)
            await _sb_patch(client, job_id, {
                "status": "failed",
                "error": str(exc)[:ERR_TAIL],
                "completed_at": _now_iso(),
            })
        finally:
            shutil.rmtree(work, ignore_errors=True)
            async with _LOCK:
                _RUNNING -= 1


# ── job insert helper ─────────────────────────────────────────────────────────────

async def _insert_job(kind: str, project_id: Optional[str], drive_id: str,
                      language: Optional[str], options: Optional[dict]) -> str:
    """Insert an edit_ai_jobs row (status='queued') and return its id. Raises
    HTTPException(502) if the DB insert fails."""
    job_id = str(uuid.uuid4())
    row: dict[str, Any] = {
        "id": job_id,
        "kind": kind,
        "source_drive_id": drive_id,
        "status": "queued",
        "progress": 0,
    }
    if project_id is not None:
        row["project_id"] = project_id
    if language:
        row["language"] = language
    if options is not None:
        row["options"] = options

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{SUPABASE_URL}/rest/v1/edit_ai_jobs",
            headers=_sb_headers(),
            json=row,
            timeout=15,
        )
        if r.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail=f"DB insert failed: {r.text[:300]}")
    return job_id


async def _reserve_slot() -> None:
    """Single-flight concurrency cap (mirrors render.py): reject a submit while
    EDIT_MAX_CONCURRENT jobs already run in this process. Reserves SYNCHRONOUSLY under
    the lock so two near-simultaneous submits can't both pass."""
    global _RUNNING
    async with _LOCK:
        if _RUNNING >= EDIT_MAX_CONCURRENT:
            raise HTTPException(
                status_code=429,
                detail=f"Edit-AI queue full ({_RUNNING}/{EDIT_MAX_CONCURRENT} running). Try again shortly.",
            )
        _RUNNING += 1


# ── API endpoints (C6 contract) ──────────────────────────────────────────────────

@edit_router.post("/edit/captions/submit")
async def captions_submit(request: Request, background_tasks: BackgroundTasks):
    """POST /api/edit/captions/submit?secret=<REEL_DECONSTRUCT_SECRET>
    Body: { project_id?, source_drive_id, language? } → { ok, job_id }

    Inserts an edit_ai_jobs row (kind='captions'), fires _captions_job in the
    background, returns immediately. Caller polls /api/edit/captions/status/{id}."""
    _check_secret(request)
    body = await request.json()
    drive_id = body.get("source_drive_id")
    if not drive_id:
        raise HTTPException(status_code=400, detail="source_drive_id required")
    project_id = body.get("project_id")
    language = body.get("language")

    await _reserve_slot()
    try:
        job_id = await _insert_job("captions", project_id, drive_id, language, None)
    except Exception:
        async with _LOCK:
            _RUNNING -= 1
        raise
    background_tasks.add_task(_captions_job, job_id)
    return {"ok": True, "job_id": job_id}


@edit_router.get("/edit/captions/status/{job_id}")
async def captions_status(job_id: str, request: Request):
    """GET /api/edit/captions/status/{job_id}?secret=… →
    { ok, status, progress, captions:[{text,startAt,endAt}] }"""
    _check_secret(request)
    async with httpx.AsyncClient() as client:
        job = await _sb_get_job(client, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "ok": True,
        "status": job.get("status"),
        "progress": job.get("progress", 0),
        "captions": job.get("captions") or [],
        "error": job.get("error"),
    }


@edit_router.post("/edit/silence/submit")
async def silence_submit(request: Request, background_tasks: BackgroundTasks):
    """POST /api/edit/silence/submit?secret=<REEL_DECONSTRUCT_SECRET>
    Body: { project_id?, source_drive_id, options:{silenceDb,minSilenceSec,fillers[]} }
        → { ok, job_id }

    Inserts an edit_ai_jobs row (kind='silence'), fires _silence_job in the
    background. Caller polls /api/edit/silence/status/{id}."""
    _check_secret(request)
    body = await request.json()
    drive_id = body.get("source_drive_id")
    if not drive_id:
        raise HTTPException(status_code=400, detail="source_drive_id required")
    project_id = body.get("project_id")
    options = body.get("options") or {}
    language = body.get("language")  # optional — improves whisper filler detection

    await _reserve_slot()
    try:
        job_id = await _insert_job("silence", project_id, drive_id, language, options)
    except Exception:
        async with _LOCK:
            _RUNNING -= 1
        raise
    background_tasks.add_task(_silence_job, job_id)
    return {"ok": True, "job_id": job_id}


@edit_router.get("/edit/silence/status/{job_id}")
async def silence_status(job_id: str, request: Request):
    """GET /api/edit/silence/status/{job_id}?secret=… →
    { ok, status, progress, suggestedCuts:[{start,end,kind,word?}] }"""
    _check_secret(request)
    async with httpx.AsyncClient() as client:
        job = await _sb_get_job(client, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "ok": True,
        "status": job.get("status"),
        "progress": job.get("progress", 0),
        "suggestedCuts": job.get("suggested_cuts") or [],
        "error": job.get("error"),
    }


@edit_router.get("/edit/health")
async def edit_health():
    return {
        "ok": True,
        "running": _RUNNING,
        "max_concurrent": EDIT_MAX_CONCURRENT,
        "edit_ai_dir": str(EDIT_AI_DIR),
        "drive_configured": bool(GOOGLE_SA_JSON),
        "secret_set": bool(EDIT_SECRET),
        "supabase_configured": bool(SUPABASE_URL) and bool(SUPABASE_SERVICE_KEY),
    }
