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
import { createPortal } from "react-dom";
import { useAuth } from "../auth.jsx";
import { useWorkflow } from "../store/store.jsx";
import { useRoster } from "../lib/roster.jsx";
import { STAGES, STAGE_LABEL, STAGE_TONE } from "../lib/shared-data.jsx";
import { useMonitorStatus } from "../lib/use-monitor-status.js";
import { MONITOR_CARDS } from "./monitor.jsx";
import { supabase } from "../lib/supabase-client.js";
import { HudGlobe3D } from "./hud-globe-webgl.jsx";
import "./hud-space.css";

/* ── Default layout preferences ───────────────────── */
const PREFS_KEY = "hud_layout_prefs";          // legacy prefs (migrated forward)
const LAYOUT_KEY = "hud_layout_v2";            // { version, prefs, slots }
const STAGE_W = 1760, FACE_W = 1760;           // face plane width
const DEFAULT_PREFS = {
  perspective: 1700,
  zoom: 1.0,            // kept for the mouse-wheel gesture (no menu slider)
  cardDepth: 200,
  swing: 44,            // convenience: writes colAngles symmetrically
  colAngles: [-44, -24, 0, 24, 44],  // per-column rotateY
  tighten: 0,           // px to pull side columns inward (window effect)
  topTilt: 0,           // rotateX deg for the TOP card of each column
  bottomTilt: 0,        // rotateX deg for the BOTTOM card of each column
  globeSpin: 0.6,       // WebGL globe auto-rotate speed (0 = frozen)
  globeZoom: 1.0,       // WebGL globe camera zoom (0.5 far … 1.8 close)
  globeDots: 1.0,       // glowing point/ring size multiplier
  globeArc: 1.0,        // arc travel-speed multiplier
  globeAtmo: 1.0,       // atmosphere glow (0 = off)
};
const GRID = 20;        // invisible snap grid (hold Alt to bypass)
function snap(v, free) { return free ? Math.round(v) : Math.round(v / GRID) * GRID; }
function loadPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; }
  catch { return { ...DEFAULT_PREFS }; }
}

/* ── Column geometry (5 inward-curving bands) ──────────────
   A card's column is DERIVED from its horizontal centre, so dragging a card
   sideways re-buckets it into the nearest column and it inherits that column's
   inward swing automatically (keeps the cockpit curve under freeform editing). */
const COL_X          = [-86, -24, 0, 24, 86];   // per-column X nudge (on top of pos.left)
const COL_DEPTH      = [ 76,   2, 0,  2, 76];   // per-column forward translateZ (outer cols curve in)
const COL_TIGHTEN_DIR = [1, 0.5, 0, -0.5, -1];  // inward direction for "tighten" (pull side cols in)

function colOf(pos) {
  const cx = (pos.left + pos.width / 2) / FACE_W;       // 0..1 across the face
  return Math.max(0, Math.min(4, Math.floor(cx * 5)));
}
/* Mirrored swing → symmetric per-column angles (used by the convenience slider) */
function swingToAngles(swing) {
  const s = swing || 0;
  return [-s, -s / 2, 0, s / 2, s];
}

/* Per-card transform. Per-card overrides (slot.turn/tilt/z) beat the column
   defaults. In edit mode cards render FLAT so pos maps 1:1 to the screen
   (true WYSIWYG grid editing). tiltRow ∈ {"top","bottom",null} picks which
   column-default rotateX tilt applies (top-/bottom-most card only). */
