import { MessageSource, ToolName } from "../../types";
import type {
  DomSnapshotResponse,
  ToolResultMessage,
} from "@shared-types/messages/content-protocol";
import type {
  RemoteBrowserAction,
  RemoteBrowserObservation,
} from "@shared-types/remote-browser-control";
import {
  remoteControlUrl,
  REMOTE_ARTIFACT_MAX_BYTES,
} from "@shared-types/remote-browser-control";
import type { BrowserPagePort, ContentBridgePort } from "../environment/types";
import type {
  DirectActionPermission,
  DirectControlExecution,
} from "./action-controller";

type Binding = { tab: string; tabId: number; taskCreated: boolean };
export interface DirectBrowserPorts {
  pages: BrowserPagePort;
  content: ContentBridgePort;
  selected(sessionId: string): Promise<Binding>;
  tabs(sessionId: string): Promise<Binding[]>;
  select(sessionId: string, tab: string): Promise<void>;
  register(sessionId: string, tabId: number): Promise<Binding>;
  remove(sessionId: string, tab: string): Promise<void>;
  isAuthorized(sessionId: string, url: string): Promise<boolean>;
  authorize(
    sessionId: string,
    action: RemoteBrowserAction,
    digest: string,
  ): Promise<DirectActionPermission>;
  attachment(
    sessionId: string,
    artifactId: string,
    destination: string,
  ): Promise<{
    data: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>;
}

type Captured = {
  revision: string;
  binding: Binding;
  response: DomSnapshotResponse;
  refs: Map<string, number>;
};
const sameDocument = (a: DomSnapshotResponse, b: DomSnapshotResponse) => {
  const x = a.payload.documentState,
    y = b.payload.documentState;
  return (
    x &&
    y &&
    x.documentInstanceId === y.documentInstanceId &&
    x.mutationEpoch === y.mutationEpoch &&
    x.url === y.url &&
    x.scroll.x === y.scroll.x &&
    x.scroll.y === y.scroll.y &&
    x.viewport.width === y.viewport.width &&
    x.viewport.height === y.viewport.height
  );
};

/** Uses the same content actions and document-epoch guards as local agent execution. */
export function createDirectBrowserExecution(
  ports: DirectBrowserPorts,
): DirectControlExecution {
  const captures = new Map<string, Captured>();
  const snapshot = (tabId: number) =>
    ports.content.sendMessage<DomSnapshotResponse>(tabId, {
      type: "DOM_SNAPSHOT_REQUEST",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: { refresh: true, autoDismiss: false },
    });
  const selected = async (id: string) => {
    const binding = await ports.selected(id);
    const tab = await ports.pages.getTab(binding.tabId);
    if (!tab.url || !(await ports.isAuthorized(id, remoteControlUrl(tab.url))))
      throw new Error("site_not_authorized");
    return { binding, tab };
  };
  const observe = async (id: string): Promise<RemoteBrowserObservation> => {
    const { binding, tab } = await selected(id);
    const response = await snapshot(binding.tabId);
    if (!response?.payload?.documentState)
      throw new Error("observation_unavailable");
    if (response.payload.snapshot.url !== tab.url)
      throw new Error("page_changed");
    const view = response.payload.snapshot;
    const revision = crypto.randomUUID();
    const refs = new Map<string, number>();
    // Password and hidden fields never become remote targets or evidence.
    const visible = view.elements.filter(
      (e) =>
        (e.isVisible || e.attributes.type === "file") &&
        e.attributes.type?.toLowerCase() !== "password" &&
        e.attributes.type?.toLowerCase() !== "hidden",
    );
    const elements = visible.slice(0, 200).map((e) => {
      const ref = crypto.randomUUID();
      refs.set(ref, e.tag);
      return {
        ref,
        role: e.role.slice(0, 100),
        name: (
          e.attributes["aria-label"] ||
          e.attributes.placeholder ||
          e.text ||
          ""
        ).slice(0, 500),
        disabled: e.isDisabled,
      };
    });
    const tabs: RemoteBrowserObservation["tabs"] = [];
    for (const candidate of await ports.tabs(id)) {
      const current = await ports.pages
        .getTab(candidate.tabId)
        .catch(() => null);
      if (!current?.url || !(await ports.isAuthorized(id, current.url)))
        continue;
      tabs.push({
        ref: candidate.tab,
        title: (current.title ?? "").slice(0, 500),
        origin: new URL(current.url).origin,
        taskCreated: candidate.taskCreated,
      });
    }
    captures.set(id, { revision, binding, response, refs });
    const text = view.visibleContent ?? "";
    return {
      revision,
      observedAt: new Date().toISOString(),
      tab: binding.tab,
      origin: new URL(tab.url!).origin,
      title: view.title.slice(0, 500),
      text: text.slice(0, 16000),
      truncated: text.length > 16000 || visible.length > 200,
      elements,
      tabs,
    };
  };
  return {
    observe,
    authorize: (id, action, digest) => ports.authorize(id, action, digest),
    async ground(id, revision, action) {
      try {
        const capture = captures.get(id);
        if (!capture || capture.revision !== revision) return false;
        const { binding } = await selected(id);
        if (
          binding.tabId !== capture.binding.tabId ||
          binding.tab !== capture.binding.tab
        )
          return false;
        if ("element" in action && !capture.refs.has(action.element))
          return false;
        if ("tab" in action) {
          const target = (await ports.tabs(id)).find(
            (t) => t.tab === action.tab,
          );
          if (!target || (action.kind === "close_tab" && !target.taskCreated))
            return false;
          const tab = await ports.pages.getTab(target.tabId);
          if (!tab.url || !(await ports.isAuthorized(id, tab.url)))
            return false;
        }
        if ("url" in action && !(await ports.isAuthorized(id, action.url)))
          return false;
        return Boolean(
          sameDocument(capture.response, await snapshot(binding.tabId)),
        );
      } catch {
        return false;
      }
    },
    async dispatch(id, action, signal) {
      const capture = captures.get(id);
      if (!capture) throw new Error("observation_required");
      const { binding, tab } = await selected(id);
      const check = () => {
        if (signal.aborted) throw new Error("stopped");
      };
      check();
      // Recheck at the browser boundary; do not trust earlier cloud validation.
      if (!(await this.ground(id, capture.revision, action)))
        throw new Error("stale_observation");
      check();
      if (action.kind === "navigate") {
        await ports.pages.updateTab(binding.tabId, { url: action.url });
      } else if (action.kind === "open_tab") {
        const created = await ports.pages.createTab({
          url: action.url,
          active: true,
        });
        if (created.id === undefined) throw new Error("tab_not_created");
        const registered = await ports.register(id, created.id);
        check();
        await ports.select(id, registered.tab);
      } else if (action.kind === "select_tab") {
        await ports.select(id, action.tab);
      } else if (action.kind === "close_tab") {
        const target = (await ports.tabs(id)).find((t) => t.tab === action.tab);
        if (!target?.taskCreated) throw new Error("user_tab_cannot_close");
        check();
        await ports.pages.removeTab(target.tabId);
        await ports.remove(id, target.tab);
      } else {
        const elementId =
          "element" in action ? capture.refs.get(action.element) : undefined;
        let toolName: ToolName;
        let args: Record<string, unknown>;
        switch (action.kind) {
          case "click":
            toolName = ToolName.CLICK_ELEMENT;
            args = { id: elementId };
            break;
          case "type":
            toolName = ToolName.TYPE_TEXT;
            args = { id: elementId, text: action.text, pressEnter: false };
            break;
          case "select":
            toolName = ToolName.SELECT_OPTION;
            args = { id: elementId, value: action.value };
            break;
          case "check":
            toolName = ToolName.SET_CHECKBOX;
            args = { id: elementId, checked: action.checked };
            break;
          case "key":
            toolName = ToolName.PRESS_KEY;
            args = { key: action.key };
            break;
          case "scroll":
            toolName = ToolName.SCROLL_PAGE;
            args = { direction: action.direction };
            break;
          case "attach": {
            const file = await ports.attachment(
              id,
              action.artifactId,
              new URL(tab.url!).origin,
            );
            if (
              !Number.isSafeInteger(file.sizeBytes) ||
              file.sizeBytes < 1 ||
              file.sizeBytes > REMOTE_ARTIFACT_MAX_BYTES ||
              file.data.length > Math.ceil(REMOTE_ARTIFACT_MAX_BYTES / 3) * 4 ||
              atob(file.data).length !== file.sizeBytes ||
              !file.filename ||
              /[/\\]/.test(file.filename) ||
              [...file.filename].some((c) => c.charCodeAt(0) < 32)
            )
              throw new Error("invalid_attachment");
            toolName = ToolName.UPLOAD_FILE;
            args = {
              id: elementId,
              data: file.data,
              filename: file.filename,
              mimeType: file.mimeType,
            };
            break;
          }
        }
        check();
        const result = await ports.content.sendMessage<ToolResultMessage>(
          binding.tabId,
          {
            type: "TOOL_EXECUTE",
            requestId: crypto.randomUUID(),
            source: MessageSource.BACKGROUND,
            payload: {
              toolName,
              args,
              toolCallId: crypto.randomUUID(),
              observationBasis: {
                ...capture.response.payload.documentState,
                observationRevision: 1,
                requireGeometryMatch: true,
              },
            },
          },
        );
        if (!result?.payload?.success)
          throw new Error(result?.payload?.errorCode ?? "action_not_verified");
      }
      captures.delete(id);
    },
  };
}
