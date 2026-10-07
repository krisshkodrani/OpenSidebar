import { spawnSync } from "node:child_process";

// Tests intentionally reset schemas. Supply disposable databases, never a
// development account database or production connection string.
for (const name of ["PLAYGROUND_TEST_DATABASE_URL", "MCP_TEST_DATABASE_URL"]) {
  if (!process.env[name]) {
    console.error(`${name} must point to a disposable PostgreSQL database.`);
    process.exit(1);
  }
}

const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    "apps/cloud-service/test/postgres-integration.test.ts",
    "apps/cloud-service/test/session-postgres-integration.test.ts",
    "apps/cloud-service/test/mcp-oauth-postgres.test.ts",
    "apps/cloud-service/test/remote-interactive-postgres.test.ts",
  ],
  { stdio: "inherit", env: process.env },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
