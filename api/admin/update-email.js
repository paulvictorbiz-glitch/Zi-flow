// Change a team member's email in both auth.users and people.
// Body: { peopleId: string, newEmail: string }

import { setCors, verifyOwner, parseBody } from "./_auth.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let supabase;
  try {
    ({ supabase } = await verifyOwner(req));
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message });
  }

  const { peopleId, newEmail } = parseBody(req);
  if (!peopleId || !newEmail) return res.status(400).json({ error: "peopleId and newEmail are required" });

  const trimmedEmail = newEmail.trim().toLowerCase();

  // Get the people row
  const { data: person, error: fetchErr } = await supabase
    .from("people")
    .select("user_id")
    .eq("id", peopleId)
    .maybeSingle();

  if (fetchErr || !person) return res.status(404).json({ error: "Person not found" });

  // Update auth.users if they have a linked account
  if (person.user_id) {
    const { error: authErr } = await supabase.auth.admin.updateUserById(person.user_id, {
      email: trimmedEmail,
      email_confirm: true,
    });
    if (authErr) return res.status(400).json({ error: authErr.message });
  }

  // Always update people.email
  const { error: peopleErr } = await supabase
    .from("people")
    .update({ email: trimmedEmail })
    .eq("id", peopleId);

  if (peopleErr) return res.status(400).json({ error: peopleErr.message });

  return res.status(200).json({ success: true });
}
