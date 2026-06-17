/* PulseFeed — renders MonitorEvent rows grouped by publishedAt day (desc).
   Pure / controlled component. Action callbacks are wired by the parent
   (src/pages/pulse.jsx). No store reads. */

import React, { useMemo } from "react";

const PLATFORM_GLYPH = {
  ig:       "IG",
  youtube:  "YT",
  tiktok:   "TT",
  facebook: "FB",
  x:        "X",
};

const SEVERITY_LABEL = {
  info:  "Info",
  watch: "Watch",
  high:  "High",
};

function dayKey(iso) {
  if (!iso) return "0000-00-00";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "0000-00-00";
  return d.toISOString().slice(0, 10);
}

function fmtDayHeader(key) {
  if (key === "0000-00-00") return "Unknown date";
  const d = new Date(key + "T00:00:00Z");
  return d.toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

function SeverityBadge({ severity }) {
  const sev = severity && SEVERITY_LABEL[severity] ? severity : "info";
  return (
    <span className={`pulse-sev pulse-sev--${sev}`} title={SEVERITY_LABEL[sev]}>
      {SEVERITY_LABEL[sev]}
    </span>
  );
}

function PlatformGlyph({ platform }) {
  if (!platform) return null;
  const label = PLATFORM_GLYPH[platform] || platform.slice(0, 3).toUpperCase();
  return (
    <span className="pulse-platform" title={platform}>
      {label}
    </span>
  );
}

function PulseRow({ item, onMarkRead, onToggleStar, onArchive, onTrash, isOwner }) {
  const showMarkRead = item.status !== "read";
  const showArchive  = item.status !== "archived";
  const showTrash    = !!isOwner;

  return (
    <div className="pulse-row" data-status={item.status} data-severity={item.severity}>
      <div className="pulse-row-main">
        <div className="pulse-row-head">
          <SeverityBadge severity={item.severity} />
          <PlatformGlyph platform={item.platform} />
          <span className="pulse-row-title">{item.title || "(untitled)"}</span>
        </div>
        {item.summary && (
          <div className="pulse-row-summary">{item.summary}</div>
        )}
        <div className="pulse-row-meta">
          {item.sourceUrl ? (
            <a className="pulse-source"
               href={item.sourceUrl}
               target="_blank"
               rel="noreferrer">
              {item.sourceName || item.sourceUrl}
            </a>
          ) : item.sourceName ? (
            <span className="pulse-source">{item.sourceName}</span>
          ) : null}
          {item.region && <span className="pulse-region">{item.region}</span>}
          {Array.isArray(item.tags) && item.tags.length > 0 && (
            <span className="pulse-tags">
              {item.tags.map((t) => (
                <span key={t} className="pulse-tag">{t}</span>
              ))}
            </span>
          )}
        </div>
      </div>

      <div className="pulse-actions">
        {showMarkRead && (
          <button
            type="button"
            className="pulse-act pulse-act--read"
            title="Mark read"
            onClick={() => onMarkRead && onMarkRead(item.id)}
          >✓</button>
        )}
        <button
          type="button"
          className={"pulse-act pulse-act--star" + (item.starred ? " is-on" : "")}
          title={item.starred ? "Unstar" : "Star"}
          onClick={() => onToggleStar && onToggleStar(item.id, item.starred)}
        >{item.starred ? "★" : "☆"}</button>
        {showArchive && (
          <button
            type="button"
            className="pulse-act pulse-act--archive"
            title="Archive"
            onClick={() => onArchive && onArchive(item.id)}
          >📦</button>
        )}
        {showTrash && (
          <button
            type="button"
            className="pulse-act pulse-act--trash"
            title="Delete"
            onClick={() => onTrash && onTrash(item.id)}
          >🗑</button>
        )}
      </div>
    </div>
  );
}

export function PulseFeed({ items, onMarkRead, onToggleStar, onArchive, onTrash, isOwner }) {
  const list = Array.isArray(items) ? items : [];

  const grouped = useMemo(() => {
    const buckets = new Map();
    for (const it of list) {
      const k = dayKey(it.publishedAt);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(it);
    }
    // Sort each day's rows desc by publishedAt
    for (const arr of buckets.values()) {
      arr.sort((a, b) => {
        const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        return tb - ta;
      });
    }
    // Sort day keys desc
    const keys = Array.from(buckets.keys()).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    return keys.map((k) => ({ key: k, rows: buckets.get(k) }));
  }, [list]);

  if (!list.length) {
    return <div className="pulse-empty">No pulse entries match.</div>;
  }

  return (
    <div className="pulse-feed">
      {grouped.map((g) => (
        <div key={g.key} className="pulse-day">
          <div className="pulse-day-header">{fmtDayHeader(g.key)}</div>
          {g.rows.map((item) => (
            <PulseRow
              key={item.id}
              item={item}
              onMarkRead={onMarkRead}
              onToggleStar={onToggleStar}
              onArchive={onArchive}
              onTrash={onTrash}
              isOwner={isOwner}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
