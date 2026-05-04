import { describe, expect, test } from "vitest";
import { ToolName } from "../../src/types";
import {
  evaluateWorkflowTabRedirect,
  shouldCheckWorkflowTabRedirect,
} from "../../src/background/agent/workflow-tab-controller";

describe("workflow tab controller", () => {
  test("identifies tools eligible for workflow tab redirect checks", () => {
    expect(shouldCheckWorkflowTabRedirect(ToolName.CLICK_ELEMENT)).toBe(true);
    expect(shouldCheckWorkflowTabRedirect(ToolName.CREATE_TAB)).toBe(true);
    expect(shouldCheckWorkflowTabRedirect(ToolName.RIGHT_CLICK)).toBe(true);
    expect(shouldCheckWorkflowTabRedirect(ToolName.READ_PAGE)).toBe(false);
  });

  test("procurement loop redirects back to an existing checklist tab", () => {
    const decision = evaluateWorkflowTabRedirect({
      skillId: "multi-tab-checklist-workflow",
      toolName: ToolName.CLICK_ELEMENT,
      currentTabId: 22,
      currentUrl: "https://fixture.test/procurement?store=pegasus",
      targetUrl: "https://fixture.test/procurement",
      workspaceTabs: [
        { id: 11, url: "https://fixture.test/procurement" },
        { id: 22, url: "https://fixture.test/procurement?store=pegasus" },
      ],
    });

    expect(decision).toEqual({
      controllerId: "multi-tab-checklist-workflow",
      traceEvent: "workflow_tab_redirect",
      message:
        'The original procurement checklist is already open as tab 11. Use switch_tab({"tabId": 11}) to return there instead of interacting with an in-page Procurement link.',
    });
  });

  test("procurement loop redirects to an existing matching store tab", () => {
    const decision = evaluateWorkflowTabRedirect({
      skillId: "multi-tab-checklist-workflow",
      toolName: ToolName.CREATE_TAB,
      currentTabId: 11,
      currentUrl: "https://fixture.test/procurement",
      targetUrl: "https://fixture.test/procurement?store=nimbus",
      workspaceTabs: [
        { id: 11, url: "https://fixture.test/procurement" },
        { id: 33, url: "https://fixture.test/procurement?store=nimbus" },
      ],
    });

    expect(decision).toEqual({
      controllerId: "multi-tab-checklist-workflow",
      traceEvent: "workflow_tab_redirect",
      message:
        'The nimbus store is already open as tab 33. Use switch_tab({"tabId": 33}) instead of reopening or context-clicking the same store page.',
    });
  });

  test("procurement loop blocks right-click escape on an already open store link", () => {
    const decision = evaluateWorkflowTabRedirect({
      skillId: "multi-tab-checklist-workflow",
      toolName: ToolName.RIGHT_CLICK,
      currentTabId: 11,
      currentUrl: "https://fixture.test/procurement",
      targetUrl: "https://fixture.test/procurement?store=nimbus",
      workspaceTabs: [
        { id: 11, url: "https://fixture.test/procurement" },
        { id: 33, url: "https://fixture.test/procurement?store=nimbus" },
      ],
    });

    expect(decision).toEqual({
      controllerId: "multi-tab-checklist-workflow",
      traceEvent: "workflow_tab_redirect",
      message:
        'The nimbus store is already open as tab 33. Use switch_tab({"tabId": 33}) instead of reopening or context-clicking the same store page.',
    });
  });

  test("multi-tab checklist workflow reuses an already open generic target tab", () => {
    const decision = evaluateWorkflowTabRedirect({
      skillId: "multi-tab-checklist-workflow",
      toolName: ToolName.CREATE_TAB,
      currentTabId: 11,
      currentUrl: "https://fixture.test/jobs",
      targetUrl: "https://fixture.test/jobs/senior-frontend",
      workspaceTabs: [
        { id: 11, url: "https://fixture.test/jobs" },
        { id: 44, url: "https://fixture.test/jobs/senior-frontend" },
      ],
    });

    expect(decision).toEqual({
      controllerId: "multi-tab-checklist-workflow",
      traceEvent: "workflow_tab_redirect",
      message:
        'This checklist target page is already open as tab 44. Use switch_tab({"tabId": 44}) to reuse it instead of opening a duplicate tab.',
    });
  });

  test("multi-tab checklist workflow does not treat non-procurement store params as procurement tabs", () => {
    const decision = evaluateWorkflowTabRedirect({
      skillId: "multi-tab-checklist-workflow",
      toolName: ToolName.CLICK_ELEMENT,
      currentTabId: 22,
      currentUrl: "https://fixture.test/vendors?store=pegasus",
      targetUrl: "https://fixture.test/vendors",
      workspaceTabs: [
        { id: 11, url: "https://fixture.test/vendors" },
        { id: 22, url: "https://fixture.test/vendors?store=pegasus" },
      ],
    });

    expect(decision).toEqual({
      controllerId: "multi-tab-checklist-workflow",
      traceEvent: "workflow_tab_redirect",
      message:
        'This checklist target page is already open as tab 11. Use switch_tab({"tabId": 11}) to reuse it instead of opening a duplicate tab.',
    });
  });

  test("list-detail loop blocks create_tab and keeps the workflow in one tab", () => {
    const decision = evaluateWorkflowTabRedirect({
      skillId: "list-detail-review-loop",
      toolName: ToolName.CREATE_TAB,
      currentTabId: 11,
      currentUrl: "https://fixture.test/jobs",
      targetUrl: "https://fixture.test/jobs/42",
      workspaceTabs: [{ id: 11, url: "https://fixture.test/jobs" }],
    });

    expect(decision).toEqual({
      controllerId: "list-detail-review-loop",
      traceEvent: "workflow_tab_redirect",
      message:
        "This list/detail workflow should stay in one tab. Use click_element to open the detail page in the current tab, read it once, then use the page's own return control to restore the list instead of creating a new tab.",
    });
  });

  test("inactive skills do not trigger workflow redirects", () => {
    const decision = evaluateWorkflowTabRedirect({
      skillId: "unknown-skill",
      toolName: ToolName.CREATE_TAB,
      currentTabId: 11,
      currentUrl: "https://fixture.test/jobs",
      targetUrl: "https://fixture.test/jobs/42",
      workspaceTabs: [{ id: 11, url: "https://fixture.test/jobs" }],
    });

    expect(decision).toBeNull();
  });

  test("cross-tab compare reuses an already open matching tab", () => {
    const decision = evaluateWorkflowTabRedirect({
      skillId: "cross-tab-compare",
      toolName: ToolName.CREATE_TAB,
      currentTabId: 11,
      currentUrl: "https://fixture.test/overview",
      targetUrl: "https://fixture.test/reports/q1",
      workspaceTabs: [
        { id: 11, url: "https://fixture.test/overview" },
        { id: 55, url: "https://fixture.test/reports/q1" },
      ],
    });

    expect(decision).toEqual({
      controllerId: "cross-tab-compare",
      traceEvent: "workflow_tab_redirect",
      message:
        'This comparison page is already open as tab 55. Use switch_tab({"tabId": 55}) to reuse the existing tab instead of opening a duplicate.',
    });
  });

  test("cross-tab compare blocks reopening the current comparison tab", () => {
    const decision = evaluateWorkflowTabRedirect({
      skillId: "cross-tab-compare",
      toolName: ToolName.CLICK_ELEMENT,
      currentTabId: 11,
      currentUrl: "https://fixture.test/reports/q1",
      targetUrl: "https://fixture.test/reports/q1",
      workspaceTabs: [{ id: 11, url: "https://fixture.test/reports/q1" }],
    });

    expect(decision).toEqual({
      controllerId: "cross-tab-compare",
      traceEvent: "workflow_tab_redirect",
      message:
        "You are already on this comparison tab. Read the needed evidence here or switch to the other open comparison tab instead of reopening the same page.",
    });
  });
});
