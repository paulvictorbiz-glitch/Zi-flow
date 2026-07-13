// HUD "CONTROLS" panel — flip the real owner feature switches (free-LLM gates,
// gamify_enabled, unified_cards) + launch the Monitor sub-views. Self-contained:
// reads its own hooks, owns its .hudctl-* scoped css, and NEVER throws past its
// own boundary. Renders cleanly inside BOTH the flat 2D HudModal body AND the
// pinned HudDock. Only props: { onOpenTab, onClose }.
//
// Contract K1/K4/K5 — all writes route through EXISTING actions/saveGates; the
// panel never writes app_settings directly. HUD is owner-gated, so every write
// here is owner-only by construction.

import React, { useEffect, useMemo, useState } from "react";
import { loadGates, saveGates, GATE_FEATURES, isBlocked } from "../../lib/free-llm-gates.js";
import { useWorkflow } from "../../store/store.jsx";
import { usePermissions } from "../../lib/permissions.jsx";
import { useMonitorStatus } from "../../lib/use-monitor-status.js";
import "./hud-controls.css";

const MONITOR_MODE_KEY = "wb_monitor_mode";

// Mirror of monitor-hub's SUBVIEWS (READ-ONLY reference — we do NOT import from
// monitor-hub to avoid pulling its heavy tree into the HUD bundle). `mode` = the
// wb_monitor_mode key the hub restores; `view` = the permission view key canView
// gates on. mapforge/infra both live under the "monitor" view key.
const SUBVIEWS = [
  { mode: "infra",    label: "Infra",    view: "monitor", desc: "provider health · budgets" },
  { mode: "pulse",    label: "Pulse",    view: "pulse",   desc: "world news · signals" },
  { mode: "ai",       label: "AI Brain", view: "ai",      desc: "free-LLM usage · costs" },
  { mode: "scout",    label: "Scout",    view: "scout",   desc: "micro-SaaS discovery" },
  { mode: "mapforge", label: "MapForge", view: "monitor", desc: "geo · map layers" },
];

/* A single labelled switch. `on` = the user-facing enabled state. */
function CtlSwitch({ on, disabled, onToggle, title, sub, tone }) {
  return (
    <button
      type="button"
      className={`hudctl-switch${on ? " is-on" : ""}`}
      disabled={disabled}
      aria-pressed={on}
      onClick={() => onToggle(!on)}
      style={tone ? { "--hudctl-tone": tone } : undefined}
    >
      <span className="hudctl-switch-meta">
        <span className="hudctl-switch-title">{title}</span>
        {sub ? <span className="hudctl-switch-sub">{sub}</span> : null}
      </span>
      <span className="hudctl-track" aria-hidden="true"><span className="hudctl-thumb" /></span>
      <span className="hudctl-state">{on ? "ON" : "OFF"}</span>
    </button>
  );
}

