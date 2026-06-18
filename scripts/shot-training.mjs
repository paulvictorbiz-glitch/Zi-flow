// One-off visual capture of the Training module (owner session) for layout
// review. Boots authed app, opens the Training tab, expands the first pillar
// module, and screenshots the full expanded module so we can judge density.
// Usage: node scripts/shot-training.mjs [baseURL]
import { chromium } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:8000";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  storageState: existsSync("auth.json") ? "auth.json" : undefined,
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.locator('button[aria-label="Open navigation menu"]').waitFor({ state: "visible", timeout: 60000 });
await page.waitForTimeout(800);

// Open the nav drawer and click the Training tab.
await page.locator('button[aria-label="Open navigation menu"]').click();
await page.locator(".nav-drawer.is-open").waitFor({ state: "attached", timeout: 5000 }).catch(() => {});
await page.waitForTimeout(300);
await page.locator(".nav-drawer .nav-item", { hasText: "Training" }).first().click({ timeout: 8000 });
await page.waitForTimeout(800);

// Make sure the drawer is closed so it doesn't overlay the content.
const drawerOpen = await page.locator(".nav-drawer.is-open").count();
if (drawerOpen) {
  await page.locator(".nav-drawer-close").click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
}

await page.locator(".tr-wrap").waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
await page.screenshot({ path: `${OUT}/tr-01-overview.png`, fullPage: false });

// Expand the FIRST pillar module to reveal the full dense body.
const firstHead = page.locator(".tr-mod-head").first();
await firstHead.click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(700);

// Full-page shot of the expanded module (this is the "wall of text" view).
await page.screenshot({ path: `${OUT}/tr-02-module-expanded-full.png`, fullPage: true });

// Measure the expanded module's pixel height to quantify the density.
const box = await page.locator(".tr-mod").first().boundingBox().catch(() => null);
if (box) console.log(`First expanded module height: ${Math.round(box.height)}px (viewport 900px)`);

// Also grab just the module body element clipped, for a tighter look.
const modEl = page.locator(".tr-mod").first();
await modEl.screenshot({ path: `${OUT}/tr-03-module-only.png` }).catch(() => {});

console.log("page errors:", errs.length ? errs : "(none)");
await browser.close();
