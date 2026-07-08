#!/usr/bin/env node
/**
 * Build the Chrome Web Store graphics into .artifacts/store/ (git-ignored):
 *   - screenshot-N.png  1280×800  (source captures letterboxed + caption strip)
 *   - promo-tile.png     440×280  (required for search placement)
 *   - marquee.png       1400×560  (optional large promo)
 *
 * House style follows docs/guides/demo-video-style.md (navy #0B1F33, accent
 * #4FC3F7, Segoe UI Bold). Same ffmpeg-on-Windows rules as the montage script:
 * cwd-relative colon-free font/textfile paths and expansion=none on drawtext.
 *
 * Sources are existing verified captures; captions state only what the capture
 * really shows. Run `node scripts/build-store-assets.mjs`, then upload from
 * .artifacts/store/.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, ".artifacts", "store");
const BG = "0x0B1F33";
const ACCENT = "0x4FC3F7";
const SYS_FONT = "C:/Windows/Fonts/segoeuib.ttf";

const SCREENSHOTS = [
  {
    src: "docs/assets/opensidebar-1.png",
    caption: "Give it a task — the agent clicks, types, and checks out for you",
  },
  {
    src: ".artifacts/store/src/cross-page-compose.png",
    caption: "Reads data on one page, writes it into another",
  },
  {
    src: "docs/assets/trace-viewer-1.png",
    caption: "Replay every session turn by turn in the built-in trace viewer",
  },
  {
    src: ".artifacts/e2e/videos/2026-07-08/stills/smoke-runs.png",
    caption: "Every run with outcome, turns, and cost — traces never leave your machine",
  },
  {
    src: ".artifacts/e2e/videos/2026-07-08/stills/smoke-perception.png",
    caption: "The agent works from the same screenshot you see",
  },
];

const TAGLINE = "Your browser, driven by AI";
const SUBLINE = "Bring your own key · No telemetry · Open source";

function sh(bin, a) {
  return execFileSync(bin, a, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(ROOT, ".artifacts", "store-tmp-"));
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
const FONT = rel(path.join(tmp, "font.ttf"));
fs.copyFileSync(SYS_FONT, path.join(tmp, "font.ttf"));
let ti = 0;
function textfile(str) {
  const f = path.join(tmp, `t${ti++}.txt`);
  fs.writeFileSync(f, str, "utf8");
  return rel(f);
}
const dt = (str, color, size, x, y) =>
  `drawtext=fontfile=${FONT}:textfile=${textfile(str)}:fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}:expansion=none`;

// ---- screenshots 1280×800: capture letterboxed into 1280×720, navy pad, caption strip
function screenshot(srcPath, caption, outName) {
  const vf = [
    "scale=1280:720:force_original_aspect_ratio=decrease",
    `pad=1280:800:(ow-iw)/2:0:color=${BG}`,
    dt(caption, "white", 30, "(w-text_w)/2", "800-56"),
  ].join(",");
  sh("ffmpeg", ["-y", "-i", srcPath, "-vf", vf, "-frames:v", "1", path.join(OUT, outName)]);
  console.log(`  ${outName}  <- ${srcPath}`);
}

// ---- promo tile 440×280 and marquee 1400×560: text-only cards in the
// demo-video intro-card style (both logo PNGs have a baked-in transparency
// checkerboard, so text-only is the clean option).
function promo({ w, h, name, tag, sub, out }) {
  const texts = [
    dt("OpenSidebar", "white", name, "(w-text_w)/2", `(h/2)-${Math.round(name * 1.05)}`),
    dt(TAGLINE, ACCENT, tag, "(w-text_w)/2", `(h/2)+${Math.round(tag * 0.4)}`),
  ];
  if (sub) texts.push(dt(SUBLINE, "0xB8C4D0", sub, "(w-text_w)/2", `(h/2)+${Math.round(tag * 2.4)}`));
  sh("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", `color=c=${BG}:s=${w}x${h}:d=1:r=1`,
    "-vf", texts.join(","),
    "-frames:v", "1", path.join(OUT, out),
  ]);
  console.log(`  ${out}`);
}

console.log("Building store assets…");
SCREENSHOTS.forEach((s, i) => {
  if (!fs.existsSync(path.join(ROOT, s.src))) {
    console.log(`  !! missing source, skipping: ${s.src}`);
    return;
  }
  screenshot(s.src, s.caption, `screenshot-${i + 1}.png`);
});
promo({ w: 440, h: 280, name: 44, tag: 20, sub: 0, out: "promo-tile.png" });
promo({ w: 1400, h: 560, name: 96, tag: 42, sub: 28, out: "marquee.png" });

fs.rmSync(tmp, { recursive: true, force: true });

// ---- verify exact dimensions
let bad = 0;
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith(".png"))) {
  const dims = sh("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0",
    path.join(OUT, f),
  ]);
  const want = f.startsWith("screenshot") ? "1280x800" : f === "promo-tile.png" ? "440x280" : "1400x560";
  const ok = dims === want;
  if (!ok) bad++;
  console.log(`  ${ok ? "OK " : "BAD"} ${f} ${dims} (want ${want})`);
}
console.log(bad ? `${bad} asset(s) wrong size` : `Done: ${OUT}`);
process.exitCode = bad ? 1 : 0;
