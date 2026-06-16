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

  // Only delete auth user if one is linked (unclaimed slots have no auth user)
  if (person.user_id) {
    const { error: deleteErr } = await supabase.auth.admin.deleteUser(person.user_id);
    if (deleteErr) return res.status(400).json({ error: deleteErr.message });
  }

  // Null out all references to this person across work records (preserve the records, just unassign)
  await supabase.from("reels").update({ owner: null }).eq("owner", peopleId);
  await supabase.from("reels").update({ prev_owner: null }).eq("prev_owner", peopleId);
  await supabase.from("review_lane_cards").update({ owner: null }).eq("owner", peopleId);
  await supabase.from("tasks").update({ from_person: null }).eq("from_person", peopleId);
  await supabase.from("tasks").update({ to_person: null }).eq("to_person", peopleId);
  await supabase.from("daily_tasks").update({ created_by: null }).eq("created_by", peopleId);
  await supabase.from("locations").update({ created_by: null }).eq("created_by", peopleId);
  await supabase.from("edit_sessions").update({ editor_id: null }).eq("editor_id", peopleId);
  await supabase.from("capcut_activity").update({ worker: null }).eq("worker", peopleId);
  // daily_tasks.assigned_to has ON DELETE CASCADE — auto-cleared when people row is deleted

  // Delete the people row entirely (removes them from roster, dropdowns, and all pickers)
  await supabase.from("people").delete().eq("id", peopleId);

  return res.status(200).json({ success: true });
}
