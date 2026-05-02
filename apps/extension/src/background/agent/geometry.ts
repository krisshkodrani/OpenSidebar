import type { DomSnapshot } from "../../types";

export function rectsLikelyOverlap(
  a: DomSnapshot["elements"][number]["rect"] | undefined,
  b: DomSnapshot["elements"][number]["rect"] | undefined,
): boolean {
  if (!a || !b) return false;
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}
