/* =========================================================
   Inbox — unified comments + DMs across Facebook, Instagram,
   YouTube and TikTok, grouped by reel so the owner can reply
   to every platform's comments for a reel in one place.

   NOTE: This UI is MOCK-BACKED. It reads from ../lib/social-client.js,
   which today returns deterministic mock data (see the `// TODO(real)`
   seams there). Replies call replyToThread() (a ~250ms mock) and are
   applied to LOCAL React state only — nothing is written to any real
   platform until the FB/IG/YouTube/TikTok write endpoints are wired.

   Keep the `Inbox` export name — app.jsx imports it.
   ========================================================= */
import React, { useMemo, useState, useCallback } from "react";
import {
  PLATFORMS,
  PLATFORM_BY_KEY,
  getInboxByReel,
  getInboxSummary,
  replyToThread,
} from "../lib/social-client.js";
import { SocialStatusCards } from "../components/social-status.jsx";
import { useAuth } from "../auth.jsx";
import "./inbox.css";

/* ── small presentational helpers ─────────────────────────────────────────── */

// Coloured platform badge (glyph + label, tinted with the platform colour).
function PlatformBadge({ platform, withLabel = true }) {
  const p = PLATFORM_BY_KEY[platform];
  if (!p) return null;
  return (
    <span
      className="ib-plat"
      style={{ color: p.color, borderColor: p.color }}
      title={p.label}
    >
      <span className="glyph">{p.glyph}</span>
      {withLabel && <span className="lbl">{p.label}</span>}
    </span>
  );
}

// Bare coloured glyph chip (used in the reel header's "platforms present" row).
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

/* ── one thread row (comment or DM) with inline reply ─────────────────────── */

