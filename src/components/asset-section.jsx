/* =========================================================
   AssetSection — pure, presentational collapsible section.

   Used by ReelAssets to wrap each asset type (Footage, Locations,
   Thumbnails, News) in a collapsible block with an always-visible
   count badge and a chevron.

   Dependency-light: only React. CSS classes (asset-section,
   asset-section-head, asset-count-badge, asset-empty,
   asset-section-body) are defined in reel-dna.css (owned elsewhere).
   ========================================================= */

import React, { useState } from "react";

export function AssetSection({
  icon,
  label,
  count,
  defaultOpen = false,
  compact = false,
  emptyText,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);

  const isEmpty = count === 0 || !children;

  return (
    <div className={"asset-section" + (compact ? " compact" : "")}>
      <button
        type="button"
        className="asset-section-head"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {icon != null && <span className="asset-section-icon">{icon}</span>}
        <span className="asset-section-label">{label}</span>
        <span className={"asset-count-badge" + (count === 0 ? " is-zero" : "")}>
          {count}
        </span>
        <span className="asset-section-chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="asset-section-body">
          {isEmpty ? (
            <div className="asset-empty">{emptyText || "None"}</div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}

export default AssetSection;
