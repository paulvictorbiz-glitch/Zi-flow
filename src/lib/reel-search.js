/* Global reel search — the single matcher behind the top-right search box
   (classic topbar + Solarin nav) and the mobile "More" sheet. Lived as three
   drifting copies before; they all read `reel.display_number`, which store.jsx
   never emits (reelFromDb renames it to `displayNumber`), so searching by the
   number the UI actually shows silently fell through to the raw id. */

/* The number as List view prints it — mirrors fmtId() in pages/list-view.jsx. */
function paddedNumber(reel) {
  return reel.displayNumber != null
    ? String(reel.displayNumber).padStart(3, "0")
    : "";
}

/* Left-hand label in a result row: "#42" when the reel has been numbered,
   else the raw id. */
export function reelSearchLabel(reel) {
  return reel.displayNumber != null ? "#" + reel.displayNumber : reel.id;
}

/* Filter reels by title, number, logline, or the shot plan (so a clip filename
   in the script finds its reel too). Empty query = no results, not everything. */
export function searchReels(reels, query, limit = 8) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  return (reels || [])
    .filter(r => !r.archivedAt && (
      (r.title   || "").toLowerCase().includes(q) ||
      (r.logline || "").toLowerCase().includes(q) ||
      (r.script  || "").toLowerCase().includes(q) ||
      /* Number forms: bare ("42"), zero-padded as displayed ("042"), and the
         underlying id ("REEL-207") — typing any of them should hit. */
      String(r.displayNumber ?? "").toLowerCase().includes(q) ||
      paddedNumber(r).includes(q) ||
      String(r.id ?? "").toLowerCase().includes(q)
    ))
    .slice(0, limit);
}
