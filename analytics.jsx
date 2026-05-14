/* =========================================================
   Analytics — variant A/B with operational overlays.
   Includes reel selector (search) → 5 variants + metrics.
   ========================================================= */

import React, { useState } from "react";
import { DPill, Pill, Selector } from "./components.jsx";

const POSTED_REELS = [
  { id: "REEL-180", title: "Himalaya flyover",       postedAgo: "7d ago",  variants: 5 },
  { id: "REEL-170", title: "Boudha drone reveal",    postedAgo: "10d ago", variants: 5 },
  { id: "REEL-166", title: "Pashupati monks at dawn",postedAgo: "12d ago", variants: 5 },
  { id: "REEL-161", title: "Patan square crowd",     postedAgo: "16d ago", variants: 5 },
  { id: "REEL-152", title: "Mountain horizon line",  postedAgo: "21d ago", variants: 5 },
  { id: "REEL-148", title: "Pokhara lake mist",      postedAgo: "24d ago", variants: 5 },
];

const VARIANTS_BY_REEL = {
  "REEL-180": [
    { v: "Baseline", hook: "30d median",                       views: 38.2, watch: 54, saves: 180, delta: null },
    { v: "A", winner: true, hook: "Bell close-up → wide reveal",views: 94.1, watch: 68, saves: 412, delta: 146 },
    { v: "B", hook: "Drone push-in",                            views: 42.0, watch: 56, saves: 190, delta: 10 },
    { v: "C", hook: "Captions cold-open",                       views: 71.3, watch: 61, saves: 288, delta: 87 },
    { v: "D", hook: "Slow-mo entry",                            views: 22.4, watch: 43, saves: 71,  delta: -42 },
    { v: "E", hook: "Vertical pano",                            views: 55.6, watch: 59, saves: 244, delta: 46 },
  ],
  "REEL-170": [
    { v: "Baseline", hook: "30d median",                        views: 38.2, watch: 54, saves: 180, delta: null },
    { v: "A", hook: "Sunrise punch-in",                         views: 60.1, watch: 58, saves: 220, delta: 57 },
    { v: "B", winner: true, hook: "Reverse drone reveal",       views: 102.4, watch: 71, saves: 510, delta: 168 },
    { v: "C", hook: "Captions cold-open",                       views: 49.3, watch: 55, saves: 198, delta: 29 },
    { v: "D", hook: "Slow-mo monk pan",                         views: 31.0, watch: 49, saves: 96,  delta: -19 },
    { v: "E", hook: "Pano of valley",                           views: 48.7, watch: 56, saves: 210, delta: 27 },
  ],
  "REEL-166": [
    { v: "Baseline", hook: "30d median",                        views: 38.2, watch: 54, saves: 180, delta: null },
    { v: "A", hook: "Bell ringer face",                         views: 45.2, watch: 57, saves: 200, delta: 18 },
    { v: "B", hook: "Drone reveal",                             views: 30.1, watch: 51, saves: 140, delta: -21 },
    { v: "C", winner: true, hook: "Caption hook 'before dawn'", views: 88.0, watch: 64, saves: 360, delta: 130 },
    { v: "D", hook: "Slow-mo crowd",                            views: 26.4, watch: 46, saves: 80,  delta: -31 },
    { v: "E", hook: "Vertical procession",                      views: 41.5, watch: 55, saves: 175, delta: 9 },
  ],
  "REEL-161": [
    { v: "Baseline", hook: "30d median",                        views: 38.2, watch: 54, saves: 180, delta: null },
    { v: "A", hook: "Wide square reveal",                       views: 39.8, watch: 53, saves: 175, delta: 4 },
    { v: "B", winner: true, hook: "Caption hook 'in 60s'",      views: 76.3, watch: 62, saves: 304, delta: 99 },
    { v: "C", hook: "Drone push-in",                            views: 43.1, watch: 55, saves: 188, delta: 13 },
    { v: "D", hook: "Slow-mo entry",                            views: 21.0, watch: 41, saves: 70,  delta: -45 },
    { v: "E", hook: "Vertical pano",                            views: 50.4, watch: 58, saves: 215, delta: 32 },
  ],
  "REEL-152": [
    { v: "Baseline", hook: "30d median",                        views: 38.2, watch: 54, saves: 180, delta: null },
    { v: "A", winner: true, hook: "Mountain ridge silhouette",  views: 81.2, watch: 66, saves: 333, delta: 112 },
    { v: "B", hook: "Drone push-in",                            views: 39.4, watch: 53, saves: 165, delta: 3 },
    { v: "C", hook: "Captions cold-open",                       views: 60.1, watch: 60, saves: 240, delta: 57 },
    { v: "D", hook: "Slow-mo zoom",                             views: 26.4, watch: 46, saves: 80,  delta: -31 },
    { v: "E", hook: "Vertical pano",                            views: 49.0, watch: 56, saves: 210, delta: 28 },
  ],
  "REEL-148": [
    { v: "Baseline", hook: "30d median",                        views: 38.2, watch: 54, saves: 180, delta: null },
    { v: "A", hook: "Mist reveal",                              views: 41.0, watch: 54, saves: 170, delta: 7 },
    { v: "B", hook: "Drone over lake",                          views: 35.0, watch: 51, saves: 150, delta: -8 },
    { v: "C", winner: true, hook: "Caption 'before sunrise'",   views: 70.5, watch: 62, saves: 290, delta: 84 },
    { v: "D", hook: "Slow-mo paddle",                           views: 25.4, watch: 44, saves: 75,  delta: -33 },
    { v: "E", hook: "Vertical pano",                            views: 46.2, watch: 56, saves: 195, delta: 21 },
  ],
};

