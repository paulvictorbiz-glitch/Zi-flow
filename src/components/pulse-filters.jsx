/* PulseFilters — controlled filter bar for the Pulse Monitor page.
   Pure component: receives `value` + `onChange` and renders chip rows.
   Does NOT read from any store. Consumed by src/pages/pulse.jsx.

   value shape:
   { section: 'all'|'algo'|'news', platform: string|null, severity: string|null,
     status: 'all'|'new'|'read'|'starred'|'archived', q: string }
*/

import React from "react";

const SECTION_OPTS = [
  { k: "all",  l: "All" },
  { k: "algo", l: "Algorithm" },
  { k: "news", l: "World/Political" },
];

const PLATFORM_OPTS = [
  { k: "ig",       l: "IG" },
  { k: "youtube",  l: "YouTube" },
  { k: "tiktok",   l: "TikTok" },
  { k: "facebook", l: "Facebook" },
  { k: "x",        l: "X" },
];

const SEVERITY_OPTS = [
  { k: "info",  l: "Info" },
  { k: "watch", l: "Watch" },
  { k: "high",  l: "High" },
];

const STATUS_OPTS = [
  { k: "all",      l: "All" },
  { k: "new",      l: "New" },
  { k: "read",     l: "Read" },
  { k: "starred",  l: "Starred" },
  { k: "archived", l: "Archived" },
];

function Chip({ active, onClick, children, tone }) {
  const cls = [
    "pulse-chip",
    active ? "pulse-chip--active" : "",
    tone ? `pulse-chip--${tone}` : "",
  ].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} onClick={onClick}>
      {children}
    </button>
  );
}

export function PulseFilters({ value, onChange, person }) {
  const v = value || {
    section: "all", platform: null, severity: null, status: "all", q: "",
  };
  const set = (patch) => onChange({ ...v, ...patch });

  return (
    <div className="pulse-filters">
      {/* Section toggle */}
      <div className="pulse-filter-row">
        {SECTION_OPTS.map((o) => (
          <Chip
            key={o.k}
            active={v.section === o.k}
            onClick={() => set({ section: o.k })}
          >
            {o.l}
          </Chip>
        ))}
      </div>

      {/* Platform chips */}
      <div className="pulse-filter-row">
        <Chip
          active={v.platform === null}
          onClick={() => set({ platform: null })}
        >
          All platforms
        </Chip>
        {PLATFORM_OPTS.map((o) => (
          <Chip
            key={o.k}
            active={v.platform === o.k}
            onClick={() => set({ platform: o.k })}
          >
            {o.l}
          </Chip>
        ))}
      </div>

      {/* Severity chips */}
      <div className="pulse-filter-row">
        <Chip
          active={v.severity === null}
          onClick={() => set({ severity: null })}
        >
          Any severity
        </Chip>
        {SEVERITY_OPTS.map((o) => (
          <Chip
            key={o.k}
            tone={o.k}
            active={v.severity === o.k}
            onClick={() => set({ severity: o.k })}
          >
            {o.l}
          </Chip>
        ))}
      </div>

      {/* Status chips */}
      <div className="pulse-filter-row">
        {STATUS_OPTS.map((o) => (
          <Chip
            key={o.k}
            active={v.status === o.k}
            onClick={() => set({ status: o.k })}
          >
            {o.l}
          </Chip>
        ))}
      </div>

      {/* Search input */}
      <div className="pulse-filter-row">
        <input
          className="m-input"
          type="search"
          value={v.q || ""}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search title, summary, source, tags…"
        />
      </div>
    </div>
  );
}
