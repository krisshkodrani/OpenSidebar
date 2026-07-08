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
const VOICE = argVal("--voice", "XrExE9yKIg1WjnnlVkGX"); // "Matilda" — warm narrative female (bake-off winner)
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
    // Structure (extended tour, --scene-sec 15): intro 3.0 · section 2.6 ·
    // [card 3.0 + scene 15.0]×5 · section 2.6 · [card 3.0 + scene 15.0]×4 ·
    // section 2.6 · [card 3.0 + scene 18.0] · [card 3.0 + scene 15.0] · outro 3.0
    // = 214.8s. Scene starts: 8.6/26.6/44.6/62.6/80.6 · 101.2/119.2/137.2/155.2 ·
    // 175.8(18s)/196.8.
    lines: [
      { at: 0.5, maxSec: 7.9, text: "This is OpenSidebar — an open-source AI agent doing real work in your browser. Part one: the open web." },
      { at: 8.9, maxSec: 17.4, text: "Give it a task in plain English. A planner breaks it into steps, an executor drives the page, and a verifier checks the result. Watch it find the product, apply the coupon, pick express shipping, and place the order." },
      { at: 26.9, maxSec: 17.4, text: "It carries context across pages — no copy-paste, no tab juggling. Here it reads the key numbers from a dashboard, then opens the mail client and drafts a reply that reports them." },
      { at: 44.9, maxSec: 17.4, text: "Long, conditional forms are where automation usually breaks. OpenSidebar works the wizard step by step, keeps track of what it has already filled, and reviews everything before submitting." },
      { at: 62.9, maxSec: 17.4, text: "It can complete a real job application — filling the candidate's details field by field. And for consequential actions like the final submit, it pauses and leaves the last word to you." },
      { at: 80.9, maxSec: 17.4, text: "Need something buried in a paginated directory? It searches, pages through the results, and reports back exactly the fields you asked for." },
      { at: 95.9, maxSec: 20.0, text: "Part two: you stay in control. There's no subscription and no middleman — you bring your own API key and pick your provider and models: Fireworks, Moonshot, OpenRouter, or Xiaomi, with a separate choice for every seat." },
      { at: 119.5, maxSec: 17.4, text: "Watch Mode turns the agent into a quiet observer: give it a standing instruction and leave the tab open. The moment the page changes, it speaks up — here, the instant this product is back in stock." },
      { at: 137.5, maxSec: 17.4, text: "Everything is observable. The built-in observability workspace records every run — each decision the model made, what it saw on screen, and the exact cost. This entire task ran for about six cents." },
      { at: 155.5, maxSec: 17.4, text: "Zoom out, and the same workspace shows the whole fleet: success rates, failure clusters, and spend across hundreds of runs — stored locally; nothing leaves your machine." },
      { at: 170.5, maxSec: 22.0, text: "Part three: it's built to be extended. ServiceNow support ships as an adapter in the open-source repo — watch it navigate the service catalog, configure a laptop with the requested software, and submit the order end to end." },
      { at: 197.1, maxSec: 17.4, text: "The same adapter searches the knowledge base, filters lists, and sorts natively. And the pattern is yours to copy — a custom adapter and skills can teach the agent your own enterprise apps." },
      // Starts on the finale's fade-out so the sign-off lands on the outro card.
      { at: 211.9, maxSec: 3.5, text: "OpenSidebar. Open source — make it yours." },
    ],
  },
};

