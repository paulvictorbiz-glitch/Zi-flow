/* =========================================================
   Reel Detail — minimal dashboard.
   Three working surfaces only:
     · Footage Brain search + attached-footage list
     · Reel Blueprint (logline · script · voiceover)
     · Comments + feedback
   Everything else was non-functioning scaffolding and got removed.
   ========================================================= */

import React, { useState, useEffect } from "react";
import { Card, DPill } from "./components.jsx";
import { useWorkflow } from "./store.jsx";
import { useAuth } from "./auth.jsx";
import { useNotifications } from "./notifications.jsx";
import { FootageBrainSearch } from "./FootageBrainSearch.jsx";
import { AttachedFootageList } from "./AttachedFootageList.jsx";

/* Blueprint fields start empty for every reel — operators fill them in. */
const DEFAULT_LOGLINE = "";
const DEFAULT_SCRIPT  = "";
const DEFAULT_VO      = "";

/* Comments start empty so each reel begins with a clean conversation. */
const DEFAULT_COMMENTS = [];

/* The `detail` jsonb still carries legacy slices (checklists, variants,
   handoff package, etc.) for old reels — we just don't render them
   anymore. Preserve them on read/write so nothing is destroyed; only
   `comments` is rendered. */
function defaultDetail() {
  return { comments: DEFAULT_COMMENTS };
}

