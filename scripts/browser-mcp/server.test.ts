import { describe, expect, it } from "vitest";

import {
  NotConnectedBridge,
  type BrowserBridge,
  type BrowserToolRequest,
  type BrowserToolResponse,
} from "./bridge";
import { dispatch } from "./server";
import { BROWSER_TOOLS } from "./tools";

class MockBridge implements BrowserBridge {
  public last: BrowserToolRequest | null = null;
  constructor(private response: BrowserToolResponse) {}
  async call(request: BrowserToolRequest): Promise<BrowserToolResponse> {
    this.last = request;
    return this.response;
  }
}

describe("BROWSER_TOOLS", () => {
  it("exposes the thick intent-level tools", () => {
    const names = BROWSER_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      "browser_ping",
      "browser_navigate",
      "browser_screenshot",
      "browser_extract_structured",
      "browser_research_company",
      "browser_apply_to_job",
      "browser_run_task",
    ]);
    for (const tool of BROWSER_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

describe("dispatch", () => {
  it("forwards a validated call to the bridge as { tool, args }", async () => {
    const bridge = new MockBridge({ status: "ok", result: { title: "Example" } });
    const res = await dispatch(bridge, "browser_navigate", {
      url: "https://example.com",
    });
    expect(res.status).toBe("ok");
    expect(bridge.last).toEqual({
      tool: "browser_navigate",
      args: { url: "https://example.com" },
    });
  });

  it("passes a needs_human result straight through (not an error)", async () => {
    const bridge = new MockBridge({ status: "needs_human", reason: "captcha" });
    const res = await dispatch(bridge, "browser_apply_to_job", {
      url: "https://jobs.example.com/123",
    });
    expect(res.status).toBe("needs_human");
    expect(res.reason).toBe("captcha");
  });

  it("rejects calls missing a required argument before hitting the bridge", async () => {
    const bridge = new MockBridge({ status: "ok" });
    await expect(dispatch(bridge, "browser_navigate", {})).rejects.toThrow(
      /Missing required argument.*url/,
    );
    expect(bridge.last).toBeNull();
  });

  it("rejects an unknown tool", async () => {
    const bridge = new MockBridge({ status: "ok" });
    await expect(dispatch(bridge, "browser_teleport", {})).rejects.toThrow(
      /Unknown tool/,
    );
  });

  it("allows tools with no required args", async () => {
    const bridge = new MockBridge({ status: "ok", result: "pong" });
    const res = await dispatch(bridge, "browser_ping", {});
    expect(res.result).toBe("pong");
  });
});

describe("NotConnectedBridge", () => {
  it("returns a structured error until the transport is wired", async () => {
    const res = await dispatch(new NotConnectedBridge(), "browser_ping", {});
    expect(res.status).toBe("error");
    expect(res.reason).toMatch(/not connected/i);
  });
});
