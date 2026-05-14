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

/* ---------- Create New Reel modal ---------- */
function ReelModal({ onClose }) {
  const { actions } = useWorkflow();
  const [title, setTitle]       = useState("");
  const [logline, setLogline]   = useState("");
  const [fbQuery, setFb]        = useState("");
  const [audio, setAudio]       = useState("");
  const [inspo, setInspo]       = useState("");
  const [plan, setPlan]         = useState("");
  const [owner, setOwner]       = useState("alex");
  const [stage, setStage]       = useState("idea");

  const submit = () => {
    const r = {
      id: "REEL-" + (210 + Math.floor(Math.random() * 89)),
      title: title || "Untitled reel",
      stage, owner, lane: owner, state: "ok",
      age: "just now", due: null,
      stageEnteredAt: new Date().toISOString(),
      fb: 0, refs: (audio ? 1 : 0) + (inspo ? 1 : 0),
      blocker: null,
      next: stage === "idea" ? "Pull selects + write logline" : "Start main edit",
      downstream: null,
      grouping: "not_started",
      logline, fbQuery, audio, inspo, plan,
    };
    actions.createReel(r);
    // Deep-link into the new reel if the shell exposed an opener
    if (typeof window !== "undefined" && window.__openReel) window.__openReel(r);
    onClose();
  };

  return (
    <Modal title="Create new reel" subtitle="Seeds a structured reel skeleton. Sections stay empty but visible."
           onClose={onClose} onSubmit={submit} submitLabel="Create reel">
      <Field label="Title">
        <input className="m-input" value={title} onChange={e => setTitle(e.target.value)}
               placeholder="e.g. Temple bell close-up" />
      </Field>
      <Field label="Logline" hint="One sentence: what is this reel?">
        <textarea className="m-textarea" rows="2" value={logline}
                  onChange={e => setLogline(e.target.value)}
                  placeholder="Bell ring opens the moment. Drone reveal sells the scale." />
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
                    { k: "idea", l: "Idea pool" },
                    { k: "selected", l: "Selected" },
                    { k: "main", l: "Main edit" },
                  ]} />
        </Field>
      </div>
      <Field label="FootageBrain semantic query" hint="Pre-attaches a query for the linked footage section">
        <input className="m-input" value={fbQuery} onChange={e => setFb(e.target.value)}
               placeholder="e.g. bell ringer face close-up, dawn temple, crowd surge" />
      </Field>
      <div className="modal-grid-2">
        <Field label="Audio reference">
          <input className="m-input" value={audio} onChange={e => setAudio(e.target.value)}
                 placeholder="Spotify or library link…" />
        </Field>
        <Field label="Inspiration / IG ref">
          <input className="m-input" value={inspo} onChange={e => setInspo(e.target.value)}
                 placeholder="https://instagram.com/p/…" />
        </Field>
      </div>
      <Field label="Beat plan / shot list">
        <textarea className="m-textarea script" rows="6" value={plan}
                  onChange={e => setPlan(e.target.value)}
                  placeholder={"00:00 — open on bell ring close-up\n00:02 — music drop, cut to wide\n00:08 — drone reveal\n…"} />
      </Field>
    </Modal>
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
