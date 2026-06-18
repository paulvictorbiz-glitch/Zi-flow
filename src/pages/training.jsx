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

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase-client.js";
import { useAuth } from "../auth.jsx";
import { useWorkflow } from "../store/store.jsx";
import {
  PILLAR_MODULES, MODULE_BY_SKILL, TOTAL_MODULES,
  LEVELS, levelForCount, youtubeId,
} from "../lib/training-curriculum.jsx";
import { EditableText } from "../components/EditableText.jsx";
import { RubricQuickRef } from "../components/RubricQuickRef.jsx";
import "./training.css";

export function Training({ onOpen, personId, focusModule, onFocusConsumed }) {
  const { person: me } = useAuth();
  const { reels, moduleContent, actions } = useWorkflow();

  const canEdit = me?.role === "owner";

  // Whose progress we show. Defaults to the signed-in person.
  const viewedId = personId || me?.id || null;
  const isSelf = viewedId === me?.id;

  // progress: { [moduleId]: { done: bool, lessons_done: number[] } }
  const [progress, setProgress] = useState({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState({}); // expanded module ids (= skillKeys)

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
        <div className="tr-exp-card">
          <div className="tr-exp-top">
            <div>
              <div className="tr-level">{level.label}</div>
              <div className="tr-level-blurb">{level.blurb}</div>
            </div>
            <div className="tr-count">
              <b>{completedCount}</b> / {TOTAL_MODULES} pillars complete
            </div>
          </div>
          <div className="tr-bar">
            <div className="tr-bar-fill" style={{ width: expPct.toFixed(1) + "%" }} />
          </div>
          <div className="tr-next">
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
        <div className="tr-month-head">
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
            practiceReels={reelsBySkill[mod.skillKey] || []}
            onOpenReel={onOpen}
            onJumpToModule={jumpTo}
          />
        ))}
      </section>

      {/* Collapsible rubric reference (replaces the old flat RUBRIC table) */}
      <RubricQuickRef onJumpToModule={jumpTo} />
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

/* ── Linkify utilities ─────────────────────────────────────────── */
const _YT_ID_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const _URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

function YoutubeEmbedLink({ url, ytId }) {
  const [embed, setEmbed] = React.useState(false);
  if (embed) return (
    <div style={{ marginTop: 6 }}>
      <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, overflow: "hidden", borderRadius: 6 }}>
        <iframe
          src={"https://www.youtube.com/embed/" + ytId}
          title="Tutorial"
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      <button onClick={() => setEmbed(false)}
        style={{ fontSize: 11, marginTop: 4, cursor: "pointer", background: "none", border: "none", color: "var(--fg-dim)" }}>
        Hide embed
      </button>
    </div>
  );
  return (
    <span>
      <a href={url} target="_blank" rel="noopener noreferrer"
        style={{ color: "var(--c-cyan)", wordBreak: "break-all" }}>{url}</a>
      <button onClick={() => setEmbed(true)}
        style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 3, cursor: "pointer",
          background: "rgba(127,212,154,0.1)", border: "1px solid rgba(127,212,154,0.3)", color: "var(--c-green, #7fd49a)" }}>
        Embed
      </button>
    </span>
  );
}

