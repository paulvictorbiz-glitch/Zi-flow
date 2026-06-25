/* =========================================================
   Reel Detail — minimal dashboard.
   Three working surfaces only:
     · Footage Brain search + attached-footage list
     · Reel Blueprint (logline · script · voiceover)
     · Comments + feedback
   Everything else was non-functioning scaffolding and got removed.
   ========================================================= */

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Card, DPill } from "../components/components.jsx";
import { ReelPlayer } from "../components/reel-player.jsx";
import { ReelCompareModal } from "../components/ReelCompareModal.jsx";
import { shareReelToChannel, getRecordingStreamUrl } from "../lib/social-client.js";
import { useWorkflow } from "../store/store.jsx";
import { useAuth } from "../auth.jsx";
import { supabase } from "../lib/supabase-client.js";
import { usePermissions, useIsOwner } from "../lib/permissions.jsx";
import { useRoster } from "../lib/roster.jsx";
import { useNotifications } from "../components/notifications.jsx";
import { FootageBrainSearch } from "../components/FootageBrainSearch.jsx";
import { getFootageFileMetadata, driveDownloadUrl } from "../lib/footage-brain-client.js";
import { AttachedFootageList } from "../components/AttachedFootageList.jsx";
import { MusicPickerModal } from "../components/MusicPickerModal.jsx";
import { ChatRecordingPicker } from "../components/ChatRecordingPicker.jsx";
import { resolveReelDnaAssets } from "../store/store.jsx";
import { useLocations } from "../lib/locations-data.jsx";
import { PipelineDnaAssets } from "../components/pipeline-dna-assets.jsx";
import { AssetAttachPicker } from "../components/asset-attach-picker.jsx";
import { ThumbPreview } from "./thumbnail-dna.jsx";
import { extractYouTubeId, thumbnailUrlFromId } from "../lib/thumbnail-dna.jsx";
import { SKILLS } from "../lib/training-curriculum.jsx";
import GamifyRubricSheet from "../components/GamifyRubricSheet.jsx";

const SOL_DETAIL_CSS = `
[data-theme="solarin"] .det-wrap {
  max-width: 1280px; margin: 0 auto; padding: 28px 32px; box-sizing: border-box;
}
[data-theme="solarin"] .det-back {
  font-family: var(--f-label); font-size: 11px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--s-fg-muted);
  background: none; border: none; cursor: pointer; padding: 0 0 8px;
  display: inline-flex; align-items: center; gap: 4px;
}
[data-theme="solarin"] .det-back:hover { color: var(--mint); }
[data-theme="solarin"] .det-crumb {
  font-family: var(--f-label); font-size: 10px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--peach); margin-bottom: 6px;
}
[data-theme="solarin"] .det-title {
  font-family: var(--f-ui); font-size: 28px; font-weight: 700;
  color: var(--s-fg); text-shadow: 0 2px 16px rgba(0,0,0,.85); margin-bottom: 8px;
}
[data-theme="solarin"] .det-body {
  display: grid; grid-template-columns: 300px 1fr 320px; gap: 20px; margin-top: 20px;
}
[data-theme="solarin"] .det-preview {
  aspect-ratio: 9/16;
  background: linear-gradient(160deg, #1a2a26, #0e1211);
  border: 1px solid var(--s-border);
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
[data-theme="solarin"] .det-content-panel {
  background: var(--s-panel); border: 1px solid var(--s-border);
  backdrop-filter: blur(4px); padding: 16px 20px; margin-bottom: 12px;
}
[data-theme="solarin"] .det-panel-head {
  font-family: var(--f-label); font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .12em; color: var(--peach);
  margin-bottom: 12px;
}
[data-theme="solarin"] .det-content-row {
  display: flex; gap: 16px; padding: 8px 0;
  border-bottom: 1px solid var(--s-divider-soft); font-size: 13px;
}
[data-theme="solarin"] .det-content-key {
  font-family: var(--f-label); font-size: 10.5px; color: var(--peach);
  text-transform: uppercase; letter-spacing: .08em; min-width: 90px; flex-shrink: 0;
}
[data-theme="solarin"] .det-content-val {
  font-family: var(--f-ui); color: var(--s-fg-body);
}
[data-theme="solarin"] .det-check-row {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 0; font-family: var(--f-ui); font-size: 13px;
}
[data-theme="solarin"] .det-check-done { color: var(--s-fg-muted); text-decoration: line-through; }
[data-theme="solarin"] .det-check-active { color: var(--peach); }
[data-theme="solarin"] .det-cb-done {
  width: 16px; height: 16px; border-radius: 50%; background: var(--teal);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 9px; flex-shrink: 0;
}
[data-theme="solarin"] .det-cb-active {
  width: 16px; height: 16px; border-radius: 50%;
  border: 1.5px solid var(--peach); flex-shrink: 0;
}

/* ── Generic (theme-agnostic) reel-card fixes ──────────────────────────────
   (B) Keep the inspiration / compare / keep-in-mind column pinned to the
   top-right instead of collapsing to a full-width row beneath the columns.
   The higher-specificity .det-body.detail-grid selector beats the stock
   max-width:1280px rule in styles.css. */
@media (max-width: 1280px) {
  .det-body.detail-grid { grid-template-columns: 300px 1fr 320px; }
  .det-body .detail-col--ref {
    grid-column: auto;
    border-top: 0;
    flex-direction: column;
    flex-wrap: nowrap;
  }
}
/* (A) Let the Reel Blueprint textarea fill the available space like the
   comment box — full width (the redundant label column is dropped in JSX)
   and a generous height so long scripts aren't cut off. */
.blueprint-body.bp-fill { grid-template-columns: 1fr; display: block; }
.blueprint-body.bp-fill textarea { min-height: 300px; }

/* (E) Self-contained styles for the restored Thumbnails / News attach cards —
   reel-dna.css (where these classes also live) is not imported on this page,
   so scope a copy under .det-wrap to guarantee correct rendering here. */
.det-wrap .rd-asset-thumb-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.det-wrap .rd-asset-thumb-wrap { position: relative; display: inline-flex; align-items: flex-start; gap: 2px; }
.det-wrap .rd-asset-thumb {
  display: block; width: 64px; height: 36px;
  border: 1px solid var(--line); border-radius: 4px;
  overflow: hidden; background: var(--bg-3);
}
.det-wrap .rd-asset-thumb img,
.det-wrap .rd-asset-thumb .td-thumb-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.det-wrap .rd-asset-thumb-stub {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%;
  font-family: var(--f-mono); font-size: 9px; color: var(--fg-dim);
}
.det-wrap .rd-asset-news-list { display: flex; flex-direction: column; gap: 6px; }
.det-wrap .rd-asset-news {
  display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
  font-family: var(--f-sans); font-size: 12px; line-height: 1.35;
}
.det-wrap .rd-asset-news a { color: var(--c-cyan); text-decoration: none; min-width: 0; word-break: break-word; }
.det-wrap .rd-asset-news a:hover { text-decoration: underline; }
.det-wrap .rd-asset-detach {
  appearance: none; cursor: pointer; background: transparent; border: 0;
  color: var(--fg-dim); font-size: 11px; line-height: 1; padding: 0 2px; margin-left: 4px;
}
.det-wrap .rd-asset-detach:hover { color: var(--c-red); }
`;

/* Blueprint fields start empty for every reel — operators fill them in. */
const DEFAULT_LOGLINE = "";
const DEFAULT_SCRIPT  = "";
const DEFAULT_VO      = "";

/* Comments start empty so each reel begins with a clean conversation. */
const DEFAULT_COMMENTS = [];

/* The `detail` jsonb still carries legacy slices (checklists, variants,
   handoff package, etc.) for old reels — we just don't render them
   anymore. Preserve them on read/write so nothing is destroyed; only
   `comments` is rendered. */
function defaultDetail() {
  return { comments: DEFAULT_COMMENTS };
}

