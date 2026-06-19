# Deploy checklist — Reel DNA **Phase 1** (Reel MVP: downloadable asset layers + cut-pacing)

Goal: flip a Reel DNA capture's **format = short** (the DB default) and click **Analyze** →
the Hetzner worker acquires the reel (manual-upload-first, yt-dlp fallback), extracts
audio, detects cuts with PySceneDetect, dumps keyframes, computes pacing math, and writes
two new jsonb columns — **`asset_manifest`** (the downloadable layer index) and
**`pacing`** (ASL / median shot / cuts-per-sec / rhythm). In the app the reel card then
shows the **Assets section** (owner-signed downloads via `/fb/reels/...`) and the
**PacingSparkline**.

This is **Phase 1**. It reuses the Phase-0 longform spine (`reel_deconstruct.py` worker,
the `?action=deconstruct` proxy in `api/ai/suggest.js`, the `media_status='pending_analyze'`
sentinel, the status-guarded atomic claim). Phase 0 must already be deployed — see
`REEL-DECONSTRUCT-DEPLOY.md`. This doc covers ONLY the Phase-1 delta.

> **Everything in this runbook is HUMAN-GATED.** The Phase-1 workflow produced *code + this
> doc only*. Claude did NOT scp anything to Hetzner, did NOT install pip deps, did NOT set
> any env var, did NOT register any route, did NOT build/restart the worker, did NOT apply
> migration `0081`, and did NOT run `vercel --prod` or `git push`. Perform the 🔴/🟡 steps
> below **in order**, by hand.

Legend: 🟢 safe/idempotent · 🟡 touches the shared prod Supabase DB · 🔴 secret / live deploy / external config

---

## What ships with the app (no manual step — already in the build)

These are pure code, no infra. They go live with the next `vercel --prod` (step 7):

| File | Phase-1 change |
|---|---|
| `supabase/migrations/0081_reel_dna_assets_pacing.sql` | NEW — `ADD COLUMN IF NOT EXISTS asset_manifest jsonb, pacing jsonb` (additive, nullable, no RLS). Apply = step 6 (🟡). |
| `src/store/store.jsx` | `asset_manifest`/`pacing` wired through all **three** mappers (`reelDnaFromDb` hydrate, `reelDnaToDb` conditional-emit allow-list, `persistUpdateReelDna` remap); `analyzeReelDna` reel branch reuses `media_status='pending_analyze'`. |
| `api/ai/suggest.js` | `?action=sign-download` (HMAC minter, demo-gated). **NO new file** — folded in to keep the Vercel function count at 12/12. |
| `vercel.json` | one `headers` entry: `Content-Disposition: attachment` for `/fb/reels/:path*`. |
| `src/components/reel-assets-auto.jsx` | NEW — renders `item.assetManifest` (signed downloads). |
| `src/components/pacing-sparkline.jsx` | NEW — renders `item.pacing` as an SVG curve + label strip. |
| `src/components/unified-dna-card.jsx` | reel Assets section + PacingSparkline, branch `format==='short'`. |
| `backend-handoff/reel_deconstruct.py` | reel branch — **see step 1, this is the part that must be MERGED into the live Hetzner copy, NOT blind-overwritten.** |

---

## ⚠️ 0. Sanity gates BEFORE touching prod 🟢

Run these locally on the `feat/reel-dna-phase1` branch first:

```bash
# (a) Vercel function cap MUST still be 12 — a 13th api/*.js fails the deploy.
find api -name '*.js' -not -name '_*' | wc -l        # → must print 12

# (b) sign-download must parse.
node --check api/ai/suggest.js

# (c) No contaminant tokens carried in (the parking branch co-mingles 3 threads).
git diff clean/prod-baseline-2026-06-19...feat/reel-dna-phase1 \
  | grep -E 'group_id|groupReels|ungroupReels|contentTypeFromPlatform|0080_reel_group_id' \
  && echo 'CONTAMINATED — STOP' || echo 'clean'

# (d) Full build gate (run once, by the integration-QA step — NOT in parallel agents).
npm run build
```

If (a) is not 12, or (c) prints `CONTAMINATED`, **stop** — do not deploy.

---

## 1. Merge the reel branch into the LIVE worker — scp DOWN first, never blind-overwrite 🔴

