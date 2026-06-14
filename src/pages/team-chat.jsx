import React, { useState } from "react";

export function TeamChat({ active }) {
  const [loaded, setLoaded] = useState(false);
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
        <a
          href="https://chat.footagebrain.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 11, color: "var(--c-cyan)", fontFamily: "var(--f-mono)" }}
        >
          Open in new tab ↗
        </a>
      </div>
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
