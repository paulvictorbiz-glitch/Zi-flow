/* =========================================================
   Roles & permissions — Owner-only admin page.

   Two panels side-by-side:
     Left  — roles × capabilities matrix (tabs + actions per role)
     Right — team users (who has claimed a slot, add new editor)

   The `owner` column is shown read-only ("Full") — owner always has every
   capability and is the only role that can open this page, so the owner
   can never lock themselves out.

   Reached via the gear in the owner's avatar menu (app.jsx). Gating is
   evaluated against the active perspective, so the owner can verify a
   role's restricted view by switching perspective in the topbar.
   ========================================================= */

import React from "react";
import { usePermissions } from "../lib/permissions.jsx";
import { VIEW_CAPS, ACTION_CAPS, EDITABLE_ROLES } from "../lib/permissions-catalog.js";
import { ROLES } from "../lib/shared-data.jsx";
import { DPill } from "../components/components.jsx";
import { supabase } from "../lib/supabase-client.js";
import { useAuth } from "../auth.jsx";
import { useRoster } from "../lib/roster.jsx";
import {
  PLATFORMS,
  PLATFORM_BY_KEY,
  CONNECT_URLS,
  fetchConnections,
  runHealthChecks,
  deriveStatus,
} from "../lib/social-client.js";

/* =========================================================
   Permissions matrix (left panel)
   ========================================================= */

function Toggle({ on, onClick }) {
  return (
    <button
      onClick={onClick}
      title={on ? "Allowed — click to deny" : "Denied — click to allow"}
      style={{
        width: 54, padding: "4px 0",
        borderRadius: 12,
        border: "1px dashed " + (on ? "var(--c-cyan-soft)" : "var(--line-hard)"),
        background: on ? "rgba(107,214,224,0.10)" : "var(--bg-2)",
        color: on ? "var(--c-cyan)" : "var(--fg-dim)",
        fontFamily: "var(--f-mono)", fontSize: 10.5, letterSpacing: "0.08em",
        textTransform: "uppercase", cursor: "pointer",
        transition: "all .1s",
      }}>
      {on ? "On" : "Off"}
    </button>
  );
}

function RoleColumnHead() {
  const { peopleList } = useRoster();
  const editablePeople = peopleList.filter(p => p.role !== "owner");
  const ownerPerson    = peopleList.find(p => p.role === "owner");
  const gridCols = `minmax(180px, 1fr) 96px ${editablePeople.map(() => "96px").join(" ")}`;
  return (
    <div style={{ display: "grid", gridTemplateColumns: gridCols, alignItems: "end", gap: 8,
                  padding: "0 4px 8px", borderBottom: "1px dashed var(--line-hard)" }}>
      <div className="mono dim" style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        Capability
      </div>
      {/* Owner — always Full, read-only */}
      <div style={{ textAlign: "center" }}>
        <div className={"avatar-chip owner"} style={{ margin: "0 auto 4px" }}>
          {ownerPerson?.avatar}
        </div>
        <div style={{ fontSize: 11, color: "var(--fg)" }}>Owner</div>
        <div className="mono dim" style={{ fontSize: 9.5 }}>{ownerPerson?.short || ownerPerson?.name}</div>
      </div>
      {/* One column per non-owner person */}
      {editablePeople.map(p => (
        <div key={p.id} style={{ textAlign: "center" }}>
          <div className={"avatar-chip " + (p.role || "")} style={{ margin: "0 auto 4px" }}>
            {p.avatar}
          </div>
          <div style={{ fontSize: 11, color: "var(--fg)" }}>{p.short || p.name}</div>
          <div className="mono dim" style={{ fontSize: 9.5 }}>{p.role}</div>
        </div>
      ))}
    </div>
  );
}

