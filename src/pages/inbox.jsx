/* =========================================================
   Inbox — unified comments + DMs across Facebook, Instagram,
   YouTube and TikTok, grouped by reel so the owner can reply
   to every platform's comments for a reel in one place.

   NOTE: replies for FB/IG are live (Hetzner backend). YouTube
   and TikTok return an explicit error until those write endpoints
   are wired — the UI surfaces the message so the user knows.

   Keep the `Inbox` export name — app.jsx imports it.
   ========================================================= */
import React, {
  useMemo, useState, useCallback, useEffect, useRef,
} from "react";
import {
  PLATFORMS,
  PLATFORM_BY_KEY,
  getInboxByReel,
  replyToThread,
  fetchLiveFacebookInbox,
  fetchLiveInstagramInbox,
  fetchLiveYouTubeInbox,
  classifyInboxThreads,
  suggestInboxReplies,
} from "../lib/social-client.js";
import { SocialStatusCards } from "../components/social-status.jsx";
import { useAuth } from "../auth.jsx";
import { useWorkflow } from "../store/store.jsx";
import "./inbox.css";

/* ── time helpers ─────────────────────────────────────────────────────────── */
function normalizeThread(t) {
  const groupKey =
    t.reelId ||
    (t.postId ? `${t.platform}:${t.postId}` : `${t.platform}:dm`);
  return {
    ...t,
    sentiment: t.sentiment || "neutral",
    replied: !!t.replied,
    replies: Array.isArray(t.replies) ? [...t.replies] : [],
    time: typeof t.time === "string" && t.time.includes("T") ? relIso(t.time) : t.time,
    isoTime: t.time && t.time.includes("T") ? t.time : null,
    groupKey,
  };
}

function relIso(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 1440 * 7) return `${Math.floor(m / 1440)}d`;
  return new Date(iso).toLocaleDateString();
}

/* Returns ms age of a thread (for urgency indicator). Falls back to minsAgo * 60000. */
function threadAgeMs(t) {
  if (t.isoTime) return Date.now() - new Date(t.isoTime).getTime();
  if (t.minsAgo != null) return t.minsAgo * 60000;
  return 0;
}

/* ── small presentational helpers ─────────────────────────────────────────── */
function PlatformBadge({ platform, withLabel = true }) {
  const p = PLATFORM_BY_KEY[platform];
  if (!p) return null;
  return (
    <span className="ib-plat" style={{ color: p.color, borderColor: p.color }} title={p.label}>
      <span className="glyph">{p.glyph}</span>
      {withLabel && <span className="lbl">{p.label}</span>}
    </span>
  );
}

function PlatformGlyph({ platform }) {
  const p = PLATFORM_BY_KEY[platform];
  if (!p) return null;
  return (
    <span className="ib-glyph" style={{ color: p.color, borderColor: p.color }} title={p.label}>
      {p.glyph}
    </span>
  );
}

function SentimentDot({ sentiment }) {
  return <span className={"ib-sent " + sentiment} title={sentiment} />;
}

/* Age urgency indicator: yellow ⚠ after 24h, red after 48h. */
function AgeFlag({ thread }) {
  if (thread.replied) return null;
  const ms = threadAgeMs(thread);
  if (ms < 86400000) return null;
  const color = ms >= 172800000 ? "var(--c-red)" : "var(--c-amber)";
  const title = ms >= 172800000 ? "48h+ old — urgent" : "24h+ old";
  return (
    <span title={title} style={{ color, fontSize: 11, lineHeight: 1, flexShrink: 0 }}>⚠</span>
  );
}

/* DM quick-reply templates */
const DM_TEMPLATES = [
  "Thanks for reaching out! 🙏",
  "We'll follow up soon.",
  "Please DM your email and we'll be in touch.",
];

