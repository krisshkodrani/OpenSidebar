#!/usr/bin/env node
/**
 * Build the LinkedIn 4:5 launch film from three verified work use cases:
 * dashboard-to-email, vendor access, and the existing ServiceNow sequence.
 * Watch Mode is intentionally excluded.
 *
 * Add narration with:
 *   node scripts/add-voiceover.mjs --video linkedin-multi
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const dashboard = resolve(root, ".artifacts/e2e/videos/2026-08-03/2026-08-03_08-39-02-361-cross-page-compose-view.mp4");
const vendor = resolve(root, ".artifacts/e2e/videos/2026-08-03/2026-08-03_08-22-51-572-vendor-onboarding-wizard-view.mp4");
const existingPromo = resolve(root, ".artifacts/publish/opensidebar-promo-60s.mp4");
const output = resolve(root, ".artifacts/publish/opensidebar-linkedin-launch-56s-bed.mp4");

for (const input of [dashboard, vendor, existingPromo]) {
  if (!existsSync(input)) throw new Error(`Video source not found: ${input}`);
}
mkdirSync(dirname(output), { recursive: true });

const introDuration = 7;
const duration = 56;
const font = "C\\:/Windows/Fonts/segoeuib.ttf";
const normalize = "scale=1080:608:force_original_aspect_ratio=decrease,pad=1080:608:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=25";

const filter = [
  // Fresh dashboard/email take: evidence, initial draft, then reviewed revision.
  `[0:v]trim=start=3:end=8,setpts=PTS-STARTPTS,${normalize}[d0]`,
  `[0:v]trim=start=40:end=55,setpts=(PTS-STARTPTS)/2.5,${normalize}[d1]`,
  `[0:v]trim=start=132:end=140,setpts=(PTS-STARTPTS)/1.6,${normalize}[d2]`,
  // Fresh vendor wizard: Contact, conditional Request, Review/confirmation.
  `[1:v]trim=start=31:end=42,setpts=(PTS-STARTPTS)/2,${normalize}[v0]`,
  `[1:v]trim=start=42:end=55,setpts=(PTS-STARTPTS)/2,${normalize}[v1]`,
  `[1:v]trim=start=60:end=72,setpts=(PTS-STARTPTS)/2,${normalize}[v2]`,
  // Keep the previously approved ServiceNow edit unchanged.
  `[2:v]trim=start=42.5:end=51.5,setpts=PTS-STARTPTS,${normalize}[sn]`,
  "[d0][d1][d2][v0][v1][v2][sn]concat=n=7:v=1:a=0,setpts=PTS+7/TB[film]",
  `color=c=0x0B1F33:s=1080x1350:d=${duration}[canvas]`,
  `[canvas][film]overlay=0:308:eof_action=repeat[base]`,
  // Cover the legacy model chip in the retained ServiceNow lower third.
  "[base]drawbox=x=610:y=884:w=470:h=34:color=black:t=fill:enable='between(t,41,50)'," +
    `drawtext=fontfile='${font}':text='OpenSidebar':fontcolor=white:fontsize=62:x=(w-text_w)/2:y=70:enable='between(t,7,50)',` +
    `drawtext=fontfile='${font}':text='Real work, completed in the browser':fontcolor=0x4FC3F7:fontsize=31:x=(w-text_w)/2:y=150:enable='between(t,7,50)',` +
    `drawtext=fontfile='${font}':text='Dashboard · Reads live business metrics':fontcolor=white:fontsize=30:x=(w-text_w)/2:y=1045:enable='between(t,7,12)',` +
    `drawtext=fontfile='${font}':text='Email · Carries context across pages':fontcolor=white:fontsize=30:x=(w-text_w)/2:y=1045:enable='between(t,12,18)',` +
    `drawtext=fontfile='${font}':text='Review · Refines the draft without sending':fontcolor=white:fontsize=30:x=(w-text_w)/2:y=1045:enable='between(t,18,23)',` +
    `drawtext=fontfile='${font}':text='Vendor access · Completes a multi-step request':fontcolor=white:fontsize=30:x=(w-text_w)/2:y=1045:enable='between(t,23,35)',` +
    `drawtext=fontfile='${font}':text='Review · Checks and submits with evidence':fontcolor=white:fontsize=30:x=(w-text_w)/2:y=1045:enable='between(t,35,41)',` +
    `drawtext=fontfile='${font}':text='ServiceNow extension · Adaptable to enterprise SaaS':fontcolor=white:fontsize=29:x=(w-text_w)/2:y=1045:enable='between(t,41,50)',` +
    `drawtext=fontfile='${font}':text='Visible actions · Real recorded runs':fontcolor=0xB8C4D0:fontsize=24:x=(w-text_w)/2:y=1110:enable='between(t,7,50)',` +
    `drawtext=fontfile='${font}':text='Open source · Bring your own key':fontcolor=0x71859A:fontsize=21:x=(w-text_w)/2:y=1160:enable='between(t,7,50)',` +
    "drawbox=x=0:y=0:w=1080:h=1350:color=0x0B1F33:t=fill:enable='lt(t,7)'," +
    `drawtext=fontfile='${font}':text='OpenSidebar':fontcolor=white:fontsize=84:x=(w-text_w)/2:y=340:enable='lt(t,7)',` +
    "drawbox=x=420:y=462:w=240:h=4:color=0x4FC3F7:t=fill:enable='lt(t,7)'," +
    `drawtext=fontfile='${font}':text='An open-source browser agent for Chrome':fontcolor=0x4FC3F7:fontsize=36:x=(w-text_w)/2:y=520:enable='lt(t,7)',` +
    `drawtext=fontfile='${font}':text='Bring your own API key':fontcolor=white:fontsize=31:x=(w-text_w)/2:y=610:enable='lt(t,7)',` +
    `drawtext=fontfile='${font}':text='github.com/krisshkodrani/OpenSidebar':fontcolor=0xB8C4D0:fontsize=27:x=(w-text_w)/2:y=690:enable='lt(t,7)',` +
    "drawbox=x=0:y=0:w=1080:h=1350:color=0x0B1F33:t=fill:enable='gte(t,50)'," +
    `drawtext=fontfile='${font}':text='OpenSidebar':fontcolor=white:fontsize=78:x=(w-text_w)/2:y=405:enable='gte(t,50)',` +
    "drawbox=x=420:y=520:w=240:h=4:color=0x4FC3F7:t=fill:enable='gte(t,50)'," +
    `drawtext=fontfile='${font}':text='Three workflows. One browser agent.':fontcolor=0x4FC3F7:fontsize=35:x=(w-text_w)/2:y=575:enable='gte(t,50)',` +
    `drawtext=fontfile='${font}':text='Open source automation you can inspect':fontcolor=white:fontsize=29:x=(w-text_w)/2:y=665:enable='gte(t,50)',` +
    `drawtext=fontfile='${font}':text='github.com/krisshkodrani/OpenSidebar':fontcolor=0xB8C4D0:fontsize=27:x=(w-text_w)/2:y=730:enable='gte(t,50)',format=yuv420p[v]`,
  `[3:a]highpass=f=220,lowpass=f=6500,afade=t=in:st=0:d=0.8,afade=t=out:st=54.6:d=1.4,volume=0.55[a]`,
].join(";");

const music =
  "aevalsrc=" +
  "0.021*(sin(2*PI*523.25*t)+0.50*sin(2*PI*659.25*t))*exp(-10*mod(t\\,1))+" +
  "0.009*sin(2*PI*880*t)*exp(-14*mod(t+0.5\\,1)):" +
  `s=48000:d=${duration}`;

execFileSync("ffmpeg", [
  "-y", "-i", dashboard, "-i", vendor, "-i", existingPromo,
  "-f", "lavfi", "-i", music,
  "-filter_complex", filter,
  "-map", "[v]", "-map", "[a]", "-t", String(duration),
  "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-r", "25",
  "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k", output,
], { stdio: "inherit" });

console.log(`LinkedIn multi-use promo bed written to ${output}`);
