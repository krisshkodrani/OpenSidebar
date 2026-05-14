import { useEffect } from "react";
import type {
  PendingApproval,
  PendingClarification,
  TaskCompletionMessage,
} from "../../types";

export function useRealtimeVoiceAnnouncements({
  enabled,
  pendingApproval,
  pendingClarification,
  speakHarnessUpdate,
  taskCompletion,
  toggleListening,
}: {
  enabled: boolean;
  pendingApproval: PendingApproval | null;
  pendingClarification: PendingClarification | null;
  speakHarnessUpdate: (text: string) => void;
  taskCompletion: TaskCompletionMessage["payload"] | null;
  toggleListening: () => void;
}) {
  useEffect(() => {
    if (!enabled || !taskCompletion?.summary) return;
    speakHarnessUpdate(
      `Task ${taskCompletion.status}: ${taskCompletion.summary}`,
    );
  }, [enabled, speakHarnessUpdate, taskCompletion]);

  useEffect(() => {
    if (!enabled || !pendingApproval) return;
    speakHarnessUpdate(
      `Approval required for ${pendingApproval.toolName}. ${pendingApproval.context}`,
    );
  }, [enabled, pendingApproval, speakHarnessUpdate]);

  useEffect(() => {
    if (!enabled || !pendingClarification) return;
    speakHarnessUpdate(
      `The agent needs clarification: ${pendingClarification.question}`,
    );
  }, [enabled, pendingClarification, speakHarnessUpdate]);

  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.altKey && !event.ctrlKey && event.key === "v") {
        event.preventDefault();
        toggleListening();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled, toggleListening]);
}
