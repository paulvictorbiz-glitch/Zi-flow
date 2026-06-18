# Instagram Crosspost / Publishing — Feasibility Writeup

This is a **design feasibility doc only** — no publishing code is implemented here. It evaluates the paths for getting video content (FB reels, IG Content Publishing, YT-sourced media) onto the `@paulvictortravels` Instagram account, and how a published item would be re-cataloged back into the existing **Reel DNA** spreadsheet.

For context, today's IG pipeline is **ingest-only**: the Hetzner poller (`backend-handoff/ig_webhook.py`) captures reels that are DM'd to the account into `public.reel_dna`. Its own docstring is explicit about the project's stance — *"the official Instagram Messaging API — ToS-compliant, no scraping, no yt-dlp."* That stance is load-bearing for everything below, and the YT→IG section is judged against it honestly.

---

## 1. FB→IG native crosspost (Facebook Page ↔ Instagram link)

The cheapest, ToS-clean path. The Facebook Page is already linked to the IG business/creator account (same link that lets the DM poller use the stored Page token). Meta's own product surface allows a post/reel published to the linked Page to **mirror to Instagram** without any new API integration, permission, or App Review.

Trade-off: you get the **least granular control**. It is reel-format-limited, caption/format/timing mirroring is whatever Meta's crosspost UI offers, and you can't programmatically schedule per-platform variants. But it works *now*, inside Meta's supported product surface, with zero new scopes. For an owner just wanting FB reels to also appear on IG, this is the lowest-effort win.

---

## 2. IG Content Publishing API (the official two-step container flow)

This is the "real control" path — programmatic publishing of a specific video with a chosen caption. It's a **two-step container flow**:

1. **Create the container** — illustrative shape:
   ```
   POST /{ig-user-id}/media
     ?media_type=REELS
     &video_url=<PUBLIC video URL>
     &caption=<text>
   → returns { id: <creation_id> }   # the container
   ```
2. **Wait for processing** — the container is processed **async**, so poll its status:
   ```
   GET /{creation_id}?fields=status_code
   → IN_PROGRESS → FINISHED | ERROR
   ```
   Only publish once it reports `FINISHED`.
3. **Publish** — illustrative shape:
   ```
   POST /{ig-user-id}/media_publish
     ?creation_id=<creation_id>
   → returns { id: <published media id> }
   ```

**Critical constraint — public hosting.** `video_url` must be a **publicly reachable URL that Meta's servers can fetch**. Meta does not accept a binary upload or a private/authenticated path here. That means the project would have to **host/expose the recreated video** on a public endpoint — e.g. on the Hetzner box (`api.footagebrain.com`) or object storage — for the duration of the fetch. This is a real infrastructure requirement, not a footnote: there is no publishing without a public video URL.

---

## 3. YT→IG (download + reupload) — ToS gray/red zone

This path means pulling a video off YouTube and reuploading it to IG. It must be called out plainly as the **ToS gray-to-red zone**:

- **Downloading** YouTube content via `yt-dlp` / scraping **violates YouTube's Terms of Service.**
- **Reuploading** someone else's content to IG **violates IG/Meta IP rules.**

It is only defensible for the **owner's own content that the owner controls and holds the rights to** — and even then, the clean way is to source from the owner's **own master files**, never from a YouTube download.

This is also where the project's existing posture matters. `ig_webhook.py` states up front: *"no scraping, no yt-dlp."* Building a YouTube scraper to feed IG would directly contradict that established stance. **Recommendation: do not build a YT scraper.** If YT→IG content is wanted, route it through option 2 (Content Publishing) using the owner's own master file as the public `video_url`, not a downloaded copy.

---

## 4. Permission / App-Review gates

The IG Content Publishing API (option 2) requires:

- The **`instagram_content_publish`** permission.
- An **Instagram Business or Creator account linked to a Facebook Page** (already satisfied).
- **Advanced Access** for that permission, granted via **App Review**.

This is the **same class of gate** that keeps the DM capture flow on **polling** today: real IG DM webhooks only fire once the app is Published and App-Review-approved with Advanced Access, so until then the poller reads the Page IG inbox with the stored token. By the same logic, **IG Content Publishing is blocked behind App Review** until the app is reviewed and approved. Publishing does not work out of the box.

---

## 5. Rate limits

IG Content Publishing is **capped at ~25 published posts per IG account per rolling 24 hours**. Remaining quota can be checked by querying the account's publishing-limit edge:

```
GET /{ig-user-id}/content_publishing_limit
→ { quota_usage, config: { quota_total } }
```

There is also **container-creation throttling** on top of the daily publish cap. These limits are modest but **perfectly fine for an owner's own-content cadence** — nobody is hitting 25 genuine reels/day.

---

## 6. Logging published items into reel_dna

After a successful `media_publish`, close the loop by writing the published item back into the Reel DNA catalog, reusing the same schema the DM poller uses. Proposed row shape:

- **`external_ref` = the returned IG media id** from `media_publish`. This is the **dedupe key**. `reel_dna.external_ref` is enforced by a **partial unique index**, so a later DM/poll capture of the same media collapses via the existing **409 / "already captured" healthy-skip path** (the partial index can't serve PostgREST `on_conflict`, so a raw insert of a duplicate just 409s — that's the intended behavior) instead of duplicating the row.
- **`content_type`** set from the **published media type** — drawn from the enum extended by migration **0075** to `('reel','carousel','photo','story','video','unknown')` (migration 0072 originally had `('reel','carousel','photo','unknown')`).
- **`source = 'crosspost'`** — a **new source value** to distinguish programmatically-published rows from `source = 'ig_dm'` captures. (Other poller-set columns — `reel_url`, `platform='ig'`, `status='captured'`, `quick_notes` — follow the same convention as the existing insert.)

This makes the pipeline a full circle: **capture → recreate → publish → re-catalog**, so a cross-posted reel shows up in the Reel DNA spreadsheet exactly like a DM'd one, and never double-counts if it later boomerangs back through DM/poll.

---

## Recommendation

Ranked:

1. **Pursue FB→IG native crosspost first.** It's ToS-clean, needs **no new permissions and no App Review**, and is the lowest-effort way to get FB reels onto IG. Accept that control is coarse (reel-format-limited, mirror-only). This delivers value immediately.
2. **Pursue the IG Content Publishing API second**, as the "real control" option — but only after two prerequisites are solved: (a) the **public-video-hosting** requirement (`video_url` must be publicly fetchable by Meta), and (b) **App Review for `instagram_content_publish`**. Worth the investment when per-reel caption/timing control is genuinely needed.
3. **Avoid YT download/reupload entirely** as a scraping path. It breaks both YouTube and IG ToS and contradicts the project's standing "no scraping, no yt-dlp" posture. The *only* acceptable YT→IG route is the owner's **own master files** fed through option 2 — never a YouTube download.

Why this order: option 1 ships today at near-zero cost and risk; option 2 is strictly more capable but gated on infra + review work, so it's the planned second phase; option 3's only legitimate form is already covered by option 2, and its scraping form is a non-starter.

## App Review Caveat — what's actually blocked

Be honest about ship-readiness: **anything using the IG Content Publishing API (option 2) is blocked behind App Review / Advanced Access** for `instagram_content_publish`. This is the **exact same gate** that keeps the DM capture flow on polling today. So option 2 is a **"design now, ship after review"** item — it does not work out of the box. Only **option 1 (FB→IG native crosspost)** is available without clearing that gate.
