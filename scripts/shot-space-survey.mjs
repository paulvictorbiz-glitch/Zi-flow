// Zoomed-out 360° survey of the /space scene to verify ALL set-pieces
// (binary black hole, fleet, pulsar, comets, supernova) appear around the
// full sphere. Scrolls the camera out, then captures frames across a full
// azimuth sweep. Usage: node scripts/shot-space-survey.mjs [baseURL]
import { chromium } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:8000";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  storageState: existsSync("auth.json") ? "auth.json" : undefined,
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(`${BASE}/space`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(1500);
await page.locator("canvas").first().waitFor({ state: "attached", timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1800);

const box = await page.locator("canvas").first().boundingBox().catch(() => null);
const cx = box ? box.x + box.width / 2 : 800;
const cy = box ? box.y + box.height / 2 : 500;

// Zoom out a long way so the 30–80 unit set-pieces come into frame.
await page.mouse.move(cx, cy);
for (let i = 0; i < 24; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(40); }
await page.waitForTimeout(800);

async function orbit(dx) {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(700);
}

for (let i = 0; i < 8; i++) {
  await page.screenshot({ path: `${OUT}/space-survey-${String(i).padStart(2, "0")}.png`, fullPage: false });
  await orbit(220);
}

console.log("survey done; page errors:", errs.length ? errs.slice(0, 10) : "(none)");
await browser.close();
