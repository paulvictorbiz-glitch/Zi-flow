/* =========================================================
   DetailPanel — L1 PRESENTATION. The "data inside that tab" panel
   shown when a tile is opened (DETAIL state). The selected gold cube
   sits top-right (rendered by RubikCube); this panel fills the rest.

   Pure DOM + CSS, prop-driven. The "Open full page" action calls back
   to L2 (which uses openInApp from L0). No store access here.

   Props:
     page     — { key, label, link, blurb } | null
     face     — { key, label, color } | null
     metric   — string headline stat
     onOpen(link)   — open the real page in /app (link may be null)
     onBack()       — return to the exploded grid
   ========================================================= */
import React from "react";

export function DetailPanel({ page, face, metric = "", onOpen = () => {}, onBack = () => {} }) {
  if (!page) return null;
  const comingSoon = !page.link;

  return (
    <aside className="s3d-detail s3d-detail--in" style={{ "--s3d-face": face ? face.color : "#7fd9ff" }}>
      <button type="button" className="s3d-detail-back" onClick={onBack} aria-label="Back to grid">
        ← grid
      </button>

      {face && <div className="s3d-detail-cat">{face.label}</div>}
      <h1 className="s3d-detail-title">{page.label}</h1>

      <div className="s3d-detail-metric">
        <span className="s3d-detail-metric-val">{metric || "—"}</span>
        <span className="s3d-detail-metric-cap">live</span>
      </div>

      <p className="s3d-detail-blurb">{page.blurb}</p>

      {comingSoon ? (
        <div className="s3d-detail-soon">Coming soon</div>
      ) : (
        <button type="button" className="s3d-detail-open" onClick={() => onOpen(page.link)}>
          Open full page in app →
        </button>
      )}
    </aside>
  );
}

export default DetailPanel;
