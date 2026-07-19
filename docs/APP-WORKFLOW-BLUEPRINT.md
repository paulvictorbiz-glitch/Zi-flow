# FootageBrain — App Workflow Blueprint

> **Canonical operating model for the whole app.** This is the source of truth for how FootageBrain
> is *meant* to work end-to-end. Edit this file when the model changes — it doubles as build context
> (referenced from `CLAUDE.md`) and should be consulted when scoping any new feature.
>
> **Two representations, one model:**
> - **This doc** — canonical, git-versioned, editable-in-code, and the context Claude reads on builds.
> - **`public/workflow-blueprint.html`** — the interactive visual (draggable node canvas), opened from the
>   **"App Workflow Blueprint"** button next to **3D Space** on the owner's *My Work* page. Its in-canvas
>   edits persist to the viewer's `localStorage` only (per-browser scratch); durable changes belong **here**.
>
> Status tags reflect a code audit on **2026-07-18**: 🟢 built · 🟡 partial/diverged · 🔴 not built.

---

## The loop, in one line

**Ingest → Index → (Asset Library feeds) → 4 Procurement lanes → Pipeline → Editor Cycle → Produce → Growth → Reporting → (analytics loops back)**

---

## 1. Film — *Ingest*  🟡
- Dump all raw footage folders into Footage Brain.
- Auto-organizes by date, location & type. *(🟡 read-only folder parsing today; no true bulk-ingest auto-organizer.)*
- AI scans for unusable / lossless cuts → generates a **cut-timestamp sheet** for editors. *(🔴 not built — `lossless.jsx` is a manual LosslessCut clone; no AI cut-sheet.)*
- Paul reviews & **accepts** the cuts → unlocks Process. *(🔴 no accept/gate step.)*
- *Exists instead:* `footage-status.jsx` dispatches processing jobs (`processing_jobs`, migration 0037).

## 2. Process — *Index*  🟡 (mostly backend-owned)
- Accepted footage uploads to Google Drive. *(🟡 Drive links consumed; upload runs backend-side.)*
- Local files split into audio-only tracks. *(🔴 backend-only, no repo evidence.)*
- Whisper transcription. *(🟢 consumed — `getFootageTranscript`, migration 0024; Whisper runs on backend.)*
- Thumbnails extracted & embedded in-app. *(🟢 `footageBrainThumbnailUrl`.)*
- Vision model auto-tags footage for search. *(🟢 `tagFootage` → `api/tag-footage.js`, migration 0026.)*
- Linked & pushed live to the **Coverage Tree**. *(🟢 `coverage.jsx` + `getFootageBrainCoverageTree`.)*

## 3. Asset Library — *concurrent, feeds every procurement lane*
Seven subsystems attachable to any card:
1. **Pulse (News)** — automated news tracking + manual article links. *(🟢 `pulse.jsx`.)*
2. **Music + AI VO** — YouTube & Epidemic Sound + reusable Epidemic AI-voice prompts. *(🟡 Epidemic fully built — `MusicPickerModal.jsx`, `music-library.jsx`, migrations 0092/0093; **YouTube music + AI VO/TTS not built**.)*
3. **Thumbnails** — curated YouTube inspiration playlist synced in. *(🟡 `thumbnail-dna.jsx` capture/catalog, migration 0063; manual tagging.)*
4. **Locations** — turn a reel to recreate into a filming **route & itinerary**. *(🟡 `locations.jsx` map + reel-linking; **route/itinerary generation not built**.)*
5. **Google SEO Keywords** — keyword research, attachable per card. *(🟡 only per-reel publish-pack SEO; no standalone keyword library.)*
6. **B-Roll** — tagged, reusable library of downloaded clips. *(🔴 no distinct subsystem; general Footage Library covers it.)*
7. **AI Generated Content** — 50 free Google Flow Labs credits/day, auto-prompted & auto-generated. *(🔴 not built.)*

## 4. Procurement lanes — *4 paths into the Pipeline*

### 4a. Content Forge  🟢
- Mine library — LLM scans transcripts for viral-hook candidates.
- Paul audits results, tags clips worth expanding.
- LLM drafts **3 variations**: shot list + voiceover + hooks + hashtags.
- Asset attachment from the Asset Library → **Sent to Pipeline**.
- *Built:* `content-forge.jsx`, `content_opportunities`, S/A/B/C virality ranking, ForgeModal (3 hooks), Send-to-Pipeline → `reels.creative_brief` (migrations 0102/0103/0106/0107; blueprint variation sheet + PDF shipped 2026-07-18). Full "shot list + VO + hashtags" richness is lighter than described.

### 4b. Reel DNA Ingestion  🟡
- Self-DM a reel on Instagram → logs to the Reel DNA sheet. *(🟢 IG webhook, migrations 0044/0045/0073/0074.)*
- Reverse-engineer the reel into a timeline edit. *(🟢 `reel-deconstructor.jsx` + `reel_deconstruct.py`.)*
- Export the timeline to a **DaVinci-ready format** (assets + cuts). *(🔴 not built — no DaVinci/FCPXML/OTIO/EDL export anywhere; timeline is internal-only.)*
- Asset attachment → Sent to Pipeline.

