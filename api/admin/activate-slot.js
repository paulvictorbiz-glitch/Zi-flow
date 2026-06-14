// Activate an existing UNCLAIMED people slot by creating a confirmed
// auth account with an owner-set password and linking it to that slot.
//
// Works on the Supabase free tier with NO email/SMTP involved — the
// account is created already-confirmed, so the member just signs in
// with the email + password the owner gives them. Because the slot's
// user_id is set here, they skip the identity-claim screen entirely.
//
// Body: { peopleId: string, email: string, password: string }

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

  const { peopleId, email, password } = parseBody(req);
  if (!peopleId || !email || !password) {
    return res.status(400).json({ error: "peopleId, email, and password are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  // Confirm the slot exists and is unclaimed
  const { data: person, error: fetchErr } = await supabase
    .from("people")
    .select("user_id, name")
    .eq("id", peopleId)
    .maybeSingle();
  if (fetchErr || !person) return res.status(404).json({ error: "Slot not found" });
  if (person.user_id) return res.status(400).json({ error: "Slot already has an account" });

  const trimmedEmail = email.trim().toLowerCase();

  // Create a confirmed auth user (email_confirm skips the verification email)
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: trimmedEmail,
    password,
    email_confirm: true,
  });
  if (createErr) return res.status(400).json({ error: createErr.message });

  const uid = created.user.id;

  // Link the existing slot to the new auth user
  const { error: linkErr } = await supabase
    .from("people")
    .update({ user_id: uid, email: trimmedEmail })
    .eq("id", peopleId);

  if (linkErr) {
    await supabase.auth.admin.deleteUser(uid); // roll back the orphaned auth user
    return res.status(400).json({ error: linkErr.message });
  }

  // Best-effort: email the new member their login details. A mail failure
  // (e.g. Resend domain not verified) does NOT undo the created account.
  const origin = req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : "");
  const emailResult = await sendAccountEmail({
    to: trimmedEmail,
    name: person.name,
    loginEmail: trimmedEmail,
    password,
    loginUrl: origin,
  });

  return res.status(200).json({
    success: true,
    emailSent: emailResult.sent,
    emailError: emailResult.error || null,
  });
}
