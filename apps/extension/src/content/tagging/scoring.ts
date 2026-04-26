/**
 * Element scoring and collapse - prioritize task-relevant elements, deduplicate near-identical
 */

import { isRandomHash } from "./utils";

/**
 * Collapse near-identical elements to free tag slots for diverse ones.
 * Groups by `tagName|role|normalizedText` and keeps max 2 representatives per group.
 * Never collapses elements with special attributes (draggable, dropzone, submit, file, dialog, name).
 */
export function collapseNearIdentical(elements: Element[]): {
  survivors: Element[];
  collapsedCount: number;
  collapsedGroups: string[];
} {
  function getActionIdentity(el: Element): string {
    const attrCandidates = [
      el.getAttribute("aria-label"),
      el.getAttribute("placeholder"),
      el.getAttribute("name"),
      el.getAttribute("id"),
      el.getAttribute("title"),
    ];

    const labelText =
      (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)
        .labels &&
      (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).labels!
        .length > 0
        ? Array.from(
            (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)
              .labels!,
          )
            .map((label) => label.textContent?.trim() || "")
            .filter(Boolean)
            .join(" ")
        : "";

    const text =
      attrCandidates.find(
        (candidate) => candidate && candidate.trim().length > 0,
      ) ||
      labelText ||
      el.textContent?.trim() ||
      "";

    return normalizeText(text.slice(0, 80));
  }

  /** Strip trailing digits/numbers to normalize text for grouping */
  function normalizeText(text: string): string {
    const trimmed = text.trim();
    if (/^\d+$/.test(trimmed)) return trimmed;
    return text
      .replace(/\s*\d+\s*$/, "")
      .trim()
      .toLowerCase();
  }

  /** Elements that should never be collapsed */
  function isProtected(el: Element): boolean {
    if (el.getAttribute("draggable") === "true") return true;
    if (el.hasAttribute("dropzone")) return true;
    if ((el as HTMLElement).dataset?.droptarget) return true;
    if ((el as HTMLElement).dataset?.dropzone) return true;
    if (typeof (el as any).ondrop === "function") return true;
    if (typeof (el as any).ondragover === "function") return true;
    const type = el.getAttribute("type");
    if (type === "submit" || type === "file") return true;
    const role = el.getAttribute("role");
    if (role === "dialog" || role === "alertdialog") return true;
    if (el.hasAttribute("name")) return true;
    return false;
  }

  const MAX_PER_GROUP = 2;

  // Group elements by key
  const groups = new Map<string, Element[]>();
  const protectedElements: Element[] = [];

  for (const el of elements) {
    if (isProtected(el)) {
      protectedElements.push(el);
      continue;
    }
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || "";
    const text = getActionIdentity(el);
    const key = `${tag}|${role}|${text}`;

    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(el);
  }

  const survivors: Element[] = [...protectedElements];
  let collapsedCount = 0;
  const collapsedGroups: string[] = [];

  for (const [key, group] of groups) {
    if (group.length <= MAX_PER_GROUP) {
      // Small group — keep all
      survivors.push(...group);
    } else {
      // Keep first + last for position context
      survivors.push(group[0], group[group.length - 1]);
      const dropped = group.length - MAX_PER_GROUP;
      collapsedCount += dropped;
      // Extract readable group name from key
      const parts = key.split("|");
      const label = parts[2] || parts[0];
      collapsedGroups.push(`${dropped}× "${label}"`);
    }
  }

  return { survivors, collapsedCount, collapsedGroups };
}

/**
 * Score an element by task-relevance. Higher scores = more likely to be useful.
 * Form inputs, draggable/dropzone elements, and semantically-named elements rank highest.
 */
export function scoreElement(el: Element): number {
  let score = 0;
  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute("type") || "";
  const role = el.getAttribute("role") || "";

  // Form inputs (text, email, password, search, tel, url, number, date)
  if (
    tag === "input" &&
    !["hidden", "submit", "button", "reset"].includes(type)
  )
    score += 10;
  if (tag === "textarea") score += 10;
  if (tag === "select") score += 10;

  // Submit/file/action elements
  if (type === "submit" || type === "file") score += 8;

  // Draggable/dropzone (critical for DnD tasks)
  if (el.getAttribute("draggable") === "true") score += 8;
  if (
    el.hasAttribute("dropzone") ||
    (el as HTMLElement).dataset?.droptarget ||
    (el as HTMLElement).dataset?.dropzone ||
    typeof (el as any).ondrop === "function" ||
    typeof (el as any).ondragover === "function"
  )
    score += 8;

  // Named elements (semantic, likely unique)
  if (el.hasAttribute("name") || el.hasAttribute("data-testid")) score += 5;

  // Unique identifiers boost
  if (el.id && !isRandomHash(el.id)) score += 3;

  // Role-specific boosts
  if (role === "combobox" || role === "listbox") score += 5;
  if (role === "dialog" || role === "alertdialog") score += 4;
  if (role === "tab" || role === "menuitem") score += 2;

  // Links with href (navigational relevance)
  if (tag === "a" && el.hasAttribute("href")) score += 2;

  // Canvas elements (drawing tasks)
  if (tag === "canvas") score += 6;

  return score;
}