// Store-accurate tour (--show store): the pitch minus the two observability
// scenes (the trace viewer is dev-only and does not ship in the store package).
// Same line texts as the pitch (cache hits) at recomputed offsets.
// Structure: intro 3 · sec 2.6 · 5×(3+15) · sec 2.6 · 2×(3+15) · sec 2.6 ·
// (3+18) · (3+15) · outro 3 = 178.8s. Scene starts: 8.6/26.6/44.6/62.6/80.6 ·
// 101.2/119.2 · 139.8(18s)/160.8.
SPECS.store = {
  in: "opensidebar-store-tour.mp4",
  out: "opensidebar-store-tour-voiced.mp4",
  lines: [
    { ...SPECS.pitch.lines[0] },                                // intro @0.5
    { ...SPECS.pitch.lines[1] },                                // shop @8.9
    { ...SPECS.pitch.lines[2] },                                // compose @26.9
    { ...SPECS.pitch.lines[3] },                                // wizard @44.9
    { ...SPECS.pitch.lines[4] },                                // ashby @62.9
    { ...SPECS.pitch.lines[5] },                                // extract @80.9
    { ...SPECS.pitch.lines[6] },                                // part two + settings @95.9
    { ...SPECS.pitch.lines[7] },                                // watch @119.5
    { ...SPECS.pitch.lines[10], at: 134.8 },                    // part three + SN order
    { ...SPECS.pitch.lines[11], at: 161.1 },                    // SN KB / adapter pattern
    { at: 175.9, maxSec: 3.5, text: "OpenSidebar. Free — bring your own key." },
  ],
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
  // v4: livelier voice settings (stability .4, style .35) (bump on pipeline change)
  const hash = crypto.createHash("sha1").update(`v4|${VOICE}|${text}`).digest("hex").slice(0, 16);
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
        // Breaks also often render a small breath/murmur artifact, so the whole
        // break region is hard-trimmed by TIME below (not silence detection).
        text: `<break time="0.5s" /> ${text}`,
        model_id: "eleven_multilingual_v2",
        // Livelier delivery than the flat defaults: lower stability + some style.
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.75,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
  }
  const rawFile = cached.replace(/\.mp3$/, "-raw.mp3");
  fs.writeFileSync(rawFile, Buffer.from(await res.arrayBuffer()));
  // Onset normalization, artifact-proof:
  //   1. hard-trim 0.35s by TIME — removes the break region including any breath
  //      artifact it rendered (which sits above silence-detect thresholds);
  //   2. silence-strip whatever quiet lead remains (~0.15s margin to speech);
  //   3. re-pad a fixed 60ms and fade in over 50ms.
  // Result: full first phoneme, no breath blip, predictable 60ms lead.
  sh("ffmpeg", [
    "-y", "-i", rawFile,
    "-af",
    "atrim=start=0.35,asetpts=PTS-STARTPTS," +
      "silenceremove=start_periods=1:start_threshold=-45dB," +
      "adelay=60|60,afade=t=in:d=0.05",
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

// --bakeoff: render the promo's first line in candidate voices so the owner can
// pick by ear (samples in .artifacts/publish/voice-samples/, then re-run with
// --voice <winner id>).
if (process.argv.includes("--bakeoff")) {
  const candidates = [
    { name: "rachel-retuned", id: "21m00Tcm4TlvDq8ikWAM" },
    { name: "matilda", id: "XrExE9yKIg1WjnnlVkGX" },
    { name: "jessica", id: "cgSgspJ2msm6clMCkdW9" },
  ];
  const sampleDir = path.join(PUBLISH, "voice-samples");
  fs.mkdirSync(sampleDir, { recursive: true });
  const sampleText = SPECS.promo.lines[0].text;
  for (const c of candidates) {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${c.id}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `<break time="0.5s" /> ${sampleText}`,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true },
        }),
      },
    );
    if (!res.ok) throw new Error(`ElevenLabs ${res.status} for ${c.name}`);
    fs.writeFileSync(path.join(sampleDir, `${c.name}.mp3`), Buffer.from(await res.arrayBuffer()));
    console.log(`  sample: voice-samples/${c.name}.mp3 (${c.id})`);
  }
  console.log(`\nListen in ${sampleDir}, then re-run with --voice <id> for the winner.`);
  process.exit(0);
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
// Mix all lines, then master the VO bus: gentle compression for presence, then
// loudness normalization to the -16 LUFS streaming standard. This is what makes
// raw TTS sit like produced narration instead of a thin voice memo.
const MASTER =
  "acompressor=threshold=-21dB:ratio=3:attack=10:release=180:makeup=3dB," +
  "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000";
const voMix = `${parts.join(";")};${prepared.map((_, i) => `[v${i}]`).join("")}amix=inputs=${prepared.length}:normalize=0,atrim=0:${videoDur.toFixed(2)},${MASTER}[vo]`;

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
