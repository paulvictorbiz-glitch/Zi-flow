/* =========================================================
   SpiderChart — pure-SVG radar chart for the Gamify skill set.

   No chart library. Renders an N-axis polygon (default 10, one per
   canonical skill), concentric rings, axis spokes, and one filled
   data polygon per series.

   Single series:   <SpiderChart scores={{ "cutting-pacing": 70, ... }} />
   Overlay (admin): <SpiderChart series={[{ label, color, scores }, ...]} />

   Scores are 0–100. Axis order follows GAMIFY_SKILLS.
   ========================================================= */

import React from "react";
import { GAMIFY_SKILLS } from "../lib/gamify-data.jsx";

/* Vertex (x,y) for axis `i` of `n` at radius `r`, centered at (cx,cy).
   Axis 0 points straight up; subsequent axes go clockwise. */
function vertex(cx, cy, r, i, n) {
  const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

/* Unit direction of axis `i` (matches vertex()'s angle convention). */
function axisDir(i, n) {
  const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
  return [Math.cos(angle), Math.sin(angle)];
}

function polygonPoints(scores, skills, cx, cy, maxR) {
  return skills.map((s, i) => {
    const v = Math.max(0, Math.min(100, Number(scores?.[s.key] || 0)));
    const [x, y] = vertex(cx, cy, (v / 100) * maxR, i, skills.length);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export default function SpiderChart({
  scores,
  series,                 // [{ label, color, scores }] — overrides `scores`
  size = 280,
  rings = 10,
  fillColor = "var(--c-violet, #a99bff)",
  showLabels = true,
  labelMode = "short",    // "short" | "full" | "none"
  className = "",
  editable = false,       // drag points in/out to set each axis value
  editableKeys,           // optional: only these skill keys are draggable
  onChange,               // (skillKey, value0to100) — fired live while dragging
}) {
  const skills = GAMIFY_SKILLS;
  const n = skills.length;
  const pad = showLabels ? Math.round(size * 0.18) : 8;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - pad;

  const svgRef = React.useRef(null);
  const dragRef = React.useRef(null);   // axis index currently being dragged

  const seriesList = series && series.length
    ? series
    : [{ label: null, color: fillColor, scores: scores || {} }];

  /* Convert a client pointer position to a 0..100 value along axis `i`:
     project the (pointer - center) vector onto the axis direction, then snap
     to the nearest concentric ring so dropped points land on a ring. */
  const valueFromPointer = (evt, i) => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    // viewBox is size×size mapped onto rect — scale client coords into viewBox space.
    const px = ((evt.clientX - rect.left) / rect.width) * size - cx;
    const py = ((evt.clientY - rect.top) / rect.height) * size - cy;
    const [dx, dy] = axisDir(i, n);
    const proj = px * dx + py * dy;           // distance along the axis
    const raw = (proj / maxR) * 100;
    const step = 100 / rings;                 // value span between adjacent rings
    const snapped = Math.round(raw / step) * step;
    return Math.max(0, Math.min(100, Math.round(snapped)));
  };

  const isEditable = (key) =>
    editable && (!editableKeys || editableKeys.includes(key));

  const startDrag = (i) => (e) => {
    if (!isEditable(skills[i].key)) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = i;
    const move = (ev) => {
      if (dragRef.current == null) return;
      const v = valueFromPointer(ev, dragRef.current);
      onChange && onChange(skills[dragRef.current].key, v);
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <svg
      ref={svgRef}
      className={`spider-chart ${className}`}
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      role="img"
      aria-label="Skill radar chart"
      style={editable ? { touchAction: "none" } : undefined}
    >
      {/* concentric rings */}
      {Array.from({ length: rings }, (_, ri) => {
        const r = (maxR * (ri + 1)) / rings;
        const pts = skills.map((_, i) => {
          const [x, y] = vertex(cx, cy, r, i, n);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(" ");
        return (
          <polygon
            key={"ring" + ri}
            points={pts}
            fill="none"
            stroke="var(--line, rgba(255,255,255,0.10))"
            strokeWidth={ri === rings - 1 ? 1.2 : 0.6}
          />
        );
      })}

      {/* axis spokes */}
      {skills.map((_, i) => {
        const [x, y] = vertex(cx, cy, maxR, i, n);
        return (
          <line
            key={"spoke" + i}
            x1={cx} y1={cy} x2={x} y2={y}
            stroke="var(--line, rgba(255,255,255,0.10))"
            strokeWidth={0.6}
          />
        );
      })}

      {/* data polygons */}
      {seriesList.map((s, si) => {
        const pts = polygonPoints(s.scores, skills, cx, cy, maxR);
        const color = s.color || fillColor;
        const single = seriesList.length === 1;
        return (
          <g key={"series" + si}>
            <polygon
              points={pts}
              fill={color}
              fillOpacity={single ? 0.18 : 0.10}
              stroke={color}
              strokeWidth={single ? 2 : 1.5}
              strokeLinejoin="round"
            />
            {/* vertex dots only for a single series (overlay gets noisy) */}
            {single && skills.map((sk, i) => {
              const v = Math.max(0, Math.min(100, Number(s.scores?.[sk.key] || 0)));
              const [x, y] = vertex(cx, cy, (v / 100) * maxR, i, n);
              const drag = isEditable(sk.key);
              return (
                <g key={"dot" + i}>
                  {/* larger invisible hit target for easy dragging */}
                  {drag && (
                    <circle
                      cx={x} cy={y} r={10} fill="transparent"
                      style={{ cursor: "grab" }}
                      onPointerDown={startDrag(i)}
                    />
                  )}
                  <circle
                    cx={x} cy={y} r={drag ? 4 : 2.6}
                    fill={color}
                    stroke={drag ? "var(--bg-elev, #15151c)" : "none"}
                    strokeWidth={drag ? 1.5 : 0}
                    style={drag ? { cursor: "grab" } : undefined}
                    onPointerDown={drag ? startDrag(i) : undefined}
                  />
                </g>
              );
            })}
          </g>
        );
      })}

      {/* axis labels */}
      {showLabels && labelMode !== "none" && skills.map((s, i) => {
        const [x, y] = vertex(cx, cy, maxR + pad * 0.55, i, n);
        const anchor = Math.abs(x - cx) < 4 ? "middle" : x > cx ? "start" : "end";
        return (
          <text
            key={"label" + i}
            x={x} y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontSize={Math.max(7, size * 0.034)}
            fill="var(--fg-dim, #9aa)"
            fontFamily="var(--f-mono, monospace)"
          >
            {labelMode === "full" ? s.label : s.short}
          </text>
        );
      })}
    </svg>
  );
}
