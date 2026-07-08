#!/usr/bin/env node
/**
 * Mix an ElevenLabs voiceover onto an already-rendered publish video.
 * The narration specs below are timed to the exact segment structure of each
 * cut (see build-promo-cut.mjs / build-demo-montage.mjs), so every line has a
 * hard start offset and a max window it must fit.
 *
 *   node scripts/add-voiceover.mjs --video promo|pitch
 *     [--voice <elevenlabs voice id>]   default: Rachel (21m00Tcm4TlvDq8ikWAM)
 *     [--music <file>]                  optional bed, ducked under narration
 *
 * Key: ELEVENLABS_API_KEY or ELEVENLAB_API_KEY, from the env or the repo .env.
 * Generated lines are cached in .artifacts/vo/ by content hash — tweaking one
 * line only re-bills that line. Video frames are never re-encoded (-c:v copy).
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PUBLISH = path.join(ROOT, ".artifacts", "publish");
const VO_CACHE = path.join(ROOT, ".artifacts", "vo");

const argVal = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const WHICH = argVal("--video", "promo");
const VOICE = argVal("--voice", "21m00Tcm4TlvDq8ikWAM"); // "Rachel" — warm professional female
const MUSIC = argVal("--music", "");

// ---- narration specs --------------------------------------------------------
// at: line start (s) · maxSec: hard window the audio must fit (atempo ≤1.1 helps)
const SPECS = {
  promo: {
    in: "opensidebar-promo-60s.mp4",
    out: "opensidebar-promo-60s-voiced.mp4",
    lines: [
      { at: 0.6, maxSec: 12.0, text: "This is OpenSidebar — an AI agent in your browser. Give it a task, and it does the clicking: cart, coupon, checkout. Done." },
      { at: 13.6, maxSec: 13.0, text: "It reads data on one page and writes it into another — here, turning dashboard numbers into an email reply." },
      { at: 27.4, maxSec: 8.5, text: "And it can simply watch. The moment this product is back in stock — it speaks up." },
      { at: 36.5, maxSec: 14.0, text: "It's not just the open web. The same agent drives enterprise apps like ServiceNow, end to end." },
      { at: 51.5, maxSec: 6.3, text: "OpenSidebar. Free, open source, bring your own key." },
    ],
  },
  pitch: {
    in: "opensidebar-pitch-demo-collage.mp4",
    out: "opensidebar-pitch-demo-collage-voiced.mp4",
    // Structure: intro 3.0 · section 2.6 · [card 3.0 + scene 13.0] · … · outro 3.0
    lines: [
      { at: 0.5, maxSec: 7.8, text: "This is OpenSidebar — an open-source AI agent that drives your browser. Part one: the open web." },
      { at: 8.9, maxSec: 12.4, text: "Give it a shopping task and it works the whole flow: add to cart, apply the coupon, choose shipping, and place the order." },
      { at: 24.9, maxSec: 12.4, text: "It carries data across pages — reading this dashboard, then drafting an email that reports the numbers." },
      { at: 40.9, maxSec: 12.4, text: "Multi-step wizards are no problem: it fills each step, then reviews before submitting." },
      { at: 56.4, maxSec: 15.4, text: "Part two: you stay in control. It runs on your own key — pick your provider and models in settings." },
      { at: 75.5, maxSec: 12.4, text: "Watch Mode keeps an eye on a page for you, and speaks up the moment something changes." },
      { at: 91.5, maxSec: 12.4, text: "And every session is replayable in the built-in trace viewer — every turn, every screenshot, and the exact cost." },
      { at: 107.0, maxSec: 15.4, text: "Part three: the same agent extends to enterprise apps like ServiceNow — ordering from the service catalog…" },
      { at: 126.1, maxSec: 12.4, text: "…and reading live dashboards to answer questions with real numbers." },
      { at: 138.6, maxSec: 3.1, text: "OpenSidebar. Free and open source." },
    ],
  },
};

const spec = SPECS[WHICH];
if (!spec) {
  console.error(`Unknown --video "${WHICH}" (use: ${Object.keys(SPECS).join("|")})`);
  process.exit(1);
}

// ---- key loading (env, then repo .env; never logged) ------------------------
function loadKey() {
  for (const name of ["ELEVENLABS_API_KEY", "ELEVENLAB_API_KEY"]) {
    if (process.env[name]) return process.env[name];
  }
  const envPath = path.join(ROOT, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^ELEVENLABS?_API_KEY=(.+)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

function sh(bin, a) {
  return execFileSync(bin, a, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}
const dur = (f) =>
  parseFloat(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]));

// ---- TTS with cache ---------------------------------------------------------
async function tts(key, text) {
  fs.mkdirSync(VO_CACHE, { recursive: true });
  // v2: leading-break generation + onset normalization (bump on pipeline change)
  const hash = crypto.createHash("sha1").update(`v2|${VOICE}|${text}`).digest("hex").slice(0, 16);
  const cached = path.join(VO_CACHE, `${hash}.mp3`);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 0) return { file: cached, cached: true };

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Leading break: ElevenLabs cold-starts clip the first phoneme's attack
        // when speech begins at sample zero; the break makes it render fully.
        // The added silence is trimmed back off deterministically after (below),
        // so line timing math is unaffected.
        text: `<break time="0.3s" /> ${text}`,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
  }
  const rawFile = cached.replace(/\.mp3$/, "-raw.mp3");
  fs.writeFileSync(rawFile, Buffer.from(await res.arrayBuffer()));
  // Normalize the onset: strip the lead-in down to nothing, then re-pad a fixed
  // 60ms and add a 30ms fade-in — full phoneme preserved, no click, and every
  // line starts a predictable 60ms after its `at` offset.
  sh("ffmpeg", [
    "-y", "-i", rawFile,
    "-af",
    "silenceremove=start_periods=1:start_threshold=-45dB,adelay=60|60,afade=t=in:d=0.03",
    cached,
  ]);
  fs.unlinkSync(rawFile);
  return { file: cached, cached: false };
}

// ---- main -------------------------------------------------------------------
const key = loadKey();
if (!key) {
  console.error("No ELEVENLABS_API_KEY / ELEVENLAB_API_KEY in the environment or .env");
  process.exit(1);
}
const inFile = path.join(PUBLISH, spec.in);
if (!fs.existsSync(inFile)) {
  console.error(`Missing ${inFile} — build it first.`);
  process.exit(1);
}
const videoDur = dur(inFile);

console.log(`Voicing ${spec.in} (${videoDur.toFixed(1)}s) with voice ${VOICE}…`);
let chars = 0;
const prepared = [];
for (const [i, line] of spec.lines.entries()) {
  chars += line.text.length;
  const { file, cached } = await tts(key, line.text);
  let d = dur(file);
  let use = file;
  let tempo = 1;
  if (d > line.maxSec) {
    tempo = Math.min(1.1, d / line.maxSec);
    const squeezed = file.replace(/\.mp3$/, `-t${tempo.toFixed(3)}.mp3`);
    sh("ffmpeg", ["-y", "-i", file, "-af", `atempo=${tempo.toFixed(4)}`, squeezed]);
    use = squeezed;
    d = dur(use);
    if (d > line.maxSec + 0.15) {
      console.error(
        `Line ${i + 1} is ${d.toFixed(1)}s even at ${tempo.toFixed(2)}x — max ${line.maxSec}s. Shorten: "${line.text.slice(0, 60)}…"`,
      );
      process.exit(1);
    }
  }
  prepared.push({ ...line, file: use, dur: d });
  console.log(
    `  line ${i + 1} @${line.at}s: ${d.toFixed(1)}s / ${line.maxSec}s${tempo > 1 ? ` (atempo ${tempo.toFixed(2)})` : ""}${cached ? " [cached]" : ""}`,
  );
}
console.log(`  total ${chars} characters sent to TTS`);

// Build the mix: each line delayed to its offset, then all mixed.
const inputs = ["-i", inFile];
const parts = [];
prepared.forEach((l, i) => {
  inputs.push("-i", l.file);
  parts.push(
    `[${i + 1}:a]adelay=${Math.round(l.at * 1000)}|${Math.round(l.at * 1000)},apad[v${i}]`,
  );
});
const voMix = `${parts.join(";")};${prepared.map((_, i) => `[v${i}]`).join("")}amix=inputs=${prepared.length}:normalize=0,atrim=0:${videoDur.toFixed(2)}[vo]`;

let filter, mapAudio;
const hasSourceAudio =
  sh("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", inFile]) !== "";
if (MUSIC || hasSourceAudio) {
  // Duck the bed under narration (VO drives the sidechain), then sum.
  const bedIdx = prepared.length + 1;
  if (MUSIC) inputs.push("-i", MUSIC);
  const bedSrc = MUSIC ? `[${bedIdx}:a]` : `[0:a]`;
  filter =
    `${voMix};` +
    `${bedSrc}atrim=0:${videoDur.toFixed(2)},volume=0.9[bed];` +
    `[vo]asplit=2[voMain][voSc];` +
    `[bed][voSc]sidechaincompress=threshold=0.03:ratio=12:attack=40:release=400[ducked];` +
    `[voMain][ducked]amix=inputs=2:normalize=0[aout]`;
  mapAudio = "[aout]";
} else {
  filter = voMix;
  mapAudio = "[vo]";
}

const outFile = path.join(PUBLISH, spec.out);
sh("ffmpeg", [
  "-y", ...inputs,
  "-filter_complex", filter,
  "-map", "0:v", "-map", mapAudio,
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
  "-t", videoDur.toFixed(2),
  outFile,
]);

const outDur = dur(outFile);
console.log(`\nDone: ${outFile}`);
console.log(`Duration: ${outDur.toFixed(1)}s (video ${videoDur.toFixed(1)}s)`);
