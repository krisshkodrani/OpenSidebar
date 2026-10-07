import assert from "node:assert/strict";
import test from "node:test";
import { preflightBrowserCapture } from "./modelbench-browser-preflight.js";

function png(): string {
  const header = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(header);
  header.write("IHDR", 12);
  header.writeUInt32BE(1365, 16);
  header.writeUInt32BE(900, 20);
  return `data:image/png;base64,${header.toString("base64")}`;
}

async function probe(options: {
  capture?: () => Promise<string>;
  activeIds?: number[];
  focus?: () => Promise<void>;
} = {}) {
  const previous = (globalThis as any).chrome;
  let queries = 0;
  let captured = false;
  (globalThis as any).chrome = { tabs: {
    get: async (id: number) => ({ id, windowId: 7 }),
    query: async () => [{ id: options.activeIds?.[queries++] ?? 42 }],
    captureVisibleTab: async (windowId: number, options_: unknown) => {
      assert.equal(windowId, 7);
      assert.deepEqual(options_, { format: "png" });
      captured = true;
      return options.capture ? options.capture() : png();
    },
  } };
  const helper = {
    isClosed: () => false,
    url: () => "chrome-extension://test/e2e-helper.html",
    title: async () => "E2E Helper",
    evaluate: (fn: (id: number) => Promise<string>, id: number) => fn(id),
  };
  try {
    return await preflightBrowserCapture(
      { extensionId: "test", helperPage: helper } as never,
      { bringToFront: options.focus ?? (async () => {}) }, 42, 20,
    );
  } finally {
    (globalThis as any).chrome = previous;
    if (options.activeIds?.[0] !== undefined && options.activeIds[0] !== 42) {
      assert.equal(captured, false);
    }
  }
}

test("preflight exercises the target window capture and reports image dimensions", async () => {
  assert.deepEqual(await probe(), { width: 1365, height: 900, bytes: 33 });
});
test("capture rejection and invalid images fail preflight", async () => {
  await assert.rejects(probe({ capture: async () => { throw new Error("capture unavailable"); } }), /capture unavailable/);
  await assert.rejects(probe({ capture: async () => "" }), /no PNG/);
  await assert.rejects(probe({ capture: async () => "data:image/png;base64,AAAA" }), /invalid PNG/);
});
test("a wrong or changed active tab cannot pass capture preflight", async () => {
  await assert.rejects(probe({ activeIds: [99] }), /not the active tab/);
  await assert.rejects(probe({ activeIds: [42, 99] }), /changed during capture/);
});
test("both suspended capture and suspended focus have a bounded deadline", async () => {
  await assert.rejects(probe({ capture: () => new Promise(() => {}) }), /preflight timed out/);
  await assert.rejects(probe({ focus: () => new Promise(() => {}) }), /preflight timed out/);
});
