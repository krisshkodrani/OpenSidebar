import { ToolName, type DomSnapshot, type TaggedElement } from "../../types";

export interface RepeatedAddItemClickInput {
  toolName: ToolName;
  args: Record<string, unknown>;
  snapshot?: DomSnapshot | null;
  userRequest?: string;
}

const ADD_ITEM_PATTERN =
  /\badd\b[\s\S]{0,80}\b(?:to\s+)?(?:cart|basket|bag|order)\b/i;
const CART_CONTEXT_PATTERN =
  /\b(?:your\s+cart|shopping\s+cart|cart|basket|bag|order\s+summary|checkout)\b/i;
const CART_ACTION_PATTERN =
  /\b(?:checkout|place\s+order|remove|quantity|qty|continue\s+shopping)\b/i;
const ITEM_STOPWORDS = new Set([
  "add",
  "to",
  "cart",
  "basket",
  "bag",
  "order",
  "button",
  "item",
  "product",
  "the",
  "a",
  "an",
]);

export function assessRepeatedAddItemClick({
  toolName,
  args,
  snapshot,
  userRequest,
}: RepeatedAddItemClickInput): string | null {
  if (toolName !== ToolName.CLICK_ELEMENT || !snapshot) return null;

  const target = findTargetElement(snapshot, args.id);
  if (!target) return null;

  const targetLabel = getElementLabel(target);
  if (!ADD_ITEM_PATTERN.test(targetLabel)) return null;

  const itemLabel = extractItemLabel(targetLabel);
  const itemTokens = significantTokens(itemLabel);
  if (itemTokens.length === 0) return null;
  if (explicitlyRequestsMultiple(itemLabel, itemTokens, userRequest)) return null;

  const cartText = getCartContextText(snapshot);
  if (!cartText || !containsTokens(cartText, itemTokens)) return null;

  return [
    `BLOCKED: "${itemLabel}" already appears in the current cart/order state.`,
    "Re-read the cart/order state and call done if the requested quantity is satisfied.",
    "Do not click Add again unless the user explicitly asked for another quantity.",
  ].join(" ");
}

function findTargetElement(
  snapshot: DomSnapshot,
  id: unknown,
): TaggedElement | undefined {
  const tag =
    typeof id === "number"
      ? id
      : typeof id === "string" && /^\d+$/.test(id)
        ? Number(id)
        : null;
  if (tag === null) return undefined;
  return snapshot.elements.find((element) => element.tag === tag);
}

function getElementLabel(element: TaggedElement): string {
  const attributes = element.attributes ?? {};
  return [
    element.text,
    attributes["aria-label"],
    attributes.label,
    attributes.title,
    attributes.value,
    attributes.name,
    attributes.id,
  ]
    .filter(Boolean)
    .join(" ");
}

function extractItemLabel(label: string): string {
  const normalized = label.replace(/\s+/g, " ").trim();
  const addMatch = normalized.match(
    /\badd\b\s+(.+?)\s+\b(?:to\s+)?(?:cart|basket|bag|order)\b/i,
  );
  if (addMatch?.[1]) return cleanupItemLabel(addMatch[1]);

  return cleanupItemLabel(
    normalized.replace(ADD_ITEM_PATTERN, " ").replace(/\bbutton\b/gi, " "),
  );
}

function cleanupItemLabel(label: string): string {
  return label
    .replace(/\b(?:add|to|cart|basket|bag|order|button)\b/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantTokens(label: string): string[] {
  return normalizeText(label)
    .split(" ")
    .filter((token) => token.length >= 3 && !ITEM_STOPWORDS.has(token))
    .slice(0, 5);
}

function getCartContextText(snapshot: DomSnapshot): string {
  const pageText = [snapshot.visibleContent, snapshot.pageContent]
    .filter(Boolean)
    .join("\n");
  const normalized = normalizeText(pageText);
  if (!CART_CONTEXT_PATTERN.test(normalized)) return "";

  const marker = normalized.search(CART_CONTEXT_PATTERN);
  const context = normalized.slice(marker, marker + 1600);
  return CART_ACTION_PATTERN.test(context) ? context : "";
}

function containsTokens(text: string, tokens: string[]): boolean {
  return tokens.every((token) => text.includes(token));
}

function explicitlyRequestsMultiple(
  itemLabel: string,
  itemTokens: string[],
  userRequest?: string,
): boolean {
  const request = normalizeText(userRequest ?? "");
  if (!request) return false;

  const firstToken = itemTokens[0];
  const itemPhrase = normalizeText(itemLabel);
  const multiple = "(?:two|three|four|five|six|2|3|4|5|6)";
  const itemPrefix = "(?:pairs? of |items? of |units? of |of )?";

  return (
    new RegExp(`\\b${multiple} ${itemPrefix}${escapeRegex(firstToken)}\\b`).test(
      request,
    ) ||
    new RegExp(`\\b${escapeRegex(itemPhrase)}\\b.{0,40}\\b(?:x|qty|quantity) ${multiple}\\b`).test(
      request,
    ) ||
    new RegExp(`\\b(?:another|one more|additional) ${itemPrefix}${escapeRegex(firstToken)}\\b`).test(
      request,
    )
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}