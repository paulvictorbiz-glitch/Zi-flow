# Deploy checklist — News Monitor (RSS poller → `monitor_events`)

Goal: a Hetzner-side cron polls a curated set of RSS feeds (platform algo
channels + world news) every 5–15 min, classifies each item with the same free
OpenRouter chain used by `api/ai/monitor.js`, and upserts into
`public.monitor_events`. The dashboard's Pulse Monitor view reads from
`monitor_events` (vault rows + poller rows in one table, deduped by
`(source_type, external_id)`).

The frontend half + the local vault seed (`scripts/seed-monitor-from-obsidian.mjs`,
`source_type='vault'`) is in this repo. What remains is the Hetzner poller
(`source_type='poller'`) + Meta-style env flags for safe calibration. Claude
did NOT perform the 🔴/🟡 steps — do them in order.

Legend: 🟢 safe/idempotent · 🟡 touches shared prod DB · 🔴 secret / live deploy / external config

---

## 0. Prereq — migration `0059_monitor_events` 🟡
The poller writes into `public.monitor_events`. Apply migration `0059` first:

```bash
npm run migrate              # status check — confirm 0059 listed as [ pending ]
npm run migrate:apply        # runs scripts/migrate.mjs --apply
```

(Per `scripts/migrate.mjs` the bootstrap `supabase/_migration_bootstrap.sql` must
already be pasted into the Supabase SQL editor — that's a one-time prereq for
*any* migration on this project, not specific to this feature.)

The poller is dead in the water until `monitor_events` exists. Do not skip.

Optional but recommended: also run the vault seed locally once so the table
isn't empty when the dashboard first opens the view:
```bash
node --env-file=.env.local scripts/seed-monitor-from-obsidian.mjs           # preview
node --env-file=.env.local scripts/seed-monitor-from-obsidian.mjs --apply   # upsert
```

---

## 1. Drop files into the Hetzner backend repo 🔴
Following the same layout as the IG-DM router (`backend-handoff/IG-DM-DEPLOY.md` §1):

```
backend-handoff/news_monitor_poller.py  →  /srv/footagebrain/footage-brain-test/backend/app/jobs/news_monitor_poller.py
backend-handoff/news-monitor-sources.yaml → /srv/footagebrain/footage-brain-test/backend/config/news-monitor-sources.yaml
```

> The poller file itself is not yet checked into `backend-handoff/` — this doc
> is the spec. A peer agent in the `pulse-monitor` workflow will produce it; this
> doc tells the operator where it must land.

Register it with the existing FastAPI app's in-process APScheduler (the same
scheduler facebook.py's daily insights pull uses). Two intervals:

| Category | Interval | Why |
|---|---|---|
| algo (creator-platform channels) | every 15 min | low velocity, signal-dense |
| news (BBC/Reuters/AP) | every 5 min | high velocity, breaking-news cadence |

