import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  buildHostedBrowserMcpServer,
  dispatchHostedBrowserTool,
  HOSTED_BROWSER_MCP_INSTRUCTIONS,
  type HostedBrowserMcpOperations,
} from "../src/hosted-browser-mcp.js";

const operations = {
  async listDevices() { return { devices: [{ name: "Work laptop", availability: "available" }] }; },
  async startTask(_principal, input) { return { missionId: "mission-1", objective: input.objective }; },
  async getTask() { return { state: "running" }; },
  async continueTask() { return { state: "queued" }; },
  async respondApproval() { return { state: "running" }; },
  async cancelTask() { return { state: "cancelled" }; },
} satisfies HostedBrowserMcpOperations;

const principal = (scopes: string[]) => ({
  accountId: "account-1",
  clientId: "codex",
  scopes: new Set(scopes),
});

test("device discovery is scope-bound and names the live browser", async () => {
  const result = await dispatchHostedBrowserTool(
    operations,
    principal(["browser.devices.read"]),
    "browser_list_devices",
    {},
  );
  assert.deepEqual(result, {
    devices: [{ name: "Work laptop", availability: "available" }],
  });
  assert.match(HOSTED_BROWSER_MCP_INSTRUCTIONS, /offer to run the work there/i);
  await assert.rejects(
    () => dispatchHostedBrowserTool(operations, principal([]), "browser_list_devices", {}),
    /insufficient_scope/,
  );
});

test("task creation requires both scope and bounded semantic inputs", async () => {
  await assert.rejects(
    () => dispatchHostedBrowserTool(
      operations,
      principal(["browser.tasks.create"]),
      "browser_start_task",
      { requestId: "request-1", objective: "Read the heading" },
    ),
    /missing_successCriteria/,
  );
  const result = await dispatchHostedBrowserTool(
    operations,
    principal(["browser.tasks.create"]),
    "browser_start_task",
    { requestId: "request-1", objective: "Read the heading", successCriteria: ["Heading reported"] },
  );
  assert.deepEqual(result, { missionId: "mission-1", objective: "Read the heading" });
});

test("target selection continuation requires the opaque handle", async () => {
  await assert.rejects(
    () => dispatchHostedBrowserTool(
      operations,
      principal(["browser.tasks.continue"]),
      "browser_continue_task",
      {
        missionId: "mission-1",
        stepId: "step-1",
        expectedPlanRevision: 1,
        decision: "select_target",
      },
    ),
    /missing_targetHandle/,
  );
});

test("a Codex-like MCP client discovers only granted tools and server guidance", async () => {
  const granted = [
    "browser.devices.read",
    "browser.tasks.create",
    "browser.tasks.read",
    "browser.tasks.continue",
    "browser.tasks.approve",
    "browser.tasks.cancel",
  ];
  const server = buildHostedBrowserMcpServer(operations, principal(granted));
  const client = new Client({ name: "codex-like-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    [
      "browser_list_devices",
      "browser_start_task",
      "browser_get_task",
      "browser_continue_task",
      "browser_respond_approval",
      "browser_cancel_task",
    ],
  );
  assert.match(client.getInstructions() ?? "", /explicitly authorizes browser execution/i);
  await client.close();
  await server.close();
});
