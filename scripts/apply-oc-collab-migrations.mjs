#!/usr/bin/env node
/**
 * SCOPED one-off — apply ONLY the OpenCut collab migrations 0095 + 0096, in order.
 *
 *   node --env-file=.env.local scripts/apply-oc-collab-migrations.mjs
 *
 * Why a scoped script (CLAUDE.md rule #8d): `npm run migrate:apply` would ALSO fire the
 * intentionally held-back pending files (0086 / 0092 / 0093). This applies EXACTLY the two
 * oc_* migrations and records them — nothing else. Mirrors migrate.mjs applyOne()
 * (exec_sql RPC + schema_migrations upsert). `exec_sql` is atomic per file (one plpgsql txn),
 * and both migrations are idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS), so a re-run is safe.
 *
 * Requires SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY in .env.local
 * (the same env the existing migrate.mjs uses). DELETE this file after a successful apply.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

// Apply in THIS order. 0096 has no FK to oc_projects, but 0095 is its logical/data prerequisite.
const TARGETS = ["0095_oc_projects.sql", "0096_oc_locks.sql"];

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "\n  Missing env vars. Needs SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.\n" +
    "  Run via:  node --env-file=.env.local scripts/apply-oc-collab-migrations.mjs\n"
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const sha = (s) => createHash("sha256").update(s).digest("hex");

async function applyOne(version) {
  const body = readFileSync(join(MIGRATIONS_DIR, version), "utf8");
  process.stdout.write(`  → ${version} ... `);
  const { error: execErr } = await supabase.rpc("exec_sql", { sql: body });
  if (execErr) throw new Error(`Failed running ${version}: ${execErr.message}`);
  const { error: recErr } = await supabase
    .from("schema_migrations")
    .upsert({ version, checksum: sha(body), applied_at: new Date().toISOString() });
  if (recErr) throw new Error(`Ran ${version} but failed to record it: ${recErr.message}`);
  console.log("ok");
}

async function main() {
  console.log("\n  Applying scoped OpenCut collab migrations (0095, 0096) — NOT migrate:apply.\n");
  for (const version of TARGETS) {
    await applyOne(version);
  }

  // Existence check (service-role can read regardless of RLS).
  console.log("\n  Verifying tables exist...");
  for (const table of ["oc_projects", "oc_locks"]) {
    const { error } = await supabase.from(table).select("*", { head: true, count: "exact" });
    console.log(`    ${table}: ${error ? "MISSING / error — " + error.message : "OK"}`);
  }

  console.log(
    "\n  Done. Now verify under a REAL authenticated session (anon-key probes silently pass\n" +
    "  `to authenticated` policies). Then delete this script.\n"
  );
}

main().catch((e) => {
  console.error("\n  Error:", e.message, "\n");
  process.exit(1);
});
