import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  PerceptionImageArtifactV1,
  PerceptionImageDetail,
} from "@opensidebar/scenario-contracts";

function pngDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (
    buffer.length < 24 ||
    !buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function jpegDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8)
    return null;
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + length + 2 > buffer.length) return null;
    if (
      marker !== undefined &&
      ((marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf))
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += length + 2;
  }
  return null;
}

export function inspectPerceptionImage(input: {
  path: string;
  detail?: PerceptionImageDetail;
  turnNumber: number;
  screenshotStatus?: PerceptionImageArtifactV1["screenshotStatus"];
}): PerceptionImageArtifactV1 {
  const buffer = readFileSync(input.path);
  const png = pngDimensions(buffer);
  const jpeg = png ? null : jpegDimensions(buffer);
  const dimensions = png ?? jpeg;
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new Error(`Unsupported or corrupt screenshot: ${input.path}`);
  }
  return {
    schemaVersion: 1,
    path: input.path,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    mimeType: png ? "image/png" : "image/jpeg",
    byteLength: buffer.byteLength,
    width: dimensions.width,
    height: dimensions.height,
    detail: input.detail ?? "unknown",
    turnNumber: input.turnNumber,
    screenshotStatus: input.screenshotStatus ?? "unknown",
  };
}

export function perceptionImageDataUrl(
  artifact: PerceptionImageArtifactV1,
): string {
  const buffer = readFileSync(artifact.path);
  const digest = createHash("sha256").update(buffer).digest("hex");
  if (digest !== artifact.sha256) {
    throw new Error(`Screenshot changed after capture: ${artifact.path}`);
  }
  return `data:${artifact.mimeType};base64,${buffer.toString("base64")}`;
}
