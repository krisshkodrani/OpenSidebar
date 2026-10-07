import {
  ArrowRight,
  Check,
  CircleGauge,
  FlaskConical,
  KeyRound,
  Laptop,
  PlugZap,
  RefreshCw,
  SearchCode,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { accountApi } from "./account-api";
import { AppShell } from "./app/AppShell";
import {
  ActionLink,
  ErrorState,
  LoadingState,
  LoadingSpinner,
  PageHeader,
  StateBadge,
} from "./app/WorkspaceUi";
import { SessionsList } from "./app/SessionsList";
import { routes } from "./app/routes";

export function DashboardPage() {
  const query = useQuery({
    queryKey: ["cloud-dashboard"],
    queryFn: accountApi.dashboard,
    retry: false,
  });
  const data = query.data;
  const browsers =
    data?.devices.filter(
      (device) =>
        device.connectionKind === "browser_extension" && !device.revokedAt,
    ) ?? [];
  const providers = data?.credentials.filter((item) => item.configured) ?? [];
  const verifiedProvider = providers.find(
    (item) => item.verification === "valid",
  );
  const setup = [
    {
      title: "Connect your browser",
      description:
        "Link the OpenSidebar extension to bring your browser into this workspace.",
      done: browsers.length > 0,
      href: routes.connections,
      action: "Manage connections",
    },
    {
      title: "Choose a provider connection",
      description:
        "Use your own provider key for account-based AI requests. Direct browser mode can also use a key stored in the extension.",
      done: Boolean(verifiedProvider),
      href: routes.providers,
      action: "Manage providers",
    },
    {
      title: "Make it yours",
      description:
        "Review your synced preferences and choose how you want the agent to work.",
      done: Boolean(data?.preferences),
      href: routes.settings,
      action: "Review preferences",
    },
  ];
  return (
    <AppShell>
      <PageHeader
        title="Overview"
        eyebrow="Your workspace"
        description="Your browser connections, activity, and account controls in one place."
        actions={
          <button
            className="os-button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            aria-busy={query.isFetching}
          >
            {query.isFetching ? <LoadingSpinner /> : <RefreshCw size={15} aria-hidden="true" />}
            Refresh
          </button>
        }
      />
      {query.isPending ? (
        <LoadingState />
      ) : !data ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {query.error && <ErrorState error={query.error} retry={() => void query.refetch()} />}
          <div className="os-stat-grid">
            <section className="os-panel os-stat">
              <div className="os-stat-label">
                <Laptop size={16} aria-hidden="true" />
                Connected browsers
              </div>
              <div className="os-stat-value">{browsers.length}</div>
              <p className="os-stat-note">
                {
                  browsers.filter((item) => item.availability === "online")
                    .length
                }{" "}
                online right now
              </p>
              <ActionLink href={routes.connections}>Manage devices</ActionLink>
            </section>
            <section className="os-panel os-stat">
              <div className="os-stat-label">
                <PlugZap size={16} aria-hidden="true" />
                Account provider
              </div>
              <div
                className="os-stat-value"
                style={{ textTransform: "capitalize" }}
              >
                {verifiedProvider?.provider ??
                  (providers.length ? "Needs verification" : "Not connected")}
              </div>
              <p className="os-stat-note">
                {verifiedProvider
                  ? "Connection verified"
                  : "Direct browser keys stay in the extension"}
              </p>
              <ActionLink href={routes.providers}>Provider settings</ActionLink>
            </section>
            <section className="os-panel os-stat">
              <div className="os-stat-label">
                <CircleGauge size={16} aria-hidden="true" />
                Monthly AI requests
              </div>
              <div className="os-stat-value">
                {data.usage.requests.toLocaleString()}
              </div>
              <p className="os-stat-note">
                of {data.usage.limits.requests.toLocaleString()} account
                requests this month
              </p>
              <ActionLink href={routes.settings}>
                Usage & preferences
              </ActionLink>
            </section>
          </div>
          <div className="os-overview-grid">
            <section className="os-panel">
              <div className="os-panel-heading">
                <div>
                  <h2>Your workspace setup</h2>
                  <p>Connect the pieces you want to use.</p>
                </div>
                <StateBadge>
                  {setup.filter((item) => item.done).length} of 3 ready
                </StateBadge>
              </div>
              <ol className="os-checklist">
                {setup.map((item, index) => (
                  <li key={item.title}>
                    <span
                      className={`os-check-icon ${item.done ? "is-done" : ""}`}
                    >
                      {item.done ? (
                        <Check size={15} aria-label="Configured" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                      <ActionLink href={item.href}>{item.action}</ActionLink>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <section className="os-panel">
              <div className="os-panel-heading">
                <h2>Explore your workspace</h2>
              </div>
              <a className="os-shortcut" href={routes.playground}>
                <FlaskConical aria-hidden="true" />
                <div>
                  <strong>Try the playground</strong>
                  <span>Controlled scenarios for browser tasks</span>
                </div>
                <ArrowRight size={16} aria-hidden="true" />
              </a>
              <a className="os-shortcut" href={routes.viewer}>
                <SearchCode aria-hidden="true" />
                <div>
                  <strong>Review an agent run</strong>
                  <span>Import and inspect an exported trace</span>
                </div>
                <ArrowRight size={16} aria-hidden="true" />
              </a>
              <a className="os-shortcut" href={routes.security}>
                <KeyRound aria-hidden="true" />
                <div>
                  <strong>Manage account access</strong>
                  <span>Remote work and browser sign-in</span>
                </div>
                <ArrowRight size={16} aria-hidden="true" />
              </a>
              <div className="os-panel-body">
                <StateBadge
                  tone={data.account.cloudAccess ? "success" : "neutral"}
                >
                  {data.account.cloudAccess
                    ? "Cloud access available"
                    : "Cloud access unavailable"}
                </StateBadge>
                <p className="os-muted" style={{ fontSize: 12, marginTop: 12 }}>
                  Your browser remains in control. Account settings do not
                  override its local permissions or approval rules.
                </p>
              </div>
            </section>
          </div>
          <section className="os-panel">
            <div className="os-panel-heading">
              <h2>Recent activity</h2>
              <ActionLink href={routes.sessions}>View sessions</ActionLink>
            </div>
            <SessionsList
              sessions={data.sessions.recent.slice(0, 5)}
              available={data.sessions.enabled && data.sessions.authorized}
            />
          </section>
        </>
      )}
    </AppShell>
  );
}
