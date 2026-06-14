#!/usr/bin/env node
/**
 * Migration status + apply tool for the Supabase DB.
 *
 *   node --env-file=.env.local scripts/migrate.mjs           # show status
 *   node --env-file=.env.local scripts/migrate.mjs --apply   # apply pending
 *   node --env-file=.env.local scripts/migrate.mjs --mark 0001_init.sql
 *                                                            # mark as applied WITHOUT running
 *
 * (Use the npm aliases: `npm run migrate` / `npm run migrate:apply`.)
 *
 * Requires the one-time bootstrap: paste supabase/_migration_bootstrap.sql
 * into the Supabase SQL editor first (creates schema_migrations + exec_sql).
 *
 * Treats the FULL filename as the migration version, so the duplicate-numbered
 * files (0015_*, 0036_*) are each tracked independently and neither is skipped.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "\n  Missing env vars. This script needs SUPABASE_URL (or VITE_SUPABASE_URL)\n" +
    "  and SUPABASE_SERVICE_ROLE_KEY in .env.local.\n\n" +
    "  Run it via:  node --env-file=.env.local scripts/migrate.mjs\n"
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const sha = (s) => createHash("sha256").update(s).digest("hex");

function localMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const body = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      return { version: file, body, checksum: sha(body) };
    });
}

async function appliedMigrations() {
  const { data, error } = await supabase
    .from("schema_migrations")
    .select("version, checksum, applied_at");
  if (error) {
    if (/relation .*schema_migrations.* does not exist|Could not find the table/i.test(error.message)) {
      console.error(
        "\n  schema_migrations table not found.\n" +
        "  Run the one-time bootstrap first: paste supabase/_migration_bootstrap.sql\n" +
        "  into the Supabase SQL editor, then re-run this command.\n"
      );
      process.exit(1);
    }
    throw error;
  }
  return new Map(data.map((r) => [r.version, r]));
}

async function applyOne(m) {
  const { error: execErr } = await supabase.rpc("exec_sql", { sql: m.body });
  if (execErr) throw new Error(`Failed running ${m.version}: ${execErr.message}`);
  const { error: recErr } = await supabase
    .from("schema_migrations")
    .upsert({ version: m.version, checksum: m.checksum, applied_at: new Date().toISOString() });
  if (recErr) throw new Error(`Ran ${m.version} but failed to record it: ${recErr.message}`);
}

async function main() {
  const args = process.argv.slice(2);
  const doApply = args.includes("--apply");
  const markIdx = args.indexOf("--mark");
  const markTarget = markIdx >= 0 ? args[markIdx + 1] : null;

  const local = localMigrations();
  const applied = await appliedMigrations();

  // --- duplicate-number warning -------------------------------------------
  const byNum = new Map();
  for (const m of local) {
    const num = m.version.slice(0, 4);
    byNum.set(num, (byNum.get(num) || []).concat(m.version));
  }
  const dupes = [...byNum.entries()].filter(([, files]) => files.length > 1);

  // --- explicit mark-as-applied (no run) ----------------------------------
  if (markTarget) {
    const m = local.find((x) => x.version === markTarget);
    if (!m) { console.error(`No such migration file: ${markTarget}`); process.exit(1); }
    const { error } = await supabase
      .from("schema_migrations")
      .upsert({ version: m.version, checksum: m.checksum, applied_at: new Date().toISOString() });
    if (error) { console.error("Failed:", error.message); process.exit(1); }
    console.log(`Marked ${m.version} as applied (without running it).`);
    return;
  }

  // --- status table --------------------------------------------------------
  const pending = [];
  const drifted = [];
  console.log("\n  Migration status\n  ----------------");
  for (const m of local) {
    const rec = applied.get(m.version);
    if (!rec) {
      pending.push(m);
      console.log(`  [ pending ]  ${m.version}`);
    } else if (rec.checksum && rec.checksum !== m.checksum) {
      drifted.push(m);
      console.log(`  [ CHANGED ]  ${m.version}  (file edited since it was applied)`);
    } else {
      console.log(`  [ applied ]  ${m.version}`);
    }
  }
  console.log(
    `\n  ${applied.size} applied · ${pending.length} pending · ${drifted.length} changed-after-apply\n`
  );

  if (dupes.length) {
    console.log("  ⚠ Duplicate migration numbers (each tracked independently):");
    for (const [num, files] of dupes) console.log(`      ${num}: ${files.join(", ")}`);
    console.log("");
  }

  if (!doApply) {
    if (pending.length) console.log("  Run `npm run migrate:apply` to apply pending migrations.\n");
    return;
  }

  // --- apply pending -------------------------------------------------------
  if (!pending.length) { console.log("  Nothing to apply.\n"); return; }
  console.log(`  Applying ${pending.length} pending migration(s)...\n`);
  for (const m of pending) {
    process.stdout.write(`  → ${m.version} ... `);
    await applyOne(m);
    console.log("ok");
  }
  console.log("\n  Done.\n");
}

main().catch((e) => {
  console.error("\n  Error:", e.message, "\n");
  process.exit(1);
});
