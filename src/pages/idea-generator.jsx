/* =========================================================
   Idea Generator — type an idea, get title + description +
   real footage clips with timestamps. History synced via
   Supabase (generated_drafts table) — works across all devices.
   ========================================================= */

import React, { useState, useRef, useEffect } from "react";
import { DPill } from "../components/components.jsx";
import { footageBrainThumbnailUrl } from "../lib/footage-brain-client.js";
import { useWorkflow } from "../store/store.jsx";
import { supabase } from "../lib/supabase-client.js";

const MAX_HISTORY = 20;

const EXAMPLE_PROMPTS = [
  "Buddhist temple festival — crowd, bells, prayer",
  "Night street food market — close-ups, steam, faces",
  "Drone reveal of a mountain valley at sunrise",
  "Busy city intersection — time of day contrast",
];

// Model picker (desktop). `anthropic` + `openrouter` run server-side via
// /api/generate; `puter` runs Claude client-side in the browser (free, no key).
const MODEL_OPTIONS = [
  { k: "anthropic",  l: "Claude (paid · best)" },
  { k: "puter",      l: "Claude (Puter · free)" },
  { k: "openrouter", l: "Llama 3.3 70B (OpenRouter · free)" },
];

// ---------------------------------------------------------------------------
// Daily usage counter (per-device). OpenRouter's free tier doesn't expose
// "queries remaining", so we count actual generations ourselves in
// localStorage, keyed by date. Gives a rough read on free-tier consumption
// (the OpenRouter ~50/day cap is shared across the key, so treat this as a
// floor, not an exact remaining count).
// ---------------------------------------------------------------------------
function todayKey() {
  return "gen_count_" + new Date().toISOString().slice(0, 10);
}
function readDailyCount() {
  try { return parseInt(localStorage.getItem(todayKey()) || "0", 10) || 0; }
  catch { return 0; }
}
function bumpDailyCount() {
  try {
    const n = readDailyCount() + 1;
    localStorage.setItem(todayKey(), String(n));
    return n;
  } catch { return readDailyCount(); }
}

// Short, readable model label for the usage pill.
function shortModelName(meta) {
  if (!meta) return "";
  if (meta.provider === "puter") return "Puter Claude";
  if (meta.model) {
    // "meta-llama/llama-3.3-70b-instruct:free" -> "llama-3.3-70b-instruct"
    return meta.model.split("/").pop().replace(/:free$/, "");
  }
  return meta.provider || "";
}

// ---------------------------------------------------------------------------
// Supabase history helpers
// ---------------------------------------------------------------------------

async function loadHistoryFromDB() {
  const { data, error } = await supabase
    .from("generated_drafts")
    .select("id, prompt, draft, created_at")
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY);
  if (error) return [];
  return data || [];
}

async function saveHistoryToDB(prompt, draft, reelId = null) {
  // Upsert by prompt — same idea regenerated replaces the old entry
  const { data: existing } = await supabase
    .from("generated_drafts")
    .select("id")
    .eq("prompt", prompt)
    .limit(1);
  if (existing?.length) {
    await supabase.from("generated_drafts")
      .update({ draft, reel_id: reelId, created_at: new Date().toISOString() })
      .eq("id", existing[0].id);
  } else {
    await supabase.from("generated_drafts").insert({ prompt, draft, reel_id: reelId });
  }
}

async function deleteHistoryFromDB(id) {
  await supabase.from("generated_drafts").delete().eq("id", id);
}

function nextReelId(reels) {
  const nums = (reels || [])
    .map(r => { const m = /^REEL-(\d+)$/.exec(r?.id || ""); return m ? parseInt(m[1], 10) : -1; })
    .filter(n => n >= 0);
  const next = nums.length ? Math.max(...nums) + 1 : 0;
  return "REEL-" + String(next).padStart(3, "0");
}

/* Render the AI draft into the plain-text shot plan that the Reel detail
   "Script / shot plan" tab shows. Includes hook, beat flow, and clip list. */
function buildShotPlan(draft) {
  const lines = [];
  if (draft.hook) {
    lines.push(`HOOK (0-3s):`, draft.hook, "");
  }
  if (Array.isArray(draft.flow) && draft.flow.length) {
    lines.push("FLOW:");
    draft.flow.forEach(b => {
      lines.push(`  [${b.timecode || "?"}] ${b.beat || ""} — ${b.direction || ""}`);
    });
    lines.push("");
  }
  if (Array.isArray(draft.clips) && draft.clips.length) {
    lines.push("SHOTS:");
    draft.clips.forEach((c, i) => {
      const tc = (c.timecode_in && c.timecode_out) ? `${c.timecode_in}–${c.timecode_out}` : "";
      lines.push(`  ${String(i + 1).padStart(2, "0")}. ${c.filename}  ${tc}`);
      if (c.note) lines.push(`      ${c.note}`);
    });
  }
  return lines.join("\n");
}