export function HudControlsPanel({ onOpenTab, onClose }) {
  const wf = useWorkflow();
  const actions = wf?.actions || {};
  const gamifyEnabled = !!wf?.gamifyEnabled;
  const unifiedCards = !!wf?.unifiedCards;

  const { canView } = usePermissions();
  const mon = useMonitorStatus({ enabled: true });

  const [gates, setGates] = useState(null);      // null until loaded
  const [gatesErr, setGatesErr] = useState(null);
  const [saving, setSaving] = useState(false);

  // Load the free-LLM gate flags once on mount. Fall back to an empty object
  // (everything enabled) on failure and surface an inline error.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = await loadGates();
        if (alive) setGates(g || {});
      } catch (e) {
        if (alive) { setGates({}); setGatesErr("Couldn't load gate settings — showing defaults."); }
      }
    })();
    return () => { alive = false; };
  }, []);

  // Persist a gate change through saveGates (owner-write RLS). Optimistic: apply
  // locally, then save; on failure revert + show an inline error. Never throws.
  async function commitGates(next) {
    const prev = gates;
    setGates(next);
    setSaving(true);
    setGatesErr(null);
    try {
      await saveGates(next);
    } catch (e) {
      setGates(prev);
      setGatesErr("Save failed — reverted. Try again.");
    } finally {
      setSaving(false);
    }
  }

  // A feature is "Enabled" when NOT blocked. Flipping the switch ON clears the
  // block flag; OFF sets it. (true = BLOCKED in storage.)
  function setGateEnabled(key, enabled) {
    if (!gates) return;
    commitGates({ ...gates, [key]: !enabled });
  }

  const globalEnabled = gates ? !gates.global : true;

  function launchMonitor(mode) {
    try { localStorage.setItem(MONITOR_MODE_KEY, mode); } catch { /* quota */ }
    onOpenTab?.("monitor");
  }

  // Light health line: count usable provider sections from the monitor poll.
  const health = useMemo(() => {
    if (mon?.loading && !mon?.data) return "checking status…";
    if (mon?.error && !mon?.data) return "status unavailable";
    const d = mon?.data;
    if (!d) return "no status yet";
    const sections = ["supabase", "hetzner", "gcp", "os", "worldMonitor"];
    let ok = 0, total = 0;
    for (const k of sections) {
      const s = d[k];
      if (!s || s.configured === false) continue;
      total += 1;
      if (!s.error) ok += 1;
    }
    if (total === 0) return "status idle";
    return `${ok}/${total} providers healthy`;
  }, [mon?.data, mon?.loading, mon?.error]);

  return (
    <div className="hudctl">
      {/* ── FEATURE TOGGLES ─────────────────────────────────────────── */}
      <section className="hudctl-sec">
        <header className="hudctl-sec-head">
          <h3 className="hudctl-sec-title">Feature switches</h3>
          <span className="hudctl-hint">
            {saving ? "saving…" : "ON = enabled · OFF = blocked"}
          </span>
        </header>

        {gatesErr ? <div className="hudctl-err">{gatesErr}</div> : null}

        {!gates ? (
          <div className="hudctl-empty">Loading switches…</div>
        ) : (
          <>
            <CtlSwitch
              on={globalEnabled}
              disabled={saving}
              tone="var(--c-red)"
              title="Free-LLM master"
              sub={globalEnabled ? "all free-LLM features live" : "GLOBAL KILL — everything blocked"}
              onToggle={(en) => commitGates({ ...gates, global: !en })}
            />

            <div className="hudctl-list">
              {GATE_FEATURES.map((f) => {
                const blocked = isBlocked(gates, f.key);
                // Only the feature's own flag drives its switch (the global kill
                // is shown separately). Reflect the raw per-feature flag so the
                // owner can pre-arm features while the global kill is on.
                const ownEnabled = !gates[f.key];
                return (
                  <CtlSwitch
                    key={f.key}
                    on={ownEnabled}
                    disabled={saving}
                    tone={f.color}
                    title={f.label}
                    sub={
                      gates.global && !gates[f.key]
                        ? `${f.desc} · (global kill active)`
                        : blocked
                          ? `${f.desc} · BLOCKED`
                          : f.desc
                    }
                    onToggle={(en) => setGateEnabled(f.key, en)}
                  />
                );
              })}
            </div>
          </>
        )}

        <div className="hudctl-list hudctl-list--store">
          <CtlSwitch
            on={gamifyEnabled}
            disabled={typeof actions.setGamifyEnabled !== "function"}
            tone="var(--c-violet)"
            title="Gamify enabled"
            sub="skill scores · reel locks · leaderboards"
            onToggle={(en) => { try { actions.setGamifyEnabled?.(en); } catch { /* store guards */ } }}
          />
          <CtlSwitch
            on={unifiedCards}
            disabled={typeof actions.setUnifiedCards !== "function"}
            tone="var(--c-cyan)"
            title="Unified cards"
            sub="new unified Reel DNA card vs legacy"
            onToggle={(en) => { try { actions.setUnifiedCards?.(en); } catch { /* store guards */ } }}
          />
        </div>
      </section>

      {/* ── MONITOR LAUNCHER ────────────────────────────────────────── */}
      <section className="hudctl-sec">
        <header className="hudctl-sec-head">
          <h3 className="hudctl-sec-title">Monitor sub-views</h3>
          <span className="hudctl-hint" title="from /api/monitor/status">{health}</span>
        </header>

        <div className="hudctl-launch">
          {SUBVIEWS.map((s) => {
            const granted = (() => { try { return !!canView?.(s.view); } catch { return false; } })();
            return (
              <div className={`hudctl-launch-row${granted ? "" : " is-off"}`} key={s.mode}>
                <span className={`hudctl-dot${granted ? " is-on" : ""}`} aria-hidden="true" />
                <span className="hudctl-launch-meta">
                  <span className="hudctl-launch-title">{s.label}</span>
                  <span className="hudctl-launch-sub">{s.desc}</span>
                </span>
                <button
                  type="button"
                  className="hudctl-open"
                  onClick={() => launchMonitor(s.mode)}
                >
                  Open ↗
                </button>
              </div>
            );
          })}
        </div>

        <div className="hudctl-foot">
          <button
            type="button"
            className="hudctl-link"
            onClick={() => onOpenTab?.("monitor")}
            title="Roles &amp; permissions live under the avatar menu"
          >
            Roles &amp; permissions ↗
          </button>
          <span className="hudctl-foot-note">under the avatar menu</span>
        </div>
      </section>
    </div>
  );
}

export default HudControlsPanel;
