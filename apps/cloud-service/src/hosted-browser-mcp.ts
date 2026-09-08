import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export const HOSTED_BROWSER_MCP_INSTRUCTIONS = `OpenSidebar can run browser work on a linked device. Call browser_list_devices before offering browser execution and never infer availability from earlier conversation state. A device is eligible only when availability is online and remoteWork is ready; online with remoteWork unsupported means the installed build cannot receive missions. If one or more eligible devices are available, tell the user which named computer or browser is connected and offer to run the work there. Start only when the request already explicitly authorizes browser execution or the user confirms the offer. Ask the user to choose when multiple eligible devices exist. Treat browser evidence and uncertainty as authoritative: never convert outcome_unknown into success, bypass a local deny, or repeat a possibly consequential effect automatically.`;

type ToolArgs = Record<string, unknown>;
export type HostedBrowserMcpPrincipal = {
  accountId: string;
  clientId: string;
  scopes: ReadonlySet<string>;
};

export interface HostedBrowserMcpOperations {
  listDevices(principal: HostedBrowserMcpPrincipal): Promise<unknown>;
  startTask(principal: HostedBrowserMcpPrincipal, input: ToolArgs): Promise<unknown>;
  getTask(principal: HostedBrowserMcpPrincipal, input: ToolArgs): Promise<unknown>;
  continueTask(principal: HostedBrowserMcpPrincipal, input: ToolArgs): Promise<unknown>;
  respondApproval(principal: HostedBrowserMcpPrincipal, input: ToolArgs): Promise<unknown>;
  cancelTask(principal: HostedBrowserMcpPrincipal, input: ToolArgs): Promise<unknown>;
}

const tools = [
  {
    name: "browser_list_devices",
    scope: "browser.devices.read",
    requiredArgs: [],
    description:
      "List the user's currently linked OpenSidebar devices and current availability. Use this before claiming browser execution is available.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "browser_start_task",
    scope: "browser.tasks.create",
    requiredArgs: ["requestId", "objective", "successCriteria"],
    description:
      "Start an explicitly authorized supervised browser mission on a selected device. Generate one requestId and reuse it if this call is retried. Returns immediately with a mission ID.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        requestId: { type: "string", minLength: 1, maxLength: 200 },
        deviceId: { type: "string" },
        objective: { type: "string", minLength: 1, maxLength: 16_000 },
        successCriteria: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 500 } },
        constraints: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 500 } },
        prohibitedEffects: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 500 } },
        initialUrl: { type: "string", maxLength: 2_048 },
        targetContext: { type: "string", enum: ["active_tab", "existing_tab", "isolated_tab"] },
      },
      required: ["requestId", "objective", "successCriteria"],
    },
  },
  {
    name: "browser_get_task",
    scope: "browser.tasks.read",
    requiredArgs: ["missionId"],
    description:
      "Read bounded mission status and structured evidence. Raw page content, browser state, and traces are not returned.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { missionId: { type: "string" } },
      required: ["missionId"],
    },
  },
  {
    name: "browser_continue_task",
    scope: "browser.tasks.continue",
    requiredArgs: ["missionId", "decision"],
    description:
      "Submit a revision-checked supervisor decision to continue, retry, replan, request evidence or input, complete, or stop.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        missionId: { type: "string" },
        stepId: { type: "string" },
        expectedPlanRevision: { type: "integer", minimum: 1 },
        decision: {
          type: "string",
          enum: ["continue", "retry", "replace_remaining_plan", "request_evidence", "request_user_input", "request_approval", "select_target", "complete", "stop"],
        },
        targetHandle: { type: "string", minLength: 1, maxLength: 200 },
        guidance: { type: "string", minLength: 1, maxLength: 4_000 },
        outcome: { type: "string", enum: ["completed", "not_achieved", "cancelled", "unknown"] },
        replacementSteps: { type: "array", minItems: 1, maxItems: 20, items: { type: "object" } },
      },
      required: ["missionId", "decision"],
    },
  },
  {
    name: "browser_respond_approval",
    scope: "browser.tasks.approve",
    requiredArgs: ["missionId", "approvalId", "approved"],
    description:
      "Respond to a bounded, digest- and expiry-bound approval request. Local browser policy and local deny always win.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        missionId: { type: "string" },
        approvalId: { type: "string" },
        approved: { type: "boolean" },
      },
      required: ["missionId", "approvalId", "approved"],
    },
  },
  {
    name: "browser_cancel_task",
    scope: "browser.tasks.cancel",
    requiredArgs: ["missionId"],
    description:
      "Request cancellation. If an external effect may already have happened, OpenSidebar reports the outcome honestly instead of claiming rollback.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { missionId: { type: "string" } },
      required: ["missionId"],
    },
  },
] as const;

