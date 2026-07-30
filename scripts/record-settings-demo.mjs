#!/usr/bin/env node
/**
 * Record a short demo of the Settings → Models tab, showing the release-
 * verified provider choices and optional model overrides. Loads the REAL unpacked dev-surface
 * extension (dist-dev) in headed Chrome and drives the actual sidepanel as a
 * detached page — the same trick the e2e harness uses, because the native
 * chrome.sidePanel is not automatable.
 *
 * Demo credentials are placeholders used only to unlock the provider cards;
 * the recording does not save them or make an inference request.
 *
 * Prereq: dist-dev built (`pnpm exec nx run extension:build-e2e`).
 * Usage: node scripts/record-settings-demo.mjs [--headed] [--fps 12] [--dark]
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import puppeteer from "puppeteer";

const ROOT = process.cwd();
const DIST = resolve(ROOT, "dist-dev");
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

const argVal = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const hasFlag = (n) => process.argv.includes(n);

const HEADED = hasFlag("--headed");
const FPS = Number(argVal("--fps", "12"));
const DARK = hasFlag("--dark"); // default light — matches the store screenshots
const today = new Date().toISOString().slice(0, 10);
const OUT_DIR = resolve(ROOT, ".artifacts/e2e/videos", today);
const STILL_DIR = join(OUT_DIR, "stills");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startRecording(page, frameDir) {
  const s = { last: null, count: 0, writing: false, timer: null, client: null };
  return {
    async start() {
      await mkdir(frameDir, { recursive: true });
      const client = await page.createCDPSession();
      s.client = client;
      client.on("Page.screencastFrame", (e) => {
        s.last = Buffer.from(e.data, "base64");
        client
          .send("Page.screencastFrameAck", { sessionId: e.sessionId })
          .catch(() => {});
      });
      await client.send("Page.startScreencast", {
        format: "jpeg",
        quality: 90,
        everyNthFrame: 1,
      });
      s.timer = setInterval(async () => {
        if (s.writing || !s.last) return;
        s.writing = true;
        try {
          s.count += 1;
          await writeFile(
            join(frameDir, `frame-${String(s.count).padStart(6, "0")}.jpg`),
            s.last,
          );
        } finally {
          s.writing = false;
        }
      }, 1000 / FPS);
    },
    async stop() {
      clearInterval(s.timer);
      await s.client?.send("Page.stopScreencast").catch(() => {});
      return s.count;
    },
  };
}

function encode(frameDir, outPath) {
  return new Promise((res, rej) => {
    const p = spawn(
      FFMPEG,
      [
        "-y",
        "-framerate",
        String(FPS),
        "-i",
        join(frameDir, "frame-%06d.jpg"),
        "-vf",
        "pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-an",
        outPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (c) =>
      c === 0 ? res() : rej(new Error(`ffmpeg ${c}: ${err.slice(-500)}`)),
    );
  });
}

// Set a controlled input value so React's onChange fires.
async function setReactValue(page, selector, value) {
  await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`no element ${sel}`);
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    selector,
    value,
  );
}

async function clickProvider(page, label) {
  const ok = await page.evaluate((want) => {
    const el = [...document.querySelectorAll("button[aria-pressed]")].find(
      (candidate) => (candidate.textContent || "").includes(want),
    );
    if (!el) return false;
    el.click();
    return true;
  }, label);
  if (!ok) throw new Error(`no provider button containing "${label}"`);
}

async function clickContainingText(page, selector, text) {
  const ok = await page.evaluate(
    (sel, want) => {
      const el = [...document.querySelectorAll(sel)].find((candidate) =>
        (candidate.textContent || "").includes(want),
      );
      if (!el) return false;
      el.click();
      return true;
    },
    selector,
    text,
  );
  if (!ok) throw new Error(`no ${selector} containing "${text}"`);
}

async function clickByText(page, selector, text) {
  const ok = await page.evaluate(
    (sel, want) => {
      const el = [...document.querySelectorAll(sel)].find(
        (e) =>
          (e.textContent || "").trim().toLowerCase() === want.toLowerCase(),
      );
      if (el) {
        el.click();
        return true;
      }
      return false;
    },
    selector,
    text,
  );
  if (!ok) throw new Error(`no ${selector} with text "${text}"`);
}

async function scrollToText(page, text) {
  await page.evaluate((want) => {
    const el = [...document.querySelectorAll("h3,h2,label,div")].find((e) =>
      (e.textContent || "").trim().startsWith(want),
    );
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, text);
}

async function main() {
  const browser = await puppeteer.launch({
    headless: !HEADED,
    enableExtensions: true,
    waitForInitialPage: false,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      "--no-first-run",
      "--no-sandbox",
      "--disable-search-engine-choice-screen",
    ],
  });

  // Extract the extension id from the service-worker target.
  const swTarget = await browser.waitForTarget(
    (t) =>
      t.type() === "service_worker" &&
      t.url().startsWith("chrome-extension://"),
    { timeout: 30_000 },
  );
  const extId = swTarget.url().match(/chrome-extension:\/\/([a-z]{32})\//)[1];
  console.log(`[settings-demo] extension: ${extId}`);

  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 900, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: DARK ? "dark" : "light" },
  ]);

  // The e2e panel params take the fast bootstrap path (no active-tab lookup).
  const panelUrl = `chrome-extension://${extId}/src/sidepanel/index.html?e2eTargetTabId=1&e2eWorkspaceId=demo`;
  await page.goto(panelUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForFunction(
    () => document.documentElement.hasAttribute("data-opensidebar-ready"),
    { timeout: 30_000 },
  );
  await sleep(1500);

  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

  const frameDir = join(OUT_DIR, ".frames-settings");
  await rm(frameDir, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const rec = startRecording(page, frameDir);
  await rec.start();

  // Beat 1: open Settings (the gear button, distinct from the dialog which
  // shares the aria-label).
  await sleep(1200);
  await page.click('button[aria-label="Settings"]');
  await sleep(1300);

  // Beat 2: Models tab.
  await clickByText(page, "button", "models");
  await sleep(1000);

  // Beat 3: connect the two release providers with non-secret demo values.
  await setReactValue(page, "#provider-key-fireworksApiKey", "fw_demo");
  await setReactValue(page, "#provider-key-openRouterApiKey", "sk-or-demo");
  await page.waitForFunction(
    () => document.querySelectorAll("button[aria-pressed]").length >= 2,
  );
  await scrollToText(page, "Available providers");
  await sleep(1200);

  // Beat 4: switch between the two verified provider cards, ending on the
  // recommended default used for fresh installs.
  await clickProvider(page, "Fireworks AI");
  await sleep(1400);
  await clickProvider(page, "OpenRouter");
  await sleep(1400);

  // Beat 5: show the optional per-seat model overrides.
  await clickContainingText(page, "summary", "Advanced model settings");
  await scrollToText(page, "Advanced model settings");
  await sleep(1600);

  const frames = await rec.stop();
  const ts = Date.now();
  const outPath = join(OUT_DIR, `${ts}-settings-provider-view.mp4`);
  await encode(frameDir, outPath);
  await rm(frameDir, { recursive: true, force: true });
  console.log(`[settings-demo] ${frames} frames → ${outPath}`);

  // A clean still with the recommended default selected, for the store screenshot.
  await clickProvider(page, "OpenRouter");
  await scrollToText(page, "Available providers");
  await sleep(600);
  await mkdir(STILL_DIR, { recursive: true });
  const stillPath = join(STILL_DIR, "settings-provider.png");
  await page.screenshot({ path: stillPath });
  console.log(`[settings-demo] still → ${stillPath}`);

  await browser.close();
  if (problems.length) {
    console.log(`[settings-demo] ${problems.length} page error(s):`);
    for (const p of [...new Set(problems)].slice(0, 10))
      console.log(`  - ${p}`);
  }
}

await main();
