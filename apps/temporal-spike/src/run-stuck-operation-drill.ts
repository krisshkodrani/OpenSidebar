import { Connection, WorkflowClient } from "@temporalio/client";
import { eventSignal, stateQuery, syntheticSessionWorkflow } from "./workflows.js";

const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const namespace = process.env.TEMPORAL_NAMESPACE ?? "opensidebar-spike";
const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? "opensidebar-spike-v1";
const connection = await Connection.connect({ address });

try {
  const client = new WorkflowClient({ connection, namespace });
  const workflowId = `spike:stuck:${crypto.randomUUID()}`;
  const stuck = await client.start(syntheticSessionWorkflow, {
    workflowId,
    taskQueue,
    args: [{ schemaVersion: 1, fixture: "stuck_operation", sessionId: crypto.randomUUID(), commandId: crypto.randomUUID(), revision: 0, leaseGeneration: 1, iteration: 0, deadlineEpochMs: Date.now() + 60_000 }],
  });
  const deadline = Date.now() + 15_000;
  while ((await stuck.query(stateQuery)).state !== "checkpointing") {
    if (Date.now() >= deadline) throw new Error("stuck_activity_not_observed");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stuck.terminate("bounded_spike_operator_recovery");

  const commandId = crypto.randomUUID();
  const replacement = await client.start(syntheticSessionWorkflow, {
    workflowId,
    taskQueue,
    args: [{ schemaVersion: 1, fixture: "normal", sessionId: crypto.randomUUID(), commandId, revision: 0, leaseGeneration: 2, iteration: 0, deadlineEpochMs: Date.now() + 60_000 }],
  });
  await replacement.signal(eventSignal, { type: "device_connected", leaseGeneration: 2 });
  await replacement.signal(eventSignal, { type: "command_acknowledged", commandId, leaseGeneration: 2 });
  await replacement.signal(eventSignal, { type: "command_result", commandId, leaseGeneration: 2, outcome: "succeeded" });
  const result = await replacement.result();
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, workflowId, stuckRunTerminated: true, databaseRowsEdited: false, replacementRunState: result.state, replacementLeaseGeneration: result.leaseGeneration }, null, 2)}\n`);
} finally {
  await connection.close();
}
