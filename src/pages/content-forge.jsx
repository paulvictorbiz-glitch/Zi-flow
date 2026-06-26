/* Content Forge — owner-only AI content discovery + hook generation.

   Reads ranked `content_opportunities` straight from Supabase (the same direct-
   query model as scout.jsx — NOT the workflow store). Discovery and hook
   expansion are proxied to the Hetzner backend through the existing Vercel
   functions (api/ai/suggest.js — folded ?action=forge-* by the API team); the
   new rows arrive back via a Supabase realtime subscription + tab-focus poll.

   Flow:
     Discover (Free|Pro tier) → ranked opportunity list (S/A/B/C virality)
       → click an opportunity → ForgeModal (portaled to <body>)
         → 3 hook columns (Curiosity Gap / Controversy / Personal Stakes)
           → Select a hook + a target reel → Send to Pipeline
             → writes reels.creative_brief + updates the opportunity row.

   Owner-only: useIsOwner() (NOT useWorkflow().isOwner — that returns undefined). */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase-client.js";
import { useIsOwner } from "../lib/permissions.jsx";
import "../content-forge.css";

/* Virality tiers, best → worst. Order drives the filter pills + sort. */
const TIERS = ["S", "A", "B", "C"];

/* The 3 hook angles ForgeModal expands into. `key` matches the backend's
   hook_versions[].style; `version` is the 1-based slot the row stores. */
const HOOK_STYLES = [
  { version: 1, key: "curiosity",       label: "Curiosity Gap" },
  { version: 2, key: "controversy",     label: "Controversy" },
  { version: 3, key: "personal_stakes", label: "Personal Stakes" },
];

const STYLE_LABEL = {
  curiosity: "Curiosity Gap",
  controversy: "Controversy",
  personal_stakes: "Personal Stakes",
};

const DEFAULT_SORT = { key: "virality", dir: "desc" };

/* Discovery TARGET presets — the region/country the discovery pass should aim the
   angles at. This is a HINT fed to the LLM, independent of the post-hoc filter
   dropdown (which is derived from already-discovered rows). "__custom__" reveals a
   free-text box so any country/region can be targeted before any opportunity
   exists — the fix for "couldn't select a particular country". */
const DISCOVERY_TARGETS = [
  { value: "global", label: "Global (no specific country)" },
  { value: "United States", label: "United States" },
  { value: "United Kingdom", label: "United Kingdom" },
  { value: "Canada", label: "Canada" },
  { value: "Australia", label: "Australia" },
  { value: "India", label: "India" },
  { value: "Nigeria", label: "Nigeria" },
  { value: "Philippines", label: "Philippines" },
  { value: "__custom__", label: "Custom…" },
];

/* How long the post-Discover poll waits for the background batch to write rows. */
const FORGE_POLL_TRIES = 14;
const FORGE_POLL_MS = 2500;

/* Google Drive share-URL → permanent file ID. Store the ID, never the raw URL.
   Falls through to the input unchanged if no ID pattern is found (lets a bare
   file ID paste straight through). */
const extractFileId = (url) =>
  /(?:\/d\/|[?&]id=)([-\w]{25,})/.exec(url)?.[1] ?? url;

function tierRank(t) {
  const i = TIERS.indexOf(String(t || "C").toUpperCase());
  return i === -1 ? TIERS.length : i;
}
function scoreOf(row) {
  const s = row?.virality_score;
  return typeof s === "number" ? s : 0;
}
function fmtScore(row) {
  const s = row?.virality_score;
  return typeof s === "number" ? Math.round(s * 100) : "—";
}
function fmtDate(iso) {
  if (!iso || typeof iso !== "string") return "—";
  if (!Number.isFinite(Date.parse(iso))) return "—";
  return iso.slice(0, 10);
}

/* Pull the hook for a given 1-based version out of an opportunity's
   hook_versions array, tolerant of either {version} or array position. */
function hookForVersion(hookVersions, version) {
  if (!Array.isArray(hookVersions)) return null;
  return (
    hookVersions.find((h) => Number(h?.version) === version) ||
    hookVersions[version - 1] ||
    null
  );
}

const COLUMNS = [
  { key: "virality", label: "Tier", cls: "cf-c-tier" },
  { key: null, label: "Opportunity" },
  { key: null, label: "Topics" },
  { key: null, label: "Country" },
  { key: "virality", label: "Score", cls: "cf-num" },
  { key: "newest", label: "Created", cls: "cf-num" },
  { key: null, label: "Status" },
];

