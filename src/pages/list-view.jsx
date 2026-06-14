/* =========================================================
   List View — dense operational table with inline editing,
   per-column filters, bulk actions, status dots, and a
   schedule modal for posting.
   ========================================================= */

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { DPill } from "../components/components.jsx";
import { useWorkflow } from "../store/store.jsx";
import { useNow, formatAge, formatDue } from "../lib/time.jsx";
import { ROLES, STAGES, STAGE_LABEL, STAGE_TONE } from "../lib/shared-data.jsx";
import { useRoster } from "../lib/roster.jsx";
import { usePermissions } from "../lib/permissions.jsx";

/* ---------- helpers ---------- */
function fmtId(reel) {
  if (reel.displayNumber != null) return String(reel.displayNumber).padStart(3, "0");
  return reel.id ? reel.id.slice(-5) : "—";
}

const STAGE_DOT_COLOR = {
  not_started: "var(--c-cyan)",
  in_progress: "var(--c-amber)",
  review:      "var(--c-red)",
  completed:   "var(--c-green)",
  posted:      "var(--c-grey)",
};

// Named tone → CSS variable (matches CARD_COLORS in components.jsx)
const TONE_DOT_COLOR = {
  cyan:   "var(--c-cyan)",
  violet: "var(--c-violet)",
  green:  "var(--c-green)",
  amber:  "var(--c-amber)",
  red:    "var(--c-red)",
  blue:   "var(--c-blue)",
  orange: "var(--c-orange)",
  pink:   "var(--c-pink)",
};

// 8 tone names for the status dot color picker (matches card picker in detail.jsx)
const TONE_NAMES = ["cyan", "violet", "green", "amber", "red", "blue", "orange", "pink"];

/* ---- StatusDot with color-picker popover ---- */
function StatusDot({ reel, onColorPick, dotPopover, setDotPopover }) {
  const dotRef = useRef(null);
  const popRef = useRef(null);
  // Priority: explicit tone (card color) > stage default
  const color = TONE_DOT_COLOR[reel.tone] || STAGE_DOT_COLOR[reel.stage] || "var(--c-grey)";
  const open   = dotPopover === reel.id;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (
        dotRef.current  && !dotRef.current.contains(e.target) &&
        popRef.current  && !popRef.current.contains(e.target)
      ) {
        setDotPopover(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, setDotPopover]);

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <span
        ref={dotRef}
        onClick={e => { e.stopPropagation(); setDotPopover(open ? null : reel.id); }}
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: color,
          marginRight: 6,
          cursor: "pointer",
          flexShrink: 0,
          border: "1px solid rgba(255,255,255,0.15)",
        }}
        title="Click to change status color"
      />
      {open && (
        <span
          ref={popRef}
          onClick={e => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 16,
            left: 0,
            zIndex: 999,
            background: "var(--bg-card, #1e2433)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 6,
            padding: "6px 8px",
            display: "flex",
            gap: 5,
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          }}
        >
          {TONE_NAMES.map(t => (
            <span
              key={t}
              onClick={() => { onColorPick(reel.id, t); setDotPopover(null); }}
              title={t}
              style={{
                display: "inline-block",
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: TONE_DOT_COLOR[t],
                cursor: "pointer",
                border: reel.tone === t ? "2px solid #fff" : "2px solid transparent",
              }}
            />
          ))}
        </span>
      )}
    </span>
  );
}

/* ---- Inline editable text cell ---- */
function EditableCell({ value, onCommit, children, style }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState("");
  const inputRef = useRef(null);

  function startEdit(e) {
    e.stopPropagation();
    setDraft(value || "");
    setEditing(true);
  }
  function commit() {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  }
  function handleKey(e) {
    if (e.key === "Enter")  { e.preventDefault(); commit(); }
    if (e.key === "Escape") { setEditing(false); }
  }

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%",
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 4,
          color: "var(--fg, #eef3fb)",
          padding: "2px 6px",
          fontSize: 13.5,
          ...style,
        }}
      />
    );
  }
  return (
    <span onDoubleClick={startEdit} style={{ cursor: "text", ...style }}>
      {children}
    </span>
  );
}

