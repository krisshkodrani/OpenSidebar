import React from "react";
import { useStore } from "./store";
import TabBar from "./components/TabBar";
import TracesTab from "./components/traces/TracesTab";

export default function App() {
  const activeTab = useStore((s) => s.activeTab);
  const tabInitialized = useStore((s) => s.tabInitialized);
  const markTabInitialized = useStore((s) => s.markTabInitialized);

  // Track which tabs have been activated (lazy init)
  if (!tabInitialized[activeTab]) {
    markTabInitialized(activeTab);
  }

  return (
    <div className="flex flex-col h-screen bg-trace-bg text-trace-text font-sans overflow-hidden">
      <TabBar />
      {activeTab === "traces" && <TracesTab />}
    </div>
  );
}
