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
    <div className="p-3 mx-5 my-4 bg-red-500/10 border border-red-500/30 rounded text-[#e74c3c] text-[13px]">
      {message}
      {hint && (
        <div className="mt-2">
          Make sure the log server is running:{" "}
          <code className="text-trace-accent-light">npm run logs</code>
        </div>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 px-3 py-1 text-xs font-medium rounded border border-red-500/30 text-[#e74c3c] hover:bg-red-500/20 transition-colors cursor-pointer"
        >
          Retry
        </button>
      )}
    </div>
  );
}
