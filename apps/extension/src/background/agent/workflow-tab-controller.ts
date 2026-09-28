import { ToolName } from "../../types";

type WorkflowTabLike = {
  id?: number | null;
  url?: string | null;
};

export type WorkflowTabRedirectDecision = {
  controllerId:
    | "multi-tab-checklist-workflow"
    | "list-detail-review-loop"
    | "cross-tab-compare";
  traceEvent: "workflow_tab_redirect";
  message: string;
};

export type WorkflowTabControllerInput = {
  skillId: string | null | undefined;
  toolName: ToolName;
  currentTabId: number;
  currentUrl?: string | null;
  targetUrl?: string | null;
  workspaceTabs: WorkflowTabLike[];
};

export function shouldCheckWorkflowTabRedirect(toolName: ToolName): boolean {
  return (
    toolName === ToolName.CLICK_ELEMENT ||
    toolName === ToolName.CREATE_TAB ||
    toolName === ToolName.RIGHT_CLICK
  );
}

function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

function evaluateMultiTabChecklistRedirect(
  input: WorkflowTabControllerInput,
): WorkflowTabRedirectDecision | null {
  if (input.skillId !== "multi-tab-checklist-workflow") return null;
  if (
    input.toolName !== ToolName.CLICK_ELEMENT &&
    input.toolName !== ToolName.CREATE_TAB &&
    input.toolName !== ToolName.RIGHT_CLICK
  ) {
    return null;
  }

  const resolvedTargetUrl = normalizeUrl(input.targetUrl);
  if (!resolvedTargetUrl) return null;

  if (normalizeUrl(input.currentUrl) === resolvedTargetUrl &&
      input.toolName !== ToolName.CREATE_TAB) {
    return {
      controllerId: "multi-tab-checklist-workflow",
      traceEvent: "workflow_tab_redirect",
      message: "This checklist target page is already active. Complete the item here or switch back to the source tab instead of reopening it.",
    };
  }

  const existingTargetTab = input.workspaceTabs.find(
    (tab) =>
      typeof tab.id === "number" &&
      tab.id !== input.currentTabId &&
      normalizeUrl(tab.url) === resolvedTargetUrl,
  );
  if (!existingTargetTab?.id) return null;

  return {
    controllerId: "multi-tab-checklist-workflow",
    traceEvent: "workflow_tab_redirect",
    message:
      `This checklist target page is already open as tab ${existingTargetTab.id}. ` +
      `Use switch_tab({"tabId": ${existingTargetTab.id}}) to reuse it instead of opening a duplicate tab.`,
  };
}

function evaluateListDetailLoopRedirect(
  input: WorkflowTabControllerInput,
): WorkflowTabRedirectDecision | null {
  if (input.skillId !== "list-detail-review-loop") return null;
  if (input.toolName !== ToolName.CREATE_TAB) return null;
  if (!normalizeUrl(input.targetUrl)) return null;

  return {
    controllerId: "list-detail-review-loop",
    traceEvent: "workflow_tab_redirect",
    message:
      "This list/detail workflow should stay in one tab. " +
      "Use click_element to open the detail page in the current tab, read it once, then use the page's own return control to restore the list instead of creating a new tab.",
  };
}

function evaluateCrossTabCompareRedirect(
  input: WorkflowTabControllerInput,
): WorkflowTabRedirectDecision | null {
  if (input.skillId !== "cross-tab-compare") return null;
  if (
    input.toolName !== ToolName.CLICK_ELEMENT &&
    input.toolName !== ToolName.CREATE_TAB
  ) {
    return null;
  }

  const resolvedTargetUrl = normalizeUrl(input.targetUrl);
  const resolvedCurrentUrl = normalizeUrl(input.currentUrl);
  if (!resolvedTargetUrl) return null;

  if (
    input.toolName === ToolName.CLICK_ELEMENT &&
    resolvedCurrentUrl &&
    resolvedTargetUrl === resolvedCurrentUrl
  ) {
    return {
      controllerId: "cross-tab-compare",
      traceEvent: "workflow_tab_redirect",
      message:
        "You are already on this comparison tab. " +
        "Read the needed evidence here or switch to the other open comparison tab instead of reopening the same page.",
    };
  }

  const existingMatch = input.workspaceTabs.find(
    (tab) =>
      typeof tab.id === "number" &&
      tab.id !== input.currentTabId &&
      normalizeUrl(tab.url) === resolvedTargetUrl,
  );
  if (!existingMatch?.id) return null;

  return {
    controllerId: "cross-tab-compare",
    traceEvent: "workflow_tab_redirect",
    message:
      `This comparison page is already open as tab ${existingMatch.id}. ` +
      `Use switch_tab({"tabId": ${existingMatch.id}}) to reuse the existing tab instead of opening a duplicate.`,
  };
}

export function evaluateWorkflowTabRedirect(
  input: WorkflowTabControllerInput,
): WorkflowTabRedirectDecision | null {
  return (
    evaluateMultiTabChecklistRedirect(input) ??
    evaluateListDetailLoopRedirect(input) ??
    evaluateCrossTabCompareRedirect(input)
  );
}
