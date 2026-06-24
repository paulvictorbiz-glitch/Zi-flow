/* =========================================================
   Editor UI preset — shared persistence for the CapCut | Classic
   view toggle of the embedded OpenCut editor.

   Single source of truth for BOTH places the toggle lives:
     · the editor view top bar  (src/pages/editor.jsx)
     · the projects gallery     (src/pages/editor-projects.jsx)

   'capcut' is the DEFAULT (owner decision 2026-06-24 — the
   reskinned CapCut layout is what a user gets unless they opt
   out); 'classic' is the byte-for-byte-unchanged classic OpenCut
   view, still reachable via the CapCut | Classic toggle.
   Persisted PER-USER in user_preferences (key 'editor_ui_preset')
   per CLAUDE.md rule 6, with a localStorage mirror as the offline
   / table-missing fallback. Both reads and writes degrade silently
   to the 'capcut' default — a missing prefs table can never brick
   the editor.
   ========================================================= */

import { supabase } from "./supabase-client.js";

export const EDITOR_UI_PRESET_KEY = "editor_ui_preset";

/* Coerce any value to a known preset; only an explicit 'classic' opts out —
   unknown/absent -> 'capcut' (the default). */
export function normalizePreset(value) {
  return value === "classic" ? "classic" : "capcut";
}

/* Per-user localStorage mirror key. */
function lsKey(personId) {
  return `${EDITOR_UI_PRESET_KEY}:${personId}`;
}

/* Resolve the preset for a person: user_preferences first, then the
   localStorage mirror, then the 'classic' default. Never throws. */
export async function loadEditorUiPreset(personId) {
  if (!personId) return "capcut";
  let resolved = null;
  try {
    const { data, error } = await supabase
      .from("user_preferences")
      .select("value")
      .eq("person_id", personId)
      .eq("key", EDITOR_UI_PRESET_KEY)
      .maybeSingle();
    if (!error && data?.value?.preset) resolved = data.value.preset;
  } catch { /* table missing / offline — fall through to localStorage */ }
  if (resolved == null) {
    try {
      const ls = window.localStorage.getItem(lsKey(personId));
      if (ls) resolved = ls;
    } catch { /* no localStorage — keep default */ }
  }
  return normalizePreset(resolved);
}

/* Persist the preset: optimistic localStorage mirror, then upsert to
   user_preferences ({ onConflict: 'person_id,key' }). Never throws.
   Returns the normalized preset that was written. */
export function saveEditorUiPreset(personId, next) {
  const preset = normalizePreset(next);
  try { if (personId) window.localStorage.setItem(lsKey(personId), preset); } catch { /* noop */ }
  if (personId) {
    (async () => {
      try {
        await supabase.from("user_preferences").upsert(
          { person_id: personId, key: EDITOR_UI_PRESET_KEY, value: { preset }, updated_at: new Date().toISOString() },
          { onConflict: "person_id,key" }
        );
      } catch (e) { console.warn("editor_ui_preset persist failed:", e?.message || e); }
    })();
  }
  return preset;
}
