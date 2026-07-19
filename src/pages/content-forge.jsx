/* Content Forge — owner-only AI content discovery + hook generation.

   Reads ranked `content_opportunities` straight from Supabase (the same direct-
   query model as scout.jsx — NOT the workflow store). Discovery and hook
   expansion are proxied to the Hetzner backend through the existing Vercel
   functions (api/ai/suggest.js — folded ?action=forge-* by the API team); the
   new rows arrive back via a Supabase realtime subscription + tab-focus poll.

   Flow:
     Discover (Free|Pro tier) → ranked opportunity list (S/A/B/C virality)
       → click an opportunity → ForgeModal (portaled to <body>)
         → 3 hook columns (Curiosity Gap / Controversy / Personal Stakes)
           → Select a hook + a target reel → Send to Pipeline
             → writes reels.creative_brief + updates the opportunity row.

   Owner-only: useIsOwner() (NOT useWorkflow().isOwner — that returns undefined). */

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase-client.js";
import { useIsOwner, usePermissions } from "../lib/permissions.jsx";
import { useWorkflow, nextReelId } from "../store/store.jsx";
import { useRoster } from "../lib/roster.jsx";
import { isBlockedSync, recordUsage } from "../lib/free-llm-gates.js";
import { footageFolderLabel } from "../lib/footage-brain-client.js";
import { ForgeAnalytics } from "./forge-analytics.jsx";
import "../content-forge.css";

/* Virality tiers, best → worst. Order drives the filter pills + sort. */
const TIERS = ["S", "A", "B", "C"];

/* Row-tag palette (8 tones) for the favorite/color tagging — `key` is what's stored
   in content_opportunities.color; `hex` drives the swatch + row tint. */
const ROW_COLORS = [
  { key: "red",    hex: "#ef4444" },
  { key: "orange", hex: "#f59e0b" },
  { key: "yellow", hex: "#eab308" },
  { key: "green",  hex: "#22c55e" },
  { key: "teal",   hex: "#14b8a6" },
  { key: "blue",   hex: "#3b82f6" },
  { key: "purple", hex: "#a855f7" },
  { key: "pink",   hex: "#ec4899" },
];
const COLOR_HEX = Object.fromEntries(ROW_COLORS.map((c) => [c.key, c.hex]));

/* The 3 hook angles ForgeModal expands into. `key` matches the backend's
   hook_versions[].style; `version` is the 1-based slot the row stores. */
const HOOK_STYLES = [
  { version: 1, key: "curiosity",       label: "Curiosity Gap" },
  { version: 2, key: "controversy",     label: "Controversy" },
  { version: 3, key: "personal_stakes", label: "Personal Stakes" },
];

const STYLE_LABEL = {
  curiosity: "Curiosity Gap",
  controversy: "Controversy",
  personal_stakes: "Personal Stakes",
};

/* VO/Script tab constants */
const SCRIPT_TEMPLATES = [
  { key: "fact-reveal",    label: "Fact-Reveal",    desc: "Surprising fact → cause/story → reflection" },
  { key: "hot-take",       label: "Hot Take",        desc: "Controversial premise → what people miss → debate" },
  { key: "question-hook",  label: "Question-Hook",   desc: "Direct question → stakes → answer" },
  { key: "story-first",    label: "Story-First",     desc: "Mid-story open → conflict → moral" },
];
const GROUNDING_MODES = [
  { key: "footage", label: "Footage-only",    title: "Strict: only uses your clip transcripts. No hallucination risk." },
  { key: "model",   label: "Model knowledge", title: "Model adds real-world facts from training. Faster, richer, some hallucination risk." },
  { key: "web",     label: "Web-grounded",    title: "Tavily search adds verified facts before scripting. Best quality, slowest, small extra cost." },
];
const TONES_LIST = [
  { key: "neutral",      label: "Neutral" },
  { key: "punchy",       label: "Punchy" },
  { key: "educational",  label: "Educational" },
  { key: "provocative",  label: "Provocative" },
];

