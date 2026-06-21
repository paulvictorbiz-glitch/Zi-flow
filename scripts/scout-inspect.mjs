// Read-only diagnostic: boot the app as owner, open the Scout tab, capture EVERY
// console message + any uncaught error, click Refresh, and screenshot — to find
// the recurring "non ISO-8859-1 code point" error (or prove it no longer fires).
// Usage: node scripts/scout-inspect.mjs [baseURL]
import { chromium } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:8000";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const logs = [];          // every console message
const pageErrors = [];    // uncaught exceptions
const tag = (t) => (s) => logs.push({ type: t, text: s });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  storageState: existsSync("auth.json") ? "auth.json" : undefined,
});
const page = await ctx.newPage();
page.on("console", (m) => logs.push({ type: m.type(), text: m.text() }));
page.on("pageerror", (e) => { pageErrors.push(e.message); logs.push({ type: "PAGEERROR", text: e.message }); });
const badResponses = [];
const scoutResponses = [];
page.on("response", (r) => {
  if (r.status() >= 400) badResponses.push({ status: r.status(), url: r.url() });
  if (r.url().includes("rqkzstyvqfmcsxdyogij")) scoutResponses.push({ status: r.status(), url: r.url().replace(/\?.*/, "?…") });
});
const failedReqs = [];
page.on("requestfailed", (r) => failedReqs.push({ url: r.url(), err: r.failure()?.errorText }));

console.log(`→ ${BASE}/app`);
await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("goto:", e.message));
const shellReady = await page.locator('button[aria-label="Open navigation menu"]')
  .waitFor({ state: "visible", timeout: 60000 }).then(() => true).catch(() => false);
console.log(`shell ready: ${shellReady} · ${page.url()}`);
await page.waitForTimeout(1000);

const bodyHead = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 120);
const authed = !/log in|sign in|ask paul/i.test(bodyHead);
console.log(`authenticated: ${authed}  (head: "${bodyHead}")`);
await page.screenshot({ path: `${OUT}/scout-00-boot.png`, fullPage: false });

// --- open the Monitor hub, then the Scout sub-tab ------------------------
async function openDrawer() {
  if (!(await page.locator(".nav-drawer.is-open").count())) {
    await page.locator('button[aria-label="Open navigation menu"]').click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}
if (authed) {
  // Dismiss the gamification "Daily Progress" welcome popup (gf-overlay) — it
  // intercepts all pointer events until closed.
  const gfClose = page.locator(".gf-close");
  if (await gfClose.count()) {
    await gfClose.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);

  await openDrawer();
  await page.locator(".nav-drawer .nav-item-label", { hasText: /^Monitor$/i }).first()
    .click({ timeout: 8000 }).catch((e) => console.log("Monitor click:", e.message));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/scout-01-monitor.png`, fullPage: false });

  // Scout sub-tab inside the Monitor hub
  const scoutTab = page.getByRole("button", { name: /scout/i }).first();
  if (await scoutTab.count()) {
    await scoutTab.click({ timeout: 8000 }).catch((e) => console.log("Scout tab click:", e.message));
  } else {
    await page.getByText(/^Scout$/i).first().click({ timeout: 8000 }).catch((e) => console.log("Scout text click:", e.message));
  }
  await page.waitForTimeout(6000); // let the scout Supabase products+dossiers queries resolve
  await page.screenshot({ path: `${OUT}/scout-02-tab.png`, fullPage: true });
  const stillLoading = await page.getByText(/Loading Scout data/i).count();
  const cards = await page.locator(".scout-card, [class*='scout'] [class*='card']").count();
  console.log(`scout tab: stillLoading=${!!stillLoading} · candidate cards=${cards}`);

  // Click the Refresh button (↻ Refresh)
  const refresh = page.getByRole("button", { name: /refresh/i }).first();
  const haveRefresh = await refresh.count();
  console.log(`refresh button present: ${!!haveRefresh}`);
  if (haveRefresh) {
    await refresh.click({ timeout: 8000 }).catch((e) => console.log("Refresh click:", e.message));
    await page.waitForTimeout(3500); // let the request resolve + any toast/error render
    await page.screenshot({ path: `${OUT}/scout-03-after-refresh.png`, fullPage: true });
  }
}

// --- report --------------------------------------------------------------
const isHeaderErr = (t) => /ISO-8859|non ISO|Failed to execute 'set' on 'Headers'/i.test(t);
const errors = logs.filter((l) => l.type === "error" || l.type === "PAGEERROR");
const headerHits = logs.filter((l) => isHeaderErr(l.text));

console.log("\n===== CONSOLE ERRORS (red only) =====");
console.log(errors.length ? errors.map((e) => ` • [${e.type}] ${e.text}`).join("\n") : "  (none)");
console.log("\n===== UNCAUGHT PAGE ERRORS =====");
console.log(pageErrors.length ? pageErrors.map((e) => " • " + e).join("\n") : "  (none)");
console.log("\n===== 'non ISO-8859-1' MATCHES (the bug) =====");
console.log(headerHits.length ? headerHits.map((e) => ` • [${e.type}] ${e.text}`).join("\n") : "  ✓ NONE — the Headers error did not fire");

console.log("\n===== SCOUT SUPABASE RESPONSES (data path) =====");
console.log(scoutResponses.length ? scoutResponses.map((r) => ` • ${r.status}  ${r.url}`).join("\n") : "  (none seen)");

console.log("\n===== HTTP >=400 RESPONSES =====");
console.log(badResponses.length ? badResponses.map((r) => ` • ${r.status}  ${r.url}`).join("\n") : "  (none)");
console.log("\n===== FAILED REQUESTS =====");
console.log(failedReqs.length ? failedReqs.map((r) => ` • ${r.err}  ${r.url}`).join("\n") : "  (none)");

console.log(`\nsummary: ${logs.length} console msgs · ${errors.length} errors · ${pageErrors.length} pageerrors · ${headerHits.length} header-error hits`);
await browser.close();
