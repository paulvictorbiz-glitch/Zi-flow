/* =========================================================
   Export — posted reels list + Planable-format CSV download
   + (owner-only) one-click "Push to Planable".

   Reads live from the store. Shows every reel with stage =
   "posted", listing the description and the scheduled post
   date/time. "Download .csv" produces a two-column file in the
   format Planable accepts:

     Description,Scheduled
     "caption text","2026-05-13 18:00"

   Description prefers the AI publish pack's IG caption
   (detail.aiDraft.seo.ig_caption + hashtags — the text you'd
   actually paste into Planable), falling back to `logline`,
   then title. Scheduled is the reel's `scheduledPostDate` (set
   by the Move-to-Posted modal — date only, exported as
   "YYYY-MM-DD"), falling back to `dueAt`, formatted as
   "YYYY-MM-DD HH:mm" in the viewer's local timezone —
   Planable's CSV import accepts both.

   ── resolveRow(reel) — ONE source of truth ──────────────
   The per-reel caption/schedule resolution used to be inline in
   the rows useMemo. It is now extracted into resolveRow() so the
   CSV path AND the Push path resolve identically — the CSV output
   is byte-for-byte unchanged (buildCsv consumes resolveRow().{description,scheduled}).

   ── Push to Planable (OWNER-ONLY) ───────────────────────
   Owner selects posted reels (checkboxes) + a target platform
   (populated ONLY from planable_config.pages page IDs the owner
   owns), then a MANDATORY preview lists, per reel: target handle,
   caption, composed schedule datetime (date-only scheduledPostDate
   + config.defaultTime in config.timezone) and media yes/no. Past
   or blank-date items are flagged and EXCLUDED from the send. On
   explicit confirm we POST /api/ai/suggest?action=planable-push
   (Bearer JWT — server re-gates with verifyOwner) and render a
   per-reel status. Reels already pushed (detail.planablePush) are
   pre-marked. The table + CSV download stay visible to ALL roles.
   ========================================================= */

import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { DPill } from "../components/components.jsx";
import { useWorkflow } from "../store/store.jsx";
import { useIsOwner } from "../lib/permissions.jsx";
import { supabase } from "../lib/supabase-client.js";

/* Platform keys the API contract accepts (one of ig|fb|tiktok|yt|linkedin|x|
   pinterest|threads|gbp). Labels are display-only. The selector shows ONLY
   the subset that has a non-empty page id in planable_config.pages. */
const PLATFORM_LABELS = {
  ig: "Instagram", fb: "Facebook", tiktok: "TikTok", yt: "YouTube",
  linkedin: "LinkedIn", x: "X", pinterest: "Pinterest", threads: "Threads", gbp: "Google Business",
};
const PLATFORM_ORDER = ["ig", "fb", "tiktok", "yt", "linkedin", "x", "pinterest", "threads", "gbp"];

/* Local-time "YYYY-MM-DD HH:mm" for the Scheduled column. Returns
   empty string when unset so the row still exports but the operator
   can see at a glance which times are missing. Date-only values
   (scheduledPostDate from the posting modal) pass through unchanged —
   inventing a time of day would be worse than omitting it. */
function formatPlanable(iso) {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return yyyy + "-" + mm + "-" + dd + " " + hh + ":" + mi;
}

/* ── resolveRow — THE single per-reel resolver ──────────────────────────────
   Used by both the CSV path (via the rows useMemo → buildCsv) and the Push
   path. Returns the exact same {description, scheduled} the CSV always used,
   PLUS extra fields the push/preview needs (schedRaw, the raw date-only value,
   mediaUrl). Touching this function is the ONLY way the CSV output changes —
   so it must stay behavior-identical to the old inline logic. */
