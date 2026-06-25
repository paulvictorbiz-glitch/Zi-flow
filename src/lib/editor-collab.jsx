/**
 * editor-collab.jsx — project-level SINGLE-WRITER collaboration for the video editor.
 *
 * Collab model: ONE writer at a time per project (a "Take control" lock), live
 * multi-viewer presence, and a viewer row-stream that pushes the holder's saved
 * timeline to everyone else. NO track-level locks, NO CRDT.
 *
 * The lock reuses the existing `editor_locks` table (PK = (project_id, track_id),
 * TTL via expires_at, "authenticated manage" RLS) by claiming ONE sentinel row
 * with track_id = '__project__'. The claim/release/renew/sweep logic is adapted
 * VERBATIM from src/lib/editor-presence.jsx (claimTrack/releaseTrack/renewLock).
 *
 * Presence reuses the Broadcast channel `editor-presence-${projectId}` and
 * repurposes the old `current_track` field as a boolean `is_editing`.
 *
 *   useProjectLock(projectId, person) -> {
 *     presences,                                  // [{ person_id, name, color, playhead_seconds, is_editing, last_seen }]
 *     lockState: { heldBy, heldByName, isStale, iAmHolder },
 *     takeControl() -> { ok } | { ok:false, heldBy, heldByName },
 *     releaseControl(),
 *     updatePlayhead(seconds)
 *   }
 *
 *   useProjectTimelineSync(projectId, { onUpdate, myVersion }) — viewer row-stream
 *     on `edit-project-${projectId}` (postgres_changes UPDATE id=eq.projectId),
 *     calls onUpdate(timeline_json, version) with a version-guard so the holder's
 *     own echo never clobbers in-flight local edits.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "./supabase-client.js";

const PROJECT_TRACK = "__project__"; // sentinel track_id = the project-level single-writer lock

const HEARTBEAT_MS  = 10_000;  // renew DB lock every 10s (lock heartbeat)
const PRESENCE_MS   = 20_000;  // re-broadcast presence every 20s
const LOCK_TTL_S    = 30;      // DB lock expires_at = now() + 30s
const GHOST_HIDE_MS = 60_000;  // hide presences silent for 60s

const PRESENCE_COLORS = {
  paul: "#6366f1",
  alex: "#10b981",
  sam:  "#f59e0b",
  maya: "#ef4444",
};

function colorFor(personId) {
  return PRESENCE_COLORS[personId] ||
    "#" + ((personId || "").split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) & 0xFFFFFF)
      .toString(16).padStart(6, "0");
}

export function useProjectLock(projectId, person) {
  const [presences, setPresences] = useState([]); // array of presence state objects
  const [lockRow, setLockRow]     = useState(null); // latest editor_locks row for the sentinel
  const [iHold, setIHold]         = useState(false); // I currently hold the project lock

  const presenceChannelRef = useRef(null);
  const lockChannelRef     = useRef(null);
  const presenceHbRef      = useRef(null);
  const lockHbRef          = useRef(null);
  const iHoldRef           = useRef(false);
  const playheadRef        = useRef(null);

  const personId   = person?.id;
  const personName = person?.name || personId;

  // ── Broadcast our presence state ──────────────────────────────────────────
  const broadcast = useCallback((overrides = {}) => {
    if (!presenceChannelRef.current || !personId) return;
    presenceChannelRef.current.track({
      person_id:        personId,
      name:             personName,
      color:            colorFor(personId),
      is_editing:       iHoldRef.current,          // repurposed from current_track
      playhead_seconds: overrides.playhead_seconds ?? playheadRef.current ?? null,
      last_seen:        new Date().toISOString(),
      ...overrides,
    });
  }, [personId, personName]);

  // ── Renew DB lock heartbeat (adapted VERBATIM from renewLock) ─────────────
  const renewLock = useCallback(async () => {
    if (!iHoldRef.current || !projectId || !personId) return;
    const expiresAt = new Date(Date.now() + LOCK_TTL_S * 1000).toISOString();
    await supabase
      .from("editor_locks")
      .update({ expires_at: expiresAt, heartbeat_at: new Date().toISOString() })
      .eq("project_id", projectId)
      .eq("track_id", PROJECT_TRACK)
      .eq("locked_by", personId);
  }, [projectId, personId]);

  // ── Take control (adapted VERBATIM from claimTrack) ──────────────────────
  const takeControl = useCallback(async () => {
    if (!projectId || !personId) return { ok: false, heldBy: null, heldByName: null };

    if (iHoldRef.current) return { ok: true }; // already ours

    // Sweep expired locks before attempting INSERT
    const now = new Date().toISOString();
    await supabase
      .from("editor_locks")
      .delete()
      .eq("project_id", projectId)
      .eq("track_id", PROJECT_TRACK)
      .lt("expires_at", now);

    const expiresAt = new Date(Date.now() + LOCK_TTL_S * 1000).toISOString();
    const { error } = await supabase.from("editor_locks").insert({
      project_id:   projectId,
      track_id:     PROJECT_TRACK,
      locked_by:    personId,
      expires_at:   expiresAt,
      heartbeat_at: now,
    });

    if (error) {
      // PK conflict = another editor holds it. Look up who.
      const { data } = await supabase
        .from("editor_locks")
        .select("locked_by, people(name)")
        .eq("project_id", projectId)
        .eq("track_id", PROJECT_TRACK)
        .single();
      const heldBy = data?.locked_by || null;
      const heldByName = data?.people?.name || data?.locked_by || "another editor";
      return { ok: false, heldBy, heldByName };
    }

    iHoldRef.current = true;
    setIHold(true);
    // Start the 10s lock heartbeat
    if (lockHbRef.current) clearInterval(lockHbRef.current);
    lockHbRef.current = setInterval(renewLock, HEARTBEAT_MS);
    broadcast({ is_editing: true });
    return { ok: true };
  }, [projectId, personId, broadcast, renewLock]);

  // ── Release control (adapted VERBATIM from releaseTrack) ─────────────────
  const releaseControl = useCallback(async () => {
    if (lockHbRef.current) {
      clearInterval(lockHbRef.current);
      lockHbRef.current = null;
    }
    if (!iHoldRef.current || !projectId || !personId) {
      iHoldRef.current = false;
      setIHold(false);
      return;
    }
    await supabase
      .from("editor_locks")
      .delete()
      .eq("project_id", projectId)
      .eq("track_id", PROJECT_TRACK)
      .eq("locked_by", personId);
    iHoldRef.current = false;
    setIHold(false);
    broadcast({ is_editing: false });
  }, [projectId, personId, broadcast]);

  // ── Update playhead (cheap — broadcast only, no DB write) ────────────────
  const updatePlayhead = useCallback((seconds) => {
    playheadRef.current = seconds;
    broadcast({ playhead_seconds: seconds });
  }, [broadcast]);

  // ── Presence channel lifecycle (reuses editor-presence-${projectId}) ─────
  useEffect(() => {
    if (!projectId || !personId) return;

    const channel = supabase.channel(`editor-presence-${projectId}`, {
      config: { presence: { key: personId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const now = Date.now();
        const active = Object.values(state).flat().filter(p =>
          p.last_seen && (now - new Date(p.last_seen).getTime()) < GHOST_HIDE_MS
        );
        setPresences(active);
      })
      .on("presence", { event: "join" }, ({ newPresences }) => {
        setPresences(prev => {
          const ids = new Set(newPresences.map(p => p.person_id));
          return [...prev.filter(p => !ids.has(p.person_id)), ...newPresences];
        });
      })
      .on("presence", { event: "leave" }, ({ leftPresences }) => {
        const ids = new Set(leftPresences.map(p => p.person_id));
        setPresences(prev => prev.filter(p => !ids.has(p.person_id)));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            person_id:        personId,
            name:             personName,
            color:            colorFor(personId),
            is_editing:       iHoldRef.current,
            playhead_seconds: null,
            last_seen:        new Date().toISOString(),
          });
        }
      });

    presenceChannelRef.current = channel;

    // Presence heartbeat: re-broadcast every 20s
    presenceHbRef.current = setInterval(() => { broadcast(); }, PRESENCE_MS);

    return () => {
      clearInterval(presenceHbRef.current);
      supabase.removeChannel(channel);
      presenceChannelRef.current = null;
    };
  }, [projectId, personId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lock observation channel (own channel, postgres_changes filtered) ────
  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    // Initial read of the sentinel lock row
    (async () => {
      const { data } = await supabase
        .from("editor_locks")
        .select("locked_by, expires_at, people(name)")
        .eq("project_id", projectId)
        .eq("track_id", PROJECT_TRACK)
        .maybeSingle();
      if (!cancelled) setLockRow(data || null);
    })();

    let channel;
    try {
      channel = supabase
        .channel(`edit-lock-${projectId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "editor_locks",
            filter: `project_id=eq.${projectId}`,
          },
          (payload) => {
            const row = payload.eventType === "DELETE" ? null : payload.new;
            // Only react to the sentinel project-level row
            if (payload.eventType === "DELETE") {
              if (payload.old?.track_id === PROJECT_TRACK) setLockRow(null);
              return;
            }
            if (row?.track_id === PROJECT_TRACK) setLockRow(row);
          }
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR") {
            console.warn(`[editor-collab] lock channel error for ${projectId}`);
          }
        });
      lockChannelRef.current = channel;
    } catch (err) {
      console.warn("[editor-collab] failed to subscribe lock channel", err);
    }

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      lockChannelRef.current = null;
    };
  }, [projectId]);

  // ── Best-effort release on unmount / tab-close ───────────────────────────
  useEffect(() => {
    if (!projectId || !personId) return;
    const cleanup = () => {
      if (iHoldRef.current) {
        supabase
          .from("editor_locks")
          .delete()
          .eq("project_id", projectId)
          .eq("track_id", PROJECT_TRACK)
          .eq("locked_by", personId)
          .then(() => {});
      }
    };
    window.addEventListener("beforeunload", cleanup);
    return () => {
      window.removeEventListener("beforeunload", cleanup);
      if (lockHbRef.current) {
        clearInterval(lockHbRef.current);
        lockHbRef.current = null;
      }
      cleanup(); // best-effort DELETE on unmount
    };
  }, [projectId, personId]);

  // ── Derive lockState from the observed row ───────────────────────────────
  const now = Date.now();
  const rowExpires = lockRow?.expires_at ? new Date(lockRow.expires_at).getTime() : 0;
  const rowFresh = !!lockRow && rowExpires > now;
  const isStale  = !!lockRow && rowExpires <= now;
  const heldBy   = rowFresh ? lockRow.locked_by : null;
  const heldByName = rowFresh ? (lockRow.people?.name || lockRow.locked_by) : null;
  const iAmHolder = (heldBy && heldBy === personId) || (iHold && rowFresh && heldBy === personId);

  const lockState = {
    heldBy,
    heldByName,
    isStale,
    iAmHolder: !!iAmHolder,
  };

  return {
    presences,
    lockState,
    takeControl,
    releaseControl,
    updatePlayhead,
  };
}

/**
 * useProjectTimelineSync(projectId, { onUpdate, myVersion })
 *
 * Viewer row-stream: subscribes to the single `edit_projects` row for this
 * project (postgres_changes UPDATE, filter id=eq.projectId) on its OWN channel
 * and calls onUpdate(timeline_json, version) whenever the holder saves.
 *
 * Version guard: the holder's own echo (a row update whose version is <= the
 * version the caller already wrote locally, passed via the `myVersion` ref/value)
 * is dropped, so a viewer who has just become the writer never has their
 * in-flight local edits clobbered by a stale realtime echo.
 */
