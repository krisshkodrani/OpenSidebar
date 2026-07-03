/**
 * ServiceNow adapter — shared value/key normalization helpers.
 *
 * Used by both the reference-field and module-navigation halves of the
 * adapter. Pure string utilities grounded in stable platform semantics
 * (field value/display_value envelopes, reference keys).
 */

export function unwrapServiceNowFieldValue(fieldValue: unknown): string {
  if (typeof fieldValue === "string") return fieldValue;
  if (fieldValue && typeof fieldValue === "object") {
    const obj = fieldValue as Record<string, unknown>;
    if (typeof obj.value === "string") return obj.value;
    if (typeof obj.display_value === "string") return obj.display_value;
  }
  return "";
}

export function unwrapServiceNowDisplayValue(fieldValue: unknown): string {
  if (typeof fieldValue === "string") return fieldValue;
  if (fieldValue && typeof fieldValue === "object") {
    const obj = fieldValue as Record<string, unknown>;
    if (typeof obj.display_value === "string") return obj.display_value;
    if (typeof obj.value === "string") return obj.value;
  }
  return "";
}

export function normalizeServiceNowReferenceKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
