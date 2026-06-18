// Per-role smoke for the dashboard shell.
//
// Boots the authed app as the OWNER, then walks each perspective via the
// owner's perspective switcher and asserts the tab-gating invariants that the
// tabs / Monitor-hub / role-check reorg must NOT change:
//   • the owner sees the Monitor surface and team Analytics
//   • non-owner roles never see Monitor / Pulse / AI Brain
//   • Analytics stays visible to non-owners
//   • no uncaught page errors on boot
// These hold identically before and after the reorg, so this doubles as the
// regression gate run after each Part (A/B/C). It also prints the full per-role
// nav inventory (tabs + group headers) so the 11→7 group regroup can be eyeballed.
//
// Reuses the saved login session in auth.json (capture once via:
//   npx playwright codegen http://localhost:8000 --save-storage=auth.json )
// Usage: node scripts/smoke-screenshot.mjs [baseURL]
import { chromium } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:8000";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const pageErrors = [];
const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  storageState: existsSync("auth.json") ? "auth.json" : undefined,
});
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(e.message));

// ---- nav-drawer helpers -------------------------------------------------
async function openDrawer() {
  const open = await page.locator(".nav-drawer.is-open").count();
  if (!open) {
    await page.locator('button[aria-label="Open navigation menu"]').click({ timeout: 8000 });
    await page.locator(".nav-drawer.is-open").waitFor({ state: "attached", timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}
async function closeDrawer() {
  const open = await page.locator(".nav-drawer.is-open").count();
  if (open) {
    await page.locator(".nav-drawer-close").click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(250);
  }
}
// Visible tab labels (lowercased, trimmed) currently rendered in the drawer.
async function visibleTabs() {
  await openDrawer();
  const labels = await page.locator(".nav-drawer .nav-item-label").allInnerTexts();
  return labels.map((s) => s.replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean);
}
// Multi-tab group header labels (singleton groups render no header).
async function visibleGroups() {
  await openDrawer();
  const raw = await page.locator(".nav-drawer .nav-group-header").allInnerTexts();
  // headers read like "⠿ Library ▾" — strip the drag glyph + caret.
  return raw.map((s) => s.replace(/[⠿▾▸]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
}
const has = (tabs, label) => tabs.includes(label.toLowerCase());

// Switch the owner's perspective to the person whose name contains `name`.
async function switchPerspective(name) {
  await closeDrawer();
  await page.locator(".role-switch").click({ timeout: 8000 });
  await page.locator(".role-menu").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".role-menu .rm-opt", { hasText: name }).first().click({ timeout: 8000 });
  await page.locator(".role-menu").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600); // let canView() re-gate the drawer
}

// ---- boot ---------------------------------------------------------------
const appURL = `${BASE}/app`;
console.log(`→ Navigating to ${appURL}`);
const resp = await page.goto(appURL, { waitUntil: "domcontentloaded", timeout: 30000 })
  .catch((e) => { console.log("  goto error:", e.message); return null; });
// Wait past the "LOADING WORKFLOW…" splash — the shell only renders once the
// store hydrates. The topbar Menu button is always on-screen once it's up
// (the tab strip itself lives in the off-screen drawer, so it's not a reliable
// "visible" probe).
const shellReady = await page.locator('button[aria-label="Open navigation menu"]')
  .waitFor({ state: "visible", timeout: 60000 })
  .then(() => true).catch(() => false);
console.log(`  Shell ready: ${shellReady}  ·  HTTP ${resp ? resp.status() : "n/a"}  ·  ${page.url()}`);
assert(shellReady, "shell never became ready (topbar Menu button not visible within 60s)");
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/01-dashboard.png`, fullPage: true });

const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
const authed = !/log in|sign in|ask paul/i.test(bodyText.slice(0, 200));
console.log(`  Looks authenticated: ${authed}`);
assert(authed, "not authenticated — re-capture auth.json via `playwright codegen --save-storage`");

// ---- OWNER perspective --------------------------------------------------
console.log("\n=== OWNER perspective ===");
const ownerTabs = await visibleTabs();
const ownerGroups = await visibleGroups();
console.log(`  groups (${ownerGroups.length}): ${ownerGroups.join(" · ") || "(none multi-tab)"}`);
console.log(`  tabs   (${ownerTabs.length}): ${ownerTabs.join(", ")}`);
await page.screenshot({ path: `${OUT}/02-owner-nav.png`, fullPage: true });
// Monitor surface present for the owner (top-level tab today, hub after Part A —
// either way the "Monitor" nav label must exist). Analytics is team-facing.
assert(has(ownerTabs, "Monitor"), "owner does NOT see the Monitor nav entry");
assert(has(ownerTabs, "Analytics"), "owner does NOT see Analytics");

// ---- NON-OWNER perspective (reviewer = Leroy) ---------------------------
console.log("\n=== REVIEWER perspective (Leroy) ===");
await switchPerspective("Leroy");
const revTabs = await visibleTabs();
const revGroups = await visibleGroups();
console.log(`  groups (${revGroups.length}): ${revGroups.join(" · ") || "(none multi-tab)"}`);
console.log(`  tabs   (${revTabs.length}): ${revTabs.join(", ")}`);
await page.screenshot({ path: `${OUT}/03-reviewer-nav.png`, fullPage: true });
// The owner-only intelligence surfaces must stay hidden for a non-owner — this
// is the core "no gating change" invariant the reorg must preserve.
assert(!has(revTabs, "Monitor"),  "reviewer can see Monitor (owner-only leaked)");
assert(!has(revTabs, "Pulse"),    "reviewer can see Pulse (owner-only leaked)");
assert(!has(revTabs, "AI Brain"), "reviewer can see AI Brain (owner-only leaked)");
assert(has(revTabs, "Analytics"), "reviewer does NOT see Analytics (should stay team-visible)");

// reset perspective back to owner for any follow-on use
await switchPerspective("Paul").catch(() => {});

// ---- report -------------------------------------------------------------
console.log("\n=== CONSOLE ERRORS ===");
console.log(consoleErrors.length ? consoleErrors.map((e) => " • " + e).join("\n") : "  (none)");
console.log("=== UNCAUGHT PAGE ERRORS ===");
console.log(pageErrors.length ? pageErrors.map((e) => " • " + e).join("\n") : "  (none)");
assert(pageErrors.length === 0, `${pageErrors.length} uncaught page error(s) on boot`);

console.log("\n=== SMOKE RESULT ===");
if (failures.length) {
  console.log(failures.map((f) => " ✗ " + f).join("\n"));
  console.log(`FAIL — ${failures.length} invariant(s) broken`);
} else {
  console.log(" ✓ all gating invariants held");
  console.log("PASS");
}

await browser.close();
process.exitCode = failures.length ? 1 : 0;
