import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "../lib/supabase-client.js";
import { useIsOwner } from "../lib/permissions.jsx";

export function Resources() {
  const isOwner = useIsOwner();

  const [columns, setColumns] = useState([]); // sorted by col_index
  const [rows, setRows]       = useState([]); // sorted by row_index
  const [cells, setCells]     = useState({}); // { rowId_colKey: value }
  const [loading, setLoading] = useState(true);
  const [editingCell, setEditingCell] = useState(null); // { rowId, colKey }
  const [editingValue, setEditingValue] = useState("");
  const [newColLabel, setNewColLabel] = useState("");
  const [addingCol, setAddingCol] = useState(false);
  const dragRowId = useRef(null);
  const dragOverRowId = useRef(null);

  const visibleRows = useMemo(() => isOwner ? rows : rows.filter(r => !r.hidden), [rows, isOwner]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [{ data: cols }, { data: rowsData }, { data: cellsData }] = await Promise.all([
      supabase.from("resource_columns").select("*").order("col_index"),
      supabase.from("resource_rows").select("*").order("row_index"),
      supabase.from("resource_cells").select("*"),
    ]);
    setColumns(cols || []);
    setRows(rowsData || []);
    const cellMap = {};
    for (const c of (cellsData || [])) cellMap[c.row_id + "_" + c.col_key] = c.value || "";
    setCells(cellMap);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const addRow = async () => {
    const row_index = rows.length;
    const { data } = await supabase.from("resource_rows").insert({ row_index }).select().single();
    if (data) setRows(r => [...r, data]);
  };

  const deleteRow = async (id) => {
    await supabase.from("resource_rows").delete().eq("id", id);
    setRows(r => r.filter(row => row.id !== id));
    setCells(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (k.startsWith(id)) delete next[k]; });
      return next;
    });
  };

  const toggleHideRow = async (row) => {
    const next = !row.hidden;
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, hidden: next } : r));
    await supabase.from("resource_rows").update({ hidden: next }).eq("id", row.id);
  };

  const setRowColor = async (row, color) => {
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, row_color: color || null } : r));
    await supabase.from("resource_rows").update({ row_color: color || null }).eq("id", row.id);
  };

  const handleDragStart = (e, rowId) => {
    dragRowId.current = rowId;
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, rowId) => {
    e.preventDefault();
    dragOverRowId.current = rowId;
  };

  const handleDrop = async (e, targetRowId) => {
    e.preventDefault();
    const srcId = dragRowId.current;
    if (!srcId || srcId === targetRowId) return;
    dragRowId.current = null;
    dragOverRowId.current = null;

    setRows(prev => {
      const next = [...prev];
      const srcIdx = next.findIndex(r => r.id === srcId);
      const tgtIdx = next.findIndex(r => r.id === targetRowId);
      const [moved] = next.splice(srcIdx, 1);
      next.splice(tgtIdx, 0, moved);
      const reindexed = next.map((r, i) => ({ ...r, row_index: i }));
      // persist new order
      reindexed.forEach(r => supabase.from("resource_rows").update({ row_index: r.row_index }).eq("id", r.id));
      return reindexed;
    });
  };

  const addColumn = async () => {
    const label = newColLabel.trim();
    if (!label) return;
    const col_key = "col_" + Date.now();
    const col_index = columns.length;
    await supabase.from("resource_columns").insert({ col_key, col_label: label, col_index, col_type: "text" });
    setColumns(c => [...c, { col_key, col_label: label, col_index, col_type: "text" }]);
    setNewColLabel("");
    setAddingCol(false);
  };

  const deleteColumn = async (col_key) => {
    await supabase.from("resource_columns").delete().eq("col_key", col_key);
    setColumns(c => c.filter(col => col.col_key !== col_key));
    setCells(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (k.endsWith("_" + col_key)) delete next[k]; });
      return next;
    });
  };

  const startEdit = (rowId, colKey, currentValue) => {
    setEditingCell({ rowId, colKey });
    setEditingValue(currentValue || "");
  };

  const commitEdit = async () => {
    if (!editingCell) return;
    const { rowId, colKey } = editingCell;
    const value = editingValue;
    const cellKey = rowId + "_" + colKey;
    setCells(prev => ({ ...prev, [cellKey]: value }));
    setEditingCell(null);
    await supabase.from("resource_cells").upsert({ row_id: rowId, col_key: colKey, value }, { onConflict: "row_id,col_key" });
  };

  const cellValue = (rowId, colKey) => cells[rowId + "_" + colKey] || "";

  if (loading) return <div style={{ padding: 32, color: "var(--fg-dim)" }}>Loading resources…</div>;

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Resources</h1>
          <div className="sub">Links, tools, and notes for the team. Double-click any cell to edit.</div>
        </div>
        <div className="actions">
          {addingCol ? (
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                autoFocus
                value={newColLabel}
                onChange={e => setNewColLabel(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addColumn(); if (e.key === "Escape") setAddingCol(false); }}
                placeholder="Column name…"
                style={{ background: "var(--bg-2)", border: "1px solid var(--line-hard)", color: "var(--fg)", borderRadius: 4, padding: "6px 10px", fontSize: 12, fontFamily: "var(--f-mono)" }}
              />
              <button className="btn-primary" onClick={addColumn}>Add</button>
              <button className="btn-ghost" onClick={() => setAddingCol(false)}>Cancel</button>
            </span>
          ) : (
            <button className="btn-ghost" onClick={() => setAddingCol(true)}>+ Add column</button>
          )}
          <button className="btn-ghost" onClick={addRow}>+ Add row</button>
        </div>
      </div>

      <div className="exp-scroll">
        <table className="exp-table">
          <thead>
            <tr>
              <th style={{ width: 54 }}></th>
              {columns.map(col => (
                <th key={col.col_key} style={{ minWidth: 180 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
                    {col.col_label}
                    <button
                      onClick={() => { if (window.confirm("Delete column \"" + col.col_label + "\"?")) deleteColumn(col.col_key); }}
                      style={{ background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer", fontSize: 12, padding: "0 2px" }}
                      title="Delete column"
                    >×</button>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} style={{ padding: "32px 18px", color: "var(--fg-dim)", fontFamily: "var(--f-mono)", fontSize: 12 }}>
                  No rows yet. Click "+ Add row" to start.
                </td>
              </tr>
            )}
            {visibleRows.map((row, ri) => (
              <tr
                key={row.id}
                className="exp-row"
                draggable
                onDragStart={e => handleDragStart(e, row.id)}
                onDragOver={e => handleDragOver(e, row.id)}
                onDrop={e => handleDrop(e, row.id)}
                style={{
                  ...(row.hidden ? { opacity: 0.45, filter: "grayscale(0.4)" } : {}),
                  ...(row.row_color ? { borderLeft: "3px solid " + row.row_color } : {}),
                }}
              >
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span
                      title="Drag to reorder"
                      style={{ cursor: "grab", color: "var(--fg-dim)", fontSize: 14, padding: "0 2px", lineHeight: 1, userSelect: "none" }}
                    >⠿</span>
                    <button
                      onClick={() => { if (window.confirm("Delete this row?")) deleteRow(row.id); }}
                      style={{ background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer", fontSize: 12, padding: "0 4px" }}
                      title="Delete row"
                    >×</button>
                    {isOwner && (
                      <>
                        <button
                          onClick={() => toggleHideRow(row)}
                          title={row.hidden ? "Show this row to all users" : "Hide this row from non-owners"}
                          style={{
                            background: "none", border: "none",
                            color: row.hidden ? "var(--fg-dim)" : "var(--fg)",
                            cursor: "pointer", fontSize: 13, padding: "2px 4px",
                            opacity: row.hidden ? 0.5 : 1,
                          }}
                        >
                          {row.hidden ? "🙈" : "👁"}
                        </button>
                        <input
                          type="color"
                          value={row.row_color || "#0d1525"}
                          onChange={e => setRowColor(row, e.target.value)}
                          onDoubleClick={() => setRowColor(row, null)}
                          title="Row color (double-click to clear)"
                          style={{
                            width: 18, height: 18, padding: 0, border: "none",
                            borderRadius: 3, cursor: "pointer", background: "none",
                            opacity: row.row_color ? 1 : 0.35,
                          }}
                        />
                      </>
                    )}
                  </span>
                </td>
                {columns.map(col => {
                  const isEditing = editingCell?.rowId === row.id && editingCell?.colKey === col.col_key;
                  const val = cellValue(row.id, col.col_key);
                  return (
                    <td key={col.col_key}
                        onDoubleClick={() => startEdit(row.id, col.col_key, val)}
                        style={{ cursor: "text", minWidth: 180, maxWidth: 400 }}>
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editingValue}
                          onChange={e => setEditingValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingCell(null); }}
                          style={{ width: "100%", boxSizing: "border-box", background: "var(--bg-3, var(--bg-2))", border: "1px solid var(--accent, var(--line-hard))", color: "var(--fg)", borderRadius: 3, padding: "4px 6px", fontSize: 12, fontFamily: "var(--f-mono)" }}
                        />
                      ) : col.col_type === "url" && val ? (
                        <a href={val} target="_blank" rel="noopener noreferrer"
                           style={{ color: "var(--c-cyan, #06b6d4)", fontSize: 12, fontFamily: "var(--f-mono)", textDecoration: "none" }}
                           title={val}>
                          {val.length > 50 ? val.slice(0, 50) + "…" : val}
                        </a>
                      ) : (
                        <span style={{ fontSize: 12, fontFamily: "var(--f-mono)", color: val ? "var(--fg)" : "var(--fg-dim)", whiteSpace: "pre-wrap" }}>
                          {val || <span style={{ opacity: 0.3 }}>—</span>}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
