import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("workflow source keeps the synthetic signal and query boundary", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/workflows.ts", import.meta.url)),
    "utf8",
  );
  assert.match(source, /defineSignal<[^>]+>\("synthetic_event"\)/);
  assert.match(source, /defineQuery<[^>]+>\("state"\)/);
  assert.doesNotMatch(source, /CANARY|authorization header|provider key/i);
});
