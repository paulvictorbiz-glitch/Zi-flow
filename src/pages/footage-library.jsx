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

import React, { useMemo, useState, useEffect, useRef } from "react";
import { DPill } from "../components/components.jsx";
import { useWorkflow } from "../store/store.jsx";
import { footageBrainThumbnailUrl, footageBrainFileUrl } from "../lib/footage-brain-client.js";

/* Group all attached_footage_items rows by clip identity. Each
   resulting record carries the clip's metadata (taken from the
   first row encountered) plus the list of reels it's linked to. */
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
        frame_rate: row.frame_rate ?? null,
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

/* Small popover for attaching a clip to one or more reels. */
function AttachPopover({ clip, reels, reelById, onDone, onClose, actions }) {
  const [selected, setSelected] = useState(() => new Set(clip.reelIds.map(r => r.reel_id)));
  const ref = useRef(null);

  useEffect(() => {
    function onMousedown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", onMousedown);
    return () => document.removeEventListener("mousedown", onMousedown);
  }, [onClose]);

  const activeReels = reels.filter(r => !r.archivedAt);

  function toggle(reelId) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(reelId)) next.delete(reelId);
      else next.add(reelId);
      return next;
    });
  }

  function handleDone() {
    const existingIds = new Set(clip.reelIds.map(r => r.reel_id));

    // Attach newly checked reels
    for (const reel_id of selected) {
      if (!existingIds.has(reel_id)) {
        const item = {
          reel_id,
          footage_file_id: clip.footage_file_id,
          filename: clip.filename,
          source_path: clip.source_path,
          extension: clip.extension,
          duration_seconds: clip.duration_seconds,
          thumbnail_url: clip.thumbnail_url,
          width: clip.width,
          height: clip.height,
          is_vertical: clip.is_vertical,
          best_score: clip.best_score,
          matched_chunks: clip.matched_chunks,
        };
        actions.addAttachedFootage(item);
      }
    }

    // Detach unchecked reels
    for (const { reel_id, link_id } of clip.reelIds) {
      if (!selected.has(reel_id)) {
        if (actions.removeAttachedFootage) {
          actions.removeAttachedFootage(link_id);
        }
        // If action doesn't exist, skip silently (attach-only)
      }
    }

    onClose();
  }

  return (
    <div ref={ref} style={{
      position: "absolute",
      zIndex: 9999,
      background: "var(--bg-2)",
      border: "1px solid var(--line-hard)",
      borderRadius: 6,
      boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
      padding: "10px 0 8px",
      minWidth: 220,
      maxHeight: 300,
      overflowY: "auto",
      top: "100%",
      left: 0,
    }}>
      <div style={{
        fontSize: 10,
        color: "var(--fg-dim)",
        fontFamily: "var(--f-mono)",
        padding: "0 12px 6px",
        borderBottom: "1px solid var(--line-hard)",
        marginBottom: 4,
      }}>
        Attach / detach reels
      </div>
      {activeReels.length === 0 && (
        <div style={{ padding: "8px 12px", color: "var(--fg-dim)", fontSize: 11 }}>
          No active reels.
        </div>
      )}
      {activeReels.map(reel => (
        <label key={reel.id} style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 12px",
          cursor: "pointer",
          fontSize: 12,
          color: "var(--fg)",
          userSelect: "none",
        }}
          onMouseEnter={e => e.currentTarget.style.background = "var(--bg-3)"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          <input
            type="checkbox"
            checked={selected.has(reel.id)}
            onChange={() => toggle(reel.id)}
            style={{ accentColor: "var(--accent)", cursor: "pointer" }}
          />
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", marginRight: 2 }}>
            [{reel.id}]
          </span>
          <span style={{ fontSize: 12 }}>{reel.title || reel.id}</span>
        </label>
      ))}
      <div style={{ borderTop: "1px solid var(--line-hard)", marginTop: 4, padding: "8px 12px 0" }}>
        <button onClick={handleDone} style={{
          background: "var(--accent)",
          border: "none",
          borderRadius: 4,
          color: "#fff",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600,
          padding: "4px 14px",
          width: "100%",
        }}>
          Done
        </button>
      </div>
    </div>
  );
}

