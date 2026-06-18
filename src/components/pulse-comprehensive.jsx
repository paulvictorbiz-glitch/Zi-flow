/* =========================================================
   PulseComprehensive — the richer Classic-view body for manually
   logged (and ingested) news/algo pulse entries.

   One component, four interchangeable layouts (chosen by the
   `layout` prop, switched in pulse.jsx):
     · timeline  — day-grouped rows (the original feel, restyled)
     · magazine  — image-light card grid, severity accent rail
     · table     — dense sortable data grid
     · kanban     — three columns by severity (High / Watch / Info)

   Every layout shares ONE interaction model: click a row/card to
   expand it inline (no overlay, no route change) into a detail
   editor where you add/remove tags and flip severity / status /
   star. Saves go straight through `onSave(id, patch)` which the
   page wires to actions.updateMonitorEvent.

   Pure / controlled — no store reads. Reuses the existing
   .pulse-sev / .pulse-platform / .pulse-tag tokens from pulse.css
   and adds .pc-* classes for the new layouts.
   ========================================================= */

import React, { useMemo, useState, useCallback } from "react";

/* ── shared label maps (mirror pulse-feed.jsx) ──────────── */
const PLATFORM_GLYPH = { ig: "IG", youtube: "YT", tiktok: "TT", facebook: "FB", x: "X" };
const SEVERITY_LABEL = { info: "Info", watch: "Watch", high: "High" };
const SEVERITY_ORDER = ["high", "watch", "info"];
const STATUS_OPTS = [
  { k: "new", l: "New" },
  { k: "read", l: "Read" },
  { k: "archived", l: "Archived" },
];

function dayKey(iso) {
  if (!iso) return "0000-00-00";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "0000-00-00";
  return d.toISOString().slice(0, 10);
}
function fmtDayHeader(key) {
  if (key === "0000-00-00") return "Unknown date";
  const d = new Date(key + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function fmtShortDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function sevRank(s) {
  const i = SEVERITY_ORDER.indexOf(s);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

function SeverityBadge({ severity }) {
  const sev = severity && SEVERITY_LABEL[severity] ? severity : "info";
  return <span className={`pulse-sev pulse-sev--${sev}`} title={SEVERITY_LABEL[sev]}>{SEVERITY_LABEL[sev]}</span>;
}
function PlatformGlyph({ platform }) {
  if (!platform) return null;
  const label = PLATFORM_GLYPH[platform] || platform.slice(0, 3).toUpperCase();
  return <span className="pulse-platform" title={platform}>{label}</span>;
}

/* ── Tag editor — chips with remove + add input ──────────── */
function TagEditor({ tags, onChange }) {
  const list = Array.isArray(tags) ? tags : [];
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim().toLowerCase();
    if (!v) return;
    if (list.includes(v)) { setDraft(""); return; }
    onChange([...list, v].slice(0, 12));
    setDraft("");
  };
  const remove = (t) => onChange(list.filter((x) => x !== t));

  return (
    <div className="pc-tagedit">
      <span className="pc-detail-label">Tags</span>
      <div className="pc-tagedit-row">
        {list.map((t) => (
          <span key={t} className="pc-tagchip">
            {t}
            <button type="button" className="pc-tagchip-x" title="Remove tag" onClick={() => remove(t)}>×</button>
          </span>
        ))}
        <input
          className="pc-tag-input"
          value={draft}
          placeholder="add tag…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
            if (e.key === "Backspace" && !draft && list.length) remove(list[list.length - 1]);
          }}
          onBlur={add}
        />
      </div>
    </div>
  );
}

