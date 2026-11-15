/* =========================================================
   Drive-match review — kicks off a Drive-folder → footage
   filename match for one scan root, polls the async job, and
   lets the operator resolve ambiguous matches before writing.

   Backend contract (fire-and-forget + poll, per CLAUDE.md rule 7):
     POST /sources/{id}/link-drive          -> { job_id, status:"queued" }
     GET  /sources/{id}/link-drive/status   -> { status, auto_applied[],
                                                 ambiguous[], ... }
     POST /sources/{id}/link-drive/confirm  -> { results[], errors[] }
   ========================================================= */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Field } from "./modals/Modal.jsx";
import { DPill } from "./components.jsx";
import { linkDrive, linkDriveStatus, confirmDriveMatches } from "../lib/footage-brain-client.js";

const POLL_MS = 2500;
const SKIP = "__skip__";

export function DriveMatchReviewModal({ root, onClose, onDone }) {
  const [phase, setPhase] = useState("starting"); // starting | polling | review | error | done
  const [status, setStatus] = useState(null);
  const [picks, setPicks] = useState({});          // normalized_filename -> drive_file_id | SKIP
  const [err, setErr] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef(null);
  const jobRef = useRef(null);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const poll = useCallback(async () => {
    try {
      const s = await linkDriveStatus(root.id, jobRef.current);
      setStatus(s);
      if (s.status === "done") {
        stopPoll();
        setPhase("review");
      } else if (s.status === "failed") {
        stopPoll();
        setErr(s.error || "Drive-link job failed.");
        setPhase("error");
      }
    } catch (e) {
      stopPoll();
      setErr(e.message || String(e));
      setPhase("error");
    }
  }, [root.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const j = await linkDrive(root.id, root.drive_folder_url || undefined);
        if (cancelled) return;
        jobRef.current = j.job_id;
        setPhase("polling");
        poll();
        pollRef.current = setInterval(poll, POLL_MS);
      } catch (e) {
        if (cancelled) return;
        setErr(e.message || String(e));
        setPhase("error");
      }
    })();
    return () => { cancelled = true; stopPoll(); };
  }, [root.id, root.drive_folder_url, poll]);

  const ambiguous = status?.ambiguous || [];
  const autoCount = status?.high_confidence_applied ?? (status?.auto_applied?.length || 0);

  const submit = async () => {
    setSubmitting(true);
    try {
      const resolutions = ambiguous
        .filter(a => picks[a.normalized_filename] && picks[a.normalized_filename] !== SKIP)
        .map(a => ({ video_file_id: a.local_candidates[0]?.video_file_id, drive_file_id: picks[a.normalized_filename] }))
        // local candidate side is also ambiguous when reason includes it — the
        // operator picks the DRIVE file; the local file is the single one under
        // this normalized name unless reason is multiple_local_files/both, in
        // which case we skip (can't disambiguate the local side from a filename).
        .filter(r => r.video_file_id && r.drive_file_id);
      if (resolutions.length) {
        await confirmDriveMatches(root.id, resolutions);
      }
      setPhase("done");
      onDone?.();
    } catch (e) {
      setErr(e.message || String(e));
      setPhase("error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={`Link Drive · ${root.label || root.path}`}
      subtitle="Match Google Drive files to this source's footage by filename"
      onClose={onClose}
      onSubmit={phase === "review" && ambiguous.length ? submit : onClose}
      submitLabel={phase === "review" && ambiguous.length ? (submitting ? "Linking…" : "Apply picks") : "Close"}
    >
      {(phase === "starting" || phase === "polling") && (
        <div className="mono dim" style={{ fontSize: 12, padding: "8px 0" }}>
          Scanning Drive folder & matching filenames…
          {status ? ` (${status.drive_files_scanned || 0} Drive files scanned)` : ""}
        </div>
      )}

      {phase === "error" && (
        <div className="mono" style={{ fontSize: 12, color: "var(--c-amber)", padding: "8px 0" }}>{err}</div>
      )}

      {phase === "done" && (
        <div className="mono" style={{ fontSize: 12, color: "var(--c-green)", padding: "8px 0" }}>
          Done — {autoCount} auto-linked{ambiguous.length ? " + your picks applied" : ""}.
        </div>
      )}

      {phase === "review" && (
        <>
          <div className="mono" style={{ fontSize: 12, color: "var(--c-green)", marginBottom: 10 }}>
            ✓ {autoCount} file{autoCount === 1 ? "" : "s"} auto-linked (unique filename match).
          </div>
          {ambiguous.length === 0 ? (
            <div className="mono dim" style={{ fontSize: 12 }}>No ambiguous matches to review.</div>
          ) : (
            <>
              <div className="mono dim" style={{ fontSize: 11, marginBottom: 8 }}>
                {ambiguous.length} ambiguous match{ambiguous.length === 1 ? "" : "es"} — pick the correct Drive
                file per row, or skip. (Rows where the local side is also ambiguous can only be skipped here;
                use per-file tagging for those.)
              </div>
              {ambiguous.map(a => {
                const localAmbiguous = a.reason === "multiple_local_files" || a.reason === "both";
                return (
                  <Field key={a.normalized_filename} label={a.normalized_filename} hint={a.reason.replace(/_/g, " ")}>
                    <select
                      className="m-select"
                      value={picks[a.normalized_filename] ?? ""}
                      disabled={localAmbiguous}
                      onChange={e => setPicks(p => ({ ...p, [a.normalized_filename]: e.target.value || SKIP }))}
                    >
                      <option value="">{localAmbiguous ? "Local side ambiguous — skip" : "Choose…"}</option>
                      <option value={SKIP}>Skip (leave unlinked)</option>
                      {a.drive_candidates.map(d => (
                        <option key={d.drive_file_id} value={d.drive_file_id}>{d.name}</option>
                      ))}
                    </select>
                  </Field>
                );
              })}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