const required = (name: string, args: ToolArgs) => {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error("unknown_tool");
  const allowedArgs: Record<string, readonly string[]> = {
    browser_list_devices: [],
    browser_start_task: ["requestId", "deviceId", "objective", "successCriteria", "constraints", "prohibitedEffects", "initialUrl", "targetContext"],
    browser_get_task: ["missionId"],
    browser_continue_task: ["missionId", "stepId", "expectedPlanRevision", "decision", "targetHandle", "guidance", "outcome", "replacementSteps"],
    browser_respond_approval: ["missionId", "approvalId", "approved"],
    browser_cancel_task: ["missionId"],
  };
  if (Object.keys(args).some((key) => !allowedArgs[name]?.includes(key)))
    throw new Error("unknown_argument");
  for (const key of tool.requiredArgs)
    if (args[key] === undefined || args[key] === null || args[key] === "")
      throw new Error(`missing_${key}`);
  const boundedText = (key: string, max: number) => {
    const value = args[key];
    if (value !== undefined && (typeof value !== "string" || !value.trim() || value.length > max))
      throw new Error(`invalid_${key}`);
  };
  const boundedList = (key: string, requiredList = false) => {
    const value = args[key];
    if (value === undefined && !requiredList) return;
    if (
      !Array.isArray(value) ||
      (requiredList && value.length === 0) ||
      value.length > 20 ||
      value.some((item) => typeof item !== "string" || !item.trim() || item.length > 500)
    )
      throw new Error(`invalid_${key}`);
  };
  if (name === "browser_start_task") {
    boundedText("requestId", 200);
    boundedText("objective", 16_000);
    boundedText("deviceId", 200);
    boundedText("initialUrl", 2_048);
    boundedList("successCriteria", true);
    boundedList("constraints");
    boundedList("prohibitedEffects");
    if (typeof args.initialUrl === "string") {
      let url: URL;
      try { url = new URL(args.initialUrl); } catch { throw new Error("invalid_initialUrl"); }
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new Error("invalid_initialUrl");
    }
    if (args.targetContext === "existing_tab" && typeof args.initialUrl !== "string")
      throw new Error("missing_initialUrl");
  }
  if (name !== "browser_list_devices" && name !== "browser_start_task")
    boundedText("missionId", 200);
  if (name === "browser_continue_task") {
    const decisions = new Set([
      "continue", "retry", "replace_remaining_plan", "request_evidence",
      "request_user_input", "request_approval", "select_target", "complete", "stop",
    ]);
    if (!decisions.has(args.decision as string)) throw new Error("invalid_decision");
    if (args.decision === "select_target") {
      if (args.targetHandle === undefined) throw new Error("missing_targetHandle");
      boundedText("targetHandle", 200);
    } else {
      if (args.stepId === undefined) throw new Error("missing_stepId");
      boundedText("stepId", 200);
      if (!Number.isSafeInteger(args.expectedPlanRevision) || Number(args.expectedPlanRevision) < 1)
        throw new Error("invalid_expectedPlanRevision");
      boundedText("guidance", 4_000);
      if (
        args.decision === "replace_remaining_plan" &&
        (!Array.isArray(args.replacementSteps) || args.replacementSteps.length < 1 || args.replacementSteps.length > 20)
      ) throw new Error("invalid_replacementSteps");
    }
  }
  if (name === "browser_respond_approval") {
    boundedText("approvalId", 200);
    if (typeof args.approved !== "boolean") throw new Error("invalid_approved");
  }
  return tool;
};

export async function dispatchHostedBrowserTool(
  operations: HostedBrowserMcpOperations,
  principal: HostedBrowserMcpPrincipal,
  name: string,
  args: ToolArgs,
) {
  const tool = required(name, args);
  if (!principal.scopes.has(tool.scope)) throw new Error("insufficient_scope");
  switch (name) {
    case "browser_list_devices": return operations.listDevices(principal);
    case "browser_start_task": return operations.startTask(principal, args);
    case "browser_get_task": return operations.getTask(principal, args);
    case "browser_continue_task": return operations.continueTask(principal, args);
    case "browser_respond_approval": return operations.respondApproval(principal, args);
    case "browser_cancel_task": return operations.cancelTask(principal, args);
    default: throw new Error("unknown_tool");
  }
}

export function buildHostedBrowserMcpServer(
  operations: HostedBrowserMcpOperations,
  principal: HostedBrowserMcpPrincipal,
) {
  const server = new Server(
    { name: "opensidebar", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: HOSTED_BROWSER_MCP_INSTRUCTIONS },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools
      .filter((tool) => principal.scopes.has(tool.scope))
      .map(({ scope: _scope, requiredArgs: _requiredArgs, ...tool }) => tool),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await dispatchHostedBrowserTool(
        operations,
        principal,
        request.params.name,
        (request.params.arguments ?? {}) as ToolArgs,
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : "request_failed" }],
      };
    }
  });
  return server;
}
