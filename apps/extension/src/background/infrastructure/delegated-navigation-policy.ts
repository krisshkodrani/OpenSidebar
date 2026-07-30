import { workspaceManager } from "../workspaces/manager";

export interface DelegatedNavigationPolicy {
  workspaceId: string;
  allowedDomains: string[];
}

const policies = new Map<string, DelegatedNavigationPolicy>();

function normalizeDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const parsed = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`,
    );
    if (!parsed.hostname) return null;
    const wildcard = trimmed.replace(/^[a-z]+:\/\//u, "").startsWith("*.");
    const hostname = parsed.hostname.replace(/^\*\./u, "");
    return `${wildcard ? "*." : ""}${hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return null;
  }
}

export function normalizeAllowedDomains(values: string[]): string[] {
  return [
    ...new Set(
      values
        .map(normalizeDomain)
        .filter((value): value is string => value !== null),
    ),
  ];
}

export function setDelegatedNavigationPolicy(
  workspaceId: string,
  allowedDomains: string[],
): void {
  const normalized = normalizeAllowedDomains(allowedDomains);
  if (normalized.length === 0) {
    throw new Error("Delegated browser tasks require at least one allowed domain.");
  }
  policies.set(workspaceId, { workspaceId, allowedDomains: normalized });
}

export function clearDelegatedNavigationPolicy(workspaceId: string): void {
  policies.delete(workspaceId);
}

export function getDelegatedNavigationPolicy(
  workspaceId: string | null | undefined,
): DelegatedNavigationPolicy | null {
  if (!workspaceId) return null;
  return policies.get(workspaceId) ?? null;
}

export async function getDelegatedNavigationPolicyForTab(
  tabId: number,
): Promise<DelegatedNavigationPolicy | null> {
  const workspace = await workspaceManager.getWorkspaceForTab(tabId);
  return getDelegatedNavigationPolicy(workspace?.id);
}

export function isUrlAllowedByDelegatedPolicy(
  url: string,
  policy: Pick<DelegatedNavigationPolicy, "allowedDomains">,
): boolean {
  if (url === "about:blank") return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port;
  return policy.allowedDomains.some((entry) => {
    const lastColon = entry.lastIndexOf(":");
    const hasPort =
      lastColon > -1 && /^\d+$/u.test(entry.slice(lastColon + 1));
    const domain = hasPort ? entry.slice(0, lastColon) : entry;
    const requiredPort = hasPort ? entry.slice(lastColon + 1) : "";
    if (requiredPort && port !== requiredPort) return false;
    if (domain.startsWith("*.")) {
      const suffix = domain.slice(2);
      return hostname === suffix || hostname.endsWith(`.${suffix}`);
    }
    return hostname === domain;
  });
}

export async function isDelegatedNavigationAllowed(
  workspaceId: string | null | undefined,
  url: string,
): Promise<boolean> {
  const policy = getDelegatedNavigationPolicy(workspaceId);
  return !policy || isUrlAllowedByDelegatedPolicy(url, policy);
}

export function delegatedNavigationError(
  workspaceId: string | null | undefined,
  url: string,
  action: "navigate" | "switch tab" | "create tab",
): string | null {
  const policy = getDelegatedNavigationPolicy(workspaceId);
  if (!policy || isUrlAllowedByDelegatedPolicy(url, policy)) return null;
  return (
    `Error: Cannot ${action} to ${url}; it is outside delegated task domains: ` +
    policy.allowedDomains.join(", ")
  );
}
