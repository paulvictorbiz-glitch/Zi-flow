/* =========================================================
   GamifyRubricSheet — the Skills & Rubric card on a reel's detail.

   Flow:
     1. Skill tag buttons (10 canonical skills). Toggling a skill adds
        it to the reel's skill_tags AND activates that skill's rubric
        section below (un-greys it).
     2. For each active skill, a rubric sheet:
          · Average / Decent / Excellent column headers
          · one row per sub-skill
          · editor self-assessment checkboxes per checklist item
          · reviewer grade radios (Average/Decent/Excellent) per sub-skill
     3. XP preview: "+N XP if completed".

   Grading-mode aware:
     · "editor+reviewer" → editor checks; reviewer grades; once a reviewer
       grade exists the editor's checks render greyed (self-view vs grade).
     · "reviewer_only"  → editor self-assessment is hidden entirely; the
       reviewer just fills the rubric the editor sees.

   Permission gates:
     · can("selfAssessRubric") → editor may toggle their checkboxes
     · can("gradeRubric")      → reviewer/owner may set grades
   ========================================================= */

import React from "react";
import { Card } from "./components.jsx";
import { useWorkflow } from "../store/store.jsx";
import { useAuth } from "../auth.jsx";
import { usePermissions } from "../lib/permissions.jsx";
import SpiderChart from "./SpiderChart.jsx";
import {
  GAMIFY_SKILLS, SKILL_BY_KEY, RUBRIC, RUBRIC_COLUMNS,
  maxXpForSkills, XP_PER_GRADE, reelSkillProfile, difficultyMultiplier,
} from "../lib/gamify-data.jsx";
import "./gamify.css";

const GRADES = ["average", "decent", "excellent"];

