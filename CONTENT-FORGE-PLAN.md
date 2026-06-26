# Implementation Plan: Content Forge

> QA-verified plan — 4 domain agents + 1 adversarial QA pass. Generated 2026-06-26.

---

## What it is

Content Forge is an AI-powered content discovery and hook generation feature built into FootageBrain. It reads already-transcribed footage data from the Hetzner backend, uses Claude Haiku to surface ranked content opportunities (S/A/B/C virality tiers), lets the owner select a topic, then uses Claude Sonnet to expand it into 3 hook versions. The chosen hook attaches to a reel pipeline card and ships to editors.

---

## Layer 0 — Data / Schema

### Migration 0101 — `transcript_clips`

Apply via scoped one-off script (NOT bulk `npm run migrate:apply`). Verify `auth_is_owner()` exists first: `SELECT proname FROM pg_proc WHERE proname='auth_is_owner'`.

```sql
CREATE TABLE public.transcript_clips (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  footage_file_id TEXT        NOT NULL,       -- soft ref to attached_footage_items; NO FK
  filename        TEXT,
  start_time      FLOAT       NOT NULL,
  end_time        FLOAT       NOT NULL,
  transcript_text TEXT        NOT NULL,
  keywords        TEXT[]      NOT NULL DEFAULT '{}',
  topics          TEXT[]      NOT NULL DEFAULT '{}',
  embedding       VECTOR(1536),               -- pgvector confirmed enabled (0039)
  language        TEXT        NOT NULL DEFAULT 'en',
  confidence      FLOAT,
  ingest_run_id   UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transcript_clips_footage_idx    ON public.transcript_clips (footage_file_id);
CREATE INDEX IF NOT EXISTS transcript_clips_topics_gin     ON public.transcript_clips USING GIN (topics);
CREATE INDEX IF NOT EXISTS transcript_clips_keywords_gin   ON public.transcript_clips USING GIN (keywords);
CREATE INDEX IF NOT EXISTS transcript_clips_ingest_run_idx ON public.transcript_clips (ingest_run_id) WHERE ingest_run_id IS NOT NULL;

ALTER TABLE public.transcript_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_transcript_clips"   ON public.transcript_clips FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
CREATE POLICY "owner_write_transcript_clips" ON public.transcript_clips FOR ALL    TO authenticated USING (public.auth_is_owner()) WITH CHECK (public.auth_is_owner());
CREATE POLICY "service_all_transcript_clips" ON public.transcript_clips FOR ALL    TO service_role  USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.transcript_clips;
```

### Migration 0102 — `content_opportunities`

