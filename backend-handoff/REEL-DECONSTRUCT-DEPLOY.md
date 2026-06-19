# Deploy checklist — Longform YouTube → Reel DNA narrative worker

Goal: flip a Reel DNA capture to **format = long** and click **Analyze** in the app →
within ~1 minute the **Story panel** renders the LLM's deconstruction (hook, arc, open
loops, emotion curve, retention flags, payoff/CTA, 0–100 scorecard).

The Vercel half (the `?action=deconstruct` proxy in `api/ai/suggest.js`, the
`analyzeReelDna` store action, the Story panel UI) ships with the app. What remains is
the **Hetzner backend worker** (`reel_deconstruct.py`) + its env + system deps + cron.
Claude did NOT perform the 🔴/🟡 steps — do them in order.

Legend: 🟢 safe/idempotent · 🟡 touches shared prod DB · 🔴 secret / live deploy / external config

---

## 0. Migration 0079 must be applied first 🟡

The worker writes the C1 columns added by **migration `0079_reel_dna_longform.sql`**:
`format, media_status, source_url_resolved, narrative, progress, media_error,
analyzed_at` (+ `reel_dna_media_status_idx`). Apply it to the shared Supabase DB
(`/update-migrations` or owner-run) **before** the first analyze, or every claim PATCH
400s on the unknown columns. The worker only INSERT/UPDATEs `reel_dna` via the service
role (the existing `service`-role write policy already covers it).

---

## 1. Install system deps in the backend container 🔴

The worker shells out to **yt-dlp** + **ffmpeg**, and imports **faster-whisper** (only
when a video has no native captions). Add to the backend image (`deploy/hetzner/`
Dockerfile or the build step):

```dockerfile
# system: ffmpeg for audio extraction; yt-dlp via pip (newest, self-updating binary)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "yt-dlp>=2024.0.0" "faster-whisper>=1.0.0"
```

Notes:
- `faster-whisper` pulls **CTranslate2**; the `small` int8 CPU model (~0.5 GB) downloads
  on first use into the container's HF cache. To avoid re-downloads across rebuilds,
  optionally mount a cache volume (`HF_HOME=/app/data/hf`) — not required.
- If you want a **captions-only** deployment (no whisper, smaller image), skip the
  `faster-whisper` pip line. The worker degrades gracefully: a video with no captions
  then lands in `analyze_failed` with `media_error="faster-whisper not installed…"`
  instead of transcribing — the queue is NOT poisoned.
- `httpx` is already a backend dep (facebook.py / ig_webhook.py use it). No new HTTP dep.

---

## 2. Copy the worker to Hetzner + register the router 🔴

```
backend-handoff/reel_deconstruct.py  →  /srv/footagebrain/footage-brain-test/backend/app/api/reel_deconstruct.py
```

Register it **exactly the way `ig_webhook.py` / `facebook.py` are registered** in
`backend/app/main.py`:

```python
from app.api import reel_deconstruct
app.include_router(reel_deconstruct.router, prefix="/api")   # → /api/reel/...
```

The router declares `prefix="/reel"`, assuming `/api` is added at registration (the
common pattern, same as `ig_webhook.py`). If the other routers bake `/api` into their
own prefix instead, change the prefix in `reel_deconstruct.py` to `/api/reel`.

The full live paths must resolve to:
- `POST /api/reel/deconstruct`   (claim + analyze one row)
- `GET  /api/reel/status`        (readiness smoke test)

---

## 3. Set backend env vars on Hetzner 🔴

Append to `deploy/hetzner/.env`:

```
REEL_DECONSTRUCT_SECRET=<pick a long random string>   # also set in Vercel (see step 6)
OPENROUTER_API_KEY=<your free OpenRouter key>
FEATURE_REEL_DECONSTRUCT=1                             # enable the pipeline
# optional:
# REEL_DECONSTRUCT_MODEL=google/gemini-2.0-flash-exp:free   # override the default free model
# DATA_DIR=/app/data/reel_dna                                # default is /tmp/reel_dna
```

`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are already passed to the backend (the
IG/WhatsApp routers use them) — confirm they're present.

Then add matching passthroughs under the backend service's `environment:` in
`deploy/hetzner/docker-compose.yml` (this stack maps vars individually — `.env` alone is
NOT enough; see the FB_SCOPES lesson in CHANGELOG):

```yaml
      - REEL_DECONSTRUCT_SECRET=${REEL_DECONSTRUCT_SECRET}
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
      - FEATURE_REEL_DECONSTRUCT=${FEATURE_REEL_DECONSTRUCT}
      - REEL_DECONSTRUCT_MODEL=${REEL_DECONSTRUCT_MODEL}
      - DATA_DIR=${DATA_DIR}
