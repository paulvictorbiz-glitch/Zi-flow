/* =========================================================
   Auth — provider, sign-in/sign-up screen, identity-claim
   gate, and a sign-out hook.

   Model (per step-5 design choice "owner god-mode + UI gates"):
     · Anyone with valid credentials can sign in.
     · On first sign-in, the user claims one of the four person
       slots (paul / alex / sam / maya). This sets people.user_id.
     · The signed-in user's `role` (owner / skilled / variant /
       reviewer) is what gates the buttons in the UI.
     · The owner role gets god-mode: every action button shown
       on every dashboard works for them, regardless of which
       perspective the role-switcher is currently displaying.

   The DB enforces only "must be authenticated to write." It
   does NOT enforce role-specific writes — see the SQL comment
   in 0002_auth_and_people.sql for why.
   ========================================================= */

import React from "react";
import { supabase } from "./lib/supabase-client.js";

const AuthContext = React.createContext(null);

function AuthProvider({ children }) {
  const [session, setSession]     = React.useState(null);
  const [authLoaded, setAuthLoaded] = React.useState(false);
  const [person, setPerson]       = React.useState(null);
  const [personLoaded, setPersonLoaded] = React.useState(false);

  // Initial session + listener for live changes (other tabs etc.)
  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoaded(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Look up the person slot bound to this auth user.
  //
  // Critical: this depends on `userId`, NOT the raw session object.
  // Supabase fires onAuthStateChange("TOKEN_REFRESHED", ...) every
  // time a tab regains focus after the access token rotates — that
  // gives us a new session reference but the SAME user. Depending on
  // `session` here used to re-run the fetch on tab return, briefly
  // toggling personLoaded to false, which made IdentityGate unmount
  // the entire WorkflowProvider subtree (and any in-flight typing).
  const userId = session?.user?.id;
  React.useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setPerson(null);
      setPersonLoaded(true);
      return;
    }
    setPersonLoaded(false);
    supabase
      .from("people")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("Person lookup failed:", error);
        setPerson(data || null);
        setPersonLoaded(true);
      });
    return () => { cancelled = true; };
  }, [userId]);

  const value = React.useMemo(() => ({
    session,
    user: session?.user || null,
    authLoaded,
    personLoaded,
    person,
    /* Returns { error?: { message } } on failure. */
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signOut: () => supabase.auth.signOut(),
  }), [session, authLoaded, personLoaded, person]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/* ---------- Auth gate: shows sign-in screen until session exists ---------- */
function AuthGate({ children }) {
  const { session, authLoaded } = useAuth();
  if (!authLoaded) return <Splash label="signing in…" />;
  if (!session) return <SignInScreen />;
  return children;
}

/* ---------- Identity-claim gate: shown when signed-in user
              has no `people` slot bound to their auth uid ---------- */
function IdentityGate({ children }) {
  const { session, person, personLoaded } = useAuth();
  if (!session) return children; // outer AuthGate handles it
  if (!personLoaded) return <Splash label="loading identity…" />;
  if (!person) return <ClaimIdentityScreen />;
  return children;
}

/* =========================================================
   UI pieces
   ========================================================= */

function Splash({ label }) {
  return (
    <div style={splashStyle}>{label}</div>
  );
}

function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail]       = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy]         = React.useState(false);
  const [err, setErr]           = React.useState(null);

  // Sign-in only. Accounts are created by the owner in the
  // Roles & Permissions panel — there is no self-service signup.
  const submit = async (e) => {
    e?.preventDefault();
    setErr(null); setBusy(true);
    try {
      const { error } = await signIn(email.trim(), password);
      if (error) throw error;
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={authShellStyle}>
      <form style={authCardStyle} onSubmit={submit}>
        <div style={authBrandStyle}>
          <span style={authBrandDotStyle} />
          <span>Workflow</span>
        </div>
        <div style={authTitleStyle}>Sign in</div>
        <div style={authSubStyle}>
          Use the email and password you were given. Need access? Ask Paul to set you up.
        </div>

        <label style={authLabelStyle}>Email</label>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={authInputStyle}
        />

        <label style={authLabelStyle}>Password</label>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={authInputStyle}
        />

        {err && <div style={authErrStyle}>{err}</div>}

        <button type="submit" disabled={busy} style={authBtnPrimaryStyle}>
          {busy ? "…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

/* Shown when a signed-in auth user has no `people` slot bound to
   their uid. With self-signup removed, this only happens if an
   account exists in auth.users but the owner hasn't linked it to a
   team profile yet (e.g. an orphaned account). No slot-picker — the
   owner sets people up from the Roles & Permissions panel. */
function ClaimIdentityScreen() {
  const { user, signOut } = useAuth();

  return (
    <div style={authShellStyle}>
      <div style={authCardStyle}>
        <div style={authBrandStyle}>
          <span style={authBrandDotStyle} />
          <span>Workflow</span>
        </div>
        <div style={authTitleStyle}>Account not set up</div>
        <div style={authSubStyle}>
          You're signed in as <b style={{ color: "var(--fg)" }}>{user?.email}</b>, but this
          account isn't linked to a team profile yet. Ask Paul to add you in the
          Roles &amp; Permissions panel, then sign in again.
        </div>

        <div style={{ marginTop: 14, fontSize: 11, color: "var(--fg-mute)", fontFamily: "var(--f-mono)" }}>
          Wrong account?{" "}
          <a href="#" onClick={e => { e.preventDefault(); signOut(); }}>sign out</a>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Inline styles — kept here so styles.css doesn't have to
   carry auth concerns. Visual language matches the dashboard
   (dashed borders, mono labels, dark bg).
   ========================================================= */

const authShellStyle = {
  minHeight: "100vh",
  background: "var(--bg-0)",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: "40px 16px",
};
const authCardStyle = {
  width: 380, maxWidth: "100%",
  background: "var(--bg-1)",
  border: "1px dashed var(--line-hard)",
  borderRadius: 8,
  padding: "22px 24px 20px",
  display: "flex", flexDirection: "column", gap: 6,
  fontFamily: "var(--f-sans)",
};
const authBrandStyle = {
  display: "flex", alignItems: "center", gap: 8,
  fontFamily: "var(--f-mono)", fontSize: 13, color: "var(--fg-mute)",
  textTransform: "uppercase", letterSpacing: "0.14em",
  marginBottom: 14,
};
const authBrandDotStyle = {
  width: 8, height: 8, borderRadius: "50%", background: "var(--c-cyan)",
};
const authTitleStyle = {
  fontFamily: "var(--f-serif)", fontStyle: "italic",
  fontSize: 26, color: "var(--fg)", lineHeight: 1.15,
};
const authSubStyle = {
  fontSize: 12.5, color: "var(--fg-mute)", lineHeight: 1.45,
  marginTop: 4, marginBottom: 16,
};
const authLabelStyle = {
  fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-mute)",
  letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 10,
};
const authInputStyle = {
  background: "var(--bg-2)",
  border: "1px dashed var(--line-hard)",
  borderRadius: 4,
  padding: "9px 11px",
  color: "var(--fg)",
  fontFamily: "var(--f-sans)",
  fontSize: 13.5,
  marginTop: 4,
  outline: "none",
};
const authBtnPrimaryStyle = {
  marginTop: 16,
  padding: "10px 14px",
  border: "1px solid var(--c-cyan)",
  background: "rgba(96,212,240,0.08)",
  color: "var(--fg)",
  fontFamily: "var(--f-mono)",
  fontSize: 12,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  borderRadius: 4,
  cursor: "pointer",
};
const authToggleStyle = {
  marginTop: 14, fontSize: 12, color: "var(--fg-mute)",
  fontFamily: "var(--f-mono)", textAlign: "center",
};
const authErrStyle = {
  marginTop: 12,
  padding: "8px 10px",
  border: "1px dashed var(--c-red, #f87171)",
  color: "var(--c-red, #f87171)",
  fontSize: 12,
  fontFamily: "var(--f-mono)",
  borderRadius: 4,
};
const splashStyle = {
  display: "flex", alignItems: "center", justifyContent: "center",
  height: "100vh", color: "var(--fg-mute)",
  fontFamily: "var(--f-mono)", fontSize: 12,
  letterSpacing: "0.1em", textTransform: "uppercase",
  background: "var(--bg-0)",
};

export { AuthProvider, AuthGate, IdentityGate, useAuth };
