"""
render.py — Hetzner video render worker for FootageBrain.

Accepts a timeline_json from the frontend (via suggest.js?action=render-submit),
downloads Google Drive source files, runs a single ffmpeg filtergraph pass, and
writes the output to /srv/footagebrain/renders/{job_id}/output.mp4.

Same fire-and-forget + poll architecture as reel_deconstruct.py:
  POST /api/render/submit   → inserts a render_jobs row, fires _render_job() in the
                               background, returns { job_id } immediately.
  GET  /api/render/status/{job_id}  → returns { status, progress, output_url, error }.

Output is served via the existing HMAC-signed download pattern — reuses
FB_DOWNLOAD_SIGNING_SECRET already set for reel asset downloads.

ENVIRONMENT VARIABLES:
  REEL_DECONSTRUCT_SECRET   (reuse for render auth — same shared secret)
  FB_DOWNLOAD_SIGNING_SECRET
  GOOGLE_SERVICE_ACCOUNT_JSON  (JSON string of service-account credentials for Drive)
  RENDERS_DIR               (default: /srv/footagebrain/renders)
  RENDER_MAX_CONCURRENT     (default: 1 — safe for co-resident fast-whisper)

DEPLOYMENT NOTE:
  Register this router in backend/app/api/__init__.py:
      from .render import render_router
      app.include_router(render_router)
  The Caddyfile already forwards /api/render/* to backend:8000 — no Caddy change
  needed as long as the router is mounted at /api/render.

STATUS:  Phase 1 LIVE — _build_filtergraph does real per-clip trim + sequencing:
         cut (concat) and crossfade (xfade/acrossfade), audio-less clips get
         synthesized silence, single-clip fast path. Phase 2 (text/LUT/speed) and
         Phase 3 (chroma key, audio mix) extend the same builder.
"""

import asyncio
import hashlib
import hmac
import json
import logging
import os
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response

logger = logging.getLogger(__name__)

render_router = APIRouter()

# ── Config ────────────────────────────────────────────────────────────────────

RENDER_SECRET         = os.environ.get("REEL_DECONSTRUCT_SECRET", "")
DOWNLOAD_SECRET       = os.environ.get("FB_DOWNLOAD_SIGNING_SECRET", "")
GOOGLE_SA_JSON        = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
RENDERS_DIR           = Path(os.environ.get("RENDERS_DIR", "/srv/footagebrain/renders"))
RENDER_MAX_CONCURRENT = int(os.environ.get("RENDER_MAX_CONCURRENT", "1"))
SUPABASE_URL          = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

_RENDER_RUNNING = 0
_RENDER_LOCK    = asyncio.Lock()


# ── Auth helper ───────────────────────────────────────────────────────────────

def _check_secret(request: Request) -> None:
    secret = request.query_params.get("secret", "")
    if not RENDER_SECRET or not hmac.compare_digest(secret, RENDER_SECRET):
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Supabase helpers (mirrors reel_deconstruct.py pattern) ───────────────────

def _sb_headers() -> dict:
    return {
        "apikey":        SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "return=representation",
    }


async def _sb_patch(client: httpx.AsyncClient, table: str, row_id: str, patch: dict) -> None:
    r = await client.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}",
        headers=_sb_headers(),
        json=patch,
        timeout=10,
    )
    if r.status_code >= 400:
        logger.error("Supabase PATCH %s %s → %d %s", table, row_id, r.status_code, r.text[:200])


async def _sb_get_job(client: httpx.AsyncClient, job_id: str) -> Optional[dict]:
    r = await client.get(
        f"{SUPABASE_URL}/rest/v1/render_jobs?id=eq.{job_id}&select=*",
        headers=_sb_headers(),
        timeout=10,
    )
    rows = r.json() if r.status_code == 200 else []
    return rows[0] if rows else None


# ── HMAC-signed download URL (reuses existing pattern) ───────────────────────

