import React from "react";
import Badge from "../Badge";
import type { SkillStep } from "../../store/types";

interface SkillStepItemProps {
  step: SkillStep;
  index: number;
}

export default function SkillStepItem({ step, index }: SkillStepItemProps) {
  return (
    <div className="bg-[rgba(26,26,46,0.4)] border border-[rgba(15,52,96,0.3)] rounded-[5px] p-2.5 mb-2">
      <div className="text-[10px] font-bold text-trace-accent-light uppercase tracking-wider mb-1">
        Step {index + 1}
      </div>
      <div className="text-xs text-[#c0c0d8] leading-normal mb-1">{step.objective}</div>
      <div className="text-[11px] text-trace-muted italic mb-1">{step.successCriteria}</div>
      {step.allowedTools?.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {step.allowedTools.map((tool, i) => (
            <Badge key={i} variant="tool">
              {tool}
            </Badge>
          ))}
        </div>
      )}
      {step.assumptions?.length > 0 && (
        <div className="text-[10px] text-[#5a5a7e] mt-1">
          Assumptions: {step.assumptions.join(", ")}
        </div>
      )}
    </div>
  );
}