`backend-handoff/reel_deconstruct.py` in this repo is a **STALE SNAPSHOT**. The live
Hetzner copy may be **ahead** (Phase 0 went live there; the snapshot can lag features such
as the 0079 columns / narrative provider seam). **Blind-overwriting reverts live features.**

```bash
# (a) Pull the LIVE file down to a scratch path.
scp root@178.105.14.144:/srv/footagebrain/footage-brain-test/backend/app/api/reel_deconstruct.py \
    /tmp/reel_deconstruct.LIVE.py

# (b) Diff against this repo's snapshot, STRIPPING CR — the snapshot is CRLF on Windows,
#     the live file is LF; a naive diff shows every line changed.
diff --strip-trailing-cr /tmp/reel_deconstruct.LIVE.py \
    backend-handoff/reel_deconstruct.py | less
```

(c) **MERGE by hand:** keep everything the LIVE file has, and add ONLY the Phase-1 reel
delta from this repo's snapshot:

- the **reel branch** of the claim loop (after the atomic status-guarded claim, read
  `row['format']`; `format` in `('short', None)` → reel path, `'long'` → existing longform
  path — H6, the `media_status='pending_analyze'` sentinel is **shared**, no new status);
- **acquisition** (manual-upload-first: if a pre-uploaded `base.mp4` already exists under
  `<DATA_DIR>/reels/<id>/`, use it; else `yt-dlp` the source URL; on failure set
  `media_status='acquire_failed'` + `media_error` so the UI shows an "upload the file" CTA —
  acquisition is the biggest reliability risk, so the reliable backbone is manual upload);
- **ffmpeg** audio extraction → `audio.mp3` (may be absent — reels can be silent → `audio:null`);
- **PySceneDetect** `ContentDetector(threshold=27.0)` → `scenes.csv`; `<1` detected scene →
  synthesize ONE shot `[0, total_duration]`;
- **keyframes** — one JPG per cut (`cut_0.jpg`, `cut_1.jpg`, …);
- **pacing math** (H4, exact — see the formula block below);
- writes **`asset_manifest`** (H3) + **`pacing`** (H4) jsonb via the existing `_patch_row`
  service-role write, plus `media_status='analyzed'`, `progress=100`, `analyzed_at`;
- **media-RETAIN**: do NOT delete `<DATA_DIR>/reels/<id>/` after analyze — the assets are
  what the signed-download route serves. (Phase 2 adds purge; Phase 1 keeps them.)
- the **HMAC validator** for `/fb/reels/<id>/<file>` (H1 — see step 4).

> The `format` disambiguation happens **AFTER** the atomic claim (H6). The claim still
> selects `media_status=eq.pending_analyze` only — it is **not** reel-specific. The
> `?action=deconstruct` proxy flow is unchanged and must NOT assume a separate reel claim
> value.

### Pacing math (H4 — must match `pacing-sparkline.jsx`'s consumed shape exactly)

From `scenes.csv` shots (start/end in **seconds**):

```
shot_durations[i] = end_i - start_i
shot_count        = len(shots)
total_duration    = max(end) - min(start)
asl               = total_duration / shot_count          # guard shot_count>0 AND total_duration>0
median_shot       = median(shot_durations)
cuts_per_sec      = (shot_count - 1) / total_duration     # guard total>0 else 0
rhythm_label      = 'frenetic' if asl<1.0 else 'punchy' if asl<=2.0 else 'steady' if asl<=4.0 else 'languid'
front_loaded      = mean(first_third) < mean(last_third)*0.8   # guard len>=3 else False
pacing_curve      = shot_durations                         # raw list; UI caps render length
detector          = 'ContentDetector'
threshold         = 27.0
computed_at       = ISO-8601 UTC
```

### Frozen jsonb shapes (H3 / H4 — `file` values are BARE names, `base_dir` has NO `/fb/`)

