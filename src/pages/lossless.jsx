/* =========================================================
   Lossless — in-browser lossless cut/trim (ffmpeg.wasm).
   A LosslessCut-style tool that runs entirely in the browser:
   load a video, mark in/out point(s), and export the segment(s)
   LOSSLESSLY via stream copy (`ffmpeg -ss <in> -to <out> -c copy`).
   Instant, no re-encode, no quality loss. The file never leaves
   the machine.

   ── ffmpeg.wasm loading strategy (read before changing) ──
   We load ffmpeg.wasm DYNAMICALLY from a CDN (esm.sh) at runtime so
   we add ZERO npm dependencies to this Vite app:
     • @ffmpeg/ffmpeg@0.12.10  (the FFmpeg class / JS wrapper)
     • @ffmpeg/util@0.12.1     (toBlobURL, fetchFile helpers)
     • @ffmpeg/core@0.12.6     (the actual wasm — SINGLE-THREAD build)

   WHY the single-thread core: the multi-thread core needs
   SharedArrayBuffer, which the browser only exposes when the page is
   *cross-origin isolated* (COOP: same-origin + COEP: require-corp
   response headers). This app is served from Vercel WITHOUT those
   headers, so SharedArrayBuffer is unavailable and the MT core would
   throw on load. The single-thread core (`.../core@0.12.6/dist/esm`)
   needs no SAB and works everywhere — slower, but fine for cutting.

   The core (~30MB wasm) is fetched LAZILY: only when the user picks a
   file or clicks "Load engine", never on tab mount. If the CDN is
   blocked or loading otherwise fails we show a graceful error and the
   tab keeps working (you just can't export until the engine loads).

   ── Caveats ─────────────────────────────────────────────
   • Stream-copy cuts snap to the nearest keyframe, so the actual cut
     point can shift slightly from the requested time — inherent to
     lossless cutting (re-encoding would be frame-accurate but lossy).
   • Everything is held in browser memory (wasm FS + Blobs). Very large
     files (multi-GB) can exhaust memory/the 2GB wasm heap. For those,
     a future server-side ffmpeg path (e.g. the Hetzner backend) could
     stream-copy without loading the whole file into the tab.

   Keep the `LosslessCut` export — app.jsx imports it.
   ========================================================= */
import React, { useState, useEffect, useRef, useCallback } from "react";
import "./lossless.css";

/* CDN sources — single-thread core (no SharedArrayBuffer needed). */
const CDN = {
  ffmpeg: "https://esm.sh/@ffmpeg/ffmpeg@0.12.10",
  util: "https://esm.sh/@ffmpeg/util@0.12.1",
  coreBase: "https://esm.sh/@ffmpeg/core@0.12.6/dist/esm",
};

