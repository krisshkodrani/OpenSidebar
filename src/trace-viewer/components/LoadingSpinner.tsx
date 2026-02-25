import React from "react";

interface LoadingSpinnerProps {
  message?: string;
}

export default function LoadingSpinner({ message = "Loading..." }: LoadingSpinnerProps) {
  return (
    <div className="py-10 px-4 text-center text-trace-muted text-[13px]">
      <div className="inline-block w-5 h-5 border-2 border-trace-border border-t-trace-accent rounded-full animate-spin-slow mb-2" />
      <div>{message}</div>
    </div>
  );
}
