// DELETE a team member's Supabase auth account and unlink their people slot.
// The people row stays so the slot can be re-invited later.
// Body: { peopleId: string }

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

  const { peopleId } = parseBody(req);
  if (!peopleId) return res.status(400).json({ error: "peopleId is required" });

  // Get the people row so we know the auth user_id
  const { data: person, error: fetchErr } = await supabase
    .from("people")
    .select("user_id, name")
    .eq("id", peopleId)
    .maybeSingle();

  if (fetchErr || !person) return res.status(404).json({ error: "Person not found" });
  if (!person.user_id) return res.status(400).json({ error: "No linked account to delete" });

  // Delete the auth user
  const { error: deleteErr } = await supabase.auth.admin.deleteUser(person.user_id);
  if (deleteErr) return res.status(400).json({ error: deleteErr.message });

  // Unlink the people slot (keep name/email so it can be re-invited)
  await supabase.from("people").update({ user_id: null }).eq("id", peopleId);

  return res.status(200).json({ success: true });
}
