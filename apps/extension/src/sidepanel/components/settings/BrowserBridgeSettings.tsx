import React from "react";

import { uiRuntime } from "../../runtime";

const PORT_KEY = "opensidebar:browserMcpWsPort";
const TOKEN_KEY = "opensidebar:browserMcpAuthToken";
const CONNECTION_STATE_KEY = "opensidebar:browserMcpConnectionState";

type BridgeStatus =
  | "loading"
  | "connected"
  | "connecting"
  | "reconnecting"
  | "paired-offline"
  | "disconnected"
  | "error";

type StoredConnectionState = {
  state?:
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected"
    | "unpaired";
};

function resolveBridgeStatus(stored: Record<string, unknown>): BridgeStatus {
  const isPaired =
    Boolean(stored[PORT_KEY]) && typeof stored[TOKEN_KEY] === "string";
  if (!isPaired) return "disconnected";

  const liveState = (stored[CONNECTION_STATE_KEY] as StoredConnectionState)
    ?.state;
  if (liveState === "connected") return "connected";
  if (liveState === "connecting") return "connecting";
  if (liveState === "reconnecting") return "reconnecting";
  return "paired-offline";
}

export function BrowserBridgeSettings() {
  const [pairingCode, setPairingCode] = React.useState("");
  const [status, setStatus] = React.useState<BridgeStatus>("loading");
  const [message, setMessage] = React.useState("");

  React.useEffect(() => {
    let mounted = true;
    const readStatus = async () => {
      try {
        const stored = await uiRuntime.storage.local.get([
          PORT_KEY,
          TOKEN_KEY,
          CONNECTION_STATE_KEY,
        ]);
        if (mounted) setStatus(resolveBridgeStatus(stored));
      } catch {
        if (mounted) setStatus("error");
      }
    };

    void readStatus();
    const interval = window.setInterval(() => void readStatus(), 1_000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const pair = async () => {
    const separator = pairingCode.indexOf(":");
    const port = Number(pairingCode.slice(0, separator));
    const token = pairingCode.slice(separator + 1).trim();
    if (
      separator < 1 ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535 ||
      token.length < 32
    ) {
      setStatus("error");
      setMessage("Use the exact port:token code printed by bridge:install.");
      return;
    }
    await uiRuntime.storage.local.set({
      [PORT_KEY]: port,
      [TOKEN_KEY]: token,
    });
    setPairingCode("");
    setStatus("connecting");
    setMessage("Pairing saved. Connecting to Codex…");
  };

  const disconnect = async () => {
    await uiRuntime.storage.local.remove([PORT_KEY, TOKEN_KEY]);
    setPairingCode("");
    setStatus("disconnected");
    setMessage("Disconnected and the extension-side token was removed.");
  };

  const isLive = status === "connected";
  const isTrying = status === "connecting" || status === "reconnecting";

  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
          Codex browser bridge
        </h4>
        <p className="mt-1 text-xs text-warm-400 dark:text-warm-500">
          Localhost-only, mutually authenticated, and disabled until paired.
        </p>
      </div>

      <div
        aria-live="polite"
        className={`flex items-center gap-3 rounded-lg border px-3 py-3 ${
          isLive
            ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40"
            : isTrying
              ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
              : "border-warm-300 bg-warm-50 dark:border-warm-700 dark:bg-warm-900"
        }`}
      >
        <span className="relative flex h-4 w-4 shrink-0" aria-hidden="true">
          {(isLive || isTrying) && (
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 ${
                isLive ? "bg-emerald-400" : "bg-amber-400"
              }`}
            />
          )}
          <span
            className={`relative inline-flex h-4 w-4 rounded-full ${
              isLive
                ? "bg-emerald-500"
                : isTrying
                  ? "bg-amber-500"
                  : status === "error"
                    ? "bg-red-500"
                    : "bg-warm-400"
            }`}
          />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-warm-900 dark:text-warm-100">
            {isLive
              ? "Connected to Codex"
              : status === "connecting"
                ? "Connecting to Codex"
                : status === "reconnecting"
                  ? "Reconnecting to Codex"
                  : status === "paired-offline"
                    ? "Paired · Codex offline"
                    : status === "loading"
                      ? "Checking bridge"
                      : status === "error"
                        ? "Bridge status unavailable"
                        : "Not paired"}
          </p>
          <p className="mt-0.5 text-xs text-warm-500">
            {isLive
              ? "Ready for delegated browser tasks."
              : status === "paired-offline"
                ? "Pairing is saved, but there is no live bridge connection."
                : isTrying
                  ? "The extension will reconnect automatically."
                  : "Pair this extension to enable Codex browser control."}
          </p>
        </div>
      </div>

      <input
        aria-label="Browser bridge pairing code"
        autoComplete="off"
        className="w-full rounded border border-warm-300 bg-warm-50 px-2 py-1.5 text-sm outline-none dark:border-warm-700 dark:bg-warm-900 dark:text-warm-100"
        onChange={(event) => setPairingCode(event.target.value)}
        placeholder="port:pairing-token"
        type="password"
        value={pairingCode}
      />
      <div className="flex gap-2">
        <button
          className="rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          disabled={!pairingCode}
          onClick={() => void pair()}
          type="button"
        >
          Pair
        </button>
        <button
          className="rounded border border-warm-300 px-3 py-1.5 text-xs dark:border-warm-700 dark:text-warm-200"
          onClick={() => void disconnect()}
          type="button"
        >
          Disconnect
        </button>
      </div>
      {message && (
        <p
          className={`text-xs ${
            status === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-warm-400 dark:text-warm-500"
          }`}
        >
          {message}
        </p>
      )}
    </section>
  );
}
