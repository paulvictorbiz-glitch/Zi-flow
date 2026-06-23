/**
 * Music Picker Modal
 *
 * Search-and-attach modal for licensed music tracks (Epidemic Sound, proxied
 * server-side). Reuses the read-only Modal.jsx shell the same way the rest of
 * the app's modals do, and consumes ONLY frozen store names from useWorkflow():
 *
 *   searchMusic(term)                         → debounced catalog search
 *   upsertMusicTrack(track)                   → cache the chosen track row
 *   attachAsset(reelDnaId,'music',id,title)   → attach to the reel's DNA row
 *
 * The Keycloak/Epidemic user JWT never reaches the browser — search/preview/
 * download all go through the server proxy. When the proxy reports
 * `epidemic_token_expired` (surfaced VERBATIM by the store), we show the
 * "reconnect — see Paul" banner instead of a generic error.
 */

import React, { useState, useEffect, useRef } from "react";
import { useWorkflow } from "../store/store.jsx";
import { Modal } from "./modals/Modal.jsx";

// Detect the upstream token-expiry signal the store surfaces verbatim, in
// whatever wrapper it arrives (Error message, thrown string, or a
// { error: "epidemic_token_expired" } payload).
function isTokenExpired(x) {
  if (!x) return false;
  const s =
    typeof x === "string"
      ? x
      : x.message || x.error || x.code || String(x);
  return /epidemic_token_expired/i.test(s);
}

