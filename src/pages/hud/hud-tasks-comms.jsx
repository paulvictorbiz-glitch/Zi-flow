/* =========================================================
   HUD · TEAM TASKS & COMMS panel
   ---------------------------------------------------------
   A self-contained interactive panel the owner-only 3D "Space"
   HUD mounts for the 'tasks-comms' card (folds in the former
   standalone team-chat + daily-tasks cards). It renders cleanly
   inside BOTH the flat 2D HudModal body AND the pinned HudDock.

   Props (K1 — the ONLY two): { onOpenTab, onClose }
     - onOpenTab(viewKey:string)  -> deep-links to a full tab
     - onClose()                  -> optional-use close hook

   It reads its own hooks internally and NEVER throws past its own
   boundary. Server-side comms calls (Rocket.Chat) are async and
   already error-safe; we still guard defensively.
   ========================================================= */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useWorkflow } from "../../store/store.jsx";
import { useRoster } from "../../lib/roster.jsx";
import { useIsOwner } from "../../lib/permissions.jsx";
import { useAuth } from "../../auth.jsx";
import { shareReelToChannel, fetchRecentTeamMessages } from "../../lib/social-client.js";
import "./hud-tasks-comms.css";

const TODAY = () => new Date().toISOString().slice(0, 10);

function relTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

function reelLabel(r) {
  if (!r) return "Untitled reel";
  const num = r.displayNumber != null ? `#${r.displayNumber} · ` : "";
  const name = (r.title || r.name || r.id || "Untitled reel").toString();
  return `${num}${name}`.slice(0, 60);
}

