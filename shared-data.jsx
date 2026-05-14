/* =========================================================
   Canonical operational dataset.

   Step 1 of the build-out collapsed the two prior parallel
   datasets (`REELS` in pipeline.jsx + `REELS_FULL` here) into a
   single source of truth named `REELS`. Every surface — pipeline
   board, list, calendar, my-work, export — now reads from this
   array. Pipeline-only visual fields (`note`, `foot`, `tone`,
   `links`, `status`, `lane`) live on the same records as the
   operational fields (`owner`, `stage`, `state`, `age`, ...).

   `REVIEW_LANE_CARDS` is intentionally small and separate — those
   are Maya's reviewer-pass "shadow" cards that exist only as
   projections on the pipeline board. They are not standalone
   reels, so list/my-work/calendar must NOT include them.
   ========================================================= */

/* ---------- People + roles ---------- */
const PEOPLE = {
  paul:  { id: "paul",  name: "Paul Victor",  short: "Paul V",  role: "owner",   avatar: "PV", tone: "amber"  },
  alex:  { id: "alex",  name: "Judy Adawag",  short: "Judy A",  role: "skilled", avatar: "JA", tone: "cyan"   },
  sam:   { id: "sam",   name: "Jay",          short: "Jay",     role: "variant", avatar: "JY", tone: "violet" },
  maya:  { id: "maya",  name: "Leroy Crosby", short: "Leroy C", role: "reviewer",avatar: "LC", tone: "green"  },
};

const ROLES = {
  owner:    { label: "Owner / Creative Director", short: "Owner",    person: "paul" },
  skilled:  { label: "Skilled Editor",            short: "Skilled",  person: "alex" },
  variant:  { label: "Variant Editor",            short: "Variant",  person: "sam"  },
};

