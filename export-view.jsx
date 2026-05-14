/* =========================================================
   Export / Scheduling — spreadsheet-like prep surface for
   reels that are ready to schedule. Shaped to look like a
   real handoff before Planable-style import: editable
   captions, media references, platform, scheduled date+time,
   status, notes.
   ========================================================= */

import React, { useState } from "react";
import { DPill, Pill } from "./components.jsx";
import { EXPORT_ROWS } from "./shared-data.jsx";

function ExportView({ onOpen }) {
  const [rows, setRows] = useState(EXPORT_ROWS);
  const [editing, setEditing] = useState(null); // { id, field }
  const [selected, setSelected] = useState({});

  const update = (id, field, value) => {
    setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const counts = useMemo(() => ({
    ready:  rows.filter(r => r.status === "ready").length,
    needs:  rows.filter(r => r.status === "needs-caption").length,
    block:  rows.filter(r => r.status === "blocked").length,
  }), [rows]);

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Export prep · scheduling sheet</h1>
          <div className="sub">
            Spreadsheet-style prep for reels ready to schedule. Inspect, edit caption + media,
            confirm platform and window — then export the lot as Planable-ready import.
          </div>
        </div>
        <div className="actions">
          <DPill solid>Filter · this week</DPill>
          <DPill solid>Per platform · Instagram</DPill>
          <DPill primary>Export CSV ({rows.filter(r => r.status === "ready").length})</DPill>
        </div>
      </div>

      {/* status strip */}
      <div className="exp-strip">
        <div className="exp-pill"><span className="ok">●</span> Ready · {counts.ready}</div>
        <div className="exp-pill"><span className="warn">●</span> Needs caption · {counts.needs}</div>
        <div className="exp-pill"><span className="block">●</span> Blocked · {counts.block}</div>
        <div className="exp-pill mono dim">5 rows · Instagram · @studio.kathmandu</div>
        <span style={{ flex: 1 }} />
        <div className="mono dim">tab to advance · cmd↵ saves row</div>
      </div>

      <div className="exp-scroll">
        <table className="exp-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th style={{ width: 90 }}>Reel ID</th>
              <th style={{ width: 220 }}>Title</th>
              <th>Post caption</th>
              <th style={{ width: 170 }}>Media / export</th>
              <th style={{ width: 180 }}>Platform · account</th>
              <th style={{ width: 110 }}>Scheduled</th>
              <th style={{ width: 110 }}>Status</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <ExpRow key={r.id} row={r}
                      selected={selected[r.id]}
                      onSelect={v => setSelected(s => ({ ...s, [r.id]: v }))}
                      onChange={(f, v) => update(r.id, f, v)}
                      onOpen={onOpen}
                      editing={editing} setEditing={setEditing} />
            ))}
            {/* empty row to add */}
            <tr className="exp-empty-row">
              <td></td>
              <td className="dim mono">+ add</td>
              <td colSpan="7" className="dim">Drop a reel here from Ready bucket to schedule.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ padding: "14px 22px", borderTop: "1px dashed var(--line)",
                    display: "flex", gap: 12, alignItems: "center" }}>
        <span className="mono muted">handoff checklist</span>
        <span className="exp-pill"><span className="ok">●</span> Captions complete</span>
        <span className="exp-pill"><span className="warn">●</span> Hashtag set per platform</span>
        <span className="exp-pill"><span className="ok">●</span> Media filenames match Planable</span>
        <span style={{ flex: 1 }} />
        <DPill solid>Download .csv</DPill>
        <DPill primary>Send to Planable</DPill>
      </div>
    </div>
  );
}

function ExpRow({ row, selected, onSelect, onChange, onOpen, editing, setEditing }) {
  const tone = row.status === "ready" ? "ok"
             : row.status === "needs-caption" ? "warn"
             : row.status === "blocked" ? "block" : "";

  const edit = (field) => setEditing({ id: row.id, field });
  const cancel = () => setEditing(null);

  const isEditing = (field) => editing && editing.id === row.id && editing.field === field;

  return (
    <tr className={"exp-row " + tone}>
      <td>
        <input type="checkbox" className="exp-cb" checked={!!selected}
               onChange={e => onSelect(e.target.checked)} />
      </td>
      <td className="mono cyan"
          onClick={() => onOpen({ id: row.id, title: row.title })}
          style={{ cursor: "pointer" }}>{row.id}</td>
      <td className="serif-i" style={{ color: "#eef3fb" }}>{row.title}</td>
      <td className="exp-cap" onClick={() => edit("caption")}>
        {isEditing("caption")
          ? <textarea className="exp-textarea" value={row.caption} autoFocus
                      onChange={e => onChange("caption", e.target.value)}
                      onBlur={cancel} rows="4" />
          : (row.caption
              ? <div style={{ whiteSpace: "pre-wrap" }}>{row.caption}</div>
              : <span className="dim">— click to add caption —</span>)}
      </td>
      <td className="mono">
        <div style={{ color: row.media === "—" ? "var(--c-red)" : "var(--c-cyan)" }}>{row.media}</div>
        <div className="dim" style={{ fontSize: 10 }}>{row.mediaSize}</div>
      </td>
      <td className="mono muted">{row.platform}</td>
      <td className="mono">
        <div>{row.date}</div>
        <div className="cyan">{row.time}</div>
      </td>
      <td>
        <Pill tone={tone}>{row.status.replace("-", " ")}</Pill>
      </td>
      <td className="exp-note" onClick={() => edit("notes")}>
        {isEditing("notes")
          ? <input className="exp-input" value={row.notes} autoFocus
                   onChange={e => onChange("notes", e.target.value)}
                   onBlur={cancel} />
          : <span className="muted">{row.notes || "—"}</span>}
      </td>
    </tr>
  );
}

export { ExportView };
