/**
 * Workflow-confirmation action/target inference (RFC LP-16 Phase 1).
 * The workflow_confirmation contract kind's closed inference sub-graph: infers
 * the workflow action and target from a request, matches confirmations against
 * visible/transactional targets, and derives target-disappearance and
 * status/control-change actions. Verbatim movement from completion-kernel.ts.
 */
import type { TaggedElement } from "../../../types";
import type { CompletionEvidence } from "./kernel-types";
import {
  TARGET_AWARE_VISIBLE_WORKFLOW_ACTIONS,
  type TargetAwareVisibleWorkflowAction,
  type WorkflowConfirmationAction,
} from "./workflow-confirmation-types";
import type { ControlStateWorkflowAction } from "./workflow-control-state";
import {
  cleanLabel,
  isModalDismissalWorkflowRequest,
  normalizeText,
  stripProhibitedWorkflowClauses,
  tokenizeCompletionText,
} from "./text-utils";
import { valueTokenCoveredBySummary } from "./label-value-types";
import { extractCartCreationSnippet, extractTransactionalConfirmationSnippet } from "./workflow-text-confirmation";
export {
  textConfirmsWorkflowAction,
  workflowActionTermPattern,
  extractTransactionalConfirmationSnippet,
  extractCartCreationSnippet,
} from "./workflow-text-confirmation";

const TARGET_AWARE_VISIBLE_WORKFLOW_ACTION_SET: ReadonlySet<WorkflowConfirmationAction> =
  new Set(TARGET_AWARE_VISIBLE_WORKFLOW_ACTIONS);

