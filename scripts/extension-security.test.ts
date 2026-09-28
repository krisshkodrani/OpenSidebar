import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("extension does not expose cross-extension messaging", () => {
  const manifest = JSON.parse(readFileSync("apps/extension/manifest.json", "utf8"));
  assert.equal(Object.hasOwn(manifest, "externally_connectable"), false);
  for (const entrypoint of [
    "apps/extension/src/background/background.ts",
    "apps/extension/src/content/content.ts",
  ]) {
    assert.doesNotMatch(readFileSync(entrypoint, "utf8"), /onMessageExternal/);
  }
});
