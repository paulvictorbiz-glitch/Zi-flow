/* =========================================================
   Export — posted reels list + Planable-format CSV download.

   Reads live from the store. Shows every reel with stage =
   "posted", listing the description and the scheduled post
   date/time. "Download .csv" produces a two-column file in the
   format Planable accepts:

     Description,Scheduled
     "caption text","2026-05-13 18:00"

   Description prefers the AI publish pack's IG caption
   (detail.aiDraft.seo.ig_caption + hashtags — the text you'd
   actually paste into Planable), falling back to `logline`,
   then title. Scheduled is the reel's `scheduledPostDate` (set
   by the Move-to-Posted modal — date only, exported as
   "YYYY-MM-DD"), falling back to `dueAt`, formatted as
   "YYYY-MM-DD HH:mm" in the viewer's local timezone —
   Planable's CSV import accepts both.
   ========================================================= */

import React, { useMemo } from "react";
import { DPill } from "../components/components.jsx";
import { useWorkflow } from "../store/store.jsx";

/* Local-time "YYYY-MM-DD HH:mm" for the Scheduled column. Returns
   empty string when unset so the row still exports but the operator
   can see at a glance which times are missing. Date-only values
   (scheduledPostDate from the posting modal) pass through unchanged —
   inventing a time of day would be worse than omitting it. */
function formatPlanable(iso) {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
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
      .map(r => {
        // The Move-to-Posted modal saves scheduledPostDate (date only);
        // dueAt is the older datetime field. Prefer the posting date.
        const schedRaw = r.scheduledPostDate || r.dueAt || null;
        // Publish-pack caption beats the logline: it's the text that
        // actually gets posted, and the generator already wrote it.
        const seo = r.detail?.aiDraft?.seo || null;
        const caption = (seo?.ig_caption || "").trim();
        const hashtags = (seo?.hashtags || [])
          .map(h => (String(h).startsWith("#") ? h : "#" + h))
          .join(" ");
        const description = caption
          ? (hashtags ? caption + "\n\n" + hashtags : caption)
          : ((r.logline && r.logline.trim()) || r.title || "");
        return {
          id: r.id,
          title: r.title || "",
          description,
          fromPack: !!caption,
          schedRaw,
          scheduled: formatPlanable(schedRaw),
        };
      });
    posted.sort((a, b) => {
      if (!a.schedRaw && !b.schedRaw) return 0;
      if (!a.schedRaw) return 1;
      if (!b.schedRaw) return -1;
      return a.schedRaw.localeCompare(b.schedRaw);
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
            (Description, Scheduled). Descriptions use the AI publish-pack
            caption when the reel has one, else the logline.
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
                  {r.description
                    ? <>
                        {r.fromPack && (
                          <span className="mono" style={{ fontSize: 9.5, color: "var(--c-violet, #a78bfa)", marginRight: 6 }}
                                title="From the AI publish pack (detail.aiDraft.seo)">
                            PACK
                          </span>
                        )}
                        {r.description}
                      </>
                    : <span className="dim">— no caption or logline set —</span>}
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
