#!/usr/bin/env node
/**
 * Build the ~60s cinematic promo cut (the global promo-slot video), distinct
 * from the presentation-style montages in build-demo-montage.mjs:
 *   - cold open on product (no leading logo card), branding moves to the end
 *   - lower-thirds instead of per-scene title cards
 *   - speed ramping: fast traversal, ~1x on each scene's payoff moment
 *   - animated divider + CTA cards (zoompan push-in, staggered text fades)
 *   - optional music bed: --music <file> (mixed with fades; silent otherwise)
 *
 * Scene sources are the pinned clips in .artifacts/demo-clips.json; the ramp
 * windows below are calibrated to those exact takes (re-probe if re-pinned).
 * Same Windows-safe ffmpeg rules as the montage: cwd-relative colon-free
 * font/textfile paths and expansion=none on every drawtext.
 *
 * Usage: node scripts/build-promo-cut.mjs [--music path/to/bed.mp3]
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VIDEOS_DIR = path.join(ROOT, ".artifacts", "e2e", "videos");
const SYS_FONT = "C:/Windows/Fonts/segoeuib.ttf";
const W = 1920, H = 1080, FPS = 30;
const BG = "0x0B1F33";
const ACCENT = "0x4FC3F7";
const GREY = "0xB8C4D0";
const FADE = 0.3; // shorter than the montage — keeps momentum
const X264 = [
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
  "-r", String(FPS),
];

const BRAND_CHIP = "OpenSidebar · Kimi K2.7 Code + GLM 5.2 · Fireworks AI";

// ---- story ----------------------------------------------------------------
// segments: [{from,to,speed}] in source-clip seconds; the last segment of each
// beat is the ~1x payoff. Windows calibrated to the pinned takes (2026-07-08).
const BEATS = [
  {
    task: "online-shop",
    headline: "Your browser, driven by AI",
    segments: [
      { from: 40, to: 80, speed: 8 },    // shop → cart → coupon, fast
      { from: 80, to: 90, speed: 1.25 }, // Place Order → Order Confirmed
    ],
  },
  {
    task: "cross-page-compose",
    headline: "Reads one page, writes on another",
    segments: [
      { from: 70, to: 148, speed: 13 },     // dashboard read → mail traversal
      { from: 150, to: 160, speed: 1.25 },  // drafted reply visible
    ],
  },
  {
    task: "watch-restock",
    headline: "Watch Mode — it tells you when things change",
    segments: [
      { from: 0, to: 4, speed: 1.3 },   // watching, out of stock
      { from: 4, to: 10, speed: 1 },    // flips in stock → suggestion pops
    ],
  },
  { divider: "Works on your enterprise apps too" },
  {
    task: "order-developer-laptop",
    headline: "The same agent, driving ServiceNow",
    segments: [
      { from: 8, to: 58, speed: 10 },     // catalog → configure → checkout
      { from: 58, to: 68, speed: 1.25 },  // request submitted + REQ number
    ],
  },
];

const CTA = {
  lines: [
    { text: "OpenSidebar", color: "white", size: 84, y: "(h/2)-120", at: 0.2 },
    { text: "Free · Open source · Bring your own key", color: ACCENT, size: 38, y: "(h/2)-10", at: 0.7 },
    { text: "github.com/krisshkodrani/OpenSidebar", color: "white", size: 32, y: "(h/2)+60", at: 1.2 },
    { text: "Executor: Kimi K2.7 Code (vision) · Planner: GLM 5.2 · Fireworks AI", color: GREY, size: 22, y: "(h/2)+130", at: 1.7 },
  ],
  sec: 7,
};

// ---- plumbing (montage-proven patterns) -----------------------------------
function sh(bin, a) {
  return execFileSync(bin, a, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}
const argVal = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const MUSIC = argVal("--music", "");

const PIN_FILE = path.join(ROOT, ".artifacts", "demo-clips.json");
const PINS = fs.existsSync(PIN_FILE) ? JSON.parse(fs.readFileSync(PIN_FILE, "utf8")) : {};
function clipFor(task) {
  const pinned = PINS[task];
  if (!pinned) throw new Error(`no pinned clip for ${task}`);
  const p = path.isAbsolute(pinned) ? pinned : path.join(ROOT, pinned);
  if (!fs.existsSync(p)) throw new Error(`pinned clip missing: ${pinned}`);
  return p;
}

const tmp = fs.mkdtempSync(path.join(ROOT, ".artifacts", "promo-"));
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
const FONT = rel(path.join(tmp, "font.ttf"));
fs.copyFileSync(SYS_FONT, path.join(tmp, "font.ttf"));
let ti = 0;
function textfile(str) {
  const f = path.join(tmp, `t${ti++}.txt`);
  fs.writeFileSync(f, str, "utf8");
  return rel(f);
}
const dt = (str, color, size, x, y, extra = "") =>
  `drawtext=fontfile=${FONT}:textfile=${textfile(str)}:fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}:expansion=none${extra}`;

const segments = [];
const fades = (len) => [
  `fade=t=in:st=0:d=${FADE}`,
  `fade=t=out:st=${(len - FADE).toFixed(2)}:d=${FADE}`,
];

// ---- beats ----------------------------------------------------------------
function beatDuration(beat) {
  return beat.segments.reduce((s, seg) => s + (seg.to - seg.from) / seg.speed, 0);
}

function makeBeat(beat, idx) {
  const clip = clipFor(beat.task);
  // 1) extract + retime each segment (no overlay yet)
  const pieceList = [];
  beat.segments.forEach((seg, j) => {
    const out = path.join(tmp, `b${idx}s${j}.mp4`);
    const vf = [
      `setpts=PTS/${seg.speed}`,
      `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`,
      `fps=${FPS}`, "setsar=1", "format=yuv420p",
    ].join(",");
    // -ss/-t BEFORE -i: trim at the input so setpts retimes exactly the window
    // (as output options they'd limit the already-retimed stream instead).
    sh("ffmpeg", [
      "-y", "-ss", String(seg.from), "-t", String(seg.to - seg.from), "-i", clip,
      "-vf", vf, ...X264, out,
    ]);
    pieceList.push(out);
  });
  // 2) concat the ramp pieces
  const rawList = path.join(tmp, `b${idx}.txt`);
  fs.writeFileSync(rawList, pieceList.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"), "utf8");
  const raw = path.join(tmp, `b${idx}raw.mp4`);
  sh("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", rawList, "-c", "copy", raw]);
  // 3) lower third + brand chip + fades over the joined beat
  const dur = beatDuration(beat);
  const bandH = 92;
  const vf = [
    `drawbox=x=0:y=${H - bandH}:w=${W}:h=${bandH}:color=black@0.5:t=fill`,
    dt(beat.headline, "white", 36, "60", `${H}-64`,
      ":alpha='min(1,max(0,(t-0.35)/0.5))'"),
    dt(BRAND_CHIP, ACCENT, 20, `w-text_w-40`, `${H}-38`,
      ":alpha='min(1,max(0,(t-0.35)/0.5))'"),
    ...fades(dur),
  ].join(",");
  const out = path.join(tmp, `beat${idx}.mp4`);
  sh("ffmpeg", ["-y", "-i", raw, "-vf", vf, ...X264, out]);
  segments.push(out);
  console.log(`  beat: ${beat.task} (${dur.toFixed(1)}s)`);
}

// ---- animated cards (push-in + staggered text fades) -----------------------
function makeCard(lines, sec, name) {
  const texts = lines.map((l) =>
    dt(l.text, l.color, l.size, "(w-text_w)/2", l.y,
      `:alpha='min(1,max(0,(t-${l.at})/0.5))'`),
  );
  const vf = [
    ...texts,
    `zoompan=z='min(1.045,1+0.00025*on)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`,
    ...fades(sec),
  ].join(",");
  const out = path.join(tmp, `${name}.mp4`);
  sh("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `color=c=${BG}:s=${W}x${H}:d=${sec}:r=${FPS}`,
    "-vf", vf, ...X264, out,
  ]);
  segments.push(out);
  console.log(`  card: ${lines[0].text}`);
}

// ---- build ----------------------------------------------------------------
console.log("Building promo cut…");
BEATS.forEach((beat, idx) => {
  if (beat.divider) {
    makeCard(
      [{ text: beat.divider, color: ACCENT, size: 54, y: "(h/2)-30", at: 0.15 }],
      1.9,
      `divider${idx}`,
    );
    return;
  }
  makeBeat(beat, idx);
});
makeCard(CTA.lines, CTA.sec, "cta");

const listFile = path.join(tmp, "list.txt");
fs.writeFileSync(
  listFile,
  segments.map((s) => `file '${s.replace(/\\/g, "/")}'`).join("\n"),
  "utf8",
);
const day = new Date().toISOString().slice(0, 10);
const outDir = path.join(VIDEOS_DIR, day);
fs.mkdirSync(outDir, { recursive: true });
const silent = path.join(tmp, "promo-silent.mp4");
sh("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, ...X264, silent]);

const outFile = path.join(outDir, "opensidebar-promo-60s.mp4");
const durOut = parseFloat(
  sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", silent]),
);
if (MUSIC) {
  // Mix the user-supplied bed under the (video-only) cut, faded in/out.
  sh("ffmpeg", [
    "-y", "-i", silent, "-i", MUSIC,
    "-filter_complex",
    `[1:a]atrim=0:${durOut.toFixed(2)},afade=t=in:st=0:d=1.5,afade=t=out:st=${(durOut - 2.5).toFixed(2)}:d=2.5[a]`,
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
    outFile,
  ]);
} else {
  fs.copyFileSync(silent, outFile);
}

console.log(`\nDone: ${outFile}`);
console.log(`Duration: ${durOut.toFixed(1)}s, ${W}x${H} @ ${FPS}fps${MUSIC ? ", with music bed" : " (silent)"}`);
