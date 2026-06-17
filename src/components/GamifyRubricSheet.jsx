/* =========================================================
   GamifyRubricSheet — the Skills & Rubric card on a reel's detail.

   Flow:
     1. Skill tag buttons (9 canonical skills). Toggling a skill adds
        it to the reel's skill_tags AND activates that skill's rubric
        section below (un-greys it).
     2. For each active skill, a rubric sheet:
          · Junior Editor / Skilled Editor / Professional column headers
          · one row per sub-skill (with optional grade-band descriptions,
            visibility controlled by the owner's rubricDescMode toggle)
          · editor self-assessment checkboxes per checklist item
          · reviewer grade radios per sub-skill
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
import { usePermissions } from "../lib/permissions.jsx";
import SpiderChart from "./SpiderChart.jsx";
import {
  GAMIFY_SKILLS, SKILL_BY_KEY, RUBRIC, RUBRIC_COLUMNS,
  maxXpForSkills, XP_PER_GRADE, reelSkillProfile, difficultyMultiplier,
} from "../lib/gamify-data.jsx";
import { MODULE_BY_SKILL } from "../lib/training-curriculum.jsx";
import "./gamify.css";

const GRADES = ["junior-editor", "skilled-editor", "professional"];

/* Resolve a hidden-row key "skillKey:subId" to readable "Skill › Sub-skill". */
function labelForHiddenKey(key) {
  const [skillKey, subId] = key.split(":");
  const def = RUBRIC[skillKey];
  const skill = SKILL_BY_KEY[skillKey];
  const sub = def?.subskills?.find(s => s.id === subId);
  return {
    skill: def?.label || skillKey,
    sub: sub?.label || subId,
    icon: skill?.icon || "",
  };
}

