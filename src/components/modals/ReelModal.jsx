/* =========================================================
   "Create new reel" modal.

   Seeds a structured reel skeleton: title, logline, owner,
   stage, audio/inspiration links, voiceover, shot plan, and
   any footage clips queued from a Footage Brain search.
   On submit, calls actions.createReelWithFootage so the reel
   row is persisted BEFORE its footage rows — the footage table
   has a reel_id FK, and firing both concurrently let footage
   inserts race ahead of the reel and fail the FK silently.
   ========================================================= */

import React, { useState, useMemo } from "react";
import { DPill } from "../components.jsx";
import { useWorkflow, nextReelId } from "../../store/store.jsx";
import { useRoster } from "../../lib/roster.jsx";
import { ROLES } from "../../lib/shared-data.jsx";
import { FootageBrainSearch } from "../FootageBrainSearch.jsx";
import { Modal, Field, SegRow } from "./Modal.jsx";

export function ReelModal({ onClose }) {
  const { actions, reels } = useWorkflow();
  const { peopleList, canonicalPersonId } = useRoster();
  /* A reel is owned by an editor, never the reviewer (work reaches the
     reviewer via the review stage, not direct ownership). */
  const ownerOptions = useMemo(() =>
    peopleList
      .filter(p => p.role !== "reviewer")
      .map(p => ({ k: p.id, l: `${p.short} · ${ROLES[p.role]?.short || p.role}` })),
    [peopleList]);
  const [title, setTitle]       = useState("");
  const [logline, setLogline]   = useState("");
  const [vo, setVo]             = useState("");
  const [audio, setAudio]       = useState("");
  const [inspo, setInspo]       = useState("");
  const [plan, setPlan]         = useState("");
  const [owner, setOwner]       = useState(() => canonicalPersonId("skilled") || "");
  /* Multi-select editor picker: when 1+ editors are chosen, Create fans out one
     INDEPENDENT copy per editor (createReelForEditors) into each editor's
     Not-Started box, titled " (FirstName)". Empty = legacy single-card path
     using the `owner` default. */
  const [selectedEditorIds, setSelectedEditorIds] = useState([]);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const toggleEditor = (id) =>
    setSelectedEditorIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const editorSummary =
    selectedEditorIds.length === 0
      ? "Select editors…"
      : ownerOptions
          .filter((o) => selectedEditorIds.includes(o.k))
          .map((o) => o.l.split(" · ")[0])
          .join(", ");
  const [stage, setStage]       = useState("not_started");
  const [pending, setPending]   = useState([]); // footage queued for attach on submit
  const [searchOpen, setSearchOpen] = useState(false);

  const addPending = (footage) => {
    // Footage comes in already shaped by formatSearchResultForAttachment +
    // an id from FootageBrainSearch. We just collect — actual persistence
    // happens on Create with the new reel's id.
    setPending((prev) => {
      if (prev.some((p) => p.footage_file_id === footage.footage_file_id)) return prev;
      return [...prev, footage];
    });
  };
  const removePending = (id) =>
    setPending((prev) => prev.filter((p) => p.footage_file_id !== id));

  const submit = () => {
    const newId = nextReelId(reels);
    // Record each queued clip's Drive link in the reel's detail (the footage
    // table has no drive column) so the card can show "↗ Google Drive".
    const footageDrive = {};
    pending.forEach((p) => {
      if (p.footage_file_id && (p.drive_url || p.drive_folder_url)) {
        footageDrive[p.footage_file_id] = {
          drive_url: p.drive_url || null,
          drive_folder_url: p.drive_folder_url || null,
        };
      }
    });
    // Fields shared by every reel this Create produces — the owner/lane/id are
    // assigned PER editor by createReelForEditors (multi path) or set on the
    // single record below (legacy path), so they're intentionally absent here.
    const baseReel = {
      title: title || "Untitled reel",
      stage, state: "ok",
      age: "just now", due: null,
      stageEnteredAt: new Date().toISOString(),
      fb: pending.length, refs: (audio ? 1 : 0) + (inspo ? 1 : 0),
      blocker: null,
      next: stage === "not_started" ? "Pull selects + write logline" : "Start main edit",
      downstream: null,
      grouping: "not_started",
      // Save the shot plan to `script` — the canonical field the detail view and
      // the AI-generate flow read. (It used to write `plan`, which the detail
      // never displayed, so the shot plan looked lost after Create.)
      logline, vo, audio, inspo, script: plan,
      ...(Object.keys(footageDrive).length ? { detail: { footageDrive } } : {}),
    };

    if (selectedEditorIds.length > 0) {
      // Multi-editor fan-out: one INDEPENDENT copy per editor into their
      // Not-Started box. The store action computes sequential ids up front,
      // assigns owner/lane/title per editor, and attaches a fresh footage copy
      // to each — so NO base/unassigned card is created here.
      const editors = selectedEditorIds.map((id) => {
        const person = peopleList.find((p) => p.id === id) || {};
        return {
          id,
          firstName:
            person.short ||
            (person.name || "").split(" ")[0] ||
            id,
        };
      });
      actions.createReelForEditors(baseReel, pending, editors);
      onClose();
      return;
    }

    // Legacy single-card path: one reel owned by the `owner` default.
    const r = {
      ...baseReel,
      id: newId,
      // List view shows display_number as the reel's number — set it at
      // creation so new reels don't fall back to raw id tails.
      displayNumber: parseInt(newId.slice(5), 10),
      owner, lane: owner,
    };
    // Single action that persists the reel FIRST, then the footage rows —
    // same FK-safe path the Idea Generator uses.
    actions.createReelWithFootage(r, pending.map((p) => ({ ...p, reel_id: newId })));
    if (typeof window !== "undefined" && window.__openReel) window.__openReel(r);
    onClose();
  };

  return (
    <React.Fragment>
      <Modal title="Create new reel" subtitle="All fields are optional — start with what you know."
             onClose={onClose} onSubmit={submit} submitLabel="Create reel">
        <Field label="Title">
          <input className="m-input" value={title} onChange={e => setTitle(e.target.value)}
                 placeholder="e.g. Temple bell close-up" />
        </Field>
        <Field label="Logline" hint="One sentence: what is this reel?">
          <textarea className="m-textarea" rows="2" value={logline}
                    onChange={e => setLogline(e.target.value)}
                    placeholder="" />
        </Field>
        <Field label="Editors / assignees"
               hint={selectedEditorIds.length > 0
                 ? "each selected editor gets their own independent copy in Not Started — leave empty for a single card"
                 : "pick one or more — each gets an independent copy; leave empty for a single card"}>
          {/* Click-to-open multi-select dropdown. Inline disclosure (pushes
              content down) so it never gets clipped by the modal's scroll. */}
          <div style={{ position: "relative" }}>
            <button type="button" className="m-input"
              onClick={() => setEditorMenuOpen((o) => !o)}
              aria-expanded={editorMenuOpen}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 8, width: "100%", textAlign: "left", cursor: "pointer",
                color: selectedEditorIds.length ? "var(--fg)" : "var(--fg-dim)",
              }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {editorSummary}
              </span>
              <span aria-hidden style={{ opacity: 0.7 }}>{editorMenuOpen ? "▴" : "▾"}</span>
            </button>
            {editorMenuOpen && (
              <div style={{
                marginTop: 4,
                border: "1px solid var(--line-hard, var(--line))",
                borderRadius: 6, background: "var(--bg-2)",
                maxHeight: 220, overflowY: "auto",
                padding: 4,
              }}>
                {ownerOptions.length === 0 && (
                  <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--fg-dim)" }}>
                    No editors found.
                  </div>
                )}
                {ownerOptions.map((o) => {
                  const on = selectedEditorIds.includes(o.k);
                  return (
                    <label key={o.k}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "7px 9px", borderRadius: 4, cursor: "pointer",
                        fontSize: 12.5,
                        background: on ? "rgba(107,214,224,0.08)" : "transparent",
                      }}>
                      <input type="checkbox" checked={on}
                        onChange={() => toggleEditor(o.k)} />
                      <span>{o.l}</span>
                    </label>
                  );
                })}
                {selectedEditorIds.length > 0 && (
                  <button type="button"
                    onClick={() => setSelectedEditorIds([])}
                    style={{
                      width: "100%", marginTop: 4, padding: "6px 9px",
                      background: "transparent", border: "none", cursor: "pointer",
                      color: "var(--fg-dim)", fontSize: 11.5, textAlign: "left",
                    }}>
                    Clear selection
                  </button>
                )}
              </div>
            )}
          </div>
        </Field>
        <Field label="Stage">
          <SegRow value={stage} onChange={setStage}
                  options={[
                    { k: "not_started", l: "Not started" },
                    { k: "in_progress", l: "In progress" },
                    { k: "review",      l: "Review" },
                  ]} />
        </Field>
        <div className="modal-grid-2">
          <Field label="Audio / music link">
            <input className="m-input" value={audio} onChange={e => setAudio(e.target.value)}
                   placeholder="Spotify, library, drive…" />
          </Field>
          <Field label="Inspiration link">
            <input className="m-input" value={inspo} onChange={e => setInspo(e.target.value)}
                   placeholder="https://instagram.com/p/…" />
          </Field>
        </div>
        <Field label="Voiceover read">
          <textarea className="m-textarea" rows="2" value={vo}
                    onChange={e => setVo(e.target.value)}
                    placeholder="" />
        </Field>
        <Field label="Beat plan / shot list">
          <textarea className="m-textarea script" rows="6" value={plan}
                    onChange={e => setPlan(e.target.value)}
                    placeholder="" />
        </Field>

        <Field label="Attached footage" hint="Pulled from Footage Brain — added to the new reel on Create">
          {pending.length === 0 ? (
            <div style={{
              fontSize: 12, color: "var(--fg-dim)",
              padding: "8px 0 4px",
            }}>
              No clips queued. Use the button below to search Footage Brain.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 6 }}>
              {pending.map((p) => (
                <div key={p.footage_file_id} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 8px",
                  border: "1px dashed var(--line-hard, var(--border))",
                  borderRadius: 4,
                  fontSize: 12,
                }}>
                  <span style={{ flex: 1, color: "var(--fg)", wordBreak: "break-word" }}>
                    {p.filename}
                  </span>
                  <span style={{
                    fontSize: 10.5,
                    fontFamily: "var(--f-mono)",
                    color: "var(--fg-dim)",
                  }}>
                    {p.duration_seconds ? p.duration_seconds.toFixed(1) + "s" : ""}
                  </span>
                  <span onClick={() => removePending(p.footage_file_id)}
                        title="Remove from queue"
                        style={{ cursor: "pointer", color: "var(--fg-dim)", fontSize: 14, padding: "0 4px" }}>
                    ×
                  </span>
                </div>
              ))}
            </div>
          )}
          <DPill onClick={() => setSearchOpen(true)}>
            {pending.length === 0 ? "+ Search & attach footage" : "+ Add more footage"}
          </DPill>
        </Field>
      </Modal>

      {searchOpen && (
        <FootageBrainSearch
          reelId={"__pending__"} /* placeholder — real reel id set on submit */
          onAttach={addPending}
          onClose={() => setSearchOpen(false)}
          attachedIds={pending.map((p) => p.footage_file_id)}
        />
      )}
    </React.Fragment>
  );
}
