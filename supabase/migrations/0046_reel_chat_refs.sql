-- Reel ↔ team-chat link refs.
-- Team chat is an iframe embed of Rocket.Chat (chat.footagebrain.com) — the app
-- has NO access to chat messages. This table is the lightweight app-side layer:
-- it records that a reel was discussed in a given Rocket.Chat channel (and, when
-- known, the deep-link to the message), so the reel card can badge + link back
-- to the conversation. The actual messages live in Rocket.Chat.
-- Modeled on 0044_reel_dna.sql (RLS triad + realtime publication conventions).
-- Apply via the Supabase SQL editor or `npm run migrate:apply`.

-- ── reel_chat_refs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reel_chat_refs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id      text        NOT NULL,                 -- reels.id (text 'REEL-NNN')
  channel      text,                                 -- Rocket.Chat channel name
  message_url  text,                                 -- optional deep-link to the message
  note         text,
  created_by   text,                                 -- people.id (text like 'paul')
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reel_chat_refs_reel_idx ON public.reel_chat_refs (reel_id);

ALTER TABLE public.reel_chat_refs ENABLE ROW LEVEL SECURITY;

-- The whole team links reels to chat, so reads + writes are open to any
-- authenticated user (mirrors reel_dna). Owner keeps god-mode for cleanup.
-- DROP-then-CREATE so this migration is safely re-runnable (the runner has no
-- transaction wrapping, and CREATE POLICY is not idempotent on its own).
DROP POLICY IF EXISTS "auth_read_reel_chat_refs"   ON public.reel_chat_refs;
DROP POLICY IF EXISTS "auth_insert_reel_chat_refs" ON public.reel_chat_refs;
DROP POLICY IF EXISTS "auth_update_reel_chat_refs" ON public.reel_chat_refs;
DROP POLICY IF EXISTS "owner_all_reel_chat_refs"   ON public.reel_chat_refs;

CREATE POLICY "auth_read_reel_chat_refs"
  ON public.reel_chat_refs FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "auth_insert_reel_chat_refs"
  ON public.reel_chat_refs FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "auth_update_reel_chat_refs"
  ON public.reel_chat_refs FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "owner_all_reel_chat_refs"
  ON public.reel_chat_refs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.people
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Realtime so a "Discuss" link from one teammate appears live on the reel card
-- for everyone. Guarded: ALTER PUBLICATION ... ADD TABLE errors if the table is
-- already a member, so only add it when it isn't (keeps the migration re-runnable).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'reel_chat_refs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reel_chat_refs;
  END IF;
END $$;