export default function GamifyRubricSheet({ reel, onLearnSkill }) {
  const { gamifyEnabled, gamifyGradingMode, rubricDescMode, gamifyRubrics,
          gamifyHiddenSubskills, actions } = useWorkflow();
  const { can, effectiveRole } = usePermissions();
  const [showArchive, setShowArchive] = React.useState(false);

  if (!gamifyEnabled || !reel?.id) return null;

  const reelId = reel.id;
  // The editor being assessed is the reel's owner.
  const editorId = reel.owner;
  const skillTags = reel.skill_tags || [];

  /* Authority follows the active PERSPECTIVE via can()/effectiveRole — the
     same gate the rest of the app uses. This makes two things true at once:
       · When the owner previews "Jay's view", they see exactly what Jay can
         do — so the perspective switcher honestly QAs restricted access, and
         the per-role/per-person toggles set on the admin page take effect.
       · For a real non-owner, effectiveRole is locked to their own role, so
         the same gates apply when they're actually signed in.
     `can()` returns true for the owner perspective, so the owner (when viewing
     as themselves) still has full control without a separate me.role bypass.
     Owner-only admin tooling (archive / hide rows) keys off the owner
     PERSPECTIVE so it disappears while previewing someone restricted. */
  const isOwner = effectiveRole === "owner";
  const reviewerOnly = gamifyGradingMode === "reviewer_only";
  const canTag    = can("tagReelSkills");
  const canGrade  = can("gradeRubric");
  /* The grading MODE is authoritative over self-assessment, above any
     permission toggle: in "reviewer_only" the editor never self-assesses —
     the reviewer fills the rubric — so canSelf is hard-forced off regardless
     of what can("selfAssessRubric") (which can fail-open) would return. */
  const canSelf   = !reviewerOnly && can("selfAssessRubric");

  /* Owner-archived rubric rows. A row is identified globally by
     "skillKey:subId" so hiding it removes it from every reel. Only the owner
     can archive/restore; everyone else just never sees hidden rows. */
  const hidden = gamifyHiddenSubskills || [];
  const hiddenSet = new Set(hidden);
  const rowKey = (skillKey, subId) => `${skillKey}:${subId}`;
  const isHidden = (skillKey, subId) => hiddenSet.has(rowKey(skillKey, subId));

  const hideSubskill = (skillKey, subId) => {
    if (!isOwner) return;
    actions.setGamifyHiddenSubskills([...hidden, rowKey(skillKey, subId)]);
  };
  const restoreSubskill = (key) => {
    if (!isOwner) return;
    actions.setGamifyHiddenSubskills(hidden.filter(k => k !== key));
  };

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
      right={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {isOwner && hidden.length > 0 && (
          <button
            type="button"
            className="gf-archive-btn"
            onClick={() => setShowArchive(v => !v)}
            title="Restore hidden sub-skill rows"
          >
            🗄 Archive · {hidden.length}
          </button>
        )}
        <span className="gf-exp-badge">
          {earnedXp > 0 ? `${earnedXp} XP earned` : `+${xpPreview} XP`}
        </span>
      </span>}
      footLeft={reviewerOnly
        ? "Reviewer fills the rubric · editor sees the grade"
        : "Editor self-assesses · you give the revised grade"}
    >
      {/* Archive panel — restore owner-hidden rubric rows. */}
      {isOwner && showArchive && hidden.length > 0 && (
        <div className="gf-archive-panel">
          <div className="gf-archive-panel-head">
            Archived sub-skills — hidden from every reel's rubric
          </div>
          {hidden.map(key => {
            const l = labelForHiddenKey(key);
            return (
              <div key={key} className="gf-archive-row">
                <span><span className="gf-skill-icon">{l.icon}</span>{l.skill} <span style={{ color: "var(--fg-mute)" }}>›</span> {l.sub}</span>
                <button type="button" className="gf-archive-restore"
                        onClick={() => restoreSubskill(key)}>
                  Restore
                </button>
              </div>
            );
          })}
        </div>
      )}

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

          // Hidden rows are archived globally — drop them from the sheet.
          const visibleSubs = def.subskills.filter(s => !isHidden(skillKey, s.id));
          if (visibleSubs.length === 0) return null;

          // When descriptions are on, each band's text lives UNDER its own
          // column (above the radio), so the redundant per-row level labels and
          // the separate description block are gone.
          const showDescs = rubricDescMode !== "off";

          return (
            <div key={skillKey} className={`gf-rubric-skill${showDescs ? " desc-mode" : ""}`}>
              <div className="gf-rubric-skill-head">
                <span>
                  <span className="gf-skill-icon">{skill?.icon}</span>{def.label}
                  <span style={{ marginLeft: 8, fontFamily: "var(--f-mono)", fontSize: 10,
                                 color: "var(--c-amber)" }}
                        title="Difficulty multiplier from the spider chart">
                    {mult.toFixed(2)}×
                  </span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Deep-link to the matching training module so a graded
                      editor can click through to learn how to improve. Only
                      shown for the 6 CORE pillars that have a module — bonus
                      pillars (motion/fx/thumbnails) have no module, so the
                      MODULE_BY_SKILL guard hides the link for them. Visible
                      to everyone (editors most need it). */}
                  {onLearnSkill && MODULE_BY_SKILL[skillKey] && (
                    <button
                      type="button"
                      onClick={() => onLearnSkill(skillKey)}
                      title="Open the training module for this skill"
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        padding: 0, fontFamily: "var(--f-mono)", fontSize: 10,
                        color: "var(--c-violet)", textDecoration: "underline",
                        textUnderlineOffset: 2,
                      }}
                    >
                      📖 Learn this skill
                    </button>
                  )}
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 11,
                                 color: gradedCount ? "var(--c-green)" : "var(--fg-mute)" }}>
                    {gradedCount
                      ? `${gradedCount}/${visibleSubs.length} graded · +${skillXp} XP`
                      : "ungraded"}
                  </span>
                </span>
              </div>

              <div className="gf-rubric-cols">
                <span>Sub-skill</span>
                {RUBRIC_COLUMNS.map(c => <span key={c}>{c}</span>)}
              </div>

              {visibleSubs.map(sub => {
                const rowGrade = grades[sub.id] || null;   // this row's grade
                const rowGraded = !!rowGrade;
                return (
                  <div key={sub.id} className="gf-subskill">
                    <div>
                      <div className="gf-subskill-label">
                        {/* Owner-only hide checkbox — archives this row globally. */}
                        {isOwner && (
                          <input
                            type="checkbox"
                            className="gf-hide-check"
                            checked={false}
                            onChange={() => hideSubskill(skillKey, sub.id)}
                            title="Hide this sub-skill from all reels (restorable from Archive)"
                          />
                        )}
                        {sub.label}
                      </div>
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

                    {/* One cell per grade band: the band description (when descs
                        are on) sits above its clickable radio. Clicking either
                        the description or the radio grades that band; clicking
                        the active band again clears it.
                        active-only: show only the graded band's description, but
                        fall back to all three while still ungraded so the toggle
                        visibly differs from "off". */}
                    {GRADES.map((g, i) => {
                      const showThisDesc = showDescs && sub.grades && (
                        rubricDescMode === "all" || !rowGraded || rowGrade === g);
                      const setThis = () => {
                        if (!canGrade) return;
                        setGrade(skillKey, sub.id, rowGrade === g ? null : g);
                      };
                      return (
                        <div key={g}
                             className={`gf-grade-cell${rowGrade === g ? " active" : ""}${canGrade ? " gradeable" : ""}`}
                             title={canGrade ? `Grade ${sub.label}: ${RUBRIC_COLUMNS[i]}` : undefined}>
                          {showThisDesc && (
                            // Clicking the description grades (or clears) this band,
                            // same as clicking the radio below it.
                            <div className="gf-grade-cell-desc"
                                 onClick={canGrade ? setThis : undefined}>
                              {sub.grades[g]}
                            </div>
                          )}
                          <div className="gf-grade-radio">
                            <input
                              type="radio"
                              name={`${skillKey}-${sub.id}`}
                              checked={rowGrade === g}
                              disabled={!canGrade}
                              onClick={() => { if (rowGrade === g) setGrade(skillKey, sub.id, null); }}
                              onChange={() => setGrade(skillKey, sub.id, g)}
                              title={canGrade ? `Grade ${sub.label}: ${RUBRIC_COLUMNS[i]}` : "Reviewer grades this row"}
                            />
                          </div>
                        </div>
                      );
                    })}
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