export function inferWorkflowConfirmationAction(
  value: string,
): WorkflowConfirmationAction | null {
  const text = stripProhibitedWorkflowClauses(value);
  if (isModalDismissalWorkflowRequest(text)) return "dismiss";
  if (/\b(?:delete|deleted|deletion|remove|removed|removal)\b/i.test(text)) {
    return "delete";
  }
  if (/\b(?:archive|archived|archival)\b/i.test(text)) return "archive";
  if (/\b(?:save|saved)\b/i.test(text)) return "save";
  if (/\b(?:send|sent)\b/i.test(text)) return "send";
  if (
    /\bexport(?:ed)?\s+(?:the\s+)?(?:file|report|document|csv|pdf|spreadsheet|data|dataset|results?|table|list|view|logs?)\b/i.test(
      text,
    )
  ) {
    return "export";
  }
  if (
    /\bdownload(?:ed)?\s+(?:the\s+)?(?:file|report|document|attachment|csv|pdf|spreadsheet|export|data|dataset|results?|invoice|receipt|logs?|archive)\b/i.test(
      text,
    )
  ) {
    return "download";
  }
  if (
    /\bupload(?:ed)?\s+(?:the\s+)?(?:file|report|document|attachment|image|photo|csv|pdf|spreadsheet|data|dataset|results?|logs?|archive)\b/i.test(
      text,
    )
  ) {
    return "upload";
  }
  if (
    /\bimport(?:ed)?\s+(?:the\s+)?(?:file|report|document|csv|spreadsheet|data|dataset|results?|table|list|view|contacts?|records?|items?)\b/i.test(
      text,
    )
  ) {
    return "import";
  }
  if (
    /\bdetach(?:ed)?\s+(?:the\s+)?(?:file|report|document|attachment|image|photo|invoice|receipt|log|logs|record|item|task|ticket|request|entry|row|comment|message|note|account|case|issue)\b/i.test(
      text,
    )
  ) {
    return "detach";
  }
  if (
    /\battach(?:ed)?\s+(?:the\s+)?(?:file|report|document|attachment|image|photo|invoice|receipt|log|logs|record|item|task|ticket|request|entry|row|comment|message|note|account|case|issue)\b/i.test(
      text,
    )
  ) {
    return "attach";
  }
  if (
    /\b(?:copy|copied)\s+(?:the\s+)?(?:link|url|address|text|code|value|id|identifier|token|key|path|email|phone|file|report|document|message|comment|article|page|record|item|task|ticket|request|entry|row|table|list|view)\b/i.test(
      text,
    )
  ) {
    return "copy";
  }
  if (
    /\b(?:transfer|transferred)\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|folder|document|report|page|workflow|rule|ownership|assignment)\b/i.test(
      text,
    )
  ) {
    return "transfer";
  }
  if (
    /\b(?:move|moved)\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|folder|document|report|page|message|comment|thread|conversation|card|column|list|board|workflow|rule)\b/i.test(
      text,
    )
  ) {
    return "move";
  }
  if (
    /\b(?:rename|renamed)\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|folder|document|report|page|message|comment|thread|conversation|card|column|list|board|workflow|rule|profile|workspace)\b/i.test(
      text,
    )
  ) {
    return "rename";
  }
  if (
    /\b(?:merge|merged)\s+(?:the\s+)?(?:pull\s+request|merge\s+request|pr|branch|record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|document|report|page|message|comment|thread|conversation|workspace)\b/i.test(
      text,
    )
  ) {
    return "merge";
  }
  if (
    /\bunschedule(?:d)?\s+(?:the\s+)?(?:report|dashboard|job|task|ticket|request|entry|row|case|issue|incident|project|workflow|rule|automation|process|pipeline|message|email|notification|reminder|meeting|event|appointment|sync|backup|export|import|deployment|release)\b/i.test(
      text,
    )
  ) {
    return "unschedule";
  }
  if (
    /\bschedule(?:d)?\s+(?:the\s+)?(?:report|dashboard|job|task|ticket|request|entry|row|case|issue|incident|project|workflow|rule|automation|process|pipeline|message|email|notification|reminder|meeting|event|appointment|sync|backup|export|import|deployment|release)\b/i.test(
      text,
    )
  ) {
    return "schedule";
  }
  if (
    /\b(?:rollback|roll\s+back|rolled\s+back)\s+(?:the\s+)?(?:app|application|service|site|release|build|version|environment|deployment|package|workflow|pipeline|branch|change|changes)\b/i.test(
      text,
    )
  ) {
    return "rollback";
  }
  if (
    /\bdeploy(?:ed)?\s+(?:the\s+)?(?:app|application|service|site|release|build|version|environment|deployment|package|workflow|pipeline|branch|change|changes)\b/i.test(
      text,
    )
  ) {
    return "deploy";
  }
  if (
    /\b(?:back\s+up|backup|backed\s+up)\s+(?:the\s+)?(?:database|data|dataset|file|files|folder|folders|document|documents|record|records|settings|config|configuration|workspace|project|repository|repo|site|app|application|service|server|environment|system|account|profile|export|archive|backup)\b/i.test(
      text,
    )
  ) {
    return "backup";
  }
  if (
    /\breset(?:ting)?\s+(?:the\s+)?(?:password|passcode|pin|mfa|2fa|credential|credentials|token|key|secret|settings?|config|configuration|preferences?|cache|session|account|profile|device|app|application|service|workflow|rule|job|pipeline|database|data|dataset|form|filters?|view|dashboard|report)\b/i.test(
      text,
    )
  ) {
    return "reset";
  }
  if (
    /\bunsuspend(?:ed|ing)?\s+(?:the\s+)?(?:account|profile|user|member|person|customer|client|service|subscription|plan|workspace|project|workflow|rule|job|pipeline|task|ticket|request|record|item|case|issue|incident|access|license|licence)\b/i.test(
      text,
    )
  ) {
    return "unsuspend";
  }
  if (
    /\bsuspend(?:ed|ing)?\s+(?:the\s+)?(?:account|profile|user|member|person|customer|client|service|subscription|plan|workspace|project|workflow|rule|job|pipeline|task|ticket|request|record|item|case|issue|incident|access|license|licence)\b/i.test(
      text,
    )
  ) {
    return "suspend";
  }
  if (
    /\bunblock(?:ed|ing)?\s+(?:the\s+)?(?:account|profile|user|member|person|customer|client|contact|sender|email|domain|ip|address|device|app|application|service|site|url|workspace|project|task|ticket|request|record|item|case|issue|incident|access|license|licence)\b/i.test(
      text,
    )
  ) {
    return "unblock";
  }
  if (
    /\bblock(?:ed|ing)?\s+(?:the\s+)?(?:account|profile|user|member|person|customer|client|contact|sender|email|domain|ip|address|device|app|application|service|site|url|workspace|project|task|ticket|request|record|item|case|issue|incident|access|license|licence)\b/i.test(
      text,
    )
  ) {
    return "block";
  }
  if (
    /\bunlink(?:ed|ing)?\s+(?:the\s+)?(?:account|profile|user|member|person|customer|client|contact|record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|workflow|rule|integration|connector|service|app|application|device|domain|url)\b/i.test(
      text,
    )
  ) {
    return "unlink";
  }
  if (
    /\blink(?:ed|ing)?\s+(?:the\s+)?(?:account|profile|user|member|person|customer|client|contact|record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|workflow|rule|integration|connector|service|app|application|device|domain|url)\b/i.test(
      text,
    )
  ) {
    return "link";
  }
  if (
    /\buntag(?:ged|ging)?\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|user|member|profile)\b/i.test(
      text,
    )
  ) {
    return "untag";
  }
  if (
    /\btag(?:ged|ging)?\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|user|member|profile)\b/i.test(
      text,
    )
  ) {
    return "tag";
  }
  if (
    /\bunflag(?:ged|ging)?\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|email|user|member|profile)\b/i.test(
      text,
    )
  ) {
    return "unflag";
  }
  if (
    /\bflag(?:ged|ging)?\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|email|user|member|profile)\b/i.test(
      text,
    )
  ) {
    return "flag";
  }
  if (
    /\b(?:duplicate(?:d)?|clone(?:d)?)\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|workflow|rule|dashboard|view|list|policy|profile)\b/i.test(
      text,
    )
  ) {
    return "duplicate";
  }
  if (
    /\b(?:restore(?:d)?|recover(?:ed)?|reinstate(?:d)?)\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|workflow|rule|dashboard|view|list|policy|profile|account|user|archive|version|backup)\b/i.test(
      text,
    )
  ) {
    return "restore";
  }
  if (/\badd(?:ed)?\b.{0,120}\b(?:cart|basket|bag)\b/i.test(text)) {
    return "create";
  }
  if (
    /\b(?:create(?:d)?|add(?:ed)?|register(?:ed)?)\s+(?:(?:a|an|the)\s+)?(?:[\w-]+\s+){0,3}(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|workflow|rule|dashboard|view|list|policy|profile|account|user|order|case|issue|incident|project|contact|customer|meeting|event|appointment|review)\b/i.test(
      text,
    )
  ) {
    return "create";
  }
  if (
    /\bshare\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|folder|workflow|rule|dashboard|view|list|policy|profile|link|board|project|invoice|receipt)\b/i.test(
      text,
    )
  ) {
    return "share";
  }
  if (
    /\bgrant(?:ed)?\s+(?:the\s+)?(?:access|permission|permissions?|privilege|privileges?|role|roles?|license|licence|licenses|licences|entitlement|entitlements?|membership|admin|administrator|viewer|editor|owner|read\s+access|write\s+access)\b/i.test(
      text,
    )
  ) {
    return "grant";
  }
  if (
    /\brevok(?:e|ed)\s+(?:the\s+)?(?:access|permission|permissions?|privilege|privileges?|role|roles?|license|licence|licenses|licences|entitlement|entitlements?|membership|admin|administrator|viewer|editor|owner|read\s+access|write\s+access)\b/i.test(
      text,
    )
  ) {
    return "revoke";
  }
  if (
    /\binstall(?:ed)?\s+(?:the\s+)?(?:app|application|extension|plugin|package|module|integration|connector|driver|dependency|tool|theme|add[-\s]?on|update|workflow|rule)\b/i.test(
      text,
    )
  ) {
    return "install";
  }
  if (
    /\buninstall(?:ed)?\s+(?:the\s+)?(?:app|application|extension|plugin|package|module|integration|connector|driver|dependency|tool|theme|add[-\s]?on|update|workflow|rule)\b/i.test(
      text,
    )
  ) {
    return "uninstall";
  }
  if (
    /\bdisconnect(?:ed)?\s+(?:the\s+)?(?:account|app|application|integration|connector|service|provider|source|data\s+source|database|endpoint|api|server|device|repository|repo|workspace|project|channel|feed|webhook|connection)\b/i.test(
      text,
    )
  ) {
    return "disconnect";
  }
  if (
    /\bconnect(?:ed)?\s+(?:the\s+)?(?:account|app|application|integration|connector|service|provider|source|data\s+source|database|endpoint|api|server|device|repository|repo|workspace|project|channel|feed|webhook|connection)\b/i.test(
      text,
    )
  ) {
    return "connect";
  }
  if (
    /\b(?:sync(?:ed)?|resync(?:ed)?|synchroni[sz](?:e|ed))\s+(?:the\s+)?(?:account|app|application|integration|connector|service|provider|source|data\s+source|database|endpoint|api|server|device|repository|repo|workspace|project|channel|feed|webhook|connection|calendar|contacts?|files?|folders?|documents?|settings|config|configuration|backup|workflow|rule|job|pipeline|queue)\b/i.test(
      text,
    )
  ) {
    return "sync";
  }
  if (
    /\binvit(?:e|ed)\s+(?:the\s+)?(?:user|member|person|contact|customer|client|guest|reviewer|approver|editor|viewer|admin|administrator|collaborator|teammate|team|group)\b/i.test(
      text,
    )
  ) {
    return "invite";
  }
  if (
    /\bunsubscrib(?:e|ed)\s+(?:from\s+)?(?:the\s+)?(?:channel|topic|list|newsletter|report|dashboard|board|project|queue|feed|service|plan|notification|notifications?|updates?|digest|subscription)\b/i.test(
      text,
    )
  ) {
    return "unsubscribe";
  }
  if (
    /\bsubscrib(?:e|ed)\s+(?:to\s+)?(?:the\s+)?(?:channel|topic|list|newsletter|report|dashboard|board|project|queue|feed|service|plan|notification|notifications?|updates?|digest|subscription)\b/i.test(
      text,
    )
  ) {
    return "subscribe";
  }
  if (
    /\bunpin(?:ned)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic)\b/i.test(
      text,
    )
  ) {
    return "unpin";
  }
  if (
    /\bpin(?:ned)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic)\b/i.test(
      text,
    )
  ) {
    return "pin";
  }
  if (
    /\bunmut(?:e|ed)\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|user|member|contact|notification|notifications?|alert|alerts?)\b/i.test(
      text,
    )
  ) {
    return "unmute";
  }
  if (
    /\bmut(?:e|ed)\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|user|member|contact|notification|notifications?|alert|alerts?)\b/i.test(
      text,
    )
  ) {
    return "mute";
  }
  if (
    /\bunfollow(?:ed)?\s+(?:the\s+)?(?:user|member|contact|account|profile|channel|topic|thread|conversation|project|board|list|report|dashboard|page|feed|newsletter|tag|repository|repo)\b/i.test(
      text,
    )
  ) {
    return "unfollow";
  }
  if (
    /\bfollow(?:ed)?\s+(?:the\s+)?(?:user|member|contact|account|profile|channel|topic|thread|conversation|project|board|list|report|dashboard|page|feed|newsletter|tag|repository|repo)\b/i.test(
      text,
    )
  ) {
    return "follow";
  }
  if (
    /\bunbookmark(?:ed)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site)\b/i.test(
      text,
    )
  ) {
    return "unbookmark";
  }
  if (
    /\bbookmark(?:ed)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site)\b/i.test(
      text,
    )
  ) {
    return "bookmark";
  }
  if (
    /\bunfavorite(?:d)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site|user|member|contact|account|profile|repository|repo)\b/i.test(
      text,
    )
  ) {
    return "unfavorite";
  }
  if (
    /\bfavorite(?:d)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site|user|member|contact|account|profile|repository|repo)\b/i.test(
      text,
    )
  ) {
    return "favorite";
  }
  if (
    /\bunlike(?:d)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|message|comment|reply|post|thread|conversation|article|page|link|url|site|user|member|contact|account|profile|repository|repo|issue)\b/i.test(
      text,
    )
  ) {
    return "unlike";
  }
  if (
    /\blike(?:d)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|message|comment|reply|post|thread|conversation|article|page|link|url|site|user|member|contact|account|profile|repository|repo|issue)\b/i.test(
      text,
    )
  ) {
    return "like";
  }
  if (
    /\bdownvote(?:d)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|message|comment|reply|post|thread|conversation|article|page|link|url|site|user|member|contact|account|profile|repository|repo|issue)\b/i.test(
      text,
    )
  ) {
    return "downvote";
  }
  if (
    /\bupvote(?:d)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|message|comment|reply|post|thread|conversation|article|page|link|url|site|user|member|contact|account|profile|repository|repo|issue)\b/i.test(
      text,
    )
  ) {
    return "upvote";
  }
  if (
    /\bunwatch(?:ed)?\s+(?:the\s+)?(?:repository|repo|project|board|list|report|dashboard|page|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|queue|service|job|pipeline|workflow|record|item)\b/i.test(
      text,
    )
  ) {
    return "unwatch";
  }
  if (
    /\bwatch(?:ed)?\s+(?:the\s+)?(?:repository|repo|project|board|list|report|dashboard|page|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|queue|service|job|pipeline|workflow|record|item)\b/i.test(
      text,
    )
  ) {
    return "watch";
  }
  if (
    /\bunstar(?:red)?\s+(?:the\s+)?(?:repository|repo|project|board|list|report|dashboard|page|document|file|folder|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|record|item|message|comment|article|link|site|user|member|contact|profile)\b/i.test(
      text,
    )
  ) {
    return "unstar";
  }
  if (
    /\bstar(?:red)?\s+(?:the\s+)?(?:repository|repo|project|board|list|report|dashboard|page|document|file|folder|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|record|item|message|comment|article|link|site|user|member|contact|profile)\b/i.test(
      text,
    )
  ) {
    return "star";
  }
  if (/\b(?:post|posted|publish|published)\b/i.test(text)) return "post";
  if (/\b(?:approve|approved)\b/i.test(text)) return "approve";
  if (/\b(?:reject|rejected|deny|denied)\b/i.test(text)) return "reject";
  if (/\bre[-\s]?open(?:ed)?\b/i.test(text)) return "reopen";
  if (/\b(?:cancel|canceled|cancelled|cancellation)\b/i.test(text)) {
    return "cancel";
  }
  if (
    /\b(?:enable|activate)\b/i.test(text) ||
    /\bturn\s+on\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\b(?:enabled|activated|active)\b/i.test(text)
  ) {
    return "enable";
  }
  if (
    /\b(?:disable|deactivate)\b/i.test(text) ||
    /\bturn\s+off\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\b(?:disabled|deactivated|inactive)\b/i.test(
      text,
    )
  ) {
    return "disable";
  }
  if (
    /\bunassign\b/i.test(text) ||
    /\bclear\s+(?:the\s+)?assignee\b/i.test(text) ||
    /\bremove\s+(?:the\s+)?assignment\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\bunassigned\b/i.test(text)
  ) {
    return "unassign";
  }
  if (
    /\bassign\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\bassigned\b/i.test(text)
  ) {
    return "assign";
  }
  if (
    /\bde[-\s]?escalate\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\bde[-\s]?escalated\b/i.test(text)
  ) {
    return "deescalate";
  }
  if (
    /\bescalate\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\bescalated\b/i.test(text)
  ) {
    return "escalate";
  }
  if (
    /\bunlock\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\bunlocked\b/i.test(text)
  ) {
    return "unlock";
  }
  if (
    /\block\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\blocked\b/i.test(text)
  ) {
    return "lock";
  }
  if (
    /\bpause\s+(?:the\s+)?(?:automation|job|operation|pipeline|process|queue|record|request|schedule|service|subscription|sync|task|ticket|workflow)\b/i.test(
      text,
    )
  ) {
    return "pause";
  }
  if (
    /\bresume\s+(?:the\s+)?(?:automation|job|operation|pipeline|process|queue|record|request|schedule|service|subscription|sync|task|ticket|workflow)\b/i.test(
      text,
    )
  ) {
    return "resume";
  }
  if (
    /\brestart\s+(?:the\s+)?(?:automation|job|operation|pipeline|process|queue|record|request|schedule|service|subscription|sync|task|ticket|workflow)\b/i.test(
      text,
    )
  ) {
    return "restart";
  }
  if (
    /\brefresh\s+(?:the\s+)?(?:automation|cache|dashboard|data|dataset|job|list|operation|pipeline|queue|record|report|request|schedule|service|subscription|sync|table|task|ticket|view|workflow)\b/i.test(
      text,
    )
  ) {
    return "refresh";
  }
  if (
    /\bstart\s+(?:the\s+)?(?:automation|job|operation|pipeline|process|queue|record|request|schedule|service|subscription|sync|task|ticket|workflow)\b/i.test(
      text,
    )
  ) {
    return "start";
  }
  if (
    /\bstop\s+(?:the\s+)?(?:automation|job|operation|pipeline|process|queue|record|request|schedule|service|subscription|sync|task|ticket|workflow)\b/i.test(
      text,
    )
  ) {
    return "stop";
  }
  if (/\b(?:close|closed|resolve|resolved)\b/i.test(text)) return "close";
  if (/\b(?:dismiss|dismissed)\b/i.test(text)) return "dismiss";
  if (/\b(?:update|updated|change|changed|apply|applied)\b/i.test(text)) {
    return "update";
  }
  if (
    /\b(?:submit|submitted|submission|place\s+order|placed\s+order|checkout|purchase|purchased|order\s+confirmation)\b/i.test(
      text,
    )
  ) {
    return "submit";
  }
  if (isCompleteWorkflowRequest(text)) return "complete";
  return null;
}

