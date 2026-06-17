# Deploy checklist — Instagram DM → Reel DNA spreadsheet

Goal: DM an Instagram reel (with a tag note) to **@paulvictortravels** from a second
account → it auto-logs as a row in the dashboard's Reel DNA **Spreadsheet** view.

The frontend half is **already live in the app** (Supabase realtime + `parseTagNote`
spreadsheet columns + migration `0058`/`0044` applied). What remains is the Hetzner
backend handler + Meta app config. Claude did NOT perform the 🔴/🟡 steps — do them in order.

Legend: 🟢 safe/idempotent · 🟡 touches shared prod DB · 🔴 secret / live deploy / external config

---

## 0. Nothing to migrate 🟢
`reel_dna` (`0044`) and its `location` column (`0058`) are already applied
(`60 applied · 0 pending`). The webhook only INSERTs into `reel_dna` via the service
role (RLS policy `service_insert_reel_dna` already exists).

---

## 1. Copy the router to Hetzner 🔴
```
backend-handoff/ig_webhook.py  →  /srv/footagebrain/footage-brain-test/backend/app/api/ig_webhook.py
```
Register it **exactly the way `facebook.py` is registered** in `backend/app/main.py`.
The full live paths must resolve to:
- `GET  /api/ig/webhook`   (Meta handshake)
- `POST /api/ig/webhook`   (receive)
- `GET  /api/ig/status`    (readiness smoke test)

> The router declares `prefix="/ig"`, assuming `/api` is added at registration (the
> common pattern). If `facebook.py` bakes `/api` into its own prefix, change the prefix
> in `ig_webhook.py` to `/api/ig`. `httpx` is already a backend dep (facebook.py uses it).

---

## 2. Set backend env vars on Hetzner 🔴
Append to `deploy/hetzner/.env`:
```
IG_WEBHOOK_VERIFY_TOKEN=footagebrain_ig_2026      # you pick this; reused in step 5
META_APP_SECRET=<the existing Meta app's App Secret>
FEATURE_IG_DM_DEBUG=1                              # calibration ON for the first test
FEATURE_IG_DM_INGEST=0                             # real inserts OFF until calibrated
```
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are already passed to the backend (the
WhatsApp/IG-insights routers use them) — confirm they're present.

Then add matching passthroughs under the backend service's `environment:` in
`deploy/hetzner/docker-compose.yml` (this stack maps vars individually — `.env` alone
is NOT enough; see the FB_SCOPES lesson in CHANGELOG):
```yaml
      - IG_WEBHOOK_VERIFY_TOKEN=${IG_WEBHOOK_VERIFY_TOKEN}
      - META_APP_SECRET=${META_APP_SECRET}
      - FEATURE_IG_DM_DEBUG=${FEATURE_IG_DM_DEBUG}
      - FEATURE_IG_DM_INGEST=${FEATURE_IG_DM_INGEST}
```

---

## 3. Rebuild + restart the backend 🔴
```bash
cd /srv/footagebrain/footage-brain-test/deploy/hetzner
docker compose build backend
docker compose up -d backend      # up -d, NOT restart (restart keeps stale env)
sleep 30
```
**Verify:**
```bash
curl "https://api.footagebrain.com/api/ig/webhook?hub.mode=subscribe&hub.verify_token=footagebrain_ig_2026&hub.challenge=PING123"
# → exactly: PING123

curl -s https://api.footagebrain.com/api/ig/status
# → {"ok":true,"ingest_enabled":false,"debug_enabled":true,"verify_token_set":true,
#    "app_secret_set":true,"supabase_configured":true}
```
If the container won't start: `docker compose logs backend` and fix before retrying.

---

## 4. Meta app config (Meta Developer Console) 🔴
Same app already used for IG OAuth (`src/lib/social-client.js`).
1. **App Review / Permissions** → add **`instagram_manage_messages`**.
   (For *your own* connected business account + test users this fires without full
   Advanced Access; full review is only needed for arbitrary senders.)
2. **Webhooks** product → Instagram object → add subscription:
   - Callback URL: `https://api.footagebrain.com/api/ig/webhook`
   - Verify token: `footagebrain_ig_2026` (must match step 2)
   - Subscribe to the **`messages`** field (tick the checkbox).
3. Ensure @paulvictortravels is a **Business/Creator** account linked to the FB Page,
   and that account is added as a tester if the app is in Dev mode.

---

## 5. Calibrate with ONE real share 🟡 (the make-or-break test)
From a **different** Instagram account, share a reel to @paulvictortravels and type a
tag note in the same message, e.g. `location=Bali, music=phonk, font=Aktiv, sfx=whoosh`.

Then check what arrived:
```bash
docker compose logs backend --tail=50 | grep ig_webhook   # raw payload shape
```
And open the dashboard → **Reel DNA → Spreadsheet**. With `FEATURE_IG_DM_DEBUG=1` you'll
see one of:
- a row with the **reel URL** + your note parsed into Location/Music/Font/SFX → 🎉 it works; or
- a **`(debug — no reel url…)`** row whose **notes hold the raw IG event JSON** → the reel
  link/text live under different keys than expected. Send that raw JSON back to Claude and
  we adjust `_handle_event()`'s attachment parsing in one pass.

---

## 6. Flip to production once calibrated 🔴
After a clean capture:
```
FEATURE_IG_DM_DEBUG=0
FEATURE_IG_DM_INGEST=1
```
`docker compose up -d backend`. Delete any `(debug …)` rows from the spreadsheet.
Now every share auto-logs, no debug noise, deduped on the IG message id.

---

## Notes / gotchas
- **Signature**: verified over the RAW request body bytes; a body-parser that drops the
  raw buffer breaks it. The handler reads `await request.body()` before `json.loads`.
- **Dedupe**: `external_ref = message.mid`; insert uses `?on_conflict=external_ref` +
  `Prefer: resolution=ignore-duplicates`, backed by the partial unique index in `0044`.
- **You can't DM your own IG account** — that's why the test is from a second account.
- **Reel-share payloads vary** — that's the whole point of the debug step; don't assume,
  observe once, then lock the parser to the real shape.
