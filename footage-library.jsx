/* =========================================================
   Footage library — cross-reel view of every Footage Brain
   clip attached to any reel.

   The store loads `attached_footage_items` on hydrate. Each row
   is a single (clip × reel) link, so the same clip attached to
   three reels shows up three times. This view groups by
   `footage_file_id` so each clip renders once with the list of
   reels it's attached to.

   Use cases:
     · "I've attached prayer-flag b-roll somewhere — which reels?"
     · "Which clips have I used more than once?"
     · "Find that drone clip by partial filename or transcript text."
   ========================================================= */

import React, { useMemo, useState } from "react";
import { DPill } from "./components.jsx";
import { useWorkflow } from "./store.jsx";

/* Group all attached_footage_items rows by clip identity. Each
   resulting record carries the clip's metadata (taken from the
   most-recent row) plus the list of reels it's linked to. */
function groupByClip(rows) {
  const byClip = new Map();
  for (const row of rows) {
    const key = row.footage_file_id || row.filename || row.id;
    if (!key) continue;
    let g = byClip.get(key);
    if (!g) {
      g = {
        key,
        footage_file_id: row.footage_file_id,
        filename: row.filename,
        source_path: row.source_path,
        extension: row.extension,
        duration_seconds: row.duration_seconds,
        thumbnail_url: row.thumbnail_url,
        width: row.width,
        height: row.height,
        is_vertical: row.is_vertical,
        best_score: row.best_score,
        matched_chunks: row.matched_chunks,
        reelIds: [],
        latest: row.created_at || null,
      };
      byClip.set(key, g);
    }
    if (row.reel_id) g.reelIds.push({ reel_id: row.reel_id, link_id: row.id });
    if (row.created_at && (!g.latest || row.created_at > g.latest)) {
      g.latest = row.created_at;
    }
  }
  return Array.from(byClip.values());
}

function formatDuration(s) {
  if (!s && s !== 0) return "?";
  const sec = Number(s);
  if (!Number.isFinite(sec)) return "?";
  if (sec < 60) return sec.toFixed(1) + "s";
  const m = Math.floor(sec / 60);
  const r = Math.round(sec - m * 60);
  return m + "m " + String(r).padStart(2, "0") + "s";
}

function FootageLibrary({ onOpen }) {
  const { attachedFootage, reels } = useWorkflow();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | reused | orphans

  /* Build a reel lookup so each reelId can render its title.
     Orphaned reel ids (clip attached to a reel that's since been
     deleted — CASCADE should normally clear these, but a leftover
     row would render as "—" rather than crash). */
  const reelById = useMemo(() => {
    const m = new Map();
    reels.forEach(r => m.set(r.id, r));
    return m;
  }, [reels]);

  const clips = useMemo(() => groupByClip(attachedFootage), [attachedFootage]);

  /* Filter + search. Search hits filename, source path, and the
     first transcript chunk if present. Case-insensitive substring. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clips.filter(c => {
      if (filter === "reused" && c.reelIds.length < 2) return false;
      if (filter === "orphans" && c.reelIds.length !== 0) return false;
      if (!q) return true;
      const haystacks = [
        c.filename,
        c.source_path,
        c.matched_chunks?.[0]?.text,
      ].filter(Boolean).map(s => String(s).toLowerCase());
      return haystacks.some(h => h.includes(q));
    }).sort((a, b) => {
      // Most reuses first, then newest. Filename as tiebreak so the
      // ordering is stable across renders.
      if (b.reelIds.length !== a.reelIds.length) return b.reelIds.length - a.reelIds.length;
      if (a.latest && b.latest && a.latest !== b.latest) return b.latest.localeCompare(a.latest);
      return String(a.filename || "").localeCompare(String(b.filename || ""));
    });
  }, [clips, query, filter]);

  const reusedCount = clips.filter(c => c.reelIds.length >= 2).length;

  const openPreview = (clip) => {
    if (!clip.footage_file_id) return;
    window.open("http://localhost:5173/files/" + clip.footage_file_id, "_blank");
  };

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Footage library</h1>
          <div className="sub">
            Every clip attached to any reel. Search by filename, path or
            transcript. Click a reel chip to open it.
          </div>
        </div>
        <div className="actions">
          <DPill active={filter === "all"} onClick={() => setFilter("all")}>
            All · {clips.length}
          </DPill>
          <DPill active={filter === "reused"} onClick={() => setFilter("reused")}>
            Re-used · {reusedCount}
          </DPill>
        </div>
      </div>

      <div style={{
        padding: "0 22px 14px",
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by filename, path, or transcript text…"
          style={{
            flex: 1,
            background: "var(--bg-2)",
            border: "1px dashed var(--line-hard)",
            borderRadius: 4,
            color: "var(--fg)",
            fontFamily: "var(--f-mono)",
            fontSize: 12,
            padding: "8px 12px",
          }}
        />
        <span className="mono dim">{visible.length} clip{visible.length === 1 ? "" : "s"}</span>
      </div>

      <div className="exp-scroll">
        <table className="exp-table">
          <thead>
            <tr>
              <th style={{ width: 100 }}></th>
              <th>Filename · source</th>
              <th style={{ width: 90 }}>Duration</th>
              <th style={{ width: 110 }}>Size</th>
              <th style={{ width: 260 }}>Attached to</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan="5" style={{
                padding: "32px 18px",
                color: "var(--fg-dim)",
                fontFamily: "var(--f-mono)",
                fontSize: 12,
              }}>
                {clips.length === 0
                  ? "No footage attached to any reel yet. Open a reel and use Footage Brain search to add clips."
                  : "No clips match this filter."}
              </td></tr>
            )}
            {visible.map(c => (
              <tr key={c.key} className="exp-row">
                <td>
                  <div className="lib-thumb">
                    {c.thumbnail_url && (
                      <img src={"/thumbnails/" + c.thumbnail_url}
                           alt=""
                           onError={e => { e.target.style.display = "none"; }} />
                    )}
                  </div>
                </td>
                <td>
                  <div style={{
                    color: "var(--fg)",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: c.footage_file_id ? "pointer" : "default",
                  }}
                       onClick={() => openPreview(c)}
                       title={c.footage_file_id ? "Open in Footage Brain" : ""}>
                    {c.filename || "(unnamed clip)"}
                  </div>
                  {c.source_path && (
                    <div className="mono dim" style={{ fontSize: 10, marginTop: 2 }}>
                      {c.source_path}
                    </div>
                  )}
                  {c.matched_chunks?.[0]?.text && (
                    <div className="dim" style={{
                      fontSize: 11,
                      fontStyle: "italic",
                      marginTop: 4,
                      maxWidth: 520,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      “{c.matched_chunks[0].text}”
                    </div>
                  )}
                </td>
                <td className="mono">{formatDuration(c.duration_seconds)}</td>
                <td className="mono dim">
                  {c.width && c.height ? c.width + "×" + c.height : "—"}
                  {c.is_vertical ? " · 9:16" : ""}
                </td>
                <td>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {c.reelIds.length === 0 && <span className="dim">— orphan —</span>}
                    {c.reelIds.map(({ reel_id }) => {
                      const reel = reelById.get(reel_id);
                      const label = reel ? reel.id : reel_id;
                      return (
                        <span key={reel_id}
                              className="lib-reel-chip"
                              title={reel?.title || reel_id}
                              onClick={() => reel && onOpen && onOpen(reel)}>
                          {label}
                        </span>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { FootageLibrary };
