/**
 * Navigation completion analysis (RFC LP-16 Phase 1). Parses navigation
 * targets from a query, matches them against the live URL, and derives
 * navigation completion evidence. Verbatim movement from completion-kernel.ts.
 */
import type { DomSnapshot } from "../../../types";
import type { CompletionEvidence, NavigationContract } from "./kernel-types";
import { compactKey } from "./text-utils";

function navigationStateEvidence(
  snapshot: DomSnapshot,
  turn: number,
): Extract<CompletionEvidence, { type: "navigation_state" }>[] {
  if (!snapshot.url) return [];
  const parsed = parseNavigationTarget(snapshot.url);
  if (!parsed) return [];
  return [
    {
      type: "navigation_state",
      confidence: "medium",
      logicalKey: `navigation:page:${compactKey(parsed.host)}`,
      observedAtTurn: turn,
      detail: {
        url: snapshot.url,
        ...(snapshot.title ? { title: snapshot.title } : {}),
      },
    },
  ];
}

export function samePageUrl(before: string, after: string): boolean {
  if (!before || !after) return before === after;
  try {
    const beforeUrl = new URL(before);
    const afterUrl = new URL(after);
    return (
      beforeUrl.origin === afterUrl.origin &&
      beforeUrl.pathname === afterUrl.pathname &&
      beforeUrl.search === afterUrl.search
    );
  } catch {
    return before === after;
  }
}

export function extractNavigationEvidence(
  snapshot: DomSnapshot,
  turn: number,
): CompletionEvidence[] {
  return navigationStateEvidence(snapshot, turn);
}

export function extractNavigationTarget(value: string): URL | null {
  const explicitUrl =
    value.match(/\bhttps?:\/\/[^\s"'<>]+/i)?.[0]?.replace(/[),.;]+$/g, "") ??
    null;
  if (explicitUrl) return parseNavigationTarget(explicitUrl);

  const domainPattern =
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|edu|gov|io|ai|app|dev|test|local|co|uk|de|fr|ca|us)\b(?:\/[^\s"'<>]*)?/gi;
  for (const match of value.matchAll(domainPattern)) {
    const rawDomain = match[0];
    const index = match.index ?? 0;
    if (index > 0 && value[index - 1] === "@") continue;
    const domain = rawDomain.replace(/[),.;]+$/g, "");
    const parsed = parseNavigationTarget(`https://${domain}`);
    if (parsed) return parsed;
  }
  return null;
}

export function parseNavigationTarget(value: string): URL | null {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function navigationTargetMatches(
  current: URL,
  contract: NavigationContract,
): boolean {
  if (current.host.toLowerCase() !== contract.targetHost.toLowerCase()) {
    return false;
  }

  const target = parseNavigationTarget(contract.targetUrl);
  if (!target) return false;
  const targetPath = normalizeNavigationPath(target);
  if (targetPath === "/") return true;
  return normalizeNavigationPath(current) === targetPath;
}

function normalizeNavigationPath(url: URL): string {
  const path = url.pathname.replace(/\/+$/g, "") || "/";
  const search = url.searchParams.toString();
  return search ? `${path}?${search}` : path;
}
