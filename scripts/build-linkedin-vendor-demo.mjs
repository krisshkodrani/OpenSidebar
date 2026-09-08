#!/usr/bin/env node
/**
 * Build a LinkedIn-native 4:5 vendor-access workflow demo from the reviewed
 * cinematic E2E take. The cut starts just before the first visible field
 * change and ends on the submitted confirmation state.
 *
 * Add narration with:
 *   node scripts/add-voiceover.mjs --video vendor
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const input = resolve(root, ".artifacts/e2e/videos/2026-08-03/2026-08-03_08-22-51-572-vendor-onboarding-wizard-view.mp4");
const output = resolve(root, ".artifacts/publish/opensidebar-linkedin-vendor-workflow-47s-bed.mp4");
const font = "C\\:/Windows/Fonts/segoeuib.ttf";
const actionSeconds = 41;
const duration = 47;

if (!existsSync(input)) throw new Error(`Reviewed vendor-workflow take not found: ${input}`);
mkdirSync(dirname(output), { recursive: true });

const filter = [
  "[0:v]trim=start=31:end=72,setpts=PTS-STARTPTS," +
    "scale=1080:532:force_original_aspect_ratio=decrease,setsar=1[film]",
  `color=c=0x0B1F33:s=1080x1350:d=${duration}:r=25[canvas]`,
  "[canvas][film]overlay=0:320:eof_action=repeat[base]",
  "[base]drawtext=fontfile='C\\:/Windows/Fonts/segoeuib.ttf':text='OpenSidebar':fontcolor=white:fontsize=66:x=(w-text_w)/2:y=64," +
    "drawtext=fontfile='C\\:/Windows/Fonts/segoeuib.ttf':text='A complete vendor access workflow, handled by AI':fontcolor=0x4FC3F7:fontsize=30:x=(w-text_w)/2:y=148," +
    "drawtext=fontfile='C\\:/Windows/Fonts/segoeuib.ttf':text='Contact · Fills the requester details':fontcolor=white:fontsize=31:x=(w-text_w)/2:y=1035:enable='between(t,0,11)'," +
    "drawtext=fontfile='C\\:/Windows/Fonts/segoeuib.ttf':text='Request · Handles conditional fields':fontcolor=white:fontsize=31:x=(w-text_w)/2:y=1035:enable='between(t,11,23)'," +
    "drawtext=fontfile='C\\:/Windows/Fonts/segoeuib.ttf':text='Review · Checks the request before submission':fontcolor=white:fontsize=31:x=(w-text_w)/2:y=1035:enable='between(t,23,32)'," +
    "drawtext=fontfile='C\\:/Windows/Fonts/segoeuib.ttf':text='Submitted · Confirmation is visible':fontcolor=white:fontsize=31:x=(w-text_w)/2:y=1035:enable='between(t,32,41)'," +
    "drawtext=fontfile='C\\:/Windows/Fonts/segoeuib.ttf':text='Cinematic cursor · Real recorded run':fontcolor=0xB8C4D0:fontsize=24:x=(w-text_w)/2:y=1110," +
    "drawtext=fontfile='C\\:/Windows/Fonts/segoeuib.ttf':text='Kimi K2P7 Code · Fireworks':fontcolor=0x71859A:fontsize=19:x=(w-text_w)/2:y=1170," +
    `drawbox=x=0:y=0:w=1080:h=1350:color=0x0B1F33:t=fill:enable='gte(t,${actionSeconds})',` +
    `drawtext=fontfile='${font}':text='OpenSidebar':fontcolor=white:fontsize=78:x=(w-text_w)/2:y=385:enable='gte(t,${actionSeconds})',` +
    `drawbox=x=420:y=500:w=240:h=4:color=0x4FC3F7:t=fill:enable='gte(t,${actionSeconds})',` +
    `drawtext=fontfile='${font}':text='Visible actions. Reviewed state. Verified result.':fontcolor=0x4FC3F7:fontsize=33:x=(w-text_w)/2:y=555:enable='gte(t,${actionSeconds})',` +
    `drawtext=fontfile='${font}':text='Open source browser automation you can inspect.':fontcolor=white:fontsize=27:x=(w-text_w)/2:y=650:enable='gte(t,${actionSeconds})',` +
    `drawtext=fontfile='${font}':text='github.com/krisshkodrani/OpenSidebar':fontcolor=0xB8C4D0:fontsize=28:x=(w-text_w)/2:y=720:enable='gte(t,${actionSeconds})',` +
    `drawtext=fontfile='${font}':text='Kimi K2P7 Code · Fireworks':fontcolor=0x71859A:fontsize=20:x=(w-text_w)/2:y=810:enable='gte(t,${actionSeconds})',format=yuv420p[v]`,
  `[1:a]highpass=f=240,lowpass=f=7000,afade=t=in:st=0:d=0.8,afade=t=out:st=45.5:d=1.5,volume=0.5[a]`,
].join(";");

const music =
  "aevalsrc=" +
  "0.021*(sin(2*PI*523.25*t)+0.50*sin(2*PI*659.25*t))*exp(-10*mod(t\\,1))+" +
  "0.009*sin(2*PI*880*t)*exp(-14*mod(t+0.5\\,1)):" +
  `s=48000:d=${duration}`;

execFileSync("ffmpeg", [
  "-y", "-i", input, "-f", "lavfi", "-i", music,
  "-filter_complex", filter,
  "-map", "[v]", "-map", "[a]", "-t", String(duration),
  "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-movflags", "+faststart",
  "-c:a", "aac", "-b:a", "192k", output,
], { stdio: "inherit" });

console.log(`LinkedIn vendor workflow demo bed written to ${output}`);
