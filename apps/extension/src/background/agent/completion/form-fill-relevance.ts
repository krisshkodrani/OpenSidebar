import type { FormFillFieldExpectation } from "./kernel-types";

export function formFillFieldsMentionedInObjective(
  objective: string,
  requiredFields: FormFillFieldExpectation[],
): boolean {
  const haystack = objective.toLowerCase();
  return requiredFields.some((field) => {
    const label = field.label.trim().toLowerCase();
    const value = field.value.trim().toLowerCase();
    if (label.length >= 3 && haystack.includes(label)) return true;
    return (
      value.length >= 3 &&
      value !== "true" &&
      value !== "false" &&
      haystack.includes(value)
    );
  });
}
