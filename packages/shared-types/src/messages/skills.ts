/**
 * OpenSidebar — user website-skill messages: recording lifecycle (side panel /
 * content / background) and saved-skill CRUD + usage status.
 */

import type { MessageSource } from "../enums";
import type {
  SkillRecordingEvent,
  UserWebsiteSkill,
  UserWebsiteSkillDraft,
} from "../agent";
import type { BaseMessage, UiMessageSource } from "./base";

export interface SkillRecordingStartMessage extends BaseMessage {
  type: "SKILL_RECORDING_START";
  source: UiMessageSource | MessageSource.BACKGROUND;
  payload: {
    tabId: number;
  };
}

export interface SkillRecordingStopMessage extends BaseMessage {
  type: "SKILL_RECORDING_STOP";
  source: UiMessageSource | MessageSource.BACKGROUND | MessageSource.CONTENT;
  payload: {
    tabId?: number;
  };
}

export interface SkillRecordingCancelMessage extends BaseMessage {
  type: "SKILL_RECORDING_CANCEL";
  source: UiMessageSource | MessageSource.BACKGROUND | MessageSource.CONTENT;
  payload: {
    tabId?: number;
  };
}

export interface SkillRecordingEventMessage extends BaseMessage {
  type: "SKILL_RECORDING_EVENT";
  source: MessageSource.CONTENT | MessageSource.BACKGROUND;
  payload: {
    event: SkillRecordingEvent;
  };
}

export interface SkillRecordingStatusMessage extends BaseMessage {
  type: "SKILL_RECORDING_STATUS";
  source: MessageSource.BACKGROUND;
  payload: {
    status: "idle" | "recording" | "review" | "paused";
    timeline: string[];
    draft?: UserWebsiteSkillDraft;
    detail?: string;
  };
}

export interface UserSkillSaveMessage extends BaseMessage {
  type: "USER_SKILL_SAVE";
  source: UiMessageSource;
  payload: {
    draft: UserWebsiteSkillDraft;
    enabled?: boolean;
  };
}

export interface UserSkillListMessage extends BaseMessage {
  type: "USER_SKILL_LIST";
  source: UiMessageSource | MessageSource.BACKGROUND;
  payload: {
    skills?: UserWebsiteSkill[];
  };
}

export interface UserSkillDeleteMessage extends BaseMessage {
  type: "USER_SKILL_DELETE";
  source: UiMessageSource;
  payload: {
    id: string;
  };
}

export interface UserSkillUsageStatusMessage extends BaseMessage {
  type: "USER_SKILL_USAGE_STATUS";
  source: MessageSource.BACKGROUND;
  payload: {
    skill: UserWebsiteSkill | null;
  };
}

/** Skill-recording lifecycle and saved-skill CRUD messages. */
export type SkillMessage =
  | SkillRecordingStartMessage
  | SkillRecordingStopMessage
  | SkillRecordingCancelMessage
  | SkillRecordingEventMessage
  | SkillRecordingStatusMessage
  | UserSkillSaveMessage
  | UserSkillListMessage
  | UserSkillDeleteMessage
  | UserSkillUsageStatusMessage;
