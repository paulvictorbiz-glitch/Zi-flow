/* AI Brain — owner-only dashboard for message monitoring, FAQ bot, and improvement suggestions. */

import React, { useState, useEffect, useCallback } from "react";
import "./ai-brain.css";
import { DPill } from "../components/components.jsx";
import { useAuth } from "../auth.jsx";

import { supabase as _sb } from "../lib/supabase-client.js";

// ── Shared helpers ────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
         " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

const TOPIC_COLORS = {
  SOP:         "#8b5cf6",
  Process:     "#3b82f6",
  Bug:         "#ef4444",
  Question:    "#f59e0b",
  Todo:        "#06b6d4",
  Improvement: "#10b981",
  Other:       "#6b7280",
};

function TopicBadge({ topic }) {
  const color = TOPIC_COLORS[topic] || "#6b7280";
  return (
    <span style={{
      background: color + "22",
      color,
      border: `1px solid ${color}55`,
      borderRadius: 4,
      padding: "1px 7px",
      fontSize: 11,
      fontWeight: 600,
      whiteSpace: "nowrap",
    }}>{topic || "Other"}</span>
  );
}

function SeverityDot({ severity }) {
  const colors = { high: "#ef4444", medium: "#f59e0b", low: "#6b7280" };
  return (
    <span title={severity} style={{
      display: "inline-block",
      width: 8, height: 8,
      borderRadius: "50%",
      background: colors[severity] || colors.low,
      flexShrink: 0,
    }} />
  );
}

