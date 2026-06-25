/* =========================================================
   PipelineDnaAssets — read-only carry-over of a reel_dna card's
   display-only assets into the pipeline Reel Detail page.

   When a Reel DNA card is "Sent to Pipeline" the store migrates the
   editable/native assets (footage, location links, news links) into
   the real pipeline tables (see store.jsx sendReelDnaToPipeline 6a).
   Thumbnails and the captured notes/tags are display-only, so this
   component surfaces them here as three read-only boxes on the Reel
   Detail left column.

   Data:
     · useReelDnaAssets(cardId) — resolved { assets } for the SOURCE
       reel_dna card (K5). We read thumbnails + news from here.
     · useWorkflow().reelDna   — the source card itself, for the
       captured genes / quick notes / brief.

   Renders nothing when there is no source card.
   ========================================================= */

import React from "react";
import { Card } from "./components.jsx";
import { useWorkflow } from "../store/store.jsx";
import { useReelDnaAssets } from "../lib/reel-dna-assets.jsx";
import { ThumbPreview } from "../pages/thumbnail-dna.jsx";
import { geneLabel, resolveBrief } from "../lib/reel-dna.jsx";

export function PipelineDnaAssets({ cardId }) {
  const { reelDna } = useWorkflow();
  const { assets } = useReelDnaAssets(cardId);

  if (!cardId) return null;
  const card = (reelDna || []).find(d => d.id === cardId);
  if (!card) return null;

  const thumbnails = assets?.thumbnails || [];
  const news = assets?.news || [];

  const genes = card.genesOfInterest || [];
  const brief = resolveBrief(card);
  const quickNotes = (card.quickNotes || "").trim();
  // resolveBrief already folds quickNotes into `leftover`; show it only when
  // it differs so the same text isn't echoed twice.
  const leftover = (brief.leftover || "").trim();
  const showQuickNotes = quickNotes && quickNotes !== leftover;

  const hasNotes =
    genes.length > 0 || showQuickNotes || leftover ||
    brief.location || brief.musicTrack || brief.fontNames ||
    brief.sfx || brief.story || brief.hookStart;

  return (
    <>
      {/* Thumbnails + News are now shown (and editable) in the dedicated
          "Attached Thumbnails" / "Attached News" cards on the Reel Detail left
          column, so they're no longer duplicated read-only here. */}
      <Card title="From Reel DNA — Notes & Tags" defaultOpen={hasNotes}>
        {!hasNotes ? (
          <div className="rd-asset-empty">No captured notes</div>
        ) : (
          <div className="rd-pipeline-notes">
            {genes.length > 0 && (
              <div className="rd-card-genes" style={{ marginBottom: 8 }}>
                {genes.map(g => (
                  <span key={g} className="rd-gene-tag">{geneLabel(g)}</span>
                ))}
              </div>
            )}
            {brief.location && (
              <div className="rd-pipeline-note-line">
                <span className="rd-pipeline-note-key">Location</span> {brief.location}
              </div>
            )}
            {brief.musicTrack && (
              <div className="rd-pipeline-note-line">
                <span className="rd-pipeline-note-key">Music</span> {brief.musicTrack}
                {brief.musicSource ? ` (${brief.musicSource})` : ""}
              </div>
            )}
            {brief.fontNames && (
              <div className="rd-pipeline-note-line">
                <span className="rd-pipeline-note-key">Fonts</span> {brief.fontNames}
              </div>
            )}
            {brief.sfx && (
              <div className="rd-pipeline-note-line">
                <span className="rd-pipeline-note-key">SFX</span> {brief.sfx}
              </div>
            )}
            {brief.story && (
              <div className="rd-pipeline-note-line">
                <span className="rd-pipeline-note-key">Story</span> {brief.story}
              </div>
            )}
            {(brief.hookStart || brief.hookEnd) && (
              <div className="rd-pipeline-note-line">
                <span className="rd-pipeline-note-key">Hook</span>{" "}
                {brief.hookStart}{brief.hookEnd ? ` – ${brief.hookEnd}` : ""}
              </div>
            )}
            {leftover && (
              <div className="rd-pipeline-note-line rd-pipeline-note-free">{leftover}</div>
            )}
            {showQuickNotes && (
              <div className="rd-pipeline-note-line rd-pipeline-note-free">{quickNotes}</div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}

export default PipelineDnaAssets;