```sql
CREATE TABLE public.content_opportunities (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 TEXT        NOT NULL,
  angle_summary         TEXT,
  country               TEXT        NOT NULL DEFAULT 'global',
  topics                TEXT[]      NOT NULL DEFAULT '{}',
  keywords              TEXT[]      NOT NULL DEFAULT '{}',
  source_clip_ids       UUID[]      NOT NULL DEFAULT '{}',   -- soft refs to transcript_clips.id
  footage_file_ids      TEXT[]      NOT NULL DEFAULT '{}',
  virality_tier         TEXT        NOT NULL DEFAULT 'C' CHECK (virality_tier IN ('S','A','B','C')),
  virality_score        FLOAT       NOT NULL DEFAULT 0.0 CHECK (virality_score >= 0.0 AND virality_score <= 1.0),
  hook_versions         JSONB       NOT NULL DEFAULT '[]',   -- [{version:1, style:"curiosity|controversy|personal_stakes", text:"..."}]
  selected_hook_version INTEGER,                            -- 1|2|3
  selected_by           TEXT        REFERENCES public.people(id) ON DELETE SET NULL,
  selected_at           TIMESTAMPTZ,
  drive_file_id         TEXT,                               -- Google Drive permanent file ID (NOT a URL)
  reel_id               TEXT        REFERENCES public.reels(id) ON DELETE SET NULL,
  sent_to_pipeline_at   TIMESTAMPTZ,
  sent_by               TEXT        REFERENCES public.people(id) ON DELETE SET NULL,
  fact_check_result     JSONB,                              -- {verified:bool, sources:[...], checked_at:iso}
  ig_post_id            TEXT,
  ig_views              INTEGER,
  ig_likes              INTEGER,
  ig_shares             INTEGER,
  ig_saves              INTEGER,
  ig_reach              INTEGER,
  performance_score     FLOAT,
  performance_updated_at TIMESTAMPTZ,
  status                TEXT        NOT NULL DEFAULT 'discovered'
                        CHECK (status IN ('discovered','hook_generated','attached','sent','archived')),
  discovery_run_id      UUID,
  created_by            TEXT        REFERENCES public.people(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FULL unique index (not partial) — required for ON CONFLICT arbiter (ref: 42P10 gotcha)
CREATE UNIQUE INDEX IF NOT EXISTS content_opps_run_country_title_uidx
  ON public.content_opportunities (discovery_run_id, country, title)
  WHERE discovery_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS content_opps_status_idx    ON public.content_opportunities (status);
CREATE INDEX IF NOT EXISTS content_opps_tier_score_idx ON public.content_opportunities (virality_tier, virality_score DESC);
CREATE INDEX IF NOT EXISTS content_opps_country_idx   ON public.content_opportunities (country);
CREATE INDEX IF NOT EXISTS content_opps_reel_idx      ON public.content_opportunities (reel_id) WHERE reel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_opps_perf_idx      ON public.content_opportunities (performance_score DESC) WHERE performance_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_opps_created_idx   ON public.content_opportunities (created_at DESC);

CREATE TRIGGER trg_content_opps_updated_at
  BEFORE UPDATE ON public.content_opportunities
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.content_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_content_opps"   ON public.content_opportunities FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
CREATE POLICY "owner_write_content_opps" ON public.content_opportunities FOR ALL    TO authenticated USING (public.auth_is_owner()) WITH CHECK (public.auth_is_owner());
CREATE POLICY "auth_pick_hook"           ON public.content_opportunities FOR UPDATE TO authenticated
  USING (auth.role() = 'authenticated' AND status NOT IN ('sent','archived'))
  WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "service_all_content_opps" ON public.content_opportunities FOR ALL   TO service_role  USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.content_opportunities;
```

### Migration 0103 — `reels.creative_brief` + `attached_footage_items` Drive columns

```sql
ALTER TABLE public.reels
  ADD COLUMN IF NOT EXISTS creative_brief JSONB;
-- shape: {opportunity_id, selected_hook_version, hook_text, hook_style, forged_by, forged_at, ig_performance}

CREATE INDEX IF NOT EXISTS reels_creative_brief_opp_idx
  ON public.reels ((creative_brief->>'opportunity_id'))
  WHERE creative_brief IS NOT NULL;

ALTER TABLE public.attached_footage_items
  ADD COLUMN IF NOT EXISTS drive_file_id   TEXT,
  ADD COLUMN IF NOT EXISTS link_status     TEXT NOT NULL DEFAULT 'unchecked'
    CHECK (link_status IN ('ok','broken','missing','unchecked')),
  ADD COLUMN IF NOT EXISTS link_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS footage_link_status_idx  ON public.attached_footage_items (link_status);
CREATE INDEX IF NOT EXISTS footage_drive_file_id_idx ON public.attached_footage_items (drive_file_id) WHERE drive_file_id IS NOT NULL;
```

**Apply order:** 0101 → 0102 → 0103. Each is a scoped one-off. Never bulk apply.

---

## Layer 1 — Backend / API

### 1a. `requirements-hosting.txt` — add before Hetzner rebuild

```
anthropic>=0.30.0
```

`google-auth` and `google-api-python-client` are already present.

### 1b. New file: `backend-handoff/content_forge.py`

Lives on Hetzner at `/srv/footagebrain/footage-brain-test/backend/app/api/content_forge.py`.

**Always diff the live file first before SCP:**
```bash
scp root@178.105.14.144:/srv/.../backend/app/api/content_forge.py /tmp/live_content_forge.py
diff --strip-trailing-cr /tmp/live_content_forge.py backend-handoff/content_forge.py
```

