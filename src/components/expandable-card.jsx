/* =========================================================
   ExpandableCard — Aceternity-style "expand into a centered overlay"
   card, ported to this repo's stack (plain CSS tokens + `motion`, NO
   Tailwind). https://ui.aceternity.com/components/expandable-card

   The smooth "magic move" is framer-motion's shared-layout animation:
   the collapsed TILE and the expanded CARD both carry the same
   `layoutId` ("exc-<id>"), so opening tweens the tile's rect into the
   overlay's rect. An optional thumbnail shares `layoutId` "exc-img-<id>"
   so the image morphs too.

   The overlay is portaled to <body> (like the ReelCard kebab / box-table)
   so it escapes the board cell's `overflow:hidden` clip. Closes on
   backdrop click / Esc / outside-click, and honors prefers-reduced-motion
   (falls back to a plain fade — no layout tween).

   ── API (render-prop, so callers keep their own tile markup) ──────────
   <ExpandableCard
      id={stableKey}                       // → layoutId
      header={{ title, subtitle }}         // overlay header
      thumbnail={{ url, fallbackUrl } | url | null}   // optional shared img
      tone="cyan"                          // accent token → var(--c-cyan)
      overlayClassName=""                  // extra class on the overlay card
      onOpenFull={fn}                      // optional → renders "Open full detail →"
      openFullLabel="Open full detail →"
      renderExpanded={({ close }) => node}  // overlay body
   >
     {({ open, isOpen, Tile, TileImg }) => (
        // caller's collapsed tile. Use <Tile> as the root (motion.div
        // pre-bound with the layoutId) and call open() on a plain click.
     )}
   </ExpandableCard>
   ========================================================= */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useOutsideClick } from "../lib/use-outside-click.js";
import { cn } from "../lib/cn.js";
import "./expandable-card.css";

function normThumb(thumbnail) {
  if (!thumbnail) return null;
  if (typeof thumbnail === "string") return { url: thumbnail, fallbackUrl: null };
  return thumbnail;
}

export function ExpandableCard({
  id,
  header,
  thumbnail = null,
  tone = "cyan",
  overlayClassName = "",
  onOpenFull,
  openFullLabel = "Open full detail →",
  renderExpanded,
  children,
  // controlled mode (optional)
  open: openProp,
  onOpenChange,
}) {
  const [openInternal, setOpenInternal] = useState(false);
  const isControlled = openProp != null;
  const isOpen = isControlled ? openProp : openInternal;
  const setOpen = useCallback((v) => {
    if (!isControlled) setOpenInternal(v);
    onOpenChange?.(v);
  }, [isControlled, onOpenChange]);

  const open = useCallback(() => setOpen(true), [setOpen]);
  const close = useCallback(() => setOpen(false), [setOpen]);

  const reduce = useReducedMotion();
  const layoutId = `exc-${id}`;
  const imgLayoutId = `exc-img-${id}`;
  const thumb = normThumb(thumbnail);

  const cardRef = useRef(null);
  useOutsideClick(cardRef, close, isOpen);

  // Shared spring; disabled entirely under reduced-motion (plain fade).
  const layoutTransition = reduce
    ? { duration: 0.15 }
    : { type: "spring", stiffness: 320, damping: 32, mass: 0.7 };

  // Pre-bound tile pieces handed to the caller's render function.
  // Only `layoutId` (not `layout`) — the shared-element morph needs just the
  // id on both ends; adding `layout` would force a measure on every board
  // re-render (the age string ticks each second across many cards).
  const Tile = useMemo(() => {
    return function Tile({ children: tc, ...rest }) {
      return (
        <motion.div layoutId={reduce ? undefined : layoutId} {...rest}>
          {tc}
        </motion.div>
      );
    };
  }, [layoutId, reduce]);

  const TileImg = useMemo(() => {
    return function TileImg(props) {
      return <motion.img layoutId={reduce ? undefined : imgLayoutId} {...props} />;
    };
  }, [imgLayoutId, reduce]);

  // AnimatePresence stays mounted; the backdrop is conditional INSIDE it so
  // the exit (fade + morph-back-to-tile) actually runs on close.
  const overlay = createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="exc-backdrop"
          className="exc-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={close}
        >
          <motion.div
            ref={cardRef}
            layoutId={reduce ? undefined : layoutId}
            className={cn("exc-card", overlayClassName)}
            style={{ "--exc-accent": `var(--c-${tone}, var(--c-cyan))` }}
            initial={reduce ? { opacity: 0, y: 8 } : false}
            animate={reduce ? { opacity: 1, y: 0 } : undefined}
            exit={reduce ? { opacity: 0, y: 8 } : undefined}
            transition={layoutTransition}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={header?.title || "Card detail"}
          >
            <button type="button" className="exc-close" onClick={close} aria-label="Close">✕</button>

            {thumb && (
              <div className="exc-card-media">
                <motion.img
                  layoutId={reduce ? undefined : imgLayoutId}
                  className="exc-card-img"
                  src={thumb.url}
                  alt={header?.title || ""}
                  onError={thumb.fallbackUrl
                    ? (e) => { if (e.currentTarget.src !== thumb.fallbackUrl) e.currentTarget.src = thumb.fallbackUrl; }
                    : undefined}
                />
              </div>
            )}

            {header && (header.title || header.subtitle) && (
              <div className="exc-card-head">
                {header.title && <div className="exc-card-title">{header.title}</div>}
                {header.subtitle && <div className="exc-card-sub">{header.subtitle}</div>}
              </div>
            )}

            <div className="exc-card-body">
              {typeof renderExpanded === "function" ? renderExpanded({ close }) : renderExpanded}
            </div>

            {onOpenFull && (
              <div className="exc-card-foot">
                <button
                  type="button"
                  className="exc-openfull"
                  onClick={() => { close(); onOpenFull(); }}
                >{openFullLabel}</button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );

  return (
    <>
      {typeof children === "function"
        ? children({ open, isOpen, Tile, TileImg })
        : children}
      {overlay}
    </>
  );
}

export default ExpandableCard;
