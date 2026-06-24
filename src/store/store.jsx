/* =========================================================
   WorkflowStore — single source of truth for reels + tasks +
   reviewer-lane shadow cards, backed by Supabase.

   The provider:
     · hydrates state with one parallel fetch on mount,
     · dispatches reducer actions for local (optimistic) updates,
     · persists each mutation back to Supabase in the background.

   App state stays in camelCase (`blockerRole`, `variantProgress`,
   etc.) for ergonomics; DB columns are snake_case. The mapping
   helpers at the top of this file convert at the IO boundary so
   no consumer has to know about the DB shape.

   Escape hatches:
     · __resetWorkflow()  — clears the legacy localStorage cache
       and reloads the page (which re-fetches from Supabase).
     · `npm run seed`     — resets DB rows to today's static seed.
   ========================================================= */

import React from "react";
import { ROLES, normalizeStage, STAGE_ROLE, stageOwnerPersonId } from "../lib/shared-data.jsx";
import { isKnownPerson, personName } from "../lib/roster.jsx";
import { supabase } from "../lib/supabase-client.js";
import { isDemoMode, setDemoMode } from "../lib/demo-sandbox.jsx";
import { useAuth } from "../auth.jsx";
import { XP_PER_GRADE, scoreForSkillXp, medalForScores,
         SKILL_KEYS, REWARDS, levelForXp, xpForSkillGrades,
         xpForSkillGradesWithDifficulty, isReelLocked } from "../lib/gamify-data.jsx";
import { reelDnaToPipelineFields, platformFromUrl } from "../lib/reel-dna.jsx";

/* ---------- camelCase ↔ snake_case mappers ---------- */
function reelFromDb(row) {
  if (!row) return row;
  const { blocker_role, prev_owner, variant_progress, fb_query,
          attach_url, due_at, stage_entered_at, archived_at,
          display_number, status_color, scheduled_post_date,
          gamify_difficulty,
          created_at, updated_at, stage, ...rest } = row;
  return {
    ...rest,
    stage: normalizeStage(stage),
    blockerRole: blocker_role ?? undefined,
    prevOwner: prev_owner ?? undefined,
    variantProgress: variant_progress ?? undefined,
    fbQuery: fb_query ?? undefined,
    attachUrl: attach_url ?? undefined,
    dueAt: due_at ?? undefined,
    stageEnteredAt: stage_entered_at ?? undefined,
    archivedAt: archived_at ?? undefined,
    displayNumber: display_number ?? undefined,
    statusColor: status_color ?? undefined,
    scheduledPostDate: scheduled_post_date ?? undefined,
    gamifyDifficulty: gamify_difficulty ?? {},
    // Planable final-video reference. There is no reels.media_path column —
    // it lives inside the `detail` jsonb — so re-surface it as a top-level
    // field on read, the shape detail.jsx reads (stored?.mediaPath) and the
    // planable-push server reads (suggest.js item.mediaPath).
    mediaPath: rest.detail?.mediaPath ?? undefined,
    mediaTarget: rest.detail?.mediaTarget ?? undefined,
  };
}
function reelToDb(reel) {
  // Only includes fields that exist in public.reels — anything
  // foreign (e.g. ephemeral _idx) is dropped.
  const { blockerRole, prevOwner, variantProgress, fbQuery, attachUrl,
          dueAt, stageEnteredAt, displayNumber, statusColor, scheduledPostDate,
          gamifyDifficulty,
          lane, owner, stage, state, age, due, fb, refs,
          blocker, next, downstream, grouping, note, foot,
          tone, links, status, logline, script, vo, audio, inspo, plan,
          detail, skill_tags, series, title, id } = reel;
  const out = { id, title, stage, owner, lane, state, age, due,
    fb, refs, blocker, next, downstream, grouping, note, foot,
    tone, links, status, logline, script, vo, audio, inspo, plan, detail,
    series: series ?? null,
    skill_tags: skill_tags ?? [],
    gamify_difficulty: gamifyDifficulty ?? {},
    blocker_role: blockerRole ?? null,
    prev_owner: prevOwner ?? null,
    variant_progress: variantProgress ?? null,
    fb_query: fbQuery ?? null,
    attach_url: attachUrl ?? null,
    due_at: dueAt ?? null,
    stage_entered_at: stageEnteredAt ?? null,
    display_number: displayNumber ?? null,
    status_color: statusColor ?? null,
    scheduled_post_date: scheduledPostDate ?? null };
  return out;
}
function cardFromDb(row) {
  if (!row) return row;
  const { parent_id, created_at, updated_at, stage, ...rest } = row;
  return { ...rest, stage: normalizeStage(stage), parentId: parent_id ?? undefined };
}
function cardToDb(card) {
  const { parentId, id, title, stage, lane, owner, state, note,
          foot, tone, status } = card;
  return { id, title, stage, lane, owner, state, note, foot,
    tone, status, parent_id: parentId ?? null };
}
function taskFromDb(row) {
  if (!row) return row;
  const { from_person, to_person, reel_id, due_at, created_at, updated_at, ...rest } = row;
  return { ...rest, from: from_person, to: to_person, reel: reel_id, dueAt: due_at ?? undefined };
}
function taskToDb(task) {
  const { from, to, reel, dueAt, id, type, instruction, due, state, ref } = task;
  return { id, type, instruction, due, state, ref,
    from_person: from ?? null, to_person: to ?? null,
    reel_id: reel ?? null,
    due_at: dueAt ?? null };
}
function dailyTaskFromDb(row) {
  if (!row) return row;
  const { assigned_to, created_by, task_text, task_date, completed_at,
          sort_order, created_at, updated_at, ...rest } = row;
  return {
    ...rest,
    assignedTo: assigned_to ?? undefined,
    createdBy: created_by ?? undefined,
    taskText: task_text ?? undefined,
    taskDate: task_date ?? undefined,
    completedAt: completed_at ?? undefined,
    sortOrder: sort_order ?? undefined,
    // Keep created_at: the My Work task list sorts on it (my-work.jsx). Dropping
    // it (it's destructured out above) made every hydrated/realtime row sort as
    // "" and land in an unpredictable spot.
    created_at: created_at ?? undefined,
    notes: rest.notes ?? undefined,
  };
}

// Backward-compat read for the gamify_hidden_subskills app_settings value.
// New shape: { map: { [reelId]: string[] } }. Legacy shape: { keys: string[] }
// (a flat global array) — bucket it under a reserved sentinel reel id so those
// rows stay hidden until restored. Anything else -> empty map.
function normalizeHiddenSubskills(value) {
  if (value && typeof value.map === "object" && value.map !== null && !Array.isArray(value.map)) return value.map;
  if (Array.isArray(value?.keys)) return { __legacy_global__: value.keys };
  return {};
}

function reelDnaFromDb(row) {
  if (!row) return row;
  const { reel_url, genes_of_interest, quick_notes, captured_by,
          external_ref, reel_id, archived_at, deleted_at, location,
          created_at, updated_at,
          media_status, source_url_resolved, media_error, analyzed_at,
          asset_manifest, pacing, row_color,
          ...rest } = row;
  // format / narrative / progress / favorite are same-name (snake==camel) → pass
  // through ...rest. row_color is the only camel↔snake remap here.
  return {
    ...rest,
    reelUrl: reel_url,
    rowColor: row_color ?? undefined,
    genesOfInterest: genes_of_interest ?? [],
    quickNotes: quick_notes ?? undefined,
    capturedBy: captured_by ?? undefined,
    externalRef: external_ref ?? undefined,
    reelId: reel_id ?? undefined,
    archivedAt: archived_at ?? undefined,
    deletedAt: deleted_at ?? undefined,
    location: location ?? undefined,
    createdAt: created_at ?? undefined,
    updatedAt: updated_at ?? undefined,
    // Reel DNA longform (Phase 0) — C1 columns
    mediaStatus: media_status ?? undefined,
    sourceUrlResolved: source_url_resolved ?? undefined,
    mediaError: media_error ?? undefined,
    analyzedAt: analyzed_at ?? undefined,
    // Reel DNA Phase 1 — downloadable asset layers (H3) + cut-pacing (H4).
    // asset_manifest → assetManifest is a real camel↔snake remap; `pacing` is
    // same-name but was destructured above (so it would NOT survive ...rest) →
    // re-add it explicitly here.
    assetManifest: asset_manifest ?? undefined,
    pacing: pacing ?? undefined,
  };
}
function reelDnaToDb(item) {
  // Only columns that exist in public.reel_dna; the per-gene jsonb fields
  // (music/hook/font/story/sfx) pass through untouched.
  const { reelUrl, genesOfInterest, quickNotes, capturedBy, externalRef,
          reelId, archivedAt, deletedAt, location, id, platform, status, source,
          music, hook, font, story, sfx, contentType,
          format, mediaStatus, sourceUrlResolved, narrative, progress,
          mediaError, analyzedAt, assetManifest, pacing, timeline,
          rowColor, favorite } = item;
  const out = { id, platform, status, source, music, hook, font, story, sfx,
    reel_url: reelUrl,
    genes_of_interest: genesOfInterest ?? [],
    quick_notes: quickNotes ?? null,
    captured_by: capturedBy ?? null,
    external_ref: externalRef ?? null,
    reel_id: reelId ?? null,
    archived_at: archivedAt ?? null,
    deleted_at: deletedAt ?? null,
    location: location ?? null,
    content_type: contentType ?? null };
  // Reel DNA longform (Phase 0) — C1 columns. Only emit a key when present so
  // an insert from the existing capture form keeps the DB defaults
  // (format='short', media_status='idle') instead of writing null over them.
  // format / narrative / progress are same-name; narrative & progress are jsonb
  // passed through untouched.
  if (format !== undefined)            out.format = format;
  if (mediaStatus !== undefined)       out.media_status = mediaStatus;
  if (sourceUrlResolved !== undefined) out.source_url_resolved = sourceUrlResolved;
  if (narrative !== undefined)         out.narrative = narrative;
  if (progress !== undefined)          out.progress = progress;
  if (mediaError !== undefined)        out.media_error = mediaError;
  if (analyzedAt !== undefined)        out.analyzed_at = analyzedAt;
  // Reel DNA Phase 1 — asset_manifest (H3) + pacing (H4) jsonb. Conditional-emit:
  // the worker writes these post-analysis; a capture-form insert never carries
  // them, so we keep the NULL DB defaults instead of overwriting with null.
  if (assetManifest !== undefined)     out.asset_manifest = assetManifest;
  if (pacing !== undefined)            out.pacing = pacing;
  if (timeline !== undefined)          out.timeline = timeline;
  // Spreadsheet row tagging (migration 0089): color tag + favorite star.
  // Conditional-emit so a capture-form insert keeps the DB defaults
  // (row_color NULL, favorite false) instead of writing them explicitly.
  if (rowColor !== undefined)          out.row_color = rowColor;
  if (favorite !== undefined)          out.favorite = favorite;
  return out;
}

// Thumbnail DNA — separate table from reel_dna, manual YouTube-thumbnail capture.
// The six design genes (color/typography/face/layout/mood/subject) are PLAIN
// TEXT columns (pass-through both directions, not jsonb).
function thumbnailFromDb(row) {
  if (!row) return row;
  const { video_url, video_id, thumbnail_url, genes_of_interest, quick_notes,
          captured_by, archived_at, deleted_at, created_at, updated_at,
          ...rest } = row;
  return {
    ...rest,
    videoUrl: video_url,
    videoId: video_id ?? undefined,
    thumbnailUrl: thumbnail_url ?? undefined,
    genesOfInterest: genes_of_interest ?? [],
    quickNotes: quick_notes ?? undefined,
    capturedBy: captured_by ?? undefined,
    archivedAt: archived_at ?? undefined,
    deletedAt: deleted_at ?? undefined,
    createdAt: created_at ?? undefined,
    updatedAt: updated_at ?? undefined,
  };
}
function thumbnailToDb(item) {
  // Only columns that exist in public.thumbnail_dna; the six gene text fields
  // (color/typography/face/layout/mood/subject) pass through untouched via rest.
  const { videoUrl, videoId, thumbnailUrl, genesOfInterest, quickNotes,
          capturedBy, archivedAt, deletedAt, id, title, channel, platform,
          status, source, color, typography, face, layout, mood, subject } = item;
  return {
    id, title: title ?? null, channel: channel ?? null,
    platform: platform || "yt", status, source,
    color: color ?? null, typography: typography ?? null, face: face ?? null,
    layout: layout ?? null, mood: mood ?? null, subject: subject ?? null,
    video_url: videoUrl,
    video_id: videoId ?? null,
    thumbnail_url: thumbnailUrl ?? null,
    genes_of_interest: genesOfInterest ?? [],
    quick_notes: quickNotes ?? null,
    captured_by: capturedBy ?? null,
    archived_at: archivedAt ?? null,
    deleted_at: deletedAt ?? null,
  };
}

/* ---- Epidemic Sound music_tracks (migration 0092) ----------------------
   mapTrack is the FROZEN cross-team shape TEAM_API returns and the UI/store
   pass around:
     { id, title, artist, bpm, lengthSec, moods, genres, coverUrl, previewUrl }
   musicTrackFromDb maps a music_tracks row → mapTrack (preferring the stored
   `raw` blob, which IS the untouched mapTrack, then falling back to columns so
   an older/raw-less row still resolves). rowFromMapTrack maps a mapTrack →
   music_tracks row for the idempotent cache upsert. */
function musicTrackFromDb(row) {
  if (!row) return row;
  // `raw` is the untouched mapTrack we cached; prefer it for forward-compat.
  if (row.raw && typeof row.raw === "object") {
    const r = row.raw;
    return {
      id: String(row.id ?? r.id ?? ""),
      title: r.title ?? row.title ?? "",
      artist: r.artist ?? row.artist ?? "",
      bpm: r.bpm ?? (row.bpm ?? null),
      lengthSec: r.lengthSec ?? (row.length_sec ?? null),
      moods: r.moods ?? row.moods ?? [],
      genres: r.genres ?? row.genres ?? [],
      coverUrl: r.coverUrl ?? row.cover_url ?? null,
      previewUrl: r.previewUrl ?? row.preview_url ?? null,
    };
  }
  return {
    id: String(row.id ?? ""),
    title: row.title ?? "",
    artist: row.artist ?? "",
    bpm: row.bpm ?? null,
    lengthSec: row.length_sec ?? null,
    moods: row.moods ?? [],
    genres: row.genres ?? [],
    coverUrl: row.cover_url ?? null,
    previewUrl: row.preview_url ?? null,
  };
}
function rowFromMapTrack(track) {
  const t = track || {};
  return {
    id: String(t.id ?? ""),
    title: t.title ?? null,
    artist: t.artist ?? null,
    bpm: t.bpm ?? null,
    length_sec: t.lengthSec ?? null,
    cover_url: t.coverUrl ?? null,
    preview_url: t.previewUrl ?? null,
    moods: Array.isArray(t.moods) ? t.moods : [],
    genres: Array.isArray(t.genres) ? t.genres : [],
    raw: t,            // untouched mapTrack for forward-compat
  };
}

/* Music library (favorites + playlists, migration 0093) — per-user, camelCased. */
function musicFavoriteFromDb(row) {
  if (!row) return row;
  return { trackId: String(row.track_id), personId: row.person_id, createdAt: row.created_at };
}
function musicPlaylistFromDb(row) {
  if (!row) return row;
  return { id: row.id, personId: row.person_id, name: row.name ?? "Untitled playlist", createdAt: row.created_at, updatedAt: row.updated_at };
}
function musicPlaylistTrackFromDb(row) {
  if (!row) return row;
  return { playlistId: row.playlist_id, trackId: String(row.track_id), position: row.position ?? 0, addedAt: row.added_at };
}

/* ---- OpenCut collaborative editor: edit_projects + editor_locks (migration 0094) ----
   edit_projects is the v2 project gallery row (one per reel/freestanding edit).
   timeline_json is the v2 doc {version,output,duration,tracks[]}. reel_id is TEXT
   (matches reels.id — see 0094 CONTRACT DEVIATION note), reel_dna_id is uuid.
   editor_locks is the project-level single-writer sentinel; track_id is ALWAYS
   '__project__' (no per-track locks). We key the store slice by project_id since
   only the project-level lock matters here. */
function editProjectFromDb(row) {
  if (!row) return row;
  const { reel_dna_id, reel_id, created_by, timeline_json, export_url,
          thumbnail_url, last_editor, locked_by, locked_until,
          created_at, updated_at, ...rest } = row;
  // rest carries id, title, version, status through untouched (same-name).
  return {
    ...rest,
    reelDnaId: reel_dna_id ?? undefined,
    reelId: reel_id ?? undefined,
    createdBy: created_by ?? undefined,
    timelineJson: timeline_json ?? undefined,
    exportUrl: export_url ?? undefined,
    thumbnailUrl: thumbnail_url ?? undefined,
    lastEditor: last_editor ?? undefined,
    lockedBy: locked_by ?? undefined,
    lockedUntil: locked_until ?? undefined,
    createdAt: created_at ?? undefined,
    updatedAt: updated_at ?? undefined,
  };
}
function editorLockFromDb(row) {
  if (!row) return row;
  const { project_id, track_id, locked_by, locked_at, expires_at, heartbeat_at, ...rest } = row;
  return {
    ...rest,
    projectId: project_id,
    trackId: track_id ?? "__project__",
    lockedBy: locked_by ?? undefined,
    lockedAt: locked_at ?? undefined,
    expiresAt: expires_at ?? undefined,
    heartbeatAt: heartbeat_at ?? undefined,
  };
}

/* Empty v2 timeline doc — the default a fresh project starts from. Matches the
   0094 backfill shape (one 'video' track) without any clips. */
function emptyEditTimelineV2() {
  return {
    version: 2,
    output: { width: 1080, height: 1920, fps: 30, crf: 23 },
    duration: 0,
    tracks: [{ id: "video_0", type: "video", name: "Main video", clips: [] }],
  };
}

function monitorEventFromDb(row) {
  if (!row) return row;
  const { source_type, external_id, source_name, source_url,
          published_at, created_by, created_at, updated_at,
          event_type,
          ...rest } = row;
  return {
    ...rest,
    sourceType: source_type ?? undefined,
    externalId: external_id ?? undefined,
    sourceName: source_name ?? undefined,
    sourceUrl: source_url ?? undefined,
    publishedAt: published_at ?? undefined,
    createdBy: created_by ?? undefined,
    createdAt: created_at ?? undefined,
    updatedAt: updated_at ?? undefined,
    // Geo (source_type='geo') columns. eventType is the only multi-word one
    // needing a remap; lat/lng/metric/magnitude/place/confidence/fatalities
    // are single-word and ride through `...rest` untouched.
    eventType: event_type ?? undefined,
    // Defaults on read — schema lock keeps status as 'new'|'read'|'archived'.
    tags: rest.tags ?? [],
    starred: rest.starred ?? false,
  };
}

function igSyncRunFromDb(row) {
  if (!row) return row;
  const { started_at, finished_at, messages_seen, shares_seen, dedupe_skip,
          skipped_no_link, multi_extra, parse_fail, insert_error, graph_errors,
          mismatch_count, created_at, ...rest } = row;
  return {
    ...rest,   // carries id, trigger, conversations, inserted, reconciled, note through untouched
    startedAt: started_at ?? undefined,
    finishedAt: finished_at ?? undefined,
    messagesSeen: messages_seen ?? undefined,
    sharesSeen: shares_seen ?? undefined,
    dedupeSkip: dedupe_skip ?? undefined,
    skippedNoLink: skipped_no_link ?? undefined,
    multiExtra: multi_extra ?? undefined,
    parseFail: parse_fail ?? undefined,
    insertError: insert_error ?? undefined,
    graphErrors: graph_errors ?? undefined,
    mismatchCount: mismatch_count ?? undefined,
    createdAt: created_at ?? undefined,
  };
}

function igIngestLogFromDb(row) {
  if (!row) return row;
  const { run_id, conversation_id, message_id, issue_type, occurred_at, ...rest } = row;
  return {
    ...rest,   // carries id, detail through untouched
    runId: run_id ?? undefined,
    conversationId: conversation_id ?? undefined,
    messageId: message_id ?? undefined,
    issueType: issue_type ?? undefined,
    occurredAt: occurred_at ?? undefined,
  };
}

function monitorEventToDb(item) {
  // Only columns that exist in public.monitor_events. Drops undefined keys so
  // partial updates don't overwrite columns the caller didn't mean to touch.
  const { id, sourceType, externalId, category, platform, severity, status,
          starred, title, summary, sourceName, sourceUrl, region, tags,
          publishedAt, createdBy,
          eventType, metric, lat, lng, magnitude, place, confidence, fatalities } = item;
  const out = {};
  if (id !== undefined)          out.id = id;
  if (sourceType !== undefined)  out.source_type = sourceType;
  if (externalId !== undefined)  out.external_id = externalId;
  if (category !== undefined)    out.category = category;
  if (platform !== undefined)    out.platform = platform;
  if (severity !== undefined)    out.severity = severity;
  if (status !== undefined)      out.status = status;
  if (starred !== undefined)     out.starred = starred;
  if (title !== undefined)       out.title = title;
  if (summary !== undefined)     out.summary = summary;
  if (sourceName !== undefined)  out.source_name = sourceName;
  if (sourceUrl !== undefined)   out.source_url = sourceUrl;
  if (region !== undefined)      out.region = region;
  if (tags !== undefined)        out.tags = tags;
  if (publishedAt !== undefined) out.published_at = publishedAt;
  if (createdBy !== undefined)   out.created_by = createdBy;
  // Geo (source_type='geo') columns. event_type is the remapped key; the rest
  // are single-word columns written as-is. lng (NOT lon) is the frozen lon name.
  if (eventType !== undefined)   out.event_type = eventType;
  if (metric !== undefined)      out.metric = metric;
  if (lat !== undefined)         out.lat = lat;
  if (lng !== undefined)         out.lng = lng;
  if (magnitude !== undefined)   out.magnitude = magnitude;
  if (place !== undefined)       out.place = place;
  if (confidence !== undefined)  out.confidence = confidence;
  if (fatalities !== undefined)  out.fatalities = fatalities;
  return out;
}

/* ---------- monitor_event_links (event → reel/review_card/location) ---------- */
function eventLinkFromDb(row) {
  if (!row) return row;
  const { event_id, target_type, target_id, created_by, created_at, ...rest } = row;
  return {
    ...rest,
    eventId: event_id,
    targetType: target_type ?? undefined,
    targetId: target_id ?? undefined,
    createdBy: created_by ?? undefined,
    createdAt: created_at ?? undefined,
  };
}
function eventLinkToDb(item) {
  // Only columns that exist in public.monitor_event_links. Drops undefined keys.
  const { id, eventId, targetType, targetId, label, createdBy } = item;
  const out = {};
  if (id !== undefined)         out.id = id;
  if (eventId !== undefined)    out.event_id = eventId;
  if (targetType !== undefined) out.target_type = targetType;
  if (targetId !== undefined)   out.target_id = targetId;
  if (label !== undefined)      out.label = label;
  if (createdBy !== undefined)  out.created_by = createdBy;
  return out;
}

/* reel_dna_assets — polymorphic join from a reel_dna card (uuid) to any of
   four asset types (footage/location/thumbnail/news). asset_id is TEXT in the
   DB (mixed text/uuid source PKs are coerced to text on write). */
function reelDnaAssetFromDb(row) {
  if (!row) return row;
  const { reel_dna_id, asset_type, asset_id, label, created_by, created_at, ...rest } = row;
  return {
    ...rest,
    reelDnaId: reel_dna_id,
    assetType: asset_type ?? undefined,
    assetId: asset_id ?? undefined,
    label: label ?? undefined,
    createdBy: created_by ?? undefined,
    createdAt: created_at ?? undefined,
  };
}

/* PURE resolver (no hooks, importable) — joins the reel_dna_assets link rows
   for one card to their LIVE source rows, bucketed by type. Locations live in
   a SEPARATE provider (useLocations()) the store can't read, so every source
   array is passed in by the caller. Any link whose source row no longer
   resolves is SKIPPED (orphan-safe). */
