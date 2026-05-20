import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import type { DomSnapshot } from "../../src/types";

function workflowSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Account Settings",
    url: "https://example.test/account",
    visibleContent: "Account settings",
    pageContent: "Account settings",
    elements: [],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

describe("completion kernel target-aware visible workflow confirmation matrix", () => {
  for (const scenario of [
    {
      action: "save",
      request: "Save Draft Alpha.",
      summary: "Saved Draft Alpha.",
      targetLabel: "Draft Alpha",
      requestedVisible:
        "Draft Beta remains unsaved. Draft Alpha saved successfully.",
      requestedEvidenceText: "Draft Alpha saved successfully.",
      otherVisible: "Draft Alpha remains unsaved. Draft Beta saved successfully.",
      otherEvidenceText: "Draft Beta saved successfully.",
      genericVisible: "Save completed.",
      genericSummary: "Save completed.",
    },
    {
      action: "send",
      request: "Send Message Alpha.",
      summary: "Sent Message Alpha.",
      targetLabel: "Message Alpha",
      requestedVisible:
        "Message Beta remains draft. Message Alpha sent successfully.",
      requestedEvidenceText: "Message Alpha sent successfully.",
      otherVisible:
        "Message Alpha remains draft. Message Beta sent successfully.",
      otherEvidenceText: "Message Beta sent successfully.",
      genericVisible: "Send completed.",
      genericSummary: "Send completed.",
    },
    {
      action: "export",
      request: "Export Report Alpha.",
      summary: "Exported Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains available. Report Alpha exported successfully.",
      requestedEvidenceText: "Report Alpha exported successfully.",
      otherVisible:
        "Report Alpha remains available. Report Beta exported successfully.",
      otherEvidenceText: "Report Beta exported successfully.",
      genericVisible: "Export completed.",
      genericSummary: "Export completed.",
    },
    {
      action: "download",
      request: "Download File Alpha.",
      summary: "Downloaded File Alpha.",
      targetLabel: "File Alpha",
      requestedVisible:
        "File Beta remains available. File Alpha downloaded successfully.",
      requestedEvidenceText: "File Alpha downloaded successfully.",
      otherVisible:
        "File Alpha remains available. File Beta downloaded successfully.",
      otherEvidenceText: "File Beta downloaded successfully.",
      genericVisible: "Download completed.",
      genericSummary: "Download completed.",
    },
    {
      action: "upload",
      request: "Upload Attachment Alpha.",
      summary: "Uploaded Attachment Alpha.",
      targetLabel: "Attachment Alpha",
      requestedVisible:
        "Attachment Beta remains pending. Attachment Alpha uploaded successfully.",
      requestedEvidenceText: "Attachment Alpha uploaded successfully.",
      otherVisible:
        "Attachment Alpha remains pending. Attachment Beta uploaded successfully.",
      otherEvidenceText: "Attachment Beta uploaded successfully.",
      genericVisible: "Upload completed.",
      genericSummary: "Upload completed.",
    },
    {
      action: "import",
      request: "Import Contacts Alpha.",
      summary: "Imported Contacts Alpha.",
      targetLabel: "Contacts Alpha",
      requestedVisible:
        "Contacts Beta remains pending. Contacts Alpha imported successfully.",
      requestedEvidenceText: "Contacts Alpha imported successfully.",
      otherVisible:
        "Contacts Alpha remains pending. Contacts Beta imported successfully.",
      otherEvidenceText: "Contacts Beta imported successfully.",
      genericVisible: "Import completed.",
      genericSummary: "Import completed.",
    },
    {
      action: "copy",
      request: "Copy Link Alpha.",
      summary: "Copied Link Alpha.",
      targetLabel: "Link Alpha",
      requestedVisible:
        "Link Beta remains available. Link Alpha copied successfully.",
      requestedEvidenceText: "Link Alpha copied successfully.",
      otherVisible:
        "Link Alpha remains available. Link Beta copied successfully.",
      otherEvidenceText: "Link Beta copied successfully.",
      genericVisible: "Copied to clipboard.",
      genericSummary: "Copy completed.",
    },
    {
      action: "transfer",
      request: "Transfer Ticket Alpha.",
      summary: "Transferred Ticket Alpha.",
      targetLabel: "Ticket Alpha",
      requestedVisible:
        "Ticket Beta remains in the queue. Ticket Alpha transferred successfully.",
      requestedEvidenceText: "Ticket Alpha transferred successfully.",
      otherVisible:
        "Ticket Alpha remains in the queue. Ticket Beta transferred successfully.",
      otherEvidenceText: "Ticket Beta transferred successfully.",
      genericVisible: "Transfer completed.",
      genericSummary: "Transfer completed.",
    },
    {
      action: "move",
      request: "Move Card Alpha.",
      summary: "Moved Card Alpha.",
      targetLabel: "Card Alpha",
      requestedVisible:
        "Card Beta remains in Backlog. Card Alpha moved successfully.",
      requestedEvidenceText: "Card Alpha moved successfully.",
      otherVisible:
        "Card Alpha remains in Backlog. Card Beta moved successfully.",
      otherEvidenceText: "Card Beta moved successfully.",
      genericVisible: "Move completed.",
      genericSummary: "Move completed.",
    },
    {
      action: "rename",
      request: "Rename File Alpha.",
      summary: "Renamed File Alpha.",
      targetLabel: "File Alpha",
      requestedVisible:
        "File Beta keeps its name. File Alpha renamed successfully.",
      requestedEvidenceText: "File Alpha renamed successfully.",
      otherVisible:
        "File Alpha keeps its name. File Beta renamed successfully.",
      otherEvidenceText: "File Beta renamed successfully.",
      genericVisible: "Rename completed.",
      genericSummary: "Rename completed.",
    },
    {
      action: "merge",
      request: "Merge Pull Request Alpha.",
      summary: "Merged Pull Request Alpha.",
      targetLabel: "Pull Request Alpha",
      requestedVisible:
        "Pull Request Beta remains open. Pull Request Alpha merged successfully.",
      requestedEvidenceText: "Pull Request Alpha merged successfully.",
      otherVisible:
        "Pull Request Alpha remains open. Pull Request Beta merged successfully.",
      otherEvidenceText: "Pull Request Beta merged successfully.",
      genericVisible: "Merge completed.",
      genericSummary: "Merge completed.",
    },
    {
      action: "schedule",
      request: "Schedule Report Alpha.",
      summary: "Scheduled Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains unscheduled. Report Alpha scheduled successfully.",
      requestedEvidenceText: "Report Alpha scheduled successfully.",
      otherVisible:
        "Report Alpha remains unscheduled. Report Beta scheduled successfully.",
      otherEvidenceText: "Report Beta scheduled successfully.",
      genericVisible: "Schedule completed.",
      genericSummary: "Schedule completed.",
    },
    {
      action: "unschedule",
      request: "Unschedule Report Alpha.",
      summary: "Unscheduled Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains scheduled. Report Alpha unscheduled successfully.",
      requestedEvidenceText: "Report Alpha unscheduled successfully.",
      otherVisible:
        "Report Alpha remains scheduled. Report Beta unscheduled successfully.",
      otherEvidenceText: "Report Beta unscheduled successfully.",
      genericVisible: "Unschedule completed.",
      genericSummary: "Unschedule completed.",
    },
    {
      action: "deploy",
      request: "Deploy Release Alpha.",
      summary: "Deployed Release Alpha.",
      targetLabel: "Release Alpha",
      requestedVisible:
        "Release Beta remains staged. Release Alpha deployed successfully.",
      requestedEvidenceText: "Release Alpha deployed successfully.",
      otherVisible:
        "Release Alpha remains staged. Release Beta deployed successfully.",
      otherEvidenceText: "Release Beta deployed successfully.",
      genericVisible: "Deployment completed.",
      genericSummary: "Deployment completed.",
    },
    {
      action: "rollback",
      request: "Rollback Release Alpha.",
      summary: "Rolled back Release Alpha.",
      targetLabel: "Release Alpha",
      requestedVisible:
        "Release Beta remains active. Release Alpha rolled back successfully.",
      requestedEvidenceText: "Release Alpha rolled back successfully.",
      otherVisible:
        "Release Alpha remains active. Release Beta rolled back successfully.",
      otherEvidenceText: "Release Beta rolled back successfully.",
      genericVisible: "Rollback completed.",
      genericSummary: "Rollback completed.",
    },
    {
      action: "backup",
      request: "Back up Database Alpha.",
      summary: "Backed up Database Alpha.",
      targetLabel: "Database Alpha",
      requestedVisible:
        "Database Beta remains unbacked. Database Alpha backed up successfully.",
      requestedEvidenceText: "Database Alpha backed up successfully.",
      otherVisible:
        "Database Alpha remains unbacked. Database Beta backed up successfully.",
      otherEvidenceText: "Database Beta backed up successfully.",
      genericVisible: "Backup completed.",
      genericSummary: "Backup completed.",
    },
    {
      action: "reset",
      request: "Reset Password Alpha.",
      summary: "Reset Password Alpha.",
      targetLabel: "Password Alpha",
      requestedVisible:
        "Password Beta remains unchanged. Password Alpha reset successfully.",
      requestedEvidenceText: "Password Alpha reset successfully.",
      otherVisible:
        "Password Alpha remains unchanged. Password Beta reset successfully.",
      otherEvidenceText: "Password Beta reset successfully.",
      genericVisible: "Reset completed.",
      genericSummary: "Reset completed.",
    },
    {
      action: "suspend",
      request: "Suspend Account Alpha.",
      summary: "Suspended Account Alpha.",
      targetLabel: "Account Alpha",
      requestedVisible:
        "Account Beta remains active. Account Alpha suspended successfully.",
      requestedEvidenceText: "Account Alpha suspended successfully.",
      otherVisible:
        "Account Alpha remains active. Account Beta suspended successfully.",
      otherEvidenceText: "Account Beta suspended successfully.",
      genericVisible: "Suspension completed.",
      genericSummary: "Suspension completed.",
    },
    {
      action: "unsuspend",
      request: "Unsuspend Account Alpha.",
      summary: "Unsuspended Account Alpha.",
      targetLabel: "Account Alpha",
      requestedVisible:
        "Account Beta remains suspended. Account Alpha unsuspended successfully.",
      requestedEvidenceText: "Account Alpha unsuspended successfully.",
      otherVisible:
        "Account Alpha remains suspended. Account Beta unsuspended successfully.",
      otherEvidenceText: "Account Beta unsuspended successfully.",
      genericVisible: "Unsuspend completed.",
      genericSummary: "Unsuspend completed.",
    },
    {
      action: "block",
      request: "Block User Alpha.",
      summary: "Blocked User Alpha.",
      targetLabel: "User Alpha",
      requestedVisible:
        "User Beta remains allowed. User Alpha blocked successfully.",
      requestedEvidenceText: "User Alpha blocked successfully.",
      otherVisible:
        "User Alpha remains allowed. User Beta blocked successfully.",
      otherEvidenceText: "User Beta blocked successfully.",
      genericVisible: "Block completed.",
      genericSummary: "Block completed.",
    },
    {
      action: "unblock",
      request: "Unblock User Alpha.",
      summary: "Unblocked User Alpha.",
      targetLabel: "User Alpha",
      requestedVisible:
        "User Beta remains blocked. User Alpha unblocked successfully.",
      requestedEvidenceText: "User Alpha unblocked successfully.",
      otherVisible:
        "User Alpha remains blocked. User Beta unblocked successfully.",
      otherEvidenceText: "User Beta unblocked successfully.",
      genericVisible: "Unblock completed.",
      genericSummary: "Unblock completed.",
    },
    {
      action: "link",
      request: "Link Account Alpha.",
      summary: "Linked Account Alpha.",
      targetLabel: "Account Alpha",
      requestedVisible:
        "Account Beta remains separate. Account Alpha linked successfully.",
      requestedEvidenceText: "Account Alpha linked successfully.",
      otherVisible:
        "Account Alpha remains separate. Account Beta linked successfully.",
      otherEvidenceText: "Account Beta linked successfully.",
      genericVisible: "Link completed.",
      genericSummary: "Link completed.",
    },
    {
      action: "unlink",
      request: "Unlink Account Alpha.",
      summary: "Unlinked Account Alpha.",
      targetLabel: "Account Alpha",
      requestedVisible:
        "Account Beta remains linked. Account Alpha unlinked successfully.",
      requestedEvidenceText: "Account Alpha unlinked successfully.",
      otherVisible:
        "Account Alpha remains linked. Account Beta unlinked successfully.",
      otherEvidenceText: "Account Beta unlinked successfully.",
      genericVisible: "Unlink completed.",
      genericSummary: "Unlink completed.",
    },
    {
      action: "tag",
      request: "Tag Issue Alpha.",
      summary: "Tagged Issue Alpha.",
      targetLabel: "Issue Alpha",
      requestedVisible:
        "Issue Beta remains untagged. Issue Alpha tagged successfully.",
      requestedEvidenceText: "Issue Alpha tagged successfully.",
      otherVisible:
        "Issue Alpha remains untagged. Issue Beta tagged successfully.",
      otherEvidenceText: "Issue Beta tagged successfully.",
      genericVisible: "Tag completed.",
      genericSummary: "Tag completed.",
    },
    {
      action: "untag",
      request: "Untag Issue Alpha.",
      summary: "Untagged Issue Alpha.",
      targetLabel: "Issue Alpha",
      requestedVisible:
        "Issue Beta remains tagged. Issue Alpha untagged successfully.",
      requestedEvidenceText: "Issue Alpha untagged successfully.",
      otherVisible:
        "Issue Alpha remains tagged. Issue Beta untagged successfully.",
      otherEvidenceText: "Issue Beta untagged successfully.",
      genericVisible: "Untag completed.",
      genericSummary: "Untag completed.",
    },
    {
      action: "flag",
      request: "Flag Message Alpha.",
      summary: "Flagged Message Alpha.",
      targetLabel: "Message Alpha",
      requestedVisible:
        "Message Beta remains normal. Message Alpha flagged successfully.",
      requestedEvidenceText: "Message Alpha flagged successfully.",
      otherVisible:
        "Message Alpha remains normal. Message Beta flagged successfully.",
      otherEvidenceText: "Message Beta flagged successfully.",
      genericVisible: "Flag completed.",
      genericSummary: "Flag completed.",
    },
    {
      action: "unflag",
      request: "Unflag Message Alpha.",
      summary: "Unflagged Message Alpha.",
      targetLabel: "Message Alpha",
      requestedVisible:
        "Message Beta remains flagged. Message Alpha unflagged successfully.",
      requestedEvidenceText: "Message Alpha unflagged successfully.",
      otherVisible:
        "Message Alpha remains flagged. Message Beta unflagged successfully.",
      otherEvidenceText: "Message Beta unflagged successfully.",
      genericVisible: "Unflag completed.",
      genericSummary: "Unflag completed.",
    },
    {
      action: "duplicate",
      request: "Duplicate Record Alpha.",
      summary: "Duplicated Record Alpha.",
      targetLabel: "Record Alpha",
      requestedVisible:
        "Record Beta remains original. Record Alpha duplicated successfully.",
      requestedEvidenceText: "Record Alpha duplicated successfully.",
      otherVisible:
        "Record Alpha remains original. Record Beta duplicated successfully.",
      otherEvidenceText: "Record Beta duplicated successfully.",
      genericVisible: "Duplicate completed.",
      genericSummary: "Duplicate completed.",
    },
    {
      action: "restore",
      request: "Restore Record Alpha.",
      summary: "Restored Record Alpha.",
      targetLabel: "Record Alpha",
      requestedVisible:
        "Record Beta remains archived. Record Alpha restored successfully.",
      requestedEvidenceText: "Record Alpha restored successfully.",
      otherVisible:
        "Record Alpha remains archived. Record Beta restored successfully.",
      otherEvidenceText: "Record Beta restored successfully.",
      genericVisible: "Restore completed.",
      genericSummary: "Restore completed.",
    },
    {
      action: "create",
      request: "Create Record Alpha.",
      summary: "Created Record Alpha.",
      targetLabel: "Record Alpha",
      requestedVisible:
        "Record Beta remains absent. Record Alpha created successfully.",
      requestedEvidenceText: "Record Alpha created successfully.",
      otherVisible:
        "Record Alpha remains absent. Record Beta created successfully.",
      otherEvidenceText: "Record Beta created successfully.",
      genericVisible: "Create completed.",
      genericSummary: "Create completed.",
    },
    {
      action: "share",
      request: "Share Report Alpha.",
      summary: "Shared Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains private. Report Alpha shared successfully.",
      requestedEvidenceText: "Report Alpha shared successfully.",
      otherVisible:
        "Report Alpha remains private. Report Beta shared successfully.",
      otherEvidenceText: "Report Beta shared successfully.",
      genericVisible: "Share completed.",
      genericSummary: "Share completed.",
    },
    {
      action: "grant",
      request: "Grant Role Alpha.",
      summary: "Granted Role Alpha.",
      targetLabel: "Role Alpha",
      requestedVisible:
        "Role Beta remains unavailable. Role Alpha granted successfully.",
      requestedEvidenceText: "Role Alpha granted successfully.",
      otherVisible:
        "Role Alpha remains unavailable. Role Beta granted successfully.",
      otherEvidenceText: "Role Beta granted successfully.",
      genericVisible: "Grant completed.",
      genericSummary: "Grant completed.",
    },
    {
      action: "revoke",
      request: "Revoke Role Alpha.",
      summary: "Revoked Role Alpha.",
      targetLabel: "Role Alpha",
      requestedVisible:
        "Role Beta remains available. Role Alpha revoked successfully.",
      requestedEvidenceText: "Role Alpha revoked successfully.",
      otherVisible:
        "Role Alpha remains available. Role Beta revoked successfully.",
      otherEvidenceText: "Role Beta revoked successfully.",
      genericVisible: "Revocation completed.",
      genericSummary: "Revocation completed.",
    },
    {
      action: "install",
      request: "Install Package Alpha.",
      summary: "Installed Package Alpha.",
      targetLabel: "Package Alpha",
      requestedVisible:
        "Package Beta remains unavailable. Package Alpha installed successfully.",
      requestedEvidenceText: "Package Alpha installed successfully.",
      otherVisible:
        "Package Alpha remains unavailable. Package Beta installed successfully.",
      otherEvidenceText: "Package Beta installed successfully.",
      genericVisible: "Installation completed.",
      genericSummary: "Installation completed.",
    },
    {
      action: "uninstall",
      request: "Uninstall Package Alpha.",
      summary: "Uninstalled Package Alpha.",
      targetLabel: "Package Alpha",
      requestedVisible:
        "Package Beta remains installed. Package Alpha uninstalled successfully.",
      requestedEvidenceText: "Package Alpha uninstalled successfully.",
      otherVisible:
        "Package Alpha remains installed. Package Beta uninstalled successfully.",
      otherEvidenceText: "Package Beta uninstalled successfully.",
      genericVisible: "Uninstallation completed.",
      genericSummary: "Uninstallation completed.",
    },
    {
      action: "connect",
      request: "Connect Integration Alpha.",
      summary: "Connected Integration Alpha.",
      targetLabel: "Integration Alpha",
      requestedVisible:
        "Integration Beta remains disconnected. Integration Alpha connected successfully.",
      requestedEvidenceText: "Integration Alpha connected successfully.",
      otherVisible:
        "Integration Alpha remains disconnected. Integration Beta connected successfully.",
      otherEvidenceText: "Integration Beta connected successfully.",
      genericVisible: "Connection completed.",
      genericSummary: "Connection completed.",
    },
    {
      action: "disconnect",
      request: "Disconnect Integration Alpha.",
      summary: "Disconnected Integration Alpha.",
      targetLabel: "Integration Alpha",
      requestedVisible:
        "Integration Beta remains connected. Integration Alpha disconnected successfully.",
      requestedEvidenceText: "Integration Alpha disconnected successfully.",
      otherVisible:
        "Integration Alpha remains connected. Integration Beta disconnected successfully.",
      otherEvidenceText: "Integration Beta disconnected successfully.",
      genericVisible: "Disconnection completed.",
      genericSummary: "Disconnection completed.",
    },
    {
      action: "sync",
      request: "Sync Integration Alpha.",
      summary: "Synced Integration Alpha.",
      targetLabel: "Integration Alpha",
      requestedVisible:
        "Integration Beta remains stale. Integration Alpha synced successfully.",
      requestedEvidenceText: "Integration Alpha synced successfully.",
      otherVisible:
        "Integration Alpha remains stale. Integration Beta synced successfully.",
      otherEvidenceText: "Integration Beta synced successfully.",
      genericVisible: "Sync completed.",
      genericSummary: "Sync completed.",
    },
    {
      action: "attach",
      request: "Attach File Alpha.",
      summary: "Attached File Alpha.",
      targetLabel: "File Alpha",
      requestedVisible:
        "File Beta remains unattached. File Alpha attached successfully.",
      requestedEvidenceText: "File Alpha attached successfully.",
      otherVisible:
        "File Alpha remains unattached. File Beta attached successfully.",
      otherEvidenceText: "File Beta attached successfully.",
      genericVisible: "Attachment completed.",
      genericSummary: "Attachment completed.",
    },
    {
      action: "detach",
      request: "Detach File Alpha.",
      summary: "Detached File Alpha.",
      targetLabel: "File Alpha",
      requestedVisible:
        "File Beta remains attached. File Alpha detached successfully.",
      requestedEvidenceText: "File Alpha detached successfully.",
      otherVisible:
        "File Alpha remains attached. File Beta detached successfully.",
      otherEvidenceText: "File Beta detached successfully.",
      genericVisible: "Detachment completed.",
      genericSummary: "Detachment completed.",
    },
    {
      action: "invite",
      request: "Invite Member Alpha.",
      summary: "Invited Member Alpha.",
      targetLabel: "Member Alpha",
      requestedVisible:
        "Member Beta remains uninvited. Member Alpha invited successfully.",
      requestedEvidenceText: "Member Alpha invited successfully.",
      otherVisible:
        "Member Alpha remains uninvited. Member Beta invited successfully.",
      otherEvidenceText: "Member Beta invited successfully.",
      genericVisible: "Invitation completed.",
      genericSummary: "Invitation completed.",
    },
    {
      action: "subscribe",
      request: "Subscribe to Channel Alpha.",
      summary: "Subscribed to Channel Alpha.",
      targetLabel: "Channel Alpha",
      requestedVisible:
        "Channel Beta remains inactive. Channel Alpha subscribed successfully.",
      requestedEvidenceText: "Channel Alpha subscribed successfully.",
      otherVisible:
        "Channel Alpha remains inactive. Channel Beta subscribed successfully.",
      otherEvidenceText: "Channel Beta subscribed successfully.",
      genericVisible: "Subscription completed.",
      genericSummary: "Subscription completed.",
    },
    {
      action: "unsubscribe",
      request: "Unsubscribe from Channel Alpha.",
      summary: "Unsubscribed from Channel Alpha.",
      targetLabel: "Channel Alpha",
      requestedVisible:
        "Channel Beta remains active. Channel Alpha unsubscribed successfully.",
      requestedEvidenceText: "Channel Alpha unsubscribed successfully.",
      otherVisible:
        "Channel Alpha remains active. Channel Beta unsubscribed successfully.",
      otherEvidenceText: "Channel Beta unsubscribed successfully.",
      genericVisible: "Unsubscription completed.",
      genericSummary: "Unsubscription completed.",
    },
    {
      action: "pin",
      request: "Pin Report Alpha.",
      summary: "Pinned Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains unpinned. Report Alpha pinned successfully.",
      requestedEvidenceText: "Report Alpha pinned successfully.",
      otherVisible:
        "Report Alpha remains unpinned. Report Beta pinned successfully.",
      otherEvidenceText: "Report Beta pinned successfully.",
      genericVisible: "Pin completed.",
      genericSummary: "Pin completed.",
    },
    {
      action: "unpin",
      request: "Unpin Report Alpha.",
      summary: "Unpinned Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains pinned. Report Alpha unpinned successfully.",
      requestedEvidenceText: "Report Alpha unpinned successfully.",
      otherVisible:
        "Report Alpha remains pinned. Report Beta unpinned successfully.",
      otherEvidenceText: "Report Beta unpinned successfully.",
      genericVisible: "Unpin completed.",
      genericSummary: "Unpin completed.",
    },
    {
      action: "mute",
      request: "Mute Channel Alpha.",
      summary: "Muted Channel Alpha.",
      targetLabel: "Channel Alpha",
      requestedVisible:
        "Channel Beta remains audible. Channel Alpha muted successfully.",
      requestedEvidenceText: "Channel Alpha muted successfully.",
      otherVisible:
        "Channel Alpha remains audible. Channel Beta muted successfully.",
      otherEvidenceText: "Channel Beta muted successfully.",
      genericVisible: "Mute completed.",
      genericSummary: "Mute completed.",
    },
    {
      action: "unmute",
      request: "Unmute Channel Alpha.",
      summary: "Unmuted Channel Alpha.",
      targetLabel: "Channel Alpha",
      requestedVisible:
        "Channel Beta remains muted. Channel Alpha unmuted successfully.",
      requestedEvidenceText: "Channel Alpha unmuted successfully.",
      otherVisible:
        "Channel Alpha remains muted. Channel Beta unmuted successfully.",
      otherEvidenceText: "Channel Beta unmuted successfully.",
      genericVisible: "Unmute completed.",
      genericSummary: "Unmute completed.",
    },
    {
      action: "follow",
      request: "Follow Topic Alpha.",
      summary: "Followed Topic Alpha.",
      targetLabel: "Topic Alpha",
      requestedVisible:
        "Topic Beta remains unfollowed. Topic Alpha followed successfully.",
      requestedEvidenceText: "Topic Alpha followed successfully.",
      otherVisible:
        "Topic Alpha remains unfollowed. Topic Beta followed successfully.",
      otherEvidenceText: "Topic Beta followed successfully.",
      genericVisible: "Follow completed.",
      genericSummary: "Follow completed.",
    },
    {
      action: "unfollow",
      request: "Unfollow Topic Alpha.",
      summary: "Unfollowed Topic Alpha.",
      targetLabel: "Topic Alpha",
      requestedVisible:
        "Topic Beta remains followed. Topic Alpha unfollowed successfully.",
      requestedEvidenceText: "Topic Alpha unfollowed successfully.",
      otherVisible:
        "Topic Alpha remains followed. Topic Beta unfollowed successfully.",
      otherEvidenceText: "Topic Beta unfollowed successfully.",
      genericVisible: "Unfollow completed.",
      genericSummary: "Unfollow completed.",
    },
    {
      action: "bookmark",
      request: "Bookmark Page Alpha.",
      summary: "Bookmarked Page Alpha.",
      targetLabel: "Page Alpha",
      requestedVisible:
        "Page Beta remains unbookmarked. Page Alpha bookmarked successfully.",
      requestedEvidenceText: "Page Alpha bookmarked successfully.",
      otherVisible:
        "Page Alpha remains unbookmarked. Page Beta bookmarked successfully.",
      otherEvidenceText: "Page Beta bookmarked successfully.",
      genericVisible: "Bookmark completed.",
      genericSummary: "Bookmark completed.",
    },
    {
      action: "unbookmark",
      request: "Unbookmark Page Alpha.",
      summary: "Unbookmarked Page Alpha.",
      targetLabel: "Page Alpha",
      requestedVisible:
        "Page Beta remains bookmarked. Page Alpha unbookmarked successfully.",
      requestedEvidenceText: "Page Alpha unbookmarked successfully.",
      otherVisible:
        "Page Alpha remains bookmarked. Page Beta unbookmarked successfully.",
      otherEvidenceText: "Page Beta unbookmarked successfully.",
      genericVisible: "Unbookmark completed.",
      genericSummary: "Unbookmark completed.",
    },
    {
      action: "favorite",
      request: "Favorite Report Alpha.",
      summary: "Favorited Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains unfavorited. Report Alpha favorited successfully.",
      requestedEvidenceText: "Report Alpha favorited successfully.",
      otherVisible:
        "Report Alpha remains unfavorited. Report Beta favorited successfully.",
      otherEvidenceText: "Report Beta favorited successfully.",
      genericVisible: "Favorite completed.",
      genericSummary: "Favorite completed.",
    },
    {
      action: "unfavorite",
      request: "Unfavorite Report Alpha.",
      summary: "Unfavorited Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains favorited. Report Alpha unfavorited successfully.",
      requestedEvidenceText: "Report Alpha unfavorited successfully.",
      otherVisible:
        "Report Alpha remains favorited. Report Beta unfavorited successfully.",
      otherEvidenceText: "Report Beta unfavorited successfully.",
      genericVisible: "Unfavorite completed.",
      genericSummary: "Unfavorite completed.",
    },
    {
      action: "watch",
      request: "Watch Repository Alpha.",
      summary: "Watched Repository Alpha.",
      targetLabel: "Repository Alpha",
      requestedVisible:
        "Repository Beta remains unwatched. Repository Alpha watched successfully.",
      requestedEvidenceText: "Repository Alpha watched successfully.",
      otherVisible:
        "Repository Alpha remains unwatched. Repository Beta watched successfully.",
      otherEvidenceText: "Repository Beta watched successfully.",
      genericVisible: "Watch completed.",
      genericSummary: "Watch completed.",
    },
    {
      action: "unwatch",
      request: "Unwatch Repository Alpha.",
      summary: "Unwatched Repository Alpha.",
      targetLabel: "Repository Alpha",
      requestedVisible:
        "Repository Beta remains watched. Repository Alpha unwatched successfully.",
      requestedEvidenceText: "Repository Alpha unwatched successfully.",
      otherVisible:
        "Repository Alpha remains watched. Repository Beta unwatched successfully.",
      otherEvidenceText: "Repository Beta unwatched successfully.",
      genericVisible: "Unwatch completed.",
      genericSummary: "Unwatch completed.",
    },
    {
      action: "star",
      request: "Star Repository Alpha.",
      summary: "Starred Repository Alpha.",
      targetLabel: "Repository Alpha",
      requestedVisible:
        "Repository Beta remains unstarred. Repository Alpha starred successfully.",
      requestedEvidenceText: "Repository Alpha starred successfully.",
      otherVisible:
        "Repository Alpha remains unstarred. Repository Beta starred successfully.",
      otherEvidenceText: "Repository Beta starred successfully.",
      genericVisible: "Star completed.",
      genericSummary: "Star completed.",
    },
    {
      action: "unstar",
      request: "Unstar Repository Alpha.",
      summary: "Unstarred Repository Alpha.",
      targetLabel: "Repository Alpha",
      requestedVisible:
        "Repository Beta remains starred. Repository Alpha unstarred successfully.",
      requestedEvidenceText: "Repository Alpha unstarred successfully.",
      otherVisible:
        "Repository Alpha remains starred. Repository Beta unstarred successfully.",
      otherEvidenceText: "Repository Beta unstarred successfully.",
      genericVisible: "Unstar completed.",
      genericSummary: "Unstar completed.",
    },
    {
      action: "post",
      request: "Publish Article Alpha.",
      summary: "Published Article Alpha.",
      targetLabel: "Article Alpha",
      requestedVisible:
        "Article Beta remains draft. Article Alpha published successfully.",
      requestedEvidenceText: "Article Alpha published successfully.",
      otherVisible:
        "Article Alpha remains draft. Article Beta published successfully.",
      otherEvidenceText: "Article Beta published successfully.",
      genericVisible: "Publish completed.",
      genericSummary: "Publish completed.",
    },
    {
      action: "update",
      request: "Update Request Alpha.",
      summary: "Updated Request Alpha.",
      targetLabel: "Request Alpha",
      requestedVisible:
        "Request Beta remains stale. Request Alpha updated successfully.",
      requestedEvidenceText: "Request Alpha updated successfully.",
      otherVisible:
        "Request Alpha remains stale. Request Beta updated successfully.",
      otherEvidenceText: "Request Beta updated successfully.",
      genericVisible: "Update completed.",
      genericSummary: "Update completed.",
    },
  ] as const) {
    test(`accepts target-aware visible ${scenario.action} confirmation for the requested target`, () => {
      const snap = workflowSnapshot({
        visibleContent: scenario.requestedVisible,
        pageContent: scenario.requestedVisible,
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: snap,
      });
      const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        snapshot: snap,
        candidateSource: "model_done",
        summary: scenario.summary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "workflow_confirmation",
        action: scenario.action,
        targetLabel: scenario.targetLabel,
      });
      expect(evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "confirmation_state",
            logicalKey: `workflow:confirmation:${scenario.action}`,
            detail: expect.objectContaining({
              action: scenario.action,
              source: "visible_text",
              text: scenario.requestedEvidenceText,
            }),
          }),
        ]),
      );
      expect(decision.status).toBe("accepted");
    });

    test(`rejects target-aware visible ${scenario.action} confirmation for a different target`, () => {
      const snap = workflowSnapshot({
        visibleContent: scenario.otherVisible,
        pageContent: scenario.otherVisible,
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: snap,
      });
      const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        snapshot: snap,
        candidateSource: "model_done",
        summary: scenario.summary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "workflow_confirmation",
        action: scenario.action,
        targetLabel: scenario.targetLabel,
      });
      expect(evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "confirmation_state",
            logicalKey: `workflow:confirmation:${scenario.action}`,
            detail: expect.objectContaining({
              action: scenario.action,
              source: "visible_text",
              text: scenario.otherEvidenceText,
            }),
          }),
        ]),
      );
      expect(decision).toMatchObject({
        status: "rejected",
        reason:
          "Workflow confirmation evidence is for a different target than the requested action.",
      });
    });

    test(`rejects targetless visible ${scenario.action} completion for a named target`, () => {
      const snap = workflowSnapshot({
        visibleContent: scenario.genericVisible,
        pageContent: scenario.genericVisible,
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: snap,
      });
      const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        snapshot: snap,
        candidateSource: "model_done",
        summary: scenario.genericSummary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "workflow_confirmation",
        action: scenario.action,
        targetLabel: scenario.targetLabel,
      });
      expect(decision).toMatchObject({
        status: "rejected",
        reason:
          "Workflow confirmation evidence is for a different target than the requested action.",
      });
    });
  }
});