const WHO_WAITS = [
  { from: "Judy A", to: "Paul V", ctx: "REEL-201 · hook A/B",    age: "3h 12m", tone: "warn" },
  { from: "Jay",    to: "Paul V", ctx: "REEL-192 · sign-off",     age: "28h",    tone: "block" },
  { from: "Paul V", to: "Judy A", ctx: "REEL-198 · hook call",   age: "19h",    tone: "block" },
  { from: "Leroy C",to: "Paul V", ctx: "REEL-195 · approval",    age: "1h 04m", tone: "cyan" },
];

const AGING = [
  { id: "REEL-192", stage: "Review",     age: "28h", act: "Sign off" },
  { id: "REEL-198", stage: "Main edit",  age: "3d",  act: "Unblock hook" },
  { id: "IDEA-079", stage: "Idea pool",  age: "11d", act: "Triage" },
  { id: "IDEA-082", stage: "Idea pool",  age: "6d",  act: "Triage" },
];

const ATTENTION = [
  "Sign off REEL-192 — 28h waiting.",
  "Pick hook A/B for REEL-201 before 14:00.",
  "Triage 4 stale idea items sitting in the pool.",
  "Schedule 2 ready reels for tomorrow.",
];

function Analytics() {
  const [selected, setSelected] = useState(POSTED_REELS[0]);
  const variants = VARIANTS_BY_REEL[selected.id];

  // KPIs (held constant since they're trailing 30d)
  const kpis = [
    { lbl: "Reels posted", val: "30",    delta: "trailing 30d", neutral: true },
    { lbl: "Avg views",    val: "47.3k", delta: "+18%" },
    { lbl: "Avg watch",    val: "58%",   delta: "+4 pts" },
    { lbl: "Avg saves",    val: "226",   delta: "+12%" },
    { lbl: "Followers",    val: "8.4k",  delta: "+9%" },
  ];

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Analytics — variant A/B with operational overlays</h1>
          <div className="sub">
            Keeps the cleaner A/B dashboard structure, then layers in bottleneck messaging,
            who waits on whom, and stuck-work visibility.
          </div>
        </div>
        <div className="actions">
          <DPill tone="amber" active>● Review queue slowing winners</DPill>
          <DPill>Period: 30d</DPill>
          <DPill solid>Baseline: median</DPill>
        </div>
      </div>

      {/* Bottleneck banner */}
      <div className="bottleneck">
        <div className="lhs">
          <span className="tag">Bottleneck</span>
          <span className="txt">
            Paul Victor's review queue is the bottleneck: 2 reels waiting,
            oldest 28h overdue, variant editor idles in 3h 20m if handoffs do not clear.
          </span>
        </div>
        <DPill primary>Open review queue</DPill>
      </div>

      {/* KPIs */}
      <div className="kpis">
        {kpis.map(k => (
          <div className="kpi" key={k.lbl}>
            <div className="lbl">{k.lbl}</div>
            <div className="val">{k.val}</div>
            <div className={"delta" + (k.neutral ? " dim" : "")}>{k.delta}</div>
          </div>
        ))}
      </div>

      {/* Reel selector */}
      <div style={{
        padding: "16px 22px", borderBottom: "1px dashed var(--line)",
        display: "flex", gap: 14, alignItems: "center",
      }}>
        <Selector
          label="Lookup reel"
          value={selected}
          options={POSTED_REELS}
          onPick={setSelected}
        />
        <span className="mono muted">or browse:</span>
        {POSTED_REELS.slice(0, 4).map(r => (
          <DPill key={r.id}
            active={r.id === selected.id}
            onClick={() => setSelected(r)}>
            {r.id}
          </DPill>
        ))}
      </div>

      {/* Main split: left = variants/charts, right = ops overlays */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1.7fr 1fr",
        gap: 0,
      }}>
        {/* LEFT */}
        <div style={{ borderRight: "1px dashed var(--line)", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Variant comparison table */}
          <Card
            title={"Variant comparison — " + selected.id}
            right={<span className="mono muted">{variants.length - 1} variants · posted {selected.postedAgo}</span>}
            footLeft="Performance table"
          >
            <table className="vtable">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Variant</th>
                  <th>Hook pattern</th>
                  <th className="num" style={{ textAlign: "right" }}>Views</th>
                  <th className="num" style={{ textAlign: "right" }}>Watch</th>
                  <th className="num" style={{ textAlign: "right" }}>Saves</th>
                  <th className="num" style={{ textAlign: "right" }}>vs Base</th>
                </tr>
              </thead>
              <tbody>
                {variants.map(v => (
                  <tr key={v.v} className={v.winner ? "winner" : ""}>
                    <td>
                      <span className="vletter">{v.v}</span>
                      {v.winner && <span className="winflag" style={{ marginLeft: 8 }}>winner</span>}
                    </td>
                    <td style={{ color: "var(--fg-mute)" }}>{v.hook}</td>
                    <td className="num" style={{ textAlign: "right" }}>{v.views.toFixed(1)}k</td>
                    <td className="num" style={{ textAlign: "right" }}>{v.watch}%</td>
                    <td className="num" style={{ textAlign: "right" }}>{v.saves}</td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {v.delta === null
                        ? <span className="dim">—</span>
                        : <span className={v.delta >= 0 ? "pos" : "neg"}>
                            {v.delta >= 0 ? "+" : ""}{v.delta}%
                          </span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--fg-mute)" }}>
              Winner: <span style={{ color: "var(--c-cyan)" }}>
                Variant {variants.find(v => v.winner)?.v}
              </span> — {variants.find(v => v.winner)?.hook}.{" "}
              Hook pattern becomes a reusable template for downstream reels.
            </div>
          </Card>

          {/* Retention chart */}
          <Card
            title={"Watch retention curve — winner vs B vs baseline"}
            right={<DPill solid>0–30s</DPill>}
            footLeft="Retention view"
          >
            <RetentionChart variants={variants} />
          </Card>

          {/* Where is work stuck — bars */}
          <Card
            title="Where is work stuck"
            right={<span className="mono muted">last refreshed 1m ago</span>}
            footLeft="Pipeline pressure"
          >
            <div className="stuck-bars">
              {[
                { label: "Idea",     v: 4,   tone: "cyan",  h: 50 },
                { label: "Selected", v: 2,   tone: "cyan",  h: 30 },
                { label: "Main",     v: 3,   tone: "warn",  h: 42 },
                { label: "Review",   v: 2,   tone: "block", h: 110, big: true },
                { label: "Variants", v: 2,   tone: "cyan",  h: 30 },
                { label: "Ready",    v: 5,   tone: "green", h: 60 },
                { label: "Posted",   v: 147, tone: "green", h: 90, mute: true },
              ].map(b => (
                <div className="stuck-bar" key={b.label}>
                  <span className={"v " + b.tone}>{b.v}</span>
                  <div className={"bar " + b.tone} style={{ height: b.h }} />
                  <span className="l">{b.label}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: "10px 14px", fontSize: 11.5, color: "var(--fg-mute)" }}>
              <span style={{ color: "var(--c-red)" }}>Review</span> towers above the rest —
              owner-approval is the real operational choke point.
            </div>
          </Card>
        </div>

        {/* RIGHT — operational overlays */}
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <Card
            title="Who waits on whom"
            right={<span className="mono muted">now</span>}
            footLeft="Dependency map"
          >
            {WHO_WAITS.map((w, i) => (
              <div className="wait-row" key={i}>
                <div>
                  <div className="flow"><b>{w.from}</b> → <b>{w.to}</b></div>
                  <div className="ctx">{w.ctx}</div>
                </div>
                <Pill tone={w.tone}>{w.age}</Pill>
              </div>
            ))}
          </Card>

          <Card
            title="Aging items"
            right={<span className="count-tag" style={{ color: "var(--c-red)" }}>4 over SLA</span>}
            footLeft="Stale work"
          >
            <table className="aging">
              <thead>
                <tr><th>Reel</th><th>Stage</th><th>Age</th><th>Action</th></tr>
              </thead>
              <tbody>
                {AGING.map(a => (
                  <tr key={a.id}>
                    <td className="id">{a.id}</td>
                    <td className="muted">{a.stage}</td>
                    <td className="age">{a.age}</td>
                    <td className="act">{a.act}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card
            title="What needs attention today"
            right={<span className="count-tag cyan">4 items</span>}
            footLeft="Daily action list"
          >
            {ATTENTION.map((a, i) => (
              <div className="attention-item" key={i}>
                <span className="marker">0{i + 1}</span>
                <span>{a}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

/* Retention curve as a quick inline SVG (no decorative art). */
function RetentionChart({ variants }) {
  const w = 800, h = 200, pad = { l: 28, r: 12, t: 12, b: 22 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const winner = variants.find(v => v.winner);
  const second = variants.find(v => !v.winner && v.v !== "Baseline" && v.delta > 0) || variants[2];
  const baseline = variants.find(v => v.v === "Baseline");

  // Build 7-point curves that decay from initial watch% to ~watch%*0.45
  const buildCurve = (startPct) => {
    const N = 8;
    const arr = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      // exponential-ish decay
      const v = startPct * (1 - t * 0.55) + Math.sin(i) * 1.4;
      arr.push(v);
    }
    return arr;
  };

  const series = [
    { name: "Baseline · " + baseline.watch + "%", data: buildCurve(baseline.watch),  color: "var(--fg-mute)", dashed: true },
    { name: "B · " + second.watch + "%",          data: buildCurve(second.watch),    color: "var(--c-amber)" },
    { name: "Winner · " + winner.watch + "%",     data: buildCurve(winner.watch),    color: "var(--c-cyan)", thick: true },
  ];

  const maxY = 80, minY = 20;
  const x = i => pad.l + (i / 7) * innerW;
  const y = v => pad.t + (1 - (v - minY) / (maxY - minY)) * innerH;

  const pathFor = data => data.map((v, i) => (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");

  return (
    <div className="retention">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {/* horizontal grid */}
        {[20, 40, 60, 80].map(g => (
          <line key={g}
            x1={pad.l} x2={w - pad.r}
            y1={y(g)} y2={y(g)}
            stroke="var(--line)" strokeDasharray="2 4" />
        ))}
        {[20, 40, 60, 80].map(g => (
          <text key={"l" + g}
            x={pad.l - 6} y={y(g) + 3}
            fontSize="9" fontFamily="var(--f-mono)" fill="var(--fg-dim)"
            textAnchor="end">{g}%</text>
        ))}
        {/* x labels */}
        {["0s", "5s", "10s", "15s", "20s", "25s", "30s"].map((t, i) => (
          <text key={t}
            x={pad.l + (i / 7) * innerW + (innerW / 7) / 2}
            y={h - 6}
            fontSize="9" fontFamily="var(--f-mono)" fill="var(--fg-dim)"
            textAnchor="middle">{t}</text>
        ))}
        {/* curves */}
        {series.map((s, idx) => (
          <path key={idx}
            d={pathFor(s.data)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.thick ? 2.2 : 1.5}
            strokeDasharray={s.dashed ? "4 4" : "none"}
            strokeLinecap="round"
          />
        ))}
        {/* labels */}
        {series.map((s, idx) => (
          <text key={"n" + idx}
            x={x(7)} y={y(s.data[7]) - 6}
            fontSize="10" fontFamily="var(--f-mono)" fill={s.color}
            textAnchor="end">
            {s.name}
          </text>
        ))}
      </svg>
    </div>
  );
}

export { Analytics };
