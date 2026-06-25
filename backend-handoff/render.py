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

         R1/R2 ADDITIVE (audio tracks + text/captions) layered on top — see the
         HETZNER DEPLOY DISCIPLINE block below _build_filtergraph.

═══════════════════════════════════════════════════════════════════════════════
  HETZNER DEPLOY DISCIPLINE  —  READ BEFORE COPYING THIS FILE TO THE SERVER
═══════════════════════════════════════════════════════════════════════════════
  This file is a SNAPSHOT and the LIVE Hetzner copy may be AHEAD of it (it has
  diverged before). DO NOT blind-overwrite the live file. Instead:

    1.  scp the LIVE file down:
          scp root@178.105.14.144:/srv/footagebrain/footage-brain-test/backend/app/api/render.py /tmp/render.live.py
    2.  Diff against THIS snapshot, ignoring CRLF-vs-LF noise:
          diff --strip-trailing-cr /tmp/render.live.py backend-handoff/render.py
    3.  MERGE — take the live file as the base and apply ONLY the additive
        R1/R2 changes from this snapshot (they are the ONLY diffs vs. the
        pre-existing Phase-1 builder):
          • _escape_drawtext()            (new helper)
          • _SERVER_FONTS / _resolve_font (new helper + map)
          • _srt_timecode()               (new helper)
          • _build_filter_graph_string()  (the pure seam — video-only output is
                                            byte-identical to the old inline code)
          • the audio-track branch in _build_filtergraph
          • the text-track branch  in _build_filtergraph
          • the type=="audio" drive-id collection + per-track index map in
            _render_job
        NEVER drop a live-only feature the snapshot lacks.
    4.  Rebuild the image (code is BAKED, not volume-mounted):
          docker compose build backend && docker compose up -d backend
    5.  Verify the in-container file matches what you intended:
          docker exec <backend-container> sha256sum /app/app/api/render.py
        and compare to `sha256sum` of your merged local file.
═══════════════════════════════════════════════════════════════════════════════
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


# ── R2 helpers: drawtext escaping, font resolution, SRT serialization ─────────

# Map a style.font name → a known server font path, with a safe default.
# DejaVuSans ships in the slim Debian base used by the worker image.
_DEFAULT_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
_SERVER_FONTS = {
    "dejavusans":        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "dejavu sans":       "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "dejavusans-bold":   "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "dejavu serif":      "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "dejavusansmono":    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "liberation sans":   "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "liberation serif":  "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
    "arial":             "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "helvetica":         "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "times":             "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
    "times new roman":   "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
}


def _resolve_font(name: Optional[str]) -> str:
    """Resolve a style.font name to a server font path; unknown → DejaVuSans."""
    if not name:
        return _DEFAULT_FONT
    return _SERVER_FONTS.get(str(name).strip().lower(), _DEFAULT_FONT)


def _escape_drawtext(text: str) -> str:
    """
    Escape a literal string for an ffmpeg drawtext `text=` value.

    ffmpeg parses drawtext text through two layers (filtergraph token + the
    drawtext text expander). We escape the characters that break either layer:
      backslash, colon, single-quote, percent, and newlines.

    The caller wraps the result in single quotes: text='<result>'. A literal
    single quote cannot live inside a single-quoted token, so it is emitted as
    the canonical close-escape-reopen sequence (quote, backslash-quote, quote)
    which the filtergraph tokenizer reassembles into one apostrophe.
    """
    if text is None:
        return ""
    s = str(text)
    s = s.replace("\\", "\\\\")        # backslash first
    s = s.replace("%", "\\%")          # drawtext expands %{...}
    s = s.replace(":", "\\:")          # option separator in the filter token
    s = s.replace("'", "'\\''")        # close-quote, literal ', reopen-quote
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = s.replace("\n", "\\n")         # literal newline → drawtext line break
    return s


