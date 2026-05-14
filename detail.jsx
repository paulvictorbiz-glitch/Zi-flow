/* =========================================================
   Reel Detail — 2-column operational surface for one reel.
   Center column packs: Reel Blueprint · Operational Roadmap
   (with embedded next-review/handoff/downstream context) ·
   Editor Checklist · Comments · Task Requests · Variant
   Readiness (renameable).
   ========================================================= */

import React, { useState, useEffect, useMemo } from "react";
import { Card, DPill, Pill, StageSpine, Check, TaskObject } from "./components.jsx";
import { FOOTAGE, EVENTS, COMMENTS, INIT_TASKS, DETAIL_STAGES } from "./detail-data.jsx";
import { RmNode } from "./rm-node.jsx";
import { VariantRow } from "./variant-row.jsx";
import {
  HandoffPackage, AllowedChanges, GroupedAttachments, ReadyForReview,
  HANDOFF_REQS, DEFAULT_ALLOWED, DEFAULT_NOTOUCH,
} from "./handoff.jsx";
import { useWorkflow } from "./store.jsx";
import { useAuth } from "./auth.jsx";

const DEFAULT_LOGLINE =
  "Temple chaos in 30 seconds. Bell ring opens the moment, drone reveals the scale, " +
  "crowd surge sells the energy.";
const DEFAULT_SCRIPT =
`00:00 — bell ring close-up (A7IV_0331). Tight, no music.
00:02 — music drop on the second strike. Cut to wide.
00:08 — drone reveal of the square. Hold 2.5 beats.
00:12 — face reactions, intercut with bell ringer.
00:18 — prayer flag wipe to procession line.
00:24 — slow push-in on lead monk's gaze.
00:28 — match-cut back to bell + caption pin.

Voiceover (optional):
"Every dawn in Kathmandu starts with a sound. This is the one."`;
const DEFAULT_VO =
  "Every dawn in Kathmandu starts with a sound. This is the one. (warm, low register, 6s read)";
const DEFAULT_ATTACH = "https://drive.google.com/drive/folders/kathmandu-source";

/* Default seed for the persisted `detail` blob — checklists,
   variants, handoff package, allowed-changes/no-touch lists,
   per-reel task composer, ready-for-review stage. */
const DEFAULT_CHECKS = [
  { id: 1, label: "Selects pulled and timecoded.", done: true },
  { id: 2, label: "Music bed locked.",            done: true },
  { id: 3, label: "Rough cut at length.",         done: true },
  { id: 4, label: "First 3s hook chosen — pending owner pick.", warn: true },
  { id: 5, label: "Captions style approved.",     block: true },
  { id: 6, label: "Final export package.",        },
];
const DEFAULT_HANDOFF_CHECKS = [
  { id: 1, label: "Reference board linked.", done: true },
  { id: 2, label: "Frame.io review draft in progress.", warn: true },
  { id: 3, label: "Final export 1080×1920 attached.", block: true },
  { id: 4, label: "Allowed variant changes written.",  },
  { id: 5, label: "No-touch elements marked.",  },
  { id: 6, label: "Source links ready.",  },
];
const DEFAULT_VARIANTS = [
  { letter: "A", type: "caption", label: "Text caption change", state: "active" },
  { letter: "B", type: "audio",   label: "Audio hook change",  state: "" },
  { letter: "C", type: "altclip", label: "Alternative starting hook clip", state: "" },
  { letter: "D", type: null,      label: "",                    state: "" },
  { letter: "E", type: null,      label: "",                    state: "" },
];

/* Seed comments with the historic thread, but tag them with stable
   ids so adds/deletes work the same as the rest of the slices. */
const DEFAULT_COMMENTS = COMMENTS.map((c, i) => ({
  id: "seed-" + i,
  authorId: null,
  who: c.who,
  role: c.role,
  ts: c.ts,
  txt: c.txt,
}));

function defaultDetail() {
  return {
    checks: DEFAULT_CHECKS,
    handoffChecks: DEFAULT_HANDOFF_CHECKS,
    perReelTasks: INIT_TASKS,
    variants: DEFAULT_VARIANTS,
    handoffPackage: HANDOFF_REQS,
    allowed: DEFAULT_ALLOWED,
    notouch: DEFAULT_NOTOUCH,
    readyForReview: "editing",
    comments: DEFAULT_COMMENTS,
  };
}

