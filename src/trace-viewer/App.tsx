import React, { useEffect } from "react";
import { useStore } from "./store";
import TabBar from "./components/TabBar";
import SessionsTab from "./components/traces/SessionsTab";
import TraceViewTab from "./components/traces/TraceViewTab";
import ViewerErrorBoundary from "./components/ViewerErrorBoundary";

function parseHash(): { session?: string; view?: string } {
  const hash = window.location.hash.slice(1);
  if (!hash) return {};
  const params = new URLSearchParams(hash);
  return {
    session: params.get("session") || undefined,
    view: params.get("view") || undefined,
  };
}

const VALID_SUBVIEWS = new Set(["turns", "perception", "logs", "story"]);

export default function App() {
  const activeTab = useStore((s) => s.activeTab);
  const tabInitialized = useStore((s) => s.tabInitialized);
  const markTabInitialized = useStore((s) => s.markTabInitialized);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const activeSubview = useStore((s) => s.activeSubview);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const setActiveTab = useStore((s) => s.setActiveTab);

  // On mount, restore state from URL hash
  useEffect(() => {
    const { session, view } = parseHash();
    if (session) {
      setCurrentSessionId(session);
      setActiveTab("trace");
    }
    if (view && VALID_SUBVIEWS.has(view))
      setActiveSubview(view as "turns" | "perception" | "logs" | "story");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync store changes to URL hash
  useEffect(() => {
    const parts: string[] = [];
    if (currentSessionId) parts.push(`session=${currentSessionId}`);
    if (activeSubview && activeSubview !== "turns")
      parts.push(`view=${activeSubview}`);
    const newHash = parts.length > 0 ? `#${parts.join("&")}` : "";
    if (window.location.hash !== newHash) {
      window.history.replaceState(
        null,
        "",
        newHash || window.location.pathname,
      );
    }
  }, [currentSessionId, activeSubview]);

  // Track which tabs have been activated (lazy init)
  if (!tabInitialized[activeTab]) {
    markTabInitialized(activeTab);
  }

  return (
    <div className="viewer-shell flex flex-col h-screen text-trace-text font-sans overflow-hidden">
      <TabBar />
      <ViewerErrorBoundary>
        {activeTab === "sessions" && <SessionsTab />}
        {activeTab === "trace" && <TraceViewTab />}
      </ViewerErrorBoundary>
    </div>
  );
}
