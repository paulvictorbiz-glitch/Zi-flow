// Playback freeze diagnostic via the REAL embedded path (:8000 → iframe :3000).
// Stages (argv[3]): "explore" | "play"
import { chromium } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";

const BASE = "http://localhost:8000";
const OUT = process.argv[2] || "oc-embed-shots";
const STAGE = process.argv[3] || "explore";
const CLIP = process.argv[4] || "C:/Users/Mi/AppData/Local/Temp/claude/c--Users-Mi-Downloads-ziflow-project-final/a9f19098-7925-44ef-8fe6-58322b1fe1b2/scratchpad/testclip.mp4";
mkdirSync(OUT, { recursive: true });

const logs = [];
const errs = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1680, height: 1000 },
  storageState: existsSync("auth.json") ? "auth.json" : undefined,
});
const page = await ctx.newPage();
page.on("console", (m) => { const u = m.location()?.url || ""; const src = /3000/.test(u) ? "IFRAME" : "main"; logs.push(`[${src}:${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errs.push("main: " + e.message));
// also capture iframe console once it exists
ctx.on("page", () => {});
const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log("  shot:", n); };

console.log("→ /app (auth.json)");
await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("goto err", e.message));
const shellReady = await page.locator('button[aria-label="Open navigation menu"]').waitFor({ state: "visible", timeout: 60000 }).then(() => true).catch(() => false);
console.log("  shell ready:", shellReady, "url:", page.url());
await page.waitForTimeout(800);
await shot("01-app");

const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
console.log("  authed:", !/log in|sign in|ask paul/i.test(bodyText.slice(0, 200)));

// open nav drawer, list tabs
async function openDrawer() {
  const open = await page.locator(".nav-drawer.is-open").count();
  if (!open) {
    await page.locator('button[aria-label="Open navigation menu"]').click({ timeout: 8000 });
    await page.waitForTimeout(400);
  }
}
await openDrawer();
const tabs = await page.locator(".nav-drawer .nav-item-label").allInnerTexts();
console.log("  tabs:", tabs.map((t) => t.trim()).filter(Boolean).join(", "));

// click a tab that looks like the editor/projects
const target = tabs.map((t) => t.trim()).find((t) => /project|editor|opencut|cut/i.test(t));
console.log("  → clicking tab:", target);
if (target) {
  await page.locator(".nav-drawer .nav-item-label", { hasText: target }).first().click({ timeout: 8000 });
  await page.waitForTimeout(2500);
}
await shot("02-editor-tab");

// dump clickable project cards / open buttons
const cards = await page.locator("button, a, [role=button], .card, [class*=project]").evaluateAll((els) =>
  els.map((e) => ({ tag: e.tagName, cls: e.className?.toString().slice(0, 40), text: (e.innerText || e.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 50) }))
     .filter((x) => x.text).slice(0, 50)
);
console.log("=== clickable on editor tab ===");
cards.forEach((c) => console.log(`  ${c.tag}.${c.cls} "${c.text}"`));

// is there already an iframe?
const iframeCount = await page.locator("iframe").count();
console.log("  iframes present:", iframeCount);

if (STAGE === "explore") {
  console.log("=== MAIN CONSOLE (last 25) ===");
  logs.slice(-25).forEach((l) => console.log(" ", l));
  console.log("=== PAGE ERRORS ===");
  errs.forEach((e) => console.log(" •", e));
  await browser.close();
  process.exit(0);
}

// ===================== STAGE play =====================
// Dismiss the gamification "Daily Progress" modal if present.
await page.locator(".gf-close, button:has-text('START EDITING')").first().click({ timeout: 4000 }).catch(() => {});
await page.waitForTimeout(600);

// Go back to the Projects browser and open the first project so the FULL-BLEED embed mounts.
await page.locator(".editor-btn:has-text('Projects'), button:has-text('← Projects')").first().click({ timeout: 6000 }).catch((e) => console.log("back-to-projects err:", e.message));
await page.waitForTimeout(2000);
await shot("03-projects-browser");

// open the first project card (try a few likely selectors)
const opened = await (async () => {
  for (const sel of [".ep-card", "[class*=project-card]", ".project-card", "[class*=ep-] button", ".ep-grid > *", "button:has-text('Open')"]) {
    const loc = page.locator(sel).first();
    if (await loc.count()) { await loc.click({ timeout: 5000 }).catch(() => {}); return sel; }
  }
  return null;
})();
console.log("  opened project via:", opened);
await page.waitForTimeout(3500);
await shot("04-after-open");

// locate the :3000 iframe
const frame = page.frames().find((f) => /localhost:3000/.test(f.url()));
console.log("  :3000 frame:", frame ? frame.url() : "NOT FOUND");
if (!frame) { console.log("NO IFRAME — embed did not mount"); await browser.close(); process.exit(1); }
await frame.waitForLoadState("domcontentloaded").catch(() => {});
await page.waitForTimeout(3500);

const fl = page.frameLocator("iframe");
// Dismiss the "Welcome to OpenCut AI" onboarding modal INSIDE the iframe.
for (const t of ["Next", "Next", "Get started", "Done", "Skip"]) {
  await fl.locator(`button:has-text("${t}")`).first().click({ timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(400);
}
await fl.locator('[aria-label="Close"], button:has-text("×")').first().click({ timeout: 1500 }).catch(() => {});
await page.waitForTimeout(800);
await shot("05-modal-dismissed");

// Inject playback event counters into the iframe window (the PlaybackManager
// dispatches playback-update / playback-seek on window — ground truth for "is
// the rAF timer advancing").
await frame.evaluate(() => {
  const w = window;
  w.__pb = { update: 0, seek: 0, lastTime: null };
  w.addEventListener("playback-update", (e) => { w.__pb.update++; w.__pb.lastTime = e.detail?.time; });
  w.addEventListener("playback-seek", (e) => { w.__pb.seek++; w.__pb.lastTime = e.detail?.time; });
});

const sample = async () => frame.evaluate(() => {
  const cv = document.querySelector("canvas");
  let hash = null;
  if (cv) {
    try {
      const c = document.createElement("canvas"); c.width = 64; c.height = 36;
      const cx = c.getContext("2d"); cx.drawImage(cv, 0, 0, 64, 36);
      const d = cx.getImageData(0, 0, 64, 36).data;
      let h = 0; for (let i = 0; i < d.length; i += 17) h = (h * 31 + d[i]) >>> 0; hash = h;
    } catch (e) { hash = "ERR:" + e.message; }
  }
  const pb = window.__pb || {};
  return { hash, hasCanvas: !!cv, update: pb.update, seek: pb.seek, lastTime: pb.lastTime };
});

// focus the preview (click the canvas of the OpenCut iframe specifically)
const ocFrame = page.frameLocator('iframe[title="OpenCut editor"]');
await ocFrame.locator("canvas").first().click({ timeout: 5000 }).catch((e) => console.log("canvas click err:", e.message));
await page.waitForTimeout(400);
console.log("→ initial sample:", JSON.stringify(await sample()));

// ---- IN-RANGE SCRUB TEST: rewind to start (Home), then step frames (right) ----
console.log("\n→ IN-RANGE SCRUB TEST (Home, then step 'right' 8 frames)");
await page.keyboard.press("Home");
await page.waitForTimeout(800);
const scrubSeries = [await sample()];
for (let i = 0; i < 8; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(500); scrubSeries.push(await sample()); }
scrubSeries.forEach((s, i) => console.log(`  step#${i}  lastTime=${s.lastTime}  seek=${s.seek}  canvasHash=${s.hash}`));
const scrubCanvasMoved = new Set(scrubSeries.map((s) => String(s.hash))).size > 1;
console.log(`  >>> in-range scrub repaints canvas: ${scrubCanvasMoved}`);
await shot("05b-after-scrub");

// ---- SEEK / SCRUB TEST: press "l" (seek-forward 1s) x4 ----
console.log("\n→ SEEK TEST (press 'l' = seek-forward 1s, x4)");
const seekSeries = [];
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("l");
  await page.waitForTimeout(700);
  seekSeries.push(await sample());
}
seekSeries.forEach((s, i) => console.log(`  seek#${i + 1}  lastTime=${s.lastTime}  seekEvents=${s.seek}  canvasHash=${s.hash}`));
const seekCanvasMoved = new Set(seekSeries.map((s) => String(s.hash))).size > 1;
const seekFired = (seekSeries.at(-1)?.seek || 0) > 0;
await shot("06-after-seeks");

// ---- PLAY TEST: press "k" (play), sample 6s ----
console.log("\n→ PLAY TEST (press 'k' = play, sample 6s)");
const before = await sample();
await page.keyboard.press("k");
const series = [];
for (let i = 0; i < 12; i++) { await page.waitForTimeout(500); series.push(await sample()); }
await page.keyboard.press("k"); // pause
await shot("07-after-play");
series.forEach((s, i) => console.log(`  t+${(i + 1) * 500}ms  upd=${s.update}  lastTime=${(s.lastTime ?? 0).toFixed ? s.lastTime.toFixed(2) : s.lastTime}  canvasHash=${s.hash}`));

const updDelta = (series.at(-1)?.update || 0) - (before.update || 0);
const timerAdvancing = updDelta > 2; // playback-update events fired during play
const playHashes = new Set(series.map((s) => String(s.hash)));
const canvasMoved = playHashes.size > 1;

console.log("\n========================= DIAGNOSIS =========================");
console.log(`  SEEK: canvas changed on scrub = ${seekCanvasMoved}   (seek events fired = ${seekFired})`);
console.log(`  PLAY: rAF timer advancing = ${timerAdvancing}  (playback-update +${updDelta})`);
console.log(`  PLAY: canvas frames changing = ${canvasMoved}  (${playHashes.size} distinct hashes)`);
let verdict;
if (!timerAdvancing && !canvasMoved) verdict = "PLAY NEVER STARTED (timer not advancing) — focus/shortcut not reaching the editor, OR empty timeline";
else if (timerAdvancing && !canvasMoved && !seekCanvasMoved) verdict = "DECODE/RENDER HANG — neither play nor seek updates the canvas (mediabunny decode or renderingRef lock)";
else if (timerAdvancing && !canvasMoved && seekCanvasMoved) verdict = "FROZEN DURING PLAY ONLY — seek paints frames but play doesn't (render loop / renderingRef lock during playback)";
else verdict = "NO FREEZE REPRODUCED — play + canvas both advancing";
console.log(`  >>> ${verdict}`);

console.log("\n=== CONSOLE (decode/seek/error, last 50) ===");
logs.filter((l) => /error|warn|seek|iterator|prefetch|decode|frame|rate|token|mediabunny|codec|canvas|render/i.test(l)).slice(-50).forEach((l) => console.log(" ", l));
console.log("=== PAGE ERRORS ===");
errs.forEach((e) => console.log(" •", e));
await browser.close();
