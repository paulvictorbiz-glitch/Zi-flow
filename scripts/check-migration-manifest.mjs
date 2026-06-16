#!/usr/bin/env node
/**
 * Verify that api/monitor/migrations.manifest.json is in sync with
 * supabase/migrations/*.sql on disk.
 *
 * Exits 0 if the manifest is up to date.
 * Exits 1 if the manifest is stale (missing files or changed checksums).
 *
 *   node scripts/check-migration-manifest.mjs
 *   npm run migrate:check-manifest
 *
 * Run this before deploying to catch a forgotten `npm run migrate:manifest`.
 * It is also called automatically by `npm run migrate:apply`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const MANIFEST_PATH = join(__dirname, "..", "api", "monitor", "migrations.manifest.json");

// --- read disk files --------------------------------------------------------
const diskFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const diskMap = new Map(
  diskFiles.map((file) => {
    const content = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    return [file, createHash("sha256").update(content).digest("hex")];
  })
);

// --- read manifest ----------------------------------------------------------
let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
} catch (e) {
  console.error(`\n  ✗ Could not read migrations.manifest.json: ${e.message}`);
  console.error("    Run: npm run migrate:manifest\n");
  process.exit(1);
}

const manifestMap = new Map(
  (manifest.migrations || []).map((m) => [m.version, m.checksum])
);

// --- diff -------------------------------------------------------------------
const notInManifest = diskFiles.filter((f) => !manifestMap.has(f));
const checksumChanged = diskFiles.filter(
  (f) => manifestMap.has(f) && manifestMap.get(f) !== diskMap.get(f)
);
const orphaned = [...manifestMap.keys()].filter((v) => !diskMap.has(v));

const issues = notInManifest.length + checksumChanged.length + orphaned.length;

if (issues === 0) {
  console.log(
    `\n  ✓ Manifest is up to date — ${diskFiles.length} migrations, 0 issues.\n` +
    `    (generated ${manifest.generated || "unknown"})\n`
  );
  process.exit(0);
}

// --- report -----------------------------------------------------------------
console.error(`\n  ✗ Manifest is STALE — ${issues} issue(s) found.\n`);

if (notInManifest.length) {
  console.error("  In supabase/migrations/ but NOT in manifest (never manifested):");
  for (const f of notInManifest) console.error(`    • ${f}`);
  console.error("");
}
if (checksumChanged.length) {
  console.error("  Checksum mismatch (file edited after manifest was generated):");
  for (const f of checksumChanged) console.error(`    • ${f}`);
  console.error("");
}
if (orphaned.length) {
  console.error("  In manifest but NOT on disk (file deleted or renamed):");
  for (const f of orphaned) console.error(`    • ${f}`);
  console.error("");
}

console.error("  Fix: run `npm run migrate:manifest` then redeploy.\n");
process.exit(1);