```

### Env var reference (all read from environment — nothing hardcoded)

| Var | Required | Purpose |
|---|---|---|
| `REEL_DECONSTRUCT_SECRET` | ✅ | Gates `?secret=` on the endpoint (401 otherwise). Must match the Vercel proxy value. |
| `SUPABASE_URL` | ✅ | Supabase project URL for the service-role REST writes. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service role key (server-side only). |
| `OPENROUTER_API_KEY` | ✅ | Free-tier OpenRouter key for the single narrative pass. |
| `FEATURE_REEL_DECONSTRUCT` | ⛔ default OFF | `"1"` enables the pipeline; off = endpoint acks `{ok,claimed:0,disabled:true}` and does nothing. |
| `REEL_DECONSTRUCT_MODEL` | ⛔ optional | Override the default free model id. |
| `DATA_DIR` | ⛔ optional | Base temp dir for per-id audio/captions; default `/tmp/reel_dna`. |

---

## 4. Rebuild + restart the backend 🔴

```bash
cd /srv/footagebrain/footage-brain-test/deploy/hetzner
docker compose build backend
docker compose up -d backend      # up -d, NOT restart (restart keeps stale env)
sleep 30
```

**Verify:**
```bash
curl -s https://api.footagebrain.com/api/reel/status
# → {"ok":true,"feature_enabled":true,"secret_set":true,"openrouter_set":true,
#    "model":"google/gemini-2.0-flash-exp:free","data_dir":"/tmp/reel_dna",
#    "supabase_configured":true}
```
If the container won't start: `docker compose logs backend` and fix before retrying.

---

## 5. Add the drain cron 🔴

So queued rows analyze even without a manual click (mirrors the IG/RSS cron-curl
pattern). On Hetzner (`crontab -e`), with `REEL_DECONSTRUCT_SECRET` exported in the
cron environment or inlined:

```
*/2 * * * * curl -s -X POST "https://api.footagebrain.com/api/reel/deconstruct?secret=$REEL_DECONSTRUCT_SECRET" >/dev/null
```

Each run claims **one** row (concurrency=1, status-guarded claim) and returns
immediately (`{ok,claimed,started}`) while the multi-minute pipeline finishes in the
background — so `curl` does NOT hold the connection open for the whole analysis
(mirrors ig_webhook `/sync`). With overlapping crons two runs can never grab the same
row — the loser's guarded PATCH matches 0 rows. To drain a backlog faster, the owner
clicks **Analyze** (instant) or temporarily lowers the interval. Use
`journalctl -u cron` (NOT `/var/log/syslog`) to check the cron — syslog lags on this
box. For a **synchronous debug run** (wait for the result inline), add `&wait=1`:
`curl -s -X POST ".../api/reel/deconstruct?secret=$REEL_DECONSTRUCT_SECRET&wait=1"`.

---

## 6. Set the matching secret in Vercel 🔴

The Vercel proxy (`api/ai/suggest.js` `?action=deconstruct`) forwards to this endpoint
with the same secret. Set it on the platform AND in `.env.local` (Vercel env vars ≠
`.env.local`):

```bash
vercel env add REEL_DECONSTRUCT_SECRET production   # paste the SAME value as step 3
# then add it to .env.local too, and `vercel --prod` to ship.
```

---

## 7. Calibrate with ONE real video 🟡 (the make-or-break test)

1. In the app, open a Reel DNA capture of a **YouTube** video, set **format = long**, and
   click **Analyze** (the store flips `media_status='pending_analyze'`). Or for a raw
   backend test, PATCH one row to `format='long', media_status='pending_analyze'` and
   curl the endpoint with `&id=<uuid>`.
2. Watch it run:
   ```bash
   docker compose logs backend --tail=80 | grep reel_deconstruct
   ```
   You'll see the row progress `acquiring → transcribing (N segments, yt_captions|whisper)
   → analyzing → analyzed`.
3. In the dashboard the **Story panel** renders live (Supabase realtime) showing the
   hook, arc, emotion sparkline, scorecard, and retention flags.

**Failure path is observable and safe:** a bad/age-restricted/unavailable URL lands the
row in `media_status='analyze_failed'` with the yt-dlp/LLM stderr tail in `media_error`
(surfaced in the panel). The worker returns 200, the temp dir is cleaned, and the rest
of the queue is unaffected.

---

## Notes / gotchas

- **Atomic claim**: the claim is a status-guarded PATCH
  (`media_status: pending_analyze → analyzing` with the old status pinned in the filter,
  `Prefer: return=representation`). Two concurrent workers → exactly one gets the row
  back; the other sees an empty list and returns `claimed:0`. No advisory lock needed.
- **`timeline` is never written.** This worker only writes `media_status`, `progress`,
  `narrative`, `media_error`, `analyzed_at`, `source_url_resolved`. `_patch_row` even
  defensively drops any `timeline` key. The human `timeline` editor
  (`src/pages/reel-deconstructor.jsx`) owns that column.
- **Provider seam**: `run_narrative(segments, *, model)` is the ONLY place the LLM
  provider is chosen (free OpenRouter today). To use Claude later, branch on `model`
  inside that function and call the Anthropic Messages API — nothing else changes.
- **Captions first, whisper fallback**: native YouTube auto-captions are FREE and fast;
  whisper (`small`, int8, CPU) only runs when a video has none. `narrative.transcript_source`
  records which path produced the transcript.
- **Costs**: audio-only + native captions keeps yt-dlp downloads small and the LLM pass
  on the free tier. Whisper is CPU-bound — long videos with no captions take longer (the
  `*/2` cron tolerates this since each run does one row).
- **Per-row isolation**: any exception inside the pipeline is caught, recorded as
  `analyze_failed`, and the endpoint still returns 200 — one bad row never poisons the
  queue or crashes the worker.
