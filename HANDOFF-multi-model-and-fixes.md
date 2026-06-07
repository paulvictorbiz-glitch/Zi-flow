# Handoff — Generate tab: bug fixes + multi-model support (IN PROGRESS)

**Date:** 2026-06-03
**Status:** Mid-implementation. Code is PARTIALLY edited and NOT yet built or deployed.
The live site is still on bundle `index-AyhJl0fv.js` (none of the work below is live yet).

This doc lets a fresh session finish two intertwined work streams:
1. **Bug fixes** to the AI "Generate" tab (footage not attaching, empty fields, wrong title)
2. **Multi-model support** (Puter.js free Claude + OpenRouter free DeepSeek) with a model dropdown

---

## Context: what the Generate tab is

footagebrain.com (ziflow) tab 9 "Generate". User types a reel idea →
`POST /api/generate` (Vercel serverless) → searches FootageBrain → fetches transcripts →
calls an LLM → returns a structured draft (title, description, clips with timecodes + Drive links).
"+ Add to Pipeline" creates a reel card in Supabase and attaches the footage clips.

Key files:
- `api/generate.js` — Vercel serverless function (search + LLM + parse + inject drive_urls)
- `src/pages/idea-generator.jsx` — the UI
- `src/store/store.jsx` — Supabase-backed reel/footage store
- `src/styles.css` — `.gen-*` classes
- `index.html` — needs Puter.js script tag (NOT yet added)

---

## STREAM 1 — Bug fixes (diagnosis done, ~60% implemented)

### Root cause (confirmed via live Supabase query)
The store's `wrap()` helper (store.jsx ~line 585) fires the Supabase persist **without awaiting**.
`createReelFromDraft` called `actions.createReel(reel)` then looped `actions.addAttachedFootage(...)`,
so all inserts raced concurrently. The footage rows have a `reel_id` FK → `reels.id`; when they
landed before the reel row committed, Postgres rejected them → **silent FK failure**.

Evidence: live DB had only 2 `attached_footage_items` rows total (old REEL-275), and every
AI reel (276–282) had ZERO footage. Titles "Generated reel" = runs where LLM output didn't parse
(the old `_raw` fallback). `script` column was NULL because it was never set.

### DONE (already edited in the working tree)

