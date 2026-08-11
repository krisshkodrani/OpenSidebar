import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const baseEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://localhost/opensidebar",
  DEV_ACCOUNT_ID: "development-account",
  OPENSIDEBAR_EXTENSION_ID: "abcdefghijklmnopabcdefghijklmnop",
  COGNITO_EXTENSION_CLIENT_ID: "extension-client",
});

test("all session and orchestration capabilities default disabled", () => {
  const config = loadConfig(baseEnv());
  assert.equal(config.cloudSessionsEnabled, false);
  assert.equal(config.checkpointWritesEnabled, false);
  assert.equal(config.checkpointRestoreEnabled, false);
  assert.equal(config.deviceCommandsEnabled, false);
  assert.equal(config.deviceTakeoverEnabled, false);
  assert.equal(config.temporalShadowEnabled, false);
  assert.equal(config.temporalCoordinationEnabled, false);
  assert.equal(config.traceSyncEnabled, false);
  assert.equal(config.traceUploadsEnabled, false);
  assert.equal(config.traceDownloadsEnabled, false);
});

test("trace sync requires an isolated bucket and named-tester subset", () => {
  const enabled = {
    ...baseEnv(),
    CLOUD_CONTROL_ENABLED: "true",
    TRACE_SYNC_ENABLED: "true",
  };
  assert.throws(() => loadConfig(enabled), /TRACE_BUCKET_NAME/);
  assert.throws(
    () =>
      loadConfig({
        ...enabled,
        TRACE_BUCKET_NAME: "trace-bucket",
        CLOUD_TESTER_SUBJECTS: "account-1",
        TRACE_TESTER_SUBJECTS: "account-2",
      }),
    /TRACE_TESTER_SUBJECTS must be a subset/,
  );
  const config = loadConfig({
    ...enabled,
    TRACE_BUCKET_NAME: "trace-bucket",
    CLOUD_TESTER_SUBJECTS: "account-1",
    TRACE_TESTER_SUBJECTS: "account-1",
    TRACE_UPLOADS_ENABLED: "true",
    TRACE_DOWNLOADS_ENABLED: "true",
  });
  assert.equal(config.traceUploadsEnabled, true);
  assert.equal(config.traceDownloadsEnabled, true);
});

test("subordinate flags cannot enable without their parent capability", () => {
  const config = loadConfig({
    ...baseEnv(),
    CLOUD_CONTROL_ENABLED: "true",
    CHECKPOINT_WRITES_ENABLED: "true",
    CHECKPOINT_RESTORE_ENABLED: "true",
    DEVICE_COMMANDS_ENABLED: "true",
    DEVICE_TAKEOVER_ENABLED: "true",
    TEMPORAL_SHADOW_ENABLED: "true",
    TEMPORAL_COORDINATION_ENABLED: "true",
    TEMPORAL_SHADOW_TOKEN: "t".repeat(32),
    TEMPORAL_SHADOW_HASH_KEY: "h".repeat(32),
  });
  assert.equal(config.cloudSessionsEnabled, false);
  assert.equal(config.checkpointWritesEnabled, false);
  assert.equal(config.checkpointRestoreEnabled, false);
  assert.equal(config.deviceCommandsEnabled, false);
  assert.equal(config.deviceTakeoverEnabled, false);
  assert.equal(config.temporalShadowEnabled, false);
  assert.equal(config.temporalCoordinationEnabled, false);
});

test("shadow mode requires independent long worker secrets", () => {
  assert.throws(
    () =>
      loadConfig({
        ...baseEnv(),
        CLOUD_CONTROL_ENABLED: "true",
        CLOUD_SESSIONS_ENABLED: "true",
        TEMPORAL_SHADOW_ENABLED: "true",
      }),
    /TEMPORAL_SHADOW_TOKEN/,
  );
});

test("coordination requires sessions, commands, and shadow mode", () => {
  const config = loadConfig({
    ...baseEnv(),
    CLOUD_CONTROL_ENABLED: "true",
    CLOUD_SESSIONS_ENABLED: "true",
    CLOUD_TESTER_SUBJECTS: "account-1",
    CLOUD_SESSION_TESTER_SUBJECTS: "account-1",
    CHECKPOINT_WRITES_ENABLED: "true",
    CHECKPOINT_RESTORE_ENABLED: "true",
    SESSION_KMS_KEY_ID: "session-key",
    SESSION_BUCKET_NAME: "session-bucket",
    DEVICE_COMMANDS_ENABLED: "true",
    DEVICE_TAKEOVER_ENABLED: "true",
    TEMPORAL_SHADOW_ENABLED: "true",
    TEMPORAL_COORDINATION_ENABLED: "true",
    TEMPORAL_SHADOW_TOKEN: "t".repeat(32),
    TEMPORAL_SHADOW_HASH_KEY: "h".repeat(32),
  });
  assert.equal(config.cloudSessionsEnabled, true);
  assert.equal(config.checkpointWritesEnabled, true);
  assert.equal(config.checkpointRestoreEnabled, true);
  assert.equal(config.deviceCommandsEnabled, true);
  assert.equal(config.deviceTakeoverEnabled, true);
  assert.equal(config.temporalShadowEnabled, true);
  assert.equal(config.temporalCoordinationEnabled, true);
});

test("enabled checkpoint storage requires a dedicated key and bucket", () => {
  const enabled = {
    ...baseEnv(),
    CLOUD_CONTROL_ENABLED: "true",
    CLOUD_SESSIONS_ENABLED: "true",
    CHECKPOINT_WRITES_ENABLED: "true",
  };
  assert.throws(() => loadConfig(enabled), /SESSION_KMS_KEY_ID/);
  assert.throws(
    () =>
      loadConfig({
        ...enabled,
        CREDENTIAL_KMS_KEY_ID: "shared-key",
        SESSION_KMS_KEY_ID: "shared-key",
        SESSION_BUCKET_NAME: "session-bucket",
      }),
    /must be different/,
  );
});

test("session activation requires a nonempty named-tester subset", () => {
  const enabled = {
    ...baseEnv(),
    CLOUD_CONTROL_ENABLED: "true",
    CLOUD_SESSIONS_ENABLED: "true",
  };
  assert.throws(
    () => loadConfig(enabled),
    /requires at least one named tester/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...enabled,
        CLOUD_TESTER_SUBJECTS: "account-1",
        CLOUD_SESSION_TESTER_SUBJECTS: "account-2",
      }),
    /must be a subset/,
  );
  const config = loadConfig({
    ...enabled,
    CLOUD_TESTER_SUBJECTS: "account-1,account-2",
    CLOUD_SESSION_TESTER_SUBJECTS: " account-2 ",
  });
  assert.deepEqual([...config.cloudSessionTesterSubjects], ["account-2"]);
});

test("dashboard operators must already have general cloud access", () => {
  assert.throws(
    () =>
      loadConfig({
        ...baseEnv(),
        CLOUD_TESTER_SUBJECTS: "account-1",
        CLOUD_OPERATOR_SUBJECTS: "account-2",
      }),
    /CLOUD_OPERATOR_SUBJECTS must be a subset/,
  );
});
