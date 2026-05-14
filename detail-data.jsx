/* =========================================================
   Reel Detail — 2-panel layout (left = sources/deps/log,
   center = blueprint + roadmap + checklist + tasks + variants)
   ========================================================= */

import React from "react";

const FOOTAGE = [
  { id: "DJI_0214", tc: "00:42–00:50", desc: "Crowd surge wide opener candidate." },
  { id: "DJI_0218", tc: "01:12–01:18", desc: "Low push-in with bell ring energy." },
  { id: "A7IV_0331", tc: "02:01–02:11", desc: "Bell ringer face close-up." },
  { id: "A7IV_0334", tc: "04:55–05:03", desc: "Prayer flags wipe transition." },
  { id: "DJI_0221", tc: "06:32–06:40", desc: "Reverse drone reveal of square." },
  { id: "A7IV_0341", tc: "08:11–08:20", desc: "Crowd reaction — secondary B-roll." },
];

const EVENTS = [
  { t: "11:05", body: <><b>System</b> entered MAIN EDIT.</> },
  { t: "11:42", body: <><b>Judy A</b> uploaded cut v3.mp4.</> },
  { t: "09:18", body: <><b>Paul V</b> commented "open on bell crowd surge."</> },
  { t: "10:04", body: <><b>Judy A</b> posted hook A/B and pinged owner.</> },
  { t: "10:48", body: <><b>System</b> opened blocker on hook decision.</> },
  { t: "08:30", body: <><b>FootageBrain</b> attached 4 new selects via semantic search.</> },
  { t: "yest 17:11", body: <><b>Paul V</b> set music bed to "drum hit cue 3".</> },
];

const COMMENTS = [
  { who: "PV", role: "Paul V",  ts: "11:08", txt: "Opening frame feels soft. Try bell ring crowd surge as the first beat." },
  { who: "JA", role: "Judy A",  ts: "11:14", txt: "A/B hooks attached. Need a pick before 14:00 to stay on the post window." },
  { who: "PV", role: "Paul V",  ts: "11:32", txt: "Music drop at 00:08 is the moment. Cut to face on that hit." },
  { who: "JY", role: "Jay",     ts: "11:51", txt: "Once hook is locked I'll start the 5 variants. Brief is otherwise clear." },
];

const INIT_TASKS = [
  { audience: "owner", type: "Decision", assignee: "Paul V",
    instruction: "Pick hook A or B so variants can start.",
    due: "14:00", status: "open · 3h SLA" },
  { audience: "variant", type: "Variant pack", assignee: "Jay",
    instruction: "Once hook is locked, package 5 variants per the variant readiness list.",
    due: "tomorrow", status: "queued — needs upstream" },
  { audience: "pv", type: "Caption review", assignee: "Leroy C",
    instruction: "Verify caption style after hook pick.",
    status: "queued" },
];

const VARIANT_TYPES = [
  { key: "caption", label: "Text caption change" },
  { key: "audio",   label: "Audio hook change" },
  { key: "altclip", label: "Alternative starting hook clip" },
  { key: "other",   label: "Other (type your own)" },
];

const DETAIL_STAGES = [
  { key: "discovery", label: "DISCOVERY", meta1: "Judy A",  meta2: "yesterday 14:20" },
  { key: "selected",  label: "SELECTED",  meta1: "Paul V",  meta2: "yesterday 16:40" },
  { key: "main",      label: "MAIN EDIT", meta1: "Judy A",  meta2: "started 11:05 · active" },
  { key: "review",    label: "REVIEW",    meta1: "PV next", meta2: "starts on handoff" },
  { key: "variants",  label: "VARIANTS",  meta1: "Jay",     meta2: "5 variants" },
  { key: "ready",     label: "READY",     meta1: "Queued for post" },
  { key: "posted",    label: "POSTED",    meta1: "Analytics track" },
];

export { FOOTAGE, EVENTS, COMMENTS, INIT_TASKS, VARIANT_TYPES, DETAIL_STAGES };
