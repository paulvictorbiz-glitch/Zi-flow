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

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { DPill, Pill } from "../components/components.jsx";
import { useWorkflow } from "../store/store.jsx";
import { useAuth } from "../auth.jsx";
import { usePermissions, useIsOwner } from "../lib/permissions.jsx";
import { useNow, formatDue, formatDuration } from "../lib/time.jsx";
import { ROLES, STAGES, STAGE_LABEL } from "../lib/shared-data.jsx";
import { useRoster } from "../lib/roster.jsx";
import { supabase } from "../lib/supabase-client.js";
import { TeamChatRecentCard } from "../components/team-chat-recent-card.jsx";
import { startOfDayLocal, analyzeDay, fmtDuration, ONLINE_WINDOW_MS, loadDayRows } from "../lib/capcut-utils.js";
import { getConnections, PLATFORMS } from "../lib/social-client.js";
import { downloadCapcutTracker } from "../lib/capcut-agent-download.js";
import { TrainingProgressWidget } from "../components/TrainingProgressWidget.jsx";
import "./training.css";
import GamifyPanel from "../components/GamifyPanel.jsx";
import OwnerSkillOverlay from "../components/OwnerSkillOverlay.jsx";
import { maxXpForSkills } from "../lib/gamify-data.jsx";
import "../components/gamify.css";

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

/* Resolve whose reels this dashboard shows.
   - When personId is provided (owner switched to a specific person), use it.
   - Otherwise fall back to the authenticated person or the canonical slot for the role. */
function whoseWork(role, person, personId) {
  if (personId) return personId;
  if (person && person.role === role) return person.id;
  return ROLES[role]?.person || null;
}


/* Solarin-theme styling for My Work. All rules are scoped to the
   [data-theme="solarin"] ancestor so they are inert when the theme is off —
   the unconditional class names below are no-ops in the default theme.
   Hoisted to module scope so the string isn't recreated on every render. */
const SOL_MY_WORK_CSS = `
[data-theme="solarin"] .mw-wrap {
  max-width: 1280px; margin: 0 auto; padding: 28px 32px; box-sizing: border-box;
}
[data-theme="solarin"] .mw-header { margin-bottom: 20px; }
[data-theme="solarin"] .mw-stat-strip {
  display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 24px;
}
[data-theme="solarin"] .mw-stat-tile {
  background: var(--s-card); border: 1px solid var(--s-border);
  backdrop-filter: blur(3px); padding: 14px 16px;
  display: flex; flex-direction: column; gap: 4px;
}
[data-theme="solarin"] .mw-stat-num {
  font-family: var(--f-ui); font-size: 28px; font-weight: 700; color: var(--s-fg-soft);
}
[data-theme="solarin"] .mw-stat-label {
  font-family: var(--f-label); font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .1em; color: var(--s-fg-muted);
}
[data-theme="solarin"] .mw-body {
  display: grid; grid-template-columns: 1fr 360px; gap: 16px;
}
[data-theme="solarin"] .mw-board-panel {
  background: var(--s-panel); border: 1px solid var(--s-border);
  backdrop-filter: blur(4px); padding: 16px;
}
[data-theme="solarin"] .mw-lane-head {
  font-family: var(--f-label); font-size: 10.5px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .12em; color: var(--s-fg-muted);
  padding: 8px 0 10px; border-bottom: 1px solid var(--s-divider); margin-bottom: 8px;
}
[data-theme="solarin"] .mw-rail {
  display: flex; flex-direction: column; gap: 12px;
}
[data-theme="solarin"] .mw-rail-panel {
  background: var(--s-panel); border: 1px solid var(--s-border);
  backdrop-filter: blur(4px); padding: 14px 16px;
}
[data-theme="solarin"] .mw-rail-head {
  font-family: var(--f-label); font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .12em; color: var(--peach);
  margin-bottom: 10px;
}
[data-theme="solarin"] .sol-card.stage-in-progress {
  background: var(--s-card); border: 1px solid var(--s-border);
  backdrop-filter: blur(4px); border-left: 3px solid var(--peach);
}
`;

/* Theme-agnostic styles for the combined Team-stats row (Task D) and the
   by-editor Review-Queue columns (Task C). Hoisted to module scope. */
const MW_EXTRA_CSS = `
.ts-row {
  display: flex; gap: 12px; align-items: flex-start;
  overflow-x: auto; padding-bottom: 6px;
}
.ts-panel {
  flex: 0 0 auto; min-width: 230px;
  border: 1px solid var(--line, #232a38); border-radius: 10px;
  background: var(--bg-1, #11151f);
}
.ts-panel[data-open="1"] { min-width: 360px; }
.ts-panel-head {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 12px 14px; background: transparent; border: none; cursor: pointer;
  color: var(--fg, #e7ecf5); font-family: var(--f-mono, ui-monospace, monospace);
  text-align: left;
}
.ts-panel-head:hover { background: rgba(255,255,255,0.03); }
.ts-panel-icon { font-size: 14px; flex-shrink: 0; }
.ts-panel-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
  flex-shrink: 0;
}
.ts-panel-summary {
  font-size: 11px; color: var(--fg-dim, #aeb6c6); flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ts-panel-chevron { color: var(--fg-dim, #aeb6c6); font-size: 12px; margin-left: auto; flex-shrink: 0; }
.ts-panel-body {
  padding: 4px 14px 14px; border-top: 1px solid var(--line, #232a38);
  max-width: 580px;
}

/* Review queue — one column per submitting editor (Task C). */
.rq-columns {
  display: flex; gap: 16px; align-items: flex-start;
  overflow-x: auto; padding-bottom: 8px;
}
.rq-col { flex: 0 0 340px; max-width: 340px; min-width: 300px; }
.rq-col-head {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 10px; padding-bottom: 8px;
  border-bottom: 1px dashed var(--line-hard, #232a38);
}
.rq-col-body { display: flex; flex-direction: column; gap: 10px; }
`;

function MyWork({ role, personId, onOpen, onNavigate, onSetPerson }) {
  const { person } = useAuth();
  const { can } = usePermissions();
  const me = whoseWork(role, person, personId);
  // Owner-controlled: the Teams-messages card can be hidden per-person/role from
  // Roles & permissions (action cap `viewTeamChat`). Owner always sees it
  // (can() is fail-open + owner-always-true); off = hidden for that person.
  const showTeamChat = can("viewTeamChat");
  const dashboard =
    role === "owner"    ? <OwnerDashboard me={me} onOpen={onOpen} onNavigate={onNavigate} onSetPerson={onSetPerson} />
    : role === "reviewer" ? <ReviewQueueWork me={me} onOpen={onOpen} />
    : <SkilledWork me={me} onOpen={onOpen} role={role} />;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SOL_MY_WORK_CSS }} />
      <style dangerouslySetInnerHTML={{ __html: MW_EXTRA_CSS }} />
      {/* New Teams-chat messages — recent log + mute/mark-read (all roles).
          Relocated to the TOP of My Work (MYW-rel) so unread team messages are
          the first thing seen on entry, instead of being buried at page bottom.
          Owner can hide it per-person via the `viewTeamChat` permission. */}
      <div className="mw-wrap">
        {showTeamChat && (
          <div style={{ padding: "16px 22px 0" }}>
            <TeamChatRecentCard onOpenTeam={() => onNavigate?.("team")} />
          </div>
        )}
        {dashboard}
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────── */
/* Tasks & Comms — daily task list per person             */
/* ─────────────────────────────────────────────────────── */

// 8-tone palette for daily-task color tagging — mirrors the reel-card / list-view
// picker so colors read the same across the app.
const TASK_TONES = ["cyan", "violet", "green", "amber", "red", "blue", "orange", "pink"];
const TASK_TONE_COLOR = {
  cyan:   "var(--c-cyan)",   violet: "var(--c-violet)",
  green:  "var(--c-green)",  amber:  "var(--c-amber)",
  red:    "var(--c-red)",    blue:   "var(--c-blue)",
  orange: "var(--c-orange)", pink:   "var(--c-pink)",
};

