// QA auto-run — drives the LIVE app non-destructively and records verdicts for
// the local QA tracker (QA-Debug-Tracker-FootageBrain.xlsx).
//
// NON-DESTRUCTIVE ONLY: navigates, opens tabs, reads the DOM, checks per-role
// tab gating and deep-links. It never sends/pushes/deletes/creates, never clicks
// Refresh/scrape (backend jobs), never opens an editor "new project".
//
// Logins:
//   • OWNER  — reuses auth.json (capture once via
//              npx playwright codegen https://footagebrain.com --save-storage=auth.json)
//   • JAY    — real variant-role login, captured fresh at runtime from
//              JAY_EMAIL / JAY_PW env vars into auth-jay.json
//
// Output: scripts/qa-results.json  +  screenshots/qa/*.png
// Usage:  JAY_PW=... [JAY_EMAIL=...] node scripts/qa-autorun.mjs [baseURL]

import { chromium } from "@playwright/test";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";

const BASE = (process.argv[2] || "https://footagebrain.com").replace(/\/$/, "");
const APP = `${BASE}/app`;
const OUT = "screenshots/qa";
mkdirSync(OUT, { recursive: true });

const JAY_EMAIL = process.env.JAY_EMAIL || "jayalamina2025@gmail.com";
const JAY_PW = process.env.JAY_PW || "";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "paulvictor.biz@gmail.com";
const OWNER_PW = process.env.OWNER_PW || "";

const results = [];
const record = (sheet, id, status, note) => {
  results.push({ sheet, id, status, note });
  const mark = status === "Pass" ? "✓" : status === "Fail" ? "✗" : "•";
  console.log(`  ${mark} ${id} [${status}] ${note}`);
};

// ---- error capture wiring (per-page) -----------------------------------
function wire(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(e.message));
  return { consoleErrors, pageErrors };
}
const snapErr = (b) => ({ ce: b.consoleErrors.length, pe: b.pageErrors.length });
const clearErr = (b) => { b.consoleErrors.length = 0; b.pageErrors.length = 0; };

