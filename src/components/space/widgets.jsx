/* =========================================================
   widgets — L1 PURE data-shaping for the cube tiles/detail.

   NO React, NO hooks, NO store imports. L2 (space3d.jsx) reads the
   live store ONCE (read-only) and hands a plain snapshot here; these
   helpers turn it into a short headline metric per page. This keeps
   all store access in one place and guarantees the cube never writes.

   snapshot shape (all optional, defensively read):
     {
       reels, reviewLaneCards, tasks, dailyTasks, reelDna,
       attachedFootage, moduleContent, gamifyProgress,   // from useWorkflow()
       locations,                                          // from useLocations()
       connections,                                        // social connection count
     }
   ========================================================= */

const n = (v) => (Array.isArray(v) ? v.length : 0);

function countStage(reels, stage) {
  if (!Array.isArray(reels)) return 0;
  return reels.filter(r => r && r.stage === stage).length;
}

/* Returns a short string metric for a page key, or "" if none. */
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

/* Build a { [pageKey]: metricString } map for an array of page keys. */
export function buildMetrics(pageKeys, snapshot) {
  const out = {};
  (pageKeys || []).forEach(k => { out[k] = pageMetric(k, snapshot); });
  return out;
}
