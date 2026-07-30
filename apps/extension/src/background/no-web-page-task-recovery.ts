import { AgentStatus, type RuntimeMessage } from "../types";

type UserChatPayload = Extract<RuntimeMessage, { type: "USER_CHAT" }>["payload"];

const SEARCH_THE_WEB = "Search the web";
const NAVIGATE_FIRST = "I'll navigate first";
const CLARIFICATION_TIMEOUT_MS = 120_000;

export const NO_WEB_PAGE_QUESTION =
  "I need a web page to work from. Would you like me to search the web, or would you prefer to navigate to a site first?";

interface PendingNoWebPageTask {
  payload: UserChatPayload;
  workspaceId: string;
}

interface NoWebPageTaskRecoveryDeps {
  getActiveTabId(): Promise<number | null>;
  resumeTask(payload: UserChatPayload, workspaceId: string): Promise<void>;
  searchWeb(query: string): Promise<void>;
  sendClarification(args: {
    clarificationId: string;
    workspaceId: string;
    question: string;
    suggestions: string[];
    timeoutMs: number;
  }): void;
  sendStatus(
    workspaceId: string,
    status: AgentStatus,
    detail: string,
  ): void;
}

/**
 * Recovers task submission when Chrome is displaying a blank or internal page.
 * Page tools remain unavailable until the user explicitly chooses a web search
 * or navigates to a site themselves.
 */
export class NoWebPageTaskRecovery {
  private readonly pending = new Map<string, PendingNoWebPageTask>();
  private readonly timeouts = new Map<string, ReturnType<typeof setTimeout>>();

  public constructor(private readonly deps: NoWebPageTaskRecoveryDeps) {}

  public request(payload: UserChatPayload, workspaceId: string): void {
    const clarificationId = crypto.randomUUID();
    this.pending.set(clarificationId, { payload, workspaceId });
    this.deps.sendStatus(
      workspaceId,
      AgentStatus.PAUSED,
      "Waiting for a web page choice...",
    );
    this.deps.sendClarification({
      clarificationId,
      workspaceId,
      question: NO_WEB_PAGE_QUESTION,
      suggestions: [SEARCH_THE_WEB, NAVIGATE_FIRST],
      timeoutMs: CLARIFICATION_TIMEOUT_MS,
    });
    this.timeouts.set(
      clarificationId,
      setTimeout(() => this.expire(clarificationId), CLARIFICATION_TIMEOUT_MS),
    );
  }

  public resolve(
    response: { clarificationId: string; answer: string },
    workspaceId: string | null | undefined,
  ): boolean {
    const pending = this.pending.get(response.clarificationId);
    if (!pending || (workspaceId && pending.workspaceId !== workspaceId)) {
      return false;
    }
    this.clear(response.clarificationId);
    void this.continue(pending, response.answer);
    return true;
  }

  public dispose(): void {
    for (const clarificationId of this.timeouts.keys()) {
      this.clear(clarificationId);
    }
  }

  private async continue(
    pending: PendingNoWebPageTask,
    answer: string,
  ): Promise<void> {
    if (answer.trim() !== SEARCH_THE_WEB) {
      this.deps.sendStatus(
        pending.workspaceId,
        AgentStatus.IDLE,
        "Open a web page, then send your request again when you're ready.",
      );
      return;
    }

    try {
      this.deps.sendStatus(
        pending.workspaceId,
        AgentStatus.THINKING,
        "Opening a web search...",
      );
      await this.deps.searchWeb(pending.payload.text);
      const tabId = await this.deps.getActiveTabId();
      if (!tabId) throw new Error("No web page was opened for the search.");
      await this.deps.resumeTask({ ...pending.payload, tabId }, pending.workspaceId);
    } catch (error) {
      this.deps.sendStatus(
        pending.workspaceId,
        AgentStatus.ERROR,
        `Couldn't open a web search: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private expire(clarificationId: string): void {
    const pending = this.pending.get(clarificationId);
    if (!pending) return;
    this.clear(clarificationId);
    this.deps.sendStatus(
      pending.workspaceId,
      AgentStatus.IDLE,
      "Web-page choice timed out. Send your request again when you're ready.",
    );
  }

  private clear(clarificationId: string): void {
    this.pending.delete(clarificationId);
    const timeout = this.timeouts.get(clarificationId);
    if (timeout) clearTimeout(timeout);
    this.timeouts.delete(clarificationId);
  }
}
