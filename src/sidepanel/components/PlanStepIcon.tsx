import React from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  SkipForward,
  XCircle,
} from "lucide-react";
import type { PlanRowStatus } from "../plan-board-view";

export function PlanStepIcon({
  status,
  size = 12,
}: {
  status: PlanRowStatus;
  size?: number;
}) {
  if (status === "completed") {
    return <CheckCircle2 size={size} className="text-green-500 shrink-0" />;
  }
  if (status === "running") {
    return (
      <Loader2 size={size} className="text-primary-500 animate-spin shrink-0" />
    );
  }
  if (status === "failed") {
    return <XCircle size={size} className="text-red-500 shrink-0" />;
  }
  if (status === "skipped") {
    return <SkipForward size={size} className="text-warm-400 shrink-0" />;
  }
  return (
    <Circle
      size={size}
      className="text-warm-300 dark:text-warm-600 shrink-0"
    />
  );
}