Key endpoints:
- `POST /content-forge/ingest-transcript` — reads transcript files, extracts keywords/topics, upserts `transcript_clips`. Fire-and-forget via `BackgroundTasks`.
- `GET /content-forge/ingest-status/{reel_id}` — polls clip count for a reel.
- `POST /content-forge/discover` — Claude Haiku 4.5 batched discovery by country → writes `content_opportunities`. Fire-and-forget, returns `batch_id`.
- `GET /content-forge/discover-status/{batch_id}` — returns opportunities for a batch.
- `POST /content-forge/expand` — Claude Sonnet 4.6 + Tavily grounding → writes `hook_versions` to `content_opportunities`. Synchronous (Sonnet typically <8s).

**Transcript parsing:** Support Whisper JSON (`segments[].{start, end, text}`), SRT, and plain text fallback. **Pre-condition: confirm the actual path and format on Hetzner via SSH before writing the ingest worker.**

**Claude Haiku discovery prompt:** Must be written to >1024 tokens to engage prompt caching (`cache_control: {type: "ephemeral"}`). Pad with virality criteria, hook style examples, and audience-signal guidance.

**Sonnet expansion prompt:** ~180 tokens as designed — below caching threshold. Either pad to >1024 or accept uncached pricing. Recalculate cost model if staying uncached.

**Tavily grounding:** Wraps each expansion call. On 429/quota exceeded, degrades gracefully — mark `fact_check_result: {skipped: true, reason: "quota"}` and continue generating hooks without facts.

### 1c. `api/ai/suggest.js` — fold Content Forge triggers (insert BEFORE line 1269)

```js
// Content Forge — fire-and-forget triggers to Hetzner
if (action === "forge-discover") {
  // POST to Hetzner /content-forge/discover, return batch_id
}
if (action === "forge-expand") {
  // POST to Hetzner /content-forge/expand, synchronous proxy
}
if (action === "forge-ingest") {
  // POST to Hetzner /content-forge/ingest-transcript, fire-and-forget
}
```

### 1d. `api/monitor/status.js` — fold status polling + drive health

```js
if (action === "forge-status") {
  // GET /content-forge/discover-status/:batch_id from Hetzner
}
if (action === "drive-health") {
  // POST to Hetzner /content-forge/drive-health trigger (owner only)
}
```

**Hard constraint: zero new `.js` files under `api/`. 12-function cap is at limit. All Content Forge Vercel surface uses existing files only.**

### 1e. Caddyfile update (human-gated)

```bash
# 1. Pull live Caddyfile
scp root@178.105.14.144:/path/to/Caddyfile ./deploy/hetzner/Caddyfile

# 2. Add block if /api/* is not already a wildcard:
handle /api/content-forge/* {
    reverse_proxy backend:8000
}

# 3. Push back + reload (no image rebuild)
scp ./deploy/hetzner/Caddyfile root@178.105.14.144:/path/to/Caddyfile
docker exec fb-caddy caddy reload --config /etc/caddy/Caddyfile
```

### 1f. IG performance write-back

Append to `ig_webhook.py` (after live diff/merge). Weekly cron reads IG Graph API insights for `content_opportunities` rows with `ig_post_id` set. **Pre-condition: confirm `instagram_manage_insights` is in the stored FB page token's scopes before building this subsystem.**

### 1g. Hetzner cron entries (literal secret values — no $VAR in crontab)

```cron
# Drive link health (weekly Sunday 3 AM)
0 3 * * 0 curl -s -X POST "https://api.footagebrain.com/api/content-forge/drive-health?secret=LITERAL_SECRET" >> /var/log/fb-drive-health.log 2>&1

# Discovery refresh (daily 6 AM — optional, owner can trigger manually)
30 6 * * * curl -s -X POST "https://api.footagebrain.com/api/ai/suggest?action=forge-discover&secret=LITERAL_SECRET" >> /var/log/fb-discover.log 2>&1
```

Verify via `journalctl -u cron`.

---

## Layer 2 — State / Store

- `content-forge.jsx` uses direct Supabase queries (not store.jsx) — same pattern as `scout.jsx`.
- Import: `import { supabase } from '../lib/supabase-client'` (**not** `supabase.js` — that file does not exist).
- `detail.jsx` reads `reel.creative_brief` from the existing reel object — no store change needed.
- Supabase Realtime subscriptions on `content_opportunities` for live discovery updates (optional v1 — list can also poll on tab focus).

---

## Layer 3 — UI / Components

