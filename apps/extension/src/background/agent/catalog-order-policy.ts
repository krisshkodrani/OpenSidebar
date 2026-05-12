import { ToolName } from "../../types";
import type { DomSnapshot, TaggedElement } from "../../types";

export interface CatalogOrderPostConfirmationClickInput {
  selectedSkillId?: string | null;
  toolName: ToolName;
  args: Record<string, unknown>;
  snapshot: DomSnapshot | null | undefined;
}

export interface CatalogOrderConfigurationClickInput
  extends CatalogOrderPostConfirmationClickInput {
  originalQuery?: string | null;
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeForMatch(value: unknown): string {
  return normalize(value).replace(/[^a-z0-9]+/g, "");
}

function targetId(args: Record<string, unknown>): number | null {
  if (typeof args.id === "number" && Number.isFinite(args.id)) return args.id;
  if (typeof args.id === "string") {
    const parsed = Number.parseInt(args.id, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isOrderConfirmationPage(snapshot: DomSnapshot): boolean {
  const pageIdentity = normalize([snapshot.title, snapshot.url].join("\n"));
  const pageText = normalize(
    [
      snapshot.title,
      snapshot.url,
      snapshot.visibleContent,
      snapshot.pageContent,
    ].join("\n"),
  );
  if (/\b(sc_req_item\.do|requested item)\b/.test(pageIdentity)) return false;
  const hasRequestNumber = /\breq\d+\b/.test(pageText);
  const hasOrderStatus =
    /\border status\b/.test(pageText) ||
    /servicecatalog_checkout_view/i.test(snapshot.url);
  return hasRequestNumber && hasOrderStatus;
}

function isConfirmationDrillInTarget(element: TaggedElement | undefined): boolean {
  if (!element) return false;
  const label = normalize(
    [
      element.text,
      element.role,
      element.tagName,
      element.attributes?.href,
      element.attributes?.["aria-label"],
      element.attributes?.title,
      element.attributes?.name,
      element.attributes?.id,
    ].join(" "),
  );
  return (
    /\b(req|ritm)\d+\b/.test(label) ||
    /\b(requested item|request item)\b/.test(label) ||
    /\b(sc_req_item\.do|sysparm_sys_id|sys_id=)\b/.test(label) ||
    /\b(back to catalog|continue shopping|home|back_to_catalog|continue_shopping|goto_home|redirect_home)\b/.test(
      label,
    )
  );
}

function explicitCatalogConfigurationFields(query: string | null | undefined): string[] {
  const fields = new Set<string>();
  for (const match of String(query ?? "").matchAll(/['"]([^'"]{2,160})['"]\s*:/g)) {
    const field = match[1]?.replace(/\s+/g, " ").trim();
    if (field) fields.add(field);
  }
  return [...fields];
}

function explicitCatalogRequestedItem(query: string | null | undefined): string | null {
  const text = String(query ?? "");
  const quoted = [...text.matchAll(/["']([^"']{2,160})["']/g)]
    .map((match) => match[1]?.replace(/\s+/g, " ").trim())
    .filter((value): value is string => !!value && !value.includes(":"));
  return quoted[0] ?? null;
}

function isCatalogItemConfigurationPage(snapshot: DomSnapshot): boolean {
  const pageText = normalize(
    [
      snapshot.title,
      snapshot.url,
      snapshot.visibleContent,
      snapshot.pageContent,
    ].join("\n"),
  );
  return (
    /servicecatalog_cat_item|catalog item|order this item|add to cart|order now/.test(
      pageText,
    ) && !isOrderConfirmationPage(snapshot)
  );
}

function isManualCatalogOptionOrSubmitTarget(
  element: TaggedElement | undefined,
): boolean {
  if (!element) return false;
  const label = normalize(
    [
      element.text,
      element.role,
      element.tagName,
      element.attributes?.type,
      element.attributes?.role,
      element.attributes?.["aria-label"],
      element.attributes?.title,
      element.attributes?.name,
      element.attributes?.id,
    ].join(" "),
  );
  return (
    /\b(add to cart|order now|place order|submit order|request|checkout|proceed to checkout)\b/.test(
      label,
    ) ||
    /\bradio\b/.test(label)
  );
}

function isLikelyCatalogItemLink(
  element: TaggedElement | undefined,
  snapshot: DomSnapshot,
): boolean {
  if (!element) return false;
  const href = normalize(element.attributes?.href);
  const label = normalize(
    [
      element.text,
      element.role,
      element.tagName,
      element.attributes?.href,
      element.attributes?.["aria-label"],
      element.attributes?.title,
    ].join(" "),
  );
  const pageText = normalize(
    [
      snapshot.title,
      snapshot.url,
      snapshot.visibleContent,
      snapshot.pageContent,
    ].join(" "),
  );
  const linkLike = /\blink\b/.test(label);
  const catalogLikePage = /\b(catalog|store|shop|products?|items?)\b/.test(
    pageText,
  );
  const itemLikeHref =
    /\b(servicecatalog_cat_item_view|catalog[_/-]?item|cat_item|product|products|item[_/-]?view)\b/.test(
      href,
    );
  return (
    linkLike &&
    normalize(element.text).length >= 2 &&
    (itemLikeHref || catalogLikePage)
  );
}

function snapshotContainsRequestedItem(
  snapshot: DomSnapshot,
  requestedItem: string,
): boolean {
  const requested = normalizeForMatch(requestedItem);
  if (!requested) return false;
  const text = normalizeForMatch(
    [
      snapshot.title,
      snapshot.url,
      snapshot.visibleContent,
      snapshot.pageContent,
      ...snapshot.elements.map((element) => element.text),
    ].join(" "),
  );
  return text.includes(requested);
}

export function assessCatalogOrderItemSelectionClick(
  input: CatalogOrderConfigurationClickInput,
): string | null {
  if (input.selectedSkillId !== "catalog-order-workflow") return null;
  if (input.toolName !== ToolName.CLICK_ELEMENT) return null;
  if (!input.snapshot || isCatalogItemConfigurationPage(input.snapshot)) return null;
  if (isOrderConfirmationPage(input.snapshot)) return null;

  const requestedItem = explicitCatalogRequestedItem(input.originalQuery);
  if (!requestedItem || !snapshotContainsRequestedItem(input.snapshot, requestedItem)) {
    return null;
  }

  const id = targetId(input.args);
  if (id === null) return null;
  const target = input.snapshot.elements.find((element) => element.tag === id);
  if (!isLikelyCatalogItemLink(target, input.snapshot)) return null;

  const requested = normalizeForMatch(requestedItem);
  const clicked = normalizeForMatch(
    [
      target?.text,
      target?.attributes?.["aria-label"],
      target?.attributes?.title,
    ].join(" "),
  );
  if (!requested || clicked.includes(requested) || requested.includes(clicked)) {
    return null;
  }

  return (
    `BLOCKED: the requested catalog item is "${requestedItem}", but this click targets "${target?.text ?? "another item"}". ` +
    "Click the visible requested item exactly, or use find_element/search to locate the requested catalog item before configuring it."
  );
}

export function assessCatalogOrderConfigurationClick(
  input: CatalogOrderConfigurationClickInput,
): string | null {
  if (input.selectedSkillId !== "catalog-order-workflow") return null;
  if (input.toolName !== ToolName.CLICK_ELEMENT) return null;
  if (!input.snapshot || !isCatalogItemConfigurationPage(input.snapshot)) {
    return null;
  }
  if (explicitCatalogConfigurationFields(input.originalQuery).length === 0) {
    return null;
  }

  const id = targetId(input.args);
  if (id === null) return null;
  const target = input.snapshot.elements.find((element) => element.tag === id);
  if (!isManualCatalogOptionOrSubmitTarget(target)) return null;

  return (
    "BLOCKED: this catalog order has explicit configuration fields. " +
    "Use inspect_catalog_item and configure_catalog_item with the requested quantity, optionFields, checkboxes, and textFields; " +
    "do not manually click radio options or Add to Cart/Order Now controls before the helper reports the requested configuration."
  );
}

export function assessCatalogOrderPostConfirmationClick(
  input: CatalogOrderPostConfirmationClickInput,
): string | null {
  if (input.selectedSkillId !== "catalog-order-workflow") return null;
  if (!input.snapshot || !isOrderConfirmationPage(input.snapshot)) return null;

  if (
    input.toolName === ToolName.GO_BACK ||
    input.toolName === ToolName.NAVIGATE ||
    input.toolName === ToolName.OPEN_SERVICENOW_MODULE
  ) {
    return (
      "BLOCKED: request/order confirmation is already visible on this page. " +
      "Do not navigate away or restart the catalog order after submission; " +
      "call done() from the current confirmation page with the request number, item, quantity, and configuration evidence."
    );
  }

  if (
    input.toolName !== ToolName.CLICK_ELEMENT &&
    input.toolName !== ToolName.READ_ELEMENT
  ) {
    return null;
  }

  const id = targetId(input.args);
  if (id === null) return null;
  const target = input.snapshot.elements.find((element) => element.tag === id);
  if (!isConfirmationDrillInTarget(target)) return null;

  return (
    "BLOCKED: request/order confirmation is already visible on this page. " +
    "Do not open request or requested-item detail links after submission; " +
    "call done() from the current confirmation page with the request number, item, quantity, and configuration evidence."
  );
}
