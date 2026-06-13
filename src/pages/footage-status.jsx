/* =========================================================
   Footage Status Sheet — batch-select folders for processing,
   track jobs live via Supabase realtime.
   ========================================================= */
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase-client.js";
import { getFootageBrainCoverageTree } from "../lib/footage-brain-client.js";
import { DPill } from "../components/components.jsx";

const STATUS_COLOR = { queued: "var(--fg-dim)", running: "var(--c-amber)", done: "var(--c-green)", error: "var(--c-red)" };

function JobBar({ job }) {
  const pct = job.file_count ? Math.round((job.files_done / job.file_count) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: STATUS_COLOR[job.status] || "var(--fg-dim)", minWidth: 52 }}>
        {job.status}
      </span>
      <div style={{ flex: 1, height: 6, background: "var(--bg-3, #1a2335)", borderRadius: 3 }}>
        <div style={{ width: pct + "%", height: "100%", background: STATUS_COLOR[job.status] || "var(--c-cyan)", borderRadius: 3, transition: "width 0.4s" }} />
      </div>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", minWidth: 32 }}>{pct}%</span>
    </div>
  );
}

export function FootageStatus() {
  const [tab, setTab] = useState("unprocessed");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [jobs, setJobs] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getFootageBrainCoverageTree()
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    supabase.from("processing_jobs").select("*").order("created_at", { ascending: false }).limit(100)
      .then(({ data: rows }) => { if (rows) setJobs(rows); });

    const ch = supabase.channel("processing_jobs_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "processing_jobs" }, payload => {
        setJobs(prev => {
          if (payload.eventType === "INSERT") return [payload.new, ...prev];
          if (payload.eventType === "UPDATE") return prev.map(j => j.id === payload.new.id ? payload.new : j);
          if (payload.eventType === "DELETE") return prev.filter(j => j.id !== payload.old.id);
          return prev;
        });
        if (payload.new?.status === "done") load();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  useEffect(() => {
    const hasRunning = jobs.some(j => j.status === "running");
    if (!hasRunning) return;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [jobs, load]);

  const allFolders = useMemo(() => {
    if (!data) return [];
    return data.roots.flatMap(root =>
      root.folders.map(f => ({ ...f, root_id: root.root_id, root_label: root.label }))
    );
  }, [data]);

  const unprocessed = useMemo(() => allFolders.filter(f => {
    const done = f.stage_counts?.transcript || 0;
    return done < (f.file_count || 0);
  }), [allFolders]);

  const needsDrive = useMemo(() => allFolders.filter(f => (f.drive_linked_count || 0) < (f.file_count || 0)), [allFolders]);
  const completed = useMemo(() => allFolders.filter(f => {
    const done = f.stage_counts?.transcript || 0;
    return done >= (f.file_count || 0) && f.file_count > 0;
  }), [allFolders]);

  const toggleSelect = (path) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  const toggleAll = () => {
    if (selected.size === unprocessed.length) setSelected(new Set());
    else setSelected(new Set(unprocessed.map(f => f.rel_path)));
  };

  const processSelected = async () => {
    if (!selected.size || submitting) return;
    setSubmitting(true);
    const rows = [...selected].map(path => {
      const folder = unprocessed.find(f => f.rel_path === path);
      return { folder_path: path, root_id: folder?.root_id, file_count: folder?.file_count, status: "queued" };
    });
    await supabase.from("processing_jobs").insert(rows);
    setSelected(new Set());
    setSubmitting(false);
  };

  const jobForFolder = (path) => jobs.find(j => j.folder_path === path && j.status !== "done" && j.status !== "error");

  return (
    <div>
      <div style={{ display: "flex", gap: 6, padding: "10px 22px 0", borderBottom: "1px solid var(--line-hard)" }}>
        {[["unprocessed", `Unprocessed (${unprocessed.length})`], ["needs_drive", `Needs Drive Link (${needsDrive.length})`], ["completed", `Completed (${completed.length})`]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ background: "none", border: "none", borderBottom: tab === k ? "2px solid var(--c-cyan)" : "2px solid transparent",
                     color: tab === k ? "var(--c-cyan)" : "var(--fg-dim)", fontFamily: "var(--f-mono)", fontSize: 12,
                     padding: "6px 12px", cursor: "pointer", marginBottom: -1 }}>
            {label}
          </button>
        ))}
      </div>

      {loading && <div className="dim" style={{ fontFamily: "var(--f-mono)", fontSize: 12, padding: "24px 22px" }}>Loading…</div>}
      {error && <div style={{ padding: "16px 22px", color: "var(--c-amber)", fontFamily: "var(--f-mono)", fontSize: 12 }}>{error}</div>}

      {!loading && !error && data && tab === "unprocessed" && (
        <div style={{ padding: "12px 22px" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <button onClick={toggleAll} style={{ background: "none", border: "1px solid var(--line-hard)", borderRadius: 3, color: "var(--fg-dim)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>
              {selected.size === unprocessed.length ? "Deselect all" : "Select all"}
            </button>
            {selected.size > 0 && (
              <button onClick={processSelected} disabled={submitting}
                style={{ background: "var(--c-cyan)", border: "none", borderRadius: 3, color: "#000", fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 600, padding: "4px 12px", cursor: "pointer" }}>
                {submitting ? "Queuing…" : `Process ${selected.size} folder${selected.size === 1 ? "" : "s"}`}
              </button>
            )}
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-dim)" }}>{selected.size} selected</span>
          </div>
          {unprocessed.length === 0 ? (
            <div className="dim" style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>All folders are fully transcribed.</div>
          ) : unprocessed.map(f => {
            const done = f.stage_counts?.transcript || 0;
            const remaining = (f.file_count || 0) - done;
            const job = jobForFolder(f.rel_path);
            return (
              <div key={f.rel_path} className="cov-row" style={{ alignItems: "flex-start" }}>
                <input type="checkbox" checked={selected.has(f.rel_path)} onChange={() => toggleSelect(f.rel_path)} style={{ marginTop: 2, marginRight: 8, cursor: "pointer" }} />
                <span className="cov-name mono" style={{ flex: 1 }}>{f.rel_path || "(root)"}<span className="dim" style={{ fontSize: 10 }}> · {f.root_label}</span></span>
                <span className="cov-meta">
                  <span className="mono dim">{f.file_count} total</span>
                  <span className="mono" style={{ color: "var(--c-cyan)" }}>{done} done</span>
                  <span className="mono" style={{ color: "var(--c-amber)" }}>{remaining} left</span>
                  {f.drive_folder_url && <a href={f.drive_folder_url} target="_blank" rel="noopener noreferrer" className="lib-reel-chip" style={{ cursor: "pointer" }}>↗ Drive</a>}
                </span>
                {job && <JobBar job={job} />}
              </div>
            );
          })}
        </div>
      )}

      {!loading && !error && data && tab === "needs_drive" && (
        <div style={{ padding: "12px 22px" }}>
          {needsDrive.length === 0 ? (
            <div className="dim" style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>All folders have Drive links.</div>
          ) : needsDrive.map(f => (
            <div key={f.rel_path} className="cov-row">
              <span className="cov-name mono">{f.rel_path || "(root)"}</span>
              <span className="cov-meta">
                <span className="mono dim">{f.file_count} total</span>
                <span className="mono" style={{ color: "var(--c-green)" }}>{f.drive_linked_count || 0} linked</span>
                <span className="mono" style={{ color: "var(--c-amber)" }}>{(f.file_count || 0) - (f.drive_linked_count || 0)} missing</span>
                {f.drive_folder_url && <a href={f.drive_folder_url} target="_blank" rel="noopener noreferrer" className="lib-reel-chip">↗ Drive</a>}
              </span>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && data && tab === "completed" && (
        <div style={{ padding: "12px 22px" }}>
          {completed.length === 0 ? (
            <div className="dim" style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>No folders fully transcribed yet.</div>
          ) : completed.map(f => (
            <div key={f.rel_path} className="cov-row">
              <span className="cov-name mono" style={{ color: "var(--c-green)" }}>✓ {f.rel_path || "(root)"}</span>
              <span className="cov-meta">
                <span className="mono dim">{f.file_count} files</span>
                <span className="mono" style={{ color: "var(--c-green)" }}>100% transcribed</span>
                {f.drive_folder_url && <a href={f.drive_folder_url} target="_blank" rel="noopener noreferrer" className="lib-reel-chip">↗ Drive</a>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