function initials(name) {
  if (!name) return "??";
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatCommentTs(iso) {
  if (!iso) return "";
  // Pre-existing seed entries already use display strings ("11:08").
  if (!/^\d{4}-/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Always show full date + time so feedback context is unambiguous
  // across days. Example: "May 14, 2026 · 14:32".
  const datePart = d.toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return datePart + " · " + hh + ":" + mm;
}

/* Read-only blueprint field — shown to roles whose per-field edit permission
   is off (editLogline / editScript / editVoiceover). Renders the saved text as
   a clearly non-editable but readable block: muted fill, dashed border,
   pre-wrapped text, default cursor — no save-on-blur handler is attached, so
   these roles can read but never change the value. Empty values show a dim
   "Nothing written yet." placeholder. */
function ReadOnlyField({ value, mono }) {
  const empty = !String(value || "").trim();
  return (
    <div
      aria-readonly="true"
      style={{
        background: "var(--bg-2)",
        border: "1px dashed var(--line-hard)",
        borderRadius: 4,
        color: empty ? "var(--fg-dim)" : "var(--fg)",
        fontFamily: mono ? "var(--f-mono)" : "var(--f-sans)",
        fontSize: 12.5,
        lineHeight: 1.5,
        padding: "9px 11px",
        minHeight: 110,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        cursor: "default",
        userSelect: "text",
      }}
    >
      {empty ? "Nothing written yet." : value}
    </div>
  );
}

function LocationPicker({ reelId }) {
  const { locations, loaded, actions } = useLocations();
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const addRef = useRef(null);

  const linked = useMemo(
    () => locations.filter(l => (l.linkedReelIds || []).includes(reelId)),
    [locations, reelId]
  );

  const available = useMemo(() => {
    const linkedIds = new Set(linked.map(l => l.id));
    const q = search.trim().toLowerCase();
    return locations.filter(l => !linkedIds.has(l.id) && (!q || l.name.toLowerCase().includes(q)));
  }, [locations, linked, search]);

  const detach = (locationId) => actions.unlinkReel(locationId, reelId);
  const attach = (locationId) => { actions.linkReel(locationId, reelId); setAddOpen(false); setSearch(""); };

  useEffect(() => {
    if (!addOpen) return;
    const handler = (e) => { if (addRef.current && !addRef.current.contains(e.target)) setAddOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [addOpen]);

  return (
    <Card title="Filming location" footLeft="Pin this reel to a place on the map">
      {!loaded ? (
        <div className="mono dim" style={{ fontSize: 11 }}>loading places…</div>
      ) : locations.length === 0 ? (
        <div className="mono dim" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
          No places yet. Add pins on the <b style={{ color: "var(--fg-mute)" }}>Locations</b> page,
          then link one here.
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {linked.map(loc => (
            <span key={loc.id} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "var(--bg-2)", border: "1px solid var(--line-hard)",
              borderRadius: 12, padding: "3px 10px",
              fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg)",
            }}>
              {/* Click the pin → focus it on the in-app Locations map. requestFocus
                  stashes the id in the provider; the Locations page reads it on
                  mount to switch to the interactive map, select + pan to the pin. */}
              <button
                type="button"
                onClick={() => {
                  actions.requestFocus(loc.id);
                  if (typeof window !== "undefined" && window.__navigate) window.__navigate("locations");
                }}
                title={"Show " + loc.name + " on the Locations map"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  background: "none", border: "none", padding: 0, margin: 0,
                  font: "inherit", color: "var(--c-cyan)", cursor: "pointer",
                }}
              >
                📍 {loc.name}
              </button>
              <button onClick={() => detach(loc.id)} title="Remove location link"
                style={{ background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}>
                ✕
              </button>
            </span>
          ))}
          <div style={{ position: "relative" }} ref={addRef}>
            <button onClick={() => setAddOpen(o => !o)}
              style={{ background: "none", border: "1px dashed var(--line-hard)", borderRadius: 12, color: "var(--fg-dim)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "3px 10px", cursor: "pointer" }}>
              + Add location
            </button>
            {addOpen && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 999,
                background: "var(--bg-2)", border: "1px solid var(--line-hard)",
                borderRadius: 6, padding: "6px 0", minWidth: 200, maxHeight: 220, overflowY: "auto",
                boxShadow: "0 8px 24px rgba(0,0,0,0.6)"
              }}>
                <div style={{ padding: "4px 10px 6px" }}>
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search locations…" autoFocus
                    style={{ width: "100%", background: "var(--bg-3, #1a2335)", border: "1px solid var(--line-hard)", borderRadius: 3, color: "var(--fg)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "4px 8px", boxSizing: "border-box" }} />
                </div>
                {available.length === 0 ? (
                  <div style={{ padding: "8px 12px", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-dim)" }}>No locations found</div>
                ) : available.slice(0, 20).map(loc => (
                  <button key={loc.id} onClick={() => attach(loc.id)}
                    style={{ display: "block", width: "100%", background: "none", border: "none", textAlign: "left", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg)", padding: "6px 12px", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--bg-3, #1a2335)"}
                    onMouseLeave={e => e.currentTarget.style.background = "none"}
                  >
                    📍 {loc.name}{loc.category ? ` · ${loc.category}` : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function ReelDetail({ reel, onBack, onLearnSkill, openCompare = false, onCompareMounted }) {
  /* reel is passed from Pipeline when a card is clicked. Default to REEL-201. */
  const current = reel || { id: "REEL-201", title: "Temple crowd sequence" };

  /* Hook into the canonical store. `stored` is the DB-backed
     record for the currently displayed reel — what we read seed
     values from and what we write Blueprint edits back into. */
  const { reels, actions, reelDnaAssets, musicTracks, thumbnailDna, monitorEvents } = useWorkflow();
  const { can } = usePermissions();
  const isOwner = useIsOwner();
  const { peopleList } = useRoster();
  const canAttach = can("attachFootage");
  const canColor = can("changeCardColor");
  /* Owner-configurable per-field edit gates. Editors get these flipped off in
     the permissions catalog, so the logline / beat plan / voiceover render as
     read-only blocks and the footage ✕ Remove button is hidden for them. */
  const canEditLogline   = can("editLogline");
  const canEditScript    = can("editScript");
  const canEditVoiceover = can("editVoiceover");
  const canRemoveFootage = can("removeFootage");
  const canTagSkills     = can("tagReelSkills");
  const stored = reels.find(r => r.id === current.id);
  const skillTags = stored?.skill_tags || [];

  /* Toggle one syllabus skill tag on this reel (writes reels.skill_tags). */
  const toggleSkillTag = (key) => {
    if (!stored) return;
    const cur = stored.skill_tags || [];
    const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
    actions.updateReel(current.id, { skill_tags: next });
  };

  const [showCompare, setShowCompare] = useState(false);
  // Auto-open compare when app was navigated to via ?reel=X&compare=1 deep-link.
  useEffect(() => {
    if (openCompare && stored) {
      setShowCompare(true);
      onCompareMounted?.();
    }
  }, [openCompare, stored]);

  const [blueprintTab, setBlueprintTab] = useState("script");
  const [logline, setLogline]     = useState(stored?.logline ?? DEFAULT_LOGLINE);
  // Shot plan reads `script`, falling back to the legacy `plan` column so reels
  // created by the modal (which used to save to `plan`) still show their text.
  const [script, setScript]       = useState(stored?.script ?? stored?.plan ?? DEFAULT_SCRIPT);
  const [vo, setVo]               = useState(stored?.vo ?? DEFAULT_VO);
  const [titleVal, setTitleVal]   = useState(stored?.title ?? current.title ?? "");
  const [editingTitle, setEditingTitle] = useState(false);
  // "Keep in mind while editing" — one bullet per line, stored in detail.editNotes.
  const [editNotes, setEditNotes] = useState(stored?.detail?.editNotes ?? "");
  const [editNotesEditing, setEditNotesEditing] = useState(false);

  /* Seed the editable fields from `stored` ONCE per reel id, the first time
     that record is available. A ref guards against re-seeding on every `stored`
     change (realtime echoes would otherwise clobber in-flight edits), while
     still fixing the bug where a freshly-created reel opened before its row was
     in the local store and the fields initialised blank forever. */
  const seededIdRef = useRef(null);
  useEffect(() => {
    if (seededIdRef.current === current.id) return;
    if (stored) {
      setLogline(stored.logline ?? DEFAULT_LOGLINE);
      setScript(stored.script ?? stored.plan ?? DEFAULT_SCRIPT);
      setVo(stored.vo ?? DEFAULT_VO);
      setTitleVal(stored.title ?? current.title ?? "");
      setEditNotes(stored.detail?.editNotes ?? "");
      seededIdRef.current = current.id;       // seeded — stop here until id changes
    } else {
      // Record not in the store yet: clear to defaults (don't show the prior
      // reel's values); the next run seeds once `stored` arrives.
      setLogline(DEFAULT_LOGLINE);
      setScript(DEFAULT_SCRIPT);
      setVo(DEFAULT_VO);
      setTitleVal(current.title ?? "");
      setEditNotes("");
    }
  }, [current.id, stored]);

  /* Save-on-blur helper: only writes if the value actually
     changed, so passive tab-outs are free. */
  const saveIfChanged = (key, value) => {
    if (!stored) return;
    if (stored[key] === value) return;
    actions.updateReel(current.id, { [key]: value });
  };

  /* Detail blob — single jsonb on the reel. Holds checklists,
     variants, handoff package, allowed/no-touch lists, the
     per-reel task composer queue, and the ReadyForReview stage.
     Auto-saved on a 300ms debounce after the last edit. */
  const [detail, setDetail] = useState(() => stored?.detail || defaultDetail());

  /* Re-seed when the user navigates to a different reel. NOT
     dependent on `stored.detail` — otherwise realtime echoes
     would clobber in-flight edits. */
  useEffect(() => {
    setDetail(stored?.detail || defaultDetail());
  }, [current.id]);

  /* Always open a reel scrolled to the top. Opening a reel reuses the same
     ReelDetail instance (only the `reel` prop changes), so without this the
     page keeps the previous reel's scroll position — landing the user
     mid-page on the new reel. The whole window/body scrolls here (the `.app`
     shell is min-height:100vh and grows with content; the topbar is sticky),
     so resetting window scroll is what matters. `.app` is reset too as a
     belt-and-braces no-op in case a future layout makes it the scroller. */
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector(".app")?.scrollTo?.(0, 0);
  }, [current.id]);

  /* Mark this reel's comments as read on open and when the
     comment list grows while the user is viewing it. The
     notifications context handles the per-user storage. */
  const { markRead } = useNotifications();
  useEffect(() => {
    if (current?.id) markRead(current.id);
  }, [current?.id, stored?.detail?.comments?.length, markRead]);

  /* Debounced save. Skips no-ops by structural-equality check. */
  useEffect(() => {
    if (!stored) return;
    const same = JSON.stringify(detail) === JSON.stringify(stored.detail || defaultDetail());
    if (same) return;
    const t = setTimeout(() => {
      actions.updateReel(current.id, { detail });
    }, 300);
    return () => clearTimeout(t);
  }, [detail, stored]);

  /* Comments render from a LIVE union of the store (realtime — so a comment
     posted from team chat or another session shows immediately without
     reopening) and the local optimistic slice (so a just-typed comment shows
     instantly with no debounce flicker). Deduped by id; once a local comment
     is persisted+echoed it exists in `stored` and the local dupe drops. The
     rest of `detail` (blueprint slices) stays local/debounced so realtime
     echoes never clobber in-flight edits. */
  const comments = useMemo(() => {
    const live = stored?.detail?.comments;
    const local = detail.comments;
    const liveArr = Array.isArray(live) ? live : [];
    const localArr = Array.isArray(local) ? local : [];
    if (!liveArr.length && !localArr.length) return DEFAULT_COMMENTS;
    const seen = new Set(liveArr.map(c => c.id));
    return [...liveArr, ...localArr.filter(c => !seen.has(c.id))];
  }, [stored?.detail?.comments, detail.comments]);

  /* updateSlice mutates one key without touching the others, so
     legacy slices ride through the debounced save unchanged. */
  const updateSlice = (key) => (next) =>
    setDetail(d => ({ ...d, [key]: typeof next === "function" ? next(d[key] ?? []) : next }));

  /* "Keep in mind while editing" notes → detail.editNotes (debounced save). */
  const saveEditNotes = () => {
    setEditNotesEditing(false);
    if ((stored?.detail?.editNotes ?? "") === editNotes) return;
    updateSlice("editNotes")(editNotes);
  };

  const { person: me } = useAuth();
  const [draftComment, setDraftComment] = useState("");

  const postComment = () => {
    const txt = draftComment.trim();
    if (!txt) return;
    const entry = {
      id: "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
      authorId: me?.id ?? null,
      who: me?.short || initials(me?.name) || "ME",
      role: me?.name || "You",
      ts: new Date().toISOString(),
      txt,
    };
    updateSlice("comments")(arr => [...(arr || []), entry]);
    setDraftComment("");
  };

  const deleteComment = (id) => {
    updateSlice("comments")(arr => (arr || []).filter(c => c.id !== id));
  };

  /* Footage Brain search modal state */
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  // When set, the Footage search modal opens straight into a folder browse
  // (clicked the 📁 link on an attached clip → all of that country's clips).
  const [folderToBrowse, setFolderToBrowse] = useState(null);
  const handleOpenFolder = (path, label) => {
    setFolderToBrowse({ path, label });
    setSearchModalOpen(true);
  };
  const closeSearchModal = () => { setSearchModalOpen(false); setFolderToBrowse(null); };

  /* Attached-music modal state. The music attaches to the reel's DNA card id
     (the same id PipelineDnaAssets uses), falling back to the reel's own id so
     the picker still works for reels not minted from a Reel DNA row. */
  const reelDnaId =
    current.reelDnaId ||
    stored?.detail?.fromReelDna ||
    current.detail?.fromReelDna ||
    current.id;
  const [musicModalOpen, setMusicModalOpen] = useState(false);
  // Resolve attached music tracks from the polymorphic reel_dna_assets join.
  const attachedMusic = useMemo(
    () =>
      resolveReelDnaAssets(reelDnaId, {
        reelDnaAssets: reelDnaAssets || [],
        musicTracks: musicTracks || [],
      }).music,
    [reelDnaId, reelDnaAssets, musicTracks]
  );
  // Per-track download UI state: { [id]: "loading" | "error" }.
  const [musicDlState, setMusicDlState] = useState({});
  const handleMusicDownload = async (track) => {
    const id = track?.id;
    if (id == null) return;
    setMusicDlState(s => ({ ...s, [id]: "loading" }));
    try {
      const res = await actions.getMusicDownload(id);
      if (res?.ok && res.url) {
        window.open(res.url, "_blank", "noopener,noreferrer");
        setMusicDlState(s => { const n = { ...s }; delete n[id]; return n; });
      } else {
        setMusicDlState(s => ({ ...s, [id]: "error" }));
      }
    } catch {
      setMusicDlState(s => ({ ...s, [id]: "error" }));
    }
  };
  const handleRemoveMusic = (track) => {
    if (track?.id == null) return;
    actions.detachAsset(reelDnaId, "music", track.id);
  };

  /* ── Attached thumbnails + news (from Pulse), resolved from the same
       polymorphic reel_dna_assets join the music card uses. These attach
       controls went missing in the new card design — restored here so a
       reel can pull thumbnails (Thumbnails tab) and news (Pulse) again. */
  const attachedThumbnails = useMemo(
    () =>
      resolveReelDnaAssets(reelDnaId, {
        reelDnaAssets: reelDnaAssets || [],
        thumbnailDna: thumbnailDna || [],
      }).thumbnails,
    [reelDnaId, reelDnaAssets, thumbnailDna]
  );
  const attachedNews = useMemo(
    () =>
      resolveReelDnaAssets(reelDnaId, {
        reelDnaAssets: reelDnaAssets || [],
        monitorEvents: monitorEvents || [],
      }).news,
    [reelDnaId, reelDnaAssets, monitorEvents]
  );
  const thumbnailOpts = useMemo(
    () => (thumbnailDna || []).map(t => ({
      id: t.id, label: t.title || t.videoUrl || "Thumbnail", sublabel: t.videoId || undefined,
    })),
    [thumbnailDna]
  );
  const newsOpts = useMemo(
    () => (monitorEvents || []).map(n => ({
      id: n.id, label: n.title || "Untitled", sublabel: n.sourceName || n.sourceUrl || undefined,
    })),
    [monitorEvents]
  );
  const thumbAttachedIds = useMemo(
    () => new Set(attachedThumbnails.map(t => String(t.id))),
    [attachedThumbnails]
  );
  const newsAttachedIds = useMemo(
    () => new Set(attachedNews.map(n => String(n.id))),
    [attachedNews]
  );
  const [thumbInput, setThumbInput] = useState("");
  const [newsTitle, setNewsTitle] = useState("");
  const [newsUrl, setNewsUrl] = useState("");
  const [newsBusy, setNewsBusy] = useState(false);
  const handleAttachThumbnails = (picks) => {
    for (const p of picks) actions.attachAsset(reelDnaId, "thumbnail", p.id, p.label);
  };
  const handleAttachNews = (picks) => {
    for (const p of picks) actions.attachAsset(reelDnaId, "news", p.id, p.label);
  };
  const handleAddThumbnail = () => {
    const vid = extractYouTubeId(thumbInput);
    if (!vid) return;
    const created = actions.createThumbnailDnaCapture({
      videoUrl: thumbInput.trim(),
      videoId: vid,
      thumbnailUrl: thumbnailUrlFromId(vid),
    });
    if (created?.id) actions.attachAsset(reelDnaId, "thumbnail", created.id, created.title || created.videoUrl);
    setThumbInput("");
  };
  const handleAddNews = async () => {
    if (!newsTitle.trim() || newsBusy) return;
    setNewsBusy(true);
    try {
      const ev = await actions.createMonitorEvent({
        title: newsTitle.trim(),
        sourceUrl: newsUrl.trim() || undefined,
        sourceType: "manual",
        publishedAt: new Date().toISOString(),
      });
      if (ev?.id) actions.attachAsset(reelDnaId, "news", ev.id, ev.title);
      setNewsTitle(""); setNewsUrl("");
    } catch {
      /* createMonitorEvent surfaces its own error to the store */
    } finally {
      setNewsBusy(false);
    }
  };
  const handleDetachThumbnail = (id) => actions.detachAsset(reelDnaId, "thumbnail", id);
  const handleDetachNews = (id) => actions.detachAsset(reelDnaId, "news", id);

  /* Get attached footage for this reel from store */
  const { attachedFootage } = useWorkflow();
  const reelAttachedFootageRaw = attachedFootage.filter(f => f.reel_id === current.id);

  /* The attached_footage_items table has no drive_url column. The clip's Drive
     link is recovered from (in order): the reel's detail (AI draft / footageDrive
     map) and, universally, a live lookup by footage_file_id against FootageBrain
     — so even clips attached before drive-link support get a link with no
     re-attach. `driveById` caches those lookups for this session. */
  const [driveById, setDriveById] = useState({});
  useEffect(() => {
    const missing = [...new Set(reelAttachedFootageRaw.map(f => f.footage_file_id).filter(Boolean))]
      .filter(id => !(id in driveById));
    if (!missing.length) return;
    let alive = true;
    (async () => {
      const updates = {};
      await Promise.all(missing.map(async id => {
        try {
          const file = await getFootageFileMetadata(id);
          updates[id] = { drive_url: file?.drive_url || null, drive_folder_url: file?.drive_folder_url || null };
        } catch { updates[id] = { drive_url: null, drive_folder_url: null }; }
      }));
      if (alive) setDriveById(prev => ({ ...prev, ...updates }));
    })();
    return () => { alive = false; };
  }, [reelAttachedFootageRaw]);

  const reelAttachedFootage = React.useMemo(() => {
    const det = detail || {};
    const aiClips = det.aiDraft?.clips || stored?.detail?.aiDraft?.clips || [];
    const footageDrive = det.footageDrive || stored?.detail?.footageDrive || {};
    const driveByKey = {};
    aiClips.forEach(c => {
      const info = { drive_url: c.drive_url || null, drive_folder_url: c.drive_folder_url || null };
      if (c.clip_id) driveByKey[c.clip_id] = info;
      if (c.filename) driveByKey[c.filename] = info;
    });
    return reelAttachedFootageRaw.map(f => {
      const fetched = driveById[f.footage_file_id] || {};
      const hit = footageDrive[f.footage_file_id] || driveByKey[f.footage_file_id] || driveByKey[f.filename] || {};
      return {
        ...f,
        drive_url: f.drive_url || hit.drive_url || fetched.drive_url || null,
        drive_folder_url: f.drive_folder_url || hit.drive_folder_url || fetched.drive_folder_url || null,
      };
    });
  }, [reelAttachedFootageRaw, detail, stored?.detail, driveById]);

  /* Beat-plan scene title per footage card.
     ────────────────────────────────────────
     The reel's AI draft (detail.aiDraft) links each clip to a beat. The
     authoritative scene text is the clip's OWN one-line note — the generator
     prompt defines clips[].note as "one-line editor note tying this clip to a
     beat" (e.g. "walking through manila"), which is exactly the per-scene
     label the user wants on each card. The flow[] array's `beat` is only a
     generic structural label ("Hook" / "Build" / "Payoff" / "CTA") and its
     `timecode` is a reel-timeline range ("0-15s") that doesn't line up with a
     clip's in/out source timecodes — so flow is a weak last resort, used only
     when a clip carries no note of its own.

     Match each attached `item` to its draft clip by footage_file_id↔clip_id
     or by filename. If no clip / no title is found, the item simply gets no
     tag (we never invent a title). Absent aiDraft → empty map → no change. */
  const beatTitleByItemId = React.useMemo(() => {
    const det = detail || {};
    const aiDraft = det.aiDraft || stored?.detail?.aiDraft || null;
    const clips = aiDraft?.clips || [];
    if (!clips.length) return {};

    // Index clips by both keys we can match an attached item against.
    const clipByKey = {};
    clips.forEach(c => {
      if (c.clip_id) clipByKey[c.clip_id] = c;
      if (c.filename) clipByKey[c.filename] = c;
    });

    // Generic flow labels carry no scene meaning on their own — only fall back
    // to a flow beat when it's NOT one of these structural names.
    const STRUCTURAL = /^(hook|build|payoff|cta|intro|outro|setup)$/i;
    const flow = Array.isArray(aiDraft?.flow) ? aiDraft.flow : [];

    const map = {};
    reelAttachedFootage.forEach((item, idx) => {
      const clip = clipByKey[item.footage_file_id] || clipByKey[item.filename];
      if (!clip) return;
      // 1) the clip's own scene/beat/note text (the real per-scene label)
      let title = clip.note || clip.scene || clip.beat || "";
      // 2) last resort: the same-position flow beat, but only if descriptive
      if (!title && flow[idx] && flow[idx].beat && !STRUCTURAL.test(flow[idx].beat.trim())) {
        title = flow[idx].beat;
      }
      title = String(title || "").trim();
      if (title) map[item.id] = title;
    });
    return map;
  }, [reelAttachedFootage, detail, stored?.detail]);

  const handleAttachFootage = (footage) => {
    actions.addAttachedFootage(footage);
    // Record the clip's Drive link in the reel's detail (the footage table has
    // no drive column) so the card can show "↗ Google Drive". Saved via the
    // debounced detail persist.
    if (footage.footage_file_id && (footage.drive_url || footage.drive_folder_url)) {
      setDetail(d => ({
        ...d,
        footageDrive: {
          ...(d.footageDrive || {}),
          [footage.footage_file_id]: {
            drive_url: footage.drive_url || null,
            drive_folder_url: footage.drive_folder_url || null,
          },
        },
      }));
    }
    // Modal stays open so the user can keep adding multiple clips.
  };

  const handleRemoveFootage = (footageId) => {
    actions.removeAttachedFootage(footageId);
  };

  /* ── "Download all" — bulk-pull every attached clip's Drive video ──────────
     Reuses the Drive links already resolved onto each item in
     `reelAttachedFootage` (detail.footageDrive / aiDraft.clips / live FB
     lookup), so no link resolution is duplicated here.

     · A direct FILE link → converted to a uc?export=download URL and pulled by
       clicking a throwaway <a download>. Browsers drop a burst of synchronous
       downloads, so picks are staggered ~300ms apart.
     · A FOLDER-only link (no single file) → opened in a new tab instead.
     · No Drive links at all → a short inline notice, nothing downloaded. */
  const [downloadStatus, setDownloadStatus] = useState(null);   // inline toast text
  const [downloading, setDownloading]       = useState(false);  // disables the button
  const downloadTimersRef = useRef([]);
  // Clear any pending staggered-download timers on unmount / reel switch.
  useEffect(() => () => downloadTimersRef.current.forEach(clearTimeout), [current.id]);

  const handleDownloadAll = () => {
    if (downloading) return;
    downloadTimersRef.current.forEach(clearTimeout);
    downloadTimersRef.current = [];

    const files = [];    // { url: direct-download, name }
    const folders = [];  // folder links we can only open, not download
    reelAttachedFootage.forEach(item => {
      const link = item.drive_url || item.drive_folder_url || null;
      if (!link) return;
      const dl = driveDownloadUrl(link);
      if (dl) files.push({ url: dl, name: item.filename || "" });
      else if (/\/folders\//.test(link)) folders.push(link);
    });

    if (!files.length && !folders.length) {
      setDownloadStatus("No downloadable Drive links");
      return;
    }

    setDownloading(true);
    // Trigger each file download via a temporary anchor, staggered so the
    // browser doesn't coalesce/drop them.
    files.forEach((f, i) => {
      const t = setTimeout(() => {
        const a = document.createElement("a");
        a.href = f.url;
        a.download = f.name || "";        // hint a filename (cross-origin may ignore)
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, i * 300);
      downloadTimersRef.current.push(t);
    });
    // Folder-only links can't be downloaded — open each so the user can grab
    // the clip manually.
    folders.forEach(url => window.open(url, "_blank", "noopener,noreferrer"));

    const parts = [];
    if (files.length)   parts.push(`Starting ${files.length} download${files.length === 1 ? "" : "s"} — check your browser for prompts`);
    if (folders.length) parts.push(`opened ${folders.length} Drive folder${folders.length === 1 ? "" : "s"} (no direct file link)`);
    setDownloadStatus(parts.join(" · "));

    // Re-enable the button once the last staggered click has fired.
    const done = setTimeout(() => setDownloading(false), files.length * 300 + 400);
    downloadTimersRef.current.push(done);
  };

  /* "Current reel state" — a URL pointing to the latest cut/preview/Frame.io
     draft. Stored on reel.attachUrl (the existing column). Prompt to set,
     click to open if already set. */
  const reelStateUrl = stored?.attachUrl || "";

  /* ── OWNER-ONLY "Final video" MP4 upload ─────────────────────────────────
     ADDITIVE to the attachUrl text field above. On file pick we ask the
     capacity-aware target endpoint (?action=planable-upload-target) where to
     upload. supabase → upload to the PRIVATE "reel-videos" bucket (same idiom
     as locations.jsx) and persist mediaPath/mediaTarget (the source of
     truth — the push action mints a fresh signed url at push time). hetzner →
     the documented near-capacity fallback seam is owner-gated/not-yet-wired,
     so we surface the server message and stop rather than fail silently.
     Consumes ONLY the frozen contract names — reel.mediaPath is the single
     end-to-end field: detail.jsx writes it, export-view.jsx resolveRow reads it,
     and the planable-push server reads it (suggest.js item.mediaPath). Local
     vars are named to MATCH that contract (not attachPath/attachTarget) so the
     reel field name is unambiguous across the two UI files. */
  const mediaPath   = stored?.mediaPath || "";
  const mediaTarget = stored?.mediaTarget || "";
  // No-copy chat recording: a pointer { channel, fileId, name, private } that
  // streams on demand from Rocket.Chat (no Supabase copy). Present only when the
  // recording was attached via "Pick from Chat" in proxy mode.
  const chatRecording = (mediaTarget === "rc-proxy" && stored?.chatRecording) || null;
  // null | 'uploading' | 'done' | 'error'  (mirrors the locations 'uploading' pattern)
  const [videoUploadState, setVideoUploadState] = useState(null);
  const [videoUploadMsg, setVideoUploadMsg] = useState("");
  // "Pick from Chat" — attach an editor's screen recording from Rocket.Chat.
  const [chatPickerOpen, setChatPickerOpen] = useState(false);
  // Signed URL for the hosted "Current reel state" recording, for the inline
  // embed below the inspiration reel (reel-videos is private → must be signed).
  const [currentStateVideoUrl, setCurrentStateVideoUrl] = useState("");

  const handleFinalVideoUpload = async (e) => {
    const file = (e.target.files || [])[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setVideoUploadState("uploading");
    setVideoUploadMsg("");
    try {
      // 1) ask the capacity-aware target endpoint where to upload
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        // FAIL loudly — no auth means the owner-gated contract can't be honored
        setVideoUploadState("error");
        setVideoUploadMsg("Not signed in — cannot upload.");
        return;
      }
      const res = await fetch("/api/ai/suggest?action=planable-upload-target", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setVideoUploadState("error");
        setVideoUploadMsg(`Upload target check failed (${res.status}).`);
        return;
      }
      const targetInfo = await res.json(); // { target, bucket, capacityPct, message }
      const target = targetInfo?.target;
      const bucket = targetInfo?.bucket || "reel-videos";

      if (target === "hetzner") {
        // Documented ~80%-capacity fallback seam — owner-gated backend work,
        // not yet wired. Surface, don't silently swallow.
        setVideoUploadState("error");
        setVideoUploadMsg(
          targetInfo?.message ||
          "Storage near capacity — Hetzner upload is owner-gated and not yet wired."
        );
        return;
      }
      if (target !== "supabase") {
        // Unexpected contract value — FAIL loudly.
        setVideoUploadState("error");
        setVideoUploadMsg(`Unexpected upload target: ${String(target)}`);
        return;
      }

      // 2) supabase: upload to the PRIVATE reel-videos bucket (locations idiom)
      const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
      const path = `${current.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { data: uploadData, error } = await supabase.storage
        .from(bucket)
        .upload(path, file, { upsert: false });
      if (error || !uploadData) {
        setVideoUploadState("error");
        setVideoUploadMsg(error?.message || "Upload failed.");
        return;
      }

      // 3) persist the media reference on the reel. mediaPath is the source of
      //    truth (private bucket → getPublicUrl is NOT playable; server mints a
      //    signed url at push time). The key MUST be mediaPath/mediaTarget —
      //    that is the frozen field the planable-push server reads
      //    (suggest.js item.mediaPath). Leave the existing attachUrl untouched.
      actions.updateReel(current.id, {
        mediaPath: uploadData.path,
        mediaTarget: "supabase",
      });
      setVideoUploadState("done");
      setVideoUploadMsg("");
    } catch (err) {
      setVideoUploadState("error");
      setVideoUploadMsg(err?.message || "Upload failed.");
    }
  };

  const removeFinalVideo = () => {
    const old = stored?.mediaPath;
    actions.updateReel(current.id, { mediaPath: "", mediaTarget: "" });
    setVideoUploadState(null);
    setVideoUploadMsg("");
    if (old) supabase.storage.from("reel-videos").remove([old]).catch(() => {});
  };

  /* Open the "Current reel state". A hosted recording (mediaPath in the private
     reel-videos bucket) takes precedence — mint a short-lived signed URL so it
     plays — and we fall back to the manual attachUrl link. */
  const openCurrentReelState = async () => {
    if (chatRecording?.fileId) {
      const r = await getRecordingStreamUrl({
        fileId: chatRecording.fileId,
        name: chatRecording.name || "recording.mp4",
      });
      if (r.ok) { window.open(r.url, "_blank", "noopener,noreferrer"); return; }
    }
    if (mediaPath) {
      try {
        const { data, error } = await supabase.storage
          .from("reel-videos")
          .createSignedUrl(mediaPath, 3600);
        if (!error && data?.signedUrl) {
          window.open(data.signedUrl, "_blank", "noopener,noreferrer");
          return;
        }
      } catch (_) { /* fall through to the manual link */ }
    }
    if (reelStateUrl) window.open(reelStateUrl, "_blank", "noopener,noreferrer");
  };

  /* Mint a playable URL for the current reel state so it can be embedded inline.
     Two sources, refreshed whenever either changes:
       • rc-proxy pointer → a signed stream URL from the backend (no Supabase copy)
       • legacy mediaPath  → a Supabase signed URL (pre-existing re-hosted copies) */
  useEffect(() => {
    let cancelled = false;
    if (chatRecording?.fileId) {
      (async () => {
        const r = await getRecordingStreamUrl({
          fileId: chatRecording.fileId,
          name: chatRecording.name || "recording.mp4",
        });
        if (!cancelled && r.ok) setCurrentStateVideoUrl(r.url);
      })();
      return () => { cancelled = true; };
    }
    if (!mediaPath) { setCurrentStateVideoUrl(""); return; }
    (async () => {
      try {
        const { data, error } = await supabase.storage
          .from("reel-videos")
          .createSignedUrl(mediaPath, 3600);
        if (!cancelled && !error && data?.signedUrl) {
          setCurrentStateVideoUrl(data.signedUrl);
        }
      } catch (_) { /* leave empty — the ↗ pill still opens it on demand */ }
    })();
    return () => { cancelled = true; };
  }, [mediaPath, chatRecording?.fileId, chatRecording?.name]);

  /* Reference links (audio + inspiration). Always editable post-create:
     clicking opens the link if set, or prompts to add one when empty.
     Shift+click (or empty link) → edit / add. */
  const audioUrl = stored?.audio || "";
  const inspoUrl = stored?.inspo || "";
  // Series/playlist tag — groups reels on the Pipeline board (e.g. "Nepal series").
  const seriesVal = stored?.series || "";

  const editRefLink = (field, currentValue, label) => {
    const next = window.prompt(
      `${label} link for this reel:`,
      currentValue
    );
    if (next === null) return; // cancel
    const trimmed = next.trim();
    if (trimmed === currentValue) return;
    actions.updateReel(current.id, { [field]: trimmed });
  };

  // Click = open if set, prompt if not. Shift+click = always prompt (edit).
  const handleRefClick = (e, field, currentValue, label) => {
    if (e.shiftKey || !currentValue) {
      editRefLink(field, currentValue, label);
      return;
    }
    window.open(currentValue, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="det-wrap">
      <style>{SOL_DETAIL_CSS}</style>
      {onBack && (
        <button
          type="button"
          className="det-back"
          onClick={onBack}
          aria-label="Back to pipeline"
        >
          ‹ Back
        </button>
      )}
      <div className="page-head">
        <div className="titles">
          <h1 style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span
              className="det-crumb"
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 13,
                fontWeight: 400,
                color: "var(--fg-mute)",
                letterSpacing: "0.04em",
              }}
            >{current.id}</span>
            {editingTitle ? (
              <input
                autoFocus
                value={titleVal}
                onChange={e => setTitleVal(e.target.value)}
                onBlur={() => {
                  setEditingTitle(false);
                  const v = titleVal.trim();
                  if (v) saveIfChanged("title", v);
                  else setTitleVal(stored?.title ?? current.title ?? "");
                }}
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                  if (e.key === "Escape") { setTitleVal(stored?.title ?? current.title ?? ""); setEditingTitle(false); }
                }}
                style={{
                  font: "inherit", color: "var(--fg)", background: "var(--bg-2)",
                  border: "1px solid var(--c-cyan-soft)", borderRadius: 4,
                  padding: "2px 8px", minWidth: 280, outline: "none",
                }}
              />
            ) : (
              <span
                className="det-title"
                onClick={() => { setTitleVal(stored?.title ?? current.title ?? ""); setEditingTitle(true); }}
                title="Click to edit title"
                style={{ cursor: "text" }}
              >
                {(stored?.title ?? current.title) || "Untitled reel"}
              </span>
            )}
          </h1>
          <div className="sub reflinks" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span className="reflink" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span
                onClick={(e) => handleRefClick(e, "inspo", inspoUrl, "Inspiration")}
                title={inspoUrl ? `${inspoUrl}\n(click to open)` : "Click to add an inspiration link"}
                style={{
                  cursor: "pointer",
                  userSelect: "none",
                  color: inspoUrl ? "var(--c-amber)" : "var(--fg-mute)",
                  textDecoration: "none",
                }}>
                {inspoUrl ? "✦ Inspiration ↗" : "+ Inspiration"}
              </span>
              {inspoUrl && (
                <button
                  className="reflink-edit"
                  onClick={() => editRefLink("inspo", inspoUrl, "Inspiration")}
                  title="Change this inspiration link"
                  aria-label="Change inspiration link"
                  style={{ cursor: "pointer", color: "var(--fg-mute)", fontSize: 12, lineHeight: 1, padding: "2px 4px" }}>
                  ✎
                </button>
              )}
            </span>
            {/* Assign to editor — owner/privileged only; lands reel in that person's Not Started */}
            {false /* DISABLED — awaiting owner activation */ && isOwner && peopleList.length > 0 && (
            <span className="reflink" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <select
                value={stored?.owner || current.owner || ""}
                onChange={e => {
                  const personId = e.target.value;
                  if (personId && personId !== (stored?.owner || current.owner)) {
                    actions.moveStage(current.id, { lane: personId, stage: "not_started" });
                  }
                }}
                title="Assign to editor — moves reel to their Not Started column"
                style={{
                  background: "var(--bg-2)",
                  border: "1px solid var(--line-hard)",
                  borderRadius: 4,
                  color: "var(--fg-mute)",
                  fontFamily: "var(--f-mono)",
                  fontSize: 11,
                  padding: "2px 8px",
                  cursor: "pointer",
                }}
              >
                <option value="" disabled>Assign to…</option>
                {peopleList.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </span>
            )}
            {/* Card colour — recolours this reel's card on the pipeline board */}
            {canColor && (
            <span className="reflink" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="mono dim" style={{ fontSize: 10, userSelect: "none" }}>card colour</span>
              {["cyan", "violet", "green", "amber", "red", "blue", "orange", "pink"].map(c => {
                const active = (stored?.tone || "cyan") === c;
                return (
                  <span
                    key={c}
                    onClick={() => stored && actions.updateReel(current.id, { tone: c })}
                    title={c}
                    style={{
                      width: 16, height: 16, borderRadius: "50%",
                      background: `var(--c-${c})`, cursor: "pointer", display: "inline-block",
                      border: active ? "2px solid var(--fg)" : "2px solid var(--bg)",
                      boxShadow: active ? `0 0 0 1px var(--c-${c})` : "none",
                      transition: "border-color .1s",
                    }}
                  />
                );
              })}
            </span>
            )}
            {/* Skill tags removed from the top of the card — they are redundant
                with the editable skill tagging inside GamifyRubricSheet below. */}
          </div>
        </div>
        <div className="actions" style={{ alignItems: "center", gap: 8 }}>
          {(reelStateUrl || mediaPath) ? (
            <DPill onClick={openCurrentReelState}
                   title={mediaPath ? "Play the attached recording" : reelStateUrl}>
              ↗ Current reel state{mediaPath ? " (video)" : ""}
            </DPill>
          ) : null}
          {/* Attach a screen recording an editor posted in Rocket.Chat —
              available to everyone (NOT behind the owner-only upload gate). */}
          <DPill onClick={() => setChatPickerOpen(true)} title="Attach a screen recording from a chat channel">
            ↙ Pick from Chat
          </DPill>
          {/* OWNER-ONLY final-video MP4 upload — ADDITIVE; consumes the frozen
              ?action=planable-upload-target contract + the "reel-videos" bucket. */}
          {isOwner && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {mediaPath ? (
                <>
                  <DPill title={mediaPath} style={{ cursor: "default" }}>
                    ✓ Final video attached{mediaTarget ? ` (${mediaTarget})` : ""}
                  </DPill>
                  <DPill onClick={removeFinalVideo} title="Clear the attached final video">
                    ✕ Remove
                  </DPill>
                </>
              ) : (
                <label
                  className="dpill"
                  style={{
                    cursor: videoUploadState === "uploading" ? "wait" : "pointer",
                    opacity: videoUploadState === "uploading" ? 0.6 : 1,
                  }}
                  title="Upload the final MP4 for this reel (owner only)"
                >
                  {videoUploadState === "uploading" ? "Uploading…" : "⬆ Final video"}
                  <input
                    type="file"
                    accept="video/mp4,video/quicktime"
                    style={{ display: "none" }}
                    disabled={videoUploadState === "uploading"}
                    onChange={handleFinalVideoUpload}
                  />
                </label>
              )}
              {videoUploadState === "done" && !mediaPath ? (
                <span style={{ fontSize: 12, color: "var(--ok, #2e7d32)" }}>Uploaded ✓</span>
              ) : null}
              {videoUploadState === "error" ? (
                <span
                  title={videoUploadMsg}
                  style={{ fontSize: 12, color: "var(--danger, #c62828)", maxWidth: 260 }}
                >
                  Failed{videoUploadMsg ? `: ${videoUploadMsg}` : ""}
                </span>
              ) : null}
            </div>
          )}
          {canAttach && (
            <DPill onClick={() => setSearchModalOpen(true)} primary>+ Search Footage</DPill>
          )}
        </div>
      </div>

      {/* Attach a screen recording from a Rocket.Chat channel as the reel state */}
      {chatPickerOpen && (
        <ChatRecordingPicker
          reelId={current.id}
          onClose={() => setChatPickerOpen(false)}
          onAttached={(cr) => {
            // No-copy attach: store the pointer + switch to proxy mode, and free
            // any old re-hosted Supabase copy this reel was previously using.
            const old = stored?.mediaPath;
            actions.updateReel(current.id, {
              chatRecording: cr, mediaTarget: "rc-proxy", mediaPath: "",
            });
            if (old) supabase.storage.from("reel-videos").remove([old]).catch(() => {});
          }}
        />
      )}

      {/* Footage Brain Search Modal */}
      {searchModalOpen && (
        <FootageBrainSearch
          reelId={current.id}
          onAttach={handleAttachFootage}
          onClose={closeSearchModal}
          attachedIds={reelAttachedFootage.map(f => f.footage_file_id)}
          initialMode={folderToBrowse ? "folders" : "semantic"}
          initialFolder={folderToBrowse?.path || ""}
          initialFolderLabel={folderToBrowse?.label || ""}
        />
      )}

      <div className="detail-grid det-body">
        {/* ===== LEFT — attached footage ===== */}
        <div className="detail-col">
          <Card
            title="Attached Footage"
            right={<span className="count-tag cyan">{reelAttachedFootage.length}</span>}
            footLeft="Footage items linked to this reel"
          >
            {/* Download-all — bulk-pull every attached clip's Drive video. */}
            {reelAttachedFootage.length > 0 && (
              <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={handleDownloadAll}
                  disabled={downloading}
                  title="Download every attached clip's Google Drive video"
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "transparent",
                    border: "1px solid var(--c-cyan, #22d3ee)",
                    color: "var(--c-cyan, #22d3ee)",
                    borderRadius: 3,
                    cursor: downloading ? "default" : "pointer",
                    fontSize: 11,
                    fontWeight: 500,
                    opacity: downloading ? 0.5 : 1,
                  }}
                >
                  {downloading ? "Preparing…" : "⬇ Download all"}
                </button>
                {downloadStatus && (
                  <span style={{ fontSize: 10.5, color: "var(--fg-mute)", fontFamily: "var(--f-mono)" }}>
                    {downloadStatus}
                  </span>
                )}
              </div>
            )}
            {(() => {
              const rates = [...new Set(
                reelAttachedFootage
                  .map(f => f.frame_rate)
                  .filter(r => r != null && r > 0)
                  .map(r => Math.round(r))
              )];
              return rates.length > 1 ? (
                <div style={{
                  background: "var(--c-amber-soft)",
                  border: "1px solid var(--c-amber)",
                  borderRadius: 5,
                  padding: "8px 12px",
                  marginBottom: 10,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                }}>
                  <span style={{ fontSize: 16, lineHeight: 1 }}>⚠</span>
                  <div>
                    <div style={{ color: "var(--c-amber)", fontSize: 12, fontWeight: 600, fontFamily: "var(--f-mono)" }}>
                      Mixed frame rates detected
                    </div>
                    <div style={{ color: "var(--fg)", fontSize: 11, marginTop: 3 }}>
                      This reel has clips at {rates.join(" fps, ")} fps. CapCut may need manual fps alignment before import.
                    </div>
                  </div>
                </div>
              ) : null;
            })()}
            <AttachedFootageList
              items={reelAttachedFootage}
              onRemove={handleRemoveFootage}
              canRemove={canRemoveFootage}
              beatTitleByItemId={beatTitleByItemId}
              onOpenFolder={canAttach ? handleOpenFolder : null}
            />
            {canAttach && (
              <div style={{ marginTop: 10 }}>
                <DPill onClick={() => setSearchModalOpen(true)}>
                  {reelAttachedFootage.length === 0 ? "+ Add Footage" : "+ Add more"}
                </DPill>
              </div>
            )}
          </Card>

          {/* ===== Attached Music — mirrors the Footage card above ===== */}
          <Card
            title="Attached Music"
            right={<span className="count-tag cyan">{attachedMusic.length}</span>}
            footLeft="Licensed tracks linked to this reel"
          >
            {attachedMusic.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--fg-mute)", padding: "4px 0 8px" }}>
                No music attached yet.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {attachedMusic.map((track) => {
                const cover =
                  track?.cover || track?.cover_url || track?.coverUrl ||
                  track?.image || track?.image_url || track?.artwork ||
                  track?.thumbnail || "";
                const title = track?.title || track?.name || "Untitled track";
                const artistRaw =
                  track?.artist || track?.artists || track?.artist_name ||
                  track?.creator || "";
                const artist = Array.isArray(artistRaw)
                  ? artistRaw.map(a => (typeof a === "string" ? a : a?.name || "")).filter(Boolean).join(", ")
                  : (typeof artistRaw === "string" ? artistRaw : artistRaw?.name || "");
                const preview =
                  track?.preview_url || track?.previewUrl || track?.preview ||
                  track?.audio_url || track?.mp3 || "";
                const dl = musicDlState[track.id];
                return (
                  <div
                    key={track.id}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: 8,
                      background: "var(--bg-alt)",
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    {/* Cover */}
                    <div
                      style={{
                        width: 44, height: 44, borderRadius: 3, overflow: "hidden",
                        flexShrink: 0, background: "var(--bg)", border: "1px solid var(--border)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      {cover ? (
                        <img
                          src={cover}
                          alt={title}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          onError={(e) => { e.currentTarget.style.display = "none"; }}
                        />
                      ) : (
                        <span style={{ fontSize: 18 }} role="img" aria-label="music">🎵</span>
                      )}
                    </div>

                    {/* Title + artist */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        title={title}
                        style={{
                          fontSize: 13, fontWeight: 500, color: "var(--fg)",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}
                      >
                        {title}
                      </div>
                      <div
                        style={{
                          fontSize: 11, color: "var(--fg-mute)",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}
                      >
                        {artist || "Unknown artist"}
                      </div>
                      {/* Mini preview */}
                      {preview && (
                        <audio
                          controls
                          preload="none"
                          src={preview}
                          style={{ width: "100%", height: 28, marginTop: 4 }}
                        />
                      )}
                    </div>

                    {/* Download */}
                    <button
                      type="button"
                      onClick={() => handleMusicDownload(track)}
                      disabled={dl === "loading"}
                      title={dl === "error" ? "Download failed — retry" : "Download licensed track"}
                      style={{
                        padding: "6px 10px",
                        background: "transparent",
                        color: dl === "error" ? "var(--danger, #c62828)" : "var(--c-cyan, #22d3ee)",
                        border: `1px solid ${dl === "error" ? "var(--danger, #c62828)" : "var(--c-cyan, #22d3ee)"}`,
                        borderRadius: 3,
                        cursor: dl === "loading" ? "default" : "pointer",
                        fontSize: 11, fontWeight: 500, whiteSpace: "nowrap",
                        opacity: dl === "loading" ? 0.6 : 1,
                      }}
                    >
                      {dl === "loading" ? "…" : dl === "error" ? "⚠ Retry" : "⬇ Download"}
                    </button>

                    {/* Remove */}
                    {canRemoveFootage && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMusic(track)}
                        title="Remove this track from the reel"
                        style={{
                          padding: "6px 9px",
                          background: "transparent",
                          color: "var(--fg-mute)",
                          border: "1px solid var(--border)",
                          borderRadius: 3, cursor: "pointer",
                          fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {canAttach && (
              <div style={{ marginTop: 10 }}>
                <DPill onClick={() => setMusicModalOpen(true)} primary={attachedMusic.length === 0}>
                  + Add Music
                </DPill>
              </div>
            )}
          </Card>

          {/* Attach-music modal — mirrors the Footage search modal */}
          {musicModalOpen && (
            <MusicPickerModal
              reelDnaId={reelDnaId}
              onClose={() => setMusicModalOpen(false)}
            />
          )}

          {/* ===== Attached Thumbnails — restored attach control ===== */}
          <Card
            title="Attached Thumbnails"
            right={<span className="count-tag">{attachedThumbnails.length}</span>}
            footLeft="Reference thumbnails from the Thumbnails tab"
          >
            {attachedThumbnails.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--fg-mute)", padding: "4px 0 8px" }}>
                No thumbnails attached yet.
              </div>
            )}
            {attachedThumbnails.length > 0 && (
              <div className="rd-asset-thumb-grid">
                {attachedThumbnails.map(t => (
                  <div className="rd-asset-thumb-wrap" key={t.id}>
                    <a
                      className="rd-asset-thumb"
                      href={t.videoUrl || "#"}
                      target="_blank"
                      rel="noreferrer"
                      title={t.title || t.videoUrl || "Thumbnail"}
                    >
                      {t.videoId ? (
                        <ThumbPreview videoId={t.videoId} alt={t.title || t.videoUrl} />
                      ) : t.thumbnailUrl ? (
                        <img className="td-thumb-img" src={t.thumbnailUrl}
                             alt={t.title || t.videoUrl || "Thumbnail"} loading="lazy" />
                      ) : (
                        <span className="rd-asset-thumb-stub">no preview</span>
                      )}
                    </a>
                    {canAttach && (
                      <button
                        type="button"
                        className="rd-asset-detach"
                        onClick={() => handleDetachThumbnail(t.id)}
                        title="Remove this thumbnail from the reel"
                      >✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canAttach && (
              <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <AssetAttachPicker
                  wide
                  buttonLabel="+ Thumbnail"
                  title="Attach thumbnail"
                  options={thumbnailOpts}
                  attachedIds={thumbAttachedIds}
                  onAttach={handleAttachThumbnails}
                />
                <input
                  value={thumbInput}
                  onChange={e => setThumbInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddThumbnail(); } }}
                  placeholder="…or paste a YouTube link"
                  style={{
                    flex: 1, minWidth: 140,
                    background: "var(--bg-2)", border: "1px dashed var(--line-hard)",
                    borderRadius: 4, color: "var(--fg)", fontFamily: "var(--f-mono)",
                    fontSize: 11.5, padding: "6px 9px", outline: "none",
                  }}
                />
                <DPill onClick={handleAddThumbnail}>Add</DPill>
              </div>
            )}
          </Card>

          {/* ===== Attached News (from Pulse) — restored attach control ===== */}
          <Card
            title="Attached News"
            right={<span className="count-tag">{attachedNews.length}</span>}
            footLeft="News articles from Pulse linked to this reel"
          >
            {attachedNews.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--fg-mute)", padding: "4px 0 8px" }}>
                No news attached yet.
              </div>
            )}
            {attachedNews.length > 0 && (
              <div className="rd-asset-news-list">
                {attachedNews.map(n => (
                  <div className="rd-asset-news" key={n.id}>
                    {n.sourceUrl ? (
                      <a href={n.sourceUrl} target="_blank" rel="noreferrer">{n.title || "Untitled"}</a>
                    ) : (
                      <span>{n.title || "Untitled"}</span>
                    )}
                    {canAttach && (
                      <button
                        type="button"
                        className="rd-asset-detach"
                        onClick={() => handleDetachNews(n.id)}
                        title="Remove this article from the reel"
                      >✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canAttach && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <AssetAttachPicker
                  wide
                  buttonLabel="+ News"
                  title="Attach news from Pulse"
                  options={newsOpts}
                  attachedIds={newsAttachedIds}
                  onAttach={handleAttachNews}
                />
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    value={newsTitle}
                    onChange={e => setNewsTitle(e.target.value)}
                    placeholder="…or add a headline"
                    style={{
                      flex: 1, minWidth: 120,
                      background: "var(--bg-2)", border: "1px dashed var(--line-hard)",
                      borderRadius: 4, color: "var(--fg)", fontFamily: "var(--f-sans)",
                      fontSize: 11.5, padding: "6px 9px", outline: "none",
                    }}
                  />
                  <input
                    value={newsUrl}
                    onChange={e => setNewsUrl(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddNews(); } }}
                    placeholder="Source URL (optional)"
                    style={{
                      flex: 1, minWidth: 120,
                      background: "var(--bg-2)", border: "1px dashed var(--line-hard)",
                      borderRadius: 4, color: "var(--fg)", fontFamily: "var(--f-mono)",
                      fontSize: 11.5, padding: "6px 9px", outline: "none",
                    }}
                  />
                  <DPill onClick={handleAddNews}>{newsBusy ? "…" : "Add"}</DPill>
                </div>
              </div>
            )}
          </Card>

          <LocationPicker reelId={current.id} />
          {(stored?.detail?.fromReelDna || current.detail?.fromReelDna) && (
            <PipelineDnaAssets
              cardId={stored?.detail?.fromReelDna || current.detail.fromReelDna}
            />
          )}
        </div>

        {/* ===== CENTER — blueprint + feedback ===== */}
        <div className="detail-col center">
          {/* 1) Reel Blueprint */}
          <div className="blueprint det-content-panel">
            <div className="blueprint-head">
              <div className="h det-panel-head">Reel Blueprint</div>
              <div className="meta">Logline · script · voiceover — your working notes</div>
            </div>
            <div className="blueprint-tabs">
              <div className={"blueprint-tab " + (blueprintTab === "logline" ? "active" : "")}
                   onClick={() => setBlueprintTab("logline")}>Logline</div>
              <div className={"blueprint-tab " + (blueprintTab === "script" ? "active" : "")}
                   onClick={() => setBlueprintTab("script")}>Script / shot plan</div>
              <div className={"blueprint-tab " + (blueprintTab === "vo" ? "active" : "")}
                   onClick={() => setBlueprintTab("vo")}>Voiceover</div>
            </div>
            <div className="blueprint-body bp-fill det-content-row">
              <div className="det-content-val">
                {blueprintTab === "logline" && (
                  canEditLogline ? (
                    <textarea
                      value={logline}
                      onChange={e => setLogline(e.target.value)}
                      onBlur={() => saveIfChanged("logline", logline)}
                      placeholder="One sentence: what is this reel?"
                    />
                  ) : (
                    <ReadOnlyField value={logline} />
                  )
                )}
                {blueprintTab === "script" && (
                  canEditScript ? (
                    <textarea
                      className="script"
                      value={script}
                      onChange={e => setScript(e.target.value)}
                      onBlur={() => saveIfChanged("script", script)}
                      placeholder="Beat-by-beat plan, shot list, captions…"
                    />
                  ) : (
                    <ReadOnlyField value={script} mono />
                  )
                )}
                {blueprintTab === "vo" && (
                  canEditVoiceover ? (
                    <textarea
                      value={vo}
                      onChange={e => setVo(e.target.value)}
                      onBlur={() => saveIfChanged("vo", vo)}
                      placeholder="Voiceover text + delivery notes"
                    />
                  ) : (
                    <ReadOnlyField value={vo} />
                  )
                )}
                <div style={{ marginTop: 8, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)" }}>
                  {(() => {
                    const editable = blueprintTab === "logline" ? canEditLogline
                                   : blueprintTab === "vo"      ? canEditVoiceover
                                   :                              canEditScript;
                    if (!editable) return "read-only · ask Paul for edit access";
                    return stored
                      ? "saves on blur · synced across devices"
                      : "not persisted · open this reel via Pipeline to enable saves";
                  })()}
                </div>
              </div>
            </div>
          </div>

          {/* 2) Comments + feedback */}
          <Card
              title="Comments + feedback"
              right={<span className="count-tag">{comments.length}</span>}
              footLeft="Conversation layer · persisted per reel"
            >
              {comments.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--fg-dim)", padding: "6px 0" }}>
                  No comments yet — leave the first note below.
                </div>
              )}
              {(() => { let _hi = -1; return comments.map((c) => {
                const mine = me && c.authorId && c.authorId === me.id;
                if (c.system) {
                  /* System-authored audit entry (e.g. a stage
                     transition). Renders as a single dim line so
                     it doesn't visually compete with human chat. */
                  return (
                    <div key={c.id} className="comment-system det-check-row det-check-done">
                      <span className="dot det-cb-done">●</span>
                      <span className="txt">{c.txt}</span>
                      <span className="ts">{formatCommentTs(c.ts)}</span>
                    </div>
                  );
                }
                /* Alternating row shade (Excel-style) across human comments so
                   successive messages are easy to tell apart. */
                _hi += 1;
                const zebra = _hi % 2 === 1 ? "rgba(255,255,255,0.035)" : "transparent";
                return (
                  <div className="comment det-check-row det-check-active" key={c.id}
                       style={{ position: "relative", background: zebra,
                                borderRadius: 6, padding: "6px 8px", margin: "0 -8px" }}>
                    <div className={"avatar det-cb-active " + String(c.who || "").toLowerCase()}>{c.who}</div>
                    <div>
                      <div className="who">
                        {String(c.id || "").startsWith("c-rc-") && (
                          <span title="Posted from team chat"
                                style={{ color: "var(--c-cyan)", fontSize: 10, marginRight: 4 }}>💬</span>
                        )}
                        <b>{c.role}</b>
                        <span className="ts">{formatCommentTs(c.ts)}</span>
                        {(mine || isOwner) && (
                          <span
                            onClick={() => deleteComment(c.id)}
                            title={mine ? "Delete this comment" : "Delete comment (owner)"}
                            style={{
                              marginLeft: "auto",
                              fontFamily: "var(--f-mono)",
                              fontSize: 10,
                              color: "var(--fg-dim)",
                              cursor: "pointer",
                            }}
                          >×</span>
                        )}
                      </div>
                      <div className="txt">{c.txt}</div>
                    </div>
                  </div>
                );
              }); })()}
              <div style={{
                marginTop: 10,
                border: "1px dashed var(--line-hard)",
                borderRadius: 6,
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}>
                <textarea
                  value={draftComment}
                  onChange={e => setDraftComment(e.target.value)}
                  onKeyDown={e => {
                    // Enter posts, Shift+Enter inserts a newline.
                    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                      e.preventDefault();
                      postComment();
                    }
                  }}
                  placeholder={stored
                    ? "Leave feedback or progress note… (Enter to post · Shift+Enter for new line)"
                    : "Open this reel via Pipeline to post feedback."}
                  disabled={!stored}
                  style={{
                    background: "var(--bg-2)",
                    border: "1px dashed var(--line-hard)",
                    borderRadius: 4,
                    color: "var(--fg)",
                    fontFamily: "var(--f-sans)",
                    fontSize: 12,
                    padding: "6px 9px",
                    resize: "vertical",
                    minHeight: 52,
                    outline: "none",
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 10.5, color: "var(--fg-dim)", fontFamily: "var(--f-mono)" }}>
                    posting as <b style={{ color: "var(--fg)" }}>{me?.name || "you"}</b>
                  </div>
                  <div style={{ flex: 1 }} />
                  <DPill
                    primary
                    onClick={postComment}
                    style={{ opacity: draftComment.trim() && stored ? 1 : 0.5 }}
                  >Post</DPill>
                </div>
              </div>
            </Card>

            {/* 3) Gamify — skills tagging + rubric grading (hidden when gamify is off) */}
            <GamifyRubricSheet reel={stored || current} onLearnSkill={onLearnSkill} />
        </div>

        {/* ===== RIGHT — inspiration embed + edit notes ===== */}
        <div className="detail-col detail-col--ref">
          {/* Inspiration reel preview (reuses the existing ✦ Inspiration link). */}
          <div className="ref-card">
            <div className="ref-label">Inspiration reel</div>
            {inspoUrl ? (
              <div className="ref-embed det-preview">
                <ReelPlayer sampleReel={{ sourceUrl: inspoUrl }} preferEmbed={true} />
              </div>
            ) : (
              <div
                className="ref-embed-empty det-preview"
                onClick={() => editRefLink("inspo", inspoUrl, "Inspiration")}
                title="Add an inspiration link to preview it here"
              >
                + Add an inspiration link to preview the reference reel here
              </div>
            )}
            {inspoUrl && (
              <button className="rcm-trigger-btn" onClick={() => setShowCompare(true)}>
                ⇔ Compare with current edit
              </button>
            )}
          </div>

          {/* Current reel state — the editor's latest cut, embedded inline so
              it's easy to watch right under the inspiration reference. A hosted
              recording (mediaPath) plays via a signed URL; a legacy attachUrl
              link falls back to the embed player. */}
          {(mediaPath || chatRecording || reelStateUrl) && (
            <div className="ref-card">
              <div className="ref-label">Current reel state</div>
              {(mediaPath || chatRecording) ? (
                currentStateVideoUrl ? (
                  <video
                    className="ref-embed det-preview"
                    src={currentStateVideoUrl}
                    controls
                    playsInline
                    preload="metadata"
                    style={{ width: "100%", borderRadius: 6, background: "#000" }}
                  />
                ) : (
                  <div className="ref-embed-empty det-preview">
                    Loading current reel state…
                  </div>
                )
              ) : (
                <div className="ref-embed det-preview">
                  <ReelPlayer sampleReel={{ sourceUrl: reelStateUrl }} preferEmbed={true} />
                </div>
              )}
            </div>
          )}
          {showCompare && (
            <ReelCompareModal
              leftLabel="Inspiration"
              leftUrl={inspoUrl}
              rightLabel={reelStateUrl ? `Current edit` : "Current edit (paste URL)"}
              rightUrl={reelStateUrl}
              onClose={() => setShowCompare(false)}
              reelId={current?.id}
              reelTitle={stored?.title || current?.title}
              shareToChannel={(channel, feedback) =>
                shareReelToChannel({ reelId: current.id, feedback, channel })
              }
            />
          )}

          {/* Keep-in-mind-while-editing — yellow bullet notes, saved per reel. */}
          <div className="editnotes ref-card">
            <div className="en-head">Keep in mind while editing</div>
            {editNotesEditing || !editNotes.trim() ? (
              <>
                <textarea
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  onFocus={() => setEditNotesEditing(true)}
                  onBlur={saveEditNotes}
                  readOnly={!canEditScript}
                  placeholder={canEditScript
                    ? "One thing to keep in mind per line…\ne.g. captions match the lyrics\ne.g. sleek font, reposition each caption"
                    : "No edit notes yet."}
                />
                {canEditScript && <span className="en-hint">one item per line · saves on blur</span>}
              </>
            ) : (
              <ul onClick={() => canEditScript && setEditNotesEditing(true)}
                  title={canEditScript ? "Click to edit" : undefined}
                  style={{ cursor: canEditScript ? "text" : "default" }}>
                {editNotes.split("\n").map(l => l.trim()).filter(Boolean).map((line, i) => (
                  <li key={i} className="det-check-row det-check-active">{line.replace(/^[-•*]\s*/, "")}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export { ReelDetail };
