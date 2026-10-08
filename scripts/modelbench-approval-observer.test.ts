import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { startApprovalAutoResponder } from "../apps/extension/tests/e2e/helpers/utils.js";

function harness() {
  let release!: (events: unknown[]) => void;
  let sent = 0;
  const worker = { evaluate: () => new Promise<unknown[]>((resolve) => { release = resolve; }) };
  const context = {
    extensionId: "test",
    helperPage: {
      isClosed: () => false,
      url: () => "chrome-extension://test/e2e-helper.html",
      title: async () => "E2E Helper",
      evaluate: async () => { sent++; },
    },
  };
  const responder = startApprovalAutoResponder(context as never, worker as never, "workspace", { pollMs: 1 });
  return { responder, release: (events: unknown[]) => release(events), sent: () => sent };
}

test("stopping the approval observer does not wait for a stalled worker read", async () => {
  const h = harness();
  let stopped = false;
  const stopping = h.responder.stop().then(() => { stopped = true; });
  try {
    await setImmediate();
    assert.equal(stopped, true, "read cancellation must settle stop without a worker response");
  } finally {
    h.release([]);
    await stopping;
  }
});

test("a pending read cannot send an approval after stop was requested", async () => {
  const h = harness();
  const stopping = h.responder.stop();
  h.release([{ type: "APPROVAL_REQUEST", approvalId: "late", workspaceId: "workspace" }]);
  await stopping;
  assert.equal(h.sent(), 0);
});

test("an active observer still answers an approval once", async () => {
  const h = harness();
  h.release([{ type: "APPROVAL_REQUEST", approvalId: "one", workspaceId: "workspace" }]);
  await setImmediate();
  assert.equal(h.sent(), 1);
  const stopping = h.responder.stop();
  h.release([]);
  await stopping;
});