export default function GamifyRubricSheet({ reel }) {
  const { gamifyEnabled, gamifyGradingMode, gamifyRubrics,
          actions } = useWorkflow();
  const { person: me } = useAuth();
  const { can } = usePermissions();

  if (!gamifyEnabled || !reel?.id) return null;

  const reelId = reel.id;
  // The editor being assessed is the reel's owner.
  const editorId = reel.owner;
  const skillTags = reel.skill_tags || [];

  /* Authority follows the REAL logged-in user, NOT the previewed perspective.
     When the owner previews "Jay's view", the permissions system swaps
     effectiveRole to variant — which would (wrongly) strip the owner's ability
     to grade. Gamify authority is about who you actually are:
       · owner    → can tag, grade, and set difficulty (full control)
       · reviewer → can grade
       · others   → can self-assess
     `me` is the real signed-in person from useAuth (perspective-independent). */
  const myRole = me?.role;
  const isOwner = myRole === "owner";
  const canTag    = isOwner || can("tagReelSkills");
  const canGrade  = isOwner || myRole === "reviewer" || can("gradeRubric");
  const canSelf   = isOwner || can("selfAssessRubric");
  const reviewerOnly = gamifyGradingMode === "reviewer_only";

  // Rubric rows for this reel+editor, keyed by skill.
  const rowFor = (skillKey) => gamifyRubrics.find(r =>
    r.reelId === reelId && r.personId === editorId && r.skillKey === skillKey);

  const toggleSkill = (key) => {
    if (!canTag) return;
    const next = skillTags.includes(key)
      ? skillTags.filter(k => k !== key)
      : [...skillTags, key];
    actions.updateReel(reelId, { skill_tags: next });
  };

  const toggleCheck = (skillKey, itemId) => {
    if (!canSelf || reviewerOnly) return;
    const row = rowFor(skillKey);
    const checked = row?.editorChecked || [];
    const next = checked.includes(itemId)
      ? checked.filter(i => i !== itemId)
      : [...checked, itemId];
    actions.saveEditorRubric(reelId, editorId, skillKey, next);
  };

  const setGrade = (skillKey, subId, grade) => {
    if (!canGrade) return;
    actions.saveReviewerGrade(reelId, editorId, skillKey, subId, grade);
  };

  const xpPreview = maxXpForSkills(skillTags);
  const earnedXp = skillTags.reduce((sum, k) => sum + (rowFor(k)?.xpAwarded || 0), 0);

  // Per-reel DIFFICULTY profile for the spider chart. The admin drags these
  // points; the value is the difficulty (0..100) which scales the XP each
  // skill awards. Stored on the reel's detail blob.
  const difficultyMap = reel.gamifyDifficulty || {};
  const reelProfile = reelSkillProfile(skillTags, difficultyMap);
  const canSetDifficulty = canGrade;   // owner/reviewer drags difficulty

  const onDragDifficulty = (skillKey, value) => {
    if (!canSetDifficulty) return;
    actions.setReelDifficulty(reelId, skillKey, value);
  };

  return (
    <Card
      title="🎮 Skills & Rubric"
      right={<span className="gf-exp-badge">
        {earnedXp > 0 ? `${earnedXp} XP earned` : `+${xpPreview} XP`}
      </span>}
      footLeft={reviewerOnly
        ? "Reviewer fills the rubric · editor sees the grade"
        : "Editor self-assesses · you give the revised grade"}
    >
      {/* Skill tag buttons */}
      <div className="gf-skill-toggles">
        {GAMIFY_SKILLS.map(s => {
          const active = skillTags.includes(s.key);
          return (
            <button
              key={s.key}
              type="button"
              className={`gf-skill-toggle${active ? " active" : ""}`}
              onClick={() => toggleSkill(s.key)}
              disabled={!canTag}
              title={canTag ? "Toggle this skill for the reel" : "Owner curates which skills a reel teaches"}
            >
              <span>{s.icon}</span>{active ? "✓ " : ""}{s.label}
            </button>
          );
        })}
      </div>

      {skillTags.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--fg-dim)", padding: "6px 0" }}>
          {canTag
            ? "Tag the skills this reel practices to activate their rubrics."
            : "No skills tagged for this reel yet."}
        </div>
      )}

      {/* This reel's DIFFICULTY spider chart. Owners drag a point in/out to
          set how hard that skill is on this reel — which scales the XP it
          awards. Editors see it read-only. */}
      {skillTags.length > 0 && (
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
          <div style={{ width: 240 }}>
            <SpiderChart
              scores={reelProfile} size={240} rings={5}
              labelMode="short" fillColor="var(--c-amber)"
              editable={canSetDifficulty}
              editableKeys={skillTags}
              onChange={onDragDifficulty}
            />
            <div style={{ textAlign: "center", marginTop: 4,
                          fontFamily: "var(--f-mono)", fontSize: 10,
                          color: "var(--fg-mute)" }}>
              {canSetDifficulty
                ? "Drag points: outward = harder (more XP), inward = easier"
                : "This reel's difficulty profile"}
            </div>
          </div>
        </div>
      )}

      {/* Rubric sheets per active skill */}
      <div className="gf-rubric">
        {skillTags.map(skillKey => {
          const def = RUBRIC[skillKey];
          if (!def) return null;
          const skill = SKILL_BY_KEY[skillKey];
          const row = rowFor(skillKey);
          const grades = row?.reviewerGrades || {};      // { subId: grade }
          const editorChecks = new Set(row?.editorChecked || []);
          const gradedCount = Object.keys(grades).length;
          const skillXp = row?.xpAwarded || 0;
          const mult = difficultyMultiplier(reelProfile[skillKey]);

          return (
            <div key={skillKey} className="gf-rubric-skill">
              <div className="gf-rubric-skill-head">
                <span>
                  <span className="gf-skill-icon">{skill?.icon}</span>{def.label}
                  <span style={{ marginLeft: 8, fontFamily: "var(--f-mono)", fontSize: 10,
                                 color: "var(--c-amber)" }}
                        title="Difficulty multiplier from the spider chart">
                    {mult.toFixed(2)}×
                  </span>
                </span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11,
                               color: gradedCount ? "var(--c-green)" : "var(--fg-mute)" }}>
                  {gradedCount
                    ? `${gradedCount}/${def.subskills.length} graded · +${skillXp} XP`
                    : "ungraded"}
                </span>
              </div>

              <div className="gf-rubric-cols">
                <span>Sub-skill</span>
                {RUBRIC_COLUMNS.map(c => <span key={c}>{c}</span>)}
              </div>

              {def.subskills.map(sub => {
                const rowGrade = grades[sub.id] || null;   // this row's grade
                const rowGraded = !!rowGrade;
                return (
                  <div key={sub.id} className="gf-subskill">
                    <div>
                      <div className="gf-subskill-label">{sub.label}</div>
                      {/* Editor self-assessment checklist (hidden in reviewer-only mode) */}
                      {!reviewerOnly && (
                        <div className="gf-subskill-items">
                          {sub.items.map((item, idx) => {
                            const itemId = `${sub.id}:${idx}`;
                            const isChecked = editorChecks.has(itemId);
                            // Once THIS row is graded, ghost the editor's self-view
                            // so you can compare self-assessment vs your grade.
                            const ghost = rowGraded;
                            return (
                              <label key={itemId}
                                     className={`gf-check${isChecked ? " checked" : ""}${ghost ? " editor-ghost" : ""}`}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={!canSelf || ghost}
                                  onChange={() => toggleCheck(skillKey, itemId)}
                                />
                                {item}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Reviewer grade radios — one per band, scoped to THIS row.
                        Clicking the active grade again clears it. */}
                    {GRADES.map(g => (
                      <div key={g} className="gf-grade-radio">
                        <input
                          type="radio"
                          name={`${skillKey}-${sub.id}`}
                          checked={rowGrade === g}
                          disabled={!canGrade}
                          onClick={() => { if (rowGrade === g) setGrade(skillKey, sub.id, null); }}
                          onChange={() => setGrade(skillKey, sub.id, g)}
                          title={canGrade ? `Grade ${sub.label}: ${g}` : "Reviewer grades this row"}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
