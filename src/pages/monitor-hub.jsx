/* =========================================================
   Monitor hub — owner-only intelligence surface.

   Consolidates the three formerly-separate owner dashboards
   (infra Monitor, Pulse, AI Brain) into ONE tab with a sub-tab
   strip, mirroring the Pipeline sub-mode bar and the Reel DNA /
   AI-Brain internal sub-tab pattern.

   • Each sub-tab is gated independently by canView() so the
     owner's per-role grants still apply per sub-view.
   • The hub tab itself only mounts when at least one of the
     three is allowed (gating wired in app.jsx via canViewView).
   • Mounts the existing page components AS-IS — composition,
     not surgery; their internal state/effects are untouched.
   ========================================================= */
import React, { useState, useEffect, useMemo } from "react";
import { DPill } from "../components/components.jsx";
import { Monitor } from "./monitor.jsx";
import { Pulse } from "./pulse.jsx";
import { AIBrain } from "./ai-brain.jsx";

const MONITOR_MODE_KEY = "wb_monitor_mode";

// view = the permission-catalog key each sub-view is gated by (preserved
// verbatim from when these were top-level tabs, so gating never changes).
const SUBVIEWS = [
  { key: "infra", label: "Infra",    view: "monitor", Comp: Monitor },
  { key: "pulse", label: "Pulse",    view: "pulse",   Comp: Pulse },
  { key: "ai",    label: "AI Brain", view: "ai",      Comp: AIBrain },
];

export function MonitorHub({ canView }) {
  const allowed = useMemo(() => SUBVIEWS.filter(s => canView(s.view)), [canView]);

  const [mode, setMode] = useState(() => localStorage.getItem(MONITOR_MODE_KEY) || "infra");

  // Land on the first allowed sub-tab when the persisted one isn't currently
  // granted (a role with only Pulse must not land on a blank Infra screen).
  const activeKey = allowed.some(s => s.key === mode) ? mode : (allowed[0]?.key ?? null);

  useEffect(() => { if (activeKey && activeKey !== mode) setMode(activeKey); }, [activeKey, mode]);
  useEffect(() => { localStorage.setItem(MONITOR_MODE_KEY, mode); }, [mode]);

  if (allowed.length === 0) return null;   // defensive: hub only mounts when ≥1 granted

  const Active = (allowed.find(s => s.key === activeKey) || allowed[0]).Comp;

  return (
    <div>
      {allowed.length > 1 && (
        <div className="submode-bar">
          <span className="mono dim" style={{ alignSelf: "center" }}>monitor</span>
          {allowed.map(s => (
            <DPill key={s.key} active={activeKey === s.key} onClick={() => setMode(s.key)}>
              {s.label}
            </DPill>
          ))}
          <span style={{ flex: 1 }} />
          <span className="mono dim" style={{ alignSelf: "center" }}>owner intelligence</span>
        </div>
      )}
      <Active />
    </div>
  );
}
