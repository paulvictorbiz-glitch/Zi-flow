-- 0031_whatsapp_messages.sql
-- Stores incoming WhatsApp Business messages for the unified Inbox tab.
-- The Hetzner backend webhook (/api/auth/whatsapp/webhook) inserts rows via the
-- service_role key; authenticated dashboard users read them for the Inbox.
--
-- Apply manually in the Supabase SQL editor (project kjruhbaahqkuajseoojn).
-- NOT auto-applied — review before running against the shared prod DB.

create table if not exists public.whatsapp_messages (
  id            text primary key,
  from_number   text not null,
  from_name     text,
  body          text,
  media_type    text,
  media_url     text,
  media_id      text,
  timestamp     timestamptz not null,
  wa_account_id text,
  received_at   timestamptz default now()
);

alter table public.whatsapp_messages enable row level security;

create policy "service_role insert" on public.whatsapp_messages
  for insert to service_role with check (true);

create policy "authenticated select" on public.whatsapp_messages
  for select to authenticated using (true);
