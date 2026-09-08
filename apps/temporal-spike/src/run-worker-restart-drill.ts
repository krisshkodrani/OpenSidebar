import { Connection, WorkflowClient } from "@temporalio/client";
import { eventSignal, stateQuery, syntheticSessionWorkflow } from "./workflows.js";

const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const namespace = process.env.TEMPORAL_NAMESPACE ?? "opensidebar-spike";
const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? "opensidebar-spike-v1";
const mode = process.argv[2];

const connection = await Connection.connect({ address });
try {
  const client = new WorkflowClient({ connection, namespace });
  if (mode === "prepare") {
    const sessionId = crypto.randomUUID();
    const commandId = crypto.randomUUID();
    const workflowId = `spike:worker-restart:${sessionId}`;
    const handle = await client.start(syntheticSessionWorkflow, {
      workflowId,
      taskQueue,
      args: [{
        schemaVersion: 1,
        fixture: "normal",
        sessionId,
        commandId,
        revision: 0,
        leaseGeneration: 1,
        iteration: 0,
        deadlineEpochMs: Date.now() + 60_000,
      }],
    });
    await handle.signal(eventSignal, {
      type: "device_connected",
      leaseGeneration: 1,
    });
    await handle.signal(eventSignal, {
      type: "command_acknowledged",
      commandId,
      leaseGeneration: 1,
    });
    while ((await handle.query(stateQuery)).state !== "waiting_result")
      await new Promise((resolve) => setTimeout(resolve, 25));
    process.stdout.write(`${JSON.stringify({ workflowId, commandId })}\n`);
  } else if (mode === "complete") {
    const workflowId = process.env.WORKFLOW_ID;
    const commandId = process.env.COMMAND_ID;
    if (!workflowId || !commandId) throw new Error("missing_restart_drill_ids");
    const handle = client.getHandle(workflowId);
    const before = await handle.query(stateQuery);
    if (before.state !== "waiting_result")
      throw new Error(`unexpected_restart_state:${before.state}`);
    await handle.signal(eventSignal, {
      type: "command_result",
      commandId,
      leaseGeneration: 1,
      outcome: "succeeded",
    });
    const result = await handle.result();
    if (result.state !== "completed")
      throw new Error(`restart_drill_failed:${result.state}`);
    process.stdout.write(
      `${JSON.stringify({ workflowId, before: before.state, after: result.state })}\n`,
    );
  } else {
    throw new Error("usage: run-worker-restart-drill prepare|complete");
  }
} finally {
  await connection.close();
}
