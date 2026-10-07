import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import {
  PostgresMcpOAuthStore,
  type McpGrant,
} from "../src/mcp-oauth-store.js";
import { opaqueToken } from "../src/crypto.js";
const connectionString = process.env.MCP_TEST_DATABASE_URL;
test(
  "Postgres migration, one-use code, concurrent refresh/revocation, and account cascade",
  { skip: !connectionString },
  async () => {
    const pool = new Pool({ connectionString }),
      store = new PostgresMcpOAuthStore(pool);
    const id = opaqueToken(),
      device = opaqueToken();
    try {
      await pool.query(
        await readFile(
          new URL("../migrations/002_control.sql", import.meta.url),
          "utf8",
        ),
      );
      const sql = await readFile(
        new URL("../migrations/023_mcp_oauth.sql", import.meta.url),
        "utf8",
      );
      await pool.query(sql);
      await pool.query(sql);
      await pool.query(
        "INSERT INTO control.accounts(account_id,email,cloud_access) VALUES($1,'fixture@example.test',true)",
        [id],
      );
      await pool.query(
        "INSERT INTO control.devices(id,account_id,installation_id,display_name,extension_version) VALUES($1,$2,$1,'Test','test')",
        [device, id],
      );
      const g: McpGrant = {
        hash: opaqueToken(),
        kind: "code",
        family: opaqueToken(),
        accountId: id,
        deviceId: device,
        epoch: 0,
        clientId: "codex",
        resource: "https://opensidebar.com/mcp",
        scopes: ["browser.devices.read"],
        expiresAt: new Date(Date.now() + 120000),
        familyExpiresAt: new Date(Date.now() + 86400000),
      };
      await store.put(g);
      assert.equal((await store.get(g.hash))?.accountId, id);
      assert.equal(
        await store.exchange(
          g.hash,
          () => false,
          () => [],
        ),
        false,
      );
      const access = opaqueToken(),
        refresh = opaqueToken();
      assert.equal(
        await store.exchange(
          g.hash,
          () => true,
          (row) => [
            { ...row, hash: access, kind: "access" },
            { ...row, hash: refresh, kind: "refresh" },
          ],
        ),
        true,
      );
      const next = opaqueToken();
      const attempts = await Promise.all([
        store.exchange(
          refresh,
          () => true,
          (row) => [{ ...row, hash: next, kind: "access" }],
        ),
        store.exchange(
          refresh,
          () => true,
          (row) => [{ ...row, hash: opaqueToken(), kind: "access" }],
        ),
      ]);
      assert.deepEqual(attempts.sort(), [false, true]);
      assert.ok((await store.get(access))?.revokedAt);
      assert.ok((await store.get(next))?.revokedAt);
      await pool.query("DELETE FROM control.accounts WHERE account_id=$1", [
        id,
      ]);
      assert.equal(await store.get(g.hash), null);
    } finally {
      await pool.query("DELETE FROM control.accounts WHERE account_id=$1", [
        id,
      ]);
      await pool.end();
    }
  },
);
