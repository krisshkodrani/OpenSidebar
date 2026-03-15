import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const E2E_FILES = [
  "tests/e2e/summarize.test.ts",
  "tests/e2e/article-research.test.ts",
  "tests/e2e/navigation-challenge.test.ts",
  "tests/e2e/dashboard.test.ts",
  "tests/e2e/online-shop.test.ts",
  "tests/e2e/multi-step-form.test.ts",
  "tests/e2e/edge-cases.test.ts",
];

function runOne(testFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const label = path.basename(testFile);
    const start = Date.now();
    console.log(`\n[e2e:suite] Running ${label}`);

    const command =
      process.platform === "win32"
        ? {
            file: process.env.ComSpec || "cmd.exe",
            args: [
              "/c",
              "npx",
              "vitest",
              "run",
              "--config",
              "tests/e2e/vitest.e2e.config.ts",
              testFile,
            ],
          }
        : {
            file: "npx",
            args: [
              "vitest",
              "run",
              "--config",
              "tests/e2e/vitest.e2e.config.ts",
              testFile,
            ],
          };

    const child = spawn(command.file, command.args, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code, signal) => {
      const durationMs = Date.now() - start;
      if (code === 0) {
        console.log(`[e2e:suite] Passed ${label} in ${Math.round(durationMs / 1000)}s`);
        resolve();
        return;
      }

      const reason =
        signal != null
          ? `signal ${signal}`
          : `exit code ${code ?? "unknown"}`;
      reject(new Error(`E2E file failed: ${label} (${reason})`));
    });
  });
}

async function main(): Promise<void> {
  const suiteStart = Date.now();

  for (const testFile of E2E_FILES) {
    await runOne(testFile);
  }

  const durationSec = Math.round((Date.now() - suiteStart) / 1000);
  console.log(`\n[e2e:suite] All ${E2E_FILES.length} files passed in ${durationSec}s`);
}

main().catch((error) => {
  console.error(`\n[e2e:suite] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
