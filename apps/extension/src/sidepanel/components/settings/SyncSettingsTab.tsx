import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Cloud, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import type {
  LocalPersonalDataSyncPreferencesV1,
  PersonalDataCategory,
  PersonalDataConflictV1,
  PersonalDataKeyRequestV1,
  PersonalDataSyncMessage,
  PersonalDataStatusV1,
  UserSettings,
} from "../../../types";
import { MessageSource } from "../../../types";
import {
  cloudPreferenceSyncEnabled,
  cloudSession,
  setCloudPreferenceSyncEnabled,
  syncCloudPreferences,
} from "../../cloud-client";
import { uiRuntime } from "../../runtime";
import { useStore } from "../../store";
import { loadSettings, saveSettings } from "../../../utils/settings-storage";
import type { SettingsChangeHandler } from "./types";

type SyncResponse = {
  ok: boolean;
  detail?: string;
  status?: PersonalDataStatusV1;
  preferences?: LocalPersonalDataSyncPreferencesV1 | null;
  conflicts?: PersonalDataConflictV1[];
};
type RequestsResponse = { ok: boolean; detail?: string; requests?: PersonalDataKeyRequestV1[] };
const request = <T,>(type: string, payload?: unknown) => uiRuntime.sendMessage<T>({
  type,
  requestId: crypto.randomUUID(),
  source: MessageSource.SIDEPANEL,
  ...(payload === undefined ? {} : { payload }),
} as PersonalDataSyncMessage);
const labels: Record<PersonalDataCategory, { title: string; detail: string }> = {
  saved_prompts: { title: "Saved Prompts", detail: "Reusable prompts you create or edit." },
  website_skills: { title: "Website Skills", detail: "Recorded workflows, site scopes, and verification guidance." },
  profile: { title: "Profile", detail: "Profile Notes and the reviewed Profile Digest." },
};

