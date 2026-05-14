/**
 * Attached Footage List
 * 
 * Displays footage items attached to a reel.
 * Shows: filename, source path, duration, preview/copy/remove actions.
 */

import React from "react";

export function AttachedFootageList({ items, onRemove }) {
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
        />
      ))}
    </div>
  );
}

/**
 * Individual attached footage item
 */
function AttachedFootageItem({ index, item, onRemove }) {
  const durationText = item.duration_seconds
    ? `${item.duration_seconds.toFixed(1)}s`
    : "?";

  const copyPath = () => {
    navigator.clipboard.writeText(item.source_path).then(() => {
      alert("Path copied to clipboard!");
    });
  };

  const openPreview = () => {
    // Open in Footage Brain preview (if frontend is at localhost:5173)
    // We construct a link to the Footage Brain file detail page
    window.open(
      `http://localhost:5173/files/${item.footage_file_id}`,
      "_blank"
    );
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
            src={`/thumbnails/${item.thumbnail_url}`}
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
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "8px",
            marginBottom: "4px",
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "var(--fg-mute)",
              fontWeight: 500,
            }}
          >
            #{index}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--fg)",
              wordBreak: "break-word",
            }}
          >
            {item.filename}
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--fg-mute)",
              whiteSpace: "nowrap",
            }}
          >
            ({durationText})
          </span>
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
            onClick={copyPath}
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
            📋 Copy Path
          </button>
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
        </div>
      </div>
    </div>
  );
}