export function inferWorkflowConfirmationTargetLabel(
  value: string,
  action: WorkflowConfirmationAction,
): string | null {
  if (action === "create") {
    const cartAdds = [
      ...value.matchAll(
        /\badd\s+(?!to\s+(?:the\s+)?(?:cart|basket|bag)\b)(?:the\s+)?(.{2,120}?)\s+to\s+(?:the\s+)?(?:cart|basket|bag)\b/gi,
      ),
    ];
    const product = cartAdds.at(-1)?.[1];
    const productLabel = normalizeWorkflowTargetLabel(product ?? "");
    if (productLabel) return productLabel;

    const referencedProduct =
      /\b(?:find|locate|select|choose|view|open)\s+(?:the\s+)?(.{2,120}?)\s+and\s+add\s+(?:it|them|that|those)\s+to\s+(?:the\s+)?(?:cart|basket|bag)\b/i.exec(
        value,
      )?.[1];
    const referencedProductLabel = normalizeWorkflowTargetLabel(
      referencedProduct ?? "",
    );
    if (referencedProductLabel) return referencedProductLabel;
  }
  if (action === "complete") {
    const completeTarget = inferCompleteWorkflowTargetLabel(value);
    if (completeTarget) return completeTarget;
  }

  const actionPattern = workflowTargetActionPattern(action);
  if (!actionPattern) return null;
  const lines = value
    .split(/\n+/g)
    .map((line) => cleanLabel(line))
    .filter(Boolean);

  for (const line of lines) {
    if (action === "enable" || action === "disable") {
      const indirectActionTarget =
        /\b(?:click|press|select|choose|open)\s+(?:the\s+)?(.{2,120}?)\s+(?:action|button|control|toggle|switch)\b/i.exec(
          line,
        )?.[1];
      const indirectActionTargetLabel = normalizeWorkflowTargetLabel(
        indirectActionTarget ?? "",
      );
      if (indirectActionTargetLabel) return indirectActionTargetLabel;
    }

    if (!new RegExp(`\\b${actionPattern}\\b`, "i").test(line)) continue;
    if (/^the subtask outcome for\b/i.test(line)) continue;

    const quoted = /["']([^"']{2,120})["']/.exec(line)?.[1];
    const quotedTarget = normalizeWorkflowTargetLabel(quoted ?? "", {
      quoted: true,
    });
    if (quotedTarget) return quotedTarget;

    if (action === "update") {
      const inlineEditTarget =
        /\b(?:click|select|focus|open)\s+(?:the\s+)?(.{2,120}?)\s+(?:and|then)\s+(?:change|update|set|edit|replace)\s+(?:its|the)\s+(?:value|text|name|cell|field)\b/i.exec(
          line,
        )?.[1];
      const inlineEditTargetLabel = normalizeWorkflowTargetLabel(
        inlineEditTarget ?? "",
      );
      if (inlineEditTargetLabel) return inlineEditTargetLabel;

      const typeThenCommitTarget =
        /\b(?:click|select|focus|open)\s+(?:the\s+)?(.{2,120}?)\s*,?\s+(?:type|enter)\s+[^,.;\n]{1,80}\s*,?\s+(?:and\s+)?(?:press|hit)?\s*(?:enter|tab)\b/i.exec(
          line,
        )?.[1];
      const typeThenCommitTargetLabel = normalizeWorkflowTargetLabel(
        typeThenCommitTarget ?? "",
      );
      if (typeThenCommitTargetLabel) return typeThenCommitTargetLabel;
    }

    const direct = new RegExp(
      `\\b${actionPattern}\\b\\s+(?:the\\s+)?(.+?)(?:[.;,]|$)`,
      "i",
    ).exec(line)?.[1];
    const directTarget = normalizeWorkflowTargetLabel(direct ?? "");
    if (directTarget) return directTarget;
  }

  return null;
}

export function workflowTargetActionPattern(
  action: WorkflowConfirmationAction,
): string | null {
  switch (action) {
    case "delete":
      return "(?:delete|remove)";
    case "archive":
      return "(?:archive)";
    case "save":
      return "(?:save)";
    case "send":
      return "(?:send)";
    case "export":
      return "(?:export)";
    case "download":
      return "(?:download)";
    case "upload":
      return "(?:upload)";
    case "import":
      return "(?:import)";
    case "attach":
      return "(?:attach)";
    case "detach":
      return "(?:detach)";
    case "copy":
      return "(?:copy)";
    case "transfer":
      return "(?:transfer)";
    case "move":
      return "(?:move)";
    case "rename":
      return "(?:rename)";
    case "merge":
      return "(?:merge)";
    case "schedule":
      return "(?:schedule)";
    case "unschedule":
      return "(?:unschedule)";
    case "deploy":
      return "(?:deploy)";
    case "rollback":
      return "(?:roll\\s+back|rollback)";
    case "backup":
      return "(?:back\\s+up|backup)";
    case "reset":
      return "(?:reset)";
    case "suspend":
      return "(?:suspend)";
    case "unsuspend":
      return "(?:unsuspend)";
    case "block":
      return "(?:block)";
    case "unblock":
      return "(?:unblock)";
    case "link":
      return "(?:link)";
    case "unlink":
      return "(?:unlink)";
    case "tag":
      return "(?:tag)";
    case "untag":
      return "(?:untag)";
    case "flag":
      return "(?:flag)";
    case "unflag":
      return "(?:unflag)";
    case "duplicate":
      return "(?:duplicate|clone)";
    case "restore":
      return "(?:restore|recover|reinstate)";
    case "create":
      return "(?:create|add|register)";
    case "dismiss":
      return "(?:dismiss|hide|clear|close|cancel|remove)";
    case "share":
      return "(?:share)";
    case "grant":
      return "(?:grant)";
    case "revoke":
      return "(?:revoke)";
    case "install":
      return "(?:install)";
    case "uninstall":
      return "(?:uninstall)";
    case "connect":
      return "(?:connect)";
    case "disconnect":
      return "(?:disconnect)";
    case "sync":
      return "(?:sync|resync|synchroni[sz]e)";
    case "invite":
      return "(?:invite)";
    case "subscribe":
      return "(?:subscribe(?:\\s+to)?)";
    case "unsubscribe":
      return "(?:unsubscribe(?:\\s+from)?)";
    case "pin":
      return "(?:pin)";
    case "unpin":
      return "(?:unpin)";
    case "mute":
      return "(?:mute)";
    case "unmute":
      return "(?:unmute)";
    case "follow":
      return "(?:follow)";
    case "unfollow":
      return "(?:unfollow)";
    case "bookmark":
      return "(?:bookmark)";
    case "unbookmark":
      return "(?:unbookmark)";
    case "favorite":
      return "(?:favorite)";
    case "unfavorite":
      return "(?:unfavorite)";
    case "like":
      return "(?:like)";
    case "unlike":
      return "(?:unlike)";
    case "upvote":
      return "(?:upvote)";
    case "downvote":
      return "(?:downvote)";
    case "watch":
      return "(?:watch)";
    case "unwatch":
      return "(?:unwatch)";
    case "star":
      return "(?:star)";
    case "unstar":
      return "(?:unstar)";
    case "post":
      return "(?:post|publish)";
    case "approve":
      return "(?:approve)";
    case "reject":
      return "(?:reject|deny)";
    case "close":
      return "(?:close|resolve)";
    case "reopen":
      return "(?:re[-\\s]?open)";
    case "cancel":
      return "(?:cancel)";
    case "enable":
      return "(?:enable|activate|turn\\s+on)";
    case "disable":
      return "(?:disable|deactivate|turn\\s+off)";
    case "assign":
      return "(?:assign)";
    case "unassign":
      return "(?:unassign)";
    case "escalate":
      return "(?:escalate)";
    case "deescalate":
      return "(?:de[-\\s]?escalate)";
    case "lock":
      return "(?:lock)";
    case "unlock":
      return "(?:unlock)";
    case "pause":
      return "(?:pause)";
    case "resume":
      return "(?:resume)";
    case "start":
      return "(?:start)";
    case "stop":
      return "(?:stop)";
    case "restart":
      return "(?:restart)";
    case "refresh":
      return "(?:refresh)";
    case "update":
      return "(?:update|change|apply)";
    case "submit":
      return "(?:submit)";
    case "complete":
      return "(?:complete|mark|set)";
  }
}

