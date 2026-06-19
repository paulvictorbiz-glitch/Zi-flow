/* =========================================================
   PacingSparkline — PURE, props-driven SVG of a reel's cut-pacing.

   Contract H8 + H4. Renders `pacing.pacing_curve[]` (a raw list of
   per-shot durations in seconds; the WORKER writes it via the
   PySceneDetect ContentDetector pass) as a baseline-anchored bar
   sparkline, plus a label strip:
     asl · median_shot · cuts_per_sec · shot_count · total_duration
     + rhythm_label chip + front_loaded badge.

   PURE: no store, no fetch, no side effects. Safe on a missing /
   empty / malformed `pacing` prop (renders an em-dash placeholder or
   nothing). Every numeric read is guarded — the worker guards its math
   but realtime rows can arrive partially populated.

   H4 pacing shape:
     { asl, median_shot, cuts_per_sec, shot_count, total_duration,
       rhythm_label, front_loaded, pacing_curve[],
       detector, threshold, computed_at }
   ========================================================= */

import React from "react";
import "./pacing-sparkline.css";

/* --- pure formatting guards (no NaN/undefined/Infinity ever rendered) --- */
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const fmt = (v, digits = 2) => (isNum(v) ? v.toFixed(digits) : "—");
const fmtSec = (v) => (isNum(v) ? `${v.toFixed(v >= 10 ? 0 : 1)}s` : "—");
const fmtInt = (v) => (isNum(v) ? String(Math.round(v)) : "—");

/* rhythm_label is worker-authored, but be defensive about casing. */
const RHYTHM_CLASS = {
  frenetic: "ps-chip--frenetic",
  punchy: "ps-chip--punchy",
  steady: "ps-chip--steady",
  languid: "ps-chip--languid",
};

// SVG viewBox is unit-agnostic; CSS scales it. Cap how many bars we draw
// so a 600-shot reel doesn't emit 600 <rect>s (worker keeps the full curve;
// UI caps render length per H4: "pacing_curve = shot_durations raw list
// (UI caps render length)").
const MAX_BARS = 120;
const VB_W = 240;
const VB_H = 40;

function downsample(curve, cap) {
  if (curve.length <= cap) return curve;
  // bucket into `cap` groups, take the max per bucket so spikes survive.
  const out = [];
  const step = curve.length / cap;
  for (let i = 0; i < cap; i++) {
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);
    let m = -Infinity;
    for (let j = start; j < end; j++) if (isNum(curve[j]) && curve[j] > m) m = curve[j];
    out.push(m === -Infinity ? 0 : m);
  }
  return out;
}

export default function PacingSparkline({ pacing }) {
  // ── null / empty-state safety ────────────────────────────────────────
  if (!pacing || typeof pacing !== "object") return null;

  const rawCurve = Array.isArray(pacing.pacing_curve) ? pacing.pacing_curve : [];
  const numericCurve = rawCurve.filter(isNum);
  const hasCurve = numericCurve.length > 0;

  const rhythm = typeof pacing.rhythm_label === "string" ? pacing.rhythm_label : "";
  const rhythmClass = RHYTHM_CLASS[rhythm.toLowerCase()] || "ps-chip--steady";
  const frontLoaded = pacing.front_loaded === true;

  // ── sparkline geometry (pure) ────────────────────────────────────────
  let bars = null;
  if (hasCurve) {
    const curve = downsample(numericCurve, MAX_BARS);
    const max = Math.max(...curve, 0.0001); // guard divide-by-zero
    const n = curve.length;
    const gap = n > 1 ? VB_W / n : VB_W;
    const barW = Math.max(gap * 0.7, 0.5);
    bars = curve.map((d, i) => {
      const h = Math.max((Math.max(d, 0) / max) * (VB_H - 2), 0.5);
      const x = i * gap + (gap - barW) / 2;
      const y = VB_H - h;
      return <rect key={i} className="ps-bar" x={x} y={y} width={barW} height={h} rx={0.5} />;
    });
  }

  return (
    <div className="ps-wrap" data-rhythm={rhythm.toLowerCase() || undefined}>
      <div className="ps-spark">
        {hasCurve ? (
          <svg
            className="ps-svg"
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Cut pacing: ${numericCurve.length} shots${rhythm ? `, ${rhythm}` : ""}`}
          >
            <line className="ps-base" x1="0" y1={VB_H - 0.5} x2={VB_W} y2={VB_H - 0.5} />
            {bars}
          </svg>
        ) : (
          <div className="ps-empty">no shot data</div>
        )}
      </div>

      <div className="ps-labels">
        {rhythm ? <span className={`ps-chip ${rhythmClass}`}>{rhythm}</span> : null}
        {frontLoaded ? (
          <span className="ps-badge" title="Earlier shots are notably shorter than later ones">
            front-loaded
          </span>
        ) : null}

        <span className="ps-metric" title="Average shot length">
          <b>ASL</b> {fmtSec(pacing.asl)}
        </span>
        <span className="ps-metric" title="Median shot length">
          <b>MED</b> {fmtSec(pacing.median_shot)}
        </span>
        <span className="ps-metric" title="Cuts per second">
          <b>CPS</b> {fmt(pacing.cuts_per_sec, 2)}
        </span>
        <span className="ps-metric" title="Total shots">
          <b>SHOTS</b> {fmtInt(pacing.shot_count)}
        </span>
        <span className="ps-metric" title="Total duration">
          <b>DUR</b> {fmtSec(pacing.total_duration)}
        </span>
      </div>
    </div>
  );
}

export { PacingSparkline };
