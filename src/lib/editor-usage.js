/* =========================================================
   editor-usage.js — durable editor USAGE tracking (history).

   The live "who holds the edit lock right now" signal already
   exists (editor_locks 0082 for the native editor, oc_locks 0096
   for the iframe-embedded fork), but those rows are EPHEMERAL —
   deleted/expired on release — so they carry NO history.

   This hook writes the durable log: one `editor_usage_sessions`
   row (migration 0097) each time a teammate OPENS a project in the
   editor, heartbeated while open and stamped `ended_at` on close.
   The owner-only "Editor usage" card on the Monitor hub reads it to
   show per-person / per-project usage OVER TIME.

   Design notes:
     · Written entirely FB-side by the iframe PARENT (editor.jsx) —
       the OpenCut fork is never touched. The parent is mounted for
       the whole editing session and knows person/project/preset.
     · Every read/write degrades SILENTLY (try/catch, never throws) —
       a missing table (0097 not yet applied) can never brick the
       editor. Mirrors the editor-ui-preset.js fail-safe posture.
     · A best-effort `ended_at` may be missed on a hard tab-close;
       the Monitor card therefore also treats a row whose
       `last_active_at` is older than the heartbeat-staleness window
       as closed. So a missed end stamp never shows a ghost session.
   ========================================================= */

import { useEffect, useRef } from "react";
import { supabase } from "./supabase-client.js";

const USAGE_TABLE = "editor_usage_sessions";

/* Heartbeat the open session every 60s (bumps last_active_at). The Monitor
   card's "still open" staleness window is a small multiple of this. */
export const USAGE_HEARTBEAT_MS = 60_000;

/* Best-effort end stamp — never throws. Exported for tests / manual cleanup. */
async function endSession(id) {
  if (!id) return;
  try {
    await supabase
      .from(USAGE_TABLE)
      .update({ ended_at: new Date().toISOString() })
      .eq("id", id)
      .is("ended_at", null);
  } catch { /* table missing / offline — best effort only */ }
}

/**
 * useEditorUsageSession({ projectId, reelId, person, preset, source, active })
 *
 * Logs an editor usage session for as long as `active` is true and a
 * (projectId, person) pair is present. Re-keys (ends the old, starts a new
 * session) when the project or person changes. Cleans up on unmount and on
 * tab-close (beforeunload). All writes are best-effort and never throw.
 */
export function useEditorUsageSession({
  projectId,
  reelId = null,
  person,
  preset = "capcut",
  source = "embed",
  active = true,
} = {}) {
  const sessionIdRef = useRef(null);   // id of the open row (null = none open)
  const hbRef = useRef(null);          // heartbeat interval handle
  const personId = person?.id || null;
  const personName = person?.name || personId || null;

  // Keep the latest mutable bits in a ref so the heartbeat / unload handlers
  // don't need to re-subscribe on every prop tick.
  const metaRef = useRef({ preset, source, reelId, personName });
  metaRef.current = { preset, source, reelId, personName };

  useEffect(() => {
    // Only track a real, open editor session.
    if (!active || !projectId || !personId) return;

    let cancelled = false;

    const stopHeartbeat = () => {
      if (hbRef.current) { clearInterval(hbRef.current); hbRef.current = null; }
    };

    const beat = () => {
      const id = sessionIdRef.current;
      if (!id) return;
      supabase
        .from(USAGE_TABLE)
        .update({ last_active_at: new Date().toISOString() })
        .eq("id", id)
        .then(() => {}, () => {}); // swallow — best effort
    };

    // INSERT the open session row and remember its id.
    (async () => {
      try {
        const { preset: p, source: s, reelId: rid, personName: pn } = metaRef.current;
        const { data, error } = await supabase
          .from(USAGE_TABLE)
          .insert({
            project_id: projectId,
            reel_id: rid,
            person_id: personId,
            person_name: pn,
            preset: p,
            source: s,
            started_at: new Date().toISOString(),
            last_active_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (cancelled) {
          // Effect already tore down before the insert resolved — close it.
          if (!error && data?.id) endSession(data.id);
          return;
        }
        if (error || !data?.id) return;          // table missing / RLS — silently skip
        sessionIdRef.current = data.id;
        hbRef.current = setInterval(beat, USAGE_HEARTBEAT_MS);
      } catch { /* never throw out of an effect */ }
    })();

    // Best-effort end stamp if the tab is closed while open.
    const onUnload = () => {
      const id = sessionIdRef.current;
      if (id) endSession(id);
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", onUnload);
      stopHeartbeat();
      const id = sessionIdRef.current;
      sessionIdRef.current = null;
      if (id) endSession(id);
    };
    // Re-key when the project or person changes (ends old session, starts new).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, projectId, personId]);
}
