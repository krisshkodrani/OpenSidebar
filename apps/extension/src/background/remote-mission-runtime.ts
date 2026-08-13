import { CLOUD_EXTENSION_SESSION_KEY, CloudAuthenticatedFetch } from "../cloud/authenticated-fetch";
import { chromePersistencePort, chromeSchedulerPort } from "./environment/chrome";
import { createDefaultRemoteMissionRunner } from "./remote-mission-runner";
import { LocalMissionAttemptJournal } from "./remote-missions/local-attempt-journal";
import { MissionWorker } from "./remote-missions/mission-worker";
import { LocalRemoteMissionDeliveryJournal } from "./remote-missions/delivery-journal";
import {
  CodexHandoffSupervisor,
  RemoteMissionDeliveryController,
} from "./remote-missions/delivery-controller";
import {
  REMOTE_MISSION_LOCAL_STATUS_KEY,
  type RemoteMissionLocalStatus,
} from "../remote-mission-local-status";
import type { RuntimeMessage } from "../types";
import {
  DisabledRemoteMissionDeliveryPort,
  HttpRemoteMissionDeliveryPort,
} from "./remote-missions/http-delivery-port";
import { RemoteMissionLocalControls } from "./remote-missions/local-controls";
import { isUiMessageSource } from "./ui-message-source";
import { REMOTE_BROWSER_WORK_SUPPORTED } from "../remote-work-capabilities";

const ALARM_NAME = "opensidebar:remote-mission-poll";
const POLL_PERIOD_MINUTES = 1;
export const remoteMissionDeliveryEnabled =
  REMOTE_BROWSER_WORK_SUPPORTED;

const cloud = new CloudAuthenticatedFetch(chromePersistencePort.local);
const transport = remoteMissionDeliveryEnabled
  ? new HttpRemoteMissionDeliveryPort((path, init) => cloud.request(path, init))
  : new DisabledRemoteMissionDeliveryPort();
const worker = new MissionWorker(
  createDefaultRemoteMissionRunner(),
  new CodexHandoffSupervisor(),
  new LocalMissionAttemptJournal(chromePersistencePort),
);

type StoredCloudSession = {
  account?: { email?: string };
  device?: { id?: string; displayName?: string };
};
const readCloudSession = async () => {
  const stored = await chromePersistencePort.local.get(CLOUD_EXTENSION_SESSION_KEY);
  return stored[CLOUD_EXTENSION_SESSION_KEY] as StoredCloudSession | undefined;
};
const readDeviceId = async () => (await readCloudSession())?.device?.id ?? null;

const writeStatus = async (status: RemoteMissionLocalStatus) => {
  const session = await readCloudSession();
  const requesterLabel = session?.account?.email?.trim();
  const deviceName = session?.device?.displayName?.trim();
  await chromePersistencePort.local.set({
    [REMOTE_MISSION_LOCAL_STATUS_KEY]: {
      ...status,
      ...(requesterLabel ? { requesterLabel } : {}),
      ...(deviceName ? { deviceName } : {}),
    },
  });
};

const controller = new RemoteMissionDeliveryController(
  transport,
  new LocalRemoteMissionDeliveryJournal(chromePersistencePort.local),
  worker,
  readDeviceId,
  writeStatus,
);

export const pollRemoteMissions = () => controller.pollOnce();

const readLocalStatus = async () => {
  const stored = await chromePersistencePort.local.get(
    REMOTE_MISSION_LOCAL_STATUS_KEY,
  );
  return stored[REMOTE_MISSION_LOCAL_STATUS_KEY] as
    | RemoteMissionLocalStatus
    | undefined;
};

const localControls = new RemoteMissionLocalControls(
  transport,
  { read: readLocalStatus, write: writeStatus },
  pollRemoteMissions,
);

export const cancelRemoteMissionLocally = (missionId: string) =>
  localControls.cancel(missionId);
export const denyRemoteMissionLocally = (missionId: string) =>
  localControls.deny(missionId);

export function routeRemoteMissionControlMessage(
  message: RuntimeMessage,
  respond: (value: { ok: boolean; detail?: string }) => void,
) {
  if (
    !isUiMessageSource(message.source) ||
    (message.type !== "REMOTE_MISSION_CANCEL" &&
      message.type !== "REMOTE_MISSION_DENY")
  ) return false;
  const action = message.type === "REMOTE_MISSION_CANCEL"
    ? cancelRemoteMissionLocally
    : denyRemoteMissionLocally;
  void action(message.payload.missionId)
    .then(() => respond({ ok: true }))
    .catch((error) =>
      respond({
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  return true;
}

async function reconcilePolling() {
  if (!remoteMissionDeliveryEnabled || !(await readDeviceId())) {
    await chromeSchedulerPort.clearAlarm(ALARM_NAME);
    await chromePersistencePort.local.remove(REMOTE_MISSION_LOCAL_STATUS_KEY);
    return;
  }
  await chromeSchedulerPort.createAlarm(ALARM_NAME, {
    periodInMinutes: POLL_PERIOD_MINUTES,
  });
  await pollRemoteMissions();
}

export function initRemoteMissionRuntime() {
  chromeSchedulerPort.onAlarm((alarm) => {
    if (alarm.name === ALARM_NAME) void pollRemoteMissions().catch(() => {});
  });
  chromePersistencePort.local.onChanged((changes) => {
    if (CLOUD_EXTENSION_SESSION_KEY in changes) void reconcilePolling().catch(() => {});
  });
  void reconcilePolling().catch(() => {});
}
