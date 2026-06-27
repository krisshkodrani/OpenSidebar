/**
 * Deterministic span-id derivation (RFC LP-7, Stage B0). Pure and stable so the
 * same trace always projects to the same span ids — which makes the historical
 * backfill (Stage B1) idempotent. 64-bit-ish id rendered as 16 lowercase hex
 * chars (matching OTel span-id width), via two salted FNV-1a passes.
 */
export function spanId(...parts: Array<string | number>): string {
  const input = parts.join("|");
  let h1 = 0x811c9dc5;
  let h2 = (0x811c9dc5 ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + 1), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
