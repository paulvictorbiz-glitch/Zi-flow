/* Lightweight "Create task" modal — submits a single Task row
   through actions.createTask. Reachable from the global CreateFab. */

import React, { useState } from "react";
import { useWorkflow } from "../../store/store.jsx";
import { useRoster } from "../../lib/roster.jsx";
import { useAuth } from "../../auth.jsx";
import { Modal, Field, SegRow, SelectInput } from "./Modal.jsx";

export function TaskModal({ onClose }) {
  const { reels, actions } = useWorkflow();
  const { peopleList, canonicalPersonId } = useRoster();
  const { person } = useAuth();
  const [assignee, setAssignee] = useState(() => canonicalPersonId("owner") || person?.id || "");
  const [type, setType]         = useState("Decision");
  const [reel, setReel]         = useState("");          // optional — "" = no linked reel
  const [ref, setRef]           = useState("");
  const [due, setDue]           = useState("today 14:00");
  const [note, setNote]         = useState("");

  const submit = () => {
    const t = {
      // Timestamp-based id — the old 3-digit random collided easily.
      id: "T-" + Date.now().toString(36),
      from: person?.id || canonicalPersonId("owner"),   // the signed-in operator
      to: assignee,
      type,
      reel: reel || null,                               // "" would break the reel_id FK
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
                options={peopleList.map(p => ({ k: p.id, l: p.short }))} />
      </Field>
      <Field label="Type">
        <SegRow value={type} onChange={setType}
                options={["Decision","Source upload","Variant pack","Caption review",
                          "Thumbnail choice","Brief","Other"].map(t => ({ k: t, l: t }))} />
      </Field>
      <div className="modal-grid-2">
        <Field label="Linked reel">
          <SelectInput value={reel} onChange={setReel}
                       options={[{ k: "", l: "— none —" },
                                 ...reels.filter(r => !r.archivedAt)
                                   .map(r => ({ k: r.id, l: r.id + " · " + r.title }))]} />
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
