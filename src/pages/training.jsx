/* Training tab — editor course / playbook.

   A scrollable, course-style view of the 3-month CapCut editing syllabus
   (src/lib/training-data.jsx). Editors check off lessons and mark modules
   done; progress + EXP/level are stored per-person in Supabase
   (training_progress) so they sync across devices and the owner can see
   each editor's progress via the topbar perspective switcher.

   The `personId` prop is the person whose progress is shown — for an
   editor it's themselves; for the owner it follows whichever perspective
   they're previewing (passed from app.jsx as shownPerson?.id). Progress
   reads/writes go straight to Supabase, mirroring resources.jsx. */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase-client.js";
import { useAuth } from "../auth.jsx";
import { useWorkflow } from "../store/store.jsx";
import {
  MODULES, MONTHS, CHECKPOINTS, RUBRIC, LEVELS,
  TOTAL_MODULES, levelForCount, youtubeId, MODULE_TO_GAMIFY_SKILL,
} from "../lib/training-data.jsx";
import "./training.css";

export function Training({ onOpen, personId }) {
  const { person: me } = useAuth();
  const { reels } = useWorkflow();

  // Whose progress we show. Defaults to the signed-in person.
  const viewedId = personId || me?.id || null;
  const isSelf = viewedId === me?.id;

  // progress: { [moduleId]: { done: bool, lessons_done: number[] } }
  const [progress, setProgress] = useState({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState({}); // expanded module ids

  /* Load this person's progress rows. */
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
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [viewedId]);

  const modProgress = useCallback(
    (id) => progress[id] || { done: false, lessons_done: [] },
    [progress]
  );

  /* Persist one module's progress row (upsert on person_id+module_id).
     Optimistic: state updates immediately, DB write trails. Only the
     person themselves may write — the owner previewing another person
     is read-only (RLS would reject the write anyway). */
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

  const toggleLesson = (mod, idx) => {
    const cur = modProgress(mod.id);
    const set = new Set(cur.lessons_done);
    if (set.has(idx)) set.delete(idx); else set.add(idx);
    const lessons_done = [...set].sort((a, b) => a - b);
    // Auto-complete the module when every lesson is checked.
    const done = lessons_done.length === mod.lessons.length || cur.done;
    saveModule(mod.id, { done, lessons_done });
  };

  const toggleDone = (mod) => {
    const cur = modProgress(mod.id);
    const done = !cur.done;
    // Marking done checks all lessons; un-checking leaves lessons as-is.
    const lessons_done = done ? mod.lessons.map((_, i) => i) : cur.lessons_done;
    saveModule(mod.id, { done, lessons_done });
  };

  /* ── EXP math: 1 point per completed module, plus partial credit for
     checked lessons in not-yet-done modules. ─────────────────────── */
  const { completedCount, expPct } = useMemo(() => {
    let completed = 0;
    let fractional = 0;
    for (const m of MODULES) {
      const p = modProgress(m.id);
      if (p.done) { completed += 1; }
      else if (m.lessons.length) {
        fractional += p.lessons_done.length / m.lessons.length;
      }
    }
    const pct = Math.min(100, ((completed + fractional) / TOTAL_MODULES) * 100);
    return { completedCount: completed, expPct: pct };
  }, [modProgress]);

  const { current: level, next: nextLevel } = levelForCount(completedCount);

  /* Reels tagged with a given module's skill (for "practice on real
     projects"). Built once per reels change. */
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

  const jumpTo = (id) => {
    setOpen(prev => ({ ...prev, [id]: true }));
    requestAnimationFrame(() => {
      document.getElementById("tr-mod-" + id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  if (loading) return <div style={{ padding: 32, color: "var(--fg-dim)" }}>Loading training…</div>;

  return (
    <div className="tr-wrap">
      <div className="page-head">
        <div className="titles">
          <h1>Training</h1>
          <div className="sub">
            Editor playbook — work through the modules, watch the tutorials, and check off
            lessons to level up toward complex long-form editing.
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
        <div className="tr-exp-card">
          <div className="tr-exp-top">
            <div>
              <div className="tr-level">{level.label}</div>
              <div className="tr-level-blurb">{level.blurb}</div>
            </div>
            <div className="tr-count">
              <b>{completedCount}</b> / {TOTAL_MODULES} modules complete
            </div>
          </div>
          <div className="tr-bar">
            <div className="tr-bar-fill" style={{ width: expPct.toFixed(1) + "%" }} />
          </div>
          <div className="tr-next">
            {nextLevel
              ? `${(nextLevel.min - completedCount)} more module${nextLevel.min - completedCount === 1 ? "" : "s"} → ${nextLevel.label}`
              : "Max level reached — you're long-form ready 🎬"}
          </div>
          {/* Jump rail */}
          <div className="tr-rail">
            {MODULES.map(m => {
              const done = modProgress(m.id).done;
              return (
                <button
                  key={m.id}
                  className={"tr-chip" + (done ? " is-done" : "")}
                  onClick={() => jumpTo(m.id)}
                  title={m.title}
                >
                  <span className="tr-chip-dot">{done ? "●" : "○"}</span> W{m.week}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Month sections */}
      {MONTHS.map(mo => {
        const mods = MODULES.filter(m => m.month === mo.month);
        const checkpoint = CHECKPOINTS[mo.month];
        return (
          <section key={mo.month} className="tr-month" id={"tr-month-" + mo.month}>
            <div className="tr-month-head">
              <span className="tr-month-title">{mo.label}</span>
              <span className="tr-month-hint">{mo.hint}</span>
            </div>

            {mods.map(mod => (
              <ModuleCard
                key={mod.id}
                mod={mod}
                progress={modProgress(mod.id)}
                expanded={!!open[mod.id]}
                onToggleExpand={() => setOpen(p => ({ ...p, [mod.id]: !p[mod.id] }))}
                onToggleLesson={(idx) => toggleLesson(mod, idx)}
                onToggleDone={() => toggleDone(mod)}
                readOnly={!isSelf}
                practiceReels={reelsBySkill[MODULE_TO_GAMIFY_SKILL[mod.id]] || []}
                onOpenReel={onOpen}
              />
            ))}

            {checkpoint && (
              <div className="tr-checkpoint">
                <div className="tr-checkpoint-title">{checkpoint.title}</div>
                <div className="tr-checkpoint-body">{checkpoint.body}</div>
              </div>
            )}
          </section>
        );
      })}

      {/* Rubric */}
      <section className="tr-rubric">
        <div className="tr-month-head">
          <span className="tr-month-title">Assessment Rubric</span>
          <span className="tr-month-hint">Score each milestone 0–5 · target ≥4.0 average for long-form work</span>
        </div>
        <div className="tr-rubric-scroll">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>0–1 Beginner</th>
                <th>2–3 Intermediate</th>
                <th>4–5 Advanced</th>
              </tr>
            </thead>
            <tbody>
              {RUBRIC.map(row => (
                <tr key={row.category}>
                  <td>{row.category}</td>
                  <td>{row.beginner}</td>
                  <td>{row.intermediate}</td>
                  <td>{row.advanced}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
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

/* ── Module card ───────────────────────────────────────────────── */
function ModuleCard({
  mod, progress, expanded, onToggleExpand,
  onToggleLesson, onToggleDone, readOnly, practiceReels, onOpenReel,
}) {
  const checked = new Set(progress.lessons_done);
  const pct = progress.done
    ? 100
    : mod.lessons.length
      ? (checked.size / mod.lessons.length) * 100
      : 0;

  return (
    <div
      className={"tr-mod" + (progress.done ? " is-done" : "") + (mod.isFinal ? " is-final" : "")}
      id={"tr-mod-" + mod.id}
    >
      <div className="tr-mod-head" onClick={onToggleExpand}>
        <span className="tr-week">W{mod.week}</span>
        <span className="tr-mod-title">
          {mod.title}
          {mod.isFinal && <span className="tr-mod-final-badge">Final</span>}
        </span>
        <Ring pct={pct} />
        <span className="tr-caret">{expanded ? "▾" : "▸"}</span>
      </div>

      {expanded && (
        <div className="tr-mod-body">
          {/* Lessons checklist */}
          <div className="tr-block-label">Lessons</div>
          {mod.lessons.map((lesson, i) => (
            <label
              key={i}
              className={"tr-lesson" + (checked.has(i) ? " is-checked" : "")}
              onClick={(e) => { if (readOnly) e.preventDefault(); }}
            >
              <input
                type="checkbox"
                checked={checked.has(i)}
                disabled={readOnly}
                onChange={() => onToggleLesson(i)}
              />
              <span>{lesson}</span>
            </label>
          ))}

          {/* Objectives */}
          <div className="tr-block-label">Learning objectives</div>
          <ul className="tr-list">
            {mod.objectives.map((o, i) => <li key={i}>{o}</li>)}
          </ul>

          {/* Exercise + milestone */}
          <div className="tr-block-label">Practical exercise</div>
          <div className="tr-callout">
            <span className="tr-callout-tag">Exercise</span>
            {mod.exercise}
          </div>
          <div style={{ height: 8 }} />
          <div className="tr-callout is-milestone">
            <span className="tr-callout-tag">{mod.isFinal ? "Final deliverable" : "Milestone"}</span>
            {mod.milestone}
          </div>

          {/* Videos */}
          <div className="tr-block-label">Tutorials</div>
          <div className="tr-videos">
            {mod.videos.length === 0 && (
              <span className="tr-vid-empty">No tutorial links yet — Paul can add YouTube/IG links in training-data.jsx.</span>
            )}
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

          {/* Practice on real projects */}
          <div className="tr-block-label">Practice on real projects</div>
          {practiceReels.length === 0 ? (
            <span className="tr-reels-empty">
              No reels tagged for this skill yet. Tag a reel with “{mod.skillLabel}” from its detail page.
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

          {/* Mark done */}
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
                {progress.done ? "↩ Mark not done" : "✓ Mark module complete"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
