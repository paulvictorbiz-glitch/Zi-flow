/* =========================================================
   ContentStudio — the "Create Content / Analyze Video" intake panel
   (modeled on reeldna.online). Two tabs:

     · Create Content — niche/goal/topic, output-format checkboxes, a
       "repurpose a video" link field, and a "Generate Content Pack"
       button (pencil icon).
     · Analyze Video — paste an IG/YT link → a staged loading screen
       with a progress bar runs through the deconstruction stages.

   POC: nothing hits a backend. "Generate" shows a mock content pack;
   "Analyze" runs a timed staged loader then shows a mock result.

   Self-contained (no external data deps) so it can drop into the Home
   page and the Product page alike.
   ========================================================= */
import React, { useEffect, useRef, useState } from "react";
import "./content-studio.css";

const NICHES = [
  "Finance", "Fitness & Health", "Study & Productivity",
  "Business & Startup", "Motivation", "Other",
];
const GOALS = [
  "Get more views / reach", "Build trust / authority",
  "Sell a product / service", "Engagement (comments / saves)",
];
const FORMATS = [
  "Reel Script", "Insta Caption", "Twitter Thread",
  "LinkedIn Post", "Next Reel Ideas", "SEO / Hashtags",
];

/* Stages shown in the Analyze loading screen. */
const ANALYZE_STAGES = [
  { label: "Fetching reel from source…", pct: 14 },
  { label: "Downloading video stream…", pct: 30 },
  { label: "Detecting scene cuts…", pct: 48 },
  { label: "Analyzing audio & beat-grid…", pct: 64 },
  { label: "Reading fonts & on-screen text…", pct: 78 },
  { label: "Extracting assets & building timeline…", pct: 92 },
  { label: "Sequencing complete.", pct: 100 },
];

