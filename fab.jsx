/* =========================================================
   Global "+ Create" floating action — bottom-right.
   Opens a small menu with only two flows:
     · Create Task  → lightweight request object
     · Create New Reel → seeds a structured reel skeleton

   Both flows submit through the WorkflowStore actions
   (actions.createTask / actions.createReel) so every view
   that subscribes to the store sees the change immediately.
   ========================================================= */

import React, { useState, useEffect } from "react";
import { DPill } from "./components.jsx";
import { useWorkflow } from "./store.jsx";
import { PEOPLE } from "./shared-data.jsx";
import { FootageBrainSearch } from "./FootageBrainSearch.jsx";
import { formatSearchResultForAttachment } from "./footage-brain-client.js";

function CreateFab() {
  const [open, setOpen] = useState(false);
  const [flow, setFlow] = useState(null); // null | "task" | "reel"

  return (
    <React.Fragment>
      <div className="fab-wrap">
        {open && !flow && (
          <div className="fab-menu">
            <div className="fab-opt" onClick={() => { setFlow("task"); setOpen(false); }}>
              <span className="k">⏵</span>
              <div>
                <div className="t">Create task</div>
                <div className="s">Request someone do something — pick hook, upload source, package variants…</div>
              </div>
            </div>
            <div className="fab-opt" onClick={() => { setFlow("reel"); setOpen(false); }}>
              <span className="k">◐</span>
              <div>
                <div className="t">Create new reel</div>
                <div className="s">Seed a reel with title, logline, footage links and shot plan.</div>
              </div>
            </div>
          </div>
        )}
        <button className={"fab " + (open ? "is-open" : "")} onClick={() => setOpen(o => !o)}>
          <span className="plus">{open ? "×" : "+"}</span>
          <span className="lbl">{open ? "Close" : "Create"}</span>
        </button>
      </div>

      {flow === "task" && <TaskModal onClose={() => setFlow(null)} />}
      {flow === "reel" && <ReelModal onClose={() => setFlow(null)} />}
    </React.Fragment>
  );
}

/* ---------- Create Task modal ---------- */
function TaskModal({ onClose }) {
  const { reels, actions } = useWorkflow();
  const [assignee, setAssignee] = useState("paul");
  const [type, setType]         = useState("Decision");
  const [reel, setReel]         = useState("REEL-201");
  const [ref, setRef]           = useState("");
  const [due, setDue]           = useState("today 14:00");
  const [note, setNote]         = useState("");

  const submit = () => {
    const t = {
      id: "T-" + Math.floor(Math.random() * 900 + 100),
      from: "paul",                    // FAB ships from the current operator; hardcoded for now
      to: assignee,
      type,
      reel,
      instruction: note || ("New " + type.toLowerCase() + " request."),
      due,
      state: "open",
      ref: ref || undefined,
    };
    actions.createTask(t);
    onClose();
  };

  return (
    <Modal title="Create task" subtitle="Lightweight request — appears in the assignee's surfaces."
           onClose={onClose} onSubmit={submit} submitLabel="Create task">
      <Field label="Assign to">
        <SegRow value={assignee} onChange={setAssignee}
                options={Object.values(PEOPLE).map(p => ({ k: p.id, l: p.short + " · " + p.role }))} />
      </Field>
      <Field label="Type">
        <SegRow value={type} onChange={setType}
                options={["Decision","Source upload","Variant pack","Caption review",
                          "Thumbnail choice","Brief","Other"].map(t => ({ k: t, l: t }))} />
      </Field>
      <div className="modal-grid-2">
        <Field label="Linked reel">
          <SelectInput value={reel} onChange={setReel}
                       options={reels.map(r => ({ k: r.id, l: r.id + " · " + r.title }))} />
        </Field>
        <Field label="Due">
          <input className="m-input" value={due} onChange={e => setDue(e.target.value)}
                 placeholder="today 14:00" />
        </Field>
      </div>
      <Field label="Reference link">
        <input className="m-input" value={ref} onChange={e => setRef(e.target.value)}
               placeholder="https://… (drive, frame.io, IG draft)" />
      </Field>
      <Field label="Instruction / note">
        <textarea className="m-textarea" rows="3" value={note} onChange={e => setNote(e.target.value)}
                  placeholder="What needs doing? Be specific — assignee acts on this directly." />
      </Field>
    </Modal>
  );
}

/* Compute the next sequential REEL id from the current store.
   Format: REEL-NNN (zero-padded to 3 digits, expands to 4+ if needed).
   The first reel after a clean wipe gets REEL-000. */
function nextReelId(reels) {
  const nums = (reels || [])
    .map(r => {
      const m = /^REEL-(\d+)$/.exec(r?.id || "");
      return m ? parseInt(m[1], 10) : -1;
    })
    .filter(n => n >= 0);
  const next = nums.length ? Math.max(...nums) + 1 : 0;
  return "REEL-" + String(next).padStart(3, "0");
}

/* ---------- Create New Reel modal ---------- */
function ReelModal({ onClose }) {
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
    setPending(prev => {
      if (prev.some(p => p.footage_file_id === footage.footage_file_id)) return prev;
      return [...prev, footage];
    });
  };
  const removePending = (id) =>
    setPending(prev => prev.filter(p => p.footage_file_id !== id));

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
    pending.forEach(p => actions.addAttachedFootage({ ...p, reel_id: newId }));
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
              {pending.map(p => (
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
          attachedIds={pending.map(p => p.footage_file_id)}
        />
      )}
    </React.Fragment>
  );
}

/* ---------- Modal shell ---------- */
function Modal({ title, subtitle, children, onClose, onSubmit, submitLabel }) {
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="m-backdrop" onClick={onClose}>
      <div className="m-shell" onClick={e => e.stopPropagation()}>
        <div className="m-head">
          <div>
            <div className="m-eyebrow">New</div>
            <div className="m-title">{title}</div>
            <div className="m-sub">{subtitle}</div>
          </div>
          <button className="m-x" onClick={onClose}>✕</button>
        </div>
        <div className="m-body">{children}</div>
        <div className="m-foot">
          <span className="mono dim">Esc to cancel · ⌘↵ to submit</span>
          <div style={{ display: "flex", gap: 8 }}>
            <DPill onClick={onClose}>Cancel</DPill>
            <DPill primary onClick={onSubmit}>{submitLabel}</DPill>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="m-field">
      <div className="m-label">{label} {hint && <span className="m-hint">— {hint}</span>}</div>
      {children}
    </div>
  );
}

function SegRow({ value, onChange, options }) {
  return (
    <div className="m-seg">
      {options.map(o => (
        <button key={o.k}
          className={"m-seg-opt " + (value === o.k ? "is-active" : "")}
          onClick={() => onChange(o.k)}>{o.l}</button>
      ))}
    </div>
  );
}

function SelectInput({ value, onChange, options }) {
  return (
    <select className="m-select" value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.k} value={o.k}>{o.l}</option>)}
    </select>
  );
}

export { CreateFab, TaskModal, ReelModal, Modal, Field, SegRow };