function cardTransformFor(slot, col, prefs, tiltRow, editMode) {
  if (editMode) return "translateZ(0px)";
  const turn = slot.turn != null ? slot.turn : (prefs.colAngles?.[col] ?? 0);
  const tilt = slot.tilt != null ? slot.tilt
             : tiltRow === "top" ? (prefs.topTilt || 0)
             : tiltRow === "bottom" ? (prefs.bottomTilt || 0)
             : 0;
  const tiltStr = tilt ? ` rotateX(${tilt}deg)` : "";
  const z = slot.z != null ? slot.z : COL_DEPTH[col];
  const tighten = (prefs.tighten || 0) * COL_TIGHTEN_DIR[col];
  return `translateX(${COL_X[col] + tighten}px) translateZ(${z}px) rotateY(${turn}deg)${tiltStr}`;
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

/* ─────────────────────────────────────────────────────
   NAVIGATION — "Open full tab" transport. Mirrors the Back-to-My-Work
   pattern: stash the target view (+ optional Monitor sub-mode / Reel-DNA
   deep-link) then hard-navigate to the SPA shell at /app.
─────────────────────────────────────────────────────── */
/* Compact "3m ago" / "2h ago" relative-time label for freshness chrome. */
function relAgo(when) {
  if (!when) return "";
  const t = when instanceof Date ? when.getTime() : new Date(when).getTime();
  if (!t || Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function goToTab(target) {
  if (!target) return;
  try {
    localStorage.setItem("wb_view", target.view);
    if (target.mode)  localStorage.setItem("wb_monitor_mode", target.mode);
    if (target.tab)   localStorage.setItem("wb_open_reeldna_tab", target.tab);
    if (target.openId) localStorage.setItem("wb_open_reeldna_id", target.openId);
  } catch (_) {}
  window.location.assign("/app");
}

/* Per-content open-tab target. Delegated infra + mon-* cards → Monitor; pipe-*
   → Pipeline; the rest from an explicit map. */
const OPEN_TAB_BY_ID = {
  "tasks-comms":   { view: "mywork",        label: "Open My Work" },
  "daily-tasks":   { view: "mywork",        label: "Open My Work" },
  "reel-dna":      { view: "reeldna",       label: "Open Reel DNA" },
  "thumbnail-dna": { view: "reeldna", tab: "thumbnails", label: "Open Thumbnails" },
  "pipeline":      { view: "pipeline",      label: "Open Pipeline" },
  "review-queue":  { view: "pipeline",      label: "Open Pipeline" },
  "content-forge": { view: "content-forge", label: "Open Content Forge" },
  "resources":     { view: "resources",     label: "Open Resources" },
  "team-chat":     { view: "team",          label: "Open Team Chat" },
  "gamify-back":   { view: "monitor", mode: "infra", label: "Open Monitor" },
};
function openTabFor(contentId) {
  if (!contentId) return null;
  if (OPEN_TAB_BY_ID[contentId]) return OPEN_TAB_BY_ID[contentId];
  if (contentId.startsWith("mon-") || STATIC_TO_MON[contentId])
    return { view: "monitor", mode: "infra", label: "Open Monitor" };
  if (contentId.startsWith("pipe-")) return { view: "pipeline", label: "Open Pipeline" };
  return null;
}

function HudOpenTabButton({ target }) {
  if (!target) return null;
  return (
    <button className="hud-opentab-btn"
      onClick={(e) => { e.stopPropagation(); goToTab(target); }}>
      {target.label} →
    </button>
  );
}

/* Cheap stand-in for a heavy self-fetching Monitor card while it sits on the
   3D face — the real component only mounts when the card is expanded (throttle). */
function HudHeavyPlaceholder({ title }) {
  return (
    <div className="hud-heavy-ph">
      <span className="hud-status-dot hud-status-dot--pulse"
        style={{ background:"#5cc9ff", boxShadow:"0 0 9px #5cc9ff" }} />
      <div>
        <div className="hud-heavy-ph-title">{title}</div>
        <div className="hud-heavy-ph-sub">Live · expand to load</div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   INTERACTIVE EXPANDED PANELS — only mounted inside the modal (Decision 1:
   manipulation lives in the expanded view; the 3D face stays a read summary).
─────────────────────────────────────────────────────── */

/* To-do list = the DAILY-TASKS list from My Work (checkable, persisted). */
function TodoPanel({ ctx }) {
  const wf = ctx.wf;
  const a = wf.actions || {};
  const personId = ctx.person?.id || null;
  const today = new Date().toISOString().slice(0, 10);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const tasks = (wf.dailyTasks || [])
    .filter(t => t.assignedTo === personId)
    .filter(t => !t.completed || t.taskDate === today)
    .sort((x, y) => {
      if (x.completed !== y.completed) return x.completed ? 1 : -1;
      const sx = x.sortOrder ?? Infinity, sy = y.sortOrder ?? Infinity;
      if (sx !== sy) return sx - sy;
      return (x.created_at || "").localeCompare(y.created_at || "");
    });

  const add = async () => {
    const v = text.trim();
    if (!v || busy || !personId) return;
    setBusy(true);
    try {
      await a.createDailyTask?.({ assignedTo: personId, createdBy: personId, taskText: v, taskDate: today });
      setText("");
    } finally { setBusy(false); }
  };

  return (
    <div className="hud-todo">
      <div className="hud-section-label">
        TO-DO · {tasks.filter(t => !t.completed).length} open
      </div>
      {tasks.length === 0 && <div className="hud-muted" style={{ padding:"6px 0" }}>No tasks for today.</div>}
      {tasks.map(t => (
        <div key={t.id} className={`hud-todo-row${t.completed ? " hud-todo-row--done" : ""}`}>
          <button className="hud-todo-check" title={t.completed ? "Mark open" : "Complete"}
            onClick={() => a.completeDailyTask?.(t.id, !t.completed)}>
            {t.completed ? "✓" : "○"}
          </button>
          <span className="hud-todo-text">{t.taskText}</span>
          <button className="hud-todo-del" title="Delete"
            onClick={() => a.deleteDailyTask?.(t.id)}>✕</button>
        </div>
      ))}
      <div className="hud-todo-add">
        <input value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") add(); }}
          placeholder={personId ? "Add a task for today…" : "Sign in to add tasks"} />
        <button className="hud-todo-addbtn" onClick={add} disabled={!text.trim() || busy || !personId}>Add</button>
      </div>
    </div>
  );
}

/* Recent Reel DNA captures — highlights IG-DM imports; row click deep-links
   straight to that reel in the Reel DNA tab. */
function ReelDnaRecentPanel({ ctx }) {
  const items = (ctx.wf.reelDna || []).filter(i => !i.deletedAt && !i.archivedAt);
  const [dmOnly, setDmOnly] = useState(false);
  const shown = (dmOnly ? items.filter(i => i.source === "ig_dm") : items).slice(0, 20);
  const dmCount = items.filter(i => i.source === "ig_dm").length;
  return (
    <div className="hud-recent">
      <div className="hud-recent-head">
        <span className="hud-section-label">RECENT CAPTURES · {items.length}</span>
        <button className={`hud-recent-filter${dmOnly ? " is-on" : ""}`} onClick={() => setDmOnly(v => !v)}>
          DM imports · {dmCount}
        </button>
      </div>
      {shown.length === 0 && <div className="hud-muted" style={{ padding:"6px 0" }}>Nothing captured yet.</div>}
      {shown.map(it => (
        <button key={it.id} className="hud-recent-row"
          onClick={() => goToTab({ view: "reeldna", openId: it.id })}>
          <span className="hud-recent-main">
            {it.source === "ig_dm" && <span className="hud-recent-badge">DM</span>}
            {(it.handle || it.author || it.title || it.reelUrl || "Untitled").toString().slice(0, 40)}
          </span>
          <span className="hud-recent-meta">{(it.platform || "—")} · {it.status || "captured"}</span>
        </button>
      ))}
    </div>
  );
}

/* Recent thumbnail captures — grid of images; click deep-links to the
   Thumbnails sub-tab. */
function ThumbnailRecentPanel({ ctx }) {
  const items = (ctx.wf.thumbnailDna || []).filter(i => !i.deletedAt && !i.archivedAt).slice(0, 24);
  return (
    <div className="hud-recent">
      <div className="hud-section-label">RECENT THUMBNAILS · {(ctx.wf.thumbnailDna || []).length}</div>
      {items.length === 0 && <div className="hud-muted" style={{ padding:"6px 0" }}>No thumbnails captured yet.</div>}
      <div className="hud-thumb-grid">
        {items.map(it => (
          <button key={it.id} className="hud-thumb"
            title={it.title || it.channel || ""}
            onClick={() => goToTab({ view: "reeldna", tab: "thumbnails", openId: it.id })}>
            {it.thumbnailUrl
              ? <img src={it.thumbnailUrl} alt={it.title || "thumbnail"} loading="lazy" />
              : <div className="hud-thumb-blank">{(it.title || "?").slice(0, 12)}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

/* Live pipeline overview — stage counts + recent reels (view-only, Decision 3). */
function PipelineExpanded({ ctx }) {
  const items = pipeItems(ctx.wf);
  return (
    <div className="hud-pipe-expanded">
      <div className="hud-pipe-counts">
        {STAGES.map(s => (
          <div key={s} className="hud-pipe-count">
            <span style={{ color: TONE_HEX[STAGE_TONE[s]] ?? "#5cc9ff" }}>
              {items.filter(r => r.stage === s).length}
            </span>
            <em>{STAGE_LABEL[s] ?? s}</em>
          </div>
        ))}
      </div>
      <div className="hud-section-label">RECENT REELS</div>
      {items.slice(0, 14).map(r => (
        <div key={r.id} className="hud-pipeline-item"
          style={{ borderLeftColor: TONE_HEX[STAGE_TONE[r.stage]] ?? "#5cc9ff" }}>
          {r.title || r.name || "Untitled reel"}
          <span className="hud-muted" style={{ marginLeft:6, fontSize:9 }}>· {STAGE_LABEL[r.stage] ?? r.stage}</span>
        </div>
      ))}
    </div>
  );
}

/* Review queue — reels awaiting sign-off. */
function ReviewQueueExpanded({ ctx }) {
  const queue = (ctx.wf.reviewLaneCards || []).filter(c => !c.archivedAt);
  return (
    <div className="hud-recent">
      <div className="hud-section-label">AWAITING REVIEW · {queue.length}</div>
      {queue.length === 0 && <div className="hud-muted" style={{ padding:"6px 0" }}>Nothing in the review lane.</div>}
      {queue.map(c => (
        <Row key={c.id} label={(c.title || c.reelTitle || "Reel").slice(0, 34)} value={c.reviewer || "unassigned"} />
      ))}
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
  const items = pipeItems(wf);
  const count = (s) => items.filter(r => r.stage === s).length;
  return (
    <>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6,
        marginBottom:10, font:"8px 'Chakra Petch'", letterSpacing:".08em" }}>
        <div style={{ color:"#9fb4cc" }}>NOT STARTED <span style={{ color:"#ff7a1a" }}>{count("not_started")}</span></div>
        <div style={{ color:"#9fb4cc" }}>IN PROGRESS <span style={{ color:"#29b6ff" }}>{count("in_progress")}</span></div>
        <div style={{ color:"#9fb4cc" }}>REVIEW <span style={{ color:"#5fe0a8" }}>{count("review")}</span></div>
      </div>
      {items.slice(0,5).map(r => (
        <div key={r.id} className="hud-pipeline-item"
          style={{ borderLeftColor: TONE_HEX[STAGE_TONE[r.stage]] ?? "#ff8a3d" }}>
          {r.title || r.name || "Untitled reel"}
        </div>
      ))}
      {!items.length && <div className="hud-muted" style={{ font:"10px 'Share Tech Mono'", marginTop:6 }}>No reels in the pipeline.</div>}
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
        <Row key={c.id} label={(c.title || c.reelTitle || "Reel").slice(0,28)} value={c.reviewer || "unassigned"} />
      ))}
      {!queue.length && <div className="hud-muted" style={{ font:"10px 'Share Tech Mono'", marginTop:6 }}>Nothing awaiting review.</div>}
    </>
  );
}

function TasksCommsCard({ wf }) {
  const daily = wf.dailyTasks ?? [];
  const open = daily.filter(t => !t.completed);
  return (
    <>
      <div className="hud-section-label">DAILY TO-DO</div>
      <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:8 }}>
        <span style={{ font:"600 26px 'Chakra Petch'", color:"#29b6ff" }}>{open.length}</span>
        <span className="hud-muted" style={{ font:"10px 'Share Tech Mono'" }}>open tasks</span>
      </div>
      {open.slice(0,4).map(t => (
        <div key={t.id} className="hud-metric-row">
          <span style={{ color:"#cfe0f2" }}>○ {(t.taskText || "").slice(0,30)}</span>
        </div>
      ))}
      {!open.length && <div className="hud-muted" style={{ font:"10px 'Share Tech Mono'" }}>All clear — no open tasks.</div>}
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
      <Row label="With platform data" value={items.filter(i => i.platform).length} />
      <Row label="Analyzed"           value={items.filter(i => i.analyzed).length} />
      <Row label="DM imports"         value={items.filter(i => i.source === "ig_dm").length} />
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
        <Row key={t.id} label={(t.title || t.channel || "Template").slice(0,24)} value={t.platform ?? "—"} />
      ))}
      {!items.length && <div className="hud-muted" style={{ font:"10px 'Share Tech Mono'", marginTop:6 }}>No thumbnails captured yet.</div>}
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
  const reels = wf.reels ?? [];
  return (
    <>
      <div className="hud-section-label">CONTENT FORGE</div>
      <Row label="Reels linked" value={reels.length} />
      <div className="hud-muted" style={{ font:"9px 'Share Tech Mono'", marginTop:8 }}>
        Vet → Elevate → Expound hook pipeline. Open the tab for live spend &amp; opportunities.
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
      const open = daily.filter(t => !t.completed);
      return <>
        <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:10 }}>
          <span style={{ font:"600 28px 'Chakra Petch'", color:"#5fe0a8" }}>{open.length}</span>
          <span className="hud-muted" style={{ font:"10px 'Share Tech Mono'" }}>pending today</span>
        </div>
        {daily.slice(0,5).map(t => (
          <div key={t.id} className="hud-metric-row">
            <span style={{ color: t.completed ? "#5fe0a8" : "#cfe0f2" }}>{t.completed ? "✓" : "○"} {(t.taskText || "").slice(0,28)}</span>
          </div>
        ))}
        {!daily.length && <div className="hud-muted" style={{ font:"10px 'Share Tech Mono'" }}>No tasks yet — expand to add.</div>}
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
   PIPELINE slot widgets — pick a stage column or a person lane
─────────────────────────────────────────────────────── */
const TONE_HEX = { cyan: "#5cc9ff", warn: "#ff9a4d", block: "#c98bff", ok: "#5fe0a8" };

/* Board items = canonical reels + reviewer shadow cards; lane derives from
   owner unless the record carries an explicit lane (mirrors pipeline.jsx). */
function pipeItems(wf) {
  return [...(wf.reels ?? []), ...(wf.reviewLaneCards ?? [])]
    .filter(r => !r.archivedAt)
    .map(r => ({ ...r, lane: r.lane || r.owner }));
}

function PipelineStageWidget({ wf, stageKey }) {
  const label = STAGE_LABEL[stageKey] ?? stageKey;
  const tone  = TONE_HEX[STAGE_TONE[stageKey]] ?? "#5cc9ff";
  const items = pipeItems(wf).filter(r => r.stage === stageKey);
  return (
    <>
      <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:10 }}>
        <span style={{ font:"600 28px 'Chakra Petch'", color: tone }}>{items.length}</span>
        <span className="hud-muted" style={{ font:"10px 'Share Tech Mono'" }}>in {label.toLowerCase()}</span>
      </div>
      {items.slice(0, 9).map(r => (
        <div key={r.id} className="hud-pipeline-item" style={{ borderLeftColor: tone }}>
          {r.title || r.name || "Untitled reel"}
        </div>
      ))}
      {!items.length && <div className="hud-muted" style={{ font:"10px 'Share Tech Mono'", marginTop:6 }}>No reels in this stage.</div>}
    </>
  );
}

function PipelineLaneWidget({ wf, laneId, roster }) {
  const name = laneId === "review"
    ? "Review"
    : (roster?.peopleById?.[laneId]?.name || roster?.peopleById?.[laneId]?.displayName || laneId);
  const items = pipeItems(wf).filter(r => r.lane === laneId);
  return (
    <>
      <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:10 }}>
        <span style={{ font:"600 28px 'Chakra Petch'", color:"#5cc9ff" }}>{items.length}</span>
        <span className="hud-muted" style={{ font:"10px 'Share Tech Mono'" }}>{name}'s reels</span>
      </div>
      {items.slice(0, 9).map(r => (
        <div key={r.id} className="hud-pipeline-item" style={{ borderLeftColor: TONE_HEX[STAGE_TONE[r.stage]] ?? "#5cc9ff" }}>
          {r.title || r.name || "Untitled reel"}
          <span className="hud-muted" style={{ marginLeft:6, fontSize:8 }}>· {STAGE_LABEL[r.stage] ?? r.stage}</span>
        </div>
      ))}
      {!items.length && <div className="hud-muted" style={{ font:"10px 'Share Tech Mono'", marginTop:6 }}>No reels in this lane.</div>}
    </>
  );
}

