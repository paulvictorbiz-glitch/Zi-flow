/* =========================================================
   Editor Projects gallery — the browser for OpenCut-style
   collaborative edit projects.

   Frozen export name `EditorProjects` (app.jsx lazy-imports it).
   Consumes ONLY the public useWorkflow() surface (contract C3) —
   never store.jsx internals, never any api file:

     · editProjects   -> [{ id, title, thumbnail_url, status,
                            created_by, last_editor, updated_at, … }]
     · editorLocks     -> [{ project_id, person_id, expires_at }]
     · reels           -> [{ id, title, logline, … }]  (create picker)
     · actions.createEditProject({ reelId?, reelDnaId?, title })
                       -> newId   (route in via openEditorProject)

   openEditorProject(id) is passed in as a PROP from app.jsx (C8);
   the page never routes on its own.

   Owner-only management affordances key off useIsOwner() (real
   signed-in identity, not the previewed perspective).
   ========================================================= */

import React, { useMemo, useState, useCallback } from "react";
import { useWorkflow } from "../store/store.jsx";
import { useRoster } from "../lib/roster.jsx";
import { useIsOwner } from "../lib/permissions.jsx";
import "./editor-projects.css";

/* ---------- helpers ---------- */

/* "2 hours ago" style relative timestamp; falls back to a locale date. */
function relTime(value) {
  if (!value) return "—";
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  try { return new Date(value).toLocaleDateString(); } catch { return "—"; }
}

/* Normalize a status string to a stable CSS modifier suffix. */
function statusClass(status) {
  const s = String(status || "draft").toLowerCase().replace(/[^a-z]/g, "");
  return s || "draft";
}

/* Pull the single live lock row (if any) for a project from editorLocks.
   "Live" = a row matching this project whose expires_at is still in the
   future. The store realtime-feeds editorLocks, so this re-derives on
   every heartbeat without any local timer. */
function liveLockFor(locks, projectId, now) {
  if (!Array.isArray(locks)) return null;
  for (const l of locks) {
    const pid = l?.project_id ?? l?.projectId;
    if (pid !== projectId) continue;
    const exp = l?.expires_at ?? l?.expiresAt;
    if (!exp) continue;
    const t = new Date(exp).getTime();
    if (Number.isFinite(t) && t > now) return l;
  }
  return null;
}

/* ---------- card ---------- */

