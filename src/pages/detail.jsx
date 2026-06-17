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
import { useWorkflow } from "../store/store.jsx";
import { useAuth } from "../auth.jsx";
import { usePermissions } from "../lib/permissions.jsx";
import { useNotifications } from "../components/notifications.jsx";
import { FootageBrainSearch } from "../components/FootageBrainSearch.jsx";
import { getFootageFileMetadata, driveDownloadUrl } from "../lib/footage-brain-client.js";
import { AttachedFootageList } from "../components/AttachedFootageList.jsx";
import { useLocations } from "../lib/locations-data.jsx";
import { SKILLS } from "../lib/training-curriculum.jsx";
import GamifyRubricSheet from "../components/GamifyRubricSheet.jsx";

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
              📍 {loc.name}
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

function ReelDetail({ reel, onBack, onLearnSkill }) {
  /* reel is passed from Pipeline when a card is clicked. Default to REEL-201. */
  const current = reel || { id: "REEL-201", title: "Temple crowd sequence" };

  /* Hook into the canonical store. `stored` is the DB-backed
     record for the currently displayed reel — what we read seed
     values from and what we write Blueprint edits back into. */
  const { reels, actions } = useWorkflow();
  const { can } = usePermissions();
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
  const editReelStateUrl = () => {
    const next = window.prompt(
      "Paste the URL to this reel's current state (Frame.io draft, Drive folder, etc.)",
      reelStateUrl
    );
    if (next === null) return;
    const trimmed = next.trim();
    if (stored && stored.attachUrl !== trimmed) {
      actions.updateReel(current.id, { attachUrl: trimmed });
    }
  };

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
    <div>
      <div className="page-head">
        <div className="titles">
          <h1 style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
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
                onClick={() => { setTitleVal(stored?.title ?? current.title ?? ""); setEditingTitle(true); }}
                title="Click to edit title"
                style={{ cursor: "text" }}
              >
                {(stored?.title ?? current.title) || "Untitled reel"}
              </span>
            )}
            <span style={{
              fontFamily: "var(--f-mono)",
              fontSize: 13,
              fontWeight: 400,
              color: "var(--fg-mute)",
              letterSpacing: "0.04em",
            }}>{current.id}</span>
          </h1>
          <div className="sub reflinks" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span className="reflink" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span
                onClick={(e) => handleRefClick(e, "audio", audioUrl, "Music")}
                title={audioUrl ? `${audioUrl}\n(click to open)` : "Click to add a music link"}
                style={{
                  cursor: "pointer",
                  userSelect: "none",
                  color: audioUrl ? "var(--c-amber)" : "var(--fg-mute)",
                  textDecoration: "none",
                }}>
                {audioUrl ? "♪ Music ↗" : "+ Music"}
              </span>
              {audioUrl && (
                <button
                  className="reflink-edit"
                  onClick={() => editRefLink("audio", audioUrl, "Music")}
                  title="Change this music link"
                  aria-label="Change music link"
                  style={{ cursor: "pointer", color: "var(--fg-mute)", fontSize: 12, lineHeight: 1, padding: "2px 4px" }}>
                  ✎
                </button>
              )}
            </span>
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
            {/* Series tag — groups this reel with others on the pipeline board */}
            <span className="reflink" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span
                onClick={() => editRefLink("series", seriesVal, "Series")}
                title={seriesVal ? `Series: ${seriesVal}\n(click to change)` : "Click to tag this reel's series"}
                style={{
                  cursor: "pointer",
                  userSelect: "none",
                  color: seriesVal ? "var(--c-violet)" : "var(--fg-mute)",
                  textDecoration: "none",
                }}>
                {seriesVal ? `⛓ ${seriesVal}` : "+ Series"}
              </span>
            </span>
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
            {/* Skill tags — which Training-syllabus skills this reel practices.
                Editable only when the owner grants tagReelSkills; otherwise a
                read-only list so editors see what a project teaches. */}
            {(canTagSkills || skillTags.length > 0) && (
            <span className="reflink" style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span className="mono dim" style={{ fontSize: 10, userSelect: "none" }}>skills</span>
              {canTagSkills
                ? SKILLS.map(s => {
                    const active = skillTags.includes(s.key);
                    return (
                      <span
                        key={s.key}
                        onClick={() => toggleSkillTag(s.key)}
                        title={`W${s.week} · ${s.moduleTitle}`}
                        style={{
                          fontFamily: "var(--f-mono)", fontSize: 10.5,
                          padding: "2px 7px", borderRadius: 11, cursor: "pointer",
                          border: "1px solid " + (active ? "var(--c-violet)" : "var(--line-hard)"),
                          color: active ? "var(--c-violet)" : "var(--fg-dim)",
                          background: active ? "rgba(169,155,255,0.10)" : "transparent",
                          userSelect: "none",
                        }}
                      >
                        {active ? "✓ " : ""}{s.label}
                      </span>
                    );
                  })
                : skillTags.map(key => {
                    const s = SKILLS.find(x => x.key === key);
                    return (
                      <span key={key} style={{
                        fontFamily: "var(--f-mono)", fontSize: 10.5,
                        padding: "2px 7px", borderRadius: 11,
                        border: "1px solid var(--c-violet)", color: "var(--c-violet)",
                        background: "rgba(169,155,255,0.10)",
                      }}>
                        {s?.label || key}
                      </span>
                    );
                  })}
            </span>
            )}
          </div>
        </div>
        <div className="actions" style={{ alignItems: "center", gap: 8 }}>
          {reelStateUrl ? (
            <DPill onClick={() => window.open(reelStateUrl, "_blank")}
                   title={reelStateUrl}>
              ↗ Current reel state
            </DPill>
          ) : null}
          <DPill onClick={editReelStateUrl}>
            {reelStateUrl ? "Edit link" : "+ Current reel state"}
          </DPill>
          {canAttach && (
            <DPill onClick={() => setSearchModalOpen(true)} primary>+ Search Footage</DPill>
          )}
        </div>
      </div>

      {/* Footage Brain Search Modal */}
      {searchModalOpen && (
        <FootageBrainSearch
          reelId={current.id}
          onAttach={handleAttachFootage}
          onClose={() => setSearchModalOpen(false)}
          attachedIds={reelAttachedFootage.map(f => f.footage_file_id)}
        />
      )}

      <div className="detail-grid">
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
            />
            {canAttach && (
              <div style={{ marginTop: 10 }}>
                <DPill onClick={() => setSearchModalOpen(true)}>
                  {reelAttachedFootage.length === 0 ? "+ Add Footage" : "+ Add more"}
                </DPill>
              </div>
            )}
          </Card>
          <LocationPicker reelId={current.id} />
        </div>

        {/* ===== CENTER — blueprint + feedback ===== */}
        <div className="detail-col center">
          {/* 1) Reel Blueprint */}
          <div className="blueprint">
            <div className="blueprint-head">
              <div className="h">Reel Blueprint</div>
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
            <div className="blueprint-body">
              <div className="col-label">
                {blueprintTab === "logline" ? "Logline" : blueprintTab === "vo" ? "VO read" : "Beat plan"}
              </div>
              <div>
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
                    <div key={c.id} className="comment-system">
                      <span className="dot">●</span>
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
                  <div className="comment" key={c.id}
                       style={{ position: "relative", background: zebra,
                                borderRadius: 6, padding: "6px 8px", margin: "0 -8px" }}>
                    <div className={"avatar " + String(c.who || "").toLowerCase()}>{c.who}</div>
                    <div>
                      <div className="who">
                        {String(c.id || "").startsWith("c-rc-") && (
                          <span title="Posted from team chat"
                                style={{ color: "var(--c-cyan)", fontSize: 10, marginRight: 4 }}>💬</span>
                        )}
                        <b>{c.role}</b>
                        <span className="ts">{formatCommentTs(c.ts)}</span>
                        {mine && (
                          <span
                            onClick={() => deleteComment(c.id)}
                            title="Delete this comment"
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
              <div className="ref-embed">
                <ReelPlayer sampleReel={{ sourceUrl: inspoUrl }} preferEmbed={true} />
              </div>
            ) : (
              <div
                className="ref-embed-empty"
                onClick={() => editRefLink("inspo", inspoUrl, "Inspiration")}
                title="Add an inspiration link to preview it here"
              >
                + Add an inspiration link to preview the reference reel here
              </div>
            )}
          </div>

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
                  <li key={i}>{line.replace(/^[-•*]\s*/, "")}</li>
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
