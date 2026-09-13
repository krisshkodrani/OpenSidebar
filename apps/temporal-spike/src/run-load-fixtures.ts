import { Connection, WorkflowClient } from "@temporalio/client";
import { eventSignal, stateQuery, syntheticSessionWorkflow } from "./workflows.js";

const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const namespace = process.env.TEMPORAL_NAMESPACE ?? "opensidebar-spike";
const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? "opensidebar-spike-v1";

const percentile = (values: number[], fraction: number) =>
  values[Math.min(values.length - 1, Math.floor(values.length * fraction))];

async function runSession(
  client: WorkflowClient,
  lane: "concurrent" | "reconnect",
  duplicate: boolean,
) {
  const startedAt = performance.now();
  const sessionId = crypto.randomUUID();
  const commandId = crypto.randomUUID();
  const handle = await client.start(syntheticSessionWorkflow, {
    workflowId: `spike:load:${lane}:${sessionId}`,
    taskQueue,
    args: [{
      schemaVersion: 1,
      fixture: duplicate ? "disconnect" : "normal",
      sessionId,
      commandId,
      revision: 0,
      leaseGeneration: 1,
      iteration: 0,
      deadlineEpochMs: Date.now() + 60_000,
    }],
  });
  await handle.signal(eventSignal, { type: "device_connected", leaseGeneration: 1 });
  const deliveryDeadline = performance.now() + 10_000;
  let delivered = false;
  while (!delivered) {
    const state = await handle.query(stateQuery);
    delivered = state.state === "command_issued" || state.state === "waiting_result";
    if (!delivered && performance.now() >= deliveryDeadline)
      throw new Error("command_delivery_timeout");
    if (!delivered) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const deliveryMs = Math.round(performance.now() - startedAt);
  const acknowledgement = {
    type: "command_acknowledged" as const,
    commandId,
    leaseGeneration: 1,
  };
  await handle.signal(eventSignal, acknowledgement);
  if (duplicate) await handle.signal(eventSignal, acknowledgement);
  const resultSignal = {
    type: "command_result" as const,
    commandId,
    leaseGeneration: 1,
    outcome: "succeeded" as const,
  };
  await handle.signal(eventSignal, resultSignal);
  if (duplicate) await handle.signal(eventSignal, resultSignal);
  const result = await handle.result();
  if (result.state !== "completed") throw new Error(`load_session_failed:${result.state}`);
  return { completionMs: Math.round(performance.now() - startedAt), deliveryMs };
}

const connection = await Connection.connect({ address });
try {
  const client = new WorkflowClient({ connection, namespace });
  const concurrent = await Promise.all(
    Array.from({ length: 5 }, () => runSession(client, "concurrent", false)),
  );
  const reconnect = await Promise.all(
    Array.from({ length: 25 }, () => runSession(client, "reconnect", true)),
  );
  const all = [...concurrent, ...reconnect];
  const completions = all.map((item) => item.completionMs).sort((a, b) => a - b);
  const deliveries = all.map((item) => item.deliveryMs).sort((a, b) => a - b);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    concurrentSessions: concurrent.length,
    reconnectDevices: reconnect.length,
    duplicateAcknowledgements: reconnect.length,
    duplicateResults: reconnect.length,
    checkpointCommits: completions.length,
    failures: 0,
    latencyMs: {
      min: completions[0],
      p50: percentile(completions, 0.5),
      p95: percentile(completions, 0.95),
      max: completions[completions.length - 1],
    },
    reconnectToDeliveryLatencyMs: {
      min: deliveries[0],
      p50: percentile(deliveries, 0.5),
      p95: percentile(deliveries, 0.95),
      max: deliveries[deliveries.length - 1],
    },
  }, null, 2)}\n`);
} finally {
  await connection.close();
}