```jsonc
// asset_manifest (H3)
{
  "base_video": { "file": "base.mp4",  "bytes": 0, "duration": 0 },
  "audio":      { "file": "audio.mp3", "bytes": 0 },           // or null if extraction failed
  "keyframes":  [ { "file": "cut_0.jpg", "cutIndex": 0, "ts": 0.0 } ],
  "scenes":     { "file": "scenes.csv", "shotCount": 0 },
  "base_dir":   "reels/<id>",                                  // NO /fb/ prefix
  "version":    1
}

// pacing (H4)
{
  "asl": 0, "median_shot": 0, "cuts_per_sec": 0, "shot_count": 0,
  "total_duration": 0, "rhythm_label": "steady", "front_loaded": false,
  "pacing_curve": [], "detector": "ContentDetector", "threshold": 27.0,
  "computed_at": "1970-01-01T00:00:00Z"
}
```

---

## 2. Install PySceneDetect into the worker image 🔴

The reel branch imports **scenedetect** (with OpenCV). Add to the backend image
(`deploy/hetzner/` Dockerfile or build step), alongside the existing ffmpeg/yt-dlp lines
from Phase 0:

```dockerfile
# Phase 1: cut detection. OpenCV pulls libGL — install the runtime lib too.
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "scenedetect[opencv]"
```

Notes:
- `ffmpeg` + `yt-dlp` are already installed from the Phase-0 deploy — do NOT remove them.
- `scenedetect[opencv]` pulls `opencv-python`, which needs `libgl1` at runtime; without it
  `import cv2` fails with `libGL.so.1: cannot open shared object file`.

---

## 3. Set the signing secret + IG cookie path on Hetzner 🔴

The worker validates download HMACs and (for some reels) needs an IG/yt-dlp cookie file to
acquire the source. Append to `deploy/hetzner/.env`:

```
FB_DOWNLOAD_SIGNING_SECRET=<pick a long random string>   # MUST byte-match the Vercel value (step 6)
# optional — only if yt-dlp needs authenticated access to acquire some reels:
# YTDLP_COOKIES=/app/data/cookies/ig_cookies.txt
```

Then add matching passthroughs under the backend service's `environment:` in
`deploy/hetzner/docker-compose.yml` (this stack maps vars individually — `.env` alone is
NOT enough; same lesson as Phase 0):

```yaml
      - FB_DOWNLOAD_SIGNING_SECRET=${FB_DOWNLOAD_SIGNING_SECRET}
      - YTDLP_COOKIES=${YTDLP_COOKIES}
```

> `FB_DOWNLOAD_SIGNING_SECRET` is the **shared env var name on BOTH sides** (Vercel minter +
> Hetzner validator). The two values must be **byte-identical** or every signed download
> 403s. Verify with the parity vector in step 8 BEFORE trusting any download.

---

## 4. Register the `/fb/reels` serving route on Hetzner 🔴

The signed URL `/fb/reels/<id>/<file>?t=<hmac>&exp=<exp>` is rewritten by Vercel to
`https://api.footagebrain.com/reels/<id>/<file>?t=&exp=` (the existing `/fb/:path*` rewrite
in `vercel.json` is UNCHANGED — H7). The backend must serve `/reels/...`, validate the
HMAC, and return the file.

**Register BOTH routers** in `backend/app/main.py`. Phase 1 adds a SECOND router
(`serve_router`) with **NO prefix** so `GET /reels/<id>/<file>` resolves at the app root
(the rewrite strips `/fb/`). Mirror how `ig_webhook.py` is registered:

```python
from app.api import reel_deconstruct
app.include_router(reel_deconstruct.router, prefix="/api")   # Phase 0: /api/reel/deconstruct + /api/reel/status
app.include_router(reel_deconstruct.serve_router)            # Phase 1: /reels/<id>/<file>  (NO prefix)
```

> If your stack bakes `/api` into EVERY route globally, register the serve router with
> `prefix="/api"` and point the nginx `location` below at `/api/reels/` to match.

Then point caddy/nginx at the worker's validator route (the worker's `FileResponse` ALSO
sets `Content-Disposition: attachment` for defense-in-depth):

```nginx
# nginx example — pass /reels/* to the FastAPI worker, which HMAC-validates then FileResponses.
location /reels/ {
    proxy_pass http://127.0.0.1:8000;   # port 8000 is in-container; reach via the caddy domain or docker exec
    proxy_set_header Host $host;
}
```

The worker route reconstructs the **bare** message `reels/<id>/<file>:<exp>` (NO `/fb/`, NO
leading slash, NO query string), recomputes the HMAC with
`FB_DOWNLOAD_SIGNING_SECRET`, compares constant-time (`hmac.compare_digest`), and rejects
with **403** if `int(time.time()) > exp` or the digest mismatches (H1).

