import { useDraftWarning } from "../draft-warning";
import { useEffect, useState } from "react";
import { Copy, Laptop, Link2, Plus } from "lucide-react";
import type { CloudDeviceV1 } from "@opensidebar/shared-types";
import { accountApi } from "../../account-api";
import { EmptyState, StateBadge } from "../WorkspaceUi";
import { browserReadiness } from "./connection-readiness";
import { CodexConnection } from "./CodexConnection";
export function ConnectionsSection({
  devices,
  busy,
  act,
  remoteEnabled,
  refreshing,
  refresh,
}: {
  devices: CloudDeviceV1[];
  busy: boolean;
  act: (operation: () => Promise<unknown>) => void;
  remoteEnabled: boolean;
  refreshing: boolean;
  refresh: () => void;
}) {
  const [link, setLink] = useState<{ code: string; expiresAt: number } | null>(
    null,
  );
  const [clock, setClock] = useState(Date.now());
  const [names, setNames] = useState<Record<string, string>>({});
  useDraftWarning(
    devices.some(
      (device) =>
        names[device.id] !== undefined &&
        names[device.id] !== device.displayName,
    ),
  );
  const [copyMessage, setCopyMessage] = useState("");
  useEffect(() => {
    if (!link) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [link]);
  const browsers = devices.filter(
    (d) => d.connectionKind === "browser_extension" && !d.revokedAt,
  );
  const integrations = devices.filter(
    (d) => d.connectionKind === "codex_integration" && !d.revokedAt,
  );
  const history = devices.filter(
    (d) => Boolean(d.revokedAt) || d.connectionKind === "test_client",
  );
  const remaining = link
    ? Math.max(0, Math.ceil((link.expiresAt - clock) / 1000))
    : 0;
  return (
    <div className="os-settings-stack">
      <CodexConnection
        authorized={integrations.length > 0}
        remoteEnabled={remoteEnabled}
        refreshing={refreshing}
        refresh={refresh}
      />
      <section className="os-panel">
        <div className="os-panel-heading">
          <div>
            <h2 className="os-section-title">
              <Link2 size={18} aria-hidden="true" />
              Link a browser
            </h2>
            <p>Connect an installed OpenSidebar extension to this account.</p>
          </div>
        </div>
        <div className="os-panel-body">
          <ol className="os-link-steps">
            <li>Generate a single-use link code below.</li>
            <li>
              In the extension, open <strong>Settings → Account</strong>.
            </li>
            <li>
              Choose <strong>Use a link code instead</strong> and enter the
              code.
            </li>
          </ol>
          {link && (
            <div className="os-link-code">
              <code>{remaining ? link.code : "Code expired"}</code>
              {remaining > 0 && (
                <button
                  className="os-icon-button"
                  aria-label="Copy link code"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(link.code)
                      .then(() => setCopyMessage("Code copied."))
                      .catch(() =>
                        setCopyMessage(
                          "Could not copy. Select the code and copy it manually.",
                        ),
                      )
                  }
                >
                  <Copy size={16} />
                </button>
              )}
              <span>
                {remaining
                  ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
                  : "Generate a new code to continue."}
              </span>
            </div>
          )}
          <div style={{ marginTop: 18 }}>
            <button
              className="os-button os-primary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const result = await accountApi.linkCode();
                  setLink({
                    code: result.code,
                    expiresAt: Date.now() + result.expiresInSeconds * 1000,
                  });
                  setClock(Date.now());
                  setCopyMessage("");
                })
              }
            >
              <Plus size={16} aria-hidden="true" />
              {link ? "Generate a new code" : "Generate link code"}
            </button>
          </div>
          {copyMessage && (
            <p
              role="status"
              className="os-muted"
              style={{ fontSize: 12, marginTop: 10 }}
            >
              {copyMessage}
            </p>
          )}
        </div>
      </section>
      <section className="os-panel">
        <div className="os-panel-heading">
          <div>
            <h2 className="os-section-title">
              <Laptop size={18} aria-hidden="true" />
              Connected browsers
            </h2>
            <p>Rename a browser or revoke access to your account.</p>
          </div>
          <StateBadge>{browsers.length}</StateBadge>
        </div>
        {!browsers.length ? (
          <EmptyState title="No browsers linked">
            Use a link code to connect your first OpenSidebar extension.
          </EmptyState>
        ) : (
          browsers.map((device) => (
            <div className="os-device-row" key={device.id}>
              <div className="os-provider-heading">
                <div>
                  <h3>{device.displayName}</h3>
                  <p>
                    Version {device.extensionVersion} · last seen{" "}
                    {new Date(device.lastSeenAt).toLocaleString()}
                  </p>
                </div>
                <StateBadge
                  tone={
                    device.availability === "online" ? "success" : "neutral"
                  }
                >
                  {device.availability}
                </StateBadge>
              </div>
              <div className="os-panel-body">
                <strong>{browserReadiness(device, remoteEnabled).label}</strong>
                <p className="os-muted">
                  {browserReadiness(device, remoteEnabled).detail}
                </p>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  act(() =>
                    accountApi.renameDevice(
                      device,
                      (names[device.id] ?? device.displayName).trim(),
                    ),
                  );
                }}
              >
                <label htmlFor={`device-${device.id}`}>Browser name</label>
                <div className="os-inline-form">
                  <input
                    id={`device-${device.id}`}
                    maxLength={80}
                    value={names[device.id] ?? device.displayName}
                    onChange={(event) =>
                      setNames((current) => ({
                        ...current,
                        [device.id]: event.target.value,
                      }))
                    }
                  />
                  <button
                    className="os-button"
                    type="submit"
                    disabled={
                      busy ||
                      !(names[device.id] ?? "").trim() ||
                      names[device.id]?.trim() === device.displayName
                    }
                  >
                    Rename
                  </button>
                  <button
                    className="os-button os-danger-button"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Revoke access for ${device.displayName}? You will need to link it again to reconnect.`,
                        )
                      )
                        act(() => accountApi.revokeDevice(device.id));
                    }}
                  >
                    Revoke access
                  </button>
                </div>
              </form>
            </div>
          ))
        )}
      </section>
      <section className="os-panel">
        <div className="os-panel-heading">
          <h2>Connected integrations</h2>
          <StateBadge>{integrations.length}</StateBadge>
        </div>
        {!integrations.length ? (
          <div className="os-panel-body os-muted">
            No integrations connected.
          </div>
        ) : (
          integrations.map((device) => (
            <div className="os-device-row" key={device.id}>
              <div className="os-provider-heading">
                <div>
                  <h3>{device.displayName}</h3>
                  <p>
                    Authorization saved · last used{" "}
                    {new Date(device.lastSeenAt).toLocaleString()}
                  </p>
                </div>
                <button
                  className="os-button os-danger-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Revoke ${device.displayName}?`))
                      act(() => accountApi.revokeDevice(device.id));
                  }}
                >
                  Revoke access
                </button>
              </div>
            </div>
          ))
        )}
      </section>
      <section className="os-panel os-panel-body">
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>
          Sign out linked device sessions
        </h2>
        <p className="os-muted" style={{ fontSize: 13, marginBottom: 16 }}>
          End active extension and integration sessions. This website stays
          signed in. Device records remain in your account.
        </p>
        <button
          className="os-button os-danger-button"
          disabled={busy || browsers.length + integrations.length === 0}
          onClick={() => {
            if (
              window.confirm(
                "Sign out all extension and integration sessions? Devices will need to authenticate again.",
              )
            )
              act(accountApi.logoutAll);
          }}
        >
          Sign out all device sessions
        </button>
      </section>
      <details className="os-panel os-panel-body">
        <summary>
          Connection history{" "}
          <span className="os-muted">({history.length})</span>
        </summary>
        <p className="os-muted" style={{ fontSize: 12, marginTop: 12 }}>
          Revoked connections and development test records.
        </p>
        {!history.length ? (
          <p className="os-muted" style={{ marginTop: 12 }}>
            No historical connections.
          </p>
        ) : (
          history.map((device) => (
            <div className="os-history-row" key={device.id}>
              <div>
                <strong>{device.displayName}</strong>
                <p className="os-muted">
                  Last seen {new Date(device.lastSeenAt).toLocaleString()}
                </p>
              </div>
              <StateBadge>
                {device.revokedAt ? "Revoked" : "Test connection"}
              </StateBadge>
              {!device.revokedAt && (
                <button
                  className="os-button"
                  disabled={busy}
                  onClick={() => act(() => accountApi.revokeDevice(device.id))}
                >
                  Revoke
                </button>
              )}
            </div>
          ))
        )}
      </details>
    </div>
  );
}
