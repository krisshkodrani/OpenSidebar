import { describe, expect, it } from "vitest";
import {
  buildChromeLaunchArgs,
  formatWebGLPreflightFailure,
} from "../e2e/helpers/browser";

describe("E2E browser launch", () => {
  it("keeps headed Chrome WebGL-capable", () => {
    const args = buildChromeLaunchArgs({
      headless: false,
      singleProcess: false,
      extensionPath: "C:\\test-dist",
    });

    expect(args).not.toContain("--disable-gpu");
    expect(args).not.toContain("--disable-gpu-sandbox");
    expect(args).not.toContain("--in-process-gpu");
    expect(args).toContain("--start-maximized");
  });

  it("uses a WebGL-capable software renderer in headless Chrome", () => {
    const args = buildChromeLaunchArgs({
      headless: true,
      singleProcess: true,
      extensionPath: "C:\\test-dist",
    });

    expect(args).not.toContain("--disable-gpu");
    expect(args).toContain("--single-process");
    expect(args).toContain("--use-angle=swiftshader");
    expect(args).toContain("--enable-unsafe-swiftshader");
    expect(args).toContain("--window-size=1365,900");
  });

  it("explains WebGL preflight failures as environment failures", () => {
    expect(
      formatWebGLPreflightFailure({
        available: false,
        error: "canvas.getContext('webgl') returned null",
      }),
    ).toContain("environment problem into a task failure");
  });
});
