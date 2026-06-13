/* =========================================================
   My Work — role-aware "what needs me now" dashboard.

   Three render paths today:
     · skilled  → 3-column DnD lanes (Not started / In progress
                  / Completed) showing reels owned by Judy. Each
                  card carries: clip count, logline preview,
                  current-state link, due-date+time picker, and
                  a "for revision" badge with the reviewer's note
                  if the reel was just sent back.
     · variant  → execution queue for Jay (unchanged for now).
     · owner / reviewer → minimal review queue. One row per
                  reel currently in `review` stage with an
                  Accept / Send-back-with-note action. Used by
                  both Paul and Leroy.
   ========================================================= */

import React, { useState, useMemo, useEffect } from "react";
import { DPill, Pill } from "../components/components.jsx";
import { useWorkflow } from "../store/store.jsx";
import { useAuth } from "../auth.jsx";
import { usePermissions } from "../lib/permissions.jsx";
import { useNow, formatDue, formatDuration } from "../lib/time.jsx";
import { ROLES } from "../lib/shared-data.jsx";
import { useRoster } from "../lib/roster.jsx";
import JSZip from "jszip";
import { supabase } from "../lib/supabase-client.js";
import {
  PLATFORMS,
  getConnections,
  fetchConnections,
  getInboxSummary,
} from "../lib/social-client.js";

/* Build the revision history array, folding the older single-field
   shape into one entry so display code only handles one schema. */
function getRevisionHistory(detail) {
  const arr = Array.isArray(detail?.revisionHistory) ? detail.revisionHistory : [];
  if (arr.length) return arr;
  if (detail?.revisionNote) {
    return [{
      action: "sent_back",
      ts:     detail.revisionAt || null,
      by:     detail.revisionBy || null,
      note:   detail.revisionNote,
    }];
  }
  return [];
}

function formatHistoryTs(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const datePart = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return datePart + " · " + hh + ":" + mm;
}

/* Action-button gating per step 5:
   - Owner role = god-mode (always allowed).
   - Anyone else: only the matching role's actions are exposed. */
function useCanAct(requiredRole) {
  const { person } = useAuth();
  if (!person) return false;
  if (person.role === "owner") return true;
  if (Array.isArray(requiredRole)) return requiredRole.includes(person.role);
  return person.role === requiredRole;
}

/* Resolve whose reels this dashboard shows.
   - When personId is provided (owner switched to a specific person), use it.
   - Otherwise fall back to the authenticated person or the canonical slot for the role. */
function whoseWork(role, person, personId) {
  if (personId) return personId;
  if (person && person.role === role) return person.id;
  return ROLES[role]?.person || null;
}

