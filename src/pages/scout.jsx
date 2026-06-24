/* Scout — MicroSaaS opportunity radar tab (owner-only, inside MonitorHub).
   Reads products + dossiers + shortlist from the Scout Supabase project (its own
   DB, separate from FootageBrain's). All filtering/sorting/grouping is
   client-side — a few hundred rows easily fit in memory.

   Refresh → suggest.js?action=scout-scrape (server-proxy, fire-and-forget).
   The owner's FB session JWT authenticates the Vercel call; the Scout backend
   never sees the browser directly.

   Table view: column sort (name/score/created/traction), a Group-by-category
   toggle, category-group + favorites/archived filters, and per-row star /
   archive / delete (anon writes to the Scout DB; see scout-supabase.js). */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase-client.js";
import {
  scoutSupabase,
  fetchShortlist,
  toggleStar,
  setArchived,
  deleteProduct,
} from "../lib/scout-supabase.js";
import "./scout.css";

const SOURCE_LABELS = {
  ph: "PH",
  hn: "HN",
  github: "GH",
  producthunt: "PH",
  hackernews: "HN",
};

const DEFAULT_SORT = { key: "score", dir: "desc" };

function scoreClass(score) {
  if (score == null) return "low";
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}
function scoreOf(row) {
  const s = row?.dossier?.opportunity_score;
  return typeof s === "number" ? s : null;
}
function srcLabel(s) {
  return SOURCE_LABELS[String(s || "").toLowerCase()] || s || "—";
}
function srcClass(s) {
  const k = String(s || "").toLowerCase();
  if (k === "producthunt" || k === "ph") return "ph";
  if (k === "hackernews" || k === "hn") return "hn";
  if (k === "github") return "github";
  return "";
}
// Compact YYYY-MM-DD; "—" when absent/invalid.
function fmtDate(iso) {
  if (!iso || typeof iso !== "string") return "—";
  if (!Number.isFinite(Date.parse(iso))) return "—";
  return iso.slice(0, 10);
}

const COLUMNS = [
  { key: null, label: "", cls: "sc-c-star" },
  { key: "name", label: "Product" },
  { key: null, label: "Source", cls: "sc-c-src" },
  { key: null, label: "Group" },
  { key: "score", label: "Score", cls: "sc-num" },
  { key: "created", label: "Created", cls: "sc-num" },
  { key: "popularity", label: "Traction", cls: "sc-num" },
  { key: null, label: "", cls: "sc-c-act" },
];

function ScoutDetail({ product, dossier }) {
  const d = dossier;
  return (
    <div className="scout-card-detail">
      <div className="full-summary">
        {d?.summary || product.description || product.tagline || "No summary yet."}
      </div>
      {product.category && (
        <div className="scout-detail-row">
          <span className="scout-detail-label">Category</span>
          <span className="scout-detail-value">{product.category}</span>
        </div>
      )}
      {d?.target_user && (
        <div className="scout-detail-row">
          <span className="scout-detail-label">Target user</span>
          <span className="scout-detail-value">{d.target_user}</span>
        </div>
      )}
      {d?.tech_guess && (
        <div className="scout-detail-row">
          <span className="scout-detail-label">Tech guess</span>
          <span className="scout-detail-value">{d.tech_guess}</span>
        </div>
      )}
      {d?.clone_difficulty != null && (
        <div className="scout-detail-row">
          <span className="scout-detail-label">Clone difficulty</span>
          <span className="scout-detail-value">{d.clone_difficulty}/5</span>
        </div>
      )}
      {d?.suggested_angle && (
        <div className="scout-detail-row">
          <span className="scout-detail-label">Angle</span>
          <span className="scout-detail-value">{d.suggested_angle}</span>
        </div>
      )}
      {d?.fork_type && (
        <div className="scout-detail-row">
          <span className="scout-detail-label">Fork type</span>
          <span className="scout-detail-value">{d.fork_type}</span>
        </div>
      )}
      {d?.model_used && (
        <div className="scout-dossier-meta">
          {d.tier || "bulk"} dossier · {d.model_used}
        </div>
      )}
      {!d && <div className="scout-dossier-meta">No dossier generated yet.</div>}
    </div>
  );
}

