/* =========================================================
   cn(...) — tiny classname joiner (clsx-style, ~zero deps).

   The app has NO Tailwind, so tailwind-merge is pointless; this is just
   a truthy-filter join so components can compose conditional class names
   without ad-hoc template strings. Accepts strings, arrays, and
   { "class-name": boolean } objects, at any nesting depth.

     cn("card", isOn && "card--on", ["a", cond && "b"], { danger: err })
   ========================================================= */
export function cn(...parts) {
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === "string" || typeof p === "number") {
      out.push(String(p));
    } else if (Array.isArray(p)) {
      const inner = cn(...p);
      if (inner) out.push(inner);
    } else if (typeof p === "object") {
      for (const k in p) if (p[k]) out.push(k);
    }
  }
  return out.join(" ");
}

export default cn;
