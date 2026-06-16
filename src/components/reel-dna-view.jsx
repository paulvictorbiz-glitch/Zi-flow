/* =========================================================
   ReelDnaView — L2 COMPOSITION for a REAL captured reel.

   Brings the public landing-page "DNA breakdown" experience
   (DNA helix → hover a gene → its lane lights up on the timeline,
   its assets fan out) onto the INTERNAL Reel DNA page, driven by a
   real Supabase reel_dna row instead of the static landing demo.

   It reuses the same L1 presentation components the landing page uses
   so the two can't drift:
     · HelixFlat    — the gene-node DNA strand (parent-controlled hover)
     · AssetFan     — the active gene's asset cards
     · TimelineView — the read-only multi-lane highlighted timeline
     · ReelPlayer   — embeds the real reel by URL

   The bridge is `deriveReel(item)` below: it turns a reel_dna row
   (5 genes + per-gene jsonb + a timeline[] of segments) into the
   { genes, lanes, timeline, totalSec } shape those components expect —
   assigning each internal gene a color (from the deconstructor's
   GENE_COLOR) and an evenly-spaced helixT, and synthesizing each gene's
   "assets" from its jsonb fields + its timeline segments' download links.

   Per the page contract, only genes that actually carry data are shown
   (falling back to all five if the reel has nothing filled in yet).
   ========================================================= */
import React, { useMemo, useRef, useState, useEffect } from "react";
import { HelixFlat } from "./helix-flat.jsx";
import { AssetFan } from "./asset-fan.jsx";
import { TimelineView } from "./timeline-view.jsx";
import { ReelPlayer } from "./reel-player.jsx";
import { GENES, geneLabel, platformLabel } from "../lib/reel-dna.jsx";
import { GENE_COLOR, parseTs } from "../pages/reel-deconstructor.jsx";
import "./reel-dna-view.css";

/* Resolve a deconstructor CSS var (e.g. "var(--c-cyan)") to a raw hex so
   the SVG helix / asset-fan emissive bits get a real color. HelixFlat &
   AssetFan style with the value directly, and SVG stroke/fill don't take
   var() reliably across the synthesized nodes — so flatten it here. */
const COLOR_HEX = {
  "var(--c-violet)": "#a99bff",
  "var(--c-cyan)":   "#6bd6e0",
  "var(--c-amber)":  "#f5c266",
  "var(--c-green)":  "#7fd49a",
  "var(--c-blue)":   "#7aa6ff",
  "var(--c-grey)":   "#8a98ad",
};
const hex = (cssVar) => COLOR_HEX[cssVar] || cssVar;

/* All possible genes, in helix order: the five real genes + "other"
   (the deconstructor lets segments land on an "other" lane). */
const ALL_GENES = [...GENES, { key: "other", label: "Other" }];

/* Build the asset cards for one gene from its jsonb fields. Mirrors the
   GeneEditor field shapes in reel-dna.jsx so whatever the user typed
   surfaces as a downloadable/inspectable card. Returns []. */
function geneAssets(geneKey, item) {
  const v = item?.[geneKey] || {};
  const out = [];
  const push = (name, info, downloadUrl) =>
    name && out.push({ name, kind: geneKey, info: info || "", downloadUrl: downloadUrl || "", swapHint: "Swap with your own" });

  if (geneKey === "music") {
    push(v.track, v.source, v.link);
  } else if (geneKey === "hook") {
    const span = [v.startTs, v.endTs].filter(Boolean).join(" → ");
    if (span || v.downloadLink) push("Hook clip", span, v.downloadLink);
  } else if (geneKey === "font") {
    const names = (v.names || "").split(",").map(s => s.trim()).filter(Boolean);
    const links = (v.links || "").split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    if (names.length) names.forEach((n, i) => push(n, "Font", links[i] || links[0]));
    else if (links.length) push("Font files", "", links[0]);
  } else if (geneKey === "story") {
    if (v.styleNotes) push("Structure / style", v.styleNotes);
  } else if (geneKey === "sfx") {
    if (v.notes) push("Sound effects", v.notes);
  }
  return out;
}

const GENE_BLURB = {
  music: "The track / audio bed that sets the pacing and mood.",
  font:  "The titles & on-screen type — the typographic hook.",
  hook:  "The opening beat that stops the scroll.",
  sfx:   "Whooshes, risers & impacts that sell every cut.",
  story: "The structure — hook → buildup → payoff.",
  other: "Other assets pulled from this reel.",
};

/* deriveReel(item) — the bridge from a real reel_dna row to the
   landing-page component contract. */
