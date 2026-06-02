/* =========================================================
   Coverage — FootageBrain per-country folder coverage tree.

   Sourced from the public GET /api/dashboard/coverage-tree.
   Each scan-root expands into its country folders; every folder
   shows file count, how much is transcribed, and (when known) a
   button that opens the Google Drive folder that footage lives in.

   Per product decision: selecting a folder opens its Drive folder
   in a new tab — the fastest path from "find footage" to the files.
   ========================================================= */

import React, { useEffect, useMemo, useState } from "react";
import { DPill } from "../components/components.jsx";
import { getFootageBrainCoverageTree } from "../lib/footage-brain-client.js";

/* transcript completion % for a folder/root, from its stage_counts. */
function transcribedPct(node) {
  const total = node.file_count || 0;
  if (!total) return 0;
  const done = (node.stage_counts && node.stage_counts.transcript) || 0;
  return Math.round((done / total) * 100);
}

function CoverageRow({ folder }) {
  const pct = transcribedPct(folder);
  const hasDrive = !!folder.drive_folder_url;
  const openDrive = () => {
    if (hasDrive) window.open(folder.drive_folder_url, "_blank", "noopener,noreferrer");
  };
  return (
    <div
      className="cov-row"
      style={{ cursor: hasDrive ? "pointer" : "default" }}
      onClick={openDrive}
      title={hasDrive ? "Open this folder's footage in Google Drive" : "No Drive folder linked yet"}
    >
      <span className="cov-name mono">
        {folder.rel_path || <span className="dim">(root)</span>}
      </span>
      <span className="cov-meta">
        <span className="cov-files mono dim">
          {folder.file_count} {folder.file_count === 1 ? "file" : "files"}
        </span>
        <span className="cov-pct mono" style={{ color: pct >= 100 ? "var(--c-green, #4ade80)" : "var(--fg-dim)" }}>
          {pct}% transcribed
        </span>
        <span className="cov-linked mono dim">
          {folder.drive_linked_count || 0} linked
        </span>
        <span className="cov-drive">
          {hasDrive ? (
            <span className="lib-reel-chip" style={{ cursor: "pointer" }}>↗ Drive</span>
          ) : (
            <span className="dim" style={{ fontSize: 10.5 }}>no link</span>
          )}
        </span>
      </span>
    </div>
  );
}

function RootSection({ root, query }) {
  const [open, setOpen] = useState(true);
  const folders = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? root.folders.filter(f => (f.rel_path || "").toLowerCase().includes(q))
      : root.folders;
    return list;
  }, [root.folders, query]);

  const rootPct = transcribedPct(root);
  const linkedTotal = root.folders.reduce((n, f) => n + (f.drive_linked_count || 0), 0);

  if (query.trim() && folders.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 12, overflow: "hidden" }}>
      <div className="cov-root-head" onClick={() => setOpen(o => !o)}>
        <span className="mono dim" style={{ width: 14 }}>{open ? "▾" : "▸"}</span>
        <div className="cov-root-label" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--fg)", fontSize: 13, fontWeight: 600 }}>{root.label}</span>
            {!root.is_online && <DPill tone="amber">offline</DPill>}
          </div>
          <div className="mono dim" style={{ fontSize: 10, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{root.path}</div>
        </div>
        <span className="cov-root-meta mono dim" style={{ fontSize: 11 }}>
          {root.file_count} files · {root.folders.length} folders · {linkedTotal} Drive-linked · {rootPct}% transcribed
        </span>
      </div>
      {open && (
        <div style={{ borderTop: "1px dashed var(--line-hard)" }}>
          {folders.length === 0 ? (
            <div className="dim" style={{ padding: "16px 14px", fontFamily: "var(--f-mono)", fontSize: 12 }}>
              No folders.
            </div>
          ) : (
            folders.map(f => <CoverageRow key={f.rel_path || "(root)"} folder={f} />)
          )}
        </div>
      )}
    </div>
  );
}

function Coverage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getFootageBrainCoverageTree()
      .then(d => { if (alive) { setData(d); setError(null); } })
      .catch(e => { if (alive) setError(e.message || String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const totals = useMemo(() => {
    if (!data) return { files: 0, folders: 0, linked: 0 };
    let files = 0, folders = 0, linked = 0;
    for (const r of data.roots) {
      files += r.file_count || 0;
      folders += r.folders.length;
      linked += r.folders.reduce((n, f) => n + (f.drive_linked_count || 0), 0);
    }
    return { files, folders, linked };
  }, [data]);

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Coverage</h1>
          <div className="sub">
            Footage organised by folder. Each row shows how much is transcribed and
            opens that folder in Google Drive. Click a folder to jump to its footage.
          </div>
        </div>
        <div className="actions">
          {data && (
            <>
              <DPill>{totals.files} files</DPill>
              <DPill>{totals.folders} folders</DPill>
              <DPill>{totals.linked} Drive-linked</DPill>
            </>
          )}
        </div>
      </div>

      <div style={{ padding: "0 22px 14px", display: "flex", gap: 12, alignItems: "center" }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter folders by name (e.g. Syria, Taiwan)…"
          style={{
            flex: 1, background: "var(--bg-2)", border: "1px dashed var(--line-hard)",
            borderRadius: 4, color: "var(--fg)", fontFamily: "var(--f-mono)",
            fontSize: 12, padding: "8px 12px",
          }}
        />
      </div>

      <div className="exp-scroll" style={{ padding: "0 22px 24px" }}>
        {loading && (
          <div className="dim" style={{ fontFamily: "var(--f-mono)", fontSize: 12, padding: "24px 0" }}>
            Loading coverage…
          </div>
        )}
        {error && !loading && (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ color: "var(--c-amber, #f59e0b)", fontFamily: "var(--f-mono)", fontSize: 12 }}>
              Couldn’t load coverage from FootageBrain.
            </div>
            <div className="mono dim" style={{ fontSize: 11, marginTop: 6 }}>{error}</div>
          </div>
        )}
        {!loading && !error && data && data.roots.length === 0 && (
          <div className="dim" style={{ fontFamily: "var(--f-mono)", fontSize: 12, padding: "24px 0" }}>
            No scannable drives configured in FootageBrain yet.
          </div>
        )}
        {!loading && !error && data &&
          data.roots.map(root => <RootSection key={root.root_id} root={root} query={query} />)}
      </div>
    </div>
  );
}

export { Coverage };
