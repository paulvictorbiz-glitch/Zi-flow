import React, { useEffect, useRef, useState } from "react";
import { ReelPlayer } from "./reel-player.jsx";
import "./ReelCompareModal.css";

const APP_BASE = "https://footagebrain.com";

export function ReelCompareModal({ leftLabel, leftUrl, rightLabel, rightUrl, onClose,
                                   reelId, reelTitle, shareToChannel }) {
  const [localRightUrl, setLocalRightUrl] = useState(rightUrl || "");
  const [inputVal, setInputVal] = useState(rightUrl || "");
  const [fileName, setFileName] = useState("");
  const blobRef = useRef(null);
  const hasRight = !!localRightUrl;

  // Share-to-channel state (only active when shareToChannel prop is provided).
  const [shareOpen, setShareOpen] = useState(false);
  const [shareChannel, setShareChannel] = useState("pipeline");
  const [shareNote, setShareNote] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState(null); // { ok, text }

  const canShare = !!shareToChannel && !!reelId;
  const deepLink = reelId ? `${APP_BASE}/?reel=${encodeURIComponent(reelId)}&compare=1` : "";
  const isBlob = localRightUrl.startsWith("blob:");

  const doShare = async () => {
    if (!canShare || sharing) return;
    setSharing(true);
    setShareStatus(null);
    const lines = [
      `⇔ Compare: ${reelTitle || reelId}`,
      leftUrl   ? `✦ Inspiration: ${leftUrl}` : null,
      localRightUrl && !isBlob ? `📹 Current cut: ${localRightUrl}` : null,
      isBlob    ? `📹 Current cut: (local file — upload to Frame.io to make it shareable)` : null,
      deepLink  ? `🔗 Open compare in app: ${deepLink}` : null,
      shareNote.trim() ? `\n${shareNote.trim()}` : null,
    ].filter(Boolean).join("\n");
    const r = await shareToChannel(shareChannel, lines);
    setSharing(false);
    if (r.ok) {
      setShareStatus({ ok: true, text: `Posted to #${shareChannel} ✓` });
      setShareNote("");
      setTimeout(() => setShareStatus(null), 4000);
    } else {
      setShareStatus({ ok: false, text: r.error || "Send failed." });
    }
  };

  // Sync if parent-provided rightUrl changes (e.g. linked reel loads later).
  useEffect(() => {
    if (rightUrl) {
      setLocalRightUrl(rightUrl);
      setInputVal(rightUrl);
    }
  }, [rightUrl]);

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Revoke blob URL on unmount to avoid memory leak.
  useEffect(() => {
    return () => { if (blobRef.current) URL.revokeObjectURL(blobRef.current); };
  }, []);

  const commitUrl = () => {
    const trimmed = inputVal.trim();
    if (trimmed) setLocalRightUrl(trimmed);
  };

  const onFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    const blob = URL.createObjectURL(file);
    blobRef.current = blob;
    setFileName(file.name);
    setLocalRightUrl(blob);
  };

  return (
    <div className="rcm-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ display: "contents" }} onClick={(e) => e.stopPropagation()}>
        <div className="rcm-header">
          <span className="rcm-title">Side-by-side compare{reelTitle ? ` · ${reelTitle}` : ""}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {canShare && (
              <button
                className={"rcm-share-btn" + (shareOpen ? " is-open" : "")}
                onClick={() => { setShareOpen(o => !o); setShareStatus(null); }}
                title="Post this comparison to a team chat channel"
              >
                📤 Share to channel
              </button>
            )}
            <button className="rcm-close" onClick={onClose} title="Close (Esc)">✕ Close</button>
          </div>
        </div>

        {/* Inline share panel */}
        {shareOpen && canShare && (
          <div className="rcm-share-panel">
            <div className="rcm-share-row">
              <span className="rcm-share-label">Channel</span>
              <input
                className="rcm-share-input rcm-share-channel"
                value={shareChannel}
                onChange={e => setShareChannel(e.target.value.replace(/^#/, ""))}
                placeholder="pipeline"
              />
              <input
                className="rcm-share-input"
                style={{ flex: 1 }}
                value={shareNote}
                onChange={e => setShareNote(e.target.value)}
                placeholder="Optional note for the team…"
              />
              <button
                className="rcm-share-send"
                onClick={doShare}
                disabled={sharing}
              >
                {sharing ? "Posting…" : "Post ↗"}
              </button>
              {shareStatus && (
                <span className={"rcm-share-status" + (shareStatus.ok ? " ok" : " err")}>
                  {shareStatus.text}
                </span>
              )}
            </div>
            {deepLink && (
              <div className="rcm-share-hint">
                Teammates who click the posted link will land directly on the compare view.
                {isBlob && " (Your local file won't be shared — only the inspiration link will appear.)"}
              </div>
            )}
          </div>
        )}

        <div className="rcm-body">
          {/* Left: inspiration */}
          <div className="rcm-panel">
            <div className="rcm-panel-label">{leftLabel || "Inspiration"}</div>
            <ReelPlayer sampleReel={{ sourceUrl: leftUrl }} preferEmbed={true} />
          </div>

          {/* Right: current edit, URL input, or file upload */}
          <div className="rcm-panel">
            <div className="rcm-panel-label">
              {fileName ? `${rightLabel || "Current edit"} — ${fileName}` : (rightLabel || "Current edit")}
            </div>
            {hasRight ? (
              <>
                <ReelPlayer sampleReel={{ sourceUrl: localRightUrl }} preferEmbed={true} />
                <label className="rcm-swap-file" title="Load a different local file">
                  ↺ Swap file
                  <input type="file" accept="video/*" onChange={onFileChange} />
                </label>
              </>
            ) : (
              <div className="rcm-blank">
                <label className="rcm-file-btn">
                  📁 Attach local file
                  <input type="file" accept="video/*" onChange={onFileChange} />
                </label>
                <div className="rcm-divider">or paste a URL</div>
                <input
                  className="rcm-url-input"
                  type="url"
                  placeholder="https://…"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitUrl(); }}
                  onBlur={commitUrl}
                />
                <div className="rcm-url-hint">
                  Frame.io, Drive, Instagram, YouTube…
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
