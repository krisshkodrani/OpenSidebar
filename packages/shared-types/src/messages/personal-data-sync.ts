import type { PersonalDataCategory } from "../personal-data-sync";
import type { BaseMessage, UiMessageSource } from "./base";

export interface PersonalDataSyncStatusMessage extends BaseMessage {
  type: "PERSONAL_DATA_SYNC_STATUS";
  source: UiMessageSource;
}
export interface PersonalDataSyncNowMessage extends BaseMessage {
  type: "PERSONAL_DATA_SYNC_NOW";
  source: UiMessageSource;
  payload?: { category?: PersonalDataCategory };
}
export interface PersonalDataSyncSetCategoryMessage extends BaseMessage {
  type: "PERSONAL_DATA_SYNC_SET_CATEGORY";
  source: UiMessageSource;
  payload: { category: PersonalDataCategory; enabled: boolean };
}
export interface PersonalDataSyncKeyRequestsMessage extends BaseMessage {
  type: "PERSONAL_DATA_SYNC_KEY_REQUESTS";
  source: UiMessageSource;
}
export interface PersonalDataSyncKeyDecisionMessage extends BaseMessage {
  type: "PERSONAL_DATA_SYNC_KEY_DECISION";
  source: UiMessageSource;
  payload: { id: string; approved: boolean };
}
export interface PersonalDataSyncResolveMessage extends BaseMessage {
  type: "PERSONAL_DATA_SYNC_RESOLVE";
  source: UiMessageSource;
  payload: { id: string; resolution: "local" | "cloud" | "both" };
}
export interface PersonalDataSyncDeleteCloudMessage extends BaseMessage {
  type: "PERSONAL_DATA_SYNC_DELETE_CLOUD";
  source: UiMessageSource;
  payload: { category: PersonalDataCategory };
}
export interface PersonalDataSyncResetMessage extends BaseMessage {
  type: "PERSONAL_DATA_SYNC_RESET";
  source: UiMessageSource;
}

export type PersonalDataSyncMessage =
  | PersonalDataSyncStatusMessage
  | PersonalDataSyncNowMessage
  | PersonalDataSyncSetCategoryMessage
  | PersonalDataSyncKeyRequestsMessage
  | PersonalDataSyncKeyDecisionMessage
  | PersonalDataSyncResolveMessage
  | PersonalDataSyncDeleteCloudMessage
  | PersonalDataSyncResetMessage;
