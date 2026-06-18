/* =========================================================
   ReelAssets — pure renderer for a reel card's attached assets.

   Renders FOUR collapsible AssetSections (Footage, Locations,
   Thumbnails, News) from the resolved `assets` shape. Data arrives
   via props — NO store/hook access here, keeping the component pure
   and reusable in both the compact panel and the full page.

   The FIRST arg to detachAsset is the reel_dna CARD id (the `item`
   prop's id), NOT the source row id.
   ========================================================= */

import React from "react";
import { AssetSection } from "./asset-section.jsx";
import { ThumbPreview } from "../pages/thumbnail-dna.jsx";

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
        {footage.map(f => (
          <div className="rd-asset-row" key={f.id}>
            <span className="rd-asset-name">
              {f.filename || f.footage_file_id || "Footage"}
            </span>
            <span className="rd-tag sm dim">{f.source || "footage"}</span>
            <DetachBtn type="footage" sourceId={f.id} />
          </div>
        ))}
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
          {locations.map(l => (
            <span
              className="rd-tag"
              key={l.id}
              style={{ color: "#f59e0b", borderColor: "#f59e0b" }}
            >
              📍 {l.name || "Location"}
              <DetachBtn type="location" sourceId={l.id} />
            </span>
          ))}
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
                <ThumbPreview videoId={t.videoId} alt={t.title || t.videoUrl} />
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
    </>
  );
}

export default ReelAssets;
