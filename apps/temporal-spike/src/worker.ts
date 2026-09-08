import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";
import { runShadowPoller } from "./shadow-poller";

const address = process.env.TEMPORAL_ADDRESS ?? "temporal:7233";
const namespace = process.env.TEMPORAL_NAMESPACE ?? "opensidebar-spike";
const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? "opensidebar-spike-v1";

const connection = await NativeConnection.connect({ address });
const worker = await Worker.create({
  connection,
  namespace,
  taskQueue,
  workflowsPath: new URL("./workflows.js", import.meta.url).pathname,
  activities,
  maxConcurrentActivityTaskExecutions: 4,
  maxConcurrentWorkflowTaskExecutions: 8,
});

const abort = new AbortController();
const poller = runShadowPoller(abort.signal);
const shutdown = () => {
  abort.abort();
  worker.shutdown();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
await worker.run();
await poller;
await connection.close();
