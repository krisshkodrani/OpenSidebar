import { describe, expect, test } from "vitest";
import tokens from "../../../../packages/ui-tokens/tokens.json";

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Palette = Record<string, string>;
const themes: Array<[string, Palette]> = [
  ["light", tokens.light],
  ["dark", tokens.dark],
];

describe("ui token contrast (WCAG AA)", () => {
  test("light and dark define the same roles", () => {
    expect(Object.keys(tokens.dark).sort()).toEqual(Object.keys(tokens.light).sort());
  });

  for (const [theme, palette] of themes) {
    for (const [fg, bg] of tokens.contrast.text) {
      test(`${theme}: ${fg} on ${bg} is at least 4.5:1`, () => {
        expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
    for (const [fg, bg] of tokens.contrast.ui) {
      test(`${theme}: ${fg} on ${bg} is at least 3:1`, () => {
        expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(3);
      });
    }
  }
});
