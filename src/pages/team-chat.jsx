import React, { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "../auth.jsx";
import { getChatNotifyPref, setChatNotifyPref, shareReelToChannel } from "../lib/social-client.js";
// shareReelToChannel is also used inside ReelComparePanel below.
import { useWorkflow } from "../store/store.jsx";
import { supabase } from "../lib/supabase-client.js";
import { ReelCompareModal } from "../components/ReelCompareModal.jsx";

// Origin of the embedded Rocket.Chat iframe (used for postMessage validation).
const RC_ORIGIN = "https://chat.footagebrain.com";

/* Share-a-reel picker: a search-as-you-type dropdown over pipeline reels.
   Pick a reel (scroll / arrow keys / Enter / click), add feedback, send.
   Sending posts a reference card into the chosen Rocket.Chat channel AND
   saves the feedback as a comment on the reel (via the JWT-gated backend
   endpoint /fb/api/rocketchat/dashboard/reel-feedback). This is the
   dashboard-side equivalent of the native /reel slash command. */
function ReelSharePicker({ openRoom }) {
  const { reels, reelChatRefs, actions } = useWorkflow();
  const { person: me } = useAuth();

  const [open, setOpen] = useState(false);          // picker bar expanded?
  const [query, setQuery] = useState("");
  const [dropOpen, setDropOpen] = useState(false);  // autocomplete list open?
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState(null);   // chosen reel {id,title,stage}
  const [feedback, setFeedback] = useState("");
  const [channels, setChannels] = useState([]);
  const [channel, setChannel] = useState("pipeline");
  const [userOverride, setUserOverride] = useState(false); // user manually picked a channel?
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null);       // {ok, text}

  // Auto-follow the channel currently open in the chat iframe, unless the user
  // has manually picked one (override stays until the next successful send).
  useEffect(() => {
    if (!openRoom?.name || userOverride) return;
    setChannel(openRoom.name);
  }, [openRoom?.name, userOverride]);

  const boxRef = useRef(null);

  // Active, non-archived reels for the dropdown.
  const activeReels = useMemo(
    () => (reels || []).filter(r => !r.archivedAt),
    [reels]);

  // Show ALL non-archived pipeline reels (the list is scrollable). When a reel
  // is already selected, don't re-filter by the "ID — title" text we put in the
  // box, so the full list stays available if they reopen the dropdown.
  const matches = useMemo(() => {
    const q = selected ? "" : query.trim().toLowerCase();
    const list = !q
      ? activeReels
      : activeReels.filter(r =>
          String(r.id).toLowerCase().includes(q) ||
          String(r.title || "").toLowerCase().includes(q));
    return list.slice(0, 100);
  }, [query, activeReels, selected]);

  // Load channel list once the bar is opened (JWT-gated).
  useEffect(() => {
    if (!open || channels.length) return;
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
        const j = await res.json();
        if (cancelled) return;
        const names = (j.channels || []).map(c => c.name);
        setChannels(names);
        // Only fall back to names[0] when we have no better signal (no open
        // room observed and the user hasn't manually chosen).
        if (names.length && !names.includes("pipeline") && !openRoom?.name && !userOverride) {
          setChannel(names[0]);
        }
      } catch (_) { /* leave default channel */ }
    })();
    return () => { cancelled = true; };
  }, [open, channels.length]);

  // Click-outside closes the autocomplete dropdown.
  useEffect(() => {
    if (!dropOpen) return;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setDropOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [dropOpen]);

  const choose = (r) => {
    setSelected(r);
    setQuery(`${r.id} — ${r.title || ""}`);
    setDropOpen(false);
  };

  const onKeyDown = (e) => {
    if (!dropOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setDropOpen(true); return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      if (dropOpen && matches[highlight]) { e.preventDefault(); choose(matches[highlight]); }
    } else if (e.key === "Escape") { setDropOpen(false); }
  };

  const reelCount = (rid) =>
    (reelChatRefs || []).filter(r => (r.reelId ?? r.reel_id) === rid).length;

  // Channel dropdown options — always include the current value (open room or a
  // manual pick) even if the channels endpoint didn't enumerate it, so <select>
  // never references a missing <option>.
  const channelOptions = useMemo(() => {
    const base = channels.length ? channels : ["pipeline", "general"];
    const extras = [];
    if (openRoom?.name && !base.includes(openRoom.name)) extras.push(openRoom.name);
    if (channel && !base.includes(channel) && channel !== openRoom?.name) extras.push(channel);
    return [...extras, ...base];
  }, [channels, openRoom?.name, channel]);

  const send = async () => {
    if (!selected || sending) return;
    setSending(true);
    setStatus(null);
    const note = feedback.trim();
    const reelId = selected.id;
    // Single shared path — identical to the reel card's Discuss action.
    const r = await shareReelToChannel({ reelId, feedback: note, channel });
    if (!r.ok) {
      setStatus({ ok: false, text: r.error || "Send failed." });
    } else {
      setStatus({ ok: true, text: `Shared ${reelId} to #${channel}${note ? " + saved feedback" : ""}.` });
      // Optimistic tag so the reel card updates immediately.
      actions?.addReelChatRef?.({
        reelId, channel, note, messageUrl: r.message_url, createdBy: me?.id,
      });
      setFeedback("");
      setSelected(null);
      setQuery("");
      setUserOverride(false); // resume following the open chat room
    }
    setSending(false);
  };

  return (
    <div className="reelshare" style={{ flexShrink: 0, margin: "8px 16px 0" }}>
      <button
        className="reelshare-toggle"
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          background: "var(--bg-2)", border: "1px solid var(--line-hard)",
          borderRadius: 6, color: "var(--fg)", cursor: "pointer",
          fontFamily: "var(--f-mono)", fontSize: 12, padding: "8px 12px",
        }}
      >
        <span style={{ color: "var(--c-cyan)" }}>🎬</span>
        <span style={{ flex: 1, textAlign: "left" }}>Share a reel into chat</span>
        <span style={{ opacity: 0.6 }}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div style={{
          marginTop: 6, padding: 12, background: "var(--bg-1)",
          border: "1px solid var(--line-hard)", borderRadius: 8,
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          {/* Reel autocomplete */}
          <div ref={boxRef} style={{ position: "relative" }}>
            <input
              value={query}
              placeholder="Search a reel by id or title…"
              onChange={e => { setQuery(e.target.value); setSelected(null); setDropOpen(true); setHighlight(0); }}
              onFocus={() => setDropOpen(true)}
              onKeyDown={onKeyDown}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "var(--bg-2)", border: "1px solid var(--line-hard)",
                borderRadius: 4, color: "var(--fg)", fontFamily: "var(--f-mono)",
                fontSize: 12, padding: "7px 10px", outline: "none",
              }}
            />
            {dropOpen && matches.length > 0 && (
              <div className="reelshare-drop" style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 30,
                marginTop: 2, background: "var(--bg-1)",
                border: "1px solid var(--line-hard)", borderRadius: 6,
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)", maxHeight: 260, overflowY: "auto",
              }}>
                {matches.map((r, i) => (
                  <div
                    key={r.id}
                    onMouseEnter={() => setHighlight(i)}
                    onMouseDown={(e) => { e.preventDefault(); choose(r); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                      padding: "7px 10px", fontFamily: "var(--f-mono)", fontSize: 12,
                      background: i === highlight ? "var(--bg-3, #1a2335)" : "transparent",
                      borderBottom: "1px solid var(--line-soft, var(--line-hard))",
                    }}
                  >
                    <span style={{ color: "var(--c-cyan)", minWidth: 64 }}>{r.id}</span>
                    <span style={{ flex: 1, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.title || "(untitled)"}
                    </span>
                    {r.stage && <span style={{ color: "var(--fg-dim)", fontSize: 10 }}>{r.stage}</span>}
                    {reelCount(r.id) > 0 && <span style={{ color: "var(--c-cyan)", fontSize: 10 }}>💬 {reelCount(r.id)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Feedback section — the WHOLE area is boxed in red until a reel is
              attached, since feedback can't be saved/posted without one. */}
          <div style={{
            border: selected
              ? "1px solid var(--line-hard)"
              : "1px solid var(--c-red, #ff7373)",
            background: selected ? "transparent" : "rgba(255,115,115,0.07)",
            borderRadius: 6, padding: 8,
            display: "flex", flexDirection: "column", gap: 6,
            transition: "background 0.15s, border-color 0.15s",
          }}>
            {!selected && (
              <span style={{
                fontFamily: "var(--f-mono)", fontSize: 10.5,
                color: "var(--c-red, #ff7373)", letterSpacing: 0.3,
              }}>
                Pick a reel above first — then add your feedback.
              </span>
            )}
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder={selected
                ? "Feedback to attach to this reel (optional)…"
                : "Your feedback…"}
              rows={2}
              style={{
                width: "100%", boxSizing: "border-box", resize: "vertical",
                background: "var(--bg-2)", border: "1px dashed var(--line-hard)",
                borderRadius: 4, color: "var(--fg)", fontFamily: "var(--f-sans, var(--f-mono))",
                fontSize: 12, padding: "7px 10px", outline: "none",
              }}
            />
          </div>

          {/* Channel + send */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-dim)" }}>to</span>
            <select
              value={channel}
              onChange={e => { setChannel(e.target.value); setUserOverride(true); }}
              style={{
                background: "var(--bg-2)", border: "1px solid var(--line-hard)",
                borderRadius: 4, color: "var(--fg)", fontFamily: "var(--f-mono)",
                fontSize: 12, padding: "5px 8px",
              }}
            >
              {channelOptions.map(c => (
                <option key={c} value={c}>#{c}</option>
              ))}
            </select>
            <button
              className="btn-primary"
              onClick={send}
              disabled={!selected || sending}
              style={{ fontSize: 12, padding: "6px 14px", opacity: (!selected || sending) ? 0.5 : 1 }}
            >
              {sending ? "Sending…" : "Share reel ↗"}
            </button>
            {status && (
              <span style={{
                fontSize: 11, fontFamily: "var(--f-mono)",
                color: status.ok ? "var(--c-green, #34d399)" : "var(--c-red, #f87171)",
              }}>{status.text}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* Compare panel: pick a pipeline reel → auto-loads its inspiration link on the
   left; upload a screen recording of the current edit on the right; opens
   ReelCompareModal side-by-side. Sits just below the share-a-reel picker. */
function ReelComparePanel() {
  const { reels } = useWorkflow();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dropOpen, setDropOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState(null);   // chosen pipeline reel
  const [fileName, setFileName] = useState("");
  const [blobUrl, setBlobUrl] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [shareChannel, setShareChannel] = useState("pipeline");
  const [shareNote, setShareNote] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState(null);
  const boxRef = useRef(null);
  const blobRef = useRef(null);

  // Revoke blob URL when panel closes or on unmount.
  useEffect(() => {
    if (!open && blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
      setBlobUrl("");
      setFileName("");
    }
  }, [open]);
  useEffect(() => () => { if (blobRef.current) URL.revokeObjectURL(blobRef.current); }, []);

  const activeReels = useMemo(
    () => (reels || []).filter(r => !r.archivedAt),
    [reels]);

  const matches = useMemo(() => {
    const q = selected ? "" : query.trim().toLowerCase();
    const list = !q
      ? activeReels
      : activeReels.filter(r =>
          String(r.id).toLowerCase().includes(q) ||
          String(r.title || "").toLowerCase().includes(q));
    return list.slice(0, 100);
  }, [query, activeReels, selected]);

  // Click-outside closes dropdown.
  useEffect(() => {
    if (!dropOpen) return;
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setDropOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [dropOpen]);

  const choose = (r) => {
    setSelected(r);
    setQuery(`${r.id} — ${r.title || ""}`);
    setDropOpen(false);
  };

  const onKeyDown = (e) => {
    if (!dropOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) { setDropOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { if (dropOpen && matches[highlight]) { e.preventDefault(); choose(matches[highlight]); } }
    else if (e.key === "Escape") setDropOpen(false);
  };

  const onFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    const blob = URL.createObjectURL(file);
    blobRef.current = blob;
    setBlobUrl(blob);
    setFileName(file.name);
  };

  const inspoUrl = selected?.inspo || "";
  const canCompare = !!(inspoUrl || blobUrl);

  const panelStyle = {
    marginTop: 6, padding: 12, background: "var(--bg-1)",
    border: "1px solid var(--line-hard)", borderRadius: 8,
    display: "flex", flexDirection: "column", gap: 8,
  };
  const inputStyle = {
    width: "100%", boxSizing: "border-box",
    background: "var(--bg-2)", border: "1px solid var(--line-hard)",
    borderRadius: 4, color: "var(--fg)", fontFamily: "var(--f-mono)",
    fontSize: 12, padding: "7px 10px", outline: "none",
  };

  return (
    <div style={{ flexShrink: 0, margin: "6px 16px 0" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          background: "var(--bg-2)", border: "1px solid var(--line-hard)",
          borderRadius: 6, color: "var(--fg)", cursor: "pointer",
          fontFamily: "var(--f-mono)", fontSize: 12, padding: "8px 12px",
        }}
      >
        <span style={{ color: "var(--c-amber)" }}>⇔</span>
        <span style={{ flex: 1, textAlign: "left" }}>Compare inspiration vs. your cut</span>
        <span style={{ opacity: 0.6 }}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div style={panelStyle}>
          {/* Step 1: pick a pipeline reel */}
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            1 · Pick the reel you're editing
          </div>
          <div ref={boxRef} style={{ position: "relative" }}>
            <input
              value={query}
              placeholder="Search reel by id or title…"
              style={inputStyle}
              onChange={e => { setQuery(e.target.value); setSelected(null); setDropOpen(true); setHighlight(0); }}
              onFocus={() => setDropOpen(true)}
              onKeyDown={onKeyDown}
            />
            {dropOpen && matches.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 30,
                marginTop: 2, background: "var(--bg-1)", border: "1px solid var(--line-hard)",
                borderRadius: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                maxHeight: 220, overflowY: "auto",
              }}>
                {matches.map((r, i) => (
                  <div
                    key={r.id}
                    onMouseEnter={() => setHighlight(i)}
                    onMouseDown={e => { e.preventDefault(); choose(r); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                      padding: "7px 10px", fontFamily: "var(--f-mono)", fontSize: 12,
                      background: i === highlight ? "var(--bg-3, #1a2335)" : "transparent",
                      borderBottom: "1px solid var(--line-soft, var(--line-hard))",
                    }}
                  >
                    <span style={{ color: "var(--c-cyan)", minWidth: 64 }}>{r.id}</span>
                    <span style={{ flex: 1, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.title || "(untitled)"}
                    </span>
                    {r.inspo && <span style={{ fontSize: 10, color: "var(--c-amber)" }}>✦ inspo</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Inspo link status */}
          {selected && (
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>
              {inspoUrl
                ? <span style={{ color: "var(--c-amber)" }}>✦ Inspiration: <a href={inspoUrl} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{inspoUrl.replace(/^https?:\/\//, "").slice(0, 48)}{inspoUrl.length > 55 ? "…" : ""}</a></span>
                : <span style={{ color: "var(--fg-dim)" }}>No inspiration link on this reel — you can still upload both files below.</span>
              }
            </div>
          )}

          {/* Step 2: upload screen recording */}
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 4 }}>
            2 · Upload your screen recording / current cut
          </div>
          <label style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 12px", cursor: "pointer",
            background: blobUrl ? "color-mix(in srgb, var(--c-amber) 8%, transparent)" : "var(--bg-2)",
            border: `1px solid ${blobUrl ? "var(--c-amber)" : "var(--line-hard)"}`,
            borderRadius: 6, fontFamily: "var(--f-mono)", fontSize: 12,
            color: blobUrl ? "var(--c-amber)" : "var(--fg-dim)",
            transition: "background 0.15s, border-color 0.15s",
          }}>
            <span>{blobUrl ? "✓" : "📁"}</span>
            <span style={{ flex: 1 }}>{fileName || "Attach screen recording or video file…"}</span>
            {blobUrl && <span style={{ fontSize: 10, opacity: 0.7 }}>tap to swap</span>}
            <input type="file" accept="video/*" style={{ display: "none" }} onChange={onFileChange} />
          </label>

          {/* Compare button */}
          <button
            onClick={() => setShowModal(true)}
            disabled={!canCompare}
            style={{
              padding: "8px 0", cursor: canCompare ? "pointer" : "not-allowed",
              background: canCompare ? "var(--c-amber)" : "var(--bg-3)",
              border: "none", borderRadius: 6,
              fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 600,
              color: canCompare ? "#000" : "var(--fg-dim)",
              opacity: canCompare ? 1 : 0.6, transition: "opacity 0.15s",
            }}
          >
            ⇔ Open side-by-side compare
          </button>
          {!canCompare && (
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", textAlign: "center" }}>
              Pick a reel with an inspiration link, or upload a file to enable compare.
            </div>
          )}

          {/* Step 3: post comparison link to a channel */}
          {selected && canCompare && (
            <>
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 4 }}>
                3 · Post to channel so teammates can open it
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-dim)" }}>#</span>
                <input
                  value={shareChannel}
                  onChange={e => setShareChannel(e.target.value.replace(/^#/, ""))}
                  placeholder="pipeline"
                  style={{
                    width: 110, background: "var(--bg-2)", border: "1px solid var(--line-hard)",
                    borderRadius: 4, color: "var(--fg)", fontFamily: "var(--f-mono)",
                    fontSize: 11, padding: "5px 8px", outline: "none",
                  }}
                />
                <input
                  value={shareNote}
                  onChange={e => setShareNote(e.target.value)}
                  placeholder="Optional note…"
                  style={{
                    flex: 1, minWidth: 80, background: "var(--bg-2)", border: "1px solid var(--line-hard)",
                    borderRadius: 4, color: "var(--fg)", fontFamily: "var(--f-mono)",
                    fontSize: 11, padding: "5px 8px", outline: "none",
                  }}
                />
                <button
                  onClick={async () => {
                    if (!selected || sharing) return;
                    setSharing(true); setShareStatus(null);
                    const deepLink = `https://footagebrain.com/?reel=${encodeURIComponent(selected.id)}&compare=1`;
                    const isBlob = blobUrl.startsWith("blob:");
                    const lines = [
                      `⇔ Compare: ${selected.id}${selected.title ? ` — ${selected.title}` : ""}`,
                      inspoUrl ? `✦ Inspiration: ${inspoUrl}` : null,
                      blobUrl && !isBlob ? `📹 Current cut: ${blobUrl}` : null,
                      isBlob && fileName ? `📹 Current cut: ${fileName} (local file — share via Frame.io to link it)` : null,
                      `🔗 Open compare in app: ${deepLink}`,
                      shareNote.trim() ? `\n${shareNote.trim()}` : null,
                    ].filter(Boolean).join("\n");
                    const r = await shareReelToChannel({ reelId: selected.id, feedback: lines, channel: shareChannel });
                    setSharing(false);
                    if (r.ok) {
                      setShareStatus({ ok: true, text: `Posted to #${shareChannel} ✓` });
                      setShareNote("");
                      setTimeout(() => setShareStatus(null), 4000);
                    } else {
                      setShareStatus({ ok: false, text: r.error || "Send failed." });
                    }
                  }}
                  disabled={sharing}
                  style={{
                    padding: "5px 14px", cursor: sharing ? "default" : "pointer",
                    background: "var(--c-green)", border: "none", borderRadius: 4,
                    fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 600,
                    color: "#000", opacity: sharing ? 0.6 : 1,
                  }}
                >
                  {sharing ? "Posting…" : "Post to channel ↗"}
                </button>
              </div>
              {shareStatus && (
                <div style={{
                  fontFamily: "var(--f-mono)", fontSize: 11,
                  color: shareStatus.ok ? "var(--c-green)" : "var(--c-red)",
                }}>{shareStatus.text}</div>
              )}
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", lineHeight: 1.5 }}>
                Teammates who click the link in chat will land directly on the comparison view in the app.
              </div>
            </>
          )}
        </div>
      )}

      {showModal && (
        <ReelCompareModal
          leftLabel={selected ? `${selected.id} — Inspiration` : "Inspiration"}
          leftUrl={inspoUrl}
          rightLabel={fileName || "Your current cut"}
          rightUrl={blobUrl}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

export function TeamChat({ active }) {
  const [loaded, setLoaded] = useState(false);
  const { person: me } = useAuth();
  const currentUserId = me?.id || null;

  // Notify preference. Real-time new-message detection comes from Rocket.Chat
  // itself (the chat is an iframe embed — the app can't read messages), so this
  // toggle only records the opt-in and drives the browser Notification prompt.
  // NOTE: true in-app new-message badges would require the full Rocket.Chat API
  // (deferred — see memory rocketchat-integration.md).
  const [notify, setNotify] = useState(false);
  const [showHint, setShowHint] = useState(false);

  // Track which Rocket.Chat room is currently open inside the iframe so the
  // reel-share picker can default to it. The chat is a cross-origin iframe, so
  // the only way to know is RC's iframe-integration "send" API, which posts a
  // `room-opened` message to the parent when `Iframe_Integration_send_enable`
  // is ON in RC admin. If that setting is off, no messages arrive and the
  // picker quietly keeps its default — no breakage.
  const [openRoom, setOpenRoom] = useState(null); // { name, t } | null
  useEffect(() => {
    const handler = (event) => {
      if (event.origin !== RC_ORIGIN) return;          // origin gate first
      let payload = event.data;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch { return; }
      }
      if (!payload || payload.event !== "room-opened") return;
      const { name, t } = payload.data || {};
      if (!name) return;
      // Only real channels/groups — ignore DMs ('d') and omnichannel ('l').
      if (t === "c" || t === "p") setOpenRoom({ name, t });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Reflect the persisted pref on load.
  useEffect(() => {
    let cancelled = false;
    if (!currentUserId) return;
    getChatNotifyPref().then(prefs => {
      if (!cancelled) setNotify(!!prefs?.[currentUserId]);
    });
    return () => { cancelled = true; };
  }, [currentUserId]);

  const onToggleNotify = async () => {
    const next = !notify;
    setNotify(next);
    if (currentUserId) await setChatNotifyPref(currentUserId, next);
    if (next) {
      // Browser notifications are the delivery channel Rocket.Chat uses.
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch (_) {}
      }
      setShowHint(true);
    } else {
      setShowHint(false);
    }
  };

  return (
    <div style={{
      display: active ? "flex" : "none",
      flexDirection: "column",
      position: "absolute", top: 64, left: 0, right: 0, bottom: 0,
      background: "var(--bg-0)",
      zIndex: 10,
      minHeight: 0,
    }}>
      <div className="page-head" style={{ flexShrink: 0 }}>
        <div className="titles">
          <h1>Team chat</h1>
          <div className="sub">Internal channels + WhatsApp inbox — powered by Rocket.Chat</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <label style={{
            display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
            fontSize: 11, color: "var(--fg-mute)", fontFamily: "var(--f-mono)",
          }}>
            <input type="checkbox" checked={notify} onChange={onToggleNotify} />
            Notify me about new team chat messages
          </label>
          <a
            href="https://chat.footagebrain.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 11, color: "var(--c-cyan)", fontFamily: "var(--f-mono)" }}
          >
            Open in new tab ↗
          </a>
        </div>
      </div>

      {/* Share-a-reel picker (dashboard-side /reel autocomplete) */}
      <ReelSharePicker openRoom={openRoom} />

      {/* Side-by-side compare: pick inspiration reel + upload screen recording */}
      <ReelComparePanel />

      {showHint && (
        <div style={{
          flexShrink: 0, margin: "8px 16px 0", padding: "8px 12px",
          border: "1px dashed var(--line)", borderRadius: 6,
          fontSize: 11, color: "var(--fg-mute)", fontFamily: "var(--f-mono)",
          display: "flex", justifyContent: "space-between", gap: 12,
        }}>
          <span>
            New-message alerts are delivered by Rocket.Chat. Also enable desktop
            notifications inside Rocket.Chat (Account → Notification Preferences)
            so you get pinged when the tab isn't focused.
          </span>
          <span style={{ cursor: "pointer", color: "var(--c-cyan)" }}
                onClick={() => setShowHint(false)}>dismiss</span>
        </div>
      )}
      {!loaded && (
        <div className="mon-loading" style={{ padding: 32 }}>Connecting to Rocket.Chat…</div>
      )}
      <iframe
        src="https://chat.footagebrain.com"
        title="Team chat"
        onLoad={() => setLoaded(true)}
        style={{
          flex: 1, border: "none", borderRadius: 8,
          display: loaded ? "block" : "none",
          minHeight: 0,
        }}
        allow="camera; microphone; fullscreen"
      />
    </div>
  );
}
