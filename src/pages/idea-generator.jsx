/* =========================================================
   Idea Generator — type an idea, get title + description +
   real footage clips with timestamps. History persists in
   localStorage so past queries are always accessible.
   ========================================================= */

import React, { useState, useRef, useEffect } from "react";
import { DPill } from "../components/components.jsx";
import { footageBrainThumbnailUrl } from "../lib/footage-brain-client.js";
import { useWorkflow } from "../store/store.jsx";

const HISTORY_KEY = "gen_history_v1";
const MAX_HISTORY = 20;

const EXAMPLE_PROMPTS = [
  "Buddhist temple festival — crowd, bells, prayer",
  "Night street food market — close-ups, steam, faces",
  "Drone reveal of a mountain valley at sunrise",
  "Busy city intersection — time of day contrast",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}
function saveHistory(entry) {
  const prev = loadHistory();
  const next = [entry, ...prev.filter(h => h.prompt !== entry.prompt)].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

function nextReelId(reels) {
  const nums = (reels || [])
    .map(r => { const m = /^REEL-(\d+)$/.exec(r?.id || ""); return m ? parseInt(m[1], 10) : -1; })
    .filter(n => n >= 0);
  const next = nums.length ? Math.max(...nums) + 1 : 0;
  return "REEL-" + String(next).padStart(3, "0");
}

// ---------------------------------------------------------------------------
// Clip row
// ---------------------------------------------------------------------------

function ClipRow({ clip, index }) {
  const thumb = clip.thumbnail_path ? footageBrainThumbnailUrl(clip.thumbnail_path) : null;
  const tc = (clip.timecode_in && clip.timecode_out)
    ? `${clip.timecode_in} – ${clip.timecode_out}`
    : null;

  return (
    <div className="gen-shot">
      <span className="gen-shot-num mono dim">{String(index + 1).padStart(2, "0")}</span>
      {thumb
        ? <img className="gen-shot-thumb" src={thumb} alt="" />
        : <div className="gen-shot-thumb" style={{ background: "var(--bg-2)" }} />
      }
      <div className="gen-shot-body">
        <div className="gen-shot-file mono">{clip.filename}</div>
        {tc && <div className="gen-shot-tc mono dim">{tc}</div>}
        {clip.note && <div className="gen-shot-dir dim">{clip.note}</div>}
      </div>
      <div className="gen-dl-links">
        {clip.drive_url
          ? <a className="dpill" href={clip.drive_url} target="_blank" rel="noopener noreferrer">↗ Drive</a>
          : <span className="mono dim" style={{ fontSize: 10 }}>no link</span>
        }
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History sidebar entry
// ---------------------------------------------------------------------------

function HistoryItem({ entry, onSelect, onDelete }) {
  return (
    <div className="gen-hist-item">
      <div className="gen-hist-prompt" onClick={() => onSelect(entry)} title={entry.prompt}>
        {entry.prompt.slice(0, 55)}{entry.prompt.length > 55 ? "…" : ""}
      </div>
      <div className="gen-hist-meta mono dim">
        {entry.draft?.title ? entry.draft.title.slice(0, 40) : ""}
        <span style={{ marginLeft: 6 }}>
          · {(entry.draft?.clips || []).length} clips
        </span>
      </div>
      <button className="gen-hist-del" onClick={() => onDelete(entry.prompt)} title="Remove from history">×</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function IdeaGenerator() {
  const [prompt, setPrompt]     = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [result, setResult]     = useState(null);
  const [created, setCreated]   = useState(null);
  const [history, setHistory]   = useState(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const textareaRef             = useRef(null);

  const { actions, reels } = useWorkflow();

  const draft = result?.draft;
  const meta  = result?.meta;

  const isLocal = typeof window !== "undefined" &&
    /^(localhost|127\.0\.0\.1|::1)$/.test(window.location.hostname);

  const generate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setCreated(null);
    try {
      const endpoint = isLocal ? "http://localhost:3001/api/generate" : "/api/generate";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), type: "reel" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.error === "no_footage") throw new Error("No matching footage found. Try a different prompt.");
      setResult(data);
      // Save to history
      const entry = { prompt: prompt.trim(), draft: data.draft, ts: Date.now() };
      saveHistory(entry);
      setHistory(loadHistory());
    } catch (e) {
      setError(e.message || "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const loadFromHistory = (entry) => {
    setPrompt(entry.prompt);
    setResult({ draft: entry.draft, meta: {} });
    setCreated(null);
    setError(null);
    setShowHistory(false);
  };

  const deleteFromHistory = (promptText) => {
    const next = loadHistory().filter(h => h.prompt !== promptText);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    setHistory(next);
  };

  const copyDriveLinks = () => {
    if (!draft?.clips) return;
    const text = (draft.clips || [])
      .filter(c => c.drive_url)
      .map(c => `${c.filename}  ${c.timecode_in || ""}–${c.timecode_out || ""}\n${c.drive_url}`)
      .join("\n\n");
    navigator.clipboard?.writeText(text);
  };

  const createReelFromDraft = () => {
    if (!draft) return;
    const newId = nextReelId(reels);
    const reel = {
      id: newId,
      title: draft.title || "Generated reel",
      stage: "not_started",
      owner: "paul",
      lane: "paul",
      state: "ok",
      age: "just now",
      due: null,
      stageEnteredAt: new Date().toISOString(),
      fb: (draft.clips || []).length,
      refs: 0,
      blocker: null,
      next: "Review AI-selected footage and begin edit",
      downstream: null,
      grouping: "not_started",
      logline: draft.description || "",
      vo: null, audio: null, inspo: null, plan: null,
    };

    actions.createReel(reel);

    // Attach clips — store timecodes visibly in matched_chunks text
    (draft.clips || []).forEach((clip, i) => {
      const tc = (clip.timecode_in && clip.timecode_out)
        ? `${clip.timecode_in}–${clip.timecode_out}`
        : null;
      const noteText = [tc, clip.note].filter(Boolean).join(" · ");

      actions.addAttachedFootage({
        id: `${newId}-clip-${i}-${Date.now()}`,
        reel_id: newId,
        footage_file_id: clip.clip_id || clip.filename,
        filename: clip.filename,
        source_path: clip.filename,
        extension: clip.filename?.split(".").pop() || "",
        duration_seconds: clip.duration_seconds || null,
        thumbnail_url: clip.thumbnail_path || null,
        width: null,
        height: null,
        is_vertical: clip.is_vertical || false,
        best_score: 1,
        // Store timecode + note as the chunk text so the reel card shows it
        matched_chunks: noteText
          ? [{
              text: noteText,
              start_time: parseFloat((clip.timecode_in || "0").replace(":", ".")) || 0,
              end_time: parseFloat((clip.timecode_out || "0").replace(":", ".")) || 0,
              score: 1,
            }]
          : [],
      });
    });

    setCreated({ id: newId, reel });
    // Don't auto-navigate — let React flush all attachment dispatches first.
    // User taps "View reel →" to open it manually.
  };

  return (
    <div className="gen-root">
      <div className="page-head">
        <div className="titles">
          <h1>Generate</h1>
          <div className="sub">Describe a reel idea — Claude picks footage from your library.</div>
        </div>
        <div className="actions">
          {meta && (
            <>
              <DPill>{meta.clips_searched || 0} clips searched</DPill>
              <DPill>{(draft?.clips || []).length} selected</DPill>
            </>
          )}
          <DPill onClick={() => setShowHistory(v => !v)}>
            {showHistory ? "Hide history" : `History (${history.length})`}
          </DPill>
        </div>
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="gen-hist-panel">
          <div className="mono dim" style={{ fontSize: 10, marginBottom: 8 }}>
            PAST QUERIES — click to restore · saved on this browser only
          </div>
          {history.length === 0 ? (
            <div className="mono dim" style={{ fontSize: 11, padding: "8px 0" }}>
              No history on this browser yet. History is saved per device.
            </div>
          ) : history.map((entry, i) => (
            <HistoryItem
              key={i}
              entry={entry}
              onSelect={loadFromHistory}
              onDelete={deleteFromHistory}
            />
          ))}
        </div>
      )}

      {/* Input */}
      <div className="gen-input-panel">
        <textarea
          ref={textareaRef}
          className="gen-textarea"
          placeholder="Describe your reel idea — location, mood, moment…"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }}
          rows={2}
          disabled={loading}
        />
        {!prompt && !result && (
          <div className="gen-examples">
            <span className="mono dim" style={{ fontSize: 10 }}>try:</span>
            {EXAMPLE_PROMPTS.map((p, i) => (
              <span key={i} className="gen-example-chip"
                onClick={() => { setPrompt(p); textareaRef.current?.focus(); }}>
                {p}
              </span>
            ))}
          </div>
        )}
        <div className="gen-actions">
          <DPill primary onClick={generate}
            disabled={loading || !prompt.trim()}
            style={{ opacity: (!prompt.trim() || loading) ? 0.45 : 1 }}>
            {loading ? "Finding footage…" : "✦ Generate"}
          </DPill>
          {(prompt || result) && !loading && (
            <DPill onClick={() => { setPrompt(""); setResult(null); setError(null); setCreated(null); }}>Clear</DPill>
          )}
        </div>
      </div>

      {error && (
        <div className="gen-error">
          <span style={{ color: "var(--c-amber)" }}>⚠ {error}</span>
        </div>
      )}

      {loading && (
        <div className="gen-loading">
          <div className="gen-loading-bar" />
          <span className="mono dim" style={{ fontSize: 11, marginTop: 10 }}>
            Searching footage · matching transcripts…
          </span>
        </div>
      )}

      {draft && !loading && (
        <div className="gen-results">
          <div className="gen-draft-head">
            <div className="gen-draft-title">{draft.title || "Untitled"}</div>
            {draft.description && <div className="gen-draft-desc">{draft.description}</div>}
          </div>

          <div className="gen-clips-header">
            <span className="mono dim" style={{ fontSize: 10 }}>
              FOOTAGE · {(draft.clips || []).length} clips
            </span>
            {(draft.clips || []).some(c => c.drive_url) && (
              <DPill onClick={copyDriveLinks}>Copy all Drive links</DPill>
            )}
          </div>

          <div className="gen-shots-list">
            {(draft.clips || []).map((clip, i) => (
              <ClipRow key={i} clip={clip} index={i} />
            ))}
            {draft._raw && <pre className="gen-raw">{draft._raw}</pre>}
          </div>

          <div style={{ paddingTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {!created ? (
              <DPill primary onClick={createReelFromDraft}>+ Add to Pipeline</DPill>
            ) : (
              <>
                <span className="mono" style={{ fontSize: 11, color: "var(--c-cyan)" }}>
                  ✓ {created.id} added
                </span>
                <DPill onClick={() => {
                  if (window.__openReel) window.__openReel(created.reel);
                }}>
                  View reel →
                </DPill>
              </>
            )}
            <DPill onClick={generate} disabled={loading}>↺ Regenerate</DPill>
            <DPill onClick={() => { setResult(null); setPrompt(""); setCreated(null); }}>New idea</DPill>
          </div>
        </div>
      )}
    </div>
  );
}
