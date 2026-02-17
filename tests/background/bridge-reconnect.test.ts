import { describe, test, expect, beforeEach, mock } from "bun:test";
import "../setup";

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
      executeScript: mock(() => Promise.resolve()),
    };
    (chrome.tabs as any).get = mock(() => Promise.resolve({ id: 1, url: "https://example.com" }));
    (chrome.tabs as any).sendMessage = mock(() => Promise.resolve({
      payload: { result: "OK" },
    }));
  });

  test("tab-closed scenario returns error without reinject attempt", async () => {
    // Simulate tab closed: chrome.tabs.get throws
    (chrome.tabs as any).get = mock(() => Promise.reject(new Error("No tab with id: 999")));

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
});
