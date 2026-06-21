/* =========================================================
   ReelPreviewModal — in-app reel preview popup (contract C6).

   Opens when the user left-clicks a reel link in the Reel DNA
   spreadsheet (instead of navigating away in a new tab). Reuses the
   existing .rdc-modal-overlay / .rdc-modal chrome (no fork) + a ✕
   button + close-on-overlay-click + close-on-Esc.

   Every supported platform is embedded IN-APP — nothing is hosted by
   us; each embed streams straight from the platform's own CDN to the
   viewer (zero storage / bandwidth on our side):
     · ig     → official Instagram embed via <ReelPlayer> (tap-to-play;
                IG blocks programmatic autoplay).
     · yt     → youtube.com/embed/<id>?autoplay=1 (autoplays).
     · tiktok → tiktok.com/embed/v2/<id> (full-url links only; short
                vm.tiktok.com links have no id → fallback).
     · fb     → facebook.com/plugins/video.php?href=<url>&autoplay=true.
   Anything we can't build an embed for → a fallback card.

   An "Open original ↗" anchor is ALWAYS rendered, every platform.
   Read-only dep: ./reel-player.jsx — never edited.
   ========================================================= */

import React, { useEffect } from "react";
import { ReelPlayer } from "./reel-player.jsx";
import { platformLabel } from "../lib/reel-dna.jsx";

/* Robust platform detection straight from the URL (platformFromUrl in
   reel-dna.jsx never returns "fb" — it defaults to "ig" — which would
   wrongly route Facebook links to the IG embed). Falls back to the
   stored item.platform when the URL is ambiguous. */
function detectPlatform(url, fallback) {
  const u = (url || "").toLowerCase();
  if (/tiktok\.com/.test(u)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(u)) return "yt";
  if (/instagram\.com|instagr\.am/.test(u)) return "ig";
  if (/facebook\.com|fb\.watch|fb\.com/.test(u)) return "fb";
  return fallback || "ig";
}

/* youtube.com/watch?v=<id>, youtu.be/<id>, /shorts/<id>, /embed/<id>. */
function youtubeId(url) {
  if (!url) return null;
  const u = String(url);
  const m =
    u.match(/[?&]v=([A-Za-z0-9_-]{6,})/) ||
    u.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) ||
    u.match(/\/shorts\/([A-Za-z0-9_-]{6,})/) ||
    u.match(/\/embed\/([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

/* tiktok.com/@user/video/<digits> (full links only — short vm.tiktok.com
   / tiktok.com/t/ links don't carry the numeric id). */
function tiktokId(url) {
  if (!url) return null;
  const m = String(url).match(/\/video\/(\d{6,})/) || String(url).match(/\/v\/(\d{6,})/);
  return m ? m[1] : null;
}

export function ReelPreviewModal({ item, onClose }) {
  // Close on Esc. Unconditional hook; no-op when there's no item.
  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [item, onClose]);

  if (!item) return null;

  const url = item.reelUrl || "";
  const plat = detectPlatform(url, item.platform);

  let body = null;
  if (plat === "ig") {
    body = (
      <div className="rpv-player">
        <ReelPlayer sampleReel={{ sourceUrl: url }} preferEmbed={true} />
      </div>
    );
  } else if (plat === "yt") {
    const id = youtubeId(url);
    if (id) {
      body = (
        <div className="rpv-embed">
          <iframe
            className="rpv-iframe"
            src={`https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0`}
            title="YouTube preview"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      );
    }
  } else if (plat === "tiktok") {
    const id = tiktokId(url);
    if (id) {
      body = (
        <div className="rpv-embed rpv-embed--tall">
          <iframe
            className="rpv-iframe"
            src={`https://www.tiktok.com/embed/v2/${id}`}
            title="TikTok preview"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
          />
        </div>
      );
    }
  } else if (plat === "fb") {
    body = (
      <div className="rpv-embed">
        <iframe
          className="rpv-iframe"
          src={`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&autoplay=true`}
          title="Facebook preview"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    );
  }

  // Anything we couldn't build an embed for (e.g. a short TikTok link with
  // no id, or an unparseable YouTube url) → a clean fallback card.
  if (!body) {
    body = (
      <div className="rpv-fallback">
        <div className="rpv-fallback-plat">{platformLabel(plat)}</div>
        <div className="rpv-fallback-msg">This link can’t be embedded — open it in a new tab.</div>
        <a className="rpv-fallback-url" href={url} target="_blank" rel="noreferrer" title={url}>{url}</a>
        <a className="rpv-open-big" href={url} target="_blank" rel="noreferrer">Open original ↗</a>
      </div>
    );
  }

  return (
    <div className="rdc-modal-overlay" onClick={() => onClose?.()}>
      <div className="rdc-modal rpv-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="rdc-modal-close" title="Close" onClick={() => onClose?.()}>✕</button>
        <div className="rpv-body">
          {body}
          {/* "Open original ↗" is ALWAYS available, regardless of platform. */}
          <div className="rpv-foot">
            <span style={{ marginRight: "auto", fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-dim)" }}>
              {platformLabel(plat)}
            </span>
            <a className="rpv-open" href={url} target="_blank" rel="noreferrer" title={url}>Open original ↗</a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReelPreviewModal;
