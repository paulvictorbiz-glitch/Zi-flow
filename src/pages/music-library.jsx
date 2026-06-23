/* =========================================================
   Music Library — browse the owner's Epidemic Sound catalog,
   keep favorites, and organize tracks into playlists.

   Frozen export name `MusicLibrary` (app.jsx lazy-imports it).
   Consumes ONLY the public useWorkflow() surface — never store.jsx
   internals or any api file:

     Catalog (Epidemic proxy):
       · actions.searchMusic(term, opts?)    -> { ok, tracks, error? }
       · actions.getMusicDownload(id, opts?)  -> { ok, url, expires, error? }
       · actions.upsertMusicTrack(track)
       · actions.attachAsset(reelDnaId, 'music', trackId, label?)
     Library (per-user, migration 0093):
       · musicFavorites / musicPlaylists / musicPlaylistTracks / musicTracks
       · actions.toggleMusicFavorite(track)
       · actions.createMusicPlaylist(name) -> id
       · actions.renameMusicPlaylist(id, name) / deleteMusicPlaylist(id)
       · actions.addTrackToPlaylist(id, track) / removeTrackFromPlaylist(id, trackId)

   Views: Search · Browse (genre/mood) · Favorites · Playlists.
   A SINGLE <audio> element drives preview across every view.
   ========================================================= */

import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useWorkflow } from "../store/store.jsx";
import "./music-library.css";

const SEARCH_DEBOUNCE_MS = 350;

/* Epidemic Sound taxonomy (curated) for the Browse view. The search proxy takes
   { filters: { genres, moods } }; clicking a chip runs a filtered search. */
const GENRES = [
  "Acoustic", "Ambient", "Beats", "Blues", "Children's", "Cinematic", "Classical",
  "Comedy", "Country", "Drama", "Electronica", "Folk", "Funk", "Hip Hop", "Holiday",
  "Indie Pop", "Jazz", "Latin", "Lo-fi", "Pop", "R&B", "Reggae", "Rock", "Scoring",
  "Soul", "Soundtrack", "Synth", "World",
];
const MOODS = [
  "Angry", "Busy", "Dark", "Dreamy", "Eccentric", "Elegant", "Epic", "Euphoric",
  "Fear", "Floating", "Funny", "Glamorous", "Happy", "Heavy", "Hopeful", "Laid back",
  "Mysterious", "Peaceful", "Quirky", "Restless", "Romantic", "Running", "Sad",
  "Sentimental", "Smooth", "Suspense",
];

const VIEWS = [
  { key: "search", label: "Search" },
  { key: "browse", label: "Browse" },
  { key: "favorites", label: "Favorites" },
  { key: "playlists", label: "Playlists" },
];

