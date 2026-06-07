// Resend wrapper for transactional account emails (owner-only flows).
// Server-side only — RESEND_API_KEY never reaches the browser.
//
// Env:
//   RESEND_API_KEY — from resend.com/api-keys
//   RESEND_FROM    — verified sender, e.g. "Workflow <noreply@yourdomain.com>".
//                    Defaults to onboarding@resend.dev (Resend's shared test
//                    sender, which only delivers to the account owner until a
//                    domain is verified at resend.com/domains).

import { Resend } from "resend";

export function emailEnabled() {
  return !!process.env.RESEND_API_KEY;
}

/** Best-effort: returns { sent, error } — never throws, so a mail failure
    can't roll back an account that was already created. */
export async function sendAccountEmail({ to, name, loginEmail, password, loginUrl }) {
  if (!process.env.RESEND_API_KEY) {
    return { sent: false, error: "RESEND_API_KEY not set" };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM || "onboarding@resend.dev";
  const linkLine = loginUrl
    ? `<p>Sign in here: <a href="${loginUrl}">${loginUrl}</a></p>`
    : "";

  try {
    const { error } = await resend.emails.send({
      from,
      to,
      subject: "Your Workflow account is ready",
      html: `
        <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
          <h2 style="margin:0 0 12px">Welcome${name ? ", " + escapeHtml(name) : ""} 👋</h2>
          <p>An account has been created for you on the <b>Workflow</b> dashboard.</p>
          <table style="border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td style="padding:4px 0"><b>${escapeHtml(loginEmail)}</b></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Password</td><td style="padding:4px 0"><b>${escapeHtml(password)}</b></td></tr>
          </table>
          ${linkLine}
          <p style="color:#666;font-size:13px">For security, change your password after your first sign-in.</p>
        </div>`,
    });
    if (error) return { sent: false, error: error.message || String(error) };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e.message || String(e) };
  }
}

/** Best-effort invite email containing a Supabase action link the member
    clicks to set their own password. Returns { sent, error } — never throws. */
export async function sendInviteEmail({ to, name, link }) {
  if (!process.env.RESEND_API_KEY) {
    return { sent: false, error: "RESEND_API_KEY not set" };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM || "onboarding@resend.dev";

  try {
    const { error } = await resend.emails.send({
      from,
      to,
      subject: "You're invited to Workflow",
      html: `
        <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
          <h2 style="margin:0 0 12px">You're invited${name ? ", " + escapeHtml(name) : ""} 👋</h2>
          <p>You've been added to the <b>Workflow</b> dashboard. Click below to set your password and sign in.</p>
          <p style="margin:20px 0">
            <a href="${link}" style="background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">
              Accept invite &amp; set password
            </a>
          </p>
          <p style="color:#666;font-size:13px">If the button doesn't work, paste this link into your browser:<br>${link}</p>
        </div>`,
    });
    if (error) return { sent: false, error: error.message || String(error) };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e.message || String(e) };
  }
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
