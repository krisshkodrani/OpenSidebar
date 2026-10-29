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
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-ui-caption font-medium text-accent-text">
                {index + 1}
              </span>
              {index < pendingPlan.nodes.length - 1 ? (
                <div className="min-h-[12px] w-px flex-1 bg-accent/60" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1 pb-2">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleStep(index);
                }}
                className="w-full text-left text-ui-control leading-relaxed text-accent-text transition-colors"
              >
                {node.description}
                {node.selectedSkillId ? (
                  <span className="ml-1.5 inline-flex rounded bg-accent-subtle px-1 py-0.5 align-middle text-ui-caption font-normal text-accent-text">
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
                <div className="mt-1 text-ui-caption italic leading-relaxed text-accent-text">
                  {node.successCriteria}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {confirmed ? (
        <div className="py-1 text-ui-caption text-accent-text animate-pulse">
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
              className="mb-2 text-ui-caption text-accent-text transition-colors"
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
              className="mb-2 w-full resize-none rounded-md border border-accent/30 bg-surface px-2 py-1.5 text-ui-control text-accent-text outline-none placeholder:text-fg-tertiary focus:ring-1 focus:ring-accent"
              autoFocus
            />
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={(event) => {
                event.stopPropagation();
                onDecision("cancel");
              }}
              className="flex-1 rounded border border-accent/30 px-2 py-1.5 text-ui-control font-medium text-accent-text transition-colors hover:bg-accent-subtle"
            >
              Cancel
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                onDecision("approve");
              }}
              className="flex-1 rounded bg-accent px-2 py-1.5 text-ui-control font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            >
              {feedback.trim() ? "Start with guidance" : "Start"}
            </button>
          </div>
        </>
      )}
    </>
  );
}
