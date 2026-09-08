import { useEffect, useState } from "react";
import type {
  CloudRestoreContinueResponse,
  CloudRestoreListResponse,
  CloudRestorePrepareResponse,
  CloudDeviceReconnectResponse,
  CloudDeviceTakeoverResponse,
} from "@shared-types/messages/session";
import { MessageSource } from "../../../types";
import { uiRuntime } from "../../runtime";
import { useStore } from "../../store";

const enabled =
  import.meta.env.VITE_CLOUD_SESSIONS_ENABLED === "true" &&
  import.meta.env.VITE_CHECKPOINT_RESTORE_ENABLED === "true";
const deviceEnabled =
  enabled && import.meta.env.VITE_DEVICE_COMMANDS_ENABLED === "true";

type SessionItem = Extract<CloudRestoreListResponse, { ok: true }>["sessions"][number];
type Preview = Extract<CloudRestorePrepareResponse, { ok: true }>;
type TakeoverPrompt = {
  takeoverId: string;
  previousDeviceName: string;
};
type CommandApprovalPrompt = Extract<
  CloudDeviceReconnectResponse,
  { ok: true; state: "approval_required" }
>;

export function CloudSessionsRestore() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [takeoverPrompt, setTakeoverPrompt] = useState<TakeoverPrompt | null>(null);
  const [takeoverRestore, setTakeoverRestore] = useState(false);
  const [commandApproval, setCommandApproval] = useState<CommandApprovalPrompt | null>(null);
  const [status, setStatus] = useState("");
  const [outcomeResolution, setOutcomeResolution] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    const response = await uiRuntime.sendMessage<CloudRestoreListResponse>({
      type: "CLOUD_RESTORE_LIST_REQUEST",
      requestId: crypto.randomUUID(),
      source: MessageSource.SIDEPANEL,
      payload: {},
    });
    setBusy(false);
    if (!response.ok) return setStatus(response.detail);
    setSessions(response.sessions.filter((item) => item.checkpoint));
    setStatus(response.sessions.length ? "" : "No restorable cloud sessions yet.");
  };

  useEffect(() => {
    if (enabled) void load();
  }, []);

  if (!enabled) return null;

  const prepare = async (item: SessionItem) => {
    const tab = await uiRuntime.getActiveTab();
    if (!tab?.id) return setStatus("Open the page you want to continue on first.");
    setBusy(true);
    setStatus("");
    const response = await uiRuntime.sendMessage<CloudRestorePrepareResponse>({
      type: "CLOUD_RESTORE_PREPARE",
      requestId: crypto.randomUUID(),
      source: MessageSource.SIDEPANEL,
      payload: {
        sessionId: item.session.sessionId,
        checkpointId: item.checkpoint?.checkpointId,
        tabId: tab.id,
      },
    });
    setBusy(false);
    if (!response.ok) return setStatus(response.detail);
    setPreview(response);
  };

  const continueRestore = async () => {
    if (!preview) return;
    setBusy(true);
    const response = await uiRuntime.sendMessage<CloudRestoreContinueResponse>({
      type: takeoverRestore
        ? "CLOUD_DEVICE_TAKEOVER_CONTINUE"
        : "CLOUD_RESTORE_CONTINUE",
      requestId: crypto.randomUUID(),
      source: MessageSource.SIDEPANEL,
      payload: {
        restoreId: preview.restoreId,
        outcomeResolution: outcomeResolution.trim() || undefined,
      },
    });
    setBusy(false);
    if (!response.ok) return setStatus(response.detail);
    useStore.getState().setActiveWorkspaceId(response.workspaceId);
    void uiRuntime.sendMessage({
      type: "WORKSPACE_SYNC",
      requestId: crypto.randomUUID(),
      source: MessageSource.SIDEPANEL,
      payload: { workspaceId: response.workspaceId },
    });
    setPreview(null);
    setTakeoverRestore(false);
    setOutcomeResolution("");
    setStatus("Restored task started in a new local workspace.");
  };

  const applyReconnectResponse = (response: CloudDeviceReconnectResponse) => {
    if (!response.ok) return setStatus(response.detail);
    if (response.state === "needs_takeover") {
      setTakeoverPrompt({
        takeoverId: response.takeoverId,
        previousDeviceName: response.previousDeviceName,
      });
      return;
    }
    if (response.state === "takeover_paused") {
      setPreview(response);
      setTakeoverRestore(true);
      setStatus("The takeover is still paused. Review the restored state before continuing.");
      return;
    }
    if (response.state === "approval_required") {
      setCommandApproval(response);
      setStatus("A cloud command is waiting for approval on this device.");
      return;
    }
    setStatus(
      response.state === "connected"
        ? "This device is reconnected to the cloud session."
        : response.detail,
    );
  };

  const reconnect = async (item: SessionItem) => {
    const tab = await uiRuntime.getActiveTab();
    if (!tab?.id) return setStatus("Open the page you want to continue on first.");
    setBusy(true);
    setStatus("");
    const response = await uiRuntime.sendMessage<CloudDeviceReconnectResponse>({
      type: "CLOUD_DEVICE_RECONNECT",
      requestId: crypto.randomUUID(),
      source: MessageSource.SIDEPANEL,
      payload: {
        sessionId: item.session.sessionId,
        sessionRevision: item.session.revision,
        tabId: tab.id,
      },
    });
    setBusy(false);
    applyReconnectResponse(response);
  };

  const decideCommandApproval = async (approved: boolean) => {
    if (!commandApproval) return;
    setBusy(true);
    const response = await uiRuntime.sendMessage<CloudDeviceReconnectResponse>({
      type: "CLOUD_DEVICE_COMMAND_APPROVAL_DECISION",
      requestId: crypto.randomUUID(),
      source: MessageSource.SIDEPANEL,
      payload: { approvalId: commandApproval.approvalId, approved },
    });
    setBusy(false);
    setCommandApproval(null);
    applyReconnectResponse(response);
  };

  const confirmTakeover = async () => {
    if (!takeoverPrompt) return;
    setBusy(true);
    const response = await uiRuntime.sendMessage<CloudDeviceTakeoverResponse>({
      type: "CLOUD_DEVICE_TAKEOVER",
      requestId: crypto.randomUUID(),
      source: MessageSource.SIDEPANEL,
      payload: { takeoverId: takeoverPrompt.takeoverId },
    });
    setBusy(false);
    if (!response.ok) return setStatus(response.detail);
    setTakeoverPrompt(null);
    setPreview(response);
    setTakeoverRestore(true);
    setStatus("The other device is fenced. Review the restored state before continuing.");
  };

  return (
    <section className="space-y-3 rounded-xl border border-warm-200 bg-white p-3 dark:border-warm-700 dark:bg-warm-850">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-warm-900 dark:text-warm-100">Cloud sessions</h3>
          <p className="mt-1 text-xs text-warm-500">Restore onto the current page. OpenSidebar will inspect it and pause before doing anything.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void load()} className="text-xs font-medium text-primary-600 underline disabled:opacity-50">Refresh</button>
      </div>
      {!preview ? (
        <div className="space-y-2">
          {sessions.map((item) => (
            <div key={item.session.sessionId} className="rounded-lg border border-warm-200 p-2 dark:border-warm-700">
              <span className="block text-xs font-medium text-warm-900 dark:text-warm-100">{item.session.title}</span>
              <span className="mt-1 block text-[11px] text-warm-500">Saved {new Date(item.session.lastActivityAt).toLocaleString()}</span>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => void prepare(item)} className="rounded-md border border-warm-300 px-2 py-1 text-[11px] font-medium disabled:opacity-50 dark:border-warm-700">Restore here</button>
                {deviceEnabled ? <button type="button" disabled={busy} onClick={() => void reconnect(item)} className="rounded-md bg-primary-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">Reconnect</button> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2 rounded-lg bg-warm-50 p-2 text-xs dark:bg-warm-900">
          <p className="font-semibold">Ready, but paused</p>
          <p>{preview.preview.objective}</p>
          <p className="text-warm-500">Current page: {preview.preview.pageTitle || preview.preview.pageUrl || "unavailable"}</p>
          {preview.preview.grounding !== "matched" ? (
            <p className="rounded-md bg-amber-100 p-2 text-amber-900">The current page is {preview.preview.grounding}. OpenSidebar will re-plan from what is visible now.</p>
          ) : null}
          {preview.preview.requiresFreshApproval ? <p>A sensitive pending action will require new approval.</p> : null}
          {preview.preview.requiresOutcomeClarification ? <p>The outcome of a previous action is uncertain. OpenSidebar will verify or ask before retrying it.</p> : null}
          {preview.preview.requiresOutcomeClarification ? (
            <textarea
              aria-label="What happened after the uncertain action?"
              value={outcomeResolution}
              onChange={(event) => setOutcomeResolution(event.target.value)}
              placeholder="Tell OpenSidebar whether the action appeared to succeed, fail, or is still unclear."
              className="min-h-20 w-full rounded-md border border-warm-300 bg-white p-2 dark:border-warm-700 dark:bg-warm-850"
            />
          ) : null}
          <div className="flex gap-2">
            <button type="button" disabled={busy || preview.preview.grounding === "unavailable" || preview.preview.grounding === "unauthorized" || (preview.preview.requiresOutcomeClarification && !outcomeResolution.trim())} onClick={() => void continueRestore()} className="rounded-md bg-primary-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">Continue</button>
            <button type="button" disabled={busy} onClick={() => { setPreview(null); setTakeoverRestore(false); }} className="rounded-md border border-warm-300 px-3 py-1.5 font-medium">{takeoverRestore ? "Close" : "Cancel"}</button>
          </div>
        </div>
      )}
      {takeoverPrompt ? (
        <div role="alertdialog" aria-label="Confirm device takeover" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-semibold">Continue on this device?</p>
          <p>{takeoverPrompt.previousDeviceName} currently controls this session. Taking over will stop that device. Website login state and open tabs will not transfer.</p>
          <p>OpenSidebar will restore the latest checkpoint, inspect this page, stay paused, and require fresh approval for sensitive actions.</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void confirmTakeover()} className="rounded-md bg-amber-700 px-3 py-1.5 font-medium text-white disabled:opacity-50">Take over and inspect</button>
            <button type="button" disabled={busy} onClick={() => setTakeoverPrompt(null)} className="rounded-md border border-amber-400 px-3 py-1.5 font-medium">Keep other device</button>
          </div>
        </div>
      ) : null}
      {commandApproval ? (
        <div role="alertdialog" aria-label="Approve cloud browser command" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-semibold">Allow this click on this device?</p>
          <p>Click “{commandApproval.action.target}” on {commandApproval.action.origin}.</p>
          <p>Expected result: {commandApproval.action.expectedResult}</p>
          <p>OpenSidebar freshly matched one visible element and will verify the declared page change afterward. Approval applies only to this exact command and expires shortly.</p>
          {commandApproval.action.risk === "sensitive_write" ? <p className="font-semibold">This action is marked sensitive. Review the page before allowing it.</p> : null}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void decideCommandApproval(true)} className="rounded-md bg-amber-700 px-3 py-1.5 font-medium text-white disabled:opacity-50">Allow once</button>
            <button type="button" disabled={busy} onClick={() => void decideCommandApproval(false)} className="rounded-md border border-amber-400 px-3 py-1.5 font-medium">Deny</button>
          </div>
        </div>
      ) : null}
      <p aria-live="polite" className="text-xs text-warm-500">{status}</p>
    </section>
  );
}