function initials(name) {
  if (!name) return "??";
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatCommentTs(iso) {
  if (!iso) return "";
  // Pre-existing seed entries already use display strings ("11:08").
  if (!/^\d{4}-/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return hh + ":" + mm;
  const md = (d.getMonth() + 1) + "/" + d.getDate();
  return md + " " + hh + ":" + mm;
}

function ReelDetail({ reel, onBack }) {
  /* reel is passed from Pipeline when a card is clicked. Default to REEL-201. */
  const current = reel || { id: "REEL-201", title: "Temple crowd sequence" };

  /* Hook into the canonical store. `stored` is the DB-backed
     record for the currently displayed reel — what we read seed
     values from and what we write Blueprint edits back into. */
  const { reels, actions } = useWorkflow();
  const stored = reels.find(r => r.id === current.id);

  const [blueprintTab, setBlueprintTab] = useState("script");
  const [logline, setLogline]     = useState(stored?.logline ?? DEFAULT_LOGLINE);
  const [script, setScript]       = useState(stored?.script ?? DEFAULT_SCRIPT);
  const [vo, setVo]               = useState(stored?.vo ?? DEFAULT_VO);

  /* When the user navigates to a different reel, re-seed the
     Blueprint fields from that reel's stored values. Edits in
     flight on the prior reel are already persisted on blur. */
  useEffect(() => {
    setLogline(stored?.logline ?? DEFAULT_LOGLINE);
    setScript(stored?.script ?? DEFAULT_SCRIPT);
    setVo(stored?.vo ?? DEFAULT_VO);
  }, [current.id]);  // intentionally NOT depending on `stored` — that would clobber typing on realtime echo

  /* Save-on-blur helper: only writes if the value actually
     changed, so passive tab-outs are free. */
  const saveIfChanged = (key, value) => {
    if (!stored) return;
    if (stored[key] === value) return;
    actions.updateReel(current.id, { [key]: value });
  };

  /* Detail blob — single jsonb on the reel. Holds checklists,
     variants, handoff package, allowed/no-touch lists, the
     per-reel task composer queue, and the ReadyForReview stage.
     Auto-saved on a 300ms debounce after the last edit. */
  const [detail, setDetail] = useState(() => stored?.detail || defaultDetail());

  /* Re-seed when the user navigates to a different reel. NOT
     dependent on `stored.detail` — otherwise realtime echoes
     would clobber in-flight edits. */
  useEffect(() => {
    setDetail(stored?.detail || defaultDetail());
  }, [current.id]);

  /* Debounced save. Skips no-ops by structural-equality check. */
  useEffect(() => {
    if (!stored) return;
    const same = JSON.stringify(detail) === JSON.stringify(stored.detail || defaultDetail());
    if (same) return;
    const t = setTimeout(() => {
      actions.updateReel(current.id, { detail });
    }, 300);
    return () => clearTimeout(t);
  }, [detail, stored]);

  /* Slice helpers — sub-components and inline handlers call
     these to mutate one key without touching the others. */
  const checks         = detail.checks         || DEFAULT_CHECKS;
  const handoffChecks  = detail.handoffChecks  || DEFAULT_HANDOFF_CHECKS;
  const perReelTasks   = detail.perReelTasks   || INIT_TASKS;
  const variants       = detail.variants       || DEFAULT_VARIANTS;
  const handoffPackage = detail.handoffPackage || HANDOFF_REQS;
  const allowed        = detail.allowed        || DEFAULT_ALLOWED;
  const notouch        = detail.notouch        || DEFAULT_NOTOUCH;
  const readyForReview = detail.readyForReview || "editing";
  const comments       = detail.comments       || DEFAULT_COMMENTS;

  const { person: me } = useAuth();
  const [draftComment, setDraftComment] = useState("");

  const postComment = () => {
    const txt = draftComment.trim();
    if (!txt) return;
    const entry = {
      id: "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
      authorId: me?.id ?? null,
      who: me?.short || initials(me?.name) || "ME",
      role: me?.name || "You",
      ts: new Date().toISOString(),
      txt,
    };
    updateSlice("comments")(arr => [...(arr || []), entry]);
    setDraftComment("");
  };

  const deleteComment = (id) => {
    updateSlice("comments")(arr => (arr || []).filter(c => c.id !== id));
  };

  const updateSlice = (key) => (next) =>
    setDetail(d => ({ ...d, [key]: typeof next === "function" ? next(d[key] ?? []) : next }));

  /* Ephemeral UI state for the task composer — not persisted. */
  const [composerOpen, setComposerOpen]     = useState(false);
  const [audience, setAudience]             = useState("owner");
  const [taskType, setTaskType]             = useState("Decision");
  const [taskInstruction, setTaskInstruction] = useState("");

  /* External attachment (drive/IG reference) — persisted via
     reel.attachUrl. The local mirror lets us seed the prompt
     and react before the realtime echo lands. */
  const [attachUrl, setAttachUrl] = useState(stored?.attachUrl ?? DEFAULT_ATTACH);
  useEffect(() => { setAttachUrl(stored?.attachUrl ?? DEFAULT_ATTACH); }, [current.id]);

  const updateAttach = () => {
    const next = window.prompt(
      "Attach a reference link (Google Drive, Instagram, etc.)",
      attachUrl
    );
    if (next === null) return;
    const trimmed = next.trim();
    setAttachUrl(trimmed);
    if (stored && stored.attachUrl !== trimmed) {
      actions.updateReel(current.id, { attachUrl: trimmed });
    }
  };

  const doneCount = checks.filter(c => c.done).length;
  const handoffDone = handoffChecks.filter(c => c.done).length;
  const variantsActive = variants.filter(v => v.state === "active" || v.state === "done").length;

  /* Toggle a check item in either checklist by key ("checks" or
     "handoffChecks"). Matches the original behavior: setting done
     also clears warn/block flags. */
  const toggleCheck = (key, id) => updateSlice(key)(cs => cs.map(c =>
    c.id === id ? (c.done ? { ...c, done: false } : { ...c, done: true, warn: false, block: false }) : c
  ));

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Reel detail — {current.id} · {current.title}</h1>
          <div className="sub">
            Two-pane operational surface. Center holds the blueprint, operational roadmap with
            inline next-review / handoff / downstream context, and the working layer
            (checklist, comments, task requests, variant readiness).
          </div>
        </div>
        <div className="actions" style={{ alignItems: "center" }}>
          <DPill tone="amber" active>● 6h 28m to main due</DPill>
          {/* REEL-201 turned into an attachment hyperlink */}
          <a
            className="attach-link"
            href={attachUrl || "#"}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => { if (!attachUrl) e.preventDefault(); }}
            title={attachUrl || "No reference attached"}
          >
            <span className="icon">↗</span>
            <span style={{ color: "var(--fg)" }}>{current.id}</span>
            <span className="url">{attachUrl ? prettyHost(attachUrl) : "attach link"}</span>
          </a>
          <DPill onClick={updateAttach}>Edit link</DPill>
          <DPill primary>Open in FootageBrain</DPill>
        </div>
      </div>

      {/* Compact stage spine */}
      <StageSpine stages={DETAIL_STAGES} activeKey="main" />

      <div className="detail-grid">
        {/* ===== LEFT — sources, deps, log ===== */}
        <div className="detail-col">
          <Card
            title="FootageBrain linked · footage"
            right={<span className="count-tag cyan">8 selects</span>}
            footLeft="Linked from semantic search"
          >
            {FOOTAGE.map(f => (
              <div className="footage-row" key={f.id}>
                <div className="footage-thumb" />
                <div className="footage-info">
                  <div className="id">{f.id} <span className="tc">{f.tc}</span></div>
                  <div className="desc">{f.desc}</div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <DPill primary>+ Semantic re-search</DPill>
              <DPill>Open in FootageBrain</DPill>
            </div>
          </Card>

          <Card
            title="Dependency blocking"
            tone="block"
            right={<Pill tone="block">1 critical</Pill>}
            footLeft="Blockers + upstream context"
          >
            <div style={{ fontSize: 13, color: "var(--fg)", lineHeight: 1.4 }}>
              <b>Owner decision on hook A vs B.</b>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--fg-mute)", marginTop: 6, lineHeight: 1.4 }}>
              Waiting 3h 12m. SLA breaches at 14:00. Variant brief stays locked
              until one hook is chosen.
            </div>
            <div className="divider" />
            <div className="h-sub">Other deps</div>
            <ul style={{ margin: "4px 0 0 0", padding: 0, listStyle: "none", fontSize: 12 }}>
              <li style={{ padding: "4px 0", color: "var(--fg-mute)" }}>
                <span style={{ color: "var(--c-amber)" }}>●</span> subtitle style approval pending
              </li>
              <li style={{ padding: "4px 0", color: "var(--fg-mute)" }}>
                <span style={{ color: "var(--c-amber)" }}>●</span> Music choice A/B locked
              </li>
              <li style={{ padding: "4px 0", color: "var(--fg-mute)" }}>
                <span style={{ color: "var(--c-green)" }}>●</span> Reference board linked + available
              </li>
            </ul>
          </Card>

          <Card
            title="Event log"
            right={<span className="count-tag">14 entries</span>}
            footLeft="Operational history"
          >
            {EVENTS.map((e, i) => (
              <div className="event" key={i}>
                <div className="t">{e.t}</div>
                <div className="body">{e.body}</div>
              </div>
            ))}
          </Card>
        </div>

        {/* ===== CENTER ===== */}
        <div className="detail-col center">
          {/* 1) Reel Blueprint — replaces the focus/hook area */}
          <div className="blueprint">
            <div className="blueprint-head">
              <div className="h">Reel Blueprint</div>
              <div className="meta">Logline · script · voiceover — your working notes</div>
            </div>
            <div className="blueprint-tabs">
              <div className={"blueprint-tab " + (blueprintTab === "logline" ? "active" : "")}
                   onClick={() => setBlueprintTab("logline")}>Logline</div>
              <div className={"blueprint-tab " + (blueprintTab === "script" ? "active" : "")}
                   onClick={() => setBlueprintTab("script")}>Script / shot plan</div>
              <div className={"blueprint-tab " + (blueprintTab === "vo" ? "active" : "")}
                   onClick={() => setBlueprintTab("vo")}>Voiceover</div>
            </div>
            <div className="blueprint-body">
              <div className="col-label">
                {blueprintTab === "logline" ? "Logline" : blueprintTab === "vo" ? "VO read" : "Beat plan"}
              </div>
              <div>
                {blueprintTab === "logline" && (
                  <textarea
                    value={logline}
                    onChange={e => setLogline(e.target.value)}
                    onBlur={() => saveIfChanged("logline", logline)}
                    placeholder="One sentence: what is this reel?"
                  />
                )}
                {blueprintTab === "script" && (
                  <textarea
                    className="script"
                    value={script}
                    onChange={e => setScript(e.target.value)}
                    onBlur={() => saveIfChanged("script", script)}
                    placeholder="Beat-by-beat plan, shot list, captions…"
                  />
                )}
                {blueprintTab === "vo" && (
                  <textarea
                    value={vo}
                    onChange={e => setVo(e.target.value)}
                    onBlur={() => saveIfChanged("vo", vo)}
                    placeholder="Voiceover text + delivery notes"
                  />
                )}
                <div style={{ marginTop: 8, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)" }}>
                  {stored ? "saves on blur · synced across devices" : "not persisted · open this reel via Pipeline to enable saves"}
                </div>
              </div>
            </div>
          </div>

          {/* 2) Operational roadmap with expandable nodes — absorbs the old right-side cards */}
          <div className="roadmap">
            <div className="roadmap-head">
              <div className="h">Operational roadmap</div>
              <div className="meta">where {current.id} is flowing toward · click any step to expand</div>
            </div>

            <RmNode
              num="1" tone="cyan" defaultOpen={true}
              title="Next review"
              sub="Paul V reviews, writes handoff, clears the reel to move."
              right={<Pill tone="warn">waits on you · 4h SLA</Pill>}
            >
              <div className="p">
                <b>Paul Victor</b> reviews the locked main. Approves or sends back with notes.
                4h SLA begins when main edit is marked review-ready.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <DPill primary>Mark main review-ready</DPill>
                <DPill>Ping Paul V</DPill>
                <DPill>Defer 1h</DPill>
              </div>
            </RmNode>

            <div className="roadmap-arrow"></div>

            <RmNode
              num="2"
              title="Handoff"
              sub="Owner writes allowed changes, attaches export, opens variant brief."
              right={<span className="count-tag cyan">{handoffDone} / {handoffChecks.length} prep</span>}
            >
              <div className="p">
                Owner packages the handoff so Jay can start variants without a back-and-forth.
              </div>
              <div className="checklist">
                {handoffChecks.map(c => (
                  <Check key={c.id} item={c} onToggle={() => toggleCheck("handoffChecks", c.id)} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <DPill primary>Open handoff doc</DPill>
                <DPill>Attach export</DPill>
              </div>
            </RmNode>

            <div className="roadmap-arrow"></div>

            <RmNode
              num="3" tone="warn" defaultOpen={true}
              title="Downstream readiness"
              sub="Jay packages variants from the locked main. Caption pass runs in parallel."
              right={<Pill tone="warn">idle risk · 3h 20m</Pill>}
            >
              <div className="p">
                Jay (variant editor) has 3h 20m of work today and no active brief beyond the
                current queue. If main slips past 18:00, the lane goes idle.
              </div>
              <div className="h-sub">Risk if not resolved</div>
              <ul style={{ margin: "4px 0 6px 0", padding: 0, listStyle: "none", fontSize: 11.5, color: "var(--fg-mute)" }}>
                <li style={{ padding: "3px 0" }}>· Friday post window shifts +1 day</li>
                <li style={{ padding: "3px 0" }}>· Jay's lane idles overnight</li>
                <li style={{ padding: "3px 0" }}>· Caption pass left no-buffer</li>
              </ul>
              <div style={{
                marginTop: 4,
                padding: "9px 11px",
                border: "1px dashed var(--c-amber-soft)",
                borderRadius: 6,
                fontSize: 11.5,
                color: "var(--c-amber)",
                background: "rgba(245,194,102,0.04)",
                display: "flex", gap: 10, alignItems: "center",
              }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--c-amber)" }} />
                <span>
                  <b style={{ color: "var(--c-amber)" }}>Idle risk:</b>{" "}
                  <span style={{ color: "var(--fg)" }}>
                    If main slips past 18:00, Jay's variant lane goes idle and Friday's post window slides.
                  </span>
                </span>
              </div>
            </RmNode>
          </div>

          {/* 3) Editor checklist + comments */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Card
              title="Editor checklist"
              right={<span className="count-tag cyan">{doneCount} / {checks.length}</span>}
              footLeft="Editor tasks"
            >
              <div className="checklist">
                {checks.map(c => <Check key={c.id} item={c} onToggle={() => toggleCheck("checks", c.id)} />)}
              </div>
            </Card>

            <Card
              title="Comments + feedback"
              right={<span className="count-tag">{comments.length}</span>}
              footLeft="Conversation layer · persisted per reel"
            >
              {comments.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--fg-dim)", padding: "6px 0" }}>
                  No comments yet — leave the first note below.
                </div>
              )}
              {comments.map((c) => {
                const mine = me && c.authorId && c.authorId === me.id;
                return (
                  <div className="comment" key={c.id}
                       style={{ position: "relative" }}>
                    <div className={"avatar " + String(c.who || "").toLowerCase()}>{c.who}</div>
                    <div>
                      <div className="who">
                        <b>{c.role}</b>
                        <span className="ts">{formatCommentTs(c.ts)}</span>
                        {mine && (
                          <span
                            onClick={() => deleteComment(c.id)}
                            title="Delete this comment"
                            style={{
                              marginLeft: "auto",
                              fontFamily: "var(--f-mono)",
                              fontSize: 10,
                              color: "var(--fg-dim)",
                              cursor: "pointer",
                            }}
                          >×</span>
                        )}
                      </div>
                      <div className="txt">{c.txt}</div>
                    </div>
                  </div>
                );
              })}
              <div style={{
                marginTop: 10,
                border: "1px dashed var(--line-hard)",
                borderRadius: 6,
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}>
                <textarea
                  value={draftComment}
                  onChange={e => setDraftComment(e.target.value)}
                  onKeyDown={e => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      postComment();
                    }
                  }}
                  placeholder={stored
                    ? "Leave feedback or progress note… (⌘/Ctrl + Enter to post)"
                    : "Open this reel via Pipeline to post feedback."}
                  disabled={!stored}
                  style={{
                    background: "var(--bg-2)",
                    border: "1px dashed var(--line-hard)",
                    borderRadius: 4,
                    color: "var(--fg)",
                    fontFamily: "var(--f-sans)",
                    fontSize: 12,
                    padding: "6px 9px",
                    resize: "vertical",
                    minHeight: 52,
                    outline: "none",
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 10.5, color: "var(--fg-dim)", fontFamily: "var(--f-mono)" }}>
                    posting as <b style={{ color: "var(--fg)" }}>{me?.name || "you"}</b>
                  </div>
                  <div style={{ flex: 1 }} />
                  <DPill
                    primary
                    onClick={postComment}
                    style={{ opacity: draftComment.trim() && stored ? 1 : 0.5 }}
                  >Post</DPill>
                </div>
              </div>
            </Card>
          </div>

          {/* 4) Task requests */}
          <Card
            title="Task requests"
            right={<DPill primary onClick={() => setComposerOpen(o => !o)}>+ New request</DPill>}
            footLeft="Lightweight task objects (assignee · type · status)"
          >
            {composerOpen && (
              <div className="task-composer" style={{ marginBottom: 10 }}>
                <span className="plus">+</span>
                <span>assign to</span>
                {[
                  { k: "owner",   l: "Owner · Paul V" },
                  { k: "variant", l: "Variant · Jay" },
                  { k: "pv",      l: "Reviewer · Leroy C" },
                ].map(o => (
                  <span key={o.k} className="chip" onClick={() => setAudience(o.k)}
                        style={{ borderColor: audience === o.k ? "var(--c-cyan)" : "" }}>
                    {o.l}
                  </span>
                ))}
                <span style={{ marginLeft: 6 }}>type</span>
                {["Decision","Source upload","Variant pack","Caption review","Thumbnail choice"].map(t => (
                  <span key={t} className="chip" onClick={() => setTaskType(t)}
                        style={{ borderColor: taskType === t ? "var(--c-cyan)" : "" }}>
                    Request {t.toLowerCase()}
                  </span>
                ))}
                <span style={{ flexBasis: "100%" }}></span>
                <input
                  placeholder="Short instruction…"
                  value={taskInstruction}
                  onChange={e => setTaskInstruction(e.target.value)}
                  style={{
                    flex: 1, minWidth: 200, padding: "6px 9px",
                    background: "var(--bg-2)",
                    border: "1px dashed var(--line-hard)",
                    borderRadius: 4, color: "var(--fg)",
                    fontFamily: "var(--f-sans)", fontSize: 12,
                  }}
                />
                <DPill primary onClick={() => {
                  updateSlice("perReelTasks")([
                    ...perReelTasks,
                    {
                      audience,
                      type: taskType,
                      assignee: audience === "owner" ? "Paul V" : audience === "variant" ? "Jay" : "Leroy C",
                      instruction: taskInstruction.trim() || ("New " + taskType.toLowerCase() + " request."),
                      status: "open",
                    },
                  ]);
                  setTaskInstruction("");
                  setComposerOpen(false);
                }}>Create</DPill>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {perReelTasks.map((t, i) => <TaskObject key={i} task={t} />)}
            </div>
          </Card>

          {/* 5) Ready-for-review state transition */}
          <ReadyForReview
            stage={readyForReview}
            onStageChange={updateSlice("readyForReview")}
          />

          {/* 6) Handoff package completeness */}
          <HandoffPackage
            items={handoffPackage}
            onItemsChange={updateSlice("handoffPackage")}
          />

          {/* 7) Allowed changes / no-touch */}
          <AllowedChanges
            allowed={allowed}
            onAllowedChange={updateSlice("allowed")}
            notouch={notouch}
            onNotouchChange={updateSlice("notouch")}
          />

          {/* 8) Grouped attachments */}
          <GroupedAttachments />

          {/* 9) Variant readiness — renameable */}
          <Card
            title="Variant readiness"
            right={
              <span className="count-tag cyan">
                {variantsActive} / {variants.length} · {variants.filter(v => v.type).length} named
              </span>
            }
            footLeft="Click any letter to rename the variant style"
          >
            <div className="var-rows">
              {variants.map((v, i) => (
                <VariantRow
                  key={v.letter}
                  row={v}
                  onChange={next => updateSlice("variants")(arr => arr.map((r, j) => j === i ? next : r))}
                />
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--fg-mute)", lineHeight: 1.5 }}>
              Each row becomes a real variant brief: Jay reads the label, packages from the locked
              main, and hands back a finished cut. Caption changes auto-route to Leroy for QA.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function prettyHost(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? "/…" : "");
  } catch {
    return url.slice(0, 24);
  }
}

export { ReelDetail };
