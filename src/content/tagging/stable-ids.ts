/**
 * Stable ID infrastructure - hash-based persistent element IDs across snapshot refreshes
 */

/** Persistent hash → integer ID map (survives across snapshot refreshes) */
export const hashToId = new Map<string, number>();
/** Reverse map: integer ID → hash */
export const idToHash = new Map<number, string>();
/** Next available integer ID */
let nextId = 1;
/** IDs from previous refresh that weren't seen this refresh (grace period) */
export const previousIds = new Set<number>();

/**
 * FNV-1a 32-bit hash → 8-char hex string.
 * Fast, deterministic, good distribution for short strings.
 */
export function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Build a simplified DOM path from body → element using child indices */
export function getDomPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (
    current &&
    current !== document.body &&
    current !== document.documentElement
  ) {
    const parent = current.parentElement;
    if (!parent) break;
    const siblings = Array.from(parent.children);
    const idx = siblings.indexOf(current);
    parts.unshift(`${current.tagName.toLowerCase()}:${idx}`);
    current = parent;
  }
  return parts.join(">");
}

/** Build a stable attribute signature from identity-bearing attributes */
export function getAttrSignature(el: Element): string {
  const keys = [
    "id",
    "name",
    "type",
    "role",
    "href",
    "aria-label",
    "data-testid",
  ];
  return keys
    .map((k) => el.getAttribute(k))
    .filter(Boolean)
    .join("|");
}

/**
 * Compute a stable hash for an element based on its identity.
 * Components: tagName, DOM path, first 30 chars of text, key attributes.
 */
export function computeStableHash(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const path = getDomPath(el);
  const text = (el.textContent?.trim() || "").slice(0, 30).toLowerCase();
  const attrs = getAttrSignature(el);
  return fnv1aHash(`${tag}|${path}|${text}|${attrs}`);
}

/**
 * Get or allocate a stable integer ID for a given hash.
 * Reuses existing ID if the hash was seen before.
 */
export function getStableId(hash: string): number {
  const existing = hashToId.get(hash);
  if (existing !== undefined) return existing;
  const id = nextId++;
  hashToId.set(hash, id);
  idToHash.set(id, hash);
  return id;
}

/** Reset all stable ID maps (hash maps, previous IDs, counter) */
export function resetStableIdMaps(): void {
  hashToId.clear();
  idToHash.clear();
  previousIds.clear();
  nextId = 1;
}
