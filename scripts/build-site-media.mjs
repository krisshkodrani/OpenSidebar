#!/usr/bin/env node
/**
 * Stage the landing-site media into apps/site/public/media/<version>/ (git-ignored):
 *   - copies each finished cut named in apps/site/media.manifest.json
 *     (sources live in .artifacts/publish/) to <key>
 *   - extracts a poster frame per video at its `posterAt` second → <key>.poster.jpg
 *
 * One-shot brand assets (committed, not per-deploy):
 *   --logo   apps/site/public/logo.png   (OpenSidebar.png downscaled)
 *   --og     apps/site/public/og.png      (1200×630 navy share card)
 *
 * Reuses the ffmpeg-on-Windows rules from build-store-assets.mjs: cwd-relative,
 * colon-free font/textfile paths and expansion=none on drawtext. Run with no
 * args before `nx run site:build` / deploy; run --logo --og once at setup.
 *
 *   node scripts/build-site-media.mjs            # stage videos + posters
 *   node scripts/build-site-media.mjs --logo --og
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SITE = path.join(ROOT, "apps", "site");
const MANIFEST = path.join(SITE, "media.manifest.json");
const PUBLIC = path.join(SITE, "public");

const BG = "0x0B1F33";
const ACCENT = "0x4FC3F7";
const GREY = "0xB8C4D0";
const SYS_FONT = "C:/Windows/Fonts/segoeuib.ttf";
const TAGLINE = "Your browser, driven by AI";
const SUBLINE = "Bring your own key · No telemetry · Open source";

const args = new Set(process.argv.slice(2));
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

function sh(cmd, cmdArgs) {
  execFileSync(cmd, cmdArgs, { stdio: ["ignore", "ignore", "inherit"] });
}

function stageVideos() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const outDir = path.join(PUBLIC, "media", manifest.version);
  fs.mkdirSync(outDir, { recursive: true });

  const missing = [];
  for (const item of manifest.items) {
    const src = path.join(ROOT, item.source);
    if (!fs.existsSync(src)) {
      missing.push(item.source);
      continue;
    }
    const dst = path.join(outDir, item.key);
    fs.copyFileSync(src, dst);
    // Poster: single frame past the intro fade, scaled to 960 wide.
    sh("ffmpeg", [
      "-y",
      "-ss",
      String(item.posterAt ?? 3),
      "-i",
      src,
      "-frames:v",
      "1",
      "-vf",
      "scale=960:-2",
      "-q:v",
      "4",
      path.join(outDir, `${item.key}.poster.jpg`),
    ]);
    console.log(`  ${manifest.version}/${item.key}  <- ${item.source}`);
  }

  if (missing.length) {
    console.error(
      "\n  !! missing publish sources:\n     " +
        missing.join("\n     ") +
        "\n  Rebuild the finished cuts first — see .artifacts/publish/README.txt " +
        "(e.g. node scripts/build-demo-montage.mjs, scripts/build-promo-cut.mjs).",
    );
    process.exit(1);
  }
}

function brandAssets() {
  fs.mkdirSync(PUBLIC, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(ROOT, ".artifacts", "site-tmp-"));
  try {
    if (args.has("--logo")) {
      const logoSrc = path.join(ROOT, "OpenSidebar.png");
      if (!fs.existsSync(logoSrc)) {
        console.error("  !! OpenSidebar.png not found at repo root");
      } else {
        sh("ffmpeg", [
          "-y",
          "-i",
          logoSrc,
          "-vf",
          "scale=256:-1",
          path.join(PUBLIC, "logo.png"),
        ]);
        console.log("  logo.png");
      }
    }

    if (args.has("--og")) {
      const FONT = rel(path.join(tmp, "font.ttf"));
      fs.copyFileSync(SYS_FONT, path.join(tmp, "font.ttf"));
      let ti = 0;
      const textfile = (str) => {
        const f = path.join(tmp, `t${ti++}.txt`);
        fs.writeFileSync(f, str, "utf8");
        return rel(f);
      };
      const dt = (str, color, size, x, y) =>
        `drawtext=fontfile=${FONT}:textfile=${textfile(str)}:fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}:expansion=none`;
      // 1200×630 OG card, brand-styled to match the store marquee.
      const vf = [
        dt("OpenSidebar", "white", 92, "(w-text_w)/2", "(h/2)-118"),
        dt(TAGLINE, ACCENT, 46, "(w-text_w)/2", "(h/2)+2"),
        dt(SUBLINE, GREY, 28, "(w-text_w)/2", "(h/2)+78"),
      ].join(",");
      sh("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=${BG}:s=1200x630:d=1:r=1`,
        "-vf",
        vf,
        "-frames:v",
        "1",
        path.join(PUBLIC, "og.png"),
      ]);
      console.log("  og.png");
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log("Building site media…");
if (args.has("--logo") || args.has("--og")) {
  brandAssets();
}
if (!args.has("--only-brand")) {
  stageVideos();
}
console.log("Done.");
