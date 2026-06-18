/* =========================================================
   ReelAssetsPanel — compact, collapsed-by-default assets column
   shown alongside a reel card.

   Heading button opens the full assets view (onOpenFull). Below it,
   ReelAssets renders the four sections collapsed (allOpen defaults
   false), each with per-item detach. Attach controls (pickers) are
   intentionally OUT of scope here — the seed/attach flow lives on the
   full page. Pure: data arrives via props.
   ========================================================= */

import React from "react";
import { ReelAssets } from "./reel-assets.jsx";

export function ReelAssetsPanel({
  item,
  assets,
  counts,
  onOpenFull,
  actions,
  isOwner,
}) {
  return (
    <div className="rd-assets-col">
      <button
        type="button"
        className="rd-assets-head"
        onClick={() => onOpenFull?.(item)}
      >
        Assets <span className="asset-total-badge">{counts?.total ?? 0}</span> →
      </button>
      <ReelAssets
        item={item}
        assets={assets}
        compact
        isOwner={isOwner}
        actions={actions}
      />
    </div>
  );
}

export default ReelAssetsPanel;
