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

function getProcurementTabRole(
  url: string | null | undefined,
): "checklist" | "store" | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.pathname !== "/procurement") return null;
    return parsed.searchParams.has("store") ? "store" : "checklist";
  } catch {
    return null;
  }
}

function getProcurementStoreKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.pathname !== "/procurement") return null;
    const store = parsed.searchParams.get("store");
    return store ? store.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

function evaluateProcurementCompatibilityRedirect(
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

  // Legacy procurement protection is intentionally limited to the /procurement
  // fixture route. Generic checklist pages fall through to URL-based tab reuse.
  const targetRole = getProcurementTabRole(resolvedTargetUrl);
  if (!targetRole) return null;

  const currentRole = getProcurementTabRole(input.currentUrl);
  const currentStoreKey = getProcurementStoreKey(input.currentUrl);
  const checklistTabId =
    input.workspaceTabs.find(
      (tab) =>
        typeof tab.id === "number" &&
        tab.id !== input.currentTabId &&
        getProcurementTabRole(tab.url) === "checklist",
    )?.id ?? null;

  if (
    targetRole === "checklist" &&
    currentRole === "store" &&
    checklistTabId &&
    checklistTabId !== input.currentTabId
  ) {
    return {
      controllerId: "multi-tab-checklist-workflow",
      traceEvent: "workflow_tab_redirect",
      message:
        `The original procurement checklist is already open as tab ${checklistTabId}. ` +
        `Use switch_tab({"tabId": ${checklistTabId}}) to return there instead of interacting with an in-page Procurement link.`,
    };
  }

  const targetStoreKey = getProcurementStoreKey(resolvedTargetUrl);
  if (!targetStoreKey) return null;
  const existingStoreTab = input.workspaceTabs.find(
    (tab) =>
      typeof tab.id === "number" &&
      tab.id !== input.currentTabId &&
      getProcurementStoreKey(tab.url) === targetStoreKey,
  );
  if (existingStoreTab?.id) {
    return {
      controllerId: "multi-tab-checklist-workflow",
      traceEvent: "workflow_tab_redirect",
      message:
        `The ${targetStoreKey} store is already open as tab ${existingStoreTab.id}. ` +
        `Use switch_tab({"tabId": ${existingStoreTab.id}}) instead of reopening or context-clicking the same store page.`,
    };
  }

  if (
    currentRole === "store" &&
    currentStoreKey &&
    targetStoreKey === currentStoreKey &&
    (input.toolName === ToolName.CLICK_ELEMENT ||
      input.toolName === ToolName.RIGHT_CLICK)
  ) {
    return {
      controllerId: "multi-tab-checklist-workflow",
      traceEvent: "workflow_tab_redirect",
      message:
        `You are already on the ${currentStoreKey} store page. ` +
        `Do not reopen the same store from inside this procurement loop; either finish the purchase or switch back to the checklist tab.`,
    };
  }

  return null;
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
    evaluateProcurementCompatibilityRedirect(input) ??
    evaluateMultiTabChecklistRedirect(input) ??
    evaluateListDetailLoopRedirect(input) ??
    evaluateCrossTabCompareRedirect(input)
  );
}
