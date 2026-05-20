import type { WorkflowConfirmationAction } from "./workflow-confirmation-types";

export type ControlStateWorkflowAction = Extract<
  WorkflowConfirmationAction,
  | "delete"
  | "archive"
  | "restore"
  | "approve"
  | "reject"
  | "close"
  | "reopen"
  | "cancel"
  | "dismiss"
  | "escalate"
  | "deescalate"
  | "enable"
  | "disable"
  | "lock"
  | "unlock"
  | "block"
  | "unblock"
  | "assign"
  | "unassign"
  | "grant"
  | "revoke"
  | "suspend"
  | "unsuspend"
  | "schedule"
  | "unschedule"
  | "connect"
  | "disconnect"
  | "link"
  | "unlink"
  | "tag"
  | "untag"
  | "flag"
  | "unflag"
  | "copy"
  | "duplicate"
  | "transfer"
  | "move"
  | "rename"
  | "merge"
  | "create"
  | "attach"
  | "detach"
  | "send"
  | "export"
  | "download"
  | "upload"
  | "import"
  | "install"
  | "uninstall"
  | "sync"
  | "subscribe"
  | "unsubscribe"
  | "follow"
  | "unfollow"
  | "bookmark"
  | "unbookmark"
  | "favorite"
  | "unfavorite"
  | "like"
  | "unlike"
  | "upvote"
  | "downvote"
  | "watch"
  | "unwatch"
  | "star"
  | "unstar"
  | "pin"
  | "unpin"
  | "mute"
  | "unmute"
  | "pause"
  | "resume"
  | "start"
  | "stop"
  | "restart"
  | "refresh"
  | "deploy"
  | "rollback"
  | "backup"
  | "reset"
  | "post"
  | "submit"
  | "complete"
  | "save"
  | "update"
  | "share"
  | "invite"
>;

const CONTROL_STATE_ON_ACTIONS: ReadonlySet<ControlStateWorkflowAction> =
  new Set([
    "delete",
    "archive",
    "approve",
    "reject",
    "close",
    "cancel",
    "dismiss",
    "escalate",
    "enable",
    "lock",
    "block",
    "assign",
    "grant",
    "suspend",
    "schedule",
    "connect",
    "link",
    "tag",
    "flag",
    "copy",
    "duplicate",
    "transfer",
    "move",
    "rename",
    "merge",
    "create",
    "attach",
    "send",
    "export",
    "download",
    "upload",
    "import",
    "install",
    "sync",
    "subscribe",
    "follow",
    "bookmark",
    "favorite",
    "like",
    "upvote",
    "downvote",
    "watch",
    "star",
    "pin",
    "mute",
    "pause",
    "resume",
    "start",
    "stop",
    "restart",
    "refresh",
    "deploy",
    "rollback",
    "backup",
    "reset",
    "post",
    "submit",
    "complete",
    "save",
    "update",
    "share",
    "invite",
  ]);

const CONTROL_STATE_OFF_ACTIONS: ReadonlySet<ControlStateWorkflowAction> =
  new Set([
    "restore",
    "disable",
    "reopen",
    "deescalate",
    "unlock",
    "unblock",
    "unassign",
    "revoke",
    "unsuspend",
    "unschedule",
    "disconnect",
    "unlink",
    "untag",
    "unflag",
    "uninstall",
    "unsubscribe",
    "unfollow",
    "unbookmark",
    "unfavorite",
    "unlike",
    "unwatch",
    "unstar",
    "unpin",
    "unmute",
    "detach",
  ]);

export function controlStateChangeMatchesAction(
  action: ControlStateWorkflowAction,
  beforeState: boolean,
  afterState: boolean,
): boolean {
  if (CONTROL_STATE_ON_ACTIONS.has(action)) {
    return beforeState === false && afterState === true;
  }
  if (CONTROL_STATE_OFF_ACTIONS.has(action)) {
    return beforeState === true && afterState === false;
  }
  return false;
}