### 4c. Generate  🟡
- LLM scans the current media pool for **thematic clip sets** (e.g. "top 5 foods in Asia").
- Produces the matching clip set → asset attachment → Pipeline.
- *Built instead:* `idea-generator.jsx` generates titles/ideas (`generated_drafts`, migration 0013) — **not** a footage-backed clip-set builder.

### 4d. Manual  🟢
- Open a blank reel card, fill fields by hand, asset attachment → Pipeline. *(🟢 standard reel cards.)*

## 5. Pipeline — *queue where all 4 lanes converge*  🟢
- Paul reviews & **duplicates** before handoff to editors. *(🟢 `pipeline.jsx` per-editor lanes + shared review lane; kebab duplicate/archive/delete.)*

## 6. Editor Cycle — *circular loop*  🟢 (mostly)
- **Assign to Editor** — Paul assigns the queued card.
- **Edit + Export** — editor builds in **OpenCut**, exports to **RocketChat / Teams** (auto-attaches to the card), Paul gets a **WhatsApp** notification, card moves Started → Review. *(🟢 `editor.jsx` embedded OpenCut; 🟢 RocketChat attach — `detail.jsx`; 🔴 Teams; 🟡 WhatsApp router exists — `whatsapp.py` — but no wired "notify on status change".)*
- **Grading Review** — graded vs the syllabus rubric; **≥ 80% approved**, **< 80% → revision**. *(🟢 `GamifyRubricSheet.jsx`, `gamify-data.jsx`, `gold standard grading rubric.md`.)*
- **Needs Revision** — feedback attached; weak-skill areas route to Training; re-edit until it clears 80%.
- **Training Module** — targeted lessons + assessments to prove the concept lands. *(🟢 `training.jsx`, `Quiz.jsx`, migrations 0047/0078; `Training Course Syllabus.md`.)*

## 7. Produce — *linear finishing*  🟡
- **Thumbnail** — AI-generated or Canva frame; **Thumbnail Ranker** scores & iterates; attach winner. *(🟡 Thumbnail DNA capture exists; 🔴 **Thumbnail Ranker not built**.)*
- **SEO Keywords** — research if applicable, attach to card. *(🟡 per-reel publish-pack only.)*
- **Export + Schedule** — ready reels land in the Export tab; Paul finalizes details + due date; "Export All Reels" pushes to **Planable**. *(🟢 `export-view.jsx`, `_planable.js`, migrations 0087/0088/0090.)*

## 8. Growth  🟡
- **Posted → Analytics** — per-reel performance, linked back to the editor who made it. *(🟡 `analytics.jsx` wired but still a **mock layer**; per-reel→editor attribution not clearly wired.)*
- **Community Management** — unified inbox/DM across every platform; reply to DMs, like & reply to comments. *(🟢 `inbox.jsx`; FB/IG live, YT/TikTok write stubbed.)*
- **Cross-Platform Marketing** — share into Reddit, Facebook groups, etc.; drive outside traffic back. *(🔴 not built.)*

## 9. Reporting  🔴
- **Weekly Client Report** — client tag from Procurement keeps each client's work separate; after 1 week an analytics report generates per client; client logs into the **portal**, a brief PDF is also **emailed**; covers work delivered, upcoming, analytics/research + forward strategy. *(🔴 no client portal, no per-client login, no report email.)*
- **Nightly Ops Report** — sent to Paul's WhatsApp EOD: editor activity + hours + rolling analytics snapshot. *(🔴 not built; WhatsApp send capability exists but no nightly job.)*

## 10. Infra / future notes
- **★ Build a CRM system** — idea, not scoped. 🔴
- **Jarvis — future ops assistant** — activity & flight-ticket tracker, AWS + Azure storage, security measures, nightly ops brief, testimonials, accurate UX/UI. 🔴 *(Note: current storage is Supabase + Hetzner, not AWS/Azure; `activity.jsx` is a CapCut usage monitor, not a flight tracker; testimonials exist only on the marketing landing.)*

---

## Where the gaps are (build priorities implied by this blueprint)

- **Strongest section:** the middle of the loop — Procurement → Pipeline → Editor Cycle → Produce/Publish — is largely shipped.
- **Thin front door:** AI-assisted **ingest** (cut-sheet + accept gate) and AI **generation** (Flow Labs content, thematic clip sets, AI VO).
- **Missing back door (highest leverage):** **Reporting** — the Weekly Client Report + client portal is what clients actually see, and it's entirely absent. Nightly Ops Report is a quick win on the existing WhatsApp router.
- **Smaller gaps:** DaVinci export from Reel DNA, Thumbnail Ranker, dedicated B-Roll & SEO keyword libraries, Reddit/FB-group cross-posting, real (non-mock) analytics with editor attribution.
