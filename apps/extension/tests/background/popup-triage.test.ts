import { describe, it, expect } from "vitest";
import { parseNuisanceBlockers } from "../../src/background/agent/popup-triage";

describe("parseNuisanceBlockers", () => {
  it("returns empty array for empty input", () => {
    expect(parseNuisanceBlockers("")).toEqual([]);
  });

  it("returns empty array when no BLOCKERS section", () => {
    const interpretation = `
1. LAYOUT: Simple landing page.
2. STATE: No active inputs.
3. CONTENT: Welcome message.
4. VISUAL-ONLY: None.
6. SPATIAL: Nav at top.`;
    expect(parseNuisanceBlockers(interpretation)).toEqual([]);
  });

  it("returns empty array when BLOCKERS says None", () => {
    const interpretation = `
1. LAYOUT: Form page.
5. BLOCKERS: None.
6. SPATIAL: Submit below form.`;
    expect(parseNuisanceBlockers(interpretation)).toEqual([]);
  });

  it("returns empty array when BLOCKERS says none (lowercase)", () => {
    const interpretation = `5. BLOCKERS: none`;
    expect(parseNuisanceBlockers(interpretation)).toEqual([]);
  });

  it("parses a single NUISANCE blocker with unicode arrow", () => {
    const interpretation = `
5. BLOCKERS:
   NUISANCE [12] "cookie consent banner" → click [15]
6. SPATIAL: Nav sidebar left.`;
    const result = parseNuisanceBlockers(interpretation);
    expect(result).toEqual([
      {
        overlayTagId: 12,
        dismissTagId: 15,
        description: "cookie consent banner",
      },
    ]);
  });

  it("parses a single NUISANCE blocker with ASCII arrow", () => {
    const interpretation = `5. BLOCKERS:
   NUISANCE [8] "newsletter signup popup" -> click [11]`;
    const result = parseNuisanceBlockers(interpretation);
    expect(result).toEqual([
      {
        overlayTagId: 8,
        dismissTagId: 11,
        description: "newsletter signup popup",
      },
    ]);
  });

  it("parses multiple NUISANCE blockers", () => {
    const interpretation = `5. BLOCKERS:
   NUISANCE [5] "cookie banner" → click [9]
   NUISANCE [20] "promotional popup" → click [22]
6. SPATIAL: Footer at bottom.`;
    const result = parseNuisanceBlockers(interpretation);
    expect(result).toHaveLength(2);
    expect(result[0].overlayTagId).toBe(5);
    expect(result[0].dismissTagId).toBe(9);
    expect(result[1].overlayTagId).toBe(20);
    expect(result[1].dismissTagId).toBe(22);
  });

  it("ignores RELEVANT blockers", () => {
    const interpretation = `5. BLOCKERS:
   NUISANCE [5] "cookie banner" → click [9]
   RELEVANT [15] "login modal" → user must authenticate
   NUISANCE [30] "ads overlay" → click [33]`;
    const result = parseNuisanceBlockers(interpretation);
    expect(result).toHaveLength(2);
    expect(result[0].overlayTagId).toBe(5);
    expect(result[1].overlayTagId).toBe(30);
  });

  it("handles mixed NUISANCE and RELEVANT with no NUISANCE matches", () => {
    const interpretation = `5. BLOCKERS:
   RELEVANT [10] "checkout confirmation" → required user decision
   RELEVANT [20] "2FA prompt" → must enter code`;
    const result = parseNuisanceBlockers(interpretation);
    expect(result).toEqual([]);
  });

  it("handles BLOCKERS without numbered prefix", () => {
    const interpretation = `BLOCKERS:
NUISANCE [3] "GDPR consent" → click [7]`;
    const result = parseNuisanceBlockers(interpretation);
    expect(result).toHaveLength(1);
    expect(result[0].dismissTagId).toBe(7);
  });

  it("handles perception output with all 6 sections", () => {
    const interpretation = `1. LAYOUT: E-commerce product page with grid layout.
2. STATE: Search input focused. Cart badge shows 3 items.
3. CONTENT: "Summer Sale - 50% Off" heading. Product cards below.
4. VISUAL-ONLY: Brand logo in header image.
5. BLOCKERS:
   NUISANCE [45] "cookie preferences dialog" → click [48]
   RELEVANT [52] "age verification modal" → user must confirm age
6. SPATIAL: Nav top, products center grid, footer at bottom.`;
    const result = parseNuisanceBlockers(interpretation);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      overlayTagId: 45,
      dismissTagId: 48,
      description: "cookie preferences dialog",
    });
  });

  it("handles large tag IDs", () => {
    const interpretation = `5. BLOCKERS:
   NUISANCE [1234] "consent overlay" → click [1250]`;
    const result = parseNuisanceBlockers(interpretation);
    expect(result).toHaveLength(1);
    expect(result[0].overlayTagId).toBe(1234);
    expect(result[0].dismissTagId).toBe(1250);
  });

  it("handles perception failure messages gracefully", () => {
    expect(
      parseNuisanceBlockers("[Visual perception timed out]"),
    ).toEqual([]);
    expect(
      parseNuisanceBlockers("[No API key — visual perception unavailable. Agent relies on element list only.]"),
    ).toEqual([]);
    expect(
      parseNuisanceBlockers("[Visual perception failed: all providers exhausted]"),
    ).toEqual([]);
  });
});
