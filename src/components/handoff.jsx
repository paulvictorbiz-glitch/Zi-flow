/* =========================================================
   Reel Detail extensions:
     · HandoffPackage  — completeness module for review→variant
     · AllowedChanges  — explicit allowed-change / no-touch rules
     · GroupedAttachments — FootageBrain / Drive / IG / Review /
                            Caption / Music groups
     · ReadyForReview — explicit state-transition control
   ========================================================= */

import React, { useState } from "react";
import { Card, DPill, Pill } from "./components.jsx";

/* ---------- Defaults exported for ReelDetail's detail-blob seed ---------- */
const HANDOFF_REQS = [
  { k: "main",     l: "Locked main export · 1080×1920",           done: true },
  { k: "ref",      l: "Reference board link",                     done: true },
  { k: "brief",    l: "Variant brief written",                    done: false },
  { k: "allow",    l: "Allowed-changes documented",               done: false },
  { k: "notouch",  l: "No-touch elements marked",                 done: false },
  { k: "caption",  l: "Caption + hashtag draft",                  done: true,  warn: true, note: "draft — needs Maya pass" },
  { k: "music",    l: "Music bed + licensing link",               done: true },
  { k: "source",   l: "Source folder accessible",                 done: true },
];

const DEFAULT_ALLOWED = [
  { id: 1, text: "Caption text — swap copy or rewrite for hook variants." },
  { id: 2, text: "Audio hook — try drum vs string vs ambient on first 2s." },
  { id: 3, text: "First 2s clip — substitute from selects A7IV_0331, DJI_0218." },
];

const DEFAULT_NOTOUCH = [
  { id: 1, text: "Music drop timing on 00:08 — locked to the bell hit." },
  { id: 2, text: "Edit length must stay 30s ± 0.5s." },
  { id: 3, text: "Caption font + safe-area — brand-locked." },
];

/* ---------- Handoff Package Completeness ----------
   Controlled component — parent owns items, passes onChange. */
