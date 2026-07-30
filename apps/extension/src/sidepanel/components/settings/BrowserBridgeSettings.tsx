import React from "react";

import { uiRuntime } from "../../runtime";

const PORT_KEY = "opensidebar:browserMcpWsPort";
const TOKEN_KEY = "opensidebar:browserMcpAuthToken";

export function BrowserBridgeSettings() {
  const [pairingCode, setPairingCode] = React.useState("");
  const [status, setStatus] = React.useState<
    "loading" | "paired" | "disconnected" | "error"
  >("loading");
  const [message, setMessage] = React.useState("");

  React.useEffect(() => {
    let mounted = true;
    void uiRuntime.storage.local
      .get([PORT_KEY, TOKEN_KEY])
      .then((stored) => {
        if (!mounted) return;
        setStatus(
          stored[PORT_KEY] && typeof stored[TOKEN_KEY] === "string"
            ? "paired"
            : "disconnected",
        );
      })
      .catch(() => mounted && setStatus("error"));
    return () => {
      mounted = false;
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
    setStatus("paired");
    setMessage("Paired. The bridge reconnects automatically when Codex starts it.");
  };

  const disconnect = async () => {
    await uiRuntime.storage.local.remove([PORT_KEY, TOKEN_KEY]);
    setPairingCode("");
    setStatus("disconnected");
    setMessage("Disconnected and the extension-side token was removed.");
  };

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
      <p
        className={`text-xs ${
          status === "error"
            ? "text-red-600 dark:text-red-400"
            : "text-warm-400 dark:text-warm-500"
        }`}
      >
        {message ||
          (status === "paired"
            ? "Paired"
            : status === "loading"
              ? "Checking local pairing…"
              : "Not paired")}
      </p>
    </section>
  );
}
