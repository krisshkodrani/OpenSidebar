import React from "react";

interface ErrorBannerProps {
  message: string;
  hint?: string;
  onRetry?: () => void;
}

export default function ErrorBanner({
  message,
  hint,
  onRetry,
}: ErrorBannerProps) {
  return (
    <div className="p-3 mx-5 my-4 bg-state-error/10 border border-state-error/30 rounded text-state-error text-[13px]">
      {message}
      {hint && (
        <div className="mt-2">
          {hint}
        </div>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 px-3 py-1 text-xs font-medium rounded border border-state-error/30 text-state-error hover:bg-state-error/20 transition-colors cursor-pointer"
        >
          Retry
        </button>
      )}
    </div>
  );
}
