import type {
  BrowserCommandRisk,
  BrowserPreconditionV1,
  BrowserCommandState,
  CloudSessionStatus,
  PortableBrowserActionV1,
  SessionLeaseState,
} from "./cloud-sessions";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function canonicalBrowserCommandApprovalPayload(input: {
  action: PortableBrowserActionV1;
  preconditions: BrowserPreconditionV1[];
  risk: BrowserCommandRisk;
  checkpointRevision: number;
}): string {
  return canonicalJson(input);
}

const COMMAND_TRANSITIONS: Readonly<
  Record<BrowserCommandState, readonly BrowserCommandState[]>
> = {
  pending: ["leased", "expired", "cancelled"],
  leased: ["delivered", "expired", "cancelled"],
  delivered: ["accepted", "expired", "cancelled"],
  accepted: ["started", "cancelled"],
  started: ["succeeded", "failed", "outcome_unknown"],
  succeeded: [],
  failed: [],
  outcome_unknown: [],
  expired: [],
  cancelled: [],
};

const SESSION_TRANSITIONS: Readonly<
  Record<CloudSessionStatus, readonly CloudSessionStatus[]>
> = {
  created: ["active", "cancelled", "deleting"],
  active: [
    "waiting_for_user",
    "paused",
    "completed",
    "failed",
    "cancelled",
    "deleting",
  ],
  waiting_for_user: ["active", "paused", "failed", "cancelled", "deleting"],
  paused: ["active", "failed", "cancelled", "deleting"],
  completed: ["deleting"],
  failed: ["deleting"],
  cancelled: ["deleting"],
  deleting: [],
};

const LEASE_TRANSITIONS: Readonly<
  Record<SessionLeaseState, readonly SessionLeaseState[]>
> = {
  active: ["grace", "revoked", "expired"],
  grace: ["active", "revoked", "expired"],
  revoked: [],
  expired: [],
};

export function canTransitionBrowserCommand(
  from: BrowserCommandState,
  to: BrowserCommandState,
): boolean {
  return COMMAND_TRANSITIONS[from].includes(to);
}

export function isTerminalBrowserCommand(state: BrowserCommandState): boolean {
  return COMMAND_TRANSITIONS[state].length === 0;
}

export function canTransitionCloudSession(
  from: CloudSessionStatus,
  to: CloudSessionStatus,
): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

export function canTransitionSessionLease(
  from: SessionLeaseState,
  to: SessionLeaseState,
): boolean {
  return LEASE_TRANSITIONS[from].includes(to);
}

const FORBIDDEN_ACTION_KEYS = new Set([
  "authorization",
  "authorizationheader",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "dom",
  "domnode",
  "frameid",
  "headers",
  "password",
  "providerkey",
  "selector",
  "storagekey",
  "tabid",
  "token",
  "windowid",
]);

function normalizedKey(key: string): string {
  return key.replace(/[_\-\s]/g, "").toLowerCase();
}

function findForbiddenActionKey(
  value: unknown,
  path = "action",
): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenActionKey(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_ACTION_KEYS.has(normalizedKey(key))) return `${path}.${key}`;
    const found = findForbiddenActionKey(nested, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

export type PortableActionValidation =
  | { valid: true }
  | { valid: false; code: "invalid_kind" | "forbidden_field"; path: string };

export function validatePortableBrowserAction(
  action: PortableBrowserActionV1,
): PortableActionValidation {
  if (
    typeof action.kind !== "string" ||
    action.kind.length === 0 ||
    action.kind.length > 80
  ) {
    return { valid: false, code: "invalid_kind", path: "action.kind" };
  }
  const forbidden = findForbiddenActionKey(action.arguments);
  if (forbidden)
    return { valid: false, code: "forbidden_field", path: forbidden };
  return { valid: true };
}
