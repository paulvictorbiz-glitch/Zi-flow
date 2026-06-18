/* =========================================================
   ThemeProvider — opt-in "Comfortable" display mode.

   Per-browser display preferences (legibility/theme, text
   size, font family) stored in localStorage and applied as
   data-* attributes on <html>. Mirrors the existing wb_*
   localStorage prefs pattern used in app.jsx (wb_view, etc.).

   CRITICAL: when a pref is at its default it is REMOVED from
   the DOM (not set to "default"), so an unconfigured browser
   has zero attribute surface and the site renders byte-for-byte
   as the current live default. All accessible styling lives in
   theme-accessible.css, scoped under these attributes.
   ========================================================= */

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

const KEY_THEME = "wb_theme";       // "default" | "accessible"
const KEY_SCALE = "wb_fontscale";   // "80".."200" (percent zoom, "100" = default)
const KEY_FONT  = "wb_font";        // "inter" | "system" | "serif" | "rounded" | "mono" | "dyslexic"

const DEFAULTS = { theme: "default", fontScale: "100", font: "inter" };

// Known-good vocabularies of the rebuilt theme-accessible.css. Anything outside
// these sets (e.g. legacy values from the previously-deployed Comfortable mode)
// would match NO CSS rule and silently break the control, so we sanitize on read.
const SCALES = new Set(["80", "90", "100", "110", "125", "150", "175", "200"]);
const FONTS  = new Set(["inter", "system", "serif", "rounded", "mono", "dyslexic"]);
const THEMES = new Set(["default", "accessible"]);

// Map retired scale vocabulary to the nearest current step; unknown -> default.
const LEGACY_SCALE = { normal: "100", large: "125", xl: "150" };

function read(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function readTheme() {
  const v = read(KEY_THEME, DEFAULTS.theme);
  return THEMES.has(v) ? v : DEFAULTS.theme;
}

function readScale() {
  const v = read(KEY_SCALE, DEFAULTS.fontScale);
  if (SCALES.has(v)) return v;
  if (Object.prototype.hasOwnProperty.call(LEGACY_SCALE, v)) return LEGACY_SCALE[v];
  return DEFAULTS.fontScale;
}

function readFont() {
  const v = read(KEY_FONT, DEFAULTS.font);
  return FONTS.has(v) ? v : DEFAULTS.font;
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState]         = useState(readTheme);
  const [fontScale, setFontScaleState] = useState(readScale);
  const [font, setFontState]           = useState(readFont);

  /* Apply prefs to <html> as data-* attributes. Defaults are
     removed entirely so there is no selector surface to match. */
  useEffect(() => {
    const el = document.documentElement;

    if (theme === "default") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", theme);

    if (fontScale === DEFAULTS.fontScale) el.removeAttribute("data-fontscale");
    else el.setAttribute("data-fontscale", fontScale);

    if (font === "inter") el.removeAttribute("data-font");
    else el.setAttribute("data-font", font);

    // On unmount (e.g. sign-out → pre-auth landing), clear everything
    // so the public page's own namespace is never touched.
    return () => {
      el.removeAttribute("data-theme");
      el.removeAttribute("data-fontscale");
      el.removeAttribute("data-font");
    };
  }, [theme, fontScale, font]);

  const setTheme = useCallback((v) => {
    setThemeState(v);
    try { v === DEFAULTS.theme ? localStorage.removeItem(KEY_THEME) : localStorage.setItem(KEY_THEME, v); } catch {}
  }, []);

  const setFontScale = useCallback((v) => {
    setFontScaleState(v);
    try { v === DEFAULTS.fontScale ? localStorage.removeItem(KEY_SCALE) : localStorage.setItem(KEY_SCALE, v); } catch {}
  }, []);

  const setFont = useCallback((v) => {
    setFontState(v);
    try { v === DEFAULTS.font ? localStorage.removeItem(KEY_FONT) : localStorage.setItem(KEY_FONT, v); } catch {}
  }, []);

  const reset = useCallback(() => {
    setTheme(DEFAULTS.theme);
    setFontScale(DEFAULTS.fontScale);
    setFont(DEFAULTS.font);
  }, [setTheme, setFontScale, setFont]);

  const value = { theme, fontScale, font, setTheme, setFontScale, setFont, reset };
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