/* =========================================================================
   ForgeModal — expand one opportunity into 3 hooks, pick one, send to a reel.
   Portaled to document.body so an overflow/transform ancestor never clips it
   (ref: reference_portal-escape-overflow-clip.md).
   ========================================================================= */
function ForgeModal({ opportunity, tier, reels, onClose, onSent, showToast }) {
  // Per-column hook text, keyed by 1-based version. Seeded from any hooks the
  // row already carries, then refreshed by the expand call.
  const seed = useCallback(
    (hv) => {
      const next = {};
      for (const s of HOOK_STYLES) {
        const h = hookForVersion(hv, s.version);
        next[s.version] = h?.text ?? "";
      }
      return next;
    },
    []
  );

  const [hookText, setHookText] = useState(() => seed(opportunity.hook_versions));
  // Which versions the backend actually returned (drives the per-column
  // skeleton/error when fewer than 3 come back — never assume 3).
  const [returnedVersions, setReturnedVersions] = useState(() => {
    const got = new Set();
    for (const s of HOOK_STYLES) {
      if (hookForVersion(opportunity.hook_versions, s.version)?.text) got.add(s.version);
    }
    return got;
  });
  const [selectedHook, setSelectedHook] = useState(null); // 1|2|3|null
  const [targetReelId, setTargetReelId] = useState(null);
  const [expanding, setExpanding] = useState(false);
  const [expandErr, setExpandErr] = useState(null);
  const [sending, setSending] = useState(false);

  const applyHooks = useCallback((hookVersions) => {
    if (!Array.isArray(hookVersions)) return;
    const got = new Set();
    setHookText((prev) => {
      const next = { ...prev };
      for (const s of HOOK_STYLES) {
        const h = hookForVersion(hookVersions, s.version);
        if (h?.text) {
          next[s.version] = h.text;
          got.add(s.version);
        }
      }
      return next;
    });
    setReturnedVersions((prev) => new Set([...prev, ...got]));
  }, []);

  // Expand on open (and whenever the tier toggle changes while open).
  const runExpand = useCallback(async () => {
    setExpanding(true);
    setExpandErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setExpandErr("Not signed in."); return; }
      const r = await fetch("/api/ai/suggest?action=forge-expand", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ opportunity_id: opportunity.id, tier }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok && r.status !== 202) {
        setExpandErr(body.error || `Expansion failed (${r.status}).`);
      }
      // Accept either {hooks:[...]} or {hook_versions:[...]} from the proxy.
      const hooks = body.hooks || body.hook_versions;
      if (Array.isArray(hooks) && hooks.length) applyHooks(hooks);
      // Always re-read the row — the backend writes hook_versions there, so
      // this covers both the sync-return shape and a pending/async write.
      const { data: fresh } = await supabase
        .from("content_opportunities")
        .select("hook_versions")
        .eq("id", opportunity.id)
        .maybeSingle();
      if (fresh?.hook_versions) applyHooks(fresh.hook_versions);
    } catch (e) {
      setExpandErr(e.message || "Could not reach the hook generator.");
    } finally {
      setExpanding(false);
    }
  }, [opportunity.id, tier, applyHooks]);

  useEffect(() => { runExpand(); /* eslint-disable-next-line */ }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSend = selectedHook !== null && targetReelId !== null && !sending;

  const handleSend = useCallback(async () => {
    if (selectedHook === null || targetReelId === null) return;
    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const styleKey =
        HOOK_STYLES.find((s) => s.version === selectedHook)?.key || "curiosity";
      const brief = {
        opportunity_id: opportunity.id,
        selected_hook_version: selectedHook,
        hook_text: hookText[selectedHook] || "",
        hook_style: styleKey,
        forged_by: user?.id ?? null,
        forged_at: new Date().toISOString(),
      };

      const { error: reelErr } = await supabase
        .from("reels")
        .update({ creative_brief: brief })
        .eq("id", targetReelId);
      if (reelErr) throw reelErr;

      // Mark the opportunity attached (best-effort — the brief is the source of
      // truth; don't fail the whole send if this update is blocked by RLS).
      await supabase
        .from("content_opportunities")
        .update({
          selected_hook_version: selectedHook,
          reel_id: targetReelId,
          status: "attached",
          sent_to_pipeline_at: new Date().toISOString(),
        })
        .eq("id", opportunity.id);

      showToast("Hook sent to the pipeline.");
      onSent?.();
      onClose();
    } catch (e) {
      showToast(`Send failed: ${e.message || "unknown error"}`);
    } finally {
      setSending(false);
    }
  }, [selectedHook, targetReelId, hookText, opportunity.id, onClose, onSent, showToast]);

  return createPortal(
    <div className="cf-modal-overlay" onMouseDown={onClose}>
      <div className="cf-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cf-modal-head">
          <span className={`cf-tier-badge t-${String(opportunity.virality_tier || "C").toUpperCase()}`}>
            {String(opportunity.virality_tier || "C").toUpperCase()}
          </span>
          <h3>{opportunity.title || "Untitled opportunity"}</h3>
          <button className="cf-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {opportunity.angle_summary && (
          <p className="cf-modal-angle">{opportunity.angle_summary}</p>
        )}

        <div className="cf-cols">
          {HOOK_STYLES.map((s) => {
            const has = returnedVersions.has(s.version);
            const isSel = selectedHook === s.version;
            return (
              <div key={s.version} className={"cf-col" + (isSel ? " selected" : "")}>
                <span className="cf-col-title">{s.label}</span>
                {has ? (
                  <>
                    <textarea
                      className="cf-col-ta"
                      value={hookText[s.version] ?? ""}
                      onChange={(e) =>
                        setHookText((prev) => ({ ...prev, [s.version]: e.target.value }))
                      }
                      placeholder={`${s.label} hook…`}
                    />
                    <button
                      type="button"
                      className={"cf-btn" + (isSel ? " primary" : "")}
                      onClick={() => setSelectedHook(isSel ? null : s.version)}
                    >
                      {isSel ? "✓ Selected" : "Select"}
                    </button>
                  </>
                ) : expanding ? (
                  <div className="cf-col-skeleton">Generating…</div>
                ) : (
                  <div className="cf-col-skeleton err">
                    {expandErr || "No hook returned. Edit manually or re-run Discover."}
                    <textarea
                      className="cf-col-ta"
                      style={{ marginTop: 8 }}
                      value={hookText[s.version] ?? ""}
                      onChange={(e) => {
                        setHookText((prev) => ({ ...prev, [s.version]: e.target.value }));
                        setReturnedVersions((prev) => new Set([...prev, s.version]));
                      }}
                      placeholder="Write a hook…"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="cf-modal-foot">
          <button
            type="button"
            className="cf-btn"
            onClick={runExpand}
            disabled={expanding}
            title="Re-run hook generation"
          >
            {expanding ? "Generating…" : "↻ Regenerate"}
          </button>
          <span className="cf-foot-spacer" />
          <label htmlFor="cf-reel-target">Target reel</label>
          <select
            id="cf-reel-target"
            className="cf-select"
            value={targetReelId ?? ""}
            onChange={(e) => setTargetReelId(e.target.value || null)}
          >
            <option value="">Pick a reel…</option>
            {reels.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id}{r.title ? ` · ${r.title}` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="cf-btn primary"
            disabled={!canSend}
            onClick={handleSend}
            title={
              selectedHook === null
                ? "Select a hook first"
                : targetReelId === null
                ? "Pick a target reel first"
                : "Attach this hook to the reel"
            }
          >
            {sending ? "Sending…" : "Send to Pipeline →"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* =========================================================================
   Content Forge page.
   ========================================================================= */
export function ContentForge() {
  const isOwner = useIsOwner();

  const [opps, setOpps] = useState([]);
  const [reels, setReels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [tier, setTier] = useState("free"); // "free" | "pro"
  const [tierSel, setTierSel] = useState(() => new Set()); // empty = all tiers
  const [country, setCountry] = useState("all");
  const [sort, setSort] = useState(DEFAULT_SORT);

  const [discovering, setDiscovering] = useState(false);
  const [openOpp, setOpenOpp] = useState(null);
  const [toast, setToast] = useState(null);

  // Ingest + discovery-target + live discovery progress.
  const [clipCount, setClipCount] = useState(null);   // transcript_clips count (null = unknown)
  const [ingesting, setIngesting] = useState(false);
  const [discoverTarget, setDiscoverTarget] = useState("global"); // a DISCOVERY_TARGETS value or free text
  const [targetIsCustom, setTargetIsCustom] = useState(false);
  const [progress, setProgress] = useState(null);      // live discovery status line

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadOpps = useCallback(async () => {
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("content_opportunities")
        .select("*")
        .order("created_at", { ascending: false });
      if (err) throw err;
      setOpps(data || []);
    } catch (e) {
      setError(e.message || "Failed to load opportunities.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadReels = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("reels")
        .select("id, title")
        .order("created_at", { ascending: false })
        .limit(500);
      setReels(data || []);
    } catch {
      /* non-fatal — the target-reel picker just stays empty */
    }
  }, []);

  // Count ingested transcript_clips — the precondition for discovery. The owner
  // can read this table directly under RLS (auth_read_transcript_clips). A head
  // count avoids pulling rows; null stays "unknown" so the UI never claims 0 by
  // mistake on a transient error.
  const loadClipCount = useCallback(async () => {
    try {
      const { count, error: err } = await supabase
        .from("transcript_clips")
        .select("id", { count: "exact", head: true });
      if (err) throw err;
      setClipCount(typeof count === "number" ? count : 0);
    } catch {
      /* leave clipCount as-is (unknown) — don't block Discover on a read blip */
    }
  }, []);

  // Owner-only: skip all data wiring entirely for non-owners.
  useEffect(() => {
    if (!isOwner) return;
    loadOpps();
    loadReels();
    loadClipCount();
  }, [isOwner, loadOpps, loadReels, loadClipCount]);

  // Realtime — live discovery updates on content_opportunities (preferred over
  // pure polling). Falls back gracefully: if the channel never connects, the
  // tab-focus poll below still refreshes the list.
  useEffect(() => {
    if (!isOwner) return;
    const ch = supabase
      .channel("content-forge-opps")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "content_opportunities" },
        () => loadOpps()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isOwner, loadOpps]);

  // Refresh on tab focus / visibility (catches rows written while away).
  useEffect(() => {
    if (!isOwner) return;
    const onFocus = () => { if (document.visibilityState === "visible") loadOpps(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [isOwner, loadOpps]);

  const countryOptions = useMemo(() => {
    const set = new Set();
    for (const o of opps) if (o.country) set.add(o.country);
    return Array.from(set).sort();
  }, [opps]);

  const toggleTierSel = useCallback((t) => {
    setTierSel((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    return opps.filter((o) => {
      if (tierSel.size > 0 && !tierSel.has(String(o.virality_tier || "C").toUpperCase())) return false;
      if (country !== "all" && o.country !== country) return false;
      return true;
    });
  }, [opps, tierSel, country]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const { key, dir } = sort;
    const mul = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (key === "newest") {
        const av = a.created_at ? Date.parse(a.created_at) : 0;
        const bv = b.created_at ? Date.parse(b.created_at) : 0;
        return av === bv ? 0 : (av < bv ? -1 : 1) * mul;
      }
      // virality: tier first (S→C), then score desc within a tier.
      const ar = tierRank(a.virality_tier);
      const br = tierRank(b.virality_tier);
      if (ar !== br) return (ar < br ? -1 : 1) * mul;
      const as = scoreOf(a);
      const bs = scoreOf(b);
      if (as === bs) return 0;
      return (as < bs ? -1 : 1) * mul;
    });
    return rows;
  }, [filtered, sort]);

  const onSort = useCallback((key) => {
    if (!key) return;
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" }
    );
  }, []);

  const arrow = (key) =>
    key && key === sort.key ? <span className="cf-arrow">{sort.dir === "asc" ? "▲" : "▼"}</span> : null;

  // Pull the 12+ footage transcripts (attached_footage_items.full_transcript)
  // into transcript_clips. This is the missing first step — discovery reads
  // clips, so with 0 clips it silently produces nothing. Fire-and-forget on the
  // backend; we poll the clip count for a few seconds so the badge updates.
  const handleIngest = useCallback(async () => {
    setIngesting(true);
    setProgress("Ingesting footage transcripts…");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast("Not signed in — ingest skipped."); return; }
      const r = await fetch("/api/ai/suggest?action=forge-ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });
      if (!r.ok && r.status !== 202) {
        const b = await r.json().catch(() => ({}));
        showToast(`Ingest failed (${r.status}): ${b.error || "unknown error"}`);
        setProgress(null);
        return;
      }
      // Poll the clip count until it rises (the worker writes async).
      let last = clipCount || 0;
      for (let i = 0; i < FORGE_POLL_TRIES; i++) {
        await new Promise((res) => setTimeout(res, FORGE_POLL_MS));
        await loadClipCount();
        const { count } = await supabase
          .from("transcript_clips")
          .select("id", { count: "exact", head: true });
        const n = typeof count === "number" ? count : last;
        setProgress(`Ingesting… ${n} clip${n === 1 ? "" : "s"} so far`);
        if (n > last && i >= 1) { last = n; }
        if (n > 0 && i >= 2) break; // got clips and gave the worker a moment
        last = Math.max(last, n);
      }
      setProgress(null);
      showToast("Transcript ingest complete — you can Discover now.");
    } catch {
      setProgress(null);
      showToast("Could not reach the ingest worker. Try again.");
    } finally {
      setIngesting(false);
    }
  }, [clipCount, loadClipCount, showToast]);

  const handleDiscover = useCallback(async () => {
    // Guard the chicken-and-egg: with no clips, discovery is a guaranteed no-op.
    if (clipCount === 0) {
      showToast("No transcript clips yet — click ⤓ Ingest first, then Discover.");
      return;
    }
    setDiscovering(true);
    setProgress(`Discovering (${tier} tier)…`);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast("Not signed in — discovery skipped."); return; }
      const body = { tier };
      // Discovery TARGET (the LLM hint) — independent of the filter dropdown.
      const target = (discoverTarget || "").trim();
      if (target && target !== "global" && target !== "__custom__") body.country = target;
      const r = await fetch("/api/ai/suggest?action=forge-discover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok && r.status !== 202) {
        showToast(`Discovery failed (${r.status}): ${out.error || "unknown error"}`);
        setProgress(null);
        return;
      }
      const batchId = out.batch_id;
      // Poll the batch via the forge-status proxy until rows land (or we time out).
      let found = 0;
      for (let i = 0; i < FORGE_POLL_TRIES; i++) {
        await new Promise((res) => setTimeout(res, FORGE_POLL_MS));
        if (batchId) {
          try {
            const sr = await fetch(
              `/api/monitor/status?action=forge-status&batch_id=${encodeURIComponent(batchId)}`,
              { headers: { Authorization: `Bearer ${session.access_token}` } }
            );
            const sb = await sr.json().catch(() => ({}));
            if (typeof sb.count === "number") found = sb.count;
          } catch { /* keep polling */ }
        }
        setProgress(
          found > 0
            ? `Discovering… ${found} opportunit${found === 1 ? "y" : "ies"} found`
            : `Discovering (${tier} tier)… analyzing footage`
        );
        if (found > 0) { await loadOpps(); break; }
      }
      await loadOpps();
      setProgress(null);
      if (found > 0) {
        showToast(`Discovery complete — ${found} new opportunit${found === 1 ? "y" : "ies"}.`);
      } else {
        showToast(
          "Discovery finished but found 0 opportunities. Try ingesting more footage " +
          "or a different target country."
        );
      }
    } catch {
      setProgress(null);
      showToast("Could not reach the discovery engine. Try again.");
    } finally {
      setDiscovering(false);
    }
  }, [tier, discoverTarget, clipCount, loadOpps, showToast]);

  if (!isOwner) {
    return (
      <div className="cf-root">
        <div className="cf-empty">Content Forge is owner only.</div>
      </div>
    );
  }

  return (
    <div className="cf-root">
      <div className="cf-header">
        <h2>Content Forge</h2>
        {!loading && (
          <span className="cf-count">{sorted.length} / {opps.length} opportunities</span>
        )}
        <span
          className="cf-count"
          title="Footage transcript segments available for discovery. Discovery reads these — with 0 clips it produces nothing."
        >
          {clipCount === null ? "… clips" : `${clipCount} clip${clipCount === 1 ? "" : "s"}`}
        </span>
        <button
          style={{ marginLeft: "auto" }}
          className="cf-btn"
          onClick={handleIngest}
          disabled={ingesting}
          title="Pull your footage transcripts into the discovery store"
        >
          {ingesting ? "Ingesting…" : "⤓ Ingest"}
        </button>
        <span className="cf-tier" role="group" aria-label="LLM tier">
          <button
            className={tier === "free" ? "on" : ""}
            onClick={() => setTier("free")}
            title="Free tier — OpenRouter / Gemini"
          >Free</button>
          <button
            className={tier === "pro" ? "on" : ""}
            onClick={() => setTier("pro")}
            title="Pro tier — Claude (Haiku discovery / Sonnet expansion)"
          >Pro</button>
        </span>
        <span className="cf-target" title="Country/region the discovery pass targets">
          <label htmlFor="cf-discover-target">Target</label>
          <select
            id="cf-discover-target"
            className="cf-select"
            value={targetIsCustom ? "__custom__" : discoverTarget}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__custom__") {
                setTargetIsCustom(true);
                setDiscoverTarget("");
              } else {
                setTargetIsCustom(false);
                setDiscoverTarget(v);
              }
            }}
          >
            {DISCOVERY_TARGETS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {targetIsCustom && (
            <input
              type="text"
              className="cf-select cf-target-input"
              value={discoverTarget}
              onChange={(e) => setDiscoverTarget(e.target.value)}
              placeholder="e.g. Kenya, Southeast Asia…"
              autoFocus
            />
          )}
        </span>
        <button
          className="cf-btn primary"
          onClick={handleDiscover}
          disabled={discovering}
        >
          {discovering ? "Discovering…" : "✦ Discover"}
        </button>
        <button className="cf-btn" onClick={loadOpps} disabled={loading}>
          {loading ? "Loading…" : "⟳ Reload"}
        </button>
      </div>

      <div className="cf-filters">
        <div className="cf-tier-pills" role="group" aria-label="Filter by virality tier">
          {TIERS.map((t) => (
            <button
              key={t}
              type="button"
              className={`cf-pill t-${t}` + (tierSel.has(t) ? " on" : "")}
              onClick={() => toggleTierSel(t)}
              title={`Toggle ${t}-tier`}
            >
              {t}
            </button>
          ))}
        </div>
        <select className="cf-select" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="all">All countries</option>
          {countryOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          className="cf-select"
          value={sort.key}
          onChange={(e) => setSort({ key: e.target.value, dir: "desc" })}
          title="Sort"
        >
          <option value="virality">Sort: Virality ↓</option>
          <option value="newest">Sort: Newest</option>
        </select>
      </div>

      {progress && <div className="cf-progress">{progress}</div>}
      {error && <div className="cf-error">{error}</div>}
      {loading && <div className="cf-empty">Loading opportunities…</div>}
      {!loading && !error && sorted.length === 0 && (
        <div className="cf-empty">
          {clipCount === 0 ? (
            <>
              No footage transcripts ingested yet. Click <strong>⤓ Ingest</strong> to
              pull your transcribed footage into the discovery store, then{" "}
              <strong>✦ Discover</strong> to surface ranked content angles.
            </>
          ) : (
            <>
              No opportunities yet. Pick a <strong>Target</strong> country, then click{" "}
              <strong>✦ Discover</strong> to surface ranked content angles from your footage.
            </>
          )}
        </div>
      )}

      {!loading && !error && sorted.length > 0 && (
        <div className="cf-table-wrap">
          <table className="cf-table">
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
              {sorted.map((o) => {
                const t = String(o.virality_tier || "C").toUpperCase();
                const topics = Array.isArray(o.topics) ? o.topics : [];
                return (
                  <tr key={o.id} className="cf-tr" onClick={() => setOpenOpp(o)}>
                    <td className="cf-c-tier">
                      <span className={`cf-tier-badge t-${t}`}>{t}</span>
                    </td>
                    <td>
                      <span className="cf-opp-title">{o.title || "(untitled)"}</span>
                      {o.angle_summary && <span className="cf-opp-angle">{o.angle_summary}</span>}
                    </td>
                    <td>
                      <div className="cf-topics">
                        {topics.slice(0, 4).map((tp, i) => (
                          <span key={tp + i} className="cf-topic-tag">{tp}</span>
                        ))}
                        {topics.length === 0 && "—"}
                      </div>
                    </td>
                    <td>{o.country || "—"}</td>
                    <td className="cf-num">{fmtScore(o)}</td>
                    <td className="cf-num" title={o.created_at || ""}>{fmtDate(o.created_at)}</td>
                    <td><span className="cf-status">{o.status || "discovered"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openOpp && (
        <ForgeModal
          opportunity={openOpp}
          tier={tier}
          reels={reels}
          onClose={() => setOpenOpp(null)}
          onSent={loadOpps}
          showToast={showToast}
        />
      )}

      {toast && <div className="cf-toast">{toast}</div>}
    </div>
  );
}

export default ContentForge;
