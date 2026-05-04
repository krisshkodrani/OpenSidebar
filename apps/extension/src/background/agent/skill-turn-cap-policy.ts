const SKILL_TURN_CAPS: Record<string, number> = {
  "multi-tab-checklist-workflow": 45,
  "list-detail-review-loop": 45,
  "paginated-table-scan": 55,
  "paginated-record-lookup": 35,
};

export function applySkillTurnCap(
  selectedSkillId: string | null | undefined,
  maxTurns: number,
): number {
  if (!selectedSkillId) return maxTurns;
  const cap = SKILL_TURN_CAPS[selectedSkillId];
  return typeof cap === "number" ? Math.min(maxTurns, cap) : maxTurns;
}
