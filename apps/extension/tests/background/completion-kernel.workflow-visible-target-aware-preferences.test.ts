import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import type { DomSnapshot, TaggedElement } from "../../src/types";

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

function statusElement(tag: number, text: string): TaggedElement {
  return {
    tag,
    tagName: "p",
    role: "p",
    text,
    attributes: {},
    rect: { x: 0, y: tag * 20, width: 320, height: 24 },
    isVisible: true,
    isDisabled: false,
  };
}
describe("completion kernel target-aware visible preference workflow confirmation matrix", () => {
  for (const scenario of [
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

  test("accepts visible enabled state for dark mode when other enable confirmations are present", () => {
    const visible =
      "Interaction Status Action: notifications Action: privacy Dark Mode: enabled";
    const snap = workflowSnapshot({
      visibleContent: visible,
      pageContent: visible,
    });
    const generated = generateCompletionContract({
      userRequest: "Turn on dark mode.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Dark mode is turned on.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "dark mode",
    });
    expect(decision).toMatchObject({
      status: "accepted",
      reason: "Workflow contract is satisfied by visible target state.",
    });
  });

  test("accepts delete confirmation from visible element text when page text is empty", () => {
    const snap = workflowSnapshot({
      title: "Modal & Overlay Test",
      url: "https://example.test/modal-overlays",
      visibleContent: "",
      pageContent: "",
      elements: [statusElement(155, "Account deleted successfully.")],
    });
    const generated = generateCompletionContract({
      userRequest: "Delete the account and confirm.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The account was deleted successfully.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:delete",
          detail: expect.objectContaining({
            text: "Account deleted successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts delete confirmation when planner target includes button or link wording", () => {
    const snap = workflowSnapshot({
      title: "Modal & Overlay Test",
      url: "https://example.test/modal-overlays",
      visibleContent: "",
      pageContent: "",
      elements: [statusElement(155, "Account deleted successfully.")],
    });
    const generated = generateCompletionContract({
      userRequest:
        "Click the delete account button/link and confirm the deletion in the confirmation dialog.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The account was deleted successfully.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
      targetLabel: "account button/link",
    });
    expect(decision.status).toBe("accepted");
  });
  test("accepts delete confirmation when target label keeps delete action wording", () => {
    const snap = workflowSnapshot({
      title: "Modal & Overlay Test",
      url: "https://example.test/modal-overlays",
      visibleContent: "",
      pageContent: "",
      elements: [statusElement(155, "Account deleted successfully.")],
    });
    const generated = generateCompletionContract({
      userRequest:
        "Click the delete account button and confirm the deletion in the confirmation dialog.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The account was deleted successfully.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
    });
    expect(decision.status).toBe("accepted");
  });

  test("rejects visible disabled state for a dark mode enable request", () => {
    const visible = "Interaction Status Action: notifications Dark Mode: disabled";
    const snap = workflowSnapshot({
      visibleContent: visible,
      pageContent: visible,
    });
    const generated = generateCompletionContract({
      userRequest: "Turn on dark mode.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Dark mode is turned on.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "dark mode",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts a later action status for the requested enabled target", () => {
    const visible = "Interaction Status Action: notifications Action: privacy";
    const snap = workflowSnapshot({
      visibleContent: visible,
      pageContent: visible,
    });
    const generated = generateCompletionContract({
      userRequest: "Activate the Privacy Settings action.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Activated the Privacy Settings action.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Privacy Settings",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:enable",
          detail: expect.objectContaining({
            text: "Action: notifications Action: privacy",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });
});
