#!/usr/bin/env node
/**
 * Build a ServiceNow demo collage: for each scene, a fade-in/out title card
 * followed by the recorded run clip re-timed to a uniform compact fast-motion
 * length. Segments are normalized to identical geometry/fps/codec and each fades
 * to/from black, so they join with the concat demuxer (fade-through-black
 * transitions) — no xfade offset math.
 *
 * ffmpeg-only. Encoder settings mirror the E2E harness
 * (apps/extension/tests/e2e/helpers/harness.ts:485-511) for artifact parity.
 *
 * Usage:
 *   node scripts/build-demo-montage.mjs [--out <path>] [--scene-sec 12]
 * Clips are located automatically by task id under .artifacts/e2e/videos/.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VIDEOS_DIR = path.join(ROOT, ".artifacts", "e2e", "videos");
const SYS_FONT = "C:/Windows/Fonts/segoeuib.ttf"; // Segoe UI Bold

// ---- tunables -------------------------------------------------------------
const args = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const SCENE_SEC = Number(argVal("--scene-sec", "17")); // uniform scene length
const CARD_SEC = Number(argVal("--card-sec", "3.0")); // title card length
const FADE = 0.4;
const W = 1920,
  H = 1080,
  FPS = 30;
const BG = "0x0B1F33"; // deep navy card background
const ACCENT = "0x4FC3F7";
const GREY = "0xB8C4D0";
const X264 = [
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
];

// Persistent brand + model credit, pinned to the bottom band of every scene.
const MODEL_BAR =
  "OpenSidebar   ·   Executor: Kimi K2.7 Code (vision)   ·   Planner: GLM 5.2   ·   Fireworks AI";
const MODEL_LINE =
  "Executor: Kimi K2.7 Code (vision)   ·   Planner: GLM 5.2   ·   served on Fireworks AI";

// ---- the demo, in order ---------------------------------------------------
const INTRO = {
  title: "OpenSidebar",
  subtitle: "An AI agent that operates ServiceNow — live, no integration",
  note: MODEL_LINE,
};
const SCENES = [
  {
    task: "order-developer-laptop",
    title: "Order from the service catalog",
    subtitle: "Browses the catalog, configures the item, and places the order",
    caption: 'Ordering 8× "Developer Laptop (Mac)" with a custom software config',
  },
  {
    task: "single-chart-value-retrieval",
    title: "Read a dashboard chart",
    subtitle: "Sees the chart and answers a quantitative question",
    caption: 'Reading a pie chart -> "Unsuccessful" = 1.06%',
  },
  {
    task: "filter-incident-list",
    title: "Filter a list with a structured query",
    subtitle: "Builds native ServiceNow filter conditions, not keyword guesses",
    caption: "Filtering incidents: Caller = System Administrator  OR  Priority = 4 – Low",
  },
  {
    task: "knowledge-base-search",
    title: "Search the knowledge base",
    subtitle: "Finds the right article and extracts the answer",
    caption: "Searching the knowledge base: how many floors is the main office?",
  },
  {
    task: "sort-incident-list",
    title: "Sort a list the way you need it",
    subtitle: "Applies a structured, native sort — not a manual click-through",
    caption: "Sorting the incident list by Priority (ascending)",
  },
];
const OUTRO = {
  title: "One agent. Every ServiceNow workflow.",
  subtitle: "OpenSidebar",
  note: "Kimi K2.7 Code + GLM 5.2   ·   Fireworks AI",
};

// ---- helpers --------------------------------------------------------------
function sh(bin, a) {
  return execFileSync(bin, a, { stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();
}
function ffprobeDuration(file) {
  const out = sh("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]);
  const d = parseFloat(out);
  return Number.isFinite(d) && d > 0 ? d : SCENE_SEC;
}
// Optional pin file: { "<task>": "<clip path>" } to lock specific clips instead
// of auto-picking the newest recording (used to choose the cleanest take).
const PIN_FILE = path.join(ROOT, ".artifacts", "demo-clips.json");
const PINS = fs.existsSync(PIN_FILE)
  ? JSON.parse(fs.readFileSync(PIN_FILE, "utf8"))
  : {};

function newestClipForTask(task) {
  if (PINS[task]) {
    const p = path.isAbsolute(PINS[task]) ? PINS[task] : path.join(ROOT, PINS[task]);
    if (fs.existsSync(p)) return p;
    console.log(`  !! pinned clip for ${task} not found: ${PINS[task]}`);
  }
  if (!fs.existsSync(VIDEOS_DIR)) return null;
  const matches = [];
  for (const day of fs.readdirSync(VIDEOS_DIR)) {
    const dir = path.join(VIDEOS_DIR, day);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(`${task}-view.mp4`) && f.includes("workarena-handoff")) {
        const p = path.join(dir, f);
        matches.push({ p, m: fs.statSync(p).mtimeMs });
      }
    }
  }
  matches.sort((a, b) => b.m - a.m);
  return matches[0]?.p ?? null;
}
// ffmpeg's filtergraph parser splits on ':' and can't be reliably fed a Windows
// drive path (C:/...) for fontfile/textfile even when escaped. So we work with
// cwd-relative, colon-free paths: copy the font into the temp dir and read text
// from files, both referenced relative to ROOT.
const tmp = fs.mkdtempSync(path.join(ROOT, ".artifacts", "montage-"));
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/"); // colon-free for the filtergraph
const FONT = rel(path.join(tmp, "font.ttf"));
fs.copyFileSync(SYS_FONT, path.join(tmp, "font.ttf"));
let cardIdx = 0;
function textfile(str) {
  const f = path.join(tmp, `t${cardIdx++}.txt`);
  fs.writeFileSync(f, str, "utf8");
  return rel(f);
}

const segments = [];
const dt = (file, color, size, x, y) =>
  `drawtext=fontfile=${FONT}:textfile=${file}:fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}`;
const fades = (len) => [
  `fade=t=in:st=0:d=${FADE}`,
  `fade=t=out:st=${(len - FADE).toFixed(2)}:d=${FADE}`,
];

// Title-card text (no fades) — shared by the video and the still mockups.
function cardParts(card) {
  const parts = [
    dt(textfile(card.title), "white", 68, "(w-text_w)/2", "(h/2)-90"),
    dt(textfile(card.subtitle), ACCENT, 34, "(w-text_w)/2", "(h/2)+10"),
  ];
  if (card.note) parts.push(dt(textfile(card.note), GREY, 26, "(w-text_w)/2", "(h/2)+92"));
  return parts;
}

// The bottom band (caption + persistent model bar) applied to every scene.
function overlayBand(caption) {
  const bandH = 150;
  return [
    `drawbox=x=0:y=${H}-${bandH}:w=${W}:h=${bandH}:color=black@0.55:t=fill`,
    dt(textfile(caption), "white", 40, "60", `${H}-118`),
    dt(textfile(MODEL_BAR), ACCENT, 26, "60", `${H}-56`),
  ];
}

// Scene body (speed + normalize + band, no fades) — shared by video and stills.
function sceneBase(clip, caption) {
  const dur = ffprobeDuration(clip);
  const speed = Math.max(dur / SCENE_SEC, 0.01); // fast-motion factor
  const base = [
    `setpts=PTS/${speed.toFixed(4)}`,
    `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`,
    `fps=${FPS}`, "setsar=1", "format=yuv420p",
    ...overlayBand(caption),
  ];
  return { base, speed, dur };
}

function makeCard(card, name) {
  const out = path.join(tmp, `${name}.mp4`);
  const vf = [...cardParts(card), ...fades(CARD_SEC)].join(",");
  sh("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `color=c=${BG}:s=${W}x${H}:d=${CARD_SEC}:r=${FPS}`,
    "-vf", vf, ...X264, out,
  ]);
  segments.push(out);
  console.log(`  card: ${card.title}`);
}
function makeScene(clip, name, caption) {
  const { base, speed, dur } = sceneBase(clip, caption);
  const out = path.join(tmp, `${name}.mp4`);
  const vf = [...base, ...fades(SCENE_SEC)].join(",");
  sh("ffmpeg", ["-y", "-i", clip, "-vf", vf, "-t", String(SCENE_SEC), ...X264, out]);
  segments.push(out);
  console.log(`  scene: ${clip}  (${dur.toFixed(0)}s -> ${SCENE_SEC}s, ${speed.toFixed(1)}x)`);
}

// ---- stills mode (design sign-off before the full build) ------------------
if (args.includes("--stills")) {
  const outDir = path.join(VIDEOS_DIR, new Date().toISOString().slice(0, 10), "mockups");
  fs.mkdirSync(outDir, { recursive: true });
  const cardStill = (card, file) =>
    sh("ffmpeg", [
      "-y", "-f", "lavfi", "-i", `color=c=${BG}:s=${W}x${H}:d=1:r=1`,
      "-vf", cardParts(card).join(","), "-frames:v", "1", path.join(outDir, file),
    ]);
  cardStill(INTRO, "01-intro-card.png");
  cardStill(SCENES[0], "02-title-card.png");
  cardStill(OUTRO, "04-outro-card.png");
  const s = SCENES.find((x) => newestClipForTask(x.task)) || SCENES[0];
  const clip = newestClipForTask(s.task);
  if (clip) {
    const seek = (ffprobeDuration(clip) * 0.85).toFixed(1); // late frame = real content
    sh("ffmpeg", [
      "-y", "-ss", seek, "-i", clip, "-vf", sceneBase(clip, s.caption).base.join(","),
      "-frames:v", "1", path.join(outDir, "03-scene-frame.png"),
    ]);
  }
  console.log("Mockup stills written to:", outDir);
  process.exit(0);
}

// ---- build ----------------------------------------------------------------
console.log("Building demo collage…");
makeCard(INTRO, "intro");
let missing = [];
SCENES.forEach((s, i) => {
  const clip = newestClipForTask(s.task);
  if (!clip) {
    missing.push(s.task);
    console.log(`  !! no clip found for ${s.task} — skipping`);
    return;
  }
  makeCard(s, `card${i}`);
  makeScene(clip, `scene${i}`, s.caption);
});
makeCard(OUTRO, "outro");

if (segments.length <= 2) {
  console.error("Not enough scenes recorded; aborting.");
  process.exit(1);
}

// concat demuxer
const listFile = path.join(tmp, "list.txt");
fs.writeFileSync(
  listFile,
  segments.map((s) => `file '${s.replace(/\\/g, "/")}'`).join("\n"),
  "utf8",
);
const day = new Date().toISOString().slice(0, 10);
const outDir = path.join(VIDEOS_DIR, day);
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "opensidebar-servicenow-demo-collage.mp4");
sh("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, ...X264, outFile]);

const finalDur = ffprobeDuration(outFile);
console.log(`\nDone: ${outFile}`);
console.log(`Duration: ${finalDur.toFixed(1)}s, ${W}x${H} @ ${FPS}fps`);
if (missing.length) console.log(`Missing clips (excluded): ${missing.join(", ")}`);
