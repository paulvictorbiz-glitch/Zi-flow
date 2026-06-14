/* =========================================================
   Global "+" floating action — bottom-right.
   Menu options:
     · Chat with AI bot  → inline chat widget
     · Create Task       → TaskModal
     · Create New Reel   → ReelModal
   ========================================================= */

import React, { useState, useRef, useEffect } from "react";
import { TaskModal } from "./modals/TaskModal.jsx";
import { ReelModal } from "./modals/ReelModal.jsx";
import { usePermissions } from "../lib/permissions.jsx";
import { useAuth } from "../auth.jsx";

// ── Floating bot chat widget ──────────────────────────────
function BotChat({ onClose }) {
  const { session } = useAuth();
  const [messages, setMessages] = useState([
    { role: "bot", text: "Hi! Ask me anything about your workflow — I'll check the FAQ." }
  ]);
  const [input, setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const ask = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", text: q }]);
    setLoading(true);
    try {
      const r = await fetch("/api/ai/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({ question: q, source: "direct", author: session?.user?.email || "user" }),
      });
      const d = await r.json();
      const text = r.ok ? d.answer : (d.error || "Something went wrong.");
      const meta = r.ok ? ` (${Math.round((d.confidence || 0) * 100)}% match)` : "";
      setMessages(prev => [...prev, { role: "bot", text, meta }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "bot", text: "Network error: " + e.message }]);
    }
    setLoading(false);
  };

  return (
    <div className="fab-bot-chat">
      <div className="fab-bot-header">
        <span>AI Assistant</span>
        <button className="fab-bot-close" onClick={onClose}>×</button>
      </div>
      <div className="fab-bot-messages">
        {messages.map((m, i) => (
          <div key={i} className={"fab-bot-msg " + m.role}>
            <div className="fab-bot-bubble">{m.text}</div>
            {m.meta && <div className="fab-bot-meta">{m.meta}</div>}
          </div>
        ))}
        {loading && (
          <div className="fab-bot-msg bot">
            <div className="fab-bot-bubble fab-bot-typing">…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="fab-bot-input-row">
        <input
          className="fab-bot-input"
          placeholder="Ask a question…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && ask()}
          autoFocus
        />
        <button className="fab-bot-send" onClick={ask} disabled={loading || !input.trim()}>↑</button>
      </div>
    </div>
  );
}

// ── Main FAB ──────────────────────────────────────────────
export function CreateFab() {
  const { can } = usePermissions();
  const canCreateReel = can("createReel");
  const [open, setOpen]   = useState(false);
  const [flow, setFlow]   = useState(null); // null | "task" | "reel" | "bot"

  const close = () => { setOpen(false); setFlow(null); };

  return (
    <React.Fragment>
      <div className="fab-wrap">
        {/* Bot chat widget — shown above FAB when active */}
        {flow === "bot" && <BotChat onClose={close} />}

        {/* Menu */}
        {open && !flow && (
          <div className="fab-menu">
            <div className="fab-opt fab-opt-bot" onClick={() => { setFlow("bot"); setOpen(false); }}>
              <span className="k">✦</span>
              <div>
                <div className="t">Chat with AI bot</div>
                <div className="s">Ask workflow questions — the bot answers from the team FAQ.</div>
              </div>
            </div>
            <div className="fab-opt" onClick={() => { setFlow("task"); setOpen(false); }}>
              <span className="k">⏵</span>
              <div>
                <div className="t">Create task</div>
                <div className="s">Request someone do something — pick hook, upload source, package variants…</div>
              </div>
            </div>
            {canCreateReel && (
              <div className="fab-opt" onClick={() => { setFlow("reel"); setOpen(false); }}>
                <span className="k">◐</span>
                <div>
                  <div className="t">Create new reel</div>
                  <div className="s">Seed a reel with title, logline, footage links and shot plan.</div>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          className={"fab " + (open || flow === "bot" ? "is-open" : "")}
          onClick={() => { if (flow === "bot") { close(); } else { setOpen(o => !o); } }}
        >
          <span className="plus">{(open || flow === "bot") ? "×" : "+"}</span>
        </button>
      </div>

      {flow === "task" && <TaskModal onClose={() => setFlow(null)} />}
      {flow === "reel" && <ReelModal onClose={() => setFlow(null)} />}
    </React.Fragment>
  );
}
