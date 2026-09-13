import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseBuildSha256, matchesProductionSmoke } from "./release-build-identity.js";

test("release identity is portable and detects changed bytes and renamed assets", () => {
  const root = mkdtempSync(join(tmpdir(), "opensidebar-release-"));
  try {
    const first = join(root, "first");
    const second = join(root, "second");
    for (const path of [first, second]) {
      mkdirSync(join(path, "assets"), { recursive: true });
      writeFileSync(join(path, "manifest.json"), '{"version":"1.0.0"}');
      writeFileSync(join(path, "assets", "app.js"), "original");
    }
    const original = releaseBuildSha256(first);
    assert.equal(releaseBuildSha256(second), original);
    writeFileSync(join(second, "assets", "app.js"), "modified");
    assert.notEqual(releaseBuildSha256(second), original);
    writeFileSync(join(second, "assets", "app.js"), "original");
    renameSync(join(second, "assets", "app.js"), join(second, "assets", "other.js"));
    assert.notEqual(releaseBuildSha256(second), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release gate rejects dev, stale, mismatched and non-rendered smoke evidence", () => {
  const expected = { commit: "current", version: "1.0.0", distSha256: "build-hash" };
  const valid = { ...expected, build: "production", result: "passed", nativePanelRendered: true };
  assert.equal(matchesProductionSmoke(valid, expected), true);
  for (const change of [
    { build: "e2e" }, { commit: "old" }, { version: "0.9.0" },
    { distSha256: "other-build" }, { nativePanelRendered: false }, { result: "failed" },
  ]) assert.equal(matchesProductionSmoke({ ...valid, ...change }, expected), false);
  assert.equal(matchesProductionSmoke({ result: "passed", commit: "current" }, expected), false);
});