/* ─────────────────────────────────────────────────────
   CONTENT CATALOG — every pickable content source, grouped.
   ctx = { wf, monitor, roster }. Each render(ctx) returns the card body.
─────────────────────────────────────────────────────── */
/* Lookup of the live Monitor cards by id (for the static-card delegation). */
const MON_BY_ID = Object.fromEntries(MONITOR_CARDS.map(m => [m.id, m]));

/* Static Infra/HUD cards that have a fully-live Monitor twin → delegate to it
   (one source of truth; no drifting duplicate logic). The static body fns for
   these ids become dead code, kept only for git history. */
const STATIC_TO_MON = {
  "server-host":  "mon-server",
  "social-token": "mon-social-tokens",
  "api-budgets":  "mon-budgets",
  "supabase":     "mon-supabase",
  "storage":      "mon-storage",
  "gcp":          "mon-gcp",
  "news-monitor": "mon-news",
  "llm-gates":    "mon-free-llm",
  "scout":        "mon-scout",
  "ai-credits":   "mon-ai-credits",
  "anthropic":    "mon-anthropic",
  "vercel":       "mon-vercel",
  "editor-usage": "mon-editor-usage",
  "gamify-front": "mon-gamify",
};

/* Monitor cards that self-fetch on a timer — only mount them when EXPANDED so
   a wall of them doesn't pile up background fetches (throttle). */
const HEAVY_MON = new Set(["mon-budgets", "mon-editor-usage", "mon-capcut-installs", "mon-frontend-perf"]);

/* A slot is "monitor-backed" (drives the live poll) if it's a mon-* card OR a
   static infra card that delegates to a mon-* twin. */
const MONITOR_BACKED = new Set(Object.keys(STATIC_TO_MON));
function isMonitorBacked(contentId) {
  return !!contentId && (contentId.startsWith("mon-") || MONITOR_BACKED.has(contentId));
}

/* Infra/HUD = the existing compact HUD widgets. Delegated ids render their live
   Monitor twin (bare); the rest keep their own compact body. */
const HUD_CATALOG = [...FRONT_CARDS, ...BACK_CARDS].map(c => {
  const monId = STATIC_TO_MON[c.id];
  const twin  = monId ? MON_BY_ID[monId] : null;
  return {
    id: c.id,
    group: "Infra / HUD",
    label: c.title,
    bare: !!twin,
    title: c.title,
    accentColor: c.accentColor, statusColor: c.statusColor, status: c.status,
    shineColor: c.shineColor, cssClass: c.cssClass,
    detailTitle: c.detailTitle, detailText: c.detailText,
    render: twin
      ? (ctx, expanded) => (HEAVY_MON.has(monId) && !expanded)
          ? <HudHeavyPlaceholder title={c.title} />
          : twin.render(ctx.monitor)
      : (ctx) => c.render(ctx.wf),
  };
});

/* Monitor (live) = the REAL Monitor tab cards (own .card chrome → rendered bare) */
const MONITOR_CATALOG = MONITOR_CARDS.map(m => ({
  id: m.id,
  group: "Monitor (live)",
  label: m.label,
  bare: true,
  title: m.label,
  accentColor: "#5cc9ff",
  detailTitle: m.label + " — live",
  detailText: "Live Monitor card, mirrored from the Monitor tab (polls /api/monitor/status).",
  render: (ctx, expanded) => (HEAVY_MON.has(m.id) && !expanded)
    ? <HudHeavyPlaceholder title={m.label} />
    : m.render(ctx.monitor),
}));

/* Pipeline stages (static 5). Lanes are added per-roster at runtime. */
const PIPELINE_STAGE_CATALOG = STAGES.map(s => ({
  id: `pipe-stage-${s}`,
  group: "Pipeline",
  label: `Stage · ${STAGE_LABEL[s] ?? s}`,
  bare: false,
  title: `PIPELINE · ${(STAGE_LABEL[s] ?? s).toUpperCase()}`,
  accentColor: TONE_HEX[STAGE_TONE[s]] ?? "#5cc9ff",
  statusColor: TONE_HEX[STAGE_TONE[s]] ?? "#5cc9ff",
  shineColor: TONE_HEX[STAGE_TONE[s]] ?? "#5cc9ff",
  detailTitle: `Pipeline — ${STAGE_LABEL[s] ?? s}`,
  detailText: "Reels currently in this pipeline stage, live from the board.",
  render: (ctx) => <PipelineStageWidget wf={ctx.wf} stageKey={s} />,
}));

