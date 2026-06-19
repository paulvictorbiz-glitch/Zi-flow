/* =========================================================
   ReelAssetsAuto — PURE-ish, props-driven panel that renders the
   WORKER-produced downloadable asset LAYERS for a reel (NOT the manual
   `reel_dna_assets` join table — this file MUST NOT import
   reel-assets.jsx or reel-dna-assets.jsx).

   Contract H8 + H3. Reads `item.assetManifest` (camelCase, round-tripped
   by the store's three mappers from the `asset_manifest` jsonb the
   Hetzner worker writes):

     { base_video:{file,bytes,duration},
       audio:{file,bytes}|null,
       keyframes:[{file,cutIndex,ts}],
       scenes:{file,shotCount},
       base_dir:'reels/<id>', version:1 }

   ALL `file` values are BARE names; base_dir already = 'reels/<id>'
   (no /fb/). To download, we ask the API to MINT a short-lived signed
   URL (H2): POST /api/ai/suggest?action=sign-download with the owner's
   Supabase Bearer JWT + { id:item.id, file:<bare name> } → 200 { url }.
   We then anchor the browser to that signed `/fb/reels/<id>/<file>?...`
   URL (the /fb/ prefix lives ONLY in the returned URL, never in the
   HMAC message). The signed URL is single-use-ish (300s TTL) so we mint
   per click rather than caching.

   PURE props in; the only side effect is the per-click fetch+download
   the owner explicitly triggers. Null-safe: renders nothing when the
   manifest is missing (capture-form rows have NULL asset_manifest until
   the worker fills it).
   ========================================================= */

import React, { useState, useCallback } from "react";
import { supabase } from "../lib/supabase-client.js";
import "./reel-assets-auto.css";

/* ---- pure guards / formatters (no NaN/undefined ever rendered) ---- */
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function fmtBytes(b) {
  if (!isNum(b) || b <= 0) return "";
  const u = ["B", "KB", "MB", "GB"];
  let n = b;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
function fmtDur(s) {
  if (!isNum(s) || s <= 0) return "";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : `0:${String(sec).padStart(2, "0")}`;
}

// Mirror the API-side guard (H2): id+file must each match this; the API
// re-validates, but rejecting early avoids a pointless round-trip.
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export default function ReelAssetsAuto({ item, isOwner }) {
  const [busy, setBusy] = useState(null); // currently-downloading bare file name
  const [err, setErr] = useState("");

  const manifest = item && item.assetManifest;

  /* Mint a signed URL for one bare file name, then anchor the browser to
     it so the asset downloads (Content-Disposition: attachment is set by
     vercel.json + the worker's FileResponse). Owner-only path. */
  const download = useCallback(
    async (file) => {
      if (!item || !item.id || typeof file !== "string") return;
      if (!SAFE_NAME.test(file)) {
        setErr("Bad file name");
        return;
      }
      setErr("");
      setBusy(file);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Not signed in");

        const res = await fetch("/api/ai/suggest?action=sign-download", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id: item.id, file }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body || typeof body.url !== "string") {
          throw new Error((body && body.error) || `Download sign failed (${res.status})`);
        }

        // Anchor-click to trigger a same-tab download. `download` attr +
        // server Content-Disposition: attachment keeps it from navigating.
        const a = document.createElement("a");
        a.href = body.url;
        a.download = file;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e) {
        setErr((e && e.message) || "Download failed");
      } finally {
        setBusy(null);
      }
    },
    [item],
  );

  // ── null-safety: no manifest → render nothing (H8). ──────────────────
  if (!manifest || typeof manifest !== "object") return null;

  const baseVideo = manifest.base_video && typeof manifest.base_video === "object" ? manifest.base_video : null;
  const audio = manifest.audio && typeof manifest.audio === "object" ? manifest.audio : null;
  const keyframes = Array.isArray(manifest.keyframes) ? manifest.keyframes : [];
  const scenes = manifest.scenes && typeof manifest.scenes === "object" ? manifest.scenes : null;

  // Nothing renderable at all → bail (defensive; worker always writes base_video).
  if (!baseVideo && !audio && keyframes.length === 0 && !scenes) return null;

  const canDownload = isOwner === true;

  const DLButton = ({ file, children, className }) => {
    if (!file || typeof file !== "string") return null;
    if (!canDownload) {
      return (
        <span className={`raa-dl raa-dl--locked ${className || ""}`} title="Owner only">
          {children}
        </span>
      );
    }
    return (
      <button
        type="button"
        className={`raa-dl ${className || ""}`}
        disabled={busy === file}
        onClick={() => download(file)}
        title={`Download ${file}`}
      >
        {busy === file ? "…" : children}
      </button>
    );
  };

  return (
    <div className="raa-panel">
      <div className="raa-head">
        <span className="raa-label">Auto Layers</span>
        {manifest.base_dir ? <span className="raa-dir">{manifest.base_dir}</span> : null}
      </div>

      {err ? <div className="raa-err">{err}</div> : null}

      <div className="raa-rows">
        {/* Base video */}
        {baseVideo && baseVideo.file ? (
          <div className="raa-row">
            <span className="raa-kind">VIDEO</span>
            <span className="raa-file">{baseVideo.file}</span>
            <span className="raa-meta">
              {[fmtDur(baseVideo.duration), fmtBytes(baseVideo.bytes)].filter(Boolean).join(" · ")}
            </span>
            <DLButton file={baseVideo.file}>Download</DLButton>
          </div>
        ) : null}

        {/* Audio (may be null — reels can be silent) */}
        {audio && audio.file ? (
          <div className="raa-row">
            <span className="raa-kind">AUDIO</span>
            <span className="raa-file">{audio.file}</span>
            <span className="raa-meta">{fmtBytes(audio.bytes)}</span>
            <DLButton file={audio.file}>Download</DLButton>
          </div>
        ) : null}

        {/* Scenes CSV */}
        {scenes && scenes.file ? (
          <div className="raa-row">
            <span className="raa-kind">SCENES</span>
            <span className="raa-file">{scenes.file}</span>
            <span className="raa-meta">
              {isNum(scenes.shotCount) ? `${scenes.shotCount} shots` : ""}
            </span>
            <DLButton file={scenes.file}>CSV</DLButton>
          </div>
        ) : null}
      </div>

      {/* Keyframe grid (one per detected cut) */}
      {keyframes.length > 0 ? (
        <div className="raa-keys">
          <div className="raa-keys-head">
            <span className="raa-label">Keyframes</span>
            <span className="raa-dir">{keyframes.length}</span>
          </div>
          <div className="raa-keys-grid">
            {keyframes.map((k, i) => {
              if (!k || typeof k !== "object" || typeof k.file !== "string") return null;
              const idx = isNum(k.cutIndex) ? k.cutIndex : i;
              const ts = isNum(k.ts) ? fmtDur(k.ts) : "";
              return (
                <DLButton key={`${k.file}-${i}`} file={k.file} className="raa-key">
                  <span className="raa-key-idx">#{idx}</span>
                  {ts ? <span className="raa-key-ts">{ts}</span> : null}
                </DLButton>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { ReelAssetsAuto };
