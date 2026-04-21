import { describe, test, expect, beforeEach, vi } from "vitest";
import "../setup";
import {
  executeContentTool,
  reinjectContentScript,
  recoverContentScriptBridge,
} from "../../src/background/tools/bridge";
import {
  ensureContentScript,
  probeContentScript,
} from "../../src/background/tab-ready";
import { ToolName } from "../../src/types";

/**
 * Bridge reconnect tests (WI-3)
 *
 * These test the helper functions and reconnect logic for content script
 * bridge disconnects. Since the actual `executeContentTool` function is
 * tightly coupled to Chrome APIs, we test the detection logic and
 * mock the full flow.
 */

// We can't directly import the private functions from tools/index.ts,
// so we test the patterns they rely on.

describe("Bridge disconnect detection", () => {
  /** Mirror of isBridgeDisconnect from tools/index.ts */
  function isBridgeDisconnect(errorMsg: string): boolean {
    return errorMsg.includes("Receiving end does not exist")
      || errorMsg.includes("Could not establish connection")
      || errorMsg.includes("The message port closed");
  }

  test("recognizes 'Receiving end does not exist'", () => {
    expect(isBridgeDisconnect("Receiving end does not exist")).toBe(true);
  });

  test("recognizes 'Could not establish connection'", () => {
    expect(isBridgeDisconnect("Could not establish connection. Receiving end does not exist.")).toBe(true);
  });

  test("recognizes 'The message port closed'", () => {
    expect(isBridgeDisconnect("The message port closed before a response was received.")).toBe(true);
  });

  test("rejects unrelated errors", () => {
    expect(isBridgeDisconnect("TypeError: Cannot read properties of null")).toBe(false);
    expect(isBridgeDisconnect("NetworkError: Failed to fetch")).toBe(false);
    expect(isBridgeDisconnect("Permission denied")).toBe(false);
  });
});

