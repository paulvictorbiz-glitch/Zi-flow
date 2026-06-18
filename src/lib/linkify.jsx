/* =========================================================
   Linkify utilities — turn plain-text URLs into clickable links.

   `linkifyText(text, embedOpts)` scans a string for http(s) URLs and
   returns an array of React nodes (plain text segments interleaved with
   links). YouTube URLs render as <YoutubeEmbedLink>, which adds an inline
   "Embed" toggle that reveals a responsive 16:9 iframe.

   The embed toggle is local-only by default. Pass `embedOpts`
   ({ embeddedUrls: Set<string>, onToggleEmbed: (url, next) => void }) to
   make it CONTROLLED + PERSISTED — the embedded set seeds which links show
   their player, and onToggleEmbed fires when the user flips one. The
   training manual wires this to module content so an owner's "Embed" choice
   survives a click-away and shows for every editor.

   Used by EditableText (read-only, opt-in via the `linkify` prop) and
   anywhere else that renders user-authored prose. Lives in lib/ so the
   shared EditableText primitive can import it without depending on a page.
   ========================================================= */

import React from "react";

const _YT_ID_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const _URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

// Clicks on links / embed controls must not bubble to a parent
// click-to-edit handler (EditableText owner view), so each stops propagation.
const _stop = (e) => e.stopPropagation();

export function YoutubeEmbedLink({ url, ytId, embedded, onToggleEmbed }) {
  // Seeded from (and re-synced to) the persisted `embedded` flag so an
  // owner's saved choice shows on load and for every viewer. Toggling
  // updates locally (responsive) and persists via onToggleEmbed when wired.
  const [embed, setEmbedState] = React.useState(!!embedded);
  React.useEffect(() => { setEmbedState(!!embedded); }, [embedded]);
  const setEmbed = (next) => { setEmbedState(next); onToggleEmbed?.(url, next); };
  if (embed) return (
    // Small, right-aligned 16:9 player so the surrounding module text stays readable.
    <span style={{ display: "block", marginTop: 6, marginLeft: "auto", width: "min(260px, 100%)", textAlign: "right" }} onClick={_stop}>
      <span style={{ display: "block", position: "relative", paddingBottom: "56.25%", height: 0, overflow: "hidden", borderRadius: 6 }}>
        <iframe
          src={"https://www.youtube.com/embed/" + ytId}
          title="Tutorial"
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </span>
      <button onClick={(e) => { _stop(e); setEmbed(false); }}
        style={{ fontSize: 11, marginTop: 4, cursor: "pointer", background: "none", border: "none", color: "var(--fg-dim)" }}>
        Hide embed
      </button>
    </span>
  );
  return (
    <span onClick={_stop}>
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={_stop}
        style={{ color: "var(--c-cyan)", wordBreak: "break-all" }}>{url}</a>
      <button onClick={(e) => { _stop(e); setEmbed(true); }}
        style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 3, cursor: "pointer",
          background: "rgba(127,212,154,0.1)", border: "1px solid rgba(127,212,154,0.3)", color: "var(--c-green, #7fd49a)" }}>
        Embed
      </button>
    </span>
  );
}

export function linkifyText(text, embedOpts) {
  if (!text) return text;
  _URL_RE.lastIndex = 0;
  const parts = [];
  let last = 0, m;
  while ((m = _URL_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const url = m[0];
    const ytMatch = url.match(_YT_ID_RE);
    parts.push(ytMatch
      ? <YoutubeEmbedLink key={m.index} url={url} ytId={ytMatch[1]}
          embedded={embedOpts?.embeddedUrls?.has(url)}
          onToggleEmbed={embedOpts?.onToggleEmbed} />
      : <a key={m.index} href={url} target="_blank" rel="noopener noreferrer" onClick={_stop}
           style={{ color: "var(--c-cyan)", wordBreak: "break-all" }}>{url}</a>);
    last = m.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}
