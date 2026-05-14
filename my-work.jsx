/* =========================================================
   My Work — role-aware "what needs me now" dashboard.

   Three modes drive different emphasis:
     · skilled  → grouped lanes (Not Started / In Progress /
                  Completed), execution signals, blocker reasons
     · variant  → simpler execution-focused queue with allowed
                  changes, variant slots, deadlines
     · owner    → approvals waiting, aging, stale ideas, post
                  windows, decisions only the owner can clear
   ========================================================= */

import React, { useState } from "react";
import { Card, DPill, Pill } from "./components.jsx";
import { useWorkflow } from "./store.jsx";
import { useAuth } from "./auth.jsx";
import { useNow, formatAge, formatDue } from "./time.jsx";
import { PEOPLE, STAGE_LABEL, STAGE_TONE } from "./shared-data.jsx";

/* Action-button gating per step 5:
   - Owner role = god-mode (always allowed).
   - Anyone else: only the matching role's actions are exposed. */
function useCanAct(requiredRole) {
  const { person } = useAuth();
  if (!person) return false;
  if (person.role === "owner") return true;
  return person.role === requiredRole;
}

function MyWork({ role, onOpen }) {
  if (role === "owner")   return <OwnerWork onOpen={onOpen} />;
  if (role === "variant") return <VariantWork onOpen={onOpen} />;
  return <SkilledWork onOpen={onOpen} />;
}

/* ─────────────────────────────────────────────────────── */
/* Skilled editor dashboard                                */
/* ─────────────────────────────────────────────────────── */

