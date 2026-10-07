/** Hosted direct control. Browser-native IDs never cross this boundary. */
export const REMOTE_CONTROL_VERSION = 1 as const;
export const REMOTE_ARTIFACT_MAX_BYTES = 10 * 1024 * 1024;
export const REMOTE_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;

export type RemoteBrowserAction =
  | { kind: "click"; element: string }
  | { kind: "type"; element: string; text: string }
  | { kind: "select"; element: string; value: string }
  | { kind: "check"; element: string; checked: boolean }
  | {
      kind: "key";
      key:
        | "Enter"
        | "Escape"
        | "Tab"
        | "ArrowUp"
        | "ArrowDown"
        | "ArrowLeft"
        | "ArrowRight";
    }
  | { kind: "scroll"; direction: "up" | "down" | "top" | "bottom" }
  | { kind: "navigate"; url: string }
  | { kind: "open_tab"; url: string }
  | { kind: "select_tab"; tab: string }
  | { kind: "close_tab"; tab: string }
  | { kind: "attach"; element: string; artifactId: string };

export interface RemoteBrowserObservation {
  revision: string;
  observedAt: string;
  tab: string;
  origin: string;
  title: string;
  text: string;
  truncated: boolean;
  elements: Array<{
    ref: string;
    role: string;
    name: string;
    value?: string;
    disabled: boolean;
  }>;
  tabs: Array<{
    ref: string;
    title: string;
    origin: string;
    taskCreated: boolean;
  }>;
  screenshotArtifactId?: string;
}

export interface RemoteBrowserActionRequest {
  sessionId: string;
  requestId: string;
  expectedRevision: string;
  action: RemoteBrowserAction;
}

export type RemoteBrowserActionResult =
  | { state: "succeeded"; observation: RemoteBrowserObservation }
  | {
      state: "approval_required";
      approvalId: string;
      actionDigest: string;
      expiresAt: string;
      description: string;
    }
  | { state: "failed" | "outcome_unknown" | "cancelled"; code: string };

const record = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("invalid_action");
  return input as Record<string, unknown>;
};
const bounded = (input: unknown, max: number, empty = false): string => {
  if (
    typeof input !== "string" ||
    input.length > max ||
    (!empty && !input.trim())
  )
    throw new Error("invalid_action");
  return input;
};
export function remoteControlUrl(input: unknown): string {
  const value = bounded(input, 2048);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_url");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("invalid_url");
  return url.href;
}

/** Validation is shared by the coordinator and extension; unrecognized keys fail closed. */
export function parseRemoteBrowserAction(input: unknown): RemoteBrowserAction {
  const a = record(input);
  const fields: Record<string, string[]> = {
    click: ["element"],
    type: ["element", "text"],
    select: ["element", "value"],
    check: ["element", "checked"],
    key: ["key"],
    scroll: ["direction"],
    navigate: ["url"],
    open_tab: ["url"],
    select_tab: ["tab"],
    close_tab: ["tab"],
    attach: ["element", "artifactId"],
  };
  const kind = bounded(a.kind, 30);
  const keys = fields[kind];
  if (
    !keys ||
    Object.keys(a).some((k) => k !== "kind" && !keys.includes(k)) ||
    keys.some((k) => a[k] === undefined)
  )
    throw new Error("invalid_action");
  if ("element" in a) bounded(a.element, 200);
  if ("tab" in a) bounded(a.tab, 200);
  if ("artifactId" in a) bounded(a.artifactId, 200);
  if ("url" in a)
    return {
      kind: kind as "navigate" | "open_tab",
      url: remoteControlUrl(a.url),
    };
  if (kind === "type") bounded(a.text, 16000, true);
  if (kind === "select") bounded(a.value, 1000, true);
  if (kind === "check" && typeof a.checked !== "boolean")
    throw new Error("invalid_action");
  if (
    kind === "key" &&
    ![
      "Enter",
      "Escape",
      "Tab",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ].includes(String(a.key))
  )
    throw new Error("invalid_action");
  if (
    kind === "scroll" &&
    !["up", "down", "top", "bottom"].includes(String(a.direction))
  )
    throw new Error("invalid_action");
  // Return a fresh object in canonical field order for idempotency comparisons.
  return Object.fromEntries([
    ["kind", kind],
    ...keys.map((k) => [k, a[k]]),
  ]) as RemoteBrowserAction;
}
