import { useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { routes } from "../routes";

const checkPrompt =
  "Use my existing OpenSidebar MCP connection. Call browser_list_devices and report which linked browsers are online and ready for remote work. Do not start a task or change settings.";

export function CodexConnection({
  authorized,
  remoteEnabled,
  refreshing,
  refresh,
}: {
  authorized: boolean;
  remoteEnabled: boolean;
  refreshing: boolean;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState("");
  async function copy(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback(success);
    } catch {
      setFeedback(
        "Could not copy. Select the text below and copy it manually.",
      );
    }
  }
  return (
    <section className="os-panel">
      <div className="os-panel-heading">
        <div>
          <h2>Use your browser from Codex</h2>
          <p>
            Keep the browser open. OpenSidebar carries out remote tasks there,
            with visible progress and a local stop control.
          </p>
        </div>
        <button className="os-button" disabled={refreshing} onClick={refresh}>
          <RefreshCw size={16} aria-hidden="true" />
          {refreshing ? "Checking…" : "Refresh status"}
        </button>
      </div>
      <div className="os-panel-body">
        <p>
          {authorized
            ? "Codex authorization is saved for this account. Check the connection from the Codex client you are using."
            : "Connect OpenSidebar in your Codex client, then check that it can see your linked browser."}
        </p>
        <p className="os-muted">
          A saved authorization is not a live connection check. Another computer
          or a new client needs its own authorization. A browser link code connects
          the extension, not Codex.
        </p>
        {!remoteEnabled && (
          <p>
            Remote browser work is off.{" "}
            <a href={routes.security}>Review remote-work permissions</a>.
          </p>
        )}
        <div className="os-inline-form">
          <a className="os-button" href="/connect/mcp">Set up Codex</a>
          <button
            className="os-button os-primary"
            onClick={() =>
              void copy(
                checkPrompt,
                "Connection-check prompt copied. Paste it into Codex.",
              )
            }
          >
            <Copy size={16} aria-hidden="true" />
            Copy connection check
          </button>
        </div>
        <details>
          <summary>Connection check and setup details</summary>
          <p><a href="/connect/mcp">Read the complete MCP setup guide</a></p>
          <p>{checkPrompt}</p>
          <p>In your Codex MCP settings, use this server URL:</p>
          <code>https://opensidebar.com/mcp</code>
          <p>
            The setup guide includes the public Codex configuration. Authorize
            Codex through your existing OpenSidebar website session. Your
            extension link code is not an MCP credential.
          </p>
          <p>
            After connecting, open a new Codex conversation if OpenSidebar tools
            are not available in the current one. Verify the browser name before
            starting work.
          </p>
          <p>
            Remote tasks currently support reading and reviewing pages. Use the
            extension directly for actions such as sending a message or
            uploading a file.
          </p>
        </details>
        <p role="status" aria-live="polite" className="os-muted">
          {feedback}
        </p>
      </div>
    </section>
  );
}