**`src/store/store.jsx`** — added a new action `createReelWithFootage(reel, footageItems)`
right after `removeAttachedFootage` (~line 672). It dispatches optimistically, then persists
SEQUENTIALLY: `await persistCreateReel(reel)` first, then `await persistAddAttachedFootage(item)`
in a loop. This fixes the FK race. ✅ (verify it's still there)

**`src/pages/idea-generator.jsx`**:
- Added `buildShotPlan(draft)` helper (renders hook + flow + shots into the reel's `script` text). ✅
- Rewrote `createReelFromDraft` to: use `actions.createReelWithFootage(reel, footageItems)`,
  set `title` (with prompt-based fallback, not "Generated reel"), `logline` = description,
  `script` = buildShotPlan output, and `detail: { aiDraft: draft }`. ✅
- Added `<SeoPackage>` component (caption/description/hashtags, click-to-copy). ✅
- Added hook card + flow blueprint + `<SeoPackage>` into the results JSX. ✅

**`api/generate.js`**:
- Expanded `SYSTEM_PROMPT` to a viral-strategist persona. ✅
- Expanded `outputSchema()` to include `hook`, `flow[]` (beat blueprint), and
  `seo{youtube_title, ig_caption, description, hashtags[]}`. ✅
- Bumped `max_tokens` 800 → 2000. ✅
- Hardened JSON parse (strip ``` fences, better fallback). ✅

### TODO (Stream 1)

1. **Add CSS** for the new classes in `src/styles.css`. These are referenced by the JSX but
   NOT yet styled (some exist, some don't). Need to add/verify:
   - `.gen-section`, `.gen-section-label`
   - `.gen-flow`, `.gen-flow-beat`, `.gen-flow-tc`, `.gen-flow-name`, `.gen-flow-dir`
   - `.gen-seo-block`, `.gen-seo-tag`, `.gen-seo-val`
   - Confirm existing: `.gen-hook-card`, `.gen-hook-label`, `.gen-hook-text`, `.gen-seo`,
     `.gen-tags`, `.gen-tag`, `.gen-copy-hint` (these DO exist ~line 2444–2589).
   - Make `.gen-copy-hint` also reveal on `.gen-seo-block:hover` (currently only on
     `.gen-seo-title:hover`/`.gen-seo-desc:hover`).
   The last edit to styles.css was reading lines 2545–2589; the CSS block was NOT appended yet.

2. **Verify the Reel detail view actually reads `script`** — the detail "Script / shot plan"
   tab reads `stored?.script` (detail.jsx ~line 69). Confirm `reelToDb` in store.jsx includes
   `script` (it does — line ~52). The `detail` jsonb is also persisted; confirm `reelToDb`
   passes `detail` through (it does).

---

## STREAM 2 — Multi-model support (just started, ~30% implemented)

### Goal
Add two free LLM options alongside the current paid Anthropic path, with a **model dropdown**
on the desktop browser:
1. **Claude via Puter.js** — free, unlimited, runs CLIENT-SIDE in the browser (no API key).
2. **DeepSeek via OpenRouter free tier** — server-side, uses an API key.

### Architecture decision (important)
Puter.js only works client-side (browser session auth), so it CANNOT run inside the Vercel
function. Solution: add a `prepare_only` mode to `/api/generate` that does the FootageBrain
search + prompt building and returns `{ clips, system, userMessage }` WITHOUT calling an LLM.
- **Anthropic / OpenRouter** → server does everything (search + LLM + parse + inject).
- **Puter** → client calls `/api/generate {prepare_only:true}`, gets the prompt, calls
  `puter.ai.chat()` in the browser, then parses + injects drive_urls client-side
  (the `clips` returned already contain `drive_url`).

### DONE (already edited)

**`api/generate.js`** — added three module-level helpers BEFORE the handler:
- `parseDraft(rawText, prompt)` — extracted robust JSON parse. ✅
- `injectClipData(draft, clips)` — extracted drive_url injection. ✅
- `callOpenRouter(key, system, userMessage)` — POSTs to
  `https://openrouter.ai/api/v1/chat/completions`, model `deepseek/deepseek-chat-v3-0324:free`,
  returns `{ text, usage }`. ✅

### TODO (Stream 2) — THIS IS WHERE WE STOPPED

1. **Rewrite the `/api/generate` handler body** (it still has the OLD inline Anthropic-only
   flow at ~lines 230–340 after the new helpers were inserted). Replace steps 4–6 with:
   ```js
   const { prompt, type = "reel", reel_id, provider = "anthropic", prepare_only = false } = req.body || {};
   // ... search + transcripts + build userMessage (steps 1–3, already there) ...

   if (prepare_only) {
     res.status(200).json({
       clips, system: SYSTEM_PROMPT, userMessage, prompt,
       meta: { clips_searched: clips.length, clips_with_transcripts: topClips.length },
     });
     return;
   }

   let rawText = "", usage = {};
   if (provider === "openrouter") {
     const key = process.env.OPENROUTER_API_KEY;
     if (!key) { res.status(500).json({ error: "OPENROUTER_API_KEY not configured" }); return; }
     ({ text: rawText, usage } = await callOpenRouter(key, SYSTEM_PROMPT, userMessage));
   } else { // anthropic
     const apiKey = process.env.ANTHROPIC_API_KEY;
     if (!apiKey) { res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" }); return; }
     const client = new Anthropic({ apiKey });
     const message = await client.messages.create({
       model: "claude-sonnet-4-6", max_tokens: 2000,
       system: SYSTEM_PROMPT, messages: [{ role: "user", content: userMessage }],
     });
     rawText = message.content?.[0]?.text || "";
     usage = { input_tokens: message.usage?.input_tokens, output_tokens: message.usage?.output_tokens };
   }

   const draft = injectClipData(parseDraft(rawText, prompt), clips);
   res.status(200).json({ draft, prompt, meta: { clips_searched: clips.length, clips_with_transcripts: topClips.length, ...usage, provider } });
   ```
   IMPORTANT: move the API-key check OUT of the top of the handler (it currently hard-requires
   ANTHROPIC_API_KEY at ~line 163 before the try block — that must be removed so prepare_only
   and openrouter don't 500). The old inline Anthropic call + parse + inject (the duplicated
   block) must be DELETED so it's not dead/duplicate code.

2. **`index.html`** — add Puter.js in `<head>`:
   ```html
   <script src="https://js.puter.com/v2/"></script>
   ```

3. **`src/pages/idea-generator.jsx`** — add the model dropdown + Puter client path:
   - Add state: `const [model, setModel] = useState("anthropic")`.
   - Model options:
     - `{ k: "anthropic", l: "Claude (paid ~$0.02)" }`
     - `{ k: "puter",     l: "Claude (Puter — free)" }`
     - `{ k: "openrouter",l: "DeepSeek (OpenRouter — free)" }`
   - Render a `<select className="gen-model-select">` in the `.gen-input-panel`
     (user asked specifically for a dropdown on desktop).
   - In `generate()`, branch on `model`:
     - `anthropic` / `openrouter`: `POST /api/generate { prompt, type:"reel", provider: model }`
       (existing fetch, just add `provider`).
     - `puter`:
       ```js
       // 1. get prompt + clips from server (no LLM)
       const prep = await fetch(endpoint, { method:"POST", headers, body: JSON.stringify({ prompt, type:"reel", prepare_only:true }) }).then(r=>r.json());
       if (prep.error) throw new Error(...);
       // 2. call Puter client-side
       const resp = await window.puter.ai.chat(
         [{ role:"system", content: prep.system }, { role:"user", content: prep.userMessage }],
         { model: "claude-sonnet-4" }   // may need "claude-3-7-sonnet" if that errors
       );
       const rawText = typeof resp === "string" ? resp : (resp?.message?.content?.[0]?.text ?? resp?.text ?? String(resp));
       // 3. parse + inject client-side (mirror server helpers)
       const draft = injectClipDataClient(parseDraftClient(rawText, prompt), prep.clips);
       setResult({ draft, meta: prep.meta });
       saveHistoryToDB(prompt.trim(), draft);
       ```
   - Add CLIENT copies of `parseDraft` + `injectClipData` (the server ones are not importable
     into the bundle — copy the same logic as small local functions in idea-generator.jsx).
   - Guard: if `model === "puter"` and `!window.puter`, show an error telling the user Puter
     didn't load (the script tag must be present + page reloaded).

4. **CSS** — add `.gen-model-select` styling (dashed pill look, matches `.gen-type-btn`).

5. **Set the OpenRouter key on Vercel** (key provided by user — DO NOT hardcode it in source):
   ```
   cd "C:\Users\Mi\Downloads\ziflow project-final"
   vercel env add OPENROUTER_API_KEY production --value "<the sk-or-v1-... key from chat>" --yes
   ```
   The user pasted: `sk-or-v1-REDACTED-ROTATE-THIS`
   (treat as secret; consider rotating after — it was shared in chat).

---

## Build / deploy / verify (do this after BOTH streams are code-complete)

```
cd "C:\Users\Mi\Downloads\ziflow project-final"
npm run build                 # must be clean
git add -A && git commit -m "Generate: fix FK race + expand output + multi-model (Puter/OpenRouter)"
git push origin main
$env:NODE_EXTRA_CA_CERTS="C:\Users\Mi\.claude\avast-root.pem"; vercel --prod --yes
```

### Verify (critical — the original bug was silent)
1. Bundle live: `ssh root@178.105.14.144 "curl -sL https://www.footagebrain.com/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'"` — must change from `index-AyhJl0fv.js`.
2. **Footage actually persists** — generate a reel, Add to Pipeline, then query live Supabase:
   ```
   node -e "const {createClient}=require('@supabase/supabase-js');const fs=require('fs');const e=fs.readFileSync('.env.local','utf8');const u=e.match(/VITE_SUPABASE_URL=(.+)/)[1].trim();const k=e.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();const sb=createClient(u,k);sb.from('attached_footage_items').select('reel_id,filename').order('created_at',{ascending:false}).limit(8).then(r=>console.log(r.data))"
   ```
   Should show rows for the NEW reel id (not just old REEL-275).
3. Open the new reel in detail view → footage in side panel + shot plan populated.
4. Test each model in the dropdown end-to-end (Puter needs you to be logged into Puter in-browser
   the first time — it pops an auth dialog).

---

## Environment notes (already set up this session — don't redo)
- **Avast TLS interception** breaks Python/npm certs. Permanent fixes installed:
  Python `truststore` `.pth` auto-injector; `NODE_EXTRA_CA_CERTS=C:\Users\Mi\.claude\avast-root.pem`.
  For Vercel CLI from bash, prefix: `NODE_EXTRA_CA_CERTS="C:/Users/Mi/.claude/avast-root.pem" vercel ...`.
- **Vercel deploys are CLI-only** (no git auto-deploy). `git push` does NOT deploy.
- **Vercel builds ziflow in dev mode** — don't rely on `import.meta.env.PROD/DEV`; use
  `window.location.hostname` (already done in footage-brain-client.js).
- **ANTHROPIC_API_KEY** already set in Vercel env (was shared in chat — user declined rotation).
- Supabase: free tier, `generated_drafts` table exists (history sync), `attached_footage_items`
  + `reels` tables drive the pipeline. Service role key + URL in `.env.local`.
- FootageBrain API: `https://api.footagebrain.com` (public, no auth). Search returns
  `drive_url` + `drive_folder_url` per clip.

## Open follow-ups from earlier (not blocking this task)
- Google OAuth app set to "In production" (done by user — Drive token no longer expires weekly).
- The previous deploy (`index-...` after history-sync) may or may not have landed — the FK fix +
  output expansion are committed locally but NOT confirmed live. This task's deploy supersedes it.
