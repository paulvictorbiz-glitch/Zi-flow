/* =========================================================
   VanishInput — a controlled <input>/<textarea> with two flourishes,
   ported to this repo's stack (plain CSS tokens + `motion`, NO Tailwind):

     1. Cycling placeholders — the `placeholders[]` fade/slide through one
        another (~2500ms) while the field is empty AND unfocused. Cycling
        pauses on focus or once the user has typed, and the interval is torn
        down on unmount (SPA — a leaked interval is a real bug).

     2. Vanish-on-submit — when `vanishOnSubmit` is on, pressing Enter (input
        mode) briefly dissolves the current text, THEN calls `onVanishComplete`.
        That callback is the ONLY place the caller's real submit runs — the
        component owns a single in-flight guard so repeated Enter presses (or a
        button that also routes through here) can never double-fire.

   Alignment of the animated overlays is copied from the underlying element's
   own computed style, so it stays pixel-matched to whatever CSS the consumer
   applies (aib-input, gen-textarea, …) without hard-coding padding.
   ========================================================= */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";

export const VanishInput = React.forwardRef(function VanishInput(
  {
    as = "input",
    value = "",
    onChange,
    placeholders,
    vanishOnSubmit,
    onVanishComplete,
    submitRef,
    className,
    disabled,
    ...rest
  },
  forwardedRef,
) {
  const isTextarea = as === "textarea";
  // Default: vanish for single-line inputs, no dissolve for textareas.
  const doVanish = vanishOnSubmit === undefined ? !isTextarea : !!vanishOnSubmit;

  // Peel handlers/style off `rest` so we can compose (not clobber) them.
  const {
    placeholder: restPlaceholder,
    onKeyDown: restKeyDown,
    onFocus: restFocus,
    onBlur: restBlur,
    style: restStyle,
    ...passthrough
  } = rest;

  const list = Array.isArray(placeholders) ? placeholders.filter(Boolean) : [];
  const hasCycle = list.length > 0;
  const empty = !value;

  const [phIndex, setPhIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const [vanishing, setVanishing] = useState(false);
  const vanishingRef = useRef(false); // synchronous guard against double-submit

  const elRef = useRef(null);
  const setRefs = useCallback(
    (node) => {
      elRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  // Mirror the element's own typography/padding onto the animated overlays.
  const [boxStyle, setBoxStyle] = useState({});
  useEffect(() => {
    const el = elRef.current;
    if (!el || typeof getComputedStyle !== "function") return;
    const cs = getComputedStyle(el);
    setBoxStyle({
      fontSize: cs.fontSize,
      fontFamily: cs.fontFamily,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      paddingTop: cs.paddingTop,
      paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom,
      paddingLeft: cs.paddingLeft,
    });
  }, []);

  // Cycle placeholders — but only while empty AND unfocused. Interval is torn
  // down whenever paused or on unmount.
  const paused = focused || !empty || vanishing;
  useEffect(() => {
    if (!hasCycle || paused || list.length < 2) return;
    const id = setInterval(() => {
      setPhIndex((i) => (i + 1) % list.length);
    }, 2500);
    return () => clearInterval(id);
  }, [hasCycle, paused, list.length]);

  // ── Single submission path ────────────────────────────────────────────────
  const fallbackTimer = useRef(null);
  useEffect(() => () => clearTimeout(fallbackTimer.current), []);

  // Idempotent: whichever of (animation-complete | fallback-timeout) lands
  // first runs the caller's submit exactly once, then flips the guard off.
  const finishVanish = useCallback(() => {
    if (!vanishingRef.current) return;
    vanishingRef.current = false;
    clearTimeout(fallbackTimer.current);
    setVanishing(false);
    onVanishComplete?.();
  }, [onVanishComplete]);

  const triggerSubmit = useCallback(() => {
    if (disabled) return;
    if (!String(value).trim()) return;
    if (vanishingRef.current) return; // already in flight — ignore
    if (!doVanish) {
      onVanishComplete?.();
      return;
    }
    vanishingRef.current = true;
    setVanishing(true);
    // finishVanish fires from the overlay's onAnimationComplete; this timeout is
    // a belt-and-suspenders fallback if the animation is skipped/interrupted
    // (e.g. reduced-motion) so the submit never gets stranded.
    clearTimeout(fallbackTimer.current);
    fallbackTimer.current = setTimeout(finishVanish, 500);
  }, [disabled, value, doVanish, onVanishComplete, finishVanish]);

  // Expose the SAME guarded submit to the caller (e.g. an external "Ask"
  // button) so it can never double-fire with a vanish already in flight.
  useEffect(() => {
    if (!submitRef) return undefined;
    submitRef.current = triggerSubmit;
    return () => {
      if (submitRef.current === triggerSubmit) submitRef.current = null;
    };
  }, [submitRef, triggerSubmit]);

  const handleKeyDown = (e) => {
    restKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (!doVanish || isTextarea) return; // Enter-submit is input-mode only
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent?.isComposing) {
      e.preventDefault();
      triggerSubmit();
    }
  };

  // ── Overlay geometry (shared by placeholder + vanish overlays) ─────────────
  const overlayBase = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    overflow: "hidden",
    boxSizing: "border-box",
    whiteSpace: isTextarea ? "pre-wrap" : "nowrap",
    textOverflow: "ellipsis",
    fontSize: boxStyle.fontSize,
    fontFamily: boxStyle.fontFamily,
    fontWeight: boxStyle.fontWeight,
    lineHeight: boxStyle.lineHeight,
    letterSpacing: boxStyle.letterSpacing,
    paddingLeft: boxStyle.paddingLeft,
    paddingRight: boxStyle.paddingRight,
    ...(isTextarea
      ? { paddingTop: boxStyle.paddingTop }
      : { display: "flex", alignItems: "center" }),
  };

  const elStyle = {
    ...restStyle,
    ...(vanishing
      ? { color: "transparent", WebkitTextFillColor: "transparent", caretColor: "transparent" }
      : null),
  };

  const commonProps = {
    ref: setRefs,
    className,
    value,
    onChange,
    disabled,
    // When we own the animated placeholder, blank the native one; otherwise
    // fall back to whatever placeholder the caller passed.
    placeholder: hasCycle ? "" : restPlaceholder,
    onKeyDown: handleKeyDown,
    onFocus: (e) => {
      setFocused(true);
      restFocus?.(e);
    },
    onBlur: (e) => {
      setFocused(false);
      restBlur?.(e);
    },
    style: elStyle,
    ...passthrough,
  };

  return (
    <div
      style={{
        position: "relative",
        minWidth: 0,
        ...(isTextarea ? { width: "100%" } : { flex: "1 1 auto" }),
      }}
    >
      {isTextarea ? <textarea {...commonProps} /> : <input {...commonProps} />}

      {/* Cycling placeholder — only while genuinely empty and not vanishing. */}
      {hasCycle && empty && !vanishing && (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={phIndex}
            style={{ ...overlayBase, color: "var(--dim, #8a8a92)" }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 0.65, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            {list[phIndex % list.length]}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Vanish dissolve of the current value. */}
      {vanishing && (
        <motion.div
          style={{ ...overlayBase, color: "var(--fg, #e0e0e0)" }}
          initial={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          animate={{ opacity: 0, filter: "blur(4px)", y: -6 }}
          transition={{ duration: 0.36, ease: "easeIn" }}
          onAnimationComplete={finishVanish}
        >
          {value}
        </motion.div>
      )}
    </div>
  );
});

export default VanishInput;
