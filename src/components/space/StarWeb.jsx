/* =========================================================
   StarWeb — L1 PRESENTATION. The animated SVG background:
   star-like points + a subtle, slowly-shifting connection web.

   Pure SVG + CSS (no three.js, no deps). Rendered BEHIND the
   transparent R3F canvas. Nodes/edges are computed once; the drift
   and twinkle are CSS animations, so it's cheap. Honours reduced
   motion by freezing animation.

   Props:
     reduced — boolean, skip motion when true
   ========================================================= */
import React, { useMemo } from "react";

const VW = 1000;
const VH = 1000;
const NODE_COUNT = 46;
const LINK_DIST = 200; // connect nodes closer than this (viewBox units)

function buildGraph() {
  // deterministic-ish pseudo-random so SSR/build is stable
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const nodes = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    nodes.push({
      id: i,
      x: rand() * VW,
      y: rand() * VH,
      r: 0.6 + rand() * 1.8,
      delay: (rand() * 6).toFixed(2),
      dur: (5 + rand() * 6).toFixed(2),
    });
  }
  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      if (dx * dx + dy * dy < LINK_DIST * LINK_DIST) {
        edges.push({ a: i, b: j, delay: ((i + j) % 7).toString() });
      }
    }
  }
  return { nodes, edges };
}

export function StarWeb({ reduced = false }) {
  const { nodes, edges } = useMemo(() => buildGraph(), []);

  return (
    <svg
      className={"s3d-starweb" + (reduced ? " s3d-starweb--still" : "")}
      viewBox={`0 0 ${VW} ${VH}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <g className="s3d-web-lines">
        {edges.map((e, i) => (
          <line
            key={i}
            x1={nodes[e.a].x}
            y1={nodes[e.a].y}
            x2={nodes[e.b].x}
            y2={nodes[e.b].y}
            className="s3d-web-line"
            style={{ animationDelay: e.delay + "s" }}
          />
        ))}
      </g>
      <g className="s3d-web-stars">
        {nodes.map((p) => (
          <circle
            key={p.id}
            cx={p.x}
            cy={p.y}
            r={p.r}
            className="s3d-star"
            style={{ animationDelay: p.delay + "s", animationDuration: p.dur + "s" }}
          />
        ))}
      </g>
    </svg>
  );
}

export default StarWeb;
