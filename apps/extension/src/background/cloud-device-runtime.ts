import type { SessionLeaseV1 } from "@shared-types/cloud-sessions";
import type { CloudDeviceV1 } from "@shared-types/cloud-control";
import type {
  CloudDeviceReconnectResponse,
  CloudDeviceTakeoverResponse,
} from "@shared-types/messages/session";
import type { RuntimeMessage } from "../types";
import { CLOUD_EXTENSION_SESSION_KEY, CloudAuthenticatedFetch } from "../cloud/authenticated-fetch";
import {
  DisabledCloudDeviceCoordinationPort,
  DisabledCloudSessionTransportPort,
  HttpCloudDeviceCoordinationPort,
  HttpCloudSessionTransportPort,
  chromeBrowserPagePort,
  chromeContentBridgePort,
  chromePersistencePort,
} from "./environment";
import {
  DeviceAttemptJournal,
} from "./orchestrator/device-attempt-journal";
import {
  DeviceCommandReconciler,
  DeviceSessionReconnectController,
  DeviceTakeoverGate,
} from "./orchestrator/device-session-reconnect";
import { cloudRestoreController } from "./cloud-restore-runtime";
import { createCloudCommandExecution } from "./cloud-device-read-policy";
import { getBlockedRuleForUrl } from "../utils/site-access";
import { loadSettings } from "../utils/settings-storage";
import type { UserSettings } from "../types";
import {
  LocalCloudCommandApprovalStore,
  PendingCloudCommandApprovalRegistry,
} from "./orchestrator/cloud-command-approval";

export const cloudDeviceCommandsEnabled =
  import.meta.env.VITE_CLOUD_SESSIONS_ENABLED === "true" &&
  import.meta.env.VITE_DEVICE_COMMANDS_ENABLED === "true";
export const cloudDeviceTakeoverEnabled =
  cloudDeviceCommandsEnabled &&
  import.meta.env.VITE_DEVICE_TAKEOVER_ENABLED === "true" &&
  import.meta.env.VITE_CHECKPOINT_RESTORE_ENABLED === "true";

const cloud = new CloudAuthenticatedFetch(chromePersistencePort.local);
const coordination = cloudDeviceCommandsEnabled
  ? new HttpCloudDeviceCoordinationPort((path, init) => cloud.request(path, init))
  : new DisabledCloudDeviceCoordinationPort();
const transport = cloudDeviceCommandsEnabled
  ? new HttpCloudSessionTransportPort((path, init) => cloud.request(path, init))
  : new DisabledCloudSessionTransportPort();

type StoredCloudSession = {
  device?: { id?: string };
};
type PendingTakeover = {
  connectionId: string;
  currentLease: SessionLeaseV1;
  sessionRevision: number;
  tabId: number;
};
type PendingTakeoverRestore = {
  lease: SessionLeaseV1;
  controller: DeviceSessionReconnectController;
};
type PendingCommandApproval = {
  commandId: string;
  actionDigest: string;
  expiresAt: number;
  lease: SessionLeaseV1;
  reconnect: {
    sessionId: string;
    sessionRevision: number;
    tabId: number;
    afterSequence: number;
  };
};

const pendingTakeovers = new Map<string, PendingTakeover>();
const pendingRestores = new Map<string, PendingTakeoverRestore>();
const pendingCommandApprovals =
  new PendingCloudCommandApprovalRegistry<PendingCommandApproval>();

async function deviceId(): Promise<string | null> {
  const stored = await chromePersistencePort.local.get(
    CLOUD_EXTENSION_SESSION_KEY,
  );
  return (
    stored[CLOUD_EXTENSION_SESSION_KEY] as StoredCloudSession | undefined
  )?.device?.id ?? null;
}

