// Vercel serverless function — owner-only user creation.
//
// Required env vars (set in Vercel dashboard, NOT prefixed with VITE_):
//   SUPABASE_URL              — same URL as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY — from Supabase Project Settings → API → service_role

import { setCors, verifyOwner, parseBody } from "./_auth.js";
import { sendAccountEmail } from "./_email.js";

export default async function handler(req, res) {
  setCors(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let supabase;
  try {
    ({ supabase } = await verifyOwner(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message });
  }

  const { email, password, name, role } = parseBody(req);

  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: "email, password, name, and role are required" });
  }

  const validRoles = ["skilled", "variant", "reviewer", "owner"];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${validRoles.join(", ")}` });
  }

  // Create the auth user (email_confirm: true skips the confirmation email)
  const { data: newAuthUser, error: createErr } = await supabase.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
  });
  if (createErr) return res.status(400).json({ error: createErr.message });

  const uid = newAuthUser.user.id;

  // Derive a short avatar from initials
  const initials = name.trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);

  // Tone drives the avatar-chip color. Match the role palette used by the
  // original team so new members blend in (owner is never created here).
  const TONE_BY_ROLE = { skilled: "cyan", variant: "violet", reviewer: "green", owner: "amber" };

  // Insert the people row — use the auth UUID as the text ID for new users
  const { error: peopleErr } = await supabase.from("people").insert({
    id: uid,
    name: name.trim(),
    short: initials,
    role,
    avatar: initials,
    tone: TONE_BY_ROLE[role] || "cyan",
    email: email.trim().toLowerCase(),
    user_id: uid,
  });

  if (peopleErr) {
    // Roll back: remove the orphaned auth user
    await supabase.auth.admin.deleteUser(uid);
    return res.status(400).json({ error: peopleErr.message });
  }

  // Best-effort credentials email (does not roll back the account on failure)
  const origin = req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : "");
  const emailResult = await sendAccountEmail({
    to: email.trim().toLowerCase(),
    name: name.trim(),
    loginEmail: email.trim().toLowerCase(),
    password,
    loginUrl: origin,
  });

  return res.status(200).json({
    success: true,
    userId: uid,
    initials,
    emailSent: emailResult.sent,
    emailError: emailResult.error || null,
  });
}
