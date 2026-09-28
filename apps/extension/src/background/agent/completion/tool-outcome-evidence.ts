import type { DomSnapshot, TaggedElement, ToolName } from "../../../types";
import type { CompletionEvidence } from "./kernel-types";
import type { WorkflowConfirmationAction } from "./workflow-confirmation-types";
import { workflowConfirmationActionCompletionLabel } from "./workflow-confirmation-types";
import { cleanLabel, compactKey, normalizeText, tokenizeCompletionText } from "./text-utils";
import { samePageUrl } from "./navigation-analysis";
import { readAnswerToolEvidence } from "./read-answer-contract";
import { findModalLikeDescriptors, snapshotHasVisibleDismissalControl } from "./workflow-confirmation-contract";
import { elementControlText, inferTargetDisappearanceAction, isDismissalControl } from "./workflow-confirmation-analysis";
import { snapshotContainsNormalizedText } from "./workflow-state-evidence";

export function extractModalDismissalEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  const pre = params.preActionSnapshot;
  const current = params.currentSnapshot;
  if (!pre || !current) return [];
  if (!samePageUrl(pre.url, current.url)) return [];
  if (!isModalDismissalToolOutcome(params)) return [];

  const currentDescriptors = findModalLikeDescriptors(current);
  if (currentDescriptors.length > 0) return [];

  const dismissed = findModalLikeDescriptors(pre);
  const fallbackLabel =
    dismissed.length === 0 &&
    snapshotHasConsentBannerContext(pre) &&
    !snapshotHasVisibleDismissalControl(current)
      ? clickedDismissalControlLabelFromToolOutcome(params)
      : null;
  if (dismissed.length === 0 && !fallbackLabel) return [];

  const label = (
    dismissed.length > 0
      ? dismissed
          .map((descriptor) => descriptor.label)
          .filter(Boolean)
          .join(" | ")
      : fallbackLabel || "dismissal control"
  ).slice(0, 240);
  const identity = compactKey(
    dismissed.length > 0
      ? dismissed
          .map((descriptor) => descriptor.key)
          .filter(Boolean)
          .join("-") ||
          label ||
          "modal"
      : label || "dismissal-control",
  );

  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:dismiss:${identity || "modal"}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Modal dismissed${label ? `: ${label}` : ""}`,
        action: "dismiss",
        source: "modal_disappearance",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

export function extractTargetDisappearanceEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  const pre = params.preActionSnapshot;
  const current = params.currentSnapshot;
  if (!pre || !current) return [];
  if (!samePageUrl(pre.url, current.url)) return [];
  if (params.toolName !== "click_element") return [];

  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return [];
  const element = pre.elements.find((candidate) => candidate.tag === id);
  if (!element) return [];
  const action = inferTargetDisappearanceAction(element);
  if (!action) return [];

  const target = extractDisappearingTargetFromControl(element, action);
  if (!target) return [];
  const targetText = normalizeText(target);
  if (!targetText || !snapshotContainsNormalizedText(pre, targetText)) {
    return [];
  }
  if (snapshotContainsNormalizedText(current, targetText)) {
    return [];
  }

  const key = compactKey(target) || `tag-${element.tag}`;
  const actionLabel = workflowConfirmationActionCompletionLabel(action);
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `${actionLabel} target no longer visible: ${target}`,
        action,
        source: "target_disappearance",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

export function extractReadAnswerEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  if (params.toolName !== "read_page") return [];
  return readAnswerToolEvidence({
    result: params.result,
    snapshot: params.currentSnapshot ?? params.preActionSnapshot,
    observedAtTurn: params.turn,
  });
}

function clickedDismissalControlLabelFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  preActionSnapshot?: DomSnapshot | null;
}): string | null {
  if (params.toolName !== "click_element") return null;
  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return null;
  const element = params.preActionSnapshot?.elements.find(
    (candidate) => candidate.tag === id,
  );
  if (!element || !isDismissalControl(element)) return null;
  const label = [
    element.text,
    element.attributes["aria-label"],
    element.attributes.label,
    element.attributes.value,
    element.attributes.title,
    element.attributes.id,
  ]
    .map((part) => cleanLabel(part ?? ""))
    .find(Boolean);
  return label ?? cleanLabel(elementControlText(element));
}

function snapshotHasConsentBannerContext(snapshot: DomSnapshot): boolean {
  const text = normalizeText(
    [
      snapshot.title,
      snapshot.visibleContent,
      snapshot.pageContent,
      ...snapshot.elements.flatMap((element) => [
        element.text,
        element.attributes["aria-label"],
        element.attributes.label,
        element.attributes.title,
        element.attributes.id,
      ]),
    ]
      .filter(Boolean)
      .join(" "),
  );
  return (
    /\b(?:cookie|cookies|consent|privacy|gdpr)\b/i.test(text) &&
    /\b(?:accept|reject|decline|allow|agree|got it|ok|okay|dismiss|close)\b/i.test(
      text,
    )
  );
}

function isModalDismissalToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
}): boolean {
  if (params.toolName === "dismiss_overlays") {
    return /\bdismissed\s+[1-9][0-9]*\s+overlay/i.test(params.result);
  }

  if (params.toolName === "hide_element") {
    return /^Hidden\s+(?:element|overlay ancestor)\s+\[[^\]]+\]\s+<[^>]+>/i.test(
      params.result.trim(),
    );
  }

  if (params.toolName === "press_key") {
    const key = String(params.args.key ?? params.args.keys ?? "").trim();
    return /^(?:escape|esc)$/i.test(key);
  }

  if (params.toolName !== "click_element") return false;
  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return false;
  const element = params.preActionSnapshot?.elements.find(
    (candidate) => candidate.tag === id,
  );
  if (!element) return false;
  return isDismissalControl(element);
}

function extractDisappearingTargetFromControl(
  element: TaggedElement,
  action: Extract<
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
  >,
): string | null {
  const candidates = [
    element.text,
    element.attributes.label,
    element.attributes["aria-label"],
    element.attributes.title,
    element.attributes.name,
    element.attributes.id,
  ].map((value) => cleanLabel(value ?? ""));

  for (const candidate of candidates) {
    if (!candidate) continue;
    const actionPattern =
      action === "link"
        ? "link"
        : action === "tag"
          ? "tag"
          : action === "flag"
            ? "flag"
            : action === "delete"
              ? "(?:delete|remove)"
              : action === "archive"
                ? "archive"
                : action === "attach"
                  ? "attach"
                  : action === "detach"
                    ? "detach"
                    : action === "disconnect"
                      ? "disconnect"
                      : action === "connect"
                        ? "connect"
                        : action === "sync"
                          ? "(?:sync|synchronize)"
                          : action === "transfer"
                            ? "transfer"
                            : action === "move"
                              ? "move"
                              : action === "rename"
                                ? "rename"
                                : action === "merge"
                                  ? "merge"
                                  : action === "unlink"
                                    ? "unlink"
                                    : action === "untag"
                                      ? "untag"
                                      : action === "unflag"
                                        ? "unflag"
                                        : action === "unsubscribe"
                                          ? "(?:unsubscribe(?:\\s+from)?)"
                                          : action === "subscribe"
                                            ? "(?:subscribe(?:\\s+to)?)"
                                            : action === "unfollow"
                                              ? "unfollow"
                                              : action === "follow"
                                                ? "follow"
                                                : action === "unwatch"
                                                  ? "unwatch"
                                                  : action === "watch"
                                                    ? "watch"
                                                    : action === "unstar"
                                                      ? "unstar"
                                                      : action === "star"
                                                        ? "star"
                                                        : action ===
                                                            "unbookmark"
                                                          ? "unbookmark"
                                                          : action ===
                                                              "bookmark"
                                                            ? "bookmark"
                                                            : action ===
                                                                "unfavorite"
                                                              ? "unfavorite"
                                                              : action ===
                                                                  "favorite"
                                                                ? "favorite"
                                                                : action ===
                                                                    "unpin"
                                                                  ? "unpin"
                                                                  : action ===
                                                                      "pin"
                                                                    ? "pin"
                                                                    : action ===
                                                                        "unmute"
                                                                      ? "unmute"
                                                                      : action ===
                                                                          "mute"
                                                                        ? "mute"
                                                                        : action ===
                                                                            "unschedule"
                                                                          ? "unschedule"
                                                                          : action ===
                                                                              "schedule"
                                                                            ? "schedule"
                                                                            : action ===
                                                                                "unassign"
                                                                              ? "unassign"
                                                                              : action ===
                                                                                  "assign"
                                                                                ? "assign"
                                                                                : action ===
                                                                                    "cancel"
                                                                                  ? "cancel"
                                                                                  : action ===
                                                                                      "unlock"
                                                                                    ? "unlock"
                                                                                    : action ===
                                                                                        "lock"
                                                                                      ? "lock"
                                                                                      : action ===
                                                                                          "enable"
                                                                                        ? "(?:enable|activate)"
                                                                                        : action ===
                                                                                            "disable"
                                                                                          ? "(?:disable|deactivate)"
                                                                                          : action ===
                                                                                              "pause"
                                                                                            ? "pause"
                                                                                            : action ===
                                                                                                "resume"
                                                                                              ? "resume"
                                                                                              : action ===
                                                                                                  "start"
                                                                                                ? "start"
                                                                                                : action ===
                                                                                                    "stop"
                                                                                                  ? "stop"
                                                                                                  : action ===
                                                                                                      "restart"
                                                                                                    ? "restart"
                                                                                                    : action ===
                                                                                                        "refresh"
                                                                                                      ? "refresh"
                                                                                                      : action ===
                                                                                                          "approve"
                                                                                                        ? "approve"
                                                                                                        : action ===
                                                                                                            "reject"
                                                                                                          ? "(?:reject|deny)"
                                                                                                          : action ===
                                                                                                              "close"
                                                                                                            ? "(?:close|resolve)"
                                                                                                            : action ===
                                                                                                                "reopen"
                                                                                                              ? "(?:re[-\\s]?open)"
                                                                                                              : action ===
                                                                                                                  "escalate"
                                                                                                                ? "escalate"
                                                                                                                : action ===
                                                                                                                    "deescalate"
                                                                                                                  ? "(?:de[-\\s]?escalate)"
                                                                                                                  : action ===
                                                                                                                      "complete"
                                                                                                                    ? "(?:complete|mark|set)"
                                                                                                                    : action ===
                                                                                                                        "submit"
                                                                                                                      ? "submit"
                                                                                                                      : action ===
                                                                                                                          "send"
                                                                                                                        ? "(?:send|email)"
                                                                                                                        : action ===
                                                                                                                            "post"
                                                                                                                          ? "(?:post|publish)"
                                                                                                                          : action ===
                                                                                                                              "update"
                                                                                                                            ? "(?:update|apply(?:\\s+changes)?(?:\\s+to)?)"
                                                                                                                            : action ===
                                                                                                                                "save"
                                                                                                                              ? "save"
                                                                                                                              : action ===
                                                                                                                                  "export"
                                                                                                                                ? "export"
                                                                                                                                : action ===
                                                                                                                                    "download"
                                                                                                                                  ? "download"
                                                                                                                                  : action ===
                                                                                                                                      "upload"
                                                                                                                                    ? "upload"
                                                                                                                                    : action ===
                                                                                                                                        "import"
                                                                                                                                      ? "import"
                                                                                                                                      : action ===
                                                                                                                                          "copy"
                                                                                                                                        ? "copy"
                                                                                                                                        : action ===
                                                                                                                                            "share"
                                                                                                                                          ? "share"
                                                                                                                                          : action ===
                                                                                                                                              "restore"
                                                                                                                                            ? "(?:restore|recover|reinstate)"
                                                                                                                                            : action ===
                                                                                                                                                "duplicate"
                                                                                                                                              ? "(?:duplicate|clone)"
                                                                                                                                              : action ===
                                                                                                                                                  "invite"
                                                                                                                                                ? "invite"
                                                                                                                                                : action ===
                                                                                                                                                    "grant"
                                                                                                                                                  ? "grant"
                                                                                                                                                  : action ===
                                                                                                                                                      "revoke"
                                                                                                                                                    ? "(?:revoke|revocation)"
                                                                                                                                                    : action ===
                                                                                                                                                        "unblock"
                                                                                                                                                      ? "unblock"
                                                                                                                                                      : action ===
                                                                                                                                                          "block"
                                                                                                                                                        ? "block"
                                                                                                                                                        : action ===
                                                                                                                                                            "unsuspend"
                                                                                                                                                          ? "unsuspend"
                                                                                                                                                          : action ===
                                                                                                                                                              "suspend"
                                                                                                                                                            ? "suspend"
                                                                                                                                                            : action ===
                                                                                                                                                                "backup"
                                                                                                                                                              ? "(?:back\\s+up|backup)"
                                                                                                                                                              : action ===
                                                                                                                                                                  "deploy"
                                                                                                                                                                ? "deploy"
                                                                                                                                                                : action ===
                                                                                                                                                                    "rollback"
                                                                                                                                                                  ? "(?:roll\\s+back|rollback|revert|reversion)"
                                                                                                                                                                  : action ===
                                                                                                                                                                      "reset"
                                                                                                                                                                    ? "reset"
                                                                                                                                                                    : action ===
                                                                                                                                                                        "install"
                                                                                                                                                                      ? "install"
                                                                                                                                                                      : "uninstall";
    const explicit = new RegExp(
      `\\b${actionPattern}\\b\\s+(?:the\\s+)?(.{3,120})`,
      "i",
    ).exec(candidate);
    if (!explicit?.[1]) continue;
    const rawTarget = cleanLabel(explicit[1]);
    let target = rawTarget
      .replace(
        /\b(?:button|link|action|delete|remove|archive|attach|attached|attaching|detach|disconnect|disconnection|connect|connected|connecting|connection|sync|synced|syncing|synchronize|synchronized|synchronizing|synchronization|transfer|transferred|transferring|move|moved|moving|rename|renamed|renaming|merge|merged|merging|unlink|untag|untagging|tag|tagged|tagging|unflag|unflagging|flag|flagged|flagging|unsubscribe|unsubscribed|unsubscription|subscribe|subscribed|subscription|unfollow|unfollowed|follow|followed|unwatch|unwatched|watch|watched|watching|unstar|unstarred|star|starred|starring|unbookmark|unbookmarked|bookmark|bookmarked|bookmarking|unfavorite|unfavorited|favorite|favorited|favoriting|unpin|unpinned|pin|pinned|pinning|unmute|unmuted|mute|muted|muting|unschedule|unscheduled|schedule|scheduled|scheduling|unassign|unassigned|assign|assigned|assignment|assignee|cancel|canceled|cancelled|cancellation|unlock|unlocked|lock|locked|enable|enabled|activate|activated|activation|disable|disabled|deactivate|deactivated|deactivation|pause|paused|pausing|resume|resumed|resuming|start|started|starting|stop|stopped|stopping|restart|restarted|restarting|refresh|refreshed|refreshing|approve|approved|approving|approval|reject|rejected|rejecting|rejection|deny|denied|denial|close|closed|closing|closure|resolve|resolved|resolving|resolution|re[-\s]?open|re[-\s]?opened|re[-\s]?opening|de[-\s]?escalate|de[-\s]?escalated|de[-\s]?escalating|de[-\s]?escalation|escalate|escalated|escalating|escalation|complete|completed|completing|completion|submit|submitted|submission|send|sent|sending|email|emailed|emailing|post|posted|posting|publish|published|publishing|update|updated|updating|save|saved|saving|export|exported|exporting|download|downloaded|downloading|upload|uploaded|uploading|import|imported|importing|copy|copied|copying|share|shared|sharing|restore|restored|restoring|recover|recovered|recovering|reinstate|reinstated|reinstating|duplicate|duplicated|duplicating|duplication|clone|cloned|cloning|invite|invited|inviting|invitation|grant|granted|granting|revoke|revocation|unblock|block|blocking|unsuspend|suspend|suspension|back\s+up|backup|backed\s+up|backing\s+up|deploy|deployed|deploying|deployment|rollback|rolled\s+back|rolling\s+back|revert|reverted|reverting|reversion|reset|resetting|install|installed|installing|installation|uninstall)\b/gi,
        " ",
      )
      .replace(/\b(?:item|entry|row|record)\b/gi, " ")
      .replace(/^["'`]+|["'`]+$/g, "");
    target = cleanLabel(target);
    if (action === "copy" && tokenizeCompletionText(rawTarget).length > 1) {
      target = rawTarget;
    }
    if (!target) continue;

    const tokens = tokenizeCompletionText(target).filter(
      (token) =>
        ![
          "account",
          "add",
          "add-on",
          "addon",
          "admin",
          "administrator",
          "app",
          "application",
          "article",
          "articles",
          "approval",
          "approve",
          "approved",
          "approving",
          "denial",
          "denied",
          "deny",
          "attach",
          "attached",
          "attaching",
          "activate",
          "activated",
          "activation",
          "archive",
          "assign",
          "assigned",
          "assignee",
          "assignment",
          "attachment",
          "backup",
          "backed",
          "backing",
          "button",
          "cancel",
          "canceled",
          "cancelled",
          "cancellation",
          "case",
          "block",
          "blocking",
          "bookmark",
          "bookmarked",
          "bookmarking",
          "browser",
          "change",
          "changes",
          "channel",
          "connector",
          "connect",
          "connected",
          "connecting",
          "connection",
          "close",
          "closed",
          "closing",
          "closure",
          "complete",
          "completed",
          "completing",
          "completion",
          "csv",
          "dashboard",
          "dashboards",
          "data",
          "dataset",
          "datasets",
          "delete",
          "deactivate",
          "deactivated",
          "deactivation",
          "deescalate",
          "deescalated",
          "deescalating",
          "deescalation",
          "deploy",
          "deployed",
          "deploying",
          "deployment",
          "detach",
          "detachment",
          "disable",
          "disabled",
          "dialog",
          "disconnect",
          "disconnection",
          "download",
          "downloaded",
          "downloading",
          "upload",
          "uploaded",
          "uploading",
          "import",
          "imported",
          "importing",
          "copy",
          "copied",
          "copying",
          "clipboard",
          "comment",
          "comments",
          "share",
          "shared",
          "sharing",
          "restore",
          "restored",
          "restoring",
          "recover",
          "recovered",
          "recovering",
          "reinstate",
          "reinstated",
          "reinstating",
          "duplicate",
          "duplicated",
          "duplicating",
          "duplication",
          "clone",
          "cloned",
          "cloning",
          "invite",
          "invited",
          "inviting",
          "invitation",
          "contact",
          "contacts",
          "guest",
          "guests",
          "member",
          "members",
          "person",
          "people",
          "user",
          "users",
          "dependency",
          "document",
          "draft",
          "drafts",
          "driver",
          "endpoint",
          "enable",
          "enabled",
          "entry",
          "entitlement",
          "escalate",
          "escalated",
          "escalating",
          "escalation",
          "export",
          "exported",
          "exporting",
          "extension",
          "file",
          "flag",
          "flagged",
          "flagging",
          "feed",
          "favorite",
          "favorited",
          "favoriting",
          "grant",
          "granted",
          "granting",
          "integration",
          "install",
          "installation",
          "installed",
          "installing",
          "incident",
          "incidents",
          "item",
          "license",
          "licence",
          "link",
          "linked",
          "list",
          "membership",
          "modal",
          "module",
          "move",
          "moved",
          "moving",
          "rename",
          "renamed",
          "renaming",
          "reopen",
          "reopened",
          "reopening",
          "merge",
          "merged",
          "merging",
          "mute",
          "muted",
          "muting",
          "newsletter",
          "overlay",
          "package",
          "page",
          "panel",
          "pause",
          "paused",
          "pausing",
          "permission",
          "plugin",
          "pop-up",
          "popup",
          "pin",
          "pinned",
          "pinning",
          "provider",
          "privilege",
          "profile",
          "record",
          "report",
          "reports",
          "repository",
          "remove",
          "request",
          "result",
          "results",
          "reject",
          "rejected",
          "rejecting",
          "rejection",
          "resolve",
          "resolved",
          "resolving",
          "resolution",
          "rollback",
          "revert",
          "reverted",
          "reversion",
          "reset",
          "resetting",
          "refresh",
          "refreshed",
          "refreshing",
          "restart",
          "restarted",
          "restarting",
          "resume",
          "resumed",
          "resuming",
          "revoke",
          "revocation",
          "role",
          "row",
          "save",
          "saved",
          "saving",
          "screen",
          "screens",
          "send",
          "sent",
          "sending",
          "email",
          "emailed",
          "emailing",
          "message",
          "messages",
          "post",
          "posts",
          "posted",
          "posting",
          "publish",
          "published",
          "publishing",
          "schedule",
          "scheduled",
          "service",
          "source",
          "spreadsheet",
          "spreadsheets",
          "star",
          "starred",
          "start",
          "started",
          "starting",
          "stop",
          "stopped",
          "stopping",
          "subscription",
          "subscribe",
          "subscribed",
          "subscriber",
          "subscribers",
          "submit",
          "submitted",
          "submission",
          "update",
          "updated",
          "updating",
          "suspend",
          "suspension",
          "sync",
          "synced",
          "syncing",
          "synchronization",
          "synchronize",
          "synchronized",
          "synchronizing",
          "transfer",
          "transferred",
          "transferring",
          "theme",
          "ticket",
          "tool",
          "topic",
          "tag",
          "tagged",
          "tagging",
          "table",
          "tables",
          "tab",
          "tabs",
          "task",
          "tasks",
          "template",
          "templates",
          "unblock",
          "unblocking",
          "unbookmark",
          "unbookmarked",
          "unfavorite",
          "unfavorited",
          "unpin",
          "unpinned",
          "unmute",
          "unmuted",
          "unschedule",
          "unscheduled",
          "unlink",
          "unlinking",
          "unflag",
          "unflagging",
          "untag",
          "untagging",
          "unsubscribe",
          "unsubscribed",
          "unsubscription",
          "unassign",
          "unassigned",
          "unlock",
          "unlocked",
          "lock",
          "locked",
          "follow",
          "followed",
          "follower",
          "followers",
          "unfollow",
          "unfollowed",
          "watch",
          "watched",
          "watcher",
          "watchers",
          "watching",
          "unwatch",
          "unwatched",
          "unstar",
          "unstarred",
          "starring",
          "unsuspend",
          "unsuspension",
          "uninstall",
          "uninstallation",
          "view",
          "views",
          "window",
          "windows",
          "workflow",
        ].includes(token),
    );
    if (tokens.length > 0) return target;
  }
  return null;
}
