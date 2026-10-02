import assert from "node:assert/strict";
import test from "node:test";
import { prepareReviewedDataset } from "./training-data/export-reviewed.js";

const sourceHash = "a".repeat(64);

function sample(id: string, sessionId: string, content = `Task ${id}`) {
  return {
    messages: [
      { role: "user", content },
      { role: "assistant", content: "Done", tool_calls: [] },
    ],
    metadata: {
      id,
      sessionId,
      sourceHash,
      schemaVersion: "2026-02-19",
      outcome: "completed",
      toolExecutionsSuccessful: true,
      domain: "example.test",
    },
  };
}

test("exports only approved reviewed executor examples", () => {
  const result = prepareReviewedDataset(
    [sample("approved", "session-1"), sample("open", "session-2")],
    { approved: { status: "approved" } },
  );
  assert.equal(Object.values(result.rows).flat().length, 1);
  assert.equal(result.rejected.not_approved, 1);
  const exported = Object.values(result.rows).flat()[0];
  assert.equal((exported.metadata as { role: string }).role, "executor");
  assert.equal(
    (exported.metadata as { sourceSessionHash: string }).sourceSessionHash.length,
    64,
  );
});

test("keeps sessions in one split and removes duplicate conversations", () => {
  const result = prepareReviewedDataset(
    [
      sample("a", "same-session"),
      sample("b", "same-session"),
      sample("c", "other-session", "Task a"),
    ],
    { a: { status: "approved" }, b: { status: "approved" }, c: { status: "approved" } },
  );
  assert.equal(Object.values(result.rows).flat().length, 2);
  assert.equal(result.rejected.duplicate_conversation, 1);
  const sameSessionRows = Object.entries(result.rows)
    .map(([split, rows]) => ({
      split,
      count: rows.filter((row) =>
        ["a", "b"].includes((row.metadata as { id: string }).id),
      ).length,
    }))
    .filter((entry) => entry.count > 0);
  assert.equal(sameSessionRows.length, 1);
  assert.equal(sameSessionRows[0].count, 2);
});

test("rejects removed workflows, missing images, and content changed by redaction", () => {
  const serviceNow = sample("sn", "s1", "Open ServiceNow incident");
  const image = sample("image", "s2", "Look at [image]");
  const privateValue = sample("private", "s3", "Email me at user@example.com");
  const result = prepareReviewedDataset(
    [serviceNow, image, privateValue],
    {
      sn: { status: "approved" },
      image: { status: "approved" },
      private: { status: "approved" },
    },
  );
  assert.equal(Object.values(result.rows).flat().length, 0);
  assert.equal(result.rejected.removed_servicenow_workflow, 1);
  assert.equal(result.rejected.missing_image_input, 1);
  assert.equal(result.rejected.changed_since_review, 1);
});
