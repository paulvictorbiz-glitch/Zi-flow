-- =========================================================
--  Step 6a follow-up — persist the Reel Detail "Blueprint"
--  text fields and the attach link.
--
--  Before this, logline/script/vo/attachUrl in detail.jsx
--  were React component-local state — they reset on tab
--  switch and never synced anywhere. Adding columns so the
--  store's actions.updateReel can write them.
-- =========================================================

alter table public.reels
  add column if not exists script     text,
  add column if not exists vo         text,
  add column if not exists attach_url text;