/* ── time helpers ───────────────────────────────────────── */
// seconds -> "mm:ss.mmm"
function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}
// "mm:ss.mmm" | "ss.mmm" | "ss" -> seconds (returns null if unparseable)
function parseTime(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  const parts = s.split(":");
  let sec = 0;
  try {
    if (parts.length === 1) {
      sec = parseFloat(parts[0]);
    } else if (parts.length === 2) {
      sec = parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
    } else if (parts.length === 3) {
      sec =
        parseInt(parts[0], 10) * 3600 +
        parseInt(parts[1], 10) * 60 +
        parseFloat(parts[2]);
    }
  } catch {
    return null;
  }
  return isFinite(sec) ? sec : null;
}
function extOf(name) {
  const i = name.lastIndexOf(".");
  return i > -1 ? name.slice(i + 1).toLowerCase() : "mp4";
}
function baseOf(name) {
  const i = name.lastIndexOf(".");
  return i > -1 ? name.slice(0, i) : name;
}
function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function LosslessCut() {
  // file / preview
  const [file, setFile] = useState(null);
  const [srcUrl, setSrcUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  // trim
  const [inPt, setInPt] = useState(0);
  const [outPt, setOutPt] = useState(0);
  const [inStr, setInStr] = useState("00:00.000");
  const [outStr, setOutStr] = useState("00:00.000");
  const [segments, setSegments] = useState([]); // { id, in, out }

  // engine
  const [engineState, setEngineState] = useState("idle"); // idle | loading | ready | error
  const [engineErr, setEngineErr] = useState("");

  // export
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [log, setLog] = useState([]);
  const [showLog, setShowLog] = useState(false);

  const videoRef = useRef(null);
  const ffmpegRef = useRef(null); // FFmpeg instance
  const utilRef = useRef(null); // { toBlobURL, fetchFile }
  const loadPromiseRef = useRef(null);

  const pushLog = useCallback((line) => {
    setLog((prev) => {
      const next = [...prev, line];
      return next.length > 400 ? next.slice(-400) : next;
    });
  }, []);

  /* ── cleanup object URL on change / unmount ───────────── */
  useEffect(() => {
    return () => {
      if (srcUrl) URL.revokeObjectURL(srcUrl);
    };
  }, [srcUrl]);

  /* ── lazy engine loader ───────────────────────────────── */
  const loadEngine = useCallback(async () => {
    if (engineState === "ready") return true;
    if (loadPromiseRef.current) return loadPromiseRef.current;

    setEngineState("loading");
    setEngineErr("");
    setStatus("Loading ffmpeg engine (single-thread core, ~30MB)…");
    setProgress(0);

    const p = (async () => {
      try {
        const ffmpegMod = await import(/* @vite-ignore */ CDN.ffmpeg);
        const utilMod = await import(/* @vite-ignore */ CDN.util);
        const { FFmpeg } = ffmpegMod;
        const { toBlobURL, fetchFile } = utilMod;
        utilRef.current = { toBlobURL, fetchFile };

        const ffmpeg = new FFmpeg();
        ffmpeg.on("log", ({ message }) => {
          if (message) pushLog(message);
        });
        ffmpeg.on("progress", ({ progress: pr }) => {
          if (typeof pr === "number" && isFinite(pr)) {
            setProgress(Math.max(0, Math.min(1, pr)));
          }
        });

        await ffmpeg.load({
          coreURL: await toBlobURL(`${CDN.coreBase}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${CDN.coreBase}/ffmpeg-core.wasm`, "application/wasm"),
        });

        ffmpegRef.current = ffmpeg;
        setEngineState("ready");
        setStatus("Engine ready.");
        setProgress(0);
        pushLog("[engine] ffmpeg.wasm loaded (single-thread core).");
        return true;
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        setEngineState("error");
        setEngineErr(msg);
        setStatus("");
        pushLog(`[engine] load failed: ${msg}`);
        loadPromiseRef.current = null; // allow retry
        return false;
      }
    })();

    loadPromiseRef.current = p;
    return p;
  }, [engineState, pushLog]);

  /* ── accept a picked / dropped file ───────────────────── */
  const acceptFile = useCallback(
    (f) => {
      if (!f) return;
      if (!f.type.startsWith("video/") && !/\.(mp4|mov|mkv|webm|avi|m4v|ts)$/i.test(f.name)) {
        setStatus("That doesn't look like a video file.");
        return;
      }
      if (srcUrl) URL.revokeObjectURL(srcUrl);
      const url = URL.createObjectURL(f);
      setFile(f);
      setSrcUrl(url);
      setDuration(0);
      setPlayhead(0);
      setInPt(0);
      setOutPt(0);
      setInStr("00:00.000");
      setOutStr("00:00.000");
      setSegments([]);
      setStatus(`Loaded ${f.name} (${(f.size / 1048576).toFixed(1)} MB).`);
      // warm up the engine in the background
      loadEngine();
    },
    [srcUrl, loadEngine]
  );

  const onPick = (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) acceptFile(f);
    e.target.value = "";
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) acceptFile(f);
  };

  /* ── video element wiring ─────────────────────────────── */
  const onLoadedMeta = () => {
    const v = videoRef.current;
    if (!v) return;
    const d = v.duration && isFinite(v.duration) ? v.duration : 0;
    setDuration(d);
    setOutPt(d);
    setOutStr(fmt(d));
  };
  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (v) setPlayhead(v.currentTime);
  };

  const seekTo = (t) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(duration || 0, t));
    v.currentTime = clamped;
    setPlayhead(clamped);
  };

  /* ── in/out setters ───────────────────────────────────── */
  const setInHere = () => {
    const t = playhead;
    setInPt(t);
    setInStr(fmt(t));
    if (t > outPt) {
      setOutPt(duration);
      setOutStr(fmt(duration));
    }
  };
  const setOutHere = () => {
    const t = playhead;
    setOutPt(t);
    setOutStr(fmt(t));
    if (t < inPt) {
      setInPt(0);
      setInStr(fmt(0));
    }
  };
  const commitIn = () => {
    const t = parseTime(inStr);
    if (t == null) {
      setInStr(fmt(inPt));
      return;
    }
    const c = Math.max(0, Math.min(duration || t, t));
    setInPt(c);
    setInStr(fmt(c));
  };
  const commitOut = () => {
    const t = parseTime(outStr);
    if (t == null) {
      setOutStr(fmt(outPt));
      return;
    }
    const c = Math.max(0, Math.min(duration || t, t));
    setOutPt(c);
    setOutStr(fmt(c));
  };

  /* ── scrubber click -> seek ───────────────────────────── */
  const onScrubClick = (e) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seekTo(ratio * duration);
  };

  /* ── segments ─────────────────────────────────────────── */
  const addSegment = () => {
    const a = Math.min(inPt, outPt);
    const b = Math.max(inPt, outPt);
    if (b - a < 0.02) {
      setStatus("Selection is empty — set an in and out point first.");
      return;
    }
    setSegments((prev) => [...prev, { id: Date.now() + Math.random(), in: a, out: b }]);
    setStatus(`Added segment ${fmt(a)} → ${fmt(b)}.`);
  };
  const removeSegment = (id) => {
    setSegments((prev) => prev.filter((s) => s.id !== id));
  };
  const loadSegment = (s) => {
    setInPt(s.in);
    setOutPt(s.out);
    setInStr(fmt(s.in));
    setOutStr(fmt(s.out));
    seekTo(s.in);
  };

  /* ── lossless export of one [in,out] range ────────────── */
  const exportRange = useCallback(
    async (a, b, label) => {
      if (!file) return;
      const ok = await loadEngine();
      if (!ok) return;
      const ffmpeg = ffmpegRef.current;
      const { fetchFile } = utilRef.current;
      const ext = extOf(file.name);
      const inName = `in.${ext}`;
      const outName = `${sanitize(baseOf(file.name))}_${fmt(a).replace(/[:.]/g, "-")}_${fmt(b).replace(/[:.]/g, "-")}.${ext}`;

      try {
        setBusy(true);
        setProgress(0);
        setStatus(`Cutting ${label} (${fmt(a)} → ${fmt(b)}) — lossless stream copy…`);
        pushLog(`[cut] ${label}: -ss ${a.toFixed(3)} -to ${b.toFixed(3)} -c copy`);

        await ffmpeg.writeFile(inName, await fetchFile(file));
        // Lossless: stream-copy, snap to keyframe, normalise timestamps.
        await ffmpeg.exec([
          "-ss",
          a.toFixed(3),
          "-to",
          b.toFixed(3),
          "-i",
          inName,
          "-c",
          "copy",
          "-avoid_negative_ts",
          "make_zero",
          outName,
        ]);

        const data = await ffmpeg.readFile(outName);
        const blob = new Blob([data.buffer], { type: file.type || "video/mp4" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = outName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);

        // clean wasm FS so memory doesn't balloon across exports
        try {
          await ffmpeg.deleteFile(inName);
          await ffmpeg.deleteFile(outName);
        } catch {
          /* non-fatal */
        }

        setStatus(`Exported ${outName}.`);
        setProgress(1);
        pushLog(`[done] ${outName} (${(data.length / 1048576).toFixed(2)} MB)`);
        return true;
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        setStatus(`Export failed: ${msg}`);
        pushLog(`[error] ${msg}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [file, loadEngine, pushLog]
  );

  const exportCurrent = async () => {
    const a = Math.min(inPt, outPt);
    const b = Math.max(inPt, outPt);
    if (b - a < 0.02) {
      setStatus("Selection is empty — set an in and out point first.");
      return;
    }
    await exportRange(a, b, "selection");
  };

  const exportAllSegments = async () => {
    if (!segments.length) return;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const ok = await exportRange(s.in, s.out, `segment ${i + 1}/${segments.length}`);
      if (!ok) break;
    }
  };

  const selDur = Math.max(0, Math.max(inPt, outPt) - Math.min(inPt, outPt));
  const lo = Math.min(inPt, outPt);
  const hi = Math.max(inPt, outPt);
  const pct = (t) => (duration ? `${(t / duration) * 100}%` : "0%");

  const engineBadge =
    engineState === "ready" ? (
      <span className="ll-pill ok">engine ready</span>
    ) : engineState === "loading" ? (
      <span className="ll-pill cyan">loading engine…</span>
    ) : engineState === "error" ? (
      <span className="ll-pill red">engine error</span>
    ) : (
      <span className="ll-pill">engine idle</span>
    );

  return (
    <div className="lossless-page">
      <div className="page-head">
        <div className="titles">
          <h1>Lossless cut</h1>
          <div className="sub">
            In-browser lossless trimmer. Stream-copy (<code>-c copy</code>) — instant, no
            re-encode, no quality loss. Your file never leaves this machine.
          </div>
        </div>
        <div className="actions">
          {engineBadge}
          {engineState !== "ready" && engineState !== "loading" && (
            <button className="ll-btn" onClick={loadEngine}>
              Load engine
            </button>
          )}
        </div>
      </div>

      {/* No file yet → drop zone */}
      {!file && (
        <label
          className={`ll-drop${dragOver ? " is-drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="ll-drop-title">Drop a video here, or click to pick one</div>
          <div className="ll-drop-sub">mp4 · mov · mkv · webm · avi — stays local</div>
          <input
            type="file"
            accept="video/*,.mkv,.mov,.avi,.ts"
            onChange={onPick}
            style={{ display: "none" }}
          />
        </label>
      )}

      {engineState === "error" && (
        <div className="ll-err">
          <b>Couldn't load the ffmpeg engine.</b> The wasm core is fetched from a CDN
          (esm.sh). This can fail if the CDN is blocked, you're offline, or the browser
          can't run the single-thread core. The rest of the tab still works — you can
          preview and mark cuts, but exporting needs the engine.
          <div style={{ marginTop: 8, fontFamily: "var(--f-mono)", fontSize: 11 }}>
            {engineErr}
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="ll-btn primary" onClick={loadEngine}>
              Retry loading engine
            </button>
          </div>
        </div>
      )}

      {file && (
        <div className="ll-body">
          {/* LEFT: preview + scrubber */}
          <div>
            <div className="ll-video-wrap">
              {srcUrl && (
                <video
                  ref={videoRef}
                  src={srcUrl}
                  controls
                  onLoadedMetadata={onLoadedMeta}
                  onTimeUpdate={onTimeUpdate}
                />
              )}
            </div>

            <div className="ll-scrub">
              <div className="ll-scrub-bar" onClick={onScrubClick} title="Click to seek">
                <div
                  className="ll-scrub-sel"
                  style={{ left: pct(lo), width: duration ? `${((hi - lo) / duration) * 100}%` : "0%" }}
                />
                <div className="ll-scrub-play" style={{ left: pct(playhead) }} />
              </div>
              <div className="ll-scrub-times">
                <span>in {fmt(lo)}</span>
                <span>playhead {fmt(playhead)}</span>
                <span>out {fmt(hi)}</span>
              </div>
            </div>

            <div className="ll-btn-grp" style={{ marginTop: 12 }}>
              <button className="ll-btn primary" onClick={setInHere}>
                Set in ⟢ (at playhead)
              </button>
              <button className="ll-btn amber" onClick={setOutHere}>
                Set out ⟣ (at playhead)
              </button>
              <button className="ll-btn" onClick={() => seekTo(lo)}>
                Jump to in
              </button>
              <button className="ll-btn" onClick={() => seekTo(hi)}>
                Jump to out
              </button>
            </div>

            <div className="ll-card" style={{ marginTop: 12 }}>
              <div className="ll-card-h">
                <span>Status</span>
                <button
                  className="ll-btn"
                  style={{ padding: "2px 8px", fontSize: 10 }}
                  onClick={() => setShowLog((s) => !s)}
                >
                  {showLog ? "hide log" : "show log"}
                </button>
              </div>
              <div className="ll-status">
                {busy && <span className="ll-pill cyan">working…</span>}
                <span>{status || "Ready."}</span>
              </div>
              {(busy || progress > 0) && (
                <div className="ll-progress">
                  <i style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
              )}
              {showLog && (
                <div className="ll-log">
                  {log.length ? log.join("\n") : "(no log output yet)"}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: trim controls + segments + export */}
          <div>
            <div className="ll-card">
              <div className="ll-card-h">
                <span>Trim</span>
                <span className="ll-pill cyan">dur {fmt(selDur)}</span>
              </div>
              <div className="ll-row" style={{ marginBottom: 10 }}>
                <div className="ll-field">
                  <span className="ll-field-label">In (mm:ss.ms)</span>
                  <input
                    className="ll-input"
                    value={inStr}
                    onChange={(e) => setInStr(e.target.value)}
                    onBlur={commitIn}
                    onKeyDown={(e) => e.key === "Enter" && commitIn()}
                  />
                </div>
                <div className="ll-field">
                  <span className="ll-field-label">Out (mm:ss.ms)</span>
                  <input
                    className="ll-input"
                    value={outStr}
                    onChange={(e) => setOutStr(e.target.value)}
                    onBlur={commitOut}
                    onKeyDown={(e) => e.key === "Enter" && commitOut()}
                  />
                </div>
              </div>
              <div className="ll-btn-grp">
                <button
                  className="ll-btn primary"
                  onClick={exportCurrent}
                  disabled={busy || selDur < 0.02}
                >
                  Export selection (lossless)
                </button>
                <button className="ll-btn" onClick={addSegment} disabled={selDur < 0.02}>
                  + Add as segment
                </button>
              </div>
              <div className="ll-note" style={{ marginTop: 10 }}>
                ⓘ Lossless cuts snap to the nearest keyframe, so the actual cut can shift
                a little from the marked time. That's inherent to stream-copy — the only
                way to be frame-accurate is to re-encode (which is lossy).
              </div>
            </div>

            <div className="ll-card" style={{ marginTop: 12 }}>
              <div className="ll-card-h">
                <span>Segments</span>
                <span className="ll-pill">{segments.length}</span>
              </div>
              {segments.length === 0 && (
                <div className="ll-help">
                  Add multiple cut ranges, then export them all at once. Each segment is
                  exported as its own lossless file.
                </div>
              )}
              {segments.map((s, i) => (
                <div className="ll-seg" key={s.id}>
                  <div className="ll-seg-top">
                    <span className="ll-seg-name">segment {i + 1}</span>
                    <span className="ll-seg-range">
                      {fmt(s.in)} → {fmt(s.out)}{" "}
                      <span className="ll-seg-dur">({fmt(s.out - s.in)})</span>
                    </span>
                  </div>
                  <div className="ll-seg-actions">
                    <button className="ll-btn" onClick={() => loadSegment(s)}>
                      Load
                    </button>
                    <button
                      className="ll-btn"
                      onClick={() => exportRange(s.in, s.out, `segment ${i + 1}`)}
                      disabled={busy}
                    >
                      Export
                    </button>
                    <button
                      className="ll-btn danger"
                      onClick={() => removeSegment(s.id)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {segments.length > 0 && (
                <button
                  className="ll-btn primary"
                  style={{ marginTop: 4 }}
                  onClick={exportAllSegments}
                  disabled={busy}
                >
                  Export all {segments.length} segment{segments.length > 1 ? "s" : ""}
                </button>
              )}
            </div>

            <div className="ll-card" style={{ marginTop: 12 }}>
              <div className="ll-card-h">
                <span>File</span>
              </div>
              <div className="ll-help">
                <div style={{ color: "var(--fg)", overflowWrap: "anywhere" }}>{file.name}</div>
                <div style={{ marginTop: 4 }}>
                  {(file.size / 1048576).toFixed(1)} MB · {fmt(duration)} · .{extOf(file.name)}
                </div>
              </div>
              <button
                className="ll-btn"
                style={{ marginTop: 10 }}
                onClick={() => {
                  if (srcUrl) URL.revokeObjectURL(srcUrl);
                  setFile(null);
                  setSrcUrl(null);
                  setSegments([]);
                  setStatus("");
                }}
                disabled={busy}
              >
                Pick a different file
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { LosslessCut };
