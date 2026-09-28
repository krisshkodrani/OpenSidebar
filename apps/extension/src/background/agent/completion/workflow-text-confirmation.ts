import type { WorkflowConfirmationAction } from "./workflow-confirmation-types";
import { cleanLabel, normalizeText } from "./text-utils";

type WorkflowConfirmationTextMode = "summary" | "visible";

export function extractCartCreationSnippet(value: string): string | null {
  const text = cleanLabel(value);
  if (!text) return null;
  if (/\b(?:cart|basket|bag)\s+(?:is\s+)?empty\b/i.test(text)) return null;
  if (
    !/\b(?:your\s+cart|shopping\s+cart|cart\s*:?\s*[1-9]\d*|basket|bag)\b/i.test(
      text,
    )
  ) {
    return null;
  }
  if (
    !/\b(?:qty|quantity|subtotal|unit\s+\$?\d|items?\b|cart\s*:?\s*[1-9]\d*)\b/i.test(
      text,
    )
  ) {
    return null;
  }

  const anchor =
    /\b(?:your\s+cart|shopping\s+cart)\b/i.exec(text) ??
    /\bcart\s*:?\s*[1-9]\d*\b/i.exec(text) ??
    /\b(?:basket|bag)\b/i.exec(text);
  if (!anchor) return null;
  const start = Math.max(0, anchor.index - 120);
  const end = Math.min(text.length, anchor.index + 900);
  return cleanLabel(text.slice(start, end));
}

