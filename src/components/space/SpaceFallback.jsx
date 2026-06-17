/* =========================================================
   SpaceFallback — L1 PRESENTATION. Flat, dependency-free grid shown
   when WebGL is unavailable or the user prefers reduced motion. Built
   from the SAME L0 config so it stays in sync with the 3D version.

   Pure DOM/CSS. Each tile opens its real page in /app.

   Props:
     faces, pages   — from space-cube-config
     metrics        — { [pageKey]: string }
     onOpen(link)
   ========================================================= */
import React from "react";

export function SpaceFallback({ faces = [], pages = [], metrics = {}, onOpen = () => {} }) {
  return (
    <div className="s3d-fallback">
      <h1 className="s3d-fallback-title">Workspace · Space</h1>
      <p className="s3d-fallback-sub">A flat map of your workspace (3D unavailable on this device).</p>
      <div className="s3d-fallback-grid">
        {faces.map((f) => (
          <section key={f.key} className="s3d-fallback-face" style={{ "--s3d-face": f.color }}>
            <h2 className="s3d-fallback-face-title">{f.label}</h2>
            <div className="s3d-fallback-tiles">
              {pages.filter(p => p.face === f.key).map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={"s3d-fallback-tile" + (p.link ? "" : " s3d-fallback-tile--soon")}
                  onClick={() => onOpen(p.link)}
                  disabled={!p.link}
                >
                  <span className="s3d-fallback-tile-name">{p.label}</span>
                  <span className="s3d-fallback-tile-metric">{metrics[p.key] || ""}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default SpaceFallback;