/* ---------------------------------------------------------------------------
   Client-side mirrors of the server's parseDraft + injectClipData. Used only
   by the Puter path, where the LLM runs in the browser so the server helpers
   (in api/generate.js) never execute. Keep these in sync with that file.
   --------------------------------------------------------------------------- */
function parseDraftClient(rawText, prompt) {
  try {
    let txt = (rawText || "").trim();
    txt = txt.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const jsonStart = txt.indexOf("{");
    const jsonEnd = txt.lastIndexOf("}") + 1;
    if (jsonStart === -1 || jsonEnd <= jsonStart) throw new Error("no JSON object found");
    return JSON.parse(txt.slice(jsonStart, jsonEnd));
  } catch (parseErr) {
    return {
      title: `Reel: ${prompt.slice(0, 50)}`,
      description: "(AI response could not be parsed — try Regenerate or another model)",
      clips: [],
      _raw: rawText,
      _parse_error: parseErr.message,
    };
  }
}

// Drop duplicate clip picks (the model sometimes repeats a video to hit a
// requested count). Keep first occurrence, keyed by clip_id then filename.
function dedupeClipsClient(clips) {
  if (!Array.isArray(clips)) return clips;
  const seen = new Set();
  return clips.filter(c => {
    const key = (c && (c.clip_id || c.filename)) || null;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function injectClipDataClient(draft, clips) {
  if (!draft || !Array.isArray(draft.clips)) return draft;
  const byId = Object.fromEntries((clips || []).map(c => [c.video_file_id, c]));
  draft.clips = dedupeClipsClient(draft.clips).map(clip => {
    const src = byId[clip.clip_id] || {};
    return {
      ...clip,
      drive_url: src.drive_url || clip.drive_url || null,
      drive_folder_url: src.drive_folder_url || clip.drive_folder_url || null,
      thumbnail_path: src.thumbnail_path || null,
      duration_seconds: src.duration_seconds || null,
      is_vertical: src.is_vertical ?? clip.is_vertical ?? false,
    };
  });
  return draft;
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
// SEO package — caption, description, hashtags (all click-to-copy)
// ---------------------------------------------------------------------------

function SeoPackage({ seo }) {
  const [copied, setCopied] = useState(null);
  const copy = (text, key) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1600);
  };
  const hashtags = (seo.hashtags || []).map(h => h.startsWith("#") ? h : "#" + h);

  return (
    <div className="gen-seo">
      <div className="gen-section-label mono">PUBLISH PACK</div>

      {seo.youtube_title && (
        <div className="gen-seo-block" onClick={() => copy(seo.youtube_title, "yt")}>
          <span className="gen-seo-tag mono">TITLE</span>
          <span className="gen-seo-val">{seo.youtube_title}</span>
          <span className="gen-copy-hint">{copied === "yt" ? "copied" : "copy"}</span>
        </div>
      )}

      {seo.ig_caption && (
        <div className="gen-seo-block" onClick={() => copy(seo.ig_caption, "cap")}>
          <span className="gen-seo-tag mono">IG CAPTION</span>
          <span className="gen-seo-val" style={{ whiteSpace: "pre-wrap" }}>{seo.ig_caption}</span>
          <span className="gen-copy-hint">{copied === "cap" ? "copied" : "copy"}</span>
        </div>
      )}

      {seo.description && (
        <div className="gen-seo-block" onClick={() => copy(seo.description, "desc")}>
          <span className="gen-seo-tag mono">DESCRIPTION</span>
          <span className="gen-seo-val">{seo.description}</span>
          <span className="gen-copy-hint">{copied === "desc" ? "copied" : "copy"}</span>
        </div>
      )}

      {hashtags.length > 0 && (
        <div className="gen-seo-block" onClick={() => copy(hashtags.join(" "), "tags")}>
          <span className="gen-seo-tag mono">HASHTAGS</span>
          <span className="gen-tags">
            {hashtags.map((h, i) => <span key={i} className="gen-tag mono">{h}</span>)}
          </span>
          <span className="gen-copy-hint">{copied === "tags" ? "copied" : "copy all"}</span>
        </div>
      )}
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
        <span style={{ marginLeft: 6 }}>· {(entry.draft?.clips || []).length} clips</span>
      </div>
      <button className="gen-hist-del" onClick={() => onDelete(entry.id)} title="Remove from history">×</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function IdeaGenerator() {
  const [prompt, setPrompt]     = useState("");
  const [model, setModel]       = useState("anthropic");
  const [genMode, setGenMode]   = useState("full");  // "full" pack or "quick" (title + clips)
  const [clipCount, setClipCount] = useState(5);     // quick mode: how many clips (1–10)
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [result, setResult]     = useState(null);
  const [created, setCreated]   = useState(null);
  const [history, setHistory]   = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [dailyCount, setDailyCount]   = useState(0);
  const textareaRef             = useRef(null);

  // Initialize today's generation count from localStorage on mount.
  useEffect(() => { setDailyCount(readDailyCount()); }, []);

  // Load history from Supabase on mount
  useEffect(() => {
    setHistLoading(true);
    loadHistoryFromDB().then(rows => { setHistory(rows); setHistLoading(false); });
  }, []);

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
    const q = prompt.trim();
    const endpoint = isLocal ? "http://localhost:3001/api/generate" : "/api/generate";
    const headers = { "Content-Type": "application/json" };
    try {
      let data;
      if (model === "puter") {
        // Puter runs Claude client-side in the browser (free, no key). The
        // server only does the footage search + prompt build (prepare_only),
        // then we call puter.ai.chat() here and parse/inject locally.
        if (!window.puter?.ai?.chat) {
          throw new Error("Puter.js didn't load. Reload the page (it needs the Puter script in <head>) and try again.");
        }
        const prepRes = await fetch(endpoint, {
          method: "POST", headers,
          body: JSON.stringify({
            prompt: q, type: "reel", prepare_only: true, mode: genMode,
            ...(genMode === "quick" ? { clip_count: clipCount } : {}),
          }),
        });
        const prep = await prepRes.json();
        if (!prepRes.ok) throw new Error(prep.error || `HTTP ${prepRes.status}`);
        if (prep.error === "no_footage") throw new Error("No matching footage found. Try a different prompt.");

        const resp = await window.puter.ai.chat(
          [
            { role: "system", content: prep.system },
            { role: "user", content: prep.userMessage },
          ],
          { model: "claude-sonnet-4" }   // Puter alias; falls back internally if unavailable
        );
        const rawText = typeof resp === "string"
          ? resp
          : (resp?.message?.content?.[0]?.text ?? resp?.text ?? String(resp));

        const draft = injectClipDataClient(parseDraftClient(rawText, q), prep.clips);
        data = { draft, meta: { ...prep.meta, provider: "puter" } };
      } else {
        // anthropic / openrouter — server does search + LLM + parse + inject.
        const res = await fetch(endpoint, {
          method: "POST", headers,
          body: JSON.stringify({
            prompt: q, type: "reel", provider: model, mode: genMode,
            ...(genMode === "quick" ? { clip_count: clipCount } : {}),
          }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (data.error === "no_footage") throw new Error("No matching footage found. Try a different prompt.");
      }

      setResult(data);
      setDailyCount(bumpDailyCount());
      // Save to Supabase history (fire-and-forget)
      saveHistoryToDB(q, data.draft).then(() =>
        loadHistoryFromDB().then(setHistory)
      );
    } catch (e) {
      setError(e.message || "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const loadFromHistory = (entry) => {
    setPrompt(entry.prompt);
    // Dedup clips for drafts saved before the dedup fix landed.
    const d = entry.draft
      ? { ...entry.draft, clips: dedupeClipsClient(entry.draft.clips || []) }
      : entry.draft;
    setResult({ draft: d, meta: {} });
    setCreated(null);
    setError(null);
    setShowHistory(false);
  };

  const deleteFromHistory = (id) => {
    deleteHistoryFromDB(id).then(() =>
      loadHistoryFromDB().then(setHistory)
    );
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

    // Build a readable shot-plan / blueprint for the reel's `script` field
    // (this is what the Reel detail "Script / shot plan" tab renders).
    const shotPlan = buildShotPlan(draft);

    const reel = {
      id: newId,
      title: draft.title || `Reel: ${(prompt || "").slice(0, 50)}`,
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
      script: shotPlan,
      vo: null, audio: null, inspo: null, plan: null,
      // Keep the full AI package on the reel so nothing is lost.
      detail: { aiDraft: draft },
    };

    // Build footage rows — dedup defensively so a reel never gets the same
    // video attached twice (covers drafts that predate the dedup fix).
    const footageItems = dedupeClipsClient(draft.clips || []).map((clip, i) => {
      const tc = (clip.timecode_in && clip.timecode_out)
        ? `${clip.timecode_in}–${clip.timecode_out}`
        : null;
      const noteText = [tc, clip.note].filter(Boolean).join(" · ");
      return {
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
        matched_chunks: noteText
          ? [{ text: noteText, start_time: 0, end_time: 0, score: 1 }]
          : [],
      };
    });

    // Single action that persists the reel FIRST, then the footage rows —
    // fixes the FK race that silently dropped every attachment before.
    actions.createReelWithFootage(reel, footageItems);

    // Link this generation's history row to the reel (best effort)
    if (result?.draft) {
      saveHistoryToDB(prompt.trim(), draft, newId).catch(() => {});
    }

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
              {(shortModelName(meta) || meta.output_tokens != null) && (
                <DPill title="Model used · output tokens this generation">
                  {shortModelName(meta)}
                  {meta.output_tokens != null ? ` · ${meta.output_tokens} tok` : ""}
                  {meta.mode === "quick" ? " · quick" : ""}
                </DPill>
              )}
            </>
          )}
          <DPill title="Generations run on this device today (rough free-tier usage)">
            {dailyCount} today
          </DPill>
          <DPill onClick={() => setShowHistory(v => !v)}>
            {showHistory ? "Hide history" : `History (${history.length})`}
          </DPill>
        </div>
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="gen-hist-panel">
          <div className="mono dim" style={{ fontSize: 10, marginBottom: 8 }}>
            PAST QUERIES — synced across all your devices
          </div>
          {histLoading ? (
            <div className="mono dim" style={{ fontSize: 11, padding: "8px 0" }}>Loading…</div>
          ) : history.length === 0 ? (
            <div className="mono dim" style={{ fontSize: 11, padding: "8px 0" }}>
              No history yet. Generate your first idea.
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
          <label className="gen-model-pick">
            <span className="mono dim" style={{ fontSize: 10 }}>model</span>
            <select
              className="gen-model-select"
              value={model}
              onChange={e => setModel(e.target.value)}
              disabled={loading}
            >
              {MODEL_OPTIONS.map(m => (
                <option key={m.k} value={m.k}>{m.l}</option>
              ))}
            </select>
          </label>
          <div className="gen-mode-toggle" role="group" aria-label="Generation depth">
            <button
              type="button"
              className={`gen-mode-btn${genMode === "full" ? " is-active" : ""}`}
              onClick={() => setGenMode("full")}
              disabled={loading}
              title="Full pack — hook, blueprint, clips, and SEO"
            >Full pack</button>
            <button
              type="button"
              className={`gen-mode-btn${genMode === "quick" ? " is-active" : ""}`}
              onClick={() => setGenMode("quick")}
              disabled={loading}
              title="Quick — just a title and the clips. Faster, fewer tokens."
            >Quick</button>
          </div>
          {genMode === "quick" && (
            <label className="gen-model-pick">
              <span className="mono dim" style={{ fontSize: 10 }}>clips</span>
              <select
                className="gen-model-select"
                value={clipCount}
                onChange={e => setClipCount(parseInt(e.target.value, 10))}
                disabled={loading}
                title="How many clips to select (up to 10)"
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          )}
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

          {/* Hook */}
          {draft.hook && (
            <div className="gen-hook-card">
              <div className="gen-hook-label mono">HOOK · first 3 seconds</div>
              <div className="gen-hook-text">"{draft.hook}"</div>
            </div>
          )}

          {/* Flow blueprint */}
          {Array.isArray(draft.flow) && draft.flow.length > 0 && (
            <div className="gen-section">
              <div className="gen-section-label mono">BLUEPRINT</div>
              <div className="gen-flow">
                {draft.flow.map((b, i) => (
                  <div key={i} className="gen-flow-beat">
                    <span className="gen-flow-tc mono">{b.timecode}</span>
                    <span className="gen-flow-name mono">{b.beat}</span>
                    <span className="gen-flow-dir">{b.direction}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

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

          {/* SEO package */}
          {draft.seo && <SeoPackage seo={draft.seo} />}

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
