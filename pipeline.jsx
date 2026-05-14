/* =========================================================
   Pipeline Board — owner lanes (rows) × workflow stage (cols)
   ========================================================= */

import React, { useState, useMemo } from "react";
import { DPill, ReelCard } from "./components.jsx";
import { useWorkflow } from "./store.jsx";

const PIPELINE_STAGES = [
  { key: "not_started", label: "NOT STARTED" },
  { key: "in_progress", label: "IN PROGRESS" },
  { key: "review",      label: "REVIEW"      },
  { key: "completed",   label: "COMPLETED"   },
  { key: "posted",      label: "POSTED"      },
];

const LANES = [
  { id: "alex", name: "Judy Adawag",  role: "Skilled editor" },
  { id: "paul", name: "Paul Victor",  role: "Owner / Creative Director" },
  { id: "sam",  name: "Jay",          role: "Variant editor" },
  { id: "review", name: "Leroy Crosby", role: "Reviewer" },
];

function Pipeline({ onOpen }) {
  const { reels, reviewLaneCards, actions } = useWorkflow();
  const [filter, setFilter] = useState("all");
  const [dragging, setDragging] = useState(null); // reel record being dragged
  const [dropTarget, setDropTarget] = useState(null); // "lane::stage"
  /* Multi-select: cards added via Cmd/Ctrl/Shift+click. Dragging
     any one of the selected cards moves the whole group; click
     (no modifier) opens the detail view as before and clears
     the selection. */
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  /* Board items = canonical reels + Maya's shadow cards. Lane is
     derived from owner unless the record carries an explicit lane
     (the shadow cards do). */
  const items = useMemo(() =>
    [...reels, ...reviewLaneCards]
      .filter(r => !r.archivedAt)
      .map(r => ({ ...r, lane: r.lane || r.owner })),
    [reels, reviewLaneCards]
  );

  /* Build cell index → reels (filtered) */
  const cells = useMemo(() => {
    const m = {};
    items.forEach(r => {
      if (filter === "blocked" && !(r.state === "block" || r.state === "warn")) return;
      const k = r.lane + "::" + r.stage;
      (m[k] = m[k] || []).push(r);
    });
    return m;
  }, [items, filter]);

  const handleDrop = (lane, stage) => {
    if (!dragging) return;
    /* If the dragged card is part of the selection, move all
       selected cards together; otherwise move just the dragged
       card. After a group move we clear selection. */
    const groupMove = selectedIds.size > 1 && selectedIds.has(dragging.id);
    if (groupMove) {
      for (const id of selectedIds) {
        actions.moveStage(id, { lane, stage });
      }
      setSelectedIds(new Set());
    } else {
      actions.moveStage(dragging.id, { lane, stage });
    }
    setDragging(null);
    setDropTarget(null);
  };

  /* Card click: with modifier → toggle in selection (no detail);
     without modifier → open detail and clear selection. */
  const handleCardClick = (reel, e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      e.stopPropagation();
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(reel.id)) next.delete(reel.id);
        else next.add(reel.id);
        return next;
      });
      return;
    }
    if (selectedIds.size > 0) setSelectedIds(new Set());
    onOpen(reel);
  };

  const clearSelection = () => setSelectedIds(new Set());

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Pipeline</h1>
          <div className="sub">
            Rows = who owns it. Columns = where it is. Drag to move.
          </div>
        </div>
        <div className="actions">
          <DPill active={filter === "all"} onClick={() => setFilter("all")}>All reels</DPill>
          <DPill active={filter === "blocked"} onClick={() => setFilter("blocked")} tone="red">Blocked / warn</DPill>
        </div>
      </div>

      {/* Board grid */}
      <div className="board">
        {/* Column heads (offset by lane gutter) */}
        <div className="col-head" style={{ background: "var(--bg-0)" }}>
          <div className="lbl">OWNER / ROLE</div>
          <div className="meta">Rows = who has what.</div>
          <div className="meta">Columns = where it is.</div>
        </div>
        {PIPELINE_STAGES.map(s => {
          const count = items.filter(r => r.stage === s.key).length;
          return (
            <div className="col-head" key={s.key}>
              <div className="lbl">{s.label}</div>
              <div className="meta">{count} reel{count === 1 ? "" : "s"}</div>
            </div>
          );
        })}

        {/* Lanes */}
        {LANES.map(lane => {
          const laneCount = items.filter(r => r.lane === lane.id).length;
          return (
          <React.Fragment key={lane.id}>
            <div className="lane-head">
              <div className="role">{lane.role}</div>
              <div className="name">{lane.name}</div>
              <div className="stats">{laneCount} reel{laneCount === 1 ? "" : "s"}</div>
            </div>
            {PIPELINE_STAGES.map(stage => {
              const reels = cells[lane.id + "::" + stage.key] || [];
              const targetKey = lane.id + "::" + stage.key;
              const isTarget = dropTarget === targetKey;
              return (
                <div
                  className={
                    "cell" +
                    (reels.length === 0 ? " empty" : "") +
                    (isTarget ? " drop-target" : "")
                  }
                  key={stage.key}
                  onDragOver={e => {
                    if (!dragging) return;
                    e.preventDefault();
                    if (dropTarget !== targetKey) setDropTarget(targetKey);
                  }}
                  onDragLeave={() => {
                    if (dropTarget === targetKey) setDropTarget(null);
                  }}
                  onDrop={e => {
                    e.preventDefault();
                    handleDrop(lane.id, stage.key);
                  }}
                >
                  {reels.map(r => {
                    const isSelected = selectedIds.has(r.id);
                    const groupActive = isSelected && selectedIds.size > 1;
                    const isThisDrag = dragging && dragging.id === r.id;
                    const isInGroupDrag = dragging && selectedIds.has(dragging.id) && selectedIds.size > 1 && isSelected;
                    return (
                      <div
                        key={r.id}
                        draggable
                        onDragStart={e => {
                          setDragging(r);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => { setDragging(null); setDropTarget(null); }}
                        className={isThisDrag ? "is-drag-wrap" : ""}
                        style={{
                          opacity: isThisDrag || isInGroupDrag ? 0.4 : 1,
                        }}
                      >
                        <ReelCard
                          reel={r}
                          state={r.state}
                          isSelected={isSelected}
                          onOpen={(reel, e) => handleCardClick(reel, e || {})}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </React.Fragment>
          );
        })}
      </div>

      {/* Floating multi-select chip — appears whenever any cards
          are selected. Drag any selected card to move the group. */}
      {selectedIds.size > 0 && (
        <div className="multiselect-chip">
          <span className="ms-count">{selectedIds.size}</span>
          <span className="ms-label">selected · drag any to move the group</span>
          <a href="#" className="ms-clear"
             onClick={e => { e.preventDefault(); clearSelection(); }}>clear</a>
        </div>
      )}
    </div>
  );
}

export { Pipeline };
