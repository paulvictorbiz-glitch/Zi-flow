// Owner-only password reset for an existing team member.
//
// Supabase Auth stores only a bcrypt hash — plaintext passwords can never
// be read back. This lets the owner SET a new password directly (no email,
// works on the free tier), so they stay in control of every account's login.
//
// Body: { peopleId: string, password: string }

import { setCors, verifyOwner, parseBody } from "./_auth.js";

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

  const { peopleId, password } = parseBody(req);
  if (!peopleId || !password) {
    return res.status(400).json({ error: "peopleId and password are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  // Look up the auth user_id from the people slot
  const { data: person, error: fetchErr } = await supabase
    .from("people")
    .select("user_id, name")
    .eq("id", peopleId)
    .maybeSingle();

  if (fetchErr || !person) return res.status(404).json({ error: "Person not found" });
  if (!person.user_id) return res.status(400).json({ error: "No linked account — set up the account first" });

  // Update the password on the auth user
  const { error: updateErr } = await supabase.auth.admin.updateUserById(person.user_id, { password });
  if (updateErr) return res.status(400).json({ error: updateErr.message });

  return res.status(200).json({ success: true });
}