export function SyncSettingsTab({ formState, onChange }: { formState: UserSettings; onChange: SettingsChangeHandler }) {
  const [account, setAccount] = useState<string | null>(null);
  const [value, setValue] = useState<SyncResponse | null>(null);
  const [requests, setRequests] = useState<PersonalDataKeyRequestV1[]>([]);
  const [preferenceSync, setPreferenceSync] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [deleteArmed, setDeleteArmed] = useState<PersonalDataCategory | null>(null);
  const [resetArmed, setResetArmed] = useState(false);

  const reload = useCallback(async () => {
    const current = await cloudSession();
    setAccount(current?.account.email ?? null);
    setPreferenceSync(await cloudPreferenceSyncEnabled());
    if (!current) { setValue(null); return; }
    const [status, pending] = await Promise.all([
      request<SyncResponse>("PERSONAL_DATA_SYNC_STATUS"),
      request<RequestsResponse>("PERSONAL_DATA_SYNC_KEY_REQUESTS"),
    ]);
    setValue(status);
    setRequests(pending.requests ?? []);
    if (!status.ok && status.detail) setMessage(status.detail);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const perform = async (action: () => Promise<{ ok: boolean; detail?: string }>, success: string) => {
    setBusy(true); setMessage("");
    try {
      const result = await action();
      setMessage(result.ok ? success : result.detail ?? "Sync action failed.");
      await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  if (!account) return (
    <section className="rounded-xl border border-accent/30 bg-accent-subtle p-4">
      <Cloud size={20} className="text-accent-text" />
      <h3 className="mt-2 text-ui-body font-semibold">Sync across your browsers</h3>
      <p className="mt-1 text-ui-control leading-5 text-fg-secondary">
        Connect an OpenSidebar account in the Account tab before choosing what to sync.
      </p>
    </section>
  );

  const status = value?.status;
  const approved = status?.currentDeviceApproved === true;
  const enabled = value?.preferences?.categories;
  const pending = requests.filter((item) => item.state === "pending");
  return <div className="space-y-4">
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-ui-caption font-semibold uppercase tracking-wider text-fg-tertiary">Sync center</p>
          <p className="mt-1 truncate text-ui-body font-semibold">{account}</p>
          <p className="mt-1 text-ui-control text-fg-tertiary">{value?.preferences?.lastSuccessfulSyncAt
            ? `Last synced ${new Date(value.preferences.lastSuccessfulSyncAt).toLocaleString()}` : "No personal content synced yet."}</p></div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-ui-caption font-semibold ${approved ? "bg-success-subtle text-success" : "bg-warning-subtle text-warning"}`}>
          {approved ? <CheckCircle2 size={12} /> : <KeyRound size={12} />}{approved ? "Encrypted" : "Setup needed"}
        </span>
      </div>
      <button type="button" disabled={busy || status?.capabilities.writes === false}
        onClick={() => void perform(async () => {
          if (preferenceSync) {
            const persisted = await loadSettings(uiRuntime.storage);
            await syncCloudPreferences(persisted ?? formState);
          }
          return request<SyncResponse>("PERSONAL_DATA_SYNC_NOW");
        }, "Sync complete.")}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-line-strong px-3 py-2 text-ui-control font-semibold disabled:opacity-50">
        <RefreshCw size={14} /> Sync now
      </button>
      {status && !status.capabilities.namedTester ? <p className="mt-2 text-ui-control text-warning">Personal-content sync is currently limited to named testers.</p> : null}
    </section>

    <section className="space-y-2">
      <div><h3 className="text-ui-body font-semibold">Across devices</h3><p className="mt-1 text-ui-control text-fg-tertiary">Personal content is encrypted before it leaves this browser.</p></div>
      <SyncRow title="Preferences" detail="Theme, models, agent behavior, and built-in skill choices. Local safety settings stay here."
        checked={preferenceSync} disabled={busy} onChange={(checked) => void perform(async () => {
          await setCloudPreferenceSyncEnabled(checked); setPreferenceSync(checked); return { ok: true };
        }, checked ? "Preference sync enabled." : "Preference sync disabled on this browser.")} />
      {(["saved_prompts", "website_skills", "profile"] as PersonalDataCategory[]).map((category) => {
        const comingSoon = category === "profile" && status?.capabilities.profile !== true;
        const cloudCopy = status?.documents[category];
        return <div key={category} className="rounded-lg border border-line bg-surface p-3">
          <SyncRow title={labels[category].title} detail={comingSoon ? `${labels[category].detail} End-to-end encrypted sync is coming soon.` : labels[category].detail}
            checked={enabled?.[category] === true} disabled={busy || comingSoon || status?.capabilities.writes !== true}
            badge={comingSoon ? "Coming soon" : cloudCopy ? `${Math.ceil(cloudCopy.ciphertextSizeBytes / 1024)} KB encrypted` : undefined}
            onChange={(checked) => void perform(() => request<SyncResponse>("PERSONAL_DATA_SYNC_SET_CATEGORY", { category, enabled: checked }),
              checked ? `${labels[category].title} sync enabled.` : `${labels[category].title} sync stopped; cloud copy retained.`)} />
          {cloudCopy ? <button type="button" disabled={busy} onClick={() => {
            if (deleteArmed !== category) { setDeleteArmed(category); return; }
            void perform(() => request<SyncResponse>("PERSONAL_DATA_SYNC_DELETE_CLOUD", { category }), "Encrypted cloud copy deleted."); setDeleteArmed(null);
          }} className="mt-2 inline-flex items-center gap-1 text-ui-caption font-medium text-danger disabled:opacity-50">
            <Trash2 size={12} /> {deleteArmed === category ? "Confirm delete cloud copy" : "Delete cloud copy"}</button> : null}
        </div>;
      })}
    </section>

    {pending.length ? <section className="space-y-2 rounded-lg border border-warning/30 bg-warning-subtle p-3">
      <h3 className="text-ui-body font-semibold">{approved ? "Browser approval requests" : "Waiting for browser approval"}</h3>
      {pending.map((item) => <div key={item.id} className="rounded-md bg-surface p-2 text-ui-control">
        <p className="font-semibold">{item.requestingDeviceName}</p><p className="mt-1 font-mono tracking-wider">{item.verificationCode}</p>
        <p className="mt-1 text-fg-tertiary">{approved
          ? "Approve only if this code matches the new browser."
          : "On an approved browser, open Settings → Sync and confirm that this code matches."}</p>
        {approved ? <div className="mt-2 flex gap-2"><button disabled={busy} className="rounded bg-accent px-2 py-1 font-semibold text-accent-fg" onClick={() => void perform(
          () => request("PERSONAL_DATA_SYNC_KEY_DECISION", { id: item.id, approved: true }), "Browser approved.")}>Approve</button>
          <button disabled={busy} className="rounded border px-2 py-1" onClick={() => void perform(
            () => request("PERSONAL_DATA_SYNC_KEY_DECISION", { id: item.id, approved: false }), "Request denied.")}>Deny</button></div> : null}
      </div>)}
    </section> : null}

    {(status?.approvedDevices.length ?? 0) > 0 ? <section className="space-y-2">
      <div><h3 className="text-ui-body font-semibold">Encryption and browsers</h3>
        <p className="mt-1 text-ui-control text-fg-tertiary">Only approved browsers receive the key that unlocks personal content.</p></div>
      {status!.approvedDevices.map((device) => <div key={device.deviceId} className="flex items-center justify-between rounded-lg border border-line bg-surface p-3">
        <div><p className="text-ui-control font-semibold">{device.displayName}</p><p className="mt-1 text-ui-caption text-fg-tertiary">{device.current ? "This browser" : `Approved ${new Date(device.approvedAt).toLocaleDateString()}`}</p></div>
        <span className="rounded bg-success-subtle px-2 py-1 text-ui-caption font-semibold text-success">Approved</span>
      </div>)}
      <p className="text-ui-caption text-fg-tertiary">Removing a browser requires key rotation and remains disabled until the named-tester rotation gate passes. Account device revocation cannot erase a key that browser already received.</p>
    </section> : null}

    {(value?.conflicts?.length ?? 0) > 0 ? <section className="space-y-2 rounded-lg border border-warning/30 p-3">
      <h3 className="flex items-center gap-1 text-ui-body font-semibold"><AlertTriangle size={14} /> Review conflicts</h3>
      {value!.conflicts!.map((conflict) => <div key={conflict.id} className="rounded border p-2 text-ui-control">
        <p>{labels[conflict.category].title}{conflict.entityId ? ` · ${conflict.entityId}` : ""} changed in two places.</p>
        <div className="mt-2 flex flex-wrap gap-2">{(["local", "cloud", ...(conflict.category === "profile" ? [] : ["both"])] as const).map((choice) =>
          <button key={choice} disabled={busy} className="rounded border px-2 py-1 capitalize" onClick={() => void perform(
            () => request("PERSONAL_DATA_SYNC_RESOLVE", { id: conflict.id, resolution: choice }), "Conflict resolved.")}>{choice === "local" ? "Keep this browser" : choice === "cloud" ? "Use cloud" : "Keep both"}</button>)}</div>
      </div>)}
    </section> : null}

    <section className="space-y-2"><h3 className="text-ui-body font-semibold">Cloud activity</h3>
      <InfoRow title="Task sessions" detail={import.meta.env.VITE_CLOUD_SESSIONS_ENABLED === "true" ? "Restorable task sessions use the existing encrypted checkpoint service." : "Not enabled in this build."} />
      <SyncRow title="Detailed traces" detail="May include page content and screenshots. Uses separate end-to-end encryption and consent."
        checked={formState.traceSyncEnabled === true} disabled={busy} onChange={(checked) => {
          const next = { ...formState, traceSyncEnabled: checked };
          onChange("traceSyncEnabled", checked);
          void perform(async () => {
            await saveSettings(next, uiRuntime.storage);
            useStore.getState().updateSettings(next);
            return { ok: true };
          }, checked ? "Detailed trace sync enabled." : "Detailed trace sync disabled.");
        }} />
    </section>

    <section className="rounded-lg border border-danger/30 p-3">
      <h3 className="text-ui-body font-semibold">Lost every approved browser?</h3><p className="mt-1 text-ui-control text-fg-tertiary">OpenSidebar cannot recover your encryption key. Reset deletes inaccessible cloud ciphertext but keeps content currently stored in this browser.</p>
      <button type="button" disabled={busy} onClick={() => {
        if (!resetArmed) { setResetArmed(true); return; }
        void perform(() => request("PERSONAL_DATA_SYNC_RESET"), "Encrypted sync reset."); setResetArmed(false);
      }} className="mt-2 text-ui-control font-semibold text-danger">{resetArmed ? "Confirm reset encrypted sync" : "Reset encrypted sync"}</button>
    </section>
    <p aria-live="polite" className="text-ui-control text-fg-tertiary">{message}</p>
  </div>;
}

function SyncRow({ title, detail, checked, disabled, badge, onChange }: { title: string; detail: string; checked: boolean; disabled?: boolean; badge?: string; onChange: (checked: boolean) => void }) {
  return <div className="flex items-start justify-between gap-3 rounded-lg border border-line bg-surface p-3">
    <div><div className="flex items-center gap-2"><p className="text-ui-control font-semibold">{title}</p>{badge ? <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-ui-caption text-fg-tertiary">{badge}</span> : null}</div><p className="mt-1 text-ui-caption leading-4 text-fg-tertiary">{detail}</p></div>
    <input type="checkbox" aria-label={`Sync ${title}`} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 accent-accent" />
  </div>;
}
function InfoRow({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-lg border border-line bg-surface p-3"><p className="text-ui-control font-semibold">{title}</p><p className="mt-1 text-ui-caption text-fg-tertiary">{detail}</p></div>;
}
