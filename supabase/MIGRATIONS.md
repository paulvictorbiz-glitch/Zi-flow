# Database migrations

Migrations are plain `.sql` files in [`migrations/`](migrations/), applied to the
shared Supabase DB (`kjruhbaahqkuajseoojn`). Historically they were pasted into
the Supabase SQL editor by hand with **no record of what had run** — this setup
fixes that with a `schema_migrations` tracking table and a status/apply script.

> **Dev and prod share one database.** There is no separate staging DB. Applying
> a migration affects the live site immediately.

---

## One-time setup

1. Open the Supabase SQL editor and run **`_migration_bootstrap.sql`** once.
   It creates `public.schema_migrations` and the `exec_sql` helper.

2. **Backfill history.** Because the DB already has ~all of these applied, tell
   the tracker they're done so it doesn't try to re-run data migrations
   (e.g. `0011_reset_reels`, `0012_delete_stuck_seed_reels`, the email fixes).
   Paste this into the SQL editor — it marks **every current file** as applied:

   ```sql
   insert into public.schema_migrations (version)
   select unnest(array[
     -- paste the output of `npm run migrate` (the filenames) here,
     -- or just mark everything that is genuinely already in the DB
   ]) on conflict (version) do nothing;
   ```

   The easy path: run `npm run migrate` first to print the filename list, then
   `--mark` anything that is truly already applied. Going forward you won't need
   this — new files just show up as `pending`.

---

## Day-to-day

```bash
npm run migrate          # show applied / pending / changed-after-apply
npm run migrate:apply    # run every pending migration, recording each one
npm run migrate:manifest # rebuild the manifest the Monitor button checks against
```

After adding/editing a migration, run `npm run migrate:manifest` and redeploy
(`vercel --prod`) so the Monitor → Supabase card "Check migrations" button is
comparing against the current file set.

## Check from the app (no terminal)

Monitor tab → **Supabase** card → pink **"Check migrations"** button. It compares
`api/monitor/migrations.manifest.json` against the live `schema_migrations` table
and logs either "all match" or the specific missing / changed / orphaned files
with a one-line fix for each. Copy that log into Claude Code to act on it.

Mark a file as applied **without** running it (for backfilling history, or when
you applied it by hand in the editor):

```bash
node --env-file=.env.local scripts/migrate.mjs --mark 0042_workflow_insights.sql
```

---

## Conventions

- **Filename = version.** The full filename is the tracked id, so the two
  duplicate-numbered pairs (`0015_*`, `0036_*`) are each tracked separately and
  neither gets skipped. `npm run migrate` warns about duplicate numbers.
- **New migrations:** next number is `0044_…`. Make them idempotent
  (`create … if not exists`, guarded `alter`) so a re-run is harmless.
- **Don't edit an applied file.** The script flags `[ CHANGED ]` when a file's
  checksum no longer matches what was recorded — add a new migration instead.
- These migrations affect the live DB. Deploys are still `vercel --prod`
  (separate concern — see CLAUDE.md).
