/* PulseSources — owner-only manager for the RSS/Atom feeds the news monitor
   watches. Lists existing monitor_sources with an enable toggle, per-feed health
   (last status / last fetched), and delete; plus an "Add source" form. The
   ingester (api/ai/_rss.js) reads the enabled ones on each run.

   Reuses the Modal/Field/SegRow primitives. Controlled by src/pages/pulse.jsx
   via `open`, `onClose`; reads `sources` + `actions` from the store. */

import React, { useState } from "react";
import { Modal, Field, SegRow } from "./modals/Modal.jsx";

const CATEGORY_OPTS = [
  { k: "algo", l: "Algorithm" },
  { k: "news", l: "World/Political" },
];

// SegRow can't emit null (it stringifies keys) — use a sentinel for "none".
const PLATFORM_OPTS = [
  { k: "__none__", l: "None" },
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

function fmtWhen(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function PulseSources({ open, onClose, sources, actions, person }) {
  const [name, setName]                 = useState("");
  const [url, setUrl]                   = useState("");
  const [category, setCategory]         = useState("news");
  const [platformKey, setPlatformKey]   = useState("__none__");
  const [region, setRegion]             = useState("");
  const [severityDefault, setSeverity]  = useState("info");
  const [error, setError]               = useState("");
  const [checking, setChecking]         = useState(false);
  const [diag, setDiag]                 = useState(null); // validateFeedUrl() result (+ _url)

  // Short-circuit AFTER hooks so we never break the Rules of Hooks.
  if (!open) return null;

  const list = Array.isArray(sources) ? sources : [];

  // Actually persist the source (used by Add and "Add anyway").
  const doCreate = async () => {
    const n = name.trim();
    const u = url.trim();
    await actions?.createMonitorSource?.({
      name: n,
      url: u,
      category,
      platform: platformKey === "__none__" ? null : platformKey,
      region: region.trim() || null,
      severityDefault,
      enabled: true,
      createdBy: person?.id || null,
    });
    // Reset for the next add; keep the modal open so the owner can add several.
    setName(""); setUrl(""); setRegion(""); setError(""); setDiag(null);
  };

  // Pre-flight the URL: is it a real feed? If not, why + what to paste instead.
  const checkFeed = async () => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) { setError("Feed URL must start with http(s)://"); return null; }
    setError(""); setChecking(true); setDiag(null);
    try {
      const r = await actions?.validateMonitorFeed?.(u);
      const withUrl = r ? { ...r, _url: u } : null;
      setDiag(withUrl);
      return withUrl;
    } catch (e) {
      const d = { ok: false, reason: e?.message || "Could not check this URL.", suggestions: [], _url: u };
      setDiag(d);
      return d;
    } finally {
      setChecking(false);
    }
  };

  const addSource = async () => {
    const n = name.trim();
    const u = url.trim();
    if (!n || !u) { setError("Name and feed URL are required."); return; }
    if (!/^https?:\/\//i.test(u)) { setError("Feed URL must start with http(s)://"); return; }
    // Demo mode (or already-validated this exact URL) → skip the round-trip.
    if (diag?.ok && diag._url === u) {
      try { await doCreate(); } catch (e) { setError(e?.message || "Could not add source (duplicate URL?)."); }
      return;
    }
    const r = await checkFeed();
    if (r?.ok || r?.demo) {
      try { await doCreate(); } catch (e) { setError(e?.message || "Could not add source (duplicate URL?)."); }
    }
    // Otherwise the diagnostics panel now explains the problem; we don't add.
  };

  // Force-add despite a failed check (validation can be wrong / feed temporarily down).
  const addAnyway = async () => {
    try { await doCreate(); } catch (e) { setError(e?.message || "Could not add source (duplicate URL?)."); }
  };

  // Swap a suggested feed URL into the input and clear the diagnostics.
  const useSuggestion = (su) => { setUrl(su); setDiag(null); setError(""); };

  const toggle = (s) => actions?.updateMonitorSource?.(s.id, { enabled: !s.enabled });

  const remove = (s) => {
    if (typeof window !== "undefined" &&
        !window.confirm(`Stop monitoring "${s.name}"? (Already-ingested articles stay.)`)) return;
    actions?.deleteMonitorSource?.(s.id);
  };

  return (
    <div className="pulse-modal">
      <Modal
        title="Monitored sources"
        subtitle="RSS/Atom feeds the monitor pulls automatically."
        onClose={onClose}
        onSubmit={addSource}
        submitLabel="Add source"
      >
        {/* ── Add form ─────────────────────────────────────── */}
        <div className="modal-grid-2">
          <Field label="Name">
            <input className="m-input" value={name}
              onChange={(e) => { setName(e.target.value); if (error) setError(""); }}
              placeholder="e.g. BBC World" autoFocus />
          </Field>
          <Field label="Feed URL">
            <input className="m-input" type="url" value={url}
              onChange={(e) => { setUrl(e.target.value); if (error) setError(""); if (diag) setDiag(null); }}
              placeholder="https://…/rss.xml" />
          </Field>
        </div>

        <div className="pulse-check-row">
          <button type="button" className="pulse-check-btn" onClick={checkFeed}
            disabled={checking || !url.trim()}>
            {checking ? "Checking feed…" : "Check feed"}
          </button>
          <span className="m-hint">Tests the URL before adding — tells you if it isn't a real RSS/Atom feed.</span>
        </div>

        <Field label="Category">
          <SegRow value={category} onChange={setCategory} options={CATEGORY_OPTS} />
        </Field>
        <Field label="Platform" hint="optional">
          <SegRow value={platformKey} onChange={setPlatformKey} options={PLATFORM_OPTS} />
        </Field>
        <div className="modal-grid-2">
          <Field label="Region" hint="optional">
            <input className="m-input" value={region}
              onChange={(e) => setRegion(e.target.value)} placeholder="e.g. Global, US" />
          </Field>
          <Field label="Default severity" hint="used if AI can't classify">
            <SegRow value={severityDefault} onChange={setSeverity} options={SEVERITY_OPTS} />
          </Field>
        </div>
        {error && <div className="m-hint" style={{ color: "var(--c-red, #ef4444)" }}>{error}</div>}

        {/* ── Feed diagnostics ─────────────────────────────── */}
        {diag && !checking && (
          diag.ok ? (
            <div className="pulse-diag is-ok">
              ✓ Valid {diag.kind === "atom" ? "Atom" : "RSS"} feed — {diag.itemCount} item
              {diag.itemCount === 1 ? "" : "s"} found. Click “Add source” to save it.
            </div>
          ) : (
            <div className="pulse-diag is-err">
              <div className="pulse-diag-reason">⚠ {diag.reason}</div>
              {diag.suggestions?.length > 0 ? (
                <>
                  <div className="pulse-diag-sughead">Paste one of these working feeds instead:</div>
                  {diag.suggestions.map((s) => (
                    <div key={s.url} className="pulse-diag-sug">
                      <div className="pulse-diag-sug-main">
                        <div className="pulse-diag-sug-label">
                          {s.label}{typeof s.items === "number" ? ` · ${s.items} items` : ""}
                        </div>
                        <div className="pulse-diag-sug-url">{s.url}</div>
                      </div>
                      <button type="button" className="pulse-diag-use"
                        onClick={() => useSuggestion(s.url)}>Use this</button>
                    </div>
                  ))}
                </>
              ) : (
                <div className="pulse-diag-sughead">
                  Couldn't find a working feed for this site. Look for an “RSS” link on the
                  page, or try a URL ending in <code>.xml</code>, <code>/feed</code>, or <code>/rss</code>.
                </div>
              )}
              <button type="button" className="pulse-diag-anyway" onClick={addAnyway}>
                Add it anyway
              </button>
            </div>
          )
        )}

        {/* ── Existing sources ─────────────────────────────── */}
        <div className="pulse-src-listhead">
          {list.length} source{list.length === 1 ? "" : "s"}
        </div>
        <div className="pulse-src-list">
          {list.length === 0 && (
            <div className="pulse-empty" style={{ padding: "12px" }}>
              No sources yet. Add a feed above, then hit “Refresh now”.
            </div>
          )}
          {list.map((s) => {
            const errored = s.lastStatus && s.lastStatus !== "ok";
            return (
              <div key={s.id} className={"pulse-src-row" + (s.enabled ? "" : " is-off")}>
                <button
                  className={"pulse-src-toggle" + (s.enabled ? " is-on" : "")}
                  onClick={() => toggle(s)}
                  title={s.enabled ? "Enabled — click to pause" : "Paused — click to enable"}
                >
                  {s.enabled ? "On" : "Off"}
                </button>
                <div className="pulse-src-main">
                  <div className="pulse-src-name">
                    {s.name}
                    <span className="pulse-src-badge">{s.category === "algo" ? "Algorithm" : "World"}</span>
                    {s.platform && <span className="pulse-src-badge dim">{s.platform}</span>}
                  </div>
                  <a className="pulse-src-url" href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
                  <div className={"pulse-src-health" + (errored ? " is-err" : "")}>
                    {errored ? s.lastStatus : `ok · +${s.itemCount ?? 0} last run`}
                    {" · "}{fmtWhen(s.lastFetchedAt)}
                  </div>
                </div>
                <button className="pulse-src-del" onClick={() => remove(s)} title="Stop monitoring">🗑</button>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
