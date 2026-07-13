/* MobileNav — bottom tab bar + "More" sheet: the ONLY mobile navigation
   (contract C-NAV-REACH). Mounted unconditionally by AppShell; renders null
   unless useIsMobile().isMobile (≤768px), so the desktop DOM is untouched —
   there is no desktop branch to regress.

   Prop contract (AppShell passes what it already has — no store coupling):
     view          current view key (string)
     onNavigate    (key) => void — AppShell's goView (the single nav path)
     canViewView   (key) => bool — AppShell's hub-aware visibility gate
     tabs          TABS array [{ key, label }]
     groups        sortedGroups [{ key, label, tone, tabs:[key] }] — the user's
                   SAVED group order (nav_group_order), so the More sheet
                   mirrors the drawer exactly
     badges        { mywork: needsYouCount, inbox: inboxUnread, team: teamUnseen }
     reels         live reels array (for the global reel search)
     onOpenReel    (reel) => void — AppShell's openReel

   CSS contract (styled EXCLUSIVELY in src/styles-mobile.css, all rules gated
   @media (max-width: 768px) — this component ships ZERO inline styles).
   Class inventory for the styles-mobile.css owner:
     .mb-tabbar                 fixed bottom bar — height var(--mb-nav-h, 56px)
                                + padding-bottom var(--safe-bottom, 0px),
                                z-index 900 (C-NAV-Z: sheets/modals ≥1000 cover it)
     .mb-tab / .is-active       tab button (≥44px tap target) / active state
     .mb-tab-ic                 tab glyph
     .mb-tab-label              tab label (small caps under the glyph)
     .mb-tab-badge              numeric badge on a primary tab
     .mb-tab-dot                unread dot on the More tab (badged tab hidden in sheet)
     .mb-more-backdrop          full-screen scrim behind the sheet (z ≥1000)
     .mb-sheet                  bottom sheet panel (z ≥1000, slides up; MUST get a
                                @media (prefers-reduced-motion: reduce) still path;
                                padding-bottom includes var(--safe-bottom, 0px))
     .mb-sheet-grip             drag-handle pill
     .mb-sheet-head / -title / -close
     .mb-sheet-search           reel search input
     .mb-sheet-results / .mb-sheet-result / .mb-sheet-result-id / -title / -empty
     .mb-sheet-groups           scrollable group list
     .mb-sheet-group            one group block
     .mb-sheet-group-label      group heading (data-tone carries the group tone)
     .mb-sheet-tab / .is-active tab row inside a group
     .mb-sheet-tab-badge        numeric badge on a sheet tab row
*/

import React, { useState, useEffect, useMemo } from "react";
import { useIsMobile } from "../lib/use-is-mobile.js";

/* Preferred order for the 4 primary slots. Filtered through canViewView so a
   restricted role's bar backfills from its own visible tabs — the 4 slots are
   always tabs the signed-in perspective can actually open. */
const PRIMARY_PREF = ["mywork", "pipeline", "reeldna", "footage", "editor", "inbox", "team", "training", "monitor"];

/* Compact glyphs for the bar (text glyphs, matching the app's ▾/✕/⠿ style —
   no icon library, no new dependency). Unknown keys fall back to a dot. */
const GLYPHS = {
  mywork: "◈", pipeline: "▤", generate: "✦", reeldna: "⌬", music: "♪",
  footage: "▦", coverage: "◎", locations: "◉", editor: "✂", projects: "▣",
  lossless: "⧉", export: "⇪", training: "▲", resources: "❖", inbox: "✉",
  team: "☰", analytics: "∿", monitor: "◍", "content-forge": "⚒",
  fonts: "𝐀", activity: "≋",
};

