/* =========================================================
   useReelDnaAssets — the SINGLE integration point that wires the
   pure store selectors (resolveReelDnaAssets / assetCountsForReelDna)
   to live provider data, so the presentational asset components stay
   pure (data-via-props only).

   Pulls the four store-backed sources from useWorkflow() and the
   separate `locations` slice from useLocations() (guaranteed to be
   inside <LocationsProvider> by src/app.jsx's AppShell wrap), then
   memoizes the resolved assets + counts for a given reel_dna id.
   ========================================================= */

import React, { useMemo } from "react";
import { useWorkflow, resolveReelDnaAssets, assetCountsForReelDna } from "../store/store.jsx";
import { useLocations } from "../lib/locations-data.jsx";

export function useReelDnaAssets(reelDnaId) {
  const { reelDnaAssets, attachedFootage, thumbnailDna, monitorEvents, musicTracks } = useWorkflow();
  const { locations } = useLocations();

  // Defensive defaults — never hand undefined to the pure selectors.
  const safeReelDnaAssets = reelDnaAssets || [];
  const safeAttachedFootage = attachedFootage || [];
  const safeLocations = locations || [];
  const safeThumbnailDna = thumbnailDna || [];
  const safeMonitorEvents = monitorEvents || [];
  const safeMusicTracks = musicTracks || [];

  return useMemo(() => {
    const sources = {
      reelDnaAssets: safeReelDnaAssets,
      attachedFootage: safeAttachedFootage,
      locations: safeLocations,
      thumbnailDna: safeThumbnailDna,
      monitorEvents: safeMonitorEvents,
      musicTracks: safeMusicTracks,
    };
    const assets = resolveReelDnaAssets(reelDnaId, sources);
    const counts = assetCountsForReelDna(reelDnaId, sources);
    return { assets, counts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    reelDnaId,
    safeReelDnaAssets,
    safeAttachedFootage,
    safeLocations,
    safeThumbnailDna,
    safeMonitorEvents,
    safeMusicTracks,
  ]);
}
