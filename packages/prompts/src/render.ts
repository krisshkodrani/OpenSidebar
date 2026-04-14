import { getPromptTemplate } from "./registry";
import { PromptId } from "./types";

type PromptRenderValues = Record<
  string,
  string | number | boolean | null | undefined
>;

export function renderPrompt(
  id: PromptId,
  values?: PromptRenderValues,
): string {
  const template = getPromptTemplate(id);
  if (!values) return template;
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, key: string) => {
      const value = values[key];
      return value === undefined || value === null ? "" : String(value);
    },
  );
}
