import { ToolName, type DomSnapshot } from "../../types";
import { evaluateWorkflowTabRedirect } from "./workflow-tab-controller";
import { userExplicitlyRequestedTabManagement } from "./loop-helpers";
import { workspaceManager } from "../workspaces/manager";

export async function getWorkspaceTabIds(workspaceId: string | null): Promise<number[] | null> {
  if (!workspaceId || workspaceId === "default") return null;
  const ws = await workspaceManager.getWorkspaceById(workspaceId);
  return ws?.tabIds ?? null;
}

export function shouldBlockTabManagementTools(input: {
  originalQuery: string;
  selectedSkillId: string | null | undefined;
  planRequiresTabManagement: boolean;
}): boolean {
  if (userExplicitlyRequestedTabManagement(input.originalQuery)) return false;
  if (input.selectedSkillId === "multi-tab-checklist-workflow") return false;
  if (input.planRequiresTabManagement) return false;
  return true;
}

export interface WorkflowTabRoutingHost {
  getSnapshot(): DomSnapshot | null;
  getCurrentUrl(): string | undefined;
  getSelectedSkillId(): string | null;
  getTurnCount(): number;
  getWorkspaceTabs(): Promise<Array<{ id?: number | null; url?: string | null }>>;
  recordEvent(name: "workflow_tab_redirect", data: Record<string, unknown>): void;
}

export async function getWorkflowTabToolRedirect(
  host: WorkflowTabRoutingHost,
  params: { toolName: ToolName; args: Record<string, unknown>; currentTabId: number },
): Promise<string | null> {
  const { toolName, args, currentTabId } = params;
  const snapshot = host.getSnapshot();
  const targetId =
    typeof args.id === "number"
      ? args.id
      : typeof args.id === "string"
        ? parseInt(args.id, 10)
        : null;
  const target =
    (toolName === ToolName.CLICK_ELEMENT ||
      toolName === ToolName.RIGHT_CLICK) &&
    targetId
      ? snapshot?.elements?.find((element) => element.tag === targetId)
      : null;
  const targetHref =
    typeof target?.attributes?.href === "string"
      ? target.attributes.href
      : toolName === ToolName.CREATE_TAB && typeof args.url === "string"
        ? (args.url as string)
        : null;
  if (!targetHref) return null;

  let resolvedHref: string | null = null;
  try {
    resolvedHref = new URL(
      targetHref,
      host.getCurrentUrl() || "http://127.0.0.1/",
    ).toString();
  } catch {
    return null;
  }
  const tabs = await host.getWorkspaceTabs();
  const decision = evaluateWorkflowTabRedirect({
    skillId: host.getSelectedSkillId(),
    toolName,
    currentTabId,
    currentUrl: host.getCurrentUrl(),
    targetUrl: resolvedHref,
    workspaceTabs: tabs,
  });
  if (!decision) return null;
  host.recordEvent(decision.traceEvent, {
    turn: host.getTurnCount(),
    toolName,
    controllerId: decision.controllerId,
    currentTabId,
    currentUrl: host.getCurrentUrl(),
    targetUrl: resolvedHref,
    message: decision.message,
  });
  return decision.message;
}
