/* =========================================================
   Pipeline Board — owner lanes (rows) × workflow stage (cols)
   ========================================================= */

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { DPill, ReelCard } from "../components/components.jsx";
import { useWorkflow } from "../store/store.jsx";
import { STAGES, STAGE_LABEL } from "../lib/shared-data.jsx";
import { useRoster } from "../lib/roster.jsx";
import { usePermissions, useIsOwner } from "../lib/permissions.jsx";

/* Board columns derived from the canonical STAGES list. Labels are
   upper-cased here because the board column heads use that style;
   list-view / archived-view consume STAGE_LABEL as-is (title case). */
const PIPELINE_STAGES = STAGES.map((key) => ({ key, label: STAGE_LABEL[key].toUpperCase() }));

/* Lane row order — skilled editor first, then owner, then variant,
   then anyone else. Reviewers don't get a personal lane; they share
   the special "review" workflow lane appended last. */
const LANE_ROLE_ORDER = { skilled: 0, owner: 1, variant: 2 };

function Pipeline({ onOpen }) {
  const { reels, reviewLaneCards, actions, hiddenLaneIds } = useWorkflow();
  const { peopleList } = useRoster();
  const { can } = usePermissions();
  const isOwner = useIsOwner();
  const [filter, setFilter] = useState("all");
  const [scheduleModal, setScheduleModal] = useState(null);
  const [scheduleDate, setScheduleDate] = useState("");

  /* Row / column visibility — persisted to localStorage */
  const [hiddenLanes, setHiddenLanes] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("pipeline_hidden_lanes") || "[]")); }
    catch { return new Set(); }
  });
  const [hiddenCols, setHiddenCols] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("pipeline_hidden_cols") || "[]")); }
    catch { return new Set(); }
  });
  /* Optional series/playlist grouping — clusters same-series reels within each
     cell and shows a series header. Off by default (= current flat board). */
  const [groupBySeries, setGroupBySeries] = useState(
    () => localStorage.getItem("pipeline_group_by_series") === "1");
  const [cardView, setCardView] = useState(
    () => localStorage.getItem("pipeline_card_view") || "list");
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef(null);
  const [lanesMenuOpen, setLanesMenuOpen] = useState(false);
  const lanesMenuRef = useRef(null);
  const [laneCtxMenu, setLaneCtxMenu] = useState(null);

  useEffect(() => {
    localStorage.setItem("pipeline_hidden_lanes", JSON.stringify([...hiddenLanes]));
  }, [hiddenLanes]);

  /* When user_preferences loads from DB (hiddenLaneIds), merge into local set.
     DB is authoritative when non-empty; local localStorage is the fallback. */
  useEffect(() => {
    if (!hiddenLaneIds || hiddenLaneIds.length === 0) return;
    setHiddenLanes(new Set(hiddenLaneIds));
  }, [hiddenLaneIds?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    localStorage.setItem("pipeline_hidden_cols", JSON.stringify([...hiddenCols]));
  }, [hiddenCols]);
  useEffect(() => {
    localStorage.setItem("pipeline_group_by_series", groupBySeries ? "1" : "0");
  }, [groupBySeries]);
  useEffect(() => {
    localStorage.setItem("pipeline_card_view", cardView);
  }, [cardView]);

  /* Close column menu on outside click */
  useEffect(() => {
    if (!colMenuOpen) return;
    const handler = (e) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setColMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colMenuOpen]);

  /* Close lanes menu on outside click */
  useEffect(() => {
    if (!lanesMenuOpen) return;
    const handler = (e) => {
      if (lanesMenuRef.current && !lanesMenuRef.current.contains(e.target)) setLanesMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [lanesMenuOpen]);

  /* Close lane context menu on outside click */
  useEffect(() => {
    if (!laneCtxMenu) return;
    const handler = () => setLaneCtxMenu(null);
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [laneCtxMenu]);

  const toggleLane = (laneId) => {
    setHiddenLanes(prev => {
      const next = new Set(prev);
      if (next.has(laneId)) next.delete(laneId); else next.add(laneId);
      return next;
    });
    actions.toggleLaneHidden(laneId);
  };
  const toggleCol = (colKey) => setHiddenCols(prev => {
    const next = new Set(prev);
    if (next.has(colKey)) next.delete(colKey); else next.add(colKey);
    return next;
  });

  /* Board rows, built live from the team roster: one lane per
     non-reviewer member (so a newly-added editor gets their own row),
     plus the shared "review" lane named after the reviewer. */
  const lanes = useMemo(() => {
    const personLanes = peopleList
      .slice()
      .sort((a, b) =>
        (a.role === "owner" ? 0 : 1) - (b.role === "owner" ? 0 : 1) ||
        (LANE_ROLE_ORDER[a.role] ?? 9) - (LANE_ROLE_ORDER[b.role] ?? 9))
      .map(p => ({ id: p.id, name: p.name }));
    const reviewer = peopleList.find(p => p.role === "reviewer");
    personLanes.push({ id: "review", name: reviewer?.name || "Reviewer" });
    return personLanes;
  }, [peopleList]);

  const [dragging, setDragging] = useState(null); // reel record being dragged
  const [dropTarget, setDropTarget] = useState(null); // "lane::stage"
  const [dropOnCard, setDropOnCard] = useState(null); // { id, before } — reorder target
  const [blockedStage, setBlockedStage] = useState(null); // stage key flashing red after a blocked drop
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
    // existing relative order and sit after the ordered ones. When grouping by
    // series, cluster same-series reels first (untagged reels sort last), then
    // fall back to board_order within each series.
    const seriesKey = (r) => (r.series ? r.series.toLowerCase() : "￿");
    Object.values(m).forEach(list =>
      list.sort((a, b) =>
        (groupBySeries ? seriesKey(a).localeCompare(seriesKey(b)) : 0) ||
        (a.board_order ?? Infinity) - (b.board_order ?? Infinity)));
    return m;
  }, [items, filter, groupBySeries]);

  /* Flash the Completed column header red for 700 ms to signal a blocked drop. */
  const flashBlocked = useCallback((stage) => {
    setBlockedStage(stage);
    setTimeout(() => setBlockedStage(null), 700);
  }, []);

  const canMove = can("moveReel");

  const handleDrop = (lane, stage) => {
    if (!dragging) return;

    /* Outer gate: if the role can't move reel cards at all, abort. */
    if (!canMove) {
      setDragging(null);
      setDropTarget(null);
      return;
    }

    /* Block non-owners from dropping into the Completed column. */
    if (stage === "completed" && !can("moveToCompleted")) {
      flashBlocked("completed");
      setDragging(null);
      setDropTarget(null);
      return;
    }

    /* Intercept drops into "posted" — show the schedule date modal
       before committing the move. Group drags to "posted" are also
       caught; we clear the selection and treat it as a single move
       so the modal flow stays simple. */
    if (stage === "posted") {
      const groupMove = selectedIds.size > 1 && selectedIds.has(dragging.id);
      if (groupMove) setSelectedIds(new Set());
      setScheduleModal({ reelId: dragging.id, lane, fromStage: dragging.stage });
      setScheduleDate("");
      setDragging(null);
      setDropTarget(null);
      return;
    }

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

    /* Outer gate: no move capability → abort before any reorder/move. */
    if (!canMove) { setDragging(null); setDropTarget(null); return; }

    /* Same completed-column gate — covers drops onto cards, not just empty cells. */
    if (target.stage === "completed" && !can("moveToCompleted")) {
      flashBlocked("completed");
      setDragging(null);
      setDropTarget(null);
      return;
    }

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

  const visibleStages = PIPELINE_STAGES.filter(s => !hiddenCols.has(s.key));

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
          <DPill active={groupBySeries} onClick={() => setGroupBySeries(v => !v)}>Group by series</DPill>
          {/* Column visibility menu */}
          <div ref={colMenuRef} style={{ position: "relative" }}>
            <DPill onClick={() => setColMenuOpen(o => !o)}>
              Columns {hiddenCols.size > 0 ? `(${hiddenCols.size} hidden)` : "▾"}
            </DPill>
            {colMenuOpen && (
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 200,
                background: "var(--bg-1)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "8px 0", minWidth: 180,
                boxShadow: "0 4px 16px rgba(0,0,0,.35)",
              }}>
                {PIPELINE_STAGES.map(s => (
                  <label key={s.key} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "7px 16px", cursor: "pointer",
                    color: hiddenCols.has(s.key) ? "var(--fg-dim)" : "var(--fg-0)",
                  }}>
                    <input
                      type="checkbox"
                      checked={!hiddenCols.has(s.key)}
                      onChange={() => toggleCol(s.key)}
                      style={{ accentColor: "var(--c-cyan)", width: 15, height: 15 }}
                    />
                    {s.label}
                  </label>
                ))}
                {hiddenCols.size > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4 }}>
                    <button onClick={() => setHiddenCols(new Set())} style={{
                      display: "block", width: "100%", background: "none", border: "none",
                      color: "var(--c-cyan)", cursor: "pointer", padding: "6px 16px", textAlign: "left", fontSize: 13,
                    }}>Show all columns</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lanes visibility toolbar + card view toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 16px 4px", position: "relative" }}>
        <div style={{ position: "relative" }} ref={lanesMenuRef}>
          <button
            onClick={() => setLanesMenuOpen(o => !o)}
            style={{
              background: "var(--bg-2)", border: "1px solid var(--line-hard)",
              borderRadius: 4, color: hiddenLanes.size > 0 ? "var(--c-amber)" : "var(--fg-dim)",
              fontFamily: "var(--f-mono)", fontSize: 11, padding: "4px 10px", cursor: "pointer"
            }}
          >
            Lanes{hiddenLanes.size > 0 ? ` (${hiddenLanes.size} hidden)` : ""}
          </button>
          {lanesMenuOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 999,
              background: "var(--bg-2)", border: "1px solid var(--line-hard)",
              borderRadius: 6, padding: "8px 0", minWidth: 200,
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)"
            }}>
              <div style={{ padding: "4px 14px 8px", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: 0.6 }}>
                Team lanes
              </div>
              {lanes.map(lane => (
                <label key={lane.id}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={!hiddenLanes.has(lane.id)}
                    onChange={() => toggleLane(lane.id)}
                    style={{ cursor: "pointer" }}
                  />
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: hiddenLanes.has(lane.id) ? "var(--fg-dim)" : "var(--fg)" }}>
                    {lane.name}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="view-toggle">
          {["list", "2x2", "3x3"].map(v => (
            <button key={v} className={cardView === v ? "is-active" : ""} onClick={() => setCardView(v)}>
              {v === "list" ? "≡ List" : v === "2x2" ? "⊞ 2×2" : "⊟ 3×3"}
            </button>
          ))}
        </div>
      </div>

      {/* Board grid */}
      <div className="board" style={{
        gridTemplateColumns: `200px repeat(${visibleStages.length}, minmax(0, 1fr))`,
      }}>
        {/* Column heads (offset by lane gutter) */}
        <div className="col-head" style={{ background: "var(--bg-0)" }}>
          <div className="lbl">OWNER / ROLE</div>
          <div className="meta">Rows = who has what.</div>
          <div className="meta">Columns = where it is.</div>
        </div>
        {visibleStages.map(s => {
          const count = items.filter(r => r.stage === s.key).length;
          const isBlocked = blockedStage === s.key;
          return (
            <div
              className="col-head"
              key={s.key}
              style={isBlocked ? {
                outline: "2px solid var(--c-red)",
                background: "var(--c-red-soft)",
                transition: "background 0.1s, outline 0.1s",
              } : undefined}
            >
              <div className="lbl" style={isBlocked ? { color: "var(--c-red)" } : undefined}>
                {isBlocked ? "✕ " : ""}{s.label}
              </div>
              <div className="meta">{isBlocked ? "not allowed" : count + " reel" + (count === 1 ? "" : "s")}</div>
            </div>
          );
        })}

        {/* Lanes */}
        {lanes.map((lane, laneIdx) => {
          if (hiddenLanes.has(lane.id)) return null;
          const laneCount = items.filter(r => r.lane === lane.id).length;
          return (
          <React.Fragment key={lane.id}>
            <div
              className="lane-head"
              onContextMenu={e => { e.preventDefault(); if (isOwner) setLaneCtxMenu({ laneId: lane.id, x: e.clientX, y: e.clientY }); }}
            >
              <div className="name">{lane.name}</div>
              <div className="stats">{laneCount} reel{laneCount === 1 ? "" : "s"}</div>
            </div>
            {visibleStages.map(stage => {
              const reels = cells[lane.id + "::" + stage.key] || [];
              const targetKey = lane.id + "::" + stage.key;
              const isTarget = dropTarget === targetKey;
              return (
                <div
                  className={
                    "cell" +
                    (reels.length === 0 ? " empty" : "") +
                    (isTarget ? " drop-target" : "") +
                    (cardView !== "list" ? " cell--" + cardView : "")
                  }
                  key={stage.key}
                  onDragOver={e => {
                    if (!dragging) return;
                    /* No move capability → never show a drop target. */
                    if (!canMove) return;
                    /* Don't highlight Completed as a valid drop target when blocked. */
                    if (stage.key === "completed" && !can("moveToCompleted")) return;
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
                  {reels.map((r, idx) => {
                    const isSelected = selectedIds.has(r.id);
                    const groupActive = isSelected && selectedIds.size > 1;
                    const isThisDrag = dragging && dragging.id === r.id;
                    const isInGroupDrag = dragging && selectedIds.has(dragging.id) && selectedIds.size > 1 && isSelected;
                    /* When grouping, drop a thin series label at each group boundary. */
                    const showSeriesHeader = groupBySeries && cardView === "list" &&
                      (idx === 0 || (reels[idx - 1].series || "") !== (r.series || ""));
                    return (
                      <React.Fragment key={r.id}>
                      {showSeriesHeader && (
                        <div className="pipe-series-header">
                          {r.series ? `⛓ ${r.series}` : "· no series"}
                        </div>
                      )}
                      <div
                        draggable={canMove}
                        onDragStart={e => {
                          setDragging(r);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => { setDragging(null); setDropTarget(null); setDropOnCard(null); }}
                        onDragOver={e => {
                          if (!dragging || dragging.id === r.id) return;
                          /* No move capability → never accept a card-reorder drop. */
                          if (!canMove) return;
                          /* Block the drop cursor on cards inside a protected column. */
                          if (r.stage === "completed" && !can("moveToCompleted")) return;
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
                          compact={cardView !== "list"}
                          onOpen={(reel, e) => handleCardClick(reel, e || {})}
                        />
                      </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              );
            })}
          </React.Fragment>
          );
        })}
      </div>

      {/* Lane right-click context menu */}
      {laneCtxMenu && (
        <div
          style={{ position: "fixed", top: laneCtxMenu.y, left: laneCtxMenu.x, zIndex: 9999,
                   background: "var(--bg-2)", border: "1px solid var(--line-hard)",
                   borderRadius: 4, padding: "4px 0", boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}
          onMouseLeave={() => setLaneCtxMenu(null)}
        >
          <button
            style={{ display: "block", width: "100%", background: "none", border: "none",
                     color: "var(--fg)", fontFamily: "var(--f-mono)", fontSize: 12,
                     padding: "7px 16px", cursor: "pointer", textAlign: "left" }}
            onClick={() => { toggleLane(laneCtxMenu.laneId); setLaneCtxMenu(null); }}
          >
            Hide this lane
          </button>
        </div>
      )}

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

      {/* Schedule date modal — shown when a card is dropped into "posted" */}
      {scheduleModal && (
        <div className="m-backdrop" onClick={() => setScheduleModal(null)}>
          <div className="m-shell" onClick={e => e.stopPropagation()} style={{ maxWidth: 340 }}>
            <div className="m-head">
              <div>
                <div className="m-eyebrow">Move to Posted</div>
                <div className="m-title">Schedule post date</div>
                <div className="m-sub">
                  Set the date this reel is scheduled to be posted. You can leave it blank.
                </div>
              </div>
              <button className="m-x" onClick={() => setScheduleModal(null)}>✕</button>
            </div>
            <div className="m-body">
              <div className="m-field">
                <div className="m-label">Post date</div>
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={e => setScheduleDate(e.target.value)}
                  className="m-input"
                />
              </div>
            </div>
            <div className="m-foot">
              <span />
              <div style={{ display: "flex", gap: 8 }}>
                <DPill onClick={() => setScheduleModal(null)}>Cancel</DPill>
                <DPill primary onClick={() => {
                  actions.moveStage(scheduleModal.reelId, {
                    lane: scheduleModal.lane,
                    stage: "posted",
                    scheduledPostDate: scheduleDate || null,
                  });
                  setScheduleModal(null);
                }}>Move to Posted</DPill>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { Pipeline };
