import { ToolName } from "../../types";
import type { DomSnapshot, TaggedElement } from "../../types";

export interface CatalogOrderPostConfirmationClickInput {
  selectedSkillId?: string | null;
  toolName: ToolName;
  args: Record<string, unknown>;
  snapshot: DomSnapshot | null | undefined;
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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
    ].join(" "),
  );
  if (element.tagName.toLowerCase() !== "a" && element.role !== "link") {
    return false;
  }
  return (
    /\b(req|ritm)\d+\b/.test(label) ||
    /\b(standard laptop|lenovo|requested item|request item)\b/.test(label) ||
    /\b(sc_req_item\.do|sysparm_sys_id|sys_id=)\b/.test(label)
  );
}

export function assessCatalogOrderPostConfirmationClick(
  input: CatalogOrderPostConfirmationClickInput,
): string | null {
  if (input.selectedSkillId !== "catalog-order-workflow") return null;
  if (input.toolName !== ToolName.CLICK_ELEMENT) return null;
  if (!input.snapshot || !isOrderConfirmationPage(input.snapshot)) return null;

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
