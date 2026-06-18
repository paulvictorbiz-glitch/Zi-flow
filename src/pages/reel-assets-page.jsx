/* =========================================================
   ReelAssetsPage — full-screen "Assets" takeover for a single
   Reel DNA card. Pure/presentational: all data arrives via props
   (item, assets, counts) from reel-dna.jsx, which owns the
   useReelDnaAssets() integration and renders this conditionally.

   Renders the page header (title + Pull-from-pipeline + Back) and
   the ReelAssets panel with every section expanded (allOpen).
   ========================================================= */

import React from "react";
import { ReelAssets } from "../components/reel-assets.jsx";

export function ReelAssetsPage({ item, assets, counts, onBack, isOwner, actions }) {
  return (
    <div className="rd-assets-page">
      <div className="page-head">
        <div className="titles">
          <h1>Assets</h1>
          <div className="sub">{item?.reelUrl || ""}</div>
        </div>
        <div className="actions">
          {item?.reelId ? (
            <button
              type="button"
              className="rd-pull-btn"
              title={
                "Pull footage, locations and news already linked to the " +
                "pipeline reel (" + item.reelId + ") into this card's assets."
              }
              onClick={() => actions?.seedAssetsFromPipeline?.(item)}
            >
              ↓ Pull from pipeline reel
            </button>
          ) : null}
          <button type="button" className="rd-back-btn" onClick={onBack}>
            ← Back
          </button>
        </div>
      </div>

      <ReelAssets
        item={item}
        assets={assets}
        allOpen
        isOwner={isOwner}
        actions={actions}
      />
    </div>
  );
}
