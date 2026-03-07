/**
 * Logo processing script
 *
 * Resizes a square source image into Chrome extension icon sizes.
 * Crop/color-correct the source externally before running this.
 *
 * Usage:
 *   npx tsx scripts/process-logo.ts [path-to-source]
 *
 * Default source: public/icons/logo-source.png
 * Output: public/icons/icon-{16,48,128}.png
 */

import sharp from "sharp";
import path from "path";

const SOURCE = process.argv[2] || "public/icons/logo-source.png";
const OUT_DIR = "public/icons";
const SIZES = [16, 48, 128] as const;

async function processLogo() {
  const src = path.resolve(SOURCE);
  console.log(`Source: ${src}`);

  const meta = await sharp(src).metadata();
  console.log(`Input: ${meta.width}x${meta.height}, ${meta.format}`);

  for (const s of SIZES) {
    await sharp(src)
      .resize(s, s, {
        kernel: s <= 48 ? sharp.kernel.lanczos3 : sharp.kernel.lanczos2,
        fit: "cover",
      })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT_DIR, `icon-${s}.png`));

    console.log(`  -> icon-${s}.png`);
  }

  console.log("\nDone. Icons written to public/icons/");
}

processLogo().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
