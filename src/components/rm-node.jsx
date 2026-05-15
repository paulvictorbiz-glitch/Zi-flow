/* =========================================================
   Expandable roadmap node — folds in context that used
   to live in the right column (next review, handoff,
   downstream readiness).
   ========================================================= */

import React, { useState } from "react";

function RmNode({ num, tone, title, sub, right, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={"rm-node " + (tone || "") + (open ? " open" : "")}>
      <div className="rm-node-head" onClick={() => setOpen(o => !o)}>
        <div className="num">{num}</div>
        <div>
          <div className="title">{title}</div>
          <div className="sub">{sub}</div>
        </div>
        <div>{right}</div>
        <div className="chev">▾</div>
      </div>
      {open && <div className="rm-node-body">{children}</div>}
    </div>
  );
}

export { RmNode };