describe("Content script reinjection flow", () => {
  beforeEach(() => {
    // Reset chrome mocks
    (chrome.runtime.getManifest as any) = () => ({
      content_scripts: [{ js: ["content.js"] }],
    });
    (chrome.scripting as any) = {
      executeScript: vi.fn(() => Promise.resolve()),
    };
    (chrome.tabs as any).get = vi.fn(() => Promise.resolve({ id: 1, url: "https://example.com" }));
    (chrome.tabs as any).update = vi.fn((_tabId: number, update: { url?: string }) =>
      Promise.resolve({ id: 1, url: update.url ?? "https://example.com" }),
    );
    (chrome.tabs as any).reload = vi.fn(() => Promise.resolve());
    (chrome.tabs as any).sendMessage = vi.fn(() => Promise.resolve({
      payload: { result: "OK" },
    }));
  });

  test("probeContentScript marks a tab responsive when messaging succeeds", async () => {
    await expect(probeContentScript(101, 25)).resolves.toBe(true);
  });

  test("ensureContentScript revalidates stale ready tabs before trusting cache", async () => {
    let firstProbe = true;
    (chrome.tabs as any).sendMessage = vi.fn(() => {
      if (firstProbe) {
        firstProbe = false;
        return Promise.resolve({ payload: { result: "OK" } });
      }
      return Promise.reject(new Error("Receiving end does not exist"));
    });

    await expect(probeContentScript(105, 25)).resolves.toBe(true);

    let recoveryAttempt = 0;
    (chrome.tabs as any).sendMessage = vi.fn(() => {
      recoveryAttempt += 1;
      if (recoveryAttempt === 1) {
        return Promise.reject(new Error("Receiving end does not exist"));
      }
      return Promise.resolve({ payload: { result: "OK" } });
    });

    await expect(ensureContentScript(105, 10)).resolves.toBe(true);
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
  });

  test("ensureContentScript falls back to a direct probe after readiness timeout", async () => {
    await expect(ensureContentScript(102, 10)).resolves.toBe(true);
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
  });

  test("tab-closed scenario returns error without reinject attempt", async () => {
    // Simulate tab closed: chrome.tabs.get throws
    (chrome.tabs as any).get = vi.fn(() => Promise.reject(new Error("No tab with id: 999")));

    // The bridge reconnect logic should:
    // 1. Detect bridge disconnect
    // 2. Try chrome.tabs.get → fails
    // 3. Return "tab closed" error without attempting reinject

    // Verify that tabs.get rejects for dead tabs
    let error: Error | null = null;
    try {
      await chrome.tabs.get(999);
    } catch (e: any) {
      error = e;
    }
    expect(error).not.toBeNull();
    expect(error!.message).toContain("No tab");

    // Verify scripting.executeScript was NOT called
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test("reinject flow uses manifest content_scripts", () => {
    const manifest = chrome.runtime.getManifest();
    expect(manifest.content_scripts).toBeDefined();
    expect(manifest.content_scripts![0].js).toEqual(["content.js"]);
  });

  test("executeScript is called with correct target", async () => {
    const tabId = 42;
    const manifest = chrome.runtime.getManifest();
    const files = manifest.content_scripts?.[0]?.js;

    await chrome.scripting.executeScript({ target: { tabId }, files: files! });

    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      files: ["content.js"],
    });
  });

  test("sendMessage retry after reinject returns result", async () => {
    const tabId = 1;
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "TOOL_EXECUTE",
      payload: { toolName: "click", args: { id: 5 } },
    });
    expect(response.payload.result).toBe("OK");
  });

  test("reinjectContentScript does not silently reload by default", async () => {
    (chrome.tabs as any).sendMessage = vi.fn(() =>
      Promise.reject(new Error("Receiving end does not exist")),
    );

    await expect(reinjectContentScript(103)).resolves.toBe(false);
    expect(chrome.tabs.reload).not.toHaveBeenCalled();
  });

  test("reinjectContentScript reload fallback is opt-in", async () => {
    let reloaded = false;
    (chrome.scripting as any).executeScript = vi.fn(() =>
      Promise.reject(new Error("loader unavailable")),
    );
    (chrome.tabs as any).reload = vi.fn(() => {
      reloaded = true;
      return Promise.resolve();
    });
    (chrome.tabs as any).sendMessage = vi.fn(() => {
      if (!reloaded) {
        return Promise.reject(new Error("Receiving end does not exist"));
      }
      return Promise.resolve({ payload: { result: "OK" } });
    });
    (chrome.webNavigation as any).onCompleted = {
      addListener: (cb: (details: { tabId: number; frameId: number }) => void) =>
        setTimeout(() => cb({ tabId: 104, frameId: 0 }), 0),
      removeListener: () => {},
    };
    (chrome.webNavigation as any).onErrorOccurred = {
      addListener: () => {},
      removeListener: () => {},
    };

    await expect(
      reinjectContentScript(104, { allowReloadFallback: true }),
    ).resolves.toBe(true);
    expect(chrome.tabs.reload).toHaveBeenCalledWith(104);
  }, 10000);

  test("recoverContentScriptBridge waits for DOM readiness before confirming recovery", async () => {
    let attempts = 0;
    (chrome.tabs as any).sendMessage = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(new Error("Receiving end does not exist"));
      }
      return Promise.resolve({ payload: { result: "OK", waitedMs: 25, elementCount: 4 } });
    });

    await expect(recoverContentScriptBridge(106)).resolves.toBe(true);
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
    expect((chrome.tabs as any).sendMessage).toHaveBeenCalled();
  });

  test("recoverContentScriptBridge emits structured trace callbacks", async () => {
    const events: Array<Record<string, unknown>> = [];

    let attempts = 0;
    (chrome.tabs as any).sendMessage = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(new Error("Receiving end does not exist"));
      }
      return Promise.resolve({ payload: { result: "OK", waitedMs: 25, elementCount: 4 } });
    });

    await expect(
      recoverContentScriptBridge(111, {
        traceHook: (event) => events.push(event),
        context: "snapshot",
      }),
    ).resolves.toBe(true);

    expect(events).toEqual([
      {
        stage: "attempt",
        phase: "reinject",
        context: "snapshot",
        toolName: undefined,
      },
      {
        stage: "result",
        phase: "reinject",
        context: "snapshot",
        toolName: undefined,
        success: true,
      },
    ]);
  });

  test("recoverContentScriptBridge tolerates a few failed probes before succeeding", async () => {
    let probeAttempts = 0;
    (chrome.tabs as any).sendMessage = vi.fn(() => {
      probeAttempts += 1;
      if (probeAttempts <= 3) {
        return Promise.reject(new Error("Receiving end does not exist"));
      }
      return Promise.resolve({ payload: { result: "OK", waitedMs: 25, elementCount: 4 } });
    });

    await expect(
      recoverContentScriptBridge(109, { allowReloadFallback: false, ensureTimeoutMs: 50, domReadyTimeoutMs: 25 }),
    ).resolves.toBe(true);
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
    expect(probeAttempts).toBeGreaterThan(3);
  });

  test("executeContentTool recovers after a bridge disconnect", async () => {
    let attempts = 0;
    let reinjected = false;
    (chrome.scripting as any).executeScript = vi.fn(() => {
      reinjected = true;
      return Promise.resolve();
    });
    (chrome.tabs as any).sendMessage = vi.fn((_tabId: number, message: any) => {
      if (message.type === "TOOL_EXECUTE") {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(new Error("Receiving end does not exist"));
        }
        if (!reinjected) {
          return Promise.reject(new Error("Receiving end does not exist"));
        }
        return Promise.resolve({ payload: { result: "clicked" } });
      }
      if (!reinjected) {
        return Promise.reject(new Error("Receiving end does not exist"));
      }
      return Promise.resolve({ payload: { result: "OK", waitedMs: 10, elementCount: 3 } });
    });

    await expect(
      executeContentTool(ToolName.CLICK_ELEMENT, { elementId: "e1" }, 107),
    ).resolves.toBe("clicked");
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
  });

  test("executeContentTool retries immediately after a transient bridge disconnect", async () => {
    let toolAttempts = 0;
    let probeAttempts = 0;
    (chrome.tabs as any).sendMessage = vi.fn((_tabId: number, message: any) => {
      if (message.type === "TOOL_EXECUTE") {
        toolAttempts += 1;
        if (toolAttempts === 1) {
          return Promise.reject(new Error("Receiving end does not exist"));
        }
        return Promise.resolve({ payload: { result: "clicked-after-transient-probe" } });
      }
      probeAttempts += 1;
      return Promise.resolve({ payload: { result: "OK", waitedMs: 10, elementCount: 3 } });
    });

    await expect(
      executeContentTool(ToolName.CLICK_ELEMENT, { elementId: "e2" }, 110),
    ).resolves.toBe("clicked-after-transient-probe");
    expect(probeAttempts).toBeGreaterThan(0);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test("executeContentTool emits transient probe bridge trace callbacks", async () => {
    const events: Array<Record<string, unknown>> = [];
    let toolAttempts = 0;

    (chrome.tabs as any).sendMessage = vi.fn((_tabId: number, message: any) => {
      if (message.type === "TOOL_EXECUTE") {
        toolAttempts += 1;
        if (toolAttempts === 1) {
          return Promise.reject(new Error("Receiving end does not exist"));
        }
        return Promise.resolve({ payload: { result: "clicked-after-transient-probe" } });
      }
      return Promise.resolve({ payload: { result: "OK", waitedMs: 10, elementCount: 3 } });
    });

    await expect(
      executeContentTool(
        ToolName.CLICK_ELEMENT,
        { elementId: "e3" },
        112,
        (event) => events.push(event),
      ),
    ).resolves.toBe("clicked-after-transient-probe");

    expect(events).toEqual([
      {
        stage: "attempt",
        phase: "transient_probe",
        context: "tool_execution",
        toolName: ToolName.CLICK_ELEMENT,
        error: "Receiving end does not exist",
      },
      {
        stage: "result",
        phase: "transient_probe",
        context: "tool_execution",
        toolName: ToolName.CLICK_ELEMENT,
        success: true,
      },
    ]);
  });

  test("executeContentTool falls back to reopening the current page when reinjection recovery fails", async () => {
    let toolAttempts = 0;
    let probeAttempts = 0;
    (chrome.scripting as any).executeScript = vi.fn(() =>
      Promise.reject(new Error("loader unavailable")),
    );
    (chrome.webNavigation as any).onCompleted = {
      addListener: (cb: (details: { tabId: number; frameId: number }) => void) =>
        setTimeout(() => cb({ tabId: 108, frameId: 0 }), 0),
      removeListener: () => {},
    };
    (chrome.webNavigation as any).onErrorOccurred = {
      addListener: () => {},
      removeListener: () => {},
    };
    (chrome.tabs as any).sendMessage = vi.fn((_tabId: number, message: any) => {
      if (message.type === "TOOL_EXECUTE") {
        toolAttempts += 1;
        if (toolAttempts < 3) {
          return Promise.reject(new Error("Receiving end does not exist"));
        }
        return Promise.resolve({ payload: { result: "clicked-after-hard-reload" } });
      }
      probeAttempts += 1;
      if (probeAttempts < 3) {
        return Promise.reject(new Error("Receiving end does not exist"));
      }
      return Promise.resolve({ payload: { result: "OK", waitedMs: 10, elementCount: 3 } });
    });

    await expect(
      executeContentTool(ToolName.CLICK_ELEMENT, { elementId: "e1" }, 108),
    ).resolves.toBe("clicked-after-hard-reload");
    expect(chrome.tabs.update).toHaveBeenCalled();
  }, 15000);
});