function HandoffPackage({ items, onItemsChange }) {
  const done = items.filter(i => i.done).length;
  const total = items.length;
  const pct = Math.round((done / total) * 100);

  const toggle = (k) => onItemsChange(items.map(i => i.k === k ? { ...i, done: !i.done, warn: false } : i));

  return (
    <Card
      title="Handoff package · completeness"
      tone={pct < 60 ? "warn" : pct < 100 ? "" : "cyan"}
      right={
        <span className="count-tag" style={{ color: pct === 100 ? "var(--c-green)" : "var(--c-amber)" }}>
          {done}/{total} · {pct}%
        </span>
      }
      footLeft="Sam can't start variants until this is complete"
    >
      <div className="handoff-bar">
        <div className="handoff-fill" style={{ width: pct + "%" }} />
      </div>
      <div className="handoff-grid">
        {items.map(it => (
          <div key={it.k}
               className={"handoff-cell " + (it.done ? "done" : "") + (it.warn ? " warn" : "")}
               onClick={() => toggle(it.k)}>
            <div className="box">{it.done ? "✓" : ""}</div>
            <div>
              <div className="l">{it.l}</div>
              {it.note && <div className="n">{it.note}</div>}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <DPill primary>Generate handoff doc</DPill>
        <DPill>Notify Sam</DPill>
        <DPill solid>Mark ready for review</DPill>
      </div>
    </Card>
  );
}

/* ---------- Allowed Changes / No-touch ----------
   Controlled — parent owns the two lists, passes onChange handlers. */
function AllowedChanges({ allowed, onAllowedChange, notouch, onNotouchChange }) {
  const addLine = (onChange, arr) => onChange([...arr, { id: Date.now(), text: "" }]);
  const editLine = (onChange, arr, id, v) => onChange(arr.map(x => x.id === id ? { ...x, text: v } : x));
  const removeLine = (onChange, arr, id) => onChange(arr.filter(x => x.id !== id));

  return (
    <Card title="Variant brief · allowed changes & no-touch rules"
          right={<span className="count-tag cyan">{allowed.length} allowed · {notouch.length} no-touch</span>}
          footLeft="Sam reads this verbatim. Be specific.">
      <div className="ac-grid">
        <div className="ac-col allow">
          <div className="ac-h">
            <span className="dot" /> Allowed changes
          </div>
          {allowed.map(line => (
            <div className="ac-line" key={line.id}>
              <span className="bullet">+</span>
              <input className="ac-input" value={line.text}
                     onChange={e => editLine(onAllowedChange, allowed, line.id, e.target.value)} />
              <span className="rm" onClick={() => removeLine(onAllowedChange, allowed, line.id)}>×</span>
            </div>
          ))}
          <button className="ac-add" onClick={() => addLine(onAllowedChange, allowed)}>+ allowed change</button>
        </div>
        <div className="ac-col noop">
          <div className="ac-h">
            <span className="dot" /> No-touch
          </div>
          {notouch.map(line => (
            <div className="ac-line" key={line.id}>
              <span className="bullet">×</span>
              <input className="ac-input" value={line.text}
                     onChange={e => editLine(onNotouchChange, notouch, line.id, e.target.value)} />
              <span className="rm" onClick={() => removeLine(onNotouchChange, notouch, line.id)}>×</span>
            </div>
          ))}
          <button className="ac-add" onClick={() => addLine(onNotouchChange, notouch)}>+ no-touch rule</button>
        </div>
      </div>
    </Card>
  );
}

/* ---------- Grouped Attachments ---------- */
const ATTACH_GROUPS = [
  { k: "fb",      l: "FootageBrain",  tone: "cyan",
    items: [
      { label: "8 selects · semantic 'temple bell crowd'", url: "footagebrain://q/REEL-201" },
      { label: "ref-board · prayer dawn",                  url: "footagebrain://refs/dawn" },
    ]},
  { k: "drive",   l: "Drive",         tone: "",
    items: [
      { label: "Source folder · Kathmandu shoot",          url: "drive://kathmandu-source" },
      { label: "Locked main · v3 export 1080×1920",        url: "drive://exports/main-v3.mp4" },
    ]},
  { k: "ig",      l: "IG reference",  tone: "",
    items: [
      { label: "Reference reel · @vfxcraft",               url: "https://instagram.com/p/abc" },
      { label: "Hook pattern board · saved",               url: "https://instagram.com/saved/hooks" },
    ]},
  { k: "review",  l: "Review",        tone: "warn",
    items: [
      { label: "Frame.io review · v3",                     url: "https://frame.io/r/v3" },
      { label: "Notes from Paul · 11:32",                  url: "drive://notes/paul-1132.md" },
    ]},
  { k: "caption", l: "Caption + copy", tone: "",
    items: [
      { label: "Caption doc · draft v2",                    url: "drive://caption-v2.docx" },
      { label: "Hashtag set · Instagram Nepal travel",      url: "drive://hashtags.md" },
    ]},
  { k: "music",   l: "Music",         tone: "",
    items: [
      { label: "Drum hit cue 3 · Soundstripe",              url: "https://soundstripe.com/cue3" },
      { label: "Backup track · 'Ngor monastery'",           url: "https://soundstripe.com/ngor" },
    ]},
];

function GroupedAttachments() {
  return (
    <Card title="Attachments · grouped by source"
          right={<span className="count-tag">{ATTACH_GROUPS.reduce((n, g) => n + g.items.length, 0)} links</span>}
          footLeft="Native to reel production · click to open">
      <div className="att-groups">
        {ATTACH_GROUPS.map(g => (
          <div key={g.k} className={"att-group " + (g.tone || "")}>
            <div className="att-h">
              <span className="att-name">{g.l}</span>
              <span className="count-tag">{g.items.length}</span>
            </div>
            <div className="att-list">
              {g.items.map((it, i) => (
                <a key={i} className="att-item" href={it.url} onClick={e => e.preventDefault()}>
                  <span className="ic">↗</span>
                  <span className="lbl">{it.label}</span>
                </a>
              ))}
              <div className="att-add">+ attach to {g.l}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- Ready-for-review state transition ----------
   Controlled — parent owns the stage, passes onStageChange. */
function ReadyForReview({ stage, onStageChange }) {
  const setStage = onStageChange;
  const stages = [
    { k: "editing",       l: "Editing",        sub: "Main edit in progress" },
    { k: "review-ready",  l: "Review ready",   sub: "Locked · awaiting owner pickup" },
    { k: "in-review",     l: "In review",      sub: "Owner viewing now" },
    { k: "approved",      l: "Approved",       sub: "Cleared · handoff opens" },
  ];
  const idx = stages.findIndex(s => s.k === stage);

  return (
    <Card title="Review state · transition control"
          right={<Pill tone={idx === 3 ? "ok" : idx === 2 ? "cyan" : "warn"}>{stages[idx].l}</Pill>}
          footLeft="Explicit handoff — no ambiguous 'is it done?'">
      <div className="rfr-bar">
        {stages.map((s, i) => (
          <div key={s.k} className={"rfr-step " + (i <= idx ? "active " : "") + (i === idx ? "now" : "")}
               onClick={() => setStage(s.k)}>
            <div className="rfr-dot">{i + 1}</div>
            <div className="rfr-l">{s.l}</div>
            <div className="rfr-s">{s.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {idx < stages.length - 1 && (
          <DPill primary onClick={() => setStage(stages[idx + 1].k)}>
            Advance · {stages[idx + 1].l}
          </DPill>
        )}
        {idx > 0 && <DPill onClick={() => setStage(stages[idx - 1].k)}>← back</DPill>}
        <DPill solid>Send back with notes</DPill>
      </div>
    </Card>
  );
}

export {
  HandoffPackage, AllowedChanges, GroupedAttachments, ReadyForReview,
  HANDOFF_REQS, DEFAULT_ALLOWED, DEFAULT_NOTOUCH,
};
