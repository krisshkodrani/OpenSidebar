import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  E2E_CANONICAL_SUITE_ORDER,
  E2E_SUITES,
  E2E_SUITE_ORDER,
  type E2ESuiteName,
} from "./suites";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function listE2ETestFiles(): string[] {
  return fs
    .readdirSync(__dirname)
    .filter((name) => name.endsWith(".test.ts"))
    .sort();
}

function readTestFile(file: string): string {
  return fs.readFileSync(path.join(__dirname, file), "utf8");
}

function readOnlineShopRoute(file: string): string {
  return fs.readFileSync(
    path.join(__dirname, "fixtures", "online-shop-pro", "src", "routes", file),
    "utf8",
  );
}

/**
 * Prompt-naturalness lint. Prompts should read like a real user request:
 * constraints are fine when phrased naturally ("don't send it yet"), but
 * test-directive phrasing, tool vocabulary, and step-by-step choreography
 * are leakage — they coach the agent through exactly the behavior the test
 * exists to measure. Patterns are phrasing-shaped on purpose: the scan runs
 * over whole file sources, so bare identifiers (tool names in assertions)
 * must not trip it.
 */
const STRATEGY_LEAK_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "button-count walkthrough",
    pattern: /\bClick\s+Advance\s+three\s+times\b/i,
  },
  {
    label: "step-by-step answer reveal",
    pattern:
      /\bto\s+reveal\s+the\s+secret\s+code,\s+then\s+enter\s+it\s+and\s+submit\b/i,
  },
  {
    label: "direct tool invocation",
    pattern:
      /\b(?:use|call)\s+the\s+(?:click_element|done|download_file|execute_js|inspect_table|read_page|scroll_page|type_text|upload_file)\s+tool\b/i,
  },
  {
    // Stiff test-directive negation inside a prompt string. Real users
    // contract ("don't click send"); "Do not click Send." is a test spec.
    // Anchored to a quote-adjacent context so code comments don't trip it.
    label: "uncontracted 'do not' directive in prompt text",
    pattern:
      /["'`][^"'`\n]*\bdo not\s+(?:click|edit|change|open|download|send|add|place|submit|check\s+out)\b/i,
  },
  {
    // "complete the <something> challenge" — harness/fixture vocabulary. A
    // user names the goal, not the test scenario.
    label: "fixture-challenge vocabulary",
    pattern: /\b(?:complete|finish|solve)\s+the\s+\w+\s+challenge\b/i,
  },
  {
    // Tab choreography: "open X in a new tab ... then come/go back" scripts
    // the navigation topology the agent should choose itself.
    label: "tab choreography walkthrough",
    pattern: /\bin\s+a\s+new\s+tab\b[^.\n]*\bthen\s+(?:come|go)\s+back\b/i,
  },
  {
    // "Stop after those fields" freezes scope in test-runner voice.
    label: "scope-freezing 'stop after' directive",
    pattern: /\bStop\s+after\s+(?:those|these|that|the)\b/i,
  },
];

describe("E2E suite hygiene", () => {
  it("assigns every E2E test file to one canonical suite", () => {
    const allFiles = new Set(listE2ETestFiles());
    const assigned = new Map<string, E2ESuiteName>();

    for (const suiteName of E2E_CANONICAL_SUITE_ORDER) {
      for (const file of E2E_SUITES[suiteName]) {
        expect(
          allFiles.has(file),
          `Suite "${suiteName}" references missing test file: ${file}`,
        ).toBe(true);

        const existing = assigned.get(file);
        expect(
          existing,
          `Test file ${file} is assigned to multiple suites: ${existing}, ${suiteName}`,
        ).toBeUndefined();
        assigned.set(file, suiteName);
      }
    }

    const unassigned = [...allFiles].filter((file) => !assigned.has(file));
    expect(unassigned, "Unassigned E2E test files").toEqual([]);
  });

  it("keeps default-suite prompts free of tool and strategy leakage", () => {
    const defaultSuiteFiles = E2E_SUITE_ORDER.flatMap(
      (suiteName) => E2E_SUITES[suiteName],
    ).filter((file) => file !== "suite-hygiene.test.ts"); // the pattern list would match itself
    const violations: string[] = [];

    for (const file of defaultSuiteFiles) {
      const content = readTestFile(file);
      for (const { label, pattern } of STRATEGY_LEAK_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${file}: ${label}`);
        }
      }
    }

    expect(violations, "Strategy-leaking E2E prompt text").toEqual([]);
  });

  it("keeps Arena fixture copy from coaching the tested strategy", () => {
    const fixtureCopy = [
      readOnlineShopRoute("procurement-list.tsx"),
      readOnlineShopRoute("workspace-choice.tsx"),
    ].join("\n");

    expect(fixtureCopy).not.toMatch(/open each store in a[\s\S]{0,40}new tab/i);
    expect(fixtureCopy).not.toMatch(/then come back here/i);
    expect(fixtureCopy).not.toMatch(/ask the user which workspace/i);
    expect(fixtureCopy).not.toMatch(
      /correct workspace is intentionally not specified/i,
    );
  });
});