async function downloadAgentFiles(personId) {
  const zip = new JSZip();
  const folder = zip.folder("capcut-tracker");

  const exeRes = await fetch("/capcut-agent/capcut_agent.exe");
  const exeBytes = await exeRes.arrayBuffer();
  folder.file("capcut_agent.exe", exeBytes);

  const cfg = { WORKER: personId, POLL_SECONDS: 15 };
  folder.file("capcut_config.json", JSON.stringify(cfg, null, 2));

  const bat = [
    "@echo off",
    "REM Adds capcut_agent.exe (in this folder) to Windows Startup so it",
    "REM runs automatically at every logon. Run once per machine.",
    "setlocal",
    `set WORKER=${personId}`,
    "set EXE=%~dp0capcut_agent.exe",
    "set STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup",
    "set LNK=%STARTUP%\\CapCutActivityAgent.lnk",
    "",
    "if not exist \"%EXE%\" (",
    "  echo ERROR: capcut_agent.exe not found in this folder.",
    "  pause & exit /b 1",
    ")",
    "",
    "powershell -NoProfile -Command \"$sh=New-Object -ComObject WScript.Shell;$lnk=$sh.CreateShortcut('%LNK%');$lnk.TargetPath='%EXE%';$lnk.WorkingDirectory='%~dp0';$lnk.WindowStyle=7;$lnk.Save()\"",
    "",
    "echo Startup shortcut created. Starting agent now...",
    "start \"\" \"%EXE%\"",
    "echo Done. Agent is running and will auto-start at every logon.",
    "pause",
  ].join("\r\n");
  folder.file("capcut_install.bat", bat);

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `capcut-tracker-${personId}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

function MyWork({ role, personId, onOpen, onNavigate }) {
  const { person } = useAuth();
  const me = whoseWork(role, person, personId);
  if (role === "owner") return <OwnerDashboard me={me} onOpen={onOpen} onNavigate={onNavigate} />;
  if (role === "reviewer") return <ReviewQueueWork me={me} onOpen={onOpen} />;
  return <SkilledWork me={me} onOpen={onOpen} role={role} />;
}

/* ─────────────────────────────────────────────────────── */
/* Tasks & Comms — daily task list per person             */
/* ─────────────────────────────────────────────────────── */

function DailyTasksSection({ personId, viewerPersonId, isOwner }) {
  const { dailyTasks, createDailyTask, completeDailyTask, deleteDailyTask } = useWorkflow();
  const [newTaskText, setNewTaskText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  // Show today's tasks + any incomplete from previous days
  const myTasks = dailyTasks
    .filter(t => t.assignedTo === personId)
    .filter(t => !t.completed || t.taskDate === today) // show incomplete always, completed only today
    .sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1; // incomplete first
      return (a.created_at || "").localeCompare(b.created_at || "");
    });

  const handleAdd = async () => {
    const text = newTaskText.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    await createDailyTask({
      assignedTo: personId,
      createdBy: viewerPersonId,
      taskText: text,
      taskDate: today,
    });
    setNewTaskText("");
    setSubmitting(false);
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10, borderBottom: "1px solid var(--line-hard)", paddingBottom: 8,
      }}>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Tasks &amp; Comms
        </span>
        <span style={{ fontSize: 11, color: "var(--fg-dim)", fontFamily: "var(--f-mono)" }}>
          {myTasks.filter(t => !t.completed).length} open
        </span>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
        {myTasks.length === 0 && (
          <li style={{ color: "var(--fg-dim)", fontSize: 12, fontFamily: "var(--f-mono)", padding: "6px 0" }}>
            No tasks for today.
          </li>
        )}
        {myTasks.map(task => (
          <li key={task.id} style={{
            display: "flex", alignItems: "flex-start", gap: 10, padding: "5px 0",
            borderBottom: "1px solid var(--line-soft, var(--line-hard))",
          }}>
            <input
              type="checkbox"
              checked={!!task.completed}
              onChange={e => completeDailyTask(task.id, e.target.checked)}
              style={{ marginTop: 2, cursor: "pointer", accentColor: "var(--c-ok, #22c55e)", flexShrink: 0 }}
            />
            <span style={{
              flex: 1,
              fontSize: 13,
              color: task.completed ? "var(--fg-dim)" : "var(--fg)",
              textDecoration: task.completed ? "line-through" : "none",
              fontFamily: "var(--f-sans, var(--f-mono))",
            }}>
              {task.taskText}
            </span>
            {isOwner && (
              <button
                onClick={() => deleteDailyTask(task.id)}
                style={{ background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }}
                title="Delete task"
              >×</button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={newTaskText}
            onChange={e => setNewTaskText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
            placeholder="Add a task for today…"
            style={{
              flex: 1,
              background: "var(--bg-2)",
              border: "1px dashed var(--line-hard)",
              borderRadius: 4,
              color: "var(--fg)",
              fontFamily: "var(--f-mono)",
              fontSize: 12,
              padding: "7px 10px",
            }}
          />
          <button
            className="btn-primary"
            onClick={handleAdd}
            disabled={!newTaskText.trim() || submitting}
            style={{ flexShrink: 0 }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
/* Requests — open tasks from the global Create-task FAB   */
/* ─────────────────────────────────────────────────────── */

/* Tasks created via the FAB land in the `tasks` table assigned to a
   person; this is the surface where the assignee actually sees them.
   Hidden entirely when there's nothing open. "Done" keeps the row
   (state → done); the owner can also delete outright. */
function OpenTasksSection({ personId, viewerPersonId, isOwner, onOpen }) {
  const { tasks, reels, actions } = useWorkflow();
  const { peopleById } = useRoster();
  const open = tasks.filter(t => t.to === personId && t.state !== "done");
  if (!open.length) return null;
  const canAct = isOwner || viewerPersonId === personId;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10, borderBottom: "1px solid var(--line-hard)", paddingBottom: 8,
      }}>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Requests
        </span>
        <span style={{ fontSize: 11, color: "var(--fg-dim)", fontFamily: "var(--f-mono)" }}>
          {open.length} open
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {open.map(t => {
          const linkedReel = t.reel ? reels.find(r => r.id === t.reel) : null;
          return (
            <div key={t.id} style={{
              border: "1px dashed var(--line-hard)",
              borderRadius: 6,
              padding: "10px 12px",
              background: "var(--bg-1)",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              flexWrap: "wrap",
            }}>
              <span style={{
                fontSize: 10, fontFamily: "var(--f-mono)",
                color: "var(--c-cyan)",
                border: "1px dashed rgba(107,214,224,0.3)",
                background: "rgba(107,214,224,0.08)",
                borderRadius: 10, padding: "1px 8px",
                whiteSpace: "nowrap", marginTop: 2,
              }}>{t.type || "Task"}</span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12.5, color: "var(--fg)", lineHeight: 1.45 }}>
                  {t.instruction || "(no instruction)"}
                </div>
                <div className="mono dim" style={{ fontSize: 10.5, marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span>from {peopleById[t.from]?.short || t.from || "?"}</span>
                  {t.due && <span>due {t.due}</span>}
                  {linkedReel && (
                    <a href="#" style={{ color: "var(--c-cyan)", textDecoration: "none" }}
                       onClick={e => { e.preventDefault(); onOpen && onOpen(linkedReel); }}>
                      {linkedReel.id} · {linkedReel.title}
                    </a>
                  )}
                  {t.ref && (
                    <a href={t.ref} target="_blank" rel="noopener noreferrer"
                       style={{ color: "var(--c-cyan)", textDecoration: "none" }}>
                      ↗ reference
                    </a>
                  )}
                </div>
              </div>
              {canAct && (
                <DPill onClick={() => actions.updateTask(t.id, { state: "done" })}>✓ Done</DPill>
              )}
              {isOwner && (
                <button
                  onClick={() => actions.deleteTask(t.id)}
                  title="Delete this request"
                  style={{ background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer", fontSize: 14, padding: "2px 2px", lineHeight: 1 }}
                >×</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
/* Skilled editor dashboard — 3-column DnD                */
/* ─────────────────────────────────────────────────────── */

const SKILLED_COLS = [
  { key: "not_started", title: "Not started" },
  { key: "in_progress", title: "In progress" },
  { key: "review",      title: "Review"      },
  { key: "completed",   title: "Completed"   },
];

function SkilledWork({ me, onOpen, role }) {
  const { reels, actions, attachedFootage } = useWorkflow();
  const { person } = useAuth();
  const { peopleById } = useRoster();
  const { can } = usePermissions();
  const mine = reels.filter(r => r.owner === me && !r.archivedAt);
  const whoLabel = peopleById[me]?.short || "Editor";
  const roleLabel = ROLES[role]?.short?.toLowerCase() || role || "editor";
  const isOwner = person?.role === "owner";
  const viewerPersonId = person?.id || "paul";

  const [dragId, setDragId] = useState(null);
  const [dropCol, setDropCol] = useState(null);
  const [blockedCol, setBlockedCol] = useState(null); // column flashing red after a blocked drop

  const handleDrop = (targetStage) => {
    if (!dragId) return;
    /* Same gate the Pipeline board enforces: editors can't drop into
       Completed themselves — that move is the reviewer's Accept. */
    if (targetStage === "completed" && !can("moveToCompleted")) {
      setBlockedCol("completed");
      setTimeout(() => setBlockedCol(null), 700);
      setDragId(null);
      setDropCol(null);
      return;
    }
    actions.moveStage(dragId, { stage: targetStage });
    setDragId(null);
    setDropCol(null);
  };

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>My work — {whoLabel} · {roleLabel}</h1>
          <div className="sub">
            Drag a card between columns to update its status.
          </div>
        </div>
        <div className="actions">
          <DPill onClick={() => downloadAgentFiles(me)} title="Download the CapCut tracker config for this person">
            ↓ CapCut tracker setup
          </DPill>
        </div>
      </div>

      <div className="mywork-grid">
        {SKILLED_COLS.map(col => {
          const rows = mine.filter(r => r.stage === col.key);
          const isTarget = dropCol === col.key;
          const isBlocked = blockedCol === col.key;
          const dropAllowed = !(col.key === "completed" && !can("moveToCompleted"));
          return (
            <div className="mw-col" key={col.key}
                 onDragOver={e => {
                   if (!dragId) return;
                   /* Don't highlight Completed as a valid target when blocked. */
                   if (!dropAllowed) return;
                   e.preventDefault();
                   if (dropCol !== col.key) setDropCol(col.key);
                 }}
                 onDragLeave={() => { if (dropCol === col.key) setDropCol(null); }}
                 onDrop={e => { e.preventDefault(); handleDrop(col.key); }}
                 style={{
                   outline: isTarget ? "2px dashed var(--c-cyan)" : "",
                   outlineOffset: isTarget ? "-4px" : "",
                   transition: "outline 0.1s",
                 }}>
              <div className="mw-col-head"
                   style={isBlocked ? {
                     outline: "2px solid var(--c-red)",
                     background: "var(--c-red-soft)",
                     transition: "background 0.1s, outline 0.1s",
                   } : undefined}>
                <div className="mw-h" style={isBlocked ? { color: "var(--c-red)" } : undefined}>
                  {isBlocked ? "✕ " : ""}{col.title}
                </div>
                <span className="count-tag">{isBlocked ? "not allowed" : rows.length}</span>
              </div>
              <div className="mw-list">
                {rows.map(r => (
                  <div key={r.id}
                       draggable
                       onDragStart={e => { setDragId(r.id); e.dataTransfer.effectAllowed = "move"; }}
                       onDragEnd={() => { setDragId(null); setDropCol(null); }}
                       style={{ opacity: dragId === r.id ? 0.4 : 1 }}>
                    <WorkCard
                      reel={r}
                      onOpen={onOpen}
                      clipCount={attachedFootage.filter(f => f.reel_id === r.id).length}
                      onDueChange={(iso) => actions.updateReel(r.id, { dueAt: iso })}
                    />
                  </div>
                ))}
                {rows.length === 0 && <EmptyLane label="Drop a reel here." />}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: "0 22px 22px" }}>
        <OpenTasksSection
          personId={me}
          viewerPersonId={viewerPersonId}
          isOwner={isOwner}
          onOpen={onOpen}
        />
        <DailyTasksSection
          personId={me}
          viewerPersonId={viewerPersonId}
          isOwner={isOwner}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
/* Variant editor dashboard — unchanged                    */
/* ─────────────────────────────────────────────────────── */

function VariantWork({ me, onOpen }) {
  const { reels, tasks } = useWorkflow();
  const { person } = useAuth();
  const { peopleById } = useRoster();
  const mine = reels.filter(r => r.owner === me && !r.archivedAt);
  const myTasks = tasks.filter(t => t.to === me);
  const now = useNow();
  const whoLabel = peopleById[me]?.short || "Variant editor";
  const isOwner = person?.role === "owner";
  const viewerPersonId = person?.id || "paul";

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>My work — {whoLabel} · variant editor</h1>
          <div className="sub">Reels assigned to you.</div>
        </div>
        <div className="actions">
          <DPill onClick={() => downloadAgentFiles(me)} title="Download the CapCut tracker config for this person">
            ↓ CapCut tracker setup
          </DPill>
        </div>
      </div>

      <div className="variant-queue" style={{ padding: "16px 22px" }}>
        {mine.length === 0 && (
          <div className="dim mono" style={{ padding: 12 }}>No reels assigned to you yet.</div>
        )}
        {mine.map(r => (
          <div key={r.id} className={"vslot " + (r.state || "ok")}
               onClick={() => onOpen({ id: r.id, title: r.title })}
               style={{ cursor: "pointer" }}>
            <div className="vslot-head">
              <div>
                <div className="mono dim">{r.id}</div>
                <div className="serif-i" style={{ fontSize: 18, color: "#eef3fb", marginTop: 2 }}>{r.title}</div>
              </div>
              <Pill tone={r.state === "block" ? "block" : r.state === "warn" ? "warn" : "ok"}>
                {r.blocker ? "blocked" : "active"}
              </Pill>
            </div>
            {r.blocker && (
              <div className="vslot-blocker">
                <span style={{ color: "var(--c-red)" }}>●</span> {r.blocker}
              </div>
            )}
            <div className="vslot-block">
              <div className="h-sub">Deadline</div>
              <div className="mono" style={{ color: "var(--c-amber)" }}>{formatDue(r, now) || "—"}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: "0 22px 22px" }}>
        <DailyTasksSection
          personId={me}
          viewerPersonId={viewerPersonId}
          isOwner={isOwner}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
/* Owner command-center dashboard                          */
/* ─────────────────────────────────────────────────────── */

/* Small utility to format large numbers (same pattern as monitor.jsx). */
function fmtNum(n) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function SocialReachCard({ connections, onNavigate }) {
  const totalFollowers = connections.reduce((s, c) => s + (c.followers || 0), 0);
  const hasError = connections.some(c => c.status === "error");
  const tone = hasError ? "warn" : "";
  return (
    <div className={`ow-card${tone ? " is-" + tone : ""}`}
         tabIndex={0} role="button"
         onClick={() => onNavigate?.("analytics")}
         onKeyDown={e => e.key === "Enter" && onNavigate?.("analytics")}>
      <div className="ow-card-label">Social Reach</div>
      <div className={`ow-card-big${hasError ? " is-warn" : ""}`}>{fmtNum(totalFollowers)}</div>
      <div className="ow-card-sub">combined followers</div>
      <div className="ow-card-platforms">
        {PLATFORMS.map(p => {
          const conn = connections.find(c => c.platform === p.key);
          const active = conn?.connected;
          return (
            <span key={p.key} className="ow-plat-glyph"
                  style={{ color: active ? p.color : "var(--fg-faint)" }}
                  title={p.label + (conn?.followers ? ` · ${fmtNum(conn.followers)}` : "")}>
              {p.glyph}
            </span>
          );
        })}
      </div>
      <div className="ow-card-link">view analytics →</div>
    </div>
  );
}

function PlatformInboxCard({ summary, onNavigate }) {
  const unreplied = summary?.unreplied ?? 0;
  const dms = summary?.dms ?? 0;
  const comments = summary?.comments ?? 0;
  const tone = unreplied > 0 ? "warn" : "";
  return (
    <div className={`ow-card${tone ? " is-" + tone : ""}`}
         tabIndex={0} role="button"
         onClick={() => onNavigate?.("inbox")}
         onKeyDown={e => e.key === "Enter" && onNavigate?.("inbox")}>
      <div className="ow-card-label">Platform Inbox</div>
      <div className={`ow-card-big${unreplied > 0 ? " is-warn" : ""}`}>{unreplied}</div>
      <div className="ow-card-sub">unreplied</div>
      <div className="ow-card-sub" style={{ fontSize: 11, marginTop: 2 }}>
        {dms} DM{dms !== 1 ? "s" : ""} · {comments} comment{comments !== 1 ? "s" : ""}
      </div>
      <div className="ow-card-link">view inbox →</div>
    </div>
  );
}

function InfraHealthCard({ onNavigate }) {
  const data = useMemo(() => {
    try {
      const raw = localStorage.getItem("mon.cache.v1");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.payload ?? parsed ?? null;
    } catch { return null; }
  }, []);

  if (!data) {
    return (
      <div className="ow-card" tabIndex={0} role="button"
           onClick={() => onNavigate?.("monitor")}
           onKeyDown={e => e.key === "Enter" && onNavigate?.("monitor")}>
        <div className="ow-card-label">Infrastructure</div>
        <div className="ow-card-big" style={{ fontSize: 14, color: "var(--fg-dim)" }}>No data yet</div>
        <div className="ow-card-sub">visit Monitor first to cache stats</div>
        <div className="ow-card-link">view monitor →</div>
      </div>
    );
  }

  const hz = data.hetzner || {};
  const os = data.os || {};
  const sb = data.supabase || {};
  const memPct  = os.memPct  ?? 0;
  const diskPct = os.diskPct ?? 0;
  const rowPct  = sb.rowPct  ?? 0;
  const bwPct   = hz.bwPct   ?? 0;
  const serverUp = hz.status === "running";

  const worstPct = Math.max(memPct, diskPct, rowPct, bwPct);
  const tone = worstPct >= 95 ? "red" : worstPct >= 80 ? "warn" : "";

  const dot = tone === "red" ? "🔴" : tone === "warn" ? "🟡" : "🟢";
  const label = tone === "red" ? "critical" : tone === "warn" ? "warning" : "all systems ok";

  return (
    <div className={`ow-card${tone ? " is-" + tone : ""}`}
         tabIndex={0} role="button"
         onClick={() => onNavigate?.("monitor")}
         onKeyDown={e => e.key === "Enter" && onNavigate?.("monitor")}>
      <div className="ow-card-label">Infrastructure</div>
      <div className="ow-card-health-row">
        <span>{dot}</span>
        <span style={{ color: tone === "red" ? "var(--c-red)" : tone === "warn" ? "var(--c-amber)" : "var(--c-ok)" }}>
          {label}
        </span>
      </div>
      <div className="ow-card-sub" style={{ marginTop: 4 }}>
        Hetzner: {serverUp ? "running" : <span style={{ color: "var(--c-red)" }}>offline</span>}
        {" · "}Supa: {rowPct}% rows
      </div>
      {worstPct > 0 && (
        <div className="ow-card-sub">
          mem {memPct}% · disk {diskPct}%
        </div>
      )}
      <div className="ow-card-link">view monitor →</div>
    </div>
  );
}

function TeamChatCard({ unread, onNavigate }) {
  const tone = unread > 0 ? "warn" : "";
  return (
    <div className={`ow-card${tone ? " is-" + tone : ""}`}
         tabIndex={0} role="button"
         onClick={() => onNavigate?.("team")}
         onKeyDown={e => e.key === "Enter" && onNavigate?.("team")}>
      <div className="ow-card-label">Team Chat</div>
      <div className={`ow-card-big${unread > 0 ? " is-warn" : ""}`}>
        {unread == null ? "—" : unread}
      </div>
      <div className="ow-card-sub">unread message{unread !== 1 ? "s" : ""}</div>
      <div className="ow-card-link">open team chat →</div>
    </div>
  );
}

function ReviewQueueCard({ reels, onScrollToQueue }) {
  const tone = reels.length > 0 ? "warn" : "";
  return (
    <div className={`ow-card${tone ? " is-" + tone : ""}`}
         tabIndex={0} role="button"
         onClick={onScrollToQueue}
         onKeyDown={e => e.key === "Enter" && onScrollToQueue?.()}>
      <div className="ow-card-label">Review Queue</div>
      <div className={`ow-card-big${reels.length > 0 ? " is-warn" : ""}`}>{reels.length}</div>
      <div className="ow-card-sub">reel{reels.length !== 1 ? "s" : ""} waiting</div>
      {reels.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
          {reels.slice(0, 3).map(r => (
            <div key={r.id} className="ow-card-sub" style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ color: "var(--c-amber)" }}>●</span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5 }}>{r.id}</span>
              <span style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.title}
              </span>
            </div>
          ))}
          {reels.length > 3 && (
            <div className="ow-card-sub" style={{ fontSize: 10 }}>+{reels.length - 3} more</div>
          )}
        </div>
      )}
      <div className="ow-card-link">↓ review below</div>
    </div>
  );
}

function OpenTasksCard({ tasks, onScrollToTasks }) {
  const tone = tasks.length > 0 ? "warn" : "";
  return (
    <div className={`ow-card${tone ? " is-" + tone : ""}`}
         tabIndex={0} role="button"
         onClick={onScrollToTasks}
         onKeyDown={e => e.key === "Enter" && onScrollToTasks?.()}>
      <div className="ow-card-label">Open Tasks</div>
      <div className={`ow-card-big${tasks.length > 0 ? " is-warn" : ""}`}>{tasks.length}</div>
      <div className="ow-card-sub">task{tasks.length !== 1 ? "s" : ""} assigned to you</div>
      <div className="ow-card-link">↓ view tasks below</div>
    </div>
  );
}

function TeamStatusSection({ teamStatus, onOpen, onNavigate }) {
  if (!teamStatus.length) return null;
  return (
    <div className="ow-team-section">
      <div className="ow-section-head">
        <span className="ow-section-title">Team Status</span>
        <span style={{ fontSize: 10.5, fontFamily: "var(--f-mono)", color: "var(--fg-dim)" }}>
          {teamStatus.reduce((s, t) => s + t.reels.length, 0)} active reels
        </span>
      </div>
      <div className="ow-team-grid">
        {teamStatus.map(({ person: p, reels: pReels, byStage, soonest }) => {
          const hasBlock = pReels.some(r => r.state === "block");
          const inProgress = byStage["in_progress"] || 0;
          const notStarted = byStage["not_started"] || 0;
          const inReview   = byStage["review"] || 0;
          return (
            <div key={p.id}
                 className={`ow-team-card${hasBlock ? " is-warn" : ""}`}
                 onClick={() => onNavigate?.("pipeline")}
                 title={`View ${p.name || p.short}'s reels on pipeline`}>
              <div className="ow-team-name">
                <span className={"avatar-chip " + (p.role || "")} style={{ fontSize: 13 }}>
                  {p.avatar}
                </span>
                {p.short || p.name}
              </div>
              <div className="ow-team-role">{p.role}</div>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 3 }}>
                {inProgress > 0 && (
                  <div className="ow-team-stat">
                    <strong>{inProgress}</strong> in progress
                  </div>
                )}
                {notStarted > 0 && (
                  <div className="ow-team-stat">
                    <strong>{notStarted}</strong> not started
                  </div>
                )}
                {inReview > 0 && (
                  <div className="ow-team-stat" style={{ color: "var(--c-amber)" }}>
                    <strong>{inReview}</strong> in review
                  </div>
                )}
                {pReels.length === 0 && (
                  <div className="ow-team-stat" style={{ color: "var(--fg-faint)" }}>no active reels</div>
                )}
                {soonest && (
                  <div className="ow-team-stat" style={{ marginTop: 4, color: "var(--fg-dim)" }}>
                    next due: <span style={{ fontFamily: "var(--f-mono)", fontSize: 10 }}>{soonest.id}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OwnerDashboard({ me, onOpen, onNavigate }) {
  const { reels, tasks } = useWorkflow();
  const { person }        = useAuth();
  const { peopleList, peopleById } = useRoster();

  /* Social connections — sync cache + async refresh */
  const [connections, setConnections] = useState(() => getConnections());
  useEffect(() => {
    fetchConnections(supabase).then(rows => { if (rows?.length) setConnections(rows); });
  }, []);

  /* Team chat unread — pull from Rocket.Chat REST API via stored bot credentials */
  const [chatUnread, setChatUnread] = useState(null);
  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "rocketchat_credentials")
      .maybeSingle()
      .then(({ data }) => {
        if (!data?.value?.authToken || !data?.value?.userId) return;
        return fetch("https://chat.footagebrain.com/api/v1/subscriptions.get", {
          headers: {
            "X-Auth-Token": data.value.authToken,
            "X-User-Id":    data.value.userId,
          },
        })
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (!d?.update) return;
            const total = d.update.reduce((s, ch) => s + (ch.unread || 0), 0);
            setChatUnread(total);
          });
      })
      .catch(() => {});
  }, []);

  /* Derived counts — all from the store, no extra fetches */
  const inboxSummary = useMemo(() => { try { return getInboxSummary(); } catch { return null; } }, []);
  const inReview     = useMemo(() => reels.filter(r => r.stage === "review" && !r.archivedAt), [reels]);
  const openTasks    = useMemo(() => tasks.filter(t => t.to === me && t.state !== "done"), [tasks, me]);

  /* Team status: group active reels by non-owner team member */
  const teamStatus = useMemo(() => {
    const team = peopleList.filter(p => p.role !== "owner");
    return team.map(p => {
      const pReels = reels.filter(r => r.owner === p.id && !r.archivedAt && r.stage !== "posted");
      const byStage = {};
      for (const r of pReels) byStage[r.stage] = (byStage[r.stage] || 0) + 1;
      const soonest = pReels
        .filter(r => r.dueAt)
        .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0] || null;
      return { person: p, reels: pReels, byStage, soonest };
    });
  }, [peopleList, reels]);

  /* Attention count for the subtitle */
  const attentionCount = inReview.length + openTasks.length + (chatUnread || 0) + (inboxSummary?.unreplied || 0);

  /* Scroll helpers for the cards that point down the page */
  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const isOwner = person?.role === "owner";
  const viewerPersonId = person?.id || me;

  return (
    <div className="ow-dashboard">
      {/* Page header */}
      <div className="page-head">
        <div className="titles">
          <h1>My work — {peopleById[me]?.short || "Paul"} · owner</h1>
          <div className="sub">
            {attentionCount > 0
              ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need your attention.`
              : "All clear — nothing urgent right now."}
          </div>
        </div>
        <div className="actions">
          {me && (
            <DPill onClick={() => downloadAgentFiles(me)} title="Download the CapCut tracker config">
              ↓ CapCut tracker setup
            </DPill>
          )}
        </div>
      </div>

      {/* Row 1: Social Reach · Platform Inbox · Infrastructure */}
      <div className="ow-summary-grid">
        <SocialReachCard connections={connections} onNavigate={onNavigate} />
        <PlatformInboxCard summary={inboxSummary} onNavigate={onNavigate} />
        <InfraHealthCard onNavigate={onNavigate} />
      </div>

      {/* Row 2: Team Chat · Review Queue · Open Tasks */}
      <div className="ow-summary-grid" style={{ marginTop: 10 }}>
        <TeamChatCard unread={chatUnread} onNavigate={onNavigate} />
        <ReviewQueueCard reels={inReview} onScrollToQueue={() => scrollTo("ow-review-queue")} />
        <OpenTasksCard tasks={openTasks} onScrollToTasks={() => scrollTo("ow-open-tasks")} />
      </div>

      {/* Team status */}
      <TeamStatusSection teamStatus={teamStatus} onOpen={onOpen} onNavigate={onNavigate} />

      {/* Full review queue */}
      <div id="ow-review-queue" className="ow-full-section">
        <div className="ow-section-head">
          <span className="ow-section-title">Review Queue</span>
          <span style={{ fontSize: 10.5, fontFamily: "var(--f-mono)", color: inReview.length > 0 ? "var(--c-amber)" : "var(--fg-dim)" }}>
            {inReview.length} waiting
          </span>
        </div>
        <div style={{ padding: "12px 0", display: "flex", flexDirection: "column", gap: 28 }}>
          {inReview.length === 0 && (
            <div style={{
              border: "1px dashed var(--line-hard)", borderRadius: 6,
              padding: 20, textAlign: "center", color: "var(--fg-dim)", fontSize: 13,
            }}>
              Review queue is clear.
            </div>
          )}
          {(() => {
            const map = {};
            inReview.forEach(r => { (map[r.owner || "__unknown"] = map[r.owner || "__unknown"] || []).push(r); });
            return Object.entries(map).map(([ownerId, cards]) => {
              const submitter = peopleById[ownerId] || null;
              return (
                <div key={ownerId}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    marginBottom: 10, paddingBottom: 8,
                    borderBottom: "1px dashed var(--line-hard)",
                  }}>
                    {submitter && (
                      <span className={"avatar-chip " + (submitter.role || "")} style={{ fontSize: 13 }}>
                        {submitter.avatar}
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: "var(--fg)", fontFamily: "var(--f-mono)" }}>
                      {submitter?.short || submitter?.name || ownerId}
                    </span>
                    {submitter?.role && (
                      <span className="mono dim" style={{ fontSize: 10 }}>· {submitter.role}</span>
                    )}
                    <span style={{
                      marginLeft: 2, fontSize: 10.5, color: "var(--c-cyan)",
                      fontFamily: "var(--f-mono)",
                      background: "rgba(107,214,224,0.08)",
                      border: "1px dashed rgba(107,214,224,0.3)",
                      padding: "1px 8px", borderRadius: 10,
                    }}>
                      {cards.length} reel{cards.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {cards.map(r => <ReviewRow key={r.id} reel={r} onOpen={onOpen} />)}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* Open tasks + daily tasks */}
      <div id="ow-open-tasks" className="ow-full-section">
        <OpenTasksSection
          personId={me}
          viewerPersonId={viewerPersonId}
          isOwner={isOwner}
          onOpen={onOpen}
        />
        <DailyTasksSection
          personId={me}
          viewerPersonId={viewerPersonId}
          isOwner={isOwner}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
/* Review queue dashboard — Leroy / reviewer role          */
/* ─────────────────────────────────────────────────────── */

function ReviewQueueWork({ me, onOpen }) {
  const { reels } = useWorkflow();
  const { person } = useAuth();
  const { peopleById } = useRoster();
  const inReview = reels.filter(r => r.stage === "review" && !r.archivedAt);
  const viewedPerson = (me && peopleById[me]) || person;
  const heading = viewedPerson?.name || "Reviewer";
  const isOwner = person?.role === "owner";
  const viewerPersonId = person?.id || "paul";

  // Group cards by the editor who owns (submitted) them
  const groups = useMemo(() => {
    const map = {};
    inReview.forEach(r => {
      const key = r.owner || "__unknown";
      (map[key] = map[key] || []).push(r);
    });
    return Object.entries(map).map(([ownerId, cards]) => ({
      ownerId,
      submitter: peopleById[ownerId] || null,
      cards,
    }));
  }, [inReview, peopleById]);

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>My work — {heading}</h1>
          <div className="sub">
            {inReview.length === 0
              ? "Nothing waiting on you."
              : `${inReview.length} reel${inReview.length === 1 ? "" : "s"} from ${groups.length} editor${groups.length === 1 ? "" : "s"} waiting on review.`}
          </div>
        </div>
        <div className="actions">
          {me && (
            <DPill onClick={() => downloadAgentFiles(me)} title="Download the CapCut tracker config for this person">
              ↓ CapCut tracker setup
            </DPill>
          )}
        </div>
      </div>

      <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 28 }}>
        {inReview.length === 0 && (
          <div style={{
            border: "1px dashed var(--line-hard)",
            borderRadius: 6,
            padding: "20px",
            textAlign: "center",
            color: "var(--fg-dim)",
            fontSize: 13,
          }}>
            Review queue is clear.
          </div>
        )}
        {groups.map(({ ownerId, submitter, cards }) => (
          <div key={ownerId}>
            {/* Submitter section header */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              marginBottom: 10, paddingBottom: 8,
              borderBottom: "1px dashed var(--line-hard)",
            }}>
              {submitter && (
                <span className={"avatar-chip " + (submitter.role || "")} style={{ fontSize: 13 }}>
                  {submitter.avatar}
                </span>
              )}
              <span style={{ fontSize: 12, color: "var(--fg)", fontFamily: "var(--f-mono)" }}>
                {submitter?.short || submitter?.name || ownerId}
              </span>
              {submitter?.role && (
                <span className="mono dim" style={{ fontSize: 10 }}>· {submitter.role}</span>
              )}
              <span style={{
                marginLeft: 2, fontSize: 10.5, color: "var(--c-cyan)",
                fontFamily: "var(--f-mono)",
                background: "rgba(107,214,224,0.08)",
                border: "1px dashed rgba(107,214,224,0.3)",
                padding: "1px 8px", borderRadius: 10,
              }}>
                {cards.length} reel{cards.length === 1 ? "" : "s"}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {cards.map(r => <ReviewRow key={r.id} reel={r} onOpen={onOpen} />)}
            </div>
          </div>
        ))}

        {me && (
          <React.Fragment>
            <OpenTasksSection
              personId={me}
              viewerPersonId={viewerPersonId}
              isOwner={isOwner}
              onOpen={onOpen}
            />
            <DailyTasksSection
              personId={me}
              viewerPersonId={viewerPersonId}
              isOwner={isOwner}
            />
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ reel, onOpen }) {
  const { actions } = useWorkflow();
  const { person } = useAuth();
  const { peopleById } = useRoster();
  const { can } = usePermissions();
  const now = useNow();
  const canAct = can("approveReview");
  const [note, setNote] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const accept = () => {
    actions.approveReview(reel.id, { by: person?.id || null });
    setNote("");
  };
  const sendBack = () => {
    actions.sendBack(reel.id, { note, by: person?.id || null });
    setNote("");
  };

  // Prior review-round history — only render if there's at least one
  // "sent_back" entry (i.e. the reel has been here before).
  const history = getRevisionHistory(reel.detail);
  const priorSendBacks = history.filter(h => h.action === "sent_back");
  const lastSendBack = priorSendBacks[priorSendBacks.length - 1];

  const logPreview = (reel.logline || "").trim().slice(0, 140);

  return (
    <div style={{
      border: "1px dashed var(--line-hard)",
      borderRadius: 6,
      padding: "14px 16px",
      background: "var(--bg-1)",
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
      <div style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        cursor: "pointer",
      }} onClick={() => onOpen({ id: reel.id, title: reel.title })}>
        <span className="mono dim" style={{ fontSize: 11 }}>{reel.id}</span>
        <span className="serif-i" style={{ fontSize: 17, color: "var(--fg)", flex: 1 }}>
          {reel.title}
        </span>
        <div style={{ textAlign: "right", lineHeight: 1.5 }}>
          {reel.stageEnteredAt && (
            <div className="mono dim" style={{ fontSize: 10 }}>
              in review · {formatDuration(now - new Date(reel.stageEnteredAt))}
            </div>
          )}
          <div className="mono dim" style={{ fontSize: 10 }}>
            due · {formatDue(reel, now) || "—"}
          </div>
        </div>
      </div>

      {logPreview && (
        <div style={{
          fontSize: 12, color: "var(--fg-mute)", lineHeight: 1.45,
        }}>
          {logPreview}{(reel.logline || "").length > 140 ? "…" : ""}
        </div>
      )}

      {reel.attachUrl && (
        <a href={reel.attachUrl} target="_blank" rel="noopener noreferrer"
           onClick={e => e.stopPropagation()}
           style={{
             fontSize: 11.5, color: "var(--c-cyan)",
             fontFamily: "var(--f-mono)", textDecoration: "none",
             alignSelf: "flex-start",
           }}>
          ↗ Current reel state
        </a>
      )}

      {lastSendBack && (
        <div style={{
          border: "1px dashed var(--c-amber-soft)",
          background: "rgba(245,194,102,0.04)",
          borderRadius: 4,
          padding: "8px 10px",
          fontSize: 11.5,
          lineHeight: 1.45,
        }}>
          <div style={{
            display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
            color: "var(--c-amber)",
            fontFamily: "var(--f-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 4,
          }}>
            <span>Your last note</span>
            {lastSendBack.by && (
              <span style={{ color: "var(--fg-dim)" }}>
                · {peopleById[lastSendBack.by]?.short || lastSendBack.by}
              </span>
            )}
            {lastSendBack.ts && (
              <span style={{ color: "var(--fg-dim)" }}>· {formatHistoryTs(lastSendBack.ts)}</span>
            )}
          </div>
          <div style={{ color: "var(--fg)" }}>
            {lastSendBack.note || <span style={{ color: "var(--fg-dim)" }}>(no note)</span>}
          </div>
          {priorSendBacks.length > 1 && (
            <div style={{ marginTop: 6 }}>
              <a href="#"
                 onClick={e => { e.preventDefault(); setHistoryOpen(o => !o); }}
                 style={{
                   fontSize: 10.5,
                   fontFamily: "var(--f-mono)",
                   color: "var(--c-cyan)",
                   textDecoration: "none",
                 }}>
                {historyOpen ? "hide" : "show"} {priorSendBacks.length - 1} earlier note{priorSendBacks.length - 1 === 1 ? "" : "s"}
              </a>
              {historyOpen && (
                <div style={{
                  marginTop: 6,
                  display: "flex", flexDirection: "column", gap: 6,
                  borderTop: "1px dashed var(--line-hard)",
                  paddingTop: 6,
                }}>
                  {priorSendBacks.slice(0, -1).reverse().map((h, i) => (
                    <div key={i}>
                      <div style={{
                        color: "var(--fg-dim)",
                        fontFamily: "var(--f-mono)",
                        fontSize: 10,
                        letterSpacing: "0.06em",
                      }}>
                        {h.by ? (peopleById[h.by]?.short || h.by) : "anon"} · {formatHistoryTs(h.ts)}
                      </div>
                      <div style={{ color: "var(--fg-mute)", fontSize: 11.5 }}>
                        {h.note || <span style={{ color: "var(--fg-dim)" }}>(no note)</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Notes (optional — included if you send back)…"
        disabled={!canAct}
        style={{
          background: "var(--bg-2)",
          border: "1px dashed var(--line-hard)",
          borderRadius: 4,
          color: "var(--fg)",
          fontFamily: "var(--f-sans)",
          fontSize: 12,
          padding: "8px 10px",
          resize: "vertical",
          minHeight: 48,
          outline: "none",
        }}
      />

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {canAct ? (
          <React.Fragment>
            <DPill onClick={sendBack}>Send back</DPill>
            <DPill primary onClick={accept}>Accept</DPill>
          </React.Fragment>
        ) : (
          <span className="mono dim" style={{ fontSize: 10.5 }}>
            sign in as owner or reviewer to act
          </span>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
/* Shared sub-pieces                                       */
/* ─────────────────────────────────────────────────────── */

/* Convert a Date / ISO string to the `YYYY-MM-DDTHH:MM` format
   required by <input type="datetime-local">. */
function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
       + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function fromDatetimeLocalValue(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function WorkCard({ reel, onOpen, clipCount, onDueChange }) {
  const { peopleById } = useRoster();
  // Most recent "sent_back" entry — only renders the orange badge if
  // it's the latest history event (i.e. no later approval).
  const history = getRevisionHistory(reel.detail);
  const last = history[history.length - 1];
  const revision = last && last.action === "sent_back" ? last : null;
  const revisionNote = revision?.note;
  const revisionTs   = revision?.ts;
  const revisionBy   = revision?.by ? (peopleById[revision.by]?.short || revision.by) : null;
  const logPreview = (reel.logline || "").trim().slice(0, 100);

  // Stop drag from triggering on the date input / link interactions.
  const stop = (e) => e.stopPropagation();

  return (
    <div className="work-card"
         onClick={() => onOpen({ id: reel.id, title: reel.title })}
         style={{ cursor: "pointer" }}>
      <div className="wc-head">
        <div>
          <div className="mono dim">{reel.id}</div>
          <div className="serif-i" style={{ fontSize: 17, color: "#eef3fb", marginTop: 2 }}>
            {reel.title}
          </div>
        </div>
      </div>

      {revisionNote && (
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          marginTop: 8,
          padding: "8px 10px",
          background: "rgba(245,194,102,0.08)",
          border: "1px dashed var(--c-amber-soft)",
          borderRadius: 4,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "var(--c-amber)",
            flexShrink: 0,
            marginTop: 4,
          }} />
          <div style={{ fontSize: 11.5, lineHeight: 1.4, flex: 1, minWidth: 0 }}>
            <div style={{
              color: "var(--c-amber)",
              fontFamily: "var(--f-mono)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 2,
              display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap",
            }}>
              <span>For revision</span>
              {revisionBy && <span style={{ color: "var(--fg-dim)" }}>· {revisionBy}</span>}
              {revisionTs && <span style={{ color: "var(--fg-dim)" }}>· {formatHistoryTs(revisionTs)}</span>}
            </div>
            <div style={{ color: "var(--fg)" }}>{revisionNote || <span style={{ color: "var(--fg-dim)" }}>(no note)</span>}</div>
            {history.length > 1 && (
              <div style={{
                marginTop: 4, fontSize: 10,
                fontFamily: "var(--f-mono)", color: "var(--fg-dim)",
              }}>
                {history.filter(h => h.action === "sent_back").length} prior round{history.filter(h => h.action === "sent_back").length === 1 ? "" : "s"} · open reel to view
              </div>
            )}
          </div>
        </div>
      )}

      {logPreview && (
        <div className="wc-next" style={{ marginTop: 8 }}>
          {logPreview}{(reel.logline || "").length > 100 ? "…" : ""}
        </div>
      )}

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginTop: 10,
        fontSize: 11,
        color: "var(--fg-mute)",
        fontFamily: "var(--f-mono)",
        flexWrap: "wrap",
      }}>
        <span title="Clips attached">📎 {clipCount}</span>
        {reel.attachUrl && (
          <a href={reel.attachUrl} target="_blank" rel="noopener noreferrer"
             onClick={stop}
             style={{ color: "var(--c-cyan)", textDecoration: "none" }}>
            ↗ Current state
          </a>
        )}
      </div>

      <div style={{
        marginTop: 8,
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        color: "var(--fg-dim)",
        fontFamily: "var(--f-mono)",
      }}>
        <span>Due:</span>
        <input
          type="datetime-local"
          value={toDatetimeLocalValue(reel.dueAt)}
          onClick={stop}
          onMouseDown={stop}
          onChange={e => {
            stop(e);
            onDueChange(fromDatetimeLocalValue(e.target.value));
          }}
          style={{
            background: "var(--bg-2)",
            border: "1px dashed var(--line-hard)",
            borderRadius: 3,
            color: "var(--fg)",
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            padding: "3px 6px",
            outline: "none",
          }}
        />
      </div>
    </div>
  );
}

function EmptyLane({ label }) {
  return <div className="mw-empty">{label}</div>;
}

export { MyWork };
