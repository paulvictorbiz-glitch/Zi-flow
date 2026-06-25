/* =========================================================
   Pipeline Graph — Obsidian-style force graph of
   editors ↔ reels ↔ shared content.

   Owner-only alternate view for the Pipeline board. Renders:
     • editor nodes   (people who own reels)   — colored per person
     • reel nodes      (every visible reel)     — colored by STAGE
     • content hubs    (≥2 copies of the same content) — so a hub
       fanning out to N editors reads as "N people on one piece"

   Hand-rolled SVG + a tiny force simulation (no graph library —
   matches the house idiom, see SpiderChart.jsx / analytics TrendChart).
   ========================================================= */

import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { STAGES, STAGE_LABEL } from "../lib/shared-data.jsx";
import "./pipeline-graph.css";

/* Per-person color — mirrors the editor-presence palette so a person's
   node color matches their live-cursor color elsewhere in the app. */
const PRESENCE_COLORS = { paul: "#6366f1", alex: "#10b981", sam: "#f59e0b", maya: "#ef4444" };
function colorForPerson(personId) {
  return PRESENCE_COLORS[personId] ||
    "#" + ((personId || "").split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) & 0xFFFFFF)
      .toString(16).padStart(6, "0");
}

/* Stage → CSS-var color. Using var() lets the Solarin theme remap for free. */
const STAGE_COLOR = {
  not_started: "var(--c-cyan)",
  in_progress: "var(--c-amber)",
  review:      "var(--c-violet)",
  completed:   "var(--c-green)",
  posted:      "var(--c-blue)",
};

/* Strip a trailing " (Name)" / " (copy)" suffix to recover the base content
   title. Used to cluster duplicates that have no stored dup_group_id yet. */
const baseTitle = (t) => (t || "").replace(/\s*\([^)]*\)\s*$/, "").trim() || (t || "");

const R_EDITOR = 20, R_HUB = 13, R_REEL = 8;