export function controlStateCompletionWord(
  action: ControlStateWorkflowAction,
): string {
  switch (action) {
    case "delete":
      return "deleted";
    case "archive":
      return "archived";
    case "restore":
      return "restored";
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "close":
      return "closed";
    case "reopen":
      return "reopened";
    case "cancel":
      return "canceled";
    case "dismiss":
      return "dismissed";
    case "escalate":
      return "escalated";
    case "deescalate":
      return "de-escalated";
    case "enable":
      return "enabled";
    case "disable":
      return "disabled";
    case "lock":
      return "locked";
    case "unlock":
      return "unlocked";
    case "block":
      return "blocked";
    case "unblock":
      return "unblocked";
    case "assign":
      return "assigned";
    case "unassign":
      return "unassigned";
    case "grant":
      return "granted";
    case "revoke":
      return "revoked";
    case "suspend":
      return "suspended";
    case "unsuspend":
      return "unsuspended";
    case "schedule":
      return "scheduled";
    case "unschedule":
      return "unscheduled";
    case "connect":
      return "connected";
    case "disconnect":
      return "disconnected";
    case "link":
      return "linked";
    case "unlink":
      return "unlinked";
    case "tag":
      return "tagged";
    case "untag":
      return "untagged";
    case "flag":
      return "flagged";
    case "unflag":
      return "unflagged";
    case "copy":
      return "copied";
    case "duplicate":
      return "duplicated";
    case "transfer":
      return "transferred";
    case "move":
      return "moved";
    case "rename":
      return "renamed";
    case "merge":
      return "merged";
    case "create":
      return "created";
    case "attach":
      return "attached";
    case "detach":
      return "detached";
    case "send":
      return "sent";
    case "export":
      return "exported";
    case "download":
      return "downloaded";
    case "upload":
      return "uploaded";
    case "import":
      return "imported";
    case "install":
      return "installed";
    case "uninstall":
      return "uninstalled";
    case "sync":
      return "synced";
    case "subscribe":
      return "subscribed";
    case "unsubscribe":
      return "unsubscribed";
    case "follow":
      return "followed";
    case "unfollow":
      return "unfollowed";
    case "bookmark":
      return "bookmarked";
    case "unbookmark":
      return "unbookmarked";
    case "favorite":
      return "favorited";
    case "unfavorite":
      return "unfavorited";
    case "like":
      return "liked";
    case "unlike":
      return "unliked";
    case "upvote":
      return "upvoted";
    case "downvote":
      return "downvoted";
    case "watch":
      return "watched";
    case "unwatch":
      return "unwatched";
    case "star":
      return "starred";
    case "unstar":
      return "unstarred";
    case "pin":
      return "pinned";
    case "unpin":
      return "unpinned";
    case "mute":
      return "muted";
    case "unmute":
      return "unmuted";
    case "pause":
      return "paused";
    case "resume":
      return "resumed";
    case "start":
      return "started";
    case "stop":
      return "stopped";
    case "restart":
      return "restarted";
    case "refresh":
      return "refreshed";
    case "deploy":
      return "deployed";
    case "rollback":
      return "rolled back";
    case "backup":
      return "backed up";
    case "reset":
      return "reset";
    case "post":
      return "published";
    case "submit":
      return "submitted";
    case "complete":
      return "completed";
    case "save":
      return "saved";
    case "update":
      return "updated";
    case "share":
      return "shared";
    case "invite":
      return "invited";
  }
}

function readSemanticControlState(
  state: string,
  onPattern: RegExp,
  offPattern: RegExp,
): boolean | null {
  if (onPattern.test(state)) return true;
  if (offPattern.test(state)) return false;
  return null;
}

