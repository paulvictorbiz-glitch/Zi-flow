/* =========================================================
   RubricQuickRef — collapsible grading-rubric reference.

   Rendered inside the Training page (replaces the old flat RUBRIC
   table). Reads the rubric straight from gamify-data.jsx (the single
   source of truth) — NO rubric text is duplicated here.

   Lists each pillar (GAMIFY_SKILLS order: 6 core, then 3 bonus) with
   its subskills and the three grade-band descriptions (columns from
   RUBRIC_COLUMNS: Junior Editor / Skilled Editor / Professional).

   Optional `onJumpToModule(skillKey)` — when provided, CORE pillars
   (which have a training module) render a small "↓ open module" link.
   Bonus pillars have no module, so no link. Keeping it optional means
   the component works fine before the integration layer is wired.
   ========================================================= */

import React, { useState } from "react";
import {
  RUBRIC,
  RUBRIC_COLUMNS,
  GAMIFY_SKILLS,
} from "../lib/gamify-data.jsx";

const GRADE_KEYS = ["junior-editor", "skilled-editor", "professional"];

export function RubricQuickRef({ onJumpToModule }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="tr-rubric tr-quickref">
      <button
        type="button"
        className="tr-quickref-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>📋 Grading rubric reference — {open ? "collapse" : "expand"}</span>
        <span className="tr-quickref-caret">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="tr-quickref-body">
          <div className="tr-quickref-hint">
            How each pillar is graded on a reel. Aim to move every subskill from
            Junior → Skilled → Professional.
          </div>

          {GAMIFY_SKILLS.map((skill) => {
            const pillar = RUBRIC[skill.key];
            if (!pillar) return null;
            const canJump = !skill.bonus && typeof onJumpToModule === "function";
            return (
              <div key={skill.key} className="tr-quickref-pillar" id={"tr-rubric-" + skill.key}>
                <div className="tr-quickref-pillar-head">
                  <span className="tr-quickref-pillar-title">
                    <span className="tr-quickref-icon">{skill.icon}</span>
                    {pillar.label}
                    {skill.bonus && <span className="tr-quickref-bonus">Bonus</span>}
                  </span>
                  {canJump && (
                    <button
                      type="button"
                      className="tr-quickref-jump"
                      onClick={() => onJumpToModule(skill.key)}
                      title={"Open the " + pillar.label + " module"}
                    >
                      ↓ open module
                    </button>
                  )}
                </div>

                <div className="tr-rubric-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Subskill</th>
                        {RUBRIC_COLUMNS.map((c) => <th key={c}>{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {pillar.subskills.map((sub) => (
                        <tr key={sub.id}>
                          <td>{sub.label}</td>
                          {GRADE_KEYS.map((g) => (
                            <td key={g}>{sub.grades?.[g] || "—"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default RubricQuickRef;
