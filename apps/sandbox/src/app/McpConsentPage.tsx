import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { AuthFrame } from "./AuthFrame";
import { ErrorState, LoadingState } from "./WorkspaceUi";
import { controlApi, sessionExpired } from "../control-api";
import { routes } from "./routes";

type Consent = {
  clientName: string;
  email: string;
  scopes: string[];
  redirectUri: string;
};
const scopeLabels: Record<string, string> = {
  "browser.tasks.interact": "Perform browser actions within your requested task, subject to local approval rules",
  "browser.devices.read": "See your linked browsers and whether they are ready",
  "browser.tasks.create": "Request a browser task",
  "browser.tasks.read": "Read task progress and results",
  "browser.tasks.continue": "Continue a task with your instructions",
  "browser.tasks.approve":
    "Respond to task approval requests, subject to local policy",
  "browser.tasks.cancel": "Cancel a task",
};
async function response<T>(r: Response): Promise<T> {
  if (r.status === 401) sessionExpired();
  const value = await r.json();
  if (!r.ok)
    throw new Error(
      value.message ??
        "Could not check this connection. Restart Connect from Codex and try again.",
    );
  return value as T;
}
export function McpConsentPage() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const query = location.search.slice(1);
  const consent = useQuery({
    queryKey: ["mcp-consent", query],
    retry: false,
    queryFn: () =>
      fetch(`/api/v1/mcp/consent?${query}`, {
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }).then(response<Consent>),
  });
  async function decide(decision: "allow" | "deny") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await controlApi.session();
      if (!session.authenticated || !session.csrfToken) {
        sessionExpired();
        return;
      }
      const result = await fetch("/api/v1/mcp/consent", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
        headers: {
          "content-type": "application/json",
          "x-os-csrf": session.csrfToken,
        },
        body: JSON.stringify({ query, decision }),
      }).then(response<{ redirect: string }>);
      const target = new URL(result.redirect);
      if (
        target.origin !== "http://localhost:1455" ||
        target.pathname !== "/auth/callback/3MqMAmAkMrwa"
      )
        throw new Error(
          "Unexpected callback. Restart the connection from Codex.",
        );
      location.assign(target.href);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not connect. Try again.",
      );
      setBusy(false);
    }
  }
  return (
    <AuthFrame title="Connect Codex">
      <div className="os-signin-form">
        <Link2 size={25} aria-hidden="true" />
        <h1>Connect Codex</h1>
        {consent.isPending ? (
          <LoadingState label="Checking your existing session…" />
        ) : consent.isError ? (
          <>
            <ErrorState
              error={consent.error}
              retry={() => void consent.refetch()}
            />
            <a href={routes.connections}>Back to connections</a>
          </>
        ) : (
          <>
            <p>
              You’re already signed in as <strong>{consent.data.email}</strong>.
              No new sign-in is needed.
            </p>
            <p>Allow Codex on this computer to:</p>
            <ul className="os-consent-scopes">
              {consent.data.scopes.map((s) => (
                <li key={s}>{scopeLabels[s] ?? s}</li>
              ))}
            </ul>
            <p className="os-muted">
              {consent.data.scopes.includes("browser.tasks.interact")
                ? "Interactive tasks can change website data within your request. Availability depends on your browser and rollout settings."
                : "This authorization permits read-only tasks."}
              {" "}Your browser’s local rules still apply. You can watch and stop tasks in OpenSidebar.
            </p>
            <p className="os-muted">
              This authorization lasts up to 30 days. Revoke it anytime in
              Connections. Your website session and browser link stay unchanged.
            </p>
            {error && (
              <p role="alert" className="os-error">
                {error}
              </p>
            )}
            <button
              className="os-button os-primary"
              disabled={busy}
              onClick={() => void decide("allow")}
            >
              {busy ? "Returning to Codex…" : "Allow Codex"}
            </button>
            <button
              className="os-button"
              disabled={busy}
              onClick={() => void decide("deny")}
            >
              Cancel
            </button>
            <p className="os-muted">
              Continue only if you started this connection in Codex. The
              response returns to localhost on this computer.
            </p>
          </>
        )}
      </div>
    </AuthFrame>
  );
}
