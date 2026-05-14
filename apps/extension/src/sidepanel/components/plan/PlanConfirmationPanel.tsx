import React from "react";
import { ChevronDown } from "lucide-react";
import type { PendingPlanConfirmation } from "../../../types";

export function PlanConfirmationPanel({
  confirmed,
  expandedStep,
  feedback,
  onDecision,
  onFeedbackChange,
  onShowFeedback,
  onToggleStep,
  pendingPlan,
  showFeedback,
}: {
  confirmed: boolean;
  expandedStep: number | null;
  feedback: string;
  onDecision: (decision: "approve" | "cancel") => void;
  onFeedbackChange: (feedback: string) => void;
  onShowFeedback: () => void;
  onToggleStep: (index: number) => void;
  pendingPlan: PendingPlanConfirmation;
  showFeedback: boolean;
}) {
  return (
    <>
      <div className="mb-2 ml-1 max-h-52 overflow-y-auto">
        {pendingPlan.nodes.map((node, index) => (
          <div key={index} className="flex items-start gap-2">
            <div className="flex flex-col items-center">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[10px] font-medium text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                {index + 1}
              </span>
              {index < pendingPlan.nodes.length - 1 ? (
                <div className="min-h-[12px] w-px flex-1 bg-primary-200/60 dark:bg-primary-700/40" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1 pb-2">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleStep(index);
                }}
                className="w-full text-left text-xs leading-relaxed text-primary-800 transition-colors hover:text-primary-700 dark:text-primary-200 dark:hover:text-primary-100"
              >
                {node.description}
                {node.selectedSkillId ? (
                  <span className="ml-1.5 inline-flex rounded bg-primary-100 px-1 py-0.5 align-middle text-[9px] font-normal text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                    {node.selectedSkillId}
                  </span>
                ) : null}
                {node.successCriteria ? (
                  <ChevronDown
                    size={10}
                    className={`ml-1 inline transition-transform ${
                      expandedStep === index ? "" : "-rotate-90"
                    }`}
                  />
                ) : null}
              </button>
              {expandedStep === index && node.successCriteria ? (
                <div className="mt-1 text-[10px] italic leading-relaxed text-primary-600 dark:text-primary-400">
                  {node.successCriteria}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {confirmed ? (
        <div className="py-1 text-[11px] text-primary-600 animate-pulse dark:text-primary-400">
          Starting...
        </div>
      ) : (
        <>
          {!showFeedback ? (
            <button
              onClick={(event) => {
                event.stopPropagation();
                onShowFeedback();
              }}
              className="mb-2 text-[10px] text-primary-600 transition-colors hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-200"
            >
              + Add guidance
            </button>
          ) : (
            <textarea
              value={feedback}
              onChange={(event) => onFeedbackChange(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              placeholder="Add guidance or corrections..."
              rows={2}
              className="mb-2 w-full resize-none rounded-md border border-primary-200 bg-white px-2 py-1.5 text-xs text-primary-800 outline-none placeholder:text-primary-400 focus:ring-1 focus:ring-primary-400 dark:border-primary-700 dark:bg-primary-950/20 dark:text-primary-200 dark:placeholder:text-primary-500"
              autoFocus
            />
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={(event) => {
                event.stopPropagation();
                onDecision("cancel");
              }}
              className="flex-1 rounded border border-primary-300 px-2 py-1.5 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-100 dark:border-primary-700 dark:text-primary-300 dark:hover:bg-primary-900/30"
            >
              Cancel
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                onDecision("approve");
              }}
              className="flex-1 rounded bg-primary-600 px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-700"
            >
              {feedback.trim() ? "Start with guidance" : "Start"}
            </button>
          </div>
        </>
      )}
    </>
  );
}
