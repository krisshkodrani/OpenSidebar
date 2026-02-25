import React from "react";

interface ErrorBannerProps {
  message: string;
  hint?: string;
}

export default function ErrorBanner({ message, hint }: ErrorBannerProps) {
  return (
    <div className="p-3 mx-5 my-4 bg-red-500/10 border border-red-500/30 rounded-[5px] text-[#e74c3c] text-[13px]">
      {message}
      {hint && (
        <div className="mt-2">
          Make sure the log server is running:{" "}
          <code className="text-trace-accent-light">bun run logs</code>
        </div>
      )}
    </div>
  );
}
