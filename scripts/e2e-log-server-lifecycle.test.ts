import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";

test("E2E log server can stop and restart without leaving its listening child behind", { timeout: 45_000 }, async () => {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  const previousPort = process.env.E2E_LOG_SERVER_PORT;
  process.env.E2E_LOG_SERVER_PORT = String(port);
  const { startLogServer, stopLogServer } = await import("../apps/extension/tests/e2e/helpers/diagnostics.js");
  const healthUrl = `http://127.0.0.1:${port}/health`;
  try {
    for (let cycle = 0; cycle < 2; cycle++) {
      await startLogServer();
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3_000) });
      assert.equal(response.status, 200);
      await response.text();
      await stopLogServer();
      await assert.rejects(fetch(healthUrl, { signal: AbortSignal.timeout(1_000) }));
    }
  } finally {
    await stopLogServer();
    if (previousPort === undefined) delete process.env.E2E_LOG_SERVER_PORT;
    else process.env.E2E_LOG_SERVER_PORT = previousPort;
  }
});