/* ── Inline detail / editor — shared by every layout ─────── */
function PulseDetail({ item, isOwner, onSave, onMarkRead, onToggleStar, onArchive, onTrash }) {
  const setTags = useCallback((tags) => onSave && onSave(item.id, { tags }), [onSave, item.id]);
  const setSeverity = (severity) => onSave && onSave(item.id, { severity });
  const setStatus = (status) => onSave && onSave(item.id, { status });

  return (
    <div className="pc-detail" onClick={(e) => e.stopPropagation()}>
      {item.summary && <div className="pc-detail-summary">{item.summary}</div>}

      <div className="pc-detail-grid">
        <div className="pc-detail-field">
          <span className="pc-detail-label">Severity</span>
          <div className="pc-seg">
            {SEVERITY_ORDER.map((s) => (
              <button key={s} type="button"
                className={"pc-seg-btn pc-seg-btn--" + s + (item.severity === s ? " is-on" : "")}
                onClick={() => setSeverity(s)}>{SEVERITY_LABEL[s]}</button>
            ))}
          </div>
        </div>
        <div className="pc-detail-field">
          <span className="pc-detail-label">Status</span>
          <div className="pc-seg">
            {STATUS_OPTS.map((s) => (
              <button key={s.k} type="button"
                className={"pc-seg-btn" + (item.status === s.k ? " is-on" : "")}
                onClick={() => setStatus(s.k)}>{s.l}</button>
            ))}
          </div>
        </div>
      </div>

      <TagEditor tags={item.tags} onChange={setTags} />

      <div className="pc-detail-foot">
        <div className="pc-detail-meta">
          {item.sourceUrl ? (
            <a className="pulse-source" href={item.sourceUrl} target="_blank" rel="noreferrer">
              {item.sourceName || item.sourceUrl}
            </a>
          ) : item.sourceName ? <span className="pulse-source">{item.sourceName}</span> : null}
          {item.region && <span className="pulse-region">{item.region}</span>}
          {item.publishedAt && <span className="pulse-region">{fmtShortDate(item.publishedAt)}</span>}
        </div>
        <div className="pc-detail-acts">
          <button type="button" className={"pulse-act pulse-act--star" + (item.starred ? " is-on" : "")}
            title={item.starred ? "Unstar" : "Star"}
            onClick={() => onToggleStar && onToggleStar(item.id, item.starred)}>{item.starred ? "★" : "☆"}</button>
          {item.status !== "read" && (
            <button type="button" className="pulse-act pulse-act--read" title="Mark read"
              onClick={() => onMarkRead && onMarkRead(item.id)}>✓ Read</button>
          )}
          {item.status !== "archived" && (
            <button type="button" className="pulse-act pulse-act--archive" title="Archive"
              onClick={() => onArchive && onArchive(item.id)}>📦 Archive</button>
          )}
          {isOwner && (
            <button type="button" className="pulse-act pulse-act--trash" title="Delete"
              onClick={() => onTrash && onTrash(item.id)}>🗑 Delete</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* tiny inline tag preview (collapsed state) */
function TagPreview({ tags }) {
  if (!Array.isArray(tags) || !tags.length) return null;
  return (
    <span className="pulse-tags">
      {tags.slice(0, 4).map((t) => <span key={t} className="pulse-tag">{t}</span>)}
      {tags.length > 4 && <span className="pulse-tag dim">+{tags.length - 4}</span>}
    </span>
  );
}

/* ════════════════════ TIMELINE ════════════════════════════ */
function TimelineLayout({ items, expandedId, toggle, detailProps }) {
  const grouped = useMemo(() => {
    const buckets = new Map();
    for (const it of items) {
      const k = dayKey(it.publishedAt);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(it);
    }
    for (const arr of buckets.values())
      arr.sort((a, b) => (Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0));
    return Array.from(buckets.keys()).sort((a, b) => (a < b ? 1 : -1)).map((k) => ({ key: k, rows: buckets.get(k) }));
  }, [items]);

  return (
    <div className="pc-timeline">
      {grouped.map((g) => (
        <div key={g.key} className="pc-tl-day">
          <div className="pc-tl-dayhead">{fmtDayHeader(g.key)}</div>
          {g.rows.map((item) => {
            const open = expandedId === item.id;
            return (
              <div key={item.id} className={"pc-tl-item" + (open ? " is-open" : "")} data-severity={item.severity}>
                <div className="pc-tl-row" role="button" tabIndex={0}
                  onClick={() => toggle(item.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(item.id); } }}>
                  <SeverityBadge severity={item.severity} />
                  <PlatformGlyph platform={item.platform} />
                  <span className="pc-tl-title">{item.title || "(untitled)"}</span>
                  {item.starred && <span className="pc-star-flag">★</span>}
                  <TagPreview tags={item.tags} />
                  <span className="pc-chevron">{open ? "▾" : "▸"}</span>
                </div>
                {open && <PulseDetail item={item} {...detailProps} />}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ════════════════════ MAGAZINE ════════════════════════════ */
function MagazineLayout({ items, expandedId, toggle, detailProps }) {
  return (
    <div className="pc-mag-grid">
      {items.map((item) => {
        const open = expandedId === item.id;
        return (
          <div key={item.id} className={"pc-mag-card" + (open ? " is-open" : "")} data-severity={item.severity}>
            <div className="pc-mag-body" role="button" tabIndex={0}
              onClick={() => toggle(item.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(item.id); } }}>
              <div className="pc-mag-head">
                <SeverityBadge severity={item.severity} />
                <PlatformGlyph platform={item.platform} />
                <span className="pc-mag-date">{fmtShortDate(item.publishedAt)}</span>
                {item.starred && <span className="pc-star-flag">★</span>}
              </div>
              <div className="pc-mag-title">{item.title || "(untitled)"}</div>
              {item.summary && <div className="pc-mag-summary">{item.summary}</div>}
              <div className="pc-mag-foot">
                {item.sourceName && <span className="pc-mag-source">{item.sourceName}</span>}
                <TagPreview tags={item.tags} />
              </div>
            </div>
            {open && <PulseDetail item={item} {...detailProps} />}
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════ TABLE ═══════════════════════════════ */
const TABLE_COLS = [
  { k: "publishedAt", l: "Date", get: (i) => Date.parse(i.publishedAt || 0) || 0 },
  { k: "severity", l: "Sev", get: (i) => sevRank(i.severity) },
  { k: "platform", l: "Plat", get: (i) => i.platform || "" },
  { k: "title", l: "Title", get: (i) => (i.title || "").toLowerCase() },
  { k: "sourceName", l: "Source", get: (i) => (i.sourceName || "").toLowerCase() },
  { k: "tags", l: "Tags", get: (i) => (Array.isArray(i.tags) ? i.tags.length : 0) },
];

function TableLayout({ items, expandedId, toggle, detailProps }) {
  const [sort, setSort] = useState({ key: "publishedAt", dir: "desc" });
  const sorted = useMemo(() => {
    const col = TABLE_COLS.find((c) => c.k === sort.key) || TABLE_COLS[0];
    const arr = [...items].sort((a, b) => {
      const av = col.get(a), bv = col.get(b);
      if (av < bv) return -1; if (av > bv) return 1; return 0;
    });
    return sort.dir === "desc" ? arr.reverse() : arr;
  }, [items, sort]);

  const clickHead = (k) =>
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }));

  return (
    <div className="pc-table-wrap">
      <table className="pc-table">
        <thead>
          <tr>
            {TABLE_COLS.map((c) => (
              <th key={c.k} className={"pc-th pc-th--" + c.k} onClick={() => clickHead(c.k)}>
                {c.l}{sort.key === c.k ? <span className="pc-sortarrow">{sort.dir === "asc" ? " ▲" : " ▼"}</span> : null}
              </th>
            ))}
            <th className="pc-th pc-th--chev" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => {
            const open = expandedId === item.id;
            return (
              <React.Fragment key={item.id}>
                <tr className={"pc-tr" + (open ? " is-open" : "")} data-severity={item.severity}
                  onClick={() => toggle(item.id)}>
                  <td className="pc-td-date">{fmtShortDate(item.publishedAt)}</td>
                  <td><SeverityBadge severity={item.severity} /></td>
                  <td>{item.platform ? <PlatformGlyph platform={item.platform} /> : <span className="pc-dash">—</span>}</td>
                  <td className="pc-td-title">
                    {item.starred && <span className="pc-star-flag">★ </span>}
                    {item.title || "(untitled)"}
                  </td>
                  <td className="pc-td-source">{item.sourceName || <span className="pc-dash">—</span>}</td>
                  <td><TagPreview tags={item.tags} /></td>
                  <td className="pc-td-chev"><span className="pc-chevron">{open ? "▾" : "▸"}</span></td>
                </tr>
                {open && (
                  <tr className="pc-detail-tr">
                    <td colSpan={TABLE_COLS.length + 1}>
                      <PulseDetail item={item} {...detailProps} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ════════════════════ KANBAN ══════════════════════════════ */
function KanbanLayout({ items, expandedId, toggle, detailProps }) {
  const cols = useMemo(() => {
    const m = { high: [], watch: [], info: [] };
    for (const it of items) (m[it.severity] || m.info).push(it);
    for (const arr of Object.values(m))
      arr.sort((a, b) => (Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0));
    return m;
  }, [items]);

  return (
    <div className="pc-kanban">
      {SEVERITY_ORDER.map((sev) => (
        <div key={sev} className={"pc-kan-col pc-kan-col--" + sev}>
          <div className="pc-kan-head">
            <span className={`pulse-sev pulse-sev--${sev}`}>{SEVERITY_LABEL[sev]}</span>
            <span className="pc-kan-count">{cols[sev].length}</span>
          </div>
          <div className="pc-kan-body">
            {cols[sev].length === 0 && <div className="pc-kan-empty">—</div>}
            {cols[sev].map((item) => {
              const open = expandedId === item.id;
              return (
                <div key={item.id} className={"pc-kan-card" + (open ? " is-open" : "")}>
                  <div className="pc-kan-card-body" role="button" tabIndex={0}
                    onClick={() => toggle(item.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(item.id); } }}>
                    <div className="pc-kan-card-head">
                      <PlatformGlyph platform={item.platform} />
                      <span className="pc-kan-date">{fmtShortDate(item.publishedAt)}</span>
                      {item.starred && <span className="pc-star-flag">★</span>}
                    </div>
                    <div className="pc-kan-title">{item.title || "(untitled)"}</div>
                    <TagPreview tags={item.tags} />
                  </div>
                  {open && <PulseDetail item={item} {...detailProps} />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ════════════════════ ROOT ════════════════════════════════ */
export function PulseComprehensive({
  items, layout = "timeline", isOwner,
  onSave, onMarkRead, onToggleStar, onArchive, onTrash,
}) {
  const list = Array.isArray(items) ? items : [];
  const [expandedId, setExpandedId] = useState(null);
  const toggle = useCallback((id) => setExpandedId((cur) => (cur === id ? null : id)), []);

  const detailProps = { isOwner, onSave, onMarkRead, onToggleStar, onArchive, onTrash };

  if (!list.length) return null;

  if (layout === "magazine") return <MagazineLayout items={list} expandedId={expandedId} toggle={toggle} detailProps={detailProps} />;
  if (layout === "table")    return <TableLayout    items={list} expandedId={expandedId} toggle={toggle} detailProps={detailProps} />;
  if (layout === "kanban")   return <KanbanLayout   items={list} expandedId={expandedId} toggle={toggle} detailProps={detailProps} />;
  return <TimelineLayout items={list} expandedId={expandedId} toggle={toggle} detailProps={detailProps} />;
}

export const PULSE_LAYOUTS = [
  { k: "timeline", l: "Timeline" },
  { k: "magazine", l: "Cards" },
  { k: "table",    l: "Table" },
  { k: "kanban",   l: "Board" },
];
