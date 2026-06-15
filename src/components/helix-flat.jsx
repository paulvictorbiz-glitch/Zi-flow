/* =========================================================
   HelixFlat — L1 PRESENTATION (prop-driven, no data imports)

   The flat 2D "v3" double-helix: two angled neon strands (blue + violet)
   crossing down the frame with horizontal gene "rungs". Each rung is a
   gene node — hovering/selecting it drives the parent's hoveredGene, the
   same contract the 3D DnaHelix used, so it's a drop-in swap.

   This is a pure SVG render (no WebGL) modeled on the v3 mockup. The real
   Spline/3D version is a later pass; this ships the look now.

   Props (identical to DnaHelix so the composition layer is unchanged):
     genes        — [{ key, label, color, helixT, ... }]
     hoveredGene  — string | null   (parent-controlled)
     onHoverGene  — (key|null) => void
     onSelectGene — (key) => void

   Must NOT import reel-dna-demo.jsx.
   ========================================================= */
import React, { useMemo } from "react";
import "./helix-flat.css";

/* SVG viewBox. Tall portrait frame; strands are skewed for the angled look. */
const VB_W = 520;
const VB_H = 1000;

/* Two strands modeled as sine waves down Y, phase-shifted by PI so they
   cross. Skew (SKEW_X) shifts X linearly with Y for the leaning look. */
const TURNS = 2.4;          // how many times the strands wind
const AMP = 150;            // horizontal swing of each strand
const SKEW_X = 150;         // total horizontal lean top→bottom
const CENTER_X = VB_W / 2;
const PAD_Y = 70;           // vertical padding so caps aren't clipped

function strandX(t, phase) {
  // t: 0..1 down the strand. phase: 0 or PI.
  const wave = Math.sin(t * Math.PI * 2 * TURNS + phase) * AMP;
  const lean = (t - 0.5) * SKEW_X;
  return CENTER_X + wave + lean;
}
function strandY(t) {
  return PAD_Y + t * (VB_H - PAD_Y * 2);
}

function buildPath(phase, steps = 120) {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = strandX(t, phase);
    const y = strandY(t);
    d += (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1) + " ";
  }
  return d.trim();
}

export function HelixFlat({
  genes = [],
  hoveredGene = null,
  onHoverGene = () => {},
  onSelectGene = () => {},
}) {
  const pathA = useMemo(() => buildPath(0), []);
  const pathB = useMemo(() => buildPath(Math.PI), []);

  // Place each gene as a rung between the two strands at its helixT.
  const rungs = useMemo(
    () =>
      genes.map((g) => {
        const t = typeof g.helixT === "number" ? g.helixT : 0.5;
        const x1 = strandX(t, 0);
        const x2 = strandX(t, Math.PI);
        const y = strandY(t);
        // node sits on the left strand end of the rung
        const nodeX = x1;
        const labelLeft = x1 < x2;
        return { g, x1, x2, y, nodeX, labelLeft };
      }),
    [genes]
  );

  return (
    <div className="hx" role="group" aria-label="Reel DNA helix">
      <svg
        className="hx-svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="hx-strand-a" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5fdcff" />
            <stop offset="100%" stopColor="#6aa8ff" />
          </linearGradient>
          <linearGradient id="hx-strand-b" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#b06bff" />
            <stop offset="100%" stopColor="#7a6bff" />
          </linearGradient>
          <filter id="hx-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Rungs (drawn under the strands so strands cap them) */}
        <g className="hx-rungs">
          {rungs.map(({ g, x1, x2, y }) => {
            const active = hoveredGene === g.key;
            return (
              <line
                key={"r-" + g.key}
                x1={x1}
                y1={y}
                x2={x2}
                y2={y}
                stroke={g.color}
                strokeWidth={active ? 3 : 1.6}
                opacity={hoveredGene && !active ? 0.18 : active ? 0.95 : 0.5}
                className="hx-rung"
              />
            );
          })}
        </g>

        {/* Strands */}
        <path
          d={pathA}
          className="hx-strand"
          stroke="url(#hx-strand-a)"
          filter="url(#hx-glow)"
        />
        <path
          d={pathB}
          className="hx-strand"
          stroke="url(#hx-strand-b)"
          filter="url(#hx-glow)"
        />

        {/* Gene nodes — interactive hit targets */}
        <g className="hx-nodes">
          {rungs.map(({ g, nodeX, y }) => {
            const active = hoveredGene === g.key;
            const dim = hoveredGene && !active;
            return (
              <g
                key={"n-" + g.key}
                className={"hx-node" + (active ? " is-active" : "")}
                transform={`translate(${nodeX} ${y})`}
                onMouseEnter={() => onHoverGene(g.key)}
                onMouseLeave={() => onHoverGene(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectGene(g.key);
                }}
                style={{ cursor: "pointer", opacity: dim ? 0.4 : 1 }}
              >
                {/* invisible larger hit area */}
                <circle r={20} fill="transparent" />
                {active && (
                  <circle r={16} fill="none" stroke={g.color} strokeWidth={1.5} opacity={0.5} className="hx-node-ring" />
                )}
                <circle
                  r={active ? 9 : 6}
                  fill={g.color}
                  filter="url(#hx-glow)"
                  className="hx-node-core"
                />
                <circle r={active ? 3.5 : 2.5} fill="#fff" opacity={0.9} />
              </g>
            );
          })}
        </g>
      </svg>

      {/* HTML labels (crisper than SVG text, easier to style) */}
      <div className="hx-labels">
        {rungs.map(({ g, nodeX, y }) => {
          const active = hoveredGene === g.key;
          const dim = hoveredGene && !active;
          return (
            <button
              key={"l-" + g.key}
              className={"hx-label" + (active ? " is-active" : "")}
              style={{
                left: `${(nodeX / VB_W) * 100}%`,
                top: `${(y / VB_H) * 100}%`,
                "--gene": g.color,
                opacity: dim ? 0.4 : 1,
              }}
              onMouseEnter={() => onHoverGene(g.key)}
              onMouseLeave={() => onHoverGene(null)}
              onClick={() => onSelectGene(g.key)}
            >
              {g.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default HelixFlat;
