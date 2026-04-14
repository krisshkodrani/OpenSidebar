import { UserSettings } from "../types";

function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(\*\.)+/, "")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
}

function extractHostFromRule(rule: string): string {
  const trimmed = rule.trim().toLowerCase();
  if (!trimmed) return "";
  try {
    const withScheme = /^https?:\/\//.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    return normalizeHost(new URL(withScheme).hostname);
  } catch {
    return normalizeHost(
      trimmed
        .replace(/^https?:\/\//, "")
        .split("/")[0]
        .replace(/^\*\./, ""),
    );
  }
}

export function getSiteAccessRules(settings: UserSettings): string[] {
  return (settings.siteAccessBlocklist ?? [])
    .map(extractHostFromRule)
    .filter(Boolean);
}

export function matchBlockedRule(
  hostname: string,
  rules: string[],
): string | null {
  const host = normalizeHost(hostname);
  for (const rule of rules) {
    if (host === rule || host.endsWith(`.${rule}`)) return rule;
  }
  return null;
}

export function getBlockedRuleForUrl(
  url: string,
  settings: UserSettings,
): { host: string; rule: string } | null {
  if ((settings.siteAccessMode ?? "allow_all") !== "blocklist") return null;
  try {
    const host = normalizeHost(new URL(url).hostname);
    const rules = getSiteAccessRules(settings);
    const rule = matchBlockedRule(host, rules);
    if (!rule) return null;
    return { host, rule };
  } catch {
    return null;
  }
}

export function isUrlBlockedBySettings(
  url: string,
  settings: UserSettings,
): boolean {
  return getBlockedRuleForUrl(url, settings) != null;
}
