export function cleanLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function compactKey(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").slice(0, 120);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hashStableString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
