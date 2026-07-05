/* =========================================================
   ReelDetailOverlay — renders the FULL, prop-driven ReelDetail editor inside
   a large popup overlay so clicking a Pipeline card expands into every field
   of the reel (fully editable) instead of swapping to a separate page.

   Why this lives at app level (not inside ReelCard / ExpandableCard):
   · Circular import — detail.jsx imports from components.jsx, so importing
     ReelDetail back into components.jsx would create a cycle. app.jsx already
     imports both, so this thin wrapper belongs there.
   · z-index — ReelDetail spawns its OWN modals (MusicPicker / Compare /
     AssetAttach) via the generic `.m-backdrop` at z-index 90 in the
     edit-locked styles.css. This overlay's backdrop is z-index 88 (see
     reel-detail-overlay.css) so those inner modals still layer on top.

   ReelDetail is reused verbatim — it already takes a plain `reel` prop and
   re-reads live store state by id, so nothing about how its fields are
   populated changes.
   ========================================================= */
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { ReelDetail } from "../pages/detail.jsx";
import "./reel-detail-overlay.css";

export function ReelDetailOverlay({ reel, onClose, onLearnSkill, solarinMode }) {
  /* Esc closes the overlay. ReelDetail's nested modals have their own Esc
     handling; a rare double-close (modal + overlay) is harmless. */
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!reel) return null;

  return createPortal(
    <div
      className="rdo-backdrop"
      /* Mirror the app's Solarin theme onto this portaled node — it lives
         under <body>, outside #root where [data-theme="solarin"] is set, so
         without this the popup falls back to the classic look. The Solarin
         token block is an element-agnostic attribute selector, so setting it
         here re-declares the theme vars for the whole detail subtree. */
      data-theme={solarinMode ? "solarin" : undefined}
      /* Close ONLY when the dim area itself is clicked — not clicks bubbling
         up from the panel. We deliberately avoid useOutsideClick here because
         ReelDetail's modals portal to <body> (outside .rdo-panel); an
         outside-click handler would wrongly close the overlay while the user
         is interacting with the Music picker / Compare modal. */
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rdo-panel"
        role="dialog"
        aria-modal="true"
        aria-label={reel.title || "Reel detail"}
      >
        <ReelDetail
          reel={reel}
          onBack={onClose}
          onLearnSkill={(skillKey) => { onClose(); onLearnSkill?.(skillKey); }}
          openCompare={false}
          onCompareMounted={() => {}}
        />
      </div>
    </div>,
    document.body
  );
}

export default ReelDetailOverlay;