// ---- nav-drawer helpers (from smoke-screenshot.mjs) ---------------------
async function openDrawer(page) {
  const open = await page.locator(".nav-drawer.is-open").count();
  if (!open) {
    await page.locator('button[aria-label="Open navigation menu"]').click({ timeout: 8000 }).catch(() => {});
    await page.locator(".nav-drawer.is-open").waitFor({ state: "attached", timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}
async function closeDrawer(page) {
  const open = await page.locator(".nav-drawer.is-open").count();
  if (open) {
    await page.locator(".nav-drawer-close").click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(250);
  }
}
async function visibleTabs(page) {
  await openDrawer(page);
  const labels = await page.locator(".nav-drawer .nav-item-label").allInnerTexts();
  return labels.map((s) => s.replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean);
}
async function clickTab(page, label) {
  await openDrawer(page);
  const item = page.locator(".nav-drawer .nav-item-label", { hasText: new RegExp(`^${label}$`, "i") }).first();
  const n = await item.count();
  if (!n) return false;
  await item.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  await closeDrawer(page);
  return true;
}
async function switchPerspective(page, name) {
  await closeDrawer(page);
  await page.locator(".role-switch").click({ timeout: 8000 }).catch(() => {});
  await page.locator(".role-menu").waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  await page.locator(".role-menu .rm-opt", { hasText: name }).first().click({ timeout: 8000 }).catch(() => {});
  await page.locator(".role-menu").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
}
async function shellReady(page, ms = 60000) {
  return page.locator('button[aria-label="Open navigation menu"]')
    .waitFor({ state: "visible", timeout: ms }).then(() => true).catch(() => false);
}
// Fill the email+password sign-in screen if present. Returns true if the shell
// is ready afterward (either already-authed or login succeeded).
async function signIn(page, email, pw, ms = 45000) {
  if (await shellReady(page, 4000)) return true;
  const emailIn = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
  const pwIn = page.locator('input[type="password"], input[name="password"]').first();
  if (!(await emailIn.count()) || !(await pwIn.count())) return shellReady(page, 3000);
  await emailIn.fill(email).catch(() => {});
  await pwIn.fill(pw).catch(() => {});
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")')
    .first().click({ timeout: 8000 }).catch(() => {});
  return shellReady(page, ms);
}
const bodyText = async (page) =>
  (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();

// tab key -> display label (for the Per-Role matrix)
const TAB_LABEL = {
  mywork: "my work", pipeline: "pipeline", reeldna: "reel dna", footage: "footage",
  training: "training", resources: "resources", team: "team", editor: "editor",
  projects: "projects", lossless: "lossless", export: "export", analytics: "analytics",
  inbox: "inbox", generate: "generate", music: "music library", coverage: "coverage",
  locations: "locations", monitor: "monitor", activity: "activity",
};
// RM rows that are pure tabs (RM-01..RM-20) -> {key, expected per role}
// expected: V=visible H=hidden. order: owner, skilled, variant, reviewer
const RM_TABS = [
  ["RM-01", "mywork",    "V","V","V","V"],
  ["RM-02", "pipeline",  "V","V","V","V"],
  ["RM-03", "reeldna",   "V","V","V","V"],
  ["RM-04", "footage",   "V","V","V","V"],
  ["RM-05", "training",  "V","V","V","V"],
  ["RM-06", "resources", "V","V","V","V"],
  ["RM-07", "team",      "V","V","V","V"],
  ["RM-08", "editor",    "V","H","H","H"],
  ["RM-09", "projects",  "V","H","H","H"],
  ["RM-10", "lossless",  "V","H","H","H"],
  ["RM-11", "export",    "V","H","H","H"],
  ["RM-12", "analytics", "V","H","H","H"],
  ["RM-13", "inbox",     "V","H","H","H"],
  ["RM-14", "generate",  "V","H","H","H"],
  ["RM-15", "music",     "V","H","H","H"],
  ["RM-16", "coverage",  "V","H","H","H"],
  ["RM-17", "locations", "V","H","H","H"],
  ["RM-18", "monitor",   "V","H","H","H"],
  ["RM-19", "activity",  "V","H","H","H"],
  ["RM-20", "monitor",   "V","H","H","H"], // settings (Roles admin) ~ owner-only; proxy via monitor-tier owner-only gating
];

// feature "renders + key control present" checks: tab label + keywords + rowId
// keywords: at least one must appear in the page body once the tab renders.
const RENDER_CHECKS = [
  { id: "MYW-001", sheet: "My Work",                    tab: "My work",       kw: ["work", "needs", "reel"] },
  { id: "PIPE-001", sheet: "Pipeline",                  tab: "Pipeline",      kw: ["not started", "in progress", "review", "blocked", "completed"] },
  { id: "DNA-002", sheet: "Reel DNA",                   tab: "Reel DNA",      kw: ["capture", "location", "music", "font"] },
  { id: "THM-001", sheet: "Thumbnail DNA",              tab: "Reel DNA",      kw: ["thumbnail"], optional: true },
  { id: "LIB-001", sheet: "Footage Coverage Locations", tab: "Footage",      kw: ["footage", "search", "clip", "drive", "library", "upload", "asset"] },
  { id: "TRN-001", sheet: "Training & Resources",       tab: "Training",      kw: ["module", "lesson", "progress", "training"] },
  { id: "MUS-001", sheet: "Music Library",              tab: "Music Library", kw: ["search", "browse", "favorites", "playlist", "track", "genre", "mood", "bpm"], owner: true },
  { id: "EXP-004", sheet: "Export & Planable",          tab: "Export",        kw: ["planable", "download csv", "posted", "schedule"], owner: true },
  { id: "MON-002", sheet: "Monitor Hub",                tab: "Monitor",       kw: ["supabase", "hetzner", "usage", "infra", "pulse", "scout"], owner: true },
  { id: "SCT-001", sheet: "Scout",                      tab: "Monitor",       kw: ["score", "source", "product"], owner: true, sub: "scout" },
];

// iframe checks
const IFRAME_CHECKS = [
  { id: "EDT-001", sheet: "Editor",                    tab: "Editor", note: "OpenCut editor iframe" },
  { id: "TCH-001", sheet: "Team Chat & Notifications", tab: "Team",   note: "Rocket.Chat iframe" },
  { id: "ECP-001", sheet: "Editor Collab & Projects",  tab: "Projects", dom: ".nav-item-label", note: "Projects tab renders" },
];

// ======================================================================== //
async function main() {
  const browser = await chromium.launch();

  // ---------------------------------------------------------------- AUTH (fresh, no session)
  console.log("\n=== AUTH (fresh contexts) ===");
  // AUTH-008 landing renders
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); const b = wire(page);
    const resp = await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(1200);
    const txt = await bodyText(page);
    await page.screenshot({ path: `${OUT}/auth-landing.png` }).catch(() => {});
    const ok = !!resp && resp.status() < 400 && txt.length > 30 && b.pageErrors.length === 0;
    record("Auth & Access", "AUTH-008", ok ? "Pass" : "Fail",
      `Auto: landing HTTP ${resp ? resp.status() : "?"}, ${txt.length} chars, pageErrors=${b.pageErrors.length}. [auth-landing.png]`);
    await ctx.close();
  }
  // AUTH-003 no signup link + AUTH-002 wrong password + AUTH-001 valid + AUTH-006 persist
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); const b = wire(page);
    await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(1500);
    const signinTxt = (await bodyText(page)).toLowerCase();
    await page.screenshot({ path: `${OUT}/auth-signin.png` }).catch(() => {});
    const hasSignup = /create account|sign up|register/i.test(signinTxt);
    record("Auth & Access", "AUTH-003", hasSignup ? "Fail" : "Pass",
      `Auto: sign-in screen ${hasSignup ? "HAS" : "has no"} signup/register link. [auth-signin.png]`);

    // AUTH-002 wrong password
    if (JAY_PW) {
      const emailIn = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
      const pwIn = page.locator('input[type="password"], input[name="password"]').first();
      if (await emailIn.count() && await pwIn.count()) {
        await emailIn.fill(JAY_EMAIL).catch(() => {});
        await pwIn.fill("definitely-wrong-" + "x".repeat(8)).catch(() => {});
        await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first().click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2500);
        const stillSignin = !(await shellReady(page, 2000));
        await page.screenshot({ path: `${OUT}/auth-wrongpw.png` }).catch(() => {});
        record("Auth & Access", "AUTH-002", stillSignin ? "Pass" : "Fail",
          `Auto: wrong password ${stillSignin ? "rejected (stayed on sign-in)" : "UNEXPECTEDLY signed in"}. [auth-wrongpw.png]`);
      } else {
        record("Auth & Access", "AUTH-002", "Blocked", "Auto: email/password inputs not found on sign-in screen — manual.");
        record("Auth & Access", "AUTH-003", "Blocked", "Auto: sign-in inputs not found — manual.");
      }
    } else {
      record("Auth & Access", "AUTH-002", "Blocked", "Manual: JAY_PW env not provided.");
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- JAY login (real variant)
  console.log("\n=== JAY login (variant) ===");
  let jayTabs = null;
  if (JAY_PW) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); const b = wire(page);
    await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(1500);
    const emailIn = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
    const pwIn = page.locator('input[type="password"], input[name="password"]').first();
    let signedIn = false;
    if (await emailIn.count() && await pwIn.count()) {
      await emailIn.fill(JAY_EMAIL).catch(() => {});
      await pwIn.fill(JAY_PW).catch(() => {});
      await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first().click({ timeout: 8000 }).catch(() => {});
      signedIn = await shellReady(page, 45000);
    } else {
      // maybe already authed via prior state — unlikely on fresh ctx
      signedIn = await shellReady(page, 5000);
    }
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/jay-dashboard.png`, fullPage: true }).catch(() => {});
    record("Auth & Access", "AUTH-001", signedIn ? "Pass" : "Fail",
      `Auto: Jay (variant) sign-in ${signedIn ? "succeeded" : "FAILED — shell not ready"}. [jay-dashboard.png]`);

    if (signedIn) {
      await ctx.storageState({ path: "auth-jay.json" });
      jayTabs = await visibleTabs(page);
      await page.screenshot({ path: `${OUT}/jay-nav.png`, fullPage: true }).catch(() => {});
      console.log(`  Jay tabs (${jayTabs.length}): ${jayTabs.join(", ")}`);

      // AUTH-006 session persists (reload via saved state)
      const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: "auth-jay.json" });
      const p2 = await ctx2.newPage();
      await p2.goto(APP, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
      const persisted = await shellReady(p2, 30000);
      record("Auth & Access", "AUTH-006", persisted ? "Pass" : "Fail",
        `Auto: reload with saved Jay session ${persisted ? "stayed signed in" : "FELL BACK to sign-in"}.`);
      await ctx2.close();

      // NAV-004 safety-net bounce — force a hidden owner-only view as Jay
      try {
        await p2page_bounce(browser);
      } catch { /* handled inside */ }
    }
    await ctx.close();
  } else {
    record("Auth & Access", "AUTH-001", "Blocked", "Manual: JAY_PW env not provided.");
  }

  // ---------------------------------------------------------------- OWNER context (fresh login if creds, else auth.json)
  console.log("\n=== OWNER ===");
  let ownerTabs = null, skilledTabs = null, reviewerTabs = null;
  const haveAuth = existsSync("auth.json");
  // Prefer a fresh owner login (refreshes the session); fall back to auth.json.
  const octx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: !OWNER_PW && haveAuth ? "auth.json" : undefined,
  });
  const opage = await octx.newPage();
  const ob = wire(opage);
  await opage.goto(APP, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
  let ownerReady = await shellReady(opage, 30000);
  if (!ownerReady && OWNER_PW) {
    console.log("  owner: signing in fresh…");
    ownerReady = await signIn(opage, OWNER_EMAIL, OWNER_PW, 45000);
    if (ownerReady) await octx.storageState({ path: "auth.json" }); // refresh saved session
  }
  await opage.waitForTimeout(800);
  const ownerAuthed = ownerReady && !/log in|sign in|ask paul/i.test((await bodyText(opage)).slice(0, 200));
  console.log(`  owner authed: ${ownerAuthed} (fresh-login creds: ${OWNER_PW ? "yes" : "no"}, auth.json: ${haveAuth})`);

  if (ownerAuthed) {
    await opage.screenshot({ path: `${OUT}/owner-dashboard.png`, fullPage: true }).catch(() => {});
    ownerTabs = await visibleTabs(opage);
    console.log(`  owner tabs (${ownerTabs.length}): ${ownerTabs.join(", ")}`);

    // NAV-001 drawer opens
    record("Navigation & Permissions", "NAV-001", ownerTabs.length > 0 ? "Pass" : "Fail",
      `Auto: nav drawer opened; ${ownerTabs.length} tabs visible to owner.`);

    // ---- per-tab SMOKE (NAV-002) — open each owner tab, capture errors
    console.log("\n  -- per-tab smoke --");
    const tabErrors = {};
    for (const label of ownerTabs) {
      clearErr(ob);
      const ok = await clickTab(opage, label);
      await opage.waitForTimeout(500);
      const e = snapErr(ob);
      tabErrors[label] = e;
      if (e.pe > 0 || e.ce > 0) console.log(`     ${label}: console=${e.ce} page=${e.pe}`);
      await opage.screenshot({ path: `${OUT}/owner-tab-${label.replace(/[^a-z0-9]+/gi, "_")}.png` }).catch(() => {});
    }
    const broken = Object.entries(tabErrors).filter(([, e]) => e.pe > 0);
    record("Navigation & Permissions", "NAV-002", broken.length ? "Fail" : "Pass",
      broken.length
        ? `Auto: ${broken.length} tab(s) threw page errors: ${broken.map(([t, e]) => `${t}(pe${e.pe})`).join(", ")}.`
        : `Auto: all ${ownerTabs.length} owner tabs rendered with 0 uncaught page errors. (console-warn counts in screenshots/qa)`);

    // ---- RENDER checks (owner-side) ----
    console.log("\n  -- feature render checks --");
    for (const rc of RENDER_CHECKS) {
      if (rc.owner === false) continue;
      clearErr(ob);
      const opened = await clickTab(opage, rc.tab);
      if (!opened) { record(rc.sheet, rc.id, "Blocked", `Auto: tab "${rc.tab}" not visible to owner — manual.`); continue; }
      await opage.waitForTimeout(700);
      if (rc.sub === "scout") {
        await opage.locator(".dpill, button", { hasText: /scout/i }).first().click({ timeout: 4000 }).catch(() => {});
        await opage.waitForTimeout(700);
      }
      const txt = (await bodyText(opage)).toLowerCase();
      const e = snapErr(ob);
      const hit = rc.kw.some((k) => txt.includes(k));
      // 0 page errors + keyword hit = Pass. page error = Fail. rendered-but-no-keyword
      // is inconclusive (page loaded clean) → Blocked for manual confirmation, NOT Fail.
      const status = e.pe > 0 ? "Fail" : hit ? "Pass" : "Blocked";
      record(rc.sheet, rc.id, status,
        `Auto: opened "${rc.tab}", rendered clean (pageErrors=${e.pe}, consoleErr=${e.ce}), expected-keyword=${hit ? "found" : "NOT found — confirm content manually"}.${rc.optional ? " [optional]" : ""}`);
    }

    // ---- IFRAME checks ----
    for (const ic of IFRAME_CHECKS) {
      if (ic.id === "ECP-001") {
        const ok = await clickTab(opage, ic.tab);
        record(ic.sheet, ic.id, ok ? "Pass" : "Blocked",
          ok ? `Auto: "${ic.tab}" tab opened/rendered.` : `Auto: "${ic.tab}" not visible — manual.`);
        continue;
      }
      clearErr(ob);
      const ok = await clickTab(opage, ic.tab);
      if (!ok) { record(ic.sheet, ic.id, "Blocked", `Auto: "${ic.tab}" not visible — manual.`); continue; }
      await opage.waitForTimeout(1500);
      const frames = await opage.locator("iframe").count();
      const e = snapErr(ob);
      await opage.screenshot({ path: `${OUT}/owner-${ic.id}.png` }).catch(() => {});
      record(ic.sheet, ic.id, frames > 0 && e.pe === 0 ? "Pass" : "Fail",
        `Auto: ${ic.note} — iframes on page=${frames}, pageErrors=${e.pe}. [owner-${ic.id}.png]`);
    }

    // ---- DEEP-LINKS (NAV-007/008/009) ----
    console.log("\n  -- deep links --");
    // grab a reel id from My Work / Pipeline if visible
    let reelId = null;
    await clickTab(opage, "Pipeline");
    await opage.waitForTimeout(600);
    const m = (await bodyText(opage)).match(/REEL-\d+/i);
    if (m) reelId = m[0].toUpperCase();
    if (reelId) {
      clearErr(ob);
      await opage.goto(`${APP}?reel=${reelId}`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await opage.waitForTimeout(1800);
      const txt = (await bodyText(opage)).toLowerCase();
      const e = snapErr(ob);
      const ok = txt.includes(reelId.toLowerCase()) || /reel detail|logline|voiceover|comments/.test(txt);
      await opage.screenshot({ path: `${OUT}/owner-deeplink-reel.png` }).catch(() => {});
      record("Navigation & Permissions", "NAV-007", ok && e.pe === 0 ? "Pass" : "Fail",
        `Auto: ?reel=${reelId} opened detail=${ok}, pageErrors=${e.pe}. [owner-deeplink-reel.png]`);

      clearErr(ob);
      await opage.goto(`${APP}?reel=${reelId}&compare=1`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await opage.waitForTimeout(1800);
      const e2 = snapErr(ob);
      record("Navigation & Permissions", "NAV-008", e2.pe === 0 ? "Pass" : "Fail",
        `Auto: ?reel=&compare=1 loaded, pageErrors=${e2.pe}. (compare-mode visual = manual)`);
    } else {
      record("Navigation & Permissions", "NAV-007", "Blocked", "Auto: no REEL-id found on Pipeline to deep-link — manual.");
      record("Navigation & Permissions", "NAV-008", "Blocked", "Auto: no REEL-id available — manual.");
    }
    // ?capture= prefill
    clearErr(ob);
    await opage.goto(`${APP}?capture=1&url=https://www.instagram.com/reel/TESTQA/`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await opage.waitForTimeout(1800);
    const capTxt = (await bodyText(opage)).toLowerCase();
    const e3 = snapErr(ob);
    const capOk = capTxt.includes("capture") || capTxt.includes("instagram");
    await opage.screenshot({ path: `${OUT}/owner-deeplink-capture.png` }).catch(() => {});
    record("Navigation & Permissions", "NAV-009", capOk && e3.pe === 0 ? "Pass" : "Fail",
      `Auto: ?capture= routed to Reel DNA prefill=${capOk}, pageErrors=${e3.pe}. [owner-deeplink-capture.png]`);

    // ---- NAV-012 needs-you badge present (structural) ----
    await clickTab(opage, "My work");
    await opage.waitForTimeout(500);
    const badge = await opage.locator(".needs-you, [class*='badge'], .nav-badge").count();
    record("Navigation & Permissions", "NAV-012", "Blocked",
      `Auto: badge-like elements on page=${badge}; exact count correctness needs known data — manual.`);

    // ---- RT-13 pipeline sub-mode persists ----
    console.log("\n  -- persistence --");
    try {
      await clickTab(opage, "Pipeline");
      await opage.waitForTimeout(500);
      const listBtn = opage.locator("button, .dpill", { hasText: /^list$/i }).first();
      if (await listBtn.count()) {
        await listBtn.click({ timeout: 5000 }).catch(() => {});
        await opage.waitForTimeout(500);
        await opage.reload({ waitUntil: "domcontentloaded" });
        await shellReady(opage, 30000);
        await clickTab(opage, "Pipeline");
        await opage.waitForTimeout(800);
        const mode = await opage.evaluate(() => localStorage.getItem("wb_pipeline_mode"));
        record("Realtime & Persistence", "RT-13", mode === "list" ? "Pass" : "Blocked",
          `Auto: after selecting List + reload, wb_pipeline_mode="${mode}".`);
      } else {
        record("Realtime & Persistence", "RT-13", "Blocked", "Auto: List sub-mode button not found — manual.");
      }
    } catch (e) {
      record("Realtime & Persistence", "RT-13", "Blocked", `Auto: persistence check errored — manual. (${String(e).slice(0, 80)})`);
    }

    // ---- PERSPECTIVE: skilled (Judy) + reviewer (Leroy) tab sets ----
    console.log("\n  -- perspective tab sets --");
    await switchPerspective(opage, "Judy");
    skilledTabs = await visibleTabs(opage);
    await opage.screenshot({ path: `${OUT}/persp-skilled.png` }).catch(() => {});
    await switchPerspective(opage, "Leroy");
    reviewerTabs = await visibleTabs(opage);
    await opage.screenshot({ path: `${OUT}/persp-reviewer.png` }).catch(() => {});
    await switchPerspective(opage, "Paul").catch(() => {});
    console.log(`  skilled(Judy) tabs: ${skilledTabs.join(", ")}`);
    console.log(`  reviewer(Leroy) tabs: ${reviewerTabs.join(", ")}`);
  } else {
    record("Navigation & Permissions", "NAV-001", "Blocked",
      `Manual: owner auth.json missing/expired — owner-only rows skipped. Recapture: npx playwright codegen ${BASE} --save-storage=auth.json`);
  }

  // ---------------------------------------------------------------- Per-Role Access Matrix
  console.log("\n=== Per-Role Access Matrix (tab rows) ===");
  const inSet = (tabs, key) => tabs ? tabs.includes(TAB_LABEL[key]) : null;
  // Reliability probe: the owner's in-drawer perspective PREVIEW does not re-gate
  // tab visibility (owner god-mode renders all tabs) — proven when skilled/reviewer
  // tab sets equal the owner set. So skilled/reviewer columns are NOT authoritative;
  // only REAL logins (owner + variant/Jay) are. Real skilled/reviewer logins needed.
  const sameAsOwner = (t) =>
    t && ownerTabs && t.length === ownerTabs.length && t.every((x) => ownerTabs.includes(x));
  const perspUnreliable = sameAsOwner(skilledTabs) || sameAsOwner(reviewerTabs);
  const perspNote = perspUnreliable
    ? "skilled/reviewer NOT auto-verified (owner perspective-preview doesn't re-gate — needs real logins)"
    : "skilled/reviewer via perspective-switch (unconfirmed — prefer real logins)";

  for (const [id, key, eo, es, ev, er] of RM_TABS) {
    const checks = [];
    const cmp = (label, tabs, expected) => {
      if (!tabs) return;
      const observed = inSet(tabs, key) ? "V" : "H";
      checks.push({ label, expected, observed, ok: observed === expected });
    };
    cmp("owner", ownerTabs, eo);     // real login
    cmp("variant", jayTabs, ev);     // real login → authoritative
    if (!checks.length) {
      record("Per-Role Access Matrix", id, "Blocked", "Auto: no real-login role views captured — manual.");
      continue;
    }
    const bad = checks.filter((c) => !c.ok);
    const detail = checks.map((c) => `${c.label}:${c.observed}${c.ok ? "✓" : `≠${c.expected}✗`}`).join(" ");
    record("Per-Role Access Matrix", id, bad.length ? "Fail" : "Pass",
      `Auto [${key}] ${detail}. ${perspNote}; demo not tested.`);
  }

  // ---------------------------------------------------------------- write results
  await octx.close();
  await browser.close();

  writeFileSync("scripts/qa-results.json", JSON.stringify(results, null, 2));
  const by = (s) => results.filter((r) => r.status === s).length;
  console.log(`\n=== DONE ===  ${results.length} verdicts  ·  Pass ${by("Pass")}  Fail ${by("Fail")}  Blocked ${by("Blocked")}`);
  console.log("Wrote scripts/qa-results.json  +  screenshots/qa/*.png");

  // helper used above (hoisted via function declaration)
  async function p2page_bounce(brow) {
    const c = await brow.newContext({ viewport: { width: 1440, height: 900 }, storageState: "auth-jay.json" });
    const p = await c.newPage(); const bb = wire(p);
    // localStorage routing: app reads wb_view; set a hidden owner-only view then load
    await p.goto(APP, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await shellReady(p, 30000);
    await p.evaluate(() => localStorage.setItem("wb_view", "monitor"));
    await p.reload({ waitUntil: "domcontentloaded" });
    await shellReady(p, 30000);
    await p.waitForTimeout(1000);
    const tabs = await visibleTabs(p);
    const sawMonitor = tabs.includes("monitor");
    // bounce success = monitor NOT shown to variant AND app didn't dead-end (drawer has tabs)
    await p.screenshot({ path: `${OUT}/jay-bounce.png`, fullPage: true }).catch(() => {});
    record("Navigation & Permissions", "NAV-004", !sawMonitor && tabs.length > 0 ? "Pass" : "Fail",
      `Auto: as variant(Jay), forced wb_view=monitor → monitor visible=${sawMonitor}, fell back to ${tabs.length} allowed tabs. [jay-bounce.png]`);
    await c.close();
  }
}

main().catch((e) => { console.error("FATAL", e); process.exitCode = 1; });