// ── Notes tab ─────────────────────────────────────────────────────────────────
function NotesTab({ session }) {
  const [notes, setNotes]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [annotation, setAnnotation] = useState("");
  const [saving, setSaving]       = useState(false);
  const [filter, setFilter]       = useState("all"); // all | unresolved

  const load = useCallback(async () => {
    setLoading(true);
    let q = _sb.from("ai_notes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (filter === "unresolved") q = q.eq("resolved", false);
    const { data } = await q;
    setNotes(data || []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const toggleResolved = async (note) => {
    const newVal = !note.resolved;
    setNotes(prev => prev.map(n => n.id === note.id ? { ...n, resolved: newVal } : n));
    await _sb.from("ai_notes").update({
      resolved: newVal,
      resolved_at: newVal ? new Date().toISOString() : null,
    }).eq("id", note.id);
  };

  const saveAnnotation = async () => {
    if (!selected) return;
    setSaving(true);
    await _sb.from("ai_notes").update({ note: annotation }).eq("id", selected.id);
    setNotes(prev => prev.map(n => n.id === selected.id ? { ...n, note: annotation } : n));
    setSaving(false);
  };

  const unresolvedCount = notes.filter(n => !n.resolved).length;

  const clearAllUnresolved = async () => {
    if (!unresolvedCount) return;
    if (!confirm(`Mark all ${unresolvedCount} unresolved note${unresolvedCount === 1 ? "" : "s"} as resolved? This clears the unresolved queue.`)) return;
    const now = new Date().toISOString();
    setNotes(prev => prev.map(n => n.resolved ? n : { ...n, resolved: true, resolved_at: now }));
    setSelected(null);
    await _sb.from("ai_notes")
      .update({ resolved: true, resolved_at: now })
      .eq("resolved", false);
    load();
  };

  return (
    <div className="aib-panel">
      <div className="aib-toolbar">
        <span className="aib-count">{notes.length} notes</span>
        <div className="aib-filter-group">
          {["all", "unresolved"].map(f => (
            <button key={f} className={"aib-filter-btn" + (filter === f ? " active" : "")}
                    onClick={() => setFilter(f)}>
              {f === "all" ? "All" : "Unresolved"}
            </button>
          ))}
        </div>
        <button className="aib-clear-btn" onClick={clearAllUnresolved} disabled={!unresolvedCount}
                title="Mark every unresolved note as resolved">
          Clear unresolved{unresolvedCount ? ` (${unresolvedCount})` : ""}
        </button>
        <button className="aib-refresh-btn" onClick={load}>↻</button>
      </div>

      <div className="aib-split">
        <div className="aib-list">
          {loading && <div className="aib-empty">Loading…</div>}
          {!loading && !notes.length && <div className="aib-empty">No notes yet. Messages from Rocket.Chat will appear here once the webhook is configured.</div>}
          {notes.map(n => (
            <div key={n.id}
                 className={"aib-note-row" + (selected?.id === n.id ? " selected" : "") + (n.resolved ? " resolved" : "")}
                 onClick={() => { setSelected(n); setAnnotation(n.note || ""); }}>
              <div className="aib-note-top">
                <SeverityDot severity={n.severity} />
                <TopicBadge topic={n.topic} />
                <span className="aib-note-source">{n.source}</span>
                {n.channel && <span className="aib-note-channel">#{n.channel}</span>}
                <span className="aib-note-author">{n.author}</span>
                <span className="aib-note-date">{fmtDate(n.created_at)}</span>
                <button className={"aib-resolve-btn" + (n.resolved ? " done" : "")}
                        title={n.resolved ? "Mark unresolved" : "Mark resolved"}
                        onClick={e => { e.stopPropagation(); toggleResolved(n); }}>
                  {n.resolved ? "✓" : "○"}
                </button>
              </div>
              <div className="aib-note-body">{(n.body || "").slice(0, 180)}</div>
              {n.tags?.length > 0 && (
                <div className="aib-note-tags">
                  {n.tags.map(t => <span key={t} className="aib-tag">{t}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>

        {selected && (
          <div className="aib-detail">
            <div className="aib-detail-head">
              <TopicBadge topic={selected.topic} />
              <SeverityDot severity={selected.severity} />
              <span className="aib-detail-meta">{selected.source} · {selected.author} · {fmtDate(selected.created_at)}</span>
            </div>
            <div className="aib-detail-body">{selected.body}</div>
            {selected.tags?.length > 0 && (
              <div className="aib-note-tags">{selected.tags.map(t => <span key={t} className="aib-tag">{t}</span>)}</div>
            )}
            <div className="aib-annotation-label">Paul's note</div>
            <textarea className="aib-annotation"
                      value={annotation}
                      onChange={e => setAnnotation(e.target.value)}
                      placeholder="Add a note, action item, or context…"
                      rows={4} />
            <button className="aib-save-btn" onClick={saveAnnotation} disabled={saving}>
              {saving ? "Saving…" : "Save note"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── FAQ tab ───────────────────────────────────────────────────────────────────
function FaqTab({ session }) {
  const [pairs, setPairs]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [adding, setAdding]       = useState(false);
  const [newQ, setNewQ]           = useState("");
  const [newA, setNewA]           = useState("");
  const [saving, setSaving]       = useState(false);
  const [embedMsg, setEmbedMsg]   = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await _sb.from("faq_pairs")
      .select("id, question, answer, use_count, approved, approved_at, created_at, last_used_at")
      .order("created_at", { ascending: false })
      .limit(200);
    setPairs(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleApproval = async (pair) => {
    const newVal = !pair.approved;
    setPairs(prev => prev.map(p => p.id === pair.id ? { ...p, approved: newVal } : p));

    if (newVal && session?.access_token) {
      setEmbedMsg(`Embedding "${pair.question.slice(0, 40)}…"`);
      try {
        const r = await fetch("/api/ai/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ action: "embed", text: pair.question, pairId: pair.id }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.saved) {
          setEmbedMsg(`Failed: ${d.error || r.status}`);
          // Revert optimistic state
          setPairs(prev => prev.map(p => p.id === pair.id ? { ...p, approved: false } : p));
        }
      } catch (e) {
        setEmbedMsg(`Error: ${e.message}`);
        setPairs(prev => prev.map(p => p.id === pair.id ? { ...p, approved: false } : p));
      }
      setTimeout(() => setEmbedMsg(""), 3000);
    } else {
      await _sb.from("faq_pairs").update({ approved: newVal }).eq("id", pair.id);
    }
  };

  const deletePair = async (id) => {
    if (!confirm("Delete this FAQ pair?")) return;
    setPairs(prev => prev.filter(p => p.id !== id));
    await _sb.from("faq_pairs").delete().eq("id", id);
  };

  const addPair = async () => {
    if (!newQ.trim() || !newA.trim()) return;
    setSaving(true);
    const { data, error } = await _sb.from("faq_pairs").insert({
      question: newQ.trim(),
      answer: newA.trim(),
      approved: false,
    }).select().single();
    if (!error && data) {
      setPairs(prev => [data, ...prev]);
      setNewQ(""); setNewA(""); setAdding(false);
    }
    setSaving(false);
  };

  const approveAll = async () => {
    const unapproved = pairs.filter(p => !p.approved);
    if (!unapproved.length) { setEmbedMsg("All pairs already active"); setTimeout(() => setEmbedMsg(""), 2000); return; }
    let successCount = 0;
    for (let i = 0; i < unapproved.length; i++) {
      const p = unapproved[i];
      setEmbedMsg(`Embedding ${i + 1}/${unapproved.length}: "${p.question.slice(0, 35)}…"`);
      try {
        const r = await fetch("/api/ai/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ action: "embed", text: p.question, pairId: p.id }),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.saved) {
          setPairs(prev => prev.map(x => x.id === p.id ? { ...x, approved: true } : x));
          successCount++;
        } else {
          setEmbedMsg(`Error on pair ${i + 1}: ${d.error || r.status}`);
          await new Promise(res => setTimeout(res, 3000));
        }
      } catch (e) {
        setEmbedMsg(`Network error: ${e.message}`);
        await new Promise(res => setTimeout(res, 3000));
      }
      // Pause between calls to avoid OpenAI rate limits
      await new Promise(res => setTimeout(res, 500));
    }
    setEmbedMsg(`Done — ${successCount}/${unapproved.length} pairs activated`);
    setTimeout(() => setEmbedMsg(""), 4000);
  };

  return (
    <div className="aib-panel">
      <div className="aib-toolbar">
        <span className="aib-count">{pairs.length} Q&A pairs · {pairs.filter(p => p.approved).length} active</span>
        {embedMsg && <span className="aib-embed-msg">{embedMsg}</span>}
        <button className="aib-approve-all-btn" onClick={approveAll}>⚡ Approve all</button>
        <button className="aib-add-btn" onClick={() => setAdding(o => !o)}>+ Add FAQ</button>
        <button className="aib-refresh-btn" onClick={load}>↻</button>
      </div>

      {adding && (
        <div className="aib-add-form">
          <input className="aib-input" placeholder="Question (what team members ask)" value={newQ} onChange={e => setNewQ(e.target.value)} />
          <textarea className="aib-textarea" placeholder="Answer (Paul's canonical response)" value={newA} onChange={e => setNewA(e.target.value)} rows={3} />
          <div className="aib-add-actions">
            <button className="aib-save-btn" onClick={addPair} disabled={saving || !newQ.trim() || !newA.trim()}>
              {saving ? "Saving…" : "Save (unapproved)"}
            </button>
            <button className="aib-cancel-btn" onClick={() => setAdding(false)}>Cancel</button>
          </div>
          <p className="aib-hint">Approve the pair after saving to activate it in the bot. Approving generates the embedding.</p>
        </div>
      )}

      <div className="aib-faq-list">
        {loading && <div className="aib-empty">Loading…</div>}
        {!loading && !pairs.length && (
          <div className="aib-empty">No FAQ pairs yet. Add some manually or the bot will suggest candidates from team questions.</div>
        )}
        {pairs.map(p => (
          <div key={p.id} className={"aib-faq-row" + (p.approved ? " approved" : "")}>
            <div className="aib-faq-top">
              <span className={"aib-approval-badge" + (p.approved ? " on" : "")}>
                {p.approved ? "✓ Active" : "Pending"}
              </span>
              <span className="aib-faq-meta">{p.use_count || 0}× used · {fmtDate(p.created_at)}</span>
              <button className="aib-approve-btn" onClick={() => toggleApproval(p)}
                      title={p.approved ? "Deactivate" : "Approve & embed"}>
                {p.approved ? "Deactivate" : "Approve"}
              </button>
              <button className="aib-delete-btn" onClick={() => deletePair(p.id)} title="Delete">✕</button>
            </div>
            <div className="aib-faq-q">Q: {p.question}</div>
            <div className="aib-faq-a">A: {p.answer}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Suggestions tab ───────────────────────────────────────────────────────────
function SuggestionsTab({ session }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [running, setRunning]         = useState(false);
  const [runMsg, setRunMsg]           = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await _sb.from("improvement_suggestions")
      .select("*")
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(100);
    setSuggestions(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (id, status) => {
    setSuggestions(prev => prev.map(s => s.id === id ? { ...s, status } : s));
    await _sb.from("improvement_suggestions").update({
      status,
      dismissed_at: status === "dismissed" ? new Date().toISOString() : null,
    }).eq("id", id);
  };

  const runNow = async () => {
    const secret = prompt("Enter SUGGEST_CRON_SECRET to run suggestion generation now:");
    if (!secret) return;
    setRunning(true);
    setRunMsg("Running…");
    try {
      const r = await fetch(`/api/ai/suggest?secret=${encodeURIComponent(secret)}`);
      const d = await r.json();
      setRunMsg(`Done — ${d.suggestions_created || 0} created, ${d.suggestions_skipped || 0} skipped`);
      load();
    } catch (e) {
      setRunMsg("Error: " + e.message);
    }
    setRunning(false);
  };

  const CATEGORY_LABELS = { workflow: "Workflow", app: "App", content: "Content", sop: "SOP" };
  const grouped = suggestions.reduce((acc, s) => {
    const cat = s.category || "workflow";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  const STATUS_OPTIONS = ["pending", "in_progress", "done", "dismissed"];

  return (
    <div className="aib-panel">
      <div className="aib-toolbar">
        <span className="aib-count">{suggestions.length} active suggestions</span>
        {runMsg && <span className="aib-embed-msg">{runMsg}</span>}
        <button className="aib-add-btn" onClick={runNow} disabled={running}>
          {running ? "Running…" : "Run now"}
        </button>
        <button className="aib-refresh-btn" onClick={load}>↻</button>
      </div>

      {loading && <div className="aib-empty" style={{ padding: 24 }}>Loading…</div>}
      {!loading && !suggestions.length && (
        <div className="aib-empty" style={{ padding: 24 }}>
          No suggestions yet. The Hetzner cron runs daily at 08:00 UTC, or click "Run now" to trigger manually.
        </div>
      )}

      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} className="aib-suggest-group">
          <div className="aib-suggest-group-label">{CATEGORY_LABELS[cat] || cat}</div>
          <div className="aib-suggest-cards">
            {items.map(s => (
              <div key={s.id} className={"aib-suggest-card priority-" + (s.priority || "medium")}>
                <div className="aib-suggest-top">
                  <span className={"aib-priority-badge " + (s.priority || "medium")}>{s.priority}</span>
                  <span className="aib-suggest-date">{fmtDate(s.created_at)}</span>
                  <select className="aib-status-select"
                          value={s.status}
                          onChange={e => setStatus(s.id, e.target.value)}>
                    {STATUS_OPTIONS.map(opt => (
                      <option key={opt} value={opt}>{opt.replace("_", " ")}</option>
                    ))}
                  </select>
                </div>
                <div className="aib-suggest-title">{s.title}</div>
                <div className="aib-suggest-body">{s.body}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Bot log tab ───────────────────────────────────────────────────────────────
function BotLogTab() {
  const [convos, setConvos]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await _sb.from("bot_conversations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    setConvos(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setHelpful = async (id, val) => {
    setConvos(prev => prev.map(c => c.id === id ? { ...c, was_helpful: val } : c));
    await _sb.from("bot_conversations").update({ was_helpful: val }).eq("id", id);
  };

  return (
    <div className="aib-panel">
      <div className="aib-toolbar">
        <span className="aib-count">{convos.length} interactions</span>
        <button className="aib-refresh-btn" onClick={load}>↻</button>
      </div>
      <div className="aib-botlog-list">
        {loading && <div className="aib-empty">Loading…</div>}
        {!loading && !convos.length && <div className="aib-empty">No bot interactions yet.</div>}
        {convos.map(c => (
          <div key={c.id} className="aib-botlog-row">
            <div className="aib-botlog-meta">
              <span className="aib-note-source">{c.source}</span>
              {c.channel && <span className="aib-note-channel">#{c.channel}</span>}
              <span className="aib-note-author">{c.author}</span>
              <span className="aib-note-date">{fmtDate(c.created_at)}</span>
              {c.confidence != null && (
                <span className="aib-confidence" title="Cosine similarity">
                  {Math.round(c.confidence * 100)}%
                </span>
              )}
              <span className="aib-helpful-btns">
                <button className={"aib-helpful-btn" + (c.was_helpful === true ? " on" : "")}
                        onClick={() => setHelpful(c.id, true)} title="Helpful">👍</button>
                <button className={"aib-helpful-btn" + (c.was_helpful === false ? " on" : "")}
                        onClick={() => setHelpful(c.id, false)} title="Not helpful">👎</button>
              </span>
            </div>
            <div className="aib-botlog-q">Q: {c.question}</div>
            <div className="aib-botlog-a">A: {(c.answer || "").slice(0, 300)}{c.answer?.length > 300 ? "…" : ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Insights tab (Workflow Intelligence Log) ──────────────────────────────────
const INSIGHT_CATEGORY_COLORS = {
  code_change:     "#ef4444",
  workflow_change: "#3b82f6",
  feature_request: "#10b981",
  bug:             "#f59e0b",
  process:         "#8b5cf6",
};
const INSIGHT_CATEGORY_LABELS = {
  code_change:     "Code change",
  workflow_change: "Workflow",
  feature_request: "Feature",
  bug:             "Bug",
  process:         "Process",
};
const INSIGHT_CATEGORIES = Object.keys(INSIGHT_CATEGORY_COLORS);
const INSIGHT_STATUSES   = ["open", "noted", "promoted", "dismissed"];

function CategoryBadge({ category }) {
  const color = INSIGHT_CATEGORY_COLORS[category] || "#6b7280";
  return (
    <span style={{
      background: color + "22", color, border: `1px solid ${color}55`,
      borderRadius: 4, padding: "1px 7px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
    }}>{INSIGHT_CATEGORY_LABELS[category] || category}</span>
  );
}

function InsightsTab({ session }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [catFilter, setCatFilter] = useState("all");
  const [parsing, setParsing] = useState(false);
  const [runMsg, setRunMsg]   = useState("");
  const [adding, setAdding]   = useState(false);
  const [draft, setDraft]     = useState({ summary: "", category: "workflow_change", tags: "", priority: "medium" });

  const load = useCallback(async () => {
    setLoading(true);
    let q = _sb.from("workflow_insights")
      .select("*")
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(200);
    if (catFilter !== "all") q = q.eq("category", catFilter);
    const { data } = await q;
    setItems(data || []);
    setLoading(false);
  }, [catFilter]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (id, status) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i));
    const patch = { status };
    if (status === "promoted")  patch.promoted_at  = new Date().toISOString();
    if (status === "dismissed") patch.dismissed_at = new Date().toISOString();
    await _sb.from("workflow_insights").update(patch).eq("id", id);
    if (status === "dismissed") setItems(prev => prev.filter(i => i.id !== id));
  };

  const promote = async (item) => {
    try { await navigator.clipboard.writeText(item.summary); } catch { /* clipboard may be blocked */ }
    await setStatus(item.id, "promoted");
    setRunMsg("Copied to clipboard — now on the My Work board");
    setTimeout(() => setRunMsg(""), 2500);
  };

  const saveNote = async (id, note) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, paul_note: note } : i));
    await _sb.from("workflow_insights").update({ paul_note: note }).eq("id", id);
  };

  const parseNow = async () => {
    setParsing(true);
    setRunMsg("Parsing recent conversations…");
    try {
      const r = await fetch("/api/ai/suggest?action=insights", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.statusText);
      setRunMsg(`Done — ${d.insights_created || 0} new insight${d.insights_created === 1 ? "" : "s"}` +
                (d.reason ? ` (${d.reason})` : ""));
      load();
    } catch (e) {
      setRunMsg("Error: " + e.message);
    }
    setParsing(false);
    setTimeout(() => setRunMsg(""), 4000);
  };

  const addManual = async () => {
    if (!draft.summary.trim()) return;
    const tags = draft.tags.split(",").map(t => t.trim()).filter(Boolean).slice(0, 3);
    const { data, error } = await _sb.from("workflow_insights").insert({
      source_type: "manual",
      category:    draft.category,
      summary:     draft.summary.trim(),
      tags,
      priority:    draft.priority,
    }).select().single();
    if (!error && data) {
      setItems(prev => [data, ...prev]);
      setDraft({ summary: "", category: "workflow_change", tags: "", priority: "medium" });
      setAdding(false);
    }
  };

  return (
    <div className="aib-panel">
      <div className="aib-toolbar">
        <span className="aib-count">{items.length} insights</span>
        <select className="aib-status-select" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="all">All categories</option>
          {INSIGHT_CATEGORIES.map(c => <option key={c} value={c}>{INSIGHT_CATEGORY_LABELS[c]}</option>)}
        </select>
        {runMsg && <span className="aib-embed-msg">{runMsg}</span>}
        <button className="aib-add-btn" onClick={() => setAdding(o => !o)}>+ Add insight</button>
        <button className="aib-add-btn" onClick={parseNow} disabled={parsing}>
          {parsing ? "Parsing…" : "⚡ Parse now"}
        </button>
        <button className="aib-refresh-btn" onClick={load}>↻</button>
      </div>

      {adding && (
        <div className="aib-add-form">
          <textarea className="aib-textarea" placeholder="Insight summary (one clear sentence)…"
                    value={draft.summary} onChange={e => setDraft(d => ({ ...d, summary: e.target.value }))} rows={2} />
          <div className="aib-add-row">
            <select className="aib-status-select" value={draft.category}
                    onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}>
              {INSIGHT_CATEGORIES.map(c => <option key={c} value={c}>{INSIGHT_CATEGORY_LABELS[c]}</option>)}
            </select>
            <select className="aib-status-select" value={draft.priority}
                    onChange={e => setDraft(d => ({ ...d, priority: e.target.value }))}>
              {["low", "medium", "high"].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <input className="aib-input" placeholder="tags, comma, separated"
                   value={draft.tags} onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))} />
          </div>
          <div className="aib-add-actions">
            <button className="aib-save-btn" onClick={addManual} disabled={!draft.summary.trim()}>Add</button>
            <button className="aib-cancel-btn" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      <p className="aib-hint" style={{ margin: "0 0 8px" }}>
        Insights are distilled from your team's Rocket.Chat conversations.
        Promote one to copy it and pin it to the My Work board.
      </p>

      <div className="aib-faq-list">
        {loading && <div className="aib-empty">Loading…</div>}
        {!loading && !items.length && (
          <div className="aib-empty">No insights yet. Click "Parse now" to scan recent conversations, or add one manually.</div>
        )}
        {items.map(it => (
          <div key={it.id} className={"aib-insight-card priority-" + (it.priority || "medium")}>
            <div className="aib-insight-top">
              <CategoryBadge category={it.category} />
              <span className={"aib-priority-badge " + (it.priority || "medium")}>{it.priority}</span>
              <span className="aib-note-source">{it.source_type?.replace("_", " ")}</span>
              <span className="aib-suggest-date">{fmtDate(it.created_at)}</span>
              <select className="aib-status-select" value={it.status}
                      onChange={e => setStatus(it.id, e.target.value)}>
                {INSIGHT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="aib-approve-btn" onClick={() => promote(it)} title="Copy + pin to My Work">
                Promote
              </button>
            </div>
            <div className="aib-insight-summary">{it.summary}</div>
            {it.tags?.length > 0 && (
              <div className="aib-note-tags">{it.tags.map(t => <span key={t} className="aib-tag">{t}</span>)}</div>
            )}
            {it.raw_excerpt && (
              <details className="aib-insight-excerpt">
                <summary>Source excerpt</summary>
                <div>{it.raw_excerpt}</div>
              </details>
            )}
            <input className="aib-input aib-insight-note"
                   placeholder="Add a note…"
                   defaultValue={it.paul_note || ""}
                   onBlur={e => { if (e.target.value !== (it.paul_note || "")) saveNote(it.id, e.target.value); }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Ask the bot widget ────────────────────────────────────────────────────────
function AskWidget({ session }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const ask = async () => {
    if (!question.trim()) return;
    setLoading(true); setError(""); setAnswer(null);
    try {
      const r = await fetch("/api/ai/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({ question: question.trim(), source: "direct", author: "owner" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.statusText);
      setAnswer(d);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="aib-ask-widget">
      <div className="aib-ask-label">Test the bot</div>
      <div className="aib-ask-row">
        <input className="aib-input"
               placeholder="Ask a question as a team member would…"
               value={question}
               onChange={e => setQuestion(e.target.value)}
               onKeyDown={e => e.key === "Enter" && ask()} />
        <button className="aib-save-btn" onClick={ask} disabled={loading || !question.trim()}>
          {loading ? "…" : "Ask"}
        </button>
      </div>
      {error && <div className="aib-error">{error}</div>}
      {answer && (
        <div className="aib-ask-result">
          <div className="aib-ask-answer">{answer.answer}</div>
          <div className="aib-ask-meta">
            {answer.source_type} · confidence {Math.round((answer.confidence || 0) * 100)}%
            {answer.fallback && " · (fallback — no matching FAQ)"}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main AIBrain page ─────────────────────────────────────────────────────────
const SUBTABS = ["notes", "insights", "faq", "suggestions", "botlog"];
const SUBTAB_LABELS = { notes: "Notes", insights: "Insights", faq: "FAQ", suggestions: "Suggestions", botlog: "Bot Log" };

export function AIBrain() {
  const { session } = useAuth();
  const [sub, setSub] = useState(() => localStorage.getItem("aib_sub") || "notes");
  useEffect(() => { localStorage.setItem("aib_sub", sub); }, [sub]);

  return (
    <div className="aib-root">
      <div className="aib-header">
        <h2 className="aib-title">AI Brain</h2>
        <p className="aib-subtitle">Message monitoring · FAQ bot · Improvement suggestions</p>
      </div>

      <div className="aib-subtabs">
        {SUBTABS.map(s => (
          <DPill key={s} active={sub === s} onClick={() => setSub(s)}>
            {SUBTAB_LABELS[s]}
          </DPill>
        ))}
      </div>

      {sub === "notes"       && <NotesTab session={session} />}
      {sub === "insights"    && <InsightsTab session={session} />}
      {sub === "faq"         && <FaqTab session={session} />}
      {sub === "suggestions" && <SuggestionsTab session={session} />}
      {sub === "botlog"      && <BotLogTab />}

      {(sub === "faq" || sub === "botlog") && session && (
        <AskWidget session={session} />
      )}
    </div>
  );
}
