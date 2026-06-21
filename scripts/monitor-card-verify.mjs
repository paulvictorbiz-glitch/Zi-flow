// Read-only: boot app as owner, open Monitor → Infra, screenshot the new Scout card.
import { chromium } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:8000";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  storageState: existsSync("auth.json") ? "auth.json" : undefined,
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
await page.locator('button[aria-label="Open navigation menu"]').waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1000);
await page.locator(".gf-close").click({ timeout: 4000 }).catch(() => {});
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(300);

// open drawer → Monitor
if (!(await page.locator(".nav-drawer.is-open").count())) {
  await page.locator('button[aria-label="Open navigation menu"]').click().catch(() => {});
  await page.waitForTimeout(400);
}
await page.locator(".nav-drawer .nav-item-label", { hasText: /^Monitor$/i }).first().click({ timeout: 8000 }).catch((e) => console.log("Monitor:", e.message));
await page.waitForTimeout(1200);

// ensure Infra sub-tab (the Infrastructure monitor with the cards)
await page.getByRole("button", { name: /^Infra$/i }).first().click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(2500);

// find + scroll to the Scout card
const scoutCard = page.locator(".mon-grid >> text=MicroSaaS radar").first();
const found = await scoutCard.count();
console.log(`Scout card present: ${!!found}`);
if (found) await scoutCard.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/monitor-scout-card.png`, fullPage: true });

// pull the card's text so we can confirm the numbers rendered
const cardText = await page.locator(".mon-grid").locator(":scope", { hasText: "Free pulls" }).first()
  .innerText().catch(() => "");
console.log("--- card text snippet ---");
console.log((cardText || "(not captured)").split("\n").filter(l => /pull|dossier|Product|OpenRouter|GitHub|Hacker/i.test(l)).join("\n"));
console.log(`\npage errors: ${errs.length ? errs.join(" | ") : "none"}`);
await browser.close();
