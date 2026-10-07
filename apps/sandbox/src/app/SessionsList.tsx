import { ArrowRight } from "lucide-react";
import type { CloudSessionV1 } from "@opensidebar/shared-types";
import { ActionLink, EmptyState, StateBadge } from "./WorkspaceUi";
import { routes } from "./routes";
export function SessionsList({
  sessions,
  select,
  available = true,
}: {
  sessions: CloudSessionV1[];
  select?: (id: string) => void;
  available?: boolean;
}) {
  if (!available)
    return (
      <EmptyState title="Cloud sessions aren’t enabled">
        This account does not currently have access to cloud session history.
        Local runs remain available in your extension.
      </EmptyState>
    );
  if (!sessions.length)
    return (
      <EmptyState
        title="No cloud sessions yet"
        action={
          <ActionLink href={routes.connections}>
            Manage browser connections
          </ActionLink>
        }
      >
        Your synced browser sessions will appear here. Local-only runs stay in
        the extension.
      </EmptyState>
    );
  return (
    <div>
      {sessions.map((session) => (
        <a
          className="os-session-row"
          key={session.sessionId}
          href={`${routes.sessions}?session=${encodeURIComponent(session.sessionId)}`}
          onClick={(event) => {
            if (
              select &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.shiftKey &&
              event.button === 0
            ) {
              event.preventDefault();
              select(session.sessionId);
            }
          }}
        >
          <div>
            <div className="os-session-name">
              {session.title || "Untitled session"}
            </div>
            <div className="os-session-date">
              Updated {new Date(session.updatedAt).toLocaleString()}
            </div>
          </div>
          <div className="os-session-meta">
            <StateBadge
              tone={session.status === "active" ? "success" : "neutral"}
            >
              {session.status.replaceAll("_", " ")}
            </StateBadge>
            <span>
              {Math.round(session.sizeBytes / 1024).toLocaleString()} KB
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </div>
        </a>
      ))}
    </div>
  );
}
