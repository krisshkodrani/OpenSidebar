export type WorkflowConfirmationAction =
  | "delete"
  | "archive"
  | "save"
  | "send"
  | "export"
  | "download"
  | "upload"
  | "import"
  | "attach"
  | "detach"
  | "copy"
  | "transfer"
  | "move"
  | "rename"
  | "merge"
  | "schedule"
  | "unschedule"
  | "deploy"
  | "rollback"
  | "backup"
  | "reset"
  | "suspend"
  | "unsuspend"
  | "block"
  | "unblock"
  | "link"
  | "unlink"
  | "tag"
  | "untag"
  | "flag"
  | "unflag"
  | "duplicate"
  | "restore"
  | "create"
  | "share"
  | "grant"
  | "revoke"
  | "install"
  | "uninstall"
  | "connect"
  | "disconnect"
  | "sync"
  | "invite"
  | "subscribe"
  | "unsubscribe"
  | "pin"
  | "unpin"
  | "mute"
  | "unmute"
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
  | "post"
  | "approve"
  | "reject"
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
  | "restart"
  | "refresh"
  | "dismiss"
  | "update"
  | "submit"
  | "complete";

export const WORKFLOW_CONFIRMATION_ACTIONS = [
  "delete",
  "archive",
  "save",
  "send",
  "export",
  "download",
  "upload",
  "import",
  "attach",
  "detach",
  "copy",
  "transfer",
  "move",
  "rename",
  "merge",
  "schedule",
  "unschedule",
  "deploy",
  "rollback",
  "backup",
  "reset",
  "suspend",
  "unsuspend",
  "block",
  "unblock",
  "link",
  "unlink",
  "tag",
  "untag",
  "flag",
  "unflag",
  "duplicate",
  "restore",
  "create",
  "share",
  "grant",
  "revoke",
  "install",
  "uninstall",
  "connect",
  "disconnect",
  "sync",
  "invite",
  "subscribe",
  "unsubscribe",
  "pin",
  "unpin",
  "mute",
  "unmute",
  "follow",
  "unfollow",
  "bookmark",
  "unbookmark",
  "favorite",
  "unfavorite",
  "like",
  "unlike",
  "upvote",
  "downvote",
  "watch",
  "unwatch",
  "star",
  "unstar",
  "post",
  "approve",
  "reject",
  "close",
  "reopen",
  "cancel",
  "enable",
  "disable",
  "assign",
  "unassign",
  "escalate",
  "deescalate",
  "lock",
  "unlock",
  "pause",
  "resume",
  "start",
  "stop",
  "restart",
  "refresh",
  "dismiss",
  "update",
  "submit",
  "complete",
] as const satisfies readonly WorkflowConfirmationAction[];

export const TARGET_AWARE_VISIBLE_WORKFLOW_ACTIONS = [
  "delete",
  "archive",
  "save",
  "send",
  "export",
  "download",
  "upload",
  "import",
  "attach",
  "detach",
  "copy",
  "transfer",
  "move",
  "rename",
  "merge",
  "schedule",
  "unschedule",
  "deploy",
  "rollback",
  "backup",
  "reset",
  "suspend",
  "unsuspend",
  "block",
  "unblock",
  "link",
  "unlink",
  "tag",
  "untag",
  "flag",
  "unflag",
  "duplicate",
  "restore",
  "create",
  "share",
  "grant",
  "revoke",
  "install",
  "uninstall",
  "connect",
  "disconnect",
  "sync",
  "invite",
  "subscribe",
  "unsubscribe",
  "pin",
  "unpin",
  "mute",
  "unmute",
  "follow",
  "unfollow",
  "bookmark",
  "unbookmark",
  "favorite",
  "unfavorite",
  "like",
  "unlike",
  "upvote",
  "downvote",
  "watch",
  "unwatch",
  "star",
  "unstar",
  "post",
  "approve",
  "reject",
  "close",
  "reopen",
  "cancel",
  "enable",
  "disable",
  "assign",
  "unassign",
  "escalate",
  "deescalate",
  "lock",
  "unlock",
  "pause",
  "resume",
  "start",
  "stop",
  "restart",
  "refresh",
  "update",
  "submit",
  "complete",
] as const satisfies readonly WorkflowConfirmationAction[];

export type TargetAwareVisibleWorkflowAction =
  (typeof TARGET_AWARE_VISIBLE_WORKFLOW_ACTIONS)[number];

const WORKFLOW_ACTION_COMPLETION_LABELS: Record<
  WorkflowConfirmationAction,
  string
> = {
  delete: "Deleted",
  archive: "Archived",
  save: "Saved",
  send: "Sent",
  export: "Exported",
  download: "Downloaded",
  upload: "Uploaded",
  import: "Imported",
  attach: "Attached",
  detach: "Detached",
  copy: "Copied",
  transfer: "Transferred",
  move: "Moved",
  rename: "Renamed",
  merge: "Merged",
  schedule: "Scheduled",
  unschedule: "Unscheduled",
  deploy: "Deployed",
  rollback: "Rolled back",
  backup: "Backed up",
  reset: "Reset",
  suspend: "Suspended",
  unsuspend: "Unsuspended",
  block: "Blocked",
  unblock: "Unblocked",
  link: "Linked",
  unlink: "Unlinked",
  tag: "Tagged",
  untag: "Untagged",
  flag: "Flagged",
  unflag: "Unflagged",
  duplicate: "Duplicated",
  restore: "Restored",
  create: "Created",
  share: "Shared",
  grant: "Granted",
  revoke: "Revoked",
  install: "Installed",
  uninstall: "Uninstalled",
  connect: "Connected",
  disconnect: "Disconnected",
  sync: "Synced",
  invite: "Invited",
  subscribe: "Subscribed",
  unsubscribe: "Unsubscribed",
  pin: "Pinned",
  unpin: "Unpinned",
  mute: "Muted",
  unmute: "Unmuted",
  follow: "Followed",
  unfollow: "Unfollowed",
  bookmark: "Bookmarked",
  unbookmark: "Unbookmarked",
  favorite: "Favorited",
  unfavorite: "Unfavorited",
  like: "Liked",
  unlike: "Unliked",
  upvote: "Upvoted",
  downvote: "Downvoted",
  watch: "Watched",
  unwatch: "Unwatched",
  star: "Starred",
  unstar: "Unstarred",
  post: "Posted",
  approve: "Approved",
  reject: "Rejected",
  close: "Closed",
  reopen: "Reopened",
  cancel: "Canceled",
  enable: "Enabled",
  disable: "Disabled",
  assign: "Assigned",
  unassign: "Unassigned",
  escalate: "Escalated",
  deescalate: "De-escalated",
  lock: "Locked",
  unlock: "Unlocked",
  pause: "Paused",
  resume: "Resumed",
  start: "Started",
  stop: "Stopped",
  restart: "Restarted",
  refresh: "Refreshed",
  dismiss: "Dismissed",
  update: "Updated",
  submit: "Submitted",
  complete: "Completed",
};

export function workflowConfirmationActionCompletionLabel(
  action: WorkflowConfirmationAction,
): string {
  return WORKFLOW_ACTION_COMPLETION_LABELS[action];
}