function resolveRow(r) {
  // The Move-to-Posted modal saves scheduledPostDate (date only);
  // dueAt is the older datetime field. Prefer the posting date.
  const schedRaw = r.scheduledPostDate || r.dueAt || null;
  // Publish-pack caption beats the logline: it's the text that
  // actually gets posted, and the generator already wrote it.
  const seo = r.detail?.aiDraft?.seo || null;
  const caption = (seo?.ig_caption || "").trim();
  const hashtags = (seo?.hashtags || [])
    .map(h => (String(h).startsWith("#") ? h : "#" + h))
    .join(" ");
  const description = caption
    ? (hashtags ? caption + "\n\n" + hashtags : caption)
    : ((r.logline && r.logline.trim()) || r.title || "");
  return {
    id: r.id,
    title: r.title || "",
    description,
    fromPack: !!caption,
    schedRaw,
    // The plain date-only value (if any) for the push composed-datetime path.
    scheduledDate: r.scheduledPostDate || null,
    scheduled: formatPlanable(schedRaw),
    // Candidate media — the server resolves the authoritative public video.
    mediaUrl: r.attachUrl || null,
    // Owner-uploaded final video — a private "reel-videos" storage path the
    // server signs (its preferred mediaPath branch) before the two-step attach.
    // detail.jsx persists these on the reel as mediaPath/mediaTarget (via
    // updateReel), so read them under those names — not attachPath/attachTarget.
    mediaPath: r.mediaPath || null,
    mediaTarget: r.mediaTarget || null,
    // Idempotency pre-mark.
    priorPush: r.detail?.planablePush || null,
  };
}

/* RFC 4180 CSV cell escape — wraps in quotes if the value contains
   a comma, quote, or newline; doubles embedded quotes. */