function inferCompleteWorkflowTargetLabel(value: string): string | null {
  const lines = value
    .split(/\n+/g)
    .map((line) => cleanLabel(line))
    .filter(Boolean);

  for (const line of lines) {
    if (!isCompleteWorkflowRequest(line)) continue;

    const quoted = /["']([^"']{2,120})["']/.exec(line)?.[1];
    const quotedTarget = normalizeWorkflowTargetLabel(quoted ?? "", {
      quoted: true,
    });
    if (quotedTarget) return quotedTarget;

    const markTarget =
      /\b(?:mark|set)\s+(?:the\s+)?(.{2,120}?)\s+(?:as\s+)?complete(?:d)?\b/i.exec(
        line,
      )?.[1];
    const completeTarget =
      /\bcomplete(?:d)?\s+(?:the\s+)?(.{2,120}?)(?:[.;,]|$)/i.exec(line)?.[1];
    const target = normalizeWorkflowTargetLabel(
      markTarget ?? completeTarget ?? "",
    );
    if (target) return target;
  }

  return null;
}

export function normalizeWorkflowTargetLabel(
  value: string,
  options: { quoted?: boolean; allowShort?: boolean } = {},
): string | null {
  let target = cleanLabel(value);
  if (!target) return null;
  target = target.replace(
    /^(?:the|this|that|selected|current|visible)\s+/i,
    "",
  );
  target = target.replace(
    /\s+(?:and|then|after that)\s+(?:confirm|verify|make sure|ensure|check|click|press|select|open|go)\b.*$/i,
    "",
  );
  target = target.replace(
    /\s+by\s+(?:clicking|pressing|selecting|choosing|using|toggling|opening|checking)\b.+$/i,
    "",
  );
  target = target.replace(
    /\s+(?:using|with)\s+(?:its|the|a|an)?\s*(?:button|toggle|control|link|menu|option|checkbox|switch)\b.*$/i,
    "",
  );
  target = target.replace(
    /\s+(?:action|actions|button|buttons|toggle|toggles|control|controls|link|links|switch|switches|checkbox|checkboxes)\s*$/i,
    "",
  );
  target = target.replace(/\s+(?:from|in|on|under|inside)\s+.+$/i, "");
  target = target.replace(/\s+(?:please|now)$/i, "");
  target = cleanLabel(target);
  if (!target) return null;

  const normalized = normalizeText(target);
  if (
    /^(?:record|item|row|entry|target|object|selection|selected|current|this|that|it|them)$/i.test(
      normalized,
    )
  ) {
    return null;
  }

  const tokens = tokenizeCompletionText(target);
  if (tokens.length === 0) return null;
  if (
    !options.quoted &&
    !options.allowShort &&
    tokens.length < 2 &&
    !/[\d_-]/.test(target)
  ) {
    return null;
  }
  return target.slice(0, 160);
}

export function workflowConfirmationMatchesTarget(
  event: Extract<CompletionEvidence, { type: "confirmation_state" }>,
  targetLabel: string | undefined,
): boolean {
  if (!targetLabel) return true;
  if (
    event.detail.source === "target_disappearance" ||
    event.detail.source === "form_disappearance" ||
    event.detail.source === "created_row"
  ) {
    return workflowTargetLabelCoveredByText(
      targetLabel,
      event.detail.targetText || event.detail.text,
    );
  }
  if (
    event.detail.source === "visible_text" &&
    isTargetAwareVisibleWorkflowAction(event.detail.action)
  ) {
    if (
      isTransactionalConfirmationAction(event.detail.action) &&
      extractTransactionalConfirmationSnippet(event.detail.text) &&
      workflowTargetIsTransactional(targetLabel) &&
      !workflowTargetHasSpecificTransactionalToken(targetLabel)
    ) {
      return true;
    }
    if (
      visibleWorkflowConfirmationMatchesTarget(
        event.detail.text,
        event.detail.action,
        targetLabel,
      )
    ) {
      return true;
    }
    return visibleTransactionalConfirmationMatchesTarget(
      event.detail.text,
      event.detail.action,
      targetLabel,
    );
  }
  if (
    (event.detail.source === "status_change" ||
      event.detail.source === "control_label_change" ||
      event.detail.source === "control_state_change" ||
      event.detail.source === "dirty_indicator_cleared" ||
      event.detail.source === "submitted_draft_row" ||
      event.detail.source === "invite_row_state" ||
      event.detail.source === "attachment_row_state" ||
      event.detail.source === "import_row_state" ||
      event.detail.source === "duplicate_row_state" ||
      event.detail.source === "download_file_result" ||
      event.detail.source === "download_file_completed" ||
      event.detail.source === "upload_file_result") &&
    event.detail.targetText
  ) {
    return workflowTargetLabelCoveredByText(
      targetLabel,
      event.detail.targetText,
    );
  }
  return true;
}

function isTargetAwareVisibleWorkflowAction(
  action: WorkflowConfirmationAction | undefined,
): action is TargetAwareVisibleWorkflowAction {
  return (
    action !== undefined && TARGET_AWARE_VISIBLE_WORKFLOW_ACTION_SET.has(action)
  );
}

export function workflowTargetLabelCoveredByText(
  targetLabel: string,
  text: string,
): boolean {
  const normalizedTarget = normalizeText(targetLabel);
  const normalizedText = normalizeText(text);
  if (normalizedTarget && normalizedText.includes(normalizedTarget)) {
    return true;
  }

  const targetTokens = tokenizeCompletionText(targetLabel);
  const meaningfulTargetTokens = targetTokens.filter(
    (token) =>
      !/^(?:record|item|items|row|entry|object|button|buttons|link|links|target|action|actions|control|controls|panel|setting|settings|toggle|toggles|switch|switches|checkbox|checkboxes|click|clicking|press|pressing|select|selecting|choose|choosing|use|using|confirm|confirmation|confirmed|delete|deleted|deletion|remove|removed|removal|create|created|creation|update|updated|change|changed|save|saved|cart|basket|bag|product|products|listing|catalog|catalogue|shoe|shoes|coupon|promo|discount|code|status|input|field)$/i.test(
        token,
      ),
  );
  if (
    meaningfulTargetTokens.length > 0 &&
    meaningfulTargetTokens.length < targetTokens.length &&
    meaningfulTargetTokens.every((token) =>
      workflowTargetTokenCoveredByText(normalizedText, token),
    )
  ) {
    return true;
  }
  return (
    targetTokens.length > 0 &&
    targetTokens.every((token) =>
      workflowTargetTokenCoveredByText(normalizedText, token),
    )
  );
}

export function workflowTargetTokenCoveredByText(
  normalizedText: string,
  normalizedToken: string,
): boolean {
  if (valueTokenCoveredBySummary(normalizedText, normalizedToken)) return true;
  if (normalizedToken.endsWith("y")) {
    const plural = `${normalizedToken.slice(0, -1)}ies`;
    if (valueTokenCoveredBySummary(normalizedText, plural)) return true;
  }
  if (!normalizedToken.endsWith("s")) {
    const plural = `${normalizedToken}s`;
    if (valueTokenCoveredBySummary(normalizedText, plural)) return true;
  }
  return false;
}

function visibleWorkflowConfirmationMatchesTarget(
  text: string,
  action: TargetAwareVisibleWorkflowAction,
  targetLabel: string,
): boolean {
  if (
    action === "create" &&
    extractCartCreationSnippet(text) &&
    workflowTargetLabelCoveredByText(targetLabel, text)
  ) {
    return true;
  }

  const candidate = extractVisibleWorkflowConfirmationTarget(
    text,
    action,
    targetLabel,
  );
  if (!candidate) {
    return workflowTargetLabelCoveredByText(targetLabel, text);
  }
  return workflowTargetLabelCoveredByText(targetLabel, candidate);
}

export function visibleTransactionalConfirmationMatchesTarget(
  text: string,
  action: TargetAwareVisibleWorkflowAction,
  targetLabel: string,
): boolean {
  if (!isTransactionalConfirmationAction(action)) return false;
  if (!workflowTargetIsTransactional(targetLabel)) return false;

  const normalizedText = normalizeText(text);
  if (
    !/\b(?:submitted|submission|received|registered|registration|complete|completed|confirmed|confirmation|successful|successfully)\b/i.test(
      normalizedText,
    )
  ) {
    return false;
  }

  const specificTokens = workflowTargetSpecificTransactionalTokens(targetLabel);
  if (specificTokens.length === 0) return false;
  const covered = specificTokens.filter((token) =>
    workflowTargetTokenCoveredByText(normalizedText, token),
  );
  return covered.length >= Math.min(2, specificTokens.length);
}

