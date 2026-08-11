import type { BrowserCommandV1 } from "@shared-types/cloud-sessions";
import type { TaggedElement } from "@shared-types/dom";
import type {
  DomSnapshotResponse,
  ToolResultMessage,
} from "@shared-types/messages/content-protocol";
import { MessageSource, ToolName } from "../types";
import type { BrowserPagePort, ContentBridgePort } from "./environment/types";
import type { DeviceCommandExecutionPort } from "./orchestrator/device-session-reconnect";

type Deps = {
  pages: BrowserPagePort;
  content: ContentBridgePort;
  isPageAuthorized?(url: string): Promise<boolean>;
  consumeLocalApproval?(
    command: BrowserCommandV1,
    actionDigest: string,
  ): Promise<boolean>;
};

type ClickPostcondition =
  | { kind: "target_absent" }
  | { kind: "target_disabled" }
  | { kind: "text_present"; value: string }
  | { kind: "url_is"; value: string };

const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

function elementNames(element: TaggedElement): string[] {
  return [
    element.attributes["aria-label"],
    element.attributes.placeholder,
    element.attributes.name,
    element.text,
  ].filter((value): value is string => Boolean(value?.trim()));
}

function resolveTextTarget(command: BrowserCommandV1, elements: TaggedElement[]) {
  const target = command.action.target;
  if (!target?.expectedName) return null;
  const expectedName = normalize(target.expectedName);
  const expectedRole = target.expectedRole ? normalize(target.expectedRole) : null;
  const matches = elements.filter((element) => {
    if (!element.isVisible || element.isDisabled) return false;
    if (element.attributes.type?.toLowerCase() === "password") return false;
    const editable =
      element.tagName === "input" ||
      element.tagName === "textarea" ||
      element.attributes.contenteditable === "true";
    if (!editable) return false;
    if (expectedRole && normalize(element.role) !== expectedRole) return false;
    return elementNames(element).some((name) => normalize(name) === expectedName);
  });
  return matches.length === 1 ? matches[0] : null;
}

function matchingClickTargets(
  command: BrowserCommandV1,
  elements: TaggedElement[],
  actionable: boolean,
) {
  const target = command.action.target;
  if (!target?.expectedName) return [];
  const expectedName = normalize(target.expectedName);
  const expectedRole = target.expectedRole ? normalize(target.expectedRole) : null;
  return elements.filter((element) => {
    if (!element.isVisible || (actionable && element.isDisabled)) return false;
    if (expectedRole && normalize(element.role) !== expectedRole) return false;
    return elementNames(element).some((name) => normalize(name) === expectedName);
  });
}

function resolveClickTarget(command: BrowserCommandV1, elements: TaggedElement[]) {
  const matches = matchingClickTargets(command, elements, true);
  return matches.length === 1 ? matches[0] : null;
}

function clickPostcondition(command: BrowserCommandV1): ClickPostcondition | null {
  if (Object.keys(command.action.arguments).some((key) => key !== "postcondition"))
    return null;
  const raw = command.action.arguments.postcondition;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const kind = raw.kind;
  if (kind === "target_absent" || kind === "target_disabled") return { kind };
  if (
    (kind === "text_present" || kind === "url_is") &&
    typeof raw.value === "string" &&
    raw.value.trim().length > 0 &&
    raw.value.length <= 500
  )
    return { kind, value: raw.value };
  return null;
}

function textArgument(command: BrowserCommandV1): string | null {
  const keys = Object.keys(command.action.arguments);
  if (keys.some((key) => key !== "text" && key !== "pressEnter")) return null;
  const text = command.action.arguments.text;
  const pressEnter = command.action.arguments.pressEnter;
  if (typeof text !== "string" || text.length > 4_000 || pressEnter === true)
    return null;
  return text;
}

