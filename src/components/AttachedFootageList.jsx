/**
 * Attached Footage List
 * 
 * Displays footage items attached to a reel.
 * Shows: filename, source path, duration, preview/copy/remove actions.
 */

import React, { useState } from "react";
import {
  footageBrainThumbnailUrl,
  footageFolderLabel,
  getFootageTranscript,
} from "../lib/footage-brain-client.js";
import { supabase } from "../lib/supabase-client.js";

/* Seconds → "M:SS" for transcript timecodes (e.g. 75 → "1:15"). */
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function AttachedFootageList({ items, onRemove, canRemove = true, beatTitleByItemId = {} }) {
  if (!items || items.length === 0) {
    return (
      <div
        style={{
          padding: "20px",
          textAlign: "center",
          color: "var(--fg-mute)",
          fontSize: 12,
        }}
      >
        No footage attached yet.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      {items.map((item, idx) => (
        <AttachedFootageItem
          key={item.id}
          index={idx + 1}
          item={item}
          onRemove={() => onRemove(item.id)}
          canRemove={canRemove}
          beatTitle={beatTitleByItemId[item.id] || null}
        />
      ))}
    </div>
  );
}

/**
 * Individual attached footage item
 */
function AttachedFootageItem({ index, item, onRemove, canRemove = true, beatTitle = null }) {
  const durationText = item.duration_seconds
    ? `${item.duration_seconds.toFixed(1)}s`
    : "?";
  const folder = footageFolderLabel(item.source_path);
  // Per-file Drive link, falling back to the clip's Drive folder.
  const driveLink = item.drive_url || item.drive_folder_url || null;

  /* In-app transcript viewer (no video download). Collapsed by default.
     On first expand: use item.full_transcript if already cached (migration
     0024 added that jsonb column), otherwise fetch from FootageBrain, render
     it, and persist the chunks back onto the row so it's instant next time. */
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcript, setTranscript] = useState(
    Array.isArray(item.full_transcript) ? item.full_transcript : null
  );
  const [tLoading, setTLoading] = useState(false);
  const [tError, setTError] = useState(null);

  const toggleTranscript = async () => {
    const next = !showTranscript;
    setShowTranscript(next);
    // Only fetch on first open, and only when we don't already have chunks.
    if (!next || transcript || tLoading) return;
    if (!item.footage_file_id) {
      setTranscript([]);   // nothing to fetch (e.g. AI-draft clip with no FB id)
      return;
    }
    setTLoading(true);
    setTError(null);
    try {
      const chunks = await getFootageTranscript(item.footage_file_id);
      const arr = Array.isArray(chunks) ? chunks : [];
      setTranscript(arr);
      // Cache for next time (best-effort — a failed write shouldn't surface).
      if (arr.length && item.id) {
        supabase
          .from("attached_footage_items")
          .update({ full_transcript: arr })
          .eq("id", item.id)
          .then(() => {}, () => {});
      }
    } catch (e) {
      setTError("Couldn't load transcript");
      setTranscript([]);
    } finally {
      setTLoading(false);
    }
  };

  const openPreview = () => {
    // Prefer the Drive link — it's the reliably-viewable asset and works in
    // production. Fall back to the local Footage Brain file page for dev only.
    if (driveLink) {
      window.open(driveLink, "_blank", "noopener,noreferrer");
      return;
    }
    window.open(`http://localhost:8765/files/${item.footage_file_id}`, "_blank");
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "4px",
        padding: "12px",
        backgroundColor: "var(--bg-alt)",
        display: "flex",
        gap: "12px",
        alignItems: "flex-start",
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          width: "80px",
          height: "50px",
          backgroundColor: "var(--bg)",
          borderRadius: "2px",
          border: "1px solid var(--border)",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {item.thumbnail_url && (
          <img
            src={footageBrainThumbnailUrl(item.thumbnail_url)}
            alt={item.filename}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
            onError={(e) => {
              e.target.style.display = "none";
            }}
          />
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: "6px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
            <span style={{ fontSize: 11, color: "var(--fg-mute)", fontWeight: 500, flexShrink: 0 }}>
              #{index}
            </span>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--fg)", overflowWrap: "anywhere", minWidth: 0 }}>
              {item.filename}
            </span>
          </div>
          {/* Beat-plan scene title for this clip (from the reel's AI draft) —
              maps the scene to the footage. Hidden when there's no real link. */}
          {beatTitle && (
            <div style={{ marginTop: "5px" }}>
              <span
                title="Beat plan scene this clip covers"
                style={{
                  display: "inline-block",
                  fontSize: 10.5,
                  color: "var(--c-violet, #a78bfa)",
                  background: "var(--c-violet-soft, rgba(167,139,250,0.12))",
                  border: "1px solid var(--c-violet-soft, rgba(167,139,250,0.35))",
                  borderRadius: 8,
                  padding: "1px 8px",
                  overflowWrap: "anywhere",
                }}
              >
                🎬 {beatTitle}
              </span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", flexWrap: "wrap" }}>
            {folder && (
              <span style={{
                fontSize: 10.5, fontFamily: "var(--f-mono)", color: "var(--c-cyan, #22d3ee)",
                border: "1px solid var(--c-cyan-soft, var(--border))", borderRadius: 8,
                padding: "1px 7px", whiteSpace: "nowrap",
              }}>
                📁 {folder}
              </span>
            )}
            <span style={{ fontSize: 11, color: "var(--fg-mute)", whiteSpace: "nowrap" }}>
              ({durationText})
            </span>
          </div>
        </div>

        {item.best_score && (
          <div
            style={{
              fontSize: 11,
              color: "var(--fg-mute)",
              marginBottom: "8px",
            }}
          >
            Match score: {Math.round(item.best_score * 100)}%
          </div>
        )}

        {item.matched_chunks && item.matched_chunks.length > 0 && (
          <div
            style={{
              fontSize: 11,
              color: "var(--fg-mute)",
              fontStyle: "italic",
              marginBottom: "8px",
              maxHeight: "40px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            💬 "{item.matched_chunks[0].text.slice(0, 60)}{item.matched_chunks[0].text.length > 60 ? "…" : ""}"
          </div>
        )}

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          {driveLink ? (
            <a
              href={driveLink}
              target="_blank"
              rel="noopener noreferrer"
              title={item.drive_url ? "Open this clip on Google Drive" : "Open this clip's folder on Google Drive"}
              style={{
                padding: "6px 12px",
                backgroundColor: "transparent",
                border: "1px solid var(--c-cyan, #22d3ee)",
                color: "var(--c-cyan, #22d3ee)",
                borderRadius: "3px",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              ↗ Google Drive
            </a>
          ) : (
            <span style={{ fontSize: 10.5, color: "var(--fg-mute)", alignSelf: "center" }}>
              no Drive link
            </span>
          )}
          <button
            onClick={openPreview}
            style={{
              padding: "6px 12px",
              backgroundColor: "transparent",
              border: "1px solid var(--accent)",
              color: "var(--accent)",
              borderRadius: "3px",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            📺 Preview
          </button>
          <button
            onClick={toggleTranscript}
            title="Read this clip's transcript in-app (no download)"
            style={{
              padding: "6px 12px",
              backgroundColor: "transparent",
              border: "1px solid var(--border)",
              color: "var(--fg-mute)",
              borderRadius: "3px",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            📄 Transcript {showTranscript ? "▴" : "▾"}
          </button>
          {/* Removal is owner-configurable — editors with `removeFootage` off
              don't see this button at all. */}
          {canRemove && (
            <button
              onClick={onRemove}
              style={{
                padding: "6px 12px",
                backgroundColor: "transparent",
                border: "1px solid rgba(255, 100, 100, 0.3)",
                color: "var(--fg-warn)",
                borderRadius: "3px",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              ✕ Remove
            </button>
          )}
        </div>

        {/* Transcript panel — scrollable, compact, monospace timecoded lines. */}
        {showTranscript && (
          <div
            style={{
              marginTop: "8px",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              backgroundColor: "var(--bg)",
              maxHeight: "180px",
              overflowY: "auto",
              padding: "8px 10px",
              fontFamily: "var(--f-mono)",
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            {tLoading ? (
              <div style={{ color: "var(--fg-mute)" }}>Loading transcript…</div>
            ) : tError ? (
              <div style={{ color: "var(--fg-warn)" }}>{tError}</div>
            ) : transcript && transcript.length > 0 ? (
              transcript.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "2px" }}>
                  <span style={{ color: "var(--c-cyan, #22d3ee)", flexShrink: 0 }}>
                    {fmtTime(c.start_time)}
                  </span>
                  <span style={{ color: "var(--fg)", overflowWrap: "anywhere" }}>
                    {c.text}
                  </span>
                </div>
              ))
            ) : (
              <div style={{ color: "var(--fg-mute)" }}>No transcript available</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