function extractVisibleWorkflowConfirmationTarget(
  text: string,
  action: TargetAwareVisibleWorkflowAction,
  targetLabel: string,
): string | null {
  const normalizedText = cleanLabel(text);
  if (!normalizedText) return null;

  const targetTokens = tokenizeCompletionText(targetLabel);
  const targetTokenCount = Math.max(1, Math.min(targetTokens.length, 8));
  const resultTerms = workflowTargetVisibleResultPattern(action);
  const nounTerms = workflowTargetVisibleNounPattern(action);
  if (action === "create") {
    const cartState = extractCartCreationSnippet(normalizedText);
    if (cartState) return cartState;
  }
  if (action === "enable") {
    const actionStatusMatches = [
      ...normalizedText.matchAll(
        /\bAction\s*:\s*([a-z0-9][a-z0-9 _-]{0,80}?)(?=\s+[a-z0-9][a-z0-9 _-]{1,40}\s*:|[.!?]|$)/gi,
      ),
    ];
    for (const match of actionStatusMatches) {
      const candidate =
        normalizeWorkflowTargetLabel(match[1] ?? "", { allowShort: true }) ??
        normalizeWorkflowTargetHead(match[1] ?? "", targetTokenCount);
      if (
        candidate &&
        workflowTargetLabelCoveredByText(targetLabel, candidate)
      ) {
        return candidate;
      }
    }
    const firstCandidate =
      normalizeWorkflowTargetLabel(actionStatusMatches[0]?.[1] ?? "", {
        allowShort: true,
      }) ??
      normalizeWorkflowTargetHead(
        actionStatusMatches[0]?.[1] ?? "",
        targetTokenCount,
      );
    if (firstCandidate) return firstCandidate;
  }
  const beforeResult = new RegExp(
    `(.{2,180}?)\\s+(?:was\\s+)?${resultTerms}\\s+(?:successfully|complete|completed|confirmed)\\b`,
    "i",
  ).exec(normalizedText)?.[1];
  const beforeCandidate = normalizeWorkflowTargetTail(
    beforeResult ?? "",
    targetTokenCount,
  );
  if (beforeCandidate) return beforeCandidate;

  const afterResult = new RegExp(
    `\\b${resultTerms}\\s+(.{2,180}?)\\s+(?:successfully|complete|completed|confirmed)\\b`,
    "i",
  ).exec(normalizedText)?.[1];
  const afterCandidate = normalizeWorkflowTargetHead(
    afterResult ?? "",
    targetTokenCount,
  );
  if (afterCandidate) return afterCandidate;

  const beforeNoun = new RegExp(
    `(.{2,180}?)\\s+${nounTerms}\\s+(?:complete|completed|confirmed|successful)\\b`,
    "i",
  ).exec(normalizedText)?.[1];
  return normalizeWorkflowTargetTail(beforeNoun ?? "", targetTokenCount);
}

function workflowTargetVisibleResultPattern(
  action: TargetAwareVisibleWorkflowAction,
): string {
  switch (action) {
    case "delete":
      return "(?:deleted|removed)";
    case "archive":
      return "(?:archived)";
    case "save":
      return "(?:saved)";
    case "send":
      return "(?:sent)";
    case "export":
      return "(?:exported)";
    case "download":
      return "(?:downloaded)";
    case "upload":
      return "(?:uploaded)";
    case "import":
      return "(?:imported)";
    case "attach":
      return "(?:attached)";
    case "detach":
      return "(?:detached)";
    case "copy":
      return "(?:copied)";
    case "transfer":
      return "(?:transferred)";
    case "move":
      return "(?:moved)";
    case "rename":
      return "(?:renamed)";
    case "merge":
      return "(?:merged)";
    case "schedule":
      return "(?:scheduled)";
    case "unschedule":
      return "(?:unscheduled)";
    case "deploy":
      return "(?:deployed)";
    case "rollback":
      return "(?:rolled\\s+back|reverted)";
    case "backup":
      return "(?:backed\\s+up)";
    case "reset":
      return "(?:reset)";
    case "suspend":
      return "(?:suspended)";
    case "unsuspend":
      return "(?:unsuspended)";
    case "block":
      return "(?:blocked)";
    case "unblock":
      return "(?:unblocked)";
    case "link":
      return "(?:linked)";
    case "unlink":
      return "(?:unlinked)";
    case "tag":
      return "(?:tagged)";
    case "untag":
      return "(?:untagged)";
    case "flag":
      return "(?:flagged)";
    case "unflag":
      return "(?:unflagged)";
    case "duplicate":
      return "(?:duplicated|cloned)";
    case "restore":
      return "(?:restored|recovered|reinstated)";
    case "create":
      return "(?:created|added|registered)";
    case "share":
      return "(?:shared)";
    case "grant":
      return "(?:granted)";
    case "revoke":
      return "(?:revoked)";
    case "install":
      return "(?:installed)";
    case "uninstall":
      return "(?:uninstalled)";
    case "connect":
      return "(?:connected)";
    case "disconnect":
      return "(?:disconnected)";
    case "sync":
      return "(?:synced|resynced|synchroni[sz]ed)";
    case "invite":
      return "(?:invited)";
    case "subscribe":
      return "(?:subscribed)";
    case "unsubscribe":
      return "(?:unsubscribed)";
    case "pin":
      return "(?:pinned)";
    case "unpin":
      return "(?:unpinned)";
    case "mute":
      return "(?:muted)";
    case "unmute":
      return "(?:unmuted)";
    case "follow":
      return "(?:followed)";
    case "unfollow":
      return "(?:unfollowed)";
    case "bookmark":
      return "(?:bookmarked)";
    case "unbookmark":
      return "(?:unbookmarked)";
    case "favorite":
      return "(?:favorited)";
    case "unfavorite":
      return "(?:unfavorited)";
    case "like":
      return "(?:liked)";
    case "unlike":
      return "(?:unliked)";
    case "upvote":
      return "(?:upvoted)";
    case "downvote":
      return "(?:downvoted)";
    case "watch":
      return "(?:watched)";
    case "unwatch":
      return "(?:unwatched)";
    case "star":
      return "(?:starred)";
    case "unstar":
      return "(?:unstarred)";
    case "post":
      return "(?:posted|published)";
    case "approve":
      return "(?:approved)";
    case "reject":
      return "(?:rejected|denied)";
    case "close":
      return "(?:closed|resolved)";
    case "reopen":
      return "(?:re[-\\s]?opened)";
    case "cancel":
      return "(?:cancell?ed)";
    case "enable":
      return "(?:enabled|activated)";
    case "disable":
      return "(?:disabled|deactivated)";
    case "assign":
      return "(?:assigned)";
    case "unassign":
      return "(?:unassigned|assignee\\s+(?:cleared|removed))";
    case "escalate":
      return "(?:escalated)";
    case "deescalate":
      return "(?:de[-\\s]?escalated)";
    case "lock":
      return "(?:locked)";
    case "unlock":
      return "(?:unlocked)";
    case "pause":
      return "(?:paused)";
    case "resume":
      return "(?:resumed)";
    case "start":
      return "(?:started)";
    case "stop":
      return "(?:stopped)";
    case "restart":
      return "(?:restarted)";
    case "refresh":
      return "(?:refreshed)";
    case "update":
      return "(?:updated|changed|applied)";
    case "submit":
      return "(?:submitted)";
    case "complete":
      return "(?:completed)";
  }
}

function workflowTargetVisibleNounPattern(
  action: TargetAwareVisibleWorkflowAction,
): string {
  switch (action) {
    case "delete":
      return "(?:deletion|removal)";
    case "archive":
      return "(?:archival)";
    case "save":
      return "(?:save)";
    case "send":
      return "(?:send)";
    case "export":
      return "(?:export)";
    case "download":
      return "(?:download)";
    case "upload":
      return "(?:upload)";
    case "import":
      return "(?:import)";
    case "attach":
      return "(?:attach|attachment)";
    case "detach":
      return "(?:detach|detachment)";
    case "copy":
      return "(?:copy)";
    case "transfer":
      return "(?:transfer)";
    case "move":
      return "(?:move)";
    case "rename":
      return "(?:rename)";
    case "merge":
      return "(?:merge)";
    case "schedule":
      return "(?:schedule)";
    case "unschedule":
      return "(?:unschedule)";
    case "deploy":
      return "(?:deploy|deployment)";
    case "rollback":
      return "(?:rollback|roll\\s+back|reversion)";
    case "backup":
      return "(?:backup|back\\s+up)";
    case "reset":
      return "(?:reset)";
    case "suspend":
      return "(?:suspend|suspension)";
    case "unsuspend":
      return "(?:unsuspend|unsuspension)";
    case "block":
      return "(?:block|blocking)";
    case "unblock":
      return "(?:unblock|unblocking)";
    case "link":
      return "(?:link|linking)";
    case "unlink":
      return "(?:unlink|unlinking)";
    case "tag":
      return "(?:tag|tagging)";
    case "untag":
      return "(?:untag|untagging)";
    case "flag":
      return "(?:flag|flagging)";
    case "unflag":
      return "(?:unflag|unflagging)";
    case "duplicate":
      return "(?:duplicate|duplication|clone)";
    case "restore":
      return "(?:restore|restoration|recover|recovery|reinstate|reinstatement)";
    case "create":
      return "(?:create|creation|add|registration|register)";
    case "share":
      return "(?:share|sharing)";
    case "grant":
      return "(?:grant|access|permission|role|license|licence|entitlement|membership)";
    case "revoke":
      return "(?:revoke|revocation|access|permission|role|license|licence|entitlement|membership)";
    case "install":
      return "(?:install|installation)";
    case "uninstall":
      return "(?:uninstall|uninstallation)";
    case "connect":
      return "(?:connect|connection)";
    case "disconnect":
      return "(?:disconnect|disconnection)";
    case "sync":
      return "(?:sync|resync|synchronization|synchronisation)";
    case "invite":
      return "(?:invite|invitation)";
    case "subscribe":
      return "(?:subscribe|subscription)";
    case "unsubscribe":
      return "(?:unsubscribe|unsubscription)";
    case "pin":
      return "(?:pin)";
    case "unpin":
      return "(?:unpin)";
    case "mute":
      return "(?:mute)";
    case "unmute":
      return "(?:unmute)";
    case "follow":
      return "(?:follow)";
    case "unfollow":
      return "(?:unfollow)";
    case "bookmark":
      return "(?:bookmark)";
    case "unbookmark":
      return "(?:unbookmark)";
    case "favorite":
      return "(?:favorite)";
    case "unfavorite":
      return "(?:unfavorite)";
    case "like":
      return "(?:like)";
    case "unlike":
      return "(?:unlike)";
    case "upvote":
      return "(?:upvote)";
    case "downvote":
      return "(?:downvote)";
    case "watch":
      return "(?:watch)";
    case "unwatch":
      return "(?:unwatch)";
    case "star":
      return "(?:star)";
    case "unstar":
      return "(?:unstar)";
    case "post":
      return "(?:post|publish)";
    case "approve":
      return "(?:approval)";
    case "reject":
      return "(?:rejection|denial)";
    case "close":
      return "(?:closure|resolution)";
    case "reopen":
      return "(?:re[-\\s]?opening|re[-\\s]?open)";
    case "cancel":
      return "(?:cancellation)";
    case "enable":
      return "(?:enable|activation)";
    case "disable":
      return "(?:disable|deactivation)";
    case "assign":
      return "(?:assignment)";
    case "unassign":
      return "(?:unassign|assignment)";
    case "escalate":
      return "(?:escalation|escalate)";
    case "deescalate":
      return "(?:de[-\\s]?escalation|de[-\\s]?escalate)";
    case "lock":
      return "(?:lock)";
    case "unlock":
      return "(?:unlock)";
    case "pause":
      return "(?:pause)";
    case "resume":
      return "(?:resume)";
    case "start":
      return "(?:start)";
    case "stop":
      return "(?:stop)";
    case "restart":
      return "(?:restart)";
    case "refresh":
      return "(?:refresh)";
    case "update":
      return "(?:update|change)";
    case "submit":
      return "(?:submission|submit)";
    case "complete":
      return "(?:completion|complete)";
  }
}