/* ---------- Canonical reel dataset ----------
   Each row carries operational signal AND the visual extras the
   pipeline board needs. Fields:

   Core operational:
     id, title, stage, owner, state, age, due,
     fb, refs, blocker, blockerRole, next, downstream,
     grouping, variantProgress

   Pipeline-visual (optional):
     note      — short caption rendered inside the board card
     foot      — bottom-strip label on the board card
     tone      — pill colour fallback when state isn't set
     links     — clickable refs inside the board card
     status    — overrides `age` for the board card pill, when
                 the board needs a different phrasing (e.g.
                 "post 2h" instead of the canonical "scheduled")
     lane      — board lane override; defaults to `owner`
*/
const REELS = [
  /* ---- IDEA / SELECTED ---- */
  { id: "IDEA-088", title: "Temple bell close-up",
    stage: "idea",     owner: "alex", state: "ok",
    age: "3d",         due: null,
    fb: 4, refs: 1,
    blocker: null,
    next: "Pull selects and write logline",
    downstream: null,
    grouping: "not_started",
    note: "4 selects already pulled from FootageBrain.",
    foot: "Discovery", tone: "cyan" },

  { id: "IDEA-091", title: "River ghat crowd",
    stage: "idea",     owner: "alex", state: "warn",
    age: "1d",         due: null,
    fb: 0, refs: 2,
    blocker: "Needs FootageBrain pull",
    next: "Run semantic search · ghat crowd",
    downstream: null,
    grouping: "not_started",
    foot: "Triage queue", tone: "cyan" },

  { id: "IDEA-079", title: "Market vendor smile",
    stage: "idea",     owner: "paul", state: "warn",
    age: "11d",        due: null,
    fb: 0, refs: 0,
    blocker: "Stale — owner triage",
    next: "Triage: kill, defer, or greenlight",
    downstream: null,
    grouping: "not_started",
    foot: "Stale — triage", tone: "warn" },

  { id: "REEL-204", title: "Kathmandu chaos",
    stage: "selected", owner: "alex", state: "ok",
    age: "queued 4h",  due: "Thu 17:00",
    fb: 12, refs: 3,
    blocker: null,
    next: "Start main edit",
    downstream: "Jay variant slot · Fri 09:00",
    grouping: "not_started",
    note: "12 Labs pull attached · ready for main edit.",
    foot: "0/5 variants", tone: "cyan" },

  /* ---- MAIN EDIT ---- */
  { id: "REEL-201", title: "Temple crowd sequence",
    stage: "main",     owner: "alex", state: "warn",
    age: "6h 28m",     due: "today 14:00",
    fb: 8, refs: 4,
    blocker: "Waiting on owner hook decision A/B",
    blockerRole: "owner",
    next: "Ping Paul for hook pick",
    downstream: "Variant lane idle risk · 3h 20m",
    grouping: "in_progress",
    note: "Blocked by owner hook decision. 8 selects attached.",
    foot: "Needs decision", tone: "warn" },

  { id: "REEL-198", title: "Boudha kora walk",
    stage: "main",     owner: "alex", state: "block",
    age: "19h over",   due: "yest 17:00",
    fb: 6, refs: 2,
    blocker: "Hook A/B unresolved · main overrun",
    blockerRole: "owner",
    next: "Escalate hook call",
    downstream: "Friday post window slips +1d",
    grouping: "in_progress",
    note: "Hook A/B unresolved. Music choice locked.",
    foot: "Main edit overrun", tone: "block" },

  { id: "REEL-206", title: "Street food smoke",
    stage: "main",     owner: "alex", state: "ok",
    age: "on track",   due: "today 22:00",
    fb: 9, refs: 5,
    blocker: null,
    next: "Lock music bed",
    downstream: null,
    grouping: "in_progress",
    foot: "On schedule", tone: "cyan",
    status: "22h left" },

  /* ---- REVIEW ---- */
  { id: "REEL-195", title: "Sunrise prayer flags",
    stage: "review",   owner: "paul", state: "warn",
    age: "3h 10m wait", due: "today 18:00",
    fb: 5, refs: 3,
    blocker: "Awaiting owner approval + handoff notes",
    blockerRole: "owner",
    next: "Approve or send back",
    downstream: "Caption pass queued for Leroy",
    grouping: "in_progress",
    note: "Export v3 attached. Needs approval + handoff notes.",
    links: ["frame.io / review", "drive / source"],
    foot: "Review queue", tone: "warn" },

  { id: "REEL-192", title: "Old Patan alleys",
    stage: "review",   owner: "paul", state: "block",
    age: "28h wait",   due: "yest 14:00",
    fb: 7, refs: 4,
    blocker: "Review SLA breached · downstream blocked",
    blockerRole: "owner",
    next: "Sign off — variant lane idle",
    downstream: "Jay idle now · Friday slot at risk",
    grouping: "in_progress",
    note: "Downstream blocked. Variant lane idle risk.",
    links: ["frame.io / review", "ig / draft"],
    foot: "SLA breached", tone: "block" },

  /* ---- VARIANTS ---- */
  { id: "REEL-180", title: "Himalaya flyover · 5-var pack",
    stage: "variants", owner: "sam",  state: "ok",
    age: "22h left",   due: "Fri 12:00",
    fb: 0, refs: 6,
    blocker: null,
    next: "Package variants C, D, E",
    downstream: "Ready bucket · Fri 14:00",
    grouping: "in_progress",
    variantProgress: { done: 2, total: 5 },
    note: "2/5 done. Main + brief attached.",
    links: ["drive / source set", "captions doc"],
    foot: "Packaging", tone: "cyan" },

  { id: "REEL-175", title: "Pashupati monks · variants",
    stage: "variants", owner: "sam",  state: "warn",
    age: "idle 3h",    due: "Sat 18:00",
    fb: 0, refs: 2,
    blocker: "Awaiting brief from Judy",
    blockerRole: "skilled",
    next: "Ping Judy for variant brief",
    downstream: null,
    grouping: "in_progress",
    variantProgress: { done: 0, total: 5 },
    note: "Awaiting brief from Judy.",
    foot: "Waiting on brief", tone: "warn" },

  /* ---- READY ---- */
  { id: "REEL-188", title: "Lalitpur dusk",
    stage: "ready",    owner: "paul", state: "ok",
    age: "scheduled",  due: "today 18:00",
    fb: 0, refs: 2,
    blocker: null,
    next: "Confirm caption",
    downstream: null,
    grouping: "in_progress",
    foot: "Scheduled 18:00", tone: "ok",
    status: "post 2h" },

  { id: "REEL-178", title: "Annapurna teaser",
    stage: "ready",    owner: "paul", state: "ok",
    age: "scheduled",  due: "tomorrow 09:00",
    fb: 0, refs: 3,
    blocker: null,
    next: "Hold for post window",
    downstream: null,
    grouping: "in_progress",
    foot: "Held for window", tone: "cyan",
    status: "tmrw 9am" },

  { id: "REEL-170", title: "Boudha drone — 5-var pack",
    stage: "ready",    owner: "sam",  state: "ok",
    age: "scheduled",  due: "today 22:00",
    fb: 0, refs: 5,
    blocker: null,
    next: "Confirm export bundle",
    downstream: null,
    grouping: "completed",
    variantProgress: { done: 5, total: 5 },
    note: "All 5 variants packaged. Captions reviewed.",
    foot: "Scheduled 22:00", tone: "ok",
    status: "post 6h" },

  /* ---- POSTED ---- */
  { id: "REEL-166", title: "Pashupati monks at dawn",
    stage: "posted",   owner: "paul", state: "ok",
    age: "12d ago",    due: null,
    fb: 0, refs: 0,
    blocker: null,
    next: "Analytics review",
    downstream: null,
    grouping: "completed" },

  { id: "REEL-161", title: "Patan square crowd",
    stage: "posted",   owner: "paul", state: "ok",
    age: "16d ago",    due: null,
    fb: 0, refs: 0,
    blocker: null,
    next: "Analytics review",
    downstream: null,
    grouping: "completed" },
];