export function readControlStateValue(
  state: string | null | undefined,
  action?: ControlStateWorkflowAction,
): boolean | null {
  if (state == null) return null;
  if (/^(?:true|checked|pressed|selected|on|1)$/i.test(state)) {
    return true;
  }
  if (/^(?:false|unchecked|unpressed|unselected|off|0)$/i.test(state)) {
    return false;
  }
  if (action === "approve") {
    return readSemanticControlState(
      state,
      /^approved$/i,
      /^(?:pending|rejected|denied)$/i,
    );
  }
  if (action === "reject") {
    return readSemanticControlState(
      state,
      /^(?:rejected|denied)$/i,
      /^(?:pending|approved)$/i,
    );
  }
  if (action === "delete") {
    return readSemanticControlState(
      state,
      /^(?:deleted|removed)$/i,
      /^(?:active|present|available|existing|exists|created|saved|open)$/i,
    );
  }
  if (action === "close" || action === "reopen") {
    return readSemanticControlState(
      state,
      /^(?:closed|resolved)$/i,
      /^(?:open|reopened|re-opened)$/i,
    );
  }
  if (action === "cancel") {
    return readSemanticControlState(
      state,
      /^cancell?ed$/i,
      /^(?:active|pending|open|scheduled)$/i,
    );
  }
  if (action === "dismiss") {
    return readSemanticControlState(
      state,
      /^(?:dismissed|hidden|cleared|closed|removed)$/i,
      /^(?:visible|shown|open|active|present|displayed)$/i,
    );
  }
  if (action === "archive" || action === "restore") {
    return readSemanticControlState(
      state,
      /^archived$/i,
      /^(?:active|restored|unarchived|available)$/i,
    );
  }
  if (action === "escalate" || action === "deescalate") {
    return readSemanticControlState(
      state,
      /^escalated$/i,
      /^(?:normal|de[-\s]?escalated|unescalated|un-escalated)$/i,
    );
  }
  if (action === "enable" || action === "disable") {
    return readSemanticControlState(
      state,
      /^(?:enabled|activated|active)$/i,
      /^(?:disabled|deactivated|inactive)$/i,
    );
  }
  if (action === "lock" || action === "unlock") {
    return readSemanticControlState(state, /^locked$/i, /^unlocked$/i);
  }
  if (action === "block" || action === "unblock") {
    return readSemanticControlState(state, /^blocked$/i, /^unblocked$/i);
  }
  if (action === "assign" || action === "unassign") {
    return readSemanticControlState(state, /^assigned$/i, /^unassigned$/i);
  }
  if (action === "grant" || action === "revoke") {
    return readSemanticControlState(state, /^granted$/i, /^revoked$/i);
  }
  if (action === "suspend" || action === "unsuspend") {
    return readSemanticControlState(state, /^suspended$/i, /^unsuspended$/i);
  }
  if (action === "schedule" || action === "unschedule") {
    return readSemanticControlState(state, /^scheduled$/i, /^unscheduled$/i);
  }
  if (action === "connect" || action === "disconnect") {
    if (/^connected$/i.test(state)) return true;
    if (/^disconnected$/i.test(state)) return false;
  }
  if (action === "link" || action === "unlink") {
    if (/^linked$/i.test(state)) return true;
    if (/^unlinked$/i.test(state)) return false;
  }
  if (action === "tag" || action === "untag") {
    if (/^tagged$/i.test(state)) return true;
    if (/^untagged$/i.test(state)) return false;
  }
  if (action === "flag" || action === "unflag") {
    if (/^flagged$/i.test(state)) return true;
    if (/^unflagged$/i.test(state)) return false;
  }
  if (action === "copy") {
    return readSemanticControlState(
      state,
      /^copied$/i,
      /^(?:ready|idle|uncopied|not[-\s]?copied|pending)$/i,
    );
  }
  if (action === "duplicate") {
    return readSemanticControlState(
      state,
      /^(?:duplicated|cloned)$/i,
      /^(?:ready|idle|original|not[-\s]?duplicated|pending)$/i,
    );
  }
  if (action === "transfer") {
    return readSemanticControlState(
      state,
      /^transferred$/i,
      /^(?:untransferred|not[-\s]?transferred|pending|ready|source)$/i,
    );
  }
  if (action === "move") {
    return readSemanticControlState(
      state,
      /^moved$/i,
      /^(?:unmoved|not[-\s]?moved|pending|ready|source)$/i,
    );
  }
  if (action === "rename") {
    return readSemanticControlState(
      state,
      /^renamed$/i,
      /^(?:unnamed|not[-\s]?renamed|old[-\s]?name|old|pending)$/i,
    );
  }
  if (action === "merge") {
    return readSemanticControlState(
      state,
      /^merged$/i,
      /^(?:unmerged|not[-\s]?merged|separate|pending|open)$/i,
    );
  }
  if (action === "create") {
    return readSemanticControlState(
      state,
      /^(?:created|added|registered)$/i,
      /^(?:ready|draft|new|pending|uncreated|not[-\s]?created|empty)$/i,
    );
  }
  if (action === "attach" || action === "detach") {
    return readSemanticControlState(
      state,
      /^attached$/i,
      /^(?:detached|unattached|not[-\s]?attached|pending|none)$/i,
    );
  }
  if (action === "send") {
    return readSemanticControlState(
      state,
      /^sent$/i,
      /^(?:draft|unsent|not[-\s]?sent|pending|queued|outbox)$/i,
    );
  }
  if (action === "export") {
    return readSemanticControlState(
      state,
      /^exported$/i,
      /^(?:ready|queued|pending|unexported|not[-\s]?exported)$/i,
    );
  }
  if (action === "download") {
    return readSemanticControlState(
      state,
      /^downloaded$/i,
      /^(?:ready|queued|pending|available|undownloaded|not[-\s]?downloaded)$/i,
    );
  }
  if (action === "upload") {
    return readSemanticControlState(
      state,
      /^uploaded$/i,
      /^(?:ready|selected|queued|pending|unuploaded|not[-\s]?uploaded)$/i,
    );
  }
  if (action === "import") {
    return readSemanticControlState(
      state,
      /^imported$/i,
      /^(?:ready|staged|queued|pending|unimported|not[-\s]?imported)$/i,
    );
  }
  if (action === "install" || action === "uninstall") {
    if (/^installed$/i.test(state)) return true;
    if (/^uninstalled$/i.test(state)) return false;
  }
  if (action === "subscribe" || action === "unsubscribe") {
    return readSemanticControlState(state, /^subscribed$/i, /^unsubscribed$/i);
  }
  if (action === "follow" || action === "unfollow") {
    return readSemanticControlState(state, /^followed$/i, /^unfollowed$/i);
  }
  if (action === "bookmark" || action === "unbookmark") {
    return readSemanticControlState(state, /^bookmarked$/i, /^unbookmarked$/i);
  }
  if (action === "favorite" || action === "unfavorite") {
    return readSemanticControlState(
      state,
      /^favou?rited$/i,
      /^unfavou?rited$/i,
    );
  }
  if (action === "watch" || action === "unwatch") {
    return readSemanticControlState(state, /^watched$/i, /^unwatched$/i);
  }
  if (action === "star" || action === "unstar") {
    return readSemanticControlState(state, /^starred$/i, /^unstarred$/i);
  }
  if (action === "pin" || action === "unpin") {
    return readSemanticControlState(state, /^pinned$/i, /^unpinned$/i);
  }
  if (action === "mute" || action === "unmute") {
    return readSemanticControlState(state, /^muted$/i, /^unmuted$/i);
  }
  if (action === "pause") {
    return readSemanticControlState(
      state,
      /^paused$/i,
      /^(?:running|active)$/i,
    );
  }
  if (action === "resume") {
    return readSemanticControlState(
      state,
      /^(?:running|active|resumed)$/i,
      /^paused$/i,
    );
  }
  if (action === "start") {
    return readSemanticControlState(
      state,
      /^(?:running|active|started)$/i,
      /^(?:stopped|inactive)$/i,
    );
  }
  if (action === "stop") {
    return readSemanticControlState(
      state,
      /^(?:stopped|inactive)$/i,
      /^(?:running|active)$/i,
    );
  }
  if (action === "restart") {
    return readSemanticControlState(
      state,
      /^restarted$/i,
      /^(?:running|active|stopped|ready)$/i,
    );
  }
  if (action === "refresh") {
    return readSemanticControlState(
      state,
      /^(?:refreshed|fresh|current)$/i,
      /^(?:stale|outdated|dirty)$/i,
    );
  }
  if (action === "deploy") {
    return readSemanticControlState(
      state,
      /^deployed$/i,
      /^(?:staged|pending|ready|undeployed|rolled[-\s]?back|reverted)$/i,
    );
  }
  if (action === "rollback") {
    return readSemanticControlState(
      state,
      /^(?:rolled[-\s]?back|reverted)$/i,
      /^(?:deployed|current|active|ready)$/i,
    );
  }
  if (action === "backup") {
    return readSemanticControlState(
      state,
      /^backed[-\s]?up$/i,
      /^(?:unbacked[-\s]?up|stale|dirty|modified|pending)$/i,
    );
  }
  if (action === "reset") {
    return readSemanticControlState(
      state,
      /^(?:reset|default|cleared)$/i,
      /^(?:changed|modified|dirty|custom|active)$/i,
    );
  }
  if (action === "post") {
    return readSemanticControlState(
      state,
      /^(?:posted|published)$/i,
      /^(?:draft|unposted|unpublished|pending)$/i,
    );
  }
  if (action === "submit") {
    return readSemanticControlState(
      state,
      /^submitted$/i,
      /^(?:draft|unsubmitted|not[-\s]?submitted|pending)$/i,
    );
  }
  if (action === "complete") {
    return readSemanticControlState(
      state,
      /^(?:complete|completed|done)$/i,
      /^(?:in[-\s]?progress|incomplete|open|pending|todo|to[-\s]?do|not[-\s]?complete|not[-\s]?completed)$/i,
    );
  }
  if (action === "save") {
    return readSemanticControlState(
      state,
      /^(?:saved|stored|persisted)$/i,
      /^(?:unsaved|not[-\s]?saved|dirty|modified|pending)$/i,
    );
  }
  if (action === "update") {
    return readSemanticControlState(
      state,
      /^(?:updated|applied|up[-\s]?to[-\s]?date)$/i,
      /^(?:stale|outdated|dirty|modified|pending)$/i,
    );
  }
  if (action === "share") {
    return readSemanticControlState(
      state,
      /^shared$/i,
      /^(?:unshared|not[-\s]?shared|private|restricted|pending)$/i,
    );
  }
  if (action === "invite") {
    return readSemanticControlState(
      state,
      /^invited$/i,
      /^(?:uninvited|not[-\s]?invited|pending|none)$/i,
    );
  }
  if (action === "sync") {
    if (/^(?:synced|resynced|synchroni[sz]ed)$/i.test(state)) return true;
    if (/^(?:unsynced|stale|out[-\s]of[-\s]sync)$/i.test(state)) {
      return false;
    }
  }
  return null;
}
