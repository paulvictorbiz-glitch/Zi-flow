/* =========================================================
   Ingest Admin — register per-client scan roots, trigger
   scans, run Drive-folder filename matching, and bulk-reassign
   an existing root's footage to a different workspace.

   Every ingest action here is stamped to / scoped by the active
   top-bar workspace, mirroring the reels scoping pattern.
   ========================================================= */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Field } from "./modals/Modal.jsx";
import { DPill } from "./components.jsx";
import { useWorkspace } from "../lib/workspace.jsx";
import { DriveMatchReviewModal } from "./drive-match-review.jsx";
import {
  listScanRoots, addScanRoot, scanScanRoot, reassignScanRootWorkspace,
  syncRootToBox, syncStatus,
} from "../lib/footage-brain-client.js";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function ScanRootAdminPanel({ activeSlug, onChanged }) {
  const { workspaces } = useWorkspace();
  const [roots, setRoots] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  // Add-root form
  const [form, setForm] = useState({ path: "", label: "", recursive: true, drive_folder_url: "" });

  // Modal state
  const [driveRoot, setDriveRoot] = useState(null);       // root for DriveMatchReviewModal
  const [reassignRoot, setReassignRoot] = useState(null); // root for BulkReassignRootModal
  const [syncRoot, setSyncRoot] = useState(null);         // root for SyncToBoxModal

  const load = useCallback(async () => {
    try {
      const r = await listScanRoots();
      setRoots(r);
      setErr(null);
    } catch (e) { setErr(e.message || String(e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitAdd = async () => {
    if (!form.path.trim() || busy) return;
    setBusy(true);
    try {
      await addScanRoot({
        path: form.path.trim(),
        label: form.label.trim() || undefined,
        recursive: form.recursive,
        drive_folder_url: form.drive_folder_url.trim() || undefined,
        workspace_id: activeSlug,
      });
      setForm({ path: "", label: "", recursive: true, drive_folder_url: "" });
      await load();
      onChanged?.();
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const doScan = async (root) => {
    setBusy(true);
    try { await scanScanRoot(root.id); await load(); onChanged?.(); }
    catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: "14px 22px" }}>
      {err && <div className="mono" style={{ fontSize: 12, color: "var(--c-amber)", marginBottom: 10 }}>{err}</div>}

      {/* ── How this works ──────────────────────────────────────────────── */}
      <div className="mono dim" style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 14,
        border: "1px solid var(--line-soft)", borderRadius: 6, padding: "10px 12px" }}>
        This panel runs against the <strong>local</strong> FootageBrain backend on this machine.
        Register a folder on <strong>this computer</strong>, Scan to transcribe & index it locally,
        Link Drive so every clip has a shareable source, then <strong>Sync to box</strong> to
        publish the light data (metadata + transcripts + search vectors — never the raw video)
        so the team can search it in the app. Playback opens from Google Drive, so a file must be
        Drive-linked before it can be synced.
      </div>

      {/* ── Register a new scan root ─────────────────────────────────────── */}
      <div style={{ border: "1px solid var(--line-hard)", borderRadius: 6, padding: 14, marginBottom: 18 }}>
        <div className="mono" style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
          Register scan root → workspace <span style={{ color: "var(--c-cyan)" }}>{activeSlug}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label className="mono dim" style={{ fontSize: 11 }}>
            Folder path (on this machine)
            <input className="m-input" value={form.path} placeholder="D:\Footage\Client-X"
              onChange={e => setForm(f => ({ ...f, path: e.target.value }))} />
          </label>
          <label className="mono dim" style={{ fontSize: 11 }}>
            Label (optional)
            <input className="m-input" value={form.label} placeholder="Client X — Q3 shoot"
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
          </label>
          <label className="mono dim" style={{ fontSize: 11, gridColumn: "1 / -1" }}>
            Google Drive folder URL (optional — enables filename matching)
            <input className="m-input" value={form.drive_folder_url} placeholder="https://drive.google.com/drive/folders/…"
              onChange={e => setForm(f => ({ ...f, drive_folder_url: e.target.value }))} />
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
          <label className="mono dim" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={form.recursive}
              onChange={e => setForm(f => ({ ...f, recursive: e.target.checked }))} />
            Recursive
          </label>
          <DPill primary onClick={submitAdd}>{busy ? "Working…" : "Add scan root"}</DPill>
        </div>
      </div>

      {/* ── Existing scan roots ─────────────────────────────────────────── */}
      <div className="mono" style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Scan roots</div>
      {roots === null ? (
        <div className="mono dim" style={{ fontSize: 12 }}>Loading…</div>
      ) : roots.length === 0 ? (
        <div className="mono dim" style={{ fontSize: 12 }}>No scan roots yet.</div>
      ) : roots.map(r => (
        <div key={r.id} className="cov-row" style={{ alignItems: "flex-start" }}>
          <span className="cov-name mono" style={{ flex: 1 }}>
            {r.label || r.path}
            <span className="dim" style={{ fontSize: 10 }}> · {r.path}</span>
            <br />
            <span className="dim" style={{ fontSize: 10 }}>
              workspace <span style={{ color: "var(--c-cyan)" }}>{r.workspace_id || "paul"}</span>
              {" · "}{r.file_count ?? 0} files
              {" · "}
              <span style={{ color: (r.drive_linked_count ?? 0) < (r.file_count ?? 0) ? "var(--c-amber)" : "var(--c-green)" }}>
                {r.drive_linked_count ?? 0}/{r.file_count ?? 0} Drive-linked
              </span>
              {r.drive_folder_url ? " · Drive folder set" : " · no Drive folder"}
              {r.is_online === false ? " · OFFLINE" : ""}
            </span>
          </span>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <DPill onClick={() => doScan(r)}>Scan</DPill>
            <DPill onClick={() => setDriveRoot(r)}>Link Drive</DPill>
            <DPill onClick={() => setSyncRoot(r)}>Sync to box</DPill>
            <DPill onClick={() => setReassignRoot(r)}>Reassign</DPill>
          </span>
        </div>
      ))}

      {driveRoot && (
        <DriveMatchReviewModal
          root={driveRoot}
          onClose={() => setDriveRoot(null)}
          onDone={() => { load(); onChanged?.(); }}
        />
      )}
      {reassignRoot && (
        <BulkReassignRootModal
          root={reassignRoot}
          workspaces={workspaces}
          onClose={() => setReassignRoot(null)}
          onDone={() => { setReassignRoot(null); load(); onChanged?.(); }}
        />
      )}
      {syncRoot && (
        <SyncToBoxModal
          root={syncRoot}
          onClose={() => setSyncRoot(null)}
          onDone={() => { load(); onChanged?.(); }}
        />
      )}
    </div>
  );
}

/* Publish a root's Drive-linked footage to the box, then poll progress.
   Files without a Drive URL are skipped (playback on the box is Drive-only)
   and surfaced so the operator can link them first. */
function SyncToBoxModal({ root, onClose, onDone }) {
  const [phase, setPhase] = useState("starting"); // starting | running | done | error
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState(null);
  const pollRef = useRef(null);
  const jobRef = useRef(null);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const poll = useCallback(async () => {
    try {
      const s = await syncStatus(root.id, jobRef.current);
      setStatus(s);
      if (s.status === "done") { stopPoll(); setPhase("done"); onDone?.(); }
      else if (s.status === "failed") { stopPoll(); setErr(s.error || "Sync failed."); setPhase("error"); }
    } catch (e) { stopPoll(); setErr(e.message || String(e)); setPhase("error"); }
  }, [root.id, onDone]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const j = await syncRootToBox(root.id);
        if (cancelled) return;
        jobRef.current = j.job_id;
        setPhase("running");
        poll();
        pollRef.current = setInterval(poll, 2500);
      } catch (e) {
        if (cancelled) return;
        setErr(e.message || String(e));
        setPhase("error");
      }
    })();
    return () => { cancelled = true; stopPoll(); };
  }, [root.id, poll]);

  const unlinked = (root.file_count ?? 0) - (root.drive_linked_count ?? 0);

  return (
    <Modal
      title={`Sync to box · ${root.label || root.path}`}
      subtitle="Publish transcripts + search vectors to the team's index (Drive-linked files only)"
      onClose={onClose}
      onSubmit={onClose}
      submitLabel="Close"
    >
      {unlinked > 0 && (
        <div className="mono" style={{ fontSize: 11, color: "var(--c-amber)", marginBottom: 10 }}>
          {unlinked} file{unlinked === 1 ? "" : "s"} not yet Drive-linked — these will be skipped
          (not playable on the box). Link Drive first to include them.
        </div>
      )}
      {(phase === "starting" || phase === "running") && (
        <div className="mono dim" style={{ fontSize: 12, padding: "8px 0" }}>
          Publishing… {status ? `${status.files_synced}/${status.files_total || "?"} files · ${status.chunks_synced} chunks · ${status.vectors_synced} vectors` : ""}
        </div>
      )}
      {phase === "error" && (
        <div className="mono" style={{ fontSize: 12, color: "var(--c-amber)", padding: "8px 0" }}>{err}</div>
      )}
      {phase === "done" && status && (
        <div className="mono" style={{ fontSize: 12, color: "var(--c-green)", padding: "8px 0" }}>
          Synced {status.files_synced} file{status.files_synced === 1 ? "" : "s"} ·
          {" "}{status.chunks_synced} transcript chunks · {status.vectors_synced} vectors.
          {status.files_skipped_no_drive > 0 && (
            <span style={{ color: "var(--c-amber)" }}>
              {" "}{status.files_skipped_no_drive} skipped (no Drive link).
            </span>
          )}
        </div>
      )}
    </Modal>
  );
}

