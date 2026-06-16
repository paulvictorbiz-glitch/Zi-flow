/* =========================================================
   GamifyPanel — the My Work skill panel for one editor.

   Collapsible (toggled by a 🎮 button in the page header via the
   `open` prop). Shows the editor's spider chart, level + EXP bar,
   medal, and a small "views" sparkline of their reels' social
   performance (reuses a tiny inline SVG sparkline).

   Renders nothing when gamify is disabled.
   ========================================================= */

import React from "react";
import { useWorkflow } from "../store/store.jsx";
import SpiderChart from "./SpiderChart.jsx";
import MedalBadge from "./MedalBadge.jsx";
import { levelForXp, medalProgress, MEDAL_TIERS } from "../lib/gamify-data.jsx";
import "./gamify.css";

/* Minimal inline sparkline (the monitor one isn't exported). */
function MiniSparkline({ values = [], color = "var(--c-cyan)", width = 220, height = 40 }) {
  if (!values.length) {
    return <div style={{ fontSize: 10, color: "var(--fg-mute)", fontFamily: "var(--f-mono)" }}>
      No view data yet
    </div>;
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1 || 1)) * width;
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export default function GamifyPanel({ personId, open = true }) {
  const { gamifyEnabled, gamifyProgress, reels } = useWorkflow();
  if (!gamifyEnabled || !open) return null;

  const progress = gamifyProgress.find(p => p.personId === personId);
  const scores = progress?.skillScores || {};
  const totalXp = progress?.totalXp || 0;
  const { current, next, progress: bandPct } = levelForXp(totalXp);
  const { current: curMedal, target: medalTarget, progress: medalPct } = medalProgress(scores);

  // Simple "views" series from this editor's completed reels (placeholder
  // metric: clip-count proxy until real social analytics are wired per reel).
  const views = (reels || [])
    .filter(r => r.owner === personId && r.stage === "completed")
    .slice(0, 12)
    .map(r => Number(r.detail?.views || 0))
    .reverse();

  return (
    <div className="gf-sidebar" style={{ marginBottom: 16 }}>
      <div className="gf-sidebar-title">🎮 Your skill progress</div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 220px) 1fr", gap: 18, alignItems: "center" }}>
        <SpiderChart scores={scores} size={200} labelMode="short" fillColor="var(--c-cyan)" />

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Level + EXP */}
          <div>
            <div className="gf-level-now">
              <span className="gf-level-num">LV {current.level}</span>
              <span className="gf-level-title">{current.title}</span>
            </div>
            <div className="gf-xpbar" style={{ marginTop: 6 }}>
              <div className="gf-xpbar-fill" style={{ width: `${Math.round(bandPct * 100)}%` }} />
            </div>
            <div className="gf-xp-meta">
              <span>{totalXp.toLocaleString()} XP</span>
              {next && <span>{next.xp.toLocaleString()} → LV {next.level}</span>}
            </div>
          </div>

          {/* Medal */}
          <div className="gf-medal-block">
            <MedalBadge medal={curMedal} progress={medalPct} size={52} />
            <div className="gf-medal-info">
              <div className="gf-medal-title">
                {curMedal === "none" ? "No medal yet" : MEDAL_TIERS.find(t => t.id === curMedal)?.title}
              </div>
              <div className="gf-medal-next dim">{Math.round(medalPct * 100)}% → {medalTarget.title}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Views graph */}
      <div>
        <div className="gf-sidebar-title" style={{ marginBottom: 6 }}>Reel views</div>
        <MiniSparkline values={views} />
      </div>
    </div>
  );
}