function CapRow({ cap, kind }) {
  const { config, setCap, ensurePersonConfig } = usePermissions();
  const { peopleList } = useRoster();
  const editablePeople = peopleList.filter(p => p.role !== "owner");
  const gridCols = `minmax(180px, 1fr) 96px ${editablePeople.map(() => "96px").join(" ")}`;
  return (
    <div style={{ display: "grid", gridTemplateColumns: gridCols, alignItems: "center", gap: 8,
                  padding: "8px 4px", borderBottom: "1px dashed var(--line-soft, rgba(255,255,255,0.04))" }}>
      <div>
        <div style={{ fontSize: 12.5, color: "var(--fg)" }}>{cap.label}</div>
        {cap.hint && <div className="mono dim" style={{ fontSize: 10 }}>{cap.hint}</div>}
      </div>
      {/* Owner: always full */}
      <div style={{ textAlign: "center" }}>
        <span className="mono" style={{ fontSize: 10, color: "var(--c-amber)" }}>Full</span>
      </div>
      {/* One toggle per non-owner person */}
      {editablePeople.map(p => {
        // Person-level config takes priority; fall back to role-level
        const personVal = config[p.id]?.[kind]?.[cap.key];
        const roleVal   = config[p.role]?.[kind]?.[cap.key];
        const on = personVal !== undefined ? !!personVal
                 : roleVal   !== undefined ? !!roleVal
                 : true; // fail-open default
        return (
          <div key={p.id} style={{ display: "flex", justifyContent: "center" }}>
            <Toggle on={on} onClick={() => {
              ensurePersonConfig(p.id, p.role);
              setCap(p.id, kind, cap.key, !on);
            }} />
          </div>
        );
      })}
    </div>
  );
}

/* Keys of actions considered "destructive" — a separator is rendered after the last one. */
const DESTRUCTIVE_ACTION_KEYS = new Set(["deleteReel", "archiveReel"]);

function Section({ title, caps, kind }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
                                     color: "var(--fg-mute)", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ border: "1px dashed var(--line-hard)", borderRadius: 8, padding: "4px 12px",
                    background: "var(--bg-1)" }}>
        {caps.map((c, i) => {
          /* After the last destructive action, insert a labelled divider before workflow actions. */
          const isLastDestructive = kind === "actions"
            && DESTRUCTIVE_ACTION_KEYS.has(c.key)
            && (i + 1 >= caps.length || !DESTRUCTIVE_ACTION_KEYS.has(caps[i + 1].key));
          return (
            <React.Fragment key={c.key}>
              <CapRow cap={c} kind={kind} />
              {isLastDestructive && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  margin: "6px 0 2px",
                }}>
                  <div style={{ flex: 1, height: 0, borderTop: "1px dashed var(--line-hard)" }} />
                  <span className="mono dim" style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                    workflow actions
                  </span>
                  <div style={{ flex: 1, height: 0, borderTop: "1px dashed var(--line-hard)" }} />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

/* =========================================================
   Users panel (right panel)
   ========================================================= */

const ROLE_COLORS = {
  owner:    "var(--c-amber)",
  skilled:  "var(--c-cyan)",
  variant:  "var(--c-violet, #a78bfa)",
  reviewer: "var(--c-green)",
};

async function adminFetch(endpoint, token, body) {
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // fetch() itself rejected — server unreachable (no API backend running)
    throw new Error(`Can't reach the API backend. Run \`vercel dev\` on port 3001 (or use the deployed app). [${e.message}]`);
  }

  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("API route not found (404). Start `vercel dev` on port 3001 alongside `npm run dev`, or test on the deployed Vercel app.");
    }
    // 500/502/504 with no JSON body = the /api proxy target (vercel dev) isn't up
    if (!json.error && (res.status === 500 || res.status === 502 || res.status === 504)) {
      throw new Error(`API backend not running (HTTP ${res.status}). Start \`vercel dev\` on port 3001, or use the deployed Vercel app.`);
    }
    throw new Error(json.error || text || `Request failed (HTTP ${res.status})`);
  }
  return json;
}

