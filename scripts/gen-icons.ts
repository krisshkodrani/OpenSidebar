/**
 * Generate "OS" PNG icons for the Chrome extension.
 * Usage: bun scripts/gen-icons.ts
 */
import sharp from "sharp";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(OUT, { recursive: true });

const sizes = [16, 48, 128] as const;

for (const size of sizes) {
  const rx = Math.round(size * 0.19); // rounded corners ratio
  const fontSize = Math.round(size * 0.52);
  const yPos = Math.round(size * 0.66);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="#4F46E5"/>
  <text x="${size / 2}" y="${yPos}" text-anchor="middle"
    font-family="Arial,Helvetica,sans-serif" font-weight="700"
    font-size="${fontSize}" fill="#fff" letter-spacing="-1">OS</text>
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(join(OUT, `icon-${size}.png`));
  console.log(`  icon-${size}.png`);
}

console.log("Done!");
