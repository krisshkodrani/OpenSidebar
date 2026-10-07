import { useEffect, type ReactNode } from "react";
import { PanelLeft } from "lucide-react";

/** Public transition screen: checking a session must not look like signing out. */
export function SessionFrame({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.title = "Workspace · OpenSidebar";
  }, []);
  return (
    <main className="os-session-frame">
      <div className="os-session-content">
        <div className="os-brand">
          <span className="os-brand-mark">
            <PanelLeft size={23} aria-hidden="true" />
          </span>
          OpenSidebar
        </div>
        {children}
      </div>
    </main>
  );
}
