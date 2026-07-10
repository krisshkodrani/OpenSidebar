#!/usr/bin/env node
/**
 * Build the site's trace-viewer demo collage from the LIVE adjudication viewer.
 * Records the dev viewer (:7589/viewer) with Puppeteer screencast — real
 * scrolling motion, not a slideshow — then wraps the clips in the OpenSidebar
 * montage style (title card, lower-third captions, brand chip, closing card)
 * with the same Windows-safe ffmpeg patterns as build-promo-cut.mjs.
 *
 * Prereqs: `pnpm run logs` serving a viewer built from the adjudication branch
 * (nx run extension:build-e2e), and a run whose judge_call carries reasoning.
 *
 * Usage: node scripts/build-viewer-demo-video.mjs --session <sessionId>
 * Output: .artifacts/publish/opensidebar-traceviewer-demo-collage.mp4
 */
import puppeteer from "puppeteer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const argVal = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const SESSION = argVal("--session", "");
const ROW_TEXT = argVal("--row", "Compose a concise release");
const BASE = "http://127.0.0.1:7589/viewer";
if (!SESSION) throw new Error("--session <sessionId> is required");

const W = 1920, H = 1080, FPS = 30;
const BG = "0x0B1F33", ACCENT = "0x4FC3F7", GREY = "0xB8C4D0", WHITE = "white";
const FADE = 0.35;
const X264 = [
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", "-r", String(FPS),
];
const SYS_FONT = "C:/Windows/Fonts/segoeuib.ttf";

const tmp = fs.mkdtempSync(path.join(ROOT, ".artifacts", "vv-"));
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
fs.copyFileSync(SYS_FONT, path.join(tmp, "font.ttf"));
const FONT = rel(path.join(tmp, "font.ttf"));
let ti = 0;
const textfile = (s) => {
  const f = path.join(tmp, `t${ti++}.txt`);
  fs.writeFileSync(f, s, "utf8");
  return rel(f);
};
const dt = (s, color, size, x, y, extra = "") =>
  `drawtext=fontfile=${FONT}:textfile=${textfile(s)}:fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}:expansion=none${extra}`;
const sh = (bin, a) => execFileSync(bin, a, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAIN = ".flex-1.overflow-y-auto.scrollbar-thin";

// ── 1. Record raw clips from the live viewer ───────────────────
async function record() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--force-color-profile=srgb", "--hide-scrollbars"],
  });
  const clips = {};
  try {
    const page = await browser.newPage();
    let nav = 0;
    const goto = (hash) =>
      page.goto(`${BASE}?nav=${++nav}${hash}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const waitText = (t, to = 45000) =>
      page.waitForFunction((x) => document.body.innerText.includes(x), { timeout: to }, t);

    // clip A — Attention inbox: hold, then a slow scroll down the queue.
    await goto("#top=attention");
    await waitText("Needs adjudication");
    await sleep(700);
    let rec = await page.screencast({ path: path.join(tmp, "a.webm") });
    await sleep(1400);
    await page.evaluate(
      (dur) => new Promise((res) => {
        const el = document.scrollingElement;
        const start = el.scrollTop, dist = 620, t0 = performance.now();
        const step = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          el.scrollTop = start + dist * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
          k < 1 ? requestAnimationFrame(step) : res();
        };
        requestAnimationFrame(step);
      }), 3200,
    );
    await sleep(900);
    await rec.stop();
    clips.attention = path.join(tmp, "a.webm");

    // clip B — the run's Story: open via a row click (deep-linking races the
    // list load), then a single downward journey: adjudication panel → select a
    // verdict → scroll through the spine → rest on the judge card.
    await goto("#top=sessions");
    await waitText(ROW_TEXT);
    await sleep(600);
    await page.evaluate((t) => {
      const row = [...document.querySelectorAll("div.cursor-pointer")].find((r) => r.textContent?.includes(t));
      row && row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, ROW_TEXT);
    await waitText("trajectory verdict");
    await sleep(1200);
    await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.scrollTop = 0; }, MAIN);
    await sleep(400);

    rec = await page.screencast({ path: path.join(tmp, "b.webm") });
    await sleep(1800); // rest on the claim-vs-evidence panel
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().toLowerCase() === "agree");
      btn && btn.click();
    });
    await sleep(1400); // verdict lights up
    // Smooth eased scroll until the JudgeCallCard is in view.
    await page.evaluate(
      (sel, dur) => new Promise((res) => {
        const el = document.querySelector(sel);
        const judge = [...el.querySelectorAll("*")].find((n) => n.textContent?.trim() === "Judge");
        const target = judge
          ? judge.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 160
          : el.scrollHeight;
        const start = el.scrollTop, dist = target - start, t0 = performance.now();
        const step = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          el.scrollTop = start + dist * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
          k < 1 ? requestAnimationFrame(step) : res();
        };
        requestAnimationFrame(step);
      }), MAIN, 5200,
    );
    await sleep(2600); // rest on the judge reasoning
    await rec.stop();
    clips.story = path.join(tmp, "b.webm");
  } finally {
    await browser.close();
  }
  return clips;
}

// ── 2. Normalize a webm clip to a 1920x1080 h264 segment + fades + overlays ──
// Screencast webm carries no container duration (ffprobe → NaN), so transcode
// to mp4 first (finalizes duration), THEN probe and overlay.
function probeDur(src) {
  const out = sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]);
  return parseFloat(out.trim());
}

function dressClip(src, out, { title, caption }) {
  const norm = out.replace(/\.mp4$/, "-norm.mp4");
  sh("ffmpeg", [
    "-y", "-i", src, "-vf",
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},setsar=1,format=yuv420p`,
    ...X264, norm,
  ]);
  const dur = probeDur(norm);
  const bandH = 118;
  const vf = [
    `drawbox=x=0:y=${H - bandH}:w=${W}:h=${bandH}:color=black@0.46:t=fill`,
    dt(title, WHITE, 40, "64", `${H}-84`, ":alpha='min(1,max(0,(t-0.3)/0.5))'"),
    dt(caption, "0xB8C4D0", 24, "64", `${H}-44`, ":alpha='min(1,max(0,(t-0.45)/0.5))'"),
    dt("OpenSidebar · Trace viewer", ACCENT, 22, "w-text_w-56", `${H}-52`, ":alpha='min(1,max(0,(t-0.3)/0.5))'"),
    `fade=t=in:st=0:d=${FADE}`,
    `fade=t=out:st=${(dur - FADE).toFixed(2)}:d=${FADE}`,
  ].join(",");
  sh("ffmpeg", ["-y", "-i", norm, "-vf", vf, ...X264, out]);
  return out;
}