/* ---------- Pipeline-only reviewer-lane shadow cards ----------
   These are Maya's caption-pass projections of two paul-owned
   reels. They appear ONLY on the pipeline board (lane: "review").
   They are NOT canonical reels — list/my-work/calendar exclude
   them. `parentId` points back at the real reel.
*/
const REVIEW_LANE_CARDS = [
  { id: "REEL-195-RV", parentId: "REEL-195",
    title: "Sunrise prayer flags · caption pass",
    stage: "review", lane: "review", owner: "maya", state: "ok",
    note: "Sub-review for captions. Routes back to Paul on close.",
    foot: "Reviewing", tone: "cyan", status: "1h 10m" },

  { id: "REEL-188-RV", parentId: "REEL-188",
    title: "Lalitpur dusk · final caption",
    stage: "ready",  lane: "review", owner: "maya", state: "ok",
    foot: "Closed 10:42", tone: "ok", status: "cleared" },
];

/* ---------- Tasks (lightweight requests across reels) ---------- */
const TASKS_FULL = [
  { id: "T-301", from: "alex", to: "paul",
    type: "Decision",      reel: "REEL-201",
    instruction: "Pick hook A vs B for temple crowd sequence",
    due: "today 14:00", state: "open · 3h SLA" },
  { id: "T-302", from: "alex", to: "sam",
    type: "Variant pack",  reel: "REEL-201",
    instruction: "Package 5 variants once hook is locked",
    due: "Fri 12:00",  state: "queued" },
  { id: "T-303", from: "paul", to: "maya",
    type: "Caption review",reel: "REEL-195",
    instruction: "Verify caption style on prayer flags cut",
    due: "today 18:00",state: "open" },
  { id: "T-304", from: "alex", to: "paul",
    type: "Source upload", reel: "REEL-198",
    instruction: "Upload remaining drone source from Boudha shoot",
    due: "today",      state: "open" },
  { id: "T-305", from: "sam",  to: "alex",
    type: "Brief",         reel: "REEL-175",
    instruction: "Need allowed-changes for Pashupati variants",
    due: "today",      state: "open" },
  { id: "T-306", from: "paul", to: "alex",
    type: "Thumbnail",     reel: "REEL-188",
    instruction: "Pick thumbnail frame for Lalitpur dusk",
    due: "today 17:30",state: "open" },
];

/* ---------- Stage labels ---------- */
const STAGE_LABEL = {
  idea: "Idea pool",  selected: "Selected", main: "Main edit",
  review: "Review",   variants: "Variants", ready: "Ready",   posted: "Posted",
};

const STAGE_TONE = {
  idea: "cyan", selected: "cyan", main: "warn",
  review: "block", variants: "cyan", ready: "ok", posted: "ok",
};

/* ---------- Calendar seed (week of May 13–19, 2026) ---------- */
const CAL_WEEK = [
  { date: "Mon May 13", label: "Mon", n: 13 },
  { date: "Tue May 14", label: "Tue", n: 14 },
  { date: "Wed May 15", label: "Wed", n: 15 },
  { date: "Thu May 16", label: "Thu", n: 16 },
  { date: "Fri May 17", label: "Fri", n: 17 },
  { date: "Sat May 18", label: "Sat", n: 18 },
  { date: "Sun May 19", label: "Sun", n: 19 },
];

