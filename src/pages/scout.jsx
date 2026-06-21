/* Scout — MicroSaaS opportunity radar tab (owner-only, inside MonitorHub).
   Reads products + dossiers from the Scout Supabase project (its own DB,
   separate from FootageBrain's). All filtering is client-side — 97 rows
   easily fits in memory.

   Refresh → suggest.js?action=scout-scrape (server-proxy, fire-and-forget).
   The owner's FB session JWT authenticates the Vercel call; the Scout backend
   never sees the browser directly. */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { DPill } from "../components/components.jsx";
import { supabase } from "../lib/supabase-client.js";
import { scoutSupabase } from "../lib/scout-supabase.js";
import "./scout.css";

const SOURCE_LABELS = { ph: "PH", hn: "HN", github: "GH" };
const SOURCES = ["all", "ph", "hn", "github"];

function scoreClass(score) {
  if (score == null) return "low";
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function ScoutCard({ product, dossier }) {
  const [expanded, setExpanded] = useState(false);
  const score = dossier?.opportunity_score ?? null;
  const src = (product.source || "").toLowerCase();

  return (
    <div
      className={`scout-card${expanded ? " expanded" : ""}`}
      onClick={() => setExpanded(e => !e)}
    >
      <div className="scout-card-top">
        <span className={`scout-source-badge ${src}`}>
          {SOURCE_LABELS[src] || src}
        </span>
        <span className={`scout-score ${scoreClass(score)}`}>
          {score != null ? score : "—"}
        </span>
        <div className="scout-card-body">
          <div className="scout-card-name">
            {product.name || "(untitled)"}
            {product.url && (
              <a
                className="scout-ext-link"
                href={product.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
              >
                ↗
              </a>
            )}
          </div>
          {!expanded && (
            <div className="scout-summary-clamp">
              {dossier?.summary || product.description || product.tagline || "No summary yet."}
            </div>
          )}
        </div>
      </div>

      {expanded && dossier && (
        <div className="scout-card-detail">
          <div className="full-summary">{dossier.summary}</div>
          {dossier.target_user && (
            <div className="scout-detail-row">
              <span className="scout-detail-label">Target user</span>
              <span className="scout-detail-value">{dossier.target_user}</span>
            </div>
          )}
          {dossier.tech_guess && (
            <div className="scout-detail-row">
              <span className="scout-detail-label">Tech guess</span>
              <span className="scout-detail-value">{dossier.tech_guess}</span>
            </div>
          )}
          {dossier.clone_difficulty && (
            <div className="scout-detail-row">
              <span className="scout-detail-label">Clone difficulty</span>
              <span className="scout-detail-value">{dossier.clone_difficulty}</span>
            </div>
          )}
          {dossier.suggested_angle && (
            <div className="scout-detail-row">
              <span className="scout-detail-label">Angle</span>
              <span className="scout-detail-value">{dossier.suggested_angle}</span>
            </div>
          )}
          {dossier.fork_type && (
            <div className="scout-detail-row">
              <span className="scout-detail-label">Fork type</span>
              <span className="scout-detail-value">{dossier.fork_type}</span>
            </div>
          )}
          {dossier.model_used && (
            <div className="scout-dossier-meta">
              {dossier.tier || "bulk"} dossier · {dossier.model_used}
            </div>
          )}
        </div>
      )}

      {expanded && !dossier && (
        <div className="scout-card-detail">
          <div className="full-summary">
            {product.description || product.tagline || "No description."}
          </div>
          <div className="scout-dossier-meta">No dossier generated yet.</div>
        </div>
      )}
    </div>
  );
}

export function Scout() {
  const [products, setProducts] = useState([]);
  const [dossierMap, setDossierMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [scoreMin, setScoreMin] = useState(0);

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
      const [pRes, dRes] = await Promise.all([
        scoutSupabase.from("products").select("*").order("first_seen", { ascending: false }),
        scoutSupabase.from("dossiers").select("*"),
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
    } catch (err) {
      setError(err.message || "Failed to load Scout data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast("Not signed in — refresh skipped."); return; }
      const r = await fetch("/api/ai/suggest?action=scout-scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      // 200 = done, 202 = fire-and-forget timeout (scrape still running). Both OK.
      // Anything else: surface the server's real error instead of a false "started"
      // — otherwise a 502 (e.g. the non-ISO-8859-1 Headers masquerade) shows as success.
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

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return products.filter(p => {
      if (sourceFilter !== "all" && p.source !== sourceFilter) return false;
      const d = dossierMap[String(p.id)];
      const score = d?.opportunity_score ?? 0;
      if (score < scoreMin) return false;
      if (q) {
        const haystack = [p.name, p.description, p.tagline, d?.summary]
          .filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [products, dossierMap, search, sourceFilter, scoreMin]);

  return (
    <div className="scout-root">
      <div className="scout-header">
        <h2>MicroSaaS Scout</h2>
        {!loading && (
          <span className="scout-count">
            {filtered.length} / {products.length} products
          </span>
        )}
        <button
          className="scout-refresh-btn"
          onClick={handleRefresh}
          disabled={refreshing || loading}
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
          onChange={e => setSearch(e.target.value)}
        />
        <div className="scout-source-pills">
          {SOURCES.map(s => (
            <DPill
              key={s}
              active={sourceFilter === s}
              onClick={() => setSourceFilter(s)}
            >
              {s === "all" ? "All" : SOURCE_LABELS[s] || s}
            </DPill>
          ))}
        </div>
        <div className="scout-score-filter">
          <span>Score ≥</span>
          <input
            type="number"
            min={0}
            max={100}
            value={scoreMin}
            onChange={e => setScoreMin(Number(e.target.value) || 0)}
          />
        </div>
      </div>

      {error && <div className="scout-empty" style={{ color: "#f44" }}>{error}</div>}

      {loading && <div className="scout-empty">Loading Scout data…</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="scout-empty">No products match your filters.</div>
      )}

      {!loading && !error && (
        <div className="scout-list">
          {filtered.map(p => (
            <ScoutCard
              key={p.id}
              product={p}
              dossier={dossierMap[String(p.id)] || null}
            />
          ))}
        </div>
      )}

      {toast && <div className="scout-toast">{toast}</div>}
    </div>
  );
}
