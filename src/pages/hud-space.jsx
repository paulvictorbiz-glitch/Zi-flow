/* =====================================================
   HUD SPACE — CSS 3D dashboard at /space
   Replaces the Three.js Rubik-cube experience.

   Front face: infra / API monitoring cards
   Back face:  pipeline / content / team cards
   Drag on background → rotate world (front ↔ back)
   Click card → rich modal summary
   ⚙ LAYOUT button → slide-in menu for spatial prefs
   ===================================================== */
import React, {
  useEffect, useRef, useState, useCallback, useMemo
} from "react";
import { useAuth } from "../auth.jsx";
import { useWorkflow } from "../store/store.jsx";
import "./hud-space.css";

/* ── Default layout preferences ───────────────────── */
const PREFS_KEY = "hud_layout_prefs";
const DEFAULT_PREFS = {
  perspective: 1700,
  zoom: 1.0,            // kept for the mouse-wheel gesture (no menu slider)
  colAngles: [-44, -24, 0, 24, 44],
  cardDepth: 200,
  colTighten: 0,        // px to pull outer columns toward center (window effect)
  topTilt: 0,           // rotateX deg for cards above the globe midline
  bottomTilt: 0,        // rotateX deg for cards below the midline
  globeSpin: 1.0,       // globe spin-speed multiplier (0 = frozen)
  rayHeight: 1.0,       // hot-point ray length multiplier
  mapOpacity: 0,        // 0 = dotted globe · 1 = filled world-map overlay
};
function loadPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; }
  catch { return { ...DEFAULT_PREFS }; }
}

/* ── Column base transforms (fixed X/Z offsets from mockup) ── */
const COL_BASE = [
  { tx: -86, tz: 76  },   // 0 = far left
  { tx: -24, tz: 2   },   // 1 = inner left
  { tx:   0, tz: 0   },   // 2 = center
  { tx:  24, tz: 2   },   // 3 = inner right
  { tx:  86, tz: 76  },   // 4 = far right
];

/* Per-column inward direction for the "tighten" control (pull side cols toward center) */
const COL_TIGHTEN_DIR = [1, 0.5, 0, -0.5, -1];

/* Full per-card transform: column offset + tighten + column rotateY + row tilt */
function cardTransform(card, prefs) {
  const center = card.pos.top + card.pos.height / 2;
  const tilt   = center < 412 ? (prefs.topTilt || 0) : (prefs.bottomTilt || 0);
  const tiltStr = tilt ? ` rotateX(${tilt}deg)` : "";
  if (card.colTransformOverride) return card.colTransformOverride + tiltStr;
  const { tx, tz } = COL_BASE[card.col];
  const a       = prefs.colAngles[card.col] ?? 0;
  const tighten = (prefs.colTighten || 0) * COL_TIGHTEN_DIR[card.col];
  return `translateX(${tx + tighten}px) translateZ(${tz}px) rotateY(${a}deg)${tiltStr}`;
}

/* ─────────────────────────────────────────────────────
   CARD COMPONENTS (inline, kept small)
─────────────────────────────────────────────────────── */

