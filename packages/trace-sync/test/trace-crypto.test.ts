import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRecoveryKey,
  decryptTraceBundle,
  encryptTraceBundle,
  inspectEncryptedTrace,
} from "../src/index.ts";

test("encrypts a full trace bundle and decrypts it only with its recovery key", async () => {
  const bundle = {
    schemaVersion: "2026-05-30",
    session: {
      id: "trace-1",
      task: "Summarize this page",
      startedAt: "2026-08-11T12:00:00.000Z",
    },
    entries: [{ type: "thought", text: "private" }],
    screenshots: [{ dataUrl: "data:image/png;base64,c2VjcmV0" }],
  };
  const recoveryKey = await createRecoveryKey();
  const envelope = await encryptTraceBundle(bundle, recoveryKey);
  const header = inspectEncryptedTrace(envelope);
  assert.equal(header.traceId, "trace-1");
  assert.equal(header.screenshotCount, 1);
  assert.equal(JSON.stringify(envelope).includes("private"), false);
  assert.deepEqual(
    (await decryptTraceBundle(envelope, recoveryKey)).bundle,
    bundle,
  );
  const otherKey = await createRecoveryKey();
  await assert.rejects(() => decryptTraceBundle(envelope, otherKey));
});

test("authenticated metadata rejects tampering", async () => {
  const key = await createRecoveryKey();
  const envelope = await encryptTraceBundle(
    {
      schemaVersion: "1",
      session: { id: "trace-2", task: "Original" },
      entries: [],
      screenshots: [],
    },
    key,
  );
  const altered = new Uint8Array(envelope);
  const original = new TextDecoder().decode(altered);
  const replacement = original.replace("trace-2", "trace-3");
  await assert.rejects(() =>
    decryptTraceBundle(new TextEncoder().encode(replacement), key),
  );
});

test("a second browser needs the copied recovery key after restart", async () => {
  const firstBrowserKey = await createRecoveryKey();
  const envelope = await encryptTraceBundle(
    {
      schemaVersion: "1",
      session: { id: "portable-trace", task: "Private task" },
      entries: [],
      screenshots: [],
    },
    firstBrowserKey,
  );
  const unrelatedSecondBrowserKey = await createRecoveryKey();
  await assert.rejects(() =>
    decryptTraceBundle(envelope, unrelatedSecondBrowserKey),
  );
  const copiedAfterRestart = String(firstBrowserKey);
  assert.equal(
    (
      (await decryptTraceBundle(envelope, copiedAfterRestart)).bundle
        .session as { task: string }
    ).task,
    "Private task",
  );
});
