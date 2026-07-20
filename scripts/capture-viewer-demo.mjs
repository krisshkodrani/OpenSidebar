#!/usr/bin/env node
/**
 * Capture a demo of the trace-viewer adjudication workflow (dev-only surface).
 * Drives the viewer at :7589/viewer with Puppeteer (bundled Chromium — no
 * extension needed) and produces:
 *   - clean full-viewport stills of each surface
 *   - a stepped walkthrough gif assembled from those stills via ffmpeg
 *
 * The viewer must be served by the local log server (pnpm run logs) built from
 * the current branch (nx run extension:build-e2e). Pass the session id of a run
 * that has an enriched judge_call so the JudgeCallCard shows real reasoning.
 *
 * Usage:
 *   node scripts/capture-viewer-demo.mjs --session <sessionId> [--out <dir>]
 */
import puppeteer from "puppeteer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const argVal = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const SESSION = argVal("--session", "");
const OUT = path.resolve(argVal("--out", ".artifacts/viewer-demo"));
const BASE = argVal("--base", "http://127.0.0.1:7589/viewer");
const ROW_TEXT = argVal("--row", "Compose a concise release");
if (!SESSION) throw new Error("--session <sessionId> is required");

const STILLS = path.join(OUT, "stills");
fs.mkdirSync(STILLS, { recursive: true });

const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(page, file) {
  try {
    await page.screenshot({ path: file });
  } catch {
    await sleep(500);
    await page.screenshot({ path: file });
  }
}

async function still(page, name) {
  const f = path.join(STILLS, `${name}.png`);
  await shoot(page, f);
  console.log(`  still: ${name}`);
  return f;
}

let navSeq = 0;
async function gotoHash(page, hash) {
  // A hash-only change is same-document — the SPA won't remount and the
  // mount-time parseHash() never re-runs. A changing query param forces a real
  // navigation each time (the viewer ignores the query, reads only the hash).
  navSeq += 1;
  await page.goto(`${BASE}?nav=${navSeq}${hash}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
}

async function waitForText(page, text, timeout = 45000) {
  await page.waitForFunction(
    (t) => document.body && document.body.innerText.includes(t),
    { timeout },
    text,
  );
}

async function scrollStoryTo(page, needle) {
  await page.evaluate((n) => {
    const el = [...document.querySelectorAll("*")].find(
      (x) => x.textContent?.trim() === n,
    );
    if (el) el.scrollIntoView({ block: "center" });
  }, needle);
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: VIEWPORT,
    // --disable-dev-shm-usage: headless Chrome crashes ("Session closed") under
    // repeated large screenshots when /dev/shm is small; write to /tmp instead.
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--force-color-profile=srgb",
    ],
  });
  try {
    const page = await browser.newPage();
    // Capture in the viewer's native LIGHT theme. The content area is
    // light-themed (only the header is dark); forcing `prefers-color-scheme:
    // dark` makes the App add a `.dark` class that flips the text tokens to
    // their pale dark-mode values (e.g. --trace-accent-light #93c5fd) while the
    // backgrounds stay light — washing out the judge badges. Puppeteer defaults
    // to light, which is exactly what we want, so we emulate nothing.

    // ── 1. Attention inbox (the new default landing) ──
    await gotoHash(page, "#top=runs&review=needs");
    await waitForText(page, "Needs adjudication");
    const hasAttention = await page.evaluate(() =>
      document.body.innerText.includes("Attention"),
    );
    if (!hasAttention) {
      throw new Error(
        "Served viewer has no Attention tab — rebuild: nx run extension:build-e2e --skip-nx-cache",
      );
    }
    await sleep(700);
    await still(page, "01-attention-inbox");

    // ── Open the run via the Traces table (a real click resolves the runId
    //    immediately; deep-linking races the session-list load). ──
    await gotoHash(page, "#top=runs");
    await waitForText(page, ROW_TEXT);
    await sleep(700);
    const clicked = await page.evaluate((t) => {
      const row = [...document.querySelectorAll("div.cursor-pointer")].find((r) =>
        r.textContent?.includes(t),
      );
      if (row) {
        row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      }
      return false;
    }, ROW_TEXT);
    if (!clicked) throw new Error(`Could not find a row matching "${ROW_TEXT}"`);
    await waitForText(page, "trajectory verdict");
    await sleep(1500);

    // ── 2. Adjudication panel (claim vs evidence, at the top of the Story) ──
    await still(page, "02-adjudication-panel");

    // ── 3. The trajectory spine (scroll the plan/segments into view) ──
    await scrollStoryTo(page, "Plan");
    await sleep(700);
    await still(page, "03-story-spine");

    // ── 4. The JudgeCallCard (per-criterion reasoning + cost) ──
    await scrollStoryTo(page, "Judge");
    await sleep(700);
    await still(page, "04-judge-card");

    // ── 5. Select a verdict (show the control lighting up; no Save, so the
    //      demo doesn't persist a stray annotation) ──
    await scrollStoryTo(page, "Adjudicate");
    await sleep(500);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim().toLowerCase() === "agree",
      );
      if (btn) btn.click();
    });
    await sleep(500);
    await still(page, "05-verdict-selected");

    await browser.close();

    // ── Assemble a stepped walkthrough gif from the stills ──
    const order = [
      "01-attention-inbox",
      "02-adjudication-panel",
      "03-story-spine",
      "04-judge-card",
      "05-verdict-selected",
    ];
    const listFile = path.join(OUT, "gif-list.txt");
    const holdSec = 2.2;
    const lines = [];
    for (const name of order) {
      const p = path.join(STILLS, `${name}.png`).replace(/\\/g, "/");
      lines.push(`file '${p}'`, `duration ${holdSec}`);
    }
    // The concat demuxer needs the last file repeated (its duration is ignored).
    lines.push(`file '${path.join(STILLS, `${order[order.length - 1]}.png`).replace(/\\/g, "/")}'`);
    fs.writeFileSync(listFile, lines.join("\n"), "utf8");

    const gif = path.join(OUT, "trace-viewer-adjudication.gif");
    execFileSync(
      "ffmpeg",
      [
        "-y", "-f", "concat", "-safe", "0", "-i", listFile,
        "-vf",
        "scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=full[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
        gif,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    console.log(`\nDone.\n  stills: ${STILLS}\n  gif:    ${gif}`);
  } finally {
    try {
      await browser.close();
    } catch {
      /* already closed */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
