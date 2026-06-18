// Ad-hoc Playwright smoke: screenshot the authed dashboard + the Reel DNA tab.
// Reuses the saved login session in auth.json (capture via:
//   npx playwright codegen http://localhost:8000 --save-storage=auth.json )
// Usage: node scripts/smoke-screenshot.mjs [baseURL]
import { chromium } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:8000";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const pageErrors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  storageState: existsSync("auth.json") ? "auth.json" : undefined,
});
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(e.message));

// --- Dashboard ---
const appURL = `${BASE}/app`;
console.log(`→ Navigating to ${appURL}`);
const resp = await page.goto(appURL, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => {
  console.log("  goto error:", e.message); return null;
});
// Wait for the store to hydrate past the "LOADING WORKFLOW…" splash —
// the tab strip only renders once the shell is ready. Poll for the
// Pipeline tab (every role sees it) up to 60s.
const shellReady = await page.getByRole("button", { name: /^Pipeline$/ })
  .waitFor({ state: "visible", timeout: 60000 })
  .then(() => true)
  .catch(() => false);
console.log(`  Shell ready (tab strip visible): ${shellReady}`);
await page.waitForTimeout(1000);
console.log(`  HTTP status: ${resp ? resp.status() : "n/a"}`);
console.log(`  URL after load: ${page.url()}`);
console.log(`  Title: ${JSON.stringify(await page.title())}`);
await page.screenshot({ path: `${OUT}/01-dashboard.png`, fullPage: true });

const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
const authed = !/log in|sign in|ask paul/i.test(bodyText.slice(0, 200));
console.log(`  Looks authenticated: ${authed}`);
console.log(`  visible text (start): ${bodyText.slice(0, 300)}`);

// --- Reel DNA tab ---
const tab = page.getByRole("button", { name: /^Reel DNA$/ }).or(page.getByText(/^\d*\s*Reel DNA$/));
const tabCount = await tab.count();
console.log(`\n→ "Reel DNA" tab matches: ${tabCount}`);
if (tabCount > 0) {
  await tab.first().click({ timeout: 8000 }).catch((e) => console.log("  click error:", e.message));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/02-reel-dna.png`, fullPage: true });
  const reelText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  console.log(`  Reel DNA visible text (start): ${reelText.slice(0, 300)}`);
} else {
  console.log("  (Reel DNA tab not found — role may not grant it, or not authed)");
}

console.log("\n=== CONSOLE ERRORS ===");
console.log(consoleErrors.length ? consoleErrors.map((e) => " • " + e).join("\n") : "  (none)");
console.log("=== UNCAUGHT PAGE ERRORS ===");
console.log(pageErrors.length ? pageErrors.map((e) => " • " + e).join("\n") : "  (none)");

await browser.close();
