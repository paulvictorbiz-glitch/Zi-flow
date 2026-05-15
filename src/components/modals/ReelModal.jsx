/* =========================================================
   "Create new reel" modal.

   Seeds a structured reel skeleton: title, logline, owner,
   stage, audio/inspiration links, voiceover, shot plan, and
   any footage clips queued from a Footage Brain search.
   On submit, calls actions.createReel and then attaches each
   queued footage row with the new reel's id.
   ========================================================= */

import React, { useState } from "react";
import { DPill } from "../components.jsx";
import { useWorkflow } from "../../store/store.jsx";
import { FootageBrainSearch } from "../FootageBrainSearch.jsx";
import { Modal, Field, SegRow } from "./Modal.jsx";

/* Compute the next sequential REEL id from the current store.
   Format: REEL-NNN (zero-padded to 3 digits, expands to 4+ if needed).
   The first reel after a clean wipe gets REEL-000. */
function nextReelId(reels) {
  const nums = (reels || [])
    .map((r) => {
      const m = /^REEL-(\d+)$/.exec(r?.id || "");
      return m ? parseInt(m[1], 10) : -1;
    })
    .filter((n) => n >= 0);
  const next = nums.length ? Math.max(...nums) + 1 : 0;
  return "REEL-" + String(next).padStart(3, "0");
}

export function ReelModal({ onClose }) {
  const { actions, reels } = useWorkflow();
  const [title, setTitle]       = useState("");
  const [logline, setLogline]   = useState("");
  const [vo, setVo]             = useState("");
  const [audio, setAudio]       = useState("");
  const [inspo, setInspo]       = useState("");
  const [plan, setPlan]         = useState("");
  const [owner, setOwner]       = useState("alex");
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
    const r = {
      id: newId,
      title: title || "Untitled reel",
      stage, owner, lane: owner, state: "ok",
      age: "just now", due: null,
      stageEnteredAt: new Date().toISOString(),
      fb: pending.length, refs: (audio ? 1 : 0) + (inspo ? 1 : 0),
      blocker: null,
      next: stage === "not_started" ? "Pull selects + write logline" : "Start main edit",
      downstream: null,
      grouping: "not_started",
      logline, vo, audio, inspo, plan,
    };
    actions.createReel(r);
    // Persist queued footage attachments now that we have the reel id.
    pending.forEach((p) => actions.addAttachedFootage({ ...p, reel_id: newId }));
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
        <div className="modal-grid-2">
          <Field label="Owner / assignee">
            <SegRow value={owner} onChange={setOwner}
                    options={[
                      { k: "alex", l: "Judy A · Skilled" },
                      { k: "sam",  l: "Jay · Variant"     },
                      { k: "paul", l: "Paul V · Owner"   },
                    ]} />
          </Field>
          <Field label="Stage">
            <SegRow value={stage} onChange={setStage}
                    options={[
                      { k: "not_started", l: "Not started" },
                      { k: "in_progress", l: "In progress" },
                      { k: "review",      l: "Review" },
                    ]} />
          </Field>
        </div>
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
