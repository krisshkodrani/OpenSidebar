import React from "react";

interface State {
  error: Error | null;
}

export default class ViewerErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center px-8">
          <div className="text-red-400 text-lg font-semibold">
            Something went wrong
          </div>
          <pre className="text-xs text-trace-muted bg-trace-panel border border-trace-border rounded p-4 max-w-xl overflow-auto whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 text-sm font-medium rounded bg-trace-accent text-white hover:bg-trace-accent-light transition-colors cursor-pointer"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