### New files:
- `src/pages/content-forge.jsx` — main page
- `src/content-forge.css` — scoped styles using existing CSS vars (`--c-cyan`, `--bg-2`, `--fg`, `--f-sans`); NO hardcoded hex except S-tier gold; never touches `styles.css`

### Modified files:
- `src/app.jsx` — 5 insertion points (import, lazy load, VIEW_ORDER, ROLE_VIEWS/TAB_LABELS, route switch)
- `src/components/detail.jsx` — add creative_brief hook tracking section (file is 1,929 lines; surgical insert only)
- `src/pages/coverage.jsx` — add `FootageStatusBadge` + `RelinkModal` per clip row

### Auth pattern (QA-verified):
```js
// CORRECT
import { useIsOwner } from '../lib/permissions'
const isOwner = useIsOwner()

// WRONG (will silently return undefined)
// const { isOwner } = useWorkflow()
```

### Discovery list:
- Tier badges: S=gold, A=cyan (`--c-cyan`), B=blue, C=muted
- Sort: Virality ↓ (default) / Newest / Performance
- Filter: tier multi-select pills + country
- Footage status badge per card: ✓ linked / ⚠ missing / ✗ broken (broken is clickable → RelinkModal)

### ForgeModal:
- Portaled to `document.body` (avoids overflow clip — ref: `reference_portal-escape-overflow-clip.md`)
- 3 columns: Curiosity Gap / Controversy / Personal Stakes
- Each column: editable textarea + Select button
- If Claude returns < 3 hooks: show skeleton/error state per column (don't assume always 3)
- Footage attach: paste Drive URL → extract file ID via regex `(/d/|id=)([-\w]{25,})` → store file ID (not URL)
- "Send to Pipeline": validates `selectedHook !== null` + `targetReelId !== null` before submitting

### URL → Drive file ID extraction (owned by frontend on paste):
```js
const extractFileId = (url) =>
  /(?:\/d\/|[?&]id=)([-\w]{25,})/.exec(url)?.[1] ?? url
```
Store the extracted ID, never the raw URL.

### Hook generation polling (if Hetzner is async):
- `POST ?action=forge-expand` → `{job_id, status: "pending"}` or `{hooks: [...]}` if sync
- If pending: poll `GET ?action=forge-status&job_id=...` every 2s, 30s timeout

### detail.jsx creative_brief section:
```jsx
{reel.creative_brief?.selected_hook_version && (
  <div className="cf-hook-tracking">
    <span className="cf-hook-badge">{hookStyleLabel(reel.creative_brief.hook_style)}</span>
    <p>{reel.creative_brief.hook_text}</p>
    {reel.creative_brief.ig_performance && (
      <span>Reach: {reel.creative_brief.ig_performance.reach}</span>
    )}
  </div>
)}
```

---

## Layer 4 — Integration & Deploy

### Environment variables

| Var | Where | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Vercel (already set) + `.env.local` (add if missing) + Hetzner `.env` (add) | Used by both Vercel and Hetzner Python |
| `TAVILY_API_KEY` | Hetzner `.env` ONLY | Never Vercel (10s timeout, keep server-side) |
| `CONTENT_FORGE_SECRET` | Vercel + Hetzner + `.env.local` | `openssl rand -hex 32`; same value everywhere |

### Deployment sequence (strict order)

```
1. [HUMAN] Verify auth_is_owner() exists: SELECT proname FROM pg_proc WHERE proname='auth_is_owner'
2. [HUMAN] Apply migration 0101 (transcript_clips) — verify in table editor
3. [HUMAN] Apply migration 0102 (content_opportunities) — verify in table editor  
4. [HUMAN] Apply migration 0103 (creative_brief + drive columns) — verify in table editor
5. [HUMAN] SSH Hetzner: confirm transcript file path + format (ls /srv/footagebrain/...)
6. [HUMAN] Hetzner .env: add ANTHROPIC_API_KEY, TAVILY_API_KEY, CONTENT_FORGE_SECRET
7. Add 'anthropic>=0.30.0' to backend-handoff/requirements-hosting.txt
8. SCP live ig_webhook.py + content_forge.py (if exists) → diff → merge
9. [HUMAN] Hetzner rebuild: cd /srv/.../deploy/hetzner && docker compose build backend && docker compose up -d --force-recreate backend
10. [HUMAN] Caddyfile: pull live → add handle block if needed → push → caddy reload
11. Verify route: curl -o /dev/null -s -w "%{http_code}" https://api.footagebrain.com/api/content-forge/health (expect 401)
12. [HUMAN] vercel env add CONTENT_FORGE_SECRET; verify ANTHROPIC_API_KEY is set
13. Edit api/ai/suggest.js (insert actions before line 1269) + api/monitor/status.js
14. Edit src/app.jsx (5 insertion points) + content-forge.jsx + content-forge.css
15. npm run build — must pass clean
16. [HUMAN] Visual verify on localhost
17. git status --short — reconcile dirty tree; commit or stash unrelated WIP
18. vercel --prod
19. [HUMAN] Install Hetzner crontab (literal secret values)
```

### Smoke test checklist

- [ ] `/content-forge` route loads, shows empty state "No opportunities yet"
- [ ] Trigger ingest → `transcript_clips` rows appear in Supabase
- [ ] Trigger discover → `content_opportunities` rows appear with tier badges
- [ ] Select opportunity → ForgeModal opens, hooks generate (3 columns populate)
- [ ] Select hook → "Send to Pipeline" enabled → reel card updated with `creative_brief`
- [ ] Coverage tab shows link status badge per clip
- [ ] Broken link badge opens RelinkModal → paste URL → file ID extracted + stored
- [ ] detail.jsx shows hook tracking section on a reel with `creative_brief`
- [ ] Drive health cron: `curl` the endpoint, check `link_status` updates in Supabase

---

## Open Decisions (require owner input before building)

1. **Transcript path on Hetzner** — SSH and confirm before writing the ingest worker. Path and format are assumed; if wrong, ingestion architecture changes.

2. **`instagram_manage_insights` scope** — Check the stored FB page token. If absent, defer the IG performance write-back subsystem entirely.

3. **Hook generation: Hetzner vs Vercel** — Hetzner is recommended (avoids 10s timeout). Vercel `suggest.js` acts as a thin proxy. Confirm this is the chosen architecture before building the expansion endpoint.

4. **Sonnet expansion prompt caching** — Prompt is ~180 tokens, below the 1024-token cache threshold. Either pad the prompt to >1024 tokens or accept uncached pricing (~3x higher per hook). Decide before calculating cost projections.

5. **Cross-run dedup strategy** — Currently, re-running discovery creates new rows for the same angle. Dedup is within-run only. If the owner wants cross-run dedup (same angle = update existing row), the storage model needs a stable `angle_fingerprint` column.

---

## QA Sign-off

**Assumptions validated:**
- `auth_is_owner()` confirmed exists (migration 0076)
- `set_updated_at()` confirmed exists (migration 0001)
- pgvector confirmed enabled (migration 0039)
- reels.id is TEXT (migration 0001)
- `src/lib/supabase-client.js` is the correct import path
- `useIsOwner()` from `src/lib/permissions.jsx` is the correct owner hook
- `suggest.js` 400-guard is at line 1269 — new actions insert before it
- Migration 0100 exists; Content Forge starts at 0101
- `google-auth` + `google-api-python-client` already in `requirements-hosting.txt`
- `anthropic` Python SDK NOT in `requirements-hosting.txt` — must add

**Known risks (accepted):**
- Transcript path/format unverified until SSH — ingest worker may need adjustment
- Sonnet expansion prompt below cache threshold — cost higher than initial estimate
- IG writeback depends on `instagram_manage_insights` scope — may need to defer
- Tavily free tier (1000 req/month) — add quota-exceeded graceful fallback

**Suggested build order:**
1. Migrations 0101–0103 (foundation)
2. `requirements-hosting.txt` + `content_forge.py` skeleton (Hetzner)
3. Discovery list UI + empty state (Frontend)
4. Haiku discovery endpoint (Hetzner)
5. ForgeModal + Sonnet expansion (Frontend + Hetzner)
6. Coverage tab health layer (Frontend)
7. Send to Pipeline + detail.jsx creative_brief (Frontend)
8. Drive health cron (Hetzner)
9. IG performance write-back (Hetzner — after confirming insights scope)