function ThreadRow({ thread, onReplied }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const p = PLATFORM_BY_KEY[thread.platform];

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await replyToThread(thread.id, text);
      if (res?.ok) {
        onReplied(thread.id, res.reply);
        setDraft("");
      }
    } finally {
      setSending(false);
    }
  }, [draft, sending, thread.id, onReplied]);

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className={"ib-thread" + (thread.replied ? " is-replied" : "")}>
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
          <span className="ib-spacer" />
          {thread.likes > 0 && <span className="ib-likes">♥ {thread.likes}</span>}
          <span className="ib-time">{thread.time}</span>
        </div>

        <div className="ib-text">{thread.text}</div>

        {/* existing reply(ies), muted */}
        {thread.replies?.map((r, i) => (
          <div className="ib-reply" key={i}>
            <span className="ib-reply-tag">replied</span>
            <span className="ib-reply-author">{r.author}</span>
            <span className="ib-reply-text">{r.text}</span>
          </div>
        ))}

        {/* inline reply composer for unreplied threads */}
        {!thread.replied && (
          <div className="ib-compose">
            <input
              className="ib-input"
              type="text"
              placeholder={`Reply on ${p?.label || thread.platform}…`}
              value={draft}
              disabled={sending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
            />
            <button
              className="ib-send"
              disabled={sending || !draft.trim()}
              onClick={send}
            >
              {sending ? "…" : "Send"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── one reel group (all platforms' threads for a single reel) ────────────── */

function ReelGroup({ group, onReplied, onReplyAll }) {
  const [open, setOpen] = useState(true);
  const [allDraft, setAllDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const sendAll = useCallback(async () => {
    const text = allDraft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onReplyAll(group.reelId, text);
      setAllDraft("");
    } finally {
      setBusy(false);
    }
  }, [allDraft, busy, group.reelId, onReplyAll]);

  return (
    <div className="ib-reel">
      <div className="ib-reel-head" onClick={() => setOpen((o) => !o)}>
        <div className="ib-reel-titles">
          <div className="ib-reel-id">{group.reelId}</div>
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
          {/* reply-to-all: posts the same text to every unreplied thread here */}
          {group.unreplied > 1 && (
            <div className="ib-replyall">
              <span className="ib-replyall-lbl">
                Reply to all {group.unreplied} unreplied
              </span>
              <input
                className="ib-input"
                type="text"
                placeholder="Same reply to every platform for this reel…"
                value={allDraft}
                disabled={busy}
                onChange={(e) => setAllDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendAll();
                  }
                }}
              />
              <button
                className="ib-send is-all"
                disabled={busy || !allDraft.trim()}
                onClick={sendAll}
              >
                {busy ? "Sending…" : "Reply all"}
              </button>
            </div>
          )}

          {group.threads.map((t) => (
            <ThreadRow key={t.id} thread={t} onReplied={onReplied} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

function Inbox() {
  const { person: me } = useAuth();
  const isOwner = me?.role === "owner";

  // Clone the mock data into state once so inline replies persist in the view.
  const [threads, setThreads] = useState(() => {
    // Flatten getInboxByReel back to threads we own; we regroup in render.
    const groups = getInboxByReel();
    return groups.flatMap((g) =>
      g.threads.map((t) => ({ ...t, replies: [...(t.replies || [])] }))
    );
  });

  const summary = useMemo(() => getInboxSummary(), []);

  // filter state
  const [platform, setPlatform] = useState("all"); // "all" | platform key
  const [kind, setKind] = useState("all"); // "all" | "comment" | "dm"
  const [onlyUnreplied, setOnlyUnreplied] = useState(false);

  // Apply a reply to one thread in local state.
  const applyReply = useCallback((threadId, reply) => {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? { ...t, replied: true, replies: [...(t.replies || []), reply] }
          : t
      )
    );
  }, []);

  // Reply-to-all for one reel: loop replyToThread across its unreplied threads.
  const replyAllForReel = useCallback(
    async (reelId, text) => {
      const targets = threads.filter((t) => t.reelId === reelId && !t.replied);
      const results = await Promise.all(
        targets.map((t) =>
          replyToThread(t.id, text).then((res) => ({ id: t.id, res }))
        )
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

  // Filter then regroup by reel (mirrors getInboxByReel's shape).
  const groups = useMemo(() => {
    let list = threads;
    if (platform !== "all") list = list.filter((t) => t.platform === platform);
    if (kind !== "all") list = list.filter((t) => t.kind === kind);
    if (onlyUnreplied) list = list.filter((t) => !t.replied);

    const byReel = {};
    for (const t of list) {
      const g =
        byReel[t.reelId] ||
        (byReel[t.reelId] = {
          reelId: t.reelId,
          postTitle: t.postTitle,
          threads: [],
          platforms: new Set(),
        });
      g.threads.push(t);
      g.platforms.add(t.platform);
    }
    return Object.values(byReel)
      .map((g) => ({
        ...g,
        platforms: [...g.platforms],
        unreplied: g.threads.filter((t) => !t.replied).length,
      }))
      .sort((a, b) => b.threads.length - a.threads.length);
  }, [threads, platform, kind, onlyUnreplied]);

  const shown = groups.reduce((n, g) => n + g.threads.length, 0);

  return (
    <div className="inbox">
      <div className="page-head">
        <div className="titles">
          <h1>Inbox</h1>
          <div className="sub">
            Every comment &amp; DM across Facebook, Instagram, YouTube and
            TikTok — grouped by reel so you can reply everywhere in one place.
          </div>
        </div>
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
      </div>

      {/* connection status cards — are all platforms connected? reconnect if not */}
      <SocialStatusCards canManage={isOwner} title="Platform connections" />

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
                style={
                  active
                    ? { color: p.color, borderColor: p.color }
                    : undefined
                }
              >
                <span className="glyph" style={{ color: p.color }}>
                  {p.glyph}
                </span>
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
        </div>
      </div>

      {/* grouped-by-reel list */}
      <div className="ib-list">
        <div className="ib-list-meta">
          {groups.length} reel{groups.length === 1 ? "" : "s"} · {shown}{" "}
          message{shown === 1 ? "" : "s"} shown
        </div>
        {groups.length === 0 ? (
          <div className="ib-empty">Nothing matches these filters.</div>
        ) : (
          groups.map((g) => (
            <ReelGroup
              key={g.reelId}
              group={g}
              onReplied={applyReply}
              onReplyAll={replyAllForReel}
            />
          ))
        )}
      </div>
    </div>
  );
}

export { Inbox };