/* ---------- Create Content tab ---------- */
function CreateContent() {
  const [niche, setNiche] = useState("");
  const [goal, setGoal] = useState("");
  const [topic, setTopic] = useState("");
  const [formats, setFormats] = useState(() => new Set(["Reel Script", "Insta Caption"]));
  const [repurpose, setRepurpose] = useState("");
  const [generating, setGenerating] = useState(false);
  const [pack, setPack] = useState(null);

  const toggleFormat = (f) =>
    setFormats((prev) => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });

  const canGenerate = topic.trim().length > 0 && formats.size > 0;

  const generate = () => {
    if (!canGenerate) return;
    setGenerating(true);
    setPack(null);
    setTimeout(() => {
      setGenerating(false);
      setPack({
        topic: topic.trim(),
        niche: niche || "General",
        goal: goal || "Get more views / reach",
        formats: [...formats],
      });
    }, 1400);
  };

  return (
    <div className="cs-pane">
      <div className="cs-grid">
        <label className="cs-field">
          <span className="cs-label">Your Niche</span>
          <select className="cs-input" value={niche} onChange={(e) => setNiche(e.target.value)}>
            <option value="">Select a niche…</option>
            {NICHES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>

        <label className="cs-field">
          <span className="cs-label">Your Goal</span>
          <select className="cs-input" value={goal} onChange={(e) => setGoal(e.target.value)}>
            <option value="">Select a goal…</option>
            {GOALS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
      </div>

      <label className="cs-field">
        <span className="cs-label">Video Topic</span>
        <input
          className="cs-input"
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. 3 budgeting mistakes that keep you broke"
        />
      </label>

      <div className="cs-field">
        <span className="cs-label">Output Formats</span>
        <div className="cs-checks">
          {FORMATS.map((f) => {
            const on = formats.has(f);
            return (
              <button
                type="button"
                key={f}
                className={"cs-check" + (on ? " is-on" : "")}
                onClick={() => toggleFormat(f)}
                aria-pressed={on}
              >
                <span className="cs-check-box">{on ? "✓" : ""}</span>
                {f}
              </button>
            );
          })}
        </div>
      </div>

      <label className="cs-field">
        <span className="cs-label">
          Repurpose a Video <span className="cs-rec">Recommended</span>
        </span>
        <input
          className="cs-input"
          type="text"
          value={repurpose}
          onChange={(e) => setRepurpose(e.target.value)}
          placeholder="Paste a Reel or YouTube link…"
        />
        <span className="cs-hint">
          The AI will watch it and steal its pacing, tone, and viral hooks for your new script.
        </span>
      </label>

      <button
        className="cs-generate"
        onClick={generate}
        disabled={!canGenerate || generating}
      >
        <span className="cs-pencil" aria-hidden="true">✎</span>
        {generating ? "Generating…" : "Generate Content Pack"}
      </button>

      {pack && (
        <div className="cs-pack">
          <div className="cs-pack-head">
            <span className="cs-pack-tag">CONTENT PACK · READY</span>
            <span className="cs-pack-meta">{pack.niche} · {pack.goal}</span>
          </div>
          <h4 className="cs-pack-topic">{pack.topic}</h4>
          <div className="cs-pack-items">
            {pack.formats.map((f) => (
              <div className="cs-pack-item" key={f}>
                <span className="cs-pack-item-h">{f}</span>
                <span className="cs-pack-item-body">
                  Drafted from the repurposed reel's pacing & hooks.
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Analyze Video tab ---------- */
function AnalyzeVideo() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | running | done
  const [stageIdx, setStageIdx] = useState(0);
  const [pct, setPct] = useState(0);
  const timers = useRef([]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers, []);

  const run = () => {
    if (!url.trim()) return;
    clearTimers();
    setPhase("running");
    setStageIdx(0);
    setPct(0);

    ANALYZE_STAGES.forEach((stage, i) => {
      const t = setTimeout(() => {
        setStageIdx(i);
        setPct(stage.pct);
        if (i === ANALYZE_STAGES.length - 1) {
          const done = setTimeout(() => setPhase("done"), 600);
          timers.current.push(done);
        }
      }, i * 780);
      timers.current.push(t);
    });
  };

  const reset = () => { clearTimers(); setPhase("idle"); setPct(0); setStageIdx(0); };

  return (
    <div className="cs-pane">
      <label className="cs-field">
        <span className="cs-label">Paste a Reel / Short link</span>
        <div className="cs-analyze-row">
          <input
            className="cs-input"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.instagram.com/reels/…"
            disabled={phase === "running"}
          />
          <button
            className="cs-analyze-btn"
            onClick={run}
            disabled={!url.trim() || phase === "running"}
          >
            {phase === "running" ? "Analyzing…" : "Analyze Video"}
          </button>
        </div>
        <span className="cs-hint">
          We watch the reel and reverse-engineer its cuts, assets, and timing into a timeline.
        </span>
      </label>

      {phase === "running" && (
        <div className="cs-loader">
          <div className="cs-loader-spinner" aria-hidden="true" />
          <div className="cs-loader-body">
            <div className="cs-loader-stage">{ANALYZE_STAGES[stageIdx].label}</div>
            <div className="cs-progress">
              <div className="cs-progress-bar" style={{ width: `${pct}%` }} />
            </div>
            <div className="cs-loader-foot">
              <span>{pct}%</span>
              <span>stage {stageIdx + 1} / {ANALYZE_STAGES.length}</span>
            </div>
            <ul className="cs-stage-list">
              {ANALYZE_STAGES.map((s, i) => (
                <li key={s.label}
                    className={
                      "cs-stage-li" +
                      (i < stageIdx ? " is-done" : i === stageIdx ? " is-current" : "")
                    }>
                  <span className="cs-stage-tick">{i < stageIdx ? "✓" : i === stageIdx ? "▸" : "•"}</span>
                  {s.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="cs-result">
          <div className="cs-result-head">
            <span className="cs-result-tag">DECONSTRUCTION COMPLETE</span>
            <button className="cs-result-reset" onClick={reset}>Analyze another →</button>
          </div>
          <div className="cs-result-stats">
            <div className="cs-result-stat"><b>12</b><span>genes detected</span></div>
            <div className="cs-result-stat"><b>34</b><span>timeline clips</span></div>
            <div className="cs-result-stat"><b>0:28</b><span>duration</span></div>
            <div className="cs-result-stat"><b>128</b><span>BPM (locked)</span></div>
          </div>
          <p className="cs-result-copy">
            Your reel has been sequenced. Scroll up to the breakdown to explore every gene,
            scrub the timeline, and download or swap each asset.
          </p>
        </div>
      )}
    </div>
  );
}

export function ContentStudio({ defaultTab = "create" }) {
  const [tab, setTab] = useState(defaultTab);

  return (
    <section className="cs">
      <div className="cs-inner">
        <header className="cs-head">
          <p className="cs-eyebrow">The studio</p>
          <h2 className="cs-h2">Create content, or reverse-engineer a reel.</h2>
        </header>

        <div className="cs-tabs">
          <button
            className={"cs-tab" + (tab === "create" ? " is-active" : "")}
            onClick={() => setTab("create")}
          >
            Create Content
          </button>
          <button
            className={"cs-tab" + (tab === "analyze" ? " is-active" : "")}
            onClick={() => setTab("analyze")}
          >
            Analyze Video
          </button>
        </div>

        <div className="cs-card">
          {tab === "create" ? <CreateContent /> : <AnalyzeVideo />}
        </div>
      </div>
    </section>
  );
}

export default ContentStudio;