function linkifyText(text) {
  if (!text) return text;
  _URL_RE.lastIndex = 0;
  const parts = [];
  let last = 0, m;
  while ((m = _URL_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const url = m[0];
    const ytMatch = url.match(_YT_ID_RE);
    parts.push(ytMatch
      ? <YoutubeEmbedLink key={m.index} url={url} ytId={ytMatch[1]} />
      : <a key={m.index} href={url} target="_blank" rel="noopener noreferrer"
           style={{ color: "var(--c-cyan)", wordBreak: "break-all" }}>{url}</a>);
    last = m.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

/* A labeled rich-prose block. Wraps the value in EditableText.
   In read-only mode, URLs in the text are rendered as clickable links;
   YouTube URLs get an optional inline embed toggle. */
function ProseBlock({ label, fieldPath, value, canEdit, onCommit, className }) {
  return (
    <>
      <div className="tr-block-label">{label}</div>
      <div className={"tr-prose " + (className || "")}>
        {canEdit ? (
          <EditableText
            value={value}
            canEdit
            multiline
            onCommit={(v) => onCommit(fieldPath, v)}
          />
        ) : (
          <span className="et-readonly et-multiline" style={{ whiteSpace: "pre-wrap" }}>
            {linkifyText(value) || <span style={{ opacity: 0.4 }}>—</span>}
          </span>
        )}
      </div>
    </>
  );
}

/* A labeled editable list (each item is its own EditableText, fieldPath
   = "<base>.<index>"). */
function ListBlock({ label, base, items, canEdit, onCommit, resolveField, moduleId, liClass }) {
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
              onCommit={(v) => onCommit(base + "." + i, v)}
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
  resolveField, onCommit, practiceReels, onOpenReel, onJumpToModule,
}) {
  const s = mod.sections;
  const checked = new Set(progress.lessons_done);
  const checklist = s.checklist || [];
  const pct = progress.done
    ? 100
    : checklist.length
      ? (checked.size / checklist.length) * 100
      : 0;

  const rf = (path, fallback) => resolveField(mod.id, path, fallback);
  const nextMod = mod.nextSkill ? MODULE_BY_SKILL[mod.nextSkill] : null;

  return (
    <div
      className={"tr-mod" + (progress.done ? " is-done" : "")}
      id={"tr-mod-" + mod.skillKey}
    >
      <div className="tr-mod-head" onClick={onToggleExpand}>
        <span className="tr-mod-title">
          <span className="tr-mod-icon">{mod.icon}</span>
          {mod.title}
        </span>
        <span className="tr-mod-deliv">{mod.deliverables}</span>
        <Ring pct={pct} />
        <span className="tr-caret">{expanded ? "▾" : "▸"}</span>
      </div>

      {expanded && (
        <div className="tr-mod-body">
          <ProseBlock label="Why this skill matters" fieldPath="whyMatters"
            value={rf("whyMatters", s.whyMatters)} canEdit={canEdit} onCommit={onCommit} />

          <ProseBlock label="Skill definition" fieldPath="definition"
            value={rf("definition", s.definition)} canEdit={canEdit} onCommit={onCommit} />

          <ProseBlock label="What good looks like" fieldPath="goodLooks"
            value={rf("goodLooks", s.goodLooks)} canEdit={canEdit} onCommit={onCommit}
            className="" />

          <ListBlock label="Common mistakes" base="commonMistakes"
            items={s.commonMistakes} canEdit={canEdit} onCommit={onCommit}
            resolveField={resolveField} moduleId={mod.id} />

          {/* Gold standard */}
          {(s.goldExamples?.length || s.goldBreakdown?.length) ? (
            <>
              <div className="tr-block-label">Gold standard examples</div>
              <div className="tr-example is-gold">
                <span className="tr-example-tag">Examples</span>
                <ul className="tr-list">
                  {(s.goldExamples || []).map((it, i) => (
                    <li key={i}>
                      <EditableText value={rf("goldExamples." + i, it)} canEdit={canEdit}
                        multiline onCommit={(v) => onCommit("goldExamples." + i, v)} />
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
                            multiline onCommit={(v) => onCommit("goldBreakdown." + i, v)} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </>
          ) : null}

          {/* Poor standard */}
          {(s.poorExamples?.length || s.poorBreakdown?.length) ? (
            <>
              <div className="tr-block-label">Poor standard examples</div>
              <div className="tr-example is-poor">
                <span className="tr-example-tag">Examples</span>
                <ul className="tr-list">
                  {(s.poorExamples || []).map((it, i) => (
                    <li key={i}>
                      <EditableText value={rf("poorExamples." + i, it)} canEdit={canEdit}
                        multiline onCommit={(v) => onCommit("poorExamples." + i, v)} />
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
                            multiline onCommit={(v) => onCommit("poorBreakdown." + i, v)} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </>
          ) : null}

          {/* Editing exercise */}
          <div className="tr-block-label">Editing exercise</div>
          <div className="tr-callout">
            <span className="tr-callout-tag">Exercise</span>
            <EditableText value={rf("exercise", s.exercise)} canEdit={canEdit}
              multiline onCommit={(v) => onCommit("exercise", v)} />
          </div>

          <ListBlock label="Self-assessment — ask yourself" base="selfAssessment"
            items={s.selfAssessment} canEdit={canEdit} onCommit={onCommit}
            resolveField={resolveField} moduleId={mod.id} />

          {/* Checklist — TRACKABLE. Checkboxes drive progress; the TEXT is
             owner-editable (independent of ticking). */}
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
                  onCommit={(v) => onCommit("checklist." + i, v)}
                />
              </span>
            </div>
          ))}

          <ListBlock label="Development plan" base="developmentPlan"
            items={s.developmentPlan} canEdit={canEdit} onCommit={onCommit}
            resolveField={resolveField} moduleId={mod.id} />

          {/* Pro tips — only when present */}
          {s.proTips?.length > 0 && (
            <>
              <div className="tr-block-label">Pro tips</div>
              <div className="tr-callout tr-protip">
                <span className="tr-callout-tag">Pro tips</span>
                <ul className="tr-list">
                  {s.proTips.map((it, i) => (
                    <li key={i}>
                      <EditableText value={rf("proTips." + i, it)} canEdit={canEdit}
                        multiline onCommit={(v) => onCommit("proTips." + i, v)} />
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {/* Tutorials */}
          {mod.videos?.length > 0 && (
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
          )}

          {/* Practice on real projects */}
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
                {progress.done ? "↩ Mark not done" : "✓ Mark pillar complete"}
              </button>
            </div>
          )}

          {/* Next skill (label only; Layer 3 wires actual nav) */}
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
        </div>
      )}
    </div>
  );
}
