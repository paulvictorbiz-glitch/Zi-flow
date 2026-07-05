import React, { useEffect, useRef } from "react";
import "./tracing-beam.css";

/**
 * TracingBeam — a thin vertical rail whose fill tracks WINDOW-scroll progress
 * through a target region (the Training page module list). This is NOT the
 * per-module completion bar (.tr-progress-fill) — it reflects scroll position,
 * not how much of the course is checked off.
 *
 * Pass a `targetRef` (preferred — a ref to the wrapping element around the
 * module list) or a `targetSelector` string as a fallback lookup.
 *
 * Dependency-light: a passive window scroll listener throttled with
 * requestAnimationFrame, a ResizeObserver + transitionend fallback for
 * expand/collapse height changes, and a CSS transform driven by the
 * `--beam-progress` custom property. No motion / useScroll.
 */
export function TracingBeam({ targetRef, targetSelector, anchor = 0.5 }) {
  const fillRef = useRef(null);
  // Cached measurements of the target region (document-space top + height).
  const metricsRef = useRef({ top: 0, height: 1 });
  const rafRef = useRef(0);

  useEffect(() => {
    const getTarget = () =>
      (targetRef && targetRef.current) ||
      (targetSelector ? document.querySelector(targetSelector) : null);

    // Recompute the target's document-space top offset + height. Called on
    // mount, resize, and expand/collapse (ResizeObserver + transitionend).
    const measure = () => {
      const el = getTarget();
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const height = Math.max(rect.height, 1); // avoid div-by-zero
      metricsRef.current = { top, height };
    };

    // Compute progress and drive the fill via a CSS custom property.
    const render = () => {
      rafRef.current = 0;
      const fill = fillRef.current;
      if (!fill) return;
      const { top, height } = metricsRef.current;
      // Anchor a point in the viewport (default: middle) against the region.
      const viewportAnchor = window.scrollY + window.innerHeight * anchor;
      let p = (viewportAnchor - top) / height;
      if (p < 0) p = 0;
      else if (p > 1) p = 1;
      fill.style.setProperty("--beam-progress", p.toFixed(4));
    };

    // Throttle scroll → one render per animation frame.
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(render);
    };

    // Re-measure then re-render (measurement can change progress).
    const remeasure = () => {
      measure();
      onScroll();
    };

    measure();
    render();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", remeasure, { passive: true });

    // ResizeObserver keeps measurements correct as modules expand/collapse.
    let ro = null;
    const el = getTarget();
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(remeasure);
      ro.observe(el);
    }

    // Fallback: module bodies animate height via CSS max-height transitions,
    // which a ResizeObserver can be slow to settle on. Capture transitionend
    // on the subtree and re-measure.
    const onTransitionEnd = (e) => {
      if (e.propertyName === "max-height" || e.propertyName === "height") {
        remeasure();
      }
    };
    if (el) el.addEventListener("transitionend", onTransitionEnd, true);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", remeasure);
      if (ro) ro.disconnect();
      if (el) el.removeEventListener("transitionend", onTransitionEnd, true);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [targetRef, targetSelector, anchor]);

  return (
    <div className="tb-rail" aria-hidden="true">
      <div className="tb-beam-fill" ref={fillRef} />
    </div>
  );
}

export default TracingBeam;
