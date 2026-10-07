import { useEffect, useRef } from "react";
import { RefreshCw, ShieldCheck, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { accountApi } from "../account-api";
import { AppShell } from "./AppShell";
import { SessionsList } from "./SessionsList";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "./WorkspaceUi";
import { useUrlSelection } from "./use-url-selection";

export function SessionsPage() {
  const [selected, setSelected] = useUrlSelection("session");
  const summary = useQuery({
    queryKey: ["cloud-dashboard"],
    queryFn: accountApi.dashboard,
    retry: false,
  });
  const timeline = useQuery({
    queryKey: ["cloud-session-timeline", selected],
    queryFn: () => accountApi.sessionTimeline(selected!),
    enabled: Boolean(selected),
    retry: false,
  });
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => setSelected(null);
  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [selected]);
  const current = summary.data?.sessions.recent.find(
    (item) => item.sessionId === selected,
  );
  return (
    <AppShell>
      <PageHeader
        title="Sessions"
        description="Review recent browser activity and follow each session’s progress."
        actions={
          <button
            className="os-button"
            onClick={() => void summary.refetch()}
            disabled={summary.isFetching}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </button>
        }
      />
      <section className="os-panel">
        <div className="os-panel-heading">
          <h2>Recent sessions</h2>
          <span className="os-muted">
            {summary.data?.sessions.recent.length ?? "—"}
          </span>
        </div>
        {summary.isPending ? (
          <LoadingState />
        ) : summary.error || !summary.data ? (
          <ErrorState
            error={summary.error}
            retry={() => void summary.refetch()}
          />
        ) : (
          <SessionsList
            sessions={summary.data.sessions.recent}
            available={
              summary.data.sessions.enabled && summary.data.sessions.authorized
            }
            select={setSelected}
          />
        )}
      </section>
      {selected && (
        <dialog
          ref={dialog}
          className="os-dialog"
          aria-labelledby="session-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <div className="os-dialog-header">
            <div>
              <p className="os-muted" style={{ fontSize: 12, marginBottom: 6 }}>
                Session details
              </p>
              <h2 id="session-title">{current?.title ?? "Session timeline"}</h2>
            </div>
            <button
              className="os-icon-button"
              aria-label="Close session details"
              autoFocus
              onClick={close}
            >
              <X size={18} />
            </button>
          </div>
          {timeline.isPending ? (
            <LoadingState label="Loading session timeline…" />
          ) : timeline.error ? (
            <ErrorState
              error={timeline.error}
              retry={() => void timeline.refetch()}
            />
          ) : timeline.data?.events.length ? (
            <ol className="os-timeline">
              {timeline.data.events.map((event) => (
                <li key={event.id}>
                  <strong>{event.label}</strong>
                  <p>{event.detail}</p>
                  <time>{new Date(event.occurredAt).toLocaleString()}</time>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="No timeline events yet">
              Events will appear here as this session is synced.
            </EmptyState>
          )}
          <div className="os-panel os-panel-body">
            <ShieldCheck size={20} aria-hidden="true" />
            <h3 style={{ margin: "10px 0 6px", fontSize: 14 }}>
              Detailed traces stay on your device
            </h3>
            <p className="os-muted" style={{ fontSize: 12 }}>
              Open the extension’s Trace Viewer on the browser that ran this
              session to inspect detailed local activity.
            </p>
          </div>
        </dialog>
      )}
    </AppShell>
  );
}
