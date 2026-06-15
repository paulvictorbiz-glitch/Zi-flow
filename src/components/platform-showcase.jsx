/* =========================================================
   PlatformShowcase — "Inside the platform" section for the Product
   page. Pure CSS/SVG wireframe mockups of the wider FootageBrain
   platform (Pipeline board, cross-platform Analytics, infra Monitor)
   shown in framed browser-style cards. No real screenshots, no data.

   REEL DNA stays the brand; this presents the surrounding platform as
   additional capabilities.
   ========================================================= */
import React from "react";
import "./platform-showcase.css";

/* A browser-chrome frame wrapping a wireframe mock. */
function Frame({ title, children }) {
  return (
    <div className="ps-frame">
      <div className="ps-frame-bar">
        <span className="ps-dot ps-dot--r" />
        <span className="ps-dot ps-dot--y" />
        <span className="ps-dot ps-dot--g" />
        <span className="ps-frame-title">{title}</span>
      </div>
      <div className="ps-frame-body">{children}</div>
    </div>
  );
}

/* ---- Wireframe: Pipeline board (rows = owners, cols = stages) ---- */
function PipelineWire() {
  const cols = ["NOT STARTED", "IN PROGRESS", "REVIEW", "DONE"];
  const rows = [
    [1, 0, 1, 1],
    [0, 1, 0, 0],
    [1, 0, 1, 0],
    [0, 1, 0, 1],
  ];
  const colors = ["#ff5d73", "#ffb547", "#9b8cff", "#36e0c8"];
  return (
    <div className="ps-pipe">
      <div className="ps-pipe-head">
        <span className="ps-pipe-cell ps-pipe-owner">OWNER</span>
        {cols.map((c, i) => (
          <span className="ps-pipe-cell ps-pipe-col" key={c}>{c}</span>
        ))}
      </div>
      {rows.map((r, ri) => (
        <div className="ps-pipe-row" key={ri}>
          <span className="ps-pipe-cell ps-pipe-owner">
            <span className="ps-skel ps-skel--avatar" />
            <span className="ps-skel ps-skel--name" />
          </span>
          {r.map((has, ci) => (
            <span className="ps-pipe-cell ps-pipe-col" key={ci}>
              {has ? <span className="ps-card-mini" style={{ "--c": colors[ci] }} /> : null}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---- Wireframe: Analytics (multi-line trend + stat tiles) ---- */
function AnalyticsWire() {
  return (
    <div className="ps-an">
      <div className="ps-an-tiles">
        {["TOTAL VIEWS", "ENGAGEMENT", "FOLLOWERS", "VIDEOS"].map((t) => (
          <div className="ps-an-tile" key={t}>
            <span className="ps-an-tile-num" />
            <span className="ps-an-tile-lbl">{t}</span>
          </div>
        ))}
      </div>
      <svg className="ps-an-chart" viewBox="0 0 320 110" preserveAspectRatio="none">
        {[20, 50, 80].map((gy) => (
          <line key={gy} x1="0" x2="320" y1={gy} y2={gy}
                stroke="rgba(255,255,255,0.08)" strokeDasharray="2 4" />
        ))}
        <path d="M0 80 L40 70 L80 74 L120 60 L160 64 L200 30 L240 58 L280 50 L320 54"
              fill="none" stroke="#ff5d73" strokeWidth="2" strokeLinejoin="round" />
        <path d="M0 95 L40 92 L80 96 L120 88 L160 90 L200 86 L240 70 L280 84 L320 80"
              fill="none" stroke="#9b8cff" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="ps-an-legend">
        <span><i style={{ background: "#ff5d73" }} /> Instagram</span>
        <span><i style={{ background: "#9b8cff" }} /> YouTube</span>
      </div>
    </div>
  );
}

/* ---- Wireframe: Monitor (donuts + meters) ---- */
function MonitorWire() {
  const meters = [
    { label: "Memory", pct: 42, color: "#36e0c8" },
    { label: "Swap", pct: 25, color: "#9b8cff" },
    { label: "Disk", pct: 35, color: "#56e6ff" },
  ];
  return (
    <div className="ps-mon">
      <div className="ps-mon-top">
        <svg viewBox="0 0 60 60" className="ps-donut">
          <circle cx="30" cy="30" r="22" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
          <circle cx="30" cy="30" r="22" fill="none" stroke="#36e0c8" strokeWidth="8"
                  strokeDasharray="90 138" strokeLinecap="round" transform="rotate(-90 30 30)" />
        </svg>
        <div className="ps-mon-rows">
          {["rocketchat", "mongodb", "backend", "qdrant", "postgres"].map((s, i) => (
            <div className="ps-mon-row" key={s}>
              <span className="ps-mon-dot" style={{ background: ["#36e0c8","#9b8cff","#56e6ff","#ff6bd6","#ffb547"][i] }} />
              <span className="ps-mon-name">{s}</span>
              <span className="ps-skel ps-skel--val" />
            </div>
          ))}
        </div>
      </div>
      <div className="ps-mon-meters">
        {meters.map((m) => (
          <div className="ps-mon-meter" key={m.label}>
            <div className="ps-mon-meter-head">
              <span>{m.label}</span><span style={{ color: m.color }}>{m.pct}%</span>
            </div>
            <div className="ps-mon-bar">
              <div className="ps-mon-bar-fill" style={{ width: `${m.pct}%`, background: m.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const ITEMS = [
  {
    key: "pipeline",
    title: "Pipeline",
    file: "pipeline · board",
    blurb: "Run the whole studio on one board. Rows are who owns it, columns are where it is — drag a reel to move it through Not Started → In Progress → Review → Done.",
    render: <PipelineWire />,
  },
  {
    key: "analytics",
    title: "Cross-platform analytics",
    file: "analytics · live",
    blurb: "Pull real numbers from Instagram, YouTube, TikTok, and Facebook into one view — daily views, engagement, followers, and your top content, side by side.",
    render: <AnalyticsWire />,
  },
  {
    key: "monitor",
    title: "Infra monitor",
    file: "monitor · live",
    blurb: "Keep the lights on. Live CPU, memory, disk, and per-container usage for the backend, with alerts when any metric crosses its limit.",
    render: <MonitorWire />,
  },
];

export function PlatformShowcase() {
  return (
    <section className="ps">
      <div className="ps-inner">
        <header className="ps-head">
          <p className="ps-eyebrow">Inside the platform</p>
          <h2 className="ps-h2">Reel DNA is one tool in a full production platform.</h2>
          <p className="ps-sub">
            Behind the deconstructor sits FootageBrain — the system we run our own
            studio on: a drag-and-drop pipeline, cross-platform analytics, a footage
            library, and live infrastructure monitoring.
          </p>
        </header>

        <div className="ps-rows">
          {ITEMS.map((it, i) => (
            <div className={"ps-row" + (i % 2 ? " ps-row--alt" : "")} key={it.key}>
              <div className="ps-row-copy">
                <h3 className="ps-row-h">{it.title}</h3>
                <p className="ps-row-blurb">{it.blurb}</p>
              </div>
              <div className="ps-row-mock">
                <Frame title={it.file}>{it.render}</Frame>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default PlatformShowcase;
