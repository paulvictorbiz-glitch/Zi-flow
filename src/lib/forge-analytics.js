/* Content Forge — client-side analytics aggregation.

   Pure functions over the already-loaded `content_opportunities` rows (the same
   array the Content Forge page holds in state). NO network, NO LLM, NO SQL — the
   full batch (~2.6k opps) is small enough to group in the browser on every render.

   Theme tags (danger / food / facts / culture / nature) are KEYWORD matches over
   each opportunity's title + topics + keywords — approximate (±a few %) and
   non-exclusive, NOT the model's own classification. This mirrors the one-off
   dashboard artifact so the numbers line up. Surface the caveat in the UI. */

export const TIER_ORDER = ["S", "A", "B", "C"];

export const THEME_KEYWORDS = {
  danger: ["danger", "war", "conflict", "attack", "bomb", "military", "weapon", "violence", "protest", "crisis", "refugee", "soldier", "gun", "fight", "destroy", "kill", "death", "escape", "survive", "risk", "arrest", "police", "riot", "terror"],
  food: ["food", "eat", "meal", "dish", "cook", "restaurant", "street food", "cuisine", "taste", "snack", "market food", "breakfast", "lunch", "dinner", "spicy", "delicious", "hungry", "drink", "coffee"],
  facts: ["fact", "did you know", "history", "ancient", "surprising", "secret", "reveal", "truth", "actually", "explained", "reason why", "how", "why"],
  culture: ["culture", "tradition", "festival", "religion", "temple", "ritual", "custom", "local", "ceremony", "dance", "music", "art", "heritage"],
  nature: ["nature", "mountain", "beach", "ocean", "forest", "wildlife", "animal", "landscape", "waterfall", "river", "scenery", "sunset", "island", "desert", "jungle", "lake"],
};

export const THEME_LABEL = {
  danger: "Danger / conflict",
  facts: "Facts",
  nature: "Nature",
  culture: "Culture",
  food: "Food",
};

// Folders that are gear / b-roll, not geographic places — excluded from country stats.
const GEAR_LABELS = new Set(["osmo", "camera", "gopro", "drone", "footage", ""]);

const norm = (s) => (s == null ? "" : String(s).trim());
const lc = (s) => norm(s).toLowerCase();
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const tierOf = (o) => {
  const t = norm(o.virality_tier).toUpperCase();
  return TIER_ORDER.includes(t) ? t : "C";
};

export function classifyThemes(o) {
  const hay = lc([o.title, (o.topics || []).join(" "), (o.keywords || []).join(" ")].join(" "));
  const hits = [];
  for (const [t, kws] of Object.entries(THEME_KEYWORDS)) {
    if (kws.some((k) => hay.includes(k))) hits.push(t);
  }
  return hits;
}

function emptyTierRec(extra) {
  return { total: 0, S: 0, A: 0, B: 0, C: 0, ...extra };
}
function withRates(rec) {
  const sa = rec.total ? ((rec.S + rec.A) / rec.total) * 100 : 0;
  const s = rec.total ? (rec.S / rec.total) * 100 : 0;
  return { ...rec, saPct: +sa.toFixed(1), sPct: +s.toFixed(1) };
}

/* Aggregate a set of opportunity rows into the analytics view model.
   Returns null-safe zeros for an empty input so the UI never divides by zero. */
export function aggregateOpps(opps) {
  const rows = Array.isArray(opps) ? opps : [];
  const total = rows.length;

  const tier = emptyTierRec();
  const countryMap = new Map();
  const themeMap = {};
  for (const t of Object.keys(THEME_KEYWORDS)) themeMap[t] = emptyTierRec({ theme: t, label: THEME_LABEL[t] || cap(t) });
  let themeUntagged = 0;
  let favCount = 0;

  for (const o of rows) {
    const t = tierOf(o);
    tier.total += 1;
    tier[t] += 1;
    if (o.favorite) favCount += 1;

    // country (case-merged), gear folders dropped
    const cKey = lc(o.country);
    if (!GEAR_LABELS.has(cKey)) {
      let rec = countryMap.get(cKey);
      if (!rec) { rec = emptyTierRec({ label: cap(cKey) }); countryMap.set(cKey, rec); }
      rec.total += 1;
      rec[t] += 1;
    }

    // themes (keyword, non-exclusive)
    const themes = classifyThemes(o);
    if (!themes.length) themeUntagged += 1;
    for (const th of themes) {
      const rec = themeMap[th];
      rec.total += 1;
      rec[t] += 1;
    }
  }

  const baseSA = total ? +(((tier.S + tier.A) / total) * 100).toFixed(1) : 0;
  const baseS = total ? +((tier.S / total) * 100).toFixed(1) : 0;

  const countries = [...countryMap.values()].map(withRates).sort((a, b) => b.total - a.total);
  const themes = Object.values(themeMap).map(withRates).sort((a, b) => b.total - a.total);

  const tierPct = TIER_ORDER.map((t) => ({
    tier: t,
    count: tier[t],
    pct: total ? +((tier[t] / total) * 100).toFixed(1) : 0,
  }));

  return {
    total,
    tier,
    tierPct,
    baseSA,
    baseS,
    favCount,
    countries,
    themes,
    themeUntagged,
    countryCount: countries.length,
  };
}
