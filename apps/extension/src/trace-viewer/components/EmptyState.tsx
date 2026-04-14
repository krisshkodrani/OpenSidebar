import React from "react";

interface EmptyStateProps {
  icon?: string;
  message: string;
  submessage?: string;
}

export default function EmptyState({
  icon,
  message,
  submessage,
}: EmptyStateProps) {
  return (
    <div className="flex items-center justify-center h-full text-trace-dim text-sm flex-col gap-2">
      {icon && <div className="text-4xl opacity-30">{icon}</div>}
      <div>{message}</div>
      {submessage && (
        <div className="text-[11px] text-[#4C3D80]">{submessage}</div>
      )}
    </div>
  );
}
