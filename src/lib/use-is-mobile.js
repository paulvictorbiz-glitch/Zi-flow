/* Shared mobile-detection contract (T1 FOUNDATION — frozen C-HOOK).

   Exports:
     · useIsMobile()        → { isMobile, isTablet, isTouch }
     · useMediaQuery(query) → live boolean for any media query string
     · BP_PHONE / BP_MOBILE / BP_TABLET breakpoint constants

   STANDALONE-SAFE: pure matchMedia backed by useSyncExternalStore, fully
   SSR/window-guarded — guaranteed correct with NO provider mounted (HudSpace
   /space, Landing /, PortfolioFront /3d, lazy pages, demo contexts). The
   optional <MobileProvider> (mounted by AppShell) is memoization-only sugar;
   consumers must never depend on it. */

import React, { createContext, useContext, useMemo, useSyncExternalStore } from "react";

/* Frozen breakpoint constants (C-BREAKPOINTS): the ONLY sanctioned global
   width gates are max-width 480 / 768 / 1024. Pre-existing ad-hoc queries
   (landing 900/760, asset-fan 720) stay untouched by design. */
export const BP_PHONE = 480;
export const BP_MOBILE = 768;
export const BP_TABLET = 1024;

/* The JS matchMedia query strings are the LITERAL same strings as the CSS
   @media gates — boundary inclusive: (max-width: 768px) matches 768 exactly —
   so JS and CSS can never disagree at a boundary pixel. T10 mirrors these
   exact strings 1:1 in its own repo's useMotionPrefs.js (copy, never import). */
export const MQ_PHONE = "(max-width: 480px)";
export const MQ_MOBILE = "(max-width: 768px)";
export const MQ_TABLET = "(max-width: 1024px)";
const MQ_COARSE = "(pointer: coarse)";

const hasMatchMedia = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function";

/* Per-query external store, cached in a module Map so subscribe/getSnapshot
   are referentially stable across renders and shared by every consumer of the
   same query string (one MediaQueryList listener per mounted subscription). */
const queryStores = new Map();
function storeFor(query) {
  let store = queryStores.get(query);
  if (!store) {
    store = {
      subscribe(onStoreChange) {
        if (!hasMatchMedia()) return () => {};
        const mql = window.matchMedia(query);
        const handler = () => onStoreChange();
        if (mql.addEventListener) mql.addEventListener("change", handler);
        else mql.addListener(handler); // Safari < 14 fallback
        return () => {
          if (mql.removeEventListener) mql.removeEventListener("change", handler);
          else mql.removeListener(handler);
        };
      },
      // Booleans are primitives, so a fresh .matches read is a valid stable
      // snapshot (only differs when the media state actually changed).
      getSnapshot: () => (hasMatchMedia() ? window.matchMedia(query).matches : false),
      getServerSnapshot: () => false,
    };
    queryStores.set(query, store);
  }
  return store;
}

/* Live boolean for an arbitrary media query string. No provider required. */
export function useMediaQuery(query) {
  const store = storeFor(query);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

const hasTouchPoints = () =>
  typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 0;

/* Optional memoization-only sugar. AppShell mounts it so shell-tree consumers
   share one memoized object; the hook below never requires it. */
const MobileContext = createContext(null);

function useMobileValue() {
  const isMobile = useMediaQuery(MQ_MOBILE);
  const isTablet = useMediaQuery(MQ_TABLET);
  const coarsePointer = useMediaQuery(MQ_COARSE);
  const isTouch = coarsePointer || hasTouchPoints();
  return useMemo(
    () => ({ isMobile, isTablet, isTouch }),
    [isMobile, isTablet, isTouch]
  );
}

export function MobileProvider({ children }) {
  const value = useMobileValue();
  // Plain .js file (no JSX) so Vite's default .js loader never chokes.
  return React.createElement(MobileContext.Provider, { value }, children);
}

/* useIsMobile() → { isMobile, isTablet, isTouch }.
     isMobile = matchMedia("(max-width: 768px)")
     isTablet = matchMedia("(max-width: 1024px)")
     isTouch  = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0
   Always subscribes its own matchMedia stores (correct standalone); when the
   optional provider is mounted it returns the provider's memoized object so
   every shell consumer shares one reference. */
export function useIsMobile() {
  const ctx = useContext(MobileContext);
  const value = useMobileValue();
  return ctx || value;
}