function normalizeWorkflowTargetTail(
  value: string,
  tokenCount: number,
): string | null {
  return normalizeWorkflowTargetTokenSlice(value, tokenCount, "tail");
}

function normalizeWorkflowTargetHead(
  value: string,
  tokenCount: number,
): string | null {
  return normalizeWorkflowTargetTokenSlice(value, tokenCount, "head");
}

function normalizeWorkflowTargetTokenSlice(
  value: string,
  tokenCount: number,
  side: "head" | "tail",
): string | null {
  const raw = cleanLabel(value);
  const allowGenericObjectShortTarget =
    /\b(?:record|item|row|entry|object|button|link)\b/i.test(raw);
  const cleaned = raw
    .replace(
      /\b(?:the|this|that|selected|current|visible|target|record|item|row|entry|object|button|link|delete|remove|archive|cancel|was|has|been)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const words = cleaned.split(/\s+/g).filter(Boolean);
  if (words.length === 0) return null;
  const selected =
    side === "head"
      ? words.slice(0, tokenCount)
      : words.slice(Math.max(0, words.length - tokenCount));
  return normalizeWorkflowTargetLabel(selected.join(" "), {
    allowShort: tokenCount <= 1 || allowGenericObjectShortTarget,
  });
}

function isCompleteWorkflowRequest(value: string): boolean {
  const text = normalizeText(value);
  return (
    /\b(?:mark(?:ed)?|set)\b.{0,40}\bcomplete(?:d)?\b/i.test(text) ||
    /\bcomplete(?:d)?\s+(?:the\s+)?(?:task|item|record|request|ticket|todo|to-do)\b/i.test(
      text,
    )
  );
}

export function isTransactionalConfirmationAction(
  action: WorkflowConfirmationAction | undefined,
): action is "submit" | "complete" {
  return action === "submit" || action === "complete";
}

export function workflowTargetIsTransactional(targetLabel: string): boolean {
  return /\b(?:order|checkout|purchase|payment|transaction|submission|registration|application|form|confirmation|receipt|booking|reservation|request|log\s*in|login|sign\s*in|signin|authenticated?|dashboard)\b/i.test(
    normalizeText(targetLabel),
  );
}

export function workflowTargetSpecificTransactionalTokens(
  targetLabel: string,
): string[] {
  const generic = new Set([
    "order",
    "checkout",
    "purchase",
    "payment",
    "transaction",
    "submission",
    "registration",
    "application",
    "form",
    "confirmation",
    "receipt",
    "booking",
    "reservation",
    "request",
    "login",
    "signin",
    "authenticated",
    "dashboard",
    "submit",
    "submitted",
    "complete",
    "completed",
    "success",
    "successful",
    "successfully",
    "received",
    "registered",
    "email",
    "phone",
    "role",
    "team",
    "terms",
    "accept",
    "accepted",
    "code",
    "invite",
  ]);
  return tokenizeCompletionText(targetLabel).filter(
    (token) => !generic.has(token),
  );
}

function workflowTargetHasSpecificTransactionalToken(
  targetLabel: string,
): boolean {
  return workflowTargetSpecificTransactionalTokens(targetLabel).length > 0;
}

export function inferTargetDisappearanceAction(
  element: TaggedElement,
): Extract<
  WorkflowConfirmationAction,
  | "delete"
  | "archive"
  | "attach"
  | "detach"
  | "disconnect"
  | "connect"
  | "sync"
  | "transfer"
  | "move"
  | "rename"
  | "merge"
  | "unlink"
  | "link"
  | "untag"
  | "tag"
  | "unflag"
  | "flag"
  | "unsubscribe"
  | "subscribe"
  | "unfollow"
  | "follow"
  | "unwatch"
  | "watch"
  | "unstar"
  | "star"
  | "unbookmark"
  | "bookmark"
  | "unfavorite"
  | "favorite"
  | "unpin"
  | "pin"
  | "unmute"
  | "mute"
  | "unschedule"
  | "schedule"
  | "unassign"
  | "assign"
  | "cancel"
  | "unlock"
  | "lock"
  | "enable"
  | "disable"
  | "pause"
  | "resume"
  | "start"
  | "stop"
  | "restart"
  | "refresh"
  | "approve"
  | "reject"
  | "close"
  | "reopen"
  | "escalate"
  | "deescalate"
  | "complete"
  | "submit"
  | "send"
  | "post"
  | "update"
  | "save"
  | "export"
  | "download"
  | "upload"
  | "import"
  | "copy"
  | "share"
  | "restore"
  | "duplicate"
  | "invite"
  | "grant"
  | "revoke"
  | "unblock"
  | "block"
  | "unsuspend"
  | "suspend"
  | "backup"
  | "deploy"
  | "rollback"
  | "reset"
  | "install"
  | "uninstall"
> | null {
  const text = normalizeText(elementControlText(element));
  if (/\buninstall(?:ed|ation)?\b/i.test(text)) return "uninstall";
  if (/\binstall(?:ed|ing|ation)?\b/i.test(text)) return "install";
  if (/\b(?:back\s+up|backup|backed\s+up|backing\s+up)\b/i.test(text)) {
    return "backup";
  }
  if (/\bdeploy(?:ed|ing|ment)?\b/i.test(text)) return "deploy";
  if (
    /\b(?:rollback|roll\s+back|rolled\s+back|rolling\s+back|revert(?:ed|ing)?|reversion)\b/i.test(
      text,
    )
  ) {
    return "rollback";
  }
  if (/\breset(?:ting)?\b/i.test(text)) return "reset";
  if (/\bunsuspend(?:ed|ing|sion)?\b/i.test(text)) return "unsuspend";
  if (/\bsuspend(?:ed|ing|sion)?\b/i.test(text)) return "suspend";
  if (/\bdisconnect(?:ed|ing|ion)?\b/i.test(text)) return "disconnect";
  if (/\bconnect(?:ed|ing|ion)?\b/i.test(text)) return "connect";
  if (/\bsync(?:ed|ing|hroniz(?:e|ed|ing|ation))?\b/i.test(text)) {
    return "sync";
  }
  if (/\btransfer(?:red|ring)?\b/i.test(text)) return "transfer";
  if (/\bmove(?:d|ing)?\b/i.test(text)) return "move";
  if (/\brename(?:d|ing)?\b/i.test(text)) return "rename";
  if (/\b(?:merge|merged|merging)\b/i.test(text)) return "merge";
  if (/\bunblock(?:ed|ing)?\b/i.test(text)) return "unblock";
  if (/\bblock(?:ed|ing)?\b/i.test(text)) return "block";
  if (/\buntag(?:ged|ging)?\b/i.test(text)) return "untag";
  if (/\btag(?:ged|ging)?\b/i.test(text)) return "tag";
  if (/\bunflag(?:ged|ging)?\b/i.test(text)) return "unflag";
  if (/\bflag(?:ged|ging)?\b/i.test(text)) return "flag";
  if (/\bunsubscribe(?:d|s|r|rs|ing|tion)?\b/i.test(text)) {
    return "unsubscribe";
  }
  if (/\bsubscribe(?:d|s|r|rs|ing|tion)?\b/i.test(text)) {
    return "subscribe";
  }
  if (/\bunfollow(?:ed|ing)?\b/i.test(text)) return "unfollow";
  if (/\bfollow(?:ed|ing|s|er|ers)?\b/i.test(text)) return "follow";
  if (/\bunwatch(?:ed|ing)?\b/i.test(text)) return "unwatch";
  if (/\bwatch(?:ed|ing|es|er|ers)?\b/i.test(text)) return "watch";
  if (/\bunstar(?:red|ring)?\b/i.test(text)) return "unstar";
  if (/\bstar(?:red|ring|s)?\b/i.test(text)) return "star";
  if (/\bunbookmark(?:ed|ing)?\b/i.test(text)) return "unbookmark";
  if (/\bbookmark(?:ed|ing|s)?\b/i.test(text)) return "bookmark";
  if (/\bunfavorite(?:d|ing)?\b/i.test(text)) return "unfavorite";
  if (/\bfavorite(?:d|ing|s)?\b/i.test(text)) return "favorite";
  if (/\bunpin(?:ned|ning)?\b/i.test(text)) return "unpin";
  if (/\bpin(?:ned|ning|s)?\b/i.test(text)) return "pin";
  if (/\bunmute(?:d|ing)?\b/i.test(text)) return "unmute";
  if (/\bmute(?:d|ing|s)?\b/i.test(text)) return "mute";
  if (/\bunschedule(?:d|ing)?\b/i.test(text)) return "unschedule";
  if (/\bschedule(?:d|ing)?\b/i.test(text)) return "schedule";
  if (/\bunassign(?:ed|ing)?\b/i.test(text)) return "unassign";
  if (/\bassign(?:ed|ing)?\b/i.test(text)) return "assign";
  if (/\b(?:cancel|canceled|cancelled|cancellation)\b/i.test(text)) {
    return "cancel";
  }
  if (/\bunlock(?:ed|ing)?\b/i.test(text)) return "unlock";
  if (/\block(?:ed|ing)?\b/i.test(text)) return "lock";
  if (/\b(?:enable|enabled|activate|activated)\b/i.test(text)) {
    return "enable";
  }
  if (/\b(?:disable|disabled|deactivate|deactivated)\b/i.test(text)) {
    return "disable";
  }
  if (/\bpause(?:d|ing)?\b/i.test(text)) return "pause";
  if (/\bresume(?:d|ing)?\b/i.test(text)) return "resume";
  if (/\bstart(?:ed|ing)?\b/i.test(text)) return "start";
  if (/\bstop(?:ped|ping)?\b/i.test(text)) return "stop";
  if (/\brestart(?:ed|ing)?\b/i.test(text)) return "restart";
  if (/\brefresh(?:ed|ing)?\b/i.test(text)) return "refresh";
  if (/\b(?:approve|approved|approving|approval)\b/i.test(text)) {
    return "approve";
  }
  if (
    /\b(?:reject|rejected|rejecting|rejection|deny|denied|denial)\b/i.test(text)
  ) {
    return "reject";
  }
  if (
    /\b(?:close|closed|closing|closure|resolve|resolved|resolving|resolution)\b/i.test(
      text,
    )
  ) {
    return "close";
  }
  if (/\bre[-\s]?open(?:ed|ing)?\b/i.test(text)) return "reopen";
  if (/\bde[-\s]?escalat(?:e|ed|ing|ion)\b/i.test(text)) {
    return "deescalate";
  }
  if (/\bescalat(?:e|ed|ing|ion)\b/i.test(text)) return "escalate";
  if (isCompleteWorkflowRequest(text)) return "complete";
  if (
    /\b(?:submit|submitted|submission|place\s+order|placed\s+order|checkout|purchase|purchased|order\s+confirmation)\b/i.test(
      text,
    )
  ) {
    return "submit";
  }
  if (/\b(?:send|sent|sending|email|emailed|emailing)\b/i.test(text)) {
    return "send";
  }
  if (/\b(?:post|posted|posting|publish|published|publishing)\b/i.test(text)) {
    return "post";
  }
  if (/\b(?:update|updated|updating|apply|applied|applying)\b/i.test(text)) {
    return "update";
  }
  if (/\b(?:save|saved|saving)\b/i.test(text)) return "save";
  if (/\bexport(?:ed|ing)?\b/i.test(text)) return "export";
  if (/\bdownload(?:ed|ing)?\b/i.test(text)) return "download";
  if (/\bupload(?:ed|ing)?\b/i.test(text)) return "upload";
  if (/\bimport(?:ed|ing)?\b/i.test(text)) return "import";
  if (/\b(?:copy|copied|copying)\b/i.test(text)) return "copy";
  if (/\bshare(?:d|ing)?\b/i.test(text)) return "share";
  if (
    /\b(?:restore|restored|restoring|recover|recovered|recovering|reinstate|reinstated|reinstating)\b/i.test(
      text,
    )
  ) {
    return "restore";
  }
  if (
    /\b(?:duplicate|duplicated|duplicating|duplication|clone|cloned|cloning)\b/i.test(
      text,
    )
  ) {
    return "duplicate";
  }
  if (/\binvit(?:e|ed|ing|ation)\b/i.test(text)) return "invite";
  if (/\bgrant(?:ed|ing)?\b/i.test(text)) return "grant";
  if (/\battach(?:ed|ing|ment)?\b/i.test(text)) return "attach";
  if (/\bunlink(?:ed|ing)?\b/i.test(text)) return "unlink";
  if (/\blink(?:ed|ing)?\b/i.test(text)) return "link";
  if (/\bdetach(?:ed|ment)?\b/i.test(text)) return "detach";
  if (/\brevok(?:e|ed|ing|ation)\b/i.test(text)) return "revoke";
  if (/\b(?:delete|remove)\b/i.test(text)) return "delete";
  if (/\barchive\b/i.test(text)) return "archive";
  return null;
}

export function inferDraftSubmissionAction(
  element: TaggedElement,
): Extract<WorkflowConfirmationAction, "send" | "post"> | null {
  const text = normalizeText(elementControlText(element));
  if (!text) return null;
  if (/\b(?:post|publish)\b/i.test(text)) return "post";
  if (/\b(?:send|email)\b/i.test(text)) return "send";
  if (/\b(?:comment|reply)\b/i.test(text)) return "post";
  if (/\bmessage\b/i.test(text)) return "send";
  return null;
}

export type StatusChangeWorkflowAction = Extract<
  WorkflowConfirmationAction,
  | "approve"
  | "reject"
  | "post"
  | "close"
  | "reopen"
  | "cancel"
  | "enable"
  | "disable"
  | "assign"
  | "unassign"
  | "escalate"
  | "deescalate"
  | "lock"
  | "unlock"
  | "pause"
  | "resume"
  | "start"
  | "stop"
  | "submit"
  | "complete"
>;

export function inferStatusChangeAction(
  element: TaggedElement,
): StatusChangeWorkflowAction | null {
  const text = normalizeText(elementControlText(element));
  if (!text) return null;
  if (/\b(?:approve|approved)\b/i.test(text)) return "approve";
  if (/\b(?:reject|rejected|deny|denied)\b/i.test(text)) return "reject";
  if (/\b(?:post|posted|publish|published)\b/i.test(text)) return "post";
  if (/\bre[-\s]?open(?:ed)?\b/i.test(text)) return "reopen";
  if (/\b(?:cancel|canceled|cancelled|cancellation)\b/i.test(text)) {
    return "cancel";
  }
  if (/\b(?:enable|enabled|activate|activated)\b/i.test(text)) {
    return "enable";
  }
  if (/\b(?:disable|disabled|deactivate|deactivated)\b/i.test(text)) {
    return "disable";
  }
  if (/\bunassign(?:ed)?\b/i.test(text)) return "unassign";
  if (/\bassign(?:ed)?\b/i.test(text)) return "assign";
  if (/\bde[-\s]?escalat(?:e|ed)\b/i.test(text)) return "deescalate";
  if (/\bescalat(?:e|ed)\b/i.test(text)) return "escalate";
  if (/\bunlock(?:ed)?\b/i.test(text)) return "unlock";
  if (/\block(?:ed)?\b/i.test(text)) return "lock";
  if (/\bpause(?:d)?\b/i.test(text)) return "pause";
  if (/\bresume(?:d)?\b/i.test(text)) return "resume";
  if (/\bstart(?:ed)?\b/i.test(text)) return "start";
  if (/\bstop(?:ped)?\b/i.test(text)) return "stop";
  if (/\b(?:close|closed|resolve|resolved)\b/i.test(text)) return "close";
  if (/\b(?:submit|submitted)\b/i.test(text)) return "submit";
  if (isCompleteWorkflowRequest(text)) return "complete";
  return null;
}

export function inferSaveUpdateAction(
  element: TaggedElement,
): Extract<WorkflowConfirmationAction, "save" | "update"> | null {
  const text = normalizeText(elementControlText(element));
  if (!text) return null;
  if (/\b(?:update|apply changes|apply)\b/i.test(text)) return "update";
  if (/\b(?:save|save changes)\b/i.test(text)) return "save";
  return null;
}

export function inferControlLabelChangeAction(
  element: TaggedElement,
): WorkflowConfirmationAction | null {
  return (
    inferStatusChangeAction(element) ??
    inferSaveUpdateAction(element) ??
    inferDraftSubmissionAction(element) ??
    inferTargetDisappearanceAction(element) ??
    (isDismissalControl(element) ? "dismiss" : null)
  );
}

export function inferControlStateChangeAction(
  element: TaggedElement,
): ControlStateWorkflowAction | null {
  const primaryText = normalizeText(
    [
      element.text,
      element.attributes.label,
      element.attributes["aria-label"],
      element.attributes.title,
      element.attributes.name,
      element.attributes.value,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const text = primaryText || normalizeText(elementControlText(element));
  if (!text) return null;
  if (
    /\b(?:reject|rejected|rejecting|rejection|deny|denied|denial)\b/i.test(text)
  ) {
    return "reject";
  }
  if (/\b(?:approve|approved|approving|approval)\b/i.test(text)) {
    return "approve";
  }
  if (/\bre[-\s]?open(?:ed|ing)?\b/i.test(text)) return "reopen";
  if (
    /\bdismiss(?:ed|es|ing|al)?\b/i.test(text) ||
    /\b(?:hide|hid|hidden|hiding|clear|cleared|clearing|close|closed|closing|cancel|canceled|cancelled|remove|removed|removing)\b.{0,50}\b(?:popup|pop[-\s]?up|modal|dialog|overlay|banner|toast|notification|notice)\b/i.test(
      text,
    ) ||
    /\b(?:popup|pop[-\s]?up|modal|dialog|overlay|banner|toast|notification|notice)\b.{0,50}\b(?:hide|hid|hidden|hiding|clear|cleared|clearing|close|closed|closing|cancel|canceled|cancelled|remove|removed|removing)\b/i.test(
      text,
    )
  ) {
    return "dismiss";
  }
  if (
    /\b(?:close|closed|closing|closure|resolve|resolved|resolving|resolution)\b/i.test(
      text,
    )
  ) {
    return "close";
  }
  if (/\b(?:cancel|canceled|cancelled|cancellation)\b/i.test(text)) {
    return "cancel";
  }
  if (
    /\bdelete(?:d|s|ing|ion)?\b/i.test(text) ||
    /\bremov(?:e|ed|es|ing|al)\b\s+(?:the\s+)?(?:record|item|row|entry|task|ticket|request|file|document|report|account|user|project|case|issue|incident|comment|message|page|profile|contact|customer)\b/i.test(
      text,
    )
  ) {
    return "delete";
  }
  if (
    /\b(?:duplicate|duplicated|duplicating|duplication|clone|cloned|cloning)\b/i.test(
      text,
    )
  ) {
    return "duplicate";
  }
  if (/\b(?:copy|copies|copied|copying)\b/i.test(text)) return "copy";
  if (/\btransfer(?:red|ring)?\b/i.test(text)) return "transfer";
  if (/\bmove(?:d|s|ing)?\b/i.test(text)) return "move";
  if (/\brename(?:d|s|ing)?\b/i.test(text)) return "rename";
  if (/\bmerge(?:d|s|ing)?\b/i.test(text)) return "merge";
  if (
    /\b(?:create|created|creating|creation|register|registered|registering|registration)\b/i.test(
      text,
    ) ||
    /\badd(?:ed|ing)?\b\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|workflow|rule|dashboard|view|list|policy|profile|account|user|order|case|issue|incident|project|contact|customer)\b/i.test(
      text,
    )
  ) {
    return "create";
  }
  if (/\bdetach(?:ed|es|ing|ment)?\b/i.test(text)) return "detach";
  if (/\battach(?:ed|es|ing|ment)?\b/i.test(text)) return "attach";
  if (
    /\b(?:restore|restored|recover|recovered|reinstate|reinstated|unarchive|unarchived)\b/i.test(
      text,
    )
  ) {
    return "restore";
  }
  if (/\b(?:archive|archived|archival)\b/i.test(text)) return "archive";
  if (/\bde[-\s]?escalat(?:e|ed|ing|ion)\b/i.test(text)) {
    return "deescalate";
  }
  if (/\bescalat(?:e|ed|ing|ion)\b/i.test(text)) return "escalate";
  if (/\b(?:enable|activate|turn\s+on)\b/i.test(text)) return "enable";
  if (/\b(?:disable|deactivate|turn\s+off)\b/i.test(text)) return "disable";
  if (/\bunlock(?:ed)?\b/i.test(text)) return "unlock";
  if (/\block(?:ed)?\b/i.test(text)) return "lock";
  if (/\bunblock(?:ed|ing)?\b/i.test(text)) return "unblock";
  if (/\bblock(?:ed|ing)?\b/i.test(text)) return "block";
  if (/\bunassign(?:ed|ing)?\b/i.test(text)) return "unassign";
  if (/\bassign(?:ed|ing)?\b/i.test(text)) return "assign";
  if (/\b(?:revoke|revoked|revoking|revocation)\b/i.test(text)) {
    return "revoke";
  }
  if (/\bgrant(?:ed|ing)?\b/i.test(text)) return "grant";
  if (/\bunsuspend(?:ed|ing|sion)?\b/i.test(text)) return "unsuspend";
  if (/\bsuspend(?:ed|ing|sion)?\b/i.test(text)) return "suspend";
  if (/\bunschedule(?:d|ing)?\b/i.test(text)) return "unschedule";
  if (/\bschedule(?:d|ing)?\b/i.test(text)) return "schedule";
  if (/\bdisconnect(?:ed|ing|ion)?\b/i.test(text)) return "disconnect";
  if (/\bconnect(?:ed|ing|ion)?\b/i.test(text)) return "connect";
  if (/\bunlink(?:ed|ing)?\b/i.test(text)) return "unlink";
  if (/\blink(?:ed|ing)?\b/i.test(text)) return "link";
  if (/\buntag(?:ged|ging)?\b/i.test(text)) return "untag";
  if (/\btag(?:ged|ging)?\b/i.test(text)) return "tag";
  if (/\bunflag(?:ged|ging)?\b/i.test(text)) return "unflag";
  if (/\bflag(?:ged|ging)?\b/i.test(text)) return "flag";
  if (/\bexport(?:ed|ing|s)?\b/i.test(text)) return "export";
  if (/\bdownload(?:ed|ing|s)?\b/i.test(text)) return "download";
  if (/\bupload(?:ed|ing|s)?\b/i.test(text)) return "upload";
  if (/\bimport(?:ed|ing|s)?\b/i.test(text)) return "import";
  if (/\buninstall(?:ed|ing|ation)?\b/i.test(text)) return "uninstall";
  if (/\binstall(?:ed|ing|ation)?\b/i.test(text)) return "install";
  if (/\b(?:sync|resync|synchroni[sz]e)(?:ed|ing|ation)?\b/i.test(text)) {
    return "sync";
  }
  if (/\bunsubscribe(?:d|s|r|rs|ing|tion)?\b/i.test(text)) {
    return "unsubscribe";
  }
  if (/\bsubscribe(?:d|s|r|rs|ing|tion)?\b/i.test(text)) {
    return "subscribe";
  }
  if (/\bunfollow(?:ed|ing)?\b/i.test(text)) return "unfollow";
  if (/\bfollow(?:ed|ing|s)?\b/i.test(text)) return "follow";
  if (/\bunbookmark(?:ed|ing)?\b/i.test(text)) return "unbookmark";
  if (/\bbookmark(?:ed|ing|s)?\b/i.test(text)) return "bookmark";
  if (/\bunfavorite(?:d|ing)?\b/i.test(text)) return "unfavorite";
  if (/\bfavou?rite(?:d|ing|s)?\b/i.test(text)) return "favorite";
  if (/\bunlike(?:d|ing)?\b/i.test(text)) return "unlike";
  if (/\blike(?:d|ing|s)?\b/i.test(text)) return "like";
  if (/\bdownvote(?:d|ing|s)?\b/i.test(text)) return "downvote";
  if (/\bupvote(?:d|ing|s)?\b/i.test(text)) return "upvote";
  if (/\bunwatch(?:ed|ing)?\b/i.test(text)) return "unwatch";
  if (/\bwatch(?:ed|ing|es)?\b/i.test(text)) return "watch";
  if (/\bunstar(?:red|ring)?\b/i.test(text)) return "unstar";
  if (/\bstar(?:red|ring|s)?\b/i.test(text)) return "star";
  if (/\bunpin(?:ned|ning)?\b/i.test(text)) return "unpin";
  if (/\bpin(?:ned|ning|s)?\b/i.test(text)) return "pin";
  if (/\bunmute(?:d|ing)?\b/i.test(text)) return "unmute";
  if (/\bmute(?:d|ing|s)?\b/i.test(text)) return "mute";
  if (/\bpause(?:d|ing)?\b/i.test(text)) return "pause";
  if (/\bresume(?:d|ing)?\b/i.test(text)) return "resume";
  if (/\brestart(?:ed|ing)?\b/i.test(text)) return "restart";
  if (/\brefresh(?:ed|ing)?\b/i.test(text)) return "refresh";
  if (
    /\b(?:rollback|roll\s+back|rolled\s+back|rolling\s+back|revert(?:ed|ing)?|reversion)\b/i.test(
      text,
    )
  ) {
    return "rollback";
  }
  if (/\bdeploy(?:ed|ing|ment)?\b/i.test(text)) return "deploy";
  if (/\b(?:back\s+up|backup|backed\s+up|backing\s+up)\b/i.test(text)) {
    return "backup";
  }
  if (/\breset(?:ting)?\b/i.test(text)) return "reset";
  if (isCompleteWorkflowRequest(text)) return "complete";
  if (
    /\b(?:submit|submitted|submission|place\s+order|placed\s+order|checkout|purchase|purchased|order\s+confirmation)\b/i.test(
      text,
    )
  ) {
    return "submit";
  }
  if (/\b(?:post|posted|posting|publish|published|publishing)\b/i.test(text)) {
    return "post";
  }
  if (/\b(?:save|saved|saving)\b/i.test(text)) return "save";
  if (/\b(?:update|updated|updating|apply|applied|applying)\b/i.test(text)) {
    return "update";
  }
  if (/\bshare(?:d|s|ing)?\b/i.test(text)) return "share";
  if (/\binvit(?:e|ed|es|ing|ation)\b/i.test(text)) return "invite";
  if (/\b(?:send|sent|sending|email|emailed|emailing)\b/i.test(text)) {
    return "send";
  }
  if (/\bstart(?:ed|ing)?\b/i.test(text)) return "start";
  if (/\bstop(?:ped|ping)?\b/i.test(text)) return "stop";
  return null;
}

export function elementControlText(element: TaggedElement): string {
  return [
    element.text,
    element.attributes.label,
    element.attributes["aria-label"],
    element.attributes.title,
    element.attributes.name,
    element.attributes.id,
    element.attributes.value,
  ]
    .filter(Boolean)
    .join(" ");
}

export function isDismissalControl(element: TaggedElement): boolean {
  const text = normalizeText(elementControlText(element));
  if (!text) return false;
  return /\b(?:close|dismiss|no thanks|not now|cancel|got it|ok|okay|done|hide|skip|continue|accept|accept all|reject|decline|allow)\b/i.test(
    text,
  );
}