export function useProjectTimelineSync(projectId, { onUpdate, myVersion } = {}) {
  const onUpdateRef = useRef(onUpdate);
  const myVersionRef = useRef(myVersion);
  onUpdateRef.current = onUpdate;
  myVersionRef.current = myVersion;

  useEffect(() => {
    if (!projectId) return;

    const readMyVersion = () => {
      const v = myVersionRef.current;
      // support either a plain value or a ref-like { current }
      if (v && typeof v === "object" && "current" in v) return v.current;
      return v;
    };

    let channel;
    try {
      channel = supabase
        .channel(`edit-project-${projectId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "edit_projects",
            filter: `id=eq.${projectId}`,
          },
          (payload) => {
            const row = payload.new;
            if (!row) return;
            const incomingVersion = row.version ?? null;
            const localVersion = readMyVersion();
            // Drop the holder's own echo / any stale-or-equal version so
            // in-flight local edits are never clobbered.
            if (
              incomingVersion != null &&
              localVersion != null &&
              incomingVersion <= localVersion
            ) {
              return;
            }
            try {
              onUpdateRef.current?.(row.timeline_json, incomingVersion);
            } catch (err) {
              console.warn("[editor-collab] onUpdate handler threw", err);
            }
          }
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR") {
            console.warn(`[editor-collab] project sync channel error for ${projectId}`);
          }
        });
    } catch (err) {
      console.warn("[editor-collab] failed to subscribe project sync channel", err);
    }

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [projectId]);
}
