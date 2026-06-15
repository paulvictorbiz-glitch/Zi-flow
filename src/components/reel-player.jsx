/* =========================================================
   ReelPlayer — L1 PRESENTATION (prop-driven, no data imports)

   Embed-first, upload-to-unlock-scrub vertical (9:16) reel player.

   The IG `sourceUrl` is shown as a small "source:" link only — it is
   NOT what plays. The thing that plays + scrubs is our own asset
   (sampleReel.mp4). Until the owner drops the real file into /public,
   the mp4 404s gracefully: we catch onError and show a tasteful
   placeholder, but ALWAYS keep the upload control so a visitor can
   drop their own clip and scrub it locally.

   Props:
     sampleReel — { sourceUrl, mp4, poster, durationLabel }

   Must NOT import reel-dna-demo.jsx — all data is via props.
   ========================================================= */
import React, { useEffect, useRef, useState } from "react";
import "./reel-player.css";

function fmt(t) {
  if (t == null || Number.isNaN(t) || !Number.isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ReelPlayer({ sampleReel = {} }) {
  const { sourceUrl, mp4, poster, durationLabel } = sampleReel;

  const videoRef = useRef(null);
  const objectUrlRef = useRef(null); // current blob: URL (for revoke)

  const [src, setSrc] = useState(mp4 || "");
  const [uploaded, setUploaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  // Revoke any outstanding object URL on unmount.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (v) setCurrent(v.currentTime || 0);
  };
  const onLoadedMeta = () => {
    const v = videoRef.current;
    if (v) setDuration(v.duration || 0);
  };
  const onError = () => {
    // The sample mp4 may 404 until the owner drops it in. Once a user
    // uploads their own clip we never treat load errors as "missing".
    if (!uploaded) setFailed(true);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } else {
      v.pause();
    }
  };

  const onScrub = (e) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const t = (Number(e.target.value) / 1000) * duration;
    v.currentTime = t;
    setCurrent(t);
  };

  const onUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setUploaded(true);
    setFailed(false);
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setSrc(url);
    // Let the new src load, then play.
    requestAnimationFrame(() => {
      const v = videoRef.current;
      if (v) {
        v.load();
        const p = v.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
    });
  };

  const showPlaceholder = failed && !uploaded;
  const scrubVal = duration ? Math.round((current / duration) * 1000) : 0;
  const totalLabel = duration ? fmt(duration) : durationLabel || "0:00";

  return (
    <div className="rpl">
      <div className="rpl-frame">
        {showPlaceholder ? (
          <div className="rpl-placeholder">
            <div className="rpl-placeholder-glyph">▶</div>
            <div className="rpl-placeholder-title">Sample reel</div>
            <div className="rpl-placeholder-sub">Drop your own to scrub</div>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="rpl-video"
            src={src || undefined}
            poster={uploaded ? undefined : poster || undefined}
            playsInline
            preload="metadata"
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={onLoadedMeta}
            onError={onError}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onClick={togglePlay}
          />
        )}

        {/* Tap-to-play affordance over the video */}
        {!showPlaceholder && !playing && (
          <button
            className="rpl-bigplay"
            onClick={togglePlay}
            aria-label="Play"
          >
            ▶
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="rpl-controls">
        <button
          className="rpl-btn"
          onClick={togglePlay}
          disabled={showPlaceholder}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="rpl-time">{fmt(current)}</span>
        <input
          className="rpl-scrub"
          type="range"
          min={0}
          max={1000}
          step={1}
          value={scrubVal}
          onChange={onScrub}
          disabled={showPlaceholder || !duration}
          aria-label="Scrub"
        />
        <span className="rpl-time rpl-time--total">{totalLabel}</span>
      </div>

      {/* Upload-to-unlock + source link */}
      <div className="rpl-foot">
        <label className="rpl-upload">
          <span>{uploaded ? "Reel loaded — swap" : "Upload your reel"}</span>
          <input type="file" accept="video/*" onChange={onUpload} />
        </label>
        {sourceUrl && (
          <a
            className="rpl-source"
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            title={sourceUrl}
          >
            source: {sourceUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
          </a>
        )}
      </div>
    </div>
  );
}

export default ReelPlayer;