/* Small colored-dot button + popover palette for tagging a task with a color.
   Owner-only (disabled for others, who still see the color if one is set). */
function TaskColorDot({ task, onPick, disabled = false }) {
  const [open, setOpen] = useState(false);
  const wrapRef = React.useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Nothing to show for a non-owner on an uncolored task.
  if (disabled && !task.color) return null;
  const current = task.color ? TASK_TONE_COLOR[task.color] : null;

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        title={disabled ? (task.color || "") : "Set task color"}
        style={{
          width: 12, height: 12, borderRadius: "50%", padding: 0, marginTop: 3,
          cursor: disabled ? "default" : "pointer",
          background: current || "transparent",
          border: current ? "1px solid rgba(255,255,255,0.25)" : "1px dashed var(--fg-dim)",
        }}
      />
      {open && (
        <span
          onClick={e => e.stopPropagation()}
          style={{
            position: "absolute", top: 18, left: 0, zIndex: 50,
            background: "var(--bg-2, #1e2433)", border: "1px solid var(--line-hard)",
            borderRadius: 6, padding: "6px 8px", display: "flex", gap: 5, flexWrap: "wrap",
            width: 132, boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
          }}
        >
          {TASK_TONES.map(t => (
            <span
              key={t}
              onClick={() => { onPick(t); setOpen(false); }}
              title={t}
              style={{
                width: 16, height: 16, borderRadius: "50%", cursor: "pointer",
                background: TASK_TONE_COLOR[t],
                border: task.color === t ? "2px solid #fff" : "2px solid transparent",
              }}
            />
          ))}
          {task.color && (
            <span
              onClick={() => { onPick(null); setOpen(false); }}
              title="Clear color"
              style={{
                width: 16, height: 16, borderRadius: "50%", cursor: "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                border: "1px solid var(--fg-dim)", color: "var(--fg-mute)", fontSize: 11, lineHeight: 1,
              }}
            >×</span>
          )}
        </span>
      )}
    </span>
  );
}

