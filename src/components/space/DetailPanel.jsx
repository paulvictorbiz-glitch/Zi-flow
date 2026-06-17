/* =========================================================
   DetailPanel — L1 PRESENTATION. The "stats" panel shown when a box
   is opened. Short summary + the most important stats + a small graph,
   plus a link that opens the full page in the real app.

   Pure DOM/SVG/CSS, prop-driven. No store access.

   Props:
     page   — { key, label, link, blurb } | null
     face   — { key, label, color } | null
     detail — { summary, stats:[{label,value}], bars:[{label,value}] }
     metric — short headline stat string
     onOpen(link), onBack()
   ========================================================= */
import React from "react";

function MiniBars({ bars = [], color = "#7fd9ff" }) {
  if (!bars.length) return null;
  const max = Math.max(1, ...bars.map(b => Number(b.value) || 0));
  return (
    <div className="s3d-bars">
      {bars.map((b, i) => (
        <div className="s3d-bar-row" key={i}>
          <span className="s3d-bar-label">{b.label}</span>
          <span className="s3d-bar-track">
            <span className="s3d-bar-fill" style={{ width: ((Number(b.value) || 0) / max) * 100 + "%", background: color }} />
          </span>
          <span className="s3d-bar-val">{b.value}</span>
        </div>
      ))}
    </div>
  );
}

export function DetailPanel({ page, face, detail = {}, metric = "", onOpen = () => {}, onBack = () => {} }) {
  if (!page) return null;
  const comingSoon = !page.link;
  const color = face ? face.color : "#7fd9ff";
  const stats = detail.stats || [];
  const bars = detail.bars || [];

  return (
    <aside className="s3d-detail s3d-detail--in" style={{ "--s3d-face": color }}>
      <button type="button" className="s3d-detail-back" onClick={onBack} aria-label="Back to grid">← grid</button>

      {face && <div className="s3d-detail-cat">{face.label}</div>}
      <h1 className="s3d-detail-title">{page.label}</h1>
      <p className="s3d-detail-summary">{detail.summary || page.blurb}</p>

      {stats.length > 0 && (
        <div className="s3d-stat-cards">
          {stats.map((st, i) => (
            <div className="s3d-stat-card" key={i}>
              <span className="s3d-stat-val">{st.value}</span>
              <span className="s3d-stat-label">{st.label}</span>
            </div>
          ))}
        </div>
      )}

      {bars.length > 0 && (
        <div className="s3d-graph">
          <div className="s3d-graph-title">Breakdown</div>
          <MiniBars bars={bars} color={color} />
        </div>
      )}

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