/* Shared bar */
function Bar({ pct, color = "green", label, right }) {
  return (
    <div>
      <div className="hud-bar-row">
        <span>{label}</span>
        <span style={{ color: right || "#e8f1ff" }}>{pct}%</span>
      </div>
      <div className="hud-bar-track">
        <div className={`hud-bar-fill hud-bar-fill--${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* Shared metric row */
function Row({ label, value, valueStyle }) {
  return (
    <div className="hud-metric-row">
      <span>{label}</span>
      <span className="hud-metric-val" style={valueStyle}>{value}</span>
    </div>
  );
}

/* ── Front face card bodies ─────────────────────────── */

function ServerHostCard() {
  return (
    <>
      <div className="hud-sub-header">PROVIDER · HETZNER</div>
      <div style={{ font: "12px 'Share Tech Mono'", color: "#e8f1ff", marginBottom: 9 }}>ubuntu-4gb-fsn1-1 · cx33</div>
      <div className="hud-section-label">CPU % · 7-DAY</div>
      <svg className="hud-sparkline" viewBox="0 0 240 34">
        <polyline fill="none" stroke="#5fe0a8" strokeWidth="1.3"
          points="0,28 14,24 28,26 42,12 56,22 70,9 84,18 98,14 112,6 126,20 140,11 154,16 168,8 182,19 196,13 210,7 224,17 240,12"/>
      </svg>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 14px", font: "11px 'Share Tech Mono'", marginBottom: 11 }}>
        <Row label="Location" value="fsn1" />
        <Row label="Cores" value="4" />
        <Row label="RAM" value="8 GB" />
        <Row label="Disk" value="80 GB" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
        <svg viewBox="0 0 64 64" style={{ width: 58, height: 58, flexShrink: 0 }}>
          <circle cx="32" cy="32" r="25" fill="none" stroke="rgba(120,160,200,.15)" strokeWidth="6"/>
          <circle cx="32" cy="32" r="25" fill="none" stroke="#5fe0a8" strokeWidth="6"
            strokeLinecap="round" strokeDasharray="86 157" transform="rotate(-90 32 32)"/>
          <text x="32" y="30" textAnchor="middle" fill="#e8f1ff" fontSize="13" fontFamily="Share Tech Mono">2.5</text>
          <text x="32" y="42" textAnchor="middle" fill="#6f88a4" fontSize="6" fontFamily="Share Tech Mono">GB MEM</text>
        </svg>
        <div style={{ flex: 1, font: "10px 'Share Tech Mono'" }}>
          {[["#5fe0a8","rocketchat","1.42 GB"],["#5cc9ff","mongodb","502 MB"],["#ff9a4d","opencut-ai","157 MB"],["#c98bff","backend","92 MB"]]
            .map(([c,n,v]) => (
              <div key={n} style={{ display:"flex", justifyContent:"space-between", color:"#8ea6c2", padding:"1px 0" }}>
                <span style={{ color: c }}>●</span>
                <span style={{ flex:1, marginLeft:6 }}>{n}</span>
                <span style={{ color:"#e8f1ff" }}>{v}</span>
              </div>
            ))}
        </div>
      </div>
      <Bar pct={36} color="green" label="Memory" />
      <Bar pct={61} color="orange" label="Swap" right="#ff9a4d" />
      <Bar pct={60} color="orange" label="Disk (/)" right="#ff9a4d" />
    </>
  );
}

function SocialTokenCard() {
  const platforms = [
    { icon: "▣", iconColor: "#5cc9ff", name: "Facebook",  status: "connected",    statusColor: "#5fe0a8" },
    { icon: "▣", iconColor: "#e07ab8", name: "Instagram", status: "connected",    statusColor: "#5fe0a8" },
    { icon: "▣", iconColor: "#ff5a5a", name: "YouTube",   status: "expired 8d",   statusColor: "#ff7a4d" },
    { icon: "▣", iconColor: "#9fb4cc", name: "TikTok",    status: "disconnected", statusColor: "#7e93ab" },
  ];
  return (
    <div style={{ font: "11px 'Share Tech Mono'" }}>
      {platforms.map(p => (
        <div key={p.name} className="hud-social-row">
          <span style={{ color: p.iconColor }}>{p.icon}</span>
          <span style={{ flex: 1, color: "#cfe0f2" }}>{p.name}</span>
          <span style={{ color: p.statusColor }}>● {p.status}</span>
        </div>
      ))}
    </div>
  );
}

function ApiBudgetsCard() {
  return (
    <>
      <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:4 }}>
        <span style={{ font:"600 26px 'Chakra Petch'", color:"#ff9a4d" }}>$300</span>
        <span style={{ font:"10px 'Share Tech Mono'", color:"#8ea6c2" }}>GCP free-trial credit</span>
      </div>
      <div className="hud-bar-track">
        <div className="hud-bar-fill hud-bar-fill--orange" style={{ width:"98%" }} />
      </div>
      <div style={{ font:"9px 'Share Tech Mono'", color:"#7e93ab", marginBottom:10 }}>
        72 / 73 days · expires Sep 7 2026 · 1% elapsed
      </div>
      <Row label="Gemini API" value="1,500 req/day" />
      <Row label="OpenRouter" value="50 req/day" />
      <Row label="Vertex AI" value="$300 credit" />
      <Row label="Instagram Graph" value="200 calls/hr" />
    </>
  );
}

function SupabaseCard({ wf }) {
  const reelCount      = wf.reels?.length ?? 0;
  const footageCount   = wf.attachedFootage?.length ?? 0;
  const reelDnaCount   = wf.reelDna?.length ?? 0;
  const taskCount      = wf.tasks?.length ?? 0;
  return (
    <>
      <Bar pct={2}  color="green" label={`Total rows · ${reelCount + footageCount + taskCount + reelDnaCount} / 50k`} />
      <Bar pct={4}  color="blue"  label="Database · 21.9 / 624 MB" />
      <Bar pct={17} color="orange" label="Storage · 183 MB / 1.1 GB" />
      <div className="hud-section-label">ROW COUNTS BY TABLE</div>
      <Row label="attached_footage" value={footageCount} />
      <Row label="reels"            value={reelCount} />
      <Row label="reel_dna"         value={reelDnaCount} />
      <Row label="tasks"            value={taskCount} />
      <div style={{ marginTop:10, font:"10px 'Share Tech Mono'", color:"#c98bff",
        border:"1px solid rgba(201,139,255,.4)", borderRadius:3, padding:"6px",
        textAlign:"center" }}>Check migrations</div>
    </>
  );
}

function StorageCard() {
  return (
    <>
      <div className="hud-metric-row" style={{ marginBottom:9 }}>
        <span>total tracked</span><span style={{ color:"#e8f1ff" }}>397 MB</span>
      </div>
      <Bar pct={55} color="blue"   label="RC video attachments" right="#5cc9ff" />
      <Bar pct={44} color="green"  label="Supabase reel-videos"  right="#5fe0a8" />
      <Bar pct={3}  color="orange" label="RC other uploads"       right="#ff9a4d" />
      <div className="hud-muted" style={{ font:"9px 'Share Tech Mono'", marginTop:4 }}>
        27 clips · 21 files · 13 files · est. 1 KB/msg
      </div>
    </>
  );
}

function GoogleCloudCard() {
  const apis = [
    ["YouTube Data API",  "0 / 10.0k", 0],
    ["Maps JS API",       "0 / 28.0k", 0],
    ["Maps · peak/day",   "0 / 30.0k", 0],
    ["Places · peak/day", "0 / 8.0k",  0],
    ["Geocoding",         "0 / 3.0k",  0],
  ];
  return (
    <>
      <div className="hud-muted" style={{ font:"10px 'Share Tech Mono'", marginBottom:10, lineHeight:1.5 }}>
        No billing cost reported yet (free trial). Project · footage-brain-database
      </div>
      {apis.map(([label, val, pct]) => (
        <div key={label} style={{ marginBottom:9 }}>
          <div className="hud-metric-row"><span style={{ color:"#cfe0f2" }}>{label}</span><span className="hud-muted">{val}</span></div>
          <div className="hud-bar-track"><div className="hud-bar-fill hud-bar-fill--orange" style={{ width:`${pct}%` }} /></div>
        </div>
      ))}
    </>
  );
}

function NewsMonitorCard({ wf }) {
  const sources  = wf.monitorSources ?? [];
  const articles = wf.monitorEvents ?? [];
  const liveSrc  = sources.filter(s => s.enabled).length;
  return (
    <div style={{ display:"flex", gap:20, alignItems:"center" }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"3px 22px",
        font:"11px 'Share Tech Mono'", flexShrink:0 }}>
        <Row label="Active sources" value={`${liveSrc || 5} / ${sources.length || 5}`} valueStyle={{ color:"#5fe0a8" }} />
        <Row label="Articles stored" value={articles.length || 499} />
        <Row label="Last ingest"    value="18m ago" />
        <Row label="Feeds erroring" value="0" valueStyle={{ color:"#5fe0a8" }} />
      </div>
      <svg viewBox="0 0 240 44" style={{ flex:1, height:44 }}>
        <polyline fill="none" stroke="#5cc9ff" strokeWidth="1.4"
          points="0,32 16,28 32,34 48,18 64,26 80,12 96,22 112,16 128,30 144,14 160,24 176,10 192,20 208,15 224,26 240,18"/>
        <polyline fill="none" stroke="rgba(92,201,255,.18)" strokeWidth="6"
          points="0,32 16,28 32,34 48,18 64,26 80,12 96,22 112,16 128,30 144,14 160,24 176,10 192,20 208,15 224,26 240,18"/>
      </svg>
    </div>
  );
}

function FreeLlmGatesCard({ wf }) {
  const reelDna    = wf.reelDna?.length ?? 0;
  const gates = [
    { label:"Reel DNA",             on: reelDna > 0 },
    { label:"Content Forge",        on: false },
    { label:"Pulse ingest",         on: true  },
    { label:"Footage Vision Tag",   on: true  },
    { label:"Workflow Insights",    on: true  },
    { label:"Idea Generator",       on: false },
    { label:"Scout AI dossiers",    on: true  },
  ];
  const onCount = gates.filter(g => g.on).length;
  return (
    <>
      <div style={{ display:"flex", gap:16, alignItems:"center", marginBottom:10 }}>
        <svg viewBox="0 0 80 80" style={{ width:72, height:72, flexShrink:0 }}>
          <circle cx="40" cy="40" r="32" fill="none" stroke="rgba(120,160,200,.14)" strokeWidth="7"/>
          <circle cx="40" cy="40" r="32" fill="none" stroke="#ff9a4d" strokeWidth="7"
            strokeLinecap="round" strokeDasharray="0 201" transform="rotate(-90 40 40)"/>
          <text x="40" y="38" textAnchor="middle" fill="#e8f1ff" fontSize="20" fontFamily="Share Tech Mono">0</text>
          <text x="40" y="52" textAnchor="middle" fill="#6f88a4" fontSize="7" fontFamily="Share Tech Mono">TODAY</text>
        </svg>
        <div style={{ flex:1, font:"10px 'Share Tech Mono'" }}>
          {gates.slice(0,3).map(g => (
            <div key={g.label} className="hud-toggle-row">
              <span className={`hud-toggle hud-toggle--${g.on?"on":"off"}`}>
                <span className="hud-toggle-knob" />
              </span>
              <span style={{ color:"#cfe0f2" }}>{g.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ font:"8px 'Chakra Petch'", letterSpacing:".16em", color:"#7e93ab",
        textAlign:"center", marginTop:2 }}>
        {onCount} / {gates.length} ON · CONTINUOUS PROTECTION
      </div>
    </>
  );
}

function ScoutCard({ wf }) {
  const dossiers = wf.monitorEvents?.filter(e => e.type === "scout")?.length ?? 45;
  const products = wf.monitorEvents?.length ?? 338;
  return (
    <>
      <Bar pct={90} color="orange" label={`AI dossiers today · ${dossiers}/50`} right="#ff9a4d" />
      <Row label="Dossiers this month" value={products} />
      <Row label="Products tracked"    value={products} />
      <Row label="Last scrape"         value="18h ago +29" valueStyle={{ color:"#5fe0a8" }} />
      <Row label="Hacker News"         value="unlimited" />
      <Row label="GitHub Search"       value="30 req/min" />
      <div className="hud-muted" style={{ font:"9px 'Share Tech Mono'", marginTop:8 }}>
        OpenRouter tier · free pulls /60 · 20/min fail cap
      </div>
    </>
  );
}

function AiCreditsCard() {
  return (
    <>
      <Bar pct={2} color="blue" label="Cohere API · 15 / 1000" right="#5cc9ff" />
      <Row label="FAQ embeddings"     value="15" />
      <Row label="Bot questions (Jun)" value="0" />
      <Row label="FAQ approvals (Jun)" value="15" />
      <Row label="Bot conversations"  value="0" />
    </>
  );
}

function AnthropicCard() {
  return (
    <>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:11,
        padding:"9px 11px", background:"rgba(120,160,200,.06)",
        border:"1px solid rgba(120,160,200,.12)", borderRadius:3 }}>
        <span className="hud-toggle hud-toggle--off"><span className="hud-toggle-knob"/></span>
        <div style={{ font:"10px 'Share Tech Mono'" }}>
          <div style={{ color:"#cfe0f2" }}>Claude API</div>
          <div style={{ color:"#ff7a4d", fontSize:9 }}>Paused — features disabled</div>
        </div>
      </div>
      <Row label="Model"  value="claude-sonnet-4-6" />
      <Row label="Used by" value="Generate · AI Brain · FAQ" />
      <Row label="Status" value="Paused" valueStyle={{ color:"#ff7a4d" }} />
    </>
  );
}

function VercelCard() {
  return (
    <>
      <Row label="Project" value="ziflow-project-final" />
      <Row label="Domain"  value="footagebrain.com" />
      <Row label="Plan"    value="Hobby" />
      <Row label="Deploy"  value="vercel --prod" valueStyle={{ color:"#5fe0a8" }} />
      <Row label="Fns used" value="11 / 12" valueStyle={{ color:"#ff9a4d" }} />
    </>
  );
}

function EditorUsageCard({ wf }) {
  const progress = wf.gamifyProgress ?? [];
  return (
    <>
      <div className="hud-section-label">EDITOR SESSIONS (THIS WEEK)</div>
      {progress.slice(0,3).map(p => (
        <Row key={p.personId} label={p.personId} value={`${p.editSessions ?? 0} sess`} />
      ))}
      {!progress.length && <>
        <Row label="Paul Victor" value="10 sess" />
        <Row label="Leroy Crosby" value="6 sess" />
      </>}
      <div className="hud-muted" style={{ font:"9px 'Share Tech Mono'", marginTop:8 }}>
        Tracked from iframe parent · editor.footagebrain.com
      </div>
    </>
  );
}

function GamifyFrontCard({ wf }) {
  const enabled = wf.gamifyEnabled;
  return (
    <>
      <div className="hud-toggle-row" style={{ marginBottom:8 }}>
        <span className={`hud-toggle hud-toggle--${enabled?"on":"off"}`}><span className="hud-toggle-knob"/></span>
        <span style={{ color:"#cfe0f2" }}>Gamify system</span>
      </div>
      <Row label="Active rubrics" value={wf.gamifyRubrics?.length ?? 0} />
      <Row label="Graded reels"   value={wf.gamifyProgress?.length ?? 0} />
      <Row label="Grading mode"   value={wf.gamifyGradingMode ?? "standard"} />
    </>
  );
}

/* ── Back face card bodies ──────────────────────────── */

function PipelineCard({ wf }) {
  const tasks = wf.tasks ?? [];
  const notStarted  = tasks.filter(t => t.stage === "not_started").length;
  const inProgress  = tasks.filter(t => t.stage === "in_progress").length;
  const inReview    = tasks.filter(t => t.stage === "review").length;
  const reels = wf.reels ?? [];
  return (
    <>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6,
        marginBottom:10, font:"8px 'Chakra Petch'", letterSpacing:".08em" }}>
        <div style={{ color:"#9fb4cc" }}>NOT STARTED <span style={{ color:"#ff7a1a" }}>{notStarted || 28}</span></div>
        <div style={{ color:"#9fb4cc" }}>IN PROGRESS <span style={{ color:"#29b6ff" }}>{inProgress || 10}</span></div>
        <div style={{ color:"#9fb4cc" }}>REVIEW <span style={{ color:"#5fe0a8" }}>{inReview || 3}</span></div>
      </div>
      {reels.slice(0,5).map(r => (
        <div key={r.id} className="hud-pipeline-item" style={{ borderLeftColor: "#ff8a3d" }}>
          {r.title || r.name || "Untitled reel"}
        </div>
      ))}
      {!reels.length && <>
        <div className="hud-pipeline-item" style={{ borderLeftColor:"#ff5a5a" }}>BOOMERANG - Rishikesh (Paul V)</div>
        <div className="hud-pipeline-item" style={{ borderLeftColor:"#ff8a3d" }}>Johnny Harris Capcut Edit (Paul V)</div>
        <div className="hud-pipeline-item" style={{ borderLeftColor:"#29b6ff" }}>still picture - sunset bg · in progress</div>
        <div className="hud-pipeline-item" style={{ borderLeftColor:"#5fe0a8" }}>Naruto jutsu · food appears · review</div>
      </>}
    </>
  );
}

function ReviewQueueCard({ wf }) {
  const queue = wf.reviewLaneCards ?? [];
  return (
    <>
      <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:12 }}>
        <span style={{ font:"600 28px 'Chakra Petch'", color:"#5fe0a8" }}>{queue.length}</span>
        <span className="hud-muted" style={{ font:"10px 'Share Tech Mono'" }}>awaiting review</span>
      </div>
      {queue.slice(0,4).map(c => (
        <Row key={c.id} label={c.title || c.reelTitle || "Reel"} value={c.reviewer || "unassigned"} />
      ))}
      {!queue.length && <>
        <Row label="Naruto jutsu series" value="paul" />
        <Row label="Sunset minimal edit" value="leroy" />
        <Row label="Kashmir travel edit" value="paul" />
      </>}
    </>
  );
}

function TasksCommsCard({ wf }) {
  const tasks = wf.tasks ?? [];
  const daily = wf.dailyTasks ?? [];
  return (
    <>
      <div className="hud-section-label">TASKS</div>
      {tasks.slice(0,3).map(t => (
        <Row key={t.id} label={t.title?.slice(0,28) ?? "Task"} value={t.state ?? "open"} />
      ))}
      {!tasks.length && <>
        <Row label="Edit B-roll cutdown" value="in progress" valueStyle={{ color:"#29b6ff" }} />
        <Row label="Audio cleanup Reel 7" value="open" />
      </>}
      <div className="hud-section-label" style={{ marginTop:8 }}>DAILY</div>
      <Row label="Daily tasks active" value={daily.filter(t => !t.done).length || 5} />
    </>
  );
}

function ReelDnaCard({ wf }) {
  const items = wf.reelDna ?? [];
  return (
    <>
      <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:10 }}>
        <span style={{ font:"600 28px 'Chakra Petch'", color:"#5cc9ff" }}>{items.length}</span>
        <span className="hud-muted" style={{ font:"10px 'Share Tech Mono'" }}>captured reels</span>
      </div>
      <Row label="With platform data" value={items.filter(i => i.platform).length || items.length} />
      <Row label="Analyzed"           value={items.filter(i => i.analyzed).length || 0} />
      <Row label="Platforms tracked"  value="IG · TikTok · YT" />
      <div className="hud-muted" style={{ font:"9px 'Share Tech Mono'", marginTop:8 }}>
        Auto-ingest via IG sync · YT sync every 2hr
      </div>
    </>
  );
}

function ThumbnailDnaCard({ wf }) {
  const items = wf.thumbnailDna ?? [];
  return (
    <>
      <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:10 }}>
        <span style={{ font:"600 28px 'Chakra Petch'", color:"#c98bff" }}>{items.length}</span>
        <span className="hud-muted" style={{ font:"10px 'Share Tech Mono'" }}>templates</span>
      </div>
      <div className="hud-section-label">RECENT CONCEPTS</div>
      {items.slice(0,5).map(t => (
        <Row key={t.id} label={t.title?.slice(0,24) ?? "Template"} value={t.platform ?? "—"} />
      ))}
      {!items.length && <>
        <Row label="SCAMMERS"  value="IG" />
        <Row label="JOHNNY H"  value="YT" />
        <Row label="KASHMIR"   value="YT" />
        <Row label="DILJIT"    value="IG" />
        <Row label="ANTARCT."  value="YT" />
      </>}
    </>
  );
}

function TeamChatCard() {
  return (
    <div style={{ display:"flex", gap:20, alignItems:"center" }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"3px 22px",
        font:"11px 'Share Tech Mono'" }}>
        <Row label="Platform"   value="Rocket.Chat" />
        <Row label="Host"       value="chat.footagebrain.com" />
        <Row label="Status"     value="live" valueStyle={{ color:"#5fe0a8" }} />
        <Row label="Team rooms" value="4 active" />
      </div>
    </div>
  );
}

function ContentForgeCard({ wf }) {
  const reels  = wf.reels ?? [];
  const events = wf.monitorEvents ?? [];
  return (
    <>
      <Row label="Hooks in pipeline" value={events.filter(e => e.type === "hook").length || 18} />
      <Row label="Vet stage"         value={events.filter(e => e.status === "vet").length  || 8}  />
      <Row label="Elevate stage"     value={events.filter(e => e.status === "elevate").length || 3} />
      <Row label="Reels linked"      value={reels.length} />
      <div className="hud-muted" style={{ font:"9px 'Share Tech Mono'", marginTop:8 }}>
        Solarin skin · token-bleed controls active
      </div>
    </>
  );
}

function GamifyBackCard({ wf }) {
  const progress = wf.gamifyProgress ?? [];
  const rubrics  = wf.gamifyRubrics  ?? [];
  return (
    <>
      <Row label="Progress records" value={progress.length} />
      <Row label="Active rubrics"   value={rubrics.length} />
      <Row label="Grading mode"     value={wf.gamifyGradingMode ?? "standard"} />
      <Row label="Rubric desc mode" value={wf.rubricDescMode ?? "standard"} />
    </>
  );
}

/* ─────────────────────────────────────────────────────
   CARD DEFINITIONS (position, column, content)
─────────────────────────────────────────────────────── */
const FRONT_CARDS = [
  /* Far left (col 0) */
  {
    id: "server-host",
    col: 0, title: "SERVER / HOST",
    accentColor: "#5fe0a8", statusColor: "#5fe0a8", status: "RUNNING", shineColor: "rgba(95,224,168,.6)",
    pos: { left:20, top:20, width:292, height:520 },
    render: () => <ServerHostCard />,
    detailTitle: "SERVER / HOST — Extended",
    detailText: "Hetzner CX33 · Falkenstein DC · 4 vCPU · 8 GB RAM · 80 GB NVMe · Ubuntu 22.04. Docker stack: fb-caddy → frontend:80 → backend:8000. Cron via systemd. Backup: daily snapshot.",
  },
  {
    id: "social-token",
    col: 0, title: "SOCIAL · TOKEN HEALTH",
    accentColor: "#5cc9ff", statusColor: "#5fe0a8", shineColor: "rgba(92,201,255,.6)",
    pos: { left:20, top:552, width:292, height:200 },
    render: () => <SocialTokenCard />,
    detailTitle: "Social Token Health — Detail",
    detailText: "OAuth tokens are checked on each monitor refresh. YouTube token expired 2026-06-20 (8 days ago) — reconnect required via Monitor → Social. TikTok was never linked. Facebook + Instagram tokens last verified < 12h ago.",
  },
  {
    id: "api-budgets",
    col: 0, title: "API BUDGETS & LIMITS",
    accentColor: "#ff9a4d", statusColor: "#ff9a4d", status: "72d LEFT", shineColor: "rgba(255,154,77,.6)",
    cssClass: "hud-card--orange",
    pos: { left:20, top:766, width:292, height:218 },
    render: () => <ApiBudgetsCard />,
    detailTitle: "API Budgets — Full Breakdown",
    detailText: "$300 GCP free-trial credit. 72 of 73 days remain (1% elapsed). Gemini: 1,500 req/day free. OpenRouter: 50 req/day shared across all free-model features. Vertex AI: covered by trial credit. IG Graph: 200 calls/user/hr.",
  },
  /* Inner left (col 1) */
  {
    id: "supabase",
    col: 1, title: "SUPABASE",
    accentColor: "#5fe0a8", statusColor: "#5fe0a8", shineColor: "rgba(95,224,168,.6)",
    pos: { left:326, top:20, width:250, height:300 },
    render: (wf) => <SupabaseCard wf={wf} />,
    detailTitle: "Supabase — Database Metrics",
    detailText: "Project: kjruhbaahqkuajseoojn. Free tier: 50k rows, 500 MB DB, 1 GB storage. Row counts are live from the workflow store hydrated on login. Migrations applied via Supabase SQL editor.",
  },
  {
    id: "storage",
    col: 1, title: "STORAGE BREAKDOWN",
    accentColor: "#5fe0a8", statusColor: "#5fe0a8", shineColor: "rgba(95,224,168,.6)",
    pos: { left:326, top:332, width:250, height:250 },
    render: () => <StorageCard />,
    detailTitle: "Storage Breakdown — Detail",
    detailText: "Total tracked: 397 MB. Breakdown: RC video attachments 217 MB (55%), Supabase reel-videos 176 MB (44%), RC other uploads 5 MB (1%). 27 video clips, 21 uploaded files, 13 RC files.",
  },
  {
    id: "gcp",
    col: 1, title: "GOOGLE CLOUD",
    accentColor: "#ff9a4d", statusColor: "#5fe0a8", shineColor: "rgba(255,154,77,.6)",
    cssClass: "hud-card--orange",
    pos: { left:326, top:594, width:250, height:390 },
    render: () => <GoogleCloudCard />,
    detailTitle: "Google Cloud — API Quotas",
    detailText: "Project: footage-brain-database. All APIs currently at 0 usage. YouTube Data API: 10k units/day. Maps JS: 28k/day ($200/mo free credit). Geocoding: 3k/day. No billing cost reported yet — all within free tier.",
  },
  /* Center top (col 2) */
  {
    id: "news-monitor",
    col: 2, title: "NEWS MONITOR",
    accentColor: "#5cc9ff", statusColor: "#5cc9ff", status: "5/5 SOURCES LIVE", shineColor: "rgba(92,201,255,.7)",
    pos: { left:640, top:20, width:480, height:142 },
    render: (wf) => <NewsMonitorCard wf={wf} />,
    detailTitle: "News Monitor — Full Status",
    detailText: "Auto-ingested every 30 min via Pulse. Classified by free OpenRouter models (falls back to source defaults if throttled). Articles auto-prune after 60 days. 5 active sources · 499 articles stored · 0 feeds erroring.",
  },
  /* Center core (col 2) */
  {
    id: "llm-gates",
    col: 2, title: "FREE LLM GATES",
    accentColor: "#ff9a4d", statusColor: "#5fe0a8", status: "5 / 7 ON", shineColor: "rgba(255,154,77,.7)",
    cssClass: "hud-card--orange",
    pos: { left:720, top:700, width:320, height:272 },
    colTransformOverride: "translateZ(-60px)",
    render: (wf) => <FreeLlmGatesCard wf={wf} />,
    detailTitle: "Free LLM Gates — All Features",
    detailText: "Donut counts free-LLM calls from this browser since tracking began (no backfill). ON: Reel DNA, Pulse ingest, Footage Vision Tagging, Workflow Insights, Scout AI dossiers. OFF: Content Forge (Vet stage paused), Idea Generator.",
  },
  /* Inner right (col 3) */
  {
    id: "scout",
    col: 3, title: "SCOUT",
    accentColor: "#ff9a4d", statusColor: "#5fe0a8", shineColor: "rgba(255,154,77,.6)",
    cssClass: "hud-card--orange",
    pos: { left:1186, top:20, width:250, height:300 },
    render: (wf) => <ScoutCard wf={wf} />,
    detailTitle: "Scout — MicroSaaS Intelligence",
    detailText: "Live Scout = src/pages/scout.jsx inside FootageBrain. Separate Scout Supabase DB (rqkzstyvqfmcsxdyogij). Daily auto-scrape at 08:00 UTC. OpenRouter free tier: 50 AI dossiers/day. Product Hunt: 6,250 pts / 15min.",
  },
  {
    id: "ai-credits",
    col: 3, title: "AI CREDITS",
    accentColor: "#ff9a4d", statusColor: "#5fe0a8", shineColor: "rgba(255,154,77,.6)",
    cssClass: "hud-card--orange",
    pos: { left:1186, top:332, width:250, height:240 },
    render: () => <AiCreditsCard />,
    detailTitle: "AI Credits — Cohere",
    detailText: "Cohere free tier: 1,000 API calls/month. Resets 1st of each month. 15 FAQ embeddings created, 0 bot questions this month. Each FAQ approval + bot question = 1 API call.",
  },
  {
    id: "anthropic",
    col: 3, title: "ANTHROPIC (CLAUDE)",
    accentColor: "#ff9a4d", statusColor: "#ff9a4d", shineColor: "rgba(255,154,77,.6)",
    cssClass: "hud-card--orange",
    pos: { left:1186, top:584, width:250, height:200 },
    render: () => <AnthropicCard />,
    detailTitle: "Anthropic — Claude API",
    detailText: "Currently paused (no API key in env). When active: used by AI Brain (Generate hooks), FAQ Bot (answer questions), Content Forge (Expound stage). Model: claude-sonnet-4-6. Toggle in Monitor → AI Brain.",
  },
  /* Far right (col 4) */
  {
    id: "vercel",
    col: 4, title: "VERCEL",
    accentColor: "#5fe0a8", statusColor: "#5fe0a8", shineColor: "rgba(95,224,168,.6)",
    pos: { left:1448, top:20, width:292, height:178 },
    render: () => <VercelCard />,
    detailTitle: "Vercel — Deployment",
    detailText: "Hobby plan: 12 serverless function limit. Deploy: vercel --prod (ships entire working tree — no git push required). 11 / 12 API routes used. footagebrain.com + www.footagebrain.com both active.",
  },
  {
    id: "editor-usage",
    col: 4, title: "EDITOR USAGE",
    accentColor: "#5fe0a8", statusColor: "#5fe0a8", shineColor: "rgba(95,224,168,.6)",
    pos: { left:1448, top:210, width:292, height:206 },
    render: (wf) => <EditorUsageCard wf={wf} />,
    detailTitle: "Editor Usage — Session History",
    detailText: "editor.footagebrain.com — OpenCut fork on Hetzner (port 3200). Sessions logged via FB-side iframe parent to editor_usage_sessions table (migration 0097). CapCut-style UI is the default; classic mode via ?ui=classic.",
  },
  {
    id: "gamify-front",
    col: 4, title: "GAMIFY",
    accentColor: "#c98bff", statusColor: "#c98bff", shineColor: "rgba(201,139,255,.6)",
    pos: { left:1448, top:430, width:292, height:216 },
    render: (wf) => <GamifyFrontCard wf={wf} />,
    detailTitle: "Gamify — Skill Tracking",
    detailText: "Owner-controlled gamification of the video production pipeline. Rubrics score editors per reel. Grading modes: standard, strict. When enabled, locks reels to their assigned editor once work starts.",
  },
];

const BACK_CARDS = [
  /* Far left (col 0) */
  {
    id: "pipeline",
    col: 0, title: "PIPELINE",
    accentColor: "#ff7a1a", statusColor: "#ff7a1a", shineColor: "#ff7a1a",
    cssClass: "hud-card--back-item",
    pos: { left:20, top:20, width:292, height:520 },
    render: (wf) => <PipelineCard wf={wf} />,
    detailTitle: "Pipeline — Full Board",
    detailText: "Kanban board for the video production pipeline. Lanes correspond to production stages. Each reel card tracks who owns it and where it is. Drag cards between columns to move them through the workflow.",
  },
  {
    id: "review-queue",
    col: 0, title: "REVIEW QUEUE",
    accentColor: "#5fe0a8", statusColor: "#5fe0a8", shineColor: "#5fe0a8",
    cssClass: "hud-card--back-item",
    pos: { left:20, top:552, width:292, height:200 },
    render: (wf) => <ReviewQueueCard wf={wf} />,
    detailTitle: "Review Queue — Pending",
    detailText: "Reels in the review lane awaiting owner sign-off. Click the reel to open the detailed review view with the full checklist. Once approved, the reel moves to the publish stage.",
  },
  {
    id: "tasks-comms",
    col: 0, title: "TASKS & COMMS",
    accentColor: "#29b6ff", statusColor: "#29b6ff", shineColor: "#29b6ff",
    cssClass: "hud-card--back-item",
    pos: { left:20, top:766, width:292, height:218 },
    render: (wf) => <TasksCommsCard wf={wf} />,
    detailTitle: "Tasks & Communications",
    detailText: "Team tasks tracked in the Tasks tab. Direct notes via Rocket.Chat (chat.footagebrain.com). Daily tasks refresh every morning. Task assignment via the pipeline board or Tasks page.",
  },
  /* Inner left (col 1) */
  {
    id: "reel-dna",
    col: 1, title: "REEL DNA",
    accentColor: "#5cc9ff", statusColor: "#5cc9ff", shineColor: "#5cc9ff",
    cssClass: "hud-card--back-item",
    pos: { left:326, top:20, width:250, height:300 },
    render: (wf) => <ReelDnaCard wf={wf} />,
    detailTitle: "Reel DNA — Database",
    detailText: "Instagram reel metadata database. Auto-ingested from IG sync (every 2hr cron). Analyzed reels get platform data, hook classification, and engagement metrics. LLM analysis gated by Free LLM Gates → Reel DNA toggle.",
  },
  {
    id: "thumbnail-dna",
    col: 1, title: "THUMBNAIL DNA",
    accentColor: "#c98bff", statusColor: "#c98bff", shineColor: "#c98bff",
    cssClass: "hud-card--back-item",
    pos: { left:326, top:332, width:250, height:250 },
    render: (wf) => <ThumbnailDnaCard wf={wf} />,
    detailTitle: "Thumbnail DNA — Templates",
    detailText: "Library of thumbnail concept templates. Each template tracks style, platform, and performance data. Used as reference when creating new thumbnails for the video pipeline.",
  },
  /* Center (col 2) */
  {
    id: "team-chat",
    col: 2, title: "TEAM CHAT",
    accentColor: "#5cc9ff", statusColor: "#5fe0a8", status: "LIVE", shineColor: "rgba(92,201,255,.7)",
    pos: { left:640, top:20, width:480, height:142 },
    render: () => <TeamChatCard />,
    detailTitle: "Team Chat — Rocket.Chat",
    detailText: "Rocket.Chat 7.13.8 + MongoDB on Hetzner. chat.footagebrain.com. WhatsApp omnichannel available (not yet configured). FB proxies team notifications. Outbox channel linked for publishing workflow.",
  },
  {
    id: "content-forge",
    col: 2, title: "CONTENT FORGE",
    accentColor: "#ff9a4d", statusColor: "#5fe0a8", shineColor: "rgba(255,154,77,.7)",
    cssClass: "hud-card--orange",
    pos: { left:720, top:700, width:320, height:272 },
    colTransformOverride: "translateZ(-60px)",
    render: (wf) => <ContentForgeCard wf={wf} />,
    detailTitle: "Content Forge — Hook Pipeline",
    detailText: "Three-stage hook expansion pipeline: Vet → Elevate → Expound. 18 clips → 8 opportunities → 3 hooks in current run. Token-bleed controls limit LLM over-generation. Solarin skin applied. Shortlist/Reject per row.",
  },
  /* Inner right (col 3) */
  {
    id: "daily-tasks",
    col: 3, title: "DAILY TASKS",
    accentColor: "#5fe0a8", statusColor: "#5fe0a8", shineColor: "rgba(95,224,168,.6)",
    cssClass: "hud-card--back-item",
    pos: { left:1186, top:20, width:250, height:300 },
    render: (wf) => {
      const daily = wf.dailyTasks ?? [];
      return <>
        <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:10 }}>
          <span style={{ font:"600 28px 'Chakra Petch'", color:"#5fe0a8" }}>{daily.filter(t=>!t.done).length || 5}</span>
          <span className="hud-muted" style={{ font:"10px 'Share Tech Mono'" }}>pending today</span>
        </div>
        {daily.slice(0,5).map(t => (
          <div key={t.id} className="hud-metric-row">
            <span style={{ color: t.done ? "#5fe0a8" : "#cfe0f2" }}>{t.done ? "✓" : "○"} {t.title?.slice(0,28)}</span>
          </div>
        ))}
        {!daily.length && <>
          <Row label="○ Review Reel DNA batch" value="—" />
          <Row label="○ Content Forge run"      value="—" />
          <Row label="○ Check IG sync"           value="—" />
          <Row label="✓ Deploy monitor fix"      value="done" valueStyle={{ color:"#5fe0a8" }} />
        </>}
      </>;
    },
    detailTitle: "Daily Tasks — Full List",
    detailText: "Daily task list that resets each morning. Tasks are manually added or auto-generated from pipeline blockers. Completed tasks shown with ✓. Accessible from the Tasks tab or the pipeline board sidebar.",
  },
  {
    id: "resources",
    col: 3, title: "RESOURCES",
    accentColor: "#5cc9ff", statusColor: "#5fe0a8", shineColor: "rgba(92,201,255,.6)",
    cssClass: "hud-card--back-item",
    pos: { left:1186, top:332, width:250, height:250 },
    render: () => <>
      <div className="hud-section-label">TOOLS & LINKS</div>
      <Row label="Resource rows" value="22" />
      <Row label="Resource cells" value="56" />
      <Row label="Categories"    value="8" />
      <div className="hud-muted" style={{ font:"9px 'Share Tech Mono'", marginTop:8 }}>
        Internal tool directory · updated manually by owner
      </div>
    </>,
    detailTitle: "Resources — Tool Directory",
    detailText: "Internal link and tool directory stored in resource_rows + resource_cells tables. Organized by category. Editable from the Resources tab. 22 rows / 56 cells tracked.",
  },
  /* Far right (col 4) */
  {
    id: "gamify-back",
    col: 4, title: "GAMIFY — PROGRESS",
    accentColor: "#c98bff", statusColor: "#c98bff", shineColor: "rgba(201,139,255,.6)",
    cssClass: "hud-card--back-item",
    pos: { left:1448, top:20, width:292, height:280 },
    render: (wf) => <GamifyBackCard wf={wf} />,
    detailTitle: "Gamify — Progress Detail",
    detailText: "Per-person skill rubric tracking for the video production pipeline. Rubric rows store scores per reel/skill/person. Progress dashboard shows team-wide skill advancement. Locked reels prevent re-assignment once scored.",
  },
];

/* ─────────────────────────────────────────────────────
   HudCard — renders one card on a face
─────────────────────────────────────────────────────── */
function HudCard({ card, prefs, wf, onOpen }) {
  const baseTransform = cardTransform(card, prefs);

  return (
    <div
      className={`hud-card ${card.cssClass || ""}`}
      style={{
        position: "absolute",
        left:   card.pos.left,
        top:    card.pos.top,
        width:  card.pos.width,
        height: card.pos.height,
        "--card-base-transform": baseTransform,
        "--card-shine": card.shineColor,
        "--card-accent": card.accentColor,
        zIndex: 5,
      }}
      onClick={() => onOpen(card.id)}
    >
      <div className="hud-card-header">
        <span
          className={`hud-status-dot${card.statusColor === card.accentColor ? " hud-status-dot--pulse" : ""}`}
          style={{ background: card.statusColor || card.accentColor,
            boxShadow: `0 0 9px ${card.statusColor || card.accentColor}` }}
        />
        <span className="hud-card-title" style={{ color: card.accentColor === "#5fe0a8" ? "#bfe6d6"
          : card.accentColor === "#5cc9ff" ? "#bcd6f2"
          : card.accentColor === "#ff9a4d" ? "#ffd4ab"
          : card.accentColor === "#c98bff" ? "#e0ccff"
          : "#bfe6d6" }}>{card.title}</span>
        {card.status && (
          <span className="hud-card-badge"
            style={{ color: card.accentColor, borderColor: `${card.accentColor}66` }}>
            {card.status}
          </span>
        )}
      </div>
      {card.render(wf)}
      <div className="hud-card-expand">⤢ EXPAND</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   HudModal — full-screen card detail
─────────────────────────────────────────────────────── */
function HudModal({ cardId, wf, onClose, stageRef }) {
  const all   = [...FRONT_CARDS, ...BACK_CARDS];
  const card  = useMemo(() => all.find(c => c.id === cardId), [cardId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    if (stageRef?.current) stageRef.current.style.filter = "blur(7px) brightness(.42) saturate(.85)";
    return () => {
      document.removeEventListener("keydown", onKey);
      if (stageRef?.current) stageRef.current.style.filter = "";
    };
  }, [onClose, stageRef]);

  if (!card) return null;

  return (
    <div className="hud-modal hud-modal--open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hud-modal-wrap">
        <div className="hud-modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
            <span className="hud-status-dot" style={{ background: card.accentColor,
              boxShadow:`0 0 9px ${card.accentColor}`, width:9, height:9 }} />
            <span style={{ font:"600 14px 'Chakra Petch'", letterSpacing:".16em",
              color: card.accentColor }}>{card.detailTitle ?? card.title}</span>
          </div>
          <div style={{ font:"10px 'Share Tech Mono'", color:"#7e93ab" }}>
            {card.detailText}
          </div>
        </div>
        <div className="hud-modal-body">
          <div style={{ font:"10px 'Share Tech Mono'" }}>
            {card.render(wf)}
          </div>
        </div>
        <div className="hud-modal-hint">CLICK OUTSIDE OR PRESS ESC TO CLOSE</div>
        <button className="hud-modal-close" onClick={onClose}>×</button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   HudLayoutMenu — spatial customization panel
─────────────────────────────────────────────────────── */
const COL_LABELS = ["Far Left", "Inner Left", "Center", "Inner Right", "Far Right"];

function HudLayoutMenu({ prefs, onUpdate, onUpdateCol, onReset, onClose }) {
  return (
    <div className="hud-layout-menu">
      <button className="hud-menu-close-btn" onClick={onClose}>×</button>
      <h3>⚙ LAYOUT CONTROLS</h3>

      <h4>GLOBAL</h4>
      <div className="hud-slider-row">
        <label>Perspective</label>
        <input type="range" min="800" max="2400" step="50"
          value={prefs.perspective}
          onChange={e => onUpdate("perspective", Number(e.target.value))} />
        <span>{prefs.perspective}px</span>
      </div>
      <div className="hud-slider-row">
        <label>Card depth</label>
        <input type="range" min="0" max="300" step="10"
          value={prefs.cardDepth}
          onChange={e => onUpdate("cardDepth", Number(e.target.value))} />
        <span>{prefs.cardDepth}px</span>
      </div>
      <div className="hud-slider-row">
        <label>Column tighten</label>
        <input type="range" min="0" max="400" step="10"
          value={prefs.colTighten}
          onChange={e => onUpdate("colTighten", Number(e.target.value))} />
        <span>{prefs.colTighten}px</span>
      </div>

      <h4>CARD TILT</h4>
      <div className="hud-slider-row">
        <label>Top tilt</label>
        <input type="range" min="-45" max="45" step="1"
          value={prefs.topTilt}
          onChange={e => onUpdate("topTilt", Number(e.target.value))} />
        <span>{prefs.topTilt}°</span>
      </div>
      <div className="hud-slider-row">
        <label>Bottom tilt</label>
        <input type="range" min="-45" max="45" step="1"
          value={prefs.bottomTilt}
          onChange={e => onUpdate("bottomTilt", Number(e.target.value))} />
        <span>{prefs.bottomTilt}°</span>
      </div>

      <h4>GLOBE</h4>
      <div className="hud-slider-row">
        <label>Spin</label>
        <input type="range" min="0" max="3" step="0.1"
          value={prefs.globeSpin}
          onChange={e => onUpdate("globeSpin", Number(e.target.value))} />
        <span>{prefs.globeSpin.toFixed(1)}×</span>
      </div>
      <div className="hud-slider-row">
        <label>Ray height</label>
        <input type="range" min="0" max="3" step="0.1"
          value={prefs.rayHeight}
          onChange={e => onUpdate("rayHeight", Number(e.target.value))} />
        <span>{prefs.rayHeight.toFixed(1)}×</span>
      </div>
      <div className="hud-slider-row">
        <label>World map</label>
        <input type="range" min="0" max="1" step="0.05"
          value={prefs.mapOpacity}
          onChange={e => onUpdate("mapOpacity", Number(e.target.value))} />
        <span>{Math.round(prefs.mapOpacity * 100)}%</span>
      </div>

      <h4>COLUMN ANGLES</h4>
      {COL_LABELS.map((lbl, i) => (
        <div key={i} className="hud-slider-row">
          <label>{lbl}</label>
          <input type="range" min="-60" max="60" step="1"
            value={prefs.colAngles[i]}
            onChange={e => onUpdateCol(i, Number(e.target.value))} />
          <span>{prefs.colAngles[i]}°</span>
        </div>
      ))}

      <button className="hud-reset-btn" onClick={onReset}>RESET DEFAULTS</button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   HudGlobe — rotating canvas globe
─────────────────────────────────────────────────────── */
function HudGlobe({ canvasRef, prefsRef }) {
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const CSS = 360;
    cv.width  = CSS * dpr;
    cv.height = CSS * dpr;
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    const cx = 180, cy = 180, R = 150, N = 920;
    const D2R = Math.PI / 180;
    const land = [
      [8,18,30],[2,22,24],[16,6,15],[-6,24,20],[-26,24,16],[12,-2,12],
      [50,12,15],[58,30,16],[44,-2,9],
      [46,86,32],[30,78,22],[56,98,26],[22,100,15],[60,140,22],[40,55,16],
      [44,-100,28],[60,-108,24],[31,-92,15],[64,-150,16],[52,-122,12],
      [-12,-60,22],[-30,-64,15],[2,-66,13],[-44,-70,9],
      [-25,134,17],[-32,147,8],[72,-42,12],[-80,0,42],
    ];
    const isLand = (latR, lonR) => land.some(([la,lo,rr]) => {
      const d = Math.acos(Math.max(-1,Math.min(1,
        Math.sin(latR)*Math.sin(la*D2R) + Math.cos(latR)*Math.cos(la*D2R)*Math.cos(lonR-lo*D2R))));
      return d < rr * D2R;
    });
    const pts = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * 2.399963;
      const x = Math.cos(phi) * r, z = Math.sin(phi) * r;
      pts.push({ x, y, z, land: isLand(Math.asin(Math.max(-1,Math.min(1,y))), Math.atan2(z,x)) });
    }
    const landPts = pts.filter(p => p.land);
    const hot = [];
    for (let i = 0; i < 28 && landPts.length; i++) hot.push(landPts[(i * 53 + 11) % landPts.length]);

    let gA = 0, gTilt = 0.42, gVel = 0, gDrag = false, gLX = 0, gLY = 0;
    let raf = null;
    const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

    const pdDown = (e) => {
      gDrag = true; gLX = e.clientX; gLY = e.clientY; gVel = 0;
      cv.style.cursor = "grabbing";
      try { cv.setPointerCapture(e.pointerId); } catch {}
    };
    const pdMove = (e) => {
      if (!gDrag) return;
      gA    += (e.clientX - gLX) * 0.0065;
      gTilt  = clamp(gTilt - (e.clientY - gLY) * 0.006, -1.05, 1.05);
      gVel   = (e.clientX - gLX) * 0.0065;
      gLX = e.clientX; gLY = e.clientY;
    };
    const pdEnd = () => { gDrag = false; cv.style.cursor = "grab"; };

    cv.addEventListener("pointerdown", pdDown);
    cv.addEventListener("pointermove", pdMove);
    cv.addEventListener("pointerup",   pdEnd);
    cv.addEventListener("pointercancel", pdEnd);

    const proj = (p, ca, sa, ct, st) => {
      const xr = p.x * ca + p.z * sa, zr = -p.x * sa + p.z * ca;
      const yt = p.y * ct - zr * st,  zt = p.y * st + zr * ct;
      return { sx: cx + xr * R, sy: cy + yt * R, z: zt };
    };

    const draw = () => {
      const gp     = prefsRef?.current || {};
      const spin   = gp.globeSpin ?? 1;
      const rayH   = gp.rayHeight ?? 1;
      const mapOp  = gp.mapOpacity ?? 0;
      ctx.clearRect(0, 0, CSS, CSS);
      if (!gDrag) { gA += 0.0019 * spin + gVel; gVel *= 0.93; }
      const ca = Math.cos(gA), sa = Math.sin(gA), ct = Math.cos(gTilt), st = Math.sin(gTilt);
      const g = ctx.createRadialGradient(cx-46,cy-54,14,cx,cy,R+14);
      g.addColorStop(0,"rgba(42,112,172,.34)"); g.addColorStop(.55,"rgba(18,52,92,.24)"); g.addColorStop(1,"rgba(6,16,30,.05)");
      ctx.beginPath(); ctx.arc(cx,cy,R,0,7); ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = "rgba(120,190,235,.07)"; ctx.lineWidth = 0.7;
      for (let m = 0; m < 6; m++) {
        const lon = m * Math.PI / 6; ctx.beginPath(); let pen = false;
        for (let j = 0; j <= 44; j++) {
          const lat = -Math.PI/2 + Math.PI*j/44;
          const q = proj({x:Math.cos(lat)*Math.cos(lon),y:Math.sin(lat),z:Math.cos(lat)*Math.sin(lon)},ca,sa,ct,st);
          if (q.z < -0.02) { pen = false; continue; }
          pen ? ctx.lineTo(q.sx,q.sy) : ctx.moveTo(q.sx,q.sy); pen = true;
        }
        ctx.stroke();
      }
      for (const p of pts) {
        const q = proj(p,ca,sa,ct,st); const al = (q.z+1)/2;
        if (al < 0.1) continue;
        ctx.beginPath();
        ctx.arc(q.sx,q.sy, p.land ? 1+al*1.5 : 0.5+al*0.7, 0, 7);
        ctx.fillStyle = p.land ? `rgba(74,205,150,${.2+al*.5})` : `rgba(92,162,228,${.05+al*.2})`;
        ctx.fill();
      }
      /* World-map overlay: fill the land blobs as solid continents (slider-driven) */
      if (mapOp > 0.01) {
        for (const [la, lo, rr] of land) {
          const lat = la * D2R, lon = lo * D2R;
          const q = proj({ x: Math.cos(lat)*Math.cos(lon), y: Math.sin(lat), z: Math.cos(lat)*Math.sin(lon) }, ca, sa, ct, st);
          if (q.z < -0.05) continue;
          const facing = (q.z + 1) / 2;
          const sr = rr * D2R * R * (0.6 + 0.4 * facing);
          ctx.beginPath(); ctx.arc(q.sx, q.sy, sr, 0, 7);
          ctx.fillStyle = `rgba(74,205,150,${mapOp * (0.10 + 0.22 * facing)})`;
          ctx.fill();
        }
      }
      ctx.lineWidth = 0.8;
      for (let i = 0; i < hot.length; i += 2) {
        const q1 = proj(hot[i],ca,sa,ct,st), q2 = proj(hot[(i+3)%hot.length],ca,sa,ct,st);
        if (q1.z > -0.1 && q2.z > -0.1) {
          const mx = (q1.sx+q2.sx)/2, my = (q1.sy+q2.sy)/2;
          ctx.beginPath(); ctx.moveTo(q1.sx,q1.sy);
          ctx.quadraticCurveTo(mx+(mx-cx)*.28, my+(my-cy)*.28, q2.sx,q2.sy);
          ctx.strokeStyle = "rgba(255,150,70,.18)"; ctx.stroke();
        }
      }
      const pulse = 0.6 + 0.4 * Math.sin(gA * 3.4);
      ctx.globalCompositeOperation = "lighter";
      for (const h of hot) {
        const q = proj(h,ca,sa,ct,st); if (q.z < -0.05) continue;
        const al = (q.z+1)/2;
        const dx = q.sx-cx, dy = q.sy-cy, len = Math.hypot(dx,dy)||1;
        const ux = dx/len, uy = dy/len, px = -uy, py = ux;
        const L = (14 + al*48*(0.7+0.3*pulse)) * rayH, bw = 1.5+al*1.7;
        const tx2 = q.sx+ux*L, ty2 = q.sy+uy*L;
        const grd = ctx.createLinearGradient(q.sx,q.sy,tx2,ty2);
        grd.addColorStop(0,`rgba(255,150,50,${.55*al})`); grd.addColorStop(.5,`rgba(255,120,40,${.28*al})`); grd.addColorStop(1,"rgba(255,90,30,0)");
        ctx.beginPath(); ctx.moveTo(q.sx+px*bw,q.sy+py*bw); ctx.lineTo(q.sx-px*bw,q.sy-py*bw); ctx.lineTo(tx2,ty2); ctx.closePath();
        ctx.fillStyle = grd; ctx.fill();
        ctx.beginPath(); ctx.moveTo(q.sx,q.sy); ctx.lineTo(q.sx+ux*L*.66,q.sy+uy*L*.66);
        ctx.strokeStyle = `rgba(255,195,115,${.7*al})`; ctx.lineWidth = 1.1; ctx.stroke();
        ctx.beginPath(); ctx.arc(q.sx,q.sy,1.8+al*1.8,0,7);
        ctx.fillStyle = `rgba(255,185,95,${.7+.3*al})`; ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath(); ctx.arc(cx,cy,R+1,0,7);
      ctx.strokeStyle = "rgba(90,180,255,.24)"; ctx.lineWidth = 1.5; ctx.stroke();
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      cv.removeEventListener("pointerdown", pdDown);
      cv.removeEventListener("pointermove", pdMove);
      cv.removeEventListener("pointerup",   pdEnd);
      cv.removeEventListener("pointercancel", pdEnd);
    };
  }, [canvasRef, prefsRef]);

  return null;
}

/* ─────────────────────────────────────────────────────
   HudSpace — root component
─────────────────────────────────────────────────────── */
export function HudSpace() {
  const { person } = useAuth();
  if (person && person.role !== "owner") {
    if (typeof window !== "undefined") window.location.replace("/app");
    return null;
  }
  return <HudSpaceInner />;
}

function HudSpaceInner() {
  const wf = useWorkflow();

  /* ── Refs ─────────────────────────────────────────── */
  const rootRef   = useRef(null);
  const stageRef  = useRef(null);
  const worldRef  = useRef(null);
  const frontRef  = useRef(null);
  const backRef   = useRef(null);
  const billRef   = useRef(null);
  const canvasRef = useRef(null);

  /* ── State ────────────────────────────────────────── */
  const [prefs, setPrefs] = useState(loadPrefs);
  const [menuOpen,    setMenuOpen]    = useState(false);
  const [activeCard,  setActiveCard]  = useState(null);

  /* ── Starfield (generated once) ───────────────────── */
  const starShadow = useMemo(() => {
    const W = (typeof window !== "undefined" ? window.innerWidth  : 1920) + 200;
    const H = (typeof window !== "undefined" ? window.innerHeight : 1080) + 200;
    const stars = [];
    for (let i = 0; i < 140; i++) {
      const x = Math.floor(Math.random() * W);
      const y = Math.floor(Math.random() * H);
      const a = (Math.random() * 0.5 + 0.3).toFixed(2);
      stars.push(`${x}px ${y}px 0 0 rgba(255,255,255,${a})`);
    }
    return stars.join(",");
  }, []);

  /* ── Apply CSS vars whenever prefs change ─────────── */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty("--hud-perspective", prefs.perspective + "px");
    el.style.setProperty("--hud-card-depth",  prefs.cardDepth  + "px");
    const s = Math.min(window.innerWidth/1760, window.innerHeight/1000) * 0.82 * prefs.zoom;
    if (stageRef.current) stageRef.current.style.transform = `translate(-50%,-50%) scale(${s})`;
  }, [prefs]);

  const updatePref = useCallback((key, val) => {
    setPrefs(p => {
      const next = { ...p, [key]: val };
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const updateColAngle = useCallback((i, val) => {
    setPrefs(p => {
      const colAngles = [...p.colAngles];
      colAngles[i] = val;
      const next = { ...p, colAngles };
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetPrefs = useCallback(() => {
    localStorage.removeItem(PREFS_KEY);
    setPrefs({ ...DEFAULT_PREFS });
  }, []);

  /* ── Camera drag-to-rotate ────────────────────────── */
  const cam = useRef({ yaw:0, pitch:0, orb:false, oX:0, oY:0, oVel:0, coastRaf:null });
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const applyCam = useCallback(() => {
    const { yaw, pitch } = cam.current;
    if (worldRef.current) worldRef.current.style.transform = `rotateY(${yaw}deg) rotateX(${pitch}deg)`;
    if (billRef.current)  billRef.current.style.transform  = `rotateX(${-pitch}deg) rotateY(${-yaw}deg)`;
    const cf = Math.cos(yaw * Math.PI / 180);
    const cl = v => Math.max(0, Math.min(1, v));
    const fO = cl((cf + 0.12) / 0.4), bO = cl((-cf + 0.12) / 0.4);
    if (frontRef.current) {
      frontRef.current.style.opacity       = fO;
      frontRef.current.style.pointerEvents = fO > 0.5 ? "auto" : "none";
    }
    if (backRef.current) {
      backRef.current.style.opacity       = bO;
      backRef.current.style.pointerEvents = bO > 0.5 ? "auto" : "none";
    }
  }, []);

  const fitStage = useCallback(() => {
    if (!stageRef.current) return;
    const s = Math.min(window.innerWidth/1760, window.innerHeight/1000) * 0.82 * prefsRef.current.zoom;
    stageRef.current.style.transform = `translate(-50%,-50%) scale(${s})`;
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    fitStage();
    const onResize = () => fitStage();
    window.addEventListener("resize", onResize);

    const coast = () => {
      if (cam.current.orb) return;
      if (Math.abs(cam.current.oVel) < 0.015) { cam.current.oVel = 0; return; }
      cam.current.yaw += cam.current.oVel;
      cam.current.oVel *= 0.92;
      applyCam();
      cam.current.coastRaf = requestAnimationFrame(coast);
    };

    const onDown = (e) => {
      if (e.target.closest(".hud-card") || e.target.tagName === "CANVAS") return;
      if (activeCard) return;
      cam.current.orb = true;
      cam.current.oX  = e.clientX;
      cam.current.oY  = e.clientY;
      cam.current.oVel = 0;
      root.classList.add("hud-dragging");
    };
    const onMove = (e) => {
      if (!cam.current.orb) return;
      const dx = e.clientX - cam.current.oX, dy = e.clientY - cam.current.oY;
      cam.current.yaw   += dx * 0.26;
      cam.current.pitch  = Math.max(-34, Math.min(36, cam.current.pitch - dy * 0.18));
      cam.current.oVel   = dx * 0.26;
      cam.current.oX     = e.clientX;
      cam.current.oY     = e.clientY;
      applyCam();
    };
    const onUp = () => {
      if (!cam.current.orb) return;
      cam.current.orb = false;
      root.classList.remove("hud-dragging");
      coast();
    };
    const onWheel = (e) => {
      e.preventDefault();
      const newZoom = Math.max(0.5, Math.min(2.0, prefsRef.current.zoom * (1 - e.deltaY * 0.0012)));
      updatePref("zoom", newZoom);
    };

    root.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    root.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      window.removeEventListener("resize", onResize);
      root.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      root.removeEventListener("wheel", onWheel);
      if (cam.current.coastRaf) cancelAnimationFrame(cam.current.coastRaf);
    };
  }, [applyCam, fitStage, updatePref]); // activeCard excluded intentionally

  return (
    <div ref={rootRef} className="hud-root" id="hud-root">
      {/* Deep-space backdrop */}
      <div className="hud-sun" />
      <div className="hud-stars" style={{ boxShadow: starShadow }} />

      {/* Decorative overlays */}
      <div className="hud-grid-overlay" />
      <div className="hud-top-accent" />

      {/* 3D stage */}
      <div ref={stageRef} className="hud-stage">
        <div ref={worldRef} className="hud-world">

          {/* Pedestal rings behind globe */}
          <div className="hud-pedestal">
            <div className="hud-pedestal-ring-outer" />
            <div className="hud-pedestal-ring-mid" />
            <div className="hud-pedestal-spin-1"><div /></div>
            <div className="hud-pedestal-spin-2"><div /></div>
          </div>

          {/* Globe (billboard — counter-rotates with world to stay flat) */}
          <div ref={billRef} className="hud-bill">
            <div className="hud-globe-glow" />
            <canvas ref={canvasRef} className="hud-globe-canvas" />
          </div>

          {/* Pipeline process strip (center decoration) */}
          <div className="hud-pipeline-strip">
            <div className="hud-pipeline-line" />
            {[["◎","#ff9a4d","INGEST"],["⊹","#ff9a4d","ANALYZE"],["✦","#5cc9ff","GENERATE"],["⇡","#5cc9ff","PUBLISH"],["◈","#5fe0a8","MONITOR"]]
              .map(([icon,color,lbl]) => (
                <div key={lbl} className="hud-pipeline-node">
                  <span style={{ border:`1px solid ${color}66`, color, boxShadow:`0 0 12px ${color}55` }}>{icon}</span>
                  <span>{lbl}</span>
                </div>
              ))}
          </div>

          {/* ── FRONT FACE ── */}
          <div ref={frontRef} className="hud-face hud-face--front">
            {FRONT_CARDS.map(card => (
              <HudCard key={card.id} card={card} prefs={prefs} wf={wf} onOpen={setActiveCard} />
            ))}
          </div>

          {/* ── BACK FACE ── */}
          <div ref={backRef} className="hud-face hud-face--back">
            {BACK_CARDS.map(card => (
              <HudCard key={card.id} card={card} prefs={prefs} wf={wf} onOpen={setActiveCard} />
            ))}
          </div>
        </div>
      </div>

      {/* Globe drawing hook (no DOM output) */}
      <HudGlobe canvasRef={canvasRef} prefsRef={prefsRef} />

      {/* ← Back to My Work */}
      <button
        className="hud-back-btn"
        onClick={() => {
          try { localStorage.setItem("wb_view", "mywork"); } catch {}
          window.location.assign("/app");
        }}
      >
        ← MY WORK
      </button>

      {/* ⚙ Layout menu toggle */}
      <button className="hud-menu-btn" onClick={() => setMenuOpen(o => !o)}>
        ⚙ LAYOUT
      </button>

      {/* Layout menu panel */}
      {menuOpen && (
        <HudLayoutMenu
          prefs={prefs}
          onUpdate={updatePref}
          onUpdateCol={updateColAngle}
          onReset={resetPrefs}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {/* Modal */}
      {activeCard && (
        <HudModal
          cardId={activeCard}
          wf={wf}
          stageRef={stageRef}
          onClose={() => setActiveCard(null)}
        />
      )}
    </div>
  );
}

export default HudSpace;
