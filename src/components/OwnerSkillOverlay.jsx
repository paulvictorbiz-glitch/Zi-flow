/* =========================================================
   OwnerSkillOverlay — aggregate team skill chart for the owner's
   My Work dashboard.

   Overlays every team member's skill spider chart on one radar, with
   a per-user toggle chip to show/hide each overlay. Renders nothing
   when gamify is disabled.
   ========================================================= */

import React from "react";
import { useWorkflow } from "../store/store.jsx";
import { useRoster } from "../lib/roster.jsx";
import SpiderChart from "./SpiderChart.jsx";
import "./gamify.css";

/* Distinct overlay colors (same palette as the Monitor card). */
const SERIES_COLORS = ["#6fd6ff", "#a99bff", "#5ad17a", "#f0c060", "#ff6f91", "#ff9f5a"];

export default function OwnerSkillOverlay() {
  const { gamifyEnabled, gamifyProgress } = useWorkflow();
  const { peopleList } = useRoster();

  // Everyone except the owner, paired with a stable overlay color.
  const team = (peopleList || [])
    .filter(p => p.role !== "owner")
    .map((p, i) => {
      const prog = gamifyProgress.find(g => g.personId === p.id);
      return {
        id: p.id,
        name: p.short || p.name || p.id,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        scores: prog?.skillScores || {},
        totalXp: prog?.totalXp || 0,
        hasData: !!prog && Object.keys(prog.skillScores || {}).length > 0,
      };
    });

  // Which users are currently shown. Default: all with data on.
  const [shown, setShown] = React.useState(null);
  React.useEffect(() => {
    if (shown === null && team.length) {
      const init = {};
      for (const t of team) init[t.id] = t.hasData;
      setShown(init);
    }
  }, [team, shown]);

  if (!gamifyEnabled) return null;

  const isShown = (id) => (shown ? shown[id] : false);
  const toggle = (id) => setShown(s => ({ ...(s || {}), [id]: !s?.[id] }));

  const series = team
    .filter(t => isShown(t.id))
    .map(t => ({ label: t.name, color: t.color, scores: t.scores }));

  return (
    <div className="ow-team-section">
      <div className="ow-section-head">
        <span className="ow-section-title">Team Skill Overlay</span>
        <span style={{ fontSize: 10.5, fontFamily: "var(--f-mono)", color: "var(--fg-dim)" }}>
          {series.length} of {team.length} shown
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 320px) 1fr",
                    gap: 24, alignItems: "center", padding: "12px 0" }}>
        {/* Overlay chart */}
        <div>
          {series.length ? (
            <SpiderChart series={series} size={300} labelMode="short" />
          ) : (
            <div style={{ fontSize: 12, color: "var(--fg-dim)", fontFamily: "var(--f-mono)",
                          height: 300, display: "flex", alignItems: "center", justifyContent: "center",
                          textAlign: "center" }}>
              No users selected — toggle someone on, or grade a reel's rubric to populate skills.
            </div>
          )}
        </div>

        {/* Toggle list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {team.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              className="gf-skill-toggle"
              style={{
                justifyContent: "space-between",
                width: "100%",
                opacity: t.hasData ? 1 : 0.5,
                borderColor: isShown(t.id) ? t.color : "var(--line-hard)",
                background: isShown(t.id) ? `${t.color}1a` : "transparent",
              }}
              title={t.hasData ? "" : "No skill data yet"}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="gf-legend-dot" style={{
                  background: isShown(t.id) ? t.color : "var(--fg-mute)",
                }} />
                {t.name}
              </span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 10,
                             color: isShown(t.id) ? t.color : "var(--fg-mute)" }}>
                {t.totalXp.toLocaleString()} XP {isShown(t.id) ? "·  on" : "· off"}
              </span>
            </button>
          ))}
          {!team.length && (
            <div style={{ fontSize: 12, color: "var(--fg-dim)" }}>No team members.</div>
          )}
        </div>
      </div>
    </div>
  );
}
