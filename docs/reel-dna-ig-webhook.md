# Reel DNA — Instagram share-to-DM ingest (Layer 1, Hetzner backend)

This is the runbook for the **IG share-to-DM** intake. It lives on the **Hetzner
backend** (private repo `footagebrain-backend`, `ssh root@178.105.14.144`), NOT in
this Vercel repo — the app is at the Vercel Hobby 12-function cap, and media/webhook
work needs hidden secrets + no 10s timeout.

**Contract with the rest of Phase 1:** the backend inserts a `reel_dna` row with
`source='ig_dm'`. The frontend already shows it live via Supabase realtime
(`store.jsx` `reel_dna` channel). There is **no** frontend code to write for this
layer — only the backend endpoint + Meta app config.

It ships **behind a feature flag** (`FEATURE_IG_DM_INGEST`, default OFF in prod)
because production for arbitrary senders requires Meta App Review. Layers 0/2/3
(manual + bookmarklet) ship today without it.

---

## How it works

When someone DMs a reel to the `paulvictortravels` IG **business/creator** account,
Meta sends a `messages` webhook to our callback containing a `reel`/`ig_reel`
attachment with the reel's **media id, url, and caption/title**. This is the official
Instagram Messaging API — **ToS-compliant**, no scraping, no yt-dlp, no IP-ban risk.
(The webhook delivers reel *metadata + link*, not a guaranteed MP4 of arbitrary
creators' reels — fine for Phase 1 capture; download reliability is a Phase 2 concern.)

---

## Out-of-code prerequisites (Meta app — the long pole)

Extend the **existing** Meta app already used for IG OAuth (`src/lib/social-client.js`).

1. Add permission **`instagram_manage_messages`** to the app.
2. **Webhooks** product → add subscription:
   - Callback URL: `https://api.footagebrain.com/api/ig/webhook`
   - Verify token: a backend env secret (`IG_WEBHOOK_VERIFY_TOKEN`)
   - Subscribe to the **`messages`** field on the **`instagram`** object.
3. **App Review** for `instagram_manage_messages` + Advanced Access.
   Until approved, only the app's own test users / the connected business account
   fire webhooks (enough for dev). Keep `FEATURE_IG_DM_INGEST` OFF in prod until approved.

Env vars on Hetzner: `IG_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET` (for signature
verification), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FEATURE_IG_DM_INGEST`.

---

## Endpoints

### `GET /api/ig/webhook` — verification handshake
Echo `hub.challenge` as plain text **iff** `hub.mode === 'subscribe'` AND
`hub.verify_token === IG_WEBHOOK_VERIFY_TOKEN`. Else `403`.

### `POST /api/ig/webhook` — receive
1. **Verify `X-Hub-Signature-256`**: HMAC-SHA256 of the **raw request body** (not
   re-serialized JSON) keyed by `META_APP_SECRET`; compare with `sha256=<hex>`.
   Mismatch → `403`, insert nothing.
2. If `FEATURE_IG_DM_INGEST` is off → `200` no-op.
3. Parse `entry[].messaging[]`. For each message, find an attachment of type
   `ig_reel` / `reel` / share whose `payload.url` is the reel link; pull media id
   and caption/title.
4. **Dedupe**: `external_ref = message.mid` (the IG message id — most stable).
   Insert with `ON CONFLICT (external_ref) DO NOTHING` (the partial unique index in
   migration 0044 is the hard backstop).
5. **Insert via service role** (bypasses RLS; the explicit `service_insert_reel_dna`
   policy is belt-and-braces):
   ```json
   { "reel_url": "<payload.url>", "platform": "ig", "source": "ig_dm",
     "status": "captured", "external_ref": "<mid>", "quick_notes": "<caption>" }
   ```
6. **Ack `200` fast**, work idempotently. Meta retries on non-2xx → a slow/failed
   insert + retry must not create a dupe (the unique index guarantees this).

---

## Verification checks (run by QC)

- Handshake: `curl "https://api.footagebrain.com/api/ig/webhook?hub.mode=subscribe&hub.verify_token=$TOKEN&hub.challenge=abc123"` → returns `abc123`.
- Receive: POST a saved sample `messages` payload with a valid signature →
  **exactly one** `reel_dna` row with `source='ig_dm'`, `status='captured'`, `external_ref` set.
- **Replay**: POST the identical payload again → **still one row** (no dupe).
- Bad signature → `403`, zero rows.
- Flag off → `200` no-op, zero rows (proves Layers 0/2/3 are unaffected).
- **Seam to frontend**: with the dashboard open on the Reel DNA tab, POST the sample
  payload → a card with an `IG DM` source badge appears within ~2s via realtime, no refresh.

---

## Red flags

- **RLS blocking the service-role insert** (the known `people`-table issue): confirm
  the Hetzner Supabase client is built with `SUPABASE_SERVICE_ROLE_KEY`, not anon.
- **Signature against re-serialized JSON**: must hash the raw body bytes; body-parser
  middleware that drops the raw buffer breaks verification.
- **Dedupe key**: use `mid`, not `reel_url` (shortlinks/query params vary).
- **Meta retry storms**: ack 200 quickly; idempotent insert via the unique index.
- **App-review latency**: keep the flag off in prod until approved.

---

## Phase 2 — capture the sender's tag note (for the Inspiration spreadsheet)

The frontend now parses a `key=value` tag note (`location=Bali, music=phonk,
font=Aktiv, sfx=whoosh @0:02`) out of a `reel_dna` row's `quick_notes` and
auto-fills the spreadsheet columns / gene fields (`src/lib/reel-dna.jsx`
`parseTagNote`, used by `src/pages/reel-dna.jsx`). Manual + bookmarklet captures
already feed it the note directly.

For the **Instagram DM** path to feed it too, the webhook must store **the text
Paul types alongside the share** (his tags), not only the reel's own caption.
One change in the `POST /api/ig/webhook` handler (step 3 above):

- When building the insert, set `quick_notes` to `message.text` (the accompanying
  message body) when present — falling back to the reel attachment's
  caption/title only when there's no typed text. (If IG delivers the share and
  the text as two separate message events, associate by sender within a short
  window, or just insert the text onto the most recent un-noted `ig_dm` row for
  that sender.)

No frontend change is needed for this — `parseTagNote` runs on whatever lands in
`quick_notes`, including parse-on-read for already-captured rows.