function ProjectCard({ project, lock, nameOf, onOpen, canManage, onArchive, onDelete }) {
  const creator = nameOf(project.created_by ?? project.createdBy);
  const lastEditor = nameOf(project.last_editor ?? project.lastEditor);
  const updated = project.updated_at ?? project.updatedAt;
  const status = project.status || "draft";
  const archived = statusClass(status) === "archived";
  const thumb = project.thumbnail_url ?? project.thumbnailUrl;
  const lockName = lock ? nameOf(lock.lockedBy ?? lock.locked_by) : null;

  const open = () => onOpen(project.id);

  return (
    <div className={"ep-card" + (archived ? " ep-card--archived" : "")}>
      {/* Clickable open surface (role=button so action buttons can sit outside
          it — a real <button> can't legally contain other buttons). */}
      <div
        className="ep-card-open"
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
        title={project.title || "Untitled project"}
      >
        <div className="ep-thumb">
          {thumb
            ? <img src={thumb} alt="" loading="lazy" />
            : <div className="ep-thumb-empty" aria-hidden="true">🎬</div>}

          {lock && (
            <span className="ep-lock" title={`${lockName} is editing this project`}>
              <span className="ep-lock-dot" aria-hidden="true" />
              🔒 {lockName} editing
            </span>
          )}

          <span className={`ep-status ep-status--${statusClass(status)}`}>{status}</span>
        </div>

        <div className="ep-body">
          <h3 className="ep-card-title">{project.title || "Untitled project"}</h3>
          <div className="ep-meta">
            <span className="ep-meta-row">
              <span className="ep-meta-k">Creator</span>
              <span className="ep-meta-v">{creator}</span>
            </span>
            <span className="ep-meta-row">
              <span className="ep-meta-k">Last edit</span>
              <span className="ep-meta-v">{lastEditor}</span>
            </span>
            <span className="ep-meta-row">
              <span className="ep-meta-k">Updated</span>
              <span className="ep-meta-v">{relTime(updated)}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Owner-only management footer — archive (reversible) + delete (permanent). */}
      {canManage && (
        <div className="ep-card-foot">
          <button
            type="button"
            className="ep-act"
            onClick={() => onArchive(project)}
            title={archived ? "Unarchive — return to your active projects" : "Archive — hide from the active list (reversible)"}
          >
            {archived ? "📤 Unarchive" : "🗄 Archive"}
          </button>
          <button
            type="button"
            className="ep-act ep-act--danger"
            onClick={() => onDelete(project)}
            title="Delete permanently — removes the project, timeline, versions and locks"
          >
            🗑 Delete
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- create modal ---------- */

function CreateModal({ mode, reels, busy, error, onClose, onCreateBlank, onCreateFromReel }) {
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [selectedReelId, setSelectedReelId] = useState(null);

  const filteredReels = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = Array.isArray(reels) ? reels : [];
    if (!q) return list;
    return list.filter((r) => {
      const hay = `${r.title || ""} ${r.logline || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [reels, query]);

  const selectedReel = useMemo(
    () => (Array.isArray(reels) ? reels.find((r) => r.id === selectedReelId) : null),
    [reels, selectedReelId]
  );

  const canSubmit = mode === "blank"
    ? title.trim().length > 0
    : !!selectedReelId;

  const submit = () => {
    if (busy || !canSubmit) return;
    if (mode === "blank") {
      onCreateBlank(title.trim());
    } else {
      const fallback = selectedReel ? (selectedReel.title || selectedReel.logline || "") : "";
      onCreateFromReel({
        reelId: selectedReelId,
        reelDnaId: selectedReel?.reelDnaId ?? selectedReel?.reel_dna_id ?? null,
        title: title.trim() || fallback || "Untitled project",
      });
    }
  };

  return (
    <div className="ep-modal-backdrop" onClick={onClose}>
      <div className="ep-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="ep-modal-head">
          <h2 className="ep-modal-title">
            {mode === "blank" ? "New blank project" : "New project from reel"}
          </h2>
          <button type="button" className="ep-modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="ep-modal-body">
          {error && <div className="ep-banner ep-banner--error">{error}</div>}

          {mode === "reel" && (
            <>
              <label className="ep-label" htmlFor="ep-reel-search">Pick a reel</label>
              <input
                id="ep-reel-search"
                className="ep-input"
                type="text"
                placeholder="Search reels by title…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              <div className="ep-reel-list" role="listbox" aria-label="Reels">
                {filteredReels.length === 0 ? (
                  <div className="ep-reel-empty">No reels match.</div>
                ) : (
                  filteredReels.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="ep-reel-row"
                      role="option"
                      aria-selected={selectedReelId === r.id}
                      onClick={() => setSelectedReelId(r.id)}
                    >
                      <span className="ep-reel-name">
                        {r.title || r.logline || "Untitled reel"}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}

          <label className="ep-label" htmlFor="ep-title">
            {mode === "blank" ? "Project title" : "Title (optional — defaults to reel title)"}
          </label>
          <input
            id="ep-title"
            className="ep-input"
            type="text"
            placeholder={mode === "blank" ? "e.g. Q3 highlight cut" : "Leave blank to use the reel title"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus={mode === "blank"}
            onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) submit(); }}
          />
        </div>

        <div className="ep-modal-foot">
          <button type="button" className="ep-btn ep-btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            onClick={submit}
            disabled={busy || !canSubmit}
          >
            {busy ? "Creating…" : "Create & open"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- page ---------- */

export function EditorProjects({ openEditorProject }) {
  const { editProjects, editorLocks, reels, actions, loaded } = useWorkflow();
  const { peopleById, loaded: rosterLoaded } = useRoster();
  const isOwner = useIsOwner();

  const [modal, setModal] = useState(null); // null | "blank" | "reel"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false); // owner: reveal archived projects

  /* Resolve a person id -> short display name via the live roster. */
  const nameOf = useCallback((id) => {
    if (!id) return "—";
    const p = peopleById[id];
    return p ? (p.short || p.name || id) : id;
  }, [peopleById]);

  /* Safe routing helper — openEditorProject is a prop (C8). */
  const openProject = useCallback((id) => {
    if (id && typeof openEditorProject === "function") openEditorProject(id);
  }, [openEditorProject]);

  /* Recompute locks against "now" each render; editorLocks is realtime-fed. */
  const now = Date.now();

  const projects = useMemo(
    () => (Array.isArray(editProjects) ? editProjects : []),
    [editProjects]
  );

  /* Newest first by updated_at. */
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const ta = new Date(a.updated_at ?? a.updatedAt ?? 0).getTime() || 0;
      const tb = new Date(b.updated_at ?? b.updatedAt ?? 0).getTime() || 0;
      return tb - ta;
    });
  }, [projects]);

  /* Archived projects are soft-hidden from the active grid (status 'archived')
     and only revealed via the owner's "Show archived" toggle. */
  const archivedCount = useMemo(
    () => sortedProjects.filter((p) => statusClass(p.status) === "archived").length,
    [sortedProjects]
  );
  const visibleProjects = useMemo(
    () => sortedProjects.filter((p) => showArchived || statusClass(p.status) !== "archived"),
    [sortedProjects, showArchived]
  );

  const closeModal = useCallback(() => {
    if (busy) return;
    setModal(null);
    setError("");
  }, [busy]);

  /* Shared create handler: call the store action, then route into the
     editor with the returned id. Accepts either a raw id or an object
     like { ok, id } so the page is resilient to the action's return shape. */
  const runCreate = useCallback(async (payload) => {
    if (typeof actions?.createEditProject !== "function") {
      setError("Project creation isn't available right now.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await actions.createEditProject(payload);
      const newId = (res && typeof res === "object") ? (res?.project?.id ?? res?.id ?? res.projectId) : res;
      if (newId) {
        setModal(null);
        openProject(newId);
      } else {
        setError("Project was created but couldn't be opened — refresh and try again.");
      }
    } catch (e) {
      setError(e?.message || "Couldn't create the project. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [actions, openProject]);

  const createBlank = useCallback((title) => runCreate({ title }), [runCreate]);
  const createFromReel = useCallback((payload) => runCreate(payload), [runCreate]);

  /* Owner management — archive (reversible soft-hide) + delete (permanent).
     Both call the never-throwing store actions; the gallery re-derives from the
     optimistic store update + realtime. */
  const handleArchive = useCallback((project) => {
    if (typeof actions?.archiveEditProject !== "function") return;
    const isArchived = statusClass(project.status) === "archived";
    actions.archiveEditProject(project.id, !isArchived);
  }, [actions]);

  const handleDelete = useCallback((project) => {
    if (typeof actions?.deleteEditProject !== "function") return;
    const name = project.title || "Untitled project";
    const ok = window.confirm(
      `Delete “${name}”?\n\nThis permanently removes the project, its timeline, ` +
      `saved versions and any edit lock. This cannot be undone.`
    );
    if (!ok) return;
    actions.deleteEditProject(project.id);
  }, [actions]);

  /* Loading: wait for the store boot AND the roster (names) to hydrate. */
  const isLoading = !loaded || !rosterLoaded;

  return (
    <div className="ep-page">
      <div className="ep-head">
        <div className="ep-head-left">
          <h1 className="ep-title">Editor Projects</h1>
          <p className="ep-sub">
            Collaborative edit projects — open one to jump into the timeline.
            A 🔒 badge means someone holds the live edit lock right now.
          </p>
        </div>
        <div className="ep-actions">
          {isOwner && archivedCount > 0 && (
            <button
              type="button"
              className={"ep-btn" + (showArchived ? " ep-btn--primary" : "")}
              onClick={() => setShowArchived((v) => !v)}
              title={showArchived ? "Hide archived projects" : "Show archived projects"}
            >
              {showArchived ? `Hide archived (${archivedCount})` : `Show archived (${archivedCount})`}
            </button>
          )}
          <button
            type="button"
            className="ep-btn"
            onClick={() => { setError(""); setModal("reel"); }}
          >
            New from reel…
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            onClick={() => { setError(""); setModal("blank"); }}
          >
            + New blank project
          </button>
        </div>
      </div>

      {error && !modal && (
        <div className="ep-banner ep-banner--error">{error}</div>
      )}

      {isLoading ? (
        <div className="ep-state">
          <div className="ep-spinner" aria-hidden="true" />
          <div className="ep-state-title">Loading projects…</div>
        </div>
      ) : sortedProjects.length === 0 ? (
        <div className="ep-state">
          <div className="ep-state-icon" aria-hidden="true">🎬</div>
          <div className="ep-state-title">No projects yet</div>
          <div className="ep-state-sub">
            Start a blank project or build one from an existing reel — your
            cuts, captions, and audio mix all live inside a project.
          </div>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            onClick={() => { setError(""); setModal("blank"); }}
          >
            + New blank project
          </button>
        </div>
      ) : visibleProjects.length === 0 ? (
        <div className="ep-state">
          <div className="ep-state-icon" aria-hidden="true">🗄</div>
          <div className="ep-state-title">All projects are archived</div>
          <div className="ep-state-sub">
            Use “Show archived” above to view and unarchive them.
          </div>
        </div>
      ) : (
        <div className="ep-grid">
          {visibleProjects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              lock={liveLockFor(editorLocks, p.id, now)}
              nameOf={nameOf}
              onOpen={openProject}
              canManage={isOwner}
              onArchive={handleArchive}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Owner-only footer affordance: a count + management hint. The
          owner is the only role that manages the full project roster;
          editors only see/own their own projects via store-side RLS. */}
      {isOwner && !isLoading && sortedProjects.length > 0 && (
        <p className="ep-sub" style={{ marginTop: 4 }}>
          {sortedProjects.length} project{sortedProjects.length === 1 ? "" : "s"} ·
          {" "}{sortedProjects.filter((p) => liveLockFor(editorLocks, p.id, now)).length} currently being edited
        </p>
      )}

      {modal && (
        <CreateModal
          mode={modal}
          reels={reels}
          busy={busy}
          error={error}
          onClose={closeModal}
          onCreateBlank={createBlank}
          onCreateFromReel={createFromReel}
        />
      )}
    </div>
  );
}

export default EditorProjects;
