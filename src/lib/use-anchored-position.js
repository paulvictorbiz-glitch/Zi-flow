/* =========================================================
   useAnchoredPosition — viewport-fixed placement for a popover/menu
   that must escape a clipping (overflow:hidden) or low-z-index
   stacking context by being rendered through a portal to <body>.

   The popover/menu lives in a stacking context (a pipeline card, a
   scrollable detail column) where `position:absolute` is both CLIPPED
   by the card's overflow clamp AND painted UNDER sibling cards. The
   fix (see memory reference_portal-escape-overflow-clip.md) is to
   render it into document.body with `position:fixed`, computing the
   coordinates from the trigger's getBoundingClientRect.

   Returns null while closed, otherwise a coords object to spread into
   the portaled element's inline style:
     { left, width, maxHeight, top? , bottom? }
   Exactly one of `top` / `bottom` is present (it flips above the
   trigger when there isn't room below). Repositions on scroll/resize
   so it tracks the trigger; the caller still owns open/close.
   ========================================================= */

import { useState, useEffect, useCallback } from "react";

export function useAnchoredPosition(
  open,
  triggerRef,
  { width = 280, align = "left", gap = 6 } = {}
) {
  const [coords, setCoords] = useState(null);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const w = Math.min(width, vw - 16);
    // Anchor the popover's left (default) or right edge to the trigger.
    let left = align === "right" ? r.right - w : r.left;
    if (left + w > vw - 8) left = vw - 8 - w;
    if (left < 8) left = 8;

    const spaceBelow = vh - r.bottom - 8;
    const spaceAbove = r.top - 8;

    // Prefer below; flip above only when below is cramped and above roomier.
    if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
      const top = r.bottom + gap;
      setCoords({ left, width: w, top, maxHeight: Math.max(120, vh - 8 - top) });
    } else {
      const bottom = vh - r.top + gap;
      setCoords({ left, width: w, bottom, maxHeight: Math.max(120, spaceAbove) });
    }
  }, [triggerRef, width, align, gap]);

  useEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    place();
    const onReflow = () => place();
    window.addEventListener("resize", onReflow);
    // capture:true → also catches scrolling inside any ancestor scrollbox
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, place]);

  return coords;
}