// ── 3. Brand cards (push-in) ───────────────────────────────────
const SS = 2;
function card(lines, sec, name) {
  const texts = lines.map((l) => {
    const y = l.y.replace(/\(h\/2\)([+-])(\d+)/, (_, s, o) => `(h/2)${s}${Number(o) * SS}`);
    return dt(l.text, l.color, l.size * SS, "(w-text_w)/2", y, `:alpha='min(1,max(0,(t-${l.at})/0.5))'`);
  });
  const vf = [
    ...texts,
    `zoompan=z='min(1.05,1+0.00028*on)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`,
    `fade=t=in:st=0:d=${FADE}`,
    `fade=t=out:st=${(sec - FADE).toFixed(2)}:d=${FADE}`,
  ].join(",");
  const out = path.join(tmp, `${name}.mp4`);
  sh("ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=${BG}:s=${W * SS}x${H * SS}:d=${sec}:r=${FPS}`, "-vf", vf, ...X264, out]);
  return out;
}

// ── build ──────────────────────────────────────────────────────
console.log("Recording the live viewer…");
const clips = await record();

console.log("Dressing clips…");
const segAttention = dressClip(clips.attention, path.join(tmp, "seg-att.mp4"), {
  title: "Triage the backlog",
  caption: "Runs that need a human verdict — failed, capped, or partial",
});
const segStory = dressClip(clips.story, path.join(tmp, "seg-story.mp4"), {
  title: "Judge-level evidence, then a recorded verdict",
  caption: "Per-criterion ruling + cost · GPT-OSS 120B · agree / disagree / unsure",
});

const cardTitle = card([
  { text: "See every decision", color: WHITE, size: 68, y: "(h/2)-70", at: 0.2 },
  { text: "The built-in trace viewer — now at judge level", color: ACCENT, size: 30, y: "(h/2)+18", at: 0.6 },
], 2.8, "title");

const cardEnd = card([
  { text: "OpenSidebar", color: WHITE, size: 60, y: "(h/2)-96", at: 0.2 },
  { text: "Executor Kimi K2.7 Code · Planner GLM 5.2 · Judge GPT-OSS 120B", color: GREY, size: 24, y: "(h/2)-6", at: 0.6 },
  { text: "Fireworks AI", color: GREY, size: 24, y: "(h/2)+34", at: 0.8 },
  { text: "opensidebar.com", color: ACCENT, size: 34, y: "(h/2)+104", at: 1.1 },
], 3.4, "end");

console.log("Concatenating…");
const segments = [cardTitle, segAttention, segStory, cardEnd];
const listFile = path.join(tmp, "list.txt");
fs.writeFileSync(listFile, segments.map((s) => `file '${s.replace(/\\/g, "/")}'`).join("\n"), "utf8");
const outDir = path.join(ROOT, ".artifacts", "publish");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "opensidebar-traceviewer-demo-collage.mp4");
sh("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, ...X264, outFile]);

const total = probeDur(outFile);
console.log(`\nDone: ${outFile}\nDuration: ${total.toFixed(1)}s @ ${W}x${H}`);
