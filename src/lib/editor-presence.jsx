/**
 * useEditorPresence(projectId)
 *
 * Supabase Realtime Broadcast presence channel for the video editor.
 * Each open editor tab tracks: who's here, what track they own, where their
 * playhead is. Track-level soft locking lives in the `editor_locks` DB table;
 * this hook handles the ephemeral in-memory presence + lock claim/release.
 *
 * Presence state broadcast on channel.track():
 *   { person_id, name, color, current_track, playhead_seconds, last_seen }
 *
 * Heartbeat: track() is called every 20s to renew the DB lock expiry.
 * Supabase auto-removes a client's presence on disconnect (the `leave` event).
 * UI hides presences where last_seen > 60s as a display-only safety net.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "./supabase-client.js";

const HEARTBEAT_MS   = 20_000;   // renew every 20s
const LOCK_TTL_S     = 30;       // DB lock expires_at = now() + 30s
const GHOST_HIDE_MS  = 60_000;   // hide presences silent for 60s

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

export function useEditorPresence(projectId, person) {
  const [presences, setPresences]   = useState([]);  // array of presence state objects
  const [myTrack, setMyTrack]       = useState(null); // track_id we currently hold
  const channelRef  = useRef(null);
  const heartbeatRef = useRef(null);
  const myTrackRef  = useRef(null);

  const personId = person?.id;
  const personName = person?.name || personId;

  // ── Broadcast our current state ──────────────────────────────────────────
  const broadcast = useCallback((overrides = {}) => {
    if (!channelRef.current || !personId) return;
    channelRef.current.track({
      person_id:        personId,
      name:             personName,
      color:            colorFor(personId),
      current_track:    myTrackRef.current,
      playhead_seconds: overrides.playhead_seconds ?? null,
      last_seen:        new Date().toISOString(),
      ...overrides,
    });
  }, [personId, personName]);

  // ── Renew DB lock heartbeat ───────────────────────────────────────────────
  const renewLock = useCallback(async () => {
    if (!myTrackRef.current || !projectId) return;
    const expiresAt = new Date(Date.now() + LOCK_TTL_S * 1000).toISOString();
    await supabase
      .from("editor_locks")
      .update({ expires_at: expiresAt, heartbeat_at: new Date().toISOString() })
      .eq("project_id", projectId)
      .eq("track_id", myTrackRef.current)
      .eq("locked_by", personId);
  }, [projectId, personId]);

  // ── Claim a track (returns { ok, claimedBy } on conflict) ────────────────
  const claimTrack = useCallback(async (trackId) => {
    if (!projectId || !personId) return { ok: false, reason: "not authenticated" };

    // Release old lock first
    if (myTrackRef.current && myTrackRef.current !== trackId) {
      await releaseTrack();
    }
    if (myTrackRef.current === trackId) return { ok: true }; // already ours

    // Sweep expired locks before attempting INSERT
    const now = new Date().toISOString();
    await supabase
      .from("editor_locks")
      .delete()
      .eq("project_id", projectId)
      .eq("track_id", trackId)
      .lt("expires_at", now);

    const expiresAt = new Date(Date.now() + LOCK_TTL_S * 1000).toISOString();
    const { error } = await supabase.from("editor_locks").insert({
      project_id:   projectId,
      track_id:     trackId,
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
        .eq("track_id", trackId)
        .single();
      const holderName = data?.people?.name || data?.locked_by || "another editor";
      return { ok: false, reason: `Track held by ${holderName}`, claimedBy: data?.locked_by };
    }

    myTrackRef.current = trackId;
    setMyTrack(trackId);
    broadcast({ current_track: trackId });
    return { ok: true };
  }, [projectId, personId, broadcast]);

  // ── Release current track lock ────────────────────────────────────────────
  const releaseTrack = useCallback(async () => {
    if (!myTrackRef.current || !projectId || !personId) return;
    await supabase
      .from("editor_locks")
      .delete()
      .eq("project_id", projectId)
      .eq("track_id", myTrackRef.current)
      .eq("locked_by", personId);
    myTrackRef.current = null;
    setMyTrack(null);
    broadcast({ current_track: null });
  }, [projectId, personId, broadcast]);

  // ── Update playhead (cheap — broadcast only, no DB write) ────────────────
  const updatePlayhead = useCallback((seconds) => {
    broadcast({ playhead_seconds: seconds });
  }, [broadcast]);

  // ── Channel lifecycle ─────────────────────────────────────────────────────
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
            person_id:     personId,
            name:          personName,
            color:         colorFor(personId),
            current_track: null,
            playhead_seconds: null,
            last_seen:     new Date().toISOString(),
          });
        }
      });

    channelRef.current = channel;

    // Heartbeat: renew DB lock + re-broadcast every 20s
    heartbeatRef.current = setInterval(() => {
      broadcast();
      renewLock();
    }, HEARTBEAT_MS);

    return () => {
      clearInterval(heartbeatRef.current);
      // Release our lock before leaving
      if (myTrackRef.current && projectId && personId) {
        supabase
          .from("editor_locks")
          .delete()
          .eq("project_id", projectId)
          .eq("track_id", myTrackRef.current)
          .eq("locked_by", personId)
          .then(() => {});
      }
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [projectId, personId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { presences, myTrack, claimTrack, releaseTrack, updatePlayhead };
}