export function resolveReelDnaAssets(reelDnaId, sources = {}) {
  const {
    reelDnaAssets = [],
    attachedFootage = [],
    locations = [],
    thumbnailDna = [],
    monitorEvents = [],
    musicTracks = [],
  } = sources;

  const out = { footage: [], locations: [], thumbnails: [], news: [], music: [] };
  if (!reelDnaId) return out;

  // Index each source by string id once (asset_id is text in the DB).
  const footageById = new Map();
  for (const f of attachedFootage) if (f && f.id != null) footageById.set(String(f.id), f);
  const locById = new Map();
  for (const l of locations) if (l && l.id != null) locById.set(String(l.id), l);
  const thumbById = new Map();
  for (const t of thumbnailDna) if (t && t.id != null) thumbById.set(String(t.id), t);
  const newsById = new Map();
  for (const n of monitorEvents) if (n && n.id != null) newsById.set(String(n.id), n);
  const musicById = new Map();
  for (const m of musicTracks) if (m && m.id != null) musicById.set(String(m.id), m);

  for (const link of reelDnaAssets) {
    if (!link || link.reelDnaId !== reelDnaId) continue;
    const key = link.assetId == null ? "" : String(link.assetId);
    switch (link.assetType) {
      case "footage": {
        const row = footageById.get(key);
        if (row) out.footage.push(row);
        break;
      }
      case "location": {
        const row = locById.get(key);
        if (row) out.locations.push(row);
        break;
      }
      case "thumbnail": {
        const row = thumbById.get(key);
        if (row) out.thumbnails.push(row);
        break;
      }
      case "news": {
        const row = newsById.get(key);
        if (row) out.news.push(row);
        break;
      }
      case "music": {
        const row = musicById.get(key);
        if (row) out.music.push(row);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/* PURE counts (no hooks, importable) — derived from the RESOLVED lists so a
   badge can never disagree with the expanded sections or count orphan rows. */
export function assetCountsForReelDna(reelDnaId, sources = {}) {
  const r = resolveReelDnaAssets(reelDnaId, sources);
  const footage = r.footage.length;
  const locations = r.locations.length;
  const thumbnails = r.thumbnails.length;
  const news = r.news.length;
  const music = r.music.length;
  return { footage, locations, thumbnails, news, music, total: footage + locations + thumbnails + news + music };
}

function monitorSourceFromDb(row) {
  if (!row) return row;
  const { severity_default, last_fetched_at, last_status, item_count,
          created_by, created_at, updated_at, ...rest } = row;
  return {
    ...rest,
    severityDefault: severity_default ?? "info",
    lastFetchedAt: last_fetched_at ?? undefined,
    lastStatus: last_status ?? undefined,
    itemCount: item_count ?? 0,
    createdBy: created_by ?? undefined,
    createdAt: created_at ?? undefined,
    updatedAt: updated_at ?? undefined,
    enabled: rest.enabled ?? true,
  };
}
function monitorSourceToDb(item) {
  // Only columns that exist in public.monitor_sources. Drops undefined keys so
  // partial updates don't overwrite columns the caller didn't mean to touch.
  const { id, name, url, category, platform, region, severityDefault,
          enabled, createdBy } = item;
  const out = {};
  if (id !== undefined)              out.id = id;
  if (name !== undefined)            out.name = name;
  if (url !== undefined)             out.url = url;
  if (category !== undefined)        out.category = category;
  if (platform !== undefined)        out.platform = platform;
  if (region !== undefined)          out.region = region;
  if (severityDefault !== undefined) out.severity_default = severityDefault;
  if (enabled !== undefined)         out.enabled = enabled;
  if (createdBy !== undefined)       out.created_by = createdBy;
  return out;
}

function reelChatRefsFromDb(row) {
  if (!row) return row;
  const { reel_id, message_url, created_by, created_at, ...rest } = row;
  return {
    ...rest,
    reelId: reel_id,
    messageUrl: message_url ?? undefined,
    createdBy: created_by ?? undefined,
    createdAt: created_at ?? undefined,
  };
}

function gamifyProgressFromDb(row) {
  if (!row) return row;
  const { person_id, total_xp, skill_scores, unlocked_rewards,
          created_at, updated_at, ...rest } = row;
  return {
    ...rest,
    personId: person_id,
    totalXp: total_xp ?? 0,
    skillScores: skill_scores ?? {},
    unlockedRewards: unlocked_rewards ?? [],
    updatedAt: updated_at ?? undefined,
  };
}

function gamifyRubricFromDb(row) {
  if (!row) return row;
  const { reel_id, person_id, skill_key, editor_checked,
          reviewer_grade, reviewer_grades, xp_awarded, graded_at,
          created_at, updated_at, ...rest } = row;
  return {
    ...rest,
    reelId: reel_id,
    personId: person_id,
    skillKey: skill_key,
    editorChecked: editor_checked ?? [],
    // Per-sub-skill grade map { subId: grade }. Falls back to wrapping a
    // legacy single grade if an old row still carries one.
    reviewerGrades: reviewer_grades ?? {},
    xpAwarded: xp_awarded ?? 0,
    gradedAt: graded_at ?? undefined,
    updatedAt: updated_at ?? undefined,
  };
}

/* Build the next revisionHistory array. Folds the older single-field
   shape (`revisionNote` / `revisionAt` / `revisionBy`) into the head
   of the array on first append so nothing is lost on migration. */
function appendRevisionEntry(detail, entry) {
  const existing = Array.isArray(detail?.revisionHistory) ? detail.revisionHistory : [];
  const legacy = !existing.length && detail?.revisionNote
    ? [{ action: "sent_back", ts: detail.revisionAt || null,
         by: detail.revisionBy || null, note: detail.revisionNote }]
    : [];
  return [...legacy, ...existing, entry];
}

/* Next sequential REEL id from the current reels list. Format REEL-NNN
   (zero-padded to 3 digits, expands naturally past 999). Shared by every
   create-reel surface (ReelModal, Idea Generator) so the numbering logic
   lives in one place. */
function nextReelId(reels) {
  const nums = (reels || [])
    .map(r => { const m = /^REEL-(\d+)$/.exec(r?.id || ""); return m ? parseInt(m[1], 10) : -1; })
    .filter(n => n >= 0);
  const next = nums.length ? Math.max(...nums) + 1 : 0;
  return "REEL-" + String(next).padStart(3, "0");
}

/* Build a system-authored comment entry. Used on stage transitions
   so the timeline has a paper trail of who got the handoff and
   when. Renders with `system: true` so the UI can style it
   differently from a human comment. */
function buildSystemComment(txt) {
  return {
    id: "c-sys-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    authorId: null,
    who: "Workflow",
    role: "system",
    ts: new Date().toISOString(),
    txt,
    system: true,
  };
}
function appendComment(detail, entry) {
  const existing = Array.isArray(detail?.comments) ? detail.comments : [];
  return [...existing, entry];
}

/* ---------- Reducer (pure, identical semantics to before) ---------- */
function workflowReducer(state, action) {
  switch (action.type) {

    case "HYDRATE":
      return { ...state, ...action.payload, loaded: true, error: null };

    case "SET_ERROR":
      return { ...state, error: action.error };

    case "MOVE_STAGE": {
      const stamp = action.stageEnteredAt || new Date().toISOString();
      const apply = (r) => {
        if (r.id !== action.id) return r;
        const stageChanged = action.stage !== r.stage;
        const next = { ...r, stage: action.stage };
        if (stageChanged) next.stageEnteredAt = stamp;
        if (action.scheduledPostDate !== undefined) next.scheduledPostDate = action.scheduledPostDate;
        if (action.stage === "review" && r.stage !== "review") {
          next.prevOwner = r.owner;
        }

        /* Owner/lane only changes when the user explicitly drops into a
           different person's row. Dragging within the same row (just
           moving between stage columns) keeps the card with its current
           owner — no automatic handoff by stage role.
           Exception: dropping onto the shared "review" lane assigns to
           the canonical reviewer.

           A stage change with NO explicit lane (list-view / my-work,
           which never pass one) must re-pin the card to its owner's lane.
           The pipeline buckets by `lane || owner`, so a stale lane left
           over from an earlier board placement would otherwise strand the
           card in the wrong row even though its owner is correct. Shadow
           review-lane cards (parentId) keep their fixed lane. */
        if (action.lane !== undefined) next.lane = action.lane;
        else if (!r.parentId) next.lane = next.owner;

        if (action.lane !== undefined && action.lane !== "review" &&
            isKnownPerson(action.lane) && action.lane !== r.owner) {
          next.owner = action.lane;
        } else if (action.lane === "review") {
          const stagePerson = stageOwnerPersonId("review");
          if (stagePerson) next.owner = stagePerson;
        }

        /* On a real stage change, append the prebuilt system
           comment (passed through on `action.systemComment`) for
           the audit trail. Same entry is sent to the DB by
           persistMoveStage so optimistic + echoed states match. */
        if (stageChanged && !r.parentId && action.systemComment) {
          next.detail = {
            ...(r.detail || {}),
            comments: appendComment(r.detail, action.systemComment),
          };
        }
        return next;
      };
      return {
        ...state,
        reels: state.reels.map(apply),
        reviewLaneCards: state.reviewLaneCards.map(apply),
      };
    }

    case "UPDATE_REEL": {
      // Board derives a card's column as `lane || owner`. If the card was ever
      // dragged on the board it got an explicit `lane` saved; without syncing
      // `lane` here, that stale value would pin the card even after an owner
      // change made from list view.
      const effectivePatch = "owner" in action.patch
        ? { ...action.patch, lane: action.patch.owner }
        : action.patch;
      const apply = (r) => r.id === action.id ? { ...r, ...effectivePatch } : r;
      return {
        ...state,
        reels: state.reels.map(apply),
        reviewLaneCards: state.reviewLaneCards.map(apply),
      };
    }

    case "CREATE_REEL":
      return { ...state, reels: [action.reel, ...state.reels] };

    case "DELETE_REEL":
      return {
        ...state,
        reels: state.reels.filter(r => r.id !== action.id),
        reviewLaneCards: state.reviewLaneCards.filter(r =>
          r.id !== action.id && r.parentId !== action.id),
      };

    case "CREATE_TASK":
      return { ...state, tasks: [action.task, ...state.tasks] };

    case "UPDATE_TASK": {
      const apply = (t) => t.id === action.id ? { ...t, ...action.patch } : t;
      return { ...state, tasks: state.tasks.map(apply) };
    }

    case "DELETE_TASK":
      return { ...state, tasks: state.tasks.filter(t => t.id !== action.id) };

    /* Realtime cases — fired by Supabase Postgres-changes echoes.
       UPSERT_* replaces an existing row by id or prepends if new.
       DELETE_*_BY_ID is idempotent on already-removed rows. */
    case "UPSERT_REEL": {
      const exists = state.reels.some(r => r.id === action.reel.id);
      return {
        ...state,
        reels: exists
          ? state.reels.map(r => r.id === action.reel.id ? action.reel : r)
          : [action.reel, ...state.reels],
      };
    }
    case "DELETE_REEL_BY_ID":
      return {
        ...state,
        reels: state.reels.filter(r => r.id !== action.id),
        reviewLaneCards: state.reviewLaneCards.filter(c =>
          c.id !== action.id && c.parentId !== action.id),
      };

    case "UPSERT_CARD": {
      const exists = state.reviewLaneCards.some(c => c.id === action.card.id);
      return {
        ...state,
        reviewLaneCards: exists
          ? state.reviewLaneCards.map(c => c.id === action.card.id ? action.card : c)
          : [action.card, ...state.reviewLaneCards],
      };
    }
    case "DELETE_CARD_BY_ID":
      return { ...state, reviewLaneCards: state.reviewLaneCards.filter(c => c.id !== action.id) };

    case "UPSERT_TASK": {
      const exists = state.tasks.some(t => t.id === action.task.id);
      return {
        ...state,
        tasks: exists
          ? state.tasks.map(t => t.id === action.task.id ? action.task : t)
          : [action.task, ...state.tasks],
      };
    }
    case "DELETE_TASK_BY_ID":
      return { ...state, tasks: state.tasks.filter(t => t.id !== action.id) };

    case "ADD_ATTACHED_FOOTAGE":
      return { ...state, attachedFootage: [action.item, ...state.attachedFootage] };

    case "REMOVE_ATTACHED_FOOTAGE":
      return { ...state, attachedFootage: state.attachedFootage.filter(f => f.id !== action.id) };

    case "UPSERT_ATTACHED_FOOTAGE": {
      const exists = state.attachedFootage.some(f => f.id === action.item.id);
      return {
        ...state,
        attachedFootage: exists
          ? state.attachedFootage.map(f => f.id === action.item.id ? action.item : f)
          : [action.item, ...state.attachedFootage],
      };
    }

    case "DELETE_ATTACHED_FOOTAGE_BY_ID":
      return { ...state, attachedFootage: state.attachedFootage.filter(f => f.id !== action.id) };

    /* Full replace — background-hydration load of the recent window. */
    case "SET_ATTACHED_FOOTAGE":
      return { ...state, attachedFootage: action.items };

    /* loadMore page-in: append older rows, de-duped by id (a window row may
       overlap the page boundary). */
    case "APPEND_ATTACHED_FOOTAGE": {
      const have = new Set(state.attachedFootage.map(f => f.id));
      return { ...state, attachedFootage: [...state.attachedFootage, ...action.items.filter(f => !have.has(f.id))] };
    }

    case "SET_FOOTAGE_TAGS": {
      // Vision tags describe the clip, not one attachment — apply to every row
      // sharing the same footage_file_id so the library (grouped by clip) and
      // each reel that uses it all reflect the tags.
      return {
        ...state,
        attachedFootage: state.attachedFootage.map(f =>
          f.footage_file_id === action.footageFileId ? { ...f, vision_tags: action.tags } : f),
      };
    }

    /* Reel DNA — same optimistic + realtime shape as reels. */
    case "CREATE_REEL_DNA":
      return { ...state, reelDna: [action.item, ...state.reelDna] };

    case "UPDATE_REEL_DNA": {
      const apply = (d) => d.id === action.id ? { ...d, ...action.patch } : d;
      return { ...state, reelDna: state.reelDna.map(apply) };
    }

    case "UPSERT_REEL_DNA": {
      const exists = state.reelDna.some(d => d.id === action.item.id);
      return {
        ...state,
        reelDna: exists
          ? state.reelDna.map(d => d.id === action.item.id ? action.item : d)
          : [action.item, ...state.reelDna],
      };
    }

    case "DELETE_REEL_DNA_BY_ID":
      return { ...state, reelDna: state.reelDna.filter(d => d.id !== action.id) };

    case "SET_REEL_DNA":   // full replace — used by the Refresh button's reload
      return { ...state, reelDna: action.items };

    /* loadMore page-in: append older rows, de-duped by id. */
    case "APPEND_REEL_DNA": {
      const have = new Set(state.reelDna.map(d => d.id));
      return { ...state, reelDna: [...state.reelDna, ...action.items.filter(d => !have.has(d.id))] };
    }

    /* Thumbnail DNA — separate table, same optimistic + realtime shape as reel_dna. */
    case "CREATE_THUMBNAIL_DNA":
      return { ...state, thumbnailDna: [action.item, ...state.thumbnailDna] };

    case "UPDATE_THUMBNAIL_DNA": {
      const apply = (d) => d.id === action.id ? { ...d, ...action.patch } : d;
      return { ...state, thumbnailDna: state.thumbnailDna.map(apply) };
    }

    case "UPSERT_THUMBNAIL_DNA": {
      const exists = state.thumbnailDna.some(d => d.id === action.item.id);
      return {
        ...state,
        thumbnailDna: exists
          ? state.thumbnailDna.map(d => d.id === action.item.id ? action.item : d)
          : [action.item, ...state.thumbnailDna],
      };
    }

    case "DELETE_THUMBNAIL_DNA_BY_ID":
      return { ...state, thumbnailDna: state.thumbnailDna.filter(d => d.id !== action.id) };

    case "SET_THUMBNAIL_DNA":   // full replace — used by reloadThumbnailDna
      return { ...state, thumbnailDna: action.items };

    /* loadMore page-in: append older rows, de-duped by id. */
    case "APPEND_THUMBNAIL_DNA": {
      const have = new Set(state.thumbnailDna.map(d => d.id));
      return { ...state, thumbnailDna: [...state.thumbnailDna, ...action.items.filter(d => !have.has(d.id))] };
    }

    /* Music tracks (Epidemic Sound cache, migration 0092) — mirrors
       thumbnailDna's hydrate-replace + realtime-upsert shape. */
    case "SET_MUSIC_TRACKS":   // full replace — used by the hydrate fetch
      return { ...state, musicTracks: action.items };

    case "UPSERT_MUSIC_TRACK": {
      const exists = state.musicTracks.some(d => d.id === action.item.id);
      return {
        ...state,
        musicTracks: exists
          ? state.musicTracks.map(d => d.id === action.item.id ? action.item : d)
          : [action.item, ...state.musicTracks],
      };
    }

    case "DELETE_MUSIC_TRACK_BY_ID":
      return { ...state, musicTracks: state.musicTracks.filter(d => d.id !== action.id) };

    /* Music library — favorites + playlists (migration 0093), per-user. */
    case "SET_MUSIC_FAVORITES":
      return { ...state, musicFavorites: action.items };
    case "UPSERT_MUSIC_FAVORITE": {
      const exists = state.musicFavorites.some(f => f.trackId === action.item.trackId);
      return exists ? state : { ...state, musicFavorites: [action.item, ...state.musicFavorites] };
    }
    case "DELETE_MUSIC_FAVORITE":
      return { ...state, musicFavorites: state.musicFavorites.filter(f => f.trackId !== action.trackId) };

    case "SET_MUSIC_PLAYLISTS":
      return { ...state, musicPlaylists: action.items };
    case "UPSERT_MUSIC_PLAYLIST": {
      const exists = state.musicPlaylists.some(p => p.id === action.item.id);
      return {
        ...state,
        musicPlaylists: exists
          ? state.musicPlaylists.map(p => p.id === action.item.id ? { ...p, ...action.item } : p)
          : [action.item, ...state.musicPlaylists],
      };
    }
    case "DELETE_MUSIC_PLAYLIST_BY_ID":
      return {
        ...state,
        musicPlaylists: state.musicPlaylists.filter(p => p.id !== action.id),
        // cascade locally so a deleted playlist's tracks vanish immediately
        musicPlaylistTracks: state.musicPlaylistTracks.filter(t => t.playlistId !== action.id),
      };

    case "SET_MUSIC_PLAYLIST_TRACKS":
      return { ...state, musicPlaylistTracks: action.items };
    case "UPSERT_MUSIC_PLAYLIST_TRACK": {
      const exists = state.musicPlaylistTracks.some(
        t => t.playlistId === action.item.playlistId && t.trackId === action.item.trackId);
      return exists ? state : { ...state, musicPlaylistTracks: [...state.musicPlaylistTracks, action.item] };
    }
    case "DELETE_MUSIC_PLAYLIST_TRACK":
      return {
        ...state,
        musicPlaylistTracks: state.musicPlaylistTracks.filter(
          t => !(t.playlistId === action.playlistId && t.trackId === action.trackId)),
      };

    /* OpenCut edit_projects (migration 0094) — same optimistic + realtime shape
       as reel_dna. SET_* full-replace on hydrate; UPSERT prepends-or-replaces by
       id (deduping the optimistic insert against its realtime echo). */
    case "SET_EDIT_PROJECTS":
      return { ...state, editProjects: action.items };

    case "UPSERT_EDIT_PROJECT": {
      const exists = state.editProjects.some(p => p.id === action.item.id);
      return {
        ...state,
        editProjects: exists
          ? state.editProjects.map(p => p.id === action.item.id ? { ...p, ...action.item } : p)
          : [action.item, ...state.editProjects],
      };
    }

    case "DELETE_EDIT_PROJECT_BY_ID":
      return { ...state, editProjects: state.editProjects.filter(p => p.id !== action.id) };

    /* editor_locks (migration 0094) — keyed by project_id (track is always
       '__project__'). UPSERT replaces the lock row for a project; DELETE clears
       it. Used for global lock badges on the gallery list. */
    case "SET_EDITOR_LOCKS":
      return { ...state, editorLocks: action.items };

    case "UPSERT_EDITOR_LOCK": {
      const exists = state.editorLocks.some(l => l.projectId === action.item.projectId);
      return {
        ...state,
        editorLocks: exists
          ? state.editorLocks.map(l => l.projectId === action.item.projectId ? action.item : l)
          : [action.item, ...state.editorLocks],
      };
    }

    case "DELETE_EDITOR_LOCK":
      return { ...state, editorLocks: state.editorLocks.filter(l => l.projectId !== action.projectId) };

    /* Pulse Monitor events — same optimistic + realtime shape as reel_dna. */
    case "CREATE_MONITOR_EVENT":
      return { ...state, monitorEvents: [action.item, ...state.monitorEvents] };

    case "UPDATE_MONITOR_EVENT": {
      const apply = (e) => e.id === action.id ? { ...e, ...action.patch } : e;
      return { ...state, monitorEvents: state.monitorEvents.map(apply) };
    }

    case "UPSERT_MONITOR_EVENT": {
      const exists = state.monitorEvents.some(e => e.id === action.item.id);
      return {
        ...state,
        monitorEvents: exists
          ? state.monitorEvents.map(e => e.id === action.item.id ? action.item : e)
          : [action.item, ...state.monitorEvents],
      };
    }

    case "DELETE_MONITOR_EVENT_BY_ID":
      return { ...state, monitorEvents: state.monitorEvents.filter(e => e.id !== action.id) };

    /* Full replace — background-hydration load of the recent (90d) window. */
    case "SET_MONITOR_EVENTS":
      return { ...state, monitorEvents: action.items };

    /* G3 realtime trim: apply a coalesced BURST of monitor_events realtime ops
       (the chattiest poller) in ONE reducer pass / ONE render, preserving
       arrival order. ops = [{ kind:"upsert", item } | { kind:"delete", id }]. */
    case "BATCH_MONITOR_EVENTS": {
      let list = state.monitorEvents;
      for (const op of action.ops) {
        if (op.kind === "delete") {
          list = list.filter(e => e.id !== op.id);
        } else {
          list = list.some(e => e.id === op.item.id)
            ? list.map(e => e.id === op.item.id ? op.item : e)
            : [op.item, ...list];
        }
      }
      return { ...state, monitorEvents: list };
    }

    /* loadMore page-in: append older rows, de-duped by id. */
    case "APPEND_MONITOR_EVENTS": {
      const have = new Set(state.monitorEvents.map(e => e.id));
      return { ...state, monitorEvents: [...state.monitorEvents, ...action.items.filter(e => !have.has(e.id))] };
    }

    /* IG DM sync runs — same upsert/delete-by-id shape as monitor_events. */
    case "UPSERT_IG_SYNC_RUN": {
      const exists = state.igSyncRuns.some(r => r.id === action.item.id);
      return {
        ...state,
        igSyncRuns: exists
          ? state.igSyncRuns.map(r => r.id === action.item.id ? action.item : r)
          : [action.item, ...state.igSyncRuns],
      };
    }

    case "DELETE_IG_SYNC_RUN_BY_ID":
      return { ...state, igSyncRuns: state.igSyncRuns.filter(r => r.id !== action.id) };

    /* IG DM ingest log — per-message non-happy-path reasons; same shape. */
    case "UPSERT_IG_INGEST_LOG": {
      const exists = state.igIngestLog.some(l => l.id === action.item.id);
      return {
        ...state,
        igIngestLog: exists
          ? state.igIngestLog.map(l => l.id === action.item.id ? action.item : l)
          : [action.item, ...state.igIngestLog],
      };
    }

    case "DELETE_IG_INGEST_LOG_BY_ID":
      return { ...state, igIngestLog: state.igIngestLog.filter(l => l.id !== action.id) };

    /* G3 realtime trim: apply a coalesced BURST of ig_ingest_log realtime ops
       (one row per processed DM during a sync — very chatty) in ONE pass. */
    case "BATCH_IG_INGEST_LOG": {
      let list = state.igIngestLog;
      for (const op of action.ops) {
        if (op.kind === "delete") {
          list = list.filter(l => l.id !== op.id);
        } else {
          list = list.some(l => l.id === op.item.id)
            ? list.map(l => l.id === op.item.id ? op.item : l)
            : [op.item, ...list];
        }
      }
      return { ...state, igIngestLog: list };
    }

    /* Full-replace on manual reload (the "Check IG Sync" button). Realtime can
       miss events (tab asleep, dropped socket), so the button re-pulls both. */
    case "SET_IG_SYNC_RUNS":
      return { ...state, igSyncRuns: action.items };
    case "SET_IG_INGEST_LOG":
      return { ...state, igIngestLog: action.items };

    /* Pulse Monitor sources — owner-curated feed list; same shape as above. */
    case "CREATE_MONITOR_SOURCE":
      return { ...state, monitorSources: [action.item, ...state.monitorSources] };

    case "UPDATE_MONITOR_SOURCE": {
      const apply = (s) => s.id === action.id ? { ...s, ...action.patch } : s;
      return { ...state, monitorSources: state.monitorSources.map(apply) };
    }

    case "UPSERT_MONITOR_SOURCE": {
      const exists = state.monitorSources.some(s => s.id === action.item.id);
      return {
        ...state,
        monitorSources: exists
          ? state.monitorSources.map(s => s.id === action.item.id ? action.item : s)
          : [action.item, ...state.monitorSources],
      };
    }

    case "DELETE_MONITOR_SOURCE_BY_ID":
      return { ...state, monitorSources: state.monitorSources.filter(s => s.id !== action.id) };

    /* Full replace — background-hydration load. */
    case "SET_MONITOR_SOURCES":
      return { ...state, monitorSources: action.items };

    /* Monitor event links (geo/news event → reel/review_card/location).
       Same optimistic + realtime shape as monitor events/sources. */
    case "CREATE_EVENT_LINK":
      return { ...state, eventLinks: [action.item, ...state.eventLinks] };

    case "UPSERT_EVENT_LINK": {
      const exists = state.eventLinks.some(l => l.id === action.item.id);
      return {
        ...state,
        eventLinks: exists
          ? state.eventLinks.map(l => l.id === action.item.id ? action.item : l)
          : [action.item, ...state.eventLinks],
      };
    }

    case "DELETE_EVENT_LINK_BY_ID":
      return { ...state, eventLinks: state.eventLinks.filter(l => l.id !== action.id) };

    /* Full replace — background-hydration load of the recent window. */
    case "SET_EVENT_LINKS":
      return { ...state, eventLinks: action.items };

    /* loadMore page-in: append older rows, de-duped by id. */
    case "APPEND_EVENT_LINKS": {
      const have = new Set(state.eventLinks.map(l => l.id));
      return { ...state, eventLinks: [...state.eventLinks, ...action.items.filter(l => !have.has(l.id))] };
    }

    /* reel_dna_assets (card uuid → footage/location/thumbnail/news link).
       Same optimistic + realtime shape as monitor_event_links above. */
    case "UPSERT_REEL_DNA_ASSET": {
      const list = state.reelDnaAssets || [];
      const incoming = action.item;
      // De-dupe by the COMPOSITE link identity (reelDnaId + assetType + assetId),
      // NOT by row id: the optimistic row uses a synthetic `${reelDnaId}:${type}:${id}`
      // id while the realtime echo carries the DB's gen_random_uuid() id, so an
      // id-only check let BOTH rows coexist and the resolver emitted the asset twice.
      const sameLink = (a) =>
        a.reelDnaId === incoming.reelDnaId &&
        a.assetType === incoming.assetType &&
        String(a.assetId) === String(incoming.assetId);
      // A "real" DB id is a uuid (the synthetic optimistic id contains ':').
      const incomingIsDbRow = typeof incoming.id === "string" && !incoming.id.includes(":");
      const idx = list.findIndex(sameLink);
      if (idx === -1) {
        return { ...state, reelDnaAssets: [incoming, ...list] };
      }
      // Replace the existing matching link with a merged row, preferring a real DB
      // id (and other DB-supplied fields) whenever the incoming row has one so the
      // optimistic placeholder collapses into the persisted row.
      const existing = list[idx];
      const merged = incomingIsDbRow ? { ...existing, ...incoming } : { ...incoming, id: existing.id };
      const next = list.slice();
      next[idx] = merged;
      return { ...state, reelDnaAssets: next };
    }

    case "DELETE_REEL_DNA_ASSET":
      return {
        ...state,
        reelDnaAssets: (state.reelDnaAssets || []).filter(a => a.id !== action.id),
      };

    /* Full replace — background-hydration load of the recent window. */
    case "SET_REEL_DNA_ASSETS":
      return { ...state, reelDnaAssets: action.items };

    /* G3 realtime trim: apply a coalesced BURST of reel_dna_assets realtime ops
       in ONE pass / ONE render. Upserts reuse the composite-link de-dup of
       UPSERT_REEL_DNA_ASSET (synthetic optimistic id vs DB uuid). */
    case "BATCH_REEL_DNA_ASSETS": {
      let list = state.reelDnaAssets || [];
      for (const op of action.ops) {
        if (op.kind === "delete") {
          list = list.filter(a => a.id !== op.id);
        } else {
          const incoming = op.item;
          const sameLink = (a) =>
            a.reelDnaId === incoming.reelDnaId &&
            a.assetType === incoming.assetType &&
            String(a.assetId) === String(incoming.assetId);
          const incomingIsDbRow = typeof incoming.id === "string" && !incoming.id.includes(":");
          const idx = list.findIndex(sameLink);
          if (idx === -1) {
            list = [incoming, ...list];
          } else {
            const existing = list[idx];
            const merged = incomingIsDbRow ? { ...existing, ...incoming } : { ...incoming, id: existing.id };
            const next = list.slice();
            next[idx] = merged;
            list = next;
          }
        }
      }
      return { ...state, reelDnaAssets: list };
    }

    /* loadMore page-in: append older rows, de-duped by the COMPOSITE link
       identity (reelDnaId + assetType + assetId), mirroring UPSERT_REEL_DNA_ASSET
       so a page-boundary overlap doesn't emit the asset twice in the resolver. */
    case "APPEND_REEL_DNA_ASSETS": {
      const list = state.reelDnaAssets || [];
      const seen = new Set(list.map(a => `${a.reelDnaId}|${a.assetType}|${String(a.assetId)}`));
      const add = [];
      for (const a of action.items) {
        const key = `${a.reelDnaId}|${a.assetType}|${String(a.assetId)}`;
        if (!seen.has(key)) { seen.add(key); add.push(a); }
      }
      return { ...state, reelDnaAssets: [...list, ...add] };
    }

    /* Reel ↔ chat refs — same optimistic + realtime shape as reel_dna. */
    case "CREATE_REEL_CHAT_REF":
      return { ...state, reelChatRefs: [action.item, ...state.reelChatRefs] };

    case "UPSERT_REEL_CHAT_REF": {
      const exists = state.reelChatRefs.some(r => r.id === action.item.id);
      return {
        ...state,
        reelChatRefs: exists
          ? state.reelChatRefs.map(r => r.id === action.item.id ? action.item : r)
          : [action.item, ...state.reelChatRefs],
      };
    }

    case "DELETE_REEL_CHAT_REF_BY_ID":
      return { ...state, reelChatRefs: state.reelChatRefs.filter(r => r.id !== action.id) };

    /* Full replace — background-hydration load. */
    case "SET_REEL_CHAT_REFS":
      return { ...state, reelChatRefs: action.items };

    /* ----- Unified Reel DNA card (owner feature flag) ----- */
    case "SET_UNIFIED_CARDS":
      return { ...state, unifiedCards: action.enabled };

    /* ----- Gamify ----- */
    case "SET_GAMIFY_ENABLED":
      return { ...state, gamifyEnabled: action.enabled };

    case "SET_GAMIFY_GRADING_MODE":
      return { ...state, gamifyGradingMode: action.mode };

    case "SET_RUBRIC_DESC_MODE":
      return { ...state, rubricDescMode: action.mode };

    case "SET_GAMIFY_HIDDEN_SUBSKILLS":
      return { ...state, gamifyHiddenSubskills: action.map || {} };

    /* ----- Pipeline collapse / lane visibility (per-user, persisted to user_preferences) ----- */
    case "SET_COLLAPSED_REEL_IDS":
      return { ...state, collapsedReelIds: action.ids || [] };

    case "TOGGLE_REEL_COLLAPSED": {
      const has = state.collapsedReelIds.includes(action.reelId);
      return { ...state, collapsedReelIds: has
        ? state.collapsedReelIds.filter(id => id !== action.reelId)
        : [...state.collapsedReelIds, action.reelId] };
    }

    case "SET_HIDDEN_LANE_IDS":
      return { ...state, hiddenLaneIds: action.ids || [] };

    /* ----- Owner-only "Prefetch heavy tabs" pref (per-user, persisted to user_preferences) ----- */
    case "SET_PREFETCH_HEAVY_TABS":
      return { ...state, prefetchHeavyTabs: !!action.next };

    case "TOGGLE_LANE_HIDDEN": {
      const has = state.hiddenLaneIds.includes(action.laneId);
      return { ...state, hiddenLaneIds: has
        ? state.hiddenLaneIds.filter(id => id !== action.laneId)
        : [...state.hiddenLaneIds, action.laneId] };
    }

    /* ----- Reel DNA spreadsheet: hidden columns (per-user, persisted to user_preferences) ----- */
    case "SET_HIDDEN_REEL_DNA_COLS":
      return { ...state, hiddenReelDnaCols: action.keys || [] };

    case "TOGGLE_REEL_DNA_COL": {
      const has = state.hiddenReelDnaCols.includes(action.key);
      return { ...state, hiddenReelDnaCols: has
        ? state.hiddenReelDnaCols.filter(k => k !== action.key)
        : [...state.hiddenReelDnaCols, action.key] };
    }

    /* ----- Reel DNA spreadsheet: visited-link tracking (per-user, persisted to user_preferences) ----- */
    case "SET_VISITED_REEL_DNA":
      return { ...state, visitedReelDnaIds: action.ids || [], lastVisitedReelDnaId: action.last ?? null };

    case "MARK_REEL_DNA_VISITED": {
      const has = state.visitedReelDnaIds.includes(action.id);
      return {
        ...state,
        visitedReelDnaIds: has ? state.visitedReelDnaIds : [...state.visitedReelDnaIds, action.id],
        lastVisitedReelDnaId: action.id,
      };
    }

    /* ----- Training module content (owner per-field overrides) ----- */
    case "SET_MODULE_CONTENT": {
      const mod = { ...(state.moduleContent[action.moduleId] || {}), [action.fieldPath]: action.value };
      return { ...state, moduleContent: { ...state.moduleContent, [action.moduleId]: mod } };
    }

    case "RESET_MODULE_CONTENT": {
      const mod = { ...(state.moduleContent[action.moduleId] || {}) };
      delete mod[action.fieldPath];
      return { ...state, moduleContent: { ...state.moduleContent, [action.moduleId]: mod } };
    }

    /* Full replace — background-hydration load of all owner overrides. */
    case "SET_MODULE_CONTENT_ALL":
      return { ...state, moduleContent: action.moduleContent || {} };

    case "UPSERT_GAMIFY_PROGRESS": {
      const exists = state.gamifyProgress.some(p => p.personId === action.item.personId);
      return {
        ...state,
        gamifyProgress: exists
          ? state.gamifyProgress.map(p => p.personId === action.item.personId
              ? { ...p, ...action.item } : p)
          : [action.item, ...state.gamifyProgress],
      };
    }

    case "UPSERT_GAMIFY_RUBRIC": {
      const key = (r) => `${r.reelId}|${r.personId}|${r.skillKey}`;
      const k = key(action.item);
      const exists = state.gamifyRubrics.some(r => key(r) === k);
      return {
        ...state,
        gamifyRubrics: exists
          ? state.gamifyRubrics.map(r => key(r) === k ? { ...r, ...action.item } : r)
          : [action.item, ...state.gamifyRubrics],
      };
    }

    case "DELETE_GAMIFY_RUBRIC_BY_ID":
      return { ...state, gamifyRubrics: state.gamifyRubrics.filter(r => r.id !== action.id) };

    /* Background-hydration bundle: progress + (windowed) rubric rows + the
       app_settings toggles, merged together in one dispatch so the gamify slice
       lands atomically without clobbering anything else. */
    case "SET_GAMIFY_BUNDLE": {
      const p = action.payload || {};
      return {
        ...state,
        gamifyProgress: p.gamifyProgress ?? state.gamifyProgress,
        gamifyRubrics: p.gamifyRubrics ?? state.gamifyRubrics,
        gamifyEnabled: p.gamifyEnabled ?? state.gamifyEnabled,
        unifiedCards: p.unifiedCards ?? state.unifiedCards,
        gamifyGradingMode: p.gamifyGradingMode ?? state.gamifyGradingMode,
        rubricDescMode: p.rubricDescMode ?? state.rubricDescMode,
        gamifyHiddenSubskills: p.gamifyHiddenSubskills ?? state.gamifyHiddenSubskills,
      };
    }

    /* loadMore page-in: append older rubric rows, de-duped by the composite
       (reelId|personId|skillKey) identity used by UPSERT_GAMIFY_RUBRIC. */
    case "APPEND_GAMIFY_RUBRICS": {
      const key = (r) => `${r.reelId}|${r.personId}|${r.skillKey}`;
      const have = new Set(state.gamifyRubrics.map(key));
      const add = action.items.filter(r => !have.has(key(r)));
      return { ...state, gamifyRubrics: [...state.gamifyRubrics, ...add] };
    }

    case "SET_DAILY_TASKS":
      return { ...state, dailyTasks: action.items };

    case "UPSERT_DAILY_TASK": {
      const exists = state.dailyTasks.some(t => t.id === action.item.id);
      return {
        ...state,
        dailyTasks: exists
          ? state.dailyTasks.map(t => t.id === action.item.id ? { ...t, ...action.item } : t)
          : [action.item, ...state.dailyTasks],
      };
    }

    case "DELETE_DAILY_TASK":
      return { ...state, dailyTasks: state.dailyTasks.filter(t => t.id !== action.id) };

    case "REORDER_DAILY_TASKS": {
      const orderMap = new Map(action.orderedIds.map((id, i) => [id, i]));
      return {
        ...state,
        dailyTasks: state.dailyTasks.map(t =>
          orderMap.has(t.id) ? { ...t, sortOrder: orderMap.get(t.id) } : t),
      };
    }

    case "APPROVE_REVIEW": {
      const stamp = action.stageEnteredAt || new Date().toISOString();
      return {
        ...state,
        reels: state.reels.map(r => {
          if (r.id !== action.id) return r;
          const history = appendRevisionEntry(r.detail, {
            action: "approved", ts: stamp, by: action.by || null, note: "",
          });
          return { ...r,
            stage: "completed", state: "ok",
            blocker: null, blockerRole: null,
            age: "approved",
            stageEnteredAt: stamp,
            next: "Hold for post window",
            detail: { ...(r.detail || {}), revisionHistory: history } };
        }),
      };
    }

    case "SEND_BACK": {
      const editor = ROLES.skilled?.person;
      const stamp = action.stageEnteredAt || new Date().toISOString();
      return {
        ...state,
        reels: state.reels.map(r => {
          if (r.id !== action.id) return r;
          const target = r.prevOwner || editor || r.owner;
          const note = (action.note || "").trim();
          const history = appendRevisionEntry(r.detail, {
            action: "sent_back", ts: stamp, by: action.by || null, note,
          });
          return { ...r,
            stage: "in_progress", state: "warn",
            owner: target, lane: target,
            blocker: note ? "For revision · " + note.slice(0, 60) : "Sent back for revision",
            blockerRole: "skilled",
            age: "just now",
            stageEnteredAt: stamp,
            next: "Address review notes",
            // Append to revisionHistory so Paul/Leroy can see every
            // prior round of notes when the reel comes back for review.
            detail: { ...(r.detail || {}), revisionHistory: history } };
        }),
      };
    }

    case "TRIAGE_IDEA": {
      if (action.decision === "kill") {
        return { ...state, reels: state.reels.filter(r => r.id !== action.id) };
      }
      const stamp = action.stageEnteredAt || new Date().toISOString();
      return {
        ...state,
        reels: state.reels.map(r => {
          if (r.id !== action.id) return r;
          if (action.decision === "greenlight") {
            return { ...r, stage: "not_started", state: "ok", blocker: null,
                     age: "queued", stageEnteredAt: stamp,
                     next: "Start main edit" };
          }
          if (action.decision === "defer") {
            return { ...r, state: "warn", age: "deferred",
                     next: "Revisit next cycle" };
          }
          return r;
        }),
      };
    }

    default:
      return state;
  }
}

/* ---------- Supabase persistence (called after each dispatch) ----------
   Optimistic pattern: the dispatch already updated local state.
   Here we mirror the same change to Supabase. On error we log
   and surface via SET_ERROR; no automatic rollback for the
   prototype. */

async function persistMoveStage(state, id, { lane, stage, systemComment, scheduledPostDate }) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const isCard = state.reviewLaneCards.some(c => c.id === id);
  const table = isCard ? "review_lane_cards" : "reels";
  const reel = (isCard ? state.reviewLaneCards : state.reels).find(r => r.id === id);
  if (!reel) return;
  const stageChanged = reel.stage !== stage;
  const patch = { stage };

  // Explicit lane (board drag) persists as-is; a no-lane stage change
  // (list-view / my-work) re-pins lane to the current owner so the pipeline
  // doesn't strand the card in a stale lane. Mirrors the reducer above.
  if (lane !== undefined) patch.lane = lane;
  else if (!isCard) patch.lane = reel.owner;
  if (!isCard && scheduledPostDate !== undefined) patch.scheduled_post_date = scheduledPostDate ?? null;

  if (!isCard) {
    if (lane !== undefined && lane !== "review" && isKnownPerson(lane) && lane !== reel.owner) {
      patch.owner = lane;
    } else if (lane === "review") {
      const stagePerson = stageOwnerPersonId("review");
      if (stagePerson) patch.owner = stagePerson;
    }
  }

  if (stage === "review" && reel.stage !== "review" && !isCard) {
    patch.prev_owner = reel.owner;
  }
  if (!isCard && stageChanged) {
    patch.stage_entered_at = new Date().toISOString();
    if (systemComment) {
      // Reuse the exact same entry built by the action creator so
      // the optimistic + realtime-echoed row carry identical ids.
      patch.detail = {
        ...(reel.detail || {}),
        comments: appendComment(reel.detail, systemComment),
      };
    }
  }
  const { error } = await supabase.from(table).update(patch).eq("id", id);
  if (error) throw error;
}

async function persistUpdateReel(state, id, patch) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const isCard = state.reviewLaneCards.some(c => c.id === id);
  const table = isCard ? "review_lane_cards" : "reels";
  // Remap camelCase patch keys to snake_case where applicable
  const dbPatch = { ...patch };
  if ("blockerRole" in patch) { dbPatch.blocker_role = patch.blockerRole; delete dbPatch.blockerRole; }
  if ("prevOwner" in patch)   { dbPatch.prev_owner = patch.prevOwner; delete dbPatch.prevOwner; }
  if ("variantProgress" in patch) { dbPatch.variant_progress = patch.variantProgress; delete dbPatch.variantProgress; }
  if ("fbQuery" in patch)     { dbPatch.fb_query = patch.fbQuery; delete dbPatch.fbQuery; }
  if ("attachUrl" in patch)   { dbPatch.attach_url = patch.attachUrl; delete dbPatch.attachUrl; }
  if ("dueAt" in patch)       { dbPatch.due_at = patch.dueAt; delete dbPatch.dueAt; }
  if ("stageEnteredAt" in patch) { dbPatch.stage_entered_at = patch.stageEnteredAt; delete dbPatch.stageEnteredAt; }
  if ("archivedAt" in patch)  { dbPatch.archived_at = patch.archivedAt; delete dbPatch.archivedAt; }
  if ("parentId" in patch)    { dbPatch.parent_id = patch.parentId; delete dbPatch.parentId; }
  if ("gamifyDifficulty" in patch) { dbPatch.gamify_difficulty = patch.gamifyDifficulty; delete dbPatch.gamifyDifficulty; }
  // Planable final-video reference (mediaPath/mediaTarget) has no reels column —
  // fold it into the existing `detail` jsonb (read-modify-write off the current
  // reel) so it persists across reloads, and strip the top-level keys so
  // PostgREST never sees an unknown column. reelFromDb re-surfaces them on read.
  if ("mediaPath" in patch || "mediaTarget" in patch) {
    const cur = (isCard ? state.reviewLaneCards : state.reels).find(r => r.id === id) || {};
    const nextDetail = { ...(cur.detail || {}) };
    if ("mediaPath" in patch)   nextDetail.mediaPath = patch.mediaPath;
    if ("mediaTarget" in patch) nextDetail.mediaTarget = patch.mediaTarget;
    dbPatch.detail = nextDetail;
    delete dbPatch.mediaPath;
    delete dbPatch.mediaTarget;
  }
  // Keep `lane` in sync when owner changes — board derives column as lane || owner,
  // so a stale lane from a prior board drag would otherwise override the new owner.
  if ("owner" in patch && !("lane" in patch)) { dbPatch.lane = patch.owner; }
  let { error } = await supabase.from(table).update(dbPatch).eq("id", id);
  // board_order / gamify_difficulty may not be migrated yet — if PostgREST
  // rejects an unknown column, drop it and retry (the change still shows
  // locally; it just won't persist until the column is added).
  if (error && /board_order|gamify_difficulty|column|PGRST204/i.test(error.message || "")) {
    const { board_order, gamify_difficulty, ...rest } = dbPatch;
    error = Object.keys(rest).length
      ? (await supabase.from(table).update(rest).eq("id", id)).error
      : null;
  }
  if (error) throw error;
}

async function persistCreateReel(reel) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const { error } = await supabase.from("reels").insert(reelToDb(reel));
  if (error) throw error;
}

async function persistDeleteReel(id) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  // review_lane_cards rows with this as parent_id cascade via FK
  const { error } = await supabase.from("reels").delete().eq("id", id);
  if (error) throw error;
}

