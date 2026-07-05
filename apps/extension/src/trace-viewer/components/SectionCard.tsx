import React from "react";

// Shared layout primitives for the viewer. They encode one contrast ladder so
// the eye always has the same places to land:
//   • eyebrow  → text-trace-muted (the quiet section label)
//   • title    → text-trace-text   (the thing that matters)
//   • body     → text-trace-subtle (supporting copy)
//   • meta     → text-trace-dim    (timestamps, counts, asides)
// Before this, every card re-spelled `bg-trace-panel border ... rounded-lg p-4`
// and the uppercase label drifted between text-[10px]/[11px] and two trackings.

export type CardTone = "default" | "warning" | "error" | "success" | "accent";

const TONE_BORDER: Record<CardTone, string> = {
  default: "border-trace-border",
  warning: "border-state-warning/30",
  error: "border-state-error/30",
  success: "border-state-success/30",
  accent: "border-trace-accent/30",
};

/** The one canonical section label. Use everywhere a small uppercase header is wanted. */
export function Eyebrow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-[10px] font-semibold uppercase tracking-[0.14em] text-trace-muted ${className}`}
    >
      {children}
    </div>
  );
}

interface SectionCardProps {
  /** Optional eyebrow label rendered at the top-left. */
  title?: React.ReactNode;
  /** Optional content rendered at the top-right of the header row. */
  actions?: React.ReactNode;
  tone?: CardTone;
  className?: string;
  /** Spacing between the header and the body. */
  bodyClassName?: string;
  children: React.ReactNode;
}

export default function SectionCard({
  title,
  actions,
  tone = "default",
  className = "",
  bodyClassName = "",
  children,
}: SectionCardProps) {
  return (
    <section
      className={`rounded-lg border ${TONE_BORDER[tone]} bg-trace-panel p-4 ${className}`}
    >
      {(title != null || actions != null) && (
        <div className="mb-2 flex items-center justify-between gap-3">
          {title != null ? <Eyebrow>{title}</Eyebrow> : <span />}
          {actions != null && (
            <div className="flex items-center gap-2">{actions}</div>
          )}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
