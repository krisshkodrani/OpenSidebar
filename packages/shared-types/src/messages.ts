/**
 * OpenSidebar — RuntimeMessage: the cross-context message contract.
 *
 * The union is composed of per-domain sub-unions, each defined in its own
 * module under `messages/`. Add a new message to the domain module it belongs
 * to (or create a new domain module and add its sub-union here) — not to this
 * barrel. Consumers that only care about one domain should type against the
 * sub-union (e.g. `ContentProtocolMessage`), keeping their switches
 * meaningfully exhaustive.
 *
 * Note: the offscreen tab-audio capture protocol (`TAB_AUDIO_*`) is
 * intentionally NOT part of this union — it is a self-contained
 * background ↔ offscreen-document protocol typed locally at both ends
 * (`background/speech/tab-audio.ts`, `offscreen/audio.ts`).
 */

import type { SessionMessage } from "./messages/session";
import type { ProgressMessage } from "./messages/progress";
import type { InteractionMessage } from "./messages/interaction";
import type { ContentProtocolMessage } from "./messages/content-protocol";
import type { SkillMessage } from "./messages/skills";
import type { WatchModeMessage } from "./messages/watch-mode";
import type { E2eHookMessage } from "./messages/e2e";
import type { CloudTraceMessage } from "./messages/cloud-traces";
import type { RemoteMissionMessage } from "./messages/remote-missions";
import type { PersonalDataSyncMessage } from "./messages/personal-data-sync";

export * from "./messages/base";
export * from "./messages/session";
export * from "./messages/progress";
export * from "./messages/interaction";
export * from "./messages/content-protocol";
export * from "./messages/skills";
export * from "./messages/watch-mode";
export * from "./messages/e2e";
export * from "./messages/cloud-traces";
export * from "./messages/remote-missions";
export * from "./messages/personal-data-sync";

/**
 * Discriminated union of all message types.
 * The `type` field is the discriminant.
 */
export type RuntimeMessage =
  | SessionMessage
  | ProgressMessage
  | InteractionMessage
  | ContentProtocolMessage
  | SkillMessage
  | WatchModeMessage
  | CloudTraceMessage
  | RemoteMissionMessage
  | PersonalDataSyncMessage
  | E2eHookMessage;