async function persistCreateTask(task) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const { error } = await supabase.from("tasks").insert(taskToDb(task));
  if (error) throw error;
}

async function persistUpdateTask(id, patch) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const dbPatch = { ...patch };
  if ("from" in patch) { dbPatch.from_person = patch.from; delete dbPatch.from; }
  if ("to" in patch)   { dbPatch.to_person = patch.to; delete dbPatch.to; }
  if ("reel" in patch) { dbPatch.reel_id = patch.reel; delete dbPatch.reel; }
  const { error } = await supabase.from("tasks").update(dbPatch).eq("id", id);
  if (error) throw error;
}

async function persistDeleteTask(id) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

async function persistAddAttachedFootage(item) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  let { error } = await supabase.from("attached_footage_items").insert(item);
  // Graceful fallback: if a new column (drive_url, drive_folder_url, frame_rate)
  // hasn't been migrated yet, retry without the offending field so attaching
  // still works. Run the migrations to persist those fields going forward.
  if (error && /drive_url|drive_folder_url|frame_rate|PGRST204|column/i.test(error.message || "")) {
    const { drive_url, drive_folder_url, frame_rate, ...rest } = item;
    ({ error } = await supabase.from("attached_footage_items").insert(rest));
  }
  if (error) throw error;
}

async function persistRemoveAttachedFootage(id) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const { error } = await supabase.from("attached_footage_items").delete().eq("id", id);
  if (error) throw error;
}

async function persistCreateReelDna(item) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const { error } = await supabase.from("reel_dna").insert(reelDnaToDb(item));
  if (error) throw error;
}

async function persistUpdateReelDna(id, patch) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  // Remap camelCase patch keys to snake_case; jsonb gene fields pass through.
  const dbPatch = { ...patch };
  if ("reelUrl" in patch)         { dbPatch.reel_url = patch.reelUrl; delete dbPatch.reelUrl; }
  if ("genesOfInterest" in patch) { dbPatch.genes_of_interest = patch.genesOfInterest; delete dbPatch.genesOfInterest; }
  if ("quickNotes" in patch)      { dbPatch.quick_notes = patch.quickNotes; delete dbPatch.quickNotes; }
  if ("capturedBy" in patch)      { dbPatch.captured_by = patch.capturedBy; delete dbPatch.capturedBy; }
  if ("externalRef" in patch)     { dbPatch.external_ref = patch.externalRef; delete dbPatch.externalRef; }
  if ("reelId" in patch)          { dbPatch.reel_id = patch.reelId; delete dbPatch.reelId; }
  if ("archivedAt" in patch)      { dbPatch.archived_at = patch.archivedAt; delete dbPatch.archivedAt; }
  if ("deletedAt" in patch)       { dbPatch.deleted_at = patch.deletedAt; delete dbPatch.deletedAt; }
  if ("contentType" in patch)     { dbPatch.content_type = patch.contentType; delete dbPatch.contentType; }
  // Reel DNA longform (Phase 0) — C1 columns. format/narrative/progress are
  // same-name (pass through via {...patch}); the rest remap to snake_case.
  if ("mediaStatus" in patch)       { dbPatch.media_status = patch.mediaStatus; delete dbPatch.mediaStatus; }
  if ("sourceUrlResolved" in patch) { dbPatch.source_url_resolved = patch.sourceUrlResolved; delete dbPatch.sourceUrlResolved; }
  if ("mediaError" in patch)        { dbPatch.media_error = patch.mediaError; delete dbPatch.mediaError; }
  if ("analyzedAt" in patch)        { dbPatch.analyzed_at = patch.analyzedAt; delete dbPatch.analyzedAt; }
  // Reel DNA Phase 1 — asset_manifest (H3) remaps; pacing (H4) is same-name and
  // passes through {...patch} untouched (jsonb).
  if ("assetManifest" in patch)     { dbPatch.asset_manifest = patch.assetManifest; delete dbPatch.assetManifest; }
  // Spreadsheet row tagging (migration 0089) — rowColor remaps; favorite is
  // same-name and passes through {...patch} untouched.
  if ("rowColor" in patch)          { dbPatch.row_color = patch.rowColor; delete dbPatch.rowColor; }
  const { error } = await supabase.from("reel_dna").update(dbPatch).eq("id", id);
  if (error) throw error;
}

async function persistDeleteReelDna(id) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const { error } = await supabase.from("reel_dna").delete().eq("id", id);
  if (error) throw error;
}

async function persistCreateThumbnailDna(item) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const { error } = await supabase.from("thumbnail_dna").insert(thumbnailToDb(item));
  if (error) throw error;
}

async function persistUpdateThumbnailDna(id, patch) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  // Remap camelCase patch keys to snake_case; the six gene text fields and
  // title/channel/status pass through unchanged.
  const dbPatch = { ...patch };
  if ("videoUrl" in patch)        { dbPatch.video_url = patch.videoUrl; delete dbPatch.videoUrl; }
  if ("videoId" in patch)         { dbPatch.video_id = patch.videoId; delete dbPatch.videoId; }
  if ("thumbnailUrl" in patch)    { dbPatch.thumbnail_url = patch.thumbnailUrl; delete dbPatch.thumbnailUrl; }
  if ("genesOfInterest" in patch) { dbPatch.genes_of_interest = patch.genesOfInterest; delete dbPatch.genesOfInterest; }
  if ("quickNotes" in patch)      { dbPatch.quick_notes = patch.quickNotes; delete dbPatch.quickNotes; }
  if ("capturedBy" in patch)      { dbPatch.captured_by = patch.capturedBy; delete dbPatch.capturedBy; }
  if ("archivedAt" in patch)      { dbPatch.archived_at = patch.archivedAt; delete dbPatch.archivedAt; }
  if ("deletedAt" in patch)       { dbPatch.deleted_at = patch.deletedAt; delete dbPatch.deletedAt; }
  const { error } = await supabase.from("thumbnail_dna").update(dbPatch).eq("id", id);
  if (error) throw error;
}

async function persistCreateMonitorEvent(item) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const { error } = await supabase.from("monitor_events").insert(monitorEventToDb(item));
  if (error) throw error;
}

async function persistUpdateMonitorEvent(id, patch) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  // Remap camelCase patch keys to snake_case. Skips undefined keys so a
  // partial update doesn't blow away columns the caller didn't set.
  const dbPatch = {};
  if ("sourceType" in patch)  dbPatch.source_type = patch.sourceType;
  if ("externalId" in patch)  dbPatch.external_id = patch.externalId;
  if ("category" in patch)    dbPatch.category = patch.category;
  if ("platform" in patch)    dbPatch.platform = patch.platform;
  if ("severity" in patch)    dbPatch.severity = patch.severity;
  if ("status" in patch)      dbPatch.status = patch.status;
  if ("starred" in patch)     dbPatch.starred = patch.starred;
  if ("title" in patch)       dbPatch.title = patch.title;
  if ("summary" in patch)     dbPatch.summary = patch.summary;
  if ("sourceName" in patch)  dbPatch.source_name = patch.sourceName;
  if ("sourceUrl" in patch)   dbPatch.source_url = patch.sourceUrl;
  if ("region" in patch)      dbPatch.region = patch.region;
  if ("tags" in patch)        dbPatch.tags = patch.tags;
  if ("publishedAt" in patch) dbPatch.published_at = patch.publishedAt;
  if ("createdBy" in patch)   dbPatch.created_by = patch.createdBy;
  if (!Object.keys(dbPatch).length) return;
  const { error } = await supabase.from("monitor_events").update(dbPatch).eq("id", id);
  if (error) throw error;
}

async function persistDeleteMonitorEvent(id) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const { error } = await supabase.from("monitor_events").delete().eq("id", id);
  if (error) throw error;
}

async function persistCreateMonitorSource(item) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const { error } = await supabase.from("monitor_sources").insert(monitorSourceToDb(item));
  if (error) throw error;
}

async function persistUpdateMonitorSource(id, patch) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const dbPatch = {};
  if ("name" in patch)            dbPatch.name = patch.name;
  if ("url" in patch)             dbPatch.url = patch.url;
  if ("category" in patch)        dbPatch.category = patch.category;
  if ("platform" in patch)        dbPatch.platform = patch.platform;
  if ("region" in patch)          dbPatch.region = patch.region;
  if ("severityDefault" in patch) dbPatch.severity_default = patch.severityDefault;
  if ("enabled" in patch)         dbPatch.enabled = patch.enabled;
  if (!Object.keys(dbPatch).length) return;
  const { error } = await supabase.from("monitor_sources").update(dbPatch).eq("id", id);
  if (error) throw error;
}

async function persistDeleteMonitorSource(id) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const { error } = await supabase.from("monitor_sources").delete().eq("id", id);
  if (error) throw error;
}

async function persistCreateEventLink(item) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  // Single insert — the parent monitor_events row already exists, so there's no
  // FK-ordering race (unlike the parent+child sequential-write gotcha).
  const { error } = await supabase.from("monitor_event_links").insert(eventLinkToDb(item));
  if (error) throw error;
}

async function persistDeleteEventLink(id) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const { error } = await supabase.from("monitor_event_links").delete().eq("id", id);
  if (error) throw error;
}

/* ----- reel_dna_assets persistence -----
   Upsert on the FULL unique index (reel_dna_id, asset_type, asset_id) — the
   onConflict string MUST name exactly those columns (0061 gotcha: a partial
   index can't arbitrate). asset_id is String()-coerced by the caller (mixed
   text/uuid source PKs). ignoreDuplicates keeps a re-attach a silent no-op. */
async function persistAttachAsset(row) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const { error } = await supabase
    .from("reel_dna_assets")
    .upsert(row, { onConflict: "reel_dna_id,asset_type,asset_id", ignoreDuplicates: true });
  if (error) throw error;
}

async function persistDetachAsset(reelDnaId, assetType, assetId) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const { error } = await supabase
    .from("reel_dna_assets")
    .delete()
    .match({ reel_dna_id: reelDnaId, asset_type: assetType, asset_id: String(assetId) });
  if (error) throw error;
}

async function persistCreateReelChatRef(item) {
  if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
  const { id, reelId, channel, note, messageUrl, createdBy } = item;
  const row = {
    id, channel: channel ?? null, note: note ?? null,
    reel_id: reelId,
    message_url: messageUrl ?? null,
    created_by: createdBy ?? null,
  };
  const { error } = await supabase.from("reel_chat_refs").insert(row);
  if (error) throw error;
}

/* ---------- Gamify persistence ----------
   gamify_progress is upserted on person_id; gamify_rubric on the
   (reel_id, person_id, skill_key) composite. Both short-circuit in
   demo mode (optimistic-only). */
