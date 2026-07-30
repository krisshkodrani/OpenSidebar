import type { DelegatedBrowserTask } from "@shared-types/browser-bridge";

export interface DelegatedTaskActivitySignal {
  active: boolean;
  pageActivity: boolean;
  outcome?: {
    status: "completed" | "failed" | "stopped";
    label?: string;
  };
}

type SendActivity = (
  tabId: number,
  signal: DelegatedTaskActivitySignal,
) => void;

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export class DelegatedTaskFeedback {
  private readonly activeTabs = new Map<string, number>();

  constructor(private readonly sendActivity: SendActivity) {}

  update(task: DelegatedBrowserTask): void {
    const previousTabId = this.activeTabs.get(task.taskId);
    const isTerminal = TERMINAL.has(task.status);

    if (!isTerminal && task.currentTabId !== undefined) {
      if (previousTabId === task.currentTabId) return;
      if (previousTabId !== undefined) {
        this.sendActivity(previousTabId, {
          active: false,
          pageActivity: false,
        });
      }
      this.activeTabs.set(task.taskId, task.currentTabId);
      this.sendActivity(task.currentTabId, {
        active: true,
        pageActivity: true,
      });
      return;
    }

    if (!isTerminal) return;
    this.activeTabs.delete(task.taskId);
    const targetTabId = previousTabId ?? task.currentTabId;
    if (targetTabId === undefined) return;
    this.sendActivity(targetTabId, {
      active: false,
      pageActivity: false,
      outcome: {
        status:
          task.status === "completed"
            ? "completed"
            : task.status === "failed"
              ? "failed"
              : "stopped",
        label:
          task.status === "completed"
            ? "Delegated task completed"
            : task.status === "failed"
              ? "Delegated task failed"
              : "Delegated task stopped",
      },
    });
  }
}
