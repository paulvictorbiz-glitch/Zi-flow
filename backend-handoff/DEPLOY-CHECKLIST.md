# Deploy checklist — WhatsApp + TikTok + GCP billing + Clarity

All **code** is written and the frontend **builds clean** (`npm run build` exits 0).
What remains are the steps that touch live secrets, the shared prod DB, the Hetzner
server, and the live deploy. Claude did **not** perform these — do them in order.

Legend: 🟢 = safe/idempotent · 🟡 = touches shared prod DB · 🔴 = uses a secret / live deploy

---

## 0. Pre-flight — rotate the leaked credentials first 🔴

The orchestration prompt pasted live secrets in plaintext. Treat them as compromised:

- **RapidAPI key** (`10a1c8848...dc011`) — rotate in the RapidAPI dashboard. The new
  key goes ONLY into the Hetzner env (step 3), never the frontend.
- **WhatsApp token** (`EAAS...ZD`) — this is a ~24h test token anyway. Generate a
  permanent **System User** token in Meta Business Manager and use that.
- The GCP service-account JSON, Hetzner root SSH, and Paul's SSH key were also in the
  prompt — if that prompt was shared anywhere, rotate/re-key them too.

Do this before deploying so you never deploy the leaked values.

---

## 1. Database migrations (Supabase SQL editor, project kjruhbaahqkuajseoojn) 🟡

Run each file's contents in the SQL editor. They are idempotent (`if not exists` /
guarded insert), but they DO write to the shared prod DB — confirm you mean to.

1. `supabase/migrations/0031_whatsapp_messages.sql`
2. `supabase/migrations/0032_whatsapp_social_connection.sql`

**Verify:**
```sql
SELECT id FROM whatsapp_messages LIMIT 1;                 -- table exists (0 rows OK)
SELECT value FROM app_settings WHERE key='social_connections';  -- must contain "whatsapp"
```

---

## 2. Copy backend routers to Hetzner 🔴

```
backend-handoff/whatsapp.py  →  /srv/footagebrain/footage-brain-test/backend/app/api/whatsapp.py
backend-handoff/tiktok.py    →  /srv/footagebrain/footage-brain-test/backend/app/api/tiktok.py
```

Then register both routers **exactly the way `facebook.py` is registered** in
`backend/app/main.py` (or wherever `include_router` is called). Open facebook.py first
and match its prefix convention — the full live paths must be:
- `/api/auth/whatsapp/verify`, `/webhook`, `/messages`, `/status`, `/usage`, `/reply`
- `/api/auth/tiktok/status`, `/analytics`

> The routers declare `prefix="/auth/whatsapp"` / `"/auth/tiktok"`, assuming `/api` is
> added at registration (the common pattern). If facebook.py bakes `/api` into its own
> router prefix instead, change these two prefixes to `/api/auth/...` to match.

Confirm `httpx` is in the backend's dependencies (it almost certainly is, since
facebook.py makes Graph calls). If not, add it to `requirements.txt`/`pyproject`.

---

## 3. Set backend env vars on Hetzner 🔴

Append to `deploy/hetzner/.env` (use the ROTATED values from step 0):

```
WHATSAPP_TOKEN=<permanent System User token>
WHATSAPP_PHONE_NUMBER_ID=1200899456434471
WHATSAPP_BUSINESS_ACCOUNT_ID=1004118615546844
WHATSAPP_VERIFY_TOKEN=footagebrain_wh_2026
TIKTOK_SEC_UID=MS4wLjABAAAAw-fBGIBB1IyUMn3pjId0zwx5Juloz2u66HhrPA1Ac_7r3a2VLoZpZOw0Qz1hDkfD
RAPIDAPI_KEY=<rotated RapidAPI key>
RAPIDAPI_HOST=tiktok-api23.p.rapidapi.com
```

Then add matching passthroughs under the backend service's `environment:` in
`deploy/hetzner/docker-compose.yml` (this stack maps vars individually — `.env` alone
is NOT enough; see the FB_SCOPES lesson in CHANGELOG):

