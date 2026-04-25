#!/usr/bin/env tsx

import { existsSync, readFileSync, readdirSync } from "fs";
import { isAbsolute, resolve } from "path";
import { REPORTS_DIR } from "./workarena-adapter-lib.js";
import {
  type ValidationError,
  validateWorkArenaReport,
} from "./workarena-report-schema.js";

type FileResult = {
  file: string;
  ok: boolean;
  errors: ValidationError[];
};

function parseArgs(): {
  files: string[];
  json: boolean;
} {
  const args = process.argv.slice(2);
  const files: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--file") {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        files.push(next);
        index += 1;
      }
    } else if (!arg.startsWith("--")) {
      files.push(arg);
    }
  }
  return {
    files,
    json: args.includes("--json"),
  };
}

function discoverReports(): string[] {
  if (!existsSync(REPORTS_DIR)) return [];
  return readdirSync(REPORTS_DIR)
    .filter((name) => /^workarena-.*\.json$/.test(name))
    .map((name) => resolve(REPORTS_DIR, name))
    .sort();
}

function resolveInputPath(file: string): string {
  return isAbsolute(file) ? file : resolve(process.cwd(), file);
}

function validateFile(file: string): FileResult {
  try {
    const raw = readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const errors = validateWorkArenaReport(parsed);
    return {
      file,
      ok: errors.length === 0,
      errors,
    };
  } catch (error) {
    return {
      file,
      ok: false,
      errors: [
        {
          path: "$",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function printHuman(results: FileResult[]): void {
  console.log("\n[workarena:validate] WorkArena report schema validation");
  console.log(`[workarena:validate] Files: ${results.length}`);
  const invalid = results.filter((result) => !result.ok);
  console.log(`[workarena:validate] Valid: ${results.length - invalid.length}`);
  console.log(`[workarena:validate] Invalid: ${invalid.length}`);
  if (results.length === 0) {
    console.log("[workarena:validate] No workarena-*.json reports found.");
    return;
  }
  console.log("");

  for (const result of results) {
    console.log(`[workarena:validate] ${result.ok ? "OK" : "FAIL"} ${result.file}`);
    for (const error of result.errors) {
      console.log(`[workarena:validate]   - ${error.path}: ${error.message}`);
    }
  }
}

function main(): void {
  const args = parseArgs();
  const files =
    args.files.length > 0 ? args.files.map(resolveInputPath) : discoverReports();
  const results = files.map(validateFile);

  if (args.json) {
    console.log(JSON.stringify({ files: results.length, results }, null, 2));
  } else {
    printHuman(results);
  }

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

main();