function FootageLibrary({ onOpen }) {
  const { attachedFootage, reels, actions } = useWorkflow();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | reused
  const [colFilters, setColFilters] = useState({
    filename: "",
    duration: "",
    fps: "",
    size: "",
    attachedTo: "",
  });
  // attachPopover: { clipKey } | null
  const [attachPopover, setAttachPopover] = useState(null);

  /* Build a reel lookup so each reelId can render its title. */
  const reelById = useMemo(() => {
    const m = new Map();
    reels.forEach(r => m.set(r.id, r));
    return m;
  }, [reels]);

  const clips = useMemo(() => groupByClip(attachedFootage), [attachedFootage]);

  /* Filter + search. Global search hits filename, source path, and the
     first transcript chunk if present. Per-column filters narrow further. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cf = {
      filename: colFilters.filename.trim().toLowerCase(),
      duration: colFilters.duration.trim().toLowerCase(),
      fps: colFilters.fps.trim().toLowerCase(),
      size: colFilters.size.trim().toLowerCase(),
      attachedTo: colFilters.attachedTo.trim().toLowerCase(),
    };

    return clips.filter(c => {
      if (filter === "reused" && c.reelIds.length < 2) return false;

      // Global search
      if (q) {
        const haystacks = [
          c.filename,
          c.source_path,
          c.matched_chunks?.[0]?.text,
        ].filter(Boolean).map(s => String(s).toLowerCase());
        if (!haystacks.some(h => h.includes(q))) return false;
      }

      // Per-column filters
      if (cf.filename) {
        const hay = [c.filename, c.source_path].filter(Boolean).map(s => s.toLowerCase()).join(" ");
        if (!hay.includes(cf.filename)) return false;
      }
      if (cf.duration) {
        const rendered = formatDuration(c.duration_seconds).toLowerCase();
        if (!rendered.includes(cf.duration)) return false;
      }
      if (cf.fps) {
        const rendered = c.frame_rate ? c.frame_rate.toFixed(0) + " fps" : "—";
        if (!rendered.toLowerCase().includes(cf.fps)) return false;
      }
      if (cf.size) {
        const rendered = (c.width && c.height ? c.width + "×" + c.height : "—").toLowerCase();
        if (!rendered.includes(cf.size)) return false;
      }
      if (cf.attachedTo) {
        const labels = c.reelIds.map(({ reel_id }) => {
          const reel = reelById.get(reel_id);
          return [reel?.id, reel?.title, reel_id].filter(Boolean).join(" ").toLowerCase();
        }).join(" ");
        if (!labels.includes(cf.attachedTo)) return false;
      }

      return true;
    }).sort((a, b) => {
      // Most reuses first, then newest. Filename as tiebreak so the
      // ordering is stable across renders.
      if (b.reelIds.length !== a.reelIds.length) return b.reelIds.length - a.reelIds.length;
      if (a.latest && b.latest && a.latest !== b.latest) return b.latest.localeCompare(a.latest);
      return String(a.filename || "").localeCompare(String(b.filename || ""));
    });
  }, [clips, query, filter, colFilters, reelById]);

  const reusedCount = clips.filter(c => c.reelIds.length >= 2).length;

  function setColFilter(col, val) {
    setColFilters(prev => ({ ...prev, [col]: val }));
  }

  const filterInputStyle = {
    background: "var(--bg-3)",
    border: "1px solid var(--line-hard)",
    borderRadius: 3,
    color: "var(--fg)",
    fontFamily: "var(--f-mono)",
    fontSize: 10,
    padding: "3px 6px",
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
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
          placeholder="Global search: filename, path, or transcript text…"
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
              <th style={{ width: 70 }}>FPS</th>
              <th style={{ width: 110 }}>Size</th>
              <th style={{ width: 280 }}>Attached to</th>
            </tr>
            {/* Per-column filter row */}
            <tr>
              <th style={{ padding: "4px 6px" }}></th>
              <th style={{ padding: "4px 6px" }}>
                <input
                  type="text"
                  value={colFilters.filename}
                  onChange={e => setColFilter("filename", e.target.value)}
                  placeholder="filter…"
                  style={filterInputStyle}
                />
              </th>
              <th style={{ padding: "4px 6px" }}>
                <input
                  type="text"
                  value={colFilters.duration}
                  onChange={e => setColFilter("duration", e.target.value)}
                  placeholder="filter…"
                  style={filterInputStyle}
                />
              </th>
              <th style={{ padding: "4px 6px" }}>
                <input
                  type="text"
                  value={colFilters.fps}
                  onChange={e => setColFilter("fps", e.target.value)}
                  placeholder="filter…"
                  style={filterInputStyle}
                />
              </th>
              <th style={{ padding: "4px 6px" }}>
                <input
                  type="text"
                  value={colFilters.size}
                  onChange={e => setColFilter("size", e.target.value)}
                  placeholder="filter…"
                  style={filterInputStyle}
                />
              </th>
              <th style={{ padding: "4px 6px" }}>
                <input
                  type="text"
                  value={colFilters.attachedTo}
                  onChange={e => setColFilter("attachedTo", e.target.value)}
                  placeholder="filter…"
                  style={filterInputStyle}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan="6" style={{
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
                      <img
                        src={footageBrainThumbnailUrl(c.thumbnail_url)}
                        alt=""
                        onError={e => { e.target.style.display = "none"; }}
                      />
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
                    onClick={() => {
                      if (c.footage_file_id) {
                        window.open(footageBrainFileUrl(c.footage_file_id), "_blank");
                      }
                    }}
                    title={c.footage_file_id ? "Open in Footage Brain" : ""}
                  >
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
                      "{c.matched_chunks[0].text}"
                    </div>
                  )}
                </td>
                <td className="mono">{formatDuration(c.duration_seconds)}</td>
                <td className="mono dim">
                  {c.frame_rate ? c.frame_rate.toFixed(0) + " fps" : "—"}
                </td>
                <td className="mono dim">
                  {c.width && c.height ? c.width + "×" + c.height : "—"}
                  {c.is_vertical ? " · 9:16" : ""}
                </td>
                <td>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", position: "relative" }}>
                    {c.reelIds.length === 0 && <span className="dim">— orphan —</span>}
                    {c.reelIds.map(({ reel_id, link_id }) => {
                      const reel = reelById.get(reel_id);
                      const label = reel ? reel.id : reel_id;
                      return (
                        <span
                          key={reel_id}
                          style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
                        >
                          <span
                            className="lib-reel-chip"
                            title={reel?.title || reel_id}
                            onClick={() => reel && onOpen && onOpen(reel)}
                          >
                            {label}
                          </span>
                          <button
                            title={"Remove from " + (reel?.title || reel_id)}
                            onClick={e => { e.stopPropagation(); actions.removeAttachedFootage(link_id); }}
                            style={{
                              background: "none", border: "none",
                              color: "var(--fg-dim)", cursor: "pointer",
                              fontSize: 11, lineHeight: 1, padding: "0 2px",
                              borderRadius: 2,
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = "var(--c-red)"}
                            onMouseLeave={e => e.currentTarget.style.color = "var(--fg-dim)"}
                          >×</button>
                        </span>
                      );
                    })}
                    {/* + button to attach to additional reels */}
                    <div style={{ position: "relative", display: "inline-flex" }}>
                      <button
                        className="lib-attach-btn"
                        title="Attach / detach reels"
                        style={{
                          background: "transparent",
                          border: "1px solid var(--line-hard)",
                          borderRadius: "50%",
                          color: "var(--fg-dim)",
                          cursor: "pointer",
                          fontSize: 14,
                          fontWeight: 400,
                          width: 20,
                          height: 20,
                          lineHeight: "18px",
                          padding: 0,
                          textAlign: "center",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        onClick={e => {
                          e.stopPropagation();
                          setAttachPopover(prev =>
                            prev?.clipKey === c.key ? null : { clipKey: c.key }
                          );
                        }}
                      >
                        +
                      </button>
                      {attachPopover?.clipKey === c.key && (
                        <AttachPopover
                          clip={c}
                          reels={reels}
                          reelById={reelById}
                          actions={actions}
                          onClose={() => setAttachPopover(null)}
                        />
                      )}
                    </div>
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
