#!/usr/bin/env node
/**
 * Build a demo collage: for each scene, a fade-in/out title card followed by the
 * recorded run clip re-timed to a uniform compact fast-motion length, with a
 * caption + persistent model bar overlaid. Segments are normalized to identical
 * geometry/fps/codec and each fades to/from black, so they join with the concat
 * demuxer (fade-through-black transitions) — no xfade offset math.
 *
 * Two "shows" are defined below (see SERVICENOW / FIXTURES): pick with --show.
 * ffmpeg-only. Encoder settings mirror the E2E harness
 * (apps/extension/tests/e2e/helpers/harness.ts:485-511) for artifact parity.
 * See docs/guides/demo-video-style.md for the house style.
 *
 * Usage:
 *   node scripts/build-demo-montage.mjs --show servicenow|fixtures [--scene-sec 17]
 *   node scripts/build-demo-montage.mjs --show <name> --stills   # PNG mockups
 * Clips are located by each scene's label under .artifacts/e2e/videos/, or pinned
 * via .artifacts/demo-clips.json ({ "<label>": "<clip path>" }).
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

// ---- the shows ------------------------------------------------------------
// Two collages from one script: pick with `--show servicenow|fixtures`.
// Each scene's `task` is the recorded clip's label (the WorkArena task id for
// the servicenow show, or the fixture testLabel for the fixtures show).

const SERVICENOW = {
  out: "opensidebar-servicenow-demo-collage.mp4",
  intro: {
    title: "OpenSidebar",
    subtitle: "An AI agent that operates ServiceNow — live, no integration",
    note: MODEL_LINE,
  },
  scenes: [
    { task: "order-developer-laptop", title: "Order from the service catalog", subtitle: "Browses the catalog, configures the item, and places the order", caption: 'Ordering 8× "Developer Laptop (Mac)" with a custom software config' },
    { task: "single-chart-value-retrieval", title: "Read a dashboard chart", subtitle: "Sees the chart and answers a quantitative question", caption: 'Reading a pie chart -> "Unsuccessful" = 1.06%' },
    { task: "filter-incident-list", title: "Filter a list with a structured query", subtitle: "Builds native ServiceNow filter conditions, not keyword guesses", caption: "Filtering incidents: Caller = System Administrator  OR  Priority = 4 – Low" },
    { task: "knowledge-base-search", title: "Search the knowledge base", subtitle: "Finds the right article and extracts the answer", caption: "Searching the knowledge base: how many floors is the main office?" },
    { task: "sort-incident-list", title: "Sort a list the way you need it", subtitle: "Applies a structured, native sort — not a manual click-through", caption: "Sorting the incident list by Priority (ascending)" },
  ],
  outro: { title: "One agent. Every ServiceNow workflow.", subtitle: "OpenSidebar", note: "Kimi K2.7 Code + GLM 5.2   ·   Fireworks AI" },
};

const FIXTURES = {
  out: "opensidebar-openweb-demo-collage.mp4",
  intro: {
    title: "OpenSidebar",
    subtitle: "One AI agent for the open web — no integration, no scripts",
    note: MODEL_LINE,
  },
  scenes: [
    { task: "settings-provider", title: "Bring your own provider", subtitle: "Pick your provider stack and models — your key, your choice", caption: "Choosing the provider stack: Fireworks · Moonshot · OpenRouter · Xiaomi" },
    { task: "online-shop", title: "Shop and check out", subtitle: "Adds to cart, applies a coupon, and completes the order", caption: "Add Air Zoom Pegasus 41 to cart · apply coupon SAVE10 · express shipping · checkout" },
    { task: "showcase-ashby-application", title: "Apply for a job", subtitle: "Fills a real recruiting application, field by field", caption: "Filling an Ashby job application from the candidate's details (stops before submit)" },
    { task: "vendor-onboarding-wizard", title: "Complete a multi-step wizard", subtitle: "Works a conditional form across steps, then reviews before submit", caption: "Completing a multi-step vendor-onboarding wizard, then submitting after review" },
    { task: "cross-page-compose", title: "Read here, act there", subtitle: "Carries data across pages to finish the job", caption: "Reading the dashboard's Total Users, then drafting an email that reports it" },
    { task: "information-extraction", title: "Find and extract", subtitle: "Pages through a directory and pulls the requested fields", caption: "Finding Diana Chen in the directory and reporting her department and salary" },
  ],
  outro: { title: "Any website today. Your enterprise apps next.", subtitle: "OpenSidebar", note: "Kimi K2.7 Code + GLM 5.2   ·   Fireworks AI" },
};

const TRACEVIEWER = {
  out: "opensidebar-traceviewer-demo-collage.mp4",
  // The subject is the viewer itself, so the band credits the tool, not the
  // model seats (the featured runs still show their model inline).
  bar: "OpenSidebar   ·   Built-in trace viewer   ·   every session, replayable locally",
  intro: {
    title: "OpenSidebar",
    subtitle: "See every decision — the built-in trace viewer",
    note: "Every agent session, fully inspectable: replays, costs, screenshots",
  },
  scenes: [
    { task: "traceviewer-fleet", title: "Your fleet at a glance", subtitle: "Every run with outcome, turns, cost, and failure clusters", caption: "Reviewing 260 runs · 82% success · per-run cost and failure clusters" },
    { task: "traceviewer-session", title: "Replay any session, turn by turn", subtitle: "Scorecards, tool calls, and evidence for every decision", caption: 'Replaying "Find Diana Chen": 6 turns, 5/5 trajectory score, $0.062 total' },
    { task: "traceviewer-perception", title: "See what the agent saw", subtitle: "Each turn's screenshot and page affordances, then the cost roll-up", caption: "The agent's own screenshot + page affordances, then token & cost metrics" },
  ],
  outro: { title: "Trust, but verify — locally.", subtitle: "OpenSidebar", note: "Traces never leave your machine · no telemetry" },
};

const SETTINGS = {
  out: "opensidebar-settings-demo-collage.mp4",
  intro: {
    title: "OpenSidebar",
    subtitle: "Bring your own provider — your key, your models",
    note: "Fireworks · OpenRouter · Moonshot · Xiaomi — BYOK, no subscription",
  },
  scenes: [
    { task: "settings-provider", title: "Choose your provider stack", subtitle: "Swap providers and per-seat models in Settings — nothing hardcoded", caption: "Provider stack: Fireworks · Moonshot · OpenRouter · Xiaomi, with per-seat model overrides" },
  ],
  outro: { title: "Your key. Your models. Your browser.", subtitle: "OpenSidebar", note: "No subscription · No telemetry · Open source" },
};

const WATCH = {
  out: "opensidebar-watch-demo-collage.mp4",
  intro: {
    title: "OpenSidebar",
    subtitle: "Watch Mode — it keeps an eye on the page for you",
    note: "Leave it watching · it speaks up the moment something changes",
  },
  scenes: [
    { task: "watch-restock", title: "Watch a page, get told when it changes", subtitle: "Set a standing instruction; the agent watches passively and flags the moment it happens", caption: 'Watching a product page — flagged "back in stock" the instant it flipped' },
  ],
  outro: { title: "Set it and forget it.", subtitle: "OpenSidebar Watch Mode", note: "Kimi K2.7 Code + GLM 5.2 · Fireworks AI" },
};

// The full pitch: one presentation across every capability, in three acts,
// closing with ServiceNow as the "extendable / enterprise" finale.
const PITCH = {
  out: "opensidebar-pitch-demo-collage.mp4",
  intro: {
    title: "OpenSidebar",
    subtitle: "An AI agent that drives your browser",
    note: MODEL_LINE,
  },
  scenes: [
    { section: "On the open web", task: "online-shop", title: "Shop and check out", subtitle: "Adds to cart, applies a coupon, and completes the order", caption: "Add Air Zoom Pegasus 41 to cart · apply coupon SAVE10 · express shipping · checkout" },
    { task: "cross-page-compose", title: "Read here, act there", subtitle: "Carries data across pages to finish the job", caption: "Reading the dashboard's Total Users, then drafting an email that reports it" },
    { task: "vendor-onboarding-wizard", title: "Complete a multi-step wizard", subtitle: "Works a conditional form across steps, then reviews before submit", caption: "Completing a multi-step vendor-onboarding wizard, then submitting after review" },
    { section: "You stay in control", task: "settings-provider", title: "Bring your own provider", subtitle: "Swap providers and per-seat models — your key, nothing hardcoded", caption: "Provider stack: Fireworks · Moonshot · OpenRouter · Xiaomi, with per-seat model overrides" },
    { task: "watch-restock", title: "Watch Mode", subtitle: "Leave it watching; it speaks up the moment the page changes", caption: 'Watching a product page — flagged "back in stock" the instant it flipped' },
    { task: "traceviewer-session", title: "Built-in observability", subtitle: "An observability workspace records every run — decisions, screenshots, exact cost", caption: 'Inspecting a run in the observability workspace: 6 turns, 5/5 score, $0.062 total' },
    { section: "Extendable — ServiceNow", task: "order-developer-laptop", title: "Built to be extended", subtitle: "ServiceNow support is an adapter — the same pattern fits your own enterprise apps", caption: 'Ordering 8× "Developer Laptop (Mac)" from the service catalog, end to end', sceneSec: 18 },
  ],
  outro: { title: "Any website today. Your enterprise apps next.", subtitle: "OpenSidebar", note: "Bring your own key · No telemetry · Open source (MIT) · Fork it on GitHub" },
};

const SHOW = { servicenow: SERVICENOW, fixtures: FIXTURES, traceviewer: TRACEVIEWER, settings: SETTINGS, watch: WATCH, pitch: PITCH }[argVal("--show", "servicenow")] || SERVICENOW;
const INTRO = SHOW.intro;
const SCENES = SHOW.scenes;
const OUTRO = SHOW.outro;

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
      if (f.endsWith(`${task}-view.mp4`)) {
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
// expansion=none renders the text literally — otherwise drawtext treats "%"
// (e.g. "82% success") as an expansion token and drops the rest of the line.
const dt = (file, color, size, x, y) =>
  `drawtext=fontfile=${FONT}:textfile=${file}:fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}:expansion=none`;
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

// Section-divider card: a small grey kicker ("PART ONE") over a large accent
// title. Used by multi-act shows (e.g. the pitch) to frame each act.
const PART_WORDS = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"];
function sectionCardParts(title, partIndex) {
  const kicker = `PART ${PART_WORDS[partIndex] ?? String(partIndex + 1)}`;
  return [
    dt(textfile(kicker), GREY, 30, "(w-text_w)/2", "(h/2)-70"),
    dt(textfile(title), ACCENT, 60, "(w-text_w)/2", "(h/2)+2"),
  ];
}
const SECTION_CARD_SEC = 2.6;
function makeSectionCard(title, partIndex, name) {
  const out = path.join(tmp, `${name}.mp4`);
  const vf = [
    ...sectionCardParts(title, partIndex),
    `fade=t=in:st=0:d=${FADE}`,
    `fade=t=out:st=${(SECTION_CARD_SEC - FADE).toFixed(2)}:d=${FADE}`,
  ].join(",");
  sh("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `color=c=${BG}:s=${W}x${H}:d=${SECTION_CARD_SEC}:r=${FPS}`,
    "-vf", vf, ...X264, out,
  ]);
  segments.push(out);
  console.log(`  section: ${title}`);
}

// The bottom band (caption + persistent model bar) applied to every scene.
function overlayBand(caption) {
  const bandH = 150;
  return [
    `drawbox=x=0:y=${H}-${bandH}:w=${W}:h=${bandH}:color=black@0.55:t=fill`,
    dt(textfile(caption), "white", 40, "60", `${H}-118`),
    dt(textfile(SHOW.bar || MODEL_BAR), ACCENT, 26, "60", `${H}-56`),
  ];
}

// Scene body (speed + normalize + band, no fades) — shared by video and stills.
// sceneSec: per-scene length override (scene.sceneSec), else the global SCENE_SEC.
function sceneBase(clip, caption, sceneSec = SCENE_SEC) {
  const dur = ffprobeDuration(clip);
  const speed = Math.max(dur / sceneSec, 0.01); // fast-motion factor
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
function makeScene(clip, name, caption, sceneSec = SCENE_SEC) {
  const { base, speed, dur } = sceneBase(clip, caption, sceneSec);
  const out = path.join(tmp, `${name}.mp4`);
  const vf = [...base, ...fades(sceneSec)].join(",");
  sh("ffmpeg", ["-y", "-i", clip, "-vf", vf, "-t", String(sceneSec), ...X264, out]);
  segments.push(out);
  console.log(`  scene: ${clip}  (${dur.toFixed(0)}s -> ${sceneSec}s, ${speed.toFixed(1)}x)`);
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
  const firstSection = SCENES.find((x) => x.section)?.section;
  if (firstSection) {
    sh("ffmpeg", [
      "-y", "-f", "lavfi", "-i", `color=c=${BG}:s=${W}x${H}:d=1:r=1`,
      "-vf", sectionCardParts(firstSection, 0).join(","),
      "-frames:v", "1", path.join(outDir, "05-section-card.png"),
    ]);
  }
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
let currentSection = null;
let partIndex = -1;
SCENES.forEach((s, i) => {
  const clip = newestClipForTask(s.task);
  if (!clip) {
    missing.push(s.task);
    console.log(`  !! no clip found for ${s.task} — skipping`);
    return;
  }
  if (s.section && s.section !== currentSection) {
    currentSection = s.section;
    partIndex += 1;
    makeSectionCard(s.section, partIndex, `section${i}`);
  }
  makeCard(s, `card${i}`);
  makeScene(clip, `scene${i}`, s.caption, s.sceneSec ?? SCENE_SEC);
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
// Finished collages land in .artifacts/publish/ — the single folder holding
// every publish-ready video (raw recordings stay under e2e/videos/<date>/).
const outDir = path.join(ROOT, ".artifacts", "publish");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, SHOW.out);
sh("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, ...X264, outFile]);

const finalDur = ffprobeDuration(outFile);
console.log(`\nDone: ${outFile}`);
console.log(`Duration: ${finalDur.toFixed(1)}s, ${W}x${H} @ ${FPS}fps`);
if (missing.length) console.log(`Missing clips (excluded): ${missing.join(", ")}`);
