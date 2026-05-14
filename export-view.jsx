/* =========================================================
   Export — posted reels list + Planable-format CSV download.

   Reads live from the store. Shows every reel with stage =
   "posted", listing the description and the scheduled post
   date/time. "Download .csv" produces a two-column file in the
   format Planable accepts:

     Description,Scheduled
     "caption text","2026-05-13 18:00"

   Description is taken from the reel's `logline` (the post pitch
   line), falling back to title if no logline is set. Scheduled
   is the reel's `dueAt`, formatted as "YYYY-MM-DD HH:mm" in the
   viewer's local timezone — Planable's CSV import accepts this.
   ========================================================= */

import React, { useMemo } from "react";
import { DPill } from "./components.jsx";
import { useWorkflow } from "./store.jsx";

/* Local-time "YYYY-MM-DD HH:mm" for the Scheduled column. Returns
   empty string when dueAt is unset so the row still exports but
   the operator can see at a glance which times are missing. */
function formatPlanable(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return yyyy + "-" + mm + "-" + dd + " " + hh + ":" + mi;
}

/* RFC 4180 CSV cell escape — wraps in quotes if the value contains
   a comma, quote, or newline; doubles embedded quotes. */
function csvCell(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function buildCsv(rows) {
  const header = ["Description", "Scheduled"].join(",");
  const body = rows.map(r => [csvCell(r.description), csvCell(r.scheduled)].join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ExportView({ onOpen }) {
  const { reels } = useWorkflow();

  /* Rows = posted, non-archived. Sorted by scheduled time ascending
     so the CSV reads top-to-bottom in post order. Reels with no
     dueAt sink to the bottom. */
  const rows = useMemo(() => {
    const posted = reels
      .filter(r => r.stage === "posted" && !r.archivedAt)
      .map(r => ({
        id: r.id,
        title: r.title || "",
        description: (r.logline && r.logline.trim()) || r.title || "",
        dueAt: r.dueAt || null,
        scheduled: formatPlanable(r.dueAt),
      }));
    posted.sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return a.dueAt.localeCompare(b.dueAt);
    });
    return posted;
  }, [reels]);

  const handleDownload = () => {
    if (!rows.length) return;
    const csv = buildCsv(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, "posted-reels-" + stamp + ".csv");
  };

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Export · posted reels</h1>
          <div className="sub">
            Every reel in the Posted stage. Download as Planable-ready CSV
            (Description, Scheduled).
          </div>
        </div>
        <div className="actions">
          <DPill primary onClick={handleDownload}
                 style={{ opacity: rows.length ? 1 : 0.5,
                          cursor: rows.length ? "pointer" : "not-allowed" }}>
            Download .csv ({rows.length})
          </DPill>
        </div>
      </div>

      <div className="exp-scroll">
        <table className="exp-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Reel ID</th>
              <th style={{ width: 240 }}>Title</th>
              <th>Description</th>
              <th style={{ width: 170 }}>Scheduled</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan="4" style={{
                  padding: "32px 18px",
                  color: "var(--fg-dim)",
                  fontFamily: "var(--f-mono)",
                  fontSize: 12,
                }}>
                  No reels in the Posted stage yet. Move a reel to Posted on
                  the Pipeline board to see it here.
                </td>
              </tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="exp-row">
                <td className="mono cyan"
                    onClick={() => onOpen && onOpen({ id: r.id, title: r.title })}
                    style={{ cursor: "pointer" }}>{r.id}</td>
                <td className="serif-i" style={{ color: "#eef3fb" }}>{r.title}</td>
                <td style={{ whiteSpace: "pre-wrap", color: "var(--fg-mute)" }}>
                  {r.description || <span className="dim">— no logline set —</span>}
                </td>
                <td className="mono">
                  {r.scheduled
                    ? <span style={{ color: "var(--c-cyan)" }}>{r.scheduled}</span>
                    : <span className="dim">— not scheduled —</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { ExportView };