export function textConfirmsWorkflowAction(
  value: string,
  action: WorkflowConfirmationAction,
  mode: WorkflowConfirmationTextMode,
): boolean {
  const text = normalizeText(value);
  if (workflowActionTextIsNegated(text, action)) return false;

  switch (action) {
    case "delete":
      if (mode === "visible") {
        return (
          /\b(?:deleted|removed)\s+successfully\b/i.test(text) ||
          /\b(?:deletion|removal)\s+(?:complete|completed|confirmed|successful)\b/i.test(
            text,
          ) ||
          /\b(?:delete|remove)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:deleted|removed|deletion|removal|delete complete|delete completed|delete successful|remove complete|remove completed|remove successful)\b/i.test(
        text,
      );
    case "archive":
      if (mode === "visible") {
        return (
          /\barchived\s+successfully\b/i.test(text) ||
          /\barchival\s+(?:complete|completed|confirmed|successful)\b/i.test(
            text,
          ) ||
          /\barchive\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:archived|archival|archive complete|archive completed|archive successful)\b/i.test(
        text,
      );
    case "save":
      if (mode === "visible") {
        return (
          /\b(?:saved|changes saved)\s+successfully\b/i.test(text) ||
          /\bsuccessfully\s+saved\b/i.test(text) ||
          /\bsave\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:saved|save complete|save completed|save successful)\b/i.test(
        text,
      );
    case "send":
      if (mode === "visible") {
        return (
          /\b(?:sent)\s+successfully\b/i.test(text) ||
          /\b(?:message|email|notification)\s+sent\b/i.test(text) ||
          /\bsend\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:sent|send complete|send completed|send successful)\b/i.test(
        text,
      );
    case "export":
      if (mode === "visible") {
        return (
          /\bexported\s+successfully\b/i.test(text) ||
          /\b(?:file|report|document|csv|pdf|spreadsheet|data|dataset|results?|table|list|view|logs?)\s+exported\b/i.test(
            text,
          ) ||
          /\bexport\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:exported|export complete|export completed|export successful)\b/i.test(
        text,
      );
    case "download":
      if (mode === "visible") {
        return (
          /\bdownloaded\s+successfully\b/i.test(text) ||
          /\b(?:file|report|document|attachment|csv|pdf|spreadsheet|export|data|dataset|results?|invoice|receipt|logs?|archive)\s+downloaded\b/i.test(
            text,
          ) ||
          /\bdownload\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:downloaded|download complete|download completed|download successful)\b/i.test(
        text,
      );
    case "upload":
      if (mode === "visible") {
        return (
          /\buploaded\s+successfully\b/i.test(text) ||
          /\b(?:file|report|document|attachment|image|photo|csv|pdf|spreadsheet|data|dataset|results?|logs?|archive)\s+uploaded\b/i.test(
            text,
          ) ||
          /\bupload\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:uploaded|upload complete|upload completed|upload successful)\b/i.test(
        text,
      );
    case "import":
      if (mode === "visible") {
        return (
          /\bimported\s+successfully\b/i.test(text) ||
          /\b(?:file|report|document|csv|spreadsheet|data|dataset|results?|table|list|view|contacts?|records?|items?)\s+imported\b/i.test(
            text,
          ) ||
          /\bimport\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:imported|import complete|import completed|import successful)\b/i.test(
        text,
      );
    case "attach":
      if (mode === "visible") {
        return (
          /\battached\s+successfully\b/i.test(text) ||
          /\b(?:file|report|document|attachment|image|photo|invoice|receipt|log|logs|record|item|task|ticket|request|entry|row|comment|message|note|account|case|issue)\s+attached\b/i.test(
            text,
          ) ||
          /\battach(?:ment)?\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:attached|attach complete|attach completed|attach successful|attachment complete|attachment completed|attachment successful)\b/i.test(
        text,
      );
    case "detach":
      if (mode === "visible") {
        return (
          /\bdetached\s+successfully\b/i.test(text) ||
          /\b(?:file|report|document|attachment|image|photo|invoice|receipt|log|logs|record|item|task|ticket|request|entry|row|comment|message|note|account|case|issue)\s+detached\b/i.test(
            text,
          ) ||
          /\bdetach(?:ment)?\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:detached|detach complete|detach completed|detach successful|detachment complete|detachment completed|detachment successful)\b/i.test(
        text,
      );
    case "copy":
      if (mode === "visible") {
        return (
          /\bcopied\s+(?:successfully|to\s+clipboard|to\s+the\s+clipboard)\b/i.test(
            text,
          ) ||
          /\b(?:link|url|address|text|code|value|id|identifier|token|key|path|email|phone|file|report|document|message|comment|article|page|record|item|task|ticket|request|entry|row|table|list|view)\s+copied\b/i.test(
            text,
          ) ||
          /\bcopy\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:copied|copy complete|copy completed|copy successful)\b/i.test(
        text,
      );
    case "transfer":
      if (mode === "visible") {
        return (
          /\btransferred\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|folder|document|report|page|workflow|rule|ownership|assignment)\s+transferred\b/i.test(
            text,
          ) ||
          /\btransfer\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:transferred|transfer complete|transfer completed|transfer successful)\b/i.test(
        text,
      );
    case "move":
      if (mode === "visible") {
        return (
          /\bmoved\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|folder|document|report|page|message|comment|thread|conversation|card|column|list|board|workflow|rule)\s+moved\b/i.test(
            text,
          ) ||
          /\bmove\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:moved|move complete|move completed|move successful)\b/i.test(
        text,
      );
    case "rename":
      if (mode === "visible") {
        return (
          /\brenamed\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|folder|document|report|page|message|comment|thread|conversation|card|column|list|board|workflow|rule|profile|workspace)\s+renamed\b/i.test(
            text,
          ) ||
          /\brename\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:renamed|rename complete|rename completed|rename successful)\b/i.test(
        text,
      );
    case "merge":
      if (mode === "visible") {
        return (
          /\bmerged\s+successfully\b/i.test(text) ||
          /\b(?:pull\s+request|merge\s+request|pr|branch|record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|document|report|page|message|comment|thread|conversation|workspace)\s+merged\b/i.test(
            text,
          ) ||
          /\bmerge\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:merged|merge complete|merge completed|merge successful)\b/i.test(
        text,
      );
    case "schedule":
      if (mode === "visible") {
        return (
          /\bscheduled\s+successfully\b/i.test(text) ||
          /\b(?:report|dashboard|job|task|ticket|request|entry|row|case|issue|incident|project|workflow|rule|automation|process|pipeline|message|email|notification|reminder|meeting|event|appointment|sync|backup|export|import|deployment|release)\s+scheduled\b/i.test(
            text,
          ) ||
          /\bschedule\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:scheduled|schedule complete|schedule completed|schedule successful)\b/i.test(
        text,
      );
    case "unschedule":
      if (mode === "visible") {
        return (
          /\bunscheduled\s+successfully\b/i.test(text) ||
          /\b(?:report|dashboard|job|task|ticket|request|entry|row|case|issue|incident|project|workflow|rule|automation|process|pipeline|message|email|notification|reminder|meeting|event|appointment|sync|backup|export|import|deployment|release)\s+unscheduled\b/i.test(
            text,
          ) ||
          /\bunschedule\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unscheduled|unschedule complete|unschedule completed|unschedule successful)\b/i.test(
        text,
      );
    case "deploy":
      if (mode === "visible") {
        return (
          /\bdeployed\s+successfully\b/i.test(text) ||
          /\b(?:app|application|service|site|release|build|version|environment|deployment|package|workflow|pipeline|branch|changes?)\s+deployed\b/i.test(
            text,
          ) ||
          /\bdeploy(?:ment)?\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:deployed|deploy complete|deploy completed|deploy successful|deployment complete|deployment completed|deployment successful)\b/i.test(
        text,
      );
    case "rollback":
      if (mode === "visible") {
        return (
          /\b(?:rolled\s+back|reverted)\s+successfully\b/i.test(text) ||
          /\b(?:app|application|service|site|release|build|version|environment|deployment|package|workflow|pipeline|branch|changes?)\s+(?:rolled\s+back|reverted)\b/i.test(
            text,
          ) ||
          /\b(?:rollback|roll\s+back|reversion)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:rolled\s+back|reverted|rollback complete|rollback completed|rollback successful|roll back complete|roll back completed|roll back successful|reversion complete|reversion completed|reversion successful)\b/i.test(
        text,
      );
    case "backup":
      if (mode === "visible") {
        return (
          /\bbacked\s+up\s+successfully\b/i.test(text) ||
          /\b(?:database|data|dataset|file|files|folder|folders|document|documents|record|records|settings|config|configuration|workspace|project|repository|repo|site|app|application|service|server|environment|system|account|profile|export|archive|backup)\s+backed\s+up\b/i.test(
            text,
          ) ||
          /\bbackup\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:backed\s+up|backup complete|backup completed|backup successful|back up complete|back up completed|back up successful)\b/i.test(
        text,
      );
    case "reset":
      if (mode === "visible") {
        return (
          /\breset\s+successfully\b/i.test(text) ||
          /\b(?:password|passcode|pin|mfa|2fa|credential|credentials|token|key|secret|settings?|config|configuration|preferences?|cache|session|account|profile|device|app|application|service|workflow|rule|job|pipeline|database|data|dataset|form|filters?|view|dashboard|report)(?:\s+[\w-]+){0,6}\s+reset\b/i.test(
            text,
          ) ||
          /\breset\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:reset|reset complete|reset completed|reset successful)\b/i.test(
        text,
      );
    case "suspend":
      if (mode === "visible") {
        return (
          /\bsuspended\s+successfully\b/i.test(text) ||
          /\b(?:account|profile|user|member|person|customer|client|service|subscription|plan|workspace|project|workflow|rule|job|pipeline|task|ticket|request|record|item|case|issue|incident|access|license|licence)(?:\s+[\w-]+){0,6}\s+suspended\b/i.test(
            text,
          ) ||
          /\b(?:suspend|suspension)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:suspended|suspension|suspend complete|suspend completed|suspend successful|suspension complete|suspension completed|suspension successful)\b/i.test(
        text,
      );
    case "unsuspend":
      if (mode === "visible") {
        return (
          /\bunsuspended\s+successfully\b/i.test(text) ||
          /\b(?:account|profile|user|member|person|customer|client|service|subscription|plan|workspace|project|workflow|rule|job|pipeline|task|ticket|request|record|item|case|issue|incident|access|license|licence)(?:\s+[\w-]+){0,6}\s+unsuspended\b/i.test(
            text,
          ) ||
          /\b(?:unsuspend|unsuspension)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:unsuspended|unsuspension|unsuspend complete|unsuspend completed|unsuspend successful|unsuspension complete|unsuspension completed|unsuspension successful)\b/i.test(
        text,
      );
    case "block":
      if (mode === "visible") {
        return (
          /\bblocked\s+successfully\b/i.test(text) ||
          /\b(?:account|profile|user|member|person|customer|client|contact|sender|email|domain|ip|address|device|app|application|service|site|url|workspace|project|task|ticket|request|record|item|case|issue|incident|access|license|licence)(?:\s+[\w-]+){0,6}\s+blocked\b/i.test(
            text,
          ) ||
          /\b(?:block|blocking)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:blocked|blocking|block complete|block completed|block successful|blocking complete|blocking completed|blocking successful)\b/i.test(
        text,
      );
    case "unblock":
      if (mode === "visible") {
        return (
          /\bunblocked\s+successfully\b/i.test(text) ||
          /\b(?:account|profile|user|member|person|customer|client|contact|sender|email|domain|ip|address|device|app|application|service|site|url|workspace|project|task|ticket|request|record|item|case|issue|incident|access|license|licence)(?:\s+[\w-]+){0,6}\s+unblocked\b/i.test(
            text,
          ) ||
          /\b(?:unblock|unblocking)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:unblocked|unblocking|unblock complete|unblock completed|unblock successful|unblocking complete|unblocking completed|unblocking successful)\b/i.test(
        text,
      );
    case "link":
      if (mode === "visible") {
        return (
          /\blinked\s+successfully\b/i.test(text) ||
          /\b(?:account|profile|user|member|person|customer|client|contact|record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|workflow|rule|integration|connector|service|app|application|device|domain|url)(?:\s+[\w-]+){0,6}\s+linked\b/i.test(
            text,
          ) ||
          /\b(?:link|linking)\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:linked|linking|link complete|link completed|link successful|linking complete|linking completed|linking successful)\b/i.test(
        text,
      );
    case "unlink":
      if (mode === "visible") {
        return (
          /\bunlinked\s+successfully\b/i.test(text) ||
          /\b(?:account|profile|user|member|person|customer|client|contact|record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|workflow|rule|integration|connector|service|app|application|device|domain|url)(?:\s+[\w-]+){0,6}\s+unlinked\b/i.test(
            text,
          ) ||
          /\b(?:unlink|unlinking)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:unlinked|unlinking|unlink complete|unlink completed|unlink successful|unlinking complete|unlinking completed|unlinking successful)\b/i.test(
        text,
      );
    case "tag":
      if (mode === "visible") {
        return (
          /\btagged\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|user|member|profile)(?:\s+[\w-]+){0,6}\s+tagged\b/i.test(
            text,
          ) ||
          /\b(?:tag|tagging)\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:tagged|tagging|tag complete|tag completed|tag successful|tagging complete|tagging completed|tagging successful)\b/i.test(
        text,
      );
    case "untag":
      if (mode === "visible") {
        return (
          /\buntagged\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|user|member|profile)(?:\s+[\w-]+){0,6}\s+untagged\b/i.test(
            text,
          ) ||
          /\b(?:untag|untagging)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:untagged|untagging|untag complete|untag completed|untag successful|untagging complete|untagging completed|untagging successful)\b/i.test(
        text,
      );
    case "flag":
      if (mode === "visible") {
        return (
          /\bflagged\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|email|user|member|profile)(?:\s+[\w-]+){0,6}\s+flagged\b/i.test(
            text,
          ) ||
          /\b(?:flag|flagging)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:flagged|flagging|flag complete|flag completed|flag successful|flagging complete|flagging completed|flagging successful)\b/i.test(
        text,
      );
    case "unflag":
      if (mode === "visible") {
        return (
          /\bunflagged\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|email|user|member|profile)(?:\s+[\w-]+){0,6}\s+unflagged\b/i.test(
            text,
          ) ||
          /\b(?:unflag|unflagging)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:unflagged|unflagging|unflag complete|unflag completed|unflag successful|unflagging complete|unflagging completed|unflagging successful)\b/i.test(
        text,
      );
    case "duplicate":
      if (mode === "visible") {
        return (
          /\b(?:duplicated|cloned)\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|workflow|rule|dashboard|view|list|policy|profile)\s+(?:duplicated|cloned)\b/i.test(
            text,
          ) ||
          /\b(?:duplicate|clone)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:duplicated|cloned|duplicate complete|duplicate completed|duplicate successful|clone complete|clone completed|clone successful)\b/i.test(
        text,
      );
    case "restore":
      if (mode === "visible") {
        return (
          /\b(?:restored|recovered|reinstated)\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|workflow|rule|dashboard|view|list|policy|profile|account|user|archive|version|backup)\s+(?:restored|recovered|reinstated)\b/i.test(
            text,
          ) ||
          /\b(?:restore|restoration|recover|recovery|reinstate|reinstatement)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:restored|recovered|reinstated|restore complete|restore completed|restore successful|restoration complete|restoration completed|restoration successful|recover complete|recover completed|recover successful|recovery complete|recovery completed|recovery successful|reinstate complete|reinstate completed|reinstate successful|reinstatement complete|reinstatement completed|reinstatement successful)\b/i.test(
        text,
      );
    case "create":
      if (mode === "visible") {
        return (
          /\b(?:created|added|registered)\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|workflow|rule|dashboard|view|list|policy|profile|account|user|order|case|issue|incident|project|contact|customer)\s+(?:created|added|registered)\b/i.test(
            text,
          ) ||
          /\b(?:create|creation|add|registration|register)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:created|added|registered|create complete|create completed|create successful|creation complete|creation completed|creation successful|add complete|add completed|add successful|registration complete|registration completed|registration successful|register complete|register completed|register successful)\b/i.test(
        text,
      );
    case "share":
      if (mode === "visible") {
        return (
          /\bshared\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|folder|workflow|rule|dashboard|view|list|policy|profile|link|board|project|invoice|receipt)\s+shared\b/i.test(
            text,
          ) ||
          /\bshar(?:e|ing)\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:shared|share complete|share completed|share successful|sharing complete|sharing completed|sharing successful)\b/i.test(
        text,
      );
    case "grant":
      if (mode === "visible") {
        return (
          /\bgranted\s+successfully\b/i.test(text) ||
          /\b(?:access|permission|permissions?|privilege|privileges?|role|roles?|license|licence|licenses|licences|entitlement|entitlements?|membership|admin|administrator|viewer|editor|owner)\s+granted\b/i.test(
            text,
          ) ||
          /\b(?:grant|access|permission)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:granted|grant complete|grant completed|grant successful|access granted|access complete|access completed|access successful|permission granted|permission complete|permission completed|permission successful)\b/i.test(
        text,
      );
    case "revoke":
      if (mode === "visible") {
        return (
          /\brevoked\s+successfully\b/i.test(text) ||
          /\b(?:access|permission|permissions?|privilege|privileges?|role|roles?|license|licence|licenses|licences|entitlement|entitlements?|membership|admin|administrator|viewer|editor|owner)\s+revoked\b/i.test(
            text,
          ) ||
          /\b(?:revoke|revocation|access|permission)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:revoked|revoke complete|revoke completed|revoke successful|revocation complete|revocation completed|revocation successful|access revoked|permission revoked)\b/i.test(
        text,
      );
    case "install":
      if (mode === "visible") {
        return (
          /\binstalled\s+successfully\b/i.test(text) ||
          /\b(?:app|application|extension|plugin|package|module|integration|connector|driver|dependency|tool|theme|add[-\s]?on|update|workflow|rule)\s+installed\b/i.test(
            text,
          ) ||
          /\binstallation\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:installed|install complete|install completed|install successful|installation complete|installation completed|installation successful)\b/i.test(
        text,
      );
    case "uninstall":
      if (mode === "visible") {
        return (
          /\buninstalled\s+successfully\b/i.test(text) ||
          /\b(?:app|application|extension|plugin|package|module|integration|connector|driver|dependency|tool|theme|add[-\s]?on|update|workflow|rule)\s+uninstalled\b/i.test(
            text,
          ) ||
          /\buninstallation\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:uninstalled|uninstall complete|uninstall completed|uninstall successful|uninstallation complete|uninstallation completed|uninstallation successful)\b/i.test(
        text,
      );
    case "connect":
      if (mode === "visible") {
        return (
          /\bconnected\s+successfully\b/i.test(text) ||
          /\b(?:account|app|application|integration|connector|service|provider|source|data\s+source|database|endpoint|api|server|device|repository|repo|workspace|project|channel|feed|webhook|connection)\s+connected\b/i.test(
            text,
          ) ||
          /\bconnect(?:ion)?\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:connected|connect complete|connect completed|connect successful|connection complete|connection completed|connection successful)\b/i.test(
        text,
      );
    case "disconnect":
      if (mode === "visible") {
        return (
          /\bdisconnected\s+successfully\b/i.test(text) ||
          /\b(?:account|app|application|integration|connector|service|provider|source|data\s+source|database|endpoint|api|server|device|repository|repo|workspace|project|channel|feed|webhook|connection)\s+disconnected\b/i.test(
            text,
          ) ||
          /\bdisconnect(?:ion)?\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:disconnected|disconnect complete|disconnect completed|disconnect successful|disconnection complete|disconnection completed|disconnection successful)\b/i.test(
        text,
      );
    case "sync":
      if (mode === "visible") {
        return (
          /\b(?:synced|resynced|synchroni[sz]ed)\s+successfully\b/i.test(
            text,
          ) ||
          /\b(?:account|app|application|integration|connector|service|provider|source|data\s+source|database|endpoint|api|server|device|repository|repo|workspace|project|channel|feed|webhook|connection|calendar|contacts?|files?|folders?|documents?|settings|config|configuration|backup|workflow|rule|job|pipeline|queue)\s+(?:synced|resynced|synchroni[sz]ed)\b/i.test(
            text,
          ) ||
          /\b(?:sync|resync|synchronization|synchronisation)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:synced|resynced|synchroni[sz]ed|sync complete|sync completed|sync successful|resync complete|resync completed|resync successful|synchronization complete|synchronization completed|synchronization successful|synchronisation complete|synchronisation completed|synchronisation successful)\b/i.test(
        text,
      );
    case "invite":
      if (mode === "visible") {
        return (
          /\binvited\s+successfully\b/i.test(text) ||
          /\b(?:user|member|person|contact|customer|client|guest|reviewer|approver|editor|viewer|admin|administrator|collaborator|teammate|team|group)\s+invited\b/i.test(
            text,
          ) ||
          /\binvitation\s+(?:complete|completed|successful|sent)\b/i.test(text)
        );
      }
      return /\b(?:invited|invite complete|invite completed|invite successful|invitation complete|invitation completed|invitation successful|invitation sent)\b/i.test(
        text,
      );
    case "subscribe":
      if (mode === "visible") {
        return (
          /\bsubscribed\s+successfully\b/i.test(text) ||
          /\b(?:channel|topic|list|newsletter|report|dashboard|board|project|queue|feed|service|plan|notification|notifications?|updates?|digest|subscription)\s+subscribed\b/i.test(
            text,
          ) ||
          /\bsubscription\s+(?:complete|completed|successful|active)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:subscribed|subscribe complete|subscribe completed|subscribe successful|subscription complete|subscription completed|subscription successful|subscription active)\b/i.test(
        text,
      );
    case "unsubscribe":
      if (mode === "visible") {
        return (
          /\bunsubscribed\s+successfully\b/i.test(text) ||
          /\b(?:channel|topic|list|newsletter|report|dashboard|board|project|queue|feed|service|plan|notification|notifications?|updates?|digest|subscription)\s+unsubscribed\b/i.test(
            text,
          ) ||
          /\bunsubscription\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unsubscribed|unsubscribe complete|unsubscribe completed|unsubscribe successful|unsubscription complete|unsubscription completed|unsubscription successful)\b/i.test(
        text,
      );
    case "pin":
      if (mode === "visible") {
        return (
          /\bpinned\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic)\s+pinned\b/i.test(
            text,
          ) ||
          /\bpin\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:pinned|pin complete|pin completed|pin successful)\b/i.test(
        text,
      );
    case "unpin":
      if (mode === "visible") {
        return (
          /\bunpinned\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic)\s+unpinned\b/i.test(
            text,
          ) ||
          /\bunpin\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unpinned|unpin complete|unpin completed|unpin successful)\b/i.test(
        text,
      );
    case "mute":
      if (mode === "visible") {
        return (
          /\bmuted\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|user|member|contact|notification|notifications?|alert|alerts?)\s+muted\b/i.test(
            text,
          ) ||
          /\bmute\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:muted|mute complete|mute completed|mute successful)\b/i.test(
        text,
      );
    case "unmute":
      if (mode === "visible") {
        return (
          /\bunmuted\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|user|member|contact|notification|notifications?|alert|alerts?)\s+unmuted\b/i.test(
            text,
          ) ||
          /\bunmute\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unmuted|unmute complete|unmute completed|unmute successful)\b/i.test(
        text,
      );
    case "follow":
      if (mode === "visible") {
        return (
          /\bfollowed\s+successfully\b/i.test(text) ||
          /\b(?:user|member|contact|account|profile|channel|topic|thread|conversation|project|board|list|report|dashboard|page|feed|newsletter|tag|repository|repo)\s+followed\b/i.test(
            text,
          ) ||
          /\bfollow\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:followed|follow complete|follow completed|follow successful)\b/i.test(
        text,
      );
    case "unfollow":
      if (mode === "visible") {
        return (
          /\bunfollowed\s+successfully\b/i.test(text) ||
          /\b(?:user|member|contact|account|profile|channel|topic|thread|conversation|project|board|list|report|dashboard|page|feed|newsletter|tag|repository|repo)\s+unfollowed\b/i.test(
            text,
          ) ||
          /\bunfollow\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unfollowed|unfollow complete|unfollow completed|unfollow successful)\b/i.test(
        text,
      );
    case "bookmark":
      if (mode === "visible") {
        return (
          /\bbookmarked\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site)\s+bookmarked\b/i.test(
            text,
          ) ||
          /\bbookmark\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:bookmarked|bookmark complete|bookmark completed|bookmark successful)\b/i.test(
        text,
      );
    case "unbookmark":
      if (mode === "visible") {
        return (
          /\bunbookmarked\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site)\s+unbookmarked\b/i.test(
            text,
          ) ||
          /\bunbookmark\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unbookmarked|unbookmark complete|unbookmark completed|unbookmark successful)\b/i.test(
        text,
      );
    case "favorite":
      if (mode === "visible") {
        return (
          /\bfavorited\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site|user|member|contact|account|profile|repository|repo)\s+favorited\b/i.test(
            text,
          ) ||
          /\bfavorite\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:favorited|favorite complete|favorite completed|favorite successful)\b/i.test(
        text,
      );
    case "unfavorite":
      if (mode === "visible") {
        return (
          /\bunfavorited\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site|user|member|contact|account|profile|repository|repo)\s+unfavorited\b/i.test(
            text,
          ) ||
          /\bunfavorite\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unfavorited|unfavorite complete|unfavorite completed|unfavorite successful)\b/i.test(
        text,
      );
    case "like":
      if (mode === "visible") {
        return (
          /\bliked\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|message|comment|reply|post|thread|conversation|article|page|link|url|site|user|member|contact|account|profile|repository|repo|issue)\s+liked\b/i.test(
            text,
          ) ||
          /\blike\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:liked|like complete|like completed|like successful)\b/i.test(
        text,
      );
    case "unlike":
      if (mode === "visible") {
        return (
          /\bunliked\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|message|comment|reply|post|thread|conversation|article|page|link|url|site|user|member|contact|account|profile|repository|repo|issue)\s+unliked\b/i.test(
            text,
          ) ||
          /\bunlike\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unliked|unlike complete|unlike completed|unlike successful)\b/i.test(
        text,
      );
    case "upvote":
      if (mode === "visible") {
        return (
          /\bupvoted\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|message|comment|reply|post|thread|conversation|article|page|link|url|site|user|member|contact|account|profile|repository|repo|issue)\s+upvoted\b/i.test(
            text,
          ) ||
          /\bupvote\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:upvoted|upvote complete|upvote completed|upvote successful)\b/i.test(
        text,
      );
    case "downvote":
      if (mode === "visible") {
        return (
          /\bdownvoted\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|message|comment|reply|post|thread|conversation|article|page|link|url|site|user|member|contact|account|profile|repository|repo|issue)\s+downvoted\b/i.test(
            text,
          ) ||
          /\bdownvote\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:downvoted|downvote complete|downvote completed|downvote successful)\b/i.test(
        text,
      );
    case "watch":
      if (mode === "visible") {
        return (
          /\bwatched\s+successfully\b/i.test(text) ||
          /\b(?:repository|repo|project|board|list|report|dashboard|page|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|queue|service|job|pipeline|workflow|record|item)\s+watched\b/i.test(
            text,
          ) ||
          /\bwatch\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:watched|watch complete|watch completed|watch successful)\b/i.test(
        text,
      );
    case "unwatch":
      if (mode === "visible") {
        return (
          /\bunwatched\s+successfully\b/i.test(text) ||
          /\b(?:repository|repo|project|board|list|report|dashboard|page|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|queue|service|job|pipeline|workflow|record|item)\s+unwatched\b/i.test(
            text,
          ) ||
          /\bunwatch\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unwatched|unwatch complete|unwatch completed|unwatch successful)\b/i.test(
        text,
      );
    case "star":
      if (mode === "visible") {
        return (
          /\bstarred\s+successfully\b/i.test(text) ||
          /\b(?:repository|repo|project|board|list|report|dashboard|page|document|file|folder|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|record|item|message|comment|article|link|site|user|member|contact|profile)\s+starred\b/i.test(
            text,
          ) ||
          /\bstar\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:starred|star complete|star completed|star successful)\b/i.test(
        text,
      );
    case "unstar":
      if (mode === "visible") {
        return (
          /\bunstarred\s+successfully\b/i.test(text) ||
          /\b(?:repository|repo|project|board|list|report|dashboard|page|document|file|folder|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|record|item|message|comment|article|link|site|user|member|contact|profile)\s+unstarred\b/i.test(
            text,
          ) ||
          /\bunstar\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unstarred|unstar complete|unstar completed|unstar successful)\b/i.test(
        text,
      );
    case "post":
      if (mode === "visible") {
        return (
          /\b(?:posted|published)\s+successfully\b/i.test(text) ||
          /\b(?:comment|reply|post)\s+posted\b/i.test(text) ||
          /\b(?:post|publish)\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:posted|published|post complete|post completed|post successful|publish complete|publish completed|publish successful)\b/i.test(
        text,
      );
    case "approve":
      if (mode === "visible") {
        return (
          /\bapproved\s+successfully\b/i.test(text) ||
          /\bapproval\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:approved|approval complete|approval completed|approval successful)\b/i.test(
        text,
      );
    case "reject":
      if (mode === "visible") {
        return (
          /\b(?:rejected|denied)\s+successfully\b/i.test(text) ||
          /\brejection\s+(?:complete|completed|successful)\b/i.test(text) ||
          /\bdenial\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:rejected|rejection complete|rejection completed|rejection successful|denied|denial complete|denial completed|denial successful)\b/i.test(
        text,
      );
    case "close":
      if (mode === "visible") {
        return (
          /\b(?:closed|resolved)\s+successfully\b/i.test(text) ||
          /\bresolution\s+(?:complete|completed|successful)\b/i.test(text) ||
          /\b(?:close|closure)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:closed|resolved|close complete|close completed|close successful|closure complete|closure completed|closure successful)\b/i.test(
        text,
      );
    case "reopen":
      if (mode === "visible") {
        return (
          /\bre[-\s]?opened\s+successfully\b/i.test(text) ||
          /\bre[-\s]?open\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:re[-\s]?opened|re[-\s]?open complete|re[-\s]?open completed|re[-\s]?open successful)\b/i.test(
        text,
      );
    case "cancel":
      if (mode === "visible") {
        return (
          /\bcancell?ed\s+successfully\b/i.test(text) ||
          /\bcancel(?:lation)?\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:cancell?ed|cancel complete|cancel completed|cancel successful|cancellation complete|cancellation completed|cancellation successful)\b/i.test(
        text,
      );
    case "enable":
      if (mode === "visible") {
        return (
          /\b(?:enabled|activated)\s+successfully\b/i.test(text) ||
          /\b(?:enable|activation)\s+(?:complete|completed|successful)\b/i.test(
            text,
          ) ||
          /\bAction\s*:\s*[a-z0-9][a-z0-9 _-]{1,120}\b/i.test(text)
        );
      }
      return /\b(?:enabled|activated|enable complete|enable completed|enable successful|activation complete|activation completed|activation successful)\b/i.test(
        text,
      );
    case "disable":
      if (mode === "visible") {
        return (
          /\b(?:disabled|deactivated)\s+successfully\b/i.test(text) ||
          /\b(?:disable|deactivation)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:disabled|deactivated|disable complete|disable completed|disable successful|deactivation complete|deactivation completed|deactivation successful)\b/i.test(
        text,
      );
    case "assign":
      if (mode === "visible") {
        return (
          /\bassigned\s+successfully\b/i.test(text) ||
          /\bassignment\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:assigned|assignment complete|assignment completed|assignment successful)\b/i.test(
        text,
      );
    case "unassign":
      if (mode === "visible") {
        return (
          /\bunassigned\s+successfully\b/i.test(text) ||
          /\bunassign\s+(?:complete|completed|successful)\b/i.test(text) ||
          /\bassignee\s+(?:cleared|removed)\b/i.test(text)
        );
      }
      return /\b(?:unassigned|unassign complete|unassign completed|unassign successful|assignee cleared|assignee removed)\b/i.test(
        text,
      );
    case "escalate":
      if (mode === "visible") {
        return (
          /\bescalated\s+successfully\b/i.test(text) ||
          /\bescalat(?:e|ion)\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:escalated|escalate complete|escalate completed|escalate successful|escalation complete|escalation completed|escalation successful)\b/i.test(
        text,
      );
    case "deescalate":
      if (mode === "visible") {
        return (
          /\bde[-\s]?escalated\s+successfully\b/i.test(text) ||
          /\bde[-\s]?escalat(?:e|ion)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:de[-\s]?escalated|de[-\s]?escalate complete|de[-\s]?escalate completed|de[-\s]?escalate successful|de[-\s]?escalation complete|de[-\s]?escalation completed|de[-\s]?escalation successful)\b/i.test(
        text,
      );
    case "lock":
      if (mode === "visible") {
        return (
          /\blocked\s+successfully\b/i.test(text) ||
          /\block\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:locked|lock complete|lock completed|lock successful)\b/i.test(
        text,
      );
    case "unlock":
      if (mode === "visible") {
        return (
          /\bunlocked\s+successfully\b/i.test(text) ||
          /\bunlock\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unlocked|unlock complete|unlock completed|unlock successful)\b/i.test(
        text,
      );
    case "pause":
      if (mode === "visible") {
        return (
          /\bpaused\s+successfully\b/i.test(text) ||
          /\bpause\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:paused|pause complete|pause completed|pause successful)\b/i.test(
        text,
      );
    case "resume":
      if (mode === "visible") {
        return (
          /\bresumed\s+successfully\b/i.test(text) ||
          /\bresume\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:resumed|resume complete|resume completed|resume successful)\b/i.test(
        text,
      );
    case "start":
      if (mode === "visible") {
        return (
          /\bstarted\s+successfully\b/i.test(text) ||
          /\bstart\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:started|running|active|start complete|start completed|start successful)\b/i.test(
        text,
      );
    case "stop":
      if (mode === "visible") {
        return (
          /\bstopped\s+successfully\b/i.test(text) ||
          /\bstop\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:stopped|inactive|stop complete|stop completed|stop successful)\b/i.test(
        text,
      );
    case "restart":
      if (mode === "visible") {
        return (
          /\brestarted\s+successfully\b/i.test(text) ||
          /\brestart\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:restarted|restart complete|restart completed|restart successful)\b/i.test(
        text,
      );
    case "refresh":
      if (mode === "visible") {
        return (
          /\brefreshed\s+successfully\b/i.test(text) ||
          /\brefresh\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:refreshed|refresh complete|refresh completed|refresh successful)\b/i.test(
        text,
      );
    case "dismiss":
      if (mode === "visible") {
        return (
          /\b(?:dismissed|hidden|cleared)\s+successfully\b/i.test(text) ||
          /\b(?:dismiss|dismissal|hide|clear)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:dismissed|closed|canceled|cancelled|removed|hid|hidden|cleared|dismiss complete|dismiss completed|dismiss successful|dismissal complete|dismissal completed|dismissal successful|hide complete|hide completed|hide successful|clear complete|clear completed|clear successful)\b/i.test(
        text,
      );
    case "update":
      if (mode === "visible") {
        return (
          /\b(?:updated|changed|applied)\s+successfully\b/i.test(text) ||
          /\b(?:changes|settings)\s+(?:updated|applied)\b/i.test(text) ||
          /\bupdate\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:updated|changed|applied|update complete|update completed|update successful)\b/i.test(
        text,
      );
    case "submit":
      if (mode === "visible") {
        return (
          /\bsubmitted\s+successfully\b/i.test(text) ||
          /\bsuccessfully\s+submitted\b/i.test(text) ||
          /\bsubmission\s+(?:complete|completed|successful)\b/i.test(text) ||
          /\bsubmit\s+(?:complete|completed|successful)\b/i.test(text) ||
          extractTransactionalConfirmationSnippet(text) !== null
        );
      }
      return (
        /\b(?:submitted|submission|submit complete|submit completed|submit successful)\b/i.test(
          text,
        ) || extractTransactionalConfirmationSnippet(text) !== null
      );
    case "complete":
      if (mode === "visible") {
        return (
          /\bmark(?:ed)?\b.{0,40}\bcomplete(?:d)?\b/i.test(text) ||
          /\bcompleted\s+successfully\b/i.test(text) ||
          /\b(?:task|item|record|request|ticket|todo|to-do)\s+completed\b/i.test(
            text,
          ) ||
          /\bcompletion\s+(?:complete|completed|successful)\b/i.test(text) ||
          extractTransactionalConfirmationSnippet(text) !== null
        );
      }
      return (
        /\bmark(?:ed)?\b.{0,40}\bcomplete(?:d)?\b/i.test(text) ||
        /\b(?:completed|completion complete|completion completed|completion successful)\b/i.test(
          text,
        ) ||
        extractTransactionalConfirmationSnippet(text) !== null
      );
  }
  return false;
}

function workflowActionTextIsNegated(
  text: string,
  action: WorkflowConfirmationAction,
): boolean {
  const actionTerms = workflowActionTermPattern(action);
  const noAction = new RegExp(`\\bno\\s+(?:successful\\s+)?${actionTerms}\\b`);
  if (noAction.test(text)) return true;

  const negationBeforeAction = new RegExp(
    `\\b(?:not|never|failed\\s+to|fails?\\s+to|did\\s+not|didn't|does\\s+not|doesn't|was\\s+not|wasn't|is\\s+not|isn't|has\\s+not|hasn't|have\\s+not|haven't|cannot|can't|could\\s+not|couldn't|unable\\s+to)\\b.{0,60}\\b${actionTerms}\\b`,
  );
  if (negationBeforeAction.test(text)) return true;

  const failureAfterAction = new RegExp(
    `\\b${actionTerms}\\b.{0,60}\\b(?:failed|unsuccessful|not\\s+successful|did\\s+not\\s+complete|didn't\\s+complete|was\\s+not\\s+completed|wasn't\\s+completed|could\\s+not\\s+complete|couldn't\\s+complete)\\b`,
  );
  return failureAfterAction.test(text);
}

export function workflowActionTermPattern(
  action: WorkflowConfirmationAction,
): string {
  switch (action) {
    case "delete":
      return "(?:deleted|removed|deletion|removal|delete|remove)";
    case "archive":
      return "(?:archived|archival|archive)";
    case "save":
      return "(?:saved|save)";
    case "send":
      return "(?:sent|send)";
    case "export":
      return "(?:exported|export)";
    case "download":
      return "(?:downloaded|download)";
    case "upload":
      return "(?:uploaded|upload)";
    case "import":
      return "(?:imported|import)";
    case "attach":
      return "(?:attached|attach|attachment)";
    case "detach":
      return "(?:detached|detach|detachment)";
    case "copy":
      return "(?:copied|copy)";
    case "transfer":
      return "(?:transferred|transfer)";
    case "move":
      return "(?:moved|move)";
    case "rename":
      return "(?:renamed|rename)";
    case "merge":
      return "(?:merged|merge)";
    case "schedule":
      return "(?:scheduled|schedule)";
    case "unschedule":
      return "(?:unscheduled|unschedule)";
    case "deploy":
      return "(?:deployed|deploy|deployment)";
    case "rollback":
      return "(?:rolled\\s+back|reverted|rollback|roll\\s+back|reversion)";
    case "backup":
      return "(?:backed\\s+up|backup|back\\s+up)";
    case "reset":
      return "(?:reset)";
    case "suspend":
      return "(?:suspended|suspension|suspend)";
    case "unsuspend":
      return "(?:unsuspended|unsuspension|unsuspend)";
    case "block":
      return "(?:blocked|blocking|block)";
    case "unblock":
      return "(?:unblocked|unblocking|unblock)";
    case "link":
      return "(?:linked|linking|link)";
    case "unlink":
      return "(?:unlinked|unlinking|unlink)";
    case "tag":
      return "(?:tagged|tagging|tag)";
    case "untag":
      return "(?:untagged|untagging|untag)";
    case "flag":
      return "(?:flagged|flagging|flag)";
    case "unflag":
      return "(?:unflagged|unflagging|unflag)";
    case "duplicate":
      return "(?:duplicated|cloned|duplicate|duplication|clone)";
    case "restore":
      return "(?:restored|recovered|reinstated|restore|restoration|recover|recovery|reinstate|reinstatement)";
    case "create":
      return "(?:created|added|registered|create|creation|add|registration|register)";
    case "share":
      return "(?:shared|share|sharing)";
    case "grant":
      return "(?:granted|grant|access|permission)";
    case "revoke":
      return "(?:revoked|revoke|revocation)";
    case "install":
      return "(?:installed|install|installation)";
    case "uninstall":
      return "(?:uninstalled|uninstall|uninstallation)";
    case "connect":
      return "(?:connected|connect|connection)";
    case "disconnect":
      return "(?:disconnected|disconnect|disconnection)";
    case "sync":
      return "(?:synced|resynced|synchroni[sz]ed|sync|resync|synchronization|synchronisation)";
    case "invite":
      return "(?:invited|invite|invitation)";
    case "subscribe":
      return "(?:subscribed|subscribe|subscription)";
    case "unsubscribe":
      return "(?:unsubscribed|unsubscribe|unsubscription)";
    case "pin":
      return "(?:pinned|pin)";
    case "unpin":
      return "(?:unpinned|unpin)";
    case "mute":
      return "(?:muted|mute)";
    case "unmute":
      return "(?:unmuted|unmute)";
    case "follow":
      return "(?:followed|follow)";
    case "unfollow":
      return "(?:unfollowed|unfollow)";
    case "bookmark":
      return "(?:bookmarked|bookmark)";
    case "unbookmark":
      return "(?:unbookmarked|unbookmark)";
    case "favorite":
      return "(?:favorited|favorite)";
    case "unfavorite":
      return "(?:unfavorited|unfavorite)";
    case "like":
      return "(?:liked|like)";
    case "unlike":
      return "(?:unliked|unlike)";
    case "upvote":
      return "(?:upvoted|upvote)";
    case "downvote":
      return "(?:downvoted|downvote)";
    case "watch":
      return "(?:watched|watch)";
    case "unwatch":
      return "(?:unwatched|unwatch)";
    case "star":
      return "(?:starred|star)";
    case "unstar":
      return "(?:unstarred|unstar)";
    case "post":
      return "(?:posted|published|post|publish)";
    case "approve":
      return "(?:approved|approval|approve)";
    case "reject":
      return "(?:rejected|denied|rejection|denial|reject|deny)";
    case "close":
      return "(?:closed|resolved|closure|resolution|close|resolve)";
    case "reopen":
      return "(?:re[-\\s]?opened|re[-\\s]?open)";
    case "cancel":
      return "(?:cancell?ed|cancellation|cancel)";
    case "enable":
      return "(?:enabled|activated|activation|enable|activate)";
    case "disable":
      return "(?:disabled|deactivated|deactivation|disable|deactivate)";
    case "assign":
      return "(?:assigned|assignment|assign)";
    case "unassign":
      return "(?:unassigned|unassign|assignee\\s+cleared|assignee\\s+removed)";
    case "escalate":
      return "(?:escalated|escalation|escalate)";
    case "deescalate":
      return "(?:de[-\\s]?escalated|de[-\\s]?escalation|de[-\\s]?escalate)";
    case "lock":
      return "(?:locked|lock)";
    case "unlock":
      return "(?:unlocked|unlock)";
    case "pause":
      return "(?:paused|pause)";
    case "resume":
      return "(?:resumed|resume)";
    case "start":
      return "(?:started|start|running|active)";
    case "stop":
      return "(?:stopped|stop|inactive)";
    case "restart":
      return "(?:restarted|restart)";
    case "refresh":
      return "(?:refreshed|refresh)";
    case "dismiss":
      return "(?:dismissed|closed|canceled|cancelled|removed|hidden|cleared|dismissal|dismiss|hide|clear)";
    case "update":
      return "(?:updated|changed|applied|update|change|apply)";
    case "submit":
      return "(?:submitted|submission|submit)";
    case "complete":
      return "(?:completed|completion|complete)";
  }
}

export function extractTransactionalConfirmationSnippet(
  value: string,
): string | null {
  const text = cleanLabel(value);
  if (!text) return null;
  if (/\b(?:cart|basket|bag)\s+(?:is\s+)?empty\b/i.test(text)) return null;

  const hasTransactionNoun =
    /\b(?:order|checkout|purchase|payment|transaction|submission|registration|application|form|confirmation|receipt|booking|reservation|request|log\s*in|login|sign\s*in|signin|authenticated?|dashboard)\b/i.test(
      text,
    );
  const hasCompletionState =
    /\b(?:confirmed|confirmation|complete|completed|submitted|successful|successfully|received|placed|thank\s+you|receipt|logged\s*in|signed\s*in|authenticated?|welcome|log\s*out|logout|sign\s*out)\b/i.test(
      text,
    );
  const hasReference =
    /\b(?:order|confirmation|receipt|reference|booking|reservation)\s*(?:#|number|no\.?|id)?\s*[:#-]?\s*(?:[a-z]{1,6}[-_]?\d{3,}|\d{4,})\b/i.test(
      text,
    );
  if (!hasTransactionNoun || (!hasCompletionState && !hasReference)) {
    return null;
  }

  const anchor =
    /\b(?:thank\s+you|order\s+(?:#|number|no\.?|id)?\s*[:#-]?\s*(?:[a-z]{1,6}[-_]?\d{3,}|\d{4,})|order\s+(?:confirmed|confirmation|complete|completed|submitted|placed)|confirmation\s+(?:#|number|no\.?|id)?\s*[:#-]?\s*(?:[a-z]{1,6}[-_]?\d{3,}|\d{4,})|receipt|transaction\s+(?:complete|completed|confirmed|successful)|payment\s+(?:complete|completed|confirmed|successful)|(?:submission|registration|application|form)\s+(?:complete|completed|confirmed|successful|submitted|received)|logged\s*in|signed\s*in|authenticated?|welcome|log\s*out|logout|sign\s*out)\b/i.exec(
      text,
    ) ??
    /\b(?:confirmed|confirmation|complete|completed|submitted|successful|received|placed)\b/i.exec(
      text,
    );
  if (!anchor) return null;
  const start = Math.max(0, anchor.index - 180);
  const end = Math.min(text.length, anchor.index + 1200);
  return cleanLabel(text.slice(start, end));
}
