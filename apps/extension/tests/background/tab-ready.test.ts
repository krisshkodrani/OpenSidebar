import { afterEach, describe, expect, test, vi } from "vitest";
import { createFakeEnvironment } from "../fakes/environment";
import { clearTabReady, ensureContentScript, isTabReady, probeContentScript } from "../../src/background/infrastructure/tab-ready";

afterEach(() => { clearTabReady(901); vi.useRealTimers(); });

describe("content bridge deadlines", () => {
  test("a silent receiver cannot block the caller or mark a late reply ready", async () => {
    vi.useFakeTimers();
    const { env } = createFakeEnvironment();
    let reply!: (value: unknown) => void;
    env.content.sendMessage = () => new Promise((resolve) => { reply = resolve; });
    const result = probeContentScript(901, 100, env.content);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBe(false);
    reply({});
    await Promise.resolve();
    expect(isTabReady(901)).toBe(false);
  });

  test("script injection is included in the overall readiness deadline", async () => {
    vi.useFakeTimers();
    const { env } = createFakeEnvironment();
    env.content.getContentScriptFiles = () => ["content.js"];
    env.content.executeContentScripts = () => new Promise(() => {});
    const result = ensureContentScript(901, 100, env.content);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBe(false);
  });
});
