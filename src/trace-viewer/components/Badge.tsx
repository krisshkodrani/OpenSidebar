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
  | `difficulty-${string}`;

const VARIANT_CLASSES: Record<string, string> = {
  completed: "bg-green-500/15 text-[#2ecc71] border border-green-500/30",
  success: "bg-green-500/15 text-[#2ecc71] border border-green-500/30",
  stopped: "bg-yellow-500/15 text-[#f1c40f] border border-yellow-500/30",
  error: "bg-red-500/15 text-[#e74c3c] border border-red-500/30",
  failure: "bg-red-500/15 text-[#e74c3c] border border-red-500/30",
  max_turns: "bg-orange-500/15 text-[#e67e22] border border-orange-500/30",
  model: "bg-blue-500/[0.12] text-trace-accent-light border border-blue-500/25 font-mono text-[9px] normal-case font-medium",
  manual: "bg-indigo-500/15 text-[#a78bfa] border border-indigo-500/30 font-mono text-[9px] normal-case font-medium",
  recording: "bg-red-500/15 text-red-400 border border-red-500/30 font-mono text-[9px] normal-case font-medium",
  tool: "bg-purple-500/15 text-[#bb8fce] border border-purple-500/30 font-mono normal-case font-medium text-[11px]",
  enabled: "bg-green-500/15 text-[#2ecc71] border border-green-500/30",
  disabled: "bg-red-500/15 text-[#e74c3c] border border-red-500/30",
  pinned: "bg-yellow-500/15 text-[#f1c40f] border border-yellow-500/30",
  type: "bg-blue-500/[0.12] text-trace-accent-light border border-blue-500/25 normal-case",
  category: "bg-purple-500/[0.12] text-[#bb8fce] border border-purple-500/25 normal-case",
  cached: "bg-green-500/10 text-[#2ecc71] border border-green-500/20 text-[9px]",
  dynamic: "bg-orange-500/10 text-[#e67e22] border border-orange-500/20 text-[9px]",
  "original-query": "bg-yellow-500/15 text-[#f1c40f] border border-yellow-500/30 text-[9px]",
  // difficulty badges
  "difficulty-simple": "bg-green-500/15 text-[#2ecc71] border border-green-500/30",
  "difficulty-moderate": "bg-yellow-500/15 text-[#f1c40f] border border-yellow-500/30",
  "difficulty-complex": "bg-orange-500/15 text-[#e67e22] border border-orange-500/30",
  "difficulty-extreme": "bg-red-500/15 text-[#e74c3c] border border-red-500/30",
  // role badges
  "role-system": "bg-purple-500/15 text-[#bb8fce] border border-purple-500/30",
  "role-user": "bg-blue-500/15 text-trace-accent-light border border-blue-500/30",
  "role-assistant": "bg-green-500/15 text-[#2ecc71] border border-green-500/30",
  "role-tool": "bg-orange-500/15 text-[#e67e22] border border-orange-500/30",
  // event badges
  "event-escalation": "bg-orange-500/15 text-[#e67e22] border border-orange-500/30",
  "event-stuck": "bg-red-500/15 text-[#e74c3c] border border-red-500/30",
  "event-stuck_signal": "bg-red-500/15 text-[#e74c3c] border border-red-500/30",
  "event-circuit_breaker": "bg-red-500/15 text-[#e74c3c] border border-red-500/30",
  "event-hint": "bg-blue-500/15 text-[#3498db] border border-blue-500/30",
  "event-screenshot": "bg-green-500/15 text-[#2ecc71] border border-green-500/30",
  "event-plan_update": "bg-purple-500/15 text-[#bb8fce] border border-purple-500/30",
};

const DEFAULT_EVENT_CLASS = "bg-gray-500/15 text-[#95a5a6] border border-gray-500/30";

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export default function Badge({ variant, children, className = "" }: BadgeProps) {
  const cls =
    VARIANT_CLASSES[variant] ?? DEFAULT_EVENT_CLASS;

  return (
    <span
      className={`inline-block px-[7px] py-[2px] rounded text-[10px] font-semibold tracking-wide uppercase leading-snug ${cls} ${className}`}
    >
      {children}
    </span>
  );
}
