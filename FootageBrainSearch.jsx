/**
 * Footage Brain Search Modal
 * 
 * Integrated search UI for finding and attaching Footage Brain clips to reels.
 * Opens as a modal overlay; users search, preview results, and add to reel.
 */

import React, { useState } from "react";
import {
  searchFootageBrain,
  searchByFilename,
  checkFootageBrainHealth,
  formatSearchResultForAttachment,
} from "./footage-brain-client.js";

const SEARCH_MODES = [
  { key: "semantic", label: "Semantic", hint: "meaning + visual concepts" },
  { key: "keyword",  label: "Keyword",  hint: "exact transcript terms" },
  { key: "hybrid",   label: "Hybrid",   hint: "semantic + keyword" },
  { key: "filename", label: "Filename", hint: "match by file name" },
];

export function FootageBrainSearch({ reelId, onAttach, onClose, attachedIds = [] }) {
  const [query, setQuery] = useState("");
  const [mode, setMode]   = useState("semantic");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [footageBrainOnline, setFootageBrainOnline] = useState(true);
  // Track files added during this modal session so the button flips to "Added".
  // Seeded with anything already attached to this reel so re-opens don't show
  // already-attached items as "addable".
  const [addedThisSession, setAddedThisSession] = useState(() => new Set(attachedIds));

  // Check Footage Brain health on mount
  React.useEffect(() => {
    checkFootageBrainHealth()
      .then(isOnline => setFootageBrainOnline(isOnline))
      .catch(() => setFootageBrainOnline(false));
  }, []);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim() && mode !== "filename") {
      setResults([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = mode === "filename"
        ? await searchByFilename(query, { n_results: 100 })
        : await searchFootageBrain(query, { mode, n_results: 20 });
      setResults(response.results || []);
      if (response.results?.length === 0) {
        setError("No results found. Try a different search.");
      }
    } catch (err) {
      console.error("Search error:", err);
      setError(
        err.message?.includes("fetch")
          ? "Footage Brain is offline. Please check it's running on localhost:8765."
          : `Search failed: ${err.message || String(err)}`
      );
      setResults([]);
      setFootageBrainOnline(false);
    } finally {
      setLoading(false);
    }
  };

  const handleAddResult = (result) => {
    if (addedThisSession.has(result.video_file_id)) return;
    const footage = formatSearchResultForAttachment(result);
    footage.id = `footage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    footage.reel_id = reelId;
    onAttach(footage);
    setAddedThisSession(prev => {
      const next = new Set(prev);
      next.add(result.video_file_id);
      return next;
    });
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "var(--bg)",
          borderRadius: "8px",
          maxWidth: "800px",
          width: "90%",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            Search Footage Brain
            {addedThisSession.size > 0 && (
              <span style={{
                marginLeft: 10,
                fontSize: 12,
                fontWeight: 500,
                color: "var(--c-cyan, var(--accent))",
                fontFamily: "var(--f-mono)",
              }}>
                · {addedThisSession.size} attached
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 24,
              cursor: "pointer",
              color: "var(--fg-mute)",
              padding: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Search Form */}
        <div style={{ padding: "20px", borderBottom: "1px solid var(--border)" }}>
          {!footageBrainOnline && (
            <div
              style={{
                backgroundColor: "rgba(255, 100, 100, 0.1)",
                border: "1px solid rgba(255, 100, 100, 0.3)",
                color: "var(--fg-warn)",
                padding: "12px",
                borderRadius: "4px",
                marginBottom: "12px",
                fontSize: 12,
              }}
            >
              ⚠ Footage Brain appears offline (http://localhost:8765). Check that the backend is running.
            </div>
          )}
          <div style={{
            display: "flex",
            gap: "6px",
            marginBottom: "10px",
            flexWrap: "wrap",
          }}>
            {SEARCH_MODES.map(m => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                title={m.hint}
                style={{
                  padding: "5px 10px",
                  fontSize: 11,
                  fontFamily: "var(--f-mono)",
                  letterSpacing: "0.04em",
                  borderRadius: "3px",
                  cursor: "pointer",
                  border: "1px solid " + (mode === m.key ? "var(--c-cyan, var(--accent))" : "var(--border)"),
                  background: mode === m.key ? "rgba(107,214,224,0.08)" : "transparent",
                  color: mode === m.key ? "var(--c-cyan, var(--accent))" : "var(--fg-mute)",
                }}
              >
                {m.label}
              </button>
            ))}
            <div style={{
              fontSize: 10.5,
              color: "var(--fg-dim)",
              fontFamily: "var(--f-mono)",
              alignSelf: "center",
              marginLeft: "auto",
            }}>
              {SEARCH_MODES.find(m => m.key === mode)?.hint}
            </div>
          </div>
          <form onSubmit={handleSearch} style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                mode === "filename"
                  ? "e.g., '20241223', 'IMG_0512', 'drone'"
                  : mode === "keyword"
                  ? "Exact word in transcript…"
                  : "e.g., 'sunrise drone shot', 'people talking indoors'"
              }
              style={{
                flex: 1,
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                backgroundColor: "var(--bg-input)",
                color: "var(--fg)",
                fontSize: 14,
                fontFamily: "inherit",
              }}
              disabled={!footageBrainOnline}
            />
            <button
              type="submit"
              disabled={loading || !footageBrainOnline}
              style={{
                padding: "10px 20px",
                backgroundColor: loading ? "var(--fg-mute)" : "var(--accent)",
                color: "var(--bg)",
                border: "none",
                borderRadius: "4px",
                cursor: loading ? "default" : "pointer",
                fontSize: 14,
                fontWeight: 500,
                opacity: loading || !footageBrainOnline ? 0.5 : 1,
              }}
            >
              {loading ? "Searching…" : "Search"}
            </button>
          </form>
        </div>

        {/* Results List */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {error && (
            <div
              style={{
                backgroundColor: "rgba(255, 100, 100, 0.1)",
                border: "1px solid rgba(255, 100, 100, 0.3)",
                color: "var(--fg-warn)",
                padding: "12px",
                borderRadius: "4px",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {results.length === 0 && !loading && !error && (
            <div
              style={{
                color: "var(--fg-mute)",
                fontSize: 13,
                textAlign: "center",
                padding: "40px 20px",
            }}
            >
              Type a search query to find footage…
            </div>
          )}

          {results.map((result) => (
            <FootageResultCard
              key={result.video_file_id}
              result={result}
              added={addedThisSession.has(result.video_file_id)}
              onAdd={() => handleAddResult(result)}
              onPreview={() => {
                if (!result.video_file_id) return;
                window.open(
                  "http://localhost:5173/files/" + result.video_file_id,
                  "_blank",
                  "noopener,noreferrer"
                );
              }}
            />
          ))}
          {addedThisSession.size > 0 && (
            <div style={{
              marginTop: 12,
              display: "flex",
              justifyContent: "flex-end",
            }}>
              <button
                onClick={onClose}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "var(--accent)",
                  color: "var(--bg)",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                Done · {addedThisSession.size} attached
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Individual search result card
 */
function FootageResultCard({ result, onAdd, onPreview, added }) {
  const score = Math.round(result.best_score * 100);
  const topChunk = result.matched_chunks?.[0];

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
          width: "100px",
          height: "60px",
          backgroundColor: "var(--bg)",
          borderRadius: "2px",
          border: "1px solid var(--border)",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {result.thumbnail_path && (
          <img
            src={`/thumbnails/${result.thumbnail_path}`}
            alt={result.filename}
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
            fontSize: 13,
            fontWeight: 500,
            color: "var(--fg)",
            marginBottom: "4px",
            wordBreak: "break-word",
          }}
        >
          {result.filename}
        </div>

        <div
          style={{
            fontSize: 11,
            color: "var(--fg-mute)",
            marginBottom: "4px",
          }}
        >
          {result.duration_seconds ? `${result.duration_seconds.toFixed(1)}s` : "?"} ·{" "}
          {result.width}×{result.height} · {score}% match
        </div>

        {topChunk && (
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
            "{topChunk.text.slice(0, 80)}{topChunk.text.length > 80 ? "…" : ""}"
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            onClick={onAdd}
            disabled={added}
            style={{
              padding: "6px 12px",
              backgroundColor: added ? "transparent" : "var(--accent)",
              color: added ? "var(--c-green, var(--accent))" : "var(--bg)",
              border: added ? "1px solid var(--c-green, var(--accent))" : "none",
              borderRadius: "3px",
              cursor: added ? "default" : "pointer",
              fontSize: 11,
              fontWeight: 500,
              opacity: added ? 0.8 : 1,
            }}
          >
            {added ? "✓ Added" : "+ Add to Reel"}
          </button>
          {/* Preview opens the clip in the Footage Brain file
              detail page (new tab) so the editor can scrub before
              committing the attach. Disabled if the result has no
              file id to link to. */}
          <button
            onClick={onPreview}
            disabled={!result.video_file_id}
            title="Open clip in Footage Brain"
            style={{
              padding: "6px 12px",
              backgroundColor: "transparent",
              color: "var(--c-cyan, var(--accent))",
              border: "1px solid var(--c-cyan, var(--accent))",
              borderRadius: "3px",
              cursor: result.video_file_id ? "pointer" : "not-allowed",
              fontSize: 11,
              fontWeight: 500,
              opacity: result.video_file_id ? 1 : 0.5,
            }}
          >
            📺 Preview
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Truncate file path for display (e.g., "D:\Videos\..." instead of full path)
 */
function truncatePath(path, maxLen) {
  if (!path || path.length <= maxLen) return path;
  const parts = path.split(/[\\/]/);
  const filename = parts[parts.length - 1];
  const prefix = "...";
  const available = maxLen - prefix.length - filename.length - 2; // account for separator
  if (available <= 0) {
    return prefix + filename;
  }
  return prefix + parts.slice(-2, -1).join("\\") + "\\" + filename;
}
