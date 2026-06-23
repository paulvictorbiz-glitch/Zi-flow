/* =========================================================
   ReelAssets — pure renderer for a reel card's attached assets.

   Renders FIVE collapsible AssetSections (Footage, Locations,
   Thumbnails, News, Music) from the resolved `assets` shape. Data arrives
   via props — NO store/hook access here, keeping the component pure
   and reusable in both the compact panel and the full page.

   The FIRST arg to detachAsset is the reel_dna CARD id (the `item`
   prop's id), NOT the source row id.
   ========================================================= */

import React from "react";
import { AssetSection } from "./asset-section.jsx";
import { ThumbPreview } from "../pages/thumbnail-dna.jsx";
import { footageBrainThumbnailUrl } from "../lib/footage-brain-client.js";

/* Build a Google Maps link for a location: prefer exact coordinates, fall
   back to a text search on the address/name. Returns "" when there's nothing
   to point at. */
function mapsUrlForLocation(l) {
  if (l == null) return "";
  if (l.lat != null && l.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`;
  }
  const q = (l.address || l.name || "").trim();
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : "";
}

/* Dependency-free relative time: "just now" / "5h ago" / "3d ago". */
function relAgo(iso) {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "";
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return "just now";
  const mins = Math.floor(diff / (60 * 1000));
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(diff / (60 * 60 * 1000));
  if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  return days + "d ago";
}

export function ReelAssets({
  item,
  assets,
  allOpen = false,
  compact = false,
  isOwner,
  actions,
}) {
  const cardId = item?.id;
  const footage = assets?.footage || [];
  const locations = assets?.locations || [];
  const thumbnails = assets?.thumbnails || [];
  const news = assets?.news || [];
  const music = assets?.music || [];

  const canDetach = typeof actions?.detachAsset === "function";
  const detach = (type, sourceId) => {
    if (canDetach) actions.detachAsset(cardId, type, sourceId);
  };

  const DetachBtn = ({ type, sourceId }) =>
    canDetach ? (
      <button
        type="button"
        className="rd-asset-detach"
        title="Detach"
        onClick={() => detach(type, sourceId)}
      >
        ✕
      </button>
    ) : null;

  return (
    <>
      <AssetSection
        icon="🎬"
        label="Footage"
        count={footage.length}
        defaultOpen={allOpen}
        compact={compact}
        emptyText="No footage attached"
      >
        {footage.map(f => {
          const href = f.drive_url || f.drive_folder_url || f.url || "";
          const name = f.filename || f.footage_file_id || "Footage";
          const thumbSrc = f.thumbnail_url ? footageBrainThumbnailUrl(f.thumbnail_url) : "";
          return (
            <div className="rd-asset-row" key={f.id}>
              {thumbSrc ? (
                <img
                  className="rd-asset-thumb"
                  src={thumbSrc}
                  alt={name}
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
              ) : null}
              {href ? (
                <a className="rd-asset-name rd-asset-link" href={href} target="_blank" rel="noreferrer" title={name}>
                  {name}
                </a>
              ) : (
                <span className="rd-asset-name">{name}</span>
              )}
              <span className="rd-tag sm dim">{f.source || "footage"}</span>
              <DetachBtn type="footage" sourceId={f.id} />
            </div>
          );
        })}
      </AssetSection>

      <AssetSection
        icon="📍"
        label="Locations"
        count={locations.length}
        defaultOpen={allOpen}
        compact={compact}
        emptyText="No locations attached"
      >
        <div className="rd-asset-chips">
          {locations.map(l => {
            const mapHref = mapsUrlForLocation(l);
            const name = l.name || "Location";
            return (
              <span
                className="rd-tag"
                key={l.id}
                style={{ color: "#f59e0b", borderColor: "#f59e0b" }}
              >
                {mapHref ? (
                  <a className="rd-asset-pin-link" href={mapHref} target="_blank" rel="noreferrer"
                     title={"Open " + name + " in Google Maps"}>
                    📍 {name}
                  </a>
                ) : (
                  <>📍 {name}</>
                )}
                <DetachBtn type="location" sourceId={l.id} />
              </span>
            );
          })}
        </div>
      </AssetSection>

      <AssetSection
        icon="🖼️"
        label="Thumbnails"
        count={thumbnails.length}
        defaultOpen={allOpen}
        compact={compact}
        emptyText="No thumbnails attached"
      >
        <div className="rd-asset-thumb-grid">
          {thumbnails.map(t => (
            <div className="rd-asset-thumb-wrap" key={t.id}>
              <a
                className="rd-asset-thumb"
                href={t.videoUrl}
                target="_blank"
                rel="noreferrer"
                title={t.title || t.videoUrl}
              >
                {t.videoId ? (
                  <ThumbPreview videoId={t.videoId} alt={t.title || t.videoUrl} />
                ) : t.thumbnailUrl ? (
                  <img className="td-thumb-img" src={t.thumbnailUrl}
                       alt={t.title || t.videoUrl || "Thumbnail"} loading="lazy" />
                ) : (
                  <span className="rd-asset-thumb-stub">no preview</span>
                )}
              </a>
              <DetachBtn type="thumbnail" sourceId={t.id} />
            </div>
          ))}
        </div>
      </AssetSection>

      <AssetSection
        icon="📰"
        label="News"
        count={news.length}
        defaultOpen={allOpen}
        compact={compact}
        emptyText="No news attached"
      >
        {news.map(n => (
          <div className="rd-asset-news" key={n.id}>
            <a href={n.sourceUrl || "#"} target="_blank" rel="noreferrer">
              {n.title || "Untitled"}
            </a>
            <span className="rd-asset-news-time">
              {relAgo(n.publishedAt || n.createdAt)}
            </span>
            <DetachBtn type="news" sourceId={n.id} />
          </div>
        ))}
      </AssetSection>

      <AssetSection
        icon="♪"
        label="Music"
        count={music.length}
        defaultOpen={allOpen}
        compact={compact}
        emptyText="No music attached"
      >
        {music.map(m => {
          // Mirror detail.jsx / MusicPickerModal's broader accessor set so the
          // link still resolves if a music_tracks row arrives snake_case
          // (preview_url) rather than the camelCase the store mapper normally
          // emits. Defensive only — additive, no behaviour change for camelCase.
          const href =
            m.previewUrl || m.preview_url || m.preview ||
            m.url ||
            m.downloadUrl || m.download_url ||
            m.audioUrl || m.audio_url || m.mp3 ||
            "";
          const name = m.title || m.name || "Music";
          const artistRaw = m.artist ?? m.artist_name ?? m.creator ?? "";
          const artist = Array.isArray(artistRaw)
            ? artistRaw.map(a => (typeof a === "string" ? a : a?.name || "")).filter(Boolean).join(", ")
            : (typeof artistRaw === "string" ? artistRaw : artistRaw?.name || "");
          return (
            <div className="rd-asset-row" key={m.id}>
              {href ? (
                <a className="rd-asset-name rd-asset-link" href={href} target="_blank" rel="noreferrer" title={name}>
                  {name}
                </a>
              ) : (
                <span className="rd-asset-name">{name}</span>
              )}
              {artist ? <span className="rd-tag sm dim">{artist}</span> : null}
              <DetachBtn type="music" sourceId={m.id} />
            </div>
          );
        })}
      </AssetSection>
    </>
  );
}

export default ReelAssets;