async function persistGamifyProgress(item) {
  if (isDemoMode()) return;
  const row = {
    person_id: item.personId,
    total_xp: item.totalXp ?? 0,
    skill_scores: item.skillScores ?? {},
    medal: item.medal ?? "none",
    unlocked_rewards: item.unlockedRewards ?? [],
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("gamify_progress")
    .upsert(row, { onConflict: "person_id" });
  if (error) throw error;
}

async function persistGamifyRubric(item) {
  if (isDemoMode()) return;
  const row = {
    reel_id: item.reelId,
    person_id: item.personId,
    skill_key: item.skillKey,
    editor_checked: item.editorChecked ?? [],
    reviewer_grades: item.reviewerGrades ?? {},
    xp_awarded: item.xpAwarded ?? 0,
    graded_at: item.gradedAt ?? null,
    updated_at: new Date().toISOString(),
  };
  let { error } = await supabase
    .from("gamify_rubric")
    .upsert(row, { onConflict: "reel_id,person_id,skill_key" });
  // Graceful fallback if migration 0051 (reviewer_grades) hasn't run yet.
  if (error && /reviewer_grades|column|PGRST204/i.test(error.message || "")) {
    const { reviewer_grades, ...rest } = row;
    ({ error } = await supabase
      .from("gamify_rubric")
      .upsert(rest, { onConflict: "reel_id,person_id,skill_key" }));
  }
  if (error) throw error;
}

/* Recompute a person's aggregate progress (skill scores, total XP,
   medal, unlocked rewards) from the full set of their graded rubric
   rows. Pure — returns the gamify_progress shape. */
function computeProgress(personId, rubricRows) {
  const xpBySkill = {};
  for (const k of SKILL_KEYS) xpBySkill[k] = 0;
  for (const r of rubricRows) {
    if (r.personId !== personId) continue;
    if (!(r.skillKey in xpBySkill)) continue;
    xpBySkill[r.skillKey] += (r.xpAwarded || 0);
  }
  const skillScores = {};
  let totalXp = 0;
  for (const k of SKILL_KEYS) {
    skillScores[k] = scoreForSkillXp(xpBySkill[k]);
    totalXp += xpBySkill[k];
  }
  const medal = medalForScores(skillScores);
  const { current } = levelForXp(totalXp);
  const unlockedRewards = REWARDS.filter(r => current.level >= r.level).map(r => r.id);
  return { personId, totalXp, skillScores, medal, unlockedRewards };
}

/* ---------- Context + provider ---------- */
const WorkflowContext = React.createContext(null);

/* Boot-window sizing (perf / scale-to-~15-concurrent-users — Part 3).
   Unbounded `select("*")` on the big growers (reel_dna, thumbnail_dna,
   attached_footage_items, reel_dna_assets, monitor_event_links, gamify_rubric)
   pulled the WHOLE table on every boot, which gets heavier per row added and
   floods the reducer/render. We now fetch only a bounded RECENT window ordered
   by created_at DESC (matching the existing/contracted indexes) and expose
   additive `loadMore*` actions to page in older rows on demand (UI wiring is a
   follow-up — not done here). monitor_events additionally uses a time-window
   (90 days) per the frozen index contract (monitor_events_created_idx, 0059).
   Tuning knob: bump RECENT_WINDOW if a tab legitimately needs a deeper default. */
const RECENT_WINDOW = 500;          // generic recent-row cap for the big growers
const MONITOR_EVENTS_WINDOW = 500;  // monitor_events row cap (paired with the 90d gate)
const MONITOR_EVENTS_WINDOW_DAYS = 90;
function monitorEventsSince() {
  return new Date(Date.now() - MONITOR_EVENTS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

const INITIAL_STATE = {
  reels: [],
  reviewLaneCards: [],
  tasks: [],
  attachedFootage: [],
  dailyTasks: [],
  reelDna: [],
  thumbnailDna: [],
  musicTracks: [],   // music_tracks — cached Epidemic Sound tracks (migration 0092)
  musicFavorites: [],       // music_favorites — per-user ♥ (migration 0093)
  musicPlaylists: [],       // music_playlists — per-user named lists (migration 0093)
  musicPlaylistTracks: [],  // music_playlist_tracks — playlist membership (migration 0093)
  monitorEvents: [],
  monitorSources: [],
  eventLinks: [],
  reelDnaAssets: [],   // reel_dna card → footage/location/thumbnail/news links (migration 0067)
  igSyncRuns: [],     // ig_sync_runs — one row per IG DM poller run (migration 0073)
  igIngestLog: [],    // ig_ingest_log — per-message non-happy-path reasons (migration 0074)
  editProjects: [],   // edit_projects — OpenCut v2 collaborative editor gallery (migration 0094)
  editorLocks: [],    // editor_locks — project-level single-writer sentinel, keyed by project_id (migration 0094)
  // No locations table exists yet — kept as a static empty array so the Pulse
  // event-link picker (Team C) degrades gracefully instead of crashing.
  locations: [],
  reelChatRefs: [],
  gamifyProgress: [],
  gamifyRubrics: [],
  gamifyEnabled: false,
  unifiedCards: false,         // owner flag: new unified Reel DNA card vs legacy DnaCard (default = legacy)
  gamifyGradingMode: "editor+reviewer",
  rubricDescMode: "all",   // "off" | "active-only" | "all"
  gamifyHiddenSubskills: {},   // { [reelId]: ["skillKey:subId", ...] } — owner-archived rubric rows, per reel
  moduleContent: {},           // { [moduleId]: { [fieldPath]: value } } — owner training-content overrides
  collapsedReelIds: [],        // reel IDs the current user has collapsed on the pipeline board
  hiddenLaneIds: [],           // lane/person IDs the current user has hidden on the pipeline board
  prefetchHeavyTabs: false,    // owner pref: eagerly prefetch the code-split heavy tabs (per-user, user_preferences)
  hiddenReelDnaCols: [],       // Reel DNA spreadsheet: hidden column KEYS (per-user, user_preferences). [] = all visible
  visitedReelDnaIds: [],       // Reel DNA spreadsheet: reel_dna ids the user has opened (per-user, user_preferences)
  lastVisitedReelDnaId: null,  // Reel DNA spreadsheet: the single most-recently opened reel_dna id
  loaded: false,
  error: null,
};

function WorkflowProvider({ children }) {
  const [state, dispatch] = React.useReducer(workflowReducer, INITIAL_STATE);

  /* Demo sandbox: when the signed-in person is the demo account, flip the
     module-level flag so every persist* short-circuits (optimistic-only).
     Set synchronously before any mutation can fire. RLS (migration 0046)
     is the hard backstop; this is the UX layer. */
  const { person: _authPerson } = useAuth();
  // Demo mode decommissioned 2026-06-19 — the demo-sandbox feature was left
  // unbuilt/unused (migration 0049 never ran). Force OFF so every isDemoMode()
  // guard in this store stays an inert no-op regardless of a person's role.
  const _isDemo = false;
  setDemoMode(_isDemo);
  React.useEffect(() => { setDemoMode(_isDemo); }, [_isDemo]);

  // One-time legacy cleanup — old step 1.5 / step 2 caches.
  React.useEffect(() => {
    try {
      localStorage.removeItem("workflow.board.items.v1");
      localStorage.removeItem("workflow.store.v1");
    } catch (_) {}
  }, []);

  // Hydrate from Supabase on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        /* PROGRESSIVE BOOT (G2): gate `loaded` (and therefore the whole UI)
           on ONLY the ESSENTIAL collaboration tables — reels, review_lane_cards,
           tasks, daily_tasks. Everything else (footage, reel_dna, monitor_*,
           gamify, etc.) hydrates in the BACKGROUND after first paint and is
           merged via its own SET_* dispatch as it arrives, so a slow/large
           secondary table no longer blocks the app from rendering. The reducer's
           SET_* cases are surgical (touch only their slice) so these incremental
           merges never clobber the essential state set by HYDRATE. */
        const [reelsRes, cardsRes, tasksRes, dailyTasksRes] = await Promise.all([
          supabase.from("reels").select("*"),
          supabase.from("review_lane_cards").select("*"),
          supabase.from("tasks").select("*"),
          supabase.from("daily_tasks").select("*").order("task_date", { ascending: false }).order("created_at", { ascending: true }),
        ]);
        if (reelsRes.error) throw reelsRes.error;
        if (cardsRes.error) throw cardsRes.error;
        if (tasksRes.error) throw tasksRes.error;
        if (dailyTasksRes.error) throw dailyTasksRes.error;

        if (cancelled) return;
        /* G2: flip `loaded` on the ESSENTIAL tables alone. The UI paints now;
           the secondary tables below merge in via their own SET_* dispatch.
           HYDRATE only carries the essential slices — every other slice keeps
           its INITIAL_STATE default ([] / {}) until its background loader
           resolves, so a slow secondary table no longer holds up boot. */
        dispatch({ type: "HYDRATE", payload: {
          reels: (reelsRes.data || []).map(reelFromDb),
          reviewLaneCards: (cardsRes.data || []).map(cardFromDb),
          tasks: (tasksRes.data || []).map(taskFromDb),
          dailyTasks: (dailyTasksRes.data || []).map(dailyTaskFromDb),
        }});

        /* ----- SECONDARY (background) hydration -----
           Each table loads independently AFTER first paint and is windowed to a
           bounded recent slice (G1) — older rows page in via the loadMore*
           actions. Every block keeps its own try/catch degrade-to-[] so a
           missing/un-migrated table can never brick boot. We don't await this
           IIFE — boot is already complete. */
        (async () => {
          /* attached_footage_items (G1 window). Was an unbounded essential
             fetch in the boot Promise.all; now a windowed secondary load. */
          try {
            const footageRes = await supabase
              .from("attached_footage_items").select("*")
              .order("created_at", { ascending: false })
              .limit(RECENT_WINDOW);
            if (footageRes.error) throw footageRes.error;
            if (!cancelled) dispatch({ type: "SET_ATTACHED_FOOTAGE", items: footageRes.data || [] });
          } catch (e) {
            console.warn("attached_footage_items load failed:", e?.message || e);
          }

          /* Reel DNA — degrades to [] if migration 0044 isn't applied.
             Windowed to the RECENT_WINDOW most-recent non-deleted rows. */
          try {
            const reelDnaRes = await supabase
              .from("reel_dna").select("*")
              .is("deleted_at", null)
              .order("created_at", { ascending: false })
              .limit(RECENT_WINDOW);
            if (reelDnaRes.error) throw reelDnaRes.error;
            if (!cancelled) dispatch({ type: "SET_REEL_DNA", items: (reelDnaRes.data || []).map(reelDnaFromDb) });
          } catch (e) {
            console.warn("reel_dna not available (run migration 0044?):", e?.message || e);
          }

          /* OWNER-ONLY secondary tables (thumbnail_dna, monitor_events,
             ig_sync_runs, ig_ingest_log, monitor_sources, monitor_event_links)
             are loaded by their OWN auth-keyed effect (see "Owner-only secondary
             hydration" below) so editors skip those queries entirely. Moved out
             of this all-roles IIFE to role-gate them; FAIL-OPEN until role
             resolves. The reel_dna_assets fetch below stays here — it backs the
             lean editor tabs for every role. */

          /* Reel DNA assets (migration 0067) — windowed. */
          try {
            const assetsRes = await supabase
              .from("reel_dna_assets").select("*")
              .order("created_at", { ascending: false })
              .limit(RECENT_WINDOW);
            if (assetsRes.error) throw assetsRes.error;
            if (!cancelled) dispatch({ type: "SET_REEL_DNA_ASSETS", items: (assetsRes.data || []).map(reelDnaAssetFromDb) });
          } catch (e) {
            console.warn("reel_dna_assets not available (run migration 0067?)", e?.message || e);
          }

          /* Music tracks (Epidemic Sound cache, migration 0092) — degrade to
             [] if the table is absent so a missing migration can't brick boot
             (mirrors the reel_dna_assets/thumbnail_dna defensive hydrate). */
          try {
            const musicRes = await supabase
              .from("music_tracks").select("*")
              .order("created_at", { ascending: false })
              .limit(RECENT_WINDOW);
            if (musicRes.error) throw musicRes.error;
            if (!cancelled) dispatch({ type: "SET_MUSIC_TRACKS", items: (musicRes.data || []).map(musicTrackFromDb) });
          } catch (e) {
            console.warn("music_tracks not available (run migration 0092?):", e?.message || e);
          }

          /* OpenCut editor projects (migration 0094) — the collaborative-editor
             gallery, available to every team member (not owner-only), so it
             hydrates here in the shared background block alongside music_tracks.
             Windowed to the RECENT most-recently-updated projects. Degrades to []
             if 0094 hasn't been applied — a missing table must NEVER brick boot
             (mirrors the music_tracks/reel_dna_assets defensive hydrate). */
          try {
            const editProjectsRes = await supabase
              .from("edit_projects").select("*")
              .order("updated_at", { ascending: false })
              .limit(RECENT_WINDOW);
            if (editProjectsRes.error) throw editProjectsRes.error;
            if (!cancelled) dispatch({ type: "SET_EDIT_PROJECTS", items: (editProjectsRes.data || []).map(editProjectFromDb) });
          } catch (e) {
            console.warn("edit_projects not available (run migration 0094?):", e?.message || e);
          }

          /* editor_locks (migration 0094) — project-level single-writer sentinels
             for global lock badges on the gallery. Small table (one row per
             actively-edited project). Degrades to [] if 0094 hasn't run. */
          try {
            const editorLocksRes = await supabase
              .from("editor_locks").select("*");
            if (editorLocksRes.error) throw editorLocksRes.error;
            if (!cancelled) dispatch({ type: "SET_EDITOR_LOCKS", items: (editorLocksRes.data || []).map(editorLockFromDb) });
          } catch (e) {
            console.warn("editor_locks not available (run migration 0094?):", e?.message || e);
          }

          /* Reel ↔ chat refs (migration 0046) — degrade to []. */
          try {
            const refsRes = await supabase
              .from("reel_chat_refs").select("*")
              .order("created_at", { ascending: false });
            if (refsRes.error) throw refsRes.error;
            if (!cancelled) dispatch({ type: "SET_REEL_CHAT_REFS", items: (refsRes.data || []).map(reelChatRefsFromDb) });
          } catch (e) {
            console.warn("reel_chat_refs not available (run migration 0046?):", e?.message || e);
          }

          /* Gamify progress + rubric rows + the app_settings toggles — degrade
             gracefully if migration 0050 hasn't run. gamify_rubric is windowed
             (G1: it grows per graded reel). The toggles ride along in the same
             SET_GAMIFY_BUNDLE dispatch. */
          try {
            const [gpRes, grRes, gsRes] = await Promise.all([
              supabase.from("gamify_progress").select("*"),
              supabase.from("gamify_rubric").select("*")
                .order("created_at", { ascending: false })
                .limit(RECENT_WINDOW),
              supabase.from("app_settings").select("key,value")
                .in("key", ["gamify_enabled", "unified_cards", "gamify_grading_mode", "gamify_rubric_desc_mode", "gamify_hidden_subskills"]),
            ]);
            if (gpRes.error) throw gpRes.error;
            if (grRes.error) throw grRes.error;
            let gamifyEnabled = false;
            let unifiedCards = false;
            let gamifyGradingMode = "editor+reviewer";
            let rubricDescMode = "all";
            let gamifyHiddenSubskills = {};
            for (const s of (gsRes.data || [])) {
              if (s.key === "gamify_enabled") gamifyEnabled = !!s.value?.enabled;
              if (s.key === "unified_cards") unifiedCards = !!s.value?.enabled;
              if (s.key === "gamify_grading_mode" && s.value?.mode) gamifyGradingMode = s.value.mode;
              if (s.key === "gamify_rubric_desc_mode" && s.value?.mode) rubricDescMode = s.value.mode;
              if (s.key === "gamify_hidden_subskills") gamifyHiddenSubskills = normalizeHiddenSubskills(s.value);
            }
            if (!cancelled) dispatch({ type: "SET_GAMIFY_BUNDLE", payload: {
              gamifyProgress: (gpRes.data || []).map(gamifyProgressFromDb),
              gamifyRubrics: (grRes.data || []).map(gamifyRubricFromDb),
              gamifyEnabled, unifiedCards, gamifyGradingMode, rubricDescMode, gamifyHiddenSubskills,
            }});
          } catch (e) {
            console.warn("gamify not available (run migration 0050?):", e?.message || e);
          }

          /* Owner per-field training-module content overrides — degrade to {}
             if migration 0055 hasn't run (defaults live in code). */
          try {
            const mcRes = await supabase
              .from("training_module_content")
              .select("module_id, field_path, value");
            if (mcRes.error) throw mcRes.error;
            const moduleContent = {};
            for (const row of (mcRes.data || [])) {
              (moduleContent[row.module_id] ||= {})[row.field_path] = row.value;
            }
            if (!cancelled) dispatch({ type: "SET_MODULE_CONTENT_ALL", moduleContent });
          } catch (e) {
            console.warn("training_module_content not available (run migration 0055?):", e?.message || e);
          }
        })();
      } catch (e) {
        if (cancelled) return;
        console.error("Hydrate failed:", e);
        dispatch({ type: "SET_ERROR", error: e.message || String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* WS3 role gate — is the signed-in person the owner? FAIL-OPEN: when the
     auth person hasn't resolved yet (role unknown), treat as owner so the
     owner-only secondary fetches/realtime still run and boot is never bricked;
     the optimization (editors skip these queries) kicks in once role resolves
     to a non-owner. Mirrors the auth-person-keyed pattern of CLAUDE.md rule #6. */
  const _ownerKnown = !!_authPerson?.id;
  /* Match the UI's owner-equivalent treatment (permissions.jsx isOwnerRole /
     app.jsx useIsOwner): reviewer Leroy Crosby (id 'maya') is UI-permitted to
     open the Monitor hub, so the store must run the same owner-only secondary
     fetches + realtime channels for him — otherwise he sees empty data with no
     live updates once his role resolves to 'reviewer' (fail-closed regression). */
  const _isOwner =
    !_ownerKnown ||
    _authPerson?.role === "owner" ||
    _authPerson?.id === "maya";

  /* Owner-only secondary hydration (WS3 C1) — monitor_events, monitor_sources,
     monitor_event_links, ig_sync_runs, ig_ingest_log, thumbnail_dna. Editors
     skip these queries entirely. Keyed on the resolved auth person so it re-runs
     once role is known (fail-open: runs while role is unknown). Every block keeps
     its own missing-table try/catch degrade-to-[]. */
  React.useEffect(() => {
    if (!_isOwner) return;
    let cancelled = false;
    (async () => {
      /* Thumbnail DNA — degrades to [] until migration 0063. Windowed. */
      try {
        const thumbnailRes = await supabase
          .from("thumbnail_dna").select("*")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(RECENT_WINDOW);
        if (thumbnailRes.error) throw thumbnailRes.error;
        if (!cancelled) dispatch({ type: "SET_THUMBNAIL_DNA", items: (thumbnailRes.data || []).map(thumbnailFromDb) });
      } catch (e) {
        console.warn("thumbnail_dna not available (run migration 0063?):", e?.message || e);
      }

      /* Pulse Monitor events — the chattiest grower. Degrades to [] until
         migration 0059. Windowed by BOTH a 90-day gate and a row cap, per
         the frozen index contract (monitor_events_created_idx). */
      try {
        const monitorRes = await supabase
          .from("monitor_events").select("*")
          .gte("created_at", monitorEventsSince())
          .order("created_at", { ascending: false })
          .limit(MONITOR_EVENTS_WINDOW);
        if (monitorRes.error) throw monitorRes.error;
        if (!cancelled) dispatch({ type: "SET_MONITOR_EVENTS", items: (monitorRes.data || []).map(monitorEventFromDb) });
      } catch (e) {
        console.warn("monitor_events not available (run migration 0059?)", e?.message || e);
      }

      /* IG DM sync runs (migration 0073) — already capped at 50. */
      try {
        const igRunsRes = await supabase
          .from("ig_sync_runs").select("*")
          .order("started_at", { ascending: false })
          .limit(50);
        if (igRunsRes.error) throw igRunsRes.error;
        if (!cancelled) dispatch({ type: "SET_IG_SYNC_RUNS", items: (igRunsRes.data || []).map(igSyncRunFromDb) });
      } catch (e) {
        console.warn("ig_sync_runs not available (run migration 0073?)", e?.message || e);
      }

      /* IG DM ingest log (migration 0074) — already capped at 200. */
      try {
        const igLogRes = await supabase
          .from("ig_ingest_log").select("*")
          .order("occurred_at", { ascending: false })
          .limit(200);
        if (igLogRes.error) throw igLogRes.error;
        if (!cancelled) dispatch({ type: "SET_IG_INGEST_LOG", items: (igLogRes.data || []).map(igIngestLogFromDb) });
      } catch (e) {
        console.warn("ig_ingest_log not available (run migration 0074?)", e?.message || e);
      }

      /* Pulse Monitor sources (migration 0060) — owner-curated, small; no
         window needed (a handful of feed rows). */
      try {
        const sourcesRes = await supabase
          .from("monitor_sources").select("*")
          .order("created_at", { ascending: true });
        if (sourcesRes.error) throw sourcesRes.error;
        if (!cancelled) dispatch({ type: "SET_MONITOR_SOURCES", items: (sourcesRes.data || []).map(monitorSourceFromDb) });
      } catch (e) {
        console.warn("monitor_sources not available (run migration 0060?)", e?.message || e);
      }

      /* Monitor event links (migration 0065) — windowed. */
      try {
        const linksRes = await supabase
          .from("monitor_event_links").select("*")
          .order("created_at", { ascending: false })
          .limit(RECENT_WINDOW);
        if (linksRes.error) throw linksRes.error;
        if (!cancelled) dispatch({ type: "SET_EVENT_LINKS", items: (linksRes.data || []).map(eventLinkFromDb) });
      } catch (e) {
        console.warn("monitor_event_links not available (run migration 0065?)", e?.message || e);
      }
    })();
    return () => { cancelled = true; };
  }, [_isOwner]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Per-user preferences (pipeline collapse state, hidden lanes).
     Fired separately so auth must be resolved first — depends on _authPerson.id.
     Degrades gracefully if migration 0070 hasn't been applied yet. */
  React.useEffect(() => {
    if (!_authPerson?.id) return;
    (async () => {
      try {
        const { data } = await supabase
          .from("user_preferences").select("key, value")
          .eq("person_id", _authPerson.id)
          .in("key", ["pipeline_collapsed", "pipeline_hidden_lanes", "prefetch_heavy_tabs", "reel_dna_hidden_cols", "reel_dna_visited"]);
        for (const row of (data || [])) {
          if (row.key === "pipeline_collapsed")
            dispatch({ type: "SET_COLLAPSED_REEL_IDS", ids: row.value?.ids || [] });
          if (row.key === "pipeline_hidden_lanes")
            dispatch({ type: "SET_HIDDEN_LANE_IDS", ids: row.value?.ids || [] });
          if (row.key === "prefetch_heavy_tabs")
            dispatch({ type: "SET_PREFETCH_HEAVY_TABS", next: !!row.value?.enabled });
          if (row.key === "reel_dna_hidden_cols")
            dispatch({ type: "SET_HIDDEN_REEL_DNA_COLS", keys: row.value?.keys || [] });
          if (row.key === "reel_dna_visited")
            dispatch({ type: "SET_VISITED_REEL_DNA", ids: row.value?.ids || [], last: row.value?.last || null });
        }
      } catch (e) {
        console.warn("user_preferences not available (run migration 0070?):", e?.message || e);
      }
    })();
  }, [_authPerson?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Music library (favorites + playlists, migration 0093) — per-user, auth-keyed.
     Mirrors the user_preferences effect: depends on _authPerson.id, degrades to []
     if 0093 hasn't been applied yet (a missing table must never brick boot). */
  React.useEffect(() => {
    if (!_authPerson?.id) return;
    (async () => {
      try {
        const [favRes, plRes] = await Promise.all([
          supabase.from("music_favorites").select("*").eq("person_id", _authPerson.id),
          supabase.from("music_playlists").select("*").eq("person_id", _authPerson.id).order("created_at", { ascending: false }),
        ]);
        if (favRes.error) throw favRes.error;
        if (plRes.error) throw plRes.error;
        dispatch({ type: "SET_MUSIC_FAVORITES", items: (favRes.data || []).map(musicFavoriteFromDb) });
        const playlists = (plRes.data || []).map(musicPlaylistFromDb);
        dispatch({ type: "SET_MUSIC_PLAYLISTS", items: playlists });
        // Playlist membership for the user's own playlists (RLS also scopes it).
        const ids = playlists.map(p => p.id);
        if (ids.length) {
          const { data: ptData, error: ptErr } = await supabase
            .from("music_playlist_tracks").select("*").in("playlist_id", ids)
            .order("position", { ascending: true });
          if (ptErr) throw ptErr;
          dispatch({ type: "SET_MUSIC_PLAYLIST_TRACKS", items: (ptData || []).map(musicPlaylistTrackFromDb) });
        } else {
          dispatch({ type: "SET_MUSIC_PLAYLIST_TRACKS", items: [] });
        }
      } catch (e) {
        console.warn("music library not available (run migration 0093?):", e?.message || e);
      }
    })();
  }, [_authPerson?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Realtime sync — once the initial hydrate completes, open a
     postgres-changes channel for reels / review_lane_cards /
     tasks. Each payload is normalised through the same fromDb()
     mappers used at hydrate, then merged via UPSERT / DELETE_BY_ID
     reducer cases.

     Echoes of this client's own writes arrive too — they are
     idempotent (UPSERT replaces with the same row, DELETE_BY_ID
     is a no-op on already-removed rows), so we don't bother
     filtering them out. */

  /* G3 realtime trim — debounced batcher for the three CHATTY unfiltered
     poller tables (monitor_events, reel_dna_assets, ig_ingest_log). The
     Hetzner ingesters insert these in tight bursts (a news/world sync, an
     IG-DM sync), and one dispatch + render per row pinned the main thread.
     Instead we QUEUE each op and flush the whole burst as a single BATCH_*
     dispatch (one reducer pass, one render) on a short trailing debounce. The
     CORE collaboration channel (reels / review_lane_cards / tasks /
     daily_tasks / reel_dna) stays immediate — its writes are human-paced and
     latency-sensitive. Ops are applied in arrival order, so an UPSERT followed
     by a DELETE of the same id resolves correctly. */
  const rtBatchRef = React.useRef({
    monitor_events: { type: "BATCH_MONITOR_EVENTS", ops: [], timer: null },
    reel_dna_assets: { type: "BATCH_REEL_DNA_ASSETS", ops: [], timer: null },
    ig_ingest_log: { type: "BATCH_IG_INGEST_LOG", ops: [], timer: null },
  });
  const RT_BATCH_MS = 400;
  const queueRtOp = React.useCallback((table, op) => {
    const slot = rtBatchRef.current[table];
    if (!slot) return;
    slot.ops.push(op);
    if (slot.timer) return;
    slot.timer = setTimeout(() => {
      const ops = slot.ops;
      slot.ops = [];
      slot.timer = null;
      if (ops.length) dispatch({ type: slot.type, ops });
    }, RT_BATCH_MS);
  }, []);
  // Flush any pending batches on unmount so a burst mid-debounce isn't lost.
  React.useEffect(() => () => {
    const slots = rtBatchRef.current;
    for (const k of Object.keys(slots)) {
      const slot = slots[k];
      if (slot.timer) { clearTimeout(slot.timer); slot.timer = null; }
      if (slot.ops.length) { const ops = slot.ops; slot.ops = []; dispatch({ type: slot.type, ops }); }
    }
  }, []);

  React.useEffect(() => {
    if (!state.loaded) return;
    // Demo sessions stay purely local after the initial hydrate so concurrent
    // friends on the same login never see each other's changes (and a reset_demo
    // re-seed by the owner doesn't yank their in-progress sandbox out from under them).
    if (_isDemo) return;
    const channel = supabase
      .channel("workflow-realtime")
      .on("postgres_changes",
          { event: "*", schema: "public", table: "reels" },
          (payload) => {
            if (payload.eventType === "DELETE") {
              dispatch({ type: "DELETE_REEL_BY_ID", id: payload.old?.id });
            } else if (payload.new) {
              dispatch({ type: "UPSERT_REEL", reel: reelFromDb(payload.new) });
            }
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "review_lane_cards" },
          (payload) => {
            if (payload.eventType === "DELETE") {
              dispatch({ type: "DELETE_CARD_BY_ID", id: payload.old?.id });
            } else if (payload.new) {
              dispatch({ type: "UPSERT_CARD", card: cardFromDb(payload.new) });
            }
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "tasks" },
          (payload) => {
            if (payload.eventType === "DELETE") {
              dispatch({ type: "DELETE_TASK_BY_ID", id: payload.old?.id });
            } else if (payload.new) {
              dispatch({ type: "UPSERT_TASK", task: taskFromDb(payload.new) });
            }
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "attached_footage_items" },
          (payload) => {
            if (payload.eventType === "DELETE") {
              dispatch({ type: "DELETE_ATTACHED_FOOTAGE_BY_ID", id: payload.old?.id });
            } else if (payload.new) {
              dispatch({ type: "UPSERT_ATTACHED_FOOTAGE", item: payload.new });
            }
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "daily_tasks" },
          (payload) => {
            if (payload.eventType === "DELETE") {
              dispatch({ type: "DELETE_DAILY_TASK", id: payload.old?.id });
            } else if (payload.new) {
              dispatch({ type: "UPSERT_DAILY_TASK", item: dailyTaskFromDb(payload.new) });
            }
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "reel_dna" },
          (payload) => {
            if (payload.eventType === "DELETE") {
              dispatch({ type: "DELETE_REEL_DNA_BY_ID", id: payload.old?.id });
            } else if (payload.new?.deleted_at) {
              // Soft-delete arrives as an UPDATE — drop it from the view (and
              // keep it out across other tabs) rather than re-adding it.
              dispatch({ type: "DELETE_REEL_DNA_BY_ID", id: payload.new.id });
            } else if (payload.new) {
              // This is how IG-DM captures (inserted by the Hetzner webhook)
              // appear in the tab live, with no refresh.
              dispatch({ type: "UPSERT_REEL_DNA", item: reelDnaFromDb(payload.new) });
            }
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "thumbnail_dna" },
          (payload) => {
            if (payload.eventType === "DELETE") {
              dispatch({ type: "DELETE_THUMBNAIL_DNA_BY_ID", id: payload.old?.id });
            } else if (payload.new?.deleted_at) {
              // Soft-delete arrives as an UPDATE — drop it from the view rather
              // than re-adding it.
              dispatch({ type: "DELETE_THUMBNAIL_DNA_BY_ID", id: payload.new.id });
            } else if (payload.new) {
              // A capture made in another tab appears live, no refresh.
              dispatch({ type: "UPSERT_THUMBNAIL_DNA", item: thumbnailFromDb(payload.new) });
            }
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "music_tracks" },
          (payload) => {
            // Mirrors thumbnail_dna's realtime handler on its OWN channel.
            // Tolerant of the table being absent (the subscription simply never
            // fires) so a missing migration 0092 can't brick boot.
            if (payload.eventType === "DELETE") {
              dispatch({ type: "DELETE_MUSIC_TRACK_BY_ID", id: payload.old?.id });
            } else if (payload.new) {
              // A track cached in another tab appears live, no refresh.
              dispatch({ type: "UPSERT_MUSIC_TRACK", item: musicTrackFromDb(payload.new) });
            }
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "reel_chat_refs" },
          (payload) => {
            if (payload.eventType === "DELETE") {
              dispatch({ type: "DELETE_REEL_CHAT_REF_BY_ID", id: payload.old?.id });
            } else if (payload.new) {
              // A teammate's "Discuss" link appears live on the reel card.
              dispatch({ type: "UPSERT_REEL_CHAT_REF", item: reelChatRefsFromDb(payload.new) });
            }
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "gamify_progress" },
          (payload) => {
            if (payload.new) {
              dispatch({ type: "UPSERT_GAMIFY_PROGRESS", item: gamifyProgressFromDb(payload.new) });
            }
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "gamify_rubric" },
          (payload) => {
            if (payload.eventType === "DELETE") {
              dispatch({ type: "DELETE_GAMIFY_RUBRIC_BY_ID", id: payload.old?.id });
            } else if (payload.new) {
              dispatch({ type: "UPSERT_GAMIFY_RUBRIC", item: gamifyRubricFromDb(payload.new) });
            }
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "app_settings", filter: "key=eq.gamify_enabled" },
          (payload) => {
            if (payload.new) dispatch({ type: "SET_GAMIFY_ENABLED", enabled: !!payload.new.value?.enabled });
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "app_settings", filter: "key=eq.unified_cards" },
          (payload) => {
            if (payload.new) dispatch({ type: "SET_UNIFIED_CARDS", enabled: !!payload.new.value?.enabled });
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "app_settings", filter: "key=eq.gamify_grading_mode" },
          (payload) => {
            if (payload.new?.value?.mode) dispatch({ type: "SET_GAMIFY_GRADING_MODE", mode: payload.new.value.mode });
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "app_settings", filter: "key=eq.gamify_rubric_desc_mode" },
          (payload) => {
            if (payload.new?.value?.mode) dispatch({ type: "SET_RUBRIC_DESC_MODE", mode: payload.new.value.mode });
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "app_settings", filter: "key=eq.gamify_hidden_subskills" },
          (payload) => {
            dispatch({ type: "SET_GAMIFY_HIDDEN_SUBSKILLS", map: normalizeHiddenSubskills(payload.new?.value) });
          })
      .subscribe((status, err) => {
        // A postgres_changes listener for a table that isn't in the
        // supabase_realtime publication sends the WHOLE channel to
        // CHANNEL_ERROR — every listener (incl. daily_tasks) then goes dark,
        // silently. Surface it so the next missing-publication bug is obvious
        // (the fix is an ALTER PUBLICATION ... ADD TABLE migration).
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(
            `workflow-realtime subscription ${status}. Live updates are OFF. ` +
            `Most likely a subscribed table is missing from the supabase_realtime ` +
            `publication — add it via an ALTER PUBLICATION migration.`,
            err || "");
        }
      });

    /* Pulse Monitor lives on its OWN channel so a missing monitor_events
       table (migration 0059 not yet applied) only kills its own realtime —
       not workflow-realtime, which carries every other tab's live updates.
       Wrapped in try/catch in case the channel constructor itself throws. */
    let monitorChannel = null;
    if (_isOwner) try {
      monitorChannel = supabase
        .channel("monitor-events-realtime")
        .on("postgres_changes",
            { event: "*", schema: "public", table: "monitor_events" },
            (payload) => {
              // G3: debounced-batched — bursty ingester writes collapse into one render.
              if (payload.eventType === "DELETE") {
                queueRtOp("monitor_events", { kind: "delete", id: payload.old?.id });
              } else if (payload.new) {
                queueRtOp("monitor_events", { kind: "upsert", item: monitorEventFromDb(payload.new) });
              }
            })
        .on("postgres_changes",
            { event: "*", schema: "public", table: "monitor_sources" },
            (payload) => {
              // Source toggles/adds + the ingester's last_status writes reflect live.
              if (payload.eventType === "DELETE") {
                dispatch({ type: "DELETE_MONITOR_SOURCE_BY_ID", id: payload.old?.id });
              } else if (payload.new) {
                dispatch({ type: "UPSERT_MONITOR_SOURCE", item: monitorSourceFromDb(payload.new) });
              }
            })
        .on("postgres_changes",
            { event: "*", schema: "public", table: "monitor_event_links" },
            (payload) => {
              // Event→card links added/removed by the owner reflect live.
              if (payload.eventType === "DELETE") {
                dispatch({ type: "DELETE_EVENT_LINK_BY_ID", id: payload.old?.id });
              } else if (payload.new) {
                dispatch({ type: "UPSERT_EVENT_LINK", item: eventLinkFromDb(payload.new) });
              }
            })
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn(
              `monitor-events-realtime ${status} — live monitor updates OFF ` +
              `(monitor_events likely not in supabase_realtime publication; ` +
              `run migration 0059).`,
              err || "");
          }
        });
    } catch (e) {
      console.warn("monitor-events-realtime channel registration failed:", e?.message || e);
    }

    /* reel_dna_assets lives on its OWN channel so a missing table (migration
       0067 not yet applied) only kills its own realtime — not workflow-realtime,
       which carries every other tab's live updates. Mirrors the monitor channel
       pattern above (defensive try/catch around registration). */
    let reelDnaAssetsChannel = null;
    try {
      reelDnaAssetsChannel = supabase
        .channel("reel-dna-assets-realtime")
        .on("postgres_changes",
            { event: "*", schema: "public", table: "reel_dna_assets" },
            (payload) => {
              // Attach/detach made on any card by any teammate reflects live.
              // G3: debounced-batched (send-to-pipeline can attach many at once).
              if (payload.eventType === "DELETE") {
                queueRtOp("reel_dna_assets", { kind: "delete", id: payload.old?.id });
              } else if (payload.new) {
                queueRtOp("reel_dna_assets", { kind: "upsert", item: reelDnaAssetFromDb(payload.new) });
              }
            })
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn(
              `reel-dna-assets-realtime ${status} — live asset updates OFF ` +
              `(reel_dna_assets likely not in supabase_realtime publication; ` +
              `run migration 0067).`,
              err || "");
          }
        });
    } catch (e) {
      console.warn("reel-dna-assets-realtime channel registration failed:", e?.message || e);
    }

    /* IG DM sync runs + ingest log live on their OWN channel so a missing table
       (migrations 0073/0074 not yet applied) only kills its own realtime — not
       workflow-realtime. Mirrors the monitor-events-realtime pattern above. */
    let igSyncChannel = null;
    if (_isOwner) try {
      igSyncChannel = supabase
        .channel("ig-sync-realtime")
        .on("postgres_changes",
            { event: "*", schema: "public", table: "ig_sync_runs" },
            (payload) => {
              if (payload.eventType === "DELETE") {
                dispatch({ type: "DELETE_IG_SYNC_RUN_BY_ID", id: payload.old?.id });
              } else if (payload.new) {
                dispatch({ type: "UPSERT_IG_SYNC_RUN", item: igSyncRunFromDb(payload.new) });
              }
            })
        .on("postgres_changes",
            { event: "*", schema: "public", table: "ig_ingest_log" },
            (payload) => {
              // G3: debounced-batched — an IG sync writes one row per DM processed.
              if (payload.eventType === "DELETE") {
                queueRtOp("ig_ingest_log", { kind: "delete", id: payload.old?.id });
              } else if (payload.new) {
                queueRtOp("ig_ingest_log", { kind: "upsert", item: igIngestLogFromDb(payload.new) });
              }
            })
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn(
              `ig-sync-realtime ${status} — live IG-sync updates OFF ` +
              `(ig_sync_runs/ig_ingest_log likely not in supabase_realtime publication; ` +
              `run migrations 0073/0074).`,
              err || "");
          }
        });
    } catch (e) {
      console.warn("ig-sync-realtime channel registration failed:", e?.message || e);
    }

    /* OpenCut edit_projects gallery realtime — its OWN channel so a missing
       table (migration 0094 not applied) only kills its own realtime, not
       workflow-realtime. Drives the gallery list + thumbnail/rename/lock-badge.
       NOTE: this is the GALLERY-LEVEL stream (whole-table) — the per-PROJECT
       id=eq row stream for the open editor is OWNED BY TEAM_COLLAB's editor
       channel, NOT here (no filter:"id=eq.X" listener belongs in the store). */
    let editProjectsChannel = null;
    try {
      editProjectsChannel = supabase
        .channel("edit-projects-realtime")
        .on("postgres_changes",
            { event: "*", schema: "public", table: "edit_projects" },
            (payload) => {
              if (payload.eventType === "DELETE") {
                dispatch({ type: "DELETE_EDIT_PROJECT_BY_ID", id: payload.old?.id });
              } else if (payload.new) {
                // A new project, rename, thumbnail set, or autosave from any
                // teammate reflects live on the gallery list.
                dispatch({ type: "UPSERT_EDIT_PROJECT", item: editProjectFromDb(payload.new) });
              }
            })
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn(
              `edit-projects-realtime ${status} — live editor-gallery updates OFF ` +
              `(edit_projects likely not in supabase_realtime publication; ` +
              `run migration 0094).`,
              err || "");
          }
        });
    } catch (e) {
      console.warn("edit-projects-realtime channel registration failed:", e?.message || e);
    }

    /* editor_locks realtime — its OWN channel so a missing table only kills its
       own realtime. Drives the GLOBAL lock badges on the gallery (who holds the
       single-writer lock on each project). Keyed by project_id in the reducer. */
    let editorLocksChannel = null;
    try {
      editorLocksChannel = supabase
        .channel("editor-locks-realtime")
        .on("postgres_changes",
            { event: "*", schema: "public", table: "editor_locks" },
            (payload) => {
              if (payload.eventType === "DELETE") {
                // Release/expiry — clear the project's lock badge.
                dispatch({ type: "DELETE_EDITOR_LOCK", projectId: payload.old?.project_id });
              } else if (payload.new) {
                // A teammate took/renewed the single-writer lock — show the badge.
                dispatch({ type: "UPSERT_EDITOR_LOCK", item: editorLockFromDb(payload.new) });
              }
            })
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn(
              `editor-locks-realtime ${status} — live lock badges OFF ` +
              `(editor_locks likely not in supabase_realtime publication; ` +
              `run migration 0094).`,
              err || "");
          }
        });
    } catch (e) {
      console.warn("editor-locks-realtime channel registration failed:", e?.message || e);
    }

    return () => {
      supabase.removeChannel(channel);
      if (monitorChannel) { try { supabase.removeChannel(monitorChannel); } catch (_) {} }
      if (reelDnaAssetsChannel) { try { supabase.removeChannel(reelDnaAssetsChannel); } catch (_) {} }
      if (igSyncChannel) { try { supabase.removeChannel(igSyncChannel); } catch (_) {} }
      if (editProjectsChannel) { try { supabase.removeChannel(editProjectsChannel); } catch (_) {} }
      if (editorLocksChannel) { try { supabase.removeChannel(editorLocksChannel); } catch (_) {} }
    };
  }, [state.loaded, _isDemo, queueRtOp, _isOwner]);

  // Helper: dispatch locally, then persist. If persist fails,
  // log and surface — local state stays optimistic.
  const stateRef = React.useRef(state);
  React.useEffect(() => { stateRef.current = state; }, [state]);

  // Current user's role, for the gamify editor-lock guard (owner can override).
  const authRoleRef = React.useRef(_authPerson?.role);
  React.useEffect(() => { authRoleRef.current = _authPerson?.role; }, [_authPerson?.role]);

  /* OpenCut autosave debounce state (saveEditProjectTimeline). Per-project
     timers in a ref so a stable useMemo'd action can debounce without re-creating
     on every render. For each project we track:
       · idle  — the trailing-edge ~800ms idle timer (reset on each call)
       · maxTs — the timestamp of the FIRST pending edit (enforces a ~4s max-wait
                 ceiling so a continuously-typing user still gets periodic flushes)
       · pending — the latest { id, timelineJson } to persist on flush
     Cleared on unmount (flush is NOT forced on unmount — the optimistic local doc
     is already in state; the lock holder's next edit re-arms the save). */
  const autosaveRef = React.useRef(new Map());
  React.useEffect(() => {
    const map = autosaveRef.current;
    return () => { for (const e of map.values()) { try { clearTimeout(e.idle); } catch (_) {} } map.clear(); };
  }, []);

  /* Gamify editor-lock guard. Returns true if a reassignment of `reel` to
     `toOwner` should be BLOCKED for the current caller. A reel locks once
     work has started (stage past not_started) or any XP is graded.
       · non-owner → hard-blocked (returns true)
       · owner     → asked to confirm; blocked only if they decline
     A no-op move (same owner) is never blocked. */
  const blockLockedReassign = React.useCallback((reel, toOwner) => {
    if (!reel) return false;
    if (toOwner === undefined || toOwner === reel.owner) return false; // not a reassignment
    const cur = stateRef.current;
    if (!cur.gamifyEnabled) return false;            // lock only matters when gamify is on
    if (!isReelLocked(reel, cur.gamifyRubrics)) return false; // not locked

    if (authRoleRef.current === "owner") {
      // Owner override — confirm, since XP stays with the original editor.
      const toName = (typeof personName === "function" && personName(toOwner)) || toOwner;
      const ok = typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm(
            `${reel.id} is locked to its current editor.\n\n` +
            `Reassign to ${toName} anyway? Any XP already earned stays with the original editor.`)
        : true;
      return !ok; // block if they declined
    }
    return true; // non-owner: hard block
  }, []);

  const wrap = React.useCallback((dispatchAction, persistFn) => {
    dispatch(dispatchAction);
    if (persistFn) {
      persistFn(stateRef.current).catch(e => {
        console.error("Persist failed:", e);
        dispatch({ type: "SET_ERROR", error: e.message || String(e) });
      });
    }
  }, []);

  /* G4 (MEMO NARROW) — DEFERRED as a documented RISK.
     This memo rebuilds (and therefore re-renders every useWorkflow() consumer)
     on ANY state change, because the public context value is a SINGLE flat
     object that inlines every state slice + the actions bundle. Narrowing it
     safely (split read-only contexts, or context selectors) would require
     consumers to opt into specific slices — i.e. it CANNOT be done without
     changing the useWorkflow() public return shape, which the contract forbids
     touching (no consumer file may change). Composing internal split contexts
     while still exposing one merged object here doesn't reduce re-renders: the
     merged object's identity still changes whenever any slice does. So G4 is
     left as a follow-up that must land WITH the consumer migration (a
     `useWorkflow(selector)` / per-slice hooks API), not inside store.jsx alone.
     G1–G3 above already cut the dominant re-render driver — the bursty,
     unbounded poller tables — which is where the scale pain actually came from. */
  const value = React.useMemo(() => ({
    reels: state.reels,
    reviewLaneCards: state.reviewLaneCards,
    tasks: state.tasks,
    attachedFootage: state.attachedFootage,
    dailyTasks: state.dailyTasks,
    reelDna: state.reelDna,
    thumbnailDna: state.thumbnailDna,
    musicTracks: state.musicTracks,
    musicFavorites: state.musicFavorites,
    musicPlaylists: state.musicPlaylists,
    musicPlaylistTracks: state.musicPlaylistTracks,
    monitorEvents: state.monitorEvents,
    monitorSources: state.monitorSources,
    eventLinks: state.eventLinks,
    reelDnaAssets: state.reelDnaAssets,
    locations: state.locations,
    reelChatRefs: state.reelChatRefs,
    gamifyProgress: state.gamifyProgress,
    gamifyRubrics: state.gamifyRubrics,
    gamifyEnabled: state.gamifyEnabled,
    unifiedCards: state.unifiedCards,
    gamifyGradingMode: state.gamifyGradingMode,
    rubricDescMode: state.rubricDescMode,
    gamifyHiddenSubskills: state.gamifyHiddenSubskills,
    moduleContent: state.moduleContent,
    collapsedReelIds: state.collapsedReelIds,
    hiddenLaneIds: state.hiddenLaneIds,
    prefetchHeavyTabs: state.prefetchHeavyTabs,
    hiddenReelDnaCols: state.hiddenReelDnaCols,
    visitedReelDnaIds: state.visitedReelDnaIds,
    lastVisitedReelDnaId: state.lastVisitedReelDnaId,
    // OpenCut collaborative editor (migration 0094) — gallery list + global locks.
    editProjects: state.editProjects,
    editorLocks: state.editorLocks,
    /* Is this reel locked to its editor? (gamify on + work started or graded).
       UI uses this to disable assign controls / show an owner confirm. */
    isReelLocked: (reelId) => {
      if (!state.gamifyEnabled) return false;
      const reel = state.reels.find(r => r.id === reelId);
      return isReelLocked(reel, state.gamifyRubrics);
    },
    loaded: state.loaded,
    error: state.error,
    dispatch,
    actions: {
      moveStage: (id, { lane, stage, scheduledPostDate }) => {
        /* Pre-build the audit-trail comment once so the optimistic
           reducer state and the persisted DB row use the same
           id/ts (no flicker on realtime echo). */
        const current = stateRef.current;
        const reel = current.reels.find(r => r.id === id) ||
                     current.reviewLaneCards.find(c => c.id === id);
        const isCard = !!reel?.parentId;

        /* Editor lock: a board drag onto a DIFFERENT person's lane is a
           reassignment. Block it if the reel is locked (and caller isn't
           owner). Moving between stage columns in the same lane is fine. */
        if (!isCard && lane !== undefined && lane !== "review" &&
            isKnownPerson(lane) && blockLockedReassign(reel, lane)) {
          dispatch({ type: "SET_ERROR",
            error: "Reel is locked to its editor — reassign from Not Started, or ask the owner." });
          return;
        }
        let systemComment = null;
        if (reel && !isCard && reel.stage !== stage) {
          const explicit = lane !== undefined && lane !== "review" && isKnownPerson(lane) && lane !== reel.owner;
          const reviewLane = lane === "review";
          const targetOwner = explicit ? lane :
            reviewLane ? (stageOwnerPersonId("review") || reel.owner) :
            reel.owner;
          const txt = "Stage: " + (reel.stage || "—") + " → " + stage +
            (targetOwner ? " · assigned to " + personName(targetOwner) : "");
          systemComment = buildSystemComment(txt);
        }
        wrap(
          { type: "MOVE_STAGE", id, lane, stage, scheduledPostDate, systemComment },
          (s) => persistMoveStage(s, id, { lane, stage, scheduledPostDate, systemComment }));
        if (stage === "in_progress") {
          const assignee = (lane && isKnownPerson(lane)) ? lane : reel?.owner;
          supabase.auth.getSession().then(({ data: { session } }) => {
            const token = session?.access_token;
            if (!token) return;
            fetch("/api/ai/suggest?action=discord-notify", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
              body: JSON.stringify({ reel_id: id, reel_title: reel?.title, assigned_to: assignee, stage }),
            }).catch(() => {});
          });
        }
      },

      updateReel: (id, patch) => {
        // Editor lock: block an owner-reassignment of a locked reel for
        // non-owner callers. Other field edits pass through untouched.
        if ("owner" in patch) {
          const reel = stateRef.current.reels.find(r => r.id === id);
          if (blockLockedReassign(reel, patch.owner)) {
            dispatch({ type: "SET_ERROR",
              error: "Reel is locked to its editor — reassign from Not Started, or ask the owner." });
            return;
          }
        }
        wrap(
          { type: "UPDATE_REEL", id, patch },
          (s) => persistUpdateReel(s, id, patch));
      },

      createReel: (reel) => wrap(
        { type: "CREATE_REEL", reel },
        () => persistCreateReel(reel)),

      /* Clone a reel into a fresh REEL id — title/script/audio/owner, the whole
         detail blob (plan, pins, rubric notes), attached footage rows, and the
         linked reel_dna card + its reel_dna_assets links. Human-authored gene
         data (reelUrl, platform, genesOfInterest, quickNotes, music, hook, font,
         story, sfx, timeline, location, contentType) is copied; machine-analysis
         fields (mediaStatus, narrative, progress, mediaError, sourceUrlResolved,
         analyzedAt, assetManifest, pacing) are intentionally NOT copied so the
         duplicate starts clean and can be re-analyzed independently.
         externalRef is cleared (unique index on non-null values).
         FK ordering: reels → attached_footage_items → reel_dna → reel_dna_assets. */
      duplicateReel: (id, targetPersonId, targetFirstName) => {
        const current = stateRef.current;
        const src = current.reels.find(r => r.id === id);
        if (!src) return;
        const newId = nextReelId(current.reels);
        const clonedDetail = src.detail
          ? { ...JSON.parse(JSON.stringify(src.detail)), comments: [] }
          : src.detail;
        const nameSuffix = targetFirstName ? ` (${targetFirstName})` : " (copy)";
        const clone = {
          ...src,
          id: newId,
          title: (src.title || "Reel") + nameSuffix,
          lane:  targetPersonId || src.lane,
          stage: targetPersonId ? "not_started" : src.stage,
          detail: clonedDetail,
          board_order: undefined,
          displayNumber: undefined,
          archivedAt: null,
          stageEnteredAt: new Date().toISOString(),
        };
        const footageClones = current.attachedFootage
          .filter(f => f.reel_id === id)
          .map(f => ({
            ...f,
            id: `footage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            reel_id: newId,
          }));

        // Clone the linked reel_dna card (if any). Only the first non-deleted
        // card is cloned — multiple linked cards are uncommon.
        // Fallback: if no linked DNA card exists but the reel has an inspo URL,
        // create a blank DNA card so every duplicate has the same structure.
        const srcDna = (current.reelDna || []).find(d => d.reelId === id && !d.deletedAt);
        let dnaClone = null;
        let assetClones = [];
        if (srcDna) {
          const newDnaId = crypto.randomUUID();
          dnaClone = {
            reelUrl:         srcDna.reelUrl,
            platform:        srcDna.platform,
            genesOfInterest: Array.isArray(srcDna.genesOfInterest) ? [...srcDna.genesOfInterest] : [],
            quickNotes:      srcDna.quickNotes,
            location:        srcDna.location,
            contentType:     srcDna.contentType,
            format:          srcDna.format,
            status:          "captured",
            source:          "manual",
            capturedBy:      srcDna.capturedBy,
            music:    srcDna.music    ? JSON.parse(JSON.stringify(srcDna.music))    : undefined,
            hook:     srcDna.hook     ? JSON.parse(JSON.stringify(srcDna.hook))     : undefined,
            font:     srcDna.font     ? JSON.parse(JSON.stringify(srcDna.font))     : undefined,
            story:    srcDna.story    ? JSON.parse(JSON.stringify(srcDna.story))    : undefined,
            sfx:      srcDna.sfx      ? JSON.parse(JSON.stringify(srcDna.sfx))      : undefined,
            timeline: Array.isArray(srcDna.timeline) ? JSON.parse(JSON.stringify(srcDna.timeline)) : undefined,
            id:          newDnaId,
            reelId:      newId,
            externalRef: null,
            archivedAt:  undefined,
            deletedAt:   undefined,
            createdAt:   new Date().toISOString(),
          };
          const srcAssets = (current.reelDnaAssets || []).filter(a => a.reelDnaId === srcDna.id);
          assetClones = srcAssets.map(a => ({
            id:        `${newDnaId}:${a.assetType}:${String(a.assetId)}`,
            reelDnaId: newDnaId,
            assetType: a.assetType,
            assetId:   String(a.assetId),
            label:     a.label,
            createdBy: _authPerson?.id ?? null,
            createdAt: new Date().toISOString(),
          }));
        } else if (src.inspo) {
          // Reel was generated or manually created with an inspo URL but no DNA
          // card. Create a blank card so duplicates always have the full structure.
          const newDnaId = crypto.randomUUID();
          dnaClone = {
            reelUrl:         src.inspo,
            platform:        platformFromUrl(src.inspo),
            genesOfInterest: [],
            status:          "captured",
            source:          "manual",
            capturedBy:      _authPerson?.id ?? null,
            id:              newDnaId,
            reelId:          newId,
            externalRef:     null,
            archivedAt:      undefined,
            deletedAt:       undefined,
            createdAt:       new Date().toISOString(),
          };
          // No asset links to clone — the source had none.
        }

        // ── Optimistic dispatches ────────────────────────────────────────────
        dispatch({ type: "CREATE_REEL", reel: clone });
        footageClones.forEach(item => dispatch({ type: "ADD_ATTACHED_FOOTAGE", item }));
        if (dnaClone) {
          dispatch({ type: "CREATE_REEL_DNA", item: dnaClone });
          assetClones.forEach(item => dispatch({ type: "UPSERT_REEL_DNA_ASSET", item }));
        }

        // ── Persist (sequential, FK order enforced) ──────────────────────────
        (async () => {
          try {
            await persistCreateReel(clone);
            for (const item of footageClones) await persistAddAttachedFootage(item);
            if (dnaClone) {
              await persistCreateReelDna(dnaClone);
              for (const a of assetClones) {
                await persistAttachAsset({
                  reel_dna_id: a.reelDnaId,
                  asset_type:  a.assetType,
                  asset_id:    a.assetId,
                  label:       a.label ?? null,
                  created_by:  a.createdBy ?? null,
                });
              }
            }
          } catch (e) {
            console.error("duplicateReel persist failed:", e);
            dispatch({ type: "SET_ERROR", error: e.message || String(e) });
          }
        })();
      },

      deleteReel: (id) => wrap(
        { type: "DELETE_REEL", id },
        () => persistDeleteReel(id)),

      /* Soft-archive: sets archived_at to now. Restorable.
         Use deleteReel for hard delete. */
      archiveReel: (id) => {
        const stamp = new Date().toISOString();
        wrap(
          { type: "UPDATE_REEL", id, patch: { archivedAt: stamp } },
          (s) => persistUpdateReel(s, id, { archivedAt: stamp }));
      },
      restoreReel: (id) => wrap(
        { type: "UPDATE_REEL", id, patch: { archivedAt: null } },
        (s) => persistUpdateReel(s, id, { archivedAt: null })),

      createTask: (task) => wrap(
        { type: "CREATE_TASK", task },
        () => persistCreateTask(task)),

      updateTask: (id, patch) => wrap(
        { type: "UPDATE_TASK", id, patch },
        () => persistUpdateTask(id, patch)),

      deleteTask: (id) => wrap(
        { type: "DELETE_TASK", id },
        () => persistDeleteTask(id)),

      addAttachedFootage: (item) => wrap(
        { type: "ADD_ATTACHED_FOOTAGE", item },
        () => persistAddAttachedFootage(item)),

      removeAttachedFootage: (id) => wrap(
        { type: "REMOVE_ATTACHED_FOOTAGE", id },
        () => persistRemoveAttachedFootage(id)),

      /* Save vision tags for a clip across every attachment that shares its
         footage_file_id. Fire-and-forget persist (like daily tasks) — no
         optimistic rollback needed; the user can just re-analyze. */
      setFootageTags: (footageFileId, tags) => {
        dispatch({ type: "SET_FOOTAGE_TAGS", footageFileId, tags });
        if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
        supabase.from("attached_footage_items")
          .update({ vision_tags: tags })
          .eq("footage_file_id", footageFileId)
          .then(({ error }) => {
            if (error) console.error("setFootageTags persist failed:", error);
          });
      },

      /* Create a reel AND its attached footage atomically-ish.
         The footage rows have a reel_id FK to reels.id, so the reel
         MUST be inserted into Supabase before the footage rows — the
         old approach fired both via wrap() concurrently, so footage
         inserts raced ahead of the reel and failed the FK silently.
         Here we dispatch optimistically, then persist sequentially. */
      createReelWithFootage: (reel, footageItems = []) => {
        dispatch({ type: "CREATE_REEL", reel });
        footageItems.forEach(item => dispatch({ type: "ADD_ATTACHED_FOOTAGE", item }));
        (async () => {
          try {
            await persistCreateReel(reel);
            for (const item of footageItems) {
              await persistAddAttachedFootage(item);
            }
          } catch (e) {
            console.error("createReelWithFootage persist failed:", e);
            dispatch({ type: "SET_ERROR", error: e.message || String(e) });
          }
        })();
      },

      /* Multi-editor fan-out: create one INDEPENDENT reel copy per editor, each
         in that editor's "Not started" lane, titled " (FirstName)". Mirrors
         createReelWithFootage / duplicateReel: optimistic dispatch then sequential
         FK-ordered persist (reel before its footage). The N reel ids are computed
         UP FRONT from the current reels so a batch never collides on nextReelId
         (which would otherwise hand out the same id to every editor). Each copy
         gets a FRESH copy of footageRows with new unique ids. Empty editors[] is a
         no-op. Never throws past the action (errors -> SET_ERROR). No reel_dna
         clone (matches createReelWithFootage scope); no orphan/base card. */
      createReelForEditors: (baseReel, footageRows = [], editors = []) => {
        if (!Array.isArray(editors) || editors.length === 0) return;
        const current = stateRef.current;

        // Compute N sequential REEL-NNN ids UP FRONT (no per-editor nextReelId).
        const nums = (current.reels || [])
          .map(r => { const m = /^REEL-(\d+)$/.exec(r?.id || ""); return m ? parseInt(m[1], 10) : -1; })
          .filter(n => n >= 0);
        const baseNum = nums.length ? Math.max(...nums) + 1 : 0;

        const now = new Date().toISOString();
        const groups = editors.map((editor, i) => {
          const newId = "REEL-" + String(baseNum + i).padStart(3, "0");
          const firstName = editor.firstName || editor.id;
          const reel = {
            ...baseReel,
            id: newId,
            title: ((baseReel && baseReel.title) || "Reel") + " (" + firstName + ")",
            owner: editor.id,
            lane: editor.id,
            stage: "not_started",
            board_order: undefined,
            displayNumber: undefined,
            stageEnteredAt: now,
          };
          const footage = (footageRows || []).map(f => ({
            ...f,
            id: `footage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            reel_id: newId,
          }));
          return { reel, footage };
        });

        // ── Optimistic dispatches (all reels, then all footage) ──────────────
        groups.forEach(g => dispatch({ type: "CREATE_REEL", reel: g.reel }));
        groups.forEach(g => g.footage.forEach(item => dispatch({ type: "ADD_ATTACHED_FOOTAGE", item })));

        // ── Persist (sequential, FK order enforced: reel before its footage) ──
        (async () => {
          try {
            for (const g of groups) {
              await persistCreateReel(g.reel);
              for (const item of g.footage) await persistAddAttachedFootage(item);
            }
          } catch (e) {
            console.error("createReelForEditors persist failed:", e);
            dispatch({ type: "SET_ERROR", error: e.message || String(e) });
          }
        })();
      },

      // Approve/SendBack/Triage compose existing primitives — they
      // produce a known target shape and a single UPDATE_REEL
      // persist is sufficient.
      approveReview: (id, opts = {}) => {
        const stamp = new Date().toISOString();
        const r = stateRef.current.reels.find(x => x.id === id);
        const by = opts.by || null;
        const history = appendRevisionEntry(r?.detail, {
          action: "approved", ts: stamp, by, note: "",
        });
        dispatch({ type: "APPROVE_REVIEW", id, stageEnteredAt: stamp, by });
        persistUpdateReel(stateRef.current, id, {
          stage: "completed", state: "ok", blocker: null,
          blockerRole: null, age: "approved",
          stageEnteredAt: stamp,
          next: "Hold for post window",
          detail: { ...(r?.detail || {}), revisionHistory: history },
        }).catch(e => {
          console.error(e);
          dispatch({ type: "SET_ERROR", error: e.message || String(e) });
        });
      },

      /* sendBack(id, { note?: string, by?: string })
         Routes the reel back to in_progress with the reviewer's note
         appended to detail.revisionHistory. The full history is
         preserved across review rounds so Paul/Leroy can see prior
         feedback when the reel comes back for re-review. */
      sendBack: (id, opts = {}) => {
        const r = stateRef.current.reels.find(x => x.id === id);
        const editor = ROLES.skilled?.person;
        const target = r?.prevOwner || editor || r?.owner;
        const stamp = new Date().toISOString();
        const note  = (opts.note || "").trim();
        const by    = opts.by || null;
        const history = appendRevisionEntry(r?.detail, {
          action: "sent_back", ts: stamp, by, note,
        });
        dispatch({ type: "SEND_BACK", id, stageEnteredAt: stamp, note, by });
        persistUpdateReel(stateRef.current, id, {
          stage: "in_progress", state: "warn",
          owner: target, lane: target,
          blocker: note ? "For revision · " + note.slice(0, 60) : "Sent back for revision",
          blockerRole: "skilled",
          age: "just now",
          stageEnteredAt: stamp,
          next: "Address review notes",
          detail: { ...(r?.detail || {}), revisionHistory: history },
        }).catch(e => {
          console.error(e);
          dispatch({ type: "SET_ERROR", error: e.message || String(e) });
        });
        supabase.auth.getSession().then(({ data: { session } }) => {
          const token = session?.access_token;
          if (!token) return;
          fetch("/api/ai/suggest?action=discord-notify", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ reel_id: id, reel_title: r?.title, assigned_to: target, stage: "in_progress", sent_back: true }),
          }).catch(() => {});
        });
      },

      triageIdea: (id, decision) => {
        const stamp = new Date().toISOString();
        dispatch({ type: "TRIAGE_IDEA", id, decision, stageEnteredAt: stamp });
        if (decision === "kill") {
          persistDeleteReel(id).catch(e => console.error(e));
        } else if (decision === "greenlight") {
          persistUpdateReel(stateRef.current, id, {
            stage: "selected", state: "ok", blocker: null,
            age: "queued", stageEnteredAt: stamp,
            next: "Start main edit",
          }).catch(e => console.error(e));
        } else if (decision === "defer") {
          persistUpdateReel(stateRef.current, id, {
            state: "warn", age: "deferred",
            next: "Revisit next cycle",
          }).catch(e => console.error(e));
        }
      },

      createDailyTask: async ({ assignedTo, createdBy, taskText, taskDate }) => {
        const maxOrder = stateRef.current.dailyTasks.reduce((m, t) => Math.max(m, t.sortOrder ?? -1), -1);
        const row = {
          id: crypto.randomUUID(),
          assigned_to: assignedTo,
          created_by: createdBy,
          task_text: taskText,
          task_date: taskDate || new Date().toISOString().slice(0, 10),
          completed: false,
          sort_order: maxOrder + 1,
        };
        dispatch({ type: "UPSERT_DAILY_TASK", item: {
          ...row,
          assignedTo: row.assigned_to,
          createdBy: row.created_by,
          taskText: row.task_text,
          taskDate: row.task_date,
          sortOrder: maxOrder + 1,
          // so the new task sorts correctly before the realtime echo lands
          created_at: new Date().toISOString(),
        }});
        if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
        // sort_order column may not exist yet (migration 0056) — degrade
        // gracefully: on a column-missing error, retry the insert without it.
        let { error } = await supabase.from("daily_tasks").insert(row);
        if (error && /sort_order|column|PGRST204/i.test(error.message || "")) {
          const { sort_order, ...rest } = row;
          error = (await supabase.from("daily_tasks").insert(rest)).error;
        }
        if (error) {
          console.error("createDailyTask persist failed:", error);
          dispatch({ type: "SET_ERROR", error: error.message || String(error) });
        }
      },

      /* Persist a manual drag-reorder of the daily-task list. Assigns
         sort_order by array index, optimistically reorders, then writes each
         row. Degrades gracefully if migration 0056 (sort_order) isn't applied
         yet — the order then persists locally only. */
      reorderDailyTasks: async (orderedIds) => {
        dispatch({ type: "REORDER_DAILY_TASKS", orderedIds });
        if (isDemoMode()) return;
        for (let i = 0; i < orderedIds.length; i++) {
          const { error } = await supabase.from("daily_tasks")
            .update({ sort_order: i }).eq("id", orderedIds[i]);
          if (error) {
            if (/sort_order|column|PGRST204/i.test(error.message || "")) {
              // 0056 not applied yet — order persists locally only; stop trying.
              console.warn("reorderDailyTasks: sort_order column missing (apply migration 0056)");
              return;
            }
            console.error("reorderDailyTasks persist failed:", error);
            dispatch({ type: "SET_ERROR", error: error.message || String(error) });
            return;
          }
        }
      },

      completeDailyTask: async (id, completed) => {
        const patch = { completed, completed_at: completed ? new Date().toISOString() : null };
        dispatch({ type: "UPSERT_DAILY_TASK", item: { id, completed, completedAt: patch.completed_at } });
        if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
        await supabase.from("daily_tasks").update(patch).eq("id", id).then(({ error }) => {
          if (error) {
            console.error("completeDailyTask persist failed:", error);
            dispatch({ type: "SET_ERROR", error: error.message || String(error) });
          }
        });
      },

      deleteDailyTask: async (id) => {
        dispatch({ type: "DELETE_DAILY_TASK", id });
        if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
        await supabase.from("daily_tasks").delete().eq("id", id).then(({ error }) => {
          if (error) {
            console.error("deleteDailyTask persist failed:", error);
            dispatch({ type: "SET_ERROR", error: error.message || String(error) });
          }
        });
      },

      updateDailyTask: async (id, patch) => {
        // patch can include: { taskText, notes, color }
        const dbPatch = {};
        if (patch.taskText !== undefined) dbPatch.task_text = patch.taskText;
        if (patch.notes     !== undefined) dbPatch.notes     = patch.notes;
        if (patch.color     !== undefined) dbPatch.color     = patch.color;
        dispatch({ type: "UPSERT_DAILY_TASK", item: { id, ...patch } });
        if (isDemoMode()) return;   // demo sandbox: optimistic-only, never persist
        await supabase.from("daily_tasks").update(dbPatch).eq("id", id).then(({ error }) => {
          if (error) {
            console.error("updateDailyTask persist failed:", error);
            dispatch({ type: "SET_ERROR", error: error.message || String(error) });
          }
        });
      },

      /* ----- Reel DNA ----- */

      /* Capture a reel from the manual form (or the share-target / bookmarklet,
         which pass source='share_target'). Optimistic: the card shows instantly,
         then persists. genesOfInterest is the set of genes the user flagged. */
      createReelDnaCapture: ({ reelUrl, platform, genesOfInterest = [], quickNotes,
                               capturedBy, source = "manual", location = null,
                               music, font, sfx, story, hook }) => {
        const item = {
          id: crypto.randomUUID(),
          reelUrl,
          platform: platform || "ig",
          genesOfInterest,
          quickNotes: quickNotes || null,
          status: "captured",
          source,
          capturedBy: capturedBy || null,
          location: location || null,
          // Per-gene jsonb objects, pre-filled from a parsed tag note (only the
          // ones actually present are written; reelDnaToDb passes them through).
          ...(music ? { music } : {}),
          ...(font ? { font } : {}),
          ...(sfx ? { sfx } : {}),
          ...(story ? { story } : {}),
          ...(hook ? { hook } : {}),
          createdAt: new Date().toISOString(),
        };
        wrap(
          { type: "CREATE_REEL_DNA", item },
          () => persistCreateReelDna(item));
        return item;
      },

      /* Patch any field: status changes, or per-gene jsonb edits like
         updateReelDna(id, { hook: { startTs, endTs, downloadLink } }). */
      updateReelDna: (id, patch) => wrap(
        { type: "UPDATE_REEL_DNA", id, patch },
        () => persistUpdateReelDna(id, patch)),

      /* Reel DNA longform (Phase 0) — flip a capture between short/long format.
         Thin wrapper over the updateReelDna path; format is 'short' | 'long'. */
      setReelDnaFormat: (id, format) => wrap(
        { type: "UPDATE_REEL_DNA", id, patch: { format } },
        () => persistUpdateReelDna(id, { format })),

      /* Reel DNA longform (Phase 0) — kick off the LLM deconstruction pipeline.
         (1) Optimistically flip media_status to 'pending_analyze' via the normal
         updateReelDna/persist path, so the UI reflects it instantly AND it
         persists — the Hetzner cron drains 'pending_analyze' rows even if the
         trigger fetch below never lands. (2) Fire-and-forget a POST to the
         Vercel proxy (?action=deconstruct) with the owner's Supabase JWT, modeled
         on triggerIgSync. A failed trigger must NOT throw uncaught: the row is
         already queued, so we swallow + surface the error like triggerIgSync and
         the cron picks it up. Returns the proxy body (or a degraded result). */
      analyzeReelDna: async (id) => {
        // Optimistic + persisted: row is queued before we ever hit the network.
        // Same dispatch+persist path as updateReelDna(id, { mediaStatus }).
        console.log("[Analyze] queuing id:", id);
        wrap(
          { type: "UPDATE_REEL_DNA", id, patch: { mediaStatus: "pending_analyze" } },
          async () => {
            try {
              await persistUpdateReelDna(id, { mediaStatus: "pending_analyze" });
              console.log("[Analyze] DB persist OK — media_status=pending_analyze written");
            } catch (e) {
              console.error("[Analyze] DB persist FAILED:", e);
              throw e;
            }
          });
        if (isDemoMode()) return { ok: false, demo: true };
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) throw new Error("Not signed in");
          console.log("[Analyze] firing Vercel proxy → Hetzner");
          const res = await fetch("/api/ai/suggest?action=deconstruct", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ id }),
          });
          const body = await res.json().catch(() => ({}));
          console.log("[Analyze] Vercel response:", res.status, body);
          if (!res.ok) throw new Error(body?.error || `Analyze trigger failed (${res.status})`);
          return body;
        } catch (e) {
          // Tolerate trigger failure — the row is already pending_analyze and the
          // Hetzner cron will drain it. Surface the error like triggerIgSync does.
          console.error("[Analyze] trigger failed:", e);
          dispatch({ type: "SET_ERROR", error: e.message || String(e) });
          return { ok: false, queued: true, error: e.message || String(e) };
        }
      },

      /* Soft-archive (restorable). */
      archiveReelDna: (id) => {
        const stamp = new Date().toISOString();
        wrap(
          { type: "UPDATE_REEL_DNA", id, patch: { archivedAt: stamp } },
          () => persistUpdateReelDna(id, { archivedAt: stamp }));
      },
      restoreReelDna: (id) => wrap(
        { type: "UPDATE_REEL_DNA", id, patch: { archivedAt: null } },
        () => persistUpdateReelDna(id, { archivedAt: null })),

      /* Permanent delete — gone from every view, not restorable in the UI
         (unlike archiveReelDna). Implemented as a SOFT delete: we stamp
         deleted_at and KEEP the row so its external_ref stays in the IG
         poller's "already captured" set — a hard row delete made the next
         poll (cron or Refresh) re-insert the same DM'd reel, so deleted cards
         kept coming back. Optimistically removed from local state so the card
         disappears instantly. */
      deleteReelDna: (id) => {
        const stamp = new Date().toISOString();
        wrap(
          { type: "DELETE_REEL_DNA_BY_ID", id },
          () => persistUpdateReelDna(id, { deletedAt: stamp }));
      },

      /* Re-fetch reel_dna from Supabase. The realtime subscription can miss
         inserts (tab asleep, dropped socket), so this is the manual catch-up
         behind the Refresh button. Returns the row count. */
      reloadReelDna: async () => {
        if (isDemoMode()) return (stateRef.current.reelDna || []).length;
        const { data, error } = await supabase
          .from("reel_dna").select("*")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(RECENT_WINDOW);
        if (error) throw error;
        const items = (data || []).map(reelDnaFromDb);
        dispatch({ type: "SET_REEL_DNA", items });
        return items.length;
      },

      /* loadMore (G1 follow-up): page in the next window of OLDER reel_dna rows
         past what's already loaded, ordered created_at DESC (matches the index
         contract). Appends (de-duped) rather than replacing. Returns the number
         of NEW rows fetched (0 = end of table). UI wiring is a follow-up. */
      loadMoreReelDna: async (limit = RECENT_WINDOW) => {
        if (isDemoMode()) return 0;
        const cur = stateRef.current.reelDna || [];
        const oldest = cur.length ? cur[cur.length - 1]?.createdAt : null;
        let q = supabase.from("reel_dna").select("*")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (oldest) q = q.lt("created_at", oldest);
        const { data, error } = await q;
        if (error) throw error;
        const items = (data || []).map(reelDnaFromDb);
        if (items.length) dispatch({ type: "APPEND_REEL_DNA", items });
        return items.length;
      },

      /* Re-pull the IG poller's run history + per-message issue log straight
         from Supabase — behind the "Check IG Sync" button. Lets the owner
         verify, on demand, what the last poll(s) saw vs what landed in the
         spreadsheet and surface any errors (graph errors, insert failures,
         skipped shares) even when the realtime socket missed them. Degrades to
         the current in-memory counts if the tables aren't there yet. Returns
         { runs, issues, latest } for the click handler's notice. */
      reloadIgSync: async () => {
        if (isDemoMode()) {
          return { runs: (stateRef.current.igSyncRuns || []).length,
                   issues: (stateRef.current.igIngestLog || []).length, latest: null };
        }
        const [runsRes, logRes] = await Promise.all([
          supabase.from("ig_sync_runs").select("*")
            .order("started_at", { ascending: false }).limit(50),
          supabase.from("ig_ingest_log").select("*")
            .order("occurred_at", { ascending: false }).limit(200),
        ]);
        if (runsRes.error) throw runsRes.error;
        if (logRes.error) throw logRes.error;
        const runs = (runsRes.data || []).map(igSyncRunFromDb);
        const log = (logRes.data || []).map(igIngestLogFromDb);
        dispatch({ type: "SET_IG_SYNC_RUNS", items: runs });
        dispatch({ type: "SET_IG_INGEST_LOG", items: log });
        return { runs: runs.length, issues: log.length, latest: runs[0] || null };
      },

      /* ----- Thumbnail DNA (separate table, manual YouTube capture) ----- */

      /* Capture a YouTube thumbnail from the manual paste-in form. Optimistic:
         the card shows instantly, then persists. RETURNS the item SYNCHRONOUSLY
         so the caller can use item.id for the best-effort oEmbed enrichment
         patch (title/channel) after the network round-trip. */
      createThumbnailDnaCapture: ({ videoUrl, videoId = null, thumbnailUrl = null,
                                    title = null, channel = null, platform = "yt",
                                    genesOfInterest = [], quickNotes = null,
                                    capturedBy = null, source = "manual",
                                    color = null, typography = null, face = null,
                                    layout = null, mood = null, subject = null }) => {
        const item = {
          id: crypto.randomUUID(),
          videoUrl,
          videoId,
          thumbnailUrl,
          title,
          channel,
          platform: platform || "yt",
          genesOfInterest,
          quickNotes,
          status: "captured",
          source,
          capturedBy,
          color, typography, face, layout, mood, subject,
          createdAt: new Date().toISOString(),
        };
        wrap(
          { type: "CREATE_THUMBNAIL_DNA", item },
          () => persistCreateThumbnailDna(item));
        return item;
      },

      /* Patch any field: status, the six gene text fields, title/channel
         enrichment, genesOfInterest chips, etc. */
      updateThumbnailDna: (id, patch) => wrap(
        { type: "UPDATE_THUMBNAIL_DNA", id, patch },
        () => persistUpdateThumbnailDna(id, patch)),

      /* Soft-archive (restorable). */
      archiveThumbnailDna: (id) => {
        const stamp = new Date().toISOString();
        wrap(
          { type: "UPDATE_THUMBNAIL_DNA", id, patch: { archivedAt: stamp } },
          () => persistUpdateThumbnailDna(id, { archivedAt: stamp }));
      },
      restoreThumbnailDna: (id) => wrap(
        { type: "UPDATE_THUMBNAIL_DNA", id, patch: { archivedAt: null } },
        () => persistUpdateThumbnailDna(id, { archivedAt: null })),

      /* Permanent delete — implemented as a SOFT delete (stamp deleted_at and
         KEEP the row), mirroring deleteReelDna. Optimistically removed from
         local state so the card disappears instantly; not restorable in the UI. */
      deleteThumbnailDna: (id) => {
        const stamp = new Date().toISOString();
        wrap(
          { type: "DELETE_THUMBNAIL_DNA_BY_ID", id },
          () => persistUpdateThumbnailDna(id, { deletedAt: stamp }));
      },

      /* Re-fetch thumbnail_dna from Supabase (manual catch-up). Returns count. */
      reloadThumbnailDna: async () => {
        if (isDemoMode()) return (stateRef.current.thumbnailDna || []).length;
        const { data, error } = await supabase
          .from("thumbnail_dna").select("*")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(RECENT_WINDOW);
        if (error) throw error;
        const items = (data || []).map(thumbnailFromDb);
        dispatch({ type: "SET_THUMBNAIL_DNA", items });
        return items.length;
      },

      /* loadMore (G1 follow-up): page in the next window of OLDER thumbnail_dna
         rows. Returns the count of NEW rows (0 = end). UI wiring is a follow-up. */
      loadMoreThumbnailDna: async (limit = RECENT_WINDOW) => {
        if (isDemoMode()) return 0;
        const cur = stateRef.current.thumbnailDna || [];
        const oldest = cur.length ? cur[cur.length - 1]?.createdAt : null;
        let q = supabase.from("thumbnail_dna").select("*")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (oldest) q = q.lt("created_at", oldest);
        const { data, error } = await q;
        if (error) throw error;
        const items = (data || []).map(thumbnailFromDb);
        if (items.length) dispatch({ type: "APPEND_THUMBNAIL_DNA", items });
        return items.length;
      },

      /* Force the YouTube-playlist poller to run NOW instead of waiting for the
         15-min cron, so a video you just dropped into the watched playlist shows
         up in the Thumbnails tab in seconds. Mirrors triggerIgSync: the
         SUGGEST_CRON_SECRET stays server-side in /api/ai/suggest; we auth with
         the owner's Supabase JWT. Returns { ok, items_seen, inserted } (or
         { ok, skipped, reason } if YT_THUMBNAIL_PLAYLIST_ID is unset). Inserted
         source='yt_playlist' rows arrive via the existing thumbnail_dna realtime
         sub, so no reload is required — callers may still reloadThumbnailDna(). */
      triggerYtSync: async () => {
        if (isDemoMode()) return { ok: false, demo: true };
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Not signed in");
        const res = await fetch("/api/ai/suggest?action=yt-sync", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `YouTube sync failed (${res.status})`);
        return body;
      },

      /* Force the Hetzner IG-DM poller to run NOW instead of waiting for the
         15-min cron, so a reel you just DM'd shows up in seconds. The
         IG_SYNC_SECRET stays server-side in the /api/ai/suggest route; we auth
         with the owner's Supabase JWT. Returns { ok, conversations, reels_seen,
         inserted }. Caller should reloadReelDna() after to pull the new rows. */
      triggerIgSync: async () => {
        if (isDemoMode()) return { ok: false, demo: true };
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Not signed in");
        const res = await fetch("/api/ai/suggest?action=ig-sync", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `IG sync failed (${res.status})`);
        return body;
      },

      /* Promote a captured reel into the production pipeline: create a `reels`
         row from the card's genes (mapped 1:1 to the editor's fields via
         reelDnaToPipelineFields), link it back via reel_id, and flip the card to
         in_progress. Returns the new reel id. Idempotent: a card already linked
         to a reel returns that id without creating a duplicate. */
      sendReelDnaToPipeline: (id, { owner } = {}) => {
        const cur = stateRef.current;
        const card = (cur.reelDna || []).find(d => d.id === id);
        if (!card) throw new Error("Reel not found");
        if (card.reelId) return card.reelId;   // already in the pipeline

        const who = owner || card.capturedBy || "paul";
        const newId = nextReelId(cur.reels);
        const fields = reelDnaToPipelineFields(card);
        const reel = {
          id: newId,
          displayNumber: parseInt(newId.slice(5), 10),
          title: fields.title,
          stage: "not_started",
          owner: who,
          lane: who,
          state: "ok",
          age: "just now",
          due: null,
          stageEnteredAt: new Date().toISOString(),
          fb: 0,
          refs: 0,
          blocker: null,
          next: "Match the reference reel — see brief",
          downstream: null,
          grouping: "not_started",
          logline: fields.logline,
          note: fields.note,
          audio: fields.audio,
          inspo: fields.inspo,
          vo: null, plan: null, script: null,
          detail: { fromReelDna: card.id },
        };
        // Dispatch both optimistically, then persist SEQUENTIALLY: the reel row
        // MUST exist in Supabase before we set reel_dna.reel_id, or the
        // reel_dna_reel_id_fkey foreign key rejects the update (the two persists
        // raced when fired via wrap() concurrently).
        dispatch({ type: "CREATE_REEL", reel });
        dispatch({ type: "UPDATE_REEL_DNA", id, patch: { reelId: newId, status: "in_progress" } });
        (async () => {
          try {
            await persistCreateReel(reel);
            await persistUpdateReelDna(id, { reelId: newId, status: "in_progress" });
          } catch (e) {
            console.error("sendReelDnaToPipeline persist failed:", e);
            dispatch({ type: "SET_ERROR", error: e.message || String(e) });
            return;   // reel/card persist failed → don't migrate assets onto a row that may not exist
          }

          /* Migrate the card's attached assets into the native pipeline tables so
             the new reel arrives in the pipeline with its footage/locations/news
             already wired up (mirrors seedAssetsFromPipeline, but the OTHER
             direction: Reel DNA link rows → pipeline tables). Each asset type is
             wrapped in its own try/catch that only warns, so one missing column /
             RLS denial never aborts the rest. Thumbnails are display-only (6b) and
             skipped. No-op in demo mode. */
          if (isDemoMode()) return;
          const fresh = stateRef.current;
          const links = (fresh.reelDnaAssets || []).filter(a => a && a.reelDnaId === id);
          if (links.length === 0) return;

          // 1) Footage → COPY the source attached_footage_items row onto the new
          //    reel with a fresh text id, skipping any footage_file_id already
          //    attached to newId. Reuse the optimistic-dispatch + persist path.
          try {
            const footageById = new Map();
            for (const f of (fresh.attachedFootage || [])) {
              if (f && f.id != null) footageById.set(String(f.id), f);
            }
            const alreadyOnNew = new Set(
              (fresh.attachedFootage || [])
                .filter(f => f && f.reel_id === newId && f.footage_file_id != null)
                .map(f => String(f.footage_file_id))
            );
            for (const link of links) {
              if (link.assetType !== "footage") continue;
              const src = footageById.get(String(link.assetId));
              if (!src) continue;
              if (src.footage_file_id != null && alreadyOnNew.has(String(src.footage_file_id))) continue;
              const clone = {
                ...src,
                id: `footage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                reel_id: newId,
              };
              if (src.footage_file_id != null) alreadyOnNew.add(String(src.footage_file_id));
              dispatch({ type: "ADD_ATTACHED_FOOTAGE", item: clone });
              await persistAddAttachedFootage(clone);
            }
          } catch (e) {
            console.warn("sendReelDnaToPipeline footage migrate skipped:", e?.message || e);
          }

          // 2) Locations → handled by the CALLER (reel-dna.jsx handleSend) via the
          //    LocationsProvider's linkReel, so the pin updates the provider's
          //    in-memory state (the store can't reach that provider) AND persists.
          //    A direct Supabase update here wrote the DB but left the provider
          //    stale + invisible (locations isn't in the realtime publication),
          //    which is why locations appeared not to migrate. Don't double-write.

          // 3) News → upsert monitor_event_links (event_id, target_type:'reel',
          //    target_id:newId). The full unique index (0065) makes it idempotent.
          try {
            const newsRows = links
              .filter(link => link.assetType === "news")
              .map(link => ({
                event_id: link.assetId,
                target_type: "reel",
                target_id: newId,
                label: link.label ?? null,
              }));
            if (newsRows.length) {
              const { error } = await supabase
                .from("monitor_event_links")
                .upsert(newsRows, { onConflict: "event_id,target_type,target_id" });
              if (error) throw error;
            }
          } catch (e) {
            console.warn("sendReelDnaToPipeline news migrate skipped:", e?.message || e);
          }

          // 4) Thumbnails → SKIP (display-only via the pipeline detail boxes, 6b).
        })();
        return newId;
      },

      /* ----- Pulse Monitor events -----
         Same optimistic + realtime + Promise-returning shape as Reel DNA, but
         pre-migration (0059 not yet applied) the persist will reject — the
         Promise resolves to undefined on demo / rejects on DB error so callers
         can surface a toast. Realtime lives on its own channel above. */
      createMonitorEvent: async (partial = {}) => {
        const now = new Date().toISOString();
        const item = {
          id: partial.id || crypto.randomUUID(),
          // NOTE: createdBy and publishedAt are intentionally NOT defaulted —
          // the caller (the Monitor tab) supplies them with the signed-in
          // person id and the upstream feed timestamp.
          sourceType: partial.sourceType,
          externalId: partial.externalId,
          category: partial.category,
          platform: partial.platform,
          severity: partial.severity,
          status: partial.status ?? "new",
          starred: partial.starred ?? false,
          title: partial.title,
          summary: partial.summary,
          sourceName: partial.sourceName,
          sourceUrl: partial.sourceUrl,
          region: partial.region,
          tags: partial.tags ?? [],
          publishedAt: partial.publishedAt,
          createdBy: partial.createdBy,
          createdAt: partial.createdAt || now,
        };
        dispatch({ type: "CREATE_MONITOR_EVENT", item });
        try {
          await persistCreateMonitorEvent(item);
        } catch (e) {
          console.error("createMonitorEvent persist failed:", e);
          dispatch({ type: "SET_ERROR", error: e.message || String(e) });
          throw e;
        }
        return item;
      },

      updateMonitorEvent: async (id, patch) => {
        dispatch({ type: "UPDATE_MONITOR_EVENT", id, patch });
        try {
          await persistUpdateMonitorEvent(id, patch);
        } catch (e) {
          console.error("updateMonitorEvent persist failed:", e);
          dispatch({ type: "SET_ERROR", error: e.message || String(e) });
          throw e;
        }
      },

      deleteMonitorEvent: async (id) => {
        dispatch({ type: "DELETE_MONITOR_EVENT_BY_ID", id });
        try {
          await persistDeleteMonitorEvent(id);
        } catch (e) {
          console.error("deleteMonitorEvent persist failed:", e);
          dispatch({ type: "SET_ERROR", error: e.message || String(e) });
          throw e;
        }
      },

      /* ----- Pulse Monitor sources (owner-curated RSS/Atom feed list) -----
         Same optimistic + realtime shape as monitor events. The ingester writes
         last_fetched_at/last_status/item_count via service_role; those land back
         in the store through the monitor_sources realtime listener above. */
      createMonitorSource: async (partial = {}) => {
        const now = new Date().toISOString();
        const item = {
          id: partial.id || crypto.randomUUID(),
          name: partial.name,
          url: partial.url,
          category: partial.category ?? "news",
          platform: partial.platform ?? null,
          region: partial.region ?? null,
          severityDefault: partial.severityDefault ?? "info",
          enabled: partial.enabled ?? true,
          itemCount: 0,
          createdBy: partial.createdBy,
          createdAt: partial.createdAt || now,
        };
        dispatch({ type: "CREATE_MONITOR_SOURCE", item });
        try {
          await persistCreateMonitorSource(item);
        } catch (e) {
          console.error("createMonitorSource persist failed:", e);
          dispatch({ type: "SET_ERROR", error: e.message || String(e) });
          throw e;
        }
        return item;
      },

      updateMonitorSource: async (id, patch) => {
        dispatch({ type: "UPDATE_MONITOR_SOURCE", id, patch });
        try {
          await persistUpdateMonitorSource(id, patch);
        } catch (e) {
          console.error("updateMonitorSource persist failed:", e);
          dispatch({ type: "SET_ERROR", error: e.message || String(e) });
          throw e;
        }
      },

      deleteMonitorSource: async (id) => {
        dispatch({ type: "DELETE_MONITOR_SOURCE_BY_ID", id });
        try {
          await persistDeleteMonitorSource(id);
        } catch (e) {
          console.error("deleteMonitorSource persist failed:", e);
          dispatch({ type: "SET_ERROR", error: e.message || String(e) });
          throw e;
        }
      },

      /* ----- Monitor event links (event → reel/review_card/location) -----
         RLS owner-gated. Optimistic wrap: dispatch locally then persist. No
         FK-order issue — the parent monitor_events row already exists, so this
         is a single insert. createdBy is supplied by the caller (the Pulse link
         picker) with the signed-in person id, like createMonitorEvent. */
      createEventLink: (eventId, { targetType, targetId, label, createdBy } = {}) => {
        const item = {
          id: crypto.randomUUID(),
          eventId,
          targetType,
          targetId,
          label: label ?? null,
          createdBy: createdBy ?? null,
          createdAt: new Date().toISOString(),
        };
        wrap({ type: "CREATE_EVENT_LINK", item }, () => persistCreateEventLink(item));
        return item;
      },

      deleteEventLink: (id) => {
        wrap({ type: "DELETE_EVENT_LINK_BY_ID", id }, () => persistDeleteEventLink(id));
      },

      /* ----- reel_dna_assets (card → footage/location/thumbnail/news) -----
         Team-wide RLS (any user who can edit a card can attach assets). The
         parent reel_dna card already exists (we only attach to a persisted
         card), so there's no FK-ordering race on a single attach — it's one
         upsert. asset_id is String()-coerced (the source PKs are a mix of text
         and uuid; the column is text). created_by is the signed-in person. */
      attachAsset: (reelDnaId, assetType, assetId, label) => {
        const createdBy = _authPerson?.id ?? null;
        const row = {
          reel_dna_id: reelDnaId,
          asset_type: assetType,
          asset_id: String(assetId),
          label: label ?? null,
          created_by: createdBy,
        };
        // Optimistic: synthesize a client row so badges update before the
        // realtime echo. The DB assigns the real id/created_at; the echo
        // replaces this row by the (reelDnaId, assetType, assetId)-derived id.
        const optimistic = {
          id: `${reelDnaId}:${assetType}:${String(assetId)}`,
          reelDnaId,
          assetType,
          assetId: String(assetId),
          label: label ?? undefined,
          createdBy: createdBy ?? undefined,
          createdAt: new Date().toISOString(),
        };
        wrap({ type: "UPSERT_REEL_DNA_ASSET", item: optimistic }, () => persistAttachAsset(row));
        return optimistic;
      },

      detachAsset: (reelDnaId, assetType, assetId) => {
        // Drop any local row matching this (card, type, id) — covers both the
        // optimistic client id and a realtime-hydrated DB id.
        const key = String(assetId);
        // Snapshot every link row we're about to remove so we can roll the
        // detach back if the persist fails (otherwise the asset silently
        // reappears on the next reload but looks gone until then).
        const cur = stateRef.current;
        const removed = (cur.reelDnaAssets || []).filter(
          a => a.reelDnaId === reelDnaId && a.assetType === assetType && String(a.assetId) === key
        );
        dispatch({
          type: "DELETE_REEL_DNA_ASSET",
          id: `${reelDnaId}:${assetType}:${key}`,
        });
        for (const a of removed) {
          dispatch({ type: "DELETE_REEL_DNA_ASSET", id: a.id });
        }
        persistDetachAsset(reelDnaId, assetType, assetId).catch(e => {
          console.error("detachAsset persist failed:", e);
          // Roll the optimistic removal back so the UI matches the DB.
          for (const a of removed) dispatch({ type: "UPSERT_REEL_DNA_ASSET", item: a });
          dispatch({ type: "SET_ERROR", error: e.message || String(e) });
        });
      },

      /* ----- Epidemic Sound music library (migration 0092) ----------------
         Server-side proxy ONLY — the Epidemic/Keycloak token NEVER reaches the
         browser. Each wrapper attaches the caller's Supabase JWT (mirrors the
         deconstruct/discord-notify call sites) and hits the frozen TEAM_API
         HTTP contract at POST /api/ai/suggest?action=epidemic-*. They NEVER
         throw — a network failure returns { ok:false, error }. The
         'epidemic_token_expired' upstream error is surfaced VERBATIM so the UI
         can show the "reconnect — see Paul" banner. */
      searchMusic: async (term, opts = {}) => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) return { ok: false, error: "Not signed in", tracks: [] };
          const { limit, offset, filters } = opts || {};
          const body = { term: term ?? "" };
          if (limit !== undefined)   body.limit = limit;
          if (offset !== undefined)  body.offset = offset;
          if (filters !== undefined) body.filters = filters;
          const res = await fetch("/api/ai/suggest?action=epidemic-search", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json?.ok === false) {
            return { ok: false, error: json?.error || `Search failed (${res.status})`, tracks: [] };
          }
          return { ok: true, tracks: Array.isArray(json.tracks) ? json.tracks : [] };
        } catch (e) {
          return { ok: false, error: e?.message || String(e), tracks: [] };
        }
      },

      getMusicTrack: async (id) => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) return { ok: false, error: "Not signed in" };
          const res = await fetch("/api/ai/suggest?action=epidemic-track", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json?.ok === false) {
            return { ok: false, error: json?.error || `Track fetch failed (${res.status})` };
          }
          return { ok: true, track: json.track };
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },

      getMusicDownload: async (id, opts = {}) => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) return { ok: false, error: "Not signed in" };
          const { format, quality } = opts || {};
          const body = { id };
          if (format !== undefined)  body.format = format;
          if (quality !== undefined) body.quality = quality;
          const res = await fetch("/api/ai/suggest?action=epidemic-download", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json?.ok === false) {
            return { ok: false, error: json?.error || `Download failed (${res.status})` };
          }
          return { ok: true, url: json.url, expires: json.expires };
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },

      /* Cache a mapTrack into music_tracks. Idempotent on id (upsert, NOT
         ignoreDuplicates so a re-cache refreshes the row). Never throws. */
      upsertMusicTrack: async (track) => {
        // Guard the empty/absent id too — an id-less mapTrack would upsert an
        // empty-string PRIMARY KEY (and never resolve against an attached link).
        if (!track || track.id == null || String(track.id) === "") return;
        // Optimistic: seed musicTracks NOW so a just-attached track resolves in
        // resolveReelDnaAssets immediately, instead of blank until the realtime
        // echo lands. The echo (musicTrackFromDb) replaces this row by id.
        dispatch({ type: "UPSERT_MUSIC_TRACK", item: { ...track, id: String(track.id) } });
        try {
          const { error } = await supabase
            .from("music_tracks")
            .upsert(rowFromMapTrack(track), { onConflict: "id", ignoreDuplicates: false });
          if (error) console.warn("upsertMusicTrack failed:", error.message || error);
        } catch (e) {
          console.warn("upsertMusicTrack failed:", e?.message || e);
        }
      },

      /* ----- Music library: favorites + playlists (migration 0093) -----
         Per-user, optimistic + persist (mirrors the user_preferences setters).
         A save first mirrors the track into music_tracks so it renders from the
         cache without re-hitting Epidemic. All never throw past the boundary. */
      toggleMusicFavorite: async (track) => {
        const personId = _authPerson?.id;
        if (!personId || !track || track.id == null) return;
        const trackId = String(track.id);
        const isFav = (stateRef.current.musicFavorites || []).some(f => f.trackId === trackId);
        if (isFav) {
          dispatch({ type: "DELETE_MUSIC_FAVORITE", trackId });
          try {
            await supabase.from("music_favorites").delete()
              .match({ person_id: personId, track_id: trackId });
          } catch (e) { console.warn("unfavorite failed:", e?.message || e); }
        } else {
          dispatch({ type: "UPSERT_MUSIC_FAVORITE", item: { trackId, personId, createdAt: new Date().toISOString() } });
          dispatch({ type: "UPSERT_MUSIC_TRACK", item: { ...track, id: trackId } });
          try {
            await supabase.from("music_tracks").upsert(rowFromMapTrack(track), { onConflict: "id", ignoreDuplicates: false });
            await supabase.from("music_favorites")
              .upsert({ person_id: personId, track_id: trackId }, { onConflict: "person_id,track_id", ignoreDuplicates: true });
          } catch (e) { console.warn("favorite failed:", e?.message || e); }
        }
      },

      createMusicPlaylist: async (name) => {
        const personId = _authPerson?.id;
        if (!personId) return null;
        const id = (globalThis.crypto?.randomUUID?.() || `pl_${Date.now()}_${Math.random().toString(36).slice(2)}`);
        const clean = (name || "").trim() || "Untitled playlist";
        dispatch({ type: "UPSERT_MUSIC_PLAYLIST", item: { id, personId, name: clean, createdAt: new Date().toISOString() } });
        try {
          await supabase.from("music_playlists").insert({ id, person_id: personId, name: clean });
        } catch (e) { console.warn("createMusicPlaylist failed:", e?.message || e); }
        return id;
      },

      renameMusicPlaylist: async (id, name) => {
        if (!id) return;
        const clean = (name || "").trim() || "Untitled playlist";
        dispatch({ type: "UPSERT_MUSIC_PLAYLIST", item: { id, name: clean } });
        try {
          await supabase.from("music_playlists").update({ name: clean, updated_at: new Date().toISOString() }).eq("id", id);
        } catch (e) { console.warn("renameMusicPlaylist failed:", e?.message || e); }
      },

      deleteMusicPlaylist: async (id) => {
        if (!id) return;
        dispatch({ type: "DELETE_MUSIC_PLAYLIST_BY_ID", id });
        try {
          // playlist_tracks rows cascade server-side (FK ON DELETE CASCADE).
          await supabase.from("music_playlists").delete().eq("id", id);
        } catch (e) { console.warn("deleteMusicPlaylist failed:", e?.message || e); }
      },

      addTrackToPlaylist: async (playlistId, track) => {
        if (!playlistId || !track || track.id == null) return;
        const trackId = String(track.id);
        const already = (stateRef.current.musicPlaylistTracks || [])
          .some(t => t.playlistId === playlistId && t.trackId === trackId);
        if (already) return;
        const position = (stateRef.current.musicPlaylistTracks || [])
          .filter(t => t.playlistId === playlistId).length;
        dispatch({ type: "UPSERT_MUSIC_PLAYLIST_TRACK", item: { playlistId, trackId, position, addedAt: new Date().toISOString() } });
        dispatch({ type: "UPSERT_MUSIC_TRACK", item: { ...track, id: trackId } });
        try {
          await supabase.from("music_tracks").upsert(rowFromMapTrack(track), { onConflict: "id", ignoreDuplicates: false });
          await supabase.from("music_playlist_tracks")
            .upsert({ playlist_id: playlistId, track_id: trackId, position }, { onConflict: "playlist_id,track_id", ignoreDuplicates: true });
        } catch (e) { console.warn("addTrackToPlaylist failed:", e?.message || e); }
      },

      removeTrackFromPlaylist: async (playlistId, trackId) => {
        if (!playlistId || trackId == null) return;
        const tid = String(trackId);
        dispatch({ type: "DELETE_MUSIC_PLAYLIST_TRACK", playlistId, trackId: tid });
        try {
          await supabase.from("music_playlist_tracks").delete()
            .match({ playlist_id: playlistId, track_id: tid });
        } catch (e) { console.warn("removeTrackFromPlaylist failed:", e?.message || e); }
      },

      /* Seed a card's assets from its linked PIPELINE reel (owner decision 1b).
         Only fires when the card has a reelId (it was "Sent to Pipeline"). We
         query Supabase DIRECTLY (do NOT depend on the locations provider, which
         the store can't read): attached_footage_items by reel_id, locations
         whose linked_reel_ids contains the reel, and reel-type
         monitor_event_links. Each match is attached via attachAsset (dedupe is
         automatic — the upsert ignores duplicates). Sequential awaits keep the
         writes ordered; no FK-order issue since the card already exists. */
      seedAssetsFromPipeline: async (reelDnaItem) => {
        const reelId = reelDnaItem?.reelId;
        const reelDnaId = reelDnaItem?.id;
        if (!reelId || !reelDnaId) return;   // no pipeline link → nothing to seed
        if (isDemoMode()) return;            // demo sandbox: optimistic-only, no DB

        // Local attach helper — same shape as the attachAsset action (optimistic
        // dispatch + upsert persist), inlined so we don't self-reference `value`
        // (the object still being constructed in this useMemo).
        const createdBy = _authPerson?.id ?? null;
        const attach = async (cardId, assetType, assetId, label) => {
          const row = {
            reel_dna_id: cardId,
            asset_type: assetType,
            asset_id: String(assetId),
            label: label ?? null,
            created_by: createdBy,
          };
          dispatch({
            type: "UPSERT_REEL_DNA_ASSET",
            item: {
              id: `${cardId}:${assetType}:${String(assetId)}`,
              reelDnaId: cardId,
              assetType,
              assetId: String(assetId),
              label: label ?? undefined,
              createdBy: createdBy ?? undefined,
              createdAt: new Date().toISOString(),
            },
          });
          await persistAttachAsset(row);
        };

        // 1) Footage attached to the pipeline reel.
        try {
          const { data, error } = await supabase
            .from("attached_footage_items")
            .select("id, filename, footage_file_id, reel_id")
            .eq("reel_id", reelId);
          if (error) throw error;
          for (const f of (data || [])) {
            await attach(reelDnaId, "footage", f.id, f.filename ?? f.footage_file_id ?? "Footage");
          }
        } catch (e) {
          console.warn("seedAssetsFromPipeline footage skipped:", e?.message || e);
        }

        // 2) Locations whose linked_reel_ids array contains this reel.
        try {
          const { data, error } = await supabase
            .from("locations")
            .select("id, name, linked_reel_ids")
            .contains("linked_reel_ids", [reelId]);
          if (error) throw error;
          for (const l of (data || [])) {
            await attach(reelDnaId, "location", l.id, l.name ?? "Location");
          }
        } catch (e) {
          console.warn("seedAssetsFromPipeline locations skipped:", e?.message || e);
        }

        // 3) News events linked to this reel via monitor_event_links.
        try {
          const { data, error } = await supabase
            .from("monitor_event_links")
            .select("event_id, target_type, target_id, label")
            .eq("target_type", "reel")
            .eq("target_id", reelId);
          if (error) throw error;
          for (const link of (data || [])) {
            await attach(reelDnaId, "news", link.event_id, link.label ?? "News");
          }
        } catch (e) {
          console.warn("seedAssetsFromPipeline news skipped:", e?.message || e);
        }
      },

      /* Reverse of sendReelDnaToPipeline: pull the linked pipeline reel's editable
         TEXT back into the card, UNLINK it (clear reel_id) so the "→ Pipeline"
         button resets, and flip the card back to captured. Assets (footage /
         locations / news the editor added in the pipeline) are migrated back by
         the caller via seedAssetsFromPipeline BEFORE this runs (it needs the
         still-set reel_id); the pipeline reel is soft-archived by the caller via
         archiveReel AFTER (soft, so the migrated footage rows survive and the
         card's new asset links stay resolvable). Returns the card id. */
      returnReelFromPipeline: (reelId) => {
        const cur = stateRef.current;
        const reel = (cur.reels || []).find(r => r.id === reelId);
        const card = (cur.reelDna || []).find(d => d.reelId === reelId && !d.deletedAt);
        if (!card) throw new Error("No linked Reel DNA card for " + reelId);

        // Append anything the editor wrote in the pipeline back onto the card's
        // quickNotes, under a per-reel header (deduped so re-runs can't stack).
        let quickNotes = card.quickNotes || "";
        if (reel) {
          const header = `↩ From pipeline ${reelId}`;
          if (!quickNotes.includes(header)) {
            const lines = [];
            if (reel.logline) lines.push(`Logline: ${reel.logline}`);
            if (reel.note)    lines.push(reel.note);
            if (reel.vo)      lines.push(`VO: ${reel.vo}`);
            if (reel.script)  lines.push(`Script: ${reel.script}`);
            if (reel.audio)   lines.push(`Audio: ${reel.audio}`);
            if (lines.length) {
              quickNotes = [quickNotes.trim(), `${header}\n${lines.join("\n")}`]
                .filter(Boolean).join("\n\n");
            }
          }
        }

        // Unlink + reset so "→ Pipeline" returns; flip status back to captured.
        const patch = { reelId: null, status: "captured", quickNotes };
        dispatch({ type: "UPDATE_REEL_DNA", id: card.id, patch });
        (async () => {
          try {
            await persistUpdateReelDna(card.id, patch);
          } catch (e) {
            console.error("returnReelFromPipeline persist failed:", e);
            dispatch({ type: "SET_ERROR", error: e.message || String(e) });
          }
        })();
        return card.id;
      },

      /* Manually run the news-monitor ingest now (the "Refresh now" button).
         Hits the same route the Hetzner cron uses, authed with the owner's
         Supabase JWT. New poller rows arrive live via realtime; this returns
         the summary counts for a toast. */
      triggerNewsIngest: async () => {
        if (isDemoMode()) return { ok: false, demo: true };
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Not signed in");
        const res = await fetch("/api/ai/suggest?action=news-ingest", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `Ingest failed (${res.status})`);
        return body; // { ok, sources, inserted, errors }
      },

      /* Manually run the World Monitor free-feed ingest now (Pulse "Refresh
         now" on the World view). Verbatim clone of triggerNewsIngest — same
         route, owner JWT auth, demo-guarded. New geo rows arrive live via the
         monitor_events realtime channel; this returns the summary for a toast. */
      triggerWorldIngest: async () => {
        if (isDemoMode()) return { ok: false, demo: true };
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Not signed in");
        const res = await fetch("/api/ai/suggest?action=world-ingest", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `Ingest failed (${res.status})`);
        return body; // { ok, feeds, inserted, byFeed, pruned, errors }
      },

      /* Pre-flight a feed URL before adding it as a monitor source (the "Add
         source" / "Check feed" diagnostics). Server-side because the browser
         can't fetch arbitrary cross-origin feeds. Returns the validateFeedUrl()
         shape: { ok:true, itemCount, kind } | { ok:false, reason, suggestions }. */
      validateMonitorFeed: async (feedUrl) => {
        if (isDemoMode()) return { ok: true, demo: true };
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Not signed in");
        const res = await fetch("/api/ai/suggest?action=validate-feed", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: feedUrl }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.reason || body?.error || `Validation failed (${res.status})`);
        return body;
      },

      /* ----- Reel ↔ team chat refs ----- */

      /* Record that a reel was taken to a Rocket.Chat channel for discussion.
         The app can't read chat messages (chat is an iframe embed), so this is
         the lightweight link layer: it lets the reel card badge + deep-link back
         to the conversation. messageUrl is optional (we usually don't know the
         exact message URL up front; channel deep-link is the fallback).
         createdBy is passed by the caller (like createReelDnaCapture's
         capturedBy) since the store has no auth context. Optimistic. */
      addReelChatRef: ({ reelId, channel, note, messageUrl, createdBy }) => {
        const item = {
          id: crypto.randomUUID(),
          reelId,
          channel: channel || null,
          note: note || null,
          messageUrl: messageUrl || null,
          createdBy: createdBy || null,
          createdAt: new Date().toISOString(),
        };
        wrap(
          { type: "CREATE_REEL_CHAT_REF", item },
          () => persistCreateReelChatRef(item));
        return item;
      },

      /* ----- Gamify ----- */

      /* Owner toggles. Persist directly to app_settings (RLS "owner write
         app_settings" policy) — no new serverless function, mirrors the
         anthropic_enabled kill-switch pattern. */
      setGamifyEnabled: (enabled) => {
        dispatch({ type: "SET_GAMIFY_ENABLED", enabled });
        if (isDemoMode()) return;
        supabase.from("app_settings").upsert({
          key: "gamify_enabled",
          value: { enabled },
          updated_at: new Date().toISOString(),
        }).then(({ error }) => {
          if (error) {
            console.error("setGamifyEnabled persist failed:", error);
            dispatch({ type: "SET_ERROR", error: error.message || String(error) });
          }
        });
      },

      /* Owner flag: swap the Reel DNA card grid between the new unified card and
         the legacy DnaCard. Default off = site renders identically to today.
         Same app_settings + "owner write app_settings" RLS path as gamify. */
      setUnifiedCards: (enabled) => {
        dispatch({ type: "SET_UNIFIED_CARDS", enabled });
        if (isDemoMode()) return;
        supabase.from("app_settings").upsert({
          key: "unified_cards",
          value: { enabled },
          updated_at: new Date().toISOString(),
        }).then(({ error }) => {
          if (error) {
            console.error("setUnifiedCards persist failed:", error);
            dispatch({ type: "SET_ERROR", error: error.message || String(error) });
          }
        });
      },

      setGamifyGradingMode: (mode) => {
        dispatch({ type: "SET_GAMIFY_GRADING_MODE", mode });
        if (isDemoMode()) return;
        supabase.from("app_settings").upsert({
          key: "gamify_grading_mode",
          value: { mode },
          updated_at: new Date().toISOString(),
        }).then(({ error }) => {
          if (error) {
            console.error("setGamifyGradingMode persist failed:", error);
            dispatch({ type: "SET_ERROR", error: error.message || String(error) });
          }
        });
      },

      /* Owner toggle: how grade-band descriptions render in the rubric sheet.
         "off" | "active-only" | "all". Persists to app_settings, same RLS
         pattern as the other gamify toggles. */
      setRubricDescMode: (mode) => {
        dispatch({ type: "SET_RUBRIC_DESC_MODE", mode });
        if (isDemoMode()) return;
        supabase.from("app_settings").upsert({
          key: "gamify_rubric_desc_mode",
          value: { mode },
          updated_at: new Date().toISOString(),
        }).then(({ error }) => {
          if (error) {
            console.error("setRubricDescMode persist failed:", error);
            dispatch({ type: "SET_ERROR", error: error.message || String(error) });
          }
        });
      },

      /* Owner-archive of individual rubric rows, PER REEL. `keysForReel` is the
         full next set of hidden "skillKey:subId" ids for the given `reelId`.
         Hiding completely removes the row from that reel's rubric sheet (with no
         trace); it stays restorable from the archive panel. The whole per-reel
         map { [reelId]: string[] } is persisted to app_settings as { map },
         same RLS pattern as the other gamify toggles. */
      setGamifyHiddenSubskills: (reelId, keysForReel) => {
        const current = stateRef.current.gamifyHiddenSubskills || {};
        const nextMap = { ...current, [reelId]: Array.from(new Set(keysForReel || [])) };
        dispatch({ type: "SET_GAMIFY_HIDDEN_SUBSKILLS", map: nextMap });
        if (isDemoMode()) return;
        supabase.from("app_settings").upsert({
          key: "gamify_hidden_subskills",
          value: { map: nextMap },
          updated_at: new Date().toISOString(),
        }).then(({ error }) => {
          if (error) {
            console.error("setGamifyHiddenSubskills persist failed:", error);
            dispatch({ type: "SET_ERROR", error: error.message || String(error) });
          }
        });
      },

      /* Per-user pipeline collapse state — persisted to user_preferences (migration 0070).
         Each user collapses their own reel cards independently. */
      toggleReelCollapsed: (reelId) => {
        const ids = stateRef.current.collapsedReelIds;
        const next = ids.includes(reelId) ? ids.filter(x => x !== reelId) : [...ids, reelId];
        dispatch({ type: "TOGGLE_REEL_COLLAPSED", reelId });
        if (isDemoMode() || !_authPerson?.id) return;
        supabase.from("user_preferences").upsert(
          { person_id: _authPerson.id, key: "pipeline_collapsed", value: { ids: next }, updated_at: new Date().toISOString() },
          { onConflict: "person_id,key" }
        ).then(({ error }) => { if (error) console.error("collapse persist failed:", error); });
      },

      toggleLaneHidden: (laneId) => {
        const ids = stateRef.current.hiddenLaneIds;
        const next = ids.includes(laneId) ? ids.filter(x => x !== laneId) : [...ids, laneId];
        dispatch({ type: "TOGGLE_LANE_HIDDEN", laneId });
        if (isDemoMode() || !_authPerson?.id) return;
        supabase.from("user_preferences").upsert(
          { person_id: _authPerson.id, key: "pipeline_hidden_lanes", value: { ids: next }, updated_at: new Date().toISOString() },
          { onConflict: "person_id,key" }
        ).then(({ error }) => { if (error) console.error("lane hidden persist failed:", error); });
      },

      /* WS2 C4 — owner pref "Prefetch heavy tabs". Per-user, persisted to
         user_preferences (key prefetch_heavy_tabs), mirroring toggleReelCollapsed.
         Consumed by TEAM_B's code-split prefetch in app.jsx. */
      setPrefetchHeavyTabs: (next) => {
        const enabled = !!next;
        dispatch({ type: "SET_PREFETCH_HEAVY_TABS", next: enabled });
        if (isDemoMode() || !_authPerson?.id) return;
        supabase.from("user_preferences").upsert(
          { person_id: _authPerson.id, key: "prefetch_heavy_tabs", value: { enabled }, updated_at: new Date().toISOString() },
          { onConflict: "person_id,key" }
        ).then(({ error }) => { if (error) console.error("prefetch_heavy_tabs persist failed:", error); });
      },

      /* Reel DNA spreadsheet: per-user hidden columns — persisted to
         user_preferences (key reel_dna_hidden_cols), mirroring toggleReelCollapsed.
         toggleReelDnaCol toggles ONE column key; setReelDnaCols replaces the whole
         set (setReelDnaCols([]) = Show all). */
      toggleReelDnaCol: (key) => {
        const cols = stateRef.current.hiddenReelDnaCols;
        const next = cols.includes(key) ? cols.filter(k => k !== key) : [...cols, key];
        dispatch({ type: "TOGGLE_REEL_DNA_COL", key });
        if (isDemoMode() || !_authPerson?.id) return;
        supabase.from("user_preferences").upsert(
          { person_id: _authPerson.id, key: "reel_dna_hidden_cols", value: { keys: next }, updated_at: new Date().toISOString() },
          { onConflict: "person_id,key" }
        ).then(({ error }) => { if (error) console.error("reel_dna_hidden_cols persist failed:", error); });
      },

      setReelDnaCols: (keys) => {
        const next = Array.isArray(keys) ? keys : [];
        dispatch({ type: "SET_HIDDEN_REEL_DNA_COLS", keys: next });
        if (isDemoMode() || !_authPerson?.id) return;
        supabase.from("user_preferences").upsert(
          { person_id: _authPerson.id, key: "reel_dna_hidden_cols", value: { keys: next }, updated_at: new Date().toISOString() },
          { onConflict: "person_id,key" }
        ).then(({ error }) => { if (error) console.error("reel_dna_hidden_cols persist failed:", error); });
      },

      /* Reel DNA spreadsheet: per-user visited-link tracking — persisted to
         user_preferences (key reel_dna_visited), mirroring toggleReelCollapsed.
         Idempotent add to the visited set + records the most-recent id. */
      markReelDnaVisited: (id) => {
        const ids = stateRef.current.visitedReelDnaIds;
        const next = ids.includes(id) ? ids : [...ids, id];
        dispatch({ type: "MARK_REEL_DNA_VISITED", id });
        if (isDemoMode() || !_authPerson?.id) return;
        supabase.from("user_preferences").upsert(
          { person_id: _authPerson.id, key: "reel_dna_visited", value: { ids: next, last: id }, updated_at: new Date().toISOString() },
          { onConflict: "person_id,key" }
        ).then(({ error }) => { if (error) console.error("reel_dna_visited persist failed:", error); });
      },

      /* Editor self-assessment: store the set of checked sub-item ids for
         one (reel, person, skill). Does NOT award XP — only the reviewer
         grade does. Optimistic upsert keyed on the composite. */
      saveEditorRubric: (reelId, personId, skillKey, checkedItems) => {
        const existing = stateRef.current.gamifyRubrics.find(r =>
          r.reelId === reelId && r.personId === personId && r.skillKey === skillKey);
        const item = {
          id: existing?.id || crypto.randomUUID(),
          reelId, personId, skillKey,
          editorChecked: checkedItems,
          reviewerGrades: existing?.reviewerGrades ?? {},
          xpAwarded: existing?.xpAwarded ?? 0,
          gradedAt: existing?.gradedAt ?? undefined,
        };
        wrap(
          { type: "UPSERT_GAMIFY_RUBRIC", item },
          () => persistGamifyRubric(item));
      },

      /* Reviewer grade: sets Average/Decent/Excellent for ONE sub-skill row
         (subId) of a skill on a reel. The skill's XP is the average of its
         graded sub-skills, then the editor's aggregate progress is recomputed
         and both the rubric row and progress row are persisted.
         Pass grade=null to clear that one row. */
      saveReviewerGrade: (reelId, personId, skillKey, subId, grade) => {
        const cur = stateRef.current;
        const existing = cur.gamifyRubrics.find(r =>
          r.reelId === reelId && r.personId === personId && r.skillKey === skillKey);

        // Merge this sub-skill's grade into the per-row map.
        const grades = { ...(existing?.reviewerGrades || {}) };
        if (grade) grades[subId] = grade;
        else delete grades[subId];

        // Difficulty multiplier set by dragging the reel's spider point.
        const reel = cur.reels.find(r => r.id === reelId);
        const difficulty = reel?.gamifyDifficulty?.[skillKey];
        const xpAwarded = xpForSkillGradesWithDifficulty(grades, difficulty);
        const rubricItem = {
          id: existing?.id || crypto.randomUUID(),
          reelId, personId, skillKey,
          editorChecked: existing?.editorChecked ?? [],
          reviewerGrades: grades,
          xpAwarded,
          gradedAt: new Date().toISOString(),
        };

        // Build the next full rubric set (with this row updated) to recompute
        // the person's aggregate progress.
        const nextRubrics = (() => {
          const k = (r) => `${r.reelId}|${r.personId}|${r.skillKey}`;
          const target = k(rubricItem);
          const found = cur.gamifyRubrics.some(r => k(r) === target);
          return found
            ? cur.gamifyRubrics.map(r => k(r) === target ? rubricItem : r)
            : [rubricItem, ...cur.gamifyRubrics];
        })();
        const progress = computeProgress(personId, nextRubrics);

        dispatch({ type: "UPSERT_GAMIFY_RUBRIC", item: rubricItem });
        dispatch({ type: "UPSERT_GAMIFY_PROGRESS", item: progress });

        Promise.all([
          persistGamifyRubric(rubricItem),
          persistGamifyProgress(progress),
        ]).catch(e => {
          console.error("saveReviewerGrade persist failed:", e);
          dispatch({ type: "SET_ERROR", error: e.message || String(e) });
        });
      },

      /* Set the drag-adjusted difficulty (0..100) for one skill on a reel,
         persist it onto the reel's detail blob, and re-apply the new XP
         multiplier to any ALREADY-graded rubric rows for that skill so the
         leaderboard reflects the difficulty change immediately. */
      setReelDifficulty: (reelId, skillKey, difficulty) => {
        const cur = stateRef.current;
        const reel = cur.reels.find(r => r.id === reelId);
        if (!reel) return;

        // 1) Save difficulty in the reel's dedicated gamify_difficulty column
        //    (NOT the shared `detail` blob — the detail page owns a debounced
        //    writer for `detail` that would otherwise clobber this on save).
        const nextDifficulty = {
          ...(reel.gamifyDifficulty || {}),
          [skillKey]: Math.max(0, Math.min(100, Math.round(difficulty))),
        };
        wrap(
          { type: "UPDATE_REEL", id: reelId, patch: { gamifyDifficulty: nextDifficulty } },
          (s) => persistUpdateReel(s, reelId, { gamifyDifficulty: nextDifficulty }));

        // 2) Re-apply the multiplier to graded rows for this reel+skill.
        const affected = cur.gamifyRubrics.filter(r =>
          r.reelId === reelId && r.skillKey === skillKey &&
          Object.keys(r.reviewerGrades || {}).length > 0);
        if (!affected.length) return;

        const byPerson = {};
        for (const r of affected) {
          const xp = xpForSkillGradesWithDifficulty(r.reviewerGrades, difficulty);
          const updated = { ...r, xpAwarded: xp };
          dispatch({ type: "UPSERT_GAMIFY_RUBRIC", item: updated });
          persistGamifyRubric(updated).catch(e => console.error(e));
          byPerson[r.personId] = true;
        }
        // Recompute aggregate progress for each affected person.
        const allRubrics = cur.gamifyRubrics.map(r =>
          (r.reelId === reelId && r.skillKey === skillKey &&
           Object.keys(r.reviewerGrades || {}).length > 0)
            ? { ...r, xpAwarded: xpForSkillGradesWithDifficulty(r.reviewerGrades, difficulty) }
            : r);
        for (const pid of Object.keys(byPerson)) {
          const prog = computeProgress(pid, allRubrics);
          dispatch({ type: "UPSERT_GAMIFY_PROGRESS", item: prog });
          persistGamifyProgress(prog).catch(e => console.error(e));
        }
      },

      /* ----- Training module content (owner per-field overrides) ----- */

      /* Owner edits one field of one training module inline. Optimistic
         dispatch, then upsert to training_module_content (RLS "owner write"
         policy enforces owner; we ALSO guard on the real signed-in person's
         role so editors never even attempt the write). Skipped in demo. */
      setModuleContent: (moduleId, fieldPath, value) => {
        dispatch({ type: "SET_MODULE_CONTENT", moduleId, fieldPath, value });
        if (isDemoMode()) return;
        if (authRoleRef.current !== "owner") return;
        supabase.from("training_module_content").upsert({
          module_id: moduleId,
          field_path: fieldPath,
          value,
          updated_at: new Date().toISOString(),
        }, { onConflict: "module_id,field_path" }).then(({ error }) => {
          if (error) {
            console.error("setModuleContent persist failed:", error);
            dispatch({ type: "SET_ERROR", error: error.message || String(error) });
          }
        });
      },

      /* Owner reverts one field back to the code default by deleting its
         override row. Optimistic remove, then DB delete. Owner-gated. */
      resetModuleContent: (moduleId, fieldPath) => {
        dispatch({ type: "RESET_MODULE_CONTENT", moduleId, fieldPath });
        if (isDemoMode()) return;
        if (authRoleRef.current !== "owner") return;
        supabase.from("training_module_content").delete()
          .match({ module_id: moduleId, field_path: fieldPath })
          .then(({ error }) => {
            if (error) {
              console.error("resetModuleContent persist failed:", error);
              dispatch({ type: "SET_ERROR", error: error.message || String(error) });
            }
          });
      },

      /* Read ALL editors' training progress (no person filter) for the
         owner's dashboard roster widget. RLS already allows authenticated
         SELECT of every row (0047 auth_read_training_progress). Returns
         an array of { person_id, module_id, done }. */
      loadTrainingProgressAll: async () => {
        const { data, error } = await supabase
          .from("training_progress")
          .select("person_id, module_id, done");
        if (error) {
          console.error("loadTrainingProgressAll failed:", error);
          return [];
        }
        return (data || []).map(r => ({
          person_id: r.person_id,
          module_id: r.module_id,
          done: !!r.done,
        }));
      },

      /* ----- loadMore page-in actions (G1 follow-up) -----
         Boot only loads a bounded RECENT window of the big growers; these page
         in the next window of OLDER rows past what's in memory, ordered
         created_at DESC (matching the frozen index contract), and append
         (de-duped). Each returns the count of NEW rows (0 = end of table). They
         degrade to 0 in demo mode and never throw on a missing/un-migrated
         table. UI wiring (infinite-scroll / "load older" buttons) is a follow-up. */
      loadMoreMonitorEvents: async (limit = MONITOR_EVENTS_WINDOW) => {
        if (isDemoMode()) return 0;
        try {
          const cur = stateRef.current.monitorEvents || [];
          const oldest = cur.length ? cur[cur.length - 1]?.createdAt : null;
          let q = supabase.from("monitor_events").select("*")
            .order("created_at", { ascending: false })
            .limit(limit);
          if (oldest) q = q.lt("created_at", oldest);
          const { data, error } = await q;
          if (error) throw error;
          const items = (data || []).map(monitorEventFromDb);
          if (items.length) dispatch({ type: "APPEND_MONITOR_EVENTS", items });
          return items.length;
        } catch (e) {
          console.warn("loadMoreMonitorEvents failed:", e?.message || e);
          return 0;
        }
      },

      loadMoreAttachedFootage: async (limit = RECENT_WINDOW) => {
        if (isDemoMode()) return 0;
        try {
          const cur = stateRef.current.attachedFootage || [];
          const oldest = cur.length ? cur[cur.length - 1]?.created_at : null;
          let q = supabase.from("attached_footage_items").select("*")
            .order("created_at", { ascending: false })
            .limit(limit);
          if (oldest) q = q.lt("created_at", oldest);
          const { data, error } = await q;
          if (error) throw error;
          const items = data || [];
          if (items.length) dispatch({ type: "APPEND_ATTACHED_FOOTAGE", items });
          return items.length;
        } catch (e) {
          console.warn("loadMoreAttachedFootage failed:", e?.message || e);
          return 0;
        }
      },

      loadMoreReelDnaAssets: async (limit = RECENT_WINDOW) => {
        if (isDemoMode()) return 0;
        try {
          const cur = stateRef.current.reelDnaAssets || [];
          const oldest = cur.length ? cur[cur.length - 1]?.createdAt : null;
          let q = supabase.from("reel_dna_assets").select("*")
            .order("created_at", { ascending: false })
            .limit(limit);
          if (oldest) q = q.lt("created_at", oldest);
          const { data, error } = await q;
          if (error) throw error;
          const items = (data || []).map(reelDnaAssetFromDb);
          if (items.length) dispatch({ type: "APPEND_REEL_DNA_ASSETS", items });
          return items.length;
        } catch (e) {
          console.warn("loadMoreReelDnaAssets failed:", e?.message || e);
          return 0;
        }
      },

      loadMoreEventLinks: async (limit = RECENT_WINDOW) => {
        if (isDemoMode()) return 0;
        try {
          const cur = stateRef.current.eventLinks || [];
          const oldest = cur.length ? cur[cur.length - 1]?.createdAt : null;
          let q = supabase.from("monitor_event_links").select("*")
            .order("created_at", { ascending: false })
            .limit(limit);
          if (oldest) q = q.lt("created_at", oldest);
          const { data, error } = await q;
          if (error) throw error;
          const items = (data || []).map(eventLinkFromDb);
          if (items.length) dispatch({ type: "APPEND_EVENT_LINKS", items });
          return items.length;
        } catch (e) {
          console.warn("loadMoreEventLinks failed:", e?.message || e);
          return 0;
        }
      },

      /* ═══════════════════════════════════════════════════════════════════════
         OpenCut collaborative editor (migration 0094 — HUMAN-GATED apply).
         edit_projects gallery CRUD + autosave + versions + AI/render wrappers.
         All never throw past the boundary (return {ok,...}); writes degrade if
         migration 0094 hasn't been applied (a missing table can't crash a click).
         ═══════════════════════════════════════════════════════════════════════ */

      /* Hydrated gallery list (boot-hydrated into state.editProjects). Exposed as
         an action so consumers have a single entry point matching the contract. */
      listEditProjects: () => stateRef.current.editProjects || [],

      /* Fetch ONE project fresh from the DB (authoritative timeline_json + lock
         metadata for opening the editor). Also UPSERTs it into the gallery so a
         project created in another tab opens cleanly. Never throws. */
      loadEditProject: async (id) => {
        if (!id) return { ok: false, error: "id required" };
        try {
          const { data, error } = await supabase
            .from("edit_projects").select("*").eq("id", id).maybeSingle();
          if (error) throw error;
          if (!data) return { ok: false, error: "Project not found" };
          const project = editProjectFromDb(data);
          dispatch({ type: "UPSERT_EDIT_PROJECT", item: project });
          return { ok: true, project };
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },

      /* Create a new edit project. Optimistic UPSERT (the realtime echo dedupes
         by id) using the wrap(optimistic, persist) pattern. timeline_json defaults
         to the empty-v2 doc. created_by = me. reel_id is a TEXT reel id; reel_dna_id
         is a uuid. Never throws — on persist error the optimistic row is removed
         and { ok:false } is returned. */
      createEditProject: async ({ reelId, reelDnaId, title } = {}) => {
        const me = _authPerson?.id || null;
        const id = (globalThis.crypto?.randomUUID?.() || `ep_${Date.now()}_${Math.random().toString(36).slice(2)}`);
        const now = new Date().toISOString();
        const timelineJson = emptyEditTimelineV2();
        const project = {
          id,
          title: (title || "").trim() || "Untitled edit",
          reelId: reelId ?? undefined,
          reelDnaId: reelDnaId ?? undefined,
          createdBy: me ?? undefined,
          timelineJson,
          version: 1,
          status: "draft",
          createdAt: now,
          updatedAt: now,
        };
        // Optimistic insert NOW (deduped against the realtime echo by id).
        dispatch({ type: "UPSERT_EDIT_PROJECT", item: project });
        try {
          const row = {
            id,
            title: project.title,
            created_by: me,
            timeline_json: timelineJson,
            status: "draft",
          };
          if (reelId != null)    row.reel_id = reelId;
          if (reelDnaId != null) row.reel_dna_id = reelDnaId;
          const { data, error } = await supabase
            .from("edit_projects").insert(row).select("*").maybeSingle();
          if (error) throw error;
          const saved = data ? editProjectFromDb(data) : project;
          dispatch({ type: "UPSERT_EDIT_PROJECT", item: saved });
          return { ok: true, project: saved };
        } catch (e) {
          // Roll back the optimistic insert — it never persisted.
          dispatch({ type: "DELETE_EDIT_PROJECT_BY_ID", id });
          console.warn("createEditProject failed:", e?.message || e);
          return { ok: false, error: e?.message || String(e) };
        }
      },

      /* DEBOUNCED + HOLDER-GUARDED autosave of timeline_json.
         · iAmHolder (default true) — the EDITOR flips this from its lock state;
           a non-holder call is a NO-OP (viewers never write).
         · Debounce: ~800ms idle (trailing edge), with a ~4s MAX-WAIT ceiling so a
           continuously-editing holder still flushes periodically.
         · On flush: UPDATE timeline_json, version=version+1, updated_at=now(),
           last_editor=me. Optimistically reflects the new doc locally so the
           editor stays responsive. On persist error we SURFACE (console + SET_ERROR)
           but do NOT roll back the user's local edits (work is never lost). */
      saveEditProjectTimeline: (id, timelineJson, iAmHolder = true) => {
        if (!id) return;
        if (!iAmHolder) return; // holder-guard: viewers/non-holders never persist
        const me = _authPerson?.id || null;
        // Optimistic local reflect — the editor's doc is the source of truth.
        dispatch({ type: "UPSERT_EDIT_PROJECT", item: { id, timelineJson, updatedAt: new Date().toISOString() } });

        const map = autosaveRef.current;
        const entry = map.get(id) || { idle: null, maxTs: 0, pending: null };
        entry.pending = { id, timelineJson };
        if (!entry.maxTs) entry.maxTs = Date.now();

        const flush = async () => {
          const e0 = map.get(id);
          if (!e0 || !e0.pending) return;
          const { timelineJson: doc } = e0.pending;
          // Clear the debounce bookkeeping before the await so edits arriving
          // mid-flush re-arm a fresh cycle.
          try { clearTimeout(e0.idle); } catch (_) {}
          map.delete(id);
          try {
            const cur = (stateRef.current.editProjects || []).find(p => p.id === id);
            const nextVersion = (cur?.version ?? 1) + 1;
            const { error } = await supabase
              .from("edit_projects")
              .update({
                timeline_json: doc,
                version: nextVersion,
                updated_at: new Date().toISOString(),
                last_editor: me,
              })
              .eq("id", id);
            if (error) throw error;
            // Reflect the bumped version locally (the realtime echo will confirm).
            dispatch({ type: "UPSERT_EDIT_PROJECT", item: { id, version: nextVersion, lastEditor: me ?? undefined } });
          } catch (err) {
            // Surface but DO NOT roll back — the user's local edits stay intact.
            console.error("saveEditProjectTimeline persist failed:", err?.message || err);
            dispatch({ type: "SET_ERROR", error: err?.message || String(err) });
          }
        };

        try { clearTimeout(entry.idle); } catch (_) {}
        const MAX_WAIT = 4000, IDLE = 800;
        const sinceFirst = Date.now() - entry.maxTs;
        if (sinceFirst >= MAX_WAIT) {
          // Ceiling hit — flush immediately rather than re-arming the idle timer.
          map.set(id, entry);
          flush();
          return;
        }
        const wait = Math.min(IDLE, MAX_WAIT - sinceFirst);
        entry.idle = setTimeout(flush, wait);
        map.set(id, entry);
      },

      /* Manual checkpoint — INSERT into edit_project_versions with the CURRENT
         timeline_json + version + saved_by. Never throws. */
      saveEditProjectVersion: async (id, label) => {
        if (!id) return { ok: false, error: "id required" };
        const me = _authPerson?.id || null;
        try {
          const cur = (stateRef.current.editProjects || []).find(p => p.id === id);
          let timelineJson = cur?.timelineJson;
          let version = cur?.version;
          // Fall back to a fresh read if the project isn't in local state.
          if (timelineJson === undefined || version === undefined) {
            const { data, error } = await supabase
              .from("edit_projects").select("timeline_json, version").eq("id", id).maybeSingle();
            if (error) throw error;
            timelineJson = data?.timeline_json;
            version = data?.version;
          }
          const { error } = await supabase
            .from("edit_project_versions")
            .insert({
              project_id: id,
              version: version ?? 1,
              label: (label || "").trim() || null,
              timeline_json: timelineJson ?? emptyEditTimelineV2(),
              saved_by: me,
            });
          if (error) throw error;
          return { ok: true };
        } catch (e) {
          console.warn("saveEditProjectVersion failed:", e?.message || e);
          return { ok: false, error: e?.message || String(e) };
        }
      },

      /* Restore a saved version. (1) Fetch that version's timeline_json. (2) FIRST
         save a SAFETY CHECKPOINT of the CURRENT doc (so a restore is undoable).
         (3) THEN persist the restored doc via the same UPDATE path as autosave
         (holder-guarded by the caller — restore is a holder-only action). Never
         throws. */
      restoreEditProjectVersion: async (id, versionId) => {
        if (!id || !versionId) return { ok: false, error: "id and versionId required" };
        const me = _authPerson?.id || null;
        try {
          // (1) Fetch the version's doc.
          const { data: ver, error: verErr } = await supabase
            .from("edit_project_versions").select("timeline_json").eq("id", versionId).maybeSingle();
          if (verErr) throw verErr;
          if (!ver) return { ok: false, error: "Version not found" };
          const restoredDoc = ver.timeline_json ?? emptyEditTimelineV2();

          // (2) Safety checkpoint of the CURRENT doc before overwriting it.
          const cur = (stateRef.current.editProjects || []).find(p => p.id === id);
          let curDoc = cur?.timelineJson;
          let curVersion = cur?.version;
          if (curDoc === undefined || curVersion === undefined) {
            const { data: cp } = await supabase
              .from("edit_projects").select("timeline_json, version").eq("id", id).maybeSingle();
            curDoc = cp?.timeline_json;
            curVersion = cp?.version;
          }
          try {
            await supabase.from("edit_project_versions").insert({
              project_id: id,
              version: curVersion ?? 1,
              label: "Before restore",
              timeline_json: curDoc ?? emptyEditTimelineV2(),
              saved_by: me,
            });
          } catch (cpErr) {
            // Checkpoint failure must not block the restore itself — log + continue.
            console.warn("restore safety-checkpoint failed:", cpErr?.message || cpErr);
          }

          // (3) Persist the restored doc (version bump + last_editor), and reflect
          // locally. Use the direct UPDATE path (not the debounced autosave) so a
          // restore lands immediately.
          const nextVersion = (curVersion ?? 1) + 1;
          dispatch({ type: "UPSERT_EDIT_PROJECT", item: { id, timelineJson: restoredDoc, version: nextVersion, updatedAt: new Date().toISOString(), lastEditor: me ?? undefined } });
          const { error: updErr } = await supabase
            .from("edit_projects")
            .update({ timeline_json: restoredDoc, version: nextVersion, updated_at: new Date().toISOString(), last_editor: me })
            .eq("id", id);
          if (updErr) throw updErr;
          return { ok: true };
        } catch (e) {
          console.warn("restoreEditProjectVersion failed:", e?.message || e);
          return { ok: false, error: e?.message || String(e) };
        }
      },

      /* Rename — optimistic UPSERT + persist. Never throws. */
      renameEditProject: async (id, title) => {
        if (!id) return;
        const clean = (title || "").trim() || "Untitled edit";
        dispatch({ type: "UPSERT_EDIT_PROJECT", item: { id, title: clean, updatedAt: new Date().toISOString() } });
        try {
          await supabase.from("edit_projects").update({ title: clean, updated_at: new Date().toISOString() }).eq("id", id);
        } catch (e) { console.warn("renameEditProject failed:", e?.message || e); }
      },

      /* Set the gallery thumbnail — optimistic UPSERT + persist. Never throws. */
      setEditProjectThumbnail: async (id, url) => {
        if (!id) return;
        dispatch({ type: "UPSERT_EDIT_PROJECT", item: { id, thumbnailUrl: url ?? undefined, updatedAt: new Date().toISOString() } });
        try {
          await supabase.from("edit_projects").update({ thumbnail_url: url ?? null, updated_at: new Date().toISOString() }).eq("id", id);
        } catch (e) { console.warn("setEditProjectThumbnail failed:", e?.message || e); }
      },

      /* Delete the project row + drop it locally (versions/locks cascade server-side
         via FK ON DELETE CASCADE). Optimistic remove; re-add on persist failure. */
      deleteEditProject: async (id) => {
        if (!id) return;
        const prev = (stateRef.current.editProjects || []).find(p => p.id === id);
        dispatch({ type: "DELETE_EDIT_PROJECT_BY_ID", id });
        try {
          const { error } = await supabase.from("edit_projects").delete().eq("id", id);
          if (error) throw error;
        } catch (e) {
          console.warn("deleteEditProject failed:", e?.message || e);
          if (prev) dispatch({ type: "UPSERT_EDIT_PROJECT", item: prev });
        }
      },

      /* Archive (soft-hide) / unarchive a project — flips status to 'archived'
         (reversible to 'draft'). Optimistic UPSERT + persist; on failure the
         prior status is restored. Owner-gated in the UI; RLS still governs the
         write. Never throws. */
      archiveEditProject: async (id, archived = true) => {
        if (!id) return;
        const status = archived ? "archived" : "draft";
        const prevStatus = (stateRef.current.editProjects || []).find(p => p.id === id)?.status;
        dispatch({ type: "UPSERT_EDIT_PROJECT", item: { id, status, updatedAt: new Date().toISOString() } });
        try {
          const { error } = await supabase
            .from("edit_projects")
            .update({ status, updated_at: new Date().toISOString() })
            .eq("id", id);
          if (error) throw error;
        } catch (e) {
          console.warn("archiveEditProject failed:", e?.message || e);
          dispatch({ type: "UPSERT_EDIT_PROJECT", item: { id, status: prevStatus ?? "draft" } });
        }
      },

      /* ───── AI / render client wrappers — POST/GET to api/ai/suggest.js with the
         session JWT, mirroring the epidemic/deconstruct call sites. They consume
         the FROZEN captions / silence / render action shapes and NEVER throw
         (always return {ok,...}). The worker secret stays server-side. ───── */

      // POST ?action=captions-submit  → { ok, jobId }
      submitCaptions: async (projectId, sourceDriveId, opts = {}) => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) return { ok: false, error: "Not signed in" };
          const body = { project_id: projectId, source_drive_id: sourceDriveId };
          if (opts?.language !== undefined) body.language = opts.language;
          const res = await fetch("/api/ai/suggest?action=captions-submit", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json?.ok === false) return { ok: false, error: json?.error || `Captions submit failed (${res.status})` };
          return { ok: true, jobId: json.job_id };
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },

      // GET ?action=captions-status&id= → { ok, status, progress, captions }
      pollCaptions: async (jobId) => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) return { ok: false, error: "Not signed in" };
          if (!jobId) return { ok: false, error: "jobId required" };
          const res = await fetch(`/api/ai/suggest?action=captions-status&id=${encodeURIComponent(jobId)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json?.ok === false) return { ok: false, error: json?.error || `Captions status failed (${res.status})` };
          return { ok: true, status: json.status, progress: json.progress, captions: Array.isArray(json.captions) ? json.captions : [] };
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },

      // POST ?action=silence-submit  → { ok, jobId }
      submitSilenceScan: async (projectId, sourceDriveId, opts = {}) => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) return { ok: false, error: "Not signed in" };
          const body = { project_id: projectId, source_drive_id: sourceDriveId };
          if (opts?.options !== undefined) body.options = opts.options;
          const res = await fetch("/api/ai/suggest?action=silence-submit", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json?.ok === false) return { ok: false, error: json?.error || `Silence submit failed (${res.status})` };
          return { ok: true, jobId: json.job_id };
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },

      // GET ?action=silence-status&id= → { ok, status, progress, suggestedCuts }
      pollSilence: async (jobId) => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) return { ok: false, error: "Not signed in" };
          if (!jobId) return { ok: false, error: "jobId required" };
          const res = await fetch(`/api/ai/suggest?action=silence-status&id=${encodeURIComponent(jobId)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json?.ok === false) return { ok: false, error: json?.error || `Silence status failed (${res.status})` };
          return { ok: true, status: json.status, progress: json.progress, suggestedCuts: Array.isArray(json.suggestedCuts) ? json.suggestedCuts : [] };
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },

      // POST ?action=render-submit  → { ok, jobId }
      submitProjectRender: async (projectId, projectJson, opts = {}) => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) return { ok: false, error: "Not signed in" };
          const body = { project_id: projectId, project_json: projectJson };
          if (opts?.renderMode !== undefined) body.render_mode = opts.renderMode;
          const res = await fetch("/api/ai/suggest?action=render-submit", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json?.ok === false) return { ok: false, error: json?.error || `Render submit failed (${res.status})` };
          return { ok: true, jobId: json.job_id };
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },

      // GET ?action=render-status&id= → { ok, status, progress, output_url, error }
      pollRenderJob: async (jobId) => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) return { ok: false, error: "Not signed in" };
          if (!jobId) return { ok: false, error: "jobId required" };
          const res = await fetch(`/api/ai/suggest?action=render-status&id=${encodeURIComponent(jobId)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json?.ok === false) return { ok: false, error: json?.error || `Render status failed (${res.status})` };
          return { ok: true, status: json.status, progress: json.progress, output_url: json.output_url, error: json.error };
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },
    },
  }), [state, wrap]);

  return (
    <WorkflowContext.Provider value={value}>
      {state.loaded
        ? children
        : <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100vh", color: "var(--fg-mute)", fontFamily: "var(--f-mono)",
            fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase",
          }}>
            {state.error ? "error · " + state.error : "loading workflow…"}
          </div>}
    </WorkflowContext.Provider>
  );
}

