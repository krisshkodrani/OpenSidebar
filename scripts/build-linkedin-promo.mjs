#!/usr/bin/env node
/**
 * Build the LinkedIn-native 4:5 work-focused product film.
 *
 * Uses reviewed beats from the canonical silent promo, removes the consumer
 * shopping beat, and supplies a light original plucked bed with no sustained
 * low-frequency drone. Add narration with:
 *   node scripts/add-voiceover.mjs --video linkedin
 *
 * Usage: node scripts/build-linkedin-promo.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const input = resolve(root, ".artifacts/publish/opensidebar-promo-60s.mp4");
const output = resolve(root, ".artifacts/publish/opensidebar-linkedin-work-38s-bed.mp4");

if (!existsSync(input)) throw new Error(`Promo source not found: ${input}`);
mkdirSync(dirname(output), { recursive: true });

// Reviewed windows in the canonical promo: cross-page compose, Watch Mode,
// enterprise request, and the existing product CTA. Their concatenated length
// is 37.57s.
const windows = [
  [13.2, 26.8],
  [27.0, 36.0],
  [42.5, 51.5],
  [52.0, 57.97],
];
const duration = windows.reduce((sum, [from, to]) => sum + to - from, 0);
const trims = windows
  .map(([from, to], i) => `[0:v]trim=start=${from}:end=${to},setpts=PTS-STARTPTS[s${i}]`)
  .join(";");
const labels = windows.map((_, i) => `[s${i}]`).join("");

const font = "C\\:/Windows/Fonts/segoeuib.ttf";
const filter = [
  trims,
  `${labels}concat=n=${windows.length}:v=1:a=0,scale=1080:608:force_original_aspect_ratio=decrease,setsar=1[film]`,
  `color=c=0x0B1F33:s=1080x1350:d=${duration.toFixed(2)}[canvas]`,
  "[canvas][film]overlay=0:308[base]",
  // Replace the inherited, outdated model chip in the source lower third.
  "[base]drawbox=x=620:y=885:w=460:h=31:color=black:t=fill," +
    `drawtext=fontfile='${font}':text='MiniMax M3 + GLM 5.2 + GPT-OSS-120B via OpenRouter':fontcolor=0x4FC3F7:fontsize=13:x=643:y=894,` +
    `drawtext=fontfile='${font}':text='OpenSidebar':fontcolor=white:fontsize=62:x=(w-text_w)/2:y=70,` +
    `drawtext=fontfile='${font}':text='AI help for the work between tabs':fontcolor=0x4FC3F7:fontsize=32:x=(w-text_w)/2:y=150,` +
    `drawtext=fontfile='${font}':text='Read one page. Write on another.':fontcolor=white:fontsize=31:x=(w-text_w)/2:y=1048:enable='between(t,0,13.6)',` +
    `drawtext=fontfile='${font}':text='Stay on top of important changes.':fontcolor=white:fontsize=31:x=(w-text_w)/2:y=1048:enable='between(t,13.6,22.6)',` +
    `drawtext=fontfile='${font}':text='Complete complex requests, step by step.':fontcolor=white:fontsize=31:x=(w-text_w)/2:y=1048:enable='between(t,22.6,31.6)',` +
    `drawtext=fontfile='${font}':text='Free · Open source · Bring your own key':fontcolor=white:fontsize=29:x=(w-text_w)/2:y=1110,` +
    `drawtext=fontfile='${font}':text='github.com/krisshkodrani/OpenSidebar':fontcolor=0xB8C4D0:fontsize=25:x=(w-text_w)/2:y=1170,` +
    "drawbox=x=0:y=0:w=1080:h=1350:color=0x0B1F33:t=fill:enable='gte(t,31.6)'," +
    `drawtext=fontfile='${font}':text='OpenSidebar':fontcolor=white:fontsize=76:x=(w-text_w)/2:y=420:enable='gte(t,31.6)',` +
    "drawbox=x=420:y=530:w=240:h=4:color=0x4FC3F7:t=fill:enable='gte(t,31.6)'," +
    `drawtext=fontfile='${font}':text='Work between tabs, finished.':fontcolor=0x4FC3F7:fontsize=35:x=(w-text_w)/2:y=585:enable='gte(t,31.6)',` +
    `drawtext=fontfile='${font}':text='Free · Open source · Bring your own key':fontcolor=white:fontsize=29:x=(w-text_w)/2:y=680:enable='gte(t,31.6)',` +
    `drawtext=fontfile='${font}':text='github.com/krisshkodrani/OpenSidebar':fontcolor=0xB8C4D0:fontsize=27:x=(w-text_w)/2:y=745:enable='gte(t,31.6)',` +
    `drawtext=fontfile='${font}':text='MiniMax M3 · GLM 5.2 · GPT-OSS-120B · OpenRouter':fontcolor=0x71859A:fontsize=18:x=(w-text_w)/2:y=835:enable='gte(t,31.6)',format=yuv420p[v]`,
  // Short, decaying upper-register plucks plus a quiet airy pulse. There is no
  // continuous bass oscillator, which avoids the hum in the first draft.
  `[1:a]highpass=f=220,lowpass=f=6500,afade=t=in:st=0:d=0.7,afade=t=out:st=${(duration - 1.2).toFixed(2)}:d=1.2,volume=0.55[a]`,
].join(";");

const music =
  "aevalsrc=" +
  "0.022*(sin(2*PI*523.25*t)+0.55*sin(2*PI*659.25*t))*exp(-9*mod(t\\,1))+" +
  "0.010*sin(2*PI*783.99*t)*exp(-12*mod(t+0.5\\,1)):" +
  `s=48000:d=${duration.toFixed(2)}`;

execFileSync("ffmpeg", [
  "-y", "-i", input, "-f", "lavfi", "-i", music,
  "-filter_complex", filter,
  "-map", "[v]", "-map", "[a]", "-t", duration.toFixed(2),
  "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-movflags", "+faststart",
  "-c:a", "aac", "-b:a", "192k", output,
], { stdio: "inherit" });

console.log(`LinkedIn work promo bed written to ${output}`);