> nginx fronts api.footagebrain.com with a 60s timeout. Asset downloads are real files
> (small), so a synchronous GET is fine here — unlike the analyze pipeline, which stays
> fire-and-forget + poll.

---

## 5. Rebuild + restart the worker, verify the in-container hash 🔴

```bash
cd /srv/footagebrain/footage-brain-test/deploy/hetzner
docker compose build backend
docker compose up -d backend      # up -d, NOT restart (restart keeps stale env)
sleep 30
```

**Verify the merged file is the one running** (code is BAKED into the image, not volume-mounted):

```bash
# sha of the file you merged on the host:
sha256sum /srv/footagebrain/footage-brain-test/backend/app/api/reel_deconstruct.py
# sha INSIDE the running container — must MATCH the above:
docker compose exec backend sha256sum /app/app/api/reel_deconstruct.py
# readiness:
curl -s https://api.footagebrain.com/api/reel/status   # → {"ok":true, ...}
```

If the two shas differ, the build used a stale layer — `docker compose build --no-cache backend`.
If the container won't start: `docker compose logs backend` and fix before retrying.

---

## 6. Apply migration `0081` 🟡

```bash
npm run migrate:apply     # HUMAN-GATED — touches the shared prod Supabase DB
```

`0081_reel_dna_assets_pacing.sql` is **idempotent + additive**: `ADD COLUMN IF NOT EXISTS
asset_manifest jsonb`, `ADD COLUMN IF NOT EXISTS pacing jsonb` — both nullable, **no RLS
change**. The worker writes them via the existing service-role policy. Apply this **before**
the first analyze, or every claim PATCH 400s on the unknown columns.

> Migration number is **`0081`**, NOT `0080` — `0080` is reserved for the deferred
> reel-grouping (connecting-lines) thread that is intentionally NOT in this branch.

---

## 7. Ship the Vercel half 🔴

```bash
vercel --prod
```

Ships `?action=sign-download` (`api/ai/suggest.js`), the `vercel.json` `/fb/reels`
attachment header, the store mapper wiring, and the UI (`reel-assets-auto.jsx`,
`pacing-sparkline.jsx`, the reel section in `unified-dna-card.jsx`).

> `vercel --prod` ships the **ENTIRE working tree**. Run `git status` first; stash/flag any
> unrelated dirty work (the grid-view + doc drift on this tree is unrelated) so it doesn't
> go live. The function count must still be 12 (step 0a) or the deploy fails.

Also set the matching secret on the platform (Vercel env ≠ `.env.local`):

```bash
vercel env add FB_DOWNLOAD_SIGNING_SECRET production   # paste the SAME value as step 3
# then add it to .env.local too, and re-run vercel --prod.
```

---

## 8. ✅ H1 HMAC PARITY VECTOR — verify byte-parity BEFORE trusting downloads 🟢

The JS minter (`api/ai/suggest.js`) and the Python validator (`reel_deconstruct.py`) MUST
produce a **byte-for-byte identical** HMAC for the same input, or signed downloads silently
403. Use this **fixed** vector (a real, throwaway secret — never use it in prod):

| field | value |
|---|---|
| secret | `test-secret-do-not-use` |
| id | `abc123` |
| file | `base.mp4` |
| exp | `1750000000` |
| **message** | **`reels/abc123/base.mp4:1750000000`** (no `/fb/`, no leading slash, no query) |
| **expected hex** | **`34010c33a5c4f94662bffd07e4aefd34823eaaf0cd7f311e9b8931dbc6a72215`** |

**JS side** (Node):
```bash
node -e "const c=require('crypto');console.log(c.createHmac('sha256','test-secret-do-not-use').update('reels/abc123/base.mp4:1750000000').digest('hex'))"
# → 34010c33a5c4f94662bffd07e4aefd34823eaaf0cd7f311e9b8931dbc6a72215
```

**Python side** (inside the worker container):
```bash
docker compose exec backend python -c "import hmac,hashlib;print(hmac.new(b'test-secret-do-not-use', b'reels/abc123/base.mp4:1750000000', hashlib.sha256).hexdigest())"
# → 34010c33a5c4f94662bffd07e4aefd34823eaaf0cd7f311e9b8931dbc6a72215
```

