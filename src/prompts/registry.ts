import { PromptDefinition, PromptDescriptor, PromptId } from "./types";
import {
  GENERATED_PROMPTS,
  GENERATED_PROMPT_DESCRIPTORS,
} from "./generated";

const PROMPTS = GENERATED_PROMPTS as Record<PromptId, PromptDefinition>;
const PROMPT_DESCRIPTORS = GENERATED_PROMPT_DESCRIPTORS as Record<
  PromptId,
  PromptDescriptor
>;

export function getPromptTemplate(id: PromptId): string {
  return PROMPTS[id].template;
}

export function getPromptDefinition(id: PromptId): PromptDefinition {
  return PROMPTS[id];
}

export function listPromptDescriptors(ids?: PromptId[]): PromptDescriptor[] {
  const keys = ids ?? (Object.keys(PROMPTS) as PromptId[]);
  return keys.map((id) => PROMPT_DESCRIPTORS[id]);
}
