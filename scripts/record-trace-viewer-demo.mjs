#!/usr/bin/env node
/**
 * Record a scripted demo tour of the built-in trace viewer, one MP4 clip per
 * scene, using the same CDP-screencast → ffmpeg pipeline as the e2e harness.
 * The clips feed `scripts/build-demo-montage.mjs --show traceviewer`.
 *
 * Prereqs: the log server must be running (`pnpm run logs`) and the dev-surface
 * bundle built (`pnpm exec nx run extension:build-e2e`) so /viewer serves.
 *
 * Usage:
 *   node scripts/record-trace-viewer-demo.mjs --smoke            # verify + stills only
 *   node scripts/record-trace-viewer-demo.mjs --session <id>     # record all scenes
 *   node scripts/record-trace-viewer-demo.mjs --scene fleet      # record one scene
 * Flags: --headed (default headless), --fps N (default 10), --light (default dark).
 */

import { mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import puppeteer from "puppeteer";

const VIEWER_URL = process.env.VIEWER_URL || "http://127.0.0.1:7589/viewer";
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

function argVal(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(name);

const SMOKE = hasFlag("--smoke");
const HEADED = hasFlag("--headed");
const FPS = Number(argVal("--fps", "10"));
const DARK = !hasFlag("--light");
const ONLY_SCENE = argVal("--scene", "");
const SESSION_ID = argVal("--session", "");

const today = new Date().toISOString().slice(0, 10);
const OUT_DIR = resolve(argVal("--out-dir", `.artifacts/e2e/videos/${today}`));
const STILL_DIR = resolve(".artifacts/e2e/videos", today, "stills");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Click the first <button> whose visible text starts with `label`. */
async function clickButton(page, label) {
  const clicked = await page.evaluate((want) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const hit = buttons.find((b) => (b.textContent || "").trim().startsWith(want));
    if (hit) {
      hit.click();
      return true;
    }
    return false;
  }, label);
  if (!clicked) throw new Error(`button not found: ${label}`);
}

/** Smooth mouse-wheel scroll at the viewport center (drives inner panels too). */
async function smoothScroll(page, totalDeltaY, steps = 24, stepMs = 90) {
  await page.mouse.move(960, 520);
  const per = totalDeltaY / steps;
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel({ deltaY: per });
    await sleep(stepMs);
  }
}

async function gotoHash(page, hash) {
  // The viewer keeps live-update requests open, so networkidle never fires;
  // wait for DOM + an explicit settle instead.
  await page.goto(`${VIEWER_URL}#${hash}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  // Hash-only navigations on an already-open app need a reload to re-parse.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForSelector("#root > *", { timeout: 30_000 });
  await sleep(1800);
}

/* ---------------------------------------------------------------- recorder */

function startRecording(page, frameDir) {
  const state = { last: null, count: 0, writing: false, timer: null, client: null };
  return {
    async start() {
      await mkdir(frameDir, { recursive: true });
      const client = page.mainFrame().client ?? (await page.createCDPSession());
      state.client = client;
      client.on("Page.screencastFrame", (event) => {
        state.last = Buffer.from(event.data, "base64");
        client.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
      });
      await client.send("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
      state.timer = setInterval(async () => {
        if (state.writing || !state.last) return;
        state.writing = true;
        try {
          state.count += 1;
          await writeFile(
            join(frameDir, `frame-${String(state.count).padStart(6, "0")}.jpg`),
            state.last,
          );
        } finally {
          state.writing = false;
        }
      }, 1000 / FPS);
    },
    async stop() {
      clearInterval(state.timer);
      await state.client?.send("Page.stopScreencast").catch(() => {});
      return state.count;
    },
  };
}

function runFfmpeg(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-800)}`)),
    );
  });
}

async function encodeScene(frameDir, outPath) {
  await runFfmpeg([
    "-y",
    "-framerate", String(FPS),
    "-i", join(frameDir, "frame-%06d.jpg"),
    "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
    outPath,
  ]);
}

/* ------------------------------------------------------------------ scenes */

async function pickSessionId() {
  if (SESSION_ID) return SESSION_ID;
  const res = await fetch("http://127.0.0.1:7589/api/traces/search?limit=100");
  const data = await res.json();
  const sessions = data.sessions || data;
  // Prefer a completed multi-turn session with perception evidence.
  const best = sessions
    .filter((s) => (s.status || s.outcome) === "completed" && (s.turnCount ?? s.turns ?? 0) >= 5)
    .at(0);
  if (!best) throw new Error("no completed session with >=5 turns found via /api/traces/search");
  return best.sessionId || best.id;
}

