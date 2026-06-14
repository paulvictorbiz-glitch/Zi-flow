// Invite an unclaimed people slot by emailing a sign-up link via Resend.
//
// Unlike Supabase's built-in inviteUserByEmail (which needs custom SMTP
// configured in the Supabase dashboard), this generates the invite action
// link with the admin API and sends it ourselves through Resend — the same
// email channel the rest of the admin panel uses.
//
// The member clicks the link, sets their own password, lands signed in,
// then claims their slot on the identity screen.
//
// Body: { peopleId: string, email: string }

import { setCors, verifyOwner, parseBody } from "./_auth.js";
import { sendInviteEmail } from "./_email.js";

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

  const { peopleId, email } = parseBody(req);
  if (!peopleId || !email) return res.status(400).json({ error: "peopleId and email are required" });

  const trimmedEmail = email.trim().toLowerCase();

  // Reflect the invited address on the slot (no-op if it's already this value)
  const { data: person, error: updErr } = await supabase
    .from("people")
    .update({ email: trimmedEmail })
    .eq("id", peopleId)
    .select("name")
    .maybeSingle();
  if (updErr) return res.status(400).json({ error: updErr.message });

  // Generate the invite action link (this also creates the invited auth user)
  const origin = req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : "");
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: "invite",
    email: trimmedEmail,
    options: origin ? { redirectTo: origin } : undefined,
  });
  if (linkErr) return res.status(400).json({ error: linkErr.message });

  const actionLink = linkData?.properties?.action_link;
  if (!actionLink) return res.status(500).json({ error: "Could not generate invite link" });

  // Send the link via Resend
  const emailResult = await sendInviteEmail({
    to: trimmedEmail,
    name: person?.name,
    link: actionLink,
  });

  if (!emailResult.sent) {
    // Roll back the invited user so the slot can be retried cleanly
    const invitedId = linkData?.user?.id;
    if (invitedId) await supabase.auth.admin.deleteUser(invitedId);
    return res.status(400).json({ error: "Invite email failed: " + emailResult.error });
  }

  return res.status(200).json({ success: true });
}
