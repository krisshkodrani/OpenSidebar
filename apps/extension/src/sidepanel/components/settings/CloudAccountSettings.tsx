import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Link2, LogOut } from "lucide-react";
import type { UserSettings } from "../../../types";
import {
  cloudSession,
  clearPendingCloudEmailAuth,
  importCloudPreferences,
  pendingCloudEmailAuth,
  credentialStatuses,
  disableRemoteWork,
  linkCloudAccount,
  requestCloudEmailCode,
  renameCloudDevice,
  remoteWorkStatus,
  signOutCloud,
  syncCloudPreferences,
  verifyCloudEmailCode,
} from "../../cloud-client";
import type { SettingsChangeHandler } from "./types";
import { REMOTE_BROWSER_WORK_SUPPORTED } from "../../../remote-work-capabilities";

type AccountState = {
  email: string | null;
  deviceName: string;
  providers: Set<string>;
  remoteWork: { enabled: boolean; revision: number } | null;
};

const EMPTY_ACCOUNT: AccountState = { email: null, deviceName: "", providers: new Set(), remoteWork: null };

export function CloudAccountSettings({
  formState,
  onChange,
}: {
  formState: UserSettings;
  onChange: SettingsChangeHandler;
}) {
  const [account, setAccount] = useState<AccountState>(EMPTY_ACCOUNT);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showLinkCode, setShowLinkCode] = useState(false);
  const [linkCode, setLinkCode] = useState("");
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [deviceName, setDeviceName] = useState("");

  const reload = async () => {
    const session = await cloudSession();
    if (!session) {
      setAccount(EMPTY_ACCOUNT);
      return;
    }
    const [statuses, remoteWork] = await Promise.all([
      credentialStatuses().catch(() => []),
      remoteWorkStatus().catch(() => null),
    ]);
    setAccount({
      email: session.account.email,
      deviceName: session.device.displayName,
      providers: new Set(
        statuses
          .filter((item) => item.configured && item.verification === "valid")
          .map((item) => item.provider),
      ),
      remoteWork,
    });
    setDeviceName(session.device.displayName);
  };

  useEffect(() => {
    void reload().catch(() => undefined);
    void pendingCloudEmailAuth().then((pending) => {
      if (!pending) return;
      setEmail(pending.email);
      setChallengeId(pending.challengeId);
      setMessage("Enter the sign-in code sent to your email.");
    });
  }, []);

  const perform = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await reload();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const connectAccount = async (action: () => Promise<unknown>) => {
    await action();
    const preferences = await importCloudPreferences();
    if (preferences) {
      for (const [key, value] of Object.entries(preferences))
        if (key !== "schemaVersion" && key !== "revision")
          onChange(key as keyof UserSettings, value as never);
    } else {
      await syncCloudPreferences(formState);
    }
  };

  if (!account.email)
    return (
      <section className="space-y-3 rounded-xl border border-primary-200 bg-primary-50/60 p-4 dark:border-primary-900 dark:bg-primary-950/20">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-300">
            OpenSidebar account
          </p>
          <h3 className="mt-1 text-base font-semibold text-warm-900 dark:text-warm-100">
            Securely connect your AI provider
          </h3>
          <p className="mt-1 text-xs leading-5 text-warm-600 dark:text-warm-300">
            Sign in once, store a supported provider key encrypted on your
            account, and use it without keeping the key in extension storage.
          </p>
        </div>
        <input
          type="email"
          aria-label="OpenSidebar account email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-warm-300 bg-white px-3 py-2.5 text-sm dark:border-warm-700 dark:bg-warm-900"
        />
        {challengeId ? (
          <div className="space-y-2">
            <p className="text-xs text-warm-600 dark:text-warm-300">
              We sent a one-time code to <strong>{email}</strong>. Check spam if
              it is not in your inbox.
            </p>
            <div className="flex gap-2">
              <input
                autoFocus
                autoComplete="one-time-code"
                inputMode="numeric"
                aria-label="Email sign-in code"
                value={emailCode}
                onChange={(event) =>
                  setEmailCode(event.target.value.replace(/\D/g, ""))
                }
                maxLength={8}
                placeholder="6-digit code"
                className="min-w-0 flex-1 rounded-lg border border-warm-300 bg-white px-3 py-2.5 text-center text-base font-semibold tracking-[0.2em] dark:border-warm-700 dark:bg-warm-900"
              />
              <button
                type="button"
                disabled={busy || emailCode.length < 6}
                onClick={() =>
                  void perform(
                    () =>
                      connectAccount(() =>
                        verifyCloudEmailCode(email, emailCode, challengeId),
                      ),
                    "Account connected and preferences synced.",
                  )
                }
                className="rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                Verify
              </button>
            </div>
            <button
              type="button"
              disabled={busy}
              className="text-xs font-medium text-primary-600 hover:underline disabled:opacity-50"
              onClick={() =>
                void perform(async () => {
                  await clearPendingCloudEmailAuth();
                  setChallengeId("");
                  setEmailCode("");
                }, "Enter your email to request a new code.")
              }
            >
              Use a different email or request a new code
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy || !email.includes("@")}
            onClick={() =>
              void perform(async () => {
                const challenge = await requestCloudEmailCode(email);
                setChallengeId(challenge.challengeId);
              }, "Check your email for the sign-in code.")
            }
            className="w-full rounded-lg bg-primary-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-50"
          >
            Email me a sign-in code
          </button>
        )}
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-medium text-warm-500 hover:text-warm-700 dark:text-warm-400"
          onClick={() => setShowLinkCode((value) => !value)}
        >
          <Link2 size={13} /> Use a link code instead
        </button>
        {showLinkCode ? (
          <div className="flex gap-2">
            <input
              aria-label="Account link code"
              value={linkCode}
              onChange={(event) =>
                setLinkCode(event.target.value.toUpperCase())
              }
              maxLength={8}
              placeholder="8-character code"
              className="min-w-0 flex-1 rounded-lg border border-warm-300 bg-white px-2 py-2 text-xs uppercase dark:border-warm-700 dark:bg-warm-900"
            />
            <button
              type="button"
              disabled={busy || linkCode.length !== 8}
              onClick={() =>
                void perform(
                  () => connectAccount(() => linkCloudAccount(linkCode)),
                  "Account connected and preferences synced.",
                )
              }
              className="rounded-lg border border-warm-300 px-3 text-xs font-medium disabled:opacity-50 dark:border-warm-700"
            >
              Link
            </button>
          </div>
        ) : null}
        <p aria-live="polite" className="text-xs text-warm-500">
          {message}
        </p>
      </section>
    );

  const provider =
    formState.providerMode === "fireworks" ? "fireworks" : "openrouter";
  const ready = account.providers.has(provider);
  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-warm-200 bg-white p-4 dark:border-warm-700 dark:bg-warm-850">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-warm-400">
              OpenSidebar account
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-warm-900 dark:text-warm-100">
              {account.email}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300">
            <CheckCircle2 size={12} /> Connected
          </span>
        </div>
        <div className="mt-4 rounded-lg bg-warm-50 p-3 dark:bg-warm-900">
          <p className="text-xs text-warm-500">Active provider</p>
          <p className="mt-1 text-sm font-semibold capitalize">
            {provider === "openrouter" ? "OpenRouter" : "Fireworks AI"}
          </p>
          <p
            className={`mt-1 text-xs ${ready ? "text-green-700 dark:text-green-300" : "text-amber-700 dark:text-amber-300"}`}
          >
            {ready ? "Ready through your account" : "Connection required"}
          </p>
        </div>
        <div className="mt-4">
          <label className="text-xs font-medium text-warm-600 dark:text-warm-300" htmlFor="cloud-device-name">
            This browser's name
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="cloud-device-name"
              value={deviceName}
              maxLength={80}
              onChange={(event) => setDeviceName(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-warm-300 bg-white px-3 py-2 text-sm dark:border-warm-700 dark:bg-warm-900"
            />
            <button
              type="button"
              disabled={busy || !deviceName.trim() || deviceName.trim() === account.deviceName}
              onClick={() =>
                void perform(
                  () => renameCloudDevice(deviceName),
                  "Device name updated.",
                )
              }
              className="rounded-lg border border-warm-300 px-3 text-xs font-semibold disabled:opacity-50 dark:border-warm-700"
            >
              Save name
            </button>
          </div>
          <p className="mt-1 text-[11px] text-warm-500">
            Codex uses this name when offering a connected browser.
          </p>
        </div>
        <div className="mt-4 rounded-lg border border-warm-200 p-3 dark:border-warm-700">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold">Remote browser work</p>
              <p className="mt-1 text-[11px] text-warm-500">
                {account.remoteWork?.enabled
                  ? REMOTE_BROWSER_WORK_SUPPORTED
                    ? "Ready. Authorized integrations may send visible tasks to this browser."
                    : "Enabled for the account, but this extension build cannot receive tasks."
                  : "Remote work is disabled for this account."}
              </p>
            </div>
            {account.remoteWork?.enabled ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void perform(
                  () => disableRemoteWork(account.remoteWork!.revision),
                  "Remote work disabled and active remote tasks cancelled.",
                )}
                className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-300"
              >
                Stop remote work
              </button>
            ) : (
              <button
                type="button"
                onClick={() => window.open("https://opensidebar.com/app/settings", "_blank", "noopener")}
                className="text-xs font-semibold text-primary-600"
              >
                Manage on web
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() =>
              window.open(
                "https://opensidebar.com/app/settings",
                "_blank",
                "noopener",
              )
            }
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600"
          >
            Manage account <ExternalLink size={12} />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void perform(signOutCloud, "Signed out on this browser.")
            }
            className="inline-flex items-center gap-1 text-xs font-medium text-warm-500"
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-warm-200 p-3 dark:border-warm-700">
        <p className="text-sm font-medium">Connection method</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={formState.inferenceMode === "cloud"}
            onClick={() => onChange("inferenceMode", "cloud")}
            className={`rounded-lg border p-2 text-xs font-medium ${formState.inferenceMode === "cloud" ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20" : "border-warm-200 dark:border-warm-700"}`}
          >
            Use account connection
          </button>
          <button
            type="button"
            aria-pressed={formState.inferenceMode === "local"}
            onClick={() => onChange("inferenceMode", "local")}
            className={`rounded-lg border p-2 text-xs font-medium ${formState.inferenceMode === "local" ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20" : "border-warm-200 dark:border-warm-700"}`}
          >
            Direct from this browser
          </button>
        </div>
      </div>
      <p aria-live="polite" className="text-xs text-warm-500">
        {message}
      </p>
    </section>
  );
}