function SkilledWork({ onOpen }) {
  const { reels, tasks } = useWorkflow();
  const me = "alex";
  const mine = reels.filter(r => r.owner === me && !r.archivedAt);
  const groups = ["not_started", "in_progress", "completed"];
  const titles = {
    not_started: "Not started",
    in_progress: "In progress",
    completed:   "Completed",
  };
  const subs = {
    not_started: "Ideas + selected reels waiting on you",
    in_progress: "Main edits and pending owner picks",
    completed:   "Handed off · in variant or posted",
  };

  // Tasks assigned to me
  const myTasks = tasks.filter(t => t.to === me);

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>My work — Judy A · skilled editor</h1>
          <div className="sub">
            Operator workspace. Grouped by execution state. Each card carries blocker reason,
            dependency status, and what the next move is — so you know who you're waiting on
            and who's waiting on you.
          </div>
        </div>
        <div className="actions">
          <DPill tone="amber" active>● 2 blocked · waiting on owner</DPill>
          <DPill>Today's plan</DPill>
          <DPill solid>Toggle dependencies</DPill>
        </div>
      </div>

      {/* Focus banner — most urgent thing for this person */}
      <div style={{ padding: "12px 22px", borderBottom: "1px dashed var(--line)" }}>
        <div className="focus-banner">
          <div className="l">
            <div className="key">Next move</div>
            <div className="body">
              <b style={{ color: "var(--fg)" }}>REEL-201 · Temple crowd</b> is waiting on
              Paul's hook A/B pick. Variant lane idles in 3h 20m if not cleared.
            </div>
          </div>
          <div className="actions">
            <DPill primary onClick={() => onOpen({ id: "REEL-201", title: "Temple crowd sequence" })}>Open reel</DPill>
            <DPill>Nudge owner</DPill>
          </div>
        </div>
      </div>

      {/* Three grouped lanes */}
      <div className="mywork-grid">
        {groups.map(g => {
          const rows = mine.filter(r => r.grouping === g);
          return (
            <div className="mw-col" key={g}>
              <div className="mw-col-head">
                <div className="mw-h">{titles[g]}</div>
                <div className="mw-sub">{subs[g]}</div>
                <span className="count-tag">{rows.length}</span>
              </div>
              <div className="mw-list">
                {rows.map(r => <WorkCard key={r.id} reel={r} onOpen={onOpen} />)}
                {rows.length === 0 && <EmptyLane label="Nothing here right now." />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Inbound tasks row */}
      <div style={{ padding: "16px 22px", borderTop: "1px dashed var(--line)" }}>
        <Card
          title="Inbound task requests · for you"
          right={<span className="count-tag">{myTasks.length} open</span>}
          footLeft="Direct asks from teammates">
          <div className="task-list">
            {myTasks.map(t => <TaskRow key={t.id} task={t} />)}
            {myTasks.length === 0 && <div className="dim mono" style={{ padding: 12 }}>No inbound tasks.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
/* Variant editor dashboard — simpler, execution-focused   */
/* ─────────────────────────────────────────────────────── */

function VariantWork({ onOpen }) {
  const { reels, tasks } = useWorkflow();
  const me = "sam";
  const mine = reels.filter(r => r.owner === me && !r.archivedAt);
  const myTasks = tasks.filter(t => t.to === me);

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>My work — Jay · variant editor</h1>
          <div className="sub">
            Execution queue. Each row is a locked main + 5 variant slots, with explicit
            allowed changes and no-touch rules. Nothing here that doesn't act on you directly.
          </div>
        </div>
        <div className="actions">
          <DPill tone="amber" active>● 1 idle · awaiting brief</DPill>
          <DPill solid>Show ready handoffs</DPill>
        </div>
      </div>

      <div className="variant-queue">
        {mine.map(r => <VariantSlot key={r.id} reel={r} onOpen={onOpen} />)}
      </div>

      <div style={{ padding: "16px 22px", borderTop: "1px dashed var(--line)" }}>
        <Card title="Inbound task requests · for you"
              right={<span className="count-tag">{myTasks.length} open</span>}
              footLeft="Direct asks from teammates">
          <div className="task-list">
            {myTasks.length === 0
              ? <div className="dim mono" style={{ padding: 12 }}>No inbound tasks right now.</div>
              : myTasks.map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        </Card>
      </div>
    </div>
  );
}

function VariantSlot({ reel, onOpen }) {
  const now = useNow();
  const prog = reel.variantProgress || { done: 0, total: 5 };
  const cells = Array.from({ length: prog.total }, (_, i) =>
    i < prog.done ? "done" : (i === prog.done && !reel.blocker ? "active" : "")
  );

  return (
    <div className={"vslot " + (reel.state || "ok")} onClick={() => onOpen({ id: reel.id, title: reel.title })}>
      <div className="vslot-head">
        <div>
          <div className="mono dim">{reel.id}</div>
          <div className="serif-i" style={{ fontSize: 18, color: "#eef3fb", marginTop: 2 }}>{reel.title}</div>
        </div>
        <Pill tone={reel.state === "block" ? "block" : reel.state === "warn" ? "warn" : "ok"}>
          {reel.blocker ? "blocked" : (prog.done === prog.total ? "done" : "in progress")}
        </Pill>
      </div>

      <div className="vslot-body">
        <div className="vslot-block">
          <div className="h-sub">Main reel link</div>
          <a className="link" onClick={e => e.stopPropagation()}>↗ drive / locked-main-{reel.id.toLowerCase()}.mp4</a>
        </div>
        <div className="vslot-block">
          <div className="h-sub">Allowed changes</div>
          <div className="vslot-rules">
            <span className="rule allow">caption text</span>
            <span className="rule allow">audio hook</span>
            <span className="rule allow">first 2s of clip</span>
            <span className="rule noop">no music change</span>
            <span className="rule noop">no edit length</span>
          </div>
        </div>
        <div className="vslot-block">
          <div className="h-sub">Deadline</div>
          <div className="mono" style={{ color: "var(--c-amber)" }}>{formatDue(reel, now) || "—"}</div>
        </div>
      </div>

      <div className="vslot-slots">
        {cells.map((c, i) => (
          <div key={i} className={"slot " + c}>
            <div className="lt">{String.fromCharCode(65 + i)}</div>
            <div className="st">{c === "done" ? "packaged" : c === "active" ? "active" : "queued"}</div>
          </div>
        ))}
      </div>

      {reel.blocker && (
        <div className="vslot-blocker">
          <span style={{ color: "var(--c-red)" }}>●</span> {reel.blocker}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
/* Owner dashboard — approvals, aging, decisions           */
/* ─────────────────────────────────────────────────────── */

function OwnerWork({ onOpen }) {
  const { reels, tasks, actions } = useWorkflow();
  const canAct = useCanAct("owner");
  const now = useNow();
  const live = reels.filter(r => !r.archivedAt);
  const approvals = live.filter(r => r.stage === "review");
  const ready = live.filter(r => r.stage === "ready");
  const ideas = live.filter(r => r.stage === "idea");
  const decisions = tasks.filter(t => t.to === "paul");

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>My work — Paul V · owner / creative director</h1>
          <div className="sub">
            Approvals, decisions, and clearing blockers. Aging and downstream-idle risk surfaced
            up top so you know which reel buys back the most lane time.
          </div>
        </div>
        <div className="actions">
          <DPill tone="red" active>● 2 reels over SLA</DPill>
          <DPill solid>Open review queue</DPill>
        </div>
      </div>

      {/* Top strip — approvals waiting */}
      <div className="owner-strip">
        <Card title="Approvals waiting on you"
              right={<span className="count-tag" style={{ color: "var(--c-red)" }}>{approvals.length} open</span>}
              footLeft="Each row holds up downstream work">
          <div className="appr-list">
            {approvals.map(r => (
              <div key={r.id} className={"appr-row " + (r.state || "")}
                   onClick={() => onOpen({ id: r.id, title: r.title })}>
                <div>
                  <div className="mono dim">{r.id}</div>
                  <div className="serif-i" style={{ fontSize: 16, color: "#eef3fb", marginTop: 2 }}>{r.title}</div>
                  <div className="mono muted" style={{ marginTop: 4 }}>
                    waiting {formatAge(r, now)} · downstream: {r.downstream || "—"}
                  </div>
                </div>
                <div className="appr-actions">
                  <Pill tone={r.state === "block" ? "block" : "warn"}>{formatAge(r, now)}</Pill>
                  {canAct ? (
                    <React.Fragment>
                      <DPill primary onClick={e => { e.stopPropagation(); actions.approveReview(r.id); }}>Approve</DPill>
                      <DPill onClick={e => { e.stopPropagation(); actions.sendBack(r.id); }}>Send back</DPill>
                    </React.Fragment>
                  ) : (
                    <span className="mono dim" style={{ fontSize: 10.5 }}>owner-only</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Decisions only you can clear"
              right={<span className="count-tag cyan">{decisions.length} open</span>}
              footLeft="Owner-gated">
          <div className="task-list">
            {decisions.map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        </Card>
      </div>

      {/* Lower row */}
      <div className="owner-grid">
        <Card title="Ready to schedule / export"
              right={<span className="count-tag cyan">{ready.length} ready</span>}
              footLeft="Move to Export tab to prep import">
          <div className="ready-list">
            {ready.map(r => (
              <div key={r.id} className="ready-row" onClick={() => onOpen({ id: r.id, title: r.title })}>
                <div className="mono dim">{r.id}</div>
                <div className="serif-i" style={{ flex: 1, fontSize: 14 }}>{r.title}</div>
                <div className="mono muted">{formatDue(r, now)}</div>
                <Pill tone="ok">scheduled</Pill>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Stale ideas · triage"
              right={<span className="count-tag" style={{ color: "var(--c-amber)" }}>aging</span>}
              footLeft="Kill, defer, or greenlight">
          <div className="ready-list">
            {ideas.map(r => (
              <div key={r.id} className="ready-row" onClick={() => onOpen({ id: r.id, title: r.title })}>
                <div className="mono dim">{r.id}</div>
                <div className="serif-i" style={{ flex: 1, fontSize: 14 }}>{r.title}</div>
                <div className="mono" style={{ color: r.state === "warn" ? "var(--c-amber)" : "var(--fg-mute)" }}>
                  {formatAge(r, now)}
                </div>
                {canAct
                  ? <DPill solid onClick={e => { e.stopPropagation(); actions.triageIdea(r.id, "greenlight"); }}>Greenlight</DPill>
                  : <span className="mono dim" style={{ fontSize: 10.5 }}>owner-only</span>}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Downstream idle risk"
              right={<span className="count-tag" style={{ color: "var(--c-amber)" }}>3 lanes</span>}
              footLeft="Who idles next if you don't clear">
          <div className="risk-list">
            <div className="risk">
              <div className="risk-h">Sam · variant lane</div>
              <div className="risk-b">idles in <b>3h 20m</b> unless REEL-201 hook is picked.</div>
            </div>
            <div className="risk">
              <div className="risk-h">Maya · caption review</div>
              <div className="risk-b">queued behind REEL-195 approval (3h waiting).</div>
            </div>
            <div className="risk">
              <div className="risk-h">Friday post window</div>
              <div className="risk-b">slips +1d if Patan alleys re-review not cleared today.</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
/* Shared sub-pieces                                       */
/* ─────────────────────────────────────────────────────── */

function WorkCard({ reel, onOpen }) {
  const now = useNow();
  const tone = reel.state === "block" ? "block" : reel.state === "warn" ? "warn" : "";
  return (
    <div className={"work-card " + tone} onClick={() => onOpen({ id: reel.id, title: reel.title })}>
      <div className="wc-head">
        <div>
          <div className="mono dim">{reel.id}</div>
          <div className="serif-i" style={{ fontSize: 17, color: "#eef3fb", marginTop: 2 }}>{reel.title}</div>
        </div>
        <Pill tone={tone || STAGE_TONE[reel.stage]}>{STAGE_LABEL[reel.stage]}</Pill>
      </div>

      {reel.blocker && (
        <div className="wc-blocker">
          <span className="dot" />
          <span><b>{reel.blocker}</b></span>
        </div>
      )}

      <div className="wc-signals">
        <Signal label="FB"   value={reel.fb > 0 ? reel.fb + " selects" : "—"}    ok={reel.fb > 0} />
        <Signal label="REFS" value={reel.refs > 0 ? reel.refs + " refs" : "—"}    ok={reel.refs > 0} />
        <Signal label="DUE"  value={formatDue(reel, now) || "—"}                  warn={reel.state === "warn"} block={reel.state === "block"} />
      </div>

      {reel.next && (
        <div className="wc-next">
          <span className="mono muted">next ›</span> {reel.next}
        </div>
      )}
      {reel.downstream && (
        <div className="wc-down">
          <span className="mono muted">downstream ›</span> {reel.downstream}
        </div>
      )}
    </div>
  );
}

function Signal({ label, value, ok, warn, block }) {
  const cls = "sig " + (block ? "block" : warn ? "warn" : ok ? "ok" : "");
  return (
    <div className={cls}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}

function EmptyLane({ label }) {
  return <div className="mw-empty">{label}</div>;
}

function TaskRow({ task }) {
  const now = useNow();
  const dueText = formatDue(task, now) || task.due || "";
  return (
    <div className="task-row">
      <div className="tr-left">
        <span className="mono dim">{task.id}</span>
        <span className="tag type">{task.type}</span>
        <span className="mono muted">from {PEOPLE[task.from]?.short || task.from}</span>
        <span className="mono dim">· {task.reel}</span>
      </div>
      <div className="tr-instr">{task.instruction}</div>
      <div className="tr-right">
        <span className="mono" style={{ color: "var(--c-amber)" }}>{dueText}</span>
        <Pill tone={task.state?.includes("SLA") ? "warn" : "cyan"}>{task.state}</Pill>
      </div>
    </div>
  );
}

export { MyWork };