def _srt_timecode(seconds: float) -> str:
    """Format an absolute time in seconds as an SRT timecode HH:MM:SS,mmm."""
    if seconds is None or seconds < 0:
        seconds = 0.0
    total_ms = int(round(float(seconds) * 1000.0))
    ms = total_ms % 1000
    total_s = total_ms // 1000
    s = total_s % 60
    m = (total_s // 60) % 60
    h = total_s // 3600
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _collect_text_clips(timeline: dict) -> list[dict]:
    """All clips across every type=='text' track, sorted by absolute start_at."""
    out: list[dict] = []
    for track in timeline.get("tracks", []):
        if track.get("type") == "text":
            for clip in track.get("clips", []):
                out.append(clip)
    out.sort(key=lambda c: float(c.get("start_at") or c.get("startAt") or 0.0))
    return out


def _clip_text_bounds(clip: dict) -> tuple[float, float, str]:
    """Resolve a text clip's (start_at, end_at, text) using camel/snake fallbacks."""
    start = float(clip.get("start_at") or clip.get("startAt") or 0.0)
    end_raw = clip.get("end_at")
    if end_raw in (None, ""):
        end_raw = clip.get("endAt")
    end = float(end_raw) if end_raw not in (None, "") else start + 3.0
    if end <= start:
        end = start + 0.05
    text = clip.get("text") or clip.get("content") or ""
    return (start, end, text)


def _alignment_from_position(position: Optional[str]) -> int:
    """style.position → libass SRT alignment: bottom=2, top=8, center=5."""
    p = (position or "bottom").strip().lower()
    if p in ("top", "8"):
        return 8
    if p in ("center", "middle", "5"):
        return 5
    return 2  # bottom (default)


def _build_srt(text_clips: list[dict]) -> str:
    """Serialize all text clips into a single SRT document (absolute timecodes)."""
    blocks: list[str] = []
    for n, clip in enumerate(text_clips, start=1):
        start, end, text = _clip_text_bounds(clip)
        body = (str(text) or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        blocks.append(
            f"{n}\n{_srt_timecode(start)} --> {_srt_timecode(end)}\n{body}\n"
        )
    return "\n".join(blocks)


# ── ffmpeg filtergraph builder (Phase 1: trim/cut + crossfade) ────────────────

def _build_filter_graph_string(
    clips: list[dict],
    metas: list[tuple[float, bool]],
    src_files: list[Path],
    vf_norm: str,
    next_idx_start: int,
) -> tuple[list[str], list[str], list[float], int]:
    """
    PURE SEAM (R3 assertion target).

    Builds the VIDEO-PATH portion of the multi-clip filtergraph EXACTLY as the
    original inline Phase-1 code did. Returns:
        (filters, extra_inputs, seg_durs, next_idx)
    where `filters` ends with [vout] and [aout] labels, byte-identical to today.

    QA proof: for a video-only v2 doc this produces precisely the filter list the
    pre-R1/R2 code emitted — see test seam at the bottom of this module.
    """
    extra_inputs: list[str] = []
    next_idx = next_idx_start
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
            extra_inputs += ["-f", "lavfi", "-t", f"{seg:.3f}", "-i",
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

    return (filters, extra_inputs, seg_durs, next_idx)


def _build_filtergraph(timeline: dict, src_files: list[Path],
                       metas: list[tuple[float, bool]],
                       job_dir: Optional[Path] = None) -> list[str]:
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
        src_files: local Paths to downloaded VIDEO source files, in clip order,
                   OPTIONALLY followed by downloaded AUDIO-track source files
                   (one per audio clip, appended last — see audio_files below).
        metas:     (duration, has_audio) per VIDEO src file, same order
        job_dir:   the per-job working dir (R2: subs.srt is written here). When
                   None, the text branch is disabled (keeps the pure path testable).

    R1/R2 ADDITIVE: audio + text tracks are layered on ONLY when present. With
    no audio AND no text tracks, the emitted filter_complex + -map args + the
    single-clip fast path are BYTE-IDENTICAL to the pre-R1/R2 Phase-1 code.
    """
    if not src_files:
        raise ValueError("No source files for render")

    out = timeline.get("output", {})
    W   = int(out.get("width", 1920))
    H   = int(out.get("height", 1080))
    FPS = int(out.get("fps", 30))
    CRF = int(out.get("crf", 23))

    # ── R1/R2: detect additive tracks (guards every new branch) ───────────────
    audio_track_clips: list[dict] = []
    for track in timeline.get("tracks", []):
        if track.get("type") == "audio":
            for clip in track.get("clips", []):
                if clip.get("source_drive_id"):
                    audio_track_clips.append(clip)
    text_clips = _collect_text_clips(timeline)
    has_audio_tracks = bool(audio_track_clips)
    has_text_tracks  = bool(text_clips) and job_dir is not None

    # The VIDEO sources are the first N entries of src_files; any audio-track
    # source files were appended AFTER them by _render_job, one per audio clip.
    n_audio = len(audio_track_clips) if has_audio_tracks else 0
    video_files = src_files[: len(src_files) - n_audio] if n_audio else src_files
    audio_files = src_files[len(src_files) - n_audio:] if n_audio else []

    # The render is video-first: every path below assumes ≥1 video segment.
    if not video_files:
        raise ValueError("No video source files for render (audio/text tracks require a base video)")

    # Flatten video-track clips in the SAME order video_files were downloaded.
    clips: list[dict] = []
    for track in timeline.get("tracks", []):
        if track.get("type") == "video":
            for clip in track.get("clips", []):
                if clip.get("source_drive_id"):
                    clips.append(clip)
    clips = clips[: len(video_files)] or [{} for _ in video_files]
    while len(metas) < len(video_files):
        metas.append((0.0, False))
    metas = metas[: len(video_files)]

    vf_norm = (f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
               f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={FPS},format=yuv420p")

    # ── Fast path: a single VIDEO clip + NO audio/text → byte-identical ───────
    # When audio or text tracks exist we drop into the filter_complex path even
    # for one clip (a single clip can still need an overlaid caption or music).
    if len(video_files) == 1 and not has_audio_tracks and not has_text_tracks:
        dur, has_audio = metas[0]
        ti, to = _clip_bounds(clips[0], dur)
        args: list[str] = []
        if to > ti:
            args += ["-ss", f"{ti:.3f}", "-to", f"{to:.3f}"]
        args += ["-i", str(video_files[0]), "-vf", vf_norm, "-r", str(FPS),
                 "-c:v", "libx264", "-crf", str(CRF), "-preset", "fast", "-pix_fmt", "yuv420p"]
        args += (["-c:a", "aac", "-b:a", "192k"] if has_audio else ["-an"])
        args += ["-movflags", "+faststart", "-y"]
        return args

    # ── Multi-clip (or audio/text-augmented single-clip) path ─────────────────
    inputs: list[str] = []
    for sf in video_files:
        inputs += ["-i", str(sf)]
    next_idx = len(video_files)

    # When a single video clip is forced into the filter path by an audio/text
    # track, the pure seam still needs ≥1 video segment — it handles n==1 fine
    # (all-cuts branch → concat=n=1). Build the video chain via the PURE seam so
    # the multi-clip video graph stays identical to today.
    filters, extra_inputs, seg_durs, next_idx = _build_filter_graph_string(
        clips, metas, video_files, vf_norm, next_idx
    )
    inputs += extra_inputs

    # Capture the index of the video-terminal node emitting [vout] BEFORE the
    # audio branch appends [am*]/[amaster] nodes (which would otherwise leave
    # filters[-1] pointing at the amix node, not the video terminal).
    video_term_idx = next(
        (i for i in range(len(filters) - 1, -1, -1) if "[vout]" in filters[i]),
        len(filters) - 1 if filters else -1,
    )

    # ── R1 AUDIO TRACKS (additive) ────────────────────────────────────────────
    # Each audio clip → input + atrim→asetpts→volume→adelay (+ optional afade),
    # then amix(normalize=0) all audio-clip nodes together with the video track's
    # concatenated audio [aout_base]. NEVER attenuate via amix auto-normalize.
    video_audio_label = "[aout]"
    if has_audio_tracks:
        # Rename the video track's [aout] → [aout_base] ONLY in this branch.
        if filters and filters[-1].endswith("[aout]"):
            filters[-1] = filters[-1][: -len("[aout]")] + "[aout_base]"
        else:
            # all-cuts concat produced "...[vout][aout]" on the same node
            filters[-1] = filters[-1].replace("[vout][aout]", "[vout][aout_base]")
        amix_nodes = ["[aout_base]"]
        for k, (clip, af) in enumerate(zip(audio_track_clips, audio_files)):
            idx = next_idx
            inputs += ["-i", str(af)]
            next_idx += 1
            ti = float(clip.get("trim_in") or 0.0)
            to_raw = clip.get("trim_out")
            to = float(to_raw) if to_raw not in (None, "") else ti + 600.0
            if to <= ti:
                to = ti + 0.05
            vol = float(clip.get("volume") if clip.get("volume") is not None else 1.0)
            vol = max(0.0, min(vol, 2.0))
            start_at = float(clip.get("start_at") or clip.get("startAt") or 0.0)
            delay_ms = max(0, int(round(start_at * 1000)))
            chain = (
                f"[{idx}:a]atrim=start={ti:.3f}:end={to:.3f},asetpts=PTS-STARTPTS,"
                f"volume={vol:.3f},adelay={delay_ms}|{delay_ms},"
                f"aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
            )
            fade_in = clip.get("fade_in") or clip.get("fadeIn")
            if fade_in not in (None, "", 0):
                chain += f",afade=t=in:st=0:d={float(fade_in):.3f}"
            fade_out = clip.get("fade_out") or clip.get("fadeOut")
            if fade_out not in (None, "", 0):
                seg_len = max(0.05, to - ti)
                fo = float(fade_out)
                chain += f",afade=t=out:st={max(0.0, seg_len - fo):.3f}:d={fo:.3f}"
            label = f"[am{k}]"
            filters.append(chain + label)
            amix_nodes.append(label)
        filters.append(
            f"{''.join(amix_nodes)}amix=inputs={len(amix_nodes)}:normalize=0[amaster]"
        )
        audio_master_label = "[amaster]"
    else:
        audio_master_label = video_audio_label

    # ── R2 TEXT / CAPTIONS (additive) ─────────────────────────────────────────
    # DEFAULT: serialize all text clips → subs.srt and burn via subtitles=…
    # ALTERNATE: ≤~10 styled/boxed clips → drawtext-per-clip overlays.
    video_out_label = "[vout]"
    if has_text_tracks:
        styled = [c for c in text_clips if (c.get("style") or {}).get("boxed")
                  or (c.get("style") or {}).get("drawtext")]
        use_drawtext = len(text_clips) <= 10 and len(styled) > 0

        # Rename the video chain's terminal [vout] so we can re-derive [vburn].
        # Target the captured video-terminal node — NOT filters[-1], which the
        # audio branch may have moved past (its [amaster]/[am*] nodes append
        # AFTER the video terminal, so filters[-1] would be the amix node).
        if 0 <= video_term_idx < len(filters):
            node = filters[video_term_idx]
            if node.endswith("[vout]"):
                filters[video_term_idx] = node[: -len("[vout]")] + "[vbase]"
            elif "[vout]" in node:
                # combined "...[vout][aout]" (or "[vout][aout_base]") node
                filters[video_term_idx] = node.replace("[vout]", "[vbase]", 1)
        cur = "[vbase]"

        if use_drawtext:
            for c in text_clips:
                start, end, text = _clip_text_bounds(c)
                style = c.get("style") or {}
                fontfile = _resolve_font(style.get("font"))
                fontsize = int(style.get("font_size") or style.get("fontSize") or 48)
                fontcolor = style.get("color") or style.get("fontcolor") or "white"
                x = style.get("x", "(w-text_w)/2")
                y = style.get("y", "(h-text_h)-60")
                boxcolor = style.get("box_color") or style.get("boxcolor") or "black@0.5"
                dt = (
                    f"drawtext=fontfile='{fontfile}':"
                    f"text='{_escape_drawtext(text)}':"
                    f"x={x}:y={y}:fontsize={fontsize}:fontcolor={fontcolor}:"
                    f"box=1:boxcolor={boxcolor}:"
                    f"enable='between(t,{start:.3f},{end:.3f})'"
                )
                filters.append(f"{cur}{dt}[vburn_{len(filters)}]")
                cur = f"[vburn_{len(filters) - 1}]"
            filters.append(f"{cur}null[vburn]")
        else:
            # DEFAULT subtitles=…:force_style path
            srt_path = (job_dir / "subs.srt")
            try:
                srt_path.write_text(_build_srt(text_clips), encoding="utf-8")
            except Exception as exc:  # noqa: BLE001
                logger.warning("subs.srt write failed: %s", exc)
            gstyle = (text_clips[0].get("style") or {}) if text_clips else {}
            font_name = gstyle.get("font") or "DejaVu Sans"
            font_size = int(gstyle.get("font_size") or gstyle.get("fontSize") or 24)
            prim = gstyle.get("primary_colour") or gstyle.get("primaryColour") or "&H00FFFFFF"
            align = _alignment_from_position(gstyle.get("position"))
            srt_str = str(srt_path).replace("\\", "/").replace(":", "\\:")
            force = (f"FontName={font_name},FontSize={font_size},"
                     f"PrimaryColour={prim},Alignment={align}")
            filters.append(
                f"{cur}subtitles='{srt_str}':force_style='{force}'[vburn]"
            )
        video_out_label = "[vburn]"

    # ── Final maps ────────────────────────────────────────────────────────────
    if not has_audio_tracks and not has_text_tracks:
        # R3: byte-identical to today — same filter list, same maps.
        return inputs + [
            "-filter_complex", ";".join(filters),
            "-map", "[vout]", "-map", "[aout]",
            "-c:v", "libx264", "-crf", str(CRF), "-preset", "fast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            "-y",
        ]

    return inputs + [
        "-filter_complex", ";".join(filters),
        "-map", video_out_label, "-map", audio_master_label,
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
            # VIDEO drive ids first (order = filtergraph input order). Then, R1
            # additive: AUDIO-track drive ids appended AFTER all video ids, one
            # per audio clip — _build_filtergraph slices the trailing N src_files
            # back off as the audio inputs (per-track clip→file index map).
            video_drive_ids = []
            for track in timeline.get("tracks", []):
                if track.get("type") == "video":
                    for clip in track.get("clips", []):
                        did = clip.get("source_drive_id")
                        if did:
                            video_drive_ids.append(did)

            audio_drive_ids = []  # R1
            for track in timeline.get("tracks", []):
                if track.get("type") == "audio":
                    for clip in track.get("clips", []):
                        did = clip.get("source_drive_id")
                        if did:
                            audio_drive_ids.append(did)

            drive_ids = video_drive_ids + audio_drive_ids

            # ── Download sources from Google Drive ────────────────────────────
            # Video sources named src_NNN.mp4; audio sources aud_NNN (no ext —
            # ffmpeg sniffs the container). src_files keeps the combined order so
            # the trailing audio entries line up with the timeline's audio clips.
            src_files = []
            n_video = len(video_drive_ids)
            for i, did in enumerate(drive_ids):
                if i < n_video:
                    dest = src_dir / f"src_{i:03d}.mp4"
                else:
                    dest = src_dir / f"aud_{i - n_video:03d}"
                logger.info("render_job %s: downloading Drive file %s", job_id, did)
                await _download_drive_file(did, dest)
                src_files.append(dest)
                pct = 5 + int((i + 1) / max(len(drive_ids), 1) * 30)
                await _sb_patch(client, "render_jobs", job_id, {
                    "progress": pct, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })

            # ── Probe sources (duration + audio presence) ─────────────────────
            # Only VIDEO sources need (duration, has_audio) metas — audio-track
            # sources are handled by their own filter chain, not the video metas.
            metas = []
            for sf in src_files[:n_video]:
                metas.append(await _probe_async(sf))

            await _sb_patch(client, "render_jobs", job_id, {
                "progress": 40, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })

            # ── Build + run ffmpeg ────────────────────────────────────────────
            ffmpeg_args = _build_filtergraph(timeline, src_files, metas, job_dir=job_dir)
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


# ── R3 assertion seam (pure, no I/O) — QA: video-only graph == today's ────────

def assert_video_only_unchanged(timeline: dict, src_files: list, metas: list) -> list:
    """
    Pure regression guard. For a v2 doc with NO audio AND NO text tracks, return
    the exact ffmpeg args _build_filtergraph emits. QA can diff this against a
    golden capture of the pre-R1/R2 builder to prove R3 byte-identity.

    Raises AssertionError if the supplied timeline actually has audio/text tracks
    (so the caller knows the guarantee window doesn't apply to it).
    """
    has_audio = any(t.get("type") == "audio" and t.get("clips")
                    for t in timeline.get("tracks", []))
    has_text = any(t.get("type") == "text" and t.get("clips")
                   for t in timeline.get("tracks", []))
    assert not has_audio and not has_text, (
        "assert_video_only_unchanged called on a doc WITH audio/text tracks"
    )
    # job_dir=None disables the text branch; video-only path is byte-identical.
    return _build_filtergraph(timeline, list(src_files), list(metas), job_dir=None)