function controllerFor(sessionId: string, tabId: number) {
  const journal = new DeviceAttemptJournal(
    chromePersistencePort.local,
    sessionId,
  );
  return new DeviceSessionReconnectController(
    coordination,
    transport,
    new DeviceCommandReconciler(
      transport,
      journal,
      createCloudCommandExecution(tabId, {
        pages: chromeBrowserPagePort,
        content: chromeContentBridgePort,
        async isPageAuthorized(url) {
          if (!/^https?:\/\//i.test(url)) return false;
          const settings = (await loadSettings()) ?? ({} as UserSettings);
          return getBlockedRuleForUrl(url, settings) === null;
        },
        consumeLocalApproval(command, actionDigest) {
          return new LocalCloudCommandApprovalStore(
            chromePersistencePort.session,
            command.commandId,
          ).consume(command.commandId, actionDigest);
        },
      }),
    ),
    new DeviceTakeoverGate(chromePersistencePort.local, sessionId),
  );
}

async function previousDeviceName(device: string) {
  try {
    const response = await cloud.request("/account/devices");
    if (!response.ok) return "another device";
    const value = (await response.json()) as {
      devices: CloudDeviceV1[];
    };
    return value.devices.find((item) => item.id === device)?.displayName ??
      "another device";
  } catch {
    return "another device";
  }
}

function clickExpectedResult(command: {
  action: { arguments: Record<string, unknown> };
}): string | null {
  const value = command.action.arguments.postcondition;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const postcondition = value as { kind?: unknown; value?: unknown };
  if (postcondition.kind === "target_absent") return "The matched control disappears.";
  if (postcondition.kind === "target_disabled") return "The matched control becomes disabled.";
  if (postcondition.kind === "text_present" && typeof postcondition.value === "string")
    return `The page shows “${postcondition.value.slice(0, 160)}”.`;
  if (postcondition.kind === "url_is" && typeof postcondition.value === "string") {
    try {
      const url = new URL(postcondition.value);
      return `The page navigates to ${url.origin}${url.pathname}.`;
    } catch {
      return null;
    }
  }
  return null;
}

export async function reconnectCloudDevice(input: {
  sessionId: string;
  sessionRevision: number;
  tabId: number;
  afterSequence?: number;
}): Promise<CloudDeviceReconnectResponse> {
  if (!cloudDeviceCommandsEnabled)
    return { ok: false, disabled: true, detail: "Cloud device reconnect is not enabled in this build." };
  const currentDeviceId = await deviceId();
  if (!currentDeviceId)
    return { ok: false, detail: "Sign in to OpenSidebar Cloud before reconnecting." };
  try {
    const result = await controllerFor(input.sessionId, input.tabId).reconnect({
      deviceId: currentDeviceId,
      sessionId: input.sessionId,
      sessionRevision: input.sessionRevision,
      afterSequence: input.afterSequence ?? 0,
    });
    if (result.kind === "connected")
      return {
        ok: true,
        state: "connected",
        lastSequence: result.lastSequence,
        processedCommands: result.processedCommands,
      };
    if (result.kind === "needs_takeover") {
      if (!cloudDeviceTakeoverEnabled)
        return {
          ok: true,
          state: "read_only",
          detail: "Another device controls this session. Takeover is not enabled in this build.",
        };
      const takeoverId = crypto.randomUUID();
      pendingTakeovers.set(takeoverId, {
        connectionId: result.connectionId,
        currentLease: result.currentLease,
        sessionRevision: input.sessionRevision,
        tabId: input.tabId,
      });
      return {
        ok: true,
        state: "needs_takeover",
        takeoverId,
        previousDeviceName: await previousDeviceName(
          result.currentLease.deviceId,
        ),
      };
    }
    if (result.kind === "restore_required") {
      const prepared = await cloudRestoreController.prepare({
        sessionId: input.sessionId,
        tabId: input.tabId,
      });
      if (!prepared.ok) return prepared;
      const resumeController = controllerFor(input.sessionId, input.tabId);
      pendingRestores.set(prepared.restoreId, {
        lease: result.currentLease,
        controller: resumeController,
      });
      return {
        ok: true,
        state: "takeover_paused",
        restoreId: prepared.restoreId,
        preview: prepared.preview,
      };
    }
    if (result.kind === "approval_required") {
      const target = result.command.action.target;
      const expectedResult = clickExpectedResult(result.command);
      const origin = result.command.preconditions.find(
        (item) => item.kind === "origin",
      )?.value;
      if (
        result.command.action.kind !== "click" ||
        (result.command.risk !== "reversible_write" &&
          result.command.risk !== "sensitive_write") ||
        !target ||
        !origin ||
        !expectedResult
      )
        return { ok: false, detail: "The cloud command could not be previewed safely." };
      const commandExpiry = new Date(result.command.expiresAt).getTime();
      const cloudApprovalExpiry = result.command.approval
        ? new Date(result.command.approval.expiresAt).getTime()
        : Number.POSITIVE_INFINITY;
      const expiresAt = Math.min(
        commandExpiry,
        cloudApprovalExpiry,
        Date.now() + 120_000,
      );
      const approvalId = pendingCommandApprovals.request({
        commandId: result.command.commandId,
        actionDigest: result.actionDigest,
        expiresAt,
        lease: result.lease,
        reconnect: {
          sessionId: input.sessionId,
          sessionRevision: input.sessionRevision,
          tabId: input.tabId,
          afterSequence: result.lastSequence,
        },
      });
      return {
        ok: true,
        state: "approval_required",
        approvalId,
        action: {
          kind: "click",
          target: target.expectedName ?? target.description,
          origin,
          expectedResult,
          risk: result.command.risk,
          expiresAt: new Date(expiresAt).toISOString(),
        },
      };
    }
    return { ok: true, state: "read_only", detail: "This session is currently view-only." };
  } catch {
    return { ok: false, detail: "The cloud session could not reconnect safely." };
  }
}

export async function decideCloudDeviceCommandApproval(
  approvalId: string,
  approved: boolean,
): Promise<CloudDeviceReconnectResponse> {
  if (!cloudDeviceCommandsEnabled)
    return { ok: false, disabled: true, detail: "Cloud device commands are not enabled in this build." };
  const decision = pendingCommandApprovals.decide(approvalId, approved);
  if (decision.kind === "expired")
    return { ok: false, detail: "This command approval has expired. Reconnect to inspect it again." };
  const pending = decision.value;
  if (decision.kind === "denied") {
    await transport.transition(
      {
        sessionId: pending.lease.sessionId,
        leaseId: pending.lease.leaseId,
        leaseGeneration: pending.lease.generation,
      },
      pending.commandId,
      "cancel",
    ).catch(() => null);
    return { ok: true, state: "read_only", detail: "The cloud command was denied on this device." };
  }
  await new LocalCloudCommandApprovalStore(
    chromePersistencePort.session,
    pending.commandId,
  ).grant(pending.commandId, pending.actionDigest, pending.expiresAt);
  return reconnectCloudDevice(pending.reconnect);
}

export async function takeoverCloudDevice(
  takeoverId: string,
): Promise<CloudDeviceTakeoverResponse> {
  if (!cloudDeviceTakeoverEnabled)
    return { ok: false, disabled: true, detail: "Cross-device takeover is not enabled in this build." };
  const pending = pendingTakeovers.get(takeoverId);
  if (!pending) return { ok: false, detail: "This takeover request has expired." };
  const controller = controllerFor(
    pending.currentLease.sessionId,
    pending.tabId,
  );
  let prepared: Extract<CloudDeviceTakeoverResponse, { ok: true }> | null = null;
  try {
    const result = await controller.takeover({
      confirmed: true,
      connectionId: pending.connectionId,
      currentLease: pending.currentLease,
      sessionRevision: pending.sessionRevision,
      async restoreAndReground(lease) {
        const response = await cloudRestoreController.prepare({
          sessionId: lease.sessionId,
          tabId: pending.tabId,
        });
        if (!response.ok) throw new Error(response.detail);
        prepared = { ...response, state: "takeover_paused" };
        pendingRestores.set(response.restoreId, { lease, controller });
      },
    });
    if (result.kind !== "paused_for_restore" || !prepared)
      return { ok: false, detail: "The takeover could not be paused for restore." };
    pendingTakeovers.delete(takeoverId);
    return prepared;
  } catch {
    return { ok: false, detail: "The device was fenced, but restore still needs attention. Reopen the session to continue safely." };
  }
}

export async function continueCloudDeviceTakeover(
  restoreId: string,
  outcomeResolution?: string,
) {
  if (!cloudDeviceTakeoverEnabled)
    return { ok: false as const, disabled: true, detail: "Cross-device takeover is not enabled in this build." };
  const pending = pendingRestores.get(restoreId);
  if (!pending) return { ok: false as const, detail: "This takeover restore has expired." };
  const response = await cloudRestoreController.continue(
    restoreId,
    outcomeResolution,
    async () => {
      if (!(await pending.controller.continueAfterTakeover(pending.lease)))
        throw new Error("takeover_gate_clear_failed");
    },
  );
  if (!response.ok) return response;
  pendingRestores.delete(restoreId);
  return response;
}

export function isCloudDeviceMessage(message: RuntimeMessage) {
  return message.type.startsWith("CLOUD_DEVICE_");
}

export async function handleCloudDeviceMessage(message: RuntimeMessage) {
  if (message.type === "CLOUD_DEVICE_RECONNECT")
    return reconnectCloudDevice(message.payload);
  if (message.type === "CLOUD_DEVICE_TAKEOVER")
    return takeoverCloudDevice(message.payload.takeoverId);
  if (message.type === "CLOUD_DEVICE_TAKEOVER_CONTINUE")
    return continueCloudDeviceTakeover(
      message.payload.restoreId,
      message.payload.outcomeResolution,
    );
  if (message.type === "CLOUD_DEVICE_COMMAND_APPROVAL_DECISION")
    return decideCloudDeviceCommandApproval(
      message.payload.approvalId,
      message.payload.approved,
    );
  return undefined;
}
