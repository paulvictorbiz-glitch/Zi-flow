/* =========================================================
   Pipeline Board — owner lanes (rows) × workflow stage (cols)
   ========================================================= */

import React, { useState, useMemo } from "react";
import { DPill, ReelCard } from "../components/components.jsx";
import { useWorkflow } from "../store/store.jsx";
import { STAGES, STAGE_LABEL } from "../lib/shared-data.jsx";
import { useRoster } from "../lib/roster.jsx";

/* Board columns derived from the canonical STAGES list. Labels are
   upper-cased here because the board column heads use that style;
   list-view / archived-view consume STAGE_LABEL as-is (title case). */
const PIPELINE_STAGES = STAGES.map((key) => ({ key, label: STAGE_LABEL[key].toUpperCase() }));

/* Lane row order — skilled editor first, then owner, then variant,
   then anyone else. Reviewers don't get a personal lane; they share
   the special "review" workflow lane appended last. */
const LANE_ROLE_ORDER = { skilled: 0, owner: 1, variant: 2 };

function Pipeline({ onOpen }) {
  const { reels, reviewLaneCards, actions } = useWorkflow();
  const { peopleList } = useRoster();
  const [filter, setFilter] = useState("all");

  /* Board rows, built live from the team roster: one lane per
     non-reviewer member (so a newly-added editor gets their own row),
     plus the shared "review" lane named after the reviewer. */
  const lanes = useMemo(() => {
    const personLanes = peopleList
      .filter(p => p.role !== "reviewer")
      .slice()
      .sort((a, b) => (LANE_ROLE_ORDER[a.role] ?? 9) - (LANE_ROLE_ORDER[b.role] ?? 9))
      .map(p => ({ id: p.id, name: p.name }));
    const reviewer = peopleList.find(p => p.role === "reviewer");
    personLanes.push({ id: "review", name: reviewer?.name || "Reviewer" });
    return personLanes;
  }, [peopleList]);
  const [dragging, setDragging] = useState(null); // reel record being dragged
  const [dropTarget, setDropTarget] = useState(null); // "lane::stage"
  const [dropOnCard, setDropOnCard] = useState(null); // { id, before } — reorder target
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
    // Apply the user's manual order. Cards without a board_order keep their
    // existing relative order and sit after the ordered ones.
    Object.values(m).forEach(list =>
      list.sort((a, b) => (a.board_order ?? Infinity) - (b.board_order ?? Infinity)));
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

  /* Drop a card ONTO another card → reorder within (or move into) that card's
     cell, persisting the new order via board_order. Group drags fall back to a
     plain cell move. */
  const handleCardDrop = (target, before) => {
    setDropOnCard(null);
    if (!dragging || dragging.id === target.id) { setDragging(null); setDropTarget(null); return; }
    if (selectedIds.size > 1 && selectedIds.has(dragging.id)) {
      handleDrop(target.lane, target.stage);   // group move — no reorder
      return;
    }
    const dragged = dragging;
    const cellKey = target.lane + "::" + target.stage;
    const sameCell = dragged.lane === target.lane && dragged.stage === target.stage;
    const list = (cells[cellKey] || []).filter(r => r.id !== dragged.id);
    let ti = list.findIndex(r => r.id === target.id);
    if (ti < 0) ti = list.length;
    list.splice(before ? ti : ti + 1, 0, dragged);
    if (!sameCell) actions.moveStage(dragged.id, { lane: target.lane, stage: target.stage });
    // Reindex the cell so the order persists (only write the ones that changed).
    list.forEach((r, i) => { if (r.board_order !== i) actions.updateReel(r.id, { board_order: i }); });
    setDragging(null); setDropTarget(null);
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
        {lanes.map(lane => {
          const laneCount = items.filter(r => r.lane === lane.id).length;
          return (
          <React.Fragment key={lane.id}>
            <div className="lane-head">
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
                        onDragEnd={() => { setDragging(null); setDropTarget(null); setDropOnCard(null); }}
                        onDragOver={e => {
                          if (!dragging || dragging.id === r.id) return;
                          e.preventDefault(); e.stopPropagation();
                          if (dropTarget) setDropTarget(null);
                          const rect = e.currentTarget.getBoundingClientRect();
                          const before = (e.clientY - rect.top) < rect.height / 2;
                          if (!dropOnCard || dropOnCard.id !== r.id || dropOnCard.before !== before) {
                            setDropOnCard({ id: r.id, before });
                          }
                        }}
                        onDrop={e => {
                          e.preventDefault(); e.stopPropagation();
                          handleCardDrop(r, dropOnCard?.id === r.id ? dropOnCard.before : true);
                        }}
                        className={isThisDrag ? "is-drag-wrap" : ""}
                        style={{
                          opacity: isThisDrag || isInGroupDrag ? 0.4 : 1,
                          borderTop: dropOnCard?.id === r.id && dropOnCard.before ? "2px solid var(--c-cyan)" : "2px solid transparent",
                          borderBottom: dropOnCard?.id === r.id && !dropOnCard.before ? "2px solid var(--c-cyan)" : "2px solid transparent",
                          borderRadius: 4,
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
