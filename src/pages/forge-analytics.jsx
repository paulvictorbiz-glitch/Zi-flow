/* Content Forge — Analytics view.

   A free, owner-only analytics surface that lives UNDER the Content Forge page
   (toggled from its header). Purely CLIENT-SIDE: it aggregates the opportunity
   rows already loaded by the page — no extra Supabase reads, no LLM, no cost.
   Re-computes live as discovery adds rows.

   Charts: tier split, theme→quality (the headline correlation), and country
   volume vs quality. Mirrors the one-off dashboard artifact so the numbers line
   up. IG predicted-vs-actual is deferred until reels start posting. */

import React, { useMemo } from "react";
import { aggregateOpps } from "../lib/forge-analytics.js";
import "../forge-analytics.css";

const MIN_COUNTRY = 20; // quality ranking needs a real sample
const TOP_N = 12;

function pct(n) {
  return `${(+n).toFixed(1)}%`;
}

function Bars({ rows, metric, max, valueFmt, subFmt, baseline, threshold }) {
  return (
    <div className="fa-plot">
      {baseline != null && max > 0 && (
        <div
          className="fa-baseline"
          style={{ left: `calc(var(--fa-labelw) + (100% - var(--fa-labelw)) * ${(baseline / max).toFixed(4)})` }}
        >
          <span className="fa-baseline-lab">baseline {pct(baseline)}</span>
        </div>
      )}
      {rows.map((r) => {
        const v = metric(r);
        const w = max > 0 ? Math.max(1.5, (v / max) * 100) : 0;
        const above = threshold == null ? true : r.saPct >= threshold;
        return (
          <div className="fa-row" key={r.label}>
            <div className="fa-name" title={r.label}>
              {r.label}
              {subFmt && <span className="fa-sub">{subFmt(r)}</span>}
            </div>
            <div className="fa-track" title={`${r.label} — ${r.total} hooks · ${pct(r.saPct)} A-or-better · ${pct(r.sPct)} S-tier`}>
              <div className={"fa-fill" + (above ? " up" : " down")} style={{ width: `${w}%` }} />
              <span className="fa-val">{valueFmt(r, v)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ForgeAnalytics({ opps, loading }) {
  const a = useMemo(() => aggregateOpps(opps), [opps]);

  if (loading && (!opps || opps.length === 0)) {
    return <div className="fa-empty">Loading opportunities…</div>;
  }
  if (!a.total) {
    return (
      <div className="fa-empty">
        No opportunities to analyze yet. Run <strong>✦ Discover</strong> to surface
        ranked content angles, then come back here.
      </div>
    );
  }

  const themeTagged = a.total - a.themeUntagged;
  const themeTaggedPct = a.total ? (themeTagged / a.total) * 100 : 0;

  // Theme rows: only themes that actually matched something.
  const themeRows = a.themes.filter((t) => t.total > 0);
  const bestTheme = themeRows[0] && [...themeRows].sort((x, y) => y.saPct - x.saPct)[0];
  const worstTheme = themeRows.length ? [...themeRows].sort((x, y) => x.saPct - y.saPct)[0] : null;

  const qualCountries = a.countries
    .filter((c) => c.total >= MIN_COUNTRY)
    .sort((x, y) => y.saPct - x.saPct)
    .slice(0, TOP_N);
  const volCountries = a.countries.slice(0, TOP_N);
  const maxVol = volCountries.reduce((m, c) => Math.max(m, c.total), 0) || 1;

  const seg = [
    { t: "S", n: a.tier.S, pct: a.tierPct[0].pct, cls: "s", label: "Elite" },
    { t: "A", n: a.tier.A, pct: a.tierPct[1].pct, cls: "a", label: "Strong" },
    { t: "B", n: a.tier.B, pct: a.tierPct[2].pct, cls: "b", label: "Filler" },
    { t: "C", n: a.tier.C, pct: a.tierPct[3].pct, cls: "c", label: "Weak" },
  ];

  return (
    <div className="fa-root">
      {/* Thesis / headline finding */}
      {bestTheme && worstTheme && bestTheme.label !== worstTheme.label && (
        <div className="fa-thesis">
          <div className="fa-thesis-big">+{(bestTheme.saPct - a.baseSA).toFixed(1)}<span>pts</span></div>
          <div className="fa-thesis-txt">
            <strong>{bestTheme.label}</strong> is the strongest theme —{" "}
            {pct(bestTheme.saPct)} land A-tier or better vs a {pct(a.baseSA)} baseline.{" "}
            <strong>{worstTheme.label}</strong> is the weakest at {pct(worstTheme.saPct)}.
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="fa-kpis">
        <div className="fa-kpi"><div className="fa-k-label">Opportunities</div><div className="fa-k-val">{a.total.toLocaleString()}</div></div>
        <div className="fa-kpi"><div className="fa-k-label">A-or-better</div><div className="fa-k-val">{a.baseSA}<span className="fa-unit">%</span></div><div className="fa-k-note">{(a.tier.S + a.tier.A).toLocaleString()} hooks</div></div>
        <div className="fa-kpi"><div className="fa-k-label">S-tier</div><div className="fa-k-val">{a.tier.S.toLocaleString()}</div><div className="fa-k-note">top {a.baseS}%</div></div>
        <div className="fa-kpi"><div className="fa-k-label">Countries</div><div className="fa-k-val">{a.countryCount}</div><div className="fa-k-note">geo-tagged</div></div>
        <div className="fa-kpi"><div className="fa-k-label">Favorites</div><div className="fa-k-val">{a.favCount}</div><div className="fa-k-note">★ tagged</div></div>
        <div className="fa-kpi"><div className="fa-k-label">Theme-tagged</div><div className="fa-k-val">{themeTaggedPct.toFixed(0)}<span className="fa-unit">%</span></div><div className="fa-k-note">{themeTagged.toLocaleString()} hooks</div></div>
      </div>

      {/* Theme → quality */}
      <section className="fa-panel">
        <div className="fa-panel-head">
          <h3>Theme → quality</h3>
          <span className="fa-cap">Share landing A-tier or better. Dashed line = {pct(a.baseSA)} baseline; gold beats the field, steel trails it.</span>
        </div>
        {themeRows.length ? (
          <Bars
            rows={themeRows}
            metric={(r) => r.saPct}
            max={100}
            baseline={a.baseSA}
            threshold={a.baseSA}
            valueFmt={(r) => pct(r.saPct)}
            subFmt={(r) => `${r.total} hooks`}
          />
        ) : (
          <div className="fa-empty sm">No theme matches in this set.</div>
        )}
        <div className="fa-note">
          Theme tags are approximate keyword matches (title + topics + keywords), not the model's own
          classification — {a.themeUntagged.toLocaleString()} hook{a.themeUntagged === 1 ? "" : "s"} matched no theme.
        </div>
      </section>

      <div className="fa-grid">
        {/* Tier distribution */}
        <section className="fa-panel">
          <div className="fa-panel-head">
            <h3>Tier distribution</h3>
            <span className="fa-cap">All {a.total.toLocaleString()} hooks by predicted virality.</span>
          </div>
          <div className="fa-tierbar">
            {seg.map((s) => (
              <div
                key={s.t}
                className={"fa-seg fa-seg-" + s.cls}
                style={{ flex: Math.max(s.pct, 0.6) }}
                title={`${s.t}-tier (${s.label}) — ${s.n.toLocaleString()} hooks · ${s.pct}%`}
              >
                {s.pct >= 4 && <>{s.t}<small>{s.pct}%</small></>}
              </div>
            ))}
          </div>
          <div className="fa-legend">
            {seg.map((s) => (
              <span key={s.t}><i className={"fa-sw fa-seg-" + s.cls} />{s.t} · {s.label} · {s.n.toLocaleString()}</span>
            ))}
          </div>
        </section>

        {/* Quality by country */}
        <section className="fa-panel">
          <div className="fa-panel-head">
            <h3>Highest-quality countries</h3>
            <span className="fa-cap">A-or-better rate, ≥{MIN_COUNTRY} hooks.</span>
          </div>
          {qualCountries.length ? (
            <Bars
              rows={qualCountries}
              metric={(r) => r.saPct}
              max={100}
              baseline={a.baseSA}
              threshold={a.baseSA}
              valueFmt={(r) => pct(r.saPct)}
              subFmt={(r) => `${r.total} hooks`}
            />
          ) : (
            <div className="fa-empty sm">No country has ≥{MIN_COUNTRY} hooks yet.</div>
          )}
        </section>
      </div>

      {/* Volume by country */}
      <section className="fa-panel">
        <div className="fa-panel-head">
          <h3>Where the volume is</h3>
          <span className="fa-cap">Hook count by country. Volume ≠ quality — bar color still reflects the country's A-or-better rate vs baseline.</span>
        </div>
        <Bars
          rows={volCountries}
          metric={(r) => r.total}
          max={maxVol}
          threshold={a.baseSA}
          valueFmt={(r) => r.total.toLocaleString()}
          subFmt={(r) => `${pct(r.saPct)} A+`}
        />
      </section>
    </div>
  );
}

export default ForgeAnalytics;