export function deriveReel(item) {
  const timeline = Array.isArray(item?.timeline) ? item.timeline : [];

  // Longest endTs in the timeline → ruler length (min 10s so a sparse
  // reel still reads). Falls back to 30s when there are no timed clips.
  const maxEnd = timeline.reduce((mx, s) => {
    const e = parseTs(s.endTs);
    return e != null && e > mx ? e : mx;
  }, 0);
  const totalSec = Math.max(10, Math.ceil(maxEnd) || 0) || 30;

  // Which genes carry data? A gene counts if it owns a timeline segment
  // OR produces at least one synthesized asset card.
  const genesWithSegments = new Set(timeline.map(s => s.gene));
  const built = ALL_GENES
    .map((g, i, arr) => {
      const assets = geneAssets(g.key, item);
      const hasData = genesWithSegments.has(g.key) || assets.length > 0;
      return { ...g, assets, hasData, idx: i, n: arr.length };
    });

  let active = built.filter(g => g.hasData);
  // Fallback: nothing filled yet → show the five canonical genes so the
  // helix isn't empty (matches "only genes with data, else all").
  if (active.length === 0) active = built.filter(g => g.key !== "other");

  const n = active.length;
  const genes = active.map((g, i) => ({
    key: g.key,
    label: g.label,
    color: hex(GENE_COLOR[g.key] || GENE_COLOR.other),
    // Spread evenly down the strand; pad ends so caps aren't clipped.
    helixT: n === 1 ? 0.5 : 0.06 + (i / (n - 1)) * 0.88,
    blurb: GENE_BLURB[g.key] || "",
    assets: g.assets,
  }));

  const lanes = genes.map((g, i) => ({ key: g.key, label: g.label, color: g.color, order: i }));

  // Only keep segments whose lane is actually shown.
  const shownKeys = new Set(genes.map(g => g.key));
  const segs = timeline.filter(s => shownKeys.has(s.gene));

  return { genes, lanes, timeline: segs, totalSec };
}

/* ── The overlay ─────────────────────────────────────────────
   Mirrors the landing HomeView's hover wiring: a deferred,
   cancelable hover-clear so the cursor crossing node→fan doesn't
   drop the active gene. */
export function ReelDnaView({ item, onClose, onDeconstruct }) {
  const { genes, lanes, timeline, totalSec } = useMemo(() => deriveReel(item), [item]);
  const [hoveredGene, setHoveredGene] = useState(null);

  const clearTimer = useRef(null);
  const cancelClear = () => {
    if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
  };
  const clearNow = () => { cancelClear(); setHoveredGene(null); };
  const scheduleClear = () => {
    cancelClear();
    clearTimer.current = setTimeout(() => { setHoveredGene(null); clearTimer.current = null; }, 120);
  };
  const setGeneNow = (key) => { cancelClear(); setHoveredGene(key == null ? null : key); };
  const onHoverGene = (key) => { if (key == null) scheduleClear(); else setGeneNow(key); };

  useEffect(() => () => cancelClear(), []);

  // Esc to close.
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const activeGene = useMemo(
    () => genes.find((g) => g.key === hoveredGene) || null,
    [genes, hoveredGene]
  );

  const hasTimeline = timeline.length > 0;

  return (
    <div className="rdv-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rdv-modal">
        {/* Header */}
        <div className="rdv-header">
          <div className="rdv-header-title">
            <span className="rdv-label">Reel DNA</span>
            <a className="rdv-url" href={item.reelUrl} target="_blank" rel="noreferrer">
              {item.reelUrl}
            </a>
            <span className="rdv-tag">{platformLabel(item.platform)}</span>
          </div>
          <div className="rdv-header-actions">
            {onDeconstruct && (
              <button className="rdv-btn rdv-btn--ghost" onClick={onDeconstruct}>
                {hasTimeline ? "Edit timeline" : "Build timeline"}
              </button>
            )}
            <button className="rdv-close" onClick={onClose} title="Close (Esc)">✕</button>
          </div>
        </div>

        <div className="rdv-stage">
          {/* Left: the DNA helix with the asset fan floating over it */}
          <div className="rdv-helix-col">
            <span className="rdv-stage-cap">GENETIC_STREAM</span>
            <div className="rdv-helix-wrap">
              <HelixFlat
                genes={genes}
                hoveredGene={hoveredGene}
                onHoverGene={onHoverGene}
                onSelectGene={setGeneNow}
              />
              <div className="rdv-fan-float"
                   onMouseEnter={cancelClear} onMouseLeave={scheduleClear}>
                {activeGene && activeGene.assets.length > 0 && (
                  <AssetFan gene={activeGene} onClose={clearNow} />
                )}
              </div>
            </div>
            {!activeGene && <div className="rdv-helix-hint">Hover a gene node →</div>}
          </div>

          {/* Right: the real reel + the highlighted timeline */}
          <div className="rdv-right-col">
            <div className="rdv-player-col">
              <ReelPlayer sampleReel={{ sourceUrl: item.reelUrl }} preferEmbed={true} />
            </div>

            <div className="rdv-dock">
              {hasTimeline ? (
                <TimelineView
                  segments={timeline}
                  lanes={lanes}
                  totalSec={totalSec}
                  hoveredGene={hoveredGene}
                />
              ) : (
                <div className="rdv-dock-empty">
                  No timeline yet — hover the genes to see this reel's assets, or
                  {onDeconstruct ? (
                    <button className="rdv-link" onClick={onDeconstruct}> build the timeline →</button>
                  ) : " build the timeline."}
                </div>
              )}
              <div className="rdv-dock-foot">
                <span className="rdv-dock-foot-live">
                  <span className="rdv-dock-dot" /> {genes.length} gene{genes.length !== 1 ? "s" : ""} mapped
                </span>
                <span className="rdv-dock-foot-id">
                  Active node: <b>{activeGene ? `DNA-${activeGene.key.toUpperCase()}` : "—"}</b>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReelDnaView;
