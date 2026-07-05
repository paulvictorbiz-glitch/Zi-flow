/* =========================================================
   useOutsideClick(ref, handler, active) — fire `handler` when the user
   interacts outside `ref`, or presses Escape.

   Mirrors the robust capture-phase pattern already inlined in
   components.jsx (the ReelCard kebab menu) and EditProjectMenu.jsx:
     · listens on the CAPTURE phase (3rd arg `true`) so a child's
       stopPropagation can't swallow the dismiss;
     · also closes on Escape;
     · only attaches while `active` is true (default true).

   `handler` receives the originating event. Stable across renders is
   not required — the effect re-subscribes when `handler`/`active` change.
   ========================================================= */
import { useEffect } from "react";

export function useOutsideClick(ref, handler, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const onDown = (e) => {
      const el = ref && ref.current;
      if (!el || el.contains(e.target)) return;
      handler(e);
    };
    const onKey = (e) => { if (e.key === "Escape") handler(e); };
    // mousedown + touchstart on capture, keydown for Esc.
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("touchstart", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("touchstart", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [ref, handler, active]);
}

export default useOutsideClick;