function wordCount(text) {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

/* Vetting segments — the triage workflow. The owner vets discovered opportunities
   on title+angle (no LLM spend); only 'shortlisted' ones can be elevated/expounded.
   vet_state is a column orthogonal to `status` (migration 0104) — a row stays
   'shortlisted' even after it's expanded into hooks. A missing/absent value (e.g.
   before the migration is applied) reads as 'new'. */
const VET_VIEWS = ["new", "shortlisted", "rejected", "all"];
const VET_LABEL = { new: "New", shortlisted: "Shortlisted", rejected: "Rejected", all: "All" };
const vetOf = (o) => o?.vet_state || "new";

const DEFAULT_SORT = { key: "virality", dir: "desc" };

/* Discovery TARGET presets — the region/country the discovery pass should aim the
   angles at. This is a HINT fed to the LLM, independent of the post-hoc filter
   dropdown (which is derived from already-discovered rows). "__custom__" reveals a
   free-text box so any country/region can be targeted before any opportunity
   exists — the fix for "couldn't select a particular country". */
const DISCOVERY_TARGETS = [
  { value: "global", label: "Global (no specific country)" },
  { value: "United States", label: "United States" },
  { value: "United Kingdom", label: "United Kingdom" },
  { value: "Canada", label: "Canada" },
  { value: "Australia", label: "Australia" },
  { value: "India", label: "India" },
  { value: "Nigeria", label: "Nigeria" },
  { value: "Philippines", label: "Philippines" },
  { value: "__custom__", label: "Custom…" },
];

/* How long the post-Discover poll waits for the background batch to write rows. */
const FORGE_POLL_TRIES = 14;
const FORGE_POLL_MS = 2500;
/* Whole-library ingest runs for minutes server-side, so its progress poll runs longer.
   It's only a feedback loop — the fire-and-forget worker keeps going regardless. */
const FORGE_LIB_POLL_TRIES = 40;

/* OUTCOME #2 — how long to wait for the blueprint variation sheet (forge-script
   mode=blueprint) before treating the background job as DEAD. Suggest.js raises its
   abort budget to ~55s for mode==='blueprint', so give the client a slightly longer
   ceiling; on trip we abort → blueprintStatus 'error' → the Regenerate button recovers. */
const BLUEPRINT_TIMEOUT_MS = 60000;

/* Google Drive share-URL → permanent file ID. Store the ID, never the raw URL.
   Falls through to the input unchanged if no ID pattern is found (lets a bare
   file ID paste straight through). */
const extractFileId = (url) =>
  /(?:\/d\/|[?&]id=)([-\w]{25,})/.exec(url)?.[1] ?? url;

function tierRank(t) {
  const i = TIERS.indexOf(String(t || "C").toUpperCase());
  return i === -1 ? TIERS.length : i;
}
function scoreOf(row) {
  const s = row?.virality_score;
  return typeof s === "number" ? s : 0;
}
function fmtScore(row) {
  const s = row?.virality_score;
  return typeof s === "number" ? Math.round(s * 100) : "—";
}
function fmtDate(iso) {
  if (!iso || typeof iso !== "string") return "—";
  if (!Number.isFinite(Date.parse(iso))) return "—";
  return iso.slice(0, 10);
}

/* Pull the hook for a given 1-based version out of an opportunity's
   hook_versions array, tolerant of either {version} or array position. */
function hookForVersion(hookVersions, version) {
  if (!Array.isArray(hookVersions)) return null;
  return (
    hookVersions.find((h) => Number(h?.version) === version) ||
    hookVersions[version - 1] ||
    null
  );
}

/* Has this opportunity already been expanded into real hooks? Used to (a) skip
   re-spending tokens when ForgeModal opens on an already-expounded row, and (b)
   badge such rows so the owner doesn't elevate them twice. */
function hasHooks(o) {
  return Array.isArray(o?.hook_versions) && o.hook_versions.some((h) => h?.text);
}
function isExpanded(o) {
  return ["hook_generated", "attached", "sent"].includes(o?.status) || hasHooks(o);
}
function hookCount(o) {
  return Array.isArray(o?.hook_versions)
    ? o.hook_versions.filter((h) => h?.text).length
    : 0;
}

const COLUMNS = [
  { key: null, label: "★", cls: "cf-c-tag" },
  { key: "virality", label: "Tier", cls: "cf-c-tier" },
  { key: null, label: "Opportunity" },
  { key: null, label: "Topics" },
  { key: null, label: "Country" },
  { key: "virality", label: "Score", cls: "cf-num" },
  { key: "newest", label: "Created", cls: "cf-num" },
  { key: null, label: "Status" },
];

/* =========================================================================
   ForgeModal — expand one opportunity into 3 hooks, pick one, send to a reel.
   Also generates full VO scripts (3rd tab) and shows source clip attribution.
   Portaled to document.body so an overflow/transform ancestor never clips it
   (ref: reference_portal-escape-overflow-clip.md).
   ========================================================================= */
function ForgeModal({ opportunity, tier, model, reels, onClose, onSent, showToast }) {
  // Per-column hook text, keyed by 1-based version. Seeded from any hooks the
  // row already carries, then refreshed by the expand call.
  const seed = useCallback(
    (hv) => {
      const next = {};
      for (const s of HOOK_STYLES) {
        const h = hookForVersion(hv, s.version);
        next[s.version] = h?.text ?? "";
      }
      return next;
    },
    []
  );

  const [hookText, setHookText] = useState(() => seed(opportunity.hook_versions));
  const [returnedVersions, setReturnedVersions] = useState(() => {
    const got = new Set();
    for (const s of HOOK_STYLES) {
      if (hookForVersion(opportunity.hook_versions, s.version)?.text) got.add(s.version);
    }
    return got;
  });
  // `storeReels` = the store's FULL reel list — used to mint the next REEL-NNN
  // id up-front (the `reels` prop is a trimmed id/title/archived_at select).
  const { actions, reels: storeReels } = useWorkflow();
  const { peopleList } = useRoster();
  // Editors that can own a new reel = non-reviewer, non-archived people.
  const editors = useMemo(
    () => (peopleList || []).filter(p => p && !p.archivedAt && p.role !== "reviewer"),
    [peopleList]);
  const [selectedHook, setSelectedHook] = useState(null);
  const [targetOwner, setTargetOwner] = useState("paul");
  const [expanding, setExpanding] = useState(false);
  const [expandErr, setExpandErr] = useState(null);
  const [sending, setSending] = useState(false);
  const [hasRun, setHasRun] = useState(() => {
    const got = new Set();
    for (const s of HOOK_STYLES) {
      if (hookForVersion(opportunity.hook_versions, s.version)?.text) got.add(s.version);
    }
    return got.size > 0;
  });
  const isVetted = vetOf(opportunity) === "shortlisted";

  // Tab navigation: "hooks" | "script"
  const [activeTab, setActiveTab] = useState("hooks");

  // Script tab state
  const [scriptTemplate, setScriptTemplate] = useState("fact-reveal");
  const [scriptGrounding, setScriptGrounding] = useState("footage");
  const [scriptTone, setScriptTone] = useState("neutral");
  const [scriptJson, setScriptJson] = useState(() => opportunity.script_json || null);
  const [generating, setGenerating] = useState(false);
  const [generateErr, setGenerateErr] = useState(null);

  // Tavily grounding result from the last Expound call — {skipped, sources:[{title,url,snippet}]}.
  // Seeded from the row (persisted by /expand) so a re-opened modal still shows what was found.
  const [factCheck, setFactCheck] = useState(() => opportunity.fact_check_result || null);

  // Source clips: null = not loaded yet, [] = none found, [{id, filename, drive_url, ...}]
  const [sourceClips, setSourceClips] = useState(null);

  // ── OUTCOME #2 — blueprint variation sheet (the REEL-360/377 gold-standard) ──
  // Generated by the EXTENDED forge-script action (Contract 2, mode='blueprint')
  // AFTER hooks return (trigger A), reviewed here, then persisted on Send.
  // blueprintStatus: idle | generating | ready | error. Seeded 'ready' when the
  // re-opened row already carries a blueprint_json (persisted by Team D / re-seeded
  // per Migration 0113); vo_markdown isn't stored on the opportunity, so blueprintVo
  // starts empty on re-open and only fills in on a fresh generation this session.
  const [blueprintJson, setBlueprintJson] = useState(() => opportunity.blueprint_json || null);
  const [blueprintVo, setBlueprintVo] = useState("");
  const [blueprintStatus, setBlueprintStatus] = useState(
    () => (opportunity.blueprint_json ? "ready" : "idle")
  );
  const [blueprintErr, setBlueprintErr] = useState(null);
  const [blueprintPersisted, setBlueprintPersisted] = useState(true);
  // Holds the in-flight AbortController so the timeout (and unmount) can kill a
  // stalled blueprint job — the recoverability requirement.
  const blueprintAbortRef = useRef(null);

  // Fetch source clip attribution on mount.
  useEffect(() => {
    const clipIds = Array.isArray(opportunity.source_clip_ids)
      ? opportunity.source_clip_ids.filter(Boolean)
      : [];
    if (!clipIds.length) { setSourceClips([]); return; }

    let cancelled = false;
    (async () => {
      try {
        // Drive links are stamped straight onto transcript_clips at ingest (migration
        // 0108, from the parent reel's detail.footageDrive), so read them directly — no
        // attached_footage_items round-trip. Clips ingested before the backfill have
        // NULL drive_url and degrade to filename-only until the next Ingest.
        const { data: clips } = await supabase
          .from("transcript_clips")
          // source_path is carried so Send-to-Pipeline can stamp the NOT-NULL
          // attached_footage_items.source_path column (OUTCOME #4).
          .select("id,filename,footage_file_id,drive_url,drive_folder_url,source_path")
          .in("id", clipIds.slice(0, 20));
        if (cancelled || !clips?.length) { setSourceClips([]); return; }

        if (!cancelled) {
          // Each transcript_clips row is one TIME SEGMENT of a source video — an opportunity
          // can legitimately cite several segments cut from the same underlying file (they
          // share footage_file_id + drive_url but have different transcript text/timestamps).
          // That's fine for grounding context, but as a "reference" list to the user it would
          // show the same file/Drive link more than once. De-dup by footage_file_id (falling
          // back to the drive_url, then filename, for older rows ingested pre-0108) so each
          // underlying clip/file shows up exactly once.
          const seen = new Set();
          const deduped = [];
          for (const c of clips) {
            const key = c.footage_file_id || c.drive_url || c.filename || c.id;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push({
              id: c.id,
              footage_file_id: c.footage_file_id || null,
              filename: c.filename || c.footage_file_id || "clip",
              source_path: c.source_path || null,
              drive_url: c.drive_url || null,
              drive_folder_url: c.drive_folder_url || null,
            });
          }
          setSourceClips(deduped);
        }
      } catch {
        if (!cancelled) setSourceClips([]);
      }
    })();
    return () => { cancelled = true; };
  }, [opportunity.id, opportunity.source_clip_ids]);

  const applyHooks = useCallback((hookVersions) => {
    if (!Array.isArray(hookVersions)) return;
    const got = new Set();
    setHookText((prev) => {
      const next = { ...prev };
      for (const s of HOOK_STYLES) {
        const h = hookForVersion(hookVersions, s.version);
        if (h?.text) { next[s.version] = h.text; got.add(s.version); }
      }
      return next;
    });
    setReturnedVersions((prev) => new Set([...prev, ...got]));
  }, []);

  // OUTCOME #2 (trigger A) — generate the blueprint variation sheet via the EXTENDED
  // forge-script action (Contract 2: mode='blueprint'). Called automatically once
  // Expound's hooks land, and re-runnable via the Regenerate button. The AbortController
  // + BLUEPRINT_TIMEOUT_MS make a dead/stalled background job recoverable (→ 'error').
  // Treats blueprint_json as OPAQUE (persisted verbatim on Send); renders vo_markdown.
  const runBlueprint = useCallback(async () => {
    if (isBlockedSync("content_forge")) {
      setBlueprintStatus("error");
      setBlueprintErr("Content Forge is disabled — enable it in Monitor → Free LLM Gates.");
      return;
    }
    recordUsage("content_forge");
    // Kill any prior in-flight run before starting a fresh one.
    blueprintAbortRef.current?.abort();
    const controller = new AbortController();
    blueprintAbortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), BLUEPRINT_TIMEOUT_MS);
    setBlueprintStatus("generating");
    setBlueprintErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setBlueprintStatus("error"); setBlueprintErr("Not signed in."); return; }
      const styleKey =
        selectedHook != null ? HOOK_STYLES.find((s) => s.version === selectedHook)?.key : undefined;
      const r = await fetch("/api/ai/suggest?action=forge-script", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          // The ONLY behavioural switch (Contract 2) — default 'script' path is untouched.
          mode: "blueprint",
          opportunity_id: opportunity.id,
          // Pass-through hook context (optional; Team D reads what it needs, ignores extras).
          selected_hook_version: selectedHook ?? undefined,
          hook_text: selectedHook != null ? (hookText[selectedHook] || "") : undefined,
          hook_style: styleKey,
          template: scriptTemplate,
          grounding_mode: scriptGrounding,
          tone: scriptTone,
          tier,
          model,
        }),
        signal: controller.signal,
      });
      const body = await r.json().catch(() => ({}));
      if (body?.blocked) {
        setBlueprintStatus("error");
        setBlueprintErr(body.error || "Content Forge LLM is paused — re-enable in Monitor → API Budgets & Limits.");
        return;
      }
      if (!r.ok) {
        setBlueprintStatus("error");
        setBlueprintErr(body.error || `Blueprint generation failed (${r.status}).`);
        return;
      }
      if (body.blueprint_json) setBlueprintJson(body.blueprint_json);
      if (typeof body.vo_markdown === "string") setBlueprintVo(body.vo_markdown);
      setBlueprintPersisted(body.persisted !== false);
      if (body.blueprint_json) {
        setBlueprintStatus("ready");
      } else {
        setBlueprintStatus("error");
        setBlueprintErr("No blueprint returned. Click Regenerate to retry.");
      }
    } catch (e) {
      setBlueprintStatus("error");
      setBlueprintErr(
        e?.name === "AbortError"
          ? "Blueprint timed out — the background job may have stalled. Click Regenerate to retry."
          : (e?.message || "Could not reach the blueprint generator.")
      );
    } finally {
      clearTimeout(timer);
      if (blueprintAbortRef.current === controller) blueprintAbortRef.current = null;
    }
  }, [opportunity.id, selectedHook, hookText, scriptTemplate, scriptGrounding, scriptTone, tier, model]);

  // Kill an in-flight blueprint job if the modal unmounts mid-generation.
  useEffect(() => () => { blueprintAbortRef.current?.abort(); }, []);

  const runExpand = useCallback(async () => {
    if (isBlockedSync("content_forge")) {
      setExpandErr("Content Forge is disabled — enable it in Monitor → Free LLM Gates.");
      return;
    }
    recordUsage("content_forge");
    setHasRun(true);
    setExpanding(true);
    setExpandErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setExpandErr("Not signed in."); return; }
      const r = await fetch("/api/ai/suggest?action=forge-expand", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ opportunity_id: opportunity.id, tier, model }),
      });
      const body = await r.json().catch(() => ({}));
      if (body?.blocked) {
        setExpandErr(body.error || "Content Forge LLM is paused — re-enable in Monitor → API Budgets & Limits.");
        return;
      }
      if (!r.ok && r.status !== 202) { setExpandErr(body.error || `Expansion failed (${r.status}).`); }
      const hooks = body.hooks || body.hook_versions;
      if (Array.isArray(hooks) && hooks.length) applyHooks(hooks);
      if (body.fact_check_result) setFactCheck(body.fact_check_result);
      const { data: fresh } = await supabase
        .from("content_opportunities").select("hook_versions").eq("id", opportunity.id).maybeSingle();
      if (fresh?.hook_versions) applyHooks(fresh.hook_versions);
      // OUTCOME #2 trigger (A): now that hooks are back, generate the blueprint
      // variation sheet so it's ready for review BEFORE Send. Fire-and-forget —
      // runBlueprint carries its own status / timeout / Regenerate recovery.
      const gotHooks =
        (Array.isArray(hooks) && hooks.some((h) => h?.text)) ||
        (Array.isArray(fresh?.hook_versions) && fresh.hook_versions.some((h) => h?.text));
      if (gotHooks) runBlueprint();
    } catch (e) {
      setExpandErr(e.message || "Could not reach the hook generator.");
    } finally {
      setExpanding(false);
    }
  }, [opportunity.id, tier, model, applyHooks, runBlueprint]);

  const handleRegenerate = useCallback(() => {
    if (returnedVersions.size > 0 &&
      !window.confirm("Re-generate hooks? This spends tokens and replaces the current hooks.")) return;
    runExpand();
  }, [returnedVersions, runExpand]);

  // VO script generation
  const runScript = useCallback(async () => {
    if (isBlockedSync("content_forge")) {
      setGenerateErr("Content Forge is disabled — enable it in Monitor → Free LLM Gates.");
      return;
    }
    recordUsage("content_forge");
    setGenerating(true);
    setGenerateErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setGenerateErr("Not signed in."); return; }
      const r = await fetch("/api/ai/suggest?action=forge-script", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          opportunity_id: opportunity.id,
          template: scriptTemplate,
          grounding_mode: scriptGrounding,
          tone: scriptTone,
          tier,
          model,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (body?.blocked) {
        setGenerateErr(body.error || "Content Forge LLM is paused — re-enable in Monitor → API Budgets & Limits.");
        return;
      }
      if (!r.ok) { setGenerateErr(body.error || `Script generation failed (${r.status}).`); return; }
      if (body.script_json) setScriptJson(body.script_json);
      if (body.persisted === false) {
        setGenerateErr("Script generated but couldn't be saved (DB migration pending) — copy it now, it won't survive a reload.");
      }
    } catch (e) {
      setGenerateErr(e.message || "Could not reach the script generator.");
    } finally {
      setGenerating(false);
    }
  }, [opportunity.id, scriptTemplate, scriptGrounding, scriptTone, tier, model]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Link state to this opportunity's pipeline reel (if any). A live link = the
  // reel still exists and isn't archived; anything else means the card was
  // deleted/archived and this hook can be RE-SENT (mints a fresh reel).
  const linkedReel = opportunity.reel_id ? (reels || []).find(r => r.id === opportunity.reel_id) : null;
  const isLinkedLive = !!(linkedReel && !linkedReel.archived_at);
  const wasSent = !!opportunity.sent_to_pipeline_at;
  const canSend = selectedHook !== null && !sending;

  const handleSend = useCallback(async () => {
    if (selectedHook === null) return;
    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const styleKey = HOOK_STYLES.find((s) => s.version === selectedHook)?.key || "curiosity";
      const brief = {
        opportunity_id: opportunity.id,
        selected_hook_version: selectedHook,
        hook_text: hookText[selectedHook] || "",
        hook_style: styleKey,
        forged_by: user?.id ?? null,
        forged_at: new Date().toISOString(),
      };

      // Mint the new REEL-NNN id up-front (Team A owns id-minting per the store
      // helper contract) so we can key the footage rows + detail.footageDrive on
      // it and drive our own content_opportunities.update off it — independent of
      // the helper's return value. This creates a BRAND-NEW pipeline card in the
      // chosen editor's Not-Started box (it no longer patches an existing reel).
      const newId = nextReelId(storeReels);
      const who = targetOwner || "paul";

      // OUTCOME #1 — carry the forged VO/script onto the reel. It otherwise lives
      // ONLY on content_opportunities.script_json and never reaches the card.
      // Prefer the locally-edited scriptJson (freshest, includes textarea edits),
      // fall back to the persisted row value.
      const scriptText =
        (scriptJson && typeof scriptJson.text === "string" && scriptJson.text) ||
        (opportunity.script_json && opportunity.script_json.text) || "";

      // OUTCOME #4 — build one attached_footage_items row per DEDUPED source clip
      // + the detail.footageDrive map keyed by footage_file_id. Guard the NOT-NULL
      // filename/source_path columns with a footage_file_id (then clip id) fallback
      // for pre-0108 clips that carry nulls. Dedup by footage_file_id within the
      // batch (null footage_file_id is NEVER collapsed); the store helper further
      // dedups by (reel_id, footage_file_id) so a Re-send never duplicates rows.
      const clips = Array.isArray(sourceClips) ? sourceClips : [];
      const footageItems = [];
      const footageDrive = {};
      const seenFf = new Set();
      for (const c of clips) {
        const ff = c.footage_file_id || null;
        const dedupeKey = ff || `__nofile__${c.id}`;
        if (seenFf.has(dedupeKey)) continue;
        seenFf.add(dedupeKey);
        const fallback = ff || c.id;
        footageItems.push({
          id: `footage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          reel_id: newId,
          footage_file_id: ff,
          filename: c.filename || fallback,
          source_path: c.source_path || fallback,
          drive_url: c.drive_url || null,
          drive_folder_url: c.drive_folder_url || null,
        });
        if (ff && (c.drive_url || c.drive_folder_url)) {
          footageDrive[ff] = {
            drive_url: c.drive_url || null,
            drive_folder_url: c.drive_folder_url || null,
          };
        }
      }

      // Full reel object (mirrors mintPipelineReel's shape so the card renders in
      // the editor's Not-Started lane) plus the Content-Forge extras. script/vo/
      // logline + blueprint_json are CONDITIONAL — a hook-only send omits them.
      const reel = {
        id: newId,
        displayNumber: parseInt(newId.slice(5), 10),
        title: opportunity.title || "Untitled",
        stage: "not_started",
        owner: who,
        lane: who,
        state: "ok",
        age: "just now",
        due: null,
        stageEnteredAt: new Date().toISOString(),
        grouping: "not_started",
        creative_brief: brief,
        detail: {
          fromOpportunity: opportunity.id,
          ...(Object.keys(footageDrive).length ? { footageDrive } : {}),
        },
      };
      // OUTCOME #2 — the blueprint variation sheet rides the Send. Prefer the freshly
      // generated blueprint (state), fall back to the row's persisted blueprint_json.
      // The human-readable sheet (vo_markdown) OVERWRITES the wave-1 script write into
      // reels.vo (the blueprint is the fuller deliverable); script/logline keep the
      // plain VO script. blueprint_json is persisted OPAQUE (Contract 3) and rides the
      // store helper's column-error strip+retry until Migration 0113 is applied.
      const bp = blueprintJson || opportunity.blueprint_json || null;
      const bpVo = typeof blueprintVo === "string" && blueprintVo.trim() ? blueprintVo : "";
      if (scriptText) {
        reel.script = scriptText;
        reel.logline = scriptText;
      }
      const voOut = bpVo || scriptText || "";
      if (voOut) reel.vo = voOut;
      if (bp) reel.blueprint_json = bp;

      // ONE call to the frozen store helper (create-or-patch by reel.id, FK-safe
      // reel-before-footage, dedup by (reel_id, footage_file_id)). Best-effort —
      // the optimistic dispatch lands the card + footage even if the persist
      // throws, and content_opportunities.update below still records the link.
      // The helper RESOLVES to the id that actually landed — which differs from
      // our up-front newId if the client-minted id collided and was re-minted, so
      // we must key content_opportunities.reel_id off the RESOLVED id, not newId.
      let finalId = newId;
      try {
        finalId = (await actions.createReelWithFootage(reel, footageItems)) || newId;
      } catch (e) {
        console.error("createReelWithFootage failed:", e);
      }

      // Our own direct content_opportunities.update — the helper never touches
      // content_opportunities (per contract).
      await supabase.from("content_opportunities").update({
        selected_hook_version: selectedHook,
        reel_id: finalId,
        status: "sent",
        sent_to_pipeline_at: new Date().toISOString(),
      }).eq("id", opportunity.id);
      const ownerName = editors.find(e => e.id === who)?.name || who;
      showToast(`Created ${finalId} in ${ownerName}'s Not Started.`);
      onSent?.();
      onClose();
    } catch (e) {
      showToast(`Send failed: ${e.message || "unknown error"}`);
    } finally {
      setSending(false);
    }
  }, [selectedHook, targetOwner, hookText, opportunity.id, opportunity.title, opportunity.script_json, opportunity.blueprint_json, scriptJson, blueprintJson, blueprintVo, sourceClips, storeReels, actions, editors, onClose, onSent, showToast]);

  const wc = scriptJson?.text ? wordCount(scriptJson.text) : 0;
  const showTabs = isVetted || hasRun || !!scriptJson;

  return createPortal(
    <div className="cf-modal-overlay" onMouseDown={onClose}>
      <div className="cf-modal" onMouseDown={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="cf-modal-head">
          <span className={`cf-tier-badge t-${String(opportunity.virality_tier || "C").toUpperCase()}`}>
            {String(opportunity.virality_tier || "C").toUpperCase()}
          </span>
          <h3>{opportunity.title || "Untitled opportunity"}</h3>
          <button className="cf-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {opportunity.angle_summary && (
          <p className="cf-modal-angle">{opportunity.angle_summary}</p>
        )}
        {Array.isArray(opportunity.entities_mentioned) && opportunity.entities_mentioned.length > 0 && (
          <div className="cf-modal-entities">
            {opportunity.entities_mentioned.map((e, i) => (
              <span key={e + i} className="cf-entity-tag" title="Named in the footage — used to ground hooks/scripts in real facts">
                🔎 {e}
              </span>
            ))}
          </div>
        )}

        {/* ── Tab nav ── */}
        {showTabs && (
          <div className="cf-modal-tabs">
            <button
              className={"cf-tab-btn" + (activeTab === "hooks" ? " active" : "")}
              onClick={() => setActiveTab("hooks")}
            >Hooks</button>
            <button
              className={"cf-tab-btn" + (activeTab === "script" ? " active" : "")}
              onClick={() => setActiveTab("script")}
            >Script{scriptJson ? " ✦" : ""}</button>
          </div>
        )}

        {/* ── HOOKS TAB ── */}
        {(activeTab === "hooks" || !showTabs) && (
          <>
            {!hasRun && returnedVersions.size === 0 ? (
              <div className="cf-expound-cta">
                <p className="cf-expound-blurb">
                  {isVetted
                    ? "Expound this vetted opportunity into 3 hook angles (Curiosity · Controversy · Personal Stakes). This spends an LLM call."
                    : "Shortlist this opportunity first — only vetted opportunities can be expounded into hooks."}
                </p>
                <button
                  type="button"
                  className="cf-btn primary cf-expound-btn"
                  onClick={runExpand}
                  disabled={!isVetted || expanding}
                  title={isVetted ? "Generate 3 hook versions" : "Shortlist this opportunity to enable expounding"}
                >
                  {expanding ? "Generating…" : "✦ Expound into 3 hooks"}
                </button>
                {expandErr && <div className="cf-col-skeleton err">{expandErr}</div>}
              </div>
            ) : (
              <div className="cf-cols">
                {HOOK_STYLES.map((s) => {
                  const has = returnedVersions.has(s.version);
                  const isSel = selectedHook === s.version;
                  return (
                    <div key={s.version} className={"cf-col" + (isSel ? " selected" : "")}>
                      <span className="cf-col-title">{s.label}</span>
                      {has ? (
                        <>
                          <textarea
                            className="cf-col-ta"
                            value={hookText[s.version] ?? ""}
                            onChange={(e) => setHookText((prev) => ({ ...prev, [s.version]: e.target.value }))}
                            placeholder={`${s.label} hook…`}
                          />
                          <button
                            type="button"
                            className={"cf-btn" + (isSel ? " primary" : "")}
                            onClick={() => setSelectedHook(isSel ? null : s.version)}
                          >
                            {isSel ? "✓ Selected" : "Select"}
                          </button>
                        </>
                      ) : expanding ? (
                        <div className="cf-col-skeleton">Generating…</div>
                      ) : (
                        <div className="cf-col-skeleton err">
                          {expandErr || "No hook returned. Edit manually or re-run Discover."}
                          <textarea
                            className="cf-col-ta"
                            style={{ marginTop: 8 }}
                            value={hookText[s.version] ?? ""}
                            onChange={(e) => {
                              setHookText((prev) => ({ ...prev, [s.version]: e.target.value }));
                              setReturnedVersions((prev) => new Set([...prev, s.version]));
                            }}
                            placeholder="Write a hook…"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {factCheck && !factCheck.skipped && (
              <details className="cf-facts-used">
                <summary>
                  🔎 {factCheck.sources?.length || 0} fact{factCheck.sources?.length === 1 ? "" : "s"} pulled in
                </summary>
                {Array.isArray(factCheck.sources) && factCheck.sources.length > 0 ? (
                  <ul className="cf-facts-list">
                    {factCheck.sources.map((s, i) => (
                      <li key={(s.url || s.title || "") + i}>
                        {s.url ? (
                          <a className="cf-fact-link" href={s.url} target="_blank" rel="noopener noreferrer">
                            ↗ {s.title || s.url}
                          </a>
                        ) : (
                          <span className="cf-clip-name">{s.title}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="cf-facts-none">No usable sources came back for this search.</p>
                )}
              </details>
            )}

            {/* ── OUTCOME #2 — Blueprint variation sheet review (BEFORE Send) ── */}
            {blueprintStatus !== "idle" && (
              <div className="cf-blueprint-review cf-script-output" style={{ marginTop: "0.75rem" }}>
                <div
                  className="cf-blueprint-head"
                  style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
                >
                  <span className="cf-script-label">
                    📋 Blueprint variation sheet
                    {blueprintStatus === "ready" ? " ✦" : ""}
                  </span>
                  <span className="cf-foot-spacer" style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="cf-btn"
                    onClick={runBlueprint}
                    disabled={blueprintStatus === "generating"}
                    title="Re-generate the blueprint variation sheet (spends tokens)"
                  >
                    {blueprintStatus === "generating" ? "Generating…" : "↻ Regenerate"}
                  </button>
                </div>

                {blueprintStatus === "generating" && (
                  <div className="cf-col-skeleton">
                    Generating blueprint variation sheet — 3 named angles, fact sheet, hook bank…
                  </div>
                )}
                {blueprintStatus === "error" && (
                  <div className="cf-col-skeleton err">
                    {blueprintErr || "Blueprint generation failed."}
                  </div>
                )}
                {blueprintStatus === "ready" && (
                  <>
                    {blueprintVo ? (
                      <textarea
                        className="cf-script-ta"
                        value={blueprintVo}
                        onChange={(e) => setBlueprintVo(e.target.value)}
                        aria-label="Blueprint variation sheet (editable before Send)"
                      />
                    ) : (
                      <div className="cf-col-skeleton">
                        Blueprint ready
                        {Array.isArray(blueprintJson?.variations)
                          ? ` — ${blueprintJson.variations.length} variation${blueprintJson.variations.length === 1 ? "" : "s"}`
                          : ""}
                        . It will be attached to the reel on Send.
                      </div>
                    )}
                    {!blueprintPersisted && (
                      <div className="cf-word-count" style={{ opacity: 0.8 }}>
                        Not saved server-side yet (DB migration pending) — it still rides this Send.
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* ── SCRIPT TAB ── */}
        {activeTab === "script" && showTabs && (
          <div className="cf-script-tab">
            {/* Template picker */}
            <div className="cf-script-section">
              <span className="cf-script-label">Narrative template</span>
              <div className="cf-template-grid">
                {SCRIPT_TEMPLATES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={"cf-template-card" + (scriptTemplate === t.key ? " selected" : "")}
                    onClick={() => setScriptTemplate(t.key)}
                  >
                    <span className="cf-tpl-name">{t.label}</span>
                    <span className="cf-tpl-desc">{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Grounding + Tone */}
            <div className="cf-script-controls">
              <span className="cf-script-control-group">
                <span className="cf-script-label">Grounding</span>
                <span className="cf-tier" role="group">
                  {GROUNDING_MODES.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      className={scriptGrounding === m.key ? "on" : ""}
                      title={m.title}
                      onClick={() => setScriptGrounding(m.key)}
                    >{m.label}</button>
                  ))}
                </span>
              </span>
              <span className="cf-script-control-group">
                <span className="cf-script-label">Tone</span>
                <span className="cf-tier" role="group">
                  {TONES_LIST.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className={scriptTone === t.key ? "on" : ""}
                      onClick={() => setScriptTone(t.key)}
                    >{t.label}</button>
                  ))}
                </span>
              </span>
            </div>

            {/* Generate button */}
            {!isVetted && !scriptJson && (
              <p className="cf-expound-blurb" style={{ textAlign: "left", marginTop: "0.5rem" }}>
                Shortlist this opportunity first to enable script generation.
              </p>
            )}
            <button
              type="button"
              className="cf-btn primary cf-expound-btn"
              style={{ alignSelf: "flex-start" }}
              onClick={() => {
                if (scriptJson && !window.confirm("Re-generate script? This spends tokens.")) return;
                runScript();
              }}
              disabled={(!isVetted && !scriptJson) || generating}
            >
              {generating ? "Generating…" : scriptJson ? "↻ Re-generate Script" : "✦ Generate VO Script"}
            </button>
            {generateErr && <div className="cf-col-skeleton err" style={{ marginTop: "0.5rem" }}>{generateErr}</div>}

            {/* Script output */}
            {scriptJson?.text && (
              <div className="cf-script-output">
                <textarea
                  className="cf-script-ta"
                  value={scriptJson.text}
                  onChange={(e) => setScriptJson((prev) => ({ ...prev, text: e.target.value }))}
                />
                <div className="cf-word-count">
                  {wc} word{wc !== 1 ? "s" : ""} · ~{Math.round(wc / 3)}s read
                  {scriptJson.template && <span className="cf-script-meta"> · {scriptJson.template}</span>}
                  {scriptJson.grounding_mode && <span className="cf-script-meta"> · {scriptJson.grounding_mode}</span>}
                </div>
                {Array.isArray(scriptJson.citations) && scriptJson.citations.length > 0 && (
                  <details className="cf-citations-details">
                    <summary className="cf-script-label">
                      {scriptJson.citations.length} clip citation{scriptJson.citations.length !== 1 ? "s" : ""}
                    </summary>
                    <ul className="cf-citations-list">
                      {scriptJson.citations.map((c, i) => (
                        <li key={i}>
                          <span className="cf-citation-beat">{c.beat}</span>
                          {c.quote && <span className="cf-citation-quote">"{c.quote}"</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {Array.isArray(scriptJson.grounding_sources) && scriptJson.grounding_sources.length > 0 && (
                  <details className="cf-facts-used">
                    <summary>
                      🔎 {scriptJson.grounding_sources.length} fact{scriptJson.grounding_sources.length === 1 ? "" : "s"} pulled in
                    </summary>
                    <ul className="cf-facts-list">
                      {scriptJson.grounding_sources.map((s, i) => (
                        <li key={(s.url || s.title || "") + i}>
                          {s.url ? (
                            <a className="cf-fact-link" href={s.url} target="_blank" rel="noopener noreferrer">
                              ↗ {s.title || s.url}
                            </a>
                          ) : (
                            <span className="cf-clip-name">{s.title}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Source clips attribution ── */}
        {Array.isArray(sourceClips) && sourceClips.length > 0 && (
          <details className="cf-source-clips">
            <summary>
              ↗ {sourceClips.length} source clip{sourceClips.length !== 1 ? "s" : ""}
            </summary>
            <ul className="cf-clip-list">
              {sourceClips.map((c) => (
                <li key={c.id}>
                  {(c.drive_url || c.drive_folder_url) ? (
                    <a
                      className="cf-clip-link"
                      href={c.drive_url || c.drive_folder_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={c.drive_url ? "Open this clip on Google Drive" : "Open this clip's Drive folder"}
                    >
                      ↗ {c.filename}
                    </a>
                  ) : (
                    <span className="cf-clip-name">{c.filename}</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* ── Footer (hooks tab only) ── */}
        {(activeTab === "hooks" || !showTabs) && (
          <div className="cf-modal-foot">
            {(hasRun || returnedVersions.size > 0) && (
              <button
                type="button"
                className="cf-btn"
                onClick={handleRegenerate}
                disabled={expanding}
                title="Re-run hook generation (spends tokens)"
              >
                {expanding ? "Generating…" : "↻ Regenerate"}
              </button>
            )}
            <span className="cf-foot-spacer" />
            {isLinkedLive ? (
              <span className="cf-sent-badge" title={"Already in the pipeline as " + opportunity.reel_id}>
                ✓ In pipeline · {opportunity.reel_id}
              </span>
            ) : wasSent ? (
              <span className="cf-resent-badge" title="The pipeline card was deleted or archived — re-send to create a fresh reel.">
                ↺ Card removed — re-send
              </span>
            ) : null}
            <label htmlFor="cf-reel-owner">Editor</label>
            <select
              id="cf-reel-owner"
              className="cf-select"
              value={targetOwner}
              onChange={(e) => setTargetOwner(e.target.value)}
            >
              {editors.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="cf-btn primary"
              disabled={!canSend}
              onClick={handleSend}
              title={
                selectedHook === null ? "Select a hook first"
                  : `Create a new reel in ${editors.find(e => e.id === targetOwner)?.name || targetOwner}'s Not Started`
              }
            >
              {sending ? "Creating…"
                : isLinkedLive ? "Send again →"
                : wasSent ? "Re-send →"
                : "Create reel in Not Started →"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/* =========================================================================
   Content Forge page.
   ========================================================================= */
export function ContentForge() {
  const isOwner = useIsOwner();
  const { canView } = usePermissions();
  // Access = owner OR a teammate the owner granted the scoped "content-forge"
  // permission. Gates data-wiring + the page body; the paid backend actions are
  // themselves only Bearer-JWT-gated (no verifyOwner), so a granted teammate can
  // fully use the tool. Cost governance stays owner-only via the Monitor budget
  // kill-switch (a separate surface a non-owner can't reach).
  const cfAccess = isOwner || canView("content-forge");

  const [opps, setOpps] = useState([]);
  const [reels, setReels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false); // paging past the first 1000
  const [error, setError] = useState(null);

  const [tier, setTier] = useState("free"); // "free" | "pro"
  const [tierSel, setTierSel] = useState(() => new Set()); // empty = all tiers
  const [country, setCountry] = useState("all");
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [vetView, setVetView] = useState("new"); // triage queue front-and-center
  const [favOnly, setFavOnly] = useState(false);            // ★ filter — favorites only
  const [colorSel, setColorSel] = useState(() => new Set()); // empty = all colors
  const [q, setQ] = useState("");                           // free-text title/hook search
  const [showAnalytics, setShowAnalytics] = useState(false); // Opportunities ↔ Analytics view (client-side, no fetch)
  const [showArchived, setShowArchived] = useState(false);   // archived-only drawer (ingested titles are never deleted)

  // Library coverage tracker — per-folder discovery progress + yield (titles/hooks).
  // Loaded on demand (paginates transcript_clips, 13k+ rows) so the main list isn't slowed.
  const [showCoverage, setShowCoverage] = useState(false);
  const [coverage, setCoverage] = useState(null);   // [{folder, clips, discovered, pct, files, opps, hooks}]
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [remining, setRemining] = useState("");     // folder currently being re-mined ("" = none)

  const [discovering, setDiscovering] = useState(false);
  const [openOpp, setOpenOpp] = useState(null);
  const [toast, setToast] = useState(null);
  const [colorPickFor, setColorPickFor] = useState(null); // opp id whose color popover is open

  // Country "folders" view — group the (filtered/sorted) opportunities into
  // collapsible per-country buckets. Off = the flat table. `collapsed` holds the
  // country names that are folded shut.
  const [grouped, setGrouped] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggleCountry = useCallback((c) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  }, []);

  // Ingest + discovery-target + live discovery progress.
  const [clipCount, setClipCount] = useState(null);   // transcript_clips count (null = unknown)
  const [ingesting, setIngesting] = useState(false);
  const [discoverTarget, setDiscoverTarget] = useState("global"); // a DISCOVERY_TARGETS value or free text
  const [targetIsCustom, setTargetIsCustom] = useState(false);
  const [progress, setProgress] = useState(null);      // live discovery status line
  const [maxOpps, setMaxOpps] = useState(0);           // 0 = auto (backend default 8-20); else cap per pass
  const [model, setModel] = useState("google/gemini-2.5-flash"); // model toggle (compare 2.5 vs cheaper 2.0)
  // Footage-folder scope (e.g. "Japan") + how many INPUT clips per Discover pass.
  // folder "" = all footage (legacy behavior). folderOptions are derived from the
  // disk paths on attached_footage_items (footageFolderLabel) so labels match what
  // the backend stamps on transcript_clips.folder.
  const [folder, setFolder] = useState("");
  const [clipsPerPass, setClipsPerPass] = useState(20);
  const [folderOptions, setFolderOptions] = useState([]);
  // Whole-library mining: the FootageBrain /api/files catalog has ~8k transcribed files
  // (vs the ~12 reel-attached ones). libFolders = [{folder, files, with_drive}] per region;
  // libFolder "" = mine the whole library. Mining is a $0 transcript copy (no LLM).
  const [libFolders, setLibFolders] = useState([]);
  const [libFolder, setLibFolder] = useState("");
  const [mining, setMining] = useState(false);

  // Entity backfill — a one-off pass that fills entities_mentioned on OLD opportunities
  // (discovered before the entity feature) WITHOUT re-discovering or touching hooks/scripts.
  // backfill = the live progress record {running, processed, patched, total} or null.
  const [backfill, setBackfill] = useState(null);
  const [backfilling, setBackfilling] = useState(false);

  // Backend kill-switch / daily-limit state (the authoritative verdict computed
  // server-side, mirrored from the Monitor budgets card). Drives the page banner
  // so Discover/Expound aren't silently no-ops when the LLM is paused. null =
  // unknown (banner hidden). { enabled, daily_limit_usd, daily_call_limit, blocked }.
  const [cfBudget, setCfBudget] = useState(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Read the Content Forge kill-switch / daily-limit state from the same proxy the
  // Monitor budgets card uses (the backend computes `blocked` authoritatively).
  // Best-effort — leaves cfBudget null (banner hidden) on any failure. Declared here,
  // above remineFolder/handleDiscover, whose dep arrays reference it (a later
  // declaration would TDZ-crash the whole page on mount).
  const loadBudgetState = useCallback(async () => {
    try {
      const r = await fetch("/api/monitor/status?action=forge-usage");
      if (!r.ok) return;
      const d = await r.json();
      if (d && d.ok && d.budget) setCfBudget(d.budget);
    } catch {
      /* non-fatal — the banner just stays hidden */
    }
  }, []);

  const loadOpps = useCallback(async () => {
    setError(null);
    // Page through ALL rows — PostgREST caps a single unpaginated read at ~1000, so
    // without this loop the newest 1000 opportunities would hide every older one
    // (and the client-side ★/color/search filters, which run over loaded rows only,
    // could never surface a tagged clip beyond that window). Accumulate newest-first
    // until a short page signals the end.
    const PAGE = 1000;
    try {
      const all = [];
      for (let off = 0; ; off += PAGE) {
        const { data, error: err } = await supabase
          .from("content_opportunities")
          .select("*")
          .order("created_at", { ascending: false })
          .range(off, off + PAGE - 1);
        if (err) throw err;
        const rows = data || [];
        all.push(...rows);
        setLoadingMore(off > 0 && rows.length === PAGE); // a 2nd+ full page is still coming
        if (rows.length < PAGE) break;
      }
      setOpps(all);
    } catch (e) {
      setError(e.message || "Failed to load opportunities.");
    } finally {
      setLoadingMore(false);
      setLoading(false);
    }
  }, []);

  // Library coverage — paginate transcript_clips and aggregate per folder: total clips,
  // discovered clips (last_discovered_at set = mined at least once), distinct source files,
  // and — by mapping each opportunity's source_clip_ids back to its clip's folder — how many
  // titles + hooks that folder yielded. On demand (13k+ rows). Best-effort; a read blip just
  // toasts and leaves the last snapshot. Depends on `opps` (the full set, loaded by loadOpps).
  const loadCoverage = useCallback(async () => {
    setCoverageLoading(true);
    try {
      const PAGE = 1000;
      const stats = new Map();          // folder -> {folder, clips, discovered, files:Set, opps, hooks}
      const clipFolder = new Map();     // clip id -> folder (for opportunity attribution)
      for (let off = 0; ; off += PAGE) {
        const { data, error: err } = await supabase
          .from("transcript_clips")
          .select("id, folder, last_discovered_at, footage_file_id")
          .range(off, off + PAGE - 1);
        if (err) throw err;
        const rows = data || [];
        for (const c of rows) {
          const f = c.folder || "(unlabeled)";
          let s = stats.get(f);
          if (!s) { s = { folder: f, clips: 0, discovered: 0, files: new Set(), opps: 0, hooks: 0 }; stats.set(f, s); }
          s.clips += 1;
          if (c.last_discovered_at) s.discovered += 1;
          if (c.footage_file_id) s.files.add(c.footage_file_id);
          clipFolder.set(c.id, f);
        }
        if (rows.length < PAGE) break;
      }
      // Attribute each opportunity (+ its hooks) to the dominant folder among its source clips.
      for (const o of opps) {
        const ids = Array.isArray(o.source_clip_ids) ? o.source_clip_ids : [];
        const tally = {};
        for (const id of ids) { const f = clipFolder.get(id); if (f) tally[f] = (tally[f] || 0) + 1; }
        let best = null, bestN = 0;
        for (const [f, n] of Object.entries(tally)) if (n > bestN) { best = f; bestN = n; }
        if (best && stats.has(best)) {
          const s = stats.get(best);
          s.opps += 1;
          s.hooks += Array.isArray(o.hook_versions) ? o.hook_versions.filter((h) => h?.text).length : 0;
        }
      }
      const out = Array.from(stats.values())
        .map((s) => ({ ...s, files: s.files.size, pct: s.clips ? Math.round((s.discovered / s.clips) * 100) : 0 }))
        .sort((a, b) => b.clips - a.clips);
      setCoverage(out);
    } catch (e) {
      showToast(`Coverage failed: ${e.message || "read error"}`);
    } finally {
      setCoverageLoading(false);
    }
  }, [opps, showToast]);

  const toggleCoverage = useCallback(() => {
    setShowCoverage((v) => {
      const next = !v;
      if (next && !coverage) loadCoverage(); // lazy first load
      return next;
    });
  }, [coverage, loadCoverage]);

  // Re-mine ONE folder for additional angles. The live backend only re-reads UN-mined
  // clips, so a fully-mined folder is first re-OPENED server-side (forge-reset-folder
  // clears last_discovered_at via the service role); then a NORMAL folder discover walks
  // the next `clipsPerPass` clips (advancing each click, exactly like first-time mining).
  // A partially re-mined folder skips the reset and just advances. Uses the current
  // Model / Max settings; gated by the same kill-switch / daily-limit as Discover.
  const remineFolder = useCallback(async (row) => {
    const f = row.folder;
    if (isBlockedSync("content_forge")) {
      showToast("Content Forge is disabled — enable it in Monitor → Free LLM Gates.");
      return;
    }
    if (cfBudget && (cfBudget.enabled === false || cfBudget.blocked)) {
      showToast(cfBudget.enabled === false
        ? "Content Forge LLM is OFF (kill switch) — re-enable it in Monitor → API Budgets & Limits."
        : "Daily limit reached — raise it in Monitor → API Budgets & Limits.");
      return;
    }
    const fullyMined = row.discovered >= row.clips;
    const remaining = Math.max(0, row.clips - row.discovered);
    if (!window.confirm(
      fullyMined
        ? `Re-mine "${f}"?\n\nRe-opens the folder (${row.clips} clips) and mines the next ${clipsPerPass} for fresh angles. Click Re-mine again to keep advancing. Spends tokens.`
        : `Continue re-mining "${f}"?\n\n${remaining} clip${remaining === 1 ? "" : "s"} still un-mined — this processes the next ${clipsPerPass}. Spends tokens.`
    )) return;
    recordUsage("content_forge");
    setRemining(f);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast("Not signed in — re-mine skipped."); return; }
      const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
      // Fully mined → re-open the folder so normal discovery has un-mined clips to read.
      if (fullyMined) {
        showToast(`Re-opening "${f}"…`);
        const rr = await fetch("/api/ai/suggest?action=forge-reset-folder", {
          method: "POST", headers: authHeaders, body: JSON.stringify({ folder: f }),
        });
        if (!rr.ok) {
          const e = await rr.json().catch(() => ({}));
          showToast(`Re-open failed (${rr.status}): ${e.error || "unknown error"}`);
          return;
        }
      }
      showToast(`Mining "${f}"…`);
      const body = { tier, folder: f, clips_per_pass: clipsPerPass }; // normal only_new pass
      if (model) body.model = model;
      if (maxOpps > 0) body.max_opportunities = maxOpps;
      const r = await fetch("/api/ai/suggest?action=forge-discover", {
        method: "POST", headers: authHeaders, body: JSON.stringify(body),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok && r.status !== 202) {
        showToast(`Re-mine failed (${r.status}): ${out.error || "unknown error"}`);
        return;
      }
      showToast(`Re-mine of "${f}" started — new angles will land shortly.`);
      // The pass runs in the background on Hetzner; refresh once it's had a beat to write.
      setTimeout(() => { loadOpps(); loadCoverage(); loadBudgetState(); }, 12000);
    } catch (e) {
      showToast(`Re-mine error: ${e.message}`);
    } finally {
      setRemining("");
    }
  }, [tier, clipsPerPass, model, maxOpps, cfBudget, loadOpps, loadCoverage, loadBudgetState, showToast]);

  // Vet an opportunity (Shortlist / Reject / clear back to New). Optimistic with
  // rollback. Vetting is free (no LLM) — it just sets the gate for elevation.
  const setVet = useCallback(async (id, next) => {
    setOpps((prev) => prev.map((o) => (o.id === id ? { ...o, vet_state: next } : o)));
    const { error: err } = await supabase
      .from("content_opportunities")
      .update({ vet_state: next, vetted_at: new Date().toISOString() })
      .eq("id", id);
    if (err) {
      showToast(`Vet failed: ${err.message}`);
      loadOpps(); // rollback to truth
    }
  }, [showToast, loadOpps]);

  // Toggle the ★ favorite on a row. Optimistic with rollback (mirrors setVet).
  const toggleFavorite = useCallback(async (o) => {
    const next = !o.favorite;
    setOpps((prev) => prev.map((x) => (x.id === o.id ? { ...x, favorite: next } : x)));
    const { error: err } = await supabase
      .from("content_opportunities")
      .update({ favorite: next })
      .eq("id", o.id);
    if (err) { showToast(`Favorite failed: ${err.message}`); loadOpps(); }
  }, [showToast, loadOpps]);

  // Set (or clear) a row's color tag. Passing the same color clears it.
  const setColor = useCallback(async (o, colorKey) => {
    const next = o.color === colorKey ? null : colorKey;
    setOpps((prev) => prev.map((x) => (x.id === o.id ? { ...x, color: next } : x)));
    const { error: err } = await supabase
      .from("content_opportunities")
      .update({ color: next })
      .eq("id", o.id);
    if (err) { showToast(`Color failed: ${err.message}`); loadOpps(); }
  }, [showToast, loadOpps]);

  // Archive / restore an opportunity. Archiving NEVER deletes the ingested
  // title/hook — it just tucks the row into the "Show archived" drawer so the
  // list stays tidy and the hook can always be recovered + re-sent. Optimistic
  // with rollback (mirrors setVet).
  const setArchived = useCallback(async (o, archived) => {
    const stamp = archived ? new Date().toISOString() : null;
    setOpps((prev) => prev.map((x) => (x.id === o.id ? { ...x, archived_at: stamp } : x)));
    const { error: err } = await supabase
      .from("content_opportunities")
      .update({ archived_at: stamp })
      .eq("id", o.id);
    if (err) { showToast(`${archived ? "Archive" : "Restore"} failed: ${err.message}`); loadOpps(); }
    else showToast(archived ? "Archived — find it under “Show archived”." : "Restored.");
  }, [showToast, loadOpps]);

  const loadReels = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("reels")
        .select("id, title, archived_at")
        .order("created_at", { ascending: false })
        .limit(500);
      setReels(data || []);
    } catch {
      /* non-fatal — the target-reel picker just stays empty */
    }
  }, []);

  // Count ingested transcript_clips — the precondition for discovery. The owner
  // can read this table directly under RLS (auth_read_transcript_clips). A head
  // count avoids pulling rows; null stays "unknown" so the UI never claims 0 by
  // mistake on a transient error.
  const loadClipCount = useCallback(async () => {
    try {
      const { count, error: err } = await supabase
        .from("transcript_clips")
        .select("id", { count: "exact", head: true });
      if (err) throw err;
      setClipCount(typeof count === "number" ? count : 0);
    } catch {
      /* leave clipCount as-is (unknown) — don't block Discover on a read blip */
    }
  }, []);

  // Derive the footage-folder list from attached_footage_items.source_path using the
  // SAME footageFolderLabel() the backend mirrors — so a picked label matches the value
  // stamped on transcript_clips.folder. Best-effort; the picker just stays "All footage".
  const loadFolders = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("attached_footage_items")
        .select("source_path")
        .limit(5000);
      const set = new Set();
      for (const r of data || []) {
        const lbl = footageFolderLabel(r.source_path);
        if (lbl) set.add(lbl);
      }
      setFolderOptions(Array.from(set).sort((a, b) => a.localeCompare(b)));
    } catch {
      /* non-fatal — folder picker stays "All footage" */
    }
  }, []);

  // Pull the whole-library folder catalog (transcribed-file count per region) so the
  // "Mine Library" picker can offer Philippines (1075), India (801), … Best-effort;
  // the picker degrades to "Whole library" only on any failure.
  const loadLibraryFolders = useCallback(async () => {
    try {
      const r = await fetch("/api/monitor/status?action=forge-library-folders");
      if (!r.ok) return;
      const d = await r.json();
      if (d && d.ok && Array.isArray(d.folders)) setLibFolders(d.folders);
    } catch {
      /* non-fatal — Mine Library picker stays "Whole library" only */
    }
  }, []);

  // Access-gated: skip all data wiring entirely for anyone without Content Forge.
  useEffect(() => {
    if (!cfAccess) return;
    loadOpps();
    loadReels();
    loadClipCount();
    loadBudgetState();
    loadFolders();
    loadLibraryFolders();
  }, [cfAccess, loadOpps, loadReels, loadClipCount, loadBudgetState, loadFolders, loadLibraryFolders]);

  // Debounced reload — now that loadOpps pages the whole table, a live discovery
  // run (dozens of realtime inserts) or rapid focus flaps would each fire a full
  // multi-page fetch. Collapse bursts into one trailing reload (~800ms).
  const reloadTimer = useRef(null);
  const debouncedLoadOpps = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => { reloadTimer.current = null; loadOpps(); }, 800);
  }, [loadOpps]);
  useEffect(() => () => { if (reloadTimer.current) clearTimeout(reloadTimer.current); }, []);

  // Realtime — live discovery updates on content_opportunities (preferred over
  // pure polling). Falls back gracefully: if the channel never connects, the
  // tab-focus poll below still refreshes the list.
  useEffect(() => {
    if (!cfAccess) return;
    const ch = supabase
      .channel("content-forge-opps")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "content_opportunities" },
        () => debouncedLoadOpps()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [cfAccess, debouncedLoadOpps]);

  // Refresh on tab focus / visibility (catches rows written while away).
  useEffect(() => {
    if (!cfAccess) return;
    const onFocus = () => { if (document.visibilityState === "visible") debouncedLoadOpps(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [cfAccess, debouncedLoadOpps]);

  const countryOptions = useMemo(() => {
    const set = new Set();
    for (const o of opps) if (o.country) set.add(o.country);
    return Array.from(set).sort();
  }, [opps]);

  // Discover's Folder picker = attached-footage folders ∪ whole-library folders, so once a
  // library region is mined you can scope Discover to it (e.g. "Philippines"). Same label
  // space (_folder_label) as transcript_clips.folder, so &folder=eq.<label> matches.
  const allFolderOptions = useMemo(() => {
    const set = new Set(folderOptions);
    for (const f of libFolders) {
      if (f && f.folder && f.folder !== "(unknown)") set.add(f.folder);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [folderOptions, libFolders]);

  const toggleTierSel = useCallback((t) => {
    setTierSel((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }, []);

  const toggleColorSel = useCallback((c) => {
    setColorSel((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return opps.filter((o) => {
      // Archived rows live in their own drawer — ingested titles are never
      // deleted, only archived, so they stay recoverable via "Show archived".
      if (showArchived ? !o.archived_at : !!o.archived_at) return false;
      if (vetView !== "all" && vetOf(o) !== vetView) return false;
      if (tierSel.size > 0 && !tierSel.has(String(o.virality_tier || "C").toUpperCase())) return false;
      if (country !== "all" && o.country !== country) return false;
      if (favOnly && !o.favorite) return false;
      if (colorSel.size > 0 && !colorSel.has(o.color)) return false;
      if (needle) {
        // Match the visible row text (title + angle) plus any generated hook text.
        const hooks = Array.isArray(o.hook_versions)
          ? o.hook_versions.map((h) => h?.text || "").join(" ")
          : "";
        const hay = `${o.title || ""} ${o.angle_summary || ""} ${hooks}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [opps, showArchived, vetView, tierSel, country, favOnly, colorSel, q]);

  // Counts for the segmented control + header (cheap; over already-loaded rows).
  const vetCounts = useMemo(() => {
    const c = { new: 0, shortlisted: 0, rejected: 0, all: opps.length };
    for (const o of opps) c[vetOf(o)] = (c[vetOf(o)] || 0) + 1;
    return c;
  }, [opps]);
  const expandedCount = useMemo(() => opps.filter(isExpanded).length, [opps]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const { key, dir } = sort;
    const mul = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (key === "newest") {
        const av = a.created_at ? Date.parse(a.created_at) : 0;
        const bv = b.created_at ? Date.parse(b.created_at) : 0;
        return av === bv ? 0 : (av < bv ? -1 : 1) * mul;
      }
      // virality: tier first (S→C), then score desc within a tier.
      const ar = tierRank(a.virality_tier);
      const br = tierRank(b.virality_tier);
      if (ar !== br) return (ar < br ? -1 : 1) * mul;
      const as = scoreOf(a);
      const bs = scoreOf(b);
      if (as === bs) return 0;
      return (as < bs ? -1 : 1) * mul;
    });
    return rows;
  }, [filtered, sort]);

  // Country "folders": group the sorted rows into [country, rows[]] buckets, biggest
  // bucket first (ties alpha). Drives the grouped view; the flat table ignores it.
  const countryGroups = useMemo(() => {
    const map = new Map();
    for (const o of sorted) {
      const c = (o.country && String(o.country).trim()) || "Global";
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(o);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [sorted]);

  const onSort = useCallback((key) => {
    if (!key) return;
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" }
    );
  }, []);

  const arrow = (key) =>
    key && key === sort.key ? <span className="cf-arrow">{sort.dir === "asc" ? "▲" : "▼"}</span> : null;

  // One opportunity row — shared by the flat table and the per-country folder tables.
  const renderRow = useCallback((o) => {
    const t = String(o.virality_tier || "C").toUpperCase();
    const topics = Array.isArray(o.topics) ? o.topics : [];
    const vet = vetOf(o);
    return (
      <tr
        key={o.id}
        className={"cf-tr" + (vet === "rejected" ? " rejected" : "")}
        style={o.color ? { boxShadow: `inset 4px 0 0 ${COLOR_HEX[o.color] || "transparent"}` } : undefined}
        onClick={() => setOpenOpp(o)}
      >
        <td className="cf-c-tag" onClick={(e) => e.stopPropagation()}>
          <div className="cf-tag-cell">
            <button
              type="button"
              className={"cf-fav" + (o.favorite ? " on" : "")}
              onClick={() => toggleFavorite(o)}
              title={o.favorite ? "Unfavorite" : "Favorite"}
              aria-pressed={!!o.favorite}
            >
              {o.favorite ? "★" : "☆"}
            </button>
            <div className="cf-color-wrap">
              <button
                type="button"
                className="cf-color-swatch"
                style={{ "--swatch": o.color ? (COLOR_HEX[o.color] || "transparent") : "transparent" }}
                onClick={() => setColorPickFor((id) => (id === o.id ? null : o.id))}
                title={o.color ? `Color: ${o.color} — click to change` : "Set a color tag"}
              >
                {o.color ? "" : "○"}
              </button>
              {colorPickFor === o.id && (
                <div className="cf-color-pop" onClick={(e) => e.stopPropagation()}>
                  {ROW_COLORS.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      className={"cf-color-dot" + (o.color === c.key ? " on" : "")}
                      style={{ "--dot": c.hex }}
                      onClick={() => { setColor(o, c.key); setColorPickFor(null); }}
                      title={c.key}
                    />
                  ))}
                  <button
                    type="button"
                    className="cf-color-clear"
                    onClick={() => { setColor(o, o.color); setColorPickFor(null); }}
                    title="Clear color"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>
        </td>
        <td className="cf-c-tier">
          <span className={`cf-tier-badge t-${t}`}>{t}</span>
        </td>
        <td>
          <span className="cf-opp-title">{o.title || "(untitled)"}</span>
          {o.angle_summary && <span className="cf-opp-angle">{o.angle_summary}</span>}
        </td>
        <td>
          <div className="cf-topics">
            {topics.slice(0, 4).map((tp, i) => (
              <span key={tp + i} className="cf-topic-tag">{tp}</span>
            ))}
            {(Array.isArray(o.entities_mentioned) ? o.entities_mentioned : []).slice(0, 3).map((e, i) => (
              <span key={"e" + e + i} className="cf-entity-tag" title="Named in the footage">🔎 {e}</span>
            ))}
            {topics.length === 0 && (!o.entities_mentioned || o.entities_mentioned.length === 0) && "—"}
          </div>
        </td>
        <td>{o.country || "—"}</td>
        <td className="cf-num">{fmtScore(o)}</td>
        <td className="cf-num" title={o.created_at || ""}>{fmtDate(o.created_at)}</td>
        <td>
          <div className="cf-status-cell">
            <span className="cf-status">{o.status || "discovered"}</span>
            {isExpanded(o) && (
              <span className="cf-expanded-badge" title="Already expanded into hooks — don't re-spend.">
                ✦ {hookCount(o) > 0 ? `${hookCount(o)} hook${hookCount(o) === 1 ? "" : "s"}` : "expanded"}
              </span>
            )}
            {(() => {
              const live = o.reel_id && reels.some((r) => r.id === o.reel_id && !r.archived_at);
              if (live) return <span className="cf-sent-badge" title={"In pipeline as " + o.reel_id}>✓ {o.reel_id}</span>;
              if (o.sent_to_pipeline_at) return <span className="cf-resent-badge" title="The pipeline card was deleted/archived — open to re-send.">↺ removed</span>;
              return null;
            })()}
            <div className="cf-vet-btns" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={"cf-vet-btn shortlist" + (vet === "shortlisted" ? " on" : "")}
                onClick={() => setVet(o.id, vet === "shortlisted" ? "new" : "shortlisted")}
                title={vet === "shortlisted" ? "Shortlisted — click to clear" : "Shortlist (enables Expound)"}
              >
                ✓
              </button>
              <button
                type="button"
                className={"cf-vet-btn reject" + (vet === "rejected" ? " on" : "")}
                onClick={() => setVet(o.id, vet === "rejected" ? "new" : "rejected")}
                title={vet === "rejected" ? "Rejected — click to clear" : "Reject"}
              >
                ✕
              </button>
              {o.archived_at ? (
                <button
                  type="button"
                  className="cf-vet-btn"
                  onClick={() => setArchived(o, false)}
                  title="Restore from archive"
                >
                  ↩
                </button>
              ) : (
                <button
                  type="button"
                  className="cf-vet-btn"
                  onClick={() => setArchived(o, true)}
                  title="Archive (never deletes the title — recoverable under “Show archived”)"
                >
                  ⧉
                </button>
              )}
            </div>
          </div>
        </td>
      </tr>
    );
  }, [setVet, toggleFavorite, setColor, colorPickFor, reels, setArchived]);

  // Column header row — shared markup for the flat + folder tables.
  const headRow = (
    <tr>
      {COLUMNS.map((c, i) => (
        <th
          key={c.label + i}
          className={[c.key ? "sortable" : "", c.cls || ""].filter(Boolean).join(" ")}
          onClick={c.key ? () => onSort(c.key) : undefined}
        >
          {c.label}{arrow(c.key)}
        </th>
      ))}
    </tr>
  );

  // Pull the 12+ footage transcripts (attached_footage_items.full_transcript)
  // into transcript_clips. This is the missing first step — discovery reads
  // clips, so with 0 clips it silently produces nothing. Fire-and-forget on the
  // backend; we poll the clip count for a few seconds so the badge updates.
  const handleIngest = useCallback(async () => {
    setIngesting(true);
    setProgress("Ingesting footage transcripts…");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast("Not signed in — ingest skipped."); return; }
      const r = await fetch("/api/ai/suggest?action=forge-ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });
      if (!r.ok && r.status !== 202) {
        const b = await r.json().catch(() => ({}));
        showToast(`Ingest failed (${r.status}): ${b.error || "unknown error"}`);
        setProgress(null);
        return;
      }
      // Poll the clip count until it rises (the worker writes async).
      let last = clipCount || 0;
      for (let i = 0; i < FORGE_POLL_TRIES; i++) {
        await new Promise((res) => setTimeout(res, FORGE_POLL_MS));
        await loadClipCount();
        const { count } = await supabase
          .from("transcript_clips")
          .select("id", { count: "exact", head: true });
        const n = typeof count === "number" ? count : last;
        setProgress(`Ingesting… ${n} clip${n === 1 ? "" : "s"} so far`);
        if (n > last && i >= 1) { last = n; }
        if (n > 0 && i >= 2) break; // got clips and gave the worker a moment
        last = Math.max(last, n);
      }
      setProgress(null);
      showToast("Transcript ingest complete — you can Discover now.");
    } catch {
      setProgress(null);
      showToast("Could not reach the ingest worker. Try again.");
    } finally {
      setIngesting(false);
    }
  }, [clipCount, loadClipCount, showToast]);

  // Whole-library mining: ingest EVERY transcribed file in the FootageBrain library (or one
  // region) into transcript_clips — not just the ~12 reel-attached clips. This is a $0
  // transcript copy (no LLM); cost only happens later when you Discover the ingested clips.
  // Fire-and-forget on the backend; we poll the clip count for feedback while it runs.
  const handleMineLibrary = useCallback(async () => {
    const picked = libFolders.find((f) => f.folder === libFolder);
    const scope = libFolder
      ? `the "${libFolder}" folder${picked ? ` (~${picked.files} files)` : ""}`
      : "your ENTIRE footage library (~8k transcribed files, a few minutes)";
    if (!window.confirm(
      `Mine ${scope} into the discovery store?\n\nIngest is FREE — it just copies existing ` +
      "transcripts (no LLM spend). You then Discover the ingested clips folder-by-folder."
    )) return;
    setMining(true);
    setProgress(`Mining ${libFolder || "library"} transcripts…`);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast("Not signed in — mining skipped."); setProgress(null); return; }
      const r = await fetch("/api/ai/suggest?action=forge-ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ source: "library", folder: libFolder || undefined }),
      });
      if (!r.ok && r.status !== 202) {
        const b = await r.json().catch(() => ({}));
        showToast(`Library mining failed (${r.status}): ${b.error || "unknown error"}`);
        setProgress(null);
        return;
      }
      // Poll the clip count while the worker runs (it can take minutes for the whole library).
      let last = clipCount || 0;
      for (let i = 0; i < FORGE_LIB_POLL_TRIES; i++) {
        await new Promise((res) => setTimeout(res, FORGE_POLL_MS));
        const { count } = await supabase
          .from("transcript_clips")
          .select("id", { count: "exact", head: true });
        const n = typeof count === "number" ? count : last;
        setProgress(`Mining ${libFolder || "library"}… ${n} clip${n === 1 ? "" : "s"} in store`);
        last = Math.max(last, n);
      }
      await loadClipCount();
      setProgress(null);
      showToast(
        libFolder
          ? `Mined "${libFolder}". Set Folder → ${libFolder} and click ✦ Discover.`
          : "Library mining underway — clips are landing. Pick a Folder, then ✦ Discover."
      );
    } catch {
      setProgress(null);
      showToast("Could not reach the ingest worker. Try again.");
    } finally {
      setMining(false);
    }
  }, [libFolder, libFolders, clipCount, loadClipCount, showToast]);

  // Poll the entity-backfill progress once. Returns the progress record (or null).
  const pollBackfill = useCallback(async () => {
    try {
      const r = await fetch("/api/monitor/status?action=forge-backfill-status");
      if (!r.ok) return null;
      const d = await r.json();
      const prog = d && d.ok ? d.progress : null;
      setBackfill(prog);
      return prog;
    } catch {
      return null;
    }
  }, []);

  // On mount (with access), check whether a backfill is already in flight — so a reload mid-run
  // still shows the "Backfilling…" state instead of offering to start a duplicate.
  useEffect(() => {
    if (!cfAccess) return;
    pollBackfill();
  }, [cfAccess, pollBackfill]);

  // Kick off (or resume watching) the one-off entity backfill over existing opportunities.
  const handleBackfillEntities = useCallback(async () => {
    if (isBlockedSync("content_forge")) {
      showToast("Content Forge is disabled — enable it in Monitor → Free LLM Gates.");
      return;
    }
    if (!window.confirm(
      "Backfill entities on existing opportunities?\n\nThis reads each old opportunity's " +
      "source clips and fills in the named places/events/people — it does NOT re-discover or " +
      "change any hooks/scripts you've made. Cheap (tiny output), runs in the background."
    )) return;
    setBackfilling(true);
    setProgress("Starting entity backfill…");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast("Not signed in — backfill skipped."); setProgress(null); setBackfilling(false); return; }
      const r = await fetch("/api/ai/suggest?action=forge-backfill-entities", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ tier: "free", model }),
      });
      const b = await r.json().catch(() => ({}));
      if (b?.already_running) showToast("A backfill is already running — watching its progress.");
      else if (!r.ok && r.status !== 202) {
        showToast(`Backfill failed to start (${r.status}): ${b.error || "unknown error"}`);
        setProgress(null); setBackfilling(false); return;
      }
      // Poll progress until the worker reports done (or we hit a long ceiling — it keeps
      // running server-side regardless; this is just the live feedback loop).
      for (let i = 0; i < 120; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        const prog = await pollBackfill();
        if (prog) {
          const { processed = 0, patched = 0, total = 0, running } = prog;
          setProgress(`Backfilling entities… ${processed}/${total || "?"} scanned · ${patched} tagged`);
          if (!running) {
            showToast(`Entity backfill done — ${patched} opportunities tagged.`);
            break;
          }
        }
      }
      await loadOpps();
      setProgress(null);
    } catch {
      setProgress(null);
      showToast("Could not reach the backfill worker. Try again.");
    } finally {
      setBackfilling(false);
    }
  }, [model, pollBackfill, loadOpps, showToast]);

  const handleDiscover = useCallback(async () => {
    if (isBlockedSync("content_forge")) {
      showToast("Content Forge is disabled — enable it in Monitor → Free LLM Gates.");
      return;
    }
    // Backend kill-switch / daily-limit fast-path: don't burn a round-trip when the
    // server would just skip the LLM (the banner already shows why). The backend is
    // still the real guard; this only avoids a confusing "found 0 opportunities".
    if (cfBudget && (cfBudget.enabled === false || cfBudget.blocked)) {
      showToast(cfBudget.enabled === false
        ? "Content Forge LLM is OFF (kill switch) — re-enable it in Monitor → API Budgets & Limits."
        : "Daily limit reached — discovery is paused until 00:00 UTC (raise it in Monitor → API Budgets & Limits).");
      return;
    }
    // Guard the chicken-and-egg: with no clips, discovery is a guaranteed no-op.
    if (clipCount === 0) {
      showToast("No transcript clips yet — click ⤓ Ingest first, then Discover.");
      return;
    }
    // Token-bleed guard: re-running discovery with opportunities already on hand
    // re-pays to mine the whole corpus. Confirm BEFORE recording usage so a cancel
    // costs nothing.
    if (
      opps.length > 0 &&
      !window.confirm(
        `You already have ${opps.length} opportunit${opps.length === 1 ? "y" : "ies"}. ` +
          "Re-discover anyway? This spends tokens."
      )
    ) return;
    recordUsage("content_forge");
    setDiscovering(true);
    setProgress(`Discovering (${tier} tier)…`);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast("Not signed in — discovery skipped."); return; }
      const body = { tier };
      // Discovery TARGET (the LLM hint) — independent of the filter dropdown.
      const target = (discoverTarget || "").trim();
      if (target && target !== "global" && target !== "__custom__") body.country = target;
      // Cost cap (optional): how many opportunities the LLM writes this pass. Output
      // tokens dominate the bill, so this is the real cost lever. 0 = backend default.
      if (maxOpps > 0) body.max_opportunities = maxOpps;
      // Model toggle — compare 2.5-flash (sharper) vs 2.0-flash (~6x cheaper output).
      if (model) body.model = model;
      // Footage-folder scope — when set, the backend filters transcript_clips to this
      // folder and walks it clipsPerPass at a time (each Discover advances the next
      // un-analyzed clips in path order). Empty = legacy all-footage window.
      if (folder) { body.folder = folder; body.clips_per_pass = clipsPerPass; }
      const r = await fetch("/api/ai/suggest?action=forge-discover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok && r.status !== 202) {
        showToast(`Discovery failed (${r.status}): ${out.error || "unknown error"}`);
        setProgress(null);
        return;
      }
      const batchId = out.batch_id;
      // Poll the batch via the forge-status proxy until rows land (or we time out).
      let found = 0;
      for (let i = 0; i < FORGE_POLL_TRIES; i++) {
        await new Promise((res) => setTimeout(res, FORGE_POLL_MS));
        if (batchId) {
          try {
            const sr = await fetch(
              `/api/monitor/status?action=forge-status&batch_id=${encodeURIComponent(batchId)}`,
              { headers: { Authorization: `Bearer ${session.access_token}` } }
            );
            const sb = await sr.json().catch(() => ({}));
            if (typeof sb.count === "number") found = sb.count;
          } catch { /* keep polling */ }
        }
        setProgress(
          found > 0
            ? `Discovering… ${found} opportunit${found === 1 ? "y" : "ies"} found`
            : `Discovering (${tier} tier)… analyzing footage`
        );
        if (found > 0) { await loadOpps(); break; }
      }
      await loadOpps();
      setProgress(null);
      if (found > 0) {
        showToast(`Discovery complete — ${found} new opportunit${found === 1 ? "y" : "ies"}.`);
      } else {
        showToast(
          "Discovery finished but found 0 opportunities. Try ingesting more footage " +
          "or a different target country."
        );
      }
    } catch {
      setProgress(null);
      showToast("Could not reach the discovery engine. Try again.");
    } finally {
      setDiscovering(false);
      loadBudgetState(); // a run may have crossed a daily limit — refresh the banner
    }
  }, [tier, discoverTarget, maxOpps, model, clipCount, opps.length, cfBudget, loadOpps, loadBudgetState, showToast]);

  if (!cfAccess) {
    return (
      <div className="cf-root">
        <div className="cf-empty">You don't have access to Content Forge. Ask Paul to enable it for you.</div>
      </div>
    );
  }

  return (
    <div className="cf-root">
      <div className="cf-header">
        <h2>Content Forge</h2>
        {!loading && (
          <span className="cf-count">
            {sorted.length} / {opps.length} opportunities
            {loadingMore ? " · loading more…" : ""}
          </span>
        )}
        <span
          className="cf-count"
          title="Footage transcript segments available for discovery. Discovery reads these — with 0 clips it produces nothing."
        >
          {clipCount === null ? "… clips" : `${clipCount} clip${clipCount === 1 ? "" : "s"}`}
        </span>
        {expandedCount > 0 && (
          <span
            className="cf-count"
            title="Opportunities already expanded into hooks — don't re-spend tokens on these."
          >
            {expandedCount} expanded
          </span>
        )}
        <div className="cf-view-toggle" role="group" aria-label="View">
          <button
            type="button"
            className={"cf-view-btn" + (!showAnalytics ? " active" : "")}
            onClick={() => setShowAnalytics(false)}
          >
            Opportunities
          </button>
          <button
            type="button"
            className={"cf-view-btn" + (showAnalytics ? " active" : "")}
            onClick={() => setShowAnalytics(true)}
            title="Client-side analytics over the loaded opportunities — tier split, theme→quality, country volume vs quality. No LLM, no extra queries."
          >
            📈 Analytics
          </button>
        </div>
        {isBlockedSync("content_forge") && (
          <span
            className="cf-gate-warn"
            title="Content Forge is OFF in Monitor → Free LLM Gates. Discover and Expound are disabled."
          >
            ⚠ disabled
          </span>
        )}
        <button
          style={{ marginLeft: "auto" }}
          className="cf-btn"
          onClick={handleIngest}
          disabled={ingesting}
          title="Pull your ~12 reel-attached footage transcripts into the discovery store"
        >
          {ingesting ? "Ingesting…" : "⤓ Ingest"}
        </button>
        <span
          className="cf-target"
          title="Mine the WHOLE FootageBrain library (~8k transcribed files), not just reel-attached clips. Pick a region or mine everything. Ingest is free (no LLM) — it just copies transcripts."
        >
          <label htmlFor="cf-lib-folder">Library</label>
          <select
            id="cf-lib-folder"
            className="cf-select"
            value={libFolder}
            onChange={(e) => setLibFolder(e.target.value)}
            disabled={mining}
          >
            <option value="">Whole library</option>
            {libFolders.map((f) => (
              <option key={f.folder} value={f.folder}>
                {f.folder} ({f.files})
              </option>
            ))}
          </select>
        </span>
        <button
          className="cf-btn"
          onClick={handleMineLibrary}
          disabled={mining}
          title="Ingest every transcribed file in the selected library scope into the discovery store ($0 — no LLM)"
        >
          {mining ? "Mining…" : "⛏ Mine Library"}
        </button>
        <button
          className="cf-btn"
          onClick={handleBackfillEntities}
          disabled={backfilling || (backfill && backfill.running)}
          title="Fill in named places/events/people on OLD opportunities (discovered before the entity feature). Does NOT re-discover or change hooks/scripts — cheap, background."
        >
          {backfilling || (backfill && backfill.running)
            ? `Backfilling… ${backfill?.patched ?? 0}`
            : "🔎 Backfill entities"}
        </button>
        <span className="cf-tier" role="group" aria-label="LLM tier">
          <button
            className={tier === "free" ? "on" : ""}
            onClick={() => setTier("free")}
            title="Free tier — OpenRouter / Gemini"
          >Free</button>
          <button
            className={tier === "pro" ? "on" : ""}
            onClick={() => setTier("pro")}
            title="Pro tier — Claude (Haiku discovery / Sonnet expansion)"
          >Pro</button>
        </span>
        <span className="cf-target" title="Country/region the discovery pass targets">
          <label htmlFor="cf-discover-target">Target</label>
          <select
            id="cf-discover-target"
            className="cf-select"
            value={targetIsCustom ? "__custom__" : discoverTarget}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__custom__") {
                setTargetIsCustom(true);
                setDiscoverTarget("");
              } else {
                setTargetIsCustom(false);
                setDiscoverTarget(v);
              }
            }}
          >
            {DISCOVERY_TARGETS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {targetIsCustom && (
            <input
              type="text"
              className="cf-select cf-target-input"
              value={discoverTarget}
              onChange={(e) => setDiscoverTarget(e.target.value)}
              placeholder="e.g. Kenya, Southeast Asia…"
              autoFocus
            />
          )}
        </span>
        <span className="cf-target" title="LLM model for Discover + Expound. 2.5-flash is sharper; 2.0-flash is ~6x cheaper on output. Toggle to compare output quality.">
          <label htmlFor="cf-model">Model</label>
          <select
            id="cf-model"
            className="cf-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="google/gemini-2.5-flash">2.5 Flash (sharper)</option>
            <option value="google/gemini-2.0-flash-001">2.0 Flash (~6× cheaper)</option>
          </select>
        </span>
        <span className="cf-target" title="How many opportunities to generate per Discover (the main cost lever — output tokens dominate the bill)">
          <label htmlFor="cf-max-opps">Max</label>
          <select
            id="cf-max-opps"
            className="cf-select"
            value={maxOpps}
            onChange={(e) => setMaxOpps(Number(e.target.value) || 0)}
          >
            <option value={0}>Auto (8–20)</option>
            <option value={5}>~5 (cheapest)</option>
            <option value={10}>~10</option>
            <option value={15}>~15</option>
            <option value={20}>~20</option>
          </select>
        </span>
        <span className="cf-target" title="Scope Discover to ONE footage folder (e.g. Japan). The pass walks that folder in order, feeding the next un-analyzed clips each click. 'All footage' = the legacy recent window.">
          <label htmlFor="cf-folder">Folder</label>
          <select
            id="cf-folder"
            className="cf-select"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          >
            <option value="">All footage</option>
            {allFolderOptions.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </span>
        {folder && (
          <span className="cf-target" title="How many footage clips to feed per Discover click when a folder is scoped. Each click advances this many un-analyzed clips through the folder, in order.">
            <label htmlFor="cf-clips-per-pass">Clips/pass</label>
            <select
              id="cf-clips-per-pass"
              className="cf-select"
              value={clipsPerPass}
              onChange={(e) => setClipsPerPass(Number(e.target.value) || 20)}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={40}>40</option>
            </select>
          </span>
        )}
        <button
          className="cf-btn primary"
          onClick={handleDiscover}
          disabled={discovering}
        >
          {discovering ? "Discovering…" : "✦ Discover"}
        </button>
        <button className="cf-btn" onClick={loadOpps} disabled={loading}>
          {loading ? "Loading…" : "⟳ Reload"}
        </button>
        <button
          className={"cf-btn" + (showCoverage ? " on" : "")}
          onClick={toggleCoverage}
          title="Library coverage — per-folder discovery progress + how many titles/hooks each folder has produced"
        >
          {showCoverage ? "▲ Coverage" : "📊 Coverage"}
        </button>
      </div>

      {cfBudget && (cfBudget.enabled === false || cfBudget.blocked) && (
        <div
          className="cf-blocked-banner"
          role="alert"
          style={{
            display: "flex", alignItems: "center", gap: 10, margin: "10px 0",
            padding: "10px 14px", borderRadius: 8, fontSize: 13,
            background: "rgba(224,86,79,.10)",
            border: "1px solid rgba(224,86,79,.45)",
            color: "var(--c-red, #e0564f)",
          }}
        >
          <span style={{ fontSize: 16, flexShrink: 0 }}>
            {cfBudget.enabled === false ? "⛔" : "⏸"}
          </span>
          <span style={{ minWidth: 0 }}>
            {cfBudget.enabled === false ? (
              <>
                <strong>Content Forge LLM is OFF (kill switch).</strong>{" "}
                Discover &amp; Expound will skip the LLM — no opportunities or hooks
                will be generated (zero credit spend). Re-enable it in{" "}
                <strong>Monitor → API Budgets &amp; Limits</strong>.
              </>
            ) : (
              <>
                <strong>Daily limit reached.</strong>{" "}
                Discovery &amp; expansion are paused until <strong>00:00 UTC</strong>.
                Raise the limit in <strong>Monitor → API Budgets &amp; Limits</strong>
                {(() => {
                  const lim = Number(cfBudget.daily_limit_usd) || 0;
                  const clim = Number(cfBudget.daily_call_limit) || 0;
                  const parts = [];
                  if (lim > 0) parts.push(`$${lim.toFixed(2)}/day`);
                  if (clim > 0) parts.push(`${clim} calls/day`);
                  return parts.length ? ` (limit: ${parts.join(" · ")})` : "";
                })()}
                .
              </>
            )}
          </span>
        </div>
      )}

      {showAnalytics && <ForgeAnalytics opps={opps} loading={loading} />}

      {!showAnalytics && (
        <>
      {showCoverage && (
        <div className="cf-coverage">
          <div className="cf-coverage-head">
            <strong>Library coverage</strong>
            {coverage && (
              <span className="cf-count">
                {coverage.length} folders · {coverage.reduce((a, c) => a + c.opps, 0)} titles
              </span>
            )}
            <button className="cf-btn cf-coverage-refresh" onClick={loadCoverage} disabled={coverageLoading}>
              {coverageLoading ? "Loading…" : "⟳ Refresh"}
            </button>
          </div>
          {coverageLoading && !coverage ? (
            <div className="cf-coverage-empty">Reading transcript clips…</div>
          ) : coverage && coverage.length ? (
            <div className="cf-coverage-scroll">
              <table className="cf-coverage-table">
                <thead>
                  <tr>
                    <th>Folder</th><th>Files</th><th>Clips</th>
                    <th>Discovered</th><th>Titles</th><th>Hooks</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((c) => (
                    <tr key={c.folder}>
                      <td className="cf-cov-folder" title={c.folder}>{c.folder}</td>
                      <td className="cf-cov-num">{c.files}</td>
                      <td className="cf-cov-num">{c.clips}</td>
                      <td className="cf-cov-bar-cell">
                        <div className="cf-cov-bar" title={`${c.discovered} / ${c.clips} clips mined`}>
                          <div className="cf-cov-bar-fill" style={{ width: `${c.pct}%` }} />
                          <span className="cf-cov-bar-label">{c.pct}%</span>
                        </div>
                      </td>
                      <td className="cf-cov-num">{c.opps}</td>
                      <td className="cf-cov-num">{c.hooks}</td>
                      <td>
                        <button
                          className="cf-btn cf-cov-remine"
                          onClick={() => remineFolder(c)}
                          disabled={!!remining || c.folder === "(unlabeled)"}
                          title="Re-mine this folder for additional angles (re-opens fully-mined folders, then walks them — spends tokens)"
                        >
                          {remining === c.folder ? "Re-mining…" : "⛏ Re-mine"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="cf-coverage-empty">No coverage data.</div>
          )}
        </div>
      )}

      <div className="cf-filters">
        <div className="cf-vet-views" role="group" aria-label="Vetting queue">
          {VET_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              className={vetView === v ? "on" : ""}
              onClick={() => setVetView(v)}
              title={`Show ${VET_LABEL[v].toLowerCase()} opportunities`}
            >
              {VET_LABEL[v]}
              <span className="cf-vet-n">{vetCounts[v] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="cf-tier-pills" role="group" aria-label="Filter by virality tier">
          {TIERS.map((t) => (
            <button
              key={t}
              type="button"
              className={`cf-pill t-${t}` + (tierSel.has(t) ? " on" : "")}
              onClick={() => toggleTierSel(t)}
              title={`Toggle ${t}-tier`}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="cf-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title / hook…"
          aria-label="Search opportunities by title or hook"
        />
        <select className="cf-select" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="all">All countries</option>
          {countryOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button
          type="button"
          className={"cf-pill cf-fav-filter" + (favOnly ? " on" : "")}
          onClick={() => setFavOnly((v) => !v)}
          title="Show only favorited opportunities"
          aria-pressed={favOnly}
        >
          {favOnly ? "★ Favorites" : "☆ Favorites"}
        </button>
        <button
          type="button"
          className={"cf-pill" + (showArchived ? " on" : "")}
          onClick={() => setShowArchived((v) => !v)}
          title="Archived opportunities are never deleted — toggle to view + restore them"
          aria-pressed={showArchived}
        >
          {showArchived ? "⧉ Archived" : "⧉ Show archived"}
        </button>
        <div className="cf-color-filter" role="group" aria-label="Filter by color">
          <span className="cf-filter-label">Color</span>
          {ROW_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              className={"cf-color-dot" + (colorSel.has(c.key) ? " on" : "")}
              style={{ "--dot": c.hex }}
              onClick={() => toggleColorSel(c.key)}
              title={`Filter ${c.key}`}
              aria-pressed={colorSel.has(c.key)}
            />
          ))}
          {colorSel.size > 0 && (
            <button
              type="button"
              className="cf-color-clear-all"
              onClick={() => setColorSel(new Set())}
              title="Clear color filters"
            >✕</button>
          )}
        </div>
        <select
          className="cf-select"
          value={sort.key}
          onChange={(e) => setSort({ key: e.target.value, dir: "desc" })}
          title="Sort"
        >
          <option value="virality">Sort: Virality ↓</option>
          <option value="newest">Sort: Newest</option>
        </select>
        <button
          type="button"
          className={"cf-btn cf-folder-toggle" + (grouped ? " primary" : "")}
          onClick={() => setGrouped((g) => !g)}
          title={grouped ? "Show a single flat list" : "Group opportunities into per-country folders"}
        >
          {grouped ? "▾ Folders" : "▸ Folders"}
        </button>
      </div>

      {progress && <div className="cf-progress">{progress}</div>}
      {error && <div className="cf-error">{error}</div>}
      {loading && <div className="cf-empty">Loading opportunities…</div>}
      {!loading && !error && sorted.length === 0 && (
        <div className="cf-empty">
          {clipCount === 0 ? (
            <>
              No footage transcripts ingested yet. Click <strong>⤓ Ingest</strong> to
              pull your transcribed footage into the discovery store, then{" "}
              <strong>✦ Discover</strong> to surface ranked content angles.
            </>
          ) : (
            <>
              No opportunities yet. Pick a <strong>Target</strong> country, then click{" "}
              <strong>✦ Discover</strong> to surface ranked content angles from your footage.
            </>
          )}
        </div>
      )}

      {!loading && !error && sorted.length > 0 && !grouped && (
        <div className="cf-table-wrap">
          <table className="cf-table">
            <thead>{headRow}</thead>
            <tbody>{sorted.map(renderRow)}</tbody>
          </table>
        </div>
      )}

      {!loading && !error && sorted.length > 0 && grouped && (
        <div className="cf-folders">
          {countryGroups.map(([cn, rows]) => {
            const isShut = collapsed.has(cn);
            // Tier breakdown badge for the folder header (S/A count is the useful signal).
            const tierCounts = rows.reduce((m, r) => {
              const t = String(r.virality_tier || "C").toUpperCase();
              m[t] = (m[t] || 0) + 1; return m;
            }, {});
            return (
              <div key={cn} className="cf-folder">
                <button
                  type="button"
                  className="cf-folder-head"
                  onClick={() => toggleCountry(cn)}
                  aria-expanded={!isShut}
                >
                  <span className="cf-folder-caret">{isShut ? "▸" : "▾"}</span>
                  <span className="cf-folder-name">{cn}</span>
                  <span className="cf-folder-count">{rows.length}</span>
                  <span className="cf-folder-tiers">
                    {TIERS.filter((t) => tierCounts[t]).map((t) => (
                      <span key={t} className={`cf-tier-badge t-${t}`} title={`${tierCounts[t]} ${t}-tier`}>
                        {t}·{tierCounts[t]}
                      </span>
                    ))}
                  </span>
                </button>
                {!isShut && (
                  <div className="cf-table-wrap">
                    <table className="cf-table">
                      <thead>{headRow}</thead>
                      <tbody>{rows.map(renderRow)}</tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </>
      )}

      {openOpp && (
        <ForgeModal
          opportunity={openOpp}
          tier={tier}
          model={model}
          reels={reels}
          onClose={() => setOpenOpp(null)}
          onSent={loadOpps}
          showToast={showToast}
        />
      )}

      {toast && <div className="cf-toast">{toast}</div>}
    </div>
  );
}

export default ContentForge;
