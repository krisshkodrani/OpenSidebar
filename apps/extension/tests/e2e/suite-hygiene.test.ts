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

const STRATEGY_LEAK_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "button-count walkthrough",
    pattern: /\bClick\s+Advance\s+three\s+times\b/i,
  },
  {
    label: "step-by-step answer reveal",
    pattern: /\bto\s+reveal\s+the\s+secret\s+code,\s+then\s+enter\s+it\s+and\s+submit\b/i,
  },
  {
    label: "direct tool invocation",
    pattern:
      /\b(?:use|call)\s+the\s+(?:click_element|done|download_file|execute_js|inspect_table|read_page|scroll_page|type_text|upload_file)\s+tool\b/i,
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
    );
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
});