/* ── one thread row (comment or DM) ───────────────────────────────────────── */
function ThreadRow({ thread, onReplied, isActive, onActivate, tabIndex, aiTopic, suggestions, suggestLoading, onSuggest }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const inputRef = useRef(null);
  const p = PLATFORM_BY_KEY[thread.platform];

  /* Keyboard navigation: `r` focuses the reply input from parent key handler */
  useEffect(() => {
    if (isActive && inputRef.current && !thread.replied) {
      inputRef.current.focus();
    }
  }, [isActive, thread.replied]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await replyToThread(thread, text);
      if (res?.ok) {
        onReplied(thread.id, res.reply);
        setDraft("");
      } else if (res?.error) {
        const msg = typeof res.error === "string" ? res.error : (res.error?.message || "Reply failed");
        // eslint-disable-next-line no-alert
        alert(`Couldn't post the reply: ${msg}`);
      }
    } finally {
      setSending(false);
    }
  }, [draft, sending, thread, onReplied]);

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === "Escape") { e.target.blur(); }
  };

  const applyTemplate = (text) => {
    setDraft(text);
    setShowTemplates(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  /* Click an AI draft → seed the editable compose box (never auto-send), then
     focus so the human can tweak before Send. Clone of applyTemplate. */
  const applySuggestion = (text) => {
    setDraft(text);
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const hasSuggestions = Array.isArray(suggestions) && suggestions.length > 0;

  return (
    <div
      className={"ib-thread" + (thread.replied ? " is-replied" : "") + (isActive ? " is-active" : "")}
      onClick={onActivate}
      tabIndex={tabIndex}
    >
      <div className="ib-avatar" style={{ borderColor: p?.color }}>
        {thread.author.avatar}
      </div>

      <div className="ib-thread-main">
        <div className="ib-thread-head">
          <PlatformBadge platform={thread.platform} withLabel={false} />
          <span className={"ib-kind " + thread.kind}>
            {thread.kind === "dm" ? "DM" : "comment"}
          </span>
          <span className="ib-handle">{thread.author.handle}</span>
          <SentimentDot sentiment={thread.sentiment} />
          <AgeFlag thread={thread} />
          {aiTopic && aiTopic !== "Other" && (
            <span className={"ib-ai-tag topic-" + aiTopic.toLowerCase()}>{aiTopic}</span>
          )}
          <span className="ib-spacer" />
          {thread.likes > 0 && <span className="ib-likes">♥ {thread.likes}</span>}
          <span className="ib-time">{thread.time}</span>
        </div>

        <div className="ib-text">{thread.text}</div>

        {thread.replies?.map((r, i) => (
          <div className="ib-reply" key={i}>
            <span className="ib-reply-tag">replied</span>
            <span className="ib-reply-author">{r.author}</span>
            <span className="ib-reply-text">{r.text}</span>
          </div>
        ))}

        {!thread.replied && (
          <div className="ib-compose">
            <input
              ref={inputRef}
              className="ib-input"
              type="text"
              placeholder={`Reply on ${p?.label || thread.platform}…`}
              value={draft}
              disabled={sending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
            />
            {/* Template picker for DMs */}
            {thread.kind === "dm" && (
              <div style={{ position: "relative" }}>
                <button
                  className="ib-tmpl-btn"
                  title="Quick reply templates"
                  onClick={(e) => { e.stopPropagation(); setShowTemplates(v => !v); }}
                >◂</button>
                {showTemplates && (
                  <div className="ib-tmpl-pop">
                    {DM_TEMPLATES.map((t, i) => (
                      <button key={i} className="ib-tmpl-item" onClick={() => applyTemplate(t)}>
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              className="ib-send"
              disabled={sending || !draft.trim()}
              onClick={send}
            >
              {sending ? "…" : "Send"}
            </button>
          </div>
        )}

        {/* AI reply suggestions — opt-in per thread. Drafts only seed the
            editable box above; the human always edits + clicks Send. */}
        {!thread.replied && onSuggest && (
          <div className="ib-suggest" role="group" aria-label="AI reply suggestions">
            {suggestLoading ? (
              <span className="ib-suggest-loading">✨ thinking…</span>
            ) : hasSuggestions ? (
              <>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    className="ib-suggest-pill"
                    title={s}
                    onClick={(e) => { e.stopPropagation(); applySuggestion(s); }}
                  >
                    {s}
                  </button>
                ))}
                <button
                  type="button"
                  className="ib-suggest-regen"
                  title="Regenerate suggestions"
                  onClick={(e) => { e.stopPropagation(); onSuggest(thread, true); }}
                >↻</button>
              </>
            ) : Array.isArray(suggestions) ? (
              <>
                <span className="ib-suggest-loading">No suggestions.</span>
                <button
                  type="button"
                  className="ib-suggest-btn"
                  onClick={(e) => { e.stopPropagation(); onSuggest(thread, true); }}
                >try again</button>
              </>
            ) : (
              <button
                type="button"
                className="ib-suggest-btn"
                title="Draft 2-3 reply options with AI"
                onClick={(e) => { e.stopPropagation(); onSuggest(thread); }}
              >✨ Suggest replies</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── one reel group ───────────────────────────────────────────────────────── */
function ReelGroup({ group, onReplied, onReplyAll, onLinkPost, reelOptions, sort, activeIdx, onThreadClick, aiTags, suggestions, suggestLoading, onSuggest }) {
  /* Collapse replied by default — unreplied threads stay prominent */
  const [showReplied, setShowReplied] = useState(false);
  const [open, setOpen] = useState(true);
  const [allDraft, setAllDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [undoTimer, setUndoTimer] = useState(null);
  const [undoPending, setUndoPending] = useState(null);

  const linkable = !!onLinkPost && !group.isLinked &&
    group.groupKey.includes(":") && !group.groupKey.endsWith(":dm");

  /* Sort threads within the group */
  const sortedThreads = useMemo(() => {
    const ts = [...group.threads];
    if (sort === "oldest") ts.sort((a, b) => threadAgeMs(b) - threadAgeMs(a));
    else if (sort === "liked") ts.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    else if (sort === "negative") ts.sort((a, b) => {
      const score = (s) => s === "negative" ? 0 : s === "neutral" ? 1 : 2;
      return score(a.sentiment) - score(b.sentiment);
    });
    // default: newest first (minsAgo ascending)
    else ts.sort((a, b) => threadAgeMs(a) - threadAgeMs(b));
    return ts;
  }, [group.threads, sort]);

  const unreplied = sortedThreads.filter(t => !t.replied);
  const replied = sortedThreads.filter(t => t.replied);

  const sendAll = useCallback(async () => {
    const text = allDraft.trim();
    if (!text || busy) return;
    /* 1-second undo window before actually sending */
    setUndoPending(text);
    const timer = setTimeout(async () => {
      setUndoPending(null);
      setBusy(true);
      try { await onReplyAll(group.groupKey, text); setAllDraft(""); }
      finally { setBusy(false); }
    }, 1200);
    setUndoTimer(timer);
  }, [allDraft, busy, group.groupKey, onReplyAll]);

  const cancelSendAll = () => {
    clearTimeout(undoTimer);
    setUndoPending(null);
  };

  return (
    <div className="ib-reel">
      <div className="ib-reel-head" onClick={() => setOpen((o) => !o)}>
        <div className="ib-reel-titles">
          <div className="ib-reel-id">
            {group.cardLabel || group.reelId || "Post"}
            {group.isLinked ? (
              <span className="ib-link-badge in">In pipeline</span>
            ) : (
              <span className="ib-link-badge out">Not in pipeline</span>
            )}
            {linkable && (
              <select
                value=""
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation();
                  if (e.target.value) onLinkPost(group.groupKey, e.target.value);
                }}
                title="Claim this platform post for a pipeline card"
                style={{
                  marginLeft: 8,
                  background: "var(--bg-2, rgba(0,0,0,0.25))",
                  border: "1px dashed var(--line-hard, #2a3754)",
                  borderRadius: 4,
                  color: "var(--fg-dim, #8899aa)",
                  fontFamily: "var(--f-mono)",
                  fontSize: 10,
                  padding: "2px 4px",
                  cursor: "pointer",
                  maxWidth: 180,
                }}
              >
                <option value="">link to card…</option>
                {(reelOptions || []).map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            )}
          </div>
          <div className="ib-reel-title">{group.postTitle}</div>
        </div>
        <div className="ib-reel-glyphs">
          {group.platforms.map((k) => (
            <PlatformGlyph key={k} platform={k} />
          ))}
        </div>
        {group.unreplied > 0 && (
          <span className="ib-unreplied-badge">{group.unreplied} unreplied</span>
        )}
        <span className="ib-count">{group.threads.length} msgs</span>
        <span className="ib-chev">{open ? "▾" : "▸"}</span>
      </div>

      {open && (
        <div className="ib-reel-body">
          {group.unreplied > 1 && (
            <div className="ib-replyall">
              <span className="ib-replyall-lbl">
                Reply to all {group.unreplied} unreplied
              </span>
              {undoPending ? (
                <>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-mute)", flex: 1 }}>
                    Sending in 1s…
                  </span>
                  <button className="ib-send" onClick={cancelSendAll} style={{ color: "var(--c-amber)", borderColor: "var(--c-amber-soft)" }}>
                    Undo
                  </button>
                </>
              ) : (
                <>
                  <input
                    className="ib-input"
                    type="text"
                    placeholder="Same reply to every platform for this reel…"
                    value={allDraft}
                    disabled={busy}
                    onChange={(e) => setAllDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAll(); }
                    }}
                  />
                  <button className="ib-send is-all" disabled={busy || !allDraft.trim()} onClick={sendAll}>
                    {busy ? "Sending…" : "Reply all"}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Unreplied threads */}
          {unreplied.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              onReplied={onReplied}
              isActive={activeIdx === t.id}
              onActivate={() => onThreadClick && onThreadClick(t.id)}
              tabIndex={0}
              aiTopic={aiTags?.[t.id]?.topic}
              suggestions={suggestions?.[t.id]}
              suggestLoading={!!suggestLoading?.[t.id]}
              onSuggest={onSuggest}
            />
          ))}

          {/* Replied threads — collapsed by default */}
          {replied.length > 0 && (
            <>
              <button
                className="ib-show-replied"
                onClick={(e) => { e.stopPropagation(); setShowReplied(v => !v); }}
              >
                {showReplied ? `▾ hide ${replied.length} replied` : `▸ ${replied.length} replied`}
              </button>
              {showReplied && replied.map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  onReplied={onReplied}
                  isActive={false}
                  onActivate={() => {}}
                  tabIndex={-1}
                  aiTopic={aiTags?.[t.id]?.topic}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */
function Inbox() {
  const { person: me, session } = useAuth();
  const isOwner = me?.role === "owner";
  const { reels, actions } = useWorkflow();

  const [threads, setThreads] = useState([]);
  const [aiTags, setAiTags] = useState({});  // {[threadId]: {topic, tags, severity}}
  /* AI reply suggestions — on-demand only (✨ button), NOT fetched on load, so
     we don't double the shared free-OpenRouter burn classify already incurs.
     {[threadId]: string[]} drafts · {[threadId]: true} while a fetch is in flight. */
  const [suggestions, setSuggestions] = useState({});
  const [suggestLoading, setSuggestLoading] = useState({});
  const [source, setSource] = useState("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  /* Outbox (owner-only "new message" composer → Rocket.Chat) */
  const [showOutbox, setShowOutbox] = useState(false);
  const [outboxTo, setOutboxTo] = useState("");
  const [outboxMsg, setOutboxMsg] = useState("");
  const [outboxSending, setOutboxSending] = useState(false);
  const [outboxErr, setOutboxErr] = useState("");

  /* Active thread for keyboard navigation */
  const [activeThreadId, setActiveThreadId] = useState(null);
  /* All flat thread ids in display order (for j/k navigation) */
  const visibleThreadIdsRef = useRef([]);

  const loadThreads = useCallback(async () => {
    const [fb, ig, yt] = await Promise.all([
      fetchLiveFacebookInbox(),
      fetchLiveInstagramInbox(),
      fetchLiveYouTubeInbox(),
    ]);
    const live = [...(fb || []), ...(ig || []), ...(yt || [])];
    let loaded;
    if (live.length) {
      loaded = live.map(normalizeThread);
      setThreads(loaded);
      setSource("live");
    } else {
      loaded = getInboxByReel().flatMap((g) => g.threads).map(normalizeThread);
      setThreads(loaded);
      setSource("mock");
    }
    setLastRefreshed(new Date());
    // Fire-and-forget AI classification — tags appear when ready, won't block UI
    classifyInboxThreads(loaded, session?.access_token).then(setAiTags).catch(() => {});
  }, [session?.access_token]);

  useEffect(() => {
    let alive = true;
    loadThreads().then(() => { if (!alive) return; });
    return () => { alive = false; };
  }, [loadThreads]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await loadThreads(); }
    finally { setRefreshing(false); }
  };

  /* On-demand AI reply suggestions for a single thread (the ✨ button).
     `force` re-fetches even if drafts are already cached (regenerate). The
     drafts only seed the editable compose box — the human always edits + sends. */
  const onSuggest = useCallback(async (thread, force = false) => {
    const id = thread?.id;
    if (!id) return;
    if (!force && Array.isArray(suggestions[id])) return; // cached
    setSuggestLoading((p) => ({ ...p, [id]: true }));
    try {
      const map = await suggestInboxReplies([thread], session?.access_token);
      setSuggestions((p) => ({ ...p, [id]: map[id] || [] }));
    } catch {
      setSuggestions((p) => ({ ...p, [id]: [] }));
    } finally {
      setSuggestLoading((p) => { const n = { ...p }; delete n[id]; return n; });
    }
  }, [suggestions, session?.access_token]);

  /* socialSource lookup: platform post → pipeline card */
  const linkedPosts = useMemo(() => {
    const map = {};
    for (const r of reels || []) {
      const src = r.detail?.socialSource;
      if (src?.facebook) map[`facebook:${src.facebook}`] = r;
      if (src?.instagram) map[`instagram:${src.instagram}`] = r;
    }
    return map;
  }, [reels]);

  const linkPostToReel = useCallback((groupKey, reelId) => {
    const i = groupKey.indexOf(":");
    if (i < 0) return;
    const platform = groupKey.slice(0, i);
    const postId = groupKey.slice(i + 1);
    const reel = (reels || []).find(r => r.id === reelId);
    if (!reel || !postId || postId === "dm") return;
    actions.updateReel(reelId, {
      detail: {
        ...(reel.detail || {}),
        socialSource: { ...(reel.detail?.socialSource || {}), [platform]: postId },
      },
    });
  }, [reels, actions]);

  const reelOptions = useMemo(() => {
    const rank = (r) => (r.stage === "posted" ? 0 : 1);
    return (reels || [])
      .filter(r => !r.archivedAt)
      .slice()
      .sort((a, b) => rank(a) - rank(b) || String(b.id).localeCompare(String(a.id)))
      .map(r => ({ id: r.id, label: r.id + " · " + (r.title || "(untitled)") }));
  }, [reels]);

  /* Filter state */
  const [platform, setPlatform] = useState("all");
  const [kind, setKind] = useState("all");
  const [onlyUnreplied, setOnlyUnreplied] = useState(false);
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const searchRef = useRef(null);

  const summary = useMemo(() => {
    const byPlatform = {};
    for (const p of PLATFORMS) {
      const items = threads.filter((t) => t.platform === p.key);
      byPlatform[p.key] = {
        total: items.length,
        unreplied: items.filter((t) => !t.replied).length,
      };
    }
    return {
      total: threads.length,
      unreplied: threads.filter((t) => !t.replied).length,
      comments: threads.filter((t) => t.kind === "comment").length,
      dms: threads.filter((t) => t.kind === "dm").length,
      byPlatform,
    };
  }, [threads]);

  const applyReply = useCallback((threadId, reply) => {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? { ...t, replied: true, replies: [...(t.replies || []), reply] }
          : t
      )
    );
  }, []);

  const replyAllForReel = useCallback(
    async (groupKey, text) => {
      const targets = threads.filter((t) => t.groupKey === groupKey && !t.replied);
      const results = await Promise.all(
        targets.map((t) => replyToThread(t, text).then((res) => ({ id: t.id, res })))
      );
      setThreads((prev) =>
        prev.map((t) => {
          const hit = results.find((r) => r.id === t.id && r.res?.ok);
          return hit
            ? { ...t, replied: true, replies: [...(t.replies || []), hit.res.reply] }
            : t;
        })
      );
    },
    [threads]
  );

  /* Send a new outbound message via Rocket.Chat. A phone number (starts with +
     or all digits) routes to omnichannel WhatsApp; anything else is treated as
     a Rocket.Chat username for a direct message. */
  const sendOutbox = useCallback(async () => {
    const to = outboxTo.trim();
    const msg = outboxMsg.trim();
    if (!to || !msg || outboxSending) return;
    setOutboxSending(true);
    setOutboxErr("");
    const isPhone = /^\+?\d[\d\s-]*$/.test(to);
    const endpoint = isPhone
      ? "/fb/api/auth/rocketchat/whatsapp-send"
      : "/fb/api/auth/rocketchat/dm";
    const body = isPhone
      ? { to: to.replace(/[\s-]/g, ""), message: msg }
      : { username: to.replace(/^@/, ""), message: msg };
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        setShowOutbox(false);
        setOutboxTo("");
        setOutboxMsg("");
      } else {
        setOutboxErr(d.error || `Send failed (${r.status})`);
      }
    } catch {
      setOutboxErr("Couldn't reach the messaging service. It may not be live yet.");
    } finally {
      setOutboxSending(false);
    }
  }, [outboxTo, outboxMsg, outboxSending]);

  /* Build groups, applying all filters */
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = threads;
    if (platform !== "all") list = list.filter((t) => t.platform === platform);
    if (kind !== "all") list = list.filter((t) => t.kind === kind);
    if (onlyUnreplied) list = list.filter((t) => !t.replied);
    if (q) list = list.filter((t) =>
      t.text?.toLowerCase().includes(q) ||
      t.author?.handle?.toLowerCase().includes(q) ||
      t.postTitle?.toLowerCase().includes(q)
    );

    const byKey = {};
    for (const t of list) {
      const g = byKey[t.groupKey] || (byKey[t.groupKey] = {
        groupKey: t.groupKey,
        reelId: t.reelId || null,
        postTitle: t.postTitle,
        threads: [],
        platforms: new Set(),
      });
      g.threads.push(t);
      g.platforms.add(t.platform);
    }

    let result = Object.values(byKey).map((g) => {
      const card = linkedPosts[g.groupKey];
      return {
        ...g,
        platforms: [...g.platforms],
        unreplied: g.threads.filter((t) => !t.replied).length,
        isLinked: !!card,
        cardLabel: card ? card.title : null,
      };
    });

    if (onlyUnlinked) result = result.filter(g => !g.isLinked);

    /* Sort groups: most unreplied first, then by message count */
    result.sort((a, b) => b.unreplied - a.unreplied || b.threads.length - a.threads.length);
    return result;
  }, [threads, platform, kind, onlyUnreplied, onlyUnlinked, search, linkedPosts]);

  /* Flatten thread ids in display order for j/k navigation */
  useEffect(() => {
    const ids = [];
    for (const g of groups) {
      const unreplied = g.threads.filter(t => !t.replied);
      const replied = g.threads.filter(t => t.replied);
      unreplied.forEach(t => ids.push(t.id));
      replied.forEach(t => ids.push(t.id));
    }
    visibleThreadIdsRef.current = ids;
  }, [groups]);

  /* Global keyboard shortcuts:
     j = next thread, k = prev thread, r = focus reply input,
     / = focus search, Escape = clear active */
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      const ids = visibleThreadIdsRef.current;
      if (e.key === "j") {
        e.preventDefault();
        const idx = ids.indexOf(activeThreadId);
        setActiveThreadId(ids[Math.min(idx + 1, ids.length - 1)]);
      } else if (e.key === "k") {
        e.preventDefault();
        const idx = ids.indexOf(activeThreadId);
        setActiveThreadId(ids[Math.max(idx - 1, 0)]);
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape") {
        setActiveThreadId(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeThreadId]);

  const shown = groups.reduce((n, g) => n + g.threads.length, 0);

  return (
    <div className="inbox">
      <div className="page-head">
        <div className="titles">
          <h1>Inbox</h1>
          <div className="sub">
            Every comment &amp; DM across Facebook, Instagram, YouTube and
            TikTok — grouped by post so you can reply everywhere in one place.
            {source === "live" && (
              <span className="ib-src live" title="Real comments pulled from the connected platforms">● live data</span>
            )}
            {source === "mock" && (
              <span className="ib-src mock" title="No platform connected — showing sample data">○ sample data (connect a platform)</span>
            )}
            {lastRefreshed && (
              <span className="ib-src" style={{ color: "var(--fg-dim)" }}
                    title={"Last loaded " + lastRefreshed.toLocaleTimeString()}>
                {" "}· {lastRefreshed.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
        <div className="ib-head-right">
          <div className="ib-summary">
            <div className="ib-stat">
              <div className="v">{summary.total}</div>
              <div className="l">total</div>
            </div>
            <div className="ib-stat warn">
              <div className="v">{summary.unreplied}</div>
              <div className="l">unreplied</div>
            </div>
            <div className="ib-stat">
              <div className="v">{summary.comments}</div>
              <div className="l">comments</div>
            </div>
            <div className="ib-stat">
              <div className="v">{summary.dms}</div>
              <div className="l">DMs</div>
            </div>
          </div>
          <button
            className={"ib-refresh" + (refreshing ? " is-spinning" : "")}
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh inbox from connected platforms"
          >
            ↻ {refreshing ? "Loading…" : "Refresh"}
          </button>
          {isOwner && (
            <button
              className="ib-refresh"
              onClick={() => { setOutboxErr(""); setShowOutbox(true); }}
              title="Send a new WhatsApp message or team DM"
            >
              + New message
            </button>
          )}
        </div>
      </div>

      <SocialStatusCards canManage={isOwner} title="Platform connections" />

      {/* Search bar */}
      <div className="ib-search-bar">
        <input
          ref={searchRef}
          className="ib-search-input"
          type="text"
          placeholder="Search comments, handles, posts… (/ to focus)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="ib-search-clear" onClick={() => setSearch("")} title="Clear">×</button>
        )}
      </div>

      {/* filter bar */}
      <div className="ib-filters">
        <div className="ib-chip-row">
          <button
            className={"ib-chip" + (platform === "all" ? " is-active" : "")}
            onClick={() => setPlatform("all")}
          >
            All platforms
          </button>
          {PLATFORMS.map((p) => {
            const active = platform === p.key;
            const c = summary.byPlatform[p.key];
            return (
              <button
                key={p.key}
                className={"ib-chip" + (active ? " is-active" : "")}
                onClick={() => setPlatform(active ? "all" : p.key)}
                style={active ? { color: p.color, borderColor: p.color } : undefined}
              >
                <span className="glyph" style={{ color: p.color }}>{p.glyph}</span>
                {p.label}
                {c && <span className="ib-chip-n">{c.unreplied}</span>}
              </button>
            );
          })}
        </div>

        <div className="ib-filter-right">
          <div className="ib-toggle">
            {["all", "comment", "dm"].map((k) => (
              <button
                key={k}
                className={"ib-seg" + (kind === k ? " is-active" : "")}
                onClick={() => setKind(k)}
              >
                {k === "all" ? "All" : k === "comment" ? "Comments" : "DMs"}
              </button>
            ))}
          </div>
          <button
            className={"ib-chip" + (onlyUnreplied ? " is-active is-amber" : "")}
            onClick={() => setOnlyUnreplied((v) => !v)}
          >
            Unreplied only
          </button>
          <button
            className={"ib-chip" + (onlyUnlinked ? " is-active" : "")}
            onClick={() => setOnlyUnlinked((v) => !v)}
            title="Show only posts not yet linked to a pipeline card"
          >
            Not in pipeline
          </button>
          {/* Sort selector */}
          <select
            className="ib-sort-sel"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            title="Sort threads within each group"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="liked">Most liked</option>
            <option value="negative">Negatives first</option>
          </select>
        </div>
      </div>

      <div className="ib-list">
        <div className="ib-list-meta">
          {groups.length} post{groups.length === 1 ? "" : "s"} · {shown}{" "}
          message{shown === 1 ? "" : "s"} shown
          <span className="ib-kbd-hint" title="Keyboard shortcuts">
            <kbd>j</kbd><kbd>k</kbd> navigate · <kbd>r</kbd> reply · <kbd>/</kbd> search
          </span>
        </div>
        {source === "loading" ? (
          <div className="ib-empty">Loading comments &amp; DMs…</div>
        ) : groups.length === 0 ? (
          <div className="ib-empty">Nothing matches these filters.</div>
        ) : (
          groups.map((g) => (
            <ReelGroup
              key={g.groupKey}
              group={g}
              onReplied={applyReply}
              onReplyAll={replyAllForReel}
              onLinkPost={isOwner ? linkPostToReel : null}
              reelOptions={reelOptions}
              sort={sort}
              activeIdx={activeThreadId}
              onThreadClick={setActiveThreadId}
              aiTags={aiTags}
              suggestions={suggestions}
              suggestLoading={suggestLoading}
              onSuggest={onSuggest}
            />
          ))
        )}
      </div>

      {showOutbox && (
        <div
          style={{
            position: "fixed", right: 0, top: 0, bottom: 0, width: "min(380px,100vw)",
            background: "var(--card)", borderLeft: "1px solid var(--line)",
            zIndex: 200, display: "flex", flexDirection: "column", padding: 20, gap: 12,
            boxShadow: "-8px 0 24px rgba(0,0,0,0.35)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600 }}>New message</span>
            <button
              onClick={() => setShowOutbox(false)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--fg-dim)" }}
            >×</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.4 }}>
            Phone number (+1…) → WhatsApp · @username → team direct message
          </div>
          <input
            className="ib-input"
            placeholder="Phone number (+1…) or @username"
            value={outboxTo}
            onChange={(e) => setOutboxTo(e.target.value)}
          />
          <textarea
            className="ib-input"
            placeholder="Message…"
            rows={4}
            value={outboxMsg}
            onChange={(e) => setOutboxMsg(e.target.value)}
            style={{ resize: "vertical" }}
          />
          <button
            className="ib-send"
            disabled={!outboxTo.trim() || !outboxMsg.trim() || outboxSending}
            onClick={sendOutbox}
          >
            {outboxSending ? "Sending…" : "Send"}
          </button>
          {outboxErr && <div style={{ color: "var(--c-red)", fontSize: 11 }}>{outboxErr}</div>}
        </div>
      )}
    </div>
  );
}

export { Inbox };
