import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { recordTraceArtifactInSqlite, retainTraceSqliteWriter } from "./trace-sqlite-store.js";

test("retained trace writer commits records without closing per request and releases its last lease", (context) => {
  const root = mkdtempSync(join(tmpdir(), "opensidebar-writer-"));
  const close = context.mock.method(Database.prototype, "close");
  const release = retainTraceSqliteWriter(root);
  const releaseSecond = retainTraceSqliteWriter(root);
  try {
    recordTraceArtifactInSqlite(root, { path: "first.png", kind: "screenshot" });
    assert.equal(close.mock.callCount(), 0);
    release();
    assert.equal(close.mock.callCount(), 0);
    recordTraceArtifactInSqlite(root, { path: "second.png", kind: "screenshot" });
    assert.equal(close.mock.callCount(), 0);
    releaseSecond();
    assert.equal(close.mock.callCount(), 1);
    releaseSecond();
    assert.equal(close.mock.callCount(), 1);
    // One-shot callers retain their original close behavior after the lease ends.
    recordTraceArtifactInSqlite(root, { path: "third.png", kind: "screenshot" });
    assert.equal(close.mock.callCount(), 2);
    const reader = new Database(join(root, ".artifacts", "trace-index.sqlite"), { readonly: true });
    try {
      assert.deepEqual(reader.prepare("SELECT path FROM trace_artifacts ORDER BY path").all(),
        [{ path: "first.png" }, { path: "second.png" }, { path: "third.png" }]);
    } finally {
      reader.close();
    }
  } finally {
    release();
    releaseSecond();
    rmSync(root, { recursive: true, force: true });
  }
});
