/**
 * Skill tool-suppression policies (extracted from skills.ts — decomposition
 * ratchet, 2026-07-23 skills/tools audit).
 *
 * Pure data: for a selected skill, which tools are temporarily removed from
 * the executor's tool list (`applySkillToolSuppression`) and which recovery
 * exits stay available regardless. skills.ts re-imports this table via
 * `getSkillToolSuppressionPolicy`.
 */

import { ToolName } from "../../types";
import type { SkillToolSuppressionPolicy } from "./skill-types";

export const SKILL_TOOL_SUPPRESSION_POLICIES: Record<
  string,
  SkillToolSuppressionPolicy
> = {
  "hover-reveal-navigation": {
    temporarilySuppressedTools: [
      ToolName.HIDE_ELEMENT,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.EXECUTE_JS,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "structured-form-fill": {
    temporarilySuppressedTools: [
      ToolName.PRESS_KEY,
      ToolName.XRAY_PAGE,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "progressive-repeatable-form": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.OPEN_SERVICENOW_MODULE,
      ToolName.GO_BACK,
      ToolName.CREATE_TAB,
      ToolName.LIST_TABS,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.PRESS_KEY,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "multi-step-form-wizard": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.OPEN_SERVICENOW_MODULE,
      ToolName.GO_BACK,
      ToolName.CREATE_TAB,
      ToolName.LIST_TABS,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.PRESS_KEY,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "servicenow-record-form": {
    temporarilySuppressedTools: [
      ToolName.CLICK_ELEMENT,
      ToolName.PRESS_KEY,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
      ToolName.CONFIGURE_SERVICENOW_FORM,
    ],
  },
  "inline-edit-surface": {
    temporarilySuppressedTools: [ToolName.CLICK_COORDINATES],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "modal-overlay-recovery": {
    // dismiss_overlays is deliberately NOT suppressed: it clicks real close
    // buttons first and reports which overlays were only CSS-hidden, so it is
    // the skill's opening move rather than a hazard (2026-07-23 tools audit).
    // type_text is deliberately NOT suppressed either: the matcher applies
    // this skill to mixed tasks ("close popups, then fill the form"), and
    // removing type_text made an agent type an email address one press_key
    // at a time (baseline smoke, 2026-07-23). Ranking already demotes it.
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "multi-tab-checklist-workflow": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.READ_ELEMENT,
      ToolName.LIST_TABS,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "list-detail-review-loop": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.PRESS_KEY,
      ToolName.READ_ELEMENT,
      ToolName.FIND_ELEMENT,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "paginated-table-scan": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.READ_ELEMENT,
      ToolName.FIND_ELEMENT,
      ToolName.TYPE_TEXT,
      ToolName.PRESS_KEY,
      ToolName.SELECT_OPTION,
      ToolName.SET_CHECKBOX,
      ToolName.SCROLL_PAGE,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.EXECUTE_JS,
      ToolName.CLICK_COORDINATES,
      ToolName.CREATE_TAB,
      ToolName.LIST_TABS,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "paginated-record-lookup": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.READ_ELEMENT,
      ToolName.PRESS_KEY,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.EXECUTE_JS,
      ToolName.CLICK_COORDINATES,
      ToolName.CREATE_TAB,
      ToolName.LIST_TABS,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "cross-tab-compare": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
};