Skeleton (mirrors how `facebook.py`'s scheduled jobs are registered):

```python
# backend/app/main.py — after the existing scheduler.add_job(...) calls
from app.jobs.news_monitor_poller import poll_algo, poll_news
scheduler.add_job(poll_algo, "interval", minutes=15, id="news_monitor_algo")
scheduler.add_job(poll_news, "interval", minutes=5,  id="news_monitor_news")
```

`feedparser` + `httpx` are the only new deps; `httpx` is already pinned (IG
webhook uses it), so add `feedparser` to `requirements.txt`.

---

## 2. RSS source config (`config/news-monitor-sources.yaml`) 🟢
Single YAML file, edited via PR — no DB-side source table. The poller reads
this on each tick (cheap; <50 entries) so feed edits don't need a redeploy.

```yaml
# config/news-monitor-sources.yaml
# Frontmatter-style keys map 1:1 onto monitor_events columns.

algo:
  - name: "Instagram @creators blog"
    platform: instagram
    region: global
    severity_default: watch
    url: "https://about.instagram.com/blog/rss"

  - name: "TikTok Newsroom"
    platform: tiktok
    region: global
    severity_default: watch
    url: "https://newsroom.tiktok.com/en-us/rss"

  - name: "YouTube Creator Insider"
    platform: youtube
    region: global
    severity_default: watch
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCGg-UqjRgzhYDPJMr-9HXCg"

  - name: "Meta for Business"
    platform: meta
    region: global
    severity_default: info
    url: "https://www.facebook.com/business/news/rss"

  - name: "X Developer Blog"
    platform: x
    region: global
    severity_default: info
    url: "https://developer.x.com/en/blog.rss"

news:
  - name: "BBC World"
    platform: null
    region: global
    severity_default: info
    url: "http://feeds.bbci.co.uk/news/world/rss.xml"

  - name: "Reuters Top News"
    platform: null
    region: global
    severity_default: info
    url: "https://feeds.reuters.com/reuters/topNews"

  - name: "AP Top News"
    platform: null
    region: global
    severity_default: info
    url: "https://apnews.com/rss"
```

`severity_default` is just the floor — the classifier (§3) can upgrade an item
to `watch` or `high`. It will never downgrade below the per-feed default.

---

## 3. Classifier — OpenRouter free-LLM chain 🟢
Mirror **exactly** the chain used by `api/ai/monitor.js`. Do NOT modify
`api/ai/monitor.js`; copy the constants over. The Python side calls the same
endpoint with the same model list and the same fallback semantics (404/429/503
→ try next model, success → remember and prefer it on subsequent calls).

```python
# backend/app/jobs/news_monitor_poller.py — top of file

OR_MODELS = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "z-ai/glm-4.5-air:free",
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "openai/gpt-oss-120b:free",
    "moonshotai/kimi-k2.6:free",
]

_last_working_model: str | None = None

def _model_order():
    if _last_working_model and _last_working_model in OR_MODELS:
        return [_last_working_model] + [m for m in OR_MODELS if m != _last_working_model]
    return OR_MODELS

async def call_openrouter(key: str, system: str, user_message: str, max_tokens: int = 800) -> str:
    global _last_working_model
    last_err = None
    async with httpx.AsyncClient(timeout=30) as client:
        for model in _model_order():
            try:
                res = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {key}",
                        "Content-Type":  "application/json",
                        "HTTP-Referer":  "https://footagebrain.com",
                        "X-Title":       "FootageBrain News Monitor",
                    },
                    json={
                        "model": model,
                        "reasoning": {"enabled": False},
                        "max_tokens": max_tokens,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user",   "content": user_message},
                        ],
                    },
                )
                if res.status_code in (404, 429, 503):
                    last_err = RuntimeError(f"OR {res.status_code} for {model}")
                    continue
                res.raise_for_status()
                data = res.json()
                text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
                if not text.strip():
                    last_err = RuntimeError(f"OR empty from {model}")
                    continue
                _last_working_model = model
                return text
            except Exception as e:
                last_err = e
    raise last_err or RuntimeError("All OpenRouter free models failed")
```

System prompt — outputs the **exact** enum values used by the schema. Anything
outside the enum is treated as the default by the poller (mirrors the
JS classifier's defensive normalisation):

```python
SYSTEM = """You are a classifier for a video-production team's News Monitor.
For ONE RSS item, return ONLY a JSON object (no markdown, no prose):

{
  "category": "algo" | "news",
  "platform": "instagram" | "tiktok" | "youtube" | "meta" | "x" | null,
  "severity": "info" | "watch" | "high",
  "tags":     ["<tag1>", "<tag2>"],
  "summary":  "<one sentence, <=300 chars>"
}

Rules:
- category=algo  if the item changes how a platform's algorithm, monetisation,
  or creator tools work. Otherwise category=news.
- severity=high  only for blocking changes (account-wide policy shifts, outages,
  breaking world news that affects production scheduling).
- severity=watch for material changes worth a glance.
- severity=info  for routine announcements, FYIs, recap posts.
- tags: 0-3 short kebab-case labels ("reels-ranking", "monetization", etc.).
- platform: only set when the item is about a specific platform; else null.

Return the object only. Start with "{"."""
```

The poller calls `call_openrouter` per item with the RSS title + summary as the
user message, parses the JSON object, and validates `category`/`severity` against
the schema enums before insert (else defaults to `news`/`info`, matching the
seed script's behaviour).

---

## 4. Dedup + upsert 🟢
The schema's partial unique index is the single source of truth for dedup:

```sql
-- from supabase/migrations/0059_monitor_events.sql
unique (source_type, external_id) where external_id is not null
```

Poller uses the RSS `<guid>` (or `<id>` for Atom; fall back to the entry URL)
as `external_id`, with `source_type='poller'`. PostgREST upsert with the
ignore-duplicates header so re-polled feeds are no-ops:

```python
async def upsert_event(sb_url: str, sb_key: str, row: dict) -> None:
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            f"{sb_url}/rest/v1/monitor_events",
            headers={
                "apikey":        sb_key,
                "Authorization": f"Bearer {sb_key}",
                "Content-Type":  "application/json",
                "Prefer":        "resolution=ignore-duplicates,return=minimal",
            },
            params={"on_conflict": "source_type,external_id"},
            json=row,
        )
        res.raise_for_status()
```

The row shape mirrors `seed-monitor-from-obsidian.mjs` (same column set);
only `source_type` (`'poller'` vs `'vault'`) and the source of `external_id`
(`guid` vs vault path) differ.

---

## 5. Backend env vars on Hetzner 🔴
Append to `deploy/hetzner/.env` — mirroring the dual-flag pattern from
`IG-DM-DEPLOY.md:41-43`:

```
SUPABASE_URL=<already set — confirm present>
SUPABASE_SERVICE_ROLE_KEY=<already set — confirm present>
OPENROUTER_API_KEY=<the existing key used by api/ai/monitor.js>
FEATURE_NEWS_MONITOR_DEBUG=1     # calibration ON for first run
FEATURE_NEWS_MONITOR_INGEST=0    # real inserts OFF until calibrated
```

Then add matching passthroughs under the backend service's `environment:`
in `deploy/hetzner/docker-compose.yml` (this stack maps vars individually —
`.env` alone is NOT enough; same FB_SCOPES lesson cited in IG-DM-DEPLOY §2):

```yaml
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
      - FEATURE_NEWS_MONITOR_DEBUG=${FEATURE_NEWS_MONITOR_DEBUG}
      - FEATURE_NEWS_MONITOR_INGEST=${FEATURE_NEWS_MONITOR_INGEST}
```

Rebuild + restart:
```bash
cd /srv/footagebrain/footage-brain-test/deploy/hetzner
docker compose build backend
docker compose up -d backend       # up -d, NOT restart (restart keeps stale env)
sleep 30
```

Smoke check the scheduler picked up the jobs:
```bash
docker compose logs backend --tail=100 | grep news_monitor
# → expect: "Added job 'poll_algo' to job store" and "poll_news ..."
```

---

## 6. Calibration — `FEATURE_NEWS_MONITOR_DEBUG=1` 🟡
With debug ON, the poller still parses every feed entry and runs the classifier,
but each insert's `summary` is prefixed with `(debug — raw feed item)` and the
raw `<guid>` is appended at the end of the `summary` field. Inserts go into
`monitor_events` with `status='new'` like normal — there's no separate debug
table — so the owner can:

1. Open the dashboard's Pulse Monitor view, filter to
   `summary ilike '%(debug — raw feed item)%'`.
2. Confirm rows look right: `category` matches feed type, `platform` is set for
   algo channels, `severity` isn't wildly off, `tags` are sane.
3. If something's off (e.g. classifier is returning `category='news'` for
   TikTok Newsroom items), tweak the SYSTEM prompt in §3 and rebuild.

Once the debug rows look clean:
- delete the debug rows: `delete from monitor_events where summary like '(debug — raw feed item)%'`
- flip the flags per §7.

This matches the IG-DM debug pattern: insert anyway, tag the row, eyeball, flip.

---

## 7. Roll-out checklist 🔴
- [ ] §0 migration `0059_monitor_events` applied (`npm run migrate` shows 0 pending).
- [ ] §1 files dropped, APScheduler jobs registered, `feedparser` in requirements.
- [ ] §2 `config/news-monitor-sources.yaml` committed in the backend repo.
- [ ] §3 classifier copied verbatim from `api/ai/monitor.js`'s `OR_MODELS` list.
- [ ] §4 upsert tested locally against a staging row (manual `curl` is fine).
- [ ] §5 env vars added in both `.env` AND `docker-compose.yml` passthrough.
- [ ] §6 debug ON for one full poll cycle (15 min for algo, 5 min for news).
- [ ] Spot-check 5 debug rows in Supabase — category/platform/severity look right.
- [ ] Flip:
      ```
      FEATURE_NEWS_MONITOR_DEBUG=0
      FEATURE_NEWS_MONITOR_INGEST=1
      ```
      then `docker compose up -d backend`.
- [ ] Delete remaining `(debug — raw feed item)` rows.
- [ ] Dashboard Pulse Monitor view shows live poller rows alongside vault rows.

---

## Notes / gotchas
- **Dedup spans both producers.** The vault seed (`source_type='vault'`) and the
  poller (`source_type='poller'`) coexist because the unique index keys on the
  *pair* `(source_type, external_id)`. Don't try to "merge" a vault row with a
  matching news item — they're intentionally separate rows.
- **`status` is always `'new'` at insert time.** Never write `'unread'` — that
  string is not in the schema's enum and a row with it will fail to insert.
- **Classifier is best-effort.** If `call_openrouter` throws (all 5 free models
  down), insert the row anyway with `category=<feed-default>`, `severity=<feed-default>`,
  `tags=[]`, `summary=<raw RSS summary clipped to 500 chars>`. A row missing AI
  enrichment is far better than a missed event.
- **Don't poll faster than the feeds want.** 5 min for breaking news / 15 min
  for slow algo feeds is the sweet spot; tighter intervals get you 304s at best
  and rate-limited at worst.
