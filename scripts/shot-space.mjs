// One-off visual capture of the owner-only 3D /space scene for before/after
// review of the "hyper-real" upgrade. Boots the authed owner session, opens
// /space, waits for the R3F <canvas> (NEVER networkidle — the render loop keeps
// the page busy forever), then drags to orbit the camera and screenshots from
// several angles so we can judge the scene from all sides.
//
// Usage: node scripts/shot-space.mjs [baseURL] [tag]
//   tag defaults to "before"; pass "after" once the upgrade lands.
import { chromium } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:8000";
const TAG = process.argv[3] || "before";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  storageState: existsSync("auth.json") ? "auth.json" : undefined,
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

await page.goto(`${BASE}/space`, { waitUntil: "domcontentloaded", timeout: 30000 });

// Owner gate bounces non-owners to /app; confirm we actually landed on /space.
await page.waitForTimeout(1500);
if (!page.url().includes("/space")) {
  console.log("Redirected away from /space — auth.json is not the owner session. URL:", page.url());
  await page.screenshot({ path: `${OUT}/space-${TAG}-redirected.png`, fullPage: false });
  await browser.close();
  process.exit(0);
}

// Wait for the R3F canvas to mount. domcontentloaded + element wait — not networkidle.
await page.locator("canvas").first().waitFor({ state: "attached", timeout: 20000 }).catch(() => {
  console.log("No <canvas> found — scene may have fallen back to the flat SpaceFallback.");
});
await page.waitForTimeout(1800); // let textures/shaders settle

const canvas = page.locator("canvas").first();
const box = await canvas.boundingBox().catch(() => null);
const cx = box ? box.x + box.width / 2 : 800;
const cy = box ? box.y + box.height / 2 : 500;

// Capture from several orbit angles by dragging across the canvas.
async function orbit(dx, dy) {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(900);
}

await page.screenshot({ path: `${OUT}/space-${TAG}-01-front.png`, fullPage: false });
await orbit(400, 0);
await page.screenshot({ path: `${OUT}/space-${TAG}-02-right.png`, fullPage: false });
await orbit(400, 0);
await page.screenshot({ path: `${OUT}/space-${TAG}-03-back.png`, fullPage: false });
await orbit(0, 300);
await page.screenshot({ path: `${OUT}/space-${TAG}-04-top.png`, fullPage: false });
await orbit(-400, -150);
await page.screenshot({ path: `${OUT}/space-${TAG}-05-angle.png`, fullPage: false });

// A short dwell + extra frame on the front to catch any looping animation phase.
await orbit(0, -150);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/space-${TAG}-06-dwell.png`, fullPage: false });

console.log(`Saved space-${TAG}-*.png to ${OUT}/`);
console.log("page errors:", errs.length ? errs.slice(0, 12) : "(none)");
await browser.close();
