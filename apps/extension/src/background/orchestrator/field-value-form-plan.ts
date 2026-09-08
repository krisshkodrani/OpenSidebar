/**
 * Field-value form plan shape.
 *
 * Recognizes the synthesized two-node create-record plan so callers can treat
 * it as one atomic workflow. Extracted from planner.ts; behavior unchanged.
 */

import type { TaskNode } from "./types";

function isFieldValueFormFillNode(node: TaskNode): boolean {
  return (
    node.toolProfile === "form_fill" &&
    /^Fill the form with the requested field values:/i.test(node.description)
  );
}

function isFieldValueSubmitNode(node: TaskNode): boolean {
  return (
    node.toolProfile === "submit_form" &&
    /^Submit the form and verify/i.test(node.description)
  );
}

/**
 * The synthesized field-value form plan is two nodes: a `form_fill` node whose
 * objective explicitly says "Do not submit the form yet" and a dependent
 * `submit_form` node. It is one atomic create-record workflow.
 */
export function isFieldValueFormPlan(nodes: TaskNode[]): boolean {
  return (
    nodes.length === 2 &&
    isFieldValueFormFillNode(nodes[0]) &&
    isFieldValueSubmitNode(nodes[1])
  );
}
