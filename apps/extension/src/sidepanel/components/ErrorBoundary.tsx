import React from "react";
import { logger } from "../../utils";
import { uiRuntime } from "../runtime";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render errors in the side panel and shows a recovery UI
 * instead of a blank white screen.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error("ui", "React render error caught by ErrorBoundary", {
      error: error.message,
      stack: error.stack?.slice(0, 500),
      componentStack: info.componentStack?.slice(0, 500),
    });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleClearAndReset = () => {
    try {
      // Clear chat messages to remove the problematic data
      const keys: string[] = [];
      uiRuntime.storage.local
        .get(null)
        .then((data) => {
          for (const k of Object.keys(data)) {
            if (k === "chatMessages" || k.startsWith("chatMessages:")) {
              keys.push(k);
            }
          }
          if (keys.length > 0) void uiRuntime.storage.local.remove(keys);
        })
        .catch(() => {});
    } catch {
      // Best-effort cleanup
    }
    this.setState({ hasError: false, error: null });
    // Force full reload of the side panel
    globalThis.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-warm-50 dark:bg-warm-900">
        <div className="max-w-xs space-y-4">
          <div className="text-2xl">Something went wrong</div>
          <p className="text-sm text-warm-500 dark:text-warm-400">
            The side panel hit an unexpected error. You can try again or clear
            data and reload.
          </p>
          {this.state.error && (
            <pre className="text-xs text-left text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded p-2 overflow-auto max-h-24">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex gap-2 justify-center">
            <button
              onClick={this.handleReset}
              className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={this.handleClearAndReset}
              className="px-4 py-2 text-sm rounded-lg border border-warm-300 dark:border-warm-700 text-warm-600 dark:text-warm-300 hover:bg-warm-100 dark:hover:bg-warm-800 transition-colors"
            >
              Clear Data & Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