function useWorkflow() {
  const ctx = React.useContext(WorkflowContext);
  if (!ctx) throw new Error("useWorkflow must be used inside <WorkflowProvider>");
  return ctx;
}

/* Devtools escape hatches — exposed on `window` so they can be run
   from the browser console when the UI's delete flow isn't enough
   (e.g. for shadow review-lane cards that don't get cascade-deleted
   when their parent reel id is missing). */
if (typeof window !== "undefined") {
  window.__resetWorkflow = () => {
    try {
      localStorage.removeItem("workflow.board.items.v1");
      localStorage.removeItem("workflow.store.v1");
    } catch (_) {}
    location.reload();
  };

  /* Hard-delete one or more reels straight from the DB. Bypasses the
     normal store actions so it works even if the UI delete button is
     somehow not reaching the row. Cascades clean up review-lane
     shadow cards, attached footage, and reel-scoped tasks via FK.
     Usage in browser console:
       __deleteReels('REEL-188','REEL-195')
       __deleteReels(['REEL-188','REEL-195'])              // also OK
  */
  window.__deleteReels = async (...args) => {
    const ids = args.flat().filter(Boolean);
    if (!ids.length) { console.log("usage: __deleteReels('REEL-188','REEL-195')"); return; }
    // Belt and braces: explicitly clear shadow cards that share the
    // parent id, in case some old row lost its FK in a prior schema
    // change. Cascade should already handle them.
    const r1 = await supabase.from("review_lane_cards").delete().in("parent_id", ids);
    const r2 = await supabase.from("reels").delete().in("id", ids);
    if (r1.error) console.error("review_lane_cards delete:", r1.error);
    if (r2.error) console.error("reels delete:", r2.error);
    console.log("Deleted reels: " + ids.join(", ") + ". Refresh to confirm.");
  };
}

export { WorkflowProvider, useWorkflow, WorkflowContext, nextReelId };
