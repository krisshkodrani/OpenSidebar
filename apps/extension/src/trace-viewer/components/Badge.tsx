import React from "react";

type BadgeVariant =
  | "completed"
  | "success"
  | "stopped"
  | "error"
  | "failure"
  | "max_turns"
  | "model"
  | "manual"
  | "recording"
  | "tool"
  | "enabled"
  | "disabled"
  | "pinned"
  | "type"
  | "category"
  | "cached"
  | "dynamic"
  | "original-query"
  | `event-${string}`
  | `role-${string}`
  | `difficulty-${string}`
  | "tier-executor"
  | "tier-planner";

const VARIANT_CLASSES: Record<string, string> = {
  completed: "bg-state-success/10 text-state-success border border-state-success/25",
  success: "bg-state-success/10 text-state-success border border-state-success/25",
  stopped: "bg-state-warning/10 text-state-warning border border-state-warning/25",
  error: "bg-state-error/10 text-state-error border border-state-error/25",
  failure: "bg-state-error/10 text-state-error border border-state-error/25",
  max_turns: "bg-state-warning/10 text-state-warning border border-state-warning/25",
  model:
    "bg-trace-accent/10 text-trace-accent-light border border-trace-accent/25 font-mono text-[9px] normal-case font-medium",
  manual:
    "bg-brand-live/10 text-brand-live border border-brand-live/25 font-mono text-[9px] normal-case font-medium",
  recording:
    "bg-state-error/10 text-state-error border border-state-error/25 font-mono text-[9px] normal-case font-medium",
  tool: "bg-brand-live/10 text-brand-live border border-brand-live/25 font-mono normal-case font-medium text-[11px]",
  enabled: "bg-state-success/10 text-state-success border border-state-success/25",
  disabled: "bg-state-error/10 text-state-error border border-state-error/25",
  pinned: "bg-state-warning/10 text-state-warning border border-state-warning/25",
  type: "bg-trace-accent/10 text-trace-accent-light border border-trace-accent/25 normal-case",
  category:
    "bg-brand-live/10 text-brand-live border border-brand-live/25 normal-case",
  cached:
    "bg-state-success/10 text-state-success border border-state-success/20 text-[9px]",
  dynamic:
    "bg-state-warning/10 text-state-warning border border-state-warning/20 text-[9px]",
  "original-query":
    "bg-state-warning/10 text-state-warning border border-state-warning/25 text-[9px]",
  // tier badges
  "tier-executor":
    "bg-brand-live/10 text-brand-live border border-brand-live/25 text-[9px] font-mono",
  "tier-planner":
    "bg-state-warning/10 text-state-warning border border-state-warning/25 text-[9px] font-mono",
  // difficulty badges
  "difficulty-simple":
    "bg-state-success/10 text-state-success border border-state-success/25",
  "difficulty-moderate":
    "bg-state-warning/10 text-state-warning border border-state-warning/25",
  "difficulty-complex":
    "bg-state-warning/10 text-state-warning border border-state-warning/25",
  "difficulty-extreme": "bg-state-error/10 text-state-error border border-state-error/25",
  // role badges
  "role-system": "bg-trace-accent/10 text-trace-accent-light border border-trace-accent/25",
  "role-user":
    "bg-trace-accent/10 text-trace-accent-light border border-trace-accent/25",
  "role-assistant": "bg-state-success/10 text-state-success border border-state-success/25",
  "role-tool": "bg-brand-live/10 text-brand-live border border-brand-live/25",
  // event badges
  "event-escalation":
    "bg-state-warning/10 text-state-warning border border-state-warning/25",
  "event-stuck": "bg-state-error/10 text-state-error border border-state-error/25",
  "event-stuck_signal": "bg-state-error/10 text-state-error border border-state-error/25",
  "event-circuit_breaker":
    "bg-state-error/10 text-state-error border border-state-error/25",
  "event-hint": "bg-trace-accent/10 text-trace-accent-light border border-trace-accent/25",
  "event-screenshot":
    "bg-state-success/10 text-state-success border border-state-success/25",
  "event-plan_update":
    "bg-brand-live/10 text-brand-live border border-brand-live/25",
};

const DEFAULT_EVENT_CLASS =
  "bg-trace-bg text-trace-muted border border-trace-border";

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export default function Badge({
  variant,
  children,
  className = "",
}: BadgeProps) {
  const cls = VARIANT_CLASSES[variant] ?? DEFAULT_EVENT_CLASS;

  return (
    <span
      className={`inline-block px-[7px] py-[2px] rounded text-[10px] font-semibold tracking-wide uppercase leading-snug ${cls} ${className}`}
    >
      {children}
    </span>
  );
}
