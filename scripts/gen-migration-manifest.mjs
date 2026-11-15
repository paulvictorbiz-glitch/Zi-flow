#!/usr/bin/env node
/**
 * Regenerate api/monitor/migrations.manifest.json from supabase/migrations/*.sql.
 * The Monitor "Check Migrations" button compares this manifest against the
 * live schema_migrations table. Co-located under api/ so Vercel bundles it
 * with the serverless function (the supabase/ folder isn't shipped at runtime).
 *
 *   npm run migrate:manifest
 *
 * Run this whenever you add or edit a migration file (the migrate script
 * also refreshes it on apply).
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationChecksums } from "./migration-checksum.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const OUT = join(__dirname, "..", "api", "monitor", "migrations.manifest.json");

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
// checksum = LF-normalized (canonical); checksum_crlf matches rows applied from
// a CRLF checkout before line endings were normalized. See migration-checksum.mjs.
const migrations = files.map((file) => ({
  version: file,
  ...migrationChecksums(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
}));

writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), migrations }, null, 2) + "\n");
console.log(`Wrote ${migrations.length} migrations to ${OUT}`);