function csvCell(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function buildCsv(rows) {
  const header = ["Description", "Scheduled"].join(",");
  const body = rows.map(r => [csvCell(r.description), csvCell(r.scheduled)].join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ── Schedule composition (date-only + defaultTime in config.timezone) ───────
   A reel's scheduledPostDate is date-only (YYYY-MM-DD). Planable needs a
   datetime. We compose date + config.defaultTime as a WALL-CLOCK time in
   config.timezone, then:
     · render the composed display string for the preview, and
     · compute the absolute instant so we can flag "in the past".
   We never silently invent a time for the wrong zone: composeSchedule returns
   null when the date is blank, so blank-date items are visibly skipped. */

/* Format an absolute Date as "YYYY-MM-DD HH:mm" wall-clock in `tz`. */
function wallClockInZone(date, tz) {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
    let hh = parts.hour;
    if (hh === "24") hh = "00";
    return `${parts.year}-${parts.month}-${parts.day} ${hh}:${parts.minute}`;
  } catch {
    return null;
  }
}

/* Interpret "YYYY-MM-DD HH:mm" as a wall-clock time in `tz` → absolute ms.
   Uses the standard offset-probe: guess UTC, measure how that instant reads
   in tz, correct by the delta (one iteration is exact away from DST seams,
   two iterations covers the seam). Returns NaN if tz/inputs are unusable. */
function zonedWallTimeToMs(y, mo, d, h, mi, tz) {
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offsetAt = (ms) => {
    const s = wallClockInZone(new Date(ms), tz);
    if (!s) return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
    if (!m) return null;
    const asReadUTC = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0);
    return asReadUTC - ms; // tz offset at this instant
  };
  let off = offsetAt(asUTC);
  if (off == null) return NaN;
  let guess = asUTC - off;
  const off2 = offsetAt(guess);
  if (off2 != null && off2 !== off) guess = asUTC - off2;
  return guess;
}

/* Compose a reel's date-only scheduledPostDate with config.defaultTime in
   config.timezone. Returns { display, ms, past } or null when no date. */
function composeSchedule(scheduledDate, defaultTime, tz) {
  if (!scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return null;
  const [y, mo, d] = scheduledDate.split("-").map(Number);
  const tm = /^\d{2}:\d{2}$/.test(defaultTime || "") ? defaultTime : "09:00";
  const [h, mi] = tm.split(":").map(Number);
  const ms = zonedWallTimeToMs(y, mo, d, h, mi, tz || "UTC");
  const display = `${scheduledDate} ${tm}` + (tz ? ` (${tz})` : "");
  // "scheduled" string sent to the server: ISO instant if we resolved the
  // zone, else the wall-clock string (server can re-interpret with its config).
  const iso = Number.isFinite(ms) ? new Date(ms).toISOString() : `${scheduledDate}T${tm}:00`;
  return {
    display,
    iso,
    ms: Number.isFinite(ms) ? ms : NaN,
    past: Number.isFinite(ms) ? ms < Date.now() : false,
  };
}

function ExportView({ onOpen }) {
  const { reels, updateReel } = useWorkflow();
  const isOwner = useIsOwner();

  /* Rows = posted, non-archived. Sorted by scheduled time ascending
     so the CSV reads top-to-bottom in post order. Reels with no
     dueAt sink to the bottom. resolveRow() is the single resolver. */
  const rows = useMemo(() => {
    const posted = reels
      .filter(r => r.stage === "posted" && !r.archivedAt)
      .map(resolveRow);
    posted.sort((a, b) => {
      if (!a.schedRaw && !b.schedRaw) return 0;
      if (!a.schedRaw) return 1;
      if (!b.schedRaw) return -1;
      return a.schedRaw.localeCompare(b.schedRaw);
    });
    return posted;
  }, [reels]);

  const handleDownload = () => {
    if (!rows.length) return;
    const csv = buildCsv(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, "posted-reels-" + stamp + ".csv");
  };

  /* ── Planable config (read client-side, owner-only affordances) ──────────
     Read the SAME app_settings key the social-client uses. We populate the
     platform <select> with ONLY platforms that have a non-empty page id in
     config.pages. If config is absent/empty the whole push UI is disabled
     with an explanatory note. The token is NEVER stored client-side; this
     read only surfaces page ids/handles for the selector + preview. */
  const [planCfg, setPlanCfg] = useState(undefined); // undefined=loading, null=absent
  const [cfgError, setCfgError] = useState(false);

  useEffect(() => {
    if (!isOwner) return; // only the owner needs the push affordances
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "planable_config")
          .maybeSingle();
        if (!alive) return;
        if (error) { setCfgError(true); setPlanCfg(null); return; }
        const v = data?.value && typeof data.value === "object" ? data.value : null;
        setPlanCfg(v);
      } catch {
        if (!alive) return;
        setCfgError(true);
        setPlanCfg(null);
      }
    })();
    return () => { alive = false; };
  }, [isOwner]);

  // Platforms available = those with a non-empty page id in config.pages.
  const availablePlatforms = useMemo(() => {
    const pages = planCfg?.pages || {};
    return PLATFORM_ORDER
      .filter(k => pages[k] != null && String(pages[k]).trim() !== "")
      .map(k => ({
        key: k,
        label: PLATFORM_LABELS[k] || k,
        pageId: String(pages[k]),
        handle: planCfg?.handles?.[k] || null,
      }));
  }, [planCfg]);

  const configured = !!planCfg && availablePlatforms.length > 0;

  /* ── Target accounts (MULTI-select) ─────────────────────────────────────
     The owner ticks one OR MANY accounts; a push fans out to each ticked
     platform (one server call per platform — the server resolves
     config.pages[key] and rejects anything unmapped, so the allow-list /
     cross-posting guard is unchanged). */
  const [selectedPlatforms, setSelectedPlatforms] = useState(() => new Set());
  const [accountsOpen, setAccountsOpen] = useState(false);
  const accountsRef = useRef(null);

  useEffect(() => {
    // Default to the first available account once config loads; drop any stale
    // keys if the config changes underneath us. Never leave an unmapped key.
    if (!configured) return;
    setSelectedPlatforms(prev => {
      const valid = new Set(availablePlatforms.map(p => p.key));
      const next = new Set([...prev].filter(k => valid.has(k)));
      if (next.size === 0 && availablePlatforms.length > 0) next.add(availablePlatforms[0].key);
      return next.size === prev.size && [...next].every(k => prev.has(k)) ? prev : next;
    });
  }, [configured, availablePlatforms]);

  // Close the accounts dropdown on an outside click.
  useEffect(() => {
    if (!accountsOpen) return;
    const onDocClick = (e) => {
      if (accountsRef.current && !accountsRef.current.contains(e.target)) setAccountsOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [accountsOpen]);

  const selectedMetas = useMemo(
    () => availablePlatforms.filter(p => selectedPlatforms.has(p.key)),
    [availablePlatforms, selectedPlatforms]
  );
  const allPlatformsSelected =
    availablePlatforms.length > 0 && selectedPlatforms.size === availablePlatforms.length;

  const togglePlatform = useCallback((key) => {
    setSelectedPlatforms(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const toggleAllPlatforms = useCallback(() => {
    setSelectedPlatforms(prev =>
      (prev.size === availablePlatforms.length ? new Set() : new Set(availablePlatforms.map(p => p.key))));
  }, [availablePlatforms]);

  /* ── Selection ──────────────────────────────────────────────────────────
     Tracks selected reel ids. Selection drives which rows get pushed. */
  const [selected, setSelected] = useState(() => new Set());
  // Drop stale ids if the posted set changes underneath us.
  useEffect(() => {
    setSelected(prev => {
      const valid = new Set(rows.map(r => r.id));
      let changed = false;
      const next = new Set();
      for (const id of prev) { if (valid.has(id)) next.add(id); else changed = true; }
      return changed ? next : prev;
    });
  }, [rows]);

  const toggleOne = useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const allSelected = rows.length > 0 && selected.size === rows.length;
  const toggleAll = useCallback(() => {
    setSelected(prev => (prev.size === rows.length ? new Set() : new Set(rows.map(r => r.id))));
  }, [rows]);

  /* ── Per-reel push status (UI4) ─────────────────────────────────────────
     ONE grouped post per reel (fanned across the selected platforms), so
     status is now PER-REEL, not per-(reel×platform):
       { [reelId]: { state, reason?, postId?, groupId?, withMedia?, platforms? } }.
     Pre-mark reels that already carry detail.planablePush as "already". */
  const [status, setStatus] = useState({});
  useEffect(() => {
    setStatus(prev => {
      const next = { ...prev };
      let changed = false;
      for (const r of rows) {
        const pp = r.priorPush;
        if (pp && !next[r.id]) {
          next[r.id] = {
            state: "already",
            postId: pp.postId,
            groupId: pp.groupId,
            platforms: pp.platforms || (pp.platform ? [pp.platform] : undefined),
            at: pp.at,
          };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rows]);

  // Set the (single) status for one reel.
  const setReelStatus = useCallback((reelId, patch) => {
    setStatus(prev => ({ ...prev, [reelId]: patch }));
  }, []);
  // Batch-level campaign indicator surfaced from the single response.
  const [campaign, setCampaign] = useState(null); // { id?, warning? } | null

  /* ── Preview / confirm panel ────────────────────────────────────────────
     MANDATORY before any send. Builds, per selected reel, the target handle,
     caption, composed datetime, media flag — and excludes past/blank-date
     items (marked skip) from the actual send. */
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pushing, setPushing] = useState(false);

  /* ── Posting time (UI1) ──────────────────────────────────────────────────
     One shared time-of-day applied to EVERY reel's own assigned date. Default
     to the config's defaultTime (else 09:00). Each reel keeps its DISTINCT
     scheduledDate; only the time of day is shared. Threaded into
     composeSchedule below (replacing the hard-coded defaultTime) so a change
     here recomputes every reel's scheduledIso. */
  const [postTime, setPostTime] = useState(planCfg?.defaultTime || "09:00");
  // When config loads after mount, adopt its defaultTime as the initial value
  // (only if the owner hasn't already typed a custom time — track that via a ref).
  const postTimeTouched = useRef(false);
  useEffect(() => {
    if (postTimeTouched.current) return;
    const dt = planCfg?.defaultTime;
    if (/^\d{2}:\d{2}$/.test(dt || "")) setPostTime(dt);
  }, [planCfg]);

  const preview = useMemo(() => {
    if (selectedMetas.length === 0) return [];
    const tz = planCfg?.timezone || "UTC";
    return rows
      .filter(r => selected.has(r.id))
      .map(r => {
        // Compose each reel's OWN scheduledDate with the shared postTime.
        const sched = composeSchedule(r.scheduledDate, postTime, tz);
        const blank = !sched;
        const past = !!sched && sched.past;
        const sendable = !blank && !past;
        return {
          id: r.id,
          title: r.title,
          caption: r.description || "",
          mediaUrl: r.mediaUrl,
          // Owner-uploaded final video (private storage path) carried through to
          // the push body so the server's preferred signed-url branch is reachable.
          mediaPath: r.mediaPath,
          mediaTarget: r.mediaTarget,
          // MEDIA: yes (have a candidate url or uploaded path) / unknown (none —
          // server may still resolve the authoritative public video).
          media: (r.mediaUrl || r.mediaPath) ? "yes" : "unknown",
          scheduleDisplay: sched ? sched.display : (r.scheduledDate ? null : null),
          scheduledIso: sched ? sched.iso : null,
          blank, past, sendable,
        };
      });
  }, [rows, selected, selectedMetas, planCfg, postTime]);

  const sendable = preview.filter(p => p.sendable);
  const skipped = preview.filter(p => !p.sendable);

  const openPreview = () => {
    if (!configured || selectedMetas.length === 0 || selected.size === 0) return;
    setCampaign(null);
    setPreviewOpen(true);
  };

  const confirmPush = async () => {
    // UI2: platforms are KEYS only — the server resolves config.pages[key]
    // (cross-posting allow-list guard). ONE call fans EACH reel across all of them.
    const platforms = selectedMetas.map(m => m.key);
    if (platforms.length === 0 || sendable.length === 0) return;
    setPushing(true);
    setCampaign(null);

    // Per-reel "pushing"; skipped items (past/blank date) marked once.
    setStatus(prev => {
      const next = { ...prev };
      for (const p of sendable) next[p.id] = { state: "pushing", platforms };
      for (const p of skipped) next[p.id] = { state: "skipped", reason: p.blank ? "no schedule date" : "scheduled in the past" };
      return next;
    });

    // Helper to mark all sendable reels with the same failure reason.
    const failAll = (reason) => { for (const p of sendable) setReelStatus(p.id, { state: "failed", reason, platforms }); };

    const ctrl = new AbortController();
    const abortTimer = setTimeout(() => ctrl.abort(), 70_000);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        // FAIL LOUDLY rather than silently no-op.
        failAll("not signed in");
        return;
      }

      // Build items ONCE across reels. Each item carries its OWN scheduled
      // instant (its assigned date + the shared posting time) + title + caption.
      const items = sendable.map(p => ({
        reelId: p.id,
        caption: p.caption,
        title: p.title,
        scheduled: p.scheduledIso,
        ...(p.mediaPath ? { mediaPath: p.mediaPath } : {}),
        ...(p.mediaTarget ? { mediaTarget: p.mediaTarget } : {}),
        ...(p.mediaUrl ? { mediaUrl: p.mediaUrl } : {}),
      }));
      const nowIso = new Date().toISOString();

      // EXACTLY ONE fetch regardless of how many platforms are ticked.
      const res = await fetch("/api/ai/suggest?action=planable-push", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ platforms, items }),
        signal: ctrl.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json || json.ok !== true || !Array.isArray(json.results)) {
        failAll((json && json.error) || ("push failed (HTTP " + res.status + ")"));
        return;
      }

      // Batch-level campaign indicator from the single response.
      setCampaign({ id: json.campaignId || null, warning: json.campaignWarning || null });

      const byId = Object.fromEntries(json.results.map(x => [x.reelId, x]));
      for (const p of sendable) {
        const r = byId[p.id];
        if (!r) { setReelStatus(p.id, { state: "failed", reason: "no result returned", platforms }); continue; }
        if (r.ok && r.skipped) {
          setReelStatus(p.id, { state: "already", postId: r.planablePostId, groupId: r.groupId, platforms });
        } else if (r.ok) {
          setReelStatus(p.id, { state: "pushed", postId: r.planablePostId, groupId: r.groupId, withMedia: !!r.withMedia, platforms });
          // Persist the idempotency marker on the reel (last successful push).
          const reel = reels.find(x => x.id === p.id);
          if (reel) {
            updateReel(p.id, {
              detail: { ...(reel.detail || {}), planablePush: { at: nowIso, postId: r.planablePostId, groupId: r.groupId, platforms } },
            });
          }
        } else {
          setReelStatus(p.id, { state: "failed", reason: r.error || "push failed", platforms });
        }
      }
    } catch (err) {
      const reason = err && err.name === "AbortError"
        ? "timed out"
        : "network error" + (err && err.message ? " · " + err.message : "");
      failAll(reason);
    } finally {
      clearTimeout(abortTimer);
      setPushing(false);
      setPreviewOpen(false);
    }
  };

  /* Status cell rendering — ONE grouped post per reel (UI4). */
  const platformLabel = (key) => availablePlatforms.find(p => p.key === key)?.label || key;
  const renderOneState = (s) => {
    switch (s.state) {
      case "pushing":  return <span style={{ color: "var(--c-cyan)" }}>pushing…</span>;
      case "pushed":   return <span style={{ color: "#34d399" }} title={s.postId ? "post " + s.postId : ""}>pushed ✓ {s.withMedia ? "(with media)" : "(text-only)"}</span>;
      case "already":  return <span style={{ color: "#a78bfa" }} title={s.postId ? "post " + s.postId : ""}>already</span>;
      case "skipped":  return <span style={{ color: "#f59e0b" }} title={s.reason || ""}>skipped{s.reason ? " · " + s.reason : ""}</span>;
      case "failed":   return <span style={{ color: "#f87171" }} title={s.reason || ""}>failed{s.reason ? " · " + s.reason : ""}</span>;
      default:         return <span className="dim">idle</span>;
    }
  };
  // Static "fanned to: YT, LI, …" badge for a reel row from its status' platforms.
  const fannedBadge = (plats) => {
    if (!Array.isArray(plats) || plats.length === 0) return null;
    return (
      <span style={{ color: "var(--fg-dim)", fontSize: 10, whiteSpace: "nowrap" }}
            title={"fanned to: " + plats.map(platformLabel).join(", ")}>
        fanned to: {plats.map(platformLabel).join(", ")}
      </span>
    );
  };
  const renderStatus = (id) => {
    const s = status[id];
    if (!s) return <span className="dim">idle</span>;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ whiteSpace: "nowrap" }}>{renderOneState(s)}</span>
        {(s.state === "pushed" || s.state === "already") && fannedBadge(s.platforms)}
      </div>
    );
  };

  const colSpan = isOwner ? 6 : 4;

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Export · posted reels</h1>
          <div className="sub">
            Every reel in the Posted stage. Download as Planable-ready CSV
            (Description, Scheduled). Descriptions use the AI publish-pack
            caption when the reel has one, else the logline.
          </div>
        </div>
        <div className="actions" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {isOwner && (
            <>
              {configured ? (
                <div ref={accountsRef} style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setAccountsOpen(o => !o)}
                    className="mono"
                    style={{
                      background: "var(--bg-soft, #11161f)", color: "#eef3fb",
                      border: "1px solid var(--border, #2a3342)", borderRadius: 8,
                      padding: "7px 10px", fontSize: 12, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 8,
                    }}
                    title="Target accounts — tick one or many. Only accounts with a configured page id are listed."
                  >
                    <span>
                      {selectedPlatforms.size === 0
                        ? "Select accounts"
                        : (allPlatformsSelected
                            ? `All accounts (${availablePlatforms.length})`
                            : `${selectedPlatforms.size} account${selectedPlatforms.size === 1 ? "" : "s"}`)}
                    </span>
                    <span style={{ color: "var(--fg-dim)" }}>{accountsOpen ? "▴" : "▾"}</span>
                  </button>
                  {accountsOpen && (
                    <div
                      style={{
                        position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 1200,
                        minWidth: 260, maxHeight: 320, overflowY: "auto",
                        background: "var(--bg, #0c111a)", border: "1px solid var(--border, #2a3342)",
                        borderRadius: 10, boxShadow: "0 16px 48px rgba(0,0,0,0.5)", padding: 6,
                      }}
                    >
                      {/* Select all accounts */}
                      <label
                        style={{
                          display: "flex", alignItems: "center", gap: 9, padding: "8px 10px",
                          borderBottom: "1px solid var(--border, #222b38)", cursor: "pointer",
                          fontSize: 12, color: "#eef3fb", fontWeight: 600,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={allPlatformsSelected}
                          ref={el => { if (el) el.indeterminate = selectedPlatforms.size > 0 && !allPlatformsSelected; }}
                          onChange={toggleAllPlatforms}
                        />
                        Select all accounts
                      </label>
                      {/* Per-account ticks */}
                      {availablePlatforms.map(p => (
                        <label
                          key={p.key}
                          style={{
                            display: "flex", alignItems: "center", gap: 9, padding: "7px 10px",
                            cursor: "pointer", fontSize: 12, color: "#eef3fb", borderRadius: 6,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedPlatforms.has(p.key)}
                            onChange={() => togglePlatform(p.key)}
                          />
                          <span>{p.label}</span>
                          {p.handle && (
                            <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--c-cyan)" }}>
                              {p.handle}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <span className="mono" style={{ fontSize: 11, color: "var(--fg-dim)" }}
                      title={cfgError ? "Couldn't read planable_config." : "planable_config is absent or has no page ids."}>
                  {planCfg === undefined ? "Loading Planable config…" : "Planable not configured — ask the owner"}
                </span>
              )}
              <DPill
                onClick={openPreview}
                style={{
                  opacity: (configured && selected.size > 0 && selectedPlatforms.size > 0) ? 1 : 0.5,
                  cursor: (configured && selected.size > 0 && selectedPlatforms.size > 0) ? "pointer" : "not-allowed",
                }}
                title={!configured
                  ? "Planable not configured"
                  : (selected.size === 0 ? "Select at least one reel"
                     : (selectedPlatforms.size === 0 ? "Tick at least one account" : "Preview before pushing"))}
              >
                Push to Planable ({selected.size}×{selectedPlatforms.size})
              </DPill>
            </>
          )}
          <DPill primary onClick={handleDownload}
                 style={{ opacity: rows.length ? 1 : 0.5,
                          cursor: rows.length ? "pointer" : "not-allowed" }}>
            Download .csv ({rows.length})
          </DPill>
        </div>
      </div>

      <div className="exp-scroll">
        <table className="exp-table">
          <thead>
            <tr>
              {isOwner && (
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && !allSelected; }}
                    onChange={toggleAll}
                    disabled={rows.length === 0}
                    title="Select all"
                    aria-label="Select all posted reels"
                  />
                </th>
              )}
              <th style={{ width: 90 }}>Reel ID</th>
              <th style={{ width: 240 }}>Title</th>
              <th>Description</th>
              <th style={{ width: 170 }}>Scheduled</th>
              {isOwner && <th style={{ width: 150 }}>Push status</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={colSpan} style={{
                  padding: "32px 18px",
                  color: "var(--fg-dim)",
                  fontFamily: "var(--f-mono)",
                  fontSize: 12,
                }}>
                  No reels in the Posted stage yet. Move a reel to Posted on
                  the Pipeline board to see it here.
                </td>
              </tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="exp-row">
                {isOwner && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                      aria-label={"Select " + r.id}
                    />
                  </td>
                )}
                <td className="mono cyan"
                    onClick={() => onOpen && onOpen({ id: r.id, title: r.title })}
                    style={{ cursor: "pointer" }}>{r.id}</td>
                <td className="serif-i" style={{ color: "#eef3fb" }}>{r.title}</td>
                <td style={{ whiteSpace: "pre-wrap", color: "var(--fg-mute)" }}>
                  {r.description
                    ? <>
                        {r.fromPack && (
                          <span className="mono" style={{ fontSize: 9.5, color: "var(--c-violet, #a78bfa)", marginRight: 6 }}
                                title="From the AI publish pack (detail.aiDraft.seo)">
                            PACK
                          </span>
                        )}
                        {r.description}
                      </>
                    : <span className="dim">— no caption or logline set —</span>}
                </td>
                <td className="mono">
                  {r.scheduled
                    ? <span style={{ color: "var(--c-cyan)" }}>{r.scheduled}</span>
                    : <span className="dim">— not scheduled —</span>}
                </td>
                {isOwner && (
                  <td className="mono" style={{ fontSize: 11 }}>{renderStatus(r.id)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── MANDATORY preview-before-push panel (owner-only) ──────────────── */}
      {isOwner && previewOpen && selectedMetas.length > 0 && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm push to Planable"
          onClick={() => { if (!pushing) setPreviewOpen(false); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(4,7,12,0.72)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1100, padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "var(--bg, #0c111a)", border: "1px solid var(--border, #2a3342)",
              borderRadius: 14, width: "min(820px, 96vw)", maxHeight: "88vh",
              display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            }}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border, #2a3342)" }}>
              <div style={{ fontSize: 16, color: "#eef3fb", fontWeight: 600 }}>
                Confirm push → {selectedMetas.length === 1
                  ? selectedMetas[0].label
                  : `${selectedMetas.length} accounts`}
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--c-cyan)", marginTop: 5, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {selectedMetas.map(m => (
                  <span key={m.key}>{m.label}{m.handle ? " · " + m.handle : ""}</span>
                ))}
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 5 }}>
                {sendable.length} reel{sendable.length === 1 ? "" : "s"}, each ONE grouped post fanned to{" "}
                {selectedMetas.length} account{selectedMetas.length === 1 ? "" : "s"} ·
                {" "}{skipped.length} skipped (past or blank date) ·
                {" "}schedule = each reel's date + {postTime || "09:00"} in {planCfg?.timezone || "UTC"}
              </div>
              {/* UI1: shared posting time applied to every reel's own assigned date. */}
              <label className="mono" style={{
                fontSize: 11, color: "var(--fg-dim)", marginTop: 8,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                Posting time
                <input
                  type="time"
                  value={postTime}
                  onChange={(e) => { postTimeTouched.current = true; setPostTime(e.target.value || "09:00"); }}
                  disabled={pushing}
                  style={{
                    background: "var(--bg-soft, #11161f)", color: "#eef3fb",
                    border: "1px solid var(--border, #2a3342)", borderRadius: 6,
                    padding: "4px 8px", fontSize: 12,
                  }}
                  title="Time of day applied to every selected reel — each reel keeps its own assigned date"
                />
                <span style={{ color: "var(--fg-dim)" }}>· each reel keeps its own date</span>
              </label>
            </div>

            <div style={{ overflowY: "auto", padding: "8px 12px", flex: 1 }}>
              {preview.length === 0 && (
                <div className="mono" style={{ padding: 18, color: "var(--fg-dim)", fontSize: 12 }}>
                  No reels selected.
                </div>
              )}
              {preview.map(p => (
                <div key={p.id}
                     style={{
                       border: "1px solid var(--border, #222b38)", borderRadius: 10,
                       padding: "10px 12px", margin: "8px 0",
                       opacity: p.sendable ? 1 : 0.62,
                       background: p.sendable ? "transparent" : "rgba(245,158,11,0.06)",
                     }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                    <span className="mono cyan" style={{ fontSize: 12 }}>{p.id}</span>
                    {!p.sendable && (
                      <span className="mono" style={{ fontSize: 11, color: "#f59e0b" }}>
                        SKIP · {p.blank ? "no schedule date" : "scheduled in the past"}
                      </span>
                    )}
                  </div>
                  <div className="serif-i" style={{ color: "#eef3fb", fontSize: 13, margin: "2px 0 6px" }}>{p.title}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--fg-mute)", display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <span>→ {selectedMetas.length === 1
                      ? (selectedMetas[0].handle || selectedMetas[0].pageId || selectedMetas[0].label)
                      : `${selectedMetas.length} accounts`}</span>
                    <span style={{ color: p.past ? "#f59e0b" : (p.blank ? "#f87171" : "var(--c-cyan)") }}>
                      {p.scheduleDisplay || "— no date —"}{p.past ? " · PAST" : ""}
                    </span>
                    <span>media: {p.media}</span>
                  </div>
                  <div style={{
                    whiteSpace: "pre-wrap", color: "var(--fg-mute)", fontSize: 12,
                    marginTop: 6, maxHeight: 120, overflowY: "auto",
                  }}>
                    {p.caption || <span className="dim">— no caption or logline set —</span>}
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              padding: "12px 20px", borderTop: "1px solid var(--border, #2a3342)",
              display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center",
            }}>
              <span className="mono" style={{ fontSize: 11, color: "var(--fg-dim)", marginRight: "auto" }}>
                {campaign
                  ? (campaign.id
                      ? <span style={{ color: "#34d399" }}>campaign created{campaign.id ? " · " + campaign.id : ""}</span>
                      : <span style={{ color: "#f59e0b" }}>{campaign.warning || "campaign-less push (no campaign created)"}</span>)
                  : (sendable.length === 0
                      ? "Nothing to send — all selected items are past or have no date."
                      : "Drafts are created as scheduled posts. Nothing posts immediately.")}
              </span>
              <DPill onClick={() => { if (!pushing) setPreviewOpen(false); }}
                     style={{ cursor: pushing ? "not-allowed" : "pointer", opacity: pushing ? 0.5 : 1 }}>
                Cancel
              </DPill>
              <DPill primary onClick={confirmPush}
                     style={{
                       opacity: (pushing || sendable.length === 0) ? 0.5 : 1,
                       cursor: (pushing || sendable.length === 0) ? "not-allowed" : "pointer",
                     }}
                     title={sendable.length === 0 ? "No sendable items" : "Confirm and push"}>
                {pushing ? "Pushing…" : `Confirm push (${sendable.length})`}
              </DPill>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { ExportView };