def _sign_render_url(job_id: str, ttl_s: int = 3600) -> str:
    exp = int(time.time()) + ttl_s
    filename = "output.mp4"
    # Canonical message mirrors the reel asset signing pattern.
    message = f"renders/{job_id}/{filename}:{exp}"
    sig = hmac.new(DOWNLOAD_SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()
    return f"/fb/renders/{job_id}/{filename}?t={sig}&exp={exp}"


# ── Google Drive source download ─────────────────────────────────────────────

async def _download_drive_file(drive_id: str, dest: Path) -> None:
    """Download a Google Drive file to `dest` using the service account in GOOGLE_SA_JSON."""
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


# ── Source probe + clip-bounds helpers ────────────────────────────────────────

async def _probe_async(path: Path) -> tuple[float, bool]:
    """Return (duration_seconds, has_audio) via ffprobe. Tolerant of failure."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration:stream=codec_type",
            "-of", "json", str(path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await proc.communicate()
        info = json.loads(out.decode(errors="replace") or "{}")
        dur = float((info.get("format") or {}).get("duration") or 0.0)
        has_audio = any(s.get("codec_type") == "audio" for s in info.get("streams", []))
        return (dur, has_audio)
    except Exception as exc:  # noqa: BLE001
        logger.warning("ffprobe failed for %s: %s", path, exc)
        return (0.0, False)


def _clip_bounds(clip: dict, dur: float) -> tuple[float, float]:
    """Resolve a clip's (trim_in, trim_out) in seconds, clamped to the real source
    duration when known. Never trust the client past the actual media length."""
    ti = float(clip.get("trim_in") or 0.0)
    to_raw = clip.get("trim_out")
    to = float(to_raw) if to_raw not in (None, "") else (dur if dur > 0 else ti + 10.0)
    if dur > 0:
        ti = max(0.0, min(ti, max(0.0, dur - 0.05)))
        to = max(ti + 0.05, min(to, dur))
    elif to <= ti:
        to = ti + 0.05
    return (ti, to)


# ── ffmpeg filtergraph builder (Phase 1: trim/cut + crossfade) ────────────────

def _build_filtergraph(timeline: dict, src_files: list[Path],
                       metas: list[tuple[float, bool]]) -> list[str]:
    """
    Build the ffmpeg CLI args (without the leading "ffmpeg" or the output path)
    from a timeline_json dict.

    Phase 1 — per-clip trim + sequencing:
      • each clip trimmed to [trim_in, trim_out], normalized to the output spec
        (scale/pad to W×H, fps, yuv420p, sar 1:1) so segments are concat/xfade-safe
      • `cut` transitions  → ffmpeg `concat`
      • `xfade` transitions → chained `xfade` (video) + `acrossfade` (audio)
      • clips with no audio stream get synthesized silence (anullsrc) so concat/
        xfade always have a matching A/V pair
    Phase 2 (text/LUT/speed) and Phase 3 (chroma/audio-mix) extend this builder.

    xfade offset (running composite): offset_n = cum_len_so_far − duration_n, where
    cum_len after merging clip n via an xfade of length d = cum + seg_n − d.

    Args:
        timeline:  parsed project_json dict
        src_files: local Paths to downloaded source videos, in clip order
        metas:     (duration, has_audio) per src file, same order (from _probe_async)
    """
    if not src_files:
        raise ValueError("No source files for render")

    out = timeline.get("output", {})
    W   = int(out.get("width", 1920))
    H   = int(out.get("height", 1080))
    FPS = int(out.get("fps", 30))
    CRF = int(out.get("crf", 23))

    # Flatten video-track clips in the SAME order src_files were downloaded.
    clips: list[dict] = []
    for track in timeline.get("tracks", []):
        if track.get("type") == "video":
            for clip in track.get("clips", []):
                if clip.get("source_drive_id"):
                    clips.append(clip)
    clips = clips[: len(src_files)] or [{} for _ in src_files]
    while len(metas) < len(src_files):
        metas.append((0.0, False))

    vf_norm = (f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
               f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={FPS},format=yuv420p")

    # ── Fast path: a single clip → input-seek + simple re-encode ──────────────
    if len(src_files) == 1:
        dur, has_audio = metas[0]
        ti, to = _clip_bounds(clips[0], dur)
        args: list[str] = []
        if to > ti:
            args += ["-ss", f"{ti:.3f}", "-to", f"{to:.3f}"]
        args += ["-i", str(src_files[0]), "-vf", vf_norm, "-r", str(FPS),
                 "-c:v", "libx264", "-crf", str(CRF), "-preset", "fast", "-pix_fmt", "yuv420p"]
        args += (["-c:a", "aac", "-b:a", "192k"] if has_audio else ["-an"])
        args += ["-movflags", "+faststart", "-y"]
        return args

    # ── Multi-clip path ───────────────────────────────────────────────────────
    inputs: list[str] = []
    for sf in src_files:
        inputs += ["-i", str(sf)]
    next_idx = len(src_files)

    filters: list[str] = []
    seg_durs: list[float] = []
    for i, (sf, clip, (dur, has_audio)) in enumerate(zip(src_files, clips, metas)):
        ti, to = _clip_bounds(clip, dur)
        seg = max(0.05, to - ti)
        seg_durs.append(seg)
        filters.append(
            f"[{i}:v]trim=start={ti:.3f}:end={to:.3f},setpts=PTS-STARTPTS,{vf_norm}[v{i}]"
        )
        if has_audio:
            filters.append(
                f"[{i}:a]atrim=start={ti:.3f}:end={to:.3f},asetpts=PTS-STARTPTS,"
                f"aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a{i}]"
            )
        else:
            # synthesize silence matching this segment's length
            inputs += ["-f", "lavfi", "-t", f"{seg:.3f}", "-i",
                       "anullsrc=channel_layout=stereo:sample_rate=48000"]
            filters.append(f"[{next_idx}:a]asetpts=PTS-STARTPTS[a{i}]")
            next_idx += 1

    # Resolve transitions into clamped crossfade durations (0 = hard cut).
    trans: list[float] = []
    for i in range(len(clips) - 1):
        t = clips[i].get("transition") or {}
        if t.get("type") == "xfade":
            d = float(t.get("duration") or 0.5)
            d = min(d, seg_durs[i] - 0.05, seg_durs[i + 1] - 0.05)
            trans.append(max(0.0, d))
        else:
            trans.append(0.0)

    if all(d <= 0 for d in trans):
        # All hard cuts → single concat.
        concat_in = "".join(f"[v{i}][a{i}]" for i in range(len(clips)))
        filters.append(f"{concat_in}concat=n={len(clips)}:v=1:a=1[vout][aout]")
    else:
        # Chain xfade / acrossfade (with concat for any interleaved hard cuts).
        cur_v, cur_a = "[v0]", "[a0]"
        cum = seg_durs[0]
        for i in range(1, len(clips)):
            d = trans[i - 1]
            out_v, out_a = f"[vx{i}]", f"[ax{i}]"
            if d > 0:
                offset = cum - d
                filters.append(f"{cur_v}[v{i}]xfade=transition=fade:duration={d:.3f}:offset={offset:.3f}{out_v}")
                filters.append(f"{cur_a}[a{i}]acrossfade=d={d:.3f}{out_a}")
                cum = cum + seg_durs[i] - d
            else:
                filters.append(f"{cur_v}[v{i}]concat=n=2:v=1:a=0{out_v}")
                filters.append(f"{cur_a}[a{i}]concat=n=2:v=0:a=1{out_a}")
                cum = cum + seg_durs[i]
            cur_v, cur_a = out_v, out_a
        filters.append(f"{cur_v}null[vout]")
        filters.append(f"{cur_a}anull[aout]")

    return inputs + [
        "-filter_complex", ";".join(filters),
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-crf", str(CRF), "-preset", "fast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        "-y",
    ]


# ── Core render job ───────────────────────────────────────────────────────────

async def _render_job(job_id: str) -> None:
    global _RENDER_RUNNING

    job_dir = RENDERS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    src_dir = job_dir / "src"
    src_dir.mkdir(exist_ok=True)
    output_path = job_dir / "output.mp4"

    async with httpx.AsyncClient() as client:
        try:
            job = await _sb_get_job(client, job_id)
            if not job:
                logger.error("render_job: job %s not found in DB", job_id)
                return

            timeline = job.get("project_json", {})

            # ── Mark rendering ────────────────────────────────────────────────
            await _sb_patch(client, "render_jobs", job_id, {
                "status":     "rendering",
                "progress":   5,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })

            # ── Collect source Drive IDs ──────────────────────────────────────
            drive_ids = []
            for track in timeline.get("tracks", []):
                if track.get("type") == "video":
                    for clip in track.get("clips", []):
                        did = clip.get("source_drive_id")
                        if did:
                            drive_ids.append(did)

            # ── Download sources from Google Drive ────────────────────────────
            src_files = []
            for i, did in enumerate(drive_ids):
                dest = src_dir / f"src_{i:03d}.mp4"
                logger.info("render_job %s: downloading Drive file %s", job_id, did)
                await _download_drive_file(did, dest)
                src_files.append(dest)
                pct = 5 + int((i + 1) / max(len(drive_ids), 1) * 30)
                await _sb_patch(client, "render_jobs", job_id, {
                    "progress": pct, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })

            # ── Probe sources (duration + audio presence) ─────────────────────
            metas = []
            for sf in src_files:
                metas.append(await _probe_async(sf))

            await _sb_patch(client, "render_jobs", job_id, {
                "progress": 40, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })

            # ── Build + run ffmpeg ────────────────────────────────────────────
            ffmpeg_args = _build_filtergraph(timeline, src_files, metas)
            cmd = ["ffmpeg"] + ffmpeg_args + [str(output_path)]
            logger.info("render_job %s: ffmpeg %s", job_id, " ".join(cmd))

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            if proc.returncode != 0:
                err = stderr.decode(errors="replace")[-1000:]
                raise RuntimeError(f"ffmpeg failed (exit {proc.returncode}): {err}")

            await _sb_patch(client, "render_jobs", job_id, {
                "progress": 90, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })

            # ── Write result ──────────────────────────────────────────────────
            output_bytes = output_path.stat().st_size if output_path.exists() else 0
            output_url   = _sign_render_url(job_id, ttl_s=3600)

            await _sb_patch(client, "render_jobs", job_id, {
                "status":       "done",
                "progress":     100,
                "output_url":   output_url,
                "output_bytes": output_bytes,
                "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "updated_at":   time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
            logger.info("render_job %s: done (%d bytes)", job_id, output_bytes)

        except Exception as exc:
            logger.exception("render_job %s failed: %s", job_id, exc)
            await _sb_patch(client, "render_jobs", job_id, {
                "status":     "failed",
                "error":      str(exc)[:2000],
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
        finally:
            # Clean up source files immediately (output retained for 7 days via cron)
            if src_dir.exists():
                shutil.rmtree(src_dir, ignore_errors=True)
            async with _RENDER_LOCK:
                _RENDER_RUNNING -= 1


# ── API endpoints ─────────────────────────────────────────────────────────────

@render_router.post("/render/submit")
async def submit_render(request: Request, background_tasks: BackgroundTasks):
    """
    POST /api/render/submit?secret=<REEL_DECONSTRUCT_SECRET>
    Body: { reel_dna_id?, project_id?, project_json, render_mode? }

    Inserts a render_jobs row, fires the render in the background, returns { job_id }.
    Fire-and-forget: caller polls /api/render/status/{job_id} or watches Supabase
    realtime on the render_jobs table.
    """
    global _RENDER_RUNNING
    _check_secret(request)

    body = await request.json()
    project_json = body.get("project_json")
    if not project_json:
        raise HTTPException(status_code=400, detail="project_json required")

    reel_dna_id  = body.get("reel_dna_id")
    project_id   = body.get("project_id")
    render_mode  = body.get("render_mode", "draft")
    submitted_by = body.get("submitted_by")

    # ── Concurrency guard ─────────────────────────────────────────────────────
    async with _RENDER_LOCK:
        if _RENDER_RUNNING >= RENDER_MAX_CONCURRENT:
            raise HTTPException(
                status_code=429,
                detail=f"Render queue full ({_RENDER_RUNNING}/{RENDER_MAX_CONCURRENT} running). Try again shortly."
            )

    # ── Single-flight: reject a second active job for the same reel_dna_id ───
    if reel_dna_id:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/render_jobs"
                f"?reel_dna_id=eq.{reel_dna_id}&status=in.(queued,rendering)&select=id",
                headers=_sb_headers(),
                timeout=10,
            )
            if r.status_code == 200 and r.json():
                existing_id = r.json()[0]["id"]
                raise HTTPException(
                    status_code=409,
                    detail=f"A render job is already active for this reel ({existing_id})"
                )

    # ── Insert job row ────────────────────────────────────────────────────────
    job_id = str(uuid.uuid4())
    row = {
        "id":           job_id,
        "project_json": project_json,
        "render_mode":  render_mode,
        "status":       "queued",
        "progress":     0,
    }
    if reel_dna_id:  row["reel_dna_id"]  = reel_dna_id
    if project_id:   row["project_id"]   = project_id
    if submitted_by: row["submitted_by"] = submitted_by

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{SUPABASE_URL}/rest/v1/render_jobs",
            headers=_sb_headers(),
            json=row,
            timeout=10,
        )
        if r.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail=f"DB insert failed: {r.text[:300]}")

    # ── Fire background render ────────────────────────────────────────────────
    async with _RENDER_LOCK:
        _RENDER_RUNNING += 1

    background_tasks.add_task(_render_job, job_id)
    return {"ok": True, "job_id": job_id}


@render_router.get("/render/status/{job_id}")
async def render_status(job_id: str, request: Request):
    """
    GET /api/render/status/{job_id}?secret=<REEL_DECONSTRUCT_SECRET>

    Returns { status, progress, output_url, error }.
    output_url is a fresh HMAC-signed URL (3600s TTL) re-minted on every poll
    so the client always has a valid link.
    """
    _check_secret(request)

    async with httpx.AsyncClient() as client:
        job = await _sb_get_job(client, job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    result = {
        "job_id":   job_id,
        "status":   job.get("status"),
        "progress": job.get("progress", 0),
        "error":    job.get("error"),
    }

    if job.get("status") == "done":
        # Re-mint a fresh signed URL on every status poll (original may have expired).
        result["output_url"] = _sign_render_url(job_id, ttl_s=3600)
        result["output_bytes"] = job.get("output_bytes")

    return result


@render_router.get("/render/health")
async def render_health():
    return {
        "ok":              True,
        "running":         _RENDER_RUNNING,
        "max_concurrent":  RENDER_MAX_CONCURRENT,
        "renders_dir":     str(RENDERS_DIR),
        "drive_configured": bool(GOOGLE_SA_JSON),
    }
