import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "../../src/types";
import {
  NO_WEB_PAGE_QUESTION,
  NoWebPageTaskRecovery,
} from "../../src/background/no-web-page-task-recovery";

describe("NoWebPageTaskRecovery", () => {
  const getActiveTabId = vi.fn();
  const resumeTask = vi.fn();
  const searchWeb = vi.fn();
  const sendClarification = vi.fn();
  const sendStatus = vi.fn();
  const recoveries: NoWebPageTaskRecovery[] = [];

  function createRecovery() {
    const recovery = new NoWebPageTaskRecovery({
      getActiveTabId,
      resumeTask,
      searchWeb,
      sendClarification,
      sendStatus,
    });
    recoveries.push(recovery);
    return recovery;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getActiveTabId.mockResolvedValue(41);
    searchWeb.mockResolvedValue(undefined);
    resumeTask.mockResolvedValue(undefined);
  });

  afterEach(() => {
    recoveries.splice(0).forEach((recovery) => recovery.dispose());
  });

  it("asks how to start instead of failing when no web page is available", () => {
    const recovery = createRecovery();

    recovery.request({ text: "Find kids' pyjamas", tabId: 1, workspaceId: "ws-1" }, "ws-1");

    expect(sendStatus).toHaveBeenCalledWith(
      "ws-1",
      AgentStatus.PAUSED,
      "Waiting for a web page choice...",
    );
    expect(sendClarification).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        question: NO_WEB_PAGE_QUESTION,
        suggestions: ["Search the web", "I'll navigate first"],
      }),
    );
  });

  it("searches with Chrome's default provider and resumes the original task", async () => {
    const recovery = createRecovery();
    recovery.request({ text: "Find kids' pyjamas", tabId: 1, workspaceId: "ws-1" }, "ws-1");
    const [{ clarificationId }] = sendClarification.mock.calls.map(([args]) => args);

    expect(recovery.resolve({ clarificationId, answer: "Search the web" }, "ws-1")).toBe(true);
    await vi.waitFor(() => expect(resumeTask).toHaveBeenCalled());

    expect(searchWeb).toHaveBeenCalledWith("Find kids' pyjamas");
    expect(resumeTask).toHaveBeenCalledWith(
      { text: "Find kids' pyjamas", tabId: 41, workspaceId: "ws-1" },
      "ws-1",
    );
  });

  it("returns to idle when the user chooses to navigate first", async () => {
    const recovery = createRecovery();
    recovery.request({ text: "Summarize a page", tabId: 1, workspaceId: "ws-1" }, "ws-1");
    const [{ clarificationId }] = sendClarification.mock.calls.map(([args]) => args);

    recovery.resolve({ clarificationId, answer: "I'll navigate first" }, "ws-1");
    await vi.waitFor(() =>
      expect(sendStatus).toHaveBeenLastCalledWith(
        "ws-1",
        AgentStatus.IDLE,
        "Open a web page, then send your request again when you're ready.",
      ),
    );
    expect(searchWeb).not.toHaveBeenCalled();
    expect(resumeTask).not.toHaveBeenCalled();
  });
});
