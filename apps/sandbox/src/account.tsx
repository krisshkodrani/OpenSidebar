import { Activity, Radio, ShieldCheck } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountApi } from "./account-api";
import { AppShell } from "./app/AppShell";
import { AccountMenu } from "./app/AccountMenu";
import {
  ErrorState,
  LoadingState,
  PageHeader,
  StateBadge,
} from "./app/WorkspaceUi";
import { SettingsNavigation } from "./app/SettingsNavigation";
import { routes } from "./app/routes";
import { PreferencesSection } from "./app/settings/PreferencesSection";
import { ProvidersSection } from "./app/settings/ProvidersSection";
import { ConnectionsSection } from "./app/settings/ConnectionsSection";

export function AccountPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["cloud-account"],
    queryFn: async () => {
      const [account, devices, credentials, usage, preferences, remoteWork] =
        await Promise.all([
          accountApi.account(),
          accountApi.devices(),
          accountApi.credentials(),
          accountApi.usage(),
          accountApi.preferences(),
          accountApi.remoteWork(),
        ]);
      return { account, devices, credentials, usage, preferences, remoteWork };
    },
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (operation: () => Promise<unknown>) => operation(),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["cloud-account"] }),
        client.invalidateQueries({ queryKey: ["cloud-dashboard"] }),
      ]);
    },
  });
  const act = (operation: () => Promise<unknown>) => mutation.mutate(operation);
  const data = query.data;
  const section = location.pathname;
  return (
    <AppShell>
      <PageHeader
        title="Settings"
        description="Manage your preferences, browser connections, and account access."
      />
      <SettingsNavigation />
      {query.isPending ? (
        <LoadingState label="Loading account settings…" />
      ) : !data ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {query.error && <ErrorState error={query.error} retry={() => void query.refetch()} />}
          {mutation.isPending && <LoadingState inline label="Applying change…" />}
          {mutation.isError && (
            <div className="os-feedback os-feedback-error" role="alert">
              {mutation.error instanceof Error
                ? mutation.error.message
                : "Could not save the change. Please try again."}
            </div>
          )}
          {mutation.isSuccess && (
            <div className="os-feedback" role="status">
              Change saved.
            </div>
          )}
          {section === routes.settings && (
            <>
              <section className="os-panel">
                <div className="os-panel-heading">
                  <h2 className="os-section-title">
                    <Activity size={18} aria-hidden="true" />
                    Monthly account usage
                  </h2>
                  <StateBadge>Current billing period</StateBadge>
                </div>
                <div className="os-usage-grid">
                  <div>
                    <span>AI requests</span>
                    <strong>
                      {data.usage.requests.toLocaleString()}{" "}
                      <small>
                        / {data.usage.limits.requests.toLocaleString()}
                      </small>
                    </strong>
                  </div>
                  <div>
                    <span>Tokens</span>
                    <strong>
                      {(
                        data.usage.inputTokens + data.usage.outputTokens
                      ).toLocaleString()}{" "}
                      <small>
                        / {data.usage.limits.tokens.toLocaleString()}
                      </small>
                    </strong>
                  </div>
                  <div>
                    <span>Active streams</span>
                    <strong>{data.usage.concurrentStreams}</strong>
                  </div>
                </div>
              </section>
              <PreferencesSection
                preferences={data.preferences}
                busy={mutation.isPending}
                save={(value, expected) =>
                  act(() => accountApi.savePreferences(value, expected))
                }
              />
            </>
          )}
          {section === routes.providers && (
            <ProvidersSection
              credentials={data.credentials}
              busy={mutation.isPending}
              act={act}
            />
          )}
          {section === routes.connections && (
            <ConnectionsSection
              devices={data.devices}
              busy={mutation.isPending}
              act={act}
              remoteEnabled={data.remoteWork.enabled}
              refreshing={query.isFetching}
              refresh={() => void query.refetch()}
            />
          )}
          {section === routes.security && (
            <div className="os-settings-stack">
              <section className="os-panel os-panel-body">
                <h2 className="os-section-title" style={{ fontSize: 17 }}>
                  <ShieldCheck size={18} aria-hidden="true" />
                  Browser sign-in
                </h2>
                <p className="os-muted" style={{ fontSize: 13, marginTop: 10 }}>
                  Sign out of this website on this browser. Manage extension and
                  integration sessions separately in Connections.
                </p>
                <div style={{ maxWidth: 360 }}>
                  <AccountMenu />
                </div>
              </section>
              <section className="os-panel">
                <div className="os-panel-heading">
                  <div>
                    <h2 className="os-section-title">
                      <Radio size={18} aria-hidden="true" />
                      Remote browser work
                    </h2>
                    <p>
                      Control whether authorized integrations can send tasks to
                      your browsers.
                    </p>
                  </div>
                  <StateBadge
                    tone={data.remoteWork.enabled ? "success" : "neutral"}
                  >
                    {data.remoteWork.enabled ? "Enabled" : "Disabled"}
                  </StateBadge>
                </div>
                <div className="os-panel-body">
                  <p
                    className="os-muted"
                    style={{ fontSize: 13, marginBottom: 18 }}
                  >
                    Tasks remain visible and cancellable in the linked browser.
                    Local permissions and approval rules still apply. Turning
                    this off does not stop ordinary local OpenSidebar tasks.
                  </p>
                  <button
                    className={`os-button ${data.remoteWork.enabled ? "os-danger-button" : "os-primary"}`}
                    disabled={mutation.isPending}
                    onClick={() => {
                      if (
                        data.remoteWork.enabled ||
                        window.confirm(
                          "Allow authorized integrations to send visible, cancellable tasks to your linked browsers? Local approval rules still apply.",
                        )
                      )
                        act(() =>
                          accountApi.saveRemoteWork(
                            !data.remoteWork.enabled,
                            data.remoteWork.revision,
                          ),
                        );
                    }}
                  >
                    {data.remoteWork.enabled
                      ? "Disable remote work"
                      : "Enable remote work"}
                  </button>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