export function MusicPickerModal({ reelDnaId, onClose }) {
  const { actions } = useWorkflow();

  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  // Track ids attached during this session so the button flips to "Attached".
  const [attachedThisSession, setAttachedThisSession] = useState(() => new Set());
  // id of the track currently being attached (disables its button + shows ⏳).
  const [attaching, setAttaching] = useState(null);
  // id of the track currently previewing (only one <audio> plays at a time).
  const [previewId, setPreviewId] = useState(null);

  const debounceRef = useRef(null);
  const audioRef = useRef(null);
  const reqSeqRef = useRef(0); // guards against out-of-order debounced responses

  // Debounced search-as-you-type.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = term.trim();
    if (!q) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(q), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  // Stop any playing preview when the modal unmounts.
  useEffect(() => {
    return () => {
      try {
        audioRef.current?.pause();
      } catch {
        /* no-op */
      }
    };
  }, []);

  async function runSearch(q) {
    const seq = ++reqSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await actions.searchMusic(q);
      if (seq !== reqSeqRef.current) return; // a newer search superseded this
      if (isTokenExpired(res)) {
        setTokenExpired(true);
        setResults([]);
        return;
      }
      const list = normalizeResults(res);
      setResults(list);
      if (!list.length) setError("No tracks match that search.");
    } catch (e) {
      if (seq !== reqSeqRef.current) return;
      if (isTokenExpired(e)) {
        setTokenExpired(true);
        setResults([]);
      } else {
        setResults([]);
        setError("Search failed: " + (e?.message || String(e)));
      }
    } finally {
      if (seq === reqSeqRef.current) setLoading(false);
    }
  }

  async function handleAttach(track) {
    const id = trackId(track);
    if (!id || attachedThisSession.has(id) || attaching) return;
    setAttaching(id);
    setError(null);
    try {
      const up = await actions.upsertMusicTrack(track);
      if (isTokenExpired(up)) {
        setTokenExpired(true);
        return;
      }
      const at = await actions.attachAsset(
        reelDnaId,
        "music",
        id,
        track.title || track.name || "Untitled track"
      );
      if (isTokenExpired(at)) {
        setTokenExpired(true);
        return;
      }
      setAttachedThisSession((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    } catch (e) {
      if (isTokenExpired(e)) setTokenExpired(true);
      else setError("Attach failed: " + (e?.message || String(e)));
    } finally {
      setAttaching(null);
    }
  }

  function togglePreview(track, url) {
    const id = trackId(track);
    if (!url) return;
    const el = audioRef.current;
    if (!el) return;
    if (previewId === id) {
      el.pause();
      setPreviewId(null);
      return;
    }
    // Pause + reset the single element before swapping src so a previous
    // preview's stream stops buffering. Set the id BEFORE play() so the
    // async failure handler clears the right state (no brief playing flicker).
    el.pause();
    el.src = url;
    setPreviewId(id);
    el.play().catch(() => {
      /* autoplay/network failure — leave UI un-toggled */
      setPreviewId(null);
    });
  }

  return (
    <Modal
      title="Attach licensed music"
      subtitle="Search the music catalog, preview, and attach a track to this reel."
      onClose={onClose}
      onSubmit={onClose}
      submitLabel="Done"
    >
      {/* One shared audio element — only one preview plays at a time. */}
      <audio
        ref={audioRef}
        onEnded={() => setPreviewId(null)}
        style={{ display: "none" }}
      />

      {tokenExpired ? (
        <ReconnectBanner />
      ) : (
        <>
          <div className="m-field" style={{ marginBottom: 12 }}>
            <input
              type="text"
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search tracks — mood, genre, artist, title…"
              className="m-input"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: 4,
                background: "var(--bg-input)",
                color: "var(--fg)",
                fontSize: 14,
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
            {attachedThisSession.size > 0 && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  fontFamily: "var(--f-mono)",
                  color: "var(--c-green, var(--accent))",
                }}
              >
                · {attachedThisSession.size} attached
              </div>
            )}
          </div>

          {error && (
            <div
              style={{
                background: "rgba(255,100,100,0.1)",
                border: "1px solid rgba(255,100,100,0.3)",
                color: "var(--fg-warn)",
                padding: 12,
                borderRadius: 4,
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              maxHeight: "46vh",
              overflowY: "auto",
            }}
          >
            {loading && (
              <div
                style={{
                  color: "var(--fg-mute)",
                  fontSize: 13,
                  textAlign: "center",
                  padding: "24px 12px",
                }}
              >
                Searching…
              </div>
            )}

            {!loading && !error && !term.trim() && (
              <div
                style={{
                  color: "var(--fg-mute)",
                  fontSize: 13,
                  textAlign: "center",
                  padding: "32px 12px",
                }}
              >
                Type to search the music catalog…
              </div>
            )}

            {results.map((track) => {
              const id = trackId(track);
              return (
                <MusicResultRow
                  key={id}
                  track={track}
                  attached={attachedThisSession.has(id)}
                  attaching={attaching === id}
                  previewing={previewId === id}
                  onAttach={() => handleAttach(track)}
                  onTogglePreview={(url) => togglePreview(track, url)}
                />
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}

function ReconnectBanner() {
  return (
    <div
      style={{
        background: "rgba(245,165,36,0.12)",
        border: "1px solid var(--c-amber, rgba(245,165,36,0.4))",
        color: "var(--c-amber, var(--fg-warn))",
        padding: 16,
        borderRadius: 6,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        ⚠ Music library disconnected
      </div>
      The Epidemic Sound session has expired and needs to be reconnected. Search
      and downloads are paused until it's refreshed — see Paul to reconnect.
    </div>
  );
}

function MusicResultRow({
  track,
  attached,
  attaching,
  previewing,
  onAttach,
  onTogglePreview,
}) {
  const cover = trackCover(track);
  const title = track.title || track.name || "Untitled track";
  const artist = trackArtist(track);
  const previewUrl = trackPreview(track);
  const duration = trackDuration(track);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 4,
        padding: 10,
        background: "var(--bg-alt)",
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}
    >
      {/* Cover */}
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 3,
          overflow: "hidden",
          flexShrink: 0,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {cover ? (
          <img
            src={cover}
            alt={title}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <span style={{ fontSize: 20 }} role="img" aria-label="music">
            🎵
          </span>
        )}
      </div>

      {/* Meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--fg)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={title}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--fg-mute)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {artist || "Unknown artist"}
          {duration ? ` · ${duration}` : ""}
        </div>
      </div>

      {/* Mini preview */}
      <button
        type="button"
        onClick={() => onTogglePreview(previewUrl)}
        disabled={!previewUrl}
        title={previewUrl ? "Preview" : "No preview available"}
        style={{
          padding: "6px 10px",
          background: "transparent",
          color: "var(--c-cyan, var(--accent))",
          border: "1px solid var(--c-cyan, var(--accent))",
          borderRadius: 3,
          cursor: previewUrl ? "pointer" : "not-allowed",
          fontSize: 11,
          fontWeight: 500,
          opacity: previewUrl ? 1 : 0.4,
          whiteSpace: "nowrap",
        }}
      >
        {previewing ? "⏸ Stop" : "▶ Preview"}
      </button>

      {/* Attach */}
      <button
        type="button"
        onClick={onAttach}
        disabled={attached || attaching}
        style={{
          padding: "6px 12px",
          background: attached ? "transparent" : "var(--accent)",
          color: attached ? "var(--c-green, var(--accent))" : "var(--bg)",
          border: attached
            ? "1px solid var(--c-green, var(--accent))"
            : "none",
          borderRadius: 3,
          cursor: attached || attaching ? "default" : "pointer",
          fontSize: 11,
          fontWeight: 500,
          opacity: attaching ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {attached ? "✓ Attached" : attaching ? "⏳ …" : "+ Attach"}
      </button>
    </div>
  );
}

/* ---------- defensive field accessors -------------------------------------
   The catalog row shape isn't owned here, so read each display field through
   a small accessor that tolerates the common naming variants rather than
   hard-coding one schema (and opening store.jsx/api files to learn it). The
   attach contract itself is fixed: id + title. */

function trackId(t) {
  return (
    t?.id ||
    t?.track_id ||
    t?.trackId ||
    t?.epidemic_id ||
    t?.uuid ||
    ""
  );
}

function trackCover(t) {
  return (
    t?.cover ||
    t?.cover_url ||
    t?.coverUrl ||
    t?.image ||
    t?.image_url ||
    t?.artwork ||
    t?.thumbnail ||
    ""
  );
}

function trackArtist(t) {
  const a = t?.artist || t?.artists || t?.artist_name || t?.creator || "";
  if (Array.isArray(a)) {
    return a
      .map((x) => (typeof x === "string" ? x : x?.name || ""))
      .filter(Boolean)
      .join(", ");
  }
  return typeof a === "string" ? a : a?.name || "";
}

function trackPreview(t) {
  return (
    t?.preview_url ||
    t?.previewUrl ||
    t?.preview ||
    t?.waveform_url ||
    t?.audio_url ||
    t?.mp3 ||
    ""
  );
}

function trackDuration(t) {
  const secs =
    t?.duration_seconds ?? t?.duration ?? t?.length ?? t?.length_seconds;
  if (secs == null || isNaN(Number(secs))) {
    return typeof t?.duration === "string" ? t.duration : "";
  }
  const s = Math.round(Number(secs));
  const m = Math.floor(s / 60);
  const r = String(s % 60).padStart(2, "0");
  return `${m}:${r}`;
}

// Normalize whatever search shape comes back into a flat array of tracks.
function normalizeResults(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  return res.results || res.tracks || res.items || res.data || [];
}