const SCENES = {
  async fleet(page) {
    await gotoHash(page, "top=runs");
    await sleep(2500);
    await smoothScroll(page, 1400, 28, 110);
    await sleep(1200);
    await clickButton(page, "Insights");
    await sleep(2600);
    await smoothScroll(page, 900, 18, 110);
    await sleep(1500);
  },
  async session(page, sessionId) {
    await gotoHash(page, `session=${sessionId}&view=story`);
    await sleep(2800);
    await clickButton(page, "Plan");
    await sleep(2600);
    await clickButton(page, "Trajectory (");
    await sleep(2200);
    await smoothScroll(page, 1200, 24, 110);
    await sleep(1500);
  },
  async perception(page, sessionId) {
    await gotoHash(page, `session=${sessionId}&view=perception`);
    await sleep(2800);
    await smoothScroll(page, 1600, 32, 110);
    await sleep(1200);
    await gotoHash(page, "top=analytics");
    await sleep(2400);
    await smoothScroll(page, 900, 18, 110);
    await sleep(1500);
  },
};

/* ------------------------------------------------------------------- smoke */

async function smokeCheck(page, sessionId, problems) {
  const still = async (name) => {
    await mkdir(STILL_DIR, { recursive: true });
    await page.screenshot({ path: join(STILL_DIR, `${name}.png`) });
  };

  await gotoHash(page, "top=runs");
  await sleep(2000);
  // Run rows are expandable list items, not a <table>; count "Expand all"
  // siblings by looking for the run-count footer instead.
  const runRows = await page.evaluate(() => {
    const text = document.body.innerText || "";
    const match = text.match(/(\d+)\s+runs from loaded traces/);
    return match ? Number(match[1]) : 0;
  });
  if (runRows === 0) problems.push("runs view reports 0 loaded runs");
  await still("smoke-runs");

  for (const tab of ["Traces (", "Insights", "Metrics"]) {
    await clickButton(page, tab);
    await sleep(2200);
    await still(`smoke-${tab.replace(/\W+/g, "").toLowerCase()}`);
  }

  await gotoHash(page, `session=${sessionId}&view=story`);
  await sleep(2200);
  await still("smoke-session-overview");
  for (const sub of ["Plan", "Trajectory (", "Perception ("]) {
    await clickButton(page, sub);
    await sleep(2000);
    await still(`smoke-${sub.replace(/\W+/g, "").toLowerCase()}`);
  }
  const imgs = await page.$$eval("img", (els) =>
    els.filter((e) => e.naturalWidth > 0).length,
  );
  if (imgs === 0) problems.push("perception tab shows no loaded screenshots");
  console.log(`[smoke] runs rows: ${runRows}, loaded perception images: ${imgs}`);
}

/* -------------------------------------------------------------------- main */

async function main() {
  const browser = await puppeteer.launch({
    headless: !HEADED,
    defaultViewport: { width: 1920, height: 1080 },
    args: ["--window-size=1936,1180", "--force-device-scale-factor=1"],
  });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: DARK ? "dark" : "light" },
  ]);

  const problems = [];
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console.error: ${msg.text().slice(0, 200)}`);
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (url.includes("/api/") || url.includes("/assets/"))
      problems.push(`request failed: ${url} (${req.failure()?.errorText})`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) problems.push(`HTTP ${res.status()}: ${res.url()}`);
  });

  try {
    const sessionId = await pickSessionId();
    console.log(`[viewer-demo] featured session: ${sessionId}`);

    if (SMOKE) {
      await smokeCheck(page, sessionId, problems);
    } else {
      await mkdir(OUT_DIR, { recursive: true });
      const ts = Date.now();
      for (const [name, run] of Object.entries(SCENES)) {
        if (ONLY_SCENE && name !== ONLY_SCENE) continue;
        const frameDir = join(OUT_DIR, `.frames-traceviewer-${name}`);
        await rm(frameDir, { recursive: true, force: true });
        const rec = startRecording(page, frameDir);
        // Load the first view before recording so clips never open on a blank page.
        await rec.start();
        await run(page, sessionId);
        const frames = await rec.stop();
        const outPath = join(OUT_DIR, `${ts}-traceviewer-${name}-view.mp4`);
        await encodeScene(frameDir, outPath);
        await rm(frameDir, { recursive: true, force: true });
        console.log(`[viewer-demo] scene ${name}: ${frames} frames → ${outPath}`);
      }
    }
  } finally {
    await browser.close();
  }

  if (problems.length) {
    console.log(`\n[viewer-demo] ${problems.length} problem(s):`);
    for (const p of [...new Set(problems)].slice(0, 20)) console.log(`  - ${p}`);
    process.exitCode = SMOKE ? 1 : 0; // recordings may proceed; smoke must be clean
  } else {
    console.log("[viewer-demo] no console errors, page errors, or failed requests");
  }
}

await main();