function formatLength(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return "—";
  const total = Math.max(0, Math.round(Number(sec)));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function normTrack(t) {
  if (!t || typeof t !== "object") return null;
  return {
    id: t.id != null ? String(t.id) : "",
    title: t.title || "Untitled",
    artist: t.artist || "",
    bpm: t.bpm ?? null,
    lengthSec: t.lengthSec ?? null,
    moods: Array.isArray(t.moods) ? t.moods.filter(Boolean) : [],
    genres: Array.isArray(t.genres) ? t.genres.filter(Boolean) : [],
    coverUrl: t.coverUrl || null,
    previewUrl: t.previewUrl || null,
  };
}

/* ---- One track card, shared by every view ---- */
function TrackCard({
  track, isPlaying, onTogglePreview,
  isFavorite, onToggleFavorite,
  onDownload, downloading,
  playlists, onAddToPlaylist, onCreatePlaylistWith,
  attachableReels, onAttach,
  inPlaylistRemove,
}) {
  const [menu, setMenu] = useState(null); // 'playlist' | 'reel' | null
  const [newName, setNewName] = useState("");

  return (
    <article className="ml-card">
      <div className="ml-cover">
        {track.coverUrl ? (
          <img src={track.coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="ml-cover-fallback" aria-hidden="true">♪</div>
        )}
        {track.previewUrl && (
          <button
            type="button"
            className={`ml-play${isPlaying ? " is-playing" : ""}`}
            onClick={() => onTogglePreview(track)}
            aria-label={isPlaying ? "Pause preview" : "Play preview"}
            title={isPlaying ? "Pause preview" : "Play preview"}
          >
            {isPlaying ? "❚❚" : "▶"}
          </button>
        )}
        <button
          type="button"
          className={`ml-fav${isFavorite ? " is-fav" : ""}`}
          onClick={() => onToggleFavorite(track)}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
          title={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          {isFavorite ? "♥" : "♡"}
        </button>
      </div>

      <div className="ml-meta">
        <div className="ml-track-title" title={track.title}>{track.title}</div>
        {track.artist && <div className="ml-track-artist" title={track.artist}>{track.artist}</div>}
        <div className="ml-track-stats">
          <span className="ml-stat">{formatLength(track.lengthSec)}</span>
          {track.bpm != null && <span className="ml-stat">{track.bpm} BPM</span>}
        </div>
        {(track.moods.length > 0 || track.genres.length > 0) && (
          <div className="ml-tags">
            {track.genres.slice(0, 2).map((g) => (
              <span key={`g-${g}`} className="ml-tag ml-tag--genre">{g}</span>
            ))}
            {track.moods.slice(0, 2).map((m) => (
              <span key={`m-${m}`} className="ml-tag ml-tag--mood">{m}</span>
            ))}
          </div>
        )}
      </div>

      <div className="ml-actions">
        <button
          type="button"
          className="ml-btn ml-btn--primary"
          onClick={() => onDownload(track)}
          disabled={downloading}
        >
          {downloading ? "…" : "Download"}
        </button>

        <div className="ml-menuwrap">
          <button
            type="button"
            className="ml-btn ml-btn--ghost"
            onClick={() => setMenu((m) => (m === "playlist" ? null : "playlist"))}
            aria-haspopup="menu"
            aria-expanded={menu === "playlist"}
            title="Add to playlist"
          >
            ＋ Playlist
          </button>
          {menu === "playlist" && (
            <div className="ml-menu" role="menu" onMouseLeave={() => setMenu(null)}>
              {playlists.length === 0 && <div className="ml-menu-empty">No playlists yet</div>}
              {playlists.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="ml-menu-item"
                  role="menuitem"
                  onClick={() => { onAddToPlaylist(p.id, track); setMenu(null); }}
                >
                  {p.name}
                </button>
              ))}
              <div className="ml-menu-new">
                <input
                  className="ml-menu-input"
                  placeholder="New playlist…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newName.trim()) {
                      onCreatePlaylistWith(newName.trim(), track);
                      setNewName(""); setMenu(null);
                    }
                  }}
                />
                <button
                  type="button"
                  className="ml-btn ml-btn--mini"
                  disabled={!newName.trim()}
                  onClick={() => { onCreatePlaylistWith(newName.trim(), track); setNewName(""); setMenu(null); }}
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>

        {inPlaylistRemove && (
          <button type="button" className="ml-btn ml-btn--danger" onClick={inPlaylistRemove}>
            Remove
          </button>
        )}

        {attachableReels && attachableReels.length > 0 && (
          <div className="ml-menuwrap">
            <button
              type="button"
              className="ml-btn ml-btn--ghost"
              onClick={() => setMenu((m) => (m === "reel" ? null : "reel"))}
              aria-haspopup="menu"
              aria-expanded={menu === "reel"}
            >
              Attach…
            </button>
            {menu === "reel" && (
              <div className="ml-menu" role="menu" onMouseLeave={() => setMenu(null)}>
                {attachableReels.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="ml-menu-item"
                    role="menuitem"
                    onClick={() => { onAttach(track, r); setMenu(null); }}
                  >
                    {r.title || r.reelUrl || r.id}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export function MusicLibrary() {
  const {
    actions, reelDna,
    musicTracks = [], musicFavorites = [], musicPlaylists = [], musicPlaylistTracks = [],
  } = useWorkflow();

  const [view, setView] = useState("search");

  // Search state
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [searchTracks, setSearchTracks] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Browse state
  const [browseSel, setBrowseSel] = useState(null); // { kind:'genre'|'mood', value }
  const [browseTracks, setBrowseTracks] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  // Shared
  const [error, setError] = useState("");
  const [tokenExpired, setTokenExpired] = useState(false);
  const [playingId, setPlayingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [openPlaylistId, setOpenPlaylistId] = useState(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const audioRef = useRef(null);

  /* ---- Favorites/cache lookups ---- */
  const favSet = useMemo(
    () => new Set((musicFavorites || []).map((f) => String(f.trackId))),
    [musicFavorites]
  );
  const trackById = useMemo(() => {
    const m = new Map();
    for (const t of musicTracks || []) if (t && t.id != null) m.set(String(t.id), normTrack(t));
    return m;
  }, [musicTracks]);

  /* ---- Debounced search ---- */
  useEffect(() => {
    const h = setTimeout(() => setDebounced(term.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [term]);

  useEffect(() => {
    if (!debounced) { setSearchTracks([]); setSearched(false); setError(""); return; }
    let cancelled = false;
    setSearchLoading(true); setError("");
    (async () => {
      try {
        const res = await actions.searchMusic(debounced);
        if (cancelled) return;
        if (!res || res.ok === false) {
          setSearchTracks([]);
          if (res?.error === "epidemic_token_expired") setTokenExpired(true);
          else setError(res?.error || "Search failed.");
        } else {
          setSearchTracks((res.tracks || []).map(normTrack).filter(Boolean));
          setTokenExpired(false);
        }
      } catch (e) {
        if (!cancelled) { setSearchTracks([]); setError(e?.message || String(e)); }
      } finally {
        if (!cancelled) { setSearchLoading(false); setSearched(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [debounced, actions]);

  /* ---- Browse: filtered search on chip click ---- */
  const runBrowse = useCallback(async (kind, value) => {
    setBrowseSel({ kind, value });
    setBrowseLoading(true); setError("");
    try {
      const filters = kind === "genre" ? { genres: [value] } : { moods: [value] };
      const res = await actions.searchMusic(value, { filters });
      if (!res || res.ok === false) {
        setBrowseTracks([]);
        if (res?.error === "epidemic_token_expired") setTokenExpired(true);
        else setError(res?.error || "Browse failed.");
      } else {
        setBrowseTracks((res.tracks || []).map(normTrack).filter(Boolean));
        setTokenExpired(false);
      }
    } catch (e) {
      setBrowseTracks([]); setError(e?.message || String(e));
    } finally {
      setBrowseLoading(false);
    }
  }, [actions]);

  /* ---- Single-instance preview ---- */
  const togglePreview = useCallback((track) => {
    const el = audioRef.current;
    if (!el || !track.previewUrl) return;
    if (playingId === track.id) { el.pause(); setPlayingId(null); return; }
    el.pause();
    el.src = track.previewUrl;
    setPlayingId(track.id);
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => setPlayingId(null));
  }, [playingId]);

  /* ---- Download ---- */
  const handleDownload = useCallback(async (track) => {
    setDownloadingId(track.id);
    try {
      const res = await actions.getMusicDownload(track.id);
      if (!res || res.ok === false) {
        if (res?.error === "epidemic_token_expired") setTokenExpired(true);
        else setError(res?.error || "Download failed.");
        return;
      }
      setTokenExpired(false);
      if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setDownloadingId(null);
    }
  }, [actions]);

  /* ---- Library mutations ---- */
  const onToggleFavorite = useCallback((track) => { actions.toggleMusicFavorite(track); }, [actions]);
  const onAddToPlaylist = useCallback((pid, track) => { actions.addTrackToPlaylist(pid, track); }, [actions]);
  const onCreatePlaylistWith = useCallback(async (name, track) => {
    const id = await actions.createMusicPlaylist(name);
    if (id && track) actions.addTrackToPlaylist(id, track);
  }, [actions]);

  const attachableReels = useMemo(
    () => (reelDna || []).filter((r) => r && r.id != null && !r.archivedAt),
    [reelDna]
  );
  const onAttach = useCallback(async (track, reel) => {
    try {
      await actions.upsertMusicTrack(track);
      actions.attachAsset(reel.id, "music", track.id, track.title);
    } catch (e) { setError(e?.message || String(e)); }
  }, [actions]);

  /* ---- Derived lists ---- */
  const favoriteTracks = useMemo(
    () => Array.from(favSet).map((id) => trackById.get(id)).filter(Boolean),
    [favSet, trackById]
  );

  const playlistsSorted = useMemo(
    () => [...(musicPlaylists || [])].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    [musicPlaylists]
  );
  const playlistCount = useMemo(() => {
    const m = new Map();
    for (const t of musicPlaylistTracks || []) m.set(t.playlistId, (m.get(t.playlistId) || 0) + 1);
    return m;
  }, [musicPlaylistTracks]);
  const openPlaylist = useMemo(
    () => playlistsSorted.find((p) => p.id === openPlaylistId) || null,
    [playlistsSorted, openPlaylistId]
  );
  const openPlaylistTracks = useMemo(() => {
    if (!openPlaylistId) return [];
    return (musicPlaylistTracks || [])
      .filter((t) => t.playlistId === openPlaylistId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((t) => trackById.get(String(t.trackId)))
      .filter(Boolean);
  }, [openPlaylistId, musicPlaylistTracks, trackById]);

  /* Shared card-prop builder so every grid renders identical cards. */
  const cardProps = (t, extra = {}) => ({
    track: t,
    isPlaying: playingId === t.id,
    onTogglePreview: togglePreview,
    isFavorite: favSet.has(t.id),
    onToggleFavorite,
    onDownload: handleDownload,
    downloading: downloadingId === t.id,
    playlists: playlistsSorted,
    onAddToPlaylist,
    onCreatePlaylistWith,
    attachableReels,
    onAttach,
    ...extra,
  });

  return (
    <div className="ml-page">
      <header className="ml-head">
        <h1 className="ml-title">Music Library</h1>
        <p className="ml-sub">
          Search and browse the Epidemic Sound catalog, preview, download licensed
          tracks, favorite the ones you love, and build playlists.
        </p>
      </header>

      <nav className="ml-viewnav" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            className={`ml-viewtab${view === v.key ? " is-active" : ""}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
            {v.key === "favorites" && favoriteTracks.length > 0 && (
              <span className="ml-count">{favoriteTracks.length}</span>
            )}
            {v.key === "playlists" && playlistsSorted.length > 0 && (
              <span className="ml-count">{playlistsSorted.length}</span>
            )}
          </button>
        ))}
      </nav>

      {tokenExpired && (
        <div className="ml-banner ml-banner--warn" role="alert">
          Music library needs reconnecting — see Paul.
        </div>
      )}
      {error && !tokenExpired && (
        <div className="ml-banner ml-banner--error" role="alert">{error}</div>
      )}

      {/* SINGLE shared preview element */}
      <audio ref={audioRef} className="ml-audio" preload="none" onEnded={() => setPlayingId(null)} />

      {/* ---------- SEARCH ---------- */}
      {view === "search" && (
        <>
          <div className="ml-searchbar">
            <input
              className="ml-search"
              type="search"
              placeholder="Search tracks, artists, moods…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              autoFocus
            />
            {searchLoading && <span className="ml-search-status">Searching…</span>}
          </div>
          <main className="ml-results">
            {!searched && !searchLoading && <p className="ml-empty">Start typing to search the catalog.</p>}
            {searched && !searchLoading && searchTracks.length === 0 && <p className="ml-empty">No tracks match.</p>}
            <div className="ml-grid">
              {searchTracks.map((t) => <TrackCard key={t.id} {...cardProps(t)} />)}
            </div>
          </main>
        </>
      )}

      {/* ---------- BROWSE ---------- */}
      {view === "browse" && (
        <main className="ml-results">
          <div className="ml-browse">
            <div className="ml-browse-group">
              <span className="ml-chip-label">Genres</span>
              <div className="ml-chip-grid">
                {GENRES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`ml-chip${browseSel?.kind === "genre" && browseSel?.value === g ? " is-active" : ""}`}
                    onClick={() => runBrowse("genre", g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div className="ml-browse-group">
              <span className="ml-chip-label">Moods</span>
              <div className="ml-chip-grid">
                {MOODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`ml-chip${browseSel?.kind === "mood" && browseSel?.value === m ? " is-active" : ""}`}
                    onClick={() => runBrowse("mood", m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {browseSel && (
            <div className="ml-browse-results">
              <h2 className="ml-section-title">
                {browseSel.kind === "genre" ? "Genre" : "Mood"}: {browseSel.value}
                {browseLoading && <span className="ml-search-status"> · loading…</span>}
              </h2>
              {!browseLoading && browseTracks.length === 0 && <p className="ml-empty">No tracks found.</p>}
              <div className="ml-grid">
                {browseTracks.map((t) => <TrackCard key={t.id} {...cardProps(t)} />)}
              </div>
            </div>
          )}
          {!browseSel && <p className="ml-empty">Pick a genre or mood to browse.</p>}
        </main>
      )}

      {/* ---------- FAVORITES ---------- */}
      {view === "favorites" && (
        <main className="ml-results">
          {favoriteTracks.length === 0 && (
            <p className="ml-empty">No favorites yet — tap the ♡ on any track to save it here.</p>
          )}
          <div className="ml-grid">
            {favoriteTracks.map((t) => <TrackCard key={t.id} {...cardProps(t)} />)}
          </div>
        </main>
      )}

      {/* ---------- PLAYLISTS ---------- */}
      {view === "playlists" && (
        <main className="ml-results">
          {!openPlaylist && (
            <>
              <div className="ml-newplaylist">
                <input
                  className="ml-search"
                  placeholder="New playlist name…"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newPlaylistName.trim()) {
                      actions.createMusicPlaylist(newPlaylistName.trim());
                      setNewPlaylistName("");
                    }
                  }}
                />
                <button
                  type="button"
                  className="ml-btn ml-btn--primary"
                  disabled={!newPlaylistName.trim()}
                  onClick={() => { actions.createMusicPlaylist(newPlaylistName.trim()); setNewPlaylistName(""); }}
                >
                  Create playlist
                </button>
              </div>

              {playlistsSorted.length === 0 && <p className="ml-empty">No playlists yet.</p>}
              <div className="ml-playlist-list">
                {playlistsSorted.map((p) => (
                  <div key={p.id} className="ml-playlist-row">
                    <button
                      type="button"
                      className="ml-playlist-open"
                      onClick={() => setOpenPlaylistId(p.id)}
                    >
                      <span className="ml-playlist-name">{p.name}</span>
                      <span className="ml-playlist-count">{playlistCount.get(p.id) || 0} tracks</span>
                    </button>
                    <button
                      type="button"
                      className="ml-btn ml-btn--danger ml-btn--mini"
                      onClick={() => {
                        if (window.confirm(`Delete playlist "${p.name}"?`)) actions.deleteMusicPlaylist(p.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {openPlaylist && (
            <>
              <div className="ml-playlist-head">
                <button type="button" className="ml-btn ml-btn--ghost" onClick={() => setOpenPlaylistId(null)}>
                  ‹ Back
                </button>
                <input
                  className="ml-playlist-title-input"
                  value={openPlaylist.name}
                  onChange={(e) => actions.renameMusicPlaylist(openPlaylist.id, e.target.value)}
                  aria-label="Playlist name"
                />
                <button
                  type="button"
                  className="ml-btn ml-btn--danger"
                  onClick={() => {
                    if (window.confirm(`Delete playlist "${openPlaylist.name}"?`)) {
                      actions.deleteMusicPlaylist(openPlaylist.id);
                      setOpenPlaylistId(null);
                    }
                  }}
                >
                  Delete playlist
                </button>
              </div>
              {openPlaylistTracks.length === 0 && (
                <p className="ml-empty">
                  Empty playlist. Add tracks from Search or Browse with the ＋ Playlist button.
                </p>
              )}
              <div className="ml-grid">
                {openPlaylistTracks.map((t) => (
                  <TrackCard
                    key={t.id}
                    {...cardProps(t, {
                      inPlaylistRemove: () => actions.removeTrackFromPlaylist(openPlaylist.id, t.id),
                    })}
                  />
                ))}
              </div>
            </>
          )}
        </main>
      )}
    </div>
  );
}

export default MusicLibrary;
