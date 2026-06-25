/* Training tab — editor course / playbook (pillar-module rebuild).

   A scrollable, course-style view of the SIX reel-editing pillar modules
   (src/lib/training-curriculum.jsx), keyed 1:1 onto the core gamify skill
   keys. Each module expands to the full rich syllabus (Why This Skill
   Matters, Definition, What Good Looks Like, Common Mistakes, Gold/Poor
   Standard examples + breakdowns, Editing Exercise, Self-Assessment,
   Checklist, Development Plan, Pro Tips, Next Skill).

   · Per-person progress (training_progress) is keyed by the 6 module ids
     (= skillKeys). `lessons_done` indices index into module.sections.checklist.
     A module auto-completes when every checklist item is checked. Editors
     tick their own; the owner previewing another editor is read-only (isSelf).
   · The owner can click ANY text node (prose + list items) to edit it inline;
     edits persist to Supabase (training_module_content) via the store and all
     editors see the update. Editors see read-only content. The checklist
     CHECKBOXES (progress) are independent of editing the checklist item TEXT.

   The `personId` prop is whose progress is shown — for an editor it's
   themselves; for the owner it follows the previewed perspective.
   The `focusModule` prop (a skillKey, passed by app.jsx) auto-expands and
   scrolls to that module on mount / when it changes. */

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase-client.js";
import { useAuth } from "../auth.jsx";
import { usePermissions } from "../lib/permissions.jsx";
import { useWorkflow } from "../store/store.jsx";
import {
  PILLAR_MODULES, MODULE_BY_SKILL, TOTAL_MODULES,
  LEVELS, levelForCount, youtubeId,
} from "../lib/training-curriculum.jsx";
import { EditableText } from "../components/EditableText.jsx";
import { RubricQuickRef } from "../components/RubricQuickRef.jsx";
import { Quiz } from "../components/training/Quiz.jsx";
import { QuizEditor } from "../components/training/QuizEditor.jsx";
import { FlashcardDeck } from "../components/training/FlashcardDeck.jsx";
import { ModuleChapters } from "../components/training/ModuleChapters.jsx";
import "./training.css";
import "../components/training/training-blocks.css";

const SOL_TRAINING_CSS = `
[data-theme="solarin"] .tr-wrap {
  max-width: 1280px; margin: 0 auto; padding: 28px 32px; box-sizing: border-box;
}
[data-theme="solarin"] .tr-level-banner {
  background: var(--s-panel); border: 1px solid var(--s-border);
  backdrop-filter: blur(4px); padding: 18px 24px; margin-bottom: 20px;
}
[data-theme="solarin"] .tr-level-name {
  font-family: var(--f-ui); font-size: 20px; font-weight: 700; color: var(--s-fg-soft);
}
[data-theme="solarin"] .tr-level-sub {
  font-family: var(--f-label); font-size: 11px; color: var(--s-fg-secondary);
  margin-top: 2px; letter-spacing: .04em;
}
[data-theme="solarin"] .tr-progress-bar-wrap {
  margin: 10px 0 6px; height: 4px; border-radius: 2px;
  background: rgba(255,255,255,.1); overflow: hidden;
}
[data-theme="solarin"] .tr-progress-fill {
  height: 100%; border-radius: 2px;
  background: linear-gradient(90deg, var(--teal), var(--mint));
}
[data-theme="solarin"] .tr-progress-hint {
  font-family: var(--f-label); font-size: 10px; color: var(--s-fg-secondary);
  letter-spacing: .04em;
}
[data-theme="solarin"] .tr-section-divider {
  font-family: var(--f-label); font-size: 10.5px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .12em; color: var(--mint);
  padding: 4px 0 10px; border-bottom: 1px solid var(--s-divider);
  margin-bottom: 12px;
}
[data-theme="solarin"] .tr-pillar-row {
  background: var(--s-card); border: 1px solid var(--s-border);
  border-left: 3px solid var(--s-fg-muted);
  backdrop-filter: blur(3px); padding: 14px 16px;
  display: flex; align-items: center; gap: 14px;
  margin-bottom: 6px; cursor: pointer; transition: border-color .15s;
}
[data-theme="solarin"] .tr-pillar-row:hover { border-left-color: var(--teal); }
[data-theme="solarin"] .tr-pillar-row.done  { border-left-color: var(--stage-completed); }
[data-theme="solarin"] .tr-pillar-row.active{ border-left-color: var(--peach); }
[data-theme="solarin"] .tr-pillar-icon {
  width: 36px; height: 36px; background: var(--teal); border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 16px; flex-shrink: 0;
}
[data-theme="solarin"] .tr-pillar-name {
  font-family: var(--f-ui); font-size: 14px; font-weight: 600; color: var(--s-fg-soft);
}
[data-theme="solarin"] .tr-pillar-sub {
  font-family: var(--f-ui); font-size: 12px; color: var(--s-fg-secondary); margin-top: 2px;
}
[data-theme="solarin"] .tr-pillar-status-done     { font-family: var(--f-label); font-size: 11px; color: var(--mint); }
[data-theme="solarin"] .tr-pillar-status-active   { font-family: var(--f-label); font-size: 11px; color: var(--peach); }
[data-theme="solarin"] .tr-pillar-status-notstart { font-family: var(--f-label); font-size: 11px; color: var(--s-fg-muted); }
`;

