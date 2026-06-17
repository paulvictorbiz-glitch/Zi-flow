/* =========================================================
   widgets — L1 PURE data-shaping for the cube tiles + detail panel.

   NO React, NO hooks, NO store imports. L2 (space3d.jsx) reads the
   live store ONCE (read-only) and hands a plain snapshot here. This
   keeps all store access in one place and guarantees the cube never
   writes.

   snapshot shape (all optional, defensively read):
     { reels, reviewLaneCards, tasks, dailyTasks, reelDna,
       attachedFootage, moduleContent, gamifyProgress,   // useWorkflow()
       locations,                                          // useLocations()
       connections }                                       // social count
   ========================================================= */

const n = (v) => (Array.isArray(v) ? v.length : 0);

function countStage(reels, stage) {
  if (!Array.isArray(reels)) return 0;
  return reels.filter(r => r && r.stage === stage).length;
}

/* group reels by stage → bar data, in a sensible pipeline order */
function stageBars(reels) {
  const order = ["idea", "script", "shoot", "edit", "review", "done", "posted"];
  const counts = {};
  (reels || []).forEach(r => {
    const s = (r && r.stage) || "other";
    counts[s] = (counts[s] || 0) + 1;
  });
  const keys = order.filter(k => counts[k]);
  Object.keys(counts).forEach(k => { if (!keys.includes(k)) keys.push(k); });
  return keys.map(k => ({ label: k, value: counts[k] }));
}

/* group locations by category → bar data */
function locationBars(locations) {
  const counts = {};
  (locations || []).forEach(l => {
    const c = (l && l.category) || "uncategorised";
    counts[c] = (counts[c] || 0) + 1;
  });
  return Object.keys(counts).slice(0, 6).map(k => ({ label: k, value: counts[k] }));
}

/* Short tile metric (one line). */
export function pageMetric(key, s = {}) {
  const reels = s.reels || [];
  switch (key) {
    case "mywork":   return (n(s.reviewLaneCards) || countStage(reels, "review")) + " in review";
    case "activity": return n(s.tasks) + " tasks";
    case "training": return n(s.moduleContent) + " modules";
    case "analytics":return (s.connections || 0) + " platforms";
    case "inbox":    return (s.connections || 0) + " connected";
    case "monitor":  return "live";
    case "pipeline": return n(reels) + " reels";
    case "generate": return "AI ready";
    case "reeldna":  return n(s.reelDna) + " genomes";
    case "footage":  return n(s.attachedFootage) + " clips";
    case "editor":   return countStage(reels, "edit") + " editing";
    case "lossless": return "ready";
    case "export":   return countStage(reels, "done") + " done";
    case "coverage": return n(reels) + " tracked";
    case "locations":return n(s.locations) + " pins";
    case "news":     return "soon";
    case "algo":     return "soon";
    default:         return "";
  }
}

export function buildMetrics(pageKeys, snapshot) {
  const out = {};
  (pageKeys || []).forEach(k => { out[k] = pageMetric(k, snapshot); });
  return out;
}

/* Rich detail: a one-line summary, a few key stats, and bar data for a
   tiny chart. Returns { summary, stats:[{label,value}], bars:[{label,value}] }. */
export function pageDetail(key, s = {}) {
  const reels = s.reels || [];
  const total = n(reels);
  const inReview = n(s.reviewLaneCards) || countStage(reels, "review");
  const done = countStage(reels, "done");

  const reelCentric = (summary) => ({
    summary,
    stats: [
      { label: "Total reels", value: total },
      { label: "In review", value: inReview },
      { label: "Done", value: done },
    ],
    bars: stageBars(reels),
  });

  switch (key) {
    case "mywork":
      return {
        summary: "What needs you now — your review queue and assigned work.",
        stats: [
          { label: "In review", value: inReview },
          { label: "Open tasks", value: n(s.tasks) },
          { label: "Today", value: n(s.dailyTasks) },
        ],
        bars: stageBars(reels),
      };
    case "pipeline": return reelCentric("Every reel by stage, end to end.");
    case "editor":   return reelCentric("Reels currently in the edit bay.");
    case "export":   return reelCentric("Finished reels ready to deliver.");
    case "coverage": return reelCentric("Shot coverage across all reels.");
    case "generate":
      return { summary: "AI concept & script generation.", stats: [{ label: "Reels", value: total }, { label: "Genomes", value: n(s.reelDna) }], bars: stageBars(reels) };
    case "reeldna":
      return { summary: "Reverse-engineer any reel into its genes.", stats: [{ label: "Genomes", value: n(s.reelDna) }, { label: "Reels", value: total }], bars: [{ label: "genomes", value: n(s.reelDna) }, { label: "reels", value: total }] };
    case "footage":
      return { summary: "Browse and tag the clip library.", stats: [{ label: "Clips", value: n(s.attachedFootage) }, { label: "Reels", value: total }], bars: [{ label: "clips", value: n(s.attachedFootage) }, { label: "reels", value: total }] };
    case "activity":
      return { summary: "The live feed of everything happening.", stats: [{ label: "Tasks", value: n(s.tasks) }, { label: "Today", value: n(s.dailyTasks) }], bars: [{ label: "tasks", value: n(s.tasks) }, { label: "today", value: n(s.dailyTasks) }] };
    case "training":
      return { summary: "Skill modules and gamified progress.", stats: [{ label: "Modules", value: n(s.moduleContent) }], bars: [{ label: "modules", value: n(s.moduleContent) }] };
    case "locations":
      return { summary: "Pins on the map for every place.", stats: [{ label: "Pins", value: n(s.locations) }, { label: "Categories", value: locationBars(s.locations).length }], bars: locationBars(s.locations) };
    case "analytics":
    case "inbox":
    case "monitor":
      return { summary: "Reach, engagement and conversations across platforms.", stats: [{ label: "Connected", value: s.connections || 0 }, { label: "Platforms", value: 4 }], bars: [{ label: "connected", value: s.connections || 0 }, { label: "available", value: 4 }] };
    case "news":
    case "algo":
      return { summary: "Platform algorithm shifts and trend signals. Coming soon.", stats: [], bars: [] };
    default:
      return { summary: "", stats: [], bars: [] };
  }
}
