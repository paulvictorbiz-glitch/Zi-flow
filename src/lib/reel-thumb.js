/* =========================================================
   reelThumb(reel) — derive a poster thumbnail for a pipeline reel with
   NO schema change.

   The `reels` table has no image column. But many reels carry a platform
   URL (attachUrl, or one of `links`). For YouTube URLs we can build a
   zero-key thumbnail client-side by reusing the Thumbnail-DNA helpers
   (extractYouTubeId + thumbnailUrlFromId). IG / TikTok / Facebook have no
   public by-id thumbnail → return null so the caller falls back to the
   existing colored-bar card look (nothing regresses).

   Returns { url, fallbackUrl } | null. `fallbackUrl` is the hqdefault
   image for the <img> onError swap (maxres doesn't exist for every video).
   ========================================================= */
import {
  extractYouTubeId,
  thumbnailUrlFromId,
  thumbnailFallbackUrlFromId,
} from "./thumbnail-dna.jsx";

/* Pull the first candidate URL off a reel: the primary attach link, then
   any of its text `links`. Reels store links as plain strings. */
function candidateUrls(reel) {
  if (!reel) return [];
  const out = [];
  if (reel.attachUrl) out.push(reel.attachUrl);
  if (Array.isArray(reel.links)) {
    for (const l of reel.links) if (typeof l === "string") out.push(l);
  }
  return out;
}

export function reelThumb(reel) {
  for (const url of candidateUrls(reel)) {
    const id = extractYouTubeId(url);
    if (id) {
      return {
        url: thumbnailUrlFromId(id),
        fallbackUrl: thumbnailFallbackUrlFromId(id),
      };
    }
  }
  return null;
}

export default reelThumb;
