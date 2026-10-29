import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "vitest";
import {
  loadApiKey,
  resolveE2EProviderConfig,
} from "../e2e/helpers/e2e-provider-config";

describe("E2E provider config", () => {
  test("loads API keys from env before .env without exposing secrets in diagnostics", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-provider-config-"));
    const envFilePath = join(dir, ".env");
    try {
      writeFileSync(envFilePath, "OPENROUTER_API_KEY=file-secret\n", "utf-8");

      expect(
        loadApiKey({
          env: { OPENROUTER_API_KEY: "env-secret" },
          envFilePath,
        }),
      ).toBe("env-secret");

      const config = resolveE2EProviderConfig({
        env: { OPENROUTER_API_KEY: "env-secret" },
        envFilePath,
      });
      expect(config.apiKey).toBe("env-secret");
      expect(JSON.stringify(config.diagnostics)).not.toContain("env-secret");
      expect(config.diagnostics).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("falls back to the .env file when the environment has no key", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-provider-config-"));
    const envFilePath = join(dir, ".env");
    try {
      writeFileSync(envFilePath, "OPENROUTER_API_KEY=file-secret\n", "utf-8");
      expect(
        resolveE2EProviderConfig({
          env: { OPENROUTER_API_KEY: "" },
          envFilePath,
        }).apiKey,
      ).toBe("file-secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports a missing key without leaking context", () => {
    const config = resolveE2EProviderConfig({
      env: { OPENROUTER_API_KEY: "" },
      envFilePath: join(tmpdir(), "opensidebar-missing-provider-env"),
    });

    expect(config.apiKey).toBeUndefined();
    expect(config.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: "OPENROUTER_API_KEY is not configured.",
      }),
    ]);
  });
});