/* Static catalog parts (lanes resolved by id prefix at render time). */
const STATIC_CATALOG = [...PIPELINE_STAGE_CATALOG, ...MONITOR_CATALOG, ...HUD_CATALOG];
const CATALOG_BY_ID = Object.fromEntries(STATIC_CATALOG.map(e => [e.id, e]));

/* Presentation meta for a slot's content (frame title/accent/chrome). Handles
   the dynamic person-lane ids that aren't in the static catalog. */
function metaFor(contentId, roster) {
  if (!contentId) return { bare: false, title: "", accentColor: "#5cc9ff" };
  if (contentId.startsWith("pipe-lane-")) {
    const laneId = contentId.slice("pipe-lane-".length);
    const name = laneId === "review" ? "Review"
      : (roster?.peopleById?.[laneId]?.name || roster?.peopleById?.[laneId]?.displayName || laneId);
    return {
      bare: false, title: `PIPELINE · ${String(name).toUpperCase()}`,
      accentColor: "#5cc9ff", statusColor: "#5cc9ff", shineColor: "#5cc9ff",
      detailTitle: `Pipeline — ${name}`,
      detailText: "Reels in this person's lane across all stages, live from the board.",
    };
  }
  return CATALOG_BY_ID[contentId] || { bare: false, title: contentId, accentColor: "#5cc9ff" };
}

/* When EXPANDED, these content ids swap their read-only compact body for a
   directly-manipulable / richer panel (Decision 1: edit lives in the modal). */
const EXPANDED_PANEL = {
  "tasks-comms":   (ctx) => <TodoPanel ctx={ctx} />,
  "daily-tasks":   (ctx) => <TodoPanel ctx={ctx} />,
  "reel-dna":      (ctx) => <ReelDnaRecentPanel ctx={ctx} />,
  "thumbnail-dna": (ctx) => <ThumbnailRecentPanel ctx={ctx} />,
  "pipeline":      (ctx) => <PipelineExpanded ctx={ctx} />,
  "review-queue":  (ctx) => <ReviewQueueExpanded ctx={ctx} />,
};

/* Resolve a slot's content to a React node. `expanded` picks the rich/editable
   variant (modal) over the compact read-only summary (3D face). */
function resolveContentNode(contentId, ctx, expanded = false) {
  if (!contentId) return null;
  if (contentId.startsWith("pipe-lane-")) {
    return <PipelineLaneWidget wf={ctx.wf} laneId={contentId.slice("pipe-lane-".length)} roster={ctx.roster} />;
  }
  if (expanded && EXPANDED_PANEL[contentId]) return EXPANDED_PANEL[contentId](ctx);
  const entry = CATALOG_BY_ID[contentId];
  return entry ? entry.render(ctx, expanded) : null;
}

/* ─────────────────────────────────────────────────────
   Layout (slots) — persisted, with one-time migration from the
   hardcoded card arrays + legacy prefs.
─────────────────────────────────────────────────────── */
let _uidSeq = 0;
function nextUid() { return `s_${Date.now().toString(36)}_${(_uidSeq++).toString(36)}`; }

function buildDefaultSlots() {
  const fromArr = (arr, face) => arr.map(c => ({
    uid: nextUid(),
    face,
    contentId: c.id,
    pos: { ...c.pos },
    // two center cards used translateZ(-60) overrides — preserve their depth
    z: c.colTransformOverride ? -60 : undefined,
  }));
  return [...fromArr(FRONT_CARDS, "front"), ...fromArr(BACK_CARDS, "back")];
}

function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.slots)) {
        return { prefs: { ...DEFAULT_PREFS, ...(parsed.prefs || {}) }, slots: parsed.slots };
      }
    }
  } catch (_) {}
  // first run: seed from the hardcoded layout + legacy prefs
  return { prefs: loadPrefs(), slots: buildDefaultSlots() };
}

function saveLayout(prefs, slots) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ version: 2, prefs, slots })); } catch (_) {}
}

/* ─────────────────────────────────────────────────────
   HudCard — renders one card on a face
─────────────────────────────────────────────────────── */
function HudCard({ slot, col, tiltRow, prefs, ctx, meta, node, editMode, selected,
                  onOpen, onPick, onDelete, onMoveStart, onResizeStart }) {
  const baseTransform = cardTransformFor(slot, col, prefs, tiltRow, editMode);
  const empty = !slot.contentId;
  const titleColor = meta.accentColor === "#5fe0a8" ? "#bfe6d6"
    : meta.accentColor === "#5cc9ff" ? "#bcd6f2"
    : meta.accentColor === "#ff9a4d" ? "#ffd4ab"
    : meta.accentColor === "#c98bff" ? "#e0ccff"
    : "#bfe6d6";

  return (
    <div
      className={`hud-card ${meta.cssClass || ""}${meta.bare ? " hud-card--bare" : ""}`
        + `${editMode ? " hud-card--editing" : ""}${empty ? " hud-card--empty" : ""}`
        + `${selected ? " hud-card--selected" : ""}`}
      style={{
        position: "absolute",
        left:   slot.pos.left,
        top:    slot.pos.top,
        width:  slot.pos.width,
        height: slot.pos.height,
        "--card-base-transform": baseTransform,
        "--card-shine": meta.shineColor || meta.accentColor,
        "--card-accent": meta.accentColor,
        zIndex: selected ? 7 : 5,
      }}
      onClick={editMode ? undefined : (() => !empty && onOpen(slot))}
      onPointerDown={editMode ? (e) => onMoveStart(e, slot) : undefined}
    >
      {editMode ? (
        /* Reconfigure mode — show the card as an editable outline: just its
           current label (if any) + the centered ＋/change button. */
        <div className="hud-card-editlabel">{slot.contentId ? meta.title : ""}</div>
      ) : empty ? (
        <div className="hud-card-emptyhint">empty slot</div>
      ) : meta.bare ? (
        <div className="hud-card-bare-body">{node}</div>
      ) : (
        <>
          <div className="hud-card-header">
            <span
              className={`hud-status-dot${meta.statusColor === meta.accentColor ? " hud-status-dot--pulse" : ""}`}
              style={{ background: meta.statusColor || meta.accentColor,
                boxShadow: `0 0 9px ${meta.statusColor || meta.accentColor}` }}
            />
            <span className="hud-card-title" style={{ color: titleColor }}>{meta.title}</span>
            {meta.status && (
              <span className="hud-card-badge"
                style={{ color: meta.accentColor, borderColor: `${meta.accentColor}66` }}>
                {meta.status}
              </span>
            )}
          </div>
          {node}
          {!editMode && <div className="hud-card-expand">⤢ EXPAND</div>}
        </>
      )}

      {editMode && (
        <>
          <button className="hud-edit-pick"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onPick(slot); }}>
            {empty ? "＋ add content" : "⟲ change"}
          </button>
          <button className="hud-edit-del" title="Remove card"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete(slot); }}>×</button>
          <div className="hud-rz hud-rz--r"  onPointerDown={(e) => { e.stopPropagation(); onResizeStart(e, slot, "r"); }} />
          <div className="hud-rz hud-rz--b"  onPointerDown={(e) => { e.stopPropagation(); onResizeStart(e, slot, "b"); }} />
          <div className="hud-rz hud-rz--br" onPointerDown={(e) => { e.stopPropagation(); onResizeStart(e, slot, "br"); }} />
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   HudModal — full-screen card detail
─────────────────────────────────────────────────────── */
function HudModal({ contentId, ctx, onClose, stageRef, onPin }) {
  const meta = useMemo(() => metaFor(contentId, ctx.roster), [contentId, ctx.roster]);
  const node = resolveContentNode(contentId, ctx, true);   // expanded = manipulable variant
  const openTab = openTabFor(contentId);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    if (stageRef?.current) stageRef.current.style.filter = "blur(7px) brightness(.42) saturate(.85)";
    return () => {
      document.removeEventListener("keydown", onKey);
      if (stageRef?.current) stageRef.current.style.filter = "";
    };
  }, [onClose, stageRef]);

  if (!contentId) return null;

  return (
    <div className="hud-modal hud-modal--open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hud-modal-wrap">
        <div className="hud-modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
            <span className="hud-status-dot" style={{ background: meta.accentColor,
              boxShadow:`0 0 9px ${meta.accentColor}`, width:9, height:9 }} />
            <span style={{ font:"600 14px 'Chakra Petch'", letterSpacing:".16em",
              color: meta.accentColor }}>{meta.detailTitle ?? meta.title}</span>
          </div>
          {meta.detailText && (
            <div style={{ font:"10px 'Share Tech Mono'", color:"#7e93ab" }}>
              {meta.detailText}
            </div>
          )}
        </div>
        <div className="hud-modal-body">
          <div style={{ font:"10px 'Share Tech Mono'" }}>
            {node}
          </div>
        </div>
        <div className="hud-modal-actions">
          <HudOpenTabButton target={openTab} />
          {onPin && (
            <button className="hud-pin-btn" title="Keep this open as a side dock"
              onClick={() => { onPin(contentId); onClose(); }}>📌 Pin</button>
          )}
        </div>
        <div className="hud-modal-hint">CLICK OUTSIDE OR PRESS ESC TO CLOSE</div>
        <button className="hud-modal-close" onClick={onClose}>×</button>
      </div>
    </div>
  );
}

