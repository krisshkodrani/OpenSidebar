import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionBrowserCommand,
  canTransitionCloudSession,
  canTransitionSessionLease,
  isTerminalBrowserCommand,
  validatePortableBrowserAction,
  type BrowserCommandState,
} from "@opensidebar/shared-types";

test("browser command transitions are monotonic and terminal states stay terminal", () => {
  assert.equal(canTransitionBrowserCommand("pending", "leased"), true);
  assert.equal(canTransitionBrowserCommand("delivered", "accepted"), true);
  assert.equal(canTransitionBrowserCommand("accepted", "started"), true);
  assert.equal(canTransitionBrowserCommand("started", "outcome_unknown"), true);
  assert.equal(canTransitionBrowserCommand("started", "cancelled"), false);
  assert.equal(canTransitionBrowserCommand("succeeded", "started"), false);

  const terminals: BrowserCommandState[] = [
    "succeeded",
    "failed",
    "outcome_unknown",
    "expired",
    "cancelled",
  ];
  for (const terminal of terminals)
    assert.equal(isTerminalBrowserCommand(terminal), true);
});

test("session deletion and lease revocation cannot transition back", () => {
  assert.equal(canTransitionCloudSession("active", "paused"), true);
  assert.equal(canTransitionCloudSession("completed", "deleting"), true);
  assert.equal(canTransitionCloudSession("deleting", "active"), false);
  assert.equal(canTransitionSessionLease("active", "grace"), true);
  assert.equal(canTransitionSessionLease("grace", "active"), true);
  assert.equal(canTransitionSessionLease("revoked", "active"), false);
});

test("portable actions reject environment and credential fields recursively", () => {
  assert.deepEqual(
    validatePortableBrowserAction({
      kind: "click",
      target: { description: "Submit button" },
      arguments: { text: "Submit" },
    }),
    { valid: true },
  );

  const forbidden = [
    "tabId",
    "frame_id",
    "selector",
    "cookie",
    "authorizationHeader",
    "provider-key",
  ];
  for (const key of forbidden) {
    const result = validatePortableBrowserAction({
      kind: "click",
      arguments: { nested: { [key]: "secret" } },
    });
    assert.equal(result.valid, false, key);
    if (!result.valid) assert.equal(result.code, "forbidden_field", key);
  }
});