function TaskRow({
  task, isOwner, onComplete, onDelete, onUpdate,
  draggableTask = false, dragId = null, isOver = false,
  onDragStartTask, onDragOverTask, onDropTask, onDragEndTask,
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(task.taskText || "");
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(task.notes || "");
  const [noteSaving, setNoteSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const commitEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== task.taskText) {
      onUpdate(task.id, { taskText: trimmed });
    } else {
      setEditText(task.taskText || "");
    }
    setEditing(false);
  };

  const commitNote = async () => {
    if (noteDraft === (task.notes || "")) { setNotesOpen(false); setExpanded(false); return; }
    setNoteSaving(true);
    await onUpdate(task.id, { notes: noteDraft });
    setNoteSaving(false);
    setNotesOpen(false);
    setExpanded(false);
  };

  const cancelNote = () => { setNoteDraft(task.notes || ""); setNotesOpen(false); setExpanded(false); };

  // Shared keyboard handling for both the inline and expanded textareas
  const handleNoteKeyDown = e => {
    if (e.key === "Enter") {
      if (e.shiftKey) {
        // Shift+Enter: insert newline at cursor position manually
        e.preventDefault();
        const el = e.target;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const next = noteDraft.slice(0, start) + "\n" + noteDraft.slice(end);
        setNoteDraft(next);
        // restore cursor after the inserted newline
        requestAnimationFrame(() => {
          el.selectionStart = start + 1;
          el.selectionEnd   = start + 1;
        });
      } else if (isOwner) {
        // Enter alone: save
        e.preventDefault();
        commitNote();
      }
    }
  };

  // Keep local draft in sync when task.notes changes externally
  React.useEffect(() => { setNoteDraft(task.notes || ""); }, [task.notes]);

  // Drag-reorder only when an owner-owned, incomplete row is not being inline-edited.
  const canDrag = isOwner && !task.completed && !editing && !notesOpen;

  return (
    <li
      className={"mw-task-row" + (isOver ? " is-drop-target" : "")}
      onDragOver={e => { if (dragId && dragId !== task.id && !task.completed) { e.preventDefault(); onDragOverTask?.(task.id); } }}
      onDrop={e => { e.preventDefault(); onDropTask?.(task.id); }}
      onDragEnd={() => onDragEndTask?.()}
      style={{
        display: "flex", flexDirection: "column", gap: 0,
        borderBottom: "1px solid var(--line-soft, var(--line-hard))",
        borderLeft: task.color ? `3px solid ${TASK_TONE_COLOR[task.color] || "transparent"}` : "3px solid transparent",
        paddingLeft: 6,
        opacity: dragId === task.id ? 0.4 : 1,
      }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 0" }}>
        {/* Dedicated drag handle — only this grabs the drag, so the row text/notes stay
            freely selectable for copy/paste. (A draggable <li> hijacks text selection.) */}
        {canDrag ? (
          <span
            className="mw-drag-handle"
            draggable
            onDragStart={e => { e.dataTransfer.effectAllowed = "move"; onDragStartTask?.(task.id); }}
            title="Drag to reorder"
            style={{
              cursor: "grab", color: "var(--fg-dim)", fontSize: 13, lineHeight: 1,
              marginTop: 3, flexShrink: 0, userSelect: "none",
            }}
          >⠿</span>
        ) : (
          <span style={{ width: 8, flexShrink: 0 }} aria-hidden="true" />
        )}

        <input
          type="checkbox"
          checked={!!task.completed}
          onChange={e => onComplete(task.id, e.target.checked)}
          style={{ marginTop: 3, cursor: "pointer", accentColor: "var(--c-ok, #22c55e)", flexShrink: 0 }}
        />

        <TaskColorDot
          task={task}
          onPick={c => onUpdate(task.id, { color: c })}
          disabled={!isOwner}
        />

        <button
          onClick={() => setNotesOpen(o => !o)}
          title={task.notes ? "Has notes — click to view/edit" : "Add a note"}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: task.notes ? "var(--c-cyan)" : "var(--fg-dim)",
            fontSize: 13, padding: "0 3px", lineHeight: 1, flexShrink: 0,
          }}
        >
          {notesOpen ? "▾" : (task.notes ? "📝" : "▸")}
        </button>

        {editing && isOwner ? (
          <input
            autoFocus
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") { setEditText(task.taskText || ""); setEditing(false); } }}
            style={{
              flex: 1, background: "var(--bg-2)", border: "1px solid var(--c-cyan)",
              borderRadius: 3, color: "var(--fg)", fontFamily: "var(--f-sans, var(--f-mono))",
              fontSize: 13, padding: "2px 6px", outline: "none",
            }}
          />
        ) : (
          <span
            className={"mw-task-text" + (task.completed ? " is-done" : "")}
            onClick={() => { if (isOwner && !task.completed) { setEditText(task.taskText || ""); setEditing(true); } }}
            title={isOwner && !task.completed ? "Click to edit" : undefined}
            style={{
              flex: 1,
              textDecoration: task.completed ? "line-through" : "none",
              fontFamily: "var(--f-sans, var(--f-mono))",
              cursor: isOwner && !task.completed ? "text" : "default",
            }}
          >
            {task.taskText}
          </span>
        )}

        {isOwner && (
          <button
            onClick={() => onDelete(task.id)}
            style={{ background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}
            title="Delete task"
          >×</button>
        )}
      </div>

      {notesOpen && (
        <div style={{ paddingLeft: 26, paddingBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 3 }}>
            <button
              onClick={() => setExpanded(true)}
              title="Expand note to a larger view"
              style={{ background: "none", border: "1px solid var(--line-hard)", borderRadius: 4, color: "var(--fg-dim)", cursor: "pointer", fontSize: 11, padding: "2px 8px", lineHeight: 1 }}
            >
              Expand ⤢
            </button>
          </div>
          <textarea
            value={noteDraft}
            onChange={e => setNoteDraft(e.target.value)}
            placeholder="Add a note… (Shift+Enter for new line, Ctrl+Enter to save)"
            readOnly={!isOwner}
            rows={3}
            onKeyDown={handleNoteKeyDown}
            onMouseDown={e => e.stopPropagation()}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "var(--bg-2)",
              border: "1px dashed var(--line-hard)",
              borderRadius: 4,
              color: "var(--fg)",
              fontFamily: "var(--f-sans, var(--f-mono))",
              fontSize: 12,
              padding: "7px 10px",
              resize: "vertical",
              outline: "none",
              whiteSpace: "pre-wrap",
            }}
          />
          {isOwner && (
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button
                className="btn-primary"
                onClick={commitNote}
                disabled={noteSaving}
                style={{ fontSize: 11, padding: "3px 10px" }}
              >
                {noteSaving ? "Saving…" : "Save note"}
              </button>
              <button
                onClick={cancelNote}
                style={{ background: "none", border: "1px solid var(--line-hard)", borderRadius: 4, color: "var(--fg-dim)", cursor: "pointer", fontSize: 11, padding: "3px 10px" }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {expanded && (
        <div
          onClick={() => setExpanded(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "min(720px, 100%)", maxHeight: "85vh",
              display: "flex", flexDirection: "column", gap: 10,
              background: "var(--bg-2)",
              border: "1px solid var(--line-hard)",
              borderRadius: 8,
              padding: 16,
              boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "var(--fg)", fontFamily: "var(--f-sans, var(--f-mono))" }}>
                {isOwner ? "Edit note" : "Note"}
              </span>
              <button
                onClick={() => setExpanded(false)}
                title="Close"
                style={{ background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px" }}
              >×</button>
            </div>
            <textarea
              autoFocus
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              placeholder="Add a note… (Shift+Enter for new line, Enter to save)"
              readOnly={!isOwner}
              onKeyDown={handleNoteKeyDown}
              onMouseDown={e => e.stopPropagation()}
              style={{
                flex: 1, minHeight: "50vh", width: "100%", boxSizing: "border-box",
                background: "var(--bg-1, var(--bg-2))",
                border: "1px solid var(--line-hard)",
                borderRadius: 4,
                color: "var(--fg)",
                fontFamily: "var(--f-sans, var(--f-mono))",
                fontSize: 14,
                padding: "12px 14px",
                resize: "vertical",
                outline: "none",
                whiteSpace: "pre-wrap",
              }}
            />
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              {isOwner && (
                <button
                  className="btn-primary"
                  onClick={commitNote}
                  disabled={noteSaving}
                  style={{ fontSize: 12, padding: "5px 14px" }}
                >
                  {noteSaving ? "Saving…" : "Save note"}
                </button>
              )}
              {isOwner ? (
                <button
                  onClick={cancelNote}
                  style={{ background: "none", border: "1px solid var(--line-hard)", borderRadius: 4, color: "var(--fg-dim)", cursor: "pointer", fontSize: 12, padding: "5px 14px" }}
                >
                  Cancel
                </button>
              ) : (
                <button
                  onClick={() => setExpanded(false)}
                  style={{ background: "none", border: "1px solid var(--line-hard)", borderRadius: 4, color: "var(--fg-dim)", cursor: "pointer", fontSize: 12, padding: "5px 14px" }}
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function DailyTasksSection({ personId, viewerPersonId, isOwner }) {
  const { dailyTasks, actions: { createDailyTask, completeDailyTask, deleteDailyTask, updateDailyTask, reorderDailyTasks } } = useWorkflow();
  const [newTaskText, setNewTaskText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  const today = new Date().toISOString().slice(0, 10);

  // Show today's tasks + any incomplete from previous days
  const myTasks = dailyTasks
    .filter(t => t.assignedTo === personId)
    .filter(t => !t.completed || t.taskDate === today) // show incomplete always, completed only today
    .sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1; // incomplete first
      const sa = a.sortOrder ?? Infinity, sb = b.sortOrder ?? Infinity;
      if (sa !== sb) return sa - sb; // explicit sort order, unsorted sink below
      return (a.created_at || "").localeCompare(b.created_at || "");
    });

  // HTML5 drag-reorder of the INCOMPLETE subset; completed tasks stay pinned after.
  const handleReorder = (srcId, destId) => {
    if (!srcId || !destId || srcId === destId) return;
    const incomplete = myTasks.filter(t => !t.completed);
    const srcIdx = incomplete.findIndex(t => t.id === srcId);
    const destIdx = incomplete.findIndex(t => t.id === destId);
    if (srcIdx === -1 || destIdx === -1) { setDragId(null); setOverId(null); return; }
    const reordered = incomplete.slice();
    const [moved] = reordered.splice(srcIdx, 1);
    reordered.splice(destIdx, 0, moved);
    const completedIds = myTasks.filter(t => t.completed).map(t => t.id);
    const fullOrderedIds = [...reordered.map(t => t.id), ...completedIds];
    reorderDailyTasks(fullOrderedIds);
    setDragId(null);
    setOverId(null);
  };

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
    <div className="mw-tasks-section" style={{ marginTop: 24 }}>
      <div className="mw-tasks-head" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10, borderBottom: "1px solid var(--line-hard)", paddingBottom: 8,
      }}>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Tasks &amp; Comms
        </span>
        <span style={{ fontSize: 11, fontFamily: "var(--f-mono)" }}>
          {myTasks.filter(t => !t.completed).length} open
        </span>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
        {myTasks.length === 0 && (
          <li className="mw-tasks-empty" style={{ fontSize: 12, fontFamily: "var(--f-mono)", padding: "6px 0" }}>
            No tasks for today.
          </li>
        )}
        {myTasks.map(task => (
          <TaskRow
            key={task.id}
            task={task}
            isOwner={isOwner}
            onComplete={completeDailyTask}
            onDelete={deleteDailyTask}
            onUpdate={updateDailyTask}
            draggableTask={isOwner && !task.completed}
            dragId={dragId}
            isOver={overId === task.id}
            onDragStartTask={(id) => setDragId(id)}
            onDragOverTask={(id) => { if (dragId && dragId !== id) setOverId(id); }}
            onDropTask={(destId) => handleReorder(dragId, destId)}
            onDragEndTask={() => { setDragId(null); setOverId(null); }}
          />
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
/* Skilled editor dashboard — 3-column DnD                */
/* ─────────────────────────────────────────────────────── */

/* Editor board columns are DERIVED from the canonical pipeline STAGES
   (shared-data.jsx) so this board always shows — and counts — exactly the
   same set of reels the Pipeline lane does. Previously this was a hand-kept
   4-column list missing "posted", so any posted reel an editor owned was
   counted in their Pipeline lane total but invisible here, making the two
   views disagree. Sourcing from STAGES keeps them in lockstep globally. */
const SKILLED_COLS = STAGES.map(key => ({ key, title: STAGE_LABEL[key] || key }));
const SKILLED_COL_KEYS = new Set(SKILLED_COLS.map(c => c.key));

function SkilledWork({ me, onOpen, role }) {
  const { reels, actions, attachedFootage, gamifyEnabled } = useWorkflow();
  const { person } = useAuth();
  const { peopleById } = useRoster();
  const { can } = usePermissions();
  const [gamifyOpen, setGamifyOpen] = useState(true);
  /* Bucket by `lane || owner` to match the Pipeline board exactly
     (pipeline.jsx derives a card's row the same way). Filtering by `owner`
     alone dropped reels that had been assigned to this editor's lane without
     an owner-sync — they showed in the Pipeline lane but vanished here, so the
     two views disagreed (the "Not Started shows only 5" bug). */
  const mine = reels.filter(r => (r.lane || r.owner) === me && !r.archivedAt);
  const whoLabel = peopleById[me]?.short || "Editor";
  const roleLabel = ROLES[role]?.short?.toLowerCase() || role || "editor";
  const isOwner = useIsOwner();
  const viewerPersonId = person?.id || "paul";

  // Reel moves gate behind moveReel; moving INTO "completed" also needs moveToCompleted.
  const canMoveTo = (stage) =>
    stage === "completed" ? (can("moveReel") && can("moveToCompleted")) : can("moveReel");

  const [dragId, setDragId] = useState(null);
  const [dropCol, setDropCol] = useState(null);

  const handleDrop = (targetStage) => {
    if (!dragId) return;
    if (!canMoveTo(targetStage)) { setDragId(null); setDropCol(null); return; }
    actions.moveStage(dragId, { stage: targetStage });
    setDragId(null);
    setDropCol(null);
  };

  return (
    <div>
      <div className="page-head mw-header">
        <div className="titles">
          <h1>My work — {whoLabel} · {roleLabel}</h1>
          <div className="sub">
            Drag a card between columns to update its status.
          </div>
        </div>
        <div className="actions">
          {gamifyEnabled && (
            <DPill onClick={() => setGamifyOpen(o => !o)}
                   title="Toggle your skill progress panel">
              🎮 {gamifyOpen ? "Hide" : "Show"} progress
            </DPill>
          )}
          <DPill onClick={() => downloadCapcutTracker(me)} title="Download CapCut tracker zip — unzip and run install.bat">
            ↓ CapCut tracker setup
          </DPill>
        </div>
      </div>

      <GamifyPanel personId={me} open={gamifyOpen} />

      <TrainingProgressWidget personId={me} isOwner={false} />

      <div className="mywork-grid"
           style={{ gridTemplateColumns: `repeat(${SKILLED_COLS.length}, 1fr)` }}>
        {SKILLED_COLS.map((col, ci) => {
          /* Last column also absorbs any reel whose (normalized) stage isn't a
             known column, so the board's reels always sum to the same set the
             Pipeline lane counts — no reel is ever silently dropped. */
          const rows = ci === SKILLED_COLS.length - 1
            ? mine.filter(r => r.stage === col.key || !SKILLED_COL_KEYS.has(r.stage))
            : mine.filter(r => r.stage === col.key);
          const isTarget = dropCol === col.key;
          return (
            <div className="mw-col mw-board-panel" key={col.key}
                 onDragOver={e => { if (dragId && canMoveTo(col.key)) { e.preventDefault(); if (dropCol !== col.key) setDropCol(col.key); } }}
                 onDragLeave={() => { if (dropCol === col.key) setDropCol(null); }}
                 onDrop={e => { if (!canMoveTo(col.key)) return; e.preventDefault(); handleDrop(col.key); }}
                 style={{
                   outline: isTarget ? "2px dashed var(--c-cyan)" : "",
                   outlineOffset: isTarget ? "-4px" : "",
                   transition: "outline 0.1s",
                 }}>
              <div className="mw-col-head mw-lane-head">
                <div className="mw-h">{col.title}</div>
                <span className="count-tag">{rows.length}</span>
              </div>
              <div className="mw-list">
                {rows.map(r => (
                  <div key={r.id}
                       draggable={can("moveReel")}
                       onDragStart={e => { if (!can("moveReel")) return; setDragId(r.id); e.dataTransfer.effectAllowed = "move"; }}
                       onDragEnd={() => { setDragId(null); setDropCol(null); }}
                       style={{ opacity: dragId === r.id ? 0.4 : 1 }}>
                    <WorkCard
                      reel={r}
                      onOpen={onOpen}
                      clipCount={attachedFootage.filter(f => f.reel_id === r.id).length}
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
  const isOwner = useIsOwner();
  const viewerPersonId = person?.id || "paul";

  return (
    <div>
      <div className="page-head mw-header">
        <div className="titles">
          <h1>My work — {whoLabel} · variant editor</h1>
          <div className="sub">Reels assigned to you.</div>
        </div>
        <div className="actions">
          <DPill onClick={() => downloadCapcutTracker(me)} title="Download CapCut tracker zip — unzip and run install.bat">
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
              <div className="mono" style={{ color: "var(--c-amber)" }}>{(formatDue(r, now) || "—").replace(/\s+\d{1,2}:\d{2}$/, "")}</div>
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

function CapCutTeamWidget({ teamMembers, embedded = false }) {
  // When embedded in the combined Team-stats row, the parent StatPanel owns the
  // open/close chrome — mount expanded so the lazy data effects fire immediately.
  const [expanded, setExpanded] = useState(embedded);
  const [viewMode, setViewMode] = useState("day"); // "day" | "week" | "month"
  const [dayOffset, setDayOffset] = useState(0);
  const [memberData, setMemberData] = useState({});      // day view: { personId: { rows, analyzed } }
  const [calData, setCalData]       = useState({});      // week/month: { "YYYY-MM-DD": { personId: analyzed } }
  const [loadingIds, setLoadingIds] = useState(new Set());
  const [calLoading, setCalLoading] = useState(false);
  const [expandedPersons, setExpandedPersons] = useState(new Set());
  const [editingOnly, setEditingOnly] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);      // 0=this week, -1=last week…
  const [monthOffset, setMonthOffset] = useState(0);    // 0=this month

  const dayStart = useMemo(() => startOfDayLocal(dayOffset), [dayOffset]);
  const dayLabel = useMemo(() => {
    if (dayOffset === 0) return "Today";
    if (dayOffset === -1) return "Yesterday";
    return dayStart.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }, [dayOffset, dayStart]);

  /* ── day-view loader ─────────────────────────────────────── */
  const loadDayView = useCallback(async (dStart, dOffset) => {
    if (!teamMembers.length) return;
    const ids = teamMembers.map(p => p.id);
    setLoadingIds(new Set(ids));
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const rows = await loadDayRows(id, dStart, supabase);
          const analyzed = analyzeDay(rows, dOffset === 0 ? Date.now() : dStart.getTime() + 86400000);
          return { id, rows, analyzed };
        } catch {
          return { id, rows: [], analyzed: null };
        }
      })
    );
    const next = {};
    results.forEach(r => { next[r.id] = { rows: r.rows, analyzed: r.analyzed }; });
    setMemberData(next);
    setLoadingIds(new Set());
    return next;
  }, [teamMembers]);

  /* ── skip-empty-day navigation ───────────────────────────── */
  const navPrev = useCallback(async () => {
    let offset = dayOffset - 1;
    for (let attempt = 0; attempt < 60; attempt++) {
      const ds = startOfDayLocal(offset);
      const results = await Promise.all(
        teamMembers.map(async (p) => {
          try {
            const rows = await loadDayRows(p.id, ds, supabase);
            return rows.length > 0;
          } catch { return false; }
        })
      );
      if (results.some(Boolean)) { setDayOffset(offset); return; }
      offset--;
    }
    setDayOffset(offset); // fallback: go there even if no data found in 60 days
  }, [dayOffset, teamMembers]);

  const navNext = useCallback(async () => {
    if (dayOffset >= 0) return;
    let offset = dayOffset + 1;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (offset > 0) return; // don't go past today
      const ds = startOfDayLocal(offset);
      const results = await Promise.all(
        teamMembers.map(async (p) => {
          try {
            const rows = await loadDayRows(p.id, ds, supabase);
            return rows.length > 0;
          } catch { return false; }
        })
      );
      if (results.some(Boolean) || offset === 0) { setDayOffset(offset); return; }
      offset++;
    }
  }, [dayOffset, teamMembers]);

  /* ── week/month calendar loader ──────────────────────────── */
  const loadCalendar = useCallback(async (days /* Array<Date> */) => {
    if (!teamMembers.length || !days.length) return;
    setCalLoading(true);
    const dayKey = (d) => d.toISOString().slice(0, 10);
    const results = await Promise.all(
      days.map(async (ds) => {
        const perPerson = {};
        await Promise.all(teamMembers.map(async (p) => {
          try {
            const rows = await loadDayRows(p.id, ds, supabase);
            if (rows.length > 0) perPerson[p.id] = analyzeDay(rows, ds.getTime() + 86400000);
          } catch { /* skip */ }
        }));
        return { key: dayKey(ds), perPerson };
      })
    );
    const next = {};
    results.forEach(r => { if (Object.keys(r.perPerson).length > 0) next[r.key] = r.perPerson; });
    setCalData(next);
    setCalLoading(false);
  }, [teamMembers]);

  /* ── compute day lists for week/month ───────────────────── */
  const weekDays = useMemo(() => {
    const today = startOfDayLocal(0);
    const dow = today.getDay(); // 0=Sun
    const mondayOffset = -(dow === 0 ? 6 : dow - 1) + weekOffset * 7;
    return Array.from({ length: 7 }, (_, i) => startOfDayLocal(mondayOffset + i));
  }, [weekOffset]);

  const monthDays = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth() + monthOffset;
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    return Array.from({ length: last.getDate() }, (_, i) => new Date(y, m, i + 1));
  }, [monthOffset]);

  /* ── effects ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!expanded) return;
    if (viewMode === "day") loadDayView(dayStart, dayOffset);
  }, [expanded, viewMode, dayStart, dayOffset, loadDayView]);

  useEffect(() => {
    if (!expanded || viewMode !== "week") return;
    loadCalendar(weekDays);
  }, [expanded, viewMode, weekDays, loadCalendar]);

  useEffect(() => {
    if (!expanded || viewMode !== "month") return;
    loadCalendar(monthDays);
  }, [expanded, viewMode, monthDays, loadCalendar]);

  useEffect(() => {
    if (!expanded || viewMode !== "day" || dayOffset !== 0) return;
    const t = setInterval(() => loadDayView(dayStart, 0), 30000);
    return () => clearInterval(t);
  }, [expanded, viewMode, dayOffset, dayStart, loadDayView]);

  /* ── aggregate (day view) ───────────────────────────────── */
  const aggregate = useMemo(() => {
    const vals = Object.values(memberData).map(d => d.analyzed).filter(Boolean);
    const totalMin = vals.reduce((s, a) => s + (a.totalMin || 0), 0);
    const activeMin = vals.reduce((s, a) => s + (a.activeMin || 0), 0);
    const idleMin = vals.reduce((s, a) => s + (a.idleMin || 0), 0);
    const hourly = Array(24).fill(0);
    vals.forEach(a => { a.hourly?.forEach((m, h) => { hourly[h] += m; }); });
    const activeMembers = vals.filter(a => a.totalMin > 0).length;
    return { totalMin, activeMin, idleMin, hourly, activeMembers };
  }, [memberData]);

  const maxHour = Math.max(...aggregate.hourly, 0.01);

  const liveStatus = (personId) => {
    const d = memberData[personId];
    if (!d?.rows?.length || dayOffset !== 0) return "⚫";
    const latest = d.rows[d.rows.length - 1];
    if (!latest) return "⚫";
    const age = Date.now() - new Date(latest.ts).getTime();
    if (age > ONLINE_WINDOW_MS) return "⚫";
    return latest.focused ? "🟢" : "🟡";
  };

  const summaryLine = `${aggregate.activeMembers} of ${teamMembers.length} active ${dayLabel.toLowerCase()} · ${fmtDuration(aggregate.totalMin)} total`;

  /* ── calendar cell color (intensity based on totalMin) ──── */
  const cellColor = (totalMin) => {
    if (!totalMin || totalMin <= 0) return "transparent";
    const t = Math.min(totalMin / 120, 1); // saturate at 2h
    const alpha = 0.15 + t * 0.75;
    return `rgba(6, 182, 212, ${alpha.toFixed(2)})`; // cyan
  };

  /* ── week/month label helpers ───────────────────────────── */
  const weekLabel = useMemo(() => {
    const s = weekDays[0], e = weekDays[6];
    const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${fmt(s)} – ${fmt(e)}`;
  }, [weekDays]);

  const monthLabel = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
      .toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [monthOffset]);

  const today = useMemo(() => startOfDayLocal(0).toISOString().slice(0, 10), []);

  /* ── calendar day totals (sum across all team members) ──── */
  const dayTotal = (key) => {
    const perPerson = calData[key];
    if (!perPerson) return 0;
    return Object.values(perPerson).reduce((s, a) => s + (a?.totalMin || 0), 0);
  };

  const body = (
        <div style={{ borderTop: embedded ? "none" : "1px solid var(--line-hard)", padding: embedded ? "6px 0 2px" : "12px 14px" }}>
          {/* View mode tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {["day", "week", "month"].map(m => (
              <button key={m} onClick={() => setViewMode(m)} style={{
                background: viewMode === m ? "var(--c-cyan)" : "none",
                border: "1px solid var(--line-hard)",
                borderRadius: 3, color: viewMode === m ? "#000" : "var(--fg-dim)",
                fontFamily: "var(--f-mono)", fontSize: 10, padding: "2px 8px",
                cursor: "pointer", textTransform: "capitalize", fontWeight: viewMode === m ? 600 : 400,
              }}>{m}</button>
            ))}
          </div>

          {/* ── DAY VIEW ── */}
          {viewMode === "day" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                <button onClick={navPrev} style={{ background: "none", border: "1px solid var(--line-hard)", borderRadius: 3, color: "var(--fg-dim)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "3px 8px", cursor: "pointer" }}>← Prev</button>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg)", minWidth: 70, textAlign: "center" }}>{dayLabel}</span>
                <button onClick={navNext} disabled={dayOffset >= 0} style={{ background: "none", border: "1px solid var(--line-hard)", borderRadius: 3, color: "var(--fg-dim)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "3px 8px", cursor: dayOffset >= 0 ? "default" : "pointer", opacity: dayOffset >= 0 ? 0.4 : 1 }}>Next →</button>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-dim)", cursor: "pointer", marginLeft: "auto" }}>
                  <input type="checkbox" checked={editingOnly} onChange={e => setEditingOnly(e.target.checked)} />
                  Editing only
                </label>
              </div>

              <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--c-cyan)" }}>{fmtDuration(aggregate.activeMin)} editing</span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-dim)" }}>{fmtDuration(aggregate.idleMin)} idle</span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-dim)" }}>{fmtDuration(aggregate.totalMin)} total</span>
              </div>

              <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 40, marginBottom: 14 }} title="Total CapCut minutes per hour">
                {aggregate.hourly.map((m, h) => (
                  <div key={h} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ width: "70%", height: Math.round((m / maxHour) * 38) + "px", minHeight: m > 0.05 ? 2 : 0, background: "var(--c-cyan)", borderRadius: "2px 2px 0 0", opacity: 0.7 }} title={`${h}:00 — ${fmtDuration(m)}`} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                {[0,6,12,18].map(h => <span key={h} style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--fg-dim)" }}>{h}h</span>)}
              </div>

              {teamMembers.map(person => {
                const d = memberData[person.id];
                const a = d?.analyzed;
                const isLoading = loadingIds.has(person.id);
                const personExpanded = expandedPersons.has(person.id);
                const hasActivity = a && a.totalMin > 0;
                const dot = liveStatus(person.id);
                return (
                  <div key={person.id} style={{ marginBottom: 6, borderBottom: "1px solid var(--line-hard)", paddingBottom: 6 }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: hasActivity ? "pointer" : "default" }}
                      onClick={() => hasActivity && setExpandedPersons(prev => {
                        const next = new Set(prev);
                        if (next.has(person.id)) next.delete(person.id); else next.add(person.id);
                        return next;
                      })}
                    >
                      <span style={{ fontSize: 13 }}>{person.avatar || "👤"}</span>
                      <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg)", minWidth: 60 }}>{person.short || person.name}</span>
                      <span style={{ fontSize: 11 }} title={dot === "🟢" ? "Editing now" : dot === "🟡" ? "CapCut open, idle" : "Not active"}>{dot}</span>
                      {isLoading ? (
                        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)" }}>loading…</span>
                      ) : hasActivity ? (
                        <>
                          <div style={{ flex: 1, height: 4, background: "var(--bg-3, #1a2335)", borderRadius: 2 }}>
                            <div style={{ width: Math.round((a.totalMin / Math.max(...Object.values(memberData).map(x => x.analyzed?.totalMin || 0), 1)) * 100) + "%", height: "100%", background: "var(--c-cyan)", borderRadius: 2 }} />
                          </div>
                          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--c-cyan)", minWidth: 42 }}>{fmtDuration(a.totalMin)}</span>
                          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)" }}>{fmtDuration(a.activeMin)} edit</span>
                          <span style={{ fontSize: 10, color: "var(--fg-dim)" }}>{personExpanded ? "▾" : "▸"}</span>
                        </>
                      ) : (
                        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", opacity: 0.5 }}>No activity</span>
                      )}
                    </div>
                    {personExpanded && hasActivity && (
                      <div style={{ paddingLeft: 24, paddingTop: 4 }}>
                        {a.projects.length > 0 && (
                          <div style={{ marginBottom: 8 }}>
                            {a.projects.map(([proj, min]) => (
                              <div key={proj} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                                <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", minWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={proj}>{proj}</span>
                                <div style={{ flex: 1, height: 4, background: "var(--bg-3, #1a2335)", borderRadius: 2 }}>
                                  <div style={{ width: Math.round((min / (a.projects[0][1] || 1)) * 100) + "%", height: "100%", background: "var(--c-green)", borderRadius: 2 }} />
                                </div>
                                <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", minWidth: 36 }}>{fmtDuration(min)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {(!editingOnly ? a.sessions : a.sessions.filter(s => s.activeMs > 0)).slice(0, 5).map((s, i) => (
                          <div key={i} style={{ display: "flex", gap: 8, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", marginBottom: 2 }}>
                            <span>{new Date(s.start).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })} – {new Date(s.end).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                            <span style={{ color: "var(--c-cyan)" }}>{fmtDuration(s.ms / 60000)}</span>
                            <span style={{ color: "var(--fg-dim)" }}>{fmtDuration(s.activeMs / 60000)} editing</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* ── WEEK VIEW ── */}
          {viewMode === "week" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <button onClick={() => setWeekOffset(o => o - 1)} style={{ background: "none", border: "1px solid var(--line-hard)", borderRadius: 3, color: "var(--fg-dim)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "3px 8px", cursor: "pointer" }}>← Prev</button>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg)", flex: 1, textAlign: "center" }}>{weekLabel}</span>
                <button onClick={() => setWeekOffset(o => Math.min(0, o + 1))} disabled={weekOffset >= 0} style={{ background: "none", border: "1px solid var(--line-hard)", borderRadius: 3, color: "var(--fg-dim)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "3px 8px", cursor: weekOffset >= 0 ? "default" : "pointer", opacity: weekOffset >= 0 ? 0.4 : 1 }}>Next →</button>
              </div>
              {calLoading && <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", marginBottom: 8 }}>Loading…</div>}
              {/* Day columns header */}
              <div style={{ display: "grid", gridTemplateColumns: `80px repeat(7, 1fr)`, gap: 2, marginBottom: 4 }}>
                <div />
                {weekDays.map(d => {
                  const key = d.toISOString().slice(0, 10);
                  const isToday = key === today;
                  return (
                    <div key={key} style={{ textAlign: "center", fontFamily: "var(--f-mono)", fontSize: 9, color: isToday ? "var(--c-cyan)" : "var(--fg-dim)" }}>
                      {d.toLocaleDateString("en-US", { weekday: "short" })}
                      <br />
                      {d.getDate()}
                    </div>
                  );
                })}
              </div>
              {/* Team member rows */}
              {teamMembers.map(person => (
                <div key={person.id} style={{ display: "grid", gridTemplateColumns: `80px repeat(7, 1fr)`, gap: 2, marginBottom: 3 }}>
                  <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 11 }}>{person.avatar || "👤"}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{person.short || person.name}</span>
                  </div>
                  {weekDays.map(d => {
                    const key = d.toISOString().slice(0, 10);
                    const a = calData[key]?.[person.id];
                    const min = a?.totalMin || 0;
                    return (
                      <div key={key} title={min > 0 ? `${fmtDuration(min)} (${fmtDuration(a?.activeMin || 0)} editing)` : "No activity"} style={{
                        height: 28, borderRadius: 3,
                        background: cellColor(min),
                        border: "1px solid var(--line-hard)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {min > 0 && <span style={{ fontFamily: "var(--f-mono)", fontSize: 8, color: min >= 30 ? "#fff" : "var(--fg-dim)" }}>{Math.round(min)}m</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
              {/* Total row */}
              <div style={{ display: "grid", gridTemplateColumns: `80px repeat(7, 1fr)`, gap: 2, marginTop: 6, borderTop: "1px solid var(--line-hard)", paddingTop: 4 }}>
                <div style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--fg-dim)", display: "flex", alignItems: "center" }}>Total</div>
                {weekDays.map(d => {
                  const key = d.toISOString().slice(0, 10);
                  const tot = dayTotal(key);
                  return (
                    <div key={key} style={{ textAlign: "center", fontFamily: "var(--f-mono)", fontSize: 9, color: tot > 0 ? "var(--c-cyan)" : "var(--fg-dim)" }}>
                      {tot > 0 ? fmtDuration(tot) : "—"}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ── MONTH VIEW ── */}
          {viewMode === "month" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <button onClick={() => setMonthOffset(o => o - 1)} style={{ background: "none", border: "1px solid var(--line-hard)", borderRadius: 3, color: "var(--fg-dim)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "3px 8px", cursor: "pointer" }}>← Prev</button>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg)", flex: 1, textAlign: "center" }}>{monthLabel}</span>
                <button onClick={() => setMonthOffset(o => Math.min(0, o + 1))} disabled={monthOffset >= 0} style={{ background: "none", border: "1px solid var(--line-hard)", borderRadius: 3, color: "var(--fg-dim)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "3px 8px", cursor: monthOffset >= 0 ? "default" : "pointer", opacity: monthOffset >= 0 ? 0.4 : 1 }}>Next →</button>
              </div>
              {calLoading && <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", marginBottom: 8 }}>Loading…</div>}
              {/* Calendar grid: 7 columns (Mon–Sun), with day-of-week offset */}
              {(() => {
                const firstDow = monthDays[0]?.getDay() ?? 1; // 0=Sun
                const padStart = firstDow === 0 ? 6 : firstDow - 1; // Mon-based offset
                const cells = [...Array(padStart).fill(null), ...monthDays];
                return (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
                      {["Mo","Tu","We","Th","Fr","Sa","Su"].map(d => (
                        <div key={d} style={{ textAlign: "center", fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--fg-dim)" }}>{d}</div>
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
                      {cells.map((d, i) => {
                        if (!d) return <div key={"pad" + i} />;
                        const key = d.toISOString().slice(0, 10);
                        const isToday = key === today;
                        const tot = dayTotal(key);
                        const perPerson = calData[key] || {};
                        const tooltip = Object.entries(perPerson)
                          .map(([pid, a]) => {
                            const p = teamMembers.find(m => m.id === pid);
                            return `${p?.short || pid}: ${fmtDuration(a.totalMin)}`;
                          }).join("\n") || "No activity";
                        return (
                          <div key={key} title={tooltip} style={{
                            height: 34, borderRadius: 3, padding: "2px 3px",
                            background: cellColor(tot),
                            border: isToday ? "1px solid var(--c-cyan)" : "1px solid var(--line-hard)",
                            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                            cursor: "default",
                          }}>
                            <span style={{ fontFamily: "var(--f-mono)", fontSize: 8, color: isToday ? "var(--c-cyan)" : "var(--fg-dim)", lineHeight: 1 }}>{d.getDate()}</span>
                            {tot > 0 && <span style={{ fontFamily: "var(--f-mono)", fontSize: 7, color: tot >= 60 ? "#fff" : "var(--fg-dim)", marginTop: 1 }}>{Math.round(tot)}m</span>}
                          </div>
                        );
                      })}
                    </div>
                    {/* Legend */}
                    <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
                      {teamMembers.map(p => {
                        const totalForMonth = monthDays.reduce((s, d) => s + (calData[d.toISOString().slice(0,10)]?.[p.id]?.totalMin || 0), 0);
                        return totalForMonth > 0 ? (
                          <span key={p.id} style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)" }}>
                            {p.avatar} {p.short}: {fmtDuration(totalForMonth)}
                          </span>
                        ) : null;
                      })}
                    </div>
                  </>
                );
              })()}
            </>
          )}
        </div>
      );

  return embedded ? body : (
    <div className="card" style={{ marginBottom: 16 }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", userSelect: "none" }}
        onClick={() => setExpanded(o => !o)}
      >
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: 0.6, flex: 1 }}>
          CapCut Team Activity
        </span>
        {!expanded && <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-dim)" }}>{summaryLine}</span>}
        <span style={{ color: "var(--fg-dim)", fontSize: 12 }}>{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded && body}
    </div>
  );
}

function OwnerQuickCards({ onNavigate, inReviewCount, reels }) {
  const connections = useMemo(() => getConnections(), []);
  const connectedCount = connections.filter(c => c.connected).length;
  const totalFollowers = connections.reduce((s, c) => s + (c.connected ? (c.followers || 0) : 0), 0);

  const activeReels = reels.filter(r => !r.archivedAt && r.stage !== "posted").length;
  const postedReels = reels.filter(r => r.stage === "posted").length;

  const fmtNum = (n) => {
    if (!n) return "0";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(n);
  };

  return (
    <div className="ow-summary-grid">
      <div
        className="ow-card"
        role="button" tabIndex={0}
        onClick={() => onNavigate?.("analytics")}
        onKeyDown={e => e.key === "Enter" && onNavigate?.("analytics")}
      >
        <div className="ow-card-label">Social Reach</div>
        <div className="ow-card-big">{fmtNum(totalFollowers)}</div>
        <div className="ow-card-sub">combined followers · {connectedCount}/{PLATFORMS.length} connected</div>
        <div className="ow-card-platforms">
          {connections.map(c => {
            const p = PLATFORMS.find(pl => pl.key === c.platform);
            return (
              <span key={c.platform} className="ow-plat-glyph"
                style={{ color: c.connected ? (p?.color || "var(--fg)") : "var(--fg-faint)" }}
                title={p?.label + (c.connected ? " · connected" : " · not connected")}
              >
                {p?.glyph || "?"}
              </span>
            );
          })}
        </div>
        <div className="ow-card-link">view analytics →</div>
      </div>

      <div
        className={"ow-card" + (inReviewCount > 0 ? " is-warn" : "")}
        role="button" tabIndex={0}
        onClick={() => onNavigate?.("pipeline")}
        onKeyDown={e => e.key === "Enter" && onNavigate?.("pipeline")}
      >
        <div className="ow-card-label">Pipeline</div>
        <div className={"ow-card-big" + (inReviewCount > 0 ? " is-warn" : "")}>{inReviewCount}</div>
        <div className="ow-card-sub">in review · {activeReels} active · {postedReels} posted</div>
        <div className="ow-card-link">view pipeline →</div>
      </div>

      <div
        className="ow-card"
        role="button" tabIndex={0}
        onClick={() => onNavigate?.("inbox")}
        onKeyDown={e => e.key === "Enter" && onNavigate?.("inbox")}
      >
        <div className="ow-card-label">Inbox</div>
        <div className="ow-card-big" style={{ fontSize: 20, color: "var(--fg-mute)", paddingTop: 6 }}>→</div>
        <div className="ow-card-sub">messages &amp; comments</div>
        <div className="ow-card-link">view inbox →</div>
      </div>
    </div>
  );
}

// ── Promoted insights from the AI Brain Workflow Intelligence Log ──────────────
const INSIGHT_CAT_COLORS = {
  code_change: "#ef4444", workflow_change: "#3b82f6", feature_request: "#10b981",
  bug: "#f59e0b", process: "#8b5cf6",
};
const INSIGHT_CAT_LABELS = {
  code_change: "Code change", workflow_change: "Workflow", feature_request: "Feature",
  bug: "Bug", process: "Process",
};

function PromotedInsightsSection({ onNavigate }) {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("workflow_insights")
      .select("id, category, summary, tags, priority, promoted_at")
      .eq("status", "promoted")
      .order("promoted_at", { ascending: false })
      .limit(20);
    setItems(data || []);
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  const clearOne = async (id) => {
    setItems(prev => prev.filter(i => i.id !== id));
    await supabase.from("workflow_insights").update({ status: "noted" }).eq("id", id);
  };

  const copyOne = async (text) => {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be blocked */ }
  };

  // Hide the section entirely when there's nothing promoted (keeps the board clean).
  if (loaded && items.length === 0) return null;

  return (
    <div id="ow-promoted-insights">
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10, borderBottom: "1px solid var(--line-hard)", paddingBottom: 8,
      }}>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Promoted Insights
        </span>
        <span
          style={{ fontSize: 11, fontFamily: "var(--f-mono)", color: "var(--c-cyan)", cursor: "pointer" }}
          onClick={() => onNavigate?.("ai")}
          title="Open the AI Brain Insights tab"
        >
          {items.length} pinned · open AI Brain →
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map(it => {
          const color = INSIGHT_CAT_COLORS[it.category] || "#6b7280";
          return (
            <div key={it.id} style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              border: "1px solid var(--line-hard)", borderLeft: `3px solid ${color}`,
              borderRadius: 6, padding: "10px 12px",
            }}>
              <span style={{
                background: color + "22", color, border: `1px solid ${color}55`,
                borderRadius: 4, padding: "1px 7px", fontSize: 11, fontWeight: 600,
                whiteSpace: "nowrap", marginTop: 1,
              }}>{INSIGHT_CAT_LABELS[it.category] || it.category}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{it.summary}</div>
                {it.tags?.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                    {it.tags.map(t => (
                      <span key={t} style={{ fontSize: 10, fontFamily: "var(--f-mono)", color: "var(--fg-dim)", background: "var(--surface2, #1a1a22)", padding: "1px 6px", borderRadius: 3, border: "1px solid var(--line-hard)" }}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => copyOne(it.summary)} title="Copy"
                  style={{ background: "transparent", border: "1px solid var(--line-hard)", color: "var(--fg-dim)", borderRadius: 4, fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>
                  Copy
                </button>
                <button onClick={() => clearOne(it.id)} title="Done — remove from board"
                  style={{ background: "transparent", border: "1px solid var(--c-green, #34d399)", color: "var(--c-green, #34d399)", borderRadius: 4, fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>
                  Clear
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* One collapsible cell inside the combined Team-stats row (Task D). The header
   bar is the toggle; the body (the underlying stats widget) mounts only while
   open, which also preserves CapCutTeamWidget's lazy data-load. */
function StatPanel({ title, icon, summary, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ts-panel" data-open={open ? "1" : "0"}>
      <button type="button" className="ts-panel-head" onClick={() => setOpen(o => !o)}>
        <span className="ts-panel-icon" aria-hidden="true">{icon}</span>
        <span className="ts-panel-title">{title}</span>
        {!open && summary && <span className="ts-panel-summary">{summary}</span>}
        <span className="ts-panel-chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="ts-panel-body">{children}</div>}
    </div>
  );
}

/* Task D — combines Team Skill Overlay (spider), Team training progress, and
   CapCut team activity into a single horizontal, scrollable row of expandable
   panels (replaces the three stacked widgets + the old Team Status section). */
function TeamStatsRow({ roster, me, onSetPerson, onNavigate }) {
  const { gamifyEnabled } = useWorkflow();
  const teamMembers = useMemo(() => (roster || []).filter(p => p.role !== "owner"), [roster]);
  return (
    <div className="ts-row">
      {gamifyEnabled && (
        <StatPanel title="Team Skills" icon="📊" defaultOpen
                   summary={`${teamMembers.length} member${teamMembers.length === 1 ? "" : "s"}`}>
          <OwnerSkillOverlay bare />
        </StatPanel>
      )}
      <StatPanel title="Training" icon="🎓"
                 summary={`${teamMembers.length} editor${teamMembers.length === 1 ? "" : "s"}`}>
        <TrainingProgressWidget
          personId={me}
          isOwner
          bare
          roster={roster}
          onOpenPerson={(pid) => { onSetPerson?.(pid); onNavigate?.("training"); }}
        />
      </StatPanel>
      <StatPanel title="CapCut Activity" icon="🎬">
        <CapCutTeamWidget teamMembers={teamMembers} embedded />
      </StatPanel>
    </div>
  );
}

function OwnerDashboard({ me, onOpen, onNavigate, onSetPerson }) {
  const { reels } = useWorkflow();
  const { person } = useAuth();
  const { peopleList, peopleById } = useRoster();

  const inReview  = useMemo(() => reels.filter(r => r.stage === "review" && !r.archivedAt), [reels]);

  /* Review queue grouped by submitting editor — drives the by-editor columns
     (Task C). Each editor gets a column of their in-review reels to accept /
     reject / comment on. */
  const reviewGroups = useMemo(() => {
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

  const attentionCount = inReview.length;

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const isOwner = useIsOwner();
  const viewerPersonId = person?.id || me;

  return (
    <div className="ow-dashboard">
      <div className="page-head mw-header">
        <div className="titles">
          <h1>My work — {peopleById[me]?.short || "Paul"} · owner</h1>
          <div className="sub">
            {attentionCount > 0
              ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need your attention.`
              : "All clear — nothing urgent right now."}
          </div>
        </div>
        <div className="actions">
          <DPill onClick={() => window.location.assign("/space")} title="Switch to the 3D Space view — alternate owner homepage">
            ▦ 3D Space
          </DPill>
          {me && (
            <DPill onClick={() => downloadCapcutTracker(me)} title="Download CapCut tracker zip — unzip and run install.bat">
              ↓ CapCut tracker setup
            </DPill>
          )}
        </div>
      </div>

      <div className="mw-rail" style={{ padding: "0 22px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <OwnerQuickCards onNavigate={onNavigate} inReviewCount={attentionCount} reels={reels} />
        <TeamStatsRow roster={peopleList} me={me} onSetPerson={onSetPerson} onNavigate={onNavigate} />
        <PromotedInsightsSection onNavigate={onNavigate} />

        <div id="ow-review-queue">
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 10, borderBottom: "1px solid var(--line-hard)", paddingBottom: 8,
          }}>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Review Queue
            </span>
            <span style={{ fontSize: 11, fontFamily: "var(--f-mono)", color: inReview.length > 0 ? "var(--c-amber)" : "var(--fg-dim)" }}>
              {inReview.length} waiting · {reviewGroups.length} editor{reviewGroups.length === 1 ? "" : "s"}
            </span>
          </div>
          {inReview.length === 0 ? (
            <div style={{
              border: "1px dashed var(--line-hard)", borderRadius: 6,
              padding: 20, textAlign: "center", color: "var(--fg-dim)", fontSize: 13,
            }}>
              Review queue is clear.
            </div>
          ) : (
            <div className="rq-columns">
              {reviewGroups.map(({ ownerId, submitter, cards }) => (
                <div className="rq-col" key={ownerId}>
                  <div className="rq-col-head">
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
                      marginLeft: "auto", fontSize: 10.5, color: "var(--c-cyan)",
                      fontFamily: "var(--f-mono)",
                      background: "rgba(107,214,224,0.08)",
                      border: "1px dashed rgba(107,214,224,0.3)",
                      padding: "1px 8px", borderRadius: 10,
                    }}>
                      {cards.length} reel{cards.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="rq-col-body">
                    {cards.map(r => <ReviewRow key={r.id} reel={r} onOpen={onOpen} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div id="ow-open-tasks">
          <DailyTasksSection
            personId={me}
            viewerPersonId={viewerPersonId}
            isOwner={isOwner}
          />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
/* Review queue dashboard — Paul + Leroy                   */
/* ─────────────────────────────────────────────────────── */

function ReviewQueueWork({ me, onOpen }) {
  const { reels } = useWorkflow();
  const { person } = useAuth();
  const { peopleById } = useRoster();
  const inReview = reels.filter(r => r.stage === "review" && !r.archivedAt);
  const viewedPerson = (me && peopleById[me]) || person;
  const heading = viewedPerson?.name || "Reviewer";
  const isOwner = useIsOwner();
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
      <div className="page-head mw-header">
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
            <DPill onClick={() => downloadCapcutTracker(me)} title="Download CapCut tracker zip — unzip and run install.bat">
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
          <DailyTasksSection
            personId={me}
            viewerPersonId={viewerPersonId}
            isOwner={isOwner}
          />
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

function WorkCard({ reel, onOpen, clipCount }) {
  const { peopleById } = useRoster();
  const { gamifyEnabled, gamifyRubrics } = useWorkflow();

  // Gamify: XP this reel awards (skills it practices).
  const skillTags = reel.skill_tags || [];
  const earnedXp = gamifyEnabled
    ? skillTags.reduce((sum, k) => {
        const row = gamifyRubrics.find(r =>
          r.reelId === reel.id && r.personId === reel.owner && r.skillKey === k);
        return sum + (row?.xpAwarded || 0);
      }, 0)
    : 0;
  const previewXp = maxXpForSkills(skillTags);
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
    <div className={"work-card sol-card stage-" + (reel.stage || "not-started")}
         onClick={() => onOpen({ id: reel.id, title: reel.title })}
         style={{ cursor: "pointer" }}>
      <div className="wc-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div className="mono dim sol-card-meta">{reel.id}</div>
          <div className="serif-i sol-card-title" style={{ fontSize: 17, color: "#eef3fb", marginTop: 2 }}>
            {reel.title}
          </div>
        </div>
        {gamifyEnabled && skillTags.length > 0 && (
          <span className="gf-exp-badge" title={earnedXp > 0 ? "XP earned on this reel" : "XP available if completed"}>
            {earnedXp > 0 ? `${earnedXp} XP` : `+${previewXp}`}
          </span>
        )}
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

    </div>
  );
}

function EmptyLane({ label }) {
  return <div className="mw-empty">{label}</div>;
}

export { MyWork };