/* ---- Inline editable number cell ---- */
function EditableNumberCell({ value, onCommit, children, allowed }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState("");
  const inputRef = useRef(null);

  function startEdit(e) {
    if (!allowed) return;
    e.stopPropagation();
    setDraft(value != null ? String(value) : "");
    setEditing(true);
  }
  function commit() {
    setEditing(false);
    const n = Number(draft);
    if (!isNaN(n) && n !== value) onCommit(n);
  }
  function handleKey(e) {
    if (e.key === "Enter")  { e.preventDefault(); commit(); }
    if (e.key === "Escape") { setEditing(false); }
  }

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
        onClick={e => e.stopPropagation()}
        style={{
          width: 70,
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 4,
          color: "var(--fg, #eef3fb)",
          padding: "2px 6px",
          fontSize: 13,
        }}
      />
    );
  }
  return (
    <span
      onDoubleClick={startEdit}
      title={allowed ? "Double-click to edit" : undefined}
      style={{ cursor: allowed ? "text" : "default" }}
    >
      {children}
    </span>
  );
}

/* ---- Schedule Modal ---- */
function ScheduleModal({ onConfirm, onCancel, date, setDate }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1200,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-card, #1e2433)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 10,
          padding: "28px 32px",
          minWidth: 320,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16, color: "var(--fg, #eef3fb)" }}>
          Schedule post date
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, color: "var(--fg-mute, #8899aa)", display: "block", marginBottom: 6 }}>
            Post date
          </label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 6,
              color: "var(--fg, #eef3fb)",
              padding: "6px 10px",
              fontSize: 14,
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "6px 16px", borderRadius: 6,
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "var(--fg-mute, #8899aa)",
              cursor: "pointer", fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "6px 16px", borderRadius: 6,
              background: "var(--c-ok, #22c55e)",
              border: "none",
              color: "#fff",
              cursor: "pointer", fontSize: 13, fontWeight: 600,
            }}
          >
            Confirm &amp; post
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Bulk action bar ---- */
function BulkBar({ count, onClear, onApply, peopleList }) {
  const [bulkStage, setBulkStage]    = useState("");
  const [bulkPerson, setBulkPerson]  = useState("");

  const selStyle = {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 5,
    color: "var(--fg, #eef3fb)",
    padding: "4px 8px",
    fontSize: 12.5,
    cursor: "pointer",
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      padding: "8px 14px",
      background: "rgba(59,130,246,0.12)",
      border: "1px solid rgba(59,130,246,0.25)",
      borderRadius: 7,
      marginBottom: 10,
    }}>
      <span style={{ fontSize: 13, color: "var(--fg, #eef3fb)", fontWeight: 600 }}>
        {count} selected
      </span>
      <span style={{ color: "var(--fg-mute, #8899aa)", fontSize: 12 }}>·</span>

      <span style={{ fontSize: 12, color: "var(--fg-mute, #8899aa)" }}>Move to:</span>
      <select
        value={bulkStage}
        onChange={e => setBulkStage(e.target.value)}
        style={selStyle}
      >
        <option value="">— stage —</option>
        {STAGES.map(s => (
          <option key={s} value={s}>{STAGE_LABEL[s]}</option>
        ))}
      </select>

      <span style={{ color: "var(--fg-mute, #8899aa)", fontSize: 12, marginLeft: 6 }}>Assign to:</span>
      <select
        value={bulkPerson}
        onChange={e => setBulkPerson(e.target.value)}
        style={selStyle}
      >
        <option value="">— person —</option>
        {peopleList.map(p => (
          <option key={p.id} value={p.id}>{p.short || p.name}</option>
        ))}
      </select>
      <button
        disabled={!bulkStage && !bulkPerson}
        onClick={() => { onApply(bulkStage, bulkPerson); setBulkStage(""); setBulkPerson(""); }}
        style={{
          ...selStyle,
          background: (bulkStage || bulkPerson) ? "var(--c-cyan, #22d3ee)" : "rgba(255,255,255,0.04)",
          color: (bulkStage || bulkPerson) ? "#000" : "var(--fg-mute, #8899aa)",
          fontWeight: 600,
        }}
      >
        Apply
      </button>

      <button
        onClick={onClear}
        style={{
          marginLeft: "auto",
          ...selStyle,
          color: "var(--c-red, #ef4444)",
          border: "1px solid rgba(239,68,68,0.3)",
        }}
      >
        Clear selection
      </button>
    </div>
  );
}

