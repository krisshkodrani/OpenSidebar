import type { BaseMessage, UiMessageSource } from "./base";

export interface RemoteMissionCancelMessage extends BaseMessage {
  type: "REMOTE_MISSION_CANCEL";
  source: UiMessageSource;
  payload: { missionId: string };
}

export interface RemoteMissionDenyMessage extends BaseMessage {
  type: "REMOTE_MISSION_DENY";
  source: UiMessageSource;
  payload: { missionId: string };
}

export type RemoteMissionMessage =
  | RemoteMissionCancelMessage
  | RemoteMissionDenyMessage;
