/* =========================================================
   Global "+ Create" floating action — bottom-right.
   Opens a small menu with two flows:
     · Create Task     → TaskModal (lightweight request)
     · Create New Reel → ReelModal (structured reel skeleton)

   The modals live in ./modals/ and submit through the
   WorkflowStore actions, so every subscribed view sees
   the change immediately.
   ========================================================= */

import React, { useState } from "react";
import { TaskModal } from "./modals/TaskModal.jsx";
import { ReelModal } from "./modals/ReelModal.jsx";
import { usePermissions } from "../lib/permissions.jsx";

export function CreateFab() {
  const { can } = usePermissions();
  const canCreateReel = can("createReel");
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
            {canCreateReel && (
              <div className="fab-opt" onClick={() => { setFlow("reel"); setOpen(false); }}>
                <span className="k">◐</span>
                <div>
                  <div className="t">Create new reel</div>
                  <div className="s">Seed a reel with title, logline, footage links and shot plan.</div>
                </div>
              </div>
            )}
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
