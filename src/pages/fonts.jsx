/* Fonts — owner-only font identification from a reel frame.

   Upload/paste a screenshot OR paste a reel URL → the image (or server-extracted
   keyframes) go to the Hetzner content-forge worker via api/ai/suggest.js
   (?action=font-id | font-id-keyframes) → Gemini vision returns the top-3 likely
   typefaces with a confidence score + honest "likely a preset" fallback, each with
   a LEGITIMATE download link (Google Fonts specimen / search — never a piracy mirror).

   Phase 1 is Gemini-vision only. The same kill switch / daily cap + usage telemetry
   the rest of Content Forge uses gate every call (see the Monitor budgets card).

   Owner-only: useIsOwner() + app.jsx gates the tab on isOwner. */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useIsOwner } from "../lib/permissions.jsx";
import "../fonts.css";

/* The ~30 most-common short-form caption fonts (kept in sync with the backend
   CAPCUT_PRESET_FONTS constant). Used only for the "many captions are presets" hint. */
const CAPCUT_PRESET_HINT =
  "Montserrat · Poppins · Bebas Neue · Anton · Oswald · Roboto Condensed · Archivo · Inter";

/* ── Legit download-link resolver — Google Fonts first, safe search fallback.
   NEVER links a font-file mirror. For non-Google faces we point at the foundry-
   neutral Google Fonts search + WhatFontIs so the owner can chase the license. */
const gfSpecimen = (name) =>
  `https://fonts.google.com/specimen/${(name || "").trim().replace(/\s+/g, "+")}`;
const gfSearch = (name) =>
  `https://fonts.google.com/?query=${encodeURIComponent((name || "").trim())}`;
const wfiSearch = () => "https://www.whatfontis.com/";

