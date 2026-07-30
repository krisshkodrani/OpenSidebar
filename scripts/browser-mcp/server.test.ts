import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NotConnectedBridge,
  type BrowserBridge,
  type BrowserToolRequest,
  type BrowserToolResponse,
} from "./bridge";
import { dispatch, prepareLocalFileUpload } from "./server";
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
  it("exposes task-first tools before compatibility tools", () => {
    const names = BROWSER_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      "delegate_browser_task",
      "request_browser_file_upload",
      "get_browser_task",
      "continue_browser_task",
      "approve_browser_checkpoint",
      "cancel_browser_task",
      "list_browser_tasks",
      "get_browser_task_trace",
      "browser_bridge_status",
      "browser_ping",
      "browser_navigate",
      "browser_screenshot",
      "browser_extract_structured",
      "browser_research_company",
      "browser_apply_to_job",
      "browser_run_task",
      "browser_respond_approval",
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

  it("canonicalizes, hashes, and embeds only a bounded regular local file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opensidebar-upload-"));
    const file = join(directory, "release.txt");
    try {
      await writeFile(file, "hello", "utf8");
      const prepared = await prepareLocalFileUpload({
        task_id: "task-1",
        file_path: file,
        tab_id: 44,
        origin: "https://play.google.com",
        input_id: 9,
      });
      expect(prepared).toMatchObject({
        task_id: "task-1",
        tab_id: 44,
        origin: "https://play.google.com",
        input_id: 9,
        _validated_local_file: {
          filename: "release.txt",
          size: 5,
          sha256:
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          mimeType: "text/plain",
          dataBase64: "aGVsbG8=",
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects relative local file paths before reading", async () => {
    await expect(
      prepareLocalFileUpload({ file_path: "relative.txt" }),
    ).rejects.toThrow(/absolute local path/);
  });
});

describe("NotConnectedBridge", () => {
  it("returns a structured error until the transport is wired", async () => {
    const res = await dispatch(new NotConnectedBridge(), "browser_ping", {});
    expect(res.status).toBe("error");
    expect(res.reason).toMatch(/not connected/i);
  });
});