export function HudTasksCommsPanel({ onOpenTab, onClose }) {
  const wf = useWorkflow() || {};
  const a = wf.actions || {};
  const { peopleList = [], peopleById = {} } = useRoster() || {};
  const isOwner = useIsOwner();
  const { person } = useAuth() || {};
  const ownerId = person?.id || null;

  const today = TODAY();

  /* ---------------- TASKS ---------------- */
  const [viewFilter, setViewFilter] = useState(isOwner ? "all" : (ownerId || "all"));
  const [newAssignee, setNewAssignee] = useState("");
  const [newText, setNewText] = useState("");
  const [newDate, setNewDate] = useState(today);
  const [taskBusy, setTaskBusy] = useState(false);

  // seed the create-row assignee once the roster / auth is known
  useEffect(() => {
    if (newAssignee) return;
    const seed = ownerId || peopleList[0]?.id || "";
    if (seed) setNewAssignee(seed);
  }, [ownerId, peopleList, newAssignee]);

  const tasks = useMemo(() => {
    return (wf.dailyTasks || [])
      .filter((t) => (viewFilter === "all" ? true : t.assignedTo === viewFilter))
      .filter((t) => !t.completed || t.taskDate === today)
      .sort((x, y) => {
        if (x.completed !== y.completed) return x.completed ? 1 : -1;
        const sx = x.sortOrder ?? Infinity;
        const sy = y.sortOrder ?? Infinity;
        if (sx !== sy) return sx - sy;
        return (x.taskDate || "").localeCompare(y.taskDate || "");
      });
  }, [wf.dailyTasks, viewFilter, today]);

  const openCount = tasks.filter((t) => !t.completed).length;

  const addTask = async () => {
    const v = newText.trim();
    const assignee = newAssignee || ownerId || peopleList[0]?.id;
    if (!v || !assignee || taskBusy) return;
    setTaskBusy(true);
    try {
      await a.createDailyTask?.({
        assignedTo: assignee,
        createdBy: ownerId || assignee,
        taskText: v,
        taskDate: newDate || today,
      });
      setNewText("");
    } catch (_) {
      /* optimistic dispatch already ran; never block the UI */
    } finally {
      setTaskBusy(false);
    }
  };

  const toggleTask = (t) => {
    try { a.completeDailyTask?.(t.id, !t.completed); } catch (_) {}
  };
  const removeTask = (t) => {
    try { a.deleteDailyTask?.(t.id); } catch (_) {}
  };
  const renameTask = (t, val) => {
    const next = (val || "").trim();
    if (!next || next === t.taskText) return;
    try { a.updateDailyTask?.(t.id, { taskText: next }); } catch (_) {}
  };

  /* ---------------- COMMS: recent feed ---------------- */
  const [messages, setMessages] = useState([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState("");

  const loadMessages = useCallback(async () => {
    setMsgLoading(true);
    setMsgError("");
    try {
      const res = await fetchRecentTeamMessages({ limit: 30 });
      setMessages(Array.isArray(res?.messages) ? res.messages : []);
    } catch (_) {
      setMsgError("Couldn't load team messages.");
      setMessages([]);
    } finally {
      setMsgLoading(false);
    }
  }, []);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  /* ---------------- COMMS: share-reel composer ---------------- */
  const reels = wf.reels || [];
  const [shareReelId, setShareReelId] = useState("");
  const [shareChannel, setShareChannel] = useState("pipeline");
  const [shareFeedback, setShareFeedback] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareResult, setShareResult] = useState(null); // { ok, url?, error? }

  const shareReel = async () => {
    if (!shareReelId || sharing) return;
    setSharing(true);
    setShareResult(null);
    try {
      const r = await shareReelToChannel({
        reelId: shareReelId,
        feedback: shareFeedback,
        channel: (shareChannel || "pipeline").trim() || "pipeline",
      });
      if (r?.ok) {
        try {
          a.addReelChatRef?.({
            reelId: shareReelId,
            channel: (shareChannel || "pipeline").trim() || "pipeline",
            note: shareFeedback,
            messageUrl: r.message_url,
            createdBy: ownerId,
          });
        } catch (_) {}
        setShareResult({ ok: true, url: r.message_url });
        setShareFeedback("");
      } else {
        setShareResult({ ok: false, error: r?.error || "Send failed." });
      }
    } catch (_) {
      setShareResult({ ok: false, error: "Network error." });
    } finally {
      setSharing(false);
    }
  };

  const nameOf = (id) => peopleById?.[id]?.name || id || "—";

  return (
    <div className="hudtc">
      {/* ================= TASKS ================= */}
      <section className="hudtc-sec">
        <div className="hudtc-head">
          <span className="hudtc-label">DAILY TASKS · {openCount} open</span>
          <div className="hudtc-head-actions">
            <select
              className="hudtc-mini-select"
              value={viewFilter}
              onChange={(e) => setViewFilter(e.target.value)}
              title="Filter by assignee"
            >
              <option value="all">Everyone</option>
              {peopleList.map((p) => (
                <option key={p.id} value={p.id}>{p.name || p.id}</option>
              ))}
            </select>
            <button
              type="button"
              className="hudtc-link"
              onClick={() => onOpenTab?.("mywork")}
              title="Open the My Work tab"
            >
              Open My Work ↗
            </button>
          </div>
        </div>

        <div className="hudtc-tasks">
          {tasks.length === 0 && (
            <div className="hudtc-empty">No tasks{viewFilter === "all" ? "" : ` for ${nameOf(viewFilter)}`} yet.</div>
          )}
          {tasks.map((t) => (
            <div key={t.id} className={`hudtc-task${t.completed ? " is-done" : ""}`}>
              <button
                type="button"
                className="hudtc-check"
                title={t.completed ? "Mark open" : "Complete"}
                onClick={() => toggleTask(t)}
              >
                {t.completed ? "✓" : "○"}
              </button>
              <span
                className="hudtc-task-text"
                title={t.taskText}
                contentEditable={!t.completed}
                suppressContentEditableWarning
                onBlur={(e) => renameTask(t, e.currentTarget.textContent)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                }}
              >
                {t.taskText}
              </span>
              {viewFilter === "all" && (
                <span className="hudtc-task-who" title="Assignee">{nameOf(t.assignedTo)}</span>
              )}
              <button
                type="button"
                className="hudtc-del"
                title="Delete task"
                onClick={() => removeTask(t)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="hudtc-create">
          <select
            className="hudtc-select"
            value={newAssignee}
            onChange={(e) => setNewAssignee(e.target.value)}
            title="Assign to"
          >
            {peopleList.length === 0 && <option value="">—</option>}
            {peopleList.map((p) => (
              <option key={p.id} value={p.id}>{p.name || p.id}</option>
            ))}
          </select>
          <input
            className="hudtc-input"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
            placeholder="New task…"
          />
          <input
            className="hudtc-date"
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            title="Task date"
          />
          <button
            type="button"
            className="hudtc-add"
            onClick={addTask}
            disabled={!newText.trim() || taskBusy || (!newAssignee && !ownerId)}
          >
            Add
          </button>
        </div>
      </section>

      {/* ================= COMMS ================= */}
      <section className="hudtc-sec">
        <div className="hudtc-head">
          <span className="hudtc-label">TEAM CHAT · recent</span>
          <div className="hudtc-head-actions">
            <button
              type="button"
              className="hudtc-link"
              onClick={loadMessages}
              disabled={msgLoading}
              title="Refresh recent messages"
            >
              {msgLoading ? "…" : "Refresh"}
            </button>
            <button
              type="button"
              className="hudtc-link"
              onClick={() => onOpenTab?.("team")}
              title="Open the Team tab"
            >
              Open Team ↗
            </button>
          </div>
        </div>

        <div className="hudtc-feed">
          {msgError && <div className="hudtc-err">{msgError}</div>}
          {!msgError && !msgLoading && messages.length === 0 && (
            <div className="hudtc-empty">No recent messages.</div>
          )}
          {messages.map((m, i) => {
            const url = m.message_url || m.url || null;
            const Row = url ? "a" : "div";
            const rowProps = url
              ? { href: url, target: "_blank", rel: "noreferrer" }
              : {};
            return (
              <Row key={m.id || i} className="hudtc-msg" {...rowProps}>
                <span className="hudtc-msg-sender">{m.sender || m.author || "Someone"}</span>
                {(m.room || m.channel) && (
                  <span className="hudtc-msg-room">#{m.room || m.channel}</span>
                )}
                <span className="hudtc-msg-text">{m.text || "(no text)"}</span>
                <span className="hudtc-msg-time">{relTime(m.ts || m.created_at)}</span>
              </Row>
            );
          })}
        </div>

        {/* Share reel feedback composer */}
        <div className="hudtc-share">
          <div className="hudtc-share-label">Share reel feedback</div>
          <div className="hudtc-share-row">
            <select
              className="hudtc-select hudtc-share-reel"
              value={shareReelId}
              onChange={(e) => setShareReelId(e.target.value)}
              title="Pick a reel"
            >
              <option value="">Pick a reel…</option>
              {reels.map((r) => (
                <option key={r.id} value={r.id}>{reelLabel(r)}</option>
              ))}
            </select>
            <input
              className="hudtc-input hudtc-share-channel"
              value={shareChannel}
              onChange={(e) => setShareChannel(e.target.value)}
              placeholder="channel"
              title="Rocket.Chat channel"
            />
          </div>
          <textarea
            className="hudtc-textarea"
            value={shareFeedback}
            onChange={(e) => setShareFeedback(e.target.value)}
            placeholder="Feedback about this reel…"
            rows={2}
          />
          <div className="hudtc-share-foot">
            {shareResult && shareResult.ok && (
              <span className="hudtc-ok">
                Shared{shareResult.url ? " · " : ""}
                {shareResult.url && (
                  <a href={shareResult.url} target="_blank" rel="noreferrer" className="hudtc-ok-link">view</a>
                )}
              </span>
            )}
            {shareResult && !shareResult.ok && (
              <span className="hudtc-err">{shareResult.error}</span>
            )}
            <span className="hudtc-spacer" />
            <button
              type="button"
              className="hudtc-send"
              onClick={shareReel}
              disabled={!shareReelId || sharing}
            >
              {sharing ? "Sharing…" : "Share"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default HudTasksCommsPanel;