```yaml
      - WHATSAPP_TOKEN=${WHATSAPP_TOKEN}
      - WHATSAPP_PHONE_NUMBER_ID=${WHATSAPP_PHONE_NUMBER_ID}
      - WHATSAPP_BUSINESS_ACCOUNT_ID=${WHATSAPP_BUSINESS_ACCOUNT_ID}
      - WHATSAPP_VERIFY_TOKEN=${WHATSAPP_VERIFY_TOKEN}
      - TIKTOK_SEC_UID=${TIKTOK_SEC_UID}
      - RAPIDAPI_KEY=${RAPIDAPI_KEY}
      - RAPIDAPI_HOST=${RAPIDAPI_HOST}
```

Also confirm the backend already passes `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
(whatsapp.py needs them to read/write whatsapp_messages). If not, add them the same way.

---

## 4. Rebuild + restart the backend 🔴

```bash
cd /srv/footagebrain/footage-brain-test/deploy/hetzner
docker compose build backend
docker compose up -d backend      # `up -d`, NOT restart — restart keeps stale env
sleep 30
```

**Verify (both must pass):**
```bash
curl "https://api.footagebrain.com/api/auth/whatsapp/verify?hub.mode=subscribe&hub.verify_token=footagebrain_wh_2026&hub.challenge=PING123"
# → exactly: PING123

curl -s https://api.footagebrain.com/api/auth/whatsapp/status
# → JSON with "phone_number_id":"1200899456434471"

curl -s https://api.footagebrain.com/api/auth/tiktok/analytics | head -c 200
# → JSON with "connected":true and a "totals" object
```
If the container won't start: `docker compose logs backend` and fix before retrying.

---

## 5. Vercel env var for GCP billing 🔴

```bash
vercel env add GCP_BILLING_ACCOUNT_ID   # value: 01EAC9-2F4336-38590E ; select Prod+Preview+Dev
```
Also (one-time, in GCP Console → Billing → Account Management): grant the service
account `ssh-to-out-network@footage-brain-database.iam.gserviceaccount.com` the
**roles/billing.viewer** role. Without it, billing cost stays null and the Monitor card
shows the "Add GCP_BILLING_ACCOUNT_ID…" hint (graceful — not an error).

---

## 6. Deploy the frontend 🔴

```bash
vercel --prod      # the ONLY thing that updates the live site — git push does NOT
```

---

## 7. Meta webhook (one-time, Meta Developer Console) 🟢

WhatsApp → Configuration → Webhooks:
- Callback URL: `https://api.footagebrain.com/api/auth/whatsapp/verify`
- Verify token: `footagebrain_wh_2026`
- Subscribe to the **messages** field (confirm the checkbox is ticked).

Then send a WhatsApp message to the business number and confirm a row lands:
```sql
SELECT id, from_name, body, media_type FROM whatsapp_messages ORDER BY timestamp DESC LIMIT 5;
```

---

## 8. Post-deploy smoke test (the QA layer)

- `curl -s https://www.footagebrain.com/ | grep clarity.ms/tag/x6co82yf7y` → found ✅
  (already verified present in the local `dist/index.html` build)
- `https://www.footagebrain.com/api/monitor/status` → JSON has top-level `whatsapp`
  object with `configured`, and `gcp.billingCost` key present.
- Inbox tab → WhatsApp "W" chip in the filter row; WA messages appear if any received.
- Monitor tab → "WhatsApp Business" card renders; Google Cloud card footer reads
  "YouTube · Maps · Cloud Billing" and shows spend row OR the billing hint.
- Analytics tab → "TikTok performance" card with views/likes/comments/shares/videos
  tiles; TikTok shows "Connected" (no Connect button).

---

## What changed vs. the original spec (and why)

- **TikTok RapidAPI key is NOT hardcoded in the frontend.** The original Change 6 put the
  key + secUid directly in `social-client.js`, which ships to every public visitor of
  footagebrain.com — anyone could read it from the bundle and drain the RapidAPI quota.
  Instead the key lives in the Hetzner env and `tiktok.py` proxies the call server-side;
  the frontend hits `/fb/api/auth/tiktok/analytics`. This is why you have a new
  `tiktok.py` that wasn't in the original Layer 2 list.
- Everything else follows the spec. The frontend handles both the proxied
  `{totals, videos, videoCount, topVideo}` shape and a raw `itemList` fallback.