function initials(name) {
  if (!name) return "??";
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatCommentTs(iso) {
  if (!iso) return "";
  // Pre-existing seed entries already use display strings ("11:08").
  if (!/^\d{4}-/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Always show full date + time so feedback context is unambiguous
  // across days. Example: "May 14, 2026 · 14:32".
  const datePart = d.toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return datePart + " · " + hh + ":" + mm;
}

function ReelDetail({ reel, onBack }) {
  /* reel is passed from Pipeline when a card is clicked. Default to REEL-201. */
  const current = reel || { id: "REEL-201", title: "Temple crowd sequence" };

  /* Hook into the canonical store. `stored` is the DB-backed
     record for the currently displayed reel — what we read seed
     values from and what we write Blueprint edits back into. */
  const { reels, actions } = useWorkflow();
  const stored = reels.find(r => r.id === current.id);

  const [blueprintTab, setBlueprintTab] = useState("script");
  const [logline, setLogline]     = useState(stored?.logline ?? DEFAULT_LOGLINE);
  const [script, setScript]       = useState(stored?.script ?? DEFAULT_SCRIPT);
  const [vo, setVo]               = useState(stored?.vo ?? DEFAULT_VO);

  /* When the user navigates to a different reel, re-seed the
     Blueprint fields from that reel's stored values. Edits in
     flight on the prior reel are already persisted on blur. */
  useEffect(() => {
    setLogline(stored?.logline ?? DEFAULT_LOGLINE);
    setScript(stored?.script ?? DEFAULT_SCRIPT);
    setVo(stored?.vo ?? DEFAULT_VO);
  }, [current.id]);  // intentionally NOT depending on `stored` — that would clobber typing on realtime echo

  /* Save-on-blur helper: only writes if the value actually
     changed, so passive tab-outs are free. */
  const saveIfChanged = (key, value) => {
    if (!stored) return;
    if (stored[key] === value) return;
    actions.updateReel(current.id, { [key]: value });
  };

  /* Detail blob — single jsonb on the reel. Holds checklists,
     variants, handoff package, allowed/no-touch lists, the
     per-reel task composer queue, and the ReadyForReview stage.
     Auto-saved on a 300ms debounce after the last edit. */
  const [detail, setDetail] = useState(() => stored?.detail || defaultDetail());

  /* Re-seed when the user navigates to a different reel. NOT
     dependent on `stored.detail` — otherwise realtime echoes
     would clobber in-flight edits. */
  useEffect(() => {
    setDetail(stored?.detail || defaultDetail());
  }, [current.id]);

  /* Mark this reel's comments as read on open and when the
     comment list grows while the user is viewing it. The
     notifications context handles the per-user storage. */
  const { markRead } = useNotifications();
  useEffect(() => {
    if (current?.id) markRead(current.id);
  }, [current?.id, stored?.detail?.comments?.length, markRead]);

  /* Debounced save. Skips no-ops by structural-equality check. */
  useEffect(() => {
    if (!stored) return;
    const same = JSON.stringify(detail) === JSON.stringify(stored.detail || defaultDetail());
    if (same) return;
    const t = setTimeout(() => {
      actions.updateReel(current.id, { detail });
    }, 300);
    return () => clearTimeout(t);
  }, [detail, stored]);

  /* Only the comments slice is rendered now — legacy slices (checks,
     variants, handoff package, etc.) stay untouched in the jsonb. */
  const comments = detail.comments || DEFAULT_COMMENTS;

  /* updateSlice mutates one key without touching the others, so
     legacy slices ride through the debounced save unchanged. */
  const updateSlice = (key) => (next) =>
    setDetail(d => ({ ...d, [key]: typeof next === "function" ? next(d[key] ?? []) : next }));

  const { person: me } = useAuth();
  const [draftComment, setDraftComment] = useState("");

  const postComment = () => {
    const txt = draftComment.trim();
    if (!txt) return;
    const entry = {
      id: "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
      authorId: me?.id ?? null,
      who: me?.short || initials(me?.name) || "ME",
      role: me?.name || "You",
      ts: new Date().toISOString(),
      txt,
    };
    updateSlice("comments")(arr => [...(arr || []), entry]);
    setDraftComment("");
  };

  const deleteComment = (id) => {
    updateSlice("comments")(arr => (arr || []).filter(c => c.id !== id));
  };

  /* Footage Brain search modal state */
  const [searchModalOpen, setSearchModalOpen] = useState(false);

  /* Get attached footage for this reel from store */
  const { attachedFootage } = useWorkflow();
  const reelAttachedFootage = attachedFootage.filter(f => f.reel_id === current.id);

  const handleAttachFootage = (footage) => {
    actions.addAttachedFootage(footage);
    // Modal stays open so the user can keep adding multiple clips.
    // Close via the × button or by clicking the backdrop.
  };

  const handleRemoveFootage = (footageId) => {
    actions.removeAttachedFootage(footageId);
  };

  /* "Current reel state" — a URL pointing to the latest cut/preview/Frame.io
     draft. Stored on reel.attachUrl (the existing column). Prompt to set,
     click to open if already set. */
  const reelStateUrl = stored?.attachUrl || "";
  const editReelStateUrl = () => {
    const next = window.prompt(
      "Paste the URL to this reel's current state (Frame.io draft, Drive folder, etc.)",
      reelStateUrl
    );
    if (next === null) return;
    const trimmed = next.trim();
    if (stored && stored.attachUrl !== trimmed) {
      actions.updateReel(current.id, { attachUrl: trimmed });
    }
  };

  /* Reference links saved at create-time (audio + inspiration). */
  const audioUrl = stored?.audio || "";
  const inspoUrl = stored?.inspo || "";

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1 style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span>{current.title || "Untitled reel"}</span>
            <span style={{
              fontFamily: "var(--f-mono)",
              fontSize: 13,
              fontWeight: 400,
              color: "var(--fg-mute)",
              letterSpacing: "0.04em",
            }}>{current.id}</span>
          </h1>
          {(audioUrl || inspoUrl) && (
            <div className="sub" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {audioUrl && (
                <a href={audioUrl} target="_blank" rel="noopener noreferrer"
                   style={{ color: "var(--c-cyan, var(--accent))", textDecoration: "none" }}>
                  ♪ Music ↗
                </a>
              )}
              {inspoUrl && (
                <a href={inspoUrl} target="_blank" rel="noopener noreferrer"
                   style={{ color: "var(--c-cyan, var(--accent))", textDecoration: "none" }}>
                  ✦ Inspiration ↗
                </a>
              )}
            </div>
          )}
        </div>
        <div className="actions" style={{ alignItems: "center", gap: 8 }}>
          {reelStateUrl ? (
            <DPill onClick={() => window.open(reelStateUrl, "_blank")}
                   title={reelStateUrl}>
              ↗ Current reel state
            </DPill>
          ) : null}
          <DPill onClick={editReelStateUrl}>
            {reelStateUrl ? "Edit link" : "+ Current reel state"}
          </DPill>
          <DPill onClick={() => setSearchModalOpen(true)} primary>+ Search Footage</DPill>
        </div>
      </div>

      {/* Footage Brain Search Modal */}
      {searchModalOpen && (
        <FootageBrainSearch
          reelId={current.id}
          onAttach={handleAttachFootage}
          onClose={() => setSearchModalOpen(false)}
          attachedIds={reelAttachedFootage.map(f => f.footage_file_id)}
        />
      )}

      <div className="detail-grid">
        {/* ===== LEFT — attached footage ===== */}
        <div className="detail-col">
          <Card
            title="Attached Footage"
            right={<span className="count-tag cyan">{reelAttachedFootage.length}</span>}
            footLeft="Footage items linked to this reel"
          >
            <AttachedFootageList
              items={reelAttachedFootage}
              onRemove={handleRemoveFootage}
            />
            <div style={{ marginTop: 10 }}>
              <DPill onClick={() => setSearchModalOpen(true)}>
                {reelAttachedFootage.length === 0 ? "+ Add Footage" : "+ Add more"}
              </DPill>
            </div>
          </Card>
        </div>

        {/* ===== CENTER — blueprint + feedback ===== */}
        <div className="detail-col center">
          {/* 1) Reel Blueprint */}
          <div className="blueprint">
            <div className="blueprint-head">
              <div className="h">Reel Blueprint</div>
              <div className="meta">Logline · script · voiceover — your working notes</div>
            </div>
            <div className="blueprint-tabs">
              <div className={"blueprint-tab " + (blueprintTab === "logline" ? "active" : "")}
                   onClick={() => setBlueprintTab("logline")}>Logline</div>
              <div className={"blueprint-tab " + (blueprintTab === "script" ? "active" : "")}
                   onClick={() => setBlueprintTab("script")}>Script / shot plan</div>
              <div className={"blueprint-tab " + (blueprintTab === "vo" ? "active" : "")}
                   onClick={() => setBlueprintTab("vo")}>Voiceover</div>
            </div>
            <div className="blueprint-body">
              <div className="col-label">
                {blueprintTab === "logline" ? "Logline" : blueprintTab === "vo" ? "VO read" : "Beat plan"}
              </div>
              <div>
                {blueprintTab === "logline" && (
                  <textarea
                    value={logline}
                    onChange={e => setLogline(e.target.value)}
                    onBlur={() => saveIfChanged("logline", logline)}
                    placeholder="One sentence: what is this reel?"
                  />
                )}
                {blueprintTab === "script" && (
                  <textarea
                    className="script"
                    value={script}
                    onChange={e => setScript(e.target.value)}
                    onBlur={() => saveIfChanged("script", script)}
                    placeholder="Beat-by-beat plan, shot list, captions…"
                  />
                )}
                {blueprintTab === "vo" && (
                  <textarea
                    value={vo}
                    onChange={e => setVo(e.target.value)}
                    onBlur={() => saveIfChanged("vo", vo)}
                    placeholder="Voiceover text + delivery notes"
                  />
                )}
                <div style={{ marginTop: 8, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)" }}>
                  {stored ? "saves on blur · synced across devices" : "not persisted · open this reel via Pipeline to enable saves"}
                </div>
              </div>
            </div>
          </div>

          {/* 2) Comments + feedback */}
          <Card
              title="Comments + feedback"
              right={<span className="count-tag">{comments.length}</span>}
              footLeft="Conversation layer · persisted per reel"
            >
              {comments.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--fg-dim)", padding: "6px 0" }}>
                  No comments yet — leave the first note below.
                </div>
              )}
              {comments.map((c) => {
                const mine = me && c.authorId && c.authorId === me.id;
                if (c.system) {
                  /* System-authored audit entry (e.g. a stage
                     transition). Renders as a single dim line so
                     it doesn't visually compete with human chat. */
                  return (
                    <div key={c.id} className="comment-system">
                      <span className="dot">●</span>
                      <span className="txt">{c.txt}</span>
                      <span className="ts">{formatCommentTs(c.ts)}</span>
                    </div>
                  );
                }
                return (
                  <div className="comment" key={c.id}
                       style={{ position: "relative" }}>
                    <div className={"avatar " + String(c.who || "").toLowerCase()}>{c.who}</div>
                    <div>
                      <div className="who">
                        <b>{c.role}</b>
                        <span className="ts">{formatCommentTs(c.ts)}</span>
                        {mine && (
                          <span
                            onClick={() => deleteComment(c.id)}
                            title="Delete this comment"
                            style={{
                              marginLeft: "auto",
                              fontFamily: "var(--f-mono)",
                              fontSize: 10,
                              color: "var(--fg-dim)",
                              cursor: "pointer",
                            }}
                          >×</span>
                        )}
                      </div>
                      <div className="txt">{c.txt}</div>
                    </div>
                  </div>
                );
              })}
              <div style={{
                marginTop: 10,
                border: "1px dashed var(--line-hard)",
                borderRadius: 6,
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}>
                <textarea
                  value={draftComment}
                  onChange={e => setDraftComment(e.target.value)}
                  onKeyDown={e => {
                    // Enter posts, Shift+Enter inserts a newline.
                    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                      e.preventDefault();
                      postComment();
                    }
                  }}
                  placeholder={stored
                    ? "Leave feedback or progress note… (Enter to post · Shift+Enter for new line)"
                    : "Open this reel via Pipeline to post feedback."}
                  disabled={!stored}
                  style={{
                    background: "var(--bg-2)",
                    border: "1px dashed var(--line-hard)",
                    borderRadius: 4,
                    color: "var(--fg)",
                    fontFamily: "var(--f-sans)",
                    fontSize: 12,
                    padding: "6px 9px",
                    resize: "vertical",
                    minHeight: 52,
                    outline: "none",
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 10.5, color: "var(--fg-dim)", fontFamily: "var(--f-mono)" }}>
                    posting as <b style={{ color: "var(--fg)" }}>{me?.name || "you"}</b>
                  </div>
                  <div style={{ flex: 1 }} />
                  <DPill
                    primary
                    onClick={postComment}
                    style={{ opacity: draftComment.trim() && stored ? 1 : 0.5 }}
                  >Post</DPill>
                </div>
              </div>
            </Card>
        </div>
      </div>
    </div>
  );
}

export { ReelDetail };