/* ======================================================= */
/*   Main component                                        */
/* ======================================================= */
function ListView({ role, onOpen }) {
  const { reels, actions } = useWorkflow();
  const { peopleById, peopleList } = useRoster();
  const { can } = usePermissions();
  const now = useNow();

  /* -- sort -- */
  const [sort, setSort] = useState("stage");

  /* -- per-column filter -- */
  const [colFilters, setColFilters] = useState({
    id: "", title: "", stage: "all", assignee: "all", blocker: "", due: "",
  });

  function setFilter(key, val) {
    setColFilters(prev => ({ ...prev, [key]: val }));
  }

  /* -- status dot popover -- */
  const [dotPopover, setDotPopover] = useState(null); // reelId | null

  /* -- schedule modal -- */
  const [scheduleModal, setScheduleModal]  = useState(null); // { reelId } | null
  const [scheduleDate,  setScheduleDate]   = useState("");

  /* -- bulk selection -- */
  const [selected, setSelected] = useState(new Set());
  const canBulk = can("bulkMoveReels");

  /* -- filtered + sorted rows -- */
  const rows = useMemo(() => {
    let arr = reels.filter(r => !r.archivedAt);

    // role filter
    if (role !== "all") arr = arr.filter(r => r.owner === ROLES[role]?.person);

    // per-column filters
    if (colFilters.id) {
      arr = arr.filter(r => fmtId(r).includes(colFilters.id.trim()));
    }
    if (colFilters.title) {
      const q = colFilters.title.toLowerCase();
      arr = arr.filter(r => (r.title || "").toLowerCase().includes(q));
    }
    if (colFilters.stage !== "all") {
      arr = arr.filter(r => r.stage === colFilters.stage);
    }
    if (colFilters.assignee !== "all") {
      arr = arr.filter(r => r.owner === colFilters.assignee);
    }
    if (colFilters.blocker) {
      const q = colFilters.blocker.toLowerCase();
      arr = arr.filter(r => (r.blocker || "").toLowerCase().includes(q));
    }
    if (colFilters.due) {
      arr = arr.filter(r => (r.due || r.dueAt || "").includes(colFilters.due.trim()));
    }

    // sort
    if (sort === "stage") {
      const order = STAGES;
      arr.sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
    } else if (sort === "due") {
      arr.sort((a, b) => (a.due || a.dueAt || "z").localeCompare(b.due || b.dueAt || "z"));
    } else if (sort === "age") {
      arr.sort((a, b) => (b.age || "").localeCompare(a.age || ""));
    }

    return arr;
  }, [reels, role, sort, colFilters]);

  /* -- select all (within current filtered set) -- */
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map(r => r.id)));
    }
  }
  function toggleOne(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /* -- bulk action: applies stage and/or person together so a combined
     reassignment lands in one atomic move per reel. Passing lane=personId
     to moveStage makes the store set stage + owner + lane together, so the
     card shows up in the new person's column on the board and their
     dashboard (not stranded in the old owner's lane). -- */
  function bulkApply(stage, personId) {
    if (stage === "completed" && !can("moveToCompleted")) return;
    const ids = [...selected];
    for (const id of ids) {
      if (stage === "posted") {
        // "posted" needs the schedule-date modal; hand off and let its
        // confirm handler finish the rest of the selection.
        setScheduleModal({ reelId: id, bulk: true, pendingStage: stage, person: personId });
        return;
      }
      if (stage && personId) {
        actions.moveStage(id, { stage, lane: personId });
      } else if (stage) {
        actions.moveStage(id, { stage });
      } else if (personId) {
        actions.updateReel(id, { owner: personId });
      }
    }
    setSelected(new Set());
  }

  /* -- stage dropdown change (per row) -- */
  function handleStageChange(reel, newStage) {
    if (newStage === reel.stage) return;
    if (newStage === "completed" && !can("moveToCompleted")) return;
    if (newStage === "posted") {
      setScheduleModal({ reelId: reel.id });
      setScheduleDate("");
      return;
    }
    actions.moveStage(reel.id, { stage: newStage });
  }

  /* -- schedule modal confirm -- */
  function confirmSchedule() {
    if (!scheduleModal) return;
    // A bulk apply may carry a person reassignment alongside the "posted"
    // move; pass it as `lane` so the card lands in the new owner's row
    // (moveStage sets stage + owner + lane together). Per-row posts and
    // bulk posts without a person reassignment leave lane untouched.
    const person = scheduleModal.person;
    const extra = {
      ...(scheduleDate ? { scheduledPostDate: scheduleDate } : {}),
      ...(person ? { lane: person } : {}),
    };
    actions.moveStage(scheduleModal.reelId, { stage: "posted", ...extra });
    if (scheduleModal.bulk) {
      // continue bulk for remaining ids if needed
      const remaining = [...selected].filter(id => id !== scheduleModal.reelId);
      for (const id of remaining) {
        actions.moveStage(id, { stage: "posted", ...extra });
      }
      setSelected(new Set());
    }
    setScheduleModal(null);
    setScheduleDate("");
  }

  /* -- row click guard: only open card when clicking the TD dead space -- */
  function handleRowClick(e, reel) {
    if (!onOpen) return;
    if (e.target.tagName !== "TD") return;
    onOpen(reel);
  }

  /* -- color pick -- */
  function handleColorPick(reelId, toneName) {
    actions.updateReel(reelId, { tone: toneName });
  }

  /* ---- filter input shared style ---- */
  const filterInputStyle = {
    width: "100%",
    background: "#111827",
    border: "1px solid #2a3754",
    borderRadius: 4,
    color: "#d8e2ee",
    padding: "3px 6px",
    fontSize: 11.5,
    outline: "none",
    boxSizing: "border-box",
    colorScheme: "dark",
  };

  return (
    <div>
      {/* Sort bar — no scope filter chips */}
      <div className="list-filterbar">
        <span style={{ flex: 1 }} />
        <span className="mono muted">sort</span>
        <DPill active={sort === "stage"} onClick={() => setSort("stage")}>Stage</DPill>
        <DPill active={sort === "due"}   onClick={() => setSort("due")}>Due</DPill>
        <DPill active={sort === "age"}   onClick={() => setSort("age")}>Aging</DPill>
        <span className="mono muted">{rows.length} reels</span>
      </div>

      {/* Bulk action bar */}
      {canBulk && selected.size > 0 && (
        <BulkBar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          onApply={bulkApply}
          peopleList={peopleList}
        />
      )}

      <div className="list-scroll">
        <table className="list-table">
          <thead>
            <tr>
              {canBulk && (
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    title="Select all"
                    style={{ cursor: "pointer" }}
                  />
                </th>
              )}
              <th style={{ width: 86 }}>
                <button
                  className={"sort-th" + (sort === "stage" ? " active" : "")}
                  onClick={() => setSort("stage")}
                  style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontWeight: "inherit", fontSize: "inherit" }}
                >
                  ID
                </button>
              </th>
              <th>Reel</th>
              <th style={{ width: 120 }}>Stage</th>
              <th style={{ width: 130 }}>Assignee</th>
              <th>Blocker / waiting on</th>
              <th style={{ width: 110 }}>
                <button
                  className={"sort-th" + (sort === "due" ? " active" : "")}
                  onClick={() => setSort("due")}
                  style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontWeight: "inherit", fontSize: "inherit" }}
                >
                  Due {sort === "due" ? "▲" : ""}
                </button>
              </th>
              <th style={{ width: 110 }}>
                <button
                  className={"sort-th" + (sort === "age" ? " active" : "")}
                  onClick={() => setSort("age")}
                  style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontWeight: "inherit", fontSize: "inherit" }}
                >
                  Aging {sort === "age" ? "▲" : ""}
                </button>
              </th>
              <th style={{ width: 100 }}>Assets</th>
              <th>Next action</th>
            </tr>

            {/* Per-column filter row */}
            <tr style={{ background: "rgba(255,255,255,0.02)" }}>
              {canBulk && <th style={{ padding: "3px 6px" }} />}
              <th style={{ padding: "3px 6px" }}>
                <input
                  type="text"
                  placeholder="ID…"
                  value={colFilters.id}
                  onChange={e => setFilter("id", e.target.value)}
                  style={filterInputStyle}
                />
              </th>
              <th style={{ padding: "3px 6px" }}>
                <input
                  type="text"
                  placeholder="Search title…"
                  value={colFilters.title}
                  onChange={e => setFilter("title", e.target.value)}
                  style={filterInputStyle}
                />
              </th>
              <th style={{ padding: "3px 6px" }}>
                <select
                  value={colFilters.stage}
                  onChange={e => setFilter("stage", e.target.value)}
                  style={filterInputStyle}
                >
                  <option value="all">All stages</option>
                  {STAGES.map(s => (
                    <option key={s} value={s}>{STAGE_LABEL[s]}</option>
                  ))}
                </select>
              </th>
              <th style={{ padding: "3px 6px" }}>
                <select
                  value={colFilters.assignee}
                  onChange={e => setFilter("assignee", e.target.value)}
                  style={filterInputStyle}
                >
                  <option value="all">All people</option>
                  {peopleList.map(p => (
                    <option key={p.id} value={p.id}>{p.short || p.name}</option>
                  ))}
                </select>
              </th>
              <th style={{ padding: "3px 6px" }}>
                <input
                  type="text"
                  placeholder="Blocker…"
                  value={colFilters.blocker}
                  onChange={e => setFilter("blocker", e.target.value)}
                  style={filterInputStyle}
                />
              </th>
              <th style={{ padding: "3px 6px" }}>
                <input
                  type="text"
                  placeholder="Due…"
                  value={colFilters.due}
                  onChange={e => setFilter("due", e.target.value)}
                  style={filterInputStyle}
                />
              </th>
              <th style={{ padding: "3px 6px" }} />
              <th style={{ padding: "3px 6px" }} />
              <th style={{ padding: "3px 6px" }} />
            </tr>
          </thead>

          <tbody>
            {rows.map(reel => (
              <tr
                key={reel.id}
                className={"row " + (reel.state || "")}
                onClick={e => handleRowClick(e, reel)}
                style={{ cursor: "pointer" }}
              >
                {/* Checkbox */}
                {canBulk && (
                  <td onClick={e => e.stopPropagation()} style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={selected.has(reel.id)}
                      onChange={() => toggleOne(reel.id)}
                      style={{ cursor: "pointer" }}
                    />
                  </td>
                )}

                {/* ID — double-click to edit if owner */}
                <td className="id">
                  <EditableNumberCell
                    value={reel.displayNumber}
                    allowed={can("editReelId")}
                    onCommit={n => actions.updateReel(reel.id, { displayNumber: n })}
                  >
                    <span className="mono" style={{ fontSize: 12.5 }}>{fmtId(reel)}</span>
                  </EditableNumberCell>
                </td>

                {/* Title — status dot + editable title */}
                <td>
                  <div style={{ display: "flex", alignItems: "flex-start" }}>
                    <StatusDot
                      reel={reel}
                      onColorPick={handleColorPick}
                      dotPopover={dotPopover}
                      setDotPopover={setDotPopover}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <EditableCell
                        value={reel.title}
                        onCommit={v => actions.updateReel(reel.id, { title: v })}
                      >
                        <span
                          className="serif-i"
                          style={{ fontSize: 14.5, color: "#eef3fb" }}
                          title="Double-click to edit"
                        >
                          {reel.title}
                        </span>
                      </EditableCell>
                      {reel.downstream && (
                        <div className="mono muted" style={{ fontSize: 10.5, marginTop: 3 }}>
                          ↘ {reel.downstream}
                        </div>
                      )}
                    </div>
                  </div>
                </td>

                {/* Stage — inline select */}
                <td onClick={e => e.stopPropagation()}>
                  <select
                    value={reel.stage || "not_started"}
                    onChange={e => handleStageChange(reel, e.target.value)}
                    style={{
                      background: "#111827",
                      border: "1px solid #2a3754",
                      borderRadius: 5,
                      color: "#d8e2ee",
                      padding: "3px 6px",
                      fontSize: 12,
                      cursor: "pointer",
                      width: "100%",
                      colorScheme: "dark",
                    }}
                  >
                    {STAGES.map(s => (
                      <option key={s} value={s}>{STAGE_LABEL[s]}</option>
                    ))}
                  </select>
                </td>

                {/* Assignee — inline select */}
                <td onClick={e => e.stopPropagation()}>
                  <select
                    value={reel.owner || ""}
                    onChange={e => actions.updateReel(reel.id, { owner: e.target.value })}
                    style={{
                      background: "#111827",
                      border: "1px solid #2a3754",
                      borderRadius: 5,
                      color: "#d8e2ee",
                      padding: "3px 6px",
                      fontSize: 12,
                      cursor: "pointer",
                      width: "100%",
                      colorScheme: "dark",
                    }}
                  >
                    <option value="">— unassigned —</option>
                    {peopleList.map(p => (
                      <option key={p.id} value={p.id}>{p.short || p.name}</option>
                    ))}
                  </select>
                </td>

                {/* Blocker */}
                <td>
                  {reel.blocker
                    ? <span style={{ color: reel.state === "block" ? "var(--c-red)" : "var(--c-amber)" }}>{reel.blocker}</span>
                    : <span className="dim">—</span>}
                  {reel.blockerRole && (
                    <div className="mono dim" style={{ marginTop: 3 }}>
                      role-locked · {reel.blockerRole}
                    </div>
                  )}
                </td>

                {/* Due — posted reels show their scheduled post date instead
                    (set by the Move-to-Posted modal; dueAt is the older field) */}
                <td className="mono">
                  {reel.stage === "posted" && reel.scheduledPostDate
                    ? <span style={{ color: "var(--c-cyan)" }} title="Scheduled post date">📅 {reel.scheduledPostDate}</span>
                    : (formatDue(reel, now) || <span className="dim">—</span>)}
                </td>

                {/* Aging */}
                <td className={"mono " + (reel.state === "block" ? "neg" : reel.state === "warn" ? "warn-txt" : "")}>
                  {formatAge(reel, now)}
                </td>

                {/* Assets */}
                <td>
                  <div className="asset-chips">
                    {reel.fb   > 0 && <span className="ac cyan">FB · {reel.fb}</span>}
                    {reel.refs > 0 && <span className="ac">REF · {reel.refs}</span>}
                    {!reel.fb && !reel.refs && <span className="dim mono">—</span>}
                  </div>
                </td>

                {/* Next action */}
                <td style={{ color: "var(--fg)" }}>{reel.next || <span className="dim">—</span>}</td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={canBulk ? 11 : 10}
                  style={{ textAlign: "center", padding: "32px 0", color: "var(--fg-mute, #8899aa)", fontSize: 13 }}
                >
                  No reels match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Schedule modal */}
      {scheduleModal && (
        <ScheduleModal
          date={scheduleDate}
          setDate={setScheduleDate}
          onConfirm={confirmSchedule}
          onCancel={() => { setScheduleModal(null); setScheduleDate(""); }}
        />
      )}
    </div>
  );
}

export { ListView };