/* Calendar items: each is anchored to a day-of-week (0=Mon) */
const CAL_ITEMS = [
  { dow: 0, t: "14:00", kind: "decision", reel: "REEL-201", title: "Hook A/B decision",       owner: "paul",  tone: "warn"  },
  { dow: 0, t: "17:00", kind: "review",   reel: "REEL-195", title: "Review · prayer flags",    owner: "paul",  tone: "warn"  },
  { dow: 0, t: "18:00", kind: "post",     reel: "REEL-188", title: "Post · Lalitpur dusk",      owner: "paul",  tone: "ok"    },
  { dow: 0, t: "22:00", kind: "post",     reel: "REEL-170", title: "Post · Boudha drone",       owner: "sam",   tone: "ok"    },
  { dow: 1, t: "09:00", kind: "post",     reel: "REEL-178", title: "Post · Annapurna teaser",   owner: "paul",  tone: "cyan"  },
  { dow: 1, t: "12:00", kind: "review",   reel: "REEL-206", title: "Review · street food",      owner: "paul",  tone: "cyan"  },
  { dow: 1, t: "17:00", kind: "handoff",  reel: "REEL-201", title: "Handoff · variant brief",   owner: "paul",  tone: "cyan"  },
  { dow: 2, t: "10:00", kind: "variant",  reel: "REEL-201", title: "Variants begin",            owner: "sam",   tone: "cyan"  },
  { dow: 2, t: "15:00", kind: "review",   reel: "REEL-192", title: "Re-review · Patan alleys",  owner: "paul",  tone: "block" },
  { dow: 3, t: "12:00", kind: "variant",  reel: "REEL-180", title: "Variants due · flyover",    owner: "sam",   tone: "warn"  },
  { dow: 3, t: "18:00", kind: "post",     reel: "REEL-180", title: "Post · Himalaya flyover",   owner: "paul",  tone: "cyan"  },
  { dow: 4, t: "11:00", kind: "post",     reel: "REEL-204", title: "Post · Kathmandu chaos",    owner: "paul",  tone: "cyan"  },
  { dow: 5, t: "18:00", kind: "variant",  reel: "REEL-175", title: "Variants due · Pashupati",  owner: "sam",   tone: "warn"  },
];

/* ---------- Export-ready rows (Planable-shaped) ---------- */
const EXPORT_ROWS = [
  { id: "REEL-188", title: "Lalitpur dusk",
    caption: "When the sun drops behind Patan's temples, the city breathes out for a minute.\n\n#kathmandu #patan #goldenhour",
    media: "exports/reel-188-final-1080x1920.mp4", mediaSize: "42 MB",
    platform: "Instagram · @studio.kathmandu",
    date: "2026-05-13", time: "18:00",
    status: "ready", notes: "First post of the day · winner hook." },
  { id: "REEL-170", title: "Boudha drone · 5-var pack",
    caption: "Sunrise over Boudha. Five takes, one stupa.\n\n#boudha #drone #nepal",
    media: "exports/reel-170-var-A.mp4", mediaSize: "38 MB",
    platform: "Instagram · @studio.kathmandu",
    date: "2026-05-13", time: "22:00",
    status: "ready", notes: "Variant A locked · B/C/D/E in folder for retest." },
  { id: "REEL-178", title: "Annapurna teaser",
    caption: "Trail teaser for next month's series. Full reel drops Friday.\n\n#annapurna #trekking",
    media: "exports/reel-178-teaser.mp4", mediaSize: "31 MB",
    platform: "Instagram · @studio.kathmandu",
    date: "2026-05-14", time: "09:00",
    status: "needs-caption", notes: "Caption draft needs Maya's pass before export." },
  { id: "REEL-204", title: "Kathmandu chaos",
    caption: "",
    media: "—", mediaSize: "—",
    platform: "Instagram · @studio.kathmandu",
    date: "2026-05-16", time: "11:00",
    status: "blocked", notes: "Awaiting main edit handoff. Caption + media pending." },
  { id: "REEL-180", title: "Himalaya flyover · winner",
    caption: "The Himalayas don't pose. They just sit there being themselves.\n\n#himalayas #nepal #flyover",
    media: "exports/reel-180-var-A.mp4", mediaSize: "44 MB",
    platform: "Instagram · @studio.kathmandu",
    date: "2026-05-16", time: "18:00",
    status: "ready", notes: "Winner variant A · save as repeatable hook template." },
];

export {
  PEOPLE, ROLES,
  REELS, REVIEW_LANE_CARDS, TASKS_FULL,
  STAGE_LABEL, STAGE_TONE,
  CAL_WEEK, CAL_ITEMS, EXPORT_ROWS,
};
