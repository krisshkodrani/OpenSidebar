import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerSidepanelKeepalivePort } from "../../src/background/sidepanel-keepalive";
import { SIDEPANEL_KEEPALIVE_PORT_NAME } from "../../src/lib/sidepanel-keepalive";

describe("sidepanel keepalive receiver", () => {
  let connectListener: ((port: chrome.runtime.Port) => void) | undefined;

  beforeEach(() => {
    connectListener = undefined;
    globalThis.chrome = {
      runtime: {
        onConnect: {
          addListener: vi.fn((listener) => {
            connectListener = listener;
          }),
        },
      },
    } as unknown as typeof chrome;
  });

  test("accepts the named sidepanel port", () => {
    const addDisconnectListener = vi.fn();
    registerSidepanelKeepalivePort();

    connectListener?.({
      name: SIDEPANEL_KEEPALIVE_PORT_NAME,
      onDisconnect: { addListener: addDisconnectListener },
    } as unknown as chrome.runtime.Port);

    expect(addDisconnectListener).toHaveBeenCalledTimes(1);
  });

  test("ignores unrelated extension ports", () => {
    const addDisconnectListener = vi.fn();
    registerSidepanelKeepalivePort();

    connectListener?.({
      name: "other-port",
      onDisconnect: { addListener: addDisconnectListener },
    } as unknown as chrome.runtime.Port);

    expect(addDisconnectListener).not.toHaveBeenCalled();
  });
});