function PipelineGraph({ reels = [], peopleList = [], onOpenReel }) {
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 900, h: 600 });

  /* Measure the available area so the sim can center itself. */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── Build nodes + links from the reels ──────────────────────────────── */
  const { nodes, links, adj } = useMemo(() => {
    const visible = reels.filter((r) => !r.archivedAt);
    const peopleById = Object.fromEntries((peopleList || []).map((p) => [p.id, p]));

    // Cluster reels into content groups (exact dup_group_id, else title base).
    const groups = new Map(); // key -> { label, reelIds: [] }
    for (const r of visible) {
      const key = r.dupGroupId ? "g:" + r.dupGroupId : "t:" + baseTitle(r.title).toLowerCase();
      if (!groups.has(key)) groups.set(key, { label: baseTitle(r.title) || r.title || "Untitled", reelIds: [] });
      groups.get(key).reelIds.push(r.id);
    }

    const nodes = [];
    const links = [];
    const editorsUsed = new Set();

    for (const r of visible) {
      nodes.push({ id: "reel:" + r.id, type: "reel", label: r.title || r.id, stage: r.stage, reel: r });
      const editorId = r.owner || r.lane;
      if (editorId) {
        editorsUsed.add(editorId);
        links.push({ source: "reel:" + r.id, target: "ed:" + editorId, kind: "editor", color: colorForPerson(editorId) });
      }
    }
    for (const editorId of editorsUsed) {
      const p = peopleById[editorId];
      nodes.push({ id: "ed:" + editorId, type: "editor", label: p?.short || p?.name || editorId, color: colorForPerson(editorId) });
    }
    for (const [key, g] of groups) {
      if (g.reelIds.length < 2) continue; // only fan-outs get a hub
      const hubId = "hub:" + key;
      nodes.push({ id: hubId, type: "hub", label: g.label, count: g.reelIds.length });
      for (const rid of g.reelIds) links.push({ source: "reel:" + rid, target: hubId, kind: "content" });
    }

    // Adjacency for hover-neighbor highlighting.
    const adj = new Map();
    for (const n of nodes) adj.set(n.id, new Set());
    for (const l of links) { adj.get(l.source)?.add(l.target); adj.get(l.target)?.add(l.source); }

    return { nodes, links, adj };
  }, [reels, peopleList]);

  /* ── Force simulation state (positions live in a ref, not React state) ── */
  const posRef = useRef(new Map());
  const alphaRef = useRef(1);
  const rafRef = useRef(0);
  const [, setFrame] = useState(0);
  const cx = size.w / 2, cy = size.h / 2;

  // Sync positions map with the current node set (seed new, drop gone).
  useEffect(() => {
    const pos = posRef.current;
    const live = new Set(nodes.map((n) => n.id));
    for (const id of [...pos.keys()]) if (!live.has(id)) pos.delete(id);
    let i = 0;
    for (const n of nodes) {
      if (!pos.has(n.id)) {
        const ang = i * 2.399963; // golden-angle scatter
        const rad = 40 + 8 * Math.sqrt(i);
        pos.set(n.id, { x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad, vx: 0, vy: 0, fx: null, fy: null });
      }
      i++;
    }
    alphaRef.current = 0.9; // reheat on data change
  }, [nodes, cx, cy]);

  // The sim loop.
  useEffect(() => {
    const nodeList = nodes;
    const tick = () => {
      const pos = posRef.current;
      const alpha = alphaRef.current;
      if (alpha > 0.01 && nodeList.length) {
        // Charge repulsion (O(n²) — fine for a small team's reel set).
        for (let i = 0; i < nodeList.length; i++) {
          const a = pos.get(nodeList[i].id); if (!a) continue;
          for (let j = i + 1; j < nodeList.length; j++) {
            const b = pos.get(nodeList[j].id); if (!b) continue;
            let dx = a.x - b.x, dy = a.y - b.y;
            let d2 = dx * dx + dy * dy || 0.01;
            if (d2 > 90000) continue; // ignore far pairs
            const f = (2600 * alpha) / d2;
            const d = Math.sqrt(d2);
            const ux = dx / d, uy = dy / d;
            a.vx += ux * f; a.vy += uy * f;
            b.vx -= ux * f; b.vy -= uy * f;
          }
        }
        // Link springs (content hubs pull tighter than editor links).
        for (const l of links) {
          const a = pos.get(typeof l.source === "string" ? l.source : l.source.id);
          const b = pos.get(typeof l.target === "string" ? l.target : l.target.id);
          if (!a || !b) continue;
          const rest = l.kind === "content" ? 70 : 110;
          let dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const f = ((d - rest) / d) * 0.08 * alpha;
          const fx = dx * f, fy = dy * f;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
        // Weak centering + integrate.
        for (const n of nodeList) {
          const p = pos.get(n.id); if (!p) continue;
          if (p.fx != null) { p.x = p.fx; p.vx = 0; }
          if (p.fy != null) { p.y = p.fy; p.vy = 0; }
          if (p.fx == null) { p.vx += (cx - p.x) * 0.002 * alpha; p.x += (p.vx *= 0.82); }
          if (p.fy == null) { p.vy += (cy - p.y) * 0.002 * alpha; p.y += (p.vy *= 0.82); }
        }
        alphaRef.current = alpha * 0.97;
        setFrame((f) => (f + 1) & 0xffff);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [nodes, links, cx, cy]);

  /* ── Pan / zoom ─────────────────────────────────────────────────────── */
  const [view, setView] = useState({ tx: 0, ty: 0, k: 1 });
  const dragRef = useRef(null); // { id, moved } for a node, or { pan:true }

  const toWorld = useCallback((clientX, clientY) => {
    const rect = wrapRef.current.getBoundingClientRect();
    return { x: (clientX - rect.left - view.tx) / view.k, y: (clientY - rect.top - view.ty) / view.k };
  }, [view]);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const rect = wrapRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    setView((v) => {
      const k = Math.min(3, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      // keep the point under the cursor stable
      return { k, tx: mx - ((mx - v.tx) / v.k) * k, ty: my - ((my - v.ty) / v.k) * k };
    });
  }, []);

  const onNodeDown = (e, n) => {
    e.stopPropagation();
    const w = toWorld(e.clientX, e.clientY);
    const p = posRef.current.get(n.id);
    if (p) { p.fx = p.x; p.fy = p.y; }
    dragRef.current = { id: n.id, moved: 0, lastW: w };
    alphaRef.current = Math.max(alphaRef.current, 0.5);
  };
  const onBgDown = (e) => { dragRef.current = { pan: true, lastX: e.clientX, lastY: e.clientY }; };
  const onMove = (e) => {
    const d = dragRef.current; if (!d) return;
    if (d.pan) {
      setView((v) => ({ ...v, tx: v.tx + (e.clientX - d.lastX), ty: v.ty + (e.clientY - d.lastY) }));
      d.lastX = e.clientX; d.lastY = e.clientY;
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    const p = posRef.current.get(d.id);
    if (p) { p.fx = w.x; p.fy = w.y; p.x = w.x; p.y = w.y; }
    d.moved += Math.abs(w.x - d.lastW.x) + Math.abs(w.y - d.lastW.y);
    d.lastW = w;
    alphaRef.current = Math.max(alphaRef.current, 0.3);
  };
  const onUp = (e, n) => {
    const d = dragRef.current; dragRef.current = null;
    if (d && !d.pan && d.moved < 4 && n?.type === "reel") onOpenReel?.(n.reel);
  };

  const resetLayout = () => {
    for (const p of posRef.current.values()) { p.fx = null; p.fy = null; }
    setView({ tx: 0, ty: 0, k: 1 });
    alphaRef.current = 0.9;
  };

  /* ── Hover highlighting ─────────────────────────────────────────────── */
  const [hover, setHover] = useState(null);
  const neighbors = hover ? adj.get(hover) : null;
  const isDim = (id) => hover && id !== hover && !(neighbors && neighbors.has(id));
  const linkDim = (l) => hover && l.source !== hover && l.target !== hover;

  const pos = posRef.current;
  const P = (id) => pos.get(id) || { x: cx, y: cy };

  if (!reels.filter((r) => !r.archivedAt).length) {
    return (
      <div className="pl-graph" ref={wrapRef}>
        <div className="pl-graph-empty">No reels to graph yet. Create or duplicate a reel to see editors connect.</div>
      </div>
    );
  }

  return (
    <div className="pl-graph" ref={wrapRef}>
      <svg
        className="pl-graph-svg"
        width={size.w}
        height={size.h}
        onWheel={onWheel}
        onMouseDown={onBgDown}
        onMouseMove={onMove}
        onMouseUp={(e) => onUp(e, null)}
        onMouseLeave={() => { dragRef.current = null; }}
      >
        <g transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
          {/* Edges */}
          {links.map((l, i) => {
            const a = P(l.source), b = P(l.target);
            return (
              <line
                key={i}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={l.kind === "content" ? "var(--fg-dim)" : (l.color || "var(--line-hard)")}
                strokeWidth={l.kind === "content" ? 1.4 : 1}
                strokeDasharray={l.kind === "content" ? "4 3" : undefined}
                opacity={linkDim(l) ? 0.06 : l.kind === "content" ? 0.55 : 0.35}
              />
            );
          })}
          {/* Nodes */}
          {nodes.map((n) => {
            const p = P(n.id);
            const dim = isDim(n.id);
            const r = n.type === "editor" ? R_EDITOR : n.type === "hub" ? R_HUB : R_REEL;
            const fill = n.type === "editor" ? n.color
              : n.type === "hub" ? "var(--bg-2)"
              : (STAGE_COLOR[n.stage] || "var(--c-grey)");
            const label = n.type === "reel"
              ? (n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label)
              : (n.label.length > 18 ? n.label.slice(0, 17) + "…" : n.label);
            return (
              <g
                key={n.id}
                className={"pl-node pl-node-" + n.type + (dim ? " is-dim" : "")}
                transform={`translate(${p.x},${p.y})`}
                onMouseDown={(e) => onNodeDown(e, n)}
                onMouseUp={(e) => { e.stopPropagation(); onUp(e, n); }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
              >
                <circle
                  r={r}
                  fill={fill}
                  stroke={n.type === "hub" ? "var(--fg-mute)" : "var(--bg-0)"}
                  strokeWidth={n.type === "hub" ? 1.5 : 1.5}
                  strokeDasharray={n.type === "hub" ? "3 2" : undefined}
                />
                {n.type === "editor" && (
                  <text className="pl-node-init" textAnchor="middle" dy="0.32em" fontSize="10">
                    {(n.label || "").slice(0, 2).toUpperCase()}
                  </text>
                )}
                {n.type === "hub" && (
                  <text className="pl-node-count" textAnchor="middle" dy="0.32em" fontSize="10">×{n.count}</text>
                )}
                <text className="pl-node-label" textAnchor="middle" y={r + 12} fontSize={n.type === "editor" ? 11 : 9}>
                  {label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend / controls overlay */}
      <div className="pl-graph-legend">
        <div className="plg-key-row"><b>Stages</b></div>
        {STAGES.map((s) => (
          <div className="plg-key-row" key={s}>
            <span className="plg-swatch" style={{ background: STAGE_COLOR[s] || "var(--c-grey)" }} />
            {STAGE_LABEL[s]}
          </div>
        ))}
        <div className="plg-key-sep" />
        <div className="plg-key-row"><span className="plg-glyph">⬤</span> editor</div>
        <div className="plg-key-row"><span className="plg-glyph plg-hub">◎</span> shared content (×N copies)</div>
        <div className="plg-key-row"><span className="plg-glyph">●</span> reel (colored by stage)</div>
        <div className="plg-key-sep" />
        <button className="plg-reset" onClick={resetLayout}>↻ Reset layout</button>
        <div className="plg-hint">drag nodes · scroll to zoom · drag bg to pan · click reel to open</div>
      </div>
    </div>
  );
}

export default PipelineGraph;