/* Single row in the users table with expandable actions. */
function PersonRow({ person, token, onRefresh, onResult, trackerTs }) {
  const [mode, setMode]         = React.useState(null); // null | 'setup' | 'invite' | 'edit-email' | 'confirm-delete'
  const [emailInput, setEmail]  = React.useState(person.email || "");
  const [passInput, setPass]    = React.useState("");
  const [busy, setBusy]         = React.useState(false);
  const [err, setErr]           = React.useState(null);

  const isActive = !!person.user_id;

  const run = async (fn, successMsg) => {
    setBusy(true); setErr(null);
    try {
      const r = await fn();
      onResult?.(typeof successMsg === "function" ? successMsg(r) : successMsg, true);
      onRefresh(); setMode(null);
    }
    catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ borderBottom: "1px dashed var(--line-soft, rgba(255,255,255,0.04))", paddingBottom: 6, marginBottom: 2 }}>
      {/* Main row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 6 }}>
        {/* Avatar */}
        <div style={{
          width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--f-mono)", fontSize: 9,
          background: "var(--bg-2)", border: "1px dashed var(--line-hard)",
          color: ROLE_COLORS[person.role] || "var(--fg)",
        }}>
          {person.avatar || person.short || "??"}
        </div>

        {/* Name + email */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {person.name}
          </div>
          <div className="mono dim" style={{ fontSize: 9.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {person.email || "—"}
          </div>
          {trackerTs !== undefined && (
            <div style={{ fontSize: 9, fontFamily: "var(--f-mono)",
                          color: trackerTs ? "var(--c-green)" : "var(--fg-mute)",
                          marginTop: 1 }}>
              {trackerTs
                ? "● tracker · " + new Date(trackerTs).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                : "○ tracker not seen"}
            </div>
          )}
        </div>

        {/* Status dot */}
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div className="mono" style={{ fontSize: 9, color: isActive ? "var(--c-green)" : "var(--fg-mute)" }}>
            {isActive ? "● active" : "○ unclaimed"}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
          {isActive ? (
            <>
              <IconBtn
                title="Change email"
                active={mode === "edit-email"}
                onClick={() => { setEmail(person.email || ""); setMode(mode === "edit-email" ? null : "edit-email"); setErr(null); }}
              >✉</IconBtn>
              <IconBtn
                title="Delete account"
                danger
                active={mode === "confirm-delete"}
                onClick={() => { setMode(mode === "confirm-delete" ? null : "confirm-delete"); setErr(null); }}
              >✕</IconBtn>
            </>
          ) : (
            <IconBtn
              title="Set up account (email + password)"
              active={mode === "setup"}
              onClick={() => { setEmail(person.email || ""); setPass(""); setMode(mode === "setup" ? null : "setup"); setErr(null); }}
            >set up</IconBtn>
          )}
        </div>
      </div>

      {/* Expanded: set up account with password (works on free tier, no email) */}
      {mode === "setup" && (
        <div style={expandStyle}>
          <div className="mono dim" style={{ fontSize: 9.5, marginBottom: 6 }}>
            Set an email + password for <b style={{ color: "var(--fg)" }}>{person.name}</b>. They sign in
            directly — no confirmation email needed. Share the password with them.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <input
              type="email" required
              placeholder="Email address"
              value={emailInput}
              onChange={e => setEmail(e.target.value)}
              style={{ ...inputStyle, fontSize: 11, padding: "5px 7px" }}
            />
            <input
              type="text" required
              placeholder="Password (min 6 chars)"
              value={passInput}
              onChange={e => setPass(e.target.value)}
              style={{ ...inputStyle, fontSize: 11, padding: "5px 7px" }}
            />
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <ActionBtn busy={busy} onClick={() => run(
                () => adminFetch("/api/admin/activate-slot", token, { peopleId: person.id, email: emailInput, password: passInput }),
                (r) => r.emailSent
                  ? `${person.name}'s account created — login emailed to ${emailInput}`
                  : `${person.name}'s account created (email not sent${r.emailError ? `: ${r.emailError}` : ""}). Login → ${emailInput} / ${passInput} — copy this and share it.`
              )}>
                {busy ? "…" : "Create account"}
              </ActionBtn>
              <button type="button" onClick={() => { setMode("invite"); setErr(null); }} style={linkBtnStyle}>
                or send email invite
              </button>
            </div>
          </div>
          {err && <ErrMsg>{err}</ErrMsg>}
        </div>
      )}

      {/* Expanded: invite by email (needs custom SMTP in Supabase) */}
      {mode === "invite" && (
        <div style={expandStyle}>
          <div className="mono dim" style={{ fontSize: 9.5, marginBottom: 4 }}>
            Emails an invite link via Resend — the member clicks it, sets their own password, then
            claims their slot. <b style={{ color: "var(--c-amber)" }}>External recipients need a verified
            Resend domain.</b>
          </div>
          <div style={{ display: "flex", gap: 5 }}>
            <input
              type="email" required
              placeholder="Email address"
              value={emailInput}
              onChange={e => setEmail(e.target.value)}
              style={{ ...inputStyle, flex: 1, fontSize: 11, padding: "5px 7px" }}
            />
            <ActionBtn busy={busy} onClick={() => run(
              () => adminFetch("/api/admin/invite-user", token, { peopleId: person.id, email: emailInput }),
              `Invite email sent to ${emailInput}`
            )}>
              {busy ? "…" : "Send"}
            </ActionBtn>
          </div>
          <button type="button" onClick={() => { setPass(""); setMode("setup"); setErr(null); }} style={{ ...linkBtnStyle, marginTop: 5 }}>
            ← back to password setup
          </button>
          {err && <ErrMsg>{err}</ErrMsg>}
        </div>
      )}

      {/* Expanded: edit email */}
      {mode === "edit-email" && (
        <div style={expandStyle}>
          <div style={{ display: "flex", gap: 5 }}>
            <input
              type="email" required
              value={emailInput}
              onChange={e => setEmail(e.target.value)}
              style={{ ...inputStyle, flex: 1, fontSize: 11, padding: "5px 7px" }}
            />
            <ActionBtn busy={busy} onClick={() => run(
              () => adminFetch("/api/admin/update-email", token, { peopleId: person.id, newEmail: emailInput }),
              `${person.name}'s email updated to ${emailInput}`
            )}>
              {busy ? "…" : "Save"}
            </ActionBtn>
          </div>
          {err && <ErrMsg>{err}</ErrMsg>}
        </div>
      )}

      {/* Expanded: confirm delete */}
      {mode === "confirm-delete" && (
        <div style={{ ...expandStyle, border: "1px dashed var(--c-red, #f87171)", background: "rgba(248,113,113,0.04)" }}>
          <div style={{ fontSize: 11, color: "var(--fg-mute)", marginBottom: 6 }}>
            Delete <b style={{ color: "var(--fg)" }}>{person.name}</b>'s account?
            Their slot stays so they can be re-invited.
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <ActionBtn danger busy={busy} onClick={() => run(
              () => adminFetch("/api/admin/delete-user", token, { peopleId: person.id }),
              `${person.name}'s account deleted`
            )}>
              {busy ? "…" : "Delete account"}
            </ActionBtn>
            <ActionBtn onClick={() => setMode(null)}>Cancel</ActionBtn>
          </div>
          {err && <ErrMsg>{err}</ErrMsg>}
        </div>
      )}
    </div>
  );
}

/* Small icon / text button for row actions. */
function IconBtn({ children, onClick, active, danger, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: "2px 6px", fontSize: 9.5, fontFamily: "var(--f-mono)",
        letterSpacing: "0.04em",
        border: "1px dashed " + (danger ? "var(--c-red, #f87171)" : active ? "var(--c-cyan)" : "var(--line-hard)"),
        borderRadius: 3,
        background: active
          ? (danger ? "rgba(248,113,113,0.10)" : "rgba(107,214,224,0.10)")
          : "transparent",
        color: danger ? "var(--c-red, #f87171)" : active ? "var(--c-cyan)" : "var(--fg-mute)",
        cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function ActionBtn({ children, onClick, busy, danger }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        padding: "5px 10px", fontSize: 10, fontFamily: "var(--f-mono)",
        letterSpacing: "0.06em", textTransform: "uppercase",
        border: "1px dashed " + (danger ? "var(--c-red, #f87171)" : "var(--c-cyan)"),
        borderRadius: 3,
        background: danger ? "rgba(248,113,113,0.08)" : "rgba(107,214,224,0.08)",
        color: danger ? "var(--c-red, #f87171)" : "var(--c-cyan)",
        cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function ErrMsg({ children }) {
  return (
    <div style={{ fontSize: 10.5, color: "var(--c-red, #f87171)", fontFamily: "var(--f-mono)",
                  marginTop: 5, padding: "4px 6px",
                  border: "1px dashed var(--c-red, #f87171)", borderRadius: 3 }}>
      {children}
    </div>
  );
}

const expandStyle = {
  marginTop: 6, padding: "8px 10px",
  border: "1px dashed var(--line-hard)", borderRadius: 4,
  background: "var(--bg-2)",
};

const linkBtnStyle = {
  background: "none", border: "none", padding: 0,
  color: "var(--fg-mute)", fontFamily: "var(--f-mono)", fontSize: 9.5,
  textDecoration: "underline", cursor: "pointer",
};

function AddEditorForm({ token, onSuccess, onResult }) {
  const [name, setName]     = React.useState("");
  const [email, setEmail]   = React.useState("");
  const [password, setPass] = React.useState("");
  const [role, setRole]     = React.useState("skilled");
  const [busy, setBusy]     = React.useState(false);
  const [err, setErr]       = React.useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      if (!token) throw new Error("You must be signed in");
      const r = await adminFetch("/api/admin/create-user", token, { email: email.trim(), password, name: name.trim(), role });
      const who = name.trim();
      onResult?.(
        r.emailSent
          ? `${who}'s account created — login emailed to ${email.trim()}`
          : `${who}'s account created (email not sent${r.emailError ? `: ${r.emailError}` : ""}). Login → ${email.trim()} / ${password} — copy this and share it.`,
        true
      );
      setName(""); setEmail(""); setPass(""); setRole("skilled");
      onSuccess?.();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--line-hard)" }}>
      <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
        Add new team member
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <input required placeholder="Full name" value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
        <input required type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} />
        <input required type="password" placeholder="Password (min 6 chars)" minLength={6} value={password} onChange={e => setPass(e.target.value)} style={inputStyle} />
        <select value={role} onChange={e => setRole(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
          {EDITABLE_ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        {err && <ErrMsg>{err}</ErrMsg>}
        <button type="submit" disabled={busy} style={addBtnStyle}>{busy ? "Creating…" : "Create account"}</button>
      </div>
    </form>
  );
}

/* =========================================================
   Social accounts panel (OAuth status)

   Owner-only view of every linked platform's connection health, the
   last error returned by the platform API, and a Connect / Reconnect
   entry point. Reads from social-client.js (live from app_settings,
   tokens stay server-side). "Check now" runs a live health probe
   (Facebook today) and persists the result back to Supabase.
   ========================================================= */

const STATUS_META = {
  connected:    { dot: "●", color: "var(--c-green)",          label: "connected" },
  expiring:     { dot: "⚠", color: "var(--c-amber)",          label: "token expiring" },
  error:        { dot: "●", color: "var(--c-red, #f87171)",   label: "error" },
  disconnected: { dot: "○", color: "var(--fg-mute)",          label: "not connected" },
};

function relCheckedAt(iso) {
  if (!iso) return "never checked";
  const d = new Date(iso);
  if (isNaN(d)) return "never checked";
  return "checked " + d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function SocialAccountRow({ conn }) {
  const p = PLATFORM_BY_KEY[conn.platform];
  const status = deriveStatus(conn);
  const meta = STATUS_META[status] || STATUS_META.disconnected;
  const connectUrl = CONNECT_URLS[conn.platform];
  const isConnected = status === "connected" || status === "expiring";

  return (
    <div style={{ borderBottom: "1px dashed var(--line-soft, rgba(255,255,255,0.04))", paddingBottom: 8, marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8 }}>
        {/* Platform glyph chip */}
        <div style={{
          width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--f-mono)", fontSize: 12,
          background: "var(--bg-2)", border: "1px dashed " + (p?.color || "var(--line-hard)"),
          color: p?.color || "var(--fg)",
        }}>
          {p?.glyph || "?"}
        </div>

        {/* Name + handle / follower count */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {p?.label || conn.platform}
          </div>
          <div className="mono dim" style={{ fontSize: 9.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {isConnected
              ? `${conn.handle || conn.account || "—"}${conn.followers ? " · " + conn.followers.toLocaleString() + " followers" : ""}`
              : (conn.note || "—")}
          </div>
        </div>

        {/* Status + action */}
        <div style={{ flexShrink: 0, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <div className="mono" style={{ fontSize: 9, color: meta.color, whiteSpace: "nowrap" }}>
            {meta.dot} {meta.label}
          </div>
          {connectUrl ? (
            <IconBtn
              title={isConnected ? "Re-run the OAuth flow to refresh the token" : "Start the OAuth connect flow"}
              onClick={() => window.open(connectUrl, "_blank", "noopener")}
            >
              {isConnected ? "reconnect" : "connect"}
            </IconBtn>
          ) : (
            <span className="mono dim" style={{ fontSize: 8.5, whiteSpace: "nowrap" }} title={conn.note || ""}>
              flow not wired
            </span>
          )}
        </div>
      </div>

      {/* Last error (only when present) */}
      {conn.lastError && (
        <div style={{
          marginTop: 6, padding: "5px 8px",
          border: "1px dashed var(--c-red, #f87171)", borderRadius: 4,
          background: "rgba(248,113,113,0.05)",
          fontSize: 10, lineHeight: 1.4, fontFamily: "var(--f-mono)",
          color: "var(--c-red, #f87171)",
        }}>
          {conn.lastError}
        </div>
      )}

      {/* Last checked timestamp */}
      <div className="mono dim" style={{ fontSize: 8.5, marginTop: 4 }}>
        {relCheckedAt(conn.lastCheckedAt)}
      </div>
    </div>
  );
}

function SocialAccountsPanel() {
  const [conns, setConns]   = React.useState(() => PLATFORMS.map(p => ({ platform: p.key, connected: false, status: "disconnected" })));
  const [loading, setLoading] = React.useState(true);
  const [checking, setChecking] = React.useState(false);
  const [flash, setFlash]   = React.useState(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchConnections(supabase);
      // Keep stable PLATFORMS order even if the row set is partial.
      setConns(PLATFORMS.map(p => rows.find(r => r.platform === p.key) || { platform: p.key, connected: false, status: "disconnected" }));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const checkNow = async () => {
    setChecking(true); setFlash(null);
    try {
      const rows = await runHealthChecks(supabase);
      setConns(PLATFORMS.map(p => rows.find(r => r.platform === p.key) || { platform: p.key, connected: false, status: "disconnected" }));
      const errs = rows.filter(r => deriveStatus(r) === "error").length;
      setFlash({ ok: errs === 0, text: errs === 0 ? "All connected accounts healthy." : `${errs} account${errs === 1 ? "" : "s"} need attention.` });
      setTimeout(() => setFlash(null), 6000);
    } catch (e) {
      setFlash({ ok: false, text: e.message || String(e) });
    } finally {
      setChecking(false);
    }
  };

  const connectedCount = conns.filter(c => deriveStatus(c) === "connected" || deriveStatus(c) === "expiring").length;
  const errorCount     = conns.filter(c => deriveStatus(c) === "error").length;

  return (
    <div style={{
      minWidth: 300, maxWidth: 360,
      border: "1px dashed var(--line-hard)", borderRadius: 8,
      background: "var(--bg-1)", padding: "14px 16px",
      alignSelf: "start", marginTop: 16,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, color: "var(--fg)", fontWeight: 500 }}>Social accounts</div>
          {!loading && (
            <div className="mono dim" style={{ fontSize: 10 }}>
              {connectedCount} connected{errorCount ? " · " + errorCount + " error" + (errorCount === 1 ? "" : "s") : ""} · OAuth status
            </div>
          )}
        </div>
        <IconBtn title="Run a live health check on connected platforms" active={checking} onClick={checkNow}>
          {checking ? "…" : "check now"}
        </IconBtn>
      </div>

      {/* Result banner */}
      {flash && (
        <div style={{
          marginBottom: 10, padding: "7px 10px", borderRadius: 4, fontSize: 11, lineHeight: 1.45,
          fontFamily: "var(--f-mono)",
          border: "1px dashed " + (flash.ok ? "var(--c-green)" : "var(--c-red, #f87171)"),
          background: flash.ok ? "rgba(120,200,140,0.06)" : "rgba(248,113,113,0.06)",
          color: flash.ok ? "var(--c-green)" : "var(--c-red, #f87171)",
        }}>
          {flash.text}
        </div>
      )}

      {/* Rows */}
      {loading ? (
        <div className="mono dim" style={{ fontSize: 10.5, textAlign: "center", padding: "10px 0" }}>loading…</div>
      ) : (
        <div>
          {conns.map(c => <SocialAccountRow key={c.platform} conn={c} />)}
        </div>
      )}

      <div className="mono dim" style={{ fontSize: 9, lineHeight: 1.5, marginTop: 8 }}>
        Tokens are stored server-side (api.footagebrain.com) — never in the browser. Connect/Reconnect opens the platform's OAuth flow in a new tab.
      </div>
    </div>
  );
}

function UsersPanel() {
  const { session } = useAuth();
  const [people, setPeople]     = React.useState([]);
  const [loading, setLoading]   = React.useState(true);
  const [showForm, setShowForm] = React.useState(false);
  const [flash, setFlash]       = React.useState(null);
  const [trackerStatus, setTrackerStatus] = React.useState({});

  const token = session?.access_token;

  const showFlash = React.useCallback((text, ok = true) => {
    setFlash({ text, ok });
    setTimeout(() => setFlash(null), 8000);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("people")
      .select("id, name, short, role, email, user_id, avatar")
      .order("created_at", { ascending: true });
    setPeople(data || []);
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    if (!people.length) return;
    Promise.all(
      people.map(p =>
        supabase
          .from("capcut_activity")
          .select("ts")
          .eq("worker", p.id)
          .order("ts", { ascending: false })
          .limit(1)
          .then(({ data }) => ({ id: p.id, ts: data?.[0]?.ts || null }))
      )
    ).then(results => {
      const map = {};
      results.forEach(r => { map[r.id] = r.ts; });
      setTrackerStatus(map);
    });
  }, [people]);

  const active   = people.filter(p => p.user_id).length;
  const unclaimed = people.filter(p => !p.user_id).length;

  return (
    <div style={{
      minWidth: 300, maxWidth: 360,
      border: "1px dashed var(--line-hard)", borderRadius: 8,
      background: "var(--bg-1)", padding: "14px 16px",
      alignSelf: "start",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, color: "var(--fg)", fontWeight: 500 }}>Team accounts</div>
          {!loading && (
            <div className="mono dim" style={{ fontSize: 10 }}>
              {active} active · {unclaimed} unclaimed · free plan = 50k MAU
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <IconBtn title="Refresh" onClick={load}>↺</IconBtn>
          <IconBtn title="Add new member" active={showForm} onClick={() => setShowForm(s => !s)}>+ add</IconBtn>
        </div>
      </div>

      {/* Result banner */}
      {flash && (
        <div style={{
          marginBottom: 10, padding: "7px 10px", borderRadius: 4, fontSize: 11, lineHeight: 1.45,
          fontFamily: "var(--f-mono)",
          border: "1px dashed " + (flash.ok ? "var(--c-green)" : "var(--c-red, #f87171)"),
          background: flash.ok ? "rgba(120,200,140,0.06)" : "rgba(248,113,113,0.06)",
          color: flash.ok ? "var(--c-green)" : "var(--c-red, #f87171)",
        }}>
          {flash.text}
        </div>
      )}

      {/* Rows */}
      {loading ? (
        <div className="mono dim" style={{ fontSize: 10.5, textAlign: "center", padding: "10px 0" }}>loading…</div>
      ) : (
        <div>
          {people.map(p => (
            <PersonRow key={p.id} person={p} token={token} onRefresh={load} onResult={showFlash}
                       trackerTs={trackerStatus[p.id]} />
          ))}
        </div>
      )}

      {/* Add editor form */}
      {showForm && (
        <AddEditorForm token={token} onResult={showFlash} onSuccess={() => { setShowForm(false); load(); }} />
      )}
    </div>
  );
}

/* =========================================================
   Main page
   ========================================================= */

function RolesAdmin({ onBack }) {
  const { save, dirty, savedAt, resetAll } = usePermissions();
  const [flash, setFlash] = React.useState(false);

  const onSave = async () => {
    await save();
    setFlash(true);
    setTimeout(() => setFlash(false), 1800);
  };

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Roles &amp; permissions</h1>
          <div className="sub">
            Choose what each role sees (tabs) and can do (actions). Saved to Supabase — applies to all team members.
          </div>
        </div>
        <div className="actions">
          <DPill onClick={onBack}>← Back</DPill>
        </div>
      </div>

      {/* Two-column layout: permissions matrix + users panel */}
      <div style={{ padding: "0 22px 40px", display: "flex", gap: 24, alignItems: "flex-start" }}>

        {/* Left: permissions matrix */}
        <div style={{ flex: "1 1 0", minWidth: 0, maxWidth: 760 }}>
          {/* UI-gating disclosure */}
          <div style={{
            border: "1px dashed var(--c-amber-soft)", background: "rgba(245,194,102,0.05)",
            borderRadius: 6, padding: "10px 12px", fontSize: 11.5, lineHeight: 1.5,
            color: "var(--fg-mute)", margin: "4px 0 8px",
          }}>
            <b style={{ color: "var(--c-amber)" }}>UI-gating only.</b>{" "}
            These toggles hide tabs and buttons in the dashboard. They are <b>not</b> yet
            enforced at the database — a determined user could still bypass them via the API.
            True enforcement is a later phase. Changes save to <b>Supabase</b> and apply to all users.
          </div>
          <div className="mono dim" style={{ fontSize: 10.5, marginBottom: 4 }}>
            Tip: switch perspective in the top-right avatar to preview a role's restricted view.
          </div>

          <RoleColumnHead />
          <Section title="Views — tabs this role can open" caps={VIEW_CAPS} kind="views" />
          <Section title="Actions — what this role can do" caps={ACTION_CAPS} kind="actions" />

          {/* Save bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 22 }}>
            <DPill primary onClick={onSave}>Save changes</DPill>
            <DPill onClick={resetAll}>Reset to defaults</DPill>
            {dirty
              ? <span className="mono" style={{ fontSize: 10.5, color: "var(--c-amber)" }}>unsaved changes</span>
              : flash
                ? <span className="mono" style={{ fontSize: 10.5, color: "var(--c-green)" }}>✓ saved</span>
                : savedAt
                  ? <span className="mono dim" style={{ fontSize: 10.5 }}>
                      saved {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  : null}
          </div>
        </div>

        {/* Right: users panel + social accounts (OAuth status) */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch" }}>
          <UsersPanel />
          <SocialAccountsPanel />
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Inline styles for the users panel / add form
   ========================================================= */

const inputStyle = {
  background: "var(--bg-2)",
  border: "1px dashed var(--line-hard)",
  borderRadius: 4,
  padding: "7px 9px",
  color: "var(--fg)",
  fontFamily: "var(--f-sans)",
  fontSize: 12.5,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const addBtnStyle = {
  marginTop: 4,
  padding: "8px 12px",
  border: "1px solid var(--c-cyan)",
  background: "rgba(96,212,240,0.08)",
  color: "var(--fg)",
  fontFamily: "var(--f-mono)",
  fontSize: 11,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  borderRadius: 4,
  cursor: "pointer",
  width: "100%",
};

export { RolesAdmin };
