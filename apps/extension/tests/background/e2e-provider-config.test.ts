import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "vitest";
import { readE2EConfig } from "../e2e/helpers/e2e-config";
import {
  detectProviderMode,
  loadApiKey,
  resolveE2EProviderConfig,
} from "../e2e/helpers/e2e-provider-config";

describe("E2E provider config", () => {
  test("normalizes provider aliases and derives lane", () => {
    const config = resolveE2EProviderConfig({
      env: {
        E2E_PROVIDER: "kimi",
        KIMI_API_KEY: "kimi-secret",
      },
    });

    expect(config.providerMode).toBe("moonshot");
    expect(config.lane).toBe("dev");
    expect(config.apiKey).toBe("kimi-secret");
    expect(config.keys.kimiKey).toBe("kimi-secret");
  });

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
        config: readE2EConfig({ env: { E2E_PROVIDER: "fireworks" } }),
        env: { FIREWORKS_API_KEY: "fw-secret" },
        envFilePath,
      });
      expect(JSON.stringify(config.diagnostics)).not.toContain("fw-secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports missing active provider key with sanitized context", () => {
    const config = resolveE2EProviderConfig({
      config: readE2EConfig({ env: { E2E_PROVIDER: "fireworks" } }),
      env: { FIREWORKS_API_KEY: "" },
      envFilePath: join(tmpdir(), "opensidebar-missing-provider-env"),
    });

    expect(config.apiKey).toBeUndefined();
    expect(config.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: "Active E2E provider API key is not configured.",
        context: {
          providerMode: "fireworks",
          lane: "dev",
        },
      }),
    ]);
  });

  test("keeps unknown providers on the default fireworks path", () => {
    expect(detectProviderMode("unknown")).toBe("fireworks");
  });
});
