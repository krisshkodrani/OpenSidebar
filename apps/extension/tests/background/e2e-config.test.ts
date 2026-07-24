import { describe, expect, test } from "vitest";
import {
  PUBLIC_E2E_ENV_VARS,
  isE2ESuiteFlagEnabled,
  readE2EConfig,
  serializeE2EArtifacts,
  serializeE2ESuiteFlags,
  withE2EConfigEnv,
} from "../e2e/helpers/e2e-config";

describe("E2E config", () => {
  test("keeps the supported public env surface at eight vars", () => {
    expect(PUBLIC_E2E_ENV_VARS).toEqual([
      "E2E_PROFILE",
      "E2E_PROVIDER",
      "E2E_MODEL",
      "E2E_PLANNER_MODEL",
      "E2E_PERCEPTION_MODE",
      "E2E_PRESENCE_MODE",
      "E2E_SUITE_FLAGS",
      "E2E_ARTIFACTS",
    ]);
  });

  test("presence defaults: cinematic on the video profile, off elsewhere", () => {
    expect(readE2EConfig({ env: {} }).presenceMode).toBe("off");
    expect(
      readE2EConfig({ env: { E2E_PROFILE: "video" } }).presenceMode,
    ).toBe("cinematic");
    expect(
      readE2EConfig({ env: { E2E_PRESENCE_MODE: "subtle" } }).presenceMode,
    ).toBe("subtle");
  });

  test("defaults to the local fireworks overlay profile", () => {
    const config = readE2EConfig({ env: {} });

    expect(config.profile).toBe("local");
    expect(config.provider).toBe("fireworks");
    expect(config.browser.headless).toBe(false);
    expect(config.browser.panelMode).toBe("overlay");
    expect(config.artifacts.finalScreenshot).toBe(true);
    expect(config.artifacts.recordVideo).toBe(false);
    expect(config.deprecatedEnvWarnings).toEqual([]);
  });

  test("uses profile and public artifact flags for video runs", () => {
    const config = readE2EConfig({
      env: {
        E2E_PROFILE: "video",
        E2E_ARTIFACTS: "video,panel,headless",
      },
    });

    expect(config.browser.headless).toBe(true);
    expect(config.browser.panelMode).toBe("overlay");
    expect(config.artifacts.recordVideo).toBe(true);
    expect(config.artifacts.finalScreenshot).toBe(true);
    expect(serializeE2EArtifacts(config)).toContain("video");
    expect(serializeE2EArtifacts(config)).toContain("headless");
  });

  test("maps suite flags to optional gates", () => {
    const env = {
      E2E_SUITE_FLAGS: "single-process,memory-long,diagnostic",
    };
    const config = readE2EConfig({ env });

    expect(isE2ESuiteFlagEnabled("single-process", { env })).toBe(true);
    expect(isE2ESuiteFlagEnabled("memory-long", { env })).toBe(true);
    expect(config.diagnostic).toBe(true);
    expect(serializeE2ESuiteFlags(config)).toBe(
      "diagnostic,memory-long,single-process",
    );
  });

  test("keeps legacy env aliases as deprecated compatibility input", () => {
    const config = readE2EConfig({
      env: {
        E2E_HEADLESS: "true",
        E2E_SHOW_PANEL: "false",
        E2E_RECORD_VIDEO: "true",
        E2E_EXECUTOR_MODEL: "accounts/fireworks/models/custom",
        E2E_USE_VL_EXECUTOR: "true",
      },
    });

    expect(config.browser.headless).toBe(true);
    expect(config.browser.panelMode).toBe("off");
    expect(config.artifacts.recordVideo).toBe(true);
    expect(config.model).toBe("accounts/fireworks/models/custom");
    expect(config.perceptionMode).toBe("unified_vl");
    expect(config.deprecatedEnvWarnings.length).toBeGreaterThanOrEqual(5);
  });

  test("exports resolved config through public env names for child runs", () => {
    const config = readE2EConfig({
      env: {
        E2E_PROFILE: "video",
        E2E_PROVIDER: "fireworks",
        E2E_MODEL: "test-model",
        E2E_PERCEPTION_MODE: "unified_vl",
        E2E_SUITE_FLAGS: "diagnostic",
      },
    });
    const childEnv = withE2EConfigEnv({}, config);

    expect(childEnv.E2E_PROFILE).toBe("video");
    expect(childEnv.E2E_PROVIDER).toBe("fireworks");
    expect(childEnv.E2E_MODEL).toBe("test-model");
    expect(childEnv.E2E_PERCEPTION_MODE).toBe("unified_vl");
    expect(childEnv.E2E_SUITE_FLAGS).toBe("diagnostic");
    expect(childEnv.E2E_ARTIFACTS).toContain("video");
  });
});