export function Scout() {
  const [products, setProducts] = useState([]);
  const [dossierMap, setDossierMap] = useState({});
  const [shortlist, setShortlist] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [scoreMin, setScoreMin] = useState(0);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const [sort, setSort] = useState(DEFAULT_SORT);
  const [groupBy, setGroupBy] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [expandedId, setExpandedId] = useState(null);

  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pRes, dRes, shorts] = await Promise.all([
        scoutSupabase.from("products").select("*").order("first_seen", { ascending: false }),
        scoutSupabase.from("dossiers").select("*"),
        fetchShortlist(),
      ]);
      if (pRes.error) throw pRes.error;
      if (dRes.error) throw dRes.error;

      const map = {};
      for (const d of dRes.data || []) {
        const pid = String(d.product_id);
        if (!map[pid] || new Date(d.generated_at) > new Date(map[pid].generated_at)) {
          map[pid] = d;
        }
      }
      setProducts(pRes.data || []);
      setDossierMap(map);
      setShortlist(shorts);
    } catch (err) {
      setError(err.message || "Failed to load Scout data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Enrich each product with its latest dossier + shortlist star + archived flag.
  const enriched = useMemo(
    () =>
      products.map((p) => ({
        ...p,
        dossier: dossierMap[String(p.id)] || null,
        starred: Boolean(shortlist[String(p.id)]?.starred),
        archived: Boolean(p.archived),
      })),
    [products, dossierMap, shortlist]
  );

  const sourceOptions = useMemo(() => {
    const set = new Set();
    for (const p of products) if (p.source) set.add(p.source);
    return Array.from(set).sort();
  }, [products]);

  const groupOptions = useMemo(() => {
    const set = new Set();
    for (const p of products) if (p.category_group) set.add(p.category_group);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return enriched.filter((row) => {
      if (!showArchived && row.archived) return false;
      if (favoritesOnly && !row.starred) return false;
      if (sourceFilter !== "all" && row.source !== sourceFilter) return false;
      if (groupFilter !== "all" && (row.category_group || "") !== groupFilter) return false;
      const score = scoreOf(row) ?? 0;
      if (score < scoreMin) return false;
      if (q) {
        const hay = [row.name, row.description, row.tagline, row.category, row.dossier?.summary]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, search, sourceFilter, groupFilter, scoreMin, favoritesOnly, showArchived]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const { key, dir } = sort;
    const mul = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (key === "name") return mul * String(a.name || "").localeCompare(String(b.name || ""));
      let av, bv;
      switch (key) {
        case "score": av = scoreOf(a) ?? -1; bv = scoreOf(b) ?? -1; break;
        case "popularity": av = a.popularity ?? -1; bv = b.popularity ?? -1; break;
        case "created":
          av = a.source_created_at ? Date.parse(a.source_created_at) : 0;
          bv = b.source_created_at ? Date.parse(b.source_created_at) : 0;
          break;
        default: av = scoreOf(a) ?? -1; bv = scoreOf(b) ?? -1;
      }
      if (av === bv) return 0;
      return av < bv ? -1 * mul : 1 * mul;
    });
    return rows;
  }, [filtered, sort]);

  // Group the sorted rows by category_group, preserving first-seen order.
  const groups = useMemo(() => {
    if (!groupBy) return null;
    const out = [];
    const idx = new Map();
    for (const p of sorted) {
      const name = p.category_group || "Uncategorized";
      let g = idx.get(name);
      if (!g) { g = { name, items: [] }; idx.set(name, g); out.push(g); }
      g.items.push(p);
    }
    return out;
  }, [sorted, groupBy]);

  const onSort = useCallback((key) => {
    if (!key) return;
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" }
    );
  }, []);

  const toggleGroup = useCallback((name) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const handleStar = useCallback(async (row) => {
    const next = !row.starred;
    setShortlist((prev) => ({
      ...prev,
      [String(row.id)]: { ...(prev[String(row.id)] || { product_id: row.id }), starred: next },
    }));
    const res = await toggleStar(row.id, next);
    if (!res.ok) {
      setShortlist((prev) => ({
        ...prev,
        [String(row.id)]: { ...(prev[String(row.id)] || { product_id: row.id }), starred: !next },
      }));
      showToast("Could not update star.");
    }
  }, [showToast]);

  const handleArchive = useCallback(async (row) => {
    const next = !row.archived;
    setProducts((prev) => prev.map((p) => (p.id === row.id ? { ...p, archived: next } : p)));
    const res = await setArchived(row.id, next);
    if (!res.ok) {
      setProducts((prev) => prev.map((p) => (p.id === row.id ? { ...p, archived: !next } : p)));
      showToast("Could not update archive state.");
    }
  }, [showToast]);

  const handleDelete = useCallback(async (row) => {
    const ok = window.confirm(
      `Permanently delete "${row.name || "this product"}"?\n\n` +
      "This removes it (and its dossier + shortlist entry) from the Scout database. " +
      "This cannot be undone."
    );
    if (!ok) return;
    const res = await deleteProduct(row.id);
    if (res.ok) {
      setProducts((prev) => prev.filter((p) => p.id !== row.id));
      if (expandedId === row.id) setExpandedId(null);
    } else {
      showToast("Delete failed.");
    }
  }, [expandedId, showToast]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast("Not signed in — refresh skipped."); return; }
      const r = await fetch("/api/ai/suggest?action=scout-scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok && r.status !== 202) {
        const body = await r.json().catch(() => ({}));
        showToast(`Scrape failed (${r.status}): ${body.error || "unknown error"}`);
        return;
      }
      showToast("Scraping started — reload in ~2 minutes when new products arrive.");
    } catch {
      showToast("Could not reach the scraper. Try again.");
    } finally {
      setRefreshing(false);
    }
  }, [showToast]);

  const arrow = (key) =>
    key && key === sort.key ? <span className="sc-arrow">{sort.dir === "asc" ? "▲" : "▼"}</span> : null;

  const renderRow = (p) => {
    const score = scoreOf(p);
    const pop = Number.isFinite(p.popularity) ? p.popularity : null;
    const kind = p.popularity_kind || "";
    const isExpanded = expandedId === p.id;
    return (
      <React.Fragment key={p.id}>
        <tr
          className={"scout-tr" + (p.archived ? " archived" : "") + (isExpanded ? " expanded" : "")}
          onClick={() => setExpandedId(isExpanded ? null : p.id)}
        >
          <td className="sc-c-star">
            <button
              type="button"
              className={"sc-star" + (p.starred ? " on" : "")}
              title={p.starred ? "Unstar" : "Star"}
              onClick={(e) => { e.stopPropagation(); handleStar(p); }}
            >
              {p.starred ? "★" : "☆"}
            </button>
          </td>
          <td className="sc-name">
            <span className="sc-name-text">{p.name || "(untitled)"}</span>
            {p.url && (
              <a
                className="scout-ext-link"
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                ↗
              </a>
            )}
          </td>
          <td className="sc-c-src">
            <span className={`scout-source-badge ${srcClass(p.source)}`}>{srcLabel(p.source)}</span>
          </td>
          <td>
            {p.category_group ? <span className="sc-group-badge">{p.category_group}</span> : "—"}
          </td>
          <td className="sc-num">
            <span className={`scout-score ${scoreClass(score)}`}>{score != null ? score : "—"}</span>
          </td>
          <td className="sc-num" title={p.source_created_at || ""}>{fmtDate(p.source_created_at)}</td>
          <td className="sc-num" title={kind ? `${pop} ${kind}` : ""}>
            {pop == null ? "—" : `${pop.toLocaleString()}${kind ? " " + kind : ""}`}
          </td>
          <td className="sc-c-act">
            <button
              type="button"
              className={"sc-icon" + (p.archived ? " on" : "")}
              title={p.archived ? "Unarchive" : "Archive"}
              onClick={(e) => { e.stopPropagation(); handleArchive(p); }}
            >
              {p.archived ? "⊞" : "⊟"}
            </button>
            <button
              type="button"
              className="sc-icon sc-del"
              title="Delete permanently"
              onClick={(e) => { e.stopPropagation(); handleDelete(p); }}
            >
              🗑
            </button>
          </td>
        </tr>
        {isExpanded && (
          <tr className="scout-detail-tr">
            <td colSpan={COLUMNS.length}>
              <ScoutDetail product={p} dossier={p.dossier} />
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  return (
    <div className="scout-root">
      <div className="scout-header">
        <h2>MicroSaaS Scout</h2>
        {!loading && (
          <span className="scout-count">{sorted.length} / {products.length} products</span>
        )}
        <button
          className="scout-refresh-btn"
          onClick={() => setGroupBy((v) => !v)}
          title="Group products by high-level category"
          style={{ marginLeft: "auto" }}
        >
          {groupBy ? "Grouped: on" : "Group by category"}
        </button>
        <button
          className="scout-refresh-btn"
          onClick={handleRefresh}
          disabled={refreshing || loading}
          style={{ marginLeft: 0 }}
        >
          {refreshing ? "Starting…" : "↻ Refresh"}
        </button>
        <button
          className="scout-refresh-btn"
          onClick={loadData}
          disabled={loading}
          style={{ marginLeft: 0 }}
        >
          {loading ? "Loading…" : "⟳ Reload"}
        </button>
      </div>

      <div className="scout-filters">
        <input
          className="scout-search"
          type="text"
          placeholder="Search name, description, dossier…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="scout-select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="all">All sources</option>
          {sourceOptions.map((s) => (
            <option key={s} value={s}>{srcLabel(s)}</option>
          ))}
        </select>
        <select className="scout-select" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
          <option value="all">All groups</option>
          {groupOptions.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <div className="scout-score-filter">
          <span>Score ≥</span>
          <input
            type="number"
            min={0}
            max={100}
            value={scoreMin}
            onChange={(e) => setScoreMin(Number(e.target.value) || 0)}
          />
        </div>
        <label className="scout-check">
          <input type="checkbox" checked={favoritesOnly} onChange={(e) => setFavoritesOnly(e.target.checked)} />
          Favorites only
        </label>
        <label className="scout-check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {error && <div className="scout-empty" style={{ color: "#f44" }}>{error}</div>}
      {loading && <div className="scout-empty">Loading Scout data…</div>}
      {!loading && !error && sorted.length === 0 && (
        <div className="scout-empty">No products match your filters.</div>
      )}

      {!loading && !error && sorted.length > 0 && (
        <div className="scout-table-wrap">
          <table className="scout-table">
            <thead>
              <tr>
                {COLUMNS.map((c, i) => (
                  <th
                    key={c.label + i}
                    className={[c.key ? "sortable" : "", c.cls || ""].filter(Boolean).join(" ")}
                    onClick={c.key ? () => onSort(c.key) : undefined}
                  >
                    {c.label}{arrow(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!groupBy && sorted.map((p) => renderRow(p))}
              {groupBy && groups.map((g) => {
                const isCollapsed = collapsed.has(g.name);
                return (
                  <React.Fragment key={"grp-" + g.name}>
                    <tr className="scout-group-header" onClick={() => toggleGroup(g.name)}>
                      <td colSpan={COLUMNS.length}>
                        <span className="sc-grp-toggle">{isCollapsed ? "▸" : "▾"}</span>{" "}
                        {g.name} <span className="sc-grp-count">({g.items.length})</span>
                      </td>
                    </tr>
                    {!isCollapsed && g.items.map((p) => renderRow(p))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {toast && <div className="scout-toast">{toast}</div>}
    </div>
  );
}
