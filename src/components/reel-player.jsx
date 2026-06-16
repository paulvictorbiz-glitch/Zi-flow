/* =========================================================
   ReelPlayer — L1 PRESENTATION (prop-driven, no data imports)

   Embed-first vertical (9:16) reel player.

   Default state: the actual Instagram reel from `sampleReel.sourceUrl`
   is rendered via Instagram's official embed (blockquote + embed.js), so
   the section auto-populates a real, playable reel without us having to
   host an mp4. Instagram embeds play in-place but can't be scrubbed
   inline — so we keep an "upload your own" affordance that swaps the
   embed for our scrubbable <video> player (local blob, never uploaded).

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

/* Normalize any Instagram reel/post URL to its canonical /reel/<code>/
   permalink so the embed script can resolve it (strips tracking params
   and the /reels/ vs /reel/ variance). Returns null for non-IG URLs. */
function igPermalink(url) {
  if (!url) return null;
  const m = String(url).match(/instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  if (!m) return null;
  return `https://www.instagram.com/reel/${m[1]}/`;
}

/* Load Instagram's embed.js once, then (re)process embeds. The script
   exposes window.instgrm.Embeds.process() which scans the DOM for
   blockquote.instagram-media and turns them into iframes. */
function processInstagramEmbeds() {
  if (window.instgrm?.Embeds?.process) {
    window.instgrm.Embeds.process();
    return;
  }
  const SRC = "https://www.instagram.com/embed.js";
  let s = document.querySelector(`script[src="${SRC}"]`);
  if (s) {
    // Script tag exists but hasn't finished loading yet — it will call
    // process() on its own once ready; nothing more to do here.
    return;
  }
  s = document.createElement("script");
  s.src = SRC;
  s.async = true;
  s.onload = () => { try { window.instgrm?.Embeds?.process(); } catch {} };
  document.body.appendChild(s);
}

export function ReelPlayer({ sampleReel = {}, preferEmbed = true }) {
  const { sourceUrl, mp4, poster, durationLabel } = sampleReel;
  const permalink = igPermalink(sourceUrl);

  const videoRef = useRef(null);
  const objectUrlRef = useRef(null); // current blob: URL (for revoke)
  const embedRef = useRef(null);     // the blockquote we (re)process

  // `uploaded` flips us from the IG embed to the scrubbable <video>.
  const [src, setSrc] = useState("");
  const [uploaded, setUploaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  // Default (no upload): show the real Instagram reel embed — unless the
  // caller opts out (preferEmbed=false) to get the clean self-hosted <video>.
  const showEmbed = preferEmbed && !uploaded && !!permalink;

  // (Re)process the IG embed whenever it's the active view.
  useEffect(() => {
    if (showEmbed) processInstagramEmbeds();
  }, [showEmbed, permalink]);

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

  const scrubVal = duration ? Math.round((current / duration) * 1000) : 0;
  const totalLabel = duration ? fmt(duration) : durationLabel || "0:00";

  return (
    <div className={"rpl" + (showEmbed ? " rpl--embed" : "")}>
      <div className={"rpl-frame" + (showEmbed ? " rpl-frame--embed" : "")}>
        {showEmbed ? (
          /* Real Instagram reel — official embed. embed.js replaces this
             blockquote with an <iframe> once processed. */
          <blockquote
            ref={embedRef}
            className="instagram-media rpl-embed"
            data-instgrm-permalink={permalink}
            data-instgrm-version="14"
          >
            <a href={permalink} target="_blank" rel="noreferrer">
              View this reel on Instagram
            </a>
          </blockquote>
        ) : (
          <video
            ref={videoRef}
            className="rpl-video"
            src={src || mp4 || undefined}
            poster={uploaded ? undefined : poster || undefined}
            playsInline
            preload="metadata"
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={onLoadedMeta}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onClick={togglePlay}
          />
        )}

        {/* Tap-to-play affordance over the video (not the embed) */}
        {!showEmbed && !playing && (
          <button
            className="rpl-bigplay"
            onClick={togglePlay}
            aria-label="Play"
          >
            ▶
          </button>
        )}
      </div>

      {/* Controls — only meaningful for the scrubbable upload view. The IG
          embed has its own native controls, so we hide ours for it. */}
      {!showEmbed && (
        <div className="rpl-controls">
          <button
            className="rpl-btn"
            onClick={togglePlay}
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
            disabled={!duration}
            aria-label="Scrub"
          />
          <span className="rpl-time rpl-time--total">{totalLabel}</span>
        </div>
      )}

      {/* Upload-to-scrub + source link */}
      <div className="rpl-foot">
        <label className="rpl-upload">
          <span>{uploaded ? "Reel loaded — swap" : "Upload your reel to scrub"}</span>
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