function POST(action, payload) {
  return fetch(`/api/ai/suggest?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  });
}

function ConfidenceBar({ value }) {
  const pct = Math.round((value || 0) * 100);
  const tone = pct >= 70 ? "high" : pct >= 40 ? "mid" : "low";
  return (
    <div className="fi-conf" title={`${pct}% confidence`}>
      <div className={`fi-conf-fill ${tone}`} style={{ width: `${pct}%` }} />
      <span className="fi-conf-pct">{pct}%</span>
    </div>
  );
}

function MatchCard({ m, rank }) {
  const preset = m.is_probably_preset;
  const gfName = m.google_fonts_guess || m.family;
  return (
    <div className={`fi-match${preset ? " preset" : ""}`}>
      <div className="fi-match-head">
        <span className="fi-rank">#{rank}</span>
        <span className="fi-family">{m.family}</span>
        <ConfidenceBar value={m.confidence} />
      </div>
      {m.rationale && <p className="fi-rationale">{m.rationale}</p>}
      {preset ? (
        <div className="fi-preset-note">
          <span className="fi-chip warn">likely an editor preset</span>
          <span>
            Often a bundled CapCut/InShot/Instagram caption style — not always an
            installable font. Closest free look-alike:{" "}
            <strong>{gfName}</strong>.
          </span>
        </div>
      ) : null}
      <div className="fi-links">
        <a className="fi-link primary" href={gfSpecimen(gfName)} target="_blank" rel="noreferrer">
          Google Fonts ↗
        </a>
        <a className="fi-link" href={gfSearch(gfName)} target="_blank" rel="noreferrer">
          Search Google Fonts
        </a>
        <a className="fi-link" href={wfiSearch()} target="_blank" rel="noreferrer">
          WhatFontIs
        </a>
      </div>
    </div>
  );
}

export default function Fonts() {
  const isOwner = useIsOwner();
  const [mode, setMode] = useState("upload"); // "upload" | "url"
  const [image, setImage] = useState(null);   // data-URL
  const [reelUrl, setReelUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState("");
  const [result, setResult] = useState(null);  // { matches, notes, provider, frame_count? }
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const readFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage(reader.result);
      setResult(null);
      setError("");
      setBlocked("");
    };
    reader.readAsDataURL(file);
  }, []);

  /* Paste an image straight from the clipboard (owner grabs a frame, Ctrl-V). */
  useEffect(() => {
    if (mode !== "upload") return undefined;
    const onPaste = (e) => {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type && it.type.startsWith("image/")) {
          const file = it.getAsFile();
          if (file) { readFile(file); e.preventDefault(); return; }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [mode, readFile]);

  const runIdentify = useCallback(async () => {
    setLoading(true);
    setError("");
    setBlocked("");
    setResult(null);
    try {
      const data =
        mode === "upload"
          ? await POST("font-id", { image })
          : await POST("font-id-keyframes", { url: reelUrl.trim() });
      if (data.blocked) { setBlocked(data.error || "Daily limit reached."); return; }
      if (!data.ok) { setError(data.error || "Identification failed."); return; }
      setResult(data);
    } catch (e) {
      setError(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [mode, image, reelUrl]);

  if (!isOwner) {
    return <div className="fi-root"><p className="fi-muted">Fonts is an owner-only tool.</p></div>;
  }

  const canRun = mode === "upload" ? !!image : reelUrl.trim().length > 6;

  return (
    <div className="fi-root">
      <div className="fi-header">
        <h2>Font ID</h2>
        <span className="fi-count">
          Identify the font in a reel frame · top-3 matches + download links
        </span>
      </div>

      <div className="fi-modes">
        <button
          className={`fi-tab${mode === "upload" ? " active" : ""}`}
          onClick={() => { setMode("upload"); setResult(null); setError(""); setBlocked(""); }}
        >
          Screenshot
        </button>
        <button
          className={`fi-tab${mode === "url" ? " active" : ""}`}
          onClick={() => { setMode("url"); setResult(null); setError(""); setBlocked(""); }}
        >
          Reel URL
        </button>
      </div>

      {mode === "upload" ? (
        <div
          className={`fi-drop${dragOver ? " over" : ""}${image ? " has-image" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            readFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileRef.current?.click()}
        >
          {image ? (
            <img className="fi-preview" src={image} alt="frame to identify" />
          ) : (
            <div className="fi-drop-hint">
              <strong>Drop a screenshot</strong>, click to choose, or paste (⌘/Ctrl-V)
              <span className="fi-muted">PNG/JPG · crop tight to the caption text for the best match</span>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => readFile(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div className="fi-url">
          <input
            type="text"
            placeholder="Paste a reel / short / TikTok URL…"
            value={reelUrl}
            onChange={(e) => setReelUrl(e.target.value)}
          />
          <span className="fi-muted">
            We download a few frames server-side and identify the clearest caption's font.
          </span>
        </div>
      )}

      <div className="fi-actions">
        <button className="fi-btn primary" disabled={!canRun || loading} onClick={runIdentify}>
          {loading ? "Identifying…" : "Identify font"}
        </button>
        {mode === "upload" && image && (
          <button className="fi-btn" disabled={loading} onClick={() => { setImage(null); setResult(null); }}>
            Clear
          </button>
        )}
      </div>

      <p className="fi-preset-hint fi-muted">
        Heads up: many reel captions use bundled editor presets ({CAPCUT_PRESET_HINT}…) rather
        than installable fonts — results flag those honestly.
      </p>

      {blocked && (
        <div className="fi-banner blocked">
          <strong>Daily limit reached.</strong> {blocked} Adjust it on the Monitor → API Budgets card.
        </div>
      )}
      {error && <div className="fi-banner error">{error}</div>}

      {result && (
        <div className="fi-results">
          <div className="fi-results-head">
            <span>Top matches</span>
            <span className="fi-muted">
              {result.provider ? `via ${result.provider}` : ""}
              {result.frame_count ? ` · ${result.frame_count} frames sampled` : ""}
            </span>
          </div>
          {result.matches?.length ? (
            result.matches.map((m, i) => <MatchCard key={i} m={m} rank={i + 1} />)
          ) : (
            <p className="fi-muted">No confident match — the text may be too small, stylized, or a custom face.</p>
          )}
          {result.notes && <p className="fi-notes fi-muted">Note: {result.notes}</p>}
          <p className="fi-disclaimer fi-muted">
            Font ID is a best guess from letterforms — cross-check before licensing. Download links
            point only to Google Fonts / legitimate search, never file mirrors.
          </p>
        </div>
      )}
    </div>
  );
}