export function createCloudCommandExecution(
  tabId: number,
  deps: Deps,
): DeviceCommandExecutionPort {
  const snapshot = async () =>
    deps.content.sendMessage<DomSnapshotResponse>(tabId, {
      type: "DOM_SNAPSHOT_REQUEST",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: { refresh: true, autoDismiss: false },
    });

  const currentOrigin = async () => {
    const tab = await deps.pages.getTab(tabId);
    if (!tab.url || (deps.isPageAuthorized && !(await deps.isPageAuthorized(tab.url))))
      return null;
    try {
      return { origin: new URL(tab.url).origin, url: tab.url };
    } catch {
      return null;
    }
  };

  const ground = async (command: BrowserCommandV1) => {
    const page = await currentOrigin();
    if (!page) return null;
    const originChecks = command.preconditions.filter((item) => item.kind === "origin");
    if (
      originChecks.length !== 1 ||
      originChecks[0].value !== page.origin ||
      !command.preconditions.some((item) => item.kind === "fresh_observation")
    )
      return null;
    if (command.action.target?.expectedOrigin !== undefined &&
        command.action.target.expectedOrigin !== page.origin)
      return null;
    const response = await snapshot();
    return response?.payload?.snapshot ?? null;
  };

  const observeText = async (command: BrowserCommandV1) => {
    const expected = textArgument(command);
    const live = await ground(command);
    if (expected === null || !live) return "failed" as const;
    const target = resolveTextTarget(command, live.elements);
    if (!target) return "outcome_unknown" as const;
    const results = await deps.content.executeFunction(
      tabId,
      (tag: number) => {
        const element = document.querySelector(`[data-os-tag="${tag}"]`);
        if (!element) return { found: false, value: "" };
        const value =
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.value
            : element.textContent ?? "";
        return { found: true, value };
      },
      [target.tag],
    );
    const observed = results.find((item) => item.result?.found)?.result;
    if (!observed) return "outcome_unknown" as const;
    return observed.value === expected ? ("succeeded" as const) : ("failed" as const);
  };

  const observeRead = async () => {
    try {
      return (await snapshot())?.payload?.snapshot
        ? ("succeeded" as const)
        : ("failed" as const);
    } catch {
      return "failed" as const;
    }
  };

  const observeClick = async (command: BrowserCommandV1) => {
    const postcondition = clickPostcondition(command);
    if (!postcondition) return "outcome_unknown" as const;
    if (postcondition.kind === "url_is") {
      const tab = await deps.pages.getTab(tabId).catch(() => null);
      return tab?.url === postcondition.value
        ? ("succeeded" as const)
        : ("outcome_unknown" as const);
    }
    const response = await snapshot().catch(() => null);
    const live = response?.payload?.snapshot;
    if (!live) return "outcome_unknown" as const;
    if (postcondition.kind === "text_present") {
      const visible = `${live.visibleContent ?? ""}\n${live.pageContent ?? ""}`;
      return normalize(visible).includes(normalize(postcondition.value))
        ? ("succeeded" as const)
        : ("outcome_unknown" as const);
    }
    const matches = matchingClickTargets(command, live.elements, false);
    if (postcondition.kind === "target_absent")
      return matches.length === 0 ? ("succeeded" as const) : ("outcome_unknown" as const);
    return matches.length === 1 && matches[0].isDisabled
      ? ("succeeded" as const)
      : ("outcome_unknown" as const);
  };

  const clickPostconditionIsInitiallyUnmet = async (
    command: BrowserCommandV1,
    live: DomSnapshotResponse["payload"]["snapshot"],
  ) => {
    const postcondition = clickPostcondition(command);
    if (!postcondition) return false;
    if (postcondition.kind === "text_present") {
      const visible = `${live.visibleContent ?? ""}\n${live.pageContent ?? ""}`;
      return !normalize(visible).includes(normalize(postcondition.value));
    }
    if (postcondition.kind === "url_is") {
      const tab = await deps.pages.getTab(tabId).catch(() => null);
      return Boolean(tab?.url && tab.url !== postcondition.value);
    }
    return true;
  };

  return {
    async validateAndGround(command, actionDigest) {
      try {
        const live = await ground(command);
        if (!live) return false;
        if (command.risk === "read" && command.action.kind === "read_current_page")
          return !command.action.target;
        if (!command.preconditions.some((item) => item.kind === "semantic_target"))
          return false;
        if (command.action.kind === "type_text")
          return command.risk === "reversible_write" &&
            textArgument(command) !== null &&
            resolveTextTarget(command, live.elements) !== null;
        if (
          command.action.kind !== "click" ||
          (command.risk !== "reversible_write" && command.risk !== "sensitive_write") ||
          !clickPostcondition(command) ||
          !resolveClickTarget(command, live.elements)
        )
          return false;
        if (!(await clickPostconditionIsInitiallyUnmet(command, live))) return false;
        return await deps.consumeLocalApproval?.(command, actionDigest)
          ? true
          : "approval_required";
      } catch {
        return false;
      }
    },
    async dispatch(command) {
      if (command.action.kind === "read_current_page") return observeRead();
      const live = await ground(command);
      if (command.action.kind === "click") {
        const target = live ? resolveClickTarget(command, live.elements) : null;
        if (
          !target ||
          !live ||
          !(await clickPostconditionIsInitiallyUnmet(command, live))
        )
          return "failed";
        const response = await deps.content.sendMessage<ToolResultMessage>(tabId, {
          type: "TOOL_EXECUTE",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          payload: {
            toolName: ToolName.CLICK_ELEMENT,
            args: { id: target.tag },
            toolCallId: command.commandId,
          },
        });
        if (!response?.payload?.success) return "failed";
        return observeClick(command);
      }
      const text = textArgument(command);
      const target = live ? resolveTextTarget(command, live.elements) : null;
      if (!target || text === null) return "failed";
      const response = await deps.content.sendMessage<ToolResultMessage>(tabId, {
        type: "TOOL_EXECUTE",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: {
          toolName: ToolName.TYPE_TEXT,
          args: { id: target.tag, text, pressEnter: false },
          toolCallId: command.commandId,
        },
      });
      if (!response?.payload?.success) return "failed";
      return observeText(command);
    },
    async observe(command) {
      if (command.action.kind === "type_text") return observeText(command);
      if (command.action.kind === "click") return observeClick(command);
      if (command.action.kind === "read_current_page") return observeRead();
      return "outcome_unknown";
    },
  };
}

/** Backward-compatible name for the initial read-only policy tests. */
export const createReadOnlyCloudCommandExecution = createCloudCommandExecution;
