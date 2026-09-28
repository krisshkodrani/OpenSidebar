import { AgentStatus, type AgentLoopState, type ChatMessage } from "../../types";
import type { LLMMessage } from "../llm/types";

type NavigationStateFields = Pick<
  AgentLoopState,
  "originalQuery" | "turnCount" | "maxTurns" | "workspaceId" | "workerId"
>;

export function createNavigationLoopState(
  tabId: number,
  messages: LLMMessage[],
  fields: NavigationStateFields,
): AgentLoopState {
  return {
    status: AgentStatus.WAITING_FOR_PAGE_LOAD,
    messages: messages as unknown as ChatMessage[],
    ...fields,
    activeTabId: tabId,
    lastActivityTs: Date.now(),
    pendingToolCall: null,
  };
}