export function MobileNav({
  view,
  onNavigate,
  canViewView,
  tabs = [],
  groups = [],
  badges = {},
  reels = [],
  onOpenReel,
}) {
  const { isMobile } = useIsMobile();
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState("");

  const labelOf = (key) => tabs.find((t) => t.key === key)?.label || key;

  /* 4 primary tabs: preference order first, then the saved-group flattening,
     both filtered to what this perspective can see (C-NAV-REACH). */
  const primaryTabs = useMemo(() => {
    const flat = groups.flatMap((g) => g.tabs);
    const ordered = [...PRIMARY_PREF, ...flat.filter((k) => !PRIMARY_PREF.includes(k))];
    const seen = new Set();
    const picked = [];
    for (const key of ordered) {
      if (seen.has(key)) continue;
      seen.add(key);
      if (typeof canViewView === "function" && !canViewView(key)) continue;
      picked.push(key);
      if (picked.length === 4) break;
    }
    return picked;
  }, [groups, canViewView]);

  /* Unread dot on "More" when a badged tab is only reachable through the sheet. */
  const moreHasBadge = useMemo(
    () => Object.entries(badges).some(([k, n]) => (n || 0) > 0 && !primaryTabs.includes(k)),
    [badges, primaryTabs]
  );

  /* Global reel search — same filter the topbar search uses (title, number,
     logline, shot plan), capped at 8. */
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return reels
      .filter((r) => !r.archivedAt &&
        ((r.title || "").toLowerCase().includes(q) ||
         String(r.display_number || r.id || "").toLowerCase().includes(q) ||
         (r.logline || "").toLowerCase().includes(q) ||
         (r.script || "").toLowerCase().includes(q)))
      .slice(0, 8);
  }, [query, reels]);

  const closeSheet = () => { setMoreOpen(false); setQuery(""); };

  /* Close the sheet on Escape (only while open). */
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e) => { if (e.key === "Escape") closeSheet(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  /* If the viewport leaves mobile (rotation / resize past 768px) the whole
     nav unmounts visually — make sure a stranded sheet can't reopen stale. */
  useEffect(() => {
    if (!isMobile && moreOpen) closeSheet();
  }, [isMobile, moreOpen]);

  /* Lock body scroll while the sheet is open — mobile-only by construction
     (the component renders null on desktop, and this effect no-ops there). */
  useEffect(() => {
    if (!isMobile || !moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isMobile, moreOpen]);

  /* Desktop (and tablet >768px): render NOTHING. The existing topbar /
     drawer / Solarin nav paths are untouched (zero-desktop-regression gate). */
  if (!isMobile) return null;

  const go = (key) => {
    closeSheet();
    if (typeof onNavigate === "function") onNavigate(key);
  };

  const openReel = (reel) => {
    closeSheet();
    if (typeof onOpenReel === "function") onOpenReel(reel);
  };

  return (
    <React.Fragment>
      {/* ── "More" sheet — full group/tab list (saved order) + reel search ── */}
      {moreOpen && (
        <React.Fragment>
          <div className="mb-more-backdrop" onClick={closeSheet} aria-hidden="true" />
          <div className="mb-sheet" role="dialog" aria-modal="true" aria-label="All tabs">
            <div className="mb-sheet-grip" aria-hidden="true" />
            <div className="mb-sheet-head">
              <span className="mb-sheet-title">Navigate</span>
              <button className="mb-sheet-close" aria-label="Close navigation sheet"
                      onClick={closeSheet}>✕</button>
            </div>
            <input
              className="mb-sheet-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reels…"
              aria-label="Search reels"
            />
            {query.trim() !== "" && (
              <ul className="mb-sheet-results">
                {searchResults.map((reel) => (
                  <li key={reel.id} className="mb-sheet-result"
                      onClick={() => openReel(reel)}>
                    <span className="mb-sheet-result-id">
                      {reel.display_number ? "#" + reel.display_number : reel.id}
                    </span>
                    <span className="mb-sheet-result-title">{reel.title || "(untitled)"}</span>
                  </li>
                ))}
                {searchResults.length === 0 && (
                  <li className="mb-sheet-result-empty">No matching reels</li>
                )}
              </ul>
            )}
            <div className="mb-sheet-groups">
              {groups.map((group) => {
                const groupTabs = group.tabs.filter(
                  (k) => typeof canViewView !== "function" || canViewView(k)
                );
                if (groupTabs.length === 0) return null;
                return (
                  <div key={group.key} className="mb-sheet-group">
                    <div className="mb-sheet-group-label" data-tone={group.tone || "cyan"}>
                      {group.label}
                    </div>
                    {groupTabs.map((key) => (
                      <button key={key}
                              className={"mb-sheet-tab" + (view === key ? " is-active" : "")}
                              onClick={() => go(key)}
                              aria-current={view === key ? "page" : undefined}>
                        <span className="mb-tab-ic" aria-hidden="true">{GLYPHS[key] || "•"}</span>
                        <span>{labelOf(key)}</span>
                        {(badges[key] || 0) > 0 && (
                          <span className="mb-sheet-tab-badge">{badges[key]}</span>
                        )}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </React.Fragment>
      )}

      {/* ── Bottom tab bar: 4 primary visible tabs + More (C-NAV-REACH) ── */}
      <nav className="mb-tabbar" role="navigation" aria-label="Primary">
        {primaryTabs.map((key) => (
          <button key={key}
                  className={"mb-tab" + (view === key && !moreOpen ? " is-active" : "")}
                  onClick={() => go(key)}
                  aria-current={view === key ? "page" : undefined}>
            <span className="mb-tab-ic" aria-hidden="true">{GLYPHS[key] || "•"}</span>
            <span className="mb-tab-label">{labelOf(key)}</span>
            {(badges[key] || 0) > 0 && <span className="mb-tab-badge">{badges[key]}</span>}
          </button>
        ))}
        <button className={"mb-tab mb-tab-more" + (moreOpen ? " is-active" : "")}
                onClick={() => (moreOpen ? closeSheet() : setMoreOpen(true))}
                aria-expanded={moreOpen}
                aria-haspopup="dialog">
          <span className="mb-tab-ic" aria-hidden="true">⋯</span>
          <span className="mb-tab-label">More</span>
          {moreHasBadge && <span className="mb-tab-dot" aria-hidden="true" />}
        </button>
      </nav>
    </React.Fragment>
  );
}
