import assert from "node:assert/strict";
import test from "node:test";
import {
  isDetachedServiceWorkerError,
  withLiveServiceWorker,
} from "../apps/extension/tests/e2e/helpers/browser.js";

const EXTENSION_ID = "gnilechepkedfjlhhobofdeakglbpolk";

/** Minimal puppeteer stand-ins: only what waitForLiveServiceWorker touches. */
function makeContext() {
  const replacementWorker = {
    evaluate: async () => true,
  };
  const replacementTarget = {
    type: () => "service_worker",
    url: () => `chrome-extension://${EXTENSION_ID}/service-worker-loader.js`,
    worker: async () => replacementWorker,
  };
  const deadWorker = { evaluate: async () => true };
  const ctx = {
    browser: {
      // waitForLiveServiceWorker opens a wake page first; it tolerates failure.
      newPage: async () => {
        throw new Error("no pages in this fake");
      },
      targets: () => [replacementTarget],
    },
    extensionId: EXTENSION_ID,
    serviceWorker: deadWorker,
    serviceWorkerTarget: { url: () => "stale" },
    serviceWorkerUrl: "stale",
  };
  return { ctx, deadWorker, replacementWorker, replacementTarget };
}

const DETACHED = new Error(
  'Execution context is not available in detached frame or worker "chrome-extension://x/service-worker-loader.js" (are you trying to evaluate?)',
);

test("recognizes the detached-worker signature Chrome produces on eviction", () => {
  assert.equal(isDetachedServiceWorkerError(DETACHED), true);
  assert.equal(
    isDetachedServiceWorkerError(new Error("Execution context was destroyed")),
    true,
  );
  assert.equal(isDetachedServiceWorkerError(new Error("Target closed")), true);
});

test("does not treat ordinary product failures as worker eviction", () => {
  assert.equal(
    isDetachedServiceWorkerError(new Error("Task validation failed")),
    false,
  );
  assert.equal(isDetachedServiceWorkerError(undefined), false);
});

test("passes the current worker through when nothing is wrong", async () => {
  const { ctx, deadWorker } = makeContext();
  let seen: unknown = null;
  const result = await withLiveServiceWorker(ctx as never, async (worker) => {
    seen = worker;
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(seen, deadWorker);
  assert.equal(ctx.serviceWorker, deadWorker, "handle must not be swapped");
});

test("re-acquires the worker and retries once after eviction", async () => {
  const { ctx, replacementWorker } = makeContext();
  const workers: unknown[] = [];
  const result = await withLiveServiceWorker(ctx as never, async (worker) => {
    workers.push(worker);
    if (workers.length === 1) throw DETACHED;
    return "recovered";
  });

  assert.equal(result, "recovered");
  assert.equal(workers.length, 2, "should retry exactly once");
  assert.equal(workers[1], replacementWorker);
  assert.equal(
    ctx.serviceWorker,
    replacementWorker,
    "refreshed handle must be written back for later calls",
  );
  assert.equal(
    ctx.serviceWorkerUrl,
    `chrome-extension://${EXTENSION_ID}/service-worker-loader.js`,
  );
});

test("rethrows a non-eviction error without retrying", async () => {
  const { ctx } = makeContext();
  let calls = 0;
  await assert.rejects(
    withLiveServiceWorker(ctx as never, async () => {
      calls += 1;
      throw new Error("planner upstream unavailable");
    }),
    /planner upstream unavailable/,
  );
  assert.equal(calls, 1, "a real failure must not be masked as harness flake");
});

test("propagates the second failure when recovery does not help", async () => {
  const { ctx } = makeContext();
  let calls = 0;
  await assert.rejects(
    withLiveServiceWorker(ctx as never, async () => {
      calls += 1;
      throw DETACHED;
    }),
    /detached frame or worker/,
  );
  assert.equal(calls, 2, "retries once, then gives up");
});