/* Bulk-reassign a root's existing files to a different workspace.
   dry-run preview → typed-label confirmation → commit. */
function BulkReassignRootModal({ root, workspaces, onClose, onDone }) {
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState(null);   // { affected_files, current_workspace }
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const options = useMemo(
    () => (workspaces || []).map(w => ({ slug: w.slug, name: w.name || w.slug })),
    [workspaces]
  );

  const runPreview = async (slug) => {
    setTarget(slug);
    setPreview(null);
    setTyped("");
    if (!slug || !SLUG_RE.test(slug)) return;
    setBusy(true);
    try {
      const p = await reassignScanRootWorkspace(root.id, slug, true);
      setPreview(p);
      setErr(null);
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (typed !== (root.label || root.path) || !target || busy) return;
    setBusy(true);
    try {
      await reassignScanRootWorkspace(root.id, target, false);
      onDone?.();
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const confirmName = root.label || root.path;
  const canCommit = preview && target && typed === confirmName && !busy;

  return (
    <Modal
      title={`Reassign · ${confirmName}`}
      subtitle="Move ALL of this root's footage to a different client workspace"
      onClose={onClose}
      onSubmit={canCommit ? commit : onClose}
      submitLabel={canCommit ? (busy ? "Reassigning…" : "Reassign") : "Close"}
    >
      {err && <div className="mono" style={{ fontSize: 12, color: "var(--c-amber)", marginBottom: 10 }}>{err}</div>}

      <Field label="Target workspace" hint={`current: ${root.workspace_id || "paul"}`}>
        <select className="m-select" value={target} onChange={e => runPreview(e.target.value)}>
          <option value="">Choose…</option>
          {options.map(o => <option key={o.slug} value={o.slug}>{o.name} ({o.slug})</option>)}
        </select>
      </Field>

      {busy && !preview && <div className="mono dim" style={{ fontSize: 12 }}>Previewing…</div>}

      {preview && (
        <>
          <div className="mono" style={{ fontSize: 12, margin: "10px 0" }}>
            This will move <strong style={{ color: "var(--c-amber)" }}>{preview.affected_files}</strong> file
            {preview.affected_files === 1 ? "" : "s"} from <strong>{preview.current_workspace || "paul"}</strong> to <strong>{target}</strong>.
          </div>
          <Field label={`Type "${confirmName}" to confirm`}>
            <input className="m-input" value={typed} onChange={e => setTyped(e.target.value)} />
          </Field>
        </>
      )}
    </Modal>
  );
}
