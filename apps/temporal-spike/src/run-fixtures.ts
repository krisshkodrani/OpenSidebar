import { Connection, WorkflowClient } from "@temporalio/client";
import { SPIKE_FIXTURES, type SpikeFixture } from "./contracts.js";
import {
  eventSignal,
  stateQuery,
  syntheticSessionWorkflow,
} from "./workflows.js";

const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const namespace = process.env.TEMPORAL_NAMESPACE ?? "opensidebar-spike";
const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? "opensidebar-spike-v1";
const forbidden = [
  "canary@example.invalid",
  "https://canary.invalid/private",
  "CANARY_AUTHORIZATION",
  "CANARY_PROVIDER_KEY",
  "CANARY_COOKIE",
  "CANARY_PROMPT_TEXT",
  "CANARY_SCREENSHOT_BYTES",
  "CANARY_CHECKPOINT_PLAINTEXT",
];

async function driveFixture(client: WorkflowClient, fixture: SpikeFixture) {
  const sessionId = crypto.randomUUID();
  const commandId = crypto.randomUUID();
  const workflowId = `spike:${fixture}:${sessionId}`;
  const handle = await client.start(syntheticSessionWorkflow, {
    workflowId,
    taskQueue,
    args: [{
      schemaVersion: 1,
      fixture,
      sessionId,
      commandId,
      revision: 0,
      leaseGeneration: 1,
      iteration: 0,
      deadlineEpochMs: Date.now() + 1_000,
    }],
  });

  if (fixture === "account_delete") {
    await handle.signal(eventSignal, { type: "account_delete" });
  } else {
    await handle.signal(eventSignal,
      fixture === "takeover_race"
        ? { type: "takeover", leaseGeneration: 2 }
        : { type: "device_connected", leaseGeneration: 1 },
    );
    const activeGeneration = fixture === "takeover_race" ? 2 : 1;
    await handle.signal(eventSignal, {
      type: "command_acknowledged",
      commandId,
      leaseGeneration: activeGeneration,
    });
    if (fixture === "disconnect")
      await handle.signal(eventSignal, {
        type: "command_acknowledged",
        commandId,
        leaseGeneration: activeGeneration,
      });
    if (fixture !== "approval_timeout") {
      if (fixture === "takeover_race")
        await handle.signal(eventSignal, {
          type: "command_result",
          commandId,
          leaseGeneration: 1,
          outcome: "succeeded",
        });
      await handle.signal(eventSignal, {
        type: "command_result",
        commandId,
        leaseGeneration: activeGeneration,
        outcome: "succeeded",
      });
      if (fixture === "disconnect")
        await handle.signal(eventSignal, {
          type: "command_result",
          commandId,
          leaseGeneration: activeGeneration,
          outcome: "succeeded",
        });
    }
  }

  if (fixture === "continue_as_new") {
    for (let iteration = 1; iteration <= 2; iteration += 1) {
      while ((await handle.query(stateQuery)).iteration < iteration)
        await new Promise((resolve) => setTimeout(resolve, 25));
      await handle.signal(eventSignal, { type: "device_connected", leaseGeneration: 1 });
      await handle.signal(eventSignal, {
        type: "command_acknowledged",
        commandId,
        leaseGeneration: 1,
      });
      await handle.signal(eventSignal, {
        type: "command_result",
        commandId,
        leaseGeneration: 1,
        outcome: "succeeded",
      });
    }
  }

  const result = await handle.result();
  const history = await handle.fetchHistory();
  const serialized = JSON.stringify({ result, history });
  const leaks = forbidden.filter((value) => serialized.includes(value));
  if (leaks.length > 0) throw new Error(`forbidden_content_leak:${leaks.join(",")}`);
  return { fixture, workflowId, state: result.state, historyBytes: serialized.length };
}

const connection = await Connection.connect({ address });
try {
  const client = new WorkflowClient({ connection, namespace });
  const results = [];
  for (const fixture of SPIKE_FIXTURES) results.push(await driveFixture(client, fixture));
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, results }, null, 2)}\n`);
} finally {
  await connection.close();
}
