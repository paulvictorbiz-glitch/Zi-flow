// Capture the carousel on non-first chapters to verify the slide + height
// animation and that interactive blocks (flashcards/quiz) render in-pane.
import { chromium } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:8000";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  storageState: existsSync("auth.json") ? "auth.json" : undefined,
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.locator('button[aria-label="Open navigation menu"]').waitFor({ state: "visible", timeout: 60000 });
await page.waitForTimeout(800);
await page.locator('button[aria-label="Open navigation menu"]').click();
await page.waitForTimeout(300);
await page.locator(".nav-drawer .nav-item", { hasText: "Training" }).first().click({ timeout: 8000 });
await page.waitForTimeout(700);
const drawerOpen = await page.locator(".nav-drawer.is-open").count();
if (drawerOpen) { await page.locator(".nav-drawer-close").click().catch(() => {}); await page.waitForTimeout(250); }

const mod = page.locator(".tr-mod").first();
await mod.locator(".tr-mod-head").click();
await page.waitForTimeout(600);

async function capStep(label, file) {
  await mod.locator(".tc-step", { hasText: label }).click({ timeout: 8000 });
  await page.waitForTimeout(650); // let slide + height settle
  const box = await mod.boundingBox();
  console.log(`${label}: module height ${box ? Math.round(box.height) : "?"}px`);
  await mod.screenshot({ path: `${OUT}/${file}` });
}

await capStep("Recall", "tr-nav-recall.png");     // flashcards + quiz
await capStep("Standards", "tr-nav-standards.png"); // taller list-heavy chapter

console.log("page errors:", errs.length ? errs : "(none)");
await browser.close();
