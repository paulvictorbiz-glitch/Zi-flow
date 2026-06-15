/* =========================================================
   AssetFan — L1 PRESENTATION (prop-driven, no data imports)

   v3 "RADIAL_FAN_DISPATCH" look: the active gene's assets render as a
   stack of cards that are slightly offset/rotated behind the front card,
   and fan out a little more on hover. Switching genes swaps the cards.

   Pure DOM/CSS (NOT 3D). Below ~720px it collapses to a clean vertical
   stack so it never sprawls / occludes the timeline.

   Props:
     gene     — { key, label, color, blurb, assets:[{name,kind,info,
                  downloadUrl,swapHint}] } | null
     onClose  — () => void   (optional; tap-to-dismiss)

   Must NOT import reel-dna-demo.jsx — all data is via props.
   ========================================================= */
import React, { useEffect, useState } from "react";
import "./asset-fan.css";

const MOBILE_QUERY = "(max-width: 720px)";

function useIsMobile() {
  const get = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_QUERY).matches;

  const [isMobile, setIsMobile] = useState(get);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else mql.removeListener(onChange);
    };
  }, []);

  return isMobile;
}

/* Stacked transform for card i of n. Front card (i=0) is centered; the
   rest peek out behind it, offset + rotated. On hover the whole stack
   fans out a bit more (driven by the `fanned` flag → CSS var). */
function stackStyle(i, n, color, fanned) {
  // peel factor: how far each card sits behind the front one
  const depth = i;                       // 0 = front
  const dir = i % 2 === 0 ? 1 : -1;      // alternate sides
  const spread = fanned ? 22 : 12;       // px nudge per depth level
  const rot = fanned ? 3.2 : 1.6;        // deg per depth level
  const x = dir * depth * spread;
  const y = depth * (fanned ? -16 : -10);
  const r = dir * depth * rot;
  const scale = 1 - depth * 0.04;
  return {
    "--accent": color,
    transform: `translate(calc(-50% + ${x}px), ${y}px) rotate(${r}deg) scale(${scale})`,
    zIndex: 100 - depth,
    opacity: depth > 3 ? 0 : 1,          // cap visible depth
    animationDelay: `${i * 45}ms`,
  };
}

function AssetCard({ asset, color, index, total, isMobile, fanned }) {
  const style = isMobile
    ? { "--accent": color, animationDelay: `${index * 45}ms` }
    : stackStyle(index, total, color, fanned);

  return (
    <div
      className={`asset-card${isMobile ? " asset-card--stacked" : " asset-card--deck"}`}
      style={style}
    >
      <div className="asset-card__head">
        <span className="asset-card__kind">{asset.kind}</span>
        <span className="asset-card__active-dot" aria-hidden="true">●</span>
      </div>
      <span className="asset-card__name">{asset.name}</span>
      <p className="asset-card__info">{asset.info}</p>
      <div className="asset-card__actions">
        <a
          className="asset-card__btn asset-card__btn--dl"
          href={asset.downloadUrl || "#"}
          target="_blank"
          rel="noreferrer"
        >
          Download
        </a>
        <label className="asset-card__btn asset-card__btn--swap" title={asset.swapHint || "Swap with your own"}>
          <span>Swap</span>
          <input
            type="file"
            className="asset-card__file"
            onChange={() => {/* POC stub — no-op */}}
          />
        </label>
      </div>
    </div>
  );
}

export function AssetFan({ gene = null, onClose }) {
  const isMobile = useIsMobile();
  const [fanned, setFanned] = useState(false);

  if (!gene) {
    return <div className="asset-fan asset-fan--empty" aria-hidden="true" />;
  }

  const assets = Array.isArray(gene.assets) ? gene.assets : [];
  const accent = gene.color || "var(--c-cyan)";

  return (
    <div
      className={`asset-fan${isMobile ? " asset-fan--stacked" : " asset-fan--deck"}`}
      style={{ "--accent": accent }}
      role="group"
      aria-label={`${gene.label} assets`}
      onMouseEnter={() => setFanned(true)}
      onMouseLeave={() => setFanned(false)}
    >
      <header className="asset-fan__header">
        <div className="asset-fan__titles">
          <span className="asset-fan__eyebrow">ACTIVE NODE LINK</span>
          <h3 className="asset-fan__title" style={{ color: accent }}>
            {gene.label}
          </h3>
        </div>
        {onClose && (
          <button className="asset-fan__close" onClick={onClose} aria-label="Dismiss">
            ×
          </button>
        )}
      </header>

      <div className="asset-fan__cards">
        {assets.map((a, i) => (
          <AssetCard
            key={a.name + i}
            asset={a}
            color={accent}
            index={i}
            total={assets.length}
            isMobile={isMobile}
            fanned={fanned}
          />
        ))}
      </div>
    </div>
  );
}

export default AssetFan;
