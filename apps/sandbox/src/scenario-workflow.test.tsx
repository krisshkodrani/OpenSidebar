import assert from "node:assert/strict";
import test from "node:test";
import { workflowCompletionMessage } from "./scenario-workflow.js";

test("completed workflow distinguishes an available final action from a saved one", () => {
  const ready = workflowCompletionMessage(false);
  assert.match(ready, /final action is now available/i);

  const saved = workflowCompletionMessage(true);
  assert.match(saved, /final action was saved successfully/i);
  assert.doesNotMatch(saved, /now available/i);
});
