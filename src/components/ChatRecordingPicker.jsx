/**
 * Chat Recording Picker
 *
 * Pick a screen recording an editor posted into a Rocket.Chat channel and set it
 * as the reel's "Current reel state". The backend re-hosts the chosen file into
 * the private reel-videos bucket and points the reel's media_path at it (the same
 * frozen contract the Final-video uploader + Planable push use), so on success
 * we just `updateReel({ mediaPath, mediaTarget: 'supabase' })`.
 *
 * Reuses the read-only Modal.jsx shell the same way MusicPickerModal does, and
 * the JWT-gated /dashboard/* Rocket.Chat endpoints via social-client.js.
 * Available to everyone (not owner-gated).
 */

import React, { useEffect, useState } from "react";
import { Modal } from "./modals/Modal.jsx";
import { supabase } from "../lib/supabase-client.js";
import { fetchChannelFiles, attachChatRecording } from "../lib/social-client.js";

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return "";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ChatRecordingPicker({ reelId, onClose, onAttached }) {
  // Channels are { name, private }. We need the private flag to pick the right
  // RC files endpoint (channels.files vs groups.files).
  const [channels, setChannels] = useState([]);
  const [channel, setChannel] = useState("");
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [attaching, setAttaching] = useState(null); // file id in flight
  const [error, setError] = useState(null);

  // Load the channel list once (JWT-gated), same call ReelSharePicker uses.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        if (!token) return;
        const res = await fetch("/fb/api/rocketchat/dashboard/channels", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const j = await res.json().catch(() => ({}));
        if (cancelled) return;
        const list = (j.channels || []).filter((c) => c && c.name);
        setChannels(list);
        const initial = list.find((c) => c.name === "pipeline") || list[0];
        if (initial) setChannel(initial.name);
      } catch (_) { /* leave empty — picker shows the no-channels hint */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const isPrivate = !!channels.find((c) => c.name === channel)?.private;

  // Load this channel's recent video uploads whenever the selection changes.
  useEffect(() => {
    if (!channel) { setFiles([]); return; }
    let cancelled = false;
    setLoadingFiles(true);
    setError(null);
    (async () => {
      const { files: list } = await fetchChannelFiles({ channel, private: isPrivate, limit: 20 });
      if (cancelled) return;
      setFiles(list);
      setLoadingFiles(false);
    })();
    return () => { cancelled = true; };
  }, [channel, isPrivate]);

  async function handleAttach(f) {
    if (attaching) return;
    setAttaching(f.id);
    setError(null);
    const res = await attachChatRecording({
      reelId, fileId: f.id, name: f.name, channel, private: isPrivate,
    });
    setAttaching(null);
    if (!res.ok) {
      setError(res.error || "Attach failed.");
      return;
    }
    onAttached?.(res.media_path);
    onClose?.();
  }

  return (
    <Modal
      title="Attach a recording from chat"
      subtitle="Pick a screen recording an editor posted in a channel — it becomes this reel's current state."
      onClose={onClose}
      onSubmit={onClose}
      submitLabel="Done"
    >
      <div className="m-field">
        <div className="m-label">Channel</div>
        <select
          className="m-select"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        >
          {channels.length === 0 && <option value="">No channels available</option>}
          {channels.map((c) => (
            <option key={c.name} value={c.name}>
              {c.private ? "🔒 " : "# "}{c.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: "var(--danger, #c62828)", margin: "6px 0" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        {loadingFiles && (
          <div style={{ fontSize: 13, color: "var(--fg-mute, #888)" }}>Loading recordings…</div>
        )}
        {!loadingFiles && files.length === 0 && channel && (
          <div style={{ fontSize: 13, color: "var(--fg-mute, #888)" }}>
            No video recordings found in #{channel}.
          </div>
        )}
        {files.map((f) => (
          <div
            key={f.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              border: "1px solid var(--border, #ddd)",
              borderRadius: 6,
              padding: "8px 10px",
            }}
          >
            <span style={{ fontSize: 18 }}>🎬</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--fg)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={f.name}
              >
                {f.name}
              </div>
              <div style={{ fontSize: 11, color: "var(--fg-mute, #888)" }}>
                {[f.uploader, fmtWhen(f.ts), fmtSize(f.size_bytes)].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button
              className="dpill"
              disabled={!!attaching}
              onClick={() => handleAttach(f)}
              style={{ cursor: attaching ? "wait" : "pointer", whiteSpace: "nowrap" }}
            >
              {attaching === f.id ? "Attaching…" : "Set as state"}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