Both lines MUST print `34010c33a5c4f94662bffd07e4aefd34823eaaf0cd7f311e9b8931dbc6a72215`.
If they differ, the message construction has drifted (a stray `/fb/`, a leading slash, ms
vs seconds in `exp`, or a non-UTF-8 secret) — fix before going further.

> Production uses `exp = Math.floor(Date.now()/1000)+300` (unix **seconds**, 300s TTL) and
> the real `FB_DOWNLOAD_SIGNING_SECRET`. The fixed `exp=1750000000` above is only to make
> the digest reproducible for this parity check.

---

## 9. Calibrate with ONE real reel 🟡 (the make-or-break test)

1. In the app, open a Reel DNA capture of a **reel** (`format='short'`, the default), click
   **Analyze** (store flips `media_status='pending_analyze'`). The `*/2` Phase-0 drain cron
   claims it, or click **Analyze** for an instant claim.
2. Watch it run:
   ```bash
   docker compose logs backend --tail=80 | grep reel_deconstruct
   # acquiring → extracting audio → detecting cuts (N shots) → keyframes → pacing → analyzed
   ```
3. In the dashboard the reel card's **Assets section** renders the signed download links
   (`base.mp4` / `audio.mp3` / `cut_N.jpg` / `scenes.csv`) and the **PacingSparkline** (ASL,
   median shot, cuts/sec, rhythm chip, front-loaded badge). Click a download — it should
   stream the file as an attachment (the `/fb/reels` Content-Disposition header).

**Failure paths are observable and safe:**
- **Acquisition failed** → `media_status='acquire_failed'` + `media_error`; the UI shows an
  "upload the file" CTA. Drop a `base.mp4` under `<DATA_DIR>/reels/<id>/` and re-analyze —
  the worker uses the pre-uploaded file (manual-upload-first), skipping yt-dlp.
- **Any pipeline exception** → caught, recorded as `analyze_failed`, endpoint still 200s.
  The temp dir for that id is retained (Phase 1 keeps media), and the rest of the queue is
  unaffected. Per-row isolation — one bad reel never poisons the queue.
- **Signed download 403** → the secret doesn't byte-match (re-run step 8) or `exp` elapsed
  (links are 300s TTL — the URL is freshly minted per click, so just retry).

---

## Notes / gotchas (Phase-1-specific)

- **Three-mapper trap** — `asset_manifest`/`pacing` had to be added to ALL THREE `store.jsx`
  mappers (`reelDnaFromDb` explicit hydrate, `reelDnaToDb` conditional-emit allow-list,
  `persistUpdateReelDna` remap). `reelDnaToDb` is a **no-spread allow-list** and emits the
  two only when present, so capture-form inserts keep the NULL DB defaults (H5).
- **Shared sentinel** — reels reuse `media_status='pending_analyze'` (H6). There is NO
  reel-specific claim value. The worker disambiguates reel vs longform by `row['format']`
  AFTER the atomic claim. Do NOT add a new status.
- **Vercel 12/12 cap** — `sign-download` is folded into `api/ai/suggest.js` (`?action=`),
  NOT a new `api/*.js`. A 13th function fails the deploy. Keep the count at 12 (step 0a).
- **Demo gate** — `?action=sign-download` calls `classifyCaller` (`api/admin/_auth.js`,
  async) and 403s demo callers, so demo accounts can't mint download URLs.
- **HMAC message is BARE** — `reels/<id>/<file>:<exp>`. The `/fb/` prefix exists ONLY in the
  returned URL (H2), never in the signed message. `id` and `file` must each match
  `^[A-Za-z0-9._-]+$` (rejects `/`, `\`, traversal); the UI sends the bare `file` name
  because `asset_manifest.base_dir` already = `reels/<id>`.
- **Media is RETAINED** — Phase 1 does NOT purge `<DATA_DIR>/reels/<id>/` after analyze;
  those files are what the download route serves. Phase 2 adds zip/purge.
- **`reel-assets-auto.jsx` ≠ `reel-assets.jsx`** — the auto manifest renderer is a separate,
  props-driven component (H8). It does NOT touch the manual `reel_dna_assets` join table.