/* Standalone "Additional Modules" live in the SAME training_module_content
   JSON channel as the per-pillar overrides, under one synthetic module id +
   key. They don't tie into progress, EXP, the pillar rail or anything else —
   purely owner-authored extra reading. One blob: an array of
   { id, name, pages: [{ id, title, body }] }. Zero new tables (migration 0055). */
const CUSTOM_MODULE_ID = "__custom_sections__";
const CUSTOM_KEY = "index";
const rid = (prefix) => prefix + "_" + Math.random().toString(36).slice(2, 9);

export function Training({ onOpen, personId, focusModule, onFocusConsumed }) {
  const { person: me } = useAuth();
  const { can } = usePermissions();
  const { reels, moduleContent, actions } = useWorkflow();

  // Manual editing is gated by the "editManual" capability (Roles &
  // permissions). Owner is always allowed; editor roles default to read-only
  // and the owner grants edit per-person/per-role from the admin matrix.
  const canEdit = can("editManual");

  // Whose progress we show. Defaults to the signed-in person.
  const viewedId = personId || me?.id || null;
  const isSelf = viewedId === me?.id;

  // progress: { [moduleId]: { done: bool, lessons_done: number[] } }
  const [progress, setProgress] = useState({});
  // quizBest: { [moduleId]: { score, total } } — this person's best quiz score.
  const [quizBest, setQuizBest] = useState({});
  const quizBestRef = useRef({});
  useEffect(() => { quizBestRef.current = quizBest; }, [quizBest]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState({}); // expanded module ids (= skillKeys)

  /* Load this person's progress + quiz-attempt rows. Quiz attempts degrade
     gracefully to {} if migration 0078 hasn't been applied yet (the quiz UI
     still works; only the saved best-score badge is absent). */
  useEffect(() => {
    let cancelled = false;
    if (!viewedId) { setLoading(false); return; }
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("training_progress")
        .select("module_id, done, lessons_done")
        .eq("person_id", viewedId);
      if (cancelled) return;
      const map = {};
      for (const row of data || []) {
        map[row.module_id] = {
          done: !!row.done,
          lessons_done: Array.isArray(row.lessons_done) ? row.lessons_done : [],
        };
      }
      setProgress(map);

      const qMap = {};
      try {
        const { data: qa, error: qErr } = await supabase
          .from("training_quiz_attempts")
          .select("module_id, score, total")
          .eq("person_id", viewedId);
        if (qErr) throw qErr;
        for (const row of qa || []) {
          qMap[row.module_id] = { score: row.score, total: row.total };
        }
      } catch (e) {
        console.warn("training_quiz_attempts not available (run migration 0078?):", e?.message || e);
      }
      if (cancelled) return;
      setQuizBest(qMap);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [viewedId]);

  const modProgress = useCallback(
    (id) => progress[id] || { done: false, lessons_done: [] },
    [progress]
  );

  /* Persist one module's progress row (upsert on person_id+module_id).
     Optimistic. Only the person themselves may write — the owner
     previewing another person is read-only (RLS would reject anyway). */
  const saveModule = useCallback(async (moduleId, next) => {
    if (!isSelf || !viewedId) return;
    setProgress(prev => ({ ...prev, [moduleId]: next }));
    await supabase.from("training_progress").upsert(
      {
        person_id: viewedId,
        module_id: moduleId,
        done: next.done,
        lessons_done: next.lessons_done,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "person_id,module_id" }
    );
  }, [isSelf, viewedId]);

  /* Persist this person's BEST quiz score for a module (upsert on
     person_id+module_id). Best-score semantics: only writes when the new
     score fraction is at least the current best. Optimistic. Only the person
     themselves may write (RLS rejects otherwise); the owner previewing another
     editor is read-only. Degrades silently if migration 0078 hasn't run. */
  const saveQuizAttempt = useCallback(async (moduleId, score, total, answers) => {
    if (!isSelf || !viewedId || !total) return;
    const cur = quizBestRef.current[moduleId];
    const better = !cur || (score / total) >= (cur.score / cur.total);
    if (!better) return;
    setQuizBest(prev => ({ ...prev, [moduleId]: { score, total } }));
    const { error } = await supabase.from("training_quiz_attempts").upsert(
      {
        person_id: viewedId,
        module_id: moduleId,
        score,
        total,
        answers,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "person_id,module_id" }
    );
    if (error) console.warn("saveQuizAttempt failed:", error.message || error);
  }, [isSelf, viewedId]);

  /* Resolve / write a STRUCTURED block (quiz, flashcards) stored as JSON under
     a synthetic field_path "<key>::data" in training_module_content — the same
     override channel as prose fields (resolveField) and embeds (::embed). Owner
     override (parsed JSON) wins, else the code default array from the module. */
  const BLOCK_SUFFIX = "::data";
  const resolveBlock = useCallback((moduleId, key, fallback) => {
    const raw = moduleContent?.[moduleId]?.[key + BLOCK_SUFFIX];
    if (raw == null) return fallback || [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : (fallback || []);
    } catch { return fallback || []; }
  }, [moduleContent]);
  const setBlock = useCallback((moduleId, key, arr) => {
    actions.setModuleContent(moduleId, key + BLOCK_SUFFIX, JSON.stringify(arr));
  }, [actions]);
  const resetBlock = useCallback((moduleId, key) => {
    actions.resetModuleContent(moduleId, key + BLOCK_SUFFIX);
  }, [actions]);

  // checklist length per module (the trackable lesson list).
  const checklistLen = (mod) => (mod.sections.checklist || []).length;

  const toggleLesson = (mod, idx) => {
    const cur = modProgress(mod.id);
    const set = new Set(cur.lessons_done);
    if (set.has(idx)) set.delete(idx); else set.add(idx);
    const lessons_done = [...set].sort((a, b) => a - b);
    // Auto-complete the module when every checklist item is checked.
    const len = checklistLen(mod);
    const done = (len > 0 && lessons_done.length === len) || cur.done;
    saveModule(mod.id, { done, lessons_done });
  };

  const toggleDone = (mod) => {
    const cur = modProgress(mod.id);
    const done = !cur.done;
    const len = checklistLen(mod);
    const lessons_done = done ? Array.from({ length: len }, (_, i) => i) : cur.lessons_done;
    saveModule(mod.id, { done, lessons_done });
  };

  /* ── EXP math: 1 point per completed module, plus partial credit for
     checked checklist items in not-yet-done modules. ─────────────── */
  const { completedCount, expPct } = useMemo(() => {
    let completed = 0;
    let fractional = 0;
    for (const m of PILLAR_MODULES) {
      const p = modProgress(m.id);
      const len = checklistLen(m);
      if (p.done) { completed += 1; }
      else if (len) {
        fractional += Math.min(1, p.lessons_done.length / len);
      }
    }
    const pct = Math.min(100, ((completed + fractional) / TOTAL_MODULES) * 100);
    return { completedCount: completed, expPct: pct };
  }, [modProgress]);

  const { current: level, next: nextLevel } = levelForCount(completedCount);

  /* Reels tagged with a given module's skillKey (practice on real
     projects). Keyed directly by skillKey now. */
  const reelsBySkill = useMemo(() => {
    const map = {};
    for (const r of reels) {
      if (r.archivedAt) continue;
      for (const tag of (r.skill_tags || [])) {
        (map[tag] ||= []).push(r);
      }
    }
    return map;
  }, [reels]);

  /* Resolve a field's display value: owner override (moduleContent) wins,
     else the code default from PILLAR_MODULES. fieldPath is either a prose
     key ("whyMatters") or a list item ("commonMistakes.2"). */
  const resolveField = useCallback((moduleId, fieldPath, fallback) => {
    const v = moduleContent?.[moduleId]?.[fieldPath];
    return v !== undefined && v !== null ? v : (fallback ?? "");
  }, [moduleContent]);

  /* Persisted YouTube-embed state. Which links the owner has expanded into
     an inline player is stored as a sibling module-content field, keyed by
     the prose field's path + EMBED_SUFFIX (a JSON array of URLs). It rides
     the same training_module_content store/RLS as the text, so the choice
     survives a click-away and shows for every editor. The suffixed key is
     never rendered as prose (resolveField is only called for real fields). */
  const EMBED_SUFFIX = "::embed";

  const embedUrlsFor = useCallback((moduleId, fieldPath) => {
    const raw = moduleContent?.[moduleId]?.[fieldPath + EMBED_SUFFIX];
    if (!raw) return new Set();
    try {
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  }, [moduleContent]);

  const toggleEmbed = useCallback((moduleId, fieldPath, url, next) => {
    const set = embedUrlsFor(moduleId, fieldPath);
    if (next) set.add(url); else set.delete(url);
    actions.setModuleContent(moduleId, fieldPath + EMBED_SUFFIX, JSON.stringify([...set]));
  }, [embedUrlsFor, actions]);

  const jumpTo = (id) => {
    setOpen(prev => ({ ...prev, [id]: true }));
    requestAnimationFrame(() => {
      document.getElementById("tr-mod-" + id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  /* Honor an incoming focusModule (skillKey) from the integration layer:
     auto-expand + scroll once it matches a real module. */
  useEffect(() => {
    if (!focusModule || loading) return;
    if (!MODULE_BY_SKILL[focusModule]) return;
    jumpTo(focusModule);
    // Tell the integration layer we consumed it so it can clear the state;
    // re-clicking the same pillar then sets focusModule afresh and re-fires.
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusModule, loading]);

  if (loading) return <div style={{ padding: 32, color: "var(--fg-dim)" }}>Loading training…</div>;

  return (
    <div className="tr-wrap">
      <style>{SOL_TRAINING_CSS}</style>
      <div className="page-head">
        <div className="titles">
          <h1>Training</h1>
          <div className="sub">
            Editor playbook — six core pillars of reel editing. Work through each module,
            check off the items, and level up toward Reel Pro.
          </div>
        </div>
      </div>

      {!isSelf && (
        <div className="tr-perspective">
          Viewing {me?.role === "owner" ? "another editor's" : "a"} progress (read-only).
        </div>
      )}

      {/* Sticky EXP / level header */}
      <div className="tr-exp">
        <div className="tr-exp-card tr-level-banner">
          <div className="tr-exp-top">
            <div>
              <div className="tr-level tr-level-name">{level.label}</div>
              <div className="tr-level-blurb tr-level-sub">{level.blurb}</div>
            </div>
            <div className="tr-count">
              <b>{completedCount}</b> / {TOTAL_MODULES} pillars complete
            </div>
          </div>
          <div className="tr-bar tr-progress-bar-wrap">
            <div className="tr-bar-fill tr-progress-fill" style={{ width: expPct.toFixed(1) + "%" }} />
          </div>
          <div className="tr-next tr-progress-hint">
            {nextLevel
              ? `${(nextLevel.min - completedCount)} more pillar${nextLevel.min - completedCount === 1 ? "" : "s"} → ${nextLevel.label}`
              : "Max level reached — you're Reel Pro 🎬"}
          </div>
          {/* Jump rail */}
          <div className="tr-rail">
            {PILLAR_MODULES.map(m => {
              const done = modProgress(m.id).done;
              return (
                <button
                  key={m.id}
                  className={"tr-chip" + (done ? " is-done" : "")}
                  onClick={() => jumpTo(m.id)}
                  title={m.title}
                >
                  <span className="tr-chip-dot">{done ? "●" : "○"}</span> {m.icon} {m.title}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Core pillars */}
      <section className="tr-month" id="tr-section-core">
        <div className="tr-month-head tr-section-divider">
          <span className="tr-month-title">Core Pillars</span>
          <span className="tr-month-hint">The six skills every reel is graded on</span>
        </div>

        {PILLAR_MODULES.map(mod => (
          <ModuleCard
            key={mod.id}
            mod={mod}
            progress={modProgress(mod.id)}
            expanded={!!open[mod.id]}
            onToggleExpand={() => setOpen(p => ({ ...p, [mod.id]: !p[mod.id] }))}
            onToggleLesson={(idx) => toggleLesson(mod, idx)}
            onToggleDone={() => toggleDone(mod)}
            readOnly={!isSelf}
            canEdit={canEdit}
            resolveField={resolveField}
            onCommit={(fieldPath, value) => actions.setModuleContent(mod.id, fieldPath, value)}
            embedUrlsFor={(fieldPath) => embedUrlsFor(mod.id, fieldPath)}
            onToggleEmbed={(fieldPath, url, next) => toggleEmbed(mod.id, fieldPath, url, next)}
            quiz={resolveBlock(mod.id, "quiz", mod.sections.quiz)}
            quizBest={quizBest[mod.id] || null}
            onQuizAttempt={(score, total, answers) => saveQuizAttempt(mod.id, score, total, answers)}
            onSaveQuiz={(arr) => setBlock(mod.id, "quiz", arr)}
            onResetQuiz={() => resetBlock(mod.id, "quiz")}
            flashcards={resolveBlock(mod.id, "flashcards", mod.sections.flashcards)}
            onSaveFlashcards={(arr) => setBlock(mod.id, "flashcards", arr)}
            onResetFlashcards={() => resetBlock(mod.id, "flashcards")}
            practiceReels={reelsBySkill[mod.skillKey] || []}
            onOpenReel={onOpen}
            onJumpToModule={jumpTo}
          />
        ))}
      </section>

      {/* Collapsible rubric reference (replaces the old flat RUBRIC table) */}
      <RubricQuickRef onJumpToModule={jumpTo} />

      {/* Owner-authored standalone modules — independent of the six pillars */}
      <CustomSections
        sections={resolveBlock(CUSTOM_MODULE_ID, CUSTOM_KEY, [])}
        canEdit={canEdit}
        onSave={(next) => setBlock(CUSTOM_MODULE_ID, CUSTOM_KEY, next)}
      />
    </div>
  );
}

/* ── Additional standalone modules ─────────────────────────────────
   Owner creates extra training sections that DON'T connect to the rest of
   the app (no progress, EXP, quizzes or pillar wiring). Each section has a
   name and a list of manually-authored pages (title + rich body). The whole
   list is one JSON blob persisted via the training_module_content channel;
   the owner edits inline, everyone else sees it read-only. */
function CustomSections({ sections, canEdit, onSave }) {
  const [open, setOpen] = useState({});
  const list = Array.isArray(sections) ? sections : [];

  // Nothing authored yet and the viewer can't edit → render nothing.
  if (list.length === 0 && !canEdit) return null;

  const addSection = () => {
    const sec = { id: rid("sec"), name: "New section", pages: [] };
    onSave([...list, sec]);
    setOpen(p => ({ ...p, [sec.id]: true }));
  };
  const renameSection = (id, name) =>
    onSave(list.map(s => s.id === id ? { ...s, name } : s));
  const deleteSection = (id) => {
    if (!window.confirm("Delete this section and all its pages?")) return;
    onSave(list.filter(s => s.id !== id));
  };
  const moveSection = (id, dir) => {
    const i = list.findIndex(s => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onSave(next);
  };

  const mapPages = (sid, fn) =>
    onSave(list.map(s => s.id === sid ? { ...s, pages: fn(s.pages || []) } : s));
  const addPage = (sid) =>
    mapPages(sid, pages => [...pages, { id: rid("pg"), title: "New page", body: "" }]);
  const editPage = (sid, pid, patch) =>
    mapPages(sid, pages => pages.map(p => p.id === pid ? { ...p, ...patch } : p));
  const deletePage = (sid, pid) => {
    if (!window.confirm("Delete this page?")) return;
    mapPages(sid, pages => pages.filter(p => p.id !== pid));
  };
  const movePage = (sid, pid, dir) =>
    mapPages(sid, pages => {
      const i = pages.findIndex(p => p.id === pid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= pages.length) return pages;
      const next = [...pages];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <section className="tr-month" id="tr-section-custom">
      <div className="tr-month-head tr-section-divider">
        <span className="tr-month-title">Additional Modules</span>
        <span className="tr-month-hint">Standalone training sections — not tied to the six pillars</span>
      </div>

      {list.length === 0 && canEdit && (
        <div className="tr-reels-empty" style={{ marginBottom: 12 }}>
          No extra sections yet. Add one below, name it, and fill it with pages.
        </div>
      )}

      {list.map((sec, si) => {
        const expanded = !!open[sec.id];
        const pages = sec.pages || [];
        return (
          <div className="tr-mod" key={sec.id} id={"tr-custom-" + sec.id}>
            <div
              className="tr-mod-head"
              onClick={() => setOpen(p => ({ ...p, [sec.id]: !p[sec.id] }))}
            >
              <span className="tr-mod-title">
                <span className="tr-mod-icon">📦</span>{" "}
                {canEdit ? (
                  <span onClick={(e) => e.stopPropagation()}>
                    <EditableText
                      value={sec.name}
                      canEdit
                      placeholder="Section name"
                      onCommit={(v) => renameSection(sec.id, v || "Untitled section")}
                    />
                  </span>
                ) : (sec.name || "Untitled section")}
              </span>
              <span className="tr-mod-deliv">{pages.length} page{pages.length === 1 ? "" : "s"}</span>
              {canEdit && (
                <span className="tr-custom-ctrl" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="tb-mini-btn" disabled={si === 0}
                    onClick={() => moveSection(sec.id, -1)} title="Move section up">↑</button>
                  <button type="button" className="tb-mini-btn" disabled={si === list.length - 1}
                    onClick={() => moveSection(sec.id, 1)} title="Move section down">↓</button>
                  <button type="button" className="tb-mini-btn is-danger"
                    onClick={() => deleteSection(sec.id)} title="Delete section">✕</button>
                </span>
              )}
              <span className="tr-caret">{expanded ? "▾" : "▸"}</span>
            </div>

            {expanded && (
              <div className="tr-mod-body">
                {pages.length === 0 && !canEdit && (
                  <span className="tr-reels-empty">No pages in this section yet.</span>
                )}
                {pages.map((pg, pi) => (
                  <div className="tr-custom-page" key={pg.id}>
                    <div className="tr-block-label tb-label-row">
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {canEdit ? (
                          <EditableText
                            value={pg.title}
                            canEdit
                            placeholder="Page title"
                            onCommit={(v) => editPage(sec.id, pg.id, { title: v || "Untitled page" })}
                          />
                        ) : (pg.title || "Untitled page")}
                      </span>
                      {canEdit && (
                        <span className="tr-custom-ctrl">
                          <button type="button" className="tb-mini-btn" disabled={pi === 0}
                            onClick={() => movePage(sec.id, pg.id, -1)} title="Move page up">↑</button>
                          <button type="button" className="tb-mini-btn" disabled={pi === pages.length - 1}
                            onClick={() => movePage(sec.id, pg.id, 1)} title="Move page down">↓</button>
                          <button type="button" className="tb-mini-btn is-danger"
                            onClick={() => deletePage(sec.id, pg.id)} title="Delete page">✕</button>
                        </span>
                      )}
                    </div>
                    <div className="tr-prose">
                      <EditableText
                        value={pg.body}
                        canEdit={canEdit}
                        multiline
                        linkify
                        placeholder={canEdit ? "Click to add page content…" : ""}
                        onCommit={(v) => editPage(sec.id, pg.id, { body: v })}
                      />
                    </div>
                  </div>
                ))}
                {canEdit && (
                  <button type="button" className="tr-custom-add" onClick={() => addPage(sec.id)}>
                    + Add page
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {canEdit && (
        <button type="button" className="tr-custom-add tr-custom-add-section" onClick={addSection}>
          + Add section
        </button>
      )}
    </section>
  );
}

/* ── Completion ring (SVG) ─────────────────────────────────────── */
function Ring({ pct }) {
  const r = 13, c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  return (
    <svg className="tr-ring" viewBox="0 0 34 34">
      <circle cx="17" cy="17" r={r} fill="none" stroke="#0d1525" strokeWidth="3.5" />
      <circle
        cx="17" cy="17" r={r} fill="none"
        stroke={pct >= 100 ? "var(--c-green)" : "var(--c-violet)"}
        strokeWidth="3.5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off}
        transform="rotate(-90 17 17)"
      />
      <text x="17" y="20.5" textAnchor="middle">{Math.round(pct)}</text>
    </svg>
  );
}

/* A labeled rich-prose block. Wraps the value in EditableText.
   In read-only mode, URLs in the text are rendered as clickable links;
   YouTube URLs get an optional inline embed toggle (via `linkify`). */
function ProseBlock({ label, fieldPath, value, canEdit, onCommit, className, getEmbedProps }) {
  return (
    <>
      <div className="tr-block-label">{label}</div>
      <div className={"tr-prose " + (className || "")}>
        <EditableText
          value={value}
          canEdit={canEdit}
          multiline
          linkify
          onCommit={(v) => onCommit(fieldPath, v)}
          {...(getEmbedProps?.(fieldPath) || {})}
        />
      </div>
    </>
  );
}

/* A labeled editable list (each item is its own EditableText, fieldPath
   = "<base>.<index>"). */
function ListBlock({ label, base, items, canEdit, onCommit, resolveField, moduleId, liClass, getEmbedProps }) {
  if (!items || items.length === 0) return null;
  return (
    <>
      <div className="tr-block-label">{label}</div>
      <ul className="tr-list">
        {items.map((it, i) => (
          <li key={i} className={liClass}>
            <EditableText
              value={resolveField(moduleId, base + "." + i, it)}
              canEdit={canEdit}
              multiline
              linkify
              onCommit={(v) => onCommit(base + "." + i, v)}
              {...(getEmbedProps?.(base + "." + i) || {})}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

/* ── Module card ───────────────────────────────────────────────── */
function ModuleCard({
  mod, progress, expanded, onToggleExpand,
  onToggleLesson, onToggleDone, readOnly, canEdit,
  resolveField, onCommit, embedUrlsFor, onToggleEmbed,
  quiz, quizBest, onQuizAttempt, onSaveQuiz, onResetQuiz,
  flashcards, onSaveFlashcards, onResetFlashcards,
  practiceReels, onOpenReel, onJumpToModule,
}) {
  const s = mod.sections;
  const [editingQuiz, setEditingQuiz] = useState(false);
  const hasQuiz = Array.isArray(quiz) && quiz.length > 0;

  /* Per-field props that wire EditableText's linkify embeds to persisted
     module content. Only the owner (canEdit) gets a persist callback; for
     read-only editors the embedded set still seeds which players show. */
  const getEmbedProps = (fieldPath) => ({
    embeddedUrls: embedUrlsFor(fieldPath),
    onToggleEmbed: canEdit ? (url, next) => onToggleEmbed(fieldPath, url, next) : undefined,
  });
  const checked = new Set(progress.lessons_done);
  const checklist = s.checklist || [];
  const pct = progress.done
    ? 100
    : checklist.length
      ? (checked.size / checklist.length) * 100
      : 0;

  const rf = (path, fallback) => resolveField(mod.id, path, fallback);
  const nextMod = mod.nextSkill ? MODULE_BY_SKILL[mod.nextSkill] : null;

  /* The module's sections, grouped into ~5 digestible chapters for the
     in-module slide carousel (ModuleChapters). Same blocks as before — only
     the presentation changes; progress/quiz/flashcard state is untouched. */
  const goldBlock = (s.goldExamples?.length || s.goldBreakdown?.length) ? (
    <>
      <div className="tr-block-label">Gold standard examples</div>
      <div className="tr-example is-gold">
        <span className="tr-example-tag">Examples</span>
        <ul className="tr-list">
          {(s.goldExamples || []).map((it, i) => (
            <li key={i}>
              <EditableText value={rf("goldExamples." + i, it)} canEdit={canEdit}
                multiline linkify onCommit={(v) => onCommit("goldExamples." + i, v)}
                {...getEmbedProps("goldExamples." + i)} />
            </li>
          ))}
        </ul>
        {s.goldBreakdown?.length > 0 && (
          <>
            <span className="tr-example-tag" style={{ marginTop: 8 }}>Why it works</span>
            <ul className="tr-list">
              {s.goldBreakdown.map((it, i) => (
                <li key={i}>
                  <EditableText value={rf("goldBreakdown." + i, it)} canEdit={canEdit}
                    multiline linkify onCommit={(v) => onCommit("goldBreakdown." + i, v)}
                    {...getEmbedProps("goldBreakdown." + i)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  ) : null;

  const poorBlock = (s.poorExamples?.length || s.poorBreakdown?.length) ? (
    <>
      <div className="tr-block-label">Poor standard examples</div>
      <div className="tr-example is-poor">
        <span className="tr-example-tag">Examples</span>
        <ul className="tr-list">
          {(s.poorExamples || []).map((it, i) => (
            <li key={i}>
              <EditableText value={rf("poorExamples." + i, it)} canEdit={canEdit}
                multiline linkify onCommit={(v) => onCommit("poorExamples." + i, v)}
                {...getEmbedProps("poorExamples." + i)} />
            </li>
          ))}
        </ul>
        {s.poorBreakdown?.length > 0 && (
          <>
            <span className="tr-example-tag" style={{ marginTop: 8 }}>Why it falls short</span>
            <ul className="tr-list">
              {s.poorBreakdown.map((it, i) => (
                <li key={i}>
                  <EditableText value={rf("poorBreakdown." + i, it)} canEdit={canEdit}
                    multiline linkify onCommit={(v) => onCommit("poorBreakdown." + i, v)}
                    {...getEmbedProps("poorBreakdown." + i)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  ) : null;

  const quizBlock = (hasQuiz || canEdit) ? (
    <>
      <div className="tr-block-label tb-label-row">
        <span>Self-check quiz</span>
        {canEdit && (
          <button type="button" className="tb-mini-btn" onClick={() => setEditingQuiz(e => !e)}>
            {editingQuiz ? "Done editing" : "Edit quiz"}
          </button>
        )}
      </div>
      {editingQuiz ? (
        <QuizEditor quiz={quiz} onSave={onSaveQuiz} onReset={onResetQuiz} onClose={() => setEditingQuiz(false)} />
      ) : hasQuiz ? (
        <Quiz quiz={quiz} best={quizBest} readOnly={readOnly} onAttempt={onQuizAttempt} />
      ) : (
        <span className="tr-reels-empty">No quiz yet. Use “Edit quiz” to add questions.</span>
      )}
    </>
  ) : (
    <ListBlock label="Self-assessment — ask yourself" base="selfAssessment"
      items={s.selfAssessment} canEdit={canEdit} onCommit={onCommit}
      resolveField={resolveField} moduleId={mod.id} getEmbedProps={getEmbedProps} />
  );

  const tutorialsBlock = mod.videos?.length > 0 ? (
    <>
      <div className="tr-block-label">Tutorials</div>
      <div className="tr-videos">
        {mod.videos.map((v, i) => {
          const yt = v.kind === "youtube" ? youtubeId(v.url) : null;
          if (yt) {
            return (
              <div key={i} className="tr-embed">
                <iframe
                  src={"https://www.youtube.com/embed/" + yt}
                  title={v.label || "Tutorial"}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            );
          }
          return (
            <a key={i} className="tr-vid-link" href={v.url} target="_blank" rel="noopener noreferrer">
              ▶ {v.label || (v.kind === "ig" ? "Watch on Instagram" : "Watch tutorial")}
            </a>
          );
        })}
      </div>
    </>
  ) : null;

  const chapters = [
    {
      key: "learn", label: "Learn", icon: "📖",
      node: (
        <>
          <ProseBlock label="Why this skill matters" fieldPath="whyMatters"
            value={rf("whyMatters", s.whyMatters)} canEdit={canEdit} onCommit={onCommit}
            getEmbedProps={getEmbedProps} />
          <ProseBlock label="Skill definition" fieldPath="definition"
            value={rf("definition", s.definition)} canEdit={canEdit} onCommit={onCommit}
            getEmbedProps={getEmbedProps} />
          <ProseBlock label="What good looks like" fieldPath="goodLooks"
            value={rf("goodLooks", s.goodLooks)} canEdit={canEdit} onCommit={onCommit}
            getEmbedProps={getEmbedProps} />
        </>
      ),
    },
    {
      key: "standards", label: "Standards", icon: "⭐",
      node: (
        <>
          <ListBlock label="Common mistakes" base="commonMistakes"
            items={s.commonMistakes} canEdit={canEdit} onCommit={onCommit}
            resolveField={resolveField} moduleId={mod.id} getEmbedProps={getEmbedProps} />
          {goldBlock}
          {poorBlock}
        </>
      ),
    },
    {
      key: "practice", label: "Practice", icon: "🎬",
      node: (
        <>
          <div className="tr-block-label">Editing exercise</div>
          <div className="tr-callout">
            <span className="tr-callout-tag">Exercise</span>
            <EditableText value={rf("exercise", s.exercise)} canEdit={canEdit}
              multiline linkify onCommit={(v) => onCommit("exercise", v)}
              {...getEmbedProps("exercise")} />
          </div>
          {tutorialsBlock}
          <div className="tr-block-label">Practice on real projects</div>
          {practiceReels.length === 0 ? (
            <span className="tr-reels-empty">
              No reels tagged for this skill yet. Tag a reel with “{mod.title}” from its detail page.
            </span>
          ) : (
            <div className="tr-reels">
              {practiceReels.map(r => (
                <button key={r.id} className="tr-reel-link" onClick={() => onOpenReel?.(r)}>
                  <span className="tr-reel-num">{r.displayNumber ? "#" + r.displayNumber : r.id}</span>
                  <span className="tr-reel-title">{r.title || "(untitled)"}</span>
                </button>
              ))}
            </div>
          )}
        </>
      ),
    },
    {
      key: "recall", label: "Recall", icon: "🧠",
      node: (
        <>
          <FlashcardDeck cards={flashcards} canEdit={canEdit}
            onSave={onSaveFlashcards} onReset={onResetFlashcards} />
          {quizBlock}
        </>
      ),
    },
    {
      key: "track", label: "Track", icon: "✅",
      node: (
        <>
          <div className="tr-block-label">Checklist</div>
          {checklist.map((item, i) => (
            <div key={i} className={"tr-lesson" + (checked.has(i) ? " is-checked" : "")}>
              <input
                type="checkbox"
                checked={checked.has(i)}
                disabled={readOnly}
                onChange={() => onToggleLesson(i)}
              />
              <span>
                <EditableText
                  value={rf("checklist." + i, item)}
                  canEdit={canEdit}
                  multiline
                  linkify
                  onCommit={(v) => onCommit("checklist." + i, v)}
                  {...getEmbedProps("checklist." + i)}
                />
              </span>
            </div>
          ))}
          <ListBlock label="Development plan" base="developmentPlan"
            items={s.developmentPlan} canEdit={canEdit} onCommit={onCommit}
            resolveField={resolveField} moduleId={mod.id} getEmbedProps={getEmbedProps} />
          {s.proTips?.length > 0 && (
            <>
              <div className="tr-block-label">Pro tips</div>
              <div className="tr-callout tr-protip">
                <span className="tr-callout-tag">Pro tips</span>
                <ul className="tr-list">
                  {s.proTips.map((it, i) => (
                    <li key={i}>
                      <EditableText value={rf("proTips." + i, it)} canEdit={canEdit}
                        multiline linkify onCommit={(v) => onCommit("proTips." + i, v)}
                        {...getEmbedProps("proTips." + i)} />
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
          {!readOnly && (
            <div style={{ marginTop: 16 }}>
              <button
                onClick={onToggleDone}
                style={{
                  fontFamily: "var(--f-mono)", fontSize: 12.5,
                  padding: "7px 14px", borderRadius: 6, cursor: "pointer",
                  background: progress.done ? "var(--bg-3)" : "rgba(127,212,154,0.12)",
                  border: "1px solid " + (progress.done ? "var(--line-hard)" : "var(--c-green-soft)"),
                  color: progress.done ? "var(--fg-mute)" : "var(--c-green)",
                }}
              >
                {progress.done ? "↩ Mark not done" : "✓ Mark pillar complete"}
              </button>
            </div>
          )}
          {nextMod && (
            <div className="tr-nextskill">
              Next skill → <b>{nextMod.icon} {nextMod.title}</b>{" "}
              <button
                type="button"
                className="tr-quickref-jump"
                onClick={() => onJumpToModule?.(nextMod.skillKey)}
                style={{ marginLeft: 8 }}
              >
                open module
              </button>
            </div>
          )}
        </>
      ),
    },
  ];

  return (
    <div
      className={"tr-mod" + (progress.done ? " is-done" : "")}
      id={"tr-mod-" + mod.skillKey}
    >
      <div
        className={"tr-mod-head tr-pillar-row" + (progress.done ? " done" : expanded ? " active" : "")}
        onClick={onToggleExpand}
      >
        <span className="tr-mod-title">
          <span className="tr-mod-icon tr-pillar-icon">{mod.icon}</span>
          {mod.title}
        </span>
        <span className="tr-mod-deliv">{mod.deliverables}</span>
        {quizBest && quizBest.total > 0 && (
          <span
            className={"tb-score-badge" + (quizBest.score === quizBest.total ? " is-pass" : "")}
            title="Best quiz score"
          >
            Quiz {quizBest.score}/{quizBest.total}
          </span>
        )}
        <Ring pct={pct} />
        <span className="tr-caret">{expanded ? "▾" : "▸"}</span>
      </div>

      {expanded && (
        <div className="tr-mod-body">
          <ModuleChapters chapters={chapters} />
        </div>
      )}
    </div>
  );
}