/* Pinned side-dock — a single expanded panel kept open while navigating the
   3D wall (Decision E). Renders the same expanded node as the modal. */
function HudDock({ contentId, ctx, onClose }) {
  const meta = useMemo(() => metaFor(contentId, ctx.roster), [contentId, ctx.roster]);
  const node = resolveContentNode(contentId, ctx, true);
  const openTab = openTabFor(contentId);
  if (!contentId) return null;
  return (
    <div className="hud-dock">
      <div className="hud-dock-head">
        <span className="hud-status-dot" style={{ background: meta.accentColor,
          boxShadow:`0 0 9px ${meta.accentColor}`, width:8, height:8 }} />
        <span className="hud-dock-title">{meta.title}</span>
        <button className="hud-dock-close" title="Unpin" onClick={onClose}>×</button>
      </div>
      <div className="hud-dock-body"><div style={{ font:"10px 'Share Tech Mono'" }}>{node}</div></div>
      <div className="hud-dock-actions"><HudOpenTabButton target={openTab} /></div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   HudContentPicker — categorized popover (portaled to body) to assign
   a content source to a slot.
─────────────────────────────────────────────────────── */
function HudContentPicker({ roster, onPick, onClear, onClose }) {
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const laneEntries = [
      ...(roster?.peopleList ?? [])
        .filter(p => p.role !== "reviewer")
        .map(p => ({ id: `pipe-lane-${p.id}`, label: `Lane · ${p.name || p.displayName || p.id}` })),
      { id: "pipe-lane-review", label: "Lane · Review" },
    ];
    return [
      { group: "Pipeline",       items: [...PIPELINE_STAGE_CATALOG.map(e => ({ id: e.id, label: e.label })), ...laneEntries] },
      { group: "Monitor (live)", items: MONITOR_CATALOG.map(e => ({ id: e.id, label: e.label })) },
      // De-dupe (Decision B): delegated infra ids now render their Monitor twin,
      // so the Monitor (live) group already covers them — hide the duplicates.
      { group: "Infra / HUD",    items: HUD_CATALOG.filter(e => !STATIC_TO_MON[e.id]).map(e => ({ id: e.id, label: e.label })) },
    ];
  }, [roster]);

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? groups.map(g => ({ ...g, items: g.items.filter(it => it.label.toLowerCase().includes(needle)) }))
            .filter(g => g.items.length)
    : groups;

  return createPortal(
    <div className="hud-picker-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hud-picker">
        <div className="hud-picker-head">
          <span>ASSIGN CONTENT</span>
          <button className="hud-picker-close" onClick={onClose}>×</button>
        </div>
        <input className="hud-picker-search" autoFocus placeholder="Search…"
          value={q} onChange={e => setQ(e.target.value)} />
        <div className="hud-picker-body">
          <button className="hud-picker-item hud-picker-item--clear" onClick={onClear}>⌫ Leave empty</button>
          {filtered.map(g => (
            <div key={g.group} className="hud-picker-group">
              <div className="hud-picker-group-label">{g.group}</div>
              {g.items.map(it => (
                <button key={it.id} className="hud-picker-item" onClick={() => onPick(it.id)}>
                  {it.label}
                </button>
              ))}
            </div>
          ))}
          {!filtered.length && <div className="hud-picker-empty">No matches.</div>}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ─────────────────────────────────────────────────────
   HudLayoutMenu — spatial customization panel
─────────────────────────────────────────────────────── */
function HudLayoutMenu({ prefs, onUpdate, onReset, onClose,
                         editMode, onToggleEdit, onAddCard, onFlipFace,
                         onSwing, onColAngle, selectedSlot, onUpdateSlot, onDeselect }) {
  const colAngles = prefs.colAngles || DEFAULT_PREFS.colAngles;
  const COL_NAMES = ["Far left", "Inner left", "Center", "Inner right", "Far right"];
  return (
    <div className="hud-layout-menu">
      <button className="hud-menu-close-btn" onClick={onClose}>×</button>
      <h3>⚙ LAYOUT CONTROLS</h3>

      <h4>RECONFIGURE</h4>
      <button className={`hud-edit-toggle${editMode ? " is-on" : ""}`} onClick={onToggleEdit}>
        {editMode ? "✓ Done reconfiguring" : "⤢ Reconfigure cards"}
      </button>
      {editMode && (
        <>
          <button className="hud-addcard-btn" onClick={onAddCard}>＋ Add card → drag to place</button>
          <button className="hud-addcard-btn" onClick={onFlipFace}>⟲ Flip to other face</button>
          <div className="hud-edit-hint">
            Add drops a card in the next free cell + follows your cursor — click to place (Esc cancels).
            Drag a card to move · drag its right/bottom edge to resize · ＋ assigns content · × removes it.
            Snaps to a grid — hold <b>Alt</b> for free placement. Click a card to tweak its own orientation below.
          </div>
        </>
      )}

      {/* Per-card orientation (when a card is selected in edit mode) */}
      {editMode && selectedSlot && (
        <>
          <h4>THIS CARD <span className="hud-h4-note">{selectedSlot.contentId ? metaFor(selectedSlot.contentId, null).title : "(empty)"}</span></h4>
          <div className="hud-slider-row">
            <label>Tilt</label>
            <input type="range" min="-80" max="80" step="1"
              value={selectedSlot.tilt ?? 0}
              onChange={e => onUpdateSlot(selectedSlot.uid, { tilt: Number(e.target.value) })} />
            <span>{selectedSlot.tilt ?? 0}°</span>
          </div>
          <div className="hud-slider-row">
            <label>Turn</label>
            <input type="range" min="-80" max="80" step="1"
              value={selectedSlot.turn ?? 0}
              onChange={e => onUpdateSlot(selectedSlot.uid, { turn: Number(e.target.value) })} />
            <span>{selectedSlot.turn ?? 0}°</span>
          </div>
          <div className="hud-slider-row">
            <label>Depth</label>
            <input type="range" min="-200" max="200" step="5"
              value={selectedSlot.z ?? 0}
              onChange={e => onUpdateSlot(selectedSlot.uid, { z: Number(e.target.value) })} />
            <span>{selectedSlot.z ?? 0}px</span>
          </div>
          <button className="hud-addcard-btn"
            onClick={() => onUpdateSlot(selectedSlot.uid, { tilt: undefined, turn: undefined, z: undefined })}>
            ↺ Reset card to column
          </button>
          <button className="hud-addcard-btn"
            onClick={() => onUpdateSlot(selectedSlot.uid, { face: selectedSlot.face === "front" ? "back" : "front" })}>
            ⇄ Send to other face
          </button>
          <button className="hud-addcard-btn" onClick={onDeselect}>Deselect</button>
        </>
      )}

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
        <label>Tighten</label>
        <input type="range" min="0" max="400" step="10"
          value={prefs.tighten ?? 0}
          onChange={e => onUpdate("tighten", Number(e.target.value))} />
        <span>{prefs.tighten ?? 0}px</span>
      </div>

      <h4>COLUMN ANGLES <span className="hud-h4-note">(Swing sets all)</span></h4>
      <div className="hud-slider-row">
        <label>Swing</label>
        <input type="range" min="0" max="60" step="1"
          value={prefs.swing}
          onChange={e => onSwing(Number(e.target.value))} />
        <span>{prefs.swing}°</span>
      </div>
      {COL_NAMES.map((nm, i) => (
        <div className="hud-slider-row" key={i}>
          <label>{nm}</label>
          <input type="range" min="-70" max="70" step="1"
            value={colAngles[i] ?? 0}
            onChange={e => onColAngle(i, Number(e.target.value))} />
          <span>{colAngles[i] ?? 0}°</span>
        </div>
      ))}

      <h4>CARD TILT <span className="hud-h4-note">(top & bottom cards only)</span></h4>
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

      <h4>GLOBE <span className="hud-h4-note">(drag globe to rotate)</span></h4>
      <div className="hud-slider-row">
        <label>Spin</label>
        <input type="range" min="0" max="3" step="0.1"
          value={prefs.globeSpin ?? 0.6}
          onChange={e => onUpdate("globeSpin", Number(e.target.value))} />
        <span>{(prefs.globeSpin ?? 0.6).toFixed(1)}×</span>
      </div>
      <div className="hud-slider-row">
        <label>Zoom</label>
        <input type="range" min="0.5" max="1.8" step="0.05"
          value={prefs.globeZoom ?? 1}
          onChange={e => onUpdate("globeZoom", Number(e.target.value))} />
        <span>{(prefs.globeZoom ?? 1).toFixed(2)}×</span>
      </div>
      <div className="hud-slider-row">
        <label>Glow dots</label>
        <input type="range" min="0" max="3" step="0.1"
          value={prefs.globeDots ?? 1}
          onChange={e => onUpdate("globeDots", Number(e.target.value))} />
        <span>{(prefs.globeDots ?? 1).toFixed(1)}×</span>
      </div>
      <div className="hud-slider-row">
        <label>Arc speed</label>
        <input type="range" min="0.3" max="3" step="0.1"
          value={prefs.globeArc ?? 1}
          onChange={e => onUpdate("globeArc", Number(e.target.value))} />
        <span>{(prefs.globeArc ?? 1).toFixed(1)}×</span>
      </div>
      <div className="hud-slider-row">
        <label>Atmosphere</label>
        <input type="range" min="0" max="2" step="0.1"
          value={prefs.globeAtmo ?? 1}
          onChange={e => onUpdate("globeAtmo", Number(e.target.value))} />
        <span>{(prefs.globeAtmo ?? 1).toFixed(1)}×</span>
      </div>

      <button className="hud-reset-btn" onClick={onReset}>RESET LAYOUT &amp; DEFAULTS</button>
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
  const roster = useRoster();
  const { person } = useAuth();

  /* ── Refs ─────────────────────────────────────────── */
  const rootRef   = useRef(null);
  const stageRef  = useRef(null);
  const worldRef  = useRef(null);
  const frontRef  = useRef(null);
  const backRef   = useRef(null);
  const billRef   = useRef(null);
  const canvasRef = useRef(null);
  const dragRef   = useRef({ active: false });
  const faceRef   = useRef("front");
  const editRef   = useRef(false);
  const placingRef = useRef(null);   // { uid, ox, oy, startPos } during drag-to-place
  const camSaved  = useRef(null);    // { yaw, pitch } saved on entering edit
  const applyCamRef = useRef(null);  // late-bound handle to applyCam (for flip/flatten)

  /* ── State ────────────────────────────────────────── */
  const initial = useMemo(() => loadLayout(), []);
  const [prefs, setPrefs]   = useState(initial.prefs);
  const [slots, setSlots]   = useState(initial.slots);
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [editMode,   setEditMode]   = useState(false);
  const [activeCard, setActiveCard] = useState(null);   // { contentId } for the modal
  const [picker,     setPicker]     = useState(null);   // slot uid being assigned
  const [selected,   setSelected]   = useState(null);   // slot uid selected for per-card orientation
  const [dockedId,   setDockedId]   = useState(null);   // pinned content id (side dock)
  const [refreshing, setRefreshing] = useState(false);
  const [globeFocus, setGlobeFocus] = useState(false);  // double-click globe → full-screen interactive focus

  /* Esc exits globe-focus mode */
  useEffect(() => {
    if (!globeFocus) return;
    const onKey = (e) => { if (e.key === "Escape") setGlobeFocus(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [globeFocus]);

  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const slotsRef = useRef(slots); slotsRef.current = slots;
  editRef.current = editMode;

  // Poll the live Monitor status when a Monitor-backed card is placed (mon-* OR
  // a static infra card that delegates to a Monitor twin).
  const hasMonitorCard = useMemo(
    () => slots.some(s => isMonitorBacked(s.contentId)), [slots]);
  const monitor = useMonitorStatus({ enabled: hasMonitorCard });

  const ctx = useMemo(() => ({ wf, monitor, roster, person }), [wf, monitor, roster, person]);

  /* Refresh ALL live data on the wall at once (Decision C). */
  const refreshAll = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.allSettled([
        monitor?.refresh?.(),
        wf.actions?.reloadReelDna?.(),
        wf.actions?.reloadThumbnailDna?.(),
      ]);
    } finally { setRefreshing(false); }
  }, [refreshing, monitor, wf.actions]);

  /* ── Cross-device layout sync (Decision D) — hydrate hud_layout_v2 from
     user_preferences (existing table 0070) on a separate effect keyed on the
     auth person id, then debounce-write subsequent edits back. localStorage
     stays the instant/offline fallback. ── */
  const remoteHydratedRef = useRef(false);
  const syncTimerRef = useRef(null);
  useEffect(() => {
    const pid = person?.id;
    if (!pid) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("user_preferences").select("value")
          .eq("person_id", pid).eq("key", LAYOUT_KEY).maybeSingle();
        if (!cancelled && !error && data?.value && Array.isArray(data.value.slots)) {
          const remotePrefs = { ...DEFAULT_PREFS, ...(data.value.prefs || {}) };
          setPrefs(remotePrefs);
          setSlots(data.value.slots);
          saveLayout(remotePrefs, data.value.slots);
        }
      } catch (_) {}
      finally { if (!cancelled) remoteHydratedRef.current = true; }
    })();
    return () => { cancelled = true; };
  }, [person?.id]);

  useEffect(() => {
    const pid = person?.id;
    if (!pid || !remoteHydratedRef.current) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      supabase.from("user_preferences").upsert(
        { person_id: pid, key: LAYOUT_KEY, value: { version: 2, prefs, slots } },
        { onConflict: "person_id,key" }
      ).then(() => {}, () => {});
    }, 1200);
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current); };
  }, [prefs, slots, person?.id]);

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

  /* ── Prefs / layout persistence ───────────────────── */
  const updatePref = useCallback((key, val) => {
    setPrefs(p => {
      const next = { ...p, [key]: val };
      saveLayout(next, slotsRef.current);
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => {
    try { localStorage.removeItem(LAYOUT_KEY); localStorage.removeItem(PREFS_KEY); } catch {}
    const fresh = buildDefaultSlots();
    setPrefs({ ...DEFAULT_PREFS });
    setSlots(fresh);
    saveLayout({ ...DEFAULT_PREFS }, fresh);
  }, []);

  /* ── Slot operations ──────────────────────────────── */
  const persistSlots = useCallback((next) => { saveLayout(prefsRef.current, next); return next; }, []);
  const updateSlotLive = useCallback((uid, pos) => {
    setSlots(prev => prev.map(s => s.uid === uid ? { ...s, pos } : s));
  }, []);
  const updateSlot = useCallback((uid, patch) => {
    setSlots(prev => persistSlots(prev.map(s => s.uid === uid ? { ...s, ...patch } : s)));
  }, [persistSlots]);
  const deleteSlot = useCallback((uid) => {
    setSlots(prev => persistSlots(prev.filter(s => s.uid !== uid)));
    setSelected(sel => sel === uid ? null : sel);
  }, [persistSlots]);
  const assignContent = useCallback((uid, contentId) => {
    setSlots(prev => persistSlots(prev.map(s => s.uid === uid ? { ...s, contentId } : s)));
    setPicker(null);
  }, [persistSlots]);

  /* First free coarse cell (5 cols × 4 rows) on the given face that doesn't
     overlap an existing card — so a new card lands in a meaningful empty spot. */
  const firstFreeCell = useCallback((face) => {
    const COLS = 5, ROWS = 4, M = 16;
    const cw = FACE_W / COLS, ch = 1000 / ROWS;
    const here = slotsRef.current.filter(s => s.face === face);
    const overlaps = (r) => here.some(s =>
      r.left < s.pos.left + s.pos.width && r.left + r.width > s.pos.left &&
      r.top  < s.pos.top  + s.pos.height && r.top  + r.height > s.pos.top);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const rect = { left: snap(c * cw + M), top: snap(r * ch + M),
                     width: snap(cw - 2 * M), height: snap(ch - 2 * M) };
      if (!overlaps(rect)) return rect;
    }
    return { left: 700, top: 380, width: 320, height: 240 };
  }, []);

  /* Add → drop into the next free cell, then follow the cursor (place mode):
     mousemove moves it (snapped), click drops, Esc cancels. */
  const addCard = useCallback(() => {
    const uid = nextUid();
    const face = faceRef.current;
    const pos = firstFreeCell(face);
    setSlots(prev => persistSlots([...prev, { uid, face, contentId: null, pos }]));
    setSelected(uid);
    placingRef.current = { uid, started: false, startPos: pos };

    const scale = curScale() || 1;
    const move = (ev) => {
      const p = placingRef.current; if (!p) return;
      if (!p.started) { p.started = true; p.ox = ev.clientX; p.oy = ev.clientY; }
      const dx = (ev.clientX - p.ox) / scale, dy = (ev.clientY - p.oy) / scale;
      updateSlotLive(uid, {
        ...p.startPos,
        left: snap(p.startPos.left + dx, ev.altKey),
        top:  snap(p.startPos.top  + dy, ev.altKey),
      });
    };
    const drop = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();   // don't let the drop-click start a move on whatever card it lands on
      finishPlace();
      setPicker(uid);   // assign content right after dropping
    };
    const key = (ev) => {
      if (ev.key === "Escape") { finishPlace(); deleteSlot(uid); }
    };
    function finishPlace() {
      placingRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", drop, true);
      window.removeEventListener("keydown", key);
      saveLayout(prefsRef.current, slotsRef.current);
    }
    window.addEventListener("pointermove", move);
    // capture-phase so the drop click isn't swallowed by a card/handle
    window.addEventListener("pointerdown", drop, true);
    window.addEventListener("keydown", key);
  }, [persistSlots, firstFreeCell, updateSlotLive, deleteSlot]);

  /* Flip the flat edit view (and faceRef) to the other side. */
  const flipFace = useCallback(() => {
    cam.current.yaw = faceRef.current === "front" ? 180 : 0;
    cam.current.pitch = 0;
    applyCamRef.current && applyCamRef.current();
  }, []);

  /* Swing convenience — writes colAngles symmetrically. */
  const setSwing = useCallback((val) => {
    setPrefs(p => {
      const next = { ...p, swing: val, colAngles: swingToAngles(val) };
      saveLayout(next, slotsRef.current);
      return next;
    });
  }, []);
  const setColAngle = useCallback((i, val) => {
    setPrefs(p => {
      const colAngles = [...(p.colAngles || DEFAULT_PREFS.colAngles)];
      colAngles[i] = val;
      const next = { ...p, colAngles };
      saveLayout(next, slotsRef.current);
      return next;
    });
  }, []);

  /* ── Move / resize (scale-corrected, grid-snapped) ──── */
  /* Editing is always flat & head-on; the face sits at translateZ(150), so it's
     perspective-magnified by P/(P−150). Fold that in so drags track the cursor. */
  const curScale = () => {
    const base = Math.min(window.innerWidth/1760, window.innerHeight/1000) * 0.82 * (prefsRef.current.zoom || 1);
    const P = prefsRef.current.perspective || 1700;
    return base * (P / (P - 150));
  };

  const beginDrag = useCallback((e, slot, mode, dir) => {
    e.preventDefault();
    if (placingRef.current) return;   // ignore while placing a fresh card
    const scale = curScale() || 1;
    const start = { x: e.clientX, y: e.clientY, pos: { ...slot.pos } };
    let moved = false;
    dragRef.current.active = true;
    const onMove = (ev) => {
      const dx = (ev.clientX - start.x) / scale;
      const dy = (ev.clientY - start.y) / scale;
      if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 3) moved = true;
      const free = ev.altKey;
      if (mode === "move") {
        updateSlotLive(slot.uid, {
          ...start.pos,
          left: snap(start.pos.left + dx, free),
          top:  snap(start.pos.top  + dy, free),
        });
      } else {
        updateSlotLive(slot.uid, {
          ...start.pos,
          width:  (dir || "").includes("r") ? Math.max(140, snap(start.pos.width  + dx, free)) : start.pos.width,
          height: (dir || "").includes("b") ? Math.max(110, snap(start.pos.height + dy, free)) : start.pos.height,
        });
      }
    };
    const onUp = () => {
      dragRef.current.active = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!moved) setSelected(slot.uid);   // a click (no drag) selects for per-card orientation
      saveLayout(prefsRef.current, slotsRef.current);   // persist final geometry
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [updateSlotLive]);
  const onMoveStart   = useCallback((e, slot) => beginDrag(e, slot, "move"),  [beginDrag]);
  const onResizeStart = useCallback((e, slot, dir) => beginDrag(e, slot, "resize", dir), [beginDrag]);

  /* ── Per-face slots with derived column + tilt-row ──── */
  const faceSlots = useMemo(() => {
    const annotate = (arr) => {
      const withCol = arr.map(s => ({ slot: s, col: colOf(s.pos) }));
      const byCol = {};
      withCol.forEach(({ slot, col }) => { (byCol[col] = byCol[col] || []).push(slot); });
      const rowOf = {};
      Object.values(byCol).forEach(list => {
        if (list.length === 1) { rowOf[list[0].uid] = "top"; return; }
        let top = list[0], bot = list[0];
        list.forEach(s => {
          if (s.pos.top < top.pos.top) top = s;
          if ((s.pos.top + s.pos.height) > (bot.pos.top + bot.pos.height)) bot = s;
        });
        list.forEach(s => {
          rowOf[s.uid] = s.uid === top.uid ? "top" : s.uid === bot.uid ? "bottom" : null;
        });
      });
      return withCol.map(({ slot, col }) => ({ slot, col, tiltRow: rowOf[slot.uid] ?? null }));
    };
    return {
      front: annotate(slots.filter(s => s.face === "front")),
      back:  annotate(slots.filter(s => s.face === "back")),
    };
  }, [slots]);

  /* ── Camera drag-to-rotate ────────────────────────── */
  const cam = useRef({ yaw:0, pitch:0, orb:false, oX:0, oY:0, oVel:0, coastRaf:null });

  const applyCam = useCallback(() => {
    const { yaw, pitch } = cam.current;
    if (worldRef.current) worldRef.current.style.transform = `rotateY(${yaw}deg) rotateX(${pitch}deg)`;
    if (billRef.current)  billRef.current.style.transform  = `rotateX(${-pitch}deg) rotateY(${-yaw}deg)`;
    const cf = Math.cos(yaw * Math.PI / 180);
    const cl = v => Math.max(0, Math.min(1, v));
    const fO = cl((cf + 0.12) / 0.4), bO = cl((-cf + 0.12) / 0.4);
    faceRef.current = fO >= bO ? "front" : "back";
    if (frontRef.current) {
      frontRef.current.style.opacity       = fO;
      frontRef.current.style.pointerEvents = fO > 0.5 ? "auto" : "none";
    }
    if (backRef.current) {
      backRef.current.style.opacity       = bO;
      backRef.current.style.pointerEvents = bO > 0.5 ? "auto" : "none";
    }
  }, []);
  applyCamRef.current = applyCam;

  /* Flatten the camera head-on when entering edit; restore on exit. */
  useEffect(() => {
    if (editMode) {
      camSaved.current = { yaw: cam.current.yaw, pitch: cam.current.pitch };
      cam.current.yaw = faceRef.current === "back" ? 180 : 0;
      cam.current.pitch = 0;
      cam.current.oVel = 0;
    } else if (camSaved.current) {
      cam.current.yaw = camSaved.current.yaw;
      cam.current.pitch = camSaved.current.pitch;
      camSaved.current = null;
      setSelected(null);
    }
    applyCam();
  }, [editMode, applyCam]);

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
      if (editRef.current || placingRef.current) return;   // orbit locked while editing/placing
      if (e.target.closest(".hud-card") || e.target.tagName === "CANVAS") return;
      if (dragRef.current.active) return;
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
      // drag DOWN → look down (cards face down). Inverted from the original.
      cam.current.pitch  = Math.max(-34, Math.min(36, cam.current.pitch + dy * 0.18));
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
  }, [applyCam, fitStage, updatePref]);

  return (
    <div ref={rootRef} className={`hud-root${editMode ? " hud-editing" : ""}`} id="hud-root">
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

          {/* Globe (billboard — counter-rotates with world to stay flat).
              Double-click → pops into full-screen interactive focus mode. */}
          <div ref={billRef} className="hud-bill">
            <div className="hud-globe-glow" />
            <div ref={canvasRef} className="hud-globe-canvas"
              title="Double-click to interact"
              onDoubleClick={() => { if (!editMode) setGlobeFocus(true); }}>
              {!globeFocus && <HudGlobe3D prefsRef={prefsRef} interactive={false} />}
              <div className="hud-globe-hint">⤢ double-click to interact</div>
            </div>
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
          <div ref={frontRef} className="hud-face hud-face--front"
            onClick={(e) => { if (editMode && e.target === e.currentTarget) setSelected(null); }}>
            {faceSlots.front.map(({ slot, col, tiltRow }) => (
              (!editMode && !slot.contentId) ? null :
              <HudCard key={slot.uid}
                slot={slot} col={col} tiltRow={tiltRow} prefs={prefs}
                ctx={ctx} meta={metaFor(slot.contentId, roster)}
                node={slot.contentId ? resolveContentNode(slot.contentId, ctx) : null}
                editMode={editMode} selected={selected === slot.uid}
                onOpen={(s) => setActiveCard({ contentId: s.contentId })}
                onPick={(s) => setPicker(s.uid)}
                onDelete={(s) => deleteSlot(s.uid)}
                onMoveStart={onMoveStart} onResizeStart={onResizeStart} />
            ))}
          </div>

          {/* ── BACK FACE ── */}
          <div ref={backRef} className="hud-face hud-face--back"
            onClick={(e) => { if (editMode && e.target === e.currentTarget) setSelected(null); }}>
            {faceSlots.back.map(({ slot, col, tiltRow }) => (
              (!editMode && !slot.contentId) ? null :
              <HudCard key={slot.uid}
                slot={slot} col={col} tiltRow={tiltRow} prefs={prefs}
                ctx={ctx} meta={metaFor(slot.contentId, roster)}
                node={slot.contentId ? resolveContentNode(slot.contentId, ctx) : null}
                editMode={editMode} selected={selected === slot.uid}
                onOpen={(s) => setActiveCard({ contentId: s.contentId })}
                onPick={(s) => setPicker(s.uid)}
                onDelete={(s) => deleteSlot(s.uid)}
                onMoveStart={onMoveStart} onResizeStart={onResizeStart} />
            ))}
          </div>
        </div>
      </div>

      {/* Old 2D-canvas globe retired — now rendered inline via <HudGlobe3D> above */}

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

      {/* 🌐 Globe focus — reliable entry (double-clicking the globe also works) */}
      {!editMode && !globeFocus && (
        <button className="hud-globe-btn" onClick={() => setGlobeFocus(true)}>
          🌐 GLOBE
        </button>
      )}

      {/* ⟳ Refresh-all + freshness chip (Decision C) */}
      <div className="hud-fresh">
        {hasMonitorCard && (
          <span className="hud-fresh-chip" title="Live Monitor data age">
            {monitor.loading ? "syncing…"
              : monitor.lastFetch ? `live · ${relAgo(monitor.lastFetch)}`
              : monitor.error ? "live · error" : "live"}
          </span>
        )}
        <button className="hud-fresh-btn" onClick={refreshAll} disabled={refreshing}
          title="Refresh all live data">
          {refreshing ? "⟳ …" : "⟳ REFRESH"}
        </button>
      </div>

      {/* Layout menu panel */}
      {menuOpen && (
        <HudLayoutMenu
          prefs={prefs}
          onUpdate={updatePref}
          onReset={resetLayout}
          onClose={() => setMenuOpen(false)}
          editMode={editMode}
          onToggleEdit={() => setEditMode(v => !v)}
          onAddCard={addCard}
          onFlipFace={flipFace}
          onSwing={setSwing}
          onColAngle={setColAngle}
          selectedSlot={selected ? slotsRef.current.find(s => s.uid === selected) : null}
          onUpdateSlot={updateSlot}
          onDeselect={() => setSelected(null)}
        />
      )}

      {/* Content picker (edit mode) */}
      {picker && (
        <HudContentPicker
          roster={roster}
          onPick={(cid) => assignContent(picker, cid)}
          onClear={() => assignContent(picker, null)}
          onClose={() => setPicker(null)}
        />
      )}

      {/* Modal (normal mode only) */}
      {activeCard && !editMode && (
        <HudModal
          contentId={activeCard.contentId}
          ctx={ctx}
          stageRef={stageRef}
          onClose={() => setActiveCard(null)}
          onPin={(cid) => setDockedId(cid)}
        />
      )}

      {/* Pinned side dock (Decision E) — survives navigation around the wall */}
      {dockedId && !editMode && (
        <HudDock contentId={dockedId} ctx={ctx} onClose={() => setDockedId(null)} />
      )}

      {/* ── Globe FOCUS overlay ──────────────────────────────
          Full-screen, flat (non-3D) stacking context where the WebGL globe
          is fully interactive — drag to rotate, live-customize via the panel.
          Cards fade into the dimmed backdrop behind. */}
      {globeFocus && (
        <div className="hud-globe-focus">
          <div className="hud-globe-focus-backdrop" onClick={() => setGlobeFocus(false)} />
          <div className="hud-globe-focus-stage" onDoubleClick={() => setGlobeFocus(false)}>
            <HudGlobe3D prefsRef={prefsRef} />
          </div>
          <button className="hud-globe-focus-close" onClick={() => setGlobeFocus(false)}>✕ EXIT</button>
          <div className="hud-globe-focus-hint">drag to rotate · double-click / Esc to exit</div>
          <HudGlobeControls prefs={prefs} onUpdate={updatePref} />
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   HudGlobeControls — compact live effect panel shown in
   the globe-focus overlay (mirrors the LayoutMenu GLOBE
   sliders, same prefs / updatePref).
─────────────────────────────────────────────────────── */
function HudGlobeControls({ prefs, onUpdate }) {
  const [open, setOpen] = useState(true);
  const rows = [
    ["Spin",       "globeSpin", 0,   3,   0.1, 0.6, (v) => `${v.toFixed(1)}×`],
    ["Zoom",       "globeZoom", 0.5, 1.8, 0.05, 1,  (v) => `${v.toFixed(2)}×`],
    ["Glow dots",  "globeDots", 0,   3,   0.1, 1,   (v) => `${v.toFixed(1)}×`],
    ["Arc speed",  "globeArc",  0.3, 3,   0.1, 1,   (v) => `${v.toFixed(1)}×`],
    ["Atmosphere", "globeAtmo", 0,   2,   0.1, 1,   (v) => `${v.toFixed(1)}×`],
  ];
  return (
    <div className={`hud-globe-focus-panel${open ? "" : " hud-globe-focus-panel--collapsed"}`}
      onDoubleClick={(e) => e.stopPropagation()}>
      <button className="hud-globe-focus-panel-toggle" onClick={() => setOpen(o => !o)}
        title={open ? "Collapse" : "Expand"}>
        <span>GLOBE EFFECTS</span>
        <span className="hud-globe-focus-panel-chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && rows.map(([label, key, min, max, step, dflt, fmt]) => {
        const val = prefs[key] ?? dflt;
        return (
          <div className="hud-slider-row" key={key}>
            <label>{label}</label>
            <input type="range" min={min} max={max} step={step}
              value={val}
              onChange={(e) => onUpdate(key, Number(e.target.value))} />
            <span>{fmt(val)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default HudSpace;
