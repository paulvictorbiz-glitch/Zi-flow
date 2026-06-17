/* =========================================================
   StarWeb — L1 PRESENTATION. Animated SVG atmosphere behind the
   cube: star-like points, a subtly-shifting connection web, and a
   few shooting stars that whiz past occasionally.

   Pure SVG + CSS (no three.js, no deps). The nebula clouds come from
   CSS gradients on .s3d-root; this layer adds the moving detail.
   Honours reduced motion by freezing animation.

   Props:
     reduced — boolean, skip motion when true
   ========================================================= */
import React, { useMemo } from "react";

const VW = 1000;
const VH = 1000;
const NODE_COUNT = 46;
const LINK_DIST = 200;

/* a few shooting stars: start point, travel vector, timing. Long, spread
   delays so they appear only now and then. */
/* dur here is the FULL cycle (the streak itself only occupies the first
   ~11% of it), so a long dur = they appear only occasionally. */
const SHOOTERS = [
  { x: 120, y: 120, dx: 240,  dy: 120, delay: 3,  dur: 17 },
  { x: 760, y: 80,  dx: -260, dy: 150, delay: 11, dur: 23 },
  { x: 300, y: 420, dx: 300,  dy: 90,  delay: 19, dur: 19 },
  { x: 880, y: 520, dx: -200, dy: 180, delay: 28, dur: 27 },
];

function buildGraph() {
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const nodes = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    nodes.push({
      id: i, x: rand() * VW, y: rand() * VH,
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
      <defs>
        <linearGradient id="s3d-shoot-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="60%" stopColor="#cfe4ff" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
        </linearGradient>
      </defs>

      <g className="s3d-web-lines">
        {edges.map((e, i) => (
          <line
            key={i}
            x1={nodes[e.a].x} y1={nodes[e.a].y}
            x2={nodes[e.b].x} y2={nodes[e.b].y}
            className="s3d-web-line"
            style={{ animationDelay: e.delay + "s" }}
          />
        ))}
      </g>

      <g className="s3d-web-stars">
        {nodes.map((p) => (
          <circle
            key={p.id} cx={p.x} cy={p.y} r={p.r}
            className="s3d-star"
            style={{ animationDelay: p.delay + "s", animationDuration: p.dur + "s" }}
          />
        ))}
      </g>

      {!reduced && (
        <g className="s3d-shooters">
          {SHOOTERS.map((s, i) => (
            <g
              key={i}
              className="s3d-shooter"
              style={{
                "--sx": s.x, "--sy": s.y, "--dx": s.dx + "px", "--dy": s.dy + "px",
                animationDelay: s.delay + "s", animationDuration: s.dur + "s",
              }}
            >
              <line x1={s.x - 70} y1={s.y - 35} x2={s.x} y2={s.y} stroke="url(#s3d-shoot-grad)" strokeWidth="2" strokeLinecap="round" />
              <circle cx={s.x} cy={s.y} r="2.2" fill="#ffffff" />
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

export default StarWeb;
